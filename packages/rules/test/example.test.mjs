// End to end: the bearing-bracket example project drives the real Draftwork design through @draftwork/core.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, applyToModel } from '../src/index.mjs';
import { loadProject } from '../src/node.mjs';
import { createEngine } from '@draftwork/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const { config, design } = await loadProject(path.join(here, '../examples/bearing-bracket/product.config.json'));
const project = compile(config);
const engine = await createEngine();

test('the example project compiles, and its own test cases pass with every branch covered', () => {
  assert.deepEqual(project.errors, []);
  const t = project.runTests();
  assert.equal(t.pass, true, JSON.stringify(t.results.filter(r => !r.pass)));
  assert.deepEqual(t.untested, []);
});

test('every shaft size and load builds a valid model whose size matches the rules', async () => {
  const sizes = project.evaluate({}).form.find(f => f.name === 'ShaftSize').options;
  assert.deepEqual(sizes, [10, 12, 15, 20]);
  for (const ShaftSize of sizes) for (const Load of ['Light', 'Heavy']) {
    const r = project.evaluate({ ShaftSize, Load, Material: 'Steel S275' });
    assert.equal(r.ok, true, JSON.stringify(r.messages));
    const model = engine.open(design);
    assert.deepEqual(applyToModel(r, model), []);
    const g = await model.rebuild();
    assert.equal(g.ok, true, `${ShaftSize} mm ${Load}: ${JSON.stringify(g.errors)}`);
    const p = r.model.params;
    assert.deepEqual(g.bbox.size.map(v => +v.toFixed(3)), [p.width, p.depth, p.thickness + p.boss_h], `${ShaftSize} mm ${Load}`);
  }
});

test('turning cover screws off suppresses the tap holes in the model', async () => {
  const build = async answers => { const m = engine.open(design); applyToModel(project.evaluate(answers), m); return m.rebuild(); };
  const withScrews = await build({ CoverScrews: true }), without = await build({ CoverScrews: false });
  const tapHole = Math.PI * 1.25 ** 2 * 8;   // M3 tap drill 2.5 mm, 8 deep (plus a drill point)
  const diff = without.volume - withScrews.volume;
  assert.ok(diff > 4 * tapHole && diff < 4 * tapHole * 1.2, `4 tap holes' worth of material: ${diff.toFixed(1)} mm³`);
});

test('a quote: price lines, discount and BOM for a batch', () => {
  const r = project.evaluate({ ShaftSize: 15, Material: 'Steel S275', CoverScrews: 'no', Quantity: 60 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.price.lines.map(l => l.line), ['Material', 'Machining', 'Bearings', 'Setup', 'Volume discount']);
  const sum = r.price.lines.reduce((s, l) => s + l.amount, 0);
  assert.ok(Math.abs(sum - r.price.total) < 0.005);
  const discount = r.price.lines.at(-1).amount, before = r.price.lines[0].amount + r.price.lines[1].amount;
  assert.ok(Math.abs(discount + 0.1 * before) < 0.02, '10% off material and machining at 60 off');
  assert.deepEqual(r.bom, [{ item: 'Bracket body, Steel S275', qty: 60, unit: 'ea' }, { item: 'Bearing 6002-2RS', qty: 60, unit: 'ea' }]);
  assert.equal(r.text.part_number, 'BB-15-M');
});

test('rules a design does not match are reported by applyToModel', () => {
  const m = engine.open(design);
  const fake = { model: { params: { width: 120, colour: 3 }, suppressed: { 'No such feature': true }, components: { hinge: 'x' } } };
  assert.deepEqual(applyToModel(fake, m), ['The design has no parameter "colour"', 'The design has no feature "No such feature"', 'Component choices are not applied yet: @draftwork/core does not swap derived components']);
});
