/* A dropdown of checkboxes for the pages' multi-value filters (Overview and Site progress areas), the
   same look as the Quantity tracking page's (.ms / .ms-btn / .ms-pop in Dashboard.html).
   window.JUIMulti(box, items, on, allLabel, onChange)
     box       the .ms element; it is redrawn on every call (the page calls again after onChange)
     items     [[value, label, count]]; on: the selected values; onChange(list): the new selection in items order
   The open state, the search text and the focused box survive the redraw. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var nf = new Intl.NumberFormat("en-IN");
  window.JUIMulti = function (box, items, on, allLabel, onChange) {
    var set = {}, names = {};
    on.forEach(function (v) { set[v] = true; });
    items.forEach(function (it) { names[it[0]] = it[1]; });
    var a = document.activeElement, focus = null;
    if (a && box.contains(a)) focus = a.type === "checkbox" ? "cb:" + a.value : a.getAttribute("data-act") ? "act:" + a.getAttribute("data-act") : a.classList.contains("ms-find") ? "find" : "btn";
    var label = !on.length ? allLabel : (names[on[0]] || on[0]) + (on.length > 1 ? " +" + (on.length - 1) : "");
    var q = (box._q || "").toLowerCase(), open = !!box._open;
    var shown = items.filter(function (it) { return !q || String(it[1]).toLowerCase().indexOf(q) >= 0; });
    box.innerHTML = '<button type="button" class="ms-btn' + (on.length ? " on" : "") + '" aria-haspopup="true" aria-expanded="' + open + '" title="' + esc(on.map(function (v) { return names[v] || v; }).join(", ") || allLabel) + '">' +
      '<span class="ms-lbl">' + esc(label) + "</span></button>" +
      '<div class="ms-pop"' + (open ? "" : " hidden") + ' role="group" aria-label="' + esc(allLabel) + '">' +
      '<div class="ms-acts"><button type="button" data-act="all">Select all' + (q ? " shown" : "") + '</button><button type="button" data-act="none"' + (on.length ? "" : " disabled") + ">Clear</button></div>" +
      (items.length > 8 ? '<input type="search" class="ms-find" placeholder="Search…" aria-label="Search ' + esc(allLabel.toLowerCase()) + '" value="' + esc(box._q || "") + '">' : "") +
      '<div class="ms-list">' + (shown.length ? shown.map(function (it) {
        return '<label class="ms-opt"><input type="checkbox" value="' + esc(it[0]) + '"' + (set[it[0]] ? " checked" : "") + "><span>" + esc(it[1]) + "</span>" + (it[2] != null ? "<small>" + nf.format(it[2]) + "</small>" : "") + "</label>";
      }).join("") : '<div class="ms-none">No matches</div>') + "</div></div>";
    function ordered(list) { return items.map(function (it) { return it[0]; }).filter(function (v) { return list.indexOf(v) >= 0; }); }
    box._redraw = function () { window.JUIMulti(box, items, on, allLabel, onChange); };
    box.querySelector(".ms-btn").addEventListener("click", function () {
      box._open = !box._open; box._redraw();
      var f = box.querySelector(box._open ? ".ms-find, .ms-opt input" : ".ms-btn"); if (f) f.focus();
    });
    box.querySelectorAll(".ms-opt input").forEach(function (c) {
      c.addEventListener("change", function () {
        var now = on.filter(function (v) { return v !== c.value; });
        if (c.checked) now.push(c.value);
        onChange(ordered(now));
      });
    });
    box.querySelector('[data-act="all"]').addEventListener("click", function () {
      var now = on.slice(); shown.forEach(function (it) { if (now.indexOf(it[0]) < 0) now.push(it[0]); }); onChange(ordered(now));
    });
    box.querySelector('[data-act="none"]').addEventListener("click", function () { onChange([]); });
    var find = box.querySelector(".ms-find");
    if (find) find.addEventListener("input", function () { box._q = find.value; box._redraw(); var f = box.querySelector(".ms-find"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); });
    if (focus) {
      var el = focus.indexOf("cb:") === 0 ? Array.prototype.find.call(box.querySelectorAll(".ms-opt input"), function (c) { return c.value === focus.slice(3); })
        : focus.indexOf("act:") === 0 ? box.querySelector('[data-act="' + focus.slice(4) + '"]') : focus === "find" ? box.querySelector(".ms-find") : box.querySelector(".ms-btn");
      if (el && !el.disabled) el.focus();
    }
    if (!box._wired) {
      box._wired = true;
      document.addEventListener("click", function (e) { if (box._open && document.contains(e.target) && !box.contains(e.target)) { box._open = false; box._redraw(); } });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && box._open) { box._open = false; box._redraw(); box.querySelector(".ms-btn").focus(); } });
    }
  };
})();
