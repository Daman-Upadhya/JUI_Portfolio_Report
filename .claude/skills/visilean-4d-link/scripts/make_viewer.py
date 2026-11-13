"""
Step 5 - build the 4D check viewer (single HTML file) from the mapping + schedule snapshot.

Usage: python make_viewer.py <work_dir> <viewer_template.html> <out.html> --title "JUI01 4D Link Viewer"
         --heading "JUI01 Linked Model" --project "TPL - JUI01 Data Center" --model "JUI1-..._Linked.ifc"
The model is drawn as one box per element (its world bounding box). Task dates/status come from
work_dir/tasks.json (the snapshot pulled by fetch_schedule.py).
"""
import sys, os, csv, json, time, argparse, datetime as dt

ap = argparse.ArgumentParser(); ap.add_argument("work_dir"); ap.add_argument("template"); ap.add_argument("out")
ap.add_argument("--title", default="4D Link Viewer"); ap.add_argument("--heading", default="Linked Model")
ap.add_argument("--project", default=""); ap.add_argument("--model", default="")
a = ap.parse_args()
W, TPL, OUT = a.work_dir, a.template, a.out
R = [r for r in csv.DictReader(open(os.path.join(W, "vl_link_mapping.csv"), encoding="utf-8-sig")) if r["minX"]]
T = {t["externalId"]: t for t in json.load(open(os.path.join(W, "tasks.json"), encoding="utf-8"))}
snap = dt.datetime.fromtimestamp(os.path.getmtime(os.path.join(W, "tasks.json"))).strftime("%d %b %Y")

E0 = min(float(r["minX"]) for r in R); N0 = min(float(r["minY"]) for r in R)
dicts = {k: [] for k in ("b", "m", "s", "l", "g", "w", "st", "c", "loc", "fl")}
idx = {k: {} for k in dicts}
def code(k, v):
    if v not in idx[k]: idx[k][v] = len(dicts[k]); dicts[k].append(v)
    return idx[k][v]

task_list, task_ix = [], {}
def tix(eid):
    if eid not in task_ix:
        t = T.get(eid, {})
        task_ix[eid] = len(task_list)
        task_list.append([eid, t.get("title") or "", (t.get("startDate") or 0) // 86400000,
                          (t.get("endDate") or 0) // 86400000, t.get("status") or ""])
    return task_ix[eid]
wp_tasks = {}

box, attrs, guid, name, skipped = [], [], [], [], 0
for r in R:
    x0, y0, z0, x1, y1, z1 = (float(r[k]) for k in ("minX", "minY", "minZ", "maxX", "maxY", "maxZ"))
    if (x1 - x0) * (y1 - y0) > 2500 or z1 - z0 > 80:      # whole-site sheets / stray geometry - not drawable as a box
        skipped += 1; continue
    # viewer axes: x = Easting, y = height, z = -Northing   (decimetres)
    box += [round((x0 - E0) * 10), round(z0 * 10), round((N0 - y1) * 10),
            max(1, round((x1 - x0) * 10)), max(1, round((z1 - z0) * 10)), max(1, round((y1 - y0) * 10))]
    wp = r["VL_WorkPackage"]
    if wp and wp not in wp_tasks:
        wp_tasks[wp] = [tix(e) for e in r["VL_ActivityIDs"].split(";") if e]
    attrs += [code("b", r["VL_Building"]), code("m", r["VL_Module"]), code("s", r["VL_SubZone"]), code("l", r["VL_Level"]),
              code("g", r["VL_ElementGroup"]), code("w", wp), code("st", r["VL_Status"]), code("c", r["Class"]),
              code("loc", r["VL_Location"]), code("fl", r["VL_Flag"])]
    guid.append(r["GlobalId"]); name.append(r["Name"])

data = {"meta": {"snapshot": snap, "project": a.project, "model": a.model,
                 "E0": round(E0, 3), "N0": round(N0, 3), "count": len(guid), "skipped": skipped},
        "dict": dicts, "box": box, "attr": attrs, "guid": guid, "name": name,
        "wpTasks": [wp_tasks.get(w, []) for w in dicts["w"]], "tasks": task_list}
js = json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
html = (open(TPL, encoding="utf-8").read().replace("/*__VL_DATA__*/null", js)
        .replace("__VL_TITLE__", a.title).replace("__VL_HEADING__", a.heading))
open(OUT, "w", encoding="utf-8").write(html)
print(f"elements {len(guid)} (skipped {skipped}), work packages {len(dicts['w'])}, tasks {len(task_list)}, "
      f"html {os.path.getsize(OUT) / 1e6:.1f} MB")
