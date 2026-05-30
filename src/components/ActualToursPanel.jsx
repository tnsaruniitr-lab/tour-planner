import { useState } from 'react';
import { ALL_TOURS } from '../lib/actualTours';
import { clusterColor } from '../lib/colors';
import { hhmmToMin } from '../lib/schedule';
import { obfuscateName } from '../lib/obfuscate';
import { countStops } from '../lib/stops';

function fmtDuration(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');

const fmtHrsShort = (min) => {
  const h = (min || 0) / 60;
  return (Number.isInteger(h) ? h : Number(h.toFixed(1))) + 'h';
};

export default function ActualToursPanel({
  toursStatus,
  toursErr,
  onToursUpload,
  onLoadSampleTours,
  onClearTours,
  dates,
  selectedDate,
  onSelectDate,
  toursForDate,
  selectedTourKey,
  onSelectTour,
  selectedTour,
  isAllView,
  hiddenTours,
  onToggleTour,
  onSetGroupVisible,
  amPmCutoff,
  onCutoffChange,
  tourTravel,
  onComputeEfficiency,
  effComputing,
  reForm,
  onReField,
  onReassemble,
  reassembling,
  reassembled,
  optimized,
  routeView,
  onRouteViewChange,
  editMode,
  onToggleEditMode,
  onUndoEdit,
  onResetEdits,
  canUndo,
}) {
  const [effType, setEffType] = useState('actual');
  const [compPeriod, setCompPeriod] = useState('both');
  const totalVisits = toursForDate.reduce((s, t) => s + t.visits.length, 0);
  const totalStops = toursForDate.reduce((s, t) => s + countStops(t.visits), 0);
  // Milk-run = the File plan with each tour locally optimised into a clean loop.
  const optFileResult = optimized ? { clusters: optimized.file } : null;

  // Morning/Evening classification by shift start vs. the cutoff.
  const cutoff = hhmmToMin(amPmCutoff);
  const decorated = toursForDate.map((t, i) => ({
    t,
    i,
    evening: hhmmToMin(t.shiftStart) >= cutoff,
  }));
  const morning = decorated.filter((d) => !d.evening);
  const evening = decorated.filter((d) => d.evening);

  // Efficiency definitions (no rounding in the maths):
  //  OSRM   = service / (service + OSRM road travel x1.5)
  //  Actual = service / (service + recorded travel + recorded waiting)
  const osrmEff = (t) => {
    const tr = tourTravel[t.key];
    if (tr == null) return null;
    const svc = t.serviceTimeMin || 0;
    return svc + tr > 0 ? svc / (svc + tr) : 0;
  };
  const actualEff = (t) => {
    const svc = t.serviceTimeMin || 0;
    const tot = svc + (t.travelTimeMin || 0) + (t.waitingTimeMin || 0);
    return tot > 0 ? svc / tot : 0;
  };
  const groupEff = (list, mode) => {
    let num = 0;
    let den = 0;
    for (const { t } of list) {
      const svc = t.serviceTimeMin || 0;
      if (mode === 'osrm') {
        const tr = tourTravel[t.key];
        if (tr == null) continue;
        num += svc;
        den += svc + tr;
      } else {
        num += svc;
        den += svc + (t.travelTimeMin || 0) + (t.waitingTimeMin || 0);
      }
    }
    return den > 0 ? num / den : null;
  };
  const allOsrm =
    toursForDate.length > 0 &&
    toursForDate.every((t) => tourTravel[t.key] != null);

  // Re-assembly comparison metrics, filtered by the Morning/Evening selector.
  const inComp = (isEvening) =>
    compPeriod === 'both' || (compPeriod === 'evening') === isEvening;
  const compActTours = toursForDate.filter((t) =>
    inComp(hhmmToMin(t.shiftStart) >= cutoff)
  );
  const compActSvc = compActTours.reduce((s, t) => s + (t.serviceTimeMin || 0), 0);
  const compActTrv = compActTours.reduce((s, t) => s + (t.travelTimeMin || 0), 0);
  // Recorded waiting time from the uploaded data — it is real lost time, so
  // the actual day's efficiency is measured against it too. A freshly
  // re-planned tour is scheduled tight and carries no recorded waiting.
  const compActWait = compActTours.reduce((s, t) => s + (t.waitingTimeMin || 0), 0);
  const compActTotal = compActSvc + compActTrv + compActWait;
  const compActVisits = compActTours.reduce((s, t) => s + t.visits.length, 0);
  const compActEff = compActTotal > 0 ? compActSvc / compActTotal : null;
  const compActTrvPct = compActTotal > 0 ? compActTrv / compActTotal : null;
  const compActWaitPct = compActTotal > 0 ? compActWait / compActTotal : null;
  const modeMetrics = (m) => {
    if (!m) {
      return {
        eff: null, travelPct: null, waitPct: null, tours: 0,
        serviceMin: 0, travelMin: 0, workingMin: 0, visits: 0,
      };
    }
    const cl = m.clusters.filter((c) => inComp(c.period === 'evening'));
    const svc = cl.reduce((s, c) => s + (c.serviceMin || 0), 0);
    const trv = cl.reduce((s, c) => s + (c.travelMin || 0), 0);
    const w = svc + trv;
    const visits = cl.reduce((s, c) => s + (c.stops ? c.stops.length : 0), 0);
    return {
      eff: w > 0 ? svc / w : null,
      travelPct: w > 0 ? trv / w : null,
      waitPct: null, // re-planned tours have no recorded waiting
      tours: cl.length,
      serviceMin: svc,
      travelMin: trv,
      workingMin: w,
      visits,
    };
  };

  // Shift-length distribution — shift hours rounded UP to the next whole hour.
  const bucketTours = {};
  for (const t of toursForDate) {
    const h = Math.ceil((t.shiftDuration || 0) / 60);
    (bucketTours[h] = bucketTours[h] || []).push(t);
  }
  const bucketHours = Object.keys(bucketTours)
    .map(Number)
    .sort((a, b) => b - a);
  const colorByKey = {};
  toursForDate.forEach((t, i) => {
    colorByKey[t.key] = clusterColor(i);
  });
  const allKeys = toursForDate.map((t) => t.key);
  const allVisible = toursForDate.every((t) => !hiddenTours[t.key]);
  const anyVisible = toursForDate.some((t) => !hiddenTours[t.key]);

  const renderRow = ({ t, i }) => (
    <label className="legend-item" key={t.key}>
      <input
        type="checkbox"
        checked={!hiddenTours[t.key]}
        onChange={() => onToggleTour(t.key)}
      />
      <span className="swatch" style={{ background: clusterColor(i) }} />
      <span>
        {t.shortId} · {obfuscateName(t.nurseName)} ({t.visits.length})
      </span>
    </label>
  );

  // Group header with a select-all / unselect-all master checkbox.
  const groupHeader = (label, list) => {
    const keys = list.map((d) => d.t.key);
    const allOn = list.length > 0 && list.every((d) => !hiddenTours[d.t.key]);
    const anyOn = list.some((d) => !hiddenTours[d.t.key]);
    return (
      <label className="tour-group-title group-toggle">
        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = anyOn && !allOn;
          }}
          checked={allOn}
          onChange={() => onSetGroupVisible(keys, !allOn)}
        />
        <span>
          {label} ({list.length})
        </span>
      </label>
    );
  };

  return (
    <>
      <h1>Outpatient Touring</h1>
      <p className="sub">Visualise actual nurse tours on the map.</p>

      <div className="section">
        <div className="section-title">Tour data</div>
        <div className="upload-row">
          <label className="btn btn-file">
            Upload file(s)
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files.length) onToursUpload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <button className="btn" onClick={onLoadSampleTours}>
            Load saved
          </button>
        </div>
        {toursStatus ? (
          <div className={'status' + (toursErr ? ' err' : '')}>{toursStatus}</div>
        ) : (
          <p className="note">
            Upload one or more actual-tours files (CSV or Excel .xlsx). Loaded
            tours are saved in this browser, so they reload automatically next
            time.
          </p>
        )}
        {dates.length > 0 && (
          <button
            className="btn btn-block"
            style={{ marginTop: 8 }}
            onClick={onClearTours}
          >
            Clear saved data
          </button>
        )}
      </div>

      {dates.length > 0 && (
        <div className="section">
          <div className="section-title">Select tour</div>
          <div className="field">
            <label>Date</label>
            <select value={selectedDate} onChange={(e) => onSelectDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tour / nurse</label>
            <select
              value={selectedTourKey}
              onChange={(e) => onSelectTour(e.target.value)}
            >
              <option value={ALL_TOURS}>
                ★ All tours ({toursForDate.length})
              </option>
              {toursForDate.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.shortId} · {obfuscateName(t.nurseName)} ({t.visits.length})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {toursForDate.length > 0 && (
        <div className="section">
          <div className="section-title">Re-assemble into circular tours</div>
          <p className="note">
            Re-plan the day's visits into clean circular tours — same nurse
            count and shift lengths as the file. Morning/evening kept separate;
            2-visit patients kept with one nurse ≥ the gap apart.
          </p>
          <div className="row">
            <div className="field">
              <label>Min gap (hours)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={reForm.gapHours}
                onChange={(e) => onReField('gapHours', e.target.value)}
              />
            </div>
          </div>
          <button
            className="btn-go"
            onClick={onReassemble}
            disabled={reassembling}
          >
            {reassembling
              ? 'Re-assembling…'
              : 'Re-assemble into circular tours'}
          </button>

          {reassembled && (
            <>
              <div className="edit-bar">
                <button
                  className={'btn' + (editMode ? ' active' : '')}
                  onClick={onToggleEditMode}
                >
                  {editMode ? '✓ Editing' : '✏ Edit tours'}
                </button>
                <button className="btn" onClick={onUndoEdit} disabled={!canUndo}>
                  ↶ Undo
                </button>
                <button className="btn" onClick={onResetEdits} disabled={!canUndo}>
                  ⟲ Reset to auto
                </button>
              </div>
              {editMode && (
                <p className="note" style={{ margin: '0 0 8px' }}>
                  Edit on — drag a dot on a re-assembled map onto another tour to
                  move it there. Undo steps back; Reset restores the auto plan.
                  Editing works in the <b>Auto</b> view.
                </p>
              )}
              {optimized && (
                <>
                  <div className="mode-toggle" style={{ margin: '6px 0' }}>
                    <span style={{ alignSelf: 'center', marginRight: 8, fontSize: 12, opacity: 0.7 }}>
                      Routes
                    </span>
                    <button
                      className={routeView === 'auto' ? 'active' : ''}
                      onClick={() => onRouteViewChange('auto')}
                    >
                      Auto
                    </button>
                    <button
                      className={routeView === 'milkrun' ? 'active' : ''}
                      onClick={() => onRouteViewChange('milkrun')}
                    >
                      Milk-run
                    </button>
                  </div>
                  <p className="note" style={{ margin: '0 0 8px' }}>
                    {routeView === 'milkrun'
                      ? 'Milk-run: each tour re-ordered into a clean loop (2-opt), repeats slotted on the return leg ≥ the gap apart. Flip to Auto to edit.'
                      : 'Auto: the re-assembled plan as planned. Flip to Milk-run to see each tour optimised into a circular route.'}
                  </p>
                </>
              )}
              <div className="mode-toggle" style={{ margin: '10px 0 6px' }}>
                <button
                  className={compPeriod === 'both' ? 'active' : ''}
                  onClick={() => setCompPeriod('both')}
                >
                  Both
                </button>
                <button
                  className={compPeriod === 'morning' ? 'active' : ''}
                  onClick={() => setCompPeriod('morning')}
                >
                  Morning
                </button>
                <button
                  className={compPeriod === 'evening' ? 'active' : ''}
                  onClick={() => setCompPeriod('evening')}
                >
                  Evening
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th />
                    <th>Actual</th>
                    <th>File</th>
                    <th>Milk-run</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Efficiency</td>
                    <td>{pct(compActEff)}</td>
                    <td>{pct(modeMetrics(reassembled.file).eff)}</td>
                    <td>{pct(modeMetrics(optFileResult).eff)}</td>
                  </tr>
                  <tr>
                    <td>Travel</td>
                    <td>{pct(compActTrvPct)}</td>
                    <td>{pct(modeMetrics(reassembled.file).travelPct)}</td>
                    <td>{pct(modeMetrics(optFileResult).travelPct)}</td>
                  </tr>
                  <tr>
                    <td>Waiting</td>
                    <td>{pct(compActWaitPct)}</td>
                    <td>{pct(modeMetrics(reassembled.file).waitPct)}</td>
                    <td>{pct(modeMetrics(optFileResult).waitPct)}</td>
                  </tr>
                  <tr>
                    <td>Tours</td>
                    <td>{compActTours.length}</td>
                    <td>{modeMetrics(reassembled.file).tours}</td>
                    <td>{modeMetrics(optFileResult).tours}</td>
                  </tr>
                </tbody>
              </table>
              <p className="note">
                Actual efficiency = service ÷ (service + travel + recorded
                waiting from the file); the re-planned tour is scheduled tight,
                so it carries no waiting. <b>Milk-run</b> = the File plan with
                each tour re-ordered into a clean loop (travel is a
                straight-line×1.5 estimate, so read the trend). Toggle Morning /
                Evening / Both above; the map shows below.
              </p>

              {(() => {
                const f = modeMetrics(reassembled.file);
                return (
                  <details className="collapsible">
                    <summary>Actual vs File plan — detailed breakdown</summary>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th />
                          <th>Actual</th>
                          <th>File plan</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Nurses</td>
                          <td>{compActTours.length}</td>
                          <td>{f.tours}</td>
                        </tr>
                        <tr>
                          <td>Visits</td>
                          <td>{compActVisits}</td>
                          <td>{f.visits}</td>
                        </tr>
                        <tr>
                          <td>Care time</td>
                          <td>{fmtDuration(compActSvc)}</td>
                          <td>{fmtDuration(f.serviceMin)}</td>
                        </tr>
                        <tr>
                          <td>Travel time</td>
                          <td>{fmtDuration(compActTrv)}</td>
                          <td>{fmtDuration(f.travelMin)}</td>
                        </tr>
                        <tr>
                          <td>Waiting time</td>
                          <td>{fmtDuration(compActWait)}</td>
                          <td>—</td>
                        </tr>
                        <tr>
                          <td>Total time</td>
                          <td>{fmtDuration(compActTotal)}</td>
                          <td>{fmtDuration(f.workingMin)}</td>
                        </tr>
                        <tr>
                          <td>Efficiency</td>
                          <td>{pct(compActEff)}</td>
                          <td>{pct(f.eff)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="note">
                      Care time is the same work; the File plan trims travel
                      and removes waiting — that saved time is the slack each
                      nurse gains at the same headcount.
                    </p>
                  </details>
                );
              })()}

              {(() => {
                // Pair each actual tour with a File-plan tour of the same
                // shift length (File mode reuses the file's shift lengths,
                // so the lengths match exactly). Spare actuals get "—".
                const acts = [...compActTours]
                  .map((t) => {
                    const svc = t.serviceTimeMin || 0;
                    const tot =
                      svc + (t.travelTimeMin || 0) + (t.waitingTimeMin || 0);
                    return {
                      id: t.shortId,
                      shiftMin: t.shiftDuration || 0,
                      eff: tot > 0 ? svc / tot : null,
                    };
                  })
                  .sort((a, b) => b.shiftMin - a.shiftMin);
                const filePool = reassembled.file.clusters
                  .filter((c) => inComp(c.period === 'evening'))
                  .map((c) => {
                    const svc = c.serviceMin || 0;
                    const w = svc + (c.travelMin || 0);
                    return {
                      shiftMin: c.shiftLengthMin || 0,
                      eff: w > 0 ? svc / w : null,
                    };
                  });
                const rows = acts.map((a) => {
                  const idx = filePool.findIndex(
                    (f) => f.shiftMin === a.shiftMin
                  );
                  const paired = idx >= 0;
                  const fileEff = paired ? filePool[idx].eff : null;
                  if (paired) filePool.splice(idx, 1);
                  return { ...a, fileEff, paired };
                });
                return (
                  <details className="collapsible">
                    <summary>Per-tour metrics — Actual vs File plan</summary>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Tour</th>
                          <th>Shift</th>
                          <th>Actual</th>
                          <th>File</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.id}</td>
                            <td>{fmtHrsShort(r.shiftMin)}</td>
                            <td>{pct(r.eff)}</td>
                            <td>{r.paired ? pct(r.fileEff) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="note">
                      Care efficiency, one row per tour, paired by shift
                      length. Where the re-plan used fewer tours, the File
                      cell shows —.
                    </p>
                  </details>
                );
              })()}
            </>
          )}
        </div>
      )}

      {isAllView && toursForDate.length > 0 && (
        <div className="section">
          <div className="section-title">All tours — {selectedDate}</div>
          <div className="summary">
            <div className="stat">
              <span>Tours</span>
              <b>{toursForDate.length}</b>
            </div>
            <div className="stat">
              <span>Map dots (stops)</span>
              <b>{totalStops}</b>
            </div>
            <div className="stat">
              <span>Total visits mapped</span>
              <b>{totalVisits}</b>
            </div>
          </div>
          <div className="field">
            <label>Morning / evening split at</label>
            <input
              type="time"
              value={amPmCutoff}
              onChange={(e) => onCutoffChange(e.target.value)}
            />
          </div>

          {groupHeader('Morning', morning)}
          <div className="legend">{morning.map(renderRow)}</div>

          {groupHeader('Evening', evening)}
          <div className="legend">{evening.map(renderRow)}</div>
        </div>
      )}

      {isAllView && toursForDate.length > 0 && (
        <div className="section">
          <div className="section-title">Efficiency &amp; shifts</div>

          {!allOsrm && (
            <button
              className="btn btn-block"
              style={{ marginBottom: 8 }}
              onClick={onComputeEfficiency}
              disabled={effComputing}
            >
              {effComputing
                ? 'Computing road travel…'
                : 'Calculate OSRM efficiency'}
            </button>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>OSRM</th>
                <th>Actual</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Morning</td>
                <td>{pct(groupEff(morning, 'osrm'))}</td>
                <td>{pct(groupEff(morning, 'actual'))}</td>
              </tr>
              <tr>
                <td>Evening</td>
                <td>{pct(groupEff(evening, 'osrm'))}</td>
                <td>{pct(groupEff(evening, 'actual'))}</td>
              </tr>
            </tbody>
          </table>
          <p className="note">
            OSRM = service ÷ (service + OSRM travel ×1.5). Actual = service ÷
            (service + recorded travel + waiting).
          </p>

          <details className="collapsible">
            <summary>Efficiency by tour</summary>
            <div className="mode-toggle" style={{ margin: '8px 0' }}>
              <button
                className={effType === 'osrm' ? 'active' : ''}
                onClick={() => setEffType('osrm')}
              >
                OSRM
              </button>
              <button
                className={effType === 'actual' ? 'active' : ''}
                onClick={() => setEffType('actual')}
              >
                Actual
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tour</th>
                  <th>Service</th>
                  <th>Travel</th>
                  <th>Wait</th>
                  <th>Eff.</th>
                </tr>
              </thead>
              <tbody>
                {toursForDate.map((t) => {
                  const osrm = effType === 'osrm';
                  return (
                    <tr key={t.key}>
                      <td>{t.shortId}</td>
                      <td>{fmtDuration(t.serviceTimeMin)}</td>
                      <td>
                        {fmtDuration(osrm ? tourTravel[t.key] : t.travelTimeMin)}
                      </td>
                      <td>{osrm ? '—' : fmtDuration(t.waitingTimeMin)}</td>
                      <td>{pct(osrm ? osrmEff(t) : actualEff(t))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>

          <div className="tour-group-title">Shift length distribution</div>
          <label className="legend-item">
            <input
              type="checkbox"
              ref={(el) => {
                if (el) el.indeterminate = anyVisible && !allVisible;
              }}
              checked={allVisible}
              onChange={() => onSetGroupVisible(allKeys, !allVisible)}
            />
            <span>
              <b>Select all</b> ({toursForDate.length})
            </span>
          </label>
          {bucketHours.map((h) => (
            <div className="shift-row" key={h}>
              <span className="shift-len">{h}h</span>
              <span className="shift-chips">
                {bucketTours[h].map((t) => (
                  <label
                  className="shift-chip"
                  key={t.key}
                  title={obfuscateName(t.nurseName)}
                >
                    <input
                      type="checkbox"
                      checked={!hiddenTours[t.key]}
                      onChange={() => onToggleTour(t.key)}
                    />
                    <span
                      className="dot"
                      style={{ background: colorByKey[t.key] }}
                    />
                    {t.shortId}
                  </label>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {!isAllView && selectedTour && (
        <div className="section">
          <div className="section-title">Tour detail</div>
          <div className="summary">
            <div className="stat">
              <span>Nurse</span>
              <b>{obfuscateName(selectedTour.nurseName)}</b>
            </div>
            <div className="stat">
              <span>Staff ID</span>
              <b>{selectedTour.staffId || '—'}</b>
            </div>
            <div className="stat">
              <span>Shift</span>
              <b>
                {selectedTour.shiftStart}–{selectedTour.shiftEnd} ·{' '}
                {fmtDuration(selectedTour.shiftDuration)}
              </b>
            </div>
            <div className="stat">
              <span>Visits mapped</span>
              <b>{selectedTour.visits.length}</b>
            </div>
            <div className="stat">
              <span>Map dots (stops)</span>
              <b>{countStops(selectedTour.visits)}</b>
            </div>
            <div className="stat">
              <span>Service / Travel / Wait</span>
              <b>
                {selectedTour.servicePct}% / {selectedTour.travelPct}% /{' '}
                {selectedTour.waitingPct}%
              </b>
            </div>
            <div className="stat">
              <span>Actual efficiency</span>
              <b>{pct(actualEff(selectedTour))}</b>
            </div>
          </div>
          {selectedTour.unmapped.length > 0 && (
            <div className="flag warn">
              {selectedTour.unmapped.length} visit(s) had no coordinates and
              aren't shown on the map.
            </div>
          )}
        </div>
      )}
    </>
  );
}
