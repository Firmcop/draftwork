// ===== Mesh workspace: insert, tessellate, face groups, repair, remesh, reduce, smooth, plane cut, convert =====
const meshBodies = () => [...result.bodies].filter(([, b]) => b.mesh).map(([id]) => id);
const solidBodies = () => [...result.bodies].filter(([, b]) => b.shape).map(([id]) => id);
function startInsertMesh() {
  if (!needExact('Insert Mesh')) return;
  const inp = h('input', { type: 'file', accept: '.stl,.obj', hidden: true });
  inp.addEventListener('change', () => {
    const file = inp.files?.[0]; inp.remove(); if (!file) return;
    if (file.size > 40e6) { toast('That file is over 40 MB'); return; }
    const isObj = /\.obj$/i.test(file.name), rd = new FileReader();
    rd.onload = async () => {
      let data, binary = false;
      if (isObj) data = String(rd.result);
      else {
        const u8 = new Uint8Array(rd.result), head = new TextDecoder().decode(u8.slice(0, 256));
        const n = u8.length >= 84 ? new DataView(u8.buffer).getUint32(80, true) : -1;
        if (/^\s*solid/.test(head) && u8.length !== 84 + n * 50) data = new TextDecoder().decode(u8);
        else { binary = true; let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); data = btoa(s); }
      }
      const fileId = uid();
      toast('Reading ' + file.name + '…');
      try {
        const n = await engineMeshFile(fileId, file.name, data, binary); importsRead.add(fileId);
        const snap = leanJSON(doc); checkpoint();
        doc.files ||= {}; doc.files[fileId] = { name: file.name, data, binary, kind: 'mesh' };
        const f = { id: uid(), type: 'meshinsert', name: file.name.replace(/\.(stl|obj)$/i, ''), file: fileId, units: 'mm', center: true, upY: false };
        insertFeature(f); await doRegen(); setView('fit'); openFeatureDialog(f.id, true, snap);
        toast(`Inserted ${n.toLocaleString('en-US')} triangles from ${file.name}`);
      } catch (err) { toast('Could not read ' + file.name + ': ' + (err.message || err)); }
    };
    isObj ? rd.readAsText(file) : rd.readAsArrayBuffer(file);
  });
  document.body.append(inp); inp.click();
}
function ensureMeshImports() {
  for (const f of doc.features) {
    if (f.type !== 'meshinsert' || !f.file || importsRead.has(f.file) || importPending.has(f.file)) continue;
    const file = doc.files?.[f.file]; if (!file) continue;
    importPending.add(f.file);
    Promise.resolve(payloadsReady).then(() => { if (file.data == null) throw new Error('the file contents were not saved with this design; insert it again'); return engineMeshFile(f.file, file.name, file.data, file.binary); }).then(() => importsRead.add(f.file)).catch(e => { importsRead.add(f.file); toast('Could not read ' + file.name + ': ' + (e.message || e)); })
      .finally(() => { importPending.delete(f.file); scheduleRegen(0); });
  }
}
function newMesh(type) {
  if (!needExact(TYPE[type].label)) return;
  const meshes = meshBodies(), solids = solidBodies();
  let f;
  if (type === 'tessellate') { if (!solids.length) return toast('There is no solid or surface body to tessellate'); f = { body: selBody && solids.includes(selBody) ? selBody : solids.at(-1), tolerance: 0.05, angle: 10, keep: false }; }
  else {
    if (!meshes.length) return toast('There is no mesh body. Insert a mesh or tessellate a body first.');
    const body = selBody && meshes.includes(selBody) ? selBody : meshes.at(-1);
    f = { body, ...({ facegroups: { angle: 20 }, meshrepair: { tolerance: 0.0001, fill: true }, remesh: { edge: 0 }, reduce: { mode: 'percent', percent: 50, count: 1000 }, smooth: { iterations: 5, strength: 0.5, keepEdges: true }, meshconvert: { method: 'prismatic', keep: false }, meshplane: { tool: 'XY', keep: 'positive', fill: true } }[type]) };
  }
  const snap = leanJSON(doc); checkpoint();
  f = { id: uid(), type, name: nextName(type), ...f };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
function meshStatsNote(id) {
  const b = result.bodies.get(id); if (!b?.stats) return null;
  const s = b.stats;
  return h('p', { class: 'note' }, `${s.tris.toLocaleString('en-US')} triangles · ${s.verts.toLocaleString('en-US')} vertices · ${s.closed ? 'closed' : `open (${s.boundary} boundary edges${s.nonManifold ? ', ' + s.nonManifold + ' non-manifold' : ''})`}${s.closed ? ' · ' + fmt(Math.abs(s.volume) / 1000) + ' cm³' : ''}${b.groupCount ? ' · ' + b.groupCount + ' face groups' : ''}`);
}
function meshDialog(f, idx, out) {
  const meshOpts = () => { const ids = meshBodies(); if (f.body && !ids.includes(f.body)) ids.unshift(f.body); return ids.map(id => [id, bodyName(id)]); };
  const bodySec = (title, ...kids) => section_(title, selField('Mesh body', f, 'body', meshOpts(), { rerender: true }), ...kids);
  switch (f.type) {
    case 'meshinsert':
      out.push(section_('Mesh', h('p', { class: 'note' }, doc.files?.[f.file]?.name || 'Missing file'), selField('Units in the file', f, 'units', [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['m', 'Metres'], ['in', 'Inches'], ['ft', 'Feet']]),
        chkField('Centre on the origin, resting on XY', f, 'center'), chkField('File is Y-up (rotate to Z-up)', f, 'upY'), meshStatsNote(f.id)));
      return true;
    case 'tessellate':
      out.push(section_('Tessellate', selField('Body', f, 'body', solidBodies().map(id => [id, bodyName(id)])), exField('Surface deviation', f, 'tolerance', 'mm', { min: 0.001 }), exField('Normal deviation', f, 'angle', '°', { min: 0.5, max: 45 }), chkField('Keep the original body', f, 'keep')));
      return true;
    case 'facegroups': out.push(bodySec('Face Groups', exField('Angle', f, 'angle', '°', { min: 1, max: 80 }), h('p', { class: 'note' }, 'Neighbouring triangles whose normals differ less than the angle join one group.'), meshStatsNote(f.body))); return true;
    case 'meshrepair': out.push(bodySec('Repair', exField('Weld tolerance', f, 'tolerance', 'mm', { min: 0 }), chkField('Fill holes', f, 'fill'), h('p', { class: 'note' }, 'Merges coincident vertices, removes degenerate and duplicate triangles, makes normals consistent and outward, and caps open holes.'), meshStatsNote(f.body))); return true;
    case 'remesh': out.push(bodySec('Remesh', exField('Target edge length (0 = average)', f, 'edge', 'mm', { min: 0 }), h('p', { class: 'note' }, 'Splits long edges, collapses short ones and evens out the spacing.'), meshStatsNote(f.body))); return true;
    case 'reduce': out.push(bodySec('Reduce', segField('Target', f, 'mode', [['percent', 'Percent'], ['count', 'Triangle count']], { rerender: true }),
      f.mode === 'count' ? exField('Triangles', f, 'count', '', { min: 4 }) : exField('Keep', f, 'percent', '%', { min: 1, max: 100 }), h('p', { class: 'note' }, 'Quadric edge collapse: flat areas lose triangles first; outlines are kept.'), meshStatsNote(f.body))); return true;
    case 'smooth': out.push(bodySec('Smooth', exField('Iterations', f, 'iterations', '', { min: 1, max: 100 }), exField('Strength', f, 'strength', '', { min: 0.05, max: 0.9, step: 0.05 }), chkField('Keep sharp edges', f, 'keepEdges'), h('p', { class: 'note' }, 'Taubin smoothing: removes noise without shrinking the shape.'), meshStatsNote(f.body))); return true;
    case 'meshplane': out.push(bodySec('Plane Cut', selField('Plane', f, 'tool', planeOptions(idx, f.tool)), segField('Keep', f, 'keep', [['positive', 'Front side'], ['negative', 'Back side']]), chkField('Cap the cut', f, 'fill'), meshStatsNote(f.body))); return true;
    case 'meshconvert': out.push(bodySec('Convert Mesh', segField('Method', f, 'method', [['prismatic', 'Prismatic (merge flat areas)'], ['faceted', 'Faceted']]), chkField('Keep the mesh body', f, 'keep'),
      h('p', { class: 'note' }, 'Makes an exact body from the triangles (up to 20,000). Closed meshes become solids, open ones surfaces.'), meshStatsNote(f.body))); return true;
  }
  return false;
}
