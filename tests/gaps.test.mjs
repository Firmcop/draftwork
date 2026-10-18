// Exact kernel: loft rails and end conditions, sweep twist; expression units.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const vols = r => [...r.bodies.values()].map(b => K.brepProps(b).volume);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)}, expected ${b.toFixed(3)} ± ${tol}`);
const okAll = r => { const e = [...r.status.values()].filter(s => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const bbox = r => [...r.bodies.values()][0].shape.boundingBox.bounds;
const circ = (id, r, offset) => ({ id, type: 'sketch', plane: 'XY', offset, profiles: [{ id: id + 'c', kind: 'circle', cx: 0, cy: 0, r }] });
const chain = (id, plane, pts) => ({ id, type: 'sketch', plane, offset: 0, profiles: [], geo: { points: pts.map((p, i) => ({ id: id + i, x: p[0], y: p[1] })), curves: pts.slice(1).map((p, i) => ({ id: id + 'l' + i, kind: 'line', a: id + i, b: id + (i + 1) })), cons: [] } });
const integ = (f, a, b, n = 2000) => { let s = 0; for (let i = 0; i < n; i++) { const x = a + (b - a) * (i + 0.5) / n; s += f(x); } return s * (b - a) / n; };

test('loft end conditions: normal ends make an S-shaped profile', () => {
  const base = [circ('a', 10, 0), circ('b', 5, 30)];
  const free = K.regenerateBrep([...base, { id: 'l', type: 'loft', sketches: ['a', 'b'], op: 'new' }]);
  const nrm = K.regenerateBrep([...base, { id: 'l', type: 'loft', sketches: ['a', 'b'], startCond: 'normal', endCond: 'normal', op: 'new' }]);
  okAll(free); okAll(nrm);
  near(vols(free)[0], Math.PI * 30 / 3 * 175, 1, 'free: frustum');
  const r = z => 10 - 5 * (3 * (z / 30) ** 2 - 2 * (z / 30) ** 3);
  near(vols(nrm)[0], integ(z => Math.PI * r(z) ** 2, 0, 30), 0.01 * vols(nrm)[0], 'normal: smoothstep radius');
});
test('loft with one rail bulges to follow it', () => {
  // rail in the XZ plane from (10,0,0) via (16,0,15) to (10,0,30)
  const rail = chain('rl', 'XZ', [[10, 0], [16, 15], [10, 30]]);
  const r = K.regenerateBrep([circ('a', 10, 0), circ('b', 10, 30), rail, { id: 'l', type: 'loft', sketches: ['a', 'b'], rails: ['rl'], op: 'new' }]);
  okAll(r);
  const rz = z => z <= 15 ? 10 + 6 * z / 15 : 16 - 6 * (z - 15) / 15;
  near(vols(r)[0], integ(z => Math.PI * rz(z) ** 2, 0, 30), 0.02 * vols(r)[0], 'radius follows the rail');
  const [lo, hi] = bbox(r); near(hi[0], 16, 0.4, 'widest at the rail peak');
});
test('loft with two rails', () => {
  const r1 = chain('r1', 'XZ', [[10, 0], [14, 15], [10, 30]]), r2 = chain('r2', 'XZ', [[-10, 0], [-14, 15], [-10, 30]]);
  const r = K.regenerateBrep([circ('a', 10, 0), circ('b', 10, 30), r1, r2, { id: 'l', type: 'loft', sketches: ['a', 'b'], rails: ['r1', 'r2'], op: 'new' }]);
  okAll(r); const [lo, hi] = bbox(r); near(hi[0] - lo[0], 28, 0.6, 'both rails reached at mid height');
});
test('sweep twist: a 20 × 10 bar twisted 90° turns its end', () => {
  const path = chain('p', 'XZ', [[0, 0], [0, 40]]);
  const prof = { id: 's', type: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10 }] };
  const plain = K.regenerateBrep([path, prof, { id: 'w', type: 'sweep', path: 'p', profileKind: 'sketch', profile: 's', op: 'new' }]);
  const tw0 = K.regenerateBrep([path, prof, { id: 'w', type: 'sweep', path: 'p', profileKind: 'sketch', profile: 's', twist: 0.0001, op: 'new' }]);
  const tw = K.regenerateBrep([path, prof, { id: 'w', type: 'sweep', path: 'p', profileKind: 'sketch', profile: 's', twist: 90, op: 'new' }]);
  okAll(plain); okAll(tw0); okAll(tw);
  near(vols(tw)[0], 200 * 40, 2, 'volume of a twisted prism stays area × length');
  const b0 = bbox(tw0), bp = bbox(plain), bt = bbox(tw);
  near(b0[1][0] - b0[0][0], bp[1][0] - bp[0][0], 0.05, 'no twist keeps the orientation');
  const w = bt[1][0] - bt[0][0], d = bt[1][1] - bt[0][1];
  assert.ok(w > 19 && d > 19, `twisted bar sweeps a 20 × 20 square in plan (${w.toFixed(1)} × ${d.toFixed(1)})`);
});
test('expressions take unit suffixes', () => {
  near(K.evalExpr('1 in'), 25.4, 1e-9, 'inch'); near(K.evalExpr('2.5cm + 3 mm'), 28, 1e-9, 'cm + mm');
  near(K.evalExpr('0.1 m'), 100, 1e-9, 'metre'); near(K.evalExpr('1 ft'), 304.8, 1e-9, 'foot');
  near(K.evalExpr('w * 2', { w: 5 }), 10, 1e-9, 'plain'); near(K.evalExpr('pi rad'), 180, 1e-9, 'radians to degrees'); near(K.evalExpr('45 deg'), 45, 1e-9, 'degrees');
});
