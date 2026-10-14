// End-to-end: drives the real page in headless Chromium through a full modeling session.
// Run with `npm run test:e2e`. Set CHROMIUM_PATH to use a preinstalled browser.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from '../scripts/serve.mjs';

const PORT = 5199;
const server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__dw.state());
const sc = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const sk = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine|Mesh engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 90000 });
await W(2500);
check((await page.textContent('#engineBadge')).includes('Exact'), 'exact engine loads');
check((await page.textContent('#tlInfo')).includes('82.87'), 'sample bracket volume 82.87 cm³');

// fillet the boss/plate junction by clicking the edge
await page.click('.rbtn[aria-label^="Fillet"]'); await W(800);
const p = await sc(14.142, -14.142, 10); await page.mouse.click(p.x, p.y); await W(1500);
check((await page.textContent('.dialog .note')).startsWith('1 edge'), 'edge pick registers');
await page.click('.dialog .btn.ok'); await W(1500);
check((await state()).features.at(-1) === 'fillet:ok', 'fillet builds');

// blank design: sketch on XY, extrude, shell the top
await page.click('#abFile'); await page.click('text=New design'); await W(1500);
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(400);
await page.click('.node:has-text("Origin") .tw'); await W(200);
await page.click('.node .nlab:text-is("XY")'); await W(1500);
await drag(await sk(-20, -15), await sk(20, 15)); await W(600);
await page.click('.palette .btn.go'); await W(800);
await page.keyboard.press('e'); await W(1200);
await page.fill('#dx-distance', '20'); await W(1500);
await page.click('.dialog .btn.ok'); await W(800);
check(JSON.stringify((await state()).bodies) === '["Body 1=24,000"]', 'sketch + extrude gives 40×30×20');
await page.click('.rbtn[aria-label^="Shell"]'); await W(800);
const t = await sc(5, 5, 20); await page.mouse.click(t.x, t.y); await W(1500);
await page.click('.dialog .btn.ok'); await W(1500);
check((await page.textContent('#tlInfo')).includes('7.15'), 'shell volume 7.15 cm³');

// STEP export
await page.click('#abFile'); await page.click('text=Export STEP / STL'); await W(600);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('.dialog .btn.ok')]);
check(!!dl && dl.suggestedFilename().endsWith('-step.zip'), 'STEP export downloads');

// angled face: chamfer an edge, sketch on the chamfer face, cut a hole through it
await page.click('#abFile'); await page.click('text=New design'); await W(1500);
await page.click('.rbtn[aria-label^="Box"]'); await W(400);
await page.click('.node .nlab:text-is("XY")'); await W(1500);
await page.selectOption('#ds-op', 'new'); await page.click('.dialog .btn.ok'); await W(1200);   // 40 × 30 × 20
await page.click('.rbtn[aria-label^="Chamfer"]'); await W(800);
let q = await sc(20, 0, 20); await page.mouse.click(q.x, q.y); await W(1200);
await page.fill('#dx-chdist', '5'); await W(1200);
await page.click('.dialog .btn.ok'); await W(1200);
check((await page.textContent('#tlInfo')).includes('23.63'), 'chamfer removes 375 mm³');
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(400);
q = await sc(17.5, 0, 17.5); await page.mouse.click(q.x, q.y); await W(1500);
check((await state()).mode === 'sketch', 'sketch starts on the angled chamfer face');
await page.keyboard.press('c'); await W(200);
await drag(await sk(0, 0), await sk(2, 0)); await W(600);
await page.click('.palette .btn.go'); await W(800);
await page.keyboard.press('e'); await W(1200);
await page.selectOption('#ds-op', 'cut'); await W(800);
await page.click('.dialog .seg button:has-text("Flipped")'); await W(800);
await page.fill('#dx-distance', '4'); await W(1500);
await page.click('.dialog .btn.ok'); await W(1200);
check((await page.textContent('#tlInfo')).includes('23.57'), 'hole cut normal to the angled face (−50.3 mm³)');
if (process.env.SHOTS) { await page.click('#vcHome'); await W(700); await page.screenshot({ path: process.env.SHOTS + '/angled.png' }); await page.click('.rlabel:has-text("MODIFY")'); await W(300); await page.screenshot({ path: process.env.SHOTS + '/modify-menu.png' }); await page.keyboard.press('Escape'); }

// STEP import of the file exported above
const zip = fs.readFileSync(await dl.path());
const nameLen = zip.readUInt16LE(26), extra = zip.readUInt16LE(28), size = zip.readUInt32LE(18);
fs.writeFileSync('/tmp/draftwork-e2e.step', zip.subarray(30 + nameLen + extra, 30 + nameLen + extra + size));
await page.click('#abFile'); await page.click('text=New design'); await W(1200);
await page.setInputFiles('#stepInput', '/tmp/draftwork-e2e.step'); await W(3000);
const st = await state();
check(st.features.join() === 'import:ok' && st.bodies.length === 1 && st.bodies[0].endsWith('=7,152'), 'STEP import brings the shelled box back (7,152 mm³)');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
