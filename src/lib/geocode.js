const CACHE_KEY = 'touring_geocode_cache_v1';

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCache(c) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable — skip caching */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Geocode any patient missing lat/lng via OSM Nominatim.
// Nominatim allows ~1 request/second, so network lookups are spaced out.
// Results are cached in localStorage keyed by address.
export async function geocodePatients(patients, onProgress) {
  const cache = loadCache();
  const located = [];
  const failed = [];
  const need = patients.filter((p) => p.lat == null || p.lng == null);
  let done = 0;

  for (const p of patients) {
    if (p.lat != null && p.lng != null) {
      located.push(p);
      continue;
    }

    const key = p.address.toLowerCase();
    if (cache[key]) {
      located.push({ ...p, lat: cache[key].lat, lng: cache[key].lng });
      done++;
      onProgress?.(done, need.length);
      continue;
    }

    if (!p.address) {
      failed.push(p);
      done++;
      onProgress?.(done, need.length);
      continue;
    }

    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
        encodeURIComponent(p.address);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (json && json.length) {
        const hit = { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
        cache[key] = hit;
        located.push({ ...p, ...hit });
      } else {
        failed.push(p);
      }
    } catch {
      failed.push(p);
    }

    done++;
    onProgress?.(done, need.length);
    await sleep(1100);
  }

  saveCache(cache);
  return { located, failed };
}
