// End-to-end: modeling tools added in the "complete Design" steps — construction geometry and solid tools.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5202, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const clickAt = async p => { await page.mouse.move(p.x, p.y); await W(80); await page.mouse.click(p.x, p.y); await W(400); };
const docNow = () => page.evaluate(() => window.__dw.doc());
const state = () => page.evaluate(() => window.__dw.state());
const menu = async (group, label) => { await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.click(`.menu .mi:has-text("${label}")`); await W(400); };
const setDoc = d => page.evaluate(d => window.__dw.setDoc(d), { version: 2, name: 'Test', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, ...d });
const ok = async () => { await page.click('.dialog .btn.ok'); await W(800); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });

// ---- construction: axis through a cylinder, then a circular pattern around it ----
await setDoc({ features: [{ id: 'c', type: 'cylinder', name: 'Shaft', plane: 'XY', offset: 0, cx: 30, cy: 0, diameter: 10, h: 20, op: 'new' }, { id: 'b', type: 'box', name: 'Lug', plane: 'XY', offset: 0, cx: 50, cy: 0, w: 6, d: 6, h: 6, op: 'new' }] });
await W(2500); await page.click('#vcHome'); await W(800);
await menu('CONSTRUCT', 'Axis Through Cylinder'); await clickAt(await scr(30, -5, 10)); await ok();
let d = await docNow(), ax = d.features.find(f => f.type === 'axis');
check(ax && Math.abs(Math.abs(ax.d[2]) - 1) < 1e-6 && Math.abs(ax.o[0] - 30) < 1e-6, 'axis through cylinder runs along the shaft centre ' + JSON.stringify(ax && { o: ax.o, d: ax.d }));
await page.evaluate(id => { const x = window.__dw.doc(); x.features.push({ id: 'pt', type: 'pattern', name: 'Pattern', kind: 'circular', source: 'b', axis: id, count: 3, angle: 360 }); window.__dw.setDoc(x); }, ax.id); await W(2500);
let st = await state();
check(st.bodies.length === 4 && st.features.every(s => s.endsWith(':ok')), 'circular pattern around the construction axis: shaft + 3 lugs ' + JSON.stringify(st));

// ---- plane at angle from the XY plane, about its X direction ----
await menu('CONSTRUCT', 'Plane at Angle');
if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw');
await page.click('.node .nlab:text-is("XY")'); await W(800);
await page.fill('#dx-angle', '30'); await W(1200); await ok();
d = await docNow();
const pa = d.features.find(f => f.type === 'plane' && f.mode === 'angle');
check(pa && +pa.angle === 30, 'plane at angle created (30°)');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
