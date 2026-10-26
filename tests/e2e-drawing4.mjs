// End-to-end, manufacturing drawings (spec Phase 4): hole and thread callouts read from the hole features (counterbore,
// tapped, count prefix) with a measured-only fallback that says so; out-of-date detection that keeps the earlier views
// and a controlled Update that flags changed and lost annotations instead of silently rewriting them, with an update
// record; exploded assembly drawing; and all of it surviving a reload.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5235, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const info = () => page.evaluate(() => window.__dw.dwInfo());
const dinfo = () => page.evaluate(() => window.__dw.drawing());
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 90000 });
const engine = () => page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
const toDesign = async () => { await page.click('#wsBtn'); await W(250); await page.click('.menu .mi:has-text("Design")'); await W(800); };
// screen point of model (X, Y) in the top view (top view local coordinates are (X, −Y))
const topPt = async (X, Y) => { const I = await info(), v = I.views.top, sx = v.x + I.scale * (X - v.cx), sy = v.y + I.scale * (-Y - v.cy); return page.evaluate(([a, b]) => window.__dw.sheetPt(a, b), [sx, sy]); };
const clickTop = async (X, Y) => { const p = await topPt(X, Y); await page.mouse.move(p.x, p.y, { steps: 2 }); await W(150); await page.mouse.click(p.x, p.y); await W(400); };

await page.goto(`http://localhost:${PORT}/`);
await engine();
const hole = (id, cx, cy, extra) => ({ id, type: 'hole', name: id, plane: 'XY', offset: 10, flip: false, cx, cy, diameter: 6.6, depth: 10, tip: true, tipAngle: 118, ...extra });
const DOC = {
  version: 2, name: 'Mount plate', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [
    { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 100, d: 60, h: 10, op: 'new' },
    hole('cb1', -35, 18, { holeType: 'cbore', extent: 'all', cbDiameter: 11, cbDepth: 6.4 }),
    hole('cb2', 35, 18, { holeType: 'cbore', extent: 'all', cbDiameter: 11, cbDepth: 6.4 }),
    hole('tap', 0, -15, { tapped: true, tapSize: 'M8', depth: 15, extent: 'distance' }),
    { id: 'plain', type: 'cylinder', name: 'Plain cut', plane: 'XY', offset: 0, cx: 30, cy: -15, diameter: 5, h: 10, op: 'cut', target: 'plate' },
    { id: 'cap', type: 'box', name: 'Cap', plane: 'XY', offset: 30, cx: 0, cy: 0, w: 40, d: 30, h: 8, op: 'new' },
  ],
  components: [{ id: 'kc', name: 'Cap', bodies: ['cap'] }],
};
await page.evaluate(d => window.__dw.setDoc(d), DOC); await W(3000);
await page.evaluate(() => window.__dw.run('createdrawing')); await W(400);
await page.click('#cd-ok'); await W(2000); await idle(); await W(800);
let I = await info();
check(I && I.views.top && !I.stale, 'drawing created and up to date');

// 1. callouts from the hole features
await page.click('.rbtn[aria-label^="Hole / Thread Callout"]'); await W(200);
await clickTop(-35 + 5.5, 18); await clickTop(-20, 30);                 // counterbore rim
await clickTop(0 + 3.375, -15); await clickTop(10, -28);                 // tapped hole (drill Ø6.75)
await clickTop(30 + 2.5, -15); await clickTop(42, -26);                  // plain cut, no hole feature
let D = await dinfo();
const labels = D.labels.filter(l => /Ø|M8/.test(l));
check(labels.includes('2× Ø6.6 THRU / CBORE Ø11 × 6.4 DEEP'), 'counterbore callout from the hole feature, with the count of identical holes: ' + JSON.stringify(labels));
check(labels.includes('M8×1.25 × 15 DEEP / Ø6.75 × 15 DEEP'), 'tapped hole callout: thread size and pitch, then the tap drill');
check(labels.includes('Ø5') && D.texts.includes('(measured; no hole feature)'), 'a circle with no hole feature gets only its measured diameter, marked as measured');

// a linear dimension across the plate to watch through the update
await page.click('.rbtn[aria-label^="Dimension"]'); await W(200);
await clickTop(-50, 30); await clickTop(50, 30); await clickTop(0, 40);
await page.keyboard.press('Escape'); await W(200);
D = await dinfo();
check(D.dims.includes('h:100'), 'plate length dimension 100');

// 2. the model changes: the drawing keeps its views and says it is out of date
await toDesign();
let d = await page.evaluate(() => window.__dw.doc());
d.features.find(f => f.id === 'plate').w = 120;
for (const id of ['cb1', 'cb2']) d.features.find(f => f.id === id).cbDepth = 7;
await page.evaluate(x => window.__dw.setDoc(x), d); await W(3000);
await page.evaluate(() => window.__dw.run('opendrawing')); await W(1500); await idle(); await W(500);
I = await info(); D = await dinfo();
check(I.stale && await page.isVisible('#dw-update') && D.texts.some(t => t.startsWith('OUT OF DATE')), 'out of date: banner, Update button and an OUT OF DATE stamp on the sheet');
check(D.dims.includes('h:100') && D.labels.includes('2× Ø6.6 THRU / CBORE Ø11 × 6.4 DEEP'), 'nothing is overwritten before Update: still 100 and the old callout');

// 3. controlled update: values follow, changes are flagged, the update is recorded
await page.click('#dw-update'); await W(2500); await idle(); await W(500);
I = await info(); D = await dinfo();
check(!I.stale && D.dims.includes('h:120') && D.labels.includes('2× Ø6.6 THRU / CBORE Ø11 × 7 DEEP'), 'after Update: 120 and the new counterbore depth');
check(I.flags.includes('h:changed') && I.flags.includes('hc:changed') && D.texts.includes('was 100') && D.texts.includes('Δ'), 'changed annotations are flagged with their old value: ' + JSON.stringify(I.flags));
check(I.revs.length === 1 && I.revs[0].changed >= 2, 'the update is recorded: ' + JSON.stringify(I.revs));
await page.click('#dw-review'); await W(400);
I = await info();
check(!I.flags.length && !(await page.isVisible('#dw-review').catch(() => false)), 'Mark reviewed clears the flags');

// 4. the tapped hole is removed: its callout loses its geometry and is flagged, not deleted
await toDesign();
d = await page.evaluate(() => window.__dw.doc());
d.features = d.features.filter(f => f.id !== 'tap');
await page.evaluate(x => window.__dw.setDoc(x), d); await W(3000);
await page.evaluate(() => window.__dw.run('opendrawing')); await W(1500); await idle(); await W(500);
await page.click('#dw-update'); await W(2500); await idle(); await W(500);
I = await info(); D = await dinfo();
check(I.flags.includes('hc:lost') && D.texts.includes('geometry not found') && D.labels.some(l => l.startsWith('M8×1.25')), 'the callout of the removed hole is kept and flagged as lost');

// 5. exploded: the cap moves away from the plate
const h0 = I.views.front.h;
await page.click('.rbtn[aria-label^="Sheet & Title Block"]'); await W(400);
await page.fill('#dw-explode', '1'); await page.press('#dw-explode', 'Tab'); await W(2500); await idle(); await W(500);
await page.click('.dialog .btn.ok').catch(() => {}); await W(400);
I = await info();
check(I.explode === 1 && I.views.front.h > h0 + 5 && I.source.kind === 'exploded', `exploded: the front view grows from ${h0.toFixed(1)} to ${I.views.front.h.toFixed(1)} as the cap moves out`);

// 6. reload: views come from the stored geometry, flags and the update record are kept
await page.reload(); await engine(); await W(2500);
await page.evaluate(() => window.__dw.run('opendrawing')); await W(1500); await idle(); await W(500);
I = await info(); D = await dinfo();
check(I && !I.stale && I.revs.length >= 3 && I.flags.includes('hc:lost') && I.explode === 1, 'after reload: up to date, update record, flags and explode kept (' + (I && I.revs.length) + ' updates)');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall manufacturing drawing checks passed');
process.exit(failed ? 1 : 0);
