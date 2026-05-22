import { buildPlan } from './pipeline';
import { hhmmToMin } from './schedule';
import { clusterColor } from './colors';

// Of a shift's length, the share assumed available for service work.
const SERVICE_SHARE = 0.85;

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

// Build the shift roster for one period, per the chosen staffing mode.
function buildRoster(period, periodTours, patients, opts) {
  if (!patients.length) return [];

  if (opts.mode === 'file') {
    return periodTours.map((t) => {
      const len = t.shiftDuration || 360;
      return { startMin: 480, lengthMin: len, label: fmtHours(len / 60) };
    });
  }

  if (opts.mode === 'uniform') {
    const hours = period === 'morning' ? opts.mHours : opts.eHours;
    const count = period === 'morning' ? opts.mCount : opts.eCount;
    const lengthMin = Math.max(30, Math.round(hours * 60));
    return Array.from({ length: Math.max(1, Math.round(count)) }, () => ({
      startMin: 480,
      lengthMin,
      label: fmtHours(hours),
    }));
  }

  // fewest: minimum nurse count within a max shift length
  const lengthMin = Math.max(30, Math.round(opts.maxHours * 60));
  const totalLoad = patients.reduce(
    (s, p) => s + p.visitsPerDay * p.serviceTime,
    0
  );
  const n = Math.max(1, Math.ceil(totalLoad / (lengthMin * SERVICE_SHARE)));
  return Array.from({ length: n }, () => ({
    startMin: 480,
    lengthMin,
    label: fmtHours(opts.maxHours),
  }));
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

  const morningPatients = poolToPatients(
    morningTours.flatMap((t) => t.visits),
    'm'
  );
  const eveningPatients = poolToPatients(
    eveningTours.flatMap((t) => t.visits),
    'e'
  );

  const morningShifts = buildRoster('morning', morningTours, morningPatients, opts);
  const eveningShifts = buildRoster('evening', eveningTours, eveningPatients, opts);

  const base = { gapMin: opts.gapMin, bufferPct: 35, speedKmh: 30 };

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
  const clusters = [...mClusters, ...eClusters].map((c, i) => ({
    ...c,
    id: i,
    color: clusterColor(i),
  }));

  return {
    clusters,
    morningCount: mClusters.length,
    eveningCount: eClusters.length,
    morningPatients: morningPatients.length,
    eveningPatients: eveningPatients.length,
  };
}
