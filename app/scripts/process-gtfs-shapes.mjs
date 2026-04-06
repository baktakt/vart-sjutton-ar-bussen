#!/usr/bin/env node
/**
 * scripts/process-gtfs-shapes.mjs
 *
 * Downloads the Västtrafik GTFS static feed, extracts per-line shape files
 * to public/shapes/, and writes a manifest.json.
 *
 * Run manually whenever Västtrafik publishes a new GTFS feed (~quarterly):
 *   node scripts/process-gtfs-shapes.mjs
 *
 * Requires TRAFIKLAB_STATIC_KEY in .env.local
 */

import 'dotenv/config';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = path.resolve(__dirname, '..', 'public', 'shapes');

const ROUTE_TYPE_LABELS = {
  100:  'Train',
  700:  'Bus',
  900:  'Tram',
  1000: 'Boat',
  1200: 'Ferry',
};

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

  // 1. Download zip
  const url = `https://opendata.samtrafiken.se/gtfs/vt/vt.zip?key=${key}`;
  console.log('Downloading vt.zip…');
  const res = await fetch(url);
  if (!res.ok) { console.error(`HTTP ${res.status}`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const zip = new AdmZip(buf);

  // 2. Parse routes.txt → collect non-skipped routes
  console.log('Parsing routes.txt…');
  const routesBuf = zip.getEntry('routes.txt').getData();
  const routes     = parseFull(routesBuf);

  // Map: route_id → { name, routeType }
  const routeMeta = new Map();
  for (const r of routes) {
    const type = Number(r.route_type);
    if (SKIP_TYPES.has(type)) continue;
    routeMeta.set(r.route_id, {
      name:      r.route_short_name || r.route_long_name || r.route_id,
      routeType: type,
    });
  }
  console.log(`  ${routeMeta.size} routes (skipped ${routes.length - routeMeta.size} demand-responsive)`);

  // 3. Parse trips.txt → collect shape_ids per route, tracking point count
  //    We need both: wanted shape_ids, and which route each belongs to.
  console.log('Parsing trips.txt…');
  const tripsBuf = zip.getEntry('trips.txt').getData();
  const trips    = parseFull(tripsBuf);

  // shapeRoutes: shape_id → route_id (first route seen — shapes are route-specific)
  const shapeRoutes   = new Map(); // shape_id → route_id
  const routeShapeIds = new Map(); // route_id → Set<shape_id>

  for (const t of trips) {
    if (!t.shape_id || !routeMeta.has(t.route_id)) continue;
    shapeRoutes.set(t.shape_id, t.route_id);
    if (!routeShapeIds.has(t.route_id)) routeShapeIds.set(t.route_id, new Set());
    routeShapeIds.get(t.route_id).add(t.shape_id);
  }

  const wantedShapeIds = new Set(shapeRoutes.keys());
  console.log(`  ${wantedShapeIds.size} unique shape_ids across ${routeShapeIds.size} routes`);

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
  fs.mkdirSync(OUT_DIR, { recursive: true });

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

  // 6. Parse stops.txt → write stops.json (all stop areas for the map)
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

  const stopList = [];
  for (const line of stopsGen) {
    const cols     = line.split(',');
    const locType  = cols[iLocType]?.trim();
    const parent   = cols[iParent]?.trim();
    // Keep stop areas (location_type=1) OR standalone stops (no parent, location_type=0/"")
    if (locType === '1' || (!parent && (locType === '0' || locType === ''))) {
      const lat  = parseFloat(cols[iStopLat]);
      const lon  = parseFloat(cols[iStopLon]);
      const name = cols[iStopName]?.trim().replace(/^"|"$/g, '') ?? '';
      if (!isNaN(lat) && !isNaN(lon)) {
        stopList.push({ id: cols[iStopId]?.trim(), name, lat, lng: lon });
      }
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'stops.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), stops: stopList }),
  );
  console.log(`  ${stopList.length} stops written to public/shapes/stops.json`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
