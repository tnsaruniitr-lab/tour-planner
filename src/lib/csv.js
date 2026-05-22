import Papa from 'papaparse';

// Expected headers (case-insensitive):
//   name, address, service_time, days_per_week, visits_per_day
//   lat, lng  (optional — if present, geocoding is skipped for that row)
export function parsePatientsCSV(text) {
  const { data, errors } = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (errors.length) {
    throw new Error('CSV parse error: ' + errors[0].message);
  }
  return data.map(normalizePatient);
}

function num(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePatient(row, i) {
  const lat = num(row.lat, null);
  const lng = num(row.lng, null);
  return {
    id: 'p' + i,
    name: (row.name || 'Patient ' + (i + 1)).trim(),
    address: (row.address || '').trim(),
    serviceTime: Math.max(5, num(row.service_time, 30)),
    daysPerWeek: Math.max(1, Math.round(num(row.days_per_week, 1))),
    visitsPerDay: Math.max(1, Math.round(num(row.visits_per_day, 1))),
    lat,
    lng,
  };
}
