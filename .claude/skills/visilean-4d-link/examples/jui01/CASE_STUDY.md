# Case study - JUI01 (DAY-1) structural + UG services model

## Inputs
| Item | Value |
|---|---|
| Model | `JUI1-STRC_UG SERVICES_VL.ifc` - Revit 2026 → IFC2X3, 454 MB, 22,306 elements (+9,803 openings), 40 storeys, 72 grids |
| Existing data | Revit pset `VisiLean` on 22,250 elements: Workset, Comments (building/floor words, 30 % blank), Mark |
| VisiLean | workspace **Tata Projects Limited**, project **TPL - JUI01 Data Center** `F7126A24-1E22-0186-8A88-E9BC72BFF388`, 24,864 tasks, no takt zones |
| Layouts | `Zones and DC wise breakup of the Areas.pptx` (13 slides: DC pour plan, DC GF–1F / 1F–2F, GIS, transformer yard, pump house, DG plinth, HSD, CW excavation zones, UG services zones), campus plan A-100C, DC/DG plinth beam layouts S-201/S-215 |

## Model facts that shaped the rules
- World coordinates in metres: E ≈ 291,858–292,148, N ≈ 2,107,972–2,108,290. Grid in mm.
- DC grid: numbers 13 (N 2108144.3) → 1 (N 2108266.1) along Northing; letters A' A B C D E F G H along Easting
  (A 292010.9 … H 292069.8). DG grid: 3a…12a along Northing, J K L along Easting (east of DC).
- All concrete columns share one placement point → bounding boxes are mandatory.
- Storey names are unreliable (DC elements on "GIS L0 SSL" etc.) → levels from heights.

## Schedule grammar (from title shapes)
- Superstructure: `{1F|2F|3F|4F|TF}-{DC1|DC2|DC2A|DC3|DC4|DC4A|DG1|DG2} - {Reinforcement (& PT) works|Formwork works|Formwork Arrangement|Formwork Shifting|Concreting works} - {Columns|Walls|Slab}`
- Pour strips: `{L}-DC1&2 | DC2&3 | DC3&4 | DC1,2&2A | DC3,4&4A - Pour Strip {Casting|Stressing}`
- Substructure: `DC1A - Footings - …`, `DC1B - Plinth Beam - …`, `GF-DC1 - … works` (grade slab), `DC1 - PCC works`
- Other: `Chiller Platform DC4 - …`, `DC1 - Parapet Wall - …`, `GIS - 1F - … - Columns`, `GIS Substructure - …`,
  `HSD Ext Wall H1 - …`, `UGT - Slab & Beam - …`, `Security Block - …`, `STP - …`, `OWC - …`,
  `Boundary Wall - Zone 7 - …`, `UGS - Excavation - Zone 9A`.

## Zoning decisions
| Area | Rule | Source |
|---|---|---|
| DC modules | cuts at mid(10,9b), mid(8,7a), mid(4,3b) on N; mid(E,F) on E. DC-1..4 rows A–E; DC-2A rows F–H 13→8; DC-4A rows F–H 7a→1 | pour-plan slide |
| Pour strips | crosses a cut AND inside that grid bay; 10\|9b and 4\|3b only rows A–E; lower 8\|7a strip → DC2&3 (assumed) | slide + schedule labels |
| DC substructure | strips DC-1..4 full depth; A = rows A–E, B = rows F–H (assumed; footings complete so accepted) | schedule (no 2A/4A foundation tasks) |
| DG | DG-1 = 3a→7b, DG-2 = 7b→12a | DG plinth slide |
| Levels | GF 9.7 · 1F 17.2 · 2F 24.7 · 3F 32.2 · 4F 39.7 · TF 47.2; AT above; chiller platform top > 50.8 | height histogram |
| GIS | footprint E 292068–292130, N 2107984–2108034; building N ≤ 2108018.5, beyond = transformer yard; levels SS 9.7 / 1F 13.1 / 2F 19.1 / TF 25.05 | plan plot + GIS slides |
| HSD yard (Day-1) | strip east of DG: E 292102–292131, N 2108160–2108293; H1 = north half (assumed); north end = pump shade | campus plan + HSD slide |
| Pump house & UGT | box E 291878–291942, N 2107962–2108026; raft/PCC (top < 6.5 m) vs slab & beam; walls → all lift/wall A/B/C tasks (flag) | plan plot |
| Security block / NANO canopy, OWC / STP | footprint boxes | plan plot |
| Compound wall | perimeter ± 4 m; zone by side + break points (E: 3/2/1, S: 10/11/12, W: 9/8/7 incl. notch = 8, N: 6/5/4) | CW excavation slide, georeferenced |
| UG services | 12 zone rectangles georeferenced from the slide; sub-zones split for zones 2, 3, 9, 10 at the dashed dividers (A = west/north, assumed); others linked to all sub-zones (flag) | UG services slide |

## Result
22,306 elements → **16,887 linked (76 %)** to 993 activities in 436 work packages.

| Building | Linked |
|---|---|
| External Development (compound wall + UGS) | 100 % |
| GIS | 91 % |
| DG Building | 84 % |
| Ancillary structures | 76 % |
| DC Building | 68 % (rest: puff-panel steel supports per floor, mumty/LMR, stairs, sleeves - no matching civil task) |

## Problems hit and how they were solved
1. **Wrong workspace** - the three connected VisiLean credentials were Pre-Sales / Free Trial / another tenant.
   Added a fourth credential set for Tata Projects via env vars (`setup_credentials.ps1`).
2. **"Credentials rejected"** - Client ID and MCP Key pasted into each other's prompts. Detected by comparing
   lengths/shapes only; swapped the variables without displaying them.
3. **60k-character response cap / 429 rate limit** - page 150 tasks, narrow `fields`, retry with back-off.
4. **Columns all at the site origin** - switched from placement points to bounding boxes.
5. **Pour strip swallowed long beams** - added the "inside the grid bay" condition.
6. **Whole-building slab assigned to one module** - elements crossing ≥ 2 cuts → "Multiple modules" + flag.
7. **UG services linked to 5A, 5B, 5C, 5D together** - client noticed in the viewer. Sub-zones read from dashed
   connector lines on the slide where they matched the schedule; marked-up proposal image sent for the rest.

## Spot-check used before hand-over
```
1F-DC1-Columns      20 el. → CS-DC-C-1FL-DC1-110/130/170  (Reinforcement / Formwork / Concreting - Columns)
3F-DC2A-Slab       162 el. → Formwork Shifting / Arrangement / Reinforcement & PT / Concreting - Slab
TF-PST-DC3&4        18 el. → TF-DC3&4 Pour Strip Stressing / Casting
SS-DC2B-PlinthBeam  21 el. → DC2B - Plinth Beam - Reinforcement / Formwork / Concreting
AT-DC4-ChillerPlatform 403 el. → Chiller Platform DC4 - 7 activities
UGS-Zone09B         45 el. → UGS - Excavation / Civil works / Backfilling - Zone 9B
```
In the viewer: search `CS-DC-C-1FL-DC1-170` → exactly the 20 DC-1 GF→1F columns, all "Completed".

## Still open (for the client)
- UGS sub-zones for zones 1, 4, 5, 6, 7, 8, 11, 12 (and A/B side for 2, 3, 9, 10).
- HSD H1/H2 side; DG substructure A/B; UGT wall A/B/C.
