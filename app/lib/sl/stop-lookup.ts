/**
 * Loads stops.json for SL and provides two lookups:
 *  - parent station ID → child stop IDs  (for TripUpdate stop matching)
 *  - child stop ID     → parent name     (for destination display)
 */

import fs   from 'node:fs';
import path from 'node:path';

interface StopEntry { id: string; name: string; childIds?: string[]; }

interface Loaded {
  childMap:       Map<string, string[]>;   // parentId → childIds
  childNameMap:   Map<string, string>;     // childId  → parentName
}

let loaded: Loaded | null = null;

function load(): Loaded {
  if (loaded) return loaded;
  loaded = { childMap: new Map(), childNameMap: new Map() };
  try {
    const p    = path.resolve(process.cwd(), 'public/shapes/stockholm/stops.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as { stops: StopEntry[] };
    for (const s of data.stops ?? []) {
      if (s.childIds?.length) {
        loaded.childMap.set(s.id, s.childIds);
        for (const cid of s.childIds) {
          loaded.childNameMap.set(cid, s.name);
        }
      }
    }
  } catch { /* stops.json not yet built */ }
  return loaded;
}

export function getChildIds(parentId: string): string[] {
  return load().childMap.get(parentId) ?? [];
}

/** Returns the parent station name for a child stop ID (quay/platform). */
export function getStopName(childStopId: string): string {
  return load().childNameMap.get(childStopId) ?? '';
}
