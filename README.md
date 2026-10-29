# JUI Portfolio

Static project dashboards built from VisiLean task data, with the same structure as the TSUK
portfolio. The first project is **JUI**. Each project has its own GitHub Actions workflow that
refreshes it twice a day and publishes it to the `gh-pages` branch:

```
https://<owner>.github.io/<repo>/        landing page, one card per project
https://<owner>.github.io/<repo>/<CODE>/ one page per project code
```

Pure Python 3.12+ standard library. No pip install, no CDN, no chart library. Every page is
one self-contained HTML file with the data embedded, so it works offline and from `file://`.

## Layout

```
Template/               universal logic and templates
  calculation.py        Tables 1-4 and the KPIs (all metric logic lives here)
  dashboard_data.json   task types, unit / subtrade aliases, location delimiter, status groups
  Dashboard.html        project page (VisiLean design system tokens)
  Landing.html          portfolio landing page
  tokens.css            design tokens, light + dark
  scripts/app.js        filters, tables, charts: sums what calculation.py emitted, never re-derives
  assets/               VisiLean logo, embedded as a data URI
<CODE>/project.json     one folder per project (JUI/)
build/                  fetch -> calculate -> inject -> validate; CLI in __main__.py
.github/workflows/      refresh-<CODE>.yml per project, portfolio.yml
.github/scripts/        pages.sh (fetch, credential scan, publish to gh-pages)
data/<CODE>/            Tables 1-4 as CSV (gitignored; a workflow artifact in CI)
dist/                   built site (gitignored; published to gh-pages)
```

## The four tables

Every build writes them to `data/<CODE>/`:

| Table | File | What it holds |
|---|---|---|
| 1 | `table1_raw.csv` | Every feed row as delivered (one row per history event); `customField` expanded to `cf.<name>` columns |
| 2 | `table2_tasks.csv` | `parent` = True removed, `taskType` = Construction only, de-duplicated by `guid` (keeping the latest history event). Adds `subtrade` (`customField.Subtrade`), normalised `unit`, `area`, `subLocation`, `variance` = total − actual |
| 3 | `table3_planned_daily.csv` | One row per task per calendar day from planned start to planned end (both inclusive), `plannedQty` = total quantity ÷ days |
| 4 | `table4_actual_daily.csv` | Complete tasks: actual start to actual end. Started tasks: actual start to today. `actualQty` = actual quantity ÷ days |

Tables 2–4 are also published next to the page (`dist/<CODE>/tables/`, linked in the page
footer), without `emailID`, `description` and `notes`. Table 1 is never published.

`calculation.invariants` stops the build unless Table 3 sums to Table 2's total quantity,
Table 4 matches the page's actual rates, and Table 2 has no duplicate GUIDs.

## S-curve page (second page of the JUI report)

The JUI report has two tabs: **Quantities** (everything below) and **S-curve**, the weightage
S-curve of the JUI-1A master schedule. `JUI/project.json` → `scurve` names the master schedule
(`projectId`, `tokenKey` `JUI-1A`, `extraQuery`); `display.scurve` names its custom fields
(`weightField` `VL-JUI-1A-Weightage`, `groupField` `VL-JUI-1A-S Curve`, `phaseField`
`Construction Phase`). Remove `scurve` and the report is a single page again.

Every build fetches both feeds and writes five more tables to `data/JUI/scurve/` (also published
under `dist/JUI/tables/`):

| File | What it holds |
|---|---|
| `master_tasks.csv` | `parent` = True removed, one row per `guid` (latest history event); area / sub-location split on `_` as for JUI; weightage, % complete, earned weightage (weightage × % complete), baseline / planned / actual dates, S-curve group, construction phase, subtrade, LAP Plan and the join key |
| `baseline_daily.csv` | each weighted task's weightage spread evenly over baseline start..end |
| `planned_daily.csv` | each weighted task's weightage spread evenly over its current planned start..end |
| `actual_daily.csv` | each task's earned weightage spread evenly over actual start..end, or actual start..today while it has no actual end |
| `join_lap_plan.csv` | full outer join of this master table and JUI's Table 2 on **area · sub-location · subtrade · LAP Plan** (case and spacing ignored), each side summed per key, with `match` = both / master only / linked only |

Three lines, each as cumulative weightage ÷ total weightage of the weighted tasks in view: **baseline** (baseline dates), **planned** (current planned dates) and **actual** (earned weightage over actual dates). The weightages
are project-wide (siblings do not sum to 100), so they are added as they are. JUI's Table 2
carries `lapPlan` and `joinKey`; a task joins only when it has both a Subtrade and a LAP Plan.

The S-curve tab has its own filters (area, sub-location, S-curve group, construction phase), a
schedule summary strip (baseline, working plan, finish variance), three cards (Progress %,
weighted tasks, complete as of today), the S-curve (baseline, working plan and actual, with
monthly bars), plan bars by area, and the join table (matched / master only / JUI only,
search, CSV). Its filters and the
open tab are kept in the URL beside the quantity filters (`#p=scurve&sa=DC+Building`).

The refresh needs both secrets, `VL_TOKEN_JUI` and `VL_TOKEN_JUI_1A` (locally, `tokens.json`
keys `JUI` and `JUI-1A`). If the master schedule cannot be fetched and there is no cached copy,
the S-curve tab says so and the Quantities page is unaffected.

### Progress on the site model (on the S-curve tab)

`JUI/project.json` → `display.model3d.views` lists what the card shows (a toggle appears when there are two or more):

- **3D model** (`"model": "site-model"`): the site built from the BIM model, drawn in the page
  with WebGL (`Template/scripts/ifcview.js`, no library). Drag to turn, scroll or pinch to zoom,
  right-drag or shift-drag to pan, double-click or Reset view to go back; the chips show or hide
  each category (underground services, foundations, stairs and ramps, structural steel, columns,
  beams, slabs and roofs, walls). Each building in `anchors` (its position `at: [x, y, top z]` in
  model metres, from the elements' Comments: DC BLDG, DG BLDG, HSD TANK, PUMP ROOM, GIS Building,
  STP SHADE, checked against the site plan) carries a ring of its earned
  weightage in the master schedule, coloured against what the baseline says is due by today
  (green on or ahead, amber up to 5 points behind, red further behind), with the baseline share
  as the faint arc. Hover or focus a ring for its storeys and dates; select it to open the
  building in the list. `dx` / `dy` nudge a ring in pixels, `tag` moves its name beside it.
  **Click an element** for its panel: name (Revit family : type), category, IFC type, level, and
  the IFC's **VisiLean** property set (Workset, Comments, Mark), with the JUI tasks linked to it
  (status, % complete, subtrade, planned and actual dates, location; "overdue" when an open task
  is past its planned finish). **Task status** colours each linked element with VisiLean's status
  colours (`statusColors` in `Template/dashboard_data.json`: Not Committed #EEDC1D, Not Ready
  #FF7261, Ready #05E344, Forced Ready #AFD127, Started #541B60, Warning #F7BF3F, Stopped #E40000,
  Complete #04962E, Rejected at quality check #5A55B5, Quality checked #024009). An element with
  several tasks shows their common status; Complete when all are done; Stopped, Rejected,
  Warning or Started when any task has it; Started when some are done and the rest wait; else the
  least ready status. Elements without a task are drawn see-through (12 % opacity) and clicks pass
  through them to the linked elements behind.

**Click a building's ring** for its quantity progress, from the Quantity tracking data: the
tasks of its area (DC Building, DG Building, GIS), or of its own sub-location (HSD Yard, Pump
Room). The panel gives the overall quantity progress (the average of the subtrade figures, as
units cannot be added) and how many activities are complete, then each subtrade (unit, total,
actual, %) in construction order and each location (activities, done, %). Unassigned subtrades
are left out. Hovering the ring still shows the schedule weightage by storey.

**Task links** (`calculation.bim_links`, at every refresh, so the colours follow the latest
status): a task links to the model elements whose **Mark** it names, in the same building.
`DC3B-C39-FT-CW` → element C39 of the DC building (footing tasks take the foundation-level
element), `DC2-SF-C52` → C52 on the second floor, `DG-2-SW4-FT-SC` → wall SW4 of the DG building.
The task's building comes from its name or location; the element's from its Comments, else its
storey, else its Workset. **Level**: when the task's location ends with a level code
(`DC Building_DC-1_FL`, `_GF`, `_1F`, `_2F` …), the task links to the piece of that mark whose
mid-height lies in that level's band (`display.bim.levelBands`, metres): FL = the stub column at
foundation level (6.8–9.7 m), GF = the ground-floor column (9.7–17.2), 1F = the first-floor
column (17.2–24.7), 2F (24.7–32.2) and so on; so `DC1A-C74-FT-SC` (…_FL) colours the C74 stub and
`DC1-1F-C73` (…_1F) the first-floor piece of C73. Without a level code, a floor code in the name
or the foundation rule decides as before. A mark found in one building only links even when the element's
Comments are missing or wrong. Patterns can be changed in `display.bim` (see `BIM_DEFAULTS` in
`Template/calculation.py`). Today 854 of 1,679 tasks that name a mark are linked; 820 of the
rest are plinth-beam tasks (`DC3A-PB393-PCC`, `GIS-GB44-PB-RCC`) whose beams have no Mark in the
model: give them their PB / GB marks in Revit, re-export and run `python -m build.ifc_model JUI`.

**Element ID** (first): the task custom field **Element ID** = `<zone>_<type>_<level>_All`
(e.g. `DC-1_StubColumn_FL_All`: every DC-1 stub column at foundation level) links a task to a
set of elements; all tasks with one ID give it their combined status. `display.bim.elementIds`:

- **zone**: a plan rectangle. At foundation level (FL) DC-1 … DC-4 run across the whole building
  (task halves A / B), split along it at grid ≈ 9b / 6b / 4b; above it the pour plan zones apply
  (DC-1 … DC-4 and DC-2A / DC-4A); DG-1 / DG-2 come from columns C101–C112 / C113–C122.
- **type**: StubColumn and Column → columns, plinthbeam → beams, Footing → footings, Wall,
  Beam, and Slab → the pour plan (coloured point by point).
- **level**: for columns, walls, plinth beams and footings the floor they stand on, by
  mid-height (FL foundation / ground level 6.8–9.6 m, GF 9.6–17, 1F 17–24.5, 2F …); for slabs
  the roof slab of that floor, by top (FL the grade slab, GF the ground-floor roof slab at
  17.2 m, 1F the first-floor roof slab at 24.7 m, 2F at 32.2 m).
- **`_All`** takes every element of that type, level and zone; anything else is read as a Mark.

Tasks without an Element ID still link by the mark in their name (above).

**More links** (`display.bim` in `JUI/project.json`), for elements that carry no usable mark:

- **groups** (optional, none today: the Element IDs cover the plinth beams and foundations): a
  set of elements linked as one to a set of tasks chosen by name / subtrade / location.
- **pours**: the DC slab pour plan. Each zone (DC-1, DC-2, DC-3, DC-4, DC-2A, DC-4A) is a
  rectangle in model metres read off the grid lines of the pour plan; each level a height range.
  The task levels name the slab by the columns under it: **GF** (`Slab-RCC-GF`) is the GF roof
  slab, on the ground-floor columns, i.e. the model's FIRST FLOOR slab (top 17.2 m); **1F**
  (`Slab-RCC-1F`) is the 1F roof slab, the model's SECOND FLOOR slab (24.7 m). A DC slab point takes the state of the "Casting of slab" task of its zone and
  level (location `DC Building_<zone>_<level>` or `SS_<zone>`; level from the subtrade
  `Slab-RCC-<level>`, else from the location's ending), so one large slab element shows
  every pour it spans, with the pour edges outlined. Clicking a slab shows the pour under the
  pointer.

**Show up to** (All / 2F / 1F / GF / FL, `display.bim.cuts`) hides everything above the 1F roof
slab, the GF roof slab or the grade slab, so the lower pours, the foundations and the plinth beams
can be seen. The building list beside the model was removed; the model uses the
whole card, and the rings' tooltips keep each building's figures.

The IFC must carry the **VisiLean** property set (`propertySet` in `display.model3d.ifc`). In
Revit: File → Export → IFC → Modify setup → Property Sets → Export user defined property sets,
with `VisiLean_PropertySets.txt` (Workset, Comments, Mark).

The model files `JUI/model/site-model.bin` and `.json` and `.meta.json` (the element table) are made **on this PC** from the IFC
and committed; the refresh only copies them. To update them after the model changes, put the
new IFC in the repository folder (`*.ifc` is gitignored, it is never committed) and run:

    python -m pip install ifcopenshell
    python -m build.ifc_model JUI

`display.model3d.ifc` says how: `source` (the IFC), `cell` and `heavy` (elements with more than
`heavy` triangles are simplified by merging vertices on a `cell`-metre grid), `groups` (which
IFC classes / names go in which category, first match wins; `skip` leaves elements out, such as
the opening markers), `anchors` (storey-name patterns, used only for rings without an `at`) and
`view` (the starting angle and zoom). Openings are not cut. A 465 MB IFC takes about 8 minutes
and about 5 GB of memory.

`display.model3d.buildings` defines which master-schedule S-curve groups (`group`, `finish`,
regular expressions) make up each building and storey; the list beside the model gives the
earned, baseline and plan figures per building and storey. The open view is kept in the URL as
`sv=`.

## Site progress page (third tab)

`JUI/project.json` → `progressDeck` names a PowerPoint deck of marked-up drawings (today
`DPR PPT - Formatted.pptx` in the repository root). Every build reads it with
`build/progress_deck.py` (standard library only) and publishes each slide's drawing to
`dist/JUI/progress/slide<n>.png`. Replace the file to update the page; on GitHub it has to be
committed for the refresh to see it.

- **Slide title → area and subtrade.** Titles read `<Area> – <work item> – <level>`, e.g.
  `DC Building – DC 1 to 4A – Columns RCC – GF-1F`. The area is matched to the data's areas
  (exact, alias, or prefix: `DG` → DG Building); the subtrade is the one in that area whose
  words best match the work item plus the first level (`GF-1F` → GF), e.g. Column-RCC-GF. A
  title that matches nothing is logged as a warning; `display.progressMatch` (title →
  subtrade) can pin one by hand.
- **Pour labels → sub-areas.** Labels such as `POUR-6 / DC-1` go through the same location
  rules as the data, so they map to DC-1; a label with no DC/DG number (`POUR-1`) stays a plain
  label and the whole item is shown beside the drawing.
- **The drawing** is redrawn as SVG in the slide's own coordinates: the picture, the DPR's
  mark-up exactly as drawn (green elements and areas that are done, outlined pours), and a
  chip on each pour with its % of scope and status from VisiLean (hover for start, finish and
  forecast).
- **Beside it** the item's % of scope against plan to date, scope / plan to date / actual,
  and start / finish / forecast; **under it** a row per sub-area. Status, dates and forecast
  follow the same rules as the Quantity tracking cards. Area pills filter the drawings
  (`#p=site&pa=GIS`).

## Workforce page (fourth tab)

`JUI/project.json` → `"workforce"` adds a Workforce tab from VisiLean's `type=workForce` feed for
the same project, with the same token (secret `VL_TOKEN_JUI`, locally `tokens.json` key `JUI`):
one VisiLean token serves every `type=` of a project. Its saved copy is `.cache/JUI-WF.json.gz`.
The feed has one row per activity with, for each reporting day, `plannedWorkers` and
`actualWorkers` (dates are IST midnights).

- **Matching**: each workforce `activityGuid` is matched guid to guid to the JUI task feed, every
  row and every task type (the daily labour report tasks are Design-type, so they are not in
  Table 2), latest history row per guid. A matched task's **trade** is its `trade` field (else its
  name); its **category** (Workers, Employees, Facility & Support service, …), **shift** (Day /
  Night, or "No shift split" where the report has none) and DLR month come from its parents, e.g.
  `Workers < Day Shift < DLR-Mar-2026 < JUI01-DLR`. Today 427 of 459 workforce activities match;
  the other 32 carry no workers.
- **Running average workforce** for a date range = actual man-days in the range ÷ reporting days
  in the range. A reporting day is a date with any record in the feed, whatever the filters, so
  trades, shifts and months add up to the total. The chart has one bar per calendar month: the
  month's average daily workforce (its man-days ÷ its reporting days in the range), split by
  shift, with a tick at the month's peak day; the running-average line is the same figure from the
  start of the range to each month's last report, and amber diamonds mark the planned average.
- **Filters**: date range (from / to, or All, Latest month, Last 30 days, Last 7 days, counted back
  from the latest report), shift and category chips (several at once) and a trade multi-select.
  All in the URL hash (`wf`, `wt`, `wsh`, `wc`, `wtr`).
- **Trade-wise**: average daily workforce, man-days, share, peak day, and planned man-days with
  actual vs plan where the labour report plans a trade. **Monthly**: average daily, peak,
  man-days and reporting days per calendar month. **Trade by month**: average daily or man-days.
- **Tables** (published beside the page, and in `data/JUI/workforce/`): `workforce_daily.csv`
  (one row per activity and date: trade, category, shift, DLR month, planned, actual, matched) and
  `workforce_trade_month.csv` (per trade and month: reporting days, planned and actual man-days,
  average daily workforce).

## What the page shows

The page follows the VisiLean dashboard design (masthead, pill tabs, a filter bar of pill
selects, a schedule summary strip, cards with notes and blue callouts, and plan bars). The
**Progress & S-curve** tab opens with a schedule summary strip and three cards: **Progress %** (a
ring of earned against the baseline today), a tile group, and **Complete as of today**; the
**Quantity tracking** tab opens straight on its plan bars. **Plan bars** show done (the fill) against where the plan says you
should be today (the dark tick): green on or ahead, amber up to 5 points behind, red further
behind, grey not started. On **Progress & S-curve** they are by area (earned vs baseline today), and
selecting one filters the page.

- **Filters**: area, sub-location (follows the chosen area), subtrade, unit, status
  (complete / started / not started / overdue), % complete and a search box. Sub-location,
  subtrade and % complete are multi-select dropdowns (tick any number, Select all / Clear, a
  search box in long lists); an activity shows if it matches any ticked value in each of them.
  % complete reads VisiLean's `percentComplete` (equal to actual ÷ total quantity in this
  feed): bands 0%, 1–25%, 26–50%, 51–75%, 76–99%, 100%, plus any number of custom from–to
  ranges added at the foot of the list; a range ending at 100 includes anything above it.
  Kept in the URL hash (several values joined with `|`, e.g. `st=Backfilling|Blasting Works`),
  so a filtered view can be shared.
- **Headline tiles**: activities, complete, started, not started, overdue (planned end before
  today and not complete), subtrades.
- **KPI 1, quantity by subtrade**: one row per subtrade and unit with total quantity, planned to
  date (Table 3 up to today), actual quantity, variance (total − actual), actual against plan to
  date, and progress. Quantities are never added across units; a totals row appears when one
  unit is in view. Sortable; CSV download. Four date columns per row:
  - **Schedule start / end**: earliest `Schedule Start` and latest `Schedule Finish` custom
    field of the row's activities (hand-typed `11-Mar-26`, `15-Mar-2026`, `1-June-26` all
    parse). `*` means only some activities carry the field; ⚠ means the earliest start is after
    the latest finish, a data-entry error to fix in VisiLean.
  - **Actual start / end**: earliest actual start and latest actual end, shown only when every
    activity in the row is complete; otherwise `—`, with the open count on hover.
- **KPI 2, location bifurcation**: area and sub-location come from `location` by rules in
  `dashboard_data.json` → `location`. First, a building token anywhere in the value, whatever
  prefix, suffix or separator surrounds it, sets the area: `DC-1`, `DC-2A` → **DC Building**,
  `DG-1` → **DG Building**, with the token as the sub-location (`SS_DC-2A` → DC Building ›
  DC-2A). Otherwise the value is split on the first `_` (`GIS_Transformer Yard` → GIS ›
  Transformer Yard; `GIS` alone is the whole area) and the prefix is expanded (`ED` → External
  Development, `AS` → Ancillary Structures). Both projects use the same rules, so their areas
  and the join key line up. Shows activities by area as stacked status bars, and a
  three-level table **area › sub-location › subtrade** with the same columns as Quantity by
  subtrade: total, planned to date, actual, variance, actual vs plan to date, progress, schedule
  start and end, and actual start and end (once every activity in the row is complete). Areas open to their sub-locations by default; the arrow on a sub-location opens
  its subtrades (Expand all / Collapse all do every row). Area and sub-location quantities are
  in one unit (the Unit filter, or the most common unit); a subtrade row is one subtrade in one
  unit, shown in that unit (Unit column). Select a row's name for its activities; the CSV has
  all three levels.
- **Subtrade progress by location** (top of Quantity tracking): one card per location (**Area**
  or **Sub-location**) in construction sequence (earliest planned start first), with its
  subtrades (per unit) as columns. The heading has a small ring split by status and "x of N
  complete · y need attention · z missing data". Each column: subtrade, unit chip ("no unit" in
  amber), a status pill, a **donut** of actual against plan as % of scope (solid arc = actual,
  coloured by status; light arc = plan to date; a tick at the plan; the full ring is scope),
  "Plan x% ±y pts", **scope · plan to date · actual to date**,
  and **start** (actual, or planned and how many days late), **finish** (actual once complete,
  else planned and when it is due or how overdue) and **forecast** (the JUI-1A baseline end for
  the same area · sub-location · subtrade · LAP Plan, else the Schedule Finish custom field,
  with its source). Status, first match wins: Missing data (no scope or planned dates),
  Complete, Start overdue (planned start passed, nothing recorded), Finish overdue (planned
  finish passed, not complete), Behind plan (more than 5 points below plan to date), On track.
  "In progress" (default) shows subtrades with work recorded and not all complete; "Needs
  attention" and "All" widen it. Select a card for its activities.
- Tables 2–4 are not drawn on the page; download them from the footer links.

### Hiding visuals

Every titled visual on every page has a small hide button (crossed-out eye) beside its title.
A hidden visual leaves the page, the cards beside it close up, and a "hidden visuals" bar under
the page's filters lists it with a Show button (and Show all). The choice is per viewer and kept
in that browser only (`localStorage`); it never changes the data, the other viewers' pages or
the downloads. `Template/scripts/cardhide.js`.

### Drill-through

Every number opens the activities behind it in a side panel, within the current page filters:

| Select | Opens |
|---|---|
| A headline tile (activities, complete, started, not started, overdue) | Those activities |
| A subtrade row | That subtrade and unit |
| An area bar, or one coloured segment of it | The area, or the area at that status |
| An area, sub-location or subtrade row in the location table | That area, sub-location or subtrade |
| A progress card | That area's subtrade |
| An activity in any of these lists | That activity's detail |

The **list** shows status counts, quantities per unit, a search box, a status switch, CSV
download and "Filter the page to this", which applies the selection to the whole page.

The **activity detail** shows quantities (total, actual, variance, planned to date, progress),
planned and actual dates with durations, start and finish delay in days (late, early, or
"so far" while still open), its daily planned and actual rates (its rows in Tables 3 and 4),
owner, organisation, trade and raw location, and its full **history** from the feed, newest
first. Each event is classed as late, on time / early, rescheduled, quantity changed or
update, with its note (delay reason) shown. Previous / Next (or the arrow keys) step through
the list it came from; Escape goes back to the list, then closes the panel.

Delays and history classes are computed in `calculation.py` (`delay_days`, `history_event`);
email addresses in history text are replaced with `[email]` before anything reaches the page.

Configuration is in `Template/dashboard_data.json`. A project overrides any key in its
`project.json` → `display`. Examples: change the location delimiter, merge two area names
with `location.areaAliases` (e.g. `{"ED": "External Development"}`), or merge subtrade
spellings with `subtradeAliases`.

## Local build

Put the project's token in `tokens.json` (gitignored; see `tokens.json.example`). Use the
`accessToken` value only, not the whole URL.

```
python -m build selftest                 # calculation.py against a hand-checked synthetic case
python -m build build --source live      # fetch, write data/JUI/*.csv and dist/
python -m build validate
python -m build serve                    # http://localhost:8000/ and /JUI/
```

`--source sample` builds from `sample/<CODE>.tasks.json.gz` (gitignored) without calling
VisiLean. `--today YYYY-MM-DD` pins the date that "started" activities run to.

Page states: `fresh` (live data), `stale` (VisiLean unreachable, last good copy from `.cache/`
with a banner), `unavailable` (no data yet, empty-state page).

## Adding a project

```
python -m build new-project --code ABC --name "Project name" --id <VisiLean project GUID>
```

This writes `ABC/project.json` and `.github/workflows/refresh-ABC.yml`, scheduled 4 minutes
after the previous project. Then create the repository secret `VL_TOKEN_ABC` holding the
token, commit, push, and run the workflow once by hand.

## GitHub setup (once)

1. Push `main` (repository `JUI_Portfolio_Report`). Pages from a branch needs a public
   repository, or a paid plan for a private one.
2. Settings → Secrets and variables → Actions: add two secrets, the VisiLean `accessToken` value
   only (no URL):
   - `VL_TOKEN_JUI`: the JUI project (task history and workforce)
   - `VL_TOKEN_JUI_1A`: the JUI-1A master schedule (S-curve page)

   or from a terminal: `gh secret set VL_TOKEN_JUI` and `gh secret set VL_TOKEN_JUI_1A` (each
   asks for the value). Tokens never go in the repository: locally they live in the gitignored
   `tokens.json` (see `tokens.json.example`).
3. Actions → "Refresh JUI - JUI" → Run workflow. The first publish creates `gh-pages`.
4. Settings → Pages → Deploy from a branch → `gh-pages`, `/ (root)`.

Each refresh also uploads `data/<CODE>/` (all four tables) as the `<CODE>-tables` workflow
artifact, kept for 14 days.

## Safety

The page carries no endpoint, project ID or token. `build/inject.py` refuses to write a page
containing them; `python -m build validate` and `pages.sh scan` check again before anything is
published. Pages are `noindex`.
