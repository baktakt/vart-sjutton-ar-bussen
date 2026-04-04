import type { VTVehicle } from '@/types/vasttrafik';

const API_BASE = process.env.VASTTRAFIK_API_BASE ?? 'https://ext-api.vasttrafik.se/pr/v4';

const BBOX = {
  lowerLeftLat:   Number(process.env.BBOX_LOWER_LEFT_LAT  ?? 57.55),
  lowerLeftLong:  Number(process.env.BBOX_LOWER_LEFT_LONG ?? 11.75),
  upperRightLat:  Number(process.env.BBOX_UPPER_RIGHT_LAT ?? 57.85),
  upperRightLong: Number(process.env.BBOX_UPPER_RIGHT_LONG ?? 12.30),
};

export async function fetchPositions(token: string): Promise<VTVehicle[]> {
  const params = new URLSearchParams({
    lowerLeftLat:   String(BBOX.lowerLeftLat),
    lowerLeftLong:  String(BBOX.lowerLeftLong),
    upperRightLat:  String(BBOX.upperRightLat),
    upperRightLong: String(BBOX.upperRightLong),
  });

  const res = await fetch(`${API_BASE}/positions?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`/positions failed: ${res.status}`);

  const data = await res.json();
  return Array.isArray(data) ? data : (data.results ?? data.vehicles ?? []);
}
