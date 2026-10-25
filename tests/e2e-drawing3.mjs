// End-to-end, core drawings (spec Phase 3): Create Drawing from a face (the whole part turned so the face looks out of
// the front view, the face not isolated), first- and third-angle layouts with the projection symbol, A1 and custom
// sheets, the full title block (drawing no., revision, finish, approval), a drawing of one assembly component alone,
// views that follow a model change, and everything surviving a reload.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5234, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const info = () => page.evaluate(() => window.__dw.dwInfo());
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 90000 });
const toDesign = async () => { await page.click('#wsBtn'); await W(250); await page.click('.menu .mi:has-text("Design")'); await W(800); };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
const engine = () => page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });

await page.goto(`http://localhost:${PORT}/`);
await engine();
const DOC = {
  version: 2, name: 'Bracket', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, meta: { partNumber: 'BR-7' },
  features: [
    { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 20, op: 'new' },
    { id: 'peg', type: 'cylinder', name: 'Peg', plane: 'XY', offset: 0, cx: 100, cy: 0, diameter: 10, h: 30, op: 'new' },
  ],
  components: [{ id: 'kp', name: 'Peg', bodies: ['peg'] }],
};
await page.evaluate(d => window.__dw.setDoc(d), DOC);
await W(2500); await page.click('#vcHome'); await W(800);

// 1. Create Drawing from Face: the plate's +X face (40 wide in Y, 20 tall)
await page.evaluate(() => window.__dw.run('createdrawingface')); await W(300);
check(/flat face/.test(await page.textContent('#hint')), 'the face pick asks for a flat face');
let p = await scr(30, 0, 10); await page.mouse.click(p.x, p.y); await W(600);
check(/Looking at a face of/.test(await page.textContent('#cd-face')) && await page.inputValue('#cd-from') === 'body', 'the dialog shows the face as the base view and the body as the contents');
await page.selectOption('#cd-sheet', 'A1'); await page.selectOption('#cd-proj', 'first');
await page.click('#cd-ok'); await W(1500); await idle(); await W(800);
let I = await info();
check(I && near(I.size[0], 841) && near(I.size[1], 594) && I.projection === 'first', 'A1 sheet (841 × 594) with first-angle projection: ' + JSON.stringify(I?.size));
check(I.source?.kind === 'body' && I.source.face && I.orient, 'the drawing records its source (the plate body) and the face orientation: ' + JSON.stringify(I.source));
check(near(I.views.front.w, 40) && near(I.views.front.h, 20), `front view looks straight at the face: ${I.views.front.w.toFixed(3)} × ${I.views.front.h.toFixed(3)} (the face is 40 × 20)`);
check(near(I.views.top.w, 40) && near(I.views.top.h, 60), 'the whole plate is drawn, not just the face: top view 40 × 60');
check(I.views.top.y > I.views.front.y && I.views.right.x < I.views.front.x, 'first angle: top view below the front view, right view on its left');
check((await page.$$('[data-tag="tb:symbol"]')).length === 3 && I.tb.some(t => t === 'tb:projection=FIRST ANGLE'), 'title block shows the first-angle symbol');

// 2. title block fields (double-click the title block)
const tbEl = await page.$('[data-tag="tb:title"]'); const bb = await tbEl.boundingBox();
await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2); await W(500);
await page.fill('#dw-dno', 'DW-100'); await page.fill('#dw-rev', 'B'); await page.fill('#dw-finish', 'Anodized, black');
await page.selectOption('#dw-approval', 'Approved'); await page.fill('#dw-approver', 'J. Doe'); await page.fill('#dw-author', 'D. Raymond');
await page.selectOption('#dw-proj', 'third'); await W(500);
I = await info();
check(I.views.top.y < I.views.front.y && I.views.right.x > I.views.front.x && I.tb.includes('tb:projection=THIRD ANGLE'), 'switching to third angle moves the top view above and the right view to the right');
await page.selectOption('#dw-size', 'custom'); await W(300);
await page.fill('#dw-size-w', '500'); await page.fill('#dw-size-h', '350'); await W(400);
await page.click('.dialog .btn.ok'); await W(600);
I = await info();
const tb = Object.fromEntries(I.tb.map(t => t.split('=')));
check(tb['tb:drawingNo'] === 'DW-100' && tb['tb:revision'] === 'B' && tb['tb:finish'] === 'Anodized, black' && tb['tb:partNo'] === 'BR-7' && tb['tb:author'] === 'D. Raymond', 'title block: drawing no., revision, finish, part no. (from the design) and author: ' + JSON.stringify(tb));
check(/^Approved · J\. Doe/.test(tb['tb:approval']), 'approval status and approver: ' + tb['tb:approval']);
check(near(I.size[0], 500) && near(I.size[1], 350) && tb['tb:size'] === '500 × 350', 'custom 500 × 350 sheet');
check(!tb['tb:material'] || tb['tb:material'] === '—', 'an empty material prints a dash, nothing is invented: ' + tb['tb:material']);

// 3. the model changes: the face-based views follow (the plate gets deeper: the face is now 50 wide)
await toDesign();
let d = await page.evaluate(() => window.__dw.doc());
d.features.find(f => f.id === 'plate').d = 50;
await page.evaluate(x => window.__dw.setDoc(x), d); await W(2500);
await page.evaluate(() => window.__dw.run('opendrawing')); await W(1500); await idle(); await W(600);
I = await info();
check(I && near(I.views.front.w, 50) && near(I.views.front.h, 20), 'after the model change the front view is 50 × 20: ' + (I && I.views.front.w.toFixed(3)));

// 4. reload: sheet, projection and title block come back
await page.reload(); await engine(); await W(2500);
await page.evaluate(() => window.__dw.run('opendrawing')); await W(1500); await idle(); await W(600);
I = await info();
const tb2 = Object.fromEntries((I?.tb || []).map(t => t.split('=')));
check(I && near(I.size[0], 500) && I.projection === 'third' && tb2['tb:revision'] === 'B' && tb2['tb:drawingNo'] === 'DW-100' && I.orient, 'after reload the custom sheet, projection, title block and face orientation are kept');

// 5. a drawing of one component alone (from the browser)
await toDesign();
await page.evaluate(() => { const c = [...document.querySelectorAll('.node')].find(n => /Components/.test(n.textContent)); c?.querySelector('.tw')?.click(); }); await W(300);
await page.click('.node:has-text("Peg")', { button: 'right' }); await W(300);
await page.click('.menu .mi:has-text("Create Drawing")'); await W(500);
check(await page.inputValue('#cd-from') === 'component', 'from a component, the contents default to that component alone');
await page.click('#cd-ok'); await W(1500); await idle(); await W(800);
I = await info();
check(I.source?.kind === 'component' && I.source.name === 'Peg' && near(I.views.front.w, 10) && near(I.views.front.h, 30), `the component drawing shows only the peg: front ${I.views.front.w.toFixed(2)} × ${I.views.front.h.toFixed(2)}`);

// 6. a face that is not square to the axes: a plate turned 30° about Z; its long side face still draws as exactly 60 × 20
await toDesign();
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Turned', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 20, op: 'new' },
  { id: 'mv', type: 'move', name: 'Turn', body: 'plate', rz: 30, dx: 0, dy: 0, dz: 0 }] })); await W(2500);
await page.click('#vcHome'); await W(800);
await page.evaluate(() => window.__dw.run('createdrawingface')); await W(300);
const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
p = await scr(20 * s30, -20 * c30, 10); await page.mouse.click(p.x, p.y); await W(600);   // centre of the face that was −Y before turning
await page.click('#cd-ok'); await W(1500); await idle(); await W(800);
I = await info();
check(I && near(I.views.front.w, 60) && near(I.views.front.h, 20) && near(I.views.top.h, 40), `a face turned 30° still draws square-on: front ${I && I.views.front.w.toFixed(3)} × ${I && I.views.front.h.toFixed(3)}, depth ${I && I.views.top.h.toFixed(3)}`);

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall drawing checks passed');
process.exit(failed ? 1 : 0);
