/* Procurement page: stage-wise tracking of one master-schedule WBS branch (metrics.scurve.procurement,
   from calculation.py procurement()). Rows are the materials and agencies, grouped by part and WBS
   group; columns are the stages. calculation.py already summed each cell (latest finish, largest
   delay, counts); this page only filters and draws. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.scurve && P.metrics.scurve.procurement, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!M || !$("pv-core")) return;  // no procurement branch configured: this tracker stays hidden
  $("tab-proc").hidden = false;
  var UI = window.JUIProcUI, PANEL = $("pv-core");
  PANEL.setAttribute("data-ok", "");
  PANEL.setAttribute("data-name", "Core & Shell");
  PANEL.setAttribute("data-title", M.title);
  PANEL.setAttribute("data-desc", "Materials and specialised agencies of " + M.branch + ", stage by stage from RFQ to mobilisation: planned dates, status and delay against the baseline.");
  PANEL.setAttribute("data-open", String(M.items.filter(function (it) { return it.done < it.n; }).length));
  PANEL.setAttribute("data-count", M.items.length + " items");

  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  function fmtDelay(d) { return d == null ? "" : d > 0 ? '<span class="pr-late">+' + fmtI(d) + "d</span>" : d < 0 ? '<span class="pr-early">−' + fmtI(-d) + "d</span>" : '<span class="pr-ok">on time</span>'; }
  function fmtDelayT(d) { return d == null ? "no baseline" : d > 0 ? d + " days late" : d < 0 ? -d + " days early" : "on time"; }

  var I = M.items, A = M.activities, ST = M.stages;
  var F = { part: "", show: "all", q: "" };

  /* ---------- overview: KPI cards and the stage flow ---------- */
  function stats(items) {
    var ids = new Set(items.map(function (it) { return I.indexOf(it); }));
    var acts = A.filter(function (a) { return ids.has(a.item); });
    UI.standardKpis($("pr-stats"), { acts: acts, items: items.length, itemsLabel: "Materials & agencies",
      itemsDone: items.filter(function (it) { return it.done === it.n; }).length, itemsDoneLabel: "fully procured" });
    // a track per part (Material, Specialised Agencies); its stages under the groups of
    // display.procurement.stageGroups ([[group, [stage, ...]], ...]; a stage in none is "Other")
    var cfg = (P.data && P.data.procurement && P.data.procurement.stageGroups) || [];
    var groups = cfg.map(function (g) { return { label: g[0], stages: ST.map(function (_, s) { return s; }).filter(function (s) { return g[1].indexOf(ST[s]) >= 0; }) }; });
    var rest = ST.map(function (_, s) { return s; }).filter(function (s) { return !groups.some(function (g) { return g.stages.indexOf(s) >= 0; }); });
    if (rest.length) groups.push({ label: groups.length ? "Other" : "Stages", stages: rest });
    UI.flow($("pr-flow"), (F.part ? [F.part] : M.parts).map(function (pt) {
      var pa = acts.filter(function (a) { return I[a.item].part === pt; });
      var all = ST.map(function (_, s) { return s; });
      return { label: pt, icon: /agenc|contract|vendor/i.test(pt) ? "users" : "box", attr: UI.flowAttr(all, pt, pt),
        groups: groups.map(function (g) {
          var live = g.stages.filter(function (s) { return pa.some(function (a) { return a.stage === s; }); });
          return { label: g.label, attr: UI.flowAttr(live, pt, g.label), steps: g.stages.map(function (s) {
            return Object.assign({ label: ST[s], attr: UI.flowAttr([s], pt, ST[s]) }, UI.stageCounts(pa, s));
          }) };
        }) };
    }));
  }

  /* ---------- controls ---------- */
  function seg(id, opts, key) {
    $(id).innerHTML = opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (F[key] === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("");
  }
  function controls() {
    seg("pr-part", [["", "All"]].concat(M.parts.map(function (p) { return [p, p]; })), "part");
    seg("pr-show", [["all", "All items"], ["open", "Open"], ["overdue", "Overdue"], ["late", "Late vs baseline"]], "show");
  }
  $("pr-part").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F.part = b.getAttribute("data-v"); render(); } });
  $("pr-show").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F.show = b.getAttribute("data-v"); render(); } });
  var qt;
  $("pr-reset").addEventListener("click", function () { F.part = ""; F.show = "all"; F.q = ""; $("pr-q").value = ""; render(); });
  $("pr-q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { F.q = $("pr-q").value.trim().toLowerCase(); render(); }, 150); });

  function inView() {
    return I.filter(function (it) {
      if (F.part && it.part !== F.part) return false;
      if (F.show === "open" && it.done >= it.n) return false;
      if (F.show === "overdue" && !it.overdue) return false;
      if (F.show === "late" && !(it.delay > 0)) return false;
      return !F.q || (it.name + " " + it.group + " " + it.part).toLowerCase().indexOf(F.q) >= 0;
    });
  }

  /* ---------- matrix ---------- */
  function cellClass(c) { return c.done === c.n ? "c-done" : c.overdue ? "c-over" : c.done || c.started ? "c-prog" : "c-todo"; }
  function cellTip(k, s) {
    return A.filter(function (a) { return a.item === k && a.stage === s; }).map(function (a) {
      return a.name + "\n  " + a.status + " · " + a.pct + "% · planned finish " + fmtD(a.plannedFinish) + (a.actualFinish ? " · actual finish " + fmtD(a.actualFinish) : "") +
        " · baseline finish " + fmtD(a.baselineFinish) + " · " + fmtDelayT(a.delay) + (a.overdue ? " · OVERDUE" : "");
    }).join("\n");
  }
  function render() {
    controls();
    var items = inView();
    stats(items);
    if (!items.length) { $("pr-matrix").innerHTML = '<div class="empty">No material or agency matches these filters.</div>'; return; }
    var used = ST.map(function (_, s) { return items.some(function (it) { return it.cells[s]; }); });
    var cols = ST.map(function (_, s) { return s; }).filter(function (s) { return used[s]; });
    var span = cols.length + 4;
    var h = '<div class="tbl-wrap"><table><thead><tr><th class="it">Material / agency</th><th class="r">Done</th>' +
      cols.map(function (s) { return '<th class="st">' + esc(ST[s]) + "</th>"; }).join("") + '<th class="r">Finish</th><th class="r">Delay</th></tr></thead><tbody>';
    var part = null, grp = null;
    items.forEach(function (it) {
      var k = I.indexOf(it);
      if (it.part !== part) { part = it.part; grp = null; h += '<tr class="grp pr-part"><td colspan="' + span + '">' + esc(part) + "</td></tr>"; }
      if (it.group && it.group !== grp) { grp = it.group; h += '<tr class="grp pr-grp"><td colspan="' + span + '">' + esc(grp) + "</td></tr>"; }
      if (!it.group) grp = null;
      h += '<tr><td class="it"><button type="button" class="dr-name" data-dk="' + k + '" title="Open its activities"><b>' + esc(it.name) + '</b></button><span class="it-sub">' + esc(it.wbs) + "</span></td>" +
        '<td class="r">' + fmtI(it.done) + "/" + fmtI(it.n) + "</td>" +
        cols.map(function (s) {
          var c = it.cells[s];
          if (!c) return '<td class="pc"></td>';
          return '<td class="pc"><div class="pcell drill ' + cellClass(c) + '" role="button" tabindex="0" data-dk="' + k + '" data-ds="' + s + '" title="' + esc(cellTip(k, s)) + '"><span class="d">' + fmtD(c.finish) + '</span><span class="x">' + fmtDelay(c.delay) + "</span>" +
            (c.n > 1 ? '<span class="k">' + c.done + "/" + c.n + " done</span>" : "") + "</div></td>";
        }).join("") +
        '<td class="r">' + fmtD(it.finish) + '</td><td class="r">' + (fmtDelay(it.delay) || DASH) + "</td></tr>";
    });
    $("pr-matrix").innerHTML = h + "</tbody></table></div>";
  }

  /* ---------- drill-through: a cell, an item or a stat tile opens its activities ---------- */
  function drill(title, sub, rows, status) {
    if (!window.JUIActDrill) return;
    window.JUIActDrill.open({ eyebrow: M.title, title: title, sub: sub, status: status || "",
      rows: rows.map(function (a) { return Object.assign({ where: I[a.item].name + " › " + ST[a.stage] }, a); }) });
  }
  function onDrill(e) {
    var t = e.target.closest("[data-dk],[data-dst],[data-dflow]");
    if (!t || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    if (e.type === "keydown") e.preventDefault();
    if (t.hasAttribute("data-dflow")) {
      var vis = new Set(inView().map(function (it) { return I.indexOf(it); }));
      return drill(t.getAttribute("data-dlabel"), t.getAttribute("data-dpart") + " · items in view",
        UI.flowRows(t, A.filter(function (a) { return vis.has(a.item); }), function (a) { return I[a.item].part; }));
    }
    if (t.hasAttribute("data-dst")) {
      var ids = new Set(inView().map(function (it) { return I.indexOf(it); }));
      return drill({ late: "Late against baseline", overdue: "Overdue activities", started: "In progress" }[t.getAttribute("data-dst")] || "All activities",
        (F.part || "All materials & agencies") + " · items in view", A.filter(function (a) { return ids.has(a.item); }), t.getAttribute("data-dst"));
    }
    var k = +t.getAttribute("data-dk"), it = I[k];
    if (t.hasAttribute("data-ds")) {
      var s = +t.getAttribute("data-ds");
      return drill(it.name + " › " + ST[s], [it.part, it.group, it.wbs].filter(Boolean).join(" · "), A.filter(function (a) { return a.item === k && a.stage === s; }));
    }
    drill(it.name, [it.part, it.group, it.wbs].filter(Boolean).join(" · "), A.filter(function (a) { return a.item === k; }));
  }
  ["pr-matrix", "pr-stats", "pr-flow"].forEach(function (id) { $(id).addEventListener("click", onDrill); $(id).addEventListener("keydown", onDrill); });

  /* ---------- CSV: one row per activity ---------- */
  $("pr-csv").addEventListener("click", function () {
    function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var head = ["Part", "Group", "Material / agency", "Stage", "Task ID", "Activity", "Status", "% complete", "Baseline start", "Baseline finish",
      "Planned start", "Planned finish", "Actual start", "Actual finish", "Overdue", "Delay days vs baseline"];
    var ids = new Set(inView().map(function (it) { return I.indexOf(it); }));
    var lines = A.filter(function (a) { return ids.has(a.item); }).map(function (a) {
      var it = I[a.item];
      return [it.part, it.group, it.name, ST[a.stage], a.taskId, a.name, a.status, a.pct, a.baselineStart, a.baselineFinish,
        a.plannedStart, a.plannedFinish, a.actualStart, a.actualFinish, a.overdue ? "Yes" : "No", a.delay].map(q).join(",");
    });
    var el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob(["﻿" + [head.map(q).join(",")].concat(lines).join("\n")], { type: "text/csv;charset=utf-8" }));
    el.download = (meta.key || "JUI") + "-procurement.csv";
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000);
  });

  render();
})();
