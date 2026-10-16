// CAM core: height maps, compensation, contours and toolpaths on a box with a pocket; simulation and posts.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/camcore.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
// axis-aligned box as triangles (only the top and the sides matter for a height map)
function boxTris(x0, y0, z0, x1, y1, z1) {
  const q = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const P = (x, y, z) => [x, y, z];
  return [...q(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)), ...q(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)),
    ...q(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)), ...q(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)),
    ...q(P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)), ...q(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1))];
}
// 60 x 40 x 20 block with a 20 x 20 pocket 8 deep in the middle: top surface split around the pocket + pocket floor
function partTris() {
  const t = [];
  const top = (x0, y0, x1, y1, z) => t.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
  top(-30, -20, 30, -10, 20); top(-30, 10, 30, 20, 20); top(-30, -10, -10, 10, 20); top(10, -10, 30, 10, 20); top(-10, -10, 10, 10, 12);
  t.push(...boxTris(-30, -20, 0, 30, 20, 0.0001).slice(18, 36));   // bottom face
  return new Float32Array(t);
}
function ctxFor(g = 0.5) {
  const G = C.rasterize(C.makeGrid(-45, -35, 45, 35, g), partTris());
  return { G, stock: { x0: -32, y0: -22, x1: 32, y1: 22, top: 22, bottom: 0 }, partTop: 20, partBottom: 0, clear: 30 };
}
const flat10 = { type: 'flat', d: 10, num: 1, rpm: 8000, feed: 1200, plunge: 300, name: 'Ø10 flat' };

test('height map: top, pocket floor, empty outside', () => {
  const { G } = ctxFor();
  const at = (x, y) => G.H[Math.round((y - G.y0) / G.g) * G.nx + Math.round((x - G.x0) / G.g)];
  near(at(-20, 0), 20, 1e-5, 'top'); near(at(0, 0), 12, 1e-5, 'pocket floor'); assert.equal(at(40, 0), -Infinity);
});
test('flat compensation keeps the tool out of the pocket corners', () => {
  const { G } = ctxFor();
  const T = C.dilateFlat(G, 5), at = (x, y) => T[Math.round((y - G.y0) / G.g) * G.nx + Math.round((x - G.x0) / G.g)];
  near(at(0, 0), 12, 1e-5, 'centre of the pocket'); near(at(4.5, 0), 12, 1e-5, 'just fits'); near(at(6, 0), 20, 1e-5, 'too close to the wall'); near(at(34.5, 0), 20, 1e-5, 'beside the part'); assert.equal(at(36, 0), -Infinity);
});
test('contours of the compensated outside profile: one loop, offset by R, climb direction (clockwise)', () => {
  const ctx = ctxFor(); const r = C.opContour(ctx, flat10, { side: 'outside', stepdown: 25, bottom: 0 });
  const cuts = r.moves.filter(m => m[0] === 1);
  assert.equal(r.loops, 1, 'one level, one loop');
  const xs = cuts.map(m => m[1]), ys = cuts.map(m => m[2]);
  near(Math.max(...xs), 35, 0.6, 'x extent = 30 + 5'); near(Math.min(...ys), -25, 0.6, 'y extent');
  const L = cuts.map(m => [m[1], m[2]]); assert.ok(C.loopArea(L) < 0, 'clockwise around the part');
});
test('pocket clears the floor at 12 inside a 20 x 20 window with a 10 mm tool', () => {
  const ctx = ctxFor(); const r = C.opPocket(ctx, flat10, { floors: [{ x: 0, y: 0, z: 12 }], stepover: 0.4, stepdown: 4 });
  const cuts = r.moves.filter(m => m[0] !== 0);
  assert.ok(cuts.length > 4 && r.loops >= 2);
  assert.ok(cuts.every(m => Math.abs(m[1]) <= 5.3 && Math.abs(m[2]) <= 5.3), 'tool centre stays within 5 mm of the pocket centre');
  near(Math.min(...cuts.map(m => m[3])), 12, 1e-9, 'reaches the floor');
  // simulate and check: pocket floor cut, walls untouched
  const S = C.simStock(ctx.G, ctx.stock); C.simulate(ctx.G, S, C.expandCycles(r.moves, 30), flat10);
  const at = (x, y) => S[Math.round((y - ctx.G.y0) / ctx.G.g) * ctx.G.nx + Math.round((x - ctx.G.x0) / ctx.G.g)];
  near(at(0, 0), 12, 1e-6, 'floor'); near(at(-20, 0), 22, 1e-6, 'top of the block still stock');
  const cmp = C.compareStock(ctx.G, S); assert.equal(cmp.gougeCells, 0, 'no gouges');
});
test('roughing leaves stock, then waterline + facing finish without gouging', () => {
  const ctx = ctxFor(0.5);
  const rough = C.opRough(ctx, flat10, { stepover: 0.45, stepdown: 5, leaveRadial: 0.5, leaveAxial: 0.3 });
  const face = C.opFace(ctx, { ...flat10, d: 20, type: 'face' }, { stepover: 0.7, stepdown: 2 });
  const S = C.simStock(ctx.G, ctx.stock);
  C.simulate(ctx.G, S, C.expandCycles(face.moves, 30), { type: 'flat', d: 20 });
  C.simulate(ctx.G, S, C.expandCycles(rough.moves, 30), flat10);
  const c1 = C.compareStock(ctx.G, S);
  assert.equal(c1.gougeCells, 0, 'roughing does not gouge'); assert.ok(c1.maxLeft >= 0.29, 'stock left for finishing ' + c1.maxLeft);
  const st = C.pathStats(C.expandCycles(rough.moves, 30), flat10); assert.ok(st.minutes > 0 && st.cut > 100);
});
test('parallel finishing with a ball mill follows the surface', () => {
  const ctx = ctxFor(0.5), ball6 = { type: 'ball', d: 6, num: 2, rpm: 10000, feed: 1500, plunge: 400 };
  const r = C.opParallel(ctx, ball6, { stepover: 0.15 });
  const S = C.simStock(ctx.G, ctx.stock); C.simulate(ctx.G, S, C.expandCycles(r.moves, 30), ball6);
  const c = C.compareStock(ctx.G, S, 0.02); assert.equal(c.gougeCells, 0, 'no gouges, depth ' + c.gougeDepth);
  assert.ok(r.loops > 20);
});
test('drilling and post processors', () => {
  const ctx = ctxFor(), drill = { type: 'drill', d: 5, num: 3, rpm: 2000, feed: 200, plunge: 150, tipAngle: 118, name: 'Ø5 drill' };
  const r = C.opDrill(ctx, drill, { holes: [{ x: 20, y: 0, top: 20, bottom: 0 }, { x: -20, y: 0, top: 20, bottom: 0 }], peck: 3, through: true });
  assert.equal(r.moves.length, 2); assert.ok(r.moves[0].bottom < -1, 'through: the drill tip goes below the bottom');
  const prog = { name: 'TEST', program: 1001, wcs: 'G54', clear: 30, origin: [-32, -22, 22], coolant: true, ops: [{ name: 'Pocket', tool: flat10, moves: C.opPocket(ctx, flat10, { floors: [{ x: 0, y: 0, z: 12 }], stepdown: 4 }).moves }, { name: 'Drill', tool: drill, moves: r.moves }] };
  const fanuc = C.postProcess(prog, 'fanuc');
  assert.ok(/T1 M6/.test(fanuc) && /T3 M6/.test(fanuc) && /G83 .*Q3/.test(fanuc) && /M30/.test(fanuc) && /G43 H1/.test(fanuc));
  assert.ok(/X32 Y22 Z-22|Z-10/.test(fanuc), 'coordinates are relative to the stock top corner');
  const grbl = C.postProcess(prog, 'grbl');
  assert.ok(!/G83|M6/.test(grbl) && /M0/.test(grbl), 'GRBL: drilling expanded, manual tool change');
});
