// End-to-end: a multi-part STEP import shows its parts as soon as possible (streamed), then Move/Rotate on it:
// M moves the whole imported model, the arrow and ring handles drag it, typed values are exact, undo works.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { loadKernels } from './load-kernels.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };
const K = await loadKernels({ exact: true }), RC = K.getRC();
// 40 parts: enough to be streamed in batches
const items = Array.from({ length: 40 }, (_, k) => ({ shape: RC.makeBaseBox(20, 20, 10 + (k % 5)).translate((k % 8) * 40, Math.floor(k / 8) * 40, 0), name: 'Part ' + k }));
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-move-')), 'parts.step'); fs.writeFileSync(file, Buffer.from(await K.brepSTEP(items).arrayBuffer()));
const vol0 = items.reduce((s, x) => s + RC.measureVolume(x.shape), 0);

const PORT = 5265, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const W = ms => page.waitForTimeout(ms);
const idle = async () => { await W(250); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000, polling: 50 }); };
const state = () => page.evaluate(() => window.__dw.state());
const docNow = () => page.evaluate(() => window.__dw.doc());
const sc = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const vol = async () => (await page.evaluate(() => window.__dw.props())).reduce((s, b) => s + b.volume, 0);
const center = () => page.evaluate(() => window.__dw.bodyCenter());

await page.goto(`http://localhost:${PORT}/?engine-helpers=0`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await page.click('#abFile'); await page.click('text=New design'); await W(800);
const seen = []; await page.exposeFunction('__seen', t => seen.push(t));
await page.evaluate(() => { const b = document.querySelector('#busy'); new MutationObserver(() => { if (!b.hidden) window.__seen(b.textContent.split(' · ').slice(0, 2).join(' · ')); }).observe(b, { attributes: true, childList: true, characterData: true, subtree: true }); });
await page.setInputFiles('#stepInput', file);
await page.waitForFunction(() => window.__dw.state().features.includes('import:ok'), null, { timeout: 120000 }); await idle(); await W(500);
check((await state()).bodies.length === 40 && Math.abs(await vol() - vol0) < 1e-3, 'all 40 parts imported, volumes exact');
check(seen.some(t => /Preparing the view… · \d+ \/ 40/.test(t)), 'the view is filled batch by batch: ' + [...new Set(seen)].slice(-3).join(' | '));
check(/Press M/.test(await page.evaluate(() => window.__dw.hint())), 'after the import the hint says how to move or rotate it');

// M: the whole imported model is selected for the move, with handles at its centre
const c0 = await center();
await page.keyboard.press('m'); await W(1200); await idle();
let f = (await docNow()).features.at(-1);
check(f.type === 'move' && /^feat:/.test(f.body) && f.pivot && Math.abs(f.pivot[0] - c0[0]) < 1e-3, 'M moves the whole imported model, rotating about its centre');
check(/All 40 bodies of/.test(await page.textContent('.dialog')), 'the dialog says all 40 parts move together');
await W(400);
let g = await page.evaluate(() => window.__dw.gizmo());
check(!!g, 'move and rotate handles are shown');

// drag the X arrow
const P = g.pos, s = g.size;
let a = await sc(P[0] + 0.9 * s, P[1], P[2]), b = await sc(P[0] + 1.9 * s, P[1], P[2]);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await W(800); await idle();
f = (await docNow()).features.at(-1);
const c1 = await center();
check(f.dx > 0 && Number.isInteger(f.dx) && Math.abs(c1[0] - c0[0] - f.dx) < 0.01 && Math.abs(c1[1] - c0[1]) < 0.01, `dragging the X arrow moves the model ${f.dx} mm along X (whole millimetres)`);
// drag the Z ring a quarter turn
g = await page.evaluate(() => window.__dw.gizmo());
const R = 0.72 * g.size, Q = g.pos;
a = await sc(Q[0] + R, Q[1], Q[2]); b = await sc(Q[0], Q[1] + R, Q[2]);
const mid = await sc(Q[0] + R * Math.SQRT1_2, Q[1] + R * Math.SQRT1_2, Q[2]);
await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(mid.x, mid.y, { steps: 6 }); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); await W(800); await idle();
f = (await docNow()).features.at(-1);
check(Math.abs(f.rz) >= 45 && f.rz % 5 === 0, `dragging the Z ring turns the model (${f.rz}°, 5° steps)`);
check(Math.abs(await vol() - vol0) < 1e-3, 'moving and turning keeps every part exact');
// typed value
await page.fill('#dx-dz', '250'); await W(600); await idle();
const c2 = await center();
check(Math.abs(c2[2] - c0[2] - 250) < 0.01, 'typing Z distance 250 lifts it exactly 250 mm');
await page.click('.dialog .btn.ok'); await W(600); await idle();
check((await state()).features.at(-1) === 'move:ok', 'move step in the timeline');
// undo removes the move
await page.keyboard.press('Control+z'); await W(800); await idle();
const c3 = await center();
check(Math.abs(c3[0] - c0[0]) < 0.01 && Math.abs(c3[2] - c0[2]) < 0.01, 'undo puts the model back');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
