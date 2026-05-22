import Papa from 'papaparse';
import { hhmmToMin } from './schedule';
import { clusterColor } from './colors';
import { fetchTravelMatrix, straightLineMatrix } from './osrm';

// Sentinel value for the "show every tour" dropdown entry.
export const ALL_TOURS = '__all__';

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Parse one actual-tours CSV into raw row objects (headers lower-cased).
export function parseActualTours(text) {
  const { data, errors } = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/^﻿/, ''),
  });
  if (errors.length && !data.length) {
    throw new Error('CSV parse error: ' + errors[0].message);
  }
  return data;
}

// Stable per-visit key, used to de-duplicate when the same file is re-uploaded.
export function rowKey(r) {
  const vid = (r.visitid || '').trim();
  if (vid) return vid;
  return [r.dateofservice, r.tourid, r.visitsequence, r.patientname].join('|');
}

// Group raw rows into tours, keyed by date + tourId. Visits sorted by sequence;
// visits without coordinates are kept separately as `unmapped`.
export function buildTours(rows) {
  const tours = {};
  for (const r of rows) {
    const date = (r.dateofservice || '').trim();
    const tourId = (r.tourid || '').trim();
    if (!tourId) continue;
    const key = date + '|' + tourId;
    if (!tours[key]) {
      tours[key] = {
        key,
        date,
        tourId,
        shortId: tourId.split('_').pop(),
        nurseName: (r.nursename || '').trim(),
        staffId: (r.staffid || '').trim(),
        shiftStart: (r.shiftstart || '').trim(),
        shiftEnd: (r.shiftend || '').trim(),
        shiftDuration: num(r.shiftduration),
        serviceTimeMin: num(r.servicetimemin),
        servicePct: num(r.servicepct),
        travelPct: num(r.travelpct),
        waitingPct: num(r.waitingpct),
        visits: [],
        unmapped: [],
      };
    }
    const lat = num(r.latitude);
    const lng = num(r.longitude);
    const visit = {
      seq: num(r.visitsequence) ?? 0,
      patientName: (r.patientname || '').trim(),
      patientAddress: (r.patientaddress || '').trim(),
      lat,
      lng,
      visitTime: (r.visittime || '').trim(),
      visitDurationMin: num(r.visitdurationmin) ?? 0,
    };
    if (lat == null || lng == null) tours[key].unmapped.push(visit);
    else tours[key].visits.push(visit);
  }
  for (const k of Object.keys(tours)) {
    tours[k].visits.sort((a, b) => a.seq - b.seq);
    tours[k].unmapped.sort((a, b) => a.seq - b.seq);
  }
  return tours;
}

// Convert one tour into the cluster shape MapView renders (straight route).
// `index` drives the route colour so multiple tours stay distinct.
export function tourToCluster(tour, index = 0) {
  const stops = tour.visits.map((v) => {
    const arrive = hhmmToMin(v.visitTime);
    return {
      order: v.seq,
      lat: v.lat,
      lng: v.lng,
      patient: {
        name: v.patientName,
        address: v.patientAddress,
        serviceTime: v.visitDurationMin,
      },
      visitNum: 1,
      visitsTotal: 1,
      arrive,
      depart: arrive + v.visitDurationMin,
    };
  });
  return {
    id: index,
    color: clusterColor(index),
    routeLatLng: stops.map((s) => [s.lat, s.lng]),
    stops,
    center: { lat: 0, lng: 0 },
    radiusKm: 0,
  };
}

// Total driving time for a tour in minutes — summed consecutive legs in visit
// order. OSRM road time inflated 1.5x for traffic; straight-line fallback.
export async function computeTourTravelMin(tour) {
  const pts = tour.visits;
  if (pts.length < 2) return 0;
  let matrix = await fetchTravelMatrix(pts, 50);
  if (!matrix) matrix = straightLineMatrix(pts, 30, 50);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += matrix[i][i + 1] || 0;
  return total;
}
