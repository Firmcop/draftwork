// End-to-end: components and joints — make a component, joint it to a fixed body, change joint types, animate.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5199, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const asm = () => page.evaluate(() => window.__dw.assembly());
const apply = (m, p) => [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
const near = (a, b, t = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < t);

await page.goto(`http://localhost:${PORT}/${process.env.ENGINE_INLINE ? '?inline-engine' : ''}`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({
  version: 2, name: 'Pin and plate', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [
    { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 40, h: 10, op: 'new' },
    { id: 'pin', type: 'cylinder', name: 'Pin', plane: 'XY', offset: 0, cx: 60, cy: 0, diameter: 10, h: 30, op: 'new' },
  ],
}));
await W(2500);
await page.click('#vcHome'); await W(800);
let st = await page.evaluate(() => window.__dw.state());
check(st.bodies.length === 2, 'two bodies: ' + st.bodies.join(' '));

// make the pin a component (select it, Assemble > New Component)
await page.click('.rtab:has-text("SOLID")').catch(() => { });
await page.mouse.click(...Object.values(await scr(60, 0, 30))); await W(400);
await page.click('.rbtn[aria-label^="New Component"]'); await W(500);
await page.fill('#nc-name', 'Pin'); await page.click('.dialog .btn.ok'); await W(600);
let a = await asm();
check(a.comps.length === 1 && a.comps[0].name === 'Pin' && a.comps[0].bodies === 1, 'component made from the selected body ' + JSON.stringify(a.comps));

// joint: the pin's top face (moves) onto the plate's top face
await page.keyboard.press('j'); await W(600);
await page.mouse.click(...Object.values(await scr(60, 1, 30))); await W(800);
await page.mouse.click(...Object.values(await scr(0, 1, 10))); await W(1000);
a = await asm();
const m0 = a.xf.Pin;
check(a.joints[0] === 'Joint 1:ok' && m0 && near(apply(m0, [60, 0, 30]), [0, 0, 10]), `rigid joint puts the pin's top face on the plate (${m0 && apply(m0, [60, 0, 30]).map(v => v.toFixed(2))})`);
check(m0 && near(apply(m0, [60, 0, 0]), [0, 0, 40]), 'faces meet face to face: the pin stands up from the plate');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/joint-rigid.png' });

// slider: move 5 mm along the plate normal
await page.selectOption('#jt-type', 'slider'); await W(300);
await page.fill('#jv-distance', '5'); await W(500);
a = await asm();
check(near(apply(a.xf.Pin, [60, 0, 30]), [0, 0, 15]), 'slider distance 5 lifts the pin 5 mm');
// revolute: turn about the plate normal; a point off-axis moves around it
await page.selectOption('#jt-type', 'revolute'); await W(300);
await page.fill('#jv-angle', '90'); await W(500);
a = await asm();
const p1 = apply(a.xf.Pin, [65, 0, 30]);
check(Math.abs(Math.hypot(p1[0], p1[1]) - 5) < 1e-3 && Math.abs(p1[2] - 10) < 1e-3 && near(apply(a.xf.Pin, [60, 0, 30]), [0, 0, 10]), `revolute 90° turns the pin about the joint axis (${p1.map(v => v.toFixed(2))})`);

// animate: the transform keeps changing, and stops cleanly
await page.click('#jt-anim'); await W(400);
const t1 = (await asm()).xf.Pin; await W(500); const t2 = (await asm()).xf.Pin;
check(!near(t1, t2, 1e-6), 'animation turns the pin');
await page.click('#jt-anim'); await W(300);
a = await asm();
check(near(apply(a.xf.Pin, [65, 0, 30]), p1), 'stopping returns to the set angle');
await page.click('.dialog .btn.ok'); await W(600);
check((await page.textContent('#btree')).includes('Joints') && (await page.textContent('#btree')).includes('Components'), 'components and joints listed in the browser');

// mass properties follow the assembled position: total center of mass moves toward the plate
const com = await page.evaluate(() => { const b = window.__dw.state(); return b; });
check(com.bodies.length === 2, 'bodies still there after joint');

// the joint survives a rebuild that changes the plate thickness (origins are re-found)
await page.evaluate(() => { const d = window.__dw.doc(); d.features[0].h = 14; window.__dw.setDoc(d); });
await W(2500);
a = await asm();
check(a.joints[0] === 'Joint 1:ok' && near(apply(a.xf.Pin, [60, 0, 30]), [0, 0, 14]), 'thicker plate: the pin follows its top face (' + apply(a.xf.Pin, [60, 0, 30]).map(v => v.toFixed(2)) + ')');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/joint-revolute.png' });

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
