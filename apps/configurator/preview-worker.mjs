// Preview worker: the exact Draftwork kernel (@draftwork/core) running in the browser, off the main thread.
// It keeps one model, so a change rebuilds only from the first feature it affects. Requests that arrive while a
// rebuild runs are coalesced: only the latest one is built next.
import { createEngine } from '/core/src/index.mjs';

let model = null, pending = null, busy = false;

async function init(design) {
  const [wasm, glue] = await Promise.all([fetch('/vendor/occ/replicad_single.wasm').then(r => { if (!r.ok) throw new Error('engine file missing'); return r.arrayBuffer(); }), import('/vendor/occ/replicad_single.js')]);
  const engine = await createEngine({ wasmBinary: wasm, opencascade: glue.default });
  model = engine.open(design);
}

async function pump() {
  if (busy || !pending || !model) return;
  busy = true;
  const job = pending; pending = null;
  try {
    model.setParams(job.params).setSuppressed(job.suppressed);
    const r = await model.rebuild();
    const meshes = r.ok ? model.meshes().map(m => ({ id: m.id, pos: m.pos.slice(), nrm: m.nrm.slice(), idx: m.idx.slice() })) : [];
    self.postMessage({ type: 'built', seq: job.seq, ok: r.ok, ms: r.ms, errors: r.errors, size: r.bbox?.size || null, meshes }, meshes.flatMap(m => [m.pos.buffer, m.nrm.buffer, m.idx.buffer]));
  } catch (e) {
    self.postMessage({ type: 'built', seq: job.seq, ok: false, errors: [{ message: e.message }], meshes: [] });
  }
  busy = false;
  pump();
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try { await init(data.design); self.postMessage({ type: 'ready' }); pump(); }
    catch (e) { self.postMessage({ type: 'failed', message: e.message }); }
  } else if (data.type === 'build') { pending = data; pump(); }
};
