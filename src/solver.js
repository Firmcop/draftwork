// ===== Sketch geometry + constraint solver =====
// geo = {
//   points: [{ id, x, y }],                       // 'O' is the sketch origin, always (0,0) and fixed
//   curves: [{ id, kind: 'line', a, b, constr? } | { id, kind: 'arc', c, a, b, constr? }   // arcs run counter-clockwise a -> b around c
//            | { id, kind: 'circle', c, r, constr? }],
//   cons:   [{ id, type, e: [entity ids], value?, x?, y?, sign? }]
// }
// Constraint types: coincident, horizontal, vertical, parallel, perpendicular, equal, tangent, fix, midpoint,
// concentric, onLine, onCircle, collinear; dimensions: distance, length, hdist, vdist, radius, diameter, angle.
// The solver moves points (and circle radii) as little as possible to satisfy every constraint
// (minimum-norm Gauss-Newton), so under-constrained geometry stays where the user left it.

import { textProfiles } from './font.js';
export const DIM_TYPES = new Set(['distance', 'length', 'hdist', 'vdist', 'radius', 'diameter', 'angle', 'pdist']);
export function emptyGeo() { return { points: [], curves: [], cons: [] }; }

function buildSystem(geo, drag) {
  const vars = [], pIndex = new Map(), rIndex = new Map(), weight = [];
  for (const p of geo.points) { if (p.id === 'O') continue; pIndex.set(p.id, vars.length); vars.push(+p.x || 0, +p.y || 0); const w = drag?.has(p.id) ? 1e6 : 1; weight.push(w, w); }
  const curves = new Map(geo.curves.map(c => [c.id, c]));
  for (const c of geo.curves) if (c.kind === 'circle') { rIndex.set(c.id, vars.length); vars.push(Math.abs(+c.r) || 1); weight.push(drag?.has(c.id) ? 1e6 : 1); }
  const P = (v, id) => { if (id === 'O') return [0, 0]; const i = pIndex.get(id); if (i == null) throw new Error('Missing point ' + id); return [v[i], v[i + 1]]; };
  const R = (v, id) => { const c = curves.get(id); if (!c) throw new Error('Missing curve ' + id); if (c.kind === 'circle') return v[rIndex.get(id)]; const cc = P(v, c.c), a = P(v, c.a); return Math.hypot(a[0] - cc[0], a[1] - cc[1]); };
  const C = (v, id) => P(v, curves.get(id).c);
  const L = (v, id) => { const l = curves.get(id); if (!l || l.kind !== 'line') throw new Error('Expected a line'); return [P(v, l.a), P(v, l.b)]; };
  const dir = ([a, b]) => [b[0] - a[0], b[1] - a[1]];
  const len = d => Math.hypot(d[0], d[1]) || 1e-12;
  const res = [];   // residual functions; each returns an array of numbers
  // arcs keep their two ends on one circle
  for (const c of geo.curves) if (c.kind === 'arc') res.push(v => { const cc = P(v, c.c), a = P(v, c.a), b = P(v, c.b); return [Math.hypot(a[0] - cc[0], a[1] - cc[1]) - Math.hypot(b[0] - cc[0], b[1] - cc[1])]; });
  for (const k of geo.cons) {
    const e = k.e || [], val = +k.value;
    const isCurve = id => curves.has(id);
    switch (k.type) {
      case 'coincident': res.push(v => { const p = P(v, e[0]), q = P(v, e[1]); return [p[0] - q[0], p[1] - q[1]]; }); break;
      case 'horizontal': if (e.length === 2 && !isCurve(e[0])) res.push(v => [P(v, e[0])[1] - P(v, e[1])[1]]); else res.push(v => { const [a, b] = L(v, e[0]); return [a[1] - b[1]]; }); break;
      case 'vertical': if (e.length === 2 && !isCurve(e[0])) res.push(v => [P(v, e[0])[0] - P(v, e[1])[0]]); else res.push(v => { const [a, b] = L(v, e[0]); return [a[0] - b[0]]; }); break;
      case 'parallel': res.push(v => { const d1 = dir(L(v, e[0])), d2 = dir(L(v, e[1])); return [(d1[0] * d2[1] - d1[1] * d2[0]) / (len(d1) * len(d2))]; }); break;
      case 'perpendicular': res.push(v => { const d1 = dir(L(v, e[0])), d2 = dir(L(v, e[1])); return [(d1[0] * d2[0] + d1[1] * d2[1]) / (len(d1) * len(d2))]; }); break;
      case 'collinear': res.push(v => { const [a, b] = L(v, e[0]), [c, d] = L(v, e[1]), u = dir([a, b]), l = len(u); return [(u[0] * (c[1] - a[1]) - u[1] * (c[0] - a[0])) / l, (u[0] * (d[1] - a[1]) - u[1] * (d[0] - a[0])) / l]; }); break;
      case 'equal': {
        const kinds = e.map(id => curves.get(id)?.kind);
        if (kinds.every(x => x === 'line')) res.push(v => [len(dir(L(v, e[0]))) - len(dir(L(v, e[1])))]);
        else res.push(v => [R(v, e[0]) - R(v, e[1])]);
        break;
      }
      case 'tangent': {
        const [x, y] = e.map(id => curves.get(id));
        if (x?.kind === 'spline' || y?.kind === 'spline') break;   // the spline takes the other curve's direction (see splineEndTangent)
        const line = x.kind === 'line' ? x : y.kind === 'line' ? y : null;
        // When the two curves share an endpoint, tangency is "perpendicular to the radius there" (well conditioned);
        // otherwise it is a distance condition.
        const ends = c => c.kind === 'arc' ? [c.a, c.b] : c.kind === 'line' ? [c.a, c.b] : [];
        const shared = ends(x).find(id => ends(y).includes(id));
        if (line) {
          const circ = line === x ? y : x;
          if (shared && circ.kind === 'arc') res.push(v => { const [a, b] = L(v, line.id), u = dir([a, b]), p = P(v, shared), c = C(v, circ.id), w = [p[0] - c[0], p[1] - c[1]]; return [(u[0] * w[0] + u[1] * w[1]) / (len(u) * len(w))]; });
          else res.push(v => { const [a, b] = L(v, line.id), c = C(v, circ.id), u = dir([a, b]); return [Math.abs(u[0] * (c[1] - a[1]) - u[1] * (c[0] - a[0])) / len(u) - R(v, circ.id)]; });
        } else if (shared && x.kind === 'arc' && y.kind === 'arc') {
          res.push(v => { const p = P(v, shared), c1 = C(v, x.id), c2 = C(v, y.id), w1 = [c1[0] - p[0], c1[1] - p[1]], w2 = [c2[0] - p[0], c2[1] - p[1]]; return [(w1[0] * w2[1] - w1[1] * w2[0]) / (len(w1) * len(w2))]; });
        } else {
          const sign = k.sign ?? 1;   // +1 outside, -1 inside
          res.push(v => { const c1 = C(v, x.id), c2 = C(v, y.id), d = Math.hypot(c1[0] - c2[0], c1[1] - c2[1]); return [sign > 0 ? d - R(v, x.id) - R(v, y.id) : d - Math.abs(R(v, x.id) - R(v, y.id))]; });
        }
        break;
      }
      case 'fix': res.push(v => { const p = P(v, e[0]); return [p[0] - (+k.x || 0), p[1] - (+k.y || 0)]; }); break;
      case 'midpoint': res.push(v => { const p = P(v, e[0]), [a, b] = L(v, e[1]); return [p[0] - (a[0] + b[0]) / 2, p[1] - (a[1] + b[1]) / 2]; }); break;
      case 'concentric': res.push(v => { const a = C(v, e[0]), b = C(v, e[1]); return [a[0] - b[0], a[1] - b[1]]; }); break;
      case 'onLine': res.push(v => { const p = P(v, e[0]), [a, b] = L(v, e[1]), u = dir([a, b]); return [(u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0])) / len(u)]; }); break;
      case 'symmetry': res.push(v => { const p = P(v, e[0]), q = P(v, e[1]), [a, b] = L(v, e[2]), u = dir([a, b]), l = len(u), m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], w = [q[0] - p[0], q[1] - p[1]];
        return [(u[0] * (m[1] - a[1]) - u[1] * (m[0] - a[0])) / l, (u[0] * w[0] + u[1] * w[1]) / l]; }); break;
      case 'pdist': res.push(v => { const p = P(v, e[0]), [a, b] = L(v, e[1]), u = dir([a, b]); return [Math.abs(u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0])) / len(u) - val]; }); break;
      case 'onSpline': res.push(v => {
        const q = P(v, e[0]), full = splineFull(curves.get(e[1]), id => P(v, id), geo), sp = splineClosest(full, q);
        const i = Math.min(full.length - 1, Math.floor(sp)), t = sp - i, p = bezPoint(full[i], t), d = bezDer(full[i], t), l = Math.hypot(d[0], d[1]) || 1;
        return [(d[0] * (q[1] - p[1]) - d[1] * (q[0] - p[0])) / l];
      }); break;
      case 'onCircle': res.push(v => { const p = P(v, e[0]), c = C(v, e[1]); return [Math.hypot(p[0] - c[0], p[1] - c[1]) - R(v, e[1])]; }); break;
      // dimensions
      case 'distance': res.push(v => { const p = P(v, e[0]), q = P(v, e[1]); return [Math.hypot(p[0] - q[0], p[1] - q[1]) - val]; }); break;
      case 'length': res.push(v => [len(dir(L(v, e[0]))) - val]); break;
      case 'hdist': res.push(v => [Math.abs(P(v, e[1])[0] - P(v, e[0])[0]) - val]); break;
      case 'vdist': res.push(v => [Math.abs(P(v, e[1])[1] - P(v, e[0])[1]) - val]); break;
      case 'radius': res.push(v => [R(v, e[0]) - val]); break;
      case 'diameter': res.push(v => [2 * R(v, e[0]) - val]); break;
      case 'angle': res.push(v => {
        // one line: its angle from the sketch x axis; two lines: the angle between them
        const d1 = e.length === 1 ? [1, 0] : dir(L(v, e[0])), d2 = dir(L(v, e[e.length === 1 ? 0 : 1]));
        const ang = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]) * (k.sign ?? 1);
        const target = val * Math.PI / 180;
        return [Math.atan2(Math.sin(ang - target), Math.cos(ang - target))];
      }); break;
    }
  }
  const evalAll = v => { const out = []; for (const f of res) for (const x of f(v)) out.push(x); return out; };
  return { vars, weight, pIndex, rIndex, evalAll };
}

function jacobian(evalAll, v, r0) {
  const n = v.length, m = r0.length, J = Array.from({ length: m }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(v[j])), old = v[j];
    v[j] = old + h; const rp = evalAll(v); v[j] = old - h; const rm = evalAll(v); v[j] = old;
    for (let i = 0; i < m; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
  }
  return J;
}
// Solves A x = b for a small dense symmetric positive definite system (Gaussian elimination, partial pivoting).
function solveDense(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) continue;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => Math.abs(row[i]) < 1e-300 ? 0 : row[n] / row[i]);
}
const norm2 = r => r.reduce((s, x) => s + x * x, 0);

// Returns solved positions. `drag` = Set of point/circle ids that should move as little as possible (being dragged).
export function solveSketch(geo, { drag = null, iterations = 100, tol = 1e-22 } = {}) {
  const sys = buildSystem(geo, drag);
  const v = sys.vars.slice();
  let r = sys.evalAll(v), err = norm2(r);
  const n = v.length, sw = sys.weight.map(w => 1 / Math.sqrt(w));
  for (let it = 0; it < iterations && err > tol && r.length; it++) {
    const J = jacobian(sys.evalAll, v, r);
    for (const row of J) for (let j = 0; j < n; j++) row[j] *= sw[j];        // weighted minimum-norm step
    const m = r.length, A = Array.from({ length: m }, () => new Array(m).fill(0));
    let tr = 0;
    for (let i = 0; i < m; i++) for (let k = i; k < m; k++) { let s = 0; const a = J[i], b = J[k]; for (let j = 0; j < n; j++) s += a[j] * b[j]; A[i][k] = A[k][i] = s; if (i === k) tr += s; }
    const mu = 1e-10 * (tr / m || 1) + 1e-14;
    for (let i = 0; i < m; i++) A[i][i] += mu;
    const y = solveDense(A, r);
    const step = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; step[j] = -s * sw[j]; }
    let t = 1, improved = false;
    for (let ls = 0; ls < 12; ls++) {
      const trial = v.map((x, j) => x + t * step[j]);
      const rt = sys.evalAll(trial), et = norm2(rt);
      if (et < err || et < tol) { for (let j = 0; j < n; j++) v[j] = trial[j]; r = rt; err = et; improved = true; break; }
      t /= 2;
    }
    if (!improved) break;
  }
  const points = new Map([['O', { x: 0, y: 0 }]]);
  for (const [id, i] of sys.pIndex) points.set(id, { x: v[i], y: v[i + 1] });
  const radii = new Map(); for (const [id, i] of sys.rIndex) radii.set(id, v[i]);
  return { ok: err < 1e-12, residual: Math.sqrt(err), points, radii, sys, v };
}

// Degrees of freedom and which entities are fully constrained (no free motion in the solution's null space).
export function analyzeSketch(geo, solved) {
  const sys = buildSystem(geo, null);
  const v = sys.vars.slice();
  for (const [id, i] of sys.pIndex) { const p = solved.points.get(id); if (p) { v[i] = p.x; v[i + 1] = p.y; } }
  for (const [id, i] of sys.rIndex) if (solved.radii.has(id)) v[i] = solved.radii.get(id);
  const n = v.length;
  if (!n) return { dof: 0, free: new Set() };
  const r = sys.evalAll(v);
  const J = r.length ? jacobian(sys.evalAll, v, r).map(row => Array.from(row)) : [];
  // row-reduce to find pivot columns; null-space basis from the free columns
  const M = J.map(row => row.slice()), pivots = [];
  let row = 0;
  for (let c = 0; c < n && row < M.length; c++) {
    let p = row; for (let i = row + 1; i < M.length; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-7) continue;
    [M[row], M[p]] = [M[p], M[row]];
    const piv = M[row][c]; for (let k = 0; k < n; k++) M[row][k] /= piv;
    for (let i = 0; i < M.length; i++) if (i !== row && Math.abs(M[i][c]) > 0) { const f = M[i][c]; for (let k = 0; k < n; k++) M[i][k] -= f * M[row][k]; }
    pivots.push(c); row++;
  }
  const pivotSet = new Set(pivots), freeVar = new Array(n).fill(false);
  for (let fc = 0; fc < n; fc++) {
    if (pivotSet.has(fc)) continue;
    freeVar[fc] = true;                                   // the free column itself moves
    pivots.forEach((pc, ri) => { if (Math.abs(M[ri][fc]) > 1e-7) freeVar[pc] = true; });
  }
  const free = new Set();
  for (const [id, i] of sys.pIndex) if (freeVar[i] || freeVar[i + 1]) free.add(id);
  for (const [id, i] of sys.rIndex) if (freeVar[i]) free.add(id);
  for (const c of geo.curves) {
    const ids = c.kind === 'line' ? [c.a, c.b] : c.kind === 'arc' ? [c.c, c.a, c.b] : c.kind === 'spline' ? [...c.pts, c.a, c.b] : [c.c, c.id];
    if (ids.some(id => free.has(id))) free.add(c.id);
  }
  return { dof: n - pivots.length, free };
}

// Writes solved values back into a geo object (returns a new object).
export function applySolved(geo, solved) {
  const g = JSON.parse(JSON.stringify(geo));
  const r6 = x => Math.round(x * 1e6) / 1e6;
  for (const p of g.points) { const s = solved.points.get(p.id); if (s && p.id !== 'O') { p.x = r6(s.x); p.y = r6(s.y); } }
  for (const c of g.curves) if (c.kind === 'circle' && solved.radii.has(c.id) && typeof c.r === 'number') c.r = r6(solved.radii.get(c.id));
  return g;
}

// Closed loops of non-construction lines/arcs (+ circles) become profiles the kernels can extrude.
export function geoProfiles(geo, solved) {
  const pts = solved ? solved.points : new Map(geo.points.map(p => [p.id, p]));
  const P = id => { const p = id === 'O' ? { x: 0, y: 0 } : pts.get(id); return [p.x, p.y]; };
  // points joined by coincident constraints count as one node
  const parent = new Map(); const find = x => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  for (const k of geo.cons) if (k.type === 'coincident') { const a = find(k.e[0]), b = find(k.e[1]); if (a !== b) parent.set(a, b); }
  const profiles = [], info = { open: 0, branching: 0 };
  const edges = [];
  for (const c of geo.curves) {
    if (c.constr) continue;
    if (c.kind === 'circle') { const cc = P(c.c), r = solved?.radii.get(c.id) ?? +c.r; if (r > 0) profiles.push({ id: 'geo-' + c.id, kind: 'circle', cx: cc[0], cy: cc[1], r }); continue; }
    edges.push(c);
  }
  const adj = new Map();
  for (const c of edges) for (const end of [c.a, c.b]) { const k = find(end); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(c); }
  const used = new Set();
  for (const start of edges) {
    if (used.has(start.id)) continue;
    // walk the chain from start.a
    const seq = []; let cur = start, node = find(start.a), ok = true;
    const comp = new Set();
    while (cur && !used.has(cur.id)) {
      used.add(cur.id); comp.add(cur.id);
      const forward = find(cur.a) === node;
      seq.push({ c: cur, forward });
      node = forward ? find(cur.b) : find(cur.a);
      const nexts = (adj.get(node) || []).filter(x => x.id !== cur.id);
      if ((adj.get(node) || []).length !== 2) { ok = false; break; }
      cur = nexts[0] && !used.has(nexts[0].id) ? nexts[0] : null;
    }
    const closed = ok && node === find(start.a) && seq.length >= 1 && (adj.get(node) || []).length === 2;
    if (!closed) { const branch = [...comp].some(id => { const c = edges.find(x => x.id === id); return [c.a, c.b].some(e => (adj.get(find(e)) || []).length > 2); }); branch ? info.branching++ : info.open++; continue; }
    const segs = seq.map(({ c, forward }) => {
      const a = P(forward ? c.a : c.b), b = P(forward ? c.b : c.a);
      if (c.kind === 'line') return [{ t: 'line', a, b, id: c.id, forward }];
      if (c.kind === 'spline') { const sp = splineSpans(c, P, geo); return (forward ? sp : sp.reverse().map(B => [...B].reverse())).map(B => ({ t: 'bez', a: B[0], b: B[3], P: B, id: c.id, forward })); }
      const cc = P(c.c);
      return [{ t: 'arc', a, b, c: cc, ccw: forward, id: c.id, forward }];
    }).flat();
    if (segs.length === 1 && segs[0].t === 'line') { info.open++; continue; }
    if (seq.length === 1 && seq[0].c.kind === 'spline' && seq[0].c.a !== seq[0].c.b) { info.open++; continue; }
    profiles.push({ id: 'geo-loop-' + start.id, kind: 'loop', segs });
  }
  return { profiles, info };
}
export function arcMid(seg) {
  const [cx, cy] = seg.c, r = Math.hypot(seg.a[0] - cx, seg.a[1] - cy);
  let a0 = Math.atan2(seg.a[1] - cy, seg.a[0] - cx), a1 = Math.atan2(seg.b[1] - cy, seg.b[0] - cx);
  if (seg.ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return { r, a0, a1, mid: [cx + r * Math.cos((a0 + a1) / 2), cy + r * Math.sin((a0 + a1) / 2)] };
}

// Sketch feature with its constrained geometry solved and closed loops added as profiles.
export function sketchWithGeo(f) {
  if (!f.geo || !f.geo.curves?.length) return f;
  const s = solveSketch(f.geo);
  if (!s.ok) throw new Error('The sketch constraints conflict. Edit the sketch to fix them.');
  return { ...f, regions: geoRegions(f.geo, s) };
}
// Everything a solid feature uses from a sketch: legacy primitive profiles + chosen regions.
export function sketchUse(sk, refs) {
  return { profiles: [...(sk.profiles || []), ...textProfiles(sk, refs)], regions: pickRegions(sk.regions || [], refs) };
}

// Open chains of non-construction lines/arcs (sweep paths), ordered from one free end to the other.
// Closed loops are returned too (after the open ones) so a ring can be a path.
export function geoPaths(geo, solved) {
  const pts = solved ? solved.points : new Map(geo.points.map(p => [p.id, p]));
  const P = id => { const p = id === 'O' ? { x: 0, y: 0 } : pts.get(id); return [p.x, p.y]; };
  const parent = new Map(); const find = x => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  for (const k of geo.cons) if (k.type === 'coincident') { const a = find(k.e[0]), b = find(k.e[1]); if (a !== b) parent.set(a, b); }
  const edges = geo.curves.filter(c => !c.constr && c.kind !== 'circle');
  const adj = new Map();
  for (const c of edges) for (const end of [c.a, c.b]) { const k = find(end); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(c); }
  if ([...adj.values()].some(l => l.length > 2)) return { paths: [], branching: true };
  const used = new Set(), open = [], closed = [];
  const walk = (startNode, first) => {
    const segs = []; let node = startNode, cur = first;
    while (cur && !used.has(cur.id)) {
      used.add(cur.id);
      const forward = find(cur.a) === node;
      const a = P(forward ? cur.a : cur.b), b = P(forward ? cur.b : cur.a);
      if (cur.kind === 'spline') { const sp = splineSpans(cur, P, geo); for (const B of forward ? sp : sp.reverse().map(B => [...B].reverse())) segs.push({ t: 'bez', a: B[0], b: B[3], P: B, id: cur.id }); }
      else segs.push(cur.kind === 'line' ? { t: 'line', a, b, id: cur.id } : { t: 'arc', a, b, c: P(cur.c), ccw: forward, id: cur.id });
      node = find(forward ? cur.b : cur.a);
      cur = (adj.get(node) || []).find(x => !used.has(x.id)) || null;
    }
    return segs;
  };
  for (const [node, list] of adj) if (list.length === 1 && !used.has(list[0].id)) open.push(walk(node, list[0]));
  for (const c of edges) if (!used.has(c.id)) closed.push(walk(find(c.a), c));
  return { paths: [...open.map(segs => ({ segs, closed: false })), ...closed.map(segs => ({ segs, closed: true }))], branching: false };
}

// ===== Planar arrangement: regions bounded by crossing curves =====
// Curves are split where they cross; the faces of the resulting planar graph are the regions.
// Each region: { outer: segs, holes: [segs], sample: [x, y] interior point, filled: even-odd over closed loops (regions outside every loop count as filled), area }.
const TAU = Math.PI * 2;
// ---- fit-point splines: a chain of cubic Béziers through the points (chord-weighted Catmull-Rom tangents) ----
export function splineBeziers(P, closed = false, t0 = null, t1 = null) {
  const n = P.length; if (n < 2) return [];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], nrm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const m = P.map((p, i) => {
    if (closed || (i > 0 && i < n - 1)) { const pr = P[(i - 1 + n) % n], nx = P[(i + 1) % n], d0 = Math.hypot(...sub(p, pr)) || 1, d1 = Math.hypot(...sub(nx, p)) || 1; const a = sub(p, pr), b = sub(nx, p); return nrm([a[0] / d0 + b[0] / d1, a[1] / d0 + b[1] / d1]); }
    return null;
  });
  if (!closed) {
    if (n === 2) { m[0] = m[1] = nrm(sub(P[1], P[0])); }
    else {   // free ends: reflect the neighbouring tangent about the end chord
      const end = (i, j) => { const c = nrm(sub(P[j], P[i])), t = m[j], d = 2 * (c[0] * t[0] + c[1] * t[1]); return nrm([d * c[0] - t[0], d * c[1] - t[1]]); };
      m[0] = end(0, 1); m[n - 1] = end(n - 1, n - 2);   // reflection about the chord line keeps the forward sense
    }
  }
  if (!closed && t0) m[0] = nrm(t0);
  if (!closed && t1) m[n - 1] = nrm(t1);
  const out = [], spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = P[i], b = P[(i + 1) % n], d = Math.hypot(...sub(b, a)) / 3;
    out.push([a, [a[0] + m[i][0] * d, a[1] + m[i][1] * d], [b[0] - m[(i + 1) % n][0] * d, b[1] - m[(i + 1) % n][1] * d], b]);
  }
  return out;
}
export const bezPoint = (B, t) => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return [a * B[0][0] + b * B[1][0] + c * B[2][0] + d * B[3][0], a * B[0][1] + b * B[1][1] + c * B[2][1] + d * B[3][1]]; };
const bezDer = (B, t) => { const u = 1 - t; return [0, 1].map(k => 3 * u * u * (B[1][k] - B[0][k]) + 6 * u * t * (B[2][k] - B[1][k]) + 3 * t * t * (B[3][k] - B[2][k])); };
export function bezSub(B, t0, t1) {
  const split = (Q, t) => { const L = (p, q) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; const a = L(Q[0], Q[1]), b = L(Q[1], Q[2]), c = L(Q[2], Q[3]), d = L(a, b), e = L(b, c), f = L(d, e); return [[Q[0], a, d, f], [f, e, c, Q[3]]]; };
  if (t1 < t0) return bezSub(B, t1, t0).reverse();
  let R = t1 < 1 ? split(B, t1)[0] : B.map(p => [...p]);   // always a fresh copy: callers mutate it
  if (t0 > 0) R = split(R, t0 / (t1 || 1))[1];
  return R;
}
// ---- spline curves ----
// A spline stores its fit points `pts`; its ends `a`/`b` are normally the first/last fit point. After a trim an
// end is a separate point kept on the curve (onSpline), and the curve runs only between the two ends.
// A 'tangent' constraint [spline, line|arc] sharing an end makes the spline leave that end along the other curve.
const splineClosed = c => c.pts.length > 2 && c.pts[0] === c.pts[c.pts.length - 1];
function splineEndTangent(c, end, P, geo) {
  if (!geo || splineClosed(c)) return null;
  const S = end === 'a' ? c.pts[0] : c.pts[c.pts.length - 1];
  for (const k of geo.cons) {
    if (k.type !== 'tangent' || k.e[0] !== c.id) continue;
    const o = geo.curves.find(x => x.id === k.e[1]); if (!o) continue;
    let cont = null;                                   // direction leaving the other curve at S, continuing it
    if (o.kind === 'line' && (o.a === S || o.b === S)) { const f = P(o.a === S ? o.b : o.a), q = P(S); cont = [q[0] - f[0], q[1] - f[1]]; }
    else if (o.kind === 'arc' && (o.a === S || o.b === S)) { const cc = P(o.c), q = P(S), ccw = [-(q[1] - cc[1]), q[0] - cc[0]]; cont = o.b === S ? ccw : [-ccw[0], -ccw[1]]; }
    if (!cont || Math.hypot(...cont) < 1e-12) continue;
    return end === 'a' ? cont : [-cont[0], -cont[1]];
  }
  return null;
}
// all spans of the untrimmed curve
export function splineFull(c, P, geo) {
  const closed = splineClosed(c), ids = closed ? c.pts.slice(0, -1) : c.pts;
  return splineBeziers(ids.map(P), closed, splineEndTangent(c, 'a', P, geo), splineEndTangent(c, 'b', P, geo));
}
// global parameter s in [0, spans] of the point on the curve closest to q
export function splineClosest(spans, q) {
  let best = 0, bd = Infinity;
  spans.forEach((B, i) => { for (let k = 0; k <= 32; k++) { const p = bezPoint(B, k / 32), d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < bd) { bd = d; best = i + k / 32; } } });
  let i = Math.min(spans.length - 1, Math.floor(best)), t = best - i;
  for (let it = 0; it < 12; it++) {
    const B = spans[i], p = bezPoint(B, t), d1 = bezDer(B, t), h = 1e-5, d2 = bezDer(B, Math.min(1, t + h)).map((x, k) => (x - d1[k]) / h);
    const f = (p[0] - q[0]) * d1[0] + (p[1] - q[1]) * d1[1], fp = d1[0] ** 2 + d1[1] ** 2 + (p[0] - q[0]) * d2[0] + (p[1] - q[1]) * d2[1];
    if (Math.abs(fp) < 1e-14) break;
    const nt = t - f / fp;
    if (nt < 0 && i > 0) { i--; t = nt + 1; } else if (nt > 1 && i < spans.length - 1) { i++; t = nt - 1; } else t = Math.min(1, Math.max(0, nt));
    if (Math.abs(f / fp) < 1e-12) break;
  }
  return i + t;
}
export const splineAt = (spans, s) => { const i = Math.min(spans.length - 1, Math.max(0, Math.floor(s))); return bezPoint(spans[i], s - i); };
// parameter range of the visible part: [s0, s1], s1 may pass the seam of a closed spline
export function splineRange(c, spans, P) {
  const N = spans.length, closed = splineClosed(c);
  let s0 = c.a === c.pts[0] ? 0 : splineClosest(spans, P(c.a));
  let s1 = c.b === c.pts[c.pts.length - 1] ? N : splineClosest(spans, P(c.b));
  if (closed) { if (c.a !== c.pts[0] || c.b !== c.pts[0]) { if (s1 <= s0 + 1e-9) s1 += N; } }
  else if (s1 < s0) [s0, s1] = [s1, s0];
  return [s0, s1];
}
// Bézier spans of the visible part, each tagged with the global parameters it covers (g0, g1)
export function splineSpans(c, P, geo) {
  const full = splineFull(c, P, geo), N = full.length; if (!N) return [];
  const [s0, s1] = splineRange(c, full, P), out = [];
  for (let k = Math.floor(s0); k < s1; k++) {
    const a = Math.max(s0, k), b = Math.min(s1, k + 1); if (b - a < 1e-12) continue;
    const i = ((k % N) + N) % N, B = bezSub(full[i], a - k, b - k);
    B.g0 = a; B.g1 = b; out.push(B);
  }
  return out;
}
function arrCurves(geo, solved) {
  const pts = solved ? solved.points : new Map(geo.points.map(p => [p.id, p]));
  const P = id => { const p = id === 'O' ? { x: 0, y: 0 } : pts.get(id); return [p.x, p.y]; };
  const out = [];
  for (const c of geo.curves) {
    if (c.constr) continue;
    if (c.kind === 'line') { const a = P(c.a), b = P(c.b); if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) out.push({ id: c.id, kind: 'line', a, b }); }
    else if (c.kind === 'spline') splineSpans(c, P, geo).forEach((B, k) => out.push({ id: c.id + '#' + k, src: c.id, kind: 'bez', P: B, a: B[0], b: B[3], g0: B.g0, g1: B.g1 }));
    else {
      const cc = P(c.c);
      if (c.kind === 'circle') { const r = solved?.radii.get(c.id) ?? Math.abs(+c.r); if (r > 1e-9) out.push({ id: c.id, kind: 'arc', c: cc, r, a0: 0, a1: TAU, full: true }); }
      else { const a = P(c.a), b = P(c.b), r = Math.hypot(a[0] - cc[0], a[1] - cc[1]); let a0 = Math.atan2(a[1] - cc[1], a[0] - cc[0]), a1 = Math.atan2(b[1] - cc[1], b[0] - cc[0]); while (a1 <= a0 + 1e-12) a1 += TAU; if (r > 1e-9) out.push({ id: c.id, kind: 'arc', c: cc, r, a0, a1 }); }
    }
  }
  return out;
}
const angIn = (c, th, tol = 1e-9) => { if (c.full) { let t = th % TAU; if (t < 0) t += TAU; return t; } let t = th; while (t < c.a0 - tol) t += TAU; while (t > c.a0 + TAU - tol) t -= TAU; return t <= c.a1 + tol ? t : null; };
const normAng = (c, th) => { if (c.full) { let t = th % TAU; if (t < 0) t += TAU; return t; } let t = th; while (t < c.a0 - 1e-9) t += TAU; while (t > c.a1 + 1e-9 && t - TAU >= c.a0 - 1e-9) t -= TAU; return t; };
const cPoint = (c, t) => c.kind === 'bez' ? bezPoint(c.P, t) : c.kind === 'line' ? [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t] : [c.c[0] + c.r * Math.cos(t), c.c[1] + c.r * Math.sin(t)];
// parameters (t on lines, angle on arcs) where curve i meets curve j
const cDer = (c, t) => c.kind === 'bez' ? bezDer(c.P, t) : c.kind === 'line' ? [c.b[0] - c.a[0], c.b[1] - c.a[1]] : [-c.r * Math.sin(t), c.r * Math.cos(t)];
// Curves with a Bézier: intersect polylines, then polish each hit with Newton on P(t) = Q(u).
function bezIntersect(A, B) {
  const N = 48, poly = c => c.kind === 'bez' ? Array.from({ length: N }, (_, i) => ({ kind: 'line', a: bezPoint(c.P, i / N), b: bezPoint(c.P, (i + 1) / N), t0: i / N, t1: (i + 1) / N })) : [c];
  const map = (c, piece, t) => c.kind === 'bez' ? piece.t0 + (piece.t1 - piece.t0) * t : t;
  const res = [];
  for (const pa of poly(A)) for (const pb of poly(B)) for (const [x, y] of intersect(pa, pb)) {
    if (x == null || y == null) continue;
    let t = map(A, pa, x), u = map(B, pb, y);
    for (let it = 0; it < 30; it++) {
      const p = cPoint(A, t), q = cPoint(B, u), dA = cDer(A, t), dB = cDer(B, u), f = [p[0] - q[0], p[1] - q[1]];
      if (Math.hypot(...f) < 1e-13) break;
      const det = dA[0] * -dB[1] - -dB[0] * dA[1]; if (Math.abs(det) < 1e-14) break;
      t -= (f[0] * -dB[1] - -dB[0] * f[1]) / det; u -= (dA[0] * f[1] - f[0] * dA[1]) / det;
    }
    const lim = (c, v) => c.kind === 'arc' ? angIn(c, v, 1e-7) : (v > -1e-7 && v < 1 + 1e-7 ? Math.min(1, Math.max(0, v)) : null);
    const tt = lim(A, t), uu = lim(B, u);
    if (tt == null || uu == null) continue;
    if (!res.some(([a, b]) => Math.hypot(...[0, 1].map(k => cPoint(A, a)[k] - cPoint(A, tt)[k])) < 1e-7)) res.push([tt, uu]);
  }
  return res;
}
function intersect(A, B) {
  const res = []; const tol = 1e-9;
  if (A.kind === 'bez' || B.kind === 'bez') return bezIntersect(A, B);
  if (A.kind === 'line' && B.kind === 'line') {
    const d1 = [A.b[0] - A.a[0], A.b[1] - A.a[1]], d2 = [B.b[0] - B.a[0], B.b[1] - B.a[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) {
      // collinear overlap: endpoints of each lying on the other
      const onSeg = (L, p) => { const d = [L.b[0] - L.a[0], L.b[1] - L.a[1]], ll = d[0] * d[0] + d[1] * d[1], t = ((p[0] - L.a[0]) * d[0] + (p[1] - L.a[1]) * d[1]) / ll, q = cPoint(L, t); return Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-7 && t > -tol && t < 1 + tol ? t : null; };
      for (const p of [B.a, B.b]) { const t = onSeg(A, p); if (t != null) res.push([t, null]); }
      for (const p of [A.a, A.b]) { const u = onSeg(B, p); if (u != null) res.push([null, u]); }
      return res;
    }
    const w = [B.a[0] - A.a[0], B.a[1] - A.a[1]], t = (w[0] * d2[1] - w[1] * d2[0]) / den, u = (w[0] * d1[1] - w[1] * d1[0]) / den;
    if (t > -tol && t < 1 + tol && u > -tol && u < 1 + tol) res.push([Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))]);
    return res;
  }
  if (A.kind === 'arc' && B.kind === 'line') return intersect(B, A).map(([x, y]) => [y, x]);
  if (A.kind === 'line') {
    const d = [A.b[0] - A.a[0], A.b[1] - A.a[1]], f = [A.a[0] - B.c[0], A.a[1] - B.c[1]];
    const a = d[0] * d[0] + d[1] * d[1], b = 2 * (f[0] * d[0] + f[1] * d[1]), c = f[0] * f[0] + f[1] * f[1] - B.r * B.r;
    let disc = b * b - 4 * a * c;
    if (disc < -1e-9 * a * B.r * B.r) return res;
    disc = Math.max(0, disc);
    const ts = disc < 1e-18 ? [-b / (2 * a)] : [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
    for (const t of ts) { if (t < -tol || t > 1 + tol) continue; const p = cPoint(A, Math.min(1, Math.max(0, t))), th = angIn(B, Math.atan2(p[1] - B.c[1], p[0] - B.c[0]), 1e-7); if (th != null) res.push([Math.min(1, Math.max(0, t)), th]); }
    return res;
  }
  const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1], d = Math.hypot(dx, dy);
  if (d < 1e-12 || d > A.r + B.r + 1e-9 || d < Math.abs(A.r - B.r) - 1e-9) return res;
  const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, A.r * A.r - a * a));
  const mx = A.c[0] + a * dx / d, my = A.c[1] + a * dy / d;
  const pts = hh < 1e-9 ? [[mx, my]] : [[mx + hh * dy / d, my - hh * dx / d], [mx - hh * dy / d, my + hh * dx / d]];
  for (const p of pts) { const ta = angIn(A, Math.atan2(p[1] - A.c[1], p[0] - A.c[0]), 1e-7), tb = angIn(B, Math.atan2(p[1] - B.c[1], p[0] - B.c[0]), 1e-7); if (ta != null && tb != null) res.push([ta, tb]); }
  return res;
}
// Where curve `id` would meet another curve if its end `end` ('a' | 'b') were extended.
// Lines extend along their direction, arcs around their circle. Returns { p, other, t } or null.
export function extendTarget(curves, id, end, reach = 1e5) {
  const C = curves.find(c => c.id === id); if (!C) return null;
  let ext, better;
  if (C.kind === 'line') {
    const [from, to] = end === 'b' ? [C.a, C.b] : [C.b, C.a], d = [to[0] - from[0], to[1] - from[1]], l = Math.hypot(...d);
    ext = { kind: 'line', a: to, b: [to[0] + d[0] / l * reach, to[1] + d[1] / l * reach] };
    better = (t, bt) => t > 1e-9 && (bt == null || t < bt);
  } else {
    if (C.full) return null;
    const gap = TAU - (C.a1 - C.a0); if (gap < 1e-9) return null;
    ext = end === 'b' ? { kind: 'arc', c: C.c, r: C.r, a0: C.a1, a1: C.a1 + gap } : { kind: 'arc', c: C.c, r: C.r, a0: C.a0 - gap, a1: C.a0 };
    better = end === 'b' ? (t, bt) => t > ext.a0 + 1e-9 && (bt == null || t < bt) : (t, bt) => t < ext.a1 - 1e-9 && (bt == null || t > bt);
  }
  let best = null;
  for (const o of curves) {
    if (o.id === id) continue;
    for (const [t] of intersect(ext, o)) if (t != null && better(t, best?.t)) best = { t, other: o.id, p: cPoint(ext, t) };
  }
  return best;
}
// Split points of every curve: [{ curve, params: sorted unique, hits: [{ t, other }] }]
export function curveSplits(curves) {
  const splits = curves.map(c => ({ curve: c, params: c.kind !== 'arc' ? [0, 1] : c.full ? [0, Math.PI] : [c.a0, c.a1], hits: [] }));
  for (let i = 0; i < curves.length; i++) for (let j = i + 1; j < curves.length; j++) {
    for (const [ti, tj] of intersect(curves[i], curves[j])) {
      if (ti != null) { const t = curves[i].kind !== 'arc' ? ti : normAng(curves[i], ti); splits[i].params.push(t); splits[i].hits.push({ t, other: curves[j].id }); }
      if (tj != null) { const t = curves[j].kind !== 'arc' ? tj : normAng(curves[j], tj); splits[j].params.push(t); splits[j].hits.push({ t, other: curves[i].id }); }
    }
  }
  for (const s of splits) {
    const c = s.curve, lo = c.kind !== 'arc' ? 0 : c.a0, hi = c.kind !== 'arc' ? 1 : c.full ? c.a0 + TAU : c.a1;
    const ps = s.params.map(t => Math.min(hi, Math.max(lo, t))).sort((x, y) => x - y), u = [];
    const eps = c.kind === 'line' ? 1e-9 : 1e-9;
    for (const t of ps) if (!u.length || t - u[u.length - 1] > eps) u.push(t);
    if (c.full) { if (u[u.length - 1] < hi - eps) u.push(hi); else u[u.length - 1] = hi; if (u[0] > lo + eps) u.unshift(lo); }
    s.params = u;
  }
  return splits;
}
function polyOfSegs(segs, n = 24) {
  const pts = [];
  for (const s of segs) {
    if (s.t === 'line') { pts.push(s.a); continue; }
    if (s.t === 'bez') { for (let i = 0; i < 16; i++) pts.push(bezPoint(s.P, i / 16)); continue; }
    const m = arcMid(s), k = Math.max(2, Math.ceil(Math.abs(m.a1 - m.a0) / TAU * n * 3));
    for (let i = 0; i < k; i++) { const t = m.a0 + (m.a1 - m.a0) * i / k; pts.push([s.c[0] + m.r * Math.cos(t), s.c[1] + m.r * Math.sin(t)]); }
  }
  return pts;
}
function pip(p, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
export function regionContains(region, p) { return pip(p, polyOfSegs(region.outer)) && !region.holes.some(h => pip(p, polyOfSegs(h))); }
export function geoRegions(geo, solved) {
  const curves = arrCurves(geo, solved);
  if (!curves.length) return [];
  const splits = curveSplits(curves);
  // vertices (merged) and edges
  const V = []; const vid = p => { for (let i = 0; i < V.length; i++) if (Math.hypot(V[i][0] - p[0], V[i][1] - p[1]) < 1e-6) return i; V.push(p); return V.length - 1; };
  let E = [];
  for (const s of splits) {
    const c = s.curve;
    for (let k = 0; k < s.params.length - 1; k++) {
      const t0 = s.params[k], t1 = s.params[k + 1]; if (t1 - t0 < 1e-12) continue;
      const u = vid(cPoint(c, t0)), v = vid(cPoint(c, t1)); if (u === v && c.kind !== 'arc') continue;
      E.push({ c, t0, t1, u, v });
    }
  }
  // prune dangling edges
  for (;;) { const deg = new Array(V.length).fill(0); for (const e of E) { deg[e.u]++; deg[e.v]++; } const n = E.length; E = E.filter(e => deg[e.u] > 1 && deg[e.v] > 1); if (E.length === n) break; }
  if (!E.length) return [];
  // half-edges with a departure direction (chord to a nearby point handles tangent ties)
  const H = [];
  E.forEach((e, i) => {
    const near = (from, to) => { const f = 0.02; return e.c.kind === 'line' ? (from === 0 ? cPoint(e.c, e.t0 + (e.t1 - e.t0) * f) : cPoint(e.c, e.t1 - (e.t1 - e.t0) * f)) : (from === 0 ? cPoint(e.c, e.t0 + (e.t1 - e.t0) * f) : cPoint(e.c, e.t1 - (e.t1 - e.t0) * f)); };
    const pu = V[e.u], pv = V[e.v], nu = near(0), nv = near(1);
    H.push({ e: i, fwd: true, from: e.u, to: e.v, ang: Math.atan2(nu[1] - pu[1], nu[0] - pu[0]) });
    H.push({ e: i, fwd: false, from: e.v, to: e.u, ang: Math.atan2(nv[1] - pv[1], nv[0] - pv[0]) });
  });
  const out = new Map(); H.forEach((h, i) => { if (!out.has(h.from)) out.set(h.from, []); out.get(h.from).push(i); });
  for (const l of out.values()) l.sort((a, b) => H[a].ang - H[b].ang);
  const twin = i => i ^ 1;
  const next = i => { const t = twin(i), l = out.get(H[i].to), k = l.indexOf(t); return l[(k - 1 + l.length) % l.length]; };
  const seg = i => { const h = H[i], e = E[h.e], a = V[h.from], b = V[h.to]; if (e.c.kind === 'bez') { const Q = bezSub(e.c.P, h.fwd ? e.t0 : e.t1, h.fwd ? e.t1 : e.t0); Q[0] = a; Q[3] = b; return { t: 'bez', a, b, P: Q }; } return e.c.kind === 'line' ? { t: 'line', a, b } : { t: 'arc', a, b, c: e.c.c, ccw: h.fwd }; };
  const greenArea = i => { const h = H[i], e = E[h.e];
    if (e.c.kind === 'bez') {   // x·y' − y·x' is a degree-5 polynomial: 3-point Gauss–Legendre is exact
      const s0 = h.fwd ? e.t0 : e.t1, s1 = h.fwd ? e.t1 : e.t0, hw = (s1 - s0) / 2, mid = (s0 + s1) / 2; let A = 0;
      for (const [x, w] of [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]]) { const t = mid + hw * x, p = bezPoint(e.c.P, t), d = bezDer(e.c.P, t); A += w * (p[0] * d[1] - p[1] * d[0]); }
      return A * hw / 2; }
    if (e.c.kind === 'line') { const a = V[h.from], b = V[h.to]; return (a[0] * b[1] - b[0] * a[1]) / 2; }
    const [cx, cy] = e.c.c, r = e.c.r, s = h.fwd ? e.t0 : e.t1, en = h.fwd ? e.t1 : e.t0;
    return 0.5 * (r * (cx * (Math.sin(en) - Math.sin(s)) - cy * (Math.cos(en) - Math.cos(s))) + r * r * (en - s)); };
  const seen = new Uint8Array(H.length), cycles = [];
  for (let i = 0; i < H.length; i++) {
    if (seen[i]) continue;
    const cyc = []; let j = i, guard = 0;
    while (!seen[j] && guard++ < H.length + 2) { seen[j] = 1; cyc.push(j); j = next(j); }
    const area = cyc.reduce((s, k) => s + greenArea(k), 0);
    // component id via union of edges
    cycles.push({ hs: cyc, area, segs: cyc.map(seg) });
  }
  // connected components of edges
  const comp = new Array(V.length).fill(-1); let nc = 0;
  for (let s = 0; s < V.length; s++) { if (comp[s] >= 0 || !out.has(s)) continue; const st = [s]; comp[s] = nc; while (st.length) { const x = st.pop(); for (const hi of out.get(x) || []) { const y = H[hi].to; if (comp[y] < 0) { comp[y] = nc; st.push(y); } } } nc++; }
  const faces = cycles.filter(c => c.area > 1e-9).map(c => ({ ...c, comp: comp[H[c.hs[0]].from], holes: [], poly: polyOfSegs(c.segs) }));
  const outers = cycles.filter(c => c.area < -1e-9).map(c => ({ ...c, comp: comp[H[c.hs[0]].from] }));
  for (const o of outers) {
    const p = V[H[o.hs[0]].from];
    let best = null;
    for (const f of faces) if (f.comp !== o.comp && pip(p, f.poly) && (!best || f.area < best.area)) best = f;
    if (best) best.holes.push(o.segs);
  }
  // interior sample point; even-odd fill counts the closed shapes as drawn (loops and circles) around it
  const allPolys = geoProfiles(geo, solved).profiles.map(p => p.kind === 'circle'
    ? Array.from({ length: 96 }, (_, i) => [p.cx + p.r * Math.cos(i * TAU / 96), p.cy + p.r * Math.sin(i * TAU / 96)]) : polyOfSegs(p.segs));
  return faces.map(f => {
    const holes = f.holes.map(h => polyOfSegs(h));
    const ys = f.poly.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let sample = null, bestW = -1;
    for (const fr of [0.5, 0.37, 0.63, 0.25, 0.75, 0.13, 0.87]) {
      const y = y0 + (y1 - y0) * fr + 1e-7, xs = [];
      for (const poly of [f.poly, ...holes]) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) { const w = xs[k + 1] - xs[k]; if (w > bestW) { bestW = w; sample = [(xs[k] + xs[k + 1]) / 2, y]; } }
      if (bestW > (y1 - y0) * 0.05) break;
    }
    if (!sample) sample = f.poly[0];
    let depth = 0; for (const poly of allPolys) if (pip(sample, poly)) depth++;
    return { outer: f.segs, holes: f.holes, sample, filled: depth % 2 === 1 || depth === 0, area: f.area };   // depth 0: closed only by crossing open curves (e.g. after a trim)
  });
}
// Regions chosen by stored sample points (or the even-odd default when none are stored).
export function pickRegions(regions, refs) {
  if (!refs?.length) return regions.filter(r => r.filled);
  const out = new Set();
  for (const p of refs) { const r = regions.find(x => regionContains(x, [p.x, p.y])); if (r) out.add(r); }
  return [...out];
}
