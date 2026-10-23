/* Page tabs. Runs after the page scripts, which unhide the tabs they fill. The open page is kept
   in the URL as p=; every switch announces itself with a "jui:page" event so a page can redraw
   what needs its real width (the S-curve chart). */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var tabs = $("tabs");
  if (!tabs) return;
  function available() {
    return Array.prototype.filter.call(tabs.querySelectorAll("[data-p]"), function (b) { return !b.hidden; }).map(function (b) { return b.getAttribute("data-p"); });
  }
  var page = "qty";
  try { page = new URLSearchParams(location.hash.slice(1)).get("p") || "qty"; } catch (e) { /* bad hash */ }
  function show(p, focusTab) {
    var ps = available();
    page = ps.indexOf(p) >= 0 ? p : "qty";
    tabs.querySelectorAll("[data-p]").forEach(function (b) {
      var k = b.getAttribute("data-p"), on = k === page, pg = $("pg-" + k);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (pg) pg.hidden = !on;
    });
    var mast = $("appbar") ? $("appbar").offsetHeight : 0;  // the tab bar sticks under the masthead: start the new page at its top
    if (window.scrollY > mast) window.scrollTo(0, mast);
    if (focusTab) $("tab-" + page).focus();
    if ($("tip")) $("tip").classList.remove("on");
    var h = new URLSearchParams(location.hash.slice(1));
    if (page === "qty") h.delete("p"); else h.set("p", page);
    try { history.replaceState(null, "", h.toString() ? "#" + h.toString() : location.pathname + location.search); } catch (e) { /* file:// */ }
    document.dispatchEvent(new CustomEvent("jui:page", { detail: page }));
  }
  tabs.addEventListener("click", function (e) { var b = e.target.closest("[data-p]"); if (b) show(b.getAttribute("data-p")); });
  tabs.addEventListener("keydown", function (e) {
    var ps = available(), i = ps.indexOf(page), n = ps.length;
    var to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to >= 0) { e.preventDefault(); show(ps[to], true); }
  });
  show(page);
})();
