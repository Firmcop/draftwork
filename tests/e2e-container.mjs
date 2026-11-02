// End-to-end: a 20 ft container imported from STEP, a door opening sketched on its side wall and cut by clicking
// through the UI; cuts that point away from the part and cuts on mesh (STL) bodies say what to do.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { loadKernels } from './load-kernels.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

// the container: 6058 × 2438 × 2591 mm box with 2 mm walls, open inside (one solid)
const K = await loadKernels({ exact: true }), RC = K.getRC();
const solid = RC.makeBaseBox(6058, 2438, 2591).cut(RC.makeBaseBox(6054, 2434, 2587).translate(0, 0, 2));
const vol0 = RC.measureVolume(solid);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cont-')), stepFile = path.join(dir, 'container-20ft.step');
fs.writeFileSync(stepFile, Buffer.from(await K.brepSTEP([{ shape: solid, name: 'Container' }]).arrayBuffer()));

const PORT = 5262, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const W = ms => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__dw.state());
const props = () => page.evaluate(() => window.__dw.props());
const sc = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const sk = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000, polling: 50 });
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
const solidVol = async () => (await props()).filter(b => !b.surface).reduce((s, b) => s + b.volume, 0);

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.click('#abFile'); await page.click('text=New design'); await W(1000);
await page.setInputFiles('#stepInput', stepFile);
await page.waitForFunction(() => window.__dw.state().features.includes('import:ok'), null, { timeout: 120000 }); await idle(); await W(1500);
check(Math.abs(await solidVol() - vol0) < 1, 'container imported (' + Math.round(vol0 / 1e6) + ' L of steel)');

// door: sketch on the front wall (y = −1219), 1200 × 2000 rectangle, extrude, Cut, 10 mm
const cutOnWall = async (cx, w, hgt, setDir) => {
  await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(400);
  const q = await sc(cx, -1219, 1300); await page.mouse.move(q.x, q.y); await W(150); await page.mouse.click(q.x, q.y); await W(1500);
  const sketching = (await state()).mode === 'sketch';
  // the sketch frame sits on the clicked point with its y axis up the wall
  await drag(await sc(cx - w / 2, -1219, 100), await sc(cx + w / 2, -1219, 100 + hgt)); await W(600);   // corners picked on the wall itself
  await page.click('.palette .btn.go'); await W(800);
  await page.keyboard.press('e'); await W(1200);
  await page.selectOption('#ds-op', 'cut'); await W(800);
  if (setDir) await page.click(`.dialog .seg button:has-text("${setDir}")`), await W(500);
  await page.fill('#dx-distance', '10'); await W(1200); await idle();
  const msg = await page.textContent('.dialog');
  await page.click('.dialog .btn.ok'); await W(1200); await idle();
  return { sketching, msg };
};
let r = await cutOnWall(0, 1200, 2000);
check(r.sketching, 'clicking the container wall starts a sketch on it');
let v = await solidVol(), st = await state();
check(st.features.at(-1) === 'extrude:ok' && Math.abs(vol0 - v - 1200 * 2000 * 2) < 50, `choosing Cut on the wall sketch cuts into the wall: door opening removes ${((vol0 - v) / 1e6).toFixed(2)} L (expected 4.80 L)`);

// a cut deliberately pointed away from the wall reports why nothing happened
r = await cutOnWall(-2000, 800, 1000, 'One side');
st = await state();
console.log(st.features.at(-1));
check(/^extrude:error\(.*points away from the body/.test(st.features.at(-1)), 'a cut pointing away from the part is flagged with how to fix it');

// mesh container: cutting an STL body explains Convert Mesh
await page.click('#abFile'); await page.click('text=New design'); await W(1000);
const V = [[-3029, -1219, 0], [3029, -1219, 0], [3029, 1219, 0], [-3029, 1219, 0], [-3029, -1219, 2591], [3029, -1219, 2591], [3029, 1219, 2591], [-3029, 1219, 2591]];
const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
const buf = Buffer.alloc(84 + F.length * 50); buf.writeUInt32LE(F.length, 80);
F.forEach((t, i) => t.forEach((vi, k) => V[vi].forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
await page.click('.rtab:text-is("MESH")'); await W(150); await page.click('.rlabel:has-text("CREATE")'); await W(200);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu .mi', { has: page.locator('text="Insert Mesh"') }).first().click()]);
await fc.setFiles({ name: 'container.stl', mimeType: 'model/stl', buffer: buf }); await W(2500);
await page.click('.dialog .btn.ok'); await W(1200);
await page.click('.rtab:text-is("SOLID")'); await W(300);
await page.evaluate(() => { const d = window.__dw.doc(); d.features.push({ id: 'sk', type: 'sketch', name: 'Door', plane: { o: [0, -1219, 1300], x: [1, 0, 0], n: [0, -1, 0] }, offset: 0, flip: false, profiles: [{ kind: 'rect', cx: 0, cy: -200, w: 1200, h: 2000 }] }, { id: 'ex', type: 'extrude', name: 'Door cut', sketch: 'sk', distance: 10, direction: 'reverse', op: 'cut' }); window.__dw.setDoc(d); });
await W(1500); await idle();
st = await state();
console.log(JSON.stringify(st.features));
check(/^extrude:error\(.*Convert Mesh/.test(st.features.at(-1)), 'cutting an STL container explains to convert the mesh first');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
