#!/usr/bin/env node
// Configure a product: answers → rules → Draftwork model → release files and a quote.
//
//   draftwork-configure <product.config.json> [--answer Name=value ...] [--out folder]
//                       [--no-model] [--test] [--explain Name] [--json]
//
//   --test        run the project's test cases and list untested rule branches (no model)
//   --explain N   print how value N was worked out
//   --no-model    rules only: quote.json without rebuilding the model
import fs from 'node:fs/promises';
import path from 'node:path';
import { compile, applyToModel, display } from '../src/index.mjs';
import { loadProject } from '../src/node.mjs';

const args = process.argv.slice(2);
const usage = 'usage: draftwork-configure <product.config.json> [--answer Name=value]... [--out folder] [--no-model] [--test] [--explain Name]';
if (!args.length || args.includes('--help')) { console.log(usage); process.exit(args.length ? 0 : 1); }
const opt = { answers: {}, out: 'out', model: true, test: false, explain: [], file: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i], next = () => { const v = args[++i]; if (v == null) fail(`${a} needs a value`); return v; };
  if (a === '--answer' || a === '-a') { const [k, ...v] = next().split('='); if (!v.length) fail(`--answer takes Name=value, got "${k}"`); const s = v.join('='); opt.answers[k] = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s; }
  else if (a === '--out') opt.out = next();
  else if (a === '--no-model') opt.model = false;
  else if (a === '--test') opt.test = true;
  else if (a === '--explain') opt.explain.push(next());
  else if (a.startsWith('-')) fail(`unknown option ${a}`);
  else opt.file = a;
}
function fail(msg) { console.error('draftwork-configure: ' + msg); process.exit(2); }

const { config, design } = await loadProject(opt.file || fail('no project file'));
const project = compile(config);
if (!project.ok) {
  console.error(`The project has ${project.errors.length} error(s):`);
  for (const e of project.errors) console.error(`  ${e.section}${e.name ? ' ' + e.name : ''}${e.field ? ' (' + e.field + ')' : ''}: ${e.message}`);
  process.exit(1);
}

if (opt.test) {
  const t = project.runTests();
  for (const r of t.results) {
    console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}`);
    for (const f of r.failures) console.log(`        ${f}`);
  }
  if (t.untested.length) console.log(`untested branches: ${t.untested.join(', ')}`);
  console.log(`${t.results.filter(r => r.pass).length}/${t.results.length} passed`);
  process.exit(t.pass ? 0 : 1);
}

const t0 = performance.now();
const r = project.evaluate(opt.answers);
const rulesMs = performance.now() - t0;

for (const name of opt.explain) {
  const e = r.explain(name);
  if (!e) { console.log(`No value called ${name}`); continue; }
  (function show(n, indent) {
    console.log(`${indent}${n.name} = ${display(n.value)}${n.formula ? `   ← ${n.formula}` : n.from ? `   (${n.from})` : ''}`);
    for (const u of n.uses || []) show(u, indent + '    ');
  })(e, '');
}

for (const m of r.messages) console.log(`${m.level.padEnd(7)} ${m.message}`);
const currency = r.price.currency ? r.price.currency + ' ' : '';
const money = x => currency + x.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`${r.text.title || config.product}`);
for (const l of r.price.lines) console.log(`  ${l.line.padEnd(20)} ${money(l.amount).padStart(16)}`);
console.log(`  ${'Total'.padEnd(20)} ${money(r.price.total).padStart(16)}`);
console.log(`  rules ${rulesMs.toFixed(1)} ms`);

await fs.mkdir(opt.out, { recursive: true });
const files = [];
const write = async (name, data) => { await fs.writeFile(path.join(opt.out, name), data); files.push(name); };
const quote = { product: config.product, version: config.version ?? null, ok: r.ok, answers: Object.fromEntries(r.form.map(f => [f.name, f.value])), text: r.text, price: r.price, bom: r.bom, messages: r.messages, model: r.model, files };

let modelOk = true;
if (opt.model && r.ok && design) {
  const { createEngine, viewSVG } = await import('@draftwork/core');
  const engine = await createEngine();
  const model = engine.open(design);
  const problems = applyToModel(r, model);
  for (const p of problems) console.log(`warning ${p}`);
  const g = await model.rebuild();
  modelOk = g.ok;
  const base = (r.text.part_number || design.name || 'part').replace(/[^\w.-]+/g, '_');
  if (g.ok) {
    await write(base + '.step', await model.export('step'));
    await write(base + '.stl', await model.export('stl'));
    const views = await model.project(['front', 'top', 'right', 'iso']);
    for (const [k, v] of Object.entries(views)) await write(`${base}-${k}.svg`, viewSVG(v));
    if (g.sheetMetal.length) await write(base + '-flat.dxf', await model.export('dxf-flat'));
  } else for (const e of g.errors) console.log(`error   model: ${e.name}: ${e.message}`);
  quote.geometry = { ok: g.ok, errors: g.errors, volume_mm3: +g.volume.toFixed(3), size_mm: g.bbox?.size.map(v => +v.toFixed(3)), rebuild_ms: g.ms };
  console.log(`  model ${g.ok ? 'ok' : 'FAILED'}: ${g.bbox?.size.map(v => v.toFixed(1)).join(' × ')} mm, rebuild ${g.ms} ms`);
}
await write('quote.json', JSON.stringify(quote, null, 2) + '\n');
console.log(`  wrote ${files.length} files to ${opt.out}/`);
process.exit(r.ok && modelOk ? 0 : 1);
