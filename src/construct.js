// Construction geometry commands: planes (offset, at angle, midplane, tangent, three points), axes (through a
// cylinder, an edge, two points, two planes) and points (at a vertex, at a circle's centre, by coordinates).
// The geometry itself is computed in kernel.js (constructStep) so both engines and every later feature agree.
let cpick = null;                  // { steps: [kind], picks: [], prompt(i), done(picks) }

const AXIS_ORIGIN = [['X', 'X axis'], ['Y', 'Y axis'], ['Z', 'Z axis']];
function axisOptions(beforeIdx) { return [...AXIS_ORIGIN, ...doc.features.slice(0, beforeIdx).filter(f => f.type === 'axis').map(a => [a.id, a.name])]; }

// ---- picking helpers (results in as-modeled coordinates) ----
function rawBodyHit(e) {
  raycaster.setFromCamera(ndcOf(e), camera); scene.updateMatrixWorld();
  const meshes = []; for (const [, sb] of shownBodies) if (sb.mesh.visible) meshes.push(sb.mesh);
  return raycaster.intersectObjects(meshes, false)[0] || null;
}
function toModel(hit, p) { return p.clone().applyMatrix4(bodyXf(hit.object.userData.body).clone().invert()); }
// nearest mesh corner on screen (within 14 px) to the clicked triangle
function vertexHit(e) {
  const hit = rawBodyHit(e); if (!hit) return null;
  const r = renderer.domElement.getBoundingClientRect(), pos = hit.object.geometry.attributes.position, idx = hit.object.geometry.index;
  let best = null, bd = 14;
  for (const k of [hit.face.a, hit.face.b, hit.face.c]) {
    const w = new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(hit.object.matrixWorld), s = w.clone().project(camera);
    const d = Math.hypot((s.x + 1) / 2 * r.width + r.left - e.clientX, (1 - s.y) / 2 * r.height + r.top - e.clientY);
    if (d < bd) { bd = d; best = w; }
  }
  return best ? toModel(hit, best).toArray().map(v => Math.round(v * 1e6) / 1e6) : null;
}
// point on a curved face and the surface normal there (exact for cylinders, interpolated otherwise)
function curvedPointHit(e) {
  const hit = rawBodyHit(e); if (!hit) return null;
  const s = shownBodies.get(hit.object.userData.body); if (!s?.rec.shape) return null;
  const m = brepMeshOf(s.rec), hash = m.triFace[hit.faceIndex], sig = brepSigMap(s.rec, 'face').get(hash);
  const p = toModel(hit, hit.point);
  let n;
  if (sig?.type === 'CYLINDRE' && sig.ax) {
    const ap = new THREE.Vector3(...sig.ap), ax = new THREE.Vector3(...sig.ax), rel = p.clone().sub(ap), radial = rel.sub(ax.clone().multiplyScalar(rel.dot(ax)));
    n = radial.normalize(); const out = ap.clone().add(ax.clone().multiplyScalar(p.clone().sub(ap).dot(ax))).add(n.clone().multiplyScalar(sig.r));
    return { p: out, n, sig };
  }
  const nr = hit.object.geometry.attributes.normal, b = new THREE.Vector3();
  THREE.Triangle.getBarycoord(hit.object.worldToLocal(hit.point.clone()), ...[hit.face.a, hit.face.b, hit.face.c].map(k => new THREE.Vector3().fromBufferAttribute(hit.object.geometry.attributes.position, k)), b);
  n = new THREE.Vector3().addScaledVector(new THREE.Vector3().fromBufferAttribute(nr, hit.face.a), b.x).addScaledVector(new THREE.Vector3().fromBufferAttribute(nr, hit.face.b), b.y).addScaledVector(new THREE.Vector3().fromBufferAttribute(nr, hit.face.c), b.z).normalize();
  return { p, n, sig };
}
const PICK_PROMPTS = {
  vertex: 'Click a corner on the model', lineedge: 'Click a straight edge', circleedge: 'Click a round edge',
  cylface: 'Click a cylindrical face (a hole or a shaft)', face: 'Click a flat or cylindrical face', curved: 'Click a curved face where the plane should touch', plane: 'Click a plane or flat face',
};
function startConstructPick(steps, done, prompts = []) {
  cancelPick(); if (dlg) closeDialog(true);
  cpick = { steps, picks: [], done, prompts };
  viewport.classList.add('picking'); constructNextStep();
}
function constructNextStep() {
  const i = cpick.picks.length;
  if (i >= cpick.steps.length) { const c = cpick; cpick = null; viewport.classList.remove('picking'); defaultHint(); c.done(c.picks); return; }
  const kind = cpick.steps[i], text = (cpick.prompts[i] || PICK_PROMPTS[kind]) + (cpick.steps.length > 1 ? ` (${i + 1} of ${cpick.steps.length})` : '') + ' · Esc cancels';
  if (kind === 'plane') { const c = cpick; startPick({ prompt: text, planes: true, faces: true, then: pc => { if (cpick !== c) return; cpick.picks.push(pc); constructNextStep(); } }); return; }
  setHint(text);
}
function constructHint() { if (!cpick) return null; const i = cpick.picks.length, k = cpick.steps[i]; return k && k !== 'plane' ? (cpick.prompts[i] || PICK_PROMPTS[k]) + ' · Esc cancels' : null; }
function cancelConstructPick() { if (!cpick) return false; cpick = null; viewport.classList.remove('picking'); cancelPick(); defaultHint(); return true; }
function constructPickAt(e) {
  if (!cpick || pick) return false;
  const kind = cpick.steps[cpick.picks.length];
  let got = null;
  if (kind === 'vertex') got = vertexHit(e);
  else if (kind === 'lineedge') { const h = brepEdgeHit(e); if (h?.sig?.type === 'LINE' && h.sig.a) got = h.sig; else if (h) toast('That edge is not straight'); }
  else if (kind === 'circleedge') { const h = brepEdgeHit(e); if (h?.sig?.type === 'CIRCLE' && h.sig.cc) got = h.sig; else if (h) toast('That edge is not round'); }
  else if (kind === 'cylface') { const h = brepFaceHit(e); if (h?.sig?.type === 'CYLINDRE' && h.sig.ax) got = h.sig; else if (h) toast('That face is not cylindrical'); }
  else if (kind === 'face') { const h = brepFaceHit(e); if (h?.sig && (h.sig.type === 'PLANE' || (h.sig.type === 'CYLINDRE' && h.sig.ax))) got = { body: h.body, sig: h.sig }; else if (h) toast('Pick a flat or cylindrical face'); }
  else if (kind === 'curved') { const h = curvedPointHit(e); if (h && h.sig?.type !== 'PLANE') got = h; else if (h) toast('Pick a curved face; for a flat face use Offset Plane'); }
  if (got) { cpick.picks.push(got); constructNextStep(); }
  return true;
}

// ---- commands ----
function needExact(what) { if (isBrep()) return true; toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : what + ' needs the exact geometry engine, which could not start here: ' + engineMsg); return false; }
function addConstruct(f) { const snap = leanJSON(doc); checkpoint(); insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0); }
function startPlaneAtAngle() {
  startPick({ prompt: 'Select the plane or flat face to start from', planes: true, faces: true, then: c => addConstruct({ id: uid(), type: 'plane', mode: 'angle', name: nextName('plane'), base: c.plane, axis: 'u', angle: 45, offset: 0, flip: false }) });
}
function startMidplane() {
  startConstructPick(['plane', 'plane'], ([a, b]) => addConstruct({ id: uid(), type: 'plane', mode: 'mid', name: nextName('plane'), base: a.plane, base2: b.plane, offset: 0, flip: false }), ['Click the first plane or flat face', 'Click the second plane or flat face']);
}
function startTangentPlane() {
  if (!needExact('A tangent plane')) return;
  startConstructPick(['curved'], ([h]) => addConstruct({ id: uid(), type: 'plane', mode: 'tangent', name: nextName('plane'), frame: frameFromPoint(h.p, h.n), offset: 0, flip: false }));
}
function startPlane3p() { startConstructPick(['vertex', 'vertex', 'vertex'], ([a, b, c]) => addConstruct({ id: uid(), type: 'plane', mode: '3pt', name: nextName('plane'), p1: a, p2: b, p3: c, offset: 0, flip: false })); }
function startAxisCyl() { if (!needExact('Axis through cylinder')) return; startConstructPick(['cylface'], ([s]) => addConstruct({ id: uid(), type: 'axis', mode: 'cyl', name: nextName('axis'), o: s.ap, d: s.ax })); }
function startAxisEdge() { if (!needExact('Axis through edge')) return; startConstructPick(['lineedge'], ([s]) => addConstruct({ id: uid(), type: 'axis', mode: 'edge', name: nextName('axis'), o: s.a, d: s.b.map((v, i) => v - s.a[i]) })); }
function startAxis2p() { startConstructPick(['vertex', 'vertex'], ([a, b]) => addConstruct({ id: uid(), type: 'axis', mode: 'two', name: nextName('axis'), p1: a, p2: b })); }
function startAxis2planes() { startConstructPick(['plane', 'plane'], ([a, b]) => addConstruct({ id: uid(), type: 'axis', mode: 'planes', name: nextName('axis'), base: a.plane, base2: b.plane }), ['Click the first plane', 'Click the second plane']); }
function startPointVertex() { startConstructPick(['vertex'], ([p]) => addConstruct({ id: uid(), type: 'point', mode: 'vertex', name: nextName('point'), p })); }
function startPointCenter() { if (!needExact('Point at center')) return; startConstructPick(['circleedge'], ([s]) => addConstruct({ id: uid(), type: 'point', mode: 'center', name: nextName('point'), p: s.cc })); }
function startPointXYZ() { addConstruct({ id: uid(), type: 'point', mode: 'xyz', name: nextName('point'), x: 0, y: 0, z: 0 }); }

// ---- dialog sections ----
const PLANE_MODES = { offset: 'Offset', angle: 'At angle', mid: 'Midplane', tangent: 'Tangent', '3pt': 'Three points' };
function constructDialog(f, idx, out) {
  if (f.type === 'plane') {
    const mode = f.mode || 'offset';
    if (mode === 'offset') out.push(section_('Reference', selField('Plane', f, 'base', planeOptions(idx, f.base)), exField('Distance', f, 'offset'), chkField('Flip normal', f, 'flip')));
    else if (mode === 'angle') out.push(section_('Reference', selField('Plane', f, 'base', planeOptions(idx, f.base)),
      selField('Rotate about', f, 'axis', [['u', 'Plane X direction'], ['v', 'Plane Y direction'], ...axisOptions(idx)]), exField('Angle', f, 'angle', '°'), exField('Offset', f, 'offset'), chkField('Flip normal', f, 'flip')));
    else if (mode === 'mid') out.push(section_('Between', selField('First', f, 'base', planeOptions(idx, f.base)), selField('Second', f, 'base2', planeOptions(idx, f.base2)), exField('Offset', f, 'offset'), chkField('Flip normal', f, 'flip')));
    else out.push(section_('Placement', h('p', { class: 'note' }, mode === 'tangent' ? 'Touches the curved face at the point you clicked.' : 'Passes through the three picked corners.'), exField('Offset', f, 'offset'), chkField('Flip normal', f, 'flip')));
    return true;
  }
  if (f.type === 'axis') {
    if (f.mode === 'planes') out.push(section_('Where two planes meet', selField('First', f, 'base', planeOptions(idx, f.base)), selField('Second', f, 'base2', planeOptions(idx, f.base2))));
    else out.push(section_('Axis', h('p', { class: 'note' }, f.mode === 'cyl' ? 'Runs along the centre of the picked cylindrical face.' : f.mode === 'edge' ? 'Runs along the picked edge.' : 'Runs through the two picked corners.')));
    return true;
  }
  if (f.type === 'point') {
    if (f.mode === 'xyz') out.push(section_('Coordinates', exField('X', f, 'x'), exField('Y', f, 'y'), exField('Z', f, 'z')));
    else out.push(section_('Point', h('p', { class: 'note' }, f.mode === 'center' ? 'At the centre of the picked round edge.' : 'At the picked corner.'), h('p', { class: 'note' }, (f.p || []).map(v => fmt(v)).join(', '))));
    return true;
  }
  return false;
}

// ---- display ----
function drawConstructGeometry(group, size) {
  for (const [id, a] of result.axes || []) {
    const f = featById(id); if (!f) continue;
    if (doc.planeHidden[id] && selFeature !== id && dlg?.fid !== id && !pick) continue;
    const o = new THREE.Vector3(...a.o), d = new THREE.Vector3(...a.d), L = size * 0.6, on = selFeature === id || dlg?.fid === id;
    group.add(line([o.clone().addScaledVector(d, -L), o.clone().addScaledVector(d, L)], on ? colors.select : colors['ico-c'], { dashed: true, dash: L / 30, gap: L / 60, depthTest: false, order: 3 }));
  }
  for (const [id, pt] of result.points || []) {
    const f = featById(id); if (!f) continue;
    if (doc.planeHidden[id] && selFeature !== id && dlg?.fid !== id && !pick) continue;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(0.6, size * 0.012)), new THREE.MeshBasicMaterial({ color: selFeature === id || dlg?.fid === id ? colors.select : colors['ico-c'], depthTest: false }));
    m.position.set(...pt.p); m.renderOrder = 4; group.add(m);
  }
}
