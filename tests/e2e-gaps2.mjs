// End-to-end, closing the spec's open items: sketch inference for collinear, equal length / radius and symmetry;
// joint origins on an edge intersection (the sharp corner under a chamfer) and on an origin plane; aligning a second
// hole of a hole pattern; component sheets linked from the assembly drawing's parts list.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5237, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const engine = () => page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 90000 });
const docNow = () => page.evaluate(() => window.__dw.doc());
const sks = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const sketchGeo = async () => (await docNow()).features.filter(f => f.type === 'sketch').at(-1)?.geo || { points: [], curves: [], cons: [] };
const move = async (x, y) => { const p = await sks(x, y); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(220); };
const click = async (x, y) => { const p = await sks(x, y); await page.mouse.move(p.x, p.y, { steps: 2 }); await W(120); await page.mouse.click(p.x, p.y); await W(350); };
const marker = () => page.evaluate(() => { const m = document.querySelector('.snapmk'); return m ? { snap: m.dataset.snap, infer: m.dataset.infer, glyph: m.textContent } : null; });
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const pos = (g, id) => id === 'O' ? { x: 0, y: 0 } : g.points.find(p => p.id === id);
const asm = () => page.evaluate(() => window.__dw.assembly());
const apply = (m, p) => [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
const nearV = (a, b, t = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < t);
const base = { version: 2, units: 'mm', params: [], bodyMeta: {}, sketchShown: {}, planeHidden: {} };

await page.goto(`http://localhost:${PORT}/`);
await engine();
await page.click('#newTabBtn'); await W(300); await page.click('.studycard[data-type="part"]'); await W(1500);
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(600);
const xy = await scr(25, -25, 0); await page.mouse.move(xy.x, xy.y, { steps: 3 }); await W(300); await page.mouse.click(xy.x, xy.y); await W(1500);

// 1. collinear: a slanted line, then a line starting on its extension and running along it
await page.keyboard.press('l'); await W(150);
await click(10, 0); await click(30, 10); await page.keyboard.press('Escape'); await W(200);
await page.keyboard.press('l'); await W(150);
await click(40, 15); await move(56, 23.2);
check((await marker())?.infer === 'collinear', 'continuing a line along its extension shows the collinear inference: ' + JSON.stringify(await marker()));
await click(56, 23.2); await page.keyboard.press('Escape'); await W(250);
let g = await sketchGeo();
const L1 = g.curves.find(c => c.kind === 'line' && near(pos(g, c.a).x, 10, 1e-4) && near(pos(g, c.a).y, 0, 1e-4)), L2 = g.curves.filter(c => c.kind === 'line').at(-1);
check(g.cons.some(k => k.type === 'collinear' && k.e.includes(L1.id) && k.e.includes(L2.id)), 'a collinear constraint ties the two lines');

// 2. equal length: a level line about as long as the slanted one snaps to exactly its length
const Ls = Math.hypot(20, 10);
await page.keyboard.press('l'); await W(150);
await click(10, -30); await move(10 + Ls - 0.15, -30.2);
const mk = await marker();
check(/=/.test(mk?.glyph || '') , 'about the same length shows “=”: ' + JSON.stringify(mk));
await click(10 + Ls - 0.15, -30.2); await page.keyboard.press('Escape'); await W(250);
g = await sketchGeo();
const L3 = g.curves.filter(c => c.kind === 'line').at(-1), a3 = pos(g, L3.a), b3 = pos(g, L3.b);
check(near(Math.hypot(b3.x - a3.x, b3.y - a3.y), Ls, 1e-6) && g.cons.some(k => k.type === 'equal' && k.e.includes(L3.id) && k.e.includes(L1.id)) && g.cons.some(k => k.type === 'horizontal' && k.e[0] === L3.id), `the new line is exactly ${Ls.toFixed(4)} long, level, with an equal constraint`);

// 3. equal radius
await page.keyboard.press('c'); await W(150);
await click(0, -60); await move(4, -59); await page.keyboard.type('20'); await page.keyboard.press('Enter'); await W(600);
await page.keyboard.press('c'); await W(150);
await click(40, -60); await move(49.85, -60.2);
await click(49.85, -60.2); await W(500);
g = await sketchGeo();
const circles = g.curves.filter(c => c.kind === 'circle');
check(circles.length === 2 && g.cons.some(k => k.type === 'equal' && k.e.includes(circles[0].id) && k.e.includes(circles[1].id)) && near(circles[1].r, 10, 1e-6), 'a circle about as big as another snaps to radius 10 and stays equal');

// 4. symmetry across a construction line
await page.keyboard.press('l'); await W(150);
await click(-30, -40); await click(-30, 40); await page.keyboard.press('Escape'); await W(200);
await page.keyboard.press('v'); await W(150); await click(-30, 5);
await page.keyboard.press('x'); await W(400);
await page.keyboard.press('Escape'); await W(150);
await page.keyboard.press('l'); await W(150);
await click(-15, 10); await click(-10, 25); await page.keyboard.press('Escape'); await W(250);
await page.keyboard.press('l'); await W(150);
await move(-45.3, 10.2);
check((await marker())?.snap === 'symmetric', 'the mirror image of a point across the construction line is offered: ' + JSON.stringify(await marker()));
await click(-45.3, 10.2); await page.keyboard.press('Escape'); await W(250);
g = await sketchGeo();
const sp = g.points.find(p => near(p.x, -45, 1e-6) && near(p.y, 10, 1e-6));
check(!!sp && g.cons.some(k => k.type === 'symmetry' && k.e[0] === sp.id), 'the point is exactly at (−45, 10) with a symmetry constraint');
await page.click('.rbtn[aria-label^="Finish Sketch"]').catch(() => page.keyboard.press('Escape')); await W(800);

// 5. joint origin on the sharp corner under a chamfer, onto the XY origin plane
await page.evaluate(d => window.__dw.setDoc(d), { ...base, name: 'Corner', showOrigin: true, features: [
  { id: 'block', type: 'box', name: 'Block', plane: 'XY', offset: 30, cx: 0, cy: 0, w: 60, d: 40, h: 10, op: 'new' },
  { id: 'ch', type: 'chamfer', name: 'Chamfer', edges: [{ p: [30, 20, 35], type: 'LINE', a: [30, 20, 30], b: [30, 20, 40], len: 10 }], distance: 2 }],
  components: [{ id: 'kb', name: 'Block', bodies: ['block'] }] });
await W(3000); await page.click('#vcHome'); await W(800);
await page.keyboard.press('j'); await W(600);
let p = await scr(28.8, 18.8, 40); await page.mouse.move(p.x - 5, p.y + 3); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(300);
let refs = await page.evaluate(() => window.__dw.refs());
let tabs = 0; while (refs && refs.list[refs.idx]?.type !== 'intersection' && tabs < 8) { await page.keyboard.press('Tab'); await W(150); refs = await page.evaluate(() => window.__dw.refs()); tabs++; }
check(refs?.list[refs.idx]?.type === 'intersection' && /Edge intersection/.test(await page.textContent('#hint')), 'the sharp corner under the chamfer is offered as an edge intersection (Tab ×' + tabs + ')');
await page.mouse.click(p.x, p.y); await W(600);
let d = await docNow(), j = d.joints.at(-1);
check(j?.a?.kind === 'ref' && j.a.ref.type === 'intersection' && nearV(j.a.ref.p, [30, 20, 40], 1e-6), 'the origin is exactly the virtual corner (30, 20, 40)');
p = null; for (const [x, y] of [[38, -2], [35, -5], [38, -6], [30, -3], [36, -12], [20, -2], [12, -3]]) { const q = await scr(x, y, 0); const free = await page.evaluate(([a, b]) => document.elementFromPoint(a, b)?.tagName === 'CANVAS', [q.x, q.y]); if (free) { p = q; break; } }   // a visible spot inside the XY plane's square
await page.mouse.move(p.x + 5, p.y); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(300);
refs = await page.evaluate(() => window.__dw.refs());
check(refs?.list[refs.idx]?.type === 'cplane', 'over the XY origin plane a plane origin is offered: ' + JSON.stringify(refs?.list.map(c => c.type)));
await page.mouse.click(p.x, p.y); await W(1200);
d = await docNow(); j = d.joints.at(-1);
let a = await asm();
const lp = j.b?.cons?.local || [0, 0];
check(j.b?.kind === 'cons' && j.b.cons.type === 'cplane' && a.joints.at(-1).endsWith(':ok') && nearV(apply(a.xf.Block, [30, 20, 40]), [lp[0], lp[1], 0], 1e-3), 'the block’s sharp corner lands on the XY plane where it was picked (' + apply(a.xf.Block, [30, 20, 40]).map(v => v.toFixed(3)) + ')');
await page.click('.dialog .btn.ok'); await W(500);

// 6. hole pattern: revolute on one pair of holes, then align a second pair
await page.evaluate(d => window.__dw.setDoc(d), { ...base, name: 'Holes', showOrigin: false, features: [
  { id: 'base', type: 'box', name: 'Base', plane: 'XY', offset: 0, cx: 20, cy: 0, w: 80, d: 30, h: 6, op: 'new' },
  { id: 'h1', type: 'cylinder', name: 'H1', plane: 'XY', offset: 0, cx: 0, cy: 0, diameter: 6, h: 6, op: 'cut', target: 'base' },
  { id: 'h2', type: 'cylinder', name: 'H2', plane: 'XY', offset: 0, cx: 40, cy: 0, diameter: 6, h: 6, op: 'cut', target: 'base' },
  { id: 'arm', type: 'box', name: 'Arm', plane: 'XY', offset: 0, cx: 120, cy: 20, w: 30, d: 80, h: 6, op: 'new' },
  { id: 'h3', type: 'cylinder', name: 'H3', plane: 'XY', offset: 0, cx: 120, cy: 0, diameter: 6, h: 6, op: 'cut', target: 'arm' },
  { id: 'h4', type: 'cylinder', name: 'H4', plane: 'XY', offset: 0, cx: 120, cy: 40, diameter: 6, h: 6, op: 'cut', target: 'arm' }],
  components: [{ id: 'ka', name: 'Arm', bodies: ['arm'] }] });
await W(3000); await page.click('#vcHome'); await W(800);
const pick = async (x, y, z) => { const q = await scr(x, y, z); await page.mouse.move(q.x - 5, q.y + 2); await page.mouse.move(q.x, q.y, { steps: 3 }); await W(300); await page.mouse.click(q.x, q.y); await W(700); };
await page.keyboard.press('j'); await W(600);
await pick(120, 3.6, 6); await pick(0, 3.6, 6);
d = await docNow(); j = d.joints.at(-1);
check(j.type === 'revolute' && j.a.ref.type === 'center' && j.b.ref.type === 'center', 'hole to hole suggests revolute');
await page.click('#jt-align'); await W(300);
const xf0 = (await asm()).xf.Arm, rim = apply(xf0, [120, 43.6, 0]);   // the arm now lies upside down on the first hole: its model z = 0 face is on top
await pick(...rim);
await pick(40, 3.6, 6); await W(500);
a = await asm(); d = await docNow(); j = d.joints.at(-1);
check(nearV(apply(a.xf.Arm, [120, 40, 6]), [40, 0, 6], 0.02), `after aligning, the second hole sits on the other (${apply(a.xf.Arm, [120, 40, 6]).map(v => v.toFixed(3))}) at ${(+j.angle).toFixed(3)}°`);
await page.click('.dialog .btn.ok'); await W(500);

// 7. component sheets linked from the parts list
await page.evaluate(() => window.__dw.run('createdrawing')); await W(400);
if (await page.isVisible('#cd-replace')) await page.check('#cd-replace');
await page.click('#cd-ok'); await W(2000); await idle(); await W(600);
await page.evaluate(() => window.__dw.run('dw.compsheets')); await W(2500); await idle(); await W(600);
let D = await page.evaluate(() => window.__dw.drawing());
check(D.sheets.length === 2 && D.texts.includes('DWG') && D.texts.includes('SH 2'), 'a sheet for the Arm component, listed as SH 2 in the parts list: ' + JSON.stringify(D.sheets));
const dwg = await page.$('[data-tag="pl:SH 2"]'); const bb = await dwg.boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await W(1200);
let I = await page.evaluate(() => window.__dw.dwInfo());
check(I.tb.some(t => t.startsWith('tb:title=Arm')) && I.title.partNo === 'Arm' && Math.abs(I.views.top.w - 30) < 0.01 && Math.abs(I.views.top.h - 80) < 0.01, 'clicking SH 2 opens the Arm sheet: the arm alone, 30 × 80 in the top view');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall gap checks passed');
process.exit(failed ? 1 : 0);
