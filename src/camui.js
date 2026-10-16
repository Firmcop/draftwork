// ===== Manufacture workspace: setups, tool library, milling operations, toolpath preview, simulation, post processing =====
// doc.cam = { tools: [tool], setups: [setup], active: setupId }
// setup = { id, name, axis: '+Z'|'-Z'|'+X'|'-X'|'+Y'|'-Y', stock: { xy, top, bottom }, origin: 'corner'|'center'|'model', wcs, program, post, coolant, ops: [op] }
// op = { id, type, name, tool: toolId, ...params, floors/holes: [{ sig }] }
const DEFAULT_TOOLS = () => [
  { id: 't1', num: 1, name: 'Ø10 flat end mill', type: 'flat', d: 10, flutes: 3, rpm: 9000, feed: 1500, plunge: 400 },
  { id: 't2', num: 2, name: 'Ø6 flat end mill', type: 'flat', d: 6, flutes: 3, rpm: 12000, feed: 1100, plunge: 300 },
  { id: 't3', num: 3, name: 'Ø6 ball end mill', type: 'ball', d: 6, flutes: 2, rpm: 12000, feed: 1400, plunge: 350 },
  { id: 't4', num: 4, name: 'Ø3 ball end mill', type: 'ball', d: 3, flutes: 2, rpm: 16000, feed: 900, plunge: 250 },
  { id: 't5', num: 5, name: 'Ø5 drill', type: 'drill', d: 5, flutes: 2, tipAngle: 118, rpm: 2500, feed: 250, plunge: 200 },
  { id: 't6', num: 6, name: 'Ø8 drill', type: 'drill', d: 8, flutes: 2, tipAngle: 118, rpm: 1800, feed: 220, plunge: 180 },
  { id: 't7', num: 7, name: 'Ø50 face mill', type: 'face', d: 50, flutes: 5, rpm: 4000, feed: 2000, plunge: 500 },
];
const CAM_OPS = {
  face: { label: 'Face', icon: 'patch', tool: 'face', defaults: { stepover: 0.7, stepdown: 1, leaveAxial: 0 } },
  pocket: { label: '2D Pocket', icon: 'shell', tool: 'flat', defaults: { stepover: 0.4, stepdown: 2, leaveRadial: 0, leaveAxial: 0, direction: 'climb', floors: [] } },
  contour: { label: '2D Contour', icon: 'offsetsurf', tool: 'flat', defaults: { side: 'outside', stepdown: 3, leaveRadial: 0, bottom: '', direction: 'climb', multiDepth: true } },
  drill: { label: 'Drill', icon: 'hole', tool: 'drill', defaults: { peck: 0, through: true, breakthrough: 0.5, retract: 2, dwell: 0, holes: [] } },
  rough: { label: 'Pocket Clearing (3D roughing)', icon: 'remesh', tool: 'flat', defaults: { stepover: 0.4, stepdown: 3, leaveRadial: 0.5, leaveAxial: 0.3, direction: 'climb', bottom: '' } },
  parallel: { label: 'Parallel (3D finishing)', icon: 'patrect', tool: 'ball', defaults: { stepover: 0.1, angle: 0, leaveRadial: 0, leaveAxial: 0 } },
  waterline: { label: 'Waterline (3D finishing)', icon: 'contourflange', tool: 'flat', defaults: { stepdown: 0.5, leaveRadial: 0, top: '', bottom: '', direction: 'climb' } },
};
const AXIS_ROT = { '+Z': () => new THREE.Matrix4(), '-Z': () => new THREE.Matrix4().makeRotationX(Math.PI), '+Y': () => new THREE.Matrix4().makeRotationX(-Math.PI / 2), '-Y': () => new THREE.Matrix4().makeRotationX(Math.PI / 2), '+X': () => new THREE.Matrix4().makeRotationY(-Math.PI / 2), '-X': () => new THREE.Matrix4().makeRotationY(Math.PI / 2) };
const camGroup = new THREE.Group(); scene.add(camGroup);
const camCache = new Map();   // op id -> { key, res }
let camCtxCache = null, camSel = null, camSim = null;

const cam = () => doc.cam || (doc.cam = { tools: DEFAULT_TOOLS(), setups: [], active: null });
const camSetup = () => { const C = cam(); return C.setups.find(s => s.id === C.active) || C.setups[0] || null; };
const camTool = id => cam().tools.find(t => t.id === id) || null;
const opById = id => { for (const s of cam().setups) { const o = s.ops.find(x => x.id === id); if (o) return { setup: s, op: o }; } return null; };

// ---- workspace ----
function enterManufacture() {
  if (!needExact('Manufacture')) return;
  if (!result.bodies.size) { toast('There is no body to machine yet'); return; }
  if (workspace === 'drawing') exitDrawing();
  if (mode === 'sketch') finishSketch(true);
  if (dlg) closeDialog(true);
  workspace = 'manufacture'; document.body.classList.add('ws-manufacture'); $('#wsBtn span').textContent = 'MANUFACTURE';
  activeTab = 'MILLING';
  if (!cam().setups.length) { checkpoint(); newSetup(true); }
  renderRibbon(); renderBrowser(); drawCam(); defaultHint();
}
function exitManufacture() {
  stopSim(); workspace = 'design'; document.body.classList.remove('ws-manufacture'); $('#wsBtn span').textContent = 'DESIGN';
  clearGroup(camGroup); activeTab = 'SOLID'; drawPrint(); renderRibbon(); renderBrowser(); updateScene(); defaultHint(); requestRender();
}
function camHint() {
  if (activeTab === 'ADDITIVE') return 'Print Setup sets the printer and quality; Slice shows the layers and saves G-code.';
  if (camPick) return camPick === 'floor' ? 'Click the flat floor of each pocket · click again to remove · OK when done' : 'Click the holes to drill · click again to remove';
  return 'Add operations from the ribbon. Double-click one in the browser to edit it; Simulate shows the material being cut.';
}

// ---- setup frame, stock and height map ----
function setupBodies(s) { return [...result.bodies.keys()].filter(id => !bodyHidden(id) && (!s.bodies || s.bodies.includes(id)) && !isSurfBody(id)); }
function setupGeometry(s) {
  const R = AXIS_ROT[s.axis || '+Z'](), tris = [];
  for (const id of setupBodies(s)) {
    const b = result.bodies.get(id), g = b.shape ? brepGeomNI(b) : b.geom; if (!g) continue;
    const M = R.clone().multiply(bodyXf(id)), p = g.attributes.position.array, v = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(M); tris.push(v.x, v.y, v.z); }
  }
  return { tris: new Float32Array(tris), R };
}
function camContext(s) {
  const tools = s.ops.map(o => camTool(o.tool)).filter(Boolean), minR = Math.min(3, ...tools.map(t => t.d / 2));
  const key = JSON.stringify([s.axis, s.stock, s.bodies, setupBodies(s), minR]) + '|' + [...result.bodies.values()].map(b => b.shape || b.geom?.uuid).join(',');
  if (camCtxCache?.key === key) return camCtxCache.ctx;
  const { tris, R } = setupGeometry(s);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]); }
  if (!(hi[0] > lo[0])) return null;
  const st = s.stock || {}, xy = +st.xy || 0, stock = { x0: lo[0] - xy, y0: lo[1] - xy, x1: hi[0] + xy, y1: hi[1] + xy, top: hi[2] + (+st.top || 0), bottom: lo[2] - (+st.bottom || 0) };
  const maxR = Math.max(5, ...tools.map(t => t.d / 2)) + 2;
  let g = Math.min(1, Math.max(0.15, minR / 5));
  const area = (stock.x1 - stock.x0 + 2 * maxR) * (stock.y1 - stock.y0 + 2 * maxR);
  if (area / (g * g) > 1.2e6) g = Math.sqrt(area / 1.2e6);
  const G = rasterize(makeGrid(stock.x0 - maxR, stock.y0 - maxR, stock.x1 + maxR, stock.y1 + maxR, g), tris);
  const ctx = { G, stock, partTop: hi[2], partBottom: lo[2], clear: stock.top + 10, R, Ri: R.clone().invert() };
  camCtxCache = { key, ctx };
  return ctx;
}
function originOf(s, ctx) {
  const st = ctx.stock;
  if (s.origin === 'center') return [(st.x0 + st.x1) / 2, (st.y0 + st.y1) / 2, st.top];
  if (s.origin === 'model') return [0, 0, 0];
  return [st.x0, st.y0, st.top];
}

// ---- geometry picks (pocket floors, holes) resolved in the setup frame ----
function sigToSetup(sig, ctx) {
  const c = new THREE.Vector3(...sig.c).applyMatrix4(ctx.R), n = new THREE.Vector3(...sig.n).transformDirection(ctx.R);
  const out = { c, n };
  if (sig.ax) { out.ax = new THREE.Vector3(...sig.ax).transformDirection(ctx.R); out.ap = new THREE.Vector3(...sig.ap).applyMatrix4(ctx.R); out.r = sig.r; }
  return out;
}
function floorsOf(op, ctx) { return (op.floors || []).map(f => { const q = sigToSetup(f.sig, ctx); return { x: q.c.x, y: q.c.y, z: q.c.z }; }); }
function holeOf(sig, ctx) {
  const q = sigToSetup(sig, ctx); if (!q.ax || Math.abs(q.ax.z) < 0.999) return null;
  const { G } = ctx, x = q.ap.x + q.ax.x * (q.c.z - q.ap.z) / (q.ax.z || 1), y = q.ap.y + q.ax.y * (q.c.z - q.ap.z) / (q.ax.z || 1);
  // top of the hole: highest material on a ring just outside it
  let top = -Infinity; for (let a = 0; a < 16; a++) { const t = a / 16 * 2 * Math.PI, rr = q.r + G.g * 1.5, i = Math.round((x + rr * Math.cos(t) - G.x0) / G.g), j = Math.round((y + rr * Math.sin(t) - G.y0) / G.g); if (i >= 0 && j >= 0 && i < G.nx && j < G.ny) top = Math.max(top, G.H[j * G.nx + i]); }
  if (!(top > -Infinity)) top = ctx.partTop;
  return { x, y, top, bottom: Math.max(ctx.partBottom, 2 * q.c.z - top), d: 2 * q.r };
}
function holesOf(op, ctx) { return (op.holes || []).map(hl => holeOf(hl.sig, ctx)).filter(Boolean); }
// every vertical (concave) hole in the setup's bodies, optionally of one diameter
function allHoles(s, ctx, d = null) {
  const out = [];
  for (const id of setupBodies(s)) {
    const b = result.bodies.get(id); if (!b.shape) continue;
    for (const [, sig] of brepSigMap(b, 'face')) {
      if (sig.type !== 'CYLINDRE' || !sig.ax) continue;
      const placed = placedSig(sig, id), q = sigToSetup(placed, ctx);
      if (Math.abs(q.ax.z) < 0.999) continue;
      const toAxis = new THREE.Vector3(q.ap.x - q.c.x, q.ap.y - q.c.y, 0);
      if (toAxis.lengthSq() > 1e-9 && q.n.dot(toAxis) < 0) continue;   // convex (a boss), not a hole
      if (d != null && Math.abs(2 * sig.r - d) > 0.05) continue;
      const hl = holeOf(placed, ctx); if (hl && !out.some(o => Math.hypot(o.x - hl.x, o.y - hl.y) < 0.01)) out.push({ ...hl, sig: placed });
    }
  }
  return out;
}
// signature in assembled (world) coordinates
function placedSig(sig, bodyId) {
  const M = bodyXf(bodyId); if (M === IDENT) return sig;
  const o = { ...sig, c: new THREE.Vector3(...sig.c).applyMatrix4(M).toArray(), n: new THREE.Vector3(...sig.n).transformDirection(M).toArray() };
  if (sig.ax) { o.ax = new THREE.Vector3(...sig.ax).transformDirection(M).toArray(); o.ap = new THREE.Vector3(...sig.ap).applyMatrix4(M).toArray(); }
  return o;
}

// ---- generation ----
function genOp(s, op) {
  const tool = camTool(op.tool); if (!tool) return { moves: [], warn: 'Choose a tool' };
  const ctx = camContext(s); if (!ctx) return { moves: [], warn: 'There is nothing to machine in this setup' };
  const key = JSON.stringify([op, tool]) + camCtxCache.key;
  const c = camCache.get(op.id); if (c?.key === key) return c.res;
  let res;
  try {
    const p = { ...op };
    if (op.type === 'pocket') p.floors = floorsOf(op, ctx);
    if (op.type === 'drill') p.holes = holesOf(op, ctx);
    const fn = { face: opFace, pocket: opPocket, contour: opContour, drill: opDrill, rough: opRough, parallel: opParallel, waterline: opWaterline }[op.type];
    res = fn(ctx, tool, p);
    if ((tool.type === 'drill') !== (op.type === 'drill')) res.warn = op.type === 'drill' ? 'Use a drill for drilling' : 'A drill cannot mill; choose an end mill';
    if (!res.warn && !res.moves.length) res.warn = 'No toolpath: nothing for this tool to cut here';
    res.stats = pathStats(expandCycles(res.moves, ctx.clear), tool);
  } catch (e) { console.error(e); res = { moves: [], warn: 'Could not compute: ' + e.message }; }
  camCache.set(op.id, { key, res });
  return res;
}
async function genAll(s = camSetup()) {
  if (!s) return;
  $('#busy').hidden = false; await new Promise(r => setTimeout(r, 20));
  try { for (const op of s.ops) if (!op.suppressed) genOp(s, op); } finally { $('#busy').hidden = true; }
  drawCam(); renderBrowser();
}

// ---- display ----
const camToModel = (ctx, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(ctx.Ri);
function drawCam() {
  clearGroup(camGroup);
  if (workspace !== 'manufacture' || activeTab === 'ADDITIVE') { requestRender(); return; }
  const s = camSetup(); if (!s) return;
  const ctx = camContext(s); if (!ctx) return;
  const st = ctx.stock, P = (x, y, z) => camToModel(ctx, x, y, z);
  // stock box
  const c = [[st.x0, st.y0], [st.x1, st.y0], [st.x1, st.y1], [st.x0, st.y1]];
  for (const z of [st.top, st.bottom]) camGroup.add(line(c.map(([x, y]) => P(x, y, z)), 0xd08a1e, { loop: true, opacity: 0.8 }));
  for (const [x, y] of c) camGroup.add(line([P(x, y, st.bottom), P(x, y, st.top)], 0xd08a1e, { opacity: 0.8 }));
  // WCS triad
  const O = originOf(s, ctx), o = P(...O), ax = (d, col) => camGroup.add(line([o, P(O[0] + d[0] * 12, O[1] + d[1] * 12, O[2] + d[2] * 12)], col, { depthTest: false, order: 9 }));
  ax([1, 0, 0], 0xd9534a); ax([0, 1, 0], 0x3faa5b); ax([0, 0, 1], 0x3a7bd5);
  // toolpaths
  for (const op of s.ops) {
    if (op.suppressed || op.hidden) continue;
    const res = camCache.get(op.id)?.res; if (!res) continue;
    const on = camSel === op.id || camSel == null, mv = expandCycles(res.moves, ctx.clear);
    const cut = [], rap = [], plunge = [];
    for (let i = 1; i < mv.length; i++) { const a = mv[i - 1], b = mv[i], arr = b[0] === 0 ? rap : b[0] === 2 ? plunge : cut; const A = P(a[1], a[2], a[3]), B = P(b[1], b[2], b[3]); arr.push(A.x, A.y, A.z, B.x, B.y, B.z); }
    const seg = (arr, col, op2) => { if (!arr.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); camGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op2 }))); };
    const k = camSim ? 0.12 : 1;   // faint while simulating, so the stock shows
    seg(cut, 0x2f6fd6, (on ? 0.95 : 0.25) * k); seg(plunge, 0x2ea44f, (on ? 0.95 : 0.25) * k); seg(rap, 0xe0a100, (on ? 0.6 : 0.15) * k);
  }
  if (camSim) drawSim();
  requestRender();
}

// ---- browser tree ----
function renderCamBrowser(add) {
  if (activeTab === 'ADDITIVE') {
    const o = prn(), pc = printCache;
    add(0, { icon: 'make', label: 'Print', sub: `${o.material} · ${o.layer} mm · ${o.infill}% infill`, onDbl: () => openPrintSetup(), onClick: () => openPrintSetup() });
    if (pc) { add(1, { icon: 'bodyi', label: 'Part', sub: pc.size.map(v => fmt(v)).join(' × ') + ' mm' }); add(1, { icon: 'start', label: 'Print time', sub: fmtMin(pc.stats.minutes) }); add(1, { icon: 'material', label: 'Filament', sub: fmt(pc.stats.filament / 1000) + ' m · ' + fmt(pc.stats.grams) + ' g' }); }
    return;
  }
  const C = cam();
  if (!add(0, { key: 'camroot', icon: 'make', label: 'Setups', sub: String(C.setups.length) })) return;
  for (const s of C.setups) {
    const sel = s.id === C.active;
    const open = add(1, { key: 'cs:' + s.id, icon: 'component', label: s.name, sub: s.axis + (sel ? ' · active' : ''), sel: sel && !camSel, onClick: () => { C.active = s.id; camSel = null; drawCam(); renderBrowser(); }, onDbl: () => editSetup(s.id),
      menu: () => [{ label: 'Edit Setup', icon: 'gear', action: () => editSetup(s.id) }, { label: 'Generate', icon: 'start', action: () => { C.active = s.id; genAll(s); } }, { label: 'Simulate', icon: 'motion', action: () => { C.active = s.id; startSim(); } }, { label: 'Post Process…', icon: 'exportstl', action: () => { C.active = s.id; openPostDialog(); } }, '-', { label: 'Delete Setup', icon: 'delete', action: () => { checkpoint(); C.setups = C.setups.filter(x => x !== s); C.active = C.setups[0]?.id || null; persist(); drawCam(); renderBrowser(); } }] });
    if (!expanded.has('cs:' + s.id) && open === false) expanded.add('cs:' + s.id);
    for (const op of s.ops) {
      const res = camCache.get(op.id)?.res, tool = camTool(op.tool);
      add(2, { icon: CAM_OPS[op.type]?.icon || 'make', label: op.name, sub: (tool ? 'T' + tool.num : 'no tool') + (res?.stats ? ' · ' + fmtMin(res.stats.minutes) : ''), sel: camSel === op.id, err: !!res?.warn, title: res?.warn || '', dim: op.suppressed,
        vis: !op.hidden, onVis: () => { op.hidden = !op.hidden; drawCam(); renderBrowser(); },
        onClick: () => { C.active = s.id; camSel = op.id; drawCam(); renderBrowser(); }, onDbl: () => editOp(op.id),
        menu: () => [{ label: 'Edit', icon: 'params', action: () => editOp(op.id) }, { label: op.suppressed ? 'Unsuppress' : 'Suppress', icon: 'eye', action: () => { checkpoint(); op.suppressed = !op.suppressed; persist(); drawCam(); renderBrowser(); } },
          { label: 'Move up', icon: 'chevron', action: () => { const i = s.ops.indexOf(op); if (i > 0) { checkpoint(); s.ops.splice(i, 1); s.ops.splice(i - 1, 0, op); persist(); renderBrowser(); } } },
          '-', { label: 'Delete', icon: 'delete', action: () => { checkpoint(); s.ops = s.ops.filter(x => x !== op); camCache.delete(op.id); persist(); drawCam(); renderBrowser(); } }] });
    }
  }
  const tot = camSetup()?.ops.reduce((a, o) => a + (camCache.get(o.id)?.res?.stats?.minutes || 0), 0) || 0;
  if (tot) add(0, { icon: 'start', label: 'Machining time', sub: fmtMin(tot) });
}
const fmtMin = m => m < 1 ? Math.round(m * 60) + ' s' : m < 60 ? Math.floor(m) + ' min ' + Math.round((m % 1) * 60) + ' s' : Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min';

// ---- setup dialog ----
function newSetup(silent) {
  const C = cam(), s = { id: uid(), name: 'Setup ' + (C.setups.length + 1), axis: '+Z', stock: { xy: 2, top: 1, bottom: 0 }, origin: 'corner', wcs: 'G54', program: 1000 + C.setups.length + 1, post: 'fanuc', coolant: true, bodies: null, ops: [] };
  C.setups.push(s); C.active = s.id; persist();
  if (!silent) editSetup(s.id, true);
}
function editSetup(id, isNew = false) {
  const s = cam().setups.find(x => x.id === id); if (!s) return;
  const snap = JSON.stringify(doc.cam), live = () => { camCtxCache = null; drawCam(); };
  openPanelDialog({ title: isNew ? 'New Setup' : 'Setup', icon: 'component', okLabel: 'OK', help: 'The tool comes down along the chosen axis. Stock is a box around the bodies with the given extra material.',
    body: () => [
      section_('Setup', row('Name', (() => { const i = h('input', { type: 'text', id: 'cs-name', value: s.name }); i.addEventListener('input', () => { s.name = i.value; renderBrowser(); }); i.addEventListener('keydown', e => e.stopPropagation()); return i; })(), 'cs-name'),
        selField('Tool axis (machine from)', s, 'axis', [['+Z', 'Top (+Z)'], ['-Z', 'Bottom (−Z)'], ['+Y', 'Back (+Y)'], ['-Y', 'Front (−Y)'], ['+X', 'Right (+X)'], ['-X', 'Left (−X)']], { after: live })),
      section_('Stock', exField('Side offset', s.stock, 'xy', 'mm', { min: 0, after: live, id: 'cs-xy' }), exField('Top offset', s.stock, 'top', 'mm', { min: 0, after: live, id: 'cs-top' }), exField('Bottom offset', s.stock, 'bottom', 'mm', { min: 0, after: live, id: 'cs-bottom' })),
      section_('Work origin', segField('Origin', s, 'origin', [['corner', 'Stock top corner'], ['center', 'Stock top centre'], ['model', 'Model origin']], { after: live }),
        selField('Work offset', s, 'wcs', ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(w => [w, w]))),
      section_('Bodies', ...[...result.bodies.keys()].filter(bid => !isSurfBody(bid)).map(bid => { const cb = h('input', { type: 'checkbox', id: 'cb-' + bid, checked: !s.bodies || s.bodies.includes(bid) }); cb.addEventListener('change', () => { const all = [...result.bodies.keys()].filter(x => !isSurfBody(x)); let cur = s.bodies || all; cur = cb.checked ? [...new Set([...cur, bid])] : cur.filter(x => x !== bid); s.bodies = cur.length === all.length ? null : cur; live(); }); return h('label', { class: 'chk', for: cb.id }, cb, bodyName(bid)); })),
    ],
    onOK: () => { const now = JSON.stringify(doc.cam); doc.cam = JSON.parse(snap); checkpoint(); doc.cam = JSON.parse(now); persist(); camCtxCache = null; camCache.clear(); genAll(); },
    onCancel: () => { doc.cam = JSON.parse(snap); if (isNew) { const C = cam(); C.setups = C.setups.filter(x => x.id !== id); C.active = C.setups[0]?.id || null; } camCtxCache = null; drawCam(); renderBrowser(); },
  });
  drawCam(); renderBrowser();
}

// ---- operations ----
let camPick = null, camPickOp = null;
function newOp(type) {
  const s = camSetup(); if (!s) { newSetup(); return; }
  const D = CAM_OPS[type], tools = cam().tools;
  const tool = (type === 'face' ? tools.find(t => t.type === 'face') || tools.find(t => t.type === 'flat') : tools.filter(t => t.type === D.tool).sort((a, b) => b.d - a.d)[type === 'parallel' || type === 'waterline' ? tools.filter(t => t.type === D.tool).length - 1 : 0]) || tools.find(t => t.type !== 'drill');
  const op = { id: uid(), type, name: D.label.replace(/ \(.*\)/, '') + ' ' + (s.ops.filter(o => o.type === type).length + 1), tool: tool?.id, ...JSON.parse(JSON.stringify(D.defaults)) };
  if (type === 'drill') {
    const ctx = camContext(s), drills = tools.filter(t => t.type === 'drill');
    const holes = ctx ? allHoles(s, ctx) : [];
    if (holes.length) {
      // the drill that matches the most holes
      const best = drills.map(t => [t, holes.filter(hl => Math.abs(hl.d - t.d) < 0.3).length]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1]) { op.tool = best[0].id; op.holes = holes.filter(hl => Math.abs(hl.d - best[0].d) < 0.3).map(hl => ({ sig: hl.sig })); }
    }
  }
  const snap = JSON.stringify(doc.cam); checkpoint();
  s.ops.push(op); persist();
  editOp(op.id, snap, true);
}
function editOp(id, snap = JSON.stringify(doc.cam), isNew = false) {
  const f = opById(id); if (!f) return; const { setup: s, op } = f;
  camSel = op.id;
  let timer = 0;
  const regen = () => { clearTimeout(timer); timer = setTimeout(() => { genOp(s, op); drawCam(); renderBrowser(); if (dlg?.custom?.camOp === op.id) { const st = $('#cam-stats'); if (st) st.replaceWith(statsEl()); } }, 250); };
  const statsEl = () => { const r = camCache.get(op.id)?.res; return h('div', { id: 'cam-stats', class: 'note' + (r?.warn ? ' bad' : '') }, r ? (r.warn || `${fmtMin(r.stats.minutes)} · cutting ${fmt(r.stats.cut / 1000)} m · rapids ${fmt(r.stats.rapid / 1000)} m`) : 'Computing…'); };
  const toolOpts = () => cam().tools.filter(t => op.type === 'drill' ? t.type === 'drill' : t.type !== 'drill').map(t => [t.id, `T${t.num} ${t.name}`]);
  const T = () => camTool(op.tool);
  const body = () => {
    const out = [section_('Tool', selField('Tool', op, 'tool', toolOpts(), { rerender: true, after: regen }), h('p', { class: 'note' }, T() ? `Ø${fmt(T().d)} ${T().type} · ${T().rpm} rpm · feed ${T().feed} mm/min · plunge ${T().plunge} mm/min` : 'Add tools in the tool library'))];
    const e = (label, key, unit = 'mm', o = {}) => exField(label, op, key, unit, { after: regen, id: 'co-' + key, ...o });
    switch (op.type) {
      case 'face': out.push(section_('Passes', e('Stepover (× tool Ø)', 'stepover', '', { min: 0.05, max: 1 }), e('Stepdown', 'stepdown', 'mm', { min: 0.01 }), e('Leave on top', 'leaveAxial'))); break;
      case 'pocket': {
        const n = (op.floors || []).length;
        out.push(section_('Geometry', h('p', { class: 'note' }, n ? `${n} pocket floor${n > 1 ? 's' : ''} picked. Click floors on the model to add or remove.` : 'Click the flat floor of the pocket on the model.')),
          section_('Passes', e('Stepover (× tool Ø)', 'stepover', '', { min: 0.05, max: 0.95 }), e('Stepdown', 'stepdown', 'mm', { min: 0.01 }), e('Leave on walls', 'leaveRadial'), e('Leave on floor', 'leaveAxial'), segField('Direction', op, 'direction', [['climb', 'Climb'], ['conventional', 'Conventional']], { after: regen })));
        break;
      }
      case 'contour':
        out.push(section_('Geometry', segField('Side', op, 'side', [['outside', 'Outside'], ['inside', 'Inside'], ['all', 'Both']], { after: regen }), e('Bottom height (blank = part bottom)', 'bottom', 'mm')),
          section_('Passes', chkField('Multiple depths', op, 'multiDepth', { after: regen }), e('Stepdown', 'stepdown', 'mm', { min: 0.01 }), e('Leave on walls', 'leaveRadial'), segField('Direction', op, 'direction', [['climb', 'Climb'], ['conventional', 'Conventional']], { after: regen })));
        break;
      case 'drill': {
        const n = (op.holes || []).length;
        out.push(section_('Holes', h('p', { class: 'note' }, n ? `${n} hole${n > 1 ? 's' : ''} selected. Click holes on the model to add or remove.` : 'Click holes on the model.'),
          h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => { const ctx = camContext(s); if (!ctx || !T()) return; checkpoint(); op.holes = allHoles(s, ctx, T().d).map(hl => ({ sig: hl.sig })); if (!op.holes.length) toast(`No Ø${fmt(T().d)} holes found`); rerenderDialog(); regen(); } }, 'Select all holes of the tool size'))),
          section_('Cycle', e('Peck depth (0 = no peck)', 'peck', 'mm', { min: 0 }), e('Dwell', 'dwell', 's', { min: 0 }), e('Retract height above hole', 'retract'), chkField('Drill through (tip breaks out)', op, 'through', { after: regen }), e('Breakthrough', 'breakthrough')));
        break;
      }
      case 'rough':
        out.push(section_('Passes', e('Stepover (× tool Ø)', 'stepover', '', { min: 0.05, max: 0.95 }), e('Stepdown', 'stepdown', 'mm', { min: 0.01 }), e('Leave radial', 'leaveRadial'), e('Leave axial', 'leaveAxial'), e('Lowest height (blank = part bottom)', 'bottom'),
          segField('Direction', op, 'direction', [['climb', 'Climb'], ['conventional', 'Conventional']], { after: regen }), h('p', { class: 'note' }, 'Z-level offset clearing of all stock around the part, inside-out at each level.')));
        break;
      case 'parallel':
        out.push(section_('Passes', e('Stepover (× tool Ø)', 'stepover', '', { min: 0.01, max: 0.9 }), e('Pass angle', 'angle', '°'), e('Leave on surface', 'leaveRadial'), e('Leave in Z', 'leaveAxial'), h('p', { class: 'note' }, 'Raster passes that follow the surface; best with a ball end mill on gentle slopes.')));
        break;
      case 'waterline':
        out.push(section_('Passes', e('Stepdown', 'stepdown', 'mm', { min: 0.01 }), e('Top (blank = part top)', 'top'), e('Bottom (blank = part bottom)', 'bottom'), e('Leave on surface', 'leaveRadial'), segField('Direction', op, 'direction', [['climb', 'Climb'], ['conventional', 'Conventional']], { after: regen }), h('p', { class: 'note' }, 'Constant-Z contours; best on steep walls.')));
        break;
    }
    out.push(section_('Result', statsEl(), row('Name', (() => { const i = h('input', { type: 'text', id: 'co-name', value: op.name }); i.addEventListener('input', () => { op.name = i.value; renderBrowser(); }); i.addEventListener('keydown', ev => ev.stopPropagation()); return i; })(), 'co-name')));
    return out;
  };
  camPick = op.type === 'pocket' ? 'floor' : op.type === 'drill' ? 'hole' : null; camPickOp = op.id;
  openPanelDialog({ title: CAM_OPS[op.type].label, icon: CAM_OPS[op.type].icon, okLabel: 'OK', camOp: op.id, body,
    help: 'Changes update the toolpath preview. Blue = cutting, green = plunging, yellow = rapid moves.',
    onOK: () => { camPick = null; const now = JSON.stringify(doc.cam); doc.cam = JSON.parse(snap); if (!isNew) checkpoint(); doc.cam = JSON.parse(now); persist(); genAll(); defaultHint(); },
    onCancel: () => { camPick = null; doc.cam = JSON.parse(snap); camCache.delete(op.id); if (isNew) camSel = null; drawCam(); renderBrowser(); defaultHint(); },
  });
  defaultHint(); regen();
}
// clicks on the model while an operation dialog that picks geometry is open
function camPickAt(e) {
  if (workspace !== 'manufacture' || !camPick) return false;
  const f = opById(camPickOp); if (!f) return false;
  const hit = brepFaceHit(e); if (!hit?.sig) return true;
  const { setup: s, op } = f, ctx = camContext(s), sig = placedSig(hit.sig, hit.body), q = sigToSetup(sig, ctx);
  const list = camPick === 'floor' ? (op.floors ||= []) : (op.holes ||= []);
  if (camPick === 'floor' && !(sig.type === 'PLANE' && q.n.z > 0.999)) { toast('Click a flat floor facing the tool'); return true; }
  if (camPick === 'hole' && !(sig.type === 'CYLINDRE' && q.ax && Math.abs(q.ax.z) > 0.999)) { toast('Click the wall of a hole that runs along the tool axis'); return true; }
  const same = x => Math.hypot(x.sig.c[0] - sig.c[0], x.sig.c[1] - sig.c[1], x.sig.c[2] - sig.c[2]) < 1e-3;
  const i = list.findIndex(same);
  if (i >= 0) list.splice(i, 1); else list.push({ sig });
  rerenderDialog(); clearTimeout(camPickAt.t); camPickAt.t = setTimeout(() => { genOp(s, op); drawCam(); renderBrowser(); const st = $('#cam-stats'); if (st) { const r = camCache.get(op.id)?.res; st.textContent = r?.warn || (r ? `${fmtMin(r.stats.minutes)} · cutting ${fmt(r.stats.cut / 1000)} m` : ''); } }, 150);
  return true;
}

// ---- tool library ----
function openToolLibrary() {
  const C = cam(), work = JSON.parse(JSON.stringify(C.tools)), tbody = h('tbody');
  const draw = () => {
    tbody.replaceChildren(...work.map((t, i) => {
      const inp = (k, w = 60, num = true) => { const e = h('input', { value: t[k] ?? '', style: `width:${w}px`, 'aria-label': k + ' of tool ' + t.num, spellcheck: 'false' }); e.addEventListener('change', () => { t[k] = num ? +e.value : e.value; }); e.addEventListener('keydown', ev => ev.stopPropagation()); return e; };
      const ty = h('select', { 'aria-label': 'Type' }, ...[['flat', 'Flat end mill'], ['ball', 'Ball end mill'], ['drill', 'Drill'], ['face', 'Face mill']].map(([v, l]) => h('option', { value: v, selected: t.type === v }, l)));
      ty.addEventListener('change', () => { t.type = ty.value; });
      return h('tr', {}, h('td', {}, inp('num', 40)), h('td', {}, inp('name', 150, false)), h('td', {}, ty), h('td', {}, inp('d', 50)), h('td', {}, inp('flutes', 40)), h('td', {}, inp('rpm', 64)), h('td', {}, inp('feed', 60)), h('td', {}, inp('plunge', 60)),
        h('td', {}, h('button', { class: 'iconbtn', 'aria-label': 'Delete tool ' + t.num, onclick: () => { work.splice(i, 1); draw(); }, html: icon('delete') })));
    }));
  };
  draw();
  const body = h('div', { class: 'tablewrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['T', 'Name', 'Type', 'Ø mm', 'Flutes', 'rpm', 'Feed', 'Plunge', ''].map(x => h('th', {}, x)))), tbody),
    h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => { const n = Math.max(0, ...work.map(t => +t.num || 0)) + 1; work.push({ id: uid(), num: n, name: 'Ø6 flat end mill', type: 'flat', d: 6, flutes: 3, rpm: 12000, feed: 1100, plunge: 300 }); draw(); } }, '+ Tool'),
    h('p', { class: 'note' }, 'Feeds are mm/min. Tool numbers are the T numbers in the G-code.'));
  openModal('Tool Library', 'make', body, [
    h('button', { class: 'btn ok', onclick: () => { document.activeElement?.blur?.(); checkpoint(); C.tools = work; persist(); closeModal(); camCache.clear(); genAll(); } }, 'OK'),
    h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}

// ---- simulation ----
function setupProgram(s) {
  const ctx = camContext(s); if (!ctx) return null;
  const ops = [];
  for (const op of s.ops) { if (op.suppressed) continue; const r = genOp(s, op), tool = camTool(op.tool); if (tool && r.moves.length) ops.push({ name: op.name, tool, moves: r.moves, stats: r.stats }); }
  return { ctx, ops };
}
function startSim() {
  const s = camSetup(); if (!s) return;
  const pr = setupProgram(s); if (!pr?.ops.length) { toast('Nothing to simulate: add operations first'); return; }
  const flat = []; pr.ops.forEach((o, oi) => { for (const m of expandCycles(o.moves, pr.ctx.clear)) flat.push([...m, oi]); });
  camSim = { s, ctx: pr.ctx, ops: pr.ops, moves: flat, at: 0, done: 0, S: simStock(pr.ctx.G, pr.ctx.stock), playing: false, speed: 1, crashes: 0 };
  // display stock as a coarse height field
  const G = pr.ctx.G, step = Math.max(1, Math.ceil(Math.sqrt(G.nx * G.ny / 160000)));
  camSim.step = step; camSim.mx = Math.ceil(G.nx / step); camSim.my = Math.ceil(G.ny / step);
  openSimPanel(); drawCam();
}
function simAdvance(to) {
  const S = camSim; to = Math.max(0, Math.min(S.moves.length, Math.round(to)));
  if (to < S.done) { S.S = simStock(S.ctx.G, S.ctx.stock); S.done = 0; S.crashes = 0; }
  // run each operation's slice with its own tool
  let a = S.done;
  while (a < to) {
    const oi = S.moves[Math.max(0, a)][4]; let b = a; while (b < to && S.moves[b][4] === oi) b++;
    S.crashes += simulate(S.ctx.G, S.S, S.moves, S.ops[oi].tool, Math.max(1, a), Math.max(1, b) + (b === to ? 0 : 0));
    a = b;
  }
  S.done = to; S.at = to;
}
function drawSim() {
  const S = camSim; if (!S) return;
  const { G, Ri } = S.ctx, st = S.step, mx = S.mx, my = S.my, pos = new Float32Array(mx * my * 3), col = new Float32Array(mx * my * 3), v = new THREE.Vector3();
  const floor = S.ctx.stock.bottom;
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const gi = Math.min(G.nx - 1, i * st), gj = Math.min(G.ny - 1, j * st), k = gj * G.nx + gi, z = S.S[k], h = G.H[k], n = (j * mx + i) * 3;
    v.set(G.x0 + gi * G.g, G.y0 + gj * G.g, z === -Infinity ? floor - 0.01 : z).applyMatrix4(Ri); pos[n] = v.x; pos[n + 1] = v.y; pos[n + 2] = v.z;
    let r = 0.78, g2 = 0.66, b = 0.42;   // raw stock
    if (z === -Infinity) { r = g2 = b = 0.5; }
    else if (h > -Infinity && z < h - 0.02) { r = 0.9; g2 = 0.15; b = 0.15; }          // gouge
    else if (h > -Infinity && z - h < 0.05) { r = 0.35; g2 = 0.72; b = 0.38; }        // at the finished surface
    else if (z < S.ctx.stock.top - 1e-3) { r = 0.55; g2 = 0.65; b = 0.8; }            // cut, stock left
    col[n] = r; col[n + 1] = g2; col[n + 2] = b;
  }
  const empty = new Uint8Array(mx * my); for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) { const gi = Math.min(G.nx - 1, i * st), gj = Math.min(G.ny - 1, j * st); empty[j * mx + i] = S.S[gj * G.nx + gi] === -Infinity ? 1 : 0; }
  const idx = []; for (let j = 0; j < my - 1; j++) for (let i = 0; i < mx - 1; i++) { const a = j * mx + i, b = a + 1, c = a + mx, d = c + 1; if (empty[a] + empty[b] + empty[c] + empty[d] > 1) continue; idx.push(a, b, d, a, d, c); }   // no sheet where there is no stock
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide })); m.name = 'simstock'; camGroup.add(m);
  // tool at the current move
  const cur = S.moves[Math.max(0, Math.min(S.moves.length - 1, S.at - 1))]; if (!cur) return;
  const tool = S.ops[cur[4]].tool, R = tool.d / 2, L = Math.max(20, tool.d * 3);
  const tg = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0xc0c6cc, metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24), mat); body.rotation.x = Math.PI / 2; body.position.z = L / 2 + (tool.type === 'ball' ? R : 0); tg.add(body);
  if (tool.type === 'ball') { const sph = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 12), mat); sph.position.z = R; tg.add(sph); }
  if (tool.type === 'drill') { const cone = new THREE.Mesh(new THREE.ConeGeometry(R, R / Math.tan(((tool.tipAngle || 118) / 2) * Math.PI / 180), 24), mat); cone.rotation.x = -Math.PI / 2; cone.position.z = 0; tg.add(cone); }
  tg.matrixAutoUpdate = false; tg.matrix.copy(Ri.clone().multiply(new THREE.Matrix4().makeTranslation(cur[1], cur[2], cur[3]))); camGroup.add(tg);
  const holder = $('#sim-info');
  if (holder) { const c = compareStock(S.ctx.G, S.S, 0.02); holder.textContent = `${S.ops[cur[4]].name} · T${tool.num} · move ${S.at} / ${S.moves.length}` + (c.gougeCells ? ` · ⚠ gouge ${fmt(c.gougeDepth)} mm` : '') + (S.crashes ? ` · ⚠ ${S.crashes} rapid hits` : '') + (S.at >= S.moves.length ? ` · stock left max ${fmt(c.maxLeft)} mm` : ''); }
}
function openSimPanel() {
  const S = camSim, total = S.moves.length;
  const slider = h('input', { type: 'range', id: 'sim-slider', min: 0, max: total, value: 0, step: 1, style: 'width:100%' });
  slider.addEventListener('input', () => { pause(); simAdvance(+slider.value); drawCam(); });
  let raf = 0;
  const pause = () => { S.playing = false; cancelAnimationFrame(raf); playBtn.textContent = 'Play'; };
  const tick = () => {
    if (!camSim || !S.playing) return;
    const per = Math.max(1, Math.round(total / 400 * S.speed));
    simAdvance(S.at + per); slider.value = S.at; drawCam();
    if (S.at >= total) { pause(); return; }
    raf = requestAnimationFrame(tick);
  };
  const playBtn = h('button', { class: 'btn', id: 'sim-play', onclick: () => { if (S.playing) pause(); else { if (S.at >= total) { simAdvance(0); } S.playing = true; playBtn.textContent = 'Pause'; tick(); } } }, 'Play');
  const endBtn = h('button', { class: 'btn', id: 'sim-end', onclick: () => { pause(); simAdvance(total); slider.value = total; drawCam(); } }, 'To end');
  const speed = h('select', { 'aria-label': 'Speed' }, ...[0.5, 1, 2, 4, 8].map(v => h('option', { value: v, selected: v === 1 }, v + '×'))); speed.addEventListener('change', () => { S.speed = +speed.value; });
  const tot = S.ops.reduce((a, o) => a + (o.stats?.minutes || 0), 0);
  openPanelDialog({ title: 'Simulation', icon: 'motion', okLabel: 'Close',
    help: 'Green: finished surface. Blue: cut, stock left. Tan: untouched stock. Red: gouge into the part.',
    body: () => [section_(null, slider, h('div', { class: 'row', style: 'gap:6px' }, playBtn, endBtn, speed), h('p', { class: 'note', id: 'sim-info' }, 'Press Play'),
      h('p', { class: 'note' }, `${S.ops.length} operation${S.ops.length > 1 ? 's' : ''} · estimated ${fmtMin(tot)}`))],
    onOK: () => { pause(); stopSim(); }, onCancel: () => { pause(); stopSim(); } });
  for (const [, sb] of shownBodies) { sb.mesh.material.transparent = true; sb.mesh.material.opacity = 0.25; }
}
function stopSim() {
  if (!camSim) return; camSim = null;
  for (const [, sb] of shownBodies) { sb.mesh.material.transparent = false; sb.mesh.material.opacity = 1; }
  drawCam();
}

// ---- post processing ----
function openPostDialog() {
  const s = camSetup(); if (!s) return;
  const pr = setupProgram(s); if (!pr?.ops.length) { toast('Nothing to post: add operations first'); return; }
  const o = { post: s.post || 'fanuc', program: s.program || 1001, wcs: s.wcs || 'G54', coolant: s.coolant !== false };
  const preview = h('pre', { id: 'post-preview', class: 'gcode' });
  const make = () => postProcess({ name: (doc.name || 'Part') + ' - ' + s.name, program: +o.program, wcs: o.wcs, clear: pr.ctx.clear, origin: originOf(s, pr.ctx), coolant: o.coolant, ops: pr.ops }, o.post);
  const upd = () => { const g = make(), lines = g.split('\n'); preview.textContent = lines.slice(0, 40).join('\n') + (lines.length > 40 ? `\n… ${lines.length - 40} more lines` : ''); };
  const sel = h('select', { id: 'post-sel' }, ...Object.entries(POSTS).map(([k, p]) => h('option', { value: k, selected: k === o.post }, p.label))); sel.addEventListener('change', () => { o.post = sel.value; upd(); });
  const prog = h('input', { id: 'post-prog', value: o.program, style: 'width:80px' }); prog.addEventListener('change', () => { o.program = +prog.value || 1001; upd(); }); prog.addEventListener('keydown', e => e.stopPropagation());
  const cool = h('input', { type: 'checkbox', id: 'post-cool', checked: o.coolant }); cool.addEventListener('change', () => { o.coolant = cool.checked; upd(); });
  upd();
  const sheet = () => setupSheet(s, pr);
  openModal('Post Process', 'exportstl', h('div', { class: 'tablewrap' },
    h('div', { class: 'row' }, h('label', { class: 'rl', for: 'post-sel' }, 'Machine'), sel), h('div', { class: 'row' }, h('label', { class: 'rl', for: 'post-prog' }, 'Program number'), prog),
    h('label', { class: 'chk', for: 'post-cool' }, cool, 'Coolant on (M8)'), preview,
    h('p', { class: 'note' }, 'Check the program in your controller or a G-code viewer before cutting metal. Work origin: ' + ({ corner: 'stock top corner', center: 'stock top centre', model: 'model origin' }[s.origin || 'corner']) + ', ' + o.wcs + '.')),
    [h('button', { class: 'btn ok', onclick: () => { checkpoint(); Object.assign(s, { post: o.post, program: o.program, coolant: o.coolant }); persist(); const base = slug() + '-' + s.name.replace(/\W+/g, '_'); saveFile(base + '.zip', makeZip([{ name: base + '.' + POSTS[o.post].ext, data: make() }, { name: base + '-setup-sheet.html', data: sheet() }]), 'application/zip'); closeModal(); } }, 'Save G-code (.zip)'),
      h('button', { class: 'btn', onclick: closeModal }, 'Close')]);
}
function setupSheet(s, pr) {
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'), st = pr.ctx.stock, O = originOf(s, pr.ctx);
  const tools = [...new Map(pr.ops.map(o => [o.tool.num, o.tool])).values()].sort((a, b) => a.num - b.num);
  const tot = pr.ops.reduce((a, o) => a + (o.stats?.minutes || 0), 0);
  return `<!doctype html><meta charset="utf-8"><title>${esc(doc.name)} – ${esc(s.name)}</title><style>body{font:13px system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #bbb;padding:4px 8px;text-align:left}th{background:#eee}</style>
<h1>${esc(doc.name)} — ${esc(s.name)}</h1><p>Tool axis ${esc(s.axis)} · work offset ${esc(s.wcs || 'G54')} at ${esc({ corner: 'stock top corner', center: 'stock top centre', model: 'model origin' }[s.origin || 'corner'])} (${O.map(v => v.toFixed(2)).join(', ')} in the setup frame)</p>
<h2>Stock</h2><p>${(st.x1 - st.x0).toFixed(2)} × ${(st.y1 - st.y0).toFixed(2)} × ${(st.top - st.bottom).toFixed(2)} mm</p>
<h2>Tools</h2><table><tr><th>T</th><th>Name</th><th>Type</th><th>Ø</th><th>rpm</th><th>Feed</th><th>Plunge</th></tr>${tools.map(t => `<tr><td>${t.num}</td><td>${esc(t.name)}</td><td>${t.type}</td><td>${t.d}</td><td>${t.rpm}</td><td>${t.feed}</td><td>${t.plunge}</td></tr>`).join('')}</table>
<h2>Operations</h2><table><tr><th>#</th><th>Operation</th><th>Tool</th><th>Cutting length</th><th>Time</th></tr>${pr.ops.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.name)}</td><td>T${o.tool.num}</td><td>${(o.stats.cut / 1000).toFixed(2)} m</td><td>${esc(fmtMin(o.stats.minutes))}</td></tr>`).join('')}</table>
<p>Estimated machining time: <b>${esc(fmtMin(tot))}</b> (rapids at 5 m/min, no tool change time).</p>`;
}

// ribbon commands (registered here: this module loads after the ribbon)
cmd('cam.setup', 'New Setup', 'component', { run: () => newSetup() }); cmd('cam.tools', 'Tool Library', 'make', { run: () => openToolLibrary() });
for (const [k, d] of Object.entries(CAM_OPS)) cmd('cam.' + k, d.label, d.icon, { run: () => newOp(k) });
cmd('cam.generate', 'Generate Toolpaths', 'start', { run: () => genAll() }); cmd('cam.simulate', 'Simulate', 'motion', { run: () => startSim() }); cmd('cam.post', 'Post Process', 'exportstl', { run: () => openPostDialog() });
