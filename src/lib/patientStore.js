// Persistence for the planner upload — the last uploaded patient file is
// kept in browser localStorage so it survives reloads and can be reloaded
// from the "Load saved" button, just like the actual-tours store.
const KEY = 'touring_patients_v1';

export function loadSavedPatients() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.patients) || !data.patients.length) {
      return null;
    }
    return data; // { label, patients, savedAt }
  } catch {
    return null;
  }
}

export function saveUploadedPatients(label, patients) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ label, patients, savedAt: Date.now() })
    );
    return true;
  } catch {
    return false; // storage full or unavailable — non-fatal
  }
}

export function clearSavedPatients() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
