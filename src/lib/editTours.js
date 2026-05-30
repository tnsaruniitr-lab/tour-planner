// Manual stop reassignment for re-assembled tours.
// Move a patient stop from one tour to the nearest other tour, then rebuild
// both tours' geometry, clock and metrics. Pure functions (no UI / no async).
import { haversine, centroidLatLng, coverageRadiusKm } from './geo';

const SPEED_KMH = 30;
const TRAFFIC = 1.5; // straight-line travel inflated to approximate road time

function legMin(a, b) {
  return Math.round((haversine(a, b) / SPEED_KMH) * 60 * TRAFFIC);
}

// Recompute a tour from its stops (assumed already in visiting order):
// renumber, rebuild the route line, re-centre, re-walk the clock and totals.
function rebuild(cluster) {
  const stops = cluster.stops.map((s, i) => ({ ...s, order: i + 1 }));
  let serviceMin = 0;
  let travelMin = 0;
  let clock = stops.length ? stops[0].arrive : 0;
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) {
      const t = legMin(stops[i - 1], stops[i]);
      travelMin += t;
      clock += t;
    }
    const svc = stops[i].patient?.serviceTime || 0;
    stops[i] = { ...stops[i], arrive: clock, depart: clock + svc };
    clock += svc;
    serviceMin += svc;
  }
  const center = stops.length ? centroidLatLng(stops) : cluster.center;
  const radiusKm = stops.length ? coverageRadiusKm(center, stops) : 0;
  return {
    ...cluster,
    stops,
    routeLatLng: stops.map((s) => [s.lat, s.lng]),
    center,
    radiusKm,
    serviceMin,
    travelMin,
    patientCount: stops.length,
  };
}

// Move stop(s) out of cluster `fromId` into whichever other cluster is closest
// to the drop point, inserting next to that tour's nearest stop. `stopOrder`
// may be a single order or an array of orders (a combined stop — several
// co-located visits — moves together as one unit).
// Returns a new clusters array (both tours rebuilt) or the original on no-op.
export function moveStop(clusters, fromId, stopOrder, drop) {
  const orders = Array.isArray(stopOrder) ? stopOrder : [stopOrder];
  const from = clusters.find((c) => c.id === fromId);
  const moving = from?.stops.filter((s) => orders.includes(s.order)) || [];
  if (!moving.length) return clusters;

  let target = null;
  let bestKm = Infinity;
  for (const c of clusters) {
    if (c.id === fromId || !c.stops.length) continue;
    const km = Math.min(...c.stops.map((s) => haversine(drop, s)));
    if (km < bestKm) { bestKm = km; target = c; }
  }
  if (!target) return clusters;

  // Insert into the target's CHEAPEST EDGE — the gap between two consecutive
  // stops where adding the patient lengthens the route the least — judged by
  // the patient's own location (the drop only chose which tour to join). This
  // drops the dot onto the path between the two corner dots, not just after the
  // nearest one.
  const ref = moving[0];
  let insertAt = target.stops.length;
  let bestCost = Infinity;
  for (let i = 0; i <= target.stops.length; i++) {
    const prev = target.stops[i - 1];
    const next = target.stops[i];
    let cost;
    if (prev && next) {
      cost = haversine(prev, ref) + haversine(ref, next) - haversine(prev, next);
    } else if (prev) {
      cost = haversine(prev, ref); // append at the end
    } else {
      cost = haversine(ref, next); // prepend at the start
    }
    if (cost < bestCost) { bestCost = cost; insertAt = i; }
  }

  const fromStops = from.stops.filter((s) => !orders.includes(s.order));
  const targetStops = [
    ...target.stops.slice(0, insertAt),
    ...moving.map((s) => ({ ...s })),
    ...target.stops.slice(insertAt),
  ];
  return clusters.map((c) => {
    if (c.id === fromId) return rebuild({ ...c, stops: fromStops });
    if (c.id === target.id) return rebuild({ ...c, stops: targetStops });
    return c;
  });
}

// Refresh a re-assembled result's aggregate metrics after edits.
export function aggregate(result) {
  const clusters = result.clusters.filter((c) => c.stops.length);
  const serviceMin = clusters.reduce((s, c) => s + (c.serviceMin || 0), 0);
  const travelMin = clusters.reduce((s, c) => s + (c.travelMin || 0), 0);
  const working = serviceMin + travelMin;
  return {
    ...result,
    clusters: result.clusters,
    serviceMin,
    travelMin,
    tours: clusters.length,
    efficiency: working > 0 ? serviceMin / working : 0,
    travelPct: working > 0 ? travelMin / working : 0,
  };
}
