// Mesh bodies: STL/OBJ import, tessellate, repair, reduce, remesh, smooth, plane cut, convert to B-rep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const build = feats => K.regenerateBrep(K.resolveFeatures(feats, K.evalParams([]).vars));
const okAll = r => { const e = [...r.status.entries()].filter(([, s]) => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)}, expected ${b.toFixed(4)}`);
const mesh = r => [...r.mbodies.values()].at(-1);
// ascii STL cube 10 mm
const cubeSTL = () => {
  const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return 'solid c\n' + f.map(t => 'facet normal 0 0 0\nouter loop\n' + t.map(i => `vertex ${v[i].join(' ')}`).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid c\n';
};
K.importMeshes.set('cube', K.parseSTL(new TextEncoder().encode(cubeSTL())));
const ins = { id: 'm', type: 'meshinsert', name: 'Cube', file: 'cube', units: 'mm', center: false };

test('STL import is a closed 12-triangle mesh of 1000 mm³', () => {
  const r = build([ins]); okAll(r);
  const m = mesh(r), s = K.meshStats(m);
  assert.equal(s.tris, 12); assert.ok(s.closed); near(K.meshVolume(m), 1000, 1e-6, 'volume');
});
test('remesh refines, reduce brings it back, smooth keeps it closed', () => {
  let r = build([ins, { id: 'rm', type: 'remesh', name: 'R', edge: 2 }]); okAll(r);
  const n1 = mesh(r).idx.length / 3; assert.ok(n1 > 200, 'refined to ' + n1); near(K.meshVolume(mesh(r)), 1000, 1, 'remesh keeps volume');
  r = build([ins, { id: 'rm', type: 'remesh', name: 'R', edge: 2 }, { id: 'rd', type: 'reduce', name: 'D', percent: 10 }]); okAll(r);
  const n2 = mesh(r).idx.length / 3; assert.ok(n2 <= n1 * 0.12, `reduced ${n1} -> ${n2}`); near(K.meshVolume(mesh(r)), 1000, 5, 'flat faces survive reduction');
  r = build([ins, { id: 'rm', type: 'remesh', name: 'R', edge: 2 }, { id: 's', type: 'smooth', name: 'S', iterations: 3, strength: 0.5 }]); okAll(r);
  assert.ok(K.meshStats(mesh(r)).closed, 'still closed');
});
test('plane cut + cap, repair fills holes, convert to a solid', () => {
  let r = build([ins, { id: 'pc', type: 'meshplane', name: 'Cut', tool: 'XY', keep: 'positive', fill: true }]); okAll(r);
  const XYoff = { id: 'pl', type: 'plane', name: 'P', base: 'XY', offset: 4, flip: false };
  r = build([ins, XYoff, { id: 'pc', type: 'meshplane', name: 'Cut', tool: 'pl', keep: 'negative', fill: true }]); okAll(r);
  near(K.meshVolume(mesh(r)), 400, 1e-3, 'bottom 4 mm kept and capped');
  r = build([ins, XYoff, { id: 'pc', type: 'meshplane', name: 'Cut', tool: 'pl', keep: 'negative', fill: false }, { id: 'rp', type: 'meshrepair', name: 'Rep' }]); okAll(r);
  assert.ok(K.meshStats(mesh(r)).closed, 'repair closes the opening'); near(K.meshVolume(mesh(r)), 400, 1e-3, 'repaired volume');
  r = build([ins, { id: 'cv', type: 'meshconvert', name: 'Conv', method: 'prismatic' }]); okAll(r);
  const b = [...r.bodies.values()][0]; near(K.brepProps(b).volume, 1000, 1e-6, 'converted solid'); assert.equal(K.brepSigMap(b, 'face').size, 6, 'prismatic: 6 faces');
  r = build([{ id: 'bx', type: 'box', name: 'B', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 10, d: 10, h: 10, op: 'new' }, { id: 't', type: 'tessellate', name: 'T', body: 'bx' }]); okAll(r);
  assert.equal(r.bodies.size, 0); near(K.meshVolume(mesh(r)), 1000, 1e-6, 'tessellated box'); assert.ok(K.meshStats(mesh(r)).closed, 'welded closed');
});
test('form: subdivided box is a closed smooth body; edits move the cage', () => {
  const f = { id: 'fm', type: 'form', name: 'Form', plane: 'XY', offset: 0, cx: 0, cy: 0, prim: 'box', w: 20, d: 20, h: 20, nx: 2, ny: 2, nz: 2, level: 2, edits: {} };
  let r = build([f]); okAll(r);
  const m = mesh(r), s = K.meshStats(m), v = K.meshVolume(m);
  assert.ok(s.closed, 'closed'); assert.ok(v > 3000 && v < 8000, 'rounded cube volume ' + v);
  const cage = K.formCage(f), top = cage.pos.findIndex(p => Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - 20) < 1e-9);
  r = build([{ ...f, edits: { [top]: [0, 0, 15] } }]); okAll(r);
  assert.ok(K.meshVolume(mesh(r)) > v + 300, 'pulling the top centre up adds volume');
  r = build([{ ...f, prim: 'torus', w: 40, h: 10, nx: 2, ny: 2 }]); okAll(r); assert.ok(K.meshStats(mesh(r)).closed, 'torus closed');
  r = build([{ ...f, prim: 'cylinder', w: 20, h: 30, nx: 2, nz: 2 }]); okAll(r); assert.ok(K.meshStats(mesh(r)).closed, 'cylinder closed');
  r = build([{ ...f, prim: 'plane', w: 30, d: 30, nx: 3, ny: 3, level: 2 }]); okAll(r); assert.ok(!K.meshStats(mesh(r)).closed, 'plane is open');
  r = build([{ ...f, output: 'solid', level: 1 }]); okAll(r); assert.equal(r.bodies.size, 1, 'form as a solid');
});
