import 'dotenv/config';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
const { transit_realtime } = GtfsRealtimeBindings;

const VEHICLE_TYPE_NAMES = {
  0: 'Tram/Spårvagn',
  1: 'Subway/Tunnelbana',
  2: 'Rail/Tåg',
  3: 'Bus',
  4: 'Ferry',
  5: 'Cable Tram',
  6: 'Aerial Lift',
  7: 'Funicular',
  11: 'Trolleybus',
  12: 'Monorail',
  100: 'Rail/Tåg',
  700: 'Bus',
  900: 'Tram/Spårvagn',
  1000: 'Boat',
  1200: 'Ferry',
};

async function main() {
  const key = process.env.TRAFIKLAB_RT_KEY;
  if (!key) {
    console.error('ERROR: TRAFIKLAB_RT_KEY not set in .env');
    process.exit(1);
  }

  const url = `https://opendata.samtrafiken.se/gtfs-rt/vt/VehiclePositions.pb?key=${key}`;
  console.log('Fetching VehiclePositions.pb...');
  console.log(`URL: ${url.replace(key, '***')}\n`);

  const res = await fetch(url);

  if (res.status === 404) {
    console.log('NO VEHICLE POSITIONS AVAILABLE');
    console.log('→ App will use TripUpdates-only mode (delay per stop, interpolated positions)');
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
  console.log(`Total vehicles: ${feed.entity.length}\n`);

  // --- Sample 3 vehicles ---
  console.log('=== Sample vehicles (first 3) ===');
  for (const entity of feed.entity.slice(0, 3)) {
    console.log(JSON.stringify(entity, null, 2));
    console.log('---');
  }

  // --- Breakdown by route_type / vehicle type ---
  const typeCounts = {};
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  let posCount = 0;

  for (const entity of feed.entity) {
    const vp = entity.vehicle;
    if (!vp) continue;

    const routeType = vp.trip?.routeType ?? vp.vehicle?.type ?? 'unknown';
    typeCounts[routeType] = (typeCounts[routeType] ?? 0) + 1;

    const pos = vp.position;
    if (pos?.latitude != null && pos?.longitude != null) {
      posCount++;
      if (pos.latitude < minLat) minLat = pos.latitude;
      if (pos.latitude > maxLat) maxLat = pos.latitude;
      if (pos.longitude < minLng) minLng = pos.longitude;
      if (pos.longitude > maxLng) maxLng = pos.longitude;
    }
  }

  console.log('\n=== Breakdown by vehicle/route type ===');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    const name = VEHICLE_TYPE_NAMES[type] ?? `Unknown (${type})`;
    console.log(`  ${name}: ${count}`);
  }

  if (posCount > 0) {
    console.log('\n=== Bounding box of all positions ===');
    console.log(`  Lat: ${minLat.toFixed(5)} → ${maxLat.toFixed(5)}`);
    console.log(`  Lng: ${minLng.toFixed(5)} → ${maxLng.toFixed(5)}`);
    console.log(`  (${posCount} vehicles with position data)`);
  } else {
    console.log('\n  No position data found in entities.');
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
