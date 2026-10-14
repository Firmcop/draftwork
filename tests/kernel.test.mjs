// Mesh (fallback) kernel: volumes checked against hand calculations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels, sampleDoc } from './load-kernels.mjs';

const K = await loadKernels();
const vol = r => [...r.bodies.values()].reduce((s, b) => s + K.signedVolume(b.geom), 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(2)}, expected ${b.toFixed(2)} ± ${tol}`);
const sk = (id, plane, profiles, extra = {}) => ({ id, type: 'sketch', name: id, plane, profiles, ...extra });

test('extruded box is exact', () => {
  const r = K.regenerate([sk('s', 'XY', [{ id: 'a', kind: 'rect', cx: 0, cy: 0, w: 100, h: 60 }]), { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new' }]);
  near(vol(r), 60000, 0.5, 'box volume');
});

test('nested profiles become holes and islands', () => {
  const r = K.regenerate([sk('s', 'XY', [{ id: 'a', kind: 'rect', cx: 0, cy: 0, w: 40, h: 40 }, { id: 'b', kind: 'circle', cx: 0, cy: 0, r: 15 }, { id: 'c', kind: 'polygon', cx: 0, cy: 0, r: 5, sides: 6 }]),
    { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new' }]);
  near(vol(r), (1600 - Math.PI * 225 + 1.5 * Math.sqrt(3) * 25) * 10, 15, 'nested volume');
});

test('revolve follows Pappus', () => {
  const r = K.regenerate([sk('s', 'XZ', [{ id: 'q', kind: 'rect', cx: 15, cy: 5, w: 10, h: 10 }]), { id: 'r', type: 'revolve', sketch: 's', axis: 'v', angle: 180, op: 'new' }]);
  near(vol(r), 100 * Math.PI * 15, 10, 'half revolve');
});

test('sample bracket rebuilds without errors', () => {
  const d = sampleDoc();
  const r = K.regenerate(K.resolveFeatures(d.features, K.evalParams(d.params).vars));
  const errors = [...r.status.values()].filter(s => s.state === 'error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  near(vol(r), 82866, 20, 'sample volume');
});

test('expressions and parameters', () => {
  const { vars, errors } = K.evalParams([{ name: 'w', expr: '100' }, { name: 'half', expr: 'w/2 - 2*3' }, { name: 'bad', expr: 'nope + 1' }]);
  assert.equal(vars.half, 44);
  assert.ok(errors.bad);
  assert.equal(K.evalExpr('sqrt(16) + 2^3 * (1+1) mm'), 20);
});
