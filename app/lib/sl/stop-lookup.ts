/**
 * Loads stops.json for SL and provides a parent_station → child stop IDs lookup.
 * Used by departures.ts: TripUpdates reference child stop IDs (quay level),
 * but the map markers use parent station IDs (stop area level).
 */

import fs   from 'node:fs';
import path from 'node:path';

interface StopEntry { id: string; childIds?: string[]; }

let childMap: Map<string, string[]> | null = null;

export function getChildIds(parentId: string): string[] {
  if (!childMap) {
    childMap = new Map();
    try {
      const p    = path.resolve(process.cwd(), 'public/shapes/stockholm/stops.json');
      const data = JSON.parse(fs.readFileSync(p, 'utf8')) as { stops: StopEntry[] };
      for (const s of data.stops ?? []) {
        if (s.childIds?.length) childMap.set(s.id, s.childIds);
      }
    } catch {
      // stops.json not yet built — returns empty
    }
  }
  return childMap.get(parentId) ?? [];
}
