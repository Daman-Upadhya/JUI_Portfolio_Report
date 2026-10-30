/* Second page: the weightage S-curve (metrics.scurve), and the page tabs.
   Sums what calculation.py emitted: each weighted task's baseline rate (br per day over bs..be),
   planned rate (pr per day over ps..pe) and earned rate (ar per day over as..ax). Summing them for
   the filtered tasks reproduces the baseline, planned and actual daily tables; nothing here
   re-derives a rule. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.scurve, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!M) return;  // no S-curve configured: a single-page report, the tabs stay hidden

  /* ---------- formatting ---------- */
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 }), nf2 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 2 });
  function fmtN(v) { return v == null || !isFinite(v) ? DASH : (Math.abs(v) >= 1000 ? nf0 : nf2).format(Math.abs(v) < 0.005 ? 0 : v); }
  function fmtI(v) { return v == null ? DASH : nf0.format(v); }
  function fmtP(v, dp) { return v == null || !isFinite(v) ? DASH : v.toFixed(dp == null ? 1 : dp).replace(/\.0+$/, "") + "%"; }
  function fmtPts(v) { if (v == null || !isFinite(v)) return DASH; var a = Math.abs(v) < 0.05 ? 0 : v; return (a > 0 ? "+" : a < 0 ? "−" : "") + Math.abs(a).toFixed(1).replace(/\.0$/, "") + " pts"; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso, short) { if (!iso) return DASH; var p = iso.slice(0, 10).split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + (short ? p[0].slice(2) : p[0]); }
  function fmtM(iso) { var p = iso.split("-"); return MON[+p[1] - 1] + " " + p[0].slice(2); }
  var DAY = 864e5;
  function dnum(iso) { return Math.round(Date.parse(iso.slice(0, 10)) / DAY); }
  function diso(n) { return new Date(n * DAY).toISOString().slice(0, 10); }

  /* ---------- tooltip (the shared #tip) ---------- */
  var tip = $("tip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + "px";
    tip.style.top = (y - h - 12 < 8 ? y + 16 : y - h - 12) + "px";
  }
  function hideTip() { tip.classList.remove("on"); }

  /* ---------- hash: this page's keys sit beside the quantity page's ---------- */
  var HK = { a: "sa", sl: "ssl", grp: "sg", ph: "sph" };
  var F = { a: "", sl: "", grp: "", ph: "" };
  try {
    var hp = new URLSearchParams(location.hash.slice(1));
    Object.keys(HK).forEach(function (k) { if (hp.get(HK[k])) F[k] = hp.get(HK[k]); });
  } catch (e) { /* bad hash */ }
  function writeHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    Object.keys(HK).forEach(function (k) { if (F[k]) h.set(HK[k], F[k]); else h.delete(HK[k]); });
    try { history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname + location.search); } catch (e) { /* file:// */ }
  }

  /* ---------- tab (switching lives in tabs.js) ---------- */
  $("tab-scurve").hidden = false;
  document.addEventListener("jui:page", function (e) { if (e.detail === "scurve" && !M.unavailable) renderCurve(current, curS); });  // the chart sizes itself to its now-visible card

  /* ---------- header ---------- */
  var src = M.source || {};
  $("s-title").textContent = src.title || "S-curve";
  if (M.unavailable) {
    $("s-filters").hidden = true;
    ["s-progress", "s-kpis", "s-trio", "s-curve", "s-areas", "s-join"].forEach(function (id) { $(id).innerHTML = '<div class="empty">The master schedule could not be loaded on this refresh and there is no saved copy. The next refresh will try again.</div>'; });
    $("n-scurve").textContent = "no data";
    return;
  }
  var asof = src.dataAsOf;
  $("s-facts").innerHTML = "<span>" + (src.origin === "sample" ? "Sample export" : src.origin === "cache" ? "Saved copy from" : "Data as of") + ": <b>" +
    (asof ? fmtD(asof) + ", " + asof.slice(11, 16) + " IST" : DASH) + "</b></span><span>Today: <b>" + fmtD(M.today) + "</b></span><span>Weighted tasks: <b>" + fmtI(M.totals.weighted) + "</b></span>";
  var T = M.facts.tasks, TODAY = M.today, TN = dnum(TODAY), J = M.join || { rows: [] };

  /* ---------- filters ---------- */
  var SEL = { a: "s-f-area", sl: "s-f-sub", grp: "s-f-grp", ph: "s-f-ph" };
  function countBy(rows, key) { var m = new Map(); rows.forEach(function (r) { m.set(r[key], (m.get(r[key]) || 0) + 1); }); return m; }
  function byCount(m) { return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); }); }
  function options(id, entries, all, value) {
    $(id).innerHTML = '<option value="">' + esc(all) + "</option>" + entries.map(function (e) { return '<option value="' + esc(e[0]) + '">' + esc(e[0]) + " (" + fmtI(e[1]) + ")</option>"; }).join("");
    $(id).value = value;
  }
  /* Area as a row of pill slicers; the hidden select stays the single source of the value */
  function chipSlicer(selId, boxId) {
    var sel = $(selId), box = $(boxId);
    box.innerHTML = Array.prototype.filter.call(sel.options, function (o) { return o.value; }).map(function (o) {
      return '<button type="button" class="fchip" data-v="' + esc(o.value) + '" aria-pressed="' + (sel.value === o.value) + '" title="' + esc(o.textContent) + '">' + esc(o.value) + "</button>";
    }).join("");
    box.querySelectorAll(".fchip").forEach(function (b) {
      if (box._focus === b.getAttribute("data-v")) { b.focus(); box._focus = null; }
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        box._focus = v;
        sel.value = sel.value === v ? "" : v;
        sel.dispatchEvent(new Event("change"));
      });
    });
  }
  function fillFilters() {
    options("s-f-area", byCount(countBy(T, "a")), "All areas", F.a);
    chipSlicer("s-f-area", "s-f-area-chips");
    var subs = byCount(countBy(F.a ? T.filter(function (t) { return t.a === F.a; }) : T, "sl"));
    if (F.sl && !subs.some(function (e) { return e[0] === F.sl; })) F.sl = "";
    options("s-f-sub", subs, F.a ? "All in " + F.a : "All sub-locations", F.sl);
    options("s-f-grp", byCount(countBy(T, "grp")), "All groups", F.grp);
    options("s-f-ph", byCount(countBy(T, "ph")), "All phases", F.ph);
    $("s-reset").disabled = !Object.keys(F).some(function (k) { return F[k]; });
  }
  function matches(t) { return (!F.a || t.a === F.a) && (!F.sl || t.sl === F.sl) && (!F.grp || t.grp === F.grp) && (!F.ph || t.ph === F.ph); }
  Object.keys(SEL).forEach(function (k) { $(SEL[k]).addEventListener("change", function () { F[k] = this.value; if (k === "a") F.sl = ""; render(); }); });
  $("s-reset").addEventListener("click", function () { Object.keys(F).forEach(function (k) { F[k] = ""; }); render(); });

  /* ---------- daily series from the rates ---------- */
  function series(R) {
    var lo = Infinity, hi = -Infinity, W = 0;
    R.forEach(function (t) {
      if (t.bs) { lo = Math.min(lo, dnum(t.bs)); hi = Math.max(hi, dnum(t.be)); W += t.w; }
      if (t.ps) { lo = Math.min(lo, dnum(t.ps)); hi = Math.max(hi, dnum(t.pe)); }
      if (t.ax) { lo = Math.min(lo, dnum(t.as)); hi = Math.max(hi, dnum(t.ax)); }
    });
    if (!isFinite(lo) || !W) return null;
    var N = hi - lo + 1, base = new Float64Array(N), plan = new Float64Array(N), act = new Float64Array(N), i, k;
    R.forEach(function (t) {
      if (t.bs && t.br) for (i = dnum(t.bs), k = dnum(t.be); i <= k; i++) base[i - lo] += t.br;
      if (t.ps && t.pr) for (i = dnum(t.ps), k = dnum(t.pe); i <= k; i++) plan[i - lo] += t.pr;
      if (t.ax && t.ar) for (i = dnum(t.as), k = dnum(t.ax); i <= k; i++) act[i - lo] += t.ar;
    });
    var cb = new Float64Array(N), cp = new Float64Array(N), ca = new Float64Array(N), sb = 0, sp = 0, sa = 0;
    for (i = 0; i < N; i++) { sb += base[i]; sp += plan[i]; sa += act[i]; cb[i] = sb; cp[i] = sp; ca[i] = sa; }
    function at(arr, dn) { return dn < lo ? 0 : arr[Math.min(dn, hi) - lo]; }
    return { lo: lo, hi: hi, W: W, base: base, plan: plan, act: act, cb: cb, cp: cp, ca: ca, baseTD: at(cb, TN), planTD: at(cp, TN), actTD: at(ca, TN) };
  }

  /* ---------- KPI tiles ---------- */
  function joinInView(r) { return (!F.a || r.area === F.a) && (!F.sl || r.subLocation === F.sl); }
  /* ---------- shared: plan bars, progress ring, status colour (as on the quantity page) ---------- */
  function band(a, p) {
    if (a == null || (!a && !p)) return "idle";
    var d = a - (p || 0);
    return d >= -0.05 ? "good" : d >= -5 ? "warn" : "bad";
  }
  var BAND_WORD = { good: "on or ahead of the baseline", warn: "up to 5 points behind", bad: "more than 5 points behind", idle: "not started" };
  function clampP(v) { return Math.max(0, Math.min(100, v || 0)); }
  function ring(pct, b) {
    var r = 40, c = 2 * Math.PI * r, v = clampP(pct);
    return '<svg class="pc-ring bc-' + b + '" viewBox="0 0 100 100" aria-hidden="true"><circle class="tr" cx="50" cy="50" r="' + r + '"/>' +
      (v ? '<circle class="vl" cx="50" cy="50" r="' + r + '" stroke-dasharray="' + (c * v / 100).toFixed(2) + " " + c.toFixed(2) + '" transform="rotate(-90 50 50)"/>' : "") + "</svg>";
  }
  function planBars(el, rows, opts) {
    var limit = opts.limit || rows.length, all = !!el._all, shown = all ? rows : rows.slice(0, limit);
    if (!rows.length) { el.innerHTML = '<div class="empty">No weighted task matches these filters.</div>'; return; }
    el.innerHTML = '<div class="bl">' + shown.map(function (r, i) {
      var b = band(r.a, r.p);
      return '<button type="button" class="bl-row' + (r.sel ? " is-sel" : "") + '" data-i="' + i + '" aria-label="' + esc(r.name + ": " + fmtP(r.a) + " earned against " + fmtP(r.p) + " on the baseline today, " + BAND_WORD[b]) + '">' +
        '<span class="bl-name"><b title="' + esc(r.name) + '">' + esc(r.name) + "</b><small>" + esc(r.sub || "") + "</small></span>" +
        '<span class="bl-track bc-' + b + '"><i class="bl-fill" style="width:' + clampP(r.a) + '%"></i><i class="bl-tick" style="left:' + clampP(r.p) + '%"></i></span>' +
        '<span class="bl-val"><b>' + fmtP(r.a) + "</b> vs " + fmtP(r.p) + '</span><span class="bl-chev" aria-hidden="true">&#8250;</span></button>';
    }).join("") + "</div>" +
      (rows.length > limit ? '<button type="button" class="btn bl-more">' + (all ? "Show the first " + limit : "Show all " + fmtI(rows.length)) + "</button>" : "") +
      (opts.legend ? '<div class="bl-legend"><span><i class="bc-good"></i>on or ahead of the baseline</span><span><i class="bc-warn"></i>up to 5 points behind</span><span><i class="bc-bad"></i>further behind</span><span><i class="bc-idle"></i>not started</span><span><i class="tk"></i>baseline today</span></div>' : "");
    el.querySelectorAll(".bl-row").forEach(function (b) { b.addEventListener("click", function () { opts.onRow(shown[+b.getAttribute("data-i")]); }); });
    var more = el.querySelector(".bl-more");
    if (more) more.addEventListener("click", function () { el._all = !all; planBars(el, rows, opts); });
  }
  function note(html, tone) { return '<div class="inote' + (tone ? " tone-" + tone : " is-tip") + '"><i class="i">i</i><span>' + html + "</span></div>"; }
  function spanText(a, b) {
    if (!a || !b) return "";
    var m = Math.round((dnum(b) - dnum(a)) / 30.44), y = Math.floor(m / 12), mo = m % 12;
    return (y ? y + " yr " : "") + (mo || !y ? mo + " mo" : "");
  }
  function minOf(R, k) { return R.reduce(function (m, t) { return t[k] && (!m || t[k] < m) ? t[k] : m; }, null); }
  function maxOf(R, k) { return R.reduce(function (m, t) { return t[k] && (!m || t[k] > m) ? t[k] : m; }, null); }
  /* earned and baseline-due weightage of a set of tasks, as % of their own weightage */
  function pctOf(rows) {
    var w = 0, bw = 0, pw = 0, aw = 0;
    rows.forEach(function (t) {
      if (!t.bs) return;
      w += t.w;
      if (t.bs <= TODAY) bw += t.br * (Math.min(dnum(t.be), TN) - dnum(t.bs) + 1);
      if (t.ps && t.ps <= TODAY) pw += t.pr * (Math.min(dnum(t.pe), TN) - dnum(t.ps) + 1);
      if (t.ax) aw += t.ar * (dnum(t.ax) - dnum(t.as) + 1);
    });
    return { w: w, b: w ? 100 * bw / w : null, p: w ? 100 * pw / w : null, a: w ? 100 * aw / w : null };
  }

  function renderKpis(R, S) {
    var W = S ? S.W : 0, b = S ? 100 * S.baseTD / W : null, pl = S ? 100 * S.planTD / W : null, a = S ? 100 * S.actTD / W : null;
    var bs = minOf(R, "bs"), be = maxOf(R, "be"), ps = minOf(R, "ps"), pe = maxOf(R, "pe");
    var slip = be && pe ? dnum(pe) - dnum(be) : null;
    /* summary strip */
    $("s-strip").innerHTML = [
      ["Baseline", "", bs ? fmtD(bs) + " &#8594; " + fmtD(be) : DASH, "Committed · " + spanText(bs, be)],
      ["Working plan", "", ps ? fmtD(ps) + " &#8594; " + fmtD(pe) : DASH, "Planned now · " + spanText(ps, pe) + (ps && bs ? (ps === bs ? " · starts on the baseline" : " · starts " + Math.abs(dnum(ps) - dnum(bs)) + " days " + (ps > bs ? "after" : "before") + " the baseline") : "")],
      ["Finish variance", "plan vs baseline", slip == null ? DASH : slip === 0 ? "No change" : '<span class="' + (slip > 0 ? "neg" : "pos") + '">' + spanText(slip > 0 ? be : pe, slip > 0 ? pe : be) + (slip > 0 ? " later" : " earlier") + "</span>",
        slip == null ? "" : slip === 0 ? "The working plan still finishes on the baseline date." : "The working plan finishes " + fmtI(Math.abs(slip)) + " days " + (slip > 0 ? "after" : "before") + " the baseline."],
    ].map(function (c) { return '<div><div class="st-l">' + c[0] + (c[1] ? "<span>" + c[1] + "</span>" : "") + '</div><div class="st-v">' + c[2] + '</div><div class="st-s">' + c[3] + "</div></div>"; }).join("");
    /* progress % */
    var pastDue = R.filter(function (t) { return t.be && t.be < TODAY && t.pc < 100; }).length;
    $("s-progress").innerHTML = S ? '<div class="pc-wrap">' + ring(a, band(a, b)) + '<div><div class="pc-big">' + fmtP(a) + '</div><div class="pc-sub">against <b>' + fmtP(b) +
      "</b> the baseline plans for today<br>" + '<span class="' + (a - b < -0.05 ? "neg" : "pos") + '">' + fmtPts(a - b).replace("pts", "points") + (a - b < -0.05 ? " behind" : a - b > 0.05 ? " ahead" : "") + "</span></div></div></div>" +
      note("Earned weightage (weightage × % complete) divided by all weightage in view.") +
      (pastDue ? note("<b>" + fmtI(pastDue) + "</b> weighted tasks are past their baseline finish and not complete.", "bad") : "")
      : '<div class="empty">No weighted task with baseline dates matches these filters.</div>';
    /* weighted tasks */
    var done = R.filter(function (t) { return t.pc >= 100; }).length, mid = R.filter(function (t) { return t.pc > 0 && t.pc < 100; }).length;
    var jt = J.rows.filter(joinInView), jb = jt.filter(function (r) { return r.match === "both"; }).length, jm = jt.filter(function (r) { return r.match !== "linked only"; }).length;
    var tiles = [
      ["Weighted tasks", fmtI(R.length), "", "with a weightage"],
      ["Completed", fmtI(done), "good", R.length ? fmtP(100 * done / R.length) + " of tasks" : DASH],
      ["In progress", fmtI(mid), "", "some % complete"],
      ["Not started", fmtI(R.length - done - mid), "ink", "0% complete"],
    ];
    $("s-kpis").innerHTML = '<div class="tgrp">' + tiles.map(function (t) {
      return '<div><div class="tl-l">' + t[0] + '</div><div class="tl-v ' + t[2] + '">' + t[1] + '</div><div class="tl-s">' + t[3] + "</div></div>";
    }).join("") + "</div>" +
      note("Total weightage in view: <b>" + fmtN(W) + "</b>. It comes from the master schedule's custom field and is added as it is, because it is already a project-wide share.") +
      (J.linked ? '<button type="button" class="callout" id="s-tojoin"><i class="i">i</i><span><b>' + fmtI(jb) + " of " + fmtI(jm) + "</b> master keys (area · sub-location · subtrade · LAP Plan) link to " + esc(J.project || "the quantity data") + ". See the link to execution.</span></button>" : "");
    if ($("s-tojoin")) $("s-tojoin").addEventListener("click", function () { $("h-join").scrollIntoView({ block: "start" }); });
    /* complete as of today */
    $("s-trio").innerHTML = '<div class="trio">' + [
      ["tc-base", "Baseline %", fmtP(b), "the committed baseline"],
      ["tc-plan", "Planned %", fmtP(pl), "the working plan in VisiLean"],
      ["tc-act", "Actual %", fmtP(a), "earned to date, from % complete"],
    ].map(function (c) { return '<div class="' + c[0] + '"><div class="tl-l">' + c[1] + '</div><div class="tl-v">' + c[2] + '</div><div class="tl-s">' + c[3] + "</div></div>"; }).join("") + "</div>" +
      note("Each task's weightage is spread evenly between its start and finish, so its share at today's date is interpolated.") +
      (slip ? note("The working plan finishes on <b>" + fmtD(pe) + "</b>, " + fmtI(Math.abs(slip)) + " days " + (slip > 0 ? "after" : "before") + " the baseline (" + fmtD(be) + "). Actual is " +
        '<b class="' + (a - pl < -0.05 ? "neg" : "pos") + '">' + fmtPts(a - pl) + "</b> against the working plan and " + '<b class="' + (a - b < -0.05 ? "neg" : "pos") + '">' + fmtPts(a - b) + "</b> against the baseline.") : "");
    $("s-inview").textContent = fmtI(R.length) + " weighted tasks in view";
    $("n-scurve").textContent = S ? fmtP(a) + " vs " + fmtP(b) : "";
    $("n-scurve").className = "n" + (S && a - b < -0.05 ? " bad" : "");
  }

  /* ---------- by area: plan bars that filter the page ---------- */
  function renderSplit(el, R, key, label) {
    var m = new Map();
    R.forEach(function (t) { if (!m.has(t[key])) m.set(t[key], []); m.get(t[key]).push(t); });
    var W = 0;
    m.forEach(function (rows) { rows.forEach(function (t) { if (t.bs) W += t.w; }); });
    var rows = Array.from(m.entries()).map(function (e) {
      var q = pctOf(e[1]);
      return { key: e[0], name: e[0], sub: fmtI(e[1].length) + " tasks · " + (W ? fmtP(100 * q.w / W) : DASH) + " of the weightage", a: q.a, p: q.b, w: q.w, sel: F[label] === e[0] };
    }).filter(function (r) { return r.w > 0; }).sort(function (x, y) { return y.w - x.w; });
    planBars(el, rows, { limit: 8, legend: true, onRow: function (r) { F[label] = F[label] === r.key ? "" : r.key; if (label === "a") F.sl = ""; render(); } });
  }

  /* ---------- S-curve chart ---------- */
  var mode = "cum", hoverIdx = null;
  function niceStep(max, ticks) {
    var raw = Math.max(max, 1e-9) / ticks, k = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map(function (m) { return m * k; }).find(function (m) { return m >= raw; });
  }
  function renderCurve(R, S) {
    var el = $("s-curve");
    if (!S) { el.innerHTML = '<div class="empty">No weighted task with baseline dates matches these filters.</div>'; $("s-stats").innerHTML = ""; return; }
    var pts = [], i, d;
    if (mode === "cum") {
      for (d = S.lo; d <= S.hi; d++) pts.push({ d0: d, d1: d, b: 100 * S.cb[d - S.lo] / S.W, p: 100 * S.cp[d - S.lo] / S.W, a: d <= TN ? 100 * S.ca[d - S.lo] / S.W : null });
    } else {
      var start = S.lo - ((new Date(S.lo * DAY).getUTCDay() + 6) % 7);
      for (d = start; d <= S.hi; d += 7) {
        var b = 0, pp = 0, a = 0;
        for (i = Math.max(d, S.lo); i <= Math.min(d + 6, S.hi); i++) { b += S.base[i - S.lo]; pp += S.plan[i - S.lo]; if (i <= TN) a += S.act[i - S.lo]; }
        pts.push({ d0: d, d1: d + 6, b: 100 * b / S.W, p: 100 * pp / S.W, a: d <= TN ? 100 * a / S.W : null });
      }
    }
    var W = Math.max(320, Math.round(el.clientWidth || 640)), H = W < 560 ? 270 : 360, L = 46, Rm = 56, Tm = 24, B = 30, iw = W - L - Rm, ih = H - Tm - B;
    var n = pts.length, ymax = 0;
    pts.forEach(function (p) { ymax = Math.max(ymax, p.b, p.p, p.a || 0); });
    var top = mode === "cum" ? 100 : (function () { var s = niceStep(ymax, 4); return Math.max(s * Math.ceil(ymax / s), s); })();
    var step = mode === "cum" ? 25 : niceStep(top, 4);
    function x(j) { return L + (n === 1 ? iw / 2 : j / (n - 1) * iw); }
    function y(v) { return Tm + ih - v / top * ih; }
    function path(key, upto) {
      var s = "";
      for (var j = 0; j <= upto; j++) if (pts[j][key] != null) s += (s ? "L" : "M") + x(j).toFixed(1) + " " + y(pts[j][key]).toFixed(1);
      return s;
    }
    var lastA = -1;
    pts.forEach(function (p, j) { if (p.a != null) lastA = j; });
    var g = "";
    for (var tv = 0; tv <= top + 1e-9; tv += step) g += '<line class="grid-l" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + y(tv) + '" y2="' + y(tv) + '"/><text x="' + (L - 6) + '" y="' + (y(tv) + 3.5) + '" text-anchor="end">' + fmtP(tv, mode === "cum" ? 0 : 2) + "</text>";
    var months = [];
    pts.forEach(function (p, j) { var iso = diso(p.d0); if (!months.length || months[months.length - 1].m !== iso.slice(0, 7)) months.push({ m: iso.slice(0, 7), j: j }); });
    var every = Math.max(1, Math.ceil(months.length / Math.max(3, Math.floor(iw / 70))));
    months.forEach(function (m, k) { if (k % every === 0) g += '<text x="' + x(m.j) + '" y="' + (H - 10) + '" text-anchor="middle">' + fmtM(m.m + "-01") + "</text>"; });
    g += '<line class="axis-l" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + (Tm + ih) + '" y2="' + (Tm + ih) + '"/>';
    var tj = pts.findIndex(function (p) { return TN >= p.d0 && TN <= p.d1; });
    if (tj >= 0) g += '<line class="today-l" x1="' + x(tj) + '" x2="' + x(tj) + '" y1="' + Tm + '" y2="' + (Tm + ih) + '"/><text x="' + (x(tj) + 4) + '" y="' + (Tm + 10) + '">Today</text>';
    /* monthly bars: weightage per calendar month, as % of the weightage in view, against the right-hand axis */
    var mon = [], mi = {};
    for (d = S.lo; d <= S.hi; d++) {
      var mk = diso(d).slice(0, 7);
      if (!(mk in mi)) { mi[mk] = mon.length; mon.push({ j0: d - S.lo, j1: d - S.lo, b: 0, a: 0 }); }
      var mo = mon[mi[mk]];
      mo.j1 = d - S.lo; mo.b += S.base[d - S.lo]; if (d <= TN) mo.a += S.act[d - S.lo];
    }
    var mmax = 0;
    mon.forEach(function (mo) { mo.b = 100 * mo.b / S.W; mo.a = 100 * mo.a / S.W; mmax = Math.max(mmax, mo.b, mo.a); });
    if (mode === "cum" && mmax > 0) {
      var rstep = niceStep(mmax, 3), rtop = Math.max(rstep * Math.ceil(mmax / rstep), rstep);
      var yr = function (v) { return Tm + ih - v / rtop * ih; };
      mon.forEach(function (mo) {
        var x0 = x(mo.j0), x1 = x(mo.j1), bw = Math.max(1, (x1 - x0) * 0.36);
        var cx = (x0 + x1) / 2;
        if (mo.b > 0) g += '<rect class="bar-b" x="' + (cx - bw).toFixed(1) + '" y="' + yr(mo.b).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (Tm + ih - yr(mo.b)).toFixed(1) + '"/>';
        if (mo.a > 0) g += '<rect class="bar-a" x="' + cx.toFixed(1) + '" y="' + yr(mo.a).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (Tm + ih - yr(mo.a)).toFixed(1) + '"/>';
      });
      for (var rv = 0; rv <= rtop + 1e-9; rv += rstep) g += '<text x="' + (W - Rm + 8) + '" y="' + (yr(rv) + 3.5) + '">' + fmtP(rv, rv < 1 ? 2 : 1) + "</text>";
      g += '<text x="' + (W - 4) + '" y="' + (Tm - 12) + '" text-anchor="end">per month</text>';
    }
    var ap = lastA >= 0 ? path("a", lastA) : "";
    if (ap && mode === "cum") g += '<path class="ar-act" d="' + ap + "L" + x(lastA).toFixed(1) + " " + y(0) + "L" + x(0).toFixed(1) + " " + y(0) + 'Z"/>';
    g += '<path class="ln-base" d="' + path("b", n - 1) + '"/><path class="ln-plan" d="' + path("p", n - 1) + '"/>';
    if (ap) g += '<path class="ln-act" d="' + ap + '"/>';
    if (lastA >= 0) {  // direct labels: the last actual point, and the baseline at the same date
      var pa = pts[lastA], near = mode === "cum" && Math.abs(y(pa.a) - y(pa.p)) < 24;  // keep the planned and actual labels apart
      g += '<circle class="mk" cx="' + x(lastA) + '" cy="' + y(pa.a) + '" r="5" fill="var(--brand)"/><text class="lbl" x="' + Math.min(x(lastA) + 8, W - Rm + 4) + '" y="' + (y(pa.a) + (near ? 18 : 4)) + '">' + fmtP(pa.a) + "</text>";
      if (mode === "cum") {
        g += '<circle class="mk" cx="' + x(lastA) + '" cy="' + y(pa.b) + '" r="4" fill="var(--s-draft)"/><text x="' + Math.min(x(lastA) + 8, W - Rm + 4) + '" y="' + (y(pa.b) + (pa.b >= pa.p ? -4 : 12)) + '">' + fmtP(pa.b) + "</text>";
        g += '<circle class="mk" cx="' + x(lastA) + '" cy="' + y(pa.p) + '" r="4" fill="var(--cat-2)"/><text class="lbl-plan" x="' + Math.min(x(lastA) + 8, W - Rm + 4) + '" y="' + (y(pa.p) + (near ? -10 : pa.p > pa.b ? -4 : 12)) + '">' + fmtP(pa.p) + "</text>";
      }
    }
    g += '<g class="hov"></g><rect x="' + L + '" y="' + Tm + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';
    var bb = 100 * S.baseTD / S.W, pp2 = 100 * S.planTD / S.W, aa = 100 * S.actTD / S.W;
    el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" tabindex="0" role="img" aria-label="' + (mode === "cum" ? "Cumulative" : "Weekly") + ' baseline, planned and actual weightage. Use the arrow keys to read values.">' + g + "</svg>";
    /* the figures sit above the chart */
    $("s-stats").innerHTML = stat(fmtP(bb), "Baseline to date") + stat(fmtP(pp2), "Planned to date") + stat(fmtP(aa), "Actual to date") +
      stat('<span class="' + (aa - bb < -0.05 ? "neg" : "pos") + '">' + fmtPts(aa - bb) + "</span>", "Actual − baseline") +
      stat('<span class="' + (aa - pp2 < -0.05 ? "neg" : "pos") + '">' + fmtPts(aa - pp2) + "</span>", "Actual − planned");
    function stat(v, l) { return '<div><div class="stat-v">' + v + '</div><div class="stat-l">' + esc(l) + "</div></div>"; }
    var svg = el.querySelector("svg"), hov = el.querySelector(".hov");
    function show(j) {
      j = Math.max(0, Math.min(n - 1, j)); hoverIdx = j;
      var p = pts[j];
      hov.innerHTML = '<line class="hover-l" x1="' + x(j) + '" x2="' + x(j) + '" y1="' + Tm + '" y2="' + (Tm + ih) + '"/><circle class="mk" cx="' + x(j) + '" cy="' + y(p.b) + '" r="4" fill="var(--s-draft)"/>' +
        '<circle class="mk" cx="' + x(j) + '" cy="' + y(p.p) + '" r="4" fill="var(--cat-2)"/>' +
        (p.a != null ? '<circle class="mk" cx="' + x(j) + '" cy="' + y(p.a) + '" r="4" fill="var(--brand)"/>' : "");
      var r = svg.getBoundingClientRect(), sx = r.width / W;
      showTip("<b>" + (mode === "cum" ? fmtD(diso(p.d0)) : "Week of " + fmtD(diso(p.d0))) + "</b><br>Baseline: " + fmtP(p.b, 2) + "<br>Planned: " + fmtP(p.p, 2) + "<br>Actual: " + (p.a == null ? DASH + " (after today)" : fmtP(p.a, 2)) +
        (p.a != null ? "<br>Actual − baseline: " + fmtPts(p.a - p.b) + "<br>Actual − planned: " + fmtPts(p.a - p.p) : ""), r.left + x(j) * sx, r.top + y(Math.max(p.b, p.a || 0)) * sx);
    }
    function hide() { hov.innerHTML = ""; hideTip(); }
    svg.addEventListener("pointermove", function (e) { var r = svg.getBoundingClientRect(); show(Math.round(((e.clientX - r.left) * W / r.width - L) / iw * (n - 1))); });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", function () { show(hoverIdx != null ? hoverIdx : Math.max(0, lastA)); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show((hoverIdx != null ? hoverIdx : lastA) + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? (mode === "cum" ? 30 : 4) : 1)); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(n - 1); }
      else if (e.key === "Escape") hide();
    });
  }

  /* ---------- table helper ---------- */
  function sortRows(rows, cols, sort) {
    var c = cols.find(function (x) { return x.k === sort.k; }), val = (c && c.sv) || function (r) { return r[sort.k]; };
    return rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      var d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === "asc" ? d : -d;
    });
  }
  function table(el, cols, rows, sort, opts) {
    el.innerHTML = '<div class="tbl-wrap"><table><thead><tr>' + cols.map(function (c) {
      var s = c.k === sort.k ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
      return '<th class="sortable' + (c.r ? " r" : "") + '" data-k="' + c.k + '" aria-sort="' + s + '" tabindex="0">' + esc(c.label) + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function (r, i) {
      return '<tr data-i="' + i + '"' + (opts.rowCls ? ' class="' + opts.rowCls(r) + '"' : "") + (opts.onRow ? ' tabindex="0"' : "") + ">" + cols.map(function (c) {
        return '<td class="' + (c.r ? "r " : "") + (c.cls || "") + '">' + (c.f ? c.f(r) : esc(r[c.k] == null ? DASH : r[c.k])) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</tbody>" + (opts.foot || "") + "</table></div>";
    el.querySelectorAll("th.sortable").forEach(function (th) {
      function go() { var k = th.getAttribute("data-k"); sort.dir = sort.k === k && sort.dir === "desc" ? "asc" : "desc"; sort.k = k; opts.rerender(); }
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    if (opts.onRow) el.querySelectorAll("tbody tr").forEach(function (tr) {
      function go() { opts.onRow(rows[+tr.getAttribute("data-i")]); }
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  function downloadCSV(name, cols, rows) {
    var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = "﻿" + cols.map(function (c) { return q(c.label); }).join(",") + "\n" + rows.map(function (r) { return cols.map(function (c) { return q(c.csv ? c.csv(r) : r[c.k]); }).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function vbar(act, base) {
    if (act == null) return '<span class="faint">' + DASH + "</span>";
    var c = function (v) { return Math.max(0, Math.min(100, v)); };
    return '<div class="vb"><div class="vb-track"><div class="vb-act" style="width:' + c(act) + '%"></div>' + (base != null ? '<div class="vb-base" style="left:' + c(base) + '%"></div>' : "") + "</div></div>";
  }
  function slug() { return (meta.key || "JUI") + "-scurve" + (F.a ? "-" + F.a : "") + (F.grp ? "-" + F.grp : ""); }

  /* ---------- join: master keys against this project's Table 2 ---------- */
  var joinSort = { k: "weightage", dir: "desc" }, joinMatch = "both", joinQ = "", joinRows = [];
  var JP = J.project || "Quantities";
  var MATCH = [["both", "Matched"], ["master only", "Master only"], ["linked only", JP + " only"], ["", "All"]];
  var PILL = { both: ["both", "Matched"], "master only": ["master", "Master only"], "linked only": ["linked", JP + " only"] };
  var JOIN_COLS = [
    { k: "match", label: "Match", f: function (r) { var p = PILL[r.match]; return '<span class="pill ' + p[0] + '">' + esc(p[1]) + "</span>"; } },
    { k: "area", label: "Area" }, { k: "subLocation", label: "Sub-location" }, { k: "subtrade", label: "Subtrade" },
    { k: "lapPlan", label: "LAP Plan", cls: "wrap" },
    { k: "masterTasks", label: "Master tasks", r: true, f: function (r) { return fmtI(r.masterTasks); } },
    { k: "weightage", label: "Weightage", r: true, f: function (r) { return fmtN(r.weightage); } },
    { k: "masterPctEarned", label: "Master % earned", r: true, f: function (r) { return fmtP(r.masterPctEarned); } },
    { k: "baselineStart", label: "Baseline start", f: function (r) { return fmtD(r.baselineStart); } },
    { k: "baselineEnd", label: "Baseline end", f: function (r) { return fmtD(r.baselineEnd); } },
    { k: "linkedActivities", label: JP + " activities", r: true, f: function (r) { return fmtI(r.linkedActivities); } },
    { k: "linkedPctComplete", label: JP + " % complete", r: true, f: function (r) { return fmtP(r.linkedPctComplete); } },
    { k: "linkedActualQty", label: "Actual / total qty", r: true, f: function (r) { return r.linkedActivities == null ? DASH : r.linkedUnit === "mixed" ? '<span class="faint" title="More than one unit: quantities do not add up">mixed units</span>' : fmtN(r.linkedActualQty) + " / " + fmtN(r.linkedTotalQty) + " " + esc(r.linkedUnit); },
      csv: function (r) { return r.linkedActualQty == null ? "" : r.linkedActualQty; } },
    { k: "linkedActualStart", label: "Actual start", f: function (r) { return fmtD(r.linkedActualStart || r.masterActualStart); } },
    { k: "linkedActualEnd", label: "Actual end", f: function (r) { return fmtD(r.linkedActualEnd || r.masterActualEnd); } },
  ];
  function renderJoin() {
    var inView = J.rows.filter(joinInView), q = joinQ.toLowerCase(), counts = { "": inView.length };
    inView.forEach(function (r) { counts[r.match] = (counts[r.match] || 0) + 1; });
    $("s-join-match").innerHTML = MATCH.map(function (m) { return '<button type="button" data-v="' + m[0] + '" aria-pressed="' + (joinMatch === m[0]) + '">' + esc(m[1]) + "<b>" + fmtI(counts[m[0]] || 0) + "</b></button>"; }).join("");
    $("s-join-match").querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { joinMatch = b.getAttribute("data-v"); renderJoin(); }); });
    $("s-join-desc").textContent = "Key: area · sub-location · subtrade · LAP Plan, both sides summed per key. " + fmtI(counts.both || 0) + " of " + fmtI((counts.both || 0) + (counts["master only"] || 0)) +
      " master keys found in " + JP + ". Area and sub-location filters apply here; group and phase filters do not";
    joinRows = inView.filter(function (r) { return (!joinMatch || r.match === joinMatch) && (!q || [r.subtrade, r.lapPlan, r.area, r.subLocation].join(" ").toLowerCase().indexOf(q) >= 0); });
    if (!joinRows.length) { $("s-join").innerHTML = '<div class="empty">No keys match this selection.</div>'; return; }
    table($("s-join"), JOIN_COLS, sortRows(joinRows, JOIN_COLS, joinSort), joinSort, { rerender: renderJoin });
  }
  $("s-join-q").addEventListener("input", function () { joinQ = this.value.trim(); renderJoin(); });
  $("s-csv-join").addEventListener("click", function () {
    var cols = JOIN_COLS.map(function (c) { return c.k === "linkedActualQty" ? { k: "linkedActualQty", label: "Actual qty" } : c; })
      .concat([{ k: "linkedTotalQty", label: "Total qty" }, { k: "linkedUnit", label: "Unit" }, { k: "joinKey", label: "Join key" }]);
    downloadCSV(slug() + "-join-lap-plan.csv", cols, sortRows(joinRows, JOIN_COLS, joinSort));
  });

  /* ---------- render ---------- */
  var current = [], curS = null;
  function render() {
    fillFilters();
    current = T.filter(matches);
    curS = series(current);
    renderKpis(current, curS);
    if (!$("pg-scurve").hidden) renderCurve(current, curS);
    renderSplit($("s-areas"), current, "a", "a");
    renderJoin();
    writeHash();
    window.JUIScurveFilter = { a: F.a, sl: F.sl };  // the 3D model on this page follows the area slicer
    document.dispatchEvent(new CustomEvent("jui:scurve-filter", { detail: window.JUIScurveFilter }));
  }
  var lastW = 0;
  window.addEventListener("resize", function () { var w = $("s-curve").clientWidth; if (w && Math.abs(w - lastW) > 40) { lastW = w; renderCurve(current, curS); } });
  render();
})();
