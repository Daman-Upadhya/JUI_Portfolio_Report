# -*- coding: utf-8 -*-
"""Checks before anything is published.

    main("all" | "project" | "landing", keys)   configs + built pages in dist/
    selftest()                                  calculation.py on a hand-checked synthetic case
"""
from __future__ import annotations

import json
import os
import re
from datetime import date

from . import DIST_DIR
from .build import discover_projects, forbidden_strings, load_calculation, read_json

SECRET_PATTERNS = [re.compile(p, re.I) for p in (r"accessToken", r"[0-9a-f]{32,}", r"[\w.%+-]+@[\w.-]+\.[a-z]{2,}")]


def _check_page(path: str, forbidden: list[str], problems: list[str]) -> None:
    if not os.path.exists(path):
        problems.append("%s is missing" % os.path.relpath(path, DIST_DIR))
        return
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if re.search(r"\{\{[A-Z][A-Z0-9_]*\}\}", text):
        problems.append("%s has an unfilled template slot" % path)
    low = text.lower()
    for s in forbidden:
        if s and s.lower() in low:
            problems.append("%s contains forbidden content (%s...)" % (path, s[:6]))
    for p in SECRET_PATTERNS:
        if p.search(text):
            problems.append("%s matches %s" % (path, p.pattern))


def main(scope: str, keys: list[str] | None = None) -> int:
    problems: list[str] = []
    projects = discover_projects(keys if scope == "project" else None)
    for cfg in projects:
        if not cfg.get("projectId"):
            problems.append("%s/project.json has no projectId" % cfg["key"])
    if scope in ("all", "project"):
        for cfg in projects:
            d = os.path.join(DIST_DIR, cfg["key"])
            _check_page(os.path.join(d, "index.html"), forbidden_strings(cfg), problems)
            if os.path.isdir(os.path.join(d, "tables")):
                for name in os.listdir(os.path.join(d, "tables")):
                    _check_page(os.path.join(d, "tables", name), forbidden_strings(cfg), problems)
            bj = os.path.join(d, "build.json")
            if not os.path.exists(bj):
                problems.append("%s/build.json is missing" % cfg["key"])
            elif read_json(bj).get("state") not in ("fresh", "stale", "unavailable"):
                problems.append("%s/build.json has an unknown state" % cfg["key"])
    if scope in ("all", "landing"):
        _check_page(os.path.join(DIST_DIR, "index.html"), [], problems)
    for p in problems:
        print("::error::%s" % p)
    print("validate: %s" % ("ok" if not problems else "%d problem(s)" % len(problems)))
    return 1 if problems else 0


def _row(guid, **kw):
    base = {"guid": guid, "parent": False, "taskType": "Construction", "status": "Not Ready", "taskId": guid,
            "taskName": "T" + guid, "location": "", "customField": None, "quantityUnits": "Nos",
            "totalQuantity": 0.0, "actualQuantity": 0.0, "historyDateTime": "",
            "plannedStartDate": " ", "plannedEndDate": " ", "actualStartDate": " ", "actualEndDate": " "}
    base.update(kw)
    return base


def forecast_ok(calc, t, m) -> bool:
    by = {x["guid"]: x for x in t["tasks"]}
    calc.apply_forecast(m, t["tasks"], [])                     # no master schedule: Schedule Finish
    first = (by["A"]["forecastFinish"], by["A"]["forecastSource"], by["B"]["forecastFinish"]) == ("2026-03-17", "schedule", None)
    by["A"]["joinKey"] = "k"
    calc.apply_forecast(m, t["tasks"], [{"match": "both", "joinKey": "k", "baselineEnd": "2026-02-01"}])
    fa = next(f for f in m["facts"]["tasks"] if f["id"] == "A")
    by["A"]["joinKey"] = None
    return first and (by["A"]["forecastFinish"], by["A"]["forecastSource"], fa["fc"], fa["fs"]) == ("2026-02-01", "baseline", "2026-02-01", "baseline")


def scurve_checks(calc, data: dict, today, linked: list[dict]) -> list:
    """S-curve rules on a synthetic master schedule, joined to the quantity case above."""
    sdata = {**data, "scurve": {"weightField": "W", "groupField": "G", "phaseField": "Ph"}}
    rows = [
        _row("P1", parent=True, customField={"W": "50"}),                                         # parent: dropped
        # complete, weight 10 over a 5-day baseline, 2 actual days; joins task A (DC Building_DC-1, Footing-PCC)
        _row("M1", status="Complete", location="DC Building_DC-1", percentComplete=100, historyDateTime="01/01/2026 10:00:00",
             customField={"W": "10", "G": "Civil", "Subtrade": "Footing - PCC", "LAP Plan": "DC PCC-1"},
             baselineStartDate="01/01/2026 06:00:00", baselineEndDate="05/01/2026 06:00:00",
             actualStartDate="02/01/2026 05:30:00", actualEndDate="03/01/2026 05:30:00"),
        _row("M1", status="Complete", location="DC Building_DC-1", percentComplete=100, historyDateTime="02/01/2026 10:00:00",
             plannedStartDate="01/01/2026 00:00:00", plannedEndDate="05/01/2026 00:00:00",
             customField={"W": "10", "G": "Civil", "Subtrade": "Footing - PCC", "LAP Plan": "DC PCC-1"},
             baselineStartDate="01/01/2026 06:00:00", baselineEndDate="05/01/2026 06:00:00",
             actualStartDate="02/01/2026 05:30:00", actualEndDate="03/01/2026 05:30:00"),
        # started at 40%, weight 30 over a 10-day baseline, actual from the 6th to today (5 days)
        _row("M2", status="Started", location="GIS", percentComplete=40, customField={"W": "30", "G": "MEP"},
             baselineStartDate="03/01/2026 00:00:00", baselineEndDate="12/01/2026 00:00:00", actualStartDate="06/01/2026 00:00:00",
             plannedStartDate="03/01/2026 00:00:00", plannedEndDate="12/01/2026 00:00:00"),
        _row("M3", customField={"W": "0"}),                                                        # no weight: off the curve
    ]
    linked = [dict(t, lapPlan="DC PCC-1", joinKey=calc.join_key(t["area"], t["subLocation"], t["subtrade"], "DC PCC-1")) if t["guid"] == "A" else t for t in linked]
    st = calc.build_scurve_tables(rows, sdata, today, linked)
    sm = calc.compute_scurve(st, sdata, today)
    by = {t["guid"]: t for t in st["master"]}
    jr = {r["match"]: r for r in st["join"]}
    tot = sm["totals"]
    return [
        (sorted(by) == ["M1", "M2", "M3"], "S-curve master: parents dropped, one row per guid"),
        (by["M2"]["earnedWeightage"] == 12.0, "earned weightage = weightage x % complete"),
        (len([r for r in st["baseline"] if r["guid"] == "M1"]) == 5, "baseline spreads over every baseline day"),
        (abs(sum(r["baselineWeightage"] for r in st["baseline"]) - 40) < 1e-9, "baseline table sums to the weightage"),
        (len([r for r in st["actual"] if r["guid"] == "M2"]) == 5 and abs(sum(r["earnedWeightage"] for r in st["actual"]) - 22) < 1e-9,
         "actual spreads earned weightage, open tasks to today"),
        (tot["weightage"] == 40 and tot["actualPct"] == 55.0, "actual % = earned / total weightage with a baseline"),
        (len([r for r in st["planned"] if r["guid"] == "M2"]) == 10 and abs(sum(r["plannedWeightage"] for r in st["planned"]) - 40) < 1e-9,
         "planned spreads weightage over planned start..end"),
        (tot["plannedPct"] == 85.0, "planned % to date counts planned days up to today"),
        (tot["baselinePct"] == 85.0, "baseline % to date counts baseline days up to today (10 + 30 x 8/10 of 40)"),
        (jr.get("both", {}).get("linkedActivities") == 1 and jr["both"]["weightage"] == 10, "join on area | sub-location | subtrade | LAP Plan"),
        (not calc.scurve_invariants(st, sm), "S-curve invariants hold"),
    ]


def selftest() -> int:
    calc = load_calculation()
    data = read_json(os.path.join(os.path.dirname(os.path.dirname(__file__)), "Template", "dashboard_data.json"))
    today = date(2026, 1, 10)
    rows = [
        _row("P", parent=True, totalQuantity=99.0),                                       # parent: dropped
        _row("D", taskType="Design", totalQuantity=99.0),                                 # design: dropped
        # complete, 4 planned days, 2 actual days, history event twice -> one task
        _row("A", status="Complete", location="DC Building_DC-1", customField={"Subtrade": "Footing - PCC", "Schedule Start": "5-Jan-26", "Schedule Finish": "17-Mar-26"},
             quantityUnits="Nos.", totalQuantity=8.0, actualQuantity=6.0, historyDateTime="01/01/2026 10:00:00",
             plannedStartDate="01/01/2026 08:00:00", plannedEndDate="04/01/2026 17:00:00",
             actualStartDate="02/01/2026 00:00:00", actualEndDate="03/01/2026 00:00:00"),
        _row("A", status="Complete", location="DC Building_DC-1", customField={"Subtrade": "Footing - PCC", "Schedule Start": "5-Jan-26", "Schedule Finish": "17-Mar-26"},
             quantityUnits="Nos.", totalQuantity=8.0, actualQuantity=6.0, historyDateTime="02/01/2026 10:00:00",
             activityHistory="Task 'TA' started late by Site Engineer. Note added:  Manpower",
             plannedStartDate="01/01/2026 08:00:00", plannedEndDate="04/01/2026 17:00:00",
             actualStartDate="02/01/2026 00:00:00", actualEndDate="03/01/2026 00:00:00"),
        # started on the 6th: actual runs to today (5 days)
        _row("B", status="Started", location="GIS", customField={"Subtrade": "Footing-PCC"}, quantityUnits="RMT",
             totalQuantity=10.0, actualQuantity=5.0, plannedStartDate="05/01/2026 00:00:00",
             plannedEndDate="09/01/2026 00:00:00", actualStartDate="06/01/2026 00:00:00"),
        # not started, overdue, no subtrade, no location
        _row("C", totalQuantity=3.0, plannedStartDate="08/01/2026 00:00:00", plannedEndDate="08/01/2026 00:00:00"),
    ]
    t = calc.build_tables(rows, data, today)
    m = calc.compute(t, data, today)
    by = {x["guid"]: x for x in t["tasks"]}
    facts = {f["id"]: f for f in m["facts"]["tasks"]}
    fa, fc = facts["A"], facts["C"]
    checks = [
        (len(t["raw"]) == 6, "Table 1 keeps every row"),
        (sorted(by) == ["A", "B", "C"], "Table 2 drops parents and Design, de-duplicates by guid"),
        (by["A"]["subtrade"] == "Footing-PCC" == by["B"]["subtrade"], "subtrade spacing normalised"),
        (by["A"]["unit"] == "Nos" and by["B"]["unit"] == "Rmt", "unit aliases applied"),
        ((by["A"]["area"], by["A"]["subLocation"]) == ("DC Building", "DC-1"), "location split on _"),
        ((by["B"]["area"], by["B"]["subLocation"]) == ("GIS", "Whole area"), "location without delimiter"),
        ([calc.split_location(v, data["location"]) for v in ("SS_DC-2A", "DC Building_DC-4", "DC Building", "ED_Zone 3", "AS_Pump Room", "dg2", "GIS_Transformer Yard")] ==
         [("DC Building", "DC-2A"), ("DC Building", "DC-4"), ("DC Building", "Whole area"), ("External Development", "Zone 3"),
          ("Ancillary Structures", "Pump Room"), ("DG Building", "DG-2"), ("GIS", "Transformer Yard")],
         "area from a DC / DG token anywhere in the location, then the prefix with its alias"),
        (by["C"]["area"] == "Unassigned" and by["C"]["subtrade"] == "Unassigned", "blanks are Unassigned"),
        (by["A"]["variance"] == 2.0, "variance = total - actual"),
        ((by["A"]["scheduleStart"], by["A"]["scheduleFinish"]) == ("2026-01-05", "2026-03-17"), "Schedule Start / Finish custom fields parsed (d-Mon-yy)"),
        (by["B"]["scheduleStart"] is None, "missing schedule date stays empty"),
        ([str(calc.parse_date(v)) for v in ("15-Mar-2026", "1-June-26", "3-Sept-26", "31-Feb-26")] == ["2026-03-15", "2026-06-01", "2026-09-03", "None"], "hand-typed schedule dates parsed, impossible ones rejected"),
        (len([r for r in t["planned"] if r["guid"] == "A"]) == 4, "Table 3: 4 planned days for A"),
        (abs(sum(r["plannedQty"] for r in t["planned"]) - 21.0) < 1e-9, "Table 3 sums to total quantity"),
        (len([r for r in t["actual"] if r["guid"] == "A"]) == 2, "Table 4: complete A spans 2 actual days"),
        (len([r for r in t["actual"] if r["guid"] == "B"]) == 5, "Table 4: started B runs to today"),
        (abs(sum(r["actualQty"] for r in t["actual"]) - 11.0) < 1e-9, "Table 4 sums to actual quantity"),
        (not any(r["guid"] == "C" for r in t["actual"]), "Table 4 skips not-started tasks"),
        (m["totals"]["overdue"] == 2, "overdue = not complete with planned end before today"),
        (not calc.invariants(t, m), "invariants hold"),
        (forecast_ok(calc, t, m), "forecast finish: JUI-1A baseline end via the join key, else Schedule Finish, else none"),
        (by["A"]["_history"] == [["2026-01-02T10:00", "late", "Started late by Site Engineer", "Manpower"]], "history event parsed and classified"),
        (fa["sd"] == 1 and fa["fd"] == -1, "A started 1 day late, finished 1 day early"),
        (fc["sd"] == 2 and fc["fd"] == 2, "C not started: 2 days overdue so far"),
    ]
    checks += scurve_checks(calc, data, today, t["tasks"])
    bad = [msg for ok, msg in checks if not ok]
    for ok, msg in checks:
        print("%s %s" % ("ok  " if ok else "FAIL", msg))
    print("selftest: %s" % ("passed" if not bad else "%d failed" % len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(selftest())
