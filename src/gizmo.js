// ===== Move/rotate handles: arrows to drag along X, Y, Z and rings to turn about them, on the Move/Copy feature =====
// Dragging previews the move on the shown meshes at once (no rebuild while dragging); the exact move is rebuilt on release.
const GZ = { group: null, f: null, key: '', drag: null, size: 1 };
const GZ_AXES = [['x', [1, 0, 0], 0xd9433b], ['y', [0, 1, 0], 0x2e9e4f], ['z', [0, 0, 1], 0x2f6fd8]];
function gizmoBuild() {
  const g = new THREE.Group(); g.visible = false; g.renderOrder = 30;
  const mat = (c, o = 0.95) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, transparent: true, opacity: o });
  for (const [ax, v, c] of GZ_AXES) {
    const dir = new THREE.Vector3(...v), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 10), mat(c)); shaft.position.copy(dir.clone().multiplyScalar(0.39 + 0.12)); shaft.quaternion.copy(q);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 16), mat(c)); head.position.copy(dir.clone().multiplyScalar(1.0)); head.quaternion.copy(q);
    const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8), mat(c, 0)); grab.position.copy(dir.clone().multiplyScalar(0.6)); grab.quaternion.copy(q);
    for (const m of [shaft, head, grab]) { m.userData.gz = { kind: 't', ax }; m.renderOrder = 30; g.add(m); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.012, 8, 96), mat(c, 0.85)), ringGrab = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.06, 6, 48), mat(c, 0));
    for (const m of [ring, ringGrab]) { if (ax === 'x') m.rotation.y = Math.PI / 2; if (ax === 'y') m.rotation.x = Math.PI / 2; m.userData.gz = { kind: 'r', ax }; m.renderOrder = 30; g.add(m); }
  }
  scene.add(g);
  controls.addEventListener('change', gizmoScale);
  return g;
}
function gizmoScale() {
  if (!GZ.group?.visible) return;
  const d = camera.position.distanceTo(GZ.group.position), s = camera.isPerspectiveCamera ? d * 0.16 : (camera.top - camera.bottom) / camera.zoom * 0.08;
  GZ.size = s; GZ.group.scale.setScalar(s);
}
// the bodies a move feature moves, as shown (a copy shows as the new bodies)
function moveBodyIds(f) {
  const all = [...result.bodies.keys()];
  if (f.copy) return all.filter(id => String(id).split(':')[0] === f.id);
  if (f.body === 'all') return all;
  if (String(f.body).startsWith('feat:')) { const fid = f.body.slice(5); return all.filter(id => String(result.bodies.get(id)?.feature).split(':')[0] === fid); }
  return result.bodies.has(f.body) ? [f.body] : [];
}
const num = v => { const n = typeof v === 'number' ? v : evalExpr(String(v ?? 0), params.vars); return isFinite(n) ? n : 0; };
function moveMatrix(v, pivot) {
  const p = new THREE.Vector3(...(pivot || [0, 0, 0])), r = THREE.MathUtils.degToRad;
  return new THREE.Matrix4().makeTranslation(p.x + v.dx, p.y + v.dy, p.z + v.dz)
    .multiply(new THREE.Matrix4().makeRotationX(r(v.rx))).multiply(new THREE.Matrix4().makeRotationY(r(v.ry))).multiply(new THREE.Matrix4().makeRotationZ(r(v.rz)))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}
const moveVals = f => ({ dx: num(f.dx), dy: num(f.dy), dz: num(f.dz), rx: num(f.rx), ry: num(f.ry), rz: num(f.rz) });
// shows the handles while a Move/Copy dialog is open
function gizmoSync() {
  const f = dlg?.fid ? featById(dlg.fid) : null, on = !!(f && f.type === 'move' && mode === 'model' && !GZ.drag);
  if (!on) { if (GZ.group?.visible && !GZ.drag) { GZ.group.visible = false; requestRender(); } GZ.f = null; return; }
  GZ.group ||= gizmoBuild();
  const v = moveVals(f), p = f.pivot || [0, 0, 0], key = JSON.stringify([f.id, v, p]);
  if (GZ.group.visible && GZ.key === key) return;
  GZ.f = f; GZ.key = key;
  GZ.group.position.set(p[0] + v.dx, p[1] + v.dy, p[2] + v.dz);
  GZ.group.visible = true; gizmoScale(); requestRender();
}
setInterval(() => { try { gizmoSync(); } catch (e) { } }, 200);
function gizmoRayAxis(e, origin, axis) {
  // where the pointer ray passes closest to the line origin + t·axis: returns t
  raycaster.setFromCamera(ndcOf(e), camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction, w0 = origin.clone().sub(o);
  const a = axis.dot(axis), b = axis.dot(d), c = d.dot(d), dd = axis.dot(w0), ee = d.dot(w0), den = a * c - b * b;
  return Math.abs(den) < 1e-9 ? 0 : (b * ee - c * dd) / den;
}
function gizmoRayAngle(e, center, axis) {
  raycaster.setFromCamera(ndcOf(e), camera);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, center), hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  const u = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0).cross(axis).normalize() : new THREE.Vector3(0, 1, 0).cross(axis).normalize(), w = axis.clone().cross(u);
  const v = hit.sub(center); return Math.atan2(v.dot(w), v.dot(u));
}
viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !GZ.group?.visible || !GZ.f) return;
  raycaster.setFromCamera(ndcOf(e), camera); scene.updateMatrixWorld();
  const hit = raycaster.intersectObjects(GZ.group.children, false)[0]; if (!hit) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const f = GZ.f, g = hit.object.userData.gz, axis = new THREE.Vector3(...GZ_AXES.find(a => a[0] === g.ax)[1]);
  checkpoint();
  const v0 = moveVals(f), center = GZ.group.position.clone(), ids = moveBodyIds(f);
  GZ.drag = { f, g, axis, v0, center, ids, base: moveMatrix(v0, f.pivot).invert(), t0: g.kind === 't' ? gizmoRayAxis(e, center, axis) : 0, a0: g.kind === 'r' ? gizmoRayAngle(e, center, axis) : 0, acc: 0, last: null };
  GZ.drag.last = GZ.drag.a0;
  controls.enabled = false;
  window.addEventListener('pointermove', gizmoMove);
  window.addEventListener('pointerup', gizmoUp, { once: true });
}, true);
function gizmoMove(e) {
  const D = GZ.drag; if (!D) return;
  const f = D.f, v = { ...D.v0 }, fine = e.shiftKey;
  if (D.g.kind === 't') {
    const step = fine ? 0.1 : 1, dt = Math.round((gizmoRayAxis(e, D.center, D.axis) - D.t0) / step) * step;
    v['d' + D.g.ax] = Math.round((D.v0['d' + D.g.ax] + dt) * 1000) / 1000;
    setHint(`Move ${D.g.ax.toUpperCase()} ${fmt(dt)} mm · Shift for 0.1 mm steps`);
  } else {
    const a = gizmoRayAngle(e, D.center, D.axis); if (a == null) return;
    let da = a - D.last; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; D.acc += da; D.last = a;
    const step = fine ? 1 : 5, deg = Math.round(THREE.MathUtils.radToDeg(D.acc) / step) * step;
    v['r' + D.g.ax] = Math.round((D.v0['r' + D.g.ax] + deg) * 1000) / 1000;
    setHint(`Rotate about ${D.g.ax.toUpperCase()} ${fmt(deg)}° · Shift for 1° steps`);
  }
  for (const k of ['dx', 'dy', 'dz', 'rx', 'ry', 'rz']) f[k] = v[k];
  // preview: the shown meshes move by the change since the last rebuild
  const delta = moveMatrix(v, f.pivot).multiply(D.base);
  for (const id of D.ids) { const s = shownBodies.get(id); if (!s) continue; const m = bodyXf(id).clone().multiply(delta); for (const o of [s.mesh, s.edges, s.cap]) { o.matrixAutoUpdate = false; o.matrix.copy(m); o.matrixWorldNeedsUpdate = true; } }
  GZ.group.position.set((f.pivot?.[0] || 0) + v.dx, (f.pivot?.[1] || 0) + v.dy, (f.pivot?.[2] || 0) + v.dz);
  requestRender();
}
function gizmoUp() {
  window.removeEventListener('pointermove', gizmoMove);
  const D = GZ.drag; GZ.drag = null; controls.enabled = true; if (!D) return;
  GZ.key = ''; defaultHint?.();
  if (typeof rerenderDialog === 'function') rerenderDialog();
  scheduleRegen(0);
}
// the pivot for a move: the centre of its bodies before the move (shown centre minus the current translation)
function movePivot(f) {
  const ids = moveBodyIds({ ...f, copy: false }), c = bodiesCenter(ids), v = moveVals(f), moved = !f.copy && ids.length && (v.dx || v.dy || v.dz);
  return moved ? [c[0] - v.dx, c[1] - v.dy, c[2] - v.dz].map(x => Math.round(x * 1000) / 1000) : c;
}
// pivot: the centre of the bodies' bounding box as shown (model coordinates)
function bodiesCenter(ids) {
  const box = new THREE.Box3();
  for (const id of ids) { const s = shownBodies.get(id), pos = s?.mesh?.geometry?.attributes?.position; if (pos?.count) box.union(new THREE.Box3().setFromBufferAttribute(pos)); }
  if (box.isEmpty()) return [0, 0, 0];
  const c = box.getCenter(new THREE.Vector3()); return [c.x, c.y, c.z].map(v => Math.round(v * 1000) / 1000);
}
