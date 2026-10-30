/* JUI project page. Reads the embedded payload, applies the filters, and sums what
   calculation.py emitted: task quantities, and each task's daily planned (pr) and actual (ar)
   rate over its window. Summing the rates reproduces Tables 3 and 4 for any filter; nothing
   here re-derives a rule from calculation.py. */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var meta = P.meta || {}, M = P.metrics, LOC = meta.locale || "en-IN";
  var root = document.documentElement;
  var DASH = "—";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- formatting ---------- */
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 2 });
  function tidy(v) { return Math.abs(v) < 0.005 ? 0 : v; } // float residue from summed daily rates
  function fmtN(v) { return v == null || !isFinite(v) ? DASH : (Math.abs(v) >= 1000 ? nf0 : nf2).format(tidy(v)); }
  function fmtI(v) { return v == null ? DASH : nf0.format(v); }
  function fmtP(v) { return v == null || !isFinite(v) ? DASH : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%"; }
  function fmtSigned(v) { v = v == null ? v : tidy(v); return v == null || !isFinite(v) ? DASH : (v > 0 ? "+" : v < 0 ? "−" : "") + fmtN(Math.abs(v)); }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtD(iso, short) {
    if (!iso) return DASH;
    var p = iso.slice(0, 10).split("-");
    return +p[2] + " " + MON[+p[1] - 1] + " " + (short ? p[0].slice(2) : p[0]);
  }
  var DAY = 864e5;
  function dnum(iso) { return Math.round(Date.parse(iso.slice(0, 10)) / DAY); }
  function diso(n) { return new Date(n * DAY).toISOString().slice(0, 10); }

  /* ---------- theme & chrome ---------- */
  function setTheme(t) {
    root.setAttribute("data-theme", t);
    $("theme-txt").textContent = t === "dark" ? "Light" : "Dark";
    try { localStorage.setItem("jui-theme", t); } catch (e) { /* storage unavailable */ }
  }
  var savedTheme = "light";
  try { savedTheme = localStorage.getItem("jui-theme") || "light"; } catch (e) { /* storage unavailable */ }
  setTheme(savedTheme);
  $("theme").addEventListener("click", function () { setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark"); });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { root.style.setProperty("--appbar-h", $("appbar").offsetHeight + "px"); }).observe($("appbar"));
  }
  var when = meta.dataAsOf || meta.generatedAt;
  $("asof").textContent = (meta.origin === "sample" ? "Sample export · " : "Data as of ") + (when ? fmtD(when) + ", " + when.slice(11, 16) + " IST" : DASH);
  (function banner() {
    var b = $("banner"), msg = null, tone = "warn";
    var ageH = when ? (Date.now() - Date.parse(when)) / 36e5 : 0;
    if (meta.state === "unavailable") { msg = "No data yet for this project: VisiLean could not be reached and there is no saved copy. The next refresh will try again."; tone = "bad"; }
    else if (meta.state === "stale") msg = "VisiLean could not be reached on the last refresh. You are looking at the copy fetched on " + fmtD(when) + ".";
    else if (ageH > (meta.staleAfterHours || 20)) msg = "This page was last refreshed " + Math.round(ageH) + " hours ago. Numbers may be out of date.";
    if (msg) b.innerHTML = '<span class="banner tone-' + tone + '" role="status">&#9888; ' + esc(msg) + "</span>";
  })();
  var facts = ((P.project && P.project.facts) || []).filter(function (f) { return f.label !== "Project" && f.value != null && f.value !== ""; });
  /* status as a pill beside the title; the other figures as label-over-value items */
  var status = facts.find(function (f) { return f.label === "Status"; });
  if (status) {
    var st = $("mast-status"), sv = String(status.value);
    st.textContent = sv; st.hidden = false;
    st.className = "mast-status" + (/complete|done|closed/i.test(sv) ? " is-done" : /not started|planned|idle/i.test(sv) ? " is-idle" : "");
  }
  function fact(l, v) { return "<div><dt>" + esc(l) + "</dt><dd>" + v + "</dd></div>"; }
  $("facts").innerHTML = (when ? fact("Progress as of", fmtD(when)) : "") +
    (M ? fact("Activities", fmtI(M.totals.tasks)) + fact("Subtrades", fmtI(M.totals.subtrades)) + fact("Areas", fmtI(M.totals.areas)) : "") +
    facts.filter(function (f) { return f !== status; }).map(function (f) { return fact(f.label, esc(f.value)); }).join("") +
    (M ? fact("Today", fmtD(M.today)) : "");
  $("dl").innerHTML = (meta.tables || []).length ? "Download: " + meta.tables.map(function (t) {
    var label = { "table2_tasks.csv": "Table 2 tasks", "table3_planned_daily.csv": "Table 3 planned per day", "table4_actual_daily.csv": "Table 4 actual per day",
      "master_tasks.csv": "S-curve master", "baseline_daily.csv": "S-curve baseline per day", "planned_daily.csv": "S-curve planned per day", "actual_daily.csv": "S-curve actual per day", "join_lap_plan.csv": "S-curve join on LAP Plan" }[t] || t;
    return '<a href="tables/' + encodeURIComponent(t) + '" download>' + esc(label) + "</a>";
  }).join(" · ") : "";

  /* ---------- tooltip (hover and focus) ---------- */
  var tip = $("tip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.classList.add("on");
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + "px";
    tip.style.top = (y - h - 12 < 8 ? y + 16 : y - h - 12) + "px";
  }
  function hideTip() { tip.classList.remove("on"); }
  /* an info icon's tooltip: the card's description, then any explanatory notes in the card, read
     when shown so text the page updates (units, counts) is always current */
  function infoHtml(el) {
    var box = el.closest(".card, .pk") || document, parts = [];
    var d = box.querySelector(".desc");
    if (d && d.textContent.trim()) parts.push(d.innerHTML);
    box.querySelectorAll(".inote.is-tip > span").forEach(function (n) { parts.push(n.innerHTML); });
    return parts.map(function (h) { return "<p>" + h + "</p>"; }).join("");
  }
  function tipFor(el) {
    var r = el.getBoundingClientRect(), info = el.hasAttribute("data-info");
    tip.classList.toggle("tip-info", info);
    showTip(info ? infoHtml(el) : el.getAttribute("data-tip"), r.left + r.width / 2, r.top);
  }
  document.addEventListener("mouseover", function (e) { var el = e.target.closest && e.target.closest("[data-tip],[data-info]"); if (el) tipFor(el); });
  document.addEventListener("mouseout", function (e) { if (e.target.closest && e.target.closest("[data-tip],[data-info]")) hideTip(); });
  document.addEventListener("focusin", function (e) { if (e.target.hasAttribute && (e.target.hasAttribute("data-tip") || e.target.hasAttribute("data-info"))) tipFor(e.target); });
  document.querySelectorAll(".card-head h2, .pk-head h2").forEach(function (h) {
    var head = h.parentNode, d = head.querySelector(".desc");
    if (!d && !head.closest(".card")) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "info-i"; b.setAttribute("data-info", "");
    b.setAttribute("aria-label", "About " + h.textContent.trim());
    b.textContent = "i";
    h.appendChild(b);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideTip(); });

  var EMPTY_ALL = '<div class="empty">No data yet for this project.</div>';
  if (!M) {
    ["subtrade", "locations", "progress"].forEach(function (id) { $(id).innerHTML = EMPTY_ALL; });
    $("filters").hidden = true;
    return;
  }

  var T = M.facts.tasks, TODAY = M.today, TODAY_N = dnum(TODAY);
  var STATUS = { complete: "Complete", started: "Started", notStarted: "Not started" };

  /* ---------- filters ---------- */
  var F = { a: "", sl: "", st: "", u: "", s: "", pc: "", q: "" };
  /* % complete bands: "lo-hi" on VisiLean's percentComplete; a range ending at 100 has no upper limit */
  var PC_BANDS = [["0-0", "0%"], ["1-25", "1–25%"], ["26-50", "26–50%"], ["51-75", "51–75%"], ["76-99", "76–99%"], ["100-100", "100%"]];
  function pcRange(v) {
    var m = /^(\d+)-(\d+)$/.exec(v || "");
    if (!m) return null;
    var lo = Math.min(100, +m[1]), hi = Math.min(100, +m[2]);
    return lo <= hi ? [lo, hi] : [hi, lo];
  }
  function pcIn(t, r) { return t.pc >= r[0] && (r[1] >= 100 || t.pc <= r[1]); }
  function pcLabel(v) {
    var r = pcRange(v);
    if (!r) return "";
    return r[0] === r[1] ? r[0] + "% complete" : r[1] >= 100 ? r[0] + "% complete or more" : r[0] + "–" + r[1] + "% complete";
  }
  var SEL = { a: "f-area", u: "f-unit", s: "f-status", q: "f-q" };
  /* sub-location, subtrade and % complete take several values: kept "|"-joined in F and in the URL */
  var MULTI = { sl: "f-sub", st: "f-subtrade", pc: "f-pc" };
  function vals(k) { return F[k] ? F[k].split("|") : []; }
  function pcLabelShort(v) {
    var r = pcRange(v);
    return !r ? v : r[0] === r[1] ? r[0] + "%" : r[1] >= 100 ? r[0] + "%+" : r[0] + "–" + r[1] + "%";
  }
  try {
    var hp = new URLSearchParams(location.hash.slice(1));
    Object.keys(F).forEach(function (k) { if (hp.get(k)) F[k] = hp.get(k); });
  } catch (e) { /* bad hash: start unfiltered */ }

  function countBy(rows, key) {
    var m = new Map();
    rows.forEach(function (r) { m.set(r[key], (m.get(r[key]) || 0) + 1); });
    return m;
  }
  function options(id, entries, allLabel, value) {
    var el = $(id);
    el.innerHTML = '<option value="">' + esc(allLabel) + "</option>" + entries.map(function (e) {
      return '<option value="' + esc(e[0]) + '"' + (e[0] === value ? " selected" : "") + ">" + esc(e[1]) + "</option>";
    }).join("");
    el.value = value;
  }
  function byCountDesc(m) { return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); }); }
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
  /* A dropdown of checkboxes. items: [[value, label, count]]. Re-rendered on every change, so the open
     list, its search text and the focused box are carried over. */
  var msOpen = null, msFind = {}, msFocus = null;
  function multiSelect(k, items, allLabel, extra) {
    var box = $(MULTI[k]), on = vals(k), set = {};
    on.forEach(function (v) { set[v] = true; });
    var names = {};
    items.forEach(function (it) { names[it[0]] = it[1]; });
    var label = !on.length ? allLabel : on.length === 1 ? (names[on[0]] || on[0]) : (names[on[0]] || on[0]) + " +" + (on.length - 1);
    var q = (msFind[k] || "").toLowerCase(), open = msOpen === k;
    var shown = items.filter(function (it) { return !q || String(it[1]).toLowerCase().indexOf(q) >= 0; });
    box.innerHTML = '<button type="button" class="ms-btn' + (on.length ? " on" : "") + '" aria-haspopup="true" aria-expanded="' + open + '" title="' + esc(on.map(function (v) { return names[v] || v; }).join(", ") || allLabel) + '">' +
      '<span class="ms-lbl">' + esc(label) + "</span></button>" +
      '<div class="ms-pop"' + (open ? "" : " hidden") + ' role="group" aria-label="' + esc(allLabel) + '">' +
      '<div class="ms-acts"><button type="button" data-act="all">Select all' + (q ? " shown" : "") + '</button><button type="button" data-act="none"' + (on.length ? "" : " disabled") + ">Clear</button></div>" +
      (items.length > 8 ? '<input type="search" class="ms-find" placeholder="Search…" aria-label="Search ' + esc(allLabel.toLowerCase()) + '" value="' + esc(msFind[k] || "") + '">' : "") +
      '<div class="ms-list">' + (shown.length ? shown.map(function (it) {
        return '<label class="ms-opt"><input type="checkbox" value="' + esc(it[0]) + '"' + (set[it[0]] ? " checked" : "") + "><span>" + esc(it[1]) + "</span>" + (it[2] != null ? "<small>" + fmtI(it[2]) + "</small>" : "") + "</label>";
      }).join("") : '<div class="ms-none">No matches</div>') + "</div>" + (extra || "") + "</div>";
    var btn = box.querySelector(".ms-btn"), pop = box.querySelector(".ms-pop");
    btn.addEventListener("click", function () { msOpen = msOpen === k ? null : k; msFocus = null; render(); var f = $(MULTI[k]).querySelector(".ms-find, .ms-opt input"); if (msOpen && f) f.focus(); else if (!msOpen) $(MULTI[k]).querySelector(".ms-btn").focus(); });
    function set_(list) {
      var a = document.activeElement;
      msFocus = a && box.contains(a) ? (a.type === "checkbox" ? "cb:" + a.value : a.getAttribute("data-act") ? "act:" + a.getAttribute("data-act") : a.classList[0] || null) : msFocus;
      setFilter(k, list.join("|"));
    }
    pop.querySelectorAll(".ms-opt input").forEach(function (c) {
      c.addEventListener("change", function () {
        var now = vals(k).filter(function (v) { return v !== c.value; });
        if (c.checked) now.push(c.value);
        set_(items.map(function (it) { return it[0]; }).filter(function (v) { return now.indexOf(v) >= 0; }).concat(now.filter(function (v) { return !names.hasOwnProperty(v); })));
      });
    });
    pop.querySelector('[data-act="all"]').addEventListener("click", function () {
      var now = vals(k);
      shown.forEach(function (it) { if (now.indexOf(it[0]) < 0) now.push(it[0]); });
      set_(items.map(function (it) { return it[0]; }).filter(function (v) { return now.indexOf(v) >= 0; }).concat(now.filter(function (v) { return !names.hasOwnProperty(v); })));
    });
    pop.querySelector('[data-act="none"]').addEventListener("click", function () { set_([]); });
    var find = pop.querySelector(".ms-find");
    if (find) find.addEventListener("input", function () { msFind[k] = find.value; msFocus = "ms-find"; render(); });
    if (open && msFocus) {
      var el = msFocus.indexOf("cb:") === 0 ? Array.prototype.find.call(pop.querySelectorAll(".ms-opt input"), function (c) { return c.value === msFocus.slice(3); })
        : msFocus.indexOf("act:") === 0 ? pop.querySelector('[data-act="' + msFocus.slice(4) + '"]') : box.querySelector("." + msFocus);
      if (el && !el.disabled) { el.focus(); if (el.type === "search") el.setSelectionRange(el.value.length, el.value.length); }
      msFocus = null;
    }
  }
  document.addEventListener("click", function (e) {
    if (msOpen && document.contains(e.target) && !e.target.closest(".ms")) { msOpen = null; render(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && msOpen) { var k = msOpen; msOpen = null; render(); $(MULTI[k]).querySelector(".ms-btn").focus(); }
  });
  function fillFilters() {
    options("f-area", byCountDesc(countBy(T, "a")).map(function (e) { return [e[0], e[0] + " (" + e[1] + ")"]; }), "All areas", F.a);
    chipSlicer("f-area", "f-area-chips");
    var subs = byCountDesc(countBy(F.a ? T.filter(function (t) { return t.a === F.a; }) : T, "sl"));
    F.sl = vals("sl").filter(function (v) { return subs.some(function (e) { return e[0] === v; }); }).join("|");
    multiSelect("sl", subs.map(function (e) { return [e[0], e[0], e[1]]; }), F.a ? "All in " + F.a : "All sub-locations");
    multiSelect("st", Array.from(countBy(T, "st").entries()).sort(function (a, b) { return a[0].localeCompare(b[0]); }).map(function (e) { return [e[0], e[0], e[1]]; }), "All subtrades");
    options("f-unit", byCountDesc(countBy(T, "u")).map(function (e) { return [e[0], e[0] + " (" + e[1] + ")"]; }), "All units", F.u);
    options("f-status", [["complete", "Complete"], ["started", "Started"], ["notStarted", "Not started"], ["overdue", "Overdue"]], "All statuses", F.s);
    F.pc = vals("pc").filter(pcRange).join("|");
    var pcItems = PC_BANDS.map(function (b) { var r = pcRange(b[0]); return [b[0], b[1], T.filter(function (t) { return pcIn(t, r); }).length]; });
    vals("pc").forEach(function (v) {  // custom ranges join the list as their own boxes
      if (!PC_BANDS.some(function (b) { return b[0] === v; })) { var r = pcRange(v); pcItems.push([v, pcLabelShort(v) + " (custom)", T.filter(function (t) { return pcIn(t, r); }).length]); }
    });
    multiSelect("pc", pcItems, "Any % complete",
      '<div class="ms-range"><span>Custom range</span><input id="f-pc-lo" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="From %" aria-label="From % complete"><input id="f-pc-hi" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="To %" aria-label="To % complete"><button type="button" id="f-pc-add">Add</button></div>');
    $("f-pc-add").addEventListener("click", applyCustomPc);
    ["f-pc-lo", "f-pc-hi"].forEach(function (id) { $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyCustomPc(); } }); });
    $("f-q").value = F.q;
    Object.keys(SEL).forEach(function (k) { $(SEL[k]).classList.toggle("on", !!F[k]); });
    var active = Object.keys(F).some(function (k) { return F[k]; });
    $("reset").disabled = !active;
  }
  var pcR = [], slSet = null, stSet = null;
  function asSet(k) { if (!F[k]) return null; var o = {}; vals(k).forEach(function (v) { o[v] = true; }); return o; }
  function matches(t) {
    if (F.a && t.a !== F.a) return false;
    if (slSet && !slSet[t.sl]) return false;
    if (stSet && !stSet[t.st]) return false;
    if (F.u && t.u !== F.u) return false;
    if (F.s === "overdue" ? !t.od : (F.s && t.g !== F.s)) return false;
    if (pcR.length && !pcR.some(function (r) { return pcIn(t, r); })) return false;
    if (F.q) {
      var q = F.q.toLowerCase();
      if (String(t.n || "").toLowerCase().indexOf(q) < 0 && String(t.id || "").toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function setFilter(k, v) {
    F[k] = v;
    if (k === "a") F.sl = "";
    render();
  }
  Object.keys(SEL).forEach(function (k) {
    var el = $(SEL[k]);
    el.addEventListener(k === "q" ? "input" : "change", function () { setFilter(k, el.value.trim()); });
  });
  function applyCustomPc() {
    var lo = $("f-pc-lo").value, hi = $("f-pc-hi").value;
    if (lo === "" && hi === "") return;
    var r = pcRange(Math.max(0, Math.round(+lo || 0)) + "-" + Math.max(0, Math.round(hi === "" ? 100 : +hi)));
    var v = r[0] + "-" + r[1], now = vals("pc");
    if (now.indexOf(v) < 0) now.push(v);
    msFocus = "ms-find";
    setFilter("pc", now.join("|"));
  }
  $("reset").addEventListener("click", function () { msOpen = null; Object.keys(F).forEach(function (k) { F[k] = ""; }); render(); });

  /* ---------- shared table helper ---------- */
  function sortRows(rows, cols, sort) {
    var c = cols.find(function (x) { return x.k === sort.k; });
    if (!c) return rows;
    var val = c.sv || function (r) { return r[c.k]; };
    return rows.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      var d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === "asc" ? d : -d;
    });
  }
  function table(el, cols, rows, sort, opts) {
    opts = opts || {};
    var h = '<div class="tbl-wrap"><table><thead><tr>' + cols.map(function (c) {
      var s = sort && c.k === sort.k ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
      return '<th class="' + (c.r ? "r " : "") + (sort ? "sortable" : "") + '" data-k="' + c.k + '"' + (sort ? ' aria-sort="' + s + '" tabindex="0"' : "") + ">" + esc(c.label) + "</th>";
    }).join("") + "</tr></thead><tbody>" + (opts.body || rows.map(function (r, i) {
      return "<tr" + (opts.onRow ? ' class="clickable" tabindex="0" data-i="' + i + '"' : "") + ">" + cols.map(function (c) { return '<td class="' + (c.r ? "r " : "") + (c.cls || "") + '">' + (c.f ? c.f(r) : esc(r[c.k])) + "</td>"; }).join("") + "</tr>";
    }).join("")) + "</tbody>" + (opts.foot ? "<tfoot>" + opts.foot + "</tfoot>" : "") + "</table></div>" + (opts.after || "");
    el.innerHTML = h;
    if (opts.onRow) el.querySelectorAll("tbody tr[data-i]").forEach(function (tr) {
      function go() { opts.onRow(rows[+tr.getAttribute("data-i")]); }
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", function (e) { if (e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } });
    });
    if (sort) el.querySelectorAll("th.sortable").forEach(function (th) {
      function go() {
        var k = th.getAttribute("data-k");
        sort.dir = sort.k === k && sort.dir === "asc" ? "desc" : (sort.k === k ? "asc" : (cols.find(function (c) { return c.k === k; }).r ? "desc" : "asc"));
        sort.k = k;
        opts.rerender();
      }
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }
  function downloadCSV(name, cols, rows) {
    var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = "﻿" + cols.map(function (c) { return q(c.label); }).join(",") + "\n" +
      rows.map(function (r) { return cols.map(function (c) { return q(c.csv ? c.csv(r) : r[c.k]); }).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function pbar(pct) {
    if (pct == null || !isFinite(pct)) return '<span class="faint">' + DASH + "</span>";
    return '<div class="pbar"><div class="ptrack"><div class="pfill' + (pct > 100 ? " over" : "") + '" style="width:' + Math.min(100, Math.max(0, pct)) + '%"></div></div><span>' + fmtP(pct) + "</span></div>";
  }
  function plannedToDate(t) {
    if (!t.ps || t.ps > TODAY) return 0;
    return t.pr * (dnum(t.pe < TODAY ? t.pe : TODAY) - dnum(t.ps) + 1);
  }
  function qtyUnit(rows) {
    if (F.u) return F.u;
    var top = byCountDesc(countBy(rows, "u"))[0];
    return top ? top[0] : null;
  }
  function slug() { var st = vals("st"); return (meta.key || "JUI") + (F.a ? "-" + F.a : "") + (st.length === 1 ? "-" + st[0] : st.length ? "-" + st.length + "-subtrades" : ""); }

  /* ---------- filter hint ---------- */
  function renderHint(R) {
    var c = ctxSub();
    $("q-hint").innerHTML = c ? "<span><b>" + fmtI(R.length) + "</b> of " + fmtI(T.length) + " activities in view · " + esc(c.replace(/^Within the page filters: /, "")) + "</span>"
      : "<span>No filters — showing all <b>" + fmtI(T.length) + "</b> activities</span>";
  }

  /* ---------- KPI 1: quantity by subtrade ---------- */
  var subSort = { k: "st", dir: "asc" }, subRows = [];
  var SUB_COLS = [
    { k: "st", label: "Subtrade", cls: "wrap" },
    { k: "u", label: "Unit" },
    { k: "n", label: "Activities", r: true, f: function (r) { return fmtI(r.n); } },
    { k: "tq", label: "Total qty", r: true, f: function (r) { return fmtN(r.tq); } },
    { k: "ptd", label: "Planned to date", r: true, f: function (r) { return fmtN(r.ptd); } },
    { k: "aq", label: "Actual qty", r: true, f: function (r) { return fmtN(r.aq); } },
    { k: "v", label: "Variance (total − actual)", r: true, f: function (r) { return fmtN(r.v); } },
    { k: "vp", label: "Actual vs plan to date", r: true, f: function (r) { return '<span class="' + (r.vp < 0 ? "neg" : r.vp > 0 ? "pos" : "") + '">' + fmtSigned(r.vp) + "</span>"; } },
    { k: "pct", label: "Progress", sv: function (r) { return r.pct; }, f: function (r) { return pbar(r.pct); }, csv: function (r) { return r.pct == null ? "" : r.pct.toFixed(1); } },
    { k: "ssMin", label: "Schedule start", f: function (r) { return schedCell(r.ssMin, r.ssN, r.n, "Schedule Start", r.ssBad); }, csv: function (r) { return r.ssMin || ""; } },
    { k: "sfMax", label: "Schedule end", f: function (r) { return schedCell(r.sfMax, r.sfN, r.n, "Schedule Finish", r.ssBad); }, csv: function (r) { return r.sfMax || ""; } },
    { k: "asAll", label: "Actual start", sv: function (r) { return r.done ? r.asMin : null; }, f: function (r) { return actualCell(r, r.asMin); }, csv: function (r) { return r.done ? r.asMin || "" : ""; } },
    { k: "aeAll", label: "Actual end", sv: function (r) { return r.done ? r.aeMax : null; }, f: function (r) { return actualCell(r, r.aeMax); }, csv: function (r) { return r.done ? r.aeMax || "" : ""; } },
  ];
  /* earliest Schedule Start / latest Schedule Finish of the activities that carry the custom field */
  function schedCell(v, have, n, field, bad) {
    if (bad) return '<span class="late" title="Schedule Start is after Schedule Finish: check the custom fields in VisiLean">&#9888; ' + fmtD(v) + "</span>";
    if (!v) return '<span class="faint" title="No activity here has a ' + field + ' date">' + DASH + "</span>";
    return have < n ? '<span title="From ' + have + " of " + n + " activities; the rest have no " + field + ' date">' + fmtD(v) + '<span class="faint">*</span></span>' : fmtD(v);
  }
  /* actual dates of a subtrade only once every activity in it is complete */
  function actualCell(r, v) {
    if (!r.done) return '<span class="faint" title="' + fmtI(r.n - r.c) + " of " + fmtI(r.n) + ' activities not complete yet">' + DASH + "</span>";
    return fmtD(v);
  }
  function groupQty(rows, keyFn) {
    var m = new Map();
    rows.forEach(function (t) {
      var k = keyFn(t), g = m.get(k);
      if (!g) { g = { n: 0, tq: 0, aq: 0, ptd: 0, c: 0, s: 0, ns: 0, ssMin: null, sfMax: null, ssN: 0, sfN: 0, asMin: null, aeMax: null }; m.set(k, g); }
      g.n++; g.tq += t.tq; g.aq += t.aq; g.ptd += plannedToDate(t);
      if (t.ss) { g.ssN++; if (!g.ssMin || t.ss < g.ssMin) g.ssMin = t.ss; }
      if (t.sf) { g.sfN++; if (!g.sfMax || t.sf > g.sfMax) g.sfMax = t.sf; }
      if (t.as && (!g.asMin || t.as < g.asMin)) g.asMin = t.as;
      if (t.ae && (!g.aeMax || t.ae > g.aeMax)) g.aeMax = t.ae;
      if (t.g !== "complete" && t.fc) {  // forecast of the open work: the latest forecast finish, and where it came from
        if (!g.fcMax || t.fc > g.fcMax) g.fcMax = t.fc;
        g.fcSrc = g.fcSrc && g.fcSrc !== t.fs ? "mixed" : t.fs;
      }
      if (t.pe && (!g.peMax || t.pe > g.peMax)) g.peMax = t.pe;
      if (t.ps && (!g.psMin || t.ps < g.psMin)) g.psMin = t.ps;
      if (t.g === "complete") g.c++; else if (t.g === "started") g.s++; else g.ns++;
    });
    m.forEach(function (g) { g.v = g.tq - g.aq; g.vp = g.aq - g.ptd; g.pct = g.tq ? 100 * g.aq / g.tq : null; g.done = g.n > 0 && g.c === g.n; g.ssBad = !!(g.ssMin && g.sfMax && g.ssMin > g.sfMax); });
    return m;
  }
  function renderSubtrade(R) {
    var m = groupQty(R, function (t) { return t.st + "\u0001" + t.u; });
    subRows = Array.from(m.entries()).map(function (e) { var p = e[0].split("\u0001"); return Object.assign({ st: p[0], u: p[1] }, e[1]); });
    if (!subRows.length) { $("subtrade").innerHTML = '<div class="empty">No activities match the selected filters.</div>'; return; }
    var units = new Set(subRows.map(function (r) { return r.u; }));
    var foot;
    if (units.size === 1) {
      var tot = groupQty(R, function () { return "all"; }).get("all");
      foot = "<tr><td>Total</td><td>" + esc(subRows[0].u) + '</td><td class="r">' + fmtI(tot.n) + '</td><td class="r">' + fmtN(tot.tq) + '</td><td class="r">' + fmtN(tot.ptd) + '</td><td class="r">' + fmtN(tot.aq) + '</td><td class="r">' + fmtN(tot.v) + '</td><td class="r">' + fmtSigned(tot.vp) + "</td><td>" + pbar(tot.pct) + "</td><td>" + schedCell(tot.ssMin, tot.ssN, tot.n, "Schedule Start", tot.ssBad) + "</td><td>" + schedCell(tot.sfMax, tot.sfN, tot.n, "Schedule Finish", tot.ssBad) +
        "</td><td>" + actualCell(tot, tot.asMin) + "</td><td>" + actualCell(tot, tot.aeMax) + "</td></tr>";
    } else {
      foot = '<tr><td colspan="13" class="muted" style="font-weight:500">' + units.size + " units in view. Totals add up only within one unit: choose one in the Unit filter.</td></tr>";
    }
    table($("subtrade"), SUB_COLS, sortRows(subRows, SUB_COLS, subSort), subSort, {
      foot: foot, rerender: function () { renderSubtrade(current); },
      onRow: function (r) {
        drill({ eyebrow: "Subtrade", title: r.st + " (" + r.u + ")", sub: ctxSub(), rows: R.filter(function (t) { return t.st === r.st && t.u === r.u; }), filter: { st: r.st, u: r.u } });
      },
    });
  }
  $("csv-sub").addEventListener("click", function () { downloadCSV(slug() + "-subtrade-quantities.csv", SUB_COLS, sortRows(subRows, SUB_COLS, subSort)); });

  /* ---------- KPI 2: location bifurcation ---------- */
  /* area > sub-location > subtrade tree. Area and sub-location quantities are in locUnit (the unit
     filter, or the most common unit); a subtrade row is one subtrade in one unit, in that unit. */
  var locRows = [], locUnit = null, locOpen = null;  // locOpen: expanded row keys; null = default (areas open)
  var LOC_COLS = [
    { k: "name", label: "Area › sub-location › subtrade", cls: "wrap" },
    { k: "unit", label: "Unit", f: function (r) { return r.unit ? esc(r.unit) : DASH; } },
    /* the same quantity and date columns as "Quantity by subtrade"; quantities only count the row's unit */
    { k: "tq", label: "Total qty", r: true, f: function (r) { return r.qn ? fmtN(r.tq) : DASH; }, csv: function (r) { return r.qn ? r.tq : ""; } },
    { k: "ptd", label: "Planned to date", r: true, f: function (r) { return r.qn ? fmtN(r.ptd) : DASH; }, csv: function (r) { return r.qn ? r.ptd : ""; } },
    { k: "aq", label: "Actual qty", r: true, f: function (r) { return r.qn ? fmtN(r.aq) : DASH; }, csv: function (r) { return r.qn ? r.aq : ""; } },
    { k: "v", label: "Variance (total − actual)", r: true, f: function (r) { return r.qn ? fmtN(r.v) : DASH; }, csv: function (r) { return r.qn ? r.v : ""; } },
    { k: "vp", label: "Actual vs plan to date", r: true, f: function (r) { return r.qn ? '<span class="' + (r.vp < -0.005 ? "neg" : r.vp > 0.005 ? "pos" : "") + '">' + fmtSigned(r.vp) + "</span>" : DASH; }, csv: function (r) { return r.qn ? r.vp : ""; } },
    { k: "pct", label: "Progress", f: function (r) { return r.qn ? pbar(r.pct) : DASH; }, csv: function (r) { return r.pct == null ? "" : r.pct.toFixed(1); } },
    { k: "ssMin", label: "Schedule start", f: function (r) { return schedCell(r.ssMin, r.ssN, r.n, "Schedule Start", r.ssBad); }, csv: function (r) { return r.ssMin || ""; } },
    { k: "sfMax", label: "Schedule end", f: function (r) { return schedCell(r.sfMax, r.sfN, r.n, "Schedule Finish", r.ssBad); }, csv: function (r) { return r.sfMax || ""; } },
    { k: "asAll", label: "Actual start", f: function (r) { return actualCell(r, r.asMin); }, csv: function (r) { return r.done ? r.asMin || "" : ""; } },
    { k: "aeAll", label: "Actual end", f: function (r) { return actualCell(r, r.aeMax); }, csv: function (r) { return r.done ? r.aeMax || "" : ""; } },
  ];
  function renderLocations(R, focusKey) {
    locUnit = qtyUnit(R);
    $("loc-desc").textContent = locUnit ? "Area and sub-location quantities in " + locUnit + (F.u ? "" : " (the most common unit here; choose another in the Unit filter)") + "; subtrade rows in their own unit" : "";
    if (!R.length) { $("locations").innerHTML = '<div class="empty">No activities match the selected filters.</div>'; locRows = []; return; }
    /* dates over every activity in the row; quantities over the activities in the row's unit */
    function agg(rows, unit) {
      var g = groupQty(rows, function () { return "all"; }).get("all");
      var q = groupQty(rows.filter(function (t) { return t.u === unit; }), function () { return "u"; }).get("u");
      g = Object.assign({}, g, { unit: unit, qn: q ? q.n : 0, tq: q ? q.tq : 0, aq: q ? q.aq : 0, ptd: q ? q.ptd : 0 });
      g.v = g.tq - g.aq; g.vp = g.aq - g.ptd; g.pct = g.tq ? 100 * g.aq / g.tq : null;
      return g;
    }
    var areas = new Map();
    R.forEach(function (t) {
      if (!areas.has(t.a)) areas.set(t.a, new Map());
      var s = areas.get(t.a);
      if (!s.has(t.sl)) s.set(t.sl, []);
      s.get(t.sl).push(t);
    });
    function areaN(s) { var c = 0; s.forEach(function (v) { c += v.length; }); return c; }
    if (!locOpen) { locOpen = new Set(); areas.forEach(function (v, a) { locOpen.add("a\u0001" + a); }); }
    locRows = [];
    var body = "";
    function cells(r) { return LOC_COLS.slice(1).map(function (c) { return "<td" + (c.r ? ' class="r"' : "") + ">" + c.f(r) + "</td>"; }).join(""); }
    function toggle(key, label, what) {
      var open = locOpen.has(key);
      return '<button type="button" class="tg" data-tg="' + esc(key) + '" aria-expanded="' + open + '" aria-label="' + (open ? "Hide " : "Show ") + what + " of " + esc(label) + '">&#9656;</button>';
    }
    Array.from(areas.entries()).sort(function (a, b) { return areaN(b[1]) - areaN(a[1]) || a[0].localeCompare(b[0]); }).forEach(function (ae) {
      var a = ae[0], ka = "a\u0001" + a, all = [];
      ae[1].forEach(function (v) { all = all.concat(v); });
      var ar = Object.assign({ name: a, area: a, sub: "", st: "", level: "Area" }, agg(all, locUnit));
      locRows.push(ar);
      body += '<tr class="grp clickable lv1" data-a="' + esc(a) + '" tabindex="0"><td class="lv lv1">' + toggle(ka, a, "sub-locations") + esc(a) +
        ' <span class="lv-n">' + fmtI(ae[1].size) + " sub-location" + (ae[1].size === 1 ? "" : "s") + "</span></td>" + cells(ar) + "</tr>";
      Array.from(ae[1].entries()).sort(function (x, y) { return x[0].localeCompare(y[0], undefined, { numeric: true }); }).forEach(function (se) {
        var sl = se[0], ks = "s\u0001" + a + "\u0001" + sl, aOpen = locOpen.has(ka);
        var sts = new Map();
        se[1].forEach(function (t) { var k = t.st + "\u0001" + t.u; if (!sts.has(k)) sts.set(k, []); sts.get(k).push(t); });
        var sr = Object.assign({ name: sl, area: a, sub: sl, st: "", level: "Sub-location" }, agg(se[1], locUnit));
        locRows.push(sr);
        body += '<tr class="clickable lv2" data-a="' + esc(a) + '" data-sl="' + esc(sl) + '" tabindex="0"' + (aOpen ? "" : " hidden") + '><td class="lv lv2">' +
          toggle(ks, sl, "subtrades") + esc(sl) + ' <span class="lv-n">' + fmtI(sts.size) + " subtrade" + (sts.size === 1 ? "" : "s") + "</span></td>" + cells(sr) + "</tr>";
        Array.from(sts.entries()).sort(function (x, y) { return y[1].length - x[1].length || x[0].localeCompare(y[0]); }).forEach(function (te) {
          var p = te[0].split("\u0001");
          var tr = Object.assign({ name: p[0], area: a, sub: sl, st: p[0], level: "Subtrade" }, agg(te[1], p[1]));
          locRows.push(tr);
          body += '<tr class="clickable lv3" data-a="' + esc(a) + '" data-sl="' + esc(sl) + '" data-st="' + esc(p[0]) + '" data-u="' + esc(p[1]) + '" tabindex="0"' +
            (aOpen && locOpen.has(ks) ? "" : " hidden") + '><td class="lv lv3">' + esc(p[0]) + "</td>" + cells(tr) + "</tr>";
        });
      });
    });
    table($("locations"), LOC_COLS, [], null, { body: body });
    $("locations").querySelectorAll("tr.clickable").forEach(function (tr) {
      function go() {
        var a = tr.getAttribute("data-a"), sl = tr.getAttribute("data-sl"), st = tr.getAttribute("data-st"), u = tr.getAttribute("data-u");
        drill({ eyebrow: st ? "Subtrade" : sl ? "Sub-location" : "Area", title: [a, sl, st && st + " (" + u + ")"].filter(Boolean).join(" · "), sub: ctxSub(),
          rows: R.filter(function (t) { return t.a === a && (!sl || t.sl === sl) && (!st || (t.st === st && t.u === u)); }),
          filter: st ? { a: a, sl: sl, st: st, u: u } : { a: a, sl: sl || "" } });
      }
      tr.addEventListener("click", function (e) { if (!e.target.closest(".tg")) go(); });
      tr.addEventListener("keydown", function (e) {
        if (e.target !== tr) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        var tg = tr.querySelector(".tg");
        if (tg && ((e.key === "ArrowRight" && tg.getAttribute("aria-expanded") === "false") || (e.key === "ArrowLeft" && tg.getAttribute("aria-expanded") === "true"))) { e.preventDefault(); tg.click(); }
      });
    });
    $("locations").querySelectorAll(".tg").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var k = b.getAttribute("data-tg");
        if (locOpen.has(k)) locOpen.delete(k); else locOpen.add(k);
        renderLocations(current, k);
      });
    });
    if (focusKey) {
      var f = Array.prototype.find.call($("locations").querySelectorAll(".tg"), function (b) { return b.getAttribute("data-tg") === focusKey; });
      if (f) f.focus();
    }
  }
  $("loc-expand").addEventListener("click", function () {
    locOpen = new Set();
    current.forEach(function (t) { locOpen.add("a\u0001" + t.a); locOpen.add("s\u0001" + t.a + "\u0001" + t.sl); });
    renderLocations(current);
  });
  $("loc-collapse").addEventListener("click", function () { locOpen = new Set(); renderLocations(current); });
  $("csv-loc").addEventListener("click", function () {
    var cols = [{ k: "level", label: "Level" }, { k: "area", label: "Area" }, { k: "sub", label: "Sub-location" }, { k: "st", label: "Subtrade" }].concat(LOC_COLS.slice(1));
    downloadCSV(slug() + "-locations.csv", cols, locRows);
  });

  /* ---------- subtrade progress by location: a card per subtrade, grouped by area or sub-location ---------- */
  var prog = { show: "progress", by: "area" };
  /* Status, first match wins (the legend under the cards says the same) */
  var PK = {
    missing: { label: "Missing data", ic: "&#8854;" },
    complete: { label: "Complete", ic: "&#10003;" },
    startLate: { label: "Start overdue", ic: "&#9638;" },
    finishLate: { label: "Finish overdue", ic: "&#9888;" },
    behind: { label: "Behind plan", ic: "&#9719;" },
    onTrack: { label: "On track", ic: "&#8599;" },
  };
  var PK_ORDER = ["complete", "onTrack", "behind", "startLate", "finishLate", "missing"];  // the heading ring, going round
  var FC_SRC = { baseline: "JUI-1A baseline", schedule: "Schedule Finish", mixed: "JUI-1A baseline and Schedule Finish" };
  function pkStatus(g) {
    if (!(g.tq > 0) || !g.peMax) return "missing";
    if (g.done || g.aq >= g.tq) return "complete";
    if (!g.aq && !g.asMin && g.psMin && g.psMin < TODAY) return "startLate";
    if (g.peMax < TODAY) return "finishLate";
    if (g.pct - g.ptdPct < -5) return "behind";
    return "onTrack";
  }
  function daysWord(n) { return fmtI(n) + " day" + (n === 1 ? "" : "s"); }
  function pkRows(R) {
    var whole = (P.data && P.data.location && P.data.location.wholeArea) || "Whole area";
    function loc(t) { return prog.by === "sub" && t.sl !== whole && t.sl !== t.a ? t.sl : t.a; }
    var m = groupQty(R, function (t) { return loc(t) + "\u0001" + t.st + "\u0001" + t.u; });
    return Array.from(m.entries()).map(function (e) {
      var p = e[0].split("\u0001"), g = Object.assign({ loc: p[0], st: p[1], u: p[2] }, e[1]);
      g.ptdPct = g.tq ? 100 * g.ptd / g.tq : null;
      g.status = pkStatus(g);
      g.attention = g.status === "finishLate" || g.status === "startLate" || g.status === "behind";
      return g;
    }).filter(function (g) {
      if (prog.show === "all") return true;
      if (prog.show === "attention") return g.attention || g.status === "missing";
      return (g.c + g.s) > 0 && !g.done;  // in progress: some work recorded, not every activity complete
    });
  }
  function renderProgress(R) {
    var noSub = (P.data && P.data.noSubtrade) || "Unassigned";
    var skip = P.data && P.data.progressExclude ? new RegExp(P.data.progressExclude, "i") : null;  // e.g. the PCC subtrades
    var rows = pkRows(R).filter(function (g) { return g.st !== noSub && !(skip && skip.test(g.st)); }), groups = new Map();  // no chart for tasks without a subtrade
    rows.forEach(function (g) { if (!groups.has(g.loc)) groups.set(g.loc, []); groups.get(g.loc).push(g); });
    var att = rows.filter(function (g) { return g.attention; }).length;
    $("prog-desc").textContent = rows.length ? fmtI(rows.length) + " subtrade" + (rows.length === 1 ? "" : "s") + " in " + fmtI(groups.size) + (prog.by === "sub" ? " locations" : " areas") + " · " + fmtI(att) + " need attention" : "";
    if (!rows.length) {
      $("progress").innerHTML = '<div class="empty">' + (prog.show === "attention" ? "Nothing needs attention for these filters." : prog.show === "all" ? "No subtrade matches these filters." : "No subtrade is in progress for these filters.") + "</div>";
      return;
    }
    var order = Array.from(groups.entries()).sort(function (a, b) {
      var sa = a[1].reduce(function (m, g) { return g.psMin && (!m || g.psMin < m) ? g.psMin : m; }, null) || "9";
      var sb = b[1].reduce(function (m, g) { return g.psMin && (!m || g.psMin < m) ? g.psMin : m; }, null) || "9";
      return sa.localeCompare(sb) || a[0].localeCompare(b[0]);  // in construction sequence
    });
    $("progress").innerHTML = '<div class="pk-wrap">' + order.map(function (ge) {
      var list = ge[1].sort(function (x, y) { return (x.psMin || "9").localeCompare(y.psMin || "9") || x.st.localeCompare(y.st); });
      var done = list.filter(function (g) { return g.status === "complete"; }).length, need = list.filter(function (g) { return g.attention; }).length, miss = list.filter(function (g) { return g.status === "missing"; }).length;
      return '<div class="pk-group" style="--cols:' + Math.min(list.length, 6) + '"><div class="pk-gh"><h3>' + esc(ge[0]) + "</h3><span>" + fmtI(list.length) + " subtrade" + (list.length === 1 ? "" : "s") + "</span>" +
        '<span class="pk-sum">' + statusRing(list) + fmtI(done) + " of " + fmtI(list.length) + " complete" + (need ? ' · <b class="neg">' + fmtI(need) + " need" + (need === 1 ? "s" : "") + " attention</b>" : "") + (miss ? ' · <b class="muted">' + fmtI(miss) + " missing data</b>" : "") + "</span></div>" +
        '<div class="pk-cols">' + list.map(pkCard).join("") + "</div></div>";
    }).join("") + "</div>";
    $("progress").querySelectorAll(".pk-col").forEach(function (el) {
      el.addEventListener("click", function () {
        var lc = el.getAttribute("data-loc"), st = el.getAttribute("data-st"), u = el.getAttribute("data-u");
        var whole = (P.data && P.data.location && P.data.location.wholeArea) || "Whole area";
        drill({ eyebrow: "Subtrade progress", title: st + " · " + lc + " (" + u + ")", sub: ctxSub(), filter: null,
          rows: R.filter(function (t) { var l = prog.by === "sub" && t.sl !== whole && t.sl !== t.a ? t.sl : t.a; return l === lc && t.st === st && t.u === u; }) });
      });
    });
  }
  /* the heading's small ring: one arc per status, sized by how many subtrades have it */
  function statusRing(list) {
    var r = 7, c = 2 * Math.PI * r, n = list.length, off = 0, cnt = {};
    list.forEach(function (g) { cnt[g.status] = (cnt[g.status] || 0) + 1; });
    var kinds = PK_ORDER.filter(function (k) { return cnt[k]; }), gap = kinds.length > 1 ? 1.2 : 0;
    return '<svg class="pk-ring" viewBox="0 0 20 20" aria-hidden="true">' + kinds.map(function (k) {
      var len = c * cnt[k] / n, seg = '<circle class="pk-' + k + '" cx="10" cy="10" r="' + r + '" stroke-dasharray="' + Math.max(0.6, len - gap).toFixed(2) + " " + c.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 10 10)"/>';
      off += len;
      return seg;
    }).join("") + "</svg>";
  }
  /* donut: light arc to plan to date, solid arc to actual, a tick at the plan */
  function pkDonut(g) {
    var R = 46, C = 2 * Math.PI * R, w = function (v) { return Math.max(0, Math.min(100, v || 0)); };
    if (g.status === "missing") return '<svg class="pk-donut" viewBox="0 0 120 120" aria-hidden="true"><circle class="pk-trk" cx="60" cy="60" r="' + R + '"/><text class="pk-big" x="60" y="62" text-anchor="middle">' + DASH + '</text><text class="pk-cap" x="60" y="80" text-anchor="middle">NO DATA</text></svg>';
    var a = w(g.pct), p = w(g.ptdPct), th = (p / 100) * 2 * Math.PI - Math.PI / 2;
    var arc = function (cls, v) { return v > 0 ? '<circle class="' + cls + '" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + (C * v / 100).toFixed(2) + " " + C.toFixed(2) + '" transform="rotate(-90 60 60)"/>' : ""; };
    var tick = '<line class="pk-tk" x1="' + (60 + (R - 10) * Math.cos(th)).toFixed(1) + '" y1="' + (60 + (R - 10) * Math.sin(th)).toFixed(1) + '" x2="' + (60 + (R + 10) * Math.cos(th)).toFixed(1) + '" y2="' + (60 + (R + 10) * Math.sin(th)).toFixed(1) + '"/>';
    return '<svg class="pk-donut" viewBox="0 0 120 120" aria-hidden="true"><circle class="pk-trk" cx="60" cy="60" r="' + R + '"/>' + arc("pk-plan", p) + arc("pk-act", a) + tick +
      '<text class="pk-big" x="60" y="64" text-anchor="middle">' + fmtP(g.pct) + '</text><text class="pk-cap" x="60" y="80" text-anchor="middle">ACTUAL</text></svg>';
  }
  function pkCard(g) {
    var st = g.status, U = esc(g.u), noUnit = g.u === ((P.data && P.data.noUnit) || "No unit");
    var d = g.pct != null && g.ptdPct != null ? g.pct - g.ptdPct : null;
    var vs = d == null ? "" : Math.abs(d) < 0.05 ? "on plan" : (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1).replace(/\.0$/, "") + " pts";
    function kv(l, v, cls, sub) { return '<div class="pk-kv"><span>' + l + '</span><span class="' + (cls || "") + '">' + v + (sub ? '<small class="' + (cls || "") + '">' + sub + "</small>" : "") + "</span></div>"; }
    var dates = "";
    if (g.asMin) dates += kv("Started", fmtD(g.asMin, true));
    else if (g.psMin) dates += kv("Planned start", fmtD(g.psMin, true), g.psMin < TODAY ? "late" : "", g.psMin < TODAY ? daysWord(TN_ - dnum(g.psMin)) + " late" : "starts in " + daysWord(dnum(g.psMin) - TN_));
    else dates += kv("Start", DASH);
    if (g.done && g.aeMax) dates += kv("Finished", fmtD(g.aeMax, true));
    else if (g.peMax) {
      var dd = dnum(g.peMax) - TN_;
      dates += kv("Planned finish", fmtD(g.peMax, true), dd < 0 ? "late" : dd <= 7 ? "soon" : "", dd < 0 ? daysWord(-dd) + " overdue" : dd === 0 ? "due today" : dd === 1 ? "due tomorrow" : "due in " + daysWord(dd));
    } else dates += kv("Finish", DASH);
    if (!g.done) dates += kv("Forecast", g.fcMax ? fmtD(g.fcMax, true) : DASH, g.fcMax && g.peMax && g.fcMax > g.peMax ? "late" : "", g.fcMax ? FC_SRC[g.fcSrc] || "" : "no forecast date");
    var missing = st === "missing";
    return '<button type="button" class="pk-col pk-' + st + '" data-loc="' + esc(g.loc) + '" data-st="' + esc(g.st) + '" data-u="' + U + '" aria-label="' +
      esc(g.st + " in " + g.loc + ": " + PK[st].label + ", " + fmtP(g.pct) + " of scope against " + fmtP(g.ptdPct) + " planned. Show the activities") + '">' +
      '<div class="pk-name"><b>' + esc(g.st) + '</b> <span class="pk-unit' + (noUnit ? " warn" : "") + '">' + (noUnit ? "no unit" : U.toLowerCase()) + "</span></div>" +
      '<span class="pk-pill pk-' + st + '"><i aria-hidden="true">' + PK[st].ic + "</i>" + PK[st].label + "</span>" +
      pkDonut(g) +
      (missing ? '<div class="pk-planl">No scope or planned dates in the source</div>'
        : '<div class="pk-planl">Plan <b>' + fmtP(g.ptdPct) + '</b> <span class="pk-vs">' + vs + "</span></div>") +
      '<div class="pk-rows">' + kv("Scope", missing ? DASH : fmtN(g.tq) + " " + (noUnit ? "" : U.toLowerCase())) + kv("Plan to date", missing ? DASH : fmtN(g.ptd)) +
      kv("Actual to date", missing ? DASH : "<b>" + fmtN(g.aq) + "</b>") + '<div class="pk-sep"></div>' + dates +
      '<div class="pk-n">' + fmtI(g.n) + " activit" + (g.n === 1 ? "y" : "ies") + "</div></div></button>";
  }
  function progSeg(id, key) {
    $(id).querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        prog[key] = b.getAttribute("data-v");
        $(id).querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        renderProgress(current);
      });
    });
  }
  progSeg("prog-show", "show");
  progSeg("prog-by", "by");
  var TN_ = TODAY_N;
  function statusPill(t) {
    return '<span class="pill ' + t.g + '">' + STATUS[t.g] + "</span>" + (t.od ? ' <span class="pill overdue">Overdue</span>' : "");
  }

  /* ---------- drill-through drawer: a list of activities, then one activity in detail ---------- */
  var DW = { ctx: null, task: null, list: [], opener: null, q: "", s: "", sort: { k: "pe", dir: "asc" }, all: false };
  var KIND = { late: "Late", good: "On time / early", reschedule: "Rescheduled", quantity: "Quantity changed", info: "Update" };
  var DW_STATUS = [["", "All"], ["complete", "Complete"], ["started", "Started"], ["notStarted", "Not started"], ["overdue", "Overdue"]];
  function delayTxt(d, done) {
    if (d == null) return '<span class="faint">' + DASH + "</span>";
    if (d === 0) return "On time";
    var a = Math.abs(d);
    return '<span class="' + (d > 0 ? "late" : "early") + '">' + fmtI(a) + " day" + (a === 1 ? "" : "s") + (d > 0 ? " late" : " early") + (d > 0 && !done ? " so far" : "") + "</span>";
  }
  function dwCols() {
    return [
      { k: "id", label: "ID", sv: function (r) { return +r.id || r.id; } },
      { k: "n", label: "Activity", cls: "wrap" },
    ].concat((DW.ctx && DW.ctx.extra) || []).concat([
      { k: "st", label: "Subtrade" },
      { k: "a", label: "Location", sv: function (r) { return r.a + " " + r.sl; }, f: function (r) { return esc(r.a) + (r.sl && r.sl !== r.a ? ' <span class="faint">· ' + esc(r.sl) + "</span>" : ""); }, csv: function (r) { return r.loc || r.a; } },
      { k: "g", label: "Status", f: statusPill, csv: function (r) { return STATUS[r.g] + (r.od ? " (overdue)" : ""); } },
      { k: "u", label: "Unit" },
      { k: "tq", label: "Total", r: true, f: function (r) { return fmtN(r.tq); } },
      { k: "aq", label: "Actual", r: true, f: function (r) { return fmtN(r.aq); } },
      { k: "v", label: "Variance", r: true, sv: function (r) { return r.tq - r.aq; }, f: function (r) { return fmtN(r.tq - r.aq); }, csv: function (r) { return r.tq - r.aq; } },
      { k: "pc", label: "% complete", r: true, f: function (r) { return fmtP(r.pc); } },
      { k: "pe", label: "Planned end", f: function (r) { return fmtD(r.pe); } },
      { k: "fd", label: "Finish delay", r: true, f: function (r) { return delayTxt(r.fd, !!r.ae); } },
      { k: "o", label: "Owner" },
    ]);
  }
  function dwOpen() {
    if ($("drawer").hidden) {
      DW.opener = document.activeElement;
      $("drawer").hidden = false; $("scrim").hidden = false;
      document.body.style.overflow = "hidden";
    }
    hideTip();
  }
  function dwClose() {
    $("drawer").hidden = true; $("scrim").hidden = true;
    document.body.style.overflow = "";
    DW.task = null;
    if (DW.opener && DW.opener.focus && document.contains(DW.opener)) DW.opener.focus();
  }
  /* ctx: { eyebrow, title, sub, rows, filter (page filters that reproduce it), extra (columns) } */
  function drill(ctx) {
    DW.ctx = ctx; DW.task = null; DW.q = ""; DW.s = ""; DW.all = false;
    dwOpen(); dwRenderList(); $("dw-close").focus();
  }
  function openTask(t, ctx, list) {
    DW.ctx = ctx || null; DW.list = list || [t]; DW.task = t;
    dwOpen(); dwRenderTask(); $("dw-close").focus();
  }
  function dwFiltered() {
    var q = DW.q.toLowerCase();
    return DW.ctx.rows.filter(function (t) {
      if (DW.s === "overdue" ? !t.od : (DW.s && t.g !== DW.s)) return false;
      if (q && [t.n, t.id, t.st, t.a, t.sl, t.o].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sumCell(v, l, s) { return '<div><div class="sum-v">' + v + '</div><div class="sum-l">' + esc(l) + "</div>" + (s ? '<div class="sum-s">' + s + "</div>" : "") + "</div>"; }
  function dwSummary(rows) {
    var g = countBy(rows, "g"), od = rows.filter(function (t) { return t.od; }).length;
    var q = groupQty(rows, function (t) { return t.u; });
    var units = Array.from(q.entries()).sort(function (a, b) { return b[1].n - a[1].n; }).slice(0, 3);
    return '<div class="sum">' + sumCell(fmtI(rows.length), "Activities") + sumCell(fmtI(g.get("complete") || 0), "Complete") +
      sumCell(fmtI(g.get("started") || 0), "Started") + sumCell(fmtI(g.get("notStarted") || 0), "Not started") + sumCell(fmtI(od), "Overdue") +
      units.map(function (e) { return sumCell(fmtN(e[1].aq) + ' <span class="faint" style="font-weight:500;font-size:13px">/ ' + fmtN(e[1].tq) + "</span>", "Actual / total, " + e[0], fmtP(e[1].pct) + " done · variance " + fmtN(e[1].v)); }).join("") +
      "</div>";
  }
  function dwRenderList() {
    var c = DW.ctx;
    $("dw-back").hidden = true;
    $("dw-eyebrow").textContent = c.eyebrow || "Activities";
    $("dw-title").textContent = c.title;
    $("dw-sub").textContent = c.sub || "";
    var counts = { "": c.rows.length, overdue: c.rows.filter(function (t) { return t.od; }).length };
    c.rows.forEach(function (t) { counts[t.g] = (counts[t.g] || 0) + 1; });
    $("dw-body").innerHTML = dwSummary(c.rows) +
      '<div class="dw-tools"><input class="dw-search" id="dw-q" type="search" placeholder="Search activity, ID, subtrade, location or owner" value="' + esc(DW.q) + '" aria-label="Search these activities">' +
      '<div class="seg" id="dw-s" role="group" aria-label="Status">' + DW_STATUS.map(function (s) {
        return '<button type="button" data-v="' + s[0] + '" aria-pressed="' + (DW.s === s[0]) + '">' + s[1] + " " + fmtI(counts[s[0]] || 0) + "</button>";
      }).join("") + "</div>" +
      (c.filter ? '<button class="btn" type="button" id="dw-apply" title="Filter the whole page to this selection">Filter the page to this</button>' : "") +
      '<button class="btn" type="button" id="dw-csv">Download CSV</button></div>' +
      '<div class="dw-count" id="dw-count"></div><div id="dw-table"></div><div class="hint">Select an activity for its dates, delays, quantities and full history.</div>';
    $("dw-q").addEventListener("input", function () { DW.q = this.value.trim(); DW.all = false; dwRenderTable(); });
    $("dw-s").querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        DW.s = b.getAttribute("data-v"); DW.all = false;
        $("dw-s").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        dwRenderTable();
      });
    });
    if (c.filter) $("dw-apply").addEventListener("click", function () {
      Object.keys(c.filter).forEach(function (k) { F[k] = c.filter[k]; });
      dwClose(); render();
      $("main").scrollIntoView({ block: "start" });
    });
    $("dw-csv").addEventListener("click", function () { downloadCSV(slug() + "-" + c.title.replace(/[^\w-]+/g, "-").toLowerCase() + ".csv", dwCols(), DW.list); });
    dwRenderTable();
  }
  function dwRenderTable() {
    var cols = dwCols(), rows = dwFiltered();
    DW.list = sortRows(rows, cols, DW.sort);
    var shown = DW.all ? DW.list : DW.list.slice(0, 200);
    $("dw-count").textContent = fmtI(rows.length) + " of " + fmtI(DW.ctx.rows.length) + " activities" + (shown.length < rows.length ? ", showing the first 200" : "");
    if (!rows.length) { $("dw-table").innerHTML = '<div class="empty">No activities match this search or status.</div>'; return; }
    table($("dw-table"), cols, shown, DW.sort, {
      rerender: dwRenderTable,
      onRow: function (t) { openTask(t, DW.ctx, DW.list); },
      after: shown.length < rows.length ? '<div style="margin-top:10px"><button class="btn" type="button" id="dw-more">Show all ' + fmtI(rows.length) + "</button></div>" : "",
    });
    var more = $("dw-more");
    if (more) more.addEventListener("click", function () { DW.all = true; dwRenderTable(); });
  }
  function dwRenderTask() {
    var t = DW.task, i = DW.list.indexOf(t), U = esc(t.u);
    $("dw-back").hidden = !DW.ctx;
    $("dw-eyebrow").textContent = "Activity " + (t.id || DASH);
    $("dw-title").textContent = t.n || DASH;
    $("dw-sub").textContent = [t.st, t.a, t.sl !== t.a ? t.sl : null].filter(Boolean).join(" · ");
    var pct = t.tq ? 100 * t.aq / t.tq : null;
    var hk = countBy(t.h.map(function (e) { return { k: e[1] }; }), "k");
    var started = !!t.as, done = t.g === "complete";
    var h = "";
    if (DW.list.length > 1 && i >= 0) h += '<div class="dw-nav"><button class="btn" type="button" id="dw-prev"' + (i ? "" : " disabled") + '>&#8592; Previous</button><button class="btn" type="button" id="dw-next"' + (i < DW.list.length - 1 ? "" : " disabled") + ">Next &#8594;</button><span>" + fmtI(i + 1) + " of " + fmtI(DW.list.length) + (DW.ctx ? " in " + esc(DW.ctx.title) : "") + "</span></div>";
    h += '<div class="pills">' + statusPill(t) + (t.pri ? '<span class="pill notStarted">' + esc(t.pri) + " priority</span>" : "") + "</div>";
    h += '<div class="sec-h">Quantity <span>in ' + U + "</span></div>" +
      '<div class="sum">' + sumCell(fmtN(t.tq), "Total") + sumCell(fmtN(t.aq), "Actual") + sumCell(fmtN(t.tq - t.aq), "Variance (total − actual)") +
      sumCell(fmtN(plannedToDate(t)), "Planned to date") + "<div>" + pbar(pct) + '<div class="sum-l">Progress</div></div></div>';
    h += '<div class="sec-h">Dates and delays</div><dl class="dl">' +
      "<div><dt>Planned start</dt><dd>" + fmtD(t.ps) + "</dd></div>" +
      "<div><dt>Planned end</dt><dd>" + fmtD(t.pe) + "</dd></div>" +
      "<div><dt>Planned duration</dt><dd>" + (t.pd ? fmtI(t.pd) + " day" + (t.pd === 1 ? "" : "s") : DASH) + "</dd></div>" +
      "<div><dt>Actual start</dt><dd>" + (started ? fmtD(t.as) : "Not started") + "</dd></div>" +
      "<div><dt>Actual end</dt><dd>" + (t.ae ? fmtD(t.ae) : started ? "In progress" : DASH) + "</dd></div>" +
      "<div><dt>Actual duration</dt><dd>" + (t.ad ? fmtI(t.ad) + " day" + (t.ad === 1 ? "" : "s") + (done ? "" : " so far") : DASH) + "</dd></div>" +
      "<div><dt>Start delay</dt><dd>" + delayTxt(t.sd, started) + "</dd></div>" +
      "<div><dt>Finish delay</dt><dd>" + delayTxt(t.fd, !!t.ae) + "</dd></div></dl>";
    h += '<div class="sec-h">Daily distribution <span>Tables 3 and 4</span></div><dl class="dl">' +
      "<div><dt>Planned per day</dt><dd>" + (t.pr ? fmtN(t.pr) + " " + U + " × " + fmtI(t.pd) + " days" : DASH) + "</dd></div>" +
      "<div><dt>Actual per day</dt><dd>" + (t.ar ? fmtN(t.ar) + " " + U + " × " + fmtI(t.ad) + " days" : DASH) + "</dd></div>" +
      "<div><dt>Actual window</dt><dd>" + (t.ax ? fmtD(t.as) + " – " + fmtD(t.ax) + (done ? "" : " (today)") : DASH) + "</dd></div></dl>";
    h += '<div class="sec-h">Details</div><dl class="dl">' +
      [["Subtrade", t.st], ["Trade", t.tr], ["Area", t.a], ["Sub-location", t.sl], ["Location in VisiLean", t.loc], ["Owner", t.o], ["Organisation", t.org], ["Planned completion week", t.wk], ["Schedule start (custom field)", t.ss ? fmtD(t.ss) + (t.sf && t.ss > t.sf ? " ⚠ after the schedule finish" : "") : null], ["Schedule finish (custom field)", t.sf ? fmtD(t.sf) : null], ["Forecast finish", t.fc ? fmtD(t.fc) + (t.fs === "baseline" ? " (JUI-1A baseline)" : " (Schedule Finish)") : null], ["Status in VisiLean", t.s]]
        .map(function (f) { return "<div><dt>" + f[0] + "</dt><dd>" + esc(f[1] == null || f[1] === "" ? DASH : f[1]) + "</dd></div>"; }).join("") + "</dl>";
    h += '<div class="sec-h">History <span>' + fmtI(t.h.length) + " event" + (t.h.length === 1 ? "" : "s") + ", newest first</span></div>";
    if (!t.h.length) h += '<div class="empty">No history events recorded for this activity.</div>';
    else {
      h += '<div class="pills" style="margin-bottom:12px">' + Object.keys(KIND).filter(function (k) { return hk.get(k); }).map(function (k) {
        return '<span class="kchip k-' + k + '"><i></i>' + KIND[k] + " " + fmtI(hk.get(k)) + "</span>";
      }).join("") + "</div>";
      h += '<ol class="tl">' + t.h.slice().reverse().map(function (e) {
        return '<li class="k-' + e[1] + '"><span class="tl-when">' + (e[0] ? fmtD(e[0]) + ", " + e[0].slice(11, 16) : DASH) + '</span><span class="tl-kind">' + KIND[e[1]] + '</span><div class="tl-text">' + esc(e[2]) + "</div>" +
          (e[3] ? '<span class="note">Note: ' + esc(e[3]) + "</span>" : "") + "</li>";
      }).join("") + "</ol>";
    }
    $("dw-body").innerHTML = h;
    $("dw-body").scrollTop = 0;
    function step(d) { DW.task = DW.list[i + d]; dwRenderTask(); var b = $(d < 0 ? "dw-prev" : "dw-next"); if (b && !b.disabled) b.focus(); }
    if ($("dw-prev")) { $("dw-prev").addEventListener("click", function () { step(-1); }); $("dw-next").addEventListener("click", function () { step(1); }); }
  }
  function dwBack() { DW.task = null; dwRenderList(); $("dw-close").focus(); }
  $("dw-close").addEventListener("click", dwClose);
  $("scrim").addEventListener("click", dwClose);
  $("dw-back").addEventListener("click", dwBack);
  document.addEventListener("keydown", function (e) {
    if ($("drawer").hidden) return;
    if (e.key === "Escape") { e.preventDefault(); if (DW.task && DW.ctx) dwBack(); else dwClose(); }
    else if (DW.task && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !/INPUT|SELECT/.test(e.target.tagName)) {
      var b = $(e.key === "ArrowLeft" ? "dw-prev" : "dw-next");
      if (b && !b.disabled) b.click();
    } else if (e.key === "Tab") {
      var f = Array.prototype.filter.call($("drawer").querySelectorAll('button:not([disabled]), input, [tabindex="0"]'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  function ctxSub() {
    var parts = [];
    if (F.a) parts.push(F.a);
    if (F.sl) parts.push(vals("sl").join(", "));
    if (F.st) parts.push(vals("st").join(", "));
    if (F.u) parts.push(F.u);
    if (F.s) parts.push(F.s === "overdue" ? "Overdue" : STATUS[F.s]);
    if (F.pc) parts.push(vals("pc").length === 1 ? pcLabel(F.pc) : vals("pc").map(pcLabelShort).join(", ") + " complete");
    if (F.q) parts.push("“" + F.q + "”");
    return parts.length ? "Within the page filters: " + parts.join(" · ") : "";
  }

  /* ---------- render ---------- */
  var current = [];
  function render() {
    fillFilters();
    pcR = vals("pc").map(pcRange).filter(Boolean);
    slSet = asSet("sl"); stSet = asSet("st");
    current = T.filter(matches);
    renderHint(current);
    renderSubtrade(current);
    renderLocations(current);
    renderProgress(current);
    var h = new URLSearchParams(location.hash.slice(1));
    Object.keys(F).forEach(function (k) { if (F[k]) h.set(k, F[k]); else h.delete(k); });
    try { history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }
  render();
})();
