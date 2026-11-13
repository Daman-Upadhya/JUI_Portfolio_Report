# Dashboard integration - data contract and recipes

How to drive a model-based dashboard (3D viewer, BI report, VisiLean BIM module) from the VL_Link output.
Produced by `scripts/export_dashboard_data.py`; this file is copied into every export as `DATA_CONTRACT.md`.

## The principle
**The model carries the link, never the status.** Each element knows *which* activities build it
(`VL_ActivityIDs`). Dates and status change daily and live in VisiLean - the dashboard reads them by ActivityID.
So: element/bridge tables change only when the model or link rules change; activity status is refreshed live.

## Tables

| Table | Grain | Key | Main columns |
|---|---|---|---|
| `elements.csv` | model element | **GlobalId** (IFC GUID) | IfcClass, Name, VL_Building, VL_Module, VL_SubZone, VL_Level, VL_ElementGroup, VL_Location, VL_WorkPackage, VL_ActivityIDs, VL_Status (link status), VL_Flag, ActivityCount, VisiLeanStatus + StatusColour (rolled up, snapshot), PlannedStart/Finish, Volume_m3, bounding box (m) |
| `element_activity.csv` | element × activity | GlobalId + ActivityID | the many-to-many bridge (one element → rebar, formwork, concreting …; one activity → many elements) |
| `activities.csv` | VisiLean activity | **ActivityID** (= VisiLean task `externalId`) | TaskGuid, TaskId, Title, PlannedStart/Finish, ApiStatus, VisiLeanStatus, StatusColour, ElementCount, LinkedVolume_m3, WorkPackages |
| `work_packages.csv` | pour / package | **WorkPackage** | where + what, Elements, Volume_m3, ActivityIDs, rolled-up status, planned window |
| `status_palette.csv` | status | Key | VisiLean label, colour, rank, API values |

Join: `elements.GlobalId ⟷ element_activity.GlobalId`, `element_activity.ActivityID ⟷ activities.ActivityID`.
In the IFC the same values sit in pset **VL_Link** on each element (property names = column names without
the table prefix; `VL_LinkStatus` = `VL_Status`).

Link status values: `Linked` (has activities) · `No schedule task` (zoned, but the schedule has no activity for
that package - e.g. MEP supports, sleeves) · `Unassigned` · `No geometry`. `VL_Flag` = assumption to review.
Volume_m3 is the solid volume from geometry (openings not subtracted) - good for progress weighting, not for BOQ.
A **blank** volume means the element's mesh is not closed and its volume could not be trusted - treat it as
unknown (not 0) and fall back to element count for those rows.

## Status roll-up (element or work package from several activities)
VisiLean lifecycle, rank: Unscheduled 0 · Unassigned 1 · Not Ready 2 · Ready / Force Ready 3 · Start / Alert /
Stopped 4 · Completed / Rejected 5 · Approved 6. API mapping in `status_palette.csv` (note: API `UNPLANNED` =
**Unassigned**; a task without dates = Unscheduled).

```
if any Stopped → Stopped; elif any Alert → Alert; elif any Rejected → Rejected
elif all Approved → Approved; elif all rank ≥ 5 → Completed
elif any rank ≥ 4 → Start (in progress)
else → the least-ready status (lowest rank)
```
4D "planned" state at date D: before min(PlannedStart) = not started; between = in progress; after
max(PlannedFinish) = finished. Use VisiLean colours: Start `#4c1462`, Completed `#4bad3a`, etc.

## Live refresh from VisiLean
Read-only MCP endpoint `https://go.visilean.com/ca/mcp` (headers X-MCP-Client-Id, X-MCP-Client-Secret,
X-MCP-Key), tool `visilean_list_tasks` with `projectGuid`, `fields=externalId,status,startDate,endDate,title`,
`pageSize` ≤ 150, page until `hasNext` is false. Limits: 60 requests/min, ~60k-character responses.
`scripts/fetch_schedule.py` is a working client (env-var credentials, paging, back-off). Keep credentials
server-side (backend, Power BI gateway, scheduled job) - never in a browser page.

## Recipes

### A. Web 3D dashboard (That Open / IFC.js, xeokit, Autodesk APS, Speckle, three.js)
1. Load the **linked IFC** (or the original + `elements.csv` keyed by GlobalId).
2. Build `GlobalId → [ActivityID]` from `element_activity.csv` (or split VL_ActivityIDs from the pset).
3. Backend job pulls activities (above) every N minutes → `ActivityID → {status, start, finish}`.
4. Per element: roll up status → colour; for 4D, compare the slider date with PlannedStart/Finish.
5. Filters from VL_Building / VL_Module / VL_Level / VL_ElementGroup; click element → its activities; click
   activity → isolate its elements (reverse map).
Reference implementation of 2–5 in plain JS: `scripts/viewer_template.html` (search for `rollup`, `category`,
`isolateTask`).

### B. Power BI / other BI
- Import `elements.csv`, `element_activity.csv`, `activities.csv`, `work_packages.csv`, `status_palette.csv`.
- Relationships: elements 1—* element_activity *—1 activities (bridge; set cross-filter both ways, or use
  TREATAS). work_packages 1—* elements on WorkPackage.
- Replace `activities.csv` with a scheduled source that calls the VisiLean API (gateway) for live status.
- Measures, e.g. volume complete:
  `Volume Completed = CALCULATE(SUM(elements[Volume_m3]), elements[VisiLeanStatus] IN {"Completed","Approved"})`
  (for live status, recompute the roll-up in Power Query from activities rather than using the snapshot column).
- 3D: any IFC visual that filters by GlobalId.

### C. VisiLean BIM / 4D module
Upload `*_Linked.ifc`, then link activities to elements by property: `VL_ActivityIDs` contains the activity ID,
or `VL_WorkPackage` = package. Test on a few packages first (e.g. `1F-DC1-Columns` → 20 columns,
`CS-DC-C-1FL-DC1-170`).

## When to regenerate what
| Change | Do |
|---|---|
| Daily progress / status | nothing in the model - refresh activities from the API |
| Activities added / renamed / renumbered | `fetch_schedule` → `classify` → `export_dashboard_data` (+ `write_ifc` if VisiLean links via the IFC) |
| Model re-exported | full run from `extract_model` |
| Zoning changed (new pour plan, sub-zones confirmed) | edit rules in `classify_<project>.py`, then full run from `classify` |

## Stable names
Never rename VL_* properties or these columns - dashboards and VisiLean selection rules depend on them. Add new
columns rather than changing existing ones.
