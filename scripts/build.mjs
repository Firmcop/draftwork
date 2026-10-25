// Bundles src/ into one HTML page and packs the OpenCascade engine.
//   dist/index.html        – the app, libraries loaded from jsDelivr (what gets published)
//   dist/local.html        – same app, libraries served from node_modules (for `npm run dev` and tests)
//   dist/engine/occ-gz.wasm – gzip-compressed OpenCascade build (the page unpacks it in the browser)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const pkg = name => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

const strip = s => s.split('\n').filter(l => !/^import /.test(l)).map(l => l.replace(/^export /, '')).join('\n');
// Concatenation order matters: later modules use functions from earlier ones.
const MODULES = ['font', 'solver', 'kernel', 'engineclient', 'icons', 'assembly', 'drawing', 'drawing2', 'construct', 'modify', 'surfaceui', 'sheetui', 'plasticui', 'meshui', 'insert', 'assembly2', 'configure', 'productui', 'core', 'ribbon', 'panels', 'interact', 'sketchui', 'sketchtools', 'sketchhud', 'inspect', 'formui', 'camcore', 'camui', 'slicer', 'printui', 'nest', 'nestui', 'fea', 'simui', 'library', 'ui2'];
// The exact kernel runs in a Web Worker: solver + kernel + brep + host wrapped in one self-contained async function.
// The page sends engineFactory.toString() to the worker, or calls it directly when workers are blocked.
const ENGINE = ['font', 'solver', 'kernel', 'brep', 'brepsurf', 'brepsheet', 'brepplastic', 'meshops', 'enginehost'];
const engineFactory = `async function engineFactory(urls) {
const THREE = await import(urls.three);
class Brush { } class Evaluator { } const ADDITION = 0, SUBTRACTION = 1, INTERSECTION = 2;   // mesh booleans are not used here
const RCmod = await import(urls.replicad);
${ENGINE.map(m => `// ---- ${m} ----\n` + strip(src(m + '.js'))).join('\n')}
return engineHost(RCmod);
}`;
const header = `import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
`;
// The configurator's rules engine (packages/rules) and its AI drafting (packages/ai), wrapped in one namespace so its names never meet the app's.
const rulesSrc = f => fs.readFileSync(path.join(root, 'packages/rules/src', f), 'utf8');
const rules = `// ---- rules engine (packages/rules) ----
const DWR = (() => {
${strip(rulesSrc('expr.mjs'))}
${strip(rulesSrc('project.mjs'))}
${['llm', 'describe', 'draft'].map(f => strip(fs.readFileSync(path.join(root, 'packages/ai/src', f + '.mjs'), 'utf8'))).join('\n')}
return { compile, parse, evaluate, analyze, display, parseCSV, normalizeTable, RULE_KINDS, FUNCTIONS, createClaude, draftChanges, checkProposal, applyProposal, DEFAULT_MODEL };
})();
`;
const js = header + rules + MODULES.map(m => `// ---- ${m} ----\n` + strip(src(m + '.js'))).join('\n') + '\n// ---- engine (runs in a worker) ----\n' + engineFactory;

// Keep the import map in step with installed versions.
const versions = { three: pkg('three'), 'three-mesh-bvh': pkg('three-mesh-bvh'), 'three-bvh-csg': pkg('three-bvh-csg'), replicad: pkg('replicad'), 'replicad-opencascadejs': pkg('replicad-opencascadejs') };
let template = src('template.html');
for (const [name, v] of Object.entries(versions)) template = template.replace(new RegExp(`npm/${name}@[0-9.]+/`, 'g'), `npm/${name}@${v}/`);
const html = template.replace('/*__CSS__*/', () => src('style.css')).replace('/*__JS__*/', () => js);

// Refuse to ship a bundle with a syntax error (node parses it as a module without running it).
{
  const { execFileSync } = await import('node:child_process'), os = await import('node:os');
  const tmp = path.join(os.tmpdir(), 'draftwork-check-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, js);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { console.error(String(e.stderr || e.message)); process.exit(1); }
  finally { fs.rmSync(tmp, { force: true }); }
}
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'engine'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);

let local = html;
for (const name of Object.keys(versions)) local = local.replaceAll(`https://cdn.jsdelivr.net/npm/${name}@${versions[name]}/`, `/node_modules/${name}/`);
local = local.replace(/<link rel="(stylesheet|preconnect)"[^>]*>/g, '');
fs.writeFileSync(path.join(dist, 'local.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">${local}</body></html>`);

const wasmSrc = path.join(root, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm');
const wasmOut = path.join(dist, 'engine/occ-gz.wasm');
if (!fs.existsSync(wasmOut) || fs.statSync(wasmOut).mtimeMs < fs.statSync(wasmSrc).mtimeMs) {
  fs.writeFileSync(wasmOut, zlib.gzipSync(fs.readFileSync(wasmSrc), { level: 9 }));
}

// ---- installable desktop app (PWA) for GitHub Pages: dist/site ----
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const site = path.join(dist, 'site'); fs.mkdirSync(path.join(site, 'engine'), { recursive: true });
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1B64D8"><meta name="description" content="Draftwork — parametric CAD in your browser and on your desktop">
<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="apple-touch-icon.png">
<script>window.DRAFTWORK_VERSION = ${JSON.stringify(pkg.version)};</script></head><body style="margin:0">`;
  const reg = `<script>if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => {
  r.addEventListener('updatefound', () => { const w = r.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller && typeof toast === 'function') toast('A new version of Draftwork is ready: close and reopen the app (or reload) to use it.'); }); });
}).catch(() => {}));</script>`;
  fs.writeFileSync(path.join(site, 'index.html'), head + html + reg + '</body></html>');
  fs.copyFileSync(wasmOut, path.join(site, 'engine/occ-gz.wasm'));
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(root, 'assets', f), path.join(site, f));
  fs.writeFileSync(path.join(site, 'manifest.webmanifest'), JSON.stringify({
    name: 'Draftwork', short_name: 'Draftwork', description: 'Parametric CAD: design, drawings, simulation and manufacture',
    start_url: './', scope: './', display: 'standalone', display_override: ['window-controls-overlay', 'standalone'], background_color: '#F4F5F7', theme_color: '#1B64D8',
    icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
    file_handlers: [{ action: './', accept: { 'application/json': ['.json'] } }],
  }, null, 2));
  // offline cache: the app shell updates network-first; libraries, fonts and the engine are cached on first use
  fs.writeFileSync(path.join(site, 'sw.js'), `const V = 'draftwork-${pkg.version}-${Date.now().toString(36)}';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'engine/occ-gz.wasm'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k.startsWith('draftwork-')).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.includes('/configurator/')) return;   // the configurator is its own site
  const same = u.origin === location.origin, page = same && (e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html'));
  if (page) { e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))); return; }
  if (same || /(^|\\.)(jsdelivr\\.net|unpkg\\.com|googleapis\\.com|gstatic\\.com)$/.test(u.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; })));
  }
});
`);
  console.log('dist/site: installable app (manifest, service worker, icons)');
}
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB · engine ${(fs.statSync(wasmOut).size / 1e6).toFixed(1)} MB`);
