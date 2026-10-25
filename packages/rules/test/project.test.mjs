// Projects: compile-time checks, evaluation of every rule kind, dynamic form state, explain and test cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/index.mjs';

const gate = () => ({
  product: 'steel-gate', currency: 'KES',
  inputs: [
    { name: 'Opening', label: 'Opening width', type: 'number', unit: 'mm', min: 600, max: 4000, step: 10, default: 1200 },
    { name: 'Height', type: 'number', unit: 'mm', min: 900, max: 'MaxHeight', default: 1800 },
    { name: 'Material', type: 'choice', options: 'COLUMN(steel, "grade")', default: 'Mild' },
    { name: 'LockType', type: 'choice', options: ['None', 'Latch', 'Deadbolt'], default: 'None' },
    { name: 'Galvanised', type: 'boolean', default: false },
    { name: 'Colour', type: 'choice', options: ['Black', 'Green', 'Grey'], default: 'Black', visible: 'NOT Galvanised' },
    { name: 'Reference', type: 'text', required: false },
  ],
  tables: {
    steel: 'grade,kg_per_m,per_kg\nMild,4.5,180\nStainless,4.7,950\n',
    hinges: { columns: ['type', 'max_kg', 'cost'], rows: [['Std-Hinge', 80, 1200], ['HD-Hinge', 200, 3100]] },
  },
  variables: [
    { name: 'MaxHeight', expr: 'IF(Opening > 3000, 1800, 2400)' },
    { name: 'Clearance', expr: '10 mm' },
    { name: 'BarCount', expr: 'ROUNDUP(frame_w / 120) - 1' },
    { name: 'SteelM', expr: '(2 * frame_w + 2 * Height + BarCount * Height) / 1000' },
    { name: 'Weight', expr: 'SteelM * LOOKUP(steel, Material, "kg_per_m")' },
    { name: 'Hinge', expr: 'IF(Weight > 80, "HD-Hinge", "Std-Hinge")' },
  ],
  rules: [
    { kind: 'param', target: 'frame_w', expr: 'Opening - 2 * Clearance' },
    { kind: 'param', target: 'frame_h', expr: 'Height' },
    { kind: 'param', target: 'bar_count', expr: 'BarCount' },
    { kind: 'suppress', feature: 'Lock cutout', expr: 'LockType = "None"' },
    { kind: 'component', slot: 'hinge', expr: 'Hinge' },
    { kind: 'validate', level: 'error', expr: 'Weight <= 200', message: 'At {ROUND(Weight)} kg the gate is too heavy for any hinge' },
    { kind: 'validate', level: 'warning', expr: 'NOT (Material = "Stainless" AND Galvanised)', message: 'Stainless steel does not need galvanising' },
    { kind: 'bom', item: 'Steel bar 40x40', qty: 'ROUND(SteelM, 2)', unit: 'm' },
    { kind: 'bom', item: '=Hinge', qty: 2 },
    { kind: 'bom', item: 'Lock body', qty: 1, when: 'LockType <> "None"' },
    { kind: 'price', line: 'Steel', expr: 'Weight * LOOKUP(steel, Material, "per_kg")' },
    { kind: 'price', line: 'Hinges', expr: '2 * LOOKUP(hinges, Hinge, "cost")' },
    { kind: 'price', line: 'Galvanising', expr: 'Weight * 120', when: 'Galvanised' },
    { kind: 'price', line: 'Lock', expr: 'SWITCH(LockType, "Latch", 1500, "Deadbolt", 4200)', when: 'LockType <> "None"' },
    { kind: 'text', name: 'title', expr: '"Gate " & Opening & " x " & Height & " mm, " & Material' },
  ],
  tests: [
    { name: 'default gate', answers: {}, expect: { ok: true, frame_w: 1180, bar_count: 9, Hinge: 'HD-Hinge', 'model.suppressed.Lock cutout': true } },
    { name: 'wide stainless gate with deadbolt', answers: { Opening: 2400, Material: 'stainless', LockType: 'Deadbolt', Galvanised: 'yes' }, expect: { Hinge: 'HD-Hinge', 'model.suppressed.Lock cutout': false, messages: 'does not need galvanising' } },
    { name: 'light gate', answers: { Opening: 900, Height: 1200 }, expect: { Hinge: 'Std-Hinge', 'price.total': 12573.6 } },
    { name: 'too heavy', answers: { Opening: 4000, Height: 1800, Material: 'Stainless' }, expect: { ok: false, messages: 'too heavy' } },
  ],
});

test('a valid project compiles with no errors, in dependency order', () => {
  const p = compile(gate());
  assert.deepEqual(p.errors, []);
  assert.ok(p.order.indexOf('Opening') < p.order.indexOf('frame_w'));
  assert.ok(p.order.indexOf('frame_w') < p.order.indexOf('BarCount'));
  assert.equal(p.inputs.length, 7);
});

test('default answers drive params, suppression, components, BOM, price and text', () => {
  const r = compile(gate()).evaluate({});
  assert.equal(r.ok, true, JSON.stringify(r.messages));
  assert.deepEqual(r.model.params, { frame_w: 1180, frame_h: 1800, bar_count: 9 });
  assert.deepEqual(r.model.suppressed, { 'Lock cutout': true });
  // steel: 2*1180 + 2*1800 + 9*1800 = 22160 mm = 22.16 m; 22.16 * 4.5 = 99.72 kg
  assert.equal(r.values.SteelM, 22.16);
  assert.ok(Math.abs(r.values.Weight - 99.72) < 1e-9);
  assert.equal(r.model.components.hinge, 'HD-Hinge');
  assert.deepEqual(r.bom, [{ item: 'Steel bar 40x40', qty: 22.16, unit: 'm' }, { item: 'HD-Hinge', qty: 2, unit: 'ea' }]);
  assert.deepEqual(r.price.lines, [{ line: 'Steel', amount: 17949.6 }, { line: 'Hinges', amount: 6200 }]);
  assert.equal(r.price.total, 24149.6);
  assert.equal(r.price.currency, 'KES');
  assert.equal(r.text.title, 'Gate 1200 x 1800 mm, Mild');
});

test('answers: coercion, case-insensitive options, units in text, conditional lines', () => {
  const r = compile(gate()).evaluate({ Opening: '1.5 m', Material: 'stainless', LockType: 'Latch', Galvanised: 'no' });
  assert.equal(r.values.Opening, 1500);
  assert.equal(r.values.Material, 'Stainless', 'the option keeps its own spelling');
  assert.equal(r.model.suppressed['Lock cutout'], false);
  assert.deepEqual(r.bom.at(-1), { item: 'Lock body', qty: 1, unit: 'ea' });
  assert.deepEqual(r.price.lines.map(l => l.line), ['Steel', 'Hinges', 'Lock']);
});

test('the form: dynamic options, limits and visibility', () => {
  const p = compile(gate());
  const f = name => p.evaluate({ Opening: 3200, Galvanised: true }).form.find(x => x.name === name);
  assert.deepEqual(f('Material').options, ['Mild', 'Stainless']);
  assert.equal(f('Height').max, 1800, 'max height falls for wide gates');
  assert.equal(f('Colour').visible, false);
  const hidden = p.evaluate({ Galvanised: true, Colour: 'Green' });
  assert.equal(hidden.values.Colour, 'Black', 'a hidden input takes its default, whatever was answered');
  assert.equal(hidden.explain('Colour').from, 'hidden, so its default');
});

test('bad answers become messages, not exceptions', () => {
  const p = compile(gate());
  const r = p.evaluate({ Opening: 5000, Height: 'tall', LockType: 'Padlock', Extra: 1 });
  assert.equal(r.ok, false);
  const text = r.messages.map(m => `${m.level}: ${m.message}`);
  assert.ok(text.includes('error: Opening width: 5000 mm is above the maximum of 4000 mm'), text.join('\n'));
  assert.ok(text.includes('error: Height: "tall" is not a number'), text.join('\n'));
  assert.ok(text.some(t => t.startsWith('error: LockType: "Padlock" is not one of the options (None, Latch, Deadbolt)')), text.join('\n'));
  assert.ok(text.includes('warning: "Extra" is not an input of this product and was ignored'), text.join('\n'));
  assert.equal(r.values.Height, 1800, 'an unusable answer falls back to the default so the rest still evaluates');
  const step = p.evaluate({ Opening: 1205 });
  assert.ok(step.messages.some(m => /steps of 10 mm/.test(m.message)));
});

test('validation messages fill in values', () => {
  const r = compile(gate()).evaluate({ Opening: 4000, Height: 1800, Material: 'Stainless' });
  const m = r.messages.find(x => x.source.kind === 'validate');
  assert.match(m.message, /^At \d+ kg the gate is too heavy for any hinge$/);
  assert.equal(m.level, 'error');
  assert.equal(r.ok, false);
});

test('evaluation errors are reported once and do not cascade', () => {
  const c = gate();
  c.variables.push({ name: 'Ratio', expr: 'Opening / (Height - Height)' }, { name: 'Twice', expr: 'Ratio * 2' });
  c.rules.push({ kind: 'text', name: 'ratio', expr: 'Twice' });
  const r = compile(c).evaluate({});
  const errs = r.messages.filter(m => m.level === 'error');
  assert.equal(errs.length, 1, JSON.stringify(errs));
  assert.equal(errs[0].message, 'Variable Ratio: Division by zero');
  assert.equal(r.text.ratio, undefined);
  assert.equal(r.text.title, 'Gate 1200 x 1800 mm, Mild', 'unrelated rules still run');
});

test('compile reports unknown names with suggestions, bad formulas, duplicates and cycles', () => {
  const c = gate();
  c.variables.push(
    { name: 'A', expr: 'B + 1' }, { name: 'B', expr: 'C * 2' }, { name: 'C', expr: 'A - 1' },
    { name: 'Typo', expr: 'Openning + 1' },
    { name: 'Clearance', expr: '5' },
    { name: 'Broken', expr: 'ROUND(1, 2, 3) + (' },
    { name: 'NoTable', expr: 'LOOKUP(hinge, "x", "cost")' },
  );
  c.rules.push({ kind: 'paint', expr: '1' }, { kind: 'price', line: 'Missing expr' });
  const p = compile(c);
  const msgs = p.errors.map(e => e.message);
  assert.ok(msgs.includes('Unknown name "Openning" (did you mean "Opening"?)'), msgs.join('\n'));
  assert.ok(msgs.includes('"Clearance" is already defined as a variable'), msgs.join('\n'));
  assert.ok(msgs.some(m => /^Circular reference: (A|B|C) → .* → \1$/.test(m)), msgs.join('\n'));
  assert.ok(msgs.includes('The formula ends too early'), msgs.join('\n'));
  assert.ok(msgs.includes('Unknown table "hinge" (did you mean "hinges"?)'), msgs.join('\n'));
  assert.ok(msgs.some(m => m.startsWith('Unknown rule kind "paint"')), msgs.join('\n'));
  assert.ok(msgs.includes('A price rule needs expr'), msgs.join('\n'));
  const typo = p.errors.find(e => e.message.startsWith('Unknown name "Openning"'));
  assert.deepEqual([typo.section, typo.name, typo.field], ['variables', 'Typo', 'expr']);
  assert.throws(() => p.evaluate({}), /has \d+ error/);
});

test('explain traces a value back to the answers', () => {
  const r = compile(gate()).evaluate({ Opening: 2000 });
  const e = r.explain('Hinge');
  assert.equal(e.formula, 'IF(Weight > 80, "HD-Hinge", "Std-Hinge")');
  const flat = [];
  (function walk(n) { flat.push(n.name); (n.uses || []).forEach(walk); })(e);
  for (const n of ['Weight', 'SteelM', 'frame_w', 'Opening', 'Clearance', 'Material', 'Height']) assert.ok(flat.includes(n), `${n} in ${flat}`);
  const opening = (function find(n) { return n.name === 'Opening' ? n : (n.uses || []).map(find).find(Boolean); })(e);
  assert.deepEqual([opening.value, opening.from], [2000, 'answer']);
});

test('project test cases run, and untested branches are listed', () => {
  const p = compile(gate());
  const t = p.runTests();
  assert.equal(t.pass, true, JSON.stringify(t.results.filter(x => !x.pass)));
  assert.equal(t.results.length, 4);
  assert.deepEqual(t.untested, [], 'every suppress, validate and when rule was seen both ways');
  const fewer = p.runTests(gate().tests.slice(0, 1));
  assert.deepEqual(fewer.untested.sort(), ['bom:Lock body:when', 'price:Galvanising:when', 'price:Lock:when', 'suppress:Lock cutout', 'validate#6', 'validate#7']);
  const bad = p.runTests([{ name: 'wrong', answers: {}, expect: { frame_w: 1, messages: 'nope' } }]);
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.results[0].failures.map(f => f.split(':')[0]), ['frame_w', 'expected a message containing "nope"; got none']);
});

test('evaluation is fast enough to run on every keystroke', () => {
  const p = compile(gate());
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) p.evaluate({ Opening: 600 + (i % 300) * 10 });
  const per = (performance.now() - t0) / 1000;
  assert.ok(per < 2, `${per.toFixed(3)} ms per evaluation`);
});
