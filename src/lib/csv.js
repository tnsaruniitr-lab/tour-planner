import Papa from 'papaparse';

// Expected headers (case-insensitive; spaces are treated as underscores):
//   name, address, service_time, days_per_week, visits_per_day
//   lat, lng  (optional — if present, geocoding is skipped for that row)
export function parsePatientsCSV(text) {
  const { data, errors } = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
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
  // Accept a few common header spellings so a slightly different
  // spreadsheet still works without renaming columns.
  const lat = num(row.lat ?? row.latitude, null);
  const lng = num(row.lng ?? row.longitude ?? row.lon, null);
  return {
    id: 'p' + i,
    name: (row.name || row.patient_name || 'Patient ' + (i + 1)).trim(),
    address: (row.address || row.patient_address || '').trim(),
    serviceTime: Math.max(5, num(row.service_time ?? row.servicetime, 30)),
    daysPerWeek: Math.max(
      1,
      Math.round(num(row.days_per_week ?? row.daysperweek, 1))
    ),
    visitsPerDay: Math.max(
      1,
      Math.round(num(row.visits_per_day ?? row.visitsperday, 1))
    ),
    lat,
    lng,
  };
}
