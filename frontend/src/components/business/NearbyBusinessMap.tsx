import { useEffect, useRef } from 'react';
import L, { type LayerGroup, type Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NearbyBusiness } from '../../types';

interface NearbyBusinessMapProps {
  businesses: NearbyBusiness[];
  origin: { lat: number; lng: number };
  ariaLabel: string;
  originLabel: string;
}

export function NearbyBusinessMap({ businesses, origin, ariaLabel, originLabel }: NearbyBusinessMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!elementRef.current) return;
    const map = L.map(elementRef.current, { scrollWheelZoom: false }).setView(
      [origin.lat, origin.lng],
      12,
    );
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, [origin.lat, origin.lng]);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    if (!map || !markers) return;

    markers.clearLayers();
    const points: L.LatLngExpression[] = [[origin.lat, origin.lng]];
    L.circleMarker([origin.lat, origin.lng], {
      radius: 8,
      color: '#1d4ed8',
      fillColor: '#3b82f6',
      fillOpacity: 1,
      weight: 2,
    }).bindTooltip(originLabel).addTo(markers);

    for (const business of businesses) {
      points.push([business.latitude, business.longitude]);
      const popup = document.createElement('div');
      const link = document.createElement('a');
      link.href = `/business/${encodeURIComponent(business.business_slug)}`;
      link.textContent = business.business_name;
      link.className = 'font-semibold text-primary-700';
      popup.append(link);
      L.circleMarker([business.latitude, business.longitude], {
        radius: 7,
        color: '#047857',
        fillColor: '#10b981',
        fillOpacity: 0.9,
        weight: 2,
      }).bindPopup(popup).addTo(markers);
    }

    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 14 });
    } else {
      map.setView([origin.lat, origin.lng], 13);
    }
  }, [businesses, origin.lat, origin.lng, originLabel]);

  return (
    <div
      ref={elementRef}
      className="h-80 w-full overflow-hidden rounded-xl border border-navy-200"
      aria-label={ariaLabel}
    />
  );
}
