import { useState } from 'react';
import { ALL_TOURS } from '../lib/actualTours';
import { clusterColor } from '../lib/colors';
import { hhmmToMin } from '../lib/schedule';

function fmtDuration(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');

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
}) {
  const [effType, setEffType] = useState('actual');
  const totalVisits = toursForDate.reduce((s, t) => s + t.visits.length, 0);

  // Morning/Evening classification by shift start vs. the cutoff.
  const cutoff = hhmmToMin(amPmCutoff);
  const decorated = toursForDate.map((t, i) => ({
    t,
    i,
    evening: hhmmToMin(t.shiftStart) >= cutoff,
  }));
  const morning = decorated.filter((d) => !d.evening);
  const evening = decorated.filter((d) => d.evening);

  // Two efficiency definitions (no rounding in the maths):
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
        {t.shortId} · {t.nurseName} ({t.visits.length})
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
            Upload CSV(s)
            <input
              type="file"
              accept=".csv"
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
            Upload one or more actual-tours CSV files. Loaded tours are saved in
            this browser, so they reload automatically next time.
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
                  {t.shortId} · {t.nurseName} ({t.visits.length})
                </option>
              ))}
            </select>
          </div>
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
                  <label className="shift-chip" key={t.key} title={t.nurseName}>
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
              <b>{selectedTour.nurseName}</b>
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
