// Commands and dialogs for the solid modify tools (geometry in brep.js modifyStep):
// Split Body, Scale, Thicken, Replace Face, Align, Pattern on Path, Boundary Fill.
function newModify(type, fields) {
  if (!needExact(TYPE[type]?.label || 'This tool')) return null;
  const snap = leanJSON(doc); checkpoint();
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
    case 'silsplit':
      out.push(section_('Silhouette', selField('Body', f, 'body', bodies), selField('View direction (normal of)', f, 'dir', planesWithPick(f.dir), { id: 'ds-dir' }),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => startPick({ prompt: 'Select the plane or flat face to look along', planes: true, faces: true, then: c => { checkpoint(); f.dir = pickToPlaneRef(c); rerenderDialog(); scheduleRegen(0); } }) }, 'Pick plane or face')),
        segField('Result', f, 'mode', [['body', 'Split body'], ['faces', 'Split faces']], { id: 'sg-mode' }),
        h('p', { class: 'note' }, 'Splits along the outline of the curved faces seen along the normal of the chosen plane — the parting line for a two-part mould. Split body needs the outline to lie in one plane.')));
      return true;
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
    case 'splitface':
      out.push(section_('Splitting tool', selField('Plane', f, 'tool', planesWithPick(f.tool)),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => startPick({ prompt: 'Select the plane or flat face to split with', planes: true, faces: true, then: c => { checkpoint(); f.tool = pickToPlaneRef(c); rerenderDialog(); scheduleRegen(0); } }) }, 'Pick plane or face')),
        h('p', { class: 'note' }, 'The picked faces are divided where the plane crosses them; the body stays one solid. Use the pieces for press pull, draft or appearance.')));
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

// ---- coil, thread, rib, web, emboss ----
const THREAD_SIZES = [[0, 'Automatic (metric coarse)'], [0.35, 'M1.6 × 0.35'], [0.4, 'M2 × 0.4'], [0.45, 'M2.5 × 0.45'], [0.5, 'M3 × 0.5'], [0.7, 'M4 × 0.7'], [0.8, 'M5 × 0.8'], [1, 'M6 × 1'], [1.25, 'M8 × 1.25'], [1.5, 'M10 × 1.5'], [1.75, 'M12 × 1.75'], [2, 'M14/M16 × 2'], [2.5, 'M20 × 2.5'], [3, 'M24 × 3']];
const openSketches = idx => doc.features.slice(0, idx).filter(g => g.type === 'sketch' && g.geo?.curves?.length).map(g => [g.id, g.name]);
function startRibWeb(type) {
  if (!needExact(type === 'rib' ? 'Rib' : 'Web')) return;
  const sks = doc.features.filter(g => g.type === 'sketch' && g.geo?.curves?.length);
  if (!sks.length) { toast(`Sketch the ${type} profile first: an open line where the wall goes`); return; }
  const sk = (featById(selFeature)?.type === 'sketch' && featById(selFeature).geo?.curves?.length) ? featById(selFeature) : sks.at(-1);
  newModify(type, type === 'rib' ? { sketch: sk.id, thickness: 3, flipSide: false, target: null } : { sketch: sk.id, thickness: 3, depth: 10, direction: 'symmetric', op: 'join', target: null });
}
function startEmboss() {
  if (!needExact('Emboss')) return;
  const sks = doc.features.filter(g => g.type === 'sketch');
  if (!sks.length) { toast('Sketch the shape or text to emboss first'); return; }
  const snap = leanJSON(doc); checkpoint();
  const f = { id: uid(), type: 'emboss', name: nextName('emboss'), sketch: sks.at(-1).id, edges: [], depth: 1, mode: 'emboss' };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  toast('Click the face to emboss onto');
}
function createDialog2(f, idx, out, placementFields) {
  switch (f.type) {
    case 'coil': {
      const m = f.mode || 'revs-height';
      out.push(section_('Placement', ...placementFields(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy')),
        section_('Shape', exField('Diameter', f, 'diameter', 'mm', { min: 0.01 }),
          selField('Size by', f, 'mode', [['revs-height', 'Revolutions and height'], ['revs-pitch', 'Revolutions and pitch'], ['height-pitch', 'Height and pitch']], { rerender: true }),
          m !== 'height-pitch' ? exField('Revolutions', f, 'revolutions', '', { min: 0.01 }) : null, m !== 'revs-pitch' ? exField('Height', f, 'height', 'mm', { min: 0.01 }) : null, m !== 'revs-height' ? exField('Pitch', f, 'pitch', 'mm', { min: 0.01 }) : null,
          chkField('Left-handed', f, 'lefthand')),
        section_('Section', selField('Section', f, 'section', [['circle', 'Circular'], ['square', 'Square'], ['triangle-out', 'Triangular (external)'], ['triangle-in', 'Triangular (internal)']]),
          selField('Position', f, 'position', [['center', 'On the diameter'], ['inside', 'Inside'], ['outside', 'Outside']]), exField('Section size', f, 'section_size', 'mm', { min: 0.01 })),
        section_('Result', selField('Operation', f, 'op', [['new', 'New body'], ['join', 'Join'], ['cut', 'Cut'], ['intersect', 'Intersect']])));
      return true;
    }
    case 'thread':
      out.push(section_('Thread', chkField('Modeled (cut the real thread)', f, 'modeled'), selField('Size', f, 'pitch', THREAD_SIZES, { numeric: true }),
        chkField('Full length', f, 'full', { rerender: true }), f.full === false ? exField('Length', f, 'length', 'mm', { min: 0.1 }) : null, f.full === false ? exField('Offset from start', f, 'offsetStart', 'mm') : null, chkField('Left-handed', f, 'lefthand'),
        h('p', { class: 'note' }, 'A cosmetic thread marks the face and shows in drawings; a modeled thread cuts the helical groove (slower). Holes get internal threads, shafts external.')));
      return true;
    case 'emboss':
      out.push(section_('Profile', selField('Sketch', f, 'sketch', doc.features.slice(0, idx).filter(g => g.type === 'sketch').map(g => [g.id, g.name]))),
        section_('Emboss', segField('Type', f, 'mode', [['emboss', 'Emboss (raise)'], ['deboss', 'Deboss (recess)']]), exField('Depth', f, 'depth', 'mm', { min: 0.01 }),
          h('p', { class: 'note' }, 'The sketch is projected along its normal onto the picked face, flat or curved.')));
      return true;
    case 'rib':
      out.push(section_('Profile', selField('Sketch', f, 'sketch', openSketches(idx)), h('p', { class: 'note' }, 'An open line on a plane through the part; the rib fills from the line to the part.')),
        section_('Rib', exField('Thickness', f, 'thickness', 'mm', { min: 0.01 }), chkField('Fill the other side of the line', f, 'flipSide'), selField('Body', f, 'target', [['', 'Last body'], ...bodiesBefore(f.id)])));
      return true;
    case 'web':
      out.push(section_('Profile', selField('Sketch', f, 'sketch', openSketches(idx)), h('p', { class: 'note' }, 'Every line becomes a wall; crossing lines make a grid.')),
        section_('Web', exField('Thickness', f, 'thickness', 'mm', { min: 0.01 }), exField('Depth', f, 'depth', 'mm', { min: 0.01 }), segField('Direction', f, 'direction', [['one', 'One side'], ['symmetric', 'Symmetric'], ['reverse', 'Flipped']]),
          selField('Operation', f, 'op', [['join', 'Join'], ['new', 'New body'], ['cut', 'Cut']])));
      return true;
  }
  return false;
}
// cosmetic threads: a darker band on the face so it reads as threaded
function drawCosmeticThreads(group) {
  for (const f of doc.features) {
    if (f.type !== 'thread' || f.modeled || f.suppressed || statusOf(f.id).state !== 'ok') continue;
    for (const [id, b] of result.bodies) {
      if (!b.shape || bodyHidden(id)) continue;
      const hs = brepRefHashes(b, f.edges || [], 'face'); if (!hs.size) continue;
      const m = brepMeshOf(b), idx = m.display.index.array, P = m.display.attributes.position.array, pos = [];
      for (let t = 0; t < m.triFace.length; t++) if (hs.has(m.triFace[t])) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4a5560, transparent: true, opacity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, depthWrite: false }));
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(bodyXf(id)); mesh.renderOrder = 2; group.add(mesh);
    }
  }
}
