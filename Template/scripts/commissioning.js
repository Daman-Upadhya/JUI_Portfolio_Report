/* Commissioning page: level-wise tracking of the testing & commissioning WBS branch
   (metrics.scurve.commissioning, from calculation.py commissioning()). Rows are equipment types
   (RMU, ACC chillers, ...) grouped by phase and discipline; columns are the commissioning levels,
   each with its data-centre tag colour (L1 red, L2 yellow, L3 green, L4 blue, L5 white).
   calculation.py already summed each cell; this page only filters and draws. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.scurve && P.metrics.scurve.commissioning, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!M || !$("pg-tc") || !window.JUIProcUI) return;
  $("tab-tc").hidden = false;
  var UI = window.JUIProcUI;

  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  function fmtDelay(d) { return d == null ? "" : d > 0 ? '<span class="pr-late">+' + fmtI(d) + "d</span>" : d < 0 ? '<span class="pr-early">−' + fmtI(-d) + "d</span>" : '<span class="pr-ok">on time</span>'; }
  function fmtDelayT(d) { return d == null ? "no baseline" : d > 0 ? d + " days late" : d < 0 ? -d + " days early" : "on time"; }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }

  var I = M.items, A = M.activities, LV = M.levels;
  var TAG = { red: "Red tag", yellow: "Yellow tag", "yellow-pre": "Yellow tag", green: "Green tag", blue: "Blue tag", white: "White tag", other: "No tag" };
  var F = { phase: "", disc: "", level: "", show: "all", q: "" };
  var open = I.filter(function (it) { return it.done < it.n; }).length;
  $("n-tc").textContent = fmtI(open) + " open";
  $("tc-title").textContent = M.title;
  $("tc-desc").textContent = M.branch + ": " + M.phases.length + " phases, " + fmtI(I.length) + " equipment types and " + fmtI(A.length) +
    " commissioning activities, level by level from installation checks to integrated systems testing.";

  function chip(l) { return '<i class="lvt lv-' + esc(l.tag || "other") + '" aria-hidden="true"></i>'; }
  function where(a) { var it = I[a.item]; return it.phase + " › " + LV[a.stage].label + " › " + (it.disc === "General" ? "" : it.disc + " › ") + it.name; }

  /* a summary of activity records: counts, latest finish, largest delay */
  function sum(acts) {
    var s = { n: acts.length, done: 0, started: 0, overdue: 0, finish: null, delay: null };
    acts.forEach(function (a) {
      s.done += a.group === "complete"; s.started += a.group === "started"; s.overdue += a.overdue;
      if (a.finish && (!s.finish || a.finish > s.finish)) s.finish = a.finish;
      if (a.delay != null && (s.delay == null || a.delay > s.delay)) s.delay = a.delay;
    });
    return s;
  }
  function state(c) { return c.done === c.n ? "c-done" : c.overdue ? "c-over" : c.done || c.started ? "c-prog" : "c-todo"; }
  function bar(c) {
    return '<span class="tc-bar"><i class="b-done" style="width:' + (c.n ? 100 * c.done / c.n : 0).toFixed(1) + '%"></i><i class="b-over" style="width:' + (c.n ? 100 * c.overdue / c.n : 0).toFixed(1) + '%"></i></span>';
  }

  /* ---------- filters ---------- */
  function rowsInView(skipPhase) {
    return I.filter(function (it) {
      if (!skipPhase && F.phase && it.phase !== F.phase) return false;
      if (F.disc && it.disc !== F.disc) return false;
      if (F.level !== "" && !it.cells[F.level]) return false;
      if (F.show === "open" && it.done >= it.n) return false;
      if (F.show === "overdue" && !it.overdue) return false;
      if (F.show === "late" && !(it.delay > 0)) return false;
      return !F.q || (it.name + " " + it.disc + " " + it.phase).toLowerCase().indexOf(F.q) >= 0;
    });
  }
  function actsOf(items, anyLevel) {  // the items' activities, at the Level filter's level unless anyLevel
    var ids = new Set(items.map(function (it) { return I.indexOf(it); }));
    return A.filter(function (a) { return ids.has(a.item) && (anyLevel || F.level === "" || a.stage === +F.level); });
  }
  function seg(id, opts, key) {
    $(id).innerHTML = opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(F[key]) === String(o[0])) + '">' + o[1] + "</button>"; }).join("");
  }
  function controls() {
    var used = LV.map(function (_, k) { return k; }).filter(function (k) { return A.some(function (a) { return a.stage === k; }); });
    seg("tc-phase", [["", "All"]].concat(M.phases.map(function (p) { return [p, esc(p)]; })), "phase");
    seg("tc-level", [["", "All"]].concat(used.map(function (k) { return [k, chip(LV[k]) + esc(LV[k].label)]; })), "level");
    seg("tc-show", [["all", "All types"], ["open", "Open"], ["overdue", "Overdue"], ["late", "Late vs baseline"]], "show");
    seg("tc-disc", [["", "All"]].concat(M.disciplines.map(function (d) { return [d, esc(d)]; })), "disc");
  }
  [["tc-phase", "phase"], ["tc-level", "level"], ["tc-show", "show"], ["tc-disc", "disc"]].forEach(function (x) {
    $(x[0]).addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F[x[1]] = b.getAttribute("data-v"); render(); } });
  });
  var qt;
  $("tc-reset").addEventListener("click", function () { F = { phase: "", disc: "", level: "", show: "all", q: "" }; $("tc-q").value = ""; render(); });
  $("tc-q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { F.q = $("tc-q").value.trim().toLowerCase(); render(); }, 150); });

  /* ---------- overview: KPI cards, one card per level, phase x level grid ---------- */
  function levelCards(acts) {
    $("tc-levels").innerHTML = LV.map(function (l, k) {
      var c = sum(acts.filter(function (a) { return a.stage === k; }));
      var empty = !A.some(function (a) { return a.stage === k; });
      return '<div class="tlc lv-' + esc(l.tag || "other") + (c.n ? " drill" : "") + (empty ? " is-empty" : "") + '"' + (c.n ? ' role="button" tabindex="0" data-dlv="' + k + '" title="Open its activities"' : "") + ">" +
        '<div class="tlc-band" aria-hidden="true"></div><div class="tlc-top"><b class="tlc-key">' + esc(l.label) + '</b><span class="tlc-tag">' + esc(TAG[l.tag] || "") + "</span></div>" +
        '<div class="tlc-name">' + esc(l.name || "") + "</div>" +
        (empty ? '<div class="tlc-none">Not in this schedule</div>' :
          '<div class="tlc-v"><b>' + fmtI(c.done) + "</b> / " + fmtI(c.n) + '<small>' + pct(c.done, c.n) + "%</small></div>" + bar(c) +
          '<div class="tlc-s">' + (c.overdue ? '<span class="pr-late">' + fmtI(c.overdue) + " overdue</span> · " : "") + "finish " + fmtD(c.finish) + " " + fmtDelay(c.delay) + "</div>") + "</div>";
    }).join("");
  }
  function grid(items) {
    var acts = actsOf(items);
    var used = LV.map(function (_, k) { return k; }).filter(function (k) { return acts.some(function (a) { return a.stage === k; }); });
    if (!used.length) { $("tc-grid").innerHTML = '<div class="empty">Nothing in view.</div>'; return; }
    var phases = M.phases.filter(function (p) { return items.some(function (it) { return it.phase === p; }); });
    var h = '<div class="tbl-wrap"><table class="tc-g"><thead><tr><th class="it">Phase</th>' + used.map(function (k) {
      return '<th class="st">' + chip(LV[k]) + "<b>" + esc(LV[k].label) + "</b><small>" + esc(LV[k].name || "") + "</small></th>";
    }).join("") + '<th class="st">All levels</th></tr></thead><tbody>';
    phases.concat(phases.length > 1 ? [""] : []).forEach(function (p) {
      var pa = acts.filter(function (a) { return !p || I[a.item].phase === p; });
      h += "<tr" + (p ? "" : ' class="tc-tot"') + '><td class="it">' + (p ? '<button type="button" class="dr-name" data-fph="' + esc(p) + '" title="Show only this phase below"><b>' + esc(p) + "</b></button>" : "<b>All phases</b>") +
        '<span class="it-sub">' + fmtI(new Set(pa.map(function (a) { return a.item; })).size) + " equipment types</span></td>";
      used.concat([-1]).forEach(function (k) {
        var c = sum(pa.filter(function (a) { return k < 0 || a.stage === k; }));
        if (!c.n) { h += '<td class="pc"></td>'; return; }
        h += '<td class="pc"><div class="tgc drill ' + state(c) + (k >= 0 ? " lv-" + esc(LV[k].tag || "other") : "") + '" role="button" tabindex="0" data-dph="' + esc(p) + '" data-dlv="' + (k < 0 ? "" : k) + '" title="' +
          esc((p || "All phases") + " · " + (k < 0 ? "all levels" : LV[k].label + " " + (LV[k].name || "")) + ": " + c.done + " of " + c.n + " complete, " + c.started + " in progress, " + c.overdue + " overdue") + '">' +
          '<span class="tgc-v"><b>' + fmtI(c.done) + "</b>/" + fmtI(c.n) + "</span>" + bar(c) + '<span class="tgc-s">' + fmtD(c.finish) + " " + fmtDelay(c.delay) + "</span></div></td>";
      });
      h += "</tr>";
    });
    $("tc-grid").innerHTML = h + "</tbody></table></div>";
  }

  /* ---------- equipment matrix: type x level ---------- */
  function cellTip(k, s) {
    return A.filter(function (a) { return a.item === k && a.stage === s; }).slice(0, 25).map(function (a) {
      return a.name + " · " + a.status + " · planned finish " + fmtD(a.plannedFinish) + (a.actualFinish ? " · actual " + fmtD(a.actualFinish) : "") + " · " + fmtDelayT(a.delay) + (a.overdue ? " · OVERDUE" : "");
    }).join("\n");
  }
  function matrix(items) {
    if (!items.length) { $("tc-matrix").innerHTML = '<div class="empty">No equipment type matches these filters.</div>'; return; }
    var cols = LV.map(function (_, k) { return k; }).filter(function (k) { return (F.level === "" || k === +F.level) && items.some(function (it) { return it.cells[k]; }); });
    var span = cols.length + 4;
    var h = '<div class="tbl-wrap"><table><thead><tr><th class="it">Equipment type</th><th class="r">Done</th>' +
      cols.map(function (k) { return '<th class="st">' + chip(LV[k]) + "<b>" + esc(LV[k].label) + "</b><small>" + esc(LV[k].name || "") + "</small></th>"; }).join("") +
      '<th class="r">Finish</th><th class="r">Delay</th></tr></thead><tbody>';
    var ph = null, dc = null;
    items.forEach(function (it) {
      var k = I.indexOf(it);
      if (it.phase !== ph) { ph = it.phase; dc = null; h += '<tr class="grp pr-part"><td colspan="' + span + '">' + esc(ph) + "</td></tr>"; }
      if (it.disc !== dc) { dc = it.disc; h += '<tr class="grp pr-grp"><td colspan="' + span + '">' + esc(dc === "General" ? "General: pre-requisites, SOO, IST and other checks" : dc) + "</td></tr>"; }
      h += '<tr><td class="it"><button type="button" class="dr-name" data-dk="' + k + '" title="Open its activities"><b>' + esc(it.name) + '</b></button><span class="it-sub">' +
        fmtI(it.units) + (it.units === 1 ? " item" : " units") + " · " + esc(it.wbs) + "</span></td>" +
        '<td class="r">' + fmtI(it.done) + "/" + fmtI(it.n) + "</td>" +
        cols.map(function (s) {
          var c = it.cells[s];
          if (!c) return '<td class="pc"></td>';
          return '<td class="pc"><div class="pcell tcc drill ' + state(c) + " lv-" + esc(LV[s].tag || "other") + '" role="button" tabindex="0" data-dk="' + k + '" data-ds="' + s + '" title="' + esc(LV[s].label + " " + (LV[s].name || "") + "\n" + cellTip(k, s)) + '">' +
            '<span class="d">' + fmtD(c.finish) + '</span><span class="x">' + fmtDelay(c.delay) + '</span><span class="k">' + c.done + "/" + c.n + " done</span></div></td>";
        }).join("") +
        '<td class="r">' + fmtD(it.finish) + '</td><td class="r">' + (fmtDelay(it.delay) || DASH) + "</td></tr>";
    });
    $("tc-matrix").innerHTML = h + "</tbody></table></div>";
  }

  function render() {
    controls();
    var items = rowsInView(), acts = actsOf(items);
    UI.standardKpis($("tc-stats"), { acts: acts, items: items.length, itemsLabel: "Equipment types",
      itemsDone: items.filter(function (it) { return it.done === it.n; }).length, itemsDoneLabel: "fully commissioned" });
    levelCards(actsOf(items, true));
    grid(rowsInView(true));
    matrix(items);
  }

  /* ---------- drill-through: a cell, a type, a level card, a grid cell or a KPI opens its activities ---------- */
  function drill(title, sub, rows, status) {
    if (!window.JUIActDrill) return;
    window.JUIActDrill.open({ eyebrow: M.title, title: title, sub: sub, status: status || "", whereLabel: "Phase › level › equipment",
      rows: rows.map(function (a) { return Object.assign({ where: where(a) }, a); }) });
  }
  function onDrill(e) {
    var t = e.target.closest("[data-fph],[data-dk],[data-dst],[data-dlv]");
    if (!t || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    if (e.type === "keydown") e.preventDefault();
    if (t.hasAttribute("data-fph")) {
      F.phase = t.getAttribute("data-fph"); render();
      $("h-tc-mx").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (t.hasAttribute("data-dst")) {
      return drill({ late: "Late against baseline", overdue: "Overdue activities", started: "In progress" }[t.getAttribute("data-dst")] || "All activities",
        "Equipment types in view", actsOf(rowsInView()), t.getAttribute("data-dst"));
    }
    if (t.hasAttribute("data-dlv")) {
      var lv = t.getAttribute("data-dlv"), ph = t.hasAttribute("data-dph") ? t.getAttribute("data-dph") : F.phase;
      var rows = actsOf(t.hasAttribute("data-dph") ? rowsInView(true) : rowsInView(), true).filter(function (a) { return (lv === "" || a.stage === +lv) && (!ph || I[a.item].phase === ph); });
      return drill((ph || "All phases") + (lv === "" ? "" : " › " + LV[+lv].label + " " + (LV[+lv].name || "")), "Equipment types in view", rows);
    }
    var k = +t.getAttribute("data-dk"), it = I[k];
    var sub = [it.phase, it.disc, fmtI(it.units) + (it.units === 1 ? " item" : " units")].join(" · ");
    if (t.hasAttribute("data-ds")) {
      var s = +t.getAttribute("data-ds");
      return drill(it.name + " › " + LV[s].label, sub, A.filter(function (a) { return a.item === k && a.stage === s; }));
    }
    drill(it.name, sub, A.filter(function (a) { return a.item === k; }));
  }
  ["tc-stats", "tc-levels", "tc-grid", "tc-matrix"].forEach(function (id) { $(id).addEventListener("click", onDrill); $(id).addEventListener("keydown", onDrill); });

  /* ---------- CSV: one row per activity in view ---------- */
  $("tc-csv").addEventListener("click", function () {
    function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var head = ["Phase", "Discipline", "Equipment type", "Level", "Task ID", "Activity", "Status", "% complete", "Baseline start", "Baseline finish",
      "Planned start", "Planned finish", "Actual start", "Actual finish", "Overdue", "Delay days vs baseline"];
    var lines = actsOf(rowsInView()).map(function (a) {
      var it = I[a.item];
      return [it.phase, it.disc, it.name, LV[a.stage].label, a.taskId, a.name, a.status, a.pct, a.baselineStart, a.baselineFinish,
        a.plannedStart, a.plannedFinish, a.actualStart, a.actualFinish, a.overdue ? "Yes" : "No", a.delay].map(q).join(",");
    });
    var el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob(["﻿" + [head.map(q).join(",")].concat(lines).join("\n")], { type: "text/csv;charset=utf-8" }));
    el.download = (meta.key || "JUI") + "-commissioning.csv";
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000);
  });

  render();
})();
