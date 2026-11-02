// The Windows app's page side, in Chromium: helper engines on extra cores mesh bodies in parallel with the same
// result as one engine; files handed over by the app ("Open with Draftwork") and dropped files open.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { loadKernels } from './load-kernels.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
// a STEP file with 12 bodies
const K = await loadKernels({ exact: true }), RC = K.getRC();
const items = Array.from({ length: 12 }, (_, k) => ({ shape: RC.makeCylinder(10 + k, 30, [k * 60, 0, 0]).cut(RC.makeBaseBox(8, 8, 40).translate(k * 60, 0, -5)), name: 'Part ' + k }));
const stepText = await K.brepSTEP(items).text();
const stepFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-desk-')), 'parts.step'); fs.writeFileSync(stepFile, stepText);

const PORT = 5264, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const run = async (helpers) => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(n => { window.DRAFTWORK_DESKTOP = { helpers: n, cores: n + 1, onOpenFile: cb => { window.__openFile = cb; }, ready: () => { window.__ready = true; } }; }, helpers);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
  await page.waitForFunction(n => window.__dw.helpers() >= n, helpers, { timeout: 120000 });
  await page.click('#abFile'); await page.click('text=New design'); await page.waitForTimeout(800);
  // "Open with Draftwork": the app hands the file to the page
  await page.evaluate(t => window.__openFile({ name: 'parts.step', data: new TextEncoder().encode(t).buffer }), stepText);
  await page.waitForFunction(() => window.__dw.state().features.includes('import:ok'), null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 }); await page.waitForTimeout(800);
  const st = await page.evaluate(() => window.__dw.state()), props = await page.evaluate(() => window.__dw.props());
  return { page, ready: await page.evaluate(() => !!window.__ready), bodies: st.bodies.length, vols: props.map(p => p.volume.toFixed(3)).sort().join(','), helpersUp: await page.evaluate(() => window.__dw.helpers()) };
};
const one = await run(0), many = await run(3);
check(one.ready && one.bodies === 12, 'file handed over by the Windows app opens (12 bodies)');
check(many.helpersUp === 3, 'three helper engines start alongside the main engine');
check(many.bodies === 12 && many.vols === one.vols, 'meshing on helpers gives the same bodies and volumes as one engine');
// picking works on helper-meshed bodies: face data arrives with the mesh (same face numbering)
check(await many.page.evaluate(() => window.__dw.pickData()) === 12, 'face and edge picking data came with every helper-meshed body');
// drag and drop a STEP file onto the window
await many.page.click('#abFile'); await many.page.click('text=New design'); await many.page.waitForTimeout(800);
await many.page.evaluate(t => { const dt = new DataTransfer(); dt.items.add(new File([t], 'dropped.step')); document.querySelector('#viewport').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, stepText);
await many.page.waitForFunction(() => window.__dw.state().features.includes('import:ok'), null, { timeout: 120000 });
check((await many.page.evaluate(() => window.__dw.state())).bodies.length === 12, 'a STEP file dropped on the window is imported');
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
