/* Embed mode for the VisiLean 4D link viewer, appended to its published copy by the build (the viewer's
   own code is untouched). Only active when the address ends in #embed (the Overview page's model
   card); the 4D viewer tab opens the same file without it and gets the full viewer.
   In embed mode: header and side panels hidden, the 3D view fills the frame, coloured by status at
   today's date; an element's details float over the model when one is selected. Talks to the page
   around it (same origin) by messages:
     out  {type: "vl4d-ready", buildings: [name], levels: [[value, label]]}
          {type: "vl4d-legend", items: [{label, color, n, on}], shown: "12,707"}
     in   {type: "vl4d-filter", bld: "" | name, lvl: "" | value}
          {type: "vl4d-legend-toggle", index: n} */
(function () {
  "use strict";
  if (!/embed/.test(location.hash) || window.parent === window) return;
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  root.classList.add("vl-embed");
  var css = document.createElement("style");
  css.textContent =
    ".vl-embed .app{padding:0;grid-template-rows:1fr;gap:0}" +
    ".vl-embed header,.vl-embed .rail{display:none!important}" +
    ".vl-embed .main{grid-template-columns:minmax(0,1fr)!important;position:relative;height:100%}" +
    ".vl-embed .view{border:0;border-radius:0;height:100%!important;order:0!important}" +
    ".vl-embed body{overflow:hidden!important}" +
    ".vl-embed .drawer-wrap{display:none;position:absolute;right:12px;top:52px;width:min(340px,calc(100% - 24px));max-height:calc(100% - 64px);z-index:5;box-shadow:0 8px 24px rgba(0,0,0,.18)}" +
    ".vl-embed.vl-sel .drawer-wrap{display:block}";
  document.head.appendChild(css);
  function send(msg) { try { window.parent.postMessage(msg, location.origin); } catch (e) { /* no parent */ } }

  // colour by status, schedule date today
  var st = document.querySelector('#mode [data-m="status"]');
  if (st) st.click();
  if ($("todayBtn")) $("todayBtn").click();

  // the element details float over the model while something is selected
  function selState() { root.classList.toggle("vl-sel", /Selected element/.test($("drawer").textContent)); }
  new MutationObserver(selState).observe($("drawer"), { childList: true, subtree: true });
  $("clearBtn").addEventListener("click", function () { setTimeout(selState, 0); });

  // the legend (the viewer redraws it on every change) goes to the page
  function legend() {
    var items = Array.prototype.map.call($("legend").querySelectorAll("button.lg"), function (b) {
      var sw = b.querySelector(".sw"), sp = b.querySelectorAll("span");
      return { label: sp[1] ? sp[1].textContent : "", n: b.querySelector(".num") ? b.querySelector(".num").textContent : "",
        color: sw ? getComputedStyle(sw).backgroundColor : "", on: b.getAttribute("aria-pressed") !== "false" };
    });
    var shown = $("countTag").querySelector("b");
    send({ type: "vl4d-legend", items: items, shown: shown ? shown.textContent : "" });
  }
  new MutationObserver(legend).observe($("legend"), { childList: true, subtree: true, attributes: true });

  // filters from the page: one building (or all) and one level (or all)
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data) return;
    var d = e.data;
    if (d.type === "vl4d-filter") {
      Array.prototype.forEach.call($("bld").querySelectorAll("button.chip"), function (c) {
        var want = !!d.bld && c.textContent === d.bld;
        if ((c.getAttribute("aria-pressed") === "true") !== want) c.click();
      });
      if ($("lvl").value !== (d.lvl || "")) { $("lvl").value = d.lvl || ""; $("lvl").dispatchEvent(new Event("change")); }
      $("fitBtn").click();
    } else if (d.type === "vl4d-legend-toggle") {
      var b = $("legend").querySelectorAll("button.lg")[d.index];
      if (b) b.click();
    }
  });

  send({ type: "vl4d-ready", title: $("title") ? $("title").textContent : "",
    buildings: Array.prototype.map.call($("bld").querySelectorAll("button.chip"), function (c) { return c.textContent; }),
    levels: Array.prototype.filter.call($("lvl").options, function (o) { return o.value; }).map(function (o) { return [o.value, o.textContent]; }) });
  legend();
})();
