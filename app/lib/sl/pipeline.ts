/**
 * SL vehicle positions pipeline.
 * Fetches GTFS-RT VehiclePositions, filters to bbox, enriches with route info.
 */

import { getVehicleFeed }         from './feed';
import { getRoutes, ROUTE_TYPE_MODE } from './routes';
import type { BBox }              from '@/lib/providers';
import type { EnrichedVehicle, VehiclesResponse } from '@/types/vasttrafik';

// Long values from protobufjs can be Long objects or numbers
function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'toNumber' in (v as object)) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}

export async function getSlVehicles(bbox: BBox): Promise<VehiclesResponse> {
  const feed   = await getVehicleFeed();
  const routes = getRoutes();

  const vehicles: EnrichedVehicle[] = [];

  for (const entity of feed.entity ?? []) {
    const vp = entity.vehicle;
    if (!vp?.position) continue;

    const lat = toNumber(vp.position.latitude);
    const lng = toNumber(vp.position.longitude);

    // bbox filter — GTFS-RT gives all SL vehicles, we clip to the requested area
    if (
      lat < bbox.lowerLeftLat  || lat > bbox.upperRightLat ||
      lng < bbox.lowerLeftLong || lng > bbox.upperRightLong
    ) continue;

    const routeId = vp.trip?.routeId ?? '';
    const route   = routes.get(routeId);

    const transportMode = ROUTE_TYPE_MODE[route?.type ?? 700] ?? 'bus';
    const vehicleId     = vp.vehicle?.id ?? vp.vehicle?.label ?? entity.id ?? routeId;
    const directionId   = toNumber(vp.trip?.directionId ?? 0);

    vehicles.push({
      id:            vehicleId,
      lat,
      lng,
      lineName:      route?.name    ?? routeId,
      bgColor:       route?.bgColor ?? '#374151',
      fgColor:       route?.fgColor ?? '#ffffff',
      transportMode,
      direction:     String(directionId),   // enriched later if needed
      delayMinutes:  null,                   // requires TripUpdates join
      isCancelled:   false,
      nextStopName:  null,
    });
  }

  return { vehicles, fetchedAt: new Date().toISOString(), errors: [] };
}
