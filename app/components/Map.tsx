'use client';

import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import VehicleLayer from '@/components/VehicleLayer';
import type { EnrichedVehicle, VehiclesResponse } from '@/types/vasttrafik';

const CENTER: [number, number] = [57.7089, 11.9746]; // Gothenburg
const ZOOM = 13;
const POLL_MS = 15_000;

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

  const poll = useCallback(async () => {
    try {
      const res  = await fetch('/api/vehicles', { cache: 'no-store' });
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

  const late      = vehicles.filter(v => (v.delayMinutes ?? 0) > 1  && !v.isCancelled).length;
  const early     = vehicles.filter(v => (v.delayMinutes ?? 0) < -1 && !v.isCancelled).length;
  const onTime    = vehicles.filter(v => v.delayMinutes !== null && Math.abs(v.delayMinutes) <= 1 && !v.isCancelled).length;
  const cancelled = vehicles.filter(v => v.isCancelled).length;
  const noData    = vehicles.filter(v => v.delayMinutes === null && !v.isCancelled).length;

  return (
    <div className="relative w-full h-full">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-[1000] flex items-center gap-4
                      bg-slate-900/90 backdrop-blur px-4 py-2 border-b border-slate-700">
        <div>
          <h1 className="text-white font-bold text-sm leading-none">Västtrafik — realtid</h1>
          {fetchedAt && (
            <p className="text-slate-500 text-xs mt-0.5">
              {new Date(fetchedAt).toLocaleTimeString('sv-SE')}
              {' · '}uppdateras var 15s
            </p>
          )}
        </div>

        <div className="flex gap-3 ml-auto flex-wrap">
          <DelayBadge count={late}      label="Sena"    color="#ef4444" />
          <DelayBadge count={early}     label="Tidiga"  color="#22c55e" />
          <DelayBadge count={onTime}    label="I tid"   color="#64748b" />
          {cancelled > 0 && <DelayBadge count={cancelled} label="Inst." color="#6b7280" />}
          {noData > 0    && <DelayBadge count={noData}    label="Okänd" color="#334155" />}
        </div>

        {loading && <span className="text-blue-400 text-xs">Hämtar…</span>}
        {error   && <span className="text-red-400  text-xs" title={error}>⚠ Fel</span>}
      </div>

      {/* Map */}
      <MapContainer
        center={CENTER}
        zoom={ZOOM}
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <VehicleLayer vehicles={vehicles} />
      </MapContainer>
    </div>
  );
}
