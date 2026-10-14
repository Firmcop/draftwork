// ===== Exact (B-rep) kernel on OpenCascade via replicad =====
// Same feature model and output shape as the mesh kernel, plus fillet / chamfer / shell.
let RC = null;                          // replicad namespace once the engine has loaded
const brepTracked = new Set();          // every OCC shape this kernel created and may store
const T = s => { if (s) brepTracked.add(s); return s; };
function occMsg(e) {
  if (typeof e === 'number') return 'The geometry engine could not build this. Try different values.';
  const m = e?.message || String(e);
  return /^\d+$/.test(m) ? 'The geometry engine could not build this. Try different values.' : m;
}
function brepPlane(base, offset, flip, shift = 0) {
  const M = planeMatrix(base, offset, flip);
  const o = new THREE.Vector3().setFromMatrixPosition(M), u = new THREE.Vector3(1, 0, 0).transformDirection(M), n = new THREE.Vector3(0, 0, 1).transformDirection(M);
  o.add(n.clone().multiplyScalar(shift));
  return { plane: new RC.Plane([o.x, o.y, o.z], [u.x, u.y, u.z], [n.x, n.y, n.z]), o, u, v: new THREE.Vector3(0, 1, 0).transformDirection(M), n, M };
}
function placementInfo(f, out) {
  const p = resolvePlane(f.plane || 'XY', out);
  return { base: p.base, offset: p.offset + (+f.offset || 0), flip: !!f.flip !== !!p.flip };
}
// 2D profile -> replicad Drawing
function profileDrawing(pr) {
  const D = RC;
  const rot = +pr.rot || 0, cx = +pr.cx || 0, cy = +pr.cy || 0;
  let d;
  switch (pr.kind) {
    case 'rect': {
      const w = Math.abs(pr.w), h = Math.abs(pr.h), r = Math.max(0, Math.min(+pr.r || 0, w / 2 - 1e-3, h / 2 - 1e-3));
      if (!(w > 0 && h > 0)) throw new Error('Rectangle sides must be greater than 0');
      d = D.drawRoundedRectangle(w, h, r > 1e-3 ? r : 0);
      break;
    }
    case 'circle': if (!(Math.abs(pr.r) > 0)) throw new Error('Circle diameter must be greater than 0'); d = D.drawCircle(Math.abs(pr.r)); break;
    case 'slot': {
      const W = Math.abs(pr.width), r = W / 2, a = Math.max(0, Math.abs(pr.length) / 2 - r);
      if (!(W > 0)) throw new Error('Slot width must be greater than 0');
      d = a < 1e-4 ? D.drawCircle(r) : D.draw([-a, -r]).lineTo([a, -r]).threePointsArcTo([a, r], [a + r, 0]).lineTo([-a, r]).threePointsArcTo([-a, -r], [-a - r, 0]).close();
      break;
    }
    case 'loop': {
      const segs = pr.segs, n = segs.length;
      let pen = D.draw(segs[0].a);
      segs.forEach((sg, i) => {
        const end = i === n - 1 ? segs[0].a : sg.b;
        if (sg.t === 'arc') pen = pen.threePointsArcTo(end, arcMid(sg).mid);
        else if (i < n - 1) pen = pen.lineTo(end);
      });
      return pen.close();
    }
    case 'polygon': case 'poly': {
      const pts = profilePolygon(pr);
      let pen = D.draw([pts[0].x, pts[0].y]);
      for (let i = 1; i < pts.length; i++) pen = pen.lineTo([pts[i].x, pts[i].y]);
      return pen.close();          // already in sketch coordinates
    }
    default: throw new Error('Unknown profile type');
  }
  if (rot) d = d.rotate(rot, [0, 0]);
  return d.translate(cx, cy);
}
// Profiles nested inside others become holes; islands inside holes become solids again.
function sketchDrawing(profiles) {
  if (!profiles?.length) throw new Error('The sketch has no closed profiles');
  const { regions, polys } = buildRegions(profiles);
  let all = null;
  for (const r of regions) {
    let d = profileDrawing(profiles[r.index]);
    for (const hp of r.holes) { const k = polys.indexOf(hp); d = d.cut(profileDrawing(profiles[k])); }
    all = all ? all.fuse(d) : d;
  }
  return all;
}
const asSketches = s => s?.sketches ? s.sketches : [s];
function extrudeDrawing(drawing, pl, distance) {
  const sk = drawing.sketchOnPlane(pl);
  return T(sk.extrude(distance));
}
function revolveDrawing(drawing, pl, axisDir, origin, angle) {
  const sk = drawing.sketchOnPlane(pl);
  const parts = asSketches(sk);
  let res = null;
  for (const s of parts) { const r = s.revolve([axisDir.x, axisDir.y, axisDir.z], { origin: [origin.x, origin.y, origin.z], angle }); res = res ? T(res.fuse(r)) : r; }
  return T(res);
}

function brepTool(f, out) {
  switch (f.type) {
    case 'extrude': case 'revolve': {
      const sk = out.sketches.get(f.sketch);
      if (!sk) throw new Error('Choose a sketch that comes before this feature');
      const pi = placementInfo(sk.feature, out);
      const drawing = sketchDrawing(sk.feature.profiles);
      if (f.type === 'extrude') {
        const d = Math.abs(+f.distance); if (!(d > 0)) throw new Error('Distance must be greater than 0 mm');
        const shift = f.direction === 'reverse' ? -d : f.direction === 'symmetric' ? -d / 2 : 0;
        return extrudeDrawing(drawing, brepPlane(pi.base, pi.offset, pi.flip, shift).plane, d);
      }
      const ang = Math.min(360, Math.abs(+f.angle)); if (!(ang > 0)) throw new Error('Angle must be greater than 0°');
      const P = brepPlane(pi.base, pi.offset, pi.flip);
      return revolveDrawing(drawing, P.plane, f.axis === 'u' ? P.u : P.v, P.o, ang);
    }
    case 'box': case 'cylinder': {
      const pi = placementInfo(f, out), P = brepPlane(pi.base, pi.offset, pi.flip);
      const h = +f.h; if (!(h > 0)) throw new Error('Height must be greater than 0 mm');
      const d = f.type === 'box' ? (() => { if (!(+f.w > 0 && +f.d > 0)) throw new Error('Length and width must be greater than 0 mm'); return RC.drawRoundedRectangle(+f.w, +f.d, 0); })()
        : (() => { if (!(+f.diameter > 0)) throw new Error('Diameter must be greater than 0 mm'); return RC.drawCircle(+f.diameter / 2); })();
      return extrudeDrawing(d.translate(+f.cx || 0, +f.cy || 0), P.plane, h);
    }
    case 'sphere': {
      const pi = placementInfo(f, out), P = brepPlane(pi.base, pi.offset, pi.flip);
      const r = +f.diameter / 2; if (!(r > 0)) throw new Error('Diameter must be greater than 0 mm');
      const c = P.o.clone().add(P.u.clone().multiplyScalar(+f.cx || 0)).add(P.v.clone().multiplyScalar(+f.cy || 0));
      return T(RC.makeSphere(r).translate([c.x, c.y, c.z]));
    }
    case 'torus': case 'hole': {
      const pi = placementInfo(f, out), P = brepPlane(pi.base, pi.offset, pi.flip);
      const c = P.o.clone().add(P.u.clone().multiplyScalar(+f.cx || 0)).add(P.v.clone().multiplyScalar(+f.cy || 0));
      const nv = P.v.clone().negate();   // plane through the axis: local x = u, local y = normal
      const axisPlane = new RC.Plane([c.x, c.y, c.z], [P.u.x, P.u.y, P.u.z], [nv.x, nv.y, nv.z]);
      let d;
      if (f.type === 'torus') {
        const R = +f.major / 2, r = +f.minor / 2;
        if (!(R > 0 && r > 0)) throw new Error('Diameters must be greater than 0 mm');
        if (r >= R) throw new Error('Minor diameter must be smaller than the major diameter');
        d = RC.drawCircle(r).translate(R, 0);
      } else {
        const r = +f.diameter / 2, depth = +f.depth;
        if (!(r > 0)) throw new Error('Diameter must be greater than 0 mm');
        if (!(depth > 0)) throw new Error('Depth must be greater than 0 mm');
        const top = 0.01, pts = [[0, top]];
        if (f.cbore) {
          const R = +f.cbDiameter / 2, cd = +f.cbDepth;
          if (!(R > r)) throw new Error('Counterbore diameter must be larger than the hole diameter');
          if (!(cd > 0 && cd < depth)) throw new Error('Counterbore depth must be between 0 and the hole depth');
          pts.push([R, top], [R, -cd], [r, -cd]);
        } else pts.push([r, top]);
        pts.push([r, -depth]);
        if (f.tip !== false) pts.push([0, -depth - r / Math.tan(((+f.tipAngle || 118) / 2) * Math.PI / 180)]);
        else pts.push([0, -depth]);
        let pen = RC.draw(pts[0]); for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
        d = pen.close();
      }
      return revolveDrawing(d, axisPlane, P.n, c, 360);
    }
  }
  throw new Error('Unknown feature');
}

// ---- bodies ----
function bNew(out, id, shape, fid) { out.bodyCount++; out.bodies.set(id, { id, name: 'Body ' + out.bodyCount, shape, feature: fid }); out.lastBody = id; }
function bReplace(out, id, shape) {
  const b = out.bodies.get(id);
  let empty = false; try { empty = !shape || RC.measureVolume(shape) < 1e-9; } catch (e) { empty = false; }
  if (empty) { out.bodies.delete(id); if (out.lastBody === id) out.lastBody = [...out.bodies.keys()].pop() || null; return; }
  out.bodies.set(id, { id, name: b.name, shape, feature: b.feature });
}
function bTarget(out, target) {
  if (target && out.bodies.has(target)) return target;
  if (out.lastBody && out.bodies.has(out.lastBody)) return out.lastBody;
  return [...out.bodies.keys()].pop() || null;
}
function bboxOverlap(a, b) {
  try { const A = a.boundingBox, B = b.boundingBox; const [a0, a1] = A.bounds, [b0, b1] = B.bounds; return a0[0] <= b1[0] && a1[0] >= b0[0] && a0[1] <= b1[1] && a1[1] >= b0[1] && a0[2] <= b1[2] && a1[2] >= b0[2]; }
  catch (e) { return true; }
}
function bApply(out, f, tool, op, target, suffix = '') {
  if (op === 'new' || out.bodies.size === 0) {
    if ((op === 'cut' || op === 'intersect') && out.bodies.size === 0) throw new Error('There is no body to ' + op + ' yet. Use New Body first.');
    bNew(out, f.id + suffix, tool, f.id); return { op: 'new', target: f.id + suffix };
  }
  if (op === 'join') { const id = bTarget(out, target); bReplace(out, id, T(out.bodies.get(id).shape.fuse(tool))); out.lastBody = id; return { op, target: id }; }
  if (op === 'cut') {
    const ids = target && out.bodies.has(target) ? [target] : [...out.bodies.keys()];
    let hit = false;
    for (const id of ids) { const b = out.bodies.get(id); if (!bboxOverlap(b.shape, tool)) continue; hit = true; bReplace(out, id, T(b.shape.cut(tool))); }
    if (!hit) throw new Error('The cut does not touch any body');
    return { op, target: target || null };
  }
  if (op === 'intersect') { const id = bTarget(out, target); bReplace(out, id, T(out.bodies.get(id).shape.intersect(tool))); return { op, target: id }; }
  throw new Error('Unknown operation');
}
const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
function brepCopies(f, shape) {
  if (f.type === 'mirror') return [T(shape.clone().mirror(f.plane || 'YZ', [0, 0, 0]))];
  const count = Math.max(2, Math.min(50, Math.round(+f.count || 2))), out = [];
  if (f.kind === 'circular') {
    const total = Math.min(360, Math.abs(+f.angle || 360)), step = total >= 359.999 ? 360 / count : total / (count - 1);
    for (let i = 1; i < count; i++) out.push(T(shape.clone().rotate(step * i, [0, 0, 0], AX[f.axis] || AX.Z)));
  } else {
    const a1 = AX[f.axis] || AX.X, a2 = AX[f.axis2] || AX.Y, n2 = Math.max(1, Math.min(50, Math.round(+f.count2 || 1)));
    for (let j = 0; j < n2; j++) for (let i = 0; i < count; i++) {
      if (!i && !j) continue;
      const s1 = (+f.spacing || 0) * i, s2 = (+f.spacing2 || 0) * j;
      out.push(T(shape.clone().translate([a1[0] * s1 + a2[0] * s2, a1[1] * s1 + a2[1] * s2, a1[2] * s1 + a2[2] * s2])));
    }
  }
  return out;
}

// ---- persistent edge / face references (geometric signatures) ----
function edgeSig(e) { const p = e.pointAt(0.5); let len = 0; try { len = RC.measureLength(e); } catch (x) { } return { p: [p.x, p.y, p.z], len, type: e.geomType }; }
function faceSig(fc) { const c = fc.center; let n = [0, 0, 0]; try { const v = fc.normalAt(); n = [v.x, v.y, v.z]; } catch (x) { } return { c: [c.x, c.y, c.z], n, type: fc.geomType }; }
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// For each stored reference, find the closest current edge/face of the same kind (tolerates moderate upstream changes).
function matchRefs(items, refs, sigOf, key) {
  const sigs = items.map(sigOf), used = new Set(), hashes = new Set();
  for (const r of refs) {
    let best = -1, bestD = Infinity;
    sigs.forEach((s, i) => {
      if (used.has(i) || (r.type && s.type !== r.type)) return;
      let d = d3(s[key], r[key]);
      if (key === 'p') d += Math.abs((s.len || 0) - (r.len || 0)) * 0.5; else d += d3(s.n, r.n) * 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    const tol = key === 'p' ? Math.max(0.6, (r.len || 0) * 0.2) : 1.5;
    if (best >= 0 && bestD <= tol) { used.add(best); hashes.add(items[best].hashCode); }
  }
  return hashes;
}
function edgeFeature(f, out) {
  const refs = f.edges || [];
  const faces = FACE_PICK.has(f.type);
  if (!refs.length) throw new Error(f.type === 'shell' ? 'Click the faces to remove on the model' : f.type === 'draft' ? 'Click the faces to taper on the model' : 'Click the edges to round on the model');
  const amount = f.type === 'fillet' ? +f.radius : f.type === 'chamfer' ? +f.distance : f.type === 'draft' ? +f.angle : +f.thickness;
  if (f.type === 'draft') { if (!(Math.abs(amount) > 0 && Math.abs(amount) < 60)) throw new Error('Draft angle must be between 0° and 60°'); }
  else if (!(amount > 0)) throw new Error((f.type === 'shell' ? 'Thickness' : f.type === 'fillet' ? 'Radius' : 'Distance') + ' must be greater than 0 mm');
  let neutral = null;
  if (f.type === 'draft') { const pi = resolvePlane(f.neutral || 'XY', out); neutral = brepPlane(pi.base, pi.offset + (+f.neutralOffset || 0), pi.flip).plane; }
  let matched = 0;
  for (const [id, b] of [...out.bodies]) {
    if (f.body && f.body !== id) continue;
    if (faces) {
      const list = b.shape.faces;
      const hs = matchRefs(list, refs, faceSig, 'c');
      list.forEach(x => x.delete?.());
      if (!hs.size) continue;
      matched += hs.size;
      const pickFn = fi => fi.when(({ element }) => hs.has(element.hashCode));
      bReplace(out, id, T(f.type === 'draft' ? b.shape.clone().draft(amount * (f.flipPull ? -1 : 1), pickFn, neutral) : b.shape.clone().shell(amount, pickFn)));
    } else {
      const edges = b.shape.edges;
      const hs = matchRefs(edges, refs, edgeSig, 'p');
      edges.forEach(x => x.delete?.());
      if (!hs.size) continue;
      matched += hs.size;
      const fn = e => hs.has(e.hashCode) ? amount : null;
      bReplace(out, id, T(f.type === 'fillet' ? b.shape.clone().fillet(fn) : b.shape.clone().chamfer(fn)));
    }
  }
  if (!matched) throw new Error('The picked ' + (faces ? 'faces' : 'edges') + ' no longer exist. Edit this feature and pick them again.');
  return matched;
}

function brepClone(o) {
  return { bodies: new Map(o.bodies), bodyCount: o.bodyCount, lastBody: o.lastBody, sketches: new Map(o.sketches), planes: new Map(o.planes),
    status: new Map(o.status), tools: new Map(o.tools), before: new Map(o.before), beforeBodies: new Map(o.beforeBodies) };
}
function regenerateBrep(features, upto = null, cache = null) {
  let out = { bodies: new Map(), bodyCount: 0, lastBody: null, sketches: new Map(), planes: new Map(), status: new Map(), tools: new Map(), before: new Map(), beforeBodies: new Map() };
  const end = upto == null ? features.length : Math.min(upto + 1, features.length);
  let key = '', reuse = !!cache;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (i >= end) { out.status.set(f.id, { state: 'rolled' }); continue; }
    key += '|' + JSON.stringify(f);
    if (reuse && cache[i] && cache[i].key === key) { out = brepClone(cache[i].out); continue; }
    reuse = false;
    brepStep(f, out);
    if (cache) { cache[i] = { key, out: brepClone(out) }; cache.length = i + 1; }
  }
  return out;
}
const EDGE_TYPES = new Set(['fillet', 'chamfer', 'shell', 'draft']);
const FACE_PICK = new Set(['shell', 'draft']);
// Imported STEP shapes, parsed once per file (async) and reused by every rebuild: fileId -> Shape3D[]
const importShapes = new Map();
function brepStep(f, out) {
  out.before.set(f.id, [...out.bodies.keys()]);
  if (EDGE_TYPES.has(f.type)) out.beforeBodies.set(f.id, new Map(out.bodies));
  if (f.suppressed) { out.status.set(f.id, { state: 'suppressed' }); return; }
  try {
    if (f.error) throw new Error(f.error);
    if (f.type === 'plane') {
      const p = resolvePlane(f.base || 'XY', out);
      out.planes.set(f.id, { base: p.base, offset: p.offset + (+f.offset || 0), flip: !!p.flip !== !!f.flip });
    } else if (f.type === 'sketch') {
      const pi = placementInfo(f, out);
      out.sketches.set(f.id, { matrix: planeMatrix(pi.base, pi.offset, pi.flip), feature: sketchWithGeo(f) });
    } else if (['extrude', 'revolve', 'box', 'cylinder', 'sphere', 'torus', 'hole'].includes(f.type)) {
      const op = f.type === 'hole' ? 'cut' : (f.op || 'join');
      const tool = brepTool(f, out);
      const res = bApply(out, f, tool, op, f.target);
      out.tools.set(f.id, { shape: tool, ...res, op });
    } else if (f.type === 'loft') {
      const ids = (f.sketches || []).filter(id => out.sketches.has(id));
      if (ids.length < 2) throw new Error('Choose at least two sketches to loft between');
      const parts = ids.map(id => {
        const sk = out.sketches.get(id), pi = placementInfo(sk.feature, out);
        const { regions } = buildRegions(sk.feature.profiles || []);
        if (regions.length !== 1) throw new Error(`${sk.feature.name || 'A sketch'} needs exactly one closed profile for a loft`);
        const s = profileDrawing(sk.feature.profiles[regions[0].index]).sketchOnPlane(brepPlane(pi.base, pi.offset, pi.flip).plane);
        return asSketches(s)[0];
      });
      const tool = T(parts[0].loftWith(parts.slice(1), { ruled: !!f.ruled }));
      const res = bApply(out, f, tool, f.op || 'new', f.target);
      out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'new' });
    } else if (f.type === 'import') {
      const shapes = importShapes.get(f.file);
      if (!shapes) throw new Error(f.file ? 'Reading the imported file…' : 'The imported file is missing');
      if (!shapes.length) throw new Error('The file has no solid bodies');
      shapes.forEach((s, k) => bNew(out, f.id + (k ? ':' + k : ''), T(s.clone()), f.id));
    } else if (f.type === 'pattern' || f.type === 'mirror') {
      const src = out.tools.get(f.source);
      if (!src) throw new Error('Choose a feature that comes before this one');
      const copies = brepCopies(f, src.shape);
      if (src.op === 'new') {
        copies.forEach((s, k) => bApply(out, f, s, 'new', null, ':' + (k + 1)));
        out.tools.set(f.id, { shape: copies.length > 1 ? T(RC.makeCompound(copies.map(c => c.clone()))) : copies[0], op: 'new' });
      } else {
        let tool = copies[0];
        for (let k = 1; k < copies.length; k++) tool = T(tool.fuse(copies[k]));
        const res = bApply(out, f, tool, src.op, src.target);
        out.tools.set(f.id, { shape: tool, ...res, op: src.op });
      }
    } else if (f.type === 'move') {
      const b = out.bodies.get(f.body);
      if (!b) throw new Error('Choose a body to move');
      let s = b.shape.clone();
      if (+f.rz) s = s.rotate(+f.rz, [0, 0, 0], [0, 0, 1]);
      if (+f.ry) s = s.rotate(+f.ry, [0, 0, 0], [0, 1, 0]);
      if (+f.rx) s = s.rotate(+f.rx, [0, 0, 0], [1, 0, 0]);
      if (+f.dx || +f.dy || +f.dz) s = s.translate([+f.dx || 0, +f.dy || 0, +f.dz || 0]);
      T(s);
      if (f.copy) bNew(out, f.id, s, f.id); else bReplace(out, b.id, s);
    } else if (f.type === 'combine') {
      const t = out.bodies.get(f.target);
      if (!t) throw new Error('Choose a target body');
      const tools = (f.tools || []).filter(id => id !== f.target && out.bodies.has(id));
      if (!tools.length) throw new Error('Choose at least one tool body');
      let s = t.shape;
      for (const id of tools) { const o = out.bodies.get(id).shape; s = T(f.op === 'cut' ? s.cut(o) : f.op === 'intersect' ? s.intersect(o) : s.fuse(o)); }
      bReplace(out, t.id, s);
      if (!f.keep) for (const id of tools) out.bodies.delete(id);
    } else if (f.type === 'remove') {
      if (!out.bodies.has(f.body)) throw new Error('Choose a body to remove');
      out.bodies.delete(f.body);
    } else if (EDGE_TYPES.has(f.type)) {
      edgeFeature(f, out);
    }
    out.status.set(f.id, { state: 'ok' });
  } catch (e) {
    out.status.set(f.id, { state: 'error', msg: occMsg(e) });
  }
}
// Frees OCC shapes that no cached step or current result still uses.
function brepCollect(cacheArr, res) {
  const alive = new Set();
  const addOut = o => { if (!o) return; for (const b of o.bodies.values()) alive.add(b.shape); for (const t of o.tools.values()) alive.add(t.shape); for (const m of (o.beforeBodies || new Map()).values()) for (const b of m.values()) alive.add(b.shape); };
  for (const c of cacheArr) addOut(c?.out);
  addOut(res);
  let freed = 0;
  for (const s of brepTracked) if (!alive.has(s)) { try { s.delete(); } catch (e) { } brepTracked.delete(s); freed++; }
  return freed;
}

// ---- display meshes for B-rep shapes (computed lazily, cached on the record) ----
function brepMeshOf(rec) {
  if (rec._mesh) return rec._mesh;
  const s = rec.shape;
  let size = 100; try { const [a, b] = s.boundingBox.bounds; size = Math.max(b[0] - a[0], b[1] - a[1], b[2] - a[2]); } catch (e) { }
  const tol = Math.min(0.1, Math.max(0.01, size / 2000)), opts = { tolerance: tol, angularTolerance: 0.25 };
  const m = s.mesh(opts), em = s.meshEdges(opts);
  const display = new THREE.BufferGeometry();
  display.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3));
  display.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  display.setIndex(m.triangles);
  const triFace = new Float64Array(m.triangles.length / 3);
  for (const g of m.faceGroups) for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) triFace[t] = g.faceId;
  const seg = [], segEdge = [];
  for (const g of em.edgeGroups) {
    for (let k = 0; k < g.count - 1; k++) {
      const a = (g.start + k) * 3, b = a + 3;
      seg.push(em.lines[a], em.lines[a + 1], em.lines[a + 2], em.lines[b], em.lines[b + 1], em.lines[b + 2]);
      segEdge.push(g.edgeId);
    }
  }
  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  rec._mesh = { display, triFace, edgeGeom, segEdge, edgeGroups: em.edgeGroups, lines: em.lines };
  return rec._mesh;
}
function brepGeomNI(rec) { return rec._ni || (rec._ni = brepMeshOf(rec).display.toNonIndexed()); }
function brepProps(rec) {
  if (rec._props) return rec._props;
  let volume = 0, area = 0, com = new THREE.Vector3();
  try { const vp = RC.measureShapeVolumeProperties(rec.shape); volume = vp.volume; const c = vp.centerOfMass; com.set(c[0], c[1], c[2]); vp.delete?.(); } catch (e) { }
  try { area = RC.measureArea(rec.shape); } catch (e) { }
  return (rec._props = { volume: Math.abs(volume), area, com });
}
// Look up an edge or face of a body by the hash used in its mesh groups and return its signature.
function brepEdgeRef(rec, hash) { const es = rec.shape.edges; const e = es.find(x => x.hashCode === hash); const s = e ? edgeSig(e) : null; es.forEach(x => x.delete?.()); return s; }
function brepFaceRef(rec, hash) { const fs = rec.shape.faces; const f = fs.find(x => x.hashCode === hash); const s = f ? faceSig(f) : null; fs.forEach(x => x.delete?.()); return s; }
function brepSTEP(items) { return RC.exportSTEP(items.map(({ shape, name, color }) => ({ shape, name, color }))); }

function brepSigMap(rec, kind) {
  const k = kind === 'face' ? '_fsig' : '_esig';
  if (rec[k]) return rec[k];
  const items = kind === 'face' ? rec.shape.faces : rec.shape.edges;
  const m = new Map(items.map(x => [x.hashCode, kind === 'face' ? faceSig(x) : edgeSig(x)]));
  items.forEach(x => x.delete?.());
  return (rec[k] = m);
}
function brepRefHashes(rec, refs, kind) {
  if (!refs?.length) return new Set();
  const m = brepSigMap(rec, kind), hashes = [...m.keys()];
  const fake = hashes.map(hc => ({ hashCode: hc }));
  return matchRefs(fake, refs, x => m.get(x.hashCode), kind === 'face' ? 'c' : 'p');
}

// Parses STEP text into solids (async, done once per file before rebuilds use it).
async function brepImportSTEP(fileId, text) {
  const shape = await RC.importSTEP(new Blob([text]));
  let solids = [];
  try { solids = shape.solids || []; } catch (e) { solids = []; }
  if (!solids.length && shape) solids = [shape];
  importShapes.set(fileId, solids);
  return solids.length;
}
