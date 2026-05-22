export function hhmmToMin(s) {
  const [h, m] = (s || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToHHMM(t) {
  const v = ((Math.round(t) % 1440) + 1440) % 1440;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Time-simulate one tour. Patients are pre-ordered (multi-visit patients
// pulled toward the front). A patient's repeat visit becomes its own stop
// at the same address, woven back into the route once the 3h gap has
// elapsed — a real return leg, with its travel time counted.
//
// travelMatrix[a][b] = minutes from patient a to patient b (indices match
// the `patients` array).
export function simulateTour(patients, travelMatrix, settings) {
  const { shiftStartMin, shiftEndMin, gapMin } = settings;
  let clock = shiftStartMin;
  let cur = null;
  let travelMin = 0;
  let serviceMin = 0;
  let overflow = false;
  const stops = [];
  const pending = []; // queued repeat visits: { idx, visitNum, readyAt }
  let bi = 0;
  let guard = 0;

  while ((bi < patients.length || pending.length) && guard++ < 10000) {
    // Serve a repeat visit whose 3h gap has elapsed; otherwise the next
    // patient in the base route; otherwise wait for the soonest repeat.
    let dueK = -1;
    for (let k = 0; k < pending.length; k++) {
      if (
        pending[k].readyAt <= clock &&
        (dueK < 0 || pending[k].readyAt < pending[dueK].readyAt)
      ) {
        dueK = k;
      }
    }

    let idx;
    let visitNum;
    if (dueK >= 0) {
      idx = pending[dueK].idx;
      visitNum = pending[dueK].visitNum;
      pending.splice(dueK, 1);
    } else if (bi < patients.length) {
      idx = bi;
      visitNum = 1;
      bi++;
    } else {
      clock = Math.min(...pending.map((p) => p.readyAt));
      continue;
    }

    if (cur !== null) {
      const t = travelMatrix[cur][idx] || 0;
      clock += t;
      travelMin += t;
    }
    cur = idx;

    const p = patients[idx];
    const arrive = clock;
    const depart = arrive + p.serviceTime;
    clock = depart;
    serviceMin += p.serviceTime;
    if (depart > shiftEndMin) overflow = true;

    stops.push({
      patient: p,
      visitNum,
      visitsTotal: p.visitsPerDay,
      arrive,
      depart,
    });

    if (visitNum < p.visitsPerDay) {
      pending.push({ idx, visitNum: visitNum + 1, readyAt: arrive + gapMin });
    }
  }

  return { stops, travelMin, serviceMin, overflow };
}
