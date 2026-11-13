"""
Check plans of a link mapping - compare these with the client's zoning slides before writing the IFC.

Usage: python plot_check.py <work_dir> [--level 1F] [--building "DC Building"]
Writes to work_dir:
  check_modules_<level>.png   one level, coloured by VL_SubZone or VL_Module (pour modules + pour strips)
  check_site.png              whole site, coloured by building / module / external zone
  check_status.png            whole site, coloured by VL_Status (Linked / No schedule task / Unassigned)
"""
import csv, sys, os, argparse
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

ap = argparse.ArgumentParser(); ap.add_argument("work_dir"); ap.add_argument("--level", default="1F"); ap.add_argument("--building", default="")
a = ap.parse_args(); W = a.work_dir
R = [r for r in csv.DictReader(open(os.path.join(W, "vl_link_mapping.csv"), encoding="utf-8-sig")) if r["minX"]]
for r in R:
    for k in ("minX", "minY", "maxX", "maxY", "maxZ"): r[k] = float(r[k])
R = [r for r in R if (r["maxX"] - r["minX"]) < 80 and (r["maxY"] - r["minY"]) < 80]
cm = plt.get_cmap("tab20")

def draw(rows, key, title, fn, size=(16, 18)):
    if not rows: print("nothing to draw for", fn); return
    fig, ax = plt.subplots(figsize=size)
    keys = sorted({key(r) for r in rows}); col = {k: cm(i % 20) for i, k in enumerate(keys)}
    for r in rows:
        ax.add_patch(Rectangle((r["minX"], r["minY"]), r["maxX"] - r["minX"], r["maxY"] - r["minY"], fc=col[key(r)], ec="none", alpha=.55))
    xs = [r["minX"] for r in rows] + [r["maxX"] for r in rows]; ys = [r["minY"] for r in rows] + [r["maxY"] for r in rows]
    ax.set_xlim(min(xs) - 3, max(xs) + 3); ax.set_ylim(min(ys) - 3, max(ys) + 3); ax.set_aspect("equal")
    for k in keys:
        pts = [r for r in rows if key(r) == k]
        cx = sum((p["minX"] + p["maxX"]) / 2 for p in pts) / len(pts); cy = sum((p["minY"] + p["maxY"]) / 2 for p in pts) / len(pts)
        ax.text(cx, cy, f"{k}\n({len(pts)})", ha="center", va="center", fontsize=8, weight="bold", bbox=dict(fc="white", alpha=.75, lw=0))
    ax.set_title(title); plt.savefig(os.path.join(W, fn), dpi=55, bbox_inches="tight"); plt.close()

rows = [r for r in R if r["VL_Level"] == a.level and (not a.building or r["VL_Building"] == a.building)]
draw(rows, lambda r: r["VL_SubZone"] if r["VL_SubZone"].startswith("PST") else (r["VL_Module"] or r["VL_Building"] or "?"),
     f"Level {a.level} - modules and pour strips (plan, N up)", f"check_modules_{a.level}.png")
def site(r):
    if r["VL_SubZone"] and r["VL_Module"] in ("Boundary Wall", "UG Services"): return r["VL_SubZone"]
    return r["VL_Module"] or r["VL_Building"] or "UNASSIGNED"
draw(R, site, "Site - buildings, modules and external zones", "check_site.png", (20, 22))
draw(R, lambda r: r["VL_Status"], "Site - link status", "check_status.png", (20, 22))
print("saved check_modules_%s.png, check_site.png, check_status.png" % a.level)
