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
  const diag = new Float64Array(n);
  for (let e = 0; e < M.ne; e++) { const K = Ks[M.em[e]]; for (let a = 0; a < 24; a++) diag[M.en[e * 8 + (a / 3 | 0)] * 3 + (a % 3)] += K[a * 25]; }
  const x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = free[i] ? f[i] : 0;
  const bnorm = Math.sqrt(r.reduce((s, v) => s + v * v, 0)) || 1;
  for (let i = 0; i < n; i++) { z[i] = free[i] && diag[i] ? r[i] / diag[i] : 0; p[i] = z[i]; }
  let rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  const tol = o.tol || 1e-7, maxIt = o.maxIter || 20000;
  let it = 0, res = 1;
  for (; it < maxIt; it++) {
    applyK(M, Ks, p, Ap);
    let pAp = 0; for (let i = 0; i < n; i++) { if (!free[i]) Ap[i] = 0; pAp += p[i] * Ap[i]; }
    if (!(pAp > 0)) break;
    const a = rz / pAp; let rr = 0;
    for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * Ap[i]; rr += r[i] * r[i]; }
    res = Math.sqrt(rr) / bnorm;
    if (res < tol) { it++; break; }
    let rz2 = 0; for (let i = 0; i < n; i++) { z[i] = free[i] && diag[i] ? r[i] / diag[i] : 0; rz2 += r[i] * z[i]; }
    const beta = rz2 / rz; rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    if (o.onProgress && it % 25 === 0) { const stop = await o.onProgress(it, res); if (stop) break; }
  }
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
