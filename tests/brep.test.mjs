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

test('press pull offsets curved faces: holes shrink or grow, bosses thicken', () => {
  const f = [{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 40, h: 20, op: 'new' }, { id: 'c', type: 'cylinder', plane: 'XY', cx: 0, cy: 0, diameter: 10, h: 20, op: 'cut' }];
  const body = [...K.regenerateBrep(f).bodies.values()][0];
  const hole = [...K.brepSigMap(body, 'face').values()].find(s => s.type !== 'PLANE');
  let r = K.regenerateBrep([...f, { id: 'p', type: 'presspull', edges: [hole], distance: -1 }]); okAll(r);
  near(vols(r)[0], 32000 - Math.PI * 36 * 20, 0.01, 'hole radius 5 → 6');
  r = K.regenerateBrep([...f, { id: 'p', type: 'presspull', edges: [hole], distance: 1.5 }]); okAll(r);
  near(vols(r)[0], 32000 - Math.PI * 3.5 ** 2 * 20, 0.01, 'hole radius 5 → 3.5');
  const g = [{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 40, h: 10, op: 'new' }, { id: 'c', type: 'cylinder', plane: 'XY', offset: 0, cx: 0, cy: 0, diameter: 10, h: 25, op: 'join' }];
  const b2 = [...K.regenerateBrep(g).bodies.values()][0];
  const boss = [...K.brepSigMap(b2, 'face').values()].find(s => s.type !== 'PLANE');
  r = K.regenerateBrep([...g, { id: 'p', type: 'presspull', edges: [boss], distance: 2 }]); okAll(r);
  near(vols(r)[0], 16000 + Math.PI * 49 * 15, 0.01, 'boss radius 5 → 7 above the plate');
  r = K.regenerateBrep([...f, { id: 'p', type: 'presspull', edges: [hole], distance: 6 }]);
  assert.equal(r.status.get('p').state, 'error', 'closing a hole past its axis is refused');
});

test('round edges carry their center and axis (joint origins)', () => {
  const r = K.regenerateBrep([{ id: 'c', type: 'cylinder', plane: 'XY', cx: 12, cy: -3, diameter: 10, h: 20, op: 'new' }]);
  const circles = [...K.brepSigMap([...r.bodies.values()][0], 'edge').values()].filter(s => s.type === 'CIRCLE');
  assert.ok(circles.length >= 2, 'rims found (OCC may split each into arcs)');
  for (const s of circles) {
    near(s.cc[0], 12, 1e-6, 'center x'); near(s.cc[1], -3, 1e-6, 'center y');
    near(Math.abs(s.ax[2]), 1, 1e-9, 'axis along Z');
  }
  near(Math.max(...circles.map(s => s.cc[2])), 20, 1e-6, 'top rim at z = 20');
});

test('cylinder faces report their axis and radius; straight edges their end points', () => {
  const r = K.regenerateBrep([{ id: 'c', type: 'cylinder', plane: 'XY', cx: 12, cy: -3, diameter: 10, h: 20, op: 'new' }]);
  const b = [...r.bodies.values()][0];
  const cyl = [...K.brepSigMap(b, 'face').values()].find(s => s.type === 'CYLINDRE');
  near(Math.abs(cyl.ax[2]), 1, 1e-9, 'axis along Z'); near(cyl.ap[0], 12, 1e-6, 'axis x'); near(cyl.ap[1], -3, 1e-6, 'axis y'); near(cyl.r, 5, 1e-6, 'radius');
  const box = K.regenerateBrep([{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' }]);
  const line = [...K.brepSigMap([...box.bodies.values()][0], 'edge').values()].find(s => s.type === 'LINE');
  near(Math.hypot(...line.a.map((v, i) => v - line.b[i])), line.len, 1e-9, 'end points span the edge');
});

test('construction planes, axes and points drive revolve, pattern and mirror', () => {
  // plane at 90° about the XY plane's X direction = the XZ plane (normal along ∓Y)
  let r = K.regenerateBrep([{ id: 'p', type: 'plane', mode: 'angle', base: 'XY', axis: 'u', angle: 90 }]);
  const pa = r.planes.get('p').base; near(Math.abs(pa.n[1]), 1, 1e-9, 'plane at angle turned onto XZ');
  // midplane between z=0 and z=20
  r = K.regenerateBrep([{ id: 'o', type: 'plane', base: 'XY', offset: 20 }, { id: 'm', type: 'plane', mode: 'mid', base: 'XY', base2: 'o' }]);
  near(r.planes.get('m').base.o[2], 10, 1e-9, 'midplane halfway');
  // axis where XZ and YZ meet = Z axis
  r = K.regenerateBrep([{ id: 'a', type: 'axis', mode: 'planes', base: 'XZ', base2: 'YZ' }]);
  near(Math.abs(r.axes.get('a').d[2]), 1, 1e-9, 'two planes meet along Z');
  // revolve a 10×10 square at x 20..30 around an axis parallel to Y through x = 10 → ring of radii 10..20, height 10
  const sq = { id: 's', type: 'sketch', plane: 'XY', profiles: [{ id: 'q', kind: 'rect', cx: 25, cy: 5, w: 10, h: 10, r: 0, rot: 0 }] };
  r = K.regenerateBrep([{ id: 'ax', type: 'axis', mode: 'two', p1: [10, 0, 0], p2: [10, 1, 0] }, sq, { id: 'rv', type: 'revolve', sketch: 's', axis: 'ax', angle: 360, op: 'new' }]);
  okAll(r); near(vols(r)[0], Math.PI * (400 - 100) * 10, 0.5, 'revolve around a construction axis');
  // circular pattern of a small box around an axis through (50,0) along Z: 4 copies, same volume each
  r = K.regenerateBrep([{ id: 'ax', type: 'axis', mode: 'two', p1: [50, 0, 0], p2: [50, 0, 1] }, { id: 'b', type: 'box', plane: 'XY', cx: 60, cy: 0, w: 4, d: 4, h: 4, op: 'new' },
    { id: 'pt', type: 'pattern', kind: 'circular', source: 'b', axis: 'ax', count: 4, angle: 360 }]);
  okAll(r); assert.equal(r.bodies.size, 4, 'four bodies around the axis');
  const xs = [...r.bodies.values()].map(b => K.brepProps(b).com.x).sort((a, b) => a - b);
  near(xs[0], 40, 1e-6, 'one copy opposite, at x = 40');
  // mirror about a construction plane at x = 30
  r = K.regenerateBrep([{ id: 'pl', type: 'plane', base: 'YZ', offset: 30 }, { id: 'b', type: 'box', plane: 'XY', cx: 10, cy: 0, w: 4, d: 4, h: 4, op: 'new' }, { id: 'mi', type: 'mirror', source: 'b', plane: 'pl' }]);
  okAll(r); const mx = [...r.bodies.values()].map(b => K.brepProps(b).com.x).sort((a, b) => a - b);
  near(mx[1], 50, 1e-6, 'mirror copy at x = 50');
});

test('split body, scale, thicken, replace face, align, pattern on path, boundary fill', () => {
  const box = { id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 20, h: 10, op: 'new' };
  let r = K.regenerateBrep([box, { id: 's', type: 'splitbody', body: 'b', tool: 'YZ' }]); okAll(r);
  assert.equal(r.bodies.size, 2, 'split into two'); near(vols(r)[0], 4000, 1e-6, 'half'); near(vols(r)[1], 4000, 1e-6, 'other half');
  r = K.regenerateBrep([box, { id: 'k', type: 'scale', body: 'b', factor: 2, center: 'origin' }]); okAll(r);
  near(vols(r)[0], 8000 * 8, 1e-3, 'scale ×2 gives 8× volume');
  const sigs = [...K.brepSigMap([...K.regenerateBrep([box]).bodies.values()][0], 'face').values()];
  const top = sigs.find(s => Math.abs(s.c[2] - 10) < 1e-6), side = sigs.find(s => Math.abs(s.c[0] - 20) < 1e-6);
  r = K.regenerateBrep([box, { id: 't', type: 'thicken', edges: [top], thickness: 3, side: 'out', op: 'new' }]); okAll(r);
  near(vols(r)[1], 40 * 20 * 3, 1e-6, 'thicken the top face 3 mm into a new body');
  r = K.regenerateBrep([box, { id: 'pl', type: 'plane', base: 'XY', offset: 25 }, { id: 'rf', type: 'replaceface', edges: [top], target: 'pl' }]); okAll(r);
  near(vols(r)[0], 40 * 20 * 25, 1e-6, 'replace the top face with a plane at z = 25');
  // align: a 10 mm cube's bottom face onto the box top (face to face)
  const cube = { id: 'c', type: 'box', plane: 'XY', cx: 60, cy: 0, w: 10, d: 10, h: 10, op: 'new' };
  const cs = [...K.brepSigMap([...K.regenerateBrep([box, cube]).bodies.values()][1], 'face').values()];
  const cubeBottom = cs.find(s => Math.abs(s.c[2]) < 1e-6);
  r = K.regenerateBrep([box, cube, { id: 'al', type: 'align', body: 'c', a: { body: 'c', sig: cubeBottom }, b: { body: 'b', sig: top } }]); okAll(r);
  const com = K.brepProps([...r.bodies.values()][1]).com;
  near(com.x, 0, 1e-6, 'aligned cube centred on the top face'); near(com.z, 15, 1e-6, 'sitting on it');
  // pattern on path: a straight 30 mm path, 4 copies of a small box
  const path = { id: 'pa', type: 'sketch', plane: 'XY', profiles: [], geo: { points: [{ id: 'p1', x: 0, y: 40 }, { id: 'p2', x: 30, y: 40 }], curves: [{ id: 'l', kind: 'line', a: 'p1', b: 'p2' }], cons: [] } };
  r = K.regenerateBrep([path, { id: 'm', type: 'box', plane: 'XY', cx: 0, cy: 40, w: 2, d: 2, h: 2, op: 'new' }, { id: 'pp', type: 'patpath', source: 'm', path: 'pa', count: 4, spacing: 'fill' }]); okAll(r);
  const px = [...r.bodies.values()].map(b => K.brepProps(b).com.x).sort((a, b) => a - b);
  assert.equal(px.length, 4); near(px[3], 30, 1e-6, 'last copy at the end of the path'); near(px[1], 10, 1e-6, 'evenly spaced');
  // boundary fill: the cavity inside a hollow box
  r = K.regenerateBrep([box, { id: 'sh', type: 'shell', edges: [], thickness: 2 }]);
  const hollow = [{ id: 'o', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 20, h: 10, op: 'new' }, { id: 'i', type: 'box', plane: 'XY', offset: 2, cx: 0, cy: 0, w: 36, d: 16, h: 6, op: 'cut', target: 'o' }];
  r = K.regenerateBrep([...hollow, { id: 'bf', type: 'boundary', bodies: ['o'] }]); okAll(r);
  near(vols(r).find(v => Math.abs(v - 36 * 16 * 6) < 1e-3) || 0, 36 * 16 * 6, 1e-3, 'boundary fill finds the enclosed cavity');
});

test('coil, modeled thread, web, rib and emboss', () => {
  // coil: circle section 3 mm, Ø20, 4 turns, pitch 5
  let r = K.regenerateBrep([{ id: 'co', type: 'coil', plane: 'XY', cx: 0, cy: 0, diameter: 20, mode: 'revs-pitch', revolutions: 4, pitch: 5, section: 'circle', section_size: 3, position: 'center', op: 'new' }]); okAll(r);
  near(vols(r)[0], Math.PI * 1.5 * 1.5 * Math.hypot(2 * Math.PI * 10, 5) * 4, 2, 'coil volume = section area × helix length');
  // modeled thread on an M12 shaft removes material in a groove
  const shaft = { id: 's', type: 'cylinder', plane: 'XY', cx: 0, cy: 0, diameter: 12, h: 20, op: 'new' };
  const cyl = [...K.brepSigMap([...K.regenerateBrep([shaft]).bodies.values()][0], 'face').values()].find(s => s.type === 'CYLINDRE');
  r = K.regenerateBrep([shaft, { id: 'th', type: 'thread', edges: [cyl], modeled: true, full: true }]); okAll(r);
  const v0 = Math.PI * 36 * 20; assert.ok(vols(r)[0] < v0 - 50 && vols(r)[0] > v0 * 0.8, 'thread cut a groove: ' + vols(r)[0]);
  r = K.regenerateBrep([shaft, { id: 'th', type: 'thread', edges: [cyl], modeled: false }]); okAll(r);
  near(vols(r)[0], v0, 1e-6, 'cosmetic thread leaves the solid alone');
  // web: an L of two 20 mm lines, 2 mm thick, 10 deep
  const sk = { id: 'w', type: 'sketch', plane: 'XY', profiles: [], geo: { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 20, y: 0 }, { id: 'c', x: 20, y: 20 }], curves: [{ id: 'l1', kind: 'line', a: 'a', b: 'b' }, { id: 'l2', kind: 'line', a: 'b', b: 'c' }], cons: [] } };
  r = K.regenerateBrep([sk, { id: 'we', type: 'web', sketch: 'w', thickness: 2, depth: 10, direction: 'one', op: 'new' }]); okAll(r);
  near(vols(r)[0], (22 * 2 + 22 * 2 - 4) * 10, 1, 'web walls (overlapping corner counted once)');
  // rib: an L bracket (base 40×20×5, wall 5×20×40), a diagonal line on the mid plane fills the corner
  const bracket = [{ id: 'base', type: 'box', plane: 'XY', cx: 20, cy: 0, w: 40, d: 20, h: 5, op: 'new' }, { id: 'wall', type: 'box', plane: 'XY', cx: 2.5, cy: 0, w: 5, d: 20, h: 40, op: 'join' }];
  const ribSk = { id: 'rs', type: 'sketch', plane: 'XZ', profiles: [], geo: { points: [{ id: 'p', x: 5, y: 35 }, { id: 'q', x: 35, y: 5 }], curves: [{ id: 'd', kind: 'line', a: 'p', b: 'q' }], cons: [] } };
  const before = K.regenerateBrep(bracket); const vb = vols(before)[0];
  r = K.regenerateBrep([...bracket, ribSk, { id: 'ri', type: 'rib', sketch: 'rs', thickness: 4 }]); okAll(r);
  near(vols(r)[0] - vb, 30 * 30 / 2 * 4, 1, 'rib fills the triangular corner (30×30/2 × 4 mm)');
  // emboss: a 10×10 square profile 1 mm out of the top face of a plate
  const plate = { id: 'pl', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 40, d: 40, h: 5, op: 'new' };
  const topF = [...K.brepSigMap([...K.regenerateBrep([plate]).bodies.values()][0], 'face').values()].find(s => Math.abs(s.c[2] - 5) < 1e-6);
  const sq = { id: 'es', type: 'sketch', plane: 'XY', offset: 5, profiles: [{ id: 'q', kind: 'rect', cx: 0, cy: 0, w: 10, h: 10, r: 0, rot: 0 }] };
  r = K.regenerateBrep([plate, sq, { id: 'em', type: 'emboss', sketch: 'es', edges: [topF], depth: 1, mode: 'emboss' }]); okAll(r);
  near(vols(r)[0], 40 * 40 * 5 + 100, 1e-3, 'emboss adds 10×10×1');
  r = K.regenerateBrep([plate, sq, { id: 'em', type: 'emboss', sketch: 'es', edges: [topF], depth: 1, mode: 'deboss' }]); okAll(r);
  near(vols(r)[0], 40 * 40 * 5 - 100, 1e-3, 'deboss removes 10×10×1');
});

test('sketch text extrudes into letters with holes', () => {
  const d = { params: [], features: [
    { id: 's', type: 'sketch', name: 'Sketch 1', plane: 'XY', offset: 0, profiles: [], texts: [{ id: 't1', str: 'OI', x: 0, y: 0, h: 10, angle: 0 }] },
    { id: 'e', type: 'extrude', name: 'Extrude 1', sketch: 's', distance: 2, direction: 'one', op: 'new' }] };
  const r = build(d); okAll(r);
  const v = vols(r);
  // 'O' has a counter (hole) and 'I' is a bar: roughly cap height 10, stroke ~1.3 mm
  assert.ok(v.length >= 1 && v.reduce((a, b) => a + b, 0) > 40 && v.reduce((a, b) => a + b, 0) < 200, 'letters have plausible volume: ' + v.join(', '));
});

test('split face cuts only the picked face', () => {
  const d = { params: [], features: [{ id: 'b', type: 'box', name: 'B', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 20, h: 10, op: 'new' }] };
  let r = build(d);
  const body = [...r.bodies.values()][0];
  const top = [...K.brepSigMap(body, 'face').values()].find(s => s.type === 'PLANE' && Math.abs(s.c[2] - 10) < 1e-6);
  d.features.push({ id: 'sf', type: 'splitface', name: 'Split Face 1', edges: [top], tool: 'YZ' });
  r = build(d); okAll(r);
  const b2 = [...r.bodies.values()][0];
  assert.equal(K.brepSigMap(b2, 'face').size, 7, 'six faces + the top split in two');
  near(K.brepProps(b2).volume, 8000, 1e-6, 'volume unchanged');
});

test('a run of cuts is applied as one boolean with the same result, and edits inside the run rebuild correctly', () => {
  const plate = { id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 200, d: 120, h: 12, op: 'new' };
  const holes = Array.from({ length: 24 }, (_, k) => ({ id: 'h' + k, type: 'hole', plane: 'XY', offset: 12, flip: false, cx: -75 + (k % 6) * 30, cy: -45 + Math.floor(k / 6) * 30, diameter: 6, depth: 8, tip: true, holeType: 'cbore', cbDiameter: 10, cbDepth: 3 }));
  const cut = { id: 'c', type: 'cylinder', plane: 'XY', offset: 0, cx: 90, cy: 50, diameter: 10, h: 12, op: 'cut' };
  const fil = { id: 'x', type: 'box', plane: 'XY', cx: 120, cy: 0, w: 10, d: 10, h: 10, op: 'join' };   // a join ends the run
  const feats = [plate, ...holes, cut, fil, { ...holes[0], id: 'late', cx: 120, cy: 0, depth: 5 }];
  globalThis.BREP_NO_BATCH = true; const seq = K.regenerateBrep(feats); globalThis.BREP_NO_BATCH = false;
  const bat = K.regenerateBrep(feats);
  okAll(seq); okAll(bat);
  assert.deepEqual(vols(bat).map(v => v.toFixed(4)), vols(seq).map(v => v.toFixed(4)), 'same volumes');
  assert.equal([...bat.bodies.values()][0].shape.faces.length, [...seq.bodies.values()][0].shape.faces.length, 'same faces');
  assert.ok(bat.tools.get('h5')?.shape, 'each hole keeps its tool for previews');
  // incremental rebuilds with the cache: editing a hole in the middle of the run
  const cache = [];
  K.regenerateBrep(feats, null, cache);
  const edited = feats.map(f => f.id === 'h7' ? { ...f, diameter: 4 } : f);
  const inc = K.regenerateBrep(edited, null, cache), fresh = K.regenerateBrep(edited);
  near(vols(inc)[0], vols(fresh)[0], 1e-6, 'cached rebuild after editing a hole');
  // rolling back into the run
  const rb = K.regenerateBrep(feats, 5, cache);
  globalThis.BREP_NO_BATCH = true; const rbs = K.regenerateBrep(feats, 5); globalThis.BREP_NO_BATCH = false;
  near(vols(rb)[0], vols(rbs)[0], 1e-6, 'rolled back inside the run');
  // a cut that misses reports its own error and the rest still apply
  const miss = K.regenerateBrep([plate, holes[0], { ...holes[1], id: 'm', cx: 900 }, holes[2]]);
  assert.equal(miss.status.get('m').state, 'error');
  assert.equal(miss.status.get('h2').state, 'ok');
});
