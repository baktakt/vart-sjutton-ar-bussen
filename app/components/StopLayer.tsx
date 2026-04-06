'use client';

import { useEffect, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { VTDeparture } from '@/types/vasttrafik';

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const MIN_ZOOM = 15;

// ---------- departure board HTML ----------

function modeIcon(mode: string): string {
  if (mode === 'tram')  return '🚋';
  if (mode === 'train') return '🚆';
  if (mode === 'ferry') return '⛴';
  return '🚌';
}

function minsUntil(iso: string): string {
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  return diff <= 0 ? 'Nu' : String(diff);
}

function boardHtml(stopName: string, deps: VTDeparture[]): string {
  const now = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  // Group by line shortName + direction; keep sorted order (deps already sorted by time)
  const groups = new Map<string, VTDeparture[]>();
  for (const d of deps) {
    const key = `${d.serviceJourney.line.shortName}|${d.serviceJourney.direction}`;
    const arr  = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }

  // Take up to 6 groups, show next 2 departures per group
  const rows = [...groups.values()].slice(0, 6).map(group => {
    const line = group[0].serviceJourney.line;
    const dir  = group[0].serviceJourney.direction;
    const bg   = line.backgroundColor || '#374151';
    const fg   = line.foregroundColor  || '#ffffff';
    const icon = modeIcon(line.transportMode);
    const next  = minsUntil(group[0].estimatedOtherwisePlannedTime);
    const after = group[1] ? minsUntil(group[1].estimatedOtherwisePlannedTime) : '—';
    const cancelled = group[0].isCancelled;

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #1e293b;">
        <div style="background:${bg};color:${fg};border-radius:4px;padding:2px 7px;font-weight:bold;font-size:13px;min-width:28px;text-align:center;white-space:nowrap;${cancelled ? 'opacity:0.45;text-decoration:line-through;' : ''}">${line.shortName || line.name}</div>
        <span style="font-size:15px;line-height:1;">${icon}</span>
        <span style="flex:1;font-size:13px;font-weight:600;${cancelled ? 'color:#6b7280;text-decoration:line-through;' : ''}">${dir}</span>
        <span style="font-weight:bold;font-size:17px;min-width:28px;text-align:right;${cancelled ? 'color:#ef4444;' : ''}">${cancelled ? '✕' : next}</span>
        <span style="color:#475569;font-size:12px;min-width:24px;text-align:right;">${cancelled ? '' : after}</span>
      </div>`;
  }).join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0f172a;color:#f8fafc;border-radius:10px;overflow:hidden;min-width:300px;max-width:340px;">
      <div style="background:#1e293b;padding:10px 14px;display:flex;align-items:center;gap:8px;">
        <span style="font-weight:bold;font-size:15px;flex:1;">${stopName}</span>
        <span style="font-size:14px;font-weight:bold;color:#94a3b8;margin-right:6px;">${now}</span>
        <button class="popup-close-btn" style="background:#334155;border:none;color:#94a3b8;border-radius:50%;width:22px;height:22px;font-size:16px;line-height:22px;text-align:center;cursor:pointer;flex-shrink:0;padding:0;" title="Stäng">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto auto;gap:0 8px;color:#475569;font-size:10px;padding:5px 14px 2px;border-bottom:1px solid #1e293b;">
        <span></span><span>Nästa</span><span>Därefter</span>
      </div>
      <div style="padding:0 14px 4px;">${rows || '<div style="padding:10px 0;color:#475569;font-size:13px;">Inga avgångar hittades</div>'}</div>
    </div>`;
}

function loadingHtml(stopName: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0f172a;color:#f8fafc;border-radius:10px;overflow:hidden;min-width:260px;">
      <div style="background:#1e293b;padding:10px 14px;">
        <span style="font-weight:bold;font-size:15px;">${stopName}</span>
      </div>
      <div style="padding:14px;color:#475569;font-size:13px;">Hämtar avgångar…</div>
    </div>`;
}

function errorHtml(stopName: string): string {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0f172a;color:#f8fafc;border-radius:10px;overflow:hidden;min-width:260px;">
      <div style="background:#1e293b;padding:10px 14px;">
        <span style="font-weight:bold;font-size:15px;">${stopName}</span>
      </div>
      <div style="padding:14px;color:#ef4444;font-size:13px;">Kunde inte hämta avgångar</div>
    </div>`;
}

// ---------- component ----------

export default function StopLayer() {
  const map     = useMap();
  const [stops,    setStops]    = useState<Stop[]>([]);
  const [viewport, setViewport] = useState(0);
  const [zoom,     setZoom]     = useState(map.getZoom());
  const markers = useRef(new Map<string, L.Marker>());

  useMapEvents({
    zoomend: () => { setZoom(map.getZoom()); setViewport(v => v + 1); },
    moveend: ()  => setViewport(v => v + 1),
  });

  useEffect(() => {
    fetch('/shapes/stops.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.stops) setStops(d.stops); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (zoom < MIN_ZOOM || stops.length === 0) {
      markers.current.forEach(m => m.remove());
      markers.current.clear();
      return;
    }

    const bounds  = map.getBounds();
    const visible = new Set(
      stops.filter(s => bounds.contains([s.lat, s.lng])).map(s => s.id),
    );

    // Remove out-of-viewport markers
    for (const [id, marker] of markers.current) {
      if (!visible.has(id)) { marker.remove(); markers.current.delete(id); }
    }

    // Add new markers
    for (const stop of stops) {
      if (!visible.has(stop.id) || markers.current.has(stop.id)) continue;

      const icon = L.divIcon({
        className: '',
        html: '<div class="stop-marker">H</div>',
        iconSize:   [22, 22],
        iconAnchor: [11, 11],
        tooltipAnchor: [0, -13],
      });

      const marker = L.marker([stop.lat, stop.lng], { icon })
        .bindTooltip(stop.name, { direction: 'top', offset: [0, -4] })
        .addTo(map);

      // Click → show departure board popup
      marker.on('click', async () => {
        const popup = L.popup({ maxWidth: 360, className: 'stop-popup', closeButton: false })
          .setLatLng([stop.lat, stop.lng])
          .setContent(loadingHtml(stop.name));

        // Attach custom close button handler once popup DOM is ready
        const wireClose = () => {
          popup.getElement()
            ?.querySelector('.popup-close-btn')
            ?.addEventListener('click', () => map.closePopup(popup));
        };
        popup.on('add', wireClose);
        popup.openOn(map);

        try {
          const res  = await fetch(`/api/departures?gid=${stop.id}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (map.hasLayer(popup as unknown as L.Layer)) {
            popup.setContent(boardHtml(stop.name, data.departures ?? []));
            wireClose();
          }
        } catch {
          if (map.hasLayer(popup as unknown as L.Layer)) {
            popup.setContent(errorHtml(stop.name));
          }
        }
      });

      markers.current.set(stop.id, marker);
    }
  }, [zoom, viewport, stops, map]);

  useEffect(() => {
    return () => { markers.current.forEach(m => m.remove()); markers.current.clear(); };
  }, []);

  return null;
}
