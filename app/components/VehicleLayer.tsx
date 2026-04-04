'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { EnrichedVehicle } from '@/types/vasttrafik';

function delayRingColor(v: EnrichedVehicle): string {
  if (v.isCancelled)                              return '#6b7280'; // grey
  if (v.delayMinutes === null)                    return 'transparent';
  if (v.delayMinutes > 5)                         return '#ef4444'; // red
  if (v.delayMinutes > 1)                         return '#f59e0b'; // amber
  if (v.delayMinutes < -1)                        return '#22c55e'; // green early
  return 'transparent'; // on time — no ring
}

function delayLabel(v: EnrichedVehicle): string {
  if (v.isCancelled)           return '✕';
  if (v.delayMinutes === null) return '';
  if (v.delayMinutes > 1)      return `+${Math.round(v.delayMinutes)}`;
  if (v.delayMinutes < -1)     return `${Math.round(v.delayMinutes)}`;
  return '';
}

function makeIcon(v: EnrichedVehicle): L.DivIcon {
  const ring  = delayRingColor(v);
  const label = delayLabel(v);
  const border = ring !== 'transparent' ? `3px solid ${ring}` : `2px solid ${v.fgColor}44`;

  return L.divIcon({
    className: '',
    iconSize:  [36, 36],
    iconAnchor:[18, 18],
    html: `
      <div style="
        width:36px;height:36px;border-radius:50%;
        background:${v.bgColor};color:${v.fgColor};
        border:${border};
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:system-ui,sans-serif;font-weight:700;
        box-shadow:0 1px 4px rgba(0,0,0,.4);
        cursor:pointer;
      ">
        <span style="font-size:10px;line-height:1">${v.lineName}</span>
        ${label ? `<span style="font-size:8px;line-height:1;opacity:.9">${label}</span>` : ''}
      </div>`,
  });
}

interface Props {
  vehicles: EnrichedVehicle[];
}

export default function VehicleLayer({ vehicles }: Props) {
  const map     = useMap();
  const markers = useRef(new Map<string, L.Marker>());

  useEffect(() => {
    const incoming = new Set(vehicles.map(v => v.id));

    // Remove stale markers
    for (const [id, marker] of markers.current) {
      if (!incoming.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }

    // Add or update markers
    for (const v of vehicles) {
      const existing = markers.current.get(v.id);
      const icon     = makeIcon(v);
      const tooltip  = `<b>Linje ${v.lineName}</b><br>${v.direction}${
        v.nextStopName ? `<br>→ ${v.nextStopName}` : ''
      }${v.delayMinutes !== null ? `<br><b>${delayLabel(v) || 'I tid'}</b>` : ''}`;

      if (existing) {
        existing.setLatLng([v.lat, v.lng]);
        existing.setIcon(icon);
        existing.setTooltipContent(tooltip);
      } else {
        const marker = L.marker([v.lat, v.lng], { icon })
          .bindTooltip(tooltip, { direction: 'top', offset: [0, -20] })
          .addTo(map);
        markers.current.set(v.id, marker);
      }
    }
  }, [vehicles, map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { markers.current.forEach(m => m.remove()); markers.current.clear(); };
  }, []);

  return null;
}
