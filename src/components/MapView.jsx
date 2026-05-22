import { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Circle,
  Polyline,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { minToHHMM } from '../lib/schedule';

const LONDON = [51.505, -0.12];

function stopIcon(color, n) {
  return L.divIcon({
    className: 'stop-divicon',
    html: `<div class="stop-marker" style="background:${color}">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Fit the viewport to the current day's stops — on plan change and on resize.
function FitBounds({ clusters }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      const pts = [];
      clusters.forEach((c) => c.routeLatLng.forEach((ll) => pts.push(ll)));
      if (pts.length) {
        map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 });
      }
    };
    fit();
    map.on('resize', fit);
    return () => map.off('resize', fit);
  }, [clusters, map]);
  return null;
}

export default function MapView({ dayPlan, showZones = true, scrollZoom = true }) {
  const clusters = dayPlan?.clusters || [];

  return (
    <MapContainer
      center={LONDON}
      zoom={12}
      scrollWheelZoom={scrollZoom}
      className="leaflet-container"
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        subdomains="abcd"
      />
      <FitBounds clusters={clusters} />

      {showZones &&
        clusters.map((c) => (
          <Circle
            key={'zone' + c.id}
            center={[c.center.lat, c.center.lng]}
            radius={c.radiusKm * 1000}
            pathOptions={{
              color: c.color,
              weight: 1.2,
              opacity: 0.5,
              fillColor: c.color,
              fillOpacity: 0.09,
            }}
          />
        ))}

      {clusters.map((c) => (
        <Polyline
          key={'route' + c.id}
          positions={c.routeLatLng}
          pathOptions={{ color: c.color, weight: 3, opacity: 0.85 }}
        />
      ))}

      {clusters.map((c) =>
        c.stops.map((s) => (
          <Marker
            key={'stop' + c.id + '-' + s.order}
            position={[s.lat, s.lng]}
            icon={stopIcon(c.color, s.order)}
          >
            <Popup>
              <div className="popup-title">{s.patient.name}</div>
              {s.patient.address && (
                <div className="popup-row">{s.patient.address}</div>
              )}
              <div className="popup-row popup-visit">
                {s.visitsTotal > 1
                  ? `Visit ${s.visitNum} of ${s.visitsTotal}`
                  : 'Visit'}{' '}
                · {minToHHMM(s.arrive)}–{minToHHMM(s.depart)}
              </div>
              <div className="popup-row">Service: {s.patient.serviceTime} min</div>
            </Popup>
          </Marker>
        ))
      )}
    </MapContainer>
  );
}
