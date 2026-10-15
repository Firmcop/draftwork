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
const MODULES = ['solver', 'kernel', 'engineclient', 'icons', 'assembly', 'drawing', 'construct', 'core', 'ribbon', 'panels', 'interact', 'sketchui'];
// The exact kernel runs in a Web Worker: solver + kernel + brep + host wrapped in one self-contained async function.
// The page sends engineFactory.toString() to the worker, or calls it directly when workers are blocked.
const ENGINE = ['solver', 'kernel', 'brep', 'enginehost'];
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
`;
const js = header + MODULES.map(m => `// ---- ${m} ----\n` + strip(src(m + '.js'))).join('\n') + '\n// ---- engine (runs in a worker) ----\n' + engineFactory;

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
console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB · engine ${(fs.statSync(wasmOut).size / 1e6).toFixed(1)} MB`);
