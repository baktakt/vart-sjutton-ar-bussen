'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { Polyline, Tooltip } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { EnrichedVehicle } from '@/types/vasttrafik';

interface ShapeFile {
  name: string;
  routeType: number;
  coordinates: [number, number][];
}

interface ManifestEntry {
  name: string;
  routeType: number;
  file: string;
}

interface Props {
  vehicles: EnrichedVehicle[];
  shapesPath: string;
  transitMapMode?: boolean;
}

// Fallback colours by GTFS route type (shown before vehicle data arrives)
const TYPE_COLOR: Record<number, string> = {
  100:  '#7c3aed', // Train   — purple
  400:  '#185AA1', // Metro   — SL blue
  401:  '#185AA1',
  700:  '#64748b', // Bus     — slate
  900:  '#0ea5e9', // Tram    — sky blue
  1000: '#0891b2', // Ferry   — cyan
  1200: '#0891b2',
};

const ROUTE_TYPE_LABELS: Record<number, string> = {
  100: 'Tåg', 400: 'Tunnelbana', 401: 'Tunnelbana',
  700: 'Buss', 900: 'Spårvagn', 1000: 'Båt', 1200: 'Färja',
};

/**
 * Priority for resolving name collisions: higher = shown in preference.
 * Metro > Train > Tram > Ferry > Bus
 */
const TYPE_PRIORITY: Record<number, number> = {
  400: 5, 401: 5,
  100: 4,
  900: 3,
  1000: 2, 1200: 2,
  700: 1,
};

export default function ShapeLayer({ vehicles, shapesPath, transitMapMode = false }: Props) {
  const [manifest,     setManifest]     = useState<ManifestEntry[]>([]);
  const [loadedShapes, setLoadedShapes] = useState<Map<string, ShapeFile>>(new Map());
  const fetching    = useRef(new Set<string>());
  // Persistent colour map — survives vehicle leaving the viewport
  const colorCache  = useRef(new Map<string, string>());
  // For each shape name: the highest-priority routeType seen in the manifest.
  // Used to detect data corruption (e.g. ferry file overwriting metro file).
  const manifestType = useRef(new Map<string, number>());

  // ── Load manifest once ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${shapesPath}/manifest.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.lines) setManifest(d.lines); })
      .catch(() => {});
  }, [shapesPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build deduplicated manifest (highest-priority type wins per name) ───────
  const dedupedManifest = useMemo(() => {
    const best = new Map<string, ManifestEntry>();
    for (const entry of manifest) {
      const existing = best.get(entry.name);
      const p = TYPE_PRIORITY[entry.routeType] ?? 0;
      const ep = existing ? (TYPE_PRIORITY[existing.routeType] ?? 0) : -1;
      if (p > ep) best.set(entry.name, entry);
    }
    return [...best.values()];
  }, [manifest]);

  // Populate manifestType ref whenever dedupedManifest changes
  useEffect(() => {
    for (const entry of dedupedManifest) {
      manifestType.current.set(entry.name, entry.routeType);
    }
  }, [dedupedManifest]);

  // ── Fetch helper ────────────────────────────────────────────────────────────
  function fetchShapes(entries: ManifestEntry[]) {
    const toFetch = entries.filter(e => !fetching.current.has(e.name));
    if (toFetch.length === 0) return;
    toFetch.forEach(e => fetching.current.add(e.name));

    Promise.all(
      toFetch.map(async entry => {
        try {
          const res = await fetch(`${shapesPath}/${entry.file}`);
          if (!res.ok) return null;
          return [entry.name, await res.json() as ShapeFile] as const;
        } catch { return null; }
      }),
    ).then(results => {
      const fresh = results.filter((r): r is [string, ShapeFile] => r !== null);
      if (fresh.length === 0) return;
      setLoadedShapes(prev => {
        const next = new Map(prev);
        fresh.forEach(([name, shape]) => next.set(name, shape));
        return next;
      });
    });
  }

  // ── On manifest load: immediately fetch all non-bus shapes ─────────────────
  // Trams (900) = 171 KB, Trains (100) = 554 KB, Boats (1000) = 26 KB → ~751 KB total
  // Buses (700) = 12 MB → lazy-load only when a bus appears in the area
  useEffect(() => {
    if (dedupedManifest.length === 0) return;
    fetchShapes(dedupedManifest.filter(e => e.routeType !== 700));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dedupedManifest]);

  // ── Active bus line names (for lazy bus shape loading) ─────────────────────
  const activeBusNames = useMemo(
    () => new Set(vehicles.filter(v => v.transportMode === 'bus').map(v => v.lineName)),
    [vehicles],
  );

  // ── Lazy-load bus shapes when a bus vehicle appears ────────────────────────
  useEffect(() => {
    if (dedupedManifest.length === 0 || activeBusNames.size === 0) return;
    const byName = new Map(dedupedManifest.map(e => [e.name, e]));
    fetchShapes(
      [...activeBusNames]
        .map(name => byName.get(name))
        .filter((e): e is ManifestEntry => !!e),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusNames, dedupedManifest]);

  // ── Update colour cache from live vehicle data ─────────────────────────────
  useEffect(() => {
    for (const v of vehicles) {
      if (!colorCache.current.has(v.lineName)) {
        colorCache.current.set(v.lineName, v.bgColor);
      }
    }
  }, [vehicles]);

  // ── Render all loaded shapes ───────────────────────────────────────────────
  return (
    <>
      {[...loadedShapes.entries()].map(([name, shape]) => {
        if (shape.coordinates.length < 2) return null;

        // Guard against data corruption: if the manifest expected a higher-priority
        // type but the file contains a lower-priority type, the file was overwritten
        // by a name-colliding route (e.g. ferry "10" overwriting metro T10).
        // Skip rendering to avoid drawing in the wrong location.
        const mType = manifestType.current.get(name) ?? shape.routeType;
        const mPriority = TYPE_PRIORITY[mType] ?? 0;
        const fPriority = TYPE_PRIORITY[shape.routeType] ?? 0;
        if (shape.routeType !== mType && fPriority < mPriority) return null;

        // Use manifest routeType for display (even if file type differs slightly)
        const color     = colorCache.current.get(name) ?? TYPE_COLOR[mType] ?? '#94a3b8';
        const typeLabel = ROUTE_TYPE_LABELS[mType] ?? '';

        const isMetro = mType === 400 || mType === 401;
        const weight  = transitMapMode ? (isMetro ? 9 : 6) : 4;
        const opacity = transitMapMode ? 0.95 : 0.55;

        const normal: PathOptions  = { color, weight, opacity };
        const hovered: PathOptions = { color, weight: weight + 3, opacity: Math.min(opacity + 0.3, 1) };
        return (
          <Polyline
            key={name}
            positions={shape.coordinates}
            pathOptions={normal}
            eventHandlers={{
              mouseover: e => { e.target.setStyle(hovered); e.target.bringToFront(); },
              mouseout:  e => { e.target.setStyle(normal); },
            }}
          >
            <Tooltip sticky>{typeLabel} {name}</Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}
