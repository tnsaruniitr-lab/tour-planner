// Turn the file plan vs the re-plan into a prioritised, plain-English list of
// what's wrong and what the re-plan changes — biggest impact first. Every line
// is grounded in real geometry; the "fixes" are scouted from the re-assembled
// plan (re-sequencing, merging, reassignment), not invented.
import { haversine, centroidLatLng } from './geo';
import { routeTravelMin, optimalTravelMin } from './optimize';

const SPEED_KMH = 30;
const TRAFFIC = 1.5;
const kmToMin = (km) => Math.round((km / SPEED_KMH) * 60 * TRAFFIC);

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// toursForDate: the actual file tours. opts.reClusters / opts.nurseAssign: the
// re-plan + its nurse mapping (for reassignment fixes). Returns up to `limit`
// insights, highest impact (minutes) first.
export function buildInsights(toursForDate, opts = {}) {
  const cutoff = opts.cutoffMin ?? 720;
  const reClusters = opts.reClusters || [];
  const nurseAssign = opts.nurseAssign || {};
  const limit = opts.limit ?? 8;
  const out = [];

  const totSvc = toursForDate.reduce((s, t) => s + (t.serviceTimeMin || 0), 0);
  const totTrv = toursForDate.reduce((s, t) => s + (t.travelTimeMin || 0), 0);
  const dayTravelPct = totSvc + totTrv > 0 ? totTrv / (totSvc + totTrv) : 0;

  for (const t of toursForDate) {
    const vs = (t.visits || []).filter((v) => v.lat != null && v.lng != null);
    if (vs.length < 3) continue;

    // 1) Detour → re-sequence (same patients, 2-opt loop)
    const cur = routeTravelMin(vs);
    const opt = optimalTravelMin(vs);
    const saved = cur - opt;
    let hasDetour = false;
    if (cur > 0 && saved >= 8 && cur >= opt * 1.2) {
      hasDetour = true;
      out.push({
        id: 'detour-' + t.key,
        sev: saved >= 20 ? 'high' : 'med',
        impact: Math.round(saved),
        tourKey: t.key,
        title: `${t.nurseName}'s round zig-zags — ${Math.round((100 * saved) / cur)}% longer than a clean loop`,
        detail: `Re-sequence into a loop → ~${Math.round(saved)} min less driving, same patients.`,
      });
    }

    // 2) Outlier patient (one long hop vs the round's typical hop)
    const legs = [];
    for (let i = 1; i < vs.length; i++) legs.push(haversine(vs[i - 1], vs[i]));
    const med = median(legs.filter((x) => x > 0.05));
    const worstKm = Math.max(...legs);
    if (med > 0 && worstKm > Math.max(2, med * 3)) {
      const wi = legs.indexOf(worstKm);
      out.push({
        id: 'outlier-' + t.key,
        sev: worstKm > 5 ? 'high' : 'med',
        impact: kmToMin(worstKm),
        tourKey: t.key,
        title: `${t.nurseName} makes one long hop — ${worstKm.toFixed(1)} km to ${vs[wi + 1]?.patientName || 'a patient'}`,
        detail: `That leg is ${(worstKm / med).toFixed(0)}× the round's typical hop — a geographic outlier worth reassigning.`,
      });
    }

    // 3) Travel-heavy tour vs the day average — only if a detour isn't already
    //    explaining the heaviness (avoid two lines about the same bad route).
    const tp = (t.serviceTimeMin || 0) + (t.travelTimeMin || 0) > 0
      ? (t.travelTimeMin || 0) / ((t.serviceTimeMin || 0) + (t.travelTimeMin || 0))
      : 0;
    if (!hasDetour && tp > Math.max(0.3, dayTravelPct * 1.5)) {
      out.push({
        id: 'heavy-' + t.key,
        sev: tp > 0.45 ? 'high' : 'med',
        impact: Math.round((t.travelTimeMin || 0) - dayTravelPct * ((t.serviceTimeMin || 0) + (t.travelTimeMin || 0))),
        tourKey: t.key,
        title: `${t.nurseName} spends ${Math.round(tp * 100)}% of the shift driving (day avg ${Math.round(dayTravelPct * 100)}%)`,
        detail: `A travel-heavy round — tighter clustering or rebalancing would help.`,
      });
    }
  }

  // 5) Reassignment — scouted from the re-plan: a patient sitting much nearer
  //    another nurse's zone than their own.
  if (reClusters.length && Object.keys(nurseAssign).length) {
    const reByName = {};
    for (const c of reClusters) {
      const a = nurseAssign[c.id];
      const ctr = centroidLatLng(c.stops);
      for (const s of c.stops) {
        const nm = s.patient?.name;
        if (nm && !reByName[nm]) reByName[nm] = { nurse: a?.name, ctr };
      }
    }
    const tourCtr = {};
    for (const t of toursForDate) tourCtr[t.key] = centroidLatLng(t.visits.filter((v) => v.lat != null));
    const moves = [];
    const seen = new Set();
    for (const t of toursForDate) {
      for (const v of t.visits) {
        if (v.lat == null || seen.has(v.patientName)) continue;
        const re = reByName[v.patientName];
        if (!re || !re.nurse || re.nurse === t.nurseName) continue;
        const improveKm = haversine(v, tourCtr[t.key]) - haversine(v, re.ctr);
        if (haversine(v, tourCtr[t.key]) > 2 && improveKm > 1.5) {
          seen.add(v.patientName);
          moves.push({ name: v.patientName, from: t.nurseName, to: re.nurse, improveKm, tourKey: t.key });
        }
      }
    }
    moves.sort((a, b) => b.improveKm - a.improveKm);
    for (const m of moves.slice(0, 3)) {
      out.push({
        id: 'move-' + m.name,
        sev: 'med',
        impact: kmToMin(m.improveKm),
        tourKey: m.tourKey,
        title: `Move ${m.name} from ${m.from} to ${m.to}`,
        detail: `${m.name} sits ${m.improveKm.toFixed(1)} km closer to ${m.to}'s zone — the re-plan reassigns them.`,
      });
    }
  }

  out.sort((a, b) => (b.impact || 0) - (a.impact || 0));
  return out.slice(0, limit);
}
