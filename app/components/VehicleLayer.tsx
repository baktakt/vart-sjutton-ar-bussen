'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { EnrichedVehicle } from '@/types/vasttrafik';

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function ringColor(v: EnrichedVehicle): string {
  if (v.isCancelled)          return '#6b7280';
  if (v.delayMinutes === null) return 'transparent';
  if (v.delayMinutes > 5)     return '#ef4444';
  if (v.delayMinutes > 1)     return '#f59e0b';
  if (v.delayMinutes < -1)    return '#22c55e';
  return 'transparent';
}

function delayLabel(v: EnrichedVehicle): string {
  if (v.isCancelled)           return '✕';
  if (v.delayMinutes === null)  return '';
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

// ─── Animation helpers ────────────────────────────────────────────────────────

interface AnimState {
  fromLat: number;
  fromLng: number;
  toLat:   number;
  toLng:   number;
  startMs: number;
  durMs:   number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Vehicles rarely travel >1 km between 15s polls; if they do it's a GPS glitch
const TELEPORT_THRESHOLD_DEG = 0.01; // ~1 km
const POLL_MS    = 15_000;
const RAF_STEP   = 100; // ms between position updates (~10 fps)

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { vehicles: EnrichedVehicle[] }

export default function VehicleLayer({ vehicles }: Props) {
  const map        = useMap();
  const cluster    = useRef<L.MarkerClusterGroup | null>(null);
  const markers    = useRef(new Map<string, L.Marker>());
  const animStates = useRef(new Map<string, AnimState>());
  const rafId      = useRef<number | null>(null);
  const lastStep   = useRef(0);

  // ── Create cluster group once ──────────────────────────────────────────────
  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius:        60,
      disableClusteringAtZoom: 15,
      showCoverageOnHover:     false,
      spiderfyOnMaxZoom:       true,
      chunkedLoading:          true,
    });
    map.addLayer(group);
    cluster.current = group;
    return () => { map.removeLayer(group); };
  }, [map]);

  // ── RAF animation loop (runs for lifetime of component) ───────────────────
  useEffect(() => {
    const tick = (ts: number) => {
      rafId.current = requestAnimationFrame(tick);

      // Throttle updates
      if (ts - lastStep.current < RAF_STEP) return;
      lastStep.current = ts;

      if (animStates.current.size === 0) return;

      const now = Date.now();
      for (const [id, anim] of animStates.current) {
        const marker = markers.current.get(id);
        if (!marker) continue;
        const t = Math.min(1, (now - anim.startMs) / anim.durMs);
        marker.setLatLng([lerp(anim.fromLat, anim.toLat, t), lerp(anim.fromLng, anim.toLng, t)]);
      }
    };

    rafId.current = requestAnimationFrame(tick);
    return () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current); };
  }, []); // start once

  // ── Diff incoming vehicles against persistent markers ─────────────────────
  useEffect(() => {
    const group = cluster.current;
    if (!group) return;

    const now      = Date.now();
    const incoming = new Map(vehicles.map(v => [v.id, v]));

    // Remove vehicles that are no longer reported
    for (const [id, marker] of markers.current) {
      if (!incoming.has(id)) {
        group.removeLayer(marker);
        markers.current.delete(id);
        animStates.current.delete(id);
      }
    }

    // Update existing or create new markers
    for (const v of vehicles) {
      const existing = markers.current.get(v.id);

      if (existing) {
        const pos  = existing.getLatLng();
        const dist = Math.hypot(v.lat - pos.lat, v.lng - pos.lng);
        const snap = dist > TELEPORT_THRESHOLD_DEG;

        animStates.current.set(v.id, {
          fromLat: snap ? v.lat : pos.lat,
          fromLng: snap ? v.lng : pos.lng,
          toLat:   v.lat,
          toLng:   v.lng,
          startMs: now,
          durMs:   snap ? 1 : POLL_MS,
        });

        // Update icon in case delay status changed
        existing.setIcon(makeIcon(v));
        existing.setTooltipContent(tooltipHtml(v));
      } else {
        // First time we see this vehicle — place immediately, no animation
        animStates.current.set(v.id, {
          fromLat: v.lat, fromLng: v.lng,
          toLat:   v.lat, toLng:   v.lng,
          startMs: now,   durMs:   POLL_MS,
        });
        const marker = L.marker([v.lat, v.lng], { icon: makeIcon(v) })
          .bindTooltip(tooltipHtml(v), { direction: 'top', offset: [0, -20] });
        group.addLayer(marker);
        markers.current.set(v.id, marker);
      }
    }
  }, [vehicles]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    markers.current.clear();
    animStates.current.clear();
  }, []);

  return null;
}
