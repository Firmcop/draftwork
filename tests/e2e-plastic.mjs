// End-to-end: Plastic tab — rules, boss, snap fit, rest, lip.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5206, server = serve(PORT);
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
const menu = async (group, label) => { await page.click('.rtab:text-is("PLASTIC")'); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(600); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1200); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Case', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [{ id: 'p', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 3, op: 'new' }] }));
await W(2500); await page.click('#vcHome'); await W(600);
const v0 = 60 * 40 * 3;
await menu('CREATE', 'Boss'); await clickAt(await scr(12, -5, 3)); await W(1500); await ok();
let d = await docNow(), st = await state(), p = await props();
check(d.params.some(q => q.name === 'pl_wall') && st.features.at(-1) === 'boss:ok' && p[0].volume > v0 + 200, 'boss on the plate; plastic rules added ' + JSON.stringify(st.features) + ' ' + JSON.stringify(p) + JSON.stringify(d.features.at(-1)));
await menu('CREATE', 'Snap Fit'); await clickAt(await scr(-12, -10, 3)); await W(1500); await ok();
st = await state(); const v1 = p[0].volume; p = await props();
check(st.features.at(-1) === 'snapfit:ok' && p[0].volume > v1 + 50, 'snap fit hook added ' + p[0].volume);
await menu('CREATE', 'Rest'); await clickAt(await scr(-20, -14, 3)); await W(1500); await ok();
st = await state();
check(st.features.at(-1) === 'rest:ok', 'rest pad added');
// lip on a shelled box
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Case', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [{ id: 'bx', type: 'box', name: 'Case', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' },
    { id: 'sh', type: 'shell', name: 'Shell', edges: [{ type: 'PLANE', c: [0, 0, 20], n: [0, 0, 1] }], thickness: 2 }] }));
await W(2500); await page.click('#vcHome'); await W(600);
p = await props(); const vs = p[0].volume;
await menu('CREATE', 'Lip / Groove'); await clickAt(await scr(19, 0, 20)); await W(1500); await ok();
st = await state(); p = await props();
check(st.features.at(-1) === 'lip:ok' && p[0].volume > vs + 100, 'lip runs around the opening ' + JSON.stringify(st.features) + ' ' + vs + ' -> ' + p[0].volume);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/plastic.png' });
// rules: wall thickness drives the lip width (pl_wall/2)
await menu('SETUP', 'Plastic Rules'); await page.fill('#rule-pl_wall', '3'); await page.click('#modal .btn.ok'); await W(2500);
p = await props();
check(p[0].volume > vs + 150, 'a thicker wall rule widens the lip (' + p[0].volume + ')');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
