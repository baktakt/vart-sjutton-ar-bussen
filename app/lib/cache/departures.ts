import type { VTDeparture } from '@/types/vasttrafik';

// 30s TTL — aligns with 15s client poll interval, allows one stale cycle.
const TTL_MS = 30_000;
const cache = new Map<string, { departures: VTDeparture[]; fetchedAt: number }>();

export function getCachedDepartures(stopAreaGid: string): VTDeparture[] | null {
  const entry = cache.get(stopAreaGid);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) { cache.delete(stopAreaGid); return null; }
  return entry.departures;
}

export function setCachedDepartures(stopAreaGid: string, departures: VTDeparture[]): void {
  cache.set(stopAreaGid, { departures, fetchedAt: Date.now() });
}
