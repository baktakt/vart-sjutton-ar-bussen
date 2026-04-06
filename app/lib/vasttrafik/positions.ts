import type { VTVehicle } from '@/types/vasttrafik';

const API_BASE = process.env.VASTTRAFIK_API_BASE ?? 'https://ext-api.vasttrafik.se/pr/v4';

const DEFAULT_BBOX = {
  lowerLeftLat:   Number(process.env.BBOX_LOWER_LEFT_LAT   ?? 57.55),
  lowerLeftLong:  Number(process.env.BBOX_LOWER_LEFT_LONG  ?? 11.75),
  upperRightLat:  Number(process.env.BBOX_UPPER_RIGHT_LAT  ?? 57.85),
  upperRightLong: Number(process.env.BBOX_UPPER_RIGHT_LONG ?? 12.30),
};

export interface BBox {
  lowerLeftLat: number;
  lowerLeftLong: number;
  upperRightLat: number;
  upperRightLong: number;
}

export async function fetchPositions(token: string, bbox?: BBox): Promise<VTVehicle[]> {
  const box = bbox ?? DEFAULT_BBOX;
  const params = new URLSearchParams({
    lowerLeftLat:   String(box.lowerLeftLat),
    lowerLeftLong:  String(box.lowerLeftLong),
    upperRightLat:  String(box.upperRightLat),
    upperRightLong: String(box.upperRightLong),
  });

  const res = await fetch(`${API_BASE}/positions?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`/positions failed: ${res.status}`);

  const data = await res.json();
  return Array.isArray(data) ? data : (data.results ?? data.vehicles ?? []);
}
