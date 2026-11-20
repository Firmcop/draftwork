// End-to-end on an imported 20 ft container (STEP, corrugated steel walls): imported at the right size and orientation,
// a door and a window cut through a side wall with the normal sketch + extrude Cut workflow, the openings go all the
// way through (a ray passes through), nothing else changes, they persist after reopening; a broken file and a retry
// leave the document consistent; the same file imported again comes from the cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { loadKernels } from './load-kernels.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
// the container STEP (as tests/bench/make-fixtures.mjs writes it)
const K = await loadKernels({ exact: true });
const src = fs.readFileSync(new URL('../src/container.js', import.meta.url), 'utf8');
const containerFeatures = (0, eval)('(' + src.slice(src.indexOf('function containerFeatures')) + ')');
const feats = containerFeatures(), built = K.regenerateBrep(K.resolveFeatures(feats, {})), names = new Map(feats.map(f => [f.id, f.name]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cut-')), stepFile = path.join(dir, 'container-20ft.step');
const stepText = await K.brepSTEP([...built.bodies.values()].map(b => ({ shape: b.shape, name: names.get(b.feature) }))).text();
fs.writeFileSync(stepFile, stepText);
const broken = path.join(dir, 'broken.step'); fs.writeFileSync(broken, stepText.slice(0, Math.floor(stepText.length / 3)));

const PORT = 5266, server = serve(PORT);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cut-prof-'));
const ctx = await chromium.launchPersistentContext(prof, { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 1500, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const W = ms => page.waitForTimeout(ms);
const idle = async () => { await W(300); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 180000, polling: 50 }); };
const state = () => page.evaluate(() => window.__dw.state());
const vols = async () => Object.fromEntries((await page.evaluate(() => window.__dw.props())).map(b => [b.id, b.volume]));
const sc = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const ray = (o, d) => page.evaluate(([o, d]) => window.__dw.rayHit(o, d), [o, d]);
const engine = () => page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 180000 });
const editReady = kind => page.waitForFunction(k => { const t = window.__dw.importTrace(); return t.kind === k && t.marks.editReady != null; }, kind, { timeout: 300000, polling: 100 });
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };

await page.goto(`http://localhost:${PORT}/`); await engine();
await page.click('#abFile'); await page.click('text=New design'); await W(800);
await page.setInputFiles('#stepInput', stepFile);
await editReady('upload'); await idle(); await W(800);
let st = await state();
check(st.bodies.length === 19 && st.features.at(-1) === 'import:ok', 'container imported: 19 solids');
const bb = await page.evaluate(() => window.__dw.bbox());
check(JSON.stringify(bb) === JSON.stringify([[-3029, -1219, 0], [3029, 1219, 2591]]), 'correct size and orientation: 6058 × 2438 × 2591 mm, Z up (' + JSON.stringify(bb) + ')');
check((await page.evaluate(() => window.__dw.importTrace())).data.cache === 'miss', 'first import of this file parses it');
const v0 = await vols();

// door 900 × 2100 and window 1200 × 1000 in the right side wall (outside face y = −1219), with Create Sketch + Extrude Cut
const before = await ray([36, -1500, 1200], [0, 1, 0]), rightWall = before?.id;
check(before && before.dist > 270 && before.dist < 300, 'a ray at the door position hits the right side wall first (' + JSON.stringify(before) + ')');
const cut = async (clickX, x0, x1, z0, z1, depth) => {
  await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(400);
  const q = await sc(clickX, -1219, (z0 + z1) / 2); await page.mouse.move(q.x, q.y); await W(150); await page.mouse.click(q.x, q.y); await W(1500);
  const ok = (await state()).mode === 'sketch';
  await drag(await sc(x0, -1219, z0), await sc(x1, -1219, z1)); await W(600);
  await page.click('.palette .btn.go'); await W(800);
  await page.keyboard.press('e'); await W(1200);
  await page.selectOption('#ds-op', 'cut'); await W(800);
  await page.fill('#dx-distance', String(depth)); await W(1200); await idle();
  await page.click('.dialog .btn.ok'); await W(1200); await idle();
  return ok;
};
check(await cut(36, -414, 486, 200, 2300, 60), 'clicking the imported wall starts a sketch on it');
st = await state();
let v1 = await vols();
const doorRemoved = v0[rightWall] - v1[rightWall];
check(st.features.at(-1) === 'extrude:ok' && doorRemoved > 900 * 2100 * 2 * 0.95 && doorRemoved < 900 * 2100 * 2 * 1.4, `door cut through the corrugated wall: ${(doorRemoved / 1e6).toFixed(2)} L of steel removed`);
let through = await ray([36, -1500, 1200], [0, 1, 0]);
check(through && through.id !== rightWall && through.dist > 2500, 'a ray passes through the door opening to the far wall (' + JSON.stringify(through) + ')');
check(Object.keys(v0).filter(id => id !== rightWall).every(id => Math.abs(v0[id] - v1[id]) < 1e-3), 'no other part changed');
check(await cut(1704, 1100, 2300, 900, 1900, 60), 'second sketch on the same wall');
const v2 = await vols();
check(v1[rightWall] - v2[rightWall] > 1200 * 1000 * 2 * 0.95, `window cut independently (${((v1[rightWall] - v2[rightWall]) / 1e6).toFixed(2)} L removed)`);
check((await ray([1700, -1500, 1400], [0, 1, 0]))?.id !== rightWall, 'a ray passes through the window opening');

// save and reopen: the openings are still there
await W(1500);
await page.reload(); await engine(); await editReady('reopen'); await idle(); await W(800);
const v3 = await vols();
check(Math.abs(v3[rightWall] - v2[rightWall]) < 1e-3 && (await state()).features.filter(f => f.startsWith('extrude')).join() === 'extrude:ok,extrude:ok', 'after reopening, the wall still has both openings');
through = await ray([36, -1500, 1200], [0, 1, 0]);
check(through?.id !== rightWall, 'the door opening goes through after reopening');
check((await page.evaluate(() => window.__dw.importTrace())).marks.cacheLoaded != null, 'reopening reads the cached solids, not the STEP file');

// a broken file: an error, the document unchanged; then a retry with the good file into the same project
const nBefore = (await state()).features.length, bodiesBefore = (await state()).bodies.length;
await page.setInputFiles('#stepInput', broken); await W(4000); await idle();
st = await state();
check(st.features.length === nBefore && st.bodies.length === bodiesBefore, 'a broken STEP file leaves the project unchanged');
await page.setInputFiles('#stepInput', stepFile);
await page.waitForFunction(n => window.__dw.state().bodies.length === n, bodiesBefore + 19, { timeout: 180000 }); await idle(); await W(500);
const v4 = await vols();
check(Object.keys(v3).every(id => Math.abs(v3[id] - v4[id]) < 1e-3), 'inserting the container again keeps the existing parts (and their openings) unchanged');
check((await page.evaluate(() => window.__dw.importTrace())).data.cache === 'hit', 'the same file imported again comes from the cache (no parsing)');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await ctx.close(); server.close(); fs.rmSync(prof, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
