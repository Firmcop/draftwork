// Move/Copy: one body, every body of one feature (a whole imported model), every body; rotation about a pivot;
// older moves (no pivot) still rotate about the origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';
const K = await loadKernels({ exact: true }), RC = K.getRC();
const center = s => { const [a, b] = s.boundingBox.bounds; return a.map((v, i) => Math.round((v + b[i]) / 2 * 1000) / 1000); };
const items = [0, 1, 2].map(k => ({ shape: RC.makeBaseBox(10, 20, 30).translate(100 + k * 50, 0, 0), name: 'P' + k }));
await K.brepImportSTEP('m', await K.brepSTEP(items).text());

test('a whole imported model moves together, rotated about its centre', () => {
  const imp = { id: 'imp', type: 'import', file: 'm' };
  const r0 = K.regenerateBrep([imp]); assert.equal(r0.bodies.size, 3);
  const r = K.regenerateBrep([imp, { id: 'mv', type: 'move', body: 'feat:imp', pivot: [150, 0, 15], rz: 90, dx: 0, dy: 0, dz: 100 }]);
  assert.equal([...r.status.values()].filter(s => s.state !== 'ok').length, 0);
  const cs = [...r.bodies.values()].map(b => center(b.shape)).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(cs, [[150, -50, 115], [150, 0, 115], [150, 50, 115]], 'parts turned 90° about the model centre, lifted 100');
  const vol = [...r.bodies.values()].reduce((s, b) => s + RC.measureVolume(b.shape), 0);
  assert.ok(Math.abs(vol - 3 * 6000) < 1e-6);
});

test('every body, copies, and older moves about the origin', () => {
  const imp = { id: 'imp', type: 'import', file: 'm' };
  const all = K.regenerateBrep([imp, { id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 10, d: 10, h: 10, op: 'new' }, { id: 'mv', type: 'move', body: 'all', dx: 5 }]);
  assert.equal(all.bodies.size, 4);
  assert.deepEqual(center(all.bodies.get('b').shape), [5, 0, 5]);
  const cp = K.regenerateBrep([imp, { id: 'mv', type: 'move', body: 'feat:imp', copy: true, dy: 100 }]);
  assert.equal(cp.bodies.size, 6, 'copy keeps the originals');
  const old = K.regenerateBrep([{ id: 'b', type: 'box', plane: 'XY', cx: 50, cy: 0, w: 10, d: 10, h: 10, op: 'new' }, { id: 'mv', type: 'move', body: 'b', rz: 90 }]);
  assert.deepEqual(center(old.bodies.get('b').shape), [0, 50, 5], 'no pivot: about the origin as before');
});
