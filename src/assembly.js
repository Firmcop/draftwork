// Components and joints (assembly layer).
// A component groups bodies; bodies outside any component belong to the fixed root. A joint ties a joint origin on
// one component (the one that moves, picked first) to an origin on another, with a motion type and values.
// Joints are solved after every rebuild into one transform per component; display, mass properties and export use
// those transforms, while modeling features keep working in each body's as-modeled position.
const IDENT = new THREE.Matrix4();
const JOINT_TYPES = {
  rigid: { label: 'Rigid', dofs: [] },
  revolute: { label: 'Revolute', dofs: ['angle'] },
  slider: { label: 'Slider', dofs: ['distance'] },
  cylindrical: { label: 'Cylindrical', dofs: ['angle', 'distance'] },
  planar: { label: 'Planar', dofs: ['x', 'y', 'angle'] },
  ball: { label: 'Ball', dofs: ['angle', 'pitch', 'roll'] },
};
const DOF_UNITS = { angle: '°', distance: 'mm', x: 'mm', y: 'mm', pitch: '°', roll: '°' };
const DOF_LABEL = { angle: 'Angle', distance: 'Distance', x: 'X', y: 'Y', pitch: 'Pitch', roll: 'Roll' };
const isAngK = k => k === 'angle' || k === 'pitch' || k === 'roll';
const DEFAULT_LIMIT = { angle: { min: -90, max: 90 }, distance: { min: 0, max: 20 }, x: { min: -20, max: 20 }, y: { min: -20, max: 20 }, pitch: { min: -45, max: 45 }, roll: { min: -45, max: 45 } };
let compXf = new Map();            // component id -> Matrix4 (as-modeled -> assembled)
let jointStatus = new Map();       // joint id -> { state: 'ok' | 'warn' | 'error', msg }
let jointPreview = null;           // { id, values } while animating, without touching the document
let jointEdit = null;              // open joint dialog: { id, stage: 'a' | 'b' | null }
let jointAnim = null;

const comps = () => doc.components || (doc.components = []);
const joints = () => doc.joints || (doc.joints = []);
const compById = id => comps().find(c => c.id === id) || null;
function compOfBody(bid) { return comps().find(c => c.bodies.includes(bid)) || null; }
const groups = () => doc.rigidGroups || (doc.rigidGroups = []);
const groupOfComp = cid => groups().find(g => g.comps.includes(cid)) || null;
// solver node of a component: a rigid group moves as one node
const keyOfComp = c => { const g = groupOfComp(c.id); return g ? 'g:' + g.id : c.id; };
const compKey = bid => { const c = compOfBody(bid); return c ? keyOfComp(c) : 'root'; };
let keyXf = new Map();             // solver node -> Matrix4
const fixedKey = k => k === 'root' || comps().some(c => c.grounded && keyOfComp(c) === k);
function bodyXf(bid) { const c = bid && compOfBody(bid); return (c && compXf.get(c.id)) || IDENT; }
function compLabel(key) { return key === 'root' ? 'the fixed bodies' : key.startsWith('g:') ? 'rigid group ' + (groups().find(g => 'g:' + g.id === key)?.name || '') : compById(key)?.name || 'a component'; }

// Joint values: the solver's working values, then an animation/drag preview, then values a loop solve moved
// (kept only while the document values they started from are unchanged), then the document. Limits clamp.
let jointLive = new Map();         // joint id -> { base, values }
let iterVals = null;               // loop solve in progress: joint id -> values
const docKey = j => JSON.stringify([j.type, ...JOINT_TYPES[j.type].dofs.map(k => j[k])]);
function rawVal(j, k) {
  if (doc.motionLinks?.length && isFollower(j.id, k)) { const lv = linkedVal(j, k); if (lv != null) return lv; }
  if (iterVals?.has(j.id) && k in iterVals.get(j.id)) return iterVals.get(j.id)[k];
  if (jointPreview?.id === j.id && k in jointPreview.values) return jointPreview.values[k];
  const l = jointLive.get(j.id); if (l && l.base === docKey(j) && k in l.values) return l.values[k];
  const v = j[k];
  if (v == null || v === '') return 0;
  let n; try { n = typeof v === 'string' ? evalExpr(v, params.vars) : +v; } catch (e) { n = 0; }
  return Number.isFinite(n) ? n : 0;
}
const limitOf = (j, k) => { const L = j.limits?.[k]; return L?.on ? [Math.min(+L.min, +L.max), Math.max(+L.min, +L.max)] : null; };
function clampVal(j, k, v) { const L = limitOf(j, k); return L ? Math.min(L[1], Math.max(L[0], v)) : v; }
function jval(j, k) { const v = rawVal(j, k); return k === 'offset' ? v : clampVal(j, k, v); }
// Joint origin frame (as-modeled coordinates) from a face or circular-edge signature: z along the normal / axis.
function frameFromSig(sig, kind) {
  const o = new THREE.Vector3(...(kind === 'edge' ? sig.cc : sig.c)), z = new THREE.Vector3(...(kind === 'edge' ? sig.ax : sig.n)).normalize();
  const a = Math.abs(z.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const x = a.sub(z.clone().multiplyScalar(a.dot(z))).normalize(), y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}
// Re-find the picked face/edge on the rebuilt body (same signature matching as fillets), then build its frame.
function endFrame(end) {
  if (!end) return null;
  if (end.kind === 'cons') return consFrame(end.cons);
  const rec = result.bodies.get(end.body); if (!rec) return null;
  if (end.kind === 'frame') return new THREE.Matrix4().fromArray(end.frame);
  if (end.kind === 'ref') {
    // vertex, edge midpoint, circle centre, axis, face centre (asmref.js), re-found on the rebuilt body
    let r = { p: end.ref.p, z: end.ref.z, x: end.ref.x };
    if (rec.shape && end.ref.type !== 'origin') { r = resolveRef(end.ref, [...brepSigMap(rec, 'edge').values()], [...brepSigMap(rec, 'face').values()]); if (!r) return null; }
    const F = refFrame(r.p, r.z, r.x);
    return new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.x), new THREE.Vector3(...F.y), new THREE.Vector3(...F.z)).setPosition(...F.o);
  }
  let sig = end.sig;
  if (rec.shape) { sig = rematchEnd(rec, end); if (!sig) return null; }
  return frameFromSig(sig, end.kind);
}
// Construction planes, axes and points as joint origins (they belong to the fixed root): re-read from the model each time.
const JOINT_AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
function consFrame(c) {
  const basis = (o, z, x) => { const F = refFrame(o, z, x); return new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.x), new THREE.Vector3(...F.y), new THREE.Vector3(...F.z)).setPosition(...F.o); };
  if (c.type === 'cplane') {
    if (!PLANES[c.id] && !result.planes?.has?.(c.id)) return null;
    const M = PLANES[c.id] ? planeMatrix(c.id, 0) : planeMatrixOf(c.id), o = new THREE.Vector3(c.local[0], c.local[1], 0).applyMatrix4(M);
    const z = new THREE.Vector3(0, 0, 1).transformDirection(M), x = new THREE.Vector3(1, 0, 0).transformDirection(M);
    return basis(o.toArray(), z.toArray(), x.toArray());
  }
  if (c.type === 'caxis') {
    const a = JOINT_AXES[c.id] ? { o: [0, 0, 0], d: JOINT_AXES[c.id] } : result.axes?.get(c.id); if (!a) return null;
    return basis(a.o.map((v, i) => v + a.d[i] * c.t), a.d);
  }
  if (c.type === 'cpoint') { const pt = result.points?.get(c.id); return pt ? basis(pt.p, [0, 0, 1]) : null; }
  return null;
}
// Joint origins follow their face or edge through bigger changes than fillet picks: same kind and direction,
// similar size, then the nearest one (a plate made thicker keeps its pin on the top face).
function rematchEnd(rec, end) {
  const m = brepSigMap(rec, end.kind), r = end.sig, d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const dir = s => end.kind === 'edge' ? s.ax : s.n, at = s => end.kind === 'edge' ? s.cc : s.c;
  let best = null, bd = Infinity;
  for (const s of m.values()) {
    if (s.type !== r.type || !dir(s) || !at(s)) continue;
    const dd = dir(s), dr = dir(r), dot = dd[0] * dr[0] + dd[1] * dr[1] + dd[2] * dr[2];
    if ((end.kind === 'edge' ? Math.abs(dot) : dot) < 0.999) continue;
    if (end.kind === 'edge' && Math.abs((s.len || 0) - (r.len || 0)) > 0.3 * (r.len || 1)) continue;
    const d = d3(at(s), at(r)); if (d < bd) { bd = d; best = s; }
  }
  return best && bd <= 50 ? best : null;
}
function motionOf(j) {
  const m = new THREE.Matrix4().makeTranslation(0, 0, jval(j, 'offset'));
  const t = j.type;
  if (t === 'slider' || t === 'cylindrical') m.multiply(new THREE.Matrix4().makeTranslation(0, 0, jval(j, 'distance')));
  if (t === 'planar') m.multiply(new THREE.Matrix4().makeTranslation(jval(j, 'x'), jval(j, 'y'), 0));
  if (t === 'revolute' || t === 'cylindrical' || t === 'planar' || t === 'ball' || (t === 'rigid' && +j.angle)) m.multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(jval(j, 'angle'))));
  if (t === 'ball') m.multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(jval(j, 'pitch')))).multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(jval(j, 'roll'))));
  if (!j.flip) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI));     // origins face each other (faces touch)
  return m;
}
// Place components by growing a tree from the fixed parts through the joints. A joint whose two sides are
// already placed closes a loop; its mismatch is returned so the loop solve can drive it to zero.
function treePass(todo) {
  const solved = new Map([['root', IDENT]]), driver = new Map(), loops = [];
  for (const c of comps()) if (c.grounded) solved.set(keyOfComp(c), IDENT);
  let left = todo;
  while (left.length) {
    const next = []; let progress = false;
    for (const t of left) {
      const A = solved.get(t.ka), B = solved.get(t.kb), M = motionOf(t.j);
      if (B && !A) { solved.set(t.ka, B.clone().multiply(t.Fb).multiply(M).multiply(t.Fa.clone().invert())); driver.set(t.ka, t); progress = true; }
      else if (A && !B) { solved.set(t.kb, A.clone().multiply(t.Fa).multiply(M.clone().invert()).multiply(t.Fb.clone().invert())); progress = true; }
      else if (A && B) { loops.push({ t, want: B.clone().multiply(t.Fb).multiply(M), have: A.clone().multiply(t.Fa) }); progress = true; }
      else next.push(t);
    }
    if (!progress && next.length) solved.set(next[0].kb, IDENT);       // a free-floating pair: its base stays put
    left = next;
  }
  return { solved, driver, loops };
}
const LOOP_SCALE = 50;             // mm per radian when mixing position and orientation errors
function loopResidual(loops) {
  const r = [];
  for (const { want, have } of loops) {
    const w = want.elements, hv = have.elements;
    r.push(w[12] - hv[12], w[13] - hv[13], w[14] - hv[14]);
    // orientation: skew part of Rhaveᵀ·Rwant (small-angle rotation vector), scaled to millimeters
    const R = new THREE.Matrix4().extractRotation(have).transpose().multiply(new THREE.Matrix4().extractRotation(want)).elements;
    r.push((R[6] - R[9]) / 2 * LOOP_SCALE, (R[8] - R[2]) / 2 * LOOP_SCALE, (R[1] - R[4]) / 2 * LOOP_SCALE);
  }
  return r;
}
// Solve all joints. With closed loops, the joint values become unknowns and a weighted minimum-norm
// Gauss-Newton closes every loop while moving the values as little as possible; o.hold keeps one joint's values.
let assemblyDriver = new Map();
function solveAssembly(o = {}) {
  jointStatus = new Map();
  const todo = [];
  for (const j of joints()) {
    if (j.suppressed) { jointStatus.set(j.id, { state: 'suppressed' }); continue; }
    if (!j.a || !j.b) { jointStatus.set(j.id, { state: 'error', msg: 'Pick both joint origins' }); continue; }
    const ka = compKey(j.a.body), kb = compKey(j.b.body);
    if (ka === kb) { jointStatus.set(j.id, { state: 'error', msg: 'Both origins are on ' + compLabel(ka) + '. Make one body a component first.' }); continue; }
    if (fixedKey(ka) && fixedKey(kb)) { jointStatus.set(j.id, { state: 'error', msg: 'Both parts are fixed (' + compLabel(ka) + ' and ' + compLabel(kb) + '), so this joint cannot move either. Unground one of them.' }); continue; }
    const Fa = endFrame(j.a), Fb = endFrame(j.b);
    if (!Fa || !Fb) { jointStatus.set(j.id, { state: 'error', msg: 'A joint origin no longer exists. Edit the joint and pick it again.' }); continue; }
    todo.push({ j, ka, kb, Fa, Fb });
    jointStatus.set(j.id, { state: 'ok' });
  }
  let res = treePass(todo);
  if (res.loops.length) {
    const vars = [];
    // held: the joint being edited or dragged, and any joint whose document value changed since the last solve
    const held = id => id === o.hold || (jointLive.has(id) && jointLive.get(id).base !== docKey(joints().find(j => j.id === id)));
    for (const t of todo) for (const k of JOINT_TYPES[t.j.type].dofs) if (!isFollower(t.j.id, k)) vars.push({ id: t.j.id, j: t.j, k, s: isAngK(k) ? Math.PI / 180 : 1, w: held(t.j.id) ? 1e6 : 1 });
    if (vars.length) {
      iterVals = new Map(todo.map(t => [t.j.id, {}]));
      for (const v of vars) iterVals.get(v.id)[v.k] = jval(v.j, v.k);
      const get = () => vars.map(v => iterVals.get(v.id)[v.k] * v.s), put = x => vars.forEach((v, i) => { iterVals.get(v.id)[v.k] = clampVal(v.j, v.k, x[i] / v.s); });
      const resid = () => loopResidual(treePass(todo).loops);
      let x = get(), r = resid();
      for (let it = 0; it < 60 && r.reduce((a, b) => a + b * b, 0) > 1e-18; it++) {
        const n = x.length, m = r.length, J = Array.from({ length: m }, () => new Array(n).fill(0));
        for (let c = 0; c < n; c++) { const h = 1e-6, xs = x.slice(); xs[c] += h; put(xs); const r2 = resid(); for (let q = 0; q < m; q++) J[q][c] = (r2[q] - r[q]) / h; }
        put(x);
        // Δ = −W⁻¹Jᵀ (J W⁻¹ Jᵀ + μI)⁻¹ r : minimum change, the held joint barely moves
        const Wi = vars.map(v => 1 / v.w), A = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => { let sum = 0; for (let c = 0; c < n; c++) sum += J[a][c] * Wi[c] * J[b][c]; return sum; }));
        let tr = 0; for (let a = 0; a < m; a++) tr += A[a][a];
        for (let a = 0; a < m; a++) A[a][a] += 1e-9 * (tr / m || 1) + 1e-12;
        const y = solveLinear(A, r.map(v => -v)); if (!y) break;
        const dx = Wi.map((wi, c) => { let sum = 0; for (let a = 0; a < m; a++) sum += J[a][c] * y[a]; return wi * sum; });
        let step = 1, e0 = r.reduce((a, b) => a + b * b, 0), xn, rn;
        for (let ls = 0; ls < 8; ls++) { xn = x.map((v, c) => v + step * dx[c]); put(xn); rn = resid(); if (rn.reduce((a, b) => a + b * b, 0) < e0) break; step /= 2; }
        x = get(); r = rn;
      }
      const err = Math.sqrt(r.reduce((a, b) => a + b * b, 0));
      jointLive = new Map(todo.map(t => [t.j.id, { base: docKey(t.j), values: { ...iterVals.get(t.j.id) } }]));
      iterVals = null;
      res = treePass(todo);
      for (const L of res.loops) jointStatus.set(L.t.j.id, err < 1e-4 ? { state: 'ok', loop: true } : { state: 'warn', msg: 'The joints in this loop cannot all be satisfied. Check the joint types and origins, or the limits.' });
    } else for (const L of res.loops) {
      const e = loopResidual([L]).reduce((a, b) => a + b * b, 0);
      jointStatus.set(L.t.j.id, e < 1e-10 ? { state: 'ok', loop: true } : { state: 'warn', msg: 'This joint closes a loop of rigid joints that do not line up.' });
    }
  } else jointLive = new Map();
  assemblyDriver = res.driver;
  keyXf = res.solved;
  compXf = new Map(comps().map(c => [c.id, res.solved.get(keyOfComp(c))]).filter(([, m]) => m));
  mpCache = null;
}
function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
// Write values a loop solve moved back into the document (after a drag, an edit, or OK).
function commitLive() {
  for (const j of joints()) {
    const l = jointLive.get(j.id); if (!l || l.base !== docKey(j)) continue;
    for (const k of JOINT_TYPES[j.type].dofs) if (k in l.values) j[k] = Math.round(l.values[k] * 1e4) / 1e4;
    jointLive.set(j.id, { base: docKey(j), values: l.values });
  }
}
function applyBodyTransforms() {
  for (const [id, s] of shownBodies) {
    const m = bodyXf(id);
    for (const o of [s.mesh, s.edges, s.cap]) { o.matrixAutoUpdate = false; o.matrix.copy(m); o.matrixWorldNeedsUpdate = true; }
  }
}
function assemblyChanged(hold) { solveAssembly({ hold }); applyBodyTransforms(); drawToolsOverlay(); refreshOverlays(); renderInfo(); renderTimeline(); requestRender(); }

// ---------- commands ----------
function newComponent() {
  const free = [...result.bodies.keys()].filter(id => !compOfBody(id));
  if (!free.length) { toast(result.bodies.size ? 'Every body is already in a component' : 'There is no body yet'); return; }
  const pick = new Set(selBody && free.includes(selBody) ? [selBody] : []);
  let name = 'Component ' + (comps().length + 1), grounded = false;
  openPanelDialog({ title: 'New Component', icon: 'component', okLabel: 'OK', help: 'A component groups bodies so they can move together and be joined to other components.',
    body: () => {
      const list = h('div', { class: 'picklist' });
      for (const id of free) {
        const cidn = 'nc-' + id, c = h('input', { type: 'checkbox', id: cidn, checked: pick.has(id) });
        c.addEventListener('change', () => { c.checked ? pick.add(id) : pick.delete(id); });
        list.append(h('label', { class: 'chk', for: cidn }, c, bodyName(id)));
      }
      const nm = h('input', { type: 'text', id: 'nc-name', value: name, autocomplete: 'off' }); nm.addEventListener('input', () => { name = nm.value; });
      const gr = h('input', { type: 'checkbox', id: 'nc-ground', checked: grounded }); gr.addEventListener('change', () => { grounded = gr.checked; });
      return [section_('Bodies', list), section_('Component', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'nc-name' }, 'Name'), nm), h('label', { class: 'chk', for: 'nc-ground' }, gr, 'Ground (stays put; other parts move to it)'))];
    },
    onOK: () => {
      if (!pick.size) { toast('Choose at least one body'); return; }
      checkpoint();
      comps().push({ id: uid(), name: name.trim() || 'Component', bodies: [...pick], grounded });
      persist(); assemblyChanged(); renderBrowser(); toast('Component created');
    },
  });
}
function dissolveComponent(id) {
  checkpoint(); doc.components = comps().filter(c => c.id !== id);
  persist(); assemblyChanged(); updateScene(); renderBrowser();
}
function toggleGround(id) { const c = compById(id); if (!c) return; checkpoint(); c.grounded = !c.grounded; persist(); assemblyChanged(); renderBrowser(); }
function deleteJoint(id) { checkpoint(); doc.joints = joints().filter(j => j.id !== id); persist(); assemblyChanged(); renderBrowser(); }
function toggleJointSuppressed(id) { const j = joints().find(x => x.id === id); if (!j) return; checkpoint(); j.suppressed = !j.suppressed; persist(); assemblyChanged(); renderBrowser(); }

function newJoint(asBuilt = false) {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : 'Joints need the exact geometry engine, which could not start here: ' + engineMsg); return; }
  if (!comps().length) { toast('Make a component first (Assemble ▸ New Component). Bodies outside components stay fixed.'); return; }
  const snap = leanJSON(doc); checkpoint();
  const j = { id: uid(), name: (asBuilt ? 'As-built Joint ' : 'Joint ') + (joints().length + 1), type: 'rigid', a: null, b: null, angle: 0, distance: 0, x: 0, y: 0, pitch: 0, roll: 0, offset: 0, flip: !!asBuilt, ...(asBuilt ? { asBuilt: true } : {}) };
  joints().push(j);
  openJointDialog(j.id, snap, 'a');
}
function editJoint(id) { const snap = leanJSON(doc); openJointDialog(id, snap, null); }
function openJointDialog(id, snap, stage) {
  stopJointAnim();
  jointEdit = { id, stage };
  const J = () => joints().find(x => x.id === id);
  const set = (k, v) => { const j = J(); if (!j) return; checkpoint('joint-' + id + '-' + k); j[k] = v; assemblyChanged(id); };
  const setLimit = (k, f, v) => { const j = J(); if (!j) return; checkpoint('jlim-' + id + '-' + k + f); j.limits ||= {}; j.limits[k] ||= { on: false, ...DEFAULT_LIMIT[k] }; j.limits[k][f] = v; assemblyChanged(id); };
  openPanelDialog({ title: 'Joint', icon: 'joint', okLabel: 'OK',
    help: 'Pick an origin on the part that moves, then an origin on the part it attaches to. Origins can be a corner, an edge midpoint, a hole or circle centre, a cylinder axis or a face centre: hover to see them, Tab to cycle when they overlap. Snapping only helps you pick; the joint is made when you click OK.',
    body: () => {
      const j = J(); if (!j) return [];
      const st = jointStatus.get(j.id);
      const desc = e => !e ? 'Not picked' : e.kind === 'cons' ? REF_LABEL[e.cons.type] + ' ' + jointConsName(e.cons) + ' (fixed)' : (e.kind === 'frame' ? 'As it sits now, with' : e.kind === 'ref' ? REF_LABEL[e.ref.type] : e.kind === 'edge' ? 'Round edge' : 'Face center') + ' on ' + bodyName(e.body) + (compOfBody(e.body) ? ' (' + compOfBody(e.body).name + ')' : ' (fixed)');
      const endRow = (k, label) => h('div', { class: 'row' }, h('span', { class: 'rl' }, label), h('div', {},
        h('div', { class: 'note', style: 'margin:0' }, jointEdit?.stage === k ? (j.asBuilt && k === 'b' ? 'Click the part it stays with…' : 'Hover the model: corners, edge midpoints, hole centres, axes and faces light up. Tab cycles, click picks.') : desc(j[k])),
        h('button', { class: 'btn', type: 'button', id: 'jp-' + k, style: 'margin-top:4px', 'aria-pressed': String(jointEdit?.stage === k), onclick: () => { jointEdit.stage = k; rerenderDialog(); defaultHint(); } }, j[k] ? 'Pick again' : 'Pick')));
      const typeSel = h('select', { id: 'jt-type' }, ...Object.entries(JOINT_TYPES).map(([v, t]) => h('option', { value: v, selected: j.type === v }, t.label)));
      typeSel.addEventListener('change', () => { const jj = J(); if (jj) jj.typeSet = true; set('type', typeSel.value); rerenderDialog(); });
      const sug = j.a && j.b && !j.asBuilt ? suggestJoint(endType(j.a), endType(j.b)) : null;
      const sugRow = sug ? h('p', { class: 'note', id: 'jt-suggest' }, 'Suggested: ' + JOINT_TYPES[sug.type].label + '. ' + sug.why + '. ',
        sug.type !== j.type ? h('button', { class: 'btn', type: 'button', id: 'jt-use', onclick: () => { const jj = J(); if (jj) jj.typeSet = true; set('type', sug.type); rerenderDialog(); } }, 'Use ' + JOINT_TYPES[sug.type].label) : null) : null;
      const dofRow = j.a && j.b && st?.state !== 'error' ? h('p', { class: 'note', id: 'jt-dof' }, dofSummary(j)) : null;
      const num = (k, label, unit, o = {}) => {
        const inp = h('input', { type: 'text', id: 'jv-' + k, value: String(j[k] ?? 0), autocomplete: 'off', inputmode: 'decimal' });
        inp.addEventListener('input', () => set(k, /^-?\d*\.?\d+$/.test(inp.value.trim()) ? +inp.value : inp.value));
        const row = h('div', { class: 'row' }, h('label', { class: 'rl', for: 'jv-' + k }, label), h('div', { class: 'exin' }, inp, h('span', { class: 'val' }), h('span', { class: 'u' }, unit)));
        if (!o.slider) return row;
        const [lo, hi] = limitOf(j, k) || (isAngK(k) ? [-180, 180] : [-100, 100]);
        const sl = h('input', { type: 'range', min: String(lo), max: String(hi), step: isAngK(k) ? '1' : '0.5', value: String(jval(j, k)), 'aria-label': label + ' slider', style: 'width:100%' });
        sl.addEventListener('input', () => { inp.value = sl.value; set(k, +sl.value); });
        const L = j.limits?.[k] || { on: false, ...DEFAULT_LIMIT[k] };
        const on = h('input', { type: 'checkbox', id: 'jl-' + k, checked: !!L.on }); on.addEventListener('change', () => { setLimit(k, 'on', on.checked); rerenderDialog(); });
        const lim = f => { const i = h('input', { type: 'text', id: 'jl-' + k + '-' + f, value: String(L[f]), inputmode: 'decimal', autocomplete: 'off', disabled: !L.on, 'aria-label': (f === 'min' ? 'Minimum ' : 'Maximum ') + label.toLowerCase(), style: 'width:64px' }); i.addEventListener('input', () => { if (Number.isFinite(+i.value) && i.value.trim() !== '') setLimit(k, f, +i.value); }); return i; };
        const limRow = h('div', { class: 'row' }, h('span', { class: 'rl' }), h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, h('label', { class: 'chk', for: 'jl-' + k, style: 'margin:0' }, on, 'Limits'), lim('min'), h('span', { class: 'note', style: 'margin:0' }, 'to'), lim('max'), h('span', { class: 'note', style: 'margin:0' }, unit)));
        return h('div', {}, row, h('div', { class: 'row' }, h('span', { class: 'rl' }), sl), limRow);
      };
      const flip = h('input', { type: 'checkbox', id: 'jt-flip', checked: !!j.flip }); flip.addEventListener('change', () => set('flip', flip.checked));
      const dofs = JOINT_TYPES[j.type].dofs;
      const animBtn = h('button', { class: 'btn', type: 'button', id: 'jt-anim', disabled: !dofs.length || st?.state !== 'ok', 'aria-pressed': String(!!jointAnim), onclick: () => { jointAnim ? stopJointAnim() : startJointAnim(j.id); rerenderDialog(); } }, jointAnim ? 'Stop' : 'Animate');
      const nameI = h('input', { type: 'text', id: 'jt-name', value: j.name, autocomplete: 'off' }); nameI.addEventListener('input', () => { checkpoint('jname-' + id); j.name = nameI.value; renderBrowser(); });
      return [
        section_('Position', endRow('a', j.asBuilt ? 'Moving part' : 'Moves'), endRow('b', j.asBuilt ? 'Stays with' : 'Attaches to'), j.asBuilt ? h('p', { class: 'note' }, 'As-built: the parts stay where they are; the joint origin is on the moving part.') : null, st?.msg ? h('p', { class: 'note', style: 'color:var(--err)' }, st.msg) : null),
        section_('Motion', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'jt-type' }, 'Type'), typeSel),
          sugRow, dofRow,
          ...dofs.map(k => num(k, DOF_LABEL[k] || k, DOF_UNITS[k], { slider: true })),
          j.type === 'rigid' ? num('angle', 'Rotation', '°') : null,
          j.a && j.b && !j.asBuilt && j.type !== 'slider' ? h('div', { class: 'row' }, h('span', { class: 'rl' }), h('div', {},
            h('button', { class: 'btn', type: 'button', id: 'jt-align', 'aria-pressed': String(jointEdit?.stage === 'align1' || jointEdit?.stage === 'align2'), onclick: () => { jointEdit.stage = 'align1'; jointEdit.align = null; rerenderDialog(); defaultHint(); } }, 'Align a second hole…'),
            h('div', { class: 'note', style: 'margin:2px 0 0' }, jointEdit?.stage === 'align1' ? 'Click a hole or round edge on the moving part…' : jointEdit?.stage === 'align2' ? 'Click the hole it should line up with on the other part…' : 'Turns the part about the joint axis so a second pair of holes line up (hole patterns).'))) : null,
          num('offset', 'Offset', 'mm'), j.asBuilt ? null : h('label', { class: 'chk', for: 'jt-flip' }, flip, 'Flip (same direction instead of facing)'),
          dofs.length ? h('div', { class: 'row' }, h('span', { class: 'rl' }), animBtn) : null),
        section_('Name', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'jt-name' }, 'Name'), nameI)),
        section_('Snap to', h('div', { class: 'snapcats' }, ...[['vertex', 'Vertices'], ['midpoint', 'Edge midpoints'], ['center', 'Circle centres'], ['axis', 'Axes'], ['face', 'Face centres'], ['origin', 'Component origins']].map(([k, label]) => {
          const c = h('input', { type: 'checkbox', id: 'js-' + k, checked: asmSnap[k] !== false }); c.addEventListener('change', () => setAsmSnap(k, c.checked)); return h('label', { class: 'chk', for: 'js-' + k }, c, label); })),
          h('p', { class: 'note', style: 'margin:4px 0 0' }, 'Hold Ctrl (⌘ on a Mac) to pick only faces and axes.')),
      ];
    },
    onOK: () => {
      stopJointAnim(); commitLive(); const j = J();
      if (j && (!j.a || !j.b)) { doc.joints = joints().filter(x => x.id !== id); toast('The joint needs two origins, so it was not added'); }
      jointEdit = null; persist(); assemblyChanged(); renderBrowser(); defaultHint();
    },
    onCancel: () => { stopJointAnim(); jointEdit = null; doc = reviveDoc(JSON.parse(snap)); afterDocReplace(); assemblyChanged(); defaultHint(); },
  });
  assemblyChanged(); defaultHint();
}
// Click on the model while a joint origin is being picked: round edges first, then flat faces.
// As-built: the base side is a fixed frame on the other part, chosen so the parts stay exactly where they are now.
function asBuiltBase(j, body) {
  const was = j.suppressed; j.suppressed = true; solveAssembly(); j.suppressed = was;
  const Fa = endFrame(j.a); if (!Fa) return null;
  const Ta = keyXf.get(compKey(j.a.body)) || IDENT, Tb = keyXf.get(compKey(body)) || IDENT;
  const Fb = Tb.clone().invert().multiply(Ta).multiply(Fa).multiply(motionOf(j).invert());
  return { body, kind: 'frame', frame: Fb.toArray() };
}
function jointPickAt(e) {
  if (!jointEdit?.stage) return false;
  const j = joints().find(x => x.id === jointEdit.id); if (!j) return false;
  if (j.asBuilt && jointEdit.stage === 'b') {           // any click on the other part
    raycaster.setFromCamera(ndcOf(e), camera); scene.updateMatrixWorld();
    const meshes = []; for (const [, sb] of shownBodies) if (sb.mesh.visible) meshes.push(sb.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0]; if (!hit) return true;
    const body = hit.object.userData.body;
    if (j.a && compKey(j.a.body) === compKey(body)) { toast('That is the same part. Click the part it stays with.'); return true; }
    checkpoint(); j.b = asBuiltBase(j, body); jointEdit.stage = null;
    assemblyChanged(); rerenderDialog(); defaultHint(); return true;
  }
  // the highlighted reference under the cursor (Tab may have chosen another one of the overlapping candidates)
  const near = refHover && Math.hypot(refHover.x - e.clientX, refHover.y - e.clientY) < 3 ? refHover : refHoverAt(e);
  const cand = near?.list[near.idx];
  if (!cand) { if (near?.body) toast('Nothing to join to there: pick a corner, edge, round edge or flat face'); return true; }
  if (jointEdit.stage === 'align1' || jointEdit.stage === 'align2') return alignPick(j, cand), true;
  const { d, w, body: cbody, ...ref } = cand;
  const end = ref.src?.kind === 'cons' ? { body: null, kind: 'cons', cons: { type: ref.type, ...ref.src.cons } } : { body: cbody !== undefined ? cbody : near.body, kind: 'ref', ref };
  refHover = null;
  const other = jointEdit.stage === 'a' ? j.b : j.a;
  if (other && compKey(other.body) === compKey(end.body)) { toast('Both origins would be on ' + compLabel(compKey(end.body)) + '. Pick a different part.'); return true; }
  checkpoint();
  j[jointEdit.stage] = end;
  if (j.asBuilt && jointEdit.stage === 'a' && j.b) j.b = asBuiltBase(j, j.b.body);     // re-anchor to the new origin
  jointEdit.stage = jointEdit.stage === 'a' && !j.b ? 'b' : null;
  // suggest the joint type from the two references (only until the user chooses one)
  if (j.a && j.b && !j.asBuilt && !j.typeSet) j.type = suggestJoint(endType(j.a), endType(j.b)).type;
  assemblyChanged(); rerenderDialog(); defaultHint();
  return true;
}
const endType = e => !e ? null : e.kind === 'ref' ? e.ref.type : e.kind === 'cons' ? e.cons.type : e.kind === 'edge' ? 'center' : e.kind === 'face' ? 'face' : 'frame';
function jointConsName(c) { return PLANES[c.id] ? c.id : JOINT_AXES[c.id] ? c.id + ' axis' : featById(c.id)?.name || ''; }
// Align a second hole: turn the moving part about the joint axis so a picked hole on it lines up with one on the other part.
function alignPick(j, cand) {
  if (cand.type !== 'center' && cand.type !== 'axis') { toast('Pick a hole or a round edge'); return; }
  const ka = compKey(j.a.body), kc = compKey(cand.body);
  if (jointEdit.stage === 'align1') {
    if (kc !== ka) { toast('Pick the hole on the moving part (' + compLabel(ka) + ')'); return; }
    jointEdit.align = { body: cand.body, p: cand.p }; jointEdit.stage = 'align2'; refHover = null; rerenderDialog(); defaultHint(); return;
  }
  if (kc === ka) { toast('Pick the hole on the other part'); return; }
  const target = new THREE.Vector3(...cand.w), A = jointEdit.align; jointEdit.stage = null; jointEdit.align = null; refHover = null;
  solveAssembly();
  const Fb = endFrame(j.b); if (!Fb) return;
  const Wb = (keyXf.get(compKey(j.b.body)) || IDENT).clone().multiply(Fb).multiply(new THREE.Matrix4().makeTranslation(0, 0, jval(j, 'offset')));
  const O = new THREE.Vector3().setFromMatrixPosition(Wb), z = new THREE.Vector3(0, 0, 1).transformDirection(Wb);
  const movingNow = () => new THREE.Vector3(...A.p).applyMatrix4(keyXf.get(compKey(A.body)) || IDENT);
  const flat = v => { const r = v.clone().sub(O); return r.sub(z.clone().multiplyScalar(r.dot(z))); };
  const vA = flat(movingNow()), vB = flat(target);
  if (vA.length() < 1e-6 || vB.length() < 1e-6) { toast('That hole is on the joint axis, so turning cannot move it'); rerenderDialog(); return; }
  const deg = THREE.MathUtils.radToDeg(Math.atan2(z.dot(vA.clone().cross(vB)), vA.dot(vB))), cur = +j.angle || 0;
  checkpoint('jalign-' + j.id);
  let best = null;
  for (const cand2 of [cur + deg, cur - deg]) { j.angle = Math.round(cand2 * 1e6) / 1e6; jointLive.delete(j.id); solveAssembly({ hold: j.id }); const dd = movingNow().distanceTo(target); if (!best || dd < best.d) best = { a: j.angle, d: dd }; }
  j.angle = best.a; jointLive.delete(j.id);
  assemblyChanged(j.id); rerenderDialog(); defaultHint();
  toast(Math.abs(vA.length() - vB.length()) > 0.01 ? 'Turned to the closest angle: the two holes are at different distances from the joint axis, so they cannot line up exactly' : 'Turned ' + fmt(Math.round(best.a * 1000) / 1000) + '° so the holes line up');
}

// ---------- AssemblyPlacementEngine: references under the cursor while a joint origin is picked ----------
let refHover = null;   // { x, y, body, list: [ref + { d, w: world point }], idx }
// which reference types joint picking snaps to (kept per browser); Ctrl held = faces and axes only
var asmSnap = (() => { try { return { vertex: true, midpoint: true, center: true, axis: true, face: true, origin: true, ...JSON.parse(localStorage.getItem('draftwork.asmsnap') || '{}') }; } catch (e) { return { vertex: true, midpoint: true, center: true, axis: true, face: true, origin: true }; } })();
function setAsmSnap(k, on) { asmSnap[k] = on; try { localStorage.setItem('draftwork.asmsnap', JSON.stringify(asmSnap)); } catch (e) { } }
function refHoverAt(e, raw) {   // raw: list every candidate (test hook)
  raycaster.setFromCamera(ndcOf(e), camera); scene.updateMatrixWorld();
  const meshes = []; for (const [, sb] of shownBodies) if (sb.mesh.visible && sb.rec.shape) meshes.push(sb.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  const r = renderer.domElement.getBoundingClientRect(), px = mmPerPx();
  const scr = v => { const q = v.clone().project(camera); return Math.hypot(r.left + (q.x + 1) / 2 * r.width - e.clientX, r.top + (1 - q.y) / 2 * r.height - e.clientY); };
  const cands = [];
  let body = null;
  if (hit) {
    body = hit.object.userData.body;
    const sb = shownBodies.get(body), rec = sb.rec, Bx = bodyXf(body), Bi = Bx.clone().invert();
    const face = brepSigMap(rec, 'face').get(brepMeshOf(rec).triFace[hit.faceIndex]);
    const nW = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 0, 1);
    const nM = nW.clone().transformDirection(Bi);
    const refs = bodyRefs([...brepSigMap(rec, 'edge').values()], face, [nM.x, nM.y, nM.z], [...brepSigMap(rec, 'face').values()]);
    // the component's own origin (its local coordinate system moves with it)
    if (compOfBody(body)) refs.push({ type: 'origin', p: [0, 0, 0], z: [0, 0, 1], x: [1, 0, 0], src: { kind: 'origin' } });
    for (const ref of refs) {
      const w = new THREE.Vector3(...ref.p).applyMatrix4(Bx);
      // hidden references (behind the face under the cursor) are not offered
      const onFace = face?.type === 'PLANE' && face.n && Math.abs((ref.p[0] - face.c[0]) * face.n[0] + (ref.p[1] - face.c[1]) * face.n[1] + (ref.p[2] - face.c[2]) * face.n[2]) < 1e-6;   // on the face under the cursor: not hidden by it
      if (!onFace && !['face', 'axis', 'origin', 'between'].includes(ref.type) && w.distanceTo(raycaster.ray.origin) > hit.distance + Math.max(1, px * 6)) continue;
      let d = scr(w);
      // a circle's centre is offered from anywhere along its edge too (a hole's centre is in empty space)
      if (ref.type === 'center' && ref.src.sig.p) {
        const c = new THREE.Vector3(...ref.p), ax = new THREE.Vector3(...ref.src.sig.ax).normalize(), u = new THREE.Vector3(...ref.src.sig.p).sub(c), vv = ax.clone().cross(u);
        for (let i = 0; i < 24; i++) { const t = i / 24 * Math.PI * 2; d = Math.min(d, scr(c.clone().addScaledVector(u, Math.cos(t)).addScaledVector(vv, Math.sin(t)).applyMatrix4(Bx))); }
      }
      cands.push({ ...ref, d, w: [w.x, w.y, w.z], body });
    }
  }
  // construction points, axes and planes (fixed): offered next to the part's own references
  for (const [id, pt] of result.points || []) {
    if (doc.planeHidden?.[id]) continue;
    const w = new THREE.Vector3(...pt.p), d = scr(w);
    if (d <= 16) cands.push({ type: 'cpoint', p: pt.p, z: [0, 0, 1], src: { kind: 'cons', cons: { id } }, d, w: pt.p, body: null });
  }
  const axes = [...(result.axes || [])].filter(([id]) => !doc.planeHidden?.[id]).map(([id, a]) => ({ id, o: a.o, d: a.d }));
  if (doc.showOrigin) for (const [id, d] of Object.entries(JOINT_AXES)) axes.push({ id, o: [0, 0, 0], d });
  for (const a of axes) {
    // the point on the axis closest to the pick ray
    const o = new THREE.Vector3(...a.o), dv = new THREE.Vector3(...a.d).normalize(), ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    const w0 = o.clone().sub(ro), b = dv.dot(rd), den = 1 - b * b; if (den < 1e-9) continue;
    const t = (b * w0.dot(rd) - w0.dot(dv)) / den, q = o.clone().addScaledVector(dv, t);
    if (hit && q.distanceTo(ro) > hit.distance + Math.max(1, px * 6)) continue;
    const d = scr(q);
    if (d <= 12) cands.push({ type: 'caxis', p: q.toArray(), z: a.d, src: { kind: 'cons', cons: { id: a.id, t: Math.round(t * 1e6) / 1e6 } }, d, w: q.toArray(), body: null });
  }
  const planeObjs = []; for (const g of [planesGroup, originGroup]) if (g.visible) g.traverse(o => { if (o.isMesh && o.userData.pickable && o.visible) planeObjs.push(o); });
  const ph = raycaster.intersectObjects(planeObjs, false)[0];
  if (ph && (!hit || ph.distance < hit.distance - Math.max(0.05, hit.distance * 1e-3))) {
    const id = ph.object.userData.plane, M = PLANES[id] ? planeMatrix(id, 0) : planeMatrixOf(id), l = ph.point.clone().applyMatrix4(M.clone().invert());
    const local = [Math.round(l.x * 100) / 100, Math.round(l.y * 100) / 100], o = new THREE.Vector3(local[0], local[1], 0).applyMatrix4(M);
    cands.push({ type: 'cplane', p: o.toArray(), z: new THREE.Vector3(0, 0, 1).transformDirection(M).toArray(), src: { kind: 'cons', cons: { id, local } }, d: 0, w: o.toArray(), body: null });
  }
  if (raw) return cands.map(c => c.type + ':' + Math.round(c.d) + ':' + c.p.map(v => Math.round(v * 10) / 10).join('/'));
  if (!cands.length) return hit ? { x: e.clientX, y: e.clientY, body, list: [], idx: 0 } : null;
  const allow = c => asmSnap[c.type] !== false && !(e.ctrlKey || e.metaKey ? !['face', 'axis', 'cplane', 'caxis', 'between'].includes(c.type) : false);
  const list = rankRefs(cands.filter(allow), 16).slice(0, 8);
  return { x: e.clientX, y: e.clientY, body, list, idx: 0 };
}
function refHoverHint() {
  const c = refHover?.list[refHover.idx]; if (!c) return null;
  const n = refHover.list.length;
  const comp = c.body && compOfBody(c.body);
  return REF_LABEL[c.type] + (c.body ? ' on ' + bodyName(c.body) + (comp ? ' (' + comp.name + ')' : ' (fixed)') : ' ' + jointConsName({ id: c.src.cons.id }) + ' (fixed)') + (n > 1 ? ' · Tab for the next one (' + (refHover.idx + 1) + ' of ' + n + ')' : '') + ' · click to pick';
}
// registered after every module has loaded (assembly.js runs before the viewport exists)
queueMicrotask(() => viewport.addEventListener('pointermove', e => {
  if (!jointEdit?.stage || (joints().find(x => x.id === jointEdit.id)?.asBuilt && jointEdit.stage === 'b')) { if (refHover) { refHover = null; drawToolsOverlay(); } return; }
  if (e.buttons) return;
  const prevKey = refHover ? refHover.body + ':' + refHover.list.map(c => c.type + c.p.join(',')).join('|') : '';
  const nh = refHoverAt(e), key = nh ? nh.body + ':' + nh.list.map(c => c.type + c.p.join(',')).join('|') : '';
  if (nh && key === prevKey) nh.idx = refHover.idx;    // same candidates: keep the one Tab chose
  refHover = nh;
  setHint(refHoverHint() || jointHint() || '');
  if (key !== prevKey || !nh) drawToolsOverlay(); requestRender();
}));
window.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !jointEdit?.stage || !refHover || refHover.list.length < 2) return;
  if (e.target.closest?.('input, select, textarea')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  refHover.idx = (refHover.idx + (e.shiftKey ? -1 : 1) + refHover.list.length) % refHover.list.length;
  setHint(refHoverHint()); drawToolsOverlay(); requestRender();
}, true);
// markers for the references under the cursor; the one a click would pick is drawn larger
function drawRefMarkers(group) {
  if (!refHover?.list || !jointEdit?.stage) return;
  refHover.list.forEach((c, i) => {
    const el = h('div', { class: 'refmk ref-' + c.type + (i === refHover.idx ? ' active' : ''), 'data-ref': c.type, 'data-active': String(i === refHover.idx), title: REF_LABEL[c.type] });
    const o = new CSS2DObject(el); o.position.set(...c.w); group.add(o);
    if (i === refHover.idx && ['axis', 'center', 'face', 'caxis', 'cplane', 'between'].includes(c.type)) {
      const Bx = c.body ? bodyXf(c.body) : IDENT, z = new THREE.Vector3(...c.z).transformDirection(Bx), p = new THREE.Vector3(...c.w), L = Math.max(4, mmPerPx() * 40);
      const ax2 = c.type === 'axis' || c.type === 'caxis'; group.add(line([p.clone().addScaledVector(z, ax2 ? -L : 0), p.clone().addScaledVector(z, L)], colors.select, { depthTest: false, dashed: ax2, dash: L / 8, gap: L / 12 }));
    }
  });
}
// What a component can still do: grounded / fixed, the motion its placing joint allows, or free (no joint yet)
function compMotion(c) {
  const k = keyOfComp(c);
  if (c.grounded) return { dof: 0, text: 'grounded' };
  if (fixedKey(k)) return { dof: 0, text: 'fixed' };
  const t = assemblyDriver.get(k);
  if (!t) return { dof: 6, text: 'free: not joined yet' };
  const n = JOINT_DOF[t.j.type] ?? 0, loop = [...jointStatus.values()].some(s => s.loop);
  return { dof: n, text: n ? n + ' DOF · ' + JOINT_TYPES[t.j.type].label.toLowerCase() + (loop ? ' (a loop may hold it further)' : '') : 'fully constrained' };
}
const MOTION_TEXT = { rigid: 'cannot move', revolute: 'turns about the axis', slider: 'slides along the axis', cylindrical: 'turns about and slides along the axis', planar: 'slides and turns on the plane', ball: 'turns in any direction about the point' };
function dofSummary(j) {
  const ka = compKey(j.a.body), n = JOINT_DOF[j.type] ?? 0;
  return 'With this joint, ' + compLabel(ka) + ' ' + MOTION_TEXT[j.type] + ' (' + n + ' degree' + (n === 1 ? '' : 's') + ' of freedom' + (n ? ' left' : '') + ').';
}
function jointHint() {
  const j = jointEdit && joints().find(x => x.id === jointEdit.id);
  if (jointEdit?.stage === 'align1') return 'Click a hole on the moving part that should line up with a hole on the other part';
  if (jointEdit?.stage === 'align2') return 'Click the hole on the other part it should line up with';
  if (jointEdit?.stage === 'a') return j?.asBuilt ? 'Click a flat face or round edge on the moving part: that is where the joint turns or slides' : 'Click a flat face or round edge on the part that moves';
  if (jointEdit?.stage === 'b') return j?.asBuilt ? 'Click the part it stays with (it does not move)' : 'Click a flat face or round edge on the part it attaches to';
  return null;
}

// ---------- animation ----------
function startJointAnim(id) {
  const j = joints().find(x => x.id === id); if (!j) return;
  const dofs = JOINT_TYPES[j.type].dofs; if (!dofs.length) return;
  const t0 = performance.now(), base = Object.fromEntries(dofs.map(k => [k, jval(j, k)]));
  jointAnim = { id, raf: 0 };
  const step = now => {
    if (!jointAnim) return;
    const s = (now - t0) / 1000, values = {};
    for (const k of dofs) {
      const L = limitOf(j, k), ph = (1 - Math.cos(s * Math.PI / 1.5)) / 2;      // back and forth inside the limits
      if (L) values[k] = L[0] + (L[1] - L[0]) * ph;
      else if (k === 'angle') values.angle = base.angle + (s * 90) % 360;           // a quarter turn per second
      else if (k === 'distance') values[k] = DEFAULT_LIMIT.distance.min + (DEFAULT_LIMIT.distance.max - DEFAULT_LIMIT.distance.min) * ph;
      else values[k] = base[k];
    }
    jointPreview = { id, values };
    solveAssembly({ hold: id }); applyBodyTransforms(); drawToolsOverlay(); requestRender();
    jointAnim.raf = requestAnimationFrame(step);
  };
  jointAnim.raf = requestAnimationFrame(step);
}
function stopJointAnim() {
  if (!jointAnim) return;
  const id = jointAnim.id;
  cancelAnimationFrame(jointAnim.raf); jointAnim = null; jointPreview = null; jointLive.delete(id);
  solveAssembly({ hold: id }); applyBodyTransforms(); drawToolsOverlay(); requestRender();
}

// ---------- overlay: joint origins ----------
function drawJointOverlay(group) {
  drawRefMarkers(group);
  const show = jointEdit ? [jointEdit.id] : selJoint ? [selJoint] : [];
  for (const id of show) {
    const j = joints().find(x => x.id === id); if (!j) continue;
    for (const [k, col] of [['b', colors.accent], ['a', colors.select]]) {
      const F = endFrame(j[k]); if (!F) continue;
      const W = bodyXf(j[k].body).clone().multiply(F), size = Math.max(4, mmPerPx() * 28);
      const o = new THREE.Vector3().setFromMatrixPosition(W), z = new THREE.Vector3(0, 0, 1).transformDirection(W), x = new THREE.Vector3(1, 0, 0).transformDirection(W);
      const ring = [];
      for (let i = 0; i <= 32; i++) { const t = i / 32 * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(t) * size * 0.45, Math.sin(t) * size * 0.45, 0).applyMatrix4(W)); }
      group.add(line(ring, col, { depthTest: false }), line([o, o.clone().addScaledVector(z, size)], col, { depthTest: false }), line([o, o.clone().addScaledVector(x, size * 0.6)], col, { depthTest: false, opacity: 0.6 }));
    }
  }
}
let selJoint = null;
function selectJoint(id) { selJoint = id; selBody = null; selFeature = null; drawToolsOverlay(); renderBrowser(); renderTimeline(); requestRender(); }

// matrix -> rotation (angle in degrees about an axis) + translation, for the engine's STEP export
function xfParts(m) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
  const w = Math.min(1, Math.max(-1, q.w)), ang = 2 * Math.acos(w), sn = Math.sqrt(1 - w * w);
  return { angle: THREE.MathUtils.radToDeg(ang), axis: sn < 1e-9 ? [0, 0, 1] : [q.x / sn, q.y / sn, q.z / sn], move: [p.x, p.y, p.z] };
}

// ---------- drag a jointed part to move it along its free motion ----------
// Turning (revolute, cylindrical; planar with Shift), sliding (slider; cylindrical with Shift), or moving in the
// plane (planar). The part is driven through the joint that placed it, so loops follow and limits hold.
let partDrag = null;
function partDragStart(e) {
  if (e.button !== 0 || mode !== 'model' || dlg || pick || measure || !isBrep()) return;
  raycaster.setFromCamera(ndcOf(e), camera); scene.updateMatrixWorld();
  const meshes = []; for (const [, sb] of shownBodies) if (sb.mesh.visible) meshes.push(sb.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0]; if (!hit) return;
  const c = compOfBody(hit.object.userData.body); if (!c || fixedKey(keyOfComp(c))) return;
  const t = assemblyDriver.get(keyOfComp(c)); if (!t) return;
  const j = t.j, dofs = JOINT_TYPES[j.type].dofs; if (!dofs.length) return;
  const base = keyXf.get(t.kb) || IDENT;
  const W = base.clone().multiply(t.Fb).multiply(new THREE.Matrix4().makeTranslation(0, 0, jval(j, 'offset')));
  e.stopPropagation(); e.preventDefault();               // keep the view from orbiting
  downAt = { x: e.clientX, y: e.clientY, b: 0 };         // a click without movement still selects
  partDrag = { j, dofs, Wi: W.clone().invert(), start: Object.fromEntries(dofs.map(k => [k, jval(j, k)])), x0: e.clientX, y0: e.clientY, moved: false, turned: 0 };
  partDrag.ref = dragMeasure(e); partDrag.lastAng = partDrag.ref.ang;
  window.addEventListener('pointermove', partDragMove);
  window.addEventListener('pointerup', partDragEnd, { once: true });
}
// the pointer ray in the joint's motion frame: where it meets the motion plane, and the nearest point on its axis
function dragMeasure(e) {
  raycaster.setFromCamera(ndcOf(e), camera);
  const o = raycaster.ray.origin.clone().applyMatrix4(partDrag.Wi), d = raycaster.ray.direction.clone().transformDirection(partDrag.Wi), out = {};
  if (Math.abs(d.z) > 1e-6) { const s = -o.z / d.z; out.px = o.x + d.x * s; out.py = o.y + d.y * s; out.ang = Math.atan2(out.py, out.px); }
  const a = d.dot(d), b = d.z, den = a - b * b;
  if (Math.abs(den) > 1e-6) out.t = (a * o.z - b * d.dot(o)) / den;
  return out;
}
function partDragMove(e) {
  const D = partDrag; if (!D) return;
  if (!D.moved && Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 4) return;
  D.moved = true; viewport.classList.add('moving');
  const m = dragMeasure(e), type = D.j.type, v = { ...D.start };
  const slide = type === 'slider' || (type === 'cylindrical' && e.shiftKey);
  const turn = type === 'revolute' || type === 'ball' || (type === 'cylindrical' && !e.shiftKey) || (type === 'planar' && e.shiftKey);
  if (slide) { if (m.t != null && D.ref.t != null) v.distance = D.start.distance + (m.t - D.ref.t); }
  else if (turn) {
    if (m.ang != null && D.lastAng != null) { let da = m.ang - D.lastAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; D.turned += da; D.lastAng = m.ang; }
    v.angle = D.start.angle + THREE.MathUtils.radToDeg(D.turned);
  } else if (m.px != null && D.ref.px != null) { v.x = D.start.x + (m.px - D.ref.px); v.y = D.start.y + (m.py - D.ref.py); }
  for (const k of D.dofs) v[k] = clampVal(D.j, k, v[k]);
  if (doc.contact?.on) {
    // walk from the last good pose toward the new one in small steps and stop just before the first contact
    const from = D.lastGood || D.start, n = Math.max(1, Math.ceil(Math.max(...D.dofs.map(k => Math.abs(v[k] - from[k]) / (k === 'angle' ? 2 : 0.5)))));
    let good = from, hit = null;
    for (let s = 1; s <= Math.min(n, 90); s++) {
      const vs = Object.fromEntries(D.dofs.map(k => [k, from[k] + (v[k] - from[k]) * s / n]));
      jointPreview = { id: D.j.id, values: vs }; solveAssembly({ hold: D.j.id });
      const moving = new Set([...keyXf.keys()].filter(k => !fixedKey(k)));
      hit = moving.size ? contactHit(moving) : null;
      if (hit) break;
      good = vs;
    }
    D.lastGood = good;
    jointPreview = { id: D.j.id, values: good }; solveAssembly({ hold: D.j.id }); applyBodyTransforms(); drawToolsOverlay(); requestRender();
    if (hit) { setHint('Contact: ' + bodyName(hit[0]) + ' touches ' + bodyName(hit[1])); return; }
  } else { jointPreview = { id: D.j.id, values: v }; solveAssembly({ hold: D.j.id }); }
  applyBodyTransforms(); drawToolsOverlay(); requestRender();
  setHint(JOINT_TYPES[type].label + ' · ' + D.dofs.map(k => (isAngK(k) ? fmt(v[k]) + '°' : fmt(v[k]) + ' mm')).join(', ') + (type === 'cylindrical' || type === 'planar' ? ' · hold Shift to ' + (type === 'planar' ? 'turn' : 'slide') : ''));
}
function partDragEnd() {
  window.removeEventListener('pointermove', partDragMove);
  const D = partDrag; partDrag = null; viewport.classList.remove('moving');
  if (!D || !D.moved) return;
  const vals = jointPreview?.values || {}; jointPreview = null;
  checkpoint();
  for (const k of D.dofs) if (k in vals) D.j[k] = Math.round(clampVal(D.j, k, vals[k]) * 1000) / 1000;
  jointLive.delete(D.j.id);
  solveAssembly({ hold: D.j.id }); commitLive(); persist();
  applyBodyTransforms(); drawToolsOverlay(); renderBrowser(); if (dlg) rerenderDialog(); defaultHint(); requestRender();
}

// ---------- rigid groups: components that move as one ----------
function newRigidGroup() {
  const avail = comps().filter(c => !groupOfComp(c.id));
  if (avail.length < 2) { toast('A rigid group needs at least two components that are not already in a group'); return; }
  const pickSet = new Set(); let name = 'Rigid Group ' + (groups().length + 1);
  openPanelDialog({ title: 'Rigid Group', icon: 'component', okLabel: 'OK', help: 'Components in a rigid group keep their positions relative to each other and move together.',
    body: () => {
      const list = h('div', { class: 'picklist' });
      for (const c of avail) { const idn = 'rg-' + c.id, cb = h('input', { type: 'checkbox', id: idn, checked: pickSet.has(c.id) }); cb.addEventListener('change', () => { cb.checked ? pickSet.add(c.id) : pickSet.delete(c.id); }); list.append(h('label', { class: 'chk', for: idn }, cb, c.name)); }
      const nm = h('input', { type: 'text', id: 'rg-name', value: name, autocomplete: 'off' }); nm.addEventListener('input', () => { name = nm.value; });
      return [section_('Components', list), section_('Group', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'rg-name' }, 'Name'), nm))];
    },
    onOK: () => {
      if (pickSet.size < 2) { toast('Choose at least two components'); return; }
      checkpoint(); groups().push({ id: uid(), name: name.trim() || 'Rigid Group', comps: [...pickSet] });
      persist(); assemblyChanged(); renderBrowser(); renderTimeline(); toast('Rigid group created');
    },
  });
}
function deleteRigidGroup(id) { checkpoint(); doc.rigidGroups = groups().filter(g => g.id !== id); persist(); assemblyChanged(); renderBrowser(); renderTimeline(); }

// ---------- timeline: assembly steps after the modeling features ----------
function assemblyChips() {
  const out = [];
  const chip = (o) => { const b = h('button', { class: 'chip asm s-' + (o.state || 'ok'), 'aria-label': o.label, title: o.label + (o.msg ? '\n⚠ ' + o.msg : ''), 'aria-current': String(!!o.cur), html: icon(o.icon) });
    b.addEventListener('click', o.click); b.addEventListener('dblclick', o.dbl || o.click);
    b.addEventListener('contextmenu', e => { e.preventDefault(); openMenu(b, o.menu(), { at: { x: e.clientX, y: e.clientY - 160 } }); });
    out.push(b); };
  for (const c of comps()) chip({ icon: 'component', label: c.name + ' (component)', click: () => { if (c.bodies[0]) selectBody(c.bodies[0]); }, dbl: () => { renaming = 'c:' + c.id; expanded.add('components'); renderBrowser(); },
    menu: () => [{ label: c.grounded ? 'Unground' : 'Ground', icon: 'component', action: () => toggleGround(c.id) }, '-', { label: 'Dissolve', icon: 'delete', action: () => dissolveComponent(c.id) }] });
  for (const g of groups()) chip({ icon: 'component', label: g.name + ' (rigid group)', click: () => { }, menu: () => [{ label: 'Delete', icon: 'delete', action: () => deleteRigidGroup(g.id) }] });
  for (const j of joints()) {
    const st = jointStatus.get(j.id);
    chip({ icon: 'joint', label: j.name + ' (' + (j.asBuilt ? 'as-built ' : '') + (JOINT_TYPES[j.type]?.label || '').toLowerCase() + ' joint)', state: st?.state === 'warn' ? 'error' : st?.state, msg: st?.msg, cur: selJoint === j.id || jointEdit?.id === j.id,
      click: () => { if (selJoint === j.id && !dlg) editJoint(j.id); else selectJoint(j.id); }, dbl: () => editJoint(j.id),
      menu: () => [{ label: 'Edit Joint', icon: 'joint', action: () => editJoint(j.id) }, { label: j.suppressed ? 'Unsuppress' : 'Suppress', icon: 'eye', action: () => toggleJointSuppressed(j.id) }, '-', { label: 'Delete', icon: 'delete', action: () => deleteJoint(j.id) }] });
  }
  return out;
}
