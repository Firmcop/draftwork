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
        const [x, y] = e.map(id => curves.get(id)); const line = x.kind === 'line' ? x : y.kind === 'line' ? y : null;
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
      case 'onCircle': res.push(v => { const p = P(v, e[0]), c = C(v, e[1]); return [Math.hypot(p[0] - c[0], p[1] - c[1]) - R(v, e[1])]; }); break;
      // dimensions
      case 'distance': res.push(v => { const p = P(v, e[0]), q = P(v, e[1]); return [Math.hypot(p[0] - q[0], p[1] - q[1]) - val]; }); break;
      case 'length': res.push(v => [len(dir(L(v, e[0]))) - val]); break;
      case 'hdist': res.push(v => [Math.abs(P(v, e[1])[0] - P(v, e[0])[0]) - val]); break;
      case 'vdist': res.push(v => [Math.abs(P(v, e[1])[1] - P(v, e[0])[1]) - val]); break;
      case 'radius': res.push(v => [R(v, e[0]) - val]); break;
      case 'diameter': res.push(v => [2 * R(v, e[0]) - val]); break;
      case 'angle': res.push(v => {
        const d1 = dir(L(v, e[0])), d2 = dir(L(v, e[1]));
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
    const ids = c.kind === 'line' ? [c.a, c.b] : c.kind === 'arc' ? [c.c, c.a, c.b] : [c.c, c.id];
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
      if (c.kind === 'line') return { t: 'line', a, b, id: c.id, forward };
      const cc = P(c.c);
      return { t: 'arc', a, b, c: cc, ccw: forward, id: c.id, forward };
    });
    if (segs.length === 1 && segs[0].t === 'line') { info.open++; continue; }
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
  const { profiles } = geoProfiles(f.geo, s);
  return { ...f, profiles: [...(f.profiles || []), ...profiles] };
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
      segs.push(cur.kind === 'line' ? { t: 'line', a, b, id: cur.id } : { t: 'arc', a, b, c: P(cur.c), ccw: forward, id: cur.id });
      node = find(forward ? cur.b : cur.a);
      cur = (adj.get(node) || []).find(x => !used.has(x.id)) || null;
    }
    return segs;
  };
  for (const [node, list] of adj) if (list.length === 1 && !used.has(list[0].id)) open.push(walk(node, list[0]));
  for (const c of edges) if (!used.has(c.id)) closed.push(walk(find(c.a), c));
  return { paths: [...open.map(segs => ({ segs, closed: false })), ...closed.map(segs => ({ segs, closed: true }))], branching: false };
}
