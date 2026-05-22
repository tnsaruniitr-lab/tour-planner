function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// "11×8h, 2×7.5h, 2×3h" — a high-level roster: tours grouped into
// half-hour shift-length buckets, longest first.
function rosterSummary(clusters) {
  const byBucket = {};
  for (const c of clusters) {
    const hrs = Math.round(c.shiftLengthMin / 30) / 2; // nearest 0.5h
    byBucket[hrs] = (byBucket[hrs] || 0) + 1;
  }
  return Object.entries(byBucket)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([hrs, n]) => `${n}×${Number(hrs)}h`)
    .join(', ');
}

const pct = (x) => Math.round(x * 100) + '%';

export default function ControlPanel({
  patientCount,
  sourceLabel,
  onUpload,
  onLoadSample,
  onLoadSaved,
  onClearSaved,
  hasSavedUpload,
  mode,
  onModeChange,
  capacityMode,
  onCapacityModeChange,
  form,
  onField,
  roster,
  updateRoster,
  addRosterRow,
  removeRosterRow,
  onGo,
  running,
  statusMsg,
  statusErr,
  plan,
  activeDayPlan,
}) {
  const clusters = activeDayPlan?.clusters || [];
  const unassigned = activeDayPlan?.unassigned || [];
  const metrics = activeDayPlan?.metrics || null;
  const shortfallMin = activeDayPlan?.shortfallMin || 0;
  const anyOverflow = clusters.some((c) => c.overflow);
  const estimated = clusters.some((c) => c.roadTimes === false);
  const infeasible = plan?.infeasible || [];
  const placed = clusters.reduce((s, c) => s + c.patientCount, 0);

  return (
    <>
      <h1>Outpatient Touring</h1>
      <p className="sub">Cluster patient visits into clean geographic tours.</p>

      <div className="section">
        <div className="section-title">Patients</div>
        <div className="upload-row">
          <label className="btn btn-file">
            Upload file
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              hidden
              onChange={(e) => {
                if (e.target.files[0]) onUpload(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
          {hasSavedUpload && (
            <button className="btn" onClick={onLoadSaved}>
              Load saved
            </button>
          )}
          <button className="btn" onClick={onLoadSample}>
            Load sample
          </button>
        </div>
        <p className="note">
          {patientCount
            ? `${patientCount} patients loaded — ${sourceLabel}`
            : 'CSV or Excel (.xlsx) — columns: name, address, service_time, days_per_week, visits_per_day, lat, lng'}
        </p>
        {hasSavedUpload && (
          <p className="note">
            Your last upload is saved in this browser and reloads
            automatically.{' '}
            <button className="link-btn" onClick={onClearSaved}>
              Clear saved
            </button>
          </p>
        )}
      </div>

      <div className="section">
        <div className="section-title">Planning mode</div>
        <div className="mode-toggle">
          <button
            className={mode === 'daily' ? 'active' : ''}
            onClick={() => onModeChange('daily')}
          >
            Daily
          </button>
          <button
            className={mode === 'weekly' ? 'active' : ''}
            onClick={() => onModeChange('weekly')}
          >
            Weekly
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Nurse shifts</div>
        <div className="mode-toggle">
          <button
            className={capacityMode === 'auto' ? 'active' : ''}
            onClick={() => onCapacityModeChange('auto')}
          >
            Auto
          </button>
          <button
            className={capacityMode === 'uniform' ? 'active' : ''}
            onClick={() => onCapacityModeChange('uniform')}
          >
            Uniform
          </button>
          <button
            className={capacityMode === 'roster' ? 'active' : ''}
            onClick={() => onCapacityModeChange('roster')}
          >
            Roster
          </button>
        </div>

        {capacityMode === 'auto' ? (
          <>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Max shift length (h)</label>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={form.maxShiftHours}
                  onChange={(e) => onField('maxShiftHours', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Target utilisation (%)</label>
                <input
                  type="number"
                  min="40"
                  max="95"
                  step="5"
                  value={form.targetUtil}
                  onChange={(e) => onField('targetUtil', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label>Shift start</label>
              <input
                type="time"
                value={form.shiftStart}
                onChange={(e) => onField('shiftStart', e.target.value)}
              />
            </div>
          </>
        ) : capacityMode === 'uniform' ? (
          <>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Shift start</label>
                <input
                  type="time"
                  value={form.shiftStart}
                  onChange={(e) => onField('shiftStart', e.target.value)}
                />
              </div>
              <div className="field">
                <label>Shift end</label>
                <input
                  type="time"
                  value={form.shiftEnd}
                  onChange={(e) => onField('shiftEnd', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label>Number of nurses</label>
              <input
                type="number"
                min="1"
                value={form.nurses}
                onChange={(e) => onField('nurses', e.target.value)}
              />
            </div>
          </>
        ) : (
          <div className="roster">
            <div className="roster-head">
              <span>Nurses</span>
              <span>Hours</span>
              <span>Start</span>
              <span />
            </div>
            {roster.map((row, i) => (
              <div className="roster-row" key={i}>
                <input
                  type="number"
                  min="1"
                  value={row.count}
                  onChange={(e) => updateRoster(i, 'count', e.target.value)}
                />
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={row.hours}
                  onChange={(e) => updateRoster(i, 'hours', e.target.value)}
                />
                <input
                  type="time"
                  value={row.start}
                  onChange={(e) => updateRoster(i, 'start', e.target.value)}
                />
                <button
                  className="rm"
                  onClick={() => removeRosterRow(i)}
                  title="Remove shift"
                >
                  ×
                </button>
              </div>
            ))}
            <button className="add-row" onClick={addRosterRow}>
              + Add shift
            </button>
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <div className="field">
            <label>Min gap (hours)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={form.gapHours}
              onChange={(e) => onField('gapHours', e.target.value)}
            />
          </div>
          <div className="field">
            <label>Traffic buffer (%)</label>
            <input
              type="number"
              min="0"
              step="5"
              value={form.bufferPct}
              onChange={(e) => onField('bufferPct', e.target.value)}
            />
          </div>
        </div>
        <p className="note">
          {capacityMode === 'auto'
            ? 'The tool picks how many nurses each day and how long each shift runs, to cover every visit at the target utilisation.'
            : 'Tours are sized to fit each shift; work is spread across every rostered nurse.'}
        </p>
      </div>

      <div className="section">
        <button
          className="btn-go"
          onClick={onGo}
          disabled={running || !patientCount}
        >
          {running ? 'Working…' : 'GO'}
        </button>
        {statusMsg && (
          <div className={'status' + (statusErr ? ' err' : '')}>{statusMsg}</div>
        )}
      </div>

      {plan && (
        <div className="section">
          <div className="section-title">
            Tours{mode === 'weekly' ? ' — selected day' : ''}
          </div>
          <div className="summary">
            <div className="stat">
              <span>Tours</span>
              <b>{clusters.length}</b>
            </div>
            <div className="stat">
              <span>Patients placed</span>
              <b>{placed}</b>
            </div>
            {clusters.length > 0 && (
              <div className="stat">
                <span>Shift plan</span>
                <b>{rosterSummary(clusters)}</b>
              </div>
            )}
          </div>

          {clusters.length > 0 && (
            <div className="legend">
              {clusters.map((c, i) => (
                <div className="legend-item" key={c.id}>
                  <span className="swatch" style={{ background: c.color }} />
                  <span>
                    Tour {i + 1} · {c.shiftLabel} — {c.stops.length} stops ·{' '}
                    {pct(c.utilisation)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {estimated && (
            <div className="flag warn">
              OSRM unavailable — travel times are straight-line estimates.
            </div>
          )}
          {shortfallMin > 0 && (
            <div className="flag danger">
              Roster capacity short by ~{fmtDuration(shortfallMin)} of work —
              add nurses or longer shifts.
            </div>
          )}
          {anyOverflow && (
            <div className="flag warn">
              Some tours run past their shift end — widen those shifts or lower
              the gap.
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="flag danger">
              {unassigned.length} patient(s) need more than a full shift — left
              unassigned.
            </div>
          )}
          {infeasible.length > 0 && (
            <div className="flag danger">
              {infeasible.length} patient(s) need more days than the week has.
            </div>
          )}
        </div>
      )}

      {plan && plan.mode === 'weekly' && (
        <div className="section">
          <div className="section-title">Week shift plan</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Nurses</th>
                <th>Shifts</th>
                <th>Visits</th>
              </tr>
            </thead>
            <tbody>
              {plan.dayOrder.map((d) => {
                const cs = plan.days[d]?.clusters || [];
                const visits = cs.reduce((s, c) => s + c.stops.length, 0);
                return (
                  <tr key={d}>
                    <td>{d}</td>
                    <td>{cs.length}</td>
                    <td>{rosterSummary(cs) || '—'}</td>
                    <td>{visits}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">
            Nurses and shift lengths the tool derived to cover each day.
          </p>
        </div>
      )}

      {plan && metrics && (
        <div className="section">
          <div className="section-title">
            Day efficiency{mode === 'weekly' ? ' — selected day' : ''}
          </div>
          <div className="metrics">
            <div className="metric">
              <span>Nurses used</span>
              <b>{metrics.nurses}</b>
            </div>
            <div className="metric">
              <span>Patients</span>
              <b>{metrics.patients}</b>
            </div>
            <div className="metric">
              <span>Care time</span>
              <b>{fmtDuration(metrics.serviceMin)}</b>
            </div>
            <div className="metric">
              <span>Travel time</span>
              <b>{fmtDuration(metrics.travelMin)}</b>
            </div>
            <div className="metric">
              <span>Paid hours</span>
              <b>{fmtDuration(metrics.paidMin)}</b>
            </div>
            <div className="metric">
              <span>Working time</span>
              <b>{fmtDuration(metrics.workingMin)}</b>
            </div>
            <div className="metric">
              <span>Utilisation</span>
              <b>{pct(metrics.utilisation)}</b>
            </div>
            <div className="metric">
              <span>Care efficiency</span>
              <b>{pct(metrics.careEfficiency)}</b>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
