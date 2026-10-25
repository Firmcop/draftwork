// End-to-end, assembly placement (spec Phase 2): geometry-derived references under the cursor (vertex, circle
// centre from a hole's rim, face centre) with markers, Tab to cycle overlapping candidates, exact placement, joint
// suggestions (ball for two corners, revolute for two round edges), ball joint motion about the shared point,
// numeric offset, remaining degrees of freedom, grounded conflict, references following a model change, and the
// joints surviving a reload.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5233, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const asm = () => page.evaluate(() => window.__dw.assembly());
const docNow = () => page.evaluate(() => window.__dw.doc());
const apply = (m, p) => [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
const near = (a, b, t = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < t);
const fx = a => a.map(v => v.toFixed(3)).join(', ');
const hover = async (x, y, z) => { const p = await scr(x, y, z); await page.mouse.move(p.x - 6, p.y - 4); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(300); return p; };
const active = () => page.evaluate(() => { const m = document.querySelector('.refmk.active'); return m ? m.dataset.ref : null; });
const hint = () => page.textContent('#hint').catch(() => '');
const openComps = async () => { if (!(await page.$$eval('.node .nlab', els => els.some(e => e.textContent.startsWith('Block'))))) await page.click('.node:has-text("Components") .tw').catch(() => {}); await W(200); };
const label = async name => (await page.$$eval('.node .nlab', (els, n) => els.map(e => e.textContent).filter(t => t.startsWith(n)), name))[0] || '';

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
const DOC = {
  version: 2, name: 'Placement', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [
    { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 10, op: 'new' },
    { id: 'hole', type: 'cylinder', name: 'Hole', plane: 'XY', offset: 0, cx: -15, cy: -5, diameter: 10, h: 10, op: 'cut', target: 'plate' },
    { id: 'block', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 100, cy: 0, w: 20, d: 20, h: 10, op: 'new' },
    { id: 'shaft', type: 'cylinder', name: 'Shaft', plane: 'XY', offset: 0, cx: 100, cy: 60, diameter: 10, h: 30, op: 'new' },
  ],
  components: [{ id: 'kb', name: 'Block', bodies: ['block'] }, { id: 'ks', name: 'Shaft', bodies: ['shaft'] }],
};
await page.evaluate(d => window.__dw.setDoc(d), DOC);
await W(3000); await page.click('#vcHome'); await W(900);
await openComps();
check((await label('Shaft')).includes('free'), 'a component with no joint shows that it is free: ' + await label('Shaft'));

// 1. corner of the block: vertex marker, Tab cycles, Shift+Tab back
await page.keyboard.press('j'); await W(600);
await hover(109.6, 9.6, 10);
check(await active() === 'vertex', 'near a corner the vertex marker is the one a click picks: ' + await active());
check(/Vertex on .*\(Block\)/.test(await hint()), 'the hint names the reference and the body: ' + await hint());
const n = await page.$$eval('.refmk', els => els.length);
await page.keyboard.press('Tab'); await W(250);
const second = await active();
check(n > 1 && second && second !== 'vertex' && /2 of/.test(await hint()), `Tab moves to the next overlapping reference (${second}, ${n} offered): ` + await hint());
await page.keyboard.press('Shift+Tab'); await W(250);
check(await active() === 'vertex', 'Shift+Tab goes back to the vertex');
let p = await scr(109.6, 9.6, 10); await page.mouse.click(p.x, p.y); await W(700);
let d = await docNow(), j = d.joints.at(-1);
check(j?.a?.kind === 'ref' && j.a.ref.type === 'vertex' && near(j.a.ref.p, [110, 10, 10], 1e-9), 'the picked origin is exactly the corner (110, 10, 10), not the cursor position');

// 2. corner of the plate → ball suggested, corners coincide exactly
await hover(29.6, 19.6, 10);
check(await active() === 'vertex', 'the plate corner is offered as a vertex');
p = await scr(29.6, 19.6, 10); await page.mouse.click(p.x, p.y); await W(1200);
d = await docNow(); j = d.joints.at(-1);
check(j.type === 'ball' && /Suggested: Ball/.test(await page.textContent('#jt-suggest').catch(() => '')), 'two corners suggest a ball joint: ' + j.type);
let a = await asm();
check(a.joints.at(-1).endsWith(':ok') && near(apply(a.xf.Block, [110, 10, 10]), [30, 20, 10]), `the block corner lands exactly on the plate corner (${fx(apply(a.xf.Block, [110, 10, 10]))})`);
check(/turns in any direction/.test(await page.textContent('#jt-dof').catch(() => '')) && /3 degrees/.test(await page.textContent('#jt-dof')), 'the dialog says what the part can still do: ' + await page.textContent('#jt-dof').catch(() => ''));
// ball: pitch turns the block about the shared corner
const far0 = apply(a.xf.Block, [90, -10, 0]);
await page.fill('#jv-pitch', '30'); await W(600);
a = await asm();
// (the test hook rounds matrix entries to 1e-4, so rotated points carry a few µm of rounding)
check(near(apply(a.xf.Block, [110, 10, 10]), [30, 20, 10], 0.02) && !near(apply(a.xf.Block, [90, -10, 0]), far0, 0.5), 'pitch 30° turns the block about the corner, which stays put');
await page.fill('#jv-pitch', '0'); await W(300);

// 3. rigid with a numeric offset
await page.selectOption('#jt-type', 'rigid'); await W(500);
a = await asm();
check(near(apply(a.xf.Block, [110, 10, 10]), [30, 20, 10]) && Math.abs(apply(a.xf.Block, [110, 10, 0])[2] - 20) < 1e-3, 'rigid: corners together, the block standing on the plate face to face');
await page.fill('#jv-offset', '5'); await W(600);
a = await asm();
check(near(apply(a.xf.Block, [110, 10, 10]), [30, 20, 15]), 'offset 5 mm lifts it exactly 5 mm off the plate (' + fx(apply(a.xf.Block, [110, 10, 10])) + ')');
await page.click('.dialog .btn.ok'); await W(800);
await openComps();
check((await label('Block')).includes('fully constrained'), 'browser: the block is fully constrained: ' + await label('Block'));

// 4. shaft into the hole: centre picked from the hole's rim → revolute, axes coincide
await page.keyboard.press('j'); await W(600);
await hover(100.4, 60.3, 30);
check(await active() === 'center', 'the shaft end offers its circle centre: ' + await active());
p = await scr(100.4, 60.3, 30); await page.mouse.click(p.x, p.y); await W(700);
await hover(-15, 0.6, 10);
check(await active() === 'center', 'hovering just outside the hole rim offers the hole centre: ' + await active());
p = await scr(-15, 0.6, 10); await page.mouse.click(p.x, p.y); await W(1200);
d = await docNow(); j = d.joints.at(-1);
check(j.type === 'revolute' && near(j.b.ref.p, [-15, -5, 10], 1e-6), 'two round edges suggest revolute; the hole centre is exact: ' + j.type);
a = await asm();
check(near(apply(a.xf.Shaft, [100, 60, 30]), [-15, -5, 10]) && near(apply(a.xf.Shaft, [100, 60, 0]).slice(0, 2), [-15, -5]), 'the shaft axis lines up with the hole axis');
await page.fill('#jv-angle', '90'); await W(500);
a = await asm();
check(near(apply(a.xf.Shaft, [100, 60, 30]), [-15, -5, 10], 0.02) && !near(apply(a.xf.Shaft, [105, 60, 30]), [-10, -5, 10], 0.5), 'turning 90° keeps the axis and swings the rim around it');
await page.click('.dialog .btn.ok'); await W(800);
await openComps();
check((await label('Shaft')).includes('1 DOF'), 'browser: the shaft has 1 degree of freedom left: ' + await label('Shaft'));

// 5. grounding the block makes its joint impossible: both sides fixed
await page.click('.node:has-text("Block")', { button: 'right' }); await W(300);
await page.click('.menu .mi:has-text("Ground")'); await W(800);
a = await asm();
check(a.joints[0].endsWith(':error'), 'a joint between two fixed parts is flagged: ' + a.joints[0]);
await page.click('.node:has-text("Block")', { button: 'right' }); await W(300);
await page.click('.menu .mi:has-text("Unground")'); await W(800);
a = await asm();
check(a.joints[0].endsWith(':ok'), 'ungrounding fixes it');

// 6. the plate gets wider: the corner reference follows and the block goes with it
d = await docNow();
d.features.find(f => f.id === 'plate').w = 80;
await page.evaluate(x => window.__dw.setDoc(x), d); await W(3000);
a = await asm();
check(near(apply(a.xf.Block, [110, 10, 10]), [40, 20, 15]), 'after widening the plate to 80 the block sits on the new corner (' + fx(apply(a.xf.Block, [110, 10, 10])) + ')');

// 7. reload: joints and placements come back
const before = JSON.stringify((await asm()).xf);
await page.reload(); await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 }); await W(3500);
a = await asm(); d = await docNow();
check(d.joints.length === 2 && d.joints.every(x => x.a.kind === 'ref' && x.b.kind === 'ref') && JSON.stringify(a.xf) === before, 'after reload both joints, their references and the placements are unchanged');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall placement checks passed');
process.exit(failed ? 1 : 0);
