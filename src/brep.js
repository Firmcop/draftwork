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

// size of the model so far (for "through all" extents)
function modelReach(out, o) {
  let r = 100;
  for (const b of out.bodies.values()) { try { const [lo, hi] = b.shape.boundingBox.bounds; for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) r = Math.max(r, Math.hypot(x - o.x, y - o.y, z - o.z)); } catch (e) { } }
  return r * 1.2 + 10;
}
// a target plane (construction plane or picked flat face) as { o, n }
function targetPlane(ref, out) {
  if (!ref) throw new Error('Pick the plane or flat face to extend to');
  const p = resolvePlane(ref, out), M = planeMatrix(p.base, p.offset, p.flip);
  return { o: new THREE.Vector3().setFromMatrixPosition(M), n: new THREE.Vector3(0, 0, 1).transformDirection(M) };
}
// half-space on the side of plane (o, n) that contains point q, as a big box solid
function halfSpaceBox(o, n, q, size) {
  const s = Math.sign(n.clone().dot(q.clone().sub(o))) || 1, nn = n.clone().multiplyScalar(s);
  const u = Math.abs(nn.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0); u.sub(nn.clone().multiplyScalar(u.dot(nn))).normalize();
  const pl = new RC.Plane([o.x, o.y, o.z], [u.x, u.y, u.z], [nn.x, nn.y, nn.z]);
  return T(RC.drawRectangle(4 * size, 4 * size).sketchOnPlane(pl).extrude(2 * size));
}
// extrude with extent types, start offset, taper and thin walls
function extrudeExtents(f, out, drawing, pi) {
  const P0 = brepPlane(pi.base, pi.offset, pi.flip), n = P0.n, o = P0.o;
  let base = drawing;
  if (f.thin) {
    const t = +f.thickness; if (!(t > 0)) throw new Error('Wall thickness must be greater than 0 mm');
    const side = f.thinSide || 'inside';
    try { base = side === 'outside' ? drawing.offset(t).cut(drawing) : side === 'both' ? drawing.offset(t / 2).cut(drawing.offset(-t / 2)) : drawing.cut(drawing.offset(-t)); }
    catch (e) { throw new Error('The wall is too thick for this profile'); }
  }
  const so = +f.startOffset || 0, ext = f.extent || 'distance', dir = f.direction || 'one';
  const segs = [];   // [start along n, length]
  let clip = null;
  if (ext === 'distance') {
    const d = Math.abs(+f.distance); if (!(d > 0)) throw new Error('Distance must be greater than 0 mm');
    segs.push(dir === 'reverse' ? [so - d, d, -1] : dir === 'symmetric' ? [so - d / 2, d, 0] : [so, d, 1]);
  } else if (ext === 'two') {
    const d1 = Math.abs(+f.distance), d2 = Math.abs(+f.distance2); if (!(d1 > 0) || !(d2 > 0)) throw new Error('Both distances must be greater than 0 mm');
    segs.push([so, d1, 1], [so - d2, d2, -1]);
  } else if (ext === 'all') {
    const L = modelReach(out, o);
    segs.push(dir === 'reverse' ? [so - L, L, -1] : dir === 'symmetric' ? [so - L, 2 * L, 0] : [so, L, 1]);
  } else if (ext === 'to') {
    const tp = targetPlane(f.to, out), start = o.clone().add(n.clone().multiplyScalar(so));
    const along = tp.n.dot(n), dist = tp.n.dot(tp.o.clone().sub(start));
    if (Math.abs(along) > 1 - 1e-9) {   // parallel: an exact distance
      const s = dist / along; if (Math.abs(s) < 1e-6) throw new Error('The target is on the sketch plane');
      segs.push(s > 0 ? [so, s, 1] : [so + s, -s, -1]);
    } else {
      if (Math.abs(along) < 1e-6) throw new Error('The target face is parallel to the extrude direction');
      const L = modelReach(out, o), sgn = Math.sign(dist / along) || 1;
      segs.push(sgn > 0 ? [so, L, 1] : [so - L, L, -1]);
      clip = { tp, q: start, L };
    }
  } else throw new Error('Unknown extent');
  const taper = +f.taper || 0;
  if (Math.abs(taper) >= 60) throw new Error('Taper must be between −60° and 60°');
  if (taper) for (let i = segs.length - 1; i >= 0; i--) if (segs[i][2] === 0) { const [st, len] = segs[i]; segs.splice(i, 1, [st, len / 2, -1], [st + len / 2, len / 2, 1]); }   // symmetric: narrows both ways from the middle
  let tool = null;
  for (const [st, len, sense] of segs) {
    let part = extrudeDrawing(base, brepPlane(pi.base, pi.offset, pi.flip, st).plane, len);
    if (taper) {
      // neutral plane at the start face: positive taper narrows away from the sketch
      const sides = [[sense > 0 ? st : st + len, sense]];
      for (const [z, sg] of sides) {
        const np = brepPlane(pi.base, pi.offset, pi.flip, z).plane, startPl = brepPlane(pi.base, pi.offset, pi.flip, st).plane, endPl = brepPlane(pi.base, pi.offset, pi.flip, st + len).plane;
        try { part = T(part.draft(taper * sg, fi => fi.not(g => g.inPlane(startPl)).not(g => g.inPlane(endPl)), np)); }
        catch (e) { throw new Error('The taper could not be applied (try a smaller angle)'); }
      }
    }
    tool = tool ? T(tool.fuse(part)) : part;
  }
  if (clip) tool = T(tool.intersect(halfSpaceBox(clip.tp.o, clip.tp.n, clip.q, clip.L)));
  return tool;
}

// metric coarse tapped holes: [name, nominal diameter, pitch]
const TAP_SIZES = [['M2', 2, 0.4], ['M2.5', 2.5, 0.45], ['M3', 3, 0.5], ['M4', 4, 0.7], ['M5', 5, 0.8], ['M6', 6, 1], ['M8', 8, 1.25], ['M10', 10, 1.5], ['M12', 12, 1.75], ['M14', 14, 2], ['M16', 16, 2], ['M20', 20, 2.5], ['M24', 24, 3]];
// helical V cut for an internal thread on radius r, from axis point c along ax for len
function internalThreadTool(c, ax, r, len, pitch, lefthand) {
  const d = 0.54 * pitch, w = 0.62 * pitch / 2, eps = 0.05;
  const c0 = c.clone().add(ax.clone().multiplyScalar(pitch * 0.25));
  const spine = T(RC.makeHelix(pitch, len - pitch * 0.5, r, [c0.x, c0.y, c0.z], [ax.x, ax.y, ax.z], !!lefthand));
  let vp = [[-eps, -w], [d, 0], [-eps, w]];
  if ((vp[1][0] - vp[0][0]) * (vp[2][1] - vp[0][1]) - (vp[2][0] - vp[0][0]) * (vp[1][1] - vp[0][1]) < 0) vp = vp.reverse();
  return sweepProfileAlongHelix(spine, [c0.x, c0.y, c0.z], () => RC.draw(vp[0]).lineTo(vp[1]).lineTo(vp[2]).close());
}
// hole: simple / counterbore / countersink, optional tap size (modeled or cosmetic thread), extents distance / all / to
function holeTool(f, out, P, c, axisPlane) {
  const kind = f.holeType || (f.cbore ? 'cbore' : 'simple'), ext = f.extent || 'distance';
  let r = +f.diameter / 2, tap = null;
  if (f.tapped) { const t = TAP_SIZES.find(x => x[0] === f.tapSize) || TAP_SIZES[5]; tap = { name: t[0], D: t[1], p: t[2] }; r = (t[1] - t[2]) / 2; }
  if (!(r > 0)) throw new Error('Diameter must be greater than 0 mm');
  const down = P.n.clone().negate();
  let depth, clip = null, tip = f.tip !== false;
  if (ext === 'all') { depth = modelReach(out, c); tip = false; }
  else if (ext === 'to') {
    const tp = targetPlane(f.to, out), along = tp.n.dot(down), dist = tp.n.dot(tp.o.clone().sub(c));
    if (Math.abs(along) < 1e-6) throw new Error('The target is parallel to the hole');
    const s = dist / along; if (!(s > 1e-6)) throw new Error('The target must be below the hole placement');
    if (Math.abs(along) > 1 - 1e-9) depth = s; else { depth = modelReach(out, c); clip = tp; }
    tip = false;
  } else { depth = +f.depth; if (!(depth > 0)) throw new Error('Depth must be greater than 0 mm'); }
  const top = 0.01, pts = [[0, top]];
  let headDepth = 0;
  if (kind === 'cbore') {
    const R = +f.cbDiameter / 2, cd = +f.cbDepth;
    if (!(R > r)) throw new Error('Counterbore diameter must be larger than the hole diameter');
    if (!(cd > 0 && cd < depth)) throw new Error('Counterbore depth must be between 0 and the hole depth');
    pts.push([R, top], [R, -cd], [r, -cd]); headDepth = cd;
  } else if (kind === 'csink') {
    const R = +f.csDiameter / 2, ang = +f.csAngle || 90;
    if (!(R > r)) throw new Error('Countersink diameter must be larger than the hole diameter');
    if (!(ang > 10 && ang < 170)) throw new Error('Countersink angle must be between 10° and 170°');
    const hgt = (R - r) / Math.tan(ang / 2 * Math.PI / 180);
    if (!(hgt < depth)) throw new Error('The countersink is deeper than the hole');
    pts.push([R + top * Math.tan(ang / 2 * Math.PI / 180), top], [r, -hgt]); headDepth = hgt;
  } else pts.push([r, top]);
  pts.push([r, -depth]);
  if (tip) pts.push([0, -depth - r / Math.tan(((+f.tipAngle || 118) / 2) * Math.PI / 180)]); else pts.push([0, -depth]);
  let pen = RC.draw(pts[0]); for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  let tool = revolveDrawing(pen.close(), axisPlane, P.n, c, 360);
  if (clip) tool = T(tool.intersect(halfSpaceBox(clip.o, clip.n, c, depth)));
  if (tap && f.modeled) {
    // a through hole only needs thread as deep as the material goes
    let reach = depth;
    if (ext !== 'distance') { reach = 0; for (const b of out.bodies.values()) { try { const [lo, hi] = b.shape.boundingBox.bounds; for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) reach = Math.max(reach, down.dot(new THREE.Vector3(x, y, z).sub(c))); } catch (e) { } } reach = Math.min(depth, reach + tap.p); }
    const avail = reach - headDepth, len = Math.min(avail, +f.threadDepth > 0 ? +f.threadDepth : avail);
    if (len < tap.p * 1.5) throw new Error('The hole is too shallow for a modeled thread');
    const start = c.clone().add(down.clone().multiplyScalar(headDepth));
    try { tool = T(tool.fuse(internalThreadTool(start, down, r, len, tap.p, f.lefthand))); }
    catch (e) { throw new Error('The modeled thread could not be built; try a cosmetic thread or a different thread depth'); }
  }
  return tool;
}

function brepTool(f, out) {
  switch (f.type) {
    case 'extrude': case 'revolve': {
      const sk = out.sketches.get(f.sketch);
      if (!sk) throw new Error('Choose a sketch that comes before this feature');
      const pi = placementInfo(sk.feature, out);
      const drawing = sketchDrawing(sk.feature, f.regions);
      if (f.type === 'extrude') return extrudeExtents(f, out, drawing, pi);
      const P = brepPlane(pi.base, pi.offset, pi.flip);
      const A = f.axis !== 'u' && f.axis !== 'v' && f.axis ? (() => { const a = axisOf(f.axis, out); return { d: new THREE.Vector3(...a.d), o: new THREE.Vector3(...a.o) }; })() : { d: f.axis === 'u' ? P.u : P.v, o: P.o };   // construction/origin axis or a sketch axis
      // extents: one side, symmetric (total angle split) or two sides; full = 360°
      const full = (f.extent || 'angle') === 'full';
      const a1 = full ? 360 : Math.min(360, Math.abs(+f.angle)), a2 = (f.extent === 'two') ? Math.min(360, Math.abs(+f.angle2 || 0)) : 0;
      if (!(a1 > 0)) throw new Error('Angle must be greater than 0°');
      let total = a1, start = 0;
      if (!full && f.extent === 'two') { total = Math.min(360, a1 + a2); start = -a2; }
      else if (!full && f.direction === 'symmetric') start = -a1 / 2;
      else if (!full && f.direction === 'reverse') start = -a1;
      let shape = revolveDrawing(drawing, P.plane, A.d, A.o, total);
      if (start) shape = T(shape.rotate(start, [A.o.x, A.o.y, A.o.z], [A.d.x, A.d.y, A.d.z]));
      return shape;
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
      } else return holeTool(f, out, P, c, axisPlane);
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
  if (f.type === 'fullround') return fullRound(f, out);
  if (f.type === 'offsetface') return offsetFaces(f, out);
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
      if (f.type === 'fillet') {
        let rad = amount;
        if (f.filletType === 'variable') { const r2 = +f.radius2; if (!(r2 > 0)) throw new Error('End radius must be greater than 0 mm'); rad = [amount, r2]; }
        bReplace(out, id, T(b.shape.clone().fillet(e => hs.has(e.hashCode) ? rad : null)));
      } else if ((f.chamferType || 'equal') === 'equal') bReplace(out, id, T(b.shape.clone().chamfer(e => hs.has(e.hashCode) ? amount : null)));
      else bReplace(out, id, T(chamferSided(b.shape, hs, f, amount)));
    }
  }
  if (!matched) throw new Error('The picked ' + (faces ? 'faces' : 'edges') + ' no longer exist. Edit this feature and pick them again.');
  return matched;
}

// chamfer with two distances or a distance and an angle; the first distance is measured on one face next to each edge (flip swaps)
function chamferSided(shape, hs, f, d1) {
  const oc = RC.getOC(), builder = new oc.BRepFilletAPI_MakeChamfer(shape.wrapped), faces = shape.faces;
  const two = f.chamferType === 'two', d2 = +f.distance2, ang = +f.chamferAngle;
  if (two && !(d2 > 0)) throw new Error('The second distance must be greater than 0 mm');
  if (!two && !(ang > 0 && ang < 90)) throw new Error('The angle must be between 0° and 90°');
  let n = 0;
  try {
    for (const e of shape.edges) {
      if (!hs.has(e.hashCode)) continue;
      const adj = faces.filter(fc => { const es = fc.edges, hit = es.some(x => x.hashCode === e.hashCode); es.forEach(x => x.delete?.()); return hit; });
      const fc = adj[f.flipSide ? 1 : 0] || adj[0]; if (!fc) continue;
      if (two) builder.Add(d1, d2, e.wrapped, fc.wrapped); else builder.AddDA(d1, ang * Math.PI / 180, e.wrapped, fc.wrapped);
      n++;
    }
    if (!n) throw new Error('No edge to chamfer');
    return RC.cast(builder.Shape());
  } catch (e) { if (e instanceof Error && /edge|angle|distance/i.test(e.message)) throw e; throw new Error('The chamfer could not be built; try smaller distances'); }
  finally { faces.forEach(x => x.delete?.()); }
}
// full round fillet: the picked face is replaced by a round between its two opposite side faces
function fullRound(f, out) {
  const refs = f.edges || []; if (!refs.length) throw new Error('Click the face to round over (for example the top of a rib)');
  let matched = 0;
  for (const [id, b] of [...out.bodies]) {
    if (f.body && f.body !== id) continue;
    const faces = b.shape.faces, hs = matchRefs(faces, refs, faceSig, 'c'), picked = faces.filter(x => hs.has(x.hashCode));
    try {
      if (!picked.length) continue;
      let shape = b.shape.clone();
      for (const pf of picked) {
        const cur = shape.faces, mid = cur.find(x => x.isSame ? x.isSame(pf) : x.hashCode === pf.hashCode) || cur.find(x => d3(faceSig(x).c, faceSig(pf).c) < 1e-6);
        if (!mid) continue;
        const midEdges = mid.edges, sides = [];
        for (const e of midEdges) {
          const other = cur.find(fc => fc !== mid && fc.hashCode !== mid.hashCode && fc.edges.some(x => x.hashCode === e.hashCode));
          if (other && other.geomType === 'PLANE') sides.push({ e, face: other, sig: faceSig(other), len: RC.measureLength ? RC.measureLength(e) : 1 });
        }
        // the opposite pair: antiparallel normals, longest shared edges
        let best = null;
        for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++) {
          const A = sides[i].sig, B = sides[j].sig, dot = A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2];
          if (dot > -1 + 1e-6) continue;
          const score = sides[i].len + sides[j].len; if (!best || score > best.score) best = { a: sides[i], b: sides[j], score };
        }
        if (!best) throw new Error('Full round needs two parallel side faces on either side of the picked face');
        const A = best.a.sig, B = best.b.sig, w = Math.abs((A.c[0] - B.c[0]) * A.n[0] + (A.c[1] - B.c[1]) * A.n[1] + (A.c[2] - B.c[2]) * A.n[2]);
        const ha = best.a.e.hashCode, hb = best.b.e.hashCode;
        let done = null;
        for (const k of [1, 0.9995, 0.995]) { try { done = shape.fillet(e => e.hashCode === ha || e.hashCode === hb ? w / 2 * k : null); break; } catch (e) { done = null; } }
        if (!done) throw new Error('The full round could not be built on this face');
        shape = T(done);
      }
      matched += picked.length;
      bReplace(out, id, T(shape));
    } finally { faces.forEach(x => x.delete?.()); }
  }
  if (!matched) throw new Error('The picked face no longer exists. Edit this feature and pick it again.');
  return matched;
}
// offset faces: a flat face with flat neighbours moves along its normal while the neighbours extend or trim to meet it;
// other faces offset like Press Pull
function offsetFaces(f, out) {
  const refs = f.edges || []; if (!refs.length) throw new Error('Click the faces to offset');
  const d = +f.distance; if (!(Math.abs(d) > 1e-6)) throw new Error('Distance must not be 0 mm');
  let matched = 0;
  for (const [id, b] of [...out.bodies]) {
    if (f.body && f.body !== id) continue;
    const list = b.shape.faces, hs = matchRefs(list, refs, faceSig, 'c'), picked = list.filter(x => hs.has(x.hashCode));
    try {
      if (!picked.length) continue;
      let shape = b.shape.clone();
      for (const face of picked) {
        const tool = face.geomType === 'PLANE' ? (neighbourPrism(face, list, d) || (() => { const n = face.normalAt(), v = n.multiply(d / Math.hypot(n.x, n.y, n.z)); return RC.basicFaceExtrusion(face, v); })()) : offsetSlab(face, d);
        const next = d > 0 ? shape.fuse(tool) : shape.cut(tool); shape.delete?.(); shape = next;
      }
      matched += picked.length;
      bReplace(out, id, T(shape.simplify ? shape.simplify() : shape));
    } finally { list.forEach(x => x.delete?.()); }
  }
  if (!matched) throw new Error('The picked faces no longer exist. Edit this feature and pick them again.');
  return matched;
}
// ruled solid between a flat polygonal face and its offset copy whose corners slide along the neighbouring face planes
function neighbourPrism(face, allFaces, d) {
  try {
    if ([...RC.iterTopo(face.wrapped, 'wire')].length !== 1) return null;   // holes in the face: plain offset
    const nv = face.normalAt(), n = new THREE.Vector3(nv.x, nv.y, nv.z).normalize(); nv.delete?.();
    const edges = face.edges; if (edges.length < 3) return null;
    const P = q => new THREE.Vector3(q.x, q.y, q.z);
    // order corners by chaining edge end points
    const segs = edges.map(e => { if (e.geomType !== 'LINE') throw 0; return { a: P(e.startPoint), b: P(e.endPoint), h: e.hashCode }; });
    const chain = [segs.shift()];
    while (segs.length) { const last = chain[chain.length - 1].b; const i = segs.findIndex(s => s.a.distanceTo(last) < 1e-6 || s.b.distanceTo(last) < 1e-6); if (i < 0) return null; const s = segs.splice(i, 1)[0]; if (s.a.distanceTo(last) >= 1e-6) [s.a, s.b] = [s.b, s.a]; chain.push(s); }
    // the neighbour plane across each edge
    const planes = chain.map(s => {
      const nb = allFaces.find(fc => fc.hashCode !== face.hashCode && fc.edges.some(x => x.hashCode === s.h));
      if (!nb || nb.geomType !== 'PLANE') throw 0;
      const q = nb.normalAt(), m = new THREE.Vector3(q.x, q.y, q.z).normalize(); q.delete?.();
      return { m, k: m.dot(s.a) };
    });
    const k0 = n.dot(chain[0].a) + d, top = [];
    for (let i = 0; i < chain.length; i++) {
      const A = planes[(i - 1 + chain.length) % chain.length], B = planes[i];
      // intersect planes n·x = k0, A, B (3x3 by Cramer)
      const M = new THREE.Matrix3().set(n.x, n.y, n.z, A.m.x, A.m.y, A.m.z, B.m.x, B.m.y, B.m.z), det = M.determinant();
      if (Math.abs(det) < 1e-9) return null;
      const inv = M.clone().invert(), v = new THREE.Vector3(k0, A.k, B.k).applyMatrix3(inv);
      top.push(v);
    }
    const bot = chain.map(s => s.a), arr = v => [v.x, v.y, v.z];
    const w1 = RC.makePolygon(bot.map(arr)).outerWire(), w2 = RC.makePolygon(top.map(arr)).outerWire();
    return T(RC.loft([w1, w2], { ruled: true }));
  } catch (e) { if (globalThis.process?.env?.BREP_STACK) console.log('neighbourPrism', e?.stack || e); return null; }
}
// silhouette of curved faces seen along direction dir: where the face normal is perpendicular to dir.
// Returns plane offsets (along dir) per face for silhouettes that lie in a plane perpendicular to dir.
function silhouettePlanes(shape, dir) {
  const out = [], skipped = [];
  for (const fc of shape.faces) {
    if (fc.geomType === 'PLANE') { fc.delete?.(); continue; }
    const N = 28, g = [], pts = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      try { const p = fc.pointOnSurface(i / N, j / N), q = fc.normalAt(p), l = Math.hypot(q.x, q.y, q.z) || 1; g.push((q.x * dir.x + q.y * dir.y + q.z * dir.z) / l); pts.push(new THREE.Vector3(p.x, p.y, p.z)); p.delete?.(); q.delete?.(); }
      catch (e) { g.push(NaN); pts.push(null); }
    }
    const at = (i, j) => i * (N + 1) + j, zs = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (i + di > N || j + dj > N) continue;
      const a = at(i, j), b = at(i + di, j + dj), ga = g[a], gb = g[b];
      if (!(Number.isFinite(ga) && Number.isFinite(gb)) || ga * gb > 0 || ga === gb) continue;
      const t = ga / (ga - gb); zs.push(pts[a].clone().lerp(pts[b], t).dot(dir));
    }
    if (zs.length >= 4) {
      const mean = zs.reduce((x, y) => x + y, 0) / zs.length, dev = Math.max(...zs.map(z => Math.abs(z - mean)));
      const [lo, hi] = fc.boundingBox.bounds, size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      if (dev < 1e-3 * Math.max(1, size)) out.push({ face: fc, z: Math.round(mean * 1e6) / 1e6 }); else { skipped.push(fc); }
    } else fc.delete?.();
  }
  return { planes: out, skipped };
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
const MODIFY_TYPES = new Set(['silsplit', 'splitface', 'splitbody', 'scale', 'thicken', 'replaceface', 'align', 'patpath', 'boundary']);
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
// split the faces matching sigs with the plane of frame M; other faces crossed by the plane are merged back. null if nothing split.
function splitFacesByPlane(shape, sigs, M) {
  const list = shape.faces, hs = matchRefs(list, sigs, faceSig, 'c'), picked = list.filter(x => hs.has(x.hashCode));
  try {
    if (!picked.length) return null;
    const oc = RC.getOC(), e = M.elements, n = [e[8], e[9], e[10]], o = [e[12], e[13], e[14]];
    const nl = Math.hypot(...n); n.forEach((v, i) => n[i] = v / nl);
    const tool = new oc.BRepBuilderAPI_MakeFace(RC.makePln(o, n)).Face();
    const args = new oc.NCollection_List_TopoDS_Shape(), tools = new oc.NCollection_List_TopoDS_Shape();
    for (const sh of RC.iterTopo(shape.wrapped, 'shell')) args.Append(sh);
    tools.Append(tool);
    const sp = new oc.BRepAlgoAPI_Splitter(); sp.SetArguments(args); sp.SetTools(tools); sp.Build();
    if (sp.HasErrors()) return null;
    let solid = RC.makeSolid([...RC.iterTopo(sp.Shape(), 'shell')].map(s => RC.cast(s)));
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
    if (solid.faces.length <= list.length) return null;
    return solid;
  } finally { list.forEach(x => x.delete?.()); }
}

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
  if (f.type === 'silsplit') {
    const b = body(), M = planeFrameOf(f.dir || 'XY', out), e = M.elements, dir = new THREE.Vector3(e[8], e[9], e[10]).normalize();
    const { planes, skipped } = silhouettePlanes(b.shape, dir);
    skipped.forEach(x => x.delete?.());
    if (!planes.length) throw new Error('No curved face has a silhouette in this direction (or it is not flat)');
    const zs = [...new Set(planes.map(p => p.z))];
    const frameAt = z => { const o = dir.clone().multiplyScalar(z), m = M.clone(); m.setPosition(o.x, o.y, o.z); return m; };
    if ((f.mode || 'body') === 'body') {
      planes.forEach(p => p.face.delete?.());
      if (zs.length > 1) throw new Error('The silhouette lies at several heights; use Split faces instead');
      const box = shapesBox([b.shape]), up = halfSpace(frameAt(zs[0]), box.size), A = T(b.shape.clone().intersect(up)), B = T(b.shape.clone().cut(up));
      let va = 0, vb = 0; try { va = RC.measureVolume(A); vb = RC.measureVolume(B); } catch (x) { }
      if (va < 1e-9 || vb < 1e-9) throw new Error('The silhouette is already on the edges of the body');
      bReplace(out, b.id, A); bNew(out, b.id + ':sil', B, f.id);
      return;
    }
    let shape = b.shape, changed = 0;
    for (const z of zs) {
      const faceSigs = planes.filter(p => p.z === z).map(p => faceSig(p.face));
      const r = splitFacesByPlane(shape, faceSigs, frameAt(z));
      if (r) { shape = r; changed++; }
    }
    planes.forEach(p => p.face.delete?.());
    if (!changed) throw new Error('The silhouette is already on the edges of the faces');
    bReplace(out, b.id, T(shape));
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
const EDGE_TYPES = new Set(['fillet', 'chamfer', 'shell', 'draft', 'presspull', 'fullround', 'offsetface']);
const FACE_PICK = new Set(['shell', 'draft', 'presspull', 'thicken', 'replaceface', 'thread', 'emboss', 'splitface', 'lip', 'fullround', 'offsetface']);
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
      if (ids.length < 2 && !(ids.length === 1 && (f.endPoint || f.startPoint))) throw new Error('Choose at least two sketches to loft between (or one sketch and an end point)');
      const parts = ids.map(id => {
        const sk = out.sketches.get(id), pi = placementInfo(sk.feature, out);
        const s = singleAreaDrawing(sk.feature, null, 'loft').sketchOnPlane(brepPlane(pi.base, pi.offset, pi.flip).plane);
        return asSketches(s)[0];
      });
      let tool;
      if (f.centerline) {   // sections swept along a centre line
        const cs = out.sketches.get(f.centerline); if (!cs) throw new Error('Choose the centre line sketch');
        const cg = cs.feature.geo, csol = cg?.curves?.length ? solveSketch(cg) : null; if (!csol?.ok) throw new Error('The centre line sketch has no usable lines');
        const cp = geoPaths(cg, csol).paths; if (!cp?.length) throw new Error('The centre line sketch has no chain of lines or arcs');
        const cpi = placementInfo(cs.feature, out), spine = segsPen(cp[0].segs, cp[0].closed).sketchOnPlane(brepPlane(cpi.base, cpi.offset, cpi.flip).plane).wire;
        const oc = RC.getOC(), mk = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
        mk.SetMode(false);
        for (const p of parts) mk.Add(p.wire.wrapped, false, false);
        try { mk.Build(); mk.MakeSolid(); tool = T(RC.cast(mk.Shape())); } catch (e) { throw new Error('The loft could not follow the centre line; check that the sections sit on it in order'); }
      } else {
        const cfg = { ruled: !!f.ruled };
        const endPt = f.endPoint && out.points?.get(f.endPoint)?.p, startPt = f.startPoint && out.points?.get(f.startPoint)?.p;
        if (endPt) cfg.endPoint = endPt; if (startPt) cfg.startPoint = startPt;
        tool = T(parts.length > 1 ? parts[0].loftWith(parts.slice(1), cfg) : parts[0].loftWith([], cfg));
      }
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
    } else if (f.type === 'canvas' || f.type === 'decal') {
      /* display only */
    } else if (f.type === 'derive') {
      if (!Array.isArray(f.sub)) throw new Error('The derived design is missing');
      const sub = regenerateBrep(f.sub), errs = [...sub.status.values()].filter(s => s.state === 'error').length;
      if (!sub.bodies.size) throw new Error('The derived design has no bodies' + (errs ? ` (${errs} of its features fail)` : ''));
      let k = 0;
      for (const [, b] of sub.bodies) { let s = b.shape.clone(); if (+f.dx || +f.dy || +f.dz) s = s.translate([+f.dx || 0, +f.dy || 0, +f.dz || 0]); bNew(out, f.id + (k ? ':' + k : ''), T(s), f.id); k++; }
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
    if (globalThis.process?.env?.BREP_STACK) console.log(e.stack); out.status.set(f.id, { state: 'error', msg: occMsg(e) });
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
  if (f.guide) {   // guide rail: the profile turns to follow it
    const gs = out.sketches.get(f.guide); if (!gs) throw new Error('Choose the guide rail sketch');
    const gg = gs.feature.geo; if (!gg?.curves?.length) throw new Error('The guide rail sketch has no lines');
    const gsol = solveSketch(gg); if (!gsol.ok) throw new Error('The guide rail sketch constraints conflict');
    const gp = geoPaths(gg, gsol).paths; if (!gp?.length) throw new Error('The guide rail sketch has no chain of lines or arcs');
    const gpi = placementInfo(gs.feature, out);
    cfg.auxiliarySpine = segsPen(gp[0].segs, gp[0].closed).sketchOnPlane(brepPlane(gpi.base, gpi.offset, gpi.flip).plane).wire;
    cfg.frenet = false;
  }
  const scaleEnd = f.scaleEnd === '' || f.scaleEnd == null ? 1 : +f.scaleEnd;
  if (!(scaleEnd > 0)) throw new Error('End scale must be greater than 0');
  if (Math.abs(scaleEnd - 1) > 1e-9) {
    const oc = RC.getOC(), L = RC.measureLength(spine.wire), law = new oc.Law_Linear();
    law.Set(0, 1, L, scaleEnd); cfg.law = law.Trim(0, L, 1e-6);
  }
  const sweepOne = d => { try { return RC.genericSweep(d.sketchOnPlane(frame(), sp).wire, spine.wire, cfg); } catch (e) { throw new Error(f.guide ? 'The sweep could not follow the guide rail' : 'The sweep could not be built along this path'); } };
  let solid = T(sweepOne(outer));
  for (const hd of holes) solid = T(solid.cut(T(sweepOne(hd))));
  return solid;
}
