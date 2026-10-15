// End-to-end: drawing extras — centrelines, detail view, balloon, note, tolerance, second sheet, multi-page export.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5209, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const at = (kind, x, y) => page.evaluate(([k, x, y]) => window.__dw.sheet(k, x, y), [kind, x, y]);
const info = () => page.evaluate(() => window.__dw.drawing());
const click = async p => { await page.mouse.move(p.x, p.y); await W(80); await page.mouse.click(p.x, p.y); await W(250); };
const tool = async label => { await page.click(`.rbtn[aria-label^="${label}"]`).catch(async () => { for (const g of ['VIEWS', 'ANNOTATE', 'TABLES', 'SHEET']) { await page.click(`.rlabel:has-text("${g}")`); await W(150); const it = page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }); if (await it.count()) { await it.first().click(); return; } await page.keyboard.press('Escape'); } }); await W(200); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Plate with hole', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [{ id: 'b', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 30, h: 10, op: 'new' }, { id: 'c', type: 'cylinder', name: 'Hole', plane: 'XY', offset: 0, cx: 15, cy: 0, diameter: 8, h: 10, op: 'cut' }] }));
await W(2500);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("DRAWING")'); await W(3000);
let d = await info();
check(d.axes.front >= 1 && d.axes.right >= 1 && d.sheets.length === 1, 'the hole gets centrelines in the front and right views ' + JSON.stringify(d.axes));

// tolerance on a dimension
await page.keyboard.press('d'); await W(150);
await click(await at('front', -30, 0)); await click(await at('front', 30, 0)); await click(await at('front', 0, 10));
await page.keyboard.press('Escape'); await W(150);
const lab = page.locator('#sheetSvg text', { hasText: /^60$/ }).first(); await lab.dblclick(); await W(400);
await page.click('.dialog .seg button:has-text("±")'); await W(200); await page.fill('#dd-plus', '0.05'); await W(200); await page.click('.dialog .btn.ok'); await W(300);
d = await info();
check(d.labels.includes('60 ±0.05'), 'a ± tolerance prints after the value ' + JSON.stringify(d.labels));

// detail view of the hole, enlarged 2×
await tool('Detail View');
await click(await at('top', 15, 0)); await click(await at('top', 23, 0)); await click(await page.evaluate(() => window.__dw.sheetPt(330, 150))); await W(800);
d = await info();
const detTxt = await page.locator('#sheetSvg text', { hasText: /^DETAIL A/ }).count();
check(d.views.some(v => v.startsWith('detail:')) && detTxt === 1, 'detail view A placed with its label ' + JSON.stringify(d.views));
// balloon on the plate in the top view
await tool('Balloon');
await click(await at('top', -20, 8)); await click(await at('top', -45, 25)); await W(300);
d = await info();
check(d.balloons === 1 && (await page.locator('#sheetSvg text', { hasText: /^1$/ }).count()) >= 1, 'balloon with item number 1 attached to the plate');
// note with a leader
await tool('Note');
await click(await at('front', 30, -10)); await click(await page.evaluate(() => window.__dw.sheetPt(250, 60))); await W(400);
await page.fill('#dn-text', 'DEBURR ALL EDGES'); await W(200); await page.click('.dialog .btn.ok'); await W(300);
d = await info();
check(d.notes === 1 && (await page.locator('#sheetSvg text', { hasText: 'DEBURR ALL EDGES' }).count()) === 1, 'note with leader on the sheet');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/drawing2.png' });

// second sheet with a front view
await page.click('.sheettabs .stab.add'); await W(1000);
await tool('Front');
await click(await page.evaluate(() => window.__dw.sheetPt(150, 120))); await W(1500);
d = await info();
check(d.sheets.length === 2 && d.views.length === 1 && (await page.locator('#sheetSvg text', { hasText: '2 / 2' }).count()) === 1, 'second sheet holds its own front view; title block says 2 / 2');
await page.click('.sheettabs .stab >> nth=0'); await W(800);
d = await info();
check(d.views.length >= 5, 'switching back shows sheet 1 again (' + d.views.length + ' views)');

// export: both sheets in one PDF, plus DXF
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('.rbtn[aria-label^="Export PDF"]')]);
let ok = false;
if (dl) { const s = fs.readFileSync(await dl.path()).toString('latin1'); ok = s.includes('/Count 2') && s.includes('ENTITIES') && s.includes('DEBURR ALL EDGES'); if (process.env.SHOTS) fs.copyFileSync(await dl.path(), process.env.SHOTS + '/drawing2.zip'); }
check(ok, 'export: a two-page PDF and DXF files in the zip');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
