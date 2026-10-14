// Sketch constraint solver: constraints, dimensions, degrees of freedom, loops -> solids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);

// a roughly drawn rectangle: 4 points, 4 lines, H/V constraints
function rectGeo() {
  return {
    points: [{ id: 'p1', x: 1, y: 2 }, { id: 'p2', x: 38, y: -1 }, { id: 'p3', x: 41, y: 22 }, { id: 'p4', x: -2, y: 18 }],
    curves: [{ id: 'l1', kind: 'line', a: 'p1', b: 'p2' }, { id: 'l2', kind: 'line', a: 'p2', b: 'p3' }, { id: 'l3', kind: 'line', a: 'p3', b: 'p4' }, { id: 'l4', kind: 'line', a: 'p4', b: 'p1' }],
    cons: [{ id: 'c1', type: 'horizontal', e: ['l1'] }, { id: 'c2', type: 'vertical', e: ['l2'] }, { id: 'c3', type: 'horizontal', e: ['l3'] }, { id: 'c4', type: 'vertical', e: ['l4'] }],
  };
}

test('H/V constraints square up a rough rectangle and leave 4 degrees of freedom', () => {
  const g = rectGeo(), s = K.solveSketch(g);
  assert.ok(s.ok);
  const P = id => s.points.get(id);
  near(P('p1').y, P('p2').y, 1e-6, 'bottom horizontal'); near(P('p2').x, P('p3').x, 1e-6, 'right vertical');
  assert.equal(K.analyzeSketch(g, s).dof, 4);   // position x, y, width, height
});

test('dimensions + origin coincidence fully constrain it', () => {
  const g = rectGeo();
  g.cons.push({ id: 'd1', type: 'length', e: ['l1'], value: 40 }, { id: 'd2', type: 'length', e: ['l2'], value: 20 }, { id: 'c5', type: 'coincident', e: ['p1', 'O'] });
  const s = K.solveSketch(g), a = K.analyzeSketch(g, s);
  assert.ok(s.ok);
  assert.equal(a.dof, 0);
  assert.equal(a.free.size, 0);
  near(s.points.get('p3').x, 40, 1e-6, 'width'); near(s.points.get('p3').y, 20, 1e-6, 'height');
});

test('conflicting constraints are reported', () => {
  const g = rectGeo();
  g.cons.push({ id: 'd1', type: 'length', e: ['l1'], value: 40 }, { id: 'd3', type: 'length', e: ['l3'], value: 30 });  // opposite sides of a rectangle must match
  assert.equal(K.solveSketch(g).ok, false);
});

test('parameter-driven dimension rebuilds the solid', () => {
  const g = rectGeo();
  g.cons.push({ id: 'd1', type: 'length', e: ['l1'], value: 'w' }, { id: 'd2', type: 'length', e: ['l2'], value: 'w / 2' }, { id: 'c5', type: 'coincident', e: ['p1', 'O'] });
  const doc = [{ id: 's', type: 'sketch', plane: 'XY', profiles: [], geo: g }, { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new' }];
  for (const w of [40, 60]) {
    const r = K.regenerateBrep(K.resolveFeatures(doc, { w }));
    near(K.brepProps([...r.bodies.values()][0]).volume, w * (w / 2) * 10, 1e-6, 'box volume at w=' + w);
  }
});

test('slot from tangent arcs extrudes exactly (both kernels)', () => {
  const g = {
    points: [{ id: 'c1', x: 0, y: 0 }, { id: 'c2', x: 31, y: 1 }, { id: 'a1', x: 0, y: -5 }, { id: 'b1', x: 0, y: 5 }, { id: 'a2', x: 30, y: 5.5 }, { id: 'b2', x: 31, y: -4 }],
    curves: [
      { id: 'arcL', kind: 'arc', c: 'c1', a: 'b1', b: 'a1' }, { id: 'arcR', kind: 'arc', c: 'c2', a: 'b2', b: 'a2' },
      { id: 'top', kind: 'line', a: 'a2', b: 'b1' }, { id: 'bot', kind: 'line', a: 'a1', b: 'b2' },
    ],
    cons: [
      { id: 'k1', type: 'coincident', e: ['c1', 'O'] }, { id: 'k2', type: 'horizontal', e: ['c1', 'c2'] },
      { id: 'k3', type: 'tangent', e: ['top', 'arcL'] }, { id: 'k4', type: 'tangent', e: ['top', 'arcR'] }, { id: 'k5', type: 'tangent', e: ['bot', 'arcL'] }, { id: 'k6', type: 'tangent', e: ['bot', 'arcR'] },
      { id: 'k7', type: 'equal', e: ['arcL', 'arcR'] }, { id: 'k8', type: 'radius', e: ['arcL'], value: 5 }, { id: 'k9', type: 'distance', e: ['c1', 'c2'], value: 30 },
    ],
  };
  const free = K.analyzeSketch({ ...g, cons: g.cons.filter(k => !['k1', 'k2', 'k8', 'k9'].includes(k.id)) }, K.solveSketch(g));
  assert.equal(free.dof, 5, 'an unconstrained slot keeps 5 degrees of freedom (2 centers + radius)');
  const s = K.solveSketch(g);
  assert.ok(s.ok, 'residual ' + s.residual);
  assert.equal(K.analyzeSketch(g, s).dof, 0);
  const { profiles, info } = K.geoProfiles(g, s);
  assert.equal(profiles.length, 1); assert.equal(info.open, 0);
  const doc = [{ id: 's', type: 'sketch', plane: 'XY', profiles: [], geo: g }, { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new' }];
  const exact = (Math.PI * 25 + 30 * 10) * 10;
  near(K.brepProps([...K.regenerateBrep(doc).bodies.values()][0]).volume, exact, 1e-4, 'exact kernel slot');
  near([...K.regenerate(doc).bodies.values()].reduce((a, b) => a + K.signedVolume(b.geom), 0), exact, 2, 'mesh kernel slot');
});

test('dragging a point keeps constraints and moves only what it must', () => {
  const g = rectGeo();
  g.cons.push({ id: 'c5', type: 'coincident', e: ['p1', 'O'] });
  let s = K.solveSketch(g);
  const g2 = K.applySolved(g, s);
  g2.points.find(p => p.id === 'p3').x = 70; g2.points.find(p => p.id === 'p3').y = 35;
  s = K.solveSketch(g2, { drag: new Set(['p3']) });
  assert.ok(s.ok);
  near(s.points.get('p3').x, 70, 1e-3, 'dragged corner follows the cursor'); near(s.points.get('p2').x, 70, 1e-3, 'right side follows');
  near(s.points.get('p1').x, 0, 1e-9, 'origin corner stays');
});

test('angle and perpendicular constraints', () => {
  const g = {
    points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 30, y: 2 }, { id: 'c', x: 5, y: 20 }],
    curves: [{ id: 'l1', kind: 'line', a: 'a', b: 'b' }, { id: 'l2', kind: 'line', a: 'a', b: 'c' }],
    cons: [{ id: 'k0', type: 'coincident', e: ['a', 'O'] }, { id: 'k1', type: 'horizontal', e: ['l1'] }, { id: 'k2', type: 'angle', e: ['l1', 'l2'], value: 60, sign: 1 }],
  };
  const s = K.solveSketch(g); assert.ok(s.ok);
  const c = s.points.get('c');
  near(Math.atan2(c.y, c.x) * 180 / Math.PI, 60, 1e-6, 'angle');
});

test('symmetry and point-to-line distance', () => {
  const g = {
    points: [{ id: 'a', x: -8, y: 3 }, { id: 'b', x: 11, y: 4 }, { id: 'm1', x: 0, y: -20 }, { id: 'm2', x: 0, y: 20 }],
    curves: [{ id: 'ax', kind: 'line', a: 'm1', b: 'm2', constr: true }],
    cons: [{ id: 'k0', type: 'vertical', e: ['ax'] }, { id: 'k1', type: 'coincident', e: ['m1', 'O'] }, { id: 'k2', type: 'symmetry', e: ['a', 'b', 'ax'] }, { id: 'k3', type: 'pdist', e: ['b', 'ax'], value: 15 }],
  };
  const s = K.solveSketch(g); assert.ok(s.ok);
  const a = s.points.get('a'), b = s.points.get('b');
  near(a.x, -15, 1e-6, 'mirrored x'); near(b.x, 15, 1e-6, 'distance to axis'); near(a.y, b.y, 1e-6, 'same height');
});

test('open paths are found in order', () => {
  const g = {
    points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 10 }],
    curves: [{ id: 'l2', kind: 'line', a: 'c', b: 'b' }, { id: 'l1', kind: 'line', a: 'a', b: 'b' }], cons: [],
  };
  const { paths } = K.geoPaths(g, K.solveSketch(g));
  assert.equal(paths.length, 1); assert.equal(paths[0].closed, false);
  assert.deepEqual(paths[0].segs.map(s => s.id), ['l2', 'l1']);
});

test('regions from crossing curves', () => {
  // two overlapping squares: 3 faces; even-odd fills the two outer parts, not the overlap
  const sq = (id, x, y, s) => ({
    points: [[0, 0], [s, 0], [s, s], [0, s]].map(([a, b], i) => ({ id: id + i, x: x + a, y: y + b })),
    curves: [0, 1, 2, 3].map(i => ({ id: id + 'l' + i, kind: 'line', a: id + i, b: id + ((i + 1) % 4) })),
  });
  const A = sq('a', 0, 0, 20), B = sq('b', 10, 10, 20);
  const g = { points: [...A.points, ...B.points], curves: [...A.curves, ...B.curves], cons: [] };
  const regs = K.geoRegions(g, K.solveSketch(g));
  assert.equal(regs.length, 3);
  const areas = regs.map(r => r.area).sort((x, y) => x - y);
  near(areas[0], 100, 1e-6, 'overlap'); near(areas[1], 300, 1e-6, 'L part'); near(areas[2], 300, 1e-6, 'L part');
  assert.equal(regs.filter(r => r.filled).length, 2);
  // picking the overlap by a point inside it
  const pick = K.pickRegions(regs, [{ x: 15, y: 15 }]);
  assert.equal(pick.length, 1); near(pick[0].area, 100, 1e-6, 'picked overlap');
});

test('circle crossing a line splits it; nested circle becomes a hole', () => {
  const g = {
    points: [{ id: 'c', x: 0, y: 0 }, { id: 'p', x: -20, y: 0 }, { id: 'q', x: 20, y: 0 }, { id: 'c2', x: 30, y: 30 }],
    curves: [{ id: 'k', kind: 'circle', c: 'c', r: 10 }, { id: 'l', kind: 'line', a: 'p', b: 'q' }, { id: 'big', kind: 'circle', c: 'c2', r: 8 }, { id: 'small', kind: 'circle', c: 'c2', r: 3 }],
    cons: [],
  };
  const regs = K.geoRegions(g, K.solveSketch(g));
  const areas = regs.map(r => r.area).sort((x, y) => x - y);
  // half disks (50π each), annulus (64π-9π outer face area counted as 64π... face area excludes nothing: its own cycle area), small disk 9π
  assert.equal(regs.length, 4);
  near(areas[0], 9 * Math.PI, 1e-6, 'small disk');
  near(areas[1], 50 * Math.PI, 1e-6, 'half disk'); near(areas[2], 50 * Math.PI, 1e-6, 'half disk');
  const ann = regs.find(r => Math.abs(r.area - 64 * Math.PI) < 1e-6);
  assert.ok(ann && ann.holes.length === 1, 'annulus has the small circle as a hole');
  assert.equal(regs.find(r => Math.abs(r.area - 9 * Math.PI) < 1e-6).filled, false, 'even-odd leaves the inner disk empty');
});

test('extrude a picked region from crossing shapes (exact)', () => {
  const sq = (id, x, y, s) => ({
    points: [[0, 0], [s, 0], [s, s], [0, s]].map(([a, b], i) => ({ id: id + i, x: x + a, y: y + b })),
    curves: [0, 1, 2, 3].map(i => ({ id: id + 'l' + i, kind: 'line', a: id + i, b: id + ((i + 1) % 4) })),
  });
  const A = sq('a', 0, 0, 20), B = sq('b', 10, 10, 20);
  const g = { points: [...A.points, ...B.points], curves: [...A.curves, ...B.curves], cons: [] };
  const sk = { id: 's', type: 'sketch', plane: 'XY', profiles: [], geo: g };
  let r = K.regenerateBrep([sk, { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new' }]);
  near(K.brepProps([...r.bodies.values()][0]).volume, 6000, 1e-6, 'default even-odd: two L shapes');
  r = K.regenerateBrep([sk, { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new', regions: [{ x: 5, y: 5 }, { x: 15, y: 15 }, { x: 25, y: 25 }] }]);
  near(K.brepProps([...r.bodies.values()][0]).volume, 7000, 1e-6, 'all three regions: the union');
  r = K.regenerate([sk, { id: 'e', type: 'extrude', sketch: 's', distance: 10, op: 'new', regions: [{ x: 15, y: 15 }] }]);
  near([...r.bodies.values()].reduce((a, b) => a + K.signedVolume(b.geom), 0), 1000, 0.5, 'mesh kernel: just the overlap');
});
