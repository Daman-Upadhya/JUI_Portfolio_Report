/* Milestones page: the project milestones WBS branch (metrics.scurve.milestones, from calculation.py
   milestones()). Each milestone has one date: baseline vs forecast (or actual), the slip between
   them and a status (complete, on track, at risk, delayed) worked out in calculation.py.
   Sections: KPI cards, a milestone timeline grouped by WBS group, one card per group, the register. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.scurve && P.metrics.scurve.milestones, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!M || !M.items.length || !$("pg-ms") || !window.JUIProcUI) return;
  $("tab-ms").hidden = false;
  var UI = window.JUIProcUI, R = M.items;

  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  function day(iso) { return iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5 : null; }
  function slipTxt(s) { return s == null ? DASH : s === 0 ? "on date" : (s > 0 ? "+" : "−") + fmtI(Math.abs(s)) + "d"; }
  function slipCls(s) { return s == null ? "" : s > M.delayDays ? "pr-late" : s > 0 ? "ms-warn" : "pr-early"; }

  var ST = {
    complete: { l: "Complete", tone: "good", icon: "done" },
    ontrack: { l: "On track", tone: "prog", icon: "prog" },
    risk: { l: "At risk", tone: "warn", icon: "alert" },
    delayed: { l: "Delayed", tone: "bad", icon: "trend" },
  };
  var ORDER = ["complete", "ontrack", "risk", "delayed"], WORST = ["delayed", "risk", "ontrack", "complete"];
  function pill(k) { return '<span class="pill ms-' + k + '">' + ST[k].l + "</span>"; }
  var TODAY = M.today, F = { status: "", group: "", q: "", base: true, cr: "" };
  var SHUT = new Set();  // collapsed timeline groups and sub-groups ("group" or "group › sub")
  var open = R.filter(function (r) { return !r.done; }).length;
  $("n-ms").textContent = fmtI(R.filter(function (r) { return r.msStatus === "delayed"; }).length) + " delayed";
  $("ms-title").textContent = M.title;
  $("ms-desc").textContent = M.branch + ": " + R.length + " milestones in " + M.groups.length + " groups, " + fmtI(open) + " still open. Baseline date against the forecast (or actual) date; more than " +
    M.delayDays + " days late, or past its forecast date and not done, is delayed.";

  function inView(skipStatus) {
    var q = F.q;
    return R.filter(function (r) {
      return (skipStatus || !F.status || r.msStatus === F.status) && (!F.group || r.msGroup === F.group) && (!F.cr || r.critical === F.cr) &&
        (!q || (r.name + " " + r.taskId + " " + r.msGroup + " " + r.sub).toLowerCase().indexOf(q) >= 0);
    });
  }

  /* ---------- KPI cards (select one to filter by that status) ---------- */
  function kpis(rows) {
    var n = rows.length, c = function (k) { return rows.filter(function (r) { return r.msStatus === k; }).length; };
    var next = rows.filter(function (r) { return !r.done && r.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    var fin = rows.reduce(function (m, r) { return r.date && (!m || r.date > m.date) ? r : m; }, null);
    var bfin = rows.reduce(function (m, r) { return r.baseline && (!m || r.baseline > m) ? r.baseline : m; }, null);
    var fs = fin && bfin ? day(fin.date) - day(bfin) : null;
    UI.kpis($("ms-stats"), [
      { icon: "seal", v: fmtI(c("complete")) + "<small> / " + fmtI(n) + "</small>", l: "Complete", sub: (n ? Math.round(100 * c("complete") / n) : 0) + "% of milestones", tone: "good", frac: n ? c("complete") / n : null, attr: 'data-fs="complete"' },
      { icon: "prog", v: fmtI(c("ontrack")), l: "On track", sub: "forecast on or before baseline", tone: "prog", attr: 'data-fs="ontrack"' },
      { icon: "alert", v: fmtI(c("risk")), l: "At risk", sub: "slipping 1–" + M.delayDays + " days", tone: c("risk") ? "warn" : "muted", attr: 'data-fs="risk"' },
      { icon: "trend", v: fmtI(c("delayed")), l: "Delayed", sub: "over " + M.delayDays + " days late or overdue", tone: c("delayed") ? "bad" : "muted", attr: 'data-fs="delayed"' },
      { icon: "clock", v: next ? fmtD(next.date) : DASH, l: "Next milestone", sub: next ? esc(next.name) : "none open", tone: "brand", attr: next ? 'data-dk="' + R.indexOf(next) + '"' : null },
      { icon: "truck", v: fin ? fmtD(fin.date) : DASH, l: "Forecast finish", sub: '<span class="' + slipCls(fs) + '">' + slipTxt(fs) + "</span> vs baseline " + fmtD(bfin), tone: fs > 0 ? "bad" : "good", attr: fin ? 'data-dk="' + R.indexOf(fin) + '"' : null },
    ]);
  }

  /* ---------- controls ---------- */
  function seg(id, opts, key) {
    $(id).innerHTML = opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (F[key] === o[0]) + '">' + o[1] + "</button>"; }).join("");
  }
  function controls() {
    var rows = inView(true);
    var cnt = function (k) { return rows.filter(function (r) { return r.msStatus === k; }).length; };
    seg("ms-status", [["", "All <b>" + rows.length + "</b>"]].concat(ORDER.map(function (k) { return [k, '<i class="ms-dot ms-' + k + '"></i>' + ST[k].l + " <b>" + cnt(k) + "</b>"]; })), "status");
    seg("ms-group", [["", "All"]].concat(M.groups.map(function (g) { return [g, esc(g)]; })), "group");
  }
  $("ms-status").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F.status = b.getAttribute("data-v"); render(); } });
  $("ms-group").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F.group = b.getAttribute("data-v"); render(); } });
  $("ms-base").addEventListener("change", function () { F.base = $("ms-base").checked; render(); });
  var qt;
  $("ms-q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { F.q = $("ms-q").value.trim().toLowerCase(); render(); }, 150); });
  $("ms-reset").addEventListener("click", function () { F = { status: "", group: "", q: "", base: true, cr: "" }; $("ms-q").value = ""; $("ms-base").checked = true; $("ms-crit").value = ""; render(); });
  UI.critOptions($("ms-crit"), $("ms-crit-fp"), R, "");  // the Critical Activity custom field
  $("ms-crit").addEventListener("change", function () { F.cr = this.value; render(); });

  function tip(r) {
    return r.name + "\n" + r.msGroup + (r.sub ? " › " + r.sub : "") + "\nBaseline " + fmtD(r.baseline) + " · " + (r.actual ? "actual " : "forecast ") + fmtD(r.date) +
      " · slip " + slipTxt(r.slip) + "\n" + ST[r.msStatus].l + " · " + r.status;
  }

  /* ---------- timeline: one row per milestone, grouped; hollow diamond = baseline, filled = forecast / actual ---------- */
  function timeline(rows) {
    if (!rows.length) { $("ms-tl").innerHTML = '<div class="empty">No milestone matches these filters.</div>'; return; }
    var ds = [day(TODAY)];
    rows.forEach(function (r) { [r.baseline, r.date].forEach(function (d) { if (d) ds.push(day(d)); }); });
    var lo = Math.min.apply(null, ds), hi = Math.max.apply(null, ds);
    var d0 = new Date(lo * 864e5), d1 = new Date(hi * 864e5);
    lo = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1) / 864e5;
    hi = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 1) / 864e5;
    function x(d) { return (100 * (d - lo) / (hi - lo)).toFixed(3) + "%"; }
    var grid = "", labs = "", m = new Date(lo * 864e5), months = (hi - lo) / 30.4, every = months > 24 ? 3 : months > 12 ? 2 : 1;
    while (m.getTime() / 864e5 < hi) {
      var md = m.getTime() / 864e5, y = m.getUTCMonth() === 0;
      grid += '<i class="ms-gl' + (y ? " y" : "") + '" style="left:' + x(md) + '"></i>';
      if (m.getUTCMonth() % every === 0) labs += '<span class="ms-ml' + (y ? " y" : "") + '" style="left:' + x(md) + '">' + MON[m.getUTCMonth()] + " " + String(m.getUTCFullYear()).slice(2) + "</span>";
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    var bg = '<div class="ms-bg">' + grid + '<i class="ms-today" style="left:' + x(day(TODAY)) + '"></i></div>';
    var h = '<div class="ms-tl"><div class="ms-row ms-head"><div class="ms-lab">Milestone</div><div class="ms-trk">' + labs +
      '<span class="ms-tdl" style="left:' + x(day(TODAY)) + '">Today</span></div></div>';
    function px(d) { return 100 * (d - lo) / (hi - lo); }
    function iso(d) { return new Date(d * 864e5).toISOString().slice(0, 10); }
    /* baseline diamond, slip line and forecast / actual diamond, with short labels: the earlier date to the
       left of its diamond, the later one to the right, the slip over the line (or after the later date when
       the two sit close); a label that would run off the track goes above its diamond instead */
    function marks(b, e, cls, attr, title) {
      var mk = "", showB = F.base && b != null;
      function lbl(d, kind, side, extra) {
        var p = px(d), up = side === "r" ? p > 86 : p < 10;
        return '<span class="mt-lbl ' + kind + " " + (up ? "up" + (side === "r" ? " ur" : " ul") : side) + '" style="left:' + x(d) + '">' + fmtD(iso(d)) + (extra || "") + "</span>";
      }
      var sl = showB && e != null ? e - b : null;
      var slTxt = sl == null || sl === 0 ? "" : '<b class="ms-slt">' + (sl > 0 ? "+" : "−") + fmtI(Math.abs(sl)) + "d</b>";
      if (showB) {
        if (e != null && e !== b) mk += '<i class="ms-slip" style="left:' + x(Math.min(b, e)) + ";width:calc(" + x(Math.max(b, e)) + " - " + x(Math.min(b, e)) + ')"></i>';
        mk += '<i class="ms-mk base" style="left:' + x(b) + '"></i>';
      }
      if (e != null) mk += '<i class="ms-mk' + cls + '" ' + attr + ' style="left:' + x(e) + '" title="' + esc(title) + '"></i>';
      if (e == null && showB) return mk + lbl(b, "b", "r");
      if (e == null) return mk;
      if (!showB || e === b) return mk + lbl(e, "f", "r", showB ? ' <b class="ms-slt ok">on date</b>' : "");
      var lo_ = Math.min(b, e), hi_ = Math.max(b, e);  // too close, or a date label raised above its diamond: the slip goes after the later date
      var near = Math.abs(px(e) - px(b)) < 9 || px(hi_) > 86 || px(lo_) < 10;
      if (!near) mk += '<span class="ms-sl" style="left:calc((' + x(b) + " + " + x(e) + ') / 2)">' + slTxt + "</span>";
      return mk + (e > b ? lbl(b, "b", "l") + lbl(e, "f", "r", near ? " " + slTxt : "") : lbl(e, "f", "l") + lbl(b, "b", "r", near ? " " + slTxt : ""));
    }
    /* a group or sub-group header: chevron, count, worst status; on the track its latest baseline and forecast */
    function head(key, label, rs, depth) {
      var shut = SHUT.has(key);
      var w = WORST.filter(function (st) { return rs.some(function (r) { return r.msStatus === st; }); })[0];
      var done = rs.filter(function (r) { return r.done; }).length;
      var b = rs.reduce(function (m, r) { return r.baseline && (!m || r.baseline > m) ? r.baseline : m; }, null);
      var e = rs.reduce(function (m, r) { return r.date && (!m || r.date > m) ? r.date : m; }, null);
      var sl = rs.map(function (r) { return r.slip; }).filter(function (v) { return v != null; }), mx = sl.length ? Math.max.apply(null, sl) : null;
      return '<div class="ms-row ms-gh ms-d' + depth + " ms-" + w + (shut ? " shut" : "") + '"><div class="ms-lab"><button type="button" class="ms-tg" data-mstg="' + esc(key) + '" aria-expanded="' + !shut + '">' +
        '<svg class="ms-chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>' +
        '<span class="ms-gt"><b>' + esc(label) + '</b><span class="it-sub">' + done + " / " + rs.length + " complete · last " + fmtD(e) + ' · max slip <span class="' + slipCls(mx) + '">' + slipTxt(mx) + "</span></span></span></button>" + pill(w) + "</div>" +
        '<div class="ms-trk">' + bg + marks(day(b), day(e), " sum", "", label + ": latest baseline " + fmtD(b) + ", latest forecast " + fmtD(e)) + "</div></div>";
    }
    var groupsIn = [];
    rows.forEach(function (r) { if (groupsIn.indexOf(r.msGroup) < 0) groupsIn.push(r.msGroup); });
    groupsIn.forEach(function (g) {
      var gr = rows.filter(function (r) { return r.msGroup === g; });
      h += head(g, g, gr, 0);
      if (SHUT.has(g)) return;
      var sub = null;
      gr.forEach(function (r) {
        var k = R.indexOf(r), sk = g + " › " + r.sub;
        if (r.sub && r.sub !== sub) { sub = r.sub; h += head(sk, r.sub, gr.filter(function (x) { return x.sub === r.sub; }), 1); }
        if (!r.sub) sub = null;
        if (r.sub && SHUT.has(sk)) return;
        h += '<div class="ms-row ms-' + r.msStatus + (r.sub ? " ms-d2" : " ms-d1") + '"><div class="ms-lab"><div class="ms-t"><button type="button" class="dr-name" data-dk="' + k + '" title="' + esc(tip(r)) + '"><b>' + esc(r.name) + "</b></button>" +
          '<span class="it-sub">' + (r.actual ? "actual " : "forecast ") + fmtD(r.date) + " · baseline " + fmtD(r.baseline) + ' · <span class="' + slipCls(r.slip) + '">' + slipTxt(r.slip) + "</span></span></div>" + pill(r.msStatus) + "</div>" +
          '<div class="ms-trk">' + bg + marks(day(r.baseline), day(r.date), " drill", 'role="button" tabindex="0" data-dk="' + k + '"', tip(r)) + "</div></div>";
      });
    });
    $("ms-tl").innerHTML = h + "</div>";
  }

  /* ---------- one card per group: worst status, % complete, max slip ---------- */
  function groups(rows) {
    $("ms-groups").innerHTML = M.groups.map(function (g) {
      var rs = rows.filter(function (r) { return r.msGroup === g; });
      if (!rs.length) return "";
      var w = WORST.filter(function (s) { return rs.some(function (r) { return r.msStatus === s; }); })[0];
      var done = rs.filter(function (r) { return r.done; }).length;
      var sl = rs.map(function (r) { return r.slip; }).filter(function (v) { return v != null; }), ms = sl.length ? Math.max.apply(null, sl) : null;
      var next = rs.filter(function (r) { return !r.done && r.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
      return '<div class="msg ms-' + w + ' drill" role="button" tabindex="0" data-fg="' + esc(g) + '" title="Show only this group"><div class="msg-top"><b>' + esc(g) + "</b>" + pill(w) + "</div>" +
        '<div class="msg-v"><b>' + fmtI(done) + "</b> / " + fmtI(rs.length) + " complete<small>" + Math.round(100 * done / rs.length) + "%</small></div>" +
        '<span class="tc-bar"><i class="b-done" style="width:' + (100 * done / rs.length).toFixed(1) + '%"></i></span>' +
        '<div class="msg-s"><span>Max slip <b class="' + slipCls(ms) + '">' + slipTxt(ms) + "</b></span><span>" + (next ? "next " + fmtD(next.date) : "all done") + "</span></div>" +
        '<div class="msg-mix">' + ORDER.map(function (k) { var c = rs.filter(function (r) { return r.msStatus === k; }).length; return c ? '<span><i class="ms-dot ms-' + k + '"></i>' + c + " " + ST[k].l.toLowerCase() + "</span>" : ""; }).join("") + "</div></div>";
    }).join("");
  }

  /* ---------- register ---------- */
  function table(rows) {
    if (!rows.length) { $("ms-tbl").innerHTML = '<div class="empty">No milestone matches these filters.</div>'; return; }
    var h = '<div class="tbl-wrap"><table><thead><tr><th>ID</th><th class="it">Milestone</th><th>Group</th><th>Type</th><th>Baseline</th><th>Forecast / actual</th><th class="r">Slip</th><th>Schedule status</th><th>Status</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var k = R.indexOf(r);
      h += "<tr><td>" + esc(r.taskId) + '</td><td class="it"><button type="button" class="dr-name" data-dk="' + k + '"><b>' + esc(r.name) + "</b></button></td><td>" + esc(r.msGroup) + (r.sub ? '<span class="it-sub">' + esc(r.sub) + "</span>" : "") + "</td>" +
        "<td>" + esc((r.type || "").replace(/ milestone$/i, "")) + "</td><td>" + fmtD(r.baseline) + "</td><td>" + fmtD(r.date) + (r.actual ? ' <span class="it-sub">actual</span>' : "") + "</td>" +
        '<td class="r"><span class="' + slipCls(r.slip) + '">' + slipTxt(r.slip) + "</span></td><td>" + pill(r.msStatus) + '</td><td class="ms-st">' + esc(r.status) + "</td></tr>";
    });
    $("ms-tbl").innerHTML = h + "</tbody></table></div>";
  }

  function render() {
    controls();
    var rows = inView();
    kpis(inView(true));
    timeline(rows);
    groups(inView(true));
    table(rows);
  }

  /* ---------- clicks: KPI / group card filters, a milestone opens its detail ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-fs],[data-fg],[data-dk]");
    if (!t || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    if (e.type === "keydown") e.preventDefault();
    if (t.hasAttribute("data-fs")) { F.status = F.status === t.getAttribute("data-fs") ? "" : t.getAttribute("data-fs"); return render(); }
    if (t.hasAttribute("data-fg")) { F.group = F.group === t.getAttribute("data-fg") ? "" : t.getAttribute("data-fg"); render(); return $("h-ms-tl").scrollIntoView({ behavior: "smooth", block: "start" }); }
    var r = R[+t.getAttribute("data-dk")];
    if (!window.JUIActDrill) return;
    var list = inView().indexOf(r) >= 0 ? inView() : [r];
    // a milestone is one date: the drawer gets it as both start and finish, and done ones as complete
    var rows = list.map(function (x) {
      return Object.assign({}, x, { where: x.msGroup + (x.sub ? " › " + x.sub : ""), finish: x.date, delay: x.slip, group: x.done ? "complete" : x.group,
        baselineStart: x.baseline, baselineFinish: x.baseline, plannedStart: x.forecast, plannedFinish: x.forecast, actualStart: x.actual, actualFinish: x.actual });
    });
    window.JUIActDrill.open({ eyebrow: M.title, title: "Milestones in view", sub: (F.group || "All groups") + (F.status ? " · " + ST[F.status].l : ""), whereLabel: "Group",
      rows: rows, act: rows[list.indexOf(r)] });
  }
  /* timeline: open / close a group, or all of them */
  $("ms-tl").addEventListener("click", function (e) {
    var t = e.target.closest("[data-mstg]");
    if (!t) return;
    var k = t.getAttribute("data-mstg");
    if (SHUT.has(k)) SHUT.delete(k); else SHUT.add(k);
    timeline(inView());
  });
  function allKeys() {
    var ks = [];
    R.forEach(function (r) { [r.msGroup, r.sub ? r.msGroup + " › " + r.sub : null].forEach(function (k) { if (k && ks.indexOf(k) < 0) ks.push(k); }); });
    return ks;
  }
  $("ms-expand").addEventListener("click", function () { SHUT.clear(); timeline(inView()); });
  $("ms-collapse").addEventListener("click", function () { allKeys().forEach(function (k) { SHUT.add(k); }); timeline(inView()); });
  ["ms-stats", "ms-tl", "ms-groups", "ms-tbl"].forEach(function (id) { $(id).addEventListener("click", onClick); $(id).addEventListener("keydown", onClick); });

  /* ---------- CSV ---------- */
  $("ms-csv").addEventListener("click", function () {
    function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var head = ["Task ID", "Milestone", "Group", "Sub-group", "Type", "Baseline", "Forecast / actual", "Actual", "Slip days", "Schedule status", "Status"];
    var lines = inView().map(function (r) { return [r.taskId, r.name, r.msGroup, r.sub, r.type, r.baseline, r.date, r.actual, r.slip, ST[r.msStatus].l, r.status].map(q).join(","); });
    var el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob(["﻿" + [head.map(q).join(",")].concat(lines).join("\n")], { type: "text/csv;charset=utf-8" }));
    el.download = (meta.key || "JUI") + "-milestones.csv";
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000);
  });

  render();
})();
