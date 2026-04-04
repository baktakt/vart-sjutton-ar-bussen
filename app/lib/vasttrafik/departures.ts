import type { VTDeparture } from '@/types/vasttrafik';

const API_BASE = process.env.VASTTRAFIK_API_BASE ?? 'https://ext-api.vasttrafik.se/pr/v4';

export async function fetchDepartures(
  token: string,
  stopAreaGid: string,
  limit = 60,
): Promise<VTDeparture[]> {
  const params = new URLSearchParams({ limit: String(limit) });

  const res = await fetch(`${API_BASE}/stop-areas/${stopAreaGid}/departures?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`/stop-areas/${stopAreaGid}/departures failed: ${res.status}`);

  const data = await res.json();
  return data.results ?? (Array.isArray(data) ? data : []);
}
