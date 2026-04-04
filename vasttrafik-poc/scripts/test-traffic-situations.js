import 'dotenv/config';

const TOKEN_URL = process.env.VASTTRAFIK_TOKEN_URL ?? 'https://ext-api.vasttrafik.se/token';
const TS_BASE   = 'https://ext-api.vasttrafik.se/ts/v1';

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

  const res = await fetch(`${TS_BASE}/traffic-situations`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(`ERROR: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const situations = await res.json();
  console.log(`Total active/future traffic situations: ${situations.length}\n`);

  // --- Severity breakdown ---
  const bySeverity = {};
  for (const s of situations) {
    const sev = s.severity ?? 'unknown';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }
  console.log('=== Severity breakdown ===');
  for (const [sev, count] of Object.entries(bySeverity).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sev}: ${count}`);
  }

  // --- Affected lines summary ---
  const lineHits = {};
  for (const s of situations) {
    for (const l of s.affectedLines ?? []) {
      const key = l.designation ?? l.name ?? l.gid;
      lineHits[key] = (lineHits[key] ?? 0) + 1;
    }
  }
  const topLines = Object.entries(lineHits).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('\n=== Most-affected lines (top 10) ===');
  for (const [line, count] of topLines) {
    console.log(`  Line ${line}: ${count} situation(s)`);
  }

  // --- Sample 3 situations ---
  console.log('\n=== Sample situations (first 3) ===');
  for (const s of situations.slice(0, 3)) {
    console.log(JSON.stringify(s, null, 2));
    console.log('---');
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
