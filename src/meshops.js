// ===== Mesh bodies and mesh operations (pure JS, runs in the engine) =====
// A mesh is { pos: Float32Array (xyz per vertex), idx: Uint32Array (3 per triangle), groups?: Uint32Array (per triangle) }.
const MESH_TYPES = new Set(['meshinsert', 'tessellate', 'facegroups', 'meshrepair', 'remesh', 'reduce', 'smooth', 'meshconvert', 'meshplane']);
const importMeshes = new Map();   // fileId -> mesh (parsed once)

// ---- parsing ----
function parseSTL(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  const head = new TextDecoder().decode(u8.slice(0, Math.min(u8.length, 512)));
  const binary = u8.length === 84 + n * 50 || !/^\s*solid[\s\S]*facet/.test(head);
  const tri = [];
  if (binary) {
    for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) tri.push(dv.getFloat32(o + k * 4, true)); }
  } else {
    const txt = new TextDecoder().decode(u8), re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m;
    while ((m = re.exec(txt))) tri.push(+m[1], +m[2], +m[3]);
  }
  if (!tri.length) throw new Error('No triangles found in the STL file');
  return weldTriangles(new Float32Array(tri));
}
function parseOBJ(text) {
  const v = [], tri = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f') {
      const ids = t.slice(1).map(s => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? v.length + i : i - 1; });
      for (let k = 1; k + 1 < ids.length; k++) for (const j of [ids[0], ids[k], ids[k + 1]]) tri.push(...v[j]);
    }
  }
  if (!tri.length) throw new Error('No faces found in the OBJ file');
  return weldTriangles(new Float32Array(tri));
}
// triangle soup -> indexed mesh, merging vertices closer than tol
function weldTriangles(soup, tol = 1e-6) {
  const map = new Map(), pos = [], idx = new Uint32Array(soup.length / 3), q = 1 / Math.max(tol, 1e-9);
  for (let i = 0; i < soup.length; i += 3) {
    const k = Math.round(soup[i] * q) + ',' + Math.round(soup[i + 1] * q) + ',' + Math.round(soup[i + 2] * q);
    let j = map.get(k); if (j == null) { j = pos.length / 3; map.set(k, j); pos.push(soup[i], soup[i + 1], soup[i + 2]); }
    idx[i / 3] = j;
  }
  return cleanMesh({ pos: new Float32Array(pos), idx });
}
function meshFromShape(shape, tol = 0.05, ang = 0.2) {
  const m = shape.mesh({ tolerance: tol, angularTolerance: ang });
  return weldTriangles(expandMesh({ pos: new Float32Array(m.vertices), idx: new Uint32Array(m.triangles) }), 1e-5);   // faces come with their own vertices: weld the seams
}
// drop degenerate and duplicate triangles and unused vertices
function cleanMesh(m) {
  const { pos, idx } = m, seen = new Set(), keep = [], gk = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y).join(','); if (seen.has(s)) continue; seen.add(s);
    if (triArea(pos, a, b, c) < 1e-14) continue;
    keep.push(a, b, c); if (m.groups) gk.push(m.groups[t]);
  }
  const used = new Int32Array(pos.length / 3).fill(-1), np = []; let n = 0;
  const out = new Uint32Array(keep.length);
  keep.forEach((v, i) => { if (used[v] < 0) { used[v] = n++; np.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); } out[i] = used[v]; });
  return { pos: new Float32Array(np), idx: out, ...(m.groups ? { groups: new Uint32Array(gk) } : {}) };
}
const P_ = (pos, i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
function triNormal(pos, a, b, c) { const A = P_(pos, a), B = P_(pos, b), C = P_(pos, c); return vcross(vsub(B, A), vsub(C, A)); }
function triArea(pos, a, b, c) { return Math.hypot(...triNormal(pos, a, b, c)) / 2; }
const ekey = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
function edgeTris(idx) {
  const m = new Map();
  for (let t = 0; t < idx.length / 3; t++) for (let k = 0; k < 3; k++) { const key = ekey(idx[3 * t + k], idx[3 * t + (k + 1) % 3]); let l = m.get(key); if (!l) m.set(key, l = []); l.push(t); }
  return m;
}
function meshVolume(m) {
  let V = 0; const { pos, idx } = m;
  for (let t = 0; t < idx.length; t += 3) { const a = P_(pos, idx[t]), b = P_(pos, idx[t + 1]), c = P_(pos, idx[t + 2]); V += vdot(a, vcross(b, c)) / 6; }
  return V;
}
function meshStats(m) {
  const et = edgeTris(m.idx); let boundary = 0, nonManifold = 0;
  for (const l of et.values()) { if (l.length === 1) boundary++; else if (l.length > 2) nonManifold++; }
  return { tris: m.idx.length / 3, verts: m.pos.length / 3, boundary, nonManifold, closed: boundary === 0 && nonManifold === 0 };
}

// ---- repair: consistent orientation, outward normals, holes filled ----
function orientMesh(m) {
  const idx = Uint32Array.from(m.idx), nt = idx.length / 3, et = edgeTris(idx), done = new Uint8Array(nt);
  const hasDirected = (t, a, b) => { for (let k = 0; k < 3; k++) if (idx[3 * t + k] === a && idx[3 * t + (k + 1) % 3] === b) return true; return false; };
  for (let s = 0; s < nt; s++) {
    if (done[s]) continue; done[s] = 1; const q = [s];
    while (q.length) {
      const t = q.pop();
      for (let k = 0; k < 3; k++) {
        const a = idx[3 * t + k], b = idx[3 * t + (k + 1) % 3];
        for (const u of et.get(ekey(a, b))) {
          if (u === t || done[u]) continue;
          if (hasDirected(u, a, b)) { const x = idx[3 * u + 1]; idx[3 * u + 1] = idx[3 * u + 2]; idx[3 * u + 2] = x; }   // same direction -> flip the neighbour
          done[u] = 1; q.push(u);
        }
      }
    }
  }
  const out = { ...m, idx };
  if (meshVolume(out) < 0) for (let t = 0; t < nt; t++) { const x = idx[3 * t + 1]; idx[3 * t + 1] = idx[3 * t + 2]; idx[3 * t + 2] = x; }
  return out;
}
function fillHoles(m, maxEdges = 500) {
  const { pos, idx } = m, et = edgeTris(idx), next = new Map();
  // boundary half-edges, reversed (a hole is walked against the triangles' direction)
  for (let t = 0; t < idx.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = idx[3 * t + k], b = idx[3 * t + (k + 1) % 3];
    if (et.get(ekey(a, b)).length === 1) next.set(b, a);
  }
  const np = Array.from(pos), ni = Array.from(idx), groups = m.groups ? Array.from(m.groups) : null; let filled = 0;
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = []; let v = start;
    while (v != null && !used.has(v) && loop.length <= maxEdges) { used.add(v); loop.push(v); v = next.get(v); }
    if (v !== start || loop.length < 3) continue;
    const c = [0, 0, 0]; for (const i of loop) { c[0] += pos[3 * i]; c[1] += pos[3 * i + 1]; c[2] += pos[3 * i + 2]; }
    const ci = np.length / 3; np.push(c[0] / loop.length, c[1] / loop.length, c[2] / loop.length);
    for (let i = 0; i < loop.length; i++) { ni.push(loop[i], loop[(i + 1) % loop.length], ci); if (groups) groups.push(0); }
    filled++;
  }
  return { mesh: { pos: new Float32Array(np), idx: new Uint32Array(ni), ...(groups ? { groups: new Uint32Array(groups) } : {}) }, filled };
}

// ---- refine: split edges longer than L (conforming: 1-to-2, 1-to-3 or 1-to-4 per triangle) ----
function refineMesh(m, L, passes = 8) {
  let pos = Array.from(m.pos), idx = Array.from(m.idx);
  for (let p = 0; p < passes; p++) {
    const mid = new Map(); let any = false;
    const len = (a, b) => Math.hypot(pos[3 * a] - pos[3 * b], pos[3 * a + 1] - pos[3 * b + 1], pos[3 * a + 2] - pos[3 * b + 2]);
    const M = (a, b) => { const k = ekey(a, b); let v = mid.get(k); if (v == null) { v = pos.length / 3; pos.push((pos[3 * a] + pos[3 * b]) / 2, (pos[3 * a + 1] + pos[3 * b + 1]) / 2, (pos[3 * a + 2] + pos[3 * b + 2]) / 2); mid.set(k, v); } return v; };
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = idx[t + k], b = idx[t + (k + 1) % 3]; if (len(a, b) > L) { M(a, b); any = true; } }
    if (!any) break;
    const out = [];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]], e = [0, 1, 2].map(k => mid.get(ekey(v[k], v[(k + 1) % 3])));
      const n = e.filter(x => x != null).length;
      if (n === 0) out.push(...v);
      else if (n === 3) out.push(v[0], e[0], e[2], e[0], v[1], e[1], e[2], e[1], v[2], e[0], e[1], e[2]);
      else if (n === 1) { const k = e.findIndex(x => x != null); const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], m1 = e[k]; out.push(a, m1, c, m1, b, c); }
      else {
        const k = e.findIndex(x => x == null), a = v[(k + 2) % 3], b = v[k], c = v[(k + 1) % 3];   // edge b-c is not split; a is opposite
        const mab = e[(k + 2) % 3], mca = e[(k + 1) % 3];
        out.push(a, mab, mca, mab, b, c, mab, c, mca);
      }
    }
    idx = out;
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

// ---- edge-collapse simplification (quadric error metric); `costMode: 'length'` collapses the shortest edges ----
function simplifyMesh(m, targetTris, { costMode = 'qem', maxLen = Infinity } = {}) {
  const pos = Array.from(m.pos), idx = Array.from(m.idx), nv = pos.length / 3, nt = idx.length / 3;
  const alive = new Uint8Array(nt).fill(1), vt = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[idx[3 * t + k]].add(t);
  const Q = new Float64Array(nv * 10);
  const addQ = (v, a, b, c, d) => { const q = Q.subarray(v * 10, v * 10 + 10); q[0] += a * a; q[1] += a * b; q[2] += a * c; q[3] += a * d; q[4] += b * b; q[5] += b * c; q[6] += b * d; q[7] += c * c; q[8] += c * d; q[9] += d * d; };
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]], n = triNormal(pos, a, b, c), l = Math.hypot(...n); if (l < 1e-20) continue;
    const nn = n.map(x => x / l), d = -vdot(nn, P_(pos, a)), w = l / 2;
    for (const v of [a, b, c]) addQ(v, nn[0] * Math.sqrt(w), nn[1] * Math.sqrt(w), nn[2] * Math.sqrt(w), d * Math.sqrt(w));
  }
  // boundary edges: heavy penalty planes so outlines keep their shape
  const et = edgeTris(idx), boundaryV = new Uint8Array(nv);
  for (const [key, l] of et) if (l.length === 1) { const a = Math.floor(key / 4294967296), b = key % 4294967296; boundaryV[a] = boundaryV[b] = 1; }
  const err = (v, p) => { const q = Q.subarray(v * 10, v * 10 + 10), [x, y, z] = p; return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9]; };
  const ver = new Uint32Array(nv), heap = [];
  const push = (c, a, b, va, vb, p) => { heap.push([c, a, b, va, vb, p]); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; [heap[i], heap[s]] = [heap[s], heap[i]]; i = s; } } return top; };
  const consider = (a, b) => {
    if (boundaryV[a] !== boundaryV[b]) return;   // keep boundary vertices on the boundary
    const pa = P_(pos, a), pb = P_(pos, b), len = Math.hypot(...vsub(pa, pb));
    if (len > maxLen) return;
    let best = null, bc = Infinity;
    for (const p of [pa, pb, pa.map((x, i) => (x + pb[i]) / 2)]) { const c = err(a, p) + err(b, p); if (c < bc) { bc = c; best = p; } }
    push(costMode === 'length' ? len : bc, a, b, ver[a], ver[b], best);
  };
  for (const key of et.keys()) consider(Math.floor(key / 4294967296), key % 4294967296);
  let tris = nt;
  while (tris > targetTris && heap.length) {
    const [, a, b, va, vb, p] = pop();
    if (ver[a] !== va || ver[b] !== vb || !vt[a].size || !vt[b].size) continue;
    // reject collapses that flip a triangle or make a non-manifold fold
    const shared = [...vt[a]].filter(t => vt[b].has(t));
    if (shared.length > 2) continue;
    const na = new Set(), nb = new Set();
    for (const t of vt[a]) for (let k = 0; k < 3; k++) na.add(idx[3 * t + k]);
    for (const t of vt[b]) for (let k = 0; k < 3; k++) nb.add(idx[3 * t + k]);
    let common = 0; for (const v of na) if (nb.has(v) && v !== a && v !== b) common++;
    if (common > 2) continue;
    let flip = false;
    for (const t of [...vt[a], ...vt[b]]) {
      if (shared.includes(t)) continue;
      const v = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]], n0 = triNormal(pos, ...v);
      const P = v.map(x => (x === a || x === b) ? p : P_(pos, x)), n1 = vcross(vsub(P[1], P[0]), vsub(P[2], P[0]));
      if (vdot(n0, n1) <= 0.2 * Math.hypot(...n0) * Math.hypot(...n1)) { flip = true; break; }
    }
    if (flip) continue;
    // collapse b into a
    pos[3 * a] = p[0]; pos[3 * a + 1] = p[1]; pos[3 * a + 2] = p[2];
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    for (const t of shared) { alive[t] = 0; tris--; for (let k = 0; k < 3; k++) vt[idx[3 * t + k]].delete(t); }
    for (const t of vt[b]) { for (let k = 0; k < 3; k++) if (idx[3 * t + k] === b) idx[3 * t + k] = a; vt[a].add(t); }
    vt[b].clear(); ver[a]++; ver[b]++;
    const nbrs = new Set(); for (const t of vt[a]) for (let k = 0; k < 3; k++) nbrs.add(idx[3 * t + k]);
    nbrs.delete(a); for (const v of nbrs) consider(a, v);
  }
  const keep = []; for (let t = 0; t < nt; t++) if (alive[t]) keep.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
  return cleanMesh({ pos: new Float32Array(pos), idx: new Uint32Array(keep) });
}

// ---- smoothing ----
function neighbours(m) {
  const nb = Array.from({ length: m.pos.length / 3 }, () => new Set());
  for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = m.idx[t + k], b = m.idx[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  return nb;
}
function boundaryVerts(m) { const b = new Uint8Array(m.pos.length / 3); for (const [key, l] of edgeTris(m.idx)) if (l.length === 1) { b[Math.floor(key / 4294967296)] = 1; b[key % 4294967296] = 1; } return b; }
function creaseVerts(m, cosLim = 0.8) {
  const vn = new Float64Array(m.pos.length), fn = [], cr = new Uint8Array(m.pos.length / 3);
  for (let t = 0; t < m.idx.length; t += 3) { const n = vnorm(triNormal(m.pos, m.idx[t], m.idx[t + 1], m.idx[t + 2])); fn.push(n); for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) vn[3 * m.idx[t + k] + i] += n[i]; }
  for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) { const v = m.idx[t + k]; if (vdot(vnorm([vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]]), fn[t / 3]) < cosLim) cr[v] = 1; }
  return cr;
}
function smoothMesh(m, iterations = 5, strength = 0.5, keepEdges = false) {
  const nb = neighbours(m), bd = boundaryVerts(m); let pos = Float32Array.from(m.pos);
  if (keepEdges) { const cr = creaseVerts(m); cr.forEach((c, i) => { if (c) bd[i] = 1; }); }
  const step = f => { const out = Float32Array.from(pos); for (let v = 0; v < nb.length; v++) { if (bd[v] || !nb[v].size) continue; const c = [0, 0, 0]; for (const u of nb[v]) { c[0] += pos[3 * u]; c[1] += pos[3 * u + 1]; c[2] += pos[3 * u + 2]; } for (let i = 0; i < 3; i++) out[3 * v + i] = pos[3 * v + i] + f * (c[i] / nb[v].size - pos[3 * v + i]); } pos = out; };
  const lam = Math.max(0.05, Math.min(0.9, strength)), mu = -lam / (1 - 0.1 * lam);   // Taubin: shrink then inflate
  for (let i = 0; i < iterations; i++) { step(lam); step(mu); }
  return { ...m, pos };
}
// tangential relaxation: even out vertex spacing without shrinking the shape
function relaxMesh(m, iterations = 3) {
  let pos = Float32Array.from(m.pos);
  const nb = neighbours(m), bd = boundaryVerts(m);
  for (let it = 0; it < iterations; it++) {
    const vn = new Float64Array(pos.length);
    for (let t = 0; t < m.idx.length; t += 3) { const n = triNormal(pos, m.idx[t], m.idx[t + 1], m.idx[t + 2]); for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) vn[3 * m.idx[t + k] + i] += n[i]; }
    // vertices on creases or corners stay put (their tangent plane is not defined)
    const crease = new Uint8Array(nb.length), fn = [];
    for (let t = 0; t < m.idx.length; t += 3) fn.push(vnorm(triNormal(pos, m.idx[t], m.idx[t + 1], m.idx[t + 2])));
    for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) { const v = m.idx[t + k], n = vnorm([vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]]); if (vdot(n, fn[t / 3]) < 0.95) crease[v] = 1; }
    const out = Float32Array.from(pos);
    for (let v = 0; v < nb.length; v++) {
      if (bd[v] || crease[v] || !nb[v].size) continue;
      const c = [0, 0, 0]; for (const u of nb[v]) for (let i = 0; i < 3; i++) c[i] += pos[3 * u + i] / nb[v].size;
      const d = [0, 1, 2].map(i => c[i] - pos[3 * v + i]), n = vnorm([vn[3 * v], vn[3 * v + 1], vn[3 * v + 2]]), dn = vdot(d, n);
      for (let i = 0; i < 3; i++) out[3 * v + i] = pos[3 * v + i] + 0.5 * (d[i] - dn * n[i]);
    }
    pos = out;
  }
  return { ...m, pos };
}
function avgEdge(m) { let s = 0, n = 0; for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = m.idx[t + k], b = m.idx[t + (k + 1) % 3]; s += Math.hypot(...vsub(P_(m.pos, a), P_(m.pos, b))); n++; } return n ? s / n : 1; }
function remeshMesh(m, L) {
  let r = refineMesh(m, L * 4 / 3, 10);
  const nt = r.idx.length / 3;
  r = simplifyMesh(r, 0, { costMode: 'length', maxLen: L * 4 / 5 });
  void nt;
  return relaxMesh(r, 3);
}
// ---- face groups: regions of similar normal ----
function faceGroups(m, angleDeg = 20) {
  const nt = m.idx.length / 3, et = edgeTris(m.idx), N = [], g = new Int32Array(nt).fill(-1), cos = Math.cos(angleDeg * Math.PI / 180), cos2 = Math.cos(Math.min(89, 2 * angleDeg) * Math.PI / 180);
  for (let t = 0; t < nt; t++) N.push(vnorm(triNormal(m.pos, m.idx[3 * t], m.idx[3 * t + 1], m.idx[3 * t + 2])));
  let k = 0;
  for (let s = 0; s < nt; s++) {
    if (g[s] >= 0) continue; g[s] = k; const q = [s], seed = N[s];
    while (q.length) {
      const t = q.pop();
      for (let e = 0; e < 3; e++) for (const u of et.get(ekey(m.idx[3 * t + e], m.idx[3 * t + (e + 1) % 3]))) {
        if (g[u] >= 0) continue;
        if (vdot(N[u], N[t]) >= cos && vdot(N[u], seed) >= cos2) { g[u] = k; q.push(u); }
      }
    }
    k++;
  }
  return { ...m, groups: Uint32Array.from(g), groupCount: k };
}
// ---- mesh -> B-rep (faceted solid; coplanar triangles merged for 'prismatic') ----
function meshToBrep(m, merge) {
  const nt = m.idx.length / 3;
  if (nt > 20000) throw new Error(`The mesh has ${nt.toLocaleString('en-US')} triangles; reduce it below 20,000 before converting`);
  const oc = occ(), sw = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  for (let t = 0; t < nt; t++) {
    const P = [0, 1, 2].map(k => P_(m.pos, m.idx[3 * t + k]));
    try { const f = RC.makePolygon(P); sw.Add(f.wrapped); } catch (e) { /* skip slivers */ }
  }
  sw.Perform(new oc.Message_ProgressRange());
  let shape = RC.cast(sw.SewedShape());
  try { const shells = [...RC.iterTopo(shape.wrapped, 'shell')].map(s => RC.cast(s)); if (shells.length === 1) { const s = RC.makeSolid(shells); if (RC.measureVolume(s) > 1e-9) shape = s; } } catch (e) { /* stays a surface */ }
  if (merge) { const u = new oc.ShapeUpgrade_UnifySameDomain(shape.wrapped, true, true, false); u.Build(); shape = RC.cast(u.Shape()); }
  return shape;
}
function transformMesh(m, M) {
  const pos = Float32Array.from(m.pos), e = M.elements;
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2]; pos[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
  return { ...m, pos };
}

function mNew(out, id, mesh, fid) { out.bodyCount++; out.mbodies.set(id, { id, name: 'Body ' + out.bodyCount, feature: fid, ...mesh }); out.lastMesh = id; }
function mReplace(out, id, mesh) { const b = out.mbodies.get(id); out.mbodies.set(id, { id, name: b.name, feature: b.feature, ...mesh }); }
function meshStep(f, out) {
  const getM = () => { const b = out.mbodies.get(f.body || out.lastMesh); if (!b) throw new Error('Choose a mesh body'); return b; };
  switch (f.type) {
    case 'meshinsert': {
      const src = importMeshes.get(f.file); if (!src) throw new Error(f.file ? 'Reading the mesh file…' : 'The mesh file is missing');
      const s = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[f.units || 'mm'] || 1;
      let M = new THREE.Matrix4().makeScale(s, s, s);
      if (f.upY) M = new THREE.Matrix4().makeRotationX(Math.PI / 2).multiply(M);
      let mesh = transformMesh(src, M);
      if (f.center !== false) {
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < mesh.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.pos[i + k]); hi[k] = Math.max(hi[k], mesh.pos[i + k]); }
        mesh = transformMesh(mesh, new THREE.Matrix4().makeTranslation(-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]));
      }
      return mNew(out, f.id, mesh, f.id);
    }
    case 'tessellate': {
      const b = out.bodies.get(f.body); if (!b) throw new Error('Choose a solid or surface body');
      const mesh = meshFromShape(b.shape, Math.max(0.001, +f.tolerance || 0.05), Math.max(0.01, (+f.angle || 10) * Math.PI / 180));
      if (!f.keep) out.bodies.delete(b.id);
      return mNew(out, f.id, mesh, f.id);
    }
    case 'facegroups': { const b = getM(); return mReplace(out, b.id, faceGroups(b, +f.angle || 20)); }
    case 'meshrepair': {
      const b = getM(); let mesh = cleanMesh(weldTriangles(expandMesh(b), Math.max(1e-7, +f.tolerance || 1e-4)));
      mesh = orientMesh(mesh);
      if (f.fill !== false) mesh = orientMesh(fillHoles(mesh).mesh);
      return mReplace(out, b.id, mesh);
    }
    case 'remesh': { const b = getM(); const L = +f.edge > 0 ? +f.edge : avgEdge(b); return mReplace(out, b.id, remeshMesh(b, L)); }
    case 'reduce': {
      const b = getM(), nt = b.idx.length / 3, target = f.mode === 'count' ? Math.max(4, Math.round(+f.count || nt / 2)) : Math.max(4, Math.round(nt * Math.min(100, Math.max(1, +f.percent || 50)) / 100));
      return mReplace(out, b.id, simplifyMesh(b, target));
    }
    case 'smooth': { const b = getM(); return mReplace(out, b.id, smoothMesh(b, Math.max(1, Math.round(+f.iterations || 5)), +f.strength || 0.5, !!f.keepEdges)); }
    case 'meshconvert': {
      const b = getM(), shape = T(meshToBrep(b, f.method !== 'faceted'));
      if (!f.keep) out.mbodies.delete(b.id);
      return bNew(out, f.id, shape, f.id);
    }
    case 'meshplane': {
      // cut a mesh with a plane, keeping one side (triangles crossing the plane are split)
      const b = getM(), M = planeFrameOf(f.tool || 'XY', out), e = M.elements, n = [e[8], e[9], e[10]], o = [e[12], e[13], e[14]], s = f.keep === 'negative' ? -1 : 1;
      return mReplace(out, b.id, planeCutMesh(b, o, n.map(x => x * s), f.fill !== false));
    }
  }
}
function expandMesh(m) { const out = new Float32Array(m.idx.length * 3); m.idx.forEach((v, i) => { out[3 * i] = m.pos[3 * v]; out[3 * i + 1] = m.pos[3 * v + 1]; out[3 * i + 2] = m.pos[3 * v + 2]; }); return out; }
function planeCutMesh(m, o, n, fill) {
  const d = i => (m.pos[3 * i] - o[0]) * n[0] + (m.pos[3 * i + 1] - o[1]) * n[1] + (m.pos[3 * i + 2] - o[2]) * n[2];
  const soup = [], P = i => P_(m.pos, i), lerp = (a, b) => { const da = d(a), db = d(b), t = da / (da - db), A = P(a), B = P(b); return A.map((x, k) => x + (B[k] - x) * t); };
  for (let t = 0; t < m.idx.length; t += 3) {
    const v = [m.idx[t], m.idx[t + 1], m.idx[t + 2]], s = v.map(d), keep = s.map(x => x >= 0), nk = keep.filter(Boolean).length;
    if (nk === 3) { soup.push(...P(v[0]), ...P(v[1]), ...P(v[2])); continue; }
    if (nk === 0) continue;
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3];
      if (nk === 1 && keep[k]) { soup.push(...P(a), ...lerp(a, b), ...lerp(a, c)); break; }
      if (nk === 2 && !keep[k]) { const pb = lerp(b, a), pc = lerp(c, a); soup.push(...pb, ...P(b), ...P(c), ...pb, ...P(c), ...pc); break; }
    }
  }
  let r = weldTriangles(new Float32Array(soup), 1e-5);
  if (fill) r = orientMesh(fillHoles(orientMesh(r)).mesh);
  return r;
}
