// Engine host: the exact kernel behind a message interface. The build wraps solver + kernel + brep + this file
// in one function (engineFactory) that runs inside a Web Worker, or on the page when workers are blocked.
// Everything that crosses the boundary is plain data: OCC shapes stay here and are named by integer tokens.
// Outline of a planar face seen square-on in a standard view, as one SVG path (one closed loop per wire), in the
// same page coordinates the projections use: front (X, −Z), top (X, −Y), right (Y, −Z).
const VIEW_MAP = { front: p => [p[0], -p[2]], top: p => [p[0], -p[1]], right: p => [p[1], -p[2]], left: p => [-p[1], -p[2]], back: p => [-p[0], -p[2]], bottom: p => [p[0], p[1]] };
// axes of cylindrical faces, as 2D segments in a view (skipped when the axis points at the viewer)
function axesOf(shapes, map) {
  const out = [], seen = new Set();
  for (const sh of shapes) for (const fc of sh.faces) {
    try {
      if (fc.geomType !== 'CYLINDRE') continue;
      const sig = faceSig(fc); if (!sig.ax || !sig.ap) continue;
      const ax = sig.ax, ap = sig.ap, [lo, hi] = fc.boundingBox.bounds;
      let t0 = Infinity, t1 = -Infinity;
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) { const t = (x - ap[0]) * ax[0] + (y - ap[1]) * ax[1] + (z - ap[2]) * ax[2]; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
      const A = map(ap.map((v, i) => v + ax[i] * t0)), B = map(ap.map((v, i) => v + ax[i] * t1));
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1e-6) continue;
      const k = [A, B].map(p => p.map(v => v.toFixed(3)).join(',')).sort().join('|'); if (seen.has(k)) continue; seen.add(k);
      out.push([A[0], A[1], B[0], B[1], sig.r || 0]);
    } finally { fc.delete?.(); }
  }
  return out;
}
function faceOutline(face, kind) {
  const map = VIEW_MAP[kind], wires = [face.clone().outerWire(), ...face.clone().innerWires()];   // both consume the face they are called on
  let d = '';
  for (const w of wires) {
    const segs = w.edges.map(e => { const n = e.geomType === 'LINE' ? 1 : 32, seg = []; for (let i = 0; i <= n; i++) { const v = e.pointAt(i / n); seg.push(map([v.x, v.y, v.z])); } return seg; });
    // chain edges by matching end points (wires do not promise order or direction)
    const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5;
    let pts = segs.shift() || [];
    while (segs.length) {
      const end = pts[pts.length - 1];
      let k = segs.findIndex(sg => close(sg[0], end) || close(sg[sg.length - 1], end));
      if (k < 0) { pts.reverse(); k = segs.findIndex(sg => close(sg[0], pts[pts.length - 1]) || close(sg[sg.length - 1], pts[pts.length - 1])); if (k < 0) break; }
      let sg = segs.splice(k, 1)[0]; if (!close(sg[0], pts[pts.length - 1])) sg = sg.reverse();
      pts.push(...sg.slice(1));
    }
    if (pts.length > 2) d += 'M ' + pts.map(p => p[0].toFixed(4) + ' ' + p[1].toFixed(4)).join(' L ') + ' Z ';
  }
  return d.trim();
}
// Face and edge signatures cross to the page as packed numbers (one row per face / edge), not thousands of objects:
// copying objects between threads blocked the page for over a second on big imports.
const FACE_SIG_KEYS = [['c', 3], ['n', 3], ['ax', 3], ['ap', 3], ['r', 1]];
const EDGE_SIG_KEYS = [['p', 3], ['len', 1], ['a', 3], ['b', 3], ['cc', 3], ['ax', 3]];
function packSigs(map, keys) {
  const width = keys.reduce((a, [, n]) => a + n, 0), n = map.size, h = new Float64Array(n), d = new Float64Array(n * width).fill(NaN), t = new Uint8Array(n), types = [];
  let i = 0;
  for (const [hash, s] of map) {
    h[i] = hash; let ti = types.indexOf(s.type); if (ti < 0) { ti = types.length; types.push(s.type); } t[i] = ti;
    let o = i * width;
    for (const [k, len] of keys) { const v = s[k]; if (v != null) { if (len === 1) d[o] = v; else for (let j = 0; j < len; j++) d[o + j] = v[j]; } o += len; }
    i++;
  }
  return { packed: true, keys, width, h, d, t, types };
}
const TRUE_VIEW = { front: 'front', back: 'back', top: 'bottom', bottom: 'top', right: 'left', left: 'right' };
function engineHost(RCmod) {
  let cacheArr = [];
  const tokOf = new Map(), shapeOf = new Map(), shipped = new Set();
  let nextTok = 1, lastRes = null, nextMTok = 1;
  const mTokOf = new WeakMap(), mStatOf = new WeakMap(), mShipped = new Set();
  const mtok = m => { let t = mTokOf.get(m); if (!t) { t = nextMTok++; mTokOf.set(m, t); } return t; };
  const mstat = m => { let s = mStatOf.get(m); if (!s) { s = { ...meshStats(m), volume: meshVolume(m) }; mStatOf.set(m, s); } return s; };
  const tok = s => { if (!s) return 0; let t = tokOf.get(s); if (!t) { t = nextTok++; tokOf.set(s, t); shapeOf.set(t, s); } return t; };

  function meshPayload(t, full) {
    const rec = { shape: shapeOf.get(t) };
    if (!rec.shape) return null;
    let t1 = performance.now();
    const m = brepMeshOf(rec);
    tAdd('mesh', performance.now() - t1);
    const idx = m.display.index.array;
    const p = {
      tok: t,
      pos: Float32Array.from(m.display.attributes.position.array),
      nrm: Float32Array.from(m.display.attributes.normal.array),
      idx: idx instanceof Uint32Array ? idx.slice() : Uint32Array.from(idx),
      triFace: Float64Array.from(m.triFace),
      seg: Float32Array.from(m.edgeGeom.attributes.position.array),
      segEdge: Float64Array.from(m.segEdge),
    };
    if (full) {
      t1 = performance.now();
      const pr = brepProps(rec);
      tAdd('props', performance.now() - t1);
      p.props = { volume: pr.volume, area: pr.area, com: [pr.com.x, pr.com.y, pr.com.z], surface: pr.surface };
    }
    m.display.dispose?.(); m.edgeGeom.dispose?.();
    return p;
  }

  function aliveShapes(res) {
    const alive = new Set();
    const addOut = o => { if (!o) return; for (const b of o.bodies.values()) alive.add(b.shape); for (const t of o.tools.values()) alive.add(t.shape); for (const m of (o.beforeBodies || new Map()).values()) for (const b of m.values()) alive.add(b.shape); };
    for (const c of cacheArr) addOut(c?.out);
    addOut(res);
    return alive;
  }

  function regen({ features, rollback }) {
    const res = regenerateBrep(features, rollback, cacheArr);
    lastRes = res;
    brepCollect(cacheArr, res);
    const alive = aliveShapes(res), freed = [];
    for (const [t, s] of shapeOf) if (!alive.has(s)) { shapeOf.delete(t); tokOf.delete(s); shipped.delete(t); freed.push(t); }
    const pr = b => ({ id: b.id, name: b.name, feature: b.feature, shape: tok(b.shape), surface: !!b.surface });
    const out = {
      bodies: [...res.bodies].map(([id, b]) => [id, pr(b)]),
      bodyCount: res.bodyCount, lastBody: res.lastBody,
      status: [...res.status], before: [...res.before],
      beforeBodies: [...res.beforeBodies].map(([fid, m]) => [fid, [...m].map(([id, b]) => [id, pr(b)])]),
      tools: [...res.tools].map(([fid, t]) => [fid, { ...t, shape: tok(t.shape) }]),
      planes: [...res.planes], axes: [...res.axes], points: [...res.points],
      mbodies: [...res.mbodies].map(([id, m]) => [id, { name: m.name, feature: m.feature, tok: mtok(m), stats: mstat(m), groupCount: m.groupCount || 0 }]),
      sheets: [...res.sheet].filter(([id]) => res.bodies.has(id)).map(([id, r]) => [id, { t: r.t, R: r.R, k: r.k, unfolded: !!r.unfolded }]),
      sketches: [...res.sketches].map(([id, s]) => [id, { matrix: Array.from(s.matrix.elements), feature: s.feature }]),
      freed, derived: res.derivedNew || [],
    };
    // bodies get their display mesh, signatures and mass properties right away; tool previews are fetched on demand
    const need = [];
    for (const [, b] of out.bodies) if (b.shape && !shipped.has(b.shape)) { shipped.add(b.shape); need.push(b.shape); }
    for (const [, list] of out.beforeBodies) for (const [, b] of list) if (b.shape && !shipped.has(b.shape)) { shipped.add(b.shape); need.push(b.shape); }
    out.meshes = need.map((t, k) => { if (need.length > 3) brepProgress({ stage: 'view', done: k, total: need.length }); return meshPayload(t, true); }).filter(Boolean);
    out.meshData = [];
    const live = new Set();
    for (const [, m] of res.mbodies) { const t = mtok(m); live.add(t); if (mShipped.has(t)) continue; out.meshData.push([t, m.pos, m.idx, m.groups || null]); }
    mShipped.clear(); live.forEach(t => mShipped.add(t));   // the page keeps exactly the live meshes
    return out;
  }

  // time spent per operation (and inside them: meshing, signatures), read with the 'timings' op
  const timing = {}, tAdd = (k, ms) => { timing[k] = (timing[k] || 0) + ms; };
  async function handle(op, a) {
    if (op === 'timings') { const t = { ...timing }; for (const k in timing) delete timing[k]; return t; }
    const t0 = performance.now();
    try { return await handleOp(op, a); } finally { tAdd(op, performance.now() - t0); }
  }
  async function handleOp(op, a) {
    try {
      if (op === 'init') {
        const glue = await import(a.urls.occ);
        const res = await fetch(a.wasm);
        if (!res.ok) throw new Error('engine file missing (' + res.status + ')');
        let buf = new Uint8Array(await res.arrayBuffer());
        if (buf[0] === 0x1f && buf[1] === 0x8b) {
          if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot unpack the engine');
          buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        }
        const oc = await glue.default({ wasmBinary: buf.buffer });
        RCmod.setOC(oc); RC = RCmod;
        return { ok: true };
      }
      if (op === 'regen') return regen(a);
      if (op === 'reset') { cacheArr = []; return true; }
      if (op === 'meshfile') { const bin = a.binary ? Uint8Array.from(atob(a.data), c => c.charCodeAt(0)) : null; importMeshes.set(a.fileId, /\.obj$/i.test(a.name) ? parseOBJ(a.data) : parseSTL(bin || new TextEncoder().encode(a.data))); cacheArr = []; return importMeshes.get(a.fileId).idx.length / 3; }
      if (op === 'flat') { const r = lastRes?.sheet.get(a.body); return r ? sheetFlatData(r) : null; }
      if (op === 'mesh') { const t = a.tok; const p = meshPayload(t, true); if (p) shipped.add(t); return p; }
      if (op === 'import') brepProgress({ stage: 'import' });
      if (op === 'import') { const n = await brepImportSTEP(a.fileId, a.text); cacheArr = []; return a.wantBrep ? { n, brep: (importShapes.get(a.fileId) || []).map(s => s.serialize()) } : n; }
      // cached geometry: an import or an inserted design's result, in the engine's own format (no STEP parsing, no rebuild)
      if (op === 'importbrep') brepProgress({ stage: 'cache' });
      if (op === 'importbrep') { importShapes.set(a.fileId, a.brep.map(s => RC.deserializeShape(s))); cacheArr = []; return a.brep.length; }
      if (op === 'derivebrep') brepProgress({ stage: 'cache' });
      if (op === 'derivebrep') { deriveShapes.set(a.key, a.brep.map(s => RC.deserializeShape(s))); return a.brep.length; }
      if (op === 'derived') return a.keys.map(k => [k, (deriveShapes.get(k) || []).map(s => s.serialize())]);
      if (op === 'serialize') return a.toks.map(t => shapeOf.get(t)?.serialize() || null);
      if (op === 'sigs') { const rec = { shape: shapeOf.get(a.tok) }; if (!rec.shape) return null; let t1 = performance.now(); const r = { fsig: packSigs(brepSigMap(rec, 'face'), FACE_SIG_KEYS), esig: packSigs(brepSigMap(rec, 'edge'), EDGE_SIG_KEYS) }; tAdd('signatures', performance.now() - t1); return r; }
      if (op === 'step') {
        if (a.items.some(x => !shapeOf.get(x.tok))) throw new Error('That body is no longer available. Try again after the rebuild.');
        const temp = [];
        const items = a.items.map(x => {
          let shape = shapeOf.get(x.tok);
          if (x.place) {   // assembled position of a jointed component
            shape = shape.clone();
            if (x.place.angle > 1e-9) shape = shape.rotate(x.place.angle, [0, 0, 0], x.place.axis);
            shape = shape.translate(x.place.move); temp.push(shape);
          }
          return { shape, name: x.name, color: x.color };
        });
        try { return new Uint8Array(await brepSTEP(items).arrayBuffer()); } finally { temp.forEach(t => t.delete?.()); }
      }
      if (op === 'project') {
        // 2D drawing views with exact hidden-line removal: SVG paths (y down, model millimeters) per view kind
        const temp = [];
        const ids = [];
        const shapes = a.items.map(x => {
          let sh = shapeOf.get(x.tok); if (!sh) return null;
          sh = sh.clone();
          if (x.place) { if (x.place.angle > 1e-9) sh = sh.rotate(x.place.angle, [0, 0, 0], x.place.axis); sh = sh.translate(x.place.move); }
          temp.push(sh); ids.push(x.id); return sh;
        }).filter(Boolean);
        if (!shapes.length) return {};
        const all = shapes.length === 1 ? shapes[0] : RC.makeCompound(shapes.map(x => x.clone()));
        if (shapes.length > 1) temp.push(all);
        const flat = p => (Array.isArray(p) ? p.flat(2) : []).filter(x => typeof x === 'string' && x.trim());
        const out = {};
        try {
          for (const kind of a.kinds) {
            // replicad names views by the direction it looks along and its camera direction points toward the viewer,
            // so the true top view (X right, Y up) is its 'bottom', the true right view (Y right, Z up) its 'left'
            // auxiliary views: a camera direction (toward the viewer) and an x axis given by the page
            const aux = kind.startsWith('aux:') ? a.cams?.[kind] : null;
            const cam = aux ? new RC.ProjectionCamera([0, 0, 0], aux.dir, aux.x) : kind === 'iso' ? new RC.ProjectionCamera([0, 0, 0], [1, -1, 1], [1, 1, 0]) : (TRUE_VIEW[kind] || kind);
            const { visible, hidden } = RC.drawProjection(all, cam);
            let bb = null; try { bb = visible.boundingBox.bounds; } catch (e) { }
            out[kind] = { vis: flat(visible.toSVGPaths()), hid: flat(hidden.toSVGPaths()), bbox: bb };
            const map = VIEW_MAP[kind];
            if (map) {
              // per-body extents (for balloons) and hole / shaft axes seen from the side (for centrelines), in view coordinates
              out[kind].boxes = shapes.map((sh, k) => { const [lo, hi] = sh.boundingBox.bounds, P = []; for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) P.push(map([x, y, z])); return { id: ids[k], b: [Math.min(...P.map(p => p[0])), Math.min(...P.map(p => p[1])), Math.max(...P.map(p => p[0])), Math.max(...P.map(p => p[1]))] }; });
              out[kind].axes = axesOf(shapes, map);
            }
          }
        } finally { temp.forEach(t => t.delete?.()); }
        return out;
      }
      if (op === 'interfere') {
        // pairwise overlap volumes between solids (in their assembled positions), with a display mesh of each overlap
        const temp = [], items = a.items.map(x => {
          let sh = shapeOf.get(x.tok); if (!sh) return null;
          if (x.place) { sh = sh.clone(); if (x.place.angle > 1e-9) sh = sh.rotate(x.place.angle, [0, 0, 0], x.place.axis); sh = sh.translate(x.place.move); temp.push(sh); }
          return { id: x.id, sh };
        }).filter(Boolean);
        const res = [];
        try {
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            if (!bboxOverlap(items[i].sh, items[j].sh)) continue;
            let inter; try { inter = items[i].sh.clone().intersect(items[j].sh.clone()); } catch (e) { continue; }
            temp.push(inter);
            let v = 0; try { v = RC.measureVolume(inter); } catch (e) { }
            if (!(v > 1e-6)) continue;
            const m = brepMeshOf({ shape: inter }), ni = m.display.toNonIndexed();
            res.push({ a: items[i].id, b: items[j].id, volume: v, pos: Float32Array.from(ni.attributes.position.array) });
          }
        } finally { temp.forEach(t => t.delete?.()); }
        return res;
      }
      if (op === 'section') {
        // Section view: remove the material between the viewer and the cutting plane, project the rest, and return
        // the outlines of the faces lying on the plane (to be hatched).
        const temp = [], ax = { X: 0, Y: 1, Z: 2 }[a.axis];
        const shapes = a.items.map(x => {
          let sh = shapeOf.get(x.tok); if (!sh) return null;
          sh = sh.clone();
          if (x.place) { if (x.place.angle > 1e-9) sh = sh.rotate(x.place.angle, [0, 0, 0], x.place.axis); sh = sh.translate(x.place.move); }
          temp.push(sh); return sh;
        }).filter(Boolean);
        if (!shapes.length) return null;
        try {
          let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
          for (const sh of shapes) { const [b0, b1] = sh.boundingBox.bounds; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b0[i]); hi[i] = Math.max(hi[i], b1[i]); } }
          lo = lo.map(v => v - 10); hi = hi.map(v => v + 10);
          const c0 = [...lo], c1 = [...hi];
          if (a.removeAbove) c0[ax] = a.value; else c1[ax] = a.value;
          const cuts = [];
          for (const sh of shapes) { const box = RC.makeBox(c0, c1); temp.push(box); let r; try { r = sh.cut(box); } catch (e) { continue; } temp.push(r); if (RC.measureVolume(r) > 1e-9) cuts.push(r); }
          if (!cuts.length) return { vis: [], hid: [], bbox: null, cut: [] };
          const all = cuts.length === 1 ? cuts[0] : RC.makeCompound(cuts.map(x => x.clone())); if (cuts.length > 1) temp.push(all);
          const cam = TRUE_VIEW[a.kind] || a.kind, flat = p => (Array.isArray(p) ? p.flat(2) : []).filter(x => typeof x === 'string' && x.trim());
          const { visible, hidden } = RC.drawProjection(all, cam);
          let bb = null; try { bb = visible.boundingBox.bounds; } catch (e) { }
          const cut = [];
          for (const r of cuts) for (const f of r.faces) {
            try {
              if (f.geomType !== 'PLANE') continue;
              const c = f.center, n = f.normalAt(), cv = [c.x, c.y, c.z][ax], nv = [n.x, n.y, n.z], l = Math.hypot(...nv);
              if (Math.abs(cv - a.value) < 1e-5 && Math.abs(Math.abs(nv[ax]) / (l || 1) - 1) < 1e-6) cut.push(faceOutline(f, a.kind));
            } catch (e) { }
          }
          return { vis: flat(visible.toSVGPaths()), hid: flat(hidden.toSVGPaths()), bbox: bb, cut };
        } finally { temp.forEach(t => t.delete?.()); }
      }
      throw new Error('Unknown engine request ' + op);
    } catch (e) { throw new Error(occMsg(e)); }
  }
  // buffers that can move to the page without copying
  function transfers(r) {
    const out = [];
    const add = p => { if (!p) return; for (const k of ['pos', 'nrm', 'idx', 'triFace', 'seg', 'segEdge']) if (p[k]?.buffer) out.push(p[k].buffer); for (const s of [p.fsig, p.esig]) if (s?.packed) out.push(s.h.buffer, s.d.buffer, s.t.buffer); };
    if (r?.meshes) r.meshes.forEach(add); else if (r?.tok) add(r);
    if (r instanceof Uint8Array) out.push(r.buffer);
    if (r?.fsig?.packed) for (const s of [r.fsig, r.esig]) out.push(s.h.buffer, s.d.buffer, s.t.buffer);
    return out;
  }
  return { handle, transfers };
}
