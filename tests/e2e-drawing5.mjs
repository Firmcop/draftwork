// End-to-end, advanced drawings (spec Phase 5): auxiliary view square-on to an inclined face (checked against the exact
// projected size), broken view with true-length dimensions, GD&T feature control frame, datum, surface finish and
// welding symbols, the automated drawing check, assembly snap categories with the Ctrl override, and a reload.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5236, server = serve(PORT);
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
const vpt = (kind, x, y) => page.evaluate(([k, a, b]) => window.__dw.viewPt(k, a, b), [kind, x, y]);
const sheetPt = (X, Y) => page.evaluate(([a, b]) => window.__dw.sheetPt(a, b), [X, Y]);
const clickAt = async p => { await page.mouse.move(p.x, p.y, { steps: 2 }); await W(150); await page.mouse.click(p.x, p.y); await W(400); };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
const newDrawing = async () => { await page.evaluate(() => window.__dw.run('createdrawing')); await W(400); if (await page.isVisible('#cd-replace')) await page.check('#cd-replace'); await page.click('#cd-ok'); await W(2000); await idle(); await W(800); };
const base = { version: 2, units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {} };

await page.goto(`http://localhost:${PORT}/`);
await engine();

// a block with a 45° face, made by extruding a profile drawn on XZ (front view: X right, Z up)
await page.evaluate(d => window.__dw.setDoc(d), { ...base, name: 'Wedge', features: [
  { id: 's', type: 'sketch', name: 'Profile', plane: 'XZ', offset: 0, profiles: [{ id: 'p', kind: 'poly', pts: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 40, y: 40 }, { x: 0, y: 40 }] }] },
  { id: 'e', type: 'extrude', name: 'Wedge', sketch: 's', distance: 30, op: 'new' }] });
await W(3000);
await newDrawing();
let I = await info();
const F = I.views.front;
check(F && near(F.w, 60) && near(F.h, 40), 'front view shows the profile 60 × 40');

// 1. auxiliary view on the 45° edge (front view local coordinates are (x, −z))
await page.click('.rbtn[aria-label^="Auxiliary View"]'); await W(200);
await clickAt(await vpt('front', 50, -30));
const fr = await vpt('front', 80, -60); await clickAt({ x: fr.x + 40, y: fr.y - 40 });
await idle(); await W(1500); await idle(); await W(500);
I = await info(); let D = await dinfo();
const A = I.views.aux;
// exact size: along the edge the part spans 70.711 (vertices projected on (−1, 0, 1)/√2); across it the 30 mm depth
const dims = A ? [A.w, A.h].sort((a, b) => a - b) : [];
check(A && near(dims[0], 30) && near(dims[1], 50 * Math.SQRT2), `auxiliary view looks square-on at the inclined face: ${A && A.w.toFixed(3)} × ${A && A.h.toFixed(3)} (expected 70.711 × 30)`);
check(D.texts.includes('VIEW A') && D.texts.filter(t => t === 'A').length >= 1, 'the auxiliary view is labelled VIEW A, with its viewing arrow on the front view');

// 2. symbols: feature control frame, datum, surface finish, weld
const sym = async (btn, target, place) => { await page.click(`.rbtn[aria-label^="${btn}"]`); await W(200); await clickAt(target); await clickAt(place); await W(300); };
let p0 = await vpt('front', 30, 0), p1 = await vpt('front', 30, 25);
await sym('Datum Feature', p0, { x: p0.x, y: p0.y + 50 });
check(await page.inputValue('#sy-letter') === 'A', 'the first datum gets the letter A');
await page.click('.dialog .btn.ok'); await W(300);
p0 = await vpt('front', 0, -20);
await sym('Feature Control Frame', p0, { x: p0.x - 160, y: p0.y });
await page.selectOption('#sy-char', 'perpendicularity'); await W(200);
await page.fill('#sy-tol', '0.05'); await page.uncheck('#sy-dia'); await page.click('.dialog .btn.ok'); await W(300);
p0 = await vpt('front', 20, -40);
await sym('Surface Finish', p0, { x: p0.x, y: p0.y - 60 });
await page.fill('#sy-ra', '1.6'); await page.click('.dialog .btn.ok'); await W(300);
p0 = await vpt('front', 60, -10);
await sym('Welding Symbol', p0, { x: p0.x + 60, y: p0.y + 40 });
await page.fill('#sy-size', '5'); await page.fill('#sy-len', '50'); await page.click('.dialog .btn.ok'); await W(400);
I = await info(); D = await dinfo();
check(JSON.stringify(I.symbols) === '["datum","fcf","finish","weld"]', 'four symbols placed: ' + JSON.stringify(I.symbols));
check(D.texts.includes('0.05') && D.texts.includes('Ra 1.6') && D.texts.includes('5') && D.texts.includes('50'), 'their values print: tolerance 0.05, Ra 1.6, weld 5 × 50');
const symPaths = await page.$$eval('[data-tag^="s:"]', els => els.length);
check(symPaths >= 12, 'symbols are drawn as vector paths (' + symPaths + ' elements)');

// 3. drawing check
let C = await page.evaluate(() => window.__dw.dwChecks());
check(!C.some(c => /Perpendicularity/.test(c)) && C.some(c => /no drawing number/.test(c)), 'the check passes the complete frame and reports the empty title block: ' + C.length + ' findings');
// break the frame: no tolerance, a datum nobody defines
const fid = await page.evaluate(() => window.__dw.doc().drawing.sheets[0].symbols.find(x => x.type === 'fcf').id);
await page.evaluate(() => window.__dw.run('dw.check')); await W(400);
check(await page.isVisible('#dwc-summary'), 'Drawing Check opens a report: ' + await page.textContent('#dwc-summary').catch(() => ''));
await page.click('#modal .btn.ok').catch(() => page.keyboard.press('Escape')); await W(200);
// edit the frame: clear the tolerance and reference datum B
const fcfEl = await page.$(`[data-tag="s:${fid}"]`); const bb = await fcfEl.boundingBox();
await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await W(120); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await W(500);
await page.fill('#sy-tol', ''); await page.fill('#sy-d1', 'B'); await page.click('.dialog .btn.ok'); await W(300);
C = await page.evaluate(() => window.__dw.dwChecks());
check(C.some(c => /^error: Perpendicularity frame has no tolerance value/.test(c)) && C.some(c => /Datum B is referenced but no datum feature symbol defines it/.test(c)), 'the check finds the missing tolerance (error) and the undefined datum B');
await page.evaluate(() => window.__dw.run('dw.check')); await W(400);
await page.click('.dwcheck[data-level="error"]:has-text("tolerance")'); await W(300);
check((await page.evaluate(() => window.__dw.dwSel()))?.type === 'symbol', 'clicking a finding selects the symbol on the sheet');

// 4. broken view: a 300 mm bar, 200 mm cut out, the overall dimension still reads 300
await toDesign();
await page.evaluate(d => window.__dw.setDoc(d), { ...base, name: 'Bar', features: [{ id: 'bar', type: 'box', name: 'Bar', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 300, d: 20, h: 20, op: 'new' }] });
await W(2500);
await newDrawing();
I = await info();
const w0 = I.views.front.bw;
await page.click('.rbtn[aria-label^="Break View"]').catch(async () => { await page.click('.rgroup:has-text("VIEWS") .rlabel'); await page.click('.menu .mi:has-text("Break View")'); }); await W(200);
await clickAt(await vpt('front', -100, -10)); await clickAt(await vpt('front', 100, -10)); await W(500);
I = await info();
check(I.views.front.brk && near(I.views.front.bw, 300 - 200 + 8 / I.scale, 0.01) && I.views.front.bw < w0, `the broken front view is shorter on paper (${w0.toFixed(1)} → ${I.views.front.bw.toFixed(1)} mm of model width)`);
await page.click('.rbtn[aria-label^="Dimension"]'); await W(200);
await clickAt(await vpt('front', -150, -20)); await clickAt(await vpt('front', 150, -20));
const pf = await vpt('front', 0, -20); await clickAt({ x: pf.x, y: pf.y - 40 }); await page.keyboard.press('Escape'); await W(300);
D = await dinfo();
check(D.dims.includes('h:300'), 'a dimension across the break still reads the true length 300: ' + JSON.stringify(D.dims));

// 5. assembly snap categories and the Ctrl override (in a second tab, so the bar drawing stays for the reload check)
await toDesign();
await page.click('#newTabBtn'); await W(300); await page.click('.studycard[data-type="part"]'); await W(1500);
await page.evaluate(d => window.__dw.setDoc(d), { ...base, name: 'Snap', features: [
  { id: 'plate', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 10, op: 'new' },
  { id: 'block', type: 'box', name: 'Block', plane: 'XY', offset: 0, cx: 100, cy: 0, w: 20, d: 20, h: 10, op: 'new' }], components: [{ id: 'kb', name: 'Block', bodies: ['block'] }] });
await W(3000); await page.click('#vcHome'); await W(800);
await page.keyboard.press('j'); await W(600);
const sc = await page.evaluate(() => window.__dw.screen(109.6, 9.6, 10));
const hov = async () => { await page.mouse.move(sc.x - 6, sc.y - 4); await page.mouse.move(sc.x, sc.y, { steps: 3 }); await W(300); return page.evaluate(() => window.__dw.refs()?.list.map(c => c.type)); };
let types = await hov();
check(types?.[0] === 'vertex', 'near a corner the vertex is offered first: ' + JSON.stringify(types));
await page.keyboard.down('Control'); types = await hov(); await page.keyboard.up('Control');
check(types && types.length && types.every(t => ['face', 'axis', 'between', 'cplane', 'caxis'].includes(t)), 'holding Ctrl offers only faces, axes and planes (no point snaps): ' + JSON.stringify(types));
await page.uncheck('#js-vertex'); await W(100);
types = await hov();
check(types && !types.includes('vertex'), 'with Vertices switched off, no vertex is offered: ' + JSON.stringify(types));
await page.check('#js-vertex');
await page.click('.dialog .btn:has-text("Cancel")').catch(() => page.keyboard.press('Escape')); await W(300);

// 6. reload: the bar drawing keeps its break and its dimension
await page.reload(); await engine(); await W(2500);
await page.click('.dtab:has-text("Bar"), .tab:has-text("Bar")').catch(() => {}); await W(2000);
await page.evaluate(() => window.__dw.run('opendrawing')); await W(1500); await idle(); await W(500);
I = await info(); D = await dinfo();
check(I?.views.front.brk && D.dims.includes('h:300'), 'after reload the break and the true-length dimension are kept');
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall advanced drawing checks passed');
process.exit(failed ? 1 : 0);
