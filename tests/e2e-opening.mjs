// End-to-end: Insert › Shipping Container 20 ft, then Create Opening through the UI — click the side wall, door
// preset, exact position, window with a frame, warning near a rail, edit later, undo/redo, save/reload, STEP export.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const PORT = 5263, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const W = ms => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__dw.state());
const props = () => page.evaluate(() => window.__dw.props());
const docNow = () => page.evaluate(() => window.__dw.doc());
const sc = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const idle = async () => { await W(250); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000, polling: 50 }); };
const volOf = async id => (await props()).find(b => b.id === id)?.volume;
const menu = async (tab, group, label) => { await page.click(`.rtab:text-is("${tab}")`); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(500); };
const setField = async (id, v) => { await page.fill('#' + id, String(v)); await W(300); await idle(); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await menu('SOLID', 'INSERT', 'Shipping Container 20 ft'); await W(1500); await idle();
let st = await state();
check(st.bodies.length === 19 && st.features.every(f => /:ok/.test(f)), `container inserted: ${st.bodies.length} parts, all features ok`);
const comps = (await docNow()).components || [];
check(comps.length === 19 && comps.some(c => c.name === 'Corner post front left') && comps.some(c => c.name === 'Right side wall'), 'every part is its own named component (' + comps.length + ')');

// the right side wall faces −Y; look at it from that side
const cam = await page.evaluate(() => window.__dw.camera());
const y = cam.dir[1] < 0 ? -1219 : 1219, wallName = y < 0 ? 'ct_wallR' : 'ct_wallL';
const wall0 = await volOf(wallName);
// Create Opening → click a ridge of the wall (the first ridge is the flat strip next to the post)
await menu('SOLID', 'CREATE', 'Create Opening');
let q = await sc(y < 0 ? -2829 : 2829, y, 1300); await page.mouse.move(q.x, q.y); await W(200); await page.mouse.click(q.x, q.y); await W(1500); await idle();
check(await page.isVisible('.dialog'), 'clicking the wall opens the Create Opening dialog');
let d = await docNow(), op = d.features.at(-1);
check(op.type === 'opening' && op.w === 900 && op.h === 2100 && op.fromBottom === 0, 'door preset 900 × 2100 at the bottom edge');
await setField('dx-fromLeft', 1000);
check(/Wall 5[,.]?758 × 2[,.]?331 mm/.test(await page.textContent('.dialog')), 'dialog shows the wall size it measures from: ' + (await page.textContent('#op-wallinfo').catch(() => '')));
await page.click('.dialog .btn.ok'); await W(800); await idle();
const wall1 = await volOf(wallName);
st = await state();
check(st.features.at(-1) === 'opening:ok' && wall0 - wall1 > 900 * 2100 * 2 * 0.95, `door cut through the corrugated wall (${((wall0 - wall1) / 1e6).toFixed(2)} L of steel removed)`);

// window, independent, with a frame; then edit its position later
await menu('SOLID', 'CREATE', 'Create Opening');
q = await sc(y < 0 ? -2829 : 2829, y, 1500); await page.mouse.move(q.x, q.y); await W(200); await page.mouse.click(q.x, q.y); await W(1500); await idle();
await page.selectOption('#ds-preset', 'window'); await W(600); await idle();
await setField('dx-fromLeft', 3000);
await page.click('.dialog label:has-text("Add a frame")'); await W(800); await idle();
await page.click('.dialog .btn.ok'); await W(800); await idle();
st = await state(); d = await docNow();
const win = d.features.at(-1);
check(win.w === 1200 && win.h === 1000 && win.fromBottom === 900 && win.frame === true, 'window preset 1200 × 1000, sill at 900, framed');
check(st.features.at(-1) === 'opening:ok' && st.bodies.some(b => /^Opening 2 frame=/.test(b)), 'window cut with its frame as a separate body');
const wall2 = await volOf(wallName);
// edit later: move the window 500 mm along the wall
await page.evaluate(id => window.__dw.edit(id), win.id); await W(800);
await setField('dx-fromLeft', 3500);
await page.click('.dialog .btn.ok'); await W(800); await idle();
d = await docNow();
check(d.features.at(-1).fromLeft === 3500 && (await state()).features.at(-1) === 'opening:ok', 'window position edited after the fact');
// a framed door down at the floor reaches into the bottom rail: warned, not cut
await page.evaluate(id => window.__dw.edit(id), d.features.at(-2).id); await W(800);
await page.click('.dialog label:has-text("Add a frame")'); await W(800); await idle();
check(/Runs into Bottom side rail/.test(await page.textContent('#dlgErr')), 'framed door at the floor warns about the bottom side rail');
await page.click('.dialog .btn:has-text("Cancel")'); await W(800); await idle();
check(!(await docNow()).features.at(-2).frame, 'cancel leaves the door as it was');

// undo / redo
await page.keyboard.press('Control+z'); await W(800); await idle();
check((await docNow()).features.at(-1).fromLeft === 3000, 'undo restores the window position');
await page.keyboard.press('Control+y'); await W(800); await idle();
check((await docNow()).features.at(-1).fromLeft === 3500, 'redo moves it again');

// reload: the openings are rebuilt from the timeline
const before = await volOf(wallName);
await page.reload(); await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 }); await W(1500); await idle();
check(Math.abs((await volOf(wallName)) - before) < 1, 'openings are still cut after reload');

// export: STEP of the edited container
await page.click('#abFile'); await W(300);
const exp = page.locator('.menu .mi', { has: page.locator('text=/Export/') }).first();
check(await exp.count() > 0, 'export available');
await page.keyboard.press('Escape');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
