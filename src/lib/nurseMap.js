// Map each re-assembled tour back onto a real nurse-shift from the file.
// The re-assembly keeps the file's nurse count and shift lengths, so we can
// staff each proposed tour with the nurse whose real shift is the closest
// length — WITHIN the same period (a morning tour never takes an evening nurse,
// and vice versa). Sorting both sides by length and pairing by rank is the
// optimal 1-D assignment (minimises total length mismatch).
import { hhmmToMin } from './schedule';

export function buildNurseMap(clusters, fileTours, cutoffMin) {
  const periodOf = (t) =>
    hhmmToMin(t.shiftStart) < cutoffMin ? 'morning' : 'evening';
  const map = {};
  for (const period of ['morning', 'evening']) {
    const tours = (clusters || [])
      .filter((c) => c.period === period)
      .map((c) => ({ id: c.id, len: c.shiftLengthMin || 0 }))
      .sort((a, b) => b.len - a.len);
    const nurses = (fileTours || [])
      .filter((t) => periodOf(t) === period)
      .map((t) => ({ name: t.nurseName, shortId: t.shortId, len: t.shiftDuration || 0 }))
      .sort((a, b) => b.len - a.len);
    tours.forEach((t, i) => {
      const n = nurses[i];
      if (n) {
        map[t.id] = {
          name: n.name,
          shortId: n.shortId,
          nurseLen: n.len,
          tourLen: t.len,
          period,
        };
      }
    });
  }
  return map;
}

// Exchange the nurses on two proposed tours. Each tour keeps its own length;
// only the nurse moves. Refused across periods (would mix AM and PM staff).
export function swapNurses(map, idA, idB) {
  const a = map[idA];
  const b = map[idB];
  if (!a || !b || a.period !== b.period) return map;
  return {
    ...map,
    [idA]: { ...b, tourLen: a.tourLen, period: a.period },
    [idB]: { ...a, tourLen: b.tourLen, period: b.period },
  };
}
