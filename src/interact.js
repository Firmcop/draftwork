// ===== Commands, picking, sketching, measuring, view cube, navigation, boot =====
const NAMES = { sketch: 'Sketch', plane: 'Plane', extrude: 'Extrude', revolve: 'Revolve', box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', torus: 'Torus', hole: 'Hole', pattern: 'Pattern', mirror: 'Mirror', move: 'Move', combine: 'Combine', remove: 'Remove', fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell', draft: 'Draft', loft: 'Loft', import: 'Import', sweep: 'Sweep' };
function nextName(type) {
  let n = doc.features.filter(f => f.type === type).length + 1;
  while (doc.features.some(f => f.name === NAMES[type] + ' ' + n)) n++;
  return NAMES[type] + ' ' + n;
}
const insertIndex = () => doc.rollback == null ? doc.features.length : doc.rollback + 1;
function bodiesAtInsert() {
  const i = insertIndex();
  return i < doc.features.length ? (result.before.get(doc.features[i].id) || []) : [...result.bodies.keys()];
}
function insertFeature(f) {
  const i = insertIndex();
  doc.features.splice(i, 0, f);
  if (doc.rollback != null) doc.rollback = i >= doc.features.length - 1 ? null : i;
  selFeature = f.id; selBody = null;
}
function deleteFeature(id) {
  const i = featIndex(id); if (i < 0) return;
  const f = doc.features[i];
  if (dlg?.fid === id) closeDialog(true, true);
  checkpoint();
  doc.features.splice(i, 1);
  if (doc.rollback != null) { if (doc.rollback >= i) doc.rollback--; if (doc.rollback >= doc.features.length - 1) doc.rollback = null; }
  if (sketchId === id) exitSketch(true);
  selFeature = null; scheduleRegen(0);
  toast(`Deleted ${f.name}. Undo brings it back.`);
}
function setHint(t) { $('#hint').textContent = t || ''; }
function defaultHint() {
  if (workspace === 'drawing') return setHint(drawingHint());
  if (pick) return setHint(pick.prompt + ' · Esc cancels');
  if (jointHint()) return setHint(jointHint());
  if (measure) return setHint('Click points on the model to measure between them · Esc closes');
  if (mode === 'sketch') {
    const t = { select: geoSel.size ? geoSel.size + ' selected · apply a constraint, press D to dimension, Delete to remove' : 'Click geometry to select it (Shift adds). Drag points and lines to reshape.',
      line: lineDraft ? 'Click to add the next point. Click the first point to close; Enter or Esc ends the line.' : 'Click to place the first point. Points snap to existing points.',
      fillet2d: 'Click a corner where two lines meet, then type the radius',
      trim: 'Click the piece of a curve to remove; it is cut back to where it crosses other curves',
      extend: 'Click near the end of a line or arc to lengthen it to the next curve it meets',
      spline: lineDraft ? 'Click to add fit points. Click the last point again, or press Enter, to finish; click the first point to close.' : 'Click to place the first fit point',
      arc3: !gdraw?.pts?.length ? 'Click the arc start' : gdraw.pts.length === 1 ? 'Click the arc end' : 'Click a point the arc passes through',
      rect2: 'Drag from corner to corner', rectc: 'Drag from the center to a corner', circle: 'Drag from the center outward', polygon: 'Drag from the center to a corner (6 equal sides)', slot: 'Drag from one end center to the other' }[sketchTool];
    return setHint(t);
  }
  setHint('');
}

// ---------- selection & editing ----------
function selectFeature(id) {
  if (mode === 'sketch' && id !== sketchId) finishSketch(true);
  if (dlg) closeDialog(true);
  selFeature = id; selBody = null;
  updateScene(); renderTimeline(); renderBrowser();
}
function selectBody(id) {
  if (dlg && !dlg.custom) closeDialog(true);
  selBody = id; selFeature = null;
  updateScene(); renderTimeline(); renderBrowser();
}
function editFeature(id) {
  const f = featById(id); if (!f) return;
  const i = featIndex(id);
  if (doc.rollback != null && i > doc.rollback) { doc.rollback = i >= doc.features.length - 1 ? null : i; scheduleRegen(0); }
  if (f.type === 'sketch') enterSketch(id); else openFeatureDialog(id, false);
}

// ---------- create commands ----------
let lastSketchId = null;
function activeSketch() {
  const end = insertIndex();
  const ok = s => s && s.type === 'sketch' && profCount(s) && featIndex(s.id) < end && statusOf(s.id).state === 'ok';
  const sel = selFeature && featById(selFeature);
  if (ok(sel)) return sel;
  if (lastSketchId && ok(featById(lastSketchId))) return featById(lastSketchId);
  for (let i = end - 1; i >= 0; i--) if (ok(doc.features[i])) return doc.features[i];
  return null;
}
function newProfileFeature(type) {
  const sk = activeSketch();
  if (!sk) { toast('Create a sketch with a closed profile first'); return; }
  const snap = JSON.stringify(doc); checkpoint();
  const op = bodiesAtInsert().length ? 'join' : 'new';
  const f = type === 'extrude'
    ? { id: uid(), type, name: nextName(type), sketch: sk.id, distance: 10, direction: 'one', op, target: null }
    : { id: uid(), type, name: nextName(type), sketch: sk.id, axis: 'v', angle: 360, op, target: null };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
function startCreateSketch() {
  startPick({ prompt: 'Select a plane or flat face to sketch on', planes: true, faces: true, then: c => {
    checkpoint();
    const f = { id: uid(), type: 'sketch', name: nextName('sketch'), plane: c.plane, offset: c.offset || 0, flip: !!c.flip, profiles: [], ...(c.body && compOfBody(c.body) ? { body: c.body } : {}) };
    insertFeature(f); lastSketchId = f.id;
    doRegen(); enterSketch(f.id); setSketchTool('rect2');
  } });
}
const PLACED_DEFAULTS = {
  hole: { diameter: 6, depth: 10, cbore: false, cbDiameter: 11, cbDepth: 4, tip: true, tipAngle: 118 },
  box: { w: 40, d: 30, h: 20 }, cylinder: { diameter: 30, h: 30 }, sphere: { diameter: 30 }, torus: { major: 40, minor: 10 },
};
function startPlaced(type) {
  startPick({ prompt: type === 'hole' ? 'Click a flat face or plane where the hole goes' : `Click a plane or flat face to place the ${TYPE[type].label.toLowerCase()}`, planes: true, faces: true, then: c => {
    const snap = JSON.stringify(doc); checkpoint();
    const f = { id: uid(), type, name: nextName(type), plane: c.plane, offset: c.offset || 0, flip: !!c.flip, cx: c.local ? c.local.x : 0, cy: c.local ? c.local.y : 0, ...PLACED_DEFAULTS[type] };
    if (type !== 'hole') { f.op = bodiesAtInsert().length && c.face ? 'join' : 'new'; f.target = null; }
    insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  } });
}
function repositionPlaced(f) {
  startPick({ prompt: 'Click the new face and point', planes: true, faces: true, then: c => {
    checkpoint(); Object.assign(f, { plane: c.plane, offset: c.offset || 0, flip: !!c.flip, cx: c.local ? c.local.x : f.cx, cy: c.local ? c.local.y : f.cy });
    rerenderDialog(); scheduleRegen(0);
  } });
}
function startOffsetPlane() {
  startPick({ prompt: 'Select a plane or flat face to offset from', planes: true, faces: true, then: c => {
    const snap = JSON.stringify(doc); checkpoint();
    const f = { id: uid(), type: 'plane', name: nextName('plane'), base: c.plane, offset: fmt((c.offset || 0) + (c.flip ? -10 : 10)) * 1, flip: !!c.flip };
    insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  } });
}
function lastSolidBefore() {
  const end = insertIndex(), sel = selFeature && featById(selFeature);
  if (sel && SOLIDS.has(sel.type) && featIndex(sel.id) < end) return sel;
  for (let i = end - 1; i >= 0; i--) if (SOLIDS.has(doc.features[i].type) && !doc.features[i].suppressed) return doc.features[i];
  return null;
}
function newRepeat(type, kind) {
  const src = lastSolidBefore();
  if (!src) { toast('Create a solid feature first, then pattern or mirror it'); return; }
  const snap = JSON.stringify(doc); checkpoint();
  const f = type === 'pattern'
    ? { id: uid(), type, name: nextName(type), kind, source: src.id, axis: kind === 'circular' ? 'Z' : 'X', count: kind === 'circular' ? 4 : 3, angle: 360, spacing: 20, axis2: 'Y', count2: 1, spacing2: 20 }
    : { id: uid(), type, name: nextName(type), source: src.id, plane: 'YZ' };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
function newMove() {
  const bodies = bodiesAtInsert();
  if (!bodies.length) { toast('There is no body to move yet'); return; }
  const body = selBody && bodies.includes(selBody) ? selBody : bodies[bodies.length - 1];
  const snap = JSON.stringify(doc); checkpoint();
  const f = { id: uid(), type: 'move', name: nextName('move'), body, copy: false, dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
function newCombine() {
  const bodies = bodiesAtInsert();
  if (bodies.length < 2) { toast('Combine needs at least two bodies. Use New Body when you extrude or add a box.'); return; }
  const target = selBody && bodies.includes(selBody) ? selBody : bodies[0];
  const snap = JSON.stringify(doc); checkpoint();
  const f = { id: uid(), type: 'combine', name: nextName('combine'), target, tools: bodies.filter(b => b !== target).slice(0, 1), op: 'join', keep: false };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
function newEdgeFeature(type) {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : `${TYPE[type].label} needs the exact geometry engine, which could not start here: ${engineMsg}`); return; }
  if (!bodiesAtInsert().length) { toast('There is no body yet'); return; }
  const snap = JSON.stringify(doc); checkpoint();
  const f = { id: uid(), type, name: nextName(type), edges: [], ...(type === 'fillet' ? { radius: 2 } : type === 'chamfer' ? { distance: 1 } : type === 'draft' ? { angle: 3, neutral: 'XY', neutralOffset: 0, flipPull: false } : type === 'presspull' ? { distance: 5 } : { thickness: 2 }) };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  toast(type === 'presspull' ? 'Click a face to push or pull' : type === 'shell' ? 'Click the faces to open' : type === 'draft' ? 'Click the faces to taper' : 'Click the edges to ' + (type === 'fillet' ? 'round' : 'bevel'));
}
// ---- edge / face picking for fillet, chamfer, shell ----
function mmPerPx() { const r = renderer.domElement.getBoundingClientRect(); return camera.position.distanceTo(controls.target) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / r.height; }
function brepEdgeHit(e) {
  raycaster.setFromCamera(ndcOf(e), camera);
  raycaster.params.Line.threshold = mmPerPx() * 6;
  const objs = []; for (const [, s] of shownBodies) if (s.edges.visible !== false && s.rec.shape && s.mesh.visible) objs.push(s.edges);
  scene.updateMatrixWorld();
  const hit = raycaster.intersectObjects(objs, false)[0];
  if (!hit) return null;
  const s = shownBodies.get(hit.object.userData.body); if (!s) return null;
  const m = brepMeshOf(s.rec), hash = m.segEdge[Math.floor(hit.index / 2)];
  return hash == null ? null : { body: s.rec.id, rec: s.rec, hash, sig: brepSigMap(s.rec, 'edge').get(hash) };
}
function brepFaceHit(e) {
  raycaster.setFromCamera(ndcOf(e), camera);
  const objs = []; for (const [, s] of shownBodies) if (s.rec.shape && s.mesh.visible) objs.push(s.mesh);
  scene.updateMatrixWorld();
  const hit = raycaster.intersectObjects(objs, false)[0];
  if (!hit) return null;
  const s = shownBodies.get(hit.object.userData.body); const m = brepMeshOf(s.rec), hash = m.triFace[hit.faceIndex];
  return { body: s.rec.id, rec: s.rec, hash, sig: brepSigMap(s.rec, 'face').get(hash) };
}
function toggleRef(f, hit) {
  if (!hit?.sig) return;
  checkpoint();
  const key = f.type === 'shell' ? 'c' : 'p';
  const kind = FACE_PICK.has(f.type) ? 'face' : 'edge';
  const cur = brepRefHashes(hit.rec, f.edges || [], kind);
  if (cur.has(hit.hash)) {
    // remove the stored reference that resolves to this item
    f.edges = (f.edges || []).filter(r => !brepRefHashes(hit.rec, [r], kind).has(hit.hash));
  } else f.edges = [...(f.edges || []), JSON.parse(JSON.stringify(hit.sig))];
  void key;
  rerenderDialog(); drawToolsOverlay(); scheduleRegen(60);
}
function sketchPathCount(s) {
  if (!s?.geo?.curves?.length) return 0;
  try { const sol = solveSketch(resolvedGeo(s.geo)); return sol.ok ? geoPaths(resolvedGeo(s.geo), sol).paths.length : 0; } catch (e) { return 0; }
}
function newSweep(pipe) {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : 'Sweep needs the exact geometry engine, which could not start here: ' + engineMsg); return; }
  const end = insertIndex();
  const paths = doc.features.slice(0, end).filter(g => g.type === 'sketch' && sketchPathCount(g) && statusOf(g.id).state === 'ok');
  if (!paths.length) { toast('Sketch a path first: lines and arcs joined end to end (it can stay open)'); return; }
  const sel = selFeature && featById(selFeature);
  const path = paths.includes(sel) ? sel : paths[paths.length - 1];
  const profileSk = doc.features.slice(0, end).filter(g => g.type === 'sketch' && g.id !== path.id && profCount(g) === 1).pop();
  const snap = JSON.stringify(doc); checkpoint();
  const f = { id: uid(), type: 'sweep', name: nextName('sweep'), path: path.id, pathIndex: 0, profileKind: pipe || !profileSk ? 'circle' : 'sketch', profile: profileSk?.id || null, diameter: 8, wall: pipe ? 1 : 0, op: bodiesAtInsert().length ? 'join' : 'new', target: null };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
function newLoft() {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : 'Loft needs the exact geometry engine, which could not start here: ' + engineMsg); return; }
  const end = insertIndex();
  const cands = doc.features.slice(0, end).filter(g => g.type === 'sketch' && profCount(g) === 1 && statusOf(g.id).state === 'ok');
  if (cands.length < 2) { toast('Loft needs two sketches with one closed profile each, on different planes'); return; }
  const snap = JSON.stringify(doc); checkpoint();
  const f = { id: uid(), type: 'loft', name: nextName('loft'), sketches: cands.slice(-2).map(s => s.id), ruled: false, op: bodiesAtInsert().length ? 'join' : 'new', target: null };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
// ---- STEP import ----
const importPending = new Set();
function ensureImports() {
  for (const f of doc.features) {
    if (f.type !== 'import' || !f.file || importsRead.has(f.file) || importPending.has(f.file)) continue;
    const file = doc.files?.[f.file]; if (!file) continue;
    importPending.add(f.file);
    brepImportSTEP(f.file, file.text).catch(e => { importsRead.add(f.file); toast('Could not read ' + file.name + ': ' + occMsg(e)); })
      .finally(() => { importPending.delete(f.file); scheduleRegen(0); });
  }
}
function startImportSTEP() {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : 'STEP import needs the exact geometry engine, which could not start here: ' + engineMsg); return; }
  $('#stepInput').click();
}
$('#stepInput').addEventListener('change', e => {
  const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
  if (file.size > 25e6) { toast('That file is over 25 MB. Larger imports come with background processing.'); return; }
  const rd = new FileReader();
  rd.onload = async () => {
    const text = String(rd.result);
    if (!/ISO-10303-21/.test(text.slice(0, 2000))) { toast('That is not a STEP file'); return; }
    const fileId = uid();
    toast('Reading ' + file.name + '…');
    try {
      const n = await brepImportSTEP(fileId, text);
      if (!n) { toast('No solid bodies found in ' + file.name); return; }
      checkpoint();
      doc.files ||= {}; doc.files[fileId] = { name: file.name, text };
      const f = { id: uid(), type: 'import', name: file.name.replace(/\.(step|stp)$/i, ''), file: fileId };
      insertFeature(f); await doRegen(); setView('fit');
      toast(`Imported ${n} bod${n === 1 ? 'y' : 'ies'} from ${file.name}`);
    } catch (err) { toast('Could not read ' + file.name + ': ' + occMsg(err)); }
  };
  rd.readAsText(file);
});
function deleteSelection() {
  if (selFeature) return deleteFeature(selFeature);
  if (selBody) {
    checkpoint();
    const f = { id: uid(), type: 'remove', name: 'Remove ' + bodyName(selBody), body: selBody };
    insertFeature(f); selFeature = null; selBody = null; scheduleRegen(0);
    toast('Body removed. The Remove step is in the timeline.');
    return;
  }
  toast('Select a body or a timeline step first');
}

// ---------- material & appearance (not in the timeline) ----------
function bodyTargetSelect(state) {
  const s = h('select', { id: 'mt-body' }, h('option', { value: '' }, 'All bodies (default)'), [...result.bodies.keys()].map(id => h('option', { value: id, selected: state.body === id }, bodyName(id))));
  s.addEventListener('change', () => { state.body = s.value || null; rerenderDialog(); });
  return row('Bodies', s, 'mt-body');
}
function openMaterialDialog() {
  const before = JSON.stringify({ m: doc.bodyMeta, d: doc.material });
  const st = { body: selBody };
  let changed = false;
  openPanelDialog({ title: 'Physical Material', icon: 'material', help: 'Material sets density for mass and the default color.',
    body: () => {
      const cur = st.body ? bodyMaterial(st.body) : doc.material;
      const list = h('div', { class: 'picklist', style: 'max-height:260px' });
      for (const [name, m] of Object.entries(MATERIALS)) {
        list.append(h('button', { class: 'mi', style: name === cur ? 'background:var(--hover)' : '', 'aria-pressed': String(name === cur), onclick: () => {
          if (!changed) { checkpoint(); changed = true; }
          if (st.body) { meta(st.body).material = name; delete meta(st.body).color; } else { doc.material = name; for (const k in doc.bodyMeta) { delete doc.bodyMeta[k].material; delete doc.bodyMeta[k].color; } }
          mpCache = null; updateScene(); renderBrowser(); renderInfo(); rerenderDialog(); persist();
        }, html: `<span class="swatch" style="background:${m.color};width:14px;height:14px"></span><span class="lab">${name}</span><span class="key">${m.density} g/cm³</span>` }));
      }
      return [section_('Apply to', bodyTargetSelect(st)), section_('Library', list)];
    },
    onOK: () => { },
    onCancel: () => { if (changed) { const b = JSON.parse(before); doc.bodyMeta = b.m; doc.material = b.d; history.undo.pop(); updateUndoButtons(); mpCache = null; updateScene(); renderBrowser(); renderInfo(); } },
  });
}
function openAppearanceDialog() {
  const before = JSON.stringify(doc.bodyMeta);
  const st = { body: selBody || [...result.bodies.keys()][0] || null };
  if (!st.body) { toast('There is no body to color yet'); return; }
  let changed = false;
  openPanelDialog({ title: 'Appearance', icon: 'appearance', help: 'Appearance changes color only. Mass still comes from the physical material.',
    body: () => {
      const s = h('select', { id: 'ap-body' }, [...result.bodies.keys()].map(id => h('option', { value: id, selected: st.body === id }, bodyName(id))));
      s.addEventListener('change', () => { st.body = s.value; rerenderDialog(); });
      const c = h('input', { type: 'color', id: 'ap-color', value: bodyColor(st.body), style: 'width:100%;height:32px;border:1px solid var(--line);border-radius:3px;background:var(--raised)' });
      c.addEventListener('input', () => { if (!changed) { checkpoint(); changed = true; } meta(st.body).color = c.value; updateScene(); renderBrowser(); persist(); });
      const sw = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' }, ['#D24D3E', '#E58A2E', '#E8C547', '#4DA463', '#3F8FD6', '#7559C7', '#2F3640', '#F2F2EE'].map(col => h('button', { class: 'iconbtn', 'aria-label': 'Color ' + col, style: `background:${col};border:1px solid var(--line)`, onclick: () => { if (!changed) { checkpoint(); changed = true; } meta(st.body).color = col; updateScene(); renderBrowser(); rerenderDialog(); persist(); } })));
      return [section_('Body', row('Body', s, 'ap-body')), section_('Color', row('Custom', c, 'ap-color'), h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Swatches'), sw),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', onclick: () => { if (!changed) { checkpoint(); changed = true; } delete meta(st.body).color; updateScene(); renderBrowser(); rerenderDialog(); } }, 'Use material color')))];
    },
    onOK: () => { },
    onCancel: () => { if (changed) { doc.bodyMeta = JSON.parse(before); history.undo.pop(); updateUndoButtons(); updateScene(); renderBrowser(); } },
  });
}

// ---------- inspect ----------
function startMeasure() {
  if (measure) { closeDialog(false); return; }
  cancelPick();
  measure = { pts: [] };
  openPanelDialog({ title: 'Measure', icon: 'measure', cancelLabel: 'Close', help: 'Points snap to nearby corners.',
    body: () => {
      const [a, b] = measure?.pts || [];
      const kids = [h('p', { class: 'note' }, a && b ? 'Click again to start a new measurement.' : a ? 'Click the second point.' : 'Click the first point on the model.')];
      if (a && b) {
        const d = b.clone().sub(a);
        kids.push(h('dl', { class: 'stat' }, ...[['Distance', fix(d.length(), 3) + ' mm'], ['ΔX', fix(d.x, 3) + ' mm'], ['ΔY', fix(d.y, 3) + ' mm'], ['ΔZ', fix(d.z, 3) + ' mm'],
          ['Point 1', `${fix(a.x, 2)}, ${fix(a.y, 2)}, ${fix(a.z, 2)}`], ['Point 2', `${fix(b.x, 2)}, ${fix(b.y, 2)}, ${fix(b.z, 2)}`]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
      }
      return [section_('Result', ...kids), section_(null, h('button', { class: 'btn', onclick: () => { measure.pts = []; drawToolsOverlay(); rerenderDialog(); } }, 'Clear'))];
    },
    onCancel: () => { measure = null; drawToolsOverlay(); defaultHint(); renderRibbon(); },
  });
  defaultHint(); renderRibbon();
}
function openSectionDialog() {
  const prev = section ? { ...section } : null;
  if (!section) { const b = visibleBox(); section = { axis: 'Z', offset: +fix(b.getCenter(new THREE.Vector3()).z, 1).replace(/,/g, ''), flip: false }; }
  section.hidden = false;
  const apply = () => { updateScene(); renderBrowser(); };
  openPanelDialog({ title: 'Section Analysis', icon: 'section', help: 'Cuts the view, not the model.',
    body: () => {
      const b = visibleBox(), lo = b.min[section.axis.toLowerCase()], hi = b.max[section.axis.toLowerCase()];
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Section plane' });
      for (const [v, t] of [['X', 'YZ (X)'], ['Y', 'XZ (Y)'], ['Z', 'XY (Z)']]) seg.append(h('button', { type: 'button', 'aria-pressed': String(section.axis === v), onclick: () => { section.axis = v; const bb = visibleBox(); section.offset = +((bb.min[v.toLowerCase()] + bb.max[v.toLowerCase()]) / 2).toFixed(1); apply(); rerenderDialog(); } }, t));
      const num = h('input', { type: 'number', id: 'sec-off', step: '0.5', value: String(section.offset), style: 'width:100%;height:28px;border:1px solid var(--line);border-radius:3px;background:var(--raised);padding:0 6px;font-family:var(--font-data)' });
      const rng = h('input', { type: 'range', id: 'sec-rng', min: String(Math.floor(lo - 1)), max: String(Math.ceil(hi + 1)), step: '0.5', value: String(section.offset), style: 'width:100%', 'aria-label': 'Section position' });
      num.addEventListener('input', () => { if (isFinite(+num.value)) { section.offset = +num.value; rng.value = num.value; apply(); } });
      rng.addEventListener('input', () => { section.offset = +rng.value; num.value = rng.value; apply(); });
      const fl = h('input', { type: 'checkbox', id: 'sec-flip', checked: section.flip });
      fl.addEventListener('change', () => { section.flip = fl.checked; apply(); });
      return [section_('Plane', h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Cut along'), seg), row('Position (mm)', num, 'sec-off'), h('div', { class: 'row' }, h('span', { class: 'rl' }), rng),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('label', { class: 'chk', for: 'sec-flip' }, fl, 'Flip side')))];
    },
    onOK: () => { apply(); renderRibbon(); },
    onCancel: () => { section = prev; apply(); renderRibbon(); },
  });
  apply();
}
function applySectionVisibility() { updateScene(); renderBrowser(); }
function toggleCOM() {
  if (showCOM) { showCOM = false; if (dlg?.custom?.title === 'Center of Mass') closeDialog(false); drawToolsOverlay(); renderRibbon(); return; }
  showCOM = true; drawToolsOverlay();
  openPanelDialog({ title: 'Center of Mass', icon: 'com', cancelLabel: 'Close', help: 'Uses each body\'s physical material.',
    body: () => { const mp = massProps(), c = mp.total.com; return [section_('Visible bodies', h('dl', { class: 'stat' }, ...[['X', fix(c.x, 3) + ' mm'], ['Y', fix(c.y, 3) + ' mm'], ['Z', fix(c.z, 3) + ' mm'], ['Mass', fix(mp.total.mass, 2) + ' g']].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])))]; },
    onCancel: () => { showCOM = false; drawToolsOverlay(); renderRibbon(); },
  });
}

// ---------- files ----------
let downloadsNS = null;
try { window.claude?.use?.('downloads')?.then(ns => { downloadsNS = ns; }).catch(() => { }); } catch (e) { }
async function saveFile(filename, data, mime = 'application/octet-stream') {
  if (downloadsNS) {
    try { await downloadsNS.save({ filename, data }); toast('Saved ' + filename); }
    catch (e) { toast(e?.code === 'declined' ? 'Save cancelled' : 'This view cannot save files (' + (e?.code || 'unavailable') + ')'); }
    return;
  }
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
  const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Saved ' + filename);
}
const slug = () => (doc.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
function saveProject() { saveFile(slug() + '.draftwork.json', JSON.stringify(doc, null, 2), 'application/json'); dirty = false; $('#dirty').hidden = true; }
function openExportDialog(only) {
  const ids = [...result.bodies.keys()];
  if (!ids.length) { toast('There is no body to export yet'); return; }
  const st = { pick: new Set(only || ids.filter(id => !bodyHidden(id))), separate: false, format: isBrep() ? 'step' : 'stl' };
  openPanelDialog({ title: 'Export', icon: 'exportstl', okLabel: 'Export', help: 'Files are packed in a .zip together with the project file.',
    body: () => {
      const list = h('div', { class: 'picklist' });
      for (const id of ids) {
        const cid = 'ex-' + id.replace(/[^a-z0-9]/gi, '_');
        const c = h('input', { type: 'checkbox', id: cid, checked: st.pick.has(id) });
        c.addEventListener('change', () => { c.checked ? st.pick.add(id) : st.pick.delete(id); });
        list.append(h('label', { class: 'chk', for: cid }, c, h('span', { class: 'swatch', style: `background:${bodyColor(id)}` }), bodyName(id)));
      }
      const sep = h('input', { type: 'checkbox', id: 'ex-sep', checked: st.separate });
      sep.addEventListener('change', () => { st.separate = sep.checked; });
      const fmtSel = h('select', { id: 'ex-fmt' }, h('option', { value: 'step', selected: st.format === 'step', disabled: !isBrep() }, 'STEP (exact solids, for CAD and CAM)'), h('option', { value: 'stl', selected: st.format === 'stl' }, 'STL (mesh, for 3D printing)'));
      fmtSel.addEventListener('change', () => { st.format = fmtSel.value; });
      return [section_('Format', row('Format', fmtSel, 'ex-fmt'), isBrep() ? null : h('p', { class: 'note' }, 'STEP needs the exact engine, which is not running.')), section_('Bodies', list),
        section_('Options', h('label', { class: 'chk', for: 'ex-sep' }, sep, 'One file per body'), h('p', { class: 'note' }, 'Units: millimeters.'))];
    },
    onOK: () => {
      const chosen = ids.filter(id => st.pick.has(id));
      if (!chosen.length) { toast('Choose at least one body'); return; }
      const niOf = id => { const b = result.bodies.get(id), g = b.shape ? brepGeomNI(b) : b.geom, m = bodyXf(id); return m === IDENT ? g : g.clone().applyMatrix4(m); };   // assembled position
      const fname = id => bodyName(id).replace(/[^a-z0-9]+/gi, '-') || 'body';
      (async () => {
        let files;
        if (st.format === 'step' && isBrep()) {
          const item = id => ({ shape: result.bodies.get(id).shape, name: bodyName(id), color: bodyColor(id), place: bodyXf(id) === IDENT ? null : xfParts(bodyXf(id)) });
          const groups = st.separate ? chosen.map(id => [fname(id), [item(id)]]) : [[slug(), chosen.map(item)]];
          files = [];
          for (const [n, items] of groups) files.push({ name: n + '.step', data: await brepSTEP(items) });
        } else {
          files = st.separate ? chosen.map(id => ({ name: fname(id) + '.stl', data: toBinarySTL(niOf(id), bodyName(id)) }))
            : [{ name: slug() + '.stl', data: toBinarySTL(mergeBodies(chosen.map(niOf)), doc.name) }];
        }
        files.push({ name: slug() + '.draftwork.json', data: JSON.stringify(doc, null, 2) });
        saveFile(slug() + '-' + st.format + '.zip', makeZip(files), 'application/zip');
      })().catch(err => toast('Export failed: ' + occMsg(err)));
    },
  });
}
function loadDoc(d, msg) {
  if (dlg) closeDialog(true, true);
  if (mode === 'sketch') exitSketch(true);
  cancelPick(); measure = null; section = null; showCOM = false;
  checkpoint(); doc = d; cache = []; selFeature = null; selBody = null; lastSketchId = null;
  afterDocReplace(); defaultHint(); renderRibbon(); setTimeout(() => setView('iso'), 80); if (msg) toast(msg);
}
$('#fileInput').addEventListener('change', e => {
  const file = e.target.files?.[0]; if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { const d = upgradeDoc(JSON.parse(rd.result)); if (!d) throw new Error('bad'); loadDoc(d, 'Opened ' + file.name); }
    catch (err) { toast('That file is not a Draftwork project'); }
  };
  rd.readAsText(file); e.target.value = '';
});

// ---------- sketch mode ----------
function enterSketch(id) {
  const sk = featById(id); if (!sk) return;
  if (dlg) closeDialog(true);
  cancelPick();
  mode = 'sketch'; sketchId = id; selFeature = id; selBody = null; selProfile = null; lineDraft = null; drag = null; gdraw = null; geoSel.clear(); geoHover = null; geoCache = null; activeTab = 'SKETCH';
  lastSketchId = id;
  renderRibbon(); renderPalette(); updateScene(); renderTimeline(); renderBrowser();
  lookAtMatrix(sketchMatrix(sk));
  setSketchTool('select');
}
function exitSketch(silent) {
  mode = 'model'; sketchId = null; drag = null; lineDraft = null; gdraw = null; geoSel.clear(); geoHover = null; selProfile = null; sketchTool = 'select';
  viewport.classList.remove('drawing', 'moving'); activeTab = 'SOLID';
  renderRibbon(); renderPalette(); defaultHint();
  if (!silent) { updateScene(); renderTimeline(); renderBrowser(); }
}
function finishSketch(silent) {
  const sk = featById(sketchId);
  const M = sk ? sketchMatrix(sk) : null;
  exitSketch(false);
  if (!sk) return;
  const used = doc.features.some(f => f.sketch === sk.id);
  if (!silent && profCount(sk) && !used) toast('Sketch finished. Press E to extrude it.');
  else if (!silent && sk.geo?.curves.length && !profCount(sk)) toast('Sketch finished. It has no closed profile yet, so it cannot be extruded.');
  const n = new THREE.Vector3(0, 0, 1).transformDirection(M), view = camera.position.clone().sub(controls.target).normalize();
  if (!silent && Math.abs(n.dot(view)) > 0.97) setView('iso');
  scheduleRegen(0);
}
function setSketchTool(t) {
  sketchTool = t; lineDraft = null; drag = null; gdraw = null; trimHover = null;
  viewport.classList.toggle('drawing', mode === 'sketch' && t !== 'select');
  renderRibbon(); defaultHint(); refreshOverlays();
}
function deleteProfile(id) {
  const sk = featById(sketchId); if (!sk) return;
  checkpoint();
  sk.profiles = sk.profiles.filter(p => p.id !== id);
  if (selProfile === id) selProfile = null;
  renderPalette(); refreshOverlays(); scheduleRegen(0);
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
function ndcOf(e) { const r = renderer.domElement.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
function startPick(o) {
  if (measure) closeDialog(false);
  pick = o; pickHover = null;
  viewport.classList.add('picking');
  updateScene(); defaultHint();
}
function cancelPick() {
  if (!pick) return;
  pick = null; pickHover = null; viewport.classList.remove('picking');
  updateScene(); defaultHint();
}
function completePick(c) {
  const p = pick; pick = null; pickHover = null;
  viewport.classList.remove('picking'); defaultHint();
  updateScene();
  p.then(c);
}
const snapHalf = v => Math.round(v * 2) / 2;
function pickAt(e) {
  raycaster.setFromCamera(ndcOf(e), camera);
  const targets = [];
  if (pick.planes) { originGroup.traverse(o => { if (o.isMesh && o.userData.pickable) targets.push(o); }); planesGroup.traverse(o => { if (o.isMesh && o.userData.pickable) targets.push(o); }); }
  if (pick.faces) for (const [id, s] of shownBodies) if (s.mesh.visible) targets.push(s.mesh);
  scene.updateMatrixWorld();
  let hits = raycaster.intersectObjects(targets, false);
  // A face beats a plane at (nearly) the same depth: origin planes often slice through parts.
  const firstBody = hits.find(x => x.object.userData.body);
  if (firstBody) hits = hits.filter(x => x.object.userData.body || x.distance < firstBody.distance - Math.max(0.05, firstBody.distance * 1e-3));
  for (let hit of hits) {
    const ud = hit.object.userData;
    if (ud.plane) {
      const M = PLANES[ud.plane] ? planeMatrix(ud.plane, 0) : planeMatrixOf(ud.plane);
      const l = hit.point.clone().applyMatrix4(M.clone().invert());
      return { plane: ud.plane, offset: 0, flip: false, M, local: { x: snapHalf(l.x), y: snapHalf(l.y) }, label: PLANES[ud.plane] ? ud.plane + ' plane' : featById(ud.plane)?.name };
    }
    if (ud.body) {
      // work in the body's as-modeled coordinates (its component may be moved by joints)
      hit = { ...hit, point: hit.point.clone().applyMatrix4(bodyXf(ud.body).clone().invert()) };
      const n = hit.face.normal.clone(), a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
      const ax = a.indexOf(Math.max(...a));
      if (a[ax] < 0.999) {
        const s = shownBodies.get(ud.body);
        let nn = n.clone();
        if (s?.rec.shape) {
          const sig = brepSigMap(s.rec, 'face').get(brepMeshOf(s.rec).triFace[hit.faceIndex]);
          if (sig && sig.type !== 'PLANE') return { invalid: true, msg: 'Curved faces cannot hold a sketch. Pick a flat face or a plane.' };
          if (sig) { const sn = new THREE.Vector3(...sig.n); if (sn.lengthSq() > 0.5) nn = sn.dot(n) < 0 ? sn.negate() : sn; }
        }
        const frame = frameFromPoint(hit.point, nn);
        const M = planeMatrix(frame, 0, false);
        return { plane: frame, offset: 0, flip: false, face: true, body: ud.body, M, local: { x: 0, y: 0 }, label: `Angled face of ${bodyName(ud.body)}` };
      }
      const p = hit.point; let base, offset, flip;
      if (ax === 2) { base = 'XY'; offset = p.z; flip = n.z < 0; }
      else if (ax === 1) { base = 'XZ'; offset = -p.y; flip = n.y > 0; }
      else { base = 'YZ'; offset = p.x; flip = n.x < 0; }
      offset = Math.round(offset * 1000) / 1000;
      const M = planeMatrix(base, offset, flip);
      const l = p.clone().applyMatrix4(M.clone().invert());
      return { plane: base, offset, flip, face: true, body: ud.body, M, local: { x: snapHalf(l.x), y: snapHalf(l.y) }, label: `Face of ${bodyName(ud.body)} (${base} at ${fmt(offset)} mm${flip ? ', facing back' : ''})` };
    }
  }
  return null;
}
function bodyHit(e) {
  raycaster.setFromCamera(ndcOf(e), camera);
  const meshes = []; for (const [, s] of shownBodies) if (s.mesh.visible) meshes.push(s.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  // snap to the nearest corner of the triangle when close on screen
  const r = renderer.domElement.getBoundingClientRect();
  const pos = hit.object.geometry.attributes.position;
  let best = hit.point.clone(), bestD = 10;
  for (const k of [hit.face.a, hit.face.b, hit.face.c]) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, k), s = v.clone().project(camera);
    const d = Math.hypot((s.x + 1) / 2 * r.width - (e.clientX - r.left), (1 - s.y) / 2 * r.height - (e.clientY - r.top));
    if (d < bestD) { bestD = d; best = v; }
  }
  return { point: best, body: hit.object.userData.body };
}

// ---------- viewport pointer handling ----------
let downAt = null;
viewport.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, b: e.button }; });
viewport.addEventListener('pointerdown', partDragStart, true);   // dragging a jointed part (assembly.js)
viewport.addEventListener('pointerup', e => {
  if (!downAt || downAt.b !== 0 || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) { downAt = null; return; }
  downAt = null;
  if (e.target.closest('.dim')) return;
  if (pick) {
    const c = pickAt(e);
    if (!c) return;
    if (c.invalid) { toast(c.msg); return; }
    completePick(c); return;
  }
  if (jointEdit?.stage && jointPickAt(e)) return;
  const rf = regionDialogFeature();
  if (rf && toggleRegion(rf, regionAt(e, rf))) return;
  const ef = edgeDialogFeature();
  if (ef) { toggleRef(ef, FACE_PICK.has(ef.type) ? brepFaceHit(e) : brepEdgeHit(e)); return; }
  if (measure) {
    const hit = bodyHit(e); if (!hit) return;
    if (measure.pts.length >= 2) measure.pts = [];
    measure.pts.push(hit.point); drawToolsOverlay(); rerenderDialog(); return;
  }
  if (mode === 'model') {
    const hit = bodyHit(e);
    if (hit) selectBody(hit.body);
    else if (selBody || selFeature) { selBody = null; selFeature = null; updateScene(); renderTimeline(); renderBrowser(); }
  }
});
let hoverRaf = 0;
viewport.addEventListener('pointermove', e => {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (pick && !e.buttons) {
      const c = pickAt(e);
      pickHover = c && !c.invalid ? c : null;
      setHint(c ? (c.invalid ? 'This face cannot be used yet' : c.label) : pick.prompt + ' · Esc cancels');
      drawToolsOverlay();
    } else if (edgeDialogFeature() && !e.buttons) {
      const ef = edgeDialogFeature(), hit = FACE_PICK.has(ef.type) ? brepFaceHit(e) : brepEdgeHit(e);
      const nh = hit ? { body: hit.body, hash: hit.hash } : null;
      if (JSON.stringify(nh) !== JSON.stringify(edgeHover)) { edgeHover = nh; drawToolsOverlay(); }
    } else if (mode === 'sketch' && !e.buttons) sketchHover(e);
  });
});

// sketch input
function planeHit(e) {
  const sk = featById(sketchId); if (!sk) return null;
  const M = sketchMatrix(sk);
  raycaster.setFromCamera(ndcOf(e), camera);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(M), o = new THREE.Vector3().setFromMatrixPosition(M);
  const p = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, o), p)) return null;
  p.applyMatrix4(M.clone().invert());
  const r = renderer.domElement.getBoundingClientRect();
  const mmPerPx = camera.position.distanceTo(controls.target) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / r.height;
  return { x: p.x, y: p.y, tol: mmPerPx * 8 };
}
const snap = v => sketchOpts.snap ? Math.round(v) : Math.round(v * 100) / 100;
function distToPoly(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
function pickProfile(sk, hit) {
  let best = null, bestArea = Infinity;
  const pt = new THREE.Vector2(hit.x, hit.y);
  const live = liveProfiles(sk);
  sk.profiles.forEach((pr, i) => {
    let poly; try { poly = profilePolygon(live[i]); } catch (e) { return; }
    const near = distToPoly(pt, poly) < hit.tol;
    if (near || polyContains(poly, pt)) { const a = near ? 0 : polyArea(poly); if (a < bestArea) { best = pr; bestArea = a; } }
  });
  return best;
}
function cancelModes(toSelect) {
  closeMenus(); cancelPick();
  if (measure) closeDialog(false);
  if (mode === 'sketch' && toSelect) setSketchTool('select');
}

// ---------- view cube ----------
const vcEl = $('#viewcube');
const vcRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
vcRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
vcEl.append(vcRenderer.domElement);
vcRenderer.domElement.setAttribute('role', 'img'); vcRenderer.domElement.setAttribute('aria-label', 'View cube. Click a face to look from that side.');
const vcScene = new THREE.Scene();
const vcCam = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 30);
const vcGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5); vcGeo.rotateX(Math.PI / 2);
const VC_FACES = ['right', 'left', 'top', 'bottom', 'front', 'back'];
const vcMats = VC_FACES.map(() => new THREE.MeshBasicMaterial({ color: 0xffffff }));
const vcCube = new THREE.Mesh(vcGeo, vcMats); vcScene.add(vcCube);
const vcEdges = new THREE.LineSegments(new THREE.EdgesGeometry(vcGeo), new THREE.LineBasicMaterial({ color: 0x8a939c })); vcScene.add(vcEdges);
const vcTriad = new THREE.Group(); vcScene.add(vcTriad);
for (const [d, c] of [[[1, 0, 0], 0xd9534a], [[0, 1, 0], 0x3faa5b], [[0, 0, 1], 0x3d7be0]]) {
  const o = new THREE.Vector3(-0.78, -0.78, -0.78);
  vcTriad.add(line([o, o.clone().add(new THREE.Vector3(...d).multiplyScalar(1.95))], c));
}
let vcHover = -1;
function drawViewCubeFaces() {
  if (!colors.panel) return;
  VC_FACES.forEach((name, i) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#' + colors.panel.getHexString(); g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#' + colors.line.getHexString(); g.lineWidth = 4; g.strokeRect(2, 2, 124, 124);
    g.fillStyle = '#' + colors.fg.getHexString(); g.font = '600 24px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name.toUpperCase(), 64, 66);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    vcMats[i].map?.dispose(); vcMats[i].map = tex; vcMats[i].needsUpdate = true;
  });
  requestRender();
}
function renderViewCube() {
  const dir = camera.position.clone().sub(controls.target).normalize();
  vcCam.position.copy(dir.multiplyScalar(8)); vcCam.up.copy(camera.up); vcCam.lookAt(0, 0, 0);
  vcMats.forEach((m, i) => m.color.set(i === vcHover ? 0xbcd3fa : 0xffffff));
  vcRenderer.render(vcScene, vcCam);
}
new ResizeObserver(() => { const s = vcEl.clientWidth; vcRenderer.setSize(s, s); requestRender(); }).observe(vcEl);
function vcFaceAt(e) {
  const r = vcRenderer.domElement.getBoundingClientRect();
  const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), vcCam);
  const hit = rc.intersectObject(vcCube)[0];
  return hit ? hit.face.materialIndex : -1;
}
vcRenderer.domElement.addEventListener('pointermove', e => { const f = vcFaceAt(e); if (f !== vcHover) { vcHover = f; requestRender(); } });
vcRenderer.domElement.addEventListener('pointerleave', () => { vcHover = -1; requestRender(); });
vcRenderer.domElement.addEventListener('click', e => { const f = vcFaceAt(e); if (f >= 0) setView(VC_FACES[f]); });
$('#vcHome').innerHTML = icon('home');
$('#vcHome').addEventListener('click', () => setView('iso'));

// ---------- navigation bar ----------
function renderNavbar() {
  const nb = $('#navbar'); nb.replaceChildren();
  const b = (ic, label, fn, o = {}) => h('button', { class: 'nbtn' + (o.cls ? ' ' + o.cls : ''), title: label, 'aria-label': label, 'aria-pressed': o.pressed != null ? String(o.pressed) : null, onclick: fn, html: icon(ic) });
  const setNav = m => { navMode = m; controls.mouseButtons.LEFT = m === 'pan' ? THREE.MOUSE.PAN : m === 'zoom' ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE; renderNavbar(); };
  nb.append(b('orbit', 'Orbit', () => setNav('orbit'), { pressed: navMode === 'orbit' }), b('pan', 'Pan', () => setNav('pan'), { pressed: navMode === 'pan' }), b('zoom', 'Zoom', () => setNav('zoom'), { pressed: navMode === 'zoom' }),
    b('fit', 'Fit', () => setView('fit')), h('span', { class: 'nsep hide-narrow' }),
    b('lookat', 'Look At', () => {
      if (mode === 'sketch') return lookAtMatrix(sketchMatrix(featById(sketchId)));
      const f = selFeature && featById(selFeature);
      if (f?.type === 'sketch') return lookAtMatrix(sketchMatrix(f));
      if (f?.type === 'plane' && result.planes.has(f.id)) { const p = result.planes.get(f.id); return lookAtMatrix(planeMatrix(p.base, p.offset, p.flip)); }
      toast('Select a sketch or plane to look at');
    }, { cls: 'hide-narrow' }), h('span', { class: 'nsep' }));
  const disp = b('display', 'Display settings', e => {
    e.stopPropagation();
    openMenu(disp, [{ head: 'Visual style' }, ...[['shaded', 'Shaded'], ['edges', 'Shaded with visible edges'], ['wire', 'Wireframe']].map(([k, l]) => ({ label: l, icon: 'display', checked: visualStyle === k, action: () => { visualStyle = k; updateScene(); } })),
      '-', { label: 'Show origin', icon: 'axis', checked: !!doc.showOrigin, action: () => { doc.showOrigin = !doc.showOrigin; updateScene(); renderBrowser(); } }]);
  });
  disp.setAttribute('aria-haspopup', 'true');
  nb.append(disp, b('grid', 'Layout grid', () => { showGrid = !showGrid; updateScene(); renderNavbar(); }, { pressed: showGrid }));
}

// ---------- keyboard ----------
window.addEventListener('keydown', e => {
  const tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(); return; }
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) { if (typing) return; e.preventDefault(); (k === 'y' || e.shiftKey) ? redo() : undo(); return; }
  if (e.key === 'Escape') {
    if ($('#menus').children.length) return closeMenus();
    if (!$('#modalBack').hidden) return closeModal();
    if (pick) return cancelPick();
    document.querySelectorAll('.dimedit').forEach(x => x.remove());
    if (lineDraft) { lineDraft = null; refreshOverlays(); defaultHint(); return; }
    if (gdraw) { gdraw = null; refreshOverlays(); defaultHint(); return; }
    if (drag) { drag = null; refreshOverlays(); return; }
    if (mode === 'sketch' && sketchTool !== 'select') return setSketchTool('select');
    if (dlg) return closeDialog(false);
    if (mode === 'sketch' && (selProfile || geoSel.size)) { selProfile = null; geoSel.clear(); refreshOverlays(); renderPalette(); defaultHint(); return; }
    if (selBody || selFeature) { selBody = null; selFeature = null; updateScene(); renderTimeline(); renderBrowser(); }
    return;
  }
  if (e.key === 'Enter') {
    if (lineDraft) { e.preventDefault(); endLineChain(); return; }
    if (dlg && $('#modalBack').hidden && tag !== 'SELECT' && tag !== 'BUTTON' && tag !== 'TEXTAREA') {
      if (dlg.custom && !dlg.custom.onOK && !dlg.custom.okLabel) return;
      e.preventDefault(); closeDialog(true); return;
    }
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || !$('#modalBack').hidden) return;
  if (mode === 'sketch') {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (geoSel.size) deleteGeoSelection(); else if (selProfile) deleteProfile(selProfile); return; }
    const map = { l: 'k.line', r: 'k.rect2', c: 'k.circle', a: 'k.arc', p: 'k.polygon', s: 'k.slot', d: 'k.dimension', v: 'k.select', x: 'k.construction', t: 'k.trim', o: 'k.offset', h: 'k.c.horizontal' };
    if (map[k]) { runCmd(map[k]); return; }
    if (k === 'e') { runCmd('extrude'); return; }
    return;
  }
  const map = { e: 'extrude', h: 'hole', m: 'move', i: 'measure', a: 'appearance', q: 'presspull', f: 'fillet', j: 'joint' };
  if (map[k]) { e.preventDefault(); runCmd(map[k]); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
});

// ---------- chrome wiring ----------
$('#abData').innerHTML = icon('apps'); $('#abData').addEventListener('click', () => toast('The data panel for cloud projects is planned for Phase 2. Use Project files for now.'));
$('#abFile').innerHTML = icon('file') + icon('caret'); $('#abFile').addEventListener('click', e => { e.stopPropagation(); openFileMenu(); });
$('#abSave').innerHTML = icon('save'); $('#abSave').addEventListener('click', saveProject);
$('#abUndo').innerHTML = icon('undo'); $('#abUndo').addEventListener('click', undo);
$('#abRedo').innerHTML = icon('redo'); $('#abRedo').addEventListener('click', redo);
$('#abHelp').innerHTML = icon('help'); $('#abHelp').addEventListener('click', openHelpModal);
$('#docIco').innerHTML = icon('doc');
$('#wsBtn').insertAdjacentHTML('beforeend', icon('caret')); $('#wsBtn').addEventListener('click', e => { e.stopPropagation(); openWorkspaceMenu(); });
$('#bMin').addEventListener('click', () => { const b = $('#browser'); b.classList.toggle('min'); $('#bMin').setAttribute('aria-expanded', String(!b.classList.contains('min'))); $('#bMin').textContent = b.classList.contains('min') ? '+' : '–'; });
for (const [id, ic, fn] of [['#tlStart', 'start', () => setRollback(-1)], ['#tlPrev', 'prev', () => stepMarker(-1)], ['#tlNext', 'next', () => stepMarker(1)], ['#tlEnd', 'end', () => setRollback(null)]]) { $(id).innerHTML = icon(ic); $(id).addEventListener('click', fn); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => readTheme());
new MutationObserver(() => readTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.fonts?.ready?.then(() => drawViewCubeFaces());
if (window.innerWidth < 820) { $('#browser').classList.add('min'); $('#bMin').textContent = '+'; $('#bMin').setAttribute('aria-expanded', 'false'); }

// ---------- exact geometry engine ----------
function setEngineBadge() {
  const b = $('#engineBadge');
  const txt = { loading: 'Loading exact engine…', ready: 'Exact engine', failed: 'Mesh engine' }[engineState];
  b.className = 'engine ' + engineState; b.innerHTML = '<span class="dot"></span><span class="et">' + txt + '</span>';
  b.title = engineState === 'ready' ? 'OpenCascade B-rep kernel: exact solids, fillets, chamfers, shells, STEP export. ' + (engineMode === 'worker' ? 'Runs in the background, so long rebuilds do not pause the interface.' : 'Runs on the page (this browser would not start a background worker).')
    : engineState === 'loading' ? 'Downloading the OpenCascade kernel. You can keep working meanwhile.' : 'The exact engine could not start (' + engineMsg + '). Modeling continues with the mesh engine; fillet, chamfer, shell and STEP are unavailable.';
}
$('#engineBadge').addEventListener('click', () => toast($('#engineBadge').title));
async function loadEngine() {
  engineState = 'loading'; setEngineBadge();
  try {
    if (typeof WebAssembly !== 'object') throw new Error('WebAssembly is not available');
    await startEngine();
    engine = 'brep'; engineState = 'ready'; cache = []; mpCache = null;
    setEngineBadge(); scheduleRegen(0);
  } catch (e) {
    console.warn('Exact engine unavailable:', e);
    engine = 'mesh'; engineState = 'failed'; engineMsg = (e && e.message) || String(e);
    setEngineBadge(); scheduleRegen(0);
  }
}

// ---------- boot ----------
function start(data) {
  doc = upgradeDoc(data?.doc) || loadStored() || sampleDoc();
  $('#docTitle').textContent = doc.name;
  readTheme(); updateUndoButtons(); renderRibbon(); renderNavbar(); renderBrowser(); renderTimeline(); defaultHint();
  $('#tlInfo').textContent = 'Building…';
  setTimeout(() => { doRegen(); setView('iso', true); setTimeout(loadEngine, 50); }, 30);
}
try { window.claude?.hot?.snapshot?.(() => ({ doc })); } catch (e) { }
if (window.claude?.hot?.ready) window.claude.hot.ready(start); else start(window.claude?.hot?.data ?? {});
// test hook (local development only)
if (location.hostname === 'localhost') window.__dw = {
  screen: (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
  sketchScreen: (x, y) => { const v = new THREE.Vector3(x, y, 0).applyMatrix4(sketchMatrix(featById(sketchId))).project(camera), r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
  doc: () => JSON.parse(JSON.stringify(doc)),
  engine: () => engineMode,
  sheet: (kind, x, y) => { const v = dw()?.views.find(w => w.kind === kind); if (!v) return null; const P = viewXf(v).toSheet([x, y]), r = sheetSvg.getBoundingClientRect(); return { x: r.left + (P[0] - dwCam.x) / dwCam.w * r.width, y: r.top + (P[1] - dwCam.y) / dwCam.h * r.height }; },
  drawing: () => dw() && { views: dw().views.map(v => v.kind + ':' + (dwData[v.kind]?.vis.length || 0) + '/' + (dwData[v.kind]?.hid.length || 0)), dims: dw().dims.map(m => m.kind + ':' + fmtDim(dimValue(m))), scale: dw().scale, size: sheetSize(), boxes: dw().views.filter(v => dwData[v.kind]).map(v => { const X = viewXf(v), d = dwData[v.kind]; return [X.x - X.s * d.w / 2, X.y - X.s * d.h / 2, X.x + X.s * d.w / 2, X.y + X.s * d.h / 2]; }), texts: [...sheetSvg.querySelectorAll('text')].map(t => t.textContent) },
  setDoc: d => { checkpoint(); doc = upgradeDoc(d); afterDocReplace(); },
  assembly: () => ({ comps: comps().map(c => ({ name: c.name, bodies: c.bodies.length, moved: compXf.has(c.id) && !compXf.get(c.id).equals(IDENT) })), joints: joints().map(j => j.name + ':' + (jointStatus.get(j.id)?.state || '?')), xf: Object.fromEntries([...compXf].map(([k, m]) => [compById(k)?.name, m.elements.map(v => Math.round(v * 1e4) / 1e4)])) }),
  regen: () => doRegen(),
  rebuild: async () => { if (isBrep()) await engineReset(); else cache = []; await doRegen(); },
  curveScreen: i => { const sk = featById(sketchId), c = sk.geo.curves[i]; const pts = curvePts(sk, c, id => geoPos(sk, id), cc => geoRadius(sk, cc)); const m = pts[Math.floor(pts.length / 2)], m2 = pts.length === 2 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : m; return window.__dw.sketchScreen(m2[0], m2[1]); },
  geo: () => { const sk = featById(sketchId); const st = sk && geoState(sk); return st ? { dof: st.analysis.dof, ok: !!st.solved?.ok, loops: st.loops.profiles.length, regions: st.regions.length, filled: st.regions.filter(r => r.filled).length, sel: [...geoSel] } : null; },
  state: () => ({ mode, sketchTool, features: doc.features.map(f => f.type + ':' + statusOf(f.id).state + (statusOf(f.id).msg ? '(' + statusOf(f.id).msg + ')' : '')), bodies: [...result.bodies.keys()].map(id => bodyName(id) + '=' + fix(massProps().bodies.find(b => b.id === id)?.volume || 0, 0)) }),
};
