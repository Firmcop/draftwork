// Plastic features: boss, snap fit, rest, lip/groove.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true });
const build = feats => K.regenerateBrep(K.resolveFeatures(feats, K.evalParams([]).vars));
const okAll = r => { const e = [...r.status.entries()].filter(([, s]) => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)}, expected ${b.toFixed(4)}`);
const vol = r => [...r.bodies.values()].reduce((s, b) => s + K.brepProps(b).volume, 0);
const plate = { id: 'p', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 60, d: 40, h: 2, op: 'new' };

test('boss: drafted cylinder with a blind hole, joined to the plate', () => {
  const r = build([plate, { id: 'b', type: 'boss', name: 'Boss', plane: 'XY', offset: 2, cx: 10, cy: 0, diameter: 8, holeDiameter: 3, height: 10, holeDepth: 8, draftAngle: 0, ribs: 0 }]); okAll(r);
  near(vol(r), 60 * 40 * 2 + Math.PI * 16 * 10 - Math.PI * 2.25 * 8, 1e-3, 'boss volume');
  const r2 = build([plate, { id: 'b', type: 'boss', name: 'Boss', plane: 'XY', offset: 2, cx: 10, cy: 0, diameter: 8, holeDiameter: 3, height: 10, draftAngle: 1, ribs: 4, ribThickness: 1, ribLength: 4, ribHeight: 6 }]); okAll(r2);
  assert.ok(vol(r2) > 60 * 40 * 2 + Math.PI * 16 * 10 * 0.8, 'boss with draft and ribs');
});
test('snap fit hook and rest pad', () => {
  const r = build([plate, { id: 's', type: 'snapfit', name: 'Snap', plane: 'XY', offset: 2, cx: 0, cy: 0, length: 12, thickness: 1.5, width: 6, hookDepth: 1, insertAngle: 30, orient: 0 }]); okAll(r);
  assert.ok(vol(r) > 60 * 40 * 2 + 12 * 1.5 * 6 * 0.9, 'hook added');
  const r2 = build([plate, { id: 'rs', type: 'rest', name: 'Rest', plane: 'XY', offset: 2, cx: -15, cy: 0, shape: 'rect', w: 10, d: 6, height: 3, draftAngle: 0 }]); okAll(r2);
  near(vol(r2), 60 * 40 * 2 + 10 * 6 * 3, 1e-6, 'rest pad');
  const r3 = build([plate, { id: 'rs', type: 'rest', name: 'Rest', plane: 'XY', offset: 2, cx: -15, cy: 0, shape: 'circle', diameter: 10, height: 3, draftAngle: 10 }]); okAll(r3);
  const R1 = 5, R2 = 5 - 3 * Math.tan(10 * Math.PI / 180);
  near(vol(r3) - 60 * 40 * 2, Math.PI * 3 / 3 * (R1 * R1 + R1 * R2 + R2 * R2), 1e-3, 'drafted round rest = frustum');
});
test('lip and groove on a shelled box rim', () => {
  const box = { id: 'bx', type: 'box', name: 'Case', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 40, d: 30, h: 20, op: 'new' };
  let r = build([box]);
  const top = [...K.brepSigMap([...r.bodies.values()][0], 'face').values()].find(s => s.type === 'PLANE' && Math.abs(s.c[2] - 20) < 1e-6);
  const shell = { id: 'sh', type: 'shell', name: 'Shell', edges: [top], thickness: 2 };
  r = build([box, shell]); okAll(r);
  const v0 = vol(r);
  const rim = [...K.brepSigMap([...r.bodies.values()][0], 'face').values()].find(s => s.type === 'PLANE' && Math.abs(s.c[2] - 20) < 1e-6);
  r = build([box, shell, { id: 'l', type: 'lip', name: 'Lip', edges: [rim], mode: 'lip', width: 1, height: 2, clearance: 0.1 }]); okAll(r);
  // inner opening 36 x 26; lip ring 1 mm wide outward from it (rounded corners): area = perimeter*1 + pi*1^2
  near(vol(r) - v0, ((36 + 26) * 2 * 1 + Math.PI) * 2, 1e-3, 'lip ring volume');
  r = build([box, shell, { id: 'g', type: 'lip', name: 'Groove', edges: [rim], mode: 'groove', width: 1, height: 2, clearance: 0.1 }]); okAll(r);
  near(v0 - vol(r), ((36 + 26) * 2 * 1.1 + Math.PI * 1.21) * 2.1, 1e-3, 'groove volume');
});
