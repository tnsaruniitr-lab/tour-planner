import { haversine } from './geo';

// Fetch a driving-time matrix (minutes) between points via OSRM's public
// Table service, inflated by bufferPct to account for traffic, parking and
// walking to the door. Returns null on any failure so the caller can fall back.
export async function fetchTravelMatrix(points, bufferPct) {
  if (points.length < 2) return [[0]];
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url =
    'https://router.project-osrm.org/table/v1/driving/' +
    coords +
    '?annotations=duration';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== 'Ok' || !json.durations) return null;
    const mult = (1 + bufferPct / 100) / 60; // seconds -> minutes, inflated
    return json.durations.map((row) => row.map((s) => (s == null ? 0 : s * mult)));
  } catch {
    return null;
  }
}

// Fallback travel matrix (minutes) from straight-line distance.
export function straightLineMatrix(points, speedKmh, bufferPct) {
  const mult = 1 + bufferPct / 100;
  return points.map((a) =>
    points.map((b) => (haversine(a, b) / speedKmh) * 60 * mult)
  );
}
