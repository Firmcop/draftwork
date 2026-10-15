// ===== Sheet Metal workspace: rules (as user parameters), flange, contour flange, unfold/refold, flat pattern + DXF =====
const SM_PARAMS = [['sm_thickness', '1.5', 'Sheet metal thickness'], ['sm_bend_radius', '1.5', 'Sheet metal inner bend radius'], ['sm_kfactor', '0.44', 'Sheet metal K-factor (neutral axis position)']];
function ensureSheetParams() {
  let added = false;
  for (const [name, expr, comment] of SM_PARAMS) if (!doc.params.some(p => p.name === name)) { doc.params.push({ name, expr, comment }); added = true; }
  if (added) params = evalParams(doc.params);
}
const sheetBodies = () => [...(result.sheets || new Map()).keys()].filter(id => result.bodies.has(id));
function newSheet(type) {
  if (!needExact(TYPE[type].label)) return;
  const end = insertIndex(), sel = selFeature && featById(selFeature);
  const snap = JSON.stringify(doc); checkpoint();
  ensureSheetParams();
  const rules = { thickness: 'sm_thickness', bendRadius: 'sm_bend_radius', kFactor: 'sm_kfactor' };
  let f;
  if (type === 'flange') {
    const sks = sketchesAt(end, g => profCount(g) > 0);
    const useEdges = sheetBodies().length && !(sel && sks.includes(sel));
    f = { ...rules, sketch: useEdges ? null : ((sks.includes(sel) ? sel : sks.at(-1))?.id || null), edges: [], height: 10, angle: 90, flip: false };
    if (!useEdges && !f.sketch) { history.undo.pop(); toast('Sketch a closed profile for the base flange, or make one first and then click its edges'); return; }
  } else if (type === 'contourflange') {
    const sks = sketchesAt(end, g => sketchPathCount(g) > 0);
    if (!sks.length) { history.undo.pop(); toast('Sketch an open chain of lines for the contour flange'); return; }
    f = { ...rules, sketch: (sks.includes(sel) ? sel : sks.at(-1)).id, width: 20, side: 'left', direction: 'one' };
  } else {
    const ids = sheetBodies();
    if (!ids.length) { history.undo.pop(); toast('There is no sheet metal body yet. Start with Flange or Contour Flange.'); return; }
    f = { body: selBody && ids.includes(selBody) ? selBody : ids.at(-1) };
  }
  f = { id: uid(), type, name: nextName(type), ...f };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  if (type === 'flange' && !f.sketch) toast('Click straight edges of the sheet to add flanges');
}
function sheetDialog(f, idx, out) {
  const sks = doc.features.slice(0, idx).filter(g => g.type === 'sketch').map(s => [s.id, s.name]);
  const rules = () => section_('Rules', exField('Thickness', f, 'thickness'), exField('Bend radius', f, 'bendRadius'), exField('K-factor', f, 'kFactor', '', { min: 0, max: 1, step: 0.01 }),
    h('p', { class: 'note' }, 'Defaults come from the sheet metal rules (sm_thickness, sm_bend_radius, sm_kfactor in User Parameters).'));
  switch (f.type) {
    case 'flange': {
      const n = (f.edges || []).length;
      if (n || !f.sketch) {
        out.push(section_('Edges', h('p', { class: 'note' }, n ? `${n} edge${n > 1 ? 's' : ''} selected. Click on the model to add or remove edges.` : 'Click straight edges of a sheet metal body. The flange bends toward the face you click the edge on.'),
          h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', disabled: !n, onclick: () => { checkpoint(); f.edges = []; rerenderDialog(); scheduleRegen(0); drawToolsOverlay(); } }, 'Clear selection'))),
          section_('Flange', exField('Height', f, 'height', 'mm', { min: 0 }), exField('Angle', f, 'angle', '°', { min: 1, max: 180 }), exField('Bend radius', f, 'bendRadius'), chkField('Bend the other way', f, 'flip'),
            h('p', { class: 'note' }, 'Height is the straight length after the bend.')));
        if (!n) out.push(section_('Or a base flange', selField('Sketch', f, 'sketch', [['', '— none —'], ...sks], { rerender: true })));
      } else {
        out.push(section_('Base flange', selField('Profile sketch', f, 'sketch', [['', '— pick edges instead —'], ...sks], { rerender: true }), chkField('Flip side', f, 'flip')), rules());
      }
      return true;
    }
    case 'contourflange':
      out.push(section_('Profile', selField('Sketch', f, 'sketch', sks), segField('Thickness side', f, 'side', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]),
        h('p', { class: 'note' }, 'An open chain of lines; each corner becomes a bend with the bend radius.')),
        section_('Width', exField('Distance', f, 'width', 'mm', { min: 0.01 }), segField('Direction', f, 'direction', [['one', 'One side'], ['symmetric', 'Symmetric'], ['reverse', 'Flipped']])), rules());
      return true;
    case 'unfold': case 'refold':
      out.push(section_(f.type === 'unfold' ? 'Unfold' : 'Refold', selField('Sheet body', f, 'body', sheetBodies().map(id => [id, bodyName(id)])),
        h('p', { class: 'note' }, f.type === 'unfold' ? 'Lays the body flat in the plane of its first flange. Refold puts it back.' : 'Folds an unfolded body back.')));
      return true;
  }
  return false;
}
function openSheetRules() {
  const snap = JSON.stringify(doc.params);
  ensureSheetParams();
  const work = SM_PARAMS.map(([name, , label]) => { const p = doc.params.find(q => q.name === name); return { p, label, inp: h('input', { type: 'text', value: p.expr, spellcheck: 'false', 'aria-label': label, id: 'sm-' + name }) }; });
  const body = h('div', { class: 'tablewrap' }, h('p', { class: 'note' }, 'These are user parameters, so you can also use them in any dimension. Flanges made with the defaults update when you change them here.'),
    ...work.map(w => h('div', { class: 'row' }, h('label', { class: 'rl', for: w.inp.id }, w.label.replace('Sheet metal ', '')), w.inp)));
  openModal('Sheet Metal Rules', 'sheetrules', body, [
    h('button', { class: 'btn ok', onclick: () => { checkpoint(); work.forEach(w => { w.p.expr = w.inp.value.trim() || w.p.expr; }); params = evalParams(doc.params); closeModal(); scheduleRegen(0); renderBrowser(); } }, 'OK'),
    h('button', { class: 'btn', onclick: () => { doc.params = JSON.parse(snap); params = evalParams(doc.params); closeModal(); } }, 'Cancel')]);
}
// ---- flat pattern viewer + DXF ----
function dxfOf(fd, name) {
  const L = [];
  const p = (...a) => L.push(...a.map(String));
  p(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC');
  p(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 2,
    0, 'LAYER', 2, 'OUTLINE', 70, 0, 62, 7, 6, 'CONTINUOUS', 0, 'LAYER', 2, 'BEND', 70, 0, 62, 1, 6, 'CONTINUOUS', 0, 'ENDTAB', 0, 'ENDSEC');
  p(0, 'SECTION', 2, 'ENTITIES');
  const line = (a, b, layer) => p(0, 'LINE', 8, layer, 10, a[0].toFixed(6), 20, a[1].toFixed(6), 30, 0, 11, b[0].toFixed(6), 21, b[1].toFixed(6), 31, 0);
  for (const pl of fd.polys) for (let i = 1; i < pl.length; i++) line(pl[i - 1], pl[i], 'OUTLINE');
  for (const b of fd.bends) line([b[0], b[1]], [b[2], b[3]], 'BEND');
  p(0, 'ENDSEC', 0, 'EOF');
  void name;
  return L.join('\n') + '\n';
}
function flatSVG(fd, W = 640, H = 380) {
  const pad = 20, s = Math.min((W - 2 * pad) / (fd.size[0] || 1), (H - 2 * pad) / (fd.size[1] || 1));
  const X = x => pad + (x - fd.lo[0]) * s, Y = y => H - pad - (y - fd.lo[1]) * s;
  const paths = fd.polys.map(pl => `<path d="${pl.map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(2) + ' ' + Y(q[1]).toFixed(2)).join('')}" fill="var(--panel2, rgba(120,140,160,.12))" stroke="var(--fg, #333)" stroke-width="1.2" fill-rule="evenodd"/>`).join('');
  const bends = fd.bends.map(b => `<line x1="${X(b[0]).toFixed(2)}" y1="${Y(b[1]).toFixed(2)}" x2="${X(b[2]).toFixed(2)}" y2="${Y(b[3]).toFixed(2)}" stroke="#d9534a" stroke-width="1" stroke-dasharray="6 4"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Flat pattern">${paths}${bends}</svg>`;
}
async function openFlatPattern() {
  if (!needExact('Flat pattern')) return;
  const ids = sheetBodies();
  if (!ids.length) { toast('There is no sheet metal body yet. Start with Flange or Contour Flange.'); return; }
  const id = selBody && ids.includes(selBody) ? selBody : ids.at(-1);
  let fd; try { fd = await brepFlat(id); } catch (e) { toast('Could not compute the flat pattern: ' + e.message); return; }
  if (!fd) { toast('No flat pattern for that body'); return; }
  lastFlat = { id, fd };
  const box = h('div', { class: 'flatview', html: flatSVG(fd) });
  const body = h('div', { class: 'tablewrap' }, box,
    h('dl', { class: 'stat' }, ...[['Body', bodyName(id)], ['Flat size', `${fmt(fd.size[0])} × ${fmt(fd.size[1])} mm`], ['Thickness', fmt(fd.t) + ' mm'], ['Bend radius', fmt(fd.R) + ' mm'], ['K-factor', fmt(fd.k)], ['Bends', String(fd.bends.length / 2)]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('p', { class: 'note' }, 'Dashed red lines are the bend zone edges. Holes cut after the flanges are not included in the flat pattern yet.'));
  openModal('Flat Pattern', 'unfold', body, [
    h('button', { class: 'btn', onclick: () => { const n = slug() + '-' + bodyName(id).replace(/\W+/g, '_') + '-flat'; saveFile(n + '.zip', makeZip([{ name: n + '.dxf', data: dxfOf(fd, n) }, { name: n + '.svg', data: flatSVG(fd).replace(/var\(--[^,]+, ([^)]+)\)/g, '$1') }]), 'application/zip'); }, html: icon('exportstl') + 'Export DXF' }),
    h('button', { class: 'btn ok', onclick: closeModal }, 'Close')]);
}
let lastFlat = null;
