import { useState, useMemo, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ActualToursPanel from './components/ActualToursPanel';
import MapView from './components/MapView';
import { parsePatientsCSV } from './lib/csv';
import { getSampleData } from './lib/sampleData';
import { geocodePatients } from './lib/geocode';
import { buildPlan } from './lib/pipeline';
import { hhmmToMin } from './lib/schedule';
import {
  parseActualTours,
  rowKey,
  buildTours,
  tourToCluster,
  ALL_TOURS,
} from './lib/actualTours';
import {
  loadTourRows,
  saveTourRows,
  loadSelection,
  saveSelection,
  clearTourStore,
} from './lib/tourStore';

const DEFAULT_FORM = {
  shiftStart: '08:00',
  shiftEnd: '14:00',
  nurses: 4,
  gapHours: 3,
  bufferPct: 35,
};

const DEFAULT_ROSTER = [
  { count: 2, hours: 7, start: '08:00' },
  { count: 2, hours: 5, start: '09:00' },
];

function fmtHours(h) {
  return (Number.isInteger(h) ? h : Number(h.toFixed(2))) + 'h';
}

function sortTours(list) {
  return [...list].sort((a, b) =>
    a.shortId.localeCompare(b.shortId, undefined, { numeric: true })
  );
}

export default function App() {
  const [appMode, setAppMode] = useState('plan');

  // ---- Planner state ----
  const [patients, setPatients] = useState([]);
  const [sourceLabel, setSourceLabel] = useState('');
  const [mode, setMode] = useState('daily');
  const [capacityMode, setCapacityMode] = useState('uniform');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [roster, setRoster] = useState(DEFAULT_ROSTER);
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [statusErr, setStatusErr] = useState(false);
  const [plan, setPlan] = useState(null);
  const [activeDay, setActiveDay] = useState('Day');

  // ---- Visualiser state ----
  const [tourRows, setTourRows] = useState(loadTourRows);
  const [selectedDate, setSelectedDate] = useState(
    () => loadSelection()?.date || ''
  );
  const [selectedTourKey, setSelectedTourKey] = useState(
    () => loadSelection()?.tourKey || ALL_TOURS
  );
  const [toursStatus, setToursStatus] = useState(() =>
    Object.keys(loadTourRows()).length
      ? 'Restored saved tours from last session.'
      : ''
  );
  const [toursErr, setToursErr] = useState(false);

  const activeDayPlan = plan ? plan.days[activeDay] : null;

  const tours = useMemo(() => buildTours(Object.values(tourRows)), [tourRows]);
  const dates = useMemo(
    () => [...new Set(Object.values(tours).map((t) => t.date))].sort(),
    [tours]
  );
  const safeDate = dates.includes(selectedDate) ? selectedDate : dates[0] || '';
  const toursForDate = useMemo(
    () => sortTours(Object.values(tours).filter((t) => t.date === safeDate)),
    [tours, safeDate]
  );
  const allView = selectedTourKey === ALL_TOURS || !tours[selectedTourKey];
  const selectedTour = allView ? null : tours[selectedTourKey];
  const selectKey = allView ? ALL_TOURS : selectedTourKey;
  const tourDayPlan = allView
    ? toursForDate.length
      ? { clusters: toursForDate.map((t, i) => tourToCluster(t, i)) }
      : null
    : { clusters: [tourToCluster(selectedTour, 0)] };

  useEffect(() => {
    saveSelection({ date: selectedDate, tourKey: selectedTourKey });
  }, [selectedDate, selectedTourKey]);

  // ---- Planner handlers ----
  function onField(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
  }

  function clearPlan() {
    setPlan(null);
    setStatusMsg('');
    setStatusErr(false);
  }

  function onModeChange(m) {
    setMode(m);
    clearPlan();
  }

  function onCapacityModeChange(m) {
    setCapacityMode(m);
    clearPlan();
  }

  function updateRoster(i, key, value) {
    setRoster((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  }

  function addRosterRow() {
    setRoster((r) => [...r, { count: 1, hours: 6, start: '08:00' }]);
  }

  function removeRosterRow(i) {
    setRoster((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));
  }

  function buildShifts() {
    if (capacityMode === 'roster') {
      const shifts = [];
      for (const row of roster) {
        const count = Math.max(0, Math.round(Number(row.count) || 0));
        const hours = Number(row.hours) || 0;
        const lengthMin = Math.round(hours * 60);
        const startMin = hhmmToMin(row.start);
        for (let i = 0; i < count; i++) {
          shifts.push({ startMin, lengthMin, label: fmtHours(hours) });
        }
      }
      return shifts;
    }
    const startMin = hhmmToMin(form.shiftStart);
    const lengthMin = hhmmToMin(form.shiftEnd) - startMin;
    const count = Math.max(1, Math.round(Number(form.nurses) || 1));
    const label = fmtHours(lengthMin / 60);
    return Array.from({ length: count }, () => ({ startMin, lengthMin, label }));
  }

  async function onUpload(file) {
    try {
      const text = await file.text();
      const parsed = parsePatientsCSV(text);
      if (!parsed.length) throw new Error('No rows found in CSV.');
      setPatients(parsed);
      setSourceLabel(file.name);
      clearPlan();
    } catch (err) {
      setStatusMsg(err.message);
      setStatusErr(true);
    }
  }

  function onLoadSample() {
    setPatients(getSampleData());
    setSourceLabel('sample data');
    clearPlan();
  }

  async function onGo() {
    setRunning(true);
    setStatusErr(false);
    setPlan(null);
    try {
      const shifts = buildShifts();
      if (!shifts.length) throw new Error('Add at least one shift.');
      if (shifts.some((s) => s.lengthMin <= 0)) {
        throw new Error('Every shift must have a positive length.');
      }

      setStatusMsg('Geocoding addresses…');
      const { located, failed } = await geocodePatients(patients, (done, total) => {
        if (total) setStatusMsg(`Geocoding addresses… ${done}/${total}`);
      });
      if (!located.length) throw new Error('No addresses could be geocoded.');

      const settings = {
        shifts,
        gapMin: Math.round((parseFloat(form.gapHours) || 0) * 60),
        bufferPct: Math.max(0, parseFloat(form.bufferPct) || 0),
        speedKmh: 30,
      };

      setStatusMsg('Clustering and fetching road travel times…');
      const result = await buildPlan(located, mode, settings);
      const firstDay =
        result.dayOrder.find((d) => result.days[d].clusters.length) ||
        result.dayOrder[0];
      setActiveDay(firstDay);
      setPlan(result);

      const tourCount = result.dayOrder.reduce(
        (s, d) => s + result.days[d].clusters.length,
        0
      );
      const note = failed.length
        ? ` (${failed.length} address(es) failed geocoding)`
        : '';
      setStatusMsg(
        `Planned ${located.length} patients into ${tourCount} tour(s).${note}`
      );
      setStatusErr(false);
    } catch (err) {
      setStatusMsg(err.message || 'Something went wrong.');
      setStatusErr(true);
    } finally {
      setRunning(false);
    }
  }

  // ---- Visualiser handlers ----
  function ingestTourTexts(texts) {
    const merged = { ...tourRows };
    for (const text of texts) {
      const rows = parseActualTours(text);
      for (const r of rows) merged[rowKey(r)] = r;
    }
    const t = buildTours(Object.values(merged));
    const ds = [...new Set(Object.values(t).map((x) => x.date))].sort();
    setTourRows(merged);
    saveTourRows(merged);
    if (!ds.includes(selectedDate)) setSelectedDate(ds[0] || '');
    if (selectedTourKey !== ALL_TOURS && !t[selectedTourKey]) {
      setSelectedTourKey(ALL_TOURS);
    }
    setToursErr(false);
    setToursStatus(`${ds.length} day(s), ${Object.keys(t).length} tours loaded.`);
  }

  async function onToursUpload(fileList) {
    try {
      const texts = await Promise.all(
        Array.from(fileList).map((f) => f.text())
      );
      ingestTourTexts(texts);
    } catch (err) {
      setToursErr(true);
      setToursStatus(err.message || 'Upload failed.');
    }
  }

  async function onLoadSampleTours() {
    try {
      setToursStatus('Loading saved tours…');
      const res = await fetch('/sample-tours.csv');
      if (!res.ok) throw new Error('sample-tours.csv not found.');
      ingestTourTexts([await res.text()]);
    } catch (err) {
      setToursErr(true);
      setToursStatus(err.message || 'Could not load saved tours.');
    }
  }

  function onSelectDate(date) {
    setSelectedDate(date);
    setSelectedTourKey(ALL_TOURS);
  }

  function onClearTours() {
    clearTourStore();
    setTourRows({});
    setSelectedDate('');
    setSelectedTourKey(ALL_TOURS);
    setToursStatus('');
    setToursErr(false);
  }

  return (
    <div className="app">
      <div className="panel">
        <div className="view-switch">
          <button
            className={appMode === 'plan' ? 'active' : ''}
            onClick={() => setAppMode('plan')}
          >
            Plan
          </button>
          <button
            className={appMode === 'actual' ? 'active' : ''}
            onClick={() => setAppMode('actual')}
          >
            Actual tours
          </button>
        </div>

        {appMode === 'plan' ? (
          <ControlPanel
            patientCount={patients.length}
            sourceLabel={sourceLabel}
            onUpload={onUpload}
            onLoadSample={onLoadSample}
            mode={mode}
            onModeChange={onModeChange}
            capacityMode={capacityMode}
            onCapacityModeChange={onCapacityModeChange}
            form={form}
            onField={onField}
            roster={roster}
            updateRoster={updateRoster}
            addRosterRow={addRosterRow}
            removeRosterRow={removeRosterRow}
            onGo={onGo}
            running={running}
            statusMsg={statusMsg}
            statusErr={statusErr}
            plan={plan}
            activeDayPlan={activeDayPlan}
          />
        ) : (
          <ActualToursPanel
            toursStatus={toursStatus}
            toursErr={toursErr}
            onToursUpload={onToursUpload}
            onLoadSampleTours={onLoadSampleTours}
            onClearTours={onClearTours}
            dates={dates}
            selectedDate={safeDate}
            onSelectDate={onSelectDate}
            toursForDate={toursForDate}
            selectedTourKey={selectKey}
            onSelectTour={setSelectedTourKey}
            selectedTour={selectedTour}
            isAllView={allView}
          />
        )}
      </div>

      <div className="map-area">
        {appMode === 'plan' && plan && plan.mode === 'weekly' && (
          <div className="day-tabs">
            {plan.dayOrder.map((d) => {
              const n = plan.days[d].clusters.reduce(
                (s, c) => s + c.stops.length,
                0
              );
              return (
                <button
                  key={d}
                  className={d === activeDay ? 'active' : ''}
                  onClick={() => setActiveDay(d)}
                >
                  {d} ({n})
                </button>
              );
            })}
          </div>
        )}
        <MapView
          dayPlan={appMode === 'plan' ? activeDayPlan : tourDayPlan}
          showZones={appMode === 'plan'}
        />
        {appMode === 'plan' && !plan && (
          <div className="map-empty">
            Load patients, set your shifts, then press GO
          </div>
        )}
        {appMode === 'actual' && !tourDayPlan && (
          <div className="map-empty">Upload tour CSV files to begin</div>
        )}
      </div>
    </div>
  );
}
