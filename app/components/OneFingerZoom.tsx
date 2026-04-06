'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

const DOUBLE_TAP_MS = 300; // max gap between two taps
const PX_PER_ZOOM   = 60;  // pixels of drag per zoom level

/**
 * Adds the Google Maps / Apple Maps one-finger zoom gesture:
 *   double-tap + hold → drag down to zoom in, drag up to zoom out.
 *
 * Works alongside normal pinch-to-zoom and tap interactions.
 */
export default function OneFingerZoom() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    let lastTapTime = 0;
    let zoomActive  = false;
    let startY      = 0;
    let startZoom   = 0;

    const onTouchStart = (e: TouchEvent) => {
      // Ignore multi-touch — that's pinch zoom territory
      if (e.touches.length !== 1) { zoomActive = false; return; }

      const now         = Date.now();
      const isDoubleTap = now - lastTapTime < DOUBLE_TAP_MS;
      lastTapTime       = now;

      if (isDoubleTap) {
        zoomActive = true;
        startY     = e.touches[0].clientY;
        startZoom  = map.getZoom();
        // Prevent Leaflet's built-in double-tap zoom and map pan
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!zoomActive || e.touches.length !== 1) return;
      // Drag down → zoom in (positive dy → higher zoom)
      const dy      = e.touches[0].clientY - startY;
      const newZoom = startZoom + dy / PX_PER_ZOOM;
      map.setZoom(newZoom, { animate: false });
      e.preventDefault();
    };

    const onTouchEnd = () => { zoomActive = false; };

    // capture: true so we run before Leaflet's own touch listeners
    container.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
    container.addEventListener('touchmove',  onTouchMove,  { passive: false });
    container.addEventListener('touchend',   onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart, { capture: true });
      container.removeEventListener('touchmove',  onTouchMove);
      container.removeEventListener('touchend',   onTouchEnd);
    };
  }, [map]);

  return null;
}
