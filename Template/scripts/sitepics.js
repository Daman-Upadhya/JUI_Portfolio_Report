/* Site progress page: each drawing of the DPR deck (metrics.progress) redrawn with its own
   mark-up, and the matching activities' progress and dates on and beside it. A slide is matched
   to an area and subtrade at build time; a pour label to a sub-location. The figures come from
   the same activity facts as the Quantity tracking page and follow the same status rules. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics, PR = M && M.progress, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!PR || !PR.slides || !PR.slides.length) return;
  $("tab-site").hidden = false;

  /* ---------- formatting ---------- */
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 }), nf2 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 2 });
  function fmtN(v) { return v == null || !isFinite(v) ? DASH : (Math.abs(v) >= 1000 ? nf0 : nf2).format(Math.abs(v) < 0.005 ? 0 : v); }
  function fmtI(v) { return v == null ? DASH : nf0.format(v); }
  function fmtP(v) { return v == null || !isFinite(v) ? DASH : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%"; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso, short) { if (!iso) return DASH; var p = iso.slice(0, 10).split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + (short ? p[0].slice(2) : p[0]); }
  function dnum(iso) { return Math.round(Date.parse(iso.slice(0, 10)) / 864e5); }
  function days(n) { return fmtI(n) + " day" + (n === 1 ? "" : "s"); }
  var T = M.facts.tasks, TODAY = M.today, TN = dnum(TODAY);

  /* ---------- one group of activities: the same sums and status rules as the subtrade cards ---------- */
  function plannedToDate(t) { return !t.ps || t.ps > TODAY ? 0 : t.pr * (dnum(t.pe < TODAY ? t.pe : TODAY) - dnum(t.ps) + 1); }
  function agg(rows) {
    var g = { n: rows.length, c: 0, s: 0, tq: 0, aq: 0, ptd: 0, asMin: null, aeMax: null, psMin: null, peMax: null, fcMax: null, fcSrc: null };
    rows.forEach(function (t) {
      g.tq += t.tq; g.aq += t.aq; g.ptd += plannedToDate(t);
      if (t.g === "complete") g.c++; else if (t.g === "started") g.s++;
      if (t.as && (!g.asMin || t.as < g.asMin)) g.asMin = t.as;
      if (t.ae && (!g.aeMax || t.ae > g.aeMax)) g.aeMax = t.ae;
      if (t.ps && (!g.psMin || t.ps < g.psMin)) g.psMin = t.ps;
      if (t.pe && (!g.peMax || t.pe > g.peMax)) g.peMax = t.pe;
      if (t.g !== "complete" && t.fc) { if (!g.fcMax || t.fc > g.fcMax) g.fcMax = t.fc; g.fcSrc = g.fcSrc && g.fcSrc !== t.fs ? "mixed" : t.fs; }
    });
    g.done = g.n > 0 && g.c === g.n;
    g.pct = g.tq ? 100 * g.aq / g.tq : null;
    g.plan = g.tq ? 100 * g.ptd / g.tq : null;
    g.status = !g.n ? "none" : !(g.tq > 0) || !g.peMax ? "missing" : g.done || g.aq >= g.tq ? "complete"
      : !g.aq && !g.asMin && g.psMin && g.psMin < TODAY ? "startLate" : g.peMax < TODAY ? "finishLate" : g.pct - g.plan < -5 ? "behind" : "onTrack";
    return g;
  }
  var ST = {
    complete: ["Complete", "&#10003;"], finishLate: ["Finish overdue", "&#9888;"], startLate: ["Start overdue", "&#9638;"],
    behind: ["Behind plan", "&#9719;"], onTrack: ["On track", "&#8599;"], missing: ["Missing data", "&#8854;"], none: ["No activities", "&#8854;"],
  };
  var FC_SRC = { baseline: "JUI-1A baseline", schedule: "Schedule Finish", mixed: "JUI-1A baseline and Schedule Finish" };
  function pill(st) { return '<span class="pk-pill pk-' + (st === "none" ? "missing" : st) + '"><i aria-hidden="true">' + ST[st][1] + "</i>" + ST[st][0] + "</span>"; }
  /* start, finish and forecast of a group: [date, note, tone] */
  function dates(g) {
    var start = g.asMin ? [fmtD(g.asMin, true), "Actual", ""] : g.psMin ? [fmtD(g.psMin, true), g.psMin < TODAY ? "Planned · " + days(TN - dnum(g.psMin)) + " late" : "Planned · starts in " + days(dnum(g.psMin) - TN), g.psMin < TODAY ? "late" : ""] : [DASH, "", ""];
    var fin;
    if (g.done && g.aeMax) fin = [fmtD(g.aeMax, true), "Actual", ""];
    else if (g.peMax) { var dd = dnum(g.peMax) - TN; fin = [fmtD(g.peMax, true), "Planned · " + (dd < 0 ? days(-dd) + " overdue" : dd === 0 ? "due today" : dd === 1 ? "due tomorrow" : "due in " + days(dd)), dd < 0 ? "late" : dd <= 7 ? "soon" : ""]; }
    else fin = [DASH, "", ""];
    var fc = g.done ? null : g.fcMax ? [fmtD(g.fcMax, true), FC_SRC[g.fcSrc] || "", g.peMax && g.fcMax > g.peMax ? "late" : ""] : [DASH, "no forecast date", ""];
    return { start: start, fin: fin, fc: fc };
  }

  /* ---------- area pills (this page's own filter) ---------- */
  var F = { a: "" };
  try { F.a = new URLSearchParams(location.hash.slice(1)).get("pa") || ""; } catch (e) { /* bad hash */ }
  function writeHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (F.a) h.set("pa", F.a); else h.delete("pa");
    try { history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname + location.search); } catch (e) { /* file:// */ }
  }
  var areas = [];
  PR.slides.forEach(function (s) { if (s.area && areas.indexOf(s.area) < 0) areas.push(s.area); });
  function pills() {
    $("sp-area-chips").innerHTML = areas.map(function (a) {
      var n = PR.slides.filter(function (s) { return s.area === a; }).length;
      return '<button type="button" class="fchip" data-v="' + esc(a) + '" aria-pressed="' + (F.a === a) + '" title="' + esc(n + " drawing" + (n === 1 ? "" : "s")) + '">' + esc(a) + "</button>";
    }).join("");
    $("sp-area-chips").querySelectorAll(".fchip").forEach(function (b) {
      b.addEventListener("click", function () { var v = b.getAttribute("data-v"); F.a = F.a === v ? "" : v; render(); var x = $("sp-area-chips").querySelector('[data-v="' + v.replace(/"/g, '\\"') + '"]'); if (x) x.focus(); });
    });
    $("sp-reset").disabled = !F.a;
  }
  $("sp-reset").addEventListener("click", function () { F.a = ""; render(); });

  /* ---------- a drawing: the picture, the DPR's own mark-up, and a chip per pour ---------- */
  var DASHES = { dash: "4 3", sysDash: "3 1", sysDot: "1 1", dot: "1 2", lgDash: "8 3", dashDot: "4 2 1 2" };
  function figure(s, zoneStats) {
    var v = s.view, im = s.image.box, u = v[2] / 1000;  // stroke and dash widths in thousandths of the drawing's width
    var shapes = s.elements.map(function (e) {
      var b = e.box, style = 'fill="' + (e.fill || "none") + '"' + (e.fill && e.alpha < 1 ? ' fill-opacity="' + e.alpha + '"' : "") +
        (e.line ? ' stroke="' + e.line + '" stroke-width="' + Math.max(e.lw, u * 0.8) + '"' + (DASHES[e.dash] ? ' stroke-dasharray="' + DASHES[e.dash].split(" ").map(function (d) { return d * Math.max(e.lw, u); }).join(" ") + '"' : "") : "");
      return e.geom === "path" && e.path ? '<path d="' + e.path + '" ' + style + "/>" : '<rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] + '" ' + style + "/>";
    }).join("");
    var chips = s.labels.map(function (l, i) {
      var b = l.box, x = 100 * (b[0] + b[2] / 2 - v[0]) / v[2], y = 100 * (b[1] + b[3] / 2 - v[1]) / v[3];
      var z = l.sub ? zoneStats[l.sub] : null, st = z ? z.status : "none";
      var tip = "<b>" + esc(l.text) + "</b>" + (z ? "<br>" + esc(ST[st][0]) + " · " + fmtP(z.pct) + " of scope (plan " + fmtP(z.plan) + ")<br>" + fmtN(z.aq) + " / " + fmtN(z.tq) + " " + esc(s.unit || "") +
        "<br>Start " + z.d.start[0] + " (" + esc(z.d.start[1]) + ")<br>Finish " + z.d.fin[0] + " (" + esc(z.d.fin[1]) + ")" + (z.d.fc ? "<br>Forecast " + z.d.fc[0] + (z.d.fc[1] ? " (" + esc(z.d.fc[1]) + ")" : "") : "")
        : "<br>No sub-area in this label: the whole " + esc(s.subtrade || "item") + " is shown beside the drawing");
      return '<span class="sp-chip pk-' + (st === "none" ? "missing" : st) + (z ? "" : " plain") + '" style="left:' + x.toFixed(2) + "%;top:" + y.toFixed(2) + '%" tabindex="0" data-tip="' + esc(tip) + '">' +
        "<b>" + esc(l.sub || l.text) + "</b>" + (z ? "<span>" + fmtP(z.pct) + '</span><i aria-hidden="true">' + ST[st][1] + "</i>" : "") + "</span>";
    }).join("");
    return '<div class="sp-fig" style="aspect-ratio:' + v[2] + " / " + v[3] + '"><svg viewBox="' + v.join(" ") + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + esc(s.title) + ' drawing with the DPR mark-up">' +
      '<image href="progress/' + encodeURIComponent(s.image.file) + '" x="' + im[0] + '" y="' + im[1] + '" width="' + im[2] + '" height="' + im[3] + '" preserveAspectRatio="none"/>' + shapes + "</svg>" + chips + "</div>";
  }

  function card(s) {
    var rows = T.filter(function (t) { return t.a === s.area && t.st === s.subtrade; });
    var g = agg(rows), d = dates(g), U = esc(s.unit && s.unit !== "mixed" ? s.unit.toLowerCase() : "");
    /* sub-areas: the pours named on the drawing, or else the sub-locations the activities sit in */
    var subs = s.labels.filter(function (l) { return l.sub; }).map(function (l) { return l.sub; });
    if (!subs.length) rows.forEach(function (t) { if (subs.indexOf(t.sl) < 0) subs.push(t.sl); });
    subs.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    var zs = {};
    subs.forEach(function (sub) { var z = agg(rows.filter(function (t) { return t.sl === sub; })); z.d = dates(z); zs[sub] = z; });
    function kv(l, v) { return '<div class="sp-kv"><span>' + l + '</span><span class="' + (v[2] || "") + '">' + v[0] + (v[1] ? '<small class="' + (v[2] || "") + '">' + esc(v[1]) + "</small>" : "") + "</span></div>"; }
    var vs = g.pct != null && g.plan != null ? g.pct - g.plan : null;
    var side = !s.subtrade ? '<div class="empty">No subtrade in the data matches this slide’s title.</div>' :
      '<div class="sp-big">' + fmtP(g.pct) + '</div><div class="sp-sub">of scope achieved · plan to date <b>' + fmtP(g.plan) + "</b>" +
      (vs == null ? "" : ' <span class="' + (vs < -0.05 ? "neg" : "pos") + '">' + (Math.abs(vs) < 0.05 ? "on plan" : (vs > 0 ? "+" : "−") + Math.abs(vs).toFixed(1).replace(/\.0$/, "") + " pts") + "</span>") + "</div>" +
      '<div class="sp-bar pk-' + g.status + '"><i style="width:' + Math.max(0, Math.min(100, g.pct || 0)) + '%"></i><b style="left:' + Math.max(0, Math.min(100, g.plan || 0)) + '%"></b></div>' +
      '<div class="sp-rows">' + kv("Scope", [fmtN(g.tq) + " " + U, "", ""]) + kv("Plan to date", [fmtN(g.ptd), "", ""]) + kv("Actual to date", ["<b>" + fmtN(g.aq) + "</b>", "", ""]) +
      '<div class="sp-sep"></div>' + kv("Start", d.start) + kv("Finish", d.fin) + (d.fc ? kv("Forecast", d.fc) : "") +
      '<div class="sp-n">' + fmtI(g.n) + " activit" + (g.n === 1 ? "y" : "ies") + " · " + fmtI(g.c) + " complete</div></div>";
    var table = subs.length > 1 || s.labels.some(function (l) { return l.sub; }) ? '<div class="tbl-wrap sp-tbl"><table><thead><tr><th>Sub-area</th><th>Status</th><th>Progress</th><th class="r">Actual / scope</th><th>Start</th><th>Finish</th><th>Forecast</th></tr></thead><tbody>' +
      subs.map(function (sub) {
        var z = zs[sub], dc = function (v) { return v ? '<span class="' + (v[2] || "") + '">' + v[0] + "</span>" + (v[1] ? '<small class="' + (v[2] || "") + '">' + esc(v[1]) + "</small>" : "") : DASH; };
        return "<tr><td><b>" + esc(sub) + "</b></td><td>" + pill(z.status) + '</td><td><div class="sp-mini pk-' + z.status + '"><i style="width:' + Math.max(0, Math.min(100, z.pct || 0)) + '%"></i><b style="left:' + Math.max(0, Math.min(100, z.plan || 0)) + '%"></b></div><span class="sp-pc">' + fmtP(z.pct) + "</span></td>" +
          '<td class="r">' + fmtN(z.aq) + " / " + fmtN(z.tq) + '</td><td class="sp-dt">' + dc(z.d.start) + '</td><td class="sp-dt">' + dc(z.d.fin) + '</td><td class="sp-dt">' + dc(z.done ? null : z.d.fc) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : "";
    return '<article class="sp-card"><div class="sp-head"><div><div class="eyebrow">' + esc(s.area || "") + (s.subtrade ? " · " + esc(s.subtrade) + (U ? " (" + U + ")" : "") : "") + "</div><h3>" + esc(s.title) + "</h3></div>" + (s.subtrade ? pill(g.status) : "") + "</div>" +
      '<div class="sp-body">' + figure(s, zs) + '<div class="sp-side">' + side + "</div></div>" + table + "</article>";
  }

  function render() {
    pills();
    var list = PR.slides.filter(function (s) { return !F.a || s.area === F.a; });
    $("sp-hint").innerHTML = "<span>Drawings from <b>" + esc(PR.source) + "</b>, saved " + fmtD(PR.updated) + "</span><span>" + fmtI(list.length) + " of " + fmtI(PR.slides.length) + " drawings in view</span><span>Today <b>" + fmtD(TODAY) + "</b></span>";
    $("sp-cards").innerHTML = list.length ? list.map(card).join("") : '<div class="empty">No drawing for this area.</div>';
    writeHash();
  }
  render();
})();
