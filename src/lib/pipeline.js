import { projectToPlane, centroidLatLng, coverageRadiusKm } from './geo';
import { clusterItems } from './cluster';
import { routeOrder } from './route';
import { simulateTour } from './schedule';
import { fetchTravelMatrix, straightLineMatrix } from './osrm';
import { distributeByDay, WEEKDAYS } from './days';
import { clusterColor } from './colors';

// Of a shift's length, the share assumed available for service work — the
// rest is reserved for travel between stops.
const SERVICE_SHARE = 0.85;

const REVISIT_OFFSET = { lat: 0.00025, lng: 0.00035 };

function offsetFor(patient, visitNum) {
  const k = visitNum - 1;
  return [
    patient.lat + k * REVISIT_OFFSET.lat,
    patient.lng + k * REVISIT_OFFSET.lng,
  ];
}

async function buildCluster(members, ci, shift, settings) {
  // Base geographic order, then pull multi-visit patients toward the front.
  let ordered = routeOrder(members).map((i) => members[i]);
  ordered = [...ordered].sort(
    (a, b) => (b.visitsPerDay > 1) - (a.visitsPerDay > 1)
  );

  let matrix = await fetchTravelMatrix(ordered, settings.bufferPct);
  let roadTimes = true;
  if (!matrix) {
    matrix = straightLineMatrix(ordered, settings.speedKmh, settings.bufferPct);
    roadTimes = false;
  }

  const sim = simulateTour(ordered, matrix, {
    shiftStartMin: shift.startMin,
    shiftEndMin: shift.startMin + shift.lengthMin,
    gapMin: settings.gapMin,
  });

  const center = centroidLatLng(members);
  const workingMin = sim.serviceMin + sim.travelMin;
  const stops = sim.stops.map((s, i) => {
    const [lat, lng] = offsetFor(s.patient, s.visitNum);
    return {
      order: i + 1,
      patient: s.patient,
      visitNum: s.visitNum,
      visitsTotal: s.visitsTotal,
      isReturn: s.visitNum > 1,
      lat,
      lng,
      arrive: s.arrive,
      depart: s.depart,
    };
  });

  return {
    id: ci,
    color: clusterColor(ci),
    center,
    radiusKm: coverageRadiusKm(center, members),
    stops,
    routeLatLng: stops.map((s) => [s.lat, s.lng]),
    patientCount: members.length,
    serviceMin: sim.serviceMin,
    travelMin: sim.travelMin,
    workingMin,
    shiftLabel: shift.label,
    shiftLengthMin: shift.lengthMin,
    shiftStartMin: shift.startMin,
    idleMin: Math.max(0, shift.lengthMin - workingMin),
    utilisation: shift.lengthMin > 0 ? workingMin / shift.lengthMin : 0,
    careEfficiency: workingMin > 0 ? sim.serviceMin / workingMin : 0,
    overflow: sim.overflow,
    roadTimes,
  };
}

function dayMetrics(clusters) {
  const serviceMin = clusters.reduce((s, c) => s + c.serviceMin, 0);
  const travelMin = clusters.reduce((s, c) => s + c.travelMin, 0);
  const workingMin = serviceMin + travelMin;
  const paidMin = clusters.reduce((s, c) => s + c.shiftLengthMin, 0);
  return {
    nurses: clusters.length,
    patients: clusters.reduce((s, c) => s + c.patientCount, 0),
    serviceMin,
    travelMin,
    workingMin,
    paidMin,
    utilisation: paidMin > 0 ? workingMin / paidMin : 0,
    careEfficiency: workingMin > 0 ? serviceMin / workingMin : 0,
  };
}

async function planDay(patients, settings) {
  const shifts = settings.shifts;
  const withLoad = patients.map((p) => ({
    ...p,
    load: p.visitsPerDay * p.serviceTime,
  }));

  // A patient whose own daily work exceeds the longest shift can't fit.
  const hardCap = Math.max(...shifts.map((s) => s.lengthMin));
  const tooBig = withLoad.filter((p) => p.load > hardCap);
  const fits = withLoad.filter((p) => p.load <= hardCap);
  if (!fits.length) {
    return { clusters: [], unassigned: tooBig, metrics: null, shortfallMin: 0 };
  }

  // Spread across all rostered nurses (longest shifts first); never ask for
  // more tours than there are patients.
  const sorted = [...shifts].sort((a, b) => b.lengthMin - a.lengthMin);
  const activeShifts = sorted.slice(0, Math.min(sorted.length, fits.length));

  const projected = projectToPlane(fits);
  const caps = activeShifts.map((s) => s.lengthMin * SERVICE_SHARE);
  const { clusters } = clusterItems(projected, caps);

  // Match the heaviest zone to the longest shift, next to next, and so on.
  const nonEmpty = clusters
    .map((idxs) => ({
      idxs,
      load: idxs.reduce((s, i) => s + projected[i].load, 0),
    }))
    .filter((c) => c.idxs.length)
    .sort((a, b) => b.load - a.load);

  const out = await Promise.all(
    nonEmpty.map((c, ci) =>
      buildCluster(
        c.idxs.map((i) => projected[i]),
        ci,
        activeShifts[ci],
        settings
      )
    )
  );

  const totalLoad = fits.reduce((s, p) => s + p.load, 0);
  const totalCap = activeShifts.reduce((s, sh) => s + sh.lengthMin * SERVICE_SHARE, 0);
  return {
    clusters: out,
    unassigned: tooBig,
    metrics: dayMetrics(out),
    shortfallMin: Math.max(0, totalLoad - totalCap),
  };
}

export async function buildPlan(patients, mode, settings) {
  if (mode === 'weekly') {
    const { byDay, infeasible } = distributeByDay(patients);
    const days = {};
    for (const d of WEEKDAYS) {
      days[d] = byDay[d].length
        ? await planDay(byDay[d], settings)
        : { clusters: [], unassigned: [], metrics: null, shortfallMin: 0 };
    }
    return { mode, days, dayOrder: WEEKDAYS, infeasible };
  }
  return {
    mode,
    days: { Day: await planDay(patients, settings) },
    dayOrder: ['Day'],
    infeasible: [],
  };
}
