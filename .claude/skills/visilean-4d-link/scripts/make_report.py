"""
Step 4 - review workbook of the mapping.

Usage: python make_report.py <work_dir> <out.xlsx>
Sheets: Summary | Work packages | Review items | Elements
"""
import sys, os, csv, json, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

W, OUT = sys.argv[1], sys.argv[2]
R = list(csv.DictReader(open(os.path.join(W, "vl_link_mapping.csv"), encoding="utf-8-sig")))
T = {t["externalId"]: t for t in json.load(open(os.path.join(W, "tasks.json"), encoding="utf-8"))}
HDR = PatternFill("solid", fgColor="1F3864"); HF = Font(color="FFFFFF", bold=True)
FILL = {"Linked": "E2EFDA", "No schedule task": "FFF2CC", "Unassigned": "F8CBAD", "No geometry": "D9D9D9"}

def sheet(wb, title, header, rows, widths, status_col=None):
    ws = wb.create_sheet(title); ws.append(header)
    for c in ws[1]: c.fill = HDR; c.font = HF; c.alignment = Alignment(wrap_text=True, vertical="center")
    for row in rows:
        ws.append(row)
        if status_col is not None and row[status_col] in FILL:
            ws.cell(ws.max_row, status_col + 1).fill = PatternFill("solid", fgColor=FILL[row[status_col]])
    for i, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"; ws.auto_filter.ref = ws.dimensions
    return ws

wb = Workbook(); wb.remove(wb.active)
# Summary
C = collections.Counter((r["VL_Building"] or "(unassigned)", r["VL_Module"], r["VL_Status"]) for r in R)
blds = collections.defaultdict(lambda: collections.Counter())
for (b, m, s), n in C.items(): blds[(b, m)][s] += n
rows = [[b, m, sum(c.values()), c["Linked"], c["No schedule task"], c["Unassigned"] + c["No geometry"],
         round(100 * c["Linked"] / sum(c.values()))] for (b, m), c in sorted(blds.items())]
tot = collections.Counter(r["VL_Status"] for r in R)
rows.append(["TOTAL", "", len(R), tot["Linked"], tot["No schedule task"], tot["Unassigned"] + tot["No geometry"],
             round(100 * tot["Linked"] / len(R))])
ws = sheet(wb, "Summary", ["Building", "Module", "Elements", "Linked", "No schedule task", "Unassigned / no geometry", "% linked"],
           rows, [24, 30, 11, 10, 16, 22, 10])
for c in ws[ws.max_row]: c.font = Font(bold=True)

# Work packages
wp = collections.defaultdict(list)
for r in R:
    if r["VL_WorkPackage"]: wp[r["VL_WorkPackage"]].append(r)
rows = []
for k, v in sorted(wp.items()):
    r = v[0]; ids = [i for i in r["VL_ActivityIDs"].split(";") if i]
    rows.append([k, r["VL_Building"], r["VL_Module"], r["VL_SubZone"], r["VL_Level"], r["VL_ElementGroup"], len(v),
                 r["VL_Status"], len(ids), "\n".join(f"{i}  {T[i]['title']}" if i in T else i for i in ids), r["VL_Location"],
                 "; ".join(sorted({x["VL_Flag"] for x in v if x["VL_Flag"]}))])
ws = sheet(wb, "Work packages", ["VL_WorkPackage", "Building", "Module", "Sub-zone", "Level", "Element group", "Elements",
                                 "Status", "# tasks", "Linked activities (ID  title)", "VisiLean location", "Flags"],
           rows, [26, 20, 18, 16, 7, 18, 9, 16, 8, 70, 60, 50], status_col=7)
for row in ws.iter_rows(min_row=2):
    row[9].alignment = Alignment(wrap_text=True, vertical="top")

# Review items
rows = [[r["VL_Flag"] or r["VL_Status"], r["GlobalId"], r["Class"], r["Name"], r["Comments"], r["VL_Building"], r["VL_Module"],
         r["VL_SubZone"], r["VL_Level"], r["VL_ElementGroup"], r["VL_WorkPackage"]]
        for r in R if r["VL_Flag"] or r["VL_Status"] in ("Unassigned", "No geometry")]
rows.sort(key=lambda x: x[0])
sheet(wb, "Review items", ["Reason", "GlobalId", "IFC class", "Name", "Comments", "Building", "Module", "Sub-zone", "Level",
                           "Element group", "Work package"], rows, [55, 24, 20, 50, 22, 20, 18, 16, 7, 18, 26])

# Elements
cols = ["GlobalId", "Class", "Name", "Storey", "Workset", "Comments", "Mark", "VL_Building", "VL_Module", "VL_SubZone", "VL_Level",
        "VL_ElementGroup", "VL_WorkPackage", "VL_ActivityIDs", "VL_Status", "VL_Location", "VL_Basis", "VL_Flag"]
sheet(wb, "Elements", cols, [[r[c] for c in cols] for r in R],
      [24, 20, 45, 24, 26, 20, 8, 20, 18, 16, 7, 18, 26, 50, 16, 60, 26, 40], status_col=14)
wb.save(OUT)
print("saved", OUT, "| work packages:", len(wp), "| review items:", len(rows))
