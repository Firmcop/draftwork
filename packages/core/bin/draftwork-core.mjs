#!/usr/bin/env node
// Configure a Draftwork design from the command line and write its release files.
//
//   draftwork-core <design.json> [--set name=value ...] [--suppress feature ...] [--restore feature ...]
//                  [--out folder] [--formats step,stl,svg,dxf] [--sample]
//
// Writes <name>.step, <name>.stl, <name>-<view>.svg, <name>-flat.dxf (sheet metal) and report.json into --out.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createEngine, viewSVG } from '../src/index.mjs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('usage: draftwork-core <design.json | --sample> [--set name=value]... [--suppress feature]... [--restore feature]... [--out folder] [--formats step,stl,svg,dxf]');
  process.exit(args.length ? 0 : 1);
}

const opt = { set: {}, suppress: {}, out: 'out', formats: ['step', 'stl', 'svg', 'dxf'], file: null, sample: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i], next = () => { const v = args[++i]; if (v == null) fail(`${a} needs a value`); return v; };
  if (a === '--set') { const [k, ...v] = next().split('='); if (!v.length) fail(`--set takes name=value, got "${k}"`); const s = v.join('='); opt.set[k] = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s; }
  else if (a === '--suppress') opt.suppress[next()] = true;
  else if (a === '--restore') opt.suppress[next()] = false;
  else if (a === '--out') opt.out = next();
  else if (a === '--formats') opt.formats = next().split(',').map(s => s.trim()).filter(Boolean);
  else if (a === '--sample') opt.sample = true;
  else if (a.startsWith('--')) fail(`unknown option ${a}`);
  else opt.file = a;
}
function fail(msg) { console.error('draftwork-core: ' + msg); process.exit(2); }

const doc = opt.sample ? (await import('../../../tests/load-kernels.mjs')).sampleDoc() : JSON.parse(await fs.readFile(opt.file || fail('no design file'), 'utf8'));
const t0 = Date.now();
const engine = await createEngine();
const model = engine.open(doc.design || doc);   // a saved project file or a bare design
const tLoad = Date.now() - t0;

try { model.setParams(opt.set).setSuppressed(opt.suppress); } catch (e) { fail(e.message); }
const r = await model.rebuild();
const base = (model.doc.name || 'part').replace(/[^\w.-]+/g, '_');
await fs.mkdir(opt.out, { recursive: true });
const written = [];
const write = async (name, data) => { await fs.writeFile(path.join(opt.out, name), data); written.push(name); };

if (r.ok) {
  if (opt.formats.includes('step')) await write(base + '.step', await model.export('step'));
  if (opt.formats.includes('stl')) await write(base + '.stl', await model.export('stl'));
  if (opt.formats.includes('svg')) {
    const views = await model.project(['front', 'top', 'right', 'iso']);
    for (const [k, v] of Object.entries(views)) await write(`${base}-${k}.svg`, viewSVG(v));
  }
  if (opt.formats.includes('dxf') && r.sheetMetal.length) await write(base + '-flat.dxf', await model.export('dxf-flat'));
}
const report = {
  design: model.doc.name, ok: r.ok, errors: r.errors, warnings: r.warnings,
  parameters: Object.fromEntries(model.parameters().map(p => [p.name, p.value])),
  suppressed: model.features().filter(f => f.suppressed).map(f => f.name),
  volume_mm3: +r.volume.toFixed(3), size_mm: r.bbox?.size.map(v => +v.toFixed(3)),
  bodies: r.bodies.map(b => ({ id: b.id, name: b.name, volume_mm3: +b.volume.toFixed(3) })),
  timing_ms: { engineLoad: tLoad, rebuild: r.ms, total: Date.now() - t0 },
  files: written,
};
await write('report.json', JSON.stringify(report, null, 2) + '\n');
console.log(`${r.ok ? 'ok' : 'FAILED'}  ${report.design}  volume ${report.volume_mm3} mm³  size ${report.size_mm?.join(' × ')} mm  rebuild ${r.ms} ms`);
for (const e of r.errors) console.log(`  error  ${e.name}: ${e.message}`);
console.log(`  wrote ${written.length} files to ${opt.out}/`);
process.exit(r.ok ? 0 : 1);
