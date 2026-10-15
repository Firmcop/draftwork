// ===== Configurations: a table of variants (parameter values, suppressed features) and rules =====
const cfg = () => doc.configs || (doc.configs = { columns: [], rows: [], active: null });
function applyConfig(rowId) {
  const C = cfg(), row = C.rows.find(r => r.id === rowId); if (!row) return;
  checkpoint();
  C.columns.forEach((col, i) => {
    const v = row.values[i];
    if (col.kind === 'param') { const p = doc.params.find(q => q.name === col.name); if (p && v !== '' && v != null) p.expr = String(v); }
    else if (col.kind === 'suppress') { const f = featById(col.feature); if (f) f.suppressed = v === true || v === 'true' || v === 1 || v === '1'; }
  });
  C.active = rowId; params = evalParams(doc.params);
  scheduleRegen(0); renderBrowser(); renderTimeline(); persist();
  toast('Configuration: ' + row.name);
}
function openConfigTable() {
  const C = cfg();
  if (!C.columns.length) { for (const p of doc.params.slice(0, 3)) C.columns.push({ kind: 'param', name: p.name }); }
  if (!C.rows.length) C.rows.push({ id: uid(), name: 'Default', values: C.columns.map(col => col.kind === 'param' ? (doc.params.find(q => q.name === col.name)?.expr ?? '') : !!featById(col.feature)?.suppressed) });
  const wrap = h('div', { class: 'tablewrap' });
  const draw = () => {
    const head = h('tr', {}, h('th', {}, ''), h('th', {}, 'Configuration'), ...C.columns.map((col, ci) => h('th', {}, col.kind === 'param' ? col.name : 'Suppress ' + (featById(col.feature)?.name || '?'),
      h('button', { class: 'iconbtn', 'aria-label': 'Remove column', title: 'Remove column', onclick: () => { C.columns.splice(ci, 1); C.rows.forEach(r => r.values.splice(ci, 1)); draw(); }, html: icon('close') }))), h('th', {}, ''));
    const rows = C.rows.map((r, ri) => h('tr', {},
      h('td', {}, h('input', { type: 'radio', name: 'cfg-active', 'aria-label': 'Activate ' + r.name, checked: C.active === r.id, onchange: () => { C.active = r.id; } })),
      h('td', {}, h('input', { value: r.name, 'aria-label': 'Configuration name', onchange: e => { r.name = e.target.value; } })),
      ...C.columns.map((col, ci) => h('td', {}, col.kind === 'param'
        ? h('input', { value: r.values[ci] ?? '', 'aria-label': col.name + ' in ' + r.name, spellcheck: 'false', onchange: e => { r.values[ci] = e.target.value.trim(); } })
        : h('input', { type: 'checkbox', 'aria-label': 'Suppress in ' + r.name, checked: !!r.values[ci] && r.values[ci] !== 'false', onchange: e => { r.values[ci] = e.target.checked; } }))),
      h('td', {}, h('button', { class: 'iconbtn', 'aria-label': 'Delete ' + r.name, onclick: () => { C.rows.splice(ri, 1); draw(); }, html: icon('delete') }))));
    const pSel = h('select', { 'aria-label': 'Parameter column' }, h('option', { value: '' }, 'Add parameter column…'), ...doc.params.filter(p => !C.columns.some(c => c.kind === 'param' && c.name === p.name)).map(p => h('option', { value: p.name }, p.name)));
    pSel.addEventListener('change', () => { if (!pSel.value) return; const p = doc.params.find(q => q.name === pSel.value); C.columns.push({ kind: 'param', name: p.name }); C.rows.forEach(r => r.values.push(p.expr)); draw(); });
    const fSel = h('select', { 'aria-label': 'Suppression column' }, h('option', { value: '' }, 'Add suppression column…'), ...doc.features.filter(f => !C.columns.some(c => c.kind === 'suppress' && c.feature === f.id)).map(f => h('option', { value: f.id }, f.name)));
    fSel.addEventListener('change', () => { if (!fSel.value) return; C.columns.push({ kind: 'suppress', feature: fSel.value }); C.rows.forEach(r => r.values.push(!!featById(fSel.value)?.suppressed)); draw(); });
    wrap.replaceChildren(h('p', { class: 'note' }, 'Each row is a variant of the design. Pick one with the radio button and press Apply. Parameter cells take expressions.'),
      h('table', { class: 'grid cfg' }, h('thead', {}, head), h('tbody', {}, rows)),
      h('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, h('button', { class: 'btn', onclick: () => { C.rows.push({ id: uid(), name: 'Config ' + (C.rows.length + 1), values: C.columns.map((c, i) => C.rows.at(-1)?.values[i] ?? '') }); draw(); } }, '+ Row'), pSel, fSel));
  };
  draw();
  openModal('Configuration Table', 'configure', wrap, [
    h('button', { class: 'btn ok', onclick: () => { closeModal(); if (C.active) applyConfig(C.active); else persist(); } }, 'Apply'),
    h('button', { class: 'btn', onclick: () => { closeModal(); persist(); } }, 'Close')]);
}
// ---- rules: suppress a feature when an expression of the parameters is true ----
const cfgRules = () => doc.configRules || (doc.configRules = []);
function applyConfigRules(features) {
  const R = doc.configRules; if (!R?.length) return features;
  const off = new Set();
  for (const r of R) { if (!r.feature || !r.expr) continue; try { if (evalExpr(r.expr, params.vars)) off.add(r.feature); } catch (e) { /* bad rule: ignored, shown in the dialog */ } }
  return off.size ? features.map(f => off.has(f.id) ? { ...f, suppressed: true } : f) : features;
}
function openConfigRules() {
  const wrap = h('div', { class: 'tablewrap' });
  const draw = () => {
    const rows = cfgRules().map((r, i) => {
      let state = ''; try { state = r.expr ? (evalExpr(r.expr, params.vars) ? 'suppressed now' : 'active now') : ''; } catch (e) { state = e.message; }
      return h('tr', {},
        h('td', {}, h('select', { 'aria-label': 'Feature', onchange: e => { r.feature = e.target.value; } }, ...doc.features.map(f => h('option', { value: f.id, selected: r.feature === f.id }, f.name)))),
        h('td', {}, h('input', { value: r.expr || '', placeholder: 'e.g. width > 50', 'aria-label': 'Condition', spellcheck: 'false', onchange: e => { r.expr = e.target.value.trim(); setTimeout(draw, 0); } })),
        h('td', { class: 'note' }, state),
        h('td', {}, h('button', { class: 'iconbtn', 'aria-label': 'Delete rule', onclick: () => { cfgRules().splice(i, 1); draw(); }, html: icon('delete') })));
    });
    wrap.replaceChildren(h('p', { class: 'note' }, 'Suppress a feature whenever its condition is true. Conditions use parameters with < > <= >= == !=, and if(cond, a, b) works in any dimension.'),
      h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['Suppress feature', 'When', 'Now', ''].map(t => h('th', {}, t)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '4', class: 'note' }, 'No rules yet.')))),
      h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => { cfgRules().push({ id: uid(), feature: doc.features.at(-1)?.id || '', expr: '' }); draw(); } }, '+ Rule'));
  };
  const snap = JSON.stringify(doc.configRules || []);
  draw();
  openModal('Configuration Rules', 'configure', wrap, [
    h('button', { class: 'btn ok', onclick: () => { closeModal(); if (JSON.stringify(doc.configRules) !== snap) { checkpoint(); persist(); scheduleRegen(0); } } }, 'OK'),
    h('button', { class: 'btn', onclick: () => { doc.configRules = JSON.parse(snap); closeModal(); } }, 'Cancel')]);
}
