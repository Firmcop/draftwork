// SnapEngine geometry: candidates (endpoints, midpoints, centers, quadrants, intersections), priorities, alignment,
// line inference, and snapped points that stay put through the constraint solver when the sketch changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { loadKernels } from './load-kernels.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-snap-')), 'snap.mjs');
fs.writeFileSync(tmp, fs.readFileSync(path.join(root, 'src/snapgeo.js'), 'utf8') + '\nexport { snapCandidates, snapPick, curveIntersections, inferLine, inferRadius, snapConstraints };');
const S = await import(pathToFileURL(tmp).href);
const K = await loadKernels();
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b}`);

const P = (x, y) => ({ x, y });
const scene = {
  points: [{ id: 'O', x: 0, y: 0 }, { id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }, { id: 'c', x: 50, y: 40, center: true }],
  curves: [{ id: 'L', kind: 'line', a: P(0, 0), b: P(100, 0) }, { id: 'C', kind: 'circle', c: P(50, 40), r: 30, ic: 'c' }],
};
const cands = S.snapCandidates(scene.points, scene.curves);

test('candidates: endpoint, midpoint, center, quadrants and intersections from the real geometry', () => {
  const t = k => cands.filter(c => c.type === k);
  assert.equal(t('midpoint').length, 1); near(t('midpoint')[0].x, 50);
  assert.equal(t('center').length, 1);
  assert.equal(t('quadrant').length, 4);
  const q = t('quadrant').find(c => Math.abs(c.y - 10) < 1e-9); assert.ok(q, 'bottom quadrant at (50, 10)');
  // the circle (r 30 at y 40) does not reach the line (y 0): no intersections yet
  assert.equal(t('intersection').length, 0);
  const sc2 = { points: scene.points, curves: [scene.curves[0], { id: 'C2', kind: 'circle', c: P(50, 10), r: 26, ic: 'c' }] };
  const xs = S.snapCandidates(sc2.points, sc2.curves).filter(c => c.type === 'intersection').map(c => c.x).sort((a, b) => a - b);
  assert.equal(xs.length, 2); near(xs[0], 50 - 24, 1e-9, 'x = 50 − √(26² − 10²)'); near(xs[1], 74);
});

test('intersections respect segment ends and arc spans', () => {
  assert.equal(S.curveIntersections({ kind: 'line', a: P(0, 0), b: P(10, 0) }, { kind: 'line', a: P(20, -5), b: P(20, 5) }).length, 0, 'beyond the segment');
  const x = S.curveIntersections({ kind: 'line', a: P(0, 0), b: P(10, 10) }, { kind: 'line', a: P(0, 10), b: P(10, 0) });
  near(x[0].x, 5); near(x[0].y, 5);
  // upper half arc (ccw from (10,0) to (-10,0)) meets the x axis line only at its ends, and the vertical line only above
  const arc = { kind: 'arc', c: P(0, 0), r: 10, a: P(10, 0), b: P(-10, 0) };
  const v = S.curveIntersections({ kind: 'line', a: P(0, -20), b: P(0, 20) }, arc);
  assert.equal(v.length, 1); near(v[0].y, 10);
});

test('pick: endpoints win over a nearer midpoint only within priority; the result is exact, not the cursor', () => {
  const s = S.snapPick(scene, cands, 50.7, 0.4, 2);
  assert.equal(s.type, 'midpoint'); assert.equal(s.x, 50); assert.equal(s.y, 0);
  assert.deepEqual(s.refs, [{ type: 'midpoint', e: ['L'] }]);
  const e = S.snapPick(scene, cands, 99.2, 0.5, 2);
  assert.equal(e.type, 'endpoint'); assert.equal(e.id, 'b');
  const off = S.snapPick(scene, cands, 50.7, 0.4, 2, { cats: { midpoint: false } });
  assert.equal(off.type, 'nearest', 'midpoint switched off → on the line');
  near(off.y, 0); assert.deepEqual(off.refs, [{ type: 'onLine', e: ['L'] }]);
});

test('alignment and grid for free positions', () => {
  const a = S.snapPick(scene, cands, 50.4, 90, 2, { grid: Math.round });
  assert.equal(a.type, 'align'); assert.equal(a.x, 50); assert.equal(a.y, 90); assert.equal(a.guides.length, 1);
  const g = S.snapPick(scene, cands, 31.4, 77.6, 2, { grid: Math.round });
  assert.equal(g.type, 'grid'); assert.equal(g.x, 31); assert.equal(g.y, 78);
});

test('line inference: horizontal, parallel, perpendicular, tangent — exact directions', () => {
  const lines = [{ id: 'S', a: P(0, 0), b: P(100, 50) }];
  const h = S.inferLine(P(0, 0), P(50, 0.6), lines, [], { tol: 1 }); assert.equal(h.type, 'horizontal'); assert.equal(h.y, 0);
  const par = S.inferLine(P(10, 10), P(70, 40.8), lines, [], { tol: 0.5 });
  assert.equal(par.type, 'parallel'); assert.equal(par.ref, 'S'); near((par.y - 10) / (par.x - 10), 0.5, 1e-9, 'slope');
  const per = S.inferLine(P(0, 0), P(-20.5, 40), lines, [], { tol: 0.5 });
  assert.equal(per.type, 'perpendicular'); near((per.y) / (per.x), -2, 1e-9, 'slope');
  const tan = S.inferLine(P(10, 0), P(10.3, 30), [], [{ id: 'A', c: P(0, 0) }], { tol: 0.5 });
  assert.equal(tan.type, 'tangent'); near(tan.x, 10);
  assert.equal(S.inferLine(P(0, 0), P(30, 17), lines, [], { tol: 0.5 }), null, 'no relation at 29.5°');
});

test('a point snapped to a midpoint stays at the midpoint when the line changes length', () => {
  const geo = { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }, { id: 'm', x: 50, y: 0 }], curves: [{ id: 'L', kind: 'line', a: 'a', b: 'b' }],
    cons: [{ id: 'f', type: 'fix', e: ['a'] }, { id: 'h', type: 'horizontal', e: ['L'] }, { id: 'len', type: 'length', e: ['L'], value: 6000 },
      ...S.snapConstraints('m', [{ type: 'midpoint', e: ['L'] }]).map((c, i) => ({ id: 's' + i, ...c }))] };
  const s = K.solveSketch(geo);
  assert.ok(s.ok);
  near(s.points.get('b').x, 6000, 1e-6, 'end'); near(s.points.get('m').x, 3000, 1e-6, 'midpoint'); near(s.points.get('m').y, 0, 1e-6);
});

test('a point snapped to a quadrant stays level with the circle centre', () => {
  const geo = { points: [{ id: 'c', x: 0, y: 0 }, { id: 'q', x: 25, y: 0 }], curves: [{ id: 'C', kind: 'circle', c: 'c', r: 25 }],
    cons: [{ id: 'f', type: 'fix', e: ['c'] }, { id: 'd', type: 'diameter', e: ['C'], value: 500 },
      ...S.snapConstraints('q', [{ type: 'onCircle', e: ['C'] }, { type: 'horizontal', e: ['c'], pointFirst: false }]).map((c, i) => ({ id: 's' + i, ...c }))] };
  const s = K.solveSketch(geo);
  assert.ok(s.ok);
  near(Math.abs(s.points.get('q').x), 250, 1e-6, 'radius 250'); near(s.points.get('q').y, 0, 1e-6);
});

test('inference: collinear with a line it continues, equal length, both at once', () => {
  const lines = [{ id: 'S', a: P(0, 0), b: P(30, 15) }];
  const col = S.inferLine(P(40, 20), P(80, 40.4), lines, [], { tol: 0.5, equal: false });
  assert.equal(col.type, 'collinear', 'starts on the extension of S and runs along it');
  const par = S.inferLine(P(40, 30), P(80, 50.4), lines, [], { tol: 0.5, equal: false });
  assert.equal(par.type, 'parallel', 'off the extension: only parallel');
  const L = Math.hypot(30, 15);
  const eq = S.inferLine(P(100, 0), P(100 + 0.3, L - 0.1), lines, [], { tol: 1 });
  assert.equal(eq.equal, 'S'); assert.equal(eq.type, 'vertical'); near(Math.hypot(eq.x - 100, eq.y), L, 1e-9, 'exact length');
  assert.equal(S.inferLine(P(100, 0), P(100.3, L - 3), lines, [], { tol: 1 }).equal, null, '3 mm short is not equal');
  const r = S.inferRadius(9.8, [{ id: 'C', r: 10 }, { id: 'D', r: 4 }], 1); assert.equal(r.id, 'C'); assert.equal(r.r, 10);
  assert.equal(S.inferRadius(8, [{ id: 'C', r: 10 }], 1), null);
});

test('symmetric points across a construction line, kept by a symmetry constraint', () => {
  const pts = [{ id: 'O', x: 0, y: 0 }, { id: 'a', x: 0, y: -50 }, { id: 'b', x: 0, y: 50 }, { id: 'p', x: 12, y: 7 }];
  const curves = [{ id: 'ax', kind: 'line', a: P(0, -50), b: P(0, 50), constr: true }];
  const c = S.snapCandidates(pts, curves).find(k => k.type === 'symmetric');
  assert.ok(c); near(c.x, -12); near(c.y, 7); assert.deepEqual(c.refs, [{ type: 'symmetry', e: ['p', 'ax'] }]);
  const geo = { points: [{ id: 'a', x: 0, y: -50 }, { id: 'b', x: 0, y: 50 }, { id: 'p', x: 12, y: 7 }, { id: 'q', x: -12, y: 7 }], curves: [{ id: 'ax', kind: 'line', a: 'a', b: 'b', constr: true }],
    cons: [{ id: 'f1', type: 'fix', e: ['a'], x: 0, y: -50 }, { id: 'f2', type: 'fix', e: ['b'], x: 0, y: 50 }, { id: 'f3', type: 'fix', e: ['p'], x: 20, y: 3 }, ...S.snapConstraints('q', c.refs).map((k, i) => ({ id: 's' + i, ...k }))] };
  // the original is fixed at (20, 3), away from where the mirror was made: the mirror follows it
  const s = K.solveSketch(geo); assert.ok(s.ok);
  near(s.points.get('q').x, -20, 1e-6); near(s.points.get('q').y, 3, 1e-6);
});
