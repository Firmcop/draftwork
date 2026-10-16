// Exact kernel: extrude/revolve extents, taper, thin walls, start offset; hole types, tapping and extents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const vols = r => [...r.bodies.values()].map(b => K.brepProps(b).volume);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)}, expected ${b.toFixed(3)} ± ${tol}`);
const okAll = r => { const e = [...r.status.values()].filter(s => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const sq = (id, w = 20, plane = 'XY', offset = 0) => ({ id, type: 'sketch', plane, offset, profiles: [{ id: id + 'r', kind: 'rect', cx: 0, cy: 0, w, h: w }] });
const circ = (id, r, plane = 'XY', offset = 0, cx = 0) => ({ id, type: 'sketch', plane, offset, profiles: [{ id: id + 'c', kind: 'circle', cx, cy: 0, r }] });
const bbox = r => [...r.bodies.values()][0].shape.boundingBox.bounds;

test('extrude two sides: 10 up, 4 down', () => {
  const r = K.regenerateBrep([sq('s'), { id: 'e', type: 'extrude', sketch: 's', extent: 'two', distance: 10, distance2: 4, op: 'new' }]);
  okAll(r); near(vols(r)[0], 400 * 14, 1e-6, 'volume'); const [lo, hi] = bbox(r); near(lo[2], -4, 1e-6, 'bottom'); near(hi[2], 10, 1e-6, 'top');
});
test('start offset shifts the extrude', () => {
  const r = K.regenerateBrep([sq('s'), { id: 'e', type: 'extrude', sketch: 's', distance: 5, startOffset: 3, op: 'new' }]);
  okAll(r); const [lo, hi] = bbox(r); near(lo[2], 3, 1e-6, 'start'); near(hi[2], 8, 1e-6, 'end');
});
test('extrude to a parallel construction plane', () => {
  const r = K.regenerateBrep([sq('s'), { id: 'p', type: 'plane', base: 'XY', offset: 17 }, { id: 'e', type: 'extrude', sketch: 's', extent: 'to', to: 'p', op: 'new' }]);
  okAll(r); near(vols(r)[0], 400 * 17, 1e-6, 'up to the plane');
});
test('extrude to an angled plane follows the plane', () => {
  // plane through the X axis tilted 45°: z = y; a 20x20 square extruded up to it from z = -20 ... use offset sketch below
  const r = K.regenerateBrep([sq('s', 20, 'XY', -20), { id: 'p', type: 'plane', mode: 'angle', base: 'XY', axis: 'u', angle: 45 }, { id: 'e', type: 'extrude', sketch: 's', extent: 'to', to: 'p', op: 'new' }]);
  okAll(r); near(vols(r)[0], 400 * 20, 1e-3, 'mean height 20 (wedge top)');
});
test('extrude cut through all', () => {
  const r = K.regenerateBrep([{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 40, h: 25, op: 'new' }, circ('s', 5, 'XY', 25), { id: 'e', type: 'extrude', sketch: 's', extent: 'all', direction: 'reverse', op: 'cut' }]);
  okAll(r); near(vols(r)[0], 40 * 40 * 25 - Math.PI * 25 * 25, 1e-3, 'hole through 25 mm');
});
test('tapered extrude (frustum)', () => {
  const t = 10 * Math.PI / 180, hgt = 10;
  const r = K.regenerateBrep([sq('s'), { id: 'e', type: 'extrude', sketch: 's', distance: hgt, taper: 10, op: 'new' }]);
  okAll(r);
  const a = 20, b = 20 - 2 * hgt * Math.tan(t), exact = hgt / 3 * (a * a + a * b + b * b);
  near(vols(r)[0], exact, 0.05, 'frustum volume');
  const [lo, hi] = bbox(r); near(hi[0] - lo[0], 20, 1e-3, 'base stays 20');
});
test('thin extrude of a closed profile', () => {
  const r = K.regenerateBrep([sq('s'), { id: 'e', type: 'extrude', sketch: 's', distance: 10, thin: true, thickness: 2, thinSide: 'inside', op: 'new' }]);
  okAll(r); near(vols(r)[0], (400 - 256) * 10, 1e-3, 'wall inside the outline');
  const r2 = K.regenerateBrep([circ('s', 10), { id: 'e', type: 'extrude', sketch: 's', distance: 10, thin: true, thickness: 2, thinSide: 'outside', op: 'new' }]);
  okAll(r2); near(vols(r2)[0], Math.PI * (144 - 100) * 10, 1e-3, 'tube outside the circle');
});
test('revolve two sides and symmetric', () => {
  const prof = { id: 's', type: 'sketch', plane: 'XZ', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 15, cy: 0, w: 10, h: 10 }] };
  const full = K.regenerateBrep([prof, { id: 'v', type: 'revolve', sketch: 's', axis: 'v', extent: 'full', op: 'new' }]);
  okAll(full); const V = vols(full)[0]; near(V, 2 * Math.PI * 15 * 100, 1e-3, 'full revolution (Pappus)');
  const two = K.regenerateBrep([prof, { id: 'v', type: 'revolve', sketch: 's', axis: 'v', extent: 'two', angle: 90, angle2: 45, op: 'new' }]);
  okAll(two); near(vols(two)[0], V * 135 / 360, 1e-3, 'two sides 90 + 45');
  const sym = K.regenerateBrep([prof, { id: 'v', type: 'revolve', sketch: 's', axis: 'v', angle: 120, direction: 'symmetric', op: 'new' }]);
  okAll(sym); near(vols(sym)[0], V / 3, 1e-3, 'symmetric 120');
});
const plate = { id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 40, h: 20, op: 'new' };
test('countersink hole', () => {
  const r = K.regenerateBrep([plate, { id: 'h', type: 'hole', plane: 'XY', offset: 20, cx: 0, cy: 0, diameter: 6, depth: 10, tip: false, holeType: 'csink', csDiameter: 12, csAngle: 90 }]);
  okAll(r);
  const cone = Math.PI * 3 / 3 * (36 + 18 + 9), cyl = Math.PI * 9 * 7;   // 3 mm deep cone 12→6, then 7 mm of Ø6
  near(40 * 40 * 20 - vols(r)[0], cone + cyl, 0.05, 'removed volume');
});
test('hole through all and to a plane', () => {
  const all = K.regenerateBrep([plate, { id: 'h', type: 'hole', plane: 'XY', offset: 20, cx: 0, cy: 0, diameter: 8, extent: 'all' }]);
  okAll(all); near(40 * 40 * 20 - vols(all)[0], Math.PI * 16 * 20, 1e-3, 'through all');
  const to = K.regenerateBrep([plate, { id: 'p', type: 'plane', base: 'XY', offset: 5 }, { id: 'h', type: 'hole', plane: 'XY', offset: 20, cx: 0, cy: 0, diameter: 8, extent: 'to', to: 'p' }]);
  okAll(to); near(40 * 40 * 20 - vols(to)[0], Math.PI * 16 * 15, 1e-3, 'down to z = 5');
});
test('tapped M6 hole: tap drill, modeled thread removes more', () => {
  const cos = K.regenerateBrep([plate, { id: 'h', type: 'hole', plane: 'XY', offset: 20, cx: 0, cy: 0, depth: 12, tip: false, tapped: true, tapSize: 'M6' }]);
  okAll(cos); const removed = 40 * 40 * 20 - vols(cos)[0]; near(removed, Math.PI * 2.5 * 2.5 * 12, 1e-3, 'tap drill Ø5');
  const mod = K.regenerateBrep([plate, { id: 'h', type: 'hole', plane: 'XY', offset: 20, cx: 0, cy: 0, depth: 12, tip: false, tapped: true, tapSize: 'M6', modeled: true }]);
  okAll(mod); const removed2 = 40 * 40 * 20 - vols(mod)[0];
  assert.ok(removed2 > removed + 20 && removed2 < Math.PI * 9 * 12, `modeled thread cuts into the wall (${removed.toFixed(1)} → ${removed2.toFixed(1)} mm³)`);
});
test('taper on a reversed and a symmetric extrude still narrows away from the sketch', () => {
  const rev = K.regenerateBrep([sq('s'), { id: 'e', type: 'extrude', sketch: 's', distance: 10, direction: 'reverse', taper: 10, op: 'new' }]);
  okAll(rev); const b = 20 - 20 * Math.tan(10 * Math.PI / 180); near(vols(rev)[0], 10 / 3 * (400 + 20 * b + b * b), 0.05, 'reverse frustum');
  const sym = K.regenerateBrep([sq('s'), { id: 'e', type: 'extrude', sketch: 's', distance: 20, direction: 'symmetric', taper: 10, op: 'new' }]);
  okAll(sym); near(vols(sym)[0], 2 * 10 / 3 * (400 + 20 * b + b * b), 0.1, 'two frustums back to back');
});
