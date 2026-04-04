import { getToken }         from '@/lib/vasttrafik/token';
import { fetchPositions }   from '@/lib/vasttrafik/positions';
import { getNearestStopArea } from '@/lib/vasttrafik/locations';
import { fetchDepartures }  from '@/lib/vasttrafik/departures';
import { getCachedStopArea, setCachedStopArea, positionKey } from '@/lib/cache/stop-area';
import { getCachedDepartures, setCachedDepartures }          from '@/lib/cache/departures';
import type { EnrichedVehicle, VehiclesResponse }            from '@/types/vasttrafik';

export async function getEnrichedVehicles(): Promise<VehiclesResponse> {
  const errors: string[] = [];
  const token = await getToken();

  // 1. Fetch all live vehicles
  const vehicles = await fetchPositions(token);

  // 2. Collect unique quantized positions → resolve stop area GIDs (parallel, cached)
  const uniqueKeys = [...new Set(vehicles.map(v => positionKey(v.latitude, v.longitude)))];

  const stopAreaByKey = new Map<string, string | null>();
  await Promise.all(uniqueKeys.map(async (key) => {
    const cached = getCachedStopArea(...key.split(',').map(Number) as [number, number]);
    if (cached) { stopAreaByKey.set(key, cached); return; }

    try {
      const [lat, lng] = key.split(',').map(Number);
      const area = await getNearestStopArea(token, lat, lng);
      if (area) {
        setCachedStopArea(lat, lng, area.gid);
        stopAreaByKey.set(key, area.gid);
      } else {
        stopAreaByKey.set(key, null);
      }
    } catch (e) {
      errors.push(`Stop area lookup failed for ${key}: ${(e as Error).message}`);
      stopAreaByKey.set(key, null);
    }
  }));

  // 3. Fetch departures for each unique stop area GID (parallel, cached)
  const uniqueGids = [...new Set([...stopAreaByKey.values()].filter(Boolean))] as string[];

  const departuresByGid = new Map<string, Awaited<ReturnType<typeof fetchDepartures>>>();
  await Promise.all(uniqueGids.map(async (gid) => {
    const cached = getCachedDepartures(gid);
    if (cached) { departuresByGid.set(gid, cached); return; }

    try {
      const deps = await fetchDepartures(token, gid);
      setCachedDepartures(gid, deps);
      departuresByGid.set(gid, deps);
    } catch (e) {
      errors.push(`Departures failed for ${gid}: ${(e as Error).message}`);
      departuresByGid.set(gid, []);
    }
  }));

  // 4. Enrich each vehicle with delay
  const enriched: EnrichedVehicle[] = vehicles.map(v => {
    const key        = positionKey(v.latitude, v.longitude);
    const gid        = stopAreaByKey.get(key) ?? null;
    const departures = gid ? (departuresByGid.get(gid) ?? []) : [];
    const dep        = departures.find(d => d.detailsReference === v.detailsReference);

    let delayMinutes: number | null = null;
    let isCancelled = false;
    let nextStopName: string | null = null;

    if (dep) {
      isCancelled  = dep.isCancelled;
      nextStopName = dep.stopPoint?.name ?? null;
      if (dep.estimatedTime) {
        delayMinutes = Math.round(
          (new Date(dep.estimatedTime).getTime() - new Date(dep.plannedTime).getTime()) / 60_000 * 10
        ) / 10;
      }
    }

    return {
      id:            v.detailsReference,
      lat:           v.latitude,
      lng:           v.longitude,
      lineName:      v.line.name,
      bgColor:       v.line.backgroundColor,
      fgColor:       v.line.foregroundColor,
      transportMode: v.line.transportMode,
      direction:     v.directionDetails?.shortDirection ?? v.direction,
      delayMinutes,
      isCancelled,
      nextStopName,
    };
  });

  return { vehicles: enriched, fetchedAt: new Date().toISOString(), errors };
}
