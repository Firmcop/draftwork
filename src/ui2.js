// ===== Interface: marking menu (right-click wheel), preferences, Create Drawing, job status =====

// ---------- preferences (this browser only) ----------
var PREF_KEY = 'draftwork.prefs.v1';
var PREF_DEFAULTS = { up: 'Z', theme: 'system', newType: 'hybrid', material: 'Aluminum 6061', rightDrag: 'pan', wheel: true };
var prefs = (() => { try { return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch (e) { return { ...PREF_DEFAULTS }; } })();
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { } }
var Z_VIEWS = JSON.parse(JSON.stringify(VIEWS));
var Y_VIEWS = { top: [[0, 1, 0], [0, 0, -1]], bottom: [[0, -1, 0], [0, 0, 1]], front: [[0, 0, 1], [0, 1, 0]], back: [[0, 0, -1], [0, 1, 0]], right: [[1, 0, 0], [0, 1, 0]], left: [[-1, 0, 0], [0, 1, 0]], iso: [[1, 0.95, 1.25], [0, 1, 0]] };
function applyPrefs(initial) {
  // up direction: views, orbit pivot, view cube, ground grid
  const yUp = prefs.up === 'Y';
  Object.assign(VIEWS, JSON.parse(JSON.stringify(yUp ? Y_VIEWS : Z_VIEWS)));
  const up = new THREE.Vector3(0, yUp ? 1 : 0, yUp ? 0 : 1);
  controls._quat?.setFromUnitVectors(up, new THREE.Vector3(0, 1, 0)); controls._quatInverse?.copy(controls._quat).invert();
  const g = new THREE.BoxGeometry(1.5, 1.5, 1.5); if (!yUp) g.rotateX(Math.PI / 2);
  vcCube.geometry.dispose(); vcCube.geometry = g; vcEdges.geometry.dispose(); vcEdges.geometry = new THREE.EdgesGeometry(g);
  gridGroup.rotation.set(yUp ? -Math.PI / 2 : 0, 0, 0);
  // theme
  if (prefs.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', prefs.theme);
  // right mouse drag
  controls.mouseButtons.RIGHT = prefs.rightDrag === 'orbit' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  if (!initial) setView('iso');
  requestRender();
}
function openPreferences() {
  const w = { ...prefs };
  const seg = (label, key, opts) => {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    const draw = () => { wrap.replaceChildren(...opts.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(w[key] === v), 'data-v': v, onclick: () => { w[key] = v; draw(); } }, t))); };
    draw(); return h('div', { class: 'row' }, h('span', { class: 'rl' }, label), wrap);
  };
  const sel = (label, key, opts, id) => { const s = h('select', { id }, ...opts.map(([v, t]) => h('option', { value: v, selected: w[key] === v }, t))); s.addEventListener('change', () => { w[key] = s.value; }); return row(label, s, id); };
  const chk = (label, key, id) => { const c = h('input', { type: 'checkbox', id, checked: !!w[key] }); c.addEventListener('change', () => { w[key] = c.checked; }); return h('div', { class: 'row' }, h('span', { class: 'rl' }), h('label', { class: 'chk', for: id }, c, label)); };
  openModal('Preferences', 'gear', h('div', { class: 'prefs' },
    h('h4', {}, 'General'),
    seg('Up direction', 'up', [['Z', 'Z up'], ['Y', 'Y up']]),
    seg('Theme', 'theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]),
    h('h4', {}, 'New designs'),
    sel('Design type', 'newType', Object.entries(DESIGN_TYPES).map(([k, d]) => [k, d.label + (d.sub ? ' (' + d.sub + ')' : '')]), 'pref-type'),
    sel('Material', 'material', Object.keys(MATERIALS).map(m => [m, m]), 'pref-material'),
    h('h4', {}, 'Navigation'),
    seg('Right-drag', 'rightDrag', [['pan', 'Pans'], ['orbit', 'Orbits']]),
    chk('Right-click (without dragging) opens the command wheel', 'wheel', 'pref-wheel'),
    h('p', { class: 'note' }, 'Preferences are kept in this browser. Up direction changes the views, the view cube and the ground grid; the model keeps its coordinates.')),
    [h('button', { class: 'btn ok', id: 'pref-ok', onclick: () => { prefs = w; savePrefs(); closeModal(); applyPrefs(); toast('Preferences saved'); } }, 'OK'),
      h('button', { class: 'btn', onclick: () => { prefs = { ...PREF_DEFAULTS }; savePrefs(); closeModal(); applyPrefs(); toast('Preferences reset'); } }, 'Reset'),
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
// new designs use the preferred type and material
{
  const base = newDesignDoc;
  newDesignDoc = function (type) { const d = base(type); d.material = prefs.material || d.material; return d; };
}

// ---------- marking menu ----------
var lastCmd = null;
const NO_REPEAT = new Set(['undo', 'redo', 'select', 'window', 'filters', 'delete', 'k.finish', 'k.select']);
function noteCmd(id) { if (!NO_REPEAT.has(id) && CMD[id]?.run) lastCmd = id; }
function wheelItems() {
  const c = id => CMD[id] ? { label: CMD[id].label, icon: CMD[id].icon, run: () => runCmd(id), id } : null;
  const act = (label, icon, run, id) => ({ label, icon, run, id });
  if (mode === 'sketch') return {
    ring: [c('k.line'), c('k.rect2'), c('k.circle'), c('k.arc'), c('k.trim'), c('k.offset'), c('k.dimension'), c('k.finish')],
    more: [c('k.construction'), c('k.project'), c('k.mirror'), c('k.fillet'), c('k.extend'), c('k.text'), c('k.slot'), c('k.polygon')].filter(Boolean),
  };
  const repeat = lastCmd && CMD[lastCmd] ? act('Repeat ' + CMD[lastCmd].label, CMD[lastCmd].icon, () => runCmd(lastCmd), 'repeat') : act('Repeat', 'redo', () => toast('No command to repeat yet'), 'repeat');
  const ring = [repeat, c('sketch'), c('presspull'), c('hole'), c('delete'), c('move'), act('Undo', 'undo', () => undo(), 'undo'), act('Redo', 'redo', () => redo(), 'redo')];
  const more = [];
  if (selBody && result.bodies.has(selBody)) {
    const id = selBody;
    more.push(act(bodyHidden(id) ? 'Show Body' : 'Hide Body', 'eyeoff', () => { meta(id).hidden = !meta(id).hidden; persist(); updateScene(); renderBrowser(); renderInfo(); }, 'hidebody'),
      c('appearance'), c('material'), act('Create Drawing…', 'properties', () => openCreateDrawing([id]), 'drawbody'), c('properties'));
  }
  more.push(c('extrude'), c('revolve'), c('fillet'), c('chamfer'), c('shell'), c('combine'), c('measure'), c('section'), c('params'));
  return { ring, more: more.filter(Boolean) };
}
function closeWheel() { $('#wheel')?.remove(); }
function openWheel(x, y) {
  closeWheel(); closeMenus();
  const { ring, more } = wheelItems(), R = 92;
  const box = h('div', { id: 'wheel', class: 'wheel', role: 'menu', 'aria-label': 'Command wheel', style: `left:${x}px;top:${y}px` });
  box.append(h('div', { class: 'wheel-disc', 'aria-hidden': 'true' }));
  ring.forEach((it, i) => {
    if (!it) return;
    const a = -Math.PI / 2 + i * Math.PI / 4, bx = Math.cos(a) * R, by = Math.sin(a) * R;
    box.append(h('button', { type: 'button', class: 'wheel-item' + (bx < -10 ? ' left' : bx > 10 ? ' right' : ''), role: 'menuitem', 'data-id': it.id, title: it.label, style: `transform:translate(calc(${bx}px - 50%), calc(${by}px - 50%))`, onclick: () => { closeWheel(); it.run(); }, html: icon(it.icon) + `<span>${it.label}</span>` }));
  });
  box.append(h('button', { type: 'button', class: 'wheel-center', 'aria-label': 'Close', onclick: closeWheel, html: icon('close') }));
  const list = h('div', { class: 'wheel-more', role: 'group', 'aria-label': 'More commands' }, ...more.map(it => h('button', { type: 'button', class: 'mi', role: 'menuitem', 'data-id': it.id, onclick: () => { closeWheel(); it.run(); }, html: icon(it.icon) + `<span class="lab">${it.label}</span>` })));
  box.append(list);
  document.body.append(box);
  // keep on screen
  const r = list.getBoundingClientRect(), dx = Math.min(0, window.innerWidth - 8 - (x + 150)), dy = Math.min(0, window.innerHeight - 8 - r.bottom);
  if (dx || dy) { box.style.left = (x + Math.max(dx, 160 - x)) + 'px'; box.style.top = Math.max(110, y + dy) + 'px'; }
  box.querySelector('.wheel-item')?.focus();
}
{
  const cv = renderer.domElement; let down = null;
  cv.addEventListener('pointerdown', e => { if (e.button === 2) down = { x: e.clientX, y: e.clientY, t: Date.now() }; else closeWheel(); });
  cv.addEventListener('pointerup', e => {
    if (e.button !== 2 || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 5 || !prefs.wheel || workspace !== 'design') return;
    openWheel(e.clientX, e.clientY);
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#wheel')) { closeWheel(); e.stopPropagation(); } }, true);
  document.addEventListener('pointerdown', e => { if ($('#wheel') && !e.target.closest('#wheel')) closeWheel(); }, true);
}

// ---------- Create Drawing ----------
// Sources: the whole design (assembled positions), one component alone, or one body. Optionally a flat face sets the
// base view: the part is turned so that face looks straight out of the front view (the face itself is not isolated).
var dwFacePick = null;     // dialog state while the user clicks a face for the base view
function openCreateDrawing(bodyIds, st0) {
  if (!isBrep()) { toast('Drawings need the exact geometry engine'); return; }
  if (!result.bodies.size) { toast('There is no body to draw yet'); return; }
  const ids = (bodyIds || []).filter(id => result.bodies.has(id));
  const comp = ids.length ? (comps().find(c => c.bodies.length && ids.every(id => c.bodies.includes(id)) && c.bodies.filter(id => result.bodies.has(id)).every(id => ids.includes(id))) || (ids.length === 1 && compOfBody(ids[0]))) : null;
  const st = st0 || { from: comp ? 'component' : ids.length ? 'body' : 'all', ids, comp: comp?.id || null, sheet: 'A3', projection: 'third', replace: !doc.drawing, face: null };
  const c = st.comp && compById(st.comp);
  const opts = [['all', comps().length ? 'Whole assembly (as assembled)' : 'Whole design']];
  if (comps().length) opts.push(['exploded', 'Exploded assembly']);
  if (c) opts.push(['component', 'Component: ' + c.name + ' (alone)']);
  if (st.ids.length === 1) opts.push(['body', 'Body: ' + bodyName(st.ids[0])]);
  else if (st.ids.length > 1 && !c) opts.push(['body', st.ids.length + ' selected bodies']);
  const sel = (id, list, val, on) => { const s = h('select', { id }, ...list.map(([v, l]) => h('option', { value: v, selected: v === val }, l))); s.addEventListener('change', () => on(s.value)); return s; };
  const faceDesc = st.face ? 'Looking at a face of ' + bodyName(st.face.body) : 'Standard (front view looks along +Y)';
  const body = () => h('div', { style: 'min-width:380px' },
    h('div', { class: 'row' }, h('label', { class: 'rl', for: 'cd-from' }, 'Contents'), sel('cd-from', opts, st.from, v => { st.from = v; })),
    h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Base view'), h('div', {}, h('div', { class: 'note', id: 'cd-face', style: 'margin:0' }, faceDesc),
      h('div', { style: 'display:flex;gap:6px;margin-top:4px' },
        h('button', { class: 'btn', type: 'button', id: 'cd-pickface', onclick: () => { closeModal(); startDrawingFacePick(st); } }, st.face ? 'Pick another face' : 'Pick a face…'),
        st.face ? h('button', { class: 'btn', type: 'button', id: 'cd-clearface', onclick: () => { st.face = null; closeModal(); openCreateDrawing(null, st); } }, 'Standard') : null))),
    h('div', { class: 'row' }, h('label', { class: 'rl', for: 'cd-sheet' }, 'Sheet size'), sel('cd-sheet', ['A4', 'A3', 'A2', 'A1', 'A0'].map(k => [k, k]), st.sheet, v => { st.sheet = v; })),
    h('div', { class: 'row' }, h('label', { class: 'rl', for: 'cd-proj' }, 'Projection'), sel('cd-proj', [['third', 'Third angle'], ['first', 'First angle']], st.projection, v => { st.projection = v; })),
    doc.drawing ? (() => { const cb = h('input', { type: 'checkbox', id: 'cd-replace', checked: st.replace }); cb.addEventListener('change', () => { st.replace = cb.checked; }); return h('div', { class: 'row' }, h('span', { class: 'rl' }), h('label', { class: 'chk', for: 'cd-replace' }, cb, 'Replace the existing drawing')); })() : null,
    h('p', { class: 'note' }, 'Front, top, right and iso views are placed automatically with a title block. The views come from the exact model with hidden lines removed, and stay linked to it.'));
  openModal('Create Drawing', 'properties', body(), [
    h('button', { class: 'btn ok', id: 'cd-ok', onclick: async () => {
      closeModal(); checkpoint();
      if (st.replace || !doc.drawing) doc.drawing = null;
      if (workspace !== 'design') leaveWorkspace();
      const cc = st.comp && compById(st.comp);
      const source = st.from === 'component' && cc ? { kind: 'component', comp: cc.id, name: cc.name }
        : st.from === 'body' ? { kind: 'body', bodies: [...st.ids], name: st.ids.map(bodyName).join(', ') }
        : st.from === 'exploded' ? { kind: 'exploded', name: (doc.name || 'assembly') + ' (exploded)' }
        : { kind: comps().length ? 'assembly' : 'design', name: doc.name || 'design' };
      if (st.face) source.face = true;
      // the source and orientation must be known before the first views are made
      const pre = { bodies: source.kind === 'body' ? [...st.ids] : source.kind === 'component' ? [...cc.bodies] : null, source, orient: st.face ? { body: st.face.body, sig: st.face.sig } : null, explode: source.kind === 'exploded' ? 0.8 : 0 };
      pendingDrawingSource = pre;
      await enterDrawing();
      pendingDrawingSource = null;
      if (!doc.drawing) return;
      Object.assign(doc.drawing, pre);
      const s = dw();
      if (s) { s.sheet = st.sheet; s.projection = st.projection; }
      persist(); await dwRefresh(true); if (dw()?.auto) relayoutAuto(); dwFit(); renderSheet();   // a new source always gets fresh views   // fit to the chosen sheet size, then draw
    } }, 'Create'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
var pendingDrawingSource = null;
function startDrawingFacePick(st) {
  if (workspace !== 'design') leaveWorkspace();
  dwFacePick = st || { from: 'all', ids: [], comp: null, sheet: 'A3', projection: 'third', replace: !doc.drawing, face: null };
  viewport.classList.add('picking');
  setHint('Click a flat face: the drawing’s front view will look straight at it · Esc cancels');
}
function dwFacePickAt(e) {
  if (!dwFacePick) return false;
  const fh = brepFaceHit(e);
  if (!fh?.sig) return true;
  if (fh.sig.type !== 'PLANE' || !fh.sig.n) { toast('Pick a flat face'); return true; }
  const st = dwFacePick; dwFacePick = null; viewport.classList.remove('picking');
  st.face = { body: fh.body, sig: fh.sig };
  // a face picked on its own also chooses the contents: that body's component, or the body
  if (!st.ids.length) { const c = compOfBody(fh.body); st.ids = c ? c.bodies.filter(id => result.bodies.has(id)) : [fh.body]; st.comp = c?.id || null; st.from = c ? 'component' : 'body'; }
  defaultHint(); openCreateDrawing(null, st);
  return true;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && dwFacePick) { dwFacePick = null; viewport.classList.remove('picking'); defaultHint(); e.stopPropagation(); } }, true);
cmd('createdrawingface', 'Create Drawing from Face', 'properties', { run: () => startDrawingFacePick(null) });
cmd('opendrawing', 'Open Drawing', 'properties', { run: () => { if (doc.drawing) { if (workspace !== 'design') leaveWorkspace(); enterDrawing(); } else toast('This design has no drawing yet. Use Create Drawing.'); } });

// ---------- job status ----------
var jobs = [], jobSeq = 0, jobCur = null;
function jobStart(label) { const j = { id: ++jobSeq, label, start: Date.now(), end: null }; jobs.unshift(j); jobs = jobs.slice(0, 12); renderJobs(); return j; }
function jobEnd(j) { if (!j || j.end) return; j.end = Date.now(); renderJobs(); }
function jobLabel() { const t = ($('#busy')?.textContent || '').replace(/\s*\(click to stop\)/, '').trim(); return !t || t === 'Computing…' ? (workspace === 'drawing' ? 'Updating drawing views' : 'Rebuilding the model') : t.split(' · ')[0].replace(/…$/, ''); }
function renderJobs() {
  const b = $('#abJobs'); if (!b) return;
  const running = jobs.filter(j => !j.end).length;
  b.classList.toggle('busy', running > 0);
  b.setAttribute('aria-label', running ? `${running} job running` : 'Job status');
  b.title = running ? 'Working: ' + jobs.find(j => !j.end).label : 'Job status: ' + (engine === 'brep' ? 'exact engine ready' : engineState === 'loading' ? 'engine loading' : 'basic engine');
}
function openJobs() {
  const rows = jobs.length ? jobs.map(j => ({ head: null, label: `${j.end ? '✓' : '…'} ${j.label}${j.end ? ' · ' + ((j.end - j.start) / 1000).toFixed(1) + ' s' : ' · running'}`, icon: j.end ? 'info' : 'start', action: () => { } })) : [{ label: 'No background jobs yet', icon: 'info', action: () => { } }];
  openMenu($('#abJobs'), [{ head: 'Job status' }, { label: engine === 'brep' ? 'Exact engine ready' : engineState === 'loading' ? 'Exact engine loading…' : 'Basic engine (exact engine unavailable)', icon: 'gear', action: () => { } }, { label: navigator.onLine ? 'Online · designs are kept in this browser' : 'Offline · designs are kept in this browser', icon: 'apps', action: () => { } }, '-', ...rows]);
}
{
  const busy = $('#busy');
  new MutationObserver(() => {
    if (!busy.hidden && !jobCur) jobCur = jobStart(jobLabel());
    else if (!busy.hidden && jobCur) { const l = jobLabel(); if (jobCur.label !== l) { jobCur.label = l; renderJobs(); } }
    else if (busy.hidden && jobCur) { jobEnd(jobCur); jobCur = null; }
  }).observe(busy, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
  const btn = h('button', { class: 'abtn jobs', id: 'abJobs', 'aria-label': 'Job status', 'aria-haspopup': 'true', html: icon('activity') });
  btn.addEventListener('click', e => { e.stopPropagation(); openJobs(); });
  const gear = h('button', { class: 'abtn', id: 'abPrefs', 'aria-label': 'Preferences', title: 'Preferences', html: icon('gear') });
  gear.addEventListener('click', () => openPreferences());
  $('#abHelp').before(btn, gear);
  renderJobs();
}
applyPrefs(true);
setTimeout(() => setView('iso', true), 60);
cmd('prefs', 'Preferences', 'gear', { run: () => openPreferences() });
cmd('createdrawing', 'Create Drawing', 'properties', { run: () => openCreateDrawing(selBody ? [selBody] : null) });

// ---------- document units ----------
function openUnitsDialog() {
  let u = docUnit();
  const s = h('select', { id: 'units-sel' }, ...Object.keys(UNIT_DEFS).map(k => h('option', { value: k, selected: k === u }, { mm: 'Millimeters (mm)', cm: 'Centimeters (cm)', m: 'Meters (m)', in: 'Inches (in)' }[k])));
  s.addEventListener('change', () => { u = s.value; });
  openModal('Document Units', 'ruler', h('div', { style: 'min-width:360px;padding:0 14px' }, row('Length', s, 'units-sel'),
    h('p', { class: 'note' }, 'Measurements, the status bar, drawing dimensions and dialog length fields use these units; a plain number in a length field is in these units. A value can also carry its own unit, for example 1 in, 2.5 cm or 30 deg (inside a longer expression, numbers without a unit are millimetres). The model itself is stored in millimetres.')),
    [h('button', { class: 'btn ok', id: 'units-ok', onclick: () => { checkpoint(); doc.units = u; persist(); closeModal(); renderBrowser(); renderInfo(); if (workspace === 'drawing') renderSheet(); toast('Document units: ' + u); } }, 'OK'), h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}

// ---------- Fusion keyboard shortcuts: system combinations, visibility, Model Toolbox ----------
var clipboardBody = null, compColors = false;
const WS_ORDER = ['Design', 'Simulation', 'Manufacture', 'Drawing'];
function switchWorkspace(step) {
  const cur = { design: 'Design', simulation: 'Simulation', manufacture: 'Manufacture', drawing: 'Drawing' }[workspace];
  const next = WS_ORDER[(WS_ORDER.indexOf(cur) + step + WS_ORDER.length) % WS_ORDER.length];
  leaveWorkspace();
  if (next === 'Simulation') enterSimulation(); else if (next === 'Manufacture') enterManufacture(); else if (next === 'Drawing') enterDrawing();
  toast(next + ' workspace');
}
function toggleEl(sel, name) { const el = $(sel); if (!el) return; const hide = el.style.display !== 'none'; el.style.display = hide ? 'none' : ''; toast(name + (hide ? ' hidden' : ' shown')); requestRender(); }
// Ctrl/Cmd combinations; returns true when handled
function systemKey(e, k) {
  if (e.altKey) {
    if (k === 'v') { toggleEl('#viewcube', 'View cube'); return true; }
    if (k === 'b') { toggleEl('#browser', 'Browser'); return true; }
    if (k === 'n') { toggleEl('#navbar', 'Navigation bar'); return true; }
    if (k === 'p') { toggleDataPanel(); return true; }
    if (k === 'r') { for (const s of ['#viewcube', '#browser', '#navbar']) { const el = $(s); if (el) el.style.display = ''; } $('#browser')?.classList.remove('min'); toggleDataPanel(false); toast('Default layout'); requestRender(); return true; }
    return false;
  }
  if (k === 'n') { newDesign(prefs.newType); return true; }
  if (k === 'o') { toggleDataPanel(true); return true; }
  if (k === 'b') { cache = []; scheduleRegen(0); toast('Computing all'); return true; }
  if (k === ']') { switchWorkspace(1); return true; }
  if (k === '[') { switchWorkspace(-1); return true; }
  if (k === 'g' && workspace === 'manufacture') { runCmd('cam.generate'); return true; }
  if (k === 'c' && workspace === 'design' && selBody) { clipboardBody = selBody; toast('Copied ' + bodyName(selBody)); return true; }
  if (k === 'v' && workspace === 'design' && clipboardBody) {
    if (!result.bodies.has(clipboardBody)) { toast('The copied body no longer exists'); return true; }
    checkpoint();
    const f = { id: uid(), type: 'move', name: 'Paste ' + bodyName(clipboardBody), body: clipboardBody, copy: true, dx: 10, dy: 10, dz: 0, rx: 0, ry: 0, rz: 0 };
    insertFeature(f); scheduleRegen(0); openFeatureDialog(f.id, true); toast('Pasted a copy; move it into place'); return true;
  }
  return false;
}
function toggleSelectionVisibility() {
  if (selBody && result.bodies.has(selBody)) { meta(selBody).hidden = !meta(selBody).hidden; persist(); updateScene(); renderBrowser(); renderInfo(); return; }
  if (selFeature && featById(selFeature)?.type === 'sketch') { doc.sketchShown[selFeature] = !doc.sketchShown[selFeature]; persist(); refreshOverlays(); renderBrowser(); return; }
  if (multiSel.size) { for (const id of multiSel) meta(id).hidden = !meta(id).hidden; persist(); updateScene(); renderBrowser(); return; }
  toast('Select a body or sketch, then press V to hide or show it');
}
function toggleComponentColors() {
  compColors = !compColors;
  const pal = ['#d9534a', '#3d7be0', '#3faa5b', '#e8913a', '#8e44ad', '#16a085', '#c0392b', '#2c3e50'];
  for (const [id, sb] of shownBodies) {
    const c = compOfBody(id), i = c ? comps().indexOf(c) : -1;
    sb.mesh.material.color?.set(compColors && i >= 0 ? pal[i % pal.length] : bodyColor(id));
  }
  requestRender(); toast(compColors ? 'Component colors on' : 'Component colors off');
}
// S: searchable list of every command (Fusion's Model Toolbox / shortcut box)
function openToolbox() {
  closeMenus(); $('#toolbox')?.remove();
  const box = h('div', { id: 'toolbox', class: 'toolbox', role: 'dialog', 'aria-label': 'Commands' });
  const inp = h('input', { type: 'text', placeholder: 'Search commands…', 'aria-label': 'Search commands', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'tb-list', role: 'listbox' });
  const ok = id => { const c = CMD[id]; if (!c?.run) return false; if (workspace === 'drawing') return id.startsWith('dw.') || ['measure', 'prefs'].includes(id); if (workspace === 'simulation') return id.startsWith('sim.') || id === 'prefs'; if (workspace === 'manufacture') return id.startsWith('cam.') || id.startsWith('am.') || id === 'nest'; if (mode === 'sketch') return id.startsWith('k.') || ['measure', 'extrude'].includes(id); return !id.startsWith('k.') && !id.startsWith('dw.') && !id.startsWith('sim.') && !id.startsWith('cam.') && !id.startsWith('am.'); };
  const all = Object.keys(CMD).filter(ok);
  let sel = 0, shown = [];
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    shown = all.filter(id => !q || CMD[id].label.toLowerCase().includes(q) || id.toLowerCase().includes(q)).slice(0, 40);
    if (sel >= shown.length) sel = 0;
    list.replaceChildren(...shown.map((id, i) => h('button', { type: 'button', class: 'mi' + (i === sel ? ' on' : ''), role: 'option', 'aria-selected': String(i === sel), 'data-id': id, onclick: () => { close(); runCmd(id); }, html: icon(CMD[id].icon) + `<span class="lab">${CMD[id].label}</span>` + (CMD[id].key ? `<span class="key">${CMD[id].key}</span>` : '') })));
    if (!shown.length) list.append(h('p', { class: 'note', style: 'padding:8px 12px' }, 'No matching command'));
  };
  const close = () => box.remove();
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); const id = shown[sel]; close(); if (id) runCmd(id); }
  });
  box.append(inp, list); document.body.append(box); draw();
  box.style.left = Math.min(window.innerWidth - 330, Math.max(8, hudMouse.x - 150)) + 'px'; box.style.top = Math.min(window.innerHeight - 380, Math.max(120, hudMouse.y - 20)) + 'px';
  setTimeout(() => inp.focus(), 10);
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!ev.target.closest('#toolbox')) { close(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
}
cmd('toolbox', 'Model Toolbox (search commands)', 'select', { key: 'S', run: () => openToolbox() });
// keyboard shortcut reference (Help)
function openShortcuts() {
  const groups = [
    ['Design', [['E', 'Extrude'], ['H', 'Hole'], ['Q', 'Press Pull'], ['F', 'Fillet'], ['M', 'Move'], ['V', 'Hide/show the selection'], ['A', 'Appearance'], ['J', 'Joint'], ['Shift+J', 'As-built Joint'], ['Shift+N', 'Component colors'], ['I', 'Measure'], ['S', 'Model Toolbox (search commands)'], ['L / R / C', 'Start a sketch with Line / Rectangle / Circle'], ['1', 'Window selection'], ['Del', 'Delete']]],
    ['Sketch', [['L', 'Line'], ['R', '2-point rectangle'], ['C', 'Center diameter circle'], ['A', 'Three-point arc'], ['T', 'Trim'], ['O', 'Offset'], ['P', 'Project'], ['X', 'Normal / construction'], ['D', 'Sketch dimension'], ['Type a number', 'Set the size while drawing (Tab, Enter)'], ['Esc', 'Stop the tool']]],
    ['System', [['Ctrl+N', 'New design'], ['Ctrl+O', 'Open (data panel)'], ['Ctrl+S', 'Save version'], ['Ctrl+Shift+S', 'Recovery copy (download)'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+C / Ctrl+V', 'Copy / paste a body'], ['Ctrl+B', 'Compute all'], ['Ctrl+] / Ctrl+[', 'Next / previous workspace'], ['Ctrl+Alt+V', 'Show/hide view cube'], ['Ctrl+Alt+B', 'Show/hide browser'], ['Ctrl+Alt+N', 'Show/hide navigation bar'], ['Ctrl+Alt+P', 'Show/hide data panel'], ['Ctrl+Alt+R', 'Default layout']]],
    ['Drawing', [['P', 'Projected (standard) views'], ['D', 'Dimension'], ['C', 'Center marks'], ['T', 'Text'], ['B', 'Balloon'], ['M', 'Move (select)'], ['Del', 'Delete']]],
    ['Simulation', [['N', 'New study'], ['E', 'Settings'], ['C', 'Structural constraint'], ['L / F', 'Structural load (force)'], ['H', 'Thermal load']]],
    ['Manufacture', [['Ctrl+G', 'Generate toolpaths']]],
    ['Mouse', [['Middle drag', 'Pan'], ['Shift + middle drag', 'Orbit'], ['Wheel', 'Zoom'], ['Right-click', 'Command wheel']]],
  ];
  openModal('Keyboard Shortcuts', 'help', h('div', {}, h('div', { class: 'shortcuts', id: 'shortcuts' }, ...groups.map(([g, rows]) => h('section', {}, h('h4', {}, g), h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, ...k.split(' / ').flatMap((x, i) => [i ? ' / ' : '', h('kbd', {}, x)])), h('dd', {}, v)]))))),
    h('p', { class: 'note', style: 'padding:0 14px' }, 'In a browser tab, Ctrl+N and Ctrl+Tab belong to the browser and may not reach Draftwork.')));
}
cmd('shortcuts', 'Keyboard Shortcuts', 'help', { run: () => openShortcuts() });
// Shift + middle-drag orbits (Fusion); middle-drag pans
{
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { if (e.button === 1) controls.mouseButtons.MIDDLE = e.shiftKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN; }, true);
}

// ===== Desktop app: install the web app as a desktop window (Chrome / Edge) =====
var installPromptEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPromptEvt = e; });
window.addEventListener('appinstalled', () => { installPromptEvt = null; toast('Draftwork is installed. Open it from your Start menu, Dock or desktop.'); });
function installDesktopApp() {
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches;
  if (standalone) return toast('You are already using the desktop app' + (window.DRAFTWORK_VERSION ? ' (v' + window.DRAFTWORK_VERSION + ')' : '') + '.');
  if (installPromptEvt) { const ev = installPromptEvt; installPromptEvt = null; ev.prompt(); return; }
  const SITE = 'https://firmcop.github.io/draftwork/';
  const onSite = /github\.io$|^localhost$/.test(location.hostname);
  openModal('Install the desktop app', 'exportstl', h('div', { class: 'install-help', style: 'max-width:440px;padding:0 14px;line-height:1.5' },
    h('p', {}, 'Draftwork installs as its own desktop window, works offline and updates itself each time a new version is released.'),
    onSite ? h('p', {}, 'In Chrome or Edge, click the install icon at the right of the address bar, or open the browser menu and choose “Install Draftwork”. In Safari on a Mac, choose File → Add to Dock.')
      : h('p', {}, 'Open ', h('a', { href: SITE, target: '_blank', rel: 'noopener' }, SITE), ' in Chrome or Edge, then click the install icon at the right of the address bar. In Safari on a Mac, choose File → Add to Dock.'),
    h('p', { class: 'muted' }, 'Your designs are stored in that window’s own library. To move designs from here, use File → Download file (.json) and open the file in the desktop app.')));
}
cmd('installapp', 'Install Desktop App', 'exportstl', { run: () => installDesktopApp() });
