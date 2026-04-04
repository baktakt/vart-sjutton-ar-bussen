import 'dotenv/config';
import AdmZip from 'adm-zip';

const ROUTE_TYPE_NAMES = {
  0: 'Tram/Spårvagn (0)',
  1: 'Subway/Tunnelbana (1)',
  2: 'Rail/Tåg (2)',
  3: 'Bus (3)',
  100: 'Rail/Tåg (100)',
  700: 'Bus (700)',
  900: 'Tram/Spårvagn (900)',
  1000: 'Boat (1000)',
  1200: 'Ferry (1200)',
};

function parseCsv(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });
}

async function main() {
  const key = process.env.TRAFIKLAB_STATIC_KEY;
  if (!key) {
    console.error('ERROR: TRAFIKLAB_STATIC_KEY not set in .env');
    process.exit(1);
  }

  const url = `https://opendata.samtrafiken.se/gtfs/vt/vt.zip?key=${key}`;
  console.log('Downloading vt.zip...');
  console.log(`URL: ${url.replace(key, '***')}\n`);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`ERROR: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const buffer = await res.arrayBuffer();
  const bytes = Buffer.from(buffer);
  const sizeMB = (bytes.length / 1024 / 1024).toFixed(2);
  console.log(`Downloaded: ${sizeMB} MB\n`);

  const zip = new AdmZip(bytes);
  const entries = zip.getEntries().map(e => e.entryName);
  console.log('Files in zip:', entries.join(', '), '\n');

  // --- routes.txt ---
  const routesEntry = zip.getEntry('routes.txt');
  if (!routesEntry) {
    console.error('ERROR: routes.txt not found in zip');
    process.exit(1);
  }
  const routes = parseCsv(routesEntry.getData().toString('utf8'));
  console.log(`Total routes: ${routes.length}`);

  const byType = {};
  for (const r of routes) {
    const t = r.route_type ?? 'unknown';
    if (!byType[t]) byType[t] = [];
    byType[t].push(r);
  }

  console.log('\n=== Route breakdown by route_type ===');
  for (const [type, list] of Object.entries(byType).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const name = ROUTE_TYPE_NAMES[type] ?? `Unknown type (${type})`;
    console.log(`\n  ${name}: ${list.length} routes`);
    const samples = list.slice(0, 3);
    for (const r of samples) {
      const label = r.route_short_name || r.route_long_name || r.route_id;
      console.log(`    - [${r.route_id}] ${label}`);
    }
    if (list.length > 3) console.log(`    ... and ${list.length - 3} more`);
  }

  // --- stops.txt ---
  console.log('\n=== stops.txt ===');
  const stopsEntry = zip.getEntry('stops.txt');
  if (stopsEntry) {
    const stops = parseCsv(stopsEntry.getData().toString('utf8'));
    console.log(`  Total stops: ${stops.length}`);
  } else {
    console.log('  stops.txt NOT FOUND');
  }

  // --- trips.txt ---
  console.log('\n=== trips.txt ===');
  const tripsEntry = zip.getEntry('trips.txt');
  if (tripsEntry) {
    const trips = parseCsv(tripsEntry.getData().toString('utf8'));
    console.log(`  Total trips: ${trips.length}`);
  } else {
    console.log('  trips.txt NOT FOUND');
  }

  // --- shapes.txt ---
  console.log('\n=== shapes.txt ===');
  const shapesEntry = zip.getEntry('shapes.txt');
  if (shapesEntry) {
    const shapes = parseCsv(shapesEntry.getData().toString('utf8'));
    console.log(`  EXISTS — ${shapes.length} rows`);
  } else {
    console.log('  NOT FOUND (shapes not included in this feed)');
  }

  // --- stop_times.txt ---
  console.log('\n=== stop_times.txt ===');
  const stopTimesEntry = zip.getEntry('stop_times.txt');
  if (stopTimesEntry) {
    const text = stopTimesEntry.getData().toString('utf8');
    const rows = text.split('\n').filter(l => l.trim()).length - 1;
    console.log(`  EXISTS — ${rows} rows`);
  } else {
    console.log('  NOT FOUND');
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Zip size:      ${sizeMB} MB`);
  console.log(`  Routes:        ${routes.length}`);
  console.log(`  Route types:   ${Object.keys(byType).join(', ')}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
