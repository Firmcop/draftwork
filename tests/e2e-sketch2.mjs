// End-to-end: sketch Point, Mirror, Circular Pattern, Text and Project.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5203, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
const sk = (x, y) => page.evaluate(([x, y]) => window.__dw.sketchScreen(x, y), [x, y]);
const docNow = () => page.evaluate(() => window.__dw.doc());
const state = () => page.evaluate(() => window.__dw.state());
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const clickAt = async p => { await page.mouse.move(p.x, p.y); await W(60); await page.mouse.click(p.x, p.y); await W(300); };
const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up(); await W(400); };
const skMenu = async label => { await page.click('.rtab:text-is("SKETCH")'); await W(150); await page.click('.rlabel:has-text("CREATE")'); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(300); };
const geoOf = async () => (await docNow()).features.find(f => f.type === 'sketch').geo;

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.click('#abFile'); await page.click('text=New design'); await W(1200);
await page.click('#bMin');
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); await page.click('.node:has-text("Origin") .tw'); await page.click('.node .nlab:text-is("XY")'); await page.click('#bMin'); await W(1500);

// mirror line along Y, a circle to the right of it
await page.keyboard.press('l'); await clickAt(await sk(0, -30)); await clickAt(await sk(0, 30)); await page.keyboard.press('Escape'); await W(200);
await page.keyboard.press('c'); await drag(await sk(20, 0), await sk(25, 0));
let g = await geoOf();
const circ = g.curves.find(c => c.kind === 'circle');
check(!!circ, 'circle drawn');
// the new circle stays selected after drawing; mirror it about the line
await skMenu('Sketch Mirror'); await clickAt(await sk(0, 15));
g = await geoOf();
const circs = g.curves.filter(c => c.kind === 'circle');
const centres = circs.map(c => g.points.find(p => p.id === c.c));
check(circs.length === 2 && centres.some(p => Math.abs(p.x + 20) < 1e-3 && Math.abs(p.y) < 1e-3) && g.cons.some(k => k.type === 'symmetry'), 'mirror: a second circle at x = -20, tied by symmetry ' + JSON.stringify(centres));

// circular pattern of the mirrored circle around the origin: 4 in total
await skMenu('Sketch Circular Pattern'); await clickAt(await sk(0, 0)); await W(200);
await page.fill('.dimedit', '4'); await page.keyboard.press('Enter'); await W(500);
g = await geoOf();
check(g.curves.filter(c => c.kind === 'circle').length === 5, 'circular pattern: 3 more circles (5 in all)');

// point on the line
await skMenu('Point'); await clickAt(await sk(0, 22));
g = await geoOf();
check(g.cons.some(k => k.type === 'onLine'), 'point dropped on the line stays on it');
await page.keyboard.press('Escape'); await W(200);

// text
await skMenu('Text'); await clickAt(await sk(-30, -45)); await W(300);
await page.fill('#dx-text', 'DW'); await W(300); await page.fill('#dx-h', '12'); await W(400);
await page.click('.dialog .btn.ok'); await W(500);
let sketch = (await docNow()).features.find(f => f.type === 'sketch');
check(sketch.texts?.length === 1 && sketch.texts[0].str === 'DW' && +sketch.texts[0].h === 12, 'text item added to the sketch');
await page.click('.rbtn[aria-label^="Finish Sketch"]'); await W(1200);

// extrude everything: 5 discs + 2 letters
await page.keyboard.press('e'); await W(400);
await page.fill('#dx-distance', '3'); await W(2500); await page.click('.dialog .btn.ok'); await W(1500);
const st = await state();
check(st.features.at(-1) === 'extrude:ok', 'sketch with text extrudes ' + JSON.stringify(st.features));
const total = st.bodies.reduce((a, b) => a + +b.split('=')[1].replace(/,/g, ''), 0);
check(total > 4 * Math.PI * 25 * 3 + 60, 'volume includes 4 distinct discs (one pattern copy lands on the original) and the letters (' + total + ' mm³)');

// project: a sketch on the top of a box picks up one of its edges
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'P', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'b', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 20, h: 10, op: 'new' },
  { id: 'c', type: 'cylinder', name: 'Hole', plane: 'XY', offset: 0, cx: 10, cy: 0, diameter: 8, h: 10, op: 'cut' }] }));
await W(2500);
await page.click('.rbtn[aria-label^="Create Sketch"]'); await W(300);
await page.click('#bMin'); if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw'); await page.click('.node .nlab:text-is("XY")'); await page.click('#bMin'); await W(1500);
await skMenu('Project');
await clickAt(await page.evaluate(() => window.__dw.screen(-20, 0, 0)));   // left end edge (projects to a line)
await clickAt(await page.evaluate(() => window.__dw.screen(14, 0, 0)));    // hole rim (projects to a circle)
g = (await docNow()).features.find(f => f.type === 'sketch' && f.geo).geo;
const proj = g.curves.filter(c => c.proj);
check(proj.some(c => c.kind === 'line') && proj.some(c => c.kind === 'circle' && Math.abs(c.r - 4) < 1e-3), 'project: an edge line and the hole circle (r 4) ' + JSON.stringify(proj.map(c => c.kind + (c.r ? c.r : ''))));

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
