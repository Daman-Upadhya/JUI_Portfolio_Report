"""
VisiLean link classifier - JUI01 (DAY-1) structural + UG-services IFC.

Gives every model element the properties VisiLean needs to link it to the
schedule, using world bounding boxes, the project grid and the existing Revit
data (Workset / Comments). All zoning rules sit in the RULES / footprint blocks
near the top so they can be revised without touching the logic.

Usage:  python classify.py <work_dir> [out.csv]
work_dir holds: elements_xy.csv, bbox.csv, grids.json, tasks.json, locations.json
"""
import csv, json, re, sys, collections, os

D = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, "vl_link_mapping.csv")

# ---------------------------------------------------------------- grids (m)
GN, GE = {}, {}
for g in json.load(open(os.path.join(D, "grids.json"))):
    (x0, y0), (x1, y1) = g["p0"], g["p1"]
    if abs(x1 - x0) < abs(y1 - y0): GE.setdefault(g["tag"], (x0 + x1) / 2000)
    else:                           GN.setdefault(g["tag"], (y0 + y1) / 2000)
mid = lambda a, b: (a + b) / 2

# ---------------------------------------------------------------- RULES
# DC pour plan (slide "DC BUILDING - POUR PLAN"): modules DC-1..4 on rows A-E, DC-2A / DC-4A on rows F-H
DC_BOX = (GE["A'"] - 4, GE["H"] + 4.5, GN["13"] - 9, GN["1"] + 4)
DC_CUTS = [  # (Northing of cut, grid pair, pour-strip label)
    (mid(GN["10"], GN["9b"]), "10|9b", "DC1&2"),
    (mid(GN["8"], GN["7a"]), "8|7a", "DC2&3"),
    (mid(GN["4"], GN["3b"]), "4|3b", "DC3&4")]
DC_CUT_E = mid(GE["E"], GE["F"])            # rows A-E | rows F-H
# DG plinth slide: DG-1 = grids 3a..7b, DG-2 = 7b..12a
DG_BOX = (GE["H"] + 4.5, GE["L"] + 4, GN["12a"] - 4, GN["3a"] + 4)
DG_CUT_N = GN["7b"]
# levels (m, absolute) - first level whose elevation + TOL >= element top
LEVELS = [("GF", 9.70), ("1F", 17.20), ("2F", 24.70), ("3F", 32.20), ("4F", 39.70), ("TF", 47.20)]
GIS_LEVELS = [("SS", 9.70), ("1F", 13.10), ("2F", 19.10), ("TF", 25.05)]
TOL = 0.60
CHILLER_TOP = 50.8                          # anything in DC topping out above this = chiller platform
# footprints of the smaller structures (E0, E1, N0, N1) - read off the plan plot of the model
GIS_BOX = (292068.0, 292130.0, 2107984.0, 2108034.0)
HSD_BOX = (DG_BOX[1], 292131.0, 2108160.0, 2108293.0)
PUMP_BOX = (291878.0, 291942.0, 2107962.0, 2108026.0)
SEC_BOX = (292003.0, 292037.0, 2107985.0, 2108016.0)
OWC_STP_BOX = (292088.0, 292120.0, 2108050.0, 2108068.0)
# compound wall perimeter + zone breaks (slide "CW Excavation", georeferenced to the wall extents)
PER = {"W": 291858.0, "E": 292148.0, "S": 2107972.0, "N": 2108290.0}
CW_ZONES = {"E": [(2108044.7, 3), (2108135.0, 2), (1e12, 1)],      # along side, south->north / west->east
            "S": [(291963.0, 10), (292074.5, 11), (1e12, 12)],
            "W": [(2108085.0, 9), (2108120.0, 8), (1e12, 7)],
            "N": [(291938.0, 6), (292041.0, 5), (1e12, 4)]}
WALL_NOTCH = (291858.0, 291878.0, 2108085.0, 2108118.0)            # the step in the west wall (zone 8)
# UG-services zones (slide "UG Services", pixel boxes on a 1600x900 render)
UGS_PX = {12: [(437, 15, 480, 478)], 11: [(480, 15, 797, 70)], 6: [(797, 15, 1175, 70)],
          1: [(1127, 70, 1175, 402)], 8: [(787, 70, 822, 455)], 9: [(480, 402, 822, 455)],
          5: [(822, 402, 1127, 455), (940, 455, 965, 662)], 3: [(1127, 402, 1190, 862)],
          10: [(437, 455, 530, 700)], 4: [(940, 662, 1127, 700)], 7: [(437, 700, 690, 862)],
          2: [(690, 700, 948, 862)]}
def px2w(x, y):
    return (PER["W"] + (x - 437) * (PER["E"] - PER["W"]) / (1190 - 437),
            PER["N"] - (y - 15) * (PER["N"] - PER["S"]) / (862 - 15))
UGS_W = {z: [(*px2w(a, d), *px2w(c, b)) for a, b, c, d in rects] for z, rects in UGS_PX.items()}
# UGS sub-zone dividers drawn on the slide (dashed lines), same 1600x900 pixel frame.
# Only zones whose divider count matches the schedule's sub-zones are split. A = west / north part (assumed).
UGS_SPLIT = {  # zone: ("E" -> split on Easting at pixel x | "N" -> split on Northing at pixel y, pixel value)
    9: ("E", 686.4), 2: ("E", 781.6),      # vertical dashed lines: A = west of the line
    10: ("N", 632.0), 3: ("N", 726.4)}     # horizontal dashed lines: A = north of the line
def ugs_sub(z, x, y):
    if z not in UGS_SPLIT: return ""
    axis, px = UGS_SPLIT[z]
    if axis == "E": return "A" if x < px2w(px, 0)[0] else "B"
    return "A" if y > px2w(0, px)[1] else "B"
UG_WORKSETS = {"STRC_EXT UG SERVICE", "STRC_EXT STROM WATER DRAIN", "STRC_EXT ELECTRICAL UG SERVICES",
               "STRC_EXT ELV UG SERVICES", "STRC_EXT TELECOM UG SERVICES", "STRC_EXT PLUMBING UG SERVICES",
               "PHE MANHOLE", "FPRT_FIRE CHAMBERS"}

# ---------------------------------------------------------------- helpers
def inbox(x, y, b): return b[0] <= x <= b[1] and b[2] <= y <= b[3]
def level_of(top, levels):
    for code, el in levels:
        if top <= el + TOL: return code
    return "AT"
def norm(s): return (s or "").strip().upper()
def dc_strip(y):                    # substructure strip DC-1..DC-4 (full depth A-H)
    for i, (c, _, _) in enumerate(DC_CUTS):
        if y < c: return f"DC-{i + 1}"
    return "DC-4"
def dc_module(x, y):                # superstructure pour module
    if x < DC_CUT_E: return dc_strip(y)
    return "DC-2A" if y < DC_CUTS[1][0] else "DC-4A"
DC_STRIP_BAYS = [(GN["10"], GN["9b"]), (GN["8"], GN["7a"]), (GN["4"], GN["3b"])]   # grid pair either side of each cut
DC_ROW_BAY = (GE["E"], GE["F"])
def dc_pour_strip(r):
    """label of the pour strip an element sits in (crosses the cut AND stays inside the strip bay), else ''"""
    cx = (r["minX"] + r["maxX"]) / 2
    for (c, _, lab), (lo, hi) in zip(DC_CUTS, DC_STRIP_BAYS):
        if r["minY"] < c - 0.3 and r["maxY"] > c + 0.3 and r["minY"] >= lo - 1.0 and r["maxY"] <= hi + 1.0:
            if cx > DC_CUT_E and lab != "DC2&3": continue        # rows F-H: 2A / 4A are poured whole
            return lab                                          # lower 8|7a strip (2A|4A) taken as part of DC2&3 (assumed)
    lo, hi = DC_ROW_BAY
    if r["minX"] < DC_CUT_E - 0.3 and r["maxX"] > DC_CUT_E + 0.3 and r["minX"] >= lo - 1.0 and r["maxX"] <= hi + 1.0:
        return "DC1,2&2A" if (r["minY"] + r["maxY"]) / 2 < DC_CUTS[1][0] else "DC3,4&4A"
    return ""
def near_perimeter(x, y, tol=4.0):
    return min(abs(x - PER["W"]), abs(x - PER["E"]), abs(y - PER["S"]), abs(y - PER["N"])) <= tol or inbox(x, y, WALL_NOTCH)
def cw_zone(x, y):
    if inbox(x, y, WALL_NOTCH): return 8
    d = {"W": abs(x - PER["W"]), "E": abs(x - PER["E"]), "S": abs(y - PER["S"]), "N": abs(y - PER["N"])}
    side = min(d, key=d.get); along = y if side in ("E", "W") else x
    for ub, z in CW_ZONES[side]:
        if along <= ub: return z
def ugs_zone(x, y):
    best, bd = None, 1e9
    for z, rects in UGS_W.items():
        for x0, y0, x1, y1 in rects:
            dx = max(x0 - x, 0, x - x1); dy = max(y0 - y, 0, y - y1); dd = (dx * dx + dy * dy) ** .5
            if dd < bd: best, bd = z, dd
    return best, bd

STEEL_KEYS = ("STEEL", "ISA", "RHS", "SHS", "UC-", "DOUBLE ANGLE", "CHEQURED", "CHQD", "BASE_PLATE", "CIRCULAR HOLLOW")
def element_group(r):
    cls, name, com, ws = r["Class"], (r["Name"] or "").upper(), norm(r["Comments"]), r["Workset"]
    if cls == "IfcBuildingElementProxy" and "OPENING" in name: return "Openings/Sleeves"
    if cls.startswith("IfcFlow") or ws in UG_WORKSETS or "CHAMBER" in name or "MANHOLE" in name or "CHAMBER" in com: return "UG Services"
    if any(k in name for k in STEEL_KEYS) or ws == "STRC_STEEL" or cls == "IfcMember": return "Structural Steel"
    if cls in ("IfcStairFlight", "IfcStair", "IfcRamp", "IfcRampFlight", "IfcRailing") or "STAIR" in name: return "Staircase"
    if "BRICK" in com or "BRICK" in name or "BLOCK" in name: return "Blockwork"
    if "PCC" in name: return "PCC"
    if cls == "IfcFooting": return "Footings"
    if cls == "IfcColumn": return "Columns"
    if cls in ("IfcWall", "IfcWallStandardCase"): return "Walls"
    if cls in ("IfcSlab", "IfcRoof", "IfcPlate", "IfcBeam"): return "Slab"   # PT beams are cast with the slab
    return "Other"

# ---------------------------------------------------------------- classify
A = {r["GlobalId"]: r for r in csv.DictReader(open(os.path.join(D, "elements_xy.csv"), encoding="utf-8"))}
B = {r["GlobalId"]: r for r in csv.DictReader(open(os.path.join(D, "bbox.csv")))}
GIS_BLD_N1 = 2108018.5      # north edge of GIS building (grid GA..GE, 22.3 m deep); beyond = transformer yard

rows = []
for gid, a in A.items():
    r = dict(a); out = dict.fromkeys(("VL_Building", "VL_Module", "VL_SubZone", "VL_Level", "VL_ElementGroup",
                                      "VL_Basis", "VL_Status", "VL_Flag"), "")
    b = B.get(gid)
    if not b:
        out["VL_Status"] = "No geometry"; rows.append({**r, **out}); continue
    for k in ("minX", "minY", "minZ", "maxX", "maxY", "maxZ"): r[k] = float(b[k])
    x, y, top = (r["minX"] + r["maxX"]) / 2, (r["minY"] + r["maxY"]) / 2, r["maxZ"]
    com, ws, name = norm(r["Comments"]), r["Workset"], (r["Name"] or "").upper()
    grp = element_group(r)
    is_ug = grp == "UG Services"

    if inbox(x, y, DC_BOX) and not is_ug and "COMPOUND" not in com:
        out.update(VL_Building="DC Building", VL_Level=level_of(top, LEVELS), VL_Basis="grid: DC pour plan")
        lvl = out["VL_Level"]
        n_cuts = sum(r["minY"] < c - 1 and r["maxY"] > c + 1 for c, _, _ in DC_CUTS)
        if n_cuts >= 2:                                   # one element across 3+ modules (e.g. whole-floor PCC / slab)
            out["VL_Module"] = "Multiple modules"; out["VL_Flag"] = "Element spans several modules - split it in Revit or link manually"
            if "CANOPY" in com: grp = "Canopy/Trellis"
        elif y < GN["13"] - 1.5 and r["Class"] == "IfcBeam":       # loading-dock canopy south of grid 13
            out["VL_Module"] = dc_module(x, GN["13"]); grp = "Canopy/Trellis"
        elif lvl == "GF":                                 # substructure: DC-1..4 strips, A = rows A-E, B = rows F-H
            out["VL_Module"] = dc_strip(y); out["VL_SubZone"] = out["VL_Module"].replace("-", "") + ("A" if x < DC_CUT_E else "B")
            out["VL_Flag"] = "Substructure A/B = rows A-E / F-H (assumed)"
            if grp == "PCC": grp = "Footing PCC" if top < 8.0 else "Grade PCC"
            elif r["Class"] == "IfcSlab" and top > 9.3 and grp == "Slab": grp = "Grade Slab"
            elif r["Class"] == "IfcBeam" and grp == "Slab": grp = "Plinth Beam"
            elif grp in ("Columns", "Slab", "Footings"): grp = "Footings"
        elif lvl == "AT" and (top > CHILLER_TOP or "CHILLER" in com):
            out["VL_Module"] = dc_strip(y); grp = "Chiller Platform"
        else:
            out["VL_Module"] = dc_module(x, y)
            if lvl == "AT" and grp == "Walls": grp = "Parapet Wall"
            elif lvl == "AT" and grp in ("Slab", "Columns"): grp = "Mumty/LMR"
            elif "CANOPY" in com or "TRELLIS" in name: grp = "Canopy/Trellis"
            elif lvl in ("1F", "2F", "3F", "4F", "TF") and grp == "Slab":
                ps = dc_pour_strip(r)
                if ps: out["VL_SubZone"] = f"PST {ps}"; grp = "Pour Strip"
                elif (r["maxY"] - r["minY"]) > 15 or (r["maxX"] - r["minX"]) > 15:
                    out["VL_Flag"] = "Long member spans more than one module - assigned by centre point"
    elif inbox(x, y, DG_BOX) and not is_ug and "COMPOUND" not in com:
        out.update(VL_Building="DG Building", VL_Module="DG-1" if y >= DG_CUT_N else "DG-2",
                   VL_Level=level_of(top, LEVELS), VL_Basis="grid: DG split at 7b")
        if out["VL_Level"] == "GF":
            if grp == "PCC": grp = "Footing PCC" if top < 8.0 else "Grade PCC"
            elif r["Class"] == "IfcBeam" and grp == "Slab": grp = "Plinth Beam"
            elif grp in ("Columns", "Slab", "Footings"): grp = "Footings"
            out["VL_Flag"] = "DG A/B sub-zone split unknown"
        elif out["VL_Level"] == "AT":
            grp = "Parapet Wall" if grp == "Walls" else ("Mumty/LMR" if grp in ("Slab", "Columns") else grp)
    elif inbox(x, y, GIS_BOX) and not is_ug:
        if y <= GIS_BLD_N1:
            out.update(VL_Building="GIS", VL_Level=level_of(top, GIS_LEVELS), VL_Basis="footprint: GIS building")
            if out["VL_Level"] == "SS" and grp in ("Columns", "Slab", "Walls", "Footings"): grp = "Substructure"
            elif out["VL_Level"] == "SS" and grp == "PCC": grp = "Substructure PCC"
            if out["VL_Level"] == "AT": grp = "Mumty" if grp != "Walls" else "Parapet Wall"
        else:
            out.update(VL_Building="GIS", VL_Module="GIS_Transformer Yard", VL_Basis="footprint: transformer yard")
    elif inbox(x, y, HSD_BOX) and not is_ug:
        hsd = [c for c in (2108168.0, 2108252.0)]
        out.update(VL_Building="Ancillary Structures", VL_Module="AS_HSD Yard", VL_Basis="footprint: HSD yard (east of DG)")
        if y <= 2108256:
            out["VL_SubZone"] = "H1" if y >= mid(*hsd) else "H2"; out["VL_Flag"] = "HSD H1 = north half (assumed)"
        else:
            out["VL_SubZone"] = "Pump Shade"
    elif inbox(x, y, PUMP_BOX) and not is_ug and not near_perimeter(x, y, 2.0):
        out.update(VL_Building="Ancillary Structures", VL_Module="AS_Pump Room", VL_Basis="footprint: pump house & UGT")
        if grp == "Slab" or grp == "PCC": grp = "Raft/PCC" if (grp == "PCC" or top < 6.5) else "Slab & Beam"
        if grp == "Walls": out["VL_Flag"] = "UGT wall A/B/C and lift split unknown - linked to all wall tasks"
    elif inbox(x, y, SEC_BOX) and not is_ug:
        out.update(VL_Building="Ancillary Structures", VL_Module="Security Block / NANO Canopy", VL_Basis="footprint: security block")
        if grp in ("Slab", "Columns", "Walls", "Footings", "PCC"): grp = "Foundation" if top < 9.5 else "Superstructure"
    elif inbox(x, y, OWC_STP_BOX) and not is_ug:
        out.update(VL_Building="Ancillary Structures", VL_Module="OWC" if "OWC" in com else "AS_STP", VL_Basis="footprint: OWC / STP")
    elif "COMPOUND WALL" in com or (ws in ("STRC_EXT COLUMN", "STRC_EXT FRAMING", "STRC_EXT FOUNDATION", "STRC_EXT UG SERVICE")
                                     and near_perimeter(x, y)):
        out.update(VL_Building="External Development", VL_Module="Boundary Wall", VL_SubZone=f"ED_Zone {cw_zone(x, y)}",
                   VL_Basis="slide: CW zones (approx)")
        grp = "Boundary Wall"
    elif is_ug:
        z, dist = ugs_zone(x, y)
        sub = ugs_sub(z, x, y)
        out.update(VL_Building="External Development", VL_Module="UG Services", VL_SubZone=f"UGS Zone {z}{sub}",
                   VL_Basis="slide: UGS zones + sub-zone dividers (approx)" if sub else "slide: UGS zones (approx)")
        if sub: out["VL_Flag"] = "UGS sub-zone side assumed (A = west/north of the slide's divider)"
        if dist > 15: out["VL_Flag"] = f"UGS zone = nearest ({dist:.0f} m away)"
    out["VL_ElementGroup"] = grp if out["VL_Building"] else element_group(r)
    rows.append({**r, **out})

# ---------------------------------------------------------------- schedule index
tasks = json.load(open(os.path.join(D, "tasks.json"), encoding="utf-8"))
idx = collections.defaultdict(list)
OPS = r"(?:Reinforcement(?: & PT)? works|Formwork works|Formwork Arrangement|Formwork Shifting|Concreting works)"
def add(key, eid): idx[key].append(eid)
for t in tasks:
    ti = re.sub(r"\s+", " ", (t["title"] or "")).strip(); eid = t["externalId"]
    if m := re.match(r"^(\dF|TF)-(DC\d A?|DC\dA?|DG\d) - " + OPS + r" ?- ?(Columns?|Walls|Slab)$", ti):
        lvl, mod, grp = m.groups(); mod = mod.replace(" ", ""); grp = "Columns" if grp.startswith("Column") else grp
        add(("DC Building" if mod.startswith("DC") else "DG Building", lvl, mod[:2] + "-" + mod[2:], grp), eid)
    elif m := re.match(r"^(\dF|TF)-(DC[\d,&A]+) - Pour Strip (?:Casting|Stressing)$", ti):
        add(("DC Building", m.group(1), "PST", m.group(2)), eid)
    elif m := re.match(r"^GF-(DC\d) - (?:Reinforcement|Formwork|Concreting) works$", ti):
        add(("DC Building", "GF", m.group(1)[:2] + "-" + m.group(1)[2:], "Grade Slab"), eid)
    elif m := re.match(r"^(DC\d)([AB]) - (Footings|Plinth Beam) - ", ti):
        add(("DC Building", "GF", m.group(1)[:2] + "-" + m.group(1)[2:], m.group(3), m.group(1) + m.group(2)), eid)
    elif m := re.match(r"^DG ?(\d)([AB])? - (?:Reinforcement|Formwork|Concreting|ATT & PCC) works", ti):
        add(("DG Building", "GF", f"DG-{m.group(1)}", "Substructure"), eid)
    elif m := re.match(r"^Chiller Platform (DC\d) - ", ti):
        add(("DC Building", "AT", "DC-" + m.group(1)[2:], "Chiller Platform"), eid)
    elif m := re.match(r"^(DC\d) - Parapet Wall - ", ti):
        add(("DC Building", "AT", "DC-" + m.group(1)[2:], "Parapet Wall"), eid)
    elif m := re.match(r"^DG Parapet Wall - ", ti):
        add(("DG Building", "AT", "", "Parapet Wall"), eid)
    elif m := re.match(r"^GIS - (\dF|TF)(?:-GIS)? - " + OPS + r" - (Columns?|Column \w+ Lift|Slab|Parapet)$", ti):
        lvl, grp = m.groups(); grp = "Columns" if grp.startswith("Column") else ("Parapet Wall" if grp == "Parapet" else grp)
        add(("GIS", lvl, "", grp), eid)
    elif re.match(r"^GIS Substructure - (?:Reinforcement|Formwork|Concreting) works$", ti):
        add(("GIS", "SS", "", "Substructure"), eid)
    elif re.match(r"^GIS Parapet Wall - ", ti):
        add(("GIS", "TF", "", "Parapet Wall"), eid)
    elif m := re.match(r"^GIS Mumty - .* - (?:Reinforcement|Formwork|Concreting) works - ", ti):
        add(("GIS", "AT", "", "Mumty"), eid)
    elif re.match(r"^GIS - TRFM-YRD - ", ti):
        add(("GIS", "", "GIS_Transformer Yard", ""), eid)
    elif m := re.match(r"^Boundary Wall - Zone (\d+) - ", ti):
        add(("External Development", "", "Boundary Wall", f"ED_Zone {m.group(1)}"), eid)
    elif m := re.match(r"^UGS - .* - Zone (\d+)([A-D])$", ti):
        add(("External Development", "", "UG Services", f"UGS Zone {m.group(1)}"), eid)                  # whole zone
        add(("External Development", "", "UG Services", f"UGS Zone {m.group(1)}{m.group(2)}"), eid)     # one sub-zone
    elif m := re.match(r"^HSD (?:Ext Wall |Foundation |)(H?\d) - (?:Reinforcement|Formwork|Concreting|ATT, PCC) works$", ti):
        add(("Ancillary Structures", "", "AS_HSD Yard", "H" + m.group(1).lstrip("H")), eid)
    elif re.match(r"^HSD Pump Shade - ", ti):
        add(("Ancillary Structures", "", "AS_HSD Yard", "Pump Shade"), eid)
    elif m := re.match(r"^(DC\d) - PCC works$", ti):
        add(("DC Building", "GF", "DC-" + m.group(1)[2:], "Grade PCC"), eid)
    elif m := re.match(r"^(DC\d)([AB]) - Footings - ATT & PCC works", ti):
        add(("DC Building", "GF", "DC-" + m.group(1)[2:], "Footing PCC", m.group(1) + m.group(2)), eid)
    elif m := re.match(r"^DG(\d) - PCC works$", ti):
        add(("DG Building", "GF", f"DG-{m.group(1)}", "Grade PCC"), eid)
    elif re.match(r"^GIS Substructure - (?:ATT and PCC|PCC works)$", ti):
        add(("GIS", "SS", "", "Substructure PCC"), eid)
    elif re.match(r"^UGT - Column (?:Reinforcement|Formwork|Concreting) works$", ti):
        add(("Ancillary Structures", "", "AS_Pump Room", "Columns"), eid)
    elif re.match(r"^UGT - \w+ Lift Wall [A-C] - ", ti):
        add(("Ancillary Structures", "", "AS_Pump Room", "Walls"), eid)
    elif re.match(r"^UGT - Slab & Beam - ", ti):
        add(("Ancillary Structures", "", "AS_Pump Room", "Slab & Beam"), eid)
    elif eid.startswith("CS-UGT-C-PR-FDN"):
        add(("Ancillary Structures", "", "AS_Pump Room", "Raft/PCC"), eid)
    elif re.match(r"^STP - (?:Reinforcement|Formwork|Concreting|ATT and PCC) works$", ti):
        add(("Ancillary Structures", "", "AS_STP", "STRUCT"), eid)
    elif m := re.match(r"^Security Block - (?:Reinforcement|Formwork|Concreting) works$", ti):
        add(("Ancillary Structures", "", "Security Block / NANO Canopy", "Foundation" if "-FDC-" in eid else "Superstructure"), eid)
    elif re.match(r"^OWC - (?:Reinforcement|Formwork|Concreting|ATT & PCC)", ti):
        add(("Ancillary Structures", "", "OWC", ""), eid)
    elif re.match(r"^Covered Canopy -NANO Entry/ Exit - (?:Reinforcement|Formwork|Concreting|ATT & PCC)", ti):
        add(("Ancillary Structures", "", "Security Block / NANO Canopy", ""), eid)

def lookup(r):
    b, lvl, mod, grp, sub = (r[k] for k in ("VL_Building", "VL_Level", "VL_Module", "VL_ElementGroup", "VL_SubZone"))
    m2 = mod.replace("-", "")
    if b in ("DC Building", "DG Building") and lvl in ("1F", "2F", "3F", "4F", "TF"):
        if grp == "Pour Strip": return idx.get((b, lvl, "PST", sub[4:]), []), f"{lvl}-PST-{sub[4:]}"
        if grp in ("Columns", "Walls", "Slab"): return idx.get((b, lvl, mod, grp), []), f"{lvl}-{m2}-{grp}"
    if b == "DC Building" and lvl == "GF":
        if grp in ("Grade Slab", "Grade PCC"): return idx.get((b, "GF", mod, grp), []), f"GF-{m2}-{grp.replace(' ', '')}"
        if grp in ("Footings", "Plinth Beam", "Footing PCC"): return idx.get((b, "GF", mod, grp, sub), []), f"SS-{sub}-{grp.replace(' ', '')}"
    if b == "DG Building" and lvl == "GF":
        if grp in ("Footings", "Plinth Beam"): return idx.get((b, "GF", mod, "Substructure"), []), f"SS-{m2}-{grp.replace(' ', '')}"
        if grp == "Grade PCC": return idx.get((b, "GF", mod, grp), []), f"GF-{m2}-GradePCC"
    if b == "Ancillary Structures" and mod == "AS_STP" and grp in ("Slab", "Columns", "Walls", "Footings", "PCC"):
        return idx.get((b, "", mod, "STRUCT"), []), f"STP-{grp}"
    if b == "Ancillary Structures" and mod in ("AS_Pump Room", "Security Block / NANO Canopy"):
        ids = idx.get((b, "", mod, grp), [])
        return ids, f"{'UGT' if mod == 'AS_Pump Room' else 'SecurityBlock'}-{grp.replace(' ', '').replace('/', '-').replace('&', 'and')}"
    if b == "DC Building" and grp in ("Chiller Platform", "Parapet Wall"):
        key_mod = mod if mod in ("DC-1", "DC-2", "DC-3", "DC-4") else dc_strip((r["minY"] + r["maxY"]) / 2)
        return idx.get((b, "AT", key_mod, grp), []), f"AT-{key_mod.replace('-', '')}-{grp.replace(' ', '')}"
    if b == "DG Building" and grp == "Parapet Wall": return idx.get((b, "AT", "", grp), []), "AT-DG-ParapetWall"
    if b == "GIS" and mod == "GIS_Transformer Yard": return idx.get((b, "", mod, ""), []), "GIS-TransformerYard"
    if b == "GIS": return idx.get((b, lvl, "", grp), []), f"{lvl}-GIS-{grp.replace(' ', '').replace('/', '')}"
    if mod in ("Boundary Wall", "UG Services"):
        zn = re.match(r"(\d+)([A-D]?)", sub.split()[-1])
        return idx.get((b, "", mod, sub), []), ("CW-" if mod == "Boundary Wall" else "UGS-") + f"Zone{int(zn.group(1)):02d}{zn.group(2)}"
    if b == "Ancillary Structures":
        return idx.get((b, "", mod, sub), []), f"{mod.replace('AS_', '').replace(' ', '').replace('/', '-')}{'-' + sub.replace(' ', '') if sub else ''}"
    lv = f"{lvl}-" if lvl else ""
    return [], f"{lv}{m2 or b.replace(' ', '')}-{grp.replace(' ', '').replace('/', '-')}" if b else ""

for r in rows:
    if not r["VL_Building"]:
        r["VL_WorkPackage"] = ""; r["VL_ActivityIDs"] = ""
        r["VL_Status"] = r["VL_Status"] or "Unassigned"; continue
    ids, wp = lookup(r)
    r["VL_WorkPackage"] = wp; r["VL_ActivityIDs"] = ";".join(sorted(set(ids), key=lambda s: [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", s)]))
    r["VL_Status"] = "Linked" if ids else "No schedule task"
    if r["VL_Module"] == "UG Services" and ids and not r["VL_SubZone"][-1].isalpha(): r["VL_Flag"] =(r["VL_Flag"] + "; " if r["VL_Flag"] else "") + "UGS sub-zone A/B/C not in layouts - linked to all"

# ---------------------------------------------------------------- VisiLean location path
loc = json.load(open(os.path.join(D, "locations.json"), encoding="utf-8"))
roots = loc if isinstance(loc, list) else loc.get("locations", loc)
P = []
def walk(n, pre):
    p = pre + [n["title"]]; P.append(" > ".join(p[1:]))
    for c in n.get("children") or []: walk(c, p)
for rt in roots: walk(rt, [])
def find(*rx):
    c = [p for p in P if all(re.search(x, p, re.I) for x in rx)]
    return min(c, key=len) if c else ""
LV = {"1F": "First Floor$", "2F": "Second Floor$", "3F": "Third Floor$", "4F": "Fourth Floor$", "TF": "Terrace Floor$", "AT": "Above Terrace$"}
cache = {}
for r in rows:
    key = tuple(r[k] for k in ("VL_Building", "VL_Module", "VL_Level", "VL_ElementGroup", "VL_SubZone"))
    if key not in cache:
        b, mod, lvl, grp, sub = key; p = ""
        if b in ("DC Building", "DG Building") and mod:
            base = rf"> {b} > {b.split()[0]} Building_{re.escape(mod)}( |$)"
            if lvl == "GF":
                if b == "DC Building" and mod == "DC-1": p = find(base, r"DC-1%s-%s$" % (sub[-1], "Footings" if grp == "Footings" else "Ground Floor")) if grp in ("Footings", "Grade Slab") else find(base, "Plinth$")
                else: p = find(base, {"Footings": "Footings?$", "Plinth Beam": "Plinth$", "Grade Slab": "Ground Floor$"}.get(grp, "Substruc"))
            elif grp == "Staircase": p = find(base, "Staircase$")
            elif lvl in LV: p = find(base, LV[lvl])
            p = p or find(base + "$") or find(rf"> {b}$")
        elif b == "GIS":
            p = find(r"GIS_Transformer Yard$") if mod else find(r"> GIS > ", {"1F": "First Floor$", "2F": "Second Floor$", "TF": "Terrace Floor$", "AT": "Above Terrace$", "SS": "GIS_Substructure$"}.get(lvl, "^$")) or find(r"> GIS$")
        elif mod == "Boundary Wall": p = find(r"Boundary Wall > " + re.escape(sub) + "$") or find("Boundary Wall$")
        elif b == "External Development": p = find(r"> External Development$")
        elif mod == "AS_HSD Yard" and sub in ("H1", "H2"): p = find(r"AS_HSD Yard > Foundation > " + sub + "$")
        elif b == "Ancillary Structures": p = find(re.escape(mod) + "$") or find(r"> Ancillary Structures$")
        cache[key] = p
    r["VL_Location"] = cache[key]

# ---------------------------------------------------------------- write
fields = ["GlobalId", "Class", "Name", "Storey", "Workset", "Comments", "Mark", "minX", "minY", "minZ", "maxX", "maxY", "maxZ",
          "VL_Building", "VL_Module", "VL_SubZone", "VL_Level", "VL_ElementGroup", "VL_Location", "VL_WorkPackage",
          "VL_ActivityIDs", "VL_Status", "VL_Basis", "VL_Flag"]
for r in rows:
    for k in ("minX", "minY", "minZ", "maxX", "maxY", "maxZ"):
        if isinstance(r.get(k), float): r[k] = round(r[k], 3)
with open(OUT, "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
C = collections.Counter
print("elements:", len(rows), "| linked:", sum(r["VL_Status"] == "Linked" for r in rows),
      "| GIS building north edge:", round(GIS_BLD_N1, 1))
for k in ("VL_Building", "VL_Status", "VL_Module", "VL_ElementGroup"):
    print(f"\n{k}:", C(r[k] for r in rows).most_common(30))
print("\nempty VL_Location among assigned:", sum(1 for r in rows if r["VL_Building"] and not r["VL_Location"]))
