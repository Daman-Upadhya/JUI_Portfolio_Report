/* Progress on the site model (Progress & S-curve page; data.model3d, the master schedule facts).
   Views: the 3D model made from the IFC (build/ifc_model.py, drawn by ifcview.js), where each
   building carries a progress ring at its anchor (earned weightage, coloured against the baseline
   due by today), and images kept in the project folder, with rings at fixed spots. A building's figures come from the S-curve groups its storeys
   name; the list beside the image gives them storey by storey. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var S = P.metrics && P.metrics.scurve, CFG = P.data && P.data.model3d, LOC = (P.meta || {}).locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!S || S.unavailable || !CFG || !(CFG.views || []).length || !$("m3d")) { if ($("m3d-card")) $("m3d-card").hidden = true; return; }

  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtP(v) { return v == null || !isFinite(v) ? DASH : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%"; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.slice(0, 10).split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  function dnum(iso) { return Math.round(Date.parse(iso.slice(0, 10)) / 864e5); }
  var T = S.facts.tasks, TODAY = S.today, TN = dnum(TODAY);

  /* ---------- figures: earned, baseline due today and working plan due today, as % of weightage ---------- */
  function figures(patterns) {
    var res = patterns.filter(Boolean).map(function (p) { return new RegExp(p, "i"); });
    var w = 0, e = 0, b = 0, p = 0, n = 0, bs = null, be = null, pe = null, as = null;
    if (!res.length) return null;
    T.forEach(function (t) {
      if (!res.some(function (re) { return re.test(t.grp); })) return;
      n++; w += t.w; e += t.e;
      if (t.bs && t.bs <= TODAY) b += t.br * (Math.min(dnum(t.be), TN) - dnum(t.bs) + 1);
      if (t.ps && t.ps <= TODAY) p += t.pr * (Math.min(dnum(t.pe), TN) - dnum(t.ps) + 1);
      if (t.bs && (!bs || t.bs < bs)) bs = t.bs;
      if (t.be && (!be || t.be > be)) be = t.be;
      if (t.pe && (!pe || t.pe > pe)) pe = t.pe;
      if (t.as && (!as || t.as < as)) as = t.as;
    });
    return n && w ? { n: n, w: w, a: 100 * e / w, b: 100 * b / w, p: 100 * p / w, bs: bs, be: be, pe: pe, as: as } : { n: n, w: 0, a: null };
  }
  function band(q) {
    if (!q || q.a == null) return "idle";
    var d = q.a - (q.b || 0);
    return !q.a && !q.b ? "idle" : d >= -0.05 ? "good" : d >= -5 ? "warn" : "bad";
  }
  var BAND = { good: "on or ahead of the baseline", warn: "up to 5 points behind the baseline", bad: "more than 5 points behind the baseline", idle: "not started" };
  var buildings = (CFG.buildings || []).map(function (b, i) {
    var pats = [];
    (b.storeys || []).forEach(function (s) { if (pats.indexOf(s.group) < 0) pats.push(s.group); if (s.finish && pats.indexOf(s.finish) < 0) pats.push(s.finish); });
    return {
      i: i, name: b.name, area: b.area, pct: figures(pats),
      storeys: (b.storeys || []).map(function (s) { return { label: s.label, pct: figures([s.group]), fin: s.finish ? figures([s.finish]) : null }; }),
    };
  });
  if (CFG.wall) buildings.push({ i: buildings.length, name: CFG.wall.label || "Boundary wall", area: "External Development", pct: figures([CFG.wall.group]), storeys: [] });
  var byName = {};
  buildings.forEach(function (B) { byName[B.name] = B; });

  /* ---------- tooltip (the shared #tip) ---------- */
  var tip = $("tip");
  function showTip(html, el) {
    var r = el.getBoundingClientRect();
    tip.classList.add("tip-info"); tip.innerHTML = html; tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight, x = r.left + r.width / 2, y = r.top;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + "px";
    tip.style.top = (y - h - 10 < 8 ? r.bottom + 10 : y - h - 10) + "px";
  }
  function hideTip() { tip.classList.remove("on"); }
  function buildingTip(B) {
    var q = B.pct;
    if (!q || q.a == null) return "<p><b>" + esc(B.name) + "</b></p><p>No weighted task in the master schedule matches this building.</p>";
    var rows = B.storeys.filter(function (s) { return s.pct && s.pct.a != null; }).slice().reverse().map(function (s) {
      return "<tr><td>" + esc(s.label) + '</td><td class="r"><b>' + fmtP(s.pct.a) + '</b></td><td class="r">' + fmtP(s.pct.b) + "</td></tr>";
    }).join("");
    return "<p><b>" + esc(B.name) + "</b> · earned <b>" + fmtP(q.a) + "</b> against <b>" + fmtP(q.b) + "</b> due on the baseline today (" + BAND[band(q)] + "); working plan " + fmtP(q.p) + ".</p>" +
      "<p>Baseline " + fmtD(q.bs) + " → " + fmtD(q.be) + " · working plan finish " + fmtD(q.pe) + (q.as ? " · started " + fmtD(q.as) : "") + " · " + nf0.format(q.n) + " tasks</p>" +
      (rows ? '<table class="lay-tt"><thead><tr><th>Storey</th><th class="r">Earned</th><th class="r">Baseline</th></tr></thead><tbody>' + rows + "</tbody></table>" : "");
  }

  /* ---------- the views ---------- */
  var view = 0, sel = null;
  try { var hv = new URLSearchParams(location.hash.slice(1)).get("sv"); CFG.views.forEach(function (v, i) { if (v.key === hv) view = i; }); } catch (e) { /* bad hash */ }
  function ring(q) {
    var r = 17, c = 2 * Math.PI * r, a = Math.max(0, Math.min(100, (q && q.a) || 0)), b = Math.max(0, Math.min(100, (q && q.b) || 0));
    return '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="lay-trk" cx="22" cy="22" r="' + r + '"/>' +
      (b > a ? '<circle class="lay-due" cx="22" cy="22" r="' + r + '" stroke-dasharray="' + (c * b / 100).toFixed(2) + " " + c.toFixed(2) + '" transform="rotate(-90 22 22)"/>' : "") +
      (a ? '<circle class="lay-val" cx="22" cy="22" r="' + r + '" stroke-dasharray="' + (c * a / 100).toFixed(2) + " " + c.toFixed(2) + '" transform="rotate(-90 22 22)"/>' : "") + "</svg>";
  }
  /* the 3D model view: the rings sit on each building's anchor point and follow the model; a click
     on an element opens its panel (the IFC's VisiLean properties and the JUI tasks linked to it by
     its mark, metrics.bim), and "Task status" colours the linked elements by their tasks */
  var viewer = null, modelIdx = {}, modelMeta = {}, colourBy = "category", cutAt = "";
  var BIM = P.metrics && P.metrics.bim;
  /* VisiLean's status colours (dashboard_data.json statusColors); an element's state is a status */
  var SC = (P.data && P.data.statusColors) || {};
  function scol(st) { return /^#[0-9a-f]{6}$/i.test(SC[st] || "") ? SC[st] : "#9aa5b1"; }
  function cssHex(v, dflt) {
    var c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    return m ? "#" + [m[1], m[2], m[3]].map(function (x) { return (+x).toString(16).padStart(2, "0"); }).join("") : dflt;
  }
  function stateColours() {
    var out = {};
    Object.keys((BIM && BIM.state) || {}).forEach(function (i) { out[i] = scol(BIM.state[i]); });
    return out;
  }
  function statesInUse() {  // the statuses on the model, in the palette's order
    var u = {};
    Object.keys((BIM && BIM.state) || {}).forEach(function (i) { u[BIM.state[i]] = 1; });
    ((BIM && BIM.zones) || []).forEach(function (z) { if (z.state) u[z.state] = 1; });
    var order = Object.keys(SC).filter(function (k) { return k.charAt(0) !== "_"; });
    return Object.keys(u).sort(function (x, y) { return (order.indexOf(x) + 99 * (order.indexOf(x) < 0)) - (order.indexOf(y) + 99 * (order.indexOf(y) < 0)); });
  }
  /* pours: every zone with a task, coloured by its state (the slab elements take them point by point) */
  function zoneList() {
    return ((BIM && BIM.zones) || []).filter(function (z) { return z.state; }).map(function (z) { return { rect: z.rect, level: z.li, color: scol(z.state) }; });
  }
  function prettyClass(c) { return String(c || "").replace(/^Ifc/, "").replace(/StandardCase$/, "").replace(/([a-z])([A-Z])/g, "$1 $2"); }
  function taskList(ts) {
    return '<ul class="mdl-tasks">' + ts.map(function (t) {
      return '<li style="border-left-color:' + scol(t.st) + '"><div class="mdl-tn">' + esc(t.n) + '</div><div class="mdl-tm"><span class="mdl-st" style="--st:' + scol(t.st) + '">' + esc(t.st || DASH) + "</span>" +
        (t.od ? ' <span class="mdl-od">overdue</span>' : "") + " " +
        fmtP(t.pc) + (t.sub ? " · " + esc(t.sub) : "") + '</div><div class="mdl-td">Plan ' + fmtD(t.ps) + " → " + fmtD(t.pe) +
        (t.as ? " · actual " + fmtD(t.as) + (t.ae ? " → " + fmtD(t.ae) : " →") : "") + (t.loc ? " · " + esc(t.loc) : "") + "</div></li>";
    }).join("") + "</ul>";
  }
  function stPill(st) { return st ? ' <span class="mdl-st" style="--st:' + scol(st) + '">' + esc(st) + "</span>" : ""; }
  function elementPanel(box, meta, i, at) {
    var pane = box.querySelector(".mdl-info");
    if (i < 0 || !meta) { pane.hidden = true; return; }
    var row = meta.rows[i], f = {};
    meta.fields.forEach(function (k, j) { f[k] = meta.strings[row[j]]; });
    var props = [["Category", f.category], ["Type", prettyClass(f["class"])], ["Level", f.storey]].concat(
      meta.fields.filter(function (k) { return ["name", "class", "storey", "category"].indexOf(k) < 0; }).map(function (k) { return [k, f[k]]; }));
    var key = String(i), parts = [];
    /* tasks that name this element's mark */
    var ts = ((BIM && BIM.elements[key]) || []).map(function (k) { return BIM.tasks[k]; });
    if (ts.length) parts.push('<div class="mdl-tasks-h">' + ts.length + " linked task" + (ts.length > 1 ? "s" : "") + stPill(BIM.state[key]) + "</div>" + taskList(ts));
    /* the element-ID sets (and groups) this element belongs to: their tasks, summarised */
    var gl = BIM && BIM.elGroup ? BIM.elGroup[key] : null;
    (gl == null ? [] : [].concat(gl)).forEach(function (gi) {
      var G = BIM.groups[gi], cnt = Object.keys(G.count).map(function (k) { return nf0.format(G.count[k]) + " " + esc(k || "no status"); }).join(" · ");
      var why = G.kind === "elementId" ? " tasks with Element ID <b>" + esc(G.label) + "</b> (" + cnt + "), for " + nf0.format(G.elements) + " elements of that type, level and zone."
        : " tasks (" + cnt + ") for " + nf0.format(G.elements) + " elements, which follow them as a set.";
      parts.push('<div class="mdl-tasks-h">' + esc(G.kind === "elementId" ? "Element ID " + G.label : G.label) + stPill(G.state) + '</div><p class="mdl-sum">' + nf0.format(G.total) + why +
        (G.state !== "Complete" ? " Open ones first:" : " For example:") + "</p>" +
        taskList(G.tasks.map(function (k) { return BIM.tasks[k]; })) + (G.total > G.tasks.length ? '<p class="mdl-sum">… and ' + nf0.format(G.total - G.tasks.length) + " more.</p>" : ""));
    });
    /* a slab in the pour plan: the pour under the pointer */
    var li = BIM && BIM.elZone ? BIM.elZone[key] : undefined;
    if (li != null) {
      var lvl = BIM.levels[li], lname = (BIM.levelNames || {})[lvl] || lvl + " slab", hit = at && BIM.zones.filter(function (z) { return z.li === li && at[0] >= z.rect[0] && at[0] <= z.rect[1] && at[1] >= z.rect[2] && at[1] <= z.rect[3]; })[0];
      parts.push(hit ? '<div class="mdl-tasks-h">Pour ' + esc(hit.name) + " · " + esc(lname) + stPill(hit.state) + "</div>" +
        (hit.tasks.length ? taskList(hit.tasks.map(function (k) { return BIM.tasks[k]; })) : '<p class="mdl-none">No ' + esc(lname) + " task for this pour.</p>")
        : '<div class="mdl-tasks-h">' + esc(lname) + '</div><p class="mdl-none">This point is outside the pour plan.</p>');
    }
    pane.innerHTML = '<div class="mdl-info-h"><b title="' + esc(f.name) + '">' + esc(f.name || "Element") + '</b><button type="button" class="mdl-x" aria-label="Close">&#215;</button></div>' +
      '<dl class="mdl-props">' + props.map(function (p) { return "<dt>" + esc(p[0]) + "</dt><dd>" + (p[1] ? esc(p[1]) : '<span class="faint">' + DASH + "</span>") + "</dd>"; }).join("") + "</dl>" +
      (parts.length ? parts.join("") : '<div class="mdl-tasks-h">No linked task</div><p class="mdl-none">' +
        (f.Mark ? "No JUI task names this element's mark (" + esc(f.Mark) + ") in its building." : "This element has no Mark, so no task can name it.") + "</p>");
    pane.hidden = false;
    pane.querySelector(".mdl-x").addEventListener("click", function () { pane.hidden = true; if (viewer) viewer.select(-1); });
  }
  function pinButton(B, h) {
    var bd = band(B.pct);
    return '<button type="button" class="lay-pin bc-' + bd + (sel === B.i ? " is-sel" : "") + '" data-b="' + B.i + '" style="--dx:' + ((h && h.dx) || 0) + "px;--dy:" + ((h && h.dy) || 0) + 'px" aria-label="' +
      esc(B.name + ": " + fmtP(B.pct && B.pct.a) + " earned against " + fmtP(B.pct && B.pct.b) + " due on the baseline, " + BAND[bd]) + '">' + ring(B.pct) + "<b>" + (B.pct && B.pct.a != null ? Math.round(B.pct.a) + "%" : DASH) + "</b>" +
      '<span class="lay-name' + (h && h.tag ? " is-" + h.tag : "") + '" aria-hidden="true">' + esc((h && h.label) || B.name) + "</span></button>";
  }
  /* a click on a building's ring: its quantity progress from the Quantity tracking page (all
     tasks of its area, or of its own sub-location), by subtrade and by location. Units differ, so
     a progress % is actual / total within one subtrade and unit, and the overall % is the plain
     average of those (each subtrade counts once); "Unassigned" subtrades are left out. */
  var QT = (P.metrics && P.metrics.facts && P.metrics.facts.tasks) || [];
  var NOSUB = (P.data && P.data.noSubtrade) || "Unassigned";
  var nf1 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 1 });
  function fq(v) { return v == null ? DASH : (Math.abs(v) >= 100 ? nf0 : nf1).format(v); }
  function qtyTasks(B) {
    var inArea = QT.filter(function (t) { return t.a === B.area; });
    if (inArea.some(function (t) { return t.sl === B.name; })) return inArea.filter(function (t) { return t.sl === B.name; });
    var others = {};  // sub-locations that are buildings of their own (GIS: the Transformer Yard)
    buildings.forEach(function (o) { if (o !== B) others[o.name] = 1; });
    return inArea.filter(function (t) { return !others[t.sl]; });
  }
  function subPct(ts) {  // per subtrade and unit: total, actual, %, activities
    var m = new Map();
    ts.forEach(function (t) {
      if (t.st === NOSUB) return;
      var k = t.st + "\u0001" + t.u, g = m.get(k) || { st: t.st, u: t.u, tq: 0, aq: 0, n: 0, c: 0, ps: null };
      g.tq += t.tq || 0; g.aq += t.aq || 0; g.n++; if (t.g === "complete") g.c++;
      if (t.ps && (!g.ps || t.ps < g.ps)) g.ps = t.ps;
      m.set(k, g);
    });
    return Array.from(m.values()).map(function (g) {
      g.pct = g.tq > 0 ? Math.min(100, 100 * g.aq / g.tq) : (g.n ? 100 * g.c / g.n : null);
      return g;
    });
  }
  function avgPct(rows) {
    var v = rows.filter(function (g) { return g.pct != null; });
    return v.length ? v.reduce(function (s, g) { return s + g.pct; }, 0) / v.length : null;
  }
  function qbar(p) { return '<span class="q-bar"><i style="width:' + Math.max(0, Math.min(100, p || 0)).toFixed(1) + '%"></i></span>'; }
  function qtyPanel(B) {
    var pane = $("m3d").querySelector(".mdl-info");
    if (!pane) return false;
    var ts = qtyTasks(B), subs = subPct(ts).sort(function (x, y) { return (x.ps || "9").localeCompare(y.ps || "9") || x.st.localeCompare(y.st); });
    var done = ts.filter(function (t) { return t.g === "complete"; }).length, overall = avgPct(subs);
    var whole = (P.data && P.data.location && P.data.location.wholeArea) || "Whole area";
    var locs = new Map();
    ts.forEach(function (t) { var l = t.sl === whole ? B.area : t.sl; if (!locs.has(l)) locs.set(l, []); locs.get(l).push(t); });
    var locRows = Array.from(locs.entries()).sort(function (a, b) { return a[0].localeCompare(b[0], undefined, { numeric: true }); }).map(function (e) {
      return { l: e[0], n: e[1].length, c: e[1].filter(function (t) { return t.g === "complete"; }).length, pct: avgPct(subPct(e[1])) };
    });
    var q = B.pct;
    pane.innerHTML = '<div class="mdl-info-h"><b>' + esc(B.name) + ' · quantity progress</b><button type="button" class="mdl-x" aria-label="Close">&#215;</button></div>' +
      (ts.length ? '<div class="q-head"><div class="q-big">' + fmtP(overall) + '</div><div class="q-sub">overall quantity progress<br><b>' + nf0.format(done) + "</b> of " + nf0.format(ts.length) + " activities complete" +
        (q && q.a != null ? "<br>schedule weightage earned " + fmtP(q.a) + " vs " + fmtP(q.b) + " due" : "") + "</div></div>" +
        '<div class="mdl-tasks-h">By subtrade</div><table class="q-tbl"><thead><tr><th>Subtrade</th><th class="r">Total</th><th class="r">Actual</th><th class="r">%</th></tr></thead><tbody>' +
        subs.map(function (g) { return "<tr><td>" + esc(g.st) + ' <small class="faint">' + esc(g.u || "") + '</small></td><td class="r">' + fq(g.tq) + '</td><td class="r">' + fq(g.aq) + '</td><td class="r q-pc">' + qbar(g.pct) + fmtP(g.pct) + "</td></tr>"; }).join("") +
        "</tbody></table>" +
        (locRows.length > 1 || (locRows[0] && locRows[0].l !== B.area) ? '<div class="mdl-tasks-h">By location</div><table class="q-tbl"><thead><tr><th>Location</th><th class="r">Activities</th><th class="r">Done</th><th class="r">%</th></tr></thead><tbody>' +
          locRows.map(function (r) { return "<tr><td>" + esc(r.l) + '</td><td class="r">' + nf0.format(r.n) + '</td><td class="r">' + nf0.format(r.c) + '</td><td class="r q-pc">' + qbar(r.pct) + fmtP(r.pct) + "</td></tr>"; }).join("") + "</tbody></table>" : "") +
        '<p class="mdl-sum">From the Quantity tracking page (' + esc(B.area) + (ts.some(function (t) { return t.sl === B.name; }) ? " · " + esc(B.name) : "") + "). A subtrade's % is actual ÷ total quantity in its unit; the overall % is their average. Unassigned subtrades are left out.</p>"
        : '<p class="mdl-none">No quantity activity for ' + esc(B.name) + " in the Quantity tracking data yet.</p>");
    pane.hidden = false;
    pane.scrollTop = 0;
    pane.querySelector(".mdl-x").addEventListener("click", function () { pane.hidden = true; });
    if (viewer) viewer.select(-1);
    return true;
  }
  function bindPins() {
    $("m3d").querySelectorAll(".lay-pin").forEach(function (el) {
      var B = buildings[+el.getAttribute("data-b")];
      el.addEventListener("mouseenter", function () { showTip(buildingTip(B), el); });
      el.addEventListener("focus", function () { showTip(buildingTip(B), el); });
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("blur", hideTip);
      el.addEventListener("click", function (e) { e.stopPropagation(); hideTip(); if (!qtyPanel(B)) openInList(B.i); });
    });
  }
  function renderModel(v) {
    var st = BIM && BIM.stats, nf = function (x) { return nf0.format(x || 0); };
    var links = st ? " Click an element for its Workset, Comments, Mark and linked tasks. Task links: " +
      (st["element ID tasks linked"] ? nf(st["element ID tasks linked"]) + " tasks by their Element ID (" + nf(st["element ID groups"]) + " element sets)" +
        (st["element ID tasks on pours"] ? " and " + nf(st["element ID tasks on pours"]) + " slab tasks on the pour plan" : "") + "; " : "") +
      nf(st.linked) + " more by the element mark in the task name." : "";
    $("m3d").innerHTML = '<figure class="lay-fig"><div class="mdl"></div>' + (v.caption || links ? "<figcaption>" + esc((v.caption || "") + links) + "</figcaption>" : "") + "</figure>";
    $("m3d-legend").hidden = !(v.anchors || []).length;
    var box = $("m3d").querySelector(".mdl");
    function start(idx) {
      if (!box.isConnected || !window.JUIModelViewer) return;
      var meta = modelMeta[v.model];
      var CUTS = (BIM && BIM.cuts) || [], cutZ = {};
      CUTS.forEach(function (c) { cutZ[c.key] = c.z; });
      var cutSeg = CUTS.length ? '<div class="seg mdl-cut" role="group" aria-label="Show up to"><button type="button" data-c="" aria-pressed="' + !cutAt + '" title="Every level">All</button>' +
        CUTS.map(function (c) { return '<button type="button" data-c="' + esc(c.key) + '" aria-pressed="' + (cutAt === c.key) + '" title="' + esc(c.title || "") + '">' + esc(c.label) + "</button>"; }).join("") + "</div>" : "";
      var tools = BIM && idx.elementOffset ? cutSeg + '<div class="seg mdl-mode" role="group" aria-label="Colour by"><button type="button" data-m="category" aria-pressed="' + (colourBy === "category") + '">Category</button><button type="button" data-m="state" aria-pressed="' + (colourBy === "state") + '">Task status</button></div>' : "";
      viewer = window.JUIModelViewer(box, "model/", idx, {
        pinHtml: function (p) { return pinButton(p.B, p.h); },
        tools: tools,
        onPick: function (i, at) { viewer.select(i); elementPanel(box, meta, i, at); }
      });
      box.insertAdjacentHTML("beforeend", '<div class="mdl-info" hidden></div>' + (tools ? '<div class="mdl-leg" hidden>' + statesInUse().map(function (k) {
        return '<span><i style="--st:' + scol(k) + '"></i>' + esc(k) + "</span>"; }).join("") + '<span><i class="mdl-ghost"></i>Not linked (see-through)</span></div>' : ""));
      if (tools) {
        viewer.setStates(stateColours(), BIM.elZone || {});
        viewer.setZones(zoneList());
        var setBy = function (m) {
          colourBy = m; viewer.setMode(m);
          box.querySelectorAll(".mdl-mode button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-m") === m)); });
          box.querySelector(".mdl-leg").hidden = m !== "state";
        };
        box.querySelector(".mdl-mode").addEventListener("click", function (e) { var b = e.target.closest("button[data-m]"); if (b) setBy(b.getAttribute("data-m")); });
        setBy(colourBy);
        var setCut = function (c) {
          cutAt = c; viewer.setClip(c && cutZ[c] != null ? cutZ[c] : null);
          box.querySelectorAll(".mdl-cut button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-c") === c)); });
        };
        if (box.querySelector(".mdl-cut")) box.querySelector(".mdl-cut").addEventListener("click", function (e) { var b = e.target.closest("button[data-c]"); if (b) setCut(b.getAttribute("data-c")); });
        setCut(cutAt);
      }
      var lift = v.pinLift == null ? 4 : v.pinLift;
      viewer.setPins((v.anchors || []).map(function (h) {
        var B = byName[h.building], at = h.at || (idx.anchors || {})[h.anchor || h.building];
        return B && at ? { B: B, h: h, at: [at[0], at[1], at[2] + lift] } : null;
      }).filter(Boolean));
      bindPins();
    }
    if (modelIdx[v.model]) { start(modelIdx[v.model]); return; }
    fetch("model/" + v.model + ".json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (idx) {
        modelIdx[v.model] = idx;
        if (!idx.meta) return idx;  // the element table (names, Workset, Comments, Mark) for the click panel
        return fetch("model/" + idx.meta).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (m) { modelMeta[v.model] = m; return idx; });
      })
      .then(function (idx) { start(idx); })
      .catch(function (err) {
        box.innerHTML = '<div class="mdl-msg">' + (location.protocol === "file:" ? "The 3D model loads when the report is served (python -m build serve), not from a file on disk." : "The 3D model could not be loaded (" + esc(err.message) + ").") + "</div>";
      });
  }
  function render() {
    var v = CFG.views[view];
    if (viewer) { viewer.destroy(); viewer = null; }
    $("m3d-views").hidden = CFG.views.length < 2;  // one view: no toggle
    $("m3d-views").innerHTML = CFG.views.map(function (x, i) { return '<button type="button" data-v="' + i + '" aria-pressed="' + (i === view) + '">' + esc(x.label) + "</button>"; }).join("");
    $("m3d-views").querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { view = +b.getAttribute("data-v"); hideTip(); render(); writeHash(); }); });
    if (v.model) { renderModel(v); return; }
    var pins = (v.hotspots || []).map(function (h) {
      var B = byName[h.building];
      if (!B) return "";
      var bd = band(B.pct);
      return '<button type="button" class="lay-pin bc-' + bd + (sel === B.i ? " is-sel" : "") + '" data-b="' + B.i + '" style="left:' + h.x + "%;top:" + h.y + "%;--dx:" + (h.dx || 0) + "px;--dy:" + (h.dy || 0) + 'px" aria-label="' +
        esc(B.name + ": " + fmtP(B.pct && B.pct.a) + " earned against " + fmtP(B.pct && B.pct.b) + " due on the baseline, " + BAND[bd]) + '">' + ring(B.pct) + "<b>" + (B.pct && B.pct.a != null ? Math.round(B.pct.a) + "%" : DASH) + "</b>" +
        '<span class="lay-name' + (h.tag ? " is-" + h.tag : "") + '" aria-hidden="true">' + esc(h.label || B.name) + "</span></button>";
    }).join("");
    $("m3d").innerHTML = '<figure class="lay-fig"><div class="lay-img' + (v.cutout ? " is-cut" : "") + '" style="aspect-ratio:' + (v.w || 16) + " / " + (v.h || 9) + '"><img src="model/' + encodeURIComponent(v.image) + '" alt="' + esc(v.alt || v.label) + '" loading="lazy">' + pins + "</div>" +
      (v.caption ? "<figcaption>" + esc(v.caption) + "</figcaption>" : "") + "</figure>";
    $("m3d-legend").hidden = !(v.hotspots || []).length;
    bindPins();
  }
  function writeHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (view) h.set("sv", CFG.views[view].key); else h.delete("sv");
    try { history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname + location.search); } catch (e) { /* file:// */ }
  }

  /* ---------- the building list beside the image ---------- */
  function bar(q) {
    if (!q || q.a == null) return '<span class="m3-bar"></span>';
    var c = function (v) { return Math.max(0, Math.min(100, v || 0)); };
    return '<span class="m3-bar"><i class="m3-done" style="width:' + c(q.a) + '%"></i>' + (q.b > q.a ? '<i class="m3-due" style="left:' + c(q.a) + "%;width:" + (c(q.b) - c(q.a)) + '%"></i>' : "") + "</span>";
  }
  function renderList() {
    if (!$("m3d-list")) return;  // the list beside the model was removed; its figures stay in the ring tooltips
    $("m3d-list").innerHTML = buildings.map(function (B) {
      var q = B.pct;
      return '<details class="m3-b" data-b="' + B.i + '"><summary><span class="m3-name">' + esc(B.name) + '</span><span class="m3-pc">' + fmtP(q && q.a) + "<small> vs " + fmtP(q && q.b) + "</small></span>" + bar(q) + "</summary>" +
        "<ul>" + B.storeys.slice().reverse().map(function (st) { return "<li><span>" + esc(st.label) + '</span><span class="m3-pc">' + fmtP(st.pct && st.pct.a) + "</span>" + bar(st.pct) + "</li>"; }).join("") +
        (B.pct && B.pct.be ? '<li class="m3-dates"><span>Baseline finish ' + fmtD(B.pct.be) + " · plan finish " + fmtD(B.pct.pe) + "</span></li>" : "") + "</ul></details>";
    }).join("");
    $("m3d-list").querySelectorAll(".m3-b").forEach(function (d) {
      var i = +d.getAttribute("data-b");
      d.querySelector("summary").addEventListener("mouseenter", function () { pinHot(i, true); });
      d.querySelector("summary").addEventListener("mouseleave", function () { pinHot(i, false); });
      d.addEventListener("toggle", function () {
        if (d.open) { sel = i; $("m3d-list").querySelectorAll(".m3-b").forEach(function (o) { if (o !== d) o.open = false; }); } else if (sel === i) sel = null;
        $("m3d").querySelectorAll(".lay-pin").forEach(function (p) { p.classList.toggle("is-sel", +p.getAttribute("data-b") === sel); });
      });
    });
  }
  function pinHot(i, on) {
    if (!$("m3d")) return; $("m3d").querySelectorAll('.lay-pin[data-b="' + i + '"]').forEach(function (p) { p.classList.toggle("is-hot", on); }); }
  function openInList(i) { if (!$("m3d-list")) return; var d = $("m3d-list").querySelector('.m3-b[data-b="' + i + '"]'); if (d) { d.open = true; d.scrollIntoView({ block: "nearest" }); } }

  renderList();
  render();
})();
