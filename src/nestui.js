// ===== Nest dialog: bodies' flat outlines (sheet-metal flat patterns or top-view footprints) packed onto sheets =====
let nestLast = null;
async function partOutline(id) {
  if (result.sheets?.has(id)) {   // sheet metal: the exact flat pattern
    try { const fd = await brepFlat(id); if (fd?.polys?.length) return { loops: fd.polys, source: 'flat pattern' }; } catch (e) { /* fall back to the footprint */ }
  }
  const b = result.bodies.get(id), g = b.shape ? brepGeomNI(b) : b.geom; if (!g) return null;
  const p = g.attributes.position.array, M = bodyXf(id), v = new THREE.Vector3(), t = new Float32Array(p.length);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(M); t[i] = v.x; t[i + 1] = v.y; t[i + 2] = v.z; lo = [Math.min(lo[0], v.x), Math.min(lo[1], v.y)]; hi = [Math.max(hi[0], v.x), Math.max(hi[1], v.y)]; }
  const res = Math.max(0.2, Math.sqrt((hi[0] - lo[0]) * (hi[1] - lo[1]) / 3e5)), G = rasterize(makeGrid(lo[0] - 2 * res, lo[1] - 2 * res, hi[0] + 2 * res, hi[1] + 2 * res, res), t);
  const F = new Float32Array(G.nx * G.ny); for (let k = 0; k < F.length; k++) F[k] = G.H[k] > -Infinity ? 1 : -1;
  const loops = contours(F, G, 0).map(L => simplify(L, res * 0.4)).filter(L => L.length >= 3 && Math.abs(loopArea(L)) > res * res * 4);
  return loops.length ? { loops, source: 'top view' } : null;
}
async function openNest() {
  const ids = [...result.bodies.keys()].filter(id => !bodyHidden(id) && !isSurfBody(id));
  if (!ids.length) { toast('There are no bodies to nest'); return; }
  const st = doc.nest || (doc.nest = { width: 1000, height: 500, gap: 3, rotate: true, qty: {} });
  $('#busy').hidden = false; await new Promise(r => setTimeout(r, 20));
  const outl = new Map(); try { for (const id of ids) { const o = await partOutline(id); if (o) outl.set(id, o); } } finally { $('#busy').hidden = true; }
  const rows = [...outl].map(([id, o]) => {
    const q = h('input', { type: 'number', min: 0, value: st.qty[id] ?? 1, style: 'width:64px', 'aria-label': 'Quantity of ' + bodyName(id), id: 'nq-' + id.replace(/\W/g, '_') });
    q.addEventListener('change', () => { st.qty[id] = Math.max(0, Math.round(+q.value || 0)); });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const L of o.loops) for (const p of L) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return h('tr', {}, h('td', {}, bodyName(id)), h('td', {}, o.source), h('td', { class: 'num' }, `${fmt(x1 - x0)} × ${fmt(y1 - y0)}`), h('td', {}, q));
  });
  const num = (label, key, unit) => { const i = h('input', { type: 'number', value: st[key], id: 'ns-' + key, style: 'width:80px' }); i.addEventListener('change', () => { st[key] = +i.value; }); return h('label', { class: 'chk', for: 'ns-' + key, style: 'margin-right:12px' }, label + ' ', i, ' ' + unit); };
  const rot = h('input', { type: 'checkbox', id: 'ns-rot', checked: st.rotate }); rot.addEventListener('change', () => { st.rotate = rot.checked; });
  const out = h('div', { id: 'nest-out' });
  const run = () => {
    const parts = [...outl].map(([id, o]) => ({ id, name: bodyName(id), loops: o.loops, qty: st.qty[id] ?? 1 })).filter(p => p.qty > 0);
    if (!parts.length) { toast('Set a quantity for at least one part'); return; }
    let n;
    try { n = nestParts(parts, { width: st.width, height: st.height, gap: st.gap, res: Math.max(0.5, Math.sqrt(st.width * st.height / 3e5)), rotations: st.rotate ? [0, 90, 180, 270] : [0] }); }
    catch (e) { toast('Nesting failed: ' + e.message); return; }
    nestLast = n; persist();
    const svgs = n.sheets.map((s, k) => {
      const W = n.width, H = n.height, cols = ['#9fc3f0', '#f3c58f', '#a9dba0', '#e7a6c6', '#c8b8f0', '#f0e08f'];
      const parts2 = s.placed.map((p, i) => `<path d="${p.loops.map(L => 'M' + L.map(q => `${q[0].toFixed(2)} ${(H - q[1]).toFixed(2)}`).join('L') + 'Z').join('')}" fill="${cols[[...outl.keys()].indexOf(p.id) % cols.length]}" fill-rule="evenodd" stroke="#333" stroke-width="${Math.max(W, H) / 600}"><title>${p.name}</title></path>`).join('');
      return `<div class="nestsheet"><div class="note">Sheet ${k + 1} · ${s.placed.length} parts · ${Math.round(s.utilisation * 100)}% used</div><svg viewBox="-2 -2 ${W + 4} ${H + 4}" width="100%" role="img" aria-label="Sheet ${k + 1} layout"><rect x="0" y="0" width="${W}" height="${H}" fill="#fafafa" stroke="#888" stroke-width="${Math.max(W, H) / 400}"/>${parts2}</svg></div>`;
    });
    out.innerHTML = svgs.join('') + (n.unplaced.length ? `<p class="note bad">Did not fit: ${n.unplaced.join(', ')}</p>` : '');
  };
  openModal('Nest', 'nest', h('div', { class: 'tablewrap' },
    h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, ...['Part', 'Outline', 'Size (mm)', 'Qty'].map(t => h('th', {}, t)))), h('tbody', {}, rows)),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px;margin:8px 0' }, num('Sheet', 'width', '×'), num('', 'height', 'mm'), num('Gap', 'gap', 'mm'), h('label', { class: 'chk', for: 'ns-rot' }, rot, 'Allow 90° rotations')),
    h('button', { class: 'btn', id: 'nest-run', onclick: run }, 'Nest'), out,
    h('p', { class: 'note' }, 'Sheet-metal bodies use their flat pattern; other bodies use their outline seen from above. Parts can sit inside the holes of others.')),
    [h('button', { class: 'btn ok', onclick: () => { if (!nestLast) { toast('Press Nest first'); return; } saveFile(slug() + '-nest.zip', makeZip([{ name: slug() + '-nest.dxf', data: nestDXF(nestLast) }]), 'application/zip'); } }, 'Export DXF (.zip)'),
      h('button', { class: 'btn', onclick: closeModal }, 'Close')]);
}
cmd('nest', 'Nest', 'nest', { run: () => openNest() });
