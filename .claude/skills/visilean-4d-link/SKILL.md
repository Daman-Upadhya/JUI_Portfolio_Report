---
name: visilean-4d-link
description: Link BIM model elements (IFC from Revit/Tekla/etc.) to VisiLean schedule activities for 4D - embeds a VL_Link property set (building, module, sub-zone, level, element group, VisiLean location, work package, activity IDs) into a copy of the IFC, builds a review workbook and a 3D/4D check viewer. Use when someone wants to "link the model to the schedule", "set up 4D in VisiLean", "add properties so model elements link to activities", "zone the model by pour/zone layouts", or re-run this for a new model, building, campus phase, discipline (structure, MEP, architecture, UG services) or project. Also use it to feed a model-based dashboard (web 3D viewer, Power BI, VisiLean BIM/4D) from these links - "integrate the VL_Link data with my dashboard", "join model elements to VisiLean activities/status", or when given a VL_Link hand-off package with START_HERE.md. Invoke with /visilean-4d-link.
---

# VisiLean 4D link

Turns **an IFC + a VisiLean schedule + the client's zoning layouts** into:

| Output | What it is |
|---|---|
| `<model>_Linked.ifc` | copy of the IFC; every element carries pset **`VL_Link`** (original data untouched) |
| `VL_Link_Mapping_Review.xlsx` | summary, work packages with activity titles, review items, every element |
| `<project>_4D_Viewer.html` | 3D boxes of every element: colour by 4D plan / VisiLean status / module / level / group / link; date slider + play; click element → its activities; click activity → its elements |
| `work/vl_link_mapping.csv` | the mapping table everything above is generated from |

Reference run: **JUI01 (DAY-1) structural + UG services model** - 22,306 elements, 16,887 linked to 993 activities. Read `examples/jui01/CASE_STUDY.md` before your first run; it shows every decision on a real model.

## The idea (read this first)

1. Each element gets **WHERE** - `VL_Building`, `VL_Module`, `VL_SubZone`, `VL_Level` - from **geometry** (world bounding box vs. grid lines / slide zones / level heights), never from Revit level names alone (storeys are messy: reference levels, "GIS L0 SSL" used for DC elements, etc.).
2. Each element gets **WHAT** - `VL_ElementGroup` - the noun the schedule uses ("Columns", "Walls", "Slab", "Pour Strip", "Plinth Beam", "Chiller Platform", "Cable Tray"...).
3. WHERE + WHAT = **`VL_WorkPackage`** e.g. `1F-DC1-Columns`. This is the **stable key**: it survives activity renumbering.
4. The schedule is parsed by **regex on activity titles** (`1F-DC1 - Concreting works - Columns`) into the same key → **`VL_ActivityIDs`** = every activity for that work package (rebar; formwork; concreting).
5. Linking in VisiLean: select elements by property - `VL_ActivityIDs` *contains* the activity ID, or `VL_WorkPackage` equals the package.

Never guess a zoning boundary silently. Anything assumed goes into `VL_Flag`, the workbook's *Review items* sheet, and the hand-over message.

## Step 0 - intake (ask, do not assume)

Ask the user in ONE message for whatever is missing (use AskUserQuestion for the choices):

1. **Model**: IFC path(s); discipline(s); which buildings/areas it covers. (Native .rvt is not readable - ask for an IFC export with the Revit "Comments"/"Mark"/worksets/systems exported.)
2. **VisiLean**: workspace name and project name. Credentials env prefix (e.g. `VL_TATA`). If not set up → Step 1.
3. **Zoning layouts**: pour plans, zone/sub-zone plans, key plans with grid references (PPT/PDF/DWG-PDF). Ask specifically for: module boundaries **in grid terms**, pour strips, sub-zones (A/B/C) **and which side is A**, external works zones, level/FFL table.
4. **Scope**: which disciplines/element types matter; anything to exclude (temporary works, openings, MEP supports...).
5. **Outputs**: linked IFC (yes), workbook (yes), viewer (local HTML and/or publish as a private artifact).
6. Where to write outputs (default: the model's folder; working files in `<folder>/vl_link/work`).

Proceed with what you have; record every open item for Step 7.

## Step 1 - VisiLean access (read-only)

- If a VisiLean MCP connector for the right workspace is already connected, you may use its tools to look around (`visilean_list_projects` etc.). Each connector/credential set is **tied to ONE workspace** - the project may live in another one.
- The scripts use direct HTTP with credentials in Windows **user** env vars. The credential owner runs (never paste secrets into chat):
  `powershell -ExecutionPolicy Bypass -File scripts/setup_credentials.ps1 -Prefix VL_TATA -Workspace "Tata Projects Ltd"`
- Find the project GUID: `python scripts/fetch_schedule.py work --env-prefix VL_TATA --list-projects`
- **Rejected credentials** → almost always Client ID and MCP Key swapped. Compare *lengths/shapes only* (Client ID 36-char GUID, MCP Key ~75 chars `xxxxx_xxxx_...`). Never print values.
- You are on LIVE client data: only read. Never create/update/delete VisiLean objects as part of this workflow.

## Step 2 - extract and profile (no rules yet)

```
python scripts/extract_model.py "<model.ifc>" work            # 10-15 min on ~450 MB; run in background
python scripts/fetch_schedule.py work <projectGuid> --env-prefix VL_TATA
python scripts/analyse_schedule.py work                        # -> work/schedule_profile.md
python scripts/plot_model.py work --by Comments                # -> plan_Comments.png, grids_table.csv, profile.md
python scripts/plot_model.py work --by Workset
```
Then **read**: `schedule_profile.md` (title shapes = the patterns you will parse), `profile.md` (top-height peaks = floor levels), the plan PNGs, `grids_table.csv`, `psets.csv`, and every client layout (render PPT slides to PNG via PowerPoint COM `Slide.Export`, PDFs via PyMuPDF; read connector/shape coordinates from the PPT for dashed divider lines).

## Step 3 - write the rules

`cp scripts/classify_template.py work/classify_<project>.py` and fill the PROJECT RULES block. Use `examples/jui01/classify_jui01.py` as the pattern library. Detailed method: `references/METHOD.md`; discipline specifics: `references/DISCIPLINES.md`.

Rules of thumb:
- Work in **world coordinates, metres**; grid positions come from `grids.json` (often mm - `unit_m` says).
- **Cut lines between modules = midpoint between the two grids either side of the pour strip.** Pour-strip elements = cross the cut AND stay inside that grid bay.
- **Level = first level whose elevation + 0.6 m ≥ element top (maxZ).** Columns/walls belong to the level they support (top), slabs/beams to the level they form.
- Long elements spanning ≥ 2 cuts → `Multiple modules` + flag; don't force them.
- Footprint boxes for small structures; perimeter distance for boundary walls; georeferenced slide rectangles for external zones.
- Every key you build for an element must equal a key built from a schedule title. Print unmatched groups and iterate.

## Step 4 - check before writing anything

```
python work/classify_<project>.py work
python scripts/plot_check.py work --level 1F           # -> check_modules_1F.png, check_site.png, check_status.png
```
Compare `check_modules_*.png` with the pour-plan slides (same module shapes? pour strips where the slide shows them?) and `check_site.png` with zone slides. Then spot-check: for 10-15 work packages print the linked activity **titles** and confirm they read right (see CASE_STUDY "spot-check"). Iterate until it matches. Coverage in the 70-90 % range is normal for structure - the rest is usually steel supports, openings/sleeves, mumty/LMR cores, staircases with core-specific tasks; report them, don't force them.

## Step 5 - write outputs

```
python scripts/write_ifc.py "<model.ifc>" work/vl_link_mapping.csv "<model>_Linked.ifc"        # ~2 min
python scripts/verify_ifc.py "<model.ifc>" "<model>_Linked.ifc" work/vl_link_mapping.csv       # must show 0 mismatches, 0 other psets changed
python scripts/make_report.py work "VL_Link_Mapping_Review.xlsx"
python scripts/make_viewer.py work scripts/viewer_template.html "<Project>_4D_Viewer.html" --title "<Project> 4D Link Viewer" --heading "<Project> Linked Model" --project "<VisiLean project title>" --model "<model>_Linked.ifc"
```
- The source IFC is never modified. `write_ifc.py` replaces any earlier `VL_Link` set, so re-runs are safe.
- Viewer: test it locally (serve the folder with `python -m http.server` and open it in the browser pane: search an activity ID, click an element, switch Status, press Play, read console errors). Publish as a private artifact only if the user wants a link; republish to the same path to update.

## Step 5b - dashboard tables

```
python scripts/export_dashboard_data.py work "<folder>/dashboard_data" --project "<VisiLean project title>"
```
Writes elements.csv, element_activity.csv (bridge), activities.csv, work_packages.csv, status_palette.csv,
dashboard_data.json, meta.json, DATA_CONTRACT.md. Volumes come from `bbox.csv` (`volume_m3`, written by
extract_model.py).

## Step 5c - integrate with a dashboard (when asked, or when given a hand-off package)

Read `references/DASHBOARD_INTEGRATION.md`, then inspect the user's dashboard project before changing it:
what it is built on (web viewer library, Power BI, VisiLean BIM module), how it loads the model, where data
comes from, and where secrets live. Then wire it to the contract: elements by **GlobalId**, bridge to
**ActivityID**, live activity status from the VisiLean API on the server side, status roll-up and VisiLean colours
exactly as specified, filters from VL_Building / VL_Module / VL_Level / VL_ElementGroup. Reuse the JS in
`scripts/viewer_template.html` for roll-up / 4D / isolate logic. Show unlinked and flagged elements as such - do
not hide them. Confirm with the user before changing an existing dashboard's data sources or deploying anything.

## Step 6 - refresh later (schedule changed / model re-exported)

Model unchanged, schedule updated → `fetch_schedule` → `classify` → `write_ifc` → `verify` → `make_report` → `make_viewer`.
Model re-exported → start at `extract_model`. Rules only change when zoning changes.

## Step 7 - hand-over message

Tell the user, plainly: outputs + paths/links; coverage by building (linked / no schedule task / unassigned); every **assumption** (e.g. "sub-zone A = west side", "substructure A/B = rows A-E / F-H") and what input would remove it; what was verified and how; what was not (e.g. VisiLean import itself). Offer a marked-up image when the client layout is ambiguous (see `examples/jui01/UGS_SubZone_Proposal.png`) - one picture gets a faster answer than a paragraph.

## VL_Link property set (contract - keep names stable, dashboards and VisiLean rules depend on them)

| Property | Type | Example |
|---|---|---|
| VL_Building | Label | DC Building |
| VL_Module | Label | DC-1 · DC-2A · DG-2 · AS_HSD Yard · UG Services |
| VL_SubZone | Label | DC1A · PST DC1&2 · ED_Zone 7 · UGS Zone 9A · H1 |
| VL_Level | Label | GF · 1F…4F · TF · AT · SS |
| VL_ElementGroup | Label | Columns · Walls · Slab · Pour Strip · Plinth Beam · Footings · Footing PCC · Chiller Platform |
| VL_Location | Text | exact VisiLean location path (JUI01 > DC Building > DC Building_DC-1 > … > DC-1 - First Floor) |
| VL_WorkPackage | Label | 1F-DC1-Columns (stable key) |
| VL_ActivityIDs | Text | CS-DC-C-1FL-DC1-110;CS-DC-C-1FL-DC1-130;CS-DC-C-1FL-DC1-170 |
| VL_LinkStatus | Label | Linked · No schedule task · Unassigned · No geometry |
| VL_Basis | Label | how WHERE was derived (grid: DC pour plan / slide: UGS zones (approx) …) |
| VL_Flag | Text | assumption or review note |

## VisiLean facts you will need

- Status lifecycle & colours (use these exact colours in any visual): Unscheduled `#b9e3dc` (no dates) · Unassigned `#e6df37` (API `UNPLANNED`: dates but no responsible) · Not Ready `#e6735f` · Ready `#76d64d` · Force Ready `#9eb52e` (`OVERRIDDEN_READY`) · Start `#4c1462` · Alert `#d8ab30` (`WARNING`) · Stopped `#cc2b2b` · Completed `#4bad3a` · Rejected `#6a4dc4` (`QUALITY_CHECKED_REJECTED`) · Approved `#1f4a14` (`QUALITY_CHECKED_COMPLETE`).
- Milestones: `*_NOT_COMMITTED` → Not Ready, `*_COMMITTED` → Ready, `START_MILESTONE_STARTED` → Start, `END_MILESTONE_UNDER_REVIEW`/`_COMPLETED` → Completed.
- `externalId` = the activity ID from P6/MSP (e.g. `CS-DC-C-1FL-DC1-170`); every task had one on JUI01. Most tasks had **no location/trade** set - don't rely on them; parse titles.
- API limits: 60 requests/min; MCP responses cap ≈ 60k chars → page 150 tasks with a `fields` list.

## Files

- `scripts/` - setup_credentials.ps1, fetch_schedule.py, extract_model.py, analyse_schedule.py, plot_model.py, classify_template.py, plot_check.py, write_ifc.py, verify_ifc.py, make_report.py, export_dashboard_data.py, make_viewer.py, viewer_template.html
- `references/DASHBOARD_INTEGRATION.md` - data contract, status roll-up, live refresh, recipes for web 3D / Power BI / VisiLean BIM
- `references/METHOD.md` - how to derive each rule type, with code patterns and pitfalls
- `references/DISCIPLINES.md` - structure / MEP / architecture-finishes / UG & external works / other projects
- `examples/jui01/` - CASE_STUDY.md, classify_jui01.py (complete real rule set), UGS_SubZone_Proposal.png

Python needs: `ifcopenshell numpy matplotlib openpyxl pymupdf python-pptx` (pip). Windows + PowerPoint only for slide rendering.
