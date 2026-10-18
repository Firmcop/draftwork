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
function openCreateDrawing(bodyIds) {
  if (!isBrep()) { toast('Drawings need the exact geometry engine'); return; }
  if (!result.bodies.size) { toast('There is no body to draw yet'); return; }
  const st = { from: bodyIds?.length ? 'some' : 'all', sheet: 'A3', replace: !doc.drawing };
  const names = (bodyIds || []).map(bodyName).join(', ');
  const body = () => h('div', { style: 'min-width:360px' },
    h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Contents'), (() => { const s = h('select', { id: 'cd-from' }, h('option', { value: 'all', selected: st.from === 'all' }, 'Whole design'), ...(bodyIds?.length ? [h('option', { value: 'some', selected: st.from === 'some' }, names.length > 40 ? bodyIds.length + ' bodies' : names)] : [])); s.addEventListener('change', () => { st.from = s.value; }); return s; })()),
    h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Sheet size'), (() => { const s = h('select', { id: 'cd-sheet' }, ...['A4', 'A3', 'A2', 'A1'].map(k => h('option', { value: k, selected: st.sheet === k }, k))); s.addEventListener('change', () => { st.sheet = s.value; }); return s; })()),
    doc.drawing ? (() => { const c = h('input', { type: 'checkbox', id: 'cd-replace', checked: st.replace }); c.addEventListener('change', () => { st.replace = c.checked; }); return h('div', { class: 'row' }, h('span', { class: 'rl' }), h('label', { class: 'chk', for: 'cd-replace' }, c, 'Start a new drawing (replaces the existing one)')); })() : null,
    h('p', { class: 'note' }, 'Front, top, right and iso views are placed automatically with a title block. The part number comes from the design.'));
  openModal('Create Drawing', 'properties', body(), [
    h('button', { class: 'btn ok', id: 'cd-ok', onclick: async () => {
      closeModal(); checkpoint();
      if (st.replace || !doc.drawing) doc.drawing = null;
      if (workspace !== 'design') leaveWorkspace();
      await enterDrawing();
      if (!doc.drawing) return;
      doc.drawing.bodies = st.from === 'some' ? [...bodyIds] : null;
      const s = dw(); if (s && s.sheet !== st.sheet) { s.sheet = st.sheet; if (s.auto) relayoutAuto(); }
      persist(); await dwRefresh(); if (dw()?.auto) relayoutAuto(); renderSheet(); dwFit();
    } }, 'Create'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}

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
