# Outpatient Touring — Product & Handoff Doc

> **Read this first.** It is the single source of truth for the project: what it
> is, how it's built, every algorithm, every design decision, and the full
> history. A new contributor (or a fresh AI context window) should be able to
> read this top-to-bottom and continue confidently.

---

## 1. What this is

A browser app for **outpatient / home-healthcare agencies** to plan and
analyse nurse tours. Two modes, switched by the toggle at the top-left:

- **Plan** — upload patient visits; the app clusters them into clean, circular
  geographic tours, routes each tour, schedules visit times, and reports
  efficiency metrics.
- **Actual tours** — upload real *completed* tour CSVs (the agency's historical
  data), visualise each nurse's actual route, score efficiency, and
  **re-assemble** the day into optimised circular tours for comparison.

Fully client-side. No backend, no database. State persists in browser
localStorage.

---

## 2. Quick start

```
cd touring-app
npm install
npm run dev        # → http://localhost:5173
```

Node 18+. Build: `npm run build`.

---

## 3. Tech stack

- **React 18 + Vite 5** — UI and dev server
- **Leaflet + react-leaflet** — maps, CartoDB Positron (minimal) basemap
- **Papaparse** — CSV parsing
- **SheetJS (`xlsx`)** — reads `.xlsx` / `.xls` uploads (converted to CSV)
- **OSRM** public Table service (`router.project-osrm.org`) — road travel times
- **OSM Nominatim** — geocoding addresses that lack lat/lng
- Persistence: **browser localStorage**

---

## 4. File map

```
touring-app/
  index.html, vite.config.js, package.json
  public/
    sample-tours.csv           bundled actual-tour data (3 days, ~390 visits)
    sample-patients.csv        bundled planner dataset (82 patients, ~605 visits/wk)
  src/
    main.jsx                   entry
    App.jsx                    ALL top-level state, mode switching, both pipelines
    index.css                  all styling
    components/
      ControlPanel.jsx         Plan-mode left panel
      ActualToursPanel.jsx     Actual-tours left panel (visualise + re-assemble)
      MapView.jsx              Leaflet map — shared; props: dayPlan, showZones, scrollZoom
    lib/
      geo.js                   lat/lng projection, haversine, coverage radius
      csv.js                   patient CSV parser
      workbook.js              file reader — .csv / .xlsx / .xls → CSV text
      cluster.js               capacitated k-means (heterogeneous caps, slack)
      route.js                 nearest-neighbour + 2-opt ordering
      schedule.js              tour time-simulation, 3h-gap reconnector, hh:mm utils
      osrm.js                  OSRM travel-time matrix + straight-line fallback
      days.js                  weekly day-distribution (LPT load balancing)
      colors.js                categorical colour palette
      pipeline.js              Plan-mode orchestration (cluster → route → schedule)
      actualTours.js           actual-tours CSV parser + tour model
      tourStore.js             localStorage persistence for actual tours
      patientStore.js          localStorage persistence for the planner upload
      reassemble.js            re-plan actual visits into circular tours
```

---

## 5. The two modes in detail

### Plan mode (`ControlPanel.jsx`, `pipeline.js`)

Flow: upload patients (or "Load sample") → set shifts → **GO** → geocode →
cluster → route → schedule → render.

- "Load sample" loads the **bundled weekly dataset** —
  `public/sample-patients.csv`, 82 patients ≈ 605 visits/week — and the app
  opens with it automatically on a first visit.
- Any file you upload is also **persisted to localStorage** (`patientStore.js`)
  and auto-restored on reload; a "Load saved" button reloads it on demand,
  "Clear saved" forgets it.

- **Capacity modes:**
  - *Auto* — you give a max shift length and a **target utilisation**; the
    tool sizes the nurse count and each shift to hit that utilisation,
    leaving the rest as shift buffer. Lower the % for more buffer (and
    rounder zones), 100% for none. Outputs a realistic, varied roster per
    day. This is the default.
  - *Uniform* — one shift window + a fixed nurse count.
  - *Roster* — a table of `nurses × hours × start time`; tours sized to each
    shift.
- **Adjust shifts** — after a plan is built, the selected day's roster is
  shown as an editable `hours × count` table. Edit it (a net-change meter
  tracks the delta vs the auto plan; aim for 0 to redistribute without
  changing total capacity) and "Replan" re-runs just that day.
- **Weekly** runs a 7-day operating week. Day choice is *weekday-preferred*:
  patients needing ≤5 days/week land on Mon–Fri only; 6-day patients also get
  Saturday; 7-day patients get the whole week. So Sat/Sun only ever carry the
  6- and 7-day patients.
- Clustering groups patients into circular zones capped by shift capacity;
  more clusters are auto-added if a tour would exceed its cap.
- Multi-visit patients get repeat visits ≥3h apart as real return legs.
- Metrics: per-tour utilisation; per-day care/travel/working time, utilisation,
  care efficiency. Weekly mode also shows a **Week shift plan** table
  (nurses + shift mix + visits per day).

### Actual tours mode (`ActualToursPanel.jsx`, `actualTours.js`, `reassemble.js`)

Flow: **Upload CSV(s)** or **Load saved** → pick date → pick tour → map.

- Rows grouped by `dateOfService` + `tourId`; visits sorted by sequence.
- **Date** dropdown → **tour/nurse** dropdown; first entry **★ All tours**
  (every tour, colour-coded, with per-tour and Morning/Evening checkboxes).
- Visits with no coordinates are excluded and flagged.
- **Persistence:** uploaded data + selection saved to localStorage, auto-restored.
- **Efficiency & shifts:** OSRM vs Actual efficiency (per group + per-tour
  toggle); shift-length distribution with selectable tour-ID chips.
- **Re-assemble into circular tours:** re-plans the selected day's visits
  through the planner. Runs **all three staffing modes at once**
  (same-as-file / uniform / fewest-nurses). Morning and evening pools are
  planned separately and never mixed; a patient with visits in both periods
  is kept split; repeat visits in a period stay with one nurse ≥ the gap
  apart; start times are not pinned. Output: a **comparison table**
  (Actual vs the 3 modes — efficiency, travel %, tours; with a
  Morning/Evening/Both selector) and **a map per mode stacked below** the
  actual map. The Morning/Evening checkboxes hide that period on every map.

---

## 6. Data formats

Both uploads accept **CSV or Excel (`.xlsx` / `.xls`)** — a spreadsheet's
first sheet is read and converted to CSV (`workbook.js`), so the columns are
identical either way. Headers are case-insensitive and spaces count as
underscores (`Service Time` = `service_time`).

**Planner patient CSV / Excel** (`sample-patients.csv`):
`name, address, service_time, days_per_week, visits_per_day, lat, lng`
(`lat`/`lng` optional — geocoded via Nominatim if absent.)

**Actual-tours CSV** (`public/sample-tours.csv`): 25 columns, one row per visit —
`tourId, nurseName, staffId, visitSequence, visitId, patientName, locationId,
patientAddress, latitude, longitude, shiftStart, shiftEnd, shiftDuration,
visitTime, estimatedArrival, patientWindowStart, patientWindowEnd,
visitDurationMin, travelTimeMin, waitingTimeMin, serviceTimeMin, servicePct,
travelPct, waitingPct, dateOfService`. Rows may be unsorted; the parser
groups and sorts them. `travelTimeMin`/`waitingTimeMin`/`serviceTimeMin` are
tour totals.

---

## 7. Algorithms (how it actually works)

1. **Geocoding** (`geocode.js`) — addresses without lat/lng geocoded via OSM
   Nominatim, sequentially at ~1 req/sec, cached in localStorage by address.

2. **Coordinate projection** (`geo.js`) — lat/lng → planar km grid
   (equirectangular: longitude scaled by cos(mean latitude)). Clustering runs
   in this planar space so zones render as true circles, not latitude-
   stretched ellipses.

3. **Capacitated k-means clustering** (`cluster.js`) — the core territory
   algorithm:
   - *k-means++ seeding* — initial centroids spread out (distance-weighted).
   - *Regret-based capacitated assignment* — each point's regret = gap between
     its nearest and second-nearest centroid; points placed highest-regret
     first into the nearest centroid with remaining capacity.
   - *Lloyd iteration* — recompute centroids (mean of members), reassign.
   - *Capacity-aware local-search refine* — move a point to a nearer centroid
     with room; swap two points between clusters when it cuts total squared
     distance. Removes long "spike" outliers.
   - *Heterogeneous per-cluster capacities* — each centroid can have its own
     cap (the roster: varied shift lengths).
   - *Cap slack* — clusters may run slightly over capacity (a slack multiplier)
     so boundary points stay with their nearest centroid → rounder zones.
   - *Multi-restart* — several seeds; keep the lowest within-cluster squared
     distance.

4. **Route ordering** (`route.js`) — within a cluster: nearest-neighbour seed
   then 2-opt to convergence. A 2-opt-optimal Euclidean open path has no
   self-crossings, so routes look clean.

5. **Scheduling & multi-visit reconnector** (`schedule.js`) — `simulateTour`
   walks the route assigning clock times; a patient's repeat same-day visit
   becomes its own stop, woven back once the gap (≥3h) has elapsed — a real
   return leg, its travel counted.

6. **Travel times** (`osrm.js`) — driving-time matrix from OSRM's Table
   service, inflated ×(1 + buffer%) for traffic; straight-line fallback
   (haversine ÷ speed × buffer). Clustering stays straight-line; OSRM only
   affects scheduling and metrics.

7. **Weekly day-distribution** (`days.js`) — greedy longest-processing-time
   (LPT) bin-packing over a 7-day operating week: most-constrained patients
   first, each to its lightest *eligible* days, balancing daily workload.
   Eligible days are weekday-preferred — a patient is only placed on Saturday
   if it needs 6 days, on Sunday only if it needs 7 — so weekends carry only
   the spill-over.

8. **Roster bin-packing** (`pipeline.js`) — a roster of shifts (each a
   capacity); clusters with heterogeneous caps; heaviest zone matched to
   longest shift (sorted-to-sorted, feasibility-preserving).

8a. **Auto roster** (`pipeline.js`, `autoShifts` + `fitShiftToCluster`) —
   when no roster is given, the planner derives one per day. *Step 1:* the
   nurse count `n = ceil(totalServiceLoad / (maxShift × targetUtil ×
   SERVICE_SHARE))` — the target utilisation sets how much spare capacity
   (the buffer) to leave; that spare also gives the clustering room for
   rounder zones. *Step 2:* cluster into `n` zones, then size each tour's
   shift to its workload padded to the target utilisation — but never below
   the tour's actual span — floored at 3h, capped at the max. The roster is
   then editable per day (`planDay` is exported so one day can be re-run).

9. **Re-assembly** (`reassemble.js`) — actual visits split into morning/evening
   pools (shift-start vs an AM/PM cutoff), each pool → planner-patients →
   roster per staffing mode → full planner run. Pools never mix.

10. **Efficiency** — OSRM efficiency = service ÷ (service + OSRM travel ×1.5);
    Actual efficiency = service ÷ (service + recorded travel + recorded
    waiting). No rounding in the maths.

---

## 8. Key design decisions (and why)

- **Cluster-first, route-second** — a global VRP optimiser produces messy,
  interleaved territories; the agency wants visually clean circular tours, so
  clustering defines territories first, then each is routed.
- **Projection by cos(latitude)** so circles are true circles.
- **2-opt routing** → non-self-crossing routes.
- **OSRM road times ×(1+buffer%)**; clustering stays straight-line (road-time
  clustering would distort circle shapes).
- **Multi-visit reconnector** — repeat visits are real return legs, ≥3h apart,
  same nurse.
- **Roster** uses heterogeneous capacities; biggest zone → longest shift.
- **Auto mode** answers "what would it take?" — the agency need not know its
  staffing in advance. A **target-utilisation** dial sets the shift buffer:
  it pads shifts for over-runs *and* gives the clustering room to keep zones
  round (less buffer ⇒ fewer, fuller, messier circles). The derived roster
  can then be hand-tuned per day via the Adjust-shifts table.
- **Two efficiency definitions** kept side by side — OSRM (theoretical) and
  Actual (from recorded times, counts real waiting).
- **Cap slack + tight circle radius** — perfectly circular, non-overlapping,
  capacity-respecting territories are mathematically impossible for real point
  clouds; the realistic target is "compact and roughly round," so the
  clustering is given slack and circles are drawn at a tight percentile.
- **localStorage persistence** so a working dataset survives reloads.

---

## 9. Current status

Both modes fully working and verified against the agency's real Berlin data
(3 days, ~390 visits, 25 tours/day). Re-assembly runs all 3 staffing modes and
shows 4 stacked maps + a comparison table.

## 10. Known limitations

- Nominatim geocoding is rate-limited (~1 req/sec) — large un-geocoded uploads
  are slow.
- OSRM public server is rate-limited; heavy runs may fall back to straight-line
  (flagged). Running all 3 re-assembly modes takes ~1 minute.
- Re-assembly uses each patient's *average* visit duration (total load exact).
- Persistence is browser-local (not a server).

---

## 11. Changelog

Append an entry whenever you change the app, then commit.

- **v0.1** — MVP planner: CSV upload, balanced k-means, 2-opt routing, Leaflet
  map, daily/weekly modes.
- **v0.2** — Clustering quality: regret assignment + capacity-aware refine.
- **v0.3** — OSRM travel times, multi-visit 3h-gap reconnector, per-tour
  utilisation, per-day efficiency panel.
- **v0.4** — Roster mode: heterogeneous shift capacities, per-shift starts.
- **v0.5** — Actual-tours visualiser: new mode, multi-file upload, date + tour
  dropdowns, All-tours view, straight-line routes, unmapped-visit flag.
- **v0.6** — localStorage persistence, bundled `sample-tours.csv` + "Load
  saved", "Clear saved data".
- **v0.7** — Per-tour visibility checkboxes; Morning/Evening grouping by a
  configurable cutoff.
- **v0.8** — Actual-tours efficiency: per-tour OSRM travel ×1.5, aggregate
  efficiency, collapsible per-tour table, shift-length distribution.
- **v0.9** — Select-all / unselect-all master checkbox per group.
- **v0.10** — Interactive shift-length distribution (tour-ID chips).
- **v0.11** — Two efficiency definitions side by side (OSRM + Actual) with a
  per-tour toggle.
- **v0.12** — "Re-assemble into circular tours": re-plan actual visits via the
  planner; morning/evening pools; 3 staffing modes; second comparison map.
- **v0.13** — Re-assembly runs all 3 modes together with an Actual-vs-3-modes
  comparison table (Morning/Evening/Both selector); compactness cap-slack +
  tighter circle rendering; Morning/Evening visibility governs every map;
  full-height, scrollable map stack (wheel scrolls instead of zooming when
  comparing).
- **v0.14** — Auto-plan capacity mode (now the default): the tool derives the
  nurse count and a realistic varied roster per day from a max shift length +
  target utilisation, with each shift trimmed to its tour's workload. Weekly
  mode extended to a 7-day operating week with weekday-preferred day
  assignment (Sat/Sun carry only 6- and 7-day patients). New "Week shift plan"
  table summarising nurses + shift mix + visits per day.
- **v0.15** — Excel uploads: both the planner and actual-tours uploads now
  accept `.xlsx` / `.xls` as well as `.csv` (`workbook.js`, via SheetJS).
  Headers are tolerant of spaces and a few alternate spellings.
- **v0.16** — The planner upload is persisted to localStorage
  (`patientStore.js`): the last file is auto-restored on reload, with
  "Load saved" / "Clear saved" controls alongside "Load sample".
- **v0.17** — The built-in planner sample is now a realistic weekly dataset
  (`public/sample-patients.csv`, 82 patients ≈ 605 visits/week, replacing the
  small hard-coded London set). "Load sample" loads it and the app opens with
  it on a first visit, so the full dataset is always available.
- **v0.18** — Auto mode no longer adds an idle buffer: it uses the fewest
  nurses that fit and sizes each shift to its tour's care + travel span. The
  "Target utilisation" input is gone; the Day efficiency panel drops "Paid
  hours" and "Utilisation" (there is no paid-vs-working gap) and the per-tour
  legend drops its utilisation %.
- **v0.19** — The buffer returns as an editable **Target utilisation** dial
  (default 88%) — it pads shifts *and* gives the clustering room for rounder
  zones. New per-day **Adjust shifts** table: edit the roster's hours×count,
  watch a net-change meter, and "Replan" re-runs just that day. Day
  efficiency shows Paid hours, Shift buffer and Utilisation again.

---

## 12. Backlog / possible next steps

- Per-day *defined* roster for weekly mode ("Mode B" — the user supplies the
  shifts for each day and the tool fits patients into them; the current Auto
  mode is "Mode A").
- Geography-aware day assignment — pick each patient's days so a weekday's
  set is geographically compact, not just balanced in hours (would cut
  travel for datasets with many part-week patients).
- Even-spacing for multi-day patients in weekly mode (Mon/Wed/Fri).
- Actual-vs-planned overlay on one map.
- Self-hosted / keyed geocoding + routing for scale.
- Optional backend so plans persist server-side and are shareable.
- Per-visit (not averaged) service durations in re-assembly.

---

## 13. For a new contributor / context window

1. Read this file top to bottom.
2. `cd touring-app && npm install && npm run dev`.
3. All state lives in `src/App.jsx`; panels and `MapView` are presentational;
   algorithms are in `src/lib/`.
4. When you change the app, add a Changelog entry (section 11) and commit.
