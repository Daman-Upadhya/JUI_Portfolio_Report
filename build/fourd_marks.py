"""Element marks for the 4D viewer's name links (Template/calculation.py fourd_name_links).

The 4D viewer (made by the visilean-4d-link skill) knows each element's GlobalId but not its Revit
Mark. Schedule activities without an external ID are named by mark (DC1-2F-C70, GIS-2F-C12-1st Lift,
DC1A-3F-LW4 ...), so the build needs GlobalId -> Mark. The IFC is too big for the repository, so this
reads it once and writes the marks of the viewer's elements to a small JSON file next to the viewer.
Run it again whenever the model or the viewer is regenerated:

    python -m build.fourd_marks "JUI1-STRC_UG SERVICES_VL.ifc" JUI/fourd/JUI01_4D_Viewer.html
    -> JUI/fourd/element_marks.json   {"marks": {GlobalId: Mark}}
"""
import json
import os
import re
import sys
import time


def viewer_guids(path: str) -> set[str]:
    html = open(path, encoding="utf-8").read()
    m = re.search(r'<script type="application/json" id="vl-data">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit("no vl-data block in " + path)
    return set(json.loads(m.group(1))["guid"])


def main(ifc_path: str, viewer: str, out: str | None = None) -> None:
    import ifcopenshell
    import ifcopenshell.util.element as ue
    out = out or os.path.join(os.path.dirname(viewer), "element_marks.json")
    want = viewer_guids(viewer)
    t0 = time.time()
    f = ifcopenshell.open(ifc_path)
    print("opened %s in %.0f s" % (ifc_path, time.time() - t0))
    marks = {}
    for e in f.by_type("IfcElement"):
        if e.GlobalId not in want:
            continue
        for props in ue.get_psets(e).values():  # Mark from whichever property set carries it
            v = props.get("Mark")
            if v not in (None, ""):
                marks[e.GlobalId] = str(v).strip()
                break
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"source": os.path.basename(ifc_path), "marks": dict(sorted(marks.items()))}, fh, ensure_ascii=False, separators=(",", ":"))
    print("%d of %d viewer elements have a mark -> %s (%.0f s)" % (len(marks), len(want), out, time.time() - t0))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(*sys.argv[1:4])
