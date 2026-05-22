import { projectToPlane, centroidLatLng, coverageRadiusKm } from './geo';
import { clusterItems } from './cluster';
import { routeOrder } from './route';
import { simulateTour } from './schedule';
import { fetchTravelMatrix, straightLineMatrix } from './osrm';
import { distributeByDay, ALLDAYS } from './days';
import { clusterColor } from './colors';

// Of a shift's length, the share assumed available for service work — the
// rest is reserved for travel between stops.
const SERVICE_SHARE = 0.85;

// Auto mode never proposes a shift shorter than this.
const MIN_SHIFT_MIN = 180;

const REVISIT_OFFSET = { lat: 0.00025, lng: 0.00035 };

function fmtHours(h) {
  return (Number.isInteger(h) ? h : Number(h.toFixed(1))) + 'h';
}

// Auto mode, step 1: how many nurses does this day need?
// Sized against the target utilisation — a shift's usable service capacity
// is its length × targetUtil × SERVICE_SHARE. The spare capacity beyond
// the bare minimum becomes the shift buffer and gives the clustering room
// to keep zones compact and round.
function autoShifts(withLoad, settings) {
  const totalLoad = withLoad.reduce((s, p) => s + p.load, 0);
  if (totalLoad <= 0) return [];

  const maxLen = settings.maxShiftMin;
  const serviceShare = settings.targetUtil * SERVICE_SHARE;
  const n = Math.max(1, Math.ceil(totalLoad / (maxLen * serviceShare)));

  // Provisional full-length shifts — each tour's shift is trimmed to its
  // own workload afterwards (fitShiftToCluster).
  return Array.from({ length: n }, () => ({
    startMin: settings.startMin,
    lengthMin: maxLen,
    label: fmtHours(maxLen / 60),
  }));
}

// Auto mode, step 2: once a tour is built, size its shift to its workload
// padded to the target utilisation — but never shorter than the tour's
// actual span, so a wait between a patient's repeat visits cannot force an
// overflow. The padding is the deliberate shift buffer.
function fitShiftToCluster(cluster, settings) {
  const stops = cluster.stops;
  const span = stops.length
    ? stops[stops.length - 1].depart - cluster.shiftStartMin
    : cluster.workingMin;
  const fitted = Math.max(
    Math.round(cluster.workingMin / settings.targetUtil),
    span
  );
  const lengthMin = Math.min(
    settings.maxShiftMin,
    Math.max(MIN_SHIFT_MIN, fitted)
  );
  return {
    ...cluster,
    shiftLabel: fmtHours(lengthMin / 60),
    shiftLengthMin: lengthMin,
    idleMin: Math.max(0, lengthMin - cluster.workingMin),
    utilisation: lengthMin > 0 ? cluster.workingMin / lengthMin : 0,
  };
}

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

// Plan one day's patients with the given settings. Exported so a single
// day can be re-planned in isolation (manual shift adjustments) without
// disturbing the rest of the week.
export async function planDay(patients, settings) {
  const withLoad = patients.map((p) => ({
    ...p,
    load: p.visitsPerDay * p.serviceTime,
  }));

  // Auto mode sizes the day's roster from its own workload; otherwise the
  // roster is the fixed set of shifts the user supplied.
  const shifts = settings.auto ? autoShifts(withLoad, settings) : settings.shifts;
  if (!shifts || !shifts.length) {
    return { clusters: [], unassigned: [], metrics: null, shortfallMin: 0 };
  }

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
  const { clusters } = clusterItems(projected, caps, settings.capSlack || 1);

  // Match the heaviest zone to the longest shift, next to next, and so on.
  const nonEmpty = clusters
    .map((idxs) => ({
      idxs,
      load: idxs.reduce((s, i) => s + projected[i].load, 0),
    }))
    .filter((c) => c.idxs.length)
    .sort((a, b) => b.load - a.load);

  const built = await Promise.all(
    nonEmpty.map((c, ci) =>
      buildCluster(
        c.idxs.map((i) => projected[i]),
        ci,
        activeShifts[ci],
        settings
      )
    )
  );

  // Auto mode: trim each tour's shift to the work it actually carries.
  const out = settings.auto
    ? built.map((c) => fitShiftToCluster(c, settings))
    : built;

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
    // Only show days that actually carry visits (Sat/Sun are often light).
    const dayOrder = ALLDAYS.filter((d) => byDay[d].length);
    const days = {};
    for (const d of dayOrder) {
      days[d] = await planDay(byDay[d], settings);
      // Keep the day's patient list so a single day can be re-planned.
      days[d].patients = byDay[d];
    }
    if (!dayOrder.length) {
      days.Mon = {
        clusters: [],
        unassigned: [],
        metrics: null,
        shortfallMin: 0,
        patients: [],
      };
    }
    return {
      mode,
      days,
      dayOrder: dayOrder.length ? dayOrder : ['Mon'],
      infeasible,
    };
  }
  const dayResult = await planDay(patients, settings);
  dayResult.patients = patients;
  return {
    mode,
    days: { Day: dayResult },
    dayOrder: ['Day'],
    infeasible: [],
  };
}
