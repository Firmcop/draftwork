// End-to-end, precision sketching (spec Phase 1 / B6): snap markers and exact snapped positions (midpoint, center,
// quadrant, intersection), inference (horizontal, vertical), automatic constraints on/off, Ctrl to place without
// snapping, conflict feedback naming the constraint in the way, typed sizes with live preview (3000 mm line at 30°,
// 6000 × 3000 rectangle, Ø500 circle, radius entry, 8-sided polygon), a dimension edit that keeps snapped
// relationships, zoom/pan that never changes geometry, and the state surviving a reload.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5232, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const docNow = () => page.evaluate(() => window.__dw.doc());
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const sks = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const sketchGeo = async () => (await docNow()).features.filter(f => f.type === 'sketch').at(-1)?.geo || { points: [], curves: [], cons: [] };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const ptAt = (g, x, y, tol = 1e-6) => g.points.find(p => near(p.x, x, tol) && near(p.y, y, tol));
const pos = (g, id) => id === 'O' ? { x: 0, y: 0 } : g.points.find(p => p.id === id);
const move = async (x, y) => { const p = await sks(x, y); await page.mouse.move(p.x, p.y, { steps: 3 }); await W(220); };
const click = async (x, y) => { const p = await sks(x, y); await page.mouse.move(p.x, p.y, { steps: 2 }); await W(120); await page.mouse.click(p.x, p.y); await W(350); };
const markerNow = () => page.evaluate(() => { const m = document.querySelector('.snapmk'); return m ? { snap: m.dataset.snap, infer: m.dataset.infer } : null; });
// the marker after the overlay has caught up with the cursor (waits up to 1.5 s for an expected type)
let expectNext = null;
const marker = async () => { if (expectNext) { const [k, v] = expectNext; expectNext = null; await page.waitForFunction(([k, v]) => document.querySelector('.snapmk')?.dataset[k] === v, [k, v], { timeout: 1500 }).catch(() => {}); } return markerNow(); };
const expect = (k, v) => { expectNext = [k, v]; };
const consOf = (g, pid) => g.cons.filter(k => (k.e || []).includes(pid)).map(k => k.type).sort();

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.click('#newTabBtn'); await W(300); await page.click('.studycard[data-type="part"]'); await W(1500);
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(600);
const xy = await scr(25, -25, 0); await page.mouse.move(xy.x, xy.y, { steps: 3 }); await W(300); await page.mouse.click(xy.x, xy.y); await W(1500);

// 1. base line from the origin, horizontal by inference
await page.keyboard.press('l'); await W(200);
await move(0.3, 0.2);
expect('snap', 'origin'); check((await marker())?.snap === 'origin', 'the origin shows a snap marker: ' + JSON.stringify(await marker()));
await click(0.3, 0.2); await move(40, 0.6);
expect('infer', 'horizontal'); check((await marker())?.infer === 'horizontal', 'drawing almost level shows the horizontal inference');
await click(40, 0.6); await page.keyboard.press('Escape'); await W(200);
let g = await sketchGeo();
const base = g.curves.find(c => c.kind === 'line');
check(base && base.a === 'O' && near(pos(g, base.b).y, 0) && g.cons.some(k => k.type === 'horizontal' && k.e[0] === base.id), 'base line starts on the origin, ends exactly level, and keeps a horizontal constraint');

// 2. midpoint snap → exact point with a midpoint constraint; vertical inference on the next segment
await page.keyboard.press('l'); await W(150);
await move(20.6, 0.4);
expect('snap', 'midpoint'); check((await marker())?.snap === 'midpoint', 'near the middle of the line the midpoint marker shows: ' + JSON.stringify(await marker()));
await click(20.6, 0.4); await move(20.5, 30);
expect('infer', 'vertical'); check((await marker())?.infer === 'vertical', 'drawing up from it shows the vertical inference');
await click(20.5, 30); await page.keyboard.press('Escape'); await W(200);
g = await sketchGeo();
let mp = ptAt(g, 20, 0);
check(!!mp && g.cons.some(k => k.type === 'midpoint' && k.e[0] === mp.id && k.e[1] === base.id), 'the snapped point is exactly (20, 0) and constrained to the midpoint');
check(!!ptAt(g, 20, 30) || !!g.points.find(p => near(p.x, 20) && p.y > 29), 'the second segment is exactly vertical (x = 20)');

// 3. circle Ø20 typed at (60, 0); centre and quadrant snaps
await page.keyboard.press('c'); await W(150);
await click(60, 0); await move(64, 1);
await page.keyboard.type('20'); await page.keyboard.press('Enter'); await W(700);
await page.keyboard.press('l'); await W(150);
await move(60.4, 0.4);
expect('snap', 'center'); check((await marker())?.snap === 'center', 'the circle centre shows the centre marker: ' + JSON.stringify(await marker()));
await click(60.4, 0.4); await move(60.3, 10.3);
expect('snap', 'quadrant'); check((await marker())?.snap === 'quadrant', 'the top of the circle shows the quadrant marker: ' + JSON.stringify(await marker()));
await click(60.3, 10.3); await page.keyboard.press('Escape'); await W(200);
g = await sketchGeo();
const q = ptAt(g, 60, 10);
check(!!q && JSON.stringify(consOf(g, q.id)) === JSON.stringify(['onCircle', 'vertical']), 'the quadrant point is exactly (60, 10), on the circle and plumb above the centre: ' + (q && consOf(g, q.id)));

// 4. intersection snap
await page.keyboard.press('l'); await W(150);
await click(30, -10); await click(30, 20); await page.keyboard.press('Escape'); await W(200);
await page.keyboard.press('l'); await W(150);
await move(30.4, 0.3);
expect('snap', 'intersection'); check((await marker())?.snap === 'intersection', 'where two lines cross, the intersection marker shows: ' + JSON.stringify(await marker()));
await click(30.4, 0.3); await page.keyboard.press('Escape'); await W(300);
g = await sketchGeo();
const ip = ptAt(g, 30, 0);
check(!!ip && consOf(g, ip.id).filter(t => t === 'onLine').length === 2, 'the intersection point is exactly (30, 0) and stays on both lines');

// 5. automatic constraints off; Ctrl places without snapping
await page.check('#so-autoCons'); await page.uncheck('#so-autoCons'); await W(150);
const nH = (await sketchGeo()).cons.filter(k => k.type === 'horizontal').length;
await page.keyboard.press('l'); await W(150);
await click(0, 40); await click(30, 40.4); await page.keyboard.press('Escape'); await W(250);
g = await sketchGeo();
check(g.cons.filter(k => k.type === 'horizontal').length === nH, 'with Auto constraints off, a level line gets no horizontal constraint');
await page.check('#so-autoCons'); await W(100);
await page.keyboard.press('l'); await W(150);
let p = await sks(20.37, 0.21); await page.keyboard.down('Control'); await page.mouse.move(p.x, p.y, { steps: 2 }); await W(150); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); await W(300);
await page.keyboard.press('Escape'); await W(200);
g = await sketchGeo();
check(g.points.some(pt => !near(pt.x, 20, 0.01) && near(pt.x, 20.37, 0.06)), 'Ctrl-click places a point where the cursor is, not on the snap');

// 6. conflict feedback: Parallel between the horizontal base line and the vertical line at x = 30
await page.keyboard.press('v'); await W(150);
await click(8, 0); await W(200);
p = await sks(30, 15); await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); await W(250);
await page.click('.rbtn[aria-label^="Parallel"]'); await W(600);
const tmsg = await page.textContent('#toast');
check(/conflict/i.test(tmsg) && /Horizontal/.test(tmsg), 'the conflict message names the constraint in the way: ' + tmsg);
await page.keyboard.press('Escape'); await W(200);

// 7. typed sizes at building scale, with live preview
await page.keyboard.press('l'); await W(150);
await click(0.2, -0.2); await move(15, 7);
await page.keyboard.type('3000'); await W(300);
const lab = await page.$$eval('.mlabel', els => els.map(e => e.textContent).join(' | '));
check(/3,?000/.test(lab), 'typing 3000 updates the preview length before Enter: ' + lab);
await page.keyboard.press('Tab'); await page.keyboard.type('30'); await page.keyboard.press('Enter'); await W(700);
await page.keyboard.press('Escape'); await W(200);
g = await sketchGeo();
const L3 = g.points.find(pt => near(pt.x, 3000 * Math.cos(Math.PI / 6), 1e-4) && near(pt.y, 1500, 1e-4));
check(!!L3, 'a 3000 mm line at 30° ends exactly at (2598.0762, 1500)');
const l3 = g.curves.find(c => c.b === L3?.id);
check(!!l3 && g.cons.some(k => k.type === 'length' && k.e[0] === l3.id && k.value === 3000) && g.cons.some(k => k.type === 'angle' && k.e.length === 1 && k.e[0] === l3.id && k.value === 30), 'its length 3000 and angle 30° are kept as dimensions');

await page.keyboard.press('r'); await W(150);
await click(-50, -50); await move(-40, -45);
await page.keyboard.type('6000'); await page.keyboard.press('Tab'); await page.keyboard.type('3000'); await page.keyboard.press('Enter'); await W(800);
g = await sketchGeo();
check(!!ptAt(g, -50, -50) && !!ptAt(g, 5950, 2950), 'a 6000 × 3000 rectangle anchored at its first corner (−50, −50) → (5950, 2950)');

await page.keyboard.press('c'); await W(150);
await click(-30, -25); await move(-26, -24);
await page.keyboard.type('500'); await page.keyboard.press('Enter'); await W(700);
await page.keyboard.press('c'); await W(150);
await click(-70, -25); await move(-66, -24);
await page.keyboard.type('100r'); await page.keyboard.press('Enter'); await W(700);
g = await sketchGeo();
check(g.cons.some(k => k.type === 'diameter' && k.value === 500), 'a circle with a 500 mm diameter');
check(g.cons.some(k => k.type === 'diameter' && k.value === 200), 'typing 100r gives a 100 mm radius (Ø200)');

await page.click('.rbtn[aria-label^="Circumscribed Polygon"]'); await W(200);
const nLines = (await sketchGeo()).curves.filter(c => c.kind === 'line').length;
await click(-30, -45); await move(-22, -43);
await page.keyboard.type('40'); await page.keyboard.press('Tab'); await page.keyboard.press('Control+a'); await page.keyboard.type('8');
await page.keyboard.press('Enter'); await W(800);
g = await sketchGeo();
check(g.curves.filter(c => c.kind === 'line').length - nLines === 8 && g.cons.some(k => k.type === 'diameter' && k.value === 40), 'polygon: typed 8 sides and Ø40');
await page.keyboard.press('Escape'); await W(150);

// arc: typed chord 30 at 0°, then radius 20
await page.keyboard.press('a'); await W(150);
await click(-40, -62); await move(-22, -62.5);
await page.keyboard.type('30'); await page.keyboard.press('Tab'); await page.keyboard.press('Control+a'); await page.keyboard.type('0'); await page.keyboard.press('Enter'); await W(400);
await move(-25, -70); await move(-25, -71);
await page.keyboard.type('20'); await page.keyboard.press('Enter'); await W(800);
g = await sketchGeo();
const arcC = g.curves.filter(c => c.kind === 'arc').at(-1);
const arcOk = arcC && g.cons.some(k => k.type === 'radius' && k.e[0] === arcC.id && k.value === 20) && g.cons.some(k => k.type === 'distance' && k.value === 30 && k.e.includes(arcC.a) && k.e.includes(arcC.b));
const ca = arcC && pos(g, arcC.a), cb = arcC && pos(g, arcC.b), cc = arcC && pos(g, arcC.c);
check(arcOk && near(Math.hypot(cb.x - ca.x, cb.y - ca.y), 30, 1e-4) && near(Math.hypot(ca.x - cc.x, ca.y - cc.y), 20, 1e-4) && near(ca.y, cb.y, 1e-4), 'arc from typed chord 30 at 0° and radius 20, kept as dimensions');
await page.keyboard.press('Escape'); await W(150);

// 8. a point snapped to the rectangle's top-edge midpoint stays there when the width dimension changes
await page.evaluate(() => window.__dw.view('fit')); await W(800);
await page.keyboard.press('l'); await W(150);
await move(2950 + 15, 2950 - 10);
expect('snap', 'midpoint'); check((await marker())?.snap === 'midpoint', 'zoomed out, the top edge still offers its midpoint: ' + JSON.stringify(await marker()));
await click(2950 + 15, 2950 - 10); await page.keyboard.press('Escape'); await W(150); await page.keyboard.press('Escape'); await W(300);
g = await sketchGeo();
const topMid = ptAt(g, 2950, 2950);
check(!!topMid, 'snapped exactly to (2950, 2950)');
await page.click('.dim:text-is("6000")'); await W(300);
await page.fill('.dimedit', '8000'); await page.keyboard.press('Enter'); await W(1200);
g = await sketchGeo();
const tm2 = g.points.find(pt => pt.id === topMid?.id);
// the rectangle has no fixed corner, so the solver widens it about its middle; the snapped point must follow the edge
const topEdge = g.curves.find(c => c.kind === 'line' && g.cons.some(k => k.type === 'midpoint' && k.e[0] === topMid?.id && k.e[1] === c.id));
const ea = topEdge && pos(g, topEdge.a), eb = topEdge && pos(g, topEdge.b);
check(!!topEdge && near(Math.abs(eb.x - ea.x), 8000, 1e-4) && near(tm2.x, (ea.x + eb.x) / 2, 1e-4) && near(tm2.y, ea.y, 1e-4) && near(ea.y, eb.y, 1e-6),
  `after widening to 8000 the snapped point is still exactly the top edge's midpoint (${tm2 && tm2.x.toFixed(4)}, edge ${ea && ea.x.toFixed(3)} … ${eb && eb.x.toFixed(3)})`);

// 9. zooming and panning never change model dimensions
const before = JSON.stringify((await sketchGeo()).points);
const c0 = await sks(1000, 1000);
for (let i = 0; i < 4; i++) { await page.mouse.move(c0.x, c0.y); await page.mouse.wheel(0, i % 2 ? 400 : -400); await W(150); }
await page.mouse.move(700, 450); await page.mouse.down({ button: 'middle' }); await page.mouse.move(820, 520, { steps: 6 }); await page.mouse.up({ button: 'middle' }); await W(300);
await page.setViewportSize({ width: 1200, height: 800 }); await W(400); await page.setViewportSize({ width: 1500, height: 900 }); await W(400);
check(JSON.stringify((await sketchGeo()).points) === before, 'zoom, pan and window resize leave every point where it was');

// 10. finish, reload: geometry and constraints come back editable
const consBefore = (await sketchGeo()).cons.length;
await page.click('.rbtn[aria-label^="Finish Sketch"]').catch(() => page.keyboard.press('Escape')); await W(1200);
await page.reload(); await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 }); await W(1500);
g = await sketchGeo();
check(g.cons.length === consBefore && g.cons.some(k => k.type === 'midpoint') && g.cons.some(k => k.type === 'angle' && k.value === 30), `after reload the sketch keeps its ${consBefore} constraints`);

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall precision sketching checks passed');
process.exit(failed ? 1 : 0);
