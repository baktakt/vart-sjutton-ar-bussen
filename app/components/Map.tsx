'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import VehicleLayer from '@/components/VehicleLayer';
import ShapeLayer   from '@/components/ShapeLayer';
import StopLayer    from '@/components/StopLayer';
import FilterBar, { DEFAULT_FILTER, applyFilter } from '@/components/FilterBar';
import type { FilterState } from '@/components/FilterBar';
import type { EnrichedVehicle, VehiclesResponse } from '@/types/vasttrafik';

const CENTER: [number, number] = [57.7089, 11.9746];
const ZOOM    = 13;
const POLL_MS = 15_000;

// Captures live map bounds and passes them up via a ref
function BoundsTracker({ boundsRef }: { boundsRef: React.MutableRefObject<string | null> }) {
  useMapEvents({
    moveend: e => { boundsRef.current = toBoundsParam(e.target.getBounds()); },
    zoomend: e => { boundsRef.current = toBoundsParam(e.target.getBounds()); },
  });
  return null;
}

function toBoundsParam(b: L.LatLngBounds): string {
  return [
    b.getSouthWest().lat.toFixed(5),
    b.getSouthWest().lng.toFixed(5),
    b.getNorthEast().lat.toFixed(5),
    b.getNorthEast().lng.toFixed(5),
  ].join(',');
}

// Need L type for toBoundsParam signature
import type L from 'leaflet';

function DelayBadge({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span className="text-slate-300">{label}:</span>
      <span className="font-semibold text-white">{count}</span>
    </div>
  );
}

export default function TransitMap() {
  const [vehicles,  setVehicles]  = useState<EnrichedVehicle[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [filter,    setFilter]    = useState<FilterState>(DEFAULT_FILTER);
  const boundsRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    const url = boundsRef.current
      ? `/api/vehicles?bounds=${boundsRef.current}`
      : '/api/vehicles';
    try {
      const res  = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VehiclesResponse = await res.json();
      setVehicles(data.vehicles);
      setFetchedAt(data.fetchedAt);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Stage 1: mode filter — shapes follow this
  const modeFiltered = useMemo(
    () => applyFilter(vehicles, { ...filter, onlyLate: false }),
    [vehicles, filter],
  );

  // Stage 2: + onlyLate — vehicle dots follow this
  const displayed = useMemo(
    () => filter.onlyLate ? applyFilter(modeFiltered, filter) : modeFiltered,
    [modeFiltered, filter],
  );

  const late      = displayed.filter(v => (v.delayMinutes ?? 0) > 1  && !v.isCancelled).length;
  const early     = displayed.filter(v => (v.delayMinutes ?? 0) < -1 && !v.isCancelled).length;
  const onTime    = displayed.filter(v => v.delayMinutes !== null && Math.abs(v.delayMinutes) <= 1 && !v.isCancelled).length;
  const cancelled = displayed.filter(v => v.isCancelled).length;
  const noData    = displayed.filter(v => v.delayMinutes === null && !v.isCancelled).length;

  return (
    <div className="relative w-full h-full">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-[1000]
                      bg-slate-900/90 backdrop-blur border-b border-slate-700">

        {/* Row 1: title + delay stats */}
        <div className="flex items-center gap-4 px-4 pt-2 pb-1.5">
          <div>
            <h1 className="text-white font-bold text-sm leading-none">Västtrafik — realtid</h1>
            {fetchedAt && (
              <p className="text-slate-500 text-xs mt-0.5">
                {new Date(fetchedAt).toLocaleTimeString('sv-SE')}
                {' · '}uppdateras var 15s
              </p>
            )}
          </div>
          <div className="flex gap-3 ml-auto flex-wrap items-center">
            <DelayBadge count={late}      label="Sena"   color="#ef4444" />
            <DelayBadge count={early}     label="Tidiga" color="#22c55e" />
            <DelayBadge count={onTime}    label="I tid"  color="#64748b" />
            {cancelled > 0 && <DelayBadge count={cancelled} label="Inst."  color="#6b7280" />}
            {noData    > 0 && <DelayBadge count={noData}    label="Okänd" color="#334155" />}
            {loading && <span className="text-blue-400 text-xs">Hämtar…</span>}
            {error   && <span className="text-red-400  text-xs" title={error}>⚠ Fel</span>}
          </div>
        </div>

        {/* Row 2: filter bar */}
        <div className="px-4 pb-2">
          <FilterBar vehicles={vehicles} filter={filter} onChange={setFilter} />
        </div>
      </div>

      {/* Map */}
      <MapContainer center={CENTER} zoom={ZOOM} className="w-full h-full" zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BoundsTracker boundsRef={boundsRef} />
        <ShapeLayer   vehicles={modeFiltered} />
        <StopLayer />
        <VehicleLayer vehicles={displayed} />
      </MapContainer>
    </div>
  );
}
