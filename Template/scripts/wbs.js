/* WBS page: the master schedule's whole tree (metrics.scurve.wbs; build/build.py wrote the rows to
   wbs.json next to this page, in depth-first order, each with its parent's row index). Every
   activity is here, parents included. This page only rolls parents up: per parent, the activities
   (rows with no children) below it counted by status group, and the earliest start / latest
   finish of the parent and everything below it. Loaded the first time the tab opens. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, W = P.metrics && P.metrics.scurve && P.metrics.scurve.wbs, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!W || !$("wbs-card")) return;  // no WBS configured: the card stays hidden
  $("wbs-card").hidden = false;
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }

  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY = 864e5, EPOCH = 0;
  function dIso(n) { return n == null ? "" : new Date((EPOCH + n) * DAY).toISOString().slice(0, 10); }
  function fmtD(n) { if (n == null) return DASH; var p = dIso(n).split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  var GROUPS = (P.data && P.data.statusGroups) || {}, COLORS = (P.data && P.data.statusColors) || {};

  /* node columns (calculation.py WBS_NODE) */
  var PR = 0, LV = 1, NAME = 3, CODE = 4, ID = 5, ST = 6, PCT = 7, BS = 9, BE = 10, PS = 11, PE = 12, AS = 13, AE = 14, LOCN = 15, TR = 16, OW = 17;
  var N = [], S = {}, kids = [], roll = [], open = new Set(), level = 3, query = "", loaded = false, loading = false;

  function str(kind, i) { return i >= 0 ? S[kind][i] : ""; }
  function grp(i) { var g = GROUPS[str("status", N[i][ST])]; return g === "complete" ? 0 : g === "started" ? 1 : 2; }

  /* ---------- load and roll up ---------- */
  function load() {
    if (loaded || loading) return;
    loading = true;
    fetch(W.file, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (t) {
      N = t.nodes; S = t.strings; EPOCH = Math.round(Date.parse(t.epoch) / DAY);
      kids = N.map(function () { return null; });
      N.forEach(function (n, i) { if (n[PR] >= 0) (kids[n[PR]] || (kids[n[PR]] = [])).push(i); });
      /* children come after their parent: walk backwards so every child is final before its parent */
      roll = N.map(function (n) { return { c: [0, 0, 0], bs: n[BS], be: n[BE], ps: n[PS], pe: n[PE], as: n[AS], ae: n[AE], allAe: true }; });
      for (var i = N.length - 1; i >= 0; i--) {
        var r = roll[i];
        if (!kids[i]) { r.c[grp(i)] = 1; r.allAe = N[i][AE] != null; }
        var p = N[i][PR];
        if (p < 0) continue;
        var q = roll[p];
        q.c[0] += r.c[0]; q.c[1] += r.c[1]; q.c[2] += r.c[2];
        q.bs = mn(q.bs, r.bs); q.ps = mn(q.ps, r.ps); q.as = mn(q.as, r.as);
        q.be = mx(q.be, r.be); q.pe = mx(q.pe, r.pe); q.ae = mx(q.ae, r.ae);
        q.allAe = q.allAe && r.allAe;
      }
      roll.forEach(function (r, i) { if (kids[i] && !r.allAe) r.ae = null; });
      loaded = true;
      setLevel(level);
      stats();
    }).catch(function (e) {
      loading = false;
      $("wbs-tree").innerHTML = '<div class="empty">The WBS could not be loaded (' + esc(e.message) + "). Open this page from its web address, not as a file.</div>";
    });
  }
  function mn(a, b) { return a == null ? b : b == null ? a : Math.min(a, b); }
  function mx(a, b) { return a == null ? b : b == null ? a : Math.max(a, b); }

  function stats() {
    var c = [0, 0, 0];
    N.forEach(function (n, i) { if (!kids[i]) c[grp(i)]++; });
    var leaves = c[0] + c[1] + c[2];
    function stat(v, l) { return '<div><div class="stat-v">' + v + '</div><div class="stat-l">' + l + "</div></div>"; }
    $("wbs-stats").innerHTML = stat(fmtI(N.length), "Rows") + stat(fmtI(W.parents), "Parents") + stat(fmtI(leaves), "Activities") +
      stat(fmtI(W.levels), "Levels") + stat(fmtI(c[0]), "Complete") + stat(fmtI(c[1]), "Started") + stat(fmtI(c[2]), "Not started");
  }

  /* ---------- controls ---------- */
  var LEVELS = [1, 2, 3, 4, 5, 6];
  $("wbs-lv").innerHTML = LEVELS.map(function (l) { return '<button type="button" data-l="' + l + '" aria-pressed="false">Level ' + l + "</button>"; }).join("");
  function setLevel(l) {
    level = l; open = new Set();
    N.forEach(function (n, i) { if (kids[i] && n[LV] < l - 1) open.add(i); });
    $("wbs-lv").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-l") === l)); });
    render();
  }
  $("wbs-lv").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b && loaded) setLevel(+b.getAttribute("data-l")); });
  var qt;
  $("wbs-q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { query = $("wbs-q").value.trim().toLowerCase(); render(); }, 200); });

  /* ---------- table ---------- */
  var CAP = 4000;
  function hay(i) { var n = N[i]; return (n[NAME] + " " + n[CODE] + " " + n[ID] + " " + str("location", n[LOCN]) + " " + str("trade", n[TR]) + " " + str("owner", n[OW])).toLowerCase(); }
  function visible() {
    var out = [];
    if (query) {  // matches and their ancestors, ancestors opened
      var show = new Uint8Array(N.length), hits = 0;
      for (var i = 0; i < N.length; i++) {
        if (hay(i).indexOf(query) < 0) continue;
        hits++; show[i] = 2;
        for (var p = N[i][PR]; p >= 0 && !show[p]; p = N[p][PR]) show[p] = 1;
      }
      for (var j = 0; j < N.length; j++) if (show[j]) out.push(j);
      out.hits = hits; out.mark = show;
      return out;
    }
    var skip = -1;
    for (var k = 0; k < N.length; k++) {
      var lv = N[k][LV];
      if (skip >= 0) { if (lv > skip) continue; skip = -1; }
      out.push(k);
      if (kids[k] && !open.has(k)) skip = lv;
    }
    return out;
  }
  function hl(s) {
    if (!query) return esc(s);
    var i = s.toLowerCase().indexOf(query);
    return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + query.length)) + "</mark>" + esc(s.slice(i + query.length));
  }
  function status(i) {
    var s = str("status", N[i][ST]);
    return s ? '<span class="wbs-st"><i style="background:' + esc(COLORS[s] || "var(--s-idle)") + '"></i>' + esc(s) + "</span>" : DASH;
  }
  function pct(v) { return '<div class="pbar"><div class="ptrack"><div class="pfill" style="width:' + v + '%"></div></div><span>' + (Math.round(v * 10) / 10) + "%</span></div>"; }
  function mix(c) {
    var t = c[0] + c[1] + c[2];
    if (!t) return '<span class="lv-n">no activities</span>';
    function w(v) { return (100 * v / t).toFixed(2) + "%"; }
    return '<div class="wbs-mix" title="' + fmtI(c[0]) + " complete, " + fmtI(c[1]) + " started, " + fmtI(c[2]) + ' not started"><div class="bar"><span class="c" style="width:' + w(c[0]) + '"></span><span class="s" style="width:' + w(c[1]) + '"></span><span class="n" style="width:' + w(c[2]) + '"></span></div><em>' + fmtI(c[0]) + " / " + fmtI(t) + "</em></div>";
  }
  function row(i, searching, mark) {
    var n = N[i], k = kids[i], r = roll[i], isP = !!k, on = searching ? true : open.has(i);
    var tg = isP ? (searching ? '<span class="tg-sp"></span>' : '<button type="button" class="tg" data-i="' + i + '" aria-expanded="' + on + '" aria-label="' + (on ? "Hide" : "Show") + " the rows under " + esc(n[NAME]) + '">&#9656;</button>') : '<span class="tg-sp"></span>';
    var d = isP ? r : { bs: n[BS], be: n[BE], ps: n[PS], pe: n[PE], as: n[AS], ae: n[AE] }, rc = isP ? ' class="r wbs-roll"' : ' class="r"';
    return '<tr class="' + (isP ? "wbs-p" : "") + '"><td class="wbs-n" style="padding-left:' + (10 + 18 * n[LV]) + 'px">' + tg +
      '<span class="nm">' + (searching && mark !== 2 ? esc(n[NAME]) : hl(n[NAME])) + (isP ? ' <span class="lv-n">' + fmtI(k.length) + "</span>" : "") + "</span>" +
      '<span class="wbs-c" style="padding-left:28px">' + (searching && mark !== 2 ? esc(n[CODE]) : hl(n[CODE])) + (n[ID] ? " · ID " + esc(n[ID]) : "") + "</span></td>" +
      "<td>" + status(i) + "</td><td>" + pct(n[PCT]) + "</td><td>" + (isP ? mix(r.c) : "") + "</td>" +
      ["bs", "be", "ps", "pe", "as", "ae"].map(function (f) { return "<td" + rc + ">" + fmtD(d[f]) + "</td>"; }).join("") +
      "<td>" + esc(str("location", n[LOCN]) || DASH) + "</td><td>" + esc(str("trade", n[TR]) || DASH) + "</td><td>" + esc(str("owner", n[OW]) || DASH) + "</td></tr>";
  }
  function render() {
    if (!loaded) return;
    var vis = visible(), searching = !!query, shown = vis.slice(0, CAP);
    var wrap = $("wbs-tree").querySelector(".tbl-wrap"), top = wrap ? wrap.scrollTop : 0;
    $("wbs-note").textContent = (searching ? fmtI(vis.hits) + " match" + (vis.hits === 1 ? "" : "es") + ", shown with their parents · " : fmtI(vis.length) + " rows open · ") +
      (vis.length > CAP ? "showing the first " + fmtI(CAP) + ": search or pick a lower level to see the rest" : "");
    if (!vis.length) { $("wbs-tree").innerHTML = '<div class="empty">Nothing matches “' + esc(query) + "”.</div>"; return; }
    $("wbs-tree").innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Activity · WBS code · ID</th><th>Status</th><th>% complete</th><th>Activities complete</th>' +
      '<th class="r">Baseline start</th><th class="r">Baseline finish</th><th class="r">Planned start</th><th class="r">Planned finish</th><th class="r">Actual start</th><th class="r">Actual finish</th>' +
      "<th>Location</th><th>Trade</th><th>Owner</th></tr></thead><tbody>" + shown.map(function (i) { return row(i, searching, vis.mark && vis.mark[i]); }).join("") + "</tbody></table></div>";
    if (!searching) $("wbs-tree").querySelector(".tbl-wrap").scrollTop = top;
  }
  $("wbs-tree").addEventListener("click", function (e) {
    var b = e.target.closest(".tg[data-i]");
    if (!b) return;
    var i = +b.getAttribute("data-i");
    if (open.has(i)) open.delete(i); else open.add(i);
    render();
  });

  /* ---------- CSV: the whole tree, parents rolled up ---------- */
  $("wbs-csv").addEventListener("click", function () {
    if (!loaded) return;
    function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var head = ["Row", "Parent row", "Level", "Is parent", "Activity", "WBS code", "Task ID", "Status", "% complete", "Activities below", "Complete", "Started", "Not started",
      "Baseline start", "Baseline finish", "Planned start", "Planned finish", "Actual start", "Actual finish", "Location", "Trade", "Owner"];
    var lines = N.map(function (n, i) {
      var r = roll[i], isP = !!kids[i], d = isP ? r : { bs: n[BS], be: n[BE], ps: n[PS], pe: n[PE], as: n[AS], ae: n[AE] };
      return [i, n[PR] >= 0 ? n[PR] : "", n[LV] + 1, isP ? "Yes" : "No", n[NAME], n[CODE], n[ID], str("status", n[ST]), n[PCT],
        isP ? r.c[0] + r.c[1] + r.c[2] : "", isP ? r.c[0] : "", isP ? r.c[1] : "", isP ? r.c[2] : "",
        dIso(d.bs), dIso(d.be), dIso(d.ps), dIso(d.pe), dIso(d.as), dIso(d.ae), str("location", n[LOCN]), str("trade", n[TR]), str("owner", n[OW])].map(q).join(",");
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head.map(q).join(",")].concat(lines).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = (meta.key || "JUI") + "-wbs.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // on the Overview page: load once the card comes near the screen (wbs.json is large)
  function maybe() { if (!loaded && !loading && !$("pg-scurve").hidden && $("wbs-card").getBoundingClientRect().top < innerHeight + 600) load(); }
  document.addEventListener("jui:page", function (e) { if (e.detail === "scurve") setTimeout(maybe, 50); });
  addEventListener("scroll", maybe, { passive: true });
})();
