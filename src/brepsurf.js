// ===== Surface modeling (exact engine): open faces and shells as bodies =====
// Surface bodies live in out.bodies like solids; b.surface marks them (no volume, shown two-sided).
const SURF_TYPES = new Set(['sextrude', 'srevolve', 'patch', 'soffset', 'sloft', 'ssweep', 'ruled', 'trim', 'untrim', 'sextend', 'stitch', 'unstitch', 'reverse', 'deleteface']);
const SURF_FACE_PICK = new Set(['soffset', 'untrim', 'deleteface']);
const SURF_EDGE_PICK = new Set(['ruled', 'sextend']);

function isSurfaceShape(shape) {
  try { for (const _ of RC.iterTopo(shape.wrapped, 'solid')) return false; return true; } catch (e) { return false; }
}
const occ = () => RC.getOC();
const gpVec = v => new (occ()).gp_Vec(v[0], v[1], v[2]);
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const P3 = q => [q.x, q.y, q.z];
function compoundOf(shapes) { return shapes.length === 1 ? shapes[0] : RC.makeCompound(shapes); }
function sewShapes(shapes, tol = 1e-4) {
  const oc = occ(), sw = new oc.BRepBuilderAPI_Sewing(tol, true, true, true, false);
  for (const s of shapes) sw.Add(s.wrapped);
  sw.Perform(new oc.Message_ProgressRange());
  return RC.cast(sw.SewedShape());
}
// all wires of a sketch: open and closed chains of lines/arcs/splines, plus circles
function sketchWires(f, out, key = 'sketch') {
  const sk = out.sketches.get(f[key]);
  if (!sk) throw new Error('Choose a sketch that comes before this feature');
  const geo = sk.feature.geo, pi = placementInfo(sk.feature, out), P = brepPlane(pi.base, pi.offset, pi.flip);
  const wires = [];
  if (geo?.curves?.length) {
    const solved = solveSketch(geo); if (!solved.ok) throw new Error('The sketch constraints conflict');
    const { paths, branching } = geoPaths(geo, solved);
    if (branching) throw new Error('A chain in the sketch branches. Surfaces need simple chains of curves.');
    for (const p of paths) wires.push(segsPen(p.segs, p.closed).sketchOnPlane(P.plane).wire);
    const pos = id => id === 'O' ? { x: 0, y: 0 } : solved.points.get(id);
    for (const c of geo.curves) if (c.kind === 'circle' && !c.constr) {
      const r = solved.radii.get(c.id) ?? +c.r, cc = pos(c.c);
      wires.push(RC.drawCircle(r).translate([cc.x, cc.y]).sketchOnPlane(P.plane).wire);
    }
  }
  if (!wires.length) throw new Error('The sketch has no curves to make a surface from');
  return { wires, P, sk };
}
// the body (and its picked faces/edges) a pick-based surface feature works on
function pickedOn(f, out, kind) {
  const sigOf = kind === 'face' ? faceSig : edgeSig;
  for (const b of out.bodies.values()) {
    const list = kind === 'face' ? b.shape.faces : b.shape.edges, hs = matchRefs(list, f.edges || [], sigOf, kind === 'face' ? 'c' : 'p');
    const picked = list.filter(x => hs.has(x.hashCode));
    if (picked.length) return { b, list, picked };
    list.forEach(x => x.delete?.());
  }
  return null;
}
function edgeMid(e) { return P3(e.pointAt(0.5)); }
// the face of `faces` an edge lies on (first match), for ruled / extend directions
function faceOfEdge(faces, e) {
  const v = RC.makeVertex(edgeMid(e));
  return faces.find(fc => { try { return RC.measureDistanceBetween(fc, v) < 1e-6; } catch (err) { return false; } });
}
function ruledStrip(e, face, d, mode, flip) {
  const m = edgeMid(e), t = vnorm(P3(e.tangentAt(0.5)));
  let n = vnorm(P3(face.normalAt(e.pointAt(0.5))));
  let dir;
  if (mode === 'normal') dir = n;
  else {
    dir = vnorm(vcross(t, n));
    const c = P3(face.center);
    if (vdot(dir, vsub(m, c)) < 0) dir = dir.map(x => -x);   // away from the face
  }
  if (flip) dir = dir.map(x => -x);
  const oc = occ(), mk = new oc.BRepPrimAPI_MakePrism(e.wrapped, gpVec(dir.map(x => x * d)), true, true);
  return RC.cast(mk.Shape());
}
function surfaceStep(f, out) {
  const oc = occ();
  switch (f.type) {
    case 'sextrude': {
      const { wires, P } = sketchWires(f, out), d = +f.distance;
      if (!(Math.abs(d) > 0)) throw new Error('Distance must not be 0 mm');
      const n = [P.n.x, P.n.y, P.n.z], sym = f.direction === 'symmetric', sgn = f.direction === 'reverse' ? -1 : 1;
      const shapes = wires.map(w => {
        let src = w;
        if (sym) src = w.clone().translate(n.map(x => -x * d / 2));
        return RC.cast(new oc.BRepPrimAPI_MakePrism(src.wrapped, gpVec(n.map(x => x * d * sgn)), true, true).Shape());
      });
      return bNew(out, f.id, T(compoundOf(shapes)), f.id);
    }
    case 'srevolve': {
      const { wires, P } = sketchWires(f, out), ang = Math.min(360, Math.abs(+f.angle || 360));
      let o, dvec;
      if (f.axis && f.axis !== 'u' && f.axis !== 'v') { const A = axisOf(f.axis, out); o = A.o; dvec = A.d; }
      else { o = [P.o.x, P.o.y, P.o.z]; const a = f.axis === 'v' ? P.v : P.u; dvec = [a.x, a.y, a.z]; }
      const ax = new oc.gp_Ax1(new oc.gp_Pnt(o[0], o[1], o[2]), new oc.gp_Dir(dvec[0], dvec[1], dvec[2]));
      const shapes = wires.map(w => RC.cast(new oc.BRepPrimAPI_MakeRevol(w.wrapped, ax, ang * Math.PI / 180, true).Shape()));
      return bNew(out, f.id, T(compoundOf(shapes)), f.id);
    }
    case 'patch': {
      if ((f.edges || []).length) {
        // fill a closed loop of picked edges (usually the open boundary of a surface)
        const pk = pickedOn(f, out, 'edge'); if (!pk) throw new Error('The picked edges no longer exist');
        const wire = RC.assembleWire(pk.picked.map(e => e.clone()));
        let face; try { face = RC.makeFace(wire.clone()); } catch (e) { face = RC.makeNonPlanarFace(wire); }
        const res = f.merge && pk.b.surface ? sewShapes([pk.b.shape, face]) : face;
        if (f.merge && pk.b.surface) bReplace(out, pk.b.id, T(res)); else bNew(out, f.id, T(face), f.id);
        pk.list.forEach(x => x.delete?.());
        return;
      }
      const sk = out.sketches.get(f.sketch); if (!sk) throw new Error('Choose a sketch, or click the boundary edges of a surface');
      const pi = placementInfo(sk.feature, out);
      const ss = asSketches(sketchDrawing(sk.feature, f.regions).sketchOnPlane(brepPlane(pi.base, pi.offset, pi.flip).plane));
      return bNew(out, f.id, T(compoundOf(ss.map(s => s.face()))), f.id);
    }
    case 'soffset': {
      const pk = pickedOn(f, out, 'face'); if (!pk) throw new Error('Click the faces to offset');
      const d = +f.distance; if (!d) throw new Error('Distance must not be 0 mm');
      const shapes = pk.picked.map(fc => { const mo = new oc.BRepOffsetAPI_MakeOffsetShape(); mo.PerformBySimple(fc.wrapped, d); return RC.cast(mo.Shape()); });
      pk.list.forEach(x => x.delete?.());
      return bNew(out, f.id, T(shapes.length > 1 ? sewShapes(shapes) : shapes[0]), f.id);
    }
    case 'sloft': {
      const ids = (f.sketches || []).filter(id => out.sketches.has(id));
      if (ids.length < 2) throw new Error('Choose at least two sketches to loft between');
      const ts = new oc.BRepOffsetAPI_ThruSections(false, !!f.ruled, 1e-6);
      for (const id of ids) { const { wires } = sketchWires({ sketch: id }, out); ts.AddWire(wires[0].wrapped); }
      ts.Build(new oc.Message_ProgressRange());
      return bNew(out, f.id, T(RC.cast(ts.Shape())), f.id);
    }
    case 'ssweep': {
      const prof = sketchWires(f, out, 'sketch'), path = sketchWires(f, out, 'path');
      const spine = path.wires[0];
      const shapes = prof.wires.map(w => RC.cast(new oc.BRepOffsetAPI_MakePipe(spine.wrapped, w.wrapped).Shape()));
      return bNew(out, f.id, T(compoundOf(shapes)), f.id);
    }
    case 'ruled': case 'sextend': {
      const pk = pickedOn(f, out, 'edge'); if (!pk) throw new Error('Click the edges');
      const d = +f.distance; if (!(d > 0)) throw new Error('Distance must be greater than 0 mm');
      const faces = pk.b.shape.faces;
      const strips = pk.picked.map(e => { const fc = faceOfEdge(faces, e); if (!fc) throw new Error('An edge has no face'); return ruledStrip(e, fc, d, f.type === 'sextend' ? 'tangent' : (f.mode || 'normal'), !!f.flip); });
      faces.forEach(x => x.delete?.()); pk.list.forEach(x => x.delete?.());
      if (f.type === 'sextend') {
        if (!pk.b.surface) throw new Error('Extend works on surface bodies');
        return bReplace(out, pk.b.id, T(sewShapes([pk.b.shape, ...strips])));
      }
      return bNew(out, f.id, T(strips.length > 1 ? sewShapes(strips) : strips[0]), f.id);
    }
    case 'trim': {
      const b = out.bodies.get(f.body); if (!b) throw new Error('Choose the surface body to trim');
      let toolShape, side;
      if (f.toolBody) {
        const tb = out.bodies.get(f.toolBody); if (!tb) throw new Error('The trim tool body is missing');
        toolShape = tb.shape;
        const tf = tb.shape.faces;
        side = c => {
          let best = null, bd = Infinity; const v = RC.makeVertex(c);
          for (const fc of tf) { const dd = RC.measureDistanceBetween(fc, v); if (dd < bd) { bd = dd; best = fc; } }
          const [u, w] = best.uvCoordinates(c), p = P3(best.pointOnSurface(u, w)), n = P3(best.normalAt(best.pointOnSurface(u, w)));
          return vdot(vsub(c, p), n);
        };
      } else {
        const M = planeFrameOf(f.tool || 'XY', out), e = M.elements, n = [e[8], e[9], e[10]], o = [e[12], e[13], e[14]];
        toolShape = RC.cast(new oc.BRepBuilderAPI_MakeFace(RC.makePln(o, n)).Face());
        side = c => vdot(vsub(c, o), n);
      }
      const args = new oc.NCollection_List_TopoDS_Shape(), tools = new oc.NCollection_List_TopoDS_Shape();
      args.Append(b.shape.wrapped); tools.Append(toolShape.wrapped);
      const sp = new oc.BRepAlgoAPI_Splitter(); sp.SetArguments(args); sp.SetTools(tools); sp.Build();
      if (sp.HasErrors()) throw new Error('Could not trim with that tool');
      const split = RC.cast(sp.Shape()), keepPos = f.keep !== 'negative';
      const kept = split.faces.filter(fc => { const c = P3(fc.center); return (side(c) >= 0) === keepPos; });
      if (!kept.length) throw new Error('Nothing is left on that side. Flip the side to keep.');
      if (kept.length === split.faces.length) throw new Error('The tool does not cut the surface');
      return bReplace(out, b.id, T(kept.length > 1 ? sewShapes(kept) : kept[0]));
    }
    case 'untrim': {
      const pk = pickedOn(f, out, 'face'); if (!pk) throw new Error('Click the faces to untrim');
      const keep = pk.list.filter(x => !pk.picked.includes(x));
      const rebuilt = pk.picked.map(fc => { const planar = fc.geomType === 'PLANE'; const w = fc.clone().outerWire(); return planar ? RC.makeFace(w) : RC.makeNonPlanarFace(w); });
      return bReplace(out, pk.b.id, T(sewShapes([...keep, ...rebuilt])));
    }
    case 'deleteface': {
      const pk = pickedOn(f, out, 'face'); if (!pk) throw new Error('Click the faces to delete');
      const keep = pk.list.filter(x => !pk.picked.includes(x));
      if (!keep.length) { out.bodies.delete(pk.b.id); return; }
      return bReplace(out, pk.b.id, T(keep.length > 1 ? sewShapes(keep) : keep[0]));
    }
    case 'stitch': {
      const ids = (f.bodies || []).filter(id => out.bodies.has(id));
      if (ids.length < 1) throw new Error('Choose the surface bodies to stitch');
      const sewn = sewShapes(ids.map(id => out.bodies.get(id).shape), Math.max(1e-6, +f.tolerance || 0.01));
      let res = sewn;
      if (f.solid !== false) {
        try {
          const shells = [...RC.iterTopo(sewn.wrapped, 'shell')].map(s => RC.cast(s));
          if (shells.length === 1) { const s = RC.makeSolid(shells); if (RC.measureVolume(s) > 1e-9 && new oc.BRepCheck_Analyzer(s.wrapped, true, false, false).IsValid()) res = s; }
        } catch (e) { /* stays a surface */ }
      }
      const first = ids[0];
      ids.slice(1).forEach(id => out.bodies.delete(id));
      return bReplace(out, first, T(res));
    }
    case 'unstitch': {
      const b = out.bodies.get(f.body); if (!b) throw new Error('Choose a body to unstitch');
      const faces = b.shape.faces;
      out.bodies.delete(b.id);
      faces.forEach((fc, k) => bNew(out, f.id + ':' + k, T(fc), f.id));
      return;
    }
    case 'reverse': {
      const b = out.bodies.get(f.body); if (!b) throw new Error('Choose a surface body');
      return bReplace(out, b.id, T(RC.cast(b.shape.wrapped.Reversed())));
    }
  }
}
