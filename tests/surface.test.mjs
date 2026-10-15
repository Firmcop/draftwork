// Surface tools in the exact engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const build = d => K.regenerateBrep(K.resolveFeatures(d.features, K.evalParams([]).vars));
const okAll = r => { const e = [...r.status.entries()].filter(([, s]) => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)}, expected ${b.toFixed(3)}`);
const P = (id, x, y) => ({ id, x, y });
// an open L-shaped chain and a separate line on XY
const lineSketch = (id, plane = 'XY', offset = 0, pts = [[0, 0], [20, 0], [20, 10]]) => ({ id, type: 'sketch', name: id, plane, offset, profiles: [],
  geo: { points: pts.map(([x, y], i) => P(id + 'p' + i, x, y)), curves: pts.slice(1).map((_, i) => ({ id: id + 'l' + i, kind: 'line', a: id + 'p' + i, b: id + 'p' + (i + 1) })), cons: [] } });
const body = r => [...r.bodies.values()].at(-1);
const area = b => K.brepProps(b).area;

test('extrude surface from an open chain', () => {
  const r = build({ features: [lineSketch('s'), { id: 'e', type: 'sextrude', sketch: 's', distance: 5 }] }); okAll(r);
  const b = body(r); assert.ok(b.surface, 'is a surface'); near(area(b), 30 * 5, 1e-6, 'area'); near(K.brepProps(b).volume, 0, 1e-9, 'no volume');
});
test('revolve surface, patch, offset, reverse', () => {
  let r = build({ features: [lineSketch('s', 'XZ', 0, [[5, 0], [5, 10]]), { id: 'v', type: 'srevolve', sketch: 's', axis: 'Z', angle: 360 }] }); okAll(r);
  near(area(body(r)), 2 * Math.PI * 5 * 10, 1e-3, 'cylinder wall');
  const sq = { id: 'q', type: 'sketch', name: 'q', plane: 'XY', offset: 0, profiles: [{ id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 10, h: 4 }] };
  r = build({ features: [sq, { id: 'p', type: 'patch', sketch: 'q' }] }); okAll(r); near(area(body(r)), 40, 1e-6, 'patch');
  const top = [...K.brepSigMap(body(r), 'face').values()][0];
  r = build({ features: [sq, { id: 'p', type: 'patch', sketch: 'q' }, { id: 'o', type: 'soffset', edges: [top], distance: 3 }, { id: 'rv', type: 'reverse', body: 'p' }] }); okAll(r);
  assert.equal(r.bodies.size, 2);
});
test('loft, sweep and stitch into a solid', () => {
  let r = build({ features: [lineSketch('a', 'XY', 0, [[0, 0], [10, 0]]), lineSketch('b', 'XY', 10, [[0, 5], [10, 5]]), { id: 'l', type: 'sloft', sketches: ['a', 'b'], ruled: true }] }); okAll(r);
  near(area(body(r)), 10 * Math.hypot(5, 10), 1e-3, 'ruled loft');
  r = build({ features: [lineSketch('a', 'XY', 0, [[0, 0], [0, 4]]), lineSketch('pp', 'YZ', 0, [[0, 0], [0, 12]]), { id: 'w', type: 'ssweep', sketch: 'a', path: 'pp' }] }); okAll(r);
  near(area(body(r)), 4 * 12, 1e-3, 'swept strip');
  // a box: six patches stitched into a solid
  const feats = [{ id: 'bx', type: 'box', name: 'B', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 10, d: 10, h: 10, op: 'new' }, { id: 'u', type: 'unstitch', body: 'bx' }];
  r = build({ features: feats }); okAll(r); assert.equal(r.bodies.size, 6, 'six face bodies');
  const ids = [...r.bodies.keys()];
  r = build({ features: [...feats, { id: 'st', type: 'stitch', bodies: ids }] }); okAll(r);
  assert.equal(r.bodies.size, 1); near(K.brepProps(body(r)).volume, 1000, 1e-6, 'stitched solid volume');
});
test('trim, delete face, untrim, ruled, extend', () => {
  const base = [lineSketch('s', 'XY', 0, [[-10, 0], [10, 0]]), { id: 'e', type: 'sextrude', sketch: 's', distance: 10 }];
  let r = build({ features: [...base, { id: 't', type: 'trim', body: 'e', tool: 'YZ', keep: 'positive' }] }); okAll(r);
  near(area(body(r)), 100, 1e-6, 'trimmed to half');
  const edge = [...K.brepSigMap(body(build({ features: base })), 'edge').values()].find(s => s.type === 'LINE' && Math.abs(s.p[2] - 10) < 1e-6);
  r = build({ features: [...base, { id: 'x', type: 'sextend', edges: [edge], distance: 5 }] }); okAll(r);
  near(area(body(r)), 300, 1e-6, 'extended by 5 mm');
  r = build({ features: [...base, { id: 'rl', type: 'ruled', edges: [edge], distance: 4, mode: 'normal' }] }); okAll(r);
  near(area(body(r)), 80, 1e-6, 'ruled strip');
  // a plate with a hole: untrim the face fills the hole
  const plate = [{ id: 'bx', type: 'box', name: 'B', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 20, d: 20, h: 2, op: 'new' }, { id: 'h', type: 'cylinder', name: 'H', plane: 'XY', offset: 0, cx: 0, cy: 0, diameter: 6, h: 2, op: 'cut' }];
  r = build({ features: plate });
  const topF = [...K.brepSigMap(body(r), 'face').values()].find(s => s.type === 'PLANE' && Math.abs(s.c[2] - 2) < 1e-6);
  r = build({ features: [...plate, { id: 'd', type: 'deleteface', edges: [topF] }] }); okAll(r);
  assert.ok(body(r).surface, 'deleting a face leaves a surface');
  const r2 = build({ features: [...plate, { id: 'ut', type: 'untrim', edges: [topF] }] }); okAll(r2);
  near(area(body(r2)) - area(body(build({ features: plate }))), Math.PI * 9, 1e-3, 'untrim fills the hole');
});
