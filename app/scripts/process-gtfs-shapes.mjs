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
  const manifest = [];
  let written = 0, skipped = 0;

  for (const [routeId, { name, routeType }] of routeMeta) {
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
    const filename  = `line-${safeName}.json`;

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

  // Sort manifest: trams first, then by name
  manifest.sort((a, b) => {
    if (a.routeType !== b.routeType) return a.routeType - b.routeType;
    return a.name.localeCompare(b.name, 'sv', { numeric: true });
  });

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), lines: manifest }, null, 2),
  );

  console.log(`\nDone: ${written} shape files written to public/shapes/`);
  console.log(`Skipped: ${skipped} routes (no shape data)`);
  console.log(`\nRoute type breakdown:`);
  const byType = {};
  for (const m of manifest) byType[m.label] = (byType[m.label] ?? 0) + 1;
  for (const [label, count] of Object.entries(byType).sort()) {
    console.log(`  ${label}: ${count}`);
  }

  // 5.5 Stream stop_times.txt → find child stop IDs served by metro routes
  //     (only run if there are metro trips — skipped for Göteborg which has none)
  const metroChildStopIds = new Set();
  if (metroTripIds.size > 0) {
    const stEntry = zip.getEntry('stop_times.txt');
    if (stEntry) {
      console.log('\nStreaming stop_times.txt for metro stop detection…');
      const stBuf  = stEntry.getData();
      const stGen  = iterLines(stBuf);
      const stHdrs = parseHeaders(stGen.next().value);
      const iTripId = stHdrs.indexOf('trip_id');
      const iStId   = stHdrs.indexOf('stop_id');
      for (const line of stGen) {
        const cols = line.split(',');
        const tid  = cols[iTripId]?.trim();
        if (metroTripIds.has(tid)) metroChildStopIds.add(cols[iStId]?.trim());
      }
      console.log(`  ${metroChildStopIds.size} unique child stop IDs served by metro`);
    }
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
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
