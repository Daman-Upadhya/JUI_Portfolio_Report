# visilean-4d-link - for the person setting up 4D

This is a Claude Code **skill**. It packages the method used on TPL JUI01 to link the IFC model to the
VisiLean schedule, so Claude can redo it for any model (next campus buildings, other disciplines, other projects).

## Install (once)
1. Copy this whole `visilean-4d-link` folder to either
   - `<your project folder>/.claude/skills/visilean-4d-link/` (this project only), or
   - `%USERPROFILE%\.claude\skills\visilean-4d-link\` (all your projects).
2. Python 3.11+ with: `pip install ifcopenshell numpy matplotlib openpyxl pymupdf python-pptx`
3. VisiLean API access for the client workspace (Client ID, Client Secret, MCP Key - from VisiLean admin).
   Run this yourself, it asks for the three values with hidden input and stores them in your Windows user profile:
   `powershell -ExecutionPolicy Bypass -File scripts\setup_credentials.ps1 -Prefix VL_TATA -Workspace "Tata Projects Ltd"`
   Then restart Claude.

## Use
Open Claude Code in the folder that holds the IFC and the client layouts, and type:

    /visilean-4d-link

or just ask, e.g. *"Link the DAY-2 structural model to the JUI02 schedule in VisiLean"*. Claude will ask for what
is missing (IFC, VisiLean project, pour/zone layouts, which side is sub-zone A, scope), then:

1. pull the schedule (read-only) and profile its naming,
2. extract the model and plot it,
3. write the zoning rules from your layouts, show check plans, and ask you to confirm anything ambiguous,
4. write `<model>_Linked.ifc` (pset **VL_Link** on every element), `VL_Link_Mapping_Review.xlsx` and a 3D/4D viewer.

## What goes into the model (VL_Link)
VL_Building · VL_Module · VL_SubZone · VL_Level · VL_ElementGroup · VL_Location (VisiLean path) ·
**VL_WorkPackage** (stable key, e.g. `1F-DC1-Columns`) · **VL_ActivityIDs** (`CS-DC-C-1FL-DC1-110;…`) ·
VL_LinkStatus · VL_Basis · VL_Flag. In VisiLean, select model elements by property: `VL_ActivityIDs` contains the
activity ID, or `VL_WorkPackage` = the package.

## Refreshing after a schedule update
Ask Claude: *"refresh the VisiLean link for <model>"* - it re-pulls the schedule and regenerates the IFC, workbook
and viewer with the same rules (the rules file is kept in `<folder>/vl_link/work/classify_<project>.py`).

Details: `SKILL.md` (workflow), `references/METHOD.md` (how each rule is derived), `references/DISCIPLINES.md`
(MEP / architecture / external works), `examples/jui01/` (the full real case).
