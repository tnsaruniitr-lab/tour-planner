// The operating week. Weekdays carry the bulk of the work; Saturday and
// Sunday only pick up the spill-over from 6- and 7-day patients.
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const ALLDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Spread patients across the operating week, balancing daily workload
// (greedy longest-processing-time-first). Each patient lands on
// `daysPerWeek` distinct days; the software picks which ones.
//
// Day choice is *weekday-preferred*: a patient needing up to 5 days/week is
// placed on weekdays only; a 6-day patient gets every weekday + Saturday;
// a 7-day patient gets the whole week. So Sat/Sun only ever hold the
// 6- and 7-day patients.
export function distributeByDay(patients) {
  const dayLoad = {};
  const byDay = {};
  ALLDAYS.forEach((d) => {
    dayLoad[d] = 0;
    byDay[d] = [];
  });

  const infeasible = [];
  const schedulable = [];
  for (const p of patients) {
    if (p.daysPerWeek > ALLDAYS.length) infeasible.push(p);
    else schedulable.push(p);
  }

  const perDayLoad = (p) => p.visitsPerDay * p.serviceTime;
  const sorted = [...schedulable].sort(
    (a, b) => b.daysPerWeek - a.daysPerWeek || perDayLoad(b) - perDayLoad(a)
  );

  for (const p of sorted) {
    const n = p.daysPerWeek;
    // Eligible days: weekdays first, Saturday only at 6+, Sunday only at 7.
    const pool =
      n <= WEEKDAYS.length
        ? WEEKDAYS
        : n === WEEKDAYS.length + 1
          ? [...WEEKDAYS, 'Sat']
          : ALLDAYS;
    const days = [...pool]
      .sort((a, b) => dayLoad[a] - dayLoad[b])
      .slice(0, n);
    for (const d of days) {
      byDay[d].push(p);
      dayLoad[d] += perDayLoad(p);
    }
  }
  return { byDay, infeasible };
}
