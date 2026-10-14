// ===== Core: helpers, document, state, scene =====
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = n => (Math.round((+n || 0) * 1000) / 1000).toString();
const fix = (n, d = 1) => (+n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(c)); }
  return el;
}

const MATERIALS = {
  'Aluminum 6061': { density: 2.70, color: '#B8C0C9' }, 'Steel 1018': { density: 7.87, color: '#8D959D' }, 'Stainless steel 304': { density: 8.00, color: '#C9CED3' },
  'Brass C360': { density: 8.50, color: '#C9A447' }, 'Copper C110': { density: 8.94, color: '#C27A4E' }, 'Titanium Ti-6Al-4V': { density: 4.43, color: '#A09F97' },
  'ABS plastic': { density: 1.04, color: '#E7E3D8' }, 'PLA plastic': { density: 1.24, color: '#E5823B' }, 'Nylon PA12': { density: 1.01, color: '#EEEBE1' }, 'Oak wood': { density: 0.75, color: '#B88A56' },
};
const TYPE = {
  sketch: { label: 'Sketch', icon: 'sketch' }, plane: { label: 'Offset Plane', icon: 'plane' }, extrude: { label: 'Extrude', icon: 'extrude' }, revolve: { label: 'Revolve', icon: 'revolve' },
  box: { label: 'Box', icon: 'box' }, cylinder: { label: 'Cylinder', icon: 'cylinder' }, sphere: { label: 'Sphere', icon: 'sphere' }, torus: { label: 'Torus', icon: 'torus' },
  hole: { label: 'Hole', icon: 'hole' }, fillet: { label: 'Fillet', icon: 'fillet' }, presspull: { label: 'Press Pull', icon: 'presspull' }, draft: { label: 'Draft', icon: 'draft' }, loft: { label: 'Loft', icon: 'loft' }, sweep: { label: 'Sweep', icon: 'sweep' }, import: { label: 'Imported file', icon: 'insertmesh' }, chamfer: { label: 'Chamfer', icon: 'chamfer' }, shell: { label: 'Shell', icon: 'shell' }, pattern: { label: 'Pattern', icon: 'patrect' }, mirror: { label: 'Mirror', icon: 'mirror' }, move: { label: 'Move/Copy', icon: 'move' },
  combine: { label: 'Combine', icon: 'combine' }, remove: { label: 'Remove', icon: 'delete' },
};
const featIcon = f => f.type === 'pattern' ? (f.kind === 'circular' ? 'patcirc' : 'patrect') : (TYPE[f.type]?.icon || 'generic');
const typeLabel = f => f.type === 'pattern' ? (f.kind === 'circular' ? 'Circular Pattern' : 'Rectangular Pattern') : TYPE[f.type]?.label;
const PLACED = new Set(['box', 'cylinder', 'sphere', 'torus', 'hole']);
const SOLIDS = new Set(['extrude', 'revolve', 'box', 'cylinder', 'sphere', 'torus', 'hole']);

// ---------- documents ----------
function sampleDoc() {
  return {
    version: 2, name: 'Bearing bracket', units: 'mm', material: 'Aluminum 6061', rollback: null, bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: { pl1: true, pl2: true },
    params: [
      { name: 'width', expr: '100', comment: 'Plate length along X' },
      { name: 'depth', expr: '60', comment: 'Plate width along Y' },
      { name: 'thickness', expr: '10', comment: 'Plate thickness' },
      { name: 'boss_d', expr: '40', comment: 'Boss diameter' },
      { name: 'boss_h', expr: '25', comment: 'Boss height above the plate' },
      { name: 'bore_d', expr: '12', comment: 'Shaft clearance bore' },
      { name: 'edge', expr: '12', comment: 'Mounting hole inset from the edges' },
    ],
    features: [
      { id: 's1', type: 'sketch', name: 'Base profile', plane: 'XY', offset: 0, profiles: [{ id: 'p1', kind: 'rect', cx: 0, cy: 0, w: 'width', h: 'depth', r: 8, rot: 0 }] },
      { id: 'e1', type: 'extrude', name: 'Base plate', sketch: 's1', distance: 'thickness', direction: 'one', op: 'new' },
      { id: 'pl1', type: 'plane', name: 'Plate top', base: 'XY', offset: 'thickness' },
      { id: 's2', type: 'sketch', name: 'Boss profile', plane: 'pl1', offset: 0, profiles: [{ id: 'p2', kind: 'circle', cx: 0, cy: 0, r: 'boss_d/2' }] },
      { id: 'e2', type: 'extrude', name: 'Boss', sketch: 's2', distance: 'boss_h', direction: 'one', op: 'join' },
      { id: 'h1', type: 'hole', name: 'Mounting hole', plane: 'pl1', offset: 0, cx: 'width/2 - edge', cy: 'depth/2 - edge', diameter: 8, depth: 'thickness', cbore: false, tip: false, tipAngle: 118 },
      { id: 'pt1', type: 'pattern', name: 'Mounting holes', kind: 'linear', source: 'h1', axis: 'X', count: 2, spacing: '-(width - 2*edge)', axis2: 'Y', count2: 2, spacing2: '-(depth - 2*edge)', angle: 360 },
      { id: 'pl2', type: 'plane', name: 'Boss top', base: 'pl1', offset: 'boss_h' },
      { id: 'h2', type: 'hole', name: 'Bearing seat', plane: 'pl2', offset: 0, cx: 0, cy: 0, diameter: 'bore_d', depth: 'thickness + boss_h', cbore: true, cbDiameter: 22, cbDepth: 7, tip: false, tipAngle: 118 },
      { id: 'h3', type: 'hole', name: 'M3 tap hole', plane: 'pl2', offset: 0, cx: 16, cy: 0, diameter: 2.5, depth: 8, cbore: false, tip: true, tipAngle: 118 },
      { id: 'pt2', type: 'pattern', name: 'Bolt circle', kind: 'circular', source: 'h3', axis: 'Z', count: 4, angle: 360, spacing: 20 },
    ],
  };
}
const blankDoc = () => ({ version: 2, name: 'Untitled', units: 'mm', material: 'Aluminum 6061', rollback: null, bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, params: [], features: [] });
function validDoc(d) {
  return d && d.version === 2 && Array.isArray(d.features) && d.features.every(f => f && typeof f.id === 'string' && TYPE[f.type]);
}
function upgradeDoc(d) {
  if (validDoc(d)) return d;
  if (d && Array.isArray(d.features) && !d.version) { // version 1 files
    const n = blankDoc(); n.name = d.name || 'Imported'; n.material = d.material || n.material;
    n.features = d.features.map(f => { const g = { ...f }; if ((g.type === 'pattern' || g.type === 'mirror') && g.target) { g.source = g.target; delete g.target; } return g; });
    const firstSolid = n.features.find(f => SOLIDS.has(f.type)); if (firstSolid && firstSolid.op === 'join') firstSolid.op = 'new';
    n.showOrigin = false;
    return validDoc(n) ? n : null;
  }
  return null;
}

// ---------- state ----------
let doc = null;
let params = { vars: {}, errors: {} };
let resolved = [];
let mode = 'model';                 // 'model' | 'sketch'
let sketchId = null, sketchTool = 'select', selProfile = null, drag = null, lineDraft = null;
let selFeature = null, selBody = null;
let pick = null, measure = null, section = null, showCOM = false;
let dlg = null;                     // open command dialog
let visualStyle = 'edges', showGrid = true, navMode = 'orbit';
let sketchOpts = { grid: true, snap: true, profiles: true, dims: true };
let activeTab = 'SOLID';
let engine = 'mesh', engineState = 'loading', engineMsg = '';
const isBrep = () => engine === 'brep';
const EDGE_FEATS = new Set(['fillet', 'chamfer', 'shell', 'draft', 'presspull']);
const bodyGeomOf = b => b.shape ? brepMeshOf(b).display : b.geom;
function edgeDialogFeature() { const f = dlg && !dlg.custom && featById(dlg.fid); return f && EDGE_FEATS.has(f.type) ? f : null; }
function shownSource() { const f = edgeDialogFeature(); return (f && result.beforeBodies?.get(f.id)) || result.bodies; }
let cache = [];
const emptyResult = () => ({ bodies: new Map(), sketches: new Map(), planes: new Map(), status: new Map(), tools: new Map(), before: new Map() });
let result = emptyResult();
let lastRegenMs = 0;
const history = { undo: [], redo: [] };
let lastTag = null, lastTime = 0;

const featById = id => doc.features.find(f => f.id === id);
const featIndex = id => doc.features.findIndex(f => f.id === id);
const resolvedById = id => resolved.find(f => f.id === id) || featById(id);
const statusOf = id => result.status.get(id) || { state: 'ok' };
const meta = id => (doc.bodyMeta[id] ||= {});
const bodyMaterial = id => doc.bodyMeta[id]?.material || doc.material;
const bodyColor = id => doc.bodyMeta[id]?.color || MATERIALS[bodyMaterial(id)]?.color || '#B8C0C9';
function bodyName(id) {
  if (doc.bodyMeta[id]?.name) return doc.bodyMeta[id].name;
  const b = result.bodies.get(id); if (b) return b.name;
  const f = featById(String(id).split(':')[0]); return f ? 'Body from ' + f.name : 'Missing body';
}
const bodyHidden = id => !!doc.bodyMeta[id]?.hidden || !!doc.hideAllBodies;

function checkpoint(tag = null) {
  const now = Date.now();
  if (tag && tag === lastTag && now - lastTime < 1500) { lastTime = now; return; }
  lastTag = tag; lastTime = now;
  history.undo.push(JSON.stringify(doc));
  if (history.undo.length > 200) history.undo.shift();
  history.redo.length = 0;
  markDirty(); updateUndoButtons();
}
function undo() {
  if (dlg) closeDialog(false);
  if (!history.undo.length) return;
  history.redo.push(JSON.stringify(doc)); doc = JSON.parse(history.undo.pop()); lastTag = null; afterDocReplace(); toast('Undo');
}
function redo() {
  if (dlg) closeDialog(false);
  if (!history.redo.length) return;
  history.undo.push(JSON.stringify(doc)); doc = JSON.parse(history.redo.pop()); lastTag = null; afterDocReplace(); toast('Redo');
}
function updateUndoButtons() { $('#abUndo').disabled = !history.undo.length; $('#abRedo').disabled = !history.redo.length; }
let dirty = false;
function markDirty() { dirty = true; $('#dirty').hidden = false; }
function afterDocReplace() {
  if (selFeature && !featById(selFeature)) selFeature = null;
  if (mode === 'sketch' && !featById(sketchId)) exitSketch(true);
  if (dlg && !featById(dlg.fid) && dlg.fid) closeDialog(false, true);
  const sk = mode === 'sketch' ? featById(sketchId) : null;
  if (selProfile && !(sk && sk.profiles.some(p => p.id === selProfile))) selProfile = null;
  $('#docTitle').textContent = doc.name;
  updateUndoButtons(); renderRibbon(); renderPalette(); scheduleRegen(0);
}

// ---------- three.js scene ----------
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.localClippingEnabled = true;
viewport.append(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'label-layer';
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', zIndex: 2 });
viewport.append(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 10000);
camera.position.set(190, -230, 170);
scene.add(camera);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6); keyLight.position.set(0.5, 0.8, 1); camera.add(keyLight);
const fill = new THREE.HemisphereLight(0xffffff, 0x606a76, 1.45); fill.position.set(0, 0, 1); scene.add(fill);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.2; controls.screenSpacePanning = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.target.set(0, 0, 15);

const gridGroup = new THREE.Group(); scene.add(gridGroup);
const originGroup = new THREE.Group(); scene.add(originGroup);
const bodiesGroup = new THREE.Group(); scene.add(bodiesGroup);
const planesGroup = new THREE.Group(); scene.add(planesGroup);
const overlay = new THREE.Group(); scene.add(overlay);
const toolsOverlay = new THREE.Group(); scene.add(toolsOverlay);
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x1b64d8, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false });
const ghostMesh = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat); ghostMesh.renderOrder = 6; scene.add(ghostMesh);
const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

const colors = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['viewport', 'grid', 'grid-major', 'body', 'edge', 'accent', 'select', 'muted', 'err', 'fg', 'ok', 'sketch', 'ico-c', 'panel', 'line']) colors[k] = new THREE.Color(cs.getPropertyValue('--' + k).trim() || '#888');
  scene.background = colors.viewport;
  buildGrid(); shownBodies.clear(); clearGroup(bodiesGroup); updateScene(); drawViewCubeFaces(); requestRender();
}
function clearGroup(g) {
  g.traverse(o => { if (o.isCSS2DObject) o.element.remove(); if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.keep) [].concat(o.material).forEach(m => m.dispose?.()); });
  g.clear();
}
function line(points, color, o = {}) {
  const g = new THREE.BufferGeometry().setFromPoints(points.map(p => p.isVector3 ? p : new THREE.Vector3(...p)));
  const m = o.dashed ? new THREE.LineDashedMaterial({ color, dashSize: o.dash || 3, gapSize: o.gap || 2, transparent: true, opacity: o.opacity ?? 1, depthTest: o.depthTest ?? true })
    : new THREE.LineBasicMaterial({ color, transparent: o.opacity != null, opacity: o.opacity ?? 1, depthTest: o.depthTest ?? true });
  const l = new (o.loop ? THREE.LineLoop : o.segments ? THREE.LineSegments : THREE.Line)(g, m);
  if (o.dashed) l.computeLineDistances();
  l.renderOrder = o.order || 0;
  return l;
}
function buildGrid() {
  clearGroup(gridGroup);
  const minor = new THREE.GridHelper(600, 120, colors.grid, colors.grid); minor.rotation.x = Math.PI / 2; minor.position.z = -0.06;
  const major = new THREE.GridHelper(600, 12, colors['grid-major'], colors['grid-major']); major.rotation.x = Math.PI / 2; major.position.z = -0.05;
  gridGroup.add(minor, major);
  gridGroup.add(line([[-300, 0, -0.04], [300, 0, -0.04]], 0xd9534a, { opacity: 0.75 }), line([[0, -300, -0.04], [0, 300, -0.04]], 0x48a85a, { opacity: 0.75 }));
  gridGroup.visible = showGrid && mode !== 'sketch';
}

let needsRender = true, tween = null;
const requestRender = () => { needsRender = true; };
controls.addEventListener('change', requestRender);
renderer.setAnimationLoop(t => {
  if (tween) {
    const k = Math.min(1, (t - tween.t0) / tween.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.c0, tween.c1, e);
    camera.up.lerpVectors(tween.u0, tween.u1, e).normalize();
    if (k >= 1) tween = null;
    needsRender = true;
  }
  const moved = controls.update();
  if (moved || needsRender) { renderer.render(scene, camera); labelRenderer.render(scene, camera); renderViewCube(); needsRender = false; }
});
new ResizeObserver(() => {
  const w = viewport.clientWidth, hgt = viewport.clientHeight;
  if (!w || !hgt) return;
  renderer.setSize(w, hgt); labelRenderer.setSize(w, hgt);
  camera.aspect = w / hgt; camera.updateProjectionMatrix(); requestRender();
}).observe(viewport);

function visibleBox() {
  const b = new THREE.Box3();
  for (const [id, body] of result.bodies) { if (bodyHidden(id)) continue; const g = bodyGeomOf(body); g.computeBoundingBox(); b.union(g.boundingBox); }
  if (b.isEmpty()) b.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 20));
  return b;
}
const VIEWS = {
  top: [[0, 0, 1], [0, 1, 0]], bottom: [[0, 0, -1], [0, -1, 0]], front: [[0, -1, 0], [0, 0, 1]], back: [[0, 1, 0], [0, 0, 1]],
  right: [[1, 0, 0], [0, 0, 1]], left: [[-1, 0, 0], [0, 0, 1]], iso: [[1, -1.25, 0.95], [0, 0, 1]],
};
function animateTo(p1, c1, u1, instant) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (instant || reduce) { camera.position.copy(p1); controls.target.copy(c1); camera.up.copy(u1); controls.update(); requestRender(); return; }
  tween = { t0: performance.now(), dur: 380, p0: camera.position.clone(), p1, c0: controls.target.clone(), c1, u0: camera.up.clone(), u1 };
}
function fitDistance(box) {
  const R = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 25);
  return R / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect < 1 ? 1.45 : 1.02);
}
function setView(name, instant = false) {
  const box = visibleBox(), c = box.getCenter(new THREE.Vector3()), dist = fitDistance(box);
  let dir, up;
  if (name === 'fit') { dir = camera.position.clone().sub(controls.target).normalize(); up = camera.up.clone(); }
  else { const v = VIEWS[name] || VIEWS.iso; dir = new THREE.Vector3(...v[0]).normalize(); up = new THREE.Vector3(...v[1]); }
  animateTo(c.clone().add(dir.multiplyScalar(dist)), c, up, instant);
}
function lookAtMatrix(M, extraBox) {
  const n = new THREE.Vector3(0, 0, 1).transformDirection(M), v = new THREE.Vector3(0, 1, 0).transformDirection(M), o = new THREE.Vector3().setFromMatrixPosition(M);
  const box = extraBox || visibleBox(), c = box.getCenter(new THREE.Vector3());
  const center = c.clone().sub(n.clone().multiplyScalar(c.clone().sub(o).dot(n)));
  const dist = Math.max(fitDistance(box), 180);
  animateTo(center.clone().add(n.clone().multiplyScalar(dist)), center, v);
}
function planeMatrixOf(ref, offset = 0, flip = false) {
  try {
    const p = resolvePlane(ref || 'XY', { planes: result.planes });
    return planeMatrix(p.base, p.offset + (+offset || 0), !!flip !== !!p.flip);
  } catch (e) { return planeMatrix('XY', 0); }
}
function sketchMatrix(sk) { const r = resolvedById(sk.id) || sk; return planeMatrixOf(sk.plane, r.offset, sk.flip); }

// ---------- bodies display ----------
const shownBodies = new Map(); // id -> {geom, mesh, edges, cap}
function bodyMaterials(id) {
  const c = new THREE.Color(bodyColor(id));
  return {
    mesh: new THREE.MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    edge: new THREE.LineBasicMaterial({ color: colors.edge }),
    cap: new THREE.MeshBasicMaterial({ color: colors['ico-c'], side: THREE.BackSide }),
  };
}
function updateScene() {
  if (!colors.accent) return;
  // sync body meshes
  const src = shownSource();
  for (const [id, s] of shownBodies) if (!src.has(id) || src.get(id) !== s.rec) {
    bodiesGroup.remove(s.mesh, s.edges, s.cap);
    if (s.own) { s.mesh.geometry.dispose(); s.edges.geometry.dispose(); }
    s.mesh.material.dispose(); s.edges.material.dispose(); s.cap.material.dispose();
    shownBodies.delete(id);
  }
  for (const [id, b] of src) {
    if (shownBodies.has(id)) continue;
    const mats = bodyMaterials(id);
    let disp, eg, own = false;
    if (b.shape) { const m = brepMeshOf(b); disp = m.display; eg = m.edgeGeom; }
    else { disp = toCreasedNormals(b.geom, THREE.MathUtils.degToRad(32)); eg = featureEdges(b.geom, 28); own = true; }
    const mesh = new THREE.Mesh(disp, mats.mesh); mesh.userData.body = id;
    const edges = new THREE.LineSegments(eg, mats.edge); edges.userData.body = id;
    const cap = new THREE.Mesh(disp, mats.cap);
    bodiesGroup.add(mesh, edges, cap);
    shownBodies.set(id, { rec: b, mesh, edges, cap, own });
  }
  const inSketch = mode === 'sketch';
  const secOn = !!section && !section.hidden;
  const clip = secOn ? [sectionPlane] : [];
  if (secOn) {
    const ax = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) }[section.axis];
    const s = section.flip ? 1 : -1;
    sectionPlane.normal.copy(ax).multiplyScalar(s); sectionPlane.constant = -s * (+section.offset || 0);
  }
  for (const [id, s] of shownBodies) {
    const hidden = bodyHidden(id), isSel = selBody === id;
    s.mesh.material.color.set(bodyColor(id));
    s.mesh.material.emissive.set(isSel ? colors.select : 0x000000); s.mesh.material.emissiveIntensity = isSel ? 0.18 : 0;
    s.mesh.material.transparent = inSketch; s.mesh.material.opacity = inSketch ? 0.25 : 1; s.mesh.material.depthWrite = !inSketch;
    s.mesh.material.wireframe = visualStyle === 'wire';
    s.edges.material.color.copy(isSel ? colors.select : colors.edge);
    s.edges.material.transparent = inSketch; s.edges.material.opacity = inSketch ? 0.3 : 1;
    s.mesh.material.clippingPlanes = clip; s.edges.material.clippingPlanes = clip; s.cap.material.clippingPlanes = clip;
    s.mesh.visible = !hidden; s.edges.visible = !hidden && visualStyle !== 'shaded'; s.cap.visible = !hidden && secOn && visualStyle !== 'wire';
    s.mesh.material.needsUpdate = true;
  }
  gridGroup.visible = showGrid && !inSketch;
  // ghost of the selected or edited feature's tool
  const fid = dlg?.fid || (mode === 'model' ? selFeature : null);
  const tool = fid && result.tools.get(fid);
  if (tool && !inSketch && (tool.geom || tool.shape)) {
    ghostMesh.geometry = tool.shape ? brepMeshOf(tool).display : tool.geom;
    ghostMat.color.copy(tool.op === 'cut' ? colors.err : tool.op === 'intersect' ? colors.select : tool.op === 'new' ? colors.ok : colors.accent);
    ghostMat.clippingPlanes = clip; ghostMesh.visible = true;
  } else { ghostMesh.visible = false; }
  drawPlanes(); drawOrigin(); refreshOverlays(); drawToolsOverlay();
  requestRender();
}

// construction planes + origin
function planeSize() { const s = visibleBox().getSize(new THREE.Vector3()); return Math.max(60, Math.max(s.x, s.y, s.z) * 1.15); }
function planeQuad(M, size, color, opacity, userData, label) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(M);
  const half = size / 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  mesh.userData = { ...userData, baseOpacity: opacity }; mesh.renderOrder = 2;
  g.add(mesh, line([[-half, -half, 0], [half, -half, 0], [half, half, 0], [-half, half, 0]], color, { loop: true, opacity: 0.8 }));
  if (label) { const o = new CSS2DObject(h('div', { class: 'plabel' }, label)); o.position.set(-half + 2, half - 2, 0); g.add(o); }
  return g;
}
function drawPlanes() {
  clearGroup(planesGroup);
  const size = planeSize(), picking = !!pick;
  for (const [id, p] of result.planes) {
    const f = featById(id); if (!f) continue;
    const show = picking || selFeature === id || dlg?.fid === id || !doc.planeHidden[id];
    if (!show) continue;
    const M = planeMatrix(p.base, p.offset, p.flip);
    planesGroup.add(planeQuad(M, size * 0.75, colors['ico-c'], selFeature === id || dlg?.fid === id ? 0.28 : 0.13, { plane: id, pickable: true }, f.name));
  }
}
function drawOrigin() {
  clearGroup(originGroup);
  const show = doc.showOrigin || !!pick;
  if (!show) return;
  const size = Math.min(planeSize() * 0.6, 120);
  const cols = { XY: 0x3d7be0, XZ: 0x3faa5b, YZ: 0xd9534a };
  if (mode !== 'sketch' || pick) for (const k of ['XY', 'XZ', 'YZ']) originGroup.add(planeQuad(planeMatrix(k, 0), size, cols[k], pick ? 0.16 : 0.07, { plane: k, pickable: true }, k));
  const L = size * 0.6;
  originGroup.add(line([[0, 0, 0], [L, 0, 0]], 0xd9534a, { depthTest: false, order: 3 }), line([[0, 0, 0], [0, L, 0]], 0x3faa5b, { depthTest: false, order: 3 }), line([[0, 0, 0], [0, 0, L]], 0x3d7be0, { depthTest: false, order: 3 }));
}

// sketch overlay
function rotPt(pr, x, y) { const a = (+pr.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [pr.cx + x * c - y * s, pr.cy + x * s + y * c]; }
function dimLabel(text, x, y, field) {
  const el = h('button', { class: 'dim', type: 'button', 'aria-label': 'Edit dimension ' + text, onclick: () => { const inp = document.getElementById('pf-' + field); if (inp) { inp.focus(); inp.select(); } } }, text);
  const o = new CSS2DObject(el); o.position.set(x, y, 0.1); return o;
}
function profileDims(pr) {
  const out = [];
  if (pr.kind === 'rect') out.push(dimLabel(fmt(pr.w), ...rotPt(pr, 0, -pr.h / 2 - 5), 'w'), dimLabel(fmt(pr.h), ...rotPt(pr, pr.w / 2 + 7, 0), 'h'));
  else if (pr.kind === 'circle') out.push(dimLabel('Ø' + fmt(pr.r * 2), pr.cx, pr.cy + pr.r + 5, 'd'));
  else if (pr.kind === 'polygon') out.push(dimLabel('R' + fmt(pr.r) + ' · ' + pr.sides, pr.cx, pr.cy + pr.r + 5, 'r'));
  else if (pr.kind === 'slot') out.push(dimLabel(fmt(pr.length) + ' × ' + fmt(pr.width), ...rotPt(pr, 0, pr.width / 2 + 5), 'length'));
  else if (pr.kind === 'poly') {
    const pts = pr.pts;
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; out.push(dimLabel(fmt(Math.hypot(q.x - p.x, q.y - p.y)), (p.x + q.x) / 2, (p.y + q.y) / 2, 'pts')); });
  }
  return out;
}
function liveProfiles(sk) {
  let r; try { r = resolveFeatures([sk], params.vars)[0]; } catch (e) { return []; }
  try { return sketchWithGeo(r).profiles || []; } catch (e) { return r.profiles || []; }
}
function drawSketch(sk, active) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false; g.matrix.copy(sketchMatrix(sk));
  const profiles = liveProfiles(sk);
  const col = active ? colors.sketch : colors.muted;
  if (active && sketchOpts.grid) {
    const grid = new THREE.GridHelper(400, 80, colors.grid, colors.grid); grid.rotation.x = Math.PI / 2; grid.position.z = -0.02;
    grid.material.depthTest = false; grid.renderOrder = 1; g.add(grid);
    g.add(line([[-200, 0, 0], [200, 0, 0]], 0xd9534a, { depthTest: false, opacity: 0.6, order: 2 }), line([[0, -200, 0], [0, 200, 0]], 0x3faa5b, { depthTest: false, opacity: 0.6, order: 2 }));
  }
  if (!active || sketchOpts.profiles) {
    try {
      const { regions } = buildRegions(profiles);
      for (const r of regions) {
        const shape = new THREE.Shape(r.outer); shape.holes = r.holes.map(p => new THREE.Path(p));
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: active ? colors.sketch : colors.accent, transparent: true, opacity: active ? 0.14 : 0.08, side: THREE.DoubleSide, depthWrite: false, depthTest: !active }));
        m.position.z = 0.03; m.renderOrder = 3; g.add(m);
      }
    } catch (e) { /* profile being edited */ }
  }
  for (const pr of profiles) {
    if (String(pr.id).startsWith('geo-')) continue;   // drawn as geometry below
    let pts; try { pts = profilePolygon(pr); } catch (e) { continue; }
    const isSel = active && (pr.id === selProfile || pr === drag?.draft);
    g.add(line(pts.map(p => [p.x, p.y, 0.06]), isSel ? colors.select : col, { loop: true, depthTest: !active, order: 4 }));
    if (isSel && sketchOpts.dims) for (const d of profileDims(pr)) g.add(d);
  }
  if (!active || sketchOpts.profiles) drawRegions(sk, g, active);
  drawGeo(sk, g, active);
  return g;
}
function refreshOverlays() {
  if (!colors.accent) return;
  clearGroup(overlay);
  if (mode === 'sketch') { const sk = featById(sketchId); if (sk) overlay.add(drawSketch(sk, true)); }
  const shown = new Set(Object.keys(doc.sketchShown || {}).filter(k => doc.sketchShown[k]));
  const f = selFeature && featById(selFeature), df = dlg && featById(dlg.fid);
  for (const x of [f, df]) { if (x?.type === 'sketch') shown.add(x.id); if (x && (x.type === 'extrude' || x.type === 'revolve') && x.sketch) shown.add(x.sketch); }
  for (const id of shown) {
    if (mode === 'sketch' && id === sketchId) continue;
    const sk = featById(id); if (!sk || sk.type !== 'sketch' || !result.sketches.has(id)) continue;
    overlay.add(drawSketch(sk, false));
  }
  requestRender();
}

// measure, center of mass, section plane, pick hover
let pickHover = null, edgeHover = null;
function drawToolsOverlay() {
  clearGroup(toolsOverlay);
  if (measure && measure.pts.length) {
    for (const p of measure.pts) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: colors.select, depthTest: false }));
      s.position.copy(p); s.renderOrder = 9; s.scale.setScalar(camera.position.distanceTo(controls.target) / 260); toolsOverlay.add(s);
    }
    if (measure.pts.length === 2) {
      const [a, b] = measure.pts;
      toolsOverlay.add(line([a, b], colors.select, { depthTest: false, order: 9 }));
      const o = new CSS2DObject(h('div', { class: 'mlabel' }, fix(a.distanceTo(b), 2) + ' mm')); o.position.copy(a).add(b).multiplyScalar(0.5); toolsOverlay.add(o);
    }
  }
  if (showCOM) {
    const mp = massProps();
    if (mp.total.mass > 0) {
      const c = mp.total.com, L = Math.max(8, planeSize() * 0.08);
      toolsOverlay.add(line([[c.x - L, c.y, c.z], [c.x + L, c.y, c.z], [c.x, c.y, c.z], [c.x, c.y - L, c.z], [c.x, c.y + L, c.z], [c.x, c.y, c.z], [c.x, c.y, c.z - L], [c.x, c.y, c.z + L]], colors.select, { depthTest: false, order: 9 }));
      const o = new CSS2DObject(h('div', { class: 'mlabel' }, 'Center of mass')); o.position.set(c.x, c.y, c.z + L * 1.2); toolsOverlay.add(o);
    }
  }
  if (section && !section.hidden) {
    const box = visibleBox(), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), size = Math.max(s.x, s.y, s.z) * 1.4 + 10;
    const base = { X: 'YZ', Y: 'XZ', Z: 'XY' }[section.axis];
    const M = planeMatrix(base, section.axis === 'Y' ? -(+section.offset || 0) : (+section.offset || 0));
    const shift = new THREE.Vector3().copy(c); const n = new THREE.Vector3(0, 0, 1).transformDirection(M); shift.sub(n.clone().multiplyScalar(shift.dot(n)));
    M.premultiply(new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z));
    toolsOverlay.add(planeQuad(M, size, colors['ico-c'], 0.06, {}, 'Section'));
  }
  const ef = edgeDialogFeature();
  if (ef) {
    const srcB = shownSource();
    for (const [, b] of srcB) {
      if (!b.shape || bodyHidden(b.id)) continue;
      const m = brepMeshOf(b), sel = brepRefHashes(b, ef.edges || [], FACE_PICK.has(ef.type) ? 'face' : 'edge');
      const hov = edgeHover && edgeHover.body === b.id ? edgeHover.hash : null;
      if (FACE_PICK.has(ef.type)) {
        for (const [set, col, op] of [[sel, colors.select, 0.55], [new Set(hov != null ? [hov] : []), colors.accent, 0.35]]) {
          if (!set.size) continue;
          const idx = m.display.index.array, pos = [];
          const P = m.display.attributes.position.array;
          for (let t = 0; t < m.triFace.length; t++) if (set.has(m.triFace[t])) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          const mm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, depthWrite: false }));
          mm.renderOrder = 8; toolsOverlay.add(mm);
        }
      } else {
        for (const [set, col] of [[sel, colors.select], [new Set(hov != null ? [hov] : []), colors.accent]]) {
          if (!set.size) continue;
          const pos = [];
          for (let sgi = 0; sgi < m.segEdge.length; sgi++) if (set.has(m.segEdge[sgi])) { const a = m.edgeGeom.attributes.position.array; for (let k = 0; k < 6; k++) pos.push(a[sgi * 6 + k]); }
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, depthTest: false, linewidth: 2 })); ls.renderOrder = 9; toolsOverlay.add(ls);
          // thicker look: a second pass slightly offset toward the camera is not portable; draw tubes for selected edges
          if (set === sel) for (let sgi = 0; sgi < m.segEdge.length; sgi++) if (set.has(m.segEdge[sgi])) {
            const a = m.edgeGeom.attributes.position.array, A = new THREE.Vector3(a[sgi * 6], a[sgi * 6 + 1], a[sgi * 6 + 2]), B = new THREE.Vector3(a[sgi * 6 + 3], a[sgi * 6 + 4], a[sgi * 6 + 5]);
            const L = A.distanceTo(B); if (L < 1e-6) continue;
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, L, 6), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
            cyl.position.copy(A).add(B).multiplyScalar(0.5); cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); cyl.renderOrder = 9; toolsOverlay.add(cyl);
          }
        }
      }
    }
  }
  if (pickHover) {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(pickHover.M);
    const m = new THREE.Mesh(new THREE.CircleGeometry(Math.max(2, planeSize() * 0.03), 32), new THREE.MeshBasicMaterial({ color: colors.select, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }));
    m.position.set(pickHover.local.x, pickHover.local.y, 0.05); m.renderOrder = 9; g.add(m);
    g.add(line([[pickHover.local.x, pickHover.local.y, 0], [pickHover.local.x, pickHover.local.y, Math.max(6, planeSize() * 0.08)]], colors.select, { depthTest: false, order: 9 }));
    toolsOverlay.add(g);
  }
  requestRender();
}

// ---------- mass properties ----------
let mpCache = null;
function massProps() {
  if (mpCache && mpCache.key === result.bodies && mpCache.matKey === JSON.stringify(doc.bodyMeta) + doc.material) return mpCache.val;
  const bodies = [];
  let M = 0; const C = new THREE.Vector3();
  for (const [id, b] of result.bodies) {
    if (b.shape) {
      const pr = brepProps(b), g = bodyGeomOf(b); g.computeBoundingBox();
      const dens = MATERIALS[bodyMaterial(id)]?.density || 1, mass = pr.volume / 1000 * dens;
      bodies.push({ id, name: bodyName(id), material: bodyMaterial(id), volume: pr.volume, area: pr.area, mass, com: pr.com.clone(), size: g.boundingBox.getSize(new THREE.Vector3()), tris: g.index ? g.index.count / 3 : 0, hidden: bodyHidden(id), exact: true });
      if (!bodyHidden(id)) { M += mass; C.add(pr.com.clone().multiplyScalar(mass)); }
      continue;
    }
    const p = b.geom.attributes.position.array; let V = 0; const c = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 9) {
      const v = (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6]) + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
      V += v; c.x += v * (p[i] + p[i + 3] + p[i + 6]) / 4; c.y += v * (p[i + 1] + p[i + 4] + p[i + 7]) / 4; c.z += v * (p[i + 2] + p[i + 5] + p[i + 8]) / 4;
    }
    if (V) c.divideScalar(V);
    b.geom.computeBoundingBox();
    const dens = MATERIALS[bodyMaterial(id)]?.density || 1, mass = Math.abs(V) / 1000 * dens;
    bodies.push({ id, name: bodyName(id), material: bodyMaterial(id), volume: Math.abs(V), area: surfaceArea(b.geom), mass, com: c, size: b.geom.boundingBox.getSize(new THREE.Vector3()), tris: p.length / 9, hidden: bodyHidden(id) });
    if (!bodyHidden(id)) { M += mass; C.add(c.clone().multiplyScalar(mass)); }
  }
  if (M) C.divideScalar(M);
  const vis = bodies.filter(b => !b.hidden);
  const val = { bodies, total: { mass: M, com: C, volume: vis.reduce((s, b) => s + b.volume, 0), area: vis.reduce((s, b) => s + b.area, 0) } };
  mpCache = { key: result.bodies, matKey: JSON.stringify(doc.bodyMeta) + doc.material, val };
  return val;
}

// ---------- regeneration ----------
let regenTimer = null;
function scheduleRegen(delay = 0) {
  clearTimeout(regenTimer); $('#busy').hidden = false;
  regenTimer = setTimeout(() => requestAnimationFrame(doRegen), delay);
}
function doRegen() {
  const t = performance.now();
  try {
    params = evalParams(doc.params);
    resolved = resolveFeatures(doc.features, params.vars);
    if (isBrep()) ensureImports();
    result = isBrep() ? regenerateBrep(resolved, doc.rollback, cache) : regenerate(resolved, doc.rollback, cache);
    if (isBrep()) brepCollect(cache, result);
  } catch (e) { console.error(e); toast('Rebuild failed: ' + e.message); }
  lastRegenMs = performance.now() - t;
  $('#busy').hidden = true;
  if (selBody && !result.bodies.has(selBody)) selBody = null;
  updateScene(); renderTimeline(); renderBrowser(); renderInfo(); refreshDialogStatus(); persist();
}

// ---------- persistence (per-browser convenience) ----------
const STORE_KEY = 'draftwork.doc.v2';
let persistTimer = null;
let persistWarned = false;
function persist() { clearTimeout(persistTimer); persistTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch (e) { if (!persistWarned) { persistWarned = true; toast('This design is too large to keep in the browser. Save the project file to keep your work.'); } } }, 500); }
function loadStored() { try { return upgradeDoc(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { return null; } }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
