// End-to-end: Drawing workspace — standard views with hidden lines, dimensions, title block, PDF export.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5201, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const at = (kind, x, y) => page.evaluate(([k, x, y]) => window.__dw.sheet(k, x, y), [kind, x, y]);
const info = () => page.evaluate(() => window.__dw.drawing());
const click = async p => { await page.mouse.move(p.x, p.y); await W(80); await page.mouse.click(p.x, p.y); await W(250); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({
  version: 2, name: 'Plate with hole', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [
    { id: 'b', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 30, h: 10, op: 'new' },
    { id: 'c', type: 'cylinder', name: 'Hole', plane: 'XY', offset: 0, cx: 15, cy: 0, diameter: 8, h: 10, op: 'cut' },
  ],
}));
await W(2500);

// switch to the Drawing workspace: a standard layout is made
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("DRAWING")'); await W(3000);
let d = await info();
check(d && d.views.length === 4, 'four views laid out: ' + JSON.stringify(d?.views));
const front = d.views.find(v => v.startsWith('front:')), top = d.views.find(v => v.startsWith('top:'));
check(front && +front.split(':')[1].split('/')[1] > 0, 'front view shows the hole as hidden lines (' + front + ')');
check(top && +top.split(':')[1].split('/')[0] >= 2, 'top view shows the outline and the hole (' + top + ')');
check(d.texts.includes('Plate with hole') && d.texts.some(t => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(t)), 'title block names the design and the scale (' + d.scale + ')');
check(await page.isHidden('#viewport') && await page.isVisible('#sheetSvg'), 'the sheet replaces the 3D view');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/drawing.png' });

// horizontal dimension across the front view's bottom edge (points snap to corners)
await page.keyboard.press('d'); await W(200);
await click(await at('front', -30, 0)); await click(await at('front', 30, 0)); await click(await at('front', 0, 10));
d = await info();
check(d.dims.includes('h:60'), 'horizontal dimension reads 60 ' + JSON.stringify(d.dims));
// vertical dimension: height of the front view
await click(await at('front', 30, 0)); await click(await at('front', 30, -10)); await click(await at('front', 42, -5));
d = await info();
check(d.dims.includes('v:10'), 'vertical dimension reads 10 ' + JSON.stringify(d.dims));
await page.keyboard.press('Escape'); await W(200);
// diameter of the hole in the top view
await page.click('.rbtn[aria-label^="Diameter Dimension"]'); await W(200);
await click(await at('top', 19, 0)); await click(await at('top', 28, -14));
d = await info();
check(d.dims.includes('d:8') && d.texts.includes('Ø8'), 'diameter dimension reads Ø8 ' + JSON.stringify(d.dims));
await page.keyboard.press('Escape'); await W(200);

// the drawing follows the model: make the plate 80 long, the 60 becomes 80
await page.evaluate(() => { const x = window.__dw.doc(); x.features[0].w = 80; window.__dw.setDoc(x); }); await W(3500);
d = await info();
check(d.dims.includes('h:80'), 'after the plate grows to 80 mm, the dimension follows ' + JSON.stringify(d.dims));
const tidy = x => { const [W, H] = x.size, b = x.boxes; const inside = b.every(r => r[0] >= 10 && r[1] >= 10 && r[2] <= W - 10 && r[3] <= H - 10); let overlap = false; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (b[i][0] < b[j][2] && b[j][0] < b[i][2] && b[i][1] < b[j][3] && b[j][1] < b[i][3]) overlap = true; return inside && !overlap; };
check(tidy(d), 'views re-flow to fit: inside the border and not overlapping (scale ' + d.scale + ')');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/drawing-dims.png' });

// title block
await page.click('.rbtn[aria-label^="Sheet & Title Block"]'); await W(300);
await page.fill('#dw-author', 'D. Raymond'); await page.click('.dialog .btn.ok'); await W(300);
check((await info()).texts.includes('D. Raymond'), 'title block shows who drew it');

// export: a zip with a PDF and an SVG
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('.rbtn[aria-label^="Export PDF"]')]);
let zipOk = false;
if (dl && process.env.SHOTS) fs.copyFileSync(await dl.path(), process.env.SHOTS + '/drawing.zip');
if (dl) { const buf = fs.readFileSync(await dl.path()); const s = buf.toString('latin1'); zipOk = s.includes('%PDF-1.4') && s.includes('%%EOF') && s.includes('<svg') && s.includes('-drawing.pdf'); }
check(!!dl && dl.suggestedFilename().endsWith('-drawing.zip') && zipOk, 'export downloads a zip with the PDF and SVG');

// back to the design
await page.click('.rbtn[aria-label^="Finish Drawing"]'); await W(800);
check(await page.isVisible('#viewport') && await page.isHidden('#sheetSvg'), 'Finish Drawing returns to the 3D design');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
