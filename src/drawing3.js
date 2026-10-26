// ===== Manufacturing drawings: out-of-date detection with a controlled update (DrawingUpdateManager), exploded assembly
// drawings, and hole / thread callouts read from the model's own feature data =====
//
// The drawing keeps the view geometry it was last made from (doc.drawing.cache) together with a fingerprint of the
// model that produced it. When the model changes, the drawing keeps showing that geometry, says it is out of date and
// waits for Update: then the views are remade, dimensions are re-found, and any that changed value or lost their
// geometry are flagged instead of being silently rewritten. Each update is recorded in doc.drawing.revs.
var dwStaleState = false, dwLastRaw = null;

// FNV-1a hash of everything that decides the drawing's geometry (not the drawing itself)
function dwHash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
function modelFingerprint() {
  const S = dwSrc() || {};
  return dwHash(JSON.stringify([doc.features, doc.components || [], doc.joints || [], doc.rigidGroups || [], doc.params || [], doc.bodyMeta || {}, S.bodies || null, S.source || null, S.orient || null, S.explode || 0]));
}
const sectionKey = sc => JSON.stringify([sc.of, sc.axis, sc.value, sc.removeAbove]);
// view data for every cached kind and section
function dwFromRaw(raw) { const data = {}; for (const [k, r] of Object.entries(raw || {})) { const v = prepView(r); if (v) data[k] = v; } return data; }

// ---------- exploded assembly ----------
// Each component (and each loose body) moves away from the assembly centre by `factor` times its own offset from it.
function dwExplodeOffsets(factor) {
  const groups = new Map(), all = new THREE.Box3();
  for (const [id, b] of result.bodies) {
    if (!b.shape || bodyHidden(id)) continue;
    const g = bodyGeomOf(b); g.computeBoundingBox(); const bb = g.boundingBox.clone().applyMatrix4(bodyXf(id));
    const key = compOfBody(id)?.id || 'b:' + id;
    if (!groups.has(key)) groups.set(key, { box: new THREE.Box3(), bodies: [] });
    groups.get(key).box.union(bb); groups.get(key).bodies.push(id); all.union(bb);
  }
  const C = all.getCenter(new THREE.Vector3()), out = new Map();
  for (const g of groups.values()) {
    const off = g.box.getCenter(new THREE.Vector3()).sub(C).multiplyScalar(factor);
    for (const id of g.bodies) out.set(id, off);
  }
  return out;
}

// ---------- update manager ----------
function dimResolvedOk(m, d) {
  if (!d) return false;
  const tol = 0.25 * Math.max(d.w, d.h, 1);
  const okPt = (p, n) => { for (const q of n ? [p, denormPt(d, n)] : [p]) for (const s of d.snaps) if (Math.hypot(s[0] - q[0], s[1] - q[1]) <= tol) return true; return false; };
  if (m.kind === 'd' || m.kind === 'r' || m.kind === 'hc') return d.circles.some(k => [m.c, m.nc ? denormPt(d, m.nc) : null].filter(Boolean).some(q => Math.hypot(k.c[0] - q[0], k.c[1] - q[1]) + Math.abs(k.r - m.r) * 0.5 <= tol));
  if (m.kind === 'ang') return m.l1.every((p, i) => okPt(p, m.n1?.[i])) && m.l2.every((p, i) => okPt(p, m.n2?.[i]));
  return okPt(m.p1, m.n1) && okPt(m.p2, m.n2);
}
// measure every dimension on every sheet against the current view data
function dwMeasureAll() {
  const R = doc.drawing, act = R.active, out = new Map();
  try {
    for (const s of R.sheets) {
      R.active = s.id;
      for (const m of s.dims || []) { const v = viewById(m.view), d = v && dwData[vk(v)]; out.set(m.id, { ok: dimResolvedOk(m, d), v: d ? dimValue(m) : null, sheet: s.name }); }
    }
  } finally { R.active = act; }
  return out;
}
async function dwUpdate() {
  const R = doc.drawing; if (!R) return;
  const before = dwMeasureAll(), act = R.active;
  checkpoint();
  await dwRefresh(true);
  const after = dwMeasureAll();
  let changed = 0, lost = 0, callouts = 0;
  for (const s of R.sheets) {
    R.active = s.id;
    for (const m of s.dims || []) {
      const a = after.get(m.id), b = before.get(m.id);
      if (!a?.ok) { m.flag = { kind: 'lost' }; lost++; continue; }
      if (m.kind === 'hc') {
        const v = viewById(m.view), c = dimGeom(m), info = holeCallout(c.r, dwData[vk(v)]);
        if (JSON.stringify(info.lines) !== JSON.stringify(m.lines)) { m.flag = { kind: 'changed', from: m.lines.join(' / ') }; m.lines = info.lines; m.src = info.src; callouts++; continue; }
      }
      if (b?.v != null && a.v != null && Math.abs(a.v - b.v) > 1e-6) { m.flag = { kind: 'changed', from: b.v }; changed++; }
    }
    for (const bl of s.balloons || []) if (!result.bodies.has(bl.body)) { bl.flag = { kind: 'lost' }; lost++; }
    if (s.auto) relayoutAuto();
  }
  R.active = act;
  const n = (R.revs?.length || 0) + 1;
  R.revs = [...(R.revs || []), { n, date: new Date().toISOString(), fp: R.cache?.fp, changed: changed + callouts, lost }].slice(-50);
  persist(); renderSheet();
  toast(`Drawing updated (update ${n}).` + (changed + callouts ? ` ${changed + callouts} annotation${changed + callouts > 1 ? 's' : ''} changed value` : '') + (lost ? `; ${lost} lost ${lost > 1 ? 'their' : 'its'} geometry and ${lost > 1 ? 'are' : 'is'} flagged` : '') + (changed + callouts + lost ? '. Flagged items are marked; check them, then choose Mark reviewed.' : '. Every annotation kept its value.'));
}
function dwMarkReviewed() {
  const R = doc.drawing; if (!R) return;
  checkpoint();
  for (const s of R.sheets) { for (const m of s.dims || []) delete m.flag; for (const b of s.balloons || []) delete b.flag; }
  persist(); renderSheet();
}
const dwFlagCount = () => (doc.drawing?.sheets || []).reduce((n, s) => n + (s.dims || []).filter(m => m.flag).length + (s.balloons || []).filter(b => b.flag).length, 0);
// the bar above the sheet: out of date (Update) and flagged annotations (Mark reviewed)
function renderStaleBar() {
  if (!sheetEl) return;
  let bar = $('#dwStale');
  const flags = dwFlagCount();
  if (!dwStaleState && !flags) { bar?.remove(); return; }
  if (!bar) { bar = h('div', { id: 'dwStale', class: 'dwstale', role: 'status' }); sheetEl.append(bar); }
  const last = doc.drawing?.revs?.at(-1);
  bar.replaceChildren(
    h('span', { class: 'msg' }, dwStaleState ? 'The model changed after this drawing was last updated' + (last ? ' (update ' + last.n + ', ' + last.date.slice(0, 10) + ')' : '') + '. The views still show the earlier model.' : flags + ' annotation' + (flags > 1 ? 's' : '') + ' changed in the last update and ' + (flags > 1 ? 'are' : 'is') + ' marked.'),
    dwStaleState ? h('button', { class: 'btn ok', id: 'dw-update', type: 'button', onclick: () => dwUpdate() }, 'Update drawing') : null,
    flags ? h('button', { class: 'btn', id: 'dw-review', type: 'button', onclick: () => dwMarkReviewed() }, 'Mark reviewed') : null);
}

// ---------- hole and thread callouts ----------
// Text comes only from features: a hole feature (simple, counterbore, countersink, tapped) or a thread feature whose
// size matches the picked circle. With no matching feature the callout is the measured diameter, and says so.
const METRIC_COARSE_DW = [[1.6, 0.35], [2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [20, 2.5], [24, 3], [30, 3.5], [36, 4]];
const TAP_SIZES_DW = [['M2', 2, 0.4], ['M2.5', 2.5, 0.45], ['M3', 3, 0.5], ['M4', 4, 0.7], ['M5', 5, 0.8], ['M6', 6, 1], ['M8', 8, 1.25], ['M10', 10, 1.5], ['M12', 12, 1.75], ['M14', 14, 2], ['M16', 16, 2], ['M20', 20, 2.5], ['M24', 24, 3]];
function holeCallout(r, d) {
  const lu = UNIT_DEFS[docUnit()][0], L = x => fmtDim(x / lu), near = (a, b, t) => Math.abs(a - b) <= t;
  const n = d ? d.circles.filter(c => (c.full || c.sweep > Math.PI || c.hiddenOnly === false) && near(c.r, r, 0.02)).length : 1, pre = n > 1 ? n + '× ' : '';
  const ok = f => !f.suppressed && statusOf(f.id).state !== 'error';
  const specs = [];
  for (const f0 of doc.features) {
    if (f0.type !== 'hole' || !ok(f0)) continue;
    const f = resolvedById(f0.id) || f0, kind = f.holeType || (f.cbore ? 'cbore' : 'simple'), ext = f.extent || 'distance';
    let dr = +f.diameter / 2, tap = null;
    if (f.tapped) { const t = TAP_SIZES_DW.find(x => x[0] === f.tapSize) || TAP_SIZES_DW[5]; tap = { name: t[0], D: t[1], p: t[2] }; dr = (t[1] - t[2]) / 2; }
    const head = kind === 'cbore' ? +f.cbDiameter / 2 : kind === 'csink' ? +f.csDiameter / 2 : null;
    if (!(near(r, dr, 0.02) || (head && near(r, head, 0.05)))) continue;
    const depth = ext === 'distance' ? ' × ' + L(+f.depth) + ' DEEP' : ext === 'all' ? ' THRU' : ' TO FACE';
    const lines = [];
    if (tap) {
      const td = f.modeled && +f.threadDepth > 0 ? ' × ' + L(+f.threadDepth) + ' DEEP' : depth;
      lines.push(pre + tap.name + '×' + tap.p + (f.lefthand ? ' LH' : '') + td, 'Ø' + L(tap.D - tap.p) + depth);
    } else lines.push(pre + 'Ø' + L(2 * dr) + depth);
    if (kind === 'cbore') lines.push('CBORE Ø' + L(+f.cbDiameter) + ' × ' + L(+f.cbDepth) + ' DEEP');
    if (kind === 'csink') lines.push('CSK Ø' + L(+f.csDiameter) + ' × ' + (+f.csAngle || 90) + '°');
    specs.push({ fid: f0.id, lines });
  }
  for (const f of doc.features) {
    if (f.type !== 'thread' || !ok(f)) continue;
    const sig = (f.edges || []).find(e => e.type === 'CYLINDRE' && near(e.r, r, 0.02)); if (!sig) continue;
    const D = 2 * sig.r;
    // nominal size: the cylinder is the major diameter (shaft) or about the minor diameter (tapped hole)
    const ext = METRIC_COARSE_DW.find(q => near(q[0], D, 0.05)), int = METRIC_COARSE_DW.find(q => near(q[0] - q[1], D, 0.06));
    const m = ext || int, p = +f.pitch > 0 ? +f.pitch : m ? m[1] : null;
    const name = m ? 'M' + m[0] + '×' + p : 'THREAD Ø' + L(D) + (p ? ' P' + p : '');
    const len = f.full !== false ? '' : +f.length > 0 ? ' × ' + L(+f.length) : '';
    specs.push({ fid: f.id, lines: [pre + name + (f.lefthand ? ' LH' : '') + len + (f.modeled ? '' : ' (cosmetic)')] });
  }
  const uniq = [...new Map(specs.map(s => [JSON.stringify(s.lines), s])).values()];
  if (uniq.length === 1) return { lines: uniq[0].lines, src: 'feature', fid: uniq[0].fid };
  return { lines: [pre + 'Ø' + L(2 * r)], src: uniq.length ? 'ambiguous' : 'measured' };
}
// leader from the circle's edge to a shoulder, then the callout lines
function calloutItems(m0, path, text) {
  const v = viewById(m0.view); if (!v || !dwData[vk(v)]) return;
  const m = dimGeom(m0), X = viewXf(v), tag = 'd:' + m.id, c = X.toSheet(m.c), R = m.r * X.s, at = X.toSheet(m.at);
  const dir = [at[0] - c[0], at[1] - c[1]], l = Math.hypot(...dir) || 1, u = [dir[0] / l, dir[1] / l], edge = [c[0] + u[0] * R, c[1] + u[1] * R];
  const right = at[0] >= c[0], sh = [at[0] + (right ? 4 : -4), at[1]];
  path(`M${edge[0]} ${edge[1]}L${at[0]} ${at[1]}L${sh[0]} ${sh[1]}`, { w: 0.18, tag });
  arrowAt(path, edge, [-u[0], -u[1]], tag);
  const lines = m.lines || [];
  lines.forEach((s, i) => text(sh[0] + (right ? 1 : -1), sh[1] + 1.1 + i * 4.2, s, 3.2, { anchor: right ? 'start' : 'end', tag }));
  if (m.src && m.src !== 'feature') text(sh[0] + (right ? 1 : -1), sh[1] + 1.1 + lines.length * 4.2, m.src === 'measured' ? '(measured; no hole feature)' : '(several features match)', 2.2, { anchor: right ? 'start' : 'end', tag });
}
// a flagged annotation gets a marker by its label: Δ changed (with the old value), ! lost its geometry
function flagItems(m0, path, text) {
  if (!m0.flag) return;
  const v = viewById(m0.view); if (!v || !dwData[vk(v)]) return;
  const m = dimGeom(m0), at = viewXf(v).toSheet(m.at), tag = 'w:' + m0.id;
  path(circleD(at[0] + 7, at[1] - 5, 2.4), { w: 0.25, tag });
  text(at[0] + 7, at[1] - 4, m0.flag.kind === 'lost' ? '!' : 'Δ', 2.6, { anchor: 'middle', bold: true, tag });
  if (m0.flag.kind === 'changed') text(at[0] + 10, at[1] - 4, 'was ' + (typeof m0.flag.from === 'number' ? fmtDim(m0.flag.from / (m0.kind === 'ang' ? 1 : UNIT_DEFS[docUnit()][0])) : m0.flag.from), 2, { tag });
  if (m0.flag.kind === 'lost') text(at[0] + 10, at[1] - 4, 'geometry not found', 2, { tag });
}
// registered once the command registry (ribbon.js) has loaded
queueMicrotask(() => {
  cmd('dw.update', 'Update Drawing', 'history', { run: () => dwUpdate() });
  cmd('dw.callout', 'Hole / Thread Callout', 'hole', { run: () => { dwTool = dwTool === 'callout' ? null : 'callout'; dwDraft = null; renderRibbon(); defaultHint(); } });
});
