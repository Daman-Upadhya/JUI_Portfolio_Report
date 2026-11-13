"""
Export dashboard-ready tables from a VL_Link mapping + VisiLean schedule snapshot.

Usage:
  python export_dashboard_data.py <work_dir> <out_dir> [--volumes <bbox.csv with volume_m3>] [--project "TPL - JUI01 Data Center"]

Reads  work_dir/vl_link_mapping.csv, work_dir/tasks.json (+ volume_m3 from bbox.csv if available)
Writes out_dir/
  elements.csv           one row per model element (IFC GlobalId) with every VL_* value, volume, bounding box
  element_activity.csv   bridge: GlobalId <-> ActivityID (many-to-many)            <- the join table
  activities.csv         one row per linked VisiLean activity: dates, API status, VisiLean status + colour,
                         linked element count and volume
  work_packages.csv      one row per VL_WorkPackage: where/what, elements, volume, activities, rolled-up status, dates
  status_palette.csv     VisiLean status lifecycle: API values -> label, colour, rank
  dashboard_data.json    the same tables in one JSON file (for web dashboards)
  meta.json              project, snapshot time, counts
  DATA_CONTRACT.md       how the tables join, the status roll-up rule, refresh rules, example queries
The status columns are a SNAPSHOT. For live dashboards, refresh activities from the VisiLean API by ActivityID
(= task externalId); the element/bridge tables only change when the model or the link rules change.
"""
import csv, json, os, sys, argparse, datetime as dt, collections, shutil

ap = argparse.ArgumentParser()
ap.add_argument("work_dir"); ap.add_argument("out_dir")
ap.add_argument("--volumes", default=""); ap.add_argument("--project", default="")
a = ap.parse_args(); W, O = a.work_dir, a.out_dir
os.makedirs(O, exist_ok=True)

M = list(csv.DictReader(open(os.path.join(W, "vl_link_mapping.csv"), encoding="utf-8-sig")))
T = {t["externalId"]: t for t in json.load(open(os.path.join(W, "tasks.json"), encoding="utf-8")) if t.get("externalId")}
snap = dt.datetime.fromtimestamp(os.path.getmtime(os.path.join(W, "tasks.json"))).isoformat(timespec="minutes")
vol = {}
vsrc = a.volumes or os.path.join(W, "bbox.csv")
if os.path.exists(vsrc):
    for r in csv.DictReader(open(vsrc)):
        if r.get("volume_m3") not in (None, ""): vol[r["GlobalId"]] = float(r["volume_m3"])

# ---- VisiLean status lifecycle (same rule as the 4D viewer)
PAL = [  # key, label, colour, rank, API values
    ("unscheduled", "Unscheduled", "#b9e3dc", 0, "(no dates)"),
    ("unassigned", "Unassigned", "#e6df37", 1, "UNPLANNED"),
    ("notready", "Not Ready", "#e6735f", 2, "NOT_READY; START_MILESTONE_NOT_COMMITTED; END_MILESTONE_NOT_COMMITTED"),
    ("ready", "Ready", "#76d64d", 3, "READY; START_MILESTONE_COMMITTED; END_MILESTONE_COMMITTED"),
    ("forceready", "Force Ready", "#9eb52e", 3, "OVERRIDDEN_READY"),
    ("start", "Start", "#4c1462", 4, "STARTED; START_MILESTONE_STARTED"),
    ("alert", "Alert", "#d8ab30", 4, "WARNING"),
    ("stopped", "Stopped", "#cc2b2b", 4, "STOPPED"),
    ("completed", "Completed", "#4bad3a", 5, "COMPLETE; END_MILESTONE_COMPLETED; END_MILESTONE_UNDER_REVIEW"),
    ("rejected", "Rejected", "#6a4dc4", 5, "QUALITY_CHECKED_REJECTED"),
    ("approved", "Approved", "#1f4a14", 6, "QUALITY_CHECKED_COMPLETE")]
P = {k: (lab, col, rank) for k, lab, col, rank, _ in PAL}
API = {v.strip(): k for k, _, _, _, vals in PAL for v in vals.split(";") if not v.startswith("(")}
def vs(t): return "unscheduled" if not t.get("startDate") else API.get(t.get("status") or "", "notready")
def rollup(keys):
    if not keys: return ""
    for k in ("stopped", "alert", "rejected"):
        if k in keys: return k
    if all(k == "approved" for k in keys): return "approved"
    if all(P[k][2] >= 5 for k in keys): return "completed"
    if any(P[k][2] >= 4 for k in keys): return "start"
    return min(keys, key=lambda k: P[k][2])
iso = lambda ms: (dt.date(1970, 1, 1) + dt.timedelta(milliseconds=ms)).isoformat() if ms else ""

# ---- tables
VL = ["VL_Building", "VL_Module", "VL_SubZone", "VL_Level", "VL_ElementGroup", "VL_Location", "VL_WorkPackage",
      "VL_ActivityIDs", "VL_Status", "VL_Basis", "VL_Flag"]
elements, bridge = [], []
act_el = collections.defaultdict(set)
for r in M:
    ids = [i for i in r["VL_ActivityIDs"].split(";") if i]
    keys = [vs(T[i]) for i in ids if i in T]
    st = rollup(keys)
    starts = [T[i]["startDate"] for i in ids if i in T and T[i].get("startDate")]
    ends = [T[i]["endDate"] for i in ids if i in T and T[i].get("endDate")]
    elements.append({"GlobalId": r["GlobalId"], "IfcClass": r["Class"], "Name": r["Name"],
                     **{k: r.get(k, "") for k in VL},
                     "ActivityCount": len(ids), "VisiLeanStatus": P[st][0] if st else "", "StatusColour": P[st][1] if st else "",
                     "PlannedStart": iso(min(starts)) if starts else "", "PlannedFinish": iso(max(ends)) if ends else "",
                     "Volume_m3": vol.get(r["GlobalId"], ""),
                     **{k: r.get(k, "") for k in ("minX", "minY", "minZ", "maxX", "maxY", "maxZ")}})
    for i in ids:
        bridge.append({"GlobalId": r["GlobalId"], "ActivityID": i}); act_el[i].add(r["GlobalId"])

wp_of = collections.defaultdict(set)
for e in elements:
    for i in e["VL_ActivityIDs"].split(";"):
        if i: wp_of[i].add(e["VL_WorkPackage"])
activities = []
for i in sorted(act_el):
    t = T.get(i, {}); k = vs(t) if t else ""
    activities.append({"ActivityID": i, "TaskGuid": t.get("taskGuid", ""), "TaskId": t.get("taskId", ""), "Title": t.get("title", ""),
                       "PlannedStart": iso(t.get("startDate")), "PlannedFinish": iso(t.get("endDate")),
                       "ApiStatus": t.get("status", ""), "VisiLeanStatus": P[k][0] if k else "", "StatusColour": P[k][1] if k else "",
                       "ElementCount": len(act_el[i]), "LinkedVolume_m3": round(sum(vol.get(g, 0) for g in act_el[i]), 3),
                       "WorkPackages": ";".join(sorted(wp_of[i]))})

wps = collections.defaultdict(list)
for e in elements:
    if e["VL_WorkPackage"]: wps[e["VL_WorkPackage"]].append(e)
work_packages = []
for wp, es in sorted(wps.items()):
    e0 = es[0]; ids = [i for i in e0["VL_ActivityIDs"].split(";") if i]
    st = rollup([vs(T[i]) for i in ids if i in T])
    work_packages.append({"WorkPackage": wp, **{k: e0[k] for k in ("VL_Building", "VL_Module", "VL_SubZone", "VL_Level", "VL_ElementGroup", "VL_Location")},
                          "Elements": len(es), "Volume_m3": round(sum(float(x["Volume_m3"] or 0) for x in es), 3),
                          "ActivityIDs": ";".join(ids), "VisiLeanStatus": P[st][0] if st else "", "StatusColour": P[st][1] if st else "",
                          "PlannedStart": min((x["PlannedStart"] for x in es if x["PlannedStart"]), default=""),
                          "PlannedFinish": max((x["PlannedFinish"] for x in es if x["PlannedFinish"]), default=""),
                          "LinkStatus": e0["VL_Status"]})
palette = [{"Key": k, "VisiLeanStatus": lab, "Colour": col, "Rank": rank, "ApiValues": vals} for k, lab, col, rank, vals in PAL]

def wcsv(name, rows):
    with open(os.path.join(O, name), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
for n, rows in (("elements.csv", elements), ("element_activity.csv", bridge), ("activities.csv", activities),
                ("work_packages.csv", work_packages), ("status_palette.csv", palette)): wcsv(n, rows)
meta = {"project": a.project, "snapshot": snap, "elements": len(elements),
        "linked_elements": sum(1 for e in elements if e["VL_Status"] == "Linked"), "activities": len(activities),
        "work_packages": len(work_packages), "bridge_rows": len(bridge), "volumes_included": bool(vol)}
json.dump(meta, open(os.path.join(O, "meta.json"), "w"), indent=2)
json.dump({"meta": meta, "elements": elements, "element_activity": bridge, "activities": activities,
           "work_packages": work_packages, "status_palette": palette},
          open(os.path.join(O, "dashboard_data.json"), "w", encoding="utf-8"), separators=(",", ":"))
here = os.path.dirname(os.path.abspath(__file__))
contract = os.path.join(here, "..", "references", "DASHBOARD_INTEGRATION.md")
if os.path.exists(contract): shutil.copy(contract, os.path.join(O, "DATA_CONTRACT.md"))
print(json.dumps(meta, indent=1))
