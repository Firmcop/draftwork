// ===== Create Opening (doors, windows, vents, service penetrations) and the 20 ft container reference model =====
const OPENING_PRESETS = {
  door: { label: 'Door 900 × 2100', shape: 'rect', w: 900, h: 2100, radius: 0, fromBottom: 0 },
  doubledoor: { label: 'Double door 1800 × 2100', shape: 'rect', w: 1800, h: 2100, radius: 0, fromBottom: 0 },
  window: { label: 'Window 1200 × 1000', shape: 'rect', w: 1200, h: 1000, radius: 0, fromBottom: 900 },
  smallwindow: { label: 'Window 600 × 600', shape: 'rect', w: 600, h: 600, radius: 0, fromBottom: 1200 },
  vent: { label: 'Vent 300 × 150', shape: 'rect', w: 300, h: 150, radius: 20, fromBottom: 'top' },
  pipe: { label: 'Service penetration Ø150', shape: 'round', diameter: 150, fromBottom: 300 },
  cable: { label: 'Cable entry Ø50', shape: 'round', diameter: 50, fromBottom: 300 },
  custom: { label: 'Custom', shape: 'rect' },
};
// the wall's frame and extent, page side (for first placement from the click): mirrors openingFrame in the engine
function openingWallRange(f) {
  const M = planeMatrix(f.plane, f.offset || 0, !!f.flip), e = M.elements;
  const n = new THREE.Vector3(e[8], e[9], e[10]).normalize(), o = new THREE.Vector3(e[12], e[13], e[14]), Z = new THREE.Vector3(0, 0, 1);
  let up = Z.clone().sub(n.clone().multiplyScalar(n.dot(Z))); if (up.lengthSq() < 1e-6) up = new THREE.Vector3(e[4], e[5], e[6]); up.normalize();
  const right = up.clone().cross(n).normalize();
  const s = shownBodies.get(f.target), pos = s?.mesh?.geometry?.attributes?.position;
  if (!pos) return null;
  const box = new THREE.Box3().setFromBufferAttribute(pos), R = { r: [Infinity, -Infinity], u: [Infinity, -Infinity] };
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const d = new THREE.Vector3(x, y, z).sub(o);
    for (const [k, ax] of [['r', right], ['u', up]]) { const t = d.dot(ax); R[k][0] = Math.min(R[k][0], t); R[k][1] = Math.max(R[k][1], t); }
  }
  return { o, right, up, n, R, wallW: R.r[1] - R.r[0], wallH: R.u[1] - R.u[0] };
}
const round10 = v => Math.round(v / 10) * 10;
function applyOpeningPreset(f, key, clickWorld) {
  const p = OPENING_PRESETS[key]; f.preset = key; if (!p || key === 'custom') return;
  f.shape = p.shape;
  if (p.shape === 'round') f.diameter = p.diameter; else { f.w = p.w; f.h = p.h; f.radius = p.radius || 0; }
  const W = openingWallRange(f), ow = p.shape === 'round' ? p.diameter : p.w, oh = p.shape === 'round' ? p.diameter : p.h;
  if (!W) return;
  f.fromBottom = p.fromBottom === 'top' ? Math.max(0, round10(W.wallH - oh - 200)) : Math.min(p.fromBottom, Math.max(0, W.wallH - oh));
  if (clickWorld) f.fromLeft = Math.max(0, Math.min(round10(clickWorld.clone().sub(W.o).dot(W.right) - W.R.r[0] - ow / 2), Math.floor(W.wallW - ow)));
  else f.fromLeft = Math.max(0, Math.min(+f.fromLeft || 0, Math.floor(W.wallW - ow)));
}
function startOpening(preset = 'door') {
  if (!isBrep()) { toast('Openings need the exact geometry engine'); return; }
  startPick({ prompt: 'Click the wall where the opening goes (outside face)', faces: true, planes: false, then: c => {
    if (!c.body) { toast('Click a face of the wall'); return; }
    if (mbodyOf?.(c.body)) { toast('That body is a mesh. Convert it first: Mesh › Convert Mesh.'); return; }
    const snap = leanJSON(doc); checkpoint();
    const f = { id: uid(), type: 'opening', name: nextName('opening'), plane: c.plane, offset: c.offset || 0, flip: !!c.flip, target: c.body, shape: 'rect', w: 900, h: 2100, radius: 0, fromLeft: 0, fromBottom: 0, frame: false, frameWidth: 50 };
    const click = c.M && c.local ? new THREE.Vector3(c.local.x, c.local.y, 0).applyMatrix4(c.M) : null;
    applyOpeningPreset(f, preset, click);
    insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  } });
}
function mbodyOf(id) { return result?.mbodies?.has?.(id); }
function repickOpeningWall(f) {
  startPick({ prompt: 'Click the outside face of the wall', faces: true, planes: false, then: c => {
    if (!c.body) return;
    checkpoint(); Object.assign(f, { plane: c.plane, offset: c.offset || 0, flip: !!c.flip, target: c.body });
    rerenderDialog(); scheduleRegen(0);
  } });
}
function openingInfoText(info) { return info ? `Wall ${fmt(info.wallW)} × ${fmt(info.wallH)} mm · cut depth ${fmt(info.depth)} mm` : 'Measuring the wall…'; }
function openingDialog(f, idx, out) {
  const st = statusOf(f.id), info = st.info;
  out.push(section_('Wall',
    selField('Wall', f, 'target', bodiesBefore(f.id).map(([id, nm]) => [id, compOfBody(id)?.name || nm]), { id: 'ds-target' }),
    h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'op-repick', onclick: () => repickOpeningWall(f), html: icon('pick') + 'Pick wall face…' })),
    h('p', { class: 'note', id: 'op-wallinfo' }, openingInfoText(info))));
  out.push(section_('Opening',
    selField('Preset', f, 'preset', Object.entries(OPENING_PRESETS).map(([k, p]) => [k, p.label]), { id: 'ds-preset', rerender: true, after: () => applyOpeningPreset(f, f.preset) }),
    segField('Shape', f, 'shape', [['rect', 'Rectangle'], ['round', 'Round']], { rerender: true, after: () => { f.preset = 'custom'; if (f.shape === 'round') f.diameter ??= 150; } }),
    ...(f.shape === 'round' ? [exField('Diameter', f, 'diameter', 'mm', { min: 0.01, after: () => { f.preset = 'custom'; } })]
      : [exField('Width', f, 'w', 'mm', { min: 0.01, after: () => { f.preset = 'custom'; } }), exField('Height', f, 'h', 'mm', { min: 0.01, after: () => { f.preset = 'custom'; } }), exField('Corner radius', f, 'radius', 'mm', { min: 0 })])));
  out.push(section_('Position (from outside)',
    exField('From left edge', f, 'fromLeft', 'mm', { min: 0 }), exField('From bottom edge', f, 'fromBottom', 'mm', { min: 0 }),
    h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'op-center', onclick: () => { const W = openingWallRange(f); if (!W) return; checkpoint(); const ow = f.shape === 'round' ? +f.diameter : +f.w; f.fromLeft = Math.round((W.wallW - ow) / 2 * 10) / 10; rerenderDialog(); scheduleRegen(0); } }, 'Center across the wall'))));
  out.push(section_('Frame',
    chkField('Add a frame around the opening', f, 'frame', { rerender: true }),
    ...(f.frame ? [exField('Frame width', f, 'frameWidth', 'mm', { min: 0.01 }), exField('Frame depth (thick bodies)', f, 'frameDepth', 'mm', { min: 0 }), h('p', { class: 'note' }, 'The frame replaces the wall in a band around the opening and is its own body.')] : [])));
  out.push(section_('Depth', exField('Cut depth (0 = through the wall)', f, 'depth', 'mm', { min: 0 }),
    h('p', { class: 'note' }, 'Only the picked wall is cut. Posts and rails it runs into are reported, not cut.')));
}
// Insert › Shipping container: a new design with every part as its own component
function insertContainer() {
  const d = newDesignDoc('hybrid'); d.name = '20 ft container';
  d.features = containerFeatures();
  openInTab(d, { msg: '20 ft container: every part is its own component. Use Create Opening on a wall to add doors and windows.' });
}
cmd('opening', 'Create Opening', 'hole', { run: () => startOpening('door') });
cmd('container20', 'Shipping Container 20 ft', 'box', { run: () => insertContainer() });
