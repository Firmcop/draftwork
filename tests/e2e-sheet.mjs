// End-to-end: Sheet Metal tab — base flange, edge flange, flat pattern, rules, unfold.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5205, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const clickAt = async p => { await page.mouse.move(p.x, p.y); await W(80); await page.mouse.click(p.x, p.y); await W(500); };
const state = () => page.evaluate(() => window.__dw.state());
const props = () => page.evaluate(() => window.__dw.props());
const docNow = () => page.evaluate(() => window.__dw.doc());
const menu = async (group, label) => { await page.click('.rtab:text-is("SHEET METAL")'); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(600); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1200); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Bracket', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [{ id: 'sk', type: 'sketch', name: 'Sketch 1', plane: 'XY', offset: 0, profiles: [{ id: 'r', kind: 'rect', cx: 0, cy: 0, w: 60, h: 40 }] }] }));
await W(2000); await page.click('#vcHome'); await W(600);

await menu('CREATE', 'Flange'); await W(1500); await ok();
let d = await docNow(), p = await props();
check(d.params.some(q => q.name === 'sm_thickness') && p.length === 1 && Math.abs(p[0].volume - 60 * 40 * 1.5) < 1e-3, 'base flange: 1.5 mm plate, rules added as parameters ' + JSON.stringify(p));
// edge flange on the +Y top edge
await menu('CREATE', 'Flange'); await clickAt(await scr(0, 20, 1.5)); await W(1500);
await page.fill('#dx-height', '12'); await W(1500); await ok();
let st = await state(); p = await props();
check(st.features.at(-1) === 'flange:ok' && p[0].volume > 60 * 40 * 1.5 + 12 * 1.5 * 60, 'edge flange adds a bend and a 12 mm wall ' + JSON.stringify(st.features) + ' ' + JSON.stringify(p));
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sheet.png' });

// flat pattern: 40 + BA + 12 where BA = pi/2 * (1.5 + 0.44*1.5)
await menu('MODIFY', 'Create Flat Pattern'); await W(1500);
const BA = Math.PI / 2 * (1.5 + 0.44 * 1.5), txt = await page.textContent('#modal'), m = txt.match(/([\d.]+) × ([\d.]+) mm/);
check(m && Math.abs(+m[1] - 60) < 1e-3 && Math.abs(+m[2] - (40 + BA + 12)) < 1e-3 && (await page.locator('#modal svg path').count()) >= 1, 'flat pattern dialog shows 60 × (40 + BA + 12) = ' + (40 + BA + 12).toFixed(3) + ' (' + (m && m[0]) + ')');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('#modal .btn:has-text("Export DXF")')]);
let dxfOk = false;
if (dl) { const s = fs.readFileSync(await dl.path()).toString('latin1'); dxfOk = s.includes('ENTITIES') && s.includes('BEND') && s.includes('-flat.dxf'); }
check(dxfOk, 'Export DXF downloads a zip with the DXF (outline + bend layer)');
await page.click('#modal .btn.ok'); await W(300);

// rules: thickness 2 rebuilds everything
await menu('MODIFY', 'Sheet Metal Rules'); await page.fill('#sm-sm_thickness', '2'); await page.click('#modal .btn.ok'); await W(2500);
p = await props();
check(p[0].volume > 60 * 40 * 2, 'changing the rule thickness to 2 mm rebuilds the part (' + p[0].volume + ')');
// unfold
await menu('MODIFY', 'Unfold'); await W(1500); await ok();
p = await props();
const BA2 = Math.PI / 2 * (1.5 + 0.44 * 2);
check(Math.abs(p[0].volume - 60 * (40 + BA2 + 12) * 2) < 0.01, 'unfold lays it flat: 60 × (40 + BA + 12) × 2 (' + p[0].volume + ')');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
