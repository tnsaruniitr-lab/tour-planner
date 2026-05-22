import { useState, useMemo, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ActualToursPanel from './components/ActualToursPanel';
import MapView from './components/MapView';
import { parsePatientsCSV } from './lib/csv';
import { fileToCSV } from './lib/workbook';
import {
  loadSavedPatients,
  saveUploadedPatients,
  clearSavedPatients,
} from './lib/patientStore';
import { geocodePatients } from './lib/geocode';
import { buildPlan } from './lib/pipeline';
import { hhmmToMin } from './lib/schedule';
import {
  parseActualTours,
  rowKey,
  buildTours,
  tourToCluster,
  computeTourTravelMin,
  ALL_TOURS,
} from './lib/actualTours';
import {
  loadTourRows,
  saveTourRows,
  loadSelection,
  saveSelection,
  loadTourTravel,
  saveTourTravel,
  clearTourStore,
} from './lib/tourStore';
import { reassembleAll } from './lib/reassemble';

const DEFAULT_FORM = {
  shiftStart: '08:00',
  shiftEnd: '14:00',
  nurses: 4,
  maxShiftHours: 8,
  gapHours: 3,
  bufferPct: 35,
};

const DEFAULT_ROSTER = [
  { count: 2, hours: 7, start: '08:00' },
  { count: 2, hours: 5, start: '09:00' },
];

// The built-in planner dataset — a realistic week of 82 patients
// (≈605 visits/week), bundled in public/ so it is always available.
const SAMPLE_CSV_URL = '/sample-patients.csv';
const SAMPLE_LABEL = 'weekly sample — 605 visits/week';

async function fetchSamplePatients() {
  const res = await fetch(SAMPLE_CSV_URL);
  if (!res.ok) throw new Error('Sample dataset not found.');
  const parsed = parsePatientsCSV(await res.text());
  if (!parsed.length) throw new Error('Sample dataset is empty.');
  return parsed;
}

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
  // The last uploaded file is restored from localStorage on load.
  const [patients, setPatients] = useState(
    () => loadSavedPatients()?.patients || []
  );
  const [sourceLabel, setSourceLabel] = useState(
    () => loadSavedPatients()?.label || ''
  );
  const [hasSavedUpload, setHasSavedUpload] = useState(
    () => !!loadSavedPatients()
  );
  const [mode, setMode] = useState('daily');
  const [capacityMode, setCapacityMode] = useState('auto');
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
  const [hiddenTours, setHiddenTours] = useState({});
  const [amPmCutoff, setAmPmCutoff] = useState('12:00');
  const [tourTravel, setTourTravel] = useState(loadTourTravel);
  const [effComputing, setEffComputing] = useState(false);
  const [reForm, setReForm] = useState({
    gapHours: 3,
    mHours: 6,
    mCount: 8,
    eHours: 5,
    eCount: 4,
    maxHours: 8,
  });
  const [reassembled, setReassembled] = useState(null);
  const [reassembling, setReassembling] = useState(false);

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
      ? {
          clusters: toursForDate
            .map((t, i) => ({ t, i }))
            .filter(({ t }) => !hiddenTours[t.key])
            .map(({ t, i }) => tourToCluster(t, i)),
        }
      : null
    : { clusters: [tourToCluster(selectedTour, 0)] };

  useEffect(() => {
    saveSelection({ date: selectedDate, tourKey: selectedTourKey });
  }, [selectedDate, selectedTourKey]);

  // On first visit (no saved upload), open with the bundled weekly sample
  // so the planner always has the full 605-visit dataset ready.
  useEffect(() => {
    if (loadSavedPatients()) return;
    fetchSamplePatients()
      .then((parsed) => {
        setPatients(parsed);
        setSourceLabel(SAMPLE_LABEL);
      })
      .catch(() => {});
  }, []);

  // The Morning/Evening checkboxes also govern the re-assembled maps: if a
  // whole period is unchecked, that period's re-assembled tours are hidden too.
  const reCutoff = hhmmToMin(amPmCutoff);
  const reMorningKeys = toursForDate
    .filter((t) => hhmmToMin(t.shiftStart) < reCutoff)
    .map((t) => t.key);
  const reEveningKeys = toursForDate
    .filter((t) => hhmmToMin(t.shiftStart) >= reCutoff)
    .map((t) => t.key);
  const morningHidden =
    reMorningKeys.length > 0 && reMorningKeys.every((k) => hiddenTours[k]);
  const eveningHidden =
    reEveningKeys.length > 0 && reEveningKeys.every((k) => hiddenTours[k]);
  const reClusters = (modeResult) =>
    modeResult
      ? modeResult.clusters.filter((c) =>
          c.period === 'morning' ? !morningHidden : !eveningHidden
        )
      : [];
  const multiMap = appMode === 'actual' && !!reassembled;

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
      const text = await fileToCSV(file);
      const parsed = parsePatientsCSV(text);
      if (!parsed.length) throw new Error('No rows found in the file.');
      setPatients(parsed);
      setSourceLabel(file.name);
      // Persist the upload so it survives reloads and is reloadable later.
      saveUploadedPatients(file.name, parsed);
      setHasSavedUpload(true);
      clearPlan();
    } catch (err) {
      setStatusMsg(err.message);
      setStatusErr(true);
    }
  }

  function onLoadSaved() {
    const saved = loadSavedPatients();
    if (!saved) return;
    setPatients(saved.patients);
    setSourceLabel(saved.label);
    clearPlan();
  }

  function onClearSaved() {
    clearSavedPatients();
    setHasSavedUpload(false);
  }

  function onLoadSample() {
    fetchSamplePatients()
      .then((parsed) => {
        setPatients(parsed);
        setSourceLabel(SAMPLE_LABEL);
        clearPlan();
      })
      .catch((err) => {
        setStatusMsg(err.message);
        setStatusErr(true);
      });
  }

  async function onGo() {
    setRunning(true);
    setStatusErr(false);
    setPlan(null);
    try {
      const settings = {
        gapMin: Math.round((parseFloat(form.gapHours) || 0) * 60),
        bufferPct: Math.max(0, parseFloat(form.bufferPct) || 0),
        speedKmh: 30,
      };

      if (capacityMode === 'auto') {
        const maxShiftMin = Math.round((parseFloat(form.maxShiftHours) || 0) * 60);
        if (maxShiftMin <= 0) {
          throw new Error('Max shift length must be a positive number.');
        }
        settings.auto = true;
        settings.maxShiftMin = maxShiftMin;
        settings.startMin = hhmmToMin(form.shiftStart);
      } else {
        const shifts = buildShifts();
        if (!shifts.length) throw new Error('Add at least one shift.');
        if (shifts.some((s) => s.lengthMin <= 0)) {
          throw new Error('Every shift must have a positive length.');
        }
        settings.shifts = shifts;
      }

      setStatusMsg('Geocoding addresses…');
      const { located, failed } = await geocodePatients(patients, (done, total) => {
        if (total) setStatusMsg(`Geocoding addresses… ${done}/${total}`);
      });
      if (!located.length) throw new Error('No addresses could be geocoded.');

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
        Array.from(fileList).map((f) => fileToCSV(f))
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
    setReassembled(null);
  }

  function onReField(name, value) {
    setReForm((f) => ({ ...f, [name]: value }));
  }

  async function onReassemble() {
    setReassembling(true);
    try {
      const result = await reassembleAll(toursForDate, {
        cutoffMin: hhmmToMin(amPmCutoff),
        gapMin: Math.round((parseFloat(reForm.gapHours) || 3) * 60),
        mHours: parseFloat(reForm.mHours) || 6,
        mCount: parseInt(reForm.mCount, 10) || 1,
        eHours: parseFloat(reForm.eHours) || 5,
        eCount: parseInt(reForm.eCount, 10) || 1,
        maxHours: parseFloat(reForm.maxHours) || 8,
      });
      setReassembled(result);
    } catch {
      setReassembled(null);
    } finally {
      setReassembling(false);
    }
  }

  async function onComputeEfficiency() {
    setEffComputing(true);
    try {
      const updated = { ...tourTravel };
      const todo = toursForDate.filter((t) => updated[t.key] == null);
      for (let i = 0; i < todo.length; i += 6) {
        const batch = todo.slice(i, i + 6);
        await Promise.all(
          batch.map(async (t) => {
            updated[t.key] = await computeTourTravelMin(t);
          })
        );
      }
      setTourTravel(updated);
      saveTourTravel(updated);
    } finally {
      setEffComputing(false);
    }
  }

  function onClearTours() {
    clearTourStore();
    setTourRows({});
    setSelectedDate('');
    setSelectedTourKey(ALL_TOURS);
    setToursStatus('');
    setToursErr(false);
    setHiddenTours({});
    setTourTravel({});
    setReassembled(null);
  }

  function onToggleTour(key) {
    setHiddenTours((h) => ({ ...h, [key]: !h[key] }));
  }

  function onSetGroupVisible(keys, visible) {
    setHiddenTours((h) => {
      const next = { ...h };
      for (const k of keys) next[k] = !visible;
      return next;
    });
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
            onLoadSaved={onLoadSaved}
            onClearSaved={onClearSaved}
            hasSavedUpload={hasSavedUpload}
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
            hiddenTours={hiddenTours}
            onToggleTour={onToggleTour}
            onSetGroupVisible={onSetGroupVisible}
            amPmCutoff={amPmCutoff}
            onCutoffChange={setAmPmCutoff}
            tourTravel={tourTravel}
            onComputeEfficiency={onComputeEfficiency}
            effComputing={effComputing}
            reForm={reForm}
            onReField={onReField}
            onReassemble={onReassemble}
            reassembling={reassembling}
            reassembled={reassembled}
          />
        )}
      </div>

      <div className="map-area">
        <div className="map-pane">
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
          {appMode === 'actual' && reassembled && (
            <div className="map-label">Actual tours</div>
          )}
          <MapView
            dayPlan={appMode === 'plan' ? activeDayPlan : tourDayPlan}
            showZones={appMode === 'plan'}
            scrollZoom={!multiMap}
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
        {appMode === 'actual' && reassembled && (
          <>
            <div className="map-pane">
              <div className="map-label">Re-assembled — same as file</div>
              <MapView
                dayPlan={{ clusters: reClusters(reassembled.file) }}
                showZones={true}
                scrollZoom={false}
              />
            </div>
            <div className="map-pane">
              <div className="map-label">Re-assembled — uniform shifts</div>
              <MapView
                dayPlan={{ clusters: reClusters(reassembled.uniform) }}
                showZones={true}
                scrollZoom={false}
              />
            </div>
            <div className="map-pane">
              <div className="map-label">Re-assembled — fewest nurses</div>
              <MapView
                dayPlan={{ clusters: reClusters(reassembled.fewest) }}
                showZones={true}
                scrollZoom={false}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
