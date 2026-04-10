import type { VTStopArea } from '@/types/vasttrafik';

const API_BASE = process.env.VASTTRAFIK_API_BASE ?? 'https://ext-api.vasttrafik.se/pr/v4';

export async function getNearestStopArea(
  token: string,
  lat: number,
  lng: number,
  radiusMeters = 400,
): Promise<VTStopArea | null> {
  const params = new URLSearchParams({
    latitude:         String(lat),
    longitude:        String(lng),
    radiusInMeters:   String(radiusMeters),
    limit:            '1',
    types:            'stoparea',
  });

  const res = await fetch(`${API_BASE}/locations/by-coordinates?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    // Stop areas don't move — cache for 24 h cross-instance, matching the module-level cache.
    next: { revalidate: 86_400 },
  });

  if (!res.ok) throw new Error(`/locations/by-coordinates failed: ${res.status}`);

  const data = await res.json();
  const areas: VTStopArea[] = data.stopAreas ?? data.results ?? (Array.isArray(data) ? data : []);
  return areas[0] ?? null;
}
