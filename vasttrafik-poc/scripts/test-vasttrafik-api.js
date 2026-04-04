import 'dotenv/config';

// Token and API base URLs are provided after registration at developer.vasttrafik.se
// Defaults match the standard ext-api endpoint — override if yours differ.
const TOKEN_URL   = process.env.VASTTRAFIK_TOKEN_URL ?? 'https://ext-api.vasttrafik.se/token';
const API_BASE    = process.env.VASTTRAFIK_API_URL   ?? 'https://ext-api.vasttrafik.se/pr/v4';

// Bounding box covering central Gothenburg — widen if you want more vehicles
const BBOX = {
  lowerLeftLat:  57.47,
  lowerLeftLong: 11.77,
  upperRightLat: 57.78,
  upperRightLong: 12.20,
};

async function getToken(clientId, clientSecret) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token request failed: HTTP ${res.status} — ${body}`);
  }

  const json = await res.json();
  return json.access_token;
}

async function main() {
  const clientId     = process.env.VASTTRAFIK_CLIENT_ID;
  const clientSecret = process.env.VASTTRAFIK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('ERROR: VASTTRAFIK_CLIENT_ID and VASTTRAFIK_CLIENT_SECRET must be set in .env');
    console.error('Register at https://developer.vasttrafik.se to get credentials.');
    process.exit(1);
  }

  console.log('Fetching OAuth2 token...');
  const token = await getToken(clientId, clientSecret);
  console.log('Token acquired.\n');

  // The public docs are ambiguous — some examples show separate lat/long params,
  // others show compound lowerLeft/upperRight. Try both if the first returns an error.
  async function fetchPositions(token, paramStyle) {
    const params = paramStyle === 'compound'
      ? new URLSearchParams({
          lowerLeft:  `${BBOX.lowerLeftLat},${BBOX.lowerLeftLong}`,
          upperRight: `${BBOX.upperRightLat},${BBOX.upperRightLong}`,
        })
      : new URLSearchParams({
          lowerLeftLat:   BBOX.lowerLeftLat,
          lowerLeftLong:  BBOX.lowerLeftLong,
          upperRightLat:  BBOX.upperRightLat,
          upperRightLong: BBOX.upperRightLong,
        });
    const url = `${API_BASE}/positions?${params}`;
    console.log(`Trying param style "${paramStyle}": ${url.replace(API_BASE, '')}`);
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  console.log(`Fetching /positions...`);
  console.log(`Bounding box: lat ${BBOX.lowerLeftLat}–${BBOX.upperRightLat}, lng ${BBOX.lowerLeftLong}–${BBOX.upperRightLong}\n`);

  let res = await fetchPositions(token, 'separate');

  // Fall back to compound params if the API rejects the separate style
  if (!res.ok && res.status !== 404) {
    console.log(`  → HTTP ${res.status}, retrying with compound params...\n`);
    res = await fetchPositions(token, 'compound');
  }

  if (res.status === 404) {
    console.log('NO VEHICLE POSITIONS AVAILABLE (404)');
    process.exit(0);
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`ERROR: HTTP ${res.status} — ${body}`);
    process.exit(1);
  }

  const data = await res.json();

  // The response may be an array directly or wrapped in a results/data field
  const vehicles = Array.isArray(data) ? data : (data.results ?? data.data ?? data.positions ?? [data]);

  console.log(`Total vehicles in bounding box: ${vehicles.length}\n`);

  // --- Sample 3 vehicles ---
  console.log('=== Sample vehicles (first 3) ===');
  for (const v of vehicles.slice(0, 3)) {
    console.log(JSON.stringify(v, null, 2));
    console.log('---');
  }

  // --- Breakdown by transport mode ---
  const modeCounts = {};
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const v of vehicles) {
    const mode = v.transportMode ?? v.line?.transportMode ?? v.vehicleType ?? 'unknown';
    modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;

    const lat = v.lat ?? v.latitude ?? v.position?.latitude;
    const lng = v.long ?? v.longitude ?? v.position?.longitude;
    if (lat != null && lng != null) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  console.log('\n=== Breakdown by transport mode ===');
  for (const [mode, count] of Object.entries(modeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${mode}: ${count}`);
  }

  if (minLat !== Infinity) {
    console.log('\n=== Actual bounding box of returned positions ===');
    console.log(`  Lat: ${minLat.toFixed(5)} → ${maxLat.toFixed(5)}`);
    console.log(`  Lng: ${minLng.toFixed(5)} → ${maxLng.toFixed(5)}`);
  }

  // --- Inspect what fields are available ---
  if (vehicles.length > 0) {
    console.log('\n=== Available fields on a vehicle object ===');
    console.log(Object.keys(vehicles[0]).join(', '));
  }
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
