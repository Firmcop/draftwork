// Commands and dialogs for the solid modify tools (geometry in brep.js modifyStep):
// Split Body, Scale, Thicken, Replace Face, Align, Pattern on Path, Boundary Fill.
function newModify(type, fields) {
  if (!needExact(TYPE[type]?.label || 'This tool')) return null;
  const snap = JSON.stringify(doc); checkpoint();
  const f = { id: uid(), type, name: nextName(type), ...fields };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  return f;
}
const lastBodyId = () => selBody || bodiesAtInsert().slice(-1)[0] || null;
// a picked plane or flat face as a plane reference (frame object when it is a face)
function pickToPlaneRef(c) { if (!c.face && typeof c.plane === 'string' && !c.offset && !c.flip) return c.plane; const M = planeMatrix(c.plane, c.offset || 0, !!c.flip), e = M.elements; return { o: [e[12], e[13], e[14]], x: [e[0], e[1], e[2]], n: [e[8], e[9], e[10]] }; }
function startSplitBody() {
  if (!bodiesAtInsert().length) { toast('There is no body yet'); return; }
  const body = lastBodyId();
  startPick({ prompt: 'Select the plane or flat face to split with', planes: true, faces: true, then: c => newModify('splitbody', { body, tool: pickToPlaneRef(c) }) });
}
function startScale() { if (!bodiesAtInsert().length) { toast('There is no body yet'); return; } newModify('scale', { body: lastBodyId(), factor: 2, center: 'body' }); }
function startAlign() {
  if (!needExact('Align')) return;
  startConstructPick(['face', 'face'], ([a, b]) => {
    if (a.body === b.body) { toast('Pick the second face on a different body'); return; }
    newModify('align', { body: a.body, a, b, flip: false, offset: 0, angle: 0 });
  }, ['Click a flat or cylindrical face on the body to move', 'Click the face to align it to']);
}
function startPatternOnPath() {
  const srcs = doc.features.filter(g => SOLIDS.has(g.type)), paths = doc.features.filter(g => g.type === 'sketch' && g.geo?.curves?.length);
  if (!srcs.length) { toast('Make a solid feature first; Pattern on Path copies a feature'); return; }
  if (!paths.length) { toast('Sketch a path first (lines and arcs)'); return; }
  newModify('patpath', { source: (doc.features.find(g => g.id === selFeature && SOLIDS.has(g.type)) || srcs.at(-1)).id, path: paths.at(-1).id, count: 4, spacing: 'fill', distance: 10, orient: 'identical' });
}
function startBoundaryFill() { if (!bodiesAtInsert().length) { toast('There is no body yet'); return; } newModify('boundary', { bodies: bodiesAtInsert().slice(-1), planes: [], cells: [] }); }

function modifyDialog(f, idx, out) {
  const bodies = [['', 'Last body'], ...bodiesBefore(f.id)];
  const planesWithPick = cur => { const o = planeOptions(idx, cur); return o; };
  switch (f.type) {
    case 'splitbody':
      out.push(section_('Split', selField('Body', f, 'body', bodies), selField('Splitting tool', f, 'tool', planesWithPick(f.tool)),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => startPick({ prompt: 'Select the plane or flat face to split with', planes: true, faces: true, then: c => { checkpoint(); f.tool = pickToPlaneRef(c); rerenderDialog(); scheduleRegen(0); } }) }, 'Pick plane or face')),
        h('p', { class: 'note' }, 'The body is cut into two bodies along the plane.')));
      return true;
    case 'scale':
      out.push(section_('Scale', selField('Body', f, 'body', bodies), exField('Scale factor', f, 'factor', '×', { min: 0.0001 }),
        selField('About', f, 'center', [['body', 'Centre of the body'], ['origin', 'Origin'], ['point', 'A construction point']], { rerender: true }),
        f.center === 'point' ? selField('Point', f, 'point', doc.features.slice(0, idx).filter(g => g.type === 'point').map(p => [p.id, p.name])) : null,
        h('p', { class: 'note' }, 'Uniform scale (the same in every direction).')));
      return true;
    case 'thicken':
      out.push(section_('Thickness', exField('Thickness', f, 'thickness', 'mm'), segField('Direction', f, 'side', [['out', 'Outside'], ['in', 'Inside'], ['both', 'Both sides']]),
        selField('Operation', f, 'op', [['new', 'New body'], ['join', 'Join'], ['cut', 'Cut']])));
      return true;
    case 'replaceface':
      out.push(section_('Replace with', selField('Target plane', f, 'target', planesWithPick(f.target)),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => startPick({ prompt: 'Select the plane or flat face to move the face to', planes: true, faces: true, then: c => { checkpoint(); f.target = pickToPlaneRef(c); rerenderDialog(); scheduleRegen(0); } }) }, 'Pick plane or face')),
        h('p', { class: 'note' }, 'The picked flat face moves onto a parallel plane; the body grows or shrinks to follow.')));
      return true;
    case 'align':
      out.push(section_('Align', h('p', { class: 'note' }, `Moves ${bodyName(f.body)} so its face sits on the target face.`), exField('Offset', f, 'offset'), exField('Rotate', f, 'angle', '°'), chkField('Flip (same direction instead of facing)', f, 'flip'),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => startConstructPick(['face', 'face'], ([a, b]) => { checkpoint(); Object.assign(f, { body: a.body, a, b }); openFeatureDialog(f.id); scheduleRegen(0); }, ['Click the face on the body to move', 'Click the face to align it to']) }, 'Pick faces again'))));
      return true;
    case 'patpath': {
      const srcs = doc.features.slice(0, idx).filter(g => SOLIDS.has(g.type)), paths = doc.features.slice(0, idx).filter(g => g.type === 'sketch' && g.geo?.curves?.length);
      out.push(section_('Input', selField('Feature', f, 'source', srcs.map(s => [s.id, s.name])), selField('Path sketch', f, 'path', paths.map(s => [s.id, s.name]))),
        section_('Distribution', exField('Quantity', f, 'count', '', { min: 2, max: 100 }), segField('Spacing', f, 'spacing', [['fill', 'Fill the path'], ['distance', 'Fixed distance']], { rerender: true }),
          f.spacing === 'distance' ? exField('Distance', f, 'distance', 'mm', { min: 0.001 }) : null, segField('Orientation', f, 'orient', [['identical', 'Identical'], ['path', 'Follow the path']])));
      return true;
    }
    case 'boundary': {
      const list = h('div', { class: 'picklist' });
      for (const [id, name] of bodiesBefore(f.id)) { const cb = h('input', { type: 'checkbox', id: 'bf-' + id, checked: (f.bodies || []).includes(id) }); cb.addEventListener('change', () => { checkpoint(); const s2 = new Set(f.bodies || []); cb.checked ? s2.add(id) : s2.delete(id); f.bodies = [...s2]; scheduleRegen(0); }); list.append(h('label', { class: 'chk', for: 'bf-' + id }, cb, name)); }
      const planes = h('div', {});
      (f.planes || []).forEach((p, i) => planes.append(h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Plane ' + (i + 1)),
        h('div', { style: 'display:flex;gap:6px' }, (() => { const s2 = h('select', { 'aria-label': 'Plane ' + (i + 1) }, ...planeOptions(idx, p.ref).map(([v, l]) => h('option', { value: v, selected: v === p.ref }, l))); s2.addEventListener('change', () => { checkpoint(); p.ref = s2.value; scheduleRegen(0); }); return s2; })(),
          (() => { const s2 = h('select', { 'aria-label': 'Keep side of plane ' + (i + 1) }, h('option', { value: 'above', selected: p.side !== 'below' }, 'Keep above'), h('option', { value: 'below', selected: p.side === 'below' }, 'Keep below')); s2.addEventListener('change', () => { checkpoint(); p.side = s2.value; scheduleRegen(0); }); return s2; })(),
          h('button', { class: 'btn', type: 'button', 'aria-label': 'Remove plane ' + (i + 1), onclick: () => { checkpoint(); f.planes.splice(i, 1); rerenderDialog(); scheduleRegen(0); } }, '×')))));
      out.push(section_('Tools', list, planes, h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => { checkpoint(); (f.planes ||= []).push({ ref: 'XY', side: 'above' }); rerenderDialog(); scheduleRegen(0); } }, 'Add plane'))),
        section_('Cells', h('p', { class: 'note' }, 'Fills the closed spaces the tools enclose (for example the inside of a hollow part). Leave blank for every enclosed cell, or list cell numbers.'),
          (() => { const i = h('input', { type: 'text', id: 'bf-cells', value: (f.cells || []).join(', '), autocomplete: 'off', placeholder: 'e.g. 1, 2' }); i.addEventListener('input', () => { checkpoint('bfcells'); f.cells = i.value.split(/[ ,]+/).map(Number).filter(n => n > 0); scheduleRegen(200); }); return h('div', { class: 'row' }, h('label', { class: 'rl', for: 'bf-cells' }, 'Cells'), i); })()));
      return true;
    }
  }
  return false;
}
