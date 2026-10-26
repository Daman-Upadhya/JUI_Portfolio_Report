"""IFC -> a light web model for the S-curve page's site model card (Template/scripts/ifcview.js).

Run by hand when the model changes (it needs ifcopenshell, which the refresh does not; the IFC
itself is never committed, only what this writes):

    python -m pip install ifcopenshell
    python -m build.ifc_model JUI

It reads display.model3d.ifc in <project>/project.json:

    "ifc": {
      "source": "JUI1-STRC_UG SERVICES_VL.ifc",            # path from the repository root
      "out": "site-model",                                    # -> <project>/model/site-model.bin/.json
      "cell": 0.12,                                           # vertex-clustering cell (m) for heavy elements
      "heavy": 300,                                           # elements above this many triangles are clustered
      "groups": [ {"key", "label", "color", "classes": [...], "name": "regex", "storey": "regex", "skip"} ... ],
      "anchors": { "<building>": "regex on storey names" }    # where the progress rings sit in 3D
    }

Groups: the first whose classes, name and storey all match takes an element; "skip" leaves it
out; neighbouring groups with the same label become one category.

What it writes:
  <out>.bin   positions (uint16 x3, fractions of the bounding box) then indices (uint32), with
              triangles sorted by category so each category is one draw range
              then one element number per vertex (uint16, or uint32 past 65,535 elements)
  <out>.json  bbox (m), vertex / index counts, categories {key, label, color, first, count,
              elements}, anchors {building: [x, y, z]} and the source file's name and date
  <out>.meta.json  per element number: name (Revit family : type), IFC class, storey and the
              properties of the `propertySet` named in the config (default "VisiLean": Workset,
              Comments, Mark), as a string table plus rows; the build links elements to tasks
              with it (calculation.bim_links) and the page shows it when an element is clicked

Openings are not cut (a simple model); spaces, grids, annotations and openings are left out.
Each element with more than `heavy` triangles is simplified by vertex clustering on a `cell` grid
(vertices in one cell merge, collapsed and repeated triangles drop), which keeps its shape at site
scale.
"""
from __future__ import annotations

import json
import multiprocessing
import os
import re
import sys
import time
from datetime import datetime

from . import ROOT


def log(msg: str) -> None:
    print(msg, flush=True)


def cluster(v, f, cell):
    """Vertex clustering: snap to a grid, merge vertices per cell, drop collapsed / repeated triangles."""
    import numpy as np
    q = np.floor(v / cell).astype(np.int64)
    key, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    sums = np.zeros((len(key), 3))
    cnt = np.zeros(len(key))
    np.add.at(sums, inv, v)
    np.add.at(cnt, inv, 1)
    nv = sums / cnt[:, None]
    nf = inv[f]
    ok = (nf[:, 0] != nf[:, 1]) & (nf[:, 1] != nf[:, 2]) & (nf[:, 0] != nf[:, 2])
    nf = nf[ok]
    if len(nf):
        _, first = np.unique(np.sort(nf, axis=1), axis=0, return_index=True)
        nf = nf[np.sort(first)]
    return nv, nf


def main(project_key: str) -> int:
    import numpy as np
    import ifcopenshell
    import ifcopenshell.geom

    pdir = os.path.join(ROOT, project_key)
    cfg = json.load(open(os.path.join(pdir, "project.json"), encoding="utf-8"))
    ic = ((cfg.get("display") or {}).get("model3d") or {}).get("ifc")
    if not ic:
        log("%s has no display.model3d.ifc in project.json" % project_key)
        return 1
    src = ic["source"] if os.path.isabs(ic["source"]) else os.path.join(ROOT, ic["source"])
    out = os.path.join(pdir, "model", ic.get("out", "site-model"))
    cell, heavy = float(ic.get("cell", 0.12)), int(ic.get("heavy", 300))
    groups = ic["groups"]
    for g in groups:
        g["_name"] = re.compile(g["name"], re.I) if g.get("name") else None
        g["_storey"] = re.compile(g["storey"], re.I) if g.get("storey") else None
        g["_classes"] = set(g.get("classes") or [])

    t = time.time()
    tmp = None
    with open(src, "rb") as fh:
        head = fh.read(4096)
    lead = head.find(b"ISO-10303-21;")
    if lead > 0:  # stray bytes before the STEP header (e.g. typed into the file by accident): read a cleaned copy
        import shutil
        import tempfile
        log("note: %d stray byte(s) before ISO-10303-21; in %s; reading a cleaned temporary copy (the file is not changed)" % (lead, os.path.basename(src)))
        fd, tmp = tempfile.mkstemp(suffix=".ifc")
        with open(src, "rb") as fi, os.fdopen(fd, "wb") as fo:
            fi.seek(lead)
            shutil.copyfileobj(fi, fo, 16 << 20)
        import atexit
        atexit.register(lambda: os.path.exists(tmp) and os.remove(tmp))  # once the model is written
    f = ifcopenshell.open(tmp or src)
    log("opened %s in %ds" % (os.path.basename(src), time.time() - t))
    storey_of = {}
    for rel in f.by_type("IfcRelContainedInSpatialStructure"):
        nm = rel.RelatingStructure.Name or ""
        for e in rel.RelatedElements:
            storey_of[e.id()] = nm
    for rel in f.by_type("IfcRelAggregates"):  # parts of an aggregate (stair and ramp flights) follow the whole
        whole = rel.RelatingObject
        if whole.id() in storey_of:
            for p in rel.RelatedObjects:
                storey_of.setdefault(p.id(), storey_of[whole.id()])

    pset_name = ic.get("propertySet", "VisiLean")
    prop_names: list[str] = []
    props_of: dict[int, dict] = {}
    for ps in f.by_type("IfcPropertySet"):
        if ps.Name != pset_name:
            continue
        vals = {}
        for pr in ps.HasProperties or ():
            if pr.is_a("IfcPropertySingleValue"):
                vals[pr.Name] = "" if pr.NominalValue is None else str(pr.NominalValue.wrappedValue).strip()
                if pr.Name not in prop_names:
                    prop_names.append(pr.Name)
        for rel in ps.PropertyDefinitionOf or ():
            for e in rel.RelatedObjects:
                props_of.setdefault(e.id(), {}).update(vals)
    log("property set %r on %d elements: %s" % (pset_name, len(props_of), ", ".join(prop_names) or "none"))

    def group_of(cls, name, storey):
        for i, g in enumerate(groups):
            if g["_classes"] and cls not in g["_classes"]:
                continue
            if g["_name"] and not g["_name"].search(name or ""):
                continue
            if g["_storey"] and not g["_storey"].search(storey or ""):
                continue
            return None if g.get("skip") else i
        return None

    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    s.set("disable-opening-subtractions", True)
    s.set("weld-vertices", True)
    it = ifcopenshell.geom.iterator(s, f, max(1, multiprocessing.cpu_count() - 2),
                                    exclude=("IfcOpeningElement", "IfcSpace", "IfcAnnotation", "IfcGrid"))
    per = [[] for _ in groups]  # per group: (verts float32, faces int64, element info)
    counts = [0] * len(groups)
    anchor_rx = {k: re.compile(v, re.I) for k, v in (ic.get("anchors") or {}).items()}
    anchor_pts: dict[str, list] = {}
    skipped, tri_in, tri_out, n = 0, 0, 0, 0
    t = time.time()
    if it.initialize():
        while True:
            sh = it.get()
            n += 1
            e = f.by_id(sh.id)
            cls, name, storey = e.is_a(), e.Name or "", storey_of.get(sh.id, "")
            gi = group_of(cls, name, storey)
            fa = np.asarray(sh.geometry.faces, dtype=np.int64).reshape(-1, 3)
            if gi is None or not len(fa):
                skipped += 1
            else:
                v = np.asarray(sh.geometry.verts, dtype=np.float64).reshape(-1, 3)  # ifcopenshell gives metres
                tri_in += len(fa)
                if len(fa) > heavy:
                    v, fa = cluster(v, fa, cell)
                if len(fa):
                    pv = props_of.get(sh.id, {})
                    info = [re.sub(r":\d+\s*$", "", name).strip(), cls, storey] + [pv.get(k, "") for k in prop_names]
                    per[gi].append((v.astype(np.float32), fa, info))
                    counts[gi] += 1
                    tri_out += len(fa)
                    for b, rx in anchor_rx.items():
                        if rx.search(storey):
                            anchor_pts.setdefault(b, []).append(((v.min(0) + v.max(0)) / 2, float(v[:, 2].max())))
            if n % 5000 == 0:
                log("  %d elements, %ds" % (n, time.time() - t))
            if not it.next():
                break
    log("tessellated %d elements in %ds: %d triangles -> %d after simplifying; %d left out" % (n, time.time() - t, tri_in, tri_out, skipped))

    allv = np.concatenate([x[0] for g in per for x in g])
    lo, hi = allv.min(0), allv.max(0)
    span = np.maximum(hi - lo, 1e-6)
    pos, ind, eid, rows, meta, base, first = [], [], [], [], [], 0, 0
    strings, sidx = [], {}

    def sid(x):
        if x not in sidx:
            sidx[x] = len(strings)
            strings.append(x)
        return sidx[x]
    for gi, g in enumerate(groups):
        if g.get("skip"):
            continue
        n0 = first
        for v, fa, info in per[gi]:
            pos.append(np.round((v - lo) / span * 65535).astype(np.uint16))
            ind.append((fa + base).astype(np.uint32))
            eid.append(np.full(len(v), len(rows), dtype=np.uint32))
            rows.append([sid(x) for x in info] + [sid(g["label"])])
            base += len(v)
            first += len(fa) * 3
        if meta and meta[-1]["label"] == g["label"] and meta[-1]["first"] + meta[-1]["count"] == n0:
            meta[-1]["count"] += first - n0  # rules sharing a label: one category
            meta[-1]["elements"] += counts[gi]
            continue
        meta.append({"key": g["key"], "label": g["label"], "color": g["color"], "first": n0, "count": first - n0,
                     "elements": counts[gi], **({"hidden": True} if g.get("hidden") else {})})
    meta = [m for m in meta if m["count"]]
    P = np.concatenate(pos)
    Ix = np.concatenate(ind).reshape(-1)  # flat: three indices per triangle
    E = np.concatenate(eid)
    E = E.astype(np.uint16) if len(rows) <= 65536 else E
    os.makedirs(os.path.dirname(out), exist_ok=True)
    pad = (-P.nbytes) % 4
    with open(out + ".bin", "wb") as fh:
        fh.write(P.tobytes())
        fh.write(b"\0" * pad)
        fh.write(Ix.tobytes())
        fh.write(E.tobytes())
    with open(out + ".meta.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"propertySet": pset_name, "fields": ["name", "class", "storey"] + prop_names + ["category"],
                   "strings": strings, "rows": rows}, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    anchors = {}
    for b, pts in anchor_pts.items():  # robust to strays: the median element centre, the 90th-percentile top
        c = np.median(np.array([x[0] for x in pts]), axis=0)
        anchors[b] = [round(float(c[0]), 2), round(float(c[1]), 2), round(float(np.percentile([x[1] for x in pts], 90)), 2)]
    idx = {"file": os.path.basename(out) + ".bin", "unit": "m",
           "bbox": [[round(float(x), 3) for x in lo], [round(float(x), 3) for x in hi]],
           "vertices": int(len(P)), "indices": int(len(Ix)), "indexOffset": int(P.nbytes + pad), "groups": meta,
           "elements": len(rows), "elementOffset": int(P.nbytes + pad + Ix.nbytes), "elementType": "u16" if E.dtype == np.uint16 else "u32",
           "meta": os.path.basename(out) + ".meta.json",
           "anchors": anchors, "view": ic.get("view") or {},
           "source": {"name": os.path.basename(src), "modified": datetime.fromtimestamp(os.path.getmtime(src)).isoformat(timespec="minutes")}}
    with open(out + ".json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(idx, fh, indent=1)
        fh.write("\n")
    log("wrote %s.bin (%.1f MB, %d vertices, %d triangles) and .json; anchors: %s"
        % (os.path.relpath(out, ROOT), os.path.getsize(out + ".bin") / 2**20, len(P), len(Ix) // 3, ", ".join(sorted(anchors)) or "none"))
    for m in meta:
        log("  %-24s %6d elements %9d triangles" % (m["label"], m["elements"], m["count"] // 3))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "JUI"))
