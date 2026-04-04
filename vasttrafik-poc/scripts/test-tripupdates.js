import 'dotenv/config';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
const { transit_realtime } = GtfsRealtimeBindings;

async function main() {
  const key = process.env.TRAFIKLAB_RT_KEY;
  if (!key) {
    console.error('ERROR: TRAFIKLAB_RT_KEY not set in .env');
    process.exit(1);
  }

  const url = `https://opendata.samtrafiken.se/gtfs-rt/vt/TripUpdates.pb?key=${key}`;
  console.log('Fetching TripUpdates.pb...');
  console.log(`URL: ${url.replace(key, '***')}\n`);

  const res = await fetch(url);

  if (res.status === 404) {
    console.log('NO TRIPUPDATES AVAILABLE (404)');
    process.exit(0);
  }

  if (!res.ok) {
    console.error(`ERROR: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  console.log(`Received: ${(bytes.length / 1024).toFixed(1)} KB\n`);

  const feed = transit_realtime.FeedMessage.decode(bytes);

  const ts = feed.header.timestamp;
  const feedTime = ts ? new Date(Number(ts) * 1000).toISOString() : 'unknown';
  console.log(`Feed timestamp: ${feedTime}`);
  console.log(`Total entities: ${feed.entity.length}\n`);

  // --- Sample 3 entities ---
  console.log('=== Sample entities (first 3) ===');
  for (const entity of feed.entity.slice(0, 3)) {
    console.log(JSON.stringify(entity, null, 2));
    console.log('---');
  }

  // --- Delay distribution ---
  let late = 0, early = 0, onTime = 0;
  const routeCounts = {};

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    if (!tu) continue;

    const routeId = tu.trip?.routeId;
    if (routeId) {
      routeCounts[routeId] = (routeCounts[routeId] ?? 0) + 1;
    }

    for (const stu of tu.stopTimeUpdate ?? []) {
      const delay = stu.departure?.delay ?? stu.arrival?.delay;
      if (delay == null) continue;
      if (delay > 60) late++;
      else if (delay < -60) early++;
      else onTime++;
    }
  }

  console.log('\n=== Delay distribution (per stop-time update) ===');
  console.log(`  Late  (delay > 60s):  ${late}`);
  console.log(`  Early (delay < -60s): ${early}`);
  console.log(`  On time:              ${onTime}`);

  // --- Top 10 route_ids ---
  const topRoutes = Object.entries(routeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log('\n=== Top 10 route_ids by entity count ===');
  for (const [routeId, count] of topRoutes) {
    console.log(`  ${routeId}: ${count} trip updates`);
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
