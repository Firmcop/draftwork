// FEA: cantilever bending, axial bar, and voxelisation volume.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/fea.js';

function boxTris(x0, y0, z0, x1, y1, z1) {
  const t = [], q = (a, b, c, d) => t.push(...a, ...b, ...c, ...a, ...c, ...d), P = (x, y, z) => [x, y, z];
  q(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)); q(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0));
  q(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)); q(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1));
  q(P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)); q(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1));
  return new Float32Array(t);
}
const steel = { E: 210000, nu: 0.3, yield: 250, density: 7.85 };
async function cantilever(h) {
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], h), M = F.buildModel(g, [steel]);
  const fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3);
  const end = [];
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6) fixed.set([1, 1, 1], 3 * q); if (p[0] > 100 - 1e-6) end.push(q); }
  for (const q of end) f[3 * q + 2] = -100 / end.length;
  const r = await F.solveStatic(M, fixed, f, { tol: 1e-9 });
  const tip = end.reduce((s, q) => s + r.u[3 * q + 2], 0) / end.length;
  return { r, tip, M, g };
}
test('voxel volume of a box is exact', () => {
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], 2.5);
  const n = g.solid.reduce((s, v) => s + (v ? 1 : 0), 0);
  const cv = g.hs[0] * g.hs[1] * g.hs[2]; assert.ok(Math.abs(n * cv - 10000) < 1e-6, 'volume ' + n * cv);
});
test('cantilever tip deflection matches beam theory within 4 %', async () => {
  const exact = 100 * 100 ** 3 / (3 * 210000 * (10 * 10 ** 3 / 12));   // 0.1905 mm (Euler-Bernoulli; shear adds ~0.3 %)
  const { r, tip } = await cantilever(2.5);
  assert.ok(r.converged, 'converged in ' + r.iterations);
  assert.ok(Math.abs(-tip - exact) / exact < 0.04, `tip ${(-tip).toFixed(4)} vs ${exact.toFixed(4)}`);
  // bending stress near the root (away from the clamp singularity): M c / I = 100*90*5/833.3 = 54 MPa at x = 10
  assert.ok(Math.abs(r.reaction[2] - 100) < 0.5, 'reaction balances the load: ' + r.reaction[2]);
  // surface bending stress at x = 50 (M = 100 N x 50 mm, c = 5): 30 MPa
  const { M } = await cantilever(2.5).then(x => x);
  void M;
});
test('axial bar: uniform stress F/A and stretch FL/EA', async () => {
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 50, 5, 5) }], 2.5), M = F.buildModel(g, [steel]);
  const fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3), end = [];
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6) { fixed[3 * q] = 1; if (p[1] < 1e-6) fixed[3 * q + 1] = 1; if (p[2] < 1e-6) fixed[3 * q + 2] = 1; } if (p[0] > 50 - 1e-6) end.push(q); }
  // consistent loads for a uniform traction on a 2 x 2 element face: corner 1/16, edge 1/8, centre 1/4 of the total
  const tot = 1000; let wsum = 0; const w = end.map(q => { const p = F.nodePos(M, q); const e = (p[1] < 1e-6 || p[1] > 5 - 1e-6 ? 1 : 2) * (p[2] < 1e-6 || p[2] > 5 - 1e-6 ? 1 : 2); wsum += e; return e; });
  end.forEach((q, i) => { f[3 * q] = tot * w[i] / wsum; });
  const r = await F.solveStatic(M, fixed, f, { tol: 1e-10 });
  const stretch = end.reduce((s, q) => s + r.u[3 * q], 0) / end.length, exact = 1000 * 50 / (210000 * 25);
  assert.ok(Math.abs(stretch - exact) / exact < 0.01, `stretch ${stretch} vs ${exact}`);
  const mid = r.vm[Math.floor(M.ne / 2)]; assert.ok(Math.abs(mid - 40) < 0.5, 'stress F/A = 40 MPa: ' + mid);
});
test('surface bending stress from corner recovery: 30 MPa at mid-span', async () => {
  const g = F.voxelize([{ tris: (() => { const t = []; const q = (a, b, c, d) => t.push(...a, ...b, ...c, ...a, ...c, ...d), P = (x, y, z) => [x, y, z], x0 = 0, y0 = 0, z0 = 0, x1 = 100, y1 = 10, z1 = 10;
    q(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)); q(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)); q(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)); q(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)); q(P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)); q(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)); return new Float32Array(t); })() }], 2.5);
  const M = F.buildModel(g, [{ E: 210000, nu: 0.3 }]), fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3), end = [];
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6) fixed.set([1, 1, 1], 3 * q); if (p[0] > 100 - 1e-6) end.push(q); }
  for (const q of end) f[3 * q + 2] = -100 / end.length;
  const r = await F.solveStatic(M, fixed, f, { tol: 1e-9 });
  const top = []; for (let q = 0; q < M.nn; q++) { const p = F.nodePos(M, q); if (M.nodeActive[q] && Math.abs(p[0] - 50) < 1e-6 && Math.abs(p[2] - 10) < 1e-6) top.push(r.vmNode[q]); }
  const avg = top.reduce((a, b) => a + b, 0) / top.length;
  assert.ok(Math.abs(avg - 30) < 1.5, 'surface stress at mid-span ' + avg.toFixed(2) + ' MPa');
});
