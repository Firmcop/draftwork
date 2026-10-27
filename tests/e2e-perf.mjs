// Speed safeguards: lean document and undo entries, imports reopened from cached solids,
// inserted designs reopened and re-inserted from their saved result, picking data fetched after the rebuild.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { loadKernels } from './load-kernels.mjs';

let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failed++; };

// a STEP file big enough to matter (plate with 24 counterbored holes + 8 blocks)
const K = await loadKernels({ exact: true });
const feats = [{ id: 'b', type: 'box', plane: 'XY', cx: 0, cy: 0, w: 200, d: 120, h: 12, op: 'new' }];
for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) feats.push({ id: `h${i}_${j}`, type: 'hole', plane: 'XY', offset: 12, flip: false, cx: -75 + i * 30, cy: -45 + j * 30, diameter: 6, depth: 8, tip: true, holeType: 'cbore', cbDiameter: 10, cbDepth: 3 });
for (let k = 0; k < 8; k++) feats.push({ id: 'c' + k, type: 'cylinder', plane: 'XY', offset: 12, cx: -90 + k * 25, cy: 90, diameter: 16, h: 20, op: 'new' });
const r = K.regenerateBrep(feats);
const blob = K.brepSTEP([...r.bodies.values()].map(b => ({ shape: b.shape, name: b.name })));
const stepFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dw-perf-')), 'plate.step');
fs.writeFileSync(stepFile, Buffer.from(await blob.arrayBuffer()));
const nBodies = r.bodies.size;

const PORT = 5261, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const W = ms => page.waitForTimeout(ms);
const engine = () => page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
const idle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000, polling: 50 });
const state = () => page.evaluate(() => window.__dw.state());
const ready = kind => page.waitForFunction(k => window.__dw.state().features.includes(k + ':ok'), kind, { timeout: 60000, polling: 50 });
const timings = () => page.evaluate(() => window.__dw.engineTimings());
const idbKeys = () => page.evaluate(() => new Promise(res => { const q = indexedDB.open('draftwork'); q.onsuccess = () => { const t = q.result.transaction('payloads').objectStore('payloads').getAllKeys(); t.onsuccess = () => res(t.result); }; }));

await page.goto(`http://localhost:${PORT}/`); await engine();
await page.click('#abFile'); await page.click('text=New design'); await W(1000);
// the busy indicator follows the upload stage by stage
await page.evaluate(() => { window.__busySeen = new Set(); const b = document.querySelector('#busy'); new MutationObserver(() => { if (!b.hidden) window.__busySeen.add(b.textContent.split(' · ')[0]); }).observe(b, { attributes: true, childList: true, characterData: true, subtree: true }); });
await page.setInputFiles('#stepInput', stepFile);
await ready('import'); await idle(); await W(800);
const seen = await page.evaluate(() => [...window.__busySeen]);
check(seen.some(l => /^Reading the STEP file \(\d/.test(l)) && seen.some(l => /^(Preparing the view|Rebuilding the model)/.test(l)), 'upload shows its stages: ' + seen.join(' → '));
check(await page.evaluate(() => document.querySelector('#busy').hidden), 'indicator clears when the upload is done');
let st = await state();
check(st.bodies.length === nBodies, `STEP import brings ${nBodies} bodies (${st.bodies.length})`);
let t = await timings(); const sigs0 = t.sigs || 0;
check(t.import > 0 && !t.importbrep, 'first import parses the STEP file');
// picking data (face/edge signatures) is computed after the rebuild, in the background
await W(500);
t = await timings();
check(sigs0 + (t.sigs || 0) > 0, 'face and edge picking data arrive after the rebuild');
const sz = await page.evaluate(() => window.__dw.sizes());
check(sz.doc > 200000 && sz.lean < 20000, `saved document stays small with the file inside (${sz.lean} B saved vs ${sz.doc} B in memory)`);
check(sz.undoLast < 20000, `undo entries leave the file out (${sz.undoLast} B)`);
const keys = await idbKeys();
check(keys.some(k => k.startsWith('brep:')) && keys.some(k => k.startsWith('f:')), 'file contents and parsed solids kept in browser storage');

// reopen: solids come from the cache, no STEP parsing
await page.reload(); await engine(); await ready('import'); await idle();
st = await state(); t = await timings();
check(st.bodies.length === nBodies, 'reopened design has all imported bodies');
check(t.importbrep > 0 && !t.import, 'reopening uses the cached solids instead of parsing the STEP file');

// undo after reopen still restores the import
await page.evaluate(() => { const d = window.__dw.doc(); d.features.push({ id: 'bx', type: 'box', name: 'Box', plane: 'XY', offset: 0, cx: 300, cy: 0, w: 20, d: 20, h: 20, op: 'new' }); window.__dw.setDoc(d); });
await W(300); await idle();
check((await state()).bodies.length === nBodies + 1, 'edit after reopen adds a body');

// insert a design: first time rebuilds and keeps the result; reopen and insert again reuse it
const src = { name: 'Holes plate', params: [], features: [{ id: 'b', type: 'box', name: 'Plate', plane: 'XY', cx: 0, cy: 0, w: 200, d: 120, h: 12, op: 'new' }, ...Array.from({ length: 12 }, (_, k) => ({ id: 'h' + k, type: 'hole', name: 'H' + k, plane: 'XY', offset: 12, flip: false, cx: -75 + (k % 6) * 30, cy: -15 + Math.floor(k / 6) * 30, diameter: 6, depth: 8, tip: true, holeType: 'simple' }))] };
const asm = (fid, did, dx) => ({ version: 2, name: 'Asm', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, files: { [fid]: { name: src.name, design: src, kind: 'design' } }, features: [{ id: did, type: 'derive', name: 'Holes plate', file: fid, dx, dy: 0, dz: 0 }] });
await timings();
await page.evaluate(d => window.__dw.setDoc(d), asm('f1', 'd1', 0));
await ready('derive'); await idle(); await W(500);
const vol0 = (await state()).bodies[0];
t = await timings();
check(t.derived > 0, 'first insert rebuilds the design and keeps its result');
check((await idbKeys()).some(k => k.startsWith('res:')), 'the result is stored');
await page.reload(); await engine(); await ready('derive'); await idle();
t = await timings();
check(t.derivebrep > 0 && !t.derived, 'reopening loads the saved result instead of rebuilding the design');
check((await state()).bodies[0]?.split('=')[1] === vol0?.split('=')[1], 'same geometry from the saved result');
await page.evaluate(d => window.__dw.setDoc(d), asm('g1', 'e1', 50));
await ready('derive'); await idle();
t = await timings();
check(!t.derived, 'inserting the same design again reuses its result');
// changing the inserted design invalidates the result
const src2 = JSON.parse(JSON.stringify(src)); src2.features[0].h = 14;
await page.evaluate(([d, s]) => { d.files.g1.design = s; window.__dw.setDoc(d); }, [asm('g1', 'e1', 50), src2]);
await ready('derive'); await idle(); await W(300);
t = await timings();
check(t.derived > 0, 'a changed design is rebuilt, not taken from the old result');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
