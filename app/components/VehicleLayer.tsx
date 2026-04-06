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
  if (v.isCancelled)           return '#6b7280';
  if (v.delayMinutes === null)  return 'transparent';
  if (v.delayMinutes > 5)      return '#ef4444';
  if (v.delayMinutes > 1)      return '#f59e0b';
  if (v.delayMinutes < -1)     return '#22c55e';
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
        box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer;">
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

/**
 * A stable key that represents the vehicle's visual state.
 * setIcon is only called when this changes, preventing tooltip flicker.
 */
function iconKey(v: EnrichedVehicle): string {
  return `${v.lineName}|${v.delayMinutes ?? 'null'}|${v.isCancelled}`;
}

// ─── Animation ────────────────────────────────────────────────────────────────

interface AnimState {
  fromLat: number;
  fromLng: number;
  toLat:   number;
  toLng:   number;
  startMs: number;
  durMs:   number;
  // Cached rendered position — avoids calling getLatLng() each RAF tick
  curLat:  number;
  curLng:  number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// If a vehicle moves more than ~1 km between polls it's a GPS jump — snap instead
const TELEPORT_DEG = 0.01;
const POLL_MS      = 15_000;
// Skip a setLatLng call if the new position is indistinguishably close to current
const MIN_DELTA    = 1e-7;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { vehicles: EnrichedVehicle[] }

export default function VehicleLayer({ vehicles }: Props) {
  const map        = useMap();
  const cluster    = useRef<L.MarkerClusterGroup | null>(null);
  const markers    = useRef(new Map<string, L.Marker>());
  const animStates = useRef(new Map<string, AnimState>());
  const iconKeys   = useRef(new Map<string, string>());   // last-rendered icon state
  const rafId      = useRef<number | null>(null);

  // ── Cluster group ──────────────────────────────────────────────────────────
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

  // ── 60 fps RAF loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      rafId.current = requestAnimationFrame(tick);
      if (animStates.current.size === 0) return;

      const now = Date.now();
      for (const [id, anim] of animStates.current) {
        if (anim.startMs === 0) continue; // static / not yet moving
        const t   = Math.min(1, (now - anim.startMs) / anim.durMs);
        const lat = lerp(anim.fromLat, anim.toLat, t);
        const lng = lerp(anim.fromLng, anim.toLng, t);

        // Skip DOM update if movement is sub-pixel
        if (Math.abs(lat - anim.curLat) < MIN_DELTA && Math.abs(lng - anim.curLng) < MIN_DELTA) continue;

        markers.current.get(id)?.setLatLng([lat, lng]);
        anim.curLat = lat;
        anim.curLng = lng;
      }
    };
    rafId.current = requestAnimationFrame(tick);
    return () => { if (rafId.current !== null) cancelAnimationFrame(rafId.current); };
  }, []);

  // ── Diff incoming vehicles ─────────────────────────────────────────────────
  useEffect(() => {
    const group = cluster.current;
    if (!group) return;

    const now      = Date.now();
    const incoming = new Map(vehicles.map(v => [v.id, v]));

    // Remove departed vehicles
    for (const [id, marker] of markers.current) {
      if (!incoming.has(id)) {
        group.removeLayer(marker);
        markers.current.delete(id);
        animStates.current.delete(id);
        iconKeys.current.delete(id);
      }
    }

    for (const v of vehicles) {
      const existing = markers.current.get(v.id);
      const prevAnim = animStates.current.get(v.id);

      if (existing) {
        // Use our cached position as the animation origin (avoids getLatLng() call)
        const fromLat = prevAnim?.curLat ?? v.lat;
        const fromLng = prevAnim?.curLng ?? v.lng;
        const dist    = Math.hypot(v.lat - fromLat, v.lng - fromLng);
        const snap    = dist > TELEPORT_DEG;

        animStates.current.set(v.id, {
          fromLat: snap ? v.lat : fromLat,
          fromLng: snap ? v.lng : fromLng,
          toLat:   v.lat,
          toLng:   v.lng,
          startMs: now,
          durMs:   snap ? 1 : POLL_MS,
          curLat:  snap ? v.lat : fromLat,
          curLng:  snap ? v.lng : fromLng,
        });

        // Only rebuild the icon if delay / cancelled state has changed.
        // This prevents the tooltip from flickering on every poll.
        const key = iconKey(v);
        if (iconKeys.current.get(v.id) !== key) {
          existing.setIcon(makeIcon(v));
          existing.setTooltipContent(tooltipHtml(v));
          iconKeys.current.set(v.id, key);
        }
      } else {
        // First sighting — place immediately
        animStates.current.set(v.id, {
          fromLat: v.lat, fromLng: v.lng,
          toLat:   v.lat, toLng:   v.lng,
          startMs: 0,     durMs:   POLL_MS,
          curLat:  v.lat, curLng:  v.lng,
        });
        iconKeys.current.set(v.id, iconKey(v));

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
    iconKeys.current.clear();
  }, []);

  return null;
}
