'use client';

import { useEffect, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { NormalizedDeparture } from '@/types/transit';

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const MIN_ZOOM = 15;

// ---------- departure board HTML ----------

// Inline SVG icons — stroke-based, consistent weight, no emoji baseline issues
const MODE_ICONS: Record<string, string> = {
  tram: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;">
    <rect x="4" y="8" width="16" height="10" rx="2"/>
    <path d="M8 8V5h8v3"/>
    <path d="M4 13h16"/>
    <path d="M8 18v2M16 18v2"/>
    <path d="M12 5V3"/>
  </svg>`,

  bus: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;">
    <path d="M4 17h16V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9z"/>
    <path d="M4 12h16"/>
    <path d="M9 6v6M15 6v6"/>
    <circle cx="7.5" cy="19.5" r="1.5"/>
    <circle cx="16.5" cy="19.5" r="1.5"/>
  </svg>`,

  train: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;">
    <rect x="5" y="3" width="14" height="14" rx="3"/>
    <path d="M5 10h14"/>
    <path d="M10 3v7M14 3v7"/>
    <path d="M8 17l-2 4M16 17l2 4"/>
  </svg>`,

  ferry: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;">
    <path d="M3 17h18l-3-9H6L3 17z"/>
    <path d="M12 8V4M9 4h6"/>
    <path d="M2 20c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/>
  </svg>`,
};

function modeIconSvg(mode: string): string {
  return MODE_ICONS[mode] ?? MODE_ICONS.bus;
}

function minsUntil(iso: string): string {
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  return diff <= 0 ? 'Nu' : String(diff);
}

function boardHtml(stopName: string, deps: NormalizedDeparture[]): string {
  const now = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  // Group by line name + direction; keep sorted order (deps already sorted by time)
  const groups = new Map<string, NormalizedDeparture[]>();
  for (const d of deps) {
    const key = `${d.line.name}|${d.direction}`;
    const arr  = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }

  // Take up to 7 groups, show next departure per group
  const rows = [...groups.values()].slice(0, 7).map(group => {
    const line     = group[0].line;
    const dir      = group[0].direction;
    const bg       = line.bgColor || '#374151';
    const fg       = line.fgColor || '#ffffff';
    const next     = minsUntil(group[0].estimatedOtherwisePlannedTime);
    const platform = group[0].platform ?? '';
    const cancelled = group[0].isCancelled;

    const platBadge = platform
      ? `<div style="width:26px;height:26px;border-radius:50%;border:1.5px solid #475569;color:#e2e8f0;font-size:11px;font-weight:700;line-height:23px;text-align:center;flex-shrink:0;box-sizing:border-box;">${platform}</div>`
      : `<div style="width:26px;height:26px;flex-shrink:0;"></div>`;

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1e293b;">
        <div style="background:${bg};color:${fg};border-radius:4px;padding:3px 7px;font-weight:bold;font-size:13px;min-width:32px;text-align:center;white-space:nowrap;${cancelled ? 'opacity:0.45;text-decoration:line-through;' : ''}">${line.name}</div>
        <span style="flex:1;font-size:14px;font-weight:600;${cancelled ? 'color:#6b7280;text-decoration:line-through;' : ''}">${dir}</span>
        <span style="font-weight:bold;font-size:18px;min-width:32px;text-align:right;${cancelled ? 'color:#ef4444;' : ''}">${cancelled ? '✕' : next}</span>
        ${platBadge}
      </div>`;
  }).join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0f172a;color:#f8fafc;border-radius:10px;overflow:hidden;min-width:300px;max-width:360px;">
      <div style="background:#1e293b;padding:12px 16px;display:flex;align-items:center;gap:8px;">
        <span style="font-weight:bold;font-size:17px;flex:1;">${stopName}</span>
        <span style="font-size:16px;font-weight:bold;color:#94a3b8;margin-right:4px;">${now}</span>
        <button class="popup-close-btn" style="background:#334155;border:none;color:#94a3b8;border-radius:50%;width:24px;height:24px;font-size:16px;line-height:24px;text-align:center;cursor:pointer;flex-shrink:0;padding:0;" title="Stäng">×</button>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0;color:#475569;font-size:11px;padding:5px 16px 3px;border-bottom:1px solid #1e293b;">
        <span style="min-width:32px;text-align:right;margin-right:8px;">Nästa</span>
        <span style="width:26px;text-align:center;">Läge</span>
      </div>
      <div style="padding:0 16px 6px;">${rows || '<div style="padding:12px 0;color:#475569;font-size:13px;">Inga avgångar hittades</div>'}</div>
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

export default function StopLayer({ shapesPath, cityId }: { shapesPath: string; cityId: string }) {
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
    fetch(`${shapesPath}/stops.json`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.stops) setStops(d.stops); })
      .catch(() => {});
  }, [shapesPath]);

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
          const res  = await fetch(`/api/${cityId}/departures?gid=${stop.id}`, { cache: 'no-store' });
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
