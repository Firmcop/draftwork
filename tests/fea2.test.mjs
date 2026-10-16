// FEA: natural frequencies (cantilever, free-free beam) and steady heat conduction (1D bar, convection).
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
const steel = { E: 210000, nu: 0.3, density: 7.85, k: 50 };
const EI = 210000 * 10 * 10 ** 3 / 12, rhoA = 7.85e-9 * 100;

test('Jacobi eigen-solver on a 3 x 3 matrix', () => {
  const E = F.jacobiEigen([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]);
  [2 - Math.SQRT2, 2, 2 + Math.SQRT2].forEach((v, i) => assert.ok(Math.abs(E.val[i] - v) < 1e-10, E.val.join(',')));
});
test('cantilever first bending frequency matches Euler-Bernoulli within 5 %', async () => {
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], 2.5), M = F.buildModel(g, [steel]);
  const fixed = new Uint8Array(M.nn * 3);
  for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && F.nodePos(M, q)[0] < 1e-6) fixed.set([1, 1, 1], 3 * q);
  const r = await F.solveModal(M, fixed, { modes: 4 });
  const f1 = 1.875104 ** 2 / (2 * Math.PI) * Math.sqrt(EI / (rhoA * 100 ** 4));   // 835 Hz
  const f2 = 4.694091 ** 2 / (2 * Math.PI) * Math.sqrt(EI / (rhoA * 100 ** 4));
  assert.ok(Math.abs(r.freqs[0] - f1) / f1 < 0.05 && Math.abs(r.freqs[1] - f1) / f1 < 0.05, `f1 ${r.freqs.map(f => f.toFixed(1))} vs ${f1.toFixed(1)}`);
  // modes 1 and 2 are the two equal bending modes of the square section; the next bending pair is at 6.27 f1 (torsion sits between)
  assert.ok(r.freqs.slice(2).some(f => Math.abs(f - f2) / f2 < 0.08) || r.freqs[3] < f2, 'second bending ' + r.freqs.map(f => f.toFixed(0)) + ' vs ' + f2.toFixed(0));
  assert.ok(Math.abs(r.mass - 0.0785) < 1e-9, 'mass 78.5 g in kg: ' + r.mass);
  const p = r.participation[0]; assert.ok(p[1] + p[2] > 0.5 && p[0] < 0.05, 'first mode is transverse: ' + p.map(v => v.toFixed(3)));
});
test('free-free beam: six rigid modes near zero, then the first flexural mode', async () => {
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], 2.5), M = F.buildModel(g, [steel]);
  const r = await F.solveModal(M, new Uint8Array(M.nn * 3), { modes: 8 });
  const ff = 4.730041 ** 2 / (2 * Math.PI) * Math.sqrt(EI / (rhoA * 100 ** 4));   // 5.32 kHz
  assert.ok(r.freqs.slice(0, 6).every(f => f < 0.02 * ff), 'rigid: ' + r.freqs.map(f => f.toFixed(1)));
  assert.ok(Math.abs(r.freqs[6] - ff) / ff < 0.06, `free-free ${r.freqs[6].toFixed(0)} vs ${ff.toFixed(0)}`);
});
test('1D conduction: linear temperature and heat flow k A ΔT / L', async () => {
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], 2.5), M = F.buildModel(g, [steel]);
  const T = new Float64Array(M.nn).fill(NaN);
  for (let q = 0; q < M.nn; q++) { if (!M.nodeActive[q]) continue; const x = F.nodePos(M, q)[0]; if (x < 1e-6) T[q] = 100; if (x > 100 - 1e-6) T[q] = 20; }
  const r = await F.solveThermal(M, { T });
  const mid = []; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && Math.abs(F.nodePos(M, q)[0] - 50) < 1e-6) mid.push(r.T[q]);
  assert.ok(mid.every(t => Math.abs(t - 60) < 1e-5), 'mid-span 60 °C: ' + mid[0]);
  const Qx = 0.05 * 100 * 80 / 100;   // W: k = 0.05 W/(mm·K), A = 100 mm², ΔT = 80, L = 100
  assert.ok(Math.abs(r.fluxMag[0] * 100 - Qx) < 1e-6, 'flux × area ' + r.fluxMag[0] * 100);
  assert.ok(Math.abs(r.heatFixed) < 1e-6, 'energy balance at the fixed ends: ' + r.heatFixed);
});
test('heat input with convection: tip temperature from series resistances', async () => {
  // 4 W into the x = 100 face, convection h = 1000 W/(m²K) on the x = 0 face to 20 °C, other faces insulated
  const g = F.voxelize([{ tris: boxTris(0, 0, 0, 100, 10, 10) }], 2.5), M = F.buildModel(g, [steel]);
  const q = new Float64Array(M.nn), hA = new Float64Array(M.nn), hT = new Float64Array(M.nn), end = [], root = [];
  for (let n = 0; n < M.nn; n++) { if (!M.nodeActive[n]) continue; const x = F.nodePos(M, n)[0]; if (x > 100 - 1e-6) end.push(n); if (x < 1e-6) root.push(n); }
  // consistent face weights on a 4 x 4 element face: corner 1, edge 2, interior 4 (sum 64)
  const w = n => { const p = F.nodePos(M, n), e = v => (v < 1e-6 || v > 10 - 1e-6) ? 1 : 2; return e(p[1]) * e(p[2]); };
  const ws = end.reduce((s, n) => s + w(n), 0);
  for (const n of end) q[n] = 4 * w(n) / ws;
  const h = 1000e-6, A = 100; for (const n of root) { hA[n] = h * A * w(n) / ws; hT[n] = hA[n] * 20; }
  const r = await F.solveThermal(M, { q, hA, hT });
  const Tend = end.reduce((s, n) => s + r.T[n], 0) / end.length, exact = 20 + 4 / (h * A) + 4 * 100 / (0.05 * A);   // 20 + 40 + 80 = 140
  assert.ok(Math.abs(Tend - exact) < 0.01, `tip ${Tend.toFixed(3)} vs ${exact}`);
  assert.ok(Math.abs(r.heatConv - 4) < 1e-4, 'all 4 W leave by convection: ' + r.heatConv);
});
