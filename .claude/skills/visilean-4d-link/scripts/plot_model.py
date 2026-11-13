"""
Understand a model before writing link rules: plan plots + grid table + attribute profile.

Usage: python plot_model.py <work_dir> [--by Comments|Workset|Class|Storey|System] [--box E0,E1,N0,N1]
Reads elements_xy.csv, bbox.csv, grids.json (from extract_model.py). Writes to work_dir:
  plan_<by>.png      every element's bounding box in plan, coloured by the chosen attribute, grid lines labelled
  grids_table.csv    unique grid tags with orientation and position (metres) - use these to define cut lines
  profile.md         counts of Class / Storey / Workset / Comments / System, and top-height histogram
Read the PNG with the Read tool and compare it with the client's zoning slides.
"""
import sys, os, csv, json, collections, argparse
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

ap = argparse.ArgumentParser(); ap.add_argument("work_dir"); ap.add_argument("--by", default="Comments"); ap.add_argument("--box", default="")
a = ap.parse_args(); W = a.work_dir
A = {r["GlobalId"]: r for r in csv.DictReader(open(os.path.join(W, "elements_xy.csv"), encoding="utf-8"))}
R = []
for b in csv.DictReader(open(os.path.join(W, "bbox.csv"))):
    r = dict(A.get(b["GlobalId"], {})); r.update({k: float(v) for k, v in b.items() if k != "GlobalId"}); R.append(r)
if a.box:
    e0, e1, n0, n1 = map(float, a.box.split(","))
    R = [r for r in R if e0 <= (r["minX"] + r["maxX"]) / 2 <= e1 and n0 <= (r["minY"] + r["maxY"]) / 2 <= n1]

# grids (convert to metres)
G = json.load(open(os.path.join(W, "grids.json")))
u = {}
for g in G:
    k = g.get("unit_m", 0.001)
    (x0, y0), (x1, y1) = g["p0"], g["p1"]
    vert = abs(x1 - x0) < abs(y1 - y0)
    pos = (x0 + x1) / 2 * k if vert else (y0 + y1) / 2 * k
    key = (g["tag"], "E" if vert else "N", round(pos, 1))
    u.setdefault(key, (x0 * k, y0 * k, x1 * k, y1 * k))
with open(os.path.join(W, "grids_table.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(["Tag", "LineOf (E = constant Easting, N = constant Northing)", "Position_m", "x0", "y0", "x1", "y1"])
    for (tag, o, pos), ln in sorted(u.items(), key=lambda kv: (kv[0][1], kv[0][2])): w.writerow([tag, o, pos, *[round(v, 2) for v in ln]])

# plan plot
key = lambda r: (r.get(a.by) or "(blank)").strip() or "(blank)"
top = [k for k, _ in collections.Counter(key(r) for r in R).most_common(19)]
cm = plt.get_cmap("tab20"); col = {k: cm(i) for i, k in enumerate(top)}
fig, ax = plt.subplots(figsize=(20, 20))
for (tag, o, pos), (x0, y0, x1, y1) in u.items():
    ax.plot([x0, x1], [y0, y1], color="#c8c8c8", lw=.4, zorder=0); ax.text(x0, y0, tag, fontsize=6, color="#888")
for r in R:
    if (r["maxX"] - r["minX"]) * (r["maxY"] - r["minY"]) > 2500: continue
    k = key(r); c = col.get(k, (.6, .6, .6, 1))
    ax.add_patch(Rectangle((r["minX"], r["minY"]), r["maxX"] - r["minX"], r["maxY"] - r["minY"], fc=c, ec="none", alpha=.6))
for k in top + ["other"]:
    ax.scatter([], [], color=col.get(k, (.6, .6, .6, 1)), label=f"{k} ({sum(1 for r in R if (key(r) if key(r) in top else 'other') == k)})")
xs = [r["minX"] for r in R] + [r["maxX"] for r in R]; ys = [r["minY"] for r in R] + [r["maxY"] for r in R]
ax.set_xlim(min(xs) - 5, max(xs) + 5); ax.set_ylim(min(ys) - 5, max(ys) + 5); ax.set_aspect("equal")
ax.legend(fontsize=9, markerscale=2, loc="upper left"); ax.set_title(f"Plan - coloured by {a.by}"); ax.grid(alpha=.2)
plt.savefig(os.path.join(W, f"plan_{a.by}.png"), dpi=60, bbox_inches="tight")

# profile
C = collections.Counter; lines = [f"# Model profile ({len(R)} elements with geometry)\n"]
for col_ in ("Class", "Storey", "Workset", "Comments", "System"):
    lines.append(f"## {col_}\n" + "\n".join(f"- {v:>6}  {k}" for k, v in C(r.get(col_, "") for r in R).most_common(40)) + "\n")
lines.append("## Element top height (maxZ, 1 m bins) - floor levels show up as peaks\n" +
             "\n".join(f"- {int(k):>4} m  {v}" for k, v in sorted(C(int(r['maxZ']) for r in R).items())) + "\n")
open(os.path.join(W, "profile.md"), "w", encoding="utf-8").write("\n".join(lines))
print(f"saved plan_{a.by}.png, grids_table.csv ({len(u)} grid lines), profile.md")
