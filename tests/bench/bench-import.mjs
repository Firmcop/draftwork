// STEP import benchmark through the real Draftwork UI (built app, Chromium).
//
//   node tests/bench/make-fixtures.mjs                      # once: writes tests/bench/fixtures/*.step
//   node tests/bench/bench-import.mjs [file.step ...] [--trials 3] [--out results.json] [--root <checkout>]
//
// Workflows, per file:
//   cold     fresh browser profile (no compiled engine, no stored files or caches), upload into a new design
//   repeat   same profile, upload the same file again into a new design (may reuse cached artifacts)
//   reopen   reload the page with that design open (time from page start)
//   insert   upload into a populated project (the 20 ft reference container, 19 bodies, already built)
// Each run records the app's import timeline (window.__dw.importTrace()), engine phase timings and main-thread
// long tasks. Times are ms from the start of the upload (from page start for reopen). Medians and ranges are printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const TRIALS = +opt('--trials', 3), OUT = opt('--out', null), ROOT = path.resolve(opt('--root', path.join(here, '../..'))), PORT = +opt('--port', 5290);
const files = args.length ? args : ['container20.step', 'parts300.step'].map(f => path.join(here, 'fixtures', f));
const { chromium } = await import(path.join(ROOT, 'node_modules/playwright/index.mjs'));
const { serve } = await import(path.join(ROOT, 'scripts/serve.mjs'));
const server = serve(PORT), URL0 = `http://localhost:${PORT}/`;
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const MARKS = ['fileRead', 'engineImport', 'regenDone', 'firstFrame', 'meshesIn', 'editReady', 'checked'];
const REOPEN = ['engineReady', 'cacheLoaded', 'regenDone', 'firstFrame', 'meshesIn', 'editReady'];

const init = () => { window.__long = []; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch (e) { } };
async function ready(p) { await p.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 180000, polling: 50 }); }
async function newDesign(p) { await p.click('#abFile'); await p.click('text=New design'); await p.waitForTimeout(600); await p.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 }); }
async function waitDone(p, kind) {
  await p.waitForFunction(k => { const t = window.__dw.importTrace(); return t.kind === k && t.marks.editReady != null && (k === 'reopen' || t.marks.checked != null); }, kind, { timeout: 600000, polling: 100 });
  await p.waitForTimeout(300);
}
async function collect(p, since) {
  const t = await p.evaluate(() => window.__dw.importTrace()), long = await p.evaluate(s => window.__long.filter(([st]) => st >= s), since);
  return { ...t, longMs: long.reduce((s, [, d]) => s + d, 0), longMax: long.reduce((m, [, d]) => Math.max(m, d), 0), longN: long.length };
}
async function upload(p, file, kind = 'upload') {
  const since = await p.evaluate(() => performance.now());
  await p.setInputFiles('#stepInput', file);
  await waitDone(p, kind);
  return collect(p, since);
}
async function populate(p) {
  // the populated project: the 20 ft reference container built from its features
  await p.evaluate(() => window.__dw.run('container20'));
  await p.waitForTimeout(1500); await p.waitForFunction(() => document.querySelector('#busy').hidden && window.__dw.state().bodies.length >= 19, null, { timeout: 180000 });
  return p.evaluate(() => window.__dw.props().map(b => [b.id, +b.volume.toFixed(3)]));
}

const results = {};
for (const file of files) {
  const name = path.basename(file), R = results[name] = { cold: [], repeat: [], reopen: [], insert: [] };
  for (let i = 0; i < TRIALS; i++) {
    const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-bench-'));
    const ctx = await chromium.launchPersistentContext(prof, { executablePath: process.env.CHROMIUM_PATH, args: ARGS, viewport: { width: 1400, height: 860 } });
    const p = ctx.pages()[0] || await ctx.newPage(); await p.addInitScript(init);
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL0); await ready(p); await newDesign(p);
    R.cold.push(await upload(p, file));
    await newDesign(p);
    R.repeat.push(await upload(p, file));
    await p.waitForTimeout(1500);          // let the save to browser storage finish
    await p.reload(); await ready(p);
    await waitDone(p, 'reopen'); R.reopen.push(await collect(p, 0));
    await newDesign(p);
    const before = await populate(p);
    const ins = await upload(p, file);
    const after = await p.evaluate(() => window.__dw.props().map(b => [b.id, +b.volume.toFixed(3)]));
    ins.data.existingKept = before.every(([id, v]) => after.some(([j, w]) => j === id && Math.abs(w - v) < 1e-3)) && after.length > before.length;
    R.insert.push(ins);
    if (errs.length) console.log('page errors:', errs.slice(0, 3).join(' | '));
    await ctx.close(); fs.rmSync(prof, { recursive: true, force: true });
    console.log(`${name} trial ${i + 1}/${TRIALS} done`);
  }
}
server.close();

const med = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const rng = a => { const s = a.filter(v => v != null); return s.length ? `${Math.min(...s)}–${Math.max(...s)}` : ''; };
const cell = a => a.every(v => v == null) ? '—' : `${med(a)} (${rng(a)})`;
for (const [name, R] of Object.entries(results)) {
  console.log(`\n## ${name}  (median, range in ms; ${TRIALS} trials)`);
  for (const [wf, runs] of Object.entries(R)) {
    const keys = wf === 'reopen' ? REOPEN : MARKS;
    console.log(`\n${wf}:`);
    console.log('  ' + keys.map(k => `${k} ${cell(runs.map(r => r.marks[k]))}`).join(' | '));
    const eng = runs.map(r => r.data.engine).filter(Boolean);
    if (eng.length) console.log('  engine: ' + Object.keys(eng[0]).map(k => `${k} ${cell(eng.map(e => e[k]))}`).join(' | '));
    console.log(`  long tasks: total ${cell(runs.map(r => r.longMs))}, longest ${cell(runs.map(r => r.longMax))} · triangles ${med(runs.map(r => r.data.triangles))} · mesh ${med(runs.map(r => r.data.meshMB))} MB · bodies ${med(runs.map(r => r.data.bodies))}` + (runs[0]?.data.cacheWriteMs != null ? ` · cache write ${cell(runs.map(r => r.data.cacheWriteMs))}` : '') + (wf === 'insert' ? ` · existing geometry kept: ${runs.every(r => r.data.existingKept)}` : ''));
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
