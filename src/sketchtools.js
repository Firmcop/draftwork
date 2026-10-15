// ===== More sketch tools: Point, Text, Mirror, Circular Pattern, Project =====
let skOp = null;   // { kind: 'mirror' | 'cpattern', src: [curve ids] } while waiting for the second pick

function sketchHints2() {
  return {
    point: 'Click to place a point (snaps to existing points and curves)',
    text: 'Click where the text starts (bottom-left of the first letter)',
    mirror: skOp?.kind === 'mirror' ? 'Click the line to mirror about (a construction line works well)' : 'Select curves first',
    cpattern: skOp?.kind === 'cpattern' ? 'Click the centre point of the pattern' : 'Select curves first',
    project: 'Click edges of the model to project them into this sketch · Esc ends',
  };
}
function sketchTool2Click(sk, hit, e) {
  switch (sketchTool) {
    case 'point': return pointClick(sk, hit);
    case 'text': return textClick(sk, hit);
    case 'mirror': return mirrorClick(sk, hit);
    case 'cpattern': return cpatternClick(sk, hit);
    case 'project': return projectClick(sk, e);
  }
}
const SK_TOOLS2 = new Set(['point', 'text', 'mirror', 'cpattern', 'project']);

// ---------- point ----------
function pointClick(sk, hit) {
  const sp = snapPoint(sk, hit);
  if (sp.id) { toast('There is already a point there'); return; }
  const g = cloneGeo(sk.geo || emptyGeo()), id = addPoint(g, sp.x, sp.y);
  // a point dropped on a curve stays on it
  const gp = pickGeo(sk, hit);
  if (gp?.curve && gp.curve.kind !== 'spline') g.cons.push({ id: cid(), type: gp.curve.kind === 'line' ? 'onLine' : 'onCircle', e: [id, gp.curve.id] });
  if (!commitGeo(sk, g, { quiet: true })) { g.cons.pop(); commitGeo(sk, g); }
}

// ---------- text ----------
function textClick(sk, hit) {
  const sp = snapPoint(sk, hit);
  const snap = JSON.stringify(sk.texts || []);
  checkpoint();
  const t = { id: 't' + uid(), str: 'Text', x: Math.round(sp.x * 100) / 100, y: Math.round(sp.y * 100) / 100, h: 10, angle: 0, spacing: 0 };
  (sk.texts = sk.texts || []).push(t);
  openTextDialog(sk, t, snap, true);
  setSketchTool('select');
}
function openTextDialog(sk, t, snap = JSON.stringify(sk.texts || []), isNew = false) {
  const changed = () => { refreshOverlays(); scheduleRegen(120); };
  const strIn = h('input', { type: 'text', id: 'dx-text', value: t.str, spellcheck: 'false', autocomplete: 'off' });
  strIn.addEventListener('input', () => { checkpoint('text:' + t.id); t.str = strIn.value; changed(); });
  strIn.addEventListener('keydown', ev => ev.stopPropagation());
  openPanelDialog({
    title: isNew ? 'Text' : 'Edit Text', icon: 'text', okLabel: 'OK',
    help: 'Text becomes closed outlines in the sketch, ready to extrude, cut or emboss.',
    body: () => [
      section_('Text', row('Text', strIn, 'dx-text'), exField('Height', t, 'h', 'mm', { min: 0.1, after: changed }), exField('Angle', t, 'angle', '°', { after: changed }), exField('Letter spacing', t, 'spacing', '%', { after: changed })),
      section_('Position', exField('X', t, 'x', 'mm', { after: changed }), exField('Y', t, 'y', 'mm', { after: changed }),
        h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', onclick: () => { checkpoint(); sk.texts = sk.texts.filter(x => x !== t); closeDialog(true); scheduleRegen(0); } }, 'Delete text'))),
    ],
    onOK: () => { if (!String(t.str).trim()) sk.texts = (sk.texts || []).filter(x => x !== t); refreshOverlays(); renderPalette(); scheduleRegen(0); },
    onCancel: () => { sk.texts = JSON.parse(snap); refreshOverlays(); renderPalette(); scheduleRegen(0); },
  });
  renderPalette();
  setTimeout(() => { const el = document.getElementById('dx-text'); if (el) { el.focus(); el.select(); } }, 30);
}
function textAt(sk, hit) {
  for (const t of sk.texts || []) {
    const { polys } = textPolys(t), pts = polys.flat(); if (!pts.length) continue;
    const m = hit.tol, x0 = Math.min(...pts.map(p => p.x)) - m, x1 = Math.max(...pts.map(p => p.x)) + m, y0 = Math.min(...pts.map(p => p.y)) - m, y1 = Math.max(...pts.map(p => p.y)) + m;
    if (hit.x >= x0 && hit.x <= x1 && hit.y >= y0 && hit.y <= y1) return t;
  }
  return null;
}

// ---------- mirror ----------
function startSketchMirror() { startSkOp('mirror', 'Select the curves to mirror, then choose Sketch Mirror'); }
function startSketchCPattern() { startSkOp('cpattern', 'Select the curves to pattern, then choose Sketch Circular Pattern'); }
function startSkOp(kind, msg) {
  const sk = featById(sketchId); if (!sk?.geo) { toast(msg); return; }
  const src = [...geoSel].filter(id => sk.geo.curves.some(c => c.id === id));
  if (!src.length) { toast(msg); return; }
  setSketchTool(kind); skOp = { kind, src }; defaultHint();
}
function mirrorClick(sk, hit) {
  if (!skOp) return;
  const gp = pickGeo(sk, hit);
  if (gp?.curve?.kind !== 'line') { toast('Click a line to mirror about'); return; }
  const ml = gp.curve, A = geoPos(sk, ml.a), B = geoPos(sk, ml.b), ux = B.x - A.x, uy = B.y - A.y, L2 = ux * ux + uy * uy;
  if (L2 < 1e-12) return;
  const refl = p => { const t = ((p.x - A.x) * ux + (p.y - A.y) * uy) / L2, fx = A.x + ux * t, fy = A.y + uy * t; return { x: 2 * fx - p.x, y: 2 * fy - p.y, on: Math.hypot(p.x - fx, p.y - fy) < 1e-6 }; };
  const g = cloneGeo(sk.geo), map = new Map(), newIds = [];
  const mp = id => {
    if (map.has(id)) return map.get(id);
    const r = refl(geoPos(sk, id));
    let nid = id;
    if (!r.on) { nid = addPoint(g, r.x, r.y); g.cons.push({ id: cid(), type: 'symmetry', e: [id, nid, ml.id] }); }
    map.set(id, nid); return nid;
  };
  for (const id of skOp.src) {
    if (id === ml.id) continue;
    const c = sk.geo.curves.find(x => x.id === id); if (!c) continue;
    const n = { ...JSON.parse(JSON.stringify(c)), id: c.id[0] + uid() };
    if (c.kind === 'line') { n.a = mp(c.a); n.b = mp(c.b); }
    else if (c.kind === 'arc') { n.c = mp(c.c); n.a = mp(c.b); n.b = mp(c.a); g.cons.push({ id: cid(), type: 'equal', e: [c.id, n.id] }); }   // mirroring flips direction
    else if (c.kind === 'circle') { n.c = mp(c.c); n.r = geoRadius(sk, c); g.cons.push({ id: cid(), type: 'equal', e: [c.id, n.id] }); }
    else if (c.kind === 'spline') { n.pts = c.pts.map(mp); n.a = mp(c.a); n.b = mp(c.b); delete n.tan; }
    g.curves.push(n); newIds.push(n.id);
  }
  skOp = null;
  if (commitGeo(sk, g, { msg: 'Could not mirror without conflicting with the constraints' })) { geoSel = new Set(newIds); toast(`Mirrored ${newIds.length} curve${newIds.length === 1 ? '' : 's'}`); }
  setSketchTool('select');
}

// ---------- circular pattern ----------
function cpatternClick(sk, hit) {
  if (!skOp) return;
  const sp = snapPoint(sk, hit), src = skOp.src;
  const at = screenOf(sk, sp.x, sp.y);
  promptValue('Number of copies in the full circle (including the original)', 6, n => {
    n = Math.round(n);
    if (!(n >= 2 && n <= 360)) { toast('Use between 2 and 360'); return false; }
    const g = cloneGeo(sk.geo), cpId = sp.id || addPoint(g, sp.x, sp.y), C = sp.id ? geoPos(sk, sp.id) : sp, newIds = [];
    for (let k = 1; k < n; k++) {
      const a = k * 2 * Math.PI / n, ca = Math.cos(a), sa = Math.sin(a), map = new Map();
      const mp = id => {
        if (id === cpId) return id;
        if (map.has(id)) return map.get(id);
        const p = geoPos(sk, id), dx = p.x - C.x, dy = p.y - C.y;
        if (Math.hypot(dx, dy) < 1e-6) { map.set(id, id); return id; }
        const nid = addPoint(g, C.x + dx * ca - dy * sa, C.y + dx * sa + dy * ca); map.set(id, nid); return nid;
      };
      for (const id of src) {
        const c = sk.geo.curves.find(x => x.id === id); if (!c) continue;
        const nc = { ...JSON.parse(JSON.stringify(c)), id: c.id[0] + uid() };
        if (c.kind === 'line') { nc.a = mp(c.a); nc.b = mp(c.b); g.cons.push({ id: cid(), type: 'equal', e: [c.id, nc.id] }); }
        else if (c.kind === 'arc') { nc.c = mp(c.c); nc.a = mp(c.a); nc.b = mp(c.b); g.cons.push({ id: cid(), type: 'equal', e: [c.id, nc.id] }); }
        else if (c.kind === 'circle') { nc.c = mp(c.c); nc.r = geoRadius(sk, c); g.cons.push({ id: cid(), type: 'equal', e: [c.id, nc.id] }); }
        else if (c.kind === 'spline') { nc.pts = c.pts.map(mp); nc.a = mp(c.a); nc.b = mp(c.b); delete nc.tan; }
        g.curves.push(nc); newIds.push(nc.id);
      }
    }
    skOp = null;
    if (commitGeo(sk, g, { msg: 'Could not pattern without conflicting with the constraints' })) { geoSel = new Set(newIds); toast(`${n - 1} cop${n === 2 ? 'y' : 'ies'} added around the centre`); }
    setSketchTool('select');
  }, at);
}

// ---------- project model edges ----------
function projectClick(sk, e) {
  const hit = typeof brepEdgeHit === 'function' && isBrep() ? brepEdgeHit(e) : null;
  if (!hit) { toast(isBrep() ? 'Click an edge of the model' : 'Project needs the exact geometry engine'); return; }
  const s = shownBodies.get(hit.body), m = brepMeshOf(s.rec), pos = m.edgeGeom.attributes.position.array;
  const inv = sketchMatrix(sk).clone().invert(), W = s.edges.matrixWorld;
  const raw = [];
  for (let i = 0; i < m.segEdge.length; i++) if (m.segEdge[i] === hit.hash) {
    const a = new THREE.Vector3(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]).applyMatrix4(W).applyMatrix4(inv);
    const b = new THREE.Vector3(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5]).applyMatrix4(W).applyMatrix4(inv);
    raw.push([[a.x, a.y], [b.x, b.y]]);
  }
  const pts = chainSegs(raw); if (pts.length < 2) return;
  const g = cloneGeo(sk.geo || emptyGeo()), fixP = (x, y) => { const sn = nearestPoint(sk, x, y, 1e-4); if (sn) return sn.id; const id = addPoint(g, x, y); g.cons.push({ id: cid(), type: 'fix', e: [id], x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6, proj: true }); return id; };
  const closed = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-5;
  const fit = circleFit(closed ? pts.slice(0, -1) : pts), span = Math.hypot(pts.at(-1)[0] - pts[0][0], pts.at(-1)[1] - pts[0][1]);
  const straight = !closed && pts.every(p => distToSeg(p, pts[0], pts.at(-1)) < 1e-4 * Math.max(1, span));
  let id;
  if (straight) { id = 'l' + uid(); g.curves.push({ id, kind: 'line', a: fixP(...pts[0]), b: fixP(...pts.at(-1)), proj: true }); }
  else if (fit && pts.every(p => Math.abs(Math.hypot(p[0] - fit.x, p[1] - fit.y) - fit.r) < 1e-3 * Math.max(1, fit.r))) {
    if (closed) { id = 'c' + uid(); g.curves.push({ id, kind: 'circle', c: fixP(fit.x, fit.y), r: Math.round(fit.r * 1e6) / 1e6, proj: true }); g.cons.push({ id: cid(), type: 'radius', e: [id], value: Math.round(fit.r * 1e6) / 1e6, proj: true }); }
    else {
      // arcs run counter-clockwise a -> b
      const c = [fit.x, fit.y], cr = (p, q) => (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0]);
      const ccw = cr(pts[0], pts[1]) > 0, s0 = ccw ? pts[0] : pts.at(-1), s1 = ccw ? pts.at(-1) : pts[0];
      id = 'a' + uid(); g.curves.push({ id, kind: 'arc', c: fixP(fit.x, fit.y), a: fixP(...s0), b: fixP(...s1), proj: true });
    }
  } else {
    const n = Math.min(pts.length, 14), samp = Array.from({ length: n }, (_, i) => pts[Math.round(i * (pts.length - 1) / (n - 1))]);
    const ids = samp.map(p => fixP(...p)); if (closed) ids[ids.length - 1] = ids[0];
    id = 's' + uid(); g.curves.push({ id, kind: 'spline', pts: ids, a: ids[0], b: ids.at(-1), proj: true });
  }
  if (commitGeo(sk, g, { force: true })) toast('Edge projected (fixed in place)');
}
function chainSegs(segs) {
  if (!segs.length) return [];
  const k = p => p[0].toFixed(5) + ',' + p[1].toFixed(5), left = segs.slice(1), out = [...segs[0]];
  let grew = true;
  while (left.length && grew) {
    grew = false;
    for (let i = 0; i < left.length; i++) {
      const [a, b] = left[i], h0 = k(out[0]), t0 = k(out.at(-1));
      if (k(a) === t0) out.push(b); else if (k(b) === t0) out.push(a); else if (k(b) === h0) out.unshift(a); else if (k(a) === h0) out.unshift(b); else continue;
      left.splice(i, 1); grew = true; break;
    }
  }
  return out.filter((p, i) => !i || k(p) !== k(out[i - 1]) || i === out.length - 1);
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
// circle through the first, middle and last points
function circleFit(pts) {
  if (pts.length < 3) return null;
  const r = arcFrom3({ x: pts[0][0], y: pts[0][1] }, { x: pts.at(-1)[0], y: pts.at(-1)[1] }, { x: pts[pts.length >> 1][0], y: pts[pts.length >> 1][1] });
  if (!r) return null;
  return { x: r.c.x, y: r.c.y, r: Math.hypot(pts[0][0] - r.c.x, pts[0][1] - r.c.y) };
}
