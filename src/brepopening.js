// Openings: a door, window, vent or service penetration cut through one wall, sized in millimetres and
// positioned from the wall's own left and bottom edges (as seen from outside, looking at the picked face).
// The cut changes the wall's exact geometry; an optional frame replaces the wall around the opening.

// the face frame: outward normal n, "up" (the world Z direction projected into the face, or the plane's own v
// on a roof or floor), and "right" as seen from outside
function openingFrame(f, out) {
  const pi = placementInfo(f, out), P = brepPlane(pi.base, pi.offset, pi.flip);
  const n = P.n.clone().normalize(), Z = new THREE.Vector3(0, 0, 1);
  let up = Z.clone().sub(n.clone().multiplyScalar(n.dot(Z)));
  if (up.lengthSq() < 1e-6) up = P.v.clone();
  up.normalize();
  const right = up.clone().cross(n).normalize();
  return { o: P.o.clone(), n, up, right };
}
// a body's extent along the frame's axes (from its bounding box corners)
function frameRange(shape, F) {
  const [lo, hi] = shape.boundingBox.bounds, r = { r: [Infinity, -Infinity], u: [Infinity, -Infinity], n: [Infinity, -Infinity] };
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
    const d = new THREE.Vector3(x, y, z).sub(F.o);
    for (const [k, ax] of [['r', F.right], ['u', F.up], ['n', F.n]]) { const t = d.dot(ax); r[k][0] = Math.min(r[k][0], t); r[k][1] = Math.max(r[k][1], t); }
  }
  return r;
}
// a 2D outline in frame coordinates (right, up) extruded along n from n0 to n1
function frameSolid(drawing, F, n0, n1) {
  const o = F.o.clone().add(F.n.clone().multiplyScalar(n0));
  const plane = new RC.Plane([o.x, o.y, o.z], [F.right.x, F.right.y, F.right.z], [F.n.x, F.n.y, F.n.z]);
  return T(drawing.sketchOnPlane(plane).extrude(n1 - n0));
}
function openingOutline(f, grow) {
  const g = grow || 0;
  if (f.shape === 'round') {
    const d = +f.diameter; if (!(d > 0)) throw new Error('Diameter must be greater than 0 mm');
    return { d: RC.drawCircle(d / 2 + g), w: d, h: d };
  }
  const w = +f.w, h = +f.h; if (!(w > 0 && h > 0)) throw new Error('Width and height must be greater than 0 mm');
  const r = Math.max(0, Math.min(+f.radius || 0, w / 2 - 1e-3, h / 2 - 1e-3));
  return { d: RC.drawRoundedRectangle(w + 2 * g, h + 2 * g, r > 1e-3 ? r + g : 0), w, h };
}
function shapeValid(s) {
  try { return new (RC.getOC()).BRepCheck_Analyzer(s.wrapped, true, false, false).IsValid(); } catch (e) { return true; }
}
function isStructure(b, out) { return b.role === 'structure' || /\b(corner )?post|rail\b/i.test(b.label || ''); }
function openingStep(f, out) {
  const target = out.bodies.get(f.target);
  if (!target) throw new Error(f.target ? 'The wall this opening cuts no longer exists. Pick the wall again.' : 'Pick the wall to cut');
  if (target.surface) throw new Error('Openings cut solid walls; this body is a surface. Thicken it first.');
  const F = openingFrame(f, out), R = frameRange(target.shape, F);
  const wallW = R.r[1] - R.r[0], wallH = R.u[1] - R.u[0];
  const o = openingOutline(f);
  const fl = +f.fromLeft || 0, fb = +f.fromBottom || 0;
  if (fl < -1e-6 || fb < -1e-6 || fl + o.w > wallW + 1e-6 || fb + o.h > wallH + 1e-6)
    throw new Error(`The opening runs past the wall (wall ${fmtMM(wallW)} × ${fmtMM(wallH)} mm; opening ${fmtMM(fl)} to ${fmtMM(fl + o.w)} across, ${fmtMM(fb)} to ${fmtMM(fb + o.h)} up)`);
  const cu = R.r[0] + fl + o.w / 2, cv = R.u[0] + fb + o.h / 2;
  // depth: through the whole wall body; a body much deeper than a wall (e.g. a whole container in one solid)
  // is cut only near the picked face, so the far side stays intact
  const deep = R.n[1] - R.n[0], cap = +f.depth > 0 ? +f.depth : 150;
  const n1 = (deep <= 300 && !(+f.depth > 0) ? R.n[1] : Math.min(R.n[1], 200)) + 1;
  const n0 = deep <= 300 && !(+f.depth > 0) ? R.n[0] - 1 : Math.max(R.n[0] - 1, -cap);
  const fw = f.frame ? Math.max(0, +f.frameWidth || 0) : 0;
  if (f.frame && !(fw > 0)) throw new Error('Frame width must be greater than 0 mm');
  const tool = frameSolid((fw ? openingOutline(f, fw) : o).d.translate(cu, cv), F, n0, n1);
  // what else the opening runs into: corner posts, rails and other structure are flagged, not cut
  const hits = [];
  for (const [id, b] of out.bodies) {
    if (id === f.target || !isStructure({ ...b, label: (brepFeatNames.get(String(b.feature).split(':')[0]) || '') + ' ' + b.name }, out) || !bboxOverlap(b.shape, tool)) continue;
    try { const x = b.shape.intersect(tool); if (RC.measureVolume(x) > 1) hits.push(brepFeatNames.get(String(b.feature).split(':')[0]) || b.name); x.delete?.(); } catch (e) { }
  }
  const res = T(target.shape.cut(tool));
  if (!cutChanged(target.shape, res)) throw new Error('The opening misses the wall material here (check the face and the position)');
  if (!shapeValid(res)) throw new Error('The cut gave invalid geometry; move the opening slightly or change its size');
  bReplace(out, f.target, res);
  out.tools.set(f.id, { shape: tool, op: 'cut', target: f.target });
  if (fw) {
    // the frame fills the band the cut cleared around the opening, through the wall's depth
    const fn0 = deep <= 300 ? R.n[0] : -Math.min(cap, +f.frameDepth > 0 ? +f.frameDepth : 50), fn1 = deep <= 300 ? R.n[1] : 0;
    const ring = openingOutline(f, fw).d.cut(o.d).translate(cu, cv);
    const fid = f.id + ':frame';
    bNew(out, fid, frameSolid(ring, F, fn0, fn1), f.id);
    out.bodies.get(fid).name = (f.name || 'Opening') + ' frame';
  }
  out.lastInfo = { wallW: Math.round(wallW * 1000) / 1000, wallH: Math.round(wallH * 1000) / 1000, depth: Math.round((n1 - n0) * 1000) / 1000 };
  if (hits.length) out.lastWarn = `Runs into ${[...new Set(hits)].join(', ')} (not cut). Move or resize the opening if these must stay whole.`;
}
function fmtMM(v) { return String(Math.round(v * 10) / 10); }
