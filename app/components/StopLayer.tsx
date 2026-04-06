'use client';

import { useEffect, useRef, useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const MIN_ZOOM = 15; // only show stops when zoomed in enough

export default function StopLayer() {
  const map  = useMap();
  const [stops,    setStops]    = useState<Stop[]>([]);
  const [viewport, setViewport] = useState(0); // bumped on move/zoom to re-filter
  const [zoom,     setZoom]     = useState(map.getZoom());
  const markers = useRef(new Map<string, L.CircleMarker>());

  useMapEvents({
    zoomend: () => { setZoom(map.getZoom()); setViewport(v => v + 1); },
    moveend: ()  => setViewport(v => v + 1),
  });

  // Load stops.json once
  useEffect(() => {
    fetch('/shapes/stops.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.stops) setStops(d.stops); })
      .catch(() => {});
  }, []);

  // Add/remove circle markers based on zoom + viewport
  useEffect(() => {
    if (zoom < MIN_ZOOM || stops.length === 0) {
      // Remove all markers when zoomed out
      markers.current.forEach(m => m.remove());
      markers.current.clear();
      return;
    }

    const bounds  = map.getBounds();
    const visible = new Set(
      stops
        .filter(s => bounds.contains([s.lat, s.lng]))
        .map(s => s.id)
    );

    // Remove markers no longer in viewport
    for (const [id, marker] of markers.current) {
      if (!visible.has(id)) { marker.remove(); markers.current.delete(id); }
    }

    // Add new in-viewport markers
    for (const stop of stops) {
      if (!visible.has(stop.id) || markers.current.has(stop.id)) continue;
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius:      5,
        color:       '#ffffff',
        weight:      2,
        fillColor:   '#1e293b',
        fillOpacity: 0.9,
      })
        .bindTooltip(stop.name, { direction: 'top', offset: [0, -6] })
        .addTo(map);
      markers.current.set(stop.id, marker);
    }

    return () => {};
  }, [zoom, viewport, stops, map]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { markers.current.forEach(m => m.remove()); markers.current.clear(); };
  }, []);

  return null;
}
