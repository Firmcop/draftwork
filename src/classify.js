// ===== What an imported model is, and what can be done with it =====
// STEP: solids (editable), repaired solids, solids that fail the geometry check, surface bodies.
function stepKind(info) {
  if (!info) return null;
  const parts = [], next = [];
  if (info.solids) parts.push(`${info.solids} editable solid${info.solids === 1 ? '' : 's'}`);
  if (info.repaired) parts.push(`${info.repaired} repaired on import`);
  if (info.invalid) { parts.push(`${info.invalid} failing the geometry check`); next.push('Cuts on the failing solids may not work; re-export them from the source program if they do not.'); }
  if (info.surfaces) { parts.push(`${info.surfaces} surface bod${info.surfaces === 1 ? 'y' : 'ies'} (no volume)`); next.push('Surfaces can be trimmed and cut, but have no thickness: Stitch closes them into solids, Thicken gives them a wall.'); }
  const kind = info.solids && info.surfaces ? 'mixed' : info.solids ? (info.invalid ? 'solid-check' : 'solid') : info.surfaces ? 'surface' : 'empty';
  return { kind, label: { solid: 'Editable CAD solids', 'solid-check': 'CAD solids, some failing the check', mixed: 'Solids and surfaces', surface: 'Surface model', empty: 'No geometry' }[kind], text: parts.join(' · '), next: next.join(' ') || 'All features (cuts, holes, openings, fillets) work on these solids.' };
}
// meshes (STL/OBJ): watertight, open, non-manifold, or display only
function meshKind(s) {
  if (!s || !s.tris) return { kind: 'visual', label: 'Display only', next: 'No triangles to work with.' };
  if (s.nonManifold) return { kind: 'nonmanifold', label: 'Non-manifold mesh', next: 'Edges shared by more than two triangles: run Mesh › Repair. Until then it is for viewing and measuring only and cannot become a solid.' };
  if (s.boundary) return { kind: 'open', label: 'Open mesh', next: `${s.boundary} open edges: Mesh › Repair (fill holes) first. Converting it as it is gives a surface, not a solid.` };
  if (s.tris > 20000) return { kind: 'watertight-large', label: 'Watertight mesh (large)', next: 'Reduce it below 20,000 triangles, then Mesh › Convert Mesh to cut it.' };
  return { kind: 'watertight', label: 'Watertight mesh', next: 'Mesh › Convert Mesh makes a solid you can cut. It follows the triangles: an approximation, not exact CAD geometry.' };
}
function kindNote(k) { return k ? h('div', { class: 'kindnote', 'data-kind': k.kind }, h('b', {}, k.label), k.text ? h('span', {}, ' · ' + k.text) : null, h('p', { class: 'note' }, k.next)) : null; }
