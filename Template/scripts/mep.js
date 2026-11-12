/* MEP procurement page (metrics.scurve.mep, from calculation.py mep_procurement()). Rows are the
   materials, by scope and discipline, each discipline followed by its design-document rows (TDS
   items, shop drawings), which open to list their documents. Two views of the same rows: a stage
   matrix (phase bands over the stage columns) and a timeline (each stage's finish on a date axis).
   calculation.py already summed every cell; this page only filters and draws. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.scurve && P.metrics.scurve.mep, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!M || !$("pv-mep")) return;  // not configured: this tracker stays hidden
  $("tab-proc").hidden = false;
  var UI = window.JUIProcUI, PANEL = $("pv-mep");
  PANEL.setAttribute("data-ok", "");
  PANEL.setAttribute("data-name", "MEP");
  PANEL.setAttribute("data-title", M.title);
  PANEL.setAttribute("data-desc", "Each MEP material from order finalisation through design & development (TDS and shop drawings) to manufacturing clearance and delivery at site by phase. Material names come from the activity names.");
  PANEL.setAttribute("data-open", String(M.items.filter(function (it) { return it.kind === "material" && it.done < it.n; }).length));
  PANEL.setAttribute("data-count", M.items.filter(function (it) { return it.kind === "material"; }).length + " materials");

  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + p[0].slice(2); }
  function fmtDelay(d) { return d == null ? "" : d > 0 ? '<span class="pr-late">+' + fmtI(d) + "d</span>" : d < 0 ? '<span class="pr-early">−' + fmtI(-d) + "d</span>" : '<span class="pr-ok">on time</span>'; }
  function fmtDelayT(d) { return d == null ? "no baseline" : d > 0 ? d + " days late" : d < 0 ? -d + " days early" : "on time"; }
  function day(iso) { return iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5 : null; }

  var I = M.items, A = M.activities, ST = M.stages, PH = M.phases, SP = M.stagePhase, TODAY = M.today;
  var F = { view: /[?&#]view=timeline/.test(location.href) ? "timeline" : "matrix", part: "", disc: "", show: "all", q: "" }, open = {};
  var byItem = I.map(function () { return []; });
  A.forEach(function (a) { byItem[a.item].push(a); });
  function acts(k) {  // a doc row's activities are its documents'
    return I[k].kind === "docs" ? I[k].children.reduce(function (o, c) { return o.concat(byItem[c]); }, []) : byItem[k];
  }

  /* ---------- which rows ---------- */
  function keep(it) {
    if (F.part && it.part !== F.part) return false;
    if (F.disc && it.disc !== F.disc) return false;
    if (F.show === "open" && it.done >= it.n) return false;
    if (F.show === "overdue" && !it.overdue) return false;
    if (F.show === "late" && !(it.delay > 0)) return false;
    return !F.q || (it.name + " " + (it.aliases || []).join(" ") + " " + it.disc + " " + it.part).toLowerCase().indexOf(F.q) >= 0;
  }
  function rows() {  // [{k, depth}] in page order; a doc row shows when it or one of its documents passes
    var out = [];
    I.forEach(function (it, k) {
      if (it.kind === "material" && keep(it)) out.push({ k: k, depth: 0 });
      if (it.kind !== "docs") return;
      var kids = it.children.filter(function (c) { return keep(I[c]); });
      var self = keep(it) || (F.q && kids.length);
      if (!self && !kids.length) return;
      out.push({ k: k, depth: 0, kids: kids.length });
      if (open[k] || F.q) kids.forEach(function (c) { out.push({ k: c, depth: 1 }); });
    });
    return out;
  }

  /* ---------- overview: KPI cards and the stage flow ---------- */
  function summary(list) {
    var ks = new Set(), mats = [];
    list.forEach(function (r) { var it = I[r.k]; if (it.kind === "material") { mats.push(it); ks.add(r.k); } if (it.kind === "docs") it.children.forEach(function (c) { if (keep(I[c])) ks.add(c); }); if (it.kind === "doc") ks.add(r.k); });
    var as = VIEW = A.filter(function (a) { return ks.has(a.item); });
    UI.standardKpis($("mp-stats"), { acts: as, items: mats.length, itemsLabel: "Materials",
      itemsDone: mats.filter(function (it) { return it.done === it.n; }).length, itemsDoneLabel: "fully delivered" });
    // a track per scope (Day-1 Building, GIS Building), its stages under the three phases ("Other",
    // unparsed names, is in the matrix only)
    UI.flow($("mp-flow"), (F.part ? [F.part] : M.parts).map(function (pt) {
      var pa = as.filter(function (a) { return I[a.item].part === pt; });
      var all = ST.map(function (_, i) { return i; }).filter(function (i) { return SP[i] < PH.length - 1; });
      return { label: pt + (F.disc ? " · " + F.disc : ""), icon: /gis|sub ?station|power/i.test(pt) ? "bolt" : "building", attr: UI.flowAttr(all, pt, pt),
        groups: PH.slice(0, -1).map(function (ph, p) {
          var st = all.filter(function (i) { return SP[i] === p; });
          return { label: ph, attr: UI.flowAttr(st, pt, ph), steps: st.map(function (i) {
            return Object.assign({ label: ST[i], attr: UI.flowAttr([i], pt, ST[i]) }, UI.stageCounts(pa, i));
          }) };
        }) };
    }));
  }

  /* ---------- controls ---------- */
  function seg(id, opts, key) {
    $(id).innerHTML = opts.map(function (o) { return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (F[key] === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("");
  }
  function controls() {
    seg("mp-view", [["matrix", "Stage matrix"], ["timeline", "Timeline"]], "view");
    seg("mp-part", [["", "All"]].concat(M.parts.map(function (p) { return [p, p]; })), "part");
    seg("mp-disc", [["", "All disciplines"]].concat(M.disciplines.map(function (p) { return [p, p]; })), "disc");
    seg("mp-show", [["all", "All"], ["open", "Open"], ["overdue", "Overdue"], ["late", "Late vs baseline"]], "show");
  }
  ["view", "part", "disc", "show"].forEach(function (key) {
    $("mp-" + key).addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { F[key] = b.getAttribute("data-v"); render(); } });
  });
  var qt;
  $("mp-reset").addEventListener("click", function () { F.part = ""; F.disc = ""; F.show = "all"; F.q = ""; open = {}; $("mp-q").value = ""; render(); });
  $("mp-q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { F.q = $("mp-q").value.trim().toLowerCase(); render(); }, 150); });
  $("mp-body").addEventListener("click", function (e) {
    var t = e.target.closest("[data-open]");
    if (t) { var k = +t.getAttribute("data-open"); open[k] = !open[k]; render(); }
  });

  /* ---------- shared row parts ---------- */
  function cellClass(c) { return c.done === c.n ? "c-done" : c.overdue ? "c-over" : c.done || c.started ? "c-prog" : "c-todo"; }
  function tip(k, s) {
    var x = acts(k).filter(function (a) { return a.stage === s; });
    var more = x.length > 12 ? "\n… and " + (x.length - 12) + " more" : "";
    return x.slice(0, 12).map(function (a) {
      return a.name + "\n  " + a.status + " · " + a.pct + "% · planned finish " + fmtD(a.plannedFinish) + (a.actualFinish ? " · actual finish " + fmtD(a.actualFinish) : "") +
        " · baseline finish " + fmtD(a.baselineFinish) + " · " + fmtDelayT(a.delay) + (a.overdue ? " · OVERDUE" : "");
    }).join("\n") + more;
  }
  function nameCell(r) {
    var it = I[r.k];
    if (it.kind === "docs") return '<td class="it"><button type="button" class="mp-tog" data-open="' + r.k + '" aria-expanded="' + !!(open[r.k] || F.q) + '">' +
      (open[r.k] || F.q ? "▾" : "▸") + " <b>" + esc(it.name) + '</b></button><span class="it-sub">' + fmtI(it.children.length) + " documents" + (r.kids < it.children.length ? ", " + fmtI(r.kids) + " shown" : "") + "</span></td>";
    return '<td class="it' + (r.depth ? " mp-doc" : "") + '"><button type="button" class="dr-name" data-dk="' + r.k + '" title="Open its activities">' + (r.depth ? esc(it.name) : "<b>" + esc(it.name) + "</b>") + "</button>" +
      (it.aliases ? '<span class="it-sub" title="Activities under these names are matched to this material">also: ' + esc(it.aliases.join(", ")) + "</span>" : "") + "</td>";
  }
  function groupRows(list, span) {  // part and discipline header rows between the item rows
    var out = [], part = null, disc = null;
    list.forEach(function (r) {
      var it = I[r.k];
      if (it.part !== part) { part = it.part; disc = null; out.push('<tr class="grp pr-part"><td colspan="' + span + '">' + esc(part) + "</td></tr>"); }
      if (it.disc !== disc) { disc = it.disc; out.push('<tr class="grp pr-grp"><td colspan="' + span + '">' + esc(disc) + "</td></tr>"); }
      out.push(r);
    });
    return out;
  }

  /* ---------- matrix ---------- */
  function matrix(list) {
    var cols = ST.map(function (_, s) { return s; }).filter(function (s) { return list.some(function (r) { return I[r.k].cells[s]; }); });
    var span = cols.length + 4, bands = [];
    cols.forEach(function (s) { var b = bands[bands.length - 1]; if (b && b.p === SP[s]) b.n++; else bands.push({ p: SP[s], n: 1 }); });
    // each phase's columns: tinted in its colour, with a divider where the next phase starts
    function pc(s, i) { return " ph" + SP[s] + (i && SP[cols[i - 1]] !== SP[s] ? " gs" : ""); }
    var h = '<div class="tbl-wrap"><table><thead><tr class="mp-band"><th class="it" rowspan="2">Material</th><th class="r" rowspan="2">Done</th>' +
      bands.map(function (b, i) { return '<th class="ph ph' + b.p + (i ? " gs" : "") + '" colspan="' + b.n + '">' + esc(PH[b.p]) + "</th>"; }).join("") + '<th class="r" rowspan="2">Finish</th><th class="r" rowspan="2">Delay</th></tr><tr>' +
      cols.map(function (s, i) { return '<th class="st' + pc(s, i) + '">' + esc(ST[s]) + "</th>"; }).join("") + "</tr></thead><tbody>";
    groupRows(list, span).forEach(function (r) {
      if (typeof r === "string") { h += r; return; }
      var it = I[r.k];
      h += '<tr class="' + (it.kind === "docs" ? "mp-docs" : r.depth ? "mp-docr" : "") + '">' + nameCell(r) + '<td class="r">' + fmtI(it.done) + "/" + fmtI(it.n) + "</td>" +
        cols.map(function (s, i) {
          var c = it.cells[s];
          if (!c) return '<td class="pc' + pc(s, i) + '"></td>';
          return '<td class="pc' + pc(s, i) + '"><div class="pcell drill ' + cellClass(c) + '" role="button" tabindex="0" data-dk="' + r.k + '" data-ds="' + s + '" title="' + esc(tip(r.k, s)) + '"><span class="d">' + fmtD(c.finish) + '</span><span class="x">' + fmtDelay(c.delay) + "</span>" +
            (c.n > 1 ? '<span class="k">' + c.done + "/" + c.n + " done</span>" : "") + "</div></td>";
        }).join("") + '<td class="r">' + fmtD(it.finish) + '</td><td class="r">' + (fmtDelay(it.delay) || DASH) + "</td></tr>";
    });
    return h + "</tbody></table></div>";
  }

  /* ---------- timeline: a swimlane Gantt per material ----------
     Three thin lanes per row, one per phase (order finalisation, design & development, manufacturing
     & delivery), so phases that run side by side stay readable. Each stage is a block from its first
     start (actual, else planned) to its finish (actual when complete, else planned), coloured by
     status; a small tick under it marks the stage's baseline finish. "Now at" names the first stage
     not yet complete. */
  function stageStart(k, s) {
    return acts(k).filter(function (a) { return a.stage === s; }).reduce(function (m, a) { var d = a.actualStart || a.plannedStart; return d && (!m || d < m) ? d : m; }, null);
  }
  function nowAt(it) {
    var ks = Object.keys(it.cells).map(Number).sort(function (a, b) { return a - b; });
    var s = ks.filter(function (x) { var c = it.cells[x]; return c.done < c.n; })[0];
    if (s == null) return '<span class="mt-now done">All stages done</span>';
    var c = it.cells[s], cls = cellClass(c);
    return '<span class="mt-now n' + cls.slice(1) + '"><b>' + esc(ST[s]) + "</b><small>" + (cls === "c-over" ? "overdue · was due " : cls === "c-prog" ? "in progress · due " : "not started · due ") + fmtD(c.finish) + "</small></span>";
  }
  function timeline(list) {
    var lo = Infinity, hi = -Infinity, t = day(TODAY);
    list.forEach(function (r) {
      var cs = I[r.k].cells;
      Object.keys(cs).forEach(function (s) {
        [cs[s].finish, cs[s].baseline, stageStart(r.k, +s)].forEach(function (d) { d = day(d); if (d != null) { lo = Math.min(lo, d); hi = Math.max(hi, d); } });
      });
    });
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    if (!isFinite(lo)) return '<div class="empty">No dates to place.</div>';
    var d0 = new Date(lo * 864e5), d1 = new Date(hi * 864e5);  // whole months either side
    lo = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1) / 864e5;
    hi = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth() + 1, 1) / 864e5;
    function x(d) { return (100 * (d - lo) / (hi - lo)).toFixed(3) + "%"; }
    function w(a, b) { return (100 * Math.max(0, b - a) / (hi - lo)).toFixed(3) + "%"; }
    var months = [], grid = [], m = new Date(lo * 864e5), every = (hi - lo) / 30 > 30 ? 3 : 1;
    while (m.getTime() / 864e5 < hi) {
      var md = m.getTime() / 864e5;
      if (m.getUTCMonth() % every === 0) {
        if (!(every === 1 && m.getUTCMonth() === 1)) months.push('<span class="mt-tick' + (m.getUTCMonth() === 0 ? " y" : "") + '" style="left:' + x(md) + '">' + MON[m.getUTCMonth()] + (m.getUTCMonth() === 0 ? " " + String(m.getUTCFullYear()).slice(2) : "") + "</span>");
        grid.push('<i class="mt-grid' + (m.getUTCMonth() === 0 ? " y" : "") + '" style="left:' + x(md) + '"></i>');
      }
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    }
    var bg = grid.join("") + '<i class="mt-today" style="left:' + x(t) + '"></i>';
    var lanes = PH.length - 1;  // "Other" shares the last lane
    var h = '<div class="tbl-wrap mt-wrap"><table class="mt"><thead><tr><th class="it">Material</th><th class="mt-nowh">Now at</th><th class="r">Delay</th><th class="mt-axis"><div class="mt-track mt-head">' + months.join("") +
      '<span class="mt-todayl" style="left:' + x(t) + '">Today</span></div></th></tr></thead><tbody>';
    groupRows(list, 4).forEach(function (r) {
      if (typeof r === "string") { h += r; return; }
      var it = I[r.k], cs = it.cells;
      var blocks = Object.keys(cs).map(Number).filter(function (s) { return cs[s].finish; }).map(function (s) {
        var c = cs[s], e = day(c.finish), st = day(stageStart(r.k, s)), b = day(c.baseline), lane = Math.min(SP[s], lanes - 1);
        if (st == null || st > e) st = e;
        return '<i class="mt-blk ' + cellClass(c) + " ln" + lane + ' drill" data-dk="' + r.k + '" data-ds="' + s + '" style="left:' + x(st) + ";width:max(6px," + w(st, e + 1) + ')" title="' +
          esc(ST[s] + " · " + fmtD(stageStart(r.k, s)) + " → " + fmtD(c.finish) + " · " + fmtDelayT(c.delay) + "\n" + tip(r.k, s)) + '"></i>' +
          (b != null ? '<i class="mt-bl ln' + lane + '" style="left:' + x(b + 1) + '" title="' + esc(ST[s] + " baseline finish " + fmtD(c.baseline)) + '"></i>' : "");
      }).join("");
      h += '<tr class="' + (it.kind === "docs" ? "mp-docs" : r.depth ? "mp-docr" : "") + '">' + nameCell(r) +
        "<td>" + (it.kind === "material" || it.kind === "doc" ? nowAt(it) : '<span class="mt-now"><small>' + fmtI(it.done) + "/" + fmtI(it.n) + " done</small></span>") + "</td>" +
        '<td class="r">' + (fmtDelay(it.delay) || DASH) + '</td><td class="mt-axis"><div class="mt-track mt-row">' + bg +
        '<i class="mt-lane ln0"></i><i class="mt-lane ln1"></i><i class="mt-lane ln2"></i>' + blocks + "</div></td></tr>";
    });
    return h + "</tbody></table></div>";
  }

  /* ---------- drill-through: a cell, marker, material, stage bar or stat tile opens its activities ---------- */
  var VIEW = [];
  function where(a) { var it = I[a.item]; return (it.kind === "doc" ? I[it.parent].name + ": " : "") + it.name + " › " + ST[a.stage]; }
  function drill(title, sub, rows, status) {
    if (!window.JUIActDrill) return;
    window.JUIActDrill.open({ eyebrow: M.title, title: title, sub: sub, status: status || "",
      rows: rows.map(function (a) { return Object.assign({ where: where(a) }, a); }) });
  }
  function scope() { return [F.part || "All scopes", F.disc || "all disciplines"].join(" · "); }
  function onDrill(e) {
    var t = e.target.closest("[data-dk],[data-dst],[data-dflow]");
    if (!t || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    if (e.type === "keydown") e.preventDefault();
    if (t.hasAttribute("data-dst")) return drill({ late: "Late against baseline", overdue: "Overdue activities", started: "In progress" }[t.getAttribute("data-dst")] || "All activities", scope(), VIEW, t.getAttribute("data-dst"));
    if (t.hasAttribute("data-dflow")) return drill(t.getAttribute("data-dlabel"), t.getAttribute("data-dpart") + (F.disc ? " · " + F.disc : ""),
      UI.flowRows(t, VIEW, function (a) { return I[a.item].part; }));
    var k = +t.getAttribute("data-dk"), it = I[k], sub = [it.part, it.disc, it.kind === "doc" ? I[it.parent].name : ""].filter(Boolean).join(" · ");
    var rows = acts(k);
    if (t.hasAttribute("data-ds")) { var s = +t.getAttribute("data-ds"); return drill(it.name + " › " + ST[s], sub, rows.filter(function (a) { return a.stage === s; })); }
    drill(it.name, sub, rows);
  }
  ["mp-body", "mp-stats", "mp-flow"].forEach(function (id) { $(id).addEventListener("click", onDrill); $(id).addEventListener("keydown", onDrill); });

  function render() {
    controls();
    var list = rows();
    summary(list);
    $("mp-leg-tl").hidden = F.view !== "timeline";
    $("h-mp-mx").firstChild.nodeValue = F.view === "timeline" ? "Timeline" : "Stage matrix";
    $("mp-mx-desc").textContent = F.view === "timeline" ? "A swimlane Gantt per material: one lane per phase, each stage a block from its start to its finish, coloured by status; the dark tick is the stage's baseline finish. Now at is the first stage not yet complete. Select a block or a name for its activities" :
      "Each cell: the stage's finish (actual when complete, else planned) and its delay against the baseline finish. Select a cell or a name for its activities; TDS items and shop drawings open under each discipline";
    $("mp-body").className = F.view === "timeline" ? "mp-tl" : "mp-mx";
    $("mp-body").innerHTML = !list.length ? '<div class="empty">No material matches these filters.</div>' : F.view === "timeline" ? timeline(list) : matrix(list);
  }

  /* ---------- CSV: one row per activity of the rows in view ---------- */
  $("mp-csv").addEventListener("click", function () {
    function q(v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var head = ["Scope", "Discipline", "Material / document", "Phase", "Stage", "WBS", "Task ID", "Activity", "Status", "% complete", "Baseline start", "Baseline finish",
      "Planned start", "Planned finish", "Actual start", "Actual finish", "Overdue", "Delay days vs baseline"];
    var ks = new Set();
    I.forEach(function (it, k) { if (it.kind !== "docs" && keep(it)) ks.add(k); });
    var lines = A.filter(function (a) { return ks.has(a.item); }).map(function (a) {
      var it = I[a.item];
      return [it.part, it.disc, it.name, PH[SP[a.stage]], ST[a.stage], a.wbs, a.taskId, a.name, a.status, a.pct, a.baselineStart, a.baselineFinish,
        a.plannedStart, a.plannedFinish, a.actualStart, a.actualFinish, a.overdue ? "Yes" : "No", a.delay].map(q).join(",");
    });
    var el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob(["﻿" + [head.map(q).join(",")].concat(lines).join("\n")], { type: "text/csv;charset=utf-8" }));
    el.download = (meta.key || "JUI") + "-mep-procurement.csv";
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(function () { URL.revokeObjectURL(el.href); }, 1000);
  });

  render();
})();

/* the Core and Shell / MEP switch, once both trackers (procurement.js, this file) have set up */
(function () { if (window.JUIProcUI) window.JUIProcUI.setupSwitch(); })();
