// ===== Plastic workspace: rules (as user parameters), boss, snap fit, lip/groove, rest =====
const PL_PARAMS = [['pl_wall', '2', 'Plastic nominal wall thickness'], ['pl_draft', '1', 'Plastic draft angle (degrees)'], ['pl_clearance', '0.2', 'Plastic mating clearance']];
function ensurePlasticParams() {
  let added = false;
  for (const [name, expr, comment] of PL_PARAMS) if (!doc.params.some(p => p.name === name)) { doc.params.push({ name, expr, comment }); added = true; }
  if (added) params = evalParams(doc.params);
}
function newPlastic(type) {
  if (!needExact(TYPE[type].label)) return;
  ensurePlasticParams();
  if (type === 'lip') return newEdgeFeature('lip');
  startPlaced(type);
}
function openRulesModal(title, iconName, list, ensure) {
  const snap = JSON.stringify(doc.params);
  ensure();
  const work = list.map(([name, , label]) => { const p = doc.params.find(q => q.name === name); return { p, label, inp: h('input', { type: 'text', value: p.expr, spellcheck: 'false', 'aria-label': label, id: 'rule-' + name }) }; });
  const body = h('div', { class: 'tablewrap' }, h('p', { class: 'note' }, 'These are user parameters, so you can use them in any dimension. Features made with the defaults update when you change them here.'),
    ...work.map(w => h('div', { class: 'row' }, h('label', { class: 'rl', for: w.inp.id }, w.label.replace(/^(Sheet metal|Plastic) /, '')), w.inp)));
  openModal(title, iconName, body, [
    h('button', { class: 'btn ok', onclick: () => { checkpoint(); work.forEach(w => { w.p.expr = w.inp.value.trim() || w.p.expr; }); params = evalParams(doc.params); closeModal(); scheduleRegen(0); renderBrowser(); } }, 'OK'),
    h('button', { class: 'btn', onclick: () => { doc.params = JSON.parse(snap); params = evalParams(doc.params); closeModal(); } }, 'Cancel')]);
}
function openPlasticRules() { openRulesModal('Plastic Rules', 'plasticrules', PL_PARAMS, ensurePlasticParams); }
function plasticDialog(f, idx, out, placement) {
  const opSec = () => section_('Result', selField('Body', f, 'target', [['', 'Last body'], ...bodiesBefore(f.id)]), chkField('Reverse direction', f, 'reverse'));
  switch (f.type) {
    case 'boss':
      out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy')),
        section_('Boss', exField('Outer diameter', f, 'diameter', 'mm', { min: 0.01 }), exField('Height', f, 'height', 'mm', { min: 0.01 }), exField('Draft angle', f, 'draftAngle', '°', { min: 0, max: 30 })),
        section_('Screw hole', exField('Hole diameter', f, 'holeDiameter', 'mm', { min: 0 }), exField('Hole depth (0 = through)', f, 'holeDepth', 'mm', { min: 0 }), exField('Continue below', f, 'holeBelow', 'mm', { min: 0 })),
        section_('Ribs', exField('Count', f, 'ribs', '', { min: 0, max: 12 }), exField('Thickness', f, 'ribThickness'), exField('Length', f, 'ribLength'), exField('Height', f, 'ribHeight'), exField('Rotation', f, 'ribAngle', '°')), opSec());
      return true;
    case 'snapfit':
      out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy'), exField('Hook direction', f, 'orient', '°')),
        section_('Cantilever', exField('Length', f, 'length', 'mm', { min: 0.01 }), exField('Root thickness', f, 'thickness', 'mm', { min: 0.01 }), exField('Width', f, 'width', 'mm', { min: 0.01 }), exField('Taper', f, 'draftAngle', '°', { min: 0, max: 20 })),
        section_('Hook', exField('Overhang', f, 'hookDepth', 'mm', { min: 0.01 }), exField('Insertion angle', f, 'insertAngle', '°', { min: 5, max: 85 }), h('p', { class: 'note' }, 'The retention face is square to the beam; the ramp angle sets the push-in force.')), opSec());
      return true;
    case 'rest':
      out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy'), exField('Rotation', f, 'orient', '°')),
        section_('Rest', segField('Shape', f, 'shape', [['rect', 'Rectangle'], ['circle', 'Round']], { rerender: true }),
          ...(f.shape === 'circle' ? [exField('Diameter', f, 'diameter', 'mm', { min: 0.01 })] : [exField('Width', f, 'w', 'mm', { min: 0.01 }), exField('Length', f, 'd', 'mm', { min: 0.01 }), exField('Corner radius', f, 'r', 'mm', { min: 0 })]),
          exField('Height', f, 'height', 'mm', { min: 0.01 }), exField('Draft angle', f, 'draftAngle', '°', { min: 0, max: 30 })), opSec());
      return true;
    case 'lip':
      out.push(section_('Lip / Groove', segField('Type', f, 'mode', [['lip', 'Lip (raised)'], ['groove', 'Groove (cut)']]), exField('Width', f, 'width', 'mm', { min: 0.01 }), exField('Height', f, 'height', 'mm', { min: 0.01 }),
        exField('Clearance (groove)', f, 'clearance', 'mm', { min: 0 }), h('p', { class: 'note' }, 'Runs around the inside of the opening of the picked rim face. Use Lip on one half and Groove on the other.')));
      return true;
  }
  return false;
}
