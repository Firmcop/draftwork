// Benchmark STEP files, written to the folder given (default: tests/bench/fixtures, not committed):
//   container20.step  Draftwork's 20 ft container (corrugated side/end walls, doors, posts, rails, floor, roof: 19 solids)
//   parts300.step     300 parts: plates with holes, bolts, filleted brackets (12 MB)
// Usage: node tests/bench/make-fixtures.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernels } from '../load-kernels.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), out = process.argv[2] || path.join(here, 'fixtures');
fs.mkdirSync(out, { recursive: true });
const K = await loadKernels({ exact: true }), RC = K.getRC();
const save = async (name, items) => { const f = path.join(out, name); fs.writeFileSync(f, Buffer.from(await K.brepSTEP(items).arrayBuffer())); console.log(name, items.length, 'solids', (fs.statSync(f).size / 1e6).toFixed(2), 'MB'); };

const src = fs.readFileSync(path.join(here, '../../src/container.js'), 'utf8');
const containerFeatures = (0, eval)('(' + src.slice(src.indexOf('function containerFeatures')) + ')');
const feats = containerFeatures(), r = K.regenerateBrep(K.resolveFeatures(feats, {}));
const names = new Map(feats.map(f => [f.id, f.name]));
await save('container20.step', [...r.bodies.values()].map(b => ({ shape: b.shape, name: names.get(b.feature) || b.name })));

const items = [];
for (let k = 0; k < 300; k++) {
  const x = (k % 20) * 120, y = Math.floor(k / 20) * 120;
  let s;
  if (k % 3 === 0) { s = RC.makeBaseBox(100, 80, 8).translate(x, y, 0); for (let i = 0; i < 4; i++) s = s.cut(RC.makeCylinder(4, 20, [x - 35 + (i % 2) * 70, y - 25 + Math.floor(i / 2) * 50, -5])); }
  else if (k % 3 === 1) s = RC.drawPolysides(9, 6).sketchOnPlane('XY', [x, y, 0]).extrude(6).fuse(RC.makeCylinder(5, 40, [x, y, 6]));
  else { s = RC.makeBaseBox(60, 10, 60).translate(x, y, 0).fuse(RC.makeBaseBox(60, 60, 10).translate(x, y + 25, 0)); try { s = s.fillet(3, e => e.inDirection('X')); } catch (e) { } }
  items.push({ shape: s, name: 'Part ' + k });
}
await save('parts300.step', items);
