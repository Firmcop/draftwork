// ===== Linear static FEA on a voxel grid (pure JS) =====
// Units: mm, N, MPa. Elements are 8-node hexahedra with incompatible (bubble) modes, which bend accurately with few
// elements through a thickness. All elements are identical cubes, so one element matrix per material serves the mesh,
// and the system K u = f is solved matrix-free with Jacobi-preconditioned conjugate gradients.

// ---- voxelisation: column ray parity on a triangle soup ----
// returns { o: [x0,y0,z0], h, nx, ny, nz, solid: Uint8Array(nx*ny*nz) (material index + 1, 0 = empty) }
export function voxelize(bodies, h, pad = 0) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) for (let i = 0; i < b.tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b.tris[i + k]); hi[k] = Math.max(hi[k], b.tris[i + k]); }
  // cells close to h, sized per axis so the bounding box spans whole cells (thin walls keep their thickness)
  const n = [0, 1, 2].map(k => Math.max(1, Math.round((hi[k] - lo[k]) / h))), hs = [0, 1, 2].map(k => (hi[k] - lo[k]) / n[k] || h);
  const nx = n[0] + 2 * pad, ny = n[1] + 2 * pad, nz = n[2] + 2 * pad, o = [lo[0] - pad * hs[0], lo[1] - pad * hs[1], lo[2] - pad * hs[2]];
  const solid = new Uint8Array(nx * ny * nz);
  const [Hx, Hy, Hz] = hs, ex = Hx * 1e-7 * Math.PI, ey = Hy * 1e-7 * Math.E;   // tiny offsets: columns never pass exactly through an edge
  bodies.forEach((b, bi) => {
    const hits = Array.from({ length: nx * ny }, () => []), T = b.tris;
    for (let t = 0; t + 8 < T.length; t += 9) {
      const ax = T[t], ay = T[t + 1], az = T[t + 2], bx = T[t + 3], by = T[t + 4], bz = T[t + 5], cx = T[t + 6], cy = T[t + 7], cz = T[t + 8];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-14) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - o[0]) / Hx - 0.5)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - o[0]) / Hx - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - o[1]) / Hy - 0.5)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - o[1]) / Hy - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = o[0] + (i + 0.5) * Hx + ex, py = o[1] + (j + 0.5) * Hy + ey;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        hits[j * nx + i].push(w0 * az + w1 * bz + w2 * cz);
      }
    }
    for (let c = 0; c < nx * ny; c++) {
      const z = hits[c]; if (z.length < 2) continue; z.sort((a, b) => a - b);
      for (let q = 0; q + 1 < z.length; q += 2) {
        const k0 = Math.max(0, Math.ceil((z[q] - o[2]) / Hz - 0.5)), k1 = Math.min(nz - 1, Math.floor((z[q + 1] - o[2]) / Hz - 0.5));
        for (let k = k0; k <= k1; k++) { const id = (k * ny + Math.floor(c / nx)) * nx + (c % nx); if (!solid[id]) solid[id] = bi + 1; }
      }
    }
  });
  return { o, hs, h: Math.cbrt(hs[0] * hs[1] * hs[2]), nx, ny, nz, solid };
}
// ---- element matrices (E = 1, cell size 1) ----
const GP = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const NODES = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
function Dmat(nu) {
  const l = nu / ((1 + nu) * (1 - 2 * nu)), m = 1 / (2 * (1 + nu)), D = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) D[i][j] = l; D[i][i] = l + 2 * m; D[i + 3][i + 3] = m; }
  return D;
}
// strain-displacement rows for gradient g of a scalar shape function (component columns c0..c2)
function bCols(B, col, g) {
  B[0][col] = g[0]; B[1][col + 1] = g[1]; B[2][col + 2] = g[2];
  B[3][col] = g[1]; B[3][col + 1] = g[0]; B[4][col + 1] = g[2]; B[4][col + 2] = g[1]; B[5][col] = g[2]; B[5][col + 2] = g[0];
}
function solveSmall(A, Bm) {   // A x = Bm (Bm has several columns); Gauss-Jordan, returns X
  const n = A.length, m = Bm[0].length, M = A.map((r, i) => [...r, ...Bm[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let k = c; k < n + m; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map(r => r.slice(n));
}
const keCache = new Map(), alphaCache = new Map();
export function hexStiffness(nu, hs = [1, 1, 1]) {
  const ck = nu + ':' + hs.join(','); if (keCache.has(ck)) return keCache.get(ck);
  const D = Dmat(nu), K = Array.from({ length: 33 }, () => new Array(33).fill(0)), detJ = hs[0] * hs[1] * hs[2] / 8;
  for (const a of GP) for (const b of GP) for (const c of GP) {
    const xi = [a, b, c], B = Array.from({ length: 6 }, () => new Array(33).fill(0));
    NODES.forEach((N, i) => { const g = [0, 1, 2].map(d => (2 / hs[d]) * (N[d] / 8) * (1 + N[(d + 1) % 3] * xi[(d + 1) % 3]) * (1 + N[(d + 2) % 3] * xi[(d + 2) % 3])); bCols(B, 3 * i, g); });
    for (let m = 0; m < 3; m++) { const g = [0, 0, 0]; g[m] = -4 * xi[m] / hs[m]; for (let comp = 0; comp < 3; comp++) { const gg = [0, 0, 0]; gg[m] = g[m]; const col = 24 + 3 * m + comp;   // component comp of bubble m
      if (comp === 0) { B[0][col] = gg[0]; B[3][col] = gg[1]; B[5][col] = gg[2]; } else if (comp === 1) { B[1][col] = gg[1]; B[3][col] = gg[0]; B[4][col] = gg[2]; } else { B[2][col] = gg[2]; B[4][col] = gg[1]; B[5][col] = gg[0]; } } }
    for (let i = 0; i < 33; i++) for (let j = i; j < 33; j++) { let s = 0; for (let p = 0; p < 6; p++) { if (!B[p][i]) continue; let t = 0; for (let q = 0; q < 6; q++) t += D[p][q] * B[q][j]; s += B[p][i] * t; } K[i][j] += s * detJ; }
  }
  for (let i = 0; i < 33; i++) for (let j = 0; j < i; j++) K[i][j] = K[j][i];
  // static condensation of the 9 bubble dofs
  const Kuu = K.slice(0, 24).map(r => r.slice(0, 24)), Kua = K.slice(0, 24).map(r => r.slice(24)), Kaa = K.slice(24).map(r => r.slice(24)), Kau = K.slice(24).map(r => r.slice(0, 24));
  const X = solveSmall(Kaa, Kau), Ke = new Float64Array(576);
  alphaCache.set(ck, X);   // bubble amplitudes: alpha = -X u
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { let s = Kuu[i][j]; for (let k = 0; k < 9; k++) s -= Kua[i][k] * X[k][j]; Ke[i * 24 + j] = s; }
  keCache.set(ck, Ke);
  return Ke;
}
// strain at each element corner from u (24) and the recovered bubble amplitudes (9): 8 matrices of 6 x 33
export function cornerStrainB(hs) {
  return NODES.map(xi => {
    const B = Array.from({ length: 6 }, () => new Array(33).fill(0));
    NODES.forEach((N, i) => { const g = [0, 1, 2].map(d => (2 / hs[d]) * (N[d] / 8) * (1 + N[(d + 1) % 3] * xi[(d + 1) % 3]) * (1 + N[(d + 2) % 3] * xi[(d + 2) % 3])); bCols(B, 3 * i, g); });
    for (let m = 0; m < 3; m++) { const gm = -4 * xi[m] / hs[m]; for (let comp = 0; comp < 3; comp++) { const col = 24 + 3 * m + comp, gg = [0, 0, 0]; gg[m] = gm; if (comp === 0) { B[0][col] = gg[0]; B[3][col] = gg[1]; B[5][col] = gg[2]; } else if (comp === 1) { B[1][col] = gg[1]; B[3][col] = gg[0]; B[4][col] = gg[2]; } else { B[2][col] = gg[2]; B[4][col] = gg[1]; B[5][col] = gg[0]; } } }
    return B;
  });
}
const vonMises = sg => Math.sqrt(0.5 * ((sg[0] - sg[1]) ** 2 + (sg[1] - sg[2]) ** 2 + (sg[2] - sg[0]) ** 2) + 3 * (sg[3] ** 2 + sg[4] ** 2 + sg[5] ** 2));
// strain at the element centre from its 24 nodal displacements (cell size 1): bubbles have zero gradient there
export function centreStrainB(hs = [1, 1, 1]) {
  const B = Array.from({ length: 6 }, () => new Array(24).fill(0));
  NODES.forEach((N, i) => bCols(B, 3 * i, [N[0] / (4 * hs[0]), N[1] / (4 * hs[1]), N[2] / (4 * hs[2])]));
  return B;
}
// ---- model ----
// grid from voxelize; mats[k] = { E, nu, yield, density } for material index k (solid value k+1)
export function buildModel(grid, mats) {
  const { nx, ny, nz } = grid, NX = nx + 1, NY = ny + 1, NZ = nz + 1, nn = NX * NY * NZ;
  const nodeActive = new Uint8Array(nn), elems = [];
  const nid = (i, j, k) => (k * NY + j) * NX + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const m = grid.solid[(k * ny + j) * nx + i]; if (!m) continue;
    const ns = NODES.map(N => nid(i + (N[0] + 1) / 2, j + (N[1] + 1) / 2, k + (N[2] + 1) / 2));
    for (const q of ns) nodeActive[q] = 1;
    elems.push({ i, j, k, m: m - 1, n: ns });
  }
  const en = new Int32Array(elems.length * 8), em = new Uint8Array(elems.length);
  elems.forEach((e, q) => { en.set(e.n, q * 8); em[q] = e.m; });
  return { grid, mats, NX, NY, NZ, nn, nodeActive, en, em, ne: elems.length, nid };
}
// surface nodes: active nodes touching an empty (or outside) cell
export function surfaceNodes(M) {
  const { grid, NX, NY, NZ, nodeActive } = M, { nx, ny, nz, solid } = grid, out = new Uint8Array(M.nn);
  const cell = (i, j, k) => i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : solid[(k * ny + j) * nx + i];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const q = (k * NY + j) * NX + i; if (!nodeActive[q]) continue;
    for (let dk = -1; dk <= 0 && !out[q]; dk++) for (let dj = -1; dj <= 0 && !out[q]; dj++) for (let di = -1; di <= 0; di++) if (!cell(i + di, j + dj, k + dk)) { out[q] = 1; break; }
  }
  return out;
}
export function nodePos(M, q) { const { NX, NY } = M, i = q % NX, j = Math.floor(q / NX) % NY, k = Math.floor(q / (NX * NY)), g = M.grid; return [g.o[0] + i * g.hs[0], g.o[1] + j * g.hs[1], g.o[2] + k * g.hs[2]]; }
// matrix-free K x
function applyK(M, Ks, x, y) {
  y.fill(0);
  const xe = new Float64Array(24);
  for (let e = 0; e < M.ne; e++) {
    const base = e * 8, K = Ks[M.em[e]];
    for (let a = 0; a < 8; a++) { const q = M.en[base + a] * 3; xe[3 * a] = x[q]; xe[3 * a + 1] = x[q + 1]; xe[3 * a + 2] = x[q + 2]; }
    for (let r = 0; r < 24; r++) { let s = 0; const row = r * 24; for (let c = 0; c < 24; c++) s += K[row + c] * xe[c]; y[M.en[base + (r / 3 | 0)] * 3 + (r % 3)] += s; }
  }
}
// fixed: Uint8Array(nn*3) of constrained dofs; f: Float64Array(nn*3) nodal forces
export async function solveStatic(M, fixed, f, o = {}) {
  const n = M.nn * 3, hs = M.grid.hs;
  const Ks = M.mats.map(m => { const K = hexStiffness(m.nu, hs), s = m.E, out = new Float64Array(576); for (let i = 0; i < 576; i++) out[i] = K[i] * s; return out; });
  const free = new Uint8Array(n); for (let q = 0; q < M.nn; q++) if (M.nodeActive[q]) for (let d = 0; d < 3; d++) free[3 * q + d] = fixed[3 * q + d] ? 0 : 1;
  const x = new Float64Array(n), b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = free[i] ? f[i] : 0;
  const tol = o.tol || 1e-7, maxIt = o.maxIter || 20000;
  let prec;
  if (o.multigrid === false) { prec = new Float64Array(n); for (let e = 0; e < M.ne; e++) { const K = Ks[M.em[e]]; for (let a = 0; a < 24; a++) prec[M.en[e * 8 + (a / 3 | 0)] * 3 + (a % 3)] += K[a * 25]; } }
  else prec = buildMG(M, Ks, free);
  const cg = await pcg(n, (v, y) => applyK(M, Ks, v, y), prec, free, b, x, { tol, maxIter: maxIt, every: o.multigrid === false ? 25 : 1, onProgress: o.onProgress });
  const it = cg.it, res = cg.res;
  // stresses at element centres
  const Bc = centreStrainB(hs), vm = new Float64Array(M.ne), sig = new Float64Array(M.ne * 6);
  const Ds = M.mats.map(m => Dmat(m.nu).map(row => row.map(v => v * m.E)));
  for (let e = 0; e < M.ne; e++) {
    const eps = new Array(6).fill(0);
    for (let a = 0; a < 8; a++) { const q = M.en[e * 8 + a] * 3; for (let d = 0; d < 3; d++) { const u = x[q + d]; if (!u) continue; for (let s = 0; s < 6; s++) eps[s] += Bc[s][3 * a + d] * u; } }
    const D = Ds[M.em[e]], sg = D.map(row => row.reduce((s, v, k) => s + v * eps[k], 0));
    sig.set(sg, e * 6);
    vm[e] = Math.sqrt(0.5 * ((sg[0] - sg[1]) ** 2 + (sg[1] - sg[2]) ** 2 + (sg[2] - sg[0]) ** 2) + 3 * (sg[3] ** 2 + sg[4] ** 2 + sg[5] ** 2));
  }
  // nodal stresses: corner values (with bubble modes, so bending stress is linear through each element) averaged at nodes
  const CB = cornerStrainB(hs), sN = new Float64Array(M.nn * 6), cN = new Float64Array(M.nn), ue = new Float64Array(33);
  for (let e = 0; e < M.ne; e++) {
    const mt = M.mats[M.em[e]], X = alphaCache.get(mt.nu + ':' + hs.join(',')), D = Ds[M.em[e]];
    for (let a = 0; a < 8; a++) { const q = M.en[e * 8 + a] * 3; ue[3 * a] = x[q]; ue[3 * a + 1] = x[q + 1]; ue[3 * a + 2] = x[q + 2]; }
    for (let k = 0; k < 9; k++) { let s = 0; for (let c = 0; c < 24; c++) s -= X[k][c] * ue[c]; ue[24 + k] = s; }
    for (let a = 0; a < 8; a++) {
      const B = CB[a], eps = [0, 0, 0, 0, 0, 0];
      for (let s = 0; s < 6; s++) { let v = 0; const row = B[s]; for (let c = 0; c < 33; c++) if (row[c]) v += row[c] * ue[c]; eps[s] = v; }
      const q = M.en[e * 8 + a]; cN[q]++;
      for (let s = 0; s < 6; s++) { let v = 0; for (let k = 0; k < 6; k++) v += D[s][k] * eps[k]; sN[q * 6 + s] += v; }
    }
  }
  const vmNode = new Float64Array(M.nn);
  for (let q = 0; q < M.nn; q++) if (cN[q]) { const sg = []; for (let s = 0; s < 6; s++) { sN[q * 6 + s] /= cN[q]; sg.push(sN[q * 6 + s]); } vmNode[q] = vonMises(sg); }
  // reactions at the supports: K u at fixed dofs
  const Ku = new Float64Array(n); applyK(M, Ks, x, Ku);
  const reaction = [0, 0, 0]; for (let q = 0; q < M.nn; q++) for (let d = 0; d < 3; d++) if (fixed[3 * q + d] && M.nodeActive[q]) reaction[d] += Ku[3 * q + d] - f[3 * q + d];
  return { u: x, vm, sig, vmNode, sigNode: sN, iterations: it, residual: res, converged: res < tol * 10, reaction };
}
// nodal average of an element field
export function nodalAverage(M, field) {
  const s = new Float64Array(M.nn), c = new Float64Array(M.nn);
  for (let e = 0; e < M.ne; e++) for (let a = 0; a < 8; a++) { const q = M.en[e * 8 + a]; s[q] += field[e]; c[q]++; }
  for (let q = 0; q < M.nn; q++) if (c[q]) s[q] /= c[q];
  return s;
}
// trilinear sample of a nodal field (stride 1 or 3) at point p, using the nearest active cell
export function sampleNodal(M, field, p, stride = 1, comp = 0) {
  const g = M.grid, fi = (p[0] - g.o[0]) / g.hs[0], fj = (p[1] - g.o[1]) / g.hs[1], fk = (p[2] - g.o[2]) / g.hs[2];
  let ci = Math.floor(fi), cj = Math.floor(fj), ck = Math.floor(fk);
  const act = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < g.nx && j < g.ny && k < g.nz && g.solid[(k * g.ny + j) * g.nx + i];
  if (!act(ci, cj, ck)) {
    let best = null, bd = Infinity;
    for (let dk = -2; dk <= 2; dk++) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const i = ci + di, j = cj + dj, k = ck + dk; if (!act(i, j, k)) continue; const d = (i + 0.5 - fi) ** 2 + (j + 0.5 - fj) ** 2 + (k + 0.5 - fk) ** 2; if (d < bd) { bd = d; best = [i, j, k]; } }
    if (!best) return 0; [ci, cj, ck] = best;
  }
  const u = Math.min(1, Math.max(0, fi - ci)), v = Math.min(1, Math.max(0, fj - cj)), w = Math.min(1, Math.max(0, fk - ck));
  let s = 0;
  for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1, q = M.nid(ci + di, cj + dj, ck + dk); s += field[q * stride + comp] * (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w); }
  return s;
}

// ---- shared: Jacobi-preconditioned CG on free dofs of an SPD operator ----
async function pcg(n, apply, diag, free, b, x, o = {}) {
  const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  const prec = typeof diag === 'function' ? diag : (r, z) => { for (let i = 0; i < n; i++) z[i] = free[i] && diag[i] ? r[i] / diag[i] : 0; };
  apply(x, Ap);
  for (let i = 0; i < n; i++) r[i] = free[i] ? b[i] - Ap[i] : 0;
  let bn = 0; for (let i = 0; i < n; i++) if (free[i]) bn += b[i] * b[i]; bn = Math.sqrt(bn) || 1;
  prec(r, z); let rz = 0; for (let i = 0; i < n; i++) { if (!free[i]) z[i] = 0; p[i] = z[i]; rz += r[i] * z[i]; }
  const tol = o.tol || 1e-8, maxIt = o.maxIter || 20000;
  let it = 0, res = Math.sqrt(r.reduce((s, v) => s + v * v, 0)) / bn;
  for (; it < maxIt && res >= tol; it++) {
    apply(p, Ap);
    let pAp = 0; for (let i = 0; i < n; i++) { if (!free[i]) Ap[i] = 0; pAp += p[i] * Ap[i]; }
    if (!(pAp > 0)) break;
    const a = rz / pAp; let rr = 0;
    for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * Ap[i]; rr += r[i] * r[i]; }
    res = Math.sqrt(rr) / bn;
    prec(r, z); let rz2 = 0; for (let i = 0; i < n; i++) { if (!free[i]) z[i] = 0; rz2 += r[i] * z[i]; }
    const beta = rz2 / rz; rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    if (o.onProgress && it % (o.every || 25) === 0) { const stop = await o.onProgress(it, res); if (stop) return { it, res, stopped: true }; }
  }
  return { it, res };
}
// symmetric eigen-decomposition (cyclic Jacobi) of a small dense matrix; returns { val, vec } with vec[k] the k-th eigenvector
export function jacobiEigen(A0) {
  const n = A0.length, A = A0.map(r => [...r]), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-30 * (1 + A.reduce((s, r, i) => s + r[i] ** 2, 0))) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const idx = [...Array(n).keys()].sort((a, b) => A[a][a] - A[b][b]);
  return { val: idx.map(i => A[i][i]), vec: idx.map(i => V.map(r => r[i])) };
}
// lumped (diagonal) mass per dof in tonnes (N·s²/mm), density in g/cm³
export function lumpedMass(M) {
  const g = M.grid, V = g.hs[0] * g.hs[1] * g.hs[2], m = new Float64Array(M.nn * 3);
  for (let e = 0; e < M.ne; e++) { const w = (M.mats[M.em[e]].density || 7.85) * 1e-9 * V / 8; for (let a = 0; a < 8; a++) { const q = M.en[e * 8 + a] * 3; m[q] += w; m[q + 1] += w; m[q + 2] += w; } }
  return m;
}
// ---- natural frequencies: K φ = ω² M φ by LOBPCG (Jacobi preconditioner, no inner solves) ----
// returns { freqs (Hz), modes: [Float64Array(nn*3) scaled to unit max displacement], participation: [[x,y,z] mass fractions], mass (kg), iterations }
export async function solveModal(M, fixed, o = {}) {
  const n = M.nn * 3, hs = M.grid.hs, nm = Math.max(1, o.modes || 6);
  const Ks = M.mats.map(m => { const K = hexStiffness(m.nu, hs), out = new Float64Array(576); for (let i = 0; i < 576; i++) out[i] = K[i] * m.E; return out; });
  const mass = lumpedMass(M), free = new Uint8Array(n);
  for (let q = 0; q < M.nn; q++) if (M.nodeActive[q]) for (let d = 0; d < 3; d++) free[3 * q + d] = fixed[3 * q + d] ? 0 : 1;
  let nf = 0; for (let i = 0; i < n; i++) nf += free[i];
  const m = Math.min(nm + Math.max(2, Math.ceil(nm / 3)), nf);
  const diagK = new Float64Array(n);
  for (let e = 0; e < M.ne; e++) { const K = Ks[M.em[e]]; for (let a = 0; a < 24; a++) diagK[M.en[e * 8 + (a / 3 | 0)] * 3 + (a % 3)] += K[a * 25]; }
  const applyKf = (x, y) => { applyK(M, Ks, x, y); for (let i = 0; i < n; i++) if (!free[i]) y[i] = 0; };
  const held = fixed.some(Boolean);
  let ratio = 0, cnt = 0; for (let i = 0; i < n; i++) if (free[i] && mass[i]) { ratio += diagK[i] / mass[i]; cnt++; }
  ratio /= cnt || 1;
  const mg = o.multigrid === false ? null : buildMG(M, Ks, free, { sigma: held ? 0 : ratio * 1e-6, mass });
  const precond = (r, z) => { if (mg) mg(r, z); else for (let i = 0; i < n; i++) z[i] = free[i] ? r[i] / diagK[i] : 0; for (let i = 0; i < n; i++) if (!free[i]) z[i] = 0; };
  const dotM = (a, b) => { let s = 0; for (let i = 0; i < n; i++) if (free[i]) s += a[i] * mass[i] * b[i]; return s; };
  const comb = (V, C, cols) => cols.map(j => { const v = new Float64Array(n); for (let k = 0; k < V.length; k++) { const c = C[k][j]; if (c) { const w = V[k]; for (let i = 0; i < n; i++) v[i] += c * w[i]; } } return v; });
  // M-orthonormal basis of Y (and the same combination of KY) by SVQB; drops dependent directions
  const svqb = (Y, KY) => {
    const k = Y.length; if (!k) return [[], []];
    const G = Array.from({ length: k }, () => new Array(k));
    for (let a = 0; a < k; a++) for (let b = a; b < k; b++) G[a][b] = G[b][a] = dotM(Y[a], Y[b]);
    const D = G.map((r, i) => 1 / Math.sqrt(r[i] || 1e-300)), Gs = G.map((r, i) => r.map((v, j) => v * D[i] * D[j]));
    const E = jacobiEigen(Gs), top = Math.max(...E.val), keep = E.val.map((v, i) => i).filter(i => E.val[i] > 1e-11 * top);
    const C = Array.from({ length: k }, (_, r) => keep.map(i => D[r] * E.vec[i][r] / Math.sqrt(E.val[i])));
    const cols = keep.map((_, j) => j);
    return [comb(Y, C, cols), comb(KY, C, cols)];
  };
  const projectOut = (X, Y, KX, KY) => { for (let j = 0; j < Y.length; j++) for (let k = 0; k < X.length; k++) { const c = dotM(X[k], Y[j]); if (!c) continue; for (let i = 0; i < n; i++) { Y[j][i] -= c * X[k][i]; KY[j][i] -= c * KX[k][i]; } } };
  // start vectors: mass-weighted translations plus pseudo-random fields
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
  let X = [];
  for (let j = 0; j < m; j++) { const v = new Float64Array(n); for (let i = 0; i < n; i++) if (free[i]) v[i] = j < 3 ? (i % 3 === j ? 1 : 0) + 0.2 * rnd() : rnd(); X.push(v); }
  let KX = X.map(x => { const y = new Float64Array(n); applyKf(x, y); return y; });
  [X, KX] = svqb(X, KX);
  // Rayleigh-Ritz on a basis Q (M-orthonormal) with KQ
  const rr = (Q, KQ) => { const k = Q.length, A = Array.from({ length: k }, () => new Array(k)); for (let a = 0; a < k; a++) for (let b = a; b < k; b++) { let s = 0, t = 0; const qa = Q[a], qb = Q[b], ka = KQ[a], kb = KQ[b]; for (let i = 0; i < n; i++) { s += qa[i] * kb[i]; t += qb[i] * ka[i]; } A[a][b] = A[b][a] = (s + t) / 2; } return jacobiEigen(A); };
  let E = rr(X, KX), lam = E.val.slice(0, m);
  { const C = X.map((_, r) => E.vec.map(v => v[r])); const cols = [...Array(Math.min(m, X.length)).keys()]; X = comb(X, C, cols); KX = comb(KX, C, cols); }
  let P = [], KP = [], iter = 0, applies = m;
  const tol = o.tol || 1e-5, maxIter = o.maxIter || 3000;
  for (; iter < maxIter; iter++) {
    const lref = Math.max(lam[Math.min(nm, lam.length) - 1], 1e-30);
    const R = X.map((x, j) => { const r = new Float64Array(n); for (let i = 0; i < n; i++) if (free[i]) r[i] = KX[j][i] - lam[j] * mass[i] * x[i]; return r; });
    const rn = R.map((r, j) => { let s = 0, t = 0; for (let i = 0; i < n; i++) if (free[i]) { s += r[i] * r[i] / mass[i]; t += mass[i] * X[j][i] ** 2; } return Math.sqrt(s / (t || 1)) / lref; });
    const active = rn.map((v, j) => j).filter(j => rn[j] > tol);
    if (active.filter(j => j < nm).length === 0) break;
    if (o.onProgress && iter % 10 === 0) { const stop = await o.onProgress({ iter, res: Math.max(...rn.slice(0, nm)), converged: nm - active.filter(j => j < nm).length, of: nm }); if (stop) return null; }
    // preconditioned residuals of the unconverged vectors
    let W = active.map(j => { const w = new Float64Array(n); precond(R[j], w); return w; });
    let KW = W.map(w => { const y = new Float64Array(n); applyKf(w, y); return y; }); applies += W.length;
    let Y = [...W, ...P], KY = [...KW, ...KP];
    projectOut(X, Y, KX, KY); [Y, KY] = svqb(Y, KY); projectOut(X, Y, KX, KY); [Y, KY] = svqb(Y, KY);
    const Q = [...X, ...Y], KQ = [...KX, ...KY];
    E = rr(Q, KQ);
    const k = Math.min(m, Q.length), C = Q.map((_, r) => E.vec.map(v => v[r])), cols = [...Array(k).keys()];
    const Xn = comb(Q, C, cols), KXn = comb(KQ, C, cols);
    // new search directions: the parts of the update outside the old X
    const Cy = C.slice(X.length);
    P = comb(Y, Cy, cols); KP = comb(KY, Cy, cols);
    X = Xn; KX = KXn; lam = E.val.slice(0, k);
  }
  const freqs = [], modes = [], participation = [];
  let total = 0; for (let q = 0; q < M.nn; q++) total += mass[3 * q];
  for (let k = 0; k < nm && k < X.length; k++) {
    freqs.push(Math.sqrt(Math.max(0, lam[k])) / (2 * Math.PI));
    const v = X[k], mn = Math.sqrt(dotM(v, v)) || 1;
    const part = [0, 1, 2].map(d => { let g = 0; for (let q = 0; q < M.nn; q++) g += mass[3 * q + d] * v[3 * q + d] / mn; return g * g / (total || 1); });
    participation.push(part);
    let mx = 0, sg = 1; for (let q = 0; q < M.nn; q++) { const a = Math.hypot(v[3 * q], v[3 * q + 1], v[3 * q + 2]); if (a > mx) { mx = a; sg = Math.sign(v[3 * q] + v[3 * q + 1] + v[3 * q + 2]) || 1; } }
    const s = mx ? sg / mx : 1, out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = v[i] * s; modes.push(out);
  }
  return { freqs, modes, participation, mass: total * 1000, iterations: iter, applies, converged: iter < maxIter };
}
// ---- steady-state heat conduction (scalar, 8-node hexes) ----
// conductivity matrix for k = 1 and cell sizes hs (64 entries)
const kcCache = new Map();
export function hexConduction(hs) {
  const ck = hs.join(','); if (kcCache.has(ck)) return kcCache.get(ck);
  const K = new Float64Array(64), detJ = hs[0] * hs[1] * hs[2] / 8;
  for (const a of GP) for (const b of GP) for (const c of GP) {
    const xi = [a, b, c], G = NODES.map(N => [0, 1, 2].map(d => (2 / hs[d]) * (N[d] / 8) * (1 + N[(d + 1) % 3] * xi[(d + 1) % 3]) * (1 + N[(d + 2) % 3] * xi[(d + 2) % 3])));
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) K[i * 8 + j] += (G[i][0] * G[j][0] + G[i][1] * G[j][1] + G[i][2] * G[j][2]) * detJ;
  }
  kcCache.set(ck, K); return K;
}
// o = { T: Float64Array(nn) prescribed temperature or NaN, q: Float64Array(nn) nodal heat input (W), hA: Float64Array(nn) convection
//       conductance h·A per node (W/K), hT: Float64Array(nn) h·A·T∞ (W) }. Material conductivity mats[k].k in W/(m·K).
// returns { T, flux: Float64Array(ne*3) heat flux W/mm² at element centres, fluxMag, iterations, residual, converged, heatIn, heatOut }
export async function solveThermal(M, o) {
  const nn = M.nn, hs = M.grid.hs, Kc = hexConduction(hs), kk = M.mats.map(m => (m.k ?? 50) * 1e-3);
  const hA = o.hA || new Float64Array(nn), hT = o.hT || new Float64Array(nn), Q = o.q || new Float64Array(nn), Tp = o.T;
  const fixed = new Uint8Array(nn), free = new Uint8Array(nn), x = new Float64Array(nn);
  for (let q = 0; q < nn; q++) { if (!M.nodeActive[q]) continue; if (Tp && Number.isFinite(Tp[q])) { fixed[q] = 1; x[q] = Tp[q]; } else free[q] = 1; }
  if (!fixed.some(Boolean) && !hA.some(v => v > 0)) throw new Error('Add a temperature or a convection boundary: otherwise the temperature level is undefined');
  const apply = (v, y) => {
    y.fill(0); const ve = new Float64Array(8);
    for (let e = 0; e < M.ne; e++) { const s = kk[M.em[e]], b = e * 8; for (let a = 0; a < 8; a++) ve[a] = v[M.en[b + a]]; for (let r = 0; r < 8; r++) { let t = 0; for (let c = 0; c < 8; c++) t += Kc[r * 8 + c] * ve[c]; y[M.en[b + r]] += s * t; } }
    for (let q = 0; q < nn; q++) if (hA[q]) y[q] += hA[q] * v[q];
  };
  const diag = new Float64Array(nn);
  for (let e = 0; e < M.ne; e++) { const s = kk[M.em[e]]; for (let a = 0; a < 8; a++) diag[M.en[e * 8 + a]] += s * Kc[a * 9]; }
  for (let q = 0; q < nn; q++) diag[q] += hA[q];
  const b = new Float64Array(nn); for (let q = 0; q < nn; q++) b[q] = Q[q] + hT[q];
  const r = await pcg(nn, apply, diag, free, b, x, { tol: o.tol || 1e-9, maxIter: o.maxIter || 40000, onProgress: o.onProgress });
  // heat flux -k ∇T at element centres
  const flux = new Float64Array(M.ne * 3), fluxMag = new Float64Array(M.ne);
  for (let e = 0; e < M.ne; e++) {
    const s = kk[M.em[e]], g = [0, 0, 0];
    for (let a = 0; a < 8; a++) { const t = x[M.en[e * 8 + a]], N = NODES[a]; for (let d = 0; d < 3; d++) g[d] += N[d] / (4 * hs[d]) * t; }
    for (let d = 0; d < 3; d++) flux[e * 3 + d] = -s * g[d];
    fluxMag[e] = Math.hypot(flux[e * 3], flux[e * 3 + 1], flux[e * 3 + 2]);
  }
  // energy balance: heat entering through prescribed temperatures (negative: leaving) and leaving by convection
  const KT = new Float64Array(nn); apply(x, KT);
  let atFixed = 0, conv = 0, input = 0; for (let q = 0; q < nn; q++) { if (fixed[q]) atFixed += KT[q] - b[q]; conv += hA[q] * x[q] - hT[q]; input += Q[q]; }
  return { T: x, flux, fluxMag, iterations: r.it, residual: r.res, converged: r.res < 1e-6, stopped: !!r.stopped, heatIn: input, heatFixed: atFixed, heatConv: conv };
}

// ---- geometric multigrid preconditioner for elasticity on the voxel grid ----
// Coarse cells merge 2 x 2 x 2 cells; coarse operators are Galerkin products Pᵀ A P with trilinear P, formed cell by cell
// (a fine cell's 8 nodes interpolate from its coarse cell's 8 nodes only). Chebyshev-Jacobi smoothing, dense Cholesky at the bottom.
// Returns prec(r, z): z ≈ (K + σM)⁻¹ r on the free dofs.
const CHILD_W = (() => {   // for child offset c (0..7): per fine local node a, list of [coarse local node b, weight]
  const out = [];
  for (let c = 0; c < 8; c++) {
    const off = [c & 1, (c >> 1) & 1, (c >> 2) & 1], rows = [];
    for (let a = 0; a < 8; a++) {
      const f = [0, 1, 2].map(d => off[d] + (NODES[a][d] + 1) / 2), list = [];
      for (let b = 0; b < 8; b++) { let w = 1; for (let d = 0; d < 3; d++) { const cb = (NODES[b][d] + 1) / 2; w *= f[d] === 1 ? 0.5 : (f[d] === 0 ? +(cb === 0) : +(cb === 1)); } if (w) list.push([b, w]); }
      rows.push(list);
    }
    out.push(rows);
  }
  return out;
})();
export function buildMG(M, Ks, free, o = {}) {
  const sigma = o.sigma || 0, mass = o.mass || null, maxCoarse = o.maxCoarse || 900, deg = o.degree || 3;
  const g = M.grid, cellAt = new Int32Array(g.nx * g.ny * g.nz).fill(-1);
  for (let e = 0; e < M.ne; e++) { const q = M.en[e * 8], i = q % M.NX, j = Math.floor(q / M.NX) % M.NY, k = Math.floor(q / (M.NX * M.NY)); cellAt[(k * g.ny + j) * g.nx + i] = e; }
  const V = g.hs[0] * g.hs[1] * g.hs[2];
  const L0 = { nx: g.nx, ny: g.ny, nz: g.nz, NX: M.NX, NY: M.NY, NZ: M.NZ, n: M.nn * 3, ne: M.ne, en: M.en, cellAt, free };
  L0.elemMat = e => Ks[M.em[e]];
  L0.elemShift = e => sigma ? sigma * (M.mats[M.em[e]].density || 7.85) * 1e-9 * V / 8 : 0;
  L0.apply = (x, y) => { applyK(M, Ks, x, y); for (let i = 0; i < L0.n; i++) y[i] = free[i] ? y[i] + (sigma && mass ? sigma * mass[i] * x[i] : 0) : 0; };
  const levels = [L0];
  const levelDiag = L => { const d = new Float64Array(L.n); for (let e = 0; e < L.ne; e++) { const A = L.elemMat(e), s = L.elemShift(e); for (let a = 0; a < 24; a++) d[L.en[e * 8 + (a / 3 | 0)] * 3 + (a % 3)] += A[a * 25] + s; } return d; };
  L0.diag = levelDiag(L0); for (let i = 0; i < L0.n; i++) if (!free[i]) L0.diag[i] = 0;
  const activeCount = L => { let c = 0; for (let i = 0; i < L.n; i++) if (L.free[i]) c++; return c; };
  while (activeCount(levels.at(-1)) > maxCoarse) {
    const F = levels.at(-1); if (F.nx <= 1 && F.ny <= 1 && F.nz <= 1) break;
    const nx = Math.ceil(F.nx / 2), ny = Math.ceil(F.ny / 2), nz = Math.ceil(F.nz / 2), NX = nx + 1, NY = ny + 1, NZ = nz + 1;
    const cellAtC = new Int32Array(nx * ny * nz).fill(-1), en = [], mats = [];
    const T = new Float64Array(576);
    for (let K = 0; K < nz; K++) for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
      const Ac = new Float64Array(576); let any = false;
      for (let c = 0; c < 8; c++) {
        const i = 2 * I + (c & 1), j = 2 * J + ((c >> 1) & 1), k = 2 * K + ((c >> 2) & 1);
        if (i >= F.nx || j >= F.ny || k >= F.nz) continue;
        const fe = F.cellAt[(k * F.ny + j) * F.nx + i]; if (fe < 0) continue;
        any = true;
        const A = F.elemMat(fe), s = F.elemShift(fe), W = CHILD_W[c], fz = F.free, fn = F.en.subarray ? F.en.subarray(fe * 8, fe * 8 + 8) : F.en.slice(fe * 8, fe * 8 + 8);
        // T = A Z P (24 x 24): column 3b+d' gathers rows a' with weights
        T.fill(0);
        for (let a2 = 0; a2 < 8; a2++) for (let d2 = 0; d2 < 3; d2++) {
          if (!fz[fn[a2] * 3 + d2]) continue;
          const col = 3 * a2 + d2;
          for (const [b, w] of W[a2]) { const tc = 3 * b + d2; for (let r = 0; r < 24; r++) { const v = A[r * 24 + col] + (r === col ? s : 0); if (v) T[r * 24 + tc] += v * w; } }
        }
        for (let a1 = 0; a1 < 8; a1++) for (let d1 = 0; d1 < 3; d1++) {
          if (!fz[fn[a1] * 3 + d1]) continue;
          const row = 3 * a1 + d1;
          for (const [b, w] of W[a1]) { const ar = (3 * b + d1) * 24; for (let cc = 0; cc < 24; cc++) { const v = T[row * 24 + cc]; if (v) Ac[ar + cc] += w * v; } }
        }
      }
      if (!any) continue;
      const id = en.length / 8; cellAtC[(K * ny + J) * nx + I] = id;
      for (const N of NODES) en.push(((K + (N[2] + 1) / 2) * NY + (J + (N[1] + 1) / 2)) * NX + (I + (N[0] + 1) / 2));
      mats.push(Ac);
    }
    const C = { nx, ny, nz, NX, NY, NZ, n: NX * NY * NZ * 3, ne: mats.length, en: Int32Array.from(en), cellAt: cellAtC };
    C.elemMat = e => mats[e]; C.elemShift = () => 0;
    C.diag = levelDiag(C); let dmax = 0; for (const v of C.diag) dmax = Math.max(dmax, v);
    C.free = new Uint8Array(C.n); for (let i = 0; i < C.n; i++) C.free[i] = C.diag[i] > 1e-12 * dmax ? 1 : 0;
    C.apply = (x, y) => { y.fill(0); const xe = new Float64Array(24); for (let e = 0; e < C.ne; e++) { const A = mats[e], b = e * 8; for (let a = 0; a < 8; a++) { const q = C.en[b + a] * 3; xe[3 * a] = x[q]; xe[3 * a + 1] = x[q + 1]; xe[3 * a + 2] = x[q + 2]; } for (let r = 0; r < 24; r++) { let s = 0; const ro = r * 24; for (let c = 0; c < 24; c++) s += A[ro + c] * xe[c]; y[C.en[b + (r / 3 | 0)] * 3 + (r % 3)] += s; } } for (let i = 0; i < C.n; i++) if (!C.free[i]) y[i] = 0; };
    levels.push(C);
    if (C.ne === F.ne) break;   // no further reduction
  }
  // transfers between level l (fine) and l+1 (coarse)
  const parents = (i, n) => i % 2 === 0 ? [[i / 2, 1]] : [[(i - 1) / 2, 0.5], [(i + 1) / 2, 0.5]];
  const restrict = (F, C, rf, rc) => {
    rc.fill(0);
    for (let k = 0; k < F.NZ; k++) { const pk = parents(k); for (let j = 0; j < F.NY; j++) { const pj = parents(j); for (let i = 0; i < F.NX; i++) {
      const q = ((k * F.NY + j) * F.NX + i) * 3; const v0 = rf[q], v1 = rf[q + 1], v2 = rf[q + 2]; if (!v0 && !v1 && !v2) continue;
      for (const [I, wi] of parents(i)) for (const [J, wj] of pj) for (const [K, wk] of pk) { const Q = ((K * C.NY + J) * C.NX + I) * 3, w = wi * wj * wk; rc[Q] += w * v0; rc[Q + 1] += w * v1; rc[Q + 2] += w * v2; }
    } } }
    for (let i = 0; i < C.n; i++) if (!C.free[i]) rc[i] = 0;
  };
  const prolong = (F, C, ec, ef) => {   // ef += P ec
    for (let k = 0; k < F.NZ; k++) { const pk = parents(k); for (let j = 0; j < F.NY; j++) { const pj = parents(j); for (let i = 0; i < F.NX; i++) {
      const q = ((k * F.NY + j) * F.NX + i) * 3; if (!F.free[q] && !F.free[q + 1] && !F.free[q + 2]) continue;
      let v0 = 0, v1 = 0, v2 = 0;
      for (const [I, wi] of parents(i)) for (const [J, wj] of pj) for (const [K, wk] of pk) { const Q = ((K * C.NY + J) * C.NX + I) * 3, w = wi * wj * wk; v0 += w * ec[Q]; v1 += w * ec[Q + 1]; v2 += w * ec[Q + 2]; }
      if (F.free[q]) ef[q] += v0; if (F.free[q + 1]) ef[q + 1] += v1; if (F.free[q + 2]) ef[q + 2] += v2;
    } } }
  };
  // Chebyshev bounds from a few power iterations on D⁻¹A
  for (const L of levels) {
    let x = new Float64Array(L.n), y = new Float64Array(L.n), s = 77;
    for (let i = 0; i < L.n; i++) x[i] = L.free[i] ? ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) : 0;
    let lam = 1;
    for (let it = 0; it < 12; it++) {
      L.apply(x, y); let nr = 0; for (let i = 0; i < L.n; i++) { y[i] = L.free[i] ? y[i] / L.diag[i] : 0; nr += y[i] * y[i]; }
      nr = Math.sqrt(nr); let nx0 = 0; for (let i = 0; i < L.n; i++) nx0 += x[i] * x[i]; lam = nr / Math.sqrt(nx0 || 1);
      for (let i = 0; i < L.n; i++) x[i] = y[i] / (nr || 1);
    }
    L.lmax = 1.15 * lam; L.lmin = L.lmax / 25;
    L.r = new Float64Array(L.n); L.d = new Float64Array(L.n); L.t = new Float64Array(L.n); L.x = new Float64Array(L.n); L.b = new Float64Array(L.n);
  }
  const cheb = (L, x, b, zero) => {
    const th = (L.lmax + L.lmin) / 2, de = (L.lmax - L.lmin) / 2, r = L.r, d = L.d, t = L.t;
    if (zero) for (let i = 0; i < L.n; i++) r[i] = L.free[i] ? b[i] : 0;
    else { L.apply(x, t); for (let i = 0; i < L.n; i++) r[i] = L.free[i] ? b[i] - t[i] : 0; }
    for (let i = 0; i < L.n; i++) d[i] = L.free[i] ? r[i] / L.diag[i] / th : 0;
    const s1 = th / de; let rho = 1 / s1;
    for (let k = 0; k < deg; k++) {
      for (let i = 0; i < L.n; i++) x[i] += d[i];
      if (k === deg - 1) break;
      L.apply(d, t); for (let i = 0; i < L.n; i++) r[i] -= t[i];
      const rn = 1 / (2 * s1 - rho);
      for (let i = 0; i < L.n; i++) d[i] = L.free[i] ? rn * rho * d[i] + 2 * rn / de * r[i] / L.diag[i] : 0;
      rho = rn;
    }
  };
  // dense Cholesky at the bottom
  const B = levels.at(-1), idx = []; for (let i = 0; i < B.n; i++) if (B.free[i]) idx.push(i);
  const nb = idx.length, pos = new Int32Array(B.n).fill(-1); idx.forEach((v, k) => { pos[v] = k; });
  let chol = null;
  if (nb <= 4000) {
    const A = new Float64Array(nb * nb);
    for (let e = 0; e < B.ne; e++) { const Ae = B.elemMat(e), s = B.elemShift(e); for (let a = 0; a < 24; a++) { const pa = pos[B.en[e * 8 + (a / 3 | 0)] * 3 + (a % 3)]; if (pa < 0) continue; for (let c = 0; c < 24; c++) { const pc = pos[B.en[e * 8 + (c / 3 | 0)] * 3 + (c % 3)]; if (pc < 0) continue; A[pa * nb + pc] += Ae[a * 24 + c] + (a === c ? s : 0); } } }
    let dmax = 0; for (let i = 0; i < nb; i++) dmax = Math.max(dmax, A[i * nb + i]);
    for (let i = 0; i < nb; i++) A[i * nb + i] += 1e-9 * dmax;   // keeps free-free (singular) problems factorable
    for (let j = 0; j < nb; j++) {
      let s = A[j * nb + j]; for (let k = 0; k < j; k++) s -= A[j * nb + k] ** 2;
      const djj = Math.sqrt(Math.max(s, 1e-14 * dmax)); A[j * nb + j] = djj;
      for (let i = j + 1; i < nb; i++) { let t = A[i * nb + j]; for (let k = 0; k < j; k++) t -= A[i * nb + k] * A[j * nb + k]; A[i * nb + j] = t / djj; }
    }
    chol = A;
  }
  const bottom = (b, x) => {
    if (!chol) { x.fill(0); for (let k = 0; k < 30; k++) cheb(B, x, b); return; }
    const y = new Float64Array(nb); for (let k = 0; k < nb; k++) y[k] = b[idx[k]];
    for (let i = 0; i < nb; i++) { let s = y[i]; for (let k = 0; k < i; k++) s -= chol[i * nb + k] * y[k]; y[i] = s / chol[i * nb + i]; }
    for (let i = nb - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < nb; k++) s -= chol[k * nb + i] * y[k]; y[i] = s / chol[i * nb + i]; }
    x.fill(0); for (let k = 0; k < nb; k++) x[idx[k]] = y[k];
  };
  const vcycle = (l, b, x) => {
    const L = levels[l];
    if (l === levels.length - 1) { bottom(b, x); return; }
    x.fill(0); cheb(L, x, b, true);
    const t = L.t; L.apply(x, t); const r = new Float64Array(L.n); for (let i = 0; i < L.n; i++) r[i] = L.free[i] ? b[i] - t[i] : 0;
    const C = levels[l + 1]; restrict(L, C, r, C.b);
    vcycle(l + 1, C.b.slice(), C.x); prolong(L, C, C.x, x);
    cheb(L, x, b);
  };
  const prec = (r, z) => vcycle(0, r, z);
  prec.levels = levels.map(L => ({ ne: L.ne, dofs: L.n, active: activeCount(L) }));
  return prec;
}
