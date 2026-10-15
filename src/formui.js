// ===== Form: subdivision modelling (cage + Catmull-Clark). Edit the cage by picking its points in the form dialog. =====
var formSel = new Set();   // var + function declarations: drawToolsOverlay may run before this module has loaded
function formDialogFeature() { const f = dlg && !dlg.custom && featById(dlg.fid); return f?.type === 'form' ? f : null; }
function newForm() { if (!needExact('Create Form')) return; formSel = new Set(); startPlaced('form'); }
function formFrame(f) {
  const r = resolvedById(f.id) || f;
  return planeMatrixOf(f.plane, +r.offset || 0, f.flip).multiply(new THREE.Matrix4().makeTranslation(+r.cx || 0, +r.cy || 0, 0));
}
function drawFormCage(group) {
  if (!formSel) return;
  const f = formDialogFeature(); if (!f) return;
  const r = resolvedById(f.id) || f, cage = formCage(r), M = formFrame(f);
  const P = cage.pos.map(p => new THREE.Vector3(...p).applyMatrix4(M));
  const seg = [], seen = new Set();
  for (const fc of cage.faces) fc.forEach((a, i) => { const b = fc[(i + 1) % fc.length], k = a < b ? a + '_' + b : b + '_' + a; if (seen.has(k)) return; seen.add(k); seg.push(P[a].x, P[a].y, P[a].z, P[b].x, P[b].y, P[b].z); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3a7bd5, depthTest: false, transparent: true, opacity: 0.8 })); ls.renderOrder = 16; group.add(ls);
  const sz = Math.max(0.6, camera.position.distanceTo(controls.target) * 0.006);
  P.forEach((p, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(formSel.has(i) ? sz * 1.4 : sz, 10, 8), new THREE.MeshBasicMaterial({ color: formSel.has(i) ? colors.select : 0x3a7bd5, depthTest: false }));
    s.position.copy(p); s.renderOrder = 17; group.add(s);
  });
}
function formPickAt(e) {
  const f = formDialogFeature(); if (!f) return false;
  const r = resolvedById(f.id) || f, cage = formCage(r), M = formFrame(f), rr = renderer.domElement.getBoundingClientRect();
  let best = -1, bd = 12;
  cage.pos.forEach((p, i) => { const v = new THREE.Vector3(...p).applyMatrix4(M).project(camera); const d = Math.hypot(rr.left + (v.x + 1) / 2 * rr.width - e.clientX, rr.top + (1 - v.y) / 2 * rr.height - e.clientY); if (v.z < 1 && d < bd) { bd = d; best = i; } });
  if (best < 0) { if (!e.shiftKey && formSel.size) { formSel.clear(); rerenderDialog(); drawToolsOverlay(); requestRender(); } return true; }
  if (e.shiftKey || e.ctrlKey || e.metaKey) formSel.has(best) ? formSel.delete(best) : formSel.add(best); else formSel = new Set([best]);
  rerenderDialog(); drawToolsOverlay(); requestRender();
  return true;
}
// mirror partner of a cage point across the cage's local YZ plane (by unedited position)
function formMirror(f, i) {
  const base = formCage({ ...(resolvedById(f.id) || f), edits: {} }).pos, p = base[i];
  return base.findIndex(q => Math.abs(q[0] + p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6 && Math.abs(q[2] - p[2]) < 1e-6);
}
function formApply(f, deltaOf) {
  checkpoint();
  const r = resolvedById(f.id) || f, cur = formCage(r).pos, edits = { ...(f.edits || {}) };
  const add = (i, d) => { const e = edits[i] || [0, 0, 0]; edits[i] = e.map((v, k) => Math.round((v + d[k]) * 1e4) / 1e4); };
  const done = new Set();
  for (const i of formSel) {
    const d = deltaOf(i, cur); add(i, d); done.add(i);
    if (f.symmetric) { const m = formMirror(f, i); if (m >= 0 && m !== i && !formSel.has(m) && !done.has(m)) { add(m, [-d[0], d[1], d[2]]); done.add(m); } }
  }
  f.edits = edits; rerenderDialog(); drawToolsOverlay(); scheduleRegen(0);
}
function formDialog(f, idx, out, placement) {
  if (f.type !== 'form') return false;
  const mv = { dx: 0, dy: 0, dz: 5, s: 1.2 };
  const n = formSel.size, nEdits = Object.keys(f.edits || {}).length;
  out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy')),
    section_('Shape', segField('Primitive', f, 'prim', [['box', 'Box'], ['sphere', 'Quadball'], ['cylinder', 'Cylinder'], ['torus', 'Torus'], ['plane', 'Plane']], { rerender: true, after: () => { f.edits = {}; formSel.clear(); } }),
      exField(f.prim === 'cylinder' || f.prim === 'sphere' || f.prim === 'torus' ? 'Diameter' : 'Length', f, 'w', 'mm', { min: 0.01 }),
      f.prim === 'box' || f.prim === 'plane' ? exField('Width', f, 'd', 'mm', { min: 0.01 }) : null,
      f.prim !== 'plane' && f.prim !== 'sphere' ? exField(f.prim === 'torus' ? 'Tube diameter' : 'Height', f, 'h', 'mm', { min: 0.01 }) : null,
      exField('Faces across', f, 'nx', '', { min: 1, max: 12, after: () => { f.edits = {}; formSel.clear(); } }),
      f.prim === 'box' || f.prim === 'plane' || f.prim === 'torus' ? exField('Faces deep', f, 'ny', '', { min: 1, max: 12, after: () => { f.edits = {}; formSel.clear(); } }) : null,
      f.prim === 'box' || f.prim === 'cylinder' ? exField('Faces high', f, 'nz', '', { min: 1, max: 12, after: () => { f.edits = {}; formSel.clear(); } }) : null,
      exField('Smoothness', f, 'level', '', { min: 0, max: 4 }), segField('Result', f, 'output', [['mesh', 'Smooth mesh'], ['solid', 'Solid']])),
    section_('Edit form',
      h('p', { class: 'note' }, n ? `${n} cage point${n > 1 ? 's' : ''} selected (Shift adds).` : 'Click the blue cage points to select them (Shift adds), then move or scale them.'),
      chkField('Symmetric (mirror edits across X)', f, 'symmetric'),
      exField('Move X', mv, 'dx', 'mm', { id: 'fm-dx' }), exField('Move Y', mv, 'dy', 'mm', { id: 'fm-dy' }), exField('Move Z', mv, 'dz', 'mm', { id: 'fm-dz' }),
      h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'fm-move', disabled: !n, onclick: () => formApply(f, () => [+mv.dx || 0, +mv.dy || 0, +mv.dz || 0]) }, 'Move selected')),
      exField('Scale', mv, 's', '×', { id: 'fm-s', min: 0.05, step: 0.1 }),
      h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', disabled: n < 2, onclick: () => formApply(f, (i, cur) => { const c = [0, 1, 2].map(k => [...formSel].reduce((s, j) => s + cur[j][k], 0) / formSel.size); return [0, 1, 2].map(k => (cur[i][k] - c[k]) * ((+mv.s || 1) - 1)); }) }, 'Scale selected')),
      h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', disabled: !nEdits, onclick: () => { checkpoint(); f.edits = {}; rerenderDialog(); drawToolsOverlay(); scheduleRegen(0); } }, `Reset shape${nEdits ? ' (' + nEdits + ' edited)' : ''}`))));
  return true;
}
