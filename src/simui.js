// ===== Simulation workspace: linear static stress studies (voxel FEA) =====
// doc.sim = { studies: [study], active }
// study = { id, name, mats: { bodyId: materialName }, mesh: 'coarse'|'medium'|'fine', constraints: [bc], loads: [bc] }
// bc = { id, name, type: 'fixed'|'force'|'pressure'|'gravity', faces: [{ body, sig }], value, dir, x, y, z }
const SIM_MATERIALS = {   // E (MPa), Poisson ratio, yield strength (MPa)
  'Aluminum 6061': [68900, 0.33, 276], 'Steel 1018': [205000, 0.29, 370], 'Stainless steel 304': [193000, 0.29, 215], 'Brass C360': [97000, 0.31, 310],
  'Copper C110': [115000, 0.33, 69], 'Titanium Ti-6Al-4V': [113800, 0.34, 880], 'ABS plastic': [2300, 0.35, 40], 'PLA plastic': [3500, 0.36, 50], 'Nylon PA12': [1700, 0.39, 48], 'Oak wood': [12000, 0.3, 40],
};
const MESH_TARGET = { coarse: 4000, medium: 12000, fine: 30000 };
const SIM_DIRS = [['normal', 'Normal to face (into it)'], ['+X', '+X'], ['-X', '−X'], ['+Y', '+Y'], ['-Y', '−Y'], ['+Z', '+Z'], ['-Z', '−Z']];
const simGroup = new THREE.Group(); scene.add(simGroup);
let simRes = null, simPick = null, simView = { type: 'vm', scale: 'auto' }, simCancel = false;
const sim = () => doc.sim || (doc.sim = { studies: [], active: null });
const simStudy = () => { const S = sim(); return S.studies.find(s => s.id === S.active) || S.studies[0] || null; };
const simMat = (st, id) => (st.mats && st.mats[id]) || bodyMaterial(id);
const simBodies = () => [...result.bodies.keys()].filter(id => !bodyHidden(id) && !isSurfBody(id) && result.bodies.get(id).shape);

// ---- workspace ----
function enterSimulation() {
  if (!needExact('Simulation')) return;
  if (!simBodies().length) { toast('There is no solid body to simulate'); return; }
  if (workspace === 'drawing') exitDrawing(); if (workspace === 'manufacture') exitManufacture();
  if (mode === 'sketch') finishSketch(true); if (dlg) closeDialog(true);
  workspace = 'simulation'; document.body.classList.add('ws-simulation'); $('#wsBtn span').textContent = 'SIMULATION';
  activeTab = 'STATIC STRESS';
  if (!sim().studies.length) { const s = { id: uid(), name: 'Static Stress 1', mats: {}, mesh: 'medium', constraints: [], loads: [] }; sim().studies.push(s); sim().active = s.id; }
  renderRibbon(); renderBrowser(); drawSim2(); defaultHint();
}
function exitSimulation() {
  workspace = 'design'; document.body.classList.remove('ws-simulation'); $('#wsBtn span').textContent = 'DESIGN';
  simPick = null; clearGroup(simGroup); $('#simLegend')?.remove(); for (const [, sb] of shownBodies) sb.mesh.visible = sb.edges.visible = !bodyHidden(sb.rec.id);
  activeTab = 'SOLID'; renderRibbon(); renderBrowser(); updateScene(); defaultHint(); requestRender();
}
function simHint() {
  if (simPick) return 'Click faces on the model to add or remove them · OK when done';
  if (simRes) return 'Results: ' + ({ vm: 'von Mises stress', disp: 'displacement', sf: 'safety factor' }[simView.type]) + '. Change the result or deformation scale in Results.';
  return 'Set materials, add constraints and loads, then Solve.';
}
// ---- face geometry in world coordinates ----
function faceTris(f) {
  const b = result.bodies.get(f.body); if (!b?.shape) return null;
  const hs = brepRefHashes(b, [f.sig], 'face'); if (!hs.size) return null;
  const m = brepMeshOf(b), idx = m.display.index.array, P = m.display.attributes.position.array, M = bodyXf(f.body), out = [], v = new THREE.Vector3();
  for (let t = 0; t < m.triFace.length; t++) if (hs.has(m.triFace[t])) for (let k = 0; k < 3; k++) { const q = idx[3 * t + k]; v.set(P[3 * q], P[3 * q + 1], P[3 * q + 2]).applyMatrix4(M); out.push(v.x, v.y, v.z); }
  return out;
}
function closestOnTri(p, a, b, c) {   // Ericson, returns squared distance
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2], d1 = dot(ab, ap), d2 = dot(ac, ap);
  const D = q => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  if (d1 <= 0 && d2 <= 0) return D(a);
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return D(b);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return D([a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]); }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return D(c);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return D([a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return D([b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return D([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}
// surface nodes close to a set of faces, with the outward normal of the nearest triangle and the faces' area
function nodesOnFaces(M, surf, faces) {
  const T = []; for (const f of faces) { const t = faceTris(f); if (t) T.push(...t); }
  if (!T.length) return { nodes: [], area: 0 };
  let area = 0; const tris = [];
  for (let i = 0; i < T.length; i += 9) {
    const a = T.slice(i, i + 3), b = T.slice(i + 3, i + 6), c = T.slice(i + 6, i + 9), n = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    area += n.length() / 2; tris.push({ a, b, c, n: n.normalize().toArray() });
  }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], T[i + k]); hi[k] = Math.max(hi[k], T[i + k]); }
  const h = Math.max(...M.grid.hs);
  for (const tol of [0.75 * h, 1.3 * h]) {
    const out = [];
    for (let q = 0; q < M.nn; q++) {
      if (!surf[q]) continue; const p = nodePos(M, q);
      if (p[0] < lo[0] - tol || p[1] < lo[1] - tol || p[2] < lo[2] - tol || p[0] > hi[0] + tol || p[1] > hi[1] + tol || p[2] > hi[2] + tol) continue;
      let bd = Infinity, bn = null; for (const t of tris) { const d = closestOnTri(p, t.a, t.b, t.c); if (d < bd) { bd = d; bn = t.n; } }
      if (bd <= tol * tol) out.push({ q, n: bn });
    }
    if (out.length) return { nodes: out, area };
  }
  return { nodes: [], area };
}
const DIRV = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
// ---- solve ----
async function solveStudy() {
  const st = simStudy(); if (!st) return;
  if (!st.constraints.length) { toast('Add a constraint first: the part needs to be held somewhere'); return; }
  if (!st.loads.length) { toast('Add a load first'); return; }
  const ids = simBodies(), matNames = [], bodies = [];
  for (const id of ids) {
    const b = result.bodies.get(id), g = brepGeomNI(b), p = g.attributes.position.array, M = bodyXf(id), v = new THREE.Vector3(), t = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(M); t[i] = v.x; t[i + 1] = v.y; t[i + 2] = v.z; }
    const mn = simMat(st, id); let mi = matNames.indexOf(mn); if (mi < 0) { matNames.push(mn); mi = matNames.length - 1; }
    bodies.push({ tris: t, mi, id });
  }
  // bodies sharing a material are voxelised as one material slot; contact between bodies is bonded
  const groups = matNames.map((mn, mi) => ({ tris: concatF32(bodies.filter(b => b.mi === mi).map(b => b.tris)) }));
  const vol = ids.reduce((s, id) => s + brepProps(result.bodies.get(id)).volume, 0), h = Math.cbrt(vol / (MESH_TARGET[st.mesh] || 12000));
  simCancel = false; const busy = $('#busy'); busy.hidden = false; busy.textContent = 'Meshing…'; await new Promise(r => setTimeout(r, 30));
  try {
    const grid = voxelize(groups, h), mats = matNames.map(mn => { const m = SIM_MATERIALS[mn] || SIM_MATERIALS['Steel 1018']; return { name: mn, E: m[0], nu: m[1], yield: m[2], density: MATERIALS[mn]?.density || 7.85 }; });
    const M = buildModel(grid, mats); if (!M.ne) throw new Error('The mesh is empty');
    const surf = surfaceNodes(M), fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3), warn = [];
    for (const c of st.constraints) {
      const r = nodesOnFaces(M, surf, c.faces); if (!r.nodes.length) { warn.push(`${c.name}: no mesh nodes on its faces`); continue; }
      for (const { q } of r.nodes) { if (c.x !== false) fixed[3 * q] = 1; if (c.y !== false) fixed[3 * q + 1] = 1; if (c.z !== false) fixed[3 * q + 2] = 1; }
    }
    let applied = [0, 0, 0];
    for (const L of st.loads) {
      if (L.type === 'gravity') {
        const d = DIRV[L.dir || '-Z'] || [0, 0, -1], gacc = (+L.value || 9.81);
        for (let e = 0; e < M.ne; e++) { const m = mats[M.em[e]], w = m.density * grid.hs[0] * grid.hs[1] * grid.hs[2] * 1e-6 * gacc / 8; for (let a = 0; a < 8; a++) { const q = M.en[e * 8 + a]; for (let k = 0; k < 3; k++) { f[3 * q + k] += d[k] * w; applied[k] += d[k] * w; } } }
        continue;
      }
      const r = nodesOnFaces(M, surf, L.faces); if (!r.nodes.length) { warn.push(`${L.name}: no mesh nodes on its faces`); continue; }
      const total = L.type === 'pressure' ? (+L.value || 0) * r.area : (+L.value || 0), per = total / r.nodes.length;
      for (const { q, n } of r.nodes) { const d = L.type === 'pressure' || (L.dir || 'normal') === 'normal' ? [-n[0], -n[1], -n[2]] : DIRV[L.dir]; for (let k = 0; k < 3; k++) { f[3 * q + k] += d[k] * per; applied[k] += d[k] * per; } }
    }
    if (!fixed.some(Boolean)) throw new Error('The constraints did not catch any part of the mesh');
    const t0 = performance.now();
    const R = await solveStatic(M, fixed, f, { tol: 1e-7, maxIter: 30000, onProgress: async (it, res) => { busy.textContent = `Solving… ${M.ne.toLocaleString('en-US')} elements · iteration ${it} · residual ${res.toExponential(1)} (click to stop)`; await new Promise(r => setTimeout(r, 0)); return simCancel; } });
    if (simCancel) { toast('Solve stopped'); return; }
    const disp = new Float64Array(M.nn); for (let q = 0; q < M.nn; q++) disp[q] = Math.hypot(R.u[3 * q], R.u[3 * q + 1], R.u[3 * q + 2]);
    const vmN = R.vmNode, yE = new Float64Array(M.ne); for (let e = 0; e < M.ne; e++) yE[e] = mats[M.em[e]].yield;
    const yN = nodalAverage(M, yE), sfN = new Float64Array(M.nn); for (let q = 0; q < M.nn; q++) sfN[q] = vmN[q] > 1e-12 ? yN[q] / vmN[q] : 1e9;
    let vmax = 0, vmaxQ = 0; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && vmN[q] > vmax) { vmax = vmN[q]; vmaxQ = q; }
    let dmax = 0, dmaxQ = 0; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && disp[q] > dmax) { dmax = disp[q]; dmaxQ = q; }
    let sfmin = Infinity; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q]) sfmin = Math.min(sfmin, sfN[q]);
    simRes = { st: st.id, M, R, disp, vmN, sfN, vmax, vmaxAt: nodePos(M, vmaxQ), dmax, dmaxAt: nodePos(M, dmaxQ), sfmin, applied, warn, mats, seconds: (performance.now() - t0) / 1000, h, key: simKey(st) };
    if (!R.converged) warn.push(`The solver stopped at a residual of ${R.residual.toExponential(1)}; results may be inaccurate. Check that the constraints hold the part in every direction.`);
    if (warn.length) toast(warn[0]);
    renderBrowser(); drawSim2(); defaultHint();
  } catch (e) { console.error(e); toast('Solve failed: ' + e.message); }
  finally { busy.hidden = true; busy.textContent = 'Computing…'; }
}
const concatF32 = arrs => { const n = arrs.reduce((s, a) => s + a.length, 0), o = new Float32Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
const simKey = st => JSON.stringify(st) + '|' + [...result.bodies.values()].map(b => b.shape).join(',');
// ---- display ----
function heat(t) {   // blue → cyan → green → yellow → red
  t = Math.max(0, Math.min(1, t));
  const stops = [[0.15, 0.3, 0.85], [0.1, 0.75, 0.9], [0.25, 0.8, 0.3], [0.95, 0.85, 0.15], [0.9, 0.2, 0.15]], x = t * 4, i = Math.min(3, Math.floor(x)), u = x - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
function drawSim2() {
  clearGroup(simGroup); $('#simLegend')?.remove();
  if (workspace !== 'simulation') { requestRender(); return; }
  const st = simStudy(); if (!st) return;
  const showRes = simRes && simRes.st === st.id && simRes.key === simKey(st);
  for (const [, sb] of shownBodies) { sb.mesh.visible = !showRes && !bodyHidden(sb.rec.id); sb.edges.visible = !bodyHidden(sb.rec.id) && !showRes; }
  if (showRes) drawResults(); else drawBCs(st);
  requestRender();
}
function drawBCs(st) {
  const tint = (faces, col) => { for (const f of faces) { const t = faceTris(f); if (!t) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3)); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 8; simGroup.add(m); } };
  for (const c of st.constraints) tint(c.faces, 0x2e86de);
  for (const L of st.loads) {
    if (L.type === 'gravity') continue;
    tint(L.faces, L.type === 'pressure' ? 0xe67e22 : 0xc0392b);
    // arrows at face centres
    for (const f of L.faces) {
      const t = faceTris(f); if (!t?.length) continue; const c = [0, 0, 0]; for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) c[k] += t[i + k] / (t.length / 3);
      const sig = placedSigSim(f), d = L.type === 'pressure' || (L.dir || 'normal') === 'normal' ? sig.n.map(x => -x) : DIRV[L.dir];
      const len = Math.max(8, planeSize() * 0.12), dir = new THREE.Vector3(...d).normalize(), tail = new THREE.Vector3(...c).addScaledVector(dir, -len);
      simGroup.add(new THREE.ArrowHelper(dir, tail, len, 0xc0392b, len * 0.3, len * 0.18));
    }
  }
  if (simPick) { const it = simItem(simPick); if (it) tint(it.faces, 0xf1c40f); }
}
function placedSigSim(f) { const M = bodyXf(f.body); return M === IDENT ? f.sig : { ...f.sig, n: new THREE.Vector3(...f.sig.n).transformDirection(M).toArray() }; }
function drawResults() {
  const S = simRes, M = S.M, type = simView.type;
  const field = type === 'disp' ? S.disp : type === 'sf' ? S.sfN : S.vmN;
  let lo = Infinity, hi = -Infinity;
  for (let q = 0; q < M.nn; q++) if (M.nodeActive[q]) { lo = Math.min(lo, field[q]); hi = Math.max(hi, field[q]); }
  if (type === 'sf') { lo = 0; hi = Math.min(Math.max(1, S.sfmin * 3), 15); }
  const diag = (() => { let b = new THREE.Box3(); for (const id of simBodies()) { const g = bodyGeomOf(result.bodies.get(id)); g.computeBoundingBox(); b.union(g.boundingBox.clone().applyMatrix4(bodyXf(id))); } return b.getSize(new THREE.Vector3()).length(); })();
  const k = simView.scale === 'actual' ? 1 : simView.scale === 'none' ? 0 : S.dmax > 1e-12 ? diag * 0.05 / S.dmax : 0;
  S.scale = k;
  for (const id of simBodies()) {
    const b = result.bodies.get(id), m = brepMeshOf(b), src = m.display, P = src.attributes.position.array, Mx = bodyXf(id), n = P.length / 3;
    const pos = new Float32Array(P.length), col = new Float32Array(P.length), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).applyMatrix4(Mx); const p = [v.x, v.y, v.z];
      const val = sampleNodal(M, field, p), u = [0, 1, 2].map(c => sampleNodal(M, S.R.u, p, 3, c));
      pos[3 * i] = p[0] + k * u[0]; pos[3 * i + 1] = p[1] + k * u[1]; pos[3 * i + 2] = p[2] + k * u[2];
      const t = hi > lo ? (val - lo) / (hi - lo) : 0, c = heat(type === 'sf' ? 1 - t : t); col.set(c, 3 * i);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(src.index.clone()); g.computeVertexNormals();
    simGroup.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0 })));
    if (k > 0) { const ghost = new THREE.LineSegments(m.edgeGeom, new THREE.LineBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.35 })); ghost.matrixAutoUpdate = false; ghost.matrix.copy(Mx); simGroup.add(ghost); }
  }
  // max markers
  const mark = (p, label) => { const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, diag * 0.008), 12, 8), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })); s.position.set(...p); s.renderOrder = 20; simGroup.add(s); const o = new CSS2DObject(h('div', { class: 'combtag' }, label)); o.position.set(...p); simGroup.add(o); };
  if (type === 'vm') mark(S.vmaxAt, 'Max ' + fmt(S.vmax) + ' MPa'); else if (type === 'disp') mark(S.dmaxAt.map((x, i) => x + k * S.R.u[3 * simResMaxQ(S) + i]), 'Max ' + fmt(S.dmax) + ' mm'); else mark(S.vmaxAt, 'Min ' + fmt(S.sfmin));
  // legend
  const title = { vm: 'Stress (von Mises) MPa', disp: 'Displacement mm', sf: 'Safety factor' }[type], stops = [];
  for (let i = 0; i <= 10; i++) { const c = heat(type === 'sf' ? 1 - i / 10 : i / 10); stops.push(`rgb(${c.map(x => Math.round(x * 255)).join(',')}) ${i * 10}%`); }
  const lg = h('div', { id: 'simLegend', class: 'simlegend' }, h('div', { class: 'lt' }, title), h('div', { class: 'lbar', style: `background:linear-gradient(to top, ${stops.join(',')})` }),
    h('div', { class: 'lmax' }, (type === 'sf' && hi >= 15 ? '≥ ' : '') + fmtSig(hi)), h('div', { class: 'lmin' }, fmtSig(lo)),
    h('div', { class: 'lnote' }, k > 0 ? `Deformation ×${fmtSig(k)}` : 'Undeformed'));
  $('#stage').append(lg);
}
const simResMaxQ = S => { let b = 0, bd = -1; for (let q = 0; q < S.M.nn; q++) if (S.M.nodeActive[q] && S.disp[q] > bd) { bd = S.disp[q]; b = q; } return b; };
const fmtSig = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(2) : (+v.toPrecision(3)).toString();
// ---- browser ----
function renderSimBrowser(add) {
  const S = sim(), st = simStudy(); if (!st) return;
  if (!add(0, { key: 'simroot', icon: 'analysis', label: st.name, sub: 'Static stress' })) return;
  if (add(1, { key: 'simmat', icon: 'material', label: 'Materials' })) for (const id of simBodies()) add(2, { icon: 'bodyi', label: bodyName(id), sub: simMat(st, id), onDbl: () => openSimMaterials(), onClick: () => openSimMaterials() });
  if (add(1, { key: 'simbc', icon: 'folder', label: 'Constraints', sub: String(st.constraints.length) })) for (const c of st.constraints) add(2, { icon: 'fix', label: c.name, sub: `${c.faces.length} face${c.faces.length === 1 ? '' : 's'}`, onDbl: () => editBC(c.id), onClick: () => editBC(c.id), menu: () => [{ label: 'Edit', icon: 'params', action: () => editBC(c.id) }, { label: 'Delete', icon: 'delete', action: () => deleteBC(c.id) }] });
  if (add(1, { key: 'simld', icon: 'folder', label: 'Loads', sub: String(st.loads.length) })) for (const L of st.loads) add(2, { icon: L.type === 'gravity' ? 'com' : 'move', label: L.name, sub: L.type === 'gravity' ? `${L.value} m/s² ${L.dir}` : L.type === 'pressure' ? `${L.value} MPa` : `${L.value} N`, onDbl: () => editBC(L.id), onClick: () => editBC(L.id), menu: () => [{ label: 'Edit', icon: 'params', action: () => editBC(L.id) }, { label: 'Delete', icon: 'delete', action: () => deleteBC(L.id) }] });
  add(1, { icon: 'remesh', label: 'Mesh', sub: st.mesh + ` (~${(MESH_TARGET[st.mesh] / 1000) | 0}k elements)`, onClick: () => openSimMesh() });
  if (simRes && simRes.st === st.id && simRes.key === simKey(st) && add(1, { key: 'simres', icon: 'analysis', label: 'Results' })) {
    add(2, { icon: 'analysis', label: 'Stress (von Mises)', sub: 'max ' + fmt(simRes.vmax) + ' MPa', sel: simView.type === 'vm', onClick: () => { simView.type = 'vm'; drawSim2(); renderBrowser(); } });
    add(2, { icon: 'move', label: 'Displacement', sub: 'max ' + fmt(simRes.dmax) + ' mm', sel: simView.type === 'disp', onClick: () => { simView.type = 'disp'; drawSim2(); renderBrowser(); } });
    add(2, { icon: 'fix', label: 'Safety factor', sub: 'min ' + (simRes.sfmin > 1e6 ? '—' : fmt(simRes.sfmin)), sel: simView.type === 'sf', err: simRes.sfmin < 1, onClick: () => { simView.type = 'sf'; drawSim2(); renderBrowser(); } });
  } else if (simRes && simRes.st === st.id) add(1, { icon: 'analysis', label: 'Results out of date', sub: 'Solve again', dim: true, onClick: () => solveStudy() });
}
// ---- dialogs ----
const simItem = id => { const st = simStudy(); return st && ([...st.constraints, ...st.loads].find(x => x.id === id) || null); };
function deleteBC(id) { const st = simStudy(); checkpoint(); st.constraints = st.constraints.filter(x => x.id !== id); st.loads = st.loads.filter(x => x.id !== id); persist(); renderBrowser(); drawSim2(); }
function newBC(type) {
  const st = simStudy(); if (!st) return;
  const list = type === 'fixed' ? st.constraints : st.loads, label = { fixed: 'Fixed', force: 'Force', pressure: 'Pressure', gravity: 'Gravity' }[type];
  const it = { id: uid(), name: label + ' ' + (list.filter(x => x.type === type).length + 1), type, faces: [], value: type === 'force' ? 100 : type === 'pressure' ? 1 : 9.81, dir: type === 'gravity' ? '-Z' : 'normal', x: true, y: true, z: true };
  const snap = JSON.stringify(doc.sim); checkpoint(); list.push(it); persist();
  editBC(it.id, snap, true);
}
function editBC(id, snap = JSON.stringify(doc.sim), isNew = false) {
  const it = simItem(id); if (!it) return;
  simPick = it.type === 'gravity' ? null : it.id; drawSim2();
  const live = () => { drawSim2(); renderBrowser(); };
  const body = () => {
    const out = [];
    if (it.type !== 'gravity') out.push(section_('Faces', h('p', { class: 'note' }, it.faces.length ? `${it.faces.length} face${it.faces.length > 1 ? 's' : ''} selected. Click faces on the model to add or remove.` : 'Click the faces on the model.')));
    if (it.type === 'fixed') out.push(section_('Fixed directions', chkField('X', it, 'x', { after: live }), chkField('Y', it, 'y', { after: live }), chkField('Z', it, 'z', { after: live }), h('p', { class: 'note' }, 'Untick a direction to let the faces slide that way (for example a frictionless support).')));
    if (it.type === 'force') out.push(section_('Force', exField('Magnitude (total)', it, 'value', 'N', { after: live, id: 'sb-value' }), selField('Direction', it, 'dir', SIM_DIRS, { after: live })));
    if (it.type === 'pressure') out.push(section_('Pressure', exField('Pressure', it, 'value', 'MPa', { after: live, id: 'sb-value' }), h('p', { class: 'note' }, '1 MPa = 1 N/mm². Positive pushes into the faces.')));
    if (it.type === 'gravity') out.push(section_('Gravity', exField('Acceleration', it, 'value', 'm/s²', { after: live, id: 'sb-value' }), selField('Direction', it, 'dir', SIM_DIRS.slice(1), { after: live })));
    out.push(section_(null, row('Name', (() => { const i = h('input', { type: 'text', id: 'sb-name', value: it.name }); i.addEventListener('input', () => { it.name = i.value; renderBrowser(); }); i.addEventListener('keydown', e => e.stopPropagation()); return i; })(), 'sb-name')));
    return out;
  };
  openPanelDialog({ title: { fixed: 'Fixed Constraint', force: 'Force', pressure: 'Pressure', gravity: 'Gravity' }[it.type], icon: it.type === 'fixed' ? 'fix' : 'move', okLabel: 'OK', body,
    help: it.type === 'fixed' ? 'Fixed faces cannot move. Every study needs at least one.' : 'The load is spread evenly over the selected faces.',
    onOK: () => { simPick = null; const now = JSON.stringify(doc.sim); doc.sim = JSON.parse(snap); if (!isNew) checkpoint(); doc.sim = JSON.parse(now); persist(); renderBrowser(); drawSim2(); defaultHint(); },
    onCancel: () => { simPick = null; doc.sim = JSON.parse(snap); renderBrowser(); drawSim2(); defaultHint(); } });
  defaultHint();
}
function simPickAt(e) {
  if (workspace !== 'simulation' || !simPick) return false;
  const it = simItem(simPick); if (!it) return false;
  const hit = brepFaceHit(e); if (!hit?.sig) return true;
  const i = it.faces.findIndex(f => f.body === hit.body && brepRefHashes(hit.rec, [f.sig], 'face').has(hit.hash));
  if (i >= 0) it.faces.splice(i, 1); else it.faces.push({ body: hit.body, sig: JSON.parse(JSON.stringify(hit.sig)) });
  rerenderDialog(); drawSim2();
  return true;
}
function openSimMaterials() {
  const st = simStudy(); if (!st) return;
  const work = { ...(st.mats || {}) };
  const rows = simBodies().map(id => {
    const s = h('select', { 'aria-label': 'Material of ' + bodyName(id), id: 'sm-' + id.replace(/\W/g, '_') }, ...Object.keys(SIM_MATERIALS).map(m => h('option', { value: m, selected: (work[id] || bodyMaterial(id)) === m }, m)));
    s.addEventListener('change', () => { work[id] = s.value; });
    const p = SIM_MATERIALS[work[id] || bodyMaterial(id)] || [];
    return h('tr', {}, h('td', {}, bodyName(id)), h('td', {}, s), h('td', { class: 'num' }, p[0] ? fmt(p[0] / 1000) + ' GPa' : ''), h('td', { class: 'num' }, p[2] ? p[2] + ' MPa' : ''));
  });
  openModal('Study Materials', 'material', h('div', { class: 'tablewrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['Body', 'Material', 'Young’s modulus', 'Yield'].map(t => h('th', {}, t)))), h('tbody', {}, rows)),
    h('p', { class: 'note' }, 'Linear elastic, isotropic. Bodies that touch are treated as bonded.')),
    [h('button', { class: 'btn ok', onclick: () => { checkpoint(); st.mats = work; persist(); closeModal(); renderBrowser(); drawSim2(); } }, 'OK'), h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
function openSimMesh() {
  const st = simStudy(); if (!st) return; const snap = JSON.stringify(doc.sim);
  openPanelDialog({ title: 'Mesh', icon: 'remesh', okLabel: 'OK', help: 'Finer meshes are more accurate near small features but take longer to solve.',
    body: () => [section_('Mesh', segField('Size', st, 'mesh', [['coarse', 'Coarse'], ['medium', 'Medium'], ['fine', 'Fine']], { after: renderBrowser }), h('p', { class: 'note' }, 'Cube elements (8-node with bending modes) sized to the volume: about 4k, 12k or 30k elements.'))],
    onOK: () => { const now = JSON.stringify(doc.sim); doc.sim = JSON.parse(snap); checkpoint(); doc.sim = JSON.parse(now); persist(); renderBrowser(); drawSim2(); }, onCancel: () => { doc.sim = JSON.parse(snap); renderBrowser(); } });
}
function openSimResults() {
  if (!simRes) { toast('Solve the study first'); return; }
  openPanelDialog({ title: 'Results', icon: 'analysis', okLabel: 'Close', help: 'Stress concentrates at sharp inside corners and at the edges of fixed faces; refine the mesh to check such peaks.',
    body: () => [section_('Show', segField('Result', simView, 'type', [['vm', 'Stress'], ['disp', 'Displacement'], ['sf', 'Safety factor']], { after: () => { drawSim2(); renderBrowser(); } }),
      segField('Deformation', simView, 'scale', [['auto', 'Exaggerated'], ['actual', 'Actual'], ['none', 'None']], { after: drawSim2 })),
      section_('Summary', h('dl', { class: 'stat' }, ...simSummary().flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'sim-report', onclick: () => simReport() }, 'Save report (.zip)'))],
    onOK: () => {}, onCancel: () => {} });
}
function simSummary() {
  const S = simRes;
  return [['Max stress', fmt(S.vmax) + ' MPa'], ['Max displacement', fmt(S.dmax) + ' mm'], ['Min safety factor', S.sfmin > 1e6 ? '—' : fmt(S.sfmin)], ['Applied load', S.applied.map(v => fmt(v)).join(', ') + ' N'], ['Reaction', S.R.reaction.map(v => fmt(v)).join(', ') + ' N'],
    ['Mesh', `${S.M.ne.toLocaleString('en-US')} elements of ${fmt(S.h)} mm`], ['Solver', `${S.R.iterations} iterations · ${fmt(S.seconds)} s`]];
}
function simReport() {
  const S = simRes, st = simStudy(), esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  renderer.render(scene, camera); let img = ''; try { img = renderer.domElement.toDataURL('image/png'); } catch (e) { }
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(doc.name)} – ${esc(st.name)}</title><style>body{font:13px system-ui,sans-serif;margin:24px;color:#222;max-width:900px}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #bbb;padding:4px 8px;text-align:left}th{background:#eee}img{max-width:100%;border:1px solid #ccc}</style>
<h1>${esc(doc.name)} — ${esc(st.name)}</h1><p>Linear static stress, voxel finite elements. ${new Date().toISOString().slice(0, 10)}</p>
${img ? `<img src="${img}" alt="Result plot">` : ''}
<h2>Results</h2><table>${simSummary().map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>Materials</h2><table><tr><th>Body</th><th>Material</th><th>E (MPa)</th><th>ν</th><th>Yield (MPa)</th></tr>${simBodies().map(id => { const m = simMat(st, id), p = SIM_MATERIALS[m] || []; return `<tr><td>${esc(bodyName(id))}</td><td>${esc(m)}</td><td>${p[0]}</td><td>${p[1]}</td><td>${p[2]}</td></tr>`; }).join('')}</table>
<h2>Constraints and loads</h2><table><tr><th>Name</th><th>Type</th><th>Value</th><th>Faces</th></tr>${[...st.constraints, ...st.loads].map(b => `<tr><td>${esc(b.name)}</td><td>${b.type}</td><td>${b.type === 'fixed' ? ['x', 'y', 'z'].filter(k => b[k] !== false).join(' ').toUpperCase() : b.value + (b.type === 'force' ? ' N ' + b.dir : b.type === 'pressure' ? ' MPa' : ' m/s² ' + b.dir)}</td><td>${b.faces?.length || '—'}</td></tr>`).join('')}</table>
<p>Results are linear elastic: stresses above the yield strength mean the part would deform permanently and the numbers there are no longer valid. Peaks at sharp corners and at fixed edges depend on the mesh.</p>`;
  saveFile(slug() + '-simulation.zip', makeZip([{ name: slug() + '-simulation.html', data: html }]), 'application/zip');
}
// ribbon commands
cmd('sim.study', 'New Study', 'analysis', { run: () => { checkpoint(); const s = { id: uid(), name: 'Static Stress ' + (sim().studies.length + 1), mats: {}, mesh: 'medium', constraints: [], loads: [] }; sim().studies.push(s); sim().active = s.id; simRes = null; persist(); renderBrowser(); drawSim2(); } });
cmd('sim.mats', 'Study Materials', 'material', { run: () => openSimMaterials() });
cmd('sim.fixed', 'Fixed', 'fix', { run: () => newBC('fixed') });
cmd('sim.force', 'Force', 'move', { run: () => newBC('force') });
cmd('sim.pressure', 'Pressure', 'presspull', { run: () => newBC('pressure') });
cmd('sim.gravity', 'Gravity', 'com', { run: () => newBC('gravity') });
cmd('sim.mesh', 'Mesh Settings', 'remesh', { run: () => openSimMesh() });
cmd('sim.solve', 'Solve', 'start', { run: () => solveStudy() });
cmd('sim.results', 'Results', 'analysis', { run: () => openSimResults() });
cmd('sim.report', 'Report', 'exportstl', { run: () => simRes ? simReport() : toast('Solve the study first') });

$('#busy').addEventListener('click', () => { simCancel = true; });
