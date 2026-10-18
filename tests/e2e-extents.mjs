// End-to-end: extrude extents (two sides, to object, all), taper, thin, start offset; revolve two sides; hole countersink, tapped, through all.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5215, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const vol = async () => (await page.evaluate(() => window.__dw.props()))[0]?.volume;
const state = () => page.evaluate(() => window.__dw.state());
const edit = async id => { await page.evaluate(id => window.__dw.edit(id), id); await W(700); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1500); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const setDoc = async feats => { await page.evaluate(f => window.__dw.setDoc({ version: 2, name: 'Extents', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: f }), feats); await W(2500); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await setDoc([{ id: 's', type: 'sketch', name: 'Sketch 1', plane: 'XY', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 20, h: 20 }] },
  { id: 'p', type: 'plane', name: 'Plane 1', base: 'XY', offset: 17 },
  { id: 'e', type: 'extrude', name: 'Extrude 1', sketch: 's', distance: 10, op: 'new' }]);
check(near(await vol(), 4000, 1e-3), 'start: 20 × 20 × 10');

// two sides
await edit('e');
check(await page.isVisible('#ds-extent'), 'extrude dialog has an Extent list');
await page.selectOption('#ds-extent', 'two'); await W(500);
await page.fill('#dx-distance2', '4'); await page.keyboard.press('Tab'); await W(1500);
check(near(await vol(), 5600, 1e-3), 'two sides 10 + 4 → ' + await vol());
// taper
await page.fill('#dx-taper', '10'); await page.keyboard.press('Tab'); await W(2000);
const b = 20 - 20 * Math.tan(Math.PI / 18), b4 = 20 - 8 * Math.tan(Math.PI / 18);
const expT = 10 / 3 * (400 + 20 * b + b * b) + 4 / 3 * (400 + 20 * b4 + b4 * b4);
check(near(await vol(), expT, 0.1), `taper 10° narrows both sides (${(await vol()).toFixed(1)} vs ${expT.toFixed(1)})`);
await page.fill('#dx-taper', '0'); await page.keyboard.press('Tab'); await W(1200);
// to object
await page.selectOption('#ds-extent', 'to'); await W(500);
await page.selectOption('#ds-to', 'p'); await W(1800);
check(near(await vol(), 400 * 17, 1e-3), 'To object: up to Plane 1 at 17 mm');
// thin + start offset
await page.selectOption('#ds-extent', 'distance'); await W(500);
await page.fill('#dx-distance', '10'); await page.keyboard.press('Tab'); await W(600);
await page.click('#dc-thin'); await W(600);
await page.fill('#dx-thickness', '2'); await page.keyboard.press('Tab'); await W(1500);
check(near(await vol(), (400 - 256) * 10, 1e-3), 'thin wall 2 mm inside → ' + await vol());
await page.fill('#dx-startOffset', '5'); await page.keyboard.press('Tab'); await W(1500);
await ok();
const bb = await page.evaluate(() => { const b = [...window.__dw.meshes ? [] : []]; return null; });
let st = await state();
check(st.features.at(-1) === 'extrude:ok' && near(await vol(), 1440, 1e-3), 'start offset keeps the volume; extrude builds ' + JSON.stringify(st.features));
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/extents.png' });

// revolve two sides
await setDoc([{ id: 's', type: 'sketch', name: 'Sketch 1', plane: 'XZ', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 15, cy: 0, w: 10, h: 10 }] },
  { id: 'v', type: 'revolve', name: 'Revolve 1', sketch: 's', axis: 'v', angle: 90, op: 'new' }]);
const V = 2 * Math.PI * 15 * 100;
await edit('v'); await page.selectOption('#ds-extent', 'two'); await W(500); await page.fill('#dx-angle2', '45'); await page.keyboard.press('Tab'); await W(1500);
check(near(await vol(), V * 135 / 360, 0.01), 'revolve two sides 90° + 45°');
await page.selectOption('#ds-extent', 'full'); await W(1500);
check(near(await vol(), V, 0.01), 'revolve full');
await ok();

// holes
await setDoc([{ id: 'b', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 40, h: 20, op: 'new' },
  { id: 'h', type: 'hole', name: 'Hole 1', plane: 'XY', offset: 20, cx: 0, cy: 0, diameter: 6, depth: 10, tip: false }]);
await edit('h');
await page.click('.dialog .seg button:has-text("C-sink")'); await W(600);
await page.fill('#dx-csDiameter', '12'); await page.keyboard.press('Tab'); await W(1500);
const cone = Math.PI * (36 + 18 + 9), cyl = Math.PI * 9 * 7;
check(near(32000 - await vol(), cone + cyl, 0.05), 'countersink Ø12 × 90° on a Ø6 hole');
await page.click('#dc-tapped'); await W(600);
await page.selectOption('#ds-tapsize', 'M8'); await W(1500);
check(near(32000 - await vol(), Math.PI * (36 + 6 * 3.375 + 3.375 ** 2) * (6 - 3.375) / 3 + Math.PI * 3.375 ** 2 * (10 - (6 - 3.375)), 0.05), 'tapped M8: tap drill Ø6.75 under the countersink');
await page.selectOption('#ds-extent', 'all'); await W(1500);
const removedAll = 32000 - await vol();
check(removedAll > Math.PI * 3.375 ** 2 * 20 && removedAll < Math.PI * 3.375 ** 2 * 20 + 300, 'through all: the hole goes through the 20 mm plate (' + removedAll.toFixed(1) + ' mm³ removed)');
await page.click('#dc-modeled'); await W(600); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 }); await W(500);
const removedMod = 32000 - await vol();
check(removedMod > removedAll + 40, `modeled thread cuts into the wall (${removedAll.toFixed(1)} → ${removedMod.toFixed(1)} mm³)`);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/hole-tapped.png' });
await ok();
st = await state();
check(st.features.at(-1) === 'hole:ok', 'hole builds ' + JSON.stringify(st.features));

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
