/* Hide a visual: every titled card (or package section) gets a small hide button beside its title.
   Hidden visuals are listed at the top of their page, each with a Show button, plus Show all.
   The choice is per viewer, kept in this browser only (localStorage), and never affects the data.
   Runs after the page scripts and tabs.js, once the info icons are in the titles. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var P = {};
  try { P = JSON.parse($("data").textContent); } catch (e) { /* no payload */ }
  var STORE = "jui-hidden-visuals:" + ((P.meta && P.meta.key) || "JUI");
  var hidden = {};
  try { (JSON.parse(localStorage.getItem(STORE) || "[]") || []).forEach(function (k) { hidden[k] = true; }); } catch (e) { /* storage blocked: nothing hidden */ }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(Object.keys(hidden))); } catch (e) { /* storage blocked: this visit only */ } }

  var EYE_OFF = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.4 8 2.9 10.1 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5.1-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var EYE = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  function titleOf(h) {
    var c = h.cloneNode(true);
    c.querySelectorAll("button").forEach(function (b) { b.remove(); });
    return c.textContent.trim();
  }
  var cards = [];  // {el, key, title, page}
  document.querySelectorAll(".page").forEach(function (pg) {
    pg.querySelectorAll(".card, .pk").forEach(function (el) {
      if (el.parentNode.closest(".card, .pk")) return;  // only outer visuals
      var h = el.querySelector(":scope > .card-head h2, :scope > .pk-head h2");
      if (!h) return;
      var title = titleOf(h);
      var key = pg.id + ":" + (h.id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      var b = document.createElement("button");
      b.type = "button"; b.className = "hide-i";
      b.title = "Hide this visual"; b.setAttribute("aria-label", "Hide " + title);
      b.innerHTML = EYE_OFF;
      b.addEventListener("click", function () { hidden[key] = true; save(); apply(pg.id); });
      h.appendChild(b);
      cards.push({ el: el, key: key, title: title, page: pg });
    });
  });
  if (!cards.length) return;

  /* the bar listing a page's hidden visuals, under its filters */
  document.querySelectorAll(".page").forEach(function (pg) {
    var bar = document.createElement("div");
    bar.className = "hid-bar"; bar.id = "hid-" + pg.id; bar.hidden = true;
    bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Hidden visuals");
    var after = pg.querySelector(":scope > .fhint") || pg.querySelector(":scope > .fbar");
    if (after) after.after(bar); else pg.prepend(bar);
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-k], button[data-all]");
      if (!b) return;
      if (b.hasAttribute("data-all")) cards.forEach(function (c) { if (c.page === pg) delete hidden[c.key]; });
      else delete hidden[b.getAttribute("data-k")];
      save(); apply(pg.id, b.getAttribute("data-k"));
    });
  });

  function apply(focusPage, shownKey) {
    cards.forEach(function (c) { c.el.classList.toggle("is-user-hidden", !!hidden[c.key]); });
    /* rows of cards close up around a hidden one; an emptied stack goes too */
    document.querySelectorAll(".page .stack").forEach(function (st) {
      var kids = Array.prototype.filter.call(st.children, function (k) { return k.matches(".card, .pk"); });
      st.classList.toggle("is-user-hidden", kids.length > 0 && kids.every(function (k) { return k.classList.contains("is-user-hidden"); }));
    });
    document.querySelectorAll(".page .row3, .page .row21, .page .row2").forEach(function (row) {
      var vis = Array.prototype.filter.call(row.children, function (k) { return !k.classList.contains("is-user-hidden"); }).length;
      row.classList.toggle("is-one", vis === 1);
      row.classList.toggle("is-two", vis === 2 && row.classList.contains("row3"));
      row.classList.toggle("is-user-hidden", vis === 0);
    });
    document.querySelectorAll(".page").forEach(function (pg) {
      var bar = $("hid-" + pg.id), hs = cards.filter(function (c) { return c.page === pg && hidden[c.key]; });
      bar.hidden = !hs.length;
      bar.innerHTML = hs.length ? '<span class="hid-l">' + hs.length + " hidden " + (hs.length === 1 ? "visual" : "visuals") + "</span>" +
        hs.map(function (c) { return '<button type="button" class="hid-chip" data-k="' + esc(c.key) + '" title="Show ' + esc(c.title) + '">' + EYE + "<span>" + esc(c.title) + "</span></button>"; }).join("") +
        (hs.length > 1 ? '<button type="button" class="hid-all" data-all="1">Show all</button>' : "") : "";
    });
    if (focusPage) {
      var pg = $(focusPage);
      /* charts size themselves to their card, which may now be wider or back: let the page redraw */
      if (!pg.hidden) document.dispatchEvent(new CustomEvent("jui:page", { detail: focusPage.replace(/^pg-/, "") }));
      var f = shownKey ? cards.find(function (c) { return c.key === shownKey; }) : null;
      if (f) { f.el.scrollIntoView({ block: "nearest" }); var hb = f.el.querySelector(".hide-i"); if (hb) hb.focus(); }
      else { var first = $("hid-" + focusPage).querySelector("button"); if (first) first.focus(); }
    }
  }
  /* a link that jumps to a hidden visual (the S-curve page's "see the link to execution") shows it first */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("#s-tojoin");
    var c = b && cards.find(function (x) { return x.key === "pg-scurve:h-join"; });
    if (c && hidden[c.key]) { delete hidden[c.key]; save(); apply(); }
  }, true);
  apply();
})();
