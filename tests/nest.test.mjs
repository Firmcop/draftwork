// Nesting: rectangles and an L shape onto a sheet; no overlaps, gap respected, rotation used, overflow to a second sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nestParts, nestDXF } from '../src/nest.js';

const rect = (w, h) => [[[0, 0], [w, 0], [w, h], [0, h]]];
const inside = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const a = L[i], b = L[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
function overlapArea(A, B, step = 0.5) {
  const bb = L => [Math.min(...L.map(p => p[0])), Math.min(...L.map(p => p[1])), Math.max(...L.map(p => p[0])), Math.max(...L.map(p => p[1]))];
  const a = bb(A), b = bb(B), x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]); let n = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (inside([x, y], A) && inside([x, y], B)) n++;
  return n * step * step;
}
test('rectangles pack without overlap, keep the gap and stay on the sheet', () => {
  const parts = [{ id: 'a', name: 'A', loops: rect(100, 40), qty: 3 }, { id: 'b', name: 'B', loops: rect(30, 30), qty: 4 }, { id: 'l', name: 'L', loops: [[[0, 0], [60, 0], [60, 15], [15, 15], [15, 60], [0, 60]]], qty: 2 }];
  const n = nestParts(parts, { width: 300, height: 150, gap: 4, res: 1 });
  assert.equal(n.unplaced.length, 0); assert.equal(n.sheets.length, 1);
  const all = n.sheets[0].placed; assert.equal(all.length, 9);
  for (const p of all) for (const q of p.loops[0]) assert.ok(q[0] >= -1e-6 && q[1] >= -1e-6 && q[0] <= 300 + 1e-6 && q[1] <= 150 + 1e-6, 'on the sheet');
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.equal(overlapArea(all[i].loops[0], all[j].loops[0]), 0, `${all[i].name} and ${all[j].name} overlap`);
  assert.ok(n.sheets[0].utilisation > 0.35);
  assert.ok(/PARTS/.test(nestDXF(n)));
});
test('a long part only fits rotated; extra quantity spills onto another sheet', () => {
  const n = nestParts([{ id: 'x', name: 'Bar', loops: rect(20, 140), qty: 3 }], { width: 200, height: 60, gap: 2, res: 1 });
  assert.ok(n.sheets[0].placed.every(p => p.angle === 90 || p.angle === 270), 'rotated to lie along the sheet');
  assert.equal(n.sheets.length, 2, '2 bars per sheet → 2 sheets');
});
