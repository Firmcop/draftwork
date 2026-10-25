// End-to-end: constrained sketching — line tool, Horizontal/Vertical, dimensions, full constraint, parametric edit.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5198, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
const sk = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const curve = i => page.evaluate(i => window.__dw.curveScreen(i), i);
const geo = () => page.evaluate(() => window.__dw.geo());
const info = () => page.textContent('#tlInfo');
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const clickAt = async p => { await page.mouse.click(p.x, p.y); await W(250); };

await page.goto(`http://localhost:${PORT}/${process.env.ENGINE_INLINE ? '?inline-engine' : ''}`);
await page.waitForFunction(() => /Exact engine|Mesh engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 90000 });
await page.click('#abFile'); await page.click('text=New design'); await W(1200);
await page.click('#bMin');                                   // keep the browser panel out of the way
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); await page.click('.node:has-text("Origin") .tw'); await page.click('.node .nlab:text-is("XY")'); await page.click('#bMin'); await W(1500);

// rough quadrilateral starting on the origin
await page.keyboard.press('l');
for (const [x, y] of [[0, 0], [38, 3], [41, 22], [-2, 14], [0, 0]]) await clickAt(await sk(x, y));   // corners chosen so no two sides are near parallel (inference would join them)
let g = await geo();
check(g && g.loops === 1, 'line tool closes a loop into one profile');
check(g.dof === 6, `rough shape has 6 degrees of freedom (got ${g.dof})`);

// square it up: select each line, Horizontal/Vertical
await page.keyboard.press('v');
for (let i = 0; i < 4; i++) { await clickAt(await curve(i)); await page.keyboard.press('h'); await W(300); }
g = await geo();
check(g.dof === 2, `H/V on all sides leaves width and height (dof ${g.dof})`);

// dimensions
await clickAt(await curve(0)); await page.keyboard.press('d'); await W(400);
await page.fill('.dimedit', '50'); await page.keyboard.press('Enter'); await W(500);
await clickAt(await curve(1)); await page.keyboard.press('d'); await W(400);
await page.fill('.dimedit', '30'); await page.keyboard.press('Enter'); await W(600);
g = await geo();
check(g.dof === 0 && g.ok, 'two dimensions fully constrain it');
check((await page.textContent('.palette .cstat')).includes('Fully constrained'), 'palette says Fully constrained');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/constrained.png' });

// a conflicting dimension is refused
await clickAt(await curve(2)); await page.keyboard.press('d'); await W(500);
check((await geo()).ok && (await page.evaluate(() => window.__dw.doc().features[0].geo.cons.filter(k => k.type === 'length').length)) === 2, 'redundant dimension on the opposite side is refused');
await page.keyboard.press('Escape');

await page.click('.palette .btn.go'); await W(800);
await page.keyboard.press('e'); await W(1200);
await page.fill('#dx-distance', '10'); await W(1200);
await page.click('.dialog .btn.ok'); await W(1000);
check((await info()).includes('15.00'), 'extrudes to 50 × 30 × 10 = 15.00 cm³');

// edit the width dimension from the sketch palette
await page.locator('.chip').first().dblclick(); await W(1200);
await page.fill('#gd-' + (await page.evaluate(() => window.__dw.doc().features[0].geo.cons.find(k => k.type === 'length').id)), '60'); await W(1500);
await page.click('.palette .btn.go'); await W(1500);

check((await info()).includes('18.00'), 'changing the dimension to 60 rebuilds the solid (18.00 cm³)');

// sketch fillet + offset on the 60 × 30 rectangle
await page.locator('.chip').first().dblclick(); await W(1200);
await page.click('.rbtn[aria-label^="Sketch Fillet"]'); await W(200);
await clickAt(await sk(60, 30)); await W(300);
await page.fill('.dimedit', '8'); await page.keyboard.press('Enter'); await W(800);
g = await geo();
check(g.ok && g.dof === 0 && g.loops === 1, `fillet keeps the sketch fully constrained and closed (dof ${g.dof}, loops ${g.loops})`);
await page.keyboard.press('v'); await clickAt(await curve(0)); await W(200);
await page.keyboard.press('o'); await W(300);
await page.fill('.dimedit', '-5'); await page.keyboard.press('Enter'); await W(1000);
g = await geo();
check(g.ok && g.loops === 2, `offset adds a second closed loop inside (loops ${g.loops})`);
await page.click('.palette .btn.go'); await W(2000);
// fillet removes (1 − π/4)·8² mm² from the corner; the inner offset loop becomes a hole through the 10 mm extrusion
const expect = (1800 - (64 - 16 * Math.PI) - (50 * 20 - (9 - 9 * Math.PI / 4))) * 10 / 1000;
check((await info()).includes(expect.toFixed(2)), `extrusion becomes a frame with a rounded corner (${expect.toFixed(2)} cm³; got ${(await info()).match(/[\d.]+ cm³/)?.[0]})`);

// pipe along an L-shaped path on the front plane
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); await page.click('.node .nlab:text-is("XZ")'); await page.click('#bMin'); await W(1500);
await page.keyboard.press('l');
for (const [x, y] of [[-40, 0], [-40, 40], [-10, 40]]) await clickAt(await sk(x, y));
await page.keyboard.press('Escape'); await W(200);
await page.click('.palette .btn.go'); await W(800);
await page.click('.rlabel:has-text("CREATE")'); await W(200); await page.click('.menu .mi:has-text("Pipe")'); await W(1500);
await page.selectOption('#ds-op', 'new'); await W(1500);
await page.click('.dialog .btn.ok'); await W(1200);
const st = await page.evaluate(() => window.__dw.state());
const pipeVol = Math.PI * (16 - 9) * 70;
check(st.features.at(-1) === 'sweep:ok' && st.bodies.some(b => Math.abs(parseFloat(b.split('=')[1].replace(/,/g, '')) - pipeVol) < 2), `pipe along the path (${pipeVol.toFixed(0)} mm³): ${st.bodies.join(' ')}`);
if (process.env.SHOTS) { await page.click('#vcHome'); await W(800); await page.screenshot({ path: process.env.SHOTS + '/pipe.png' }); }

// slot tool: tangent arcs make an extrudable profile
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); await page.click('.node .nlab:text-is("XY")'); await page.click('#bMin'); await W(1500);
await page.click('.rbtn[aria-label^="Center to Center Slot"]'); await W(200);
const a = await sk(-30, 40), b = await sk(10, 40);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await W(600);
g = await geo();
check(g.loops === 1 && g.ok && g.dof === 5, `slot tool makes one closed profile with 5 degrees of freedom (got ${g.dof})`);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/slot.png' });

// regions from crossing circles: pick the overlap in the Extrude dialog, then trim
await page.click('#abFile'); await page.click('text=New design'); await W(1200);
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw');
await page.click('.node .nlab:text-is("XY")'); await page.click('#bMin'); await W(1500);
await page.keyboard.press('c');
for (const [cx, rx] of [[0, 20], [24, 44]]) { const p0 = await sk(cx, 0), p1 = await sk(rx, 0); await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up(); await W(500); }
g = await geo();
check(g.regions === 3 && g.filled === 2, `two crossing circles make 3 regions, 2 filled by default (got ${g.regions}/${g.filled})`);
await page.click('.palette .btn.go'); await W(800);
await page.keyboard.press('e'); await W(1200);
await page.fill('#dx-distance', '10'); await W(1500);
const lens = 800 * Math.acos(0.6) - 384, cres = 400 * Math.PI - (800 * Math.acos(0.6) - 384);
const vol = () => page.evaluate(() => window.__dw.state().bodies.map(b => parseFloat(b.split('=')[1].replace(/,/g, ''))));
let v = await vol();
check(Math.abs(v[0] - 2 * cres * 10) < 20, `default extrudes the two crescents (${(2 * cres * 10).toFixed(0)} mm³, got ${v[0]})`);
const mid = await page.evaluate(() => window.__dw.screen(12, 0, 0));
await clickAt(mid); await W(1500);
v = await vol();
check(Math.abs(v[0] - lens * 10) < 20, `clicking the overlap extrudes only the lens (${(lens * 10).toFixed(0)} mm³, got ${v[0]})`);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/regions.png' });
await page.click('.dialog .btn.ok'); await W(1000);
await page.locator('.chip').first().dblclick(); await W(1200);
await page.keyboard.press('t'); await W(200);
await clickAt(await sk(4, 0)); await W(800);
g = await geo();
check(g.ok && g.regions === 2, `trim removes the arc inside the first circle (regions ${g.regions})`);
await page.click('.palette .btn.go'); await W(2000);
v = await vol();
check(Math.abs(v[0] - 4000 * Math.PI) < 25, `the picked point now lies in the whole first circle, which is extruded (${(4000 * Math.PI).toFixed(0)} mm³, got ${v[0]})`);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/trim.png' });

// fit-point spline closing a line, extend a stray line onto it, extrude, then press pull the top face
await page.click('#abFile'); await page.click('text=New design'); await W(1200);
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw');
await page.click('.node .nlab:text-is("XY")'); await page.click('#bMin'); await W(1500);
await page.keyboard.press('l');
for (const [x, y] of [[0, 0], [40, 0]]) await clickAt(await sk(x, y));
await page.keyboard.press('Escape'); await W(200);
await page.click('.rlabel:has-text("CREATE")'); await W(200); await page.click('.menu .mi:has-text("Fit Point Spline")'); await W(300);
for (const [x, y] of [[40, 0], [33, 18], [12, 24], [0, 0]]) await clickAt(await sk(x, y));
await page.keyboard.press('Enter'); await W(500);
g = await geo();
check(g.ok && g.loops === 1 && g.regions === 1 && g.filled === 1, `line + spline make one closed area (loops ${g.loops}, regions ${g.regions})`);
// trim the spline back to a crossing line, then undo
await page.keyboard.press('l');
for (const [x, y] of [[25, 40], [25, 5]]) await clickAt(await sk(x, y));
await page.keyboard.press('Escape'); await W(200);
const before = await page.evaluate(() => window.__dw.doc().features[0].geo.curves.length);
await page.keyboard.press('t'); await W(200);
await clickAt(await sk(12, 24)); await W(800);
const trimmed = await page.evaluate(() => { const g = window.__dw.doc().features[0].geo, sp = g.curves.find(c => c.kind === 'spline'); return sp && { a: sp.a, b: sp.b, first: sp.pts[0], last: sp.pts.at(-1), on: g.cons.filter(k => k.type === 'onSpline').length }; });
g = await geo();
check(g.ok && trimmed && trimmed.b !== trimmed.last && trimmed.a === trimmed.first && trimmed.on >= 1, `trim cuts the spline back to the crossing line (${JSON.stringify(trimmed)})`);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/spline-trim.png' });
await page.keyboard.press('Control+z'); await W(500); await page.keyboard.press('Control+z'); await W(800);
check((await page.evaluate(() => window.__dw.doc().features[0].geo.curves.length)) === before - 1 && (await geo()).loops === 1, 'undo restores the spline and removes the line');
await page.keyboard.press('v'); await W(200);
await page.keyboard.press('l');
for (const [x, y] of [[50, 10], [62, 10]]) await clickAt(await sk(x, y));
await page.keyboard.press('Escape'); await W(200);
await page.click('.rlabel:has-text("MODIFY")'); await W(200); await page.click('.menu .mi:has-text("Extend")'); await W(300);
await clickAt(await sk(51, 10)); await W(600);
const ext = await page.evaluate(() => { const g = window.__dw.doc().features[0].geo, l = g.curves.at(-1), pa = g.points.find(p => p.id === l.a), pb = g.points.find(p => p.id === l.b); return Math.min(pa.x, pb.x); });
check(ext > 30 && ext < 45 && (await geo()).ok, `extend runs the line back to the spline (end at x = ${ext.toFixed(2)})`);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/spline.png' });
await page.click('.palette .btn.go'); await W(800);
await page.keyboard.press('e'); await W(1200);
await page.fill('#dx-distance', '10'); await W(1500);
await page.click('.dialog .btn.ok'); await W(1000);
const v1 = (await vol())[0];
check(v1 > 4000 && v1 < 9000, `spline profile extrudes (${v1} mm³)`);
await page.keyboard.press('q'); await W(800);
const topPt = await page.evaluate(() => window.__dw.screen(18, 8, 10));
await clickAt(topPt); await W(1500);
await page.fill('#dx-ppdist', '5'); await W(2000);
await page.click('.dialog .btn.ok'); await W(1000);
const v2 = (await vol())[0];
check(Math.abs(v2 / v1 - 1.5) < 1e-3, `press pull lifts the top face 5 mm (${v1} → ${v2} mm³)`);
if (process.env.SHOTS) { await page.click('#vcHome'); await W(800); await page.screenshot({ path: process.env.SHOTS + '/presspull.png' }); }

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
