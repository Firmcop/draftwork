// Page side of the exact engine. The kernel runs in a Web Worker (engineFactory, see enginehost.js) so long
// rebuilds don't freeze the interface; when the page may not start workers it runs the same code here.
// Bodies arrive as records whose `shape` is a token; their meshes, signatures and properties come with them.
const FACE_PICK = new Set(['fullround', 'offsetface', 'shell', 'draft', 'presspull', 'thicken', 'replaceface', 'thread', 'emboss', 'splitface', 'soffset', 'untrim', 'deleteface', 'lip']);
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
// what the engine is doing, shown in the busy indicator with a count and elapsed time
function engineProgress(p) {
  const labels = { build: ['Rebuilding the model', 'features'], derive: ['Building inserted design' + (p.name ? ' “' + p.name + '”' : ''), 'features'], view: ['Preparing the view', 'bodies'], import: ['Reading the STEP file', ''], cache: ['Loading saved geometry', ''] };
  const [label, unit] = labels[p.stage] || ['Computing', ''];
  if (p.stage === 'import' && busyState().info?.label?.startsWith(label)) return;   // keeps the file size shown by the upload
  busyProgress({ label, unit, done: p.done || 0, total: p.total || 0 });
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
let lastProg = 0;
self.brepProgressPost = p => { const t = performance.now(); if (t - lastProg < 120 && p.done) return; lastProg = t; self.postMessage({ progress: p }); };
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
      if (e.data.progress) { engineProgress(e.data.progress); return; }
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
  globalThis.brepProgressPost = engineProgress; engineInline = await engineFactory(urls); engineMode = 'inline';
  await engineInline.handle('init', { urls, wasm });
  return 'inline';
}

// ---- results ----
function ingestMesh(p) { if (p) { shapeData.set(p.tok, { p }); meshWanted.delete(p.tok); if (!p.fsig) sigQueue.push(p.tok), pumpSigs(); } }
const sigQueue = [], sigWanted = new Set(); let sigBusy = false, sigWaiters = [];
function sigsNeededNow() { return typeof doc !== 'undefined' && !!(doc.joints?.length || doc.drawing || doc.cam); }
function sigsDrained() { return !sigBusy && !sigQueue.length ? Promise.resolve() : new Promise(res => sigWaiters.push(res)); }
async function pumpSigs() {
  if (sigBusy) return; sigBusy = true;
  try {
    while (sigQueue.length) {
      const t = sigQueue.shift(), d = shapeData.get(t); if (!d || d.p.fsig || sigWanted.has(t)) continue;
      sigWanted.add(t);
      try { const r = await engineCall('sigs', { tok: t }); const d2 = shapeData.get(t); if (r && d2) { d2.p.fsig = r.fsig; d2.p.esig = r.esig; delete d2.fsigM; delete d2.esigM; } } catch (e) { }
      sigWanted.delete(t);
    }
  } finally { sigBusy = false; const w = sigWaiters; sigWaiters = []; w.forEach(f => f()); }
}
function proxy(b) {
  const k = `${b.id}|${b.shape}|${b.name}|${b.feature}`;
  return proxyPool.get(k) || b;
}
async function engineRegen(features, rollback) {
  await loadDerivedResults(features);
  const r = await engineCall('regen', { features, rollback });
  for (const t of r.freed) shapeData.delete(t);
  if (r.derived?.length) engineCall('derived', { keys: r.derived }).then(list => { for (const [k, brep] of list) if (brep.length) { payloadSave('res:' + k, brep); derivedLoaded.add(k); } }).catch(() => { });
  r.meshes.forEach(ingestMesh);
  // joints, drawing references and CAM setups read face/edge data as soon as the rebuild finishes: fetch it first for those
  if (sigsNeededNow()) await sigsDrained();
  for (const [t, pos, idx, groups] of r.meshData || []) {
    const flat = new Float32Array(idx.length * 3); for (let i = 0; i < idx.length; i++) { flat[3 * i] = pos[3 * idx[i]]; flat[3 * i + 1] = pos[3 * idx[i] + 1]; flat[3 * i + 2] = pos[3 * idx[i] + 2]; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(flat, 3)); g.computeVertexNormals();
    meshGeoms.set(t, { geom: g, groups });
  }
  const pool = new Map(), keep = b => { const p = proxy(b); pool.set(`${p.id}|${p.shape}|${p.name}|${p.feature}`, p); return p; };
  const out = {
    bodies: new Map(r.bodies.map(([id, b]) => [id, keep(b)])),
    bodyCount: r.bodyCount, lastBody: r.lastBody,
    status: new Map(r.status), before: new Map(r.before),
    beforeBodies: new Map(r.beforeBodies.map(([fid, list]) => [fid, new Map(list.map(([id, b]) => [id, keep(b)]))])),
    tools: new Map(r.tools), planes: new Map(r.planes), axes: new Map(r.axes || []), points: new Map(r.points || []), sheets: new Map(r.sheets || []),
    sketches: new Map(r.sketches.map(([id, s]) => [id, { matrix: new THREE.Matrix4().fromArray(s.matrix), feature: s.feature }])),
  };
  for (const [id, m] of r.mbodies || []) {
    const k = `${id}|m${m.tok}|${m.name}|${m.feature}`, d = meshGeoms.get(m.tok); if (!d) continue;
    const rec = proxyPool.get(k) || { id, name: m.name, feature: m.feature, geom: d.geom, mesh: true, groups: d.groups, groupCount: m.groupCount, stats: m.stats };
    pool.set(k, rec); out.bodies.set(id, rec);
  }
  const live = new Set((r.mbodies || []).map(([, m]) => m.tok)); for (const t of meshGeoms.keys()) if (!live.has(t)) meshGeoms.delete(t);
  proxyPool = pool;
  return out;
}
function engineReset() { return engineCall('reset'); }
function brepFlat(body) { return engineCall('flat', { body }); }
const meshGeoms = new Map();   // mesh token -> { geom (non-indexed), groups }
function engineMeshFile(fileId, name, data, binary) { return engineCall('meshfile', { fileId, name, data, binary }); }
function brepSection(items, o) { return engineCall('section', { items: items.map(({ shape, place }) => ({ tok: shape, place })), ...o }); }
function brepProject(items, kinds, cams) { return engineCall('project', { items: items.map(({ id, shape, place }) => ({ id, tok: shape, place })), kinds, cams: cams || {} }); }
// STEP is parsed once; the solids are then kept in the engine's own format, so reopening or inserting skips parsing
async function brepImportSTEP(fileId, text) {
  const r = await engineCall('import', { fileId, text, wantBrep: true }); importsRead.add(fileId);
  if (r?.brep?.length) payloadSave('brep:' + fileId, r.brep);
  return r?.n ?? r;
}
async function brepImportCached(fileId, brep) { const n = await engineCall('importbrep', { fileId, brep }); importsRead.add(fileId); return n; }
async function cachedPayload(key) {
  if (payloadMap().has(key)) return payloadMap().get(key);
  try { const rec = await libTx('payloads', 'readonly', st => st ? st.get(key) : null); if (rec) { payloadMap().set(key, rec.v); return rec.v; } } catch (e) { }
  return null;
}
// results of inserted designs: load saved ones into the engine before a rebuild, keep new ones
const derivedLoaded = new Set();
async function loadDerivedResults(features) {
  for (const f of features) {
    if (f.type !== 'derive' || !f.resKey || derivedLoaded.has(f.resKey)) continue;
    derivedLoaded.add(f.resKey);
    const brep = await cachedPayload('res:' + f.resKey);
    if (brep?.length) { try { await engineCall('derivebrep', { key: f.resKey, brep }); } catch (e) { derivedLoaded.delete(f.resKey); } }
  }
}
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
  const d = shapeData.get(rec.shape); if (!d) return new Map();
  if (!d.p.fsig) { if (!sigQueue.includes(rec.shape)) sigQueue.unshift(rec.shape); pumpSigs(); return new Map(); }   // arriving in a moment
  const k = kind === 'face' ? 'fsig' : 'esig';
  return d[k + 'M'] || (d[k + 'M'] = unpackSigs(d.p[k]));
}
// signatures arrive packed (see enginehost.js packSigs); objects are made only when a body is first picked
function unpackSigs(P) {
  if (!P?.packed) return new Map(P || []);
  const out = new Map();
  for (let i = 0; i < P.h.length; i++) {
    const s = { type: P.types[P.t[i]] }; let o = i * P.width;
    for (const [k, len] of P.keys) { const v0 = P.d[o]; if (!Number.isNaN(v0)) s[k] = len === 1 ? v0 : Array.from(P.d.subarray(o, o + len)); o += len; }
    out.set(P.h[i], s);
  }
  return out;
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
