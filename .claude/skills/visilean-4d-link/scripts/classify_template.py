"""
Link-rule classifier - TEMPLATE. Copy to <work>/classify_<project>.py and edit only the PROJECT RULES block.

Usage: python classify_<project>.py <work_dir> [out.csv]
Inputs (work_dir): elements_xy.csv, bbox.csv, grids.json  (extract_model.py)
                   tasks.json, locations.json               (fetch_schedule.py)
Output:            vl_link_mapping.csv - one row per element with every VL_* value (feeds write_ifc / report / viewer)

The idea in one line: every element gets WHERE (building / module / sub-zone / level) + WHAT (element group),
those make a stable work-package key, and the key is matched to schedule activities by parsing activity titles.
See examples/jui01/classify_jui01.py for a complete real rule set (DC/DG pour modules, pour strips, substructure,
GIS, ancillary footprints, compound-wall and UG-services zones).
"""
import csv, json, re, sys, collections, os

D = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, "vl_link_mapping.csv")

# ============================================================== helpers (engine - no edits needed)
GN, GE = {}, {}                     # grid tag -> Northing of a horizontal line / Easting of a vertical line (metres)
for g in json.load(open(os.path.join(D, "grids.json"))):
    k = g.get("unit_m", 0.001); (x0, y0), (x1, y1) = g["p0"], g["p1"]
    if abs(x1 - x0) < abs(y1 - y0): GE.setdefault(g["tag"], (x0 + x1) / 2 * k)
    else:                           GN.setdefault(g["tag"], (y0 + y1) / 2 * k)
mid = lambda a, b: (a + b) / 2
def inbox(x, y, b): return b[0] <= x <= b[1] and b[2] <= y <= b[3]
def level_of(top, levels, tol=0.6):
    """levels = [(code, elevation_m), ...] ascending. Code of the first level whose elevation+tol >= element top."""
    for code, el in levels:
        if top <= el + tol: return code
    return "AT"
def band(v, cuts, names):
    """cuts ascending, names has len(cuts)+1 entries: which band v falls in."""
    for c, n in zip(cuts, names):
        if v < c: return n
    return names[-1]
def px2w(x, y, px_box, world_box):
    """Map a pixel on a client slide to world metres. px_box=(x0,y0,x1,y1) of a feature on the slide,
    world_box=(E0,N0,E1,N1) of the same feature in the model (e.g. the site boundary)."""
    (a0, b0, a1, b1), (E0, N0, E1, N1) = px_box, world_box
    return E0 + (x - a0) * (E1 - E0) / (a1 - a0), N1 - (y - b0) * (N1 - N0) / (b1 - b0)
def norm(s): return (s or "").strip().upper()

# ============================================================== PROJECT RULES  (edit everything in this block)
# 1. Floor levels (metres, absolute) - read the peaks in profile.md "Element top height" and storeys.csv.
LEVELS = [("GF", 9.70), ("1F", 17.20), ("2F", 24.70), ("3F", 32.20), ("4F", 39.70), ("TF", 47.20)]

# 2. Buildings / areas: footprint boxes (E0, E1, N0, N1) in metres, ideally built from grid lines.
#    Example: BUILDINGS = {"DC Building": (GE["A"] - 4, GE["H"] + 4, GN["13"] - 4, GN["1"] + 4)}
BUILDINGS = {}

# 3. Element group = the noun the schedule uses ("Columns", "Walls", "Slab", "Footings", "Cable Tray" ...).
def element_group(r):
    cls, name = r["Class"], (r["Name"] or "").upper()
    if cls == "IfcColumn": return "Columns"
    if cls in ("IfcWall", "IfcWallStandardCase"): return "Walls"
    if cls in ("IfcSlab", "IfcBeam", "IfcPlate", "IfcRoof"): return "Slab"     # PT beams poured with the slab
    if cls == "IfcFooting": return "Footings"
    if cls in ("IfcStairFlight", "IfcStair", "IfcRamp", "IfcRampFlight", "IfcRailing"): return "Staircase"
    return "Other"

# 4. Where is the element?  Return the VL_* dict (empty VL_Building = unassigned).
def assign(r, x, y, top):
    out = dict(VL_Building="", VL_Module="", VL_SubZone="", VL_Level="", VL_ElementGroup=element_group(r), VL_Basis="", VL_Flag="")
    for b, box in BUILDINGS.items():
        if inbox(x, y, box):
            out.update(VL_Building=b, VL_Level=level_of(top, LEVELS), VL_Basis=f"footprint: {b}")
            # module / sub-zone examples:
            #   out["VL_Module"] = band(y, [mid(GN["10"], GN["9b"]), mid(GN["8"], GN["7a"])], ["DC-1", "DC-2", "DC-3"])
            break
    return out

# 5. Schedule parser: (regex on the activity TITLE, function(match, externalId) -> index key).
#    The key must equal what work_package() below builds from an element. Keep regexes anchored (^...$).
OPS = r"(?:Reinforcement(?: & PT)? works|Formwork works|Formwork Arrangement|Formwork Shifting|Concreting works)"
SCHEDULE_PATTERNS = [
    # "1F-DC1 - Concreting works - Columns"  ->  ("1F", "DC-1", "Columns")
    (r"^(\dF|TF)-([A-Z]{2})(\d+A?) - " + OPS + r" ?- ?(Columns?|Walls|Slab)$",
     lambda m, eid: (m.group(1), f"{m.group(2)}-{m.group(3)}", "Columns" if m.group(4).startswith("Column") else m.group(4))),
]

# 6. Element -> (index key, work-package name). The work package is the stable link key written to the model.
def work_package(r):
    if r["VL_Level"] and r["VL_Module"] and r["VL_ElementGroup"] in ("Columns", "Walls", "Slab"):
        return (r["VL_Level"], r["VL_Module"], r["VL_ElementGroup"]), f'{r["VL_Level"]}-{r["VL_Module"].replace("-", "")}-{r["VL_ElementGroup"]}'
    lv = f'{r["VL_Level"]}-' if r["VL_Level"] else ""
    return None, (f'{lv}{(r["VL_Module"] or r["VL_Building"]).replace(" ", "").replace("-", "")}-{r["VL_ElementGroup"]}' if r["VL_Building"] else "")

# 7. VisiLean location path: regexes that must all match one path in the location tree (shortest match wins).
def location_regexes(r):
    if not r["VL_Building"]: return []
    rx = [re.escape(r["VL_Building"])]
    if r["VL_Module"]: rx.append(re.escape(r["VL_Module"]))
    names = {"GF": "Ground Floor$", "1F": "First Floor$", "2F": "Second Floor$", "3F": "Third Floor$", "4F": "Fourth Floor$",
             "TF": "Terrace Floor$", "AT": "Above Terrace$"}
    if r["VL_Level"] in names: rx.append(names[r["VL_Level"]])
    return rx
# ============================================================== END OF PROJECT RULES

# ============================================================== engine
A = {r["GlobalId"]: r for r in csv.DictReader(open(os.path.join(D, "elements_xy.csv"), encoding="utf-8"))}
B = {r["GlobalId"]: r for r in csv.DictReader(open(os.path.join(D, "bbox.csv")))}
rows = []
for gid, a in A.items():
    r = dict(a); b = B.get(gid)
    if not b:
        rows.append({**r, **dict.fromkeys(("VL_Building", "VL_Module", "VL_SubZone", "VL_Level", "VL_ElementGroup", "VL_Basis", "VL_Flag"), ""),
                     "VL_Status": "No geometry"}); continue
    for k in ("minX", "minY", "minZ", "maxX", "maxY", "maxZ"): r[k] = round(float(b[k]), 3)
    rows.append({**r, **assign(r, (r["minX"] + r["maxX"]) / 2, (r["minY"] + r["maxY"]) / 2, r["maxZ"])})

idx = collections.defaultdict(list)
tasks = json.load(open(os.path.join(D, "tasks.json"), encoding="utf-8"))
for t in tasks:
    ti = re.sub(r"\s+", " ", t.get("title") or "").strip()
    for rx, keyf in SCHEDULE_PATTERNS:
        m = re.match(rx, ti)
        if m:
            k = keyf(m, t["externalId"])
            for kk in (k if isinstance(k, list) else [k]): idx[kk].append(t["externalId"])
            break
natural = lambda s: [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", s)]
for r in rows:
    if not r.get("VL_Building"):
        r.update(VL_WorkPackage="", VL_ActivityIDs="", VL_Status=r.get("VL_Status") or "Unassigned"); continue
    key, wp = work_package(r)
    ids = idx.get(key, []) if key else []
    r.update(VL_WorkPackage=wp, VL_ActivityIDs=";".join(sorted(set(ids), key=natural)), VL_Status="Linked" if ids else "No schedule task")

loc = json.load(open(os.path.join(D, "locations.json"), encoding="utf-8"))
P = []
def walk(n, pre):
    p = pre + [n["title"]]; P.append(" > ".join(p[1:]))
    for c in n.get("children") or []: walk(c, p)
for rt in (loc if isinstance(loc, list) else loc.get("locations", loc)): walk(rt, [])
cache = {}
for r in rows:
    rx = tuple(location_regexes(r))
    if rx not in cache:
        c = [p for p in P if rx and all(re.search(x, p, re.I) for x in rx)]
        cache[rx] = min(c, key=len) if c else ""
    r["VL_Location"] = cache[rx]

fields = ["GlobalId", "Class", "Name", "Storey", "Workset", "Comments", "Mark", "minX", "minY", "minZ", "maxX", "maxY", "maxZ",
          "VL_Building", "VL_Module", "VL_SubZone", "VL_Level", "VL_ElementGroup", "VL_Location", "VL_WorkPackage",
          "VL_ActivityIDs", "VL_Status", "VL_Basis", "VL_Flag"]
with open(OUT, "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
C = collections.Counter
print(f"elements: {len(rows)} | linked: {sum(r['VL_Status'] == 'Linked' for r in rows)} | schedule keys indexed: {len(idx)}")
for k in ("VL_Building", "VL_Status", "VL_Module", "VL_Level", "VL_ElementGroup"):
    print(f"{k}:", C(r.get(k, "") for r in rows).most_common(20))
print("no location path:", sum(1 for r in rows if r.get("VL_Building") and not r["VL_Location"]))
