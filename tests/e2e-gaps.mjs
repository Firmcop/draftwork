// End-to-end: loft rails and end conditions, sweep twist, assembly designs (components, insert from the library, update), document units.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5218, server = serve(PORT);
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
const docNow = () => page.evaluate(() => window.__dw.doc());
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1500); };
const near = (a, b, t) => Math.abs(a - b) <= t;
const D = (feats, extra = {}) => ({ version: 2, name: 'Gaps', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: feats, ...extra });
const setDoc = async (feats, extra) => { await page.evaluate(d => window.__dw.setDoc(d), D(feats, extra)); await W(2500); };
const circ = (id, r, offset) => ({ id, type: 'sketch', name: id, plane: 'XY', offset, profiles: [{ id: id + 'c', kind: 'circle', cx: 0, cy: 0, r }] });
const chain = (id, plane, pts) => ({ id, type: 'sketch', name: id, plane, offset: 0, profiles: [], geo: { points: pts.map((p, i) => ({ id: id + i, x: p[0], y: p[1] })), curves: pts.slice(1).map((p, i) => ({ id: id + 'l' + i, kind: 'line', a: id + i, b: id + (i + 1) })), cons: [] } });

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });

// loft rails and ends
await setDoc([circ('a', 10, 0), circ('b', 10, 30), chain('rl', 'XZ', [[10, 0], [16, 15], [10, 30]]), { id: 'l', type: 'loft', name: 'Loft 1', sketches: ['a', 'b'], op: 'new' }]);
const v0 = (await vols())[0];
check(near(v0, Math.PI * 100 * 30, 1), 'straight loft between equal circles is a cylinder');
await page.evaluate(() => window.__dw.edit('l')); await W(800);
await page.click('#lr-rl'); await W(600); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 }); await W(500);
const v1 = (await vols())[0];
check(v1 > v0 * 1.4 && (await state()).features.at(-1) === 'loft:ok', `the rail bulges the loft (${v0.toFixed(0)} → ${v1.toFixed(0)} mm³)`);
await page.click('#lr-rl'); await W(800);
await page.selectOption('#ds-startcond', 'normal'); await page.selectOption('#ds-endcond', 'normal'); await W(2500);
check((await state()).features.at(-1) === 'loft:ok', 'normal end conditions build');
await ok();

// sweep twist
await setDoc([chain('p', 'XZ', [[0, 0], [0, 40]]), { id: 's', type: 'sketch', name: 'Profile', plane: 'XY', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10 }] },
  { id: 'w', type: 'sweep', name: 'Sweep 1', path: 'p', profileKind: 'sketch', profile: 's', op: 'new' }]);
await page.evaluate(() => window.__dw.edit('w')); await W(800);
await page.fill('#dx-twist', '90'); await page.keyboard.press('Tab'); await W(3000);
check((await state()).features.at(-1) === 'sweep:ok' && near((await vols())[0], 8000, 3), 'sweep twisted 90° keeps the volume (' + (await vols())[0]?.toFixed(1) + ')');
await ok();

// save a part to the library
await setDoc([{ id: 'b', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 20, d: 20, h: 10, op: 'new' }], { name: 'Block part', meta: { type: 'part' } });
await page.click('#abSave'); await W(500); await page.fill('#save-name', 'Block part'); await page.click('#save-ok'); await W(1200);
// new assembly design
await page.click('#newTabBtn'); await W(400); await page.click('.studycard[data-type="assembly"]'); await W(1000);
await page.evaluate(() => { const d = window.__dw.doc(); d.features.push({ id: 'base', type: 'box', name: 'Base plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 5, op: 'new' }); window.__dw.setDoc(d); }); await W(2500);
let d = await docNow();
check(d.meta.type === 'assembly' && d.components?.length === 1 && d.components[0].name === 'Base plate', 'assembly design: the new body goes into its own component ' + JSON.stringify(d.components));
// insert the saved part from the data panel
await page.click('#abData'); await W(600);
await page.locator('#dp-list .dpitem[data-id]:has-text("Block part")').first().click({ button: 'right' }); await W(300);
await page.click('.menu .mi:has-text("Insert into Current Design")'); await W(3500);
d = await docNow();
check((await state()).features.at(-1) === 'derive:ok' && d.components.length === 2 && (await vols()).length === 2, 'Insert into Current Design adds the part as a second component');
// change the part and save v2, then update in the assembly
await page.click('#abData'); await W(500);
await page.dblclick('#dp-list .dpitem[data-id]:has-text("Block part")'); await W(2500);
await page.evaluate(() => { const d = window.__dw.doc(); d.features[0].h = 20; window.__dw.setDoc(d); }); await W(2000);
await page.keyboard.press('Control+s'); await W(400); await page.click('#save-ok'); await W(1200);
await page.click('#docTabs .dtab:has-text("Untitled assembly") .dtmain'); await W(2500);
const deriveId = (await docNow()).features.find(f => f.type === 'derive').id;
await page.evaluate(id => window.__dw.edit(id), deriveId); await W(1200);
check(/v2 available/.test(await page.textContent('#derive-src')), 'the derived component reports that v2 is available');
await page.click('#derive-update'); await W(3000);
const vv = (await vols()).sort((a, b) => a - b);
check(near(vv[0], 20 * 20 * 20, 1e-3), 'Update brings in the taller block (' + vv.map(v => v.toFixed(0)) + ')');
await ok();

// document units
await page.locator('#btree .node:has-text("Document Settings") .tw[aria-expanded="false"]').first().click({ timeout: 2000 }).catch(() => {}); await W(300);
if (await page.isVisible('#dataPanel')) { await page.click('#dataPanel .dphead .x'); await W(200); }
await page.click('#btree .node:has-text("Units:")'); await W(400);
await page.selectOption('#units-sel', 'in'); await page.click('#units-ok'); await W(800);
check(/in³/.test(await page.textContent('#tlInfo')) && /Units: in/.test(await page.textContent('#btree')), 'document units in inches: status bar shows in³');
await page.evaluate(() => { const d = window.__dw.doc(); d.features.find(f => f.id === 'base').h = '0.5 in'; window.__dw.setDoc(d); }); await W(2500);
const base = (await vols()).sort((a, b) => b - a)[0];
check(near(base, 60 * 40 * 12.7, 1e-3), 'a value typed as 0.5 in builds 12.7 mm');
// a plain number in a length field is in document units
await page.evaluate(() => window.__dw.edit('base')); await W(800);
check((await page.inputValue('#dx-w')) === '2.362' && /in/.test(await page.textContent('#dx-w ~ .u')), 'length fields show inches (60 mm → 2.362 in)');
await page.fill('#dx-w', '3'); await page.keyboard.press('Tab'); await W(2000);
check(near((await docNow()).features.find(f => f.id === 'base').w, 76.2, 1e-9), 'typing 3 stores 76.2 mm');
await ok();

// hybrid design: the New Component operation
await page.click('#newTabBtn'); await W(400); await page.click('.studycard[data-type="hybrid"]'); await W(1000);
await page.evaluate(() => { const d = window.__dw.doc(); d.features.push({ id: 'k1', type: 'box', name: 'Bracket', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 20, d: 20, h: 10, op: 'new' }, { id: 'k2', type: 'box', name: 'Pin', plane: 'XY', offset: 0, cx: 40, cy: 0, w: 5, d: 5, h: 20, op: 'newcomp' }); window.__dw.setDoc(d); }); await W(2500);
d = await docNow();
check(d.components?.length === 1 && d.components[0].name === 'Pin' && (await vols()).length === 2, 'Hybrid: a body made with New Component gets its own component; plain New Body does not ' + JSON.stringify(d.components));
await page.evaluate(() => window.__dw.edit('k1')); await W(700);
check((await page.locator('#ds-op option[value="newcomp"]').count()) === 1, 'the Operation list offers New Component in a Hybrid design');
await page.keyboard.press('Escape'); await W(300);

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
