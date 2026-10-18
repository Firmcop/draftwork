// ===== Heads-up sketch input: live size readout while drawing; type a value to set it (Tab moves, Enter places) =====
var hud = null, hudMouse = { x: 0, y: 0 };
const HUD_FIELDS = {
  line: [['len', 'Length', 'len'], ['ang', 'Angle', 'ang']],
  rect2: [['w', 'Width', 'len'], ['h', 'Height', 'len']],
  rectc: [['w', 'Width', 'len'], ['h', 'Height', 'len']],
  circle: [['d', 'Diameter', 'len']],
  polygon: [['d', 'Diameter', 'len']],
  slot: [['len', 'Length', 'len'], ['w', 'Width', 'len']],
};
function hudContext() {
  if (mode !== 'sketch') return null;
  if (gdraw?.kind === 'shape' && (gdraw.waiting || gdraw.e) && HUD_FIELDS[gdraw.tool]) return gdraw.tool;
  if (sketchTool === 'line' && lineDraft) return 'line';
  return null;
}
const hudK = () => { const u = typeof docUnit === 'function' ? docUnit() : 'mm'; return UNIT_DEFS[u]?.[0] || 1; };
const hudU = () => (typeof docUnit === 'function' ? docUnit() : 'mm');
// current values from the mouse position (mm and degrees)
function hudLiveValues(tool) {
  const sk = featById(sketchId); if (!sk) return null;
  if (tool === 'line') {
    const a = geoPos(sk, lineDraft.last), b = lineDraft.hover || a, dx = b.x - a.x, dy = b.y - a.y;
    return { len: Math.hypot(dx, dy), ang: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 };
  }
  const s = gdraw.s, e = gdraw.e || s, dx = e.x - s.x, dy = e.y - s.y;
  if (tool === 'rect2') return { w: Math.abs(dx), h: Math.abs(dy) };
  if (tool === 'rectc') return { w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) };
  if (tool === 'circle' || tool === 'polygon') return { d: 2 * Math.hypot(dx, dy) };
  if (tool === 'slot') return { len: Math.hypot(dx, dy), w: hud?.vals?.w ?? 10 };
  return null;
}
function hudHide() { $('#skhud')?.remove(); hud = null; }
function hudRender(tool) {
  let el = $('#skhud');
  if (!hud || hud.tool !== tool) {
    el?.remove();
    hud = { tool, editing: false, idx: 0 };
    el = h('div', { id: 'skhud', class: 'skhud', role: 'group', 'aria-label': 'Sketch input' });
    for (const [key, label, kind] of HUD_FIELDS[tool]) {
      const inp = h('input', { type: 'text', 'data-key': key, 'aria-label': label, autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal' });
      inp.addEventListener('keydown', hudKey); inp.addEventListener('focus', () => { hud.editing = true; hud.idx = HUD_FIELDS[tool].findIndex(f => f[0] === key); });
      el.append(h('label', { class: 'skhud-f' }, h('span', {}, label), inp, h('span', { class: 'skhud-u' }, kind === 'ang' ? '°' : hudU())));
    }
    document.body.append(el);
  }
  el.style.left = (hudMouse.x + 22) + 'px'; el.style.top = (hudMouse.y + 18) + 'px';
  if (!hud.editing) {
    const v = hudLiveValues(tool); if (!v) return;
    el.querySelectorAll('input').forEach(inp => { const k = inp.dataset.key, kind = HUD_FIELDS[tool].find(f => f[0] === k)[2]; inp.value = kind === 'ang' ? fmt(Math.round(v[k] * 10) / 10) : fmt(Math.round(v[k] / hudK() * 1000) / 1000); });
  }
}
function hudLive() { const t = hudContext(); if (!t) { if (hud && !hud.editing) hudHide(); return; } hudRender(t); }
function hudParse(s, kind) {
  s = String(s).trim(); if (!s) return null;
  if (/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return kind === 'ang' ? +s : +s * hudK();
  try { return evalExpr(s, params.vars); } catch (e) { return NaN; }
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
  const live = hudLiveValues(tool) || {}, vals = {}, typed = {};
  for (const inp of document.querySelectorAll('#skhud input')) {
    const k = inp.dataset.key, kind = HUD_FIELDS[tool].find(f => f[0] === k)[2], v = hudParse(inp.value, kind);
    if (v == null || Number.isNaN(v)) { toast(`${k === 'ang' ? 'Angle' : 'Value'} not understood: ${inp.value}`); inp.focus(); return; }
    vals[k] = v; typed[k] = inp.dataset.typed === '1';
  }
  for (const k of ['len', 'w', 'h', 'd']) if (k in vals && !(vals[k] > 0)) { toast('Sizes must be greater than 0'); return; }
  const r2 = x => Math.round(x * 1e6) / 1e6;
  if (tool === 'line') {
    const g = cloneGeo(sk.geo), a = geoPos(sk, lineDraft.last), A = vals.ang * Math.PI / 180;
    const id = addPoint(g, r2(a.x + vals.len * Math.cos(A)), r2(a.y + vals.len * Math.sin(A))), lid = 'l' + uid();
    g.curves.push({ id: lid, kind: 'line', a: lineDraft.last, b: id });
    g.cons.push({ id: cid(), type: 'length', e: [lid], value: r2(vals.len) });
    const am = ((vals.ang % 180) + 180) % 180;
    if (Math.abs(am) < 1e-9) g.cons.push({ id: cid(), type: 'horizontal', e: [lid] }); else if (Math.abs(am - 90) < 1e-9) g.cons.push({ id: cid(), type: 'vertical', e: [lid] });
    if (commitGeo(sk, g)) lineDraft.last = id;
    hudHide(); refreshOverlays(); defaultHint(); return;
  }
  const d = gdraw; if (!d) return;
  const s = d.s, cur = d.e || { x: s.x + 1, y: s.y + 1 }, sx = Math.sign(cur.x - s.x) || 1, sy = Math.sign(cur.y - s.y) || 1;
  const dir = (() => { const dx = cur.x - s.x, dy = cur.y - s.y, L = Math.hypot(dx, dy); return L > 1e-9 ? [dx / L, dy / L] : [1, 0]; })();
  let dims;
  if (tool === 'rect2' || tool === 'rectc') {
    const f = tool === 'rect2' ? 1 : 0.5;
    d.e = { x: r2(s.x + sx * vals.w * f), y: r2(s.y + sy * vals.h * f) };
    dims = frag => { const ls = frag.curves.filter(c => c.kind === 'line' && !c.constr); frag.cons.push({ id: cid(), type: 'length', e: [ls[0].id], value: r2(vals.w) }, { id: cid(), type: 'length', e: [ls[1].id], value: r2(vals.h) }); };
  } else if (tool === 'circle') {
    d.e = { x: r2(s.x + vals.d / 2), y: s.y };
    dims = frag => { const c = frag.curves.find(c => c.kind === 'circle'); c.r = r2(vals.d / 2); frag.cons.push({ id: cid(), type: 'diameter', e: [c.id], value: r2(vals.d) }); };
  } else if (tool === 'polygon') {
    d.e = { x: r2(s.x + dir[0] * vals.d / 2), y: r2(s.y + dir[1] * vals.d / 2) };
    dims = frag => { const c = frag.curves.find(c => c.kind === 'circle'); frag.cons.push({ id: cid(), type: 'diameter', e: [c.id], value: r2(vals.d) }); };
  } else if (tool === 'slot') {
    d.e = { x: r2(s.x + dir[0] * vals.len), y: r2(s.y + dir[1] * vals.len) };
    dims = frag => { const arcs = frag.curves.filter(c => c.kind === 'arc'); frag.cons.push({ id: cid(), type: 'distance', e: [arcs[0].c, arcs[1].c], value: r2(vals.len) }, { id: cid(), type: 'radius', e: [arcs[0].id], value: r2(vals.w / 2) }); };
  }
  window.removeEventListener('pointermove', onGeoMove);
  finishShape(d, dims); gdraw = null; viewport.classList.remove('moving');
  hudHide(); refreshOverlays(); defaultHint();
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
}, true);
window.addEventListener('pointermove', e => { hudMouse = { x: e.clientX, y: e.clientY }; if (mode === 'sketch' && !hud?.editing) requestAnimationFrame(hudLive); }, true);
window.addEventListener('pointerdown', e => { if (hud?.editing && !e.target.closest('#skhud')) hudHide(); }, true);
