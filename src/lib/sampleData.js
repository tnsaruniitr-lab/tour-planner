// Deterministic sample dataset — patients pre-geocoded around London in four
// neighborhood blobs, so the demo runs instantly without hitting Nominatim.

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOBS = [
  { name: 'Marylebone', lat: 51.5185, lng: -0.153, n: 6 },
  { name: 'Chelsea', lat: 51.4895, lng: -0.168, n: 6 },
  { name: 'Shoreditch', lat: 51.524, lng: -0.079, n: 6 },
  { name: 'Camberwell', lat: 51.474, lng: -0.093, n: 6 },
];

const SERVICE = [20, 25, 30, 30, 40];
const DAYS = [1, 1, 2, 2, 3];

export function getSampleData() {
  const rand = mulberry32(20260520);
  const out = [];
  let i = 0;
  for (const b of BLOBS) {
    for (let j = 0; j < b.n; j++) {
      out.push({
        id: 'p' + i,
        name: `${b.name} Patient ${j + 1}`,
        address: `${b.name}, London`,
        serviceTime: SERVICE[Math.floor(rand() * SERVICE.length)],
        daysPerWeek: DAYS[Math.floor(rand() * DAYS.length)],
        visitsPerDay: [2, 9, 16].includes(i) ? 2 : 1,
        lat: b.lat + (rand() - 0.5) * 0.018,
        lng: b.lng + (rand() - 0.5) * 0.024,
      });
      i++;
    }
  }
  return out;
}
