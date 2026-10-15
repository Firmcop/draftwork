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
    else if (sg.t === 'bez') pen = pen.cubicBezierCurveTo(end, sg.P[1], sg.P[2]);
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
function loopDrawing(segs) {
  const n = segs.length;
  let pen = RC.draw(segs[0].a);
  segs.forEach((sg, i) => {
    const end = i === n - 1 ? segs[0].a : sg.b;
    if (sg.t === 'arc') pen = pen.threePointsArcTo(end, arcMid(sg).mid);
    else if (sg.t === 'bez') pen = pen.cubicBezierCurveTo(end, sg.P[1], sg.P[2]);
    else if (i < n - 1) pen = pen.lineTo(end);
  });
  return pen.close();
}
// Legacy profiles (nested ones become holes, islands fuse back) + picked regions, as one drawing.
function sketchDrawing(sk, refs) {
  const use = sketchUse(sk, refs);
  const parts = [];
  if (use.profiles.length) {
    const { regions, polys } = buildRegions(use.profiles);
    for (const r of regions) { let d = profileDrawing(use.profiles[r.index]); for (const hp of r.holes) d = d.cut(profileDrawing(use.profiles[polys.indexOf(hp)])); parts.push(d); }
  }
  for (const rg of use.regions) { let d = loopDrawing(rg.outer); for (const hh of rg.holes) d = d.cut(loopDrawing(hh)); parts.push(d); }
  if (!parts.length) throw new Error(refs?.length ? 'The picked profiles no longer exist. Edit this feature and pick them again.' : 'The sketch has no closed profiles');
  return parts.reduce((a, d) => a.fuse(d));
}
// Exactly one closed area (loft sections, sweep profiles).
function singleAreaDrawing(sk, refs, what) {
  const use = sketchUse(sk, refs);
  const n = buildRegions(use.profiles).regions.length + use.regions.length;
  if (n !== 1) throw new Error(`${sk.name || 'The sketch'} needs exactly one closed profile for a ${what}${n > 1 ? ' (pick one in the feature dialog)' : ''}`);
  return sketchDrawing(sk, refs);
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
      const drawing = sketchDrawing(sk.feature, f.regions);
      if (f.type === 'extrude') {
        const d = Math.abs(+f.distance); if (!(d > 0)) throw new Error('Distance must be greater than 0 mm');
        const shift = f.direction === 'reverse' ? -d : f.direction === 'symmetric' ? -d / 2 : 0;
        return extrudeDrawing(drawing, brepPlane(pi.base, pi.offset, pi.flip, shift).plane, d);
      }
      const ang = Math.min(360, Math.abs(+f.angle)); if (!(ang > 0)) throw new Error('Angle must be greater than 0°');
      const P = brepPlane(pi.base, pi.offset, pi.flip);
      if (f.axis !== 'u' && f.axis !== 'v' && f.axis) { const A = axisOf(f.axis, out); return revolveDrawing(drawing, P.plane, new THREE.Vector3(...A.d), new THREE.Vector3(...A.o), ang); }   // a construction or origin axis
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
function bNew(out, id, shape, fid) { out.bodyCount++; out.bodies.set(id, { id, name: 'Body ' + out.bodyCount, shape, feature: fid, surface: isSurfaceShape(shape) }); out.lastBody = id; }
function bReplace(out, id, shape) {
  const b = out.bodies.get(id);
  const surface = !!shape && isSurfaceShape(shape);
  let empty = false; try { empty = !shape || (surface ? RC.measureArea(shape) < 1e-9 : RC.measureVolume(shape) < 1e-9); } catch (e) { empty = false; }
  if (empty) { out.bodies.delete(id); if (out.lastBody === id) out.lastBody = [...out.bodies.keys()].pop() || null; return; }
  out.bodies.set(id, { id, name: b.name, shape, feature: b.feature, surface });
}
function bTarget(out, target) {
  if (target && out.bodies.has(target)) return target;
  if (out.lastBody && out.bodies.has(out.lastBody) && !out.bodies.get(out.lastBody).surface) return out.lastBody;
  const solids = [...out.bodies.values()].filter(b => !b.surface);
  return (solids.length ? solids.pop().id : [...out.bodies.keys()].pop()) || null;
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
function brepCopies(f, shape, res) {
  if (f.type === 'mirror') {
    if (['XY', 'XZ', 'YZ'].includes(f.plane || 'YZ')) return [T(shape.clone().mirror(f.plane || 'YZ', [0, 0, 0]))];
    const p = resolvePlane(f.plane, res), M = planeMatrix(p.base, p.offset, p.flip), e = M.elements;   // a construction plane
    return [T(shape.clone().mirror([e[8], e[9], e[10]], [e[12], e[13], e[14]]))];
  }
  const count = Math.max(2, Math.min(50, Math.round(+f.count || 2))), out = [];
  const axisAt = (k, dflt) => AX[k] ? { o: [0, 0, 0], d: AX[k] } : k ? axisOf(k, res) : { o: [0, 0, 0], d: AX[dflt] };
  if (f.kind === 'circular') {
    const total = Math.min(360, Math.abs(+f.angle || 360)), step = total >= 359.999 ? 360 / count : total / (count - 1), A = axisAt(f.axis, 'Z');
    for (let i = 1; i < count; i++) out.push(T(shape.clone().rotate(step * i, A.o, A.d)));
  } else {
    const a1 = axisAt(f.axis, 'X').d, a2 = axisAt(f.axis2, 'Y').d, n2 = Math.max(1, Math.min(50, Math.round(+f.count2 || 1)));
    for (let j = 0; j < n2; j++) for (let i = 0; i < count; i++) {
      if (!i && !j) continue;
      const s1 = (+f.spacing || 0) * i, s2 = (+f.spacing2 || 0) * j;
      out.push(T(shape.clone().translate([a1[0] * s1 + a2[0] * s2, a1[1] * s1 + a2[1] * s2, a1[2] * s1 + a2[2] * s2])));
    }
  }
  return out;
}

// ---- persistent edge / face references (geometric signatures) ----
function edgeSig(e) {
  const p = e.pointAt(0.5); let len = 0; try { len = RC.measureLength(e); } catch (x) { }
  const sig = { p: [p.x, p.y, p.z], len, type: e.geomType };
  if (sig.type === 'LINE') { try { const a = e.pointAt(0), b = e.pointAt(1); sig.a = [a.x, a.y, a.z]; sig.b = [b.x, b.y, b.z]; } catch (x) { } }
  if (sig.type === 'CIRCLE') {   // center and axis, for joint origins on round edges
    try {
      const q = [0, 0.25, 0.5].map(t => { const v = e.pointAt(t), r = [v.x, v.y, v.z]; v.delete?.(); return r; });
      const sub = (u, v) => u.map((x, i) => x - v[i]), cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const ab = sub(q[1], q[0]), ac = sub(q[2], q[0]), n = cr(ab, ac), nn = dot(n, n);
      if (nn > 1e-18) {
        const t1 = cr(n, ab).map(x => x * dot(ac, ac)), t2 = cr(ac, n).map(x => x * dot(ab, ab));
        sig.cc = q[0].map((x, i) => x + (t1[i] + t2[i]) / (2 * nn));
        const l = Math.sqrt(nn); sig.ax = n.map(x => x / l);
      }
    } catch (x) { }
  }
  return sig;
}
function faceSig(fc) {
  const c = fc.center; let n = [0, 0, 0]; try { const v = fc.normalAt(); n = [v.x, v.y, v.z]; } catch (x) { }
  const sig = { c: [c.x, c.y, c.z], n, type: fc.geomType };
  if (sig.type === 'CYLINDRE') {   // axis (direction ax, point ap) and radius, for construction axes and tangent planes
    try {
      const P = (u, v) => { const p = fc.pointOnSurface(u, v), r = [p.x, p.y, p.z]; p.delete?.(); return r; };
      const N = (u, v) => { const p = fc.pointOnSurface(u, v), q = fc.normalAt(p), l = Math.hypot(q.x, q.y, q.z) || 1, r = [q.x / l, q.y / l, q.z / l]; p.delete?.(); q.delete?.(); return r; };
      const a = P(0.5, 0.1), b = P(0.5, 0.9), dv = b.map((x, i) => x - a[i]), dl = Math.hypot(...dv);
      const p = P(0.5, 0.5), q = P(0.1, 0.5), np = N(0.5, 0.5), nq = N(0.1, 0.5), dn = np.map((x, i) => x - nq[i]), den = dn.reduce((s2, x) => s2 + x * x, 0);
      if (dl > 1e-9 && den > 1e-12) {
        const r = p.reduce((s2, x, i) => s2 + (x - q[i]) * dn[i], 0) / den;
        sig.ax = dv.map(x => x / dl); sig.ap = p.map((x, i) => x - r * np[i]); sig.r = Math.abs(r);
      }
    } catch (x) { }
  }
  return sig;
}
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
  if (f.type === 'presspull') return pressPull(f, out);
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

// Smallest radius of curvature on the face, separately for directions that curve toward the outward
// normal (concave, like the wall of a hole) and away from it (convex, like a boss), by finite differences.
function curvatureRadii(face) {   // (normalAt is not unit length)
  let concave = Infinity, convex = Infinity;
  const at = (u, v) => { const p = face.pointOnSurface(u, v), n = face.normalAt(p), l = Math.hypot(n.x, n.y, n.z) || 1, r = [[p.x, p.y, p.z], [n.x / l, n.y / l, n.z / l]]; p.delete?.(); n.delete?.(); return r; };
  for (const [u, v] of [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7]]) for (const [du, dv] of [[0.01, 0], [0, 0.01]]) {
    let a, b; try { a = at(u, v); b = at(u + du, v + dv); } catch (e) { continue; }
    const dp = [0, 1, 2].map(k => b[0][k] - a[0][k]), dn = [0, 1, 2].map(k => b[1][k] - a[1][k]);
    const lp = Math.hypot(...dp), ln = Math.hypot(...dn);
    if (lp < 1e-12 || ln < 1e-9) continue;
    const R = lp / ln, s = dp[0] * dn[0] + dp[1] * dn[1] + dp[2] * dn[2];
    if (s < 0) concave = Math.min(concave, R); else convex = Math.min(convex, R);
  }
  return { concave, convex };
}
// The material between a curved face and its offset by d (along the outward normal), as a solid. It reaches a
// hair past the face on the other side so the boolean never meets exactly coincident curved faces.
function offsetSlab(face, d) {
  const oc = RC.getOC(), eps = Math.min(0.01, Math.abs(d) / 10);
  // an offset past a center of curvature turns the surface inside out (a hole closed beyond its axis)
  const { concave, convex } = curvatureRadii(face);
  if ((d > 0 && d >= concave * 0.999) || (d < 0 && -d >= convex * 0.999)) throw new Error('This face cannot be offset that far: ' + Math.min(d > 0 ? concave : convex, 1e9).toFixed(2) + ' mm is the most it can move this way.');
  const mo = new oc.BRepOffsetAPI_MakeOffsetShape(); mo.PerformBySimple(face.wrapped, d > 0 ? -eps : eps);
  const off = mo.Shape();
  const mk = new oc.BRepOffsetAPI_MakeThickSolid(); mk.MakeThickSolidBySimple(d > 0 ? off.Reversed() : off, d > 0 ? -(d + eps) : d - eps);
  const slab = RC.cast(mk.Shape());
  mo.delete(); mk.delete(); off.delete?.();
  let v = 0; try { v = RC.measureVolume(slab); } catch (e) { }
  if (!(v > 1e-9)) { slab.delete?.(); throw new Error('This face cannot be offset that far. Try a smaller distance.'); }
  return slab;
}
// Press Pull: grow a face outward (join) or push it in (cut) by a signed distance. Flat faces extrude;
// curved ones (holes, bosses, fillets) are offset along their normal, so a hole gets bigger or smaller.
function pressPull(f, out) {
  const refs = f.edges || [];
  if (!refs.length) throw new Error('Click a face on the model');
  const d = +f.distance;
  if (!(Math.abs(d) > 1e-6)) throw new Error('Distance must not be 0 mm');
  let matched = 0;
  for (const [id, b] of [...out.bodies]) {
    if (f.body && f.body !== id) continue;
    const list = b.shape.faces, hs = matchRefs(list, refs, faceSig, 'c');
    const picked = list.filter(x => hs.has(x.hashCode));
    try {
      if (!picked.length) continue;
      let shape = b.shape.clone();
      for (const face of picked) {
        const prism = face.geomType === 'PLANE' ? (() => { const n = face.normalAt(), v = n.multiply(d), p = RC.basicFaceExtrusion(face, v); n.delete?.(); v.delete?.(); return p; })() : offsetSlab(face, d);
        const next = d > 0 ? shape.fuse(prism) : shape.cut(prism);
        shape.delete?.(); prism.delete?.();
        shape = next;
      }
      matched += picked.length;
      bReplace(out, id, T(shape.simplify ? shape.simplify() : shape));
    } finally { list.forEach(x => x.delete?.()); }
  }
  if (!matched) throw new Error('The picked faces no longer exist. Edit this feature and pick them again.');
  return matched;
}
// ---- solid modify tools: split body, scale, thicken, replace face, align, pattern on path, boundary fill ----
const MODIFY_TYPES = new Set(['splitface', 'splitbody', 'scale', 'thicken', 'replaceface', 'align', 'patpath', 'boundary']);
// place a shape by a rigid THREE.Matrix4 (rotation about the origin, then translation)
function placeShape(shape, M) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); M.decompose(p, q, sc);
  const w = Math.min(1, Math.max(-1, q.w)), ang = 2 * Math.acos(w) * 180 / Math.PI, sn = Math.sqrt(1 - w * w);
  let r = shape;
  if (ang > 1e-9 && sn > 1e-12) r = r.rotate(ang, [0, 0, 0], [q.x / sn, q.y / sn, q.z / sn]);
  return r.translate([p.x, p.y, p.z]);
}
function planeFrameOf(ref, out) { const pl = resolvePlane(ref, out); return planeMatrix(pl.base, pl.offset, pl.flip); }
function shapesBox(shapes, pad = 10) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const sh of shapes) { const [a, b] = sh.boundingBox.bounds; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a[i]); hi[i] = Math.max(hi[i], b[i]); } }
  return { lo: lo.map(v => v - pad), hi: hi.map(v => v + pad), size: Math.max(...hi.map((v, i) => v - lo[i])) + 2 * pad };
}
// half of space on the + side of a plane (as a large box), sized to cover the given shapes
function halfSpace(M, size) { const L = size * 4; return T(placeShape(RC.makeBox([-L, -L, 0], [L, L, L]), M)); }
// frame (THREE.Matrix4, z along the normal or axis) of a face signature
function sigFrame(sig) {
  const o = new THREE.Vector3(...(sig.type === 'CYLINDRE' && sig.ap ? sig.ap : sig.c)), z = new THREE.Vector3(...(sig.type === 'CYLINDRE' && sig.ax ? sig.ax : sig.n)).normalize();
  const a = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), x = a.sub(z.clone().multiplyScalar(a.dot(z))).normalize();
  return new THREE.Matrix4().makeBasis(x, z.clone().cross(x), z).setPosition(o);
}
function facesOf(shape, refs) { const list = shape.faces, hs = matchRefs(list, refs, faceSig, 'c'); const picked = list.filter(x => hs.has(x.hashCode)); return { list, picked }; }
function modifyStep(f, out) {
  const body = () => {
    if (!f.body && (f.edges || []).length) for (const b of out.bodies.values()) { const l = b.shape.faces, hs = matchRefs(l, f.edges, faceSig, 'c'); l.forEach(x => x.delete?.()); if (hs.size) return b; }   // the body the picked faces are on
    const b = out.bodies.get(f.body || bTarget(out, null)); if (!b) throw new Error('Choose a body'); return b;
  };
  if (f.type === 'splitface') {
    const b = body(); if (!(f.edges || []).length) throw new Error('Click the faces to split');
    const { list, picked } = facesOf(b.shape, f.edges);
    try {
      if (!picked.length) throw new Error('The picked faces no longer exist. Edit this feature and pick them again.');
      const oc = RC.getOC(), M = planeFrameOf(f.tool || 'XY', out), e = M.elements, n = [e[8], e[9], e[10]], o = [e[12], e[13], e[14]];
      const nl = Math.hypot(...n); n.forEach((v, i) => n[i] = v / nl);
      const tool = new oc.BRepBuilderAPI_MakeFace(RC.makePln(o, n)).Face();
      const args = new oc.NCollection_List_TopoDS_Shape(), tools = new oc.NCollection_List_TopoDS_Shape();
      for (const sh of RC.iterTopo(b.shape.wrapped, 'shell')) args.Append(sh);
      tools.Append(tool);
      const sp = new oc.BRepAlgoAPI_Splitter(); sp.SetArguments(args); sp.SetTools(tools); sp.Build();
      if (sp.HasErrors()) throw new Error('Could not split the faces with that plane');
      const shells = [...RC.iterTopo(sp.Shape(), 'shell')].map(s => RC.cast(s));
      let solid = RC.makeSolid(shells);
      // the splitter cuts every face the plane crosses; merge back the ones that were not picked
      const dist = p => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2];
      const u = new oc.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, false);
      let freed = 0;
      for (const ed of solid.edges) {
        const P = q => [q.x, q.y, q.z], mid = P(ed.pointAt(0.5));
        if (Math.abs(dist(mid)) < 1e-6 && Math.abs(dist(P(ed.startPoint))) < 1e-6) {
          const v = RC.makeVertex(mid);
          if (!picked.some(fc => RC.measureDistanceBetween(fc, v) < 1e-6)) { freed++; continue; }
        }
        u.KeepShape(ed.wrapped);
      }
      if (freed) { u.Build(); solid = RC.cast(u.Shape()); }
      if (solid.faces.length <= list.length) throw new Error('The plane does not cross the picked faces');
      bReplace(out, b.id, T(solid));
    } finally { list.forEach(x => x.delete?.()); }
    return;
  }
  if (f.type === 'splitbody') {
    const b = body(), M = planeFrameOf(f.tool || 'XY', out), box = shapesBox([b.shape]);
    const up = halfSpace(M, box.size), A = T(b.shape.clone().intersect(up)), B = T(b.shape.clone().cut(up));
    let va = 0, vb = 0; try { va = RC.measureVolume(A); vb = RC.measureVolume(B); } catch (e) { }
    if (va < 1e-9 || vb < 1e-9) throw new Error('The plane does not cut through the body');
    bReplace(out, b.id, A); bNew(out, b.id + ':split', B, f.id);
    return;
  }
  if (f.type === 'scale') {
    const b = body(), k = +f.factor; if (!(k > 0)) throw new Error('Scale must be greater than 0');
    const c = f.center === 'point' && f.point ? (out.points.get(f.point)?.p || [0, 0, 0]) : f.center === 'body' ? (() => { const bb = b.shape.boundingBox.bounds; return bb[0].map((v, i) => (v + bb[1][i]) / 2); })() : [0, 0, 0];
    bReplace(out, b.id, T(b.shape.clone().scale(k, c)));
    return;
  }
  if (f.type === 'replaceface') {
    const b = body(); if (!(f.edges || []).length) throw new Error('Click the face to replace');
    const { list, picked } = facesOf(b.shape, f.edges);
    try {
      if (!picked.length) throw new Error('The picked face no longer exists. Edit this feature and pick it again.');
      const M = planeFrameOf(f.target || 'XY', out), e = M.elements, pn = new THREE.Vector3(e[8], e[9], e[10]).normalize(), po = new THREE.Vector3(e[12], e[13], e[14]);
      let shape = b.shape.clone();
      for (const face of picked) {
        if (face.geomType !== 'PLANE') throw new Error('Replace Face works on flat faces');
        const n = face.normalAt(), fn = new THREE.Vector3(n.x, n.y, n.z).normalize(), c = face.center, fc = new THREE.Vector3(c.x, c.y, c.z); n.delete?.();
        if (Math.abs(Math.abs(fn.dot(pn)) - 1) > 1e-6) throw new Error('The target plane must be parallel to the face');
        const d = po.clone().sub(fc).dot(fn); if (Math.abs(d) < 1e-9) continue;
        const v = face.normalAt(); const prism = RC.basicFaceExtrusion(face, v.multiply(d / Math.hypot(v.x, v.y, v.z)));
        const next = d > 0 ? shape.fuse(prism) : shape.cut(prism); shape.delete?.(); prism.delete?.(); shape = next;
      }
      bReplace(out, b.id, T(shape));
    } finally { list.forEach(x => x.delete?.()); }
    return;
  }
  if (f.type === 'thicken') {
    const b = body(), t = +f.thickness; if (!(Math.abs(t) > 0)) throw new Error('Thickness must not be 0 mm');
    if (!(f.edges || []).length) throw new Error('Click the faces to thicken');
    const { list, picked } = facesOf(b.shape, f.edges);
    try {
      if (!picked.length) throw new Error('The picked faces no longer exist. Edit this feature and pick them again.');
      let tool = null;
      for (const face of picked) {
        const one = d => face.geomType === 'PLANE' ? (() => { const n = face.normalAt(), v = n.multiply(d / Math.hypot(n.x, n.y, n.z)); return RC.basicFaceExtrusion(face, v); })() : offsetSlab(face, d);
        let s1 = f.side === 'both' ? T(one(t / 2)).fuse(T(one(-t / 2))) : one(f.side === 'in' ? -Math.abs(t) : Math.abs(t));
        tool = tool ? T(tool.fuse(T(s1))) : T(s1);
      }
      const res = bApply(out, f, tool, f.op || 'new', b.id);
      out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'new' });
    } finally { list.forEach(x => x.delete?.()); }
    return;
  }
  if (f.type === 'align') {
    const b = body(); if (!f.a || !f.b) throw new Error('Pick a face on the body to move, then a face to align it to');
    const findSig = (shape, sig) => { const list = shape.faces, hs = matchRefs(list, [sig], faceSig, 'c'), hit = list.find(x => hs.has(x.hashCode)); const r = hit ? faceSig(hit) : null; list.forEach(x => x.delete?.()); return r; };
    const sa = findSig(b.shape, f.a.sig), tb = out.bodies.get(f.b.body), sb = tb ? findSig(tb.shape, f.b.sig) : null;
    if (!sa || !sb) throw new Error('A picked face no longer exists. Edit this feature and pick it again.');
    const Fa = sigFrame(sa), Fb = sigFrame(sb), X = f.flip ? new THREE.Matrix4() : new THREE.Matrix4().makeRotationX(Math.PI);
    const Mv = Fb.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, +f.offset || 0)).multiply(X).multiply(new THREE.Matrix4().makeRotationZ((+f.angle || 0) * Math.PI / 180)).multiply(Fa.clone().invert());
    bReplace(out, b.id, T(placeShape(b.shape.clone(), Mv)));
    return;
  }
  if (f.type === 'patpath') {
    const src = out.tools.get(f.source); if (!src) throw new Error('Choose a feature that comes before this one');
    const ps = out.sketches.get(f.path); if (!ps) throw new Error('Choose the sketch with the path');
    const geo = ps.feature.geo; if (!geo?.curves?.length) throw new Error('The path sketch has no lines or curves');
    const solved = solveSketch(geo); if (!solved.ok) throw new Error('The path sketch constraints conflict');
    const { paths } = geoPaths(geo, solved); if (!paths?.length) throw new Error('The path sketch needs one connected chain of lines and arcs');
    // sample the chain in sketch coordinates, then place in 3D
    const pts = [];
    for (const sg of paths[0].segs) {
      const n = sg.t === 'line' ? 1 : 32;
      for (let i = pts.length ? 1 : 0; i <= n; i++) {
        const t = i / n;
        if (sg.t === 'line') pts.push([sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t]);
        else if (sg.t === 'bez') pts.push(bezPoint(sg.P, t));
        else { const m = arcMid(sg), ang = m.a0 + (m.a1 - m.a0) * t; pts.push([sg.c[0] + m.r * Math.cos(ang), sg.c[1] + m.r * Math.sin(ang)]); }
      }
    }
    const M = ps.matrix, P3 = p => new THREE.Vector3(p[0], p[1], 0).applyMatrix4(M), len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1]; if (total < 1e-9) throw new Error('The path has no length');
    const count = Math.max(2, Math.min(100, Math.round(+f.count || 2))), step = f.spacing === 'fill' || !(+f.distance > 0) ? total / (count - 1) : +f.distance;
    const at = s => { let i = 1; while (i < len.length - 1 && len[i] < s) i++; const t = (s - len[i - 1]) / ((len[i] - len[i - 1]) || 1); const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; return { p, tan: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) }; };
    const start = at(0), nrm = new THREE.Vector3(0, 0, 1).transformDirection(M), copies = [];
    for (let k = 1; k < count; k++) {
      const s2 = k * step; if (s2 > total + 1e-6) break;
      const q = at(Math.min(s2, total)), d = P3(q.p).sub(P3(start.p));
      let X = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
      if (f.orient === 'path') { const o = P3(q.p); X = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeRotationAxis(nrm, q.tan - start.tan)).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z)).multiply(X); }
      copies.push(T(placeShape(src.shape.clone(), X)));
    }
    if (!copies.length) throw new Error('The path is too short for that spacing');
    if (src.op === 'new') { copies.forEach((c, k) => bApply(out, f, c, 'new', null, ':' + (k + 1))); out.tools.set(f.id, { shape: copies.length > 1 ? T(RC.makeCompound(copies.map(c => c.clone()))) : copies[0], op: 'new' }); }
    else { let tool = copies[0]; for (let k = 1; k < copies.length; k++) tool = T(tool.fuse(copies[k])); const res = bApply(out, f, tool, src.op, src.target); out.tools.set(f.id, { shape: tool, ...res, op: src.op }); }
    return;
  }
  if (f.type === 'boundary') {
    const tools = (f.bodies || []).map(id => out.bodies.get(id)).filter(Boolean);
    if (!tools.length && !(f.planes || []).length) throw new Error('Choose the bodies and planes that bound the region');
    const box = shapesBox(tools.length ? tools.map(b => b.shape) : [...out.bodies.values()].map(b => b.shape));
    let cell = T(RC.makeBox(box.lo, box.hi));
    for (const pl of f.planes || []) { const M = planeFrameOf(pl.ref, out), hs = halfSpace(pl.side === 'below' ? M.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI)) : M, box.size); cell = T(cell.intersect(hs)); }
    for (const b of tools) cell = T(cell.cut(b.shape));
    let solids = []; try { solids = cell.solids || [cell]; } catch (e) { solids = [cell]; }
    // keep the enclosed cells (not touching the outer box) unless the user picked cells by number
    const inner = solids.filter(sd => { const [a, c] = sd.boundingBox.bounds; return a.every((v, i) => v > box.lo[i] + 1e-6) && c.every((v, i) => v < box.hi[i] - 1e-6); });
    const keep = (f.cells?.length ? f.cells.map(i => solids[i - 1]).filter(Boolean) : inner.length ? inner : solids.slice(0, 1));
    if (!keep.length) throw new Error('No closed region found between those tools');
    keep.forEach((sd, k) => bNew(out, f.id + (k ? ':' + k : ''), T(sd.clone()), f.id));
    out.tools.set(f.id, { shape: keep.length > 1 ? T(RC.makeCompound(keep.map(c => c.clone()))) : T(keep[0].clone()), op: 'new' });
    return;
  }
}
// ---- more create tools: coil, thread, rib, web, emboss ----
const CREATE2_TYPES = new Set(['coil', 'thread', 'rib', 'web', 'emboss']);
// metric coarse threads: nominal diameter -> pitch
const METRIC_COARSE = [[1.6, 0.35], [2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [20, 2.5], [24, 3], [30, 3.5], [36, 4]];
function sweepProfileAlongHelix(spine, center, draw2d) {
  // profile plane at the helix start: x = radial outward, normal = helix tangent
  const sp = spine.startPoint, tg = spine.tangentAt(1e-9), c = new THREE.Vector3(...center), s0 = new THREE.Vector3(sp.x, sp.y, sp.z);
  const radial = s0.clone().sub(c), n = new THREE.Vector3(tg.x, tg.y, tg.z).normalize();
  radial.sub(n.clone().multiplyScalar(radial.dot(n))).normalize();
  const pl = new RC.Plane([s0.x, s0.y, s0.z], [radial.x, radial.y, radial.z], [n.x, n.y, n.z]);
  const sk = draw2d().sketchOnPlane(pl);
  return T(RC.genericSweep(sk.wire, spine, { frenet: true }, false));
}
function sketchChain(ps) {
  const geo = ps.feature.geo; if (!geo?.curves?.length) throw new Error('The sketch has no lines');
  const solved = solveSketch(geo); if (!solved.ok) throw new Error('The sketch constraints conflict');
  const { paths } = geoPaths(geo, solved); if (!paths?.length) throw new Error('Draw an open line or chain of lines for the profile');
  return paths;
}
function createStep2(f, out) {
  if (f.type === 'coil') {
    const pi = placementInfo(f, out), P = brepPlane(pi.base, pi.offset, pi.flip);
    const R = (+f.diameter || 0) / 2, sz = +f.section_size || 0; if (!(R > 0)) throw new Error('Diameter must be greater than 0 mm'); if (!(sz > 0)) throw new Error('Section size must be greater than 0 mm');
    let revs = +f.revolutions || 0, height = +f.height || 0, pitch = +f.pitch || 0;
    if (f.mode === 'revs-pitch') height = revs * pitch; else if (f.mode === 'height-pitch') revs = height / (pitch || 1); else pitch = height / (revs || 1);
    if (!(revs > 0 && height > 0 && pitch > 0)) throw new Error('Revolutions, height and pitch must be greater than 0');
    if (pitch <= sz && f.section !== 'none') throw new Error('The pitch must be larger than the section size or the turns overlap');
    const c = P.o.clone().add(P.u.clone().multiplyScalar(+f.cx || 0)).add(P.v.clone().multiplyScalar(+f.cy || 0));
    const shift = f.position === 'inside' ? -sz / 2 : f.position === 'outside' ? sz / 2 : 0;
    const spine = T(RC.makeHelix(pitch, height, R + shift, [c.x, c.y, c.z], [P.n.x, P.n.y, P.n.z], !!f.lefthand));
    const h2 = sz / 2;
    const prof = f.section === 'square' ? () => RC.drawRoundedRectangle(sz, sz, 0)
      : f.section === 'triangle-out' ? () => RC.draw([-h2 * 0.866, -h2]).lineTo([h2 * 0.866, 0]).lineTo([-h2 * 0.866, h2]).close()
      : f.section === 'triangle-in' ? () => RC.draw([h2 * 0.866, -h2]).lineTo([h2 * 0.866, h2]).lineTo([-h2 * 0.866, 0]).close()
      : () => RC.drawCircle(h2);
    const tool = sweepProfileAlongHelix(spine, [c.x, c.y, c.z], prof);
    const res = bApply(out, f, tool, f.op || 'new', f.target);
    out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'new' });
    return;
  }
  if (f.type === 'thread') {
    if (!(f.edges || []).length) throw new Error('Click a cylindrical face (a hole or a shaft)');
    if (!f.modeled) return;   // cosmetic: shown on the page and in drawings, no geometry change
    let done = false;
    for (const [id, b] of [...out.bodies]) {
      const list = b.shape.faces, hs = matchRefs(list, f.edges, faceSig, 'c'), picked = list.filter(x => hs.has(x.hashCode));
      try {
        if (!picked.length) continue;
        // merge split cylinder faces first: a helical cut across the joint between two half-cylinders fails
        let shape = b.shape.clone(); try { const u = shape.simplify(); if (u && u !== shape) shape = u; } catch (e) { }
        for (const face of picked) {
          const sig = faceSig(face); if (sig.type !== 'CYLINDRE' || !sig.ax) throw new Error('Threads go on cylindrical faces');
          const ax = new THREE.Vector3(...sig.ax).normalize(), ap = new THREE.Vector3(...sig.ap), r = sig.r;
          // axial extent of the face
          let lo = Infinity, hi = -Infinity;
          for (const v of [0, 1]) for (const u of [0, 0.5]) { const p = face.pointOnSurface(u, v), t = new THREE.Vector3(p.x, p.y, p.z).sub(ap).dot(ax); p.delete?.(); lo = Math.min(lo, t); hi = Math.max(hi, t); }
          // inside (hole) or outside (shaft): the face normal points toward the axis for a hole
          const pm = face.pointOnSurface(0.3, 0.5), nm = face.normalAt(pm), rad = new THREE.Vector3(pm.x, pm.y, pm.z).sub(ap); rad.sub(ax.clone().multiplyScalar(rad.dot(ax)));
          const internal = rad.dot(new THREE.Vector3(nm.x, nm.y, nm.z)) < 0; pm.delete?.(); nm.delete?.();
          const pitch = +f.pitch > 0 ? +f.pitch : (METRIC_COARSE.reduce((a, q) => Math.abs(q[0] - 2 * r) < Math.abs(a[0] - 2 * r) ? q : a)[1]);
          const avail = hi - lo, len = f.full !== false ? avail : Math.min(avail, Math.max(pitch, +f.length || avail));
          const start = lo + (f.full !== false ? 0 : Math.max(0, +f.offsetStart || 0)), d = 0.54 * pitch, w = 0.62 * pitch / 2;
          if (len < pitch * 1.2) throw new Error('The face is too short for one turn of this thread');
          const c = ap.clone().add(ax.clone().multiplyScalar(start + pitch * 0.25));
          const spine = T(RC.makeHelix(pitch, len - pitch * 0.5, r, [c.x, c.y, c.z], [ax.x, ax.y, ax.z], !!f.lefthand));
          // V profile in the (radial, axial) plane: apex into the material, base just beyond the surface
          const ins = internal ? 1 : -1, eps = 0.05;
          let vp = [[-ins * eps, -w], [ins * d, 0], [-ins * eps, w]];
          if ((vp[1][0] - vp[0][0]) * (vp[2][1] - vp[0][1]) - (vp[2][0] - vp[0][0]) * (vp[1][1] - vp[0][1]) < 0) vp = vp.reverse();   // counter-clockwise, or the sweep comes out inside-out
          const tool = sweepProfileAlongHelix(spine, [c.x, c.y, c.z], () => RC.draw(vp[0]).lineTo(vp[1]).lineTo(vp[2]).close());
          const next = shape.cut(tool); shape.delete?.(); shape = next; done = true;
        }
        bReplace(out, id, T(shape));
      } finally { list.forEach(x => x.delete?.()); }
    }
    if (!done) throw new Error('The picked face no longer exists. Edit this feature and pick it again.');
    return;
  }
  if (f.type === 'web' || f.type === 'rib') {
    const ps = out.sketches.get(f.sketch); if (!ps) throw new Error('Choose the sketch with the profile');
    const paths = sketchChain(ps), t = +f.thickness; if (!(t > 0)) throw new Error('Thickness must be greater than 0 mm');
    const pi = placementInfo(ps.feature, out);
    if (f.type === 'web') {
      // every segment becomes a thin wall of the given thickness, extruded normal to the sketch
      const depth = +f.depth; if (!(depth > 0)) throw new Error('Depth must be greater than 0 mm');
      let dr = null;
      for (const path of paths) for (const sg of path.segs) {
        if (sg.t !== 'line') throw new Error('Web profiles are straight lines');
        const dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], L = Math.hypot(dx, dy); if (L < 1e-9) continue;
        const nx = -dy / L * t / 2, ny = dx / L * t / 2, ex = dx / L * t / 2, ey = dy / L * t / 2;   // ends overlap by half a thickness so joints fuse
        const d1 = RC.draw([sg.a[0] - ex + nx, sg.a[1] - ey + ny]).lineTo([sg.b[0] + ex + nx, sg.b[1] + ey + ny]).lineTo([sg.b[0] + ex - nx, sg.b[1] + ey - ny]).lineTo([sg.a[0] - ex - nx, sg.a[1] - ey - ny]).close();
        dr = dr ? dr.fuse(d1) : d1;
      }
      if (!dr) throw new Error('The profile has no length');
      const shift = f.direction === 'reverse' ? -depth : f.direction === 'symmetric' ? -depth / 2 : 0;
      const tool = extrudeDrawing(dr, brepPlane(pi.base, pi.offset, pi.flip, shift).plane, depth);
      const res = bApply(out, f, tool, f.op || 'join', f.target);
      out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'join' });
      return;
    }
    // rib: wall symmetric about the sketch plane, filling from the line toward the body until it meets it
    const b = out.bodies.get(f.target || bTarget(out, null)); if (!b) throw new Error('A rib needs a body to attach to');
    const seg = paths[0].segs; if (seg.some(sg => sg.t !== 'line')) throw new Error('Rib profiles are straight lines');
    const A = seg[0].a, B = seg[seg.length - 1].b, dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy); if (L < 1e-9) throw new Error('The rib line has no length');
    const [b0, b1] = b.shape.boundingBox.bounds, big = Math.max(...b1.map((v, i) => v - b0[i])) * 3 + 50;
    const pts = seg.map(sg => sg.a).concat([B]);
    // try the two sides of the line; the rib is the closed pocket between the line and the part
    const attempt = sgn => {
      const nx = -dy / L * sgn, ny = dx / L * sgn;
      let pen = RC.draw(pts[0]); for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
      for (let i = pts.length - 1; i >= 0; i--) pen = pen.lineTo([pts[i][0] + nx * big, pts[i][1] + ny * big]);
      const slab = extrudeDrawing(pen.close(), brepPlane(pi.base, pi.offset, pi.flip, -t / 2).plane, t);
      const pieces = T(slab.cut(b.shape));
      let sol = []; try { sol = pieces.solids || [pieces]; } catch (e) { sol = [pieces]; }
      const mid = new THREE.Vector3((A[0] + B[0]) / 2 + nx * 0.01, (A[1] + B[1]) / 2 + ny * 0.01, 0).applyMatrix4(ps.matrix);
      let best = null, bd = Infinity;
      for (const sd of sol) { const [p0, p1] = sd.boundingBox.bounds, inside = [0, 1, 2].every(k => mid.getComponent(k) >= p0[k] - 1e-3 && mid.getComponent(k) <= p1[k] + 1e-3); const c = [0, 1, 2].map(k => (p0[k] + p1[k]) / 2), dd = Math.hypot(c[0] - mid.x, c[1] - mid.y, c[2] - mid.z) - (inside ? 1e6 : 0); if (dd < bd) { bd = dd; best = sd; } }
      if (!best) return null;
      const [q0, q1] = best.boundingBox.bounds;
      return q1.some((v, k) => v - q0[k] > big * 0.6) ? null : best;     // reached the far end of the slab: not closed on this side
    };
    const order = f.flipSide ? [-1, 1] : [1, -1];
    const best = attempt(order[0]) || attempt(order[1]);
    if (!best) throw new Error('The rib does not close against the body. Draw the line so both ends touch the part.');
    const tool = T(best.clone());
    const res = bApply(out, f, tool, 'join', b.id);
    out.tools.set(f.id, { shape: tool, ...res, op: 'join' });
    return;
  }
  if (f.type === 'emboss') {
    const ps = out.sketches.get(f.sketch); if (!ps) throw new Error('Choose the sketch with the profiles');
    if (!(f.edges || []).length) throw new Error('Click the face to emboss onto');
    const depth = +f.depth; if (!(depth > 0)) throw new Error('Depth must be greater than 0 mm');
    const pi = placementInfo(ps.feature, out), dr = sketchDrawing(ps.feature, null);
    for (const [id, b] of [...out.bodies]) {
      const list = b.shape.faces, hs = matchRefs(list, f.edges, faceSig, 'c'), picked = list.filter(x => hs.has(x.hashCode));
      try {
        if (!picked.length) continue;
        const [b0, b1] = b.shape.boundingBox.bounds, reach = Math.max(...b1.map((v, i) => v - b0[i])) * 2 + 20;
        const prism = extrudeDrawing(dr, brepPlane(pi.base, pi.offset, pi.flip, -reach).plane, reach * 2);   // the profiles projected along the sketch normal
        let shape = b.shape.clone();
        for (const face of picked) {
          const deb = f.mode === 'deboss';
          const slab = face.geomType === 'PLANE' ? (() => { const n = face.normalAt(), v = n.multiply((deb ? -depth : depth) / Math.hypot(n.x, n.y, n.z)); return T(RC.basicFaceExtrusion(face, v)); })() : offsetSlab(face, deb ? -depth : depth);
          const tool = T(prism.clone().intersect(slab));
          const next = deb ? shape.cut(tool) : shape.fuse(tool); shape.delete?.(); shape = next;
        }
        bReplace(out, id, T(shape));
        out.tools.set(f.id, { shape: prism, op: f.mode === 'deboss' ? 'cut' : 'join' });
        return;
      } finally { list.forEach(x => x.delete?.()); }
    }
    throw new Error('The picked face no longer exists. Edit this feature and pick it again.');
  }
}
function brepClone(o) {
  return { bodies: new Map(o.bodies), bodyCount: o.bodyCount, lastBody: o.lastBody, sketches: new Map(o.sketches), planes: new Map(o.planes), axes: new Map(o.axes), points: new Map(o.points),
    status: new Map(o.status), tools: new Map(o.tools), before: new Map(o.before), beforeBodies: new Map(o.beforeBodies), sheet: new Map(o.sheet), mbodies: new Map(o.mbodies), lastMesh: o.lastMesh };
}
function regenerateBrep(features, upto = null, cache = null) {
  let out = { bodies: new Map(), bodyCount: 0, lastBody: null, sketches: new Map(), planes: new Map(), axes: new Map(), points: new Map(), status: new Map(), tools: new Map(), before: new Map(), beforeBodies: new Map(), sheet: new Map(), mbodies: new Map(), lastMesh: null };
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
const EDGE_TYPES = new Set(['fillet', 'chamfer', 'shell', 'draft', 'presspull']);
const FACE_PICK = new Set(['shell', 'draft', 'presspull', 'thicken', 'replaceface', 'thread', 'emboss', 'splitface', 'lip']);
// Imported STEP shapes, parsed once per file (async) and reused by every rebuild: fileId -> Shape3D[]
const importShapes = new Map();
function brepStep(f, out) {
  out.before.set(f.id, [...out.bodies.keys()]);
  if (EDGE_TYPES.has(f.type) || FACE_PICK.has(f.type) || SURF_FACE_PICK.has(f.type) || SURF_EDGE_PICK.has(f.type) || f.type === 'patch' || f.type === 'flange' || f.type === 'lip') out.beforeBodies.set(f.id, new Map(out.bodies));
  if (f.suppressed) { out.status.set(f.id, { state: 'suppressed' }); return; }
  try {
    if (f.error) throw new Error(f.error);
    if (constructStep(f, out)) { /* plane, axis or point */ }
    else if (f.type === 'sketch') {
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
        const s = singleAreaDrawing(sk.feature, null, 'loft').sketchOnPlane(brepPlane(pi.base, pi.offset, pi.flip).plane);
        return asSketches(s)[0];
      });
      const tool = T(parts[0].loftWith(parts.slice(1), { ruled: !!f.ruled }));
      const res = bApply(out, f, tool, f.op || 'new', f.target);
      out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'new' });
    } else if (f.type === 'sweep') {
      const tool = sweepTool(f, out);
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
      const copies = brepCopies(f, src.shape, out);
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
    } else if (MODIFY_TYPES.has(f.type)) {
      modifyStep(f, out);
    } else if (CREATE2_TYPES.has(f.type)) {
      createStep2(f, out);
    } else if (SURF_TYPES.has(f.type)) {
      surfaceStep(f, out);
    } else if (SHEET_TYPES.has(f.type)) {
      sheetStep(f, out);
    } else if (PLASTIC_TYPES.has(f.type)) {
      plasticStep(f, out);
    } else if (MESH_TYPES.has(f.type)) {
      meshStep(f, out);
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
  let surface = false; try { surface = isSurfaceShape(rec.shape); } catch (e) { }
  if (surface) { volume = 0; try { const sp = RC.measureShapeSurfaceProperties(rec.shape); const c = sp.centerOfMass; com.set(c[0], c[1], c[2]); sp.delete?.(); } catch (e) { } }
  return (rec._props = { volume: Math.abs(volume), area, com, surface });
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

// ---- sweep ----
function segsPen(segs, closed) {
  let pen = RC.draw(segs[0].a);
  segs.forEach((sg, i) => {
    const last = i === segs.length - 1, end = closed && last ? segs[0].a : sg.b;
    if (sg.t === 'arc') pen = pen.threePointsArcTo(end, arcMid(sg).mid);
    else if (sg.t === 'bez') pen = pen.cubicBezierCurveTo(end, sg.P[1], sg.P[2]);
    else if (!(closed && last)) pen = pen.lineTo(end);
  });
  return closed ? pen.close() : pen.done();
}
function sweepTool(f, out) {
  const ps = out.sketches.get(f.path);
  if (!ps) throw new Error('Choose a path sketch that comes before this feature');
  const geo = ps.feature.geo;
  if (!geo?.curves?.length) throw new Error('The path sketch has no lines or arcs. Draw the path with Line or Arc.');
  const solved = solveSketch(geo);
  if (!solved.ok) throw new Error('The path sketch constraints conflict');
  const { paths, branching } = geoPaths(geo, solved);
  if (branching) throw new Error('The path branches. A path must be a single chain of lines and arcs.');
  const path = paths[Math.max(0, Math.min(paths.length - 1, +f.pathIndex || 0))];
  if (!path) throw new Error('The path sketch has no chain of lines or arcs');
  const pi = placementInfo(ps.feature, out);
  const spine = segsPen(path.segs, path.closed).sketchOnPlane(brepPlane(pi.base, pi.offset, pi.flip).plane);
  // profile frame at the path start, perpendicular to it (same convention as replicad's sweepSketch)
  const sp = spine.wire.startPoint, n = spine.wire.tangentAt(1e-9).multiply(-1).normalize(), x = n.cross(spine.defaultDirection).multiply(-1);
  const frame = () => new RC.Plane(sp, x, n);
  let outer, holes = [];
  if ((f.profileKind || 'circle') === 'circle') {
    const r = +f.diameter / 2; if (!(r > 0)) throw new Error('Diameter must be greater than 0 mm');
    outer = RC.drawCircle(r);
    const wall = +f.wall || 0;
    if (wall > 0) { if (wall >= r) throw new Error('Wall thickness must be less than the radius'); holes = [RC.drawCircle(r - wall)]; }
  } else {
    const prs = out.sketches.get(f.profile);
    if (!prs) throw new Error('Choose a profile sketch that comes before this feature');
    const use = sketchUse(prs.feature, f.profileRegions);
    const legacy = buildRegions(use.profiles);
    if (legacy.regions.length + use.regions.length !== 1) throw new Error('The profile sketch needs exactly one closed profile (holes inside it are fine)');
    if (use.regions.length) { outer = loopDrawing(use.regions[0].outer); holes = use.regions[0].holes.map(loopDrawing); }
    else { const r0 = legacy.regions[0]; outer = profileDrawing(use.profiles[r0.index]); holes = r0.holes.map(hp => profileDrawing(use.profiles[legacy.polys.indexOf(hp)])); }
  }
  const cfg = { forceProfileSpineOthogonality: true, frenet: true };
  const sweepOne = d => RC.genericSweep(d.sketchOnPlane(frame(), sp).wire, spine.wire, cfg);
  let solid = T(sweepOne(outer));
  for (const hd of holes) solid = T(solid.cut(T(sweepOne(hd))));
  return solid;
}
