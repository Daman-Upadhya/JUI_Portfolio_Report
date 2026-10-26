/* A small WebGL2 viewer for the site model that build/ifc_model.py makes from the IFC: one binary
   file (positions as 16-bit fractions of the model's bounding box, then 32-bit triangle indices,
   sorted by category so each category is one draw range) and its JSON index. Flat shading comes
   from screen-space derivatives, so no normals are stored. No library.

   window.JUIModelViewer(container, base, index, opts)
     -> { setPins(pins), setMode("category" | "state"), setStates({element: "#rrggbb"}, {element: level}),
          setZones([{rect: [x0, x1, y0, y1], level, color}]), select(element), destroy() }
     base   folder of the files ("model/"), index the parsed JSON
     opts   { pinHtml(pin), onPick(element or -1, [x, y] model metres), tools: extra HTML for the top-right tool row }
   When the index has an element number per vertex, a click picks the element under the pointer
   (drawn once into an off-screen buffer with the number as its colour), and "state" mode colours
   each element from setStates (unlisted elements turn pale). An element given a level in setStates
   is coloured point by point instead: by the zone of that level it lies in (a pour of a slab). */
(function () {
  "use strict";

  /* ---------- tiny matrix helpers (column-major, like WebGL) ---------- */
  function persp(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(e, c, up) {
    var z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
    return o;
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function hex(c) { c = c.replace("#", ""); return [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255]; }

  var VS = "#version 300 es\n" +
    "in vec3 a;\nin uint e;\nuniform mat4 mvp;\nuniform vec3 bmin, bsize;\nout vec3 wp;\nflat out uint ve;\n" +
    "void main(){ wp = bmin + a * bsize; ve = e; gl_Position = mvp * vec4(wp, 1.0); }";
  /* mode 0: category colour; 1: state view, the element's colour from the state texture (alpha 1),
     or per zone of its level (alpha half), or not linked (alpha 0); 2 / 3: picking, the element
     number + 1, or the model point (x, y), as bytes. In the state view the linked elements are
     drawn solid first (pass 1), then the unlinked ones see-through (pass 2), and picking skips the
     unlinked ones (ghost 1) so a click reaches the linked elements behind them. */
  var FS = "#version 300 es\nprecision highp float;\nprecision highp int;\n" +
    "in vec3 wp;\nflat in uint ve;\nuniform vec3 col;\nuniform vec3 eye;\nuniform int mode;\nuniform int pass;\nuniform int ghost;\nuniform float galpha;\nuniform uint sel;\nuniform sampler2D st;\n" +
    "uniform vec3 bmin, bsize;\nuniform float clipz;\nuniform vec4 zr[24];\nuniform vec3 zc[24];\nuniform int zl[24];\nuniform int nz;\nout vec4 o;\n" +
    "bool zoned = false;\n" +
    "bool stateCol(out vec3 c) {\n" +
    "  vec4 t = texelFetch(st, ivec2(int(ve % 2048u), int(ve / 2048u)), 0);\n" +
    "  c = mix(col, vec3(0.9), 0.55);\n" +
    "  if (t.a > 0.75) { c = t.rgb; return false; }\n" +
    "  if (t.a > 0.25) { zoned = true;\n" +
    "    int lv = int(t.r * 255.0 + 0.5);\n" +
    "    for (int i = 0; i < 24; i++) { if (i >= nz) break; vec4 r = zr[i];\n" +
    "      if (zl[i] == lv && wp.x >= r.x && wp.x <= r.y && wp.y >= r.z && wp.y <= r.w) {\n" +
    "        float d = min(min(wp.x - r.x, r.y - wp.x), min(wp.y - r.z, r.w - wp.y));\n" +
    "        c = d < 0.3 ? zc[i] * 0.55 : zc[i]; return false; } }\n" +
    "  }\n" +
    "  return true;\n" +
    "}\n" +
    "void main(){\n" +
    "  if (wp.z > clipz) discard;\n" +
    "  vec3 sc = col; bool pale = false;\n" +
    "  if (mode == 1 || ghost == 1) pale = stateCol(sc);\n" +
    "  if (mode == 2) { if (ghost == 1 && pale) discard; uint k = ve + 1u; o = vec4(float(k & 255u), float((k >> 8) & 255u), float((k >> 16) & 255u), 255.0) / 255.0; return; }\n" +
    "  if (mode == 3) { if (ghost == 1 && pale) discard; vec2 q = clamp((wp.xy - bmin.xy) / bsize.xy, 0.0, 1.0) * 65535.0; uvec2 u = uvec2(q + 0.5);\n" +
    "    o = vec4(float(u.x >> 8), float(u.x & 255u), float(u.y >> 8), float(u.y & 255u)) / 255.0; return; }\n" +
    "  if (mode == 1) { if (pass == 1 && pale) discard; if (pass == 2 && !pale) discard; }\n" +
    "  vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));\n" +
    "  if (dot(n, eye - wp) < 0.0) n = -n;\n" +
    "  float k1 = max(dot(n, normalize(vec3(0.45, -0.35, 0.82))), 0.0);\n" +
    "  float k2 = max(dot(n, normalize(vec3(-0.6, 0.55, 0.3))), 0.0);\n" +
    "  float sky = 0.5 + 0.5 * n.z;\n" +
    "  vec3 base = mode == 1 ? sc : col;\n" +
    "  if (ve == sel && !(mode == 1 && zoned)) base = vec3(0.09, 0.58, 0.9);\n" +  // a slab in the pour plan keeps its pour colours
    "  vec3 c = base * (0.34 + 0.22 * sky + 0.52 * k1 + 0.16 * k2);\n" +
    "  float a = (mode == 1 && pale && ve != sel) ? galpha : 1.0;\n" +
    "  o = vec4(c * a, a);\n" +
    "}";

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var GHOST = 0.12;  // opacity of unlinked elements in the state view
  var NOOP = { setPins: function () {}, setMode: function () {}, setStates: function () {}, setZones: function () {}, setClip: function () {}, select: function () {}, destroy: function () {} };

  window.JUIModelViewer = function (box, base, idx, opts) {
    opts = opts || {};
    box.innerHTML = '<canvas class="mdl-cv" tabindex="0" aria-label="3D model of the site. Drag to turn, scroll to zoom, right-drag or shift-drag to pan, arrow keys to turn, plus and minus to zoom, 0 to reset."></canvas>' +
      '<div class="mdl-pins"></div><div class="mdl-msg" role="status">Loading the 3D model…</div>' +
      '<div class="mdl-tools">' + (opts.tools || "") + '<button type="button" class="mdl-btn" data-a="reset" title="Reset the view (0)">Reset view</button></div>' +
      '<div class="mdl-cats" role="group" aria-label="Show or hide categories"></div>';
    var cv = box.querySelector(".mdl-cv"), msg = box.querySelector(".mdl-msg"), pinsBox = box.querySelector(".mdl-pins");
    var gl = cv.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) { msg.textContent = "This browser cannot show the 3D model (WebGL 2 is off or not supported)."; return NOOP; }

    /* survey coordinates are far from 0 (hundreds of km): everything is drawn relative to the
       model's centre, or 32-bit floats would lose centimetres and the model would shimmer */
    var B = idx.bbox, origin = scl(add(B[0], B[1]), 0.5), bmin = sub(B[0], origin), bsize = sub(B[1], B[0]);
    var ctr = [0, 0, 0], radius = Math.hypot(bsize[0], bsize[1], bsize[2]) / 2;
    var V = idx.view || {};
    var HOME = { yaw: V.yaw != null ? V.yaw : -0.75, pitch: V.pitch != null ? V.pitch : 0.62, dist: radius * (V.zoom || 1.45), tgt: ctr.slice() };
    var cam = { yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist, tgt: HOME.tgt.slice() };
    var on = {};
    (idx.groups || []).forEach(function (g) { on[g.key] = g.hidden !== true; });
    var prog, vao, loc = {}, ready = false, dirty = true, raf = 0, pins = [], destroyed = false;
    var mode = 0, selected = 0xffffffff, stTex = null, hasIds = !!idx.elementOffset, pickFb = null, pickW = 0, pickH = 0;
    var zones = { r: new Float32Array(96), c: new Float32Array(72), l: new Int32Array(24), n: 0 }, clipZ = 1e9;

    /* categories: a chip per category, coloured like the model */
    var cats = box.querySelector(".mdl-cats");
    cats.innerHTML = (idx.groups || []).map(function (g) {
      return '<button type="button" class="mdl-cat" data-k="' + g.key + '" aria-pressed="' + on[g.key] + '"><i style="background:' + g.color + '"></i>' + g.label + "</button>";
    }).join("");
    cats.addEventListener("click", function (e) {
      var b = e.target.closest(".mdl-cat");
      if (!b) return;
      var k = b.getAttribute("data-k");
      on[k] = !on[k]; b.setAttribute("aria-pressed", String(on[k])); draw();
    });
    box.querySelector('[data-a="reset"]').addEventListener("click", function () { reset(); });

    function reset() { cam.yaw = HOME.yaw; cam.pitch = HOME.pitch; cam.dist = HOME.dist; cam.tgt = HOME.tgt.slice(); draw(); }
    function eye() {
      var cp = Math.cos(cam.pitch);
      return add(cam.tgt, [cam.dist * cp * Math.cos(cam.yaw), cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch)]);
    }
    function matrices() {
      var e = eye(), near = Math.max(cam.dist / 400, 0.05), far = cam.dist + radius * 3;
      return { mvp: mul(persp(0.75, cv.width / Math.max(1, cv.height), near, far), lookAt(e, cam.tgt, [0, 0, 1])), eye: e };
    }
    function draw() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    }
    function frame() {
      raf = 0;
      if (destroyed || !dirty) return;
      dirty = false;
      size();
      var M = matrices();
      if (ready) {
        gl.viewport(0, 0, cv.width, cv.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(M.mvp));
        drawScene(M, mode);
      }
      placePins(M.mvp);
    }
    function drawScene(M, m) {
      gl.uniformMatrix4fv(loc.mvp, false, new Float32Array(M.mvp));
      gl.uniform3fv(loc.bmin, bmin); gl.uniform3fv(loc.bsize, bsize); gl.uniform3fv(loc.eye, M.eye);
      gl.uniform1i(loc.mode, m); gl.uniform1ui(loc.sel, selected);
      gl.uniform1i(loc.ghost, mode === 1 ? 1 : 0); gl.uniform1f(loc.galpha, GHOST);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex); gl.uniform1i(loc.st, 0);
      gl.uniform1f(loc.clipz, clipZ);
      gl.uniform4fv(loc.zr, zones.r); gl.uniform3fv(loc.zc, zones.c); gl.uniform1iv(loc.zl, zones.l); gl.uniform1i(loc.nz, zones.n);
      function all() {
        (idx.groups || []).forEach(function (g) {
          if (!on[g.key] || !g.count) return;
          gl.uniform3fv(loc.col, g.rgb || (g.rgb = hex(g.color)));
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.first * 4);
        });
      }
      if (m !== 1) { gl.uniform1i(loc.pass, 0); all(); return; }
      gl.uniform1i(loc.pass, 1); all();                      // linked: solid
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.uniform1i(loc.pass, 2); all();                      // not linked: see-through over them
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    /* the element under a pointer position: draw the numbers off-screen, read one pixel */
    function pick(clientX, clientY) {
      if (!ready || !hasIds) return -1;
      size();
      var w = cv.width, h = cv.height, r = cv.getBoundingClientRect();
      if (!pickFb || pickW !== w || pickH !== h) {
        if (pickFb) gl.deleteFramebuffer(pickFb);
        pickFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, pickFb);
        var cb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, cb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, cb);
        var db = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
        pickW = w; pickH = h;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFb);
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      var M = matrices(), px = new Uint8Array(4), x = Math.round((clientX - r.left) / r.width * w), y = Math.round((1 - (clientY - r.top) / r.height) * h);
      x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
      drawScene(M, 2);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var k = px[0] + (px[1] << 8) + (px[2] << 16), at = null;
      if (k) {  // a second pass gives the model point (x, y) under the pointer
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawScene(M, 3);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        at = [origin[0] + bmin[0] + ((px[0] << 8) + px[1]) / 65535 * bsize[0], origin[1] + bmin[1] + ((px[2] << 8) + px[3]) / 65535 * bsize[1]];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      draw();
      return { el: k ? k - 1 : -1, at: at };
    }
    /* HTML markers that follow 3D points */
    function placePins(mvp) {
      var r = cv.getBoundingClientRect();
      pins.forEach(function (p) {
        var x = p.at[0], y = p.at[1], z = p.at[2];
        var cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12], cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13], cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
        var vis = cw > 0 && Math.abs(cx / cw) < 1.05 && Math.abs(cy / cw) < 1.05;
        p.el.hidden = !vis;
        if (vis) { p.el.style.left = ((cx / cw + 1) / 2 * r.width) + "px"; p.el.style.top = ((1 - cy / cw) / 2 * r.height) + "px"; }
      });
    }

    /* ---------- input: drag to turn, right / shift drag to pan, wheel or pinch to zoom ---------- */
    var drag = null, pts = {};
    function panBy(dx, dy) {
      var f = norm(sub(cam.tgt, eye())), right = norm(cross(f, [0, 0, 1])), up = cross(right, f);
      var k = cam.dist * 0.0013;
      cam.tgt = add(cam.tgt, add(scl(right, -dx * k), scl(up, dy * k)));
    }
    function zoomBy(f) { cam.dist = Math.max(radius * 0.03, Math.min(radius * 6, cam.dist * f)); }
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      cv.setPointerCapture(e.pointerId);
      pts[e.pointerId] = [e.clientX, e.clientY];
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pan: e.button === 2 || e.shiftKey || e.ctrlKey };
    });
    cv.addEventListener("pointermove", function (e) {
      if (!drag || !pts[e.pointerId]) return;
      var ids = Object.keys(pts);
      if (ids.length === 2) {  // pinch: zoom, and pan by the moving finger
        var o = pts[ids[0] === String(e.pointerId) ? ids[1] : ids[0]], prev = pts[e.pointerId];
        var d0 = Math.hypot(prev[0] - o[0], prev[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0 && d1 > 0) zoomBy(d0 / d1);
        panBy((e.clientX - prev[0]) / 2, (e.clientY - prev[1]) / 2);
      } else {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (drag.pan) panBy(dx, dy);
        else { cam.yaw -= dx * 0.008; cam.pitch = Math.max(0.05, Math.min(1.53, cam.pitch + dy * 0.006)); }
      }
      drag.x = e.clientX; drag.y = e.clientY; pts[e.pointerId] = [e.clientX, e.clientY];
      draw();
    });
    function up(e) {
      var click = drag && e.type === "pointerup" && e.button === 0 && Object.keys(pts).length === 1 && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5;
      delete pts[e.pointerId];
      if (!Object.keys(pts).length) drag = null;
      if (click && opts.onPick) { var pk = pick(e.clientX, e.clientY); opts.onPick(pk === -1 ? -1 : pk.el, pk === -1 ? null : pk.at); }
    }
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0012)); draw(); }, { passive: false });
    cv.addEventListener("dblclick", reset);
    cv.addEventListener("keydown", function (e) {
      var k = e.key, used = true;
      if (k === "ArrowLeft") cam.yaw += 0.12; else if (k === "ArrowRight") cam.yaw -= 0.12;
      else if (k === "ArrowUp") cam.pitch = Math.min(1.53, cam.pitch + 0.08); else if (k === "ArrowDown") cam.pitch = Math.max(0.05, cam.pitch - 0.08);
      else if (k === "+" || k === "=") zoomBy(0.85); else if (k === "-" || k === "_") zoomBy(1 / 0.85);
      else if (k === "0") reset(); else used = false;
      if (used) { e.preventDefault(); draw(); }
    });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { draw(); }) : null;
    if (ro) ro.observe(cv); else window.addEventListener("resize", draw);

    /* ---------- load ---------- */
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      ["mvp", "bmin", "bsize", "col", "eye", "mode", "sel", "st", "nz", "clipz", "pass", "ghost", "galpha"].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
      loc.zr = gl.getUniformLocation(prog, "zr[0]"); loc.zc = gl.getUniformLocation(prog, "zc[0]"); loc.zl = gl.getUniformLocation(prog, "zl[0]");
    } catch (err) { msg.textContent = "The 3D model could not start: " + err.message; return NOOP; }
    fetch(base + idx.file).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      if (destroyed) return;
      var pos = new Uint16Array(ab, 0, idx.vertices * 3), ind = new Uint32Array(ab, idx.indexOffset, idx.indices);
      vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      var a = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.UNSIGNED_SHORT, true, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STATIC_DRAW);
      var ea = gl.getAttribLocation(prog, "e");
      if (hasIds) {
        var u16 = idx.elementType === "u16", ids = u16 ? new Uint16Array(ab, idx.elementOffset, idx.vertices) : new Uint32Array(ab, idx.elementOffset, idx.vertices);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(ea); gl.vertexAttribIPointer(ea, 1, u16 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, 0, 0);
      } else gl.vertexAttribI4ui(ea, 0xffffffe, 0, 0, 0);
      stTex = gl.createTexture(); setStates(pendingStates || {}, pendingZoneEls || {});
      gl.enable(gl.DEPTH_TEST);
      ready = true; msg.hidden = true; box.classList.add("is-ready");
      draw();
    }).catch(function (err) {
      msg.textContent = location.protocol === "file:" ? "The 3D model loads when the report is served (python -m build serve), not from a file on disk." : "The 3D model could not be loaded (" + err.message + ").";
    });

    /* per-element colours for "state" mode: a 2048-wide RGBA texture indexed by element number */
    var pendingStates = null;
    var pendingZoneEls = null;
    function setStates(map, zoneEls) {
      if (!stTex) { pendingStates = map; pendingZoneEls = zoneEls; return; }
      var n = Math.max(1, idx.elements || 1), rows = Math.ceil(n / 2048), data = new Uint8Array(2048 * rows * 4);
      Object.keys(map || {}).forEach(function (k) {
        var i = +k, c = hex(map[k]);
        if (i >= 0 && i < n) { data[i * 4] = c[0] * 255; data[i * 4 + 1] = c[1] * 255; data[i * 4 + 2] = c[2] * 255; data[i * 4 + 3] = 255; }
      });
      Object.keys(zoneEls || {}).forEach(function (k) {  // coloured by zone: the level in red, alpha half
        var i = +k;
        if (i >= 0 && i < n && !map[k]) { data[i * 4] = zoneEls[k]; data[i * 4 + 3] = 128; }
      });
      gl.bindTexture(gl.TEXTURE_2D, stTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2048, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      draw();
    }

    return {
      setMode: function (m) { mode = m === "state" ? 1 : 0; draw(); },
      setClip: function (z) { clipZ = z == null ? 1e9 : z - origin[2]; draw(); },
      setZones: function (list) {
        zones.n = 0;
        (list || []).slice(0, 24).forEach(function (z, i) {
          var c = hex(z.color);
          zones.r.set([z.rect[0] - origin[0], z.rect[1] - origin[0], z.rect[2] - origin[1], z.rect[3] - origin[1]], i * 4);
          zones.c.set(c, i * 3); zones.l[i] = z.level; zones.n = i + 1;
        });
        draw();
      },
      setStates: setStates,
      select: function (i) { selected = i == null || i < 0 ? 0xffffffff : i; draw(); },
      setPins: function (list) {
        pinsBox.innerHTML = "";
        pins = (list || []).filter(function (p) { return p.at; }).map(function (p) {
          var d = document.createElement("div");
          d.className = "mdl-pin";
          d.innerHTML = opts.pinHtml ? opts.pinHtml(p) : "";
          pinsBox.appendChild(d);
          return { at: sub(p.at, origin), el: d };
        });
        draw();
      },
      destroy: function () { destroyed = true; if (ro) ro.disconnect(); var ext = gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); }
    };
  };
})();
