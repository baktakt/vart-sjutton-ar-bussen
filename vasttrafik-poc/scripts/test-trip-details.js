import 'dotenv/config';

const TOKEN_URL = process.env.VASTTRAFIK_TOKEN_URL ?? 'https://ext-api.vasttrafik.se/token';
const PR_BASE   = process.env.VASTTRAFIK_API_URL   ?? 'https://ext-api.vasttrafik.se/pr/v4';

// Gothenburg central bbox for /positions
const BBOX = { lowerLeftLat: 57.47, lowerLeftLong: 11.77, upperRightLat: 57.78, upperRightLong: 12.20 };

async function getToken(clientId, clientSecret) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function apiFetch(token, path) {
  const res = await fetch(`${PR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path} → HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

function diffMinutes(plannedStr, estimatedStr) {
  if (!plannedStr || !estimatedStr) return null;
  const diff = (new Date(estimatedStr) - new Date(plannedStr)) / 1000 / 60;
  return Math.round(diff * 10) / 10;
}

async function probeVehicle(token, vehicle, index) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Vehicle ${index + 1}: Line ${vehicle.line?.name} (${vehicle.line?.transportMode}) → ${vehicle.direction}`);
  console.log(`  Position:         ${vehicle.latitude}, ${vehicle.longitude}`);
  console.log(`  detailsReference: ${vehicle.detailsReference}`);
  console.log(`  isRealtimeJourney: ${vehicle.line?.isRealtimeJourney}`);

  // Step 1: find nearest stop area
  const locPath = `/locations/by-coordinates?latitude=${vehicle.latitude}&longitude=${vehicle.longitude}&radiusInMeters=400&limit=5&types=stoparea`;
  let stopAreas;
  try {
    const locData = await apiFetch(token, locPath);
    stopAreas = locData.stopAreas ?? locData.results ?? locData ?? [];
  } catch (e) {
    console.log(`  ⚠ /locations/by-coordinates failed: ${e.message}`);
    return;
  }

  if (stopAreas.length === 0) {
    console.log('  No stop areas within 400m — vehicle may be between stops');
    return;
  }

  console.log(`\n  Nearby stop areas (${stopAreas.length} found):`);
  for (const sa of stopAreas.slice(0, 3)) {
    console.log(`    - [${sa.gid}] ${sa.name} (${sa.distanceInMeters ?? '?'}m)`);
  }

  // Step 2: query departures for each nearby stop area and look for this vehicle
  let matched = null;
  for (const sa of stopAreas) {
    const depPath = `/stop-areas/${sa.gid}/departures?limit=30&includeOccupancy=false`;
    let depData;
    try {
      depData = await apiFetch(token, depPath);
    } catch (e) {
      console.log(`  ⚠ departures for ${sa.gid} failed: ${e.message}`);
      continue;
    }

    const departures = depData.results ?? depData ?? [];
    const dep = departures.find(d => d.detailsReference === vehicle.detailsReference);

    if (dep) {
      matched = { stopArea: sa, departure: dep };
      console.log(`\n  ✓ Matched departure at stop area: ${sa.name}`);
      break;
    }

    // Fallback: match by line name if no exact detailsReference match
    if (!matched) {
      const lineMatch = departures.find(d => d.serviceJourney?.line?.designation === vehicle.line?.name
        || d.serviceJourney?.line?.name === vehicle.line?.name);
      if (lineMatch) {
        matched = { stopArea: sa, departure: lineMatch, fuzzy: true };
      }
    }
  }

  if (!matched) {
    console.log('\n  No matching departure found in nearby stop areas');

    // Step 3 fallback: try /journeys/{detailsReference}/details directly
    console.log('  Trying /journeys/{detailsReference}/details directly...');
    try {
      const details = await apiFetch(token, `/journeys/${vehicle.detailsReference}/details`);
      console.log('  Journey details fields:', Object.keys(details).join(', '));
      console.log(JSON.stringify(details, null, 2));
    } catch (e) {
      console.log(`  ⚠ /journeys/{ref}/details failed: ${e.message}`);
    }
    return;
  }

  const { stopArea, departure, fuzzy } = matched;
  if (fuzzy) console.log(`\n  ~ Fuzzy line match at stop area: ${stopArea.name} (detailsReference didn't match)`);

  console.log('\n  Full departure object:');
  console.log(JSON.stringify(departure, null, 2));

  // Step 4: compute delay
  const planned   = departure.plannedTime   ?? departure.serviceJourney?.plannedDepartureTime;
  const estimated = departure.estimatedTime ?? departure.serviceJourney?.estimatedDepartureTime;
  const isCancelled = departure.isCancelled ?? false;

  console.log('\n  === Delay calculation ===');
  console.log(`  Planned:   ${planned   ?? 'N/A'}`);
  console.log(`  Estimated: ${estimated ?? 'N/A'}`);
  console.log(`  Cancelled: ${isCancelled}`);

  if (isCancelled) {
    console.log('  → CANCELLED');
  } else {
    const delay = diffMinutes(planned, estimated);
    if (delay === null) {
      console.log('  → No realtime data available for this departure');
    } else if (delay > 1) {
      console.log(`  → LATE by ${delay} min`);
    } else if (delay < -1) {
      console.log(`  → EARLY by ${Math.abs(delay)} min`);
    } else {
      console.log(`  → ON TIME (${delay} min)`);
    }
  }
}

async function main() {
  const clientId     = process.env.VASTTRAFIK_CLIENT_ID;
  const clientSecret = process.env.VASTTRAFIK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('ERROR: VASTTRAFIK_CLIENT_ID / VASTTRAFIK_CLIENT_SECRET not set');
    process.exit(1);
  }

  console.log('Fetching OAuth2 token...');
  const token = await getToken(clientId, clientSecret);
  console.log('Token acquired.\n');

  // Get live vehicles
  console.log('Fetching live vehicle positions...');
  const params = new URLSearchParams(BBOX);
  const posRes = await fetch(`${PR_BASE}/positions?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!posRes.ok) throw new Error(`/positions failed: ${posRes.status}`);
  const vehicles = await posRes.json();

  // Pick 3 diverse samples: prefer isRealtimeJourney=true first, then mix modes
  const realtime = vehicles.filter(v => v.line?.isRealtimeJourney);
  const rest     = vehicles.filter(v => !v.line?.isRealtimeJourney);
  const samples  = [...realtime.slice(0, 2), ...rest.slice(0, 1)].slice(0, 3);

  console.log(`Total vehicles: ${vehicles.length}  |  isRealtimeJourney=true: ${realtime.length}`);
  console.log(`Probing ${samples.length} vehicles (prioritising realtime ones)...\n`);

  for (let i = 0; i < samples.length; i++) {
    await probeVehicle(token, samples[i], i);
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('If departures show plannedTime + estimatedTime → delay is computable per vehicle.');
  console.log('If only plannedTime → positions-only mode, no delay visualisation possible.');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
