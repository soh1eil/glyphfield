import test from 'node:test';
import assert from 'node:assert/strict';
import {smoothstep, hasRTL, isRTL, samplePoints, layoutScale, toWorld, assign, step, createCycle} from '../src/glyphfield.js';

const seeded = (seed = 1) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** RGBA buffer with a filled rectangle of full alpha. */
function rectBuf(W, H, x0, y0, x1, y1, alpha = 255) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[(y * W + x) * 4 + 3] = alpha;
  return d;
}

test('smoothstep clamps and is monotonic, also with descending edges', () => {
  assert.equal(smoothstep(0, 1, -5), 0);
  assert.equal(smoothstep(0, 1, 5), 1);
  assert.equal(smoothstep(0, 1, .5), .5);
  assert.equal(smoothstep(10, 2, 12), 0);
  assert.equal(smoothstep(10, 2, 1), 1);
  let prev = -1;
  for (let x = 0; x <= 1; x += .05) { const v = smoothstep(0, 1, x); assert.ok(v >= prev); prev = v; }
});

test('direction helpers', () => {
  const cases = [
    ['hello', false, false], ['سهیل', true, true], ['مرحبا', true, true],
    ['Soheil سهیل', false, true], ['سهیل Soheil', true, true],
    ['123 سلام', true, true], ['123', false, false], ['', false, false], ['שלום', true, true]
  ];
  for (const [s, rtl, has] of cases) {
    assert.equal(isRTL(s), rtl, `isRTL(${s})`);
    assert.equal(hasRTL(s), has, `hasRTL(${s})`);
  }
});

test('samplePoints finds the ink and its bounding box', () => {
  const W = 40, H = 20, buf = rectBuf(W, H, 10, 4, 30, 12);
  const {pts, box, m} = samplePoints(buf, W, H, 2);
  assert.equal(m, 10 * 4); // 20/2 columns x 8/2 rows
  assert.equal(pts.length, m * 2);
  assert.deepEqual(box, [10, 4, 28, 10]);
});

test('samplePoints respects the alpha threshold and handles empty input', () => {
  const W = 8, H = 8;
  assert.equal(samplePoints(rectBuf(W, H, 0, 0, 8, 8, 100), W, H, 1, 140).m, 0);
  assert.equal(samplePoints(rectBuf(W, H, 0, 0, 8, 8, 200), W, H, 1, 140).m, 64);
  const e = samplePoints(new Uint8ClampedArray(W * H * 4), W, H);
  assert.equal(e.m, 0);
  assert.deepEqual(e.box, [0, 0, 1, 1]); // never degenerate: layoutScale cannot divide by zero
});

test('layoutScale fits the limiting axis', () => {
  const box = [0, 0, 99, 9]; // 100 x 10
  assert.equal(layoutScale(box, {w: 1000, h: 1000}, [.8, .5]), 8); // width limited
  assert.equal(layoutScale([0, 0, 9, 99], {w: 1000, h: 1000}, [.8, .5]), 5); // height limited
  assert.ok(Number.isFinite(layoutScale([0, 0, 0, 0], {w: 100, h: 100})));
});

test('toWorld centres, flips y and lifts', () => {
  const o = toWorld(Float32Array.of(10, 10, 30, 20), [10, 10, 30, 20], 2, 5);
  assert.deepEqual([...o], [-20, 5 + 10, 20, 5 - 10]);
});

test('assign: every particle gets a valid point; all points used when M <= N', () => {
  for (const [M, N] of [[10, 100], [100, 10], [7, 7], [1, 50], [3, 1000]]) {
    const src = assign(M, N, seeded(M * 31 + N));
    assert.equal(src.length, N);
    assert.ok(src.every(v => v < M), `range ${M},${N}`);
    if (M <= N) assert.equal(new Set(src).size, M, `coverage ${M},${N}`);
    else assert.equal(new Set(src).size, N, `distinct ${M},${N}`);
  }
});

test('assign is deterministic for a seeded rand and shuffles', () => {
  const a = assign(50, 50, seeded(9)), b = assign(50, 50, seeded(9)), c = assign(50, 50, seeded(10));
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a], [...c]);
  assert.notDeepEqual([...a], [...a].sort((x, y) => x - y)); // not the identity ordering
});

function field(n, fn) {
  const s = {n, P: new Float32Array(n * 3), V: new Float32Array(n * 3), G: new Float32Array(n * 3), A: null, R: new Float32Array(n * 2)};
  fn(s); return s;
}
const base = {mx: 0, my: 0, on: false, rad: 100, lr: 100, t: 0, sc: 0, spread: 500, amp: 0};
const run = (s, o, frames = 400) => { for (let i = 0; i < frames; i++) step(s, 1 / 60, {...o, t: i / 60}); };

test('step: particles settle on their targets and fade in', () => {
  const s = field(1, s => { s.P.set([200, -150, 0]); s.G.set([10, 20, 1]); });
  run(s, base);
  assert.ok(Math.abs(s.P[0] - 10) < .1 && Math.abs(s.P[1] - 20) < .1, `xy ${s.P.slice(0, 2)}`);
  assert.ok(Math.abs(s.P[2] - 1) < .01);
});

test('step: frame rate independent (one 1/30 step ~ two 1/60 steps)', () => {
  const mk = () => field(1, s => { s.P.set([100, 0, 1]); s.G.set([0, 0, 1]); });
  const a = mk(), b = mk();
  for (let i = 0; i < 30; i++) step(a, 1 / 30, base);
  for (let i = 0; i < 60; i++) step(b, 1 / 60, base);
  assert.ok(Math.abs(a.P[0] - b.P[0]) < 3, `${a.P[0]} vs ${b.P[0]}`);
});

test('step: pointer pushes a particle away and releases it', () => {
  const s = field(1, s => { s.P.set([20, 0, 1]); s.G.set([20, 0, 1]); });
  run(s, {...base, on: true, mx: 0, my: 0}, 120);
  assert.ok(s.P[0] > 40, `pushed to ${s.P[0]}`);
  run(s, base, 400);
  assert.ok(Math.abs(s.P[0] - 20) < .1);
});

test('step: scatter disperses and fades, 0 restores', () => {
  const s = field(1, s => { s.P.set([0, 0, 1]); s.G.set([0, 0, 1]); s.R.set([1, 0]); });
  run(s, {...base, sc: 1}, 300);
  assert.ok(s.P[0] > 300, `x ${s.P[0]}`);
  assert.ok(s.P[2] < .2, `presence ${s.P[2]}`);
  run(s, {...base, sc: 0}, 500);
  assert.ok(Math.abs(s.P[0]) < .1 && s.P[2] > .99);
});

test('step: lens pulls the alt target in, evicts primaries, ignores far particles', () => {
  const s = field(3, s => {
    s.P.set([0, 0, 1, 0, 0, 1, 400, 0, 1]);
    s.G.set([0, 0, 1, 0, 0, 1, 400, 0, 1]);
    s.A = Float32Array.of(30, 0, 1, 500, 0, 1, 400, 0, 1);
  });
  run(s, {...base, on: true, lr: 100}, 400);
  assert.ok(Math.abs(s.P[0] - 30) < 1, `alt reached: ${s.P[0]}`); // alt inside lens
  assert.ok(s.P[5] < .1, `evicted presence: ${s.P[5]}`); // primary inside lens, alt outside
  assert.ok(Math.abs(s.P[6] - 400) < .5 && s.P[8] > .99); // far away: untouched
});

test('createCycle advances on its interval with fake timers', () => {
  const log = [], q = [];
  let id = 0;
  const timers = {setTimeout: (f, ms) => (q.push({id: ++id, f, ms}), id), clearTimeout: i => { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); }};
  const c = createCycle(['a', 'b', 'c'], 1000, (w, i) => log.push([w, i]), timers);
  c.start();
  assert.deepEqual(log, [['a', 0]]); // first word immediately
  assert.equal(q.length, 1); assert.equal(q[0].ms, 1000);
  for (let k = 0; k < 3; k++) q.shift().f();
  assert.deepEqual(log.map(x => x[0]), ['a', 'b', 'c', 'a']); // wraps
  assert.equal(c.index, 0);
});

test('createCycle: pause cancels the timer, resume waits a full interval, stop is final', () => {
  const log = [], q = [];
  let id = 0;
  const timers = {setTimeout: (f, ms) => (q.push({id: ++id, f}), id), clearTimeout: i => { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); }};
  const c = createCycle(['a', 'b'], 500, w => log.push(w), timers);
  c.start();
  c.pause(true);
  assert.equal(q.length, 0, 'no pending timer while paused');
  assert.equal(c.running, false);
  c.pause(true); // idempotent
  c.pause(false);
  assert.equal(log.length, 1, 'resume does not fire immediately');
  assert.equal(q.length, 1);
  q.shift().f();
  assert.deepEqual(log, ['a', 'b']);
  c.stop();
  assert.equal(q.length, 0);
  c.pause(false);
  assert.equal(q.length, 0, 'stopped stays stopped');
});

test('createCycle started while paused waits for resume; empty list is a no-op', () => {
  const log = [], q = [];
  const timers = {setTimeout: f => (q.push(f), q.length), clearTimeout: () => {}};
  const c = createCycle(['x'], 10, w => log.push(w), timers);
  c.pause(true); c.start();
  assert.equal(log.length, 0);
  c.pause(false);
  assert.equal(q.length, 1);
  createCycle([], 10, w => log.push(w), timers).start();
  assert.equal(log.length, 0);
});
