/* Activity drill-through for the Procurement and MEP procurement pages. Uses the page's drawer
   (#drawer, the same look as the Quantity page's), opened as a list of schedule activities, then one
   activity in detail. app.js owns the drawer too: while this module has it open the drawer carries
   data-owner="act", and the close / back / Escape handlers below run first and stop app.js's.
   Rows are calculation.py _proc_activity() records plus a "where" label (material › stage).
   window.JUIActDrill.open({ eyebrow, title, sub, rows, whereLabel?, status?, act? }) */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent), meta = P.meta || {}, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  if (!$("drawer")) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 }), nf1 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 1 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0]; }
  function day(iso) { return iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5 : null; }
  function diff(a, b) { return a && b ? day(a) - day(b) : null; }
  function dur(a, b) { return a && b ? day(b) - day(a) + 1 : null; }
  function days(n) { return n == null ? DASH : fmtI(n) + " day" + (Math.abs(n) === 1 ? "" : "s"); }
  function delayTxt(d, sofar) {
    if (d == null) return '<span class="faint">' + DASH + "</span>";
    if (d === 0) return "On time";
    var a = Math.abs(d);
    return '<span class="' + (d > 0 ? "late" : "early") + '">' + fmtI(a) + " day" + (a === 1 ? "" : "s") + (d > 0 ? " late" : " early") + (d > 0 && sofar ? " so far" : "") + "</span>";
  }
  var STATUS = { complete: "Complete", started: "Started", notStarted: "Not started" };
  function pills(a) { return '<span class="pill ' + a.group + '">' + esc(a.status || STATUS[a.group]) + "</span>" + (a.overdue ? ' <span class="pill overdue">Overdue</span>' : ""); }
  var FILTERS = [["", "All"], ["complete", "Complete"], ["started", "Started"], ["notStarted", "Not started"], ["overdue", "Overdue"], ["late", "Late vs baseline"]];
  // ctx.vs: what a row's "delay" is measured against (default the baseline; "plan" for the Overview's weighted tasks)
  function vs(t) { return t.replace("baseline", (D.ctx && D.ctx.vs) || "baseline"); }
  function pass(a, s) { return !s || (s === "overdue" ? a.overdue : s === "late" ? a.delay > 0 : a.group === s); }

  var COLS = [
    { k: "where", label: "Material › stage", cls: "wrap" },
    { k: "taskId", label: "ID", sv: function (a) { return isFinite(+a.taskId) ? +a.taskId : a.taskId; } },
    { k: "name", label: "Activity", cls: "wrap" },
    { k: "group", label: "Status", f: pills, sv: function (a) { return (a.overdue ? "0" : "1") + a.group; }, csv: function (a) { return a.status + (a.overdue ? " (overdue)" : ""); } },
    { k: "pct", label: "%", r: true, f: function (a) { return nf1.format(a.pct || 0) + "%"; } },
    { k: "baselineFinish", label: "Baseline finish", f: function (a) { return fmtD(a.baselineFinish); } },
    { k: "plannedFinish", label: "Planned finish", f: function (a) { return fmtD(a.plannedFinish); } },
    { k: "actualFinish", label: "Actual finish", f: function (a) { return fmtD(a.actualFinish); } },
    { k: "delay", label: "Delay vs baseline", r: true, f: function (a) { return delayTxt(a.delay, a.group !== "complete"); } },
  ];
  var CSV = [["where", "Material › stage"], ["wbs", "WBS"], ["taskId", "Task ID"], ["name", "Activity"], ["status", "Status"], ["overdue", "Overdue"], ["pct", "% complete"],
    ["baselineStart", "Baseline start"], ["baselineFinish", "Baseline finish"], ["plannedStart", "Planned start"], ["plannedFinish", "Planned finish"],
    ["actualStart", "Actual start"], ["actualFinish", "Actual finish"], ["delay", "Delay days vs baseline"], ["location", "Location"], ["trade", "Trade"], ["owner", "Owner"]];

  var D = { ctx: null, act: null, list: [], q: "", s: "", sort: { k: "plannedFinish", dir: "asc" }, all: false, opener: null, hist: [] };
  // ctx.cols / ctx.csv: the list's columns and CSV fields in place of the procurement ones
  function cols() { return (D.ctx && D.ctx.cols) || COLS; }
  function csvCols() { return (D.ctx && D.ctx.csv) || CSV; }
  function mine() { return $("drawer").getAttribute("data-owner") === "act" && !$("drawer").hidden; }
  function close() {
    $("drawer").hidden = true; $("scrim").hidden = true; $("drawer").removeAttribute("data-owner");
    document.body.style.overflow = "";
    if (D.opener && D.opener.focus && document.contains(D.opener)) D.opener.focus();
  }
  function show() {
    if ($("drawer").hidden) { D.opener = document.activeElement; $("drawer").hidden = false; $("scrim").hidden = false; document.body.style.overflow = "hidden"; }
    $("drawer").setAttribute("data-owner", "act");
    var tip = $("tip"); if (tip) tip.style.display = "none";
  }
  function open(ctx) {
    D.ctx = ctx; D.act = null; D.q = ""; D.s = ctx.status || ""; D.all = false; D.hist = [];
    if (ctx.sort) D.sort = ctx.sort;
    show(); renderList();
    if (ctx.act) { D.act = ctx.act; renderAct(); }  // straight to one activity (one of ctx.rows), with the list behind Back
    $("dw-close").focus();
  }
  function back() {
    if (D.hist.length) { D.act = D.hist.pop(); renderAct(); $("dw-close").focus(); return; }  // back through goto()
    D.act = null; renderList(); $("dw-close").focus();
  }
  // from one activity's detail to another's (ctx.bind links); Back returns to the one before
  function goto(a) { if (!mine() || !a) return; if (D.act) D.hist.push(D.act); D.act = a; renderAct(); $("dw-close").focus(); }

  function sumCell(v, l, cls) { return '<div><div class="sum-v' + (cls ? " " + cls : "") + '">' + v + '</div><div class="sum-l">' + esc(l) + "</div></div>"; }
  function summary(rows) {
    var n = function (f) { return rows.filter(f).length; };
    var mx = rows.reduce(function (m, a) { return a.delay != null && (m == null || a.delay > m) ? a.delay : m; }, null);
    return '<div class="sum">' + sumCell(fmtI(rows.length), "Activities") + sumCell(fmtI(n(function (a) { return a.group === "complete"; })), "Complete") +
      sumCell(fmtI(n(function (a) { return a.group === "started"; })), "Started") + sumCell(fmtI(n(function (a) { return a.group === "notStarted"; })), "Not started") +
      sumCell(fmtI(n(function (a) { return a.overdue; })), "Overdue", "late") + sumCell(fmtI(n(function (a) { return a.delay > 0; })), vs("Late vs baseline"), "late") +
      sumCell(mx == null ? DASH : (mx > 0 ? "+" : "") + fmtI(mx) + "d", "Largest delay", mx > 0 ? "late" : "") + "</div>";
  }
  function filtered() {
    var q = D.q.toLowerCase();
    return D.ctx.rows.filter(function (a) {
      return pass(a, D.s) && (!q || [a.name, a.taskId, a.where, a.wbs, a.location, a.trade, a.owner].join(" ").toLowerCase().indexOf(q) >= 0);
    });
  }
  function sorted(rows) {
    var c = cols().find(function (x) { return x.k === D.sort.k; }) || cols()[0], dir = D.sort.dir === "asc" ? 1 : -1;
    var v = c.sv || function (a) { return a[c.k]; };
    return rows.slice().sort(function (x, y) {
      var a = v(x), b = v(y);
      if (a == null || a === "") return 1; if (b == null || b === "") return -1;
      return (a < b ? -1 : a > b ? 1 : 0) * dir;
    });
  }
  function renderList() {
    var c = D.ctx;
    $("dw-back").hidden = true;
    $("dw-eyebrow").textContent = c.eyebrow || "Activities";
    $("dw-title").textContent = c.title;
    $("dw-sub").textContent = c.sub || "";
    $("dw-body").innerHTML = summary(c.rows) +
      '<div class="dw-tools"><input class="dw-search" id="ad-q" type="search" placeholder="Search activity, ID, WBS, location or owner" value="' + esc(D.q) + '" aria-label="Search these activities">' +
      '<div class="seg" id="ad-s" role="group" aria-label="Status">' + FILTERS.map(function (f) {
        var k = c.rows.filter(function (a) { return pass(a, f[0]); }).length;
        return '<button type="button" data-v="' + f[0] + '" aria-pressed="' + (D.s === f[0]) + '">' + vs(f[1]) + " " + fmtI(k) + "</button>";
      }).join("") + "</div>" + '<button class="btn" type="button" id="ad-csv">Download CSV</button></div>' +
      '<div class="dw-count" id="ad-count"></div><div id="ad-table"></div>';
    $("ad-q").addEventListener("input", function () { D.q = this.value.trim(); D.all = false; renderTable(); });
    $("ad-s").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      D.s = b.getAttribute("data-v"); D.all = false;
      $("ad-s").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      renderTable();
    });
    $("ad-csv").addEventListener("click", function () {
      function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
      var CSV = csvCols();
      var text = "﻿" + CSV.map(function (x) { return q(x[0] === "where" && D.ctx.whereLabel || vs(x[1])); }).join(",") + "\n" + D.list.map(function (a) {
        return CSV.map(function (x) { return q(x[0] === "overdue" ? (a.overdue ? "Yes" : "No") : a[x[0]]); }).join(",");
      }).join("\n");
      var el = document.createElement("a");
      el.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      el.download = (meta.key || "JUI") + "-" + c.title.replace(/[^\w-]+/g, "-").toLowerCase().slice(0, 60) + ".csv";
      document.body.appendChild(el); el.click(); el.remove();
      setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000);
    });
    renderTable();
    $("dw-body").scrollTop = 0;
  }
  function renderTable() {
    var rows = filtered();
    D.list = sorted(rows);
    var shown = D.all ? D.list : D.list.slice(0, 200);
    $("ad-count").textContent = fmtI(rows.length) + " of " + fmtI(D.ctx.rows.length) + " activities" + (shown.length < rows.length ? ", showing the first 200" : "");
    if (!rows.length) { $("ad-table").innerHTML = '<div class="empty">No activities match this search or status.</div>'; return; }
    var COLS = cols();
    $("ad-table").innerHTML = '<div class="tbl-wrap"><table><thead><tr>' + COLS.map(function (c) {
      var s = c.k === D.sort.k ? (D.sort.dir === "asc" ? "ascending" : "descending") : "none";
      return '<th class="' + (c.r ? "r " : "") + 'sortable" data-k="' + c.k + '" aria-sort="' + s + '" tabindex="0">' + esc(c.k === "where" && D.ctx.whereLabel || vs(c.label)) + "</th>";
    }).join("") + "</tr></thead><tbody>" + shown.map(function (a, i) {
      return '<tr class="clickable" tabindex="0" data-i="' + i + '">' + COLS.map(function (c) { return '<td class="' + (c.r ? "r " : "") + (c.cls || "") + '">' + (c.f ? c.f(a) : esc(a[c.k])) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody></table></div>" +
      (shown.length < rows.length ? '<div style="margin-top:10px"><button class="btn" type="button" id="ad-more">Show all ' + fmtI(rows.length) + "</button></div>" : "");
    var t = $("ad-table");
    t.querySelectorAll("th.sortable").forEach(function (th) {
      function go() { var k = th.getAttribute("data-k"); D.sort = { k: k, dir: D.sort.k === k && D.sort.dir === "asc" ? "desc" : "asc" }; renderTable(); }
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    t.querySelectorAll("tbody tr").forEach(function (tr) {
      function go() { D.act = D.list[+tr.getAttribute("data-i")]; renderAct(); $("dw-close").focus(); }
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", function (e) { if (e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } });
    });
    if ($("ad-more")) $("ad-more").addEventListener("click", function () { D.all = true; renderTable(); });
  }
  function renderAct() {
    var a = D.act, i = D.list.indexOf(a), done = a.group === "complete", started = !!a.actualStart;
    $("dw-back").hidden = false;
    $("dw-eyebrow").textContent = "Activity " + (a.taskId || DASH);
    $("dw-title").textContent = a.name || DASH;
    $("dw-sub").textContent = a.where || "";
    var h = "";
    if (D.list.length > 1 && i >= 0) h += '<div class="dw-nav"><button class="btn" type="button" id="ad-prev"' + (i ? "" : " disabled") + '>&#8592; Previous</button><button class="btn" type="button" id="ad-next"' +
      (i < D.list.length - 1 ? "" : " disabled") + ">Next &#8594;</button><span>" + fmtI(i + 1) + " of " + fmtI(D.list.length) + " in " + esc(D.ctx.title) + "</span></div>";
    h += '<div class="pills">' + pills(a) + "</div>";
    h += '<div class="sum" style="margin-top:14px">' + sumCell(nf1.format(a.pct || 0) + "%", "Complete") +
      sumCell(a.delay == null ? DASH : (a.delay > 0 ? "+" : "") + fmtI(a.delay) + "d", vs("Finish vs baseline"), a.delay > 0 ? "late" : a.delay < 0 ? "early" : "") +
      sumCell(fmtD(a.finish), done ? "Finished" : "Due (planned)") + "</div>";
    function row(l, b, p, x) { return "<tr><th>" + l + "</th><td>" + fmtD(b) + "</td><td>" + fmtD(p) + "</td><td>" + (x || DASH) + "</td></tr>"; }
    h += '<div class="sec-h">Dates <span>baseline · planned · actual</span></div><div class="tbl-wrap"><table class="ad-dates"><thead><tr><th></th><th>Baseline</th><th>Planned</th><th>Actual</th></tr></thead><tbody>' +
      row("Start", a.baselineStart, a.plannedStart, started ? fmtD(a.actualStart) : "Not started") +
      row("Finish", a.baselineFinish, a.plannedFinish, a.actualFinish ? fmtD(a.actualFinish) : started ? "In progress" : DASH) +
      "<tr><th>Duration</th><td>" + days(dur(a.baselineStart, a.baselineFinish)) + "</td><td>" + days(dur(a.plannedStart, a.plannedFinish)) + "</td><td>" +
      (started ? days(dur(a.actualStart, a.actualFinish || todayIso())) + (a.actualFinish ? "" : " so far") : DASH) + "</td></tr></tbody></table></div>";
    var ps = diff(a.actualStart || a.plannedStart, a.baselineStart);
    h += '<div class="sec-h">Delays</div><dl class="dl">' +
      "<div><dt>Start vs baseline</dt><dd>" + delayTxt(ps, !started) + "</dd></div>" +
      "<div><dt>" + vs("Finish vs baseline") + "</dt><dd>" + delayTxt(a.delay, !done) + "</dd></div>" +
      "<div><dt>Planned finish vs baseline</dt><dd>" + delayTxt(diff(a.plannedFinish, a.baselineFinish), false) + "</dd></div>" +
      (done ? "<div><dt>Actual vs planned finish</dt><dd>" + delayTxt(diff(a.actualFinish, a.plannedFinish), false) + "</dd></div>" :
        "<div><dt>Days to planned finish</dt><dd>" + (a.plannedFinish ? (a.overdue ? '<span class="late">' + days(-diff(a.plannedFinish, todayIso())) + " past</span>" : days(diff(a.plannedFinish, todayIso()))) : DASH) + "</dd></div>") +
      "</dl>";
    h += '<div class="sec-h">Details</div><dl class="dl">' +
      [[a.whereLabel || D.ctx.whereLabel || "Material › stage", a.where], ["WBS", a.wbs], ["Task ID", a.taskId], ["Status", a.status], ["Location", a.location], ["Trade", a.trade], ["Owner", a.owner]].map(function (x) {
        return "<div><dt>" + x[0] + "</dt><dd>" + (x[1] ? esc(x[1]) : DASH) + "</dd></div>";
      }).join("") + "</dl>";
    if (D.ctx.extra) h = h.replace('<div class="sec-h">Details</div>', D.ctx.extra(a) + '<div class="sec-h">Details</div>');
    else if (window.JUILogic) h += window.JUILogic.section(a);  // predecessors and successors (logic.js)
    $("dw-body").innerHTML = h;
    $("dw-body").scrollTop = 0;
    if (D.ctx.bind) D.ctx.bind($("dw-body"), a, goto);
    else if (window.JUILogic) window.JUILogic.bind($("dw-body"), a, goto, D.ctx);
    function step(d) { D.act = D.list[i + d]; renderAct(); var b = $(d < 0 ? "ad-prev" : "ad-next"); if (b && !b.disabled) b.focus(); }
    if ($("ad-prev")) { $("ad-prev").addEventListener("click", function () { step(-1); }); $("ad-next").addEventListener("click", function () { step(1); }); }
  }
  function todayIso() { var s = P.metrics && P.metrics.scurve; return (s && (s.procurement || s.mep || {}).today) || new Date().toISOString().slice(0, 10); }

  // run before app.js's handlers (capture) and stop them while this module owns the drawer
  function guard(fn) { return function (e) { if (!mine()) return; e.stopImmediatePropagation(); fn(e); }; }
  $("dw-close").addEventListener("click", guard(close), true);
  $("scrim").addEventListener("click", guard(close), true);
  $("dw-back").addEventListener("click", guard(back), true);
  document.addEventListener("keydown", function (e) {
    if (!mine()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (D.act) back(); else close(); }
    else if (D.act && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !/INPUT|SELECT/.test(e.target.tagName)) {
      e.stopImmediatePropagation();
      var b = $(e.key === "ArrowLeft" ? "ad-prev" : "ad-next"); if (b && !b.disabled) b.click();
    }
  }, true);

  window.JUIActDrill = { open: open, goto: goto };
})();
