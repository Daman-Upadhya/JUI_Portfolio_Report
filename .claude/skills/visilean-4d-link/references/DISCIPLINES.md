# Discipline and project playbooks

The pipeline and the VL_Link contract stay the same; what changes is **WHERE** (zoning source), **WHAT**
(element groups) and the **schedule patterns**. Always start with `analyse_schedule.py --filter <prefix>` for the
discipline (JUI01 prefixes: `CS-` civil/structure, `MEP-` services, `SC-` subcontract, `AE-` design, `MS-` …).

## Structure (done on JUI01)
- WHERE: pour modules from pour plans (grid cut lines), pour strips, levels by top height, substructure strips.
- WHAT: Columns / Walls / Slab (incl. PT beams) / Pour Strip / Footings / Footing PCC / Grade PCC / Plinth Beam /
  Staircase / Parapet Wall / Chiller Platform / Mumty-LMR.
- Typical unlinked: puff-panel steel supports, sleeves/openings, stair cores (tasks are per core ST1…STn - add a
  core lookup if needed), lift machine rooms.

## MEP (HVAC, electrical, FPS, PHE, ELV, BMS)
- Model: IfcFlowSegment / IfcFlowFitting / IfcFlowTerminal / IfcDistributionElement / IfcCableCarrierSegment …;
  `System` column from extract_model (Revit "System Name"/"System Classification"), Workset, TypeName.
- WHAT: map system/type to the service words in the schedule (Chilled water piping, Sprinkler piping, Cable tray,
  Busduct, Duct, Light fixtures, Panels…). Build the map from `analyse_schedule.py --filter "^MEP-"` title shapes.
- WHERE: the same building/module/level zoning as structure (reuse the structural cut lines - MEP tasks on JUI01
  are per floor and data hall: `MEP-DC-1F-…`, "Data Hall - DC-1"). Level for services hanging under a slab =
  the **storey below** → use `minZ` (bottom) with the level table, not `maxZ`. Risers spanning floors → group
  "Riser" or split per floor if the schedule does.
- Equipment (chillers, DG sets, panels, transformers): match `Mark`/`Tag` to tokens in titles (e.g. `CH-01`).
- Sequence words (first fix / second fix / testing & commissioning) → one work package, several activities.

## Architecture / finishes
- Model: walls/blockwork, doors, windows, ceilings, floor finishes, IfcSpace rooms.
- WHERE: room → assign each element to the IfcSpace whose bounding box contains its centroid (extract IfcSpace
  boxes the same way), then room name → schedule tokens ("1F - Data Hall - DC-1 - Flooring works",
  "Misc Room"). Fall back to module + level.
- WHAT: Blockwork, Plaster, Painting 1st/2nd coat, False ceiling, Flooring, Doors & windows, Glass partitions…

## Underground services and external works
- WHERE: zones drawn on a site slide → georeference (METHOD §8); sub-zones from dashed dividers, confirmed by
  the client. Roads / paving / landscaping: same, by zone polygons.
- WHAT: from Workset (`STRC_EXT UG SERVICE`, `…STROM WATER DRAIN`, `…ELECTRICAL UG SERVICES`, `…ELV…`,
  `…TELECOM…`, `PHE MANHOLE`, `FPRT_FIRE CHAMBERS`) - schedule groups by zone, not by service, on JUI01
  (Excavation / Civil works - <services> / Backfilling).

## Next campus buildings (DAY-2, DAY-3, GIS, HSD for Day-2/3 …)
- Same client, same naming style → copy `classify_jui01.py`, then re-read the new pour plans (module grid pairs,
  rows, pour strips, A/B substructure), new level table, new footprints. Grid tags repeat between buildings -
  scope each rule to its building footprint first.
- Re-use: compound wall and UGS zone rules are campus-wide; keep them in one place and only change sub-zones.

## Other projects / other clients
- Expect different title grammar: run `analyse_schedule.py`, write patterns from the top title shapes, and ask
  the planner for the zoning drawings that the schedule's location words refer to.
- If titles carry no position at all, ask whether VisiLean tasks have locations set (`analyse_schedule` prints
  how many) - then link by `VL_Location` instead of parsing titles.
- If activity IDs are not in VisiLean (`externalId` empty), use `taskGuid` as the link value and say so.
