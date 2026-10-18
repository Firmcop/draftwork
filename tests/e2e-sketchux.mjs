// End-to-end: sketch plane picking (cursor, highlight, tooltip), click-click shapes, heads-up dimension input,
// sketch stays visible after finishing, Fusion shortcuts (S toolbox, V, L from the model, Ctrl+] / Ctrl+Alt+B), big-model clipping.
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
const state = () => page.evaluate(() => window.__dw.state());
const docNow = () => page.evaluate(() => window.__dw.doc());
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const sks = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const sketchGeo = async () => (await docNow()).features.filter(f => f.type === 'sketch').at(-1)?.geo || { curves: [], cons: [] };
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.click('#newTabBtn'); await W(300); await page.click('.studycard[data-type="part"]'); await W(1500);

// 1. plane picking: arrow cursor, highlighted plane, tooltip
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(600);
const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('#viewport') || document.querySelector('.viewport')).cursor);
check(/url\(/.test(cursor), 'picking a sketch plane shows the arrow-with-plane cursor');
const xy = await scr(25, -25, 0);
await page.mouse.move(xy.x - 20, xy.y - 20); await page.mouse.move(xy.x, xy.y, { steps: 4 }); await W(500);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/pickplane.png' });
check(/XY plane/.test(await page.textContent('#picktip').catch(() => '')), 'hovering the XY square shows an “XY plane” tip: ' + await page.textContent('#picktip').catch(() => '—'));
await page.mouse.click(xy.x, xy.y); await W(1500);
let d = await docNow();
check((await state()).mode === 'sketch' && d.features.at(-1).plane === 'XY', 'the sketch goes on XY');

// 2. click, move, click rectangle
let p = await sks(0, 0); await page.mouse.click(p.x, p.y); await W(250);
p = await sks(20, 10); await page.mouse.move(p.x, p.y, { steps: 6 }); await W(250);
check(await page.isVisible('#skhud'), 'while drawing, the size readout follows the cursor');
await page.mouse.click(p.x, p.y); await W(800);
let g = await sketchGeo();
check(g.curves.filter(c => c.kind === 'line').length === 4, 'click, move, click draws a rectangle (' + g.curves.length + ' curves)');

// 3. heads-up dimension: rectangle 30 × 12 typed
p = await sks(40, 0); await page.mouse.click(p.x, p.y); await W(200);
p = await sks(50, 5); await page.mouse.move(p.x, p.y, { steps: 4 }); await W(200);
await page.keyboard.type('30'); await page.keyboard.press('Tab'); await page.keyboard.type('12'); if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/hud.png' }); await page.keyboard.press('Enter'); await W(900);
g = await sketchGeo();
const lens = g.cons.filter(c => c.type === 'length').map(c => c.value).sort((a, b) => a - b);
check(JSON.stringify(lens) === '[12,30]', 'typed width 30 and height 12 become dimensions ' + JSON.stringify(lens));
// circle Ø15 typed
await page.keyboard.press('c'); await W(200);
p = await sks(0, 40); await page.mouse.click(p.x, p.y); await W(200);
p = await sks(5, 42); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(200);
await page.keyboard.type('15'); await page.keyboard.press('Enter'); await W(900);
g = await sketchGeo();
check(g.cons.some(c => c.type === 'diameter' && c.value === 15), 'typed circle diameter 15');
// line 25 at 0°
await page.keyboard.press('l'); await W(200);
p = await sks(-40, 0); await page.mouse.click(p.x, p.y); await W(200);
p = await sks(-30, 3); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(200);
await page.keyboard.type('25'); await page.keyboard.press('Tab'); await page.keyboard.press('Control+a'); await page.keyboard.type('0'); await page.keyboard.press('Enter'); await W(900);
await page.keyboard.press('Escape'); await W(300);
g = await sketchGeo();
const ln = g.curves.filter(c => c.kind === 'line').at(-1), lc = g.cons.filter(c => c.e?.[0] === ln?.id).map(c => c.type + (c.value != null ? '=' + c.value : ''));
check(lc.includes('length=25') && lc.includes('horizontal'), 'typed line length 25 at 0° ' + JSON.stringify(lc));
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sketchux.png' });

// 4. finish: the sketch stays visible; E extrudes; then the sketch hides
await page.keyboard.press('Escape'); await W(200);
await page.click('.palette .btn.go'); await W(1200);
d = await docNow(); const skId = d.features.at(-1).id;
check(d.sketchShown?.[skId] === true, 'after Finish Sketch the sketch stays visible');
await page.keyboard.press('e'); await W(1200);
check(await page.isVisible('.dialog') && /Extrude/i.test(await page.textContent('.dialog .dhead, .dialog')), 'E opens Extrude on the finished sketch');
await page.click('.dialog .btn.ok'); await idle(); await W(800);
d = await docNow();
check((await state()).bodies.length >= 1 && !d.sketchShown?.[skId], 'extrude builds and the used sketch hides (as in Fusion)');

// 5. shortcuts
await page.mouse.move(700, 450); await page.keyboard.press('s'); await W(300);
check(await page.isVisible('#toolbox'), 'S opens the Model Toolbox');
await page.keyboard.type('fillet'); await W(200);
check(/Fillet/.test(await page.textContent('#toolbox .tb-list')), 'typing filters the commands');
await page.keyboard.press('Escape'); await W(200);
await page.locator('#btree .node:has-text("Bodies") .tw[aria-expanded="false"]').first().click({ timeout: 1500 }).catch(() => {});
await page.locator('#btree .node .nlab:text-is("Body 1")').first().click(); await W(300);
await page.mouse.move(700, 700); await page.keyboard.press('v'); await W(600);
check(Object.values((await docNow()).bodyMeta || {}).some(m => m.hidden), 'V hides the selected body');
await page.keyboard.press('v'); await W(400);
await page.keyboard.press('Control+Alt+b'); await W(300);
check(!(await page.isVisible('#browser')), 'Ctrl+Alt+B hides the browser');
await page.keyboard.press('Control+Alt+r'); await W(300);
check(await page.isVisible('#browser'), 'Ctrl+Alt+R restores the default layout');
await page.keyboard.press('Control+]'); await W(1500);
check((await page.evaluate(() => window.__dw.camera())).ws === 'simulation', 'Ctrl+] goes to the next workspace (Simulation)');
await page.keyboard.press('Control+['); await W(1200);
check((await page.evaluate(() => window.__dw.camera())).ws === 'design', 'Ctrl+[ comes back to Design');
await page.mouse.move(700, 450); await page.keyboard.press('l'); await W(500);
const pl = await scr(25, -25, 0); await page.mouse.move(pl.x, pl.y, { steps: 3 }); await page.mouse.click(pl.x, pl.y); await W(1500);
check((await state()).mode === 'sketch' && (await state()).sketchTool === 'line', 'L in the model starts a sketch with the Line tool');
await page.keyboard.press('Escape'); await page.click('.palette .btn.go').catch(() => {}); await W(800);
await page.click('#abFile'); await W(150); await page.click('.menu .mi:has-text("Keyboard Shortcuts")'); await W(400);
check(/Ctrl\+Alt\+B/.test(await page.textContent('#shortcuts')) && /Projected/.test(await page.textContent('#shortcuts')), 'Keyboard Shortcuts reference lists the Fusion keys');
await page.keyboard.press('Escape'); await W(200);

// 6. a 5 m model stays visible zoomed out and zoomed in
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Big', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [{ id: 'b', type: 'box', name: 'Big', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 5000, d: 5000, h: 5000, op: 'new' }] })); await idle(); await W(800);
await page.click('#vcHome'); await W(800);
for (let i = 0; i < 12; i++) { await page.mouse.move(750, 450); await page.mouse.wheel(0, 600); await W(60); }
await W(400);
let c = await page.evaluate(() => window.__dw.camera());
check(c.far > c.dist + 4000, `zoomed out: far plane ${c.far.toFixed(0)} beyond the model at ${c.dist.toFixed(0)}`);
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -600); await W(30); }
await W(400);
c = await page.evaluate(() => window.__dw.camera());
check(c.near < c.dist * 0.05, `zoomed in: near plane ${c.near.toFixed(3)} well inside the camera distance ${c.dist.toFixed(1)}`);

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
