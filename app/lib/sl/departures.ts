/**
 * Stop departures for SL, sourced from GTFS-RT TripUpdates.
 *
 * Algorithm:
 *  1. Fetch TripUpdates feed (shared 15s cache with vehicle pipeline)
 *  2. Find all trip_updates that have a stop_time_update for the given stop_id
 *     with a future departure time
 *  3. Enrich each with route info from routes.json
 *  4. Return sorted NormalizedDeparture[]
 */

import { getTripUpdateFeed }          from './feed';
import { getRoutes, ROUTE_TYPE_MODE } from './routes';
import { getChildIds, getStopName }   from './stop-lookup';
import { getRouteIdForTrip }          from './trip-lookup';
import type { NormalizedDeparture }   from '@/types/transit';

const MAX_RESULTS   = 20;
const WINDOW_MS     = 60 * 60 * 1000; // look 60 min ahead

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'toNumber' in (v as object)) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}

export async function getSlDepartures(stopId: string): Promise<NormalizedDeparture[]> {
  const feed    = await getTripUpdateFeed();
  const routes  = getRoutes();

  // TripUpdates reference child stop IDs (quay/platform level).
  // The map marker uses the parent station ID from stops.json.
  // Build a set of all IDs to match: parent + its children.
  const matchIds = new Set<string>([stopId, ...getChildIds(stopId)]);

  const now       = Date.now();
  const cutoff    = now + WINDOW_MS;
  const results: Array<{ dep: NormalizedDeparture; sortTime: number }> = [];

  for (const entity of feed.entity ?? []) {
    const tu = entity.tripUpdate;
    if (!tu) continue;

    const tripId  = tu.trip?.tripId ?? entity.id ?? '';
    // SL's GTFS-RT often omits route_id — fall back to trips.json lookup
    const routeId = (tu.trip?.routeId as string | null | undefined) || getRouteIdForTrip(tripId);
    const route   = routes.get(routeId);

    // Infer destination from the last stop in the trip update
    const stus = tu.stopTimeUpdate ?? [];
    const lastStopId = stus.length > 0 ? stus[stus.length - 1].stopId ?? '' : '';
    const destination = getStopName(lastStopId) || (tu.trip?.directionId != null ? `Riktning ${tu.trip.directionId}` : '');

    for (const stu of stus) {
      if (!stu.stopId || !matchIds.has(stu.stopId)) continue;

      // departure.time is estimated Unix timestamp (seconds)
      const depTime = stu.departure?.time != null
        ? toNumber(stu.departure.time) * 1000
        : stu.arrival?.time != null
          ? toNumber(stu.arrival.time) * 1000
          : null;

      if (depTime == null || depTime < now || depTime > cutoff) continue;

      const delay      = toNumber(stu.departure?.delay ?? stu.arrival?.delay ?? 0);  // seconds
      const plannedMs  = depTime - delay * 1000;
      const isDelayed  = Math.abs(delay) >= 60;

      const transportMode = ROUTE_TYPE_MODE[route?.type ?? 700] ?? 'bus';

      results.push({
        sortTime: depTime,
        dep: {
          tripId,
          line: {
            name:          route?.name    ?? routeId,
            bgColor:       route?.bgColor ?? '#374151',
            fgColor:       route?.fgColor ?? '#ffffff',
            transportMode,
          },
          direction: destination,
          platform:  undefined,
          plannedTime:                   new Date(plannedMs).toISOString(),
          estimatedTime:                 isDelayed ? new Date(depTime).toISOString() : undefined,
          estimatedOtherwisePlannedTime: new Date(depTime).toISOString(),
          isCancelled:                   stu.scheduleRelationship === 1, // SKIPPED
        },
      });
      break; // only the first matching stop_time_update per trip matters
    }
  }

  return results
    .sort((a, b) => a.sortTime - b.sortTime)
    .slice(0, MAX_RESULTS)
    .map(r => r.dep);
}
