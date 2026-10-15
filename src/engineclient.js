// Page side of the exact engine. The kernel runs in a Web Worker (engineFactory, see enginehost.js) so long
// rebuilds don't freeze the interface; when the page may not start workers it runs the same code here.
// Bodies arrive as records whose `shape` is a token; their meshes, signatures and properties come with them.
const FACE_PICK = new Set(['shell', 'draft', 'presspull', 'thicken', 'replaceface', 'thread', 'emboss', 'splitface', 'soffset', 'untrim', 'deleteface']);
let engineMode = null;                 // 'worker' | 'inline'
let engineWorker = null, engineInline = null;
const engineCalls = new Map(); let engineCallId = 0;
const shapeData = new Map();           // token -> { p: payload, built?, fsig?, esig?, props?, ni? }
const meshWanted = new Set();
const importsRead = new Set();         // STEP files parsed by the engine
let proxyPool = new Map();

function occMsg(e) {
  if (typeof e === 'number') return 'The geometry engine could not build this. Try different values.';
  const m = e?.message || String(e);
  return /^\d+$/.test(m) ? 'The geometry engine could not build this. Try different values.' : m;
}
function libURLs() {
  const map = JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports;
  const abs = k => new URL(map[k], location.href).href;
  return { three: abs('three'), replicad: abs('replicad'), occ: abs('replicad-occ') };
}
function engineCall(op, args) {
  if (engineMode === 'inline') return engineInline.handle(op, args);
  return new Promise((resolve, reject) => {
    const id = ++engineCallId;
    engineCalls.set(id, { resolve, reject });
    engineWorker.postMessage({ id, op, args });
  });
}
function startWorker(urls, wasm) {
  return new Promise((resolve, reject) => {
    const src = `const factory = ${engineFactory.toString()};
const hostP = factory(${JSON.stringify(urls)});
self.onmessage = async e => {
  const { id, op, args } = e.data;
  try { const host = await hostP; const r = await host.handle(op, args); self.postMessage({ id, ok: true, r }, host.transfers(r)); }
  catch (err) { self.postMessage({ id, ok: false, err: (err && err.message) || String(err) }); }
};`;
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' }); }
    catch (e) { reject(e); return; }
    let started = false;
    w.onerror = e => { e.preventDefault?.(); if (!started) reject(new Error(e.message || 'worker could not start')); };
    w.onmessage = e => {
      const { id, ok, r, err } = e.data, c = engineCalls.get(id); if (!c) return;
      engineCalls.delete(id); ok ? c.resolve(r) : c.reject(new Error(err));
    };
    engineWorker = w; engineMode = 'worker';
    engineCall('init', { urls, wasm }).then(() => { started = true; resolve(); }, e => { w.terminate(); engineWorker = null; reject(e); });
  });
}
// Starts the exact engine: worker first, then on the page. Rejects when neither works.
async function startEngine() {
  if (typeof WebAssembly !== 'object') throw new Error('WebAssembly is not available');
  const urls = libURLs(), wasm = new URL('engine/occ-gz.wasm', location.href).href;
  if (typeof Worker === 'function' && !/[?&]inline-engine\b/.test(location.search)) {
    try { await startWorker(urls, wasm); return 'worker'; }
    catch (e) { console.warn('Engine worker unavailable, running on the page:', e); }
  }
  engineInline = await engineFactory(urls); engineMode = 'inline';
  await engineInline.handle('init', { urls, wasm });
  return 'inline';
}

// ---- results ----
function ingestMesh(p) { if (p) { shapeData.set(p.tok, { p }); meshWanted.delete(p.tok); } }
function proxy(b) {
  const k = `${b.id}|${b.shape}|${b.name}|${b.feature}`;
  return proxyPool.get(k) || b;
}
async function engineRegen(features, rollback) {
  const r = await engineCall('regen', { features, rollback });
  for (const t of r.freed) shapeData.delete(t);
  r.meshes.forEach(ingestMesh);
  const pool = new Map(), keep = b => { const p = proxy(b); pool.set(`${p.id}|${p.shape}|${p.name}|${p.feature}`, p); return p; };
  const out = {
    bodies: new Map(r.bodies.map(([id, b]) => [id, keep(b)])),
    bodyCount: r.bodyCount, lastBody: r.lastBody,
    status: new Map(r.status), before: new Map(r.before),
    beforeBodies: new Map(r.beforeBodies.map(([fid, list]) => [fid, new Map(list.map(([id, b]) => [id, keep(b)]))])),
    tools: new Map(r.tools), planes: new Map(r.planes), axes: new Map(r.axes || []), points: new Map(r.points || []), sheets: new Map(r.sheets || []),
    sketches: new Map(r.sketches.map(([id, s]) => [id, { matrix: new THREE.Matrix4().fromArray(s.matrix), feature: s.feature }])),
  };
  proxyPool = pool;
  return out;
}
function engineReset() { return engineCall('reset'); }
function brepFlat(body) { return engineCall('flat', { body }); }
function brepSection(items, o) { return engineCall('section', { items: items.map(({ shape, place }) => ({ tok: shape, place })), ...o }); }
function brepProject(items, kinds) { return engineCall('project', { items: items.map(({ shape, place }) => ({ tok: shape, place })), kinds }); }
async function brepImportSTEP(fileId, text) { const n = await engineCall('import', { fileId, text }); importsRead.add(fileId); return n; }
function brepSTEP(items) { return engineCall('step', { items: items.map(({ shape, name, color, place }) => ({ tok: shape, name, color, place })) }); }

// ---- per-body data for display and picking ----
const EMPTY_MESH = { display: new THREE.BufferGeometry(), edgeGeom: new THREE.BufferGeometry(), triFace: new Float64Array(0), segEdge: new Float64Array(0) };
function wantMesh(t) {
  if (meshWanted.has(t)) return;
  meshWanted.add(t);
  engineCall('mesh', { tok: t }).then(p => { if (p) { ingestMesh(p); updateScene(); } else meshWanted.delete(t); }, () => meshWanted.delete(t));
}
function brepMeshOf(rec) {
  const d = shapeData.get(rec.shape);
  if (!d) { wantMesh(rec.shape); return EMPTY_MESH; }
  if (d.built) return d.built;
  const { p } = d, display = new THREE.BufferGeometry();
  display.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
  display.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3));
  display.setIndex(new THREE.BufferAttribute(p.idx, 1));
  const edgeGeom = new THREE.BufferGeometry(); edgeGeom.setAttribute('position', new THREE.BufferAttribute(p.seg, 3));
  return (d.built = { display, edgeGeom, triFace: p.triFace, segEdge: p.segEdge });
}
function brepGeomNI(rec) { const d = shapeData.get(rec.shape); if (!d) return brepMeshOf(rec).display; return d.ni || (d.ni = brepMeshOf(rec).display.toNonIndexed()); }
function brepSigMap(rec, kind) {
  const d = shapeData.get(rec.shape); if (!d?.p.fsig) return new Map();
  const k = kind === 'face' ? 'fsig' : 'esig';
  return d[k + 'M'] || (d[k + 'M'] = new Map(d.p[k]));
}
function brepProps(rec) {
  const d = shapeData.get(rec.shape), pr = d?.p.props;
  if (!pr) return { volume: 0, area: 0, com: new THREE.Vector3() };
  return d.props || (d.props = { volume: pr.volume, area: pr.area, com: new THREE.Vector3(...pr.com), surface: !!pr.surface });
}
// same matching rule as the kernel (brep.js matchRefs), on the signatures shipped with the body
function brepRefHashes(rec, refs, kind) {
  if (!refs?.length) return new Set();
  const m = brepSigMap(rec, kind), key = kind === 'face' ? 'c' : 'p', items = [...m], used = new Set(), hashes = new Set();
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const r of refs) {
    let best = -1, bestD = Infinity;
    items.forEach(([, s], i) => {
      if (used.has(i) || (r.type && s.type !== r.type)) return;
      let d = d3(s[key], r[key]);
      if (key === 'p') d += Math.abs((s.len || 0) - (r.len || 0)) * 0.5; else d += d3(s.n, r.n) * 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    const tol = key === 'p' ? Math.max(0.6, (r.len || 0) * 0.2) : 1.5;
    if (best >= 0 && bestD <= tol) { used.add(best); hashes.add(items[best][0]); }
  }
  return hashes;
}
