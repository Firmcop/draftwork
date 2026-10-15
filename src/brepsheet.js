// ===== Sheet metal (exact engine) =====
// A sheet body carries a record in out.sheet (bodyId -> rec) describing how it unfolds:
//   rec = { t, k, R, flat: Drawing pieces (2D, flat frame), bends: [[x,y,x,y]], segs: [seg], frame: 4x4 elements (flat frame -> model), z0 }
//   seg = a straight sheet edge that can take a flange: A,B (3D line on one face), C,D (the same edge on the other face),
//         nA (unit, away from the material at AB), out (unit, outward, in the sheet plane), fa, fb (flat 2D of the edge), fo (flat outward)
const SHEET_TYPES = new Set(['flange', 'contourflange', 'unfold', 'refold']);
const v3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const v2 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const SM_KEY = { t: 'thickness', R: 'bendRadius' };
const sheetNum = (f, k) => { const v = +f[SM_KEY[k]]; if (!(v > 0)) throw new Error(`${k === 't' ? 'Thickness' : 'Bend radius'} must be greater than 0 mm`); return v; };
const sheetK = f => (f.kFactor !== '' && f.kFactor != null && +f.kFactor >= 0 && +f.kFactor <= 1) ? +f.kFactor : 0.44;
function mApply(M, p) { const e = M.elements; return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]]; }
function mDir(M, d) { const e = M.elements; return vnorm([e[0] * d[0] + e[4] * d[1] + e[8] * d[2], e[1] * d[0] + e[5] * d[1] + e[9] * d[2], e[2] * d[0] + e[6] * d[1] + e[10] * d[2]]); }
const rectDrawing = (a, b, c, d) => RC.draw(a).lineTo(b).lineTo(c).lineTo(d).close();
function blueprintsOf(shape) { if (!shape) return []; if (shape.curves) return [shape]; return (shape.blueprints || []).flatMap(blueprintsOf); }
// polylines (2D) of a drawing: lines exact, curves sampled
function drawingPolylines(d) {
  return blueprintsOf(d.innerShape).map(bp => {
    const pts = [];
    for (const c of bp.curves) {
      const n = c.geomType === 'LINE' ? 1 : 24, t0 = c.firstParameter, t1 = c.lastParameter;
      for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push(c.value(t0 + (t1 - t0) * i / n));
    }
    return pts.map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
  });
}
function insideDrawing(d, p) { let n = 0; for (const bp of blueprintsOf(d.innerShape)) if (bp.isInside(p)) n++; return n % 2 === 1; }

// ---- base flange from a sketch ----
function baseFlange(f, out) {
  const sk = out.sketches.get(f.sketch); if (!sk) throw new Error('Choose a sketch with a closed profile, or click an edge of a sheet metal body');
  const t = sheetNum(f, 't'), R = sheetNum(f, 'R'), k = sheetK(f);
  const pi = placementInfo(sk.feature, out), P = brepPlane(pi.base, pi.offset, pi.flip, f.flip ? -t : 0), M = P.M.clone();
  if (f.flip) M.multiply(new THREE.Matrix4().makeTranslation(0, 0, -t));
  const drawing = sketchDrawing(sk.feature, f.regions);
  const shape = T(drawing.sketchOnPlane(P.plane).extrude(t));
  const segs = [];
  for (const bp of blueprintsOf(drawing.innerShape)) for (const c of bp.curves) {
    if (c.geomType !== 'LINE') continue;
    const a = c.firstPoint, b = c.lastPoint, L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const e = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let o = [e[1], -e[0]]; if (insideDrawing(drawing, v2(m, o, Math.min(1e-3, L / 10)))) o = [-o[0], -o[1]];
    segs.push({ A: mApply(M, [a[0], a[1], t]), B: mApply(M, [b[0], b[1], t]), C: mApply(M, [a[0], a[1], 0]), D: mApply(M, [b[0], b[1], 0]), nA: mDir(M, [0, 0, 1]), out: mDir(M, [o[0], o[1], 0]), fa: [a[0], a[1]], fb: [b[0], b[1]], fo: o });
  }
  bNew(out, f.id, shape, f.id);
  out.sheet.set(f.id, { t, R, k, flat: [drawing], bends: [], segs, frame: [...M.elements] });
}

// cross-section of a bend + flange in a local frame (x = outward, y = toward the bend side); material of the sheet is at x <= 0, -t <= y <= 0
function bendSection(t, R, ang, H) {
  const phi = -Math.PI / 2 + ang, C = [0, R], cs = Math.cos(phi), sn = Math.sin(phi), td = [-sn, cs];
  const Pi1 = [C[0] + R * cs, C[1] + R * sn], Po1 = [C[0] + (R + t) * cs, C[1] + (R + t) * sn];
  const mid = (r, a0, a1) => { const a = (a0 + a1) / 2; return [C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]; };
  let pen = RC.draw([0, 0]).threePointsArcTo(Pi1, mid(R, -Math.PI / 2, phi));
  if (H > 1e-9) pen = pen.lineTo(v2(Pi1, td, H)).lineTo(v2(Po1, td, H));
  pen = pen.lineTo(Po1).threePointsArcTo([0, -t], mid(R + t, -Math.PI / 2, phi));
  return { drawing: pen.close(), Pi1, Po1, td, phi };
}
// ---- edge flange on straight sheet edges ----
function edgeFlange(f, out) {
  const H = +f.height, ang = (+f.angle || 90) * Math.PI / 180;
  if (!(H >= 0)) throw new Error('Height must be 0 mm or more');
  if (!(ang > 0 && ang <= Math.PI)) throw new Error('Angle must be between 0° and 180°');
  let done = 0;
  for (const ref of f.edges || []) {
    if (ref.type !== 'LINE' || !ref.a || !ref.b) throw new Error('Flanges go on straight edges');
    // find the sheet edge this ref lies on: parallel, nearest line (tolerant to thickness and size changes); flanges span the whole edge
    let hit = null, best = Infinity;
    const re = vnorm(vsub(ref.b, ref.a)), rm = [(ref.a[0] + ref.b[0]) / 2, (ref.a[1] + ref.b[1]) / 2, (ref.a[2] + ref.b[2]) / 2];
    for (const [bid, rec] of out.sheet) {
      if (!out.bodies.has(bid) || rec.unfolded) continue;
      for (const sg of rec.segs) for (const side of ['AB', 'CD']) {
        const P0 = side === 'AB' ? sg.A : sg.C, P1 = side === 'AB' ? sg.B : sg.D, L = dist3(P0, P1), e = vnorm(vsub(P1, P0));
        if (Math.abs(vdot(e, re)) < 0.999) continue;
        const w = vsub(rm, P0), sp = vdot(w, e), dd = Math.hypot(...vsub(w, e.map(x => x * sp)));
        if (sp < -1e-3 || sp > L + 1e-3 || dd > Math.max(2 * rec.t, 1)) continue;
        if (dd < best) { best = dd; hit = { bid, rec, sg, side, P0, e, L, s0: 0, s1: L }; }
      }
    }
    if (!hit) throw new Error('Pick a straight outer edge of a sheet metal body (made with Flange or Contour Flange)');
    const { rec, sg, e } = hit, t = rec.t, R = +f.bendRadius > 0 ? +f.bendRadius : rec.R, k = rec.k;
    const flip = !!f.flip !== (hit.side === 'CD');
    const n = flip ? sg.nA.map(x => -x) : sg.nA, start = v3(flip ? sg.C : sg.A, e, hit.s0), len = hit.s1 - hit.s0;
    const sec = bendSection(t, R, ang, H);
    const zDir = vcross(sg.out, n), forward = vdot(zDir, e) > 0;
    const origin = forward ? start : v3(start, e, len);
    const pl = new RC.Plane(origin, sg.out, zDir);
    const piece = T(sec.drawing.sketchOnPlane(pl).extrude(len));
    const b = out.bodies.get(hit.bid);
    bReplace(out, hit.bid, T(b.shape.fuse(piece)));
    // unfold bookkeeping
    const BA = ang * (R + k * t), fl = BA + H;
    const fs0 = v2(sg.fa, vsub2(sg.fb, sg.fa), hit.s0 / hit.L), fs1 = v2(sg.fa, vsub2(sg.fb, sg.fa), hit.s1 / hit.L);
    const fo = sg.fo, flat = [...rec.flat, rectDrawing(fs0, fs1, v2(fs1, fo, fl), v2(fs0, fo, fl))];
    const bends = [...rec.bends, [...fs0, ...fs1], [...v2(fs0, fo, BA), ...v2(fs1, fo, BA)]];
    const L3 = (x, y) => v3(v3(start, sg.out, x), n, y);
    const inner = v2(sec.Pi1, sec.td, H), outer = v2(sec.Po1, sec.td, H);
    const nAin = vnorm(vsub(L3(...inner), L3(...outer)));
    const newSeg = { A: L3(...inner), B: v3(L3(...inner), e, len), C: L3(...outer), D: v3(L3(...outer), e, len), nA: nAin, out: vnorm(v3([0, 0, 0], v3(sg.out.map(x => x * sec.td[0]), n, sec.td[1]))), fa: v2(fs0, fo, fl), fb: v2(fs1, fo, fl), fo };
    out.sheet.set(hit.bid, { ...rec, flat, bends, segs: [...rec.segs, newSeg] });
    done++;
  }
  if (!done) throw new Error('Click the straight edges to add flanges to');
}
const vsub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

// ---- contour flange: an open chain of lines, bent with the bend radius, thickness to one side, extruded to a width ----
function contourFlange(f, out) {
  const ps = out.sketches.get(f.sketch); if (!ps) throw new Error('Choose a sketch with an open chain of lines');
  const t = sheetNum(f, 't'), R = sheetNum(f, 'R'), k = sheetK(f), W = +f.width; if (!(W > 0)) throw new Error('Width must be greater than 0 mm');
  const paths = sketchChain(ps), path = paths[0];
  if (path.closed) throw new Error('Contour flange needs an open chain');
  if (path.segs.some(s => s.t !== 'line')) throw new Error('Contour flange uses straight lines; bends are added at the corners');
  const pts = [path.segs[0].a, ...path.segs.map(s => s.b)];
  const sA = f.side === 'right' ? -t : f.side === 'center' ? -t / 2 : 0, sB = sA + t;
  const nL = u => [-u[1], u[0]], unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const U = pts.slice(1).map((p, i) => unit(pts[i], p));
  // corners: tangent points, centre and radius at offset s
  const corners = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const u1 = U[i - 1], u2 = U[i], cr = u1[0] * u2[1] - u1[1] * u2[0], dt = u1[0] * u2[0] + u1[1] * u2[1], alpha = Math.atan2(cr, dt), sg = Math.sign(alpha);
    if (Math.abs(alpha) < 1e-9) { corners.push(null); continue; }
    const Rc = R + Math.max(sA * sg, sB * sg), tl = Rc * Math.tan(Math.abs(alpha) / 2);
    const T1 = v2(pts[i], u1, -tl), T2 = v2(pts[i], u2, tl), C = v2(T1, nL(u1), sg * Rc);
    corners.push({ u1, u2, alpha, sg, Rc, tl, T1, T2, C });
  }
  // check segments are long enough for their bends
  for (let i = 0; i < U.length; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), used = (corners[i - 1]?.tl || 0) + (corners[i]?.tl || 0);
    if (used > L + 1e-9) throw new Error('A line is too short for the bends at its ends. Lengthen it or use a smaller bend radius.');
  }
  const offsetPath = s => {   // list of [kind, point(s)] along the chain at offset s
    const seq = [['M', v2(pts[0], nL(U[0]), s)]];
    corners.forEach((c, i) => {
      if (!c) return;
      const a = v2(c.T1, nL(c.u1), s), b = v2(c.T2, nL(c.u2), s), r = c.Rc - s * c.sg, mDir = vnorm2(v2(vsub2(a, c.C), vsub2(b, c.C))), m = v2(c.C, mDir, Math.abs(r));
      seq.push(['L', a], ['A', b, m]);
    });
    seq.push(['L', v2(pts.at(-1), nL(U.at(-1)), s)]);
    return seq;
  };
  const left = offsetPath(sB), right = offsetPath(sA);
  let pen = RC.draw(left[0][1]);
  for (const [kd, p, m] of left.slice(1)) pen = kd === 'L' ? pen.lineTo(p) : pen.threePointsArcTo(p, m);
  pen = pen.lineTo(right.at(-1)[1]);
  for (let i = right.length - 1; i > 0; i--) {   // walk back along the other side
    const [kd, , m] = right[i], prev = right[i - 1][1];
    if (kd === 'A') pen = pen.threePointsArcTo(right[i - 1][1], m); else pen = pen.lineTo(prev);
  }
  const drawing = pen.close();
  const pi = placementInfo(ps.feature, out), shift = f.direction === 'symmetric' ? -W / 2 : f.direction === 'reverse' ? -W : 0;
  const P = brepPlane(pi.base, pi.offset, pi.flip, shift);
  const shape = T(drawing.sketchOnPlane(P.plane).extrude(W));
  // flat pattern: x along the unrolled neutral length, y across the width
  let x = 0; const bends = [];
  for (let i = 0; i < U.length; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) - (corners[i - 1]?.tl || 0) - (corners[i]?.tl || 0);
    x += L;
    const c = corners[i];
    if (c && i < corners.length) { const BA = Math.abs(c.alpha) * (R + k * t); bends.push([x, 0, x, W], [x + BA, 0, x + BA, W]); x += BA; }
  }
  const Lflat = x;
  const M3 = (p2, z) => { const q = mApply(P.M, [p2[0], p2[1], 0]); return v3(q, [P.n.x, P.n.y, P.n.z], z); };
  const D3 = d2 => vnorm([P.u.x * d2[0] + P.v.x * d2[1], P.u.y * d2[0] + P.v.y * d2[1], P.u.z * d2[0] + P.v.z * d2[1]]);
  const Nk = [P.n.x, P.n.y, P.n.z];
  const segAt = (p2, u, sgn, fx) => {   // end edge across the width at chain end p2 with outward dir sgn*u
    const a = v2(p2, nL(u), sB), c = v2(p2, nL(u), sA);
    return { A: M3(a, 0), B: M3(a, W), C: M3(c, 0), D: M3(c, W), nA: D3(nL(u)), out: D3(u.map(q => q * sgn)), fa: [fx, 0], fb: [fx, W], fo: [sgn, 0] };
  };
  const segs = [segAt(pts[0], U[0], -1, 0), segAt(pts.at(-1), U.at(-1), 1, Lflat)];
  // flat frame: origin at the chain start on the sA side, x along the first line, y across the width, z through the thickness
  const o3 = M3(v2(pts[0], nL(U[0]), sA), 0), fx = D3(U[0]), fz = D3(nL(U[0])), fy = Nk;
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(...fx), new THREE.Vector3(...fy), new THREE.Vector3(...fz)).setPosition(...o3);
  bNew(out, f.id, shape, f.id);
  out.sheet.set(f.id, { t, R, k, flat: [rectDrawing([0, 0], [Lflat, 0], [Lflat, W], [0, W])], bends, segs, frame: [...frame.elements], flatSign: vdot(vcross(fx, fy), fz) });
}
const vnorm2 = a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

function flatDrawing(rec) { return rec.flat.slice(1).reduce((a, d) => a.fuse(d), rec.flat[0]); }
function flatSolid(rec) {
  const M = new THREE.Matrix4().fromArray(rec.frame), o = mApply(M, [0, 0, 0]), x = mDir(M, [1, 0, 0]), z = mDir(M, [0, 0, 1]);
  return T(flatDrawing(rec).sketchOnPlane(new RC.Plane(o, x, z)).extrude(rec.t));
}
function sheetStep(f, out) {
  if (f.type === 'flange') return (f.edges || []).length ? edgeFlange(f, out) : baseFlange(f, out);
  if (f.type === 'contourflange') return contourFlange(f, out);
  const bid = f.body || [...out.sheet.keys()].filter(id => out.bodies.has(id)).pop();
  const rec = bid && out.sheet.get(bid);
  if (!rec || !out.bodies.has(bid)) throw new Error('There is no sheet metal body');
  if (f.type === 'unfold') {
    if (rec.unfolded) throw new Error('That body is already unfolded');
    const folded = out.bodies.get(bid).shape;
    bReplace(out, bid, flatSolid(rec));
    out.sheet.set(bid, { ...rec, unfolded: true, folded });
  } else if (f.type === 'refold') {
    if (!rec.unfolded) throw new Error('That body is not unfolded');
    bReplace(out, bid, rec.folded);
    out.sheet.set(bid, { ...rec, unfolded: false, folded: null });
  }
}
// flat pattern for drawings/DXF: outline polylines and bend lines in the flat frame
function sheetFlatData(rec) {
  const d = flatDrawing(rec), polys = drawingPolylines(d);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (const pl of polys) for (const p of pl) { lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])]; hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])]; }
  return { polys, bends: rec.bends, t: rec.t, R: rec.R, k: rec.k, size: [hi[0] - lo[0], hi[1] - lo[1]], lo };
}
