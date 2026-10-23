# -*- coding: utf-8 -*-
"""Reads the site-progress deck (a .pptx of marked-up drawings) for the Site progress page.

Each slide has a title "<Area> – <work item> – <level>" and one drawing: a picture with the
DPR's mark-up on top (green elements and areas that are done, outlined pours with labels such
as "POUR-6 / DC-1"). The drawing and its mark-up usually sit in one group, in the group's own
coordinate space, which becomes the SVG viewBox the page redraws it in.

    read_deck(path)                    -> [slide], images written by write_images()
    match_slides(slides, tasks, data, split_location)
                                       -> each slide gets area / subtrade / unit, and each pour
                                          its sub-location, from the quantity master table

Standard library only. Nothing here touches a token or the network.
"""
from __future__ import annotations

import os
import re
import zipfile

NS_TEXT = re.compile(r"<a:t>([^<]*)</a:t>")


def _unescape(s: str) -> str:
    return (s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'").replace("&amp;", "&"))


def _rels(z: zipfile.ZipFile, part: str) -> dict:
    d, f = os.path.split(part)
    p = d + "/_rels/" + f + ".rels"
    if p not in z.namelist():
        return {}
    x = z.read(p).decode("utf8")
    out = {}
    for m in re.finditer(r"<Relationship\b([^>]*)/>", x):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        out[a.get("Id")] = a.get("Target")
    return out


def _resolve(base_part: str, target: str) -> str:
    parts = os.path.dirname(base_part).split("/")
    for seg in target.split("/"):
        if seg == "..":
            parts.pop()
        elif seg and seg != ".":
            parts.append(seg)
    return "/".join(parts)


def _xfrm(xml: str):
    m = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:ext cx="(\d+)" cy="(\d+)"', xml)
    return tuple(int(v) for v in m.groups()) if m else None


def _colour(fragment: str):
    """(hex, alpha 0..1) of the first solid fill in a fragment, or (None, None)."""
    m = re.search(r'<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"\s*(/>|>(.*?)</a:srgbClr>)', fragment, re.S)
    if not m:
        return None, None
    a = re.search(r'<a:alpha val="(\d+)"', m.group(3) or "")
    return "#" + m.group(1).upper(), (int(a.group(1)) / 100000 if a else 1.0)


def _shape(sp: str) -> dict | None:
    name = _unescape((re.search(r'<p:cNvPr [^>]*name="([^"]*)"', sp) or [None, ""])[1])
    box = _xfrm(sp)
    if not box:
        return None
    sp_pr = (re.search(r"<p:spPr>(.*?)</p:spPr>", sp, re.S) or [None, ""])[1]
    ln = (re.search(r"<a:ln\b([^>]*)>(.*?)</a:ln>", sp_pr, re.S))
    no_fill = "<a:noFill/>" in re.sub(r"<a:ln\b.*?</a:ln>", "", sp_pr, flags=re.S)
    fill, alpha = (None, None) if no_fill else _colour(re.sub(r"<a:ln\b.*?</a:ln>", "", sp_pr, flags=re.S))
    line, _ = _colour(ln.group(2)) if ln else (None, None)
    lw = int((re.search(r'w="(\d+)"', ln.group(1)) or [None, "12700"])[1]) if ln else 0
    dash = (re.search(r'<a:prstDash val="(\w+)"', ln.group(2)) or [None, "solid"])[1] if ln else None
    geom = (re.search(r'<a:prstGeom prst="(\w+)"', sp_pr) or [None, None])[1]
    path = None
    if "<a:custGeom>" in sp_pr:
        x, y, cx, cy = box
        d = []
        for pm in re.finditer(r'<a:path w="(\d+)" h="(\d+)"[^>]*>(.*?)</a:path>', sp_pr, re.S):
            w, h = int(pm.group(1)) or cx, int(pm.group(2)) or cy
            for op, pts in re.findall(r"<a:(moveTo|lnTo|close)\b[^>]*?(?:/>|>(.*?)</a:\1>)", pm.group(3), re.S):
                if op == "close":
                    d.append("Z")
                    continue
                px, py = re.search(r'<a:pt x="(-?\d+)" y="(-?\d+)"', pts).groups()
                d.append("%s%d %d" % ("M" if op == "moveTo" else "L", x + int(px) * cx // w, y + int(py) * cy // h))
        path = " ".join(d)
        geom = "path"
    text = _unescape(" ".join(NS_TEXT.findall(sp))).strip()
    low = name.lower()
    kind = ("title" if low == "slide title" else "label" if low.endswith(" label") else "zone" if low.endswith(" boundary")
            else "area" if low.endswith(" area") else "element")
    return {"name": name, "kind": kind, "box": box, "geom": geom or "rect", "path": path, "fill": fill, "alpha": alpha,
            "line": line, "lw": lw, "dash": dash, "text": text}


def read_deck(path: str) -> list[dict]:
    z = zipfile.ZipFile(path)
    pres = z.read("ppt/presentation.xml").decode("utf8")
    prels = _rels(z, "ppt/presentation.xml")
    slides = []
    for n, rid in enumerate(re.findall(r'<p:sldId [^>]*r:id="(rId\d+)"', pres), 1):
        part = _resolve("ppt/presentation.xml", prels[rid])
        x = z.read(part).decode("utf8")
        rels = _rels(z, part)
        tree = x[x.index("<p:spTree>"):]
        g = re.search(r"<p:grpSp>.*?<p:grpSpPr>(.*?)</p:grpSpPr>", tree, re.S)
        scope = tree[tree.find("<p:grpSp>"):tree.rfind("</p:grpSp>")] if g else tree
        pic = re.search(r"<p:pic>.*?</p:pic>", scope, re.S)
        if not pic:
            continue
        emb = re.search(r'r:embed="(rId\d+)"', pic.group(0)).group(1)
        img_box = _xfrm(pic.group(0))
        ch = re.search(r'<a:chOff x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:chExt cx="(\d+)" cy="(\d+)"', g.group(1)) if g else None
        view = tuple(int(v) for v in ch.groups()) if ch else img_box
        shapes = [s for s in (_shape(sp) for sp in re.findall(r"<p:sp>.*?</p:sp>", x, re.S)) if s]
        title = next((s["text"] for s in shapes if s["kind"] == "title" and s["text"]), "")
        inside = [s for s in (_shape(sp) for sp in re.findall(r"<p:sp>.*?</p:sp>", scope, re.S)) if s and s["kind"] != "title"]
        media = _resolve(part, rels[emb])
        slides.append({
            "n": n, "title": title, "view": view, "image": {"part": media, "ext": os.path.splitext(media)[1].lower(), "box": img_box},
            "elements": [s for s in inside if s["kind"] in ("element", "area", "zone")],
            "labels": [s for s in inside if s["kind"] == "label" and s["text"]],
        })
    return slides


def write_images(path: str, slides: list[dict], out_dir: str) -> None:
    """Each slide's drawing to <out_dir>/slide<n><ext>; sets slide["image"]["file"]."""
    z = zipfile.ZipFile(path)
    os.makedirs(out_dir, exist_ok=True)
    for s in slides:
        name = "slide%d%s" % (s["n"], s["image"]["ext"])
        with open(os.path.join(out_dir, name), "wb") as f:
            f.write(z.read(s["image"]["part"]))
        s["image"]["file"] = name


# ----------------------------------------------------------------------------- matching to the data

LEVEL = re.compile(r"^(gf|ff|sf|tf|lgf|ugf|b\d|\d+f|roof|terrace)$")


def _tokens(s: str) -> list[str]:
    out = []
    for t in re.findall(r"[a-z0-9]+", (s or "").lower()):
        t = {"columns": "column", "beams": "beam", "slabs": "slab", "walls": "wall", "footings": "footing"}.get(t, t)
        out.append(t)
    return out


def match_slides(slides: list[dict], tasks: list[dict], data: dict, split_location) -> None:
    """Title "<Area> – <work item> – <level>": the area is matched to the areas in the data (exact,
    alias, then prefix: "DG" -> "DG Building"); the subtrade is the one in that area whose words
    best match the work item plus the first level ("GF-1F" -> GF). A pour label's sub-location
    comes from the same location rules as the data ("POUR-6 / DC-1" -> DC-1)."""
    areas = sorted({t["area"] for t in tasks})
    aliases = (data.get("location") or {}).get("areaAliases") or {}
    override = data.get("progressMatch") or {}
    for s in slides:
        parts = [p.strip() for p in re.split(r"\s+[–—-]\s+", s["title"]) if p.strip()]
        head = parts[0] if parts else ""
        area = next((a for a in areas if a.lower() == head.lower()), None) or aliases.get(head)
        if not area:
            area = next((a for a in areas if a.lower().startswith(head.lower() + " ") or head.lower().startswith(a.lower())), None)
        s["area"] = area or head
        words = []
        level = None
        for p in parts[1:]:
            toks = _tokens(p)
            lv = [t for t in toks if LEVEL.match(t)]
            if lv and level is None:
                level = lv[0]
            if not (toks and all(LEVEL.match(t) for t in toks)):
                words += [t for t in toks if not LEVEL.match(t)]
        if " to " in " ".join(parts[1:2]).lower():  # "DC 1 to 4A" names the sub-areas, not the work
            words = [w for w in words if w not in _tokens(parts[1])]
        want = set(words + ([level] if level else []))
        area_toks = set(_tokens(s["area"])) | set(_tokens(head))
        best, score = None, 0.0
        for st in sorted({t["subtrade"] for t in tasks if t["area"] == s["area"]}):
            have = set(_tokens(st)) - area_toks
            if not have:
                continue
            j = len(have & want) / len(have | want)
            if j > score:
                best, score = st, j
        s["subtrade"] = override.get(s["title"]) or (best if score >= 0.5 else None)
        s["matchScore"] = round(score, 2)
        units = sorted({t["unit"] for t in tasks if t["area"] == s["area"] and t["subtrade"] == s["subtrade"]})
        s["unit"] = units[0] if len(units) == 1 else ("mixed" if units else None)
        loc_cfg = data.get("location") or {}
        for lb in s["labels"]:
            a, sub = split_location(lb["text"], loc_cfg)
            lb["sub"] = sub if a == s["area"] and sub not in (loc_cfg.get("wholeArea", "Whole area"), loc_cfg.get("blank", "Unassigned")) else None


def page_payload(slides: list[dict]) -> list[dict]:
    """What the page needs: coordinates in the drawing's own space, no package paths."""
    def el(e):
        return {k: e[k] for k in ("kind", "box", "geom", "path", "fill", "alpha", "line", "lw", "dash")}
    return [{
        "n": s["n"], "title": s["title"], "area": s.get("area"), "subtrade": s.get("subtrade"), "unit": s.get("unit"),
        "view": s["view"], "image": {"file": s["image"].get("file"), "box": s["image"]["box"]},
        "elements": [el(e) for e in s["elements"]],
        "labels": [{"text": l["text"], "box": l["box"], "sub": l.get("sub")} for l in s["labels"]],
    } for s in slides]
