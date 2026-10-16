// Slicer: a 20 x 20 x 10 cube with a Ø8 through hole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceLoops, slicePart, printGcode } from '../src/slicer.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
function cubeWithHole() {
  const t = [], q = (a, b, c, d) => t.push(...a, ...b, ...c, ...a, ...c, ...d), n = 32, r = 4, S = 10, H = 10;
  // outer walls
  const c = [[-S, -S], [S, -S], [S, S], [-S, S]];
  for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; q([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], H], [a[0], a[1], H]); }
  // hole wall (inward) and top/bottom rings as fans from the square corners (good enough for slicing tests)
  for (let i = 0; i < n; i++) { const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n, A = [r * Math.cos(a0), r * Math.sin(a0)], B = [r * Math.cos(a1), r * Math.sin(a1)]; q([B[0], B[1], 0], [A[0], A[1], 0], [A[0], A[1], H], [B[0], B[1], H]); }
  return new Float32Array(t);
}
test('slice loops: outer square and the hole', () => {
  const loops = sliceLoops(cubeWithHole(), 5);
  assert.equal(loops.length, 2);
  const sizes = loops.map(L => Math.max(...L.map(p => p[0])) - Math.min(...L.map(p => p[0]))).sort((a, b) => a - b);
  near(sizes[0], 8, 0.05, 'hole'); near(sizes[1], 20, 1e-6, 'outer');
});
test('layers: perimeters around the outside and the hole, solid bottom/top, sparse middle; G-code', () => {
  const sl = slicePart(cubeWithHole(), { layer: 0.2, firstLayer: 0.3, perimeters: 2, infill: 20, topLayers: 3, bottomLayers: 3, nozzle: 0.4 });
  assert.equal(sl.layers.length, 50);
  const L = sl.layers[25];
  const outer = L.paths.filter(p => p.kind === 'outer'), inner = L.paths.filter(p => p.kind === 'inner');
  assert.equal(outer.length, 2, 'outer perimeter: around the part and around the hole'); assert.equal(inner.length, 2);
  const ext = Math.max(...outer.flatMap(p => p.pts.map(q => q[0])));
  near(ext, 10 - sl.lineWidth / 2, 0.08, 'outer perimeter centred half a line width in');
  assert.ok(L.paths.some(p => p.kind === 'infill') && !L.paths.some(p => p.kind === 'solid'), 'middle layer: sparse infill only');
  assert.ok(sl.layers[1].paths.some(p => p.kind === 'solid') && sl.layers[48].paths.some(p => p.kind === 'solid'), 'bottom and top: solid');
  assert.ok(sl.layers[0].paths.some(p => p.kind === 'skirt'), 'skirt on the first layer');
  const g = printGcode(sl, { layer: 0.2, infill: 20, filament: 1.75, name: 'cube' });
  assert.ok(/;LAYER:49/.test(g.gcode) && /M109 S210/.test(g.gcode) && /G1 X[-\d.]+ Y[-\d.]+ E[\d.]+/.test(g.gcode));
  // filament use roughly matches the volume: solid shell + 20 % infill, between 25 % and 80 % of the full volume
  const vol = 20 * 20 * 10 - Math.PI * 16 * 10, used = g.stats.filament * Math.PI * 0.875 ** 2;
  assert.ok(used > vol * 0.25 && used < vol * 0.8, `extruded ${used.toFixed(0)} mm³ of ${vol.toFixed(0)}`);
  assert.ok(g.stats.minutes > 5 && g.stats.grams > 1);
});
