// End-to-end: chamfer types, variable fillet, full round fillet, offset face, silhouette split, sweep end scale, loft to a point.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5216, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const vols = async () => (await page.evaluate(() => window.__dw.props())).map(p => p.volume);
const state = () => page.evaluate(() => window.__dw.state());
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const clickAt = async p => { await page.mouse.move(p.x, p.y); await W(80); await page.mouse.click(p.x, p.y); await W(900); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1500); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const menu = async label => { await page.click('.rlabel:has-text("MODIFY")'); await W(250); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(800); };
const setDoc = async feats => { await page.evaluate(f => window.__dw.setDoc({ version: 2, name: 'Shapes', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: f }), feats); await W(2500); await page.click('#vcHome'); await W(600); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await setDoc([{ id: 'b', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' }]);

// chamfer with two distances on the top front edge (y = -15, z = 20)
await page.click('.rbtn[aria-label^="Chamfer"]'); await W(700);
await clickAt(await scr(0, -15, 20));
await page.click('.dialog .seg button:has-text("Two distances")'); await W(500);
await page.fill('#dx-chdist', '2'); await page.fill('#dx-distance2', '4'); await page.keyboard.press('Tab'); await W(1500);
check(near(24000 - (await vols())[0], 160, 1e-3), 'two-distance chamfer 2 × 4 removes 160 mm³');
await page.click('.dialog .seg button:has-text("Distance and angle")'); await W(500);
await page.fill('#dx-chdist', '3'); await page.fill('#dx-chamferAngle', '45'); await page.keyboard.press('Tab'); await W(1500);
check(near(24000 - (await vols())[0], 180, 1e-3), 'distance + angle 3 mm at 45° removes 180 mm³');
await ok();

// variable fillet on the top back edge
await page.click('.rbtn[aria-label^="Fillet"]'); await W(700);
await clickAt(await scr(0, 15, 20));
await page.click('.dialog .seg button:has-text("Variable")'); await W(500);
await page.fill('#dx-radius', '2'); await page.fill('#dx-radius2', '6'); await page.keyboard.press('Tab'); await W(2000);
let st = await state();
check(st.features.at(-1) === 'fillet:ok', 'variable radius fillet 2 → 6 builds ' + JSON.stringify(st.features));
await ok();

// offset face: push the top down 3 (chamfer and fillet faces follow)
const v0 = (await vols())[0];
await menu('Offset Face'); await clickAt(await scr(0, 0, 20));
await page.fill('#dx-ofdist', '-3'); await page.keyboard.press('Tab'); await W(2000);
st = await state();
check(st.features.at(-1) === 'offsetface:ok' && (await vols())[0] < v0 - 40 * 20 * 3, 'Offset Face pushes the top down 3 mm (' + (v0 - (await vols())[0]).toFixed(0) + ' mm³ less)');
await ok();

// full round fillet on a rib
await setDoc([{ id: 'r', type: 'box', name: 'Rib', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 6, d: 40, h: 20, op: 'new' }]);
await menu('Full Round Fillet'); await clickAt(await scr(0, 0, 20)); await W(1500);
check(near(4800 - (await vols())[0], (18 - Math.PI * 4.5) * 40, 0.5), 'full round: top becomes a half cylinder R3');
await ok();

// silhouette split of a lying cylinder (look down Z)
await setDoc([{ id: 's', type: 'sketch', name: 'Sketch 1', plane: 'YZ', offset: 0, profiles: [{ id: 'c', kind: 'circle', cx: 0, cy: 10, r: 10 }] }, { id: 'e', type: 'extrude', name: 'Extrude 1', sketch: 's', distance: 50, op: 'new' }]);
await menu('Silhouette Split'); await W(1500);
let v = await vols();
check(v.length === 2 && near(v[0], v[1], 1e-2), 'silhouette split makes two equal halves ' + v.map(x => x.toFixed(0)));
await ok();

// sweep with end scale and loft to a point
await setDoc([{ id: 'pth', type: 'sketch', name: 'Path', plane: 'XZ', offset: 0, profiles: [], geo: { points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 40 }], curves: [{ id: 'l', kind: 'line', a: 'a', b: 'b' }], cons: [] } },
  { id: 'w', type: 'sweep', name: 'Sweep 1', path: 'pth', profileKind: 'circle', diameter: 20, op: 'new' }]);
await page.evaluate(() => window.__dw.edit('w')); await W(800);
await page.fill('#dx-scaleEnd', '0.5'); await page.keyboard.press('Tab'); await W(2000);
check(near((await vols())[0], Math.PI * 40 / 3 * 175, 1), 'sweep end scale 0.5 makes a frustum');
await ok();
await setDoc([{ id: 's1', type: 'sketch', name: 'Base', plane: 'XY', offset: 0, profiles: [{ id: 'c', kind: 'circle', cx: 0, cy: 0, r: 10 }] }, { id: 'pt', type: 'point', name: 'Tip', mode: 'xyz', x: 0, y: 0, z: 30 },
  { id: 'l', type: 'loft', name: 'Loft 1', sketches: ['s1'], op: 'new' }]);
await page.evaluate(() => window.__dw.edit('l')); await W(800);
await page.selectOption('#ds-endpt', 'pt'); await W(2000);
check(near((await vols())[0], Math.PI * 1000, 1), 'loft to an end point makes a cone');
await ok();

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
