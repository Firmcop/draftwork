// A configurator project: inputs (the form), variables, lookup tables and rules, compiled once and evaluated for each
// set of answers. Evaluation is pure and fast (no geometry): it returns the values to drive a Draftwork design with,
// validation messages, a bill of materials, a price and document text, plus an explanation for any value.
import { parse, evaluate, analyze, equal, display, ExprError } from './expr.mjs';

export const RULE_KINDS = ['param', 'suppress', 'component', 'validate', 'bom', 'price', 'text'];
const INPUT_TYPES = ['number', 'choice', 'boolean', 'text'];
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SKIP = Symbol('depends on a failed value');

/**
 * Compile a project. Never throws for problems in the project itself: they are listed in project.errors, each with
 * where it is ({ section, index, name, field }) so an editor can underline it. evaluate() refuses while errors exist.
 */
export function compile(config) {
  const p = new Project(config);
  p.build();
  return p;
}

class Project {
  constructor(config) {
    this.config = config || {};
    this.errors = [];
    this.nodes = new Map();      // name → { kind: 'input'|'variable'|'param', def, where, deps, ... }
    this.rules = [];             // compiled rules that do not define a name
    this.tables = new Map();
    this.order = [];
  }

  error(where, message, pos) { this.errors.push({ ...where, message, ...(pos != null ? { pos } : {}) }); }

  formula(src, where, field) {
    try {
      const ast = parse(src);
      const a = analyze(ast);
      for (const pr of a.problems) this.error({ ...where, field }, pr.message, pr.pos);
      return { src: String(src), ast, refs: a.refs, tables: a.tables, field, where };
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      this.error({ ...where, field }, e.message, e.pos);
      return null;
    }
  }

  // "{expr}" pieces inside a message; everything else is literal text
  template(src, where, field) {
    const parts = [], s = String(src ?? '');
    let i = 0;
    while (i < s.length) {
      const a = s.indexOf('{', i);
      if (a < 0) { parts.push(s.slice(i)); break; }
      const b = s.indexOf('}', a);
      if (b < 0) { this.error({ ...where, field }, 'A "{" in the text has no closing "}"'); break; }
      parts.push(s.slice(i, a));
      const f = this.formula(s.slice(a + 1, b), where, field);
      if (f) parts.push(f);
      i = b + 1;
    }
    return parts;
  }

  define(name, node) {
    if (!NAME_RE.test(name || '')) { this.error(node.where, `"${name}" is not a valid name: use letters, digits and _ and start with a letter`); return; }
    const clash = this.nodes.get(name);
    if (clash) { this.error(node.where, `"${name}" is already defined as ${article(clash.kind)} ${clash.kind}`); return; }
    this.nodes.set(name, node);
  }

  build() {
    const c = this.config;
    // tables
    for (const [name, t] of Object.entries(c.tables || {})) {
      const where = { section: 'tables', name };
      try { this.tables.set(name, normalizeTable(t)); } catch (e) { this.error(where, e.message); }
    }
    // inputs
    (c.inputs || []).forEach((inp, index) => {
      const where = { section: 'inputs', index, name: inp?.name };
      if (!inp || typeof inp !== 'object') { this.error(where, 'An input must be an object'); return; }
      const type = inp.type || 'number';
      if (!INPUT_TYPES.includes(type)) { this.error({ ...where, field: 'type' }, `Unknown input type "${type}" (use ${INPUT_TYPES.join(', ')})`); return; }
      const node = { kind: 'input', def: { ...inp, type }, where, formulas: {} };
      for (const field of ['visible', 'options', 'min', 'max', 'default']) {
        const v = inp[field];
        if (typeof v === 'string' && (field !== 'default' || v.startsWith('='))) {
          if (field === 'default' || field === 'visible' || field === 'options' || isNaN(Number(v))) {
            const f = this.formula(field === 'default' ? v.slice(1) : v, where, field);
            if (f) node.formulas[field] = f;
          }
        }
      }
      if (type === 'choice' && inp.options == null) this.error({ ...where, field: 'options' }, 'A choice input needs options: a list, or a formula such as COLUMN(table, "column")');
      this.define(inp.name, node);
    });
    // variables
    (c.variables || []).forEach((v, index) => {
      const where = { section: 'variables', index, name: v?.name };
      const f = this.formula(v?.expr, where, 'expr');
      this.define(v?.name, { kind: 'variable', def: v, where, formulas: f ? { expr: f } : {}, broken: !f });
    });
    // rules
    (c.rules || []).forEach((r, index) => {
      const where = { section: 'rules', index, name: r?.id || r?.target || r?.feature || r?.slot || r?.line || r?.item || r?.name };
      if (!r || !RULE_KINDS.includes(r.kind)) { this.error({ ...where, field: 'kind' }, `Unknown rule kind "${r?.kind}" (use ${RULE_KINDS.join(', ')})`); return; }
      const need = { param: ['target', 'expr'], suppress: ['feature', 'expr'], component: ['slot', 'expr'], validate: ['expr', 'message'], bom: ['item', 'qty'], price: ['line', 'expr'], text: ['name', 'expr'] }[r.kind];
      const missing = need.filter(k => r[k] == null || r[k] === '');
      if (missing.length) { this.error(where, `A ${r.kind} rule needs ${missing.join(' and ')}`); return; }
      const formulas = {};
      for (const field of ['expr', 'when', 'qty', 'item']) {
        if (r[field] == null) continue;
        if (field === 'item' && !String(r.item).startsWith('=')) continue;   // a plain item name, or "=formula"
        const f = this.formula(field === 'item' ? String(r.item).slice(1) : r[field], where, field);
        if (f) formulas[field] = f;
      }
      const compiled = { kind: r.kind, def: r, where, formulas, id: r.id || (where.name != null ? `${r.kind}:${where.name}` : `${r.kind}#${index + 1}`) };
      if (r.kind === 'validate') compiled.message = this.template(r.message, where, 'message');
      if (r.kind === 'param') this.define(r.target, { kind: 'param', def: r, where, formulas, broken: !formulas.expr });
      else this.rules.push(compiled);
    });

    // every name and table a formula uses must exist
    const allFormulas = [];
    for (const n of this.nodes.values()) allFormulas.push(...Object.values(n.formulas));
    for (const r of this.rules) { allFormulas.push(...Object.values(r.formulas)); if (r.message) allFormulas.push(...r.message.filter(x => typeof x === 'object')); }
    for (const f of allFormulas) {
      for (const name of f.refs) if (!this.nodes.has(name)) this.error({ ...f.where, field: f.field }, `Unknown name "${name}"${suggest(name, [...this.nodes.keys()])}`);
      for (const t of f.tables) if (!this.tables.has(t)) this.error({ ...f.where, field: f.field }, `Unknown table "${t}"${suggest(t, [...this.tables.keys()])}`);
    }
    // dependency order, with cycles reported as a path
    for (const [, n] of this.nodes) n.deps = [...new Set(Object.values(n.formulas).flatMap(f => f.refs))].filter(d => this.nodes.has(d));
    const state = new Map(), stack = [];
    const visit = name => {
      const s = state.get(name);
      if (s === 2) return;
      if (s === 1) {
        const cycle = [...stack.slice(stack.indexOf(name)), name];
        const n = this.nodes.get(name);
        this.error(n.where, `Circular reference: ${cycle.join(' → ')}`);
        return;
      }
      state.set(name, 1); stack.push(name);
      for (const d of this.nodes.get(name).deps) visit(d);
      stack.pop(); state.set(name, 2); this.order.push(name);
    };
    for (const name of this.nodes.keys()) visit(name);
  }

  get ok() { return this.errors.length === 0; }

  /** The form a person fills in: inputs in order with their static settings (dynamic ones come with evaluate()). */
  get inputs() { return [...this.nodes.values()].filter(n => n.kind === 'input').map(n => publicInput(n.def)); }

  /**
   * Evaluate the project for one set of answers ({ inputName: value }). Missing answers take their defaults.
   * Returns everything a configurator page, the model and a quote need; problems are messages, never exceptions.
   */
  evaluate(answers = {}) {
    if (!this.ok) throw new Error(`The project has ${this.errors.length} error(s); fix them first: ${this.errors.slice(0, 3).map(e => e.message).join('; ')}`);
    const values = new Map(), failed = new Set(), messages = [], how = new Map(), form = [];
    const tables = this.tables;
    const msg = (level, message, source) => messages.push({ level, message, source });
    const ctx = {
      get: name => { if (failed.has(name)) throw SKIP; if (!values.has(name)) throw new ExprError(`Unknown name "${name}"`); return values.get(name); },
      table: name => tables.get(name),
    };
    const run = (f, source) => {
      try { return { ok: true, v: evaluate(f.ast, ctx) }; } catch (e) {
        if (e === SKIP) return { ok: false, skipped: true };
        if (!(e instanceof ExprError)) throw e;
        msg('error', `${describe(source)}: ${e.message}`, source);
        return { ok: false };
      }
    };

    for (const name of Object.keys(answers)) {
      const n = this.nodes.get(name);
      if (!n || n.kind !== 'input') msg('warning', `"${name}" is not an input of this product and was ignored`, { kind: 'answer', name });
    }

    for (const name of this.order) {
      const n = this.nodes.get(name), source = { kind: n.kind, name };
      if (n.kind === 'input') {
        const r = this.evalInput(n, answers, run, msg);
        form.push(r.form);
        if (r.failed) { failed.add(name); continue; }
        values.set(name, r.value); how.set(name, { from: r.from });
        continue;
      }
      if (n.broken) { failed.add(name); continue; }
      const r = run(n.formulas.expr, source);
      if (!r.ok) { failed.add(name); continue; }
      if (n.kind === 'param' && typeof r.v !== 'number' && typeof r.v !== 'boolean') {
        msg('error', `${describe(source)}: a model parameter needs a number, got ${display(r.v) || 'blank'}`, source);
        failed.add(name); continue;
      }
      values.set(name, n.kind === 'param' ? +r.v : r.v);
    }

    const model = { params: {}, suppressed: {}, components: {} };
    for (const name of this.order) if (this.nodes.get(name).kind === 'param' && values.has(name)) model.params[name] = values.get(name);
    const bom = [], priceLines = [], text = {}, outcomes = new Map();
    const truth = (f, source) => { const r = run(f, source); if (!r.ok) return null; try { return toBool(r.v); } catch (e) { msg('error', `${describe(source)}: ${e.message}`, source); return null; } };
    for (const rule of this.rules) {
      const source = { kind: rule.kind, name: rule.where.name, rule: rule.id };
      const f = rule.formulas;
      if (f.when) { const w = truth(f.when, source); outcomes.set(rule.id + ':when', w); if (!w) continue; }
      switch (rule.kind) {
        case 'suppress': { const v = truth(f.expr, source); if (v !== null) { model.suppressed[rule.def.feature] = v; outcomes.set(rule.id, v); } break; }
        case 'component': { const r = run(f.expr, source); if (r.ok) model.components[rule.def.slot] = display(r.v); break; }
        case 'validate': {
          const v = truth(f.expr, source); if (v === null) break;
          outcomes.set(rule.id, v);
          if (!v) msg(rule.def.level === 'warning' ? 'warning' : rule.def.level === 'info' ? 'info' : 'error', this.fill(rule.message, run, source), source);
          break;
        }
        case 'bom': {
          const q = run(f.qty, source); if (!q.ok) break;
          let item = rule.def.item;
          if (f.item) { const r = run(f.item, source); if (!r.ok) break; item = display(r.v); }
          if (typeof q.v !== 'number' || !(q.v >= 0)) { msg('error', `${describe(source)}: quantity must be a number of 0 or more, got ${display(q.v)}`, source); break; }
          if (q.v > 0) bom.push({ item, qty: q.v, unit: rule.def.unit || 'ea', ...(rule.def.description ? { description: rule.def.description } : {}) });
          break;
        }
        case 'price': {
          const r = run(f.expr, source); if (!r.ok) break;
          if (typeof r.v !== 'number' || !Number.isFinite(r.v)) { msg('error', `${describe(source)}: a price line needs a number, got ${display(r.v)}`, source); break; }
          priceLines.push({ line: rule.def.line, amount: round2(r.v) });
          break;
        }
        case 'text': { const r = run(f.expr, source); if (r.ok) text[rule.def.name] = display(r.v); break; }
      }
    }
    const total = round2(priceLines.reduce((s, l) => s + l.amount, 0));
    const result = {
      ok: !messages.some(m => m.level === 'error'),
      values: Object.fromEntries(values),
      form,
      model,
      messages,
      bom,
      price: { currency: this.config.currency || null, lines: priceLines, total },
      text,
      explain: name => this.explain(name, values, how),
    };
    Object.defineProperty(result, 'outcomes', { value: outcomes, enumerable: false });
    return result;
  }

  evalInput(n, answers, run, msg) {
    const d = n.def, F = n.formulas, name = d.name, source = { kind: 'input', name };
    const form = { ...publicInput(d) };
    const dyn = (field, fallback) => {
      if (!F[field]) return { ok: true, v: d[field] ?? fallback };
      return run(F[field], { ...source, field });
    };
    const vis = dyn('visible', true);
    if (!vis.ok) return { failed: true, form };
    form.visible = toBoolSafe(vis.v, true);
    let options = null;
    if (d.type === 'choice') {
      const o = dyn('options', []);
      if (!o.ok) return { failed: true, form };
      options = (Array.isArray(o.v) ? o.v : [o.v]).filter(x => x !== null && x !== undefined && x !== '');
      form.options = options;
    }
    const lim = {};
    for (const k of ['min', 'max']) {
      if (d[k] == null) continue;
      const r = dyn(k);
      if (!r.ok) return { failed: true, form };
      lim[k] = typeof r.v === 'number' ? r.v : Number(r.v);
      form[k] = lim[k];
    }
    const def = dyn('default', null);
    if (!def.ok) return { failed: true, form };

    const has = Object.hasOwn(answers, name) && answers[name] !== null && answers[name] !== undefined && answers[name] !== '';
    let raw, from;
    if (!form.visible) { raw = def.v; from = 'hidden, so its default'; }
    else if (has) { raw = answers[name]; from = 'answer'; }
    else { raw = def.v; from = 'default'; }
    if (d.type === 'choice' && (raw === null || raw === undefined) && options.length) { raw = options[0]; from = 'first option'; }

    const bad = text => { msg('error', `${d.label || name}: ${text}`, source); };
    let value;
    try { value = coerce(d.type, raw); } catch (e) {
      bad(e.message);
      if (from !== 'answer') return { failed: true, form };
      try { value = coerce(d.type, def.v ?? (options?.[0] ?? null)); from = 'default (the answer was not usable)'; } catch (e2) { return { failed: true, form }; }
    }
    if (value === null) {
      if (d.required !== false) bad('needs a value');
      return { failed: true, form };
    }
    if (d.type === 'number') {
      if (lim.min != null && value < lim.min - 1e-9) bad(`${display(value)}${d.unit ? ' ' + d.unit : ''} is below the minimum of ${display(lim.min)}${d.unit ? ' ' + d.unit : ''}`);
      if (lim.max != null && value > lim.max + 1e-9) bad(`${display(value)}${d.unit ? ' ' + d.unit : ''} is above the maximum of ${display(lim.max)}${d.unit ? ' ' + d.unit : ''}`);
      if (d.step) { const k = (value - (lim.min ?? 0)) / d.step; if (Math.abs(k - Math.round(k)) > 1e-6) bad(`must be in steps of ${display(d.step)}${d.unit ? ' ' + d.unit : ''}`); }
    }
    if (d.type === 'choice') {
      const hit = options.find(o => equal(o, value));
      if (hit === undefined) bad(`"${display(value)}" is not one of the options (${options.map(display).join(', ')})`);
      else value = hit;   // the option's own spelling
    }
    form.value = value;
    return { value, from, form };
  }

  fill(parts, run, source) {
    return parts.map(p => {
      if (typeof p === 'string') return p;
      const r = run(p, source);
      return r.ok ? display(r.v) : '?';
    }).join('');
  }

  explain(name, values, how, depth = 0, seen = new Set()) {
    const n = this.nodes.get(name);
    if (!n) return null;
    const out = { name, kind: n.kind, value: values.has(name) ? values.get(name) : null };
    if (n.kind === 'input') out.from = how.get(name)?.from || 'not available';
    else out.formula = n.formulas.expr?.src;
    if (n.kind === 'input' && n.formulas.visible) out.visibleWhen = n.formulas.visible.src;
    if (depth < 12 && !seen.has(name)) {
      seen.add(name);
      const uses = n.deps.map(d => this.explain(d, values, how, depth + 1, seen)).filter(Boolean);
      if (uses.length) out.uses = uses;
    }
    return out;
  }

  /**
   * Run the project's test cases: [{ name, answers, expect: { Name: value, ok: bool, "price.total": n, ... } }].
   * Also reports suppress/validate/when rules whose outcome never changed across the tests (untested branches).
   */
  runTests(tests = this.config.tests || []) {
    const results = [], seen = new Map();
    for (const t of tests) {
      const failures = [];
      let r;
      try { r = this.evaluate(t.answers || {}); } catch (e) { results.push({ name: t.name, pass: false, failures: [e.message] }); continue; }
      for (const [id, v] of r.outcomes) { if (v === null) continue; if (!seen.has(id)) seen.set(id, new Set()); seen.get(id).add(v); }
      for (const [key, want] of Object.entries(t.expect || {})) {
        if (key === 'messages') {
          for (const m of [].concat(want)) if (!r.messages.some(x => x.message.toLowerCase().includes(String(m).toLowerCase()))) failures.push(`expected a message containing "${m}"; got ${r.messages.map(x => `"${x.message}"`).join(', ') || 'none'}`);
          continue;
        }
        const got = Object.hasOwn(r.values, key) ? r.values[key] : path(r, key);
        if (!same(got, want)) failures.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
      results.push({ name: t.name, pass: failures.length === 0, failures });
    }
    const branchy = this.rules.filter(r => r.kind === 'suppress' || r.kind === 'validate').map(r => r.id).concat(this.rules.filter(r => r.formulas.when).map(r => r.id + ':when'));
    const untested = branchy.filter(id => (seen.get(id)?.size || 0) < 2);
    return { pass: results.every(x => x.pass), results, untested };
  }
}

function coerce(type, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (type) {
    case 'number': {
      if (typeof raw === 'number') { if (!Number.isFinite(raw)) throw new Error('must be a finite number'); return raw; }
      if (typeof raw === 'string') {
        let v;
        try { v = evaluate(parse(raw), { get: n => { throw new ExprError(`"${n}" is not a number`); }, table: () => { throw new ExprError('no tables here'); } }); }
        catch (e) { throw new Error(`"${raw}" is not a number`); }
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`"${raw}" is not a number`);
        return v;
      }
      throw new Error(`expected a number, got ${typeof raw}`);
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 1 || raw === 0) return !!raw;
      const s = String(raw).trim().toLowerCase();
      if (['yes', 'true', 'y', '1', 'on'].includes(s)) return true;
      if (['no', 'false', 'n', '0', 'off'].includes(s)) return false;
      throw new Error(`"${raw}" is not yes or no`);
    }
    case 'choice': if (typeof raw === 'string' || typeof raw === 'number') return raw; throw new Error('expected one of the options');
    case 'text': return typeof raw === 'string' ? raw : String(raw);
  }
  return raw;
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  throw new ExprError(`expected yes/no, got ${display(v) || 'blank'}`);
}
const toBoolSafe = (v, fallback) => { try { return toBool(v); } catch (e) { return fallback; } };

export function normalizeTable(t) {
  if (typeof t === 'string') return parseCSV(t);
  if (t && typeof t.csv === 'string') return parseCSV(t.csv);
  if (t && Array.isArray(t.columns) && Array.isArray(t.rows)) {
    for (const [i, r] of t.rows.entries()) if (!Array.isArray(r) || r.length !== t.columns.length) throw new Error(`Row ${i + 1} has ${Array.isArray(r) ? r.length : 0} cells; the table has ${t.columns.length} columns`);
    return { columns: t.columns.map(String), rows: t.rows };
  }
  throw new Error('A table is CSV text, { csv }, or { columns, rows }');
}

/** CSV with a header row; quoted cells may hold commas and doubled quotes; numeric cells become numbers. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false, quoted = false;
  const s = String(text).replace(/^﻿/, '');
  const endCell = () => { const t = quoted ? cell : cell.trim(); row.push(!quoted && t !== '' && !isNaN(Number(t)) ? Number(t) : t); cell = ''; quoted = false; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell.trim() === '') { q = true; quoted = true; cell = ''; }
    else if (c === ',') endCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; endCell(); if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { endCell(); if (row.some(x => x !== '')) rows.push(row); }
  if (!rows.length) throw new Error('The table is empty');
  const columns = rows.shift().map(String);
  rows.forEach((r, i) => { if (r.length !== columns.length) throw new Error(`Row ${i + 2} has ${r.length} cells; the header has ${columns.length}`); });
  return { columns, rows };
}

function publicInput(d) {
  const out = { name: d.name, label: d.label || d.name, type: d.type };
  for (const k of ['unit', 'group', 'help', 'step']) if (d[k] != null) out[k] = d[k];
  if (Array.isArray(d.options)) out.options = d.options;
  for (const k of ['min', 'max']) if (typeof d[k] === 'number') out[k] = d[k];
  return out;
}
const article = w => /^[aeiou]/.test(w) ? 'an' : 'a';
const describe = s => s.kind === 'input' ? `Input ${s.name}${s.field ? ` (${s.field})` : ''}` : s.kind === 'param' ? `Parameter ${s.name}` : s.kind === 'variable' ? `Variable ${s.name}` : `${s.kind[0].toUpperCase() + s.kind.slice(1)} rule ${s.name ?? ''}`.trim();
const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
function path(obj, key) { return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') return equal(a, b);
  return JSON.stringify(a) === JSON.stringify(b);
}
function suggest(name, names) {
  let best = null, bd = Infinity;
  for (const n of names) { const d = lev(name.toLowerCase(), n.toLowerCase()); if (d < bd) { bd = d; best = n; } }
  return best && bd <= Math.max(2, Math.floor(name.length / 3)) ? ` (did you mean "${best}"?)` : '';
}
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
