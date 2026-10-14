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

test('draft tapers picked faces about a neutral plane', () => {
  const f = [{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 20, d: 20, h: 20, op: 'new' }];
  const r0 = K.regenerateBrep(f);
  const sides = [...K.brepSigMap([...r0.bodies.values()][0], 'face').values()].filter(s => Math.abs(s.n[2]) < 0.1);
  assert.equal(sides.length, 4);
  const r = K.regenerateBrep([...f, { id: 'd', type: 'draft', edges: sides, angle: 5, neutral: 'XY' }]);
  okAll(r);
  const t = 20 - 2 * 20 * Math.tan(5 * Math.PI / 180);
  near(vols(r)[0], 20 / 3 * (400 + t * t + 20 * t), 0.1, 'frustum volume');
});

test('loft between two sketches on different planes', () => {
  const r = K.regenerateBrep([
    { id: 's1', type: 'sketch', plane: 'XY', profiles: [{ id: 'a', kind: 'circle', cx: 0, cy: 0, r: 10 }] },
    { id: 'p', type: 'plane', base: 'XY', offset: 30 },
    { id: 's2', type: 'sketch', plane: 'p', profiles: [{ id: 'b', kind: 'circle', cx: 0, cy: 0, r: 5 }] },
    { id: 'l', type: 'loft', sketches: ['s1', 's2'], ruled: true, op: 'new' },
  ]);
  okAll(r);
  near(vols(r)[0], Math.PI * 30 / 3 * (100 + 25 + 50), 0.5, 'ruled loft of two circles is a cone frustum');
});

test('sketch on an angled face via a picked frame', () => {
  const n = new K.THREEns.Vector3(0, -1, 1).normalize();
  const frame = K.frameFromPoint(new K.THREEns.Vector3(0, 0, 0), n);
  const r = K.regenerateBrep([
    { id: 's', type: 'sketch', plane: frame, profiles: [{ id: 'a', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10 }] },
    { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new' },
  ]);
  okAll(r);
  near(vols(r)[0], 1000, 0.01, 'tilted cube');
  const c = [...r.bodies.values()].map(b => K.brepProps(b).com)[0];
  near(c.y, 5 * n.y, 0.01, 'center moved along the tilted normal (y)');
  near(c.z, 5 * n.z, 0.01, 'center moved along the tilted normal (z)');
});

test('STEP import splits solids into bodies', async () => {
  const src = K.regenerateBrep([
    { id: 'a', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 10, d: 10, h: 10, op: 'new' },
    { id: 'b', type: 'sphere', plane: 'XY', cx: 30, cy: 0, diameter: 10, op: 'new' },
  ]);
  const text = await K.brepSTEP([...src.bodies.values()].map(b => ({ shape: b.shape, name: b.name }))).text();
  assert.equal(await K.brepImportSTEP('f1', text), 2);
  const r = K.regenerateBrep([{ id: 'i', type: 'import', file: 'f1', name: 'parts.step' }]);
  okAll(r);
  const v = vols(r).sort((x, y) => x - y);
  near(v[0], 4 / 3 * Math.PI * 125, 0.5, 'sphere'); near(v[1], 1000, 0.01, 'cube');
});

test('sweep and pipe along a sketched path with an arc', () => {
  // path on XZ: up 40, quarter arc R10, across 30
  const geo = {
    points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 40 }, { id: 'c', x: 10, y: 50 }, { id: 'd', x: 40, y: 50 }, { id: 'k', x: 10, y: 40 }],
    curves: [{ id: 'l1', kind: 'line', a: 'a', b: 'b' }, { id: 'r', kind: 'arc', c: 'k', a: 'c', b: 'b' }, { id: 'l2', kind: 'line', a: 'c', b: 'd' }],
    cons: [],
  };
  const L = 40 + Math.PI * 5 + 30;
  const base = [{ id: 'p', type: 'sketch', plane: 'XZ', profiles: [], geo }];
  let r = K.regenerateBrep([...base, { id: 's', type: 'sweep', path: 'p', profileKind: 'circle', diameter: 8, wall: 0, op: 'new' }]);
  okAll(r); near(vols(r)[0], Math.PI * 16 * L, 0.01, 'solid rod');
  r = K.regenerateBrep([...base, { id: 's', type: 'sweep', path: 'p', profileKind: 'circle', diameter: 8, wall: 1, op: 'new' }]);
  okAll(r); near(vols(r)[0], Math.PI * (16 - 9) * L, 0.01, 'pipe with 1 mm wall');
  r = K.regenerateBrep([...base, { id: 'q', type: 'sketch', plane: 'XY', profiles: [{ id: 'sq', kind: 'rect', cx: 0, cy: 0, w: 6, h: 4 }] },
    { id: 's', type: 'sweep', path: 'p', profileKind: 'sketch', profile: 'q', op: 'new' }]);
  okAll(r); near(vols(r)[0], 24 * L, 0.5, 'rectangular profile from a sketch');
});

test('press pull grows or pushes in a flat face', () => {
  const f = [{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' }];
  const sigs = [...K.brepSigMap([...K.regenerateBrep(f).bodies.values()][0], 'face').values()];
  const top = sigs.find(s => Math.abs(s.c[2] - 20) < 1e-3), side = sigs.find(s => Math.abs(s.c[0] - 20) < 1e-3);
  let r = K.regenerateBrep([...f, { id: 'p', type: 'presspull', edges: [top], distance: 5 }]); okAll(r);
  near(vols(r)[0], 40 * 30 * 25, 0.01, 'pull the top up 5 mm');
  r = K.regenerateBrep([...f, { id: 'p', type: 'presspull', edges: [side], distance: -10 }]); okAll(r);
  near(vols(r)[0], 30 * 30 * 20, 0.01, 'push a side in 10 mm');
  r = K.regenerateBrep([...f, { id: 'p', type: 'presspull', edges: [top], distance: 5 }, { id: 'p2', type: 'presspull', edges: [{ ...top, c: [top.c[0], top.c[1], 25] }], distance: -2 }]); okAll(r);
  near(vols(r)[0], 40 * 30 * 23, 0.01, 'a second press pull finds the moved face');
});
