// ===== Plastic part features (exact engine): boss, snap fit, lip/groove, rest =====
const PLASTIC_TYPES = new Set(['boss', 'snapfit', 'lip', 'rest']);
function placedFrame(f, out) {
  const pi = placementInfo(f, out), P = brepPlane(pi.base, pi.offset, pi.flip);
  const O = [P.o.x + P.u.x * (+f.cx || 0) + P.v.x * (+f.cy || 0), P.o.y + P.u.y * (+f.cx || 0) + P.v.y * (+f.cy || 0), P.o.z + P.u.z * (+f.cx || 0) + P.v.z * (+f.cy || 0)];
  let n = [P.n.x, P.n.y, P.n.z]; if (f.reverse) n = n.map(x => -x);
  const u = [P.u.x, P.u.y, P.u.z], v = f.reverse ? [-P.v.x, -P.v.y, -P.v.z] : [P.v.x, P.v.y, P.v.z];
  return { O, n, u, v };
}
const planeXY = (O, x, y) => new RC.Plane(O, x, vcross(x, y));   // a plane whose local x, y are the given directions
function joinTo(out, f, tool) { return bApply(out, f, tool, f.op || (out.bodies.size ? 'join' : 'new'), f.target); }
function plasticStep(f, out) {
  const tan = a => Math.tan((+a || 0) * Math.PI / 180);
  if (f.type === 'boss') {
    const { O, n, u, v } = placedFrame(f, out);
    const Ro = +f.diameter / 2, rh = +f.holeDiameter / 2, H = +f.height, hd = +f.holeDepth > 0 ? +f.holeDepth : H;
    if (!(Ro > 0 && H > 0)) throw new Error('Diameter and height must be greater than 0 mm');
    if (!(rh >= 0 && rh < Ro)) throw new Error('The hole must be smaller than the boss');
    const Rt = Ro - H * tan(f.draftAngle); if (!(Rt > rh + 1e-3)) throw new Error('The draft makes the boss top thinner than the hole');
    const pts = rh > 0 ? (hd >= H ? [[rh, 0], [Ro, 0], [Rt, H], [rh, H]] : [[0, 0], [Ro, 0], [Rt, H], [rh, H], [rh, H - hd], [0, H - hd]]) : [[0, 0], [Ro, 0], [Rt, H], [0, H]];
    let pen = RC.draw(pts[0]); for (const p of pts.slice(1)) pen = pen.lineTo(p);
    let tool = T(pen.close().sketchOnPlane(planeXY(O, u, n)).revolve(n, { origin: O }));
    const nr = Math.round(+f.ribs || 0);
    if (nr > 0) {
      const rt = +f.ribThickness, rl = +f.ribLength, rhH = Math.min(H, +f.ribHeight || H * 0.75);
      if (!(rt > 0 && rl > 0)) throw new Error('Rib thickness and length must be greater than 0 mm');
      const r0 = (Ro + Rt) / 2 - 0.25 * (Ro - Rt) - Math.min(0.2, Ro * 0.05);
      for (let i = 0; i < nr; i++) {
        const a = 2 * Math.PI * i / nr + (+f.ribAngle || 0) * Math.PI / 180, x = vnorm(v3(u.map(q => q * Math.cos(a)), v, Math.sin(a)));
        const sh = vcross(x, n).map(q => -q * rt / 2);
        const rib = RC.draw([r0, 0]).lineTo([Ro + rl, 0]).lineTo([r0, rhH]).close().sketchOnPlane(new RC.Plane(v3(O, sh), x, vcross(x, n))).extrude(rt);
        tool = T(tool.fuse(rib));
      }
    }
    // the screw hole continues into the body below when asked
    const res = joinTo(out, f, tool);
    if (rh > 0 && +f.holeBelow > 0) {
      const hole = T(RC.makeCylinder(rh, +f.holeBelow, v3(O, n, -(+f.holeBelow)), n));
      const id = res.target; if (out.bodies.has(id)) bReplace(out, id, T(out.bodies.get(id).shape.cut(hole)));
    }
    out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'join' });
    return;
  }
  if (f.type === 'snapfit') {
    const { O, n, u, v } = placedFrame(f, out);
    const L = +f.length, t = +f.thickness, w = +f.width, hk = +f.hookDepth, ins = Math.max(5, Math.min(85, +f.insertAngle || 30));
    if (!(L > 0 && t > 0 && w > 0 && hk > 0)) throw new Error('Length, thickness, width and hook depth must be greater than 0 mm');
    const hl = Math.min(L * 0.6, hk / Math.tan(ins * Math.PI / 180));   // ramp length along the beam
    const tTip = Math.max(t * 0.5, t - L * tan(f.draftAngle));
    const a = (+f.orient || 0) * Math.PI / 180, x = vnorm(v3(u.map(q => q * Math.cos(a)), v, Math.sin(a)));
    const prof = RC.draw([0, 0]).lineTo([t, 0]).lineTo([tTip, L - hl]).lineTo([tTip + hk, L - hl]).lineTo([tTip, L]).lineTo([0, L]).close();
    const zN = vcross(x, n), start = v3(O, zN, -w / 2);
    const tool = T(prof.sketchOnPlane(new RC.Plane(start, x, zN)).extrude(w));
    const res = joinTo(out, f, tool);
    out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'join' });
    return;
  }
  if (f.type === 'rest') {
    const { O, n, u, v } = placedFrame(f, out);
    const H = +f.height; if (!(H > 0)) throw new Error('Height must be greater than 0 mm');
    let d;
    if ((f.shape || 'rect') === 'circle') { if (!(+f.diameter > 0)) throw new Error('Diameter must be greater than 0 mm'); d = RC.drawCircle(+f.diameter / 2); }
    else { const w = +f.w, l = +f.d; if (!(w > 0 && l > 0)) throw new Error('Width and length must be greater than 0 mm'); d = RC.drawRoundedRectangle(w, l, Math.min(+f.r || 0, Math.min(w, l) / 2 - 1e-3) || 0); }
    const a = (+f.orient || 0); if (a) d = d.rotate(a, [0, 0]);
    const delta = H * tan(f.draftAngle);
    let tool;
    if (delta > 1e-6) {
      const oc = occ(), top = d.offset(-delta);
      const ts = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
      ts.AddWire(d.sketchOnPlane(new RC.Plane(O, u, n)).wire.wrapped);
      ts.AddWire(top.sketchOnPlane(new RC.Plane(v3(O, n, H), u, n)).wire.wrapped);
      ts.Build(new oc.Message_ProgressRange());
      tool = T(RC.cast(ts.Shape()));
    } else tool = T(d.sketchOnPlane(new RC.Plane(O, u, n)).extrude(H));
    void v;
    const res = joinTo(out, f, tool);
    out.tools.set(f.id, { shape: tool, ...res, op: f.op || 'join' });
    return;
  }
  if (f.type === 'lip') {
    const pk = pickedOn(f, out, 'face'); if (!pk) throw new Error('Click the flat rim face of the shell');
    const face = pk.picked[0];
    try {
      if (face.geomType !== 'PLANE') throw new Error('Lip and groove go on a flat rim face');
      const W = +f.width, H = +f.height, c = +f.clearance || 0;
      if (!(W > 0 && H > 0)) throw new Error('Width and height must be greater than 0 mm');
      const n = vnorm(P3(face.normalAt(face.center)));
      const inner = face.clone().innerWires();
      if (!inner.length) throw new Error('The rim face needs an opening (pick the top face of a shelled wall)');
      const oc = occ(), groove = f.mode === 'groove';
      const ring = (w0, w1, dir, hgt) => {
        const prism = wf => RC.cast(new oc.BRepPrimAPI_MakePrism(wf.wrapped, gpVec(dir.map(x => x * hgt)), true, true).Shape());
        const grow = (wire, d) => {
          const base = RC.makeFace(wire.clone()); if (Math.abs(d) < 1e-9) return base;
          const mo = new oc.BRepOffsetAPI_MakeOffset(base.wrapped, oc.GeomAbs_JoinType.GeomAbs_Arc, false); mo.Perform(d, 0);
          let g = RC.makeFace(RC.cast(mo.Shape()));
          if (RC.measureArea(g) < RC.measureArea(base)) { const mo2 = new oc.BRepOffsetAPI_MakeOffset(base.wrapped, oc.GeomAbs_JoinType.GeomAbs_Arc, false); mo2.Perform(-d, 0); g = RC.makeFace(RC.cast(mo2.Shape())); }
          return g;
        };
        let res = null;
        for (const wi of inner) { const big = prism(grow(wi, w1)), small = prism(grow(wi, w0)); const r = big.cut(small); res = res ? res.fuse(r) : r; }
        return T(res);
      };
      const b = pk.b;
      if (groove) bReplace(out, b.id, T(b.shape.cut(ring(0, W + c, n.map(x => -x), H + c))));
      else bReplace(out, b.id, T(b.shape.fuse(ring(0, W, n, H))));
    } finally { pk.list.forEach(x => x.delete?.()); }
  }
}
