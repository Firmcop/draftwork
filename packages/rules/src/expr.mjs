// The rules expression language: spreadsheet-like formulas over numbers (with units), text, yes/no values and lists.
//
//   Opening - 2 * Clearance          IF(Weight > 80, "HD-Hinge", "Std-Hinge")
//   LockType <> "None"               LOOKUP(hinges, HingeType, "cost")
//   2.5 cm + 10 mm                   ROUNDUP(Width / MaxGap)
//   Finish IN ("Galvanised", "Powder coat")
//
// Lengths are millimetres and angles degrees, as in Draftwork; a unit after a number converts it (25.4 mm = 1 in).
// Text compares without regard to case. parse() turns text into a tree once; evaluate() runs it many times.

export class ExprError extends Error {
  constructor(message, pos) { super(message); this.name = 'ExprError'; this.pos = pos; }
}

export const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, deg: 1, rad: 180 / Math.PI };

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IN', 'TRUE', 'FALSE']);

// ---------- lexer ----------
function lex(src) {
  const s = String(src), toks = [];
  let i = 0;
  const push = (type, value, pos) => toks.push({ type, value, pos });
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    const start = i;
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      let value = parseFloat(num[0]);
      // optional unit right after the number: "25 mm", "2.5cm", "30 deg", "30°"
      if (s[i] === '°') { i++; }
      else {
        const u = /^\s*([A-Za-z]+)/.exec(s.slice(i));
        if (u && Object.hasOwn(UNITS, u[1]) && !/^\s*\(/.test(s.slice(i + u[0].length))) { value *= UNITS[u[1]]; i += u[0].length; }
      }
      push('num', value, start); continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, out = '';
      while (j < s.length && s[j] !== c) { if (s[j] === '\\' && j + 1 < s.length) { out += s[j + 1]; j += 2; } else out += s[j++]; }
      if (j >= s.length) throw new ExprError('Text is missing its closing quote', start);
      i = j + 1; push('str', out, start); continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const up = id[0].toUpperCase();
      if (KEYWORDS.has(up) && s[i] !== '(') push('kw', up, start);
      else push('id', id[0], start);
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(two)) { i += 2; push('op', two, start); continue; }
    if ('+-*/^%(),[]<>=!&'.includes(c)) { i++; push('op', c, start); continue; }
    throw new ExprError(`Unexpected character "${c}"`, start);
  }
  push('end', null, s.length);
  return toks;
}

// ---------- parser (precedence climbing) ----------
// node: { t: 'num'|'str'|'bool'|'list'|'ref'|'call'|'un'|'bin'|'in', ... , pos }
export function parse(src) {
  if (src == null || String(src).trim() === '') throw new ExprError('Empty formula', 0);
  const toks = lex(src);
  let k = 0;
  const peek = () => toks[k], next = () => toks[k++];
  const isOp = (...v) => peek().type === 'op' && v.includes(peek().value);
  const isKw = v => peek().type === 'kw' && peek().value === v;
  const expect = v => { const t = next(); if (t.type !== 'op' || t.value !== v) throw new ExprError(`Expected "${v}"`, t.pos); return t; };

  function orExpr() {
    let a = andExpr();
    while (isKw('OR') || isOp('||')) { const t = next(); a = { t: 'bin', op: 'OR', a, b: andExpr(), pos: t.pos }; }
    return a;
  }
  function andExpr() {
    let a = notExpr();
    while (isKw('AND') || isOp('&&')) { const t = next(); a = { t: 'bin', op: 'AND', a, b: notExpr(), pos: t.pos }; }
    return a;
  }
  function notExpr() {
    if (isKw('NOT') || isOp('!')) { const t = next(); return { t: 'un', op: 'NOT', a: notExpr(), pos: t.pos }; }
    return cmpExpr();
  }
  function cmpExpr() {
    let a = catExpr();
    for (;;) {
      if (isOp('=', '==', '<>', '!=', '<', '<=', '>', '>=')) {
        const t = next(), op = { '==': '=', '!=': '<>' }[t.value] || t.value;
        a = { t: 'bin', op, a, b: catExpr(), pos: t.pos };
      } else if (isKw('IN') || (isKw('NOT') && toks[k + 1]?.type === 'kw' && toks[k + 1].value === 'IN')) {
        const neg = isKw('NOT'); if (neg) next();
        const t = next();
        a = { t: 'in', a, list: catExpr(), neg, pos: t.pos };
      } else return a;
    }
  }
  function catExpr() {
    let a = addExpr();
    while (isOp('&')) { const t = next(); a = { t: 'bin', op: '&', a, b: addExpr(), pos: t.pos }; }
    return a;
  }
  function addExpr() {
    let a = mulExpr();
    while (isOp('+', '-')) { const t = next(); a = { t: 'bin', op: t.value, a, b: mulExpr(), pos: t.pos }; }
    return a;
  }
  function mulExpr() {
    let a = unary();
    while (isOp('*', '/', '%')) { const t = next(); a = { t: 'bin', op: t.value, a, b: unary(), pos: t.pos }; }
    return a;
  }
  function unary() {
    if (isOp('-', '+')) { const t = next(); return { t: 'un', op: t.value, a: unary(), pos: t.pos }; }
    return power();
  }
  function power() {
    const a = primary();
    if (isOp('^')) { const t = next(); return { t: 'bin', op: '^', a, b: unary(), pos: t.pos }; }   // right-associative
    return a;
  }
  function args(close) {
    const out = [];
    if (isOp(close)) { next(); return out; }
    for (;;) { out.push(orExpr()); if (isOp(',')) { next(); continue; } expect(close); return out; }
  }
  function primary() {
    const t = next();
    if (t.type === 'num') return { t: 'num', v: t.value, pos: t.pos };
    if (t.type === 'str') return { t: 'str', v: t.value, pos: t.pos };
    if (t.type === 'kw' && (t.value === 'TRUE' || t.value === 'FALSE')) return { t: 'bool', v: t.value === 'TRUE', pos: t.pos };
    if (t.type === 'id') {
      if (isOp('(')) { next(); return { t: 'call', fn: t.value.toUpperCase(), args: args(')'), pos: t.pos }; }
      if (/^pi$/i.test(t.value)) return { t: 'num', v: Math.PI, pos: t.pos };
      return { t: 'ref', name: t.value, pos: t.pos };
    }
    if (t.type === 'op' && t.value === '(') {
      const items = args(')');
      if (items.length === 0) throw new ExprError('Empty brackets', t.pos);
      return items.length === 1 ? items[0] : { t: 'list', items, pos: t.pos };
    }
    if (t.type === 'op' && t.value === '[') return { t: 'list', items: args(']'), pos: t.pos };
    if (t.type === 'end') throw new ExprError('The formula ends too early', t.pos);
    throw new ExprError(`Unexpected "${t.value}"`, t.pos);
  }

  const tree = orExpr();
  if (peek().type !== 'end') throw new ExprError(`Unexpected "${peek().value}"`, peek().pos);
  return tree;
}

// ---------- functions ----------
// arity: [min, max]; tableArg: index of an argument that names a table (a bare name, not a value)
export const FUNCTIONS = {
  IF: { arity: [2, 3], lazy: true },
  IFS: { arity: [2, 64], lazy: true },
  SWITCH: { arity: [3, 64], lazy: true },
  AND: { arity: [1, 64] }, OR: { arity: [1, 64] }, NOT: { arity: [1, 1] },
  MIN: { arity: [1, 64] }, MAX: { arity: [1, 64] }, SUM: { arity: [1, 64] }, AVERAGE: { arity: [1, 64] }, COUNT: { arity: [1, 64] },
  ABS: { arity: [1, 1] }, SQRT: { arity: [1, 1] }, EXP: { arity: [1, 1] }, LN: { arity: [1, 1] }, LOG10: { arity: [1, 1] },
  ROUND: { arity: [1, 2] }, ROUNDUP: { arity: [1, 2] }, ROUNDDOWN: { arity: [1, 2] },
  CEILING: { arity: [1, 2] }, FLOOR: { arity: [1, 2] }, MOD: { arity: [2, 2] }, POWER: { arity: [2, 2] },
  SIN: { arity: [1, 1] }, COS: { arity: [1, 1] }, TAN: { arity: [1, 1] }, ASIN: { arity: [1, 1] }, ACOS: { arity: [1, 1] }, ATAN: { arity: [1, 1] }, ATAN2: { arity: [2, 2] },
  BETWEEN: { arity: [3, 3] }, CLAMP: { arity: [3, 3] },
  IN: { arity: [2, 2] }, LIST: { arity: [0, 64] }, ITEM: { arity: [2, 2] },
  LEN: { arity: [1, 1] }, UPPER: { arity: [1, 1] }, LOWER: { arity: [1, 1] }, TRIM: { arity: [1, 1] },
  CONCAT: { arity: [1, 64] }, TEXT: { arity: [1, 2] }, VALUE: { arity: [1, 1] }, CONTAINS: { arity: [2, 2] },
  LOOKUP: { arity: [3, 4], tableArg: 0 }, RANGELOOKUP: { arity: [3, 4], tableArg: 0 }, COLUMN: { arity: [2, 2], tableArg: 0 },
  ISBLANK: { arity: [1, 1] }, ERROR: { arity: [1, 1] },
};

const typeName = v => v === null || v === undefined ? 'blank' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? `text "${v}"` : typeof v === 'boolean' ? 'yes/no' : 'a number';
function num(v, pos, what = 'a number') {
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new ExprError('The result is not a finite number', pos); return v; }
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new ExprError(`Expected ${what}, got ${typeName(v)}`, pos);
}
function bool(v, pos) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  throw new ExprError(`Expected yes/no, got ${typeName(v)}`, pos);
}
function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(+v.toFixed(10));
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Array.isArray(v)) return v.map(str).join(', ');
  return v;
}
export function equal(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (typeof a === 'boolean' || typeof b === 'boolean') return (typeof a === 'boolean' || typeof a === 'number') && (typeof b === 'boolean' || typeof b === 'number') && !!a === !!b;
  return a === b;
}
function compare(a, b, pos) {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, undefined, { sensitivity: 'accent' });
  return num(a, pos) - num(b, pos);
}
const flatArgs = vals => vals.flatMap(v => Array.isArray(v) ? v : [v]);
const roundTo = (f, x, d = 0) => { const m = 10 ** d; return f(+(x * m).toFixed(9)) / m; };   // toFixed: 0.1*3*10 is 3.0000000000000004
const RAD = Math.PI / 180;

// ---------- evaluation ----------
// ctx: { get(name) → value, table(name) → { rows, columns }, call?(name, args) for extra functions }
export function evaluate(node, ctx) {
  switch (node.t) {
    case 'num': case 'str': case 'bool': return node.v;
    case 'list': return node.items.map(n => evaluate(n, ctx));
    case 'ref':
      try { return ctx.get(node.name, node.pos); } catch (e) { if (e instanceof ExprError && e.pos == null) e.pos = node.pos; throw e; }
    case 'un': {
      const a = evaluate(node.a, ctx);
      if (node.op === 'NOT') return !bool(a, node.pos);
      return node.op === '-' ? -num(a, node.pos) : num(a, node.pos);
    }
    case 'in': {
      const a = evaluate(node.a, ctx), list = evaluate(node.list, ctx);
      const hit = (Array.isArray(list) ? list : [list]).some(x => equal(a, x));
      return node.neg ? !hit : hit;
    }
    case 'bin': {
      if (node.op === 'AND') return bool(evaluate(node.a, ctx), node.pos) && bool(evaluate(node.b, ctx), node.pos);
      if (node.op === 'OR') return bool(evaluate(node.a, ctx), node.pos) || bool(evaluate(node.b, ctx), node.pos);
      const a = evaluate(node.a, ctx), b = evaluate(node.b, ctx);
      switch (node.op) {
        case '+': return num(a, node.pos) + num(b, node.pos);
        case '-': return num(a, node.pos) - num(b, node.pos);
        case '*': return num(a, node.pos) * num(b, node.pos);
        case '/': { const d = num(b, node.pos); if (d === 0) throw new ExprError('Division by zero', node.pos); return num(a, node.pos) / d; }
        case '%': { const d = num(b, node.pos); if (d === 0) throw new ExprError('Division by zero', node.pos); return num(a, node.pos) % d; }
        case '^': return num(a, node.pos) ** num(b, node.pos);
        case '&': return str(a) + str(b);
        case '=': return equal(a, b);
        case '<>': return !equal(a, b);
        case '<': return compare(a, b, node.pos) < 0;
        case '<=': return compare(a, b, node.pos) <= 0;
        case '>': return compare(a, b, node.pos) > 0;
        case '>=': return compare(a, b, node.pos) >= 0;
      }
      throw new ExprError(`Unknown operator ${node.op}`, node.pos);
    }
    case 'call': return call(node, ctx);
  }
  throw new ExprError('Unknown expression', node.pos);
}

function call(node, ctx) {
  const { fn, args, pos } = node;
  const ev = i => evaluate(args[i], ctx);
  switch (fn) {
    case 'IF': return bool(ev(0), pos) ? ev(1) : (args.length > 2 ? ev(2) : false);
    case 'IFS': {
      for (let i = 0; i + 1 < args.length; i += 2) if (bool(ev(i), args[i].pos)) return ev(i + 1);
      if (args.length % 2) return ev(args.length - 1);   // odd count: the last one is the "otherwise" value
      throw new ExprError('IFS: no condition was true', pos);
    }
    case 'SWITCH': {
      const v = ev(0);
      for (let i = 1; i + 1 < args.length; i += 2) if (equal(v, ev(i))) return ev(i + 1);
      if (args.length % 2 === 0) return ev(args.length - 1);
      throw new ExprError(`SWITCH: no case matches ${typeName(v)}`, pos);
    }
  }
  if (FUNCTIONS[fn]?.tableArg === 0) return tableCall(node, ctx);
  const v = args.map((a, i) => ev(i));
  const n = i => num(v[i], args[i].pos);
  const nums = () => flatArgs(v).map(x => num(x, pos));
  switch (fn) {
    case 'AND': return flatArgs(v).every(x => bool(x, pos));
    case 'OR': return flatArgs(v).some(x => bool(x, pos));
    case 'NOT': return !bool(v[0], pos);
    case 'MIN': return Math.min(...nums());
    case 'MAX': return Math.max(...nums());
    case 'SUM': return nums().reduce((s, x) => s + x, 0);
    case 'AVERAGE': { const xs = nums(); return xs.reduce((s, x) => s + x, 0) / xs.length; }
    case 'COUNT': return flatArgs(v).length;
    case 'ABS': return Math.abs(n(0));
    case 'SQRT': { const x = n(0); if (x < 0) throw new ExprError('SQRT of a negative number', pos); return Math.sqrt(x); }
    case 'EXP': return Math.exp(n(0));
    case 'LN': return Math.log(n(0));
    case 'LOG10': return Math.log10(n(0));
    case 'ROUND': return roundTo(Math.round, n(0), args[1] ? n(1) : 0);
    case 'ROUNDUP': return roundTo(Math.ceil, n(0), args[1] ? n(1) : 0);
    case 'ROUNDDOWN': return roundTo(Math.floor, n(0), args[1] ? n(1) : 0);
    case 'CEILING': { const s = args[1] ? n(1) : 1; if (s === 0) return n(0); return Math.ceil(+(n(0) / s).toFixed(9)) * s; }
    case 'FLOOR': { const s = args[1] ? n(1) : 1; if (s === 0) return n(0); return Math.floor(+(n(0) / s).toFixed(9)) * s; }
    case 'MOD': { const d = n(1); if (d === 0) throw new ExprError('Division by zero', pos); return ((n(0) % d) + d) % d; }
    case 'POWER': return n(0) ** n(1);
    case 'SIN': return Math.sin(n(0) * RAD);
    case 'COS': return Math.cos(n(0) * RAD);
    case 'TAN': return Math.tan(n(0) * RAD);
    case 'ASIN': return Math.asin(n(0)) / RAD;
    case 'ACOS': return Math.acos(n(0)) / RAD;
    case 'ATAN': return Math.atan(n(0)) / RAD;
    case 'ATAN2': return Math.atan2(n(0), n(1)) / RAD;
    case 'BETWEEN': return n(0) >= n(1) && n(0) <= n(2);
    case 'CLAMP': return Math.min(Math.max(n(0), n(1)), n(2));
    case 'IN': return (Array.isArray(v[1]) ? v[1] : [v[1]]).some(x => equal(v[0], x));
    case 'LIST': return flatArgs(v);
    case 'ITEM': { const list = Array.isArray(v[0]) ? v[0] : [v[0]], i = n(1); if (!Number.isInteger(i) || i < 1 || i > list.length) throw new ExprError(`ITEM: position ${i} is outside 1–${list.length}`, pos); return list[i - 1]; }
    case 'LEN': return Array.isArray(v[0]) ? v[0].length : str(v[0]).length;
    case 'UPPER': return str(v[0]).toUpperCase();
    case 'LOWER': return str(v[0]).toLowerCase();
    case 'TRIM': return str(v[0]).trim();
    case 'CONCAT': return flatArgs(v).map(str).join('');
    case 'TEXT': return args[1] ? n(0).toFixed(Math.max(0, Math.min(10, n(1)))) : str(v[0]);
    case 'VALUE': { if (typeof v[0] === 'number') return v[0]; const x = parseFloat(str(v[0])); if (!Number.isFinite(x)) throw new ExprError(`VALUE: "${str(v[0])}" is not a number`, pos); return x; }
    case 'CONTAINS': return str(v[0]).toLowerCase().includes(str(v[1]).toLowerCase());
    case 'ISBLANK': return v[0] === null || v[0] === undefined || v[0] === '';
    case 'ERROR': throw new ExprError(str(v[0]), pos);
  }
  if (ctx.call) return ctx.call(fn, v, pos);
  throw new ExprError(`Unknown function ${fn}`, pos);
}

// LOOKUP(table, key, column[, default]): the row whose first column equals key.
// RANGELOOKUP(table, value, column[, default]): the row with the largest first-column value <= value (price breaks, sizes).
// COLUMN(table, column): every value in a column, as a list (for choice options).
function tableCall(node, ctx) {
  const { fn, args, pos } = node;
  const tname = tableName(args[0]);
  const table = ctx.table(tname, args[0].pos);
  const col = (name, p) => {
    const c = String(name);
    const idx = table.columns.findIndex(x => equal(x, c));
    if (idx < 0) throw new ExprError(`Table ${tname} has no column "${c}"`, p);
    return idx;
  };
  if (fn === 'COLUMN') { const c = col(evaluate(args[1], ctx), args[1].pos); return table.rows.map(r => r[c]); }
  const key = evaluate(args[1], ctx), c = col(evaluate(args[2], ctx), args[2].pos);
  let row;
  if (fn === 'LOOKUP') row = table.rows.find(r => equal(r[0], key));
  else {
    const x = num(key, args[1].pos);
    for (const r of table.rows) if (typeof r[0] === 'number' && r[0] <= x + 1e-9 && (!row || r[0] > row[0])) row = r;
  }
  if (!row) {
    if (args.length > 3) return evaluate(args[3], ctx);
    throw new ExprError(fn === 'LOOKUP' ? `Table ${tname} has no row for ${typeName(key)}` : `Table ${tname} has no row at or below ${str(key)}`, pos);
  }
  return row[c];
}
export function tableName(node) {
  if (node.t === 'ref') return node.name;
  if (node.t === 'str') return node.v;
  throw new ExprError('The first argument names a table', node.pos);
}

// ---------- static checks ----------
// Names a formula reads (not counting table names), and problems found without evaluating it.
export function analyze(node) {
  const refs = new Set(), tables = new Set(), problems = [];
  (function walk(n) {
    switch (n.t) {
      case 'ref': refs.add(n.name); return;
      case 'list': n.items.forEach(walk); return;
      case 'un': walk(n.a); return;
      case 'bin': walk(n.a); walk(n.b); return;
      case 'in': walk(n.a); walk(n.list); return;
      case 'call': {
        const f = FUNCTIONS[n.fn];
        if (!f) problems.push({ message: `Unknown function ${n.fn}`, pos: n.pos });
        else if (n.args.length < f.arity[0] || n.args.length > f.arity[1]) {
          const [lo, hi] = f.arity;
          problems.push({ message: `${n.fn} takes ${lo === hi ? lo : hi >= 64 ? `${lo} or more` : `${lo} to ${hi}`} argument${hi === 1 ? '' : 's'}, got ${n.args.length}`, pos: n.pos });
        }
        n.args.forEach((a, i) => {
          if (f?.tableArg === i) { try { tables.add(tableName(a)); } catch (e) { problems.push({ message: e.message, pos: a.pos }); } }
          else walk(a);
        });
      }
    }
  })(node);
  return { refs: [...refs], tables: [...tables], problems };
}

/** Format a value the way a person would read it in a form or a report. */
export function display(v) { return str(v); }
