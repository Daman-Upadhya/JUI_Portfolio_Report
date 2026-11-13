# Method - deriving link rules

Everything here was learned on JUI01; the code for each pattern is in `examples/jui01/classify_jui01.py`.

## 1. Geometry: always bounding boxes, in metres

- Use `bbox.csv` (world bounding box from the IfcOpenShell geometry iterator, metres). **Do not use the
  placement point.** On JUI01 all 1,683 concrete columns had the *same* placement origin (the site corner) with
  the real position inside the geometry; slabs and walls are often placed from a corner.
- Centroid `(minX+maxX)/2, (minY+maxY)/2` decides plan position; `maxZ` (top) decides level.
- Grid axes in `grids.json` are in model units (usually mm) - multiply by `unit_m`.
- Coordinates are usually survey coordinates (JUI01: E ≈ 292,000 m, N ≈ 2,108,000 m). Fine for maths; subtract an
  origin only for display.
- Elements with no geometry (≈0.3 %) and site-wide sheets (plan area > 2,500 m²) are reported, not linked.

## 2. Grids

- `plot_model.py` writes `grids_table.csv`: tag, whether the line has constant Easting (E) or Northing (N), position.
- **Check orientation per building.** JUI01 DC: numbers 13→1 run along Northing, letters A→H along Easting; the
  client's drawing is rotated 90°. The DG drawing is rotated the other way (3a on the left = high Northing).
  Always relate slide left/right/top/bottom to grid *tags*, never to screen direction.
- Tag case differs between drawing and model (`9B` on the slide, `9b` in the model). Model tags win.
- A model may have 70+ IfcGrid objects that repeat the same axes per level - de-duplicate by (tag, orientation, position).

## 3. Pour modules from a pour plan

1. Read the module boundary from the slide **as grid pairs**: e.g. DC-1 | DC-2 lies between grid 10 and 9b.
2. Cut line = midpoint of the two grids (`mid(GN["10"], GN["9b"])`). The bay between the two grids is the pour strip.
3. Rows: a second cut on the other axis (JUI01: between grid E and F → rows A–E vs F–H).
4. Module function = band lookup on the centroid. JUI01 superstructure: DC-1..4 on rows A–E, DC-2A (13→8) and
   DC-4A (7a→1) on rows F–H.
5. **Substructure may be zoned differently from superstructure.** JUI01 schedule had foundation tasks only for
   DC1–DC4 (`DC1A - Footings`, `DC1B - Footings`), none for DC-2A/4A → substructure = 4 full-depth strips, split A
   (rows A–E) / B (rows F–H). That was an *inference from the schedule* → flagged as an assumption.

## 4. Pour strips

- Element is in a pour strip when it **crosses a cut by > 0.3 m on both sides AND lies inside the grid bay** (± 1 m).
- Without the "inside the bay" test, long continuous beams get swallowed as pour strip.
- Strip labels come from the schedule titles: `1F-DC1&2 - Pour Strip Casting`, `1F-DC1,2&2A - …`. Map each cut to its
  label; link to the strip's Casting + Stressing tasks.
- A cut that only exists in some rows (JUI01: 10|9b only on rows A–E; rows F–H are DC-2A poured whole) must be
  limited to those rows.

## 5. Levels

- `profile.md` → "Element top height" histogram: floor levels are the big peaks (JUI01: 17, 25, 32, 40, 47 m =
  1F 17.2, 2F 24.7, 3F 32.2, 4F 39.7, TF 47.2; GF FFL 9.7).
- `level = first level whose elevation + 0.6 m >= maxZ`. Columns/walls topping at 1F belong to the **1F pour**
  (schedule "1F-DC1 - … - Columns" = GF→1F columns). Stair flights between floors fall to the floor above, which
  matches "DC - 1F - ST1 - …".
- Above the terrace: anything topping above a threshold (JUI01 chiller platform at ~52.7 m → threshold 50.8 m) is
  its own group; walls just above TF = parapets; slabs/columns = mumty / lift machine rooms.
- Ground / substructure (top ≤ GF + 0.6): split by type and height - footing PCC (top < 8 m), footings
  (IfcFooting, low IfcSlab/IfcColumn stubs), plinth beams (IfcBeam), grade PCC (PCC types ~9.4 m), grade slab
  (IfcSlab ≥ 9.3 m). Use type names (`PCC` in the name) - they are reliable in Revit exports.
- Each building can have its own level table (JUI01 GIS: SS 9.7, 1F 13.1, 2F 19.1, TF 25.05).

## 6. Small structures and areas

- Get footprints from `plan_Comments.png` / `plan_Workset.png` clusters + grid tags (pump house grids PF–PJ,
  GIS G1–G11, HSD HB-*). Express boxes in metres; give a few metres' margin; order the checks so big buildings
  are tested first and small boxes don't steal their elements.
- Within a footprint, split by a known dimension (JUI01 GIS building vs transformer yard by Northing 2108018.5;
  HSD H1/H2 by the middle of its 80 m length - assumption flagged).

## 7. Boundary / compound wall zones

- Element is "boundary wall" if Comments say so, or if it is an EXT column/framing/foundation within 4 m of the
  site perimeter (or inside a known notch box).
- Zone = nearest perimeter side + position along that side, with break points read off the zone slide.

## 8. External zones from a slide (UG services, roads, landscaping)

1. Render the slide to PNG (PowerPoint COM `Slide.Export(path,"PNG",1600,900)`; 3200×1800 for detail).
2. Georeference: pick a feature visible on both (JUI01: the compound wall outline = slide pixel box
   (437,15)-(1190,862) ↔ world E 291858–292148, N 2107972–2108290) and map linearly with `px2w`. Accuracy ≈ ±5 m;
   say so in `VL_Basis`.
3. Draw each zone as one or more pixel rectangles; assign elements to the containing rectangle, else the nearest
   one (flag if > 15 m away).
4. **Sub-zones (A/B/C/D)**: look for dashed connector lines on the slide - list them with COM
   (`shape.Type == 9` connectors: Left/Top/Width/Height in points; slide is 960×540 pt) and convert to pixels.
   Only split a zone where the number of parts equals the schedule's sub-zone count, and the client confirms
   which side is A. Otherwise link the element to all sub-zones of its zone **and flag it**, then send the
   client a marked-up image (`examples/jui01/UGS_SubZone_Proposal.png`).

## 9. Parsing the schedule

- `analyse_schedule.py` "title shapes" shows the repeating patterns with counts - write one regex per shape.
- Anchor regexes (`^…$`), normalise whitespace, accept known typos/variants (`Concreting works- Slab`,
  `Column`/`Columns`, `DC2 A`). Operations list for RC: `Reinforcement( & PT)? works | Formwork works | Formwork
  Arrangement | Formwork Shifting | Concreting works`.
- Build the **same key tuple** from title and from element: `(level, module, group)`, `(module, group, subzone)`, …
- Generic tasks with no position (`GIS Substructure - Reinforcement works`, `DG1A - Concreting works` when A/B is
  unknown) → link to the whole group and flag.
- Skip milestones / design / procurement / snagging - they have no model elements.
- `externalId` prefixes give the WBS (`CS-DC-C-1FL-DC1-…` = Civil-Structure / DC / Construction / 1F / DC1) and
  are useful to sanity-check, but titles carry the readable intent - parse titles, keep IDs as the link value.

## 10. Work package names

`<level>-<module without dash>-<group>` for building work (`1F-DC1-Columns`, `TF-PST-DC3&4`, `SS-DC2B-PlinthBeam`,
`AT-DC4-ChillerPlatform`), `<area>-<zone><sub>` outside (`UGS-Zone09A`, `CW-Zone07`, `HSDYard-H1`). Short, no
spaces, unique per (where, what). Never put dates or activity numbers in it.

## 11. VisiLean location path

Find the shortest path in the location tree that matches all regexes built from building / module / level.
Location titles contain typos (`Superstrucuture`, `Supestrucure`, `Substrucuture`) - match on stable fragments
(`Building_DC-1`, `First Floor$`), not full titles.

## 12. Validation checklist (do all, in this order)

1. `plot_check.py` images match the client slides (module shapes, pour strips, zones).
2. Spot-check 10–15 work packages: print element count, location and linked activity *titles*.
3. "No schedule task" breakdown by (building, level, group) - every big group is either explained (no such task
   exists) or fixed.
4. "Unassigned" plot - every cluster explained or given a footprint.
5. `verify_ifc.py`: same schema, same GUIDs, 0 value mismatches, 0 other psets changed.
6. Viewer: search an activity ID → only its elements; click → correct activities; Status legend sums to element count.

## 13. Timings (450 MB IFC2X3, 22k elements, laptop)

open 35 s · attributes 1 min · bounding boxes 10 min · classify < 10 s · write IFC 2 min · verify 1.5 min ·
schedule pull (25k tasks) ~3 min with rate-limit back-off · viewer HTML 2.8 MB.
