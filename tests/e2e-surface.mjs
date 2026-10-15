// End-to-end: Surface tab — extrude surface, trim, delete face, patch from edges, stitch back to a solid.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5204, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
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
const menu = async (group, label) => { await page.click('.rtab:text-is("SURFACE")'); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(500); };
const setDoc = d => page.evaluate(d => window.__dw.setDoc(d), { version: 2, name: 'Test', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, ...d });
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1000); };
const P = (id, x, y) => ({ id, x, y });

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });

// an open chain sketch -> extrude surface
await setDoc({ features: [{ id: 's', type: 'sketch', name: 'Sketch 1', plane: 'XY', offset: 0, profiles: [], geo: { points: [P('a', -20, 0), P('b', 0, 0), P('c', 0, 10)], curves: [{ id: 'l1', kind: 'line', a: 'a', b: 'b' }, { id: 'l2', kind: 'line', a: 'b', b: 'c' }], cons: [] } }] });
await W(2000); await page.click('#vcHome'); await W(600);
await menu('CREATE', 'Extrude Surface'); await page.fill('#dx-distance', '8'); await W(1500); await ok();
let p = await props();
check(p.length === 1 && p[0].surface && Math.abs(p[0].area - 30 * 8) < 1e-6, 'extrude surface: one surface body of 240 mm² ' + JSON.stringify(p));
// trim it with the YZ plane... the chain lies at x <= 0, so trim with a plane through x = -10 (offset XZ? use YZ offset)
await menu('MODIFY', 'Trim'); await W(800); await ok();
let st = await state();
check(st.features.at(-1) === 'trim:ok', 'trim with the YZ plane ' + JSON.stringify(st.features));

// a box: delete its top face, patch the opening from the four edges, stitch back into a solid
await setDoc({ features: [{ id: 'b', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 20, h: 10, op: 'new' }] });
await W(2500); await page.click('#vcHome'); await W(800);
await menu('MODIFY', 'Delete Face'); await clickAt(await scr(5, 3, 10)); await W(1200); await ok();
p = await props();
check(p.length === 1 && p[0].surface, 'delete face: the box becomes an open surface ' + JSON.stringify(p));
await menu('CREATE', 'Patch');
for (const q of [[0, -10, 10], [20, 0, 10], [0, 10, 10], [-20, 0, 10]]) await clickAt(await scr(...q));
await W(1500); await ok();
st = await state();
check(st.features.at(-1) === 'patch:ok', 'patch fills the opening from four picked edges ' + JSON.stringify(st.features));
await menu('MODIFY', 'Stitch'); await W(1500); await ok();
p = await props();
check(p.length === 1 && !p[0].surface && Math.abs(p[0].volume - 8000) < 1e-3, 'stitch closes it back into an 8,000 mm³ solid ' + JSON.stringify(p));

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
