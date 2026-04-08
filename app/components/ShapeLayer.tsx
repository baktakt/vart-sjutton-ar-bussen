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

export default function ShapeLayer({ vehicles, shapesPath }: Props) {
  const [manifest,     setManifest]     = useState<ManifestEntry[]>([]);
  const [loadedShapes, setLoadedShapes] = useState<Map<string, ShapeFile>>(new Map());
  const fetching   = useRef(new Set<string>());
  // Persistent colour map — survives vehicle leaving the viewport
  const colorCache = useRef(new Map<string, string>());

  // ── Load manifest once ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${shapesPath}/manifest.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.lines) setManifest(d.lines); })
      .catch(() => {});
  }, [shapesPath]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (manifest.length === 0) return;
    fetchShapes(manifest.filter(e => e.routeType !== 700));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  // ── Active bus line names (for lazy bus shape loading) ─────────────────────
  const activeBusNames = useMemo(
    () => new Set(vehicles.filter(v => v.transportMode === 'bus').map(v => v.lineName)),
    [vehicles],
  );

  // ── Lazy-load bus shapes when a bus vehicle appears ────────────────────────
  useEffect(() => {
    if (manifest.length === 0 || activeBusNames.size === 0) return;
    const byName = new Map(manifest.map(e => [e.name, e]));
    fetchShapes(
      [...activeBusNames]
        .map(name => byName.get(name))
        .filter((e): e is ManifestEntry => !!e),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusNames, manifest]);

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
        const color     = colorCache.current.get(name) ?? TYPE_COLOR[shape.routeType] ?? '#94a3b8';
        const typeLabel = ROUTE_TYPE_LABELS[shape.routeType] ?? '';
        const normal: PathOptions  = { color, weight: 4, opacity: 0.55 };
        const hovered: PathOptions = { color, weight: 7, opacity: 0.9 };
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
