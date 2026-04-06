'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { EnrichedVehicle } from '@/types/vasttrafik';

// ─── Delay helpers ────────────────────────────────────────────────────────────

function ringColor(v: EnrichedVehicle): string {
  if (v.isCancelled)                   return '#6b7280';
  if (v.delayMinutes === null)          return 'transparent';
  if (v.delayMinutes > 5)              return '#ef4444';
  if (v.delayMinutes > 1)              return '#f59e0b';
  if (v.delayMinutes < -1)             return '#22c55e';
  return 'transparent';
}

function delayLabel(v: EnrichedVehicle): string {
  if (v.isCancelled)           return '✕';
  if (v.delayMinutes === null) return '';
  if (v.delayMinutes > 1)      return `+${Math.round(v.delayMinutes)}`;
  if (v.delayMinutes < -1)     return `${Math.round(v.delayMinutes)}`;
  return '';
}

function makeIcon(v: EnrichedVehicle): L.DivIcon {
  const ring   = ringColor(v);
  const label  = delayLabel(v);
  const border = ring !== 'transparent'
    ? `3px solid ${ring}`
    : `2px solid ${v.fgColor}44`;

  return L.divIcon({
    className:  '',
    iconSize:   [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="
        width:36px;height:36px;border-radius:50%;
        background:${v.bgColor};color:${v.fgColor};
        border:${border};
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:system-ui,sans-serif;font-weight:700;
        box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;
      ">
        <span style="font-size:10px;line-height:1">${v.lineName}</span>
        ${label ? `<span style="font-size:8px;line-height:1;opacity:.9">${label}</span>` : ''}
      </div>`,
  });
}

function tooltipHtml(v: EnrichedVehicle): string {
  const delayStr = v.isCancelled
    ? '<b style="color:#ef4444">Inställd</b>'
    : v.delayMinutes === null
      ? 'Ingen realtid'
      : v.delayMinutes > 1
        ? `<b style="color:#ef4444">+${Math.round(v.delayMinutes)} min sen</b>`
        : v.delayMinutes < -1
          ? `<b style="color:#22c55e">${Math.round(v.delayMinutes)} min tidig</b>`
          : '<b style="color:#64748b">I tid</b>';
  return `<b>Linje ${v.lineName}</b> · ${v.direction}${
    v.nextStopName ? `<br>→ ${v.nextStopName}` : ''
  }<br>${delayStr}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { vehicles: EnrichedVehicle[] }

export default function VehicleLayer({ vehicles }: Props) {
  const map     = useMap();
  const cluster = useRef<L.MarkerClusterGroup | null>(null);

  // Create cluster group once, add to map
  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius:       60,
      disableClusteringAtZoom: 15,   // explode to individual markers when zoomed in
      showCoverageOnHover:    false,
      spiderfyOnMaxZoom:      true,
      chunkedLoading:         true,
    });
    map.addLayer(group);
    cluster.current = group;
    return () => { map.removeLayer(group); };
  }, [map]);

  // On each data update: bulk-replace all markers
  useEffect(() => {
    const group = cluster.current;
    if (!group) return;

    group.clearLayers();

    const newMarkers = vehicles.map(v =>
      L.marker([v.lat, v.lng], { icon: makeIcon(v) })
        .bindTooltip(tooltipHtml(v), { direction: 'top', offset: [0, -20] })
    );

    group.addLayers(newMarkers); // single bulk re-cluster
  }, [vehicles]);

  return null;
}
