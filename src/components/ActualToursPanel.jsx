import { ALL_TOURS } from '../lib/actualTours';
import { clusterColor } from '../lib/colors';

function fmtDuration(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

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
}) {
  const totalVisits = toursForDate.reduce((s, t) => s + t.visits.length, 0);

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
          <div className="legend">
            {toursForDate.map((t, i) => (
              <div className="legend-item" key={t.key}>
                <span className="swatch" style={{ background: clusterColor(i) }} />
                <span>
                  {t.shortId} · {t.nurseName} ({t.visits.length})
                </span>
              </div>
            ))}
          </div>
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
