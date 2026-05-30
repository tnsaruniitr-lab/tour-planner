// Stop grouping: a "stop" is one physical location a nurse arrives at once and
// serves before moving on. It can cover several visits — the same patient's
// back-to-back service blocks, or two different patients at one address (a
// couple / a shared building). On the map a stop is ONE dot; the popup card
// lists every visit inside it.

// Round to ~1 m so visits geocoded to the same address (identical cached
// coordinate) collapse, while genuinely different addresses stay apart.
const PREC = 1e5;
function key(p) {
  if (!p || p.lat == null || p.lng == null) return null;
  return Math.round(p.lat * PREC) + ',' + Math.round(p.lng * PREC);
}

export function sameSpot(a, b) {
  const ka = key(a);
  return ka != null && ka === key(b);
}

// Group an ordered list of stops/visits into runs that share a coordinate AND
// are consecutive in route order. Each group keeps its members (in order) and
// the underlying `orders` so a grouped marker can drag its whole stop at once.
// Used for MAP rendering — groups regardless of patient (one place = one dot).
export function groupStopsBySpot(stops) {
  const groups = [];
  for (const s of stops) {
    const last = groups[groups.length - 1];
    if (last && sameSpot(last, s)) {
      last.members.push(s);
    } else {
      groups.push({ lat: s.lat, lng: s.lng, members: [s] });
    }
  }
  for (const g of groups) {
    g.orders = g.members.map((m) => m.order);
    g.names = [...new Set(g.members.map((m) => m.patient?.name).filter(Boolean))];
  }
  return groups;
}

// Number of map dots a tour collapses to (distinct consecutive locations).
export function countStops(visits) {
  let n = 0;
  let prev = null;
  for (const v of visits) {
    if (!prev || !sameSpot(prev, v)) n++;
    prev = v;
  }
  return n;
}

// For RE-ASSEMBLY input only: merge a single patient's consecutive same-address
// service blocks into ONE visit (summed service time), so they are planned as
// one stop instead of being mis-modelled as two return trips an hour apart.
// Different patients at the same address are left separate (both must be kept).
export function mergeSamePatientRuns(visits) {
  const out = [];
  for (const v of visits) {
    const last = out[out.length - 1];
    if (last && last.patientName === v.patientName && sameSpot(last, v)) {
      last.visitDurationMin = (last.visitDurationMin || 0) + (v.visitDurationMin || 0);
      last.blockCount = (last.blockCount || 1) + 1;
    } else {
      out.push({ ...v });
    }
  }
  return out;
}
