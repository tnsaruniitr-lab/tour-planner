const KM_PER_DEG = 111.32;

function toRad(d) { return (d * Math.PI) / 180; }

// Great-circle distance in km.
export function haversine(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Project lat/lng to planar km coords. Longitude is scaled by cos(latitude)
// so clusters render as true circles instead of latitude-stretched ellipses.
export function projectToPlane(items) {
  if (!items.length) return [];
  const meanLat = items.reduce((s, p) => s + p.lat, 0) / items.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  return items.map((p) => ({
    ...p,
    x: p.lng * KM_PER_DEG * cosLat,
    y: p.lat * KM_PER_DEG,
  }));
}

export function planarDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function centroidLatLng(items) {
  const n = items.length;
  return {
    lat: items.reduce((s, p) => s + p.lat, 0) / n,
    lng: items.reduce((s, p) => s + p.lng, 0) / n,
  };
}

// Radius (km) covering the given percentile of members — a tight "core"
// circle keeps overlapping zones readable.
export function coverageRadiusKm(center, items, percentile = 0.65) {
  const d = items.map((p) => haversine(center, p)).sort((a, b) => a - b);
  const idx = Math.min(d.length - 1, Math.floor(percentile * d.length));
  return Math.max(d[idx], 0.15);
}
