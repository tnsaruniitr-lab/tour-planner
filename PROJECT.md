# Outpatient Touring — Project Handoff

> Hand this file to a new chat to continue work without losing context.
> It describes what the app is, how it's built, every design decision, and the
> current status. Read this first, then the file map in section 4.

---

## 1. What this is

A browser app for **outpatient / home-healthcare agencies** to plan and
visualise nurse tours. It has **two modes**, switched by the toggle at the top
of the left panel:

- **Plan** — upload a list of patient visits; the app clusters them into clean,
  circular geographic tours, routes each tour, schedules visit times, and shows
  efficiency metrics.
- **Actual tours** — upload real *completed* tour CSVs (the agency's historical
  data) and visualise each nurse's actual route on the map.

Fully client-side. No backend, no database. Runs locally.

---

## 2. Quick start

```
cd touring-app
npm install
npm run dev
```

Open http://localhost:5173 . Requires Node 18+.

---

## 3. Tech stack

- **React 18 + Vite 5** — UI and dev server
- **Leaflet + react-leaflet** — map, with the CartoDB Positron (minimal) basemap
- **Papaparse** — CSV parsing
- **OSRM** public server (`router.project-osrm.org`) — road travel-time matrix
- **OSM Nominatim** — geocoding addresses that lack lat/lng
- Persistence: **browser localStorage** (no server)

---

## 4. File map

```
touring-app/
  index.html, vite.config.js, package.json
  public/
    sample-tours.csv      bundled actual-tour data (3 days, ~390 visits)
  sample-patients.csv     example planner-upload format
  src/
    main.jsx              entry
    App.jsx               ALL top-level state, mode switching, both pipelines
    index.css             all styling
    components/
      ControlPanel.jsx    Plan-mode left panel
      ActualToursPanel.jsx Actual-tours left panel
      MapView.jsx         Leaflet map (shared by both modes; showZones prop)
    lib/
      geo.js              lat/lng projection, haversine, coverage radius
      csv.js              patient CSV parser
      cluster.js          capacitated k-means (per-cluster capacities)
      route.js            nearest-neighbour + 2-opt ordering
      schedule.js         tour time-simulation, 3h-gap reconnector, hh:mm utils
      osrm.js             OSRM travel-time matrix + straight-line fallback
      days.js             weekly day-distribution (load balancing)
      colors.js           categorical colour palette
      pipeline.js         Plan-mode orchestration (cluster→route→schedule)
      actualTours.js      actual-tours CSV parser + tour model + map conversion
      tourStore.js        localStorage persistence for actual tours
      sampleData.js       built-in planner sample dataset (London)
```

---

## 5. The two modes in detail

### Plan mode (`ControlPanel.jsx`, `pipeline.js`)

Flow: upload patients (or "Load sample") → set shifts → **GO** → geocode →
cluster → route → schedule → render.

- **Capacity modes:**
  - *Uniform* — one shift window + a nurse count; all tours the same length.
  - *Roster* — a table of `nurses × hours × start time` rows; tours are sized to
    fit each specific shift.
- **Clustering** groups patients into geographic zones, each capped by a shift's
  capacity. More clusters are auto-added if a tour would exceed its cap.
- **Routing** orders each cluster with nearest-neighbour + 2-opt.
- **Scheduling** assigns clock times; a patient with multiple same-day visits
  gets repeat visits ≥ 3h apart, modelled as real return legs ("reconnector").
- **Metrics** — per-tour utilisation; per-day care/travel/working time,
  utilisation, care efficiency.

### Actual tours mode (`ActualToursPanel.jsx`, `actualTours.js`)

Flow: **Upload CSV(s)** or **Load saved** → pick date → pick tour → map shows it.

- Rows are grouped by `dateOfService` + `tourId`; visits sorted by sequence.
- **Date dropdown** then **tour/nurse dropdown**. First entry is **★ All tours**
  (every tour for that date, colour-coded at once).
- Shows only the selected tour (numbered markers in visit order, straight
  connectors) or all tours together.
- Visits with no coordinates are excluded from the map and flagged.
- **Persistence:** uploaded data is saved to localStorage and auto-restored on
  reload. "Clear saved data" wipes it. "Load saved" loads the bundled
  `public/sample-tours.csv`.

---

## 6. Data formats

**Planner patient CSV** (`sample-patients.csv`):
`name, address, service_time, days_per_week, visits_per_day, lat, lng`
(`lat`/`lng` optional — if absent the row is geocoded via Nominatim.)

**Actual-tours CSV** (`public/sample-tours.csv`): 25 columns, one row per visit —
`tourId, nurseName, staffId, visitSequence, visitId, patientName, locationId,
patientAddress, latitude, longitude, shiftStart, shiftEnd, shiftDuration,
visitTime, estimatedArrival, patientWindowStart, patientWindowEnd,
visitDurationMin, travelTimeMin, waitingTimeMin, serviceTimeMin, servicePct,
travelPct, waitingPct, dateOfService`. Rows may be unsorted; the parser groups
and sorts them.

---

## 7. Key design decisions (and why)

1. **Cluster-first, route-second.** A global VRP optimiser produces interleaved,
   messy territories. The agency prioritised *visually clean, circular* tours, so
   clustering defines territories first, then each is routed.
2. **Capacitated k-means** with **regret-based assignment** + a **local-search
   refine** step — plain k-means produced a cluster straddling two
   neighbourhoods. Regret + refine removes those long "spike" outliers.
3. **Coordinate projection** scales longitude by cos(latitude) so clusters render
   as true circles, not latitude-stretched ellipses.
4. **2-opt routing** — a 2-opt-optimal Euclidean path has no self-crossings, so
   routes look tidy.
5. **OSRM road travel times**, inflated by a configurable **traffic buffer %**
   (default 35) for traffic/parking. Clustering deliberately stays straight-line
   (road-time clustering would distort circle shapes). Falls back to
   straight-line if OSRM is unreachable.
6. **Multi-visit reconnector** — a patient's repeat same-day visit is its own
   stop at the same address, woven back into the route once the 3h gap elapses;
   its return travel is counted. (User chose "real return leg, counted".)
7. **Roster mode** uses **heterogeneous capacities** in the clustering; the
   heaviest zone is matched to the longest shift. Work is spread across **all**
   rostered nurses (user's choice), and each shift can have its **own start
   time**.
8. **Actual-tours visualiser** shows **one tour at a time** by default, plus an
   **All tours** option; routes drawn with **straight lines** (user's choices).
9. **localStorage persistence** so a tour being worked on survives reloads
   without re-uploading.

---

## 8. Current status — works and verified

- Plan mode: daily + weekly, uniform + roster shifts, OSRM times, multi-visit
  reconnector, per-tour + per-day metrics.
- Actual tours mode: multi-file upload, "Load saved", date + tour dropdowns,
  single-tour and All-tours views, unmapped-visit flagging, localStorage
  persistence + "Clear saved data".
- Verified against the agency's real `2025-10-10` file: 25 tours, 141 visits.

---

## 9. Known limitations / simplifications

- Planner geocoding uses Nominatim at ~1 request/second (rate-limited); large
  uploads without lat/lng are slow. Results are cached.
- OSRM public server is rate-limited; heavy weekly runs may fall back to
  straight-line for some tours (flagged in the panel).
- The planner's built-in sample is single-visit; multi-visit works on uploaded
  CSVs and via the reconnector engine.
- Persistence is browser-local (not a file or server) — it lives in whatever
  browser/profile you use.
- The actual-tours visualiser is read-only — it displays recorded tours, it does
  not re-optimise them.

---

## 10. Changelog

Append a new entry whenever you change the app, then commit.

- **v0.1** — MVP planner: patient CSV upload, balanced k-means clustering, 2-opt
  routing, Leaflet map, daily/weekly modes.
- **v0.2** — Clustering quality: regret-based assignment + capacity-aware
  local-search refine; lighter sample data.
- **v0.3** — OSRM road travel times (×traffic buffer), multi-visit 3h-gap
  reconnector, per-tour utilisation, per-day efficiency panel.
- **v0.4** — Roster mode: heterogeneous shift capacities, per-shift start times,
  biggest-zone-to-longest-shift matching; Uniform/Roster toggle.
- **v0.5** — Actual-tours visualiser: new "Actual tours" mode, multi-file
  upload, date + tour dropdowns, "All tours" view, straight-line routes,
  unmapped-visit flag.
- **v0.6** — localStorage persistence for actual tours, bundled
  `public/sample-tours.csv` + "Load saved" button, "Clear saved data".
- **v0.7** — Actual-tours All-tours view: per-tour visibility checkboxes
  (toggle a tour on/off the map), legend split into Morning / Evening groups
  by a configurable shift-start cutoff.
- **v0.8** — Actual-tours efficiency: per-tour road travel via OSRM ×1.5
  (traffic), Morning/Evening aggregate efficiency = service ÷ (service +
  travel), collapsible per-tour efficiency table, shift-length distribution
  table (shift hours rounded up to the next whole hour; efficiency itself
  is never rounded). Computed travel is cached in localStorage.
- **v0.9** — Actual-tours: select-all / unselect-all master checkbox in each
  of the Morning and Evening group headers (with an indeterminate state when
  a group is partially selected).
- **v0.10** — Shift-length distribution made interactive: each shift-length
  row lists its tours as colour-dotted ID checkboxes (default all on) with a
  "Select all" master; toggling them shows/hides routes on the map. Shares
  visibility state with the Morning/Evening checkboxes.
- **v0.11** — Actual-tours efficiency now shows **two** definitions side by
  side: **OSRM** = service ÷ (service + OSRM travel ×1.5), and **Actual** =
  service ÷ (service + recorded travel + recorded waiting), taken from the
  file's actual visit timeline (so it counts real gap/idle time). The
  Morning/Evening summary table has an OSRM column and an Actual column; the
  per-tour table has an OSRM/Actual toggle.
- **v0.12** — "Re-assemble into circular tours": in Actual-tours mode, re-plan
  the selected day's actual visits through the planner into clean circular
  tours (`lib/reassemble.js`). Morning and evening pools planned separately
  and never mixed; a patient with visits in both periods is kept split;
  repeat visits in a period stay with one nurse ≥ the gap apart; start times
  not pinned. Three staffing modes: same nurses/shifts as the file, uniform
  shifts, or fewest nurses. The result is drawn on a **second map stacked
  below** the actual one for side-by-side comparison.

---

## 11. Backlog / possible next steps

- Planner: actual-vs-planned comparison (overlay a plan on the recorded tours).
- Roster: a "use fewest nurses" option (currently spreads across all).
- Visualiser: per-visit detail list / printable tour sheet.
- Switch geocoding/routing to a self-hosted or keyed provider for scale.
- Optional backend so plans/rosters persist server-side and are shareable.

---

## 12. For a new chat picking this up

1. Read this file top to bottom.
2. `cd touring-app && npm install && npm run dev`.
3. All state lives in `src/App.jsx`; the two panels and `MapView` are
   presentational. Algorithms are in `src/lib/`.
4. When you make a change, add a Changelog entry (section 10) and commit.
