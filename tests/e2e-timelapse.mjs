// End-to-end: File › Make Build Timelapse opens the timelapse page with the open design, which recognises
// the 20 ft reference container as one craneable module and plays the build through to handover.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

const PORT = 5291, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
// offline runs: serve three r128 from a local copy when one is given
if (process.env.THREE128_PATH && fs.existsSync(process.env.THREE128_PATH))
  await ctx.route('**/npm/three@0.128.0/build/three.min.js', r => r.fulfill({ path: process.env.THREE128_PATH, contentType: 'text/javascript' }));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 180000 });
await page.evaluate(() => window.__dw.run('container20'));
await page.waitForTimeout(2000);
await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 180000, polling: 100 });

const [tl] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => window.__dw.run('timelapse'))]);
const tlErrors = []; tl.on('pageerror', e => tlErrors.push(e.message));
await tl.waitForLoadState();
await tl.waitForFunction(() => /container module/.test(document.querySelector('#mInfo')?.textContent || ''), null, { timeout: 60000 });
const info = await tl.textContent('#mInfo');
check(/19 parts/.test(info), 'the timelapse receives all 19 bodies of the container (' + info.replace(/\s+/g, ' ').trim() + ')');
check(/1 container module found/.test(info), 'the container is recognised as one module to crane in');
check(await tl.inputValue('#title') === '20 ft container', 'the video title is the design name');
const stages = await tl.evaluate(() => stages3d.map(s => s.id));
check(stages.includes('modules') && stages.includes('found') && stages.at(-1) === 'done', 'build stages: ' + stages.join(' → '));
const shown = await tl.evaluate(() => { state.t = 0.97; frame(); return parts.filter(p => p.obj.visible).length; });
check(shown > 3, 'the finished house is shown at the end (' + shown + ' parts visible)');
check(!errors.length && !tlErrors.length, 'no page errors' + (errors.length + tlErrors.length ? ': ' + [...errors, ...tlErrors].join(' | ') : ''));

await browser.close(); server.close();
if (failed) { console.log(failed + ' check(s) failed'); process.exit(1); }
console.log('timelapse e2e passed');
