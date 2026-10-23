/* Workforce page: VisiLean's daily labour report (metrics.workforce). calculation.py matched each
   workforce activity guid to the task feed and emitted, per trade · category · shift, the planned
   and actual workers of every reporting day. This page only sums them for the chosen date range
   and filters. Average daily workforce = actual man-days in the range / reporting days in the
   range (days with any record in the feed), so trades, shifts and months add up to the total. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics && P.metrics.workforce, LOC = meta.locale || "en-IN", DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  if (!M || !$("tab-wf")) return;  // no workforce feed configured: the tab stays hidden
  $("tab-wf").hidden = false;

  /* ---------- formatting ---------- */
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 }), nf1 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 1 });
  function fmtI(v) { return v == null || !isFinite(v) ? DASH : nf0.format(v); }
  function fmtA(v) { return v == null || !isFinite(v) ? DASH : (Math.abs(v) >= 100 ? nf0 : nf1).format(v); }
  function fmtP(v) { return v == null || !isFinite(v) ? DASH : v.toFixed(1).replace(/\.0$/, "") + "%"; }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtD(iso, short) { if (!iso) return DASH; var p = iso.split("-"); return +p[2] + " " + MON[+p[1] - 1] + " " + (short ? p[0].slice(2) : p[0]); }
  function fmtM(ym) { var p = ym.split("-"); return MON[+p[1] - 1] + " " + p[0].slice(2); }
  var DAY = 864e5;
  function dnum(iso) { return Math.round(Date.parse(iso) / DAY); }
  function diso(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function note(html, tone) { return '<div class="inote' + (tone ? " tone-" + tone : " is-tip") + '"><i class="i">i</i><span>' + html + "</span></div>"; }

  /* ---------- tooltip (the shared #tip) ---------- */
  var tip = $("tip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + "px";
    tip.style.top = (y - h - 12 < 8 ? y + 16 : y - h - 12) + "px";
  }
  function hideTip() { tip.classList.remove("on"); }

  var src = M.source || {};
  if (M.unavailable) {
    $("w-filters").hidden = true;
    ["w-strip", "w-chart", "w-trades", "w-months", "w-matrix"].forEach(function (id) { $(id).innerHTML = '<div class="empty">The workforce feed could not be loaded on this refresh and there is no saved copy. The next refresh will try again.</div>'; });
    $("n-wf").textContent = "no data";
    return;
  }

  /* ---------- facts ---------- */
  var C = M.facts.combos, D = M.facts.days, PTS = M.facts.pts, TOT = M.totals;
  if (!D.length) {
    $("w-filters").hidden = true;
    ["w-strip", "w-chart", "w-trades", "w-months", "w-matrix"].forEach(function (id) { $(id).innerHTML = '<div class="empty">The workforce feed has no daily records yet.</div>'; });
    return;
  }
  var byDay = D.map(function () { return []; });
  PTS.forEach(function (p) { byDay[p[1]].push(p); });
  var comboTot = C.map(function () { return 0; });
  PTS.forEach(function (p) { comboTot[p[0]] += p[3]; });  // chips and the trade list skip what never had a worker
  function rankBy(i) {  // the values of combo field i, busiest first, leaving out what never has a worker
    var m = {};
    C.forEach(function (c, k) { m[c[i]] = (m[c[i]] || 0) + comboTot[k]; });
    return Object.keys(m).filter(function (v) { return m[v] > 0; }).sort(function (a, b) { return m[b] - m[a] || a.localeCompare(b); });
  }
  var TRADES = rankBy(0), CATS = rankBy(1);
  var SHIFTS = rankBy(2).sort(function (a, b) { var o = function (s) { return /day/i.test(s) ? 0 : /night/i.test(s) ? 1 : 2; }; return o(a) - o(b); });
  var SHIFT_CLS = {};
  SHIFTS.forEach(function (s) { SHIFT_CLS[s] = /day/i.test(s) ? "w-day" : /night/i.test(s) ? "w-night" : "w-gen"; });

  /* ---------- filters (hash keys beside the other pages') ---------- */
  var HK = { from: "wf", to: "wt", sh: "wsh", c: "wc", tr: "wtr" };
  var F = { from: "", to: "", sh: "", c: "", tr: "" };
  try {
    var hp = new URLSearchParams(location.hash.slice(1));
    Object.keys(HK).forEach(function (k) { if (hp.get(HK[k])) F[k] = hp.get(HK[k]); });
  } catch (e) { /* bad hash */ }
  function vals(k) { return F[k] ? F[k].split("|") : []; }
  function writeHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    Object.keys(HK).forEach(function (k) { if (F[k]) h.set(HK[k], F[k]); else h.delete(HK[k]); });
    try { history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname + location.search); } catch (e) { /* file:// */ }
  }
  var FIRST = D[0], LAST = D[D.length - 1];
  function clampIso(v, dflt) { return /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? (v < FIRST ? FIRST : v > LAST ? LAST : v) : dflt; }
  function range() {
    var lo = clampIso(F.from, FIRST), hi = clampIso(F.to, LAST);
    return lo <= hi ? [lo, hi] : [hi, lo];
  }
  /* quick ranges count back from the latest report */
  var PRESETS = [
    ["all", "All", function () { return ["", ""]; }],
    ["m", "Latest month", function () { return [LAST.slice(0, 8) + "01", ""]; }],
    ["30", "Last 30 days", function () { return [diso(dnum(LAST) - 29), ""]; }],
    ["7", "Last 7 days", function () { return [diso(dnum(LAST) - 6), ""]; }],
  ];
  function presetOn() {
    var r = range();
    var hit = PRESETS.find(function (p) { var v = p[2](); return clampIso(v[0], FIRST) === r[0] && clampIso(v[1], LAST) === r[1]; });
    return hit ? hit[0] : null;
  }
  function chips(boxId, k, items) {
    var on = vals(k);
    $(boxId).innerHTML = items.map(function (v) {
      return '<button type="button" class="fchip" data-v="' + esc(v) + '" aria-pressed="' + (on.indexOf(v) >= 0) + '">' + esc(v) + "</button>";
    }).join("");
  }
  [["w-shift", "sh"], ["w-cat", "c"]].forEach(function (b) {
    $(b[0]).addEventListener("click", function (e) {
      var c = e.target.closest(".fchip");
      if (!c) return;
      var v = c.getAttribute("data-v"), now = vals(b[1]), i = now.indexOf(v);
      if (i >= 0) now.splice(i, 1); else now.push(v);
      F[b[1]] = now.join("|");
      render(b[0], v);
    });
  });
  $("w-from").addEventListener("change", function () { F.from = this.value; render(); });
  $("w-to").addEventListener("change", function () { F.to = this.value; render(); });
  $("w-presets").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-r]");
    if (!b) return;
    var v = PRESETS.find(function (p) { return p[0] === b.getAttribute("data-r"); })[2]();
    F.from = v[0]; F.to = v[1];
    render("w-presets", b.getAttribute("data-r"));
  });
  $("w-reset").addEventListener("click", function () { Object.keys(F).forEach(function (k) { F[k] = ""; }); tradeOpen = false; render(); });

  /* trade: a dropdown of checkboxes (the shared .ms look); it is drawn once per opening, so ticking
     a box only refreshes the figures and the button */
  var tradeOpen = false;
  function tradeButton() {
    var on = vals("tr");
    var label = !on.length ? "All trades" : on.length === 1 ? on[0] : on[0] + " +" + (on.length - 1);
    var b = $("w-trade").querySelector(".ms-btn");
    b.classList.toggle("on", !!on.length);
    b.setAttribute("aria-expanded", String(tradeOpen));
    b.title = on.join(", ") || "All trades";
    b.querySelector(".ms-lbl").textContent = label;
    var cl = $("w-trade").querySelector('[data-act="none"]');
    if (cl) cl.disabled = !on.length;
  }
  function drawTrade() {
    var on = vals("tr");
    $("w-trade").innerHTML = '<button type="button" class="ms-btn" aria-haspopup="true" aria-expanded="false"><span class="ms-lbl"></span></button>' +
      '<div class="ms-pop"' + (tradeOpen ? "" : " hidden") + ' role="group" aria-label="Trades">' +
      '<div class="ms-acts"><button type="button" data-act="all">Select all</button><button type="button" data-act="none">Clear</button></div>' +
      '<input type="search" class="ms-find" placeholder="Search…" aria-label="Search trades">' +
      '<div class="ms-list">' + TRADES.map(function (t) {
        return '<label class="ms-opt"><input type="checkbox" value="' + esc(t) + '"' + (on.indexOf(t) >= 0 ? " checked" : "") + "><span>" + esc(t) + "</span><small></small></label>";
      }).join("") + "</div></div>";
    tradeButton();
  }
  drawTrade();
  $("w-trade").addEventListener("click", function (e) {
    if (e.target.closest(".ms-btn")) {
      tradeOpen = !tradeOpen;
      drawTrade(); counts();
      if (tradeOpen) $("w-trade").querySelector(".ms-find").focus();
      return;
    }
    var act = e.target.closest("[data-act]");
    if (act) {
      if (act.getAttribute("data-act") === "none") F.tr = "";
      else {
        var shown = Array.prototype.filter.call($("w-trade").querySelectorAll(".ms-opt"), function (o) { return !o.hidden; }).map(function (o) { return o.querySelector("input").value; });
        var now = vals("tr");
        shown.forEach(function (v) { if (now.indexOf(v) < 0) now.push(v); });
        F.tr = TRADES.filter(function (t) { return now.indexOf(t) >= 0; }).join("|");
      }
      $("w-trade").querySelectorAll(".ms-opt input").forEach(function (c) { c.checked = vals("tr").indexOf(c.value) >= 0; });
      render("keep");
    }
  });
  $("w-trade").addEventListener("change", function (e) {
    if (!e.target.matches(".ms-opt input")) return;
    var now = vals("tr").filter(function (v) { return v !== e.target.value; });
    if (e.target.checked) now.push(e.target.value);
    F.tr = TRADES.filter(function (t) { return now.indexOf(t) >= 0; }).join("|");
    render("keep");
  });
  $("w-trade").addEventListener("input", function (e) {
    if (!e.target.matches(".ms-find")) return;
    var q = e.target.value.toLowerCase();
    $("w-trade").querySelectorAll(".ms-opt").forEach(function (o) { o.hidden = q && o.querySelector("span").textContent.toLowerCase().indexOf(q) < 0; });
  });
  document.addEventListener("click", function (e) {
    if (tradeOpen && document.contains(e.target) && !e.target.closest("#w-trade")) { tradeOpen = false; drawTrade(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && tradeOpen) { tradeOpen = false; drawTrade(); $("w-trade").querySelector(".ms-btn").focus(); }
  });

  /* ---------- the sums for the range and filters ---------- */
  function comboFilter(skip) {
    var sh = vals("sh"), c = vals("c"), tr = skip === "tr" ? [] : vals("tr");
    return C.map(function (x) {
      return (!sh.length || sh.indexOf(x[2]) >= 0) && (!c.length || c.indexOf(x[1]) >= 0) && (!tr.length || tr.indexOf(x[0]) >= 0);
    });
  }
  function compute() {
    var r = range(), ok = comboFilter();
    var i0 = D.findIndex(function (d) { return d >= r[0]; }), i1 = -1;
    for (var i = D.length - 1; i >= 0; i--) if (D[i] <= r[1]) { i1 = i; break; }
    var S = { lo: r[0], hi: r[1], days: [], a: 0, p: 0, trades: {}, months: {}, monthOrder: [], tm: {} };
    if (i0 < 0 || i1 < i0) return S;
    for (i = i0; i <= i1; i++) {
      var day = { d: D[i], a: 0, p: 0, sh: {} }, mk = D[i].slice(0, 7), tday = {};
      if (!S.months[mk]) { S.months[mk] = { m: mk, n: 0, a: 0, p: 0, peak: 0, peakD: null }; S.monthOrder.push(mk); }
      var mo = S.months[mk];
      mo.n++;
      byDay[i].forEach(function (p) {
        if (!ok[p[0]]) return;
        var c = C[p[0]], t = c[0];
        day.a += p[3]; day.p += p[2];
        day.sh[c[2]] = (day.sh[c[2]] || 0) + p[3];
        var T = S.trades[t] || (S.trades[t] = { t: t, a: 0, p: 0, peak: 0, peakD: null, days: 0 });
        T.a += p[3]; T.p += p[2];
        tday[t] = (tday[t] || 0) + p[3];
        var key = t + "\u0001" + mk;
        S.tm[key] = (S.tm[key] || 0) + p[3];
      });
      Object.keys(tday).forEach(function (t) {
        var T = S.trades[t];
        if (tday[t] > T.peak) { T.peak = tday[t]; T.peakD = D[i]; }
        if (tday[t] > 0) T.days++;
      });
      mo.a += day.a; mo.p += day.p;
      if (day.a > mo.peak) { mo.peak = day.a; mo.peakD = D[i]; }
      S.a += day.a; S.p += day.p;
      S.days.push(day);
    }
    S.n = S.days.length;
    S.avg = S.n ? S.a / S.n : null;
    return S;
  }
  /* per trade, ignoring the trade filter itself: the counts in the trade list */
  function counts() {
    if (!tradeOpen) return;
    var r = range(), ok = comboFilter("tr"), n = {}, nd = 0;
    D.forEach(function (d, i) {
      if (d < r[0] || d > r[1]) return;
      nd++;
      byDay[i].forEach(function (p) { if (ok[p[0]]) n[C[p[0]][0]] = (n[C[p[0]][0]] || 0) + p[3]; });
    });
    $("w-trade").querySelectorAll(".ms-opt").forEach(function (o) {
      var v = o.querySelector("input").value;
      o.querySelector("small").textContent = nd ? fmtA((n[v] || 0) / nd) + "/day" : "";
    });
  }

  /* ---------- headline ---------- */
  function renderStrip(S) {
    if (!S.n) { $("w-strip").innerHTML = '<div><div class="empty">No reporting day falls in this date range.</div></div>'; return; }
    var last = S.days[S.n - 1], prev7 = S.days.slice(Math.max(0, S.n - 8), S.n - 1), avg7 = prev7.length ? prev7.reduce(function (s, d) { return s + d.a; }, 0) / prev7.length : null;
    var peak = S.days.reduce(function (b, d) { return d.a > b.a ? d : b; }, S.days[0]);
    var top = Object.keys(S.trades).map(function (k) { return S.trades[k]; }).sort(function (a, b) { return b.a - a.a; })[0];
    var active = Object.keys(S.trades).filter(function (k) { return S.trades[k].a > 0; }).length;
    var diff = avg7 == null ? null : last.a - avg7;
    var cells = [
      ["Running average", "per reporting day", fmtA(S.avg) + " <small>workers</small>", fmtI(S.a) + " man-days ÷ " + fmtI(S.n) + " reporting days · " + fmtD(S.lo, true) + " → " + fmtD(S.hi, true)],
      ["Latest report", fmtD(last.d), fmtI(last.a) + " <small>workers</small>", diff == null ? "the first report in this range" :
        '<span class="' + (diff >= 0 ? "pos" : "neg") + '">' + (diff >= 0 ? "+" : "−") + fmtA(Math.abs(diff)) + "</span> against the previous " + prev7.length + " reports' average (" + fmtA(avg7) + ")"],
      ["Peak day", WDAY[new Date(peak.d).getUTCDay()] + " " + fmtD(peak.d), fmtI(peak.a) + " <small>workers</small>", "the most workers on one day in this range"],
      ["Man-days", S.p > 0 ? "actual vs planned" : "actual", fmtI(S.a), S.p > 0 ? "planned " + fmtI(S.p) + " · actual is " + fmtP(100 * S.a / S.p) + " of planned (only some trades are planned)" : "no planned workforce in view"],
      ["Trades at work", "", fmtI(active), top && top.a > 0 ? "busiest: " + esc(top.t) + ", " + fmtA(top.a / S.n) + " a day" : ""],
    ];
    $("w-strip").innerHTML = cells.map(function (c) {
      return '<div><div class="st-l">' + c[0] + (c[1] ? "<span>" + c[1] + "</span>" : "") + '</div><div class="st-v">' + c[2] + '</div><div class="st-s">' + c[3] + "</div></div>";
    }).join("");
    $("n-wf").textContent = fmtA(S.avg) + "/day";
  }

  /* ---------- monthly chart ---------- */
  function niceStep(max, ticks) {
    var raw = Math.max(max, 1e-9) / ticks, k = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map(function (m) { return m * k; }).find(function (m) { return m >= raw; });
  }
  /* per calendar month in the range: average daily workforce (split by shift), peak day, and the
     running average from the start of the range to the month's last report */
  function monthSeries(S) {
    var out = [], idx = {}, cumA = 0, cumN = 0;
    S.days.forEach(function (d) {
      var mk = d.d.slice(0, 7);
      if (!(mk in idx)) { idx[mk] = out.length; out.push({ m: mk, n: 0, a: 0, p: 0, pn: 0, sh: {}, peak: 0, peakD: null }); }
      var o = out[idx[mk]];
      o.n++; o.a += d.a; o.p += d.p; if (d.p > 0) o.pn++;
      Object.keys(d.sh).forEach(function (s) { o.sh[s] = (o.sh[s] || 0) + d.sh[s]; });
      if (d.a > o.peak) { o.peak = d.a; o.peakD = d.d; }
    });
    out.forEach(function (o) {
      cumA += o.a; cumN += o.n;
      o.avg = o.n ? o.a / o.n : 0;
      o.run = cumN ? cumA / cumN : null;
      o.pavg = o.p > 0 ? o.p / o.n : null;
    });
    return out;
  }
  var hoverJ = null;
  function renderChart(S) {
    var el = $("w-chart");
    if (!S.n) { el.innerHTML = '<div class="empty">No reporting day falls in this date range.</div>'; $("w-stats").innerHTML = ""; return; }
    var ms = monthSeries(S), n = ms.length, hasPlan = S.p > 0;
    var W = Math.max(320, Math.round(el.clientWidth || 900)), H = W < 560 ? 260 : 330, L = 46, Rm = 14, Tm = 22, B = 28, iw = W - L - Rm, ih = H - Tm - B;
    var ymax = 0;
    ms.forEach(function (o) { ymax = Math.max(ymax, o.avg, o.peak, o.pavg || 0); });
    var step = niceStep(ymax, 4), top = Math.max(step * Math.ceil(ymax / step), step);
    var slot = iw / n, bw = Math.max(6, Math.min(64, slot * 0.56));
    function x(j) { return L + slot * (j + 0.5); }
    function y(v) { return Tm + ih - v / top * ih; }
    var g = "";
    for (var tv = 0; tv <= top + 1e-9; tv += step) g += '<line class="grid-l" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + y(tv) + '" y2="' + y(tv) + '"/><text x="' + (L - 6) + '" y="' + (y(tv) + 3.5) + '" text-anchor="end">' + fmtI(tv) + "</text>";
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 52))));
    ms.forEach(function (o, j) { if (j % every === 0) g += '<text x="' + x(j) + '" y="' + (H - 9) + '" text-anchor="middle">' + fmtM(o.m) + "</text>"; });
    g += '<line class="axis-l" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + (Tm + ih) + '" y2="' + (Tm + ih) + '"/>';
    /* bars: the month's average daily workforce, stacked by shift; a tick marks its peak day */
    ms.forEach(function (o, j) {
      var base = 0, cx = x(j);
      SHIFTS.forEach(function (s) {
        var v = (o.sh[s] || 0) / o.n;
        if (v <= 0) return;
        g += '<rect class="' + SHIFT_CLS[s] + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + y(base + v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(base) - y(base + v)).toFixed(1) + '"/>';
        base += v;
      });
      if (o.peak > 0) g += '<line class="w-peak" x1="' + (cx - bw / 2).toFixed(1) + '" x2="' + (cx + bw / 2).toFixed(1) + '" y1="' + y(o.peak).toFixed(1) + '" y2="' + y(o.peak).toFixed(1) + '"/>';
      if (bw >= 26 && y(0) - y(o.avg) > 22) g += '<text class="w-bl" x="' + cx + '" y="' + (y(0) - 8).toFixed(1) + '" text-anchor="middle">' + fmtI(o.avg) + "</text>";
    });
    function line(vs, cls) {
      var s = "", pen = false;
      vs.forEach(function (v, j) {
        if (v == null) { pen = false; return; }
        s += (pen ? "L" : "M") + x(j).toFixed(1) + " " + y(v).toFixed(1); pen = true;
      });
      return s ? '<path class="' + cls + '" d="' + s + '"/>' : "";
    }
    g += line(ms.map(function (o) { return o.run; }), "w-ln-run");
    ms.forEach(function (o, j) { g += '<circle class="mk" cx="' + x(j) + '" cy="' + y(o.run) + '" r="3.5" fill="var(--ink)"/>'; });
    /* planned: a marker per month that has any planned workers (only some trades are planned) */
    if (hasPlan) ms.forEach(function (o, j) {
      if (o.pavg == null) return;
      var py = y(o.pavg), cx = x(j);
      g += '<path class="w-plan-mk" d="M' + cx + " " + (py - 6) + "L" + (cx + 6) + " " + py + "L" + cx + " " + (py + 6) + "L" + (cx - 6) + " " + py + 'Z"/>';
    });
    var last = ms[n - 1];
    g += '<text class="lbl" x="' + Math.min(x(n - 1) + 8, W - Rm - 2) + '" y="' + (y(last.run) - 8) + '" text-anchor="' + (x(n - 1) + 60 > W - Rm ? "end" : "start") + '">avg ' + fmtA(last.run) + "</text>";
    g += '<g class="hov"></g><rect x="' + L + '" y="' + Tm + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';
    el.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" tabindex="0" role="img" aria-label="Average daily workforce per month by shift, with the running average. Use the arrow keys to read each month.">' + g + "</svg>";
    function stat(v, l) { return '<div><div class="stat-v">' + v + '</div><div class="stat-l">' + esc(l) + "</div></div>"; }
    $("w-stats").innerHTML = stat(fmtA(S.avg), "Running average") + stat(fmtA(last.avg), "Average in " + fmtM(last.m)) + stat(fmtI(S.a), "Actual man-days") +
      (hasPlan ? stat(fmtI(S.p), "Planned man-days") : "") + stat(fmtI(n), n === 1 ? "Month" : "Months") + stat(fmtI(S.n), "Reporting days");
    $("w-k-plan").hidden = !hasPlan;
    var svg = el.querySelector("svg"), hov = el.querySelector(".hov");
    function show(j, cx, cy) {
      j = Math.max(0, Math.min(n - 1, j)); hoverJ = j;
      var o = ms[j], xx = x(j);
      hov.innerHTML = '<rect class="w-hov" x="' + (xx - slot / 2).toFixed(1) + '" y="' + Tm + '" width="' + slot.toFixed(1) + '" height="' + ih + '"/>';
      var rows = SHIFTS.filter(function (s) { return o.sh[s]; }).map(function (s) { return '<div class="tip-row"><span><i class="tip-k ' + SHIFT_CLS[s] + '"></i>' + esc(s) + "</span><b>" + fmtA(o.sh[s] / o.n) + "</b></div>"; }).join("");
      var html = '<div class="tip-h">' + MON[+o.m.slice(5) - 1] + " " + o.m.slice(0, 4) + ' <span class="faint">· ' + fmtI(o.n) + " reporting days</span></div>" + rows +
        '<div class="tip-row tip-sum"><span>Average daily workforce</span><b>' + fmtA(o.avg) + "</b></div>" +
        '<div class="tip-row"><span>Peak day' + (o.peakD ? " (" + fmtD(o.peakD, true) + ")" : "") + "</span><b>" + fmtI(o.peak) + "</b></div>" +
        '<div class="tip-row"><span>Man-days</span><b>' + fmtI(o.a) + "</b></div>" +
        (o.pavg != null ? '<div class="tip-row"><span>Planned average</span><b>' + fmtA(o.pavg) + "</b></div>" : "") +
        '<div class="tip-row"><span>Running average to month end</span><b>' + fmtA(o.run) + "</b></div>";
      var box = svg.getBoundingClientRect();
      showTip(html, cx != null ? cx : box.left + xx / W * box.width, cy != null ? cy : box.top + y(o.avg) / H * box.height);
    }
    function nearest(evx) { var box = svg.getBoundingClientRect(), vx = (evx - box.left) / box.width * W; return Math.floor((vx - L) / slot); }
    svg.addEventListener("mousemove", function (e) { show(nearest(e.clientX), e.clientX, e.clientY); });
    svg.addEventListener("mouseleave", function () { hov.innerHTML = ""; hideTip(); hoverJ = null; });
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); show(hoverJ == null ? n - 1 : hoverJ + (e.key === "ArrowRight" ? 1 : -1)); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); show(e.key === "Home" ? 0 : n - 1); }
    });
    svg.addEventListener("blur", function () { hov.innerHTML = ""; hideTip(); hoverJ = null; });
  }

  /* ---------- tables ---------- */
  function sortable(el, cols, rows, sort, onRow, foot) {
    var sorted = rows.slice().sort(function (a, b) {
      var c = cols.find(function (c) { return c.k === sort.k; }), va = c.sv ? c.sv(a) : a[c.k], vb = c.sv ? c.sv(b) : b[c.k];
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      var d = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? d : -d;
    });
    el.innerHTML = '<div class="tbl-wrap"><table><thead><tr>' + cols.map(function (c) {
      return '<th class="sortable' + (c.r ? " r" : "") + '" data-k="' + c.k + '" tabindex="0" aria-sort="' + (sort.k === c.k ? (sort.dir === "asc" ? "ascending" : "descending") : "none") + '">' + c.label + "</th>";
    }).join("") + "</tr></thead><tbody>" + sorted.map(function (r, i) {
      return "<tr" + (onRow ? ' class="clickable' + (r._on ? " is-on" : "") + '" tabindex="0" data-i="' + i + '"' : "") + ">" + cols.map(function (c) { return '<td class="' + (c.r ? "r" : "") + (c.cls ? " " + c.cls : "") + '">' + c.f(r) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>" + (foot ? "<tfoot>" + foot + "</tfoot>" : "") + "</table></div>";
    el.querySelectorAll("th.sortable").forEach(function (th) {
      function go() { var k = th.getAttribute("data-k"); sort.dir = sort.k === k && sort.dir === "desc" ? "asc" : "desc"; sort.k = k; render("keep"); }
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    if (onRow) el.querySelectorAll("tbody tr[data-i]").forEach(function (tr) {
      function go() { onRow(sorted[+tr.getAttribute("data-i")]); }
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", function (e) { if (e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } });
    });
  }
  function mbar(v, max, cls) { return '<span class="w-bar"><i class="' + (cls || "") + '" style="width:' + (max > 0 ? Math.max(0, Math.min(100, 100 * v / max)) : 0).toFixed(1) + '%"></i></span>'; }

  var tSort = { k: "a", dir: "desc" }, tradeRows = [];
  function renderTrades(S) {
    var el = $("w-trades");
    var sel = vals("tr");
    tradeRows = Object.keys(S.trades).map(function (k) { var T = S.trades[k]; return { t: T.t, a: T.a, p: T.p, avg: S.n ? T.a / S.n : null, peak: T.peak, peakD: T.peakD, share: S.a ? 100 * T.a / S.a : null, vs: T.p > 0 ? 100 * T.a / T.p : null, _on: sel.indexOf(T.t) >= 0 }; })
      .filter(function (r) { return r.a > 0 || r.p > 0; });
    if (!tradeRows.length) { el.innerHTML = '<div class="empty">No workers recorded for these filters in this date range.</div>'; return; }
    var maxAvg = Math.max.apply(null, tradeRows.map(function (r) { return r.avg || 0; }));
    var cols = [
      { k: "t", label: "Trade", f: function (r) { return esc(r.t); }, cls: "wrap" },
      { k: "avg", label: "Average daily", r: true, f: function (r) { return mbar(r.avg, maxAvg) + "<b>" + fmtA(r.avg) + "</b>"; }, cls: "w-avgc" },
      { k: "a", label: "Man-days", r: true, f: function (r) { return fmtI(r.a); } },
      { k: "share", label: "Share", r: true, f: function (r) { return fmtP(r.share); } },
      { k: "peak", label: "Peak day", r: true, f: function (r) { return fmtI(r.peak) + (r.peakD ? '<small class="faint"> ' + fmtD(r.peakD, true) + "</small>" : ""); } },
      { k: "p", label: "Planned man-days", r: true, f: function (r) { return r.p > 0 ? fmtI(r.p) : '<span class="faint">' + DASH + "</span>"; } },
      { k: "vs", label: "Actual vs plan", r: true, f: function (r) { return r.vs == null ? '<span class="faint">' + DASH + "</span>" : '<span class="' + (r.vs >= 100 ? "pos" : "neg") + '">' + fmtP(r.vs) + "</span>"; } },
    ];
    var foot = '<tr><td>All trades in view</td><td class="r"><b>' + fmtA(S.avg) + '</b></td><td class="r">' + fmtI(S.a) + '</td><td class="r">100%</td><td class="r"></td><td class="r">' + (S.p > 0 ? fmtI(S.p) : DASH) + '</td><td class="r">' + (S.p > 0 ? fmtP(100 * S.a / S.p) : DASH) + "</td></tr>";
    sortable(el, cols, tradeRows, tSort, function (r) {
      var now = vals("tr"), i = now.indexOf(r.t);
      if (i >= 0) now.splice(i, 1); else now.push(r.t);
      F.tr = TRADES.filter(function (t) { return now.indexOf(t) >= 0; }).join("|");
      drawTrade();
      render("keep");
    }, foot);
  }

  function renderMonths(S) {
    var el = $("w-months");
    if (!S.monthOrder.length) { el.innerHTML = '<div class="empty">No reporting day falls in this date range.</div>'; return; }
    var rows = S.monthOrder.map(function (k) { return S.months[k]; });
    var maxAvg = Math.max.apply(null, rows.map(function (m) { return m.n ? m.a / m.n : 0; }));
    var r = range();
    el.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Month</th><th class="r">Average daily</th><th class="r">Peak</th><th class="r">Man-days</th><th class="r">Days</th></tr></thead><tbody>' +
      rows.map(function (m) {
        var part = (r[0] > m.m + "-01" && r[0].slice(0, 7) === m.m) || (r[1].slice(0, 7) === m.m && r[1] < LAST && r[1].slice(8) !== String(new Date(Date.UTC(+m.m.slice(0, 4), +m.m.slice(5), 0)).getUTCDate()));
        return "<tr><td>" + fmtM(m.m) + (part ? ' <small class="faint">part</small>' : "") + '</td><td class="r w-avgc">' + mbar(m.n ? m.a / m.n : 0, maxAvg) + "<b>" + fmtA(m.n ? m.a / m.n : null) + '</b></td><td class="r">' + fmtI(m.peak) + '</td><td class="r">' + fmtI(m.a) + '</td><td class="r">' + fmtI(m.n) + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr><td>Range</td><td class="r"><b>' + fmtA(S.avg) + '</b></td><td class="r">' + fmtI(Math.max.apply(null, rows.map(function (m) { return m.peak; }))) + '</td><td class="r">' + fmtI(S.a) + '</td><td class="r">' + fmtI(S.n) + "</td></tr></tfoot></table></div>";
  }

  var mxMode = "avg";
  function matrixData(S) {
    var trades = Object.keys(S.trades).filter(function (t) { return S.trades[t].a > 0; }).sort(function (a, b) { return S.trades[b].a - S.trades[a].a; });
    return { trades: trades, months: S.monthOrder, v: function (t, m) { var a = S.tm[t + "\u0001" + m] || 0, n = S.months[m].n; return mxMode === "avg" ? (n ? a / n : 0) : a; } };
  }
  function renderMatrix(S) {
    var el = $("w-matrix");
    $("w-mx-mode").innerHTML = [["avg", "Average daily"], ["md", "Man-days"]].map(function (o) { return '<button type="button" data-m="' + o[0] + '" aria-pressed="' + (mxMode === o[0]) + '">' + o[1] + "</button>"; }).join("");
    var X = matrixData(S);
    if (!X.trades.length) { el.innerHTML = '<div class="empty">No workers recorded for these filters in this date range.</div>'; return; }
    var max = 0;
    X.trades.forEach(function (t) { X.months.forEach(function (m) { max = Math.max(max, X.v(t, m)); }); });
    var fmt = mxMode === "avg" ? fmtA : fmtI;
    var h = '<div class="tbl-wrap w-mx"><table><thead><tr><th>Trade</th>' + X.months.map(function (m) { return '<th class="r">' + fmtM(m) + "</th>"; }).join("") + '<th class="r">Range</th></tr></thead><tbody>';
    h += X.trades.map(function (t) {
      return "<tr><td>" + esc(t) + "</td>" + X.months.map(function (m) {
        var v = X.v(t, m), k = max > 0 ? v / max : 0;
        return '<td class="r w-cell" style="--h:' + (k * 100).toFixed(0) + '%">' + (v > 0 ? fmt(v) : '<span class="faint">' + DASH + "</span>") + "</td>";
      }).join("") + '<td class="r"><b>' + fmt(mxMode === "avg" ? S.trades[t].a / S.n : S.trades[t].a) + "</b></td></tr>";
    }).join("");
    h += '</tbody><tfoot><tr><td>All trades in view</td>' + X.months.map(function (m) { var mo = S.months[m]; return '<td class="r">' + fmt(mxMode === "avg" ? (mo.n ? mo.a / mo.n : 0) : mo.a) + "</td>"; }).join("") + '<td class="r"><b>' + fmt(mxMode === "avg" ? S.avg : S.a) + "</b></td></tr></tfoot></table></div>";
    el.innerHTML = h;
  }
  $("w-mx-mode").addEventListener("click", function (e) { var b = e.target.closest("button[data-m]"); if (b) { mxMode = b.getAttribute("data-m"); render("keep"); } });

  function csv(name, head, rows) {
    var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function rangeTag() { var r = range(); return r[0] + "_" + r[1]; }
  $("w-csv-trades").addEventListener("click", function () {
    var S = current;
    csv((meta.key || "JUI") + "-workforce-trades-" + rangeTag() + ".csv", ["Trade", "Average daily workforce", "Actual man-days", "Share %", "Peak day workers", "Peak day", "Planned man-days", "Actual / planned %", "Reporting days"],
      tradeRows.slice().sort(function (a, b) { return b.a - a.a; }).map(function (r) { return [r.t, r.avg == null ? "" : r.avg.toFixed(2), r.a, r.share == null ? "" : r.share.toFixed(2), r.peak, r.peakD || "", r.p || "", r.vs == null ? "" : r.vs.toFixed(2), S.n]; }));
  });
  $("w-csv-matrix").addEventListener("click", function () {
    var S = current, X = matrixData(S);
    csv((meta.key || "JUI") + "-workforce-trade-month-" + (mxMode === "avg" ? "average" : "man-days") + "-" + rangeTag() + ".csv", ["Trade"].concat(X.months.map(fmtM)).concat(["Range"]),
      X.trades.map(function (t) { return [t].concat(X.months.map(function (m) { return +X.v(t, m).toFixed(2); })).concat([+(mxMode === "avg" ? S.trades[t].a / S.n : S.trades[t].a).toFixed(2)]); }));
  });

  /* ---------- render ---------- */
  var current = null;
  function render(focusBox, focusVal) {
    var r = range();
    $("w-from").value = r[0]; $("w-to").value = r[1];
    $("w-from").min = $("w-to").min = FIRST; $("w-from").max = $("w-to").max = LAST;
    $("w-from").classList.toggle("on", !!F.from); $("w-to").classList.toggle("on", !!F.to);
    var pon = presetOn();
    $("w-presets").innerHTML = PRESETS.map(function (p) { return '<button type="button" data-r="' + p[0] + '" aria-pressed="' + (pon === p[0]) + '">' + p[1] + "</button>"; }).join("");
    chips("w-shift", "sh", SHIFTS);
    chips("w-cat", "c", CATS);
    if (focusBox && $(focusBox) && focusVal != null) {
      var fb = $(focusBox).querySelector('[data-v="' + focusVal.replace(/"/g, '\\"') + '"], [data-r="' + focusVal + '"]');
      if (fb) fb.focus();
    }
    tradeButton();
    if (tradeOpen) $("w-trade").querySelectorAll(".ms-opt input").forEach(function (c) { c.checked = vals("tr").indexOf(c.value) >= 0; });
    counts();
    $("w-reset").disabled = !Object.keys(F).some(function (k) { return F[k]; });
    var S = current = compute();
    var parts = [];
    if (vals("sh").length) parts.push(vals("sh").join(", "));
    if (vals("c").length) parts.push(vals("c").join(", "));
    if (vals("tr").length) parts.push(vals("tr").join(", "));
    $("w-hint").innerHTML = "<span><b>" + esc(src.title || "Daily labour report") + "</b> · " + fmtI(S.n || 0) + " reporting days from " + fmtD(r[0]) + " to " + fmtD(r[1]) + (parts.length ? " · " + esc(parts.join(" · ")) : "") + "</span>" +
      "<span>" + fmtI(TOT.matched) + " of " + fmtI(TOT.activities) + " workforce activities matched to the task feed by guid" + (TOT.unmatched ? " (the other " + fmtI(TOT.unmatched) + " have " + (TOT.unmatchedActual ? fmtI(TOT.unmatchedActual) + " man-days" : "no workers recorded") + ")" : "") + "</span>";
    renderStrip(S);
    if (!$("pg-wf").hidden) renderChart(S);
    renderTrades(S);
    renderMonths(S);
    renderMatrix(S);
    writeHash();
  }
  document.addEventListener("jui:page", function (e) { if (e.detail === "wf") renderChart(current); });
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (!$("pg-wf").hidden) renderChart(current); }, 150); });
  render();
})();
