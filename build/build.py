# -*- coding: utf-8 -*-
"""The Build Process. For each <CODE>/ folder holding a project.json:

    project.json (+ build/project_defaults.json)
        -> fetch_raw (live | cache | sample)
        -> calculation.build_tables -> data/<CODE>/table1..4.csv   (all four, local + CI artifact)
                                    -> dist/<CODE>/tables/table2..4.csv (published, no private columns)
        -> calculation.compute
        -> inject into Template/Dashboard.html
        -> dist/<CODE>/index.html + dist/<CODE>/build.json

then the landing page from every build.json -> dist/index.html, plus dist/.nojekyll.

A project is never dropped from dist: a project without data gets an "unavailable" page.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
import os
import re
from datetime import date, datetime, timedelta, timezone

from . import DATA_DIR, DEFAULTS_FILE, DIST_DIR, ROOT, TEMPLATE_DIR
from . import fetch as F
from . import inject as I

IST = timezone(timedelta(hours=5, minutes=30))
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,30}$")


def log(msg: str) -> None:
    print(msg, flush=True)


# ----------------------------------------------------------------------------- loading

def load_calculation():
    """Import Template/calculation.py by path so the Template folder stays a plain folder."""
    spec = importlib.util.spec_from_file_location("jui_calculation", os.path.join(TEMPLATE_DIR, "calculation.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def short_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


def strip_private(obj):
    """Drop _comment keys (anything starting with _) before embedding."""
    if isinstance(obj, dict):
        return {k: strip_private(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, list):
        return [strip_private(v) for v in obj]
    return obj


def deep_merge(base, over):
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = deep_merge(base.get(k), v) if k in base else v
        return out
    return copy.deepcopy(over) if over is not None else base


def natural(key: str) -> list:
    """P2 before P10: digit runs compare as numbers."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", key)]


def project_sort_key(p: dict):
    return (p.get("order", 1000), natural(p["key"]))


def with_defaults(own: dict, defaults: dict) -> dict:
    """project.json over build/project_defaults.json; facts merge by label; {key} -> folder name."""
    key = own["key"]

    def fill(v):
        if isinstance(v, str):
            return v.replace("{key}", key)
        if isinstance(v, dict):
            return {k: fill(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fill(x) for x in v]
        return v
    base = fill(copy.deepcopy(defaults))
    cfg = deep_merge(base, {k: v for k, v in own.items() if k != "facts"})
    cfg["title"] = own.get("title") or key
    facts = [dict(f) for f in base.get("facts") or []]
    labels = {f["label"]: f for f in facts}
    for f in own.get("facts") or []:
        if f.get("label") in labels:
            labels[f["label"]]["value"] = f.get("value")
        else:
            facts.append(dict(f))
    for f in facts:
        if f["label"] == "Project" and not f.get("value"):
            f["value"] = cfg["title"]
        if f["label"] == "Client" and not f.get("value"):
            f["value"] = cfg.get("client") or None
    cfg["facts"] = facts
    return cfg


def discover_projects(only: list[str] | None = None) -> list[dict]:
    """Every top-level folder that holds a project.json is a project."""
    found = []
    defaults = read_json(DEFAULTS_FILE)
    for name in sorted(os.listdir(ROOT)):
        pdir = os.path.join(ROOT, name)
        pj = os.path.join(pdir, "project.json")
        if not os.path.isdir(pdir) or name.startswith((".", "_")) or not os.path.exists(pj):
            continue
        own = read_json(pj)
        own.setdefault("key", name)
        if own["key"] != name:
            raise SystemExit("%s/project.json: key %r must equal the folder name" % (name, own["key"]))
        if not KEY_RE.match(name):
            raise SystemExit("%s: folder name must match %s" % (name, KEY_RE.pattern))
        cfg = with_defaults(own, defaults)
        cfg["_dir"] = pdir
        found.append(cfg)
    if only:
        wanted = {k.lower() for k in only}
        found = [p for p in found if p["key"].lower() in wanted]
        missing = wanted - {p["key"].lower() for p in found}
        if missing:
            raise SystemExit("no such project folder: %s" % ", ".join(sorted(missing)))
    found.sort(key=project_sort_key)
    return found


def public_project(cfg: dict) -> dict:
    """What the page may know about the project: never projectId, never source."""
    return {"key": cfg["key"], "title": cfg.get("title") or cfg["key"], "client": cfg.get("client"),
            "facts": strip_private(cfg.get("facts") or [])}


def scurve_source(cfg: dict) -> dict | None:
    """project.json "scurve" -> a fetchable feed config for fetch.fetch_raw (its own token key,
    cache and sample file), or None when the project has no S-curve."""
    sc = cfg.get("scurve")
    if not sc or not sc.get("projectId"):
        return None
    k = sc.get("tokenKey") or cfg["key"] + "-scurve"
    src = dict(cfg.get("source") or {})
    src.update({"type": "task", "extraQuery": sc.get("extraQuery", src.get("extraQuery", "")),
                "sampleFile": sc.get("sampleFile") or "sample/%s.tasks.json.gz" % k})
    return {"key": k, "projectId": sc["projectId"], "source": src}


def workforce_source(cfg: dict) -> dict | None:
    """project.json "workforce" -> a fetchable feed config (type=workForce), or None when the
    project has no workforce page. Its own key (<project>-WF) names its cache and sample file;
    its token is the project's own (tokenKey, default the project key): one VisiLean token
    serves every type= of a project."""
    wf = cfg.get("workforce")
    if not wf:
        return None
    k = cfg["key"] + "-WF"
    src = dict(cfg.get("source") or {})
    src.update({"type": wf.get("type", "workForce"), "extraQuery": wf.get("extraQuery", ""),
                "sampleFile": wf.get("sampleFile") or "sample/%s.workforce.json.gz" % k})
    return {"key": k, "tokenKey": wf.get("tokenKey") or cfg["key"],
            "projectId": wf.get("projectId") or cfg.get("projectId"), "source": src}


def forbidden_strings(cfg: dict) -> list[str]:
    out = [str(cfg["projectId"])] if cfg.get("projectId") else []
    for sc in (scurve_source(cfg), workforce_source(cfg)):
        if not sc:
            continue
        out.append(sc["projectId"])
        try:
            out += [tok for tok, _ in F.token_candidates(sc.get("tokenKey") or sc["key"])]
        except F.TokenMissing:
            pass
    base = ((cfg.get("source") or {}).get("baseUrl")) or ""
    host = re.sub(r"^https?://", "", base).split("/")[0]
    if host:
        out.append(host)
    try:
        out += [tok for tok, _ in F.token_candidates(cfg["key"])]
    except F.TokenMissing:
        pass
    return out


# ----------------------------------------------------------------------------- assets

class Assets:
    def __init__(self):
        self.tokens_css = read_text(os.path.join(TEMPLATE_DIR, "tokens.css"))
        self.app_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "app.js"))
        self.dashboard = read_text(os.path.join(TEMPLATE_DIR, "Dashboard.html"))
        # the S-curve page of a project with a weightage master schedule (project.json "scurve")
        self.scurve_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "scurve.js"))
        # the Site progress page (project.json "progressDeck"), and the tabs, which run last
        self.sitepics_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "sitepics.js"))
        self.model3d_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "model3d.js"))
        # the Workforce page (project.json "workforce")
        self.workforce_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "workforce.js"))
        self.tabs_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "tabs.js"))
        # per-viewer "hide this visual" buttons; last, once every title has its info icon
        self.cardhide_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "cardhide.js"))
        self.landing = read_text(os.path.join(TEMPLATE_DIR, "Landing.html"))
        self.logo = png_data_uri(os.path.join(TEMPLATE_DIR, "assets", "logo-visilean.png"))
        self.data = read_json(os.path.join(TEMPLATE_DIR, "dashboard_data.json"))
        self.logic_hash = short_hash(read_text(os.path.join(TEMPLATE_DIR, "calculation.py")))
        self.calc = load_calculation()


def png_data_uri(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("%s is not a PNG file" % path)
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def github_repo() -> str | None:
    """owner/repo: GITHUB_REPOSITORY in Actions, else the git remote 'origin' (github.com only)."""
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo:
        try:
            import subprocess
            url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT, capture_output=True,
                                 text=True, timeout=10).stdout.strip()
        except Exception:
            url = ""
        m = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$", url)
        repo = m.group(1) if m else None
    return repo if repo and re.fullmatch(r"[\w.-]+/[\w.-]+", repo) else None


def refresh_target(key: str) -> dict | None:
    """The project's refresh workflow on GitHub, for the page's Refresh link."""
    wf = "refresh-%s.yml" % key
    if not os.path.exists(os.path.join(ROOT, ".github", "workflows", wf)):
        return None
    repo = github_repo()
    return {"repo": repo, "workflow": wf} if repo else None


def fmt_when(dt: datetime) -> str:
    return "%d %s %d, %02d:%02d IST" % (dt.day, dt.strftime("%b"), dt.year, dt.hour, dt.minute)


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def resolve_today(origin: str, run_date: date, data_as_of: str | None) -> date:
    """Live: the run date. Cache: the day the copy was fetched. Sample: the run date."""
    if origin == "cache" and data_as_of:
        return datetime.fromisoformat(data_as_of).astimezone(IST).date()
    return run_date


# ----------------------------------------------------------------------------- one project

def build_project(cfg: dict, assets: Assets, mode: str, run_date: date, now: datetime) -> dict:
    key = cfg["key"]
    data = deep_merge(assets.data, cfg.get("display") or {})
    now_iso = now.isoformat(timespec="seconds")
    state, origin, data_as_of, metrics, error, token_rejected = "fresh", None, None, None, None, False
    today = run_date
    out_dir = os.path.join(DIST_DIR, key)

    def compute(rows):
        m = compute_main(rows)
        m["workforce"] = workforce(rows)
        return m

    def compute_main(rows):
        tables = assets.calc.build_tables(rows, data, today)
        m = assets.calc.compute(tables, data, today)
        problems = assets.calc.invariants(tables, m)
        if problems:
            raise RuntimeError("invariants failed: " + "; ".join(problems))

        log("%s: Table 1 %d rows, Table 2 %d tasks, Table 3 %d task-days, Table 4 %d task-days -> data/%s/"
            % (key, len(tables["raw"]), len(tables["tasks"]), len(tables["planned"]), len(tables["actual"]), key))
        m["scurve"] = scurve(tables["tasks"])
        # forecast finish: the master schedule's baseline end via the join, else Schedule Finish
        assets.calc.apply_forecast(m, tables["tasks"], ((m["scurve"] or {}).get("join") or {}).get("rows"))
        assets.calc.write_tables(tables, os.path.join(DATA_DIR, key), os.path.join(out_dir, "tables"))
        log("%s: forecast finish from the JUI-1A baseline for %d activities, from Schedule Finish for %d"
            % (key, m["totals"]["forecastBaseline"], m["totals"]["forecastSchedule"]))
        m["progress"] = site_progress(tables["tasks"])
        publish_model_images()
        return m

    def publish_model_images():
        """The site model images (display.model3d.views) from <project>/model/ to dist/<key>/model/."""
        views = ((cfg.get("display") or {}).get("model3d") or {}).get("views") or []
        if not views:
            return
        import shutil
        os.makedirs(os.path.join(out_dir, "model"), exist_ok=True)
        for v in views:
            src = os.path.join(cfg["_dir"], "model", v.get("image") or "")
            if os.path.isfile(src):
                shutil.copyfile(src, os.path.join(out_dir, "model", v["image"]))
            else:
                log("::warning title=%s model image missing::%s" % (key, os.path.relpath(src, ROOT)))

    def site_progress(tasks):
        """The Site progress page: the drawings of project.json "progressDeck" (a .pptx), matched
        to this project's areas, sub-locations and subtrades. None when not configured."""
        deck = cfg.get("progressDeck")
        if not deck:
            return None
        path = deck if os.path.isabs(deck) else os.path.join(ROOT, deck)
        if not os.path.exists(path):
            log("::warning title=%s progress deck missing::%s not found; the Site progress page is skipped" % (key, deck))
            return None
        from . import progress_deck as PD
        slides = PD.read_deck(path)
        PD.write_images(path, slides, os.path.join(out_dir, "progress"))
        PD.match_slides(slides, tasks, data, assets.calc.split_location)
        for sl in slides:
            if not sl.get("subtrade"):
                log("::warning title=%s progress slide %d::no subtrade matches %r" % (key, sl["n"], sl["title"]))
        log("%s: site progress deck %s, %d slides -> dist/%s/progress/" % (key, os.path.basename(path), len(slides), key))
        return {"source": os.path.basename(path), "updated": datetime.fromtimestamp(os.path.getmtime(path), IST).isoformat(timespec="minutes"),
                "slides": PD.page_payload(slides)}

    def workforce(task_rows):
        """The Workforce page: the type=workForce feed matched guid to guid to this project's task
        feed (every row). None when not configured; {"unavailable": true} when it has no data."""
        ws = workforce_source(cfg)
        if not ws:
            return None
        try:
            origin3, rows3, asof3 = F.fetch_raw(ws, mode, now_iso, log)
        except (F.Unreachable, F.TokenRejected, F.TokenMissing) as e:
            log("::warning title=%s workforce unavailable::%s" % (key, e))
            return {"unavailable": True, "title": cfg["workforce"].get("title")}
        tables = assets.calc.workforce_tables(rows3, task_rows, data)
        m = assets.calc.compute_workforce(tables, data, today)
        problems = assets.calc.workforce_invariants(tables, m)
        if problems:
            raise RuntimeError("workforce invariants failed: " + "; ".join(problems))
        m["source"] = {"title": cfg["workforce"].get("title"), "origin": origin3, "dataAsOf": asof3}
        assets.calc.write_workforce_tables(tables, os.path.join(DATA_DIR, key, "workforce"), os.path.join(out_dir, "tables"))
        t = m["totals"]
        log("%s: workforce %d activities (%d matched to the task feed, %d not), %d day records over %d reporting days, %s actual man-days -> data/%s/workforce/"
            % (key, t["activities"], t["matched"], t["unmatched"], t["points"], t["days"], round(t["actualManDays"]), key))
        return m

    def scurve(jui_tasks):
        """The S-curve page: the weightage master schedule (project.json "scurve"), joined to this
        project's Table 2. None when not configured; {"unavailable": true} when it has no data."""
        sc = scurve_source(cfg)
        if not sc:
            return None
        try:
            origin2, rows2, asof2 = F.fetch_raw(sc, mode, now_iso, log)
        except (F.Unreachable, F.TokenRejected, F.TokenMissing) as e:
            log("::warning title=%s S-curve unavailable::%s" % (key, e))
            return {"unavailable": True, "title": cfg["scurve"].get("title")}
        tables = assets.calc.build_scurve_tables(rows2, data, today, jui_tasks)
        m = assets.calc.compute_scurve(tables, data, today)
        problems = assets.calc.scurve_invariants(tables, m)
        if problems:
            raise RuntimeError("S-curve invariants failed: " + "; ".join(problems))
        m["join"]["project"] = cfg.get("title") or key
        m["source"] = {"title": cfg["scurve"].get("title"), "origin": origin2, "dataAsOf": asof2}
        assets.calc.write_scurve_tables(tables, os.path.join(DATA_DIR, key, "scurve"), os.path.join(out_dir, "tables"))
        t = m["totals"]
        log("%s: S-curve master %d tasks (%d weighted), baseline %d, planned %d, actual %d task-days, join %d matched / %d master only / %d %s only -> data/%s/scurve/"
            % (key, t["tasks"], t["weighted"], t["baselineDays"], t["plannedDays"], t["actualDays"], t["joinBoth"], t["joinMasterOnly"], t["joinLinkedOnly"], key, key))
        return m

    try:
        origin, rows, data_as_of = F.fetch_raw(cfg, mode, now_iso, log)
        today = resolve_today(origin, run_date, data_as_of)
        metrics = compute(rows)
        if origin == "cache":
            state = "stale"
    except F.TokenRejected as e:
        token_rejected, state, error = True, "unavailable", str(e)
        log("::error title=%s token rejected::%s" % (key, e))
        cached = F.read_cache(key)
        if cached:
            data_as_of, origin, state = cached[0], "cache", "stale"
            today = resolve_today("cache", run_date, data_as_of)
            metrics = compute(cached[1])
    except F.Unreachable as e:
        state, error = "unavailable", str(e)
        log("::warning title=%s no data::%s" % (key, e))

    for f in cfg.get("facts") or []:
        if f["label"] == "Status" and not f.get("value"):
            f["value"] = assets.calc.project_status(metrics)

    build_id = short_hash(assets.dashboard + (I.to_json(metrics) if metrics else "") + now_iso)
    meta = {
        "key": key, "state": state, "origin": origin, "generatedAt": now_iso, "dataAsOf": data_as_of,
        "today": today.isoformat(), "buildId": build_id, "logicHash": assets.logic_hash,
        "staleAfterHours": data.get("staleAfterHours", 20), "locale": data.get("locale", "en-IN"),
        "tokenRejected": token_rejected, "refresh": refresh_target(key),
        "tables": sorted(os.listdir(os.path.join(out_dir, "tables"))) if metrics and os.path.isdir(os.path.join(out_dir, "tables")) else [],
    }
    payload = {"meta": meta, "project": public_project(cfg), "data": strip_private(data), "metrics": metrics}

    page = I.inline_assets(assets.dashboard, assets.tokens_css, "", "\n".join((assets.app_js, assets.scurve_js, assets.model3d_js, assets.sitepics_js, assets.workforce_js, assets.tabs_js, assets.cardhide_js)))
    page = I.fill(page, {
        "TITLE": cfg.get("title") or key, "EYEBROW": data.get("eyebrow", "JUI Portfolio"),
        "GENERATED_AT": fmt_when(now), "BUILD_ID": build_id, "LOGIC_HASH": assets.logic_hash,
        "HOME_HREF": "../", "LOGO_VISILEAN": assets.logo,
    })
    I.assert_filled(page)
    page = I.embed(page, payload)
    I.assert_clean(page, forbidden_strings(cfg))

    write(os.path.join(out_dir, "index.html"), page)
    t = (metrics or {}).get("totals") or {}
    st = ((metrics or {}).get("scurve") or {}).get("totals") or {}
    summary = {
        "key": key, "title": payload["project"]["title"], "client": cfg.get("client"), "order": cfg.get("order", 1000),
        "state": state, "origin": origin, "generatedAt": now_iso, "dataAsOf": data_as_of, "today": today.isoformat(),
        "tokenRejected": token_rejected, "error": error, "buildId": build_id, "logicHash": assets.logic_hash,
        "href": "./%s/" % key,
        "projectStatus": next((f["value"] for f in cfg.get("facts") or [] if f["label"] == "Status"), None),
        **{k: t.get(k) for k in ("tasks", "complete", "started", "notStarted", "completePct", "overdue", "subtrades", "areas")},
        "scurveBaselinePct": st.get("baselinePct"), "scurveActualPct": st.get("actualPct"),
    }
    write(os.path.join(out_dir, "build.json"), json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    log("%s: %s (%s) -> dist/%s/index.html %d KB" % (key, state, origin or "no data", key, len(page.encode("utf-8")) // 1024))
    return summary


# ----------------------------------------------------------------------------- landing

def build_landing(summaries: list[dict], assets: Assets, now: datetime, title: str) -> None:
    now_iso = now.isoformat(timespec="seconds")
    build_id = short_hash(assets.landing + json.dumps(summaries, sort_keys=True) + now_iso)
    projects = [{k: v for k, v in s.items() if k not in ("error", "logicHash", "buildId")} for s in summaries]
    payload = {
        "meta": {"state": "fresh", "generatedAt": now_iso, "buildId": build_id, "logicHash": assets.logic_hash,
                 "staleAfterHours": assets.data.get("staleAfterHours", 20), "locale": assets.data.get("locale", "en-IN")},
        "projects": projects,
    }
    page = I.inline_assets(assets.landing, assets.tokens_css, "", "")
    page = I.fill(page, {"TITLE": title, "EYEBROW": assets.data.get("eyebrow", "JUI Portfolio"),
                         "GENERATED_AT": fmt_when(now), "BUILD_ID": build_id, "LOGIC_HASH": assets.logic_hash,
                         "LOGO_VISILEAN": assets.logo})
    I.assert_filled(page)
    page = I.embed(page, payload)
    I.assert_clean(page, [])
    write(os.path.join(DIST_DIR, "index.html"), page)
    write(os.path.join(DIST_DIR, ".nojekyll"), "")
    write(os.path.join(DIST_DIR, "portfolio.json"), json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    log("landing: %d projects -> dist/index.html" % len(projects))


def published_summaries(fresh: list[dict]) -> list[dict]:
    """The summaries just built plus every other project's build.json already in dist/."""
    keys = {s["key"].lower() for s in fresh}
    out = list(fresh)
    for cfg in discover_projects(None):
        bj = os.path.join(DIST_DIR, cfg["key"], "build.json")
        if cfg["key"].lower() not in keys and os.path.exists(bj):
            out.append({**read_json(bj), "order": cfg.get("order", 1000)})
    out.sort(key=project_sort_key)
    return out


def run_landing(title: str) -> int:
    now = datetime.now(IST).replace(microsecond=0)
    summaries = published_summaries([])
    if not summaries:
        log("::warning::no project has been built yet; the landing page lists none")
    build_landing(summaries, Assets(), now, title)
    return 0


def run(only: list[str] | None, mode: str, today: date | None, title: str, landing: bool = True) -> int:
    now = datetime.now(IST).replace(microsecond=0)
    assets = Assets()
    projects = discover_projects(only)
    if not projects:
        log("no project folders found (a project is a top-level folder holding project.json)")
    summaries = [build_project(cfg, assets, mode, today or now.date(), now) for cfg in projects]
    if landing:
        build_landing(published_summaries(summaries), assets, now, title)
    rejected = [s["key"] for s in summaries if s.get("tokenRejected")]
    if rejected:
        log("::error::token rejected for: %s" % ", ".join(rejected))
        return 2
    return 0
