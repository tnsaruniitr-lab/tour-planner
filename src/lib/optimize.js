// Milk-run optimiser: take a FROZEN tour (its patients are fixed) and re-order
// it into the cleanest, shortest loop, then TIME it with the same scheduler the
// Auto plan uses — so a multi-visit patient's revisit is woven into the loop
// (other patients served during the gap) instead of the nurse idling. That
// keeps every tour inside its real shift window: morning stays morning.
import { haversine, centroidLatLng, coverageRadiusKm } from './geo';
import { simulateTour } from './schedule';
import { fetchTravelMatrix, straightLineMatrix } from './osrm';

// Match the planner's travel buffer so milk-run travel is measured on the
// SAME basis as the File plan (OSRM road time ×1.35, straight-line fallback).
const BUFFER_PCT = 35;

const SPEED_KMH = 30;
const TRAFFIC = 1.5; // straight-line inflated to approximate road time
// Repeat visits are nudged a few metres so a patient's two visits stay distinct
// dots (mirrors the planner's pipeline).
const REVISIT_OFFSET = { lat: 0.00025, lng: 0.00035 };

function legMin(a, b) {
  return (haversine(a, b) / SPEED_KMH) * 60 * TRAFFIC;
}

function pathTravel(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += legMin(pts[i - 1], pts[i]);
  return t;
}

// Polar-angle order around the centroid → a naturally circular starting tour.
function sweep(pts) {
  if (pts.length < 3) return pts.slice();
  const c = centroidLatLng(pts);
  return pts
    .map((p) => ({ p, a: Math.atan2(p.lat - c.lat, p.lng - c.lng) }))
    .sort((x, y) => x.a - y.a)
    .map((x) => x.p);
}

// 2-opt for an open path — reverses crossing segments until none shorten it.
function twoOpt(input) {
  const route = input.slice();
  const n = route.length;
  if (n < 4) return route;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const A = route[i - 1], B = route[i], C = route[k], D = route[k + 1];
        let before = 0, after = 0;
        if (A) { before += legMin(A, B); after += legMin(A, C); }
        if (D) { before += legMin(C, D); after += legMin(B, D); }
        if (after + 1e-9 < before) {
          let lo = i, hi = k;
          while (lo < hi) { const t = route[lo]; route[lo] = route[hi]; route[hi] = t; lo++; hi--; }
          improved = true;
        }
      }
    }
  }
  return route;
}

// Or-opt: relocate a single stop to its cheapest slot.
function orOpt1(input) {
  let best = input.slice();
  let bestCost = pathTravel(best);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < best.length; i++) {
      const node = best[i];
      const without = best.slice(0, i).concat(best.slice(i + 1));
      for (let j = 0; j <= without.length; j++) {
        const cand = without.slice(0, j).concat([node], without.slice(j));
        const c = pathTravel(cand);
        if (c + 1e-9 < bestCost) { best = cand; bestCost = c; improved = true; break; }
      }
      if (improved) break;
    }
  }
  return best;
}

// One patient object per patient id present in the cluster.
function clusterPatients(cluster) {
  const seen = new Map();
  for (const s of cluster.stops || []) {
    const p = s.patient;
    if (!p || p.id == null) continue;
    if (!seen.has(p.id)) {
      seen.set(p.id, { ...p, visitsPerDay: s.visitsTotal || p.visitsPerDay || 1 });
    }
  }
  return [...seen.values()];
}

// Optimise one frozen tour into a milk-run loop, correctly timed.
export async function optimizeCluster(cluster, opts = {}) {
  const gapMin = opts.gapMin ?? 150; // 2.5h floor between a patient's two visits
  const patients = clusterPatients(cluster);
  if (patients.length < 2) return cluster;

  // 1) circular geographic order (sweep seed → 2-opt → Or-opt)
  let order = twoOpt(orOpt1(twoOpt(sweep(patients))));
  // 2) pull multi-visit patients toward the front so the revisit has room
  //    inside the shift (same as the planner's pipeline).
  order = [...order].sort((a, b) => (b.visitsPerDay > 1) - (a.visitsPerDay > 1));

  // 3) time it with the SAME interleaving scheduler the Auto plan uses — it
  //    serves other patients during a revisit's gap rather than idling, so the
  //    clock never runs away past the shift. Travel uses OSRM road time (same
  //    basis as File) so the comparison is like-for-like.
  let matrix = await fetchTravelMatrix(order, BUFFER_PCT);
  if (!matrix) matrix = straightLineMatrix(order, SPEED_KMH, BUFFER_PCT);
  const start =
    cluster.shiftStartMin ??
    Math.min(...cluster.stops.map((s) => s.arrive ?? 480));
  const lengthMin = cluster.shiftLengthMin ?? 480;
  const sim = simulateTour(order, matrix, {
    shiftStartMin: start,
    shiftEndMin: start + lengthMin,
    gapMin,
  });

  const stops = sim.stops.map((s, i) => {
    const k = s.visitNum - 1;
    return {
      order: i + 1,
      patient: s.patient,
      visitNum: s.visitNum,
      visitsTotal: s.visitsTotal,
      isReturn: s.visitNum > 1,
      lat: s.patient.lat + k * REVISIT_OFFSET.lat,
      lng: s.patient.lng + k * REVISIT_OFFSET.lng,
      arrive: s.arrive,
      depart: s.depart,
    };
  });
  const center = centroidLatLng(patients);
  return {
    ...cluster,
    stops,
    routeLatLng: stops.map((s) => [s.lat, s.lng]),
    center,
    radiusKm: coverageRadiusKm(center, patients),
    serviceMin: sim.serviceMin,
    travelMin: Math.round(sim.travelMin),
    overflow: sim.overflow, // true if the tour runs past its shift end
    patientCount: patients.length,
  };
}

// Optimise every tour in a list (OSRM fetches run in parallel, like the
// planner). Returns a new clusters array.
export async function optimizeClusters(clusters, gapMin) {
  return Promise.all((clusters || []).map((c) => optimizeCluster(c, { gapMin })));
}

// Travel time (min, straight-line ×1.5) along points in their given order.
export function routeTravelMin(points) {
  return pathTravel(points || []);
}

// Best achievable open-path travel (sweep → 2-opt → Or-opt) for the same
// points — used to measure how much longer the actual order is than a clean loop.
export function optimalTravelMin(points) {
  if (!points || points.length < 2) return 0;
  return pathTravel(twoOpt(orOpt1(twoOpt(sweep(points)))));
}
