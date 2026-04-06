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
  // mode-filtered vehicles (not late-filtered) — determines which lines get shapes
  vehicles: EnrichedVehicle[];
}

export default function ShapeLayer({ vehicles }: Props) {
  const [manifest,    setManifest]    = useState<ManifestEntry[]>([]);
  const [loadedShapes, setLoadedShapes] = useState<Map<string, ShapeFile>>(new Map());
  // Tracks in-flight + completed fetches so we never double-fetch
  const fetching = useRef(new Set<string>());

  // Load manifest once — silently no-ops if shapes haven't been generated yet
  useEffect(() => {
    fetch('/shapes/manifest.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.lines) setManifest(d.lines); })
      .catch(() => {});
  }, []);

  // Active line names from current vehicles
  const activeLineNames = useMemo(
    () => new Set(vehicles.map(v => v.lineName)),
    [vehicles],
  );

  // Line name → color from live vehicle data
  const lineColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vehicles) if (!m.has(v.lineName)) m.set(v.lineName, v.bgColor);
    return m;
  }, [vehicles]);

  // Fetch shape files for newly-active lines
  useEffect(() => {
    if (manifest.length === 0) return;

    const byName = new Map(manifest.map(e => [e.name, e]));
    const toFetch = [...activeLineNames].filter(
      name => !fetching.current.has(name) && !loadedShapes.has(name),
    );
    if (toFetch.length === 0) return;

    toFetch.forEach(name => fetching.current.add(name));

    Promise.all(
      toFetch.map(async name => {
        const entry = byName.get(name);
        if (!entry) return null;
        try {
          const res = await fetch(`/shapes/${entry.file}`);
          if (!res.ok) return null;
          return [name, await res.json() as ShapeFile] as const;
        } catch {
          return null;
        }
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
  }, [activeLineNames, manifest, loadedShapes]);

  const ROUTE_TYPE_LABELS: Record<number, string> = {
    100: 'Tåg', 700: 'Buss', 900: 'Spårvagn', 1000: 'Båt', 1200: 'Färja',
  };

  return (
    <>
      {[...activeLineNames].map(name => {
        const shape = loadedShapes.get(name);
        if (!shape || shape.coordinates.length < 2) return null;
        const color   = lineColors.get(name) ?? '#94a3b8';
        const normal: PathOptions  = { color, weight: 4, opacity: 0.55 };
        const hovered: PathOptions = { color, weight: 7, opacity: 0.85 };
        const typeLabel = ROUTE_TYPE_LABELS[shape.routeType] ?? `Typ ${shape.routeType}`;
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
