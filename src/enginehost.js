// Engine host: the exact kernel behind a message interface. The build wraps solver + kernel + brep + this file
// in one function (engineFactory) that runs inside a Web Worker, or on the page when workers are blocked.
// Everything that crosses the boundary is plain data: OCC shapes stay here and are named by integer tokens.
function engineHost(RCmod) {
  let cacheArr = [];
  const tokOf = new Map(), shapeOf = new Map(), shipped = new Set();
  let nextTok = 1;
  const tok = s => { if (!s) return 0; let t = tokOf.get(s); if (!t) { t = nextTok++; tokOf.set(s, t); shapeOf.set(t, s); } return t; };

  function meshPayload(t, full) {
    const rec = { shape: shapeOf.get(t) };
    if (!rec.shape) return null;
    const m = brepMeshOf(rec);
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
      p.fsig = [...brepSigMap(rec, 'face')];
      p.esig = [...brepSigMap(rec, 'edge')];
      const pr = brepProps(rec);
      p.props = { volume: pr.volume, area: pr.area, com: [pr.com.x, pr.com.y, pr.com.z] };
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
    brepCollect(cacheArr, res);
    const alive = aliveShapes(res), freed = [];
    for (const [t, s] of shapeOf) if (!alive.has(s)) { shapeOf.delete(t); tokOf.delete(s); shipped.delete(t); freed.push(t); }
    const pr = b => ({ id: b.id, name: b.name, feature: b.feature, shape: tok(b.shape) });
    const out = {
      bodies: [...res.bodies].map(([id, b]) => [id, pr(b)]),
      bodyCount: res.bodyCount, lastBody: res.lastBody,
      status: [...res.status], before: [...res.before],
      beforeBodies: [...res.beforeBodies].map(([fid, m]) => [fid, [...m].map(([id, b]) => [id, pr(b)])]),
      tools: [...res.tools].map(([fid, t]) => [fid, { ...t, shape: tok(t.shape) }]),
      planes: [...res.planes],
      sketches: [...res.sketches].map(([id, s]) => [id, { matrix: Array.from(s.matrix.elements), feature: s.feature }]),
      freed,
    };
    // bodies get their display mesh, signatures and mass properties right away; tool previews are fetched on demand
    const need = [];
    for (const [, b] of out.bodies) if (b.shape && !shipped.has(b.shape)) { shipped.add(b.shape); need.push(b.shape); }
    for (const [, list] of out.beforeBodies) for (const [, b] of list) if (b.shape && !shipped.has(b.shape)) { shipped.add(b.shape); need.push(b.shape); }
    out.meshes = need.map(t => meshPayload(t, true)).filter(Boolean);
    return out;
  }

  async function handle(op, a) {
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
      if (op === 'mesh') { const t = a.tok; const p = meshPayload(t, true); if (p) shipped.add(t); return p; }
      if (op === 'import') { const n = await brepImportSTEP(a.fileId, a.text); cacheArr = []; return n; }
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
      throw new Error('Unknown engine request ' + op);
    } catch (e) { throw new Error(occMsg(e)); }
  }
  // buffers that can move to the page without copying
  function transfers(r) {
    const out = [];
    const add = p => { if (p) for (const k of ['pos', 'nrm', 'idx', 'triFace', 'seg', 'segEdge']) if (p[k]?.buffer) out.push(p[k].buffer); };
    if (r?.meshes) r.meshes.forEach(add); else if (r?.tok) add(r);
    if (r instanceof Uint8Array) out.push(r.buffer);
    return out;
  }
  return { handle, transfers };
}
