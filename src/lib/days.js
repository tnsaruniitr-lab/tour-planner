export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Spread patients across weekdays, balancing daily workload (greedy
// longest-processing-time-first). Each patient lands on `daysPerWeek`
// distinct days; the software picks which ones.
export function distributeByDay(patients) {
  const dayLoad = {};
  const byDay = {};
  WEEKDAYS.forEach((d) => {
    dayLoad[d] = 0;
    byDay[d] = [];
  });

  const infeasible = [];
  const schedulable = [];
  for (const p of patients) {
    if (p.daysPerWeek > WEEKDAYS.length) infeasible.push(p);
    else schedulable.push(p);
  }

  const perDayLoad = (p) => p.visitsPerDay * p.serviceTime;
  const sorted = [...schedulable].sort(
    (a, b) => b.daysPerWeek - a.daysPerWeek || perDayLoad(b) - perDayLoad(a)
  );

  for (const p of sorted) {
    const days = [...WEEKDAYS]
      .sort((a, b) => dayLoad[a] - dayLoad[b])
      .slice(0, p.daysPerWeek);
    for (const d of days) {
      byDay[d].push(p);
      dayLoad[d] += perDayLoad(p);
    }
  }
  return { byDay, infeasible };
}
