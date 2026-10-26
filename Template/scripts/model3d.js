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
  /* the 3D model view: the rings sit on each building's anchor point and follow the model */
  var viewer = null, modelIdx = {};
  function pinButton(B, h) {
    var bd = band(B.pct);
    return '<button type="button" class="lay-pin bc-' + bd + (sel === B.i ? " is-sel" : "") + '" data-b="' + B.i + '" style="--dx:' + ((h && h.dx) || 0) + "px;--dy:" + ((h && h.dy) || 0) + 'px" aria-label="' +
      esc(B.name + ": " + fmtP(B.pct && B.pct.a) + " earned against " + fmtP(B.pct && B.pct.b) + " due on the baseline, " + BAND[bd]) + '">' + ring(B.pct) + "<b>" + (B.pct && B.pct.a != null ? Math.round(B.pct.a) + "%" : DASH) + "</b>" +
      '<span class="lay-name' + (h && h.tag ? " is-" + h.tag : "") + '" aria-hidden="true">' + esc((h && h.label) || B.name) + "</span></button>";
  }
  function bindPins() {
    $("m3d").querySelectorAll(".lay-pin").forEach(function (el) {
      var B = buildings[+el.getAttribute("data-b")];
      el.addEventListener("mouseenter", function () { showTip(buildingTip(B), el); });
      el.addEventListener("focus", function () { showTip(buildingTip(B), el); });
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("blur", hideTip);
      el.addEventListener("click", function () { openInList(B.i); });
    });
  }
  function renderModel(v) {
    $("m3d").innerHTML = '<figure class="lay-fig"><div class="mdl"></div>' + (v.caption ? "<figcaption>" + esc(v.caption) + "</figcaption>" : "") + "</figure>";
    $("m3d-legend").hidden = !(v.anchors || []).length;
    var box = $("m3d").querySelector(".mdl");
    function start(idx) {
      if (!box.isConnected || !window.JUIModelViewer) return;
      viewer = window.JUIModelViewer(box, "model/", idx, { pinHtml: function (p) { return pinButton(p.B, p.h); } });
      var lift = v.pinLift == null ? 4 : v.pinLift;
      viewer.setPins((v.anchors || []).map(function (h) {
        var B = byName[h.building], at = h.at || (idx.anchors || {})[h.anchor || h.building];
        return B && at ? { B: B, h: h, at: [at[0], at[1], at[2] + lift] } : null;
      }).filter(Boolean));
      bindPins();
    }
    if (modelIdx[v.model]) { start(modelIdx[v.model]); return; }
    fetch("model/" + v.model + ".json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (idx) { modelIdx[v.model] = idx; start(idx); })
      .catch(function (err) {
        box.innerHTML = '<div class="mdl-msg">' + (location.protocol === "file:" ? "The 3D model loads when the report is served (python -m build serve), not from a file on disk." : "The 3D model could not be loaded (" + esc(err.message) + ").") + "</div>";
      });
  }
  function render() {
    var v = CFG.views[view];
    if (viewer) { viewer.destroy(); viewer = null; }
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
  function pinHot(i, on) { $("m3d").querySelectorAll('.lay-pin[data-b="' + i + '"]').forEach(function (p) { p.classList.toggle("is-hot", on); }); }
  function openInList(i) { var d = $("m3d-list").querySelector('.m3-b[data-b="' + i + '"]'); if (d) { d.open = true; d.scrollIntoView({ block: "nearest" }); } }

  renderList();
  render();
})();
