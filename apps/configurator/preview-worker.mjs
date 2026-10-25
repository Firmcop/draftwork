// Preview worker: the exact Draftwork kernel (@draftwork/core) running in the browser, off the main thread.
// It keeps one model, so a change rebuilds only from the first feature it affects. Preview requests that arrive
// while a rebuild runs are coalesced (only the latest is built). When the page is hosted without a server, it also
// makes the release files (STEP, STL, drawing views, flat DXF) here.
import { createEngine, viewSVG } from './core/src/index.mjs';

let model = null, busy = false;
const queue = [];   // { type: 'build' | 'files', ... }; at most one build waits

async function init(design) {
  const [wasm, glue] = await Promise.all([fetch('./vendor/occ/replicad_single.wasm').then(r => { if (!r.ok) throw new Error('engine file missing'); return r.arrayBuffer(); }), import('./vendor/occ/replicad_single.js')]);
  let bytes = new Uint8Array(wasm);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {   // a static host serves the engine gzipped as-is: unpack it here
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  const engine = await createEngine({ wasmBinary: bytes.buffer, opencascade: glue.default });
  model = engine.open(design);
}

async function build(job) {
  model.setParams(job.params).setSuppressed(job.suppressed);
  return model.rebuild();
}

async function run(job) {
  if (job.type === 'build') {
    const r = await build(job);
    const meshes = r.ok ? model.meshes().map(m => ({ id: m.id, pos: m.pos.slice(), nrm: m.nrm.slice(), idx: m.idx.slice() })) : [];
    self.postMessage({ type: 'built', seq: job.seq, ok: r.ok, ms: r.ms, errors: r.errors, size: r.bbox?.size || null, meshes }, meshes.flatMap(m => [m.pos.buffer, m.nrm.buffer, m.idx.buffer]));
    return;
  }
  // files
  const t0 = Date.now();
  const r = await build(job);
  if (!r.ok) { self.postMessage({ type: 'files', id: job.id, ok: false, error: r.errors?.[0]?.message || 'The model did not rebuild' }); return; }
  const files = [], base = job.base;
  const add = (name, data) => files.push({ name, data });
  if (job.formats.includes('step')) add(base + '.step', await model.export('step'));
  if (job.formats.includes('stl')) add(base + '.stl', await model.export('stl'));
  if (job.formats.includes('svg')) for (const [k, v] of Object.entries(await model.project(['front', 'top', 'right', 'iso']))) add(`${base}-${k}.svg`, viewSVG(v));
  if (job.formats.includes('dxf') && r.sheetMetal.length) add(base + '-flat.dxf', await model.export('dxf-flat'));
  self.postMessage({ type: 'files', id: job.id, ok: true, ms: Date.now() - t0, files });
}

async function pump() {
  if (busy || !model || !queue.length) return;
  busy = true;
  const job = queue.shift();
  try { await run(job); }
  catch (e) { self.postMessage(job.type === 'build' ? { type: 'built', seq: job.seq, ok: false, errors: [{ message: e.message }], meshes: [] } : { type: 'files', id: job.id, ok: false, error: e.message }); }
  busy = false;
  pump();
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try { await init(data.design); self.postMessage({ type: 'ready' }); pump(); }
    catch (e) { self.postMessage({ type: 'failed', message: e.message }); }
    return;
  }
  if (data.type === 'build') {
    const i = queue.findIndex(j => j.type === 'build');
    if (i >= 0) queue[i] = data; else queue.push(data);
  } else if (data.type === 'files') queue.push(data);
  pump();
};
