// ===== Commands, workspace tabs, ribbon and menus =====
const CMD = {};
function cmd(id, label, iconKey, o = {}) { CMD[id] = { id, label, icon: iconKey, ...o }; }
const P1 = 'Phase 1', P2 = 'Phase 2', P3 = 'Phase 3', P4 = 'Phase 4', P5 = 'Phase 5';
const planned = (id, label, iconKey, phase = P1, o = {}) => cmd(id, label, iconKey, { phase, ...o });

// solid › create
cmd('sketch', 'Create Sketch', 'sketch', { run: () => startCreateSketch() });
planned('form', 'Create Form', 'form', P5);
planned('derive', 'Derive', 'derive', P2);
cmd('extrude', 'Extrude', 'extrude', { key: 'E', run: () => newProfileFeature('extrude') });
cmd('revolve', 'Revolve', 'revolve', { run: () => newProfileFeature('revolve') });
cmd('sweep', 'Sweep', 'sweep', { run: () => newSweep(false) }); cmd('loft', 'Loft', 'loft', { run: () => newLoft() }); planned('rib', 'Rib', 'rib'); planned('web', 'Web', 'web'); planned('emboss', 'Emboss', 'emboss');
cmd('hole', 'Hole', 'hole', { key: 'H', run: () => startPlaced('hole') });
planned('thread', 'Thread', 'thread');
cmd('box', 'Box', 'box', { run: () => startPlaced('box') });
cmd('cylinder', 'Cylinder', 'cylinder', { run: () => startPlaced('cylinder') });
cmd('sphere', 'Sphere', 'sphere', { run: () => startPlaced('sphere') });
cmd('torus', 'Torus', 'torus', { run: () => startPlaced('torus') });
planned('coil', 'Coil', 'coil'); cmd('pipe', 'Pipe', 'pipe', { run: () => newSweep(true) });
cmd('patrect', 'Rectangular Pattern', 'patrect', { run: () => newRepeat('pattern', 'linear') });
cmd('patcirc', 'Circular Pattern', 'patcirc', { run: () => newRepeat('pattern', 'circular') });
planned('patpath', 'Pattern on Path', 'patpath');
cmd('mirror', 'Mirror', 'mirror', { run: () => newRepeat('mirror') });
planned('thicken', 'Thicken', 'thicken'); planned('boundary', 'Boundary Fill', 'boundary');
// solid › modify
planned('presspull', 'Press Pull', 'presspull', P1, { key: 'Q' });
cmd('fillet', 'Fillet', 'fillet', { key: 'F', run: () => newEdgeFeature('fillet') });
cmd('chamfer', 'Chamfer', 'chamfer', { run: () => newEdgeFeature('chamfer') }); cmd('shell', 'Shell', 'shell', { run: () => newEdgeFeature('shell') }); cmd('draft', 'Draft', 'draft', { run: () => newEdgeFeature('draft') }); planned('scale', 'Scale', 'scale');
cmd('combine', 'Combine', 'combine', { run: () => newCombine() });
planned('replaceface', 'Replace Face', 'replaceface'); planned('splitface', 'Split Face', 'splitface'); planned('splitbody', 'Split Body', 'splitbody');
cmd('move', 'Move/Copy', 'move', { key: 'M', run: () => newMove() });
planned('align', 'Align', 'align');
cmd('delete', 'Delete', 'delete', { key: 'Del', run: () => deleteSelection() });
cmd('material', 'Physical Material', 'material', { run: () => openMaterialDialog() });
cmd('appearance', 'Appearance', 'appearance', { key: 'A', run: () => openAppearanceDialog() });
cmd('params', 'Change Parameters', 'params', { run: () => openParamsModal() });
// configure
planned('cfgtable', 'Configuration Table', 'configure', P2); planned('cfgrules', 'Configuration Rules', 'configure', P2);
// construct
cmd('offsetplane', 'Offset Plane', 'plane', { run: () => startOffsetPlane() });
planned('planeangle', 'Plane at Angle', 'planeangle'); planned('midplane', 'Midplane', 'midplane'); planned('planetangent', 'Tangent Plane', 'plane');
planned('axiscyl', 'Axis Through Cylinder', 'axis'); planned('axis2p', 'Axis Through Two Points', 'axis'); planned('pointv', 'Point at Vertex', 'point');
// inspect
cmd('measure', 'Measure', 'measure', { key: 'I', run: () => startMeasure() });
planned('interference', 'Interference', 'interference', P2); planned('curvature', 'Curvature Comb Analysis', 'curvature'); planned('zebra', 'Zebra Analysis', 'zebra');
cmd('section', 'Section Analysis', 'section', { run: () => openSectionDialog() });
cmd('com', 'Center of Mass', 'com', { run: () => toggleCOM() });
cmd('properties', 'Properties', 'properties', { run: () => openPropertiesModal() });
// insert
planned('insderive', 'Insert Derive', 'derive', P2); planned('decal', 'Decal', 'decal', P2); planned('canvas', 'Canvas', 'canvas', P2);
cmd('insstep', 'Insert STEP', 'insertmesh', { run: () => startImportSTEP() }); planned('insmesh', 'Insert Mesh', 'insertmesh', P1); planned('inssvg', 'Insert SVG', 'insertsvg', P1); planned('insdxf', 'Insert DXF', 'insertsvg', P1);
// assemble
planned('newcomp', 'New Component', 'component', P2); planned('joint', 'Joint', 'joint', P2, { key: 'J' }); planned('asbuilt', 'As-built Joint', 'joint', P2);
planned('rigid', 'Rigid Group', 'component', P2); planned('drive', 'Drive Joints', 'motion', P2); planned('motionlink', 'Motion Link', 'motion', P2); planned('contact', 'Enable Contact Sets', 'interference', P2);
// select
cmd('select', 'Select', 'select', { run: () => cancelModes(true) });
planned('window', 'Window Selection', 'window'); planned('filters', 'Selection Filters', 'filter');
// surface
planned('s.extrude', 'Extrude Surface', 'patch'); planned('s.patch', 'Patch', 'patch'); planned('s.offset', 'Offset Surface', 'offsetsurf'); planned('s.loft', 'Loft Surface', 'loft');
planned('s.ruled', 'Ruled Surface', 'offsetsurf'); planned('s.trim', 'Trim', 'trim'); planned('s.untrim', 'Untrim', 'trim'); planned('s.extend', 'Extend', 'extend');
planned('s.stitch', 'Stitch', 'stitch'); planned('s.unstitch', 'Unstitch', 'stitch'); planned('s.thicken', 'Thicken', 'thicken'); planned('s.reverse', 'Reverse Normal', 'patch');
// mesh
planned('m.insert', 'Insert Mesh', 'insertmesh', P1); planned('m.tessellate', 'Tessellate', 'remesh', P1); planned('m.facegroups', 'Generate Face Groups', 'remesh', P1);
planned('m.repair', 'Repair', 'remesh', P1); planned('m.remesh', 'Remesh', 'remesh', P1); planned('m.reduce', 'Reduce', 'reduce', P1); planned('m.smooth', 'Smooth', 'smooth', P1);
planned('m.convert', 'Convert Mesh', 'insertmesh', P1);
cmd('exportstl', 'Export STL', 'exportstl', { run: () => openExportDialog() });
// sheet metal
planned('sm.flange', 'Flange', 'flange', P3); planned('sm.contour', 'Contour Flange', 'contourflange', P3); planned('sm.unfold', 'Unfold', 'unfold', P3);
planned('sm.refold', 'Refold', 'unfold', P3); planned('sm.flat', 'Create Flat Pattern', 'unfold', P3); planned('sm.rules', 'Sheet Metal Rules', 'sheetrules', P3);
// plastic
planned('pl.rules', 'Plastic Rules', 'plasticrules', P3); planned('pl.boss', 'Boss', 'boss', P3); planned('pl.snap', 'Snap Fit', 'snapfit', P3); planned('pl.lip', 'Lip', 'lip', P3);
planned('pl.rest', 'Rest', 'boss', P3); planned('pl.rib', 'Rib', 'rib', P3); planned('pl.web', 'Web', 'web', P3);
// manage / utilities
cmd('bom', 'Bill of Materials', 'bom', { run: () => openBOMModal() });
cmd('make3d', '3D Print', 'make', { run: () => openExportDialog() });
planned('nest', 'Nest', 'nest', P3); planned('addins', 'Scripts and Add-Ins', 'addins', P2); planned('taskmgr', 'Task Manager', 'utility', P2);
planned('pmi', 'Create PMI', 'pmi', P2); planned('co2', 'Carbon Footprint', 'co2', P4);
// sketch (contextual)
cmd('k.line', 'Line', 'line', { key: 'L', run: () => setSketchTool('line') });
cmd('k.rect2', '2-Point Rectangle', 'rect2', { key: 'R', run: () => setSketchTool('rect2') });
cmd('k.rectc', 'Center Rectangle', 'rectc', { run: () => setSketchTool('rectc') });
cmd('k.circle', 'Center Diameter Circle', 'circle', { key: 'C', run: () => setSketchTool('circle') });
cmd('k.polygon', 'Circumscribed Polygon', 'polygon', { key: 'P', run: () => setSketchTool('polygon') });
cmd('k.slot', 'Center to Center Slot', 'slot', { key: 'S', run: () => setSketchTool('slot') });
cmd('k.arc', 'Three-Point Arc', 'arc', { key: 'A', run: () => setSketchTool('arc3') }); planned('k.spline', 'Fit Point Spline', 'spline'); planned('k.point', 'Point', 'spoint'); planned('k.text', 'Text', 'text');
planned('k.mirror', 'Sketch Mirror', 'mirror'); planned('k.cpattern', 'Sketch Circular Pattern', 'patcirc'); planned('k.project', 'Project', 'insertmesh');
cmd('k.dimension', 'Sketch Dimension', 'dimension', { key: 'D', run: () => { if (geoSel.size) addDimension(); else { setSketchTool('select'); toast('Select a line, two points, a circle or arc, or two lines, then press D'); } } });
cmd('k.fillet', 'Sketch Fillet', 'fillet2d', { run: () => setSketchTool('fillet2d') }); planned('k.trim', 'Trim', 'trim2d', P1, { key: 'T' }); planned('k.extend', 'Extend', 'extend'); cmd('k.offset', 'Offset', 'offset2d', { key: 'O', run: () => offsetSelection() });
cmd('k.move', 'Move/Copy', 'move', { run: () => setSketchTool('select') });
cmd('k.delete', 'Delete', 'delete', { key: 'Del', run: () => { if (geoSel.size) deleteGeoSelection(); else if (selProfile) deleteProfile(selProfile); else toast('Select something to delete'); } });
for (const [k, l] of [['coincident', 'Coincident'], ['collinear', 'Collinear'], ['tangent', 'Tangent'], ['equal', 'Equal'], ['parallel', 'Parallel'], ['perpendicular', 'Perpendicular'], ['fix', 'Fix/Unfix'], ['horizontal', 'Horizontal/Vertical'], ['concentric', 'Concentric'], ['midpoint', 'Midpoint']])
  cmd('k.c.' + k, l, k, { key: k === 'horizontal' ? 'H' : undefined, run: () => applyConstraint(k) });
cmd('k.c.symmetry', 'Symmetry', 'symmetry', { run: () => applyConstraint('symmetry') });
cmd('k.construction', 'Normal/Construction', 'construction', { key: 'X', run: () => toggleConstruction() });
cmd('k.select', 'Select', 'select', { run: () => setSketchTool('select') });
cmd('k.finish', 'Finish Sketch', 'finish', { run: () => finishSketch() });

const TABS = {
  SOLID: [
    { name: 'CREATE', bar: ['sketch', 'extrude', 'revolve', 'sweep', 'loft', 'hole', 'box', 'patrect', 'mirror'], menu: ['sketch', 'form', 'derive', '-', 'extrude', 'revolve', 'sweep', 'loft', 'rib', 'web', 'emboss', '-', 'hole', 'thread', '-', 'box', 'cylinder', 'sphere', 'torus', 'coil', 'pipe', '-', { sub: 'Pattern', icon: 'patrect', items: ['patrect', 'patcirc', 'patpath'] }, 'mirror', '-', 'thicken', 'boundary'] },
    { name: 'MODIFY', bar: ['presspull', 'fillet', 'chamfer', 'shell', 'draft', 'combine', 'move', 'params'], menu: ['presspull', 'fillet', 'chamfer', 'shell', 'draft', 'scale', 'combine', '-', 'replaceface', 'splitface', 'splitbody', '-', 'move', 'align', 'delete', '-', 'material', 'appearance', '-', 'params'] },
    { name: 'CONFIGURE', bar: ['cfgtable'], menu: ['cfgtable', 'cfgrules'] },
    { name: 'CONSTRUCT', bar: ['offsetplane'], menu: ['offsetplane', 'planeangle', 'midplane', 'planetangent', '-', 'axiscyl', 'axis2p', '-', 'pointv'] },
    { name: 'INSPECT', bar: ['measure', 'section', 'com'], menu: ['measure', 'interference', '-', 'curvature', 'zebra', '-', 'section', 'com', '-', 'properties'] },
    { name: 'INSERT', bar: ['insstep', 'insmesh', 'inssvg', 'canvas'], menu: ['insstep', '-', 'insderive', 'decal', 'canvas', '-', 'insmesh', 'inssvg', 'insdxf'] },
    { name: 'ASSEMBLE', bar: ['newcomp', 'joint'], menu: ['newcomp', '-', 'joint', 'asbuilt', 'rigid', '-', 'drive', 'motionlink', 'contact'] },
    { name: 'SELECT', bar: ['select'], menu: ['select', 'window', 'filters'] },
  ],
  SURFACE: [
    { name: 'CREATE', bar: ['sketch', 's.extrude', 's.patch', 's.offset', 's.loft'], menu: ['sketch', '-', 's.extrude', 's.patch', 's.offset', 's.loft', 's.ruled'] },
    { name: 'MODIFY', bar: ['s.trim', 's.untrim', 's.extend', 's.stitch', 's.thicken'], menu: ['s.trim', 's.untrim', 's.extend', 's.stitch', 's.unstitch', 's.thicken', 's.reverse'] },
    { name: 'CONSTRUCT', bar: ['offsetplane'], menu: ['offsetplane', 'planeangle', 'midplane'] },
    { name: 'INSPECT', bar: ['measure', 'section'], menu: ['measure', 'section', 'curvature', 'zebra'] },
    { name: 'SELECT', bar: ['select'], menu: ['select', 'window'] },
  ],
  MESH: [
    { name: 'CREATE', bar: ['m.insert', 'm.tessellate'], menu: ['m.insert', 'm.tessellate'] },
    { name: 'PREPARE', bar: ['m.facegroups', 'm.repair'], menu: ['m.facegroups', 'm.repair'] },
    { name: 'MODIFY', bar: ['m.remesh', 'm.reduce', 'm.smooth', 'm.convert'], menu: ['m.remesh', 'm.reduce', 'm.smooth', '-', 'm.convert'] },
    { name: 'INSPECT', bar: ['measure', 'section'], menu: ['measure', 'section', 'properties'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
    { name: 'EXPORT', bar: ['exportstl'], menu: ['exportstl'] },
  ],
  'SHEET METAL': [
    { name: 'CREATE', bar: ['sketch', 'sm.flange', 'sm.contour'], menu: ['sketch', 'sm.flange', 'sm.contour'] },
    { name: 'MODIFY', bar: ['sm.unfold', 'sm.refold', 'sm.flat', 'sm.rules'], menu: ['sm.unfold', 'sm.refold', 'sm.flat', '-', 'sm.rules'] },
    { name: 'CONSTRUCT', bar: ['offsetplane'], menu: ['offsetplane'] },
    { name: 'INSPECT', bar: ['measure'], menu: ['measure', 'section'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
  ],
  PLASTIC: [
    { name: 'SETUP', bar: ['pl.rules'], menu: ['pl.rules'] },
    { name: 'CREATE', bar: ['sketch', 'extrude', 'pl.boss', 'pl.snap', 'pl.lip', 'pl.rib'], menu: ['sketch', 'extrude', '-', 'pl.boss', 'pl.snap', 'pl.lip', 'pl.rest', 'pl.rib', 'pl.web'] },
    { name: 'MODIFY', bar: ['fillet', 'shell', 'draft'], menu: ['fillet', 'shell', 'draft'] },
    { name: 'INSPECT', bar: ['measure', 'section'], menu: ['measure', 'section'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
  ],
  MANAGE: [{ name: 'BOM', bar: ['bom'], menu: ['bom', 'properties'] }],
  UTILITIES: [
    { name: 'MAKE', bar: ['make3d'], menu: ['make3d', 'exportstl'] },
    { name: 'NEST', bar: ['nest'], menu: ['nest'] },
    { name: 'ADD-INS', bar: ['addins'], menu: ['addins'] },
    { name: 'UTILITY', bar: ['taskmgr', 'params'], menu: ['taskmgr', 'params'] },
    { name: 'INSPECT', bar: ['measure', 'section', 'com', 'co2'], menu: ['measure', 'section', 'com', 'properties', 'co2'] },
    { name: 'CREATE PMI', bar: ['pmi'], menu: ['pmi'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
  ],
  SKETCH: [
    { name: 'CREATE', bar: ['k.line', 'k.rect2', 'k.circle', 'k.arc', 'k.polygon', 'k.slot', 'k.dimension'], menu: ['k.line', { sub: 'Rectangle', icon: 'rect2', items: ['k.rect2', 'k.rectc'] }, 'k.circle', 'k.arc', 'k.polygon', 'k.slot', 'k.spline', '-', 'k.point', 'k.text', 'k.mirror', 'k.cpattern', 'k.project', '-', 'k.dimension'] },
    { name: 'MODIFY', bar: ['k.construction', 'k.fillet', 'k.trim', 'k.offset', 'k.delete'], menu: ['k.construction', '-', 'k.fillet', 'k.trim', 'k.extend', 'k.offset', '-', 'k.move', 'k.delete'] },
    { name: 'CONSTRAINTS', bar: ['k.c.horizontal', 'k.c.coincident', 'k.c.tangent', 'k.c.equal', 'k.c.parallel', 'k.c.perpendicular', 'k.c.fix'], menu: ['k.c.horizontal', 'k.c.coincident', 'k.c.collinear', 'k.c.tangent', 'k.c.equal', 'k.c.parallel', 'k.c.perpendicular', 'k.c.fix', 'k.c.concentric', 'k.c.midpoint', 'k.c.symmetry'] },
    { name: 'INSPECT', bar: ['measure'], menu: ['measure', 'section'] },
    { name: 'SELECT', bar: ['k.select'], menu: ['k.select'] },
    { name: 'FINISH SKETCH', bar: ['k.finish'], menu: ['k.finish'], finish: true },
  ],
};
const WORKSPACES = [['Design', null], ['Generative Design', P5], ['Render', P2], ['Animation', P2], ['Simulation', P4], ['Manufacture', P3], ['Drawing', P2]];

function runCmd(id) {
  const c = CMD[id]; if (!c) return;
  closeMenus();
  if (!c.run) { toast(`${c.label} is planned for ${c.phase}${c.note ? '. ' + c.note : ''}`); return; }
  if (mode === 'sketch' && !id.startsWith('k.') && !['measure', 'section', 'com', 'params', 'properties', 'bom', 'exportstl', 'make3d', 'select'].includes(id)) finishSketch(true);
  c.run();
}
function tip(c) { return c.label + (c.key ? ` (${c.key})` : '') + (c.phase ? ` · planned, ${c.phase}` : ''); }

function renderRibbon() {
  const tabs = $('#rtabs'); tabs.replaceChildren();
  const names = Object.keys(TABS).filter(t => t !== 'SKETCH');
  if (mode === 'sketch') names.push('SKETCH');
  if (mode !== 'sketch' && activeTab === 'SKETCH') activeTab = 'SOLID';
  for (const t of names) {
    tabs.append(h('button', { class: 'rtab' + (t === 'SKETCH' ? ' ctx' : ''), role: 'tab', 'aria-selected': String(activeTab === t), onclick: () => { activeTab = t; renderRibbon(); } }, t));
  }
  const groups = $('#rgroups'); groups.replaceChildren();
  for (const g of TABS[activeTab]) {
    const bar = h('div', { class: 'rbar' });
    for (const id of g.bar) {
      const c = CMD[id];
      const pressed = (mode === 'sketch' && id === 'k.' + sketchTool) || (id === 'k.select' && sketchTool === 'select' && mode === 'sketch') || (id === 'measure' && measure) || (id === 'section' && section) || (id === 'com' && showCOM);
      if (g.finish) bar.append(h('button', { class: 'rbtn finish', title: tip(c), 'aria-label': c.label, onclick: () => runCmd(id), html: icon(c.icon) + '<span>FINISH SKETCH</span>' }));
      else bar.append(h('button', { class: 'rbtn' + (c.phase ? ' planned' : ''), title: tip(c), 'aria-label': tip(c), 'aria-pressed': pressed ? 'true' : null, onclick: () => runCmd(id), html: icon(c.icon) }));
    }
    const lab = h('button', { class: 'rlabel', 'aria-haspopup': 'true', html: g.name + icon('caret') });
    lab.addEventListener('click', e => { e.stopPropagation(); openMenu(lab, g.menu); });
    groups.append(h('div', { class: 'rgroup', role: 'group', 'aria-label': g.name }, bar, g.finish ? h('span', { class: 'rlabel', style: 'pointer-events:none' }, '') : lab));
  }
}

// dropdown menus
function closeMenus() { $('#menus').replaceChildren(); document.querySelectorAll('[aria-expanded="true"][aria-haspopup]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
function menuItem(it, level) {
  if (it === '-') return h('div', { class: 'msep' });
  if (typeof it === 'string') return cmdItem(it);
  if (it.head) return h('div', { class: 'mhead' }, it.head);
  if (it.sub) {
    const b = h('button', { class: 'mi', html: icon(it.icon) + `<span class="lab">${it.sub}</span>` + icon('chevron') });
    const open = () => { document.querySelectorAll('.menu[data-level="' + (level + 1) + '"]').forEach(m => m.remove()); document.querySelectorAll('.mi.open').forEach(x => x.classList.remove('open')); b.classList.add('open'); openMenu(b, it.items, { side: true, level: level + 1 }); };
    b.addEventListener('mouseenter', open); b.addEventListener('click', e => { e.stopPropagation(); open(); });
    return b;
  }
  if (it.action) {
    return h('button', { class: 'mi' + (it.phase ? ' planned' : ''), role: 'menuitemcheckbox', 'aria-checked': it.checked != null ? String(it.checked) : null, onclick: e => { e.stopPropagation(); closeMenus(); it.action(); },
      html: icon(it.icon || 'generic') + `<span class="lab">${it.label}</span>` + (it.phase ? `<span class="tag">${it.phase}</span>` : it.key ? `<span class="key">${it.key}</span>` : '<span></span>') });
  }
  return null;
}
function cmdItem(it) {
  const c = CMD[it]; if (!c) return null;
  return h('button', { class: 'mi' + (c.phase ? ' planned' : ''), onclick: e => { e.stopPropagation(); runCmd(it); }, title: c.note || null,
    html: icon(c.icon) + `<span class="lab">${c.label}</span>` + (c.phase ? `<span class="tag">${c.phase}</span>` : c.key ? `<span class="key">${c.key}</span>` : '<span></span>') });
}
function openMenu(anchor, items, o = {}) {
  const level = o.level || 0;
  if (!o.side) closeMenus();
  const m = h('div', { class: 'menu', role: 'menu', 'data-level': String(level) });
  items.forEach(it => { const el = menuItem(it, level); if (el) m.append(el); });
  $('#menus').append(m);
  const r = anchor.getBoundingClientRect();
  let x = o.side ? r.right + 2 : r.left, y = o.side ? r.top - 4 : r.bottom + 2;
  if (o.at) { x = o.at.x; y = o.at.y; }
  x = Math.max(6, Math.min(x, window.innerWidth - m.offsetWidth - 6));
  if (o.side && r.right + m.offsetWidth > window.innerWidth) x = Math.max(6, r.left - m.offsetWidth - 2);
  y = Math.max(6, Math.min(y, window.innerHeight - m.offsetHeight - 6));
  m.style.left = x + 'px'; m.style.top = y + 'px';
  if (!o.side && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
  return m;
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu') && !e.target.closest('[aria-haspopup]')) closeMenus(); });

function openWorkspaceMenu() {
  openMenu($('#wsBtn'), [{ head: 'Workspaces' }, ...WORKSPACES.map(([n, ph]) => ({ label: n.toUpperCase(), icon: n === 'Design' ? 'doc' : n === 'Simulation' ? 'analysis' : n === 'Manufacture' ? 'make' : n === 'Drawing' ? 'properties' : n === 'Animation' ? 'motion' : n === 'Render' ? 'appearance' : 'form', phase: ph, checked: n === 'Design' ? true : null, action: () => { if (ph) toast(`The ${n} workspace is planned for ${ph}`); } }))]);
}
function openFileMenu() {
  openMenu($('#abFile'), [
    { label: 'New design', icon: 'doc', action: () => loadDoc(blankDoc(), 'New design. Undo brings the previous one back.') },
    { label: 'Open sample: bearing bracket', icon: 'bodyi', action: () => loadDoc(sampleDoc(), 'Sample bracket opened') },
    '-',
    { label: 'Open project (.json)…', icon: 'file', action: () => $('#fileInput').click() },
    { label: 'Save project (.json)', icon: 'save', key: 'Ctrl S', action: () => saveProject() },
    { label: 'Import STEP…', icon: 'insertmesh', action: () => startImportSTEP() },
    { label: 'Export STEP / STL (.zip)…', icon: 'exportstl', action: () => openExportDialog() },
    '-',
    { label: 'Keyboard shortcuts and roadmap', icon: 'help', action: () => openHelpModal() },
  ]);
}
