// The rules expression language: values, operators, functions, tables and error messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, evaluate, analyze, ExprError } from '../src/index.mjs';

const hinges = { columns: ['type', 'max_kg', 'cost'], rows: [['Std-Hinge', 80, 12.5], ['HD-Hinge', 200, 31]] };
const breaks = { columns: ['qty', 'discount'], rows: [[1, 0], [10, 0.05], [50, 0.12]] };
const vars = { Opening: 1200, Clearance: 10, Weight: 95, LockType: 'Latch', Galv: true, Sizes: ['S', 'M', 'L'] };
const ctx = {
  get: n => { if (!(n in vars)) throw new ExprError(`Unknown name "${n}"`); return vars[n]; },
  table: n => ({ hinges, breaks })[n] || (() => { throw new ExprError(`Unknown table ${n}`); })(),
};
const ev = s => evaluate(parse(s), ctx);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `got ${a}, expected ${b}`);

test('arithmetic, precedence and power', () => {
  assert.equal(ev('Opening - 2 * Clearance'), 1180);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('2 ^ 3 ^ 2'), 512);
  assert.equal(ev('-2 ^ 2'), -4);
  assert.equal(ev('7 % 3'), 1);
  near(ev('1.5e2 / 4'), 37.5);
});

test('units convert to millimetres and degrees', () => {
  assert.equal(ev('2.5 cm + 10 mm'), 35);
  assert.equal(ev('1 in'), 25.4);
  assert.equal(ev('2m'), 2000);
  near(ev('SIN(30 deg)'), 0.5);
  near(ev('COS(30°) ^ 2 + SIN(30°) ^ 2'), 1);
});

test('text, comparison and case-insensitive equality', () => {
  assert.equal(ev('LockType <> "None"'), true);
  assert.equal(ev("LockType = 'latch'"), true);
  assert.equal(ev('"Gate " & Opening & " mm"'), 'Gate 1200 mm');
  assert.equal(ev('UPPER(LockType)'), 'LATCH');
  assert.equal(ev('"a" < "B"'), true);
  assert.equal(ev('TEXT(Opening / 7, 2)'), '171.43');
});

test('logic: IF, IFS, SWITCH, AND/OR/NOT, IN', () => {
  assert.equal(ev('IF(Weight > 80, "HD-Hinge", "Std-Hinge")'), 'HD-Hinge');
  assert.equal(ev('IFS(Weight < 50, "light", Weight < 100, "medium", "heavy")'), 'medium');
  assert.equal(ev('SWITCH(LockType, "None", 0, "Latch", 1, "Deadbolt", 2)'), 1);
  assert.equal(ev('Galv AND NOT (Weight > 100) OR FALSE'), true);
  assert.equal(ev('Weight > 50 && Weight < 100'), true);
  assert.equal(ev('LockType IN ("Latch", "Deadbolt")'), true);
  assert.equal(ev('LockType NOT IN ["Latch"]'), false);
  assert.equal(ev('"m" IN Sizes'), true);
  assert.equal(ev('IN(4, LIST(1, 2, 3))'), false);
  assert.equal(ev('IF(FALSE, ERROR("never evaluated"), 3)'), 3, 'IF only evaluates the branch it takes');
});

test('rounding and stepping', () => {
  assert.equal(ev('ROUNDUP(1180 / 120)'), 10);
  assert.equal(ev('ROUNDUP(0.1 * 3, 1)'), 0.3);
  assert.equal(ev('ROUNDDOWN(2.79, 1)'), 2.7);
  assert.equal(ev('ROUND(2.5)'), 3);
  assert.equal(ev('CEILING(1183, 50)'), 1200);
  assert.equal(ev('FLOOR(1183, 50)'), 1150);
  assert.equal(ev('MOD(-1, 3)'), 2);
  assert.equal(ev('CLAMP(5000, 600, 4000)'), 4000);
  assert.equal(ev('BETWEEN(Opening, 600, 4000)'), true);
  assert.equal(ev('MAX(1, LIST(4, 2), 3)'), 4);
  assert.equal(ev('SUM(1, 2, 3) / COUNT(1, 2, 3)'), 2);
});

test('tables: LOOKUP, RANGELOOKUP, COLUMN, defaults', () => {
  assert.equal(ev('LOOKUP(hinges, IF(Weight > 80, "HD-Hinge", "Std-Hinge"), "cost")'), 31);
  assert.equal(ev('LOOKUP(hinges, "hd-hinge", "MAX_KG")'), 200, 'keys and column names ignore case');
  assert.equal(ev('RANGELOOKUP(breaks, 12, "discount")'), 0.05);
  assert.equal(ev('RANGELOOKUP(breaks, 50, "discount")'), 0.12);
  assert.deepEqual(ev('COLUMN(hinges, "type")'), ['Std-Hinge', 'HD-Hinge']);
  assert.equal(ev('LOOKUP(hinges, "Gold", "cost", 0)'), 0);
  assert.throws(() => ev('LOOKUP(hinges, "Gold", "cost")'), /no row for text "Gold"/);
  assert.throws(() => ev('LOOKUP(hinges, "HD-Hinge", "colour")'), /no column "colour"/);
  assert.throws(() => ev('RANGELOOKUP(breaks, 0.5, "discount")'), /no row at or below 0.5/);
});

test('errors say what is wrong and where', () => {
  const err = (s, re) => assert.throws(() => ev(s), e => e instanceof ExprError && re.test(e.message) && typeof e.pos === 'number', s);
  err('1 +', /ends too early/);
  err('(1 + 2', /Expected "\)"/);
  err('"open', /closing quote/);
  err('2 $ 3', /Unexpected character "\$"/);
  err('1 / 0', /Division by zero/);
  err('LockType * 2', /Expected a number, got text "Latch"/);
  err('Nope + 1', /Unknown name "Nope"/);
  err('IFS(FALSE, 1)', /no condition was true/);
  err('ERROR("Opening too wide")', /Opening too wide/);
  assert.equal(parse('  1 + Nope').a.pos, 2);
});

test('analyze lists the names and tables a formula uses, and arity problems', () => {
  const a = analyze(parse('IF(Weight > Max, LOOKUP(hinges, Type, "cost"), ROUNDUP(Opening / Gap))'));
  assert.deepEqual(a.refs.sort(), ['Gap', 'Max', 'Opening', 'Type', 'Weight']);
  assert.deepEqual(a.tables, ['hinges']);
  assert.deepEqual(a.problems, []);
  const b = analyze(parse('IF(1) + FOO(2) + ROUND(1, 2, 3)'));
  assert.deepEqual(b.problems.map(p => p.message), ['IF takes 2 to 3 arguments, got 1', 'Unknown function FOO', 'ROUND takes 1 to 2 arguments, got 3']);
});
