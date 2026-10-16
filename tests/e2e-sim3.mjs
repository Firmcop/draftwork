// End-to-end: Simulation — thermal stress (restrained heated bar) and linear buckling (Euler column).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5213, server = serve(PORT);
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
const view = async v => { await page.evaluate(v => window.__dw.view(v), v); await W(400); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Bar', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [
  { id: 'b', type: 'box', name: 'Bar', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 100, d: 10, h: 10, op: 'new' }] }));
await W(2500);
await page.click('#wsBtn'); await W(200); await page.click('.menu .mi:has-text("SIMULATION")'); await W(1200);
await page.click('#vcHome'); await W(600);

// ---- thermal stress: bar between two walls (x restrained at both ends), held at 70 °C, reference 20 °C ----
await btn('New Study'); await page.click('.studycard[data-kind="thermalstress"]'); await W(800);
check((await info()).kind === 'thermalstress' && await page.isVisible('.rtab:text-is("THERMAL STRESS")'), 'Thermal Stress study with its own tab');
await btn('Study Materials'); await page.selectOption('#modal select', 'Steel 1018'); await page.click('#modal .btn.ok'); await W(300);
await btn('Fixed'); await pick(50, 0, 5); await ok();
await view('left'); await btn('Fixed'); await pick(-50, 0, 5);
await page.click('.dialog label.chk:has-text("Y")'); await page.click('.dialog label.chk:has-text("Z")'); await W(200); await ok();
await page.click('#vcHome'); await W(600);
await btn('Temperature'); await pick(0, 0, 10); await page.fill('#sb-value', '70'); await W(200); await ok();
let s = await info();
check(JSON.stringify(s.bcs) === '["fixed:1","fixed:1","temp:1"]', 'two walls and a temperature face ' + JSON.stringify(s.bcs));
await btn('Mesh Settings'); await page.click('.dialog .seg button:has-text("Coarse")'); await ok();
await btn('Solve'); await page.waitForFunction(() => window.__dw.simInfo().res?.kind === 'thermalstress', null, { timeout: 300000 }); await W(800);
s = await info();
const mid = await page.evaluate(() => window.__dw.simSample(0, 0, 5)), exact = 205000 * 12e-6 * 50;   // 123 MPa
check(Math.abs(s.res.tmax - 70) < 1e-6 && Math.abs(s.res.tmin - 70) < 1e-6, 'uniform 70 °C');
check(Math.abs(mid - exact) / exact < 0.02, `mid-span stress ${mid.toFixed(1)} MPa vs E α ΔT = ${exact.toFixed(1)} MPa`);
check(Math.abs(s.res.reaction[0]) < 1, 'wall reactions balance (' + s.res.reaction.map(v => v.toFixed(2)) + ')');
check(/Stress/.test(await page.textContent('#simLegend')) && (await page.locator('#btree .node:has-text("Temperature")').count()) >= 1, 'stress plot, temperature also listed in results');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sim-thermalstress.png' });
await page.click('#btree .node:has-text("Temperature") >> nth=-1'); await W(600);
check(/Temperature/.test(await page.textContent('#simLegend')), 'temperature plot');

// ---- linear buckling: column clamped at +X, 1000 N pushing on the −X end ----
await btn('New Study'); await page.click('.studycard[data-kind="buckling"]'); await W(800);
check((await info()).kind === 'buckling' && await page.isVisible('.rtab:text-is("LINEAR BUCKLING")'), 'Linear Buckling study with its own tab');
await btn('Study Materials'); await page.selectOption('#modal select', 'Steel 1018'); await page.click('#modal .btn.ok'); await W(300);
await btn('Fixed'); await pick(50, 0, 5); await ok();
await view('left'); await btn('Force'); await pick(-50, 0, 5); await page.fill('#sb-value', '1000'); await page.selectOption('.dialog select', '+X'); await W(200); await ok();
await page.click('#vcHome'); await W(600);
await btn('Mesh Settings'); await page.click('.dialog .seg button:has-text("Coarse")'); await page.fill('#sim-modes', '2'); await page.dispatchEvent('#sim-modes', 'change'); await W(200); await ok();
await btn('Solve'); await page.waitForFunction(() => window.__dw.simInfo().res?.kind === 'buckling', null, { timeout: 300000 }); await W(800);
s = await info();
const Pcr = Math.PI ** 2 * 205000 * (10 ** 4 / 12) / (4 * 100 ** 2);
check(s.res.factors.length === 2 && s.res.factors.every(f => Math.abs(f * 1000 - Pcr) / Pcr < 0.05), `load factors ${s.res.factors.map(f => f.toFixed(2))} → ${(s.res.factors[0] * 1000).toFixed(0)} N vs Euler ${Pcr.toFixed(0)} N (${s.res.ne} elements)`);
check(/load factor/.test(await page.textContent('#simLegend')) && (await page.locator('#btree .node:has-text("Mode 2")').count()) === 1, 'buckling shape plotted; modes listed');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/sim-buckling.png' });
await btn('Results'); 
check((await page.locator('#sim-modes-table tbody tr').count()) === 2 && /Critical load/.test(await page.textContent('.dialog')), 'results table with critical loads');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#sim-report')]);
let rep = false; if (dl) { const z = fs.readFileSync(await dl.path()).toString('latin1'); rep = z.includes('Linear buckling') && z.includes('Load factor'); }
check(rep, 'buckling report');
await page.click('.dialog .btn.ok'); await W(300);

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
