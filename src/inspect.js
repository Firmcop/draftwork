// ===== Inspect (interference, zebra, curvature comb) and Select (window selection, filters) =====
const inspectOverlay = new THREE.Group(); scene.add(inspectOverlay);
let interferenceShown = null;   // zebraOn, combEdges, combMode, selFilter, multiSel and winSel live in core.js (used while it loads)

// ---- interference ----
async function openInterference() {
  if (!needExact('Interference')) return;
  const ids = [...result.bodies].filter(([id, b]) => b.shape && !bodyHidden(id) && !b.surface).map(([id]) => id);
  if (ids.length < 2) { toast('Interference needs at least two visible solid bodies'); return; }
  toast('Checking ' + ids.length + ' bodies…');
  let res;
  try { res = await engineCall('interfere', { items: ids.map(id => ({ id, tok: result.bodies.get(id).shape, place: bodyXf(id) === IDENT ? null : xfParts(bodyXf(id)) })) }); }
  catch (e) { toast('Could not check interference: ' + e.message); return; }
  clearGroup(inspectOverlay);
  for (const r of res) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe0322f, transparent: true, opacity: 0.75, depthTest: false })); m.renderOrder = 20; inspectOverlay.add(m);
  }
  interferenceShown = res; requestRender();
  const rows = res.map((r, i) => h('tr', {}, h('td', { class: 'num' }, String(i + 1)), h('td', {}, bodyName(r.a)), h('td', {}, bodyName(r.b)), h('td', { class: 'num' }, fmt(r.volume) + ' mm³')));
  const body = h('div', { class: 'tablewrap' }, res.length ? h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['#', 'Body', 'Body', 'Overlap'].map(t => h('th', {}, t)))), h('tbody', {}, rows))
    : h('p', { class: 'note' }, `No interference between the ${ids.length} visible solid bodies.`), res.length ? h('p', { class: 'note' }, 'Overlapping volumes are shown in red until you close this.') : null);
  openModal('Interference', 'interference', body, [h('button', { class: 'btn ok', onclick: () => { closeModal(); clearGroup(inspectOverlay); interferenceShown = null; } }, 'Close')]);
}

// ---- zebra stripes ----
const zebraMat = new THREE.ShaderMaterial({
  uniforms: { stripes: { value: 18 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform float stripes; varying vec3 vN; varying vec3 vV; void main(){ vec3 r = reflect(-vV, normalize(vN)); float s = step(0.5, fract(r.y * stripes * 0.5 + 0.5)); gl_FragColor = vec4(vec3(0.08 + 0.86 * s), 1.0); }',
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
function toggleZebra() { zebraOn = !zebraOn; applyInspectMaterials(); renderRibbon(); toast(zebraOn ? 'Zebra stripes on: smooth surfaces show continuous stripes' : 'Zebra stripes off'); }
function applyInspectMaterials() {
  for (const [, s] of shownBodies) {
    if (zebraOn) { if (!s.mesh.userData.baseMat) s.mesh.userData.baseMat = s.mesh.material; s.mesh.material = zebraMat; }
    else if (s.mesh.userData.baseMat) { s.mesh.material = s.mesh.userData.baseMat; delete s.mesh.userData.baseMat; }
  }
}

// ---- curvature comb on model edges ----
function toggleCombMode() {
  if (!needExact('Curvature comb')) return;
  combMode = !combMode;
  if (!combMode && !combEdges.length) clearGroup(inspectOverlay);
  renderRibbon(); defaultHint();
  toast(combMode ? 'Click curved edges to show their curvature comb · click again to hide · Esc ends' : 'Curvature comb picking ended');
}
function combPickAt(e) {
  if (!combMode) return false;
  const hit = brepEdgeHit(e); if (!hit) return true;
  const i = combEdges.findIndex(c => c.body === hit.body && c.hash === hit.hash);
  if (i >= 0) combEdges.splice(i, 1); else combEdges.push({ body: hit.body, hash: hit.hash });
  drawCombs(); return true;
}
function edgePolyline(body, hash) {
  const s = shownBodies.get(body); if (!s?.rec.shape) return null;
  const m = brepMeshOf(s.rec), pos = m.edgeGeom.attributes.position.array, segs = [];
  const k = p => p.map(x => x.toFixed(4)).join(','), seen = new Set();
  for (let i = 0; i < m.segEdge.length; i++) if (m.segEdge[i] === hash) {
    const A = [pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]], B = [pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5]], key = [k(A), k(B)].sort().join('|');
    if (k(A) !== k(B) && !seen.has(key)) { seen.add(key); segs.push([A, B]); }   // the display lists some segments twice
  }
  if (!segs.length) return null;
  // chain in 3D
  const out = [...segs[0]], left = segs.slice(1);
  for (let grew = true; grew && left.length;) {
    grew = false;
    for (let i = 0; i < left.length; i++) {
      const [a, b] = left[i];
      if (k(a) === k(out.at(-1))) out.push(b); else if (k(b) === k(out.at(-1))) out.push(a); else if (k(b) === k(out[0])) out.unshift(a); else if (k(a) === k(out[0])) out.unshift(b); else continue;
      left.splice(i, 1); grew = true; break;
    }
  }
  return { pts: out.map(p => new THREE.Vector3(...p).applyMatrix4(bodyXf(body))), M: bodyXf(body) };
}
function curvatureSamples(pts) {
  const out = [];
  const closed = pts.length > 3 && pts[0].distanceTo(pts.at(-1)) < 1e-6;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i === 0 ? (closed ? n - 2 : 0) : i - 1], b = pts[i], c = pts[i === n - 1 ? (closed ? 1 : n - 1) : i + 1];
    if (a === b || b === c) { out.push({ p: b, k: 0, n: new THREE.Vector3() }); continue; }
    const ab = b.clone().sub(a), bc = c.clone().sub(b), ac = c.clone().sub(a);
    const cr = ab.clone().cross(bc), denom = ab.length() * bc.length() * ac.length();
    const k = denom > 1e-12 ? 2 * cr.length() / denom : 0;
    const nrm = cr.lengthSq() > 1e-18 ? cr.clone().cross(ac).normalize() : new THREE.Vector3();   // toward the centre of curvature
    out.push({ p: b, k, n: nrm });
  }
  return out;
}
function drawCombs() {
  clearGroup(inspectOverlay);
  for (const ce of combEdges) {
    const pl = edgePolyline(ce.body, ce.hash); if (!pl || pl.pts.length < 3) continue;
    const S = curvatureSamples(pl.pts), len = pl.pts.reduce((s, p, i) => i ? s + p.distanceTo(pl.pts[i - 1]) : 0, 0);
    const kmax = Math.max(...S.map(s => s.k)); if (!(kmax > 1e-9)) continue;
    const scale = 0.25 * len / kmax, teeth = [], env = [];
    for (const s of S) { const tip = s.p.clone().addScaledVector(s.n, -s.k * scale); teeth.push(s.p.x, s.p.y, s.p.z, tip.x, tip.y, tip.z); env.push([tip.x, tip.y, tip.z]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(teeth, 3));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xd9534a, depthTest: false })); ls.renderOrder = 18; inspectOverlay.add(ls);
    const e = line(env, 0x3a7bd5, { depthTest: false, order: 19 }); inspectOverlay.add(e);
    const r = kmax > 1e-9 ? 1 / kmax : Infinity;
    const lab = new CSS2DObject(h('div', { class: 'combtag' }, 'min R ' + fmt(r) + ' mm')); lab.position.copy(S[S.findIndex(s => s.k === kmax)].p); inspectOverlay.add(lab);
  }
  requestRender();
}

// ---- window selection ----
function startWindowSelect() {
  if (mode !== 'model') { toast('Window selection works in the model'); return; }
  winSel = { armed: true }; viewport.classList.add('picking'); setHint('Drag a window: left to right selects bodies fully inside, right to left also those it crosses · Esc cancels');
}
function winDown(e) {
  if (!winSel?.armed || e.button !== 0) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const r = $('#stage').getBoundingClientRect();
  const box = h('div', { class: 'winsel' }); $('#stage').append(box);
  winSel = { x0: e.clientX, y0: e.clientY, box, r };
  const move = ev => { const x = Math.min(ev.clientX, winSel.x0), y = Math.min(ev.clientY, winSel.y0); Object.assign(box.style, { left: x - r.left + 'px', top: y - r.top + 'px', width: Math.abs(ev.clientX - winSel.x0) + 'px', height: Math.abs(ev.clientY - winSel.y0) + 'px' }); box.classList.toggle('cross', ev.clientX < winSel.x0); };
  const up = ev => {
    window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
    box.remove(); viewport.classList.remove('picking');
    const crossing = ev.clientX < winSel.x0, X0 = Math.min(ev.clientX, winSel.x0), X1 = Math.max(ev.clientX, winSel.x0), Y0 = Math.min(ev.clientY, winSel.y0), Y1 = Math.max(ev.clientY, winSel.y0);
    winSel = null;
    if (X1 - X0 < 4 && Y1 - Y0 < 4) { defaultHint(); return; }
    if (!ev.shiftKey) multiSel.clear();
    const rr = renderer.domElement.getBoundingClientRect();
    for (const [id, s] of shownBodies) {
      if (!s.mesh.visible || !passesFilter(s.rec)) continue;
      const g = s.mesh.geometry; g.computeBoundingBox(); const bb = g.boundingBox;
      const pts = []; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = new THREE.Vector3(x, y, z).applyMatrix4(s.mesh.matrixWorld).project(camera); pts.push([rr.left + (v.x + 1) / 2 * rr.width, rr.top + (1 - v.y) / 2 * rr.height]); }
      const inside = pts.every(([x, y]) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1);
      const bx0 = Math.min(...pts.map(p => p[0])), bx1 = Math.max(...pts.map(p => p[0])), by0 = Math.min(...pts.map(p => p[1])), by1 = Math.max(...pts.map(p => p[1]));
      const overlaps = bx0 < X1 && bx1 > X0 && by0 < Y1 && by1 > Y0;
      if (inside || (crossing && overlaps)) multiSel.add(id);
    }
    selBody = multiSel.size === 1 ? [...multiSel][0] : null;
    updateScene(); renderBrowser(); renderSelectionBar(); defaultHint();
    toast(multiSel.size ? `${multiSel.size} bod${multiSel.size === 1 ? 'y' : 'ies'} selected` : 'Nothing inside the window');
  };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
}
viewport.addEventListener('pointerdown', winDown, true);
function renderSelectionBar() {
  document.querySelector('#selbar')?.remove();
  if (multiSel.size < 1) return;
  const ids = [...multiSel].filter(id => result.bodies.has(id));
  const bar = h('div', { id: 'selbar', class: 'selbar', role: 'toolbar', 'aria-label': 'Selection' },
    h('span', {}, `${ids.length} selected`),
    h('button', { class: 'btn', onclick: () => { checkpoint(); for (const id of ids) (doc.bodyMeta[id] ||= {}).hidden = true; multiSel.clear(); updateScene(); renderBrowser(); renderSelectionBar(); } }, 'Hide'),
    h('button', { class: 'btn', onclick: () => { checkpoint(); for (const id of result.bodies.keys()) (doc.bodyMeta[id] ||= {}).hidden = !ids.includes(id); updateScene(); renderBrowser(); } }, 'Isolate'),
    h('button', { class: 'btn', onclick: () => { checkpoint(); for (const id of result.bodies.keys()) if (doc.bodyMeta[id]) doc.bodyMeta[id].hidden = false; updateScene(); renderBrowser(); } }, 'Show all'),
    h('button', { class: 'btn', onclick: () => { checkpoint(); for (const id of ids) insertFeature({ id: uid(), type: 'remove', name: nextName('remove'), body: id }); multiSel.clear(); selBody = null; scheduleRegen(0); renderSelectionBar(); } }, 'Remove'),
    h('button', { class: 'btn', onclick: () => { multiSel.clear(); updateScene(); renderSelectionBar(); } }, 'Clear'));
  $('#stage').append(bar);
}
// ---- selection filters ----
function passesFilter(rec) { if (!rec) return true; if (rec.mesh) return selFilter.meshes; if (rec.surface || (rec.shape && brepProps(rec).surface)) return selFilter.surfaces; return selFilter.solids; }
function openSelectionFilters() {
  const row = (k, label) => { const c = h('input', { type: 'checkbox', id: 'sf-' + k, checked: selFilter[k] }); c.addEventListener('change', () => { selFilter[k] = c.checked; }); return h('label', { class: 'chk', for: c.id }, c, label); };
  openModal('Selection Filters', 'filter', h('div', { class: 'tablewrap' }, h('p', { class: 'note' }, 'What clicking and window selection can pick in the model.'), row('solids', 'Solid bodies'), row('surfaces', 'Surface bodies'), row('meshes', 'Mesh bodies')),
    [h('button', { class: 'btn ok', onclick: closeModal }, 'Done')]);
}
