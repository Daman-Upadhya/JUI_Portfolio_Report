# -*- coding: utf-8 -*-
"""Getting a project's raw task rows: live from VisiLean, from the last good copy, or from
the sample export. This is the only module that ever sees a token or a URL.

Token resolution, in order (every candidate found is kept, so a rejected one falls through):
  1. environment variable  VL_TOKEN_<KEY>        (repository secret, one per project)
  2. VL_TOKENS_JSON        {"JUI": "<token>", ...} (one repository secret for all projects)
  3. tokens.json           same map, repo root, gitignored, for local runs

Outcomes of fetch_raw():
  ("live",   rows)  fetched now; also written to .cache/<key>.json
  ("cache",  rows)  VisiLean unreachable, last good copy used
  ("sample", rows)  --source sample, or --source auto with no token
  raises TokenRejected   every candidate was refused -> the run must go red
  raises Unreachable     no live data and no cache -> page is built as "unavailable"

Nothing in this module prints a token or a URL.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from . import CACHE_DIR, ROOT, TOKENS_FILE

USER_AGENT = "JUI-Portfolio-build"


class TokenRejected(Exception):
    """VisiLean refused every token this project has. A configuration problem, not an outage."""


class Unreachable(Exception):
    """VisiLean could not be reached and there is no cached copy."""


class TokenMissing(Exception):
    """No token was configured anywhere for this project."""


# ----------------------------------------------------------------------------- tokens

def _clean(raw: str | None) -> str:
    """The token alone, even if the whole URL was pasted into the secret."""
    s = (raw or "").strip().strip('"').strip("'")
    if "accessToken=" in s:
        s = s.split("accessToken=", 1)[1]
    for sep in ("&", "?", "#", " "):
        s = s.split(sep, 1)[0]
    return s.strip()


def _map_from(text: str, source: str) -> dict:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise TokenMissing("%s is not valid JSON: %s" % (source, e))
    if not isinstance(parsed, dict):
        raise TokenMissing('%s must be an object like {"JUI": "<token>"}' % source)
    return {str(k).strip().lower(): v for k, v in parsed.items() if isinstance(v, str) and v.strip()}


def secret_name(key: str) -> str:
    """VL_TOKEN_<CODE>; characters a secret name cannot hold become _ (MAD4.3 -> VL_TOKEN_MAD4_3)."""
    return "VL_TOKEN_" + re.sub(r"[^A-Z0-9_]", "_", key.upper())


def token_candidates(key: str) -> list[tuple[str, str]]:
    """[(token, where it came from)], de-duplicated, in priority order."""
    out, seen = [], set()

    def add(tok, src):
        tok = _clean(tok)
        if tok and tok not in seen:
            seen.add(tok)
            out.append((tok, src))

    env_name = secret_name(key)
    add(os.environ.get(env_name), env_name)
    blob = os.environ.get("VL_TOKENS_JSON", "").strip()
    if blob:
        add(_map_from(blob, "VL_TOKENS_JSON").get(key.lower()), "VL_TOKENS_JSON")
    if os.path.exists(TOKENS_FILE):
        with open(TOKENS_FILE, encoding="utf-8") as f:
            text = f.read().strip()
        if text:
            add(_map_from(text, "tokens.json").get(key.lower()), "tokens.json")
    return out


def token_sources(key: str) -> list[str]:
    """Where tokens were found, for `list` output. Never the tokens themselves."""
    try:
        return [src for _, src in token_candidates(key)]
    except TokenMissing as e:
        return ["error: %s" % e]


# ----------------------------------------------------------------------------- http

def _url(project: dict, token: str) -> str:
    src = project.get("source") or {}
    base = (src.get("baseUrl") or "").rstrip("?&")
    q = {"accessToken": token, "projectId": project.get("projectId") or "", "type": src.get("type") or "task"}
    extra = (src.get("extraQuery") or "").lstrip("&?")
    return base + ("&" if "?" in base else "?") + urllib.parse.urlencode(q) + (("&" + extra) if extra else "")


def _is_rejection(err: Exception) -> bool:
    """A 400, or a 401/403/500 whose body says the API does not exist, means 'wrong token'."""
    if not isinstance(err, urllib.error.HTTPError):
        return False
    if err.code == 400:
        return True
    if err.code in (401, 403, 500):
        try:
            body = err.read().decode("utf-8", "replace").lower()
        except Exception:
            body = ""
        return "api does not exist" in body or "invalid token" in body or "unauthorized" in body
    return False


def _describe(err: Exception) -> str:
    if isinstance(err, urllib.error.HTTPError):
        return "HTTP %d" % err.code
    if isinstance(err, urllib.error.URLError):
        return "network: %s" % getattr(err, "reason", err)
    return type(err).__name__ + (": " + str(err)[:100] if str(err) else "")


def _rows_of(payload) -> list:
    """The feed is normally a JSON array; tolerate {result: [...]}, {data: [...]}, {tasks: [...]}."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("result", "data", "tasks", "items", "value", "rows"):
            if isinstance(payload.get(k), list):
                return payload[k]
    raise ValueError("unexpected response shape: %s" % type(payload).__name__)


def fetch_live(project: dict, log, attempts: int = 3, timeout: int = 300) -> list:
    key = project["key"]
    tk = project.get("tokenKey") or key  # a second feed of the same project shares its token
    candidates = token_candidates(tk)
    if not candidates:
        raise TokenMissing('no token for %s: set secret %s, or add "%s" to VL_TOKENS_JSON, '
                           'or to tokens.json locally' % (key, secret_name(tk), tk))
    rejected, last = [], None
    for tok, src in candidates:
        for i in range(attempts):
            try:
                req = urllib.request.Request(_url(project, tok), headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    rows = _rows_of(json.loads(resp.read().decode("utf-8", errors="replace")))
                log("%s: fetched %d task rows using %s" % (key, len(rows), src))
                return rows
            except Exception as e:  # noqa: BLE001
                last = e
                if _is_rejection(e):
                    log("::warning title=%s token rejected::%s was rejected by VisiLean (%s)" % (key, src, _describe(e)))
                    rejected.append(src)
                    break
                log("%s: attempt %d/%d failed (%s)" % (key, i + 1, attempts, _describe(e)))
                if i + 1 < attempts:
                    time.sleep(15 * (i + 1))
        else:
            # an outage on this candidate; another token will not help
            raise Unreachable("%s: VisiLean unreachable after %d attempts (%s)" % (key, attempts, _describe(last)))
    raise TokenRejected("%s: every token was rejected (%s)" % (key, ", ".join(rejected)))


# ----------------------------------------------------------------------------- cache & sample

def _cache_path(key: str) -> str:
    return os.path.join(CACHE_DIR, key + ".json.gz")


def write_cache(key: str, rows: list, fetched_at: str) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with gzip.open(_cache_path(key), "wt", encoding="utf-8") as f:
        json.dump({"fetchedAt": fetched_at, "rows": rows}, f, ensure_ascii=False)


def read_cache(key: str):
    p = _cache_path(key)
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt", encoding="utf-8") as f:
        c = json.load(f)
    return c.get("fetchedAt"), c.get("rows") or []


def read_sample(project: dict) -> list:
    rel = (project.get("source") or {}).get("sampleFile") or ("sample/%s.tasks.json.gz" % project["key"])
    p = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
    if not os.path.exists(p):
        # never borrow another project's export: a project without one is "unavailable"
        raise Unreachable("%s: no sample task file at %s" % (project["key"], os.path.relpath(p, ROOT)))
    opener = gzip.open if p.endswith(".gz") else open
    with opener(p, "rt", encoding="utf-8") as f:
        return _rows_of(json.load(f))


def fetch_raw(project: dict, mode: str, now_iso: str, log) -> tuple[str, list, str]:
    """-> (origin, rows, data_as_of). See module docstring for the outcomes."""
    key = project["key"]
    if mode == "sample":
        return "sample", read_sample(project), now_iso
    if mode == "auto" and not token_candidates(key):
        log("%s: no token configured, using the sample data" % key)
        return "sample", read_sample(project), now_iso
    try:
        rows = fetch_live(project, log)
        write_cache(key, rows, now_iso)
        return "live", rows, now_iso
    except TokenRejected:
        raise
    except (Unreachable, TokenMissing, ValueError) as e:
        cached = read_cache(key)
        if cached:
            log("%s: %s; using cached data from %s" % (key, e, cached[0]))
            return "cache", cached[1], cached[0]
        raise Unreachable(str(e))
