// ===== Assembly: motion links (one joint drives another) and contact sets (parts stop when they touch) =====
const links = () => doc.motionLinks || (doc.motionLinks = []);
let contactBVH = new WeakMap();
// value of a follower joint's degree of freedom, from its leader (null when not linked)
function linkedVal(j, k, depth = 0) {
  if (depth > 6) return null;
  const L = links().find(l => l.b === j.id && l.kb === k && !l.suppressed); if (!L) return null;
  const lead = joints().find(x => x.id === L.a); if (!lead) return null;
  return jval(lead, L.ka) * (+L.ratio || 0) * (L.reverse ? -1 : 1) + (+L.offset || 0);
}
const isFollower = (jid, k) => links().some(l => l.b === jid && l.kb === k && !l.suppressed);
function openMotionLink(id) {
  const js = joints().filter(j => JOINT_TYPES[j.type].dofs.length);
  if (js.length < 2) { toast('A motion link needs two joints that can move'); return; }
  const snap = JSON.stringify(doc); checkpoint();
  let L = id ? links().find(l => l.id === id) : null;
  if (!L) { L = { id: uid(), name: 'Motion Link ' + (links().length + 1), a: js[0].id, ka: JOINT_TYPES[js[0].type].dofs[0], b: js[1].id, kb: JOINT_TYPES[js[1].type].dofs[0], ratio: 1, offset: 0, reverse: false }; links().push(L); }
  const dofOpts = jid => { const j = joints().find(x => x.id === jid); return j ? JOINT_TYPES[j.type].dofs.map(k => [k, k === 'angle' ? 'Angle' : k === 'distance' ? 'Distance' : k.toUpperCase()]) : []; };
  const changed = () => { persist(); assemblyChanged(); };
  openPanelDialog({ title: 'Motion Link', icon: 'motion', okLabel: 'OK',
    help: 'The second joint follows the first: value = first × ratio + offset. Gears: angle → angle with the tooth ratio. Rack and pinion: angle → distance with mm per degree.',
    body: () => [
      section_('Drives', selField('Joint', L, 'a', js.map(j => [j.id, j.name]), { rerender: true, after: () => { L.ka = dofOpts(L.a)[0]?.[0]; changed(); } }), selField('Motion', L, 'ka', dofOpts(L.a), { after: changed })),
      section_('Follows', selField('Joint', L, 'b', js.filter(j => j.id !== L.a).map(j => [j.id, j.name]), { rerender: true, after: () => { L.kb = dofOpts(L.b)[0]?.[0]; changed(); } }), selField('Motion', L, 'kb', dofOpts(L.b), { after: changed })),
      section_('Relation', exField('Ratio', L, 'ratio', '', { after: changed, step: 0.1 }), exField('Offset', L, 'offset', L.kb === 'angle' ? '°' : 'mm', { after: changed }), chkField('Reverse', L, 'reverse', { after: changed }),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => { doc.motionLinks = links().filter(x => x !== L); closeDialog(true); changed(); renderBrowser(); } }, 'Delete link'))),
    ],
    onOK: () => { if (L.a === L.b) doc.motionLinks = links().filter(x => x !== L); changed(); renderBrowser(); },
    onCancel: () => { doc = JSON.parse(snap); afterDocReplace(); },
  });
  changed();
}
// ---- contact sets ----
function toggleContact() {
  checkpoint();
  doc.contact = { ...(doc.contact || {}), on: !doc.contact?.on };
  persist(); renderRibbon(); renderBrowser();
  toast(doc.contact.on ? 'Contact on: dragged parts stop where they touch other parts' : 'Contact off');
}
// indirect: keep the display geometry's triangle order (face picking relies on it)
function bvhOf(geom) { let b = contactBVH.get(geom); if (!b) { b = new MeshBVH(geom, { indirect: true }); contactBVH.set(geom, b); } return b; }
// do any bodies of different solver nodes overlap in their current (preview) positions?
function contactHit(movingKeys) {
  if (!doc.contact?.on) return null;
  const items = [];
  for (const [id, s] of shownBodies) { if (!s.mesh.visible || !s.rec.shape) continue; const key = compKey(id); items.push({ id, key, geom: s.mesh.geometry, M: bodyXf(id) }); }
  for (const a of items) {
    if (!movingKeys.has(a.key)) continue;
    for (const b of items) {
      if (b.key === a.key || (movingKeys.has(b.key) && b.id < a.id)) continue;
      a.geom.computeBoundingBox(); b.geom.computeBoundingBox();
      // a's geometry into b's frame, shrunk by ~0.03 mm so parts merely resting on each other do not count as contact
      const ab = a.geom.boundingBox, c = ab.getCenter(new THREE.Vector3()), size = Math.max(...ab.getSize(new THREE.Vector3()).toArray(), 1e-6), sc = Math.max(0.5, 1 - 0.06 / size);
      const shrink = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeScale(sc, sc, sc)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      const rel = b.M.clone().invert().multiply(a.M).multiply(shrink);
      const ba = a.geom.boundingBox.clone().applyMatrix4(rel); if (!ba.intersectsBox(b.geom.boundingBox)) continue;
      const shrunk = ba.clone().expandByScalar(-0.01); if (shrunk.isEmpty()) continue;
      if (bvhOf(b.geom).intersectsGeometry(a.geom, rel)) return [a.id, b.id];
    }
  }
  return null;
}
