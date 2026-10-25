// ===== SnapEngine geometry (pure, no DOM): snap candidates, curve intersections, alignment and line inference =====
// Everything here works in sketch-plane coordinates (mm). Screen distance only decides which candidates are near the
// cursor (via tol); the returned positions are always computed from the geometry itself.
//
// Scene format (built by the sketch UI from the solved sketch):
//   points: [{ id, x, y, center?: true, constr?: true }]           ('O' is the origin)
//   curves: [{ id, kind: 'line', a: {x,y}, b: {x,y}, ia, ib }
//            | { id, kind: 'circle', c: {x,y}, r, ic }
//            | { id, kind: 'arc', c: {x,y}, r, a: {x,y}, b: {x,y}, ic }]     (arcs run counter-clockwise from a to b)
// A snap result: { x, y, type, id?, refs: [{ type, e }], guides?: [[{x,y},{x,y}]], label }
//   refs are the constraints a new point needs to stay where it snapped (the point id is filled in by the caller).
const SNAP_TYPES = ['endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'nearest', 'align', 'grid'];
const SNAP_PRIO = { origin: 0, endpoint: 0, center: 0, intersection: 1, midpoint: 2, quadrant: 2 };
const SNAP_LABEL = { origin: 'Origin', endpoint: 'Endpoint', center: 'Center', intersection: 'Intersection', midpoint: 'Midpoint', quadrant: 'Quadrant', nearest: 'On curve', align: 'Aligned', grid: 'Grid' };
const TAU_ = 2 * Math.PI;
const EPS_ = 1e-9;

function onArcSpan(cv, p) {
  if (cv.kind !== 'arc') return true;
  const a0 = Math.atan2(cv.a.y - cv.c.y, cv.a.x - cv.c.x);
  let a1 = Math.atan2(cv.b.y - cv.c.y, cv.b.x - cv.c.x), t = Math.atan2(p.y - cv.c.y, p.x - cv.c.x);
  while (a1 <= a0) a1 += TAU_;
  while (t < a0 - 1e-9) t += TAU_;
  return t <= a1 + 1e-9;
}
// intersections of two curves, limited to the drawn extent of each (segments and arc spans)
function curveIntersections(c1, c2) {
  const out = [];
  if (c1.kind === 'line' && c2.kind === 'line') {
    const { a, b } = c1, { a: c, b: d } = c2, rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < EPS_) return out;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) out.push({ x: a.x + t * rx, y: a.y + t * ry });
    return out;
  }
  if (c1.kind !== 'line' && c2.kind === 'line') return curveIntersections(c2, c1);
  if (c1.kind === 'line') {
    const { a, b } = c1, cc = c2.c, dx = b.x - a.x, dy = b.y - a.y, fx = a.x - cc.x, fy = a.y - cc.y;
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c2.r * c2.r, D = B * B - 4 * A * C;
    if (A < EPS_ || D < -1e-9) return out;
    const s = Math.sqrt(Math.max(0, D)), ts = s < 1e-12 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
    for (const t of ts) { if (t < -1e-9 || t > 1 + 1e-9) continue; const p = { x: a.x + t * dx, y: a.y + t * dy }; if (onArcSpan(c2, p)) out.push(p); }
    return out;
  }
  const dx = c2.c.x - c1.c.x, dy = c2.c.y - c1.c.y, d = Math.hypot(dx, dy);
  if (d < EPS_ || d > c1.r + c2.r + 1e-9 || d < Math.abs(c1.r - c2.r) - 1e-9) return out;
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const mx = c1.c.x + a * dx / d, my = c1.c.y + a * dy / d;
  const pts = h < 1e-12 ? [{ x: mx, y: my }] : [{ x: mx + h * dy / d, y: my - h * dx / d }, { x: mx - h * dy / d, y: my + h * dx / d }];
  for (const p of pts) if (onArcSpan(c1, p) && onArcSpan(c2, p)) out.push(p);
  return out;
}
const onRef = cv => (cv.kind === 'line' ? 'onLine' : 'onCircle');
// every point a cursor can snap to, with the constraints that keep a new point there
function snapCandidates(points, curves, o = {}) {
  const out = [], near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  for (const p of points) out.push({ x: p.x, y: p.y, id: p.id, type: p.id === 'O' ? 'origin' : p.center ? 'center' : 'endpoint', refs: [] });
  const isPt = q => points.some(p => near(p, q));
  for (const cv of curves) {
    if (cv.kind === 'line') {
      const m = { x: (cv.a.x + cv.b.x) / 2, y: (cv.a.y + cv.b.y) / 2 };
      if (!isPt(m)) out.push({ ...m, type: 'midpoint', refs: [{ type: 'midpoint', e: [cv.id] }] });
    } else {
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 2, q = { x: cv.c.x + cv.r * Math.cos(ang), y: cv.c.y + cv.r * Math.sin(ang) };
        if (!onArcSpan(cv, q) || isPt(q)) continue;
        // stays on the circle, level with (or plumb above) its center
        const refs = [{ type: 'onCircle', e: [cv.id] }];
        if (cv.ic) refs.push({ type: k % 2 ? 'vertical' : 'horizontal', e: [cv.ic], pointFirst: false });
        out.push({ ...q, type: 'quadrant', refs });
      }
    }
  }
  const max = o.maxCurves ?? 200, cs = curves.slice(0, max);
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    for (const p of curveIntersections(cs[i], cs[j])) {
      if (isPt(p) || out.some(q => q.type === 'intersection' && near(p, q))) continue;
      out.push({ ...p, type: 'intersection', refs: [{ type: onRef(cs[i]), e: [cs[i].id] }, { type: onRef(cs[j]), e: [cs[j].id] }] });
    }
  }
  return out;
}
function nearestOnCurve(cv, x, y) {
  if (cv.kind === 'line') {
    const dx = cv.b.x - cv.a.x, dy = cv.b.y - cv.a.y, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - cv.a.x) * dx + (y - cv.a.y) * dy) / L));
    return { x: cv.a.x + t * dx, y: cv.a.y + t * dy };
  }
  const ang = Math.atan2(y - cv.c.y, x - cv.c.x), p = { x: cv.c.x + cv.r * Math.cos(ang), y: cv.c.y + cv.r * Math.sin(ang) };
  return onArcSpan(cv, p) ? p : null;
}
// pick the snap for a cursor at (x, y); `cats` switches categories off ({ midpoint: false, ... }); grid(v) rounds free positions
function snapPick(scene, cands, x, y, tol, o = {}) {
  const cats = o.cats || {}, exclude = o.exclude, on = t => cats[t === 'origin' ? 'endpoint' : t] !== false;
  let best = null, bs = Infinity;
  for (const c of cands) {
    if (!on(c.type) || (c.id && exclude?.has(c.id))) continue;
    const d = Math.hypot(c.x - x, c.y - y); if (d > tol) continue;
    const s = d * (1 + 0.35 * (SNAP_PRIO[c.type] ?? 3));
    if (s < bs) { bs = s; best = c; }
  }
  if (best) return { ...best, refs: best.refs.map(r => ({ ...r, e: [...r.e] })), label: SNAP_LABEL[best.type] };
  if (on('nearest')) {
    let nb = null, nd = tol * 0.5;
    for (const cv of scene.curves) { const p = nearestOnCurve(cv, x, y); if (!p) continue; const d = Math.hypot(p.x - x, p.y - y); if (d <= nd) { nd = d; nb = { ...p, type: 'nearest', refs: [{ type: onRef(cv), e: [cv.id] }], curve: cv.id, label: SNAP_LABEL.nearest }; } }
    if (nb) return nb;
  }
  // alignment with existing key points: exact x or y, shown with a dotted guide
  let gx = null, gy = null;
  if (on('align')) {
    let bx = tol * 0.5, by = tol * 0.5;
    for (const c of cands) {
      if (c.type === 'intersection' || c.type === 'quadrant' || (c.id && exclude?.has(c.id))) continue;
      if (Math.abs(c.x - x) < bx) { bx = Math.abs(c.x - x); gx = c; }
      if (Math.abs(c.y - y) < by) { by = Math.abs(c.y - y); gy = c; }
    }
  }
  const grid = on('grid') && o.grid ? o.grid : v => v;
  const px = gx ? gx.x : grid(x), py = gy ? gy.y : grid(y);
  if (gx || gy) {
    const guides = [];
    if (gx) guides.push([{ x: gx.x, y: gx.y }, { x: px, y: py }]);
    if (gy) guides.push([{ x: gy.x, y: gy.y }, { x: px, y: py }]);
    return { x: px, y: py, type: 'align', refs: [], guides, alignX: gx ? gx.x : null, alignY: gy ? gy.y : null, label: SNAP_LABEL.align };
  }
  return { x: px, y: py, type: 'grid', refs: [], label: SNAP_LABEL.grid };
}
// While drawing a line from lp toward p: horizontal, vertical, parallel or perpendicular to an existing line, or
// tangent to an arc ending at lp. Returns the exact end point (same length along the inferred direction) and the
// constraint to add, or null. thrDeg is the angular capture; lines: [{id,a,b}], arcsAt: [{id,c}] arcs that end at lp.
function inferLine(lp, p, lines, arcsAt, o = {}) {
  const dx = p.x - lp.x, dy = p.y - lp.y, L = Math.hypot(dx, dy);
  if (L < 1e-6) return null;
  // horizontal / vertical capture grows for short lines (a few pixels at the end); other relations use a fixed angle
  const th = Math.atan2(dy, dx), thrHV = Math.max((o.thrDeg ?? 2) * Math.PI / 180, Math.atan2((o.tol ?? 0) * 0.5, L)), thrRel = (o.relDeg ?? 1.5) * Math.PI / 180;
  const dAng = (a, b) => { let d = Math.abs(((a - b) % Math.PI + Math.PI) % Math.PI); return Math.min(d, Math.PI - d); };   // undirected
  const cands = [{ type: 'horizontal', dir: 0, bias: 0.8 }, { type: 'vertical', dir: Math.PI / 2, bias: 0.8 }];
  for (const ln of lines) {
    const phi = Math.atan2(ln.b.y - ln.a.y, ln.b.x - ln.a.x);
    if (dAng(phi, 0) < 1e-6 || dAng(phi, Math.PI / 2) < 1e-6) continue;   // already covered by horizontal / vertical
    cands.push({ type: 'parallel', dir: phi, ref: ln.id, bias: 1 }, { type: 'perpendicular', dir: phi + Math.PI / 2, ref: ln.id, bias: 1 });
  }
  for (const ac of arcsAt || []) cands.push({ type: 'tangent', dir: Math.atan2(lp.y - ac.c.y, lp.x - ac.c.x) + Math.PI / 2, ref: ac.id, bias: 0.7 });
  let best = null, bd = Infinity;
  for (const c of cands) { const d = dAng(th, c.dir), thr = c.type === 'horizontal' || c.type === 'vertical' ? thrHV : thrRel; if (d <= thr && d * c.bias < bd) { bd = d * c.bias; best = c; } }
  if (!best) return null;
  let ux = Math.cos(best.dir), uy = Math.sin(best.dir);
  if (ux * dx + uy * dy < 0) { ux = -ux; uy = -uy; }
  const t = ux * dx + uy * dy;
  const r6 = v => Math.round(v * 1e9) / 1e9;
  return { x: r6(lp.x + ux * t), y: r6(lp.y + uy * t), type: best.type, ref: best.ref || null, glyph: { horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', tangent: 'T' }[best.type] };
}
// The constraint list for a new point `pid` snapped with refs (see snapCandidates).
function snapConstraints(pid, refs) {
  return (refs || []).map(r => ({ type: r.type, e: r.pointFirst === false ? [...r.e, pid] : [pid, ...r.e] }));
}
