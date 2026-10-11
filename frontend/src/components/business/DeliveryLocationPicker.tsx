import { useEffect, useRef } from 'react';
import L, { type Map as LeafletMap, type Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface DeliveryLocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  onChange: (latitude: number, longitude: number) => void;
}

const FALLBACK_CENTER: L.LatLngExpression = [2.0469, 45.3182];

export function DeliveryLocationPicker({
  latitude,
  longitude,
  centerLatitude,
  centerLongitude,
  onChange,
}: DeliveryLocationPickerProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const initialLocationRef = useRef({ latitude, longitude, centerLatitude, centerLongitude });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!elementRef.current) return;
    const initialLocation = initialLocationRef.current;
    const center: L.LatLngExpression = initialLocation.latitude !== null && initialLocation.longitude !== null
      ? [initialLocation.latitude, initialLocation.longitude]
      : initialLocation.centerLatitude !== null && initialLocation.centerLongitude !== null
        ? [initialLocation.centerLatitude, initialLocation.centerLongitude]
        : FALLBACK_CENTER;
    const map = L.map(elementRef.current, { scrollWheelZoom: false }).setView(center, 14);
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const markerIcon = L.divIcon({
      className: 'delivery-map-marker',
      html: '<span></span>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
    const setPin = (point: L.LatLng) => {
      if (!markerRef.current) {
        markerRef.current = L.marker(point, { draggable: true, icon: markerIcon }).addTo(map);
        markerRef.current.on('dragend', () => {
          const position = markerRef.current?.getLatLng();
          if (position) onChangeRef.current(Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6)));
        });
      } else {
        markerRef.current.setLatLng(point);
      }
      onChangeRef.current(Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6)));
    };
    map.on('click', (event) => setPin(event.latlng));
    if (initialLocation.latitude !== null && initialLocation.longitude !== null) {
      markerRef.current = L.marker([initialLocation.latitude, initialLocation.longitude], { draggable: true, icon: markerIcon }).addTo(map);
      markerRef.current.on('dragend', () => {
        const position = markerRef.current?.getLatLng();
        if (position) onChangeRef.current(Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6)));
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || latitude === null || longitude === null) return;
    const point: L.LatLngExpression = [latitude, longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(point, {
        draggable: true,
        icon: L.divIcon({ className: 'delivery-map-marker', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }),
      }).addTo(mapRef.current);
      markerRef.current.on('dragend', () => {
        const position = markerRef.current?.getLatLng();
        if (position) onChangeRef.current(Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6)));
      });
    } else {
      markerRef.current.setLatLng(point);
    }
    mapRef.current.setView(point, Math.max(mapRef.current.getZoom(), 14));
  }, [latitude, longitude]);

  return <div ref={elementRef} className="h-56 w-full overflow-hidden rounded-xl border border-navy-200" aria-label="Delivery location map" />;
}
