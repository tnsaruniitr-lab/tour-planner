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
  amPmCutoff,
  onCutoffChange,
  tourTravel,
  onComputeEfficiency,
  effComputing,
}) {
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

  // Efficiency = service / (service + travel). Travel = OSRM x1.5. No rounding.
  const travelOf = (t) => tourTravel[t.key];
  const effOf = (t) => {
    const tr = travelOf(t);
    if (tr == null) return null;
    const svc = t.serviceTimeMin || 0;
    return svc + tr > 0 ? svc / (svc + tr) : 0;
  };
  const groupEff = (list) => {
    let svc = 0;
    let tot = 0;
    for (const { t } of list) {
      const tr = travelOf(t);
      if (tr == null) continue;
      svc += t.serviceTimeMin || 0;
      tot += (t.serviceTimeMin || 0) + tr;
    }
    return tot > 0 ? svc / tot : null;
  };
  const haveTravel = toursForDate.some((t) => travelOf(t) != null);
  const allComputed =
    toursForDate.length > 0 && toursForDate.every((t) => travelOf(t) != null);

  // Shift-length distribution — shift hours rounded UP to the next whole hour.
  const buckets = {};
  for (const t of toursForDate) {
    const h = Math.ceil((t.shiftDuration || 0) / 60);
    buckets[h] = (buckets[h] || 0) + 1;
  }
  const bucketHours = Object.keys(buckets)
    .map(Number)
    .sort((a, b) => b - a);

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

          <div className="tour-group-title">Morning ({morning.length})</div>
          <div className="legend">{morning.map(renderRow)}</div>

          <div className="tour-group-title">Evening ({evening.length})</div>
          <div className="legend">{evening.map(renderRow)}</div>
        </div>
      )}

      {isAllView && toursForDate.length > 0 && (
        <div className="section">
          <div className="section-title">Efficiency &amp; shifts</div>

          {!allComputed && (
            <button
              className="btn btn-block"
              onClick={onComputeEfficiency}
              disabled={effComputing}
            >
              {effComputing
                ? 'Computing road travel…'
                : 'Calculate efficiency (OSRM)'}
            </button>
          )}

          {haveTravel && (
            <>
              <div className="summary" style={{ marginTop: 8 }}>
                <div className="stat">
                  <span>Morning efficiency</span>
                  <b>{pct(groupEff(morning))}</b>
                </div>
                <div className="stat">
                  <span>Evening efficiency</span>
                  <b>{pct(groupEff(evening))}</b>
                </div>
              </div>
              <p className="note">
                Efficiency = service ÷ (service + travel). Travel = OSRM road
                time × 1.5 for traffic.
              </p>
              <details className="collapsible">
                <summary>Efficiency by tour</summary>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tour</th>
                      <th>Service</th>
                      <th>Travel</th>
                      <th>Eff.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toursForDate.map((t) => (
                      <tr key={t.key}>
                        <td>{t.shortId}</td>
                        <td>{fmtDuration(t.serviceTimeMin)}</td>
                        <td>{fmtDuration(travelOf(t))}</td>
                        <td>{pct(effOf(t))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}

          <div className="tour-group-title">Shift length distribution</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Shift length</th>
                <th>Shifts</th>
              </tr>
            </thead>
            <tbody>
              {bucketHours.map((h) => (
                <tr key={h}>
                  <td>{h}h</td>
                  <td>{buckets[h]}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
