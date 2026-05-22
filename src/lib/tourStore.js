// Local-storage persistence for uploaded actual-tours data, so a tour you're
// working with survives a page reload without re-uploading the file.

const ROWS_KEY = 'touring_actual_rows_v1';
const SEL_KEY = 'touring_actual_sel_v1';
const TRAVEL_KEY = 'touring_actual_travel_v1';

export function loadTourRows() {
  try {
    return JSON.parse(localStorage.getItem(ROWS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveTourRows(rows) {
  try {
    localStorage.setItem(ROWS_KEY, JSON.stringify(rows));
  } catch {
    /* storage full or unavailable — skip */
  }
}

export function loadSelection() {
  try {
    return JSON.parse(localStorage.getItem(SEL_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSelection(sel) {
  try {
    localStorage.setItem(SEL_KEY, JSON.stringify(sel));
  } catch {
    /* ignore */
  }
}

export function loadTourTravel() {
  try {
    return JSON.parse(localStorage.getItem(TRAVEL_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveTourTravel(map) {
  try {
    localStorage.setItem(TRAVEL_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function clearTourStore() {
  try {
    localStorage.removeItem(ROWS_KEY);
    localStorage.removeItem(SEL_KEY);
    localStorage.removeItem(TRAVEL_KEY);
  } catch {
    /* ignore */
  }
}
