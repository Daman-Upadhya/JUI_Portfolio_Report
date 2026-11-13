"""
Write the VL_Link property set into a COPY of the IFC.

Usage: python write_ifc.py <source.ifc> <vl_link_mapping.csv> <target.ifc>

- The source file is never modified.
- Each element gets its own IfcPropertySet "VL_Link" (any existing VL_Link set is replaced),
  so re-running after a schedule or rule change simply refreshes the values.
- The original Revit "VisiLean" pset (Workset / Comments / Mark) is left untouched.
"""
import sys, csv, time
import ifcopenshell, ifcopenshell.guid

SRC, MAP, DST = sys.argv[1:4]
PROPS = [  # (property name, csv column, IFC value type, description)
    ("VL_Building",     "VL_Building",     "IfcLabel", "VisiLean building / area"),
    ("VL_Module",       "VL_Module",       "IfcLabel", "Pour module / sub-area (DC-1, DG-2, AS_HSD Yard ...)"),
    ("VL_SubZone",      "VL_SubZone",      "IfcLabel", "Sub-zone (DC1A, PST DC1&2, ED_Zone 7, UGS Zone 5, H1 ...)"),
    ("VL_Level",        "VL_Level",        "IfcLabel", "Schedule level code (GF, 1F..4F, TF, AT, SS)"),
    ("VL_ElementGroup", "VL_ElementGroup", "IfcLabel", "Schedule element group (Columns, Walls, Slab, Pour Strip ...)"),
    ("VL_Location",     "VL_Location",     "IfcText",  "Exact VisiLean location path"),
    ("VL_WorkPackage",  "VL_WorkPackage",  "IfcLabel", "Stable link key, e.g. 1F-DC1-Columns"),
    ("VL_ActivityIDs",  "VL_ActivityIDs",  "IfcText",  "Schedule activity IDs (externalId), ';' separated"),
    ("VL_LinkStatus",   "VL_Status",       "IfcLabel", "Linked / No schedule task / Unassigned"),
    ("VL_Basis",        "VL_Basis",        "IfcLabel", "How the zone was derived"),
    ("VL_Flag",         "VL_Flag",         "IfcText",  "Assumption or item to review"),
]
PSET = "VL_Link"

t = time.time()
m = {r["GlobalId"]: r for r in csv.DictReader(open(MAP, encoding="utf-8-sig"))}
f = ifcopenshell.open(SRC)
print("opened", round(time.time() - t), "s")
oh = f.by_type("IfcOwnerHistory")[0] if f.by_type("IfcOwnerHistory") else None

# remove an earlier VL_Link set if this file was produced by a previous run
for rel in list(f.by_type("IfcRelDefinesByProperties")):
    pd = rel.RelatingPropertyDefinition
    if pd and pd.is_a("IfcPropertySet") and pd.Name == PSET:
        props = list(pd.HasProperties); f.remove(rel); f.remove(pd)
        for p in props: f.remove(p)

n = 0
for e in f.by_type("IfcElement"):
    r = m.get(e.GlobalId)
    if not r: continue
    props = []
    for name, col, typ, desc in PROPS:
        val = (r.get(col) or "").strip()
        if not val and name not in ("VL_LinkStatus",): continue
        props.append(f.create_entity("IfcPropertySingleValue", name, None, f.create_entity(typ, val or "-"), None))
    ps = f.create_entity("IfcPropertySet", ifcopenshell.guid.new(), oh, PSET, "VisiLean schedule link", props)
    f.create_entity("IfcRelDefinesByProperties", ifcopenshell.guid.new(), oh, None, None, [e], ps)
    n += 1
print("psets written:", n, round(time.time() - t), "s")
f.write(DST)
print("saved", DST, round(time.time() - t), "s")
