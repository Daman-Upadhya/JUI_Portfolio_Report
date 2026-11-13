"""
Profile a VisiLean schedule so link rules can be written against its real naming.

Usage: python analyse_schedule.py <work_dir> [--filter REGEX]    (reads tasks.json, locations.json, trades.json)
Writes work_dir/schedule_profile.md and prints the same.

What it shows:
  * activity-ID (externalId) prefixes at 2, 3 and 4 segments -> the WBS-like structure of the codes
  * title "shapes": numbers / module tokens / zone letters replaced by placeholders, so repeating
    patterns such as "{L}-{M} - Concreting works - Columns" stand out with their counts
  * location tree, trades, statuses, date range
"""
import sys, os, re, json, collections, argparse, datetime as dt

ap = argparse.ArgumentParser(); ap.add_argument("work_dir"); ap.add_argument("--filter", default="")
a = ap.parse_args(); W = a.work_dir
T = json.load(open(os.path.join(W, "tasks.json"), encoding="utf-8"))
if a.filter: T = [t for t in T if re.search(a.filter, (t.get("externalId") or "") + " " + (t.get("title") or ""))]
C = collections.Counter
out = []
p = out.append
day = lambda ms: (dt.date(1970, 1, 1) + dt.timedelta(milliseconds=ms)).isoformat() if ms else "-"

p(f"# Schedule profile ({len(T)} tasks)\n")
s = [t["startDate"] for t in T if t.get("startDate")]; e = [t["endDate"] for t in T if t.get("endDate")]
p(f"Dates: {day(min(s)) if s else '-'} -> {day(max(e)) if e else '-'}  |  with location: {sum(1 for t in T if t.get('locationGuid'))}"
  f"  |  with trade: {sum(1 for t in T if t.get('tradeGuid'))}  |  with externalId: {sum(1 for t in T if t.get('externalId'))}\n")
p("## Status\n" + "\n".join(f"- {k}: {v}" for k, v in C(t.get("status") for t in T).most_common()) + "\n")
for n in (2, 3, 4):
    p(f"## Activity-ID prefixes ({n} segments) - top 60\n")
    p("\n".join(f"- `{k}` {v}" for k, v in C("-".join((t.get("externalId") or "<none>").split("-")[:n]) for t in T).most_common(60)) + "\n")

def shape(title):
    s = re.sub(r"\s+", " ", title or "").strip()
    s = re.sub(r"\b(\d+)(st|nd|rd|th)\b", "{ORD}", s)
    s = re.sub(r"\b([A-Z]{2,4})[- ]?(\d+[A-Z]?)\b", r"\1{n}", s)          # DC1, DC-2A, DG2, ST1 -> DC{n}
    s = re.sub(r"\b(\d+F|GF|TF)\b", "{LVL}", s)                            # 1F, GF, TF
    s = re.sub(r"Zone ?\d+[A-D]?", "Zone {z}", s)
    s = re.sub(r"\b\d+(\.\d+)?\b", "{#}", s)
    return s
p("## Title shapes - top 120 (placeholders: {LVL} level, XX{n} module/core, Zone {z}, {#} number)\n")
p("\n".join(f"- {v:>4}  {k}" for k, v in C(shape(t.get("title")) for t in T).most_common(120)) + "\n")

try:
    loc = json.load(open(os.path.join(W, "locations.json"), encoding="utf-8"))
    roots = loc if isinstance(loc, list) else loc.get("locations", loc)
    used = C(t.get("locationGuid") for t in T)
    p("## Location tree (task count)\n")
    def walk(n, d):
        p(f"{'  ' * d}- {n['title']} ({used.get(n['locationGuid'], 0)})")
        for c in n.get("children") or []: walk(c, d + 1)
    for r in roots: walk(r, 0)
    p("")
except FileNotFoundError: pass
try:
    tr = json.load(open(os.path.join(W, "trades.json"), encoding="utf-8")); tr = tr if isinstance(tr, list) else tr.get("trades", tr)
    used = C(t.get("tradeGuid") for t in T)
    p("## Trades (task count)\n" + "\n".join(f"- {x.get('title') or x.get('name')} ({used.get(x['tradeGuid'], 0)})" for x in tr) + "\n")
except FileNotFoundError: pass

text = "\n".join(out)
open(os.path.join(W, "schedule_profile.md"), "w", encoding="utf-8").write(text)
print(text)
