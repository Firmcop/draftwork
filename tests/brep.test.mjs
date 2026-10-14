// Exact (OpenCascade) kernel: volumes, fillet/chamfer/shell, persistent edge references, STEP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels, sampleDoc } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const vols = r => [...r.bodies.values()].map(b => K.brepProps(b).volume);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(2)}, expected ${b.toFixed(2)} ± ${tol}`);
const okAll = r => { const e = [...r.status.values()].filter(s => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const build = (d, params = d.params) => K.regenerateBrep(K.resolveFeatures(d.features, K.evalParams(params).vars));

test('sample bracket is exact', () => {
  const r = build(sampleDoc());
  okAll(r);
  near(vols(r)[0], 82866.3, 0.5, 'sample volume');
});

test('fillet survives an upstream parameter change', () => {
  const d = sampleDoc();
  let r = build(d);
  const body = [...r.bodies.values()][0];
  const junction = [...K.brepSigMap(body, 'edge').values()].find(s => Math.abs(s.p[2] - 10) < 1e-3 && Math.abs(Math.hypot(s.p[0], s.p[1]) - 20) < 1e-3);
  assert.ok(junction, 'boss/plate junction edge exists');
  d.features.push({ id: 'f1', type: 'fillet', name: 'Fillet 1', edges: [junction], radius: 3 });
  r = build(d); okAll(r);
  const filleted = vols(r)[0];
  assert.ok(filleted > 82866.3, 'a concave fillet adds material');
  d.params.find(p => p.name === 'boss_h').expr = '35';
  r = build(d); okAll(r);
  near(vols(r)[0] - filleted, Math.PI * 400 * 10 - Math.PI * 36 * 10, 0.5, 'taller boss keeps its fillet');
});

test('shell removes the picked face with exact walls', () => {
  const f = [{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' }];
  const r0 = K.regenerateBrep(f);
  const top = [...K.brepSigMap([...r0.bodies.values()][0], 'face').values()].find(s => Math.abs(s.c[2] - 20) < 1e-3);
  const r = K.regenerateBrep([...f, { id: 's', type: 'shell', edges: [top], thickness: 2 }]);
  okAll(r);
  near(vols(r)[0], 40 * 30 * 20 - 36 * 26 * 18, 0.01, 'shell volume');
});

test('primitives and patterns', () => {
  const r = K.regenerateBrep([
    { id: 't', type: 'torus', plane: 'XY', cx: 60, cy: 0, major: 30, minor: 8, op: 'new' },
    { id: 'p', type: 'pattern', kind: 'circular', source: 't', axis: 'Z', count: 3, angle: 360 },
  ]);
  okAll(r);
  const torus = 2 * Math.PI ** 2 * 15 * 16;
  for (const v of vols(r)) near(v, torus, 0.01, 'torus copy');
  assert.equal(r.bodies.size, 3);
});

test('STEP export contains solids', async () => {
  const r = build(sampleDoc());
  const text = await K.brepSTEP([...r.bodies.values()].map(b => ({ shape: b.shape, name: b.name }))).text();
  assert.match(text, /^ISO-10303-21;/);
  assert.match(text, /MANIFOLD_SOLID_BREP/);
});
