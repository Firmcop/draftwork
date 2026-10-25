// ===== DynamicDimensionInput: live sizes beside the cursor while drawing; type a value to set it =====
// Typing a digit jumps into the first field; Tab / Shift+Tab move between fields; the preview follows the typed
// values at once; Enter places the geometry with those values as real sketch dimensions; Esc returns to the mouse.
// Values are in document units (mm, cm, m, in, ft) or expressions with units; angles in degrees.
var hud = null, hudMouse = { x: 0, y: 0 };
// field: [key, label, kind]  kind: 'len' (document units) | 'ang' (degrees) | 'int'
const HUD_FIELDS = {
  line: [['len', 'Length', 'len'], ['ang', 'Angle', 'ang']],
  rect2: [['w', 'Width', 'len'], ['h', 'Height', 'len']],
  rectc: [['w', 'Width', 'len'], ['h', 'Height', 'len']],
  circle: [['d', 'Diameter', 'len']],
  polygon: [['d', 'Diameter', 'len'], ['n', 'Sides', 'int']],
  slot: [['len', 'Length', 'len'], ['w', 'Width', 'len']],
  arc1: [['len', 'Chord', 'len'], ['ang', 'Angle', 'ang']],
  arc2: [['r', 'Radius', 'len']],
};
function hudContext() {
  if (mode !== 'sketch') return null;
  if (gdraw?.kind === 'shape' && (gdraw.waiting || gdraw.e) && HUD_FIELDS[gdraw.tool]) return gdraw.tool;
  if (gdraw?.kind === 'arc' && gdraw.hover && (gdraw.pts.length === 1 || gdraw.pts.length === 2)) return 'arc' + gdraw.pts.length;
  if (sketchTool === 'line' && lineDraft) return 'line';
  return null;
}
const hudK = () => { const u = typeof docUnit === 'function' ? docUnit() : 'mm'; return UNIT_DEFS[u]?.[0] || 1; };
const hudU = () => (typeof docUnit === 'function' ? docUnit() : 'mm');
const hudKind = (tool, k) => HUD_FIELDS[tool].find(f => f[0] === k)[2];
// current values from the mouse position (mm and degrees)
function hudLiveValues(tool) {
  const sk = featById(sketchId); if (!sk) return null;
  const polar = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y; return { len: Math.hypot(dx, dy), ang: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 }; };
  if (tool === 'line') { const a = geoPos(sk, lineDraft.last); return polar(a, lineDraft.hover || a); }
  if (tool === 'arc1') return polar(gdraw.pts[0], gdraw.hover);
  if (tool === 'arc2') { const [a, b] = gdraw.pts, arc = arcFrom3(a, b, gdraw.hover); return { r: arc ? Math.hypot(a.x - arc.c.x, a.y - arc.c.y) : Math.hypot(b.x - a.x, b.y - a.y) / 2 }; }
  const s = gdraw.s, e = gdraw.e || s, dx = e.x - s.x, dy = e.y - s.y;
  if (tool === 'rect2') return { w: Math.abs(dx), h: Math.abs(dy) };
  if (tool === 'rectc') return { w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) };
  if (tool === 'circle') return { d: 2 * Math.hypot(dx, dy) };
  if (tool === 'polygon') return { d: 2 * Math.hypot(dx, dy), n: polySides };
  if (tool === 'slot') return { len: Math.hypot(dx, dy), w: hud?.vals?.w ?? 10 };
  return null;
}
function hudHide() { $('#skhud')?.remove(); hud = null; }
function hudShowVal(kind, v) { return kind === 'ang' ? fmt(Math.round(v * 10) / 10) : kind === 'int' ? String(Math.round(v)) : fmt(Math.round(v / hudK() * 1000) / 1000); }
function hudRender(tool) {
  let el = $('#skhud');
  if (!hud || hud.tool !== tool) {
    el?.remove();
    hud = { tool, editing: false, idx: 0 };
    el = h('div', { id: 'skhud', class: 'skhud', role: 'group', 'aria-label': 'Sketch input' });
    for (const [key, label, kind] of HUD_FIELDS[tool]) {
      const inp = h('input', { type: 'text', 'data-key': key, 'aria-label': label, autocomplete: 'off', spellcheck: 'false', inputmode: kind === 'int' ? 'numeric' : 'decimal', title: key === 'd' ? 'Diameter; add r for a radius (25r)' : label });
      inp.addEventListener('keydown', hudKey);
      inp.addEventListener('input', () => { inp.dataset.typed = '1'; hudPreview(); });
      inp.addEventListener('focus', () => { hud.editing = true; hud.idx = HUD_FIELDS[tool].findIndex(f => f[0] === key); });
      el.append(h('label', { class: 'skhud-f' }, h('span', {}, label), inp, h('span', { class: 'skhud-u' }, kind === 'ang' ? '°' : kind === 'int' ? '' : hudU())));
    }
    el.append(h('span', { class: 'skhud-tip' }, 'Tab next · Enter place · Esc mouse'));
    document.body.append(el);
  }
  el.style.left = (hudMouse.x + 22) + 'px'; el.style.top = (hudMouse.y + 18) + 'px';
  if (!hud.editing) {
    const v = hudLiveValues(tool); if (!v) return;
    el.querySelectorAll('input').forEach(inp => { const k = inp.dataset.key; inp.value = hudShowVal(hudKind(tool, k), v[k]); });
  }
}
function hudLive() { const t = hudContext(); if (!t) { if (hud && !hud.editing) hudHide(); return; } hudRender(t); }
// a typed value in mm / degrees / count; null when empty, NaN when not understood
function hudParse(s, kind, key) {
  s = String(s).trim(); if (!s) return null;
  // radius instead of diameter: r25, 25r, r 1.5in → twice the value
  const rm = key === 'd' && (s.match(/^r\s*(\d*\.?\d+(?:e[+-]?\d+)?\s*(?:mm|cm|m|in|ft)?)$/i) || s.match(/^(\d*\.?\d+(?:e[+-]?\d+)?\s*(?:mm|cm|m|in|ft)?)\s*r$/i));
  if (rm) { const r = hudParse(rm[1], kind); return Number.isNaN(r) ? r : 2 * r; }
  if (kind === 'int') return /^\d+$/.test(s) ? +s : NaN;
  if (/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return kind === 'ang' ? +s : +s * hudK();
  try { return evalExpr(s, params.vars); } catch (e) { return NaN; }
}
// all fields: typed values where given, live values elsewhere; err names the first bad field
function hudValues(tool) {
  const live = hudLiveValues(tool) || {}, vals = {}, typed = {};
  for (const inp of document.querySelectorAll('#skhud input')) {
    const k = inp.dataset.key, kind = hudKind(tool, k), wasTyped = inp.dataset.typed === '1';
    const v = wasTyped ? hudParse(inp.value, kind, k) : (live[k] ?? hudParse(inp.value, kind, k));
    if (v == null || Number.isNaN(v)) return { err: { inp, k } };
    vals[k] = v; typed[k] = wasTyped;
  }
  for (const k of ['len', 'w', 'h', 'd', 'r']) if (k in vals && !(vals[k] > 0)) return { err: { inp: document.querySelector(`#skhud input[data-key="${k}"]`), k, msg: 'Sizes must be greater than 0' } };
  if ('n' in vals && !(vals.n >= 3 && vals.n <= 64)) return { err: { inp: document.querySelector('#skhud input[data-key="n"]'), k: 'n', msg: 'A polygon needs 3 to 64 sides' } };
  return { vals, typed };
}
const r6 = x => Math.round(x * 1e6) / 1e6;
// the geometry the values describe: end point for a shape (and the dimensions to add), or the next arc / line point
function hudTarget(tool, vals) {
  const sk = featById(sketchId);
  if (tool === 'line') { const a = geoPos(sk, lineDraft.last), A = vals.ang * Math.PI / 180; return { p: { x: r6(a.x + vals.len * Math.cos(A)), y: r6(a.y + vals.len * Math.sin(A)) } }; }
  if (tool === 'arc1') { const a = gdraw.pts[0], A = vals.ang * Math.PI / 180; return { p: { x: r6(a.x + vals.len * Math.cos(A)), y: r6(a.y + vals.len * Math.sin(A)) } }; }
  if (tool === 'arc2') {
    // minor arc of radius r through both ends, bulging toward the cursor
    const [a, b] = gdraw.pts, c = Math.hypot(b.x - a.x, b.y - a.y), r = Math.max(vals.r, c / 2 + 1e-9), hh = Math.sqrt(Math.max(0, r * r - c * c / 4));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; let nx = -(b.y - a.y) / c, ny = (b.x - a.x) / c;
    const hv = gdraw.hover || { x: mx + nx, y: my + ny }; if ((hv.x - mx) * nx + (hv.y - my) * ny < 0) { nx = -nx; ny = -ny; }
    return { p: { x: mx + nx * (r - hh), y: my + ny * (r - hh) }, r };
  }
  const d = gdraw, s = d.s, cur = d.e || { x: s.x + 1, y: s.y + 1 }, sx = Math.sign(cur.x - s.x) || 1, sy = Math.sign(cur.y - s.y) || 1;
  const dir = (() => { const dx = cur.x - s.x, dy = cur.y - s.y, L = Math.hypot(dx, dy); return L > 1e-9 ? [dx / L, dy / L] : [1, 0]; })();
  if (tool === 'rect2' || tool === 'rectc') {
    const f = tool === 'rect2' ? 1 : 0.5;
    return { e: { x: r6(s.x + sx * vals.w * f), y: r6(s.y + sy * vals.h * f) }, dims: frag => { const ls = frag.curves.filter(c => c.kind === 'line' && !c.constr); frag.cons.push({ id: cid(), type: 'length', e: [ls[0].id], value: r6(vals.w) }, { id: cid(), type: 'length', e: [ls[1].id], value: r6(vals.h) }); } };
  }
  if (tool === 'circle') return { e: { x: r6(s.x + vals.d / 2), y: s.y }, dims: frag => { const c = frag.curves.find(c => c.kind === 'circle'); c.r = r6(vals.d / 2); frag.cons.push({ id: cid(), type: 'diameter', e: [c.id], value: r6(vals.d) }); } };
  if (tool === 'polygon') return { e: { x: r6(s.x + dir[0] * vals.d / 2), y: r6(s.y + dir[1] * vals.d / 2) }, sides: vals.n, dims: frag => { const c = frag.curves.find(c => c.kind === 'circle'); frag.cons.push({ id: cid(), type: 'diameter', e: [c.id], value: r6(vals.d) }); } };
  if (tool === 'slot') return { e: { x: r6(s.x + dir[0] * vals.len), y: r6(s.y + dir[1] * vals.len) }, dims: frag => { const arcs = frag.curves.filter(c => c.kind === 'arc'); frag.cons.push({ id: cid(), type: 'distance', e: [arcs[0].c, arcs[1].c], value: r6(vals.len) }, { id: cid(), type: 'radius', e: [arcs[0].id], value: r6(vals.w / 2) }); } };
  return null;
}
// preview follows typed values immediately
function hudPreview() {
  const tool = hud?.tool; if (!tool) return;
  const r = hudValues(tool);
  document.querySelectorAll('#skhud input').forEach(i => i.classList.remove('bad'));
  if (r.err) { if (r.err.inp?.dataset.typed === '1' && r.err.inp.value.trim()) r.err.inp.classList.add('bad'); return; }
  const t = hudTarget(tool, r.vals); if (!t) return;
  if (tool === 'line') { lineDraft.hover = { ...t.p, type: 'typed', refs: [] }; snapShow = null; }
  else if (tool === 'arc1' || tool === 'arc2') { gdraw.hover = { ...t.p, type: 'typed', refs: [] }; snapShow = null; }
  else { gdraw.e = { ...t.e, type: 'typed', refs: [] }; if (t.sides) polySides = t.sides; snapShow = null; }
  refreshOverlays();
}
function hudKey(e) {
  e.stopPropagation();
  const inputs = [...document.querySelectorAll('#skhud input')];
  if (e.key === 'Tab') { e.preventDefault(); const i = inputs.indexOf(e.target), j = (i + (e.shiftKey ? -1 : 1) + inputs.length) % inputs.length; inputs[j].focus(); inputs[j].select(); return; }
  if (e.key === 'Escape') { e.preventDefault(); hudHide(); viewport.focus?.(); return; }
  if (e.key === 'Enter') { e.preventDefault(); hudApply(); }
}
function hudApply() {
  const tool = hud?.tool, sk = featById(sketchId); if (!tool || !sk) return;
  const r = hudValues(tool);
  if (r.err) { const lab = HUD_FIELDS[tool].find(f => f[0] === r.err.k)?.[1] || 'Value'; toast(r.err.msg || `${lab} not understood: ${r.err.inp?.value ?? ''}`); r.err.inp?.classList.add('bad'); r.err.inp?.focus(); return; }
  const vals = r.vals, t = hudTarget(tool, vals);
  if (tool === 'line') {
    const g = cloneGeo(sk.geo), id = addPoint(g, t.p.x, t.p.y), lid = 'l' + uid();
    g.curves.push({ id: lid, kind: 'line', a: lineDraft.last, b: id });
    g.cons.push({ id: cid(), type: 'length', e: [lid], value: r6(vals.len) });
    const am = ((vals.ang % 180) + 180) % 180;
    if (Math.abs(am) < 1e-9) g.cons.push({ id: cid(), type: 'horizontal', e: [lid] }); else if (Math.abs(am - 90) < 1e-9) g.cons.push({ id: cid(), type: 'vertical', e: [lid] });
    else if (r.typed.ang) g.cons.push({ id: cid(), type: 'angle', e: [lid], value: r6(vals.ang) , ...(hudAngleRef(g, lid)) });
    if (!hudCommitLine(sk, g, lid)) return;
    lineDraft.last = id; lineDraft.hover = null;
    hudHide(); refreshOverlays(); defaultHint(); return;
  }
  if (tool === 'arc1') { gdraw.chord = vals.len; hudHide(); arcClick(sk, { ...t.p, exact: true }); refreshOverlays(); return; }
  if (tool === 'arc2') { gdraw.radius = t.r; hudHide(); arcClick(sk, { ...t.p, exact: true }); refreshOverlays(); return; }
  const d = gdraw; if (!d) return;
  d.e = t.e; if (t.sides) polySides = t.sides;
  window.removeEventListener('pointermove', onGeoMove);
  finishShape(d, t.dims); gdraw = null; viewport.classList.remove('moving');
  hudHide(); refreshOverlays(); defaultHint();
}
// a typed angle is measured from the sketch's x direction; it is kept as a dimension only if the solver supports it here
function hudAngleRef() { return {}; }
function hudCommitLine(sk, g, lid) {
  if (commitGeo(sk, g, { quiet: true })) return true;
  g.cons = g.cons.filter(k => !(k.type === 'angle' && k.e[0] === lid));   // fall back to length only
  return commitGeo(sk, g);
}
// typing a number while drawing jumps into the first value
window.addEventListener('keydown', e => {
  if (mode !== 'sketch' || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const t = hudContext(); if (!t) return;
  if (!/^[0-9.]$/.test(e.key)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  hudRender(t);
  const inp = document.querySelector('#skhud input'); if (!inp) return;
  hud.editing = true; inp.value = e.key; inp.dataset.typed = '1'; inp.focus(); inp.setSelectionRange(1, 1);
  hudPreview();
}, true);
window.addEventListener('pointermove', e => { hudMouse = { x: e.clientX, y: e.clientY }; if (mode === 'sketch' && !hud?.editing) requestAnimationFrame(hudLive); }, true);
window.addEventListener('pointerdown', e => { if (hud?.editing && !e.target.closest('#skhud')) hudHide(); }, true);
