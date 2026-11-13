"""
Extract what the link rules need from an IFC (IFC2X3 or IFC4, any discipline). Re-run whenever the model is re-exported.

Usage: python extract_model.py <model.ifc> <work_dir>

Writes to work_dir:
  elements_xy.csv  GlobalId, Class, Name, TypeName, PredefinedType, Storey, StoreyElev, Workset, Comments, Mark, System, Tag
                   (Workset/Comments/Mark/System are taken from whichever property set carries them - Revit exports
                    put them in different sets depending on the exporter settings)
  bbox.csv         world bounding box per element (METRES) + volume_m3 (solid volume, openings not subtracted)
  grids.json       every grid axis: tag + start/end point (model units, survey coordinates)
  storeys.csv      storey name + elevation (metres)
  psets.csv        property-set / property names with counts - read this to find useful link properties
Runtime: about 10-15 min for a 450 MB model (the bounding-box pass is the slow part).
"""
import sys, os, csv, json, time, collections, multiprocessing
import numpy as np
import ifcopenshell, ifcopenshell.geom
import ifcopenshell.util.placement as up, ifcopenshell.util.element as ue, ifcopenshell.util.unit as uu

SRC, W = sys.argv[1], sys.argv[2]
os.makedirs(W, exist_ok=True)
t = time.time()
f = ifcopenshell.open(SRC)
scale = uu.calculate_unit_scale(f)            # model length unit -> metres
print(f"opened {round(time.time() - t)} s | schema {f.schema} | 1 model unit = {scale} m", flush=True)

grids = []
for g in f.by_type("IfcGrid"):
    M = up.get_local_placement(g.ObjectPlacement)
    for kind, axes in (("U", g.UAxes), ("V", g.VAxes), ("W", g.WAxes or [])):
        for a in axes or []:
            c = a.AxisCurve
            if c.is_a("IfcPolyline"):
                w = [(M @ np.array(list(p.Coordinates) + [0] * (3 - len(p.Coordinates)) + [1]))[:2].tolist() for p in c.Points]
                grids.append({"grid": g.Name, "kind": kind, "tag": a.AxisTag, "p0": w[0], "p1": w[-1], "unit_m": scale})
json.dump(grids, open(os.path.join(W, "grids.json"), "w"))

with open(os.path.join(W, "storeys.csv"), "w", newline="", encoding="utf-8") as fh:
    wr = csv.writer(fh); wr.writerow(["Storey", "Elevation_m", "GlobalId"])
    for s in sorted(f.by_type("IfcBuildingStorey"), key=lambda s: s.Elevation or 0):
        wr.writerow([s.Name, round((s.Elevation or 0) * scale, 3), s.GlobalId])

KEYS = {"Workset": ("Workset",), "Comments": ("Comments",), "Mark": ("Mark",),
        "System": ("System Name", "SystemName", "System Classification", "System Type")}
pset_count = collections.Counter()
els = [e for e in f.by_type("IfcElement") if not e.is_a("IfcOpeningElement")]
with open(os.path.join(W, "elements_xy.csv"), "w", newline="", encoding="utf-8") as fh:
    wr = csv.writer(fh)
    wr.writerow(["GlobalId", "Class", "Name", "TypeName", "PredefinedType", "Storey", "StoreyElev", "Workset", "Comments", "Mark", "System", "Tag"])
    for e in els:
        st = ue.get_container(e); ty = ue.get_type(e); ps = ue.get_psets(e)
        vals = {}
        for pn, props in ps.items():
            for k in props:
                if k != "id": pset_count[(pn, k)] += 1
            for out, names in KEYS.items():
                if out not in vals:
                    for n in names:
                        if props.get(n) not in (None, ""): vals[out] = props[n]; break
        wr.writerow([e.GlobalId, e.is_a(), e.Name, ty.Name if ty else "", getattr(e, "PredefinedType", "") or "",
                     st.Name if st else "", round((getattr(st, "Elevation", 0) or 0) * scale, 3) if st else "",
                     vals.get("Workset", ""), vals.get("Comments", ""), vals.get("Mark", ""), vals.get("System", ""), getattr(e, "Tag", "") or ""])
with open(os.path.join(W, "psets.csv"), "w", newline="", encoding="utf-8") as fh:
    wr = csv.writer(fh); wr.writerow(["PropertySet", "Property", "Elements"])
    for (pn, k), n in pset_count.most_common(): wr.writerow([pn, k, n])
print("attributes", len(els), round(time.time() - t), "s", flush=True)

s = ifcopenshell.geom.settings(); s.set("use-world-coords", True); s.set("disable-opening-subtractions", True)
it = ifcopenshell.geom.iterator(s, f, multiprocessing.cpu_count(), include=els)
with open(os.path.join(W, "bbox.csv"), "w", newline="") as fh:
    wr = csv.writer(fh); wr.writerow(["GlobalId", "minX", "minY", "minZ", "maxX", "maxY", "maxZ", "volume_m3"]); n = 0
    if it.initialize():
        while True:
            sh = it.get(); v = np.array(sh.geometry.verts).reshape(-1, 3)   # geometry iterator output is already in metres
            if len(v):
                # signed-tetrahedron volume about the element's OWN centre: survey coordinates (~2,000 km from the
                # origin) make the origin-based formula blow up on any small mesh gap. Openings are not subtracted.
                try:
                    fc = np.array(sh.geometry.faces).reshape(-1, 3); w = v - v.mean(0)
                    vol = abs(np.einsum("ij,ij->i", w[fc[:, 0]], np.cross(w[fc[:, 1]], w[fc[:, 2]])).sum() / 6)
                    bv = float(np.prod(v.max(0) - v.min(0)))
                    if vol > bv * 1.02 + 1e-3: vol = ""                  # open mesh - volume not trustworthy
                except Exception: vol = ""
                wr.writerow([sh.guid] + [round(x, 3) for x in (*v.min(0), *v.max(0))] + [round(vol, 4) if vol != "" else ""])
            n += 1
            if n % 2000 == 0: print("bbox", n, "/", len(els), round(time.time() - t), "s", flush=True)
            if not it.next(): break
print("done", round(time.time() - t), "s")
