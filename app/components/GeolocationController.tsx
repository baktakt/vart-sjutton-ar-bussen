'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface Props {
  triggerRef: React.MutableRefObject<(() => void) | null>;
  onLocation: (bounds: string) => void;
  onError?: (msg: string) => void;
}

export default function GeolocationController({ triggerRef, onLocation, onError }: Props) {
  const map    = useMap();
  const dotRef = useRef<L.Marker | null>(null);

  const locate = () => {
    if (!navigator.geolocation) {
      onError?.('Geolocation stöds inte av din webbläsare');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lng } = coords;

        // Remove old dot
        dotRef.current?.remove();

        // Pulsing "you are here" marker using a divIcon
        const icon = L.divIcon({
          className: '',
          html: '<div class="user-location-dot"></div>',
          iconSize:   [20, 20],
          iconAnchor: [10, 10],
        });
        dotRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
          .bindTooltip('Du är här', { direction: 'top', offset: [0, -12] })
          .addTo(map);

        // Fly to user at close zoom
        map.flyTo([lat, lng], 16, { duration: 1.2 });

        // Build tight bbox (~2 km around user) and notify parent
        const dLat = 0.018;
        const dLng = 0.025;
        const bounds = [
          (lat - dLat).toFixed(5),
          (lng - dLng).toFixed(5),
          (lat + dLat).toFixed(5),
          (lng + dLng).toFixed(5),
        ].join(',');
        onLocation(bounds);
      },
      (err) => {
        const msg = err.code === 1
          ? 'Platsbehörighet nekades'
          : err.code === 2
          ? 'Positionen kunde inte fastställas'
          : 'Timeout vid platshämtning';
        onError?.(msg);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  // Auto-trigger on mount
  useEffect(() => {
    locate();
    return () => { dotRef.current?.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose re-trigger for the header button
  useEffect(() => {
    triggerRef.current = locate;
  });

  return null;
}
