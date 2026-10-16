// Exact kernel: chamfer types, variable and full round fillets, offset face, silhouette split, sweep scale/guide, loft centre line and end point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const vols = r => [...r.bodies.values()].map(b => K.brepProps(b).volume);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)}, expected ${b.toFixed(3)} ± ${tol}`);
const okAll = r => { const e = [...r.status.values()].filter(s => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const box = { id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' };
const sigs = (r, kind) => [...K.brepSigMap([...r.bodies.values()][0], kind).values()];
const r0 = K.regenerateBrep([box]);
const topEdge = sigs(r0, 'edge').find(s => Math.abs(s.p[2] - 20) < 1e-6 && Math.abs(s.p[1] - 15) < 1e-6);   // along X at y = 15, z = 20
const topFace = sigs(r0, 'face').find(s => Math.abs(s.c[2] - 20) < 1e-6);

test('chamfer: two distances and distance + angle', () => {
  const two = K.regenerateBrep([box, { id: 'c', type: 'chamfer', edges: [topEdge], distance: 2, chamferType: 'two', distance2: 4 }]);
  okAll(two); near(24000 - vols(two)[0], 0.5 * 2 * 4 * 40, 1e-6, 'two-distance chamfer removes a 2 × 4 triangle');
  const da = K.regenerateBrep([box, { id: 'c', type: 'chamfer', edges: [topEdge], distance: 3, chamferType: 'angle', chamferAngle: 45 }]);
  okAll(da); near(24000 - vols(da)[0], 0.5 * 3 * 3 * 40, 1e-6, '3 mm at 45°');
  const flip = K.regenerateBrep([box, { id: 'c', type: 'chamfer', edges: [topEdge], distance: 2, chamferType: 'two', distance2: 4, flipSide: true }]);
  okAll(flip); near(vols(flip)[0], vols(two)[0], 1e-6, 'flipping keeps the area');
});
test('variable radius fillet lies between the two constant ones', () => {
  const v = r => vols(K.regenerateBrep([box, { id: 'f', type: 'fillet', edges: [topEdge], radius: r[0], ...(r[1] ? { filletType: 'variable', radius2: r[1] } : {}) }]))[0];
  const a = v([2]), b = v([6]), m = v([2, 6]);
  assert.ok(m < a && m > b, `${b.toFixed(1)} < ${m.toFixed(1)} < ${a.toFixed(1)}`);
});
test('full round fillet on a 6 mm wide rib top', () => {
  const rib = { id: 'r', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 6, d: 40, h: 20, op: 'new' };
  const rr = K.regenerateBrep([rib]); const top = sigs(rr, 'face').find(s => Math.abs(s.c[2] - 20) < 1e-6);
  const r = K.regenerateBrep([rib, { id: 'fr', type: 'fullround', edges: [top] }]);
  okAll(r);
  near(6 * 40 * 20 - vols(r)[0], (18 - Math.PI * 9 / 2) * 40, 0.3, 'top replaced by a half cylinder of radius 3');
});
test('offset face moves a face and extends angled neighbours', () => {
  // a chamfered box: offset the top face up 5; the chamfer face extends
  const ch = K.regenerateBrep([box, { id: 'c', type: 'chamfer', edges: [topEdge], distance: 5 }]);
  const top = sigs(ch, 'face').find(s => Math.abs(s.c[2] - 20) < 1e-6 && s.type === 'PLANE');
  const r = K.regenerateBrep([box, { id: 'c', type: 'chamfer', edges: [topEdge], distance: 5 }, { id: 'o', type: 'offsetface', edges: [top], distance: 5 }]);
  okAll(r);
  // 40 x 30 x 25 box with a 10 x 10 chamfer on the +Y top edge
  near(vols(r)[0], 40 * 30 * 25 - 0.5 * 10 * 10 * 40, 1e-3, 'volume with the chamfer extended');
  const neg = K.regenerateBrep([box, { id: 'o', type: 'offsetface', edges: [topFace], distance: -4 }]);
  okAll(neg); near(vols(neg)[0], 40 * 30 * 16, 1e-6, 'push down 4');
});
test('silhouette split of a lying cylinder: two halves', () => {
  const cyl = { id: 's', type: 'sketch', plane: 'YZ', offset: 0, profiles: [{ id: 'c', kind: 'circle', cx: 0, cy: 10, r: 10 }] };
  const ex = { id: 'e', type: 'extrude', sketch: 's', distance: 50, op: 'new' };
  const r = K.regenerateBrep([cyl, ex, { id: 'q', type: 'silsplit', dir: 'XY', mode: 'body' }]);
  okAll(r); const v = vols(r);
  assert.equal(v.length, 2); near(v[0], v[1], 1e-3, 'equal halves'); near(v[0] + v[1], Math.PI * 100 * 50, 1e-3, 'total');
  const rf = K.regenerateBrep([cyl, ex, { id: 'q', type: 'silsplit', dir: 'XZ', mode: 'faces' }]);
  okAll(rf); assert.equal(vols(rf).length, 1);
  assert.ok(sigs(rf, 'face').length > sigs(K.regenerateBrep([cyl, ex]), 'face').length, 'the round face is split along the silhouette');
});
const line = (id, plane, pts, offset = 0) => ({ id, type: 'sketch', plane, offset, profiles: [], geo: { points: pts.map((p, i) => ({ id: id + 'p' + i, x: p[0], y: p[1] })), curves: pts.slice(1).map((p, i) => ({ id: id + 'l' + i, kind: 'line', a: id + 'p' + i, b: id + 'p' + (i + 1) })), cons: [] } });
test('sweep with an end scale (circle to half size: a frustum)', () => {
  const path = line('pth', 'XZ', [[0, 0], [0, 40]]);
  const r = K.regenerateBrep([path, { id: 'w', type: 'sweep', path: 'pth', profileKind: 'circle', diameter: 20, scaleEnd: 0.5, op: 'new' }]);
  okAll(r); near(vols(r)[0], Math.PI * 40 / 3 * (100 + 50 + 25), 1, 'frustum r 10 → 5 over 40');
});
test('loft to an end point (cone) and along a centre line', () => {
  const s1 = { id: 's1', type: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }] };
  const pt = { id: 'pt', type: 'point', mode: 'xyz', x: 0, y: 0, z: 30 };
  const cone = K.regenerateBrep([s1, pt, { id: 'l', type: 'loft', sketches: ['s1'], endPoint: 'pt', op: 'new' }]);
  okAll(cone); near(vols(cone)[0], Math.PI * 100 * 30 / 3, 1, 'cone to the point');
  const s2 = { id: 's2', type: 'sketch', plane: 'XY', offset: 30, profiles: [{ id: 'c2', kind: 'circle', cx: 0, cy: 0, r: 5 }] };
  const cl = line('cl', 'XZ', [[0, 0], [0, 30]]);
  const r = K.regenerateBrep([s1, s2, cl, { id: 'l', type: 'loft', sketches: ['s1', 's2'], centerline: 'cl', op: 'new' }]);
  okAll(r); near(vols(r)[0], Math.PI * 30 / 3 * (100 + 50 + 25), 30, 'loft along a straight centre line ≈ frustum');
});
test('sweep oriented by a guide rail', () => {
  const path = line('pth', 'XZ', [[0, 0], [0, 40]]), rail = line('rl', 'XZ', [[15, 0], [15, 40]]);
  const r = K.regenerateBrep([path, rail, { id: 'w', type: 'sweep', path: 'pth', guide: 'rl', profileKind: 'circle', diameter: 10, op: 'new' }]);
  okAll(r); near(vols(r)[0], Math.PI * 25 * 40, 0.5, 'straight rail: a plain cylinder');
});
