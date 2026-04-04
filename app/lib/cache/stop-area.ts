// 24h TTL — stop areas don't move. Keyed by quantized lat/lng (3 dp ≈ 111m grid).
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { gid: string; fetchedAt: number }>();

export function positionKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export function getCachedStopArea(lat: number, lng: number): string | null {
  const entry = cache.get(positionKey(lat, lng));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) { cache.delete(positionKey(lat, lng)); return null; }
  return entry.gid;
}

export function setCachedStopArea(lat: number, lng: number, gid: string): void {
  cache.set(positionKey(lat, lng), { gid, fetchedAt: Date.now() });
}
