// Assembly references (GeometricReferenceService): vertices, edge midpoints, circle centres, cylinder axes and face
// centres taken from real B-rep signatures; ranking near the cursor; re-finding them after the model changes;
// joint suggestions and frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadKernels } from './load-kernels.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-asm-')), 'asmref.mjs');
fs.writeFileSync(tmp, fs.readFileSync(path.join(root, 'src/asmref.js'), 'utf8') + '\nexport { bodyRefs, rankRefs, rematchSig, resolveRef, refFrame, suggestJoint, JOINT_DOF };');
const A = await import(pathToFileURL(tmp).href);
const K = await loadKernels({ exact: true });
const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b}`);
const nearV = (a, b, tol = 1e-6, msg = '') => a.forEach((x, i) => near(x, b[i], tol, msg + '[' + i + ']'));

// 60 × 40 × 10 plate with a Ø12 through hole at (10, 5)
const plate = (w = 60, hx = 10) => [
  { id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w, d: 40, h: 10, op: 'new' },
  { id: 's', type: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: 'c', kind: 'circle', cx: hx, cy: 5, r: 6 }] },
  { id: 'x', type: 'extrude', sketch: 's', distance: 10, op: 'cut' },
];
const sigs = feats => { const r = K.regenerateBrep(feats), rec = [...r.bodies.values()][0]; return { edges: [...K.brepSigMap(rec, 'edge').values()], faces: [...K.brepSigMap(rec, 'face').values()] }; };
const S = sigs(plate());
const top = S.faces.find(f => f.type === 'PLANE' && f.n[2] > 0.99);
const bore = S.faces.find(f => f.type === 'CYLINDRE');

test('references on the top face: corners, edge midpoints, hole centre, face centre', () => {
  const refs = A.bodyRefs(S.edges, top, top.n);
  const at = (t, p) => refs.find(r => r.type === t && Math.hypot(r.p[0] - p[0], r.p[1] - p[1], r.p[2] - p[2]) < 1e-6);
  assert.ok(at('vertex', [30, 20, 10]) && at('vertex', [-30, -20, 0]), 'box corners');
  assert.equal(refs.filter(r => r.type === 'vertex').length, 8, 'each corner once');
  assert.ok(at('midpoint', [0, 20, 10]) && at('midpoint', [30, 0, 10]), 'edge midpoints');
  const hole = refs.filter(r => r.type === 'center' && Math.abs(r.p[2] - 10) < 1e-6);
  assert.equal(hole.length, 1); nearV(hole[0].p, [10, 5, 10], 1e-6, 'hole centre'); nearV(hole[0].z, [0, 0, 1], 1e-9, 'axis points out of the top face');
  const fc = refs.find(r => r.type === 'face'); assert.ok(fc); nearV(fc.z, [0, 0, 1], 1e-9);
  const ax = A.bodyRefs(S.edges, bore, [1, 0, 0]).find(r => r.type === 'axis');
  assert.ok(ax); near(Math.abs(ax.z[2]), 1, 1e-9, 'bore axis is vertical'); near(ax.p[0], 10, 1e-6); near(ax.p[1], 5, 1e-6);
});

test('ranking: a vertex near the cursor beats the face centre; far vertices drop out', () => {
  const refs = A.bodyRefs(S.edges, top, top.n).map(r => ({ ...r, d: r.type === 'face' ? 200 : Math.hypot(r.p[0] - 29, r.p[1] - 19) * 2 }));
  const ranked = A.rankRefs(refs, 16);
  assert.equal(ranked[0].type, 'vertex'); nearV(ranked[0].p, [30, 20, 10]);
  assert.ok(ranked.some(r => r.type === 'face'), 'face centre stays available for cycling');
  assert.ok(!ranked.some(r => r.type === 'vertex' && r.p[0] < 0), 'distant corners are not offered');
});

test('references follow the model: wider plate, moved hole', () => {
  const refs = A.bodyRefs(S.edges, top, top.n);
  const corner = refs.find(r => r.type === 'vertex' && r.p[0] === 30 && r.p[1] === 20 && r.p[2] === 10);
  const mid = refs.find(r => r.type === 'midpoint' && Math.abs(r.p[1] - 20) < 1e-9 && r.p[2] === 10);
  const hole = refs.find(r => r.type === 'center' && Math.abs(r.p[2] - 10) < 1e-6);
  const axis = A.bodyRefs(S.edges, bore, [1, 0, 0]).find(r => r.type === 'axis');
  const S2 = sigs(plate(80, 14));
  nearV(A.resolveRef(corner, S2.edges, S2.faces).p, [40, 20, 10], 1e-6, 'corner moves with the wider plate');
  nearV(A.resolveRef(mid, S2.edges, S2.faces).p, [0, 20, 10], 1e-6, 'midpoint of the longer edge');
  const h2 = A.resolveRef(hole, S2.edges, S2.faces); nearV(h2.p, [14, 5, 10], 1e-6, 'hole centre follows the hole'); nearV(h2.z, [0, 0, 1], 1e-9);
  const a2 = A.resolveRef(axis, S2.edges, S2.faces); near(a2.p[0], 14, 1e-6); near(a2.p[1], 5, 1e-6);
  assert.equal(A.resolveRef(hole, S2.edges.filter(e => e.type !== 'CIRCLE'), S2.faces), null, 'a removed hole is reported, not guessed');
});

test('frames are right-handed with z on the reference direction', () => {
  const F = A.refFrame([1, 2, 3], [0, 0, 2], [1, 1, 0]);
  nearV(F.z, [0, 0, 1]); nearV(F.x, [Math.SQRT1_2, Math.SQRT1_2, 0]);
  const c = [F.x[1] * F.y[2] - F.x[2] * F.y[1], F.x[2] * F.y[0] - F.x[0] * F.y[2], F.x[0] * F.y[1] - F.x[1] * F.y[0]]; nearV(c, F.z, 1e-12, 'x × y = z');
});

test('joint suggestions from the reference types', () => {
  assert.equal(A.suggestJoint('center', 'axis').type, 'revolute');
  assert.equal(A.suggestJoint('axis', 'axis').type, 'cylindrical');
  assert.equal(A.suggestJoint('vertex', 'vertex').type, 'ball');
  assert.equal(A.suggestJoint('face', 'face').type, 'rigid');
  assert.equal(A.JOINT_DOF.cylindrical, 2);
});
