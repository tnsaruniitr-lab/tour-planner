// Milk-run optimiser: take a FROZEN tour (its set of stops is fixed) and
// re-order it into the cleanest, shortest loop — 2-opt removes crossings,
// Or-opt relocates stragglers, a polar "sweep" gives a circular seed.
//
// The hard constraint: a multi-visit patient (two visits split by the time
// gap) must still be visited twice, ≥ gap apart. Those second visits are held
// out of the free re-ordering and then slotted back in at the CHEAPEST point
// that still satisfies the gap — so a revisit rides the natural return leg
// instead of forcing a backtrack.
import { haversine, centroidLatLng, coverageRadiusKm } from './geo';

const SPEED_KMH = 30;
const TRAFFIC = 1.5; // straight-line inflated to approximate road time

function legMin(a, b) {
  return (haversine(a, b) / SPEED_KMH) * 60 * TRAFFIC;
}

// Travel time along an OPEN path (no return-to-start leg).
function pathTravel(stops) {
  let t = 0;
  for (let i = 1; i < stops.length; i++) t += legMin(stops[i - 1], stops[i]);
  return t;
}

// Polar-angle order around the centroid → a naturally circular starting tour.
function sweep(stops) {
  if (stops.length < 3) return stops.slice();
  const c = centroidLatLng(stops);
  return stops
    .map((s) => ({ s, a: Math.atan2(s.lat - c.lat, s.lng - c.lng) }))
    .sort((x, y) => x.a - y.a)
    .map((x) => x.s);
}

// 2-opt for an open path (delta-evaluated). Reverses crossing segments until
// no swap shortens the route — the result has no crossings = "circular".
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

// Or-opt: relocate a single stop to its cheapest slot (catches what 2-opt misses).
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

// Arrival clock for each position in an order, from a fixed start time.
function arrives(order, clockStart) {
  const out = [];
  let clock = clockStart;
  for (let i = 0; i < order.length; i++) {
    if (i > 0) clock += legMin(order[i - 1], order[i]);
    out.push(clock);
    clock += order[i].patient?.serviceTime || 0;
  }
  return out;
}

// Slot a repeat visit into the cheapest position AFTER its first visit that
// still leaves ≥ gapMin between the two arrivals (the gap is a minimum, so we
// use the whole remaining window to find the least-detour spot).
function insertRepeat(order, repeat, gapMin, clockStart) {
  const pid = repeat.patient?.id;
  const fi = order.findIndex((s) => s.patient?.id === pid);
  if (fi < 0) return order.concat([repeat]);
  // Prefer the cheapest slot where the gap is already met without waiting;
  // if the tour is too short for that, fall back to the cheapest slot overall
  // (recompute() then enforces the gap by waiting, exactly like the scheduler).
  let bestPos = -1, bestCost = Infinity; // gap satisfied, no wait
  let anyPos = -1, anyCost = Infinity; // cheapest regardless
  for (let pos = fi + 1; pos <= order.length; pos++) {
    const cand = order.slice(0, pos).concat([repeat], order.slice(pos));
    const cost = pathTravel(cand);
    if (cost < anyCost) { anyCost = cost; anyPos = pos; }
    const a = arrives(cand, clockStart);
    if (a[pos] - a[fi] >= gapMin && cost < bestCost) { bestCost = cost; bestPos = pos; }
  }
  const pos = bestPos >= 0 ? bestPos : anyPos;
  return order.slice(0, pos).concat([repeat], order.slice(pos));
}

// Renumber, re-walk the clock, and refresh geometry/metrics for a new order.
// A repeat visit (visitNum > 1) is held until ≥ gapMin after the patient's
// first visit — waiting if the route reaches it sooner — so the time-gap
// constraint is guaranteed regardless of where it was slotted.
function recompute(cluster, order, clockStart, gapMin = 0) {
  const stops = order.map((s, i) => ({ ...s, order: i + 1 }));
  let clock = clockStart;
  let serviceMin = 0;
  let travelMin = 0;
  const firstArrive = {};
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) { const t = legMin(stops[i - 1], stops[i]); travelMin += t; clock += t; }
    const s = stops[i];
    const pid = s.patient?.id;
    if (s.visitNum > 1 && pid != null && firstArrive[pid] != null) {
      const earliest = firstArrive[pid] + gapMin;
      if (clock < earliest) clock = earliest; // wait to honour the gap
    }
    const svc = s.patient?.serviceTime || 0;
    s.arrive = clock;
    s.depart = clock + svc;
    if (pid != null && firstArrive[pid] == null) firstArrive[pid] = clock;
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
    travelMin: Math.round(travelMin),
    patientCount: stops.length,
  };
}

// Optimise one frozen tour into a milk-run loop.
export function optimizeCluster(cluster, opts = {}) {
  const gapMin = opts.gapMin ?? 180;
  const stops = cluster.stops || [];
  if (stops.length < 2) return cluster;
  const clockStart = Math.min(...stops.map((s) => s.arrive ?? 0));

  // Hold out repeat (2nd+) visits; freely re-order everything else.
  const base = stops.filter((s) => !(s.visitNum > 1));
  const repeats = stops.filter((s) => s.visitNum > 1);

  let order = twoOpt(orOpt1(twoOpt(sweep(base))));
  for (const r of repeats) order = insertRepeat(order, r, gapMin, clockStart);

  return recompute(cluster, order, clockStart, gapMin);
}

// Optimise every tour in a list. Returns a new clusters array.
export function optimizeClusters(clusters, gapMin) {
  return (clusters || []).map((c) => optimizeCluster(c, { gapMin }));
}
