// End-to-end: Simulation workspace — cantilever under pressure: fixed end, pressure on top, solve, compare with beam theory.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5211, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const info = () => page.evaluate(() => window.__dw.simInfo());
const btn = async label => { await page.click(`.rbtn[aria-label^="${label}"]`); await W(600); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(600); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Beam', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'b', type: 'box', name: 'Beam', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 100, d: 10, h: 10, op: 'new' }] }));
await W(2500);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("SIMULATION")'); await W(1200);
check(await page.isVisible('.rtab:text-is("STATIC STRESS")') && (await info()).study, 'Simulation workspace opens with a static stress study');
await page.click('#vcHome'); await W(600);
// material: steel 1018
await btn('Study Materials'); await page.selectOption('#modal select', 'Steel 1018'); await page.click('#modal .btn.ok'); await W(300);
// fixed: the +X end face
await btn('Fixed'); await page.mouse.click(...Object.values(await scr(50, 0, 5))); await W(500); await ok();
// pressure 0.1 MPa on the top face
await btn('Pressure'); await page.mouse.click(...Object.values(await scr(-20, 0, 10))); await W(500); await page.fill('#sb-value', '0.1'); await W(200); await ok();
let s = await info();
check(JSON.stringify(s.bcs) === '["fixed:1","pressure:1"]', 'fixed end and pressure on top picked ' + JSON.stringify(s.bcs));
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sim-setup.png' });
// mesh coarse for speed, solve
await btn('Mesh Settings'); await page.click('.dialog .seg button:has-text("Coarse")'); await ok();
await btn('Solve'); await page.waitForFunction(() => window.__dw.simInfo().res, null, { timeout: 180000 }); await W(800);
s = await info();
const exact = 1 * 100 ** 4 / (8 * 205000 * (10 * 10 ** 3 / 12));   // w = p b = 1 N/mm, δ = wL⁴/8EI = 0.0732 mm
check(s.res.converged && Math.abs(s.res.dmax - exact) / exact < 0.04, `tip deflection ${s.res.dmax.toFixed(4)} mm vs beam theory ${exact.toFixed(4)} mm (${s.res.ne} elements, ${s.res.it} iterations)`);
check(Math.abs(s.res.reaction[2] - 100) < 1.5, 'support reaction balances the 100 N pressure load (' + s.res.reaction.map(v => v.toFixed(2)) + ')');
check(s.res.vmax > 27 && s.res.vmax < 45 && Math.abs(s.res.sfmin - 370 / s.res.vmax) < 0.05 * s.res.sfmin, `peak stress ${s.res.vmax.toFixed(1)} MPa at the root (beam theory wL²c/2I = 30 MPa at the surface), safety factor ${s.res.sfmin.toFixed(2)}`);
check(await page.isVisible('#simLegend'), 'results shown with a colour legend');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sim-result.png' });
// results dialog + report
await btn('Results'); await page.click('.dialog .seg button:has-text("Displacement")'); await W(800);
check(/Displacement/.test(await page.textContent('#simLegend')), 'switches to displacement');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#sim-report')]);
let rep = false; if (dl) { const z = fs.readFileSync(await dl.path()).toString('latin1'); rep = z.includes('simulation.html') && z.includes('Max stress'); }
check(rep, 'report saved');
await page.click('.dialog .btn.ok'); await W(300);
// change the model: results go out of date
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("DESIGN")'); await W(500);
await page.evaluate(() => { const d = window.__dw.doc(); d.features[0].h = 12; window.__dw.setDoc(d); }); await W(2500);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("SIMULATION")'); await W(800);
check(/Results out of date/.test(await page.textContent('#btree')), 'after a model change the results are marked out of date');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
