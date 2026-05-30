import { useState, useMemo, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ActualToursPanel from './components/ActualToursPanel';
import MapView from './components/MapView';
import Login from './components/Login';
import { parsePatientsCSV } from './lib/csv';
import { fileToCSV } from './lib/workbook';
import {
  loadSavedPatients,
  saveUploadedPatients,
  clearSavedPatients,
} from './lib/patientStore';
import { geocodePatients } from './lib/geocode';
import { buildPlan, planDay } from './lib/pipeline';
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
import { moveStop, aggregate } from './lib/editTours';

const DEFAULT_FORM = {
  shiftStart: '08:00',
  shiftEnd: '14:00',
  nurses: 4,
  maxShiftHours: 8,
  targetUtil: 88,
  gapHours: 3,
  bufferPct: 35,
};

const DEFAULT_ROSTER = [
  { count: 2, hours: 7, start: '08:00' },
  { count: 2, hours: 5, start: '09:00' },
];

// Built-in planner datasets, bundled in public/ so they are always available.
// Pick which one to load via the dataset selector in the control panel.
const SAMPLES = [
  { key: 'ambulant', url: '/sample-patients-ambulant.csv',
    label: 'Ambulant week — 18.–24.05.2026 (164 patients)' },
  { key: 'demo', url: '/sample-patients.csv',
    label: 'weekly sample — 605 visits/week' },
];
const SAMPLE_BY_KEY = Object.fromEntries(SAMPLES.map((s) => [s.key, s]));

// Bump this whenever the bundled tour CSVs change, so returning visitors
// auto-pull the new data once (merged) instead of being stuck on a stale cache.
const BUNDLE_VERSION_KEY = 'bundledToursVersion';
const BUNDLE_VERSION = 'ambulant-2026-05-v3';

async function fetchSamplePatients(url = SAMPLES[0].url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Sample dataset not found.');
  const parsed = parsePatientsCSV(await res.text());
  if (!parsed.length) throw new Error('Sample dataset is empty.');
  return parsed;
}

function fmtHours(h) {
  return (Number.isInteger(h) ? h : Number(h.toFixed(2))) + 'h';
}

// Group a planned day's tours into an editable hours×count roster,
// bucketed to the nearest half-hour.
function rosterFromClusters(clusters) {
  const byBucket = {};
  for (const c of clusters) {
    const hrs = Math.round(c.shiftLengthMin / 30) / 2;
    byBucket[hrs] = (byBucket[hrs] || 0) + 1;
  }
  return Object.entries(byBucket)
    .map(([hours, count]) => ({ hours: Number(hours), count }))
    .sort((a, b) => b.hours - a.hours);
}

function sortTours(list) {
  return [...list].sort((a, b) =>
    a.shortId.localeCompare(b.shortId, undefined, { numeric: true })
  );
}

const AUTH_KEY = 'touring_auth_v1';

export default function App() {
  const [authed, setAuthed] = useState(() => {
    try {
      return localStorage.getItem(AUTH_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [appMode, setAppMode] = useState('plan');

  // Which bundled dataset the planner's "Load sample" uses.
  const [sampleKey, setSampleKey] = useState(SAMPLES[0].key);

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
  // Manual per-day shift adjustment.
  const [planSettings, setPlanSettings] = useState(null);
  const [dayRosters, setDayRosters] = useState({});
  const [dayRosterBase, setDayRosterBase] = useState({});
  const [replanningDay, setReplanningDay] = useState(false);

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
    maxHours: 8,
  });
  const [reassembled, setReassembled] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editHistory, setEditHistory] = useState([]); // pre-move snapshots = undo stack
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
    const s = SAMPLE_BY_KEY[sampleKey];
    fetchSamplePatients(s.url)
      .then((parsed) => {
        setPatients(parsed);
        setSourceLabel(s.label);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load the bundled tours once per dataset version so the daily view
  // shows every date on open without clicking "Load saved". Uses replace (not
  // merge) so a stale cached set from an older version is cleanly superseded
  // instead of duplicated (split shifts change visit IDs).
  useEffect(() => {
    let current = false;
    try {
      current = localStorage.getItem(BUNDLE_VERSION_KEY) === BUNDLE_VERSION;
    } catch {}
    if (current) return;
    (async () => {
      try {
        const urls = ['/sample-tours-ambulant.csv', '/sample-tours.csv'];
        const texts = await Promise.all(
          urls.map((u) => fetch(u).then((r) => (r.ok ? r.text() : '')))
        );
        const loaded = texts.filter(Boolean);
        if (loaded.length) ingestTourTexts(loaded, true);
      } catch {}
      try {
        localStorage.setItem(BUNDLE_VERSION_KEY, BUNDLE_VERSION);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setDayRosters({});
    setDayRosterBase({});
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
    const s = SAMPLE_BY_KEY[sampleKey];
    fetchSamplePatients(s.url)
      .then((parsed) => {
        setPatients(parsed);
        setSourceLabel(s.label);
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
        settings.targetUtil = Math.min(
          1,
          Math.max(0.6, (parseFloat(form.targetUtil) || 88) / 100)
        );
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

      // Seed the per-day shift editor from the fresh plan.
      setPlanSettings(settings);
      const rosters = {};
      const bases = {};
      for (const d of result.dayOrder) {
        const rows = rosterFromClusters(result.days[d]?.clusters || []);
        rosters[d] = rows;
        bases[d] = rows.reduce((s, r) => s + r.hours * 60 * r.count, 0);
      }
      setDayRosters(rosters);
      setDayRosterBase(bases);

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

  // ---- Manual per-day shift adjustment ----
  function onDayRosterChange(i, key, value) {
    setDayRosters((r) => ({
      ...r,
      [activeDay]: (r[activeDay] || []).map((row, idx) =>
        idx === i ? { ...row, [key]: value } : row
      ),
    }));
  }

  function onAddDayShift() {
    setDayRosters((r) => ({
      ...r,
      [activeDay]: [...(r[activeDay] || []), { hours: 8, count: 1 }],
    }));
  }

  function onRemoveDayShift(i) {
    setDayRosters((r) => ({
      ...r,
      [activeDay]: (r[activeDay] || []).filter((_, idx) => idx !== i),
    }));
  }

  async function onReplanDay() {
    const day = activeDay;
    const rows = dayRosters[day] || [];
    const dayPatients = plan?.days?.[day]?.patients || [];
    if (!dayPatients.length) return;

    const startMin = hhmmToMin(form.shiftStart);
    const shifts = [];
    for (const row of rows) {
      const count = Math.max(0, Math.round(Number(row.count) || 0));
      const lengthMin = Math.round((Number(row.hours) || 0) * 60);
      for (let i = 0; i < count; i++) {
        shifts.push({ startMin, lengthMin, label: fmtHours(Number(row.hours) || 0) });
      }
    }
    if (!shifts.length || shifts.some((s) => s.lengthMin <= 0)) {
      setStatusMsg('Add at least one shift with a positive length to replan.');
      setStatusErr(true);
      return;
    }

    setReplanningDay(true);
    setStatusErr(false);
    setStatusMsg(`Replanning ${day}…`);
    try {
      const dayResult = await planDay(dayPatients, {
        ...planSettings,
        auto: false,
        shifts,
      });
      dayResult.patients = dayPatients;
      setPlan((p) => ({ ...p, days: { ...p.days, [day]: dayResult } }));
      setStatusMsg(
        `Replanned ${day} into ${dayResult.clusters.length} tour(s).`
      );
    } catch (err) {
      setStatusMsg(err.message || 'Replan failed.');
      setStatusErr(true);
    } finally {
      setReplanningDay(false);
    }
  }

  // ---- Visualiser handlers ----
  function ingestTourTexts(texts, replace = false) {
    const merged = replace ? {} : { ...tourRows };
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
      // Load both bundled tour sets so every date is selectable together:
      // the ambulant week (18.–24.05.2026) plus the original demo days.
      const urls = ['/sample-tours-ambulant.csv', '/sample-tours.csv'];
      const texts = await Promise.all(
        urls.map((u) => fetch(u).then((r) => (r.ok ? r.text() : '')))
      );
      const loaded = texts.filter(Boolean);
      if (!loaded.length) throw new Error('No bundled tour data found.');
      ingestTourTexts(loaded, true); // replace, so the button always loads the clean bundle
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
        maxHours: parseFloat(reForm.maxHours) || 8,
      });
      setReassembled(result);
      setEditHistory([]); // fresh plan → clear undo history
    } catch {
      setReassembled(null);
    } finally {
      setReassembling(false);
    }
  }

  // Manual override (only in edit mode): drop a stop onto another tour →
  // reassign + reroute both, refresh metrics. Each move snapshots the prior
  // plan onto the undo stack.
  function onReassignStop(mode, fromId, order, ll) {
    if (!editMode || !reassembled || !reassembled[mode]) return;
    const clusters = moveStop(reassembled[mode].clusters, fromId, order, {
      lat: ll[0],
      lng: ll[1],
    });
    setEditHistory((h) => [...h, reassembled]);
    setReassembled({
      ...reassembled,
      [mode]: aggregate({ ...reassembled[mode], clusters }),
    });
  }

  // Undo the last manual move (multi-step), or discard all moves back to the
  // freshly re-assembled plan. Both are instant — no recompute.
  function onUndoEdit() {
    if (!editHistory.length) return;
    setReassembled(editHistory[editHistory.length - 1]);
    setEditHistory(editHistory.slice(0, -1));
  }

  function onResetEdits() {
    if (!editHistory.length) return;
    setReassembled(editHistory[0]); // state before the first move = the auto plan
    setEditHistory([]);
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

  function handleLogin() {
    try {
      localStorage.setItem(AUTH_KEY, '1');
    } catch {
      /* ignore */
    }
    setAuthed(true);
  }

  function handleLogout() {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
    setAuthed(false);
  }

  if (!authed) return <Login onLogin={handleLogin} />;

  return (
    <div className="app">
      <div className="panel">
        <button className="logout-btn" onClick={handleLogout}>
          Log out
        </button>
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
            samples={SAMPLES}
            sampleKey={sampleKey}
            onSampleKeyChange={setSampleKey}
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
            dayName={activeDay}
            dayRoster={dayRosters[activeDay]}
            dayRosterBaseMin={dayRosterBase[activeDay]}
            onDayRosterChange={onDayRosterChange}
            onAddDayShift={onAddDayShift}
            onRemoveDayShift={onRemoveDayShift}
            onReplanDay={onReplanDay}
            replanningDay={replanningDay}
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
            editMode={editMode}
            onToggleEditMode={() => setEditMode((v) => !v)}
            onUndoEdit={onUndoEdit}
            onResetEdits={onResetEdits}
            canUndo={editHistory.length > 0}
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
            <div className="map-label">Actual tours — from file</div>
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
              <div className="map-label">
                Re-assembled — same as file{editMode && <span className="map-hint">· drag a dot onto another tour to reassign</span>}
              </div>
              <MapView
                dayPlan={{ clusters: reClusters(reassembled.file) }}
                showZones={true}
                scrollZoom={false}
                editable={editMode}
                onMoveStop={(fromId, order, ll) => onReassignStop('file', fromId, order, ll)}
              />
            </div>
            <div className="map-pane">
              <div className="map-label">
                Re-assembled — fewest nurses{editMode && <span className="map-hint">· drag a dot onto another tour to reassign</span>}
              </div>
              <MapView
                dayPlan={{ clusters: reClusters(reassembled.fewest) }}
                showZones={true}
                scrollZoom={false}
                editable={editMode}
                onMoveStop={(fromId, order, ll) => onReassignStop('fewest', fromId, order, ll)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
