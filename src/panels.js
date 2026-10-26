// ===== Browser tree, timeline, dialogs, palette, modals =====

// ---------- browser ----------
const expanded = new Set(['root', 'settings', 'bodies', 'sketches', 'construction', 'analysis']);
let renaming = null;
function node(level, o) {
  const row = h('div', { class: 'node' + (o.sel ? ' sel' : '') + (o.err ? ' err' : ''), role: 'treeitem', style: `padding-left:${4 + level * 14}px`, 'aria-expanded': o.key ? String(expanded.has(o.key)) : null });
  const tw = h('button', { class: 'tw' + (o.key ? '' : ' none'), 'aria-label': o.key ? (expanded.has(o.key) ? 'Collapse ' : 'Expand ') + o.label : null, tabindex: o.key ? null : '-1', 'aria-expanded': o.key ? String(expanded.has(o.key)) : null, html: icon('chevron') });
  if (o.key) tw.addEventListener('click', () => { expanded.has(o.key) ? expanded.delete(o.key) : expanded.add(o.key); renderBrowser(); });
  row.append(tw);
  if (o.vis != null) {
    row.append(h('button', { class: 'vis' + (o.vis ? '' : ' off'), 'aria-label': (o.vis ? 'Hide ' : 'Show ') + o.label, title: o.vis ? 'Hide' : 'Show', onclick: e => { e.stopPropagation(); o.onVis(); }, html: icon(o.vis ? 'eye' : 'eyeoff') }));
  } else row.append(h('span', { style: 'width:22px;flex:none' }));
  if (o.swatch) row.append(h('span', { class: 'swatch', style: `background:${o.swatch}` }));
  row.append(h('span', { class: 'nico', html: icon(o.icon) }));
  if (renaming && renaming === o.renameKey) {
    const inp = h('input', { class: 'rename', value: o.label, 'aria-label': 'New name' });
    const commit = ok => { if (renaming !== o.renameKey) return; renaming = null; if (ok && inp.value.trim()) o.onRename(inp.value.trim()); renderBrowser(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => commit(true));
    row.append(inp); setTimeout(() => { inp.focus(); inp.select(); }, 0);
  } else {
    const lab = h('button', { class: 'nlab' + (o.dim ? ' dim' : ''), title: o.title || o.label }, o.label, o.sub ? h('span', { class: 'sub' }, o.sub) : null);
    lab.addEventListener('click', () => o.onClick?.());
    lab.addEventListener('dblclick', () => o.onDbl?.());
    if (o.menu) lab.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(lab, o.menu(), { at: { x: e.clientX, y: e.clientY } }); });
    row.append(lab);
  }
  return row;
}
function renderBrowser() {
  const t = $('#btree'); t.replaceChildren();
  const add = (lvl, o) => { t.append(node(lvl, o)); return expanded.has(o.key); };
  if (workspace === 'manufacture') { expanded.add('camroot'); renderCamBrowser(add); return; }
  if (workspace === 'simulation') { for (const k of ['simroot', 'simbc', 'simld', 'simres']) if (!expanded.has('x' + k)) { expanded.add(k); expanded.add('x' + k); } renderSimBrowser(add); return; }
  if (!add(0, { key: 'root', icon: (typeof DESIGN_TYPES !== 'undefined' && DESIGN_TYPES && DESIGN_TYPES[designType()]?.icon) || 'doc', label: doc.name, sub: typeof DESIGN_TYPES !== 'undefined' && DESIGN_TYPES ? designTypeLabel() + (doc.meta?.version ? ' · v' + doc.meta.version : '') + (doc.meta?.partNumber ? ' · ' + doc.meta.partNumber : '') : '', renameKey: 'doc', onRename: v => { checkpoint(); doc.name = v; $('#docTitle').textContent = v; renderTabs(); }, onDbl: () => { renaming = 'doc'; renderBrowser(); },
    menu: () => [{ label: 'Rename', icon: 'params', action: () => { renaming = 'doc'; renderBrowser(); } }, { label: 'Save', icon: 'save', action: () => saveCmd() }, { label: 'Save As…', icon: 'save', action: () => saveAsCmd() }, { label: 'Versions…', icon: 'history', action: () => openCurrentVersions() }, '-', { label: 'Create Drawing…', icon: 'properties', action: () => openCreateDrawing(null) }] })) return;
  if (add(1, { key: 'settings', icon: 'gear', label: 'Document Settings' })) {
    add(2, { icon: 'ruler', label: `Units: ${docUnit()}, g`, onClick: () => openUnitsDialog() });
  }
  if (add(1, { key: 'views', icon: 'folder', label: 'Named Views' })) {
    for (const [k, l] of [['top', 'TOP'], ['front', 'FRONT'], ['right', 'RIGHT'], ['iso', 'HOME']]) add(2, { icon: 'lookat', label: l, onClick: () => setView(k) });
  }
  if (add(1, { key: 'origin', icon: 'folder', label: 'Origin', vis: !!doc.showOrigin, onVis: () => { doc.showOrigin = !doc.showOrigin; persist(); renderBrowser(); updateScene(); } })) {
    add(2, { icon: 'point', label: 'O', dim: true });
    for (const a of ['X', 'Y', 'Z']) add(2, { icon: 'axis', label: a, dim: true });
    for (const p of ['XY', 'XZ', 'YZ']) add(2, { icon: 'plane', label: p, onClick: () => { if (pick?.planes) completePick({ plane: p, offset: 0, flip: false, local: null }); else { doc.showOrigin = true; renderBrowser(); updateScene(); } } });
  }
  if (section && add(1, { key: 'analysis', icon: 'folder', label: 'Analysis' })) {
    add(2, { icon: 'section', label: 'Section ' + section.axis, vis: !section.hidden, onVis: () => { section.hidden = !section.hidden; applySectionVisibility(); }, onDbl: () => openSectionDialog(),
      menu: () => [{ label: 'Edit Section', icon: 'section', action: () => openSectionDialog() }, { label: 'Delete', icon: 'delete', action: () => { section = null; updateScene(); renderBrowser(); renderRibbon(); } }] });
  }
  const bodyNode = (lvl, b) => add(lvl, { icon: b.mesh ? 'remesh' : isSurfBody(b.id) ? 'patch' : 'bodyi', label: bodyName(b.id), swatch: bodyColor(b.id), sel: selBody === b.id, vis: !doc.bodyMeta[b.id]?.hidden, title: bodyName(b.id) + ' · ' + bodyMaterial(b.id),
    onVis: () => { meta(b.id).hidden = !meta(b.id).hidden; persist(); mpCache = null; updateScene(); renderBrowser(); renderInfo(); },
    onClick: () => selectBody(b.id), onDbl: () => { renaming = 'b:' + b.id; renderBrowser(); }, renameKey: 'b:' + b.id, onRename: v => { meta(b.id).name = v; persist(); mpCache = null; renderInfo(); },
    menu: () => bodyMenu(b.id) });
  if (comps().length && add(1, { key: 'components', icon: 'folder', label: 'Components', sub: String(comps().length) })) {
    for (const c of comps()) {
      const own = c.bodies.map(id => result.bodies.get(id)).filter(Boolean);
      if (add(2, { key: 'c:' + c.id, icon: 'component', label: c.name + (c.grounded ? ' (grounded)' : ' · ' + compMotion(c).text), sub: String(own.length), renameKey: 'c:' + c.id,
        onRename: v => { checkpoint(); c.name = v.trim() || c.name; persist(); }, onDbl: () => { renaming = 'c:' + c.id; renderBrowser(); },
        menu: () => [{ label: 'Rename', icon: 'params', action: () => { renaming = 'c:' + c.id; renderBrowser(); } },
          { label: c.grounded ? 'Unground' : 'Ground', icon: 'component', action: () => toggleGround(c.id) },
          { label: 'Save Copy As…', icon: 'save', action: () => saveComponentCopy(c.id) },
          { label: 'Create Drawing…', icon: 'properties', action: () => openCreateDrawing(c.bodies.filter(id => result.bodies.has(id))) },
          '-', { label: 'Dissolve (bodies return to the fixed set)', icon: 'delete', action: () => dissolveComponent(c.id) }] }))
        for (const b of own) bodyNode(3, b);
    }
  }
  if (groups().length && add(1, { key: 'rgroups', icon: 'folder', label: 'Rigid Groups', sub: String(groups().length) })) {
    for (const g of groups()) add(2, { icon: 'component', label: g.name, sub: g.comps.map(id => compById(id)?.name).filter(Boolean).join(', '),
      renameKey: 'g:' + g.id, onRename: v => { checkpoint(); g.name = v.trim() || g.name; persist(); renderTimeline(); }, onDbl: () => { renaming = 'g:' + g.id; renderBrowser(); },
      menu: () => [{ label: 'Rename', icon: 'params', action: () => { renaming = 'g:' + g.id; renderBrowser(); } }, '-', { label: 'Delete', icon: 'delete', action: () => deleteRigidGroup(g.id) }] });
  }
  if (joints().length && add(1, { key: 'joints', icon: 'folder', label: 'Joints', sub: String(joints().length) })) {
    for (const j of joints()) {
      const st = jointStatus.get(j.id);
      add(2, { icon: 'joint', label: j.name, sub: JOINT_TYPES[j.type]?.label, sel: selJoint === j.id, err: st?.state === 'error' || st?.state === 'warn', dim: st?.state === 'suppressed', title: st?.msg || '',
        onClick: () => selectJoint(j.id), onDbl: () => editJoint(j.id), renameKey: 'j:' + j.id, onRename: v => { checkpoint(); j.name = v; persist(); },
        menu: () => [{ label: 'Edit Joint', icon: 'joint', action: () => editJoint(j.id) }, { label: j.suppressed ? 'Unsuppress' : 'Suppress', icon: 'eye', action: () => toggleJointSuppressed(j.id) },
          '-', { label: 'Delete', icon: 'delete', action: () => deleteJoint(j.id) }] });
    }
  }
  if (doc.motionLinks?.length && add(1, { key: 'mlinks', icon: 'folder', label: 'Motion Links', sub: String(doc.motionLinks.length) })) {
    for (const L of doc.motionLinks) add(2, { icon: 'motion', label: L.name, sub: (joints().find(j => j.id === L.a)?.name || '?') + ' → ' + (joints().find(j => j.id === L.b)?.name || '?'), onDbl: () => openMotionLink(L.id), onClick: () => openMotionLink(L.id),
      menu: () => [{ label: 'Edit', icon: 'motion', action: () => openMotionLink(L.id) }, '-', { label: 'Delete', icon: 'delete', action: () => { checkpoint(); doc.motionLinks = doc.motionLinks.filter(x => x !== L); persist(); assemblyChanged(); renderBrowser(); } }] });
  }
  if (doc.configs?.rows?.length) add(1, { icon: 'configure', label: 'Configuration', sub: doc.configs.rows.find(r => r.id === doc.configs.active)?.name || '—', onClick: () => openConfigTable() });
  const canv = doc.features.filter(f => f.type === 'canvas' || f.type === 'decal');
  if (canv.length && add(1, { key: 'canvases', icon: 'folder', label: 'Canvases' })) {
    for (const c of canv) add(2, { icon: c.type, label: c.name, vis: !c.hidden, onVis: () => { c.hidden = !c.hidden; persist(); drawToolsOverlay(); renderBrowser(); requestRender(); }, onClick: () => selectFeature(c.id), onDbl: () => editFeature(c.id), menu: () => featureMenu(c.id) });
  }
  const bodies = [...result.bodies.values()].filter(b => !compOfBody(b.id));
  if (bodies.length && add(1, { key: 'bodies', icon: 'folder', label: 'Bodies', sub: String(bodies.length), vis: !doc.hideAllBodies, onVis: () => { doc.hideAllBodies = !doc.hideAllBodies; persist(); updateScene(); renderBrowser(); renderInfo(); } })) {
    for (const b of bodies) bodyNode(2, b);
  }
  const sketches = doc.features.filter(f => f.type === 'sketch');
  if (sketches.length && add(1, { key: 'sketches', icon: 'folder', label: 'Sketches' })) {
    for (const s of sketches) add(2, { icon: 'sketch', label: s.name, sel: selFeature === s.id, err: statusOf(s.id).state === 'error', dim: statusOf(s.id).state === 'rolled',
      vis: !!doc.sketchShown[s.id], onVis: () => { doc.sketchShown[s.id] = !doc.sketchShown[s.id]; persist(); refreshOverlays(); renderBrowser(); },
      onClick: () => selectFeature(s.id), onDbl: () => editFeature(s.id), renameKey: 'f:' + s.id, onRename: v => { checkpoint(); s.name = v; renderTimeline(); }, menu: () => featureMenu(s.id) });
  }
  const planes = doc.features.filter(f => f.type === 'plane' || f.type === 'axis' || f.type === 'point');
  if (planes.length && add(1, { key: 'construction', icon: 'folder', label: 'Construction' })) {
    for (const p of planes) add(2, { icon: p.type, label: p.name, sel: selFeature === p.id, err: statusOf(p.id).state === 'error', dim: statusOf(p.id).state === 'rolled',
      vis: !doc.planeHidden[p.id], onVis: () => { doc.planeHidden[p.id] = !doc.planeHidden[p.id]; persist(); updateScene(); renderBrowser(); },
      onClick: () => { if (pick?.planes && result.planes.has(p.id)) completePick({ plane: p.id, offset: 0, flip: false, local: null }); else selectFeature(p.id); },
      onDbl: () => editFeature(p.id), renameKey: 'f:' + p.id, onRename: v => { checkpoint(); p.name = v; renderTimeline(); updateScene(); }, menu: () => featureMenu(p.id) });
  }
  add(1, { icon: 'params', label: 'User Parameters', sub: String(doc.params.length), onClick: () => openParamsModal(), err: Object.keys(params.errors).length > 0 });
}
function bodyMenu(id) {
  return [
    { label: 'Rename', icon: 'params', action: () => { renaming = 'b:' + id; renderBrowser(); } },
    { label: 'Physical Material', icon: 'material', action: () => { selectBody(id); openMaterialDialog(); } },
    { label: 'Appearance', icon: 'appearance', action: () => { selectBody(id); openAppearanceDialog(); } },
    { label: 'Move/Copy', icon: 'move', action: () => { selectBody(id); newMove(); } },
    ...(compOfBody(id) ? [] : [{ label: 'Create Component', icon: 'component', action: () => { selectBody(id); newComponent(); } }]),
    { label: 'Find in Timeline', icon: 'start', action: () => { const fid = result.bodies.get(id)?.feature; if (fid) selectFeature(fid); } },
    { label: doc.bodyMeta[id]?.hidden ? 'Show' : 'Hide', icon: 'eye', action: () => { meta(id).hidden = !meta(id).hidden; updateScene(); renderBrowser(); } },
    { label: 'Export STL…', icon: 'exportstl', action: () => openExportDialog([id]) },
    { label: 'Create Drawing…', icon: 'properties', action: () => openCreateDrawing([id]) },
    '-',
    { label: 'Remove', icon: 'delete', action: () => { selectBody(id); deleteSelection(); } },
  ];
}
function featureMenu(id) {
  const f = featById(id); if (!f) return [];
  const items = [{ label: f.type === 'sketch' ? 'Edit Sketch' : 'Edit Feature', icon: featIcon(f), action: () => editFeature(id) }];
  if ((f.type === 'extrude' || f.type === 'revolve') && featById(f.sketch)) items.push({ label: 'Edit Profile Sketch', icon: 'sketch', action: () => editFeature(f.sketch) });
  items.push({ label: 'Rename', icon: 'params', action: () => { renaming = 'f:' + id; expanded.add(f.type === 'plane' ? 'construction' : 'sketches'); renderBrowser(); if (f.type !== 'sketch' && f.type !== 'plane') renameInTimeline(id); } },
    { label: f.suppressed ? 'Unsuppress Feature' : 'Suppress Feature', icon: 'eyeoff', action: () => { checkpoint(); f.suppressed = !f.suppressed; scheduleRegen(0); } },
    { label: 'Roll History Marker Here', icon: 'start', action: () => setRollback(featIndex(id)) },
    '-', { label: 'Delete', icon: 'delete', action: () => deleteFeature(id) });
  return items;
}
function renameInTimeline(id) {
  const f = featById(id);
  openPanelDialog({ title: 'Rename', icon: featIcon(f), body: [row('Name', (() => { const i = h('input', { type: 'text', id: 'rn-name', value: f.name }); setTimeout(() => { i.focus(); i.select(); }, 0); return i; })())],
    onOK: () => { const v = $('#rn-name').value.trim(); if (v) { checkpoint(); f.name = v; renderTimeline(); renderBrowser(); } } });
}

// ---------- timeline ----------
function renderTimeline() {
  const track = $('#tlTrack'); track.replaceChildren();
  const n = doc.features.length;
  if (!n) { track.append(h('span', { class: 'note' }, 'The timeline records every step. Start with Create Sketch or a Box.')); return; }
  const mk = () => { const m = h('button', { class: 'marker', 'aria-label': 'History marker. Arrow keys move it.', title: 'Drag to roll the history back' }); wireMarker(m); return m; };
  if (doc.rollback === -1) track.append(mk());
  doc.features.forEach((f, i) => {
    const st = statusOf(f.id);
    const chip = h('button', { class: `chip s-${st.state}`, 'data-i': String(i), 'aria-current': String(selFeature === f.id || dlg?.fid === f.id || sketchId === f.id),
      'aria-label': `${i + 1}. ${f.name} (${typeLabel(f)})${st.msg ? ': ' + st.msg : ''}`, title: `${f.name} · ${typeLabel(f)}${st.msg ? '\n⚠ ' + st.msg : ''}`, html: icon(featIcon(f)) });
    chip.addEventListener('click', () => { if (selFeature === f.id && mode === 'model' && !dlg) editFeature(f.id); else selectFeature(f.id); });
    chip.addEventListener('dblclick', () => editFeature(f.id));
    chip.addEventListener('contextmenu', e => { e.preventDefault(); selectFeature(f.id); openMenu(chip, featureMenu(f.id), { at: { x: e.clientX, y: e.clientY - 200 } }); });
    track.append(chip);
    if (doc.rollback === i) track.append(mk());
  });
  if (doc.rollback == null) track.append(mk());
  const asm = assemblyChips();
  if (asm.length) track.append(h('span', { class: 'tlsep', 'aria-hidden': 'true' }), ...asm);   // assembly steps apply after the features
  const cur = track.querySelector('[aria-current="true"]') || (doc.rollback != null ? track.querySelector('.marker') : null);
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function wireMarker(m) {
  m.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepMarker(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepMarker(1); }
  });
  m.addEventListener('pointerdown', e => {
    e.preventDefault(); m.setPointerCapture(e.pointerId);
    const chips = [...$('#tlTrack').querySelectorAll('.chip[data-i]')];
    let target = doc.rollback;
    const move = ev => {
      const x = ev.clientX; let idx = -1;
      chips.forEach((c, i) => { const r = c.getBoundingClientRect(); if (x > r.left + r.width / 2) idx = i; });
      target = idx >= chips.length - 1 ? null : idx;
      const ref = target == null ? null : target === -1 ? chips[0] : chips[target + 1];
      $('#tlTrack').insertBefore(m, ref);
    };
    const up = () => { m.removeEventListener('pointermove', move); m.removeEventListener('pointerup', up); if (target !== doc.rollback) setRollback(target); };
    m.addEventListener('pointermove', move); m.addEventListener('pointerup', up);
  });
}
function stepMarker(d) {
  const n = doc.features.length; const cur = doc.rollback ?? n - 1;
  setRollback(Math.max(-1, Math.min(n - 1, cur + d)));
}
function setRollback(r) {
  const n = doc.features.length;
  if (r != null && r >= n - 1) r = null;
  if (r != null && r < -1) r = -1;
  if (dlg) closeDialog(true);
  doc.rollback = r;
  if (mode === 'sketch' && r != null && featIndex(sketchId) > r) exitSketch(true);
  scheduleRegen(0);
}
function renderInfo() {
  const mp = massProps();
  const errs = [...result.status.values()].filter(v => v.state === 'error').length;
  const vis = mp.bodies.filter(b => !b.hidden);
  $('#tlInfo').innerHTML = vis.length
    ? `<b>${vis.length}</b> ${vis.length > 1 ? 'bodies' : 'body'} · <b>${uVol(mp.total.volume).replace(/ (cm³|in³)$/, '</b> $1')} · <b>${fix(mp.total.mass, 1)}</b> g<br>${errs ? `<span class="bad">${errs} ${errs > 1 ? 'features need' : 'feature needs'} attention</span>` : 'Rebuilt in ' + fix(lastRegenMs, 0) + ' ms'}${doc.rollback != null ? ' · rolled back' : ''}`
    : (errs ? `<span class="bad">${errs} ${errs > 1 ? 'features need' : 'feature needs'} attention</span>` : 'No bodies yet');
}

// ---------- form rows ----------
function row(label, control, id) { return h('div', { class: 'row' }, h('label', { for: id || control.id || null }, label), control); }
function exField(label, obj, key, unit = 'mm', o = {}) {
  const id = o.id || ('dx-' + key);
  const wrap = h('div', { class: 'exin' });
  const val = h('span', { class: 'val' });
  // length fields follow the document units: plain numbers are shown and typed in them (stored in mm)
  const du = unit === 'mm' && typeof docUnit === 'function' ? docUnit() : 'mm', k = du === 'mm' ? 1 : UNIT_DEFS[du][0];
  const raw0 = obj[key] ?? '', raw = k !== 1 && typeof raw0 === 'number' ? fmt(raw0 / k) : raw0;
  const inp = h('input', { type: 'text', id, value: String(raw), inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off' });
  const show = () => {
    const s = inp.value.trim(); let ok = true, v = null;
    const isNum = /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s);
    try { v = isNum ? parseFloat(s) * k : evalExpr(s, params.vars); if (o.min != null && v < o.min) throw new Error('Must be at least ' + fmt(o.min / k)); if (o.max != null && v > o.max) throw new Error('Must be at most ' + fmt(o.max / k)); } catch (e) { ok = false; inp.title = e.message; }
    wrap.classList.toggle('bad', !ok); wrap.classList.toggle('expr', ok && !isNum);
    val.textContent = ok && !isNum ? '= ' + fmt(v / k) : '';
    if (ok) inp.title = '';
    return { ok, v, isNum, s };
  };
  inp.addEventListener('input', () => {
    const r = show(); if (!r.ok) return;
    checkpoint(id + ':' + (obj.id || ''));
    obj[key] = r.isNum ? parseFloat(r.s) * k : r.s;
    o.after?.(); scheduleRegen(o.delay ?? 160); if (mode === 'sketch') refreshOverlays();
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const r = show(); if (!r.ok || !r.isNum) return; e.preventDefault();
      const step = o.step || (unit === '°' ? 5 : du === 'in' ? 0.1 : 1); inp.value = fmt(r.v / k + (e.key === 'ArrowUp' ? step : -step)); inp.dispatchEvent(new Event('input'));
    }
  });
  unit = unit === 'mm' ? du : unit;
  wrap.append(inp, val, h('span', { class: 'u' }, unit));
  show();
  return row(label, wrap, id);
}
function selField(label, obj, key, options, o = {}) {
  const id = o.id || ('ds-' + key);
  const cur = obj[key] && typeof obj[key] === 'object' ? '__face' : String(obj[key] ?? '');
  const s = h('select', { id }, options.map(([v, t]) => h('option', { value: v, selected: cur === String(v) }, t)));
  s.addEventListener('change', () => { if (s.value === '__face') return; checkpoint(); obj[key] = o.numeric ? +s.value : (s.value === '' ? null : s.value); o.after?.(); if (o.rerender) rerenderDialog(); scheduleRegen(0); });
  return row(label, s, id);
}
function segField(label, obj, key, options, o = {}) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const [v, t] of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String((obj[key] ?? options[0][0]) === v), onclick: () => {
      if (obj[key] === v) return; checkpoint(); obj[key] = v;
      wrap.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      o.after?.(); if (o.rerender) rerenderDialog(); scheduleRegen(0);
    } }, t);
    wrap.append(b);
  }
  return h('div', { class: 'row' }, h('span', { class: 'rl' }, label), wrap);
}
function chkField(label, obj, key, o = {}) {
  const id = o.id || ('dc-' + key);
  const c = h('input', { type: 'checkbox', id, checked: !!obj[key] });
  c.addEventListener('change', () => { checkpoint(); obj[key] = c.checked; o.after?.(); if (o.rerender) rerenderDialog(); scheduleRegen(0); });
  return h('div', { class: 'row' }, h('span', { class: 'rl' }), h('label', { class: 'chk', for: id }, c, label));
}
const section_ = (title, ...kids) => h('div', { class: 'dsec' }, title ? h('h4', {}, title) : null, ...kids);

// planes / bodies / features available before a feature
function planeOptions(beforeIdx, cur) {
  const opts = [['XY', 'XY plane (Top)'], ['XZ', 'XZ plane (Front)'], ['YZ', 'YZ plane (Right)']];
  if (cur && typeof cur === 'object') opts.unshift(['__face', 'Picked face']);
  doc.features.slice(0, beforeIdx).filter(f => f.type === 'plane').forEach(p => opts.push([p.id, p.name]));
  return opts;
}
const TAP_LIST = [['M2', 2, 0.4], ['M2.5', 2.5, 0.45], ['M3', 3, 0.5], ['M4', 4, 0.7], ['M5', 5, 0.8], ['M6', 6, 1], ['M8', 8, 1.25], ['M10', 10, 1.5], ['M12', 12, 1.75], ['M14', 14, 2], ['M16', 16, 2], ['M20', 20, 2.5], ['M24', 24, 3]];
// "To object" target: a construction plane from the list, or a picked plane / flat face
function targetRow(f, key) {
  const idx = featIndex(f.id);
  return h('div', {}, selField('To', f, key, [['', 'Pick a plane or face…'], ...planeOptions(idx, f[key])], { id: 'ds-to' }),
    h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'pick-to', onclick: () => startPick({ prompt: 'Select the plane or flat face to extend to', planes: true, faces: true, then: c => { checkpoint(); f[key] = pickToPlaneRef(c); rerenderDialog(); scheduleRegen(0); } }) }, 'Pick plane or face')));
}
function bodiesBefore(fid) { return (result.before.get(fid) || [...result.bodies.keys()]).map(id => [id, bodyName(id)]); }   // before its first rebuild a new feature sees the current bodies
const opOptions = [['join', 'Join'], ['cut', 'Cut'], ['intersect', 'Intersect'], ['new', 'New Body']];

// ---------- command dialog ----------
function openFeatureDialog(fid, isNew, snapshot) {
  if (dlg) closeDialog(true);
  dlg = { fid, isNew, snapshot: snapshot || leanJSON(doc), undoLen: history.undo.length };
  selFeature = fid;
  rerenderDialog(); updateScene(); renderTimeline(); renderBrowser();
}
function rerenderDialog() {
  if (!dlg) return;
  const el = $('#dialog'); el.hidden = false; el.replaceChildren();
  if (dlg.custom) { buildCustomDialog(el, dlg.custom); return; }
  const f = featById(dlg.fid); if (!f) { closeDialog(false, true); return; }
  const idx = featIndex(f.id);
  const head = h('div', { class: 'dhead', html: icon(featIcon(f)) + `<span>${typeLabel(f)}</span>` });
  head.append(h('button', { class: 'x', 'aria-label': 'Cancel', onclick: () => closeDialog(false), html: icon('close') }));
  const body = h('div', { class: 'dbody' });
  body.append(h('div', { class: 'err', id: 'dlgErr', hidden: true }));
  body.append(...featureFields(f, idx));
  const foot = h('div', { class: 'dfoot' },
    h('span', { class: 'info', title: dialogHelp(f), html: icon('info') }),
    h('button', { class: 'btn ok', onclick: () => closeDialog(true) }, 'OK'),
    h('button', { class: 'btn', onclick: () => closeDialog(false) }, 'Cancel'));
  el.append(head, body, foot);
  refreshDialogStatus();
}
function dialogHelp(f) {
  return { extrude: 'Pushes a closed sketch profile into a solid.', revolve: 'Spins a profile around a sketch axis.', hole: 'Drills a hole into the bodies below the placement plane.',
    pattern: 'Repeats a feature. Copies of a New Body feature become new bodies.', mirror: 'Mirrors a feature across an origin plane.', plane: 'A reference plane you can sketch on.',
    move: 'Moves or copies a body. Rotation is about the origin.', sweep: 'Moves a profile along a sketched path.', draft: 'Tilts the picked faces so the part releases from a mold.', loft: 'Blends a solid through two or more profiles.', import: 'Solids read from a STEP file.', fillet: 'Rounds the picked edges. Edge picks follow the model when earlier steps change.', chamfer: 'Bevels the picked edges.', shell: 'Hollows the body, opening the picked faces, with walls of the given thickness.', combine: 'Joins, cuts or intersects bodies with each other.' }[f.type] || 'Values accept expressions such as width/2 + 5.';
}
function featureFields(f, idx) {
  const out = [];
  const nameRow = h('input', { type: 'text', id: 'dx-name', value: f.name, autocomplete: 'off' });
  nameRow.addEventListener('input', () => { checkpoint('name' + f.id); f.name = nameRow.value; renderTimeline(); renderBrowser(); });
  const opsSection = () => {
    const kids = [selField('Operation', f, 'op', typeof designType === 'function' && designType() === 'hybrid' ? [...opOptions, ['newcomp', 'New Component']] : opOptions, { rerender: true })];
    if (f.op !== 'new') kids.push(selField('Objects', f, 'target', [['', f.op === 'cut' ? 'All bodies it touches' : 'Automatic (last body)'], ...bodiesBefore(f.id)], { id: 'ds-target' }));
    return kids;
  };
  const placement = () => [selField('Plane', f, 'plane', planeOptions(idx, f.plane), { id: 'ds-plane' }), segField('Direction', f, 'flip', [[false, 'Normal'], [true, 'Flipped']]), exField('Offset', f, 'offset'),
    h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => repositionPlaced(f), html: icon('pick') + 'Pick face and point…' }))];
  const profileRow = () => {
    const sk = featById(f.sketch), st = sk?.geo ? geoState(sk) : null;
    if (!st?.regions.length) return null;
    const n = pickRegions(st.regions, f.regions).length;
    return h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Areas'), h('div', {},
      h('div', { class: 'note', style: 'margin:0' }, f.regions?.length ? `${n} picked. Click areas in the sketch to add or remove.` : `All filled areas (${n}). Click areas in the sketch to pick instead.`),
      f.regions?.length ? h('button', { class: 'btn', type: 'button', style: 'margin-top:4px', onclick: () => { checkpoint(); delete f.regions; rerenderDialog(); refreshOverlays(); scheduleRegen(0); } }, 'Use all filled areas') : null));
  };
  switch (f.type) {
    case 'extrude': {
      const sks = doc.features.slice(0, idx).filter(g => g.type === 'sketch');
      out.push(section_('Input', selField('Profile', f, 'sketch', sks.length ? sks.map(s => [s.id, s.name + ' (' + profCount(s) + ')']) : [['', 'No sketch before this step']]), profileRow()));
      const ext = f.extent || 'distance';
      const extKids = [selField('Extent', f, 'extent', [['distance', 'Distance'], ['two', 'Two sides'], ['to', 'To object'], ['all', 'All']], { rerender: true, id: 'ds-extent' })];
      if (ext === 'distance' || ext === 'all') extKids.push(segField('Direction', f, 'direction', [['one', 'One side'], ['symmetric', 'Symmetric'], ['reverse', 'Flipped']]));
      if (ext === 'distance' || ext === 'two') extKids.push(exField(ext === 'two' ? 'Side 1 distance' : 'Distance', f, 'distance', 'mm', { min: 0.001 }));
      if (ext === 'two') extKids.push(exField('Side 2 distance', f, 'distance2', 'mm', { min: 0.001 }));
      if (ext === 'to') extKids.push(targetRow(f, 'to'));
      extKids.push(exField('Start offset', f, 'startOffset', 'mm'), exField('Taper angle', f, 'taper', '°', { min: -59, max: 59 }));
      out.push(section_('Extent', ...extKids));
      out.push(section_('Thin', chkField('Thin extrude (wall only)', f, 'thin', { rerender: true }), ...(f.thin ? [exField('Wall thickness', f, 'thickness', 'mm', { min: 0.001 }), segField('Wall side', f, 'thinSide', [['inside', 'Inside'], ['both', 'Centered'], ['outside', 'Outside']])] : [])));
      out.push(section_('Result', ...opsSection()));
      break;
    }
    case 'revolve': {
      const sks = doc.features.slice(0, idx).filter(g => g.type === 'sketch');
      out.push(section_('Input', selField('Profile', f, 'sketch', sks.length ? sks.map(s => [s.id, s.name]) : [['', 'No sketch before this step']]),
        profileRow(), selField('Axis', f, 'axis', [['v', 'Sketch Y axis'], ['u', 'Sketch X axis'], ...axisOptions(idx)])));
      { const rx = f.extent || 'angle', kids = [selField('Extent', f, 'extent', [['angle', 'Angle'], ['two', 'Two sides'], ['full', 'Full']], { rerender: true, id: 'ds-extent' })];
        if (rx === 'angle') kids.push(segField('Direction', f, 'direction', [['one', 'One side'], ['symmetric', 'Symmetric'], ['reverse', 'Flipped']]));
        if (rx !== 'full') kids.push(exField(rx === 'two' ? 'Side 1 angle' : 'Angle', f, 'angle', '°', { min: 0.01, max: 360 }));
        if (rx === 'two') kids.push(exField('Side 2 angle', f, 'angle2', '°', { min: 0.01, max: 360 }));
        out.push(section_('Extent', ...kids)); }
      out.push(section_('Result', ...opsSection()));
      break;
    }
    case 'hole':
      out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy')));
      { if (!f.holeType) f.holeType = f.cbore ? 'cbore' : 'simple';
        const hx = f.extent || 'distance';
        out.push(section_('Shape', segField('Hole type', f, 'holeType', [['simple', 'Simple'], ['cbore', 'C-bore'], ['csink', 'C-sink']], { rerender: true, after: () => { f.cbore = f.holeType === 'cbore'; if (f.holeType === 'csink') { f.csDiameter ??= Math.round((+f.diameter || 6) * 2 * 10) / 10; f.csAngle ??= 90; } } }),
          chkField('Tapped (metric coarse)', f, 'tapped', { rerender: true, after: () => { f.tapSize ??= 'M6'; f.threadDepth ??= 0; } }),
          ...(f.tapped ? [selField('Size', f, 'tapSize', TAP_LIST.map(t => [t[0], `${t[0]} × ${t[2]} (drill Ø${fmt(t[1] - t[2])})`]), { id: 'ds-tapsize' }), chkField('Modeled thread (cut the real thread)', f, 'modeled'), exField('Thread depth (0 = full)', f, 'threadDepth', 'mm', { min: 0 })]
            : [exField('Diameter', f, 'diameter', 'mm', { min: 0.01 })]),
          ...(f.holeType === 'cbore' ? [exField('C-bore diameter', f, 'cbDiameter', 'mm', { min: 0.01 }), exField('C-bore depth', f, 'cbDepth', 'mm', { min: 0.01 })] : []),
          ...(f.holeType === 'csink' ? [exField('C-sink diameter', f, 'csDiameter', 'mm', { min: 0.01 }), exField('C-sink angle', f, 'csAngle', '°', { min: 10, max: 170 })] : [])));
        out.push(section_('Extent', selField('Extent', f, 'extent', [['distance', 'Distance'], ['to', 'To object'], ['all', 'All (through)']], { rerender: true, id: 'ds-extent' }),
          ...(hx === 'distance' ? [exField('Depth', f, 'depth', 'mm', { min: 0.01 }), segField('Drill point', f, 'tip', [[false, 'Flat'], [true, 'Angled']], { rerender: true }), ...(f.tip ? [exField('Point angle', f, 'tipAngle', '°', { min: 30, max: 179 })] : [])] : []),
          ...(hx === 'to' ? [targetRow(f, 'to')] : []),
          ...(f.tapped && !f.modeled ? [h('p', { class: 'note' }, 'Cosmetic thread: the hole is the tap drill size and the thread is noted, not modeled.')] : []))); }
      break;
    case 'box': case 'cylinder': case 'sphere': case 'torus': {
      const dims = f.type === 'box' ? [exField('Length (X)', f, 'w', 'mm', { min: 0.01 }), exField('Width (Y)', f, 'd', 'mm', { min: 0.01 }), exField('Height', f, 'h', 'mm', { min: 0.01 })]
        : f.type === 'cylinder' ? [exField('Diameter', f, 'diameter', 'mm', { min: 0.01 }), exField('Height', f, 'h', 'mm', { min: 0.01 })]
        : f.type === 'sphere' ? [exField('Diameter', f, 'diameter', 'mm', { min: 0.01 })]
        : [exField('Major diameter', f, 'major', 'mm', { min: 0.01 }), exField('Minor diameter', f, 'minor', 'mm', { min: 0.01 })];
      out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy')));
      out.push(section_('Size', ...dims));
      out.push(section_('Result', ...opsSection()));
      break;
    }
    case 'plane': case 'axis': case 'point':
      constructDialog(f, idx, out);
      break;
    case 'pattern': {
      const srcs = doc.features.slice(0, idx).filter(g => SOLIDS.has(g.type));
      out.push(section_('Input', segField('Type', f, 'kind', [['linear', 'Rectangular'], ['circular', 'Circular']], { rerender: true }),
        selField('Feature', f, 'source', srcs.length ? srcs.map(s => [s.id, s.name]) : [['', 'No solid feature before this step']])));
      if (f.kind === 'circular') out.push(section_('Axis', selField('Axis', f, 'axis', axisOptions(idx)), exField('Quantity', f, 'count', '', { min: 2, max: 50 }), exField('Total angle', f, 'angle', '°', { min: 1, max: 360 })));
      else {
        out.push(section_('Direction 1', selField('Axis', f, 'axis', axisOptions(idx)), exField('Quantity', f, 'count', '', { min: 2, max: 50, id: 'dx-count' }), exField('Distance', f, 'spacing', 'mm', { id: 'dx-spacing' })));
        out.push(section_('Direction 2', selField('Axis', f, 'axis2', axisOptions(idx)), exField('Quantity', f, 'count2', '', { min: 1, max: 50, id: 'dx-count2' }), exField('Distance', f, 'spacing2', 'mm', { id: 'dx-spacing2' })));
      }
      break;
    }
    case 'mirror': {
      const srcs = doc.features.slice(0, idx).filter(g => SOLIDS.has(g.type));
      out.push(section_('Input', selField('Feature', f, 'source', srcs.length ? srcs.map(s => [s.id, s.name]) : [['', 'No solid feature before this step']]),
        selField('Mirror plane', f, 'plane', [['YZ', 'YZ plane'], ['XZ', 'XZ plane'], ['XY', 'XY plane'], ...doc.features.slice(0, idx).filter(g => g.type === 'plane').map(g => [g.id, g.name])])));
      break;
    }
    case 'move': {
      const bs = bodiesBefore(f.id);
      out.push(section_('Object', selField('Body', f, 'body', bs.length ? bs : [['', 'No body before this step']]), chkField('Create copy', f, 'copy')));
      out.push(section_('Translate', exField('X distance', f, 'dx'), exField('Y distance', f, 'dy'), exField('Z distance', f, 'dz')));
      out.push(section_('Rotate about origin', exField('X angle', f, 'rx', '°'), exField('Y angle', f, 'ry', '°'), exField('Z angle', f, 'rz', '°')));
      break;
    }
    case 'combine': {
      const bs = bodiesBefore(f.id);
      const list = h('div', { class: 'picklist' });
      for (const [id, name] of bs) {
        if (id === f.target) continue;
        const cid = 'cb-' + id.replace(/[^a-z0-9]/gi, '_');
        const c = h('input', { type: 'checkbox', id: cid, checked: (f.tools || []).includes(id) });
        c.addEventListener('change', () => { checkpoint(); f.tools = c.checked ? [...new Set([...(f.tools || []), id])] : (f.tools || []).filter(x => x !== id); scheduleRegen(0); });
        list.append(h('label', { class: 'chk', for: cid }, c, name));
      }
      out.push(section_('Bodies', selField('Target body', f, 'target', bs.length ? bs : [['', 'No body before this step']], { rerender: true }), h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Tool bodies'), list)));
      out.push(section_('Result', segField('Operation', f, 'op', [['join', 'Join'], ['cut', 'Cut'], ['intersect', 'Intersect']]), chkField('Keep tool bodies', f, 'keep')));
      break;
    }
    case 'silsplit': case 'splitbody': case 'scale': case 'align': case 'patpath': case 'boundary':
      modifyDialog(f, idx, out);
      break;
    case 'sextrude': case 'srevolve': case 'patch': case 'soffset': case 'sloft': case 'ssweep': case 'ruled': case 'trim': case 'untrim': case 'sextend': case 'stitch': case 'unstitch': case 'reverse': case 'deleteface':
      surfaceDialog(f, idx, out);
      break;
    case 'meshinsert': case 'tessellate': case 'facegroups': case 'meshrepair': case 'remesh': case 'reduce': case 'smooth': case 'meshplane': case 'meshconvert':
      meshDialog(f, idx, out);
      break;
    case 'form':
      formDialog(f, idx, out, placement);
      break;
    case 'canvas': case 'decal': case 'derive':
      insertDialog(f, idx, out, placement);
      break;
    case 'boss': case 'snapfit': case 'rest':
      plasticDialog(f, idx, out, placement);
      break;
    case 'flange': case 'contourflange': case 'unfold': case 'refold':
      sheetDialog(f, idx, out);
      break;
    case 'coil': case 'rib': case 'web':
      createDialog2(f, idx, out, placement);
      break;
    case 'fullround': case 'offsetface': case 'fillet': case 'chamfer': case 'shell': case 'draft': case 'presspull': case 'thicken': case 'replaceface': case 'thread': case 'emboss': case 'splitface': case 'lip': {
      const n = (f.edges || []).length, what = FACE_PICK.has(f.type) ? 'face' : 'edge';
      out.push(section_(f.type === 'presspull' || f.type === 'thicken' || f.type === 'offsetface' ? 'Faces' : f.type === 'fullround' ? 'Center face' : f.type === 'replaceface' ? 'Face to replace' : f.type === 'thread' ? 'Cylindrical faces' : f.type === 'splitface' ? 'Faces to split' : f.type === 'lip' ? 'Rim face' : f.type === 'emboss' ? 'Target face' : f.type === 'shell' ? 'Faces to remove' : f.type === 'draft' ? 'Faces to taper' : 'Edges',
        h('p', { class: 'note' }, n ? `${n} ${what}${n > 1 ? 's' : ''} selected. Click on the model to add or remove ${what}s.` : `Click the ${what}s on the model.`),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', disabled: !n, onclick: () => { checkpoint(); f.edges = []; rerenderDialog(); scheduleRegen(0); drawToolsOverlay(); } }, 'Clear selection'))));
      if (modifyDialog(f, idx, out) || createDialog2(f, idx, out, placement) || plasticDialog(f, idx, out, placement)) break;
      if (f.type === 'presspull') {
        out.push(section_('Offset', exField('Distance', f, 'distance', 'mm', { id: 'dx-ppdist' }), h('p', { class: 'note' }, 'Positive pulls the face out and adds material; negative pushes it in and removes material. On a hole, positive makes it smaller.')));
        break;
      } else if (f.type === 'draft') {
        out.push(section_('Pull direction', selField('Neutral plane', f, 'neutral', planeOptions(idx, f.neutral), { id: 'ds-neutral' }), exField('Plane offset', f, 'neutralOffset', 'mm', { id: 'dx-noff' }),
          exField('Angle', f, 'angle', '°', { min: -59, max: 59, id: 'dx-dangle' }), chkField('Flip pull direction', f, 'flipPull'),
          h('p', { class: 'note' }, 'Faces stay put where they cross the neutral plane and tilt away from it.')));
        break;
      }
      if (f.type === 'offsetface') { out.push(section_('Offset', exField('Distance', f, 'distance', 'mm', { id: 'dx-ofdist' }), h('p', { class: 'note' }, 'Flat faces move along their normal and the flat faces around them extend or trim to meet them. Positive moves out of the body.'))); break; }
      if (f.type === 'fullround') { out.push(section_(null, h('p', { class: 'note' }, 'The picked face is replaced by a half-round between the two parallel side faces next to it. The radius is half the distance between them.'))); break; }
      if (f.type === 'fillet') {
        out.push(section_('Size', segField('Type', f, 'filletType', [['constant', 'Constant'], ['variable', 'Variable']], { rerender: true, after: () => { if (f.filletType === 'variable') f.radius2 ??= (+f.radius || 2) * 2; } }),
          exField(f.filletType === 'variable' ? 'Start radius' : 'Radius', f, 'radius', 'mm', { min: 0.001 }),
          ...(f.filletType === 'variable' ? [exField('End radius', f, 'radius2', 'mm', { min: 0.001 }), h('p', { class: 'note' }, 'The radius changes linearly along each edge.')] : [])));
        break;
      }
      if (f.type === 'chamfer') {
        const ct = f.chamferType || 'equal';
        out.push(section_('Size', segField('Type', f, 'chamferType', [['equal', 'Equal distance'], ['two', 'Two distances'], ['angle', 'Distance and angle']], { rerender: true, after: () => { if (f.chamferType === 'two') f.distance2 ??= (+f.distance || 1) * 2; if (f.chamferType === 'angle') f.chamferAngle ??= 30; } }),
          exField(ct === 'equal' ? 'Distance' : 'Distance 1', f, 'distance', 'mm', { min: 0.001, id: 'dx-chdist' }),
          ...(ct === 'two' ? [exField('Distance 2', f, 'distance2', 'mm', { min: 0.001 })] : ct === 'angle' ? [exField('Angle', f, 'chamferAngle', '°', { min: 0.1, max: 89.9 })] : []),
          ...(ct !== 'equal' ? [chkField('Flip (measure the first distance on the other face)', f, 'flipSide')] : [])));
        break;
      }
      out.push(section_('Size', exField('Thickness', f, 'thickness', 'mm', { min: 0.001 })));
      break;
    }
    case 'loft': {
      const sks = doc.features.slice(0, idx).filter(g => g.type === 'sketch');
      const list = h('div', { class: 'picklist' });
      for (const s of sks) {
        const cid = 'lf-' + s.id;
        const c = h('input', { type: 'checkbox', id: cid, checked: (f.sketches || []).includes(s.id) });
        c.addEventListener('change', () => { checkpoint(); const set = new Set(f.sketches || []); c.checked ? set.add(s.id) : set.delete(s.id); f.sketches = sks.map(x => x.id).filter(id => set.has(id)); scheduleRegen(0); });
        list.append(h('label', { class: 'chk', for: cid }, c, s.name, h('span', { class: 'note', style: 'margin:0 0 0 auto' }, profCount(s) + ' profile' + (profCount(s) === 1 ? '' : 's'))));
      }
      out.push(section_('Profiles', h('p', { class: 'note' }, 'Pick two or more sketches, one closed profile each (or one sketch and an end point). They are joined in timeline order.'), list, chkField('Straight (ruled) sides', f, 'ruled')));
      { const pathSks = sks.filter(s => sketchPathCount(s)), pts = doc.features.slice(0, idx).filter(g => g.type === 'point');
        const rl = h('div', { class: 'picklist', id: 'loft-rails' });
        for (const s of pathSks) { const cid = 'lr-' + s.id, c = h('input', { type: 'checkbox', id: cid, checked: (f.rails || []).includes(s.id) }); c.addEventListener('change', () => { checkpoint(); const set = new Set(f.rails || []); c.checked ? set.add(s.id) : set.delete(s.id); f.rails = pathSks.map(x => x.id).filter(id => set.has(id)); scheduleRegen(0); }); rl.append(h('label', { class: 'chk', for: cid }, c, s.name)); }
        const conds = [['free', 'Free'], ['normal', 'Normal to profile'], ['smooth', 'Smooth (curvature)']];
        out.push(section_('Rails and ends', pathSks.length ? rl : h('p', { class: 'note' }, 'Draw rails as open sketch curves from the first section to the last.'),
          selField('Start', f, 'startCond', conds, { id: 'ds-startcond' }), selField('End', f, 'endCond', conds, { id: 'ds-endcond' }),
          h('p', { class: 'note' }, 'Up to two rails pull the sections out to follow them. Normal makes the loft leave a section square to it; Smooth also matches curvature. Rails and end conditions work between two sections.')));
        out.push(section_('Guide', selField('Centre line', f, 'centerline', [['', 'None'], ...pathSks.map(s => [s.id, s.name])], { id: 'ds-centerline' }),
          selField('Start at point', f, 'startPoint', [['', 'None'], ...pts.map(p => [p.id, p.name])], { id: 'ds-startpt' }), selField('End at point', f, 'endPoint', [['', 'None'], ...pts.map(p => [p.id, p.name])], { id: 'ds-endpt' }),
          h('p', { class: 'note' }, 'A centre line carries the sections along a path. A start or end point closes the loft to a tip (create the point with Construct › Point).'))); }
      out.push(section_('Result', ...opsSection()));
      break;
    }
    case 'sweep': {
      const sks = doc.features.slice(0, idx).filter(g => g.type === 'sketch');
      const pathSks = sks.filter(s => sketchPathCount(s));
      const kids = [selField('Path', f, 'path', pathSks.length ? pathSks.map(s => [s.id, s.name]) : [['', 'No path sketch before this step']], { id: 'ds-path', rerender: true })];
      const np = sketchPathCount(featById(f.path));
      if (np > 1) kids.push(selField('Which chain', f, 'pathIndex', Array.from({ length: np }, (_, i) => [i, 'Chain ' + (i + 1)]), { numeric: true, id: 'ds-pidx' }));
      out.push(section_('Path', ...kids, h('p', { class: 'note' }, 'The profile is placed at the start of the path, square to it.')));
      out.push(section_('Orientation and size', selField('Guide rail', f, 'guide', [['', 'None (follow the path)'], ...pathSks.filter(s => s.id !== f.path).map(s => [s.id, s.name])], { id: 'ds-guide' }),
        exField('Twist', f, 'twist', '°', { id: 'dx-twist' }), exField('End scale', f, 'scaleEnd', '×', { min: 0.01, id: 'dx-scaleEnd' }), h('p', { class: 'note' }, 'A guide rail sets how the profile turns along the path; without one, Twist turns it evenly by the given angle. End scale grows or shrinks the profile evenly to the end of the path (1 = unchanged).')));
      const prof = [segField('Profile', f, 'profileKind', [['circle', 'Circle'], ['sketch', 'From sketch']], { rerender: true })];
      if ((f.profileKind || 'circle') === 'circle') prof.push(exField('Diameter', f, 'diameter', 'mm', { min: 0.001 }), exField('Wall thickness', f, 'wall', 'mm', { min: 0, id: 'dx-wall' }), h('p', { class: 'note' }, 'Wall 0 makes a solid rod; a wall makes a tube.'));
      else { const ps = sks.filter(s => s.id !== f.path && profCount(s) >= 1); prof.push(selField('Profile sketch', f, 'profile', ps.length ? ps.map(s => [s.id, s.name]) : [['', 'No other sketch with a profile']], { id: 'ds-prof' }), h('p', { class: 'note' }, 'Its sketch origin lands on the path start.')); }
      out.push(section_('Profile', ...prof));
      out.push(section_('Result', ...opsSection()));
      break;
    }
    case 'import': {
      const file = doc.files?.[f.file];
      out.push(section_('File', h('dl', { class: 'stat' }, h('dt', {}, 'Name'), h('dd', {}, file?.name || 'missing'), h('dt', {}, 'Size'), h('dd', {}, file ? fix((file.text?.length || 0) / 1024, 0) + ' KB' : '—'),
        h('dt', {}, 'Bodies'), h('dd', {}, String([...result.bodies.values()].filter(b => b.feature === f.id).length))),
        h('p', { class: 'note' }, 'Imported geometry is fixed. Add features after it to change it.')));
      break;
    }
    case 'remove': {
      const bs = bodiesBefore(f.id);
      out.push(section_('Object', selField('Body', f, 'body', bs.length ? bs : [['', 'No body before this step']])));
      break;
    }
  }
  out.push(section_(null, row('Name', nameRow, 'dx-name')));
  return out;
}
function refreshDialogStatus() {
  const box = $('#dlgErr'); if (!box || !dlg?.fid) return;
  const st = statusOf(dlg.fid);
  box.hidden = st.state !== 'error'; box.textContent = st.msg || '';
}
function closeDialog(ok, silent) {
  if (!dlg) return;
  const d = dlg; dlg = null;
  $('#dialog').hidden = true; $('#dialog').replaceChildren();
  if (d.custom) { (ok ? d.custom.onOK : d.custom.onCancel)?.(); if (!silent) { updateScene(); renderRibbon(); } return; }
  if (!ok && !silent) {
    const changed = d.isNew || history.undo.length > d.undoLen;
    if (changed) {
      doc = reviveDoc(JSON.parse(d.snapshot));
      history.undo.length = d.isNew ? Math.max(0, d.undoLen - 1) : d.undoLen;
      lastTag = null;
      if (d.isNew) selFeature = null;
      afterDocReplace(); return;
    }
  }
  // OK: the whole command becomes one undo step (the snapshot taken when it opened)
  if (ok && history.undo.length > d.undoLen) {
    const keep = d.isNew ? d.undoLen : d.undoLen + 1;
    if (!d.isNew && history.undo.length > d.undoLen) history.undo[d.undoLen] = d.snapshot;
    history.undo.length = Math.max(0, keep); history.redo.length = 0; lastTag = null; updateUndoButtons();
  }
  if (!silent) { updateScene(); renderTimeline(); renderBrowser(); }
}
// Non-timeline dialogs (material, appearance, measure, section, export)
function openPanelDialog(custom) {
  if (dlg) closeDialog(true);
  dlg = { custom };
  rerenderDialog(); renderRibbon();
}
function buildCustomDialog(el, c) {
  const head = h('div', { class: 'dhead', html: icon(c.icon) + `<span>${c.title}</span>` });
  head.append(h('button', { class: 'x', 'aria-label': 'Close', onclick: () => closeDialog(false), html: icon('close') }));
  const body = h('div', { class: 'dbody' }, ...(typeof c.body === 'function' ? c.body() : c.body));
  const foot = h('div', { class: 'dfoot' }, h('span', { class: 'info', title: c.help || '', html: icon('info') }));
  if (c.onOK || c.okLabel) foot.append(h('button', { class: 'btn ok', onclick: () => closeDialog(true) }, c.okLabel || 'OK'));
  foot.append(h('button', { class: 'btn', onclick: () => closeDialog(false) }, c.cancelLabel || (c.onOK ? 'Cancel' : 'Close')));
  el.append(head, body, foot);
}

// ---------- sketch palette ----------
function renderPalette() {
  const el = $('#palette');
  if (mode !== 'sketch' || dlg) { el.hidden = true; return; }
  const sk = featById(sketchId); if (!sk) { el.hidden = true; return; }
  el.hidden = false; el.replaceChildren();
  const idx = featIndex(sk.id);
  const head = h('div', { class: 'dhead', html: icon('sketch') + '<span>Sketch Palette</span>' });
  const opt = (label, key, after) => { const id = 'so-' + key; const c = h('input', { type: 'checkbox', id, checked: sketchOpts[key] }); c.addEventListener('change', () => { sketchOpts[key] = c.checked; after?.(); refreshOverlays(); }); return h('label', { class: 'chk', for: id }, c, label); };
  const body = h('div', { class: 'dbody' });
  body.append(section_('Options',
    h('div', { class: 'btnrow', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px' }, h('button', { class: 'btn', onclick: () => lookAtMatrix(sketchMatrix(sk)), html: icon('lookat') + 'Look At' })),
    opt('Sketch grid', 'grid'), opt('Snap to 1 mm', 'snap'), opt('Show profiles', 'profiles'), opt('Show dimensions', 'dims'),
    opt('Auto constraints', 'autoCons'), opt('Inference (H, V, ∥, ⊥, ≡, =, tangent)', 'infer')));
  // snap categories (hold Ctrl / Cmd while clicking to place a point with no snapping at all)
  const cat = (label, key) => { const id = 'snapcat-' + key, c = h('input', { type: 'checkbox', id, checked: sketchOpts.snapCats?.[key] !== false });
    c.addEventListener('change', () => { (sketchOpts.snapCats ||= {})[key] = c.checked; snapCache = null; }); return h('label', { class: 'chk', for: id }, c, label); };
  body.append(section_('Snap to', h('div', { class: 'snapcats' }, cat('Endpoints', 'endpoint'), cat('Midpoints', 'midpoint'), cat('Centers', 'center'), cat('Quadrants', 'quadrant'), cat('Intersections', 'intersection'), cat('Symmetric', 'symmetric'), cat('On curve', 'nearest'), cat('Alignment', 'align')),
    h('p', { class: 'note', style: 'margin:4px 0 0' }, 'Hold Ctrl (⌘ on a Mac) to place without snapping.')));
  const nameI = h('input', { type: 'text', id: 'sk-name', value: sk.name, autocomplete: 'off' });
  nameI.addEventListener('input', () => { checkpoint('skname'); sk.name = nameI.value; renderBrowser(); });
  const curPl = sk.plane && typeof sk.plane === 'object' ? '__face' : sk.plane;
  const plSel = h('select', { id: 'sk-plane' }, planeOptions(idx, sk.plane).map(([v, t]) => h('option', { value: v, selected: curPl === v }, t)));
  plSel.addEventListener('change', () => { if (plSel.value === '__face') return; checkpoint(); sk.plane = plSel.value; sk.offset = 0; sk.flip = false; scheduleRegen(0); setTimeout(() => lookAtMatrix(sketchMatrix(sk)), 60); renderPalette(); });
  body.append(section_('Sketch', row('Name', nameI, 'sk-name'), row('Plane', plSel, 'sk-plane'), exField('Offset', sk, 'offset', 'mm', { id: 'sk-offset', after: () => setTimeout(refreshOverlays, 0) })));
  const list = h('div', { class: 'picklist' });
  sk.profiles.forEach(p => list.append(h('button', { class: 'mi', style: selProfile === p.id ? 'background:var(--hover)' : '', onclick: () => { selProfile = p.id; setSketchTool('select'); renderPalette(); refreshOverlays(); },
    html: icon(p.kind === 'rect' ? 'rect2' : p.kind === 'poly' ? 'line' : p.kind) + `<span class="lab">${({ rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon', slot: 'Slot', poly: 'Line profile' })[p.kind]}</span><span class="key">${profileSummary(p)}</span>` })));
  if (!sk.profiles.length) list.append(h('p', { class: 'note', style: 'padding:4px 6px;margin:0' }, 'No profiles yet. Choose Line, Rectangle, Circle, Polygon or Slot in the Sketch tab.'));
  const gst = geoState(sk);
  if (gst || !sk.profiles.length) body.append(geoPaletteSection(sk, gst));
  if (sk.profiles.length) body.append(section_('Older profiles (' + sk.profiles.length + ')', list));
  const pr = sk.profiles.find(p => p.id === selProfile);
  if (pr) {
    const F = (label, key, unit = 'mm', o = {}) => exField(label, pr, key, unit, { id: 'pf-' + (o.fid || key), ...o });
    const kids = [];
    if (pr.kind !== 'poly') kids.push(F('Center X', 'cx'), F('Center Y', 'cy'));
    if (pr.kind === 'rect') kids.push(F('Width', 'w', 'mm', { min: 0.01 }), F('Height', 'h', 'mm', { min: 0.01 }), F('Corner radius', 'r', 'mm', { min: 0 }), F('Rotation', 'rot', '°'));
    if (pr.kind === 'circle') {
      const proxy = { id: pr.id, get d() { return typeof pr.r === 'number' ? pr.r * 2 : '2*(' + pr.r + ')'; }, set d(v) { pr.r = typeof v === 'number' ? v / 2 : '(' + v + ')/2'; } };
      kids.push(exField('Diameter', proxy, 'd', 'mm', { id: 'pf-d', min: 0.01 }));
    }
    if (pr.kind === 'polygon') kids.push(F('Radius', 'r', 'mm', { min: 0.01 }), F('Sides', 'sides', '', { min: 3, max: 64 }), F('Rotation', 'rot', '°'));
    if (pr.kind === 'slot') kids.push(F('Length', 'length', 'mm', { min: 0.01 }), F('Width', 'width', 'mm', { min: 0.01 }), F('Rotation', 'rot', '°'));
    if (pr.kind === 'poly') pr.pts.forEach((p, i) => kids.push(h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Point ' + (i + 1)),
      h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:4px' }, ...[['x', 'X'], ['y', 'Y']].map(([k]) => exField('', p, k, k.toUpperCase(), { id: `pf-pts-${i}-${k}` }).lastChild)))));
    kids.push(h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn danger', onclick: () => deleteProfile(pr.id), html: icon('delete') + 'Delete profile' })));
    body.append(section_('Selected profile', ...kids));
  }
  const foot = h('div', { class: 'dfoot' }, h('span', { class: 'info', title: 'Profiles inside other profiles become holes. Values accept expressions.', html: icon('info') }), h('button', { class: 'btn go', onclick: () => finishSketch(), html: icon('finish') + 'Finish Sketch' }));
  el.append(head, body, foot);
}
function profileSummary(p) {
  const r = liveProfiles({ ...featById(sketchId), profiles: [p] })[0] || p;
  if (p.kind === 'rect') return fmt(r.w) + ' × ' + fmt(r.h);
  if (p.kind === 'circle') return 'Ø ' + fmt(r.r * 2);
  if (p.kind === 'polygon') return r.sides + ' sides · R' + fmt(r.r);
  if (p.kind === 'slot') return fmt(r.length) + ' × ' + fmt(r.width);
  if (p.kind === 'poly') return p.pts.length + ' points';
  return '';
}

// ---------- modals ----------
function openModal(title, iconKey, body, buttons) {
  const m = $('#modal'); m.replaceChildren();
  const head = h('div', { class: 'dhead', html: icon(iconKey) + `<span>${title}</span>` });
  head.append(h('button', { class: 'x', 'aria-label': 'Close', onclick: closeModal, html: icon('close') }));
  const foot = h('div', { class: 'dfoot' }, h('span', { class: 'info' }), ...(buttons || [h('button', { class: 'btn ok', onclick: closeModal }, 'Close')]));
  m.append(head, body, foot);
  $('#modalBack').hidden = false;
  setTimeout(() => (m.querySelector('input, button.ok') || m).focus(), 0);
}
function closeModal() { $('#modalBack').hidden = true; $('#modal').replaceChildren(); $('#modal').classList.remove('wide'); }
$('#modalBack').addEventListener('pointerdown', e => { if (e.target.id === 'modalBack') closeModal(); });

function openParamsModal() {
  const before = JSON.stringify(doc.params);
  const work = JSON.parse(before);
  const tbody = h('tbody');
  const draw = () => {
    tbody.replaceChildren();
    const { vars, errors } = evalParams(work);
    work.forEach((p, i) => {
      const nm = h('input', { value: p.name, 'aria-label': 'Parameter name', spellcheck: 'false', class: errors[p.name] && !/^[A-Za-z_]/.test(p.name) ? 'bad' : '' });
      const ex = h('input', { value: p.expr, 'aria-label': 'Expression for ' + p.name, spellcheck: 'false', class: errors[p.name] ? 'bad' : '', title: errors[p.name] || '' });
      const cm = h('input', { value: p.comment || '', 'aria-label': 'Comment' });
      nm.addEventListener('change', () => { p.name = nm.value.trim(); draw(); });
      ex.addEventListener('change', () => { p.expr = ex.value.trim(); draw(); });
      cm.addEventListener('change', () => { p.comment = cm.value; });
      tbody.append(h('tr', {}, h('td', {}, nm), h('td', {}, ex), h('td', { class: 'num' }, errors[p.name] ? '—' : fmt(vars[p.name]) + ' mm'), h('td', {}, cm),
        h('td', {}, h('button', { class: 'iconbtn', 'aria-label': 'Delete parameter ' + p.name, onclick: () => { work.splice(i, 1); draw(); }, html: icon('delete') }))));
    });
    if (!work.length) tbody.append(h('tr', {}, h('td', { colspan: '5', class: 'note' }, 'No parameters yet. Add one, then type its name into any dimension, for example width/2.')));
  };
  draw();
  const add = h('button', { class: 'btn', onclick: () => { let n = 1; while (work.some(p => p.name === 'param' + n)) n++; work.push({ name: 'param' + n, expr: '10', comment: '' }); draw(); }, html: icon('plus') + 'Add parameter' });
  const body = h('div', { class: 'tablewrap' }, h('p', { class: 'note' }, 'User parameters drive dimensions anywhere in the design. Expressions can use other parameters, + − × ÷ ^, parentheses and sqrt, sin, cos, tan (degrees), min, max, abs, round, pi.'),
    h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Expression'), h('th', {}, 'Value'), h('th', {}, 'Comment'), h('th', {}, ''))), tbody), h('div', { style: 'padding-top:8px' }, add));
  openModal('Change Parameters', 'params', body, [
    h('button', { class: 'btn ok', onclick: () => { document.activeElement?.blur?.(); if (JSON.stringify(work) !== before) { checkpoint(); doc.params = work; scheduleRegen(0); } closeModal(); } }, 'OK'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
function openBOMModal() {
  const mp = massProps();
  const rows = mp.bodies.map((b, i) => h('tr', {}, h('td', { class: 'num' }, String(i + 1)), h('td', {}, h('span', { class: 'swatch', style: `display:inline-block;margin-right:6px;background:${bodyColor(b.id)}` }), b.name),
    h('td', {}, b.material), h('td', { class: 'num' }, '1'), h('td', { class: 'num' }, fix(b.volume / 1000, 2) + ' cm³'), h('td', { class: 'num' }, fix(b.mass, 1) + ' g'),
    h('td', { class: 'num' }, `${fix(b.size.x)} × ${fix(b.size.y)} × ${fix(b.size.z)}`)));
  const total = mp.bodies.reduce((s, b) => s + b.mass, 0);
  const body = h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
    h('thead', {}, h('tr', {}, ...['#', 'Body', 'Material', 'Qty', 'Volume', 'Mass', 'Size (mm)'].map(t => h('th', {}, t)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '7', class: 'note' }, 'No bodies yet.'))),
    h('tfoot', {}, h('tr', {}, h('td', {}), h('td', {}, 'Total'), h('td', {}), h('td', { class: 'num' }, String(mp.bodies.length)), h('td', {}), h('td', { class: 'num' }, fix(total, 1) + ' g'), h('td', {})))));
  const csv = () => ['#,Body,Material,Qty,Volume cm3,Mass g,Size X,Size Y,Size Z', ...mp.bodies.map((b, i) => [i + 1, '"' + b.name + '"', '"' + b.material + '"', 1, (b.volume / 1000).toFixed(3), b.mass.toFixed(2), b.size.x.toFixed(2), b.size.y.toFixed(2), b.size.z.toFixed(2)].join(','))].join('\n');
  openModal('Bill of Materials', 'bom', body, [h('button', { class: 'btn', onclick: () => saveFile(slug() + '-bom.csv', csv(), 'text/csv'), html: icon('exportstl') + 'Save CSV' }), h('button', { class: 'btn ok', onclick: closeModal }, 'Close')]);
}
function openPropertiesModal() {
  const mp = massProps();
  const dl = (pairs) => h('dl', { class: 'stat' }, ...pairs.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  const c = mp.total.com;
  const body = h('div', { class: 'tablewrap' },
    h('p', { class: 'note' }, isBrep() ? 'Computed exactly from the solid geometry.' : 'Computed from the display mesh (the exact engine is not running).'),
    h('h4', { style: 'margin:4px 0 8px' }, 'Visible bodies'),
    dl([['Mass', fix(mp.total.mass, 2) + ' g'], ['Volume', fix(mp.total.volume / 1000, 3) + ' cm³'], ['Surface area', fix(mp.total.area / 100, 2) + ' cm²'], ['Center of mass', `${fix(c.x, 2)}, ${fix(c.y, 2)}, ${fix(c.z, 2)} mm`]]),
    ...mp.bodies.map(b => h('div', { style: 'border-top:1px solid var(--line);margin-top:10px;padding-top:8px' }, h('h4', { style: 'margin:0 0 6px' }, b.name + (b.hidden ? ' (hidden)' : '')),
      dl([['Material', b.material], ['Density', MATERIALS[b.material]?.density + ' g/cm³'], ['Mass', fix(b.mass, 2) + ' g'], ['Volume', fix(b.volume / 1000, 3) + ' cm³'], ['Area', fix(b.area / 100, 2) + ' cm²'],
        ['Bounding box', `${fix(b.size.x, 2)} × ${fix(b.size.y, 2)} × ${fix(b.size.z, 2)} mm`], ['Center of mass', `${fix(b.com.x, 2)}, ${fix(b.com.y, 2)}, ${fix(b.com.z, 2)}`], ['Triangles', b.tris.toLocaleString('en-US')]]))));
  openModal('Properties', 'properties', body);
}
function openHelpModal() {
  const keys = [['Create Sketch', 'Sketch button, then pick a plane or flat face'], ['E', 'Extrude'], ['H', 'Hole'], ['M', 'Move/Copy'], ['I', 'Measure'], ['A', 'Appearance'], ['Del', 'Delete selection'],
    ['L / R / C / P / S', 'Sketch: Line, Rectangle, Circle, Polygon, Slot'], ['Enter', 'Close a line profile · OK in a dialog'], ['Esc', 'Cancel the current tool or dialog'], ['Ctrl Z / Ctrl Y', 'Undo / Redo'],
    ['Mouse', 'Left-drag orbits, right- or middle-drag pans, wheel zooms'], ['Timeline', 'Click selects, click again or double-click edits, right-click for more, drag the orange marker to roll back']];
  const road = [[P1, 'Done: exact geometry engine, fillet, chamfer, shell, STEP export. Next: draft, sweep, loft, press pull, STEP import, sketch constraints, arcs and splines, mesh tools'],
    [P2, 'Components and assemblies with joints, animation, 2D drawings, render, decals, add-ins'], [P3, 'Manufacture (CAM toolpaths, G-code), sheet metal, plastic design, nesting'], [P4, 'Simulation (stress, deflection)'], [P5, 'Generative design and freeform']];
  const body = h('div', { class: 'tablewrap' },
    h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Shortcut'), h('th', {}, 'Action'))), h('tbody', {}, keys.map(([k, v]) => h('tr', {}, h('td', { class: 'num', style: 'text-align:left' }, k), h('td', {}, v))))),
    h('h4', { style: 'margin:14px 0 6px' }, 'Roadmap'),
    h('table', { class: 'grid' }, h('tbody', {}, road.map(([k, v]) => h('tr', {}, h('td', { style: 'white-space:nowrap;font-weight:600' }, k), h('td', {}, v))))));
  openModal('Help', 'help', body);
}

// Constraint status, dimensions and selection for constrained sketches.
function geoPaletteSection(sk, st) {
  const wrap = h('div', {});
  if (!st) { wrap.append(section_('Geometry', h('p', { class: 'note' }, 'Draw with Line, Rectangle, Circle, Arc, Polygon or Slot. Closed shapes become profiles you can extrude. Add constraints and dimensions to lock the design.'))); return wrap; }
  const ok = !!st.solved?.ok, dof = st.analysis.dof;
  const status = !ok ? h('div', { class: 'cstat bad' }, 'Constraints conflict. Remove the last constraint or dimension.')
    : dof === 0 ? h('div', { class: 'cstat full' }, 'Fully constrained')
    : h('div', { class: 'cstat free' }, dof + (dof === 1 ? ' degree' : ' degrees') + ' of freedom left (blue geometry can still move)');
  const li = st.loops.info, np = st.loops.profiles.length;
  const prof = h('p', { class: 'note' }, `${np} closed profile${np === 1 ? '' : 's'}` + (li.open ? ` · ${li.open} open chain${li.open > 1 ? 's' : ''}` : '') + (li.branching ? ` · ${li.branching} branching` : '') + (li.open || li.branching ? ' (only closed loops extrude)' : ''));
  wrap.append(section_('Constraints', status, prof));
  const dims = sk.geo.cons.filter(k => DIM_TYPES.has(k.type));
  if (dims.length) {
    const label = { length: 'Length', distance: 'Distance', hdist: 'Horizontal', vdist: 'Vertical', radius: 'Radius', diameter: 'Diameter', angle: 'Angle' };
    wrap.append(section_('Dimensions', ...dims.map((k, i) => exField(label[k.type] + ' ' + (i + 1), k, 'value', k.type === 'angle' ? '°' : 'mm', {
      id: 'gd-' + k.id, min: k.type === 'angle' ? undefined : 0.001, delay: 120, after: () => { geoCache = null; if (!commitGeo(sk, cloneGeo(sk.geo), { noCheckpoint: true, quiet: true, noPalette: true })) setTimeout(() => toast('That value cannot be reached with the other constraints'), 0); },
    }))));
  }
  if (geoSel.size) {
    const { pts, crv, cons } = selectionParts(sk);
    const parts = [pts.length && pts.length + ' point' + (pts.length > 1 ? 's' : ''), crv.length && crv.length + ' curve' + (crv.length > 1 ? 's' : ''), cons.length && cons.length + ' constraint' + (cons.length > 1 ? 's' : '')].filter(Boolean).join(', ');
    wrap.append(section_('Selected', h('p', { class: 'note' }, parts),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: () => addDimension(), html: icon('dimension') + 'Dimension' }),
        crv.length ? h('button', { class: 'btn', onclick: () => toggleConstruction(), html: icon('construction') + 'Construction' }) : null,
        h('button', { class: 'btn danger', onclick: () => deleteGeoSelection(), html: icon('delete') + 'Delete' }))));
  }
  return wrap;
}
