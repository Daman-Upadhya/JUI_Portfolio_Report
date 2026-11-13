/* 4D viewer page: the VisiLean 4D link viewer (made by the visilean-4d-link skill), published as it is
   to dist/<key>/4d/ with its task status refreshed by the build (metrics.scurve.fourD). It is about
   3 MB, so the frame loads only when the tab first opens; the dashboard's light / dark theme is
   passed into it (same origin). */
(function () {
  "use strict";
  var P = JSON.parse(document.getElementById("data").textContent);
  var FD = P.metrics && P.metrics.scurve && P.metrics.scurve.fourD, LOC = (P.meta || {}).locale || "en-IN";
  function $(id) { return document.getElementById(id); }
  if (!FD || !$("pg-4d")) return;
  $("tab-4d").hidden = false;
  var nf0 = new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 });
  $("fd-title").textContent = FD.title;
  $("fd-desc").textContent = "Model elements linked to their schedule activities (" + nf0.format(FD.elements || 0) + " elements, " + nf0.format(FD.tasks) +
    " activities). Activity status and planned dates refreshed from the master schedule on " + FD.snapshot + "; colour by 4D plan, VisiLean status, module, level or group, play the date slider, and select an element for its activities.";
  $("fd-open").href = FD.file;
  var frame = $("fd-frame"), loaded = false;

  /* the dashboard's light / dark theme, passed into a frame (same origin) */
  function themeOf(f) {
    try {
      var d = f.contentDocument;
      if (d && d.documentElement) d.documentElement.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") || "light");
    } catch (e) { /* not same origin (file://): the viewer keeps its own theme */ }
  }
  function load() {
    if (loaded) return;
    loaded = true;
    frame.addEventListener("load", function () { themeOf(frame); });
    frame.src = FD.file;
  }
  document.addEventListener("jui:page", function (e) { if (e.detail === "4d") load(); });
  if (!$("pg-4d").hidden) load();

  /* ---------- Overview: the linked model in place of the site model (the viewer's #embed mode) ----------
     coloured by status today; Building and Level slicers and the legend here drive the viewer */
  var card = $("l4d-card"), lf = $("l4d-frame");
  if (card && lf) {
    card.hidden = false;
    if ($("m3d-card")) $("m3d-card").hidden = true;
    var F = { bld: "", lvl: "" }, opts = null;
    lf.addEventListener("load", function () { themeOf(lf); });
    lf.src = FD.file + "#embed";
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var tell = function (msg) { try { lf.contentWindow.postMessage(msg, location.origin); } catch (e) { /* not loaded */ } };
    var seg = function (id, list, key) {
      $(id).innerHTML = [["", "All"]].concat(list).map(function (o) {
        return '<button type="button" data-v="' + esc(o[0]) + '" aria-pressed="' + (F[key] === o[0]) + '">' + esc(o[1]) + "</button>";
      }).join("");
    };
    var slicers = function () {
      if (!opts) return;
      seg("l4d-bld", opts.buildings.map(function (b) { return [b, b]; }), "bld");
      seg("l4d-lvl", opts.levels, "lvl");
    };
    [["l4d-bld", "bld"], ["l4d-lvl", "lvl"]].forEach(function (x) {
      $(x[0]).addEventListener("click", function (e) {
        var b = e.target.closest("button[data-v]");
        if (!b) return;
        F[x[1]] = b.getAttribute("data-v");
        slicers();
        tell({ type: "vl4d-filter", bld: F.bld, lvl: F.lvl });
      });
    });
    $("l4d-leg").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-i]");
      if (b) tell({ type: "vl4d-legend-toggle", index: +b.getAttribute("data-i") });
    });
    $("l4d-open").addEventListener("click", function () { if ($("tab-4d")) $("tab-4d").click(); });
    window.addEventListener("message", function (e) {
      if (e.source !== lf.contentWindow || !e.data) return;
      var d = e.data;
      if (d.type === "vl4d-ready") {
        opts = d;
        if (d.title) $("h-l4d").textContent = d.title;
        slicers();
      } else if (d.type === "vl4d-legend") {
        $("l4d-leg").innerHTML = d.items.map(function (it, i) {
          return '<button type="button" data-i="' + i + '" aria-pressed="' + it.on + '" title="Show or hide ' + esc(it.label) + '"><i style="background:' + esc(it.color) + '"></i>' +
            esc(it.label) + " <b>" + esc(it.n) + "</b></button>";
        }).join("") + '<span class="l4d-n">' + esc(d.shown) + " elements shown</span>";
      }
    });
  }

  // the dashboard's theme button: follow it inside the frames
  new MutationObserver(function () { themeOf(frame); if (lf) themeOf(lf); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
