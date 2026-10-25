// ===== Product Configurator: author a configurable product on this design (inputs, tables, formulas, rules, tests),
// try it against the live model, and export it for @draftwork/rules + @draftwork/core. The rules engine is DWR
// (packages/rules, bundled by scripts/build.mjs). The product is stored with the design as doc.product.
const PROD_TABS = [['inputs', 'Form'], ['tables', 'Tables'], ['variables', 'Variables'], ['rules', 'Rules'], ['tests', 'Tests'], ['try', 'Try it']];
const PROD_KINDS = { param: 'Set parameter', suppress: 'Suppress feature', component: 'Choose component', validate: 'Check', bom: 'BOM line', price: 'Price line', text: 'Text' };
let prodTab = 'inputs', prodAnswers = {}, prodLive = false, prodWork = null, prodLastTest = null, prodExplain = '';

const blankProduct = () => ({ version: 1, currency: '', inputs: [], tables: {}, variables: [], rules: [], tests: [] });
function prodConfig(work) { return { product: doc.name || 'product', ...work }; }
function prodCompile(work) {
  let project;
  try { project = DWR.compile(prodConfig(work)); } catch (e) { return { project: null, errors: [{ section: 'project', message: e.message }] }; }
  let defaults = null;
  if (project.ok) { try { defaults = project.evaluate({}); } catch (e) { /* listed in errors */ } }
  return { project, errors: project.errors, defaults };
}

function openProduct() {
  if (typeof DWR === 'undefined') { toast('The rules engine is not part of this build'); return; }
  const before = JSON.stringify(doc.product || null);
  prodWork = doc.product ? JSON.parse(before) : blankProduct();
  for (const k of ['inputs', 'variables', 'rules', 'tests']) prodWork[k] ||= [];
  prodWork.tables ||= {};
  if (!prodWork.inputs.length) prodTab = 'inputs';   // a new product starts where it is set up
  const names = new Set(prodWork.inputs.map(i => i.name));   // answers from another design's product do not carry over
  prodAnswers = Object.fromEntries(Object.entries(prodAnswers).filter(([k]) => names.has(k)));
  prodLastTest = null;
  const body = h('div', { class: 'prod' });
  const close = save => {
    if (save) {
      const after = JSON.stringify(prodWork);
      if (after !== before) { checkpoint(); doc.product = JSON.parse(after); persist(); toast('Product saved with the design'); }
    }
    $('#modal').classList.remove('wide'); closeModal();
  };
  const draw = () => prodDraw(body, draw);
  openModal('Product Configurator', 'configure', body, [
    h('button', { class: 'btn', onclick: () => prodImport(draw) }, 'Import…'),
    h('button', { class: 'btn', onclick: () => prodExport() }, 'Export…'),
    h('button', { class: 'btn ok', onclick: () => close(true) }, 'OK'),
    h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel')]);
  $('#modal').classList.add('wide');
  draw();
}

function prodDraw(body, draw) {
  const W = prodWork, C = prodCompile(W);
  const count = sec => C.errors.filter(e => e.section === sec).length;
  const tabs = h('div', { class: 'seg prodtabs', role: 'tablist' }, ...PROD_TABS.map(([id, label]) => {
    const n = count(id);
    return h('button', { role: 'tab', 'aria-pressed': String(prodTab === id), 'aria-selected': String(prodTab === id), onclick: () => { prodTab = id; draw(); } }, label, n ? h('span', { class: 'prodbadge', 'aria-label': n + ' problems' }, String(n)) : null);
  }));
  const status = h('span', { class: 'prodstatus note' + (C.errors.length ? ' bad' : W.inputs.length ? ' ok' : ''), role: 'status' },
    C.errors.length ? `${C.errors.length} problem${C.errors.length > 1 ? 's' : ''} to fix` : (W.inputs.length ? 'No problems: ready to try and export' : 'Start by capturing a parameter as an input'));
  const pane = h('div', { class: 'tablewrap prodpane' });
  const sec = { inputs: prodInputs, tables: prodTables, variables: prodVariables, rules: prodRules, tests: prodTests, try: prodTry }[prodTab];
  sec(pane, C, draw);
  body.replaceChildren(h('div', { class: 'prodhead' }, tabs, status), pane);
}

// problems for one section, listed above its table; rows with problems are marked
function prodProblems(C, section) {
  const list = C.errors.filter(e => e.section === section || (section === 'inputs' && e.section === 'project'));
  if (!list.length) return null;
  return h('ul', { class: 'prodprobs' }, ...list.map(e => h('li', {}, (e.name != null ? `${e.name}${e.field ? ' · ' + e.field : ''}: ` : '') + e.message)));
}
const rowErr = (C, section, i) => C.errors.filter(e => e.section === section && e.index === i);
const errAttrs = errs => errs.length ? { class: 'err', title: errs.map(e => e.message).join('\n') } : {};
const prodCols = widths => h('colgroup', {}, ...widths.map(w => h('col', w ? { style: `width:${w}px` } : {})));
const pin = (value, onchange, attrs = {}) => h('input', { value: value ?? '', title: value != null && String(value).length > 24 ? String(value) : null, spellcheck: 'false', onchange: e => onchange(e.target.value.trim()), ...attrs });
const numOrText = s => s === '' ? undefined : (!isNaN(Number(s)) ? Number(s) : s);
const showVal = v => v === undefined || v === null ? '' : typeof v === 'number' ? String(+v.toFixed(4)) : DWR.display(v);

// ---------- Form (inputs) ----------
function prodInputs(pane, C, draw) {
  const W = prodWork;
  const rows = W.inputs.map((inp, i) => {
    const set = (k, v) => { if (v === undefined || v === '') delete inp[k]; else inp[k] = v; draw(); };
    const optText = Array.isArray(inp.options) ? inp.options.join(', ') : typeof inp.options === 'string' ? '=' + inp.options : '';
    const type = inp.type || 'number';
    return h('tr', errAttrs(rowErr(C, 'inputs', i)),
      h('td', {}, pin(inp.name, v => set('name', v), { 'aria-label': 'Input name' })),
      h('td', {}, pin(inp.label, v => set('label', v), { 'aria-label': 'Label', placeholder: inp.name })),
      h('td', {}, h('select', { 'aria-label': 'Type', onchange: e => set('type', e.target.value) }, ...['number', 'choice', 'boolean', 'text'].map(t => h('option', { value: t, selected: type === t }, t)))),
      h('td', {}, pin(inp.unit, v => set('unit', v || undefined), { 'aria-label': 'Unit', placeholder: type === 'number' ? 'mm' : '', disabled: type !== 'number' })),
      h('td', {}, type === 'boolean'
        ? h('select', { 'aria-label': 'Default', onchange: e => set('default', e.target.value === 'yes') }, h('option', { value: 'yes', selected: inp.default === true }, 'yes'), h('option', { value: 'no', selected: inp.default !== true }, 'no'))
        : pin(inp.default, v => set('default', type === 'text' ? v : numOrText(v)), { 'aria-label': 'Default' })),
      h('td', {}, pin(inp.min, v => set('min', numOrText(v)), { 'aria-label': 'Minimum', disabled: type !== 'number' })),
      h('td', {}, pin(inp.max, v => set('max', numOrText(v)), { 'aria-label': 'Maximum', disabled: type !== 'number' })),
      h('td', {}, pin(optText, v => set('options', v.startsWith('=') ? v.slice(1).trim() : v ? v.split(',').map(x => x.trim()).filter(Boolean).map(x => isNaN(Number(x)) ? x : Number(x)) : undefined), { 'aria-label': 'Options', placeholder: type === 'choice' ? 'A, B, C  or  =COLUMN(t, "c")' : '', disabled: type !== 'choice' })),
      h('td', {}, pin(inp.visible, v => set('visible', v || undefined), { 'aria-label': 'Visible when', placeholder: 'always' })),
      h('td', {}, h('button', { class: 'iconbtn', 'aria-label': 'Delete ' + (inp.name || 'input'), onclick: () => { W.inputs.splice(i, 1); draw(); }, html: icon('delete') })));
  });
  // capture: a design parameter becomes an input plus the rule that drives the parameter from it
  const driven = new Set(W.rules.filter(r => r.kind === 'param').map(r => r.target));
  const free = doc.params.filter(p => !driven.has(p.name));
  const cap = h('select', { 'aria-label': 'Capture a parameter' }, h('option', { value: '' }, free.length ? 'Capture parameter…' : 'All parameters are driven'), ...free.map(p => h('option', { value: p.name }, `${p.name} = ${p.expr}`)));
  cap.addEventListener('change', () => { if (cap.value) { prodCapture(cap.value); draw(); } });
  pane.append(
    h('p', { class: 'note' }, 'The questions a customer answers. Capture a design parameter to make an input that drives it, or add inputs that rules use. Min, max, options and "visible when" can be formulas.'),
    prodProblems(C, 'inputs') || '',
    h('table', { class: 'grid prodgrid fixed' }, prodCols([120, 150, 100, 64, 110, 80, 80, null, 150, 40]),
      h('thead', {}, h('tr', {}, ...['Name', 'Label', 'Type', 'Unit', 'Default', 'Min', 'Max', 'Options', 'Visible when', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '10', class: 'note' }, 'No inputs yet.')))),
    h('div', { class: 'row prodbar' }, h('button', { class: 'btn', onclick: () => { W.inputs.push({ name: prodFreeName('Input'), type: 'number', default: 0 }); draw(); } }, '+ Input'), cap,
      h('label', { class: 'prodcur' }, 'Currency ', pin(W.currency, v => { W.currency = v; draw(); }, { 'aria-label': 'Currency', placeholder: 'e.g. KES', size: '6' }))));
}
function prodFreeName(base) {
  const used = new Set([...prodWork.inputs.map(i => i.name), ...prodWork.variables.map(v => v.name), ...prodWork.rules.filter(r => r.kind === 'param').map(r => r.target), ...doc.params.map(p => p.name)]);
  let n = base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'Input', k = 2;
  if (!used.has(n)) return n;
  while (used.has(n + k)) k++;
  return n + k;
}
function prodCapture(name) {
  const p = doc.params.find(q => q.name === name); if (!p) return;
  const inName = prodFreeName(name[0].toUpperCase() + name.slice(1));
  const v = params.vars[name];
  const inp = { name: inName, label: p.comment || name, type: 'number', unit: 'mm', default: Number.isFinite(v) ? +v.toFixed(6) : 0 };
  if (Number.isFinite(v) && v > 0) { inp.min = +(v / 2).toFixed(3); inp.max = +(v * 2).toFixed(3); }
  prodWork.inputs.push(inp);
  prodWork.rules.push({ kind: 'param', target: name, expr: inName });
}

// ---------- Tables ----------
function prodTables(pane, C, draw) {
  const W = prodWork;
  const blocks = Object.entries(W.tables).map(([name, t]) => {
    let status;
    try { const n = DWR.normalizeTable(t); status = h('span', { class: 'note' }, `${n.columns.length} columns (${n.columns.join(', ')}) · ${n.rows.length} rows`); }
    catch (e) { status = h('span', { class: 'note bad' }, e.message); }
    const csv = typeof t === 'string' ? t : t.csv ?? prodToCSV(t);
    const rename = v => {
      if (!v || v === name) return;
      if (W.tables[v]) { toast(`There is already a table called ${v}`); draw(); return; }
      const out = {}; for (const [k, x] of Object.entries(W.tables)) out[k === name ? v : k] = x; W.tables = out; draw();
    };
    const errs = C.errors.filter(e => e.section === 'tables' && e.name === name);
    return h('div', { class: 'prodtable' + (errs.length ? ' err' : '') },
      h('div', { class: 'row' }, pin(name, rename, { 'aria-label': 'Table name' }), status,
        h('button', { class: 'iconbtn', 'aria-label': 'Delete table ' + name, onclick: () => { delete W.tables[name]; draw(); }, html: icon('delete') })),
      h('textarea', { rows: String(Math.min(12, Math.max(4, csv.split('\n').length + 1))), spellcheck: 'false', 'aria-label': 'Table ' + name + ' as CSV', onchange: e => { W.tables[name] = { csv: e.target.value }; draw(); } }, csv));
  });
  pane.append(
    h('p', { class: 'note' }, 'Lookup tables as CSV, header row first. Use them in formulas with LOOKUP(table, key, "column"), RANGELOOKUP(table, value, "column") for price breaks and sizes, and COLUMN(table, "column") for a choice list.'),
    prodProblems(C, 'tables') || '',
    ...(blocks.length ? blocks : [h('p', { class: 'note' }, 'No tables yet.')]),
    h('div', { class: 'row prodbar' },
      h('button', { class: 'btn', onclick: () => { let n = 'table', k = 1; while (W.tables[n + k]) k++; W.tables[n + k] = { csv: 'key,value\nA,1\nB,2\n' }; draw(); } }, '+ Table'),
      h('button', { class: 'btn', onclick: async () => {
        const got = await pickFile('.csv,text/csv'); if (!got) return;
        let n = got.file.name.replace(/\.csv$/i, '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'table';
        while (W.tables[n]) n += '_2';
        W.tables[n] = { csv: got.data }; draw();
      } }, 'Import CSV…')));
}
function prodToCSV(t) {
  const n = DWR.normalizeTable(t), q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [n.columns, ...n.rows].map(r => r.map(q).join(',')).join('\n') + '\n';
}

// ---------- Variables ----------
function prodVariables(pane, C, draw) {
  const W = prodWork, vals = C.defaults?.values || {};
  const rows = W.variables.map((v, i) => h('tr', errAttrs(rowErr(C, 'variables', i)),
    h('td', {}, pin(v.name, x => { v.name = x; draw(); }, { 'aria-label': 'Variable name' })),
    h('td', { class: 'wide' }, pin(v.expr, x => { v.expr = x; draw(); }, { 'aria-label': 'Formula', placeholder: 'e.g. Opening - 2 * Clearance' })),
    h('td', { class: 'num' }, showVal(vals[v.name])),
    h('td', {}, h('button', { class: 'iconbtn', 'aria-label': 'Delete ' + (v.name || 'variable'), onclick: () => { W.variables.splice(i, 1); draw(); }, html: icon('delete') }))));
  pane.append(
    h('p', { class: 'note' }, 'Named formulas that other formulas use. Values are shown for the default answers.'),
    prodProblems(C, 'variables') || '',
    h('table', { class: 'grid prodgrid fixed' }, prodCols([170, null, 160, 40]), h('thead', {}, h('tr', {}, ...['Name', 'Formula', 'Value now', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '4', class: 'note' }, 'No variables yet.')))),
    h('div', { class: 'row prodbar' }, h('button', { class: 'btn', onclick: () => { W.variables.push({ name: prodFreeName('Value'), expr: '0' }); draw(); } }, '+ Variable')));
}

// ---------- Rules ----------
function prodRules(pane, C, draw) {
  const W = prodWork, d = C.defaults;
  const rows = W.rules.map((r, i) => {
    const set = (k, v) => { if (v === undefined || v === '') delete r[k]; else r[k] = v; draw(); };
    const fkey = r.kind === 'bom' ? 'qty' : 'expr';
    let target;
    if (r.kind === 'param') {
      const names = doc.params.map(p => p.name); if (r.target && !names.includes(r.target)) names.push(r.target);
      target = h('select', { 'aria-label': 'Parameter', onchange: e => set('target', e.target.value) }, h('option', { value: '' }, '—'), ...names.map(n => h('option', { value: n, selected: r.target === n }, n)));
    } else if (r.kind === 'suppress') {
      target = h('select', { 'aria-label': 'Feature', onchange: e => set('feature', e.target.value) }, h('option', { value: '' }, '—'),
        ...doc.features.map(f => h('option', { value: f.id, selected: r.feature === f.id || r.feature === f.name }, f.name)));
    } else if (r.kind === 'validate') {
      target = h('select', { 'aria-label': 'Level', onchange: e => set('level', e.target.value) }, ...['error', 'warning', 'info'].map(l => h('option', { value: l, selected: (r.level || 'error') === l }, l)));
    } else {
      const key = { component: 'slot', bom: 'item', price: 'line', text: 'name' }[r.kind];
      target = pin(r[key], v => set(key, v), { 'aria-label': { slot: 'Component slot', item: 'Item (or =formula)', line: 'Price line', name: 'Text name' }[key], placeholder: { slot: 'slot', item: 'item or =formula', line: 'line', name: 'name' }[key] });
    }
    const details = r.kind === 'validate' ? pin(r.message, v => set('message', v), { 'aria-label': 'Message', placeholder: 'Message, {formula} is filled in' })
      : r.kind === 'bom' ? pin(r.unit, v => set('unit', v), { 'aria-label': 'Unit', placeholder: 'ea' }) : '';
    return h('tr', errAttrs(rowErr(C, 'rules', i)),
      h('td', {}, h('select', { 'aria-label': 'Rule kind', onchange: e => { const k = e.target.value; W.rules[i] = { kind: k, [k === 'bom' ? 'qty' : 'expr']: r[fkey] ?? '' }; draw(); } }, ...Object.entries(PROD_KINDS).map(([k, l]) => h('option', { value: k, selected: r.kind === k }, l)))),
      h('td', {}, target),
      h('td', { class: 'wide' }, pin(r[fkey], v => set(fkey, v), { 'aria-label': r.kind === 'bom' ? 'Quantity' : r.kind === 'validate' ? 'Must be true' : r.kind === 'suppress' ? 'Suppress when' : 'Formula' })),
      h('td', {}, pin(r.when, v => set('when', v), { 'aria-label': 'Only when', placeholder: 'always' })),
      h('td', {}, details),
      h('td', { class: 'num' }, prodNow(r, d)),
      h('td', { class: 'nowrap' },
        h('button', { class: 'iconbtn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [W.rules[i - 1], W.rules[i]] = [W.rules[i], W.rules[i - 1]]; draw(); }, html: '↑' }),
        h('button', { class: 'iconbtn', 'aria-label': 'Delete rule', onclick: () => { W.rules.splice(i, 1); draw(); }, html: icon('delete') })));
  });
  const add = h('select', { 'aria-label': 'Add a rule' }, h('option', { value: '' }, '+ Rule…'), ...Object.entries(PROD_KINDS).map(([k, l]) => h('option', { value: k }, l)));
  add.addEventListener('change', () => { const k = add.value; if (!k) return; W.rules.push({ kind: k, [k === 'bom' ? 'qty' : 'expr']: k === 'suppress' || k === 'validate' ? 'FALSE' : k === 'bom' ? '1' : '0' }); draw(); });
  pane.append(
    h('p', { class: 'note' }, 'Rules turn answers into the model and the paperwork: set a parameter, suppress a feature, check the answers, add BOM and price lines, write text. "Now" shows the result for the default answers.'),
    prodProblems(C, 'rules') || '',
    h('table', { class: 'grid prodgrid fixed' }, prodCols([150, 170, null, 150, 190, 130, 64]), h('thead', {}, h('tr', {}, ...['Rule', 'Target', 'Formula', 'Only when', 'Details', 'Now', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '7', class: 'note' }, 'No rules yet. Capturing a parameter on the Form tab adds one.')))),
    h('div', { class: 'row prodbar' }, add));
}
function prodNow(r, d) {
  if (!d) return '';
  const v = d.byRule.get(prodRuleId(r));
  if (v === undefined || v === null) return '';
  if (v && v.off) return 'off';
  switch (r.kind) {
    case 'suppress': return v ? 'suppressed' : 'kept';
    case 'validate': return v ? 'passes' : 'fails';
    case 'bom': return `${showVal(v.qty)} × ${v.item}`;
  }
  return showVal(v);
}
function prodRuleId(r) {
  const i = prodWork.rules.indexOf(r), name = r.id || r.target || r.feature || r.slot || r.line || r.item || r.name;
  return name != null ? `${r.kind}:${name}` : `${r.kind}#${i + 1}`;
}

// ---------- Try it ----------
function prodTry(pane, C, draw) {
  if (!C.project?.ok) { pane.append(h('p', { class: 'note bad' }, 'Fix the problems on the other tabs to try the product.'), ...C.errors.slice(0, 8).map(e => h('p', { class: 'note' }, `${e.section}${e.name ? ' · ' + e.name : ''}: ${e.message}`))); return; }
  const r = C.project.evaluate(prodAnswers);
  const answer = (name, v) => { prodAnswers = { ...prodAnswers, [name]: v }; if (prodLive) prodApply(C.project.evaluate(prodAnswers), true); draw(); };
  const fields = r.form.filter(f => f.visible !== false).map(f => {
    const id = 'prodf-' + f.name;
    let ctl;
    if (f.type === 'choice') ctl = h('select', { id, onchange: e => { const o = f.options[e.target.selectedIndex]; answer(f.name, o); } }, ...(f.options || []).map(o => h('option', { selected: DWR.display(o) === DWR.display(f.value) }, DWR.display(o) + (f.unit ? ' ' + f.unit : ''))));
    else if (f.type === 'boolean') ctl = h('input', { id, type: 'checkbox', checked: !!f.value, onchange: e => answer(f.name, e.target.checked) });
    else ctl = h('input', { id, value: f.value ?? '', spellcheck: 'false', onchange: e => answer(f.name, f.type === 'number' ? numOrText(e.target.value.trim()) ?? '' : e.target.value) });
    const range = f.type === 'number' && (f.min != null || f.max != null) ? `${f.min ?? ''}–${f.max ?? ''}${f.unit ? ' ' + f.unit : ''}` : f.unit || '';
    return h('div', { class: 'prodfield' }, h('label', { for: id }, f.label || f.name), ctl, h('span', { class: 'note' }, range));
  });
  const money = x => (r.price.currency ? r.price.currency + ' ' : '') + x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const names = [...C.project.nodes.keys()];
  if (!names.includes(prodExplain)) prodExplain = names.find(n => C.project.nodes.get(n).kind === 'param') || names[0] || '';
  const ex = prodExplain ? r.explain(prodExplain) : null;
  const explainTree = n => h('li', {}, h('code', {}, n.name), ' = ', h('b', {}, showVal(n.value)), n.formula ? h('span', { class: 'note' }, '  ← ' + n.formula) : h('span', { class: 'note' }, `  (${n.from})`), n.uses ? h('ul', {}, ...n.uses.map(explainTree)) : '');
  const testName = h('input', { 'aria-label': 'Test case name', placeholder: 'test name', size: '14' });
  const left = h('div', { class: 'prodform' },
    h('div', { class: 'row prodbar' },
      h('label', {}, h('input', { type: 'checkbox', checked: prodLive, onchange: e => { prodLive = e.target.checked; if (prodLive) prodApply(r, true); } }), ' Live model'),
      h('button', { class: 'btn go', disabled: !r.ok, onclick: () => prodApply(r, false) }, 'Apply to model'),
      h('button', { class: 'btn', onclick: () => { prodAnswers = {}; if (prodLive) prodApply(C.project.evaluate({}), true); draw(); } }, 'Reset')),
    ...fields,
    h('div', { class: 'row prodbar' }, testName, h('button', { class: 'btn', onclick: () => {
      const expect = { ok: r.ok, ...r.model.params };
      for (const [k, v] of Object.entries(r.model.suppressed)) expect['model.suppressed.' + k] = v;
      if (r.price.lines.length) expect['price.total'] = r.price.total;
      prodWork.tests.push({ name: testName.value.trim() || `Case ${prodWork.tests.length + 1}`, answers: { ...prodAnswers }, expect });
      toast('Saved as a test case'); prodTab = 'tests'; draw();
    } }, 'Save as test case')));
  const right = h('div', { class: 'prodout' },
    r.messages.length ? h('ul', { class: 'prodmsgs' }, ...r.messages.map(m => h('li', { class: m.level }, h('b', {}, m.level), ' ', m.message))) : h('p', { class: 'note ok' }, 'All checks pass.'),
    r.price.lines.length ? h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Price'), h('th', {}, ''))),
      h('tbody', {}, ...r.price.lines.map(l => h('tr', {}, h('td', {}, l.line), h('td', { class: 'num' }, money(l.amount)))), h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', { class: 'num' }, money(r.price.total))))) : '',
    r.bom.length ? h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['Item', 'Qty', 'Unit'].map(t => h('th', {}, t)))), h('tbody', {}, ...r.bom.map(b => h('tr', {}, h('td', {}, b.item), h('td', { class: 'num' }, showVal(b.qty)), h('td', {}, b.unit))))) : '',
    Object.keys(r.text).length ? h('dl', { class: 'prodtext' }, ...Object.entries(r.text).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : '',
    names.length ? h('div', { class: 'prodexplain' },
      h('div', { class: 'row' }, h('span', { class: 'note' }, 'Explain'), h('select', { 'aria-label': 'Explain a value', onchange: e => { prodExplain = e.target.value; draw(); } }, ...names.map(n => h('option', { value: n, selected: n === prodExplain }, n)))),
      ex ? h('ul', { class: 'prodtree' }, explainTree(ex)) : '') : '');
  pane.append(h('div', { class: 'prodtry' }, left, right));
}

// Drive the design from an evaluation: parameter values and feature suppression (one undo step per burst of edits).
function prodApply(r, quiet) {
  if (!r.ok && !quiet) { toast('Fix the errors first'); return; }
  checkpoint('product-apply');
  for (const [k, v] of Object.entries(r.model.params)) { const p = doc.params.find(q => q.name === k); if (p) p.expr = String(+(+v).toFixed(6)); }
  for (const [k, v] of Object.entries(r.model.suppressed)) { const f = featById(k) || doc.features.find(x => x.name === k); if (f) f.suppressed = !!v; }
  params = evalParams(doc.params);
  scheduleRegen(0); renderBrowser(); renderTimeline(); persist();
  if (!quiet) toast('Applied to the model');
}

// ---------- Tests ----------
function prodTests(pane, C, draw) {
  const W = prodWork, res = prodLastTest;
  const rows = W.tests.map((t, i) => {
    const got = res?.results[i];
    const summary = o => Object.entries(o || {}).map(([k, v]) => `${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
    return h('tr', {},
      h('td', {}, pin(t.name, v => { t.name = v; draw(); }, { 'aria-label': 'Test name' })),
      h('td', { class: 'note' }, summary(t.answers) || 'defaults'),
      h('td', { class: 'note' }, summary(t.expect)),
      h('td', { class: got ? (got.pass ? 'ok' : 'bad') : '' }, got ? (got.pass ? 'pass' : got.failures.join('; ')) : ''),
      h('td', { class: 'nowrap' },
        h('button', { class: 'btn', onclick: () => { prodAnswers = { ...t.answers }; prodTab = 'try'; draw(); } }, 'Open'),
        h('button', { class: 'iconbtn', 'aria-label': 'Delete test ' + t.name, onclick: () => { W.tests.splice(i, 1); prodLastTest = null; draw(); }, html: icon('delete') })));
  });
  pane.append(
    h('p', { class: 'note' }, 'Saved answers and the results they must give. Save cases from the Try it tab; run them after every change to the rules.'),
    h('table', { class: 'grid prodgrid fixed' }, prodCols([180, null, null, 200, 96]), h('thead', {}, h('tr', {}, ...['Name', 'Answers', 'Expects', 'Result', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '5', class: 'note' }, 'No test cases yet.')))),
    h('div', { class: 'row prodbar' },
      h('button', { class: 'btn go', disabled: !C.project?.ok || !W.tests.length, onclick: () => { prodLastTest = C.project.runTests(W.tests); draw(); } }, 'Run tests'),
      res ? h('span', { class: 'note ' + (res.pass ? 'ok' : 'bad') }, `${res.results.filter(x => x.pass).length} of ${res.results.length} pass` + (res.untested.length ? ` · never tested both ways: ${res.untested.join(', ')}` : ' · every branch tested')) : ''));
}

// ---------- import / export ----------
async function prodExport() {
  const C = prodCompile(prodWork);
  if (C.errors.length) toast(`Exported with ${C.errors.length} problem(s) still to fix`);
  const base = slug(), tables = {}, files = [];
  for (const [name, t] of Object.entries(prodWork.tables)) {
    let csv; try { csv = typeof t === 'string' ? t : t.csv ?? prodToCSV(t); } catch (e) { csv = ''; }
    tables[name] = `tables/${name}.csv`; files.push({ name: `tables/${name}.csv`, data: csv });
  }
  const design = JSON.parse(JSON.stringify(doc)); delete design.product;
  const config = { product: doc.name || base, ...JSON.parse(JSON.stringify(prodWork)), model: { design: base + '.design.json' }, tables };
  files.unshift({ name: 'product.config.json', data: JSON.stringify(config, null, 2) + '\n' }, { name: base + '.design.json', data: JSON.stringify(design) });
  await saveFile(base + '-product.zip', makeZip(files), 'application/zip');
}
async function prodImport(draw) {
  const got = await pickFile('.json,application/json'); if (!got) return;
  let c; try { c = JSON.parse(got.data); } catch (e) { toast('That file is not JSON'); return; }
  if (!c || !Array.isArray(c.inputs)) { toast('That is not a product file (no inputs)'); return; }
  const tables = {};
  for (const [name, t] of Object.entries(c.tables || {})) {
    if (typeof t === 'string' && /\.csv$/i.test(t) && !t.includes('\n')) { toast(`Table ${name} refers to ${t}: add it with Import CSV on the Tables tab`); tables[name] = { csv: '' }; }
    else tables[name] = typeof t === 'string' ? { csv: t } : t;
  }
  prodWork = { ...blankProduct(), ...c, tables };
  delete prodWork.model; delete prodWork.product;
  prodLastTest = null; draw(); toast('Product imported: press OK to keep it');
}
