// End-to-end: command wheel (right-click), preferences (Y up, theme, new-design material), Create Drawing from the browser, job status.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5217, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const cam = () => page.evaluate(() => window.__dw.camera());
const state = () => page.evaluate(() => window.__dw.state());

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'UI', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'a', type: 'box', name: 'A', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 20, d: 20, h: 10, op: 'new' }, { id: 'b', type: 'box', name: 'B', plane: 'XY', offset: 0, cx: 40, cy: 0, w: 10, d: 10, h: 10, op: 'new' }] }));
await W(2500);

// command wheel on right-click; right-drag does not open it
await page.mouse.move(300, 700); await page.mouse.down({ button: 'right' }); await page.mouse.move(360, 720, { steps: 5 }); await page.mouse.up({ button: 'right' }); await W(300);
check(!(await page.locator('#wheel').count()), 'right-drag pans without opening the wheel');
await page.mouse.click(300, 700, { button: 'right' }); await W(400);
check(await page.isVisible('#wheel .wheel-item') && (await page.locator('#wheel .wheel-item').count()) === 8, 'right-click opens the command wheel with 8 commands');
check(/Undo/.test(await page.textContent('#wheel')) && /Press Pull/.test(await page.textContent('#wheel')), 'wheel holds Undo and Press Pull, plus more commands below');
await page.keyboard.press('Escape'); await W(200);
check(!(await page.locator('#wheel').count()), 'Escape closes the wheel');
// repeat last command
await page.click('.rbtn[aria-label^="Measure"]'); await W(300); await page.keyboard.press('Escape'); await W(200);
await page.mouse.click(300, 700, { button: 'right' }); await W(400);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/wheel.png' });
check(/Repeat Measure/.test(await page.textContent('#wheel [data-id="repeat"]')), 'wheel offers to repeat the last command: ' + await page.textContent('#wheel [data-id="repeat"]'));
// Undo from the wheel
const n0 = (await state()).features.length;
await page.click('#wheel [data-id="undo"]'); await W(1500);
check((await state()).features.length !== n0 || (await state()).bodies.length !== 2, 'Undo from the wheel goes back a step');
await page.click('#abRedo'); await W(1500);
// body selected → body actions in the overflow list
await page.locator('#btree .node:has-text("Bodies") .tw[aria-expanded="false"]').first().click({ timeout: 2000 }).catch(() => {}); await W(200);
if (process.env.DBG) console.log(await page.textContent('#btree'));
await page.locator('#btree .node .nlab:text-is("Body 2")').first().click(); await W(300);
await page.mouse.click(300, 700, { button: 'right' }); await W(400);
check(/Hide Body/.test(await page.textContent('#wheel .wheel-more')) && /Create Drawing/.test(await page.textContent('#wheel .wheel-more')), 'with a body selected the list offers Hide Body and Create Drawing');
await page.keyboard.press('Escape'); await W(200);

// preferences: Y up, dark theme, new-design material
await page.click('#abPrefs'); await W(400);
await page.click('.prefs .seg[aria-label="Up direction"] button[data-v="Y"]');
await page.click('.prefs .seg[aria-label="Theme"] button[data-v="dark"]');
await page.selectOption('#pref-material', 'Steel 1018');
await page.click('#pref-ok'); await W(1200);
let c = await cam();
check(c.up[1] === 1 && Math.abs(c.grid + Math.PI / 2) < 1e-6 && c.dir[1] > 0.3, 'Y up: camera up is +Y, grid on XZ, iso view from above ' + JSON.stringify(c));
await page.evaluate(() => window.__dw.view('top')); await W(300); c = await cam();
check(c.dir[1] > 0.99, 'Top view looks down −Y');
check(c.theme === 'dark', 'dark theme applied');
await page.click('#abFile'); await W(150); await page.click('.menu .mi:has-text("New Design")'); await W(1200);
check((await page.evaluate(() => window.__dw.doc().material)) === 'Steel 1018', 'new designs use the preferred material');
await page.reload(); await page.waitForFunction(() => window.__dw?.camera, null, { timeout: 60000 }); await W(1500);
c = await cam();
check(c.up[1] === 1 && c.theme === 'dark', 'preferences survive a reload');
await page.click('#abPrefs'); await W(300); await page.click('.dialog .btn:has-text("Reset"), #modal .btn:has-text("Reset")'); await W(800);
c = await cam(); check(c.up[2] === 1 && c.theme === null, 'Reset restores Z up and the system theme');

// Create Drawing from a body's browser menu
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.click('#docTabs .dtab:has-text("UI") .dtmain'); await W(2000);
await page.locator('#btree .node:has-text("Bodies") .tw[aria-expanded="false"]').first().click().catch(() => {}); await W(200);
await page.locator('#btree .node .nlab:text-is("Body 2")').first().click({ button: 'right' }); await W(300);
await page.click('.menu .mi:has-text("Create Drawing")'); await W(400);
await page.selectOption('#cd-sheet', 'A4'); await page.click('#cd-ok'); await W(5000);
c = await cam();
check(c.ws === 'drawing' && JSON.stringify(c.drawingBodies) === '["b"]', 'Create Drawing opens a drawing of that body only ' + JSON.stringify(c.drawingBodies));
const dinfo = await page.evaluate(() => window.__dw.drawing());
check(dinfo && dinfo.sheets.length >= 1, 'drawing has a sheet');

// job status lists the work done
await page.click('#abJobs'); await W(300);
const jt = await page.textContent('.menu');
check(/Job status/.test(jt) && /Exact engine ready/.test(jt) && /✓ Rebuilding the model/.test(jt), 'job status shows the engine and finished jobs');
await page.keyboard.press('Escape');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
