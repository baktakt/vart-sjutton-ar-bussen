'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import VehicleLayer          from '@/components/VehicleLayer';
import ShapeLayer             from '@/components/ShapeLayer';
import StopLayer              from '@/components/StopLayer';
import GeolocationController  from '@/components/GeolocationController';
import LocationModal           from '@/components/LocationModal';
import OneFingerZoom           from '@/components/OneFingerZoom';
import FilterBar, { DEFAULT_FILTER, applyFilter } from '@/components/FilterBar';
import type { FilterState } from '@/components/FilterBar';
import type { EnrichedVehicle, VehiclesResponse } from '@/types/vasttrafik';
import type { CityConfig } from '@/lib/providers';

// Need L type for BoundsTracker
import type L from 'leaflet';

const POLL_MS = 15_000;

// Minimum movement in degrees before "Sök i området" appears (~800 m)
const MOVE_THRESHOLD_DEG = 0.007;

function toBoundsParam(b: L.LatLngBounds): string {
  return [
    b.getSouthWest().lat.toFixed(5),
    b.getSouthWest().lng.toFixed(5),
    b.getNorthEast().lat.toFixed(5),
    b.getNorthEast().lng.toFixed(5),
  ].join(',');
}

function boundsCenter(boundsStr: string): { lat: number; lng: number } | null {
  const p = boundsStr.split(',').map(Number);
  if (p.length !== 4 || p.some(isNaN)) return null;
  return { lat: (p[0] + p[2]) / 2, lng: (p[1] + p[3]) / 2 };
}

/**
 * Captures live map bounds; calls onMove when the user pans far enough
 * or changes zoom by ≥1 level.
 */
function BoundsTracker({
  boundsRef,
  lastPolledBoundsRef,
  onMove,
}: {
  boundsRef: React.MutableRefObject<string | null>;
  lastPolledBoundsRef: React.MutableRefObject<string | null>;
  onMove: () => void;
}) {
  const lastZoomRef = useRef<number | null>(null);

  useMapEvents({
    moveend: e => {
      const b    = e.target.getBounds();
      const str  = toBoundsParam(b);
      boundsRef.current = str;

      const lastCenter = lastPolledBoundsRef.current
        ? boundsCenter(lastPolledBoundsRef.current)
        : null;
      const newCenter  = b.getCenter();

      if (!lastCenter) { onMove(); return; }
      const dist = Math.sqrt(
        (newCenter.lat - lastCenter.lat) ** 2 + (newCenter.lng - lastCenter.lng) ** 2,
      );
      if (dist > MOVE_THRESHOLD_DEG) onMove();
    },

    zoomend: e => {
      const b   = e.target.getBounds();
      boundsRef.current = toBoundsParam(b);

      const newZoom = e.target.getZoom();
      if (lastZoomRef.current !== null && Math.abs(newZoom - lastZoomRef.current) >= 1) {
        onMove();
      }
      lastZoomRef.current = newZoom;
    },
  });

  return null;
}

// ---------- persona-aware header pieces ----------

function LocateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  );
}

function TransitMapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Two coloured transit lines */}
      <path d="M3 7h18"/>
      <path d="M3 17h18"/>
      {/* Station dots */}
      <circle cx="7"  cy="7"  r="2" fill="currentColor" stroke="none"/>
      <circle cx="17" cy="7"  r="2" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="17" r="2" fill="currentColor" stroke="none"/>
      {/* Transfer connector */}
      <path d="M12 7v10"/>
    </svg>
  );
}

// ---------- main component ----------

export default function TransitMap({ city }: { city: CityConfig }) {
  const [vehicles,       setVehicles]       = useState<EnrichedVehicle[]>([]);
  const [fetchedAt,      setFetchedAt]      = useState<string | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [filter,         setFilter]         = useState<FilterState>(DEFAULT_FILTER);
  const [geoError,       setGeoError]       = useState<string | null>(null);
  const [mapDirty,       setMapDirty]       = useState(false);
  const [showModal,      setShowModal]      = useState(true);
  const [headerH,        setHeaderH]        = useState(72);
  const [transitMapMode, setTransitMapMode] = useState(false);

  const boundsRef          = useRef<string | null>(null);
  const lastPolledBoundsRef = useRef<string | null>(null);
  const locateTrigger       = useRef<(() => void) | null>(null);
  const headerRef           = useRef<HTMLDivElement>(null);

  // Track actual header height for the "Sök i området" button position
  useEffect(() => {
    const measure = () => {
      if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const poll = useCallback(async () => {
    const url = boundsRef.current
      ? `/api/${city.id}/vehicles?bounds=${boundsRef.current}`
      : `/api/${city.id}/vehicles`;
    try {
      const res  = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VehiclesResponse = await res.json();
      setVehicles(data.vehicles);
      setFetchedAt(data.fetchedAt);
      setError(null);
      setMapDirty(false);
      lastPolledBoundsRef.current = boundsRef.current; // mark where we polled
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

  const handleLocation = useCallback((bounds: string) => {
    boundsRef.current = bounds;
    setGeoError(null);
    poll();
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

  const lateCount = displayed.filter(v => (v.delayMinutes ?? 0) > 1 && !v.isCancelled).length;

  const updatedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`relative w-full h-full${transitMapMode ? ' transit-map-mode' : ''}`}>

      {/* ── Header ── */}
      <div ref={headerRef}
           className="absolute top-0 left-0 right-0 z-[1000]
                      bg-slate-900/90 backdrop-blur border-b border-slate-700">

        {/* Row 1: title + locate button */}
        <div className="flex items-center gap-3 px-4 pt-2.5 pb-1.5">
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-base leading-none">{city.name} live</h1>
            <p className="text-slate-400 text-xs mt-1 truncate">
              {loading
                ? 'Hämtar…'
                : `${displayed.length} fordon i området`}
              {lateCount > 0 && (
                <span className="text-red-400"> · {lateCount} sena</span>
              )}
              {updatedLabel && (
                <span className="text-slate-500"> · kl {updatedLabel}</span>
              )}
              {error && <span className="text-red-400"> · ⚠ fel</span>}
            </p>
          </div>

          <button
            onClick={() => setTransitMapMode(m => !m)}
            title={transitMapMode ? 'Visa vanlig karta' : 'Visa linjenätskarta'}
            className={`p-1.5 rounded-full flex-shrink-0 transition-colors ${
              transitMapMode
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-slate-700/60 hover:bg-slate-600 text-slate-300'
            }`}
          >
            <TransitMapIcon />
          </button>

          <button
            onClick={() => locateTrigger.current?.()}
            title={geoError ?? 'Hitta min position'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold flex-shrink-0
                        ${geoError
                          ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
          >
            <LocateIcon />
            Hitta mig
          </button>
        </div>

        {/* Row 2: filter bar */}
        <div className="px-4 pb-2">
          <FilterBar vehicles={vehicles} filter={filter} onChange={setFilter} />
        </div>
      </div>

      {/* ── "Sök i området" pill ── */}
      {mapDirty && !loading && (
        <div className="absolute z-[999] left-1/2 -translate-x-1/2 pointer-events-none"
             style={{ top: headerH + 10 }}>
          <button
            onClick={() => { setMapDirty(false); poll(); }}
            className="pointer-events-auto flex items-center gap-1.5 px-4 py-2 rounded-full
                       bg-white text-slate-800 font-semibold text-sm shadow-lg
                       hover:bg-slate-50 active:scale-95 transition-transform"
          >
            <SearchIcon />
            Sök i området
          </button>
        </div>
      )}

      {/* ── Map ── */}
      <MapContainer center={city.defaultCenter} zoom={city.defaultZoom} className="w-full h-full" zoomControl={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <OneFingerZoom />
        <BoundsTracker
          boundsRef={boundsRef}
          lastPolledBoundsRef={lastPolledBoundsRef}
          onMove={() => setMapDirty(true)}
        />
        <GeolocationController
          triggerRef={locateTrigger}
          onLocation={handleLocation}
          onError={setGeoError}
        />
        <ShapeLayer vehicles={modeFiltered} shapesPath={city.shapesPath} transitMapMode={transitMapMode} filterMode={filter.mode} />
        <StopLayer shapesPath={city.shapesPath} cityId={city.id} />
        <VehicleLayer vehicles={displayed} />
      </MapContainer>

      {/* Location modal — shown on every fresh load */}
      {showModal && (
        <LocationModal
          cityName={city.name}
          onLocate={() => {
            setShowModal(false);
            locateTrigger.current?.();
          }}
          onDismiss={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
