// ===== Simulation workspace: static stress, modal frequencies and steady-state thermal studies (voxel FEA) =====
// doc.sim = { studies: [study], active }
// study = { id, name, kind: 'static'|'modal'|'thermal', mats: { bodyId: materialName }, mesh: 'coarse'|'medium'|'fine', constraints: [bc], loads: [bc], modes }
// bc = { id, name, type: 'fixed'|'force'|'pressure'|'gravity'|'temp'|'heat'|'conv', faces: [{ body, sig }], value, dir, x, y, z, ambient }
const SIM_MATERIALS = {   // E (MPa), Poisson ratio, yield strength (MPa)
  'Aluminum 6061': [68900, 0.33, 276], 'Steel 1018': [205000, 0.29, 370], 'Stainless steel 304': [193000, 0.29, 215], 'Brass C360': [97000, 0.31, 310],
  'Copper C110': [115000, 0.33, 69], 'Titanium Ti-6Al-4V': [113800, 0.34, 880], 'ABS plastic': [2300, 0.35, 40], 'PLA plastic': [3500, 0.36, 50], 'Nylon PA12': [1700, 0.39, 48], 'Oak wood': [12000, 0.3, 40],
};
// thermal conductivity W/(m·K)
const SIM_THERMAL = { 'Aluminum 6061': 167, 'Steel 1018': 51.9, 'Stainless steel 304': 16.2, 'Brass C360': 115, 'Copper C110': 388, 'Titanium Ti-6Al-4V': 6.7, 'ABS plastic': 0.17, 'PLA plastic': 0.13, 'Nylon PA12': 0.25, 'Oak wood': 0.17 };
// thermal expansion 1/K
const SIM_ALPHA = { 'Aluminum 6061': 23.6e-6, 'Steel 1018': 12.0e-6, 'Stainless steel 304': 17.3e-6, 'Brass C360': 20.5e-6, 'Copper C110': 17.0e-6, 'Titanium Ti-6Al-4V': 8.6e-6, 'ABS plastic': 90e-6, 'PLA plastic': 68e-6, 'Nylon PA12': 110e-6, 'Oak wood': 5e-6 };
const SIM_KINDS = { static: ['Static Stress', 'STATIC STRESS', 'analysis'], modal: ['Modal Frequencies', 'MODAL FREQUENCIES', 'modes'], thermal: ['Thermal', 'THERMAL', 'thermo'], thermalstress: ['Thermal Stress', 'THERMAL STRESS', 'heat'], buckling: ['Linear Buckling', 'LINEAR BUCKLING', 'buckle'] };
const SIM_TABS = Object.values(SIM_KINDS).map(k => k[1]);
const isStructural = k => k === 'static' || k === 'thermalstress' || k === 'buckling';
const hasThermal = k => k === 'thermal' || k === 'thermalstress';
const isModeKind = k => k === 'modal' || k === 'buckling';
const BC_LABEL = { fixed: 'Fixed', force: 'Force', pressure: 'Pressure', gravity: 'Gravity', temp: 'Temperature', heat: 'Heat Source', conv: 'Convection' };
const MESH_TARGET = { coarse: 4000, medium: 12000, fine: 30000 };
const SIM_DIRS = [['normal', 'Normal to face (into it)'], ['+X', '+X'], ['-X', '−X'], ['+Y', '+Y'], ['-Y', '−Y'], ['+Z', '+Z'], ['-Z', '−Z']];
const simGroup = new THREE.Group(); scene.add(simGroup);
let simRes = null, simPick = null, simView = { type: 'vm', scale: 'auto', mode: 0, anim: false }, simCancel = false, simAnimId = 0;
const sim = () => doc.sim || (doc.sim = { studies: [], active: null });
const simStudy = () => { const S = sim(); return S.studies.find(s => s.id === S.active) || S.studies[0] || null; };
const simMat = (st, id) => (st.mats && st.mats[id]) || bodyMaterial(id);
const simKind = st => (st && st.kind) || 'static';
const simTabName = () => SIM_KINDS[simKind(simStudy())][1];
function newStudy(kind) {
  const n = sim().studies.filter(s => simKind(s) === kind).length + 1;
  const s = { id: uid(), name: SIM_KINDS[kind][0] + ' ' + n, kind, mats: {}, mesh: kind === 'modal' ? 'coarse' : 'medium', constraints: [], loads: [] };
  if (kind === 'modal') s.modes = 8;
  if (kind === 'buckling') s.modes = 4;
  if (kind === 'thermalstress') s.refTemp = 20;
  sim().studies.push(s); sim().active = s.id; return s;
}
function activateStudy(id) { stopSimAnim(); sim().active = id; simPick = null; const st = simStudy(); simView.type = simKind(st) === 'thermal' ? 'temp' : isModeKind(simKind(st)) ? 'mode' : 'vm'; activeTab = simTabName(); renderRibbon(); renderBrowser(); drawSim2(); defaultHint(); }
const simBodies = () => [...result.bodies.keys()].filter(id => !bodyHidden(id) && !isSurfBody(id) && result.bodies.get(id).shape);

// ---- workspace ----
function enterSimulation() {
  if (!needExact('Simulation')) return;
  if (!simBodies().length) { toast('There is no solid body to simulate'); return; }
  if (workspace === 'drawing') exitDrawing(); if (workspace === 'manufacture') exitManufacture();
  if (mode === 'sketch') finishSketch(true); if (dlg) closeDialog(true);
  workspace = 'simulation'; document.body.classList.add('ws-simulation'); $('#wsBtn span').textContent = 'SIMULATION';
  if (!sim().studies.length) newStudy('static');
  activeTab = simTabName();
  renderRibbon(); renderBrowser(); drawSim2(); defaultHint();
}
function exitSimulation() {
  workspace = 'design'; document.body.classList.remove('ws-simulation'); $('#wsBtn span').textContent = 'DESIGN';
  simPick = null; stopSimAnim(); clearGroup(simGroup); $('#simLegend')?.remove(); for (const [, sb] of shownBodies) sb.mesh.visible = sb.edges.visible = !bodyHidden(sb.rec.id);
  activeTab = 'SOLID'; renderRibbon(); renderBrowser(); updateScene(); defaultHint(); requestRender();
}
function simHint() {
  if (simPick) return 'Click faces on the model to add or remove them · OK when done';
  const k = simKind(simStudy());
  if (simShowing()) return k === 'modal' ? `Mode ${simView.mode + 1}: ${fmt(simRes.freqs[simView.mode])} Hz. Pick another mode in the browser or animate it from Results.` : k === 'buckling' ? `Buckling mode ${simView.mode + 1}: load factor ${fmt(simRes.factors[simView.mode])}. The part buckles at this multiple of the applied loads.` : 'Results: ' + ({ vm: 'von Mises stress', disp: 'displacement', sf: 'safety factor', temp: 'temperature', flux: 'heat flux' }[simView.type]) + '. Change the result in Results.';
  return { modal: 'Set materials and (optionally) constraints, then Solve for the natural frequencies.', thermal: 'Set materials, add temperatures, heat sources and convection, then Solve.', thermalstress: 'Add temperatures, heat sources or convection for the temperature field, constraints and any loads, then Solve.', buckling: 'Add constraints and the compressive loads, then Solve for the buckling load factors.' }[k] || 'Set materials, add constraints and loads, then Solve.';
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
    if (out.length) { faceWeights(M, out); return { nodes: out, area }; }
  }
  return { nodes: [], area };
}
// tributary weights (sum 1) from the exposed voxel faces whose four corners are all selected; uniform if there are none
function faceWeights(M, nodes) {
  const g = M.grid, { nx, ny, nz, solid, hs } = g, mark = new Uint8Array(M.nn), wq = new Float64Array(M.nn);
  for (const n of nodes) mark[n.q] = 1;
  const cell = (i, j, k) => i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : solid[(k * ny + j) * nx + i];
  let tot = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!cell(i, j, k)) continue;
    for (let ax = 0; ax < 3; ax++) for (const s of [0, 1]) {
      const d = [0, 0, 0]; d[ax] = s ? 1 : -1;
      if (cell(i + d[0], j + d[1], k + d[2])) continue;
      const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, ids = [];
      for (const u of [0, 1]) for (const v of [0, 1]) { const o = [i, j, k]; o[ax] += s; o[a1] += u; o[a2] += v; ids.push(M.nid(o[0], o[1], o[2])); }
      if (!ids.every(q => mark[q])) continue;
      const A = hs[a1] * hs[a2] / 4; for (const q of ids) wq[q] += A; tot += 4 * A;
    }
  }
  for (const n of nodes) n.w = tot > 0 ? wq[n.q] / tot : 1 / nodes.length;
}
const DIRV = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
// ---- solve ----
const simMatProps = mn => { const m = SIM_MATERIALS[mn] || SIM_MATERIALS['Steel 1018']; return { name: mn, E: m[0], nu: m[1], yield: m[2], density: MATERIALS[mn]?.density || 7.85, k: SIM_THERMAL[mn] ?? 50, alpha: SIM_ALPHA[mn] ?? 12e-6 }; };
async function simMeshStudy(st, busy) {
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
  busy.textContent = 'Meshing…'; await new Promise(r => setTimeout(r, 30));
  const grid = voxelize(groups, h), mats = matNames.map(simMatProps);
  const M = buildModel(grid, mats); if (!M.ne) throw new Error('The mesh is empty');
  return { M, grid, mats, h, surf: surfaceNodes(M) };
}
const tick = () => new Promise(r => setTimeout(r, 0));
// structural boundary conditions → fixed dofs and nodal forces
function structuralBCs(st, M, grid, mats, surf, warn) {
  const fixed = new Uint8Array(M.nn * 3), f = new Float64Array(M.nn * 3), applied = [0, 0, 0];
  for (const c of st.constraints) {
    if (c.type !== 'fixed') continue;
    const r = nodesOnFaces(M, surf, c.faces); if (!r.nodes.length) { warn.push(`${c.name}: no mesh nodes on its faces`); continue; }
    for (const { q } of r.nodes) { if (c.x !== false) fixed[3 * q] = 1; if (c.y !== false) fixed[3 * q + 1] = 1; if (c.z !== false) fixed[3 * q + 2] = 1; }
  }
  for (const L of st.loads) {
    if (L.type === 'gravity') {
      const d = DIRV[L.dir || '-Z'] || [0, 0, -1], gacc = (+L.value || 9.81);
      for (let e = 0; e < M.ne; e++) { const m = mats[M.em[e]], w = m.density * grid.hs[0] * grid.hs[1] * grid.hs[2] * 1e-6 * gacc / 8; for (let a = 0; a < 8; a++) { const q = M.en[e * 8 + a]; for (let k = 0; k < 3; k++) { f[3 * q + k] += d[k] * w; applied[k] += d[k] * w; } } }
      continue;
    }
    if (L.type !== 'force' && L.type !== 'pressure') continue;
    const r = nodesOnFaces(M, surf, L.faces); if (!r.nodes.length) { warn.push(`${L.name}: no mesh nodes on its faces`); continue; }
    const total = L.type === 'pressure' ? (+L.value || 0) * r.area : (+L.value || 0);
    for (const { q, n, w } of r.nodes) { const d = L.type === 'pressure' || (L.dir || 'normal') === 'normal' ? [-n[0], -n[1], -n[2]] : DIRV[L.dir], per = total * w; for (let k = 0; k < 3; k++) { f[3 * q + k] += d[k] * per; applied[k] += d[k] * per; } }
  }
  return { fixed, f, applied };
}
// thermal boundary conditions → prescribed temperatures, heat input, convection
function thermalBCs(st, M, surf, warn) {
  const T = new Float64Array(M.nn).fill(NaN), q = new Float64Array(M.nn), hA = new Float64Array(M.nn), hT = new Float64Array(M.nn);
  let heatIn = 0;
  for (const c of st.constraints) { if (c.type !== 'temp') continue; const r = nodesOnFaces(M, surf, c.faces); if (!r.nodes.length) { warn.push(`${c.name}: no mesh nodes on its faces`); continue; } for (const n of r.nodes) T[n.q] = +c.value || 0; }
  for (const L of st.loads) {
    if (L.type !== 'heat' && L.type !== 'conv') continue;
    const r = nodesOnFaces(M, surf, L.faces); if (!r.nodes.length) { warn.push(`${L.name}: no mesh nodes on its faces`); continue; }
    if (L.type === 'heat') { for (const n of r.nodes) q[n.q] += (+L.value || 0) * n.w; heatIn += +L.value || 0; }
    else { const tot = (+L.value || 0) * 1e-6 * r.area, Ta = +L.ambient || 0; for (const n of r.nodes) { hA[n.q] += tot * n.w; hT[n.q] += tot * n.w * Ta; } }
  }
  return { T, q, hA, hT, heatIn };
}
// static solve plus derived result fields (stress, displacement, safety factor)
async function runStatic(M, mats, fixed, f, applied, warn, busy, elems, dT) {
  busy.textContent = 'Preparing the solver…'; await tick();
  const R = await solveStatic(M, fixed, f, { tol: 1e-7, maxIter: 30000, dT, onProgress: async (it, res) => { busy.textContent = `Solving stress… ${elems} elements · iteration ${it} · residual ${res.toExponential(1)} (click to stop)`; await tick(); return simCancel; } });
  if (simCancel) return null;
  const disp = new Float64Array(M.nn); for (let q = 0; q < M.nn; q++) disp[q] = Math.hypot(R.u[3 * q], R.u[3 * q + 1], R.u[3 * q + 2]);
  const vmN = R.vmNode, yE = new Float64Array(M.ne); for (let e = 0; e < M.ne; e++) yE[e] = mats[M.em[e]].yield;
  const yN = nodalAverage(M, yE), sfN = new Float64Array(M.nn); for (let q = 0; q < M.nn; q++) sfN[q] = vmN[q] > 1e-12 ? yN[q] / vmN[q] : 1e9;
  let vmax = 0, vmaxQ = 0; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && vmN[q] > vmax) { vmax = vmN[q]; vmaxQ = q; }
  let dmax = 0, dmaxQ = 0; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q] && disp[q] > dmax) { dmax = disp[q]; dmaxQ = q; }
  let sfmin = Infinity; for (let q = 0; q < M.nn; q++) if (M.nodeActive[q]) sfmin = Math.min(sfmin, sfN[q]);
  if (!R.converged) warn.push(`The solver stopped at a residual of ${R.residual.toExponential(1)}; results may be inaccurate. Check that the constraints hold the part in every direction.`);
  return { R, disp, vmN, sfN, vmax, vmaxAt: nodePos(M, vmaxQ), dmax, dmaxQ, dmaxAt: nodePos(M, dmaxQ), sfmin, applied };
}
async function runThermal(M, bc, warn, busy, elems) {
  busy.textContent = 'Solving temperatures…'; await tick();
  const R = await solveThermal(M, { T: bc.T, q: bc.q, hA: bc.hA, hT: bc.hT, onProgress: async (it, res) => { busy.textContent = `Solving temperatures… ${elems} elements · iteration ${it} · residual ${res.toExponential(1)} (click to stop)`; await tick(); return simCancel; } });
  if (R.stopped || simCancel) return null;
  const fluxN = nodalAverage(M, R.fluxMag);
  let tmax = -Infinity, tmin = Infinity, tmaxQ = 0, tminQ = 0, fmax = 0, fmaxQ = 0;
  for (let n = 0; n < M.nn; n++) if (M.nodeActive[n]) { const t = R.T[n]; if (t > tmax) { tmax = t; tmaxQ = n; } if (t < tmin) { tmin = t; tminQ = n; } if (fluxN[n] > fmax) { fmax = fluxN[n]; fmaxQ = n; } }
  if (!R.converged) warn.push(`The temperature solver stopped at a residual of ${R.residual.toExponential(1)}; results may be inaccurate.`);
  return { RT: R, T: R.T, fluxN, tmax, tmin, tmaxAt: nodePos(M, tmaxQ), tminAt: nodePos(M, tminQ), fmax, fmaxAt: nodePos(M, fmaxQ), heatIn: bc.heatIn, heatOut: R.heatConv, heatFixed: R.heatFixed };
}
async function solveStudy() {
  const st = simStudy(); if (!st) return;
  const kind = simKind(st);
  const hasFixed = st.constraints.some(c => c.type === 'fixed'), hasLoad = st.loads.some(L => ['force', 'pressure', 'gravity'].includes(L.type));
  const hasTherm = st.constraints.some(c => c.type === 'temp') || st.loads.some(L => L.type === 'conv');
  if (isStructural(kind) && !hasFixed) { toast('Add a constraint first: the part needs to be held somewhere'); return; }
  if ((kind === 'static' || kind === 'buckling') && !hasLoad) { toast('Add a load first'); return; }
  if (hasThermal(kind) && !hasTherm) { toast('Add a temperature or a convection boundary first'); return; }
  stopSimAnim();
  simCancel = false; const busy = $('#busy'); busy.hidden = false;
  try {
    const { M, grid, mats, h, surf } = await simMeshStudy(st, busy), warn = [], t0 = performance.now();
    const elems = M.ne.toLocaleString('en-US'), base = { kind, st: st.id, M, warn, mats, h, key: simKey(st) };
    let res = null;
    if (kind === 'modal') {
      const { fixed } = structuralBCs({ constraints: st.constraints, loads: [] }, M, grid, mats, surf, warn);
      const held = fixed.some(Boolean), nm = Math.max(1, Math.min(30, Math.round(+st.modes || 8))) + (held ? 0 : 6);
      busy.textContent = 'Preparing the solver…'; await tick();
      const R = await solveModal(M, fixed, { modes: nm, onProgress: async p => { busy.textContent = `Solving modes… ${elems} elements · iteration ${p.iter} · ${p.converged}/${p.of} converged (click to stop)`; await tick(); return simCancel; } });
      if (!R || simCancel) { toast('Solve stopped'); return; }
      if (!R.converged) warn.push('The eigen-solver stopped before every mode converged; the highest frequencies may be inaccurate.');
      const rigid = held ? 0 : 6;   // a free part: list its six rigid-body modes separately
      res = { freqs: R.freqs.slice(rigid), modes: R.modes.slice(rigid), participation: R.participation.slice(rigid), rigid: held ? [] : R.freqs.slice(0, 6), mass: R.mass, iterations: R.iterations, free: !held };
      if (simView.mode >= res.freqs.length) simView.mode = 0;
      simView.type = 'mode';
    } else if (kind === 'thermal') {
      res = await runThermal(M, thermalBCs(st, M, surf, warn), warn, busy, elems); if (!res) { toast('Solve stopped'); return; }
      if (!['temp', 'flux'].includes(simView.type)) simView.type = 'temp';
    } else if (kind === 'thermalstress') {
      const th = await runThermal(M, thermalBCs(st, M, surf, warn), warn, busy, elems); if (!th) { toast('Solve stopped'); return; }
      const ref = Number.isFinite(+st.refTemp) ? +st.refTemp : 20, dT = new Float64Array(M.ne);
      for (let e = 0; e < M.ne; e++) { let s = 0; for (let a = 0; a < 8; a++) s += th.T[M.en[e * 8 + a]]; dT[e] = s / 8 - ref; }
      const { fixed, f, applied } = structuralBCs(st, M, grid, mats, surf, warn);
      if (!fixed.some(Boolean)) throw new Error('The constraints did not catch any part of the mesh');
      const sr = await runStatic(M, mats, fixed, f, applied, warn, busy, elems, dT); if (!sr) { toast('Solve stopped'); return; }
      res = { ...th, ...sr, refTemp: ref };
      if (!['vm', 'disp', 'sf', 'temp'].includes(simView.type)) simView.type = 'vm';
    } else if (kind === 'buckling') {
      const { fixed, f, applied } = structuralBCs(st, M, grid, mats, surf, warn);
      if (!fixed.some(Boolean)) throw new Error('The constraints did not catch any part of the mesh');
      const sr = await runStatic(M, mats, fixed, f, applied, warn, busy, elems); if (!sr) { toast('Solve stopped'); return; }
      busy.textContent = 'Solving buckling modes…'; await tick();
      const nm = Math.max(1, Math.min(12, Math.round(+st.modes || 4)));
      const B = await solveBuckling(M, fixed, sr.R.sig, { modes: nm, onProgress: async p => { busy.textContent = `Solving buckling modes… ${elems} elements · pass ${p.iter + 1} · vector ${p.vec + 1}/${p.of} (click to stop)`; await tick(); return simCancel; } });
      if (!B || simCancel) { toast('Solve stopped'); return; }
      if (!B.factors.length) warn.push('No buckling: the loads put the part in tension.');
      else if (B.factors[0] < 1) warn.push(`The part buckles below the applied load (load factor ${fmt(B.factors[0])}).`);
      res = { ...sr, factors: B.factors, modes: B.modes, iterations: B.iterations };
      if (simView.mode >= res.factors.length) simView.mode = 0;
      simView.type = 'mode';
    } else {
      const { fixed, f, applied } = structuralBCs(st, M, grid, mats, surf, warn);
      if (!fixed.some(Boolean)) throw new Error('The constraints did not catch any part of the mesh');
      res = await runStatic(M, mats, fixed, f, applied, warn, busy, elems); if (!res) { toast('Solve stopped'); return; }
      if (!['vm', 'disp', 'sf'].includes(simView.type)) simView.type = 'vm';
    }
    simRes = { ...base, ...res, seconds: (performance.now() - t0) / 1000 };
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
const simShowing = () => { const st = simStudy(); return !!(simRes && st && simRes.st === st.id && simRes.key === simKey(st)); };
function drawSim2() {
  clearGroup(simGroup); $('#simLegend')?.remove();
  if (workspace !== 'simulation') { requestRender(); return; }
  const st = simStudy(); if (!st) return;
  const showRes = simShowing();
  if (!showRes) stopSimAnim();
  for (const [, sb] of shownBodies) { sb.mesh.visible = !showRes && !bodyHidden(sb.rec.id); sb.edges.visible = !bodyHidden(sb.rec.id) && !showRes; }
  if (showRes) drawResults(); else drawBCs(st);
  requestRender();
}
const BC_COLOR = { fixed: 0x2e86de, temp: 0x8e44ad, force: 0xc0392b, pressure: 0xe67e22, heat: 0xd35400, conv: 0x16a085 };
function drawBCs(st) {
  const tint = (faces, col) => { for (const f of faces) { const t = faceTris(f); if (!t) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(t, 3)); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 8; simGroup.add(m); } };
  for (const c of st.constraints) tint(c.faces, BC_COLOR[c.type] || 0x2e86de);
  for (const L of st.loads) {
    if (L.type === 'gravity') continue;
    tint(L.faces, BC_COLOR[L.type] || 0xc0392b);
    if (L.type !== 'force' && L.type !== 'pressure') continue;
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
const SIM_TITLES = { vm: 'Stress (von Mises) MPa', disp: 'Displacement mm', sf: 'Safety factor', mode: 'Relative displacement', temp: 'Temperature °C', flux: 'Heat flux W/m²' };
function simModelDiag() { const b = new THREE.Box3(); for (const id of simBodies()) { const g = bodyGeomOf(result.bodies.get(id)); g.computeBoundingBox(); b.union(g.boundingBox.clone().applyMatrix4(bodyXf(id))); } return b.getSize(new THREE.Vector3()).length(); }
function drawResults() {
  const S = simRes, M = S.M, type = simView.type, diag = simModelDiag();
  let field, U = null, k = 0, unit = 1;
  if (isModeKind(S.kind)) {
    const v = S.modes[simView.mode] || S.modes[0]; U = v; field = new Float64Array(M.nn); for (let q = 0; q < M.nn; q++) field[q] = Math.hypot(v[3 * q], v[3 * q + 1], v[3 * q + 2]);
    k = simView.scale === 'none' ? 0 : diag * 0.08;
  } else if (S.kind === 'thermal' || type === 'temp') { field = type === 'flux' ? S.fluxN : S.T; if (type === 'flux') unit = 1e6; }
  else {
    field = type === 'disp' ? S.disp : type === 'sf' ? S.sfN : S.vmN; U = S.R.u;
    k = simView.scale === 'actual' ? 1 : simView.scale === 'none' ? 0 : S.dmax > 1e-12 ? diag * 0.05 / S.dmax : 0;
  }
  let lo = Infinity, hi = -Infinity;
  for (let q = 0; q < M.nn; q++) if (M.nodeActive[q]) { lo = Math.min(lo, field[q]); hi = Math.max(hi, field[q]); }
  if (type === 'sf') { lo = 0; hi = Math.min(Math.max(1, S.sfmin * 3), 15); }
  if (isModeKind(S.kind)) { lo = 0; hi = 1; }
  S.scale = k;
  const anim = [];
  for (const id of simBodies()) {
    const b = result.bodies.get(id), m = brepMeshOf(b), src = m.display, P = src.attributes.position.array, Mx = bodyXf(id), n = P.length / 3;
    const base = new Float32Array(P.length), du = new Float32Array(P.length), col = new Float32Array(P.length), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).applyMatrix4(Mx); const p = [v.x, v.y, v.z];
      const val = sampleNodal(M, field, p);
      base[3 * i] = p[0]; base[3 * i + 1] = p[1]; base[3 * i + 2] = p[2];
      if (U && k) for (let c = 0; c < 3; c++) du[3 * i + c] = k * sampleNodal(M, U, p, 3, c);
      const t = hi > lo ? (val - lo) / (hi - lo) : 0, c = heat(type === 'sf' ? 1 - t : t); col.set(c, 3 * i);
    }
    const pos = new Float32Array(P.length); for (let i = 0; i < pos.length; i++) pos[i] = base[i] + du[i];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(src.index.clone()); g.computeVertexNormals();
    simGroup.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0 })));
    anim.push({ g, base, du });
    if (k > 0) { const ghost = new THREE.LineSegments(m.edgeGeom, new THREE.LineBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.35 })); ghost.matrixAutoUpdate = false; ghost.matrix.copy(Mx); simGroup.add(ghost); }
  }
  S.anim = anim;
  // max markers
  const mark = (p, label) => { const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, diag * 0.008), 12, 8), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false })); s.position.set(...p); s.renderOrder = 20; simGroup.add(s); const o = new CSS2DObject(h('div', { class: 'combtag' }, label)); o.position.set(...p); simGroup.add(o); };
  if (isModeKind(S.kind)) { /* no markers on mode shapes */ }
  else if (S.kind !== 'thermal' && type !== 'temp') {
    if (type === 'vm') mark(S.vmaxAt, 'Max ' + fmt(S.vmax) + ' MPa'); else if (type === 'disp') mark(S.dmaxAt.map((x, i) => x + k * S.R.u[3 * S.dmaxQ + i]), 'Max ' + fmt(S.dmax) + ' mm'); else mark(S.vmaxAt, 'Min ' + fmt(S.sfmin));
  } else {
    if (type === 'temp') { mark(S.tmaxAt, 'Max ' + fmt(S.tmax) + ' °C'); if (S.tmax - S.tmin > 1e-6) mark(S.tminAt, 'Min ' + fmt(S.tmin) + ' °C'); } else mark(S.fmaxAt, 'Max ' + fmtSig(S.fmax * 1e6) + ' W/m²');
  }
  // legend
  const stops = [];
  for (let i = 0; i <= 10; i++) { const c = heat(type === 'sf' ? 1 - i / 10 : i / 10); stops.push(`rgb(${c.map(x => Math.round(x * 255)).join(',')}) ${i * 10}%`); }
  const note = S.kind === 'modal' ? `Mode ${simView.mode + 1} · ${fmt(S.freqs[simView.mode])} Hz` : S.kind === 'buckling' ? `Mode ${simView.mode + 1} · load factor ${fmt(S.factors[simView.mode])}` : (S.kind === 'thermal' || type === 'temp') ? 'Steady state' : (k > 0 ? `Deformation ×${fmtSig(k)}` : 'Undeformed');
  const lg = h('div', { id: 'simLegend', class: 'simlegend' }, h('div', { class: 'lt' }, SIM_TITLES[type] || ''), h('div', { class: 'lbar', style: `background:linear-gradient(to top, ${stops.join(',')})` }),
    h('div', { class: 'lmax' }, (type === 'sf' && hi >= 15 ? '≥ ' : '') + fmtSig(hi * unit)), h('div', { class: 'lmin' }, fmtSig(lo * unit)),
    h('div', { class: 'lnote' }, note));
  $('#stage').append(lg);
  if (isModeKind(S.kind) && simView.anim) startSimAnim();
}
// mode-shape animation: positions swing between ±shape
function startSimAnim() {
  if (simAnimId) return;
  const t0 = performance.now();
  const step = now => {
    const S = simRes; if (!S || !S.anim || workspace !== 'simulation' || !simView.anim) { simAnimId = 0; return; }
    const s = Math.sin((now - t0) / 1000 * Math.PI * 2 * 0.8);
    for (const a of S.anim) { const p = a.g.attributes.position.array; for (let i = 0; i < p.length; i++) p[i] = a.base[i] + s * a.du[i]; a.g.attributes.position.needsUpdate = true; }
    requestRender(); simAnimId = requestAnimationFrame(step);
  };
  simAnimId = requestAnimationFrame(step);
}
function stopSimAnim() { if (simAnimId) cancelAnimationFrame(simAnimId); simAnimId = 0; }
const fmtSig = v => !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(2) : (+v.toPrecision(3)).toString();
// ---- browser ----
const bcSub = b => ({ fixed: () => `${b.faces.length} face${b.faces.length === 1 ? '' : 's'}`, temp: () => `${b.value} °C`, gravity: () => `${b.value} m/s² ${b.dir}`, pressure: () => `${b.value} MPa`, force: () => `${b.value} N`, heat: () => `${b.value} W`, conv: () => `${b.value} W/m²K · ${b.ambient ?? 20} °C` }[b.type] || (() => ''))();
const BC_ICON = { fixed: 'fix', temp: 'thermo', gravity: 'com', force: 'move', pressure: 'presspull', heat: 'heat', conv: 'conv' };
function renderSimBrowser(add) {
  const S = sim(), st = simStudy(); if (!st) return;
  const kind = simKind(st);
  const menu = () => [{ head: 'Studies' }, ...S.studies.map(x => ({ label: x.name, icon: SIM_KINDS[simKind(x)][2], checked: x.id === st.id ? true : null, action: () => activateStudy(x.id) })), '-',
    { label: 'Rename study…', icon: 'params', action: () => renameStudy() }, { label: 'Delete study', icon: 'delete', action: () => deleteStudy() }];
  if (!add(0, { key: 'simroot', icon: SIM_KINDS[kind][2], label: st.name, sub: SIM_KINDS[kind][0] + (S.studies.length > 1 ? ` · ${S.studies.length} studies` : ''), menu, onDbl: () => renameStudy() })) return;
  if (add(1, { key: 'simmat', icon: 'material', label: 'Materials' })) for (const id of simBodies()) add(2, { icon: 'bodyi', label: bodyName(id), sub: simMat(st, id), onDbl: () => openSimMaterials(), onClick: () => openSimMaterials() });
  const item = (b) => add(2, { icon: BC_ICON[b.type] || 'fix', label: b.name, sub: bcSub(b), onDbl: () => editBC(b.id), onClick: () => editBC(b.id), menu: () => [{ label: 'Edit', icon: 'params', action: () => editBC(b.id) }, { label: 'Delete', icon: 'delete', action: () => deleteBC(b.id) }] });
  if (add(1, { key: 'simbc', icon: 'folder', label: kind === 'thermal' ? 'Temperatures' : kind === 'thermalstress' ? 'Constraints and temperatures' : 'Constraints', sub: String(st.constraints.length) })) st.constraints.forEach(item);
  if (kind !== 'modal' && add(1, { key: 'simld', icon: 'folder', label: kind === 'thermal' ? 'Thermal loads' : kind === 'thermalstress' ? 'Loads and heat' : 'Loads', sub: String(st.loads.length) })) st.loads.forEach(item);
  add(1, { icon: 'remesh', label: 'Mesh', sub: st.mesh + ` (~${(MESH_TARGET[st.mesh] / 1000) | 0}k elements)`, onClick: () => openSimMesh() });
  if (isModeKind(kind)) add(1, { icon: isModeKind(kind) && kind === 'buckling' ? 'buckle' : 'modes', label: 'Modes to find', sub: String(st.modes || (kind === 'buckling' ? 4 : 8)), onClick: () => openSimMesh() });
  if (kind === 'thermalstress') add(1, { icon: 'thermo', label: 'Reference temperature', sub: (st.refTemp ?? 20) + ' °C (stress-free)', onClick: () => openSimMesh() });
  const sel = (t, extra = {}) => ({ sel: simView.type === t, onClick: () => { simView.type = t; drawSim2(); renderBrowser(); defaultHint(); }, ...extra });
  if (simShowing() && add(1, { key: 'simres', icon: 'analysis', label: 'Results' })) {
    if (simRes.kind === 'static' || simRes.kind === 'thermalstress') {
      if (simRes.kind === 'thermalstress') add(2, { icon: 'thermo', label: 'Temperature', sub: fmt(simRes.tmin) + ' – ' + fmt(simRes.tmax) + ' °C', ...sel('temp') });
      add(2, { icon: 'analysis', label: 'Stress (von Mises)', sub: 'max ' + fmt(simRes.vmax) + ' MPa', ...sel('vm') });
      add(2, { icon: 'move', label: 'Displacement', sub: 'max ' + fmt(simRes.dmax) + ' mm', ...sel('disp') });
      add(2, { icon: 'fix', label: 'Safety factor', sub: 'min ' + (simRes.sfmin > 1e6 ? '—' : fmt(simRes.sfmin)), err: simRes.sfmin < 1, ...sel('sf') });
    } else if (simRes.kind === 'thermal') {
      add(2, { icon: 'thermo', label: 'Temperature', sub: fmt(simRes.tmin) + ' – ' + fmt(simRes.tmax) + ' °C', ...sel('temp') });
      add(2, { icon: 'heat', label: 'Heat flux', sub: 'max ' + fmtSig(simRes.fmax * 1e6) + ' W/m²', ...sel('flux') });
    } else if (simRes.kind === 'buckling') {
      if (!simRes.factors.length) add(2, { icon: 'buckle', label: 'No buckling', sub: 'loads are tensile', dim: true });
      simRes.factors.forEach((f, i) => add(2, { icon: 'buckle', label: `Mode ${i + 1}`, sub: 'load factor ' + fmt(f), err: f < 1, sel: simView.mode === i, onClick: () => { simView.mode = i; drawSim2(); renderBrowser(); defaultHint(); } }));
    } else {
      simRes.freqs.forEach((f, i) => add(2, { icon: 'modes', label: `Mode ${i + 1}`, sub: fmt(f) + ' Hz', sel: simView.mode === i, onClick: () => { simView.mode = i; drawSim2(); renderBrowser(); defaultHint(); } }));
    }
  } else if (simRes && simRes.st === st.id) add(1, { icon: 'analysis', label: 'Results out of date', sub: 'Solve again', dim: true, onClick: () => solveStudy() });
}
function renameStudy() {
  const st = simStudy(); if (!st) return;
  const i = h('input', { type: 'text', id: 'study-name', value: st.name }); i.addEventListener('keydown', e => e.stopPropagation());
  openModal('Rename Study', 'params', h('div', {}, row('Name', i, 'study-name')), [h('button', { class: 'btn ok', onclick: () => { checkpoint(); st.name = i.value.trim() || st.name; persist(); closeModal(); renderBrowser(); } }, 'OK'), h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
function deleteStudy() {
  const S = sim(), st = simStudy(); if (!st) return;
  checkpoint(); S.studies = S.studies.filter(x => x.id !== st.id); if (simRes?.st === st.id) simRes = null;
  if (!S.studies.length) newStudy('static');
  S.active = S.studies[0].id; persist(); activateStudy(S.active);
}
function openNewStudy() {
  const card = (kind, text) => h('button', { class: 'studycard', type: 'button', 'data-kind': kind, onclick: () => { checkpoint(); newStudy(kind); persist(); closeModal(); activateStudy(sim().active); } }, h('span', { html: icon(SIM_KINDS[kind][2]) }), h('b', {}, SIM_KINDS[kind][0]), h('small', {}, text));
  openModal('New Study', 'analysis', h('div', { class: 'studycards' },
    card('static', 'Stress, displacement and safety factor under loads and supports.'),
    card('modal', 'Natural frequencies and mode shapes, with or without supports.'),
    card('thermal', 'Steady-state temperatures from fixed temperatures, heat sources and convection.'),
    card('thermalstress', 'Stress from thermal expansion of the steady-state temperatures, plus mechanical loads.'),
    card('buckling', 'Load factors at which slender parts buckle under the applied compressive loads.')),
    [h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
// ---- dialogs ----
const simItem = id => { const st = simStudy(); return st && ([...st.constraints, ...st.loads].find(x => x.id === id) || null); };
function deleteBC(id) { const st = simStudy(); checkpoint(); st.constraints = st.constraints.filter(x => x.id !== id); st.loads = st.loads.filter(x => x.id !== id); persist(); renderBrowser(); drawSim2(); }
function newBC(type) {
  const st = simStudy(); if (!st) return;
  const list = type === 'fixed' || type === 'temp' ? st.constraints : st.loads, label = BC_LABEL[type];
  const it = { id: uid(), name: label + ' ' + (list.filter(x => x.type === type).length + 1), type, faces: [], value: { force: 100, pressure: 1, gravity: 9.81, temp: 100, heat: 10, conv: 10 }[type] ?? 0, dir: type === 'gravity' ? '-Z' : 'normal', x: true, y: true, z: true };
  if (type === 'conv') it.ambient = 20;
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
    if (it.type === 'temp') out.push(section_('Temperature', exField('Temperature', it, 'value', '°C', { after: live, id: 'sb-value' }), h('p', { class: 'note' }, 'The faces are held at this temperature (for example a heat sink or a water-cooled surface).')));
    if (it.type === 'heat') out.push(section_('Heat source', exField('Power (total)', it, 'value', 'W', { after: live, id: 'sb-value' }), h('p', { class: 'note' }, 'Heat flowing into the part through the faces, spread evenly over them.')));
    if (it.type === 'conv') out.push(section_('Convection', exField('Film coefficient', it, 'value', 'W/(m²·K)', { after: live, id: 'sb-value' }), exField('Ambient temperature', it, 'ambient', '°C', { after: live, id: 'sb-ambient' }), h('p', { class: 'note' }, 'Typical values: still air 5–10, forced air 25–250, water 500–10 000 W/(m²·K).')));
    if (it.type === 'gravity') out.push(section_('Gravity', exField('Acceleration', it, 'value', 'm/s²', { after: live, id: 'sb-value' }), selField('Direction', it, 'dir', SIM_DIRS.slice(1), { after: live })));
    out.push(section_(null, row('Name', (() => { const i = h('input', { type: 'text', id: 'sb-name', value: it.name }); i.addEventListener('input', () => { it.name = i.value; renderBrowser(); }); i.addEventListener('keydown', e => e.stopPropagation()); return i; })(), 'sb-name')));
    return out;
  };
  openPanelDialog({ title: it.type === 'fixed' ? 'Fixed Constraint' : BC_LABEL[it.type], icon: BC_ICON[it.type] || 'fix', okLabel: 'OK', body,
    help: it.type === 'fixed' ? (simKind(simStudy()) === 'modal' ? 'Fixed faces cannot move. Without any, the part vibrates freely.' : 'Fixed faces cannot move. Every static study needs at least one.') : it.type === 'temp' ? 'Prescribed temperature on the selected faces.' : it.type === 'conv' ? 'Heat exchange with the surrounding fluid: q = h (T − T∞).' : 'The load is spread evenly over the selected faces.',
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
    const mn = work[id] || bodyMaterial(id), p = SIM_MATERIALS[mn] || [], kind = simKind(st);
    const c3 = kind === 'thermal' ? (SIM_THERMAL[mn] != null ? SIM_THERMAL[mn] + ' W/(m·K)' : '') : p[0] ? fmt(p[0] / 1000) + ' GPa' : '';
    const c4 = kind === 'static' || kind === 'buckling' ? (p[2] ? p[2] + ' MPa' : '') : kind === 'modal' ? fmt(MATERIALS[mn]?.density || 7.85) + ' g/cm³' : kind === 'thermalstress' ? `${SIM_THERMAL[mn] ?? '—'} W/(m·K) · α ${((SIM_ALPHA[mn] ?? 0) * 1e6).toFixed(1)}×10⁻⁶/K` : '';
    return h('tr', {}, h('td', {}, bodyName(id)), h('td', {}, s), h('td', { class: 'num' }, c3), h('td', { class: 'num' }, c4));
  });
  const kind = simKind(st), heads = ['Body', 'Material', kind === 'thermal' ? 'Conductivity' : 'Young’s modulus', kind === 'static' || kind === 'buckling' ? 'Yield' : kind === 'modal' ? 'Density' : kind === 'thermalstress' ? 'Conductivity · expansion' : ''];
  openModal('Study Materials', 'material', h('div', { class: 'tablewrap' }, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...heads.map(t => h('th', {}, t)))), h('tbody', {}, rows)),
    h('p', { class: 'note' }, kind === 'thermal' ? 'Isotropic conduction. Bodies that touch exchange heat as if bonded.' : 'Linear elastic, isotropic. Bodies that touch are treated as bonded.')),
    [h('button', { class: 'btn ok', onclick: () => { checkpoint(); st.mats = work; persist(); closeModal(); renderBrowser(); drawSim2(); } }, 'OK'), h('button', { class: 'btn', onclick: closeModal }, 'Cancel')]);
}
function openSimMesh() {
  const st = simStudy(); if (!st) return; const snap = JSON.stringify(doc.sim);
  openPanelDialog({ title: isModeKind(simKind(st)) || simKind(st) === 'thermalstress' ? 'Study Settings' : 'Mesh', icon: 'remesh', okLabel: 'OK', help: 'Finer meshes are more accurate near small features but take longer to solve.',
    body: () => [section_('Mesh', segField('Size', st, 'mesh', [['coarse', 'Coarse'], ['medium', 'Medium'], ['fine', 'Fine']], { after: renderBrowser }), h('p', { class: 'note' }, 'Cube elements (8-node with bending modes) sized to the volume: about 4k, 12k or 30k elements.')),
      ...(isModeKind(simKind(st)) ? [section_('Modes', exField('Number of modes', st, 'modes', '', { min: 1, max: simKind(st) === 'buckling' ? 12 : 30, after: renderBrowser, id: 'sim-modes' }))] : []),
      ...(simKind(st) === 'thermalstress' ? [section_('Thermal strain', exField('Reference temperature', st, 'refTemp', '°C', { after: renderBrowser, id: 'sim-ref' }), h('p', { class: 'note' }, 'The part is stress-free at this temperature; it expands by α (T − T_ref).'))] : [])],
    onOK: () => { const now = JSON.stringify(doc.sim); doc.sim = JSON.parse(snap); checkpoint(); doc.sim = JSON.parse(now); persist(); renderBrowser(); drawSim2(); }, onCancel: () => { doc.sim = JSON.parse(snap); renderBrowser(); } });
}
function openSimResults() {
  if (!simShowing()) { toast('Solve the study first'); return; }
  const S = simRes, upd = () => { drawSim2(); renderBrowser(); defaultHint(); };
  let show;
  if (S.kind === 'modal') {
    const tbl = h('table', { class: 'grid', id: 'sim-modes-table' }, h('thead', {}, h('tr', {}, ...['Mode', 'Frequency', 'Mass X', 'Mass Y', 'Mass Z'].map(t => h('th', {}, t)))),
      h('tbody', {}, ...S.freqs.map((f, i) => { const tr = h('tr', { class: simView.mode === i ? 'sel' : '', style: 'cursor:pointer', onclick: () => { simView.mode = i; upd(); rerenderDialog(); } }, h('td', {}, String(i + 1)), h('td', { class: 'num' }, fmt(f) + ' Hz'), ...S.participation[i].map(v => h('td', { class: 'num' }, (v * 100).toFixed(1) + ' %'))); return tr; })));
    show = section_('Mode shapes', h('div', { class: 'tablewrap' }, tbl), chkField('Animate', simView, 'anim', { after: () => { if (simView.anim) startSimAnim(); else { stopSimAnim(); drawSim2(); } } }),
      segField('Deformation', simView, 'scale', [['auto', 'Shown'], ['none', 'None']], { after: drawSim2 }),
      h('p', { class: 'note' }, 'Mode shapes have no absolute size: colours show relative motion. Mass columns are the effective mass fractions in each direction.'));
  } else if (S.kind === 'buckling') {
    const P = Math.hypot(...S.applied);
    const tbl = h('table', { class: 'grid', id: 'sim-modes-table' }, h('thead', {}, h('tr', {}, ...['Mode', 'Load factor', 'Critical load'].map(t => h('th', {}, t)))),
      h('tbody', {}, ...S.factors.map((f, i) => h('tr', { class: simView.mode === i ? 'sel' : '', style: 'cursor:pointer', onclick: () => { simView.mode = i; upd(); rerenderDialog(); } }, h('td', {}, String(i + 1)), h('td', { class: 'num' }, fmt(f)), h('td', { class: 'num' }, P > 0 ? fmtSig(f * P) + ' N' : '—')))));
    show = section_('Buckling modes', h('div', { class: 'tablewrap' }, tbl), chkField('Animate', simView, 'anim', { after: () => { if (simView.anim) startSimAnim(); else { stopSimAnim(); drawSim2(); } } }),
      segField('Deformation', simView, 'scale', [['auto', 'Shown'], ['none', 'None']], { after: drawSim2 }),
      h('p', { class: 'note' }, 'A load factor of 3 means the part buckles at three times the applied loads. Below 1 it buckles before reaching them. Linear buckling overestimates real collapse loads; keep a margin.'));
  } else if (S.kind === 'thermal') show = section_('Show', segField('Result', simView, 'type', [['temp', 'Temperature'], ['flux', 'Heat flux']], { after: upd }));
  else if (S.kind === 'thermalstress') show = section_('Show', segField('Result', simView, 'type', [['vm', 'Stress'], ['disp', 'Displacement'], ['sf', 'Safety factor'], ['temp', 'Temperature']], { after: upd }),
    segField('Deformation', simView, 'scale', [['auto', 'Exaggerated'], ['actual', 'Actual'], ['none', 'None']], { after: drawSim2 }));
  else show = section_('Show', segField('Result', simView, 'type', [['vm', 'Stress'], ['disp', 'Displacement'], ['sf', 'Safety factor']], { after: upd }),
    segField('Deformation', simView, 'scale', [['auto', 'Exaggerated'], ['actual', 'Actual'], ['none', 'None']], { after: drawSim2 }));
  openPanelDialog({ title: 'Results', icon: 'analysis', okLabel: 'Close', help: S.kind === 'buckling' ? 'Buckling shapes, like vibration modes, have no absolute size.' : S.kind === 'thermalstress' ? 'Stress from restrained thermal expansion plus any mechanical loads.' : S.kind === 'static' ? 'Stress concentrates at sharp inside corners and at the edges of fixed faces; refine the mesh to check such peaks.' : S.kind === 'modal' ? 'Keep operating and excitation frequencies away from the natural frequencies.' : 'Steady state: the temperatures once the heat flows have settled.',
    body: () => [show,
      section_('Summary', h('dl', { class: 'stat' }, ...simSummary().flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'sim-report', onclick: () => simReport() }, 'Save report (.zip)'))],
    onOK: () => {}, onCancel: () => {} });
}
function simSummary() {
  const S = simRes, mesh = ['Mesh', `${S.M.ne.toLocaleString('en-US')} elements of ${fmt(S.h)} mm`];
  if (S.kind === 'modal') return [['Mode 1', fmt(S.freqs[0]) + ' Hz'], ...(S.freqs.length > 1 ? [['Highest mode', `${S.freqs.length}: ${fmt(S.freqs.at(-1))} Hz`]] : []), ['Mass', fmt(S.mass * 1000) + ' g'], ['Supports', S.free ? 'none (free vibration; 6 rigid-body modes skipped)' : 'fixed faces'], mesh, ['Solver', `${S.iterations} iterations · ${fmt(S.seconds)} s`]];
  const thermalRows = () => [['Max temperature', fmt(S.tmax) + ' °C'], ['Min temperature', fmt(S.tmin) + ' °C'], ['Max heat flux', fmtSig(S.fmax * 1e6) + ' W/m²'], ['Heat in (sources)', fmt(S.heatIn) + ' W'], ['Heat out (convection)', fmt(S.heatOut) + ' W'], ['Heat in (fixed temperatures)', fmt(S.heatFixed) + ' W']];
  if (S.kind === 'thermal') return [...thermalRows(), mesh, ['Solver', `${S.RT.iterations} iterations · ${fmt(S.seconds)} s`]];
  if (S.kind === 'buckling') return [['Lowest load factor', S.factors.length ? fmt(S.factors[0]) : 'no buckling (tension)'], ['Applied load', S.applied.map(v => fmt(v)).join(', ') + ' N'], ...(S.factors.length ? [['Critical load', fmtSig(S.factors[0] * Math.hypot(...S.applied)) + ' N']] : []), ['Stress under the applied load', fmt(S.vmax) + ' MPa max'], mesh, ['Solver', `${S.R.iterations} + ${S.iterations} passes · ${fmt(S.seconds)} s`]];
  if (S.kind === 'thermalstress') return [['Max stress', fmt(S.vmax) + ' MPa'], ['Max displacement', fmt(S.dmax) + ' mm'], ['Min safety factor', S.sfmin > 1e6 ? '—' : fmt(S.sfmin)], ['Reference temperature', fmt(S.refTemp) + ' °C'], ...thermalRows().slice(0, 2), ['Reaction', S.R.reaction.map(v => fmt(v)).join(', ') + ' N'], mesh, ['Solver', `${S.RT.iterations} + ${S.R.iterations} iterations · ${fmt(S.seconds)} s`]];
  return [['Max stress', fmt(S.vmax) + ' MPa'], ['Max displacement', fmt(S.dmax) + ' mm'], ['Min safety factor', S.sfmin > 1e6 ? '—' : fmt(S.sfmin)], ['Applied load', S.applied.map(v => fmt(v)).join(', ') + ' N'], ['Reaction', S.R.reaction.map(v => fmt(v)).join(', ') + ' N'],
    mesh, ['Solver', `${S.R.iterations} iterations · ${fmt(S.seconds)} s`]];
}
function simReport() {
  const S = simRes, st = simStudy(), esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'), kind = S.kind;
  renderer.render(scene, camera); let img = ''; try { img = renderer.domElement.toDataURL('image/png'); } catch (e) { }
  const what = { static: 'Linear static stress', modal: 'Natural frequencies (modal analysis)', thermal: 'Steady-state heat transfer', thermalstress: 'Thermal stress (steady-state temperatures with linear static stress)', buckling: 'Linear buckling' }[kind];
  const modeTable = kind === 'buckling' ? `<h2>Buckling modes</h2><table><tr><th>Mode</th><th>Load factor</th><th>Critical load (N)</th></tr>${S.factors.map((f, i) => `<tr><td>${i + 1}</td><td>${fmt(f)}</td><td>${fmtSig(f * Math.hypot(...S.applied))}</td></tr>`).join('')}</table>` : kind === 'modal' ? `<h2>Modes</h2><table><tr><th>Mode</th><th>Frequency (Hz)</th><th>Mass X</th><th>Mass Y</th><th>Mass Z</th></tr>${S.freqs.map((f, i) => `<tr><td>${i + 1}</td><td>${fmt(f)}</td>${S.participation[i].map(v => `<td>${(v * 100).toFixed(1)} %</td>`).join('')}</tr>`).join('')}</table>` : '';
  const matHead = kind === 'thermalstress' ? '<th>E (MPa)</th><th>ν</th><th>Yield (MPa)</th><th>k (W/m·K)</th><th>α (1/K)</th>' : kind === 'thermal' ? '<th>k (W/m·K)</th>' : kind === 'modal' ? '<th>E (MPa)</th><th>ν</th><th>Density (g/cm³)</th>' : '<th>E (MPa)</th><th>ν</th><th>Yield (MPa)</th>';
  const matRow = m => { const p = SIM_MATERIALS[m] || []; return kind === 'thermalstress' ? `<td>${p[0]}</td><td>${p[1]}</td><td>${p[2]}</td><td>${SIM_THERMAL[m] ?? ''}</td><td>${SIM_ALPHA[m] ?? ''}</td>` : kind === 'thermal' ? `<td>${SIM_THERMAL[m] ?? ''}</td>` : kind === 'modal' ? `<td>${p[0]}</td><td>${p[1]}</td><td>${MATERIALS[m]?.density || 7.85}</td>` : `<td>${p[0]}</td><td>${p[1]}</td><td>${p[2]}</td>`; };
  const val = b => b.type === 'fixed' ? ['x', 'y', 'z'].filter(k => b[k] !== false).join(' ').toUpperCase() : bcSub(b);
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(doc.name)} – ${esc(st.name)}</title><style>body{font:13px system-ui,sans-serif;margin:24px;color:#222;max-width:900px}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #bbb;padding:4px 8px;text-align:left}th{background:#eee}img{max-width:100%;border:1px solid #ccc}</style>
<h1>${esc(doc.name)} — ${esc(st.name)}</h1><p>${what}, voxel finite elements. ${new Date().toISOString().slice(0, 10)}</p>
${img ? `<img src="${img}" alt="Result plot">` : ''}
<h2>Results</h2><table>${simSummary().map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>${modeTable}
<h2>Materials</h2><table><tr><th>Body</th><th>Material</th>${matHead}</tr>${simBodies().map(id => { const m = simMat(st, id); return `<tr><td>${esc(bodyName(id))}</td><td>${esc(m)}</td>${matRow(m)}</tr>`; }).join('')}</table>
<h2>Boundary conditions</h2><table><tr><th>Name</th><th>Type</th><th>Value</th><th>Faces</th></tr>${[...st.constraints, ...(kind === 'modal' ? [] : st.loads)].map(b => `<tr><td>${esc(b.name)}</td><td>${BC_LABEL[b.type]}</td><td>${esc(val(b))}</td><td>${b.faces?.length || '—'}</td></tr>`).join('')}</table>
<p>${kind === 'buckling' ? 'Linear (eigenvalue) buckling of the ideal shape; imperfections and plasticity lower real collapse loads.' : kind === 'thermalstress' ? 'Linear elastic with constant properties; thermal strain α (T − T_ref) from the steady-state temperatures.' : kind === 'static' ? 'Results are linear elastic: stresses above the yield strength mean the part would deform permanently and the numbers there are no longer valid. Peaks at sharp corners and at fixed edges depend on the mesh.' : kind === 'modal' ? 'Frequencies assume small, undamped vibration. Lumped mass; bodies that touch are bonded.' : 'Constant material properties; radiation is not modelled.'}</p>`;
  saveFile(slug() + '-simulation.zip', makeZip([{ name: slug() + '-simulation.html', data: html }]), 'application/zip');
}
// ribbon commands
cmd('sim.study', 'New Study', 'analysis', { run: () => openNewStudy() });
cmd('sim.studies', 'Switch Study', 'folder', { run: () => { const b = document.querySelector('.rbtn[aria-label^="Switch Study"]') || $('#wsBtn'), S = sim(), st = simStudy(); openMenu(b, [{ head: 'Studies' }, ...S.studies.map(x => ({ label: x.name, icon: SIM_KINDS[simKind(x)][2], checked: x.id === st?.id ? true : null, action: () => activateStudy(x.id) }))]); } });
cmd('sim.mats', 'Study Materials', 'material', { run: () => openSimMaterials() });
cmd('sim.fixed', 'Fixed', 'fix', { run: () => newBC('fixed') });
cmd('sim.force', 'Force', 'move', { run: () => newBC('force') });
cmd('sim.pressure', 'Pressure', 'presspull', { run: () => newBC('pressure') });
cmd('sim.gravity', 'Gravity', 'com', { run: () => newBC('gravity') });
cmd('sim.temp', 'Temperature', 'thermo', { run: () => newBC('temp') });
cmd('sim.heat', 'Heat Source', 'heat', { run: () => newBC('heat') });
cmd('sim.conv', 'Convection', 'conv', { run: () => newBC('conv') });
cmd('sim.mesh', 'Mesh Settings', 'remesh', { run: () => openSimMesh() });
cmd('sim.solve', 'Solve', 'start', { run: () => solveStudy() });
cmd('sim.results', 'Results', 'analysis', { run: () => openSimResults() });
cmd('sim.animate', 'Animate Mode', 'modes', { run: () => { if (!simShowing() || !isModeKind(simRes.kind)) { toast('Solve the study first'); return; } simView.anim = !simView.anim; if (simView.anim) startSimAnim(); else { stopSimAnim(); drawSim2(); } } });
cmd('sim.report', 'Report', 'exportstl', { run: () => simShowing() ? simReport() : toast('Solve the study first') });

$('#busy').addEventListener('click', () => { simCancel = true; });
