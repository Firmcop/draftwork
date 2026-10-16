// FEA: thermal stress (free and restrained bar) and linear buckling (Euler column).
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
const steel = { E: 210000, nu: 0.3, alpha: 12e-6, density: 7.85 };
const bar = h => { const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], h); return F.buildModel(g, [steel]); };

test('free bar heated 50 K: expands α ΔT L, no stress', async () => {
  const M = bar(2.5), fixed = new Uint8Array(M.nn * 3);
  // statically determinate support: x at x = 0, y on the y = 0 edge, z on the z = 0 corner line
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6) { fixed[3 * q] = 1; if (p[1] < 1e-6) fixed[3 * q + 1] = 1; if (p[2] < 1e-6) fixed[3 * q + 2] = 1; } }
  const r = await F.solveStatic(M, fixed, new Float64Array(M.nn * 3), { dT: new Float64Array(M.ne).fill(50), tol: 1e-10 });
  let ux = 0, c = 0; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && F.nodePos(M, q)[0] > 100 - 1e-6) { ux += r.u[3 * q]; c++; }
  assert.ok(Math.abs(ux / c - 12e-6 * 50 * 100) < 1e-6, 'stretch ' + ux / c);
  assert.ok(Math.max(...r.vm) < 0.01, 'stress-free: ' + Math.max(...r.vm));
});
test('bar held between walls, heated 50 K: σ = −E α ΔT', async () => {
  const M = bar(2.5), fixed = new Uint8Array(M.nn * 3);
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6 || p[0] > 100 - 1e-6) { fixed[3 * q] = 1; if (p[1] < 1e-6 && p[2] < 1e-6 && p[0] < 1e-6) { fixed[3 * q + 1] = 1; fixed[3 * q + 2] = 1; } if (p[1] < 1e-6 && p[2] < 1e-6) fixed[3 * q + 2] = 1; } }
  const r = await F.solveStatic(M, fixed, new Float64Array(M.nn * 3), { dT: new Float64Array(M.ne).fill(50), tol: 1e-10 });
  const sx = r.sig[Math.floor(M.ne / 2) * 6], exact = -210000 * 12e-6 * 50;   // −126 MPa
  assert.ok(Math.abs(sx - exact) < 0.5, `σx ${sx.toFixed(2)} vs ${exact}`);
  assert.ok(Math.abs(r.reaction[0]) < 1e-6 * Math.abs(exact * 100), 'wall reactions cancel: ' + r.reaction[0]);
});
test('Euler buckling of a fixed-free column: P_cr = π² E I / 4 L²', async () => {
  // column along x, clamped at x = 0, 1000 N compression at x = 100
  const M = bar(2.5), fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3), end = [];
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6) fixed.set([1, 1, 1], 3 * q); if (p[0] > 100 - 1e-6) end.push(q); }
  const w = q => { const p = F.nodePos(M, q), e = v => (v < 1e-6 || v > 10 - 1e-6) ? 1 : 2; return e(p[1]) * e(p[2]); }, ws = end.reduce((s, q) => s + w(q), 0);
  for (const q of end) f[3 * q] = -1000 * w(q) / ws;
  const st = await F.solveStatic(M, fixed, f, { tol: 1e-10 });
  const r = await F.solveBuckling(M, fixed, st.sig, { modes: 2 });
  const Pcr = Math.PI ** 2 * 210000 * (10 ** 4 / 12) / (4 * 100 ** 2);   // 43 180 N
  assert.ok(r.factors.length === 2, 'two modes: ' + r.factors);
  if (process.env.V) console.log('buckling', r.factors.map(l => (l * 1000).toFixed(0)), Pcr.toFixed(0), r.iterations);
  for (const l of r.factors) assert.ok(Math.abs(l * 1000 - Pcr) / Pcr < 0.05, `P_cr ${(l * 1000).toFixed(0)} vs ${Pcr.toFixed(0)} N`);
  const v = r.modes[0]; let tipY = 0, tipX = 0; for (const q of end) { tipY += Math.hypot(v[3 * q + 1], v[3 * q + 2]); tipX += Math.abs(v[3 * q]); }
  assert.ok(tipY > 10 * tipX, 'buckling shape is sideways at the tip');
});
test('tension does not buckle', async () => {
  const M = bar(2.5), fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3), end = [];
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const p = F.nodePos(M, q); if (p[0] < 1e-6) fixed.set([1, 1, 1], 3 * q); if (p[0] > 100 - 1e-6) end.push(q); }
  for (const q of end) f[3 * q] = 1000 / end.length;
  const st = await F.solveStatic(M, fixed, f, { tol: 1e-10 });
  const r = await F.solveBuckling(M, fixed, st.sig, { modes: 2 });
  assert.ok(r.factors.every(l => l > 1e3), 'no meaningful buckling factor in pure tension: ' + r.factors);
});
