const TOKEN_URL = process.env.VASTTRAFIK_TOKEN_URL ?? 'https://ext-api.vasttrafik.se/token';

let cached: { token: string; expiresAt: number } | null = null;

export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  const clientId     = process.env.VASTTRAFIK_CLIENT_ID;
  const clientSecret = process.env.VASTTRAFIK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('VASTTRAFIK_CLIENT_ID / VASTTRAFIK_CLIENT_SECRET not configured');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };

  return cached.token;
}
