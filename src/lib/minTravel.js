// Third mode — "Min-travel": minimise total drive time, NOT visual circularity.
// Keeps the file's nurses and shift lengths (length = a hard capacity) and
// re-assigns patients between nurses to cut travel — a capacitated VRP solved by
// relocate local search, then each tour is routed + OSRM-timed by the milk-run
// optimiser. Per period (morning nurses never take evening patients).
import { haversine } from './geo';
import { optimizeCluster } from './optimize';

const SPEED_KMH = 30;
const TRAFFIC = 1.5;
const legMin = (a, b) => (haversine(a, b) / SPEED_KMH) * 60 * TRAFFIC;
const pSvc = (p) => (p.serviceTime || 0) * (p.visitsPerDay || 1);

// One patient object per id present in a seed cluster.
function clusterPatients(c) {
  const seen = new Map();
  for (const s of c.stops || []) {
    const p = s.patient;
    if (!p || p.id == null) continue;
    if (!seen.has(p.id)) seen.set(p.id, { ...p, visitsPerDay: s.visitsTotal || p.visitsPerDay || 1 });
  }
  return [...seen.values()];
}

function routeTravelSum(route) {
  let t = 0;
  for (let i = 1; i < route.length; i++) t += legMin(route[i - 1], route[i]);
  return t;
}
function svcLoad(route) {
  return route.reduce((s, p) => s + pSvc(p), 0);
}

// Travel saved by removing the stop at idx from a route.
function removalGain(route, idx) {
  const prev = route[idx - 1], cur = route[idx], next = route[idx + 1];
  let before = 0, after = 0;
  if (prev) before += legMin(prev, cur);
  if (next) before += legMin(cur, next);
  if (prev && next) after += legMin(prev, next);
  return before - after;
}
// Cheapest position (and its added travel) to insert p into a route.
function bestInsertion(route, p) {
  if (!route.length) return { pos: 0, cost: 0 };
  let best = { pos: route.length, cost: legMin(route[route.length - 1], p) };
  const pre = legMin(p, route[0]);
  if (pre < best.cost) best = { pos: 0, cost: pre };
  for (let i = 0; i < route.length - 1; i++) {
    const c = legMin(route[i], p) + legMin(p, route[i + 1]) - legMin(route[i], route[i + 1]);
    if (c < best.cost) best = { pos: i + 1, cost: c };
  }
  return best;
}

// Best-improvement relocate: repeatedly move the one patient whose relocation
// cuts total travel most, while respecting each tour's shift-length capacity and
// never emptying a nurse (staffing stays fixed).
function relocateSearch(slots) {
  let guard = 0;
  while (guard++ < 1000) {
    let best = null;
    for (let ai = 0; ai < slots.length; ai++) {
      const A = slots[ai];
      if (A.route.length <= 1) continue; // keep every nurse staffed
      for (let i = 0; i < A.route.length; i++) {
        const p = A.route[i];
        const gain = removalGain(A.route, i);
        for (let bi = 0; bi < slots.length; bi++) {
          if (bi === ai) continue;
          const B = slots[bi];
          const ins = bestInsertion(B.route, p);
          const newLoad = B.serviceLoad + pSvc(p) + B.routeTravel + ins.cost;
          if (newLoad > B.cap) continue;
          const delta = ins.cost - gain;
          if (delta < (best ? best.delta : -0.5)) {
            best = { ai, i, bi, pos: ins.pos, cost: ins.cost, gain, delta, p };
          }
        }
      }
    }
    if (!best) break;
    const A = slots[best.ai], B = slots[best.bi];
    A.route.splice(best.i, 1);
    A.routeTravel -= best.gain;
    A.serviceLoad -= pSvc(best.p);
    B.route.splice(best.pos, 0, best.p);
    B.routeTravel += best.cost;
    B.serviceLoad += pSvc(best.p);
  }
}

// Returns a new clusters array (same nurse slots, re-assigned + routed + OSRM-timed).
export async function optimizeTravel(reFile, opts = {}) {
  const gapMin = opts.gapMin ?? 150;
  const clusters = reFile?.clusters || [];
  const finalize = [];
  for (const period of ['morning', 'evening']) {
    const cls = clusters.filter((c) => c.period === period);
    if (!cls.length) continue;
    const slots = cls.map((c) => {
      const route = clusterPatients(c);
      return {
        id: c.id, color: c.color, period,
        shiftLengthMin: c.shiftLengthMin, shiftStartMin: c.shiftStartMin,
        cap: c.shiftLengthMin || 600,
        route, routeTravel: routeTravelSum(route), serviceLoad: svcLoad(route),
      };
    });
    relocateSearch(slots);
    for (const s of slots) {
      if (!s.route.length) continue;
      const cluster = {
        id: s.id, color: s.color, period: s.period,
        shiftLengthMin: s.shiftLengthMin, shiftStartMin: s.shiftStartMin,
        center: { lat: 0, lng: 0 }, radiusKm: 0,
        stops: s.route.map((p) => ({
          patient: p, visitsTotal: p.visitsPerDay || 1, visitNum: 1,
          lat: p.lat, lng: p.lng, arrive: s.shiftStartMin || 480, depart: s.shiftStartMin || 480,
        })),
      };
      finalize.push(optimizeCluster(cluster, { gapMin }));
    }
  }
  return Promise.all(finalize);
}
