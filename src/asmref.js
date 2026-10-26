// ===== GeometricReferenceService for assemblies (pure, no DOM / THREE): 3D references on a body =====
// Works on the engine's face and edge signatures in a body's as-modeled coordinates:
//   edge sig: { type: 'LINE' | 'CIRCLE' | ..., p (mid point), a, b (line ends), cc, ax (circle centre, axis), len }
//   face sig: { type: 'PLANE' | 'CYLINDRE' | ..., c (centre), n (normal), ap, ax, r (cylinder axis point, axis, radius) }
// A reference: { type, p, z, x?, src: { kind: 'edge' | 'face', sig, end? }, zsrc?: { kind: 'face', sig } }
//   type: 'vertex' | 'midpoint' | 'center' | 'axis' | 'face' | 'origin'
//   p is the exact point, z the joint direction (face normal or axis), x an optional in-plane direction.
// The cursor only chooses among candidates; every position comes from the geometry.
const REF_PRIO = { vertex: 0, center: 0, origin: 0, cpoint: 0, intersection: 0.5, midpoint: 1, axis: 2, caxis: 2, face: 3, between: 3.2, cplane: 3.5 };
const REF_LABEL = { vertex: 'Vertex', midpoint: 'Edge midpoint', center: 'Circle center', axis: 'Axis', face: 'Face center', origin: 'Component origin', intersection: 'Edge intersection', between: 'Centre between faces', cpoint: 'Construction point', caxis: 'Construction axis', cplane: 'Plane' };
// reference types grouped by how they behave for joint suggestions
const REF_KIND = { vertex: 'point', intersection: 'point', cpoint: 'point', origin: 'point', midpoint: 'point', center: 'round', axis: 'axis', caxis: 'axis', face: 'face', between: 'face', cplane: 'face' };
const vr = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]), norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};
// Candidate references on one body for a cursor over face `face` (its sig) with surface normal `hitN` there.
// `edges` is the body's edge signatures. Callers filter by screen distance; this returns them all.
function bodyRefs(edges, face, hitN, faces) {
  const out = [], zf = face?.type === 'PLANE' && face.n ? vr.norm(face.n) : vr.norm(hitN || [0, 0, 1]);
  const zsrc = face?.type === 'PLANE' ? { kind: 'face', sig: face } : null;
  // a line joining two circles is a cylinder's seam, not a real edge: no references on it
  const circles = edges.filter(s => s.type === 'CIRCLE' && s.cc && s.ax);
  const onCircle = p => circles.some(c => { const w = vr.sub(p, c.cc), r = (c.len || 0) / (2 * Math.PI); return Math.abs(vr.dot(w, vr.norm(c.ax))) < 1e-6 && Math.abs(vr.len(w) - r) < 1e-6 * Math.max(1, r); });
  for (const s of edges) {
    if (s.type === 'LINE' && s.a && s.b && onCircle(s.a) && onCircle(s.b)) continue;
    if (s.type === 'LINE' && s.a && s.b) {
      const x = vr.norm(vr.sub(s.b, s.a));
      out.push({ type: 'vertex', p: s.a, z: zf, x, src: { kind: 'edge', sig: s, end: 'a' }, zsrc });
      out.push({ type: 'vertex', p: s.b, z: zf, x, src: { kind: 'edge', sig: s, end: 'b' }, zsrc });
      out.push({ type: 'midpoint', p: s.p, z: zf, x, src: { kind: 'edge', sig: s }, zsrc });
    } else if (s.type === 'CIRCLE' && s.cc && s.ax) {
      // the axis points out of the face under the cursor, so parts meet face to face
      const ax = vr.norm(s.ax), z = vr.dot(ax, zf) < 0 ? vr.mul(ax, -1) : ax;
      out.push({ type: 'center', p: s.cc, z, src: { kind: 'edge', sig: s } });
    }
  }
  if (face?.type === 'PLANE' && face.c && face.n) {
    out.push({ type: 'face', p: face.c, z: vr.norm(face.n), src: { kind: 'face', sig: face } });
    // where two edges of this face would meet if extended (the sharp corner under a chamfer or fillet)
    const n = vr.norm(face.n), inPlane = q => Math.abs(vr.dot(vr.sub(q, face.c), n)) < 1e-6;
    const ls = edges.filter(e => e.type === 'LINE' && e.a && e.b && inPlane(e.a) && inPlane(e.b)).slice(0, 80);
    const verts = ls.flatMap(e => [e.a, e.b]);
    for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
      const q = lineMeet(ls[i], ls[j]); if (!q || verts.some(v => vr.dist(v, q) < 1e-6) || out.some(r => r.type === 'intersection' && vr.dist(r.p, q) < 1e-6)) continue;
      // only short extensions: within half of each edge's length from its nearest end (not far-away crossings)
      const reach = l => Math.min(vr.dist(q, l.a), vr.dist(q, l.b)) <= 0.5 * (l.len || vr.dist(l.a, l.b));
      if (!reach(ls[i]) || !reach(ls[j])) continue;
      out.push({ type: 'intersection', p: q, z: n, x: vr.norm(vr.sub(ls[i].b, ls[i].a)), src: { kind: 'edge2', a: ls[i], b: ls[j] }, zsrc: { kind: 'face', sig: face } });
    }
    // midway between this face and the nearest parallel face looking the other way (centre of a slot or a wall)
    let opp = null, od = Infinity;
    for (const f of faces || []) { if (f.type !== 'PLANE' || !f.n || vr.dot(vr.norm(f.n), n) > -0.999) continue; const dd = vr.dot(vr.sub(face.c, f.c), n); if (dd > 1e-6 && dd < od) { od = dd; opp = f; } }
    if (opp) out.push({ type: 'between', p: vr.sub(face.c, vr.mul(n, od / 2)), z: n, src: { kind: 'face2', a: face, b: opp } });
  }
  if (face?.type === 'CYLINDRE' && face.ap && face.ax) out.push({ type: 'axis', p: face.ap, z: vr.norm(face.ax), src: { kind: 'face', sig: face } });
  // vertices are shared by several edges: keep one per position
  const seen = [];
  return out.filter(r => { if (r.type !== 'vertex') return true; if (seen.some(q => vr.dist(q, r.p) < 1e-7)) return false; seen.push(r.p); return true; });
}
// Order candidates near the cursor: d = screen distance in pixels; references within `radius` px compete by type
// priority, then distance. Face and axis references are always available as the fallback.
function rankRefs(cands, radius = 16) {
  // a virtual corner lies outside the material, so it is offered from a little further away
  const near = cands.filter(c => c.type === 'face' || c.type === 'axis' || c.type === 'between' || c.type === 'cplane' || c.d <= (c.type === 'intersection' ? radius * 1.75 : radius));
  return near.sort((a, b) => ((REF_PRIO[a.type] ?? 3) + Math.min(a.d, radius) / radius * 0.9) - ((REF_PRIO[b.type] ?? 3) + Math.min(b.d, radius) / radius * 0.9));
}
// where two lines in one plane meet (null if parallel or skew)
function lineMeet(l1, l2) {
  const d1 = vr.sub(l1.b, l1.a), d2 = vr.sub(l2.b, l2.a), w = vr.sub(l1.a, l2.a), c = vr.cross(d1, d2), cc = vr.dot(c, c);
  if (cc < 1e-12 * vr.dot(d1, d1) * vr.dot(d2, d2)) return null;
  const t = vr.dot(vr.cross(vr.sub(l2.a, l1.a), d2), c) / cc, q = vr.add(l1.a, vr.mul(d1, t));
  const s2 = vr.dot(vr.sub(q, l2.a), d2) / vr.dot(d2, d2), q2 = vr.add(l2.a, vr.mul(d2, s2));
  return vr.dist(q, q2) < 1e-6 ? q : null;
}
// sizes within a factor of 2 count as the same edge (a resized part keeps its references)
const refSimilar = (a, b) => { a = Math.abs(+a || 0); b = Math.abs(+b || 0); return !(a || b) || (Math.min(a, b) > 0 && Math.max(a, b) / Math.min(a, b) <= 2); };
// The same edge or face on a rebuilt body: same type, same direction, similar size, then the nearest.
function rematchSig(sigs, kind, r, maxDist = 50) {
  let best = null, bd = Infinity;
  for (const s of sigs) {
    if (s.type !== r.type) continue;
    let d;
    if (kind === 'edge' && r.type === 'LINE') {
      if (!s.a || !s.b || !r.a || !r.b) continue;
      if (Math.abs(vr.dot(vr.norm(vr.sub(s.b, s.a)), vr.norm(vr.sub(r.b, r.a)))) < 0.999) continue;
      if (!refSimilar(s.len, r.len)) continue;
      d = vr.dist(s.p, r.p);
    } else if (kind === 'edge' && r.type === 'CIRCLE') {
      if (!s.ax || !s.cc || !r.ax || !r.cc || Math.abs(vr.dot(s.ax, r.ax)) < 0.999) continue;
      if (!refSimilar(s.len, r.len)) continue;
      d = vr.dist(s.cc, r.cc);
    } else if (kind === 'face' && r.type === 'PLANE') {
      if (!s.n || vr.dot(s.n, r.n) < 0.999) continue;
      d = vr.dist(s.c, r.c);
    } else if (kind === 'face' && r.type === 'CYLINDRE') {
      if (!s.ax || !r.ax || Math.abs(vr.dot(s.ax, r.ax)) < 0.999 || !refSimilar(s.r, r.r)) continue;
      const w = vr.sub(s.ap, r.ap), ax = vr.norm(r.ax);
      d = vr.len(vr.sub(w, vr.mul(ax, vr.dot(w, ax))));       // distance between the axes
    } else d = vr.dist(s.p || s.c, r.p || r.c);
    if (d < bd) { bd = d; best = s; }
  }
  return best && bd <= maxDist ? best : null;
}
// Where a stored reference is now. edges / faces: the body's current signatures. Returns { p, z, x } or null.
function resolveRef(ref, edges, faces) {
  if (ref.type === 'origin') return { p: ref.p, z: ref.z, x: ref.x };
  if (ref.type === 'intersection') {
    const a = rematchSig(edges, 'edge', ref.src.a), b = rematchSig(edges, 'edge', ref.src.b); if (!a || !b) return null;
    const q = lineMeet(a, b); if (!q) return null;
    let z = ref.z; if (ref.zsrc) { const f = rematchSig(faces, 'face', ref.zsrc.sig); if (f?.n) z = vr.norm(f.n); }
    return { p: q, z, x: ref.x };
  }
  if (ref.type === 'between') {
    const a = rematchSig(faces, 'face', ref.src.a), b = rematchSig(faces, 'face', ref.src.b); if (!a || !b) return null;
    const n = vr.norm(a.n), dd = vr.dot(vr.sub(a.c, b.c), n);
    return { p: vr.sub(a.c, vr.mul(n, dd / 2)), z: n };
  }
  const sigs = ref.src.kind === 'edge' ? edges : faces;
  const s = rematchSig(sigs, ref.src.kind, ref.src.sig); if (!s) return null;
  const keepSign = (v, was) => (vr.dot(v, was) < 0 ? vr.mul(vr.norm(v), -1) : vr.norm(v));
  let z = ref.z, x = ref.x;
  if (ref.zsrc) { const f = rematchSig(faces, 'face', ref.zsrc.sig); if (f?.n) z = vr.norm(f.n); }
  switch (ref.type) {
    case 'vertex': {
      // follow the edge's move, then take the end nearest to where the vertex was
      const target = vr.add(ref.p, vr.sub(s.p, ref.src.sig.p));
      const p = vr.dist(s.a, target) <= vr.dist(s.b, target) ? s.a : s.b;
      return { p, z, x: keepSign(vr.sub(s.b, s.a), x || [1, 0, 0]) };
    }
    case 'midpoint': return { p: s.p, z, x: keepSign(vr.sub(s.b, s.a), x || [1, 0, 0]) };
    case 'center': return { p: s.cc, z: keepSign(s.ax, ref.z) };
    case 'axis': {
      // keep the same spot along the axis relative to the face
      const ax = vr.norm(s.ax), t = vr.dot(vr.sub(ref.p, ref.src.sig.ap), vr.norm(ref.src.sig.ax));
      return { p: vr.add(s.ap, vr.mul(ax, t)), z: keepSign(ax, ref.z) };
    }
    case 'face': return { p: s.c, z: vr.norm(s.n) };
  }
  return null;
}
// A right-handed frame (column vectors x, y, z and origin) with z along `z` and x as close to `xHint` as possible.
function refFrame(p, z, xHint) {
  const zz = vr.norm(z);
  let a = xHint && Math.abs(vr.dot(vr.norm(xHint), zz)) < 0.95 ? vr.norm(xHint) : (Math.abs(zz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  const x = vr.norm(vr.sub(a, vr.mul(zz, vr.dot(a, zz)))), y = vr.cross(zz, x);
  return { x, y, z: zz, o: p };
}
// Joint type to suggest for two references (the user can always choose another).
function suggestJoint(ta0, tb0) {
  const map = t => ({ round: 'center', axis: 'axis', point: 'vertex', face: 'face' })[REF_KIND[t]] || t;
  const ta = map(ta0), tb = map(tb0), round = t => t === 'center' || t === 'axis';
  if (ta === 'axis' && tb === 'axis') return { type: 'cylindrical', why: 'Shaft in hole: both origins are on cylinder axes, so the part can turn and slide' };
  if (round(ta) && round(tb)) return { type: 'revolute', why: 'Both origins are on round edges or axes, so the axes line up and the part turns' };
  if (ta === 'vertex' && tb === 'vertex') return { type: 'ball', why: 'Point to point: the part can turn in any direction about the shared point' };
  if (ta === 'face' && tb === 'face') return { type: 'rigid', why: 'Face to face: the faces sit flush (choose Planar to let the part slide on the face)' };
  return { type: 'rigid', why: 'The two origins are joined and the part is fixed to the other one' };
}
// Degrees of freedom each joint type leaves (used for the remaining-motion summary)
const JOINT_DOF = { rigid: 0, revolute: 1, slider: 1, cylindrical: 2, planar: 3, ball: 3 };
