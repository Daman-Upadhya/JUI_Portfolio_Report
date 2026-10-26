# -*- coding: utf-8 -*-
"""Calculational logic for the JUI quantity dashboard. Pure standard library.

The task feed (type=task) has one row per history event, so a task appears once per event.
Every number on the page is derived here; the page only sums what this module emits.

  Table 1  raw          every feed row as delivered, customField flattened to "cf.<name>"
  Table 2  tasks        parent != True, taskType in data.taskTypes (Construction), one row per guid
                        (the row with the latest historyDateTime), plus derived columns:
                        subtrade (customField.Subtrade), unit (normalised), area / subLocation
                        (location split on data.location.delimiter)
  Table 3  planned/day  each Table 2 task's totalQuantity spread evenly over every calendar day
                        from plannedStartDate to plannedEndDate (both inclusive)
  Table 4  actual/day   actualQuantity spread evenly over actualStartDate..actualEndDate for
                        Complete tasks, and actualStartDate..today for Started tasks

KPIs (computed per filter context on the page from metrics.facts.tasks):
  1. per subtrade and unit: total quantity, planned to date (Table 3 up to today), actual
     quantity, variance = total - actual
  2. per area and sub-location: activities by status and quantities by unit

Entry points used by build/build.py:
  build_tables(rows, data, today) -> {"raw", "tasks", "planned", "actual"}
  write_tables(tables, out_dir, published_dir)
  compute(tables, data, today)     -> metrics embedded in the page
  invariants(tables, metrics)      -> list of problems (empty when consistent)
"""
from __future__ import annotations

import csv
import json
import os
import re
from collections import Counter
from datetime import date, datetime, timedelta

DATE_FORMATS = ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d")
# the Schedule Start / Schedule Finish custom fields are typed by hand: 11-Mar-26, 15-Mar-2026, 1-June-26, 3-Sept-26
DAY_MON_YEAR = re.compile(r"^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2}|\d{4})$")
MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}

# Table 2 columns written to CSV, in order. Table 1 keeps every feed column.
TASK_COLUMNS = [
    "guid", "taskId", "taskName", "taskType", "status", "subtrade", "lapPlan", "joinKey", "trade", "location", "area",
    "subLocation", "organisation", "owner", "emailID", "unit", "quantityUnits", "totalQuantity",
    "actualQuantity", "variance", "percentComplete", "plannedStartDate", "plannedEndDate",
    "actualStartDate", "actualEndDate", "scheduleStart", "scheduleFinish", "forecastFinish", "forecastSource", "plannedDuration", "plannedCompletionWeek",
    "actualCompletionWeek", "parentGUID", "taskPriority", "description", "notes",
]
# never published next to the page (personal data / free text that may hold it)
PRIVATE_COLUMNS = ("emailID", "description", "notes")
DAY_COLUMNS = ["date", "guid", "taskId", "taskName", "subtrade", "area", "subLocation", "unit", "status"]


# ----------------------------------------------------------------------------- parsing

def parse_dt(value) -> datetime | None:
    s = (value or "").strip() if isinstance(value, str) else ""
    if not s:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    m = DAY_MON_YEAR.match(s)
    if m and m.group(2)[:3].lower() in MONTHS:
        year = int(m.group(3)) + (2000 if len(m.group(3)) == 2 else 0)
        try:
            return datetime(year, MONTHS[m.group(2)[:3].lower()], int(m.group(1)))
        except ValueError:
            return None
    return None


def parse_date(value) -> date | None:
    d = parse_dt(value)
    return d.date() if d else None


def num(value) -> float:
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def clean_label(value, aliases: dict) -> str:
    """Collapse whitespace and spaces around hyphens, then apply the alias map."""
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    s = re.sub(r"\s*-\s*", "-", s)
    return aliases.get(s, s)


def split_location(location: str, cfg: dict) -> tuple[str, str]:
    """Location -> (area, sub-location), in this order:
      1. a building token anywhere in the value (cfg.tokenRules, e.g. DC-1 / DC-2A -> "DC Building",
         DG-1 -> "DG Building") wins, whatever prefix or suffix surrounds it: 'SS_DC-2A' and
         'DC Building_DC-2A' both give ('DC Building', 'DC-2A');
      2. otherwise split on the delimiter: 'GIS_Transformer Yard' -> ('GIS', 'Transformer Yard'),
         and a bare value is the whole area: 'GIS' -> ('GIS', 'Whole area');
      3. the area part goes through cfg.areaAliases: 'ED' -> 'External Development'."""
    loc = re.sub(r"\s+", " ", location or "").strip()
    blank = cfg.get("blank", "Unassigned")
    if not loc:
        return blank, blank
    for rule in cfg.get("tokenRules") or []:
        m = re.search(rule["pattern"], loc, re.I)
        if m:
            token = re.sub(r"[\s_]+", "-", m.group(0).strip()).upper()
            token = re.sub(r"^([A-Z]+)-?(\d)", r"\1-\2", token)  # DC1 / DC 1 / dc-1 -> DC-1
            return rule["area"], token
    area, sep, rest = loc.partition(cfg.get("delimiter", "_"))
    area = area.strip() or blank
    area = (cfg.get("areaAliases") or {}).get(area, area)
    return area, (rest.strip() if sep and rest.strip() else cfg.get("wholeArea", "Whole area"))


# ----------------------------------------------------------------------------- history

# (kind, pattern) in priority order; the first match wins. kind drives the colour on the page.
HISTORY_KINDS = [
    ("late", re.compile(r"\b(started|completed) late\b|scheduled to start late", re.I)),
    ("good", re.compile(r"\b(started|completed) (early|on time)\b", re.I)),
    ("reschedule", re.compile(r"\brescheduled\b|\b(start|end) date changed\b", re.I)),
    ("quantity", re.compile(r"\b(total|actual) changed\b", re.I)),
]
TASK_PREFIX = re.compile(r"^Task '.*?'\s+")
NOTE = re.compile(r"\bNote(?: added)?:\s*(.*)$", re.I | re.S)
EMAIL = re.compile(r"[\w.%+-]+@[\w.-]+\.[a-z]{2,}", re.I)


def history_event(r: dict) -> list:
    """[ISO datetime, kind, text without the "Task '<name>'" prefix, note]."""
    text = EMAIL.sub("[email]", re.sub(r"\s+", " ", r.get("activityHistory") or "").strip())
    kind = next((k for k, p in HISTORY_KINDS if p.search(text)), "info")
    m = NOTE.search(text)
    note = m.group(1).strip(" .,") if m else ""
    body = TASK_PREFIX.sub("", text[:m.start()] if m else text).strip(" .")
    d = parse_dt(r.get("historyDateTime"))
    return [d.isoformat(timespec="minutes") if d else "", kind, body[:1].upper() + body[1:], note]


# ----------------------------------------------------------------------------- tables

def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def join_key(area: str, sub: str, subtrade: str, lap: str) -> str | None:
    """area | sub-location | subtrade | LAP Plan, compared without case or spacing differences.
    None unless the task carries both a Subtrade and a LAP Plan (the join needs all four)."""
    if not (subtrade and lap):
        return None
    norm = lambda v: re.sub(r"\s*-\s*", "-", re.sub(r"\s+", " ", str(v or "")).strip()).lower()
    return " | ".join(norm(v) for v in (area, sub, subtrade, lap))


def table_raw(rows: list[dict]) -> list[dict]:
    """Table 1: every row, customField expanded to cf.<name>, prerequisites as JSON text."""
    out = []
    for r in rows:
        flat = {}
        for k, v in r.items():
            if k == "customField":
                for ck, cv in (v or {}).items():
                    flat["cf." + str(ck)] = cv
            elif isinstance(v, (list, dict)):
                flat[k] = json.dumps(v, ensure_ascii=False) if v else ""
            else:
                flat[k] = v
        out.append(flat)
    return out


def table_tasks(rows: list[dict], data: dict) -> list[dict]:
    """Table 2: parents and non-Construction tasks removed, de-duplicated by guid."""
    types = set(data.get("taskTypes") or ["Construction"])
    unit_alias = data.get("unitAliases") or {}
    sub_alias = data.get("subtradeAliases") or {}
    field = data.get("subtradeField", "Subtrade")
    loc_cfg = data.get("location") or {}
    sched = data.get("scheduleFields") or {}
    lap_field = data.get("lapField", "LAP Plan")
    latest: dict[str, dict] = {}
    history: dict[str, list] = {}
    for r in rows:
        if data.get("excludeParents", True) and r.get("parent") is True:
            continue
        if r.get("taskType") not in types or not r.get("guid"):
            continue
        g = r["guid"]
        if (r.get("activityHistory") or "").strip():
            history.setdefault(g, []).append(history_event(r))
        seen = latest.get(g)
        if seen is None or (parse_dt(r.get("historyDateTime")) or datetime.min) > (parse_dt(seen.get("historyDateTime")) or datetime.min):
            latest[g] = r
    out = []
    for r in latest.values():
        area, sub = split_location(r.get("location"), loc_cfg)
        tq, aq = num(r.get("totalQuantity")), num(r.get("actualQuantity"))
        t = {k: r.get(k) for k in TASK_COLUMNS if k in r}
        for k in ("plannedStartDate", "plannedEndDate", "actualStartDate", "actualEndDate"):
            d = parse_date(r.get(k))
            t[k] = d.isoformat() if d else None
        cf = r.get("customField") or {}
        subtrade = clean_label(cf.get(field), sub_alias)
        lap = re.sub(r"\s+", " ", str(cf.get(lap_field) or "")).strip()
        t.update({
            "subtrade": subtrade or data.get("noSubtrade", "Unassigned"),
            "lapPlan": lap or None,
            "joinKey": join_key(area, sub, subtrade, lap),
            "unit": clean_label(r.get("quantityUnits"), unit_alias) or data.get("noUnit", "No unit"),
            "area": area, "subLocation": sub,
            "scheduleStart": _iso(parse_date((r.get("customField") or {}).get(sched.get("start", "Schedule Start")))),
            "scheduleFinish": _iso(parse_date((r.get("customField") or {}).get(sched.get("finish", "Schedule Finish")))),
            "totalQuantity": tq, "actualQuantity": aq, "variance": round(tq - aq, 6),
            "_history": sorted(history.get(r["guid"], []), key=lambda e: e[0]),
        })
        out.append(t)
    out.sort(key=lambda t: (t["plannedStartDate"] or "", str(t.get("taskId") or "")))
    return out


def _spread(task: dict, start: date, end: date, qty: float, key: str) -> list[dict]:
    if end < start:
        end = start
    days = (end - start).days + 1
    per = qty / days
    base = {k: task.get(k) for k in DAY_COLUMNS if k != "date"}
    return [{"date": (start + timedelta(i)).isoformat(), **base, key: per} for i in range(days)]


def actual_window(task: dict, today: date) -> tuple[date, date] | None:
    """Complete: actual start..actual end. Started: actual start..today. Otherwise none."""
    a_s = date.fromisoformat(task["actualStartDate"]) if task.get("actualStartDate") else None
    if not a_s:
        return None
    if task.get("status") == "Complete" and task.get("actualEndDate"):
        return a_s, date.fromisoformat(task["actualEndDate"])
    if task.get("status") == "Started":
        return a_s, max(a_s, today)
    return None


def table_planned(tasks: list[dict]) -> list[dict]:
    """Table 3: total quantity per day over the planned window."""
    out = []
    for t in tasks:
        if t.get("plannedStartDate") and t.get("plannedEndDate"):
            out += _spread(t, date.fromisoformat(t["plannedStartDate"]), date.fromisoformat(t["plannedEndDate"]),
                           t["totalQuantity"], "plannedQty")
    return out


def table_actual(tasks: list[dict], today: date) -> list[dict]:
    """Table 4: actual quantity per day over the actual window."""
    out = []
    for t in tasks:
        w = actual_window(t, today)
        if w:
            out += _spread(t, w[0], w[1], t["actualQuantity"], "actualQty")
    return out


def build_tables(rows: list[dict], data: dict, today: date) -> dict:
    tasks = table_tasks(rows, data)
    return {"raw": table_raw(rows), "tasks": tasks, "planned": table_planned(tasks), "actual": table_actual(tasks, today)}


# ----------------------------------------------------------------------------- output

def _write_csv(path: str, rows: list[dict], columns: list[str] | None = None) -> None:
    if columns is None:
        columns, seen = [], set()
        for r in rows:
            for k in r:
                if k not in seen:
                    seen.add(k)
                    columns.append(k)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items()})


TABLE_FILES = {
    "raw": "table1_raw.csv",
    "tasks": "table2_tasks.csv",
    "planned": "table3_planned_daily.csv",
    "actual": "table4_actual_daily.csv",
}


def write_tables(tables: dict, out_dir: str, published_dir: str | None = None) -> None:
    """All four tables to out_dir (local / CI artifact). Tables 2-4 also to published_dir,
    without the private columns; Table 1 is never published."""
    _write_csv(os.path.join(out_dir, TABLE_FILES["raw"]), tables["raw"])
    _write_csv(os.path.join(out_dir, TABLE_FILES["tasks"]), tables["tasks"], TASK_COLUMNS)
    _write_csv(os.path.join(out_dir, TABLE_FILES["planned"]), tables["planned"], DAY_COLUMNS + ["plannedQty"])
    _write_csv(os.path.join(out_dir, TABLE_FILES["actual"]), tables["actual"], DAY_COLUMNS + ["actualQty"])
    if published_dir:
        public = [c for c in TASK_COLUMNS if c not in PRIVATE_COLUMNS]
        _write_csv(os.path.join(published_dir, TABLE_FILES["tasks"]), tables["tasks"], public)
        _write_csv(os.path.join(published_dir, TABLE_FILES["planned"]), tables["planned"], DAY_COLUMNS + ["plannedQty"])
        _write_csv(os.path.join(published_dir, TABLE_FILES["actual"]), tables["actual"], DAY_COLUMNS + ["actualQty"])


# ----------------------------------------------------------------------------- metrics

def delay_days(planned: str | None, actual: str | None, today: date) -> int | None:
    """Days late (+) or early (-) against plan. Without an actual date: days overdue so far
    once the planned date has passed, else None (not due yet)."""
    if not planned:
        return None
    p = date.fromisoformat(planned)
    if actual:
        return (date.fromisoformat(actual) - p).days
    return (today - p).days if today > p else None


def status_group(status: str, data: dict) -> str:
    return (data.get("statusGroups") or {}).get(status, "notStarted")


def compute(tables: dict, data: dict, today: date) -> dict:
    """The page payload. facts.tasks carries one row per Table 2 task with its daily planned
    rate (pr) over [ps, pe] and daily actual rate (ar) over [as, ax]; summing pr / ar over a
    date range reproduces Table 3 / Table 4 for any filter, so the page never re-derives."""
    tasks = tables["tasks"]
    facts = []
    for t in tasks:
        ps, pe = t.get("plannedStartDate"), t.get("plannedEndDate")
        pdays = (date.fromisoformat(pe) - date.fromisoformat(ps)).days + 1 if ps and pe else 0
        if pdays < 1 and ps:
            pe, pdays = ps, 1
        w = actual_window(t, today)
        adays = (w[1] - w[0]).days + 1 if w else 0
        facts.append({
            "id": t.get("taskId"), "n": t.get("taskName"), "st": t["subtrade"], "u": t["unit"],
            "a": t["area"], "sl": t["subLocation"], "s": t.get("status"), "g": status_group(t.get("status"), data),
            "tq": t["totalQuantity"], "aq": t["actualQuantity"], "pc": t.get("percentComplete"),
            "ps": ps, "pe": pe, "pr": (t["totalQuantity"] / pdays) if pdays else 0,
            "as": t.get("actualStartDate"), "ae": t.get("actualEndDate"),
            "ax": w[1].isoformat() if w else None, "ar": (t["actualQuantity"] / adays) if adays else 0,
            "od": bool(pe and pe < today.isoformat() and t.get("status") != "Complete"),
            "sd": delay_days(ps, t.get("actualStartDate"), today),
            "fd": delay_days(pe, t.get("actualEndDate") if t.get("status") == "Complete" else None, today),
            "pd": pdays or None, "ad": adays or None,
            "o": (t.get("owner") or "").strip() or None, "org": t.get("organisation") or None,
            "tr": t.get("trade") or None, "loc": t.get("location") or None,
            "pri": t.get("taskPriority") or None, "wk": t.get("plannedCompletionWeek") or None,
            "ss": t.get("scheduleStart"), "sf": t.get("scheduleFinish"),
            "h": t.get("_history") or [],
        })
    groups = Counter(f["g"] for f in facts)
    n = len(facts)
    dates = [d for f in facts for d in (f["ps"], f["pe"], f["as"], f["ax"]) if d]
    return {
        "today": today.isoformat(),
        "totals": {
            "rawRows": len(tables["raw"]), "tasks": n,
            "complete": groups.get("complete", 0), "started": groups.get("started", 0),
            "notStarted": groups.get("notStarted", 0),
            "completePct": round(100 * groups.get("complete", 0) / n, 1) if n else None,
            "overdue": sum(1 for f in facts if f["od"]),
            "subtrades": len({f["st"] for f in facts}), "areas": len({f["a"] for f in facts}),
            "plannedDays": len(tables["planned"]), "actualDays": len(tables["actual"]),
        },
        "range": {"from": min(dates) if dates else None, "to": max(dates) if dates else None},
        "facts": {"tasks": facts},
    }


def apply_forecast(metrics: dict, tasks: list[dict], join_rows: list[dict] | None) -> None:
    """Forecast finish of each Table 2 activity, written to the task (forecastFinish /
    forecastSource) and to its page fact (fc / fs):
      1. the baseline end of the JUI-1A master task(s) with the same join key (area | sub-location |
         subtrade | LAP Plan), when the master schedule has one        -> source "baseline"
      2. otherwise the activity's Schedule Finish custom field           -> source "schedule"
      3. otherwise none."""
    base = {r["joinKey"]: r["baselineEnd"] for r in join_rows or [] if r.get("match") == "both" and r.get("baselineEnd")}
    for f, t in zip(metrics["facts"]["tasks"], tasks):  # facts are built from tasks in the same order
        b = base.get(t.get("joinKey")) if t.get("joinKey") else None
        fc, src = (b, "baseline") if b else ((t["scheduleFinish"], "schedule") if t.get("scheduleFinish") else (None, None))
        t["forecastFinish"], t["forecastSource"] = fc, src
        f["fc"], f["fs"] = fc, src
    metrics["totals"]["forecastBaseline"] = sum(1 for t in tasks if t["forecastSource"] == "baseline")
    metrics["totals"]["forecastSchedule"] = sum(1 for t in tasks if t["forecastSource"] == "schedule")


def project_status(metrics: dict) -> str | None:
    t = (metrics or {}).get("totals") or {}
    if not t.get("tasks"):
        return None
    if t["complete"] == t["tasks"]:
        return "Completed"
    return "Started" if t["complete"] or t["started"] else "Not started"


def invariants(tables: dict, metrics: dict) -> list[str]:
    """Tables 3 and 4 must sum back to Table 2's quantities, and nothing may be lost in dedupe."""
    problems = []
    tasks = tables["tasks"]
    if len({t["guid"] for t in tasks}) != len(tasks):
        problems.append("Table 2 has duplicate guids")
    planned = sum(r["plannedQty"] for r in tables["planned"])
    expect = sum(t["totalQuantity"] for t in tasks if t.get("plannedStartDate") and t.get("plannedEndDate"))
    if abs(planned - expect) > 1e-6 * max(1.0, abs(expect)):
        problems.append("Table 3 sums to %.4f, Table 2 total quantity is %.4f" % (planned, expect))
    actual = sum(r["actualQty"] for r in tables["actual"])
    by_rate = sum(f["ar"] * ((date.fromisoformat(f["ax"]) - date.fromisoformat(f["as"])).days + 1)
                  for f in metrics["facts"]["tasks"] if f["ax"])
    if abs(actual - by_rate) > 1e-6 * max(1.0, abs(actual)):
        problems.append("Table 4 (%.4f) does not match the page's actual rates (%.4f)" % (actual, by_rate))
    return problems


# ============================================================================= S-curve projects
# A weightage project (project.json "kind": "scurve", e.g. JUI-1A) is the master schedule:
#
#   Master    parent != True, one row per guid (latest history event); area / sub-location split
#             as above; weightage from the custom field data.scurve.weightField; earned weightage
#             = weightage x percentComplete / 100
#   Baseline  each task's weightage spread evenly over baselineStartDate..baselineEndDate
#   Planned   each task's weightage spread evenly over plannedStartDate..plannedEndDate (the
#             current plan)
#   Actual    each task's earned weightage spread evenly over actualStartDate..actualEndDate, or
#             actualStartDate..today while it has no actual end
#   Join      master keys (area | sub-location | subtrade | LAP Plan) against the linked quantity
#             project's Table 2 (data.scurve.join.project, e.g. JUI), both sides summed per key
#
# S-curve % = cumulative weightage / total weightage of the tasks in view that have a baseline.

SCURVE_COLUMNS = [
    "guid", "taskId", "taskName", "taskType", "status", "location", "area", "subLocation",
    "subtrade", "lapPlan", "joinKey", "sCurveGroup", "constructionPhase", "trade", "organisation",
    "owner", "weightage", "percentComplete", "earnedWeightage", "baselineStartDate",
    "baselineEndDate", "plannedStartDate", "plannedEndDate", "actualStartDate", "actualEndDate",
    "parentGUID",
]
SCURVE_DAY_COLUMNS = ["date", "guid", "taskId", "taskName", "area", "subLocation", "sCurveGroup", "constructionPhase"]
JOIN_COLUMNS = [
    "match", "area", "subLocation", "subtrade", "lapPlan", "joinKey",
    "masterTasks", "weightage", "earnedWeightage", "masterPctEarned", "baselineStart", "baselineEnd",
    "masterActualStart", "masterActualEnd",
    "linkedActivities", "linkedComplete", "linkedPctComplete", "linkedUnit", "linkedTotalQty",
    "linkedActualQty", "linkedPctQty", "linkedActualStart", "linkedActualEnd",
]
SCURVE_FILES = {"master": "master_tasks.csv", "baseline": "baseline_daily.csv", "planned": "planned_daily.csv",
                "actual": "actual_daily.csv", "join": "join_lap_plan.csv"}


def _clean(v) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()


def scurve_master(rows: list[dict], data: dict) -> list[dict]:
    cfg = data.get("scurve") or {}
    wf = cfg.get("weightField", "Weightage")
    gf, pf = cfg.get("groupField", "S Curve"), cfg.get("phaseField", "Construction Phase")
    sub_alias = data.get("subtradeAliases") or {}
    st_field, lap_field = data.get("subtradeField", "Subtrade"), data.get("lapField", "LAP Plan")
    loc_cfg = data.get("location") or {}
    blank = data.get("noGroup", "Unassigned")
    latest: dict[str, dict] = {}
    for r in rows:
        if (data.get("excludeParents", True) and r.get("parent") is True) or not r.get("guid"):
            continue
        seen = latest.get(r["guid"])
        if seen is None or (parse_dt(r.get("historyDateTime")) or datetime.min) > (parse_dt(seen.get("historyDateTime")) or datetime.min):
            latest[r["guid"]] = r
    out = []
    for r in latest.values():
        cf = r.get("customField") or {}
        area, sub = split_location(r.get("location"), loc_cfg)
        subtrade = clean_label(cf.get(st_field), sub_alias)
        lap = _clean(cf.get(lap_field))
        w = num(cf.get(wf))
        pc = max(0.0, min(100.0, num(r.get("percentComplete"))))
        t = {k: r.get(k) for k in SCURVE_COLUMNS if k in r}
        for k in ("baselineStartDate", "baselineEndDate", "plannedStartDate", "plannedEndDate", "actualStartDate", "actualEndDate"):
            t[k] = _iso(parse_date(r.get(k)))
        t.update({
            "area": area, "subLocation": sub, "subtrade": subtrade or None, "lapPlan": lap or None,
            "joinKey": join_key(area, sub, subtrade, lap),
            "sCurveGroup": _clean(cf.get(gf)) or blank, "constructionPhase": _clean(cf.get(pf)) or blank,
            "weightage": w, "percentComplete": pc, "earnedWeightage": w * pc / 100,
        })
        out.append(t)
    out.sort(key=lambda t: (t["baselineStartDate"] or "9", str(t.get("taskId") or "")))
    return out


def scurve_actual_window(t: dict, today: date) -> tuple[date, date] | None:
    """actual start..actual end, or actual start..today while the task has no actual end."""
    if not t.get("actualStartDate"):
        return None
    s = date.fromisoformat(t["actualStartDate"])
    e = date.fromisoformat(t["actualEndDate"]) if t.get("actualEndDate") else today
    return s, max(s, e)


def _spread_w(t: dict, start: date, end: date, w: float, key: str) -> list[dict]:
    days = (end - start).days + 1
    base = {k: t.get(k) for k in SCURVE_DAY_COLUMNS if k != "date"}
    return [{"date": (start + timedelta(i)).isoformat(), **base, key: w / days} for i in range(days)]


def scurve_baseline_days(master: list[dict]) -> list[dict]:
    out = []
    for t in master:
        if t["weightage"] > 0 and t.get("baselineStartDate") and t.get("baselineEndDate"):
            s, e = date.fromisoformat(t["baselineStartDate"]), date.fromisoformat(t["baselineEndDate"])
            out += _spread_w(t, s, max(s, e), t["weightage"], "baselineWeightage")
    return out


def scurve_planned_days(master: list[dict]) -> list[dict]:
    out = []
    for t in master:
        if t["weightage"] > 0 and t.get("plannedStartDate") and t.get("plannedEndDate"):
            s, e = date.fromisoformat(t["plannedStartDate"]), date.fromisoformat(t["plannedEndDate"])
            out += _spread_w(t, s, max(s, e), t["weightage"], "plannedWeightage")
    return out


def scurve_actual_days(master: list[dict], today: date) -> list[dict]:
    out = []
    for t in master:
        w = scurve_actual_window(t, today)
        if t["earnedWeightage"] > 0 and w:
            out += _spread_w(t, w[0], w[1], t["earnedWeightage"], "earnedWeightage")
    return out


def join_masters(master: list[dict], linked: list[dict] | None) -> list[dict]:
    """Full outer join on joinKey, each side summed per key. match = both / master only / linked only."""
    m2: dict[str, dict] = {}
    for t in master:
        k = t.get("joinKey")
        if not k:
            continue
        g = m2.setdefault(k, {"area": t["area"], "subLocation": t["subLocation"], "subtrade": t["subtrade"], "lapPlan": t["lapPlan"],
                              "masterTasks": 0, "weightage": 0.0, "earnedWeightage": 0.0, "baselineStart": None, "baselineEnd": None,
                              "masterActualStart": None, "masterActualEnd": None})
        g["masterTasks"] += 1
        g["weightage"] += t["weightage"]
        g["earnedWeightage"] += t["earnedWeightage"]
        for f, v, pick in (("baselineStart", t.get("baselineStartDate"), min), ("baselineEnd", t.get("baselineEndDate"), max),
                           ("masterActualStart", t.get("actualStartDate"), min), ("masterActualEnd", t.get("actualEndDate"), max)):
            if v:
                g[f] = pick(g[f], v) if g[f] else v
    m1: dict[str, dict] = {}
    for t in linked or []:
        k = t.get("joinKey")
        if not k:
            continue
        g = m1.setdefault(k, {"area": t["area"], "subLocation": t["subLocation"], "subtrade": t["subtrade"], "lapPlan": t["lapPlan"],
                              "linkedActivities": 0, "linkedComplete": 0, "units": set(), "linkedTotalQty": 0.0,
                              "linkedActualQty": 0.0, "linkedActualStart": None, "linkedActualEnd": None})
        g["linkedActivities"] += 1
        g["linkedComplete"] += t.get("status") == "Complete"
        g["units"].add(t.get("unit"))
        g["linkedTotalQty"] += t["totalQuantity"]
        g["linkedActualQty"] += t["actualQuantity"]
        if t.get("actualStartDate"):
            g["linkedActualStart"] = min(g["linkedActualStart"] or "9", t["actualStartDate"])
        if t.get("actualEndDate"):
            g["linkedActualEnd"] = max(g["linkedActualEnd"] or "", t["actualEndDate"])
    out = []
    for k in sorted(set(m2) | set(m1)):
        a, b = m2.get(k), m1.get(k)
        row = {"joinKey": k, "match": "both" if a and b else "master only" if a else "linked only"}
        row.update({f: (a or b)[f] for f in ("area", "subLocation", "subtrade", "lapPlan")})
        if a:
            row.update({f: v for f, v in a.items() if f not in ("area", "subLocation", "subtrade", "lapPlan")})
            row["masterPctEarned"] = 100 * a["earnedWeightage"] / a["weightage"] if a["weightage"] else None
        if b:
            one_unit = len(b["units"]) == 1
            row.update({
                "linkedActivities": b["linkedActivities"], "linkedComplete": b["linkedComplete"],
                "linkedPctComplete": 100 * b["linkedComplete"] / b["linkedActivities"],
                "linkedUnit": next(iter(b["units"])) if one_unit else "mixed",
                # quantities only add up within one unit
                "linkedTotalQty": b["linkedTotalQty"] if one_unit else None,
                "linkedActualQty": b["linkedActualQty"] if one_unit else None,
                "linkedPctQty": 100 * b["linkedActualQty"] / b["linkedTotalQty"] if one_unit and b["linkedTotalQty"] else None,
                "linkedActualStart": b["linkedActualStart"],
                "linkedActualEnd": b["linkedActualEnd"] if b["linkedComplete"] == b["linkedActivities"] else None,
            })
        out.append(row)
    return out


def build_scurve_tables(rows: list[dict], data: dict, today: date, linked: list[dict] | None) -> dict:
    master = scurve_master(rows, data)
    return {"master": master, "baseline": scurve_baseline_days(master), "planned": scurve_planned_days(master),
            "actual": scurve_actual_days(master, today),
            "join": join_masters(master, linked), "linked": linked is not None}


def write_scurve_tables(tables: dict, out_dir: str, published_dir: str | None = None) -> None:
    specs = (("master", SCURVE_COLUMNS), ("baseline", SCURVE_DAY_COLUMNS + ["baselineWeightage"]),
             ("planned", SCURVE_DAY_COLUMNS + ["plannedWeightage"]),
             ("actual", SCURVE_DAY_COLUMNS + ["earnedWeightage"]), ("join", JOIN_COLUMNS))
    for d in (out_dir, published_dir):
        if d:
            for name, cols in specs:
                _write_csv(os.path.join(d, SCURVE_FILES[name]), tables[name], cols)


def _baseline_to(f: dict, day: date, s: str = "bs", e: str = "be", r: str = "br") -> float:
    """A task's baseline (or, with ps/pe/pr, planned) weightage due by the end of day."""
    if not f[s] or f[s] > day.isoformat():
        return 0.0
    return f[r] * ((min(date.fromisoformat(f[e]), day) - date.fromisoformat(f[s])).days + 1)


def compute_scurve(tables: dict, data: dict, today: date) -> dict:
    """Page payload. facts.tasks: every weighted task with its baseline rate (br, per day over
    [bs, be]) and earned rate (ar, per day over [as, ax]); summing them reproduces the two daily
    tables for any filter, so the page never re-derives."""
    facts = []
    for t in tables["master"]:
        if t["weightage"] <= 0:
            continue
        bs, be = t.get("baselineStartDate"), t.get("baselineEndDate")
        if bs and be and be < bs:
            be = bs
        bdays = (date.fromisoformat(be) - date.fromisoformat(bs)).days + 1 if bs and be else 0
        ps, pe = t.get("plannedStartDate"), t.get("plannedEndDate")
        if ps and pe and pe < ps:
            pe = ps
        pdays = (date.fromisoformat(pe) - date.fromisoformat(ps)).days + 1 if ps and pe else 0
        w = scurve_actual_window(t, today) if t["earnedWeightage"] > 0 else None
        adays = (w[1] - w[0]).days + 1 if w else 0
        facts.append({
            "id": t.get("taskId"), "n": t.get("taskName"), "a": t["area"], "sl": t["subLocation"],
            "grp": t["sCurveGroup"], "ph": t["constructionPhase"], "s": t.get("status"),
            "w": round(t["weightage"], 6), "e": round(t["earnedWeightage"], 6), "pc": t["percentComplete"],
            "bs": bs if bdays else None, "be": be if bdays else None, "br": round(t["weightage"] / bdays, 6) if bdays else 0,
            "ps": ps if pdays else None, "pe": pe if pdays else None, "pr": round(t["weightage"] / pdays, 6) if pdays else 0,
            "as": t.get("actualStartDate") if w else None, "ax": w[1].isoformat() if w else None,
            "ar": round(t["earnedWeightage"] / adays, 6) if adays else 0,
        })
    weighted = [f for f in facts if f["bs"]]
    total = sum(f["w"] for f in weighted)
    earned = sum(f["e"] for f in weighted)
    dates = [d for f in facts for d in (f["bs"], f["be"], f["as"], f["ax"]) if d]
    join = tables["join"]
    return {
        "kind": "scurve", "today": today.isoformat(),
        "totals": {
            "tasks": len(tables["master"]), "weighted": len(facts),
            "complete": sum(1 for f in facts if f["pc"] >= 100),
            "weightage": total, "earned": earned,
            "actualPct": round(100 * earned / total, 2) if total else None,
            "baselinePct": round(100 * sum(_baseline_to(f, today) for f in weighted) / total, 2) if total else None,
            "plannedPct": round(100 * sum(_baseline_to(f, today, "ps", "pe", "pr") for f in weighted) / total, 2) if total else None,
            "baselineDays": len(tables["baseline"]), "plannedDays": len(tables["planned"]), "actualDays": len(tables["actual"]),
            "joinBoth": sum(1 for r in join if r["match"] == "both"),
            "joinMasterOnly": sum(1 for r in join if r["match"] == "master only"),
            "joinLinkedOnly": sum(1 for r in join if r["match"] == "linked only"),
        },
        "range": {"from": min(dates) if dates else None, "to": max(dates) if dates else None},
        "join": {"linked": tables["linked"], "rows": join},
        "facts": {"tasks": facts},
    }


def scurve_status(metrics: dict) -> str | None:
    t = (metrics or {}).get("totals") or {}
    if not t.get("weighted"):
        return None
    return "Completed" if t["complete"] == t["weighted"] else "Started" if t["earned"] else "Not started"


def scurve_invariants(tables: dict, metrics: dict) -> list[str]:
    problems = []
    master = tables["master"]
    if len({t["guid"] for t in master}) != len(master):
        problems.append("master table has duplicate guids")
    b = sum(r["baselineWeightage"] for r in tables["baseline"])
    expect = sum(t["weightage"] for t in master if t["weightage"] > 0 and t.get("baselineStartDate") and t.get("baselineEndDate"))
    if abs(b - expect) > 1e-6 * max(1.0, expect):
        problems.append("baseline daily table sums to %.4f, master weightage with a baseline is %.4f" % (b, expect))
    pl = sum(r["plannedWeightage"] for r in tables["planned"])
    expect = sum(t["weightage"] for t in master if t["weightage"] > 0 and t.get("plannedStartDate") and t.get("plannedEndDate"))
    if abs(pl - expect) > 1e-6 * max(1.0, expect):
        problems.append("planned daily table sums to %.4f, master weightage with planned dates is %.4f" % (pl, expect))
    a = sum(r["earnedWeightage"] for r in tables["actual"])
    by_rate = sum(f["ar"] * ((date.fromisoformat(f["ax"]) - date.fromisoformat(f["as"])).days + 1) for f in metrics["facts"]["tasks"] if f["ax"])
    if abs(a - by_rate) > 1e-4 * max(1.0, a):  # page rates are rounded to 6 decimals
        problems.append("actual daily table (%.4f) does not match the page's earned rates (%.4f)" % (a, by_rate))
    return problems


# ----------------------------------------------------------------------------- workforce (labour)
#
# The workforce feed (type=workForce) has one row per activity: {activityGuid, workforceData:
# [{date (epoch ms, IST midnight), plannedWorkers, actualWorkers}]}. Each guid is matched to the
# JUI task feed (every row, any task type: the daily labour report tasks are not Construction
# tasks), latest history row per guid. A matched task's trade is its `trade` (else its name); its
# category, shift and DLR month come from its parents, e.g. Workers < Day Shift < DLR-Mar-2026.
#
#   daily   one row per activity and date: trade, category, shift, planned and actual workers
#   trade   per trade and calendar month: man-days planned and actual, reporting days, average
#
# A reporting day is a date with at least one record in the feed. Average daily workforce over a
# date range = actual man-days in the range / reporting days in the range, so trade averages add
# up to the total. The page re-cuts the same daily facts by date range, shift, category and trade.

WF_COLUMNS = ["date", "guid", "taskId", "trade", "category", "shift", "dlr", "plannedWorkers", "actualWorkers", "matched"]
WF_TRADE_COLUMNS = ["trade", "month", "reportingDays", "plannedManDays", "actualManDays", "avgDailyWorkforce"]
WF_FILES = {"daily": "workforce_daily.csv", "trade": "workforce_trade_month.csv"}
WF_UNMATCHED = "Not in the task feed"
SHIFT_RE = re.compile(r"\bshift\b", re.I)
DLR_RE = re.compile(r"^DLR-", re.I)


def _wf_date(ms) -> date | None:
    try:
        return (datetime(1970, 1, 1) + timedelta(milliseconds=float(ms), hours=5, minutes=30)).date()
    except (TypeError, ValueError, OverflowError):
        return None


def workforce_tables(wf_rows: list[dict], task_rows: list[dict], data: dict) -> dict:
    cfg = data.get("workforce") or {}
    general = cfg.get("noShift", "No shift split")
    latest: dict[str, dict] = {}
    for r in task_rows:
        g = str(r.get("guid") or "").upper()
        if not g:
            continue
        seen = latest.get(g)
        if seen is None or (parse_dt(r.get("historyDateTime")) or datetime.min) > (parse_dt(seen.get("historyDateTime")) or datetime.min):
            latest[g] = r

    def ancestors(r):
        out, p = [], str(r.get("parentGUID") or "").upper()
        while p and p in latest and len(out) < 8:
            out.append(re.sub(r"\s+", " ", str(latest[p].get("taskName") or "")).strip())
            p = str(latest[p].get("parentGUID") or "").upper()
        return out

    daily, acts = [], []
    for w in wf_rows:
        g = str(w.get("activityGuid") or "").upper()
        if not g:
            continue
        r = latest.get(g)
        if r:
            up = ancestors(r)
            trade = re.sub(r"\s+", " ", str(r.get("trade") or r.get("taskName") or "")).strip() or "Unnamed"
            shift = next((a for a in up if SHIFT_RE.search(a)), general)
            dlr = next((a for a in up if DLR_RE.match(a)), "")
            category = up[0] if up and not SHIFT_RE.search(up[0]) and not DLR_RE.match(up[0]) else "Other"
            info = {"guid": g, "taskId": r.get("taskId"), "trade": trade, "category": category, "shift": shift, "dlr": dlr, "matched": True}
        else:
            info = {"guid": g, "taskId": None, "trade": WF_UNMATCHED, "category": WF_UNMATCHED, "shift": general, "dlr": "", "matched": False}
        acts.append(info)
        for p in w.get("workforceData") or []:
            d = _wf_date(p.get("date"))
            if d is None:
                continue
            daily.append({**info, "date": d.isoformat(), "plannedWorkers": num(p.get("plannedWorkers")), "actualWorkers": num(p.get("actualWorkers"))})
    daily.sort(key=lambda x: (x["date"], x["trade"], x["category"], x["shift"]))

    days_by_month: dict[str, set] = {}
    for x in daily:
        days_by_month.setdefault(x["date"][:7], set()).add(x["date"])
    agg: dict[tuple, list] = {}
    for x in daily:
        a = agg.setdefault((x["trade"], x["date"][:7]), [0.0, 0.0])
        a[0] += x["plannedWorkers"]
        a[1] += x["actualWorkers"]
    trade = []
    for (t, m), (p, a) in sorted(agg.items()):
        n = len(days_by_month[m])
        trade.append({"trade": t, "month": m, "reportingDays": n, "plannedManDays": p, "actualManDays": a,
                      "avgDailyWorkforce": round(a / n, 4) if n else None})
    return {"daily": daily, "trade": trade, "activities": acts}


def write_workforce_tables(tables: dict, out_dir: str, published_dir: str | None = None) -> None:
    for d in (out_dir, published_dir):
        if d:
            _write_csv(os.path.join(d, WF_FILES["daily"]), tables["daily"], WF_COLUMNS)
            _write_csv(os.path.join(d, WF_FILES["trade"]), tables["trade"], WF_TRADE_COLUMNS)


def compute_workforce(tables: dict, data: dict, today: date) -> dict:
    """Page facts: combos [trade, category, shift] and points [combo, day, planned, actual];
    the page sums them per date range and filter."""
    combos, ci, pts = [], {}, {}
    days = sorted({x["date"] for x in tables["daily"]})
    di = {d: i for i, d in enumerate(days)}
    for x in tables["daily"]:
        k = (x["trade"], x["category"], x["shift"])
        if k not in ci:
            ci[k] = len(combos)
            combos.append(list(k))
        pp = pts.setdefault((ci[k], di[x["date"]]), [0.0, 0.0])
        pp[0] += x["plannedWorkers"]
        pp[1] += x["actualWorkers"]
    acts = tables["activities"]
    matched = [a for a in acts if a["matched"]]
    p_all = sum(x["plannedWorkers"] for x in tables["daily"])
    a_all = sum(x["actualWorkers"] for x in tables["daily"])
    return {
        "facts": {"combos": combos, "days": days,
                  "pts": [[k[0], k[1], round(v[0], 4), round(v[1], 4)] for k, v in sorted(pts.items(), key=lambda kv: (kv[0][1], kv[0][0]))]},
        "totals": {"activities": len(acts), "matched": len(matched), "unmatched": len(acts) - len(matched),
                   "unmatchedPoints": sum(1 for x in tables["daily"] if not x["matched"]),
                   "unmatchedActual": sum(x["actualWorkers"] for x in tables["daily"] if not x["matched"]),
                   "points": len(tables["daily"]), "days": len(days),
                   "first": days[0] if days else None, "last": days[-1] if days else None,
                   "plannedManDays": p_all, "actualManDays": a_all,
                   "trades": len({a["trade"] for a in matched}),
                   "avgDaily": round(a_all / len(days), 4) if days else None},
        "today": today.isoformat(),
    }


def workforce_invariants(tables: dict, metrics: dict) -> list[str]:
    problems = []
    seen = set()
    for x in tables["daily"]:
        k = (x["guid"], x["date"])
        if k in seen:
            problems.append("workforce has two records for %s on %s" % k)
            break
        seen.add(k)
    total = metrics["totals"]["actualManDays"]
    a = sum(p[3] for p in metrics["facts"]["pts"])
    if abs(a - total) > 1e-3 * max(1.0, a):
        problems.append("workforce page facts sum to %.2f actual man-days, the daily table to %.2f" % (a, total))
    t = sum(r["actualManDays"] for r in tables["trade"])
    if abs(t - total) > 1e-3 * max(1.0, t):
        problems.append("trade x month table sums to %.2f actual man-days, the daily table to %.2f" % (t, total))
    return problems


# ----------------------------------------------------------------------------- BIM links (3D model)
#
# The site model's element table (<model>.meta.json, written by build/ifc_model.py from the IFC's
# "VisiLean" property set: Workset, Comments, Mark) is linked to Table 2 by the element mark in
# the task name: DC3B-C39-FT-CW (footing of column C39 in the DC building), DC2-SF-C52 (column
# C52 on the second floor), GIS-GB44-PB-RCC (plinth beam GB44 of the GIS building).
#
#   building  task: name prefix or location (DC / DG / GIS); element: Comments, else storey, else
#             Workset, by the patterns in data.bim.buildings (first match wins)
#   mark      the first mark-like token of the task name (data.bim.markPattern)
#   level     a floor code in the task name (1F, SF, ...) keeps the elements on that storey
#             (data.bim.levels); footing / plinth tasks keep the foundation-level ones
#             (data.bim.foundation); when that leaves none, every candidate stays
#   fallback  a mark found in one building only links whatever the element's Comments say
#
# Two more link kinds, from data.bim (project.json display.bim), for elements without a usable mark:
#   groups  elements chosen by class / Comments / storey, linked as one set to the tasks chosen by
#           subtrade / location (e.g. the DC plinth beams and the DC plinth-beam tasks)
#   pours   areas of a floor in model coordinates (from the grid lines of a pour plan); every slab
#           element of that level inside the building takes, point by point, the state of the pour
#           task (by location and level) whose area it lies in; the page colours it per pour
#
# An element's state is a VisiLean status taken from all its tasks (element_status): their common
# status when they agree; Complete when all are Complete / Quality checked; else Stopped,
# Rejected at quality check, Warning or Started when any task has it; Started when some are done
# and the rest wait (work under way); else the least ready of Not Committed, Not Ready, Ready,
# Forced Ready. The page colours it with data.statusColors.

BIM_DEFAULTS = {
    "buildings": [["GIS", r"GIS"], ["DG", r"\bDG\b|DG BLDG|DG FOUNDATION|DG-\d"], ["DC", r"\bDC"]],
    "markPattern": r"(?<![A-Z])(PB|GB|SW|LW|FC|C|B|F)(\d+[A-Z]?)(?![0-9])",
    "taskPrefix": r"^(DC\d[AB]?|DG-?\d|DG|GIS|SS)\s*-\s*",
    "levels": {"GF": "GROUND|FGL", "1F": "FIRST", "SF": "SECOND", "2F": "SECOND", "3F": "THIRD", "4F": "FOURTH", "TF": "TERRACE"},
    "levelPattern": r"-(\d+F|GF|SF|TF)-",
    "foundationTask": r"(^|-)(FT|PCC|PB|GB)(-|$)",
    "foundation": r"FOUNDATION|FGL|RAFT|BOF|GIS L0|PLINTH",
}


DONE_STATUSES = ("Complete", "Quality checked")


def element_status(statuses: list[str]) -> str | None:
    st = [s for s in statuses if s]
    if not st:
        return None
    u = set(st)
    if len(u) == 1:
        return st[0]
    if u <= set(DONE_STATUSES):
        return "Complete"
    for k in ("Stopped", "Rejected at quality check", "Warning", "Started"):
        if k in u:
            return k
    if u & set(DONE_STATUSES):
        return "Started"  # some done, the rest waiting: the element is under way
    for k in ("Not Committed", "Not Ready", "Ready", "Forced Ready"):
        if k in u:
            return k
    return sorted(u)[0]


def bim_links(meta: dict, tasks: list[dict], data: dict, today: date, boxes: list | None = None) -> dict:
    """boxes: per element [minx, miny, minz, maxx, maxy, maxz] in model metres (from the model
    binary), needed for pours and for groups with a z range."""
    cfg = {**BIM_DEFAULTS, **(data.get("bim") or {})}
    S, F = meta["strings"], meta["fields"]
    col = {k: F.index(k) for k in F}
    get = lambda row, k: S[row[col[k]]] if k in col else ""
    brx = [(b, re.compile(p, re.I)) for b, p in cfg["buildings"]]

    def building(*texts):
        for t in texts:
            for b, rx in brx:
                if t and rx.search(t):
                    return b
        return ""

    by_mark: dict[tuple, list[int]] = {}
    mark_bldgs: dict[str, set] = {}
    for i, row in enumerate(meta["rows"]):
        mk = re.sub(r"\s+", "", get(row, "Mark")).upper()
        if not mk:
            continue
        b = building(get(row, "Comments"), get(row, "storey"), get(row, "Workset"))
        by_mark.setdefault((b, mk), []).append(i)
        mark_bldgs.setdefault(mk, set()).add(b)

    mrx, prx, lrx = re.compile(cfg["markPattern"]), re.compile(cfg["taskPrefix"], re.I), re.compile(cfg["levelPattern"], re.I)
    frx, fdn = re.compile(cfg["foundationTask"], re.I), re.compile(cfg["foundation"], re.I)
    levels = {k.upper(): re.compile(v, re.I) for k, v in cfg["levels"].items()}
    out_tasks, el_tasks = [], {}
    stats = Counter()

    def compact(t):
        g = status_group(t.get("status"), data)
        overdue = g != "complete" and bool(t.get("plannedEndDate")) and t["plannedEndDate"] < today.isoformat()
        out_tasks.append({"n": (t.get("taskName") or "").strip(), "id": t.get("taskId"), "st": t.get("status"), "g": g, "od": overdue,
                          "pc": round(num(t.get("percentComplete")), 1), "sub": t.get("subtrade"), "loc": t.get("location"),
                          "ps": t.get("plannedStartDate"), "pe": t.get("plannedEndDate"), "as": t.get("actualStartDate"), "ae": t.get("actualEndDate")})
        return len(out_tasks) - 1
    for t in tasks:
        name = (t.get("taskName") or "").strip()
        n = re.sub(r"\s*-\s*", "-", name.upper())
        m = mrx.search(prx.sub("", n))
        if not m:
            continue
        mark = m.group(1) + m.group(2)
        b = building(n.split("-", 1)[0], t.get("location") or "")
        stats["tasks with a mark"] += 1
        cands = by_mark.get((b, mark))
        if not cands and len(mark_bldgs.get(mark, ())) == 1:  # the mark is in one building only
            cands = by_mark[(next(iter(mark_bldgs[mark])), mark)]
            stats["linked by mark alone"] += 1
        if not cands:
            stats["not linked"] += 1
            kind = "plinth beam" if mark[:2] in ("PB", "GB") else "column / footing" if mark[0] == "C" else "other"
            stats["not linked: " + kind] += 1
            continue
        lv = lrx.search(n)
        if lv and lv.group(1).upper() in levels:
            keep = [i for i in cands if levels[lv.group(1).upper()].search(get(meta["rows"][i], "storey"))]
        elif frx.search(n):
            keep = [i for i in cands if fdn.search(get(meta["rows"][i], "storey"))]
        else:
            keep = []
        cands = keep or cands
        ti = compact(t)
        for i in cands:
            el_tasks.setdefault(i, []).append(ti)
        stats["linked"] += 1
    def rx(p):
        return re.compile(p, re.I) if p else None

    def el_match(i, f):
        row = meta["rows"][i]
        if f.get("class") and get(row, "class") not in f["class"]:
            return False
        for k, fld in (("comments", "Comments"), ("storey", "storey"), ("name", "name"), ("workset", "Workset")):
            if f.get(k) and not re.search(f[k], get(row, fld), re.I):
                return False
        if f.get("z") and boxes:
            z = boxes[i][5]
            if not (f["z"][0] <= z <= f["z"][1]):
                return False
        if f.get("inside") and boxes:  # the element's plan centre within [x0, x1, y0, y1]
            b, r = boxes[i], f["inside"]
            cx, cy = (b[0] + b[3]) / 2, (b[1] + b[4]) / 2
            if not (r[0] <= cx <= r[1] and r[2] <= cy <= r[3]):
                return False
        return True

    def task_match(t, f):
        for k, fld in (("subtrade", "subtrade"), ("location", "location"), ("name", "taskName")):
            if f.get(k) and not re.search(f[k], str(t.get(fld) or ""), re.I):
                return False
        return True

    # groups: a set of elements linked to a set of tasks (summarised in the panel, not listed)
    groups_out, el_group = [], {}
    for gcfg in cfg.get("groups") or []:
        els = [i for i in range(len(meta["rows"])) if el_match(i, gcfg.get("elements") or {})]
        tl = [t for t in tasks if task_match(t, gcfg.get("tasks") or {})]
        if not els or not tl:
            stats["group without elements or tasks: " + gcfg.get("label", "?")] += 1
            continue
        # a group can hold hundreds of tasks: the page gets their counts and a few of them (open ones first)
        sts = [str(t.get("status") or "") for t in tl]
        order = sorted(range(len(tl)), key=lambda k: (sts[k] in DONE_STATUSES, str(tl[k].get("plannedEndDate") or "")))
        gi = len(groups_out)
        groups_out.append({"label": gcfg.get("label"), "tasks": [compact(tl[k]) for k in order[:8]], "total": len(tl),
                           "state": element_status(sts), "elements": len(els), "count": dict(Counter(sts))})
        for i in els:
            el_group.setdefault(i, gi)
        stats["group " + gcfg.get("label", "?")] = len(els)

    # pours: floor areas of the pour plan, coloured point by point
    zones, el_zone = [], {}
    pc = cfg.get("pours") or {}
    if pc and boxes:
        levels = pc.get("levels") or {}
        lvl_names = list(levels)
        lrx, locrx = rx(pc.get("taskLevel")), rx(pc.get("taskLocation"))
        for name, rect in (pc.get("zones") or {}).items():
            for li, lv in enumerate(lvl_names):
                tl = []
                for t in tasks:
                    lm = lrx.search(str(t.get("subtrade") or "")) if lrx else None
                    lo = locrx.search(str(t.get("location") or "")) if locrx else None
                    if lm and lo and lm.group(1).upper() == lv.upper() and lo.group(1).upper() == name.upper():
                        tl.append(t)
                tis = [compact(t) for t in tl]
                zones.append({"name": name, "level": lv, "li": li, "rect": rect, "tasks": tis,
                              "state": element_status([out_tasks[k]["st"] for k in tis])})
        x0 = min(z["rect"][0] for z in zones) - 1
        x1 = max(z["rect"][1] for z in zones) + 1
        y0 = min(z["rect"][2] for z in zones) - 1
        y1 = max(z["rect"][3] for z in zones) + 1
        ef = pc.get("elements") or {}
        for i in range(len(meta["rows"])):
            if not el_match(i, ef):
                continue
            b = boxes[i]
            cx, cy = (b[0] + b[3]) / 2, (b[1] + b[4]) / 2
            if not (x0 <= cx <= x1 and y0 <= cy <= y1):
                continue
            for li, lv in enumerate(lvl_names):
                if levels[lv][0] <= b[5] <= levels[lv][1]:
                    el_zone[i] = li
                    break
        stats["slab elements in pours"] = len(el_zone)
        stats["pour tasks"] = sum(len(z["tasks"]) for z in zones)

    state = {}
    for i, ts in el_tasks.items():
        state[i] = element_status([out_tasks[k]["st"] for k in ts])
    for i, gi in el_group.items():
        if i not in state:
            state[i] = groups_out[gi]["state"]
    stats["elements linked"] = len(el_tasks)
    for k, v in Counter(state.values()).items():
        stats["elements " + k] = v
    return {"tasks": out_tasks, "elements": {str(i): ts for i, ts in sorted(el_tasks.items())},
            "state": {str(i): s for i, s in sorted(state.items())},
            "groups": groups_out, "elGroup": {str(i): g for i, g in sorted(el_group.items())},
            "zones": zones, "elZone": {str(i): z for i, z in sorted(el_zone.items())},
            "levels": list((pc.get("levels") or {}).keys()) if pc else [],
            "levelZ": dict(pc.get("levels") or {}) if pc else {}, "levelNames": dict(pc.get("levelNames") or {}) if pc else {},
            "cuts": cfg.get("cuts") or [], "stats": dict(stats)}
