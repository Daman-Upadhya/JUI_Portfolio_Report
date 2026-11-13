/* Critical path page: the master schedule's logic (type=taskRelationship) over its task feed, scheduled
   from today in calculation.py schedule_logic(). The page gets the summary (metrics.scurve.logic); the
   network (about 4 MB) is dist/<key>/logic.json, loaded when the tab first opens.
   Sections: KPI cards, the finish bridge (planned -> plan through its logic -> forecast), the driving
   path to the forecast finish, delay root causes and what they push, total float, impact by WBS group,
   logic health (checks, relationship types, lags). Every activity opens the activity drawer
   (actdrill.js) with its predecessors and successors, which open in turn. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.scurve && P.metrics.scurve.logic, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  if (!M || M.unavailable || !$("pg-cp") || !window.JUIProcUI || !window.JUIActDrill) return;
  // display.logic.page false: no Critical path tab; the network still gives every activity drawer its
  // predecessors and successors (window.JUILogic, used by actdrill.js)
  var PAGE = ((P.data || {}).logic || {}).page !== false;
  $("tab-cp").hidden = !PAGE;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 }), nf1 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 1 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  function dayOf(iso) { return iso ? Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(2000, 0, 1)) / 864e5) : null; }
  function iso(d) { return d == null ? null : new Date(Date.UTC(2000, 0, 1) + d * 864e5).toISOString().slice(0, 10); }
  function sgn(v) { return v == null ? DASH : v === 0 ? "0d" : (v > 0 ? "+" : "−") + fmtI(Math.abs(v)) + "d"; }
  function slipTag(v) { return '<span class="' + (v > 0 ? "pr-late" : v < 0 ? "pr-early" : "") + '">' + (v == null ? DASH : v === 0 ? "on date" : sgn(v)) + "</span>"; }

  var slip0 = M.finishSlip;
  $("n-cp").textContent = slip0 > 0 ? "+" + fmtI(slip0) + "d" : fmtI(M.critical) + " critical";
  $("cp-title").textContent = M.title;
  $("cp-desc").textContent = "The master schedule's " + fmtI(M.links) + " relationships over its " + fmtI(M.activities) +
    " linked activities, scheduled from today: work done keeps its actual dates, open work keeps its planned finish and moves only when its predecessors (with their type and lag) or today hold it. " +
    "Total float is measured against the " + (M.target === "baseline" ? "baseline" : "planned") + " finish (" + fmtD(M.targetFinish) + "); negative float is how far an activity's chain runs past it. Calendar days throughout.";

  /* ---------- the network (logic.json), loaded once ---------- */
  var L = null, A, C = {}, S, T, PRED, SUCC, LOOP, TG, PF, ROW = {}, loading = false;
  var F = { group: "", q: "", linkMode: "lag", linkAsc: false, linkAll: false, rootsAll: false };
  function load() {
    if (L || loading) return;
    loading = true;
    fetch(M.file, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (d) {
      L = d; A = d.acts; S = d.strings; T = d.today; TG = d.targetDay; PF = dayOf(M.forecastFinish);
      d.columns.forEach(function (k, i) { C[k] = i; });
      PRED = A.map(function () { return []; }); SUCC = A.map(function () { return []; });
      d.links.forEach(function (l, k) { PRED[l[1]].push(k); SUCC[l[0]].push(k); });
      LOOP = {}; (d.loopLinks || []).forEach(function (k) { LOOP[k] = 1; });
      if (PAGE) { $("cp-load").hidden = true; $("cp-body").hidden = false; controls(); render(); }
      pending();
    }).catch(function (e) {
      loading = false;
      var el = $("lg-sec"); if (el) el.innerHTML = '<div class="sec-h">Predecessors &amp; successors</div><div class="empty">The schedule logic could not be loaded (' + esc(e.message) + ").</div>";
      $("cp-load").textContent = "The schedule network could not be loaded (" + e.message + "). Open this page from the published site or the local preview server.";
    });
  }
  document.addEventListener("jui:page", function (e) { if (e.detail === "cp") load(); });
  if (PAGE && !$("pg-cp").hidden) load();

  /* ---------- predecessors and successors in any activity drawer (actdrill.js) ----------
     Drawer rows carry the master schedule's taskId (Overview weighted tasks, Milestones, Procurement,
     MEP, Commissioning); the lists open on that activity in logic.json, loaded on the first detail. */
  var TID = null, WAIT = null;
  function idxOf(a) {
    if (a.lgi != null) return a.lgi;
    if (!TID) { TID = {}; A.forEach(function (x, i) { (TID[x[C.taskId]] = TID[x[C.taskId]] || []).push(i); }); }
    var c = TID[String(a.taskId == null ? "" : a.taskId)];
    if (!c) return -1;
    return c.filter(function (i) { return A[i][C.name] === a.name; })[0] || c[0];
  }
  var NAV = {};
  function navRow(i, vsPlan) {  // a drawer row for a linked activity, its delay measured as the drawer's other rows
    var key = i + (vsPlan ? "p" : "b");
    if (NAV[key]) return NAV[key];
    var a = A[i], done = !open(i), end = done ? a[C.ae] : a[C.pe] != null ? Math.max(a[C.pe], T) : null;
    var ref = vsPlan ? a[C.pe] : a[C.be];
    var dl = vsPlan ? (done ? (a[C.ae] != null && a[C.pe] != null ? a[C.ae] - a[C.pe] : null) : a[C.pe] != null && a[C.pe] < T ? T - a[C.pe] : null)
      : (end != null && ref != null ? end - ref : null);
    return (NAV[key] = {
      lgi: i, whereLabel: "WBS group › parent", where: where(i), taskId: a[C.taskId], name: a[C.name], status: S.status[a[C.status]], group: st(i), pct: a[C.pct],
      baselineStart: iso(a[C.bs]), baselineFinish: iso(a[C.be]), plannedStart: iso(a[C.ps]), plannedFinish: iso(a[C.pe]),
      actualStart: iso(a[C.as]), actualFinish: iso(a[C.ae]), finish: done ? iso(a[C.ae]) || iso(a[C.pe]) : iso(a[C.pe]),
      overdue: !done && a[C.pe] != null && a[C.pe] < T, delay: dl, wbs: S.group[a[C.group]], location: "", trade: "", owner: "",
    });
  }
  function lists(a) {
    if (!L) {
      load();
      return '<div id="lg-sec"><div class="sec-h">Predecessors &amp; successors</div><div class="empty">Loading the schedule logic…</div></div>';
    }
    var i = idxOf(a);
    if (i < 0) return '<div id="lg-sec"><div class="sec-h">Predecessors &amp; successors</div><div class="empty">Not linked in the master schedule.</div></div>';
    return '<div id="lg-sec"><div class="sec-h">Predecessors <span>' + PRED[i].length + "</span></div>" + linkRows(i, "p") +
      '<div class="sec-h">Successors <span>' + SUCC[i].length + "</span></div>" + linkRows(i, "s") + "</div>";
  }
  function bindLists(body, a, go, ctx) {
    WAIT = L ? null : { a: a, go: go, ctx: ctx };
    if (!L) return;
    var vsPlan = !!(ctx && ctx.vs === "plan");
    body.querySelectorAll("#lg-sec [data-cpi]").forEach(function (el) {
      function f(e) { e.preventDefault(); go(navRow(+el.getAttribute("data-cpi"), vsPlan)); }
      el.addEventListener("click", f);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") f(e); });
    });
  }
  function pending() {  // the drawer asked before logic.json arrived: fill its lists now
    var el = $("lg-sec"), w = WAIT;
    WAIT = null;
    if (!el || !w) return;
    el.outerHTML = lists(w.a);
    bindLists($("dw-body"), w.a, w.go, w.ctx);
  }
  window.JUILogic = { section: lists, bind: bindLists };

  /* ---------- per activity ---------- */
  function st(i) { return L.states[A[i][C.state]]; }
  function open(i) { return A[i][C.state] !== 0; }
  function delayed(i) {
    var a = A[i];
    return open(i) && ((st(i) === "notStarted" && a[C.ps] != null && a[C.ps] < T) || (a[C.pe] != null && a[C.pe] < T));
  }
  function slip(i) { var a = A[i]; return !open(i) ? (a[C.ae] != null && a[C.pe] != null ? a[C.ae] - a[C.pe] : null) : a[C.pe] != null ? a[C.ef] - a[C.pe] : null; }
  function tf(i) { return A[i][C.tf]; }
  function tfFinish(i) { return tf(i) == null ? null : tf(i) + (PF - TG); }  // float to the forecast finish
  function where(i) { return S.group[A[i][C.group]] + " › " + S.parent[A[i][C.parent]]; }
  function inView(i) {
    if (F.group !== "" && A[i][C.group] !== +F.group) return false;
    return !F.q || (A[i][C.name] + " " + A[i][C.taskId]).toLowerCase().indexOf(F.q) >= 0;
  }
  function floatCls(v) { return v == null ? "" : v < 0 ? "cp-neg" : v === 0 ? "cp-crit" : v <= M.nearDays ? "cp-near" : ""; }
  function floatTxt(v) { return v == null ? '<span class="faint">' + DASH + "</span>" : '<span class="cp-ft ' + floatCls(v) + '">' + (v > 0 ? "" : v < 0 ? "−" : "") + fmtI(Math.abs(v)) + "d</span>"; }
  var WHY = { actual: "its actual dates", plan: "its planned start", today: "today (it is overdue)", logic: "a predecessor" };
  function row(i) {
    if (ROW[i]) return ROW[i];
    var a = A[i], done = !open(i);
    return (ROW[i] = {
      i: i, where: where(i), taskId: a[C.taskId], name: a[C.name], status: S.status[a[C.status]], group: st(i), pct: a[C.pct],
      baselineStart: iso(a[C.bs]), baselineFinish: iso(a[C.be]), plannedStart: iso(a[C.ps]), plannedFinish: iso(a[C.pe]),
      actualStart: iso(a[C.as]), actualFinish: iso(a[C.ae]), finish: done ? iso(a[C.ae]) || iso(a[C.pe]) : iso(a[C.pe]),
      overdue: delayed(i), delay: slip(i), wbs: S.group[a[C.group]], location: "", trade: "", owner: "",
      es: iso(a[C.es]), ef: iso(a[C.ef]), tf: done ? null : tf(i),
    });
  }

  /* ---------- the drawer: activity lists and one activity with its logic ---------- */
  function pills(a) { return '<span class="pill ' + a.group + '">' + esc(a.status) + "</span>" + (a.overdue ? ' <span class="pill overdue">Delayed</span>' : ""); }
  var COLS = [
    { k: "where", label: "WBS group › parent", cls: "wrap" },
    { k: "taskId", label: "ID", sv: function (a) { return isFinite(+a.taskId) ? +a.taskId : a.taskId; } },
    { k: "name", label: "Activity", cls: "wrap" },
    { k: "group", label: "Status", f: pills, sv: function (a) { return (a.overdue ? "0" : "1") + a.group; } },
    { k: "tf", label: "Float", r: true, f: function (a) { return floatTxt(a.tf); } },
    { k: "plannedFinish", label: "Planned finish", f: function (a) { return fmtD(a.plannedFinish); } },
    { k: "ef", label: "Forecast finish", f: function (a) { return fmtD(a.ef); } },
    { k: "delay", label: "Slip vs plan", r: true, f: function (a) { return slipTag(a.delay); } },
  ];
  var CSV = [["where", "WBS group › parent"], ["taskId", "Task ID"], ["name", "Activity"], ["status", "Status"], ["overdue", "Delayed"], ["pct", "% complete"],
    ["baselineStart", "Baseline start"], ["baselineFinish", "Baseline finish"], ["plannedStart", "Planned start"], ["plannedFinish", "Planned finish"],
    ["actualStart", "Actual start"], ["actualFinish", "Actual finish"], ["es", "Forecast start"], ["ef", "Forecast finish"], ["tf", "Total float (days)"], ["delay", "Slip vs plan (days)"]];

  function downstream(i) {  // open activities after it, through any successor link
    var seen = {}, stack = [i], n = 0;
    while (stack.length) {
      var x = stack.pop();
      SUCC[x].forEach(function (k) { if (LOOP[k]) return; var s = L.links[k][1]; if (!seen[s]) { seen[s] = 1; if (open(s)) n++; stack.push(s); } });
    }
    return n;
  }
  function linkRows(i, side) {
    var ks = side === "p" ? PRED[i] : SUCC[i];
    if (!ks.length) return '<div class="empty">' + (side === "p" ? "No predecessor: nothing holds its start." : "No successor: nothing waits for its finish.") + "</div>";
    var rs = ks.map(function (k) {
      var l = L.links[k], j = side === "p" ? l[0] : l[1];
      var drives = side === "p" ? A[i][C.driver] === j : A[j][C.driver] === i;
      return { k: k, j: j, t: L.types[l[2]], lag: l[3], drives: drives };
    }).sort(function (x, y) { return (y.drives - x.drives) || ((A[x.j][C.ef] || 0) - (A[y.j][C.ef] || 0)); });
    return '<div class="tbl-wrap"><table class="cp-lt"><thead><tr><th>Link</th><th>ID</th><th class="it">Activity</th><th>Status</th><th>' + (side === "p" ? "Forecast finish" : "Forecast start") + '</th><th class="r">Float</th></tr></thead><tbody>' +
      rs.map(function (r) {
        var b = A[r.j], R = row(r.j);
        return '<tr class="clickable" data-cpi="' + r.j + '" tabindex="0"><td><b>' + r.t + "</b>" + (r.lag ? " " + (r.lag > 0 ? "+" : "") + r.lag + "d" : "") +
          (r.drives ? ' <span class="pill cp-drv" title="' + (side === "p" ? "Sets this activity's forecast date" : "This activity sets its forecast date") + '">drives</span>' : "") +
          (LOOP[r.k] ? ' <span class="pill overdue" title="Closes a logic loop; left out of the analysis">loop</span>' : "") +
          "</td><td>" + esc(b[C.taskId]) + '</td><td class="it">' + esc(b[C.name]) + '<span class="it-sub">' + esc(R.where) + "</span></td><td>" + pills(R) + "</td><td>" +
          fmtD(side === "p" ? R.ef : R.es) + '</td><td class="r">' + floatTxt(R.tf) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function extra(a) {
    var i = a.i, x = A[i], why = L.why[x[C.why]], d = x[C.driver], o = open(i);
    var h = '<div class="sec-h">Schedule logic <span>forecast from today through its predecessors</span></div><dl class="dl">' +
      "<div><dt>Forecast start · finish</dt><dd>" + fmtD(a.es) + " · " + fmtD(a.ef) + "</dd></div>" +
      "<div><dt>Slip vs planned finish</dt><dd>" + slipTag(a.delay) + "</dd></div>";
    if (o) {
      var pl = x[C.pf] - (x[C.pe] == null ? x[C.pf] : x[C.pe]), od = x[C.ef] - x[C.pf];
      h += "<div><dt>Of which</dt><dd>" + sgn(pl) + " where the planned dates break the logic · " + sgn(od) + " from overdue work</dd></div>" +
        "<div><dt>Total float</dt><dd>" + floatTxt(a.tf) + " against the " + (M.target === "baseline" ? "baseline" : "planned") + " finish" +
        (a.tf != null && a.tf <= 0 ? ' <span class="pill overdue">Critical</span>' : a.tf != null && a.tf <= M.nearDays ? ' <span class="pill cp-nearp">Near-critical</span>' : "") + "</dd></div>" +
        "<div><dt>Forecast set by</dt><dd>" + (why === "logic" && d >= 0 ? 'predecessor <button type="button" class="dr-name" data-cpi="' + d + '"><b>' + esc(A[d][C.taskId] + " " + A[d][C.name]) + "</b></button>" : WHY[why] || why) + "</dd></div>" +
        "<div><dt>Open work after it</dt><dd>" + fmtI(downstream(i)) + " activities</dd></div></dl>" +
        '<div class="cp-wi"><label>What if it slips <input type="number" id="cp-wi" value="10" min="0" max="9999" step="1"> more days?</label><span id="cp-wo"></span></div>';
    } else h += "<div><dt>Status</dt><dd>Complete: it no longer moves the forecast</dd></div></dl>";
    h += '<div class="sec-h">Predecessors <span>' + PRED[i].length + "</span></div>" + linkRows(i, "p") +
      '<div class="sec-h">Successors <span>' + SUCC[i].length + "</span></div>" + linkRows(i, "s");
    return h;
  }
  function bind(body, a, go) {
    body.querySelectorAll("[data-cpi]").forEach(function (el) {
      function f(e) { e.preventDefault(); go(row(+el.getAttribute("data-cpi"))); }
      el.addEventListener("click", f);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") f(e); });
    });
    var inp = body.querySelector("#cp-wi");
    if (!inp) return;
    function what() {
      var n = Math.max(0, Math.round(+inp.value || 0)), ff = tfFinish(a.i), mv = Math.max(0, n - (ff || 0));
      $("cp-wo").innerHTML = mv > 0 ? 'The forecast finish moves <b class="pr-late">+' + fmtI(mv) + "d</b> to " + fmtD(iso(PF + mv)) + "." :
        "The forecast finish holds: it has " + fmtI(ff) + " days of float to it." + (a.tf != null && n > a.tf && a.tf >= 0 ? ' It would pass the planned finish by <b class="pr-late">+' + fmtI(n - a.tf) + "d</b>." : "");
    }
    inp.addEventListener("input", what);
    what();
  }
  function drill(title, sub, idx, act) {
    var rows = idx.map(row);
    window.JUIActDrill.open({ eyebrow: "Critical path", title: title, sub: sub, rows: rows, whereLabel: "WBS group › parent", vs: "plan", cols: COLS, csv: CSV,
      extra: extra, bind: bind, sort: { k: "tf", dir: "asc" }, act: act != null ? row(act) : null });
  }

  /* ---------- KPI cards and the finish bridge ---------- */
  function openIdx() { var o = []; for (var i = 0; i < A.length; i++) if (open(i) && inView(i)) o.push(i); return o; }
  var SETS = {
    critical: ["Critical activities", "Float of 0 days or less against the planned finish", function (i) { return tf(i) != null && tf(i) <= 0; }],
    near: ["Near-critical activities", "Float of 1 to " + M.nearDays + " days", function (i) { return tf(i) > 0 && tf(i) <= M.nearDays; }],
    delayed: ["Delayed activities", "Planned start passed and not started, or planned finish passed and not complete", delayed],
  };
  function kpis(o) {
    var c = function (f) { return o.filter(f).length; };
    var neg = c(function (i) { return tf(i) < 0; }), lead = L.links.filter(function (l) { return l[3] < 0; }).length;
    window.JUIProcUI.kpis($("cp-kpis"), [
      { icon: "truck", v: fmtD(M.forecastFinish), l: "Forecast finish", sub: slipTag(M.finishSlip) + " vs planned " + fmtD(M.plannedFinish), tone: M.finishSlip > 0 ? "bad" : "good", attr: 'data-cpk="path"' },
      { icon: "alert", v: fmtI(c(SETS.critical[2])), l: "Critical activities", sub: fmtI(neg) + " run past the planned finish", tone: neg ? "bad" : "warn", attr: 'data-cpk="critical"' },
      { icon: "prog", v: fmtI(c(SETS.near[2])), l: "Near-critical", sub: "float 1–" + M.nearDays + " days", tone: "warn", attr: 'data-cpk="near"' },
      { icon: "trend", v: fmtI(c(delayed)), l: "Delayed activities", sub: fmtI(L.roots.filter(function (r) { return inView(r[0]); }).length) + " root causes", tone: "bad", attr: 'data-cpk="delayed"' },
      { icon: "seal", v: fmtI(L.path.length), l: "Driving path", sub: "activities setting the forecast finish", tone: "brand", attr: 'data-cpk="path"' },
      { icon: "clock", v: fmtI(M.maxLag) + "d<small> / " + fmtI(M.minLag) + "d</small>", l: "Max / min lag", sub: fmtI(M.lagLinks) + " links with a lag · avg " + nf1.format(M.avgLag) + "d · " + fmtI(lead) + " leads", tone: "muted", attr: 'data-cpk="lags"' },
    ]);
  }
  function bridge() {
    var steps = [
      ["Baseline finish", M.baselineFinish, null, "the original target"],
      ["Planned finish", M.plannedFinish, dayOf(M.plannedFinish) - dayOf(M.baselineFinish), "vs baseline: the plan as it stands"],
      ["Plan through its logic", M.logicFinish, M.logicSlip, "where planned dates break their own links"],
      ["Forecast with today's progress", M.forecastFinish, M.progressSlip, "what overdue work adds"],
    ];
    $("cp-bridge").innerHTML = steps.map(function (s, k) {
      return '<div class="cp-step' + (k === 3 ? " last" : "") + '"><div class="cp-sl">' + s[0] + '</div><div class="cp-sv">' + fmtD(s[1]) + "</div>" +
        '<div class="cp-ss">' + (s[2] == null ? "" : slipTag(s[2]) + " ") + esc(s[3]) + "</div></div>";
    }).join('<span class="cp-arr" aria-hidden="true">→</span>');
  }

  /* ---------- the driving path: planned bar (light) and forecast bar (solid) per activity ---------- */
  function path() {
    var ix = L.path;
    if (!ix.length) { $("cp-path").innerHTML = '<div class="empty">No open activity sets the finish.</div>'; return; }
    var ds = [T];
    ix.forEach(function (i) { [C.ps, C.pe, C.es, C.ef].forEach(function (c) { if (A[i][c] != null) ds.push(A[i][c]); }); });
    var lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds);
    var d0 = new Date(Date.UTC(2000, 0, 1) + lo * 864e5), d1 = new Date(Date.UTC(2000, 0, 1) + hi * 864e5);
    lo = dayOf(new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1)).toISOString().slice(0, 10));
    hi = dayOf(new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 1)).toISOString().slice(0, 10));
    function x(d) { return (100 * (d - lo) / (hi - lo)).toFixed(3) + "%"; }
    function w(a, b) { return "calc(" + x(Math.max(a, b)) + " - " + x(Math.min(a, b)) + ")"; }
    var grid = "", labs = "", m = new Date(Date.UTC(2000, 0, 1) + lo * 864e5), months = (hi - lo) / 30.4, every = months > 24 ? 3 : months > 12 ? 2 : 1;
    while (dayOf(m.toISOString().slice(0, 10)) < hi) {
      var md = dayOf(m.toISOString().slice(0, 10)), y = m.getUTCMonth() === 0;
      grid += '<i class="ms-gl' + (y ? " y" : "") + '" style="left:' + x(md) + '"></i>';
      if (m.getUTCMonth() % every === 0) labs += '<span class="ms-ml' + (y ? " y" : "") + '" style="left:' + x(md) + '">' + MON[m.getUTCMonth()] + " " + String(m.getUTCFullYear()).slice(2) + "</span>";
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    var bg = '<div class="ms-bg">' + grid + '<i class="ms-today" style="left:' + x(T) + '"></i>' + (TG != null ? '<i class="cp-tg" style="left:' + x(TG) + '"></i>' : "") + "</div>";
    var h = '<div class="ms-tl cp-tl"><div class="ms-row ms-head"><div class="ms-lab">Activity</div><div class="ms-trk">' + labs + '<span class="ms-tdl" style="left:' + x(T) + '">Today</span></div></div>';
    ix.forEach(function (i, n) {
      var a = A[i], R = row(i), ms = a[C.milestone], cls = floatCls(R.tf) || "cp-ok";
      var plan = a[C.ps] != null && a[C.pe] != null && !ms ? '<i class="cp-bp" style="left:' + x(a[C.ps]) + ";width:" + w(a[C.ps], a[C.pe]) + '"></i>' : a[C.pe] != null ? '<i class="ms-mk base" style="left:' + x(a[C.pe]) + '"></i>' : "";
      var fc = ms ? '<i class="ms-mk ' + cls + '" style="left:' + x(a[C.ef]) + '"></i>' : '<i class="cp-bf ' + cls + '" style="left:' + x(a[C.es]) + ";width:" + w(a[C.es], a[C.ef]) + '"></i>';
      h += '<div class="ms-row cp-pr clickable" role="button" tabindex="0" data-cpp="' + n + '" title="' + esc(R.name + "\nPlanned " + fmtD(R.plannedStart) + " – " + fmtD(R.plannedFinish) + "\nForecast " + fmtD(R.es) + " – " + fmtD(R.ef)) + '">' +
        '<div class="ms-lab"><div class="ms-t"><b>' + esc(R.taskId) + " · " + esc(R.name) + '</b><span class="it-sub">' + esc(R.where) + " · finish " + fmtD(R.ef) + " " + slipTag(R.delay) + " · float " + floatTxt(R.tf) + "</span></div>" +
        (R.overdue ? '<span class="pill overdue">Delayed</span>' : "") + '</div><div class="ms-trk">' + bg + plan + fc + "</div></div>";
    });
    $("cp-path").innerHTML = h + "</div>";
  }

  /* ---------- delay root causes ---------- */
  function lateTxt(i) {
    var a = A[i];
    if (st(i) === "notStarted" && a[C.ps] != null && a[C.ps] < T) return ["Not started · due to start " + fmtD(iso(a[C.ps])), T - a[C.ps]];
    return ["Not finished · due " + fmtD(iso(a[C.pe])), T - a[C.pe]];
  }
  function rootsIn() { return L.roots.filter(function (r) { return inView(r[0]); }); }
  function roots() {
    var rs = rootsIn(), shown = F.rootsAll ? rs : rs.slice(0, 25);
    $("cp-roots-n").textContent = fmtI(rs.length) + " root causes";
    if (!rs.length) { $("cp-roots").innerHTML = '<div class="empty">No delayed activity matches these filters.</div>'; return; }
    $("cp-roots").innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>ID</th><th class="it">Activity</th><th>Status</th><th>Why late</th><th class="r">Late by</th><th class="r">Pushes later</th><th class="r">Float</th><th>Finish impact</th></tr></thead><tbody>' +
      shown.map(function (r, n) {
        var i = r[0], R = row(i), lt = lateTxt(i);
        var imp = r[3] ? '<span class="pill overdue">Drives finish</span>' : r[4] > 0 ? '<span class="pr-late">+' + fmtI(r[4]) + "d past plan</span>" : '<span class="faint">None</span>';
        return '<tr class="clickable" tabindex="0" data-cpr="' + n + '"><td>' + esc(R.taskId) + '</td><td class="it"><b>' + esc(R.name) + '</b><span class="it-sub">' + esc(R.where) + "</span></td><td>" + pills(R) +
          "</td><td>" + lt[0] + '</td><td class="r">' + fmtI(lt[1]) + 'd</td><td class="r">' + (r[1] ? fmtI(r[1]) + ' <span class="it-sub">up to ' + sgn(r[2]) + "</span>" : '<span class="faint">' + DASH + "</span>") +
          '</td><td class="r">' + floatTxt(R.tf) + "</td><td>" + imp + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      (shown.length < rs.length ? '<div style="margin-top:10px"><button class="btn" type="button" id="cp-roots-more">Show all ' + fmtI(rs.length) + "</button></div>" : "");
  }

  /* ---------- total float ---------- */
  function buckets() {
    var n = M.nearDays, hf = M.highFloat;
    return [
      ["neg", "Past the planned finish", "below 0", function (v) { return v < 0; }],
      ["crit", "Critical", "0 days", function (v) { return v === 0; }],
      ["near", "Near-critical", "1–" + n + " days", function (v) { return v > 0 && v <= n; }],
      ["mid", "Watch", (n + 1) + "–" + hf + " days", function (v) { return v > n && v <= hf; }],
      ["hi", "Comfortable", (hf + 1) + "–90 days", function (v) { return v > hf && v <= 90; }],
      ["vhi", "High float", "over 90 days", function (v) { return v > 90; }],
    ];
  }
  function floatBars(o) {
    var B = buckets(), cnt = B.map(function (b) { return o.filter(function (i) { return tf(i) != null && b[3](tf(i)); }).length; });
    var mx = Math.max.apply(null, cnt.concat([1]));
    $("cp-float").innerHTML = B.map(function (b, k) {
      return '<div class="cp-fb drill" role="button" tabindex="0" data-cpb="' + k + '"><span class="cp-fl"><b>' + b[1] + "</b><small>" + b[2] + '</small></span><span class="cp-ftr"><i class="cp-fbar cp-b-' + b[0] + '" style="width:' +
        (cnt[k] ? Math.max(1.5, 100 * Math.sqrt(cnt[k] / mx)) : 0).toFixed(1) + '%"></i></span><span class="cp-fn">' + fmtI(cnt[k]) + "<small>" + (o.length ? nf1.format(100 * cnt[k] / o.length) : 0) + "%</small></span></div>";
    }).join("") + '<div class="hint">Bar length is scaled by square root so small groups stay visible. Open activities only.</div>';
  }

  /* ---------- impact by WBS group ---------- */
  function groups() {
    var G = S.group.map(function (name, g) { return { g: g, name: name, open: 0, crit: 0, near: 0, del: 0, roots: 0, ff: null, pf: null }; });
    for (var i = 0; i < A.length; i++) {
      if (F.q && (A[i][C.name] + " " + A[i][C.taskId]).toLowerCase().indexOf(F.q) < 0) continue;
      var x = G[A[i][C.group]], a = A[i];
      if (a[C.pe] != null) x.pf = x.pf == null ? a[C.pe] : Math.max(x.pf, a[C.pe]);
      if (!open(i)) continue;
      x.open++; x.crit += tf(i) <= 0; x.near += tf(i) > 0 && tf(i) <= M.nearDays; x.del += delayed(i);
      x.ff = x.ff == null ? a[C.ef] : Math.max(x.ff, a[C.ef]);
    }
    L.roots.forEach(function (r) { G[A[r[0]][C.group]].roots++; });
    G = G.filter(function (x) { return x.open; }).sort(function (p, q) { return ((q.ff - q.pf) - (p.ff - p.pf)) || (q.crit - p.crit); });
    $("cp-groups").innerHTML = '<div class="tbl-wrap"><table><thead><tr><th class="it">WBS group</th><th class="r">Open</th><th class="r">Critical</th><th class="r">Near</th><th class="r">Delayed</th><th class="r">Root causes</th><th>Planned finish</th><th>Forecast finish</th><th class="r">Slip</th></tr></thead><tbody>' +
      G.map(function (x) {
        return '<tr class="clickable' + (F.group !== "" && +F.group === x.g ? " cp-sel" : "") + '" tabindex="0" data-cpg="' + x.g + '" title="Show only this group"><td class="it"><b>' + esc(x.name) + '</b></td><td class="r">' + fmtI(x.open) +
          '</td><td class="r">' + (x.crit ? '<b class="pr-late">' + fmtI(x.crit) + "</b>" : 0) + '</td><td class="r">' + fmtI(x.near) + '</td><td class="r">' + fmtI(x.del) + '</td><td class="r">' + fmtI(x.roots) +
          "</td><td>" + fmtD(iso(x.pf)) + "</td><td>" + fmtD(iso(x.ff)) + '</td><td class="r">' + slipTag(x.ff != null && x.pf != null ? x.ff - x.pf : null) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* ---------- logic health: checks, relationship types, lags ---------- */
  var CHECK_SET = {
    noPred: function (i) { return open(i) && !PRED[i].length && A[i][C.milestone] !== 1; },
    noSucc: function (i) { return open(i) && !SUCC[i].length && A[i][C.milestone] !== 2; },
    highFloat: function (i) { return open(i) && tf(i) > M.highFloat; },
    longDur: function (i) { return open(i) && !A[i][C.milestone] && A[i][C.dur] > M.longDuration; },
    oos: function (i) { return st(i) !== "notStarted" && PRED[i].some(function (k) { var l = L.links[k]; return l[2] === 0 && open(l[0]) && !LOOP[k]; }); },
  };
  var CHECK_LINKS = { leads: "lead", lags: "lag", fs: "notfs", sf: "sf", loops: "loop" };
  function health() {
    $("cp-checks").innerHTML = M.health.map(function (h) {
      var drillable = CHECK_SET[h.key] || CHECK_LINKS[h.key];
      return '<div class="cp-hc' + (drillable ? " drill" : "") + '"' + (drillable ? ' role="button" tabindex="0" data-cph="' + h.key + '"' : "") + '><span class="pill ' + (h.ok ? "complete" : "overdue") + '">' + (h.ok ? "Pass" : "Check") + "</span>" +
        '<div class="cp-ht"><b>' + esc(h.label) + '</b><span class="it-sub">' + esc(h.note) + "</span></div>" +
        '<div class="cp-hv"><b>' + fmtI(h.n) + "</b> of " + fmtI(h.of) + ' <span class="it-sub">' + nf1.format(h.pct) + "% · target " + (h.kind === "zero" ? "none" : "≤ " + h.limit + "%") + "</span></div></div>";
    }).join("");
    var tot = M.links || 1, cols = { FS: "var(--brand)", SS: "var(--s-prog, #7a5af8)", FF: "var(--warn)", SF: "var(--bad)" };
    $("cp-types").innerHTML = '<div class="cp-mix">' + L.types.map(function (t) { return '<i style="width:' + (100 * M.types[t] / tot).toFixed(2) + "%;background:" + cols[t] + '" title="' + t + " " + fmtI(M.types[t]) + '"></i>'; }).join("") + "</div>" +
      '<div class="legend">' + L.types.map(function (t) { return '<span><i style="background:' + cols[t] + '"></i>' + t + " <b>" + fmtI(M.types[t]) + "</b> " + nf1.format(100 * M.types[t] / tot) + "%</span>"; }).join("") + "</div>";
    links();
  }
  var LINK_MODES = [["lag", "Lags"], ["lead", "Leads"], ["sf", "Start-to-finish"], ["notfs", "Not finish-to-start"], ["loop", "Loop links"]];
  function links() {
    var mode = F.linkMode;
    var ks = [];
    L.links.forEach(function (l, k) {
      if (F.group !== "" && A[l[0]][C.group] !== +F.group && A[l[1]][C.group] !== +F.group) return;
      if (F.q && !((A[l[0]][C.name] + " " + A[l[0]][C.taskId] + " " + A[l[1]][C.name] + " " + A[l[1]][C.taskId]).toLowerCase().indexOf(F.q) >= 0)) return;
      if (mode === "lag" ? l[3] > 0 : mode === "lead" ? l[3] < 0 : mode === "sf" ? l[2] === 3 : mode === "notfs" ? l[2] !== 0 : LOOP[k]) ks.push(k);
    });
    if (mode === "lag" || mode === "lead") ks.sort(function (p, q) { var d = L.links[q][3] - L.links[p][3]; return F.linkAsc ? -d : d; });
    $("cp-lmode").innerHTML = LINK_MODES.map(function (m) { return '<button type="button" data-v="' + m[0] + '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + "</button>"; }).join("");
    $("cp-lsort").hidden = mode !== "lag";
    $("cp-lsort").innerHTML = '<button type="button" data-v="desc" aria-pressed="' + !F.linkAsc + '">Largest first</button><button type="button" data-v="asc" aria-pressed="' + F.linkAsc + '">Smallest first</button>';
    var shown = F.linkAll ? ks : ks.slice(0, 20);
    var lags = ks.map(function (k) { return L.links[k][3]; });
    $("cp-lstat").textContent = fmtI(ks.length) + " links" + (mode === "lag" && ks.length ? " · max " + Math.max.apply(null, lags) + "d · min " + Math.min.apply(null, lags) + "d" : "");
    if (!ks.length) { $("cp-links").innerHTML = '<div class="empty">No such link' + (F.group !== "" || F.q ? " in this filter" : "") + ".</div>"; return; }
    function cell(j) { var R = row(j); return '<button type="button" class="dr-name" data-cpa="' + j + '"><b>' + esc(R.taskId + " · " + R.name) + '</b></button><span class="it-sub">' + esc(R.where) + "</span>"; }
    $("cp-links").innerHTML = '<div class="tbl-wrap"><table><thead><tr><th class="it">Predecessor</th><th>Link</th><th class="r">Lag</th><th class="it">Successor</th><th>Successor status</th><th class="r">Successor float</th></tr></thead><tbody>' +
      shown.map(function (k) {
        var l = L.links[k], R = row(l[1]);
        return '<tr><td class="it">' + cell(l[0]) + "</td><td><b>" + L.types[l[2]] + '</b></td><td class="r">' + (l[3] ? (l[3] > 0 ? "+" : "") + fmtI(l[3]) + "d" : "0") + '</td><td class="it">' + cell(l[1]) + "</td><td>" + pills(R) + '</td><td class="r">' + floatTxt(R.tf) + "</td></tr>";
      }).join("") + "</tbody></table></div>" + (shown.length < ks.length ? '<div style="margin-top:10px"><button class="btn" type="button" id="cp-links-more">Show all ' + fmtI(ks.length) + "</button></div>" : "");
  }

  /* ---------- controls and events ---------- */
  function controls() {
    $("cp-group").innerHTML = '<option value="">All WBS groups</option>' + S.group.map(function (g, k) { return '<option value="' + k + '">' + esc(g) + "</option>"; }).join("");
  }
  $("cp-group").addEventListener("change", function () { F.group = this.value; F.rootsAll = false; render(); });
  var qt;
  $("cp-q").addEventListener("input", function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { F.q = v.trim().toLowerCase(); F.rootsAll = false; render(); }, 180); });
  $("cp-reset").addEventListener("click", function () { F.group = ""; F.q = ""; $("cp-group").value = ""; $("cp-q").value = ""; render(); });
  function act(el, attr, fn) {
    el.addEventListener("click", function (e) { var t = e.target.closest("[" + attr + "]"); if (t && el.contains(t)) fn(t.getAttribute(attr), t, e); });
    el.addEventListener("keydown", function (e) { if (e.key !== "Enter" && e.key !== " ") return; var t = e.target.closest("[" + attr + "]"); if (t && t === e.target) { e.preventDefault(); fn(t.getAttribute(attr), t, e); } });
  }
  act($("cp-kpis"), "data-cpk", function (k) {
    if (k === "path") { drill("Driving path", "The chain of activities that sets the forecast finish, from today to the finish", L.path, null); return; }
    if (k === "lags") { F.linkMode = "lag"; F.linkAll = false; links(); $("h-cp-health").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    var s = SETS[k];
    drill(s[0], s[1], openIdx().filter(s[2]), null);
  });
  act($("cp-path"), "data-cpp", function (n) { drill("Driving path", "The chain of activities that sets the forecast finish", L.path, L.path[+n]); });
  act($("cp-roots"), "data-cpr", function (n) {
    var rs = rootsIn();
    drill("Delay root causes", "Delayed activities that no late predecessor pushed, most finish impact first", rs.map(function (r) { return r[0]; }), rs[+n][0]);
  });
  $("cp-roots").addEventListener("click", function (e) { if (e.target.id === "cp-roots-more") { F.rootsAll = true; roots(); } });
  act($("cp-float"), "data-cpb", function (k) {
    var b = buckets()[+k];
    drill(b[1] + " (" + b[2] + ")", "Open activities by total float against the planned finish", openIdx().filter(function (i) { return tf(i) != null && b[3](tf(i)); }), null);
  });
  act($("cp-groups"), "data-cpg", function (g) { F.group = F.group !== "" && +F.group === +g ? "" : g; $("cp-group").value = F.group; F.rootsAll = false; render(); });
  act($("cp-checks"), "data-cph", function (k) {
    if (CHECK_LINKS[k]) { F.linkMode = CHECK_LINKS[k]; F.linkAll = false; links(); $("cp-links").scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
    var h = M.health.filter(function (x) { return x.key === k; })[0], ix = [];
    for (var i = 0; i < A.length; i++) if (inView(i) && CHECK_SET[k](i)) ix.push(i);
    drill(h.label, h.note, ix, null);
  });
  $("cp-lmode").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F.linkMode = b.getAttribute("data-v"); F.linkAll = false; links(); } });
  $("cp-lsort").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F.linkAsc = b.getAttribute("data-v") === "asc"; links(); } });
  act($("cp-links"), "data-cpa", function (j) { drill("Activity", "", [+j], +j); });
  $("cp-links").addEventListener("click", function (e) { if (e.target.id === "cp-links-more") { F.linkAll = true; links(); } });

  function csv(name, head, rows) {
    function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob(["﻿" + [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\n")], { type: "text/csv;charset=utf-8" }));
    el.download = (meta.key || "JUI") + "-" + name + ".csv";
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000);
  }
  $("cp-path-csv").addEventListener("click", function () {
    csv("driving-path", ["Order", "Task ID", "Activity", "WBS group › parent", "Status", "Planned start", "Planned finish", "Forecast start", "Forecast finish", "Slip vs plan (days)", "Total float (days)", "Set by"],
      L.path.map(function (i, n) { var R = row(i); return [n + 1, R.taskId, R.name, R.where, R.status, R.plannedStart, R.plannedFinish, R.es, R.ef, R.delay, R.tf, L.why[A[i][C.why]]]; }));
  });
  $("cp-roots-csv").addEventListener("click", function () {
    csv("delay-root-causes", ["Task ID", "Activity", "WBS group › parent", "Status", "Why late", "Late by (days)", "Activities pushed later", "Largest push (days)", "Total float (days)", "On the driving path", "Days past planned finish"],
      rootsIn().map(function (r) { var R = row(r[0]), lt = lateTxt(r[0]); return [R.taskId, R.name, R.where, R.status, lt[0], lt[1], r[1], r[2], R.tf, r[3] ? "Yes" : "", r[4]]; }));
  });

  function render() {
    var o = openIdx();
    kpis(o); bridge(); path(); roots(); floatBars(o); groups(); health();
    $("cp-filter-note").textContent = F.group !== "" || F.q ? "Filtered: the KPI cards, root causes, float, groups and links follow the filter; the forecast finish and driving path are the whole schedule's." : "";
  }
})();
