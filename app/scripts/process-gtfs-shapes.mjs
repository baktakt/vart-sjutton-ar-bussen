#!/usr/bin/env node
/**
 * scripts/process-gtfs-shapes.mjs
 *
 * Downloads a city's GTFS static feed, extracts per-line shape files
 * to public/shapes/{city}/, and writes a manifest.json.
 *
 * Run manually whenever a city publishes a new GTFS feed (~quarterly):
 *   node scripts/process-gtfs-shapes.mjs --city goteborg
 *
 * Requires TRAFIKLAB_STATIC_KEY in .env.local
 */

import 'dotenv/config';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --city argument (default: goteborg for backwards compat)
const cityArg = process.argv.find((a, i) => process.argv[i - 1] === '--city') ?? 'goteborg';
const CITY_ID = cityArg;

const OUT_DIR = path.resolve(__dirname, '..', 'public', 'shapes', CITY_ID);
console.log(`Building shapes for city: ${CITY_ID} → ${OUT_DIR}`);

// GTFS static feed URLs per city (Trafiklab opendata.samtrafiken.se)
const GTFS_URLS = {
  goteborg:  (key) => `https://opendata.samtrafiken.se/gtfs/vt/vt.zip?key=${key}`,
  stockholm: (key) => `https://opendata.samtrafiken.se/gtfs/sl/sl.zip?key=${key}`,
};

const ROUTE_TYPE_LABELS = {
  100:  'Train',
  400:  'Metro',
  401:  'Metro',
  700:  'Bus',
  900:  'Tram',
  1000: 'Boat',
  1200: 'Ferry',
};

// Priority for resolving filename collisions: higher = more important.
// The highest-priority type claiming a name keeps "line-{name}.json";
// lower-priority types get "line-{name}-t{routeType}.json".
const ROUTE_PRIORITY = { 401: 5, 400: 5, 100: 4, 900: 3, 1000: 2, 1200: 2, 700: 1 };

// Metro route types (used to detect metro-served stops)
const METRO_TYPES = new Set([400, 401]);

// Demand-responsive / flex services — no fixed shape
const SKIP_TYPES = new Set([1501]);

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function* iterLines(buf) {
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const end  = buf[i - 1] === 0x0d ? i - 1 : i;
      const line = buf.slice(start, end).toString('utf8');
      if (line.trim()) yield line;
      start = i + 1;
    }
  }
  if (start < buf.length) {
    const line = buf.slice(start).toString('utf8').trim();
    if (line) yield line;
  }
}

function parseHeaders(line) {
  return line.replace(/^\uFEFF/, '').split(',').map(h => h.trim());
}

function parseRow(line, headers) {
  const values = line.split(',');
  const obj = {};
  headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim(); });
  return obj;
}

function parseFull(buf) {
  const gen = iterLines(buf);
  const first = gen.next();
  if (first.done) return [];
  const headers = parseHeaders(first.value);
  const rows = [];
  for (const line of gen) rows.push(parseRow(line, headers));
  return rows;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const key = process.env.TRAFIKLAB_STATIC_KEY;
  if (!key) {
    console.error('ERROR: TRAFIKLAB_STATIC_KEY not set in .env.local');
    process.exit(1);
  }

  const urlFn = GTFS_URLS[CITY_ID];
  if (!urlFn) {
    console.error(`ERROR: Unknown city "${CITY_ID}". Known cities: ${Object.keys(GTFS_URLS).join(', ')}`);
    process.exit(1);
  }

  // 1. Download zip
  const url = urlFn(key);
  console.log(`Downloading ${CITY_ID} GTFS…`);
  const res = await fetch(url);
  if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const zip = new AdmZip(buf);

  // 2. Parse routes.txt → collect non-skipped routes
  console.log('Parsing routes.txt…');
  const routesBuf = zip.getEntry('routes.txt').getData();
  const routes     = parseFull(routesBuf);

  // Map: route_id → { name, routeType, color, textColor }
  const routeMeta = new Map();
  for (const r of routes) {
    const type = Number(r.route_type);
    if (SKIP_TYPES.has(type)) continue;
    routeMeta.set(r.route_id, {
      name:      r.route_short_name || r.route_long_name || r.route_id,
      routeType: type,
      color:     r.route_color     || '',
      textColor: r.route_text_color || '',
    });
  }
  console.log(`  ${routeMeta.size} routes (skipped ${routes.length - routeMeta.size} demand-responsive)`);

  // Write routes.json — used by lib/sl/routes.ts for vehicle colour lookup
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const routesJson = {};
  for (const [id, { name, routeType, color, textColor }] of routeMeta) {
    routesJson[id] = { name, type: routeType, color, textColor };
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'routes.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), routes: routesJson }),
  );
  console.log(`  routes.json written (${routeMeta.size} entries)`);

  // 3. Parse trips.txt → collect shape_ids per route, tracking point count
  //    We need both: wanted shape_ids, and which route each belongs to.
  console.log('Parsing trips.txt…');
  const tripsBuf = zip.getEntry('trips.txt').getData();
  const trips    = parseFull(tripsBuf);

  // shapeRoutes: shape_id → route_id (first route seen — shapes are route-specific)
  const shapeRoutes   = new Map(); // shape_id → route_id
  const routeShapeIds = new Map(); // route_id → Set<shape_id>

  // Build metro trip set AND full trip→route map for GTFS-RT enrichment
  // SL's GTFS-RT TripDescriptor often omits route_id, only including trip_id.
  // trips.json bridges the gap: trip_id → route_id at runtime.
  const metroTripIds = new Set();
  const tripRouteMap = {};   // trip_id → route_id (written to trips.json)

  for (const t of trips) {
    const meta = routeMeta.get(t.route_id);
    if (!meta) continue;
    tripRouteMap[t.trip_id] = t.route_id;
    if (METRO_TYPES.has(meta.routeType)) metroTripIds.add(t.trip_id);
    if (!t.shape_id) continue;
    shapeRoutes.set(t.shape_id, t.route_id);
    if (!routeShapeIds.has(t.route_id)) routeShapeIds.set(t.route_id, new Set());
    routeShapeIds.get(t.route_id).add(t.shape_id);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'trips.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), trips: tripRouteMap }),
  );
  console.log(`  trips.json written (${Object.keys(tripRouteMap).length} trip→route entries)`);

  const wantedShapeIds = new Set(shapeRoutes.keys());
  console.log(`  ${wantedShapeIds.size} unique shape_ids across ${routeShapeIds.size} routes`);
  console.log(`  ${metroTripIds.size} metro trip IDs`);

  // Identify routes with no shape_id — these need stop-sequence fallback shapes
  // (SL metro / tram typically omit shape geometry from GTFS static)
  const FALLBACK_TYPES = new Set([100, 400, 401, 900, 1000, 1200]); // non-bus
  const noShapeRouteIds = new Set();
  for (const [routeId] of routeMeta) {
    if (!routeShapeIds.has(routeId)) noShapeRouteIds.add(routeId);
  }
  // trip_id → route_id, limited to fallback-eligible no-shape routes
  const noShapeTripToRoute = new Map();
  for (const t of trips) {
    const meta = routeMeta.get(t.route_id);
    if (!meta) continue;
    if (noShapeRouteIds.has(t.route_id) && FALLBACK_TYPES.has(meta.routeType)) {
      noShapeTripToRoute.set(t.trip_id, t.route_id);
    }
  }
  const noShapeByType = {};
  for (const routeId of noShapeRouteIds) {
    const meta = routeMeta.get(routeId);
    const label = ROUTE_TYPE_LABELS[meta.routeType] ?? `Type ${meta.routeType}`;
    noShapeByType[label] = (noShapeByType[label] ?? 0) + 1;
  }
  console.log(`  ${noShapeRouteIds.size} routes with no shape_id (fallback: ${noShapeTripToRoute.size} eligible trips)`);
  for (const [label, count] of Object.entries(noShapeByType).sort()) {
    console.log(`    ↳ ${label}: ${count}`);
  }

  // 4. Stream shapes.txt — only materialise wanted shapes
  console.log('Parsing shapes.txt (streaming)…');
  const shapesBuf = zip.getEntry('shapes.txt').getData();

  // shapePoints: shape_id → [lat, lng][]  (only for wanted shape_ids)
  const shapePoints = new Map();

  const gen     = iterLines(shapesBuf);
  const headers = parseHeaders(gen.next().value);
  const iId     = headers.indexOf('shape_id');
  const iLat    = headers.indexOf('shape_pt_lat');
  const iLon    = headers.indexOf('shape_pt_lon');
  const iSeq    = headers.indexOf('shape_pt_sequence');

  for (const line of gen) {
    const cols = line.split(',');
    const id   = cols[iId]?.trim();
    if (!id || !wantedShapeIds.has(id)) continue;

    const lat = parseFloat(cols[iLat]);
    const lon = parseFloat(cols[iLon]);
    const seq = parseInt(cols[iSeq], 10);
    if (isNaN(lat) || isNaN(lon) || isNaN(seq)) continue;

    if (!shapePoints.has(id)) shapePoints.set(id, []);
    shapePoints.get(id).push([seq, lat, lon]);
  }

  // Sort each shape by sequence number
  for (const pts of shapePoints.values()) {
    pts.sort((a, b) => a[0] - b[0]);
  }

  console.log(`  Materialised ${shapePoints.size} shapes`);

  // 5. For each route, pick the longest shape (most points = most complete)
  //    and write to public/shapes/line-{name}.json
  //
  //    Process routes in priority order so that if two routes share the same
  //    short name (e.g. metro T10 and ferry route 10), the more important type
  //    claims "line-10.json" and the other gets "line-10-t1000.json".
  const manifest = [];
  let written = 0, skipped = 0;

  // Track which base filenames are already claimed and by which routeType
  const claimedFilenames = new Map(); // safeName → routeType that owns it

  // Sort descending by priority so high-priority types are written first
  const sortedRouteEntries = [...routeMeta.entries()].sort(([, a], [, b]) => {
    const pa = ROUTE_PRIORITY[a.routeType] ?? 0;
    const pb = ROUTE_PRIORITY[b.routeType] ?? 0;
    return pb - pa;
  });

  for (const [routeId, { name, routeType }] of sortedRouteEntries) {
    const shapeIds = routeShapeIds.get(routeId);
    if (!shapeIds || shapeIds.size === 0) { skipped++; continue; }

    // Pick longest shape
    let bestId = null, bestLen = -1;
    for (const sid of shapeIds) {
      const pts = shapePoints.get(sid);
      if (pts && pts.length > bestLen) { bestLen = pts.length; bestId = sid; }
    }

    if (!bestId || bestLen < 2) { skipped++; continue; }

    // Strip the sequence number, keep only [lat, lng]
    const coords = shapePoints.get(bestId).map(([, lat, lon]) => [lat, lon]);

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Assign unique filename: first claimant for a name gets the base filename,
    // subsequent claimants (name collision with a different type) get a suffix.
    let filename;
    const owner = claimedFilenames.get(safeName);
    if (owner === undefined) {
      filename = `line-${safeName}.json`;
      claimedFilenames.set(safeName, routeType);
    } else if (owner === routeType) {
      filename = `line-${safeName}.json`; // same type, overwrite is fine
    } else {
      filename = `line-${safeName}-t${routeType}.json`;
    }

    fs.writeFileSync(
      path.join(OUT_DIR, filename),
      JSON.stringify({ name, routeType, coordinates: coords }),
    );

    manifest.push({
      name,
      routeType,
      label: ROUTE_TYPE_LABELS[routeType] ?? `Type ${routeType}`,
      file:  filename,
      pointCount: coords.length,
    });
    written++;
  }

  console.log(`\n${written} shape files from GTFS shapes.txt, ${skipped} routes skipped (will try stop-sequence fallback)`);

  // 5.5 Stream stop_times.txt — metro stop detection + fallback shape collection
  const metroChildStopIds = new Set();
  // routeFallbackStops: route_id → Map<trip_id, Array<[seq, stopId]>>
  const routeFallbackStops = new Map();

  if (metroTripIds.size > 0 || noShapeTripToRoute.size > 0) {
    const stEntry = zip.getEntry('stop_times.txt');
    if (stEntry) {
      console.log('\nStreaming stop_times.txt for metro detection + fallback shapes…');
      const stBuf   = stEntry.getData();
      const stGen   = iterLines(stBuf);
      const stHdrs  = parseHeaders(stGen.next().value);
      const iTripId = stHdrs.indexOf('trip_id');
      const iStId   = stHdrs.indexOf('stop_id');
      const iStSeq  = stHdrs.indexOf('stop_sequence');

      for (const line of stGen) {
        const cols = line.split(',');
        const tid  = cols[iTripId]?.trim();

        // Metro stop detection (for markerLabel in stops.json)
        if (metroTripIds.has(tid)) metroChildStopIds.add(cols[iStId]?.trim());

        // Fallback stop-sequence collection for no-shape routes
        const routeId = noShapeTripToRoute.get(tid);
        if (routeId) {
          const stopId = cols[iStId]?.trim();
          const seq    = parseInt(cols[iStSeq] ?? '', 10);
          if (stopId && !isNaN(seq)) {
            if (!routeFallbackStops.has(routeId)) routeFallbackStops.set(routeId, new Map());
            const tripMap = routeFallbackStops.get(routeId);
            if (!tripMap.has(tid)) tripMap.set(tid, []);
            tripMap.get(tid).push([seq, stopId]);
          }
        }
      }
      console.log(`  ${metroChildStopIds.size} unique child stop IDs served by metro`);
    }
  }

  // Pick best representative trip per no-shape route (most stop_time entries = most complete)
  const bestTripForRoute = new Map(); // route_id → Array<[seq, stopId]> sorted
  for (const [routeId, tripMap] of routeFallbackStops) {
    let bestStops = null, bestCount = -1;
    for (const stops of tripMap.values()) {
      if (stops.length > bestCount) { bestCount = stops.length; bestStops = stops; }
    }
    if (bestStops) {
      bestStops.sort((a, b) => a[0] - b[0]);
      bestTripForRoute.set(routeId, bestStops);
    }
  }
  if (bestTripForRoute.size > 0) {
    console.log(`  ${bestTripForRoute.size} no-shape routes have stop-sequence fallbacks ready`);
  }

  // 6. Parse stops.txt → write stops.json (all stop areas for the map)
  //    Includes childIds (for departure lookup) and markerLabel ('T' or 'H')
  console.log('\nParsing stops.txt…');
  const stopsBuf  = zip.getEntry('stops.txt').getData();
  const stopsGen  = iterLines(stopsBuf);
  const stopHdrs  = parseHeaders(stopsGen.next().value);
  const iStopId   = stopHdrs.indexOf('stop_id');
  const iStopName = stopHdrs.indexOf('stop_name');
  const iStopLat  = stopHdrs.indexOf('stop_lat');
  const iStopLon  = stopHdrs.indexOf('stop_lon');
  const iLocType  = stopHdrs.indexOf('location_type');
  const iParent   = stopHdrs.indexOf('parent_station');

  // First pass: build parent → children map (all stops with a parent_station)
  const parentToChildren = new Map(); // parentId → string[]
  const allStopRows = [];
  for (const line of stopsGen) {
    const cols = line.split(',');
    allStopRows.push(cols);
    const parent = cols[iParent]?.trim();
    const id     = cols[iStopId]?.trim();
    if (parent && id) {
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
      parentToChildren.get(parent).push(id);
    }
  }

  // Second pass: build stop list with childIds + markerLabel
  const stopList = [];
  for (const cols of allStopRows) {
    const locType = cols[iLocType]?.trim();
    const parent  = cols[iParent]?.trim();
    // Keep stop areas (location_type=1) OR standalone stops (no parent, location_type=0/"")
    if (locType === '1' || (!parent && (locType === '0' || locType === ''))) {
      const lat  = parseFloat(cols[iStopLat]);
      const lon  = parseFloat(cols[iStopLon]);
      const name = cols[iStopName]?.trim().replace(/^"|"$/g, '') ?? '';
      const id   = cols[iStopId]?.trim();
      if (!isNaN(lat) && !isNaN(lon) && id) {
        const childIds  = parentToChildren.get(id) ?? [];
        const isMetro   = childIds.some(c => metroChildStopIds.has(c));
        stopList.push({ id, name, lat, lng: lon, childIds, markerLabel: isMetro ? 'T' : 'H' });
      }
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'stops.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), stops: stopList }),
  );
  console.log(`  ${stopList.length} stops written to public/shapes/${CITY_ID}/stops.json`);

  // 7. Build fallback shape files from stop sequences (for routes without GTFS shape_id)
  if (bestTripForRoute.size > 0) {
    console.log('\nBuilding fallback shapes from stop sequences…');

    // stop_id → [lat, lng] — covers all stop location types (parents and children/quays)
    const stopCoords = new Map();
    for (const cols of allStopRows) {
      const id  = cols[iStopId]?.trim();
      const lat = parseFloat(cols[iStopLat]);
      const lon = parseFloat(cols[iStopLon]);
      if (id && !isNaN(lat) && !isNaN(lon)) stopCoords.set(id, [lat, lon]);
    }

    let fallbackWritten = 0;
    for (const [routeId, stopSeq] of bestTripForRoute) {
      const meta = routeMeta.get(routeId);
      if (!meta) continue;

      const coords = [];
      for (const [, stopId] of stopSeq) {
        const coord = stopCoords.get(stopId);
        if (coord) coords.push(coord);
      }
      if (coords.length < 2) continue;

      const { name, routeType } = meta;
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const owner = claimedFilenames.get(safeName);
      let filename;
      if (owner === undefined) {
        filename = `line-${safeName}.json`;
        claimedFilenames.set(safeName, routeType);
      } else if (owner === routeType) {
        filename = `line-${safeName}.json`;
      } else {
        filename = `line-${safeName}-t${routeType}.json`;
      }
      fs.writeFileSync(
        path.join(OUT_DIR, filename),
        JSON.stringify({ name, routeType, coordinates: coords }),
      );
      manifest.push({
        name,
        routeType,
        label: ROUTE_TYPE_LABELS[routeType] ?? `Type ${routeType}`,
        file:  filename,
        pointCount: coords.length,
      });
      fallbackWritten++;
    }
    console.log(`  ${fallbackWritten} fallback shape files written`);
  }

  // 8. Sort manifest and write manifest.json
  manifest.sort((a, b) => {
    if (a.routeType !== b.routeType) return a.routeType - b.routeType;
    return a.name.localeCompare(b.name, 'sv', { numeric: true });
  });

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), lines: manifest }, null, 2),
  );

  console.log(`\nTotal: ${manifest.length} lines in manifest.json`);
  console.log('\nRoute type breakdown:');
  const byType = {};
  for (const m of manifest) byType[m.label] = (byType[m.label] ?? 0) + 1;
  for (const [label, count] of Object.entries(byType).sort()) {
    console.log(`  ${label}: ${count}`);
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
