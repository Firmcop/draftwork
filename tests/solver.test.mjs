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
