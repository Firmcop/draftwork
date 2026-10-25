// draftwork-core: the headless API gives the same geometry as the modeler's kernel and exports real files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, viewSVG, zip } from '../src/index.mjs';
import { sampleDoc } from '../../../tests/load-kernels.mjs';

const engine = await createEngine();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)}, expected ${b.toFixed(3)} ± ${tol}`);
const SAMPLE_VOLUME = 82866.3;   // the same figure tests/brep.test.mjs checks against the modeler's kernel

test('sample bracket rebuilds headless with the modeler kernel volume', async () => {
  const m = engine.open(sampleDoc());
  const r = await m.rebuild();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.bodies.length, 1);
  near(r.volume, SAMPLE_VOLUME, 0.5, 'volume');
  assert.deepEqual(r.bbox.size.map(v => Math.round(v)), [100, 60, 35]);
});

test('parameters drive the model and the original document is untouched', async () => {
  const doc = sampleDoc(), m = engine.open(doc);
  await m.rebuild();
  m.setParams({ boss_h: 35, width: '120 mm' });
  const r = await m.rebuild();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  near(r.volume - SAMPLE_VOLUME, Math.PI * 400 * 10 - Math.PI * 36 * 10 + 20 * 60 * 10, 1, 'taller boss and wider plate');
  assert.deepEqual(r.bbox.size.map(v => Math.round(v)), [120, 60, 45]);
  assert.equal(doc.params.find(p => p.name === 'boss_h').expr, '25');
  assert.equal(m.parameters().find(p => p.name === 'width').value, 120);
});

test('suppression by name, and the modeler configuration rules apply', async () => {
  const m = engine.open(sampleDoc());
  const full = (await m.rebuild()).volume;
  m.setSuppressed({ 'Bolt circle': true, 'M3 tap hole': true });
  const noTaps = (await m.rebuild()).volume;
  assert.ok(noTaps > full, 'removing tap holes adds material back');

  const d = sampleDoc();
  d.configRules = [{ feature: 'h3', expr: 'boss_d < 50' }, { feature: 'pt2', expr: 'boss_d < 50' }];
  const ruled = await engine.open(d).rebuild();
  near(ruled.volume, noTaps, 1e-6, 'rule suppresses the same features');
});

test('bad input reports errors instead of throwing', async () => {
  const m = engine.open(sampleDoc());
  assert.throws(() => m.setParams({ nope: 1 }), /Unknown parameter/);
  assert.throws(() => m.setSuppressed({ nope: true }), /Unknown feature/);
  m.setParams({ thickness: 'thickness_typo * 2' });
  const r = await m.rebuild();
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].kind, 'parameter');
  assert.equal(r.errors[0].name, 'thickness');
});

test('exports STEP, STL, drawing views and a zip', async () => {
  const m = engine.open(sampleDoc());
  await m.rebuild();
  const step = new TextDecoder().decode(await m.export('step'));
  assert.match(step, /^ISO-10303-21;/);
  assert.match(step, /MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION/);
  const stl = await m.export('stl');
  const tris = new DataView(stl.buffer, stl.byteOffset).getUint32(80, true);
  assert.ok(tris > 100 && stl.length === 84 + tris * 50, 'binary STL with a triangle count matching its size');
  const views = await m.project(['front', 'top', 'iso']);
  for (const k of ['front', 'top', 'iso']) assert.ok(views[k].vis.length > 0, `${k} view has visible edges`);
  // the front view frame holds the part: 100 wide, 35 tall, y down (top of the boss at y = -35)
  const vb = /viewBox="([^"]+)"/.exec(viewSVG(views.front, { margin: 0 }))[1].split(' ').map(Number);
  vb.forEach((v, i) => near(v, [-50, -35, 100, 35].at(i), 1e-3, 'front viewBox ' + i));
  const z = await zip([{ name: 'part.step', data: step }, { name: 'front.svg', data: viewSVG(views.front) }]);
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b);   // "PK"
});

test('sheet metal flat pattern exports DXF', async () => {
  const d = {
    version: 2, name: 'Bracket', units: 'mm', params: [{ name: 't', expr: '2' }, { name: 'w', expr: '80' }],
    features: [
      { id: 'sk', type: 'sketch', name: 'Flange profile', plane: 'XY', offset: 0, profiles: [{ id: 'p', kind: 'rect', cx: 0, cy: 0, w: 'w', h: 40, r: 0, rot: 0 }] },
      { id: 'bf', type: 'flange', name: 'Base flange', sketch: 'sk', thickness: 't', bendRadius: 2, kFactor: 0.5, edges: [] },
    ],
  };
  const m = engine.open(d), r = await m.rebuild();
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  near(r.volume, 80 * 40 * 2, 1e-6, 'plate volume');
  assert.equal(r.sheetMetal[0].body, r.bodies[0].id);
  const fp = await m.flatPattern();
  near(fp.size[0], 80, 1e-6, 'flat x');
  const dxf = await m.export('dxf-flat');
  assert.match(dxf, /SECTION[\s\S]*ENTITIES[\s\S]*LINE[\s\S]*EOF/);
});
