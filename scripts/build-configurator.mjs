// Builds the web configurator as a static site (no server), for GitHub Pages or any static host:
//   dist/site/configurator/   the page, the rules engine, the kernel, three.js, replicad, OpenCascade (gzipped)
//   dist/site/configurator/data/products.json and data/<id>.json   one bundle per product
// Products come from products/ at the repository root (folders exported by the modeler's Product Configurator,
// unpacked) and from packages/rules/examples. Only products whose rules compile are published.
// Usage: node scripts/build-configurator.mjs [--out folder] [--products folder ...]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { out: path.join(root, 'dist/site/configurator'), products: [] };
for (let i = 0; i < args.length; i += 2) { if (args[i] === '--out') opt.out = path.resolve(args[i + 1]); else if (args[i] === '--products') opt.products.push(path.resolve(args[i + 1])); }
if (!opt.products.length) opt.products = [path.join(root, 'products'), path.join(root, 'packages/rules/examples')].filter(d => fs.existsSync(d));

execFileSync(process.execPath, [path.join(root, 'packages/core/build.mjs')], { stdio: 'inherit' });
const { Catalog } = await import('../services/generator/src/catalog.mjs');
const { coreImports } = await import('../services/generator/src/server.mjs');

const out = opt.out;
fs.rmSync(out, { recursive: true, force: true });
const put = (rel, data) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const copy = (from, rel) => put(rel, fs.readFileSync(from));
const nm = p => path.join(root, 'node_modules', p);

// the page, in static mode
const app = path.join(root, 'apps/configurator');
put('index.html', fs.readFileSync(path.join(app, 'index.html'), 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="dw-mode" content="static">'));
for (const f of ['app.mjs', 'viewer.mjs', 'preview-worker.mjs', 'style.css']) copy(path.join(app, f), f);
for (const f of ['index.mjs', 'expr.mjs', 'project.mjs']) copy(path.join(root, 'packages/rules/src', f), 'rules/' + f);
copy(path.join(root, 'packages/core/src/index.mjs'), 'core/src/index.mjs');
put('core/dist/kernel.mjs', coreImports(fs.readFileSync(path.join(root, 'packages/core/dist/kernel.mjs'), 'utf8')));

// libraries: only what the page and the worker import
for (const f of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/controls/OrbitControls.js']) copy(nm('three/' + f), 'vendor/three/' + f);
for (const f of fs.readdirSync(nm('replicad/dist')).filter(f => f.endsWith('.js'))) copy(nm('replicad/dist/' + f), 'vendor/replicad/' + f);
copy(nm('replicad-opencascadejs/dist/replicad_single.js'), 'vendor/occ/replicad_single.js');
put('vendor/occ/replicad_single.wasm', zlib.gzipSync(fs.readFileSync(nm('replicad-opencascadejs/dist/replicad_single.wasm')), { level: 9 }));   // the worker unpacks it

// products
const list = [], seen = new Set();
for (const dir of opt.products) {
  const catalog = new Catalog(dir);
  for (const id of await catalog.ids()) {
    if (seen.has(id)) { console.warn(`configurator: skipped ${id} in ${dir} (an earlier folder has a product with that id)`); continue; }
    let p;
    try { p = await catalog.get(id); } catch (e) { console.warn(`configurator: skipped ${id}: ${e.message}`); continue; }
    if (!p.project.ok) { console.warn(`configurator: skipped ${id}: ${p.project.errors.length} rule error(s), first: ${p.project.errors[0].message}`); continue; }
    const t = p.project.runTests();
    if (!t.pass) console.warn(`configurator: ${id}: ${t.results.filter(r => !r.pass).length} test case(s) fail`);
    seen.add(id);
    put(`data/${id}.json`, JSON.stringify(p.bundle));
    list.push({ id, title: p.title, version: p.config.version ?? null, ok: true, errors: 0 });
  }
}
put('data/products.json', JSON.stringify(list));
const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`configurator: ${path.relative(root, out) || out} · ${list.length} product(s): ${list.map(p => p.id).join(', ') || 'none'} · ${(size(out) / 1e6).toFixed(1)} MB`);
