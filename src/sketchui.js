// ===== Constrained sketch editing: drawing tools, selection, dragging, constraints, dimensions =====
// lineDraft (core) = { start, last, hover } while drawing a line chain; gdraw = in-progress drag/arc/shape.
let geoSel = new Set(), geoHover = null, gdraw = null, geoCache = null;

function geoOf(sk) { if (!sk.geo) sk.geo = emptyGeo(); return sk.geo; }
const cloneGeo = g => JSON.parse(JSON.stringify(g || emptyGeo()));
function resolvedGeo(geo) { try { return resolveFeatures([{ id: 'g', type: 'sketch', geo }], params.vars)[0].geo; } catch (e) { return geo; } }
// Solved positions, degrees of freedom and loops for display (cached until the geometry or parameters change).
function geoState(sk) {
  if (!sk?.geo || (!sk.geo.points.length && !sk.geo.curves.length)) return null;
  const key = sk.id + JSON.stringify(sk.geo) + JSON.stringify(params.vars);
  if (geoCache?.key === key) return geoCache;
  const rg = resolvedGeo(sk.geo);
  let solved = null, analysis = { dof: 0, free: new Set() }, loops = { profiles: [], info: { open: 0, branching: 0 } };
  try { solved = solveSketch(rg); analysis = analyzeSketch(rg, solved); loops = geoProfiles(rg, solved); } catch (e) { console.warn(e); }
  return (geoCache = { key, rg, solved, analysis, loops });
}
function profCount(sk) {
  if (!sk || sk.type !== 'sketch') return 0;
  const st = geoState(sk);
  return (sk.profiles?.length || 0) + (st?.loops.profiles.length || 0);
}
// Re-solves `g` (optionally with dragged ids held near their new spots) and stores it. Returns false on conflict.
function commitGeo(sk, g, o = {}) {
  const rg = resolvedGeo(g);
  let s; try { s = solveSketch(rg, { drag: o.drag || null }); } catch (e) { s = { ok: false }; }
  if (!s.ok && !o.force) { if (!o.quiet) toast(o.msg || 'That conflicts with the existing constraints'); return false; }
  if (o.mustReduce) {
    // a new constraint must take away freedom; otherwise it duplicates what other constraints already decide
    const before = geoState(sk)?.analysis.dof ?? Infinity, after = analyzeSketch(rg, s).dof;
    if (after >= before) { toast(o.redundantMsg || 'That is already decided by other constraints, so it was not added'); return false; }
  }
  if (!o.noCheckpoint) checkpoint(o.tag || null);
  sk.geo = s.ok ? applySolved(g, s) : g;
  geoCache = null;
  refreshOverlays();
  if (!o.noRegen) scheduleRegen(o.delay ?? 80);
  if (!o.noPalette) renderPalette();
  return true;
}
const snapV = v => sketchOpts.snap ? Math.round(v) : Math.round(v * 100) / 100;
function geoPos(sk, id) {
  if (id === 'O') return { x: 0, y: 0 };
  const st = geoState(sk), p = st?.solved?.points.get(id);
  return p || sk.geo.points.find(q => q.id === id) || { x: 0, y: 0 };
}
function geoRadius(sk, c) {
  const st = geoState(sk);
  if (c.kind === 'circle') return st?.solved?.radii.get(c.id) ?? Math.abs(+c.r || 0);
  const cc = geoPos(sk, c.c), a = geoPos(sk, c.a); return Math.hypot(a.x - cc.x, a.y - cc.y);
}
// nearest existing point (including the origin) within tol
function nearestPoint(sk, x, y, tol, exclude) {
  let best = null, bd = tol;
  const cands = [{ id: 'O', x: 0, y: 0 }, ...(sk.geo?.points || []).map(p => ({ id: p.id, ...geoPos(sk, p.id) }))];
  for (const p of cands) { if (exclude?.has(p.id)) continue; const d = Math.hypot(p.x - x, p.y - y); if (d <= bd) { bd = d; best = p.id; } }
  return best;
}
function snapPoint(sk, hit, exclude) {
  const id = nearestPoint(sk, hit.x, hit.y, hit.tol, exclude);
  if (id) { const p = geoPos(sk, id); return { x: p.x, y: p.y, id }; }
  return { x: snapV(hit.x), y: snapV(hit.y) };
}
function arcAngles(cc, a, b) {
  const a0 = Math.atan2(a.y - cc.y, a.x - cc.x); let a1 = Math.atan2(b.y - cc.y, b.x - cc.x);
  while (a1 <= a0) a1 += 2 * Math.PI;
  return [a0, a1];
}
function curveDist(sk, c, x, y) {
  if (c.kind === 'line') {
    const a = geoPos(sk, c.a), b = geoPos(sk, c.b), dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
  }
  const cc = geoPos(sk, c.c), r = geoRadius(sk, c), d = Math.abs(Math.hypot(x - cc.x, y - cc.y) - r);
  if (c.kind === 'circle') return d;
  const [a0, a1] = arcAngles(cc, geoPos(sk, c.a), geoPos(sk, c.b));
  let t = Math.atan2(y - cc.y, x - cc.x); while (t < a0) t += 2 * Math.PI;
  return t <= a1 ? d : Infinity;
}
function pickGeo(sk, hit) {
  if (!sk.geo) return null;
  const pid = nearestPoint(sk, hit.x, hit.y, hit.tol);
  if (pid) return { kind: 'point', id: pid };
  let best = null, bd = hit.tol;
  for (const c of sk.geo.curves) { const d = curveDist(sk, c, hit.x, hit.y); if (d <= bd) { bd = d; best = c; } }
  return best ? { kind: 'curve', id: best.id, curve: best } : null;
}
function addPoint(g, x, y) { const id = 'p' + uid(); g.points.push({ id, x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 }); return id; }
const cid = () => 'k' + uid();

// ---------- shapes built by drag tools ----------
function buildShape(tool, s, e) {
  const g = emptyGeo(), P = (pt) => pt.id || addPoint(g, pt.x, pt.y), L = (a, b, constr) => { const id = 'l' + uid(); g.curves.push({ id, kind: 'line', a, b, ...(constr ? { constr: true } : {}) }); return id; };
  const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy);
  switch (tool) {
    case 'rect2': case 'rectc': {
      let x0, y0, x1, y1;
      if (tool === 'rect2') { x0 = s.x; y0 = s.y; x1 = e.x; y1 = e.y; } else { x0 = s.x - Math.abs(dx); x1 = s.x + Math.abs(dx); y0 = s.y - Math.abs(dy); y1 = s.y + Math.abs(dy); }
      if (Math.abs(x1 - x0) < 0.5 || Math.abs(y1 - y0) < 0.5) return null;
      const p1 = tool === 'rect2' ? P(s) : addPoint(g, x0, y0), p2 = addPoint(g, x1, y0), p3 = tool === 'rect2' ? P(e) : addPoint(g, x1, y1), p4 = addPoint(g, x0, y1);
      const l1 = L(p1, p2), l2 = L(p2, p3), l3 = L(p3, p4), l4 = L(p4, p1);
      g.cons.push({ id: cid(), type: 'horizontal', e: [l1] }, { id: cid(), type: 'vertical', e: [l2] }, { id: cid(), type: 'horizontal', e: [l3] }, { id: cid(), type: 'vertical', e: [l4] });
      if (tool === 'rectc') { const dg = L(p1, p3, true), c = P(s); g.cons.push({ id: cid(), type: 'midpoint', e: [c, dg] }); }
      return g;
    }
    case 'circle': {
      if (d < 0.5) return null;
      g.curves.push({ id: 'c' + uid(), kind: 'circle', c: P(s), r: Math.round(snapV(d) || d) });
      return g;
    }
    case 'polygon': {
      if (d < 0.5) return null;
      const n = 6, c = P(s), circ = 'c' + uid(), a0 = Math.atan2(dy, dx);
      g.curves.push({ id: circ, kind: 'circle', c, r: Math.round(d * 100) / 100, constr: true });
      const pts = Array.from({ length: n }, (_, i) => addPoint(g, s.x + d * Math.cos(a0 + i * 2 * Math.PI / n), s.y + d * Math.sin(a0 + i * 2 * Math.PI / n)));
      const ls = pts.map((p, i) => L(p, pts[(i + 1) % n]));
      pts.forEach(p => g.cons.push({ id: cid(), type: 'onCircle', e: [p, circ] }));
      for (let i = 1; i < n; i++) g.cons.push({ id: cid(), type: 'equal', e: [ls[0], ls[i]] });
      return g;
    }
    case 'slot': {
      if (d < 1) return null;
      const r = 5, ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const c1 = P(s), c2 = P(e);
      const b1 = addPoint(g, s.x + nx * r, s.y + ny * r), a1 = addPoint(g, s.x - nx * r, s.y - ny * r);
      const a2 = addPoint(g, e.x + nx * r, e.y + ny * r), b2 = addPoint(g, e.x - nx * r, e.y - ny * r);
      const arcL = 'a' + uid(), arcR = 'a' + uid();
      g.curves.push({ id: arcL, kind: 'arc', c: c1, a: b1, b: a1 }, { id: arcR, kind: 'arc', c: c2, a: b2, b: a2 });
      const top = L(a2, b1), bot = L(a1, b2);
      g.cons.push({ id: cid(), type: 'tangent', e: [top, arcL] }, { id: cid(), type: 'tangent', e: [top, arcR] }, { id: cid(), type: 'tangent', e: [bot, arcL] }, { id: cid(), type: 'tangent', e: [bot, arcR] }, { id: cid(), type: 'equal', e: [arcL, arcR] });
      return g;
    }
  }
  return null;
}
function mergeGeo(g, frag) { g.points.push(...frag.points); g.curves.push(...frag.curves); g.cons.push(...frag.cons); return g; }
function arcFrom3(a, b, m) {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, mx = m.x, my = m.y;
  const D = 2 * (ax * (by - my) + bx * (my - ay) + mx * (ay - by));
  if (Math.abs(D) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - my) + (bx * bx + by * by) * (my - ay) + (mx * mx + my * my) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (mx - bx) + (bx * bx + by * by) * (ax - mx) + (mx * mx + my * my) * (bx - ax)) / D;
  const ccw = (mx - ax) * (by - my) - (my - ay) * (bx - mx) > 0;
  return { c: { x: ux, y: uy }, ccw };
}

// ---------- pointer input ----------
viewport.addEventListener('pointerdown', e => {
  if (mode !== 'sketch' || pick || measure || e.button !== 0 || e.target.closest('.dim, .cglyph, .dimedit')) return;
  const hit = planeHit(e); if (!hit) return;
  const sk = featById(sketchId); if (!sk) return;
  if (sketchTool === 'select') {
    const gp = pickGeo(sk, hit);
    if (gp) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { geoSel.has(gp.id) ? geoSel.delete(gp.id) : geoSel.add(gp.id); }
      else if (!geoSel.has(gp.id)) geoSel = new Set([gp.id]);
      selProfile = null;
      gdraw = { kind: 'drag', target: gp, start: hit, moved: false, base: cloneGeo(sk.geo) };
    } else {
      const pr = pickProfile(sk, hit);
      if (!pr) { if (geoSel.size || selProfile) { geoSel.clear(); selProfile = null; refreshOverlays(); renderPalette(); } return; }   // empty space: let the camera orbit
      geoSel.clear(); selProfile = pr.id;
      gdraw = { kind: 'legacy', start: hit, pr, orig: JSON.parse(JSON.stringify(pr)), moved: false };
    }
    e.stopImmediatePropagation(); e.preventDefault();
    renderPalette(); refreshOverlays();
    window.addEventListener('pointermove', onGeoMove); window.addEventListener('pointerup', onGeoUp, { once: true });
    return;
  }
  e.stopImmediatePropagation(); e.preventDefault();
  if (sketchTool === 'line') return lineClick(sk, hit);
  if (sketchTool === 'arc3') return arcClick(sk, hit);
  if (sketchTool === 'fillet2d') return filletClick(sk, hit);
  gdraw = { kind: 'shape', tool: sketchTool, s: snapPoint(sk, hit), e: null };
  window.addEventListener('pointermove', onGeoMove); window.addEventListener('pointerup', onGeoUp, { once: true });
}, { capture: true });

function onGeoMove(e) {
  if (!gdraw) return;
  const sk = featById(sketchId), hit = planeHit(e); if (!sk || !hit) return;
  if (gdraw.kind === 'shape') { gdraw.e = snapPoint(sk, hit); refreshOverlays(); return; }
  if (gdraw.kind === 'legacy') {
    const dx = snapV(hit.x - gdraw.start.x), dy = snapV(hit.y - gdraw.start.y);
    if (!gdraw.moved && (dx || dy)) { checkpoint(); gdraw.moved = true; viewport.classList.add('moving'); }
    if (gdraw.moved) {
      const live = liveProfiles({ ...sk, profiles: [gdraw.orig] })[0];
      if (gdraw.pr.kind === 'poly') gdraw.pr.pts = live.pts.map(q => ({ x: q.x + dx, y: q.y + dy }));
      else { gdraw.pr.cx = Math.round((live.cx + dx) * 100) / 100; gdraw.pr.cy = Math.round((live.cy + dy) * 100) / 100; }
      refreshOverlays();
    }
    return;
  }
  if (gdraw.kind === 'drag') {
    const dx = hit.x - gdraw.start.x, dy = hit.y - gdraw.start.y;
    if (!gdraw.moved && Math.hypot(dx, dy) < hit.tol * 0.4) return;
    if (!gdraw.moved) { gdraw.moved = true; viewport.classList.add('moving'); }
    const g = cloneGeo(gdraw.base), t = gdraw.target, drag = new Set();
    const move = id => { const p = g.points.find(q => q.id === id); if (!p) return; const b = gdraw.base.points.find(q => q.id === id); p.x = b.x + dx; p.y = b.y + dy; drag.add(id); };
    if (t.kind === 'point') {
      if (t.id === 'O') return;
      const p = g.points.find(q => q.id === t.id); p.x = sketchOpts.snap ? snapV(hit.x) : hit.x; p.y = sketchOpts.snap ? snapV(hit.y) : hit.y; drag.add(t.id);
    } else if (t.curve.kind === 'line') { move(t.curve.a); move(t.curve.b); }
    else if (t.curve.kind === 'circle') {
      const c = g.curves.find(x => x.id === t.id), cc = geoPos(sk, c.c);
      if (typeof c.r === 'number') { c.r = Math.max(0.1, Math.hypot(hit.x - cc.x, hit.y - cc.y)); drag.add(c.id); }
    } else { move(t.curve.c); move(t.curve.a); move(t.curve.b); }
    commitGeo(sk, g, { drag, tag: 'drag-' + t.id, quiet: true, noPalette: true, delay: 200 });
  }
}
function onGeoUp() {
  window.removeEventListener('pointermove', onGeoMove);
  const d = gdraw; gdraw = null; viewport.classList.remove('moving');
  const sk = featById(sketchId); if (!d || !sk) return;
  if (d.kind === 'shape' && d.e) {
    const frag = buildShape(d.tool, d.s, d.e);
    if (frag) { const g = mergeGeo(cloneGeo(sk.geo), frag); if (commitGeo(sk, g)) geoSel = new Set(frag.curves.filter(c => !c.constr).map(c => c.id)); }
  } else if ((d.kind === 'drag' || d.kind === 'legacy') && d.moved) { renderPalette(); scheduleRegen(0); }
  refreshOverlays();
}
function lineClick(sk, hit) {
  const g = cloneGeo(sk.geo);
  const sp = snapPoint(sk, hit);
  if (!lineDraft) {
    const id = sp.id || addPoint(g, sp.x, sp.y);
    if (!sp.id) commitGeo(sk, g, { noRegen: true });
    lineDraft = { start: id, last: id, hover: null };
    defaultHint(); refreshOverlays(); return;
  }
  let id = sp.id, auto = null;
  if (id === lineDraft.last) return;
  if (!id) {
    const lp = geoPos(sk, lineDraft.last); let { x, y } = sp; const dx = x - lp.x, dy = y - lp.y;
    if (Math.abs(dy) <= Math.max(hit.tol * 0.5, Math.abs(dx) * 0.035)) { y = lp.y; auto = 'horizontal'; }
    else if (Math.abs(dx) <= Math.max(hit.tol * 0.5, Math.abs(dy) * 0.035)) { x = lp.x; auto = 'vertical'; }
    id = addPoint(g, x, y);
  }
  const lid = 'l' + uid();
  g.curves.push({ id: lid, kind: 'line', a: lineDraft.last, b: id });
  if (auto) g.cons.push({ id: cid(), type: auto, e: [lid] });
  if (!commitGeo(sk, g)) return;
  if (id === lineDraft.start) lineDraft = null; else lineDraft.last = id;
  defaultHint(); refreshOverlays();
}
function arcClick(sk, hit) {
  const sp = snapPoint(sk, hit);
  gdraw ||= { kind: 'arc', pts: [] };
  gdraw.pts.push(sp);
  if (gdraw.pts.length < 3) { defaultHint(); refreshOverlays(); return; }
  const [a, b, m] = gdraw.pts; gdraw = null;
  const arc = arcFrom3(a, b, m);
  if (!arc || Math.hypot(a.x - b.x, a.y - b.y) < 0.1) { toast('Those points do not make an arc'); refreshOverlays(); return; }
  const g = cloneGeo(sk.geo);
  const ia = a.id || addPoint(g, a.x, a.y), ib = b.id || addPoint(g, b.x, b.y), ic = addPoint(g, arc.c.x, arc.c.y);
  const id = 'a' + uid();
  g.curves.push(arc.ccw ? { id, kind: 'arc', c: ic, a: ia, b: ib } : { id, kind: 'arc', c: ic, a: ib, b: ia });
  commitGeo(sk, g); geoSel = new Set([id]); defaultHint();
}
function sketchHover(e) {
  const sk = featById(sketchId), hit = planeHit(e); if (!sk || !hit) return;
  let changed = false;
  if (lineDraft) { const sp = snapPoint(sk, hit); lineDraft.hover = sp; changed = true; }
  if (gdraw?.kind === 'arc') { gdraw.hover = snapPoint(sk, hit); changed = true; }
  if (sketchTool === 'select' && !gdraw) { const gp = pickGeo(sk, hit), id = gp?.id || null; if (id !== geoHover) { geoHover = id; changed = true; } }
  if (changed) refreshOverlays();
}
function endLineChain() { if (lineDraft) { lineDraft = null; refreshOverlays(); defaultHint(); } }

// ---------- drawing ----------
const GLYPH = { symmetry: '⇋', horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', equal: '=', tangent: 'T', fix: 'Fix', midpoint: 'M', concentric: '◎', collinear: '≡', onLine: '•', onCircle: '•', coincident: '•' };
function curvePts(sk, c, posOf, radOf) {
  if (c.kind === 'line') { const a = posOf(c.a), b = posOf(c.b); return [[a.x, a.y], [b.x, b.y]]; }
  const cc = posOf(c.c), r = radOf(c);
  let a0 = 0, a1 = 2 * Math.PI;
  if (c.kind === 'arc') [a0, a1] = arcAngles(cc, posOf(c.a), posOf(c.b));
  const n = Math.max(8, Math.ceil((a1 - a0) / (2 * Math.PI) * 72));
  return Array.from({ length: n + 1 }, (_, i) => { const t = a0 + (a1 - a0) * i / n; return [cc.x + r * Math.cos(t), cc.y + r * Math.sin(t)]; });
}
function drawGeo(sk, grp, active) {
  const st = geoState(sk);
  const zoom = mmPerPx();
  const hasGeo = st && st.solved;
  const posOf = id => geoPos(sk, id), radOf = c => geoRadius(sk, c);
  if (hasGeo) {
    const free = st.analysis.free;
    for (const c of st.rg.curves) {
      const sel = active && geoSel.has(c.id), hov = active && geoHover === c.id;
      const col = !active ? colors.muted : sel ? colors.select : hov ? colors.accent : c.constr ? colors['ico-c'] : free.has(c.id) ? colors.accent : colors.fg;
      grp.add(line(curvePts(sk, c, posOf, radOf).map(([x, y]) => [x, y, 0.07]), col, { depthTest: !active, order: 5, dashed: !!c.constr, dash: 5 * zoom, gap: 3.5 * zoom }));
    }
    if (active) {
      for (const p of st.rg.points) {
        const q = posOf(p.id), sel = geoSel.has(p.id), hov = geoHover === p.id;
        if (p.virtual && !sel && !hov) { const ring = new THREE.Mesh(new THREE.RingGeometry(2 * zoom, 3 * zoom, 14), new THREE.MeshBasicMaterial({ color: colors.muted, depthTest: false })); ring.position.set(q.x, q.y, 0.1); ring.renderOrder = 7; grp.add(ring); continue; }
        const dot = new THREE.Mesh(new THREE.CircleGeometry((sel || hov ? 4 : 3) * zoom, 14), new THREE.MeshBasicMaterial({ color: sel ? colors.select : hov ? colors.accent : free.has(p.id) ? colors.accent : colors.fg, depthTest: false }));
        dot.position.set(q.x, q.y, 0.1); dot.renderOrder = 7; grp.add(dot);
      }
      if (geoSel.has('O') || geoHover === 'O') { const dot = new THREE.Mesh(new THREE.CircleGeometry(4.5 * zoom, 14), new THREE.MeshBasicMaterial({ color: geoSel.has('O') ? colors.select : colors.accent, depthTest: false })); dot.position.set(0, 0, 0.1); dot.renderOrder = 7; grp.add(dot); }
      // constraint glyphs and dimensions
      const stack = new Map();
      for (const k of sk.geo.cons) {
        const rk = st.rg.cons.find(x => x.id === k.id) || k;
        const anchor = consAnchor(sk, rk, zoom, stack);
        if (!anchor) continue;
        const sel = geoSel.has(k.id);
        if (DIM_TYPES.has(k.type)) {
          const v = +rk.value, txt = (k.type === 'diameter' ? 'Ø' : k.type === 'radius' ? 'R' : '') + fmt(v) + (k.type === 'angle' ? '°' : '') + (typeof k.value === 'string' && !/^-?[\d.]+$/.test(k.value) ? '  ' + k.value : '');
          const el = h('button', { class: 'dim' + (sel ? ' sel' : ''), type: 'button', 'data-dim': k.id, title: 'Click to edit · ' + k.type, 'aria-label': 'Edit dimension ' + txt, onclick: ev => { ev.stopPropagation(); if (ev.shiftKey) { geoSel.has(k.id) ? geoSel.delete(k.id) : geoSel.add(k.id); refreshOverlays(); renderPalette(); } else editDim(k.id); } }, txt);
          const o = new CSS2DObject(el); o.position.set(anchor.x, anchor.y, 0.12); grp.add(o);
          if (anchor.leader) grp.add(line(anchor.leader.map(([x, y]) => [x, y, 0.08]), colors.sketch, { depthTest: false, order: 6, opacity: 0.8 }));
        } else {
          const el = h('button', { class: 'cglyph' + (sel ? ' sel' : ''), type: 'button', title: (CMD['k.c.' + k.type]?.label || k.type) + ' · click to select, Delete removes', 'aria-label': k.type + ' constraint', onclick: ev => { ev.stopPropagation(); if (!(ev.shiftKey || ev.ctrlKey || ev.metaKey)) geoSel.clear(); geoSel.has(k.id) ? geoSel.delete(k.id) : geoSel.add(k.id); refreshOverlays(); renderPalette(); } }, GLYPH[k.type] || '?');
          const o = new CSS2DObject(el); o.position.set(anchor.x, anchor.y, 0.12); grp.add(o);
        }
      }
    }
  }
  if (!active) return;
  // previews
  const prevCol = colors.select;
  if (lineDraft?.hover) { const a = posOf(lineDraft.last), b = lineDraft.hover; grp.add(line([[a.x, a.y, 0.09], [b.x, b.y, 0.09]], prevCol, { depthTest: false, order: 8 }));
    const o = new CSS2DObject(h('div', { class: 'mlabel' }, fmt(Math.hypot(b.x - a.x, b.y - a.y)) + ' mm')); o.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.1); grp.add(o); }
  if (gdraw?.kind === 'shape' && gdraw.e) {
    const frag = buildShape(gdraw.tool, gdraw.s, gdraw.e);
    if (frag) {
      const pmap = new Map(frag.points.map(p => [p.id, p]));
      const pos2 = id => pmap.get(id) || posOf(id);
      for (const c of frag.curves) grp.add(line(curvePts(sk, c, pos2, c2 => c2.kind === 'circle' ? c2.r : Math.hypot(pos2(c2.a).x - pos2(c2.c).x, pos2(c2.a).y - pos2(c2.c).y)).map(([x, y]) => [x, y, 0.09]), prevCol, { depthTest: false, order: 8, dashed: !!c.constr, dash: 5 * zoom, gap: 3.5 * zoom }));
      const s = gdraw.s, e2 = gdraw.e, txt = gdraw.tool.startsWith('rect') ? `${fmt(Math.abs(e2.x - s.x) * (gdraw.tool === 'rectc' ? 2 : 1))} × ${fmt(Math.abs(e2.y - s.y) * (gdraw.tool === 'rectc' ? 2 : 1))}` : (gdraw.tool === 'circle' ? 'Ø' : '') + fmt(Math.hypot(e2.x - s.x, e2.y - s.y) * (gdraw.tool === 'circle' ? 2 : 1));
      const o = new CSS2DObject(h('div', { class: 'mlabel' }, txt)); o.position.set(e2.x, e2.y, 0.1); grp.add(o);
    }
  }
  if (gdraw?.kind === 'arc') {
    const pts = [...gdraw.pts, ...(gdraw.hover ? [gdraw.hover] : [])];
    if (pts.length === 2) grp.add(line(pts.map(p => [p.x, p.y, 0.09]), prevCol, { depthTest: false, order: 8, dashed: true, dash: 4 * zoom, gap: 3 * zoom }));
    if (pts.length >= 3) { const arc = arcFrom3(pts[0], pts[1], pts[2]); if (arc) { const c = arc.ccw ? { kind: 'arc', c: 'C', a: 'A', b: 'B' } : { kind: 'arc', c: 'C', a: 'B', b: 'A' }; const m = { C: arc.c, A: pts[0], B: pts[1] }; grp.add(line(curvePts(sk, c, id => m[id], () => Math.hypot(pts[0].x - arc.c.x, pts[0].y - arc.c.y)).map(([x, y]) => [x, y, 0.09]), prevCol, { depthTest: false, order: 8 })); } }
    for (const p of gdraw.pts) { const dot = new THREE.Mesh(new THREE.CircleGeometry(3.5 * zoom, 12), new THREE.MeshBasicMaterial({ color: prevCol, depthTest: false })); dot.position.set(p.x, p.y, 0.1); dot.renderOrder = 8; grp.add(dot); }
  }
}
// Where a constraint glyph or dimension label sits (sketch coordinates).
function consAnchor(sk, k, zoom, stack) {
  const P = id => geoPos(sk, id), C = id => sk.geo.curves.find(c => c.id === id);
  const bump = (key, x, y, nx, ny) => { const n = stack.get(key) || 0; stack.set(key, n + 1); return { x: x + nx * (14 + n * 16) * zoom, y: y + ny * (14 + n * 16) * zoom }; };
  const lineMid = l => { const a = P(l.a), b = P(l.b), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, nx: -dy / L, ny: dx / L }; };
  const e = k.e || [];
  if (DIM_TYPES.has(k.type)) {
    if (k.type === 'length') { const l = C(e[0]); if (!l) return null; const m = lineMid(l), off = 22 * zoom; return { x: m.x - m.nx * off, y: m.y - m.ny * off }; }
    if (k.type === 'pdist') { const p = P(e[0]), l = C(e[1]); if (!l) return null; const a = P(l.a), b = P(l.b), dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1, t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L, f = { x: a.x + t * dx, y: a.y + t * dy }; return { x: (p.x + f.x) / 2 + 6 * zoom, y: (p.y + f.y) / 2 + 6 * zoom, leader: [[p.x, p.y], [f.x, f.y]] }; }
    if (k.type === 'distance' || k.type === 'hdist' || k.type === 'vdist') { const a = P(e[0]), b = P(e[1]); const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, off = 20 * zoom; return { x: (a.x + b.x) / 2 + dy / L * off, y: (a.y + b.y) / 2 - dx / L * off, leader: [[a.x, a.y], [b.x, b.y]] }; }
    if (k.type === 'radius' || k.type === 'diameter') { const c = C(e[0]); if (!c) return null; const cc = P(c.c), r = geoRadius(sk, c); let t = Math.PI / 4; if (c.kind === 'arc') { const [a0, a1] = arcAngles(cc, P(c.a), P(c.b)); t = (a0 + a1) / 2; } return { x: cc.x + (r + 12 * zoom) * Math.cos(t), y: cc.y + (r + 12 * zoom) * Math.sin(t), leader: [[cc.x, cc.y], [cc.x + r * Math.cos(t), cc.y + r * Math.sin(t)]] }; }
    if (k.type === 'angle') { const l1 = C(e[0]), l2 = C(e[1]); if (!l1 || !l2) return null; const m1 = lineMid(l1), m2 = lineMid(l2); return { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 }; }
    return null;
  }
  const first = e[0];
  const c = C(first);
  if (c?.kind === 'line') { const m = lineMid(c); return bump(first, m.x, m.y, m.nx, m.ny); }
  if (c) { const cc = P(c.c), r = geoRadius(sk, c); return bump(first, cc.x + r * 0.7, cc.y + r * 0.7, 0.7, 0.7); }
  const p = P(first); return bump(first, p.x, p.y, 0.7, 0.7);
}

// ---------- constraints & dimensions ----------
function selectionParts(sk) {
  const g = sk.geo || emptyGeo(), sel = [...geoSel];
  const pts = sel.filter(id => id === 'O' || g.points.some(p => p.id === id));
  const crv = sel.map(id => g.curves.find(c => c.id === id)).filter(Boolean);
  return { pts, crv, lines: crv.filter(c => c.kind === 'line'), circs: crv.filter(c => c.kind !== 'line'), cons: sel.filter(id => g.cons.some(k => k.id === id)) };
}
function applyConstraint(type) {
  const sk = featById(sketchId); if (!sk) return;
  if (!sk.geo || !geoSel.size) { toast('Select sketch geometry first, then choose the constraint'); return; }
  const g = cloneGeo(sk.geo), { pts, crv, lines, circs } = selectionParts(sk), P = id => geoPos(sk, id);
  const add = (t, e, extra = {}) => g.cons.push({ id: cid(), type: t, e, ...extra });
  const need = m => { toast(m); return false; };
  const hv = (a, b) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
  let ok = true;
  switch (type) {
    case 'horizontal':
      if (lines.length && !pts.length) lines.forEach(l => add(hv(P(l.a), P(l.b)), [l.id]));
      else if (pts.length === 2 && !crv.length) add(hv(P(pts[0]), P(pts[1])), pts);
      else ok = need('Select lines, or two points'); break;
    case 'coincident':
      if (pts.length === 2 && !crv.length) add('coincident', pts);
      else if (pts.length === 1 && crv.length === 1) add(crv[0].kind === 'line' ? 'onLine' : 'onCircle', [pts[0], crv[0].id]);
      else ok = need('Select two points, or a point and a curve'); break;
    case 'collinear': lines.length === 2 && crv.length === 2 ? add('collinear', lines.map(l => l.id)) : (ok = need('Select two lines')); break;
    case 'parallel': case 'perpendicular': lines.length === 2 && crv.length === 2 ? add(type, lines.map(l => l.id)) : (ok = need('Select two lines')); break;
    case 'equal': (lines.length === 2 && crv.length === 2) || (circs.length === 2 && crv.length === 2) ? add('equal', crv.map(c => c.id)) : (ok = need('Select two lines, or two arcs or circles')); break;
    case 'tangent':
      if (crv.length === 2 && lines.length === 1) add('tangent', [lines[0].id, circs[0].id]);
      else if (circs.length === 2 && crv.length === 2) {
        const [c1, c2] = circs, p1 = P(c1.c), p2 = P(c2.c), d = Math.hypot(p1.x - p2.x, p1.y - p2.y), r1 = geoRadius(sk, c1), r2 = geoRadius(sk, c2);
        add('tangent', [c1.id, c2.id], { sign: Math.abs(d - (r1 + r2)) <= Math.abs(d - Math.abs(r1 - r2)) ? 1 : -1 });
      } else ok = need('Select a line and an arc or circle, or two arcs or circles'); break;
    case 'concentric': circs.length === 2 && crv.length === 2 ? add('concentric', circs.map(c => c.id)) : (ok = need('Select two arcs or circles')); break;
    case 'midpoint': pts.length === 1 && lines.length === 1 && crv.length === 1 ? add('midpoint', [pts[0], lines[0].id]) : (ok = need('Select a point and a line')); break;
    case 'symmetry': pts.length === 2 && lines.length === 1 && crv.length === 1 ? add('symmetry', [pts[0], pts[1], lines[0].id]) : (ok = need('Select two points and the line to mirror them about')); break;
    case 'fix':
      if (!pts.length) { ok = need('Select points to fix'); break; }
      for (const id of pts) { if (id === 'O') continue; const ex = g.cons.findIndex(k => k.type === 'fix' && k.e[0] === id); if (ex >= 0) g.cons.splice(ex, 1); else { const p = P(id); add('fix', [id], { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 }); } }
      break;
    default: ok = need('This constraint is not available yet');
  }
  if (!ok) return;
  if (commitGeo(sk, g, { msg: 'That constraint conflicts with the sketch, so it was not added', mustReduce: type !== 'fix' })) toast((CMD['k.c.' + type]?.label || type) + ' added');
}
function addDimension() {
  const sk = featById(sketchId); if (!sk) return;
  const { pts, crv, lines, circs } = selectionParts(sk), P = id => geoPos(sk, id);
  let dim = null;
  const r2 = v => Math.round(v * 100) / 100;
  if (lines.length === 1 && crv.length === 1 && !pts.length) { const a = P(lines[0].a), b = P(lines[0].b); dim = { type: 'length', e: [lines[0].id], value: r2(Math.hypot(b.x - a.x, b.y - a.y)) }; }
  else if (pts.length === 2 && !crv.length) { const a = P(pts[0]), b = P(pts[1]); dim = { type: 'distance', e: pts, value: r2(Math.hypot(b.x - a.x, b.y - a.y)) }; }
  else if (pts.length === 1 && lines.length === 1 && crv.length === 1) { const p = P(pts[0]), a = P(lines[0].a), b = P(lines[0].b), dx = b.x - a.x, dy = b.y - a.y; dim = { type: 'pdist', e: [pts[0], lines[0].id], value: r2(Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / (Math.hypot(dx, dy) || 1)) }; }
  else if (circs.length === 1 && crv.length === 1 && !pts.length) { const c = circs[0], r = geoRadius(sk, c); dim = c.kind === 'circle' ? { type: 'diameter', e: [c.id], value: r2(2 * r) } : { type: 'radius', e: [c.id], value: r2(r) }; }
  else if (lines.length === 2 && crv.length === 2) {
    const d = l => { const a = P(l.a), b = P(l.b); return [b.x - a.x, b.y - a.y]; }, [d1, d2] = lines.map(d);
    const ang = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]) * 180 / Math.PI;
    dim = { type: 'angle', e: lines.map(l => l.id), value: r2(Math.abs(ang)), sign: ang >= 0 ? 1 : -1 };
  }
  if (!dim) { toast('Select a line, two points, a circle or arc, or two lines, then add the dimension'); return; }
  if (!(dim.value > 0)) { toast('That distance is zero'); return; }
  const g = cloneGeo(sk.geo), id = cid();
  g.cons.push({ id, ...dim });
  if (!commitGeo(sk, g, { msg: 'That dimension conflicts with the sketch', mustReduce: true, redundantMsg: 'That size is already decided by other constraints, so no dimension was added' })) return;
  geoSel.clear(); refreshOverlays();
  setTimeout(() => editDim(id), 60);
}
function editDim(id) {
  const sk = featById(sketchId); if (!sk?.geo) return;
  const k = sk.geo.cons.find(c => c.id === id); if (!k) return;
  document.querySelectorAll('.dimedit').forEach(x => x.remove());
  requestRender();
  requestAnimationFrame(() => {
    const lab = document.querySelector(`[data-dim="${id}"]`), stage = $('#stage');
    const sr = stage.getBoundingClientRect(), lr = lab ? lab.getBoundingClientRect() : { left: sr.left + sr.width / 2, top: sr.top + sr.height / 2, width: 0 };
    const inp = h('input', { class: 'dimedit', type: 'text', value: String(k.value), 'aria-label': 'Dimension value', spellcheck: 'false', style: `left:${lr.left - sr.left - 10}px;top:${lr.top - sr.top - 4}px` });
    stage.append(inp); inp.focus(); inp.select();
    let done = false;
    const close = () => { done = true; inp.remove(); };
    const commit = () => {
      if (done) return;
      const v = inp.value.trim();
      let num; try { num = evalExpr(v, params.vars); } catch (err) { toast(err.message); inp.focus(); return; }
      if (k.type !== 'angle' && !(num > 0)) { toast('Enter a value greater than 0'); inp.focus(); return; }
      const g = cloneGeo(sk.geo), kk = g.cons.find(c => c.id === id);
      kk.value = /^-?\d*\.?\d+$/.test(v) ? parseFloat(v) : v;
      if (commitGeo(sk, g, { msg: 'That value cannot be reached with the other constraints' })) close(); else inp.focus();
    };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') close(); });
    inp.addEventListener('blur', () => { if (!done) setTimeout(() => { if (!done) close(); }, 150); });
  });
}
function deleteGeoSelection() {
  const sk = featById(sketchId); if (!sk?.geo || !geoSel.size) return false;
  const g = cloneGeo(sk.geo), del = new Set(geoSel);
  del.delete('O');
  // deleting a point deletes the curves on it; deleting a curve deletes constraints that use it
  for (const c of g.curves) if ([c.a, c.b, c.c].some(x => del.has(x))) del.add(c.id);
  const usedBefore = new Set(g.curves.flatMap(c => [c.a, c.b, c.c].filter(Boolean)));
  g.curves = g.curves.filter(c => !del.has(c.id));
  const usedAfter = new Set(g.curves.flatMap(c => [c.a, c.b, c.c].filter(Boolean)));
  for (const id of usedBefore) if (!usedAfter.has(id)) del.add(id);     // points left alone by their deleted curves
  g.points = g.points.filter(p => !del.has(p.id));
  g.cons = g.cons.filter(k => !del.has(k.id) && !(k.e || []).some(x => del.has(x)));
  geoSel.clear();
  commitGeo(sk, g, { force: true });
  return true;
}
function toggleConstruction() {
  const sk = featById(sketchId); const { crv } = sk ? selectionParts(sk) : { crv: [] };
  if (!crv.length) { toast('Select lines, arcs or circles to switch between normal and construction'); return; }
  const g = cloneGeo(sk.geo), on = !crv.every(c => c.constr);
  for (const c of g.curves) if (geoSel.has(c.id)) { if (on) c.constr = true; else delete c.constr; }
  commitGeo(sk, g, { force: true });
}

// ---------- small value prompt anchored in the canvas ----------
function promptValue(label, initial, onOK, at) {
  document.querySelectorAll('.dimedit').forEach(x => x.remove());
  const stage = $('#stage'), sr = stage.getBoundingClientRect();
  const x = at ? at.x - sr.left : sr.width / 2 - 70, y = at ? at.y - sr.top : sr.height / 2;
  const inp = h('input', { class: 'dimedit', type: 'text', value: String(initial), 'aria-label': label, title: label, spellcheck: 'false', style: `left:${x}px;top:${y}px` });
  stage.append(inp); inp.focus(); inp.select();
  let done = false;
  const commit = () => { if (done) return; let v; try { v = evalExpr(inp.value, params.vars); } catch (err) { toast(err.message); return; } if (onOK(v, inp.value.trim()) !== false) { done = true; inp.remove(); } };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') { done = true; inp.remove(); } });
  inp.addEventListener('blur', () => setTimeout(() => { if (!done) { done = true; inp.remove(); } }, 150));
  setHint(label + ' · Enter applies, Esc cancels');
}
function screenOf(sk, x, y) {
  const v = new THREE.Vector3(x, y, 0).applyMatrix4(sketchMatrix(sk)).project(camera), r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}

// ---------- sketch fillet: round the corner where two lines meet ----------
let lastFilletR = 5;
function filletClick(sk, hit) {
  const pid = nearestPoint(sk, hit.x, hit.y, hit.tol * 1.5);
  const g0 = sk.geo;
  const lines = pid ? (g0?.curves || []).filter(c => !c.constr && c.kind === 'line' && (c.a === pid || c.b === pid)) : [];
  const others = pid ? (g0?.curves || []).filter(c => !c.constr && c.kind !== 'line' && [c.a, c.b, c.c].includes(pid)) : [];
  if (!pid || lines.length !== 2 || others.length) { toast('Click a corner where exactly two lines meet'); return; }
  const at = screenOf(sk, geoPos(sk, pid).x, geoPos(sk, pid).y);
  promptValue('Fillet radius (mm)', lastFilletR, r => {
    if (!(r > 0)) { toast('Radius must be greater than 0'); return false; }
    const res = makeFillet(sk, pid, lines, r);
    if (res) lastFilletR = r;
    return res;
  }, { x: at.x + 12, y: at.y - 12 });
}
function makeFillet(sk, pid, lines, r) {
  const P = geoPos(sk, pid);
  const far = l => geoPos(sk, l.a === pid ? l.b : l.a);
  const A = far(lines[0]), B = far(lines[1]);
  const u1 = { x: A.x - P.x, y: A.y - P.y }, u2 = { x: B.x - P.x, y: B.y - P.y };
  const L1 = Math.hypot(u1.x, u1.y), L2 = Math.hypot(u2.x, u2.y);
  u1.x /= L1; u1.y /= L1; u2.x /= L2; u2.y /= L2;
  const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (theta < 1e-3 || Math.PI - theta < 1e-3) { toast('These lines are parallel, so there is no corner to round'); return false; }
  const d = r / Math.tan(theta / 2);
  if (d >= L1 - 1e-6 || d >= L2 - 1e-6) { toast('That radius is too large for these lines'); return false; }
  const bis = { x: u1.x + u2.x, y: u1.y + u2.y }, bl = Math.hypot(bis.x, bis.y);
  const cd = r / Math.sin(theta / 2);
  const T1 = { x: P.x + u1.x * d, y: P.y + u1.y * d }, T2 = { x: P.x + u2.x * d, y: P.y + u2.y * d }, Cc = { x: P.x + bis.x / bl * cd, y: P.y + bis.y / bl * cd };
  const g = cloneGeo(sk.geo);
  const t1 = addPoint(g, T1.x, T1.y), t2 = addPoint(g, T2.x, T2.y), c = addPoint(g, Cc.x, Cc.y);
  for (const [l, t] of [[lines[0], t1], [lines[1], t2]]) { const gl = g.curves.find(x => x.id === l.id); if (gl.a === pid) gl.a = t; else gl.b = t; }
  const cross = (T1.x - Cc.x) * (T2.y - Cc.y) - (T1.y - Cc.y) * (T2.x - Cc.x);
  const arcId = 'a' + uid();
  g.curves.push(cross > 0 ? { id: arcId, kind: 'arc', c, a: t1, b: t2 } : { id: arcId, kind: 'arc', c, a: t2, b: t1 });
  // Like Fusion, keep the sharp corner as a virtual point on both line extensions, so dimensions
  // and constraints that referenced the corner (or the full line lengths) still mean the same thing.
  g.points.find(q => q.id === pid).virtual = true;
  g.cons.push({ id: cid(), type: 'onLine', e: [pid, lines[0].id] }, { id: cid(), type: 'onLine', e: [pid, lines[1].id] });
  for (const k of g.cons) {
    const l = lines.find(x => k.type === 'length' && k.e[0] === x.id);
    if (l) { k.type = 'distance'; k.e = [l.a === pid ? l.b : l.a, pid]; }
  }
  g.cons.push({ id: cid(), type: 'tangent', e: [lines[0].id, arcId] }, { id: cid(), type: 'tangent', e: [lines[1].id, arcId] }, { id: cid(), type: 'radius', e: [arcId], value: Math.round(r * 1000) / 1000 });
  if (!commitGeo(sk, g, { msg: 'The fillet conflicts with the sketch constraints' })) return false;
  geoSel = new Set([arcId]); toast('Fillet added. Its radius is a dimension you can edit.');
  return true;
}

// ---------- sketch offset: copy a closed loop at a distance ----------
function offsetSelection() {
  const sk = featById(sketchId); if (!sk?.geo) return;
  const st = geoState(sk); if (!st?.solved) return;
  const { crv } = selectionParts(sk);
  if (!crv.length) { toast('Select a curve of a closed shape, then choose Offset'); return; }
  const target = crv[0];
  const loop = target.kind === 'circle' ? null : st.loops.profiles.find(p => p.kind === 'loop' && p.segs.some(sg => sg.id === target.id));
  if (target.kind !== 'circle' && !loop) { toast('Offset works on closed shapes and circles'); return; }
  promptValue('Offset distance (mm, negative goes inward)', 5, d => {
    if (!d) { toast('Enter a distance other than 0'); return false; }
    const g = cloneGeo(sk.geo);
    let newIds;
    try { newIds = target.kind === 'circle' ? offsetCircle(sk, g, target, d) : offsetLoop(sk, g, loop, d); }
    catch (err) { toast(err.message); return false; }
    if (!commitGeo(sk, g, { force: true })) return false;
    geoSel = new Set(newIds); refreshOverlays(); renderPalette();
    toast('Offset copy added');
  });
}
function offsetCircle(sk, g, c, d) {
  const r = geoRadius(sk, c) + d;
  if (!(r > 0)) throw new Error('The offset would shrink the circle to nothing');
  const cc = geoPos(sk, c.c), id = 'c' + uid();
  g.curves.push({ id, kind: 'circle', c: addPoint(g, cc.x, cc.y), r: Math.round(r * 1e4) / 1e4 });
  g.cons.push({ id: cid(), type: 'concentric', e: [c.id, id] });
  return [id];
}
function offsetLoop(sk, g, loop, d) {
  const segs = loop.segs, n = segs.length;
  // orientation: shoelace over a polyline of the loop
  let area = 0; const poly = profilePolygon(loop);
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p.x * q.y - q.x * p.y; }
  // traversal order of segs can be either way; outward is to the right of travel for a CCW loop
  let travelArea = 0;
  segs.forEach(sg => { travelArea += sg.a[0] * sg.b[1] - sg.b[0] * sg.a[1]; if (sg.t === 'arc') { const m = arcMid(sg); travelArea += (m.a1 - m.a0) * m.r * m.r; } });
  const ccw = travelArea > 0, out = ccw ? 1 : -1;
  void area;
  const offs = segs.map(sg => {
    if (sg.t === 'line') {
      const dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1], L = Math.hypot(dx, dy), nx = dy / L * out * d, ny = -dx / L * out * d;
      return { t: 'line', a: [sg.a[0] + nx, sg.a[1] + ny], b: [sg.b[0] + nx, sg.b[1] + ny] };
    }
    const m = arcMid(sg), sgn = (sg.ccw === ccw) ? 1 : -1, r = m.r + sgn * d;
    if (!(r > 0)) throw new Error('The offset is larger than an arc radius in this shape');
    const at = (p) => { const a = Math.atan2(p[1] - sg.c[1], p[0] - sg.c[0]); return [sg.c[0] + r * Math.cos(a), sg.c[1] + r * Math.sin(a)]; };
    return { t: 'arc', a: at(sg.a), b: at(sg.b), c: sg.c, r, ccw: sg.ccw };
  });
  const lineX = (s1, s2) => {
    const d1 = [s1.b[0] - s1.a[0], s1.b[1] - s1.a[1]], d2 = [s2.b[0] - s2.a[0], s2.b[1] - s2.a[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return s1.b;
    const t = ((s2.a[0] - s1.a[0]) * d2[1] - (s2.a[1] - s1.a[1]) * d2[0]) / den;
    return [s1.a[0] + t * d1[0], s1.a[1] + t * d1[1]];
  };
  const verts = segs.map((sg, i) => {
    const cur = offs[i], nxt = offs[(i + 1) % n];
    if (Math.hypot(cur.b[0] - nxt.a[0], cur.b[1] - nxt.a[1]) < 1e-6) return cur.b;     // tangent joint
    if (cur.t === 'line' && nxt.t === 'line') return lineX(cur, nxt);
    return [(cur.b[0] + nxt.a[0]) / 2, (cur.b[1] + nxt.a[1]) / 2];                        // sharp line/arc joint: close enough, constraints settle it
  });
  const vid = verts.map(v => addPoint(g, v[0], v[1]));
  const ids = [];
  segs.forEach((sg, i) => {
    const a = vid[(i - 1 + n) % n], b = vid[i], id = (sg.t === 'line' ? 'l' : 'a') + uid();
    if (sg.t === 'line') g.curves.push({ id, kind: 'line', a, b });
    else { const c = addPoint(g, sg.c[0], sg.c[1]); g.curves.push(sg.ccw ? { id, kind: 'arc', c, a, b } : { id, kind: 'arc', c, a: b, b: a }); g.cons.push({ id: cid(), type: 'concentric', e: [sg.id, id] }); }
    if (sg.t === 'line') g.cons.push({ id: cid(), type: 'parallel', e: [sg.id, id] });
    ids.push(id);
  });
  // tangent joints stay tangent
  segs.forEach((sg, i) => { const j = (i + 1) % n; if ((sg.t === 'arc') !== (segs[j].t === 'arc') || (sg.t === 'arc' && segs[j].t === 'arc')) { const cur = offs[i], nxt = offs[j]; if (Math.hypot(cur.b[0] - nxt.a[0], cur.b[1] - nxt.a[1]) < 1e-6) g.cons.push({ id: cid(), type: 'tangent', e: [ids[i], ids[j]] }); } });
  return ids;
}
