// Imports are classified: editable solids, surface models, mixed files (nothing dropped), and mesh kinds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true }), RC = K.getRC();
const step = async items => K.brepSTEP(items).text();
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/classify.js'), 'utf8');
const h = (t, a, ...k) => ({ t, k });
const { stepKind, meshKind } = (0, eval)('(() => {' + src + '; return { stepKind, meshKind }; })()');

test('solid file: editable solids', async () => {
  await K.brepImportSTEP('a', await step([{ shape: RC.makeBaseBox(10, 10, 10), name: 'Box' }]));
  const r = K.regenerateBrep([{ id: 'i', type: 'import', file: 'a' }]);
  assert.equal(r.bodies.size, 1);
  assert.ok(!r.bodies.get('i').surface);
});

test('surface model and mixed file: surfaces are kept as surface bodies, not dropped', async () => {
  const box = RC.makeBaseBox(10, 10, 10), faces = RC.makeCompound(box.faces.slice(0, 3));
  await K.brepImportSTEP('s', await step([{ shape: faces, name: 'Skin' }]));
  let r = K.regenerateBrep([{ id: 'i', type: 'import', file: 's' }]);
  assert.ok(r.bodies.size >= 1 && [...r.bodies.values()].every(b => b.surface), 'surface-only file gives surface bodies');
  await K.brepImportSTEP('m', await step([{ shape: RC.makeBaseBox(10, 10, 10).translate(50, 0, 0), name: 'Block' }, { shape: faces, name: 'Skin' }]));
  r = K.regenerateBrep([{ id: 'i', type: 'import', file: 'm' }]);
  const kinds = [...r.bodies.values()].map(b => b.surface ? 'surface' : 'solid').sort();
  assert.deepEqual([...new Set(kinds)], ['solid', 'surface'], 'mixed file keeps both the solid and the loose faces: ' + kinds);
});

test('page labels for imports and meshes', () => {
  assert.equal(stepKind({ solids: 2, repaired: 0, invalid: 0, surfaces: 0 }).kind, 'solid');
  assert.equal(stepKind({ solids: 1, surfaces: 3 }).kind, 'mixed');
  assert.match(stepKind({ solids: 0, surfaces: 1 }).next, /Stitch|Thicken/);
  assert.equal(meshKind({ tris: 12, boundary: 0, nonManifold: 0 }).kind, 'watertight');
  assert.equal(meshKind({ tris: 10, boundary: 3, nonManifold: 0 }).kind, 'open');
  assert.equal(meshKind({ tris: 10, boundary: 0, nonManifold: 2 }).kind, 'nonmanifold');
  assert.equal(meshKind({ tris: 50000, boundary: 0, nonManifold: 0 }).kind, 'watertight-large');
});

test('converting an open mesh says the result is a surface', () => {
  // an open box (no top): 10 triangles
  const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  const F = [[0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const st = 'solid t\n' + F.map(t => 'facet normal 0 0 0\nouter loop\n' + t.map(i => 'vertex ' + v[i].join(' ')).join('\n') + '\nendloop\nendfacet').join('\n') + '\nendsolid t\n';
  const m = K.parseSTL(new TextEncoder().encode(st));
  assert.equal(K.meshStats(m).closed, false);
  K.importMeshes.set('open', m);
  const r = K.regenerateBrep([{ id: 'mi', type: 'meshinsert', file: 'open', units: 'mm', center: false }, { id: 'mc', type: 'meshconvert', body: 'mi', method: 'faceted' }]);
  assert.equal(r.status.get('mc').state, 'ok');
  assert.match(r.status.get('mc').warn || '', /surface, not a solid/);
});
