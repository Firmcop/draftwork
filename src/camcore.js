// ===== CAM core (pure JS, no THREE): height maps, tool compensation, contours, toolpaths, simulation, posts =====
// Everything here works in the setup frame: the tool points down -Z, millimetres. A height map is a grid of the highest
// material at each cell centre (‑Infinity = nothing there). Tool-compensated maps give the lowest the tool tip may go.

// ---- grid + rasteriser ----
export function makeGrid(x0, y0, x1, y1, g) {
  const nx = Math.max(2, Math.ceil((x1 - x0) / g) + 1), ny = Math.max(2, Math.ceil((y1 - y0) / g) + 1);
  return { x0, y0, g, nx, ny, H: new Float32Array(nx * ny).fill(-Infinity) };
}
// tris: flat array of xyz triples, 9 numbers per triangle
export function rasterize(G, tris) {
  const { x0, y0, g, nx, ny, H } = G;
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2], bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5], cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;   // vertical walls: their neighbours cover them
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / g - 1e-9)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / g + 1e-9));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / g - 1e-9)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / g + 1e-9));
    const inv = 1 / area, eps = -1e-9;
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * g;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * g;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv, w2 = 1 - w0 - w1;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const z = w0 * az + w1 * bz + w2 * cz, k = j * nx + i;
        if (z > H[k]) H[k] = z;
      }
    }
  }
  return G;
}
// ---- sliding-window maximum (van Herk / Gil-Werman), window [i-w, i+w] ----
function slidingMax(a, n, w, out) {
  if (w <= 0) { out.set(a.subarray ? a.subarray(0, n) : a); return out; }
  const k = 2 * w + 1, m = n + 2 * w, p = new Float32Array(m).fill(-Infinity);
  for (let i = 0; i < n; i++) p[i + w] = a[i];
  const gL = new Float32Array(m), hR = new Float32Array(m);
  for (let i = 0; i < m; i++) gL[i] = i % k === 0 ? p[i] : Math.max(gL[i - 1], p[i]);
  for (let i = m - 1; i >= 0; i--) hR[i] = (i % k === k - 1 || i === m - 1) ? p[i] : Math.max(hR[i + 1], p[i]);
  for (let i = 0; i < n; i++) out[i] = Math.max(hR[i], gL[i + 2 * w]);
  return out;
}
// flat end mill of radius R: highest material anywhere under the tool disc
export function dilateFlat(G, R) {
  const { nx, ny, g, H } = G, rc = Math.floor(R / g + 1e-9), out = new Float32Array(nx * ny).fill(-Infinity);
  const byW = new Map(), row = new Float32Array(nx);
  const rowsFor = w => {
    let A = byW.get(w); if (A) return A;
    A = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) { slidingMax(H.subarray(j * nx, j * nx + nx), nx, w, row); A.set(row, j * nx); }
    byW.set(w, A); return A;
  };
  for (let dy = -rc; dy <= rc; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, R * R - (dy * g) ** 2)) / g + 1e-9), A = rowsFor(w);
    for (let j = Math.max(0, -dy); j < Math.min(ny, ny - dy); j++) {
      const src = (j + dy) * nx, dst = j * nx;
      for (let i = 0; i < nx; i++) if (A[src + i] > out[dst + i]) out[dst + i] = A[src + i];
    }
  }
  return out;
}
// ball end mill of radius R, keeping `leave` off the surface: lowest tip height
export function dilateBall(G, R, leave = 0) {
  const { nx, ny, g, H } = G, Re = R + leave, rc = Math.floor(Re / g + 1e-9), offs = [];
  for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const d2 = (dx * g) ** 2 + (dy * g) ** 2; if (d2 <= Re * Re) offs.push(dx, dy, Math.sqrt(Re * Re - d2) - R); }
  const out = new Float32Array(nx * ny).fill(-Infinity);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const h = H[j * nx + i]; if (h === -Infinity) continue;
    for (let o = 0; o < offs.length; o += 3) {
      const ii = i + offs[o], jj = j + offs[o + 1]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const k = jj * nx + ii, v = h + offs[o + 2]; if (v > out[k]) out[k] = v;
    }
  }
  return out;
}
// ---- Euclidean distance transform (Felzenszwalb): distance (mm) from each allowed cell to the nearest forbidden one ----
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
    if (s <= z[k]) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; k = 0; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
export function distanceField(mask, nx, ny, g) {
  const BIG = 1e20, D = new Float64Array(nx * ny), n = Math.max(nx, ny), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < nx * ny; i++) D[i] = mask[i] ? BIG : 0;
  for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) f[j] = D[j * nx + i]; edt1(f, ny, d, v, z); for (let j = 0; j < ny; j++) D[j * nx + i] = d[j]; }
  for (let j = 0; j < ny; j++) { for (let i = 0; i < nx; i++) f[i] = D[j * nx + i]; edt1(f, nx, d, v, z); for (let i = 0; i < nx; i++) D[j * nx + i] = d[i]; }
  const out = new Float32Array(nx * ny); for (let i = 0; i < nx * ny; i++) out[i] = D[i] >= BIG / 2 ? 1e9 : Math.sqrt(D[i]) * g;
  return out;
}
// ---- marching squares: closed loops where F crosses 0, positive side (allowed) on the left ----
export function contours(F, G, level = 0) {
  const { nx, ny, g, x0, y0 } = G, val = (i, j) => (i <= 0 || j <= 0 || i >= nx - 1 || j >= ny - 1) ? -1 : F[j * nx + i] - level;   // border is outside
  const segs = new Map(), key = (a, b) => a + ',' + b;   // edge id -> segment endpoints
  const ex = (i, j, a, b) => { const t = a / (a - b); return [x0 + (i + t) * g, y0 + j * g]; };   // horizontal edge (i,j)-(i+1,j)
  const ey = (i, j, a, b) => { const t = a / (a - b); return [x0 + i * g, y0 + (j + t) * g]; };
  const list = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
    const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const E = { s: ['h', i, j, () => ex(i, j, a, b)], e: ['v', i + 1, j, () => ey(i + 1, j, b, c)], n: ['h', i, j + 1, () => ex(i, j + 1, d, c)], w: ['v', i, j, () => ey(i, j, a, d)] };
    const add = (p, q) => list.push([E[p], E[q]]);
    switch (code) {
      case 1: case 14: add('w', 's'); break; case 2: case 13: add('s', 'e'); break; case 3: case 12: add('w', 'e'); break;
      case 4: case 11: add('e', 'n'); break; case 6: case 9: add('s', 'n'); break; case 7: case 8: add('w', 'n'); break;
      case 5: case 10: { const ctr = (a + b + c + d) / 4; if ((ctr > 0) === (code === 5)) { add('w', 'n'); add('s', 'e'); } else { add('w', 's'); add('e', 'n'); } break; }
    }
  }
  // chain by shared edge ids
  const id = E => E[0] + E[1] + ',' + E[2];
  const adj = new Map();
  list.forEach((s, k) => { for (const E of s) { const kk = id(E); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(k); } });
  const used = new Uint8Array(list.length), loops = [];
  for (let s0 = 0; s0 < list.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1; const pts = [list[s0][0][3](), list[s0][1][3]()]; let cur = id(list[s0][1]); const start = id(list[s0][0]);
    for (let guard = 0; guard < list.length + 2 && cur !== start; guard++) {
      const nxt = (adj.get(cur) || []).find(k => !used[k]); if (nxt == null) break;
      used[nxt] = 1; const s = list[nxt], far = id(s[0]) === cur ? s[1] : s[0]; pts.push(far[3]()); cur = id(far);
    }
    if (pts.length > 3) { pts.pop(); loops.push(pts); }
  }
  // orient: allowed (positive) side on the left of travel
  const samp = (x, y) => { const fi = (x - x0) / g, fj = (y - y0) / g, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j; return (1 - u) * (1 - v) * val(i, j) + u * (1 - v) * val(i + 1, j) + u * v * val(i + 1, j + 1) + (1 - u) * v * val(i, j + 1); };
  for (const L of loops) {
    let s = 0; for (let k = 0; k < L.length; k++) { const p = L[k], q = L[(k + 1) % L.length]; s += samp((p[0] + q[0]) / 2 - (q[1] - p[1]) * 0.2, (p[1] + q[1]) / 2 + (q[0] - p[0]) * 0.2); }
    if (s < 0) L.reverse();
  }
  return loops;
}
export function loopArea(L) { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function simplify(L, tol, closed = true) {
  if (L.length < 4) return L;
  const keep = new Uint8Array(L.length); keep[0] = keep[L.length - 1] = 1;
  const st = [[0, L.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let best = -1, bd = tol;
    const A = L[a], B = L[b], dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((L[i][0] - A[0]) * dy - (L[i][1] - A[1]) * dx) / l; if (d > bd) { bd = d; best = i; } }
    if (best > 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  const out = L.filter((_, i) => keep[i]);
  return closed && out.length < 3 ? L : out;
}
// ---- toolpath assembly ----
// A move is [type, x, y, z]; type: 0 rapid, 1 cut, 2 plunge/ramp. Drill cycles: { cycle, x, y, top, bottom, peck }.
function pathBuilder(clear, safe) {
  const moves = []; let cur = null;
  const api = {
    moves, get cur() { return cur; },
    rapid(x, y, z) { moves.push([0, x, y, z]); cur = [x, y, z]; },
    cut(x, y, z, t = 1) { moves.push([t, x, y, z]); cur = [x, y, z]; },
    retract() { if (cur && cur[2] < clear) api.rapid(cur[0], cur[1], clear); },
    // go to (x,y) above z, then plunge to z
    enter(x, y, z, above) { if (!cur) api.rapid(x, y, clear); else { api.retract(); api.rapid(x, y, clear); } api.rapid(x, y, Math.max(z, Math.min(clear, above))); api.cut(x, y, z, 2); },
    loop(L, z) { for (let k = 1; k <= L.length; k++) { const p = L[k % L.length]; api.cut(p[0], p[1], z); } },
  };
  void safe;
  return api;
}
const rotLoop = (L, k) => k ? [...L.slice(k), ...L.slice(0, k)] : L;
function nearestIdx(L, p) { let b = 0, bd = Infinity; L.forEach((q, i) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; b = i; } }); return b; }
function sampleF(F, G, x, y) { const i = Math.round((x - G.x0) / G.g), j = Math.round((y - G.y0) / G.g); if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return -1; return F[j * G.nx + i]; }
function segInside(D, G, a, b, margin) { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (G.g * 0.7))); for (let k = 0; k <= n; k++) { const t = k / n; if (sampleF(D, G, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < margin) return false; } return true; }
// clear the allowed region of one level with offset loops, innermost first, linking inside the region when possible
function clearLevel(P, G, allowed, z, stepover, climb, prevZ, toolR) {
  const D = distanceField(allowed, G.nx, G.ny, G.g);
  let maxD = 0; for (let i = 0; i < D.length; i++) if (allowed[i] && D[i] > maxD) maxD = D[i];
  if (maxD <= G.g * 0.6) return 0;
  const levels = []; for (let d = G.g * 0.6; d < maxD; d += stepover) levels.push(d);
  let loops = [];
  for (let k = levels.length - 1; k >= 0; k--) for (const L of contours(D, G, levels[k])) { const S = simplify(L, G.g * 0.3); if (S.length >= 3) loops.push({ L: climb ? S : [...S].reverse(), d: levels[k] }); }
  if (!loops.length) return 0;
  let n = 0;
  while (loops.length) {
    // innermost (largest d) loop nearest to the tool
    const top = Math.max(...loops.map(o => o.d)), here = P.cur;
    let bi = -1, bd = Infinity;
    loops.forEach((o, i) => { if (o.d < top - 1e-9) return; const q = o.L[here ? nearestIdx(o.L, here) : 0], dd = here ? (q[0] - here[0]) ** 2 + (q[1] - here[1]) ** 2 : 0; if (dd < bd) { bd = dd; bi = i; } });
    let o = loops.splice(bi, 1)[0];
    for (;;) {
      const L = rotLoop(o.L, P.cur ? nearestIdx(o.L, P.cur) : 0);
      if (P.cur && Math.abs(P.cur[2] - z) < 1e-9 && segInside(D, G, P.cur, L[0], G.g * 0.3) && Math.hypot(P.cur[0] - L[0][0], P.cur[1] - L[0][1]) < stepover * 2.5) P.cut(L[0][0], L[0][1], z);
      else P.enter(L[0][0], L[0][1], z, prevZ + 1);
      P.loop(L, z); n++;
      // the next loop outward that surrounds this one: nearest with smaller d
      let nb = -1, nd = Infinity;
      loops.forEach((q, i) => { if (q.d >= o.d - 1e-9 || q.d < o.d - stepover * 1.5) return; const s = q.L[nearestIdx(q.L, P.cur)], dd = Math.hypot(s[0] - P.cur[0], s[1] - P.cur[1]); if (dd < nd) { nd = dd; nb = i; } });
      if (nb < 0 || nd > stepover * 2.5) break;
      o = loops.splice(nb, 1)[0];
    }
  }
  void toolR;
  return n;
}
// ---- operations ----
// ctx: { G (part height map), stock: { x0, y0, x1, y1, top, bottom }, partTop, partBottom, clear }
// tool: { type: 'flat'|'ball'|'bull'|'drill'|'face', d, ... }
export function opFace(ctx, tool, p) {
  const R = tool.d / 2, s = (+p.stepover || 0.7) * tool.d, dz = +p.stepdown || 1, { stock } = ctx, P = pathBuilder(ctx.clear);
  const zEnd = ctx.partTop + (+p.leaveAxial || 0);
  if (stock.top <= zEnd + 1e-6) return { moves: [], warn: 'The stock top is already at the part top' };
  const zs = []; for (let z = stock.top - dz; z > zEnd + 1e-6; z -= dz) zs.push(z); zs.push(zEnd);
  const xa = stock.x0 - R - 2, xb = stock.x1 + R + 2;
  for (const z of zs) {
    let dir = 1, first = true;
    for (let y = stock.y0 + R * 0.6; y < stock.y1 - R * 0.6 + s; y += s) {
      const yy = Math.min(y, stock.y1 - R * 0.6), A = dir > 0 ? xa : xb, B = dir > 0 ? xb : xa;
      if (first) { P.retract(); P.rapid(A, yy, ctx.clear); P.rapid(A, yy, z); first = false; } else P.cut(A, yy, z);
      P.cut(B, yy, z); dir = -dir;
      if (yy >= stock.y1 - R * 0.6) break;
    }
  }
  P.retract();
  return { moves: P.moves };
}
function zLevels(top, bottom, dz) { const zs = []; for (let z = top - dz; z > bottom + 1e-6; z -= dz) zs.push(z); zs.push(bottom); return zs; }
function stockMask(ctx, extra) {
  const { G, stock } = ctx, m = new Uint8Array(G.nx * G.ny);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const x = G.x0 + i * G.g, y = G.y0 + j * G.g; if (x >= stock.x0 - extra && x <= stock.x1 + extra && y >= stock.y0 - extra && y <= stock.y1 + extra) m[j * G.nx + i] = 1; }
  return m;
}
export function opRough(ctx, tool, p) {
  const R = tool.d / 2, leaveR = +p.leaveRadial || 0, leaveA = +p.leaveAxial || 0, P = pathBuilder(ctx.clear), { G, stock } = ctx;
  const T = dilateFlat(G, R + leaveR), sm = stockMask(ctx, R * 0.9), so = (+p.stepover || 0.4) * tool.d, dz = +p.stepdown || 2;
  const bottom = Math.max(ctx.partBottom, +p.bottom > -1e8 && p.bottom !== '' && p.bottom != null ? +p.bottom : -Infinity, stock.bottom);
  let prev = stock.top, nl = 0;
  for (const z of zLevels(stock.top, bottom, dz)) {
    const A = new Uint8Array(G.nx * G.ny);
    for (let k = 0; k < A.length; k++) A[k] = sm[k] && T[k] + leaveA < z - 1e-6 ? 1 : 0;
    nl += clearLevel(P, G, A, z, so, p.direction !== 'conventional', prev, R);
    prev = z;
  }
  P.retract();
  return { moves: P.moves, loops: nl };
}
// pocket from a flat floor point (x, y, z): clears the connected pocket around it down to the floor
export function opPocket(ctx, tool, p) {
  const R = tool.d / 2, leaveR = +p.leaveRadial || 0, leaveA = +p.leaveAxial || 0, { G, stock } = ctx, P = pathBuilder(ctx.clear);
  const T = dilateFlat(G, R + leaveR), so = (+p.stepover || 0.4) * tool.d, dz = +p.stepdown || 2;
  const floors = (p.floors || []).filter(f => f && Number.isFinite(f.z));
  if (!floors.length) return { moves: [], warn: 'Pick the floor of the pocket' };
  let n = 0;
  for (const fl of floors) {
    const zf = fl.z + leaveA, base = new Uint8Array(G.nx * G.ny);
    for (let k = 0; k < base.length; k++) base[k] = T[k] < zf + 0.01 ? 1 : 0;
    // flood fill from the floor point (nearest allowed cell)
    let si = Math.round((fl.x - G.x0) / G.g), sj = Math.round((fl.y - G.y0) / G.g), seed = -1, bd = Infinity;
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) { const i = si + di, j = sj + dj; if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue; const k = j * G.nx + i; if (base[k] && di * di + dj * dj < bd) { bd = di * di + dj * dj; seed = k; } }
    if (seed < 0) return { moves: P.moves, warn: 'The tool does not fit into the pocket' };
    const M = new Uint8Array(G.nx * G.ny), st = [seed]; M[seed] = 1;
    while (st.length) { const k = st.pop(), i = k % G.nx, j = (k / G.nx) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= G.nx || jj >= G.ny) continue; const kk = jj * G.nx + ii; if (!M[kk] && base[kk]) { M[kk] = 1; st.push(kk); } } }
    let touches = false; for (let i = 0; i < G.nx && !touches; i++) touches = M[i] || M[(G.ny - 1) * G.nx + i]; for (let j = 0; j < G.ny && !touches; j++) touches = M[j * G.nx] || M[j * G.nx + G.nx - 1];
    if (touches) { const sm = stockMask(ctx, R * 0.9); for (let k = 0; k < M.length; k++) M[k] &= sm[k]; }   // an open pocket: stay over the stock
    let top = stock.top; for (let k = 0; k < M.length; k++) if (M[k] && G.H[k] > -Infinity && G.H[k] > zf + 0.01) top = Math.min(top, stock.top);
    let prev = stock.top;
    for (const z of zLevels(top, zf, dz)) {
      const A = new Uint8Array(M.length); for (let k = 0; k < A.length; k++) A[k] = M[k] && T[k] < z + 0.01 ? 1 : 0;
      n += clearLevel(P, G, A, z, so, p.direction !== 'conventional', prev, R); prev = z;
    }
    P.retract();
  }
  return { moves: P.moves, loops: n };
}
// profile around the part (outside), around openings (inside), or both, down to `bottom`
export function opContour(ctx, tool, p) {
  const R = tool.d / 2, leaveR = +p.leaveRadial || 0, { G, stock } = ctx, P = pathBuilder(ctx.clear);
  const T = dilateFlat(G, R + leaveR), dz = +p.stepdown || 2, bottom = p.bottom !== '' && p.bottom != null && Number.isFinite(+p.bottom) ? +p.bottom : ctx.partBottom;
  const side = p.side || 'outside', climb = p.direction !== 'conventional';
  const zs = p.multiDepth === false ? [bottom] : zLevels(stock.top, bottom, dz);
  let prev = stock.top, nl = 0;
  for (const z of zs) {
    const A = new Uint8Array(G.nx * G.ny); for (let k = 0; k < A.length; k++) A[k] = T[k] < z - 1e-6 ? 1 : 0;
    const loops = contours(distanceField(A, G.nx, G.ny, G.g), G, G.g * 0.6).map(L => simplify(L, G.g * 0.25)).filter(L => L.length >= 3);
    for (let L of loops) {
      const a = loopArea(L), outside = a < 0;
      // drop the loop that runs along the edge of the grid
      if (L.some(q => q[0] <= G.x0 + 1.5 * G.g || q[1] <= G.y0 + 1.5 * G.g || q[0] >= G.x0 + (G.nx - 2.5) * G.g || q[1] >= G.y0 + (G.ny - 2.5) * G.g)) continue;
      if ((side === 'outside' && !outside) || (side === 'inside' && outside)) continue;
      if (!climb) L = [...L].reverse();
      L = rotLoop(L, P.cur ? nearestIdx(L, P.cur) : 0);
      P.enter(L[0][0], L[0][1], z, prev + 1); P.loop(L, z); nl++;
    }
    prev = z;
  }
  P.retract();
  return { moves: P.moves, loops: nl };
}
// parallel finishing (raster) following the compensated surface
export function opParallel(ctx, tool, p) {
  const R = tool.d / 2, { G } = ctx, P = pathBuilder(ctx.clear), leave = +p.leaveAxial || 0;
  const T = tool.type === 'ball' ? dilateBall(G, R, +p.leaveRadial || 0) : dilateFlat(G, R + (+p.leaveRadial || 0));
  const s = (+p.stepover || 0.1) * tool.d, floor = ctx.partBottom, ang = (+p.angle || 0) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  // extent: part footprint + R
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) if (G.H[j * G.nx + i] > -Infinity) { const x = G.x0 + i * G.g, y = G.y0 + j * G.g; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!(x1 > x0)) return { moves: [], warn: 'Nothing to machine' };
  x0 -= R; y0 -= R; x1 += R; y1 += R;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = Math.hypot(x1 - x0, y1 - y0) / 2;
  // conservative: highest compensated value of the 3 x 3 cells around the point (straight moves between samples must not dip)
  const zAt = (x, y) => { const ci = Math.round((x - G.x0) / G.g), cj = Math.round((y - G.y0) / G.g); let v = floor;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue; const t = T[j * G.nx + i]; if (t > v) v = t; }
    return v + leave; };
  let dir = 1, nl = 0;
  for (let v = -half; v <= half + 1e-9; v += s) {
    const pts = [];
    for (let u = -half; u <= half + 1e-9; u += G.g * 0.5) {
      const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      pts.push([x, y, zAt(x, y)]);
    }
    if (pts.length < 2) continue;
    if (dir < 0) pts.reverse(); dir = -dir;
    const S = simplify3(pts, 0.005);
    if (P.cur && Math.hypot(P.cur[0] - S[0][0], P.cur[1] - S[0][1]) < s * 1.6) P.cut(...S[0]); else P.enter(S[0][0], S[0][1], S[0][2], S[0][2] + 2);
    for (const q of S.slice(1)) P.cut(...q);
    nl++;
  }
  P.retract();
  return { moves: P.moves, loops: nl };
}
function simplify3(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let best = -1, bd = tol; const A = pts[a], B = pts[b], d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1;
    for (let i = a + 1; i < b; i++) { const w = [pts[i][0] - A[0], pts[i][1] - A[1], pts[i][2] - A[2]], t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / l2, e = Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]); if (e > bd) { bd = e; best = i; } }
    if (best > 0) { keep[best] = 1; st.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// waterline finishing: closed contours at constant Z around steep walls
export function opWaterline(ctx, tool, p) {
  const R = tool.d / 2, { G } = ctx, P = pathBuilder(ctx.clear);
  const T = tool.type === 'ball' ? dilateBall(G, R, +p.leaveRadial || 0) : dilateFlat(G, R + (+p.leaveRadial || 0));
  const dz = +p.stepdown || 0.5, top = Math.min(ctx.partTop, p.top !== '' && p.top != null && Number.isFinite(+p.top) ? +p.top : Infinity), bottom = p.bottom !== '' && p.bottom != null && Number.isFinite(+p.bottom) ? +p.bottom : ctx.partBottom;
  let nl = 0;
  for (let z = top - dz; z >= bottom - 1e-6; z -= dz) {
    const A = new Uint8Array(G.nx * G.ny); for (let k = 0; k < A.length; k++) A[k] = T[k] < z ? 1 : 0;
    for (let L of contours(distanceField(A, G.nx, G.ny, G.g), G, G.g * 0.6).map(L => simplify(L, G.g * 0.25)).filter(L => L.length >= 3)) {
      if (L.some(q => q[0] <= G.x0 + 1.5 * G.g || q[1] <= G.y0 + 1.5 * G.g || q[0] >= G.x0 + (G.nx - 2.5) * G.g || q[1] >= G.y0 + (G.ny - 2.5) * G.g)) continue;
      if (p.direction === 'conventional') L = [...L].reverse();
      L = rotLoop(L, P.cur ? nearestIdx(L, P.cur) : 0);
      P.enter(L[0][0], L[0][1], z, z + dz + 1); P.loop(L, z); nl++;
    }
  }
  P.retract();
  return { moves: P.moves, loops: nl };
}
// drilling: holes = [{ x, y, top, bottom }]
export function opDrill(ctx, tool, p) {
  const holes = (p.holes || []).slice();
  if (!holes.length) return { moves: [], warn: 'Pick the holes to drill' };
  // shortest-ish order: nearest neighbour from the stock corner
  const out = []; let at = [ctx.stock.x0, ctx.stock.y0];
  while (holes.length) { let bi = 0, bd = Infinity; holes.forEach((hl, i) => { const d = (hl.x - at[0]) ** 2 + (hl.y - at[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); const hl = holes.splice(bi, 1)[0]; out.push(hl); at = [hl.x, hl.y]; }
  const tip = tool.type === 'drill' ? (tool.d / 2) / Math.tan(((+tool.tipAngle || 118) / 2) * Math.PI / 180) : 0;
  const moves = out.map(hl => ({ cycle: (+p.peck || 0) > 0 ? 'peck' : 'drill', x: hl.x, y: hl.y, top: hl.top, bottom: hl.bottom - (p.through ? tip + (+p.breakthrough || 0.5) : 0), peck: +p.peck || 0, retract: hl.top + (+p.retract || 2), dwell: +p.dwell || 0 }));
  return { moves, holes: out.length };
}
// ---- statistics, expansion, simulation ----
export function expandCycles(moves, clear) {
  const out = [];
  for (const m of moves) {
    if (!m.cycle) { out.push(m); continue; }
    out.push([0, m.x, m.y, clear], [0, m.x, m.y, m.retract]);
    if (m.cycle === 'peck' && m.peck > 0) { for (let z = m.top - m.peck; ; z -= m.peck) { const zz = Math.max(z, m.bottom); out.push([2, m.x, m.y, zz], [0, m.x, m.y, m.retract]); if (zz <= m.bottom) break; if (z !== zz) break; } }
    else out.push([2, m.x, m.y, m.bottom], [0, m.x, m.y, m.retract]);
    out.push([0, m.x, m.y, clear]);
  }
  return out;
}
export function pathStats(moves, feeds, rapidRate = 5000) {
  let cut = 0, rapid = 0, time = 0, prev = null;
  for (const m of moves) {
    if (prev) { const l = Math.hypot(m[1] - prev[1], m[2] - prev[2], m[3] - prev[3]); if (m[0] === 0) { rapid += l; time += l / rapidRate; } else { cut += l; time += l / (m[0] === 2 ? feeds.plunge : feeds.feed); } }
    prev = m;
  }
  return { cut, rapid, minutes: time };
}
export function simStock(G, stock) {
  const S = new Float32Array(G.nx * G.ny).fill(-Infinity);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const x = G.x0 + i * G.g, y = G.y0 + j * G.g; if (x >= stock.x0 - 1e-9 && x <= stock.x1 + 1e-9 && y >= stock.y0 - 1e-9 && y <= stock.y1 + 1e-9) S[j * G.nx + i] = stock.top; }
  return S;
}
// cut moves (expanded, rapids included) from index a to b into the stock map; returns rapid-into-stock count
export function simulate(G, S, moves, tool, a = 0, b = moves.length) {
  // half a cell smaller than the tool: cells on the exact rim belong to tessellated walls (holes are polygons inside the true circle)
  const R = Math.max(G.g * 0.5, tool.d / 2 - G.g * 0.5), rc = Math.ceil(R / G.g), offs = [], ball = tool.type === 'ball';
  for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) { const d2 = (dx * G.g) ** 2 + (dy * G.g) ** 2; if (d2 <= R * R + 1e-9) offs.push(dy * G.nx + dx, dx, dy, ball ? R - Math.sqrt(Math.max(0, R * R - d2)) : 0); }
  let crashes = 0;
  const stamp = (x, y, z, rapid) => {
    const ci = Math.round((x - G.x0) / G.g), cj = Math.round((y - G.y0) / G.g);
    for (let o = 0; o < offs.length; o += 4) {
      const i = ci + offs[o + 1], j = cj + offs[o + 2]; if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
      const k = j * G.nx + i, zz = z + offs[o + 3];
      if (S[k] > zz + 1e-6) { if (rapid && S[k] > zz + 0.05) crashes++; S[k] = zz; }
    }
  };
  for (let n = Math.max(1, a); n < b; n++) {
    const p = moves[n - 1], q = moves[n]; if (!p || !q) continue;
    const L = Math.hypot(q[1] - p[1], q[2] - p[2]), steps = Math.max(1, Math.ceil(L / (G.g * 0.5)));
    for (let s = (n === Math.max(1, a) ? 0 : 1); s <= steps; s++) { const t = s / steps; stamp(p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, p[3] + (q[3] - p[3]) * t, q[0] === 0); }
  }
  return crashes;
}
export function compareStock(G, S, tol = 0.01) {
  let gouge = 0, maxLeft = 0, gougeDepth = 0, where = null;
  for (let k = 0; k < S.length; k++) { const h = G.H[k]; if (h === -Infinity || S[k] === -Infinity) continue; const d = S[k] - h; if (d < -tol) { gouge++; if (-d > gougeDepth) { gougeDepth = -d; where = [G.x0 + (k % G.nx) * G.g, G.y0 + Math.floor(k / G.nx) * G.g, h, S[k]]; } } else if (d > maxLeft) maxLeft = d; }
  return { gougeCells: gouge, gougeDepth, maxLeft, where };
}
// ---- post processors ----
export const POSTS = {
  fanuc: { label: 'Fanuc / generic ISO', ext: 'nc', start: n => ['%', `O${String(n.program).padStart(4, '0')} (${n.name})`, 'G90 G17 G21 G40 G49 G80', n.wcs], toolChange: (t, n) => [`T${t.num} M6`, `S${t.rpm} M3`, `G43 H${t.num}`, n.coolant ? 'M8' : null], end: () => ['M9', 'M5', 'G91 G28 Z0', 'G90', 'M30', '%'], cycles: true },
  haas: { label: 'Haas', ext: 'nc', start: n => ['%', `O${String(n.program).padStart(5, '0')} (${n.name})`, 'G90 G17 G21 G40 G49 G80', n.wcs], toolChange: (t, n) => [`T${t.num} M6`, `S${t.rpm} M3`, `G43 H${t.num}`, n.coolant ? 'M8' : null], end: () => ['M9', 'M5', 'G91 G28 Z0', 'G28 Y0', 'G90', 'M30', '%'], cycles: true },
  linuxcnc: { label: 'LinuxCNC', ext: 'ngc', start: n => ['%', `(${n.name})`, 'G90 G17 G21 G40 G49 G80 G64 P0.01', n.wcs], toolChange: (t, n) => [`T${t.num} M6`, `G43 H${t.num}`, `S${t.rpm} M3`, n.coolant ? 'M8' : null], end: () => ['M9', 'M5', 'G53 G0 Z0', 'M2', '%'], cycles: true },
  grbl: { label: 'GRBL (hobby routers)', ext: 'nc', start: n => [`(${n.name})`, 'G90 G21 G17', n.wcs], toolChange: (t, n, first) => [first ? null : 'M5', first ? null : `(Change to tool ${t.num}: ${t.name}, then resume)`, first ? null : 'M0', `S${t.rpm} M3`, 'G4 P2'], end: () => ['M5', 'G0 X0 Y0', 'M30'], cycles: false },
};
export function postProcess(program, postId = 'fanuc') {
  const post = POSTS[postId] || POSTS.fanuc, out = [], f = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
  const push = (...l) => { for (const x of l.flat()) if (x != null) out.push(x); };
  push(post.start(program));
  let lastTool = null, first = true;
  for (const op of program.ops) {
    push(`(${op.name})`);
    if (lastTool !== op.tool.num) { push(post.toolChange(op.tool, program, first)); lastTool = op.tool.num; first = false; }
    const clear = program.clear, O = program.origin, X = x => f(x - O[0]), Y = y => f(y - O[1]), Z = z => f(z - O[2]);
    let pm = -1, px = null, py = null, pz = null, pf = null;
    const lin = (m, feed) => {
      const t = m[0] === 0 ? 0 : 1, words = [];
      if (t !== pm) words.push(t === 0 ? 'G0' : 'G1');
      const xs = X(m[1]), ys = Y(m[2]), zs = Z(m[3]);
      if (xs !== px) words.push('X' + xs); if (ys !== py) words.push('Y' + ys); if (zs !== pz) words.push('Z' + zs);
      if (t === 1 && feed !== pf) { words.push('F' + Math.round(feed)); pf = feed; }
      if (words.length > (t !== pm ? 1 : 0)) push(words.join(' '));
      pm = t; px = xs; py = ys; pz = zs;
    };
    for (const m of op.moves) {
      if (m.cycle) {
        if (post.cycles) {
          if (pz == null || +pz < +Z(clear)) push(`G0 Z${Z(clear)}`);
          const code = m.cycle === 'peck' ? 'G83' : m.dwell ? 'G82' : 'G81';
          push(`G98 ${code} X${X(m.x)} Y${Y(m.y)} Z${Z(m.bottom)} R${Z(m.retract)}${m.cycle === 'peck' ? ' Q' + f(m.peck) : ''}${m.dwell ? ' P' + Math.round(m.dwell * 1000) : ''} F${Math.round(op.tool.plunge)}`, 'G80');
          pm = 0; px = X(m.x); py = Y(m.y); pz = Z(clear);
        } else for (const e of expandCycles([m], clear)) lin(e, e[0] === 2 ? op.tool.plunge : op.tool.feed);
        continue;
      }
      lin(m, m[0] === 2 ? op.tool.plunge : op.tool.feed);
    }
    push(`G0 Z${Z(clear)}`);
  }
  push(post.end(program));
  return out.join('\n') + '\n';
}
