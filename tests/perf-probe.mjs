// Performance probe (not part of CI): startup, STEP import, edit after import, insert-design rebuild, document size.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
const PORT = 5250, server = serve(PORT), STEP = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const W = ms => page.waitForTimeout(ms);
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 600000, polling: 50 });
const T = () => performance.now();
const out = {};
let t = T();
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000, polling: 50 });
out.startupToEngine = Math.round(T() - t);
await page.evaluate(() => window.__dw.engineTimings());
// STEP import (with main-thread long tasks recorded)
await page.evaluate(() => { window.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); });
t = T();
await page.setInputFiles('#stepInput', STEP);
await page.waitForFunction(() => /Imported/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 600000, polling: 50 });
await idle();
out.stepImport = Math.round(T() - t);
out.engineDuringImport = await page.evaluate(() => window.__dw.engineTimings());
out.mainThreadBlockedMs = await page.evaluate(() => window.__long.reduce((a, b) => a + b, 0));
out.longTasks = await page.evaluate(() => window.__long.filter(x => x > 200));
out.docBytesAfterImport = await page.evaluate(() => JSON.stringify(window.__dw.doc()).length);
out.checkpointMs = await page.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 5; i++) JSON.stringify(window.__dw.doc()); return Math.round((performance.now() - t0) / 5); });
// reopen: the import comes back from the cached solids (no STEP parsing)
const ready = (kind) => page.waitForFunction(k => window.__dw.state().features.some(f => f === k + ':ok'), kind, { timeout: 120000, polling: 50 });
await W(1500);
t = T();
await page.reload();
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000, polling: 50 });
await ready('import'); await idle();
out.reopenWithImport = Math.round(T() - t);
out.engineDuringReopen = await page.evaluate(() => window.__dw.engineTimings());
out.importBodiesAfterReopen = (await page.evaluate(() => window.__dw.state())).bodies.length;
// a small edit after the import: add a box through the UI path (setDoc would rebuild everything)
t = T();
await page.evaluate(() => window.__dw.regen()); await idle();
out.regenUnchanged = Math.round(T() - t);
// long tasks on the main thread during an orbit
// insert a design: a derive feature carrying another design's features
const src = { name: 'Holes plate', params: [], features: [{ id: 'b', type: 'box', name: 'Plate', plane: 'XY', cx: 0, cy: 0, w: 400, d: 260, h: 20, op: 'new' }, ...Array.from({ length: 96 }, (_, k) => ({ id: 'h' + k, type: 'hole', name: 'H' + k, plane: 'XY', offset: 20, flip: false, cx: -165 + (k % 12) * 30, cy: -105 + Math.floor(k / 12) * 30, diameter: 8, depth: 12, tip: true, holeType: 'cbore', cbDiameter: 14, cbDepth: 4 }))] };
await page.evaluate(() => window.__dw.engineTimings());
t = T();
await page.evaluate(s => window.__dw.setDoc({ version: 2, name: 'Asm', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, files: { f1: { name: s.name, design: s, kind: 'design' } }, features: [{ id: 'd1', type: 'derive', name: 'Holes plate', file: 'f1', dx: 0, dy: 0, dz: 0 }] }), src);
await W(200); await idle();
out.insertDesignRegen = Math.round(T() - t);
out.engineDuringInsert = await page.evaluate(() => window.__dw.engineTimings());
t = T();
await page.evaluate(() => { const d = window.__dw.doc(); d.features.push({ id: 'bx', type: 'box', name: 'Box', plane: 'XY', offset: 0, cx: 300, cy: 0, w: 20, d: 20, h: 20, op: 'new' }); window.__dw.setDoc(d); });
await W(200); await idle();
out.editAfterInsertViaSetDoc = Math.round(T() - t);
// reopen: the inserted design comes back from its saved result (no rebuild of its 97 features)
await W(1500);
t = T();
await page.reload();
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000, polling: 50 });
await ready('derive'); await idle();
out.reopenWithInsert = Math.round(T() - t);
// inserting the same design again (another document) uses the saved result too
t = T();
await page.evaluate(s => window.__dw.setDoc({ version: 2, name: 'Asm2', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, files: { g1: { name: s.name, design: s, kind: 'design' } }, features: [{ id: 'e1', type: 'derive', name: 'Holes plate', file: 'g1', dx: 50, dy: 0, dz: 0 }] }), src);
await W(200); await idle();
out.insertAgainCached = Math.round(T() - t);
console.log(JSON.stringify(out, null, 1), errors.length ? errors : '');
await browser.close(); server.close();
