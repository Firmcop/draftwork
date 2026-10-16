// End-to-end: Simulation — modal frequencies (cantilever) and steady-state thermal (bar with fixed temperature and convection).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5212, server = serve(PORT);
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
const pick = async (x, y, z) => { await page.mouse.click(...Object.values(await scr(x, y, z))); await W(500); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Beam', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'b', type: 'box', name: 'Beam', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 100, d: 10, h: 10, op: 'new' }] }));
await W(2500);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("SIMULATION")'); await W(1200);
await page.click('#vcHome'); await W(600);

// ---- modal study ----
await btn('New Study'); await page.click('.studycard[data-kind="modal"]'); await W(800);
let s = await info();
check(s.kind === 'modal' && s.studies === 2 && await page.isVisible('.rtab:text-is("MODAL FREQUENCIES")'), 'New Study › Modal Frequencies switches the ribbon to the modal tab ' + JSON.stringify([s.kind, s.studies, s.tab]));
await btn('Study Materials'); await page.selectOption('#modal select', 'Steel 1018'); await page.click('#modal .btn.ok'); await W(300);
await btn('Fixed'); await pick(50, 0, 5); await ok();
await btn('Mesh Settings'); await page.click('.dialog .seg button:has-text("Coarse")'); await page.fill('#sim-modes', '4'); await page.dispatchEvent('#sim-modes', 'change'); await W(200); await ok();
await btn('Solve'); await page.waitForFunction(() => window.__dw.simInfo().res, null, { timeout: 300000 }); await W(800);
s = await info();
const rho = s.res.mass * 1e-3 / 10000, EI = 205000 * 10 * 10 ** 3 / 12;   // mass kg → t/mm³
const f1 = 1.875104 ** 2 / (2 * Math.PI) * Math.sqrt(EI / (rho * 100 * 100 ** 4));
check(s.res.kind === 'modal' && s.res.freqs.length === 4 && Math.abs(s.res.freqs[0] - f1) / f1 < 0.05 && Math.abs(s.res.freqs[1] - f1) / f1 < 0.05,
  `first bending modes ${s.res.freqs.map(f => f.toFixed(0)).join(', ')} Hz vs Euler-Bernoulli ${f1.toFixed(0)} Hz (${s.res.ne} elements, ${s.res.it} iterations)`);
check(Math.abs(s.res.mass - 0.0787) < 1e-3 && s.res.part[0][0] < 0.05 && s.res.part[0][1] + s.res.part[0][2] > 0.5, 'mass 78.7 g, mode 1 moves sideways (effective mass ' + s.res.part[0].map(v => v.toFixed(2)) + ')');
check(await page.isVisible('#simLegend') && /Mode 1/.test(await page.textContent('#simLegend')) && (await page.locator('#btree .node:has-text("Mode 4")').count()) === 1, 'mode shape plotted; four modes listed in the browser');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sim-modal.png' });
await btn('Animate Mode'); await W(500);
check((await info()).anim, 'Animate Mode swings the mode shape');
await btn('Animate Mode'); await W(300);
await btn('Results'); await page.click('#sim-modes-table tbody tr:nth-child(3)'); await W(600);
check(/Mode 3/.test(await page.textContent('#simLegend')), 'picking mode 3 in the Results table shows it');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#sim-report')]);
let rep = false; if (dl) { const z = fs.readFileSync(await dl.path()).toString('latin1'); rep = z.includes('Natural frequencies') && z.includes('Mass X'); }
check(rep, 'modal report lists the modes');
await page.click('.dialog .btn.ok'); await W(300);

// ---- thermal study: 100 °C at x = +50, convection h = 1000 W/m²K to 20 °C at x = −50, aluminium k = 167 ----
await btn('New Study'); await page.click('.studycard[data-kind="thermal"]'); await W(800);
check((await info()).kind === 'thermal' && await page.isVisible('.rtab:text-is("THERMAL")'), 'thermal study with its own ribbon tab');
await btn('Study Materials'); await page.selectOption('#modal select', 'Aluminum 6061'); await page.click('#modal .btn.ok'); await W(300);
await btn('Temperature'); await pick(50, 0, 5); await page.fill('#sb-value', '100'); await W(200); await ok();
await page.evaluate(() => window.__dw.view('left')); await W(400);
await btn('Convection'); await pick(-50, 0, 5); await page.fill('#sb-value', '1000'); await page.fill('#sb-ambient', '20'); await W(200); await ok();
s = await info();
await page.click('#vcHome'); await W(600);
check(JSON.stringify(s.bcs) === '["temp:1","conv:1"]', 'temperature and convection faces picked ' + JSON.stringify(s.bcs));
await btn('Mesh Settings'); await page.click('.dialog .seg button:has-text("Coarse")'); await ok();
await btn('Solve'); await page.waitForFunction(() => window.__dw.simInfo().res?.kind === 'thermal', null, { timeout: 180000 }); await W(800);
s = await info();
const Rk = 100 / (0.167 * 100), Rh = 1 / (1000e-6 * 100), q = 80 / (Rk + Rh), Tcold = 20 + q * Rh;   // 5.00 W, 70.0 °C
if (process.env.DBG) console.log(JSON.stringify(await page.evaluate(() => window.__dw.simBC())));
check(Math.abs(s.res.tmax - 100) < 1e-6 && Math.abs(s.res.tmin - Tcold) < 0.1, `temperatures ${s.res.tmin.toFixed(2)}–${s.res.tmax.toFixed(2)} °C (series resistances give ${Tcold.toFixed(2)} °C at the cooled end)`);
check(Math.abs(s.res.heatOut - q) / q < 0.01 && Math.abs(s.res.heatFixed - s.res.heatOut) < 0.01 * q, `heat balance: ${s.res.heatOut.toFixed(3)} W leave by convection (theory ${q.toFixed(3)} W), ${s.res.heatFixed.toFixed(3)} W enter at 100 °C`);
check(Math.abs(s.res.fmax * 100 - q) / q < 0.03, `heat flux ${(s.res.fmax * 1e6).toFixed(0)} W/m² × area = ${(s.res.fmax * 100).toFixed(3)} W`);
check(/Temperature/.test(await page.textContent('#simLegend')), 'temperature plot with legend');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sim-thermal.png' });
await page.click('#btree .node:has-text("Heat flux")'); await W(600);
check(/Heat flux/.test(await page.textContent('#simLegend')), 'heat flux plot from the browser');

// ---- switch back to the static study ----
await btn('Switch Study'); await page.click('.menu .mi:has-text("Static Stress 1")'); await W(800);
s = await info();
check(s.kind === 'static' && await page.isVisible('.rtab:text-is("STATIC STRESS")'), 'Switch Study returns to the static study and its tab');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
