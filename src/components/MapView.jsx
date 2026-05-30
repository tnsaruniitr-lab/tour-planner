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
import { obfuscateName } from '../lib/obfuscate';
import { groupStopsBySpot } from '../lib/stops';

const LONDON = [51.505, -0.12];

// `count` > 1 marks a combined stop (several visits at one location) with a
// small badge, so a single dot still signals there is more underneath.
function stopIcon(color, n, count = 1) {
  const badge =
    count > 1
      ? `<span style="position:absolute;top:-7px;right:-7px;min-width:15px;height:15px;` +
        `padding:0 3px;border-radius:9px;background:#111;color:#fff;border:1.5px solid #fff;` +
        `font-size:10px;font-weight:700;line-height:15px;text-align:center;box-sizing:border-box;">${count}</span>`
      : '';
  return L.divIcon({
    className: 'stop-divicon',
    html: `<div class="stop-marker" style="background:${color};position:relative">${n}${badge}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Fit the viewport to the current day's stops — on plan change and on resize.
function FitBounds({ clusters }) {
  const map = useMap();
  // Refit only when the SET of tours changes (new day/plan), not when a stop is
  // dragged between existing tours — otherwise editing would jump the viewport.
  const sig = clusters.map((c) => c.id).join(',');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);
  return null;
}

// Ctrl/Cmd + wheel zooms (toward the cursor); a plain wheel scrolls the page,
// so the map never hijacks the page scroll.
function CtrlWheelZoom() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain scroll → page scrolls
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ll = map.containerPointToLatLng(
        L.point(e.clientX - r.left, e.clientY - r.top)
      );
      map.setZoomAround(ll, map.getZoom() + (e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [map]);
  return null;
}

// Keep every linked map at the same centre + zoom (a shared registry + guard
// flag prevent feedback loops). Lets two/three maps be compared at one scale.
function SyncMaps({ sync }) {
  const map = useMap();
  useEffect(() => {
    if (!sync) return;
    const { registry, flag } = sync;
    registry.current.push(map);
    const echo = () => {
      if (flag.current) return;
      flag.current = true;
      const c = map.getCenter();
      const z = map.getZoom();
      registry.current.forEach((m) => {
        if (m !== map) m.setView(c, z, { animate: false });
      });
      flag.current = false;
    };
    map.on('moveend', echo);
    map.on('zoomend', echo);
    return () => {
      map.off('moveend', echo);
      map.off('zoomend', echo);
      registry.current = registry.current.filter((m) => m !== map);
    };
  }, [map, sync]);
  return null;
}

export default function MapView({
  dayPlan,
  showZones = true,
  editable = false,
  onMoveStop,
  sync = null,
}) {
  const clusters = dayPlan?.clusters || [];

  return (
    <MapContainer
      center={LONDON}
      zoom={12}
      scrollWheelZoom={false}
      className="leaflet-container"
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        subdomains="abcd"
      />
      <FitBounds clusters={clusters} />
      <CtrlWheelZoom />
      <SyncMaps sync={sync} />

      {showZones &&
        clusters.map((c) => (
          <Circle
            key={'zone' + c.id}
            center={[c.center.lat, c.center.lng]}
            radius={c.radiusKm * 1000}
            pathOptions={{
              color: c.color,
              weight: 1.6,
              opacity: 0.6,
              fillColor: c.color,
              fillOpacity: 0.1,
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
        groupStopsBySpot(c.stops).map((g, gi) => {
          const onSite = g.members.reduce(
            (s, m) => s + (m.patient?.serviceTime || 0),
            0
          );
          const span = `${minToHHMM(g.members[0].arrive)}–${minToHHMM(
            g.members[g.members.length - 1].depart
          )}`;
          const combined = g.members.length > 1;
          const onePatient = g.names.length === 1;
          return (
            <Marker
              key={'stop' + c.id + '-' + gi}
              position={[g.lat, g.lng]}
              icon={stopIcon(c.color, gi + 1, g.members.length)}
              draggable={editable}
              eventHandlers={
                editable && onMoveStop
                  ? {
                      dragend: (e) => {
                        const ll = e.target.getLatLng();
                        onMoveStop(c.id, g.orders, [ll.lat, ll.lng]);
                      },
                    }
                  : undefined
              }
            >
              <Popup>
                {!combined ? (
                  <>
                    <div className="popup-title">
                      {obfuscateName(g.members[0].patient.name)}
                    </div>
                    {g.members[0].patient.address && (
                      <div className="popup-row">
                        {g.members[0].patient.address}
                      </div>
                    )}
                    <div className="popup-row popup-visit">Visit · {span}</div>
                    <div className="popup-row">Service: {onSite} min</div>
                  </>
                ) : (
                  <>
                    <div className="popup-title">
                      {onePatient
                        ? obfuscateName(g.names[0])
                        : `${g.names.length} patients · 1 stop`}
                    </div>
                    {g.members[0].patient.address && (
                      <div className="popup-row">
                        {g.members[0].patient.address}
                      </div>
                    )}
                    <div className="popup-row popup-visit">
                      {onePatient
                        ? `${g.members.length} service blocks`
                        : `${g.names.length} patients`}{' '}
                      · {span} · {onSite} min on site
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        borderTop: '1px solid #e2e2e2',
                        paddingTop: 4,
                      }}
                    >
                      {g.members.map((m, mi) => (
                        <div
                          key={mi}
                          className="popup-row"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <span>
                            {onePatient
                              ? `Block ${mi + 1}`
                              : obfuscateName(m.patient.name)}
                          </span>
                          <span style={{ whiteSpace: 'nowrap', opacity: 0.75 }}>
                            {minToHHMM(m.arrive)} · {m.patient?.serviceTime || 0}m
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Popup>
            </Marker>
          );
        })
      )}
    </MapContainer>
  );
}
