// ===== Designs: types, a local design library (projects, folders, versions, part numbers), design tabs =====
// doc.meta = { id, type: 'part'|'sheetmetal'|'assembly'|'hybrid', partNumber, version, project, folder }
// Library (IndexedDB 'draftwork', memory fallback):
//   projects { id, name, folders: [{ id, name, parent }], created }
//   designs  { id, name, type, partNumber, project, folder, version, created, modified, latest }
//   versions { id, design, n, date, label, doc }
//   meta     { k: 'pn', n }
var DESIGN_TYPES = {
  part: { label: 'Part', sub: 'Standard', icon: 'bodyi', note: 'One component: bodies, sketches and features.' },
  sheetmetal: { label: 'Part', sub: 'Sheet Metal', icon: 'flange', note: 'One sheet metal component; opens on the Sheet Metal tab.' },
  assembly: { label: 'Assembly', sub: '', icon: 'component', note: 'Components and joints; parts are brought in with Derive or Insert.' },
  hybrid: { label: 'Hybrid', sub: '', icon: 'doc', note: 'Everything: model parts and assemble them in one design.' },
};
var ASSEMBLY_CMDS = new Set(['newcomp', 'joint', 'asbuilt', 'rigid', 'drive', 'motionlink', 'contact']);
function designType() { return doc?.meta?.type || 'hybrid'; }
function designTypeLabel(t) { const d = DESIGN_TYPES[t || designType()] || DESIGN_TYPES.hybrid; return d.label + (d.sub ? ' · ' + d.sub : ''); }
// commands a design type does not offer (called from runCmd)
function designBlock(id) {
  const t = designType();
  if ((t === 'part' || t === 'sheetmetal') && ASSEMBLY_CMDS.has(id)) return 'Part designs hold a single component. Use an Assembly or Hybrid design for components and joints.';
  return null;
}

// ---------- storage ----------
var LIB = { db: null, ready: null, mem: { projects: new Map(), designs: new Map(), versions: new Map(), meta: new Map() } };
function libOpen() {
  if (LIB.ready) return LIB.ready;
  LIB.ready = new Promise(res => {
    try {
      const r = indexedDB.open('draftwork', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('projects', { keyPath: 'id' }); d.createObjectStore('designs', { keyPath: 'id' }); d.createObjectStore('versions', { keyPath: 'id' }).createIndex('design', 'design'); d.createObjectStore('meta', { keyPath: 'k' }); };
      r.onsuccess = () => { LIB.db = r.result; res(LIB.db); };
      r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return LIB.ready;
}
const keyOf = s => s === 'meta' ? 'k' : 'id';
async function libTx(store, mode, fn) {
  const db = await libOpen();
  if (!db) return fn(null);
  return new Promise((res, rej) => { const tx = db.transaction(store, mode), st = tx.objectStore(store); let out; const r = fn(st); if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; }; tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
const libAll = store => libTx(store, 'readonly', st => st ? st.getAll() : null).then(v => v ?? [...LIB.mem[store].values()]);
const libGet = (store, id) => libTx(store, 'readonly', st => st ? st.get(id) : null).then(v => v ?? LIB.mem[store].get(id) ?? null);
const libPut = (store, obj) => libTx(store, 'readwrite', st => { if (!st) { LIB.mem[store].set(obj[keyOf(store)], JSON.parse(JSON.stringify(obj))); return null; } return st.put(obj); });
const libDel = (store, id) => libTx(store, 'readwrite', st => { if (!st) { LIB.mem[store].delete(id); return null; } return st.delete(id); });
async function libVersions(designId) {
  const db = await libOpen();
  const all = db ? await libTx('versions', 'readonly', st => st.index('design').getAll(designId)) : [...LIB.mem.versions.values()].filter(v => v.design === designId);
  return (all || []).sort((a, b) => b.n - a.n);
}
async function libProjects() {
  let ps = await libAll('projects');
  if (!ps.length) { const p = { id: uid(), name: 'Default Project', folders: [], created: Date.now() }; await libPut('projects', p); ps = [p]; }
  return ps.sort((a, b) => a.created - b.created);
}
async function nextPartNumber() {
  const m = (await libGet('meta', 'pn')) || { k: 'pn', n: 0 }; m.n++; await libPut('meta', m);
  return 'DW-' + String(m.n).padStart(5, '0');
}

// ---------- design tabs ----------
var SESSION_KEY = 'draftwork.session.v1';
var tabs = [], tabIdx = 0;
function captureTab() { const t = tabs[tabIdx]; if (!t) return; t.doc = doc; t.history = { undo: history.undo, redo: history.redo }; t.dirty = dirty; }
function leaveWorkspace() { if (workspace === 'drawing') exitDrawing(); if (workspace === 'manufacture') exitManufacture(); if (workspace === 'simulation') exitSimulation(); }
function showTabDoc(t, msg) {
  if (dlg) closeDialog(true, true);
  if (mode === 'sketch') exitSketch(true);
  leaveWorkspace(); cancelPick(); measure = null; section = null; showCOM = false;
  history.undo = t.history.undo; history.redo = t.history.redo;
  doc = t.doc; cache = []; selFeature = null; selBody = null; lastSketchId = null; simRes = null;
  dirty = !!t.dirty;
  activeTab = designType() === 'sheetmetal' && !doc.features.length ? 'SHEET METAL' : 'SOLID';
  afterDocReplace(); $('#dirty').hidden = !dirty; defaultHint(); renderBrowser(); renderTabs(); persist();
  setTimeout(() => setView('iso'), 80); if (msg) toast(msg);
}
function openInTab(d, o = {}) {
  captureTab();
  tabs.push({ doc: d, history: { undo: [], redo: [] }, dirty: !!o.dirty });
  tabIdx = tabs.length - 1;
  showTabDoc(tabs[tabIdx], o.msg);
}
function activateTab(i) { if (i === tabIdx || !tabs[i]) return; captureTab(); tabIdx = i; showTabDoc(tabs[i]); }
function closeTab(i) {
  const go = () => {
    if (i === tabIdx) {
      tabs.splice(i, 1);
      if (!tabs.length) tabs.push({ doc: newDesignDoc('hybrid'), history: { undo: [], redo: [] }, dirty: false });
      tabIdx = Math.min(i, tabs.length - 1); showTabDoc(tabs[tabIdx]);
    } else { captureTab(); tabs.splice(i, 1); if (i < tabIdx) tabIdx--; renderTabs(); persist(); }
  };
  const t = i === tabIdx ? { doc, dirty } : tabs[i];
  if (!t.dirty) { go(); return; }
  openModal('Unsaved changes', 'save', h('p', { class: 'note', style: 'max-width:380px' }, `Save the changes to “${t.doc.name}” before closing?`), [
    h('button', { class: 'btn ok', id: 'close-save', onclick: async () => { closeModal(); if (i !== tabIdx) activateTab(i); const ok = await saveCmd(); if (ok) closeTab(tabIdx); } }, 'Save'),
    h('button', { class: 'btn', id: 'close-discard', onclick: () => { closeModal(); go(); } }, 'Don’t save'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
// small inline name field (native dialogs are blocked in sandboxed pages)
function inlineAsk(after, value, onOk) {
  after.parentNode.querySelector('.inlineask')?.remove();
  const i = h('input', { type: 'text', value, 'aria-label': 'Name', class: 'inlineask-input' });
  const box = h('div', { class: 'inlineask' }, i,
    h('button', { class: 'btn', type: 'button', onclick: () => commit() }, 'OK'), h('button', { class: 'btn', type: 'button', onclick: () => box.remove() }, 'Cancel'));
  const commit = () => { const v = i.value.trim(); box.remove(); if (v) onOk(v); };
  i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') commit(); if (e.key === 'Escape') box.remove(); });
  after.after(box); setTimeout(() => { i.focus(); i.select(); }, 20);
}
function renderTabs() {
  const box = $('#docTabs'); if (!box) return;
  box.replaceChildren();
  tabs.forEach((t, i) => {
    const d = i === tabIdx ? doc : t.doc, act = i === tabIdx, isDirty = act ? dirty : t.dirty;
    const name = h('span', act ? { id: 'docTitle', class: 'dtname' } : { class: 'dtname' }, d.name);
    const dirtyEl = h('span', act ? { class: 'dirty', id: 'dirty', hidden: !isDirty } : { class: 'dirty', hidden: !isDirty }, 'edited');
    const ver = d.meta?.version ? h('span', { class: 'dtver' }, 'v' + d.meta.version) : null;
    const tab = h('div', { class: 'dtab' + (act ? ' on' : ''), role: 'tab', 'aria-selected': String(act), title: d.name + ' — ' + designTypeLabel(d.meta?.type) + (d.meta?.partNumber ? ' · ' + d.meta.partNumber : '') },
      h('button', { class: 'dtmain', type: 'button', onclick: () => activateTab(i), html: icon(DESIGN_TYPES[d.meta?.type || 'hybrid'].icon) }, name, ver, dirtyEl),
      h('button', { class: 'dtx', type: 'button', 'aria-label': 'Close ' + d.name, onclick: e => { e.stopPropagation(); closeTab(i); }, html: icon('close') }));
    box.append(tab);
  });
  box.append(h('button', { class: 'dtnew', type: 'button', id: 'newTabBtn', 'aria-label': 'New design', title: 'New design', onclick: () => openNewDesignDialog(), html: icon('plus') }));
}
// session: the other open tabs survive a reload (the active one is in the regular autosave)
function persistSession() {
  try {
    const others = tabs.map((t, i) => i === tabIdx ? null : { doc: t.doc, dirty: t.dirty });
    localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs: others, active: tabIdx }));
  } catch (e) { }
}
function restoreSession() {
  let s = null; try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { }
  if (!s || !Array.isArray(s.tabs) || s.tabs.length < 2 || !(s.active >= 0 && s.active < s.tabs.length)) { tabs = [{ doc, history, dirty }]; tabIdx = 0; return; }
  tabs = s.tabs.map((t, i) => i === s.active ? { doc, history: { undo: history.undo, redo: history.redo }, dirty } : (t && upgradeDoc(t.doc) ? { doc: upgradeDoc(t.doc), history: { undo: [], redo: [] }, dirty: !!t.dirty } : null)).filter(Boolean);
  tabIdx = Math.max(0, tabs.findIndex(t => t.doc === doc));
}

// ---------- new designs ----------
function newDesignDoc(type) { const d = blankDoc(); d.meta = { type }; if (type !== 'hybrid') d.name = 'Untitled ' + DESIGN_TYPES[type].label.toLowerCase(); return d; }
function newDesign(type = 'hybrid', msg) { openInTab(newDesignDoc(type), { msg: msg || 'New ' + designTypeLabel(type).toLowerCase() + ' design' }); }
function openNewDesignDialog() {
  const card = (type) => { const d = DESIGN_TYPES[type]; return h('button', { class: 'studycard', type: 'button', 'data-type': type, onclick: () => { closeModal(); newDesign(type); } }, h('span', { html: icon(d.icon) }), h('b', {}, d.label + (d.sub ? ` (${d.sub})` : '')), h('small', {}, d.note)); };
  openModal('New Design', 'doc', h('div', {}, h('p', { class: 'note', style: 'margin:0 0 8px' }, 'What do you want to design?'), h('div', { class: 'studycards' }, card('part'), card('sheetmetal'), card('assembly'), card('hybrid'))),
    [h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}

// ---------- save ----------
function locationPicker(state, projects) {
  const wrap = h('div', { class: 'loctree', id: 'save-loc', role: 'tree' });
  const draw = () => {
    wrap.replaceChildren();
    for (const p of projects) {
      const row = (label, ic, sel, onClick, depth) => h('button', { type: 'button', class: 'locrow' + (sel ? ' on' : ''), role: 'treeitem', 'aria-selected': String(sel), style: `padding-left:${6 + depth * 14}px`, onclick: onClick, html: icon(ic) + `<span>${label.replace(/</g, '&lt;')}</span>` });
      wrap.append(row(p.name, 'folder', state.project === p.id && !state.folder, () => { state.project = p.id; state.folder = null; draw(); }, 0));
      const kids = parent => p.folders.filter(f => (f.parent || null) === parent).forEach(f => { wrap.append(row(f.name, 'folder', state.folder === f.id, () => { state.project = p.id; state.folder = f.id; draw(); }, depthOf(p, f) + 1)); kids(f.id); });
      kids(null);
    }
  };
  const depthOf = (p, f) => { let d = 0, cur = f; while (cur.parent) { d++; cur = p.folders.find(x => x.id === cur.parent) || {}; } return d; };
  draw();
  const bar = h('div', { class: 'row', style: 'gap:6px;margin-top:6px' });
  const newFolder = h('button', { class: 'btn', type: 'button', id: 'save-newfolder', onclick: () => inlineAsk(bar, 'New folder', async name => {
    const p = projects.find(x => x.id === state.project); if (!p) return;
    const f = { id: uid(), name, parent: state.folder || null }; p.folders.push(f); await libPut('projects', p); state.folder = f.id; draw(); renderDataPanel();
  }) }, 'New Folder');
  const newProject = h('button', { class: 'btn', type: 'button', id: 'save-newproject', onclick: () => inlineAsk(bar, 'New project', async name => {
    const p = { id: uid(), name, folders: [], created: Date.now() }; await libPut('projects', p); projects.push(p); state.project = p.id; state.folder = null; draw(); renderDataPanel();
  }) }, 'New Project');
  bar.append(newFolder, newProject);
  return h('div', {}, wrap, bar);
}
const textInput = (id, value, on) => { const i = h('input', { type: 'text', id, value: value ?? '', autocomplete: 'off' }); i.addEventListener('input', () => on(i.value)); i.addEventListener('keydown', e => e.stopPropagation()); return i; };
// commit the current document as a new version of design `id` (creating the design record when needed)
async function commitVersion(o) {
  const now = Date.now();
  let rec = o.id ? await libGet('designs', o.id) : null;
  if (!rec) rec = { id: o.id || uid(), created: now, version: 0 };
  Object.assign(rec, { name: o.name, type: o.type, partNumber: o.partNumber, project: o.project, folder: o.folder || null, modified: now });
  rec.version = (rec.version || 0) + 1;
  const d = JSON.parse(JSON.stringify(o.doc));
  d.name = o.name; d.meta = { id: rec.id, type: o.type, partNumber: o.partNumber, version: rec.version, project: o.project, folder: o.folder || null };
  if (o.dropDrawings) delete d.drawing;
  const v = { id: uid(), design: rec.id, n: rec.version, date: now, label: o.label || '', doc: d };
  rec.latest = v.id;
  await libPut('versions', v); await libPut('designs', rec);
  return { rec, doc: d };
}
// Save: first save asks for name, part number and location; later saves ask for a version description
async function saveCmd() {
  const m = doc.meta || {};
  const rec = m.id ? await libGet('designs', m.id) : null;
  if (!rec) return openSaveDialog({ mode: 'save' });
  return new Promise(res => {
    let label = '';
    openModal('Save', 'save', h('div', { style: 'min-width:340px' }, row('Version description', textInput('save-desc', '', v => { label = v; }), 'save-desc'), h('p', { class: 'note' }, `Saves version ${rec.version + 1} of “${doc.name}”.`)), [
      h('button', { class: 'btn ok', id: 'save-ok', onclick: async () => { closeModal(); await doSave({ id: rec.id, name: doc.name, type: designType(), partNumber: m.partNumber, project: rec.project, folder: rec.folder, label }); res(true); } }, 'Save'),
      h('button', { class: 'btn', onclick: () => { closeModal(); res(false); } }, 'Cancel')]);
    setTimeout(() => $('#save-desc')?.focus(), 30);
  });
}
async function doSave(o) {
  const { rec, doc: saved } = await commitVersion({ ...o, doc });
  doc.meta = saved.meta; doc.name = saved.name;
  dirty = false; $('#dirty') && ($('#dirty').hidden = true);
  $('#docTitle') && ($('#docTitle').textContent = doc.name);
  persist(); renderTabs(); renderBrowser(); renderDataPanel();
  toast(`Saved “${rec.name}” · version ${rec.version}${rec.partNumber ? ' · ' + rec.partNumber : ''}`);
  return rec;
}
// mode: 'save' (first save of this design), 'saveas' (copy as a new design), 'component' (copy one component)
async function openSaveDialog(o) {
  const projects = await libProjects(), designs = await libAll('designs');
  const m = doc.meta || {};
  const st = { name: o.name || doc.name, project: m.project && projects.some(p => p.id === m.project) ? m.project : projects[0].id, folder: m.folder || null, pnMode: 'new', sharedPn: '', includeDrawings: true };
  const pns = [...new Set(designs.map(d => d.partNumber).filter(Boolean))].sort();
  const title = o.mode === 'saveas' ? 'Save As' : o.mode === 'component' ? 'Save Component Copy As' : 'Save';
  return new Promise(res => {
    const body = () => {
      const pnRow = o.mode === 'save' ? [h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Part Number'), h('div', { class: 'seg', role: 'radiogroup' },
        ...[['new', 'New Part Number'], ['shared', 'Shared Part Number']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(st.pnMode === k), disabled: k === 'shared' && !pns.length, onclick: () => { st.pnMode = k; redraw(); } }, l)))),
        st.pnMode === 'shared' ? (() => { const s = h('select', { id: 'save-pn' }, ...pns.map(p => h('option', { value: p, selected: p === st.sharedPn }, p))); if (!st.sharedPn) st.sharedPn = pns[0]; s.addEventListener('change', () => { st.sharedPn = s.value; }); return row('Shared with', s, 'save-pn'); })() : null] : [];
      const inc = o.mode === 'saveas' ? (() => { const c = h('input', { type: 'checkbox', id: 'save-drawings', checked: st.includeDrawings }); c.addEventListener('change', () => { st.includeDrawings = c.checked; }); return h('label', { class: 'chk', for: 'save-drawings' }, c, 'Include Drawings'); })() : null;
      return h('div', { class: 'savedlg' }, row('Name', textInput('save-name', st.name, v => { st.name = v; }), 'save-name'), ...pnRow,
        h('div', { class: 'row', style: 'align-items:flex-start' }, h('span', { class: 'rl' }, 'Location'), locationPicker(st, projects)), inc,
        o.mode === 'saveas' ? h('p', { class: 'note' }, 'Saves a separate copy; the open design becomes the copy.') : o.mode === 'component' ? h('p', { class: 'note' }, 'The component and the history that builds it are saved as a separate design. This design is not changed.') : null);
    };
    const holder = h('div');
    const redraw = () => holder.replaceChildren(body());
    redraw();
    openModal(title, 'save', holder, [
      h('button', { class: 'btn ok', id: 'save-ok', onclick: async () => {
        const name = st.name.trim(); if (!name) { toast('Enter a name'); return; }
        closeModal();
        if (o.mode === 'component') {
          const pn = await nextPartNumber();
          const { rec } = await commitVersion({ name, type: 'part', partNumber: pn, project: st.project, folder: st.folder, doc: o.doc, label: 'Copied from ' + doc.name });
          renderDataPanel(); toast(`Saved component “${rec.name}” as a new design · ${pn}`); res(true); return;
        }
        const pn = o.mode === 'save' && st.pnMode === 'shared' && st.sharedPn ? st.sharedPn : await nextPartNumber();
        if (o.mode === 'saveas') {
          const { rec, doc: saved } = await commitVersion({ name, type: designType(), partNumber: pn, project: st.project, folder: st.folder, doc, dropDrawings: !st.includeDrawings, label: 'Saved as a copy of ' + doc.name });
          doc = saved; history.undo.length = 0; history.redo.length = 0; dirty = false; cache = [];
          afterDocReplace(); $('#dirty').hidden = true; renderTabs(); renderBrowser(); renderDataPanel(); persist();
          toast(`Saved as “${rec.name}” · ${pn}`); res(true); return;
        }
        await doSave({ id: null, name, type: designType(), partNumber: pn, project: st.project, folder: st.folder, label: 'First save' });
        res(true);
      } }, 'Save'),
      h('button', { class: 'btn', onclick: () => { closeModal(); res(false); } }, 'Cancel')]);
    setTimeout(() => { const i = $('#save-name'); i?.focus(); i?.select(); }, 30);
  });
}
function saveAsCmd() { return openSaveDialog({ mode: 'saveas', name: doc.name + ' copy' }); }
// a component and the history that builds it, as a new single-part design
function componentCopyDoc(cid) {
  const c = compById(cid); if (!c) return null;
  const d = JSON.parse(JSON.stringify(doc));
  const keep = new Set(c.bodies), others = [...result.bodies.keys()].filter(id => !keep.has(id));
  d.name = c.name; d.meta = { type: 'part' };
  d.components = []; d.joints = []; d.rigidGroups = []; d.motionLinks = []; delete d.drawing; delete d.cam; delete d.sim; delete d.contact;
  for (const id of others) d.features.push({ id: uid(), type: 'remove', name: 'Remove ' + bodyName(id), body: id });
  d.rollback = null;
  return d;
}
function saveComponentCopy(cid) {
  const d = componentCopyDoc(cid); if (!d) return;
  openSaveDialog({ mode: 'component', name: d.name, doc: d });
}

// ---------- data panel ----------
var dataOpen = false, dataProject = null, dataFolder = null;
function toggleDataPanel(force) {
  dataOpen = force ?? !dataOpen;
  let p = $('#dataPanel');
  if (!p) { p = h('aside', { id: 'dataPanel', class: 'datapanel', 'aria-label': 'Data panel' }); $('#app').append(p); }
  p.hidden = !dataOpen; $('#abData').setAttribute('aria-pressed', String(dataOpen));
  if (dataOpen) renderDataPanel();
}
const fmtDate = t => { const d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
async function renderDataPanel() {
  const p = $('#dataPanel'); if (!p || p.hidden) return;
  const projects = await libProjects(), designs = await libAll('designs');
  if (!projects.some(x => x.id === dataProject)) { dataProject = projects[0].id; dataFolder = null; }
  const P = projects.find(x => x.id === dataProject);
  if (dataFolder && !P.folders.some(f => f.id === dataFolder)) dataFolder = null;
  const sel = h('select', { id: 'dp-project', 'aria-label': 'Project' }, ...projects.map(x => h('option', { value: x.id, selected: x.id === dataProject }, x.name)));
  sel.addEventListener('change', () => { dataProject = sel.value; dataFolder = null; renderDataPanel(); });
  const crumbs = [h('button', { type: 'button', class: 'crumb', onclick: () => { dataFolder = null; renderDataPanel(); } }, P.name)];
  { const chain = []; let f = P.folders.find(x => x.id === dataFolder); while (f) { chain.unshift(f); f = P.folders.find(x => x.id === f.parent); } for (const c of chain) crumbs.push(h('span', { class: 'csep' }, '›'), h('button', { type: 'button', class: 'crumb', onclick: () => { dataFolder = c.id; renderDataPanel(); } }, c.name)); }
  const list = h('div', { class: 'dplist', id: 'dp-list', role: 'list' });
  for (const f of P.folders.filter(f => (f.parent || null) === dataFolder).sort((a, b) => a.name.localeCompare(b.name))) {
    list.append(h('div', { class: 'dpitem folder', role: 'listitem', tabindex: 0, ondblclick: () => { dataFolder = f.id; renderDataPanel(); }, onkeydown: e => { if (e.key === 'Enter') { dataFolder = f.id; renderDataPanel(); } },
      oncontextmenu: e => { e.preventDefault(); openMenu(e.currentTarget, [{ label: 'Open', icon: 'folder', action: () => { dataFolder = f.id; renderDataPanel(); } }, { label: 'Rename', icon: 'params', action: () => inlineAsk($('#dp-crumbs'), f.name, async n => { f.name = n; await libPut('projects', P); renderDataPanel(); }) }, { label: 'Delete', icon: 'delete', action: () => deleteFolder(P, f, designs) }], { at: { x: e.clientX, y: e.clientY } }); } },
      h('span', { class: 'dpico', html: icon('folder') }), h('span', { class: 'dpname' }, f.name)));
  }
  const here = designs.filter(d => d.project === dataProject && (d.folder || null) === dataFolder).sort((a, b) => b.modified - a.modified);
  for (const d of here) {
    const open = tabs.some((t, i) => (i === tabIdx ? doc : t.doc).meta?.id === d.id);
    list.append(h('div', { class: 'dpitem', role: 'listitem', tabindex: 0, 'data-id': d.id, title: 'Double-click to open', ondblclick: () => openDesign(d.id), onkeydown: e => { if (e.key === 'Enter') openDesign(d.id); },
      oncontextmenu: e => { e.preventDefault(); openMenu(e.currentTarget, [{ label: 'Open', icon: 'doc', action: () => openDesign(d.id) }, { label: 'Insert into Current Design', icon: 'component', action: () => insertFromLibrary(d.id) }, { label: 'Versions…', icon: 'history', action: () => openVersions(d.id) }, { label: 'Rename', icon: 'params', action: () => inlineAsk($('#dp-crumbs'), d.name, n => renameDesign(d.id, n)) }, '-', { label: 'Delete', icon: 'delete', action: () => deleteDesign(d.id) }], { at: { x: e.clientX, y: e.clientY } }); } },
      h('span', { class: 'dpico', html: icon(DESIGN_TYPES[d.type || 'hybrid'].icon) }),
      h('span', { class: 'dpname' }, d.name, open ? h('span', { class: 'dpopen' }, ' · open') : null),
      h('span', { class: 'dpmeta' }, `v${d.version} · ${d.partNumber || '—'} · ${designTypeLabel(d.type)} · ${fmtDate(d.modified)}`)));
  }
  if (!list.children.length) list.append(h('p', { class: 'note', style: 'padding:10px' }, dataFolder ? 'This folder is empty.' : 'No designs here yet. Save a design to put it in this project.'));
  p.replaceChildren(
    h('div', { class: 'dphead' }, h('b', {}, 'Data'), h('button', { class: 'x', 'aria-label': 'Close data panel', onclick: () => toggleDataPanel(false), html: icon('close') })),
    h('div', { class: 'dpbar' }, sel),
    h('div', { class: 'dpbar' },
      h('button', { class: 'btn', type: 'button', id: 'dp-newproject', onclick: () => inlineAsk($('#dp-crumbs'), 'New project', async n => { const np = { id: uid(), name: n, folders: [], created: Date.now() }; await libPut('projects', np); dataProject = np.id; dataFolder = null; renderDataPanel(); }) }, 'New Project'),
      h('button', { class: 'btn', type: 'button', id: 'dp-newfolder', onclick: () => inlineAsk($('#dp-crumbs'), 'New folder', async n => { P.folders.push({ id: uid(), name: n, parent: dataFolder }); await libPut('projects', P); renderDataPanel(); }) }, 'New Folder'),
      h('button', { class: 'btn', type: 'button', id: 'dp-upload', title: 'Add a .json design file to this folder', onclick: () => uploadDesign() }, 'Upload')),
    h('nav', { class: 'dpcrumbs', id: 'dp-crumbs', 'aria-label': 'Folder' }, ...crumbs),
    list);
}
async function openDesign(id, versionId) {
  const rec = await libGet('designs', id); if (!rec) { toast('That design is no longer in the library'); return; }
  const i = tabs.findIndex((t, k) => (k === tabIdx ? doc : t.doc).meta?.id === id);
  if (i >= 0 && !versionId) { activateTab(i); toast(`“${rec.name}” is already open`); return; }
  const v = versionId ? await libGet('versions', versionId) : await libGet('versions', rec.latest);
  if (!v) { toast('The design has no saved version'); return; }
  const d = upgradeDoc(JSON.parse(JSON.stringify(v.doc))); if (!d) { toast('That version could not be read'); return; }
  if (versionId && v.n !== rec.version) { d.meta = { ...d.meta, viewing: v.n }; d.name = rec.name + ` (v${v.n})`; delete d.meta.id; }
  openInTab(d, { msg: `Opened “${d.name}”` });
}
async function renameDesign(id, n) {
  const rec = await libGet('designs', id); if (!rec) return;
  if (!n || n === rec.name) return;
  rec.name = n; await libPut('designs', rec);
  for (const [k, t] of tabs.entries()) { const d = k === tabIdx ? doc : t.doc; if (d.meta?.id === id) d.name = n; }
  $('#docTitle') && ($('#docTitle').textContent = doc.name); renderTabs(); renderBrowser(); renderDataPanel();
}
async function deleteDesign(id) {
  const rec = await libGet('designs', id); if (!rec) return;
  openModal('Delete design', 'delete', h('p', { class: 'note', style: 'max-width:380px' }, `Delete “${rec.name}” and all ${rec.version} version${rec.version === 1 ? '' : 's'} from the library? Open tabs keep their copy as an unsaved design.`), [
    h('button', { class: 'btn ok', id: 'del-ok', onclick: async () => { closeModal(); for (const v of await libVersions(id)) await libDel('versions', v.id); await libDel('designs', id); for (const [k, t] of tabs.entries()) { const d = k === tabIdx ? doc : t.doc; if (d.meta?.id === id) { d.meta = { type: d.meta.type }; } } renderTabs(); renderDataPanel(); toast('Design deleted'); } }, 'Delete'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
async function deleteFolder(P, f, designs) {
  const ids = new Set([f.id]); let grew = true; while (grew) { grew = false; for (const x of P.folders) if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }
  if (designs.some(d => d.project === P.id && ids.has(d.folder))) { toast('Move or delete the designs in this folder first'); return; }
  P.folders = P.folders.filter(x => !ids.has(x.id)); await libPut('projects', P); renderDataPanel();
}
function uploadDesign() {
  const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  inp.addEventListener('change', () => {
    const file = inp.files?.[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const d = upgradeDoc(JSON.parse(rd.result)); if (!d) throw new Error('bad');
        const name = d.name || file.name.replace(/\.(draftwork\.)?json$/i, '');
        const { rec } = await commitVersion({ name, type: d.meta?.type || 'hybrid', partNumber: await nextPartNumber(), project: dataProject, folder: dataFolder, doc: d, label: 'Uploaded ' + file.name });
        renderDataPanel(); toast(`Uploaded “${rec.name}”`);
      } catch (e) { toast('That file is not a Draftwork design'); }
    };
    rd.readAsText(file);
  });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}
async function openVersions(id) {
  const rec = await libGet('designs', id); if (!rec) return;
  const vs = await libVersions(id);
  const rows = vs.map(v => h('tr', {}, h('td', {}, 'v' + v.n + (v.n === rec.version ? ' (latest)' : '')), h('td', {}, fmtDate(v.date)), h('td', {}, v.label || '—'),
    h('td', {}, h('button', { class: 'btn', type: 'button', onclick: () => { closeModal(); openDesign(id, v.id); } }, 'Open'),
      v.n === rec.version ? null : h('button', { class: 'btn', type: 'button', style: 'margin-left:4px', 'data-promote': v.n, onclick: async () => {
        closeModal();
        const { rec: r2, doc: d2 } = await commitVersion({ id, name: rec.name, type: rec.type, partNumber: rec.partNumber, project: rec.project, folder: rec.folder, doc: v.doc, label: `Promoted from v${v.n}` });
        const i = tabs.findIndex((t, k) => (k === tabIdx ? doc : t.doc).meta?.id === id);
        if (i === tabIdx) { doc = d2; cache = []; afterDocReplace(); dirty = false; $('#dirty').hidden = true; renderTabs(); persist(); } else if (i >= 0) { tabs[i].doc = d2; tabs[i].dirty = false; renderTabs(); }
        renderDataPanel(); toast(`v${v.n} promoted to v${r2.version}`);
      } }, 'Promote'))));
  openModal('Versions · ' + rec.name, 'history', h('div', { class: 'tablewrap' }, h('table', { class: 'grid', id: 'versions-table' }, h('thead', {}, h('tr', {}, ...['Version', 'Saved', 'Description', ''].map(t => h('th', {}, t)))), h('tbody', {}, rows)),
    h('p', { class: 'note' }, `${rec.partNumber || 'No part number'} · ${designTypeLabel(rec.type)}. Open shows an older version in its own tab; Promote makes it the latest version.`)));
}
function openCurrentVersions() { if (!doc.meta?.id) { toast('Save the design first: versions start with the first save'); return; } openVersions(doc.meta.id); }

// ---------- wiring ----------
{
  const old = $('.doctab'); if (old) { const box = h('div', { class: 'doctabs', id: 'docTabs', role: 'tablist', 'aria-label': 'Open designs' }); old.replaceWith(box); }
  $('#abData').replaceWith((() => { const b = h('button', { class: 'abtn', id: 'abData', 'aria-label': 'Data panel', title: 'Data panel', 'aria-pressed': 'false', html: icon('apps') }); b.addEventListener('click', () => toggleDataPanel()); return b; })());
  $('#abSave').replaceWith((() => { const b = h('button', { class: 'abtn', id: 'abSave', 'aria-label': 'Save', title: 'Save (Ctrl+S)', html: icon('save') }); b.addEventListener('click', () => saveCmd()); return b; })());
  const init = () => { if (!doc) { setTimeout(init, 50); return; } if (!doc.meta) doc.meta = { type: 'hybrid' }; restoreSession(); renderTabs(); renderBrowser(); };
  init(); libOpen();
}

// ---------- assembly designs: every body lives in a component ----------
function assemblyAutoComponents() {
  // Hybrid designs: bodies made with the New Component operation get their own component
  if (designType() === 'hybrid') {
    for (const f of doc.features) {
      if (f.op !== 'newcomp' || f.suppressed) continue;
      const ids = [...result.bodies.keys()].filter(id => String(id).split(':')[0] === f.id && !compOfBody(id));
      if (ids.length) comps().push({ id: uid(), name: f.name, bodies: ids, grounded: false, feature: f.id });
    }
    return;
  }
  if (designType() !== 'assembly') return;
  const free = [...result.bodies.keys()].filter(id => !compOfBody(id));
  if (!free.length) return;
  const byFeat = new Map();
  for (const id of free) { const fid = result.bodies.get(id)?.feature || id; if (!byFeat.has(fid)) byFeat.set(fid, []); byFeat.get(fid).push(id); }
  for (const [fid, ids] of byFeat) {
    const f = featById(String(fid).split(':')[0]);
    comps().push({ id: uid(), name: (f?.name || bodyName(ids[0])).replace(/^Body\b/, 'Component'), bodies: ids, grounded: comps().length === 0 });
  }
  if (!assemblyAutoComponents.told) { assemblyAutoComponents.told = true; toast('Assembly design: new bodies go into their own components'); }
}
// ---------- insert a saved design into the open one (a derived, updatable component) ----------
async function insertFromLibrary(id) {
  const rec = await libGet('designs', id); if (!rec) return;
  if (doc.meta?.id === id) { toast('A design cannot be inserted into itself'); return; }
  if (!needExact('Insert')) return;
  const v = await libGet('versions', rec.latest); if (!v) { toast('The design has no saved version'); return; }
  const d = v.doc, fileId = uid(); checkpoint();
  doc.files ||= {}; doc.files[fileId] = { name: rec.name, design: { name: rec.name, params: d.params || [], features: d.features }, kind: 'design', lib: { id, version: rec.version, partNumber: rec.partNumber } };
  const f = { id: uid(), type: 'derive', name: rec.name, file: fileId, dx: 0, dy: 0, dz: 0 };
  insertFeature(f); scheduleRegen(0); toggleDataPanel(false);
  toast(`Inserted “${rec.name}” v${rec.version}`);
}
async function updateDerived(fid) {
  const f = featById(fid), file = f && doc.files?.[f.file]; if (!file?.lib) return;
  const rec = await libGet('designs', file.lib.id); if (!rec) { toast('The source design is no longer in the library'); return; }
  const v = await libGet('versions', rec.latest); if (!v) return;
  checkpoint();
  file.design = { name: rec.name, params: v.doc.params || [], features: v.doc.features }; file.lib.version = rec.version; file.name = rec.name;
  scheduleRegen(0); rerenderDialog?.(); toast(`Updated “${rec.name}” to v${rec.version}`);
}
// insertDialog hook: library source line with an update check
async function derivedSourceInfo(f, el) {
  const file = doc.files?.[f.file]; if (!file?.lib || !el) return;
  const rec = await libGet('designs', file.lib.id);
  el.replaceChildren(rec ? (rec.version > file.lib.version
    ? h('span', {}, `From the library: v${file.lib.version} (v${rec.version} available) `, h('button', { class: 'btn', type: 'button', id: 'derive-update', onclick: () => updateDerived(f.id) }, 'Update'))
    : `From the library: v${file.lib.version} (up to date)${file.lib.partNumber ? ' · ' + file.lib.partNumber : ''}`) : 'The source design is no longer in the library');
}
