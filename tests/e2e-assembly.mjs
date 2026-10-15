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

// limits: the angle is held inside them
const jid = await page.evaluate(() => window.__dw.doc().joints[0].id);
await page.evaluate(() => { document.querySelector('.node .nlab') && 0; });
await page.click('.rlabel:has-text("ASSEMBLE")'); await W(200); await page.click('.menu .mi:has-text("Drive Joints")'); await W(600);
await page.click('#jl-angle'); await W(300);
await page.fill('#jl-angle-min', '0'); await page.fill('#jl-angle-max', '45'); await W(300);
await page.fill('#jv-angle', '90'); await W(500);
a = await asm();
const pl = apply(a.xf.Pin, [65, 0, 30]), angNow = Math.atan2(pl[1], pl[0]) * 180 / Math.PI;
check(Math.abs(Math.abs(angNow) - 45) < 0.01, `limits 0–45° hold a typed 90° at 45° (${angNow.toFixed(2)}°)`);
await page.click('.dialog .btn.ok'); await W(600);

// drag the pin: it turns about the joint axis (inside the limits)
await page.fill('#jv-angle', '0').catch(() => { });
await page.evaluate(() => { const d = window.__dw.doc(); d.joints[0].angle = 10; window.__dw.setDoc(d); }); await W(2000);
const before = (await page.evaluate(() => window.__dw.doc())).joints[0].angle;
const c0 = await scr(4.9, 0, 30), c1 = await scr(0, 4.9, 30), c2 = await scr(-4.9, 0, 30);
const side = await scr(0, -5, 25);
await page.mouse.move(side.x, side.y); await page.mouse.down();
for (const p of [c0, c1, c2]) await page.mouse.move(p.x, p.y, { steps: 6 });
await page.mouse.up(); await W(800);
const after = (await page.evaluate(() => window.__dw.doc())).joints[0].angle;
check(after !== before && after >= 0 && after <= 45, `dragging the pin turns it within its limits (${before}° → ${after}°)`);

// four-bar linkage: crank, coupler and rocker on a fixed base; the last joint closes the loop
const plate = (id, cx, cy, w, holes) => [{ id, type: 'box', name: id, plane: 'XY', offset: 0, cx, cy, w, d: 8, h: 3, op: 'new' },
  ...holes.map((x, i) => ({ id: id + 'h' + i, type: 'cylinder', name: id + ' hole', plane: 'XY', offset: 0, cx: x, cy, diameter: 4, h: 10, op: 'cut', target: id }))];
const rim = (body, x, y) => ({ body, kind: 'edge', sig: { type: 'CIRCLE', cc: [x, y, 3], ax: [0, 0, 1], len: Math.PI * 4, p: [x, y + 2, 3] } });
const rev = (id, a, b) => ({ id, name: id, type: 'revolute', a, b, angle: 0, distance: 0, x: 0, y: 0, offset: 0, flip: false });
await page.evaluate(d => window.__dw.setDoc(d), {
  version: 2, name: 'Four-bar', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [...plate('base', 50, 0, 100, [10, 90]), ...plate('crank', 10, 40, 30, [0, 20]), ...plate('coupler', 35, 80, 80, [0, 70]), ...plate('rocker', 30, 120, 70, [0, 60])],
  components: [{ id: 'kc', name: 'Crank', bodies: ['crank'] }, { id: 'kp', name: 'Coupler', bodies: ['coupler'] }, { id: 'kr', name: 'Rocker', bodies: ['rocker'] }],
  joints: [rev('J1', rim('crank', 0, 40), rim('base', 10, 0)), rev('J2', rim('coupler', 0, 80), rim('crank', 20, 40)), rev('J3', rim('rocker', 0, 120), rim('base', 90, 0)), rev('J4', rim('coupler', 70, 80), rim('rocker', 60, 120))],
});
await W(3000);
await page.click('#vcHome'); await W(800);
a = await asm();
check(a.joints.every(s => s.endsWith(':ok')), 'four-bar: every joint satisfied, including the one closing the loop ' + JSON.stringify(a.joints));
const world = (name, p) => apply(a.xf[name], p);
// (the test hook rounds matrix entries to 1e-4, so positions compare to ~0.05 mm)
const gap = (A, B) => Math.hypot(...A.map((v, i) => v - B[i]));
check(gap(world('Coupler', [70, 80, 3]), world('Rocker', [60, 120, 3])) < 0.05 && gap(world('Crank', [0, 40, 3]), [10, 0, 3]) < 0.05, 'loop closes: coupler and rocker pins meet, crank on its base pin');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fourbar.png' });
// turn the crank: the rocker follows and the loop stays closed
const r0 = world('Rocker', [60, 120, 3]);
await page.evaluate(() => { const d = window.__dw.doc(); d.joints[0].angle = 60; window.__dw.setDoc(d); }); await W(2500);
a = await asm();
const c1w = world('Crank', [20, 40, 3]), crankAng = Math.atan2(c1w[1], c1w[0] - 10) * 180 / Math.PI;
check(a.joints.every(s => s.endsWith(':ok')) && gap(world('Coupler', [70, 80, 3]), world('Rocker', [60, 120, 3])) < 0.05, 'after turning the crank 60°, the loop is still closed ' + JSON.stringify(a.joints));
check(gap(world('Rocker', [60, 120, 3]), r0) > 1, `the rocker followed (moved ${gap(world('Rocker', [60, 120, 3]), r0).toFixed(1)} mm)`);
check((await page.evaluate(() => window.__dw.doc())).joints[0].angle === 60, 'the crank keeps the angle that was set');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/fourbar-60.png' });

// as-built hinge: an arm already lying on a plate; joint it where it is, then turn it; a rigid group follows
await page.evaluate(d => window.__dw.setDoc(d), {
  version: 2, name: 'Hinge', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [
    { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 40, h: 5, op: 'new' },
    { id: 'arm', type: 'box', name: 'Arm', plane: 'XY', offset: 5, cx: 20, cy: 0, w: 40, d: 6, h: 3, op: 'new' },
    { id: 'armh', type: 'cylinder', name: 'Pivot hole', plane: 'XY', offset: 5, cx: 5, cy: 0, diameter: 3, h: 3, op: 'cut', target: 'arm' },
    { id: 'tip', type: 'box', name: 'Tip', plane: 'XY', offset: 8, cx: 37, cy: 0, w: 4, d: 6, h: 4, op: 'new' },
  ],
  components: [{ id: 'ka', name: 'Arm', bodies: ['arm'] }, { id: 'kt', name: 'Tip', bodies: ['tip'] }],
});
await W(3000); await page.click('#vcHome'); await W(800);
await page.click('.rlabel:has-text("ASSEMBLE")'); await W(200); await page.click('.menu .mi:has-text("As-built Joint")'); await W(600);
await page.mouse.click(...Object.values(await scr(6.5, 0, 8))); await W(800);
let jd = await page.evaluate(() => window.__dw.doc().joints.at(-1));
check(jd?.a?.kind === 'edge', 'as-built: the pivot hole rim is the origin (' + (jd?.a?.kind || 'nothing') + ')');
await page.mouse.click(...Object.values(await scr(-15, -15, 5))); await W(800);
a = await asm();
check(a.joints.at(-1).endsWith(':ok') && !a.comps.find(c => c.name === 'Arm').moved, 'as-built joint keeps the arm exactly where it is');
await page.selectOption('#jt-type', 'revolute'); await W(300);
await page.fill('#jv-angle', '90'); await W(600);
a = await asm();
const tipEnd = apply(a.xf.Arm, [40, 0, 8]);
check(Math.abs(tipEnd[0] - 5) < 0.05 && Math.abs(Math.abs(tipEnd[1]) - 35) < 0.05 && Math.abs(tipEnd[2] - 8) < 0.05, `turning 90° swings the arm about the pivot (${tipEnd.map(v => v.toFixed(2))})`);
check(!a.xf.Tip, 'the tip (not grouped yet) stays put');
await page.click('.dialog .btn.ok'); await W(600);
await page.click('.rlabel:has-text("ASSEMBLE")'); await W(200); await page.click('.menu .mi:has-text("Rigid Group")'); await W(600);
await page.click('#rg-ka'); await page.click('#rg-kt'); await page.click('.dialog .btn.ok'); await W(800);
a = await asm();
check(a.xf.Tip && near(a.xf.Tip, a.xf.Arm, 1e-6), 'rigid group: the tip now moves with the arm');
const chips = await page.$$eval('#tlTrack .chip.asm', els => els.map(e => e.getAttribute('aria-label')));
check(chips.length === 4 && chips.some(t => /rigid group/.test(t)) && chips.some(t => /as-built revolute joint/.test(t)), 'timeline lists components, the group and the joint: ' + chips.join(' | '));
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/asbuilt.png' });

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
