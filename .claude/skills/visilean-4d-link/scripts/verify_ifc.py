"""Check a linked IFC against its source and the mapping CSV.
Usage: python verify_ifc.py <source.ifc> <linked.ifc> <vl_link_mapping.csv>"""
import sys, csv, collections, random
import ifcopenshell, ifcopenshell.util.element as ue
SRC, DST, MAP = sys.argv[1:4]
m = {r["GlobalId"]: r for r in csv.DictReader(open(MAP, encoding="utf-8-sig"))}
a, b = ifcopenshell.open(SRC), ifcopenshell.open(DST)
print("schema:", a.schema, "->", b.schema)
for cls in ("IfcElement", "IfcBuildingStorey", "IfcProject", "IfcGrid"):
    print(f"{cls}: {len(a.by_type(cls))} -> {len(b.by_type(cls))}")
ea = {e.GlobalId: e for e in a.by_type("IfcElement")}; eb = {e.GlobalId: e for e in b.by_type("IfcElement")}
print("same element GUIDs:", set(ea) == set(eb))
errors, have, other_changed = 0, 0, 0
random.seed(1); sample = random.sample(sorted(eb), 3000)
COL = {"VL_LinkStatus": "VL_Status"}
for g in sample:
    pb = ue.get_psets(eb[g]); pa = ue.get_psets(ea[g])
    vl = pb.get("VL_Link")
    if not vl: continue
    have += 1
    for k, v in vl.items():
        if k == "id": continue
        exp = (m[g].get(COL.get(k, k)) or "").strip() or "-"
        if v != exp: errors += 1; print("MISMATCH", g, k, repr(v), repr(exp)) if errors < 10 else None
    pb2 = {k: {kk: vv for kk, vv in d.items() if kk != "id"} for k, d in pb.items() if k != "VL_Link"}
    pa2 = {k: {kk: vv for kk, vv in d.items() if kk != "id"} for k, d in pa.items()}
    if pa2 != pb2: other_changed += 1
print(f"sample {len(sample)}: with VL_Link {have}, value mismatches {errors}, elements whose other psets changed {other_changed}")
print("total elements with VL_Link:", sum(1 for e in b.by_type("IfcElement") if "VL_Link" in ue.get_psets(e, psets_only=True)))
print("status counts:", collections.Counter(ue.get_pset(e, "VL_Link", "VL_LinkStatus") for e in b.by_type("IfcElement")).most_common())
