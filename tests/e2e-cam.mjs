// End-to-end: Manufacture workspace — setup, face, 2D pocket (picked floor), 2D contour, drilling (auto holes), simulation, post.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5210, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const camInfo = () => page.evaluate(() => window.__dw.cam());
const menu = async (group, label) => { await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(800); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1500); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Plate', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'b', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 20, op: 'new' },
  { id: 'p', type: 'box', name: 'Pocket', plane: 'XY', offset: 12, cx: -8, cy: 0, w: 24, d: 20, h: 8, op: 'cut' },
  { id: 'h1', type: 'cylinder', name: 'H1', plane: 'XY', offset: 0, cx: 18, cy: 10, diameter: 5, h: 20, op: 'cut' },
  { id: 'h2', type: 'cylinder', name: 'H2', plane: 'XY', offset: 0, cx: 18, cy: -10, diameter: 5, h: 20, op: 'cut' }] }));
await W(2500);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("MANUFACTURE")'); await W(1500);
let c = await camInfo();
check(c && c.setups === 1 && await page.isVisible('.rtab:text-is("MILLING")'), 'Manufacture workspace opens with a setup and the Milling tab');
await page.click('#vcHome'); await W(600);

// face
await menu('2D', 'Face'); await W(800); await ok();
// pocket: pick the floor
await menu('2D', '2D Pocket'); await page.mouse.click(...Object.values(await scr(-17, 7, 12))); await W(1500);
c = await camInfo();
const fl = await page.evaluate(() => window.__dw.camDbg().floors);
check(c.ops.at(-1).floors === 1 && Math.abs(fl[0].z - 12) < 1e-6, 'pocket floor (z 12) picked on the model ' + JSON.stringify(fl));
await page.selectOption('.dialog #ds-tool', { label: 'T2 Ø6 flat end mill' }); await W(1500); await ok();
// contour outside
await menu('2D', '2D Contour'); await W(1500); await ok();
// drill: the two Ø5 holes are found automatically
await menu('DRILLING', 'Drill'); await W(1200);
c = await camInfo();
check(c.ops.at(-1).holes === 2, 'drill finds both Ø5 holes (' + c.ops.at(-1).holes + ')');
await ok();
c = await camInfo();
check(c.ops.length === 4 && c.ops.every(o => o.moves > 0 && !o.warn), 'four operations with toolpaths ' + JSON.stringify(c.ops.map(o => [o.type, o.moves, o.warn])));
check(c.ops.reduce((a, o) => a + o.minutes, 0) > 0.5, 'machining time estimated (' + c.ops.reduce((a, o) => a + o.minutes, 0).toFixed(1) + ' min)');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/cam.png' });

// simulate to the end: no gouges
await menu('ACTIONS', 'Simulate'); await W(600);
await page.click('#sim-end'); await W(3000);
c = await camInfo();
check(c.sim && c.sim.at === c.sim.total && c.sim.gougeCells === 0, 'simulation runs to the end without gouging ' + JSON.stringify(c.sim));
const pk = await page.evaluate(() => window.__dw.simAt(-8, 0)), tp = await page.evaluate(() => window.__dw.simAt(-25, 15));
check(Math.abs(pk[0] - 12) < 0.01 && Math.abs(tp[0] - 20) < 0.01, 'simulated stock: pocket floor at 12, faced top at 20 (' + pk + ' / ' + tp + ')');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/cam-sim.png' });
await page.click('.dialog .btn.ok'); await W(500);

// post process
await menu('ACTIONS', 'Post Process'); await W(800);
const pv = await page.textContent('#post-preview');
check(/T7 M6|T1 M6/.test(pv) && /G54/.test(pv), 'G-code preview with tool change and work offset');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#modal .btn.ok')]);
let gOk = false;
if (dl) { const s = fs.readFileSync(await dl.path()).toString('latin1'); gOk = /G81 X/.test(s) && /M30/.test(s) && s.includes('setup-sheet.html') && /T2 M6/.test(s); if (process.env.SHOTS) fs.copyFileSync(await dl.path(), process.env.SHOTS + '/cam.zip'); }
check(gOk, 'post: zip with the program (G81 drilling, M30) and a setup sheet');
// ---- 3D: rough + parallel finish on a dome ----
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("DESIGN")'); await W(600);
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Dome', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'b', type: 'box', name: 'Base', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 50, d: 50, h: 5, op: 'new' },
  { id: 's', type: 'sphere', name: 'Dome', plane: 'XY', offset: 5, cx: 0, cy: 0, diameter: 36, op: 'join' },
  { id: 'c', type: 'box', name: 'Cut', plane: 'XY', offset: -40, cx: 0, cy: 0, w: 60, d: 60, h: 40, op: 'cut' }] }));
await W(3000);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("MANUFACTURE")'); await W(1500);
await menu('3D', 'Pocket Clearing (3D roughing)'); await W(4000); await ok();
await menu('3D', 'Parallel (3D finishing)'); await W(4000); await ok();
c = await camInfo();
const ops3 = c.ops.filter(o => o.type === 'rough' || o.type === 'parallel');
check(ops3.length === 2 && ops3.every(o => o.moves > 50 && !o.warn), '3D roughing and parallel finishing have toolpaths ' + JSON.stringify(ops3.map(o => [o.type, o.moves, o.warn])));
await menu('ACTIONS', 'Simulate'); await W(600); await page.click('#sim-end'); await W(8000);
c = await camInfo();
const top = await page.evaluate(() => window.__dw.simAt(0, 0));
check(c.sim.at === c.sim.total && c.sim.gougeCells === 0 && Math.abs(top[0] - top[1]) < 0.3, 'dome machined without gouges; top within 0.3 mm (' + JSON.stringify(c.sim) + ' top ' + top + ')');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/cam-dome.png' });
await page.click('.dialog .btn.ok'); await W(500);

// back to design
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("DESIGN")'); await W(800);
check(await page.isVisible('.rtab:text-is("SOLID")'), 'back to the Design workspace');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
