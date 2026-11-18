/*!
 * glyphfield - text as a living particle field. MIT (c) Soheil Tahmasbi
 *
 * Zero dependencies. Text is drawn by the browser's own canvas (so Persian and
 * Arabic are shaped, joined and bidi-ordered by the platform), sampled into
 * points, and each particle springs towards one of them.
 *
 * The named exports other than `glyphfield` are the pure parts (no DOM) and are
 * covered by `node --test`.
 */

/* ----------------------------------------------------------------- pure -- */

export const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LETTER = /\p{L}/u;

/** True if the text contains any right-to-left letter (picks the font stack). */
export const hasRTL = s => RTL.test(s);

/** First-strong direction, as the Unicode bidi algorithm would pick it. */
export function isRTL(s) {
  for (const ch of s) if (LETTER.test(ch) || RTL.test(ch)) return RTL.test(ch);
  return false;
}

/**
 * Collect the "ink" pixels of an RGBA buffer.
 * @returns {{pts: Float32Array, box: number[], m: number}} x,y pairs, bounding box
 *          [minX, minY, maxX, maxY] and the number of points.
 */
export function samplePoints(rgba, W, H, step = 2, thr = 140) {
  const out = [];
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step)
      if (rgba[(y * W + x) * 4 + 3] > thr) {
        out.push(x, y);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  return {pts: Float32Array.from(out), box: x1 < 0 ? [0, 0, 1, 1] : [x0, y0, x1, y1], m: out.length / 2};
}

/** Scale that fits a sampled box inside `view` ({w,h}) using the `fill` fractions [w,h]. */
export function layoutScale(box, view, fill = [.8, .5]) {
  const tw = box[2] - box[0] + 1, th = box[3] - box[1] + 1;
  return Math.min(view.w * fill[0] / tw, view.h * fill[1] / th);
}

/** Pixel points -> centred world points (y up), scaled by s and lifted by oy. */
export function toWorld(pts, box, s, oy = 0) {
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, o = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    o[i] = (pts[i] - cx) * s;
    o[i + 1] = -(pts[i + 1] - cy) * s + oy;
  }
  return o;
}

/**
 * Give each of N particles one of M points. Particles are visited in random
 * order so that when M > N the kept subset is spread evenly over the glyph, and
 * when M < N points are shared round-robin.
 * @returns {Uint32Array} src[i] = point index for particle i
 */
export function assign(M, N, rand = Math.random) {
  const order = new Uint32Array(N).map((_, i) => i), src = new Uint32Array(N);
  for (let i = N - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0, t = order[i];
    order[i] = order[j]; order[j] = t;
  }
  for (let k = 0; k < N; k++) src[order[k]] = M > N ? Math.floor(k * M / N) : k % M;
  return src;
}

/**
 * Advance the spring simulation by dt seconds. Mutates s.P / s.V.
 * s: {P, V, G, A|null, R, n}  (xyz strides for P,V,G,A; xy for R). z = presence 0..1.
 * o: {mx, my, on, rad, lr, t, sc, spread, amp}
 */
export function step(s, dt, o) {
  const {P, V, G, A, R, n} = s, k = Math.min(3, dt * 60), damp = Math.pow(.87, k), f = .045 * k;
  const {mx, my, on, rad, lr, t, sc, spread, amp} = o, L2 = lr * lr, L1 = L2 * .3025, R2 = rad * rad;
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    let gx = G[a] + R[i * 2] * sc * spread + Math.sin(t * 1.3 + i * .37) * amp,
        gy = G[a + 1] + R[i * 2 + 1] * sc * spread + Math.cos(t * 1.1 + i) * amp,
        gz = 1 - sc * .85;
    if (on && A) { // translator lens: the alt word shows through a soft disc
      const ex = A[a] - mx, ey = A[a + 1] - my, w2 = smoothstep(L2, L1, ex * ex + ey * ey);
      const fx = G[a] - mx, fy = G[a + 1] - my, w1 = smoothstep(L2, L1, fx * fx + fy * fy);
      if (w2 > 0) { gx += (A[a] - G[a]) * w2; gy += (A[a + 1] - G[a + 1]) * w2; }
      else if (w1 > 0) gz *= 1 - w1;
    }
    V[a] += (gx - P[a]) * f; V[a + 1] += (gy - P[a + 1]) * f; V[a + 2] += (gz - P[a + 2]) * f;
    if (on && !A) { // pointer repulsion
      const dx = P[a] - mx, dy = P[a + 1] - my, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        const d = Math.sqrt(d2) + 1e-4, fr = (1 - d / rad) * rad * .15 * k;
        V[a] += dx / d * fr; V[a + 1] += dy / d * fr;
      }
    }
    V[a] *= damp; V[a + 1] *= damp; V[a + 2] *= damp;
    P[a] += V[a] * k; P[a + 1] += V[a + 1] * k; P[a + 2] += V[a + 2] * k;
  }
}

/**
 * Word scheduler with injectable timers. Pausing cancels the timer (nothing
 * wakes up while hidden or offscreen); resuming waits a full interval.
 */
export function createCycle(words, ms, apply, timers = {setTimeout: (f, m) => setTimeout(f, m), clearTimeout: h => clearTimeout(h)}) {
  let i = -1, h = null, on = false, paused = false;
  const arm = () => { h = timers.setTimeout(tick, ms); };
  const clear = () => { if (h !== null) timers.clearTimeout(h); h = null; };
  function tick() {
    h = null;
    if (!on || paused) return;
    i = (i + 1) % words.length;
    apply(words[i], i);
    arm();
  }
  return {
    start() { if (on || !words.length) return; on = true; if (paused) return; tick(); },
    stop() { on = false; clear(); },
    pause(v) {
      if (v === paused) return;
      paused = v;
      if (v) clear(); else if (on && h === null) arm();
    },
    get index() { return i; },
    get running() { return on && !paused; }
  };
}

/* ------------------------------------------------------------------ DOM -- */

const VS = `attribute vec3 aP;attribute vec3 aC;attribute float aS;uniform vec2 uV;uniform float uD,uSz,uSc;varying vec4 vC;
void main(){float z=clamp(aP.z,0.,1.);gl_Position=vec4(aP.x/uV.x,aP.y/uV.y,0.,1.);gl_PointSize=max(1.,uSz*uD*aS*(.3+.7*z));
vC=vec4(aC,z*(1.-uSc*.6));}`;
const FS = `precision mediump float;varying vec4 vC;
void main(){float d=length(gl_PointCoord-.5),a=smoothstep(.5,.12,d);a*=(.55+.45*a)*vC.a;gl_FragColor=vec4(vC.rgb*a,a);}`;

const DEFAULTS = {
  colors: ['#7c8cff', '#4fe0d0', '#ffd479'],
  font: 'system-ui, sans-serif',
  rtlFont: 'Vazirmatn, "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif',
  weight: 800, fill: [.8, .5], maxDpr: 2, blend: 'add', interact: true, spread: .7
};

/**
 * @param {HTMLCanvasElement} cv
 * @param {object} [opts] count, colors, font, rtlFont, weight, fill, maxDpr, blend ('add'|'normal'),
 *                        interact, spread, lens: {alt: object|function, radius: px}
 */
export function glyphfield(cv, opts = {}) {
  if (!cv || typeof cv.getContext !== 'function') throw new TypeError('glyphfield: expected a <canvas>');
  const o = {...DEFAULTS, ...opts}, lens = o.lens || null;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const cache = new Map();
  let gl, g2, prog, U, buf, pbuf;
  let reduce = mq.matches, vis = !document.hidden, inView = true, dead = false;
  let view = {w: 300, h: 150}, dpr = 1, n = 0, S, col, sz, ci, dot = 3;
  let cyc = null, word = '', token = 0, raf = 0, last = 0, t = 0, sc = 0, uS = 0, rs = 0, painted = false;
  const ptr = {x: 0, y: 0, on: false};
  const rgb = [];
  const renderer = {kind: 'none'};

  /* colours: any CSS colour, resolved by the browser itself */
  {
    const x = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
    for (const c of o.colors) {
      x.clearRect(0, 0, 1, 1); x.fillStyle = '#fff'; x.fillStyle = c; x.fillRect(0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data; rgb.push([d[0] / 255, d[1] / 255, d[2] / 255]);
    }
  }
  const css = rgb.map(c => `rgb(${c.map(v => Math.round(v * 255))})`);
  const ramp = (u, out) => {
    const p = u * (rgb.length - 1), i = Math.min(rgb.length - 2, p | 0), f = p - i, a = rgb[i], b = rgb[i + 1] || a;
    for (let k = 0; k < 3; k++) out[k] = a[k] + ((b[k] || a[k]) - a[k]) * f;
  };

  cv.setAttribute('role', 'img');

  /* ---- fonts + rasterising ---- */
  const family = text => hasRTL(text) ? `${o.rtlFont}, ${o.font}` : o.font;
  const ready = text => {
    const f = document.fonts;
    return f && f.load ? f.load(`${o.weight} 100px ${family(text)}`, text).catch(() => 0) : Promise.resolve();
  };
  function raster(text) {
    const key = o.weight + family(text) + '|' + text;
    let r = cache.get(key);
    if (r) return r;
    const W = 1400, H = 420, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', {willReadFrequently: true});
    let fs = 240;
    x.font = `${o.weight} ${fs}px ${family(text)}`;
    fs = Math.min(fs, fs * W * .94 / (x.measureText(text).width || 1));
    x.font = `${o.weight} ${fs}px ${family(text)}`;
    x.direction = isRTL(text) ? 'rtl' : 'ltr'; // never add letterSpacing: it breaks Arabic joining
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    x.fillText(text, W / 2, H / 2);
    r = samplePoints(x.getImageData(0, 0, W, H).data, W, H, 2);
    if (cache.size > 16) cache.delete(cache.keys().next().value);
    cache.set(key, r);
    return r;
  }
  const layout = (text, s) => {
    const r = raster(text), sc_ = s || layoutScale(r.box, view, o.fill);
    return {xy: toWorld(r.pts, r.box, sc_, view.h * .02), m: r.m, s: sc_, step: 2 * sc_};
  };

  /* ---- particles ---- */
  function alloc() {
    const base = o.count || (view.w < 600 ? 4500 : 9000);
    n = renderer.kind === '2d' ? Math.min(base, 2500) : base;
    S = {n, P: new Float32Array(n * 3), V: new Float32Array(n * 3), G: new Float32Array(n * 3), A: null, R: new Float32Array(n * 2)};
    col = new Float32Array(n * 3); sz = new Float32Array(n); ci = new Uint8Array(n);
    const c = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      S.P[i * 3] = (Math.random() - .5) * view.w; S.P[i * 3 + 1] = (Math.random() - .5) * view.h;
      const u = Math.random(); ramp(u, c); col.set(c, i * 3); ci[i] = Math.round(u * (rgb.length - 1));
      sz[i] = .6 + Math.random() * .8;
      S.R[i * 2] = Math.random() * 2 - 1; S.R[i * 2 + 1] = Math.random() * 2 - 1;
    }
    if (gl) upload();
  }
  function altOf(text) {
    const a = lens && lens.alt;
    return a && (typeof a === 'function' ? a(text) : a[text]) || '';
  }
  function retarget(text, snap) {
    if (!n) return;
    const L = layout(text), alt = altOf(text), Q = alt ? layout(alt, L.s) : null, jit = L.step * .35;
    const src = assign(L.m, n), srcA = Q ? assign(Q.m, n) : null;
    S.A = Q ? (S.A || new Float32Array(n * 3)) : null;
    for (let i = 0; i < n; i++) {
      const a = i * 3, m = src[i] * 2;
      S.G[a] = L.xy[m] + (Math.random() - .5) * jit; S.G[a + 1] = L.xy[m + 1] + (Math.random() - .5) * jit; S.G[a + 2] = 1;
      if (Q) { const q = srcA[i] * 2; S.A[a] = Q.xy[q]; S.A[a + 1] = Q.xy[q + 1]; S.A[a + 2] = 1; }
      if (!snap) { S.V[a] += (Math.random() - .5) * view.h * .025; S.V[a + 1] += (Math.random() - .5) * view.h * .025; }
    }
    dot = Math.min(5, Math.max(1.4, L.step * Math.max(1, Math.sqrt(L.m / n)) * 1.2));
    if (snap) { S.P.set(S.G); S.V.fill(0); }
    paint();
  }

  /* ---- renderers ---- */
  function initGL() {
    const g = cv.getContext('webgl', {alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance'});
    if (!g) return false;
    try {
      const sh = (ty, src) => { const s = g.createShader(ty); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s)); return s; };
      prog = g.createProgram(); g.attachShader(prog, sh(g.VERTEX_SHADER, VS)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
      g.linkProgram(prog); g.useProgram(prog);
    } catch (e) { return false; }
    gl = g; U = {};
    for (const k of ['uV', 'uD', 'uSz', 'uSc']) U[k] = g.getUniformLocation(prog, k);
    g.enable(g.BLEND); g.blendFunc(g.ONE, o.blend === 'normal' ? g.ONE_MINUS_SRC_ALPHA : g.ONE); g.disable(g.DEPTH_TEST);
    return true;
  }
  function upload() {
    const attr = (name, data, size, usage) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      const l = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); return b;
    };
    pbuf = attr('aP', S.P, 3, gl.DYNAMIC_DRAW); attr('aC', col, 3, gl.STATIC_DRAW); attr('aS', sz, 1, gl.STATIC_DRAW);
  }
  function draw() {
    painted = true;
    const w = cv.width, h = cv.height, fade = 1 - uS * .6;
    if (gl) {
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uV, view.w / 2, view.h / 2); gl.uniform1f(U.uD, dpr); gl.uniform1f(U.uSz, dot); gl.uniform1f(U.uSc, uS);
      gl.bindBuffer(gl.ARRAY_BUFFER, pbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, S.P);
      gl.drawArrays(gl.POINTS, 0, n);
    } else if (g2) {
      g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, view.w, view.h);
      g2.globalCompositeOperation = o.blend === 'normal' ? 'source-over' : 'lighter'; g2.globalAlpha = .85 * fade;
      for (let c = 0; c < css.length; c++) {
        g2.fillStyle = css[c];
        for (let i = 0; i < n; i++) if (ci[i] === c) {
          const z = Math.min(1, Math.max(0, S.P[i * 3 + 2])), d = dot * sz[i] * (.3 + .7 * z);
          g2.fillRect(S.P[i * 3] + view.w / 2 - d / 2, view.h / 2 - S.P[i * 3 + 1] - d / 2, d, d);
        }
      }
    }
  }
  /* reduced motion / paused: redraw only on demand */
  function paint() { if (!raf && !rs && !dead) rs = requestAnimationFrame(() => { rs = 0; draw(); }); }

  /* ---- loop ---- */
  const live = () => !dead && vis && inView && !reduce && n > 0;
  function frame(now) {
    raf = 0;
    if (!live()) return;
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now; t += dt;
    uS += (sc - uS) * Math.min(1, .1 * dt * 60);
    const m = Math.min(view.w, view.h);
    step(S, dt, {
      mx: ptr.x, my: ptr.y, on: ptr.on && sc < .3, rad: m * .15 + 20, t, sc: uS, spread: Math.max(view.w, view.h) * o.spread,
      lr: (lens && lens.radius) || Math.min(260, Math.max(70, m * .26)), amp: Math.max(.4, view.h * .0018)
    });
    draw();
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (live()) { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    else { if (raf) cancelAnimationFrame(raf); raf = 0; if (!dead) paint(); }
    cyc && cyc.pause(!(vis && inView));
  }

  /* ---- resize / DPR ---- */
  let rt = 0;
  function size() {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    view = {w, h};
    if (!n) alloc();
    clearTimeout(rt);
    rt = setTimeout(() => { if (word && !dead) retarget(word, reduce); }, 100);
    paint();
  }

  /* ---- events ---- */
  const ac = new AbortController(), on = {signal: ac.signal, passive: true};
  const move = e => {
    const r = cv.getBoundingClientRect();
    ptr.x = e.clientX - r.left - r.width / 2; ptr.y = -(e.clientY - r.top - r.height / 2);
    ptr.on = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const off = () => { ptr.on = false; };
  if (o.interact) {
    addEventListener('pointermove', move, on); addEventListener('pointerdown', move, on);
    addEventListener('pointerup', e => { if (e.pointerType === 'touch') off(); }, on);
    document.addEventListener('pointerleave', off, on);
    addEventListener('blur', off, on);
  }
  document.addEventListener('visibilitychange', () => { vis = !document.hidden; sync(); }, on);
  const onMq = () => { reduce = mq.matches; if (reduce && word) retarget(word, true); if (reduce) stopCycle(); sync(); };
  mq.addEventListener ? mq.addEventListener('change', onMq, on) : mq.addListener(onMq);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
  ro ? ro.observe(cv) : addEventListener('resize', size, on);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(e => { inView = e[e.length - 1].isIntersecting; sync(); }) : null;
  io && io.observe(cv);
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; sync(); }, {signal: ac.signal});
  cv.addEventListener('webglcontextrestored', () => { if (initGL()) { upload(); sync(); } }, {signal: ac.signal});

  /* ---- boot: WebGL -> 2D -> nothing (the aria-label still carries the word) ---- */
  if (initGL()) renderer.kind = 'webgl';
  else if ((g2 = cv.getContext('2d'))) renderer.kind = '2d';
  size();

  /* ---- public ---- */
  function stopCycle() { if (cyc) cyc.stop(); cyc = null; }
  const api = {
    /** Morph into `text`. Resolves once the (web)font is ready and the new targets are set. */
    morph(text, mo = {}) {
      text = String(text); word = text; const my = ++token;
      cv.setAttribute('aria-label', text);
      return ready(text).then(() => { if (my === token && !dead) retarget(text, !!mo.snap || reduce); });
    },
    /** Show each word in turn every `ms`. Reduced motion shows the first word only. */
    cycle(words, ms = 3800) {
      stopCycle();
      if (!words || !words.length) return api;
      if (reduce) { api.morph(words[0]); return api; }
      cyc = createCycle(words, ms, w => api.morph(w));
      cyc.pause(!(vis && inView)); cyc.start();
      return api;
    },
    /** 0 = assembled, 1 = fully dispersed and faded. Call without an argument to read. */
    scatter(v) {
      if (v === undefined) return sc;
      sc = Math.min(1, Math.max(0, +v || 0));
      if (reduce) { uS = sc; paint(); }
      return api;
    },
    get renderer() { return renderer.kind; },
    get word() { return word; },
    destroy() {
      if (dead) return;
      dead = true; stopCycle(); ac.abort(); ro && ro.disconnect(); io && io.disconnect();
      cancelAnimationFrame(raf); cancelAnimationFrame(rs); clearTimeout(rt);
      if (gl) { const e = gl.getExtension('WEBGL_lose_context'); e && e.loseContext(); }
      else if (g2) g2.clearRect(0, 0, cv.width, cv.height);
    }
  };
  return api;
}

export default glyphfield;
