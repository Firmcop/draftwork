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
};
const DOF_UNITS = { angle: '°', distance: 'mm', x: 'mm', y: 'mm' };
let compXf = new Map();            // component id -> Matrix4 (as-modeled -> assembled)
let jointStatus = new Map();       // joint id -> { state: 'ok' | 'warn' | 'error', msg }
let jointPreview = null;           // { id, values } while animating, without touching the document
let jointEdit = null;              // open joint dialog: { id, stage: 'a' | 'b' | null }
let jointAnim = null;

const comps = () => doc.components || (doc.components = []);
const joints = () => doc.joints || (doc.joints = []);
const compById = id => comps().find(c => c.id === id) || null;
function compOfBody(bid) { return comps().find(c => c.bodies.includes(bid)) || null; }
const compKey = bid => compOfBody(bid)?.id || 'root';
function bodyXf(bid) { const c = bid && compOfBody(bid); return (c && compXf.get(c.id)) || IDENT; }
function compLabel(key) { return key === 'root' ? 'the fixed bodies' : compById(key)?.name || 'a component'; }

function jval(j, k) {
  const v = jointPreview?.id === j.id && k in jointPreview.values ? jointPreview.values[k] : j[k];
  if (v == null || v === '') return 0;
  let n; try { n = typeof v === 'string' ? evalExpr(v, params.vars) : +v; } catch (e) { n = 0; }
  return Number.isFinite(n) ? n : 0;
}
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
  const rec = result.bodies.get(end.body); if (!rec) return null;
  let sig = end.sig;
  if (rec.shape) { sig = rematchEnd(rec, end); if (!sig) return null; }
  return frameFromSig(sig, end.kind);
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
  if (t === 'revolute' || t === 'cylindrical' || t === 'planar') m.multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(jval(j, 'angle'))));
  if (!j.flip) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI));     // origins face each other (faces touch)
  return m;
}
// Solve all joints as a tree grown from the fixed parts. Joints that would close a loop are only checked.
function solveAssembly() {
  const solved = new Map([['root', IDENT]]);
  for (const c of comps()) if (c.grounded) solved.set(c.id, IDENT);
  jointStatus = new Map();
  const todo = [];
  for (const j of joints()) {
    if (j.suppressed) { jointStatus.set(j.id, { state: 'suppressed' }); continue; }
    if (!j.a || !j.b) { jointStatus.set(j.id, { state: 'error', msg: 'Pick both joint origins' }); continue; }
    const ka = compKey(j.a.body), kb = compKey(j.b.body);
    if (ka === kb) { jointStatus.set(j.id, { state: 'error', msg: 'Both origins are on ' + compLabel(ka) + '. Make one body a component first.' }); continue; }
    const Fa = endFrame(j.a), Fb = endFrame(j.b);
    if (!Fa || !Fb) { jointStatus.set(j.id, { state: 'error', msg: 'A joint origin no longer exists. Edit the joint and pick it again.' }); continue; }
    todo.push({ j, ka, kb, Fa, Fb, M: motionOf(j) });
  }
  let left = todo;
  while (left.length) {
    const next = [];
    let progress = false;
    for (const t of left) {
      const A = solved.get(t.ka), B = solved.get(t.kb);
      if (B && !A) { solved.set(t.ka, B.clone().multiply(t.Fb).multiply(t.M).multiply(t.Fa.clone().invert())); jointStatus.set(t.j.id, { state: 'ok' }); progress = true; }
      else if (A && !B) { solved.set(t.kb, A.clone().multiply(t.Fa).multiply(t.M.clone().invert()).multiply(t.Fb.clone().invert())); jointStatus.set(t.j.id, { state: 'ok' }); progress = true; }
      else if (A && B) {
        const want = B.clone().multiply(t.Fb).multiply(t.M), have = A.clone().multiply(t.Fa);
        const err = want.elements.reduce((s, v, i) => s + Math.abs(v - have.elements[i]), 0);
        jointStatus.set(t.j.id, err < 1e-6 ? { state: 'ok' } : { state: 'warn', msg: 'This joint closes a loop and is not satisfied (loops are not solved yet).' });
        progress = true;
      } else next.push(t);
    }
    if (!progress && next.length) { solved.set(next[0].kb, IDENT); }       // a free-floating pair: its base stays put
    left = next;
  }
  compXf = new Map([...solved].filter(([k]) => k !== 'root'));
  mpCache = null;
}
function applyBodyTransforms() {
  for (const [id, s] of shownBodies) {
    const m = bodyXf(id);
    for (const o of [s.mesh, s.edges, s.cap]) { o.matrixAutoUpdate = false; o.matrix.copy(m); o.matrixWorldNeedsUpdate = true; }
  }
}
function assemblyChanged() { solveAssembly(); applyBodyTransforms(); drawToolsOverlay(); refreshOverlays(); renderInfo(); requestRender(); }

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

function newJoint() {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : 'Joints need the exact geometry engine, which could not start here: ' + engineMsg); return; }
  if (!comps().length) { toast('Make a component first (Assemble ▸ New Component). Bodies outside components stay fixed.'); return; }
  const snap = JSON.stringify(doc); checkpoint();
  const j = { id: uid(), name: 'Joint ' + (joints().length + 1), type: 'rigid', a: null, b: null, angle: 0, distance: 0, x: 0, y: 0, offset: 0, flip: false, range: { angle: [0, 360], distance: [0, 20] } };
  joints().push(j);
  openJointDialog(j.id, snap, 'a');
}
function editJoint(id) { const snap = JSON.stringify(doc); openJointDialog(id, snap, null); }
function openJointDialog(id, snap, stage) {
  stopJointAnim();
  jointEdit = { id, stage };
  const J = () => joints().find(x => x.id === id);
  const set = (k, v) => { const j = J(); if (!j) return; checkpoint('joint-' + id + '-' + k); j[k] = v; assemblyChanged(); };
  openPanelDialog({ title: 'Joint', icon: 'joint', okLabel: 'OK',
    help: 'Pick an origin on the part that moves, then an origin on the part it attaches to. Origins sit at the center of a flat face or of a round edge.',
    body: () => {
      const j = J(); if (!j) return [];
      const st = jointStatus.get(j.id);
      const desc = e => !e ? 'Not picked' : (e.kind === 'edge' ? 'Round edge' : 'Face center') + ' on ' + bodyName(e.body) + (compOfBody(e.body) ? ' (' + compOfBody(e.body).name + ')' : ' (fixed)');
      const endRow = (k, label) => h('div', { class: 'row' }, h('span', { class: 'rl' }, label), h('div', {},
        h('div', { class: 'note', style: 'margin:0' }, jointEdit?.stage === k ? 'Click a flat face or a round edge on the model…' : desc(j[k])),
        h('button', { class: 'btn', type: 'button', id: 'jp-' + k, style: 'margin-top:4px', 'aria-pressed': String(jointEdit?.stage === k), onclick: () => { jointEdit.stage = k; rerenderDialog(); defaultHint(); } }, j[k] ? 'Pick again' : 'Pick')));
      const typeSel = h('select', { id: 'jt-type' }, ...Object.entries(JOINT_TYPES).map(([v, t]) => h('option', { value: v, selected: j.type === v }, t.label)));
      typeSel.addEventListener('change', () => { set('type', typeSel.value); rerenderDialog(); });
      const num = (k, label, unit, o = {}) => {
        const inp = h('input', { type: 'text', id: 'jv-' + k, value: String(j[k] ?? 0), autocomplete: 'off', inputmode: 'decimal' });
        inp.addEventListener('input', () => set(k, /^-?\d*\.?\d+$/.test(inp.value.trim()) ? +inp.value : inp.value));
        const row = h('div', { class: 'row' }, h('label', { class: 'rl', for: 'jv-' + k }, label), h('div', { class: 'exin' }, inp, h('span', { class: 'val' }), h('span', { class: 'u' }, unit)));
        if (!o.slider) return row;
        const [lo, hi] = k === 'angle' ? [-180, 180] : [-100, 100];
        const sl = h('input', { type: 'range', min: String(lo), max: String(hi), step: k === 'angle' ? '1' : '0.5', value: String(jval(j, k)), 'aria-label': label + ' slider', style: 'width:100%' });
        sl.addEventListener('input', () => { inp.value = sl.value; set(k, +sl.value); });
        return h('div', {}, row, h('div', { class: 'row' }, h('span', { class: 'rl' }), sl));
      };
      const flip = h('input', { type: 'checkbox', id: 'jt-flip', checked: !!j.flip }); flip.addEventListener('change', () => set('flip', flip.checked));
      const dofs = JOINT_TYPES[j.type].dofs;
      const animBtn = h('button', { class: 'btn', type: 'button', id: 'jt-anim', disabled: !dofs.length || st?.state !== 'ok', 'aria-pressed': String(!!jointAnim), onclick: () => { jointAnim ? stopJointAnim() : startJointAnim(j.id); rerenderDialog(); } }, jointAnim ? 'Stop' : 'Animate');
      const nameI = h('input', { type: 'text', id: 'jt-name', value: j.name, autocomplete: 'off' }); nameI.addEventListener('input', () => { checkpoint('jname-' + id); j.name = nameI.value; renderBrowser(); });
      return [
        section_('Position', endRow('a', 'Moves'), endRow('b', 'Attaches to'), st?.msg ? h('p', { class: 'note', style: 'color:var(--err)' }, st.msg) : null),
        section_('Motion', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'jt-type' }, 'Type'), typeSel),
          ...dofs.map(k => num(k, k === 'angle' ? 'Angle' : k === 'distance' ? 'Distance' : k.toUpperCase(), DOF_UNITS[k], { slider: true })),
          num('offset', 'Offset', 'mm'), h('label', { class: 'chk', for: 'jt-flip' }, flip, 'Flip (same direction instead of facing)'),
          dofs.length ? h('div', { class: 'row' }, h('span', { class: 'rl' }), animBtn) : null),
        section_('Name', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'jt-name' }, 'Name'), nameI)),
      ];
    },
    onOK: () => {
      stopJointAnim(); const j = J();
      if (j && (!j.a || !j.b)) { doc.joints = joints().filter(x => x.id !== id); toast('The joint needs two origins, so it was not added'); }
      jointEdit = null; persist(); assemblyChanged(); renderBrowser(); defaultHint();
    },
    onCancel: () => { stopJointAnim(); jointEdit = null; doc = JSON.parse(snap); afterDocReplace(); assemblyChanged(); defaultHint(); },
  });
  assemblyChanged(); defaultHint();
}
// Click on the model while a joint origin is being picked: round edges first, then flat faces.
function jointPickAt(e) {
  if (!jointEdit?.stage) return false;
  const j = joints().find(x => x.id === jointEdit.id); if (!j) return false;
  let end = null;
  const eh = brepEdgeHit(e);
  if (eh?.sig?.type === 'CIRCLE' && eh.sig.cc) end = { body: eh.body, kind: 'edge', sig: eh.sig };
  if (!end) { const fh = brepFaceHit(e); if (fh?.sig) { if (fh.sig.type !== 'PLANE') { toast('Pick a flat face or a round edge'); return true; } end = { body: fh.body, kind: 'face', sig: fh.sig }; } }
  if (!end) return true;
  const other = jointEdit.stage === 'a' ? j.b : j.a;
  if (other && compKey(other.body) === compKey(end.body)) { toast('Both origins would be on ' + compLabel(compKey(end.body)) + '. Pick a different part.'); return true; }
  checkpoint();
  j[jointEdit.stage] = end;
  jointEdit.stage = jointEdit.stage === 'a' && !j.b ? 'b' : null;
  assemblyChanged(); rerenderDialog(); defaultHint();
  return true;
}
function jointHint() { return jointEdit?.stage === 'a' ? 'Click a flat face or round edge on the part that moves' : jointEdit?.stage === 'b' ? 'Click a flat face or round edge on the part it attaches to' : null; }

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
      if (k === 'angle') values.angle = base.angle + (s * 90) % 360;                          // a quarter turn per second
      else { const [lo, hi] = j.range?.distance || [0, 20], ph = (1 - Math.cos(s * Math.PI / 1.5)) / 2; values[k] = k === 'distance' ? lo + (hi - lo) * ph : base[k]; }
    }
    jointPreview = { id, values };
    solveAssembly(); applyBodyTransforms(); drawToolsOverlay(); requestRender();
    jointAnim.raf = requestAnimationFrame(step);
  };
  jointAnim.raf = requestAnimationFrame(step);
}
function stopJointAnim() {
  if (!jointAnim) return;
  cancelAnimationFrame(jointAnim.raf); jointAnim = null; jointPreview = null;
  solveAssembly(); applyBodyTransforms(); drawToolsOverlay(); requestRender();
}

// ---------- overlay: joint origins ----------
function drawJointOverlay(group) {
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
