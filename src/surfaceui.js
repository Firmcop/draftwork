// ===== Surface workspace commands and dialogs =====
const SURF_FACE_UI = new Set(['soffset', 'untrim', 'deleteface']);
const SURF_EDGE_UI = new Set(['ruled', 'sextend', 'patch']);
const isSurfBody = id => { const b = result.bodies.get(id); return !!(b && (b.surface || (b.shape && brepProps(b).surface))); };

function sketchesAt(end, test = () => true) { return doc.features.slice(0, end).filter(g => g.type === 'sketch' && statusOf(g.id).state === 'ok' && test(g)); }
function newSurface(type) {
  if (!needExact(TYPE[type].label)) return;
  const end = insertIndex(), bodies = bodiesAtInsert();
  const sel = selFeature && featById(selFeature);
  const sks = sketchesAt(end), pickSk = () => (sks.includes(sel) ? sel : sks.at(-1))?.id || null;
  const surfs = bodies.filter(isSurfBody), pickBody = list => (selBody && list.includes(selBody) ? selBody : list.at(-1)) || null;
  let f;
  switch (type) {
    case 'sextrude': if (!sks.length) return toast('Sketch the curves to extrude first (open lines are fine)'); f = { sketch: pickSk(), distance: 10, direction: 'one' }; break;
    case 'srevolve': if (!sks.length) return toast('Sketch the profile curve first'); f = { sketch: pickSk(), axis: 'v', angle: 360 }; break;
    case 'patch': f = { sketch: sks.find(s => profCount(s)) ? pickSk() : null, merge: true }; break;
    case 'sloft': if (sks.length < 2) return toast('Loft needs two sketches with a curve each'); f = { sketches: sks.slice(-2).map(s => s.id), ruled: false }; break;
    case 'ssweep': if (sks.length < 2) return toast('Sweep needs a profile sketch and a path sketch'); f = { sketch: sks.at(-2).id, path: sks.at(-1).id }; break;
    case 'soffset': f = { distance: 5 }; break;
    case 'ruled': f = { distance: 10, mode: 'normal', flip: false }; break;
    case 'sextend': if (!surfs.length) return toast('Extend works on surface bodies'); f = { distance: 5 }; break;
    case 'untrim': case 'deleteface': if (!bodies.length) return toast('There is no body yet'); f = {}; break;
    case 'trim': if (!surfs.length) return toast('There is no surface body to trim'); f = { body: pickBody(surfs), tool: 'YZ', toolBody: null, keep: 'positive' }; break;
    case 'stitch': if (!surfs.length) return toast('There are no surface bodies to stitch'); f = { bodies: [...surfs], tolerance: 0.01, solid: true }; break;
    case 'unstitch': if (!bodies.length) return toast('There is no body yet'); f = { body: pickBody(bodies) }; break;
    case 'reverse': if (!surfs.length) return toast('There is no surface body'); f = { body: pickBody(surfs) }; break;
  }
  const snap = JSON.stringify(doc); checkpoint();
  f = { id: uid(), type, name: nextName(type), ...(SURF_FACE_UI.has(type) || SURF_EDGE_UI.has(type) ? { edges: [] } : {}), ...f };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  if (SURF_FACE_UI.has(type)) toast('Click the faces on the model');
  else if (type === 'ruled' || type === 'sextend') toast('Click the edges on the model');
  else if (type === 'patch' && !f.sketch) toast('Click the boundary edges to fill, or choose a sketch');
}
function surfaceDialog(f, idx, out) {
  const sks = doc.features.slice(0, idx).filter(g => g.type === 'sketch').map(s => [s.id, s.name]);
  const bodies = bodiesBefore(f.id), surfs = bodies.filter(([id]) => isSurfBody(id));
  const pickNote = what => { const n = (f.edges || []).length; return [h('p', { class: 'note' }, n ? `${n} ${what}${n > 1 ? 's' : ''} selected. Click on the model to add or remove.` : `Click the ${what}s on the model.`),
    h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', disabled: !n, onclick: () => { checkpoint(); f.edges = []; rerenderDialog(); scheduleRegen(0); drawToolsOverlay(); } }, 'Clear selection'))]; };
  switch (f.type) {
    case 'sextrude':
      out.push(section_('Profile', selField('Sketch', f, 'sketch', sks), h('p', { class: 'note' }, 'Every curve of the sketch (open chains, closed loops and circles) is extruded into a surface.')),
        section_('Extent', exField('Distance', f, 'distance'), segField('Direction', f, 'direction', [['one', 'One side'], ['symmetric', 'Symmetric'], ['reverse', 'Flipped']])));
      return true;
    case 'srevolve':
      out.push(section_('Profile', selField('Sketch', f, 'sketch', sks)),
        section_('Axis', selField('Axis', f, 'axis', [['u', 'Sketch X axis'], ['v', 'Sketch Y axis'], ...axisOptions(idx)]), exField('Angle', f, 'angle', '°', { min: 0.01, max: 360 })));
      return true;
    case 'patch':
      out.push(section_('Boundary', ...pickNote('boundary edge'), selField('Or a sketch', f, 'sketch', [['', '— edges picked on the model —'], ...sks]),
        chkField('Merge into the surface the edges belong to', f, 'merge'),
        h('p', { class: 'note' }, 'Edges must form a closed loop. Flat loops become flat faces; others get a smooth filling surface.')));
      return true;
    case 'sloft': {
      const list = h('div', { class: 'picklist' }), all = doc.features.slice(0, idx).filter(g => g.type === 'sketch');
      for (const s of all) {
        const c = h('input', { type: 'checkbox', id: 'sl-' + s.id, checked: (f.sketches || []).includes(s.id) });
        c.addEventListener('change', () => { checkpoint(); const set = new Set(f.sketches || []); c.checked ? set.add(s.id) : set.delete(s.id); f.sketches = all.map(x => x.id).filter(id => set.has(id)); scheduleRegen(0); });
        list.append(h('label', { class: 'chk', for: 'sl-' + s.id }, c, s.name));
      }
      out.push(section_('Sections', h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Sketches'), list), chkField('Straight (ruled) between sections', f, 'ruled'),
        h('p', { class: 'note' }, 'Uses the first curve chain of each sketch, in timeline order.')));
      return true;
    }
    case 'ssweep':
      out.push(section_('Sweep', selField('Profile sketch', f, 'sketch', sks), selField('Path sketch', f, 'path', sks), h('p', { class: 'note' }, 'The profile curves follow the first chain of the path sketch.')));
      return true;
    case 'soffset':
      out.push(section_('Faces', ...pickNote('face')), section_('Offset', exField('Distance', f, 'distance', 'mm', { id: 'dx-sodist' }), h('p', { class: 'note' }, 'Negative offsets go the other way. The result is a new surface body.')));
      return true;
    case 'ruled':
      out.push(section_('Edges', ...pickNote('edge')), section_('Ruled', exField('Distance', f, 'distance', 'mm', { min: 0.01 }), segField('Direction', f, 'mode', [['normal', 'Normal to face'], ['tangent', 'Tangent to face']]), chkField('Flip', f, 'flip')));
      return true;
    case 'sextend':
      out.push(section_('Edges', ...pickNote('boundary edge')), section_('Extend', exField('Distance', f, 'distance', 'mm', { min: 0.01 }), h('p', { class: 'note' }, 'Extends tangent to the surface and stitches the new strip on.')));
      return true;
    case 'untrim': out.push(section_('Faces', ...pickNote('face'), h('p', { class: 'note' }, 'Removes holes from the picked faces.'))); return true;
    case 'deleteface': out.push(section_('Faces', ...pickNote('face'), h('p', { class: 'note' }, 'Deleting faces of a solid leaves an open surface body.'))); return true;
    case 'trim':
      out.push(section_('Trim', selField('Surface', f, 'body', surfs.length ? surfs : bodies), selField('Trim tool body', f, 'toolBody', [['', '— a plane —'], ...bodies.filter(([id]) => id !== f.body)], { rerender: true }),
        !f.toolBody ? selField('Plane', f, 'tool', planeOptions(idx, f.tool)) : null,
        segField('Keep', f, 'keep', [['positive', 'Front side'], ['negative', 'Back side']])));
      return true;
    case 'stitch': {
      const list = h('div', { class: 'picklist' });
      for (const [id, name] of bodies) {
        const c = h('input', { type: 'checkbox', id: 'st-' + id.replace(/[^a-z0-9]/gi, '_'), checked: (f.bodies || []).includes(id) });
        c.addEventListener('change', () => { checkpoint(); f.bodies = c.checked ? [...new Set([...(f.bodies || []), id])] : (f.bodies || []).filter(x => x !== id); scheduleRegen(0); });
        list.append(h('label', { class: 'chk', for: c.id }, c, name + (isSurfBody(id) ? '' : ' (solid)')));
      }
      out.push(section_('Stitch', h('div', { class: 'row' }, h('span', { class: 'rl' }, 'Bodies'), list), exField('Tolerance', f, 'tolerance', 'mm', { min: 0.000001 }), chkField('Make a solid when the result is closed', f, 'solid')));
      return true;
    }
    case 'unstitch': out.push(section_('Unstitch', selField('Body', f, 'body', bodies), h('p', { class: 'note' }, 'Every face becomes its own surface body.'))); return true;
    case 'reverse': out.push(section_('Reverse Normal', selField('Surface', f, 'body', surfs.length ? surfs : bodies))); return true;
  }
  return false;
}
