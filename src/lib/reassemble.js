import { buildPlan } from './pipeline';
import { hhmmToMin } from './schedule';
import { clusterColor } from './colors';
import { mergeSamePatientRuns } from './stops';

function fmtHours(h) {
  return (Number.isInteger(h) ? h : Number(h.toFixed(1))) + 'h';
}

// Group a pool of visits into planner-patient objects, one per patient name.
// A patient visited more than once in the pool becomes a multi-visit patient.
function poolToPatients(visits, prefix) {
  const byName = {};
  for (const v of visits) {
    if (v.lat == null || v.lng == null) continue;
    (byName[v.patientName] = byName[v.patientName] || []).push(v);
  }
  return Object.entries(byName).map(([name, vs], i) => {
    const total = vs.reduce((s, v) => s + (v.visitDurationMin || 0), 0);
    return {
      id: prefix + i,
      name,
      address: '',
      lat: vs[0].lat,
      lng: vs[0].lng,
      visitsPerDay: vs.length,
      serviceTime: Math.max(5, Math.round(total / vs.length)),
      daysPerWeek: 1,
    };
  });
}

// When the period's real work starts (earliest actual visit), so a re-assembled
// morning tour reads as morning and an evening tour reads as evening — instead
// of every tour being drawn from a fixed 08:00.
function periodStartMin(periodTours) {
  const times = periodTours
    .flatMap((t) => t.visits.map((v) => hhmmToMin(v.visitTime)))
    .filter((m) => m > 0);
  return times.length ? Math.min(...times) : 480;
}

// Build the shift roster for one period: one shift per tour the file ran, each
// the file tour's own length, all starting when the period's work begins.
function buildRoster(periodTours, patients) {
  if (!patients.length) return [];
  const startMin = periodStartMin(periodTours);
  return periodTours.map((t) => {
    const len = t.shiftDuration || 360;
    return { startMin, lengthMin: len, label: fmtHours(len / 60) };
  });
}

// Re-assemble one day's actual visits into clean circular tours.
// Morning and evening pools are planned separately and never mixed.
export async function reassembleDay(tours, opts) {
  const morningTours = tours.filter(
    (t) => hhmmToMin(t.shiftStart) < opts.cutoffMin
  );
  const eveningTours = tours.filter(
    (t) => hhmmToMin(t.shiftStart) >= opts.cutoffMin
  );

  // Merge each patient's back-to-back same-address service blocks first, so a
  // patient seen twice in one sitting is planned as one stop — not two return
  // trips an hour apart (which would inflate travel and clutter the map).
  const morningPatients = poolToPatients(
    morningTours.flatMap((t) => mergeSamePatientRuns(t.visits)),
    'm'
  );
  const eveningPatients = poolToPatients(
    eveningTours.flatMap((t) => mergeSamePatientRuns(t.visits)),
    'e'
  );

  const morningShifts = buildRoster(morningTours, morningPatients);
  const eveningShifts = buildRoster(eveningTours, eveningPatients);

  // Cap slack lets the clustering favour compact, round zones over an exact
  // capacity fit — tours may run slightly over shift.
  const base = { gapMin: opts.gapMin, bufferPct: 35, speedKmh: 30, capSlack: 1.1 };

  const [mRun, eRun] = await Promise.all([
    morningShifts.length
      ? buildPlan(morningPatients, 'daily', { ...base, shifts: morningShifts })
      : null,
    eveningShifts.length
      ? buildPlan(eveningPatients, 'daily', { ...base, shifts: eveningShifts })
      : null,
  ]);

  const mClusters = mRun ? mRun.days.Day.clusters : [];
  const eClusters = eRun ? eRun.days.Day.clusters : [];
  const clusters = [
    ...mClusters.map((c) => ({ ...c, period: 'morning' })),
    ...eClusters.map((c) => ({ ...c, period: 'evening' })),
  ].map((c, i) => ({ ...c, id: i, color: clusterColor(i) }));

  const serviceMin = clusters.reduce((s, c) => s + (c.serviceMin || 0), 0);
  const travelMin = clusters.reduce((s, c) => s + (c.travelMin || 0), 0);
  const working = serviceMin + travelMin;

  return {
    clusters,
    tours: clusters.length,
    morningCount: mClusters.length,
    eveningCount: eClusters.length,
    serviceMin,
    travelMin,
    efficiency: working > 0 ? serviceMin / working : 0,
    travelPct: working > 0 ? travelMin / working : 0,
  };
}

// Re-assemble the day into circular tours, keeping the file's nurse count and
// shift lengths. Returns the single 'file' plan (the milk-run optimisation is
// derived from it in the app).
export async function reassembleAll(tours, baseOpts) {
  const file = await reassembleDay(tours, baseOpts);
  return { file };
}
