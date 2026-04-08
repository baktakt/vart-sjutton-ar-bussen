/**
 * Loads trips.json for SL and provides a trip_id → route_id lookup.
 *
 * SL's GTFS-RT TripDescriptor typically only includes trip_id, not route_id.
 * This table (built from GTFS static trips.txt) bridges the gap so we can
 * resolve line names and colours for every vehicle and departure.
 *
 * Built by: npm run process-shapes:stockholm
 * File: public/shapes/stockholm/trips.json
 */

import fs   from 'node:fs';
import path from 'node:path';

let cache: Map<string, string> | null = null;

export function getRouteIdForTrip(tripId: string): string {
  if (!cache) {
    cache = new Map();
    try {
      const p    = path.resolve(process.cwd(), 'public/shapes/stockholm/trips.json');
      const data = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        trips: Record<string, string>;
      };
      for (const [tid, rid] of Object.entries(data.trips ?? {})) {
        cache.set(tid, rid);
      }
    } catch {
      // trips.json not yet built — returns empty for all lookups
    }
  }
  return cache.get(tripId) ?? '';
}
