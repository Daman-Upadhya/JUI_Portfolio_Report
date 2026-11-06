/* Shared parts of the Procurement page's two trackers (procurement.js: Core and Shell, mep.js: MEP):
   KPI cards with icons, the stage flow (each stage a ring of complete / in progress / overdue, joined
   by flow lines, grouped under its phase), and the Core and Shell / MEP switch, which runs once both
   trackers have set up (see the end of mep.js). window.JUIProcUI */
(function () {
  "use strict";
  var LOC = "en-IN";
  try { LOC = (JSON.parse(document.getElementById("data").textContent).meta || {}).locale || LOC; } catch (e) { /* default */ }
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  function fmtI(v) { return v == null || !isFinite(v) ? "—" : nf0.format(v); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function svg(d) { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>"; }
  var ICON = {
    box: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
    done: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
    seal: svg('<path d="M12 2 15 5h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    prog: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    trend: svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
    clock: svg('<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>'),
    truck: svg('<path d="M1 4h13v12H1zM14 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
  };

  /* tiles: [{ icon, v, l, sub, tone: brand|good|prog|bad|muted, frac (0..1, a bar), attr (drill data-*) }] */
  function kpis(el, tiles) {
    el.innerHTML = tiles.map(function (t) {
      var drill = t.attr != null;
      return '<div class="kp kp-' + (t.tone || "brand") + (drill ? " drill" : "") + '"' + (drill ? ' role="button" tabindex="0" ' + t.attr + ' title="Open these activities"' : "") + ">" +
        '<span class="kp-i">' + (ICON[t.icon] || "") + '</span><div class="kp-t"><div class="kp-v">' + t.v + '</div><div class="kp-l">' + esc(t.l) + "</div>" +
        (t.sub ? '<div class="kp-s">' + t.sub + "</div>" : "") +
        (t.frac != null ? '<div class="kp-bar"><i style="width:' + Math.max(0, Math.min(100, 100 * t.frac)).toFixed(1) + '%"></i></div>' : "") + "</div></div>";
    }).join("");
  }

  /* ---------- stage flow ----------
     tracks: [{ label, icon, attr, groups: [{ label, attr, steps: [{ label, attr, n, done, started,
     startedOver, overdue }] }] }]. A track is one card (a part: Material, Specialised Agencies; or a
     scope: Day-1 Building, GIS Building); its groups are labelled bars over their stages (Procurement,
     Submittals & approval, ...); each stage is an icon tile with its status, % and counts, joined to
     the next by an arrow, solid once the stage is complete. Stages with no activities are left out. */
  var STEP_ICON = [  // stage name pattern -> icon
    [/rfq|enquir/i, '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'],
    [/bid|discussion|meeting/i, '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>'],
    [/technical|evaluation/i, '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>'],
    [/\bpo\b|order/i, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'],
    [/onboard|vendor/i, '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'],
    [/tds/i, '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15l3-3 3 3"/>'],
    [/shop drawing/i, '<path d="m12 19 7-7 3 3-7 7z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="m2 2 7.6 7.6"/><circle cx="11" cy="11" r="2"/>'],
    [/co-?ordinat/i, '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'],
    [/approv/i, '<path d="M12 2 15 5h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'],
    [/submi/i, '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>'],
    [/mock/i, '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'],
    [/manufactur|clearance/i, '<path d="M2 20V9l6 4V9l6 4V4h8v16z"/><path d="M6 17h2M12 17h2M18 17h0"/>'],
    [/fabricat/i, '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>'],
    [/deliver/i, '<path d="M1 4h13v12H1zM14 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'],
    [/mobili/i, '<path d="M2 18h20M4 18v-3a8 8 0 0 1 16 0v3"/><path d="M10 7V5a2 2 0 0 1 4 0v2M12 7v5"/>'],
    [/./, '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'],
  ];
  var TRACK_ICON = {
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  };
  var STATUS_TXT = { done: "Done", prog: "On track", todo: "Not started" };
  function pct(a, b) { return b ? 100 * a / b : 0; }
  function fmtP(v) { return (Math.round(v * 10) / 10).toFixed(v >= 99.95 || v === 0 ? 0 : 1).replace(/\.0$/, "") + "%"; }
  function stepState(s) { return s.done === s.n ? "done" : s.overdue ? "over" : s.done || s.started ? "prog" : "todo"; }
  function stepIcon(label) { for (var i = 0; i < STEP_ICON.length; i++) if (STEP_ICON[i][0].test(label)) return STEP_ICON[i][1]; return ""; }
  function bar(done, over, n, cls) {  // done | overdue | the rest
    return '<span class="' + cls + '"><i class="b-done" style="width:' + pct(done, n).toFixed(2) + '%"></i><i class="b-over" style="width:' + pct(over, n).toFixed(2) + '%"></i></span>';
  }
  function small(d, size) { return svg(d).replace('width="18" height="18"', 'width="' + size + '" height="' + size + '"'); }
  function chip(icon, text, cls) { return '<span class="ft-chip ' + (cls || "") + '">' + small(icon, 13) + esc(text) + "</span>"; }
  function flow(el, tracks) {
    var html = tracks.map(function (t, ti) {
      var groups = t.groups.map(function (g) { return Object.assign({}, g, { steps: g.steps.filter(function (s) { return s.n; }) }); }).filter(function (g) { return g.steps.length; });
      var steps = [].concat.apply([], groups.map(function (g) { return g.steps; }));
      if (!steps.length) return "";
      var n = 0, d = 0, o = 0;
      steps.forEach(function (s) { n += s.n; d += s.done; o += s.overdue; });
      // the bottleneck: the one stage with the most overdue activities (none on a tie)
      var top = Math.max.apply(null, steps.map(function (s) { return s.overdue; }));
      var worst = top > 0 && steps.filter(function (s) { return s.overdue === top; }).length === 1 ? steps.filter(function (s) { return s.overdue === top; })[0] : null;
      var head = '<div class="ft-head"><div class="ft-id' + (t.attr ? " drill" : "") + '"' + (t.attr ? ' role="button" tabindex="0" ' + t.attr + ' title="Open all its activities"' : "") + ">" +
        '<span class="ft-ic">' + svg(TRACK_ICON[t.icon] || TRACK_ICON.box) + '<b class="ft-no">' + (ti + 1) + "</b></span>" +
        '<div><div class="ft-title">' + esc(t.label) + '</div><div class="ft-chips">' +
        chip('<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>', steps.length + " stages", "") +
        (o ? chip('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>', fmtI(o) + " overdue", "bad") : "") +
        (worst ? chip('<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>', "Bottleneck: " + worst.label, "warn") : "") + "</div></div></div>" +
        '<div class="ft-sum"><div class="ft-sum-t"><span class="ft-pct">' + fmtP(pct(d, n)) + '</span><span class="ft-cnt">' + fmtI(d) + "/" + fmtI(n) + " done · " + fmtI(o) + " overdue · " + fmtI(n - d - o) + " pending</span></div>" +
        bar(d, o, n, "ft-bar") + "</div></div>";
      var k = 0;
      var body = groups.map(function (g) {
        var gn = 0, gd = 0;
        g.steps.forEach(function (s) { gn += s.n; gd += s.done; });
        return '<div class="fg" style="flex-grow:' + g.steps.length + '"><div class="fg-h' + (g.attr ? " drill" : "") + '"' + (g.attr ? ' role="button" tabindex="0" ' + g.attr + ' title="Open this group\'s activities"' : "") + ">" +
          "<b>" + esc(g.label) + "</b><span>" + fmtP(pct(gd, gn)) + '</span></div><div class="fg-steps">' + g.steps.map(function (s) {
            var st = stepState(s), last = ++k === steps.length;
            return '<div class="fs fs-' + st + (s === worst ? " fs-hot" : "") + ' drill" role="button" tabindex="0" ' + s.attr + ' title="' + esc(s.label) + ": " + s.done + " of " + s.n + " complete, " + s.started + " in progress, " + s.overdue + ' overdue">' +
              '<div class="fs-top"><span class="fs-ic">' + small(stepIcon(s.label), 15) + '<i class="fs-dot"></i></span>' +
              (last ? "" : '<span class="fs-link' + (st === "done" ? " solid" : "") + '" aria-hidden="true"></span>') + "</div>" +
              '<span class="fs-l">' + esc(s.label) + "</span>" +
              '<span class="fs-n"><b>' + fmtI(s.done) + "</b>/ " + fmtI(s.n) + "</span>" +
              bar(s.done, s.overdue, s.n, "fs-bar") +
              '<span class="fs-f"><span class="fs-s"><i></i>' + (st === "over" ? fmtI(s.overdue) + " overdue" : STATUS_TXT[st]) + '</span><span class="fs-p">' + fmtP(pct(s.done, s.n)) + "</span></span></div>";
          }).join("") + "</div></div>";
      }).join("");
      return '<section class="ft">' + head + '<div class="ft-body">' + body + "</div></section>";
    }).join("");
    el.innerHTML = html || '<div class="empty">No stages in view.</div>';
  }

  /* per stage counts from activity records: { n, done, started, overdue } */
  function stageCounts(acts, stage) {
    var x = acts.filter(function (a) { return a.stage === stage; });
    return { n: x.length, done: x.filter(function (a) { return a.group === "complete"; }).length,
      started: x.filter(function (a) { return a.group === "started"; }).length,
      startedOver: x.filter(function (a) { return a.group === "started" && a.overdue; }).length,
      overdue: x.filter(function (a) { return a.overdue; }).length };
  }

  /* the standard six KPI cards of a tracker, from the items and activities in view */
  function standardKpis(el, o) {
    var acts = o.acts, n = acts.length;
    var c = function (f) { return acts.filter(f).length; };
    var done = c(function (a) { return a.group === "complete"; }), prog = c(function (a) { return a.group === "started"; });
    var over = c(function (a) { return a.overdue; }), late = c(function (a) { return a.delay > 0; });
    var mx = acts.reduce(function (m, a) { return a.delay != null && (m == null || a.delay > m) ? a.delay : m; }, null);
    kpis(el, [
      { icon: "box", v: fmtI(o.items), l: o.itemsLabel, sub: fmtI(o.itemsDone) + " " + o.itemsDoneLabel, tone: "brand", frac: o.items ? o.itemsDone / o.items : null },
      { icon: "done", v: fmtI(done) + '<small> / ' + fmtI(n) + "</small>", l: "Activities complete", sub: (n ? Math.round(100 * done / n) : 0) + "% complete", tone: "good", frac: n ? done / n : null, attr: 'data-dst=""' },
      { icon: "prog", v: fmtI(prog), l: "In progress", sub: "started, not complete", tone: "prog", attr: 'data-dst="started"' },
      { icon: "alert", v: fmtI(over), l: "Overdue", sub: "planned finish passed", tone: over ? "bad" : "muted", attr: 'data-dst="overdue"' },
      { icon: "trend", v: fmtI(late), l: "Late vs baseline", sub: (n ? Math.round(100 * late / n) : 0) + "% of activities", tone: late ? "bad" : "muted", attr: 'data-dst="late"' },
      { icon: "clock", v: mx == null ? "—" : (mx > 0 ? "+" : "") + fmtI(mx) + "<small>d</small>", l: "Largest delay", sub: "vs baseline finish", tone: mx > 0 ? "bad" : "muted", attr: 'data-dst="late"' },
    ]);
  }

  /* the Core and Shell / MEP switch: panels say they are ready with data-ok, their name in data-name,
     their open count in data-open; the choice is kept in the URL as pv= */
  function setupSwitch() {
    var $ = function (id) { return document.getElementById(id); };
    var sw = $("pv-mode");
    if (!sw) return;
    var panels = Array.prototype.filter.call(document.querySelectorAll(".pv-panel"), function (p) { return p.hasAttribute("data-ok"); });
    if (!panels.length) return;
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get("p") === "mep") { h.set("p", "proc"); h.set("pv", "mep"); }  // the old MEP tab
    var cur = h.get("pv");
    if (!panels.some(function (p) { return p.getAttribute("data-key") === cur; })) cur = panels[0].getAttribute("data-key");
    try { history.replaceState(null, "", "#" + h.toString()); } catch (e) { /* file:// */ }
    var open = panels.reduce(function (s, p) { return s + (+p.getAttribute("data-open") || 0); }, 0);
    if ($("n-proc")) $("n-proc").textContent = fmtI(open) + " open";
    sw.hidden = panels.length < 2;
    sw.innerHTML = panels.map(function (p) {
      var k = p.getAttribute("data-key");
      return '<button type="button" role="tab" data-v="' + k + '"><span class="pv-mi">' + (ICON[p.getAttribute("data-icon")] || "") + '</span><span class="pv-mt"><b>' + esc(p.getAttribute("data-name")) +
        "</b><small>" + fmtI(+p.getAttribute("data-open") || 0) + " open · " + esc(p.getAttribute("data-count") || "") + "</small></span></button>";
    }).join("");
    function show(k) {
      cur = k;
      panels.forEach(function (p) { p.hidden = p.getAttribute("data-key") !== k; });
      sw.querySelectorAll("button").forEach(function (b) { var on = b.getAttribute("data-v") === k; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
      var p = panels.filter(function (x) { return x.getAttribute("data-key") === k; })[0];
      $("pv-title").textContent = p.getAttribute("data-title");
      $("pv-desc").textContent = p.getAttribute("data-desc") || "";
      var q = new URLSearchParams(location.hash.slice(1));
      q.set("pv", k);
      try { history.replaceState(null, "", "#" + q.toString()); } catch (e) { /* file:// */ }
    }
    sw.addEventListener("click", function (e) { var b = e.target.closest("button[data-v]"); if (b) show(b.getAttribute("data-v")); });
    sw.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      var ks = panels.map(function (p) { return p.getAttribute("data-key"); }), i = ks.indexOf(cur);
      e.preventDefault(); show(ks[(i + (e.key === "ArrowRight" ? 1 : ks.length - 1)) % ks.length]);
      sw.querySelector('[aria-selected="true"]').focus();
    });
    show(cur);
  }

  /* drill attributes of a track / group / stage: its stages, its track (part or scope), a title */
  function flowAttr(stages, part, label) {
    return 'data-dflow="' + stages.join(",") + '" data-dpart="' + esc(part) + '" data-dlabel="' + esc(label) + '"';
  }
  /* the activities a data-dflow element stands for, out of acts; partOf(a) = the activity's track */
  function flowRows(t, acts, partOf) {
    var ss = new Set(t.getAttribute("data-dflow").split(",").map(Number)), pt = t.getAttribute("data-dpart");
    return acts.filter(function (a) { return ss.has(a.stage) && partOf(a) === pt; });
  }

  window.JUIProcUI = { flowAttr: flowAttr, flowRows: flowRows, kpis: kpis, flow: flow, stageCounts: stageCounts, standardKpis: standardKpis, setupSwitch: setupSwitch, icon: ICON };
})();
