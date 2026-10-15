// Sheet metal: base flange, edge flanges, contour flange, unfold/refold, flat pattern sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const build = feats => K.regenerateBrep(K.resolveFeatures(feats, K.evalParams([]).vars));
const okAll = r => { const e = [...r.status.entries()].filter(([, s]) => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)}, expected ${b.toFixed(4)}`);
const vol = r => K.brepProps([...r.bodies.values()][0]).volume;
const t = 2, R = 2, k = 0.5;
const plate = { id: 'sk', type: 'sketch', name: 'S', plane: 'XY', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 60, h: 40 }] };
const base = { id: 'b', type: 'flange', name: 'Flange 1', sketch: 'sk', thickness: t, bendRadius: R, kFactor: k, edges: [] };

test('base flange is a plate of thickness t; flat pattern = sketch', () => {
  const r = build([plate, base]); okAll(r);
  near(vol(r), 60 * 40 * t, 1e-6, 'plate volume');
  const fd = K.sheetFlatData(r.sheet.get('b'));
  near(fd.size[0], 60, 1e-6, 'flat x'); near(fd.size[1], 40, 1e-6, 'flat y');
});
test('edge flange: volume and flat length use the bend allowance', () => {
  // top edge along +y side of the plate: from (-30,20,2) to (30,20,2)
  const edge = { type: 'LINE', a: [-30, 20, t], b: [30, 20, t], p: [0, 20, t], len: 60 };
  const r = build([plate, base, { id: 'f', type: 'flange', name: 'Flange 2', edges: [edge], height: 15, angle: 90 }]); okAll(r);
  const bendVol = Math.PI / 2 * ((R + t) ** 2 - R ** 2) / 2 * 60, flangeVol = 15 * t * 60;
  near(vol(r), 60 * 40 * t + bendVol + flangeVol, 1e-3, 'folded volume');
  const BA = Math.PI / 2 * (R + k * t), fd = K.sheetFlatData(r.sheet.get('b'));
  near(fd.size[1], 40 + BA + 15, 1e-4, 'flat length = 40 + BA + 15');
  assert.equal(fd.bends.length, 2, 'two bend lines');
  // unfold, then refold
  const r2 = build([plate, base, { id: 'f', type: 'flange', name: 'F', edges: [edge], height: 15, angle: 90 }, { id: 'u', type: 'unfold', name: 'U' }]); okAll(r2);
  near(vol(r2), (40 + BA + 15) * 60 * t, 1e-3, 'flat solid volume');
  const r3 = build([plate, base, { id: 'f', type: 'flange', name: 'F', edges: [edge], height: 15, angle: 90 }, { id: 'u', type: 'unfold', name: 'U' }, { id: 'rf', type: 'refold', name: 'R' }]); okAll(r3);
  near(vol(r3), vol(r), 1e-6, 'refold restores');
  // a flange on the flange's far edge (chained), picked on its inner face
  const top = { type: 'LINE', a: [-30, 20 + R, t + R + 15], b: [30, 20 + R, t + R + 15], p: [0, 20 + R, t + R + 15], len: 60 };
  const r4 = build([plate, base, { id: 'f', type: 'flange', name: 'F', edges: [edge], height: 15, angle: 90 }, { id: 'f2', type: 'flange', name: 'F2', edges: [top], height: 10, angle: 90 }]); okAll(r4);
  near(K.sheetFlatData(r4.sheet.get('b')).size[1], 40 + 2 * BA + 25, 1e-4, 'chained flange flat length');
});
test('contour flange from an L chain', () => {
  const P = (id, x, y) => ({ id, x, y });
  const sk = { id: 'c', type: 'sketch', name: 'C', plane: 'XZ', offset: 0, profiles: [], geo: { points: [P('a', 0, 0), P('b', 30, 0), P('c', 30, 20)], curves: [{ id: 'l1', kind: 'line', a: 'a', b: 'b' }, { id: 'l2', kind: 'line', a: 'b', b: 'c' }], cons: [] } };
  const r = build([sk, { id: 'cf', type: 'contourflange', name: 'CF', sketch: 'c', thickness: t, bendRadius: R, kFactor: k, width: 25, side: 'left', direction: 'one' }]); okAll(r);
  const fd = K.sheetFlatData(r.sheet.get('cf'));
  // corner turns left; material on the left (inside), inner radius R: centreline tangent length = R + t... straight parts 30 - (R+t) and 20 - (R+t)
  const BA = Math.PI / 2 * (R + k * t);
  near(fd.size[0], 30 + 20 - 2 * (R + t) + BA, 1e-4, 'unrolled length');
  near(fd.size[1], 25, 1e-6, 'width');
  near(vol(r), (30 + 20 - 2 * (R + t)) * t * 25 + Math.PI / 4 * ((R + t) ** 2 - R ** 2) * 25, 1e-3, 'contour volume');
});
