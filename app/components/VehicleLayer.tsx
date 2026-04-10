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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Duration of the fade-out and fade-in transitions in ms. */
const FADE_MS = 280;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { vehicles: EnrichedVehicle[] }

export default function VehicleLayer({ vehicles }: Props) {
  const map      = useMap();
  const cluster  = useRef<L.MarkerClusterGroup | null>(null);
  const markers  = useRef(new Map<string, L.Marker>());
  const iconKeys = useRef(new Map<string, string>());   // last-rendered icon state
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => {
      map.removeLayer(group);
      cluster.current = null; // prevent stale ref: removeLayer clears _zoom, addLayers would throw
    };
  }, [map]);

  // ── Diff incoming vehicles with fade transition ────────────────────────────
  useEffect(() => {
    const group = cluster.current;
    // Guard: if the group has been removed from the map its internal state is
    // torn down. addLayers would throw "Cannot read properties of undefined
    // (reading '_zoom')". Check _map which is cleared on removeLayer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!group || !(group as any)._map) return;

    // Cancel any in-flight fade from a previous update
    if (fadeTimer.current !== null) clearTimeout(fadeTimer.current);

    // Step 1 — fade out all currently visible markers
    for (const [, marker] of markers.current) {
      const el = marker.getElement();
      if (el) {
        el.style.transition = `opacity ${FADE_MS}ms ease`;
        el.style.opacity = '0';
      }
    }

    // Step 2 — after fade-out, reposition and fade back in
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      const g = cluster.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!g || !(g as any)._map) return;

      const incoming = new Map(vehicles.map(v => [v.id, v]));

      // Remove departed vehicles
      for (const [id, marker] of markers.current) {
        if (!incoming.has(id)) {
          try { g.removeLayer(marker); } catch { /* marker already detached */ }
          markers.current.delete(id);
          iconKeys.current.delete(id);
        }
      }

      const newMarkers: L.Marker[] = [];

      for (const v of vehicles) {
        const existing = markers.current.get(v.id);

        if (existing) {
          // Reposition in place — only happens once per 15 s, so no event-flood concern
          existing.setLatLng([v.lat, v.lng]);

          // Only rebuild icon if visual state changed — avoids tooltip flicker
          const key = iconKey(v);
          if (iconKeys.current.get(v.id) !== key) {
            existing.setIcon(makeIcon(v));
            existing.setTooltipContent(tooltipHtml(v));
            iconKeys.current.set(v.id, key);
          }

          // Fade back in
          const el = existing.getElement();
          if (el) {
            el.style.transition = `opacity ${FADE_MS}ms ease`;
            el.style.opacity = '1';
          }
        } else {
          // First sighting — queue for bulk addLayers, will fade in once in DOM
          iconKeys.current.set(v.id, iconKey(v));
          const marker = L.marker([v.lat, v.lng], { icon: makeIcon(v) })
            .bindTooltip(tooltipHtml(v), { direction: 'top', offset: [0, -20] });
          markers.current.set(v.id, marker);
          newMarkers.push(marker);
        }
      }

      // Bulk-add new markers (single cluster recalculation instead of N)
      if (newMarkers.length > 0) {
        try {
          g.addLayers(newMarkers);
        } catch (err) {
          console.warn('[VehicleLayer] addLayers failed, falling back to addLayer:', err);
          newMarkers.forEach(m => { try { g.addLayer(m); } catch {} });
        }

        // Fade in newly added markers on next frame (element exists in DOM now)
        requestAnimationFrame(() => {
          for (const m of newMarkers) {
            const el = m.getElement();
            if (!el) continue;
            // Start hidden, then transition to visible
            el.style.transition = 'none';
            el.style.opacity = '0';
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            void el.offsetHeight; // force reflow so transition fires
            el.style.transition = `opacity ${FADE_MS}ms ease`;
            el.style.opacity = '1';
          }
        });
      }
    }, FADE_MS);
  }, [vehicles]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (fadeTimer.current !== null) clearTimeout(fadeTimer.current);
    markers.current.clear();
    iconKeys.current.clear();
  }, []);

  return null;
}
