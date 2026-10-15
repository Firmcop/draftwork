// 2D drawings (Drawing workspace): one sheet with views projected from the model with exact hidden-line removal,
// dimensions, a title block, and PDF export. Views and dimensions are stored in doc.drawing; the view geometry is
// recomputed by the engine whenever the model changes, so the drawing stays associative.
let workspace = 'design';
const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };
const SCALES = [10, 5, 4, 2, 1, 1 / 2, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];
const VIEW_KINDS = { front: 'Front', top: 'Top', right: 'Right', left: 'Left', back: 'Back', bottom: 'Bottom', iso: 'Isometric' };
const TB = { w: 180, h: 32 };      // title block size (mm)
let dwData = {};                   // view kind -> { vis, hid, bbox, segs, snaps, circles }
let dwKey = '', dwPending = null;
let dwTool = null;                 // 'dim' | 'dia' | 'place:<kind>' | null
let dwSel = null;                  // { type: 'view' | 'dim', id }
let dwDraft = null;                // dimension being placed: { view, p1, p2 }
let dwHover = null, dwCursor = null;
let dwCam = null;                  // SVG viewBox { x, y, w, h }

const dw = () => doc.drawing;
const sheetSize = () => SHEETS[dw()?.sheet || 'A3'];
const scaleLabel = s => s >= 1 ? `${+s.toFixed(3)}:1` : `1:${+(1 / s).toFixed(3)}`;
const fmtDim = v => (Math.round(v * 100) / 100).toString();

// ---------- SVG path parsing (absolute M L H V C Q A Z, as the engine writes them) ----------
function arcToBeziers(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  const rad = phi * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cs * dx + sn * dy, y1p = -sn * dx + cs * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1e-30)));
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cs * cxp - sn * cyp + (x1 + x2) / 2, cy = sn * cxp + cs * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry), dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), d = dt / n, k = 4 / 3 * Math.tan(d / 4), out = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d, b = a + d;
    const P = t => [cx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs];
    const D = t => [-rx * Math.sin(t) * cs - ry * Math.cos(t) * sn, -rx * Math.sin(t) * sn + ry * Math.cos(t) * cs];
    const pa = P(a), pb = P(b), da = D(a), db = D(b);
    out.push([pa[0] + k * da[0], pa[1] + k * da[1], pb[0] - k * db[0], pb[1] - k * db[1], pb[0], pb[1]]);
  }
  return { beziers: out, center: [cx, cy], r: rx, circular: Math.abs(rx - ry) < 1e-6 * Math.max(1, rx) };
}
// -> { segs: [['M',x,y] | ['L',x,y] | ['C',x1,y1,x2,y2,x,y] | ['Z']], pts: endpoints, arcs: [{ c, r }] }
function parsePath(d) {
  const tok = d.match(/[MLHVCQAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const segs = [], pts = [], arcs = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const num = () => +tok[i++];
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'Z') { segs.push(['Z']); x = sx; y = sy; continue; }
    if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; segs.push(['M', x, y]); pts.push([x, y]); cmd = 'L'; continue; }
    if (cmd === 'L') { x = num(); y = num(); segs.push(['L', x, y]); pts.push([x, y]); continue; }
    if (cmd === 'H') { x = num(); segs.push(['L', x, y]); pts.push([x, y]); continue; }
    if (cmd === 'V') { y = num(); segs.push(['L', x, y]); pts.push([x, y]); continue; }
    if (cmd === 'C') { const a = [num(), num(), num(), num(), num(), num()]; segs.push(['C', ...a]); x = a[4]; y = a[5]; pts.push([x, y]); continue; }
    if (cmd === 'Q') { const qx = num(), qy = num(), ex = num(), ey = num(); segs.push(['C', x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey]); x = ex; y = ey; pts.push([x, y]); continue; }
    if (cmd === 'A') {
      const rx = num(), ry = num(), phi = num(), fa = num(), fs = num(), ex = num(), ey = num();
      const A = arcToBeziers(x, y, rx, ry, phi, fa, fs, ex, ey);
      for (const b of A.beziers) segs.push(['C', ...b]);
      if (A.circular) arcs.push({ c: A.center, r: A.r });
      x = ex; y = ey; pts.push([x, y]); continue;
    }
    i++;   // unknown token: skip
  }
  return { segs, pts, arcs };
}
function prepView(raw) {
  if (!raw?.bbox) return null;
  const vis = raw.vis.map(parsePath);
  // drop hidden lines that lie exactly under visible ones (they would print as a darker, dashed-looking edge)
  const vl = [];
  for (const p of vis) { let cur = null; for (const sg of p.segs) { if (sg[0] === 'M') cur = [sg[1], sg[2]]; else if (sg[0] === 'L') { vl.push([cur, [sg[1], sg[2]]]); cur = [sg[1], sg[2]]; } else if (sg[0] === 'C') cur = [sg[5], sg[6]]; } }
  const onVis = (a, b) => vl.some(([p, q]) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy); if (L < 1e-9) return false;
    const off = pt => Math.abs((pt[0] - p[0]) * dy - (pt[1] - p[1]) * dx) / L, t = pt => ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / (L * L);
    return off(a) < 1e-4 && off(b) < 1e-4 && Math.min(t(a), t(b)) > -1e-6 && Math.max(t(a), t(b)) < 1 + 1e-6; });
  const visArcs = vis.flatMap(p => p.arcs);
  const covered = p => { let cur = null, any = false;
    for (const sg of p.segs) { if (sg[0] === 'M') cur = [sg[1], sg[2]]; else if (sg[0] === 'L') { if (!onVis(cur, [sg[1], sg[2]])) return false; any = true; cur = [sg[1], sg[2]]; } else if (sg[0] === 'C') { cur = [sg[5], sg[6]]; } }
    if (p.arcs.length) { if (!p.arcs.every(a => visArcs.some(v => Math.hypot(v.c[0] - a.c[0], v.c[1] - a.c[1]) < 1e-4 && Math.abs(v.r - a.r) < 1e-4))) return false; any = true; }
    else if (p.segs.some(sg => sg[0] === 'C')) return false;
    return any; };
  const hid = raw.hid.map(parsePath).filter(p => !covered(p));
  const [[x0, y0], [x1, y1]] = raw.bbox;
  const snaps = [], circles = [];
  const addSnap = p => { if (!snaps.some(q => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6)) snaps.push(p); };
  for (const p of [...vis, ...hid]) {
    p.pts.forEach(addSnap);
    for (const a of p.arcs) { addSnap(a.c); if (!circles.some(c => Math.hypot(c.c[0] - a.c[0], c.c[1] - a.c[1]) < 1e-6 && Math.abs(c.r - a.r) < 1e-6)) circles.push(a); }
  }
  return { vis, hid, cx: (x0 + x1) / 2, cy: -(y0 + y1) / 2, w: x1 - x0, h: y1 - y0, snaps, circles };
}

// ---------- view placement ----------
// A projected view stays aligned with its parent view and keeps a gap from it; other views sit where placed.
function viewPos(v, depth = 0) {
  const P = v.parent && depth < 4 && viewById(v.parent);
  if (!P) return [v.x, v.y];
  const [px, py] = viewPos(P, depth + 1), s = dw().scale, dp = dwData[P.kind], dc = dwData[v.kind];
  if (!dp || !dc) return [v.x, v.y];
  const g = v.gap ?? 18;
  if (v.dir === 'right') return [px + s * dp.w / 2 + g + s * dc.w / 2, py];
  if (v.dir === 'left') return [px - s * dp.w / 2 - g - s * dc.w / 2, py];
  if (v.dir === 'down') return [px, py + s * dp.h / 2 + g + s * dc.h / 2];
  return [px, py - s * dp.h / 2 - g - s * dc.h / 2];
}
function viewXf(v) {
  const d = dwData[v.kind], s = dw().scale, [vx, vy] = viewPos(v);
  return { s, x: vx, y: vy, toSheet: ([x, y]) => [vx + s * (x - (d?.cx || 0)), vy + s * (y - (d?.cy || 0))], toLocal: ([X, Y]) => [(X - vx) / s + (d?.cx || 0), (Y - vy) / s + (d?.cy || 0)] };
}
function segsToD(segs, f) {
  let out = '';
  for (const s of segs) {
    if (s[0] === 'Z') out += 'Z';
    else if (s[0] === 'C') { const a = f([s[1], s[2]]), b = f([s[3], s[4]]), c = f([s[5], s[6]]); out += `C${a[0].toFixed(3)} ${a[1].toFixed(3)} ${b[0].toFixed(3)} ${b[1].toFixed(3)} ${c[0].toFixed(3)} ${c[1].toFixed(3)}`; }
    else { const p = f([s[1], s[2]]); out += `${s[0]}${p[0].toFixed(3)} ${p[1].toFixed(3)}`; }
  }
  return out;
}
// Standard layout (third-angle): front lower left, top above it, right beside it, isometric upper right.
// The largest standard scale is used at which no view overlaps another view or the title block.
function standardLayout() {
  const [W, H] = sheetSize(), F = dwData.front, T = dwData.top, R = dwData.right, I = dwData.iso;
  if (!F || !T || !R) return null;
  const gap = 18, left = 10 + gap, top = 10 + gap;
  const tbBox = [W - 10 - TB.w - 4, H - 10 - TB.h - 4, W - 10, H - 10];
  const build = scale => {
    const fx = left + scale * F.w / 2, ty = top + scale * T.h / 2, fy = ty + scale * T.h / 2 + gap + scale * F.h / 2, fid = uid();
    const views = [{ id: fid, kind: 'front', x: fx, y: fy, hidden: true }, { id: uid(), kind: 'top', x: fx, y: ty, hidden: true, parent: fid, dir: 'up', gap },
      { id: uid(), kind: 'right', x: fx + scale * F.w / 2 + gap + scale * R.w / 2, y: fy, hidden: true, parent: fid, dir: 'right', gap }];
    if (I) views.push({ id: uid(), kind: 'iso', x: W - 10 - gap - scale * I.w / 2, y: top + scale * I.h / 2, hidden: false });
    const box = v => { const d = dwData[v.kind]; return [v.x - scale * d.w / 2, v.y - scale * d.h / 2 - 2, v.x + scale * d.w / 2, v.y + scale * d.h / 2 + 8]; };   // room for the label
    const boxes = views.map(box), hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const ok = boxes.every(b => b[0] >= 12 && b[1] >= 12 && b[2] <= W - 12 && b[3] <= H - 12 && !hit(b, tbBox)) && boxes.every((a, x) => boxes.every((b, y) => x >= y || !hit(a, b)));
    return { ok, views };
  };
  for (const sc of SCALES) { const L = build(sc); if (L.ok) return { scale: sc, views: L.views }; }
  const sc = SCALES[SCALES.length - 1]; return { scale: sc, views: build(sc).views };
}
function newDrawingData() {
  const L = standardLayout() || { scale: 1, views: [] };
  return { sheet: 'A3', scale: L.scale, views: L.views, dims: [], auto: true, title: { author: '', partNo: '', material: doc.material || '', checked: '' } };
}

// ---------- geometry from the engine ----------
function dwItems() { return [...result.bodies.entries()].filter(([id, b]) => b.shape && !bodyHidden(id)).map(([id, b]) => ({ shape: b.shape, place: bodyXf(id) === IDENT ? null : xfParts(bodyXf(id)) })); }
async function dwRefresh() {
  if (!isBrep()) return;
  const items = dwItems(), kinds = [...new Set(['front', 'top', 'right', 'iso', ...(dw()?.views || []).map(v => v.kind)])];
  const key = JSON.stringify([items, kinds]);
  if (key === dwKey && Object.keys(dwData).length) return;
  if (dwPending?.key === key) return dwPending.p;
  const p = (async () => {
    $('#busy').hidden = false;
    try {
      const raw = items.length ? await brepProject(items, kinds) : {};
      const data = {}; for (const k of kinds) { const v = prepView(raw[k]); if (v) data[k] = v; }
      dwData = data; dwKey = key;
    } catch (e) { toast('Could not make the drawing views: ' + occMsg(e)); }
    finally { $('#busy').hidden = true; dwPending = null; }
  })();
  dwPending = { key, p };
  return p;
}

// ---------- workspace ----------
async function enterDrawing() {
  if (!isBrep()) { toast(engineState === 'loading' ? 'The exact geometry engine is still loading. Try again in a moment.' : 'Drawings need the exact geometry engine, which could not start here: ' + engineMsg); return; }
  if (!result.bodies.size) { toast('There is no body to draw yet'); return; }
  if (mode === 'sketch') finishSketch(true);
  if (dlg) closeDialog(true);
  workspace = 'drawing'; dwTool = null; dwSel = null; dwDraft = null;
  document.body.classList.add('ws-drawing'); $('#wsBtn span').textContent = 'DRAWING';
  activeTab = 'DRAWING'; renderRibbon(); ensureSheetEl();
  await dwRefresh();
  if (!dw()) { checkpoint(); doc.drawing = newDrawingData(); persist(); }
  else if (dw().auto) relayoutAuto();
  dwFit(); renderSheet(); defaultHint();
}
function exitDrawing() {
  workspace = 'design'; dwTool = null; dwSel = null; dwDraft = null;
  document.body.classList.remove('ws-drawing'); $('#wsBtn span').textContent = 'DESIGN';
  activeTab = 'SOLID'; renderRibbon(); defaultHint(); requestRender();
}
function dwAfterRegen() { if (workspace !== 'drawing') return; if (!dw()) { exitDrawing(); return; } dwRefresh().then(() => { if (dw()?.auto) relayoutAuto(); renderSheet(); }); }
// While nobody has moved a view by hand, re-flow the standard layout (and scale) when the model changes.
function relayoutAuto() {
  const D = dw(), L = standardLayout(); if (!L) return;
  const byKind = k => D.views.find(v => v.kind === k), nf = L.views.find(v => v.kind === 'front'), f = byKind('front');
  if (!f) return;
  D.scale = L.scale;
  for (const nv of L.views) { const v = byKind(nv.kind); if (!v) continue; v.x = nv.x; v.y = nv.y; if (nv.parent) { v.parent = f.id; v.dir = nv.dir; v.gap = nv.gap; } }
}
function drawingHint() {
  if (dwTool === 'dim') return dwDraft?.p2 ? 'Move to place the dimension and click. Above or below gives horizontal, beside gives vertical, in between gives aligned' : dwDraft ? 'Click the second point on the same view' : 'Click a point on a view (corners and circle centers snap) · Esc cancels';
  if (dwTool === 'dia') return 'Click a circle, then click where the label goes · Esc cancels';
  if (dwTool?.startsWith('place:')) return 'Click on the sheet to place the ' + VIEW_KINDS[dwTool.slice(6)].toLowerCase() + ' view · Esc cancels';
  return 'Drag views to arrange them · scroll to zoom, drag the paper to pan · select a view or dimension and press Delete to remove it';
}

// ---------- sheet element and rendering ----------
let sheetEl = null, sheetSvg = null;
function ensureSheetEl() {
  if (sheetEl) return;
  sheetEl = h('div', { class: 'sheet', id: 'sheet', 'aria-label': 'Drawing sheet' });
  sheetSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sheetSvg.setAttribute('id', 'sheetSvg'); sheetSvg.setAttribute('role', 'img');
  sheetEl.append(sheetSvg); $('#viewport').after(sheetEl);   // below dialogs, hints and toasts
  wireSheet();
}
function dwFit() {
  const [W, H] = sheetSize(), r = sheetEl.getBoundingClientRect(), pad = 16;
  const k = Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H) || 1;
  const w = r.width / k, hh = r.height / k;
  dwCam = { x: W / 2 - w / 2, y: H / 2 - hh / 2, w, h: hh };
}
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); return e; };
// One display list feeds both the screen (SVG) and the PDF.
function displayList() {
  const D = dw(), [W, H] = sheetSize(), L = [];
  const path = (d, o = {}) => L.push({ t: 'path', d, w: o.w ?? 0.25, dash: o.dash || null, fill: !!o.fill, tag: o.tag || null });
  const text = (x, y, s, size = 3.5, o = {}) => L.push({ t: 'text', x, y, s: String(s), size, anchor: o.anchor || 'start', rot: o.rot || 0, bold: !!o.bold, tag: o.tag || null });
  path(`M10 10H${W - 10}V${H - 10}H10Z`, { w: 0.5 });
  // title block
  const tx = W - 10 - TB.w, ty = H - 10 - TB.h, t = D.title || {};
  path(`M${tx} ${ty}H${W - 10}V${H - 10}H${tx}Z`, { w: 0.5 });
  path(`M${tx} ${ty + 14}H${W - 10}M${tx} ${ty + 23}H${W - 10}M${tx + 60} ${ty + 14}V${H - 10}M${tx + 105} ${ty + 14}V${H - 10}M${tx + 140} ${ty + 14}V${H - 10}`, { w: 0.25 });
  const cell = (x, y, label, val, size = 3) => { text(x + 1.5, y + 3, label, 1.8); text(x + 1.5, y + 7.5, val || '—', size); };
  text(tx + 3, ty + 6, 'TITLE', 1.8); text(tx + 3, ty + 11.5, doc.name || 'Untitled', 5, { bold: true });
  cell(tx, ty + 14, 'DRAWN BY', t.author); cell(tx + 60, ty + 14, 'DATE', t.date || new Date().toISOString().slice(0, 10)); cell(tx + 105, ty + 14, 'SCALE', scaleLabel(D.scale)); cell(tx + 140, ty + 14, 'SIZE', D.sheet);
  cell(tx, ty + 23, 'MATERIAL', t.material); cell(tx + 60, ty + 23, 'PART NO.', t.partNo); cell(tx + 105, ty + 23, 'UNITS', 'mm'); cell(tx + 140, ty + 23, 'SHEET', '1 / 1');
  text(tx, ty - 2, 'Third-angle projection · Draftwork', 1.8);
  // views
  for (const v of D.views) {
    const d = dwData[v.kind]; if (!d) continue;
    const X = viewXf(v), tag = 'v:' + v.id;
    if (v.hidden) for (const p of d.hid) path(segsToD(p.segs, X.toSheet), { w: 0.18, dash: [1.5, 0.8], tag });
    for (const p of d.vis) path(segsToD(p.segs, X.toSheet), { w: 0.35, tag });
  }
  // dimensions
  for (const m of D.dims) dimItems(m, path, text);
  if (dwDraft?.p2 && dwCursor) dimItems({ ...dwDraft, id: '_draft', at: viewXf(viewById(dwDraft.view)).toLocal(dwCursor) }, path, text, true);
  return L;
}
const viewById = id => dw().views.find(v => v.id === id);
// Associative dimension points: each point also remembers where it sits relative to the view's extents. After the
// model changes it snaps to whichever geometry is nearest, at its old position or at its relative position, so
// corners follow a resized part while features that did not move stay put.
function normPt(d, p) { const x0 = d.cx - d.w / 2, y0 = d.cy - d.h / 2; return [d.w > 1e-9 ? (p[0] - x0) / d.w : 0.5, d.h > 1e-9 ? (p[1] - y0) / d.h : 0.5]; }
function denormPt(d, n) { return [d.cx - d.w / 2 + n[0] * d.w, d.cy - d.h / 2 + n[1] * d.h]; }
function resolvePt(d, p, n) {
  let best = p, bd = Infinity;
  for (const q of n ? [p, denormPt(d, n)] : [p]) for (const s of d.snaps) { const dd = Math.hypot(s[0] - q[0], s[1] - q[1]); if (dd < bd) { bd = dd; best = s; } }
  return bd <= 0.25 * Math.max(d.w, d.h, 1) ? best : p;
}
function resolveCircle(d, c, r, n) {
  let best = null, bd = Infinity;
  for (const q of n ? [c, denormPt(d, n)] : [c]) for (const k of d.circles) { const dd = Math.hypot(k.c[0] - q[0], k.c[1] - q[1]) + Math.abs(k.r - r) * 0.5; if (dd < bd) { bd = dd; best = k; } }
  return best && bd <= 0.25 * Math.max(d.w, d.h, 1) ? best : { c, r };
}
// The label keeps its offset from its own dimension (ao), so it moves with the geometry it measures.
const dimMid = m => m.kind === 'd' || m.kind === 'r' ? m.c : [(m.p1[0] + m.p2[0]) / 2, (m.p1[1] + m.p2[1]) / 2];
function dimGeom(m) {
  const v = viewById(m.view), d = v && dwData[v.kind]; if (!d) return m;
  const g = m.kind === 'd' || m.kind === 'r' ? (k => ({ ...m, c: k.c, r: k.r }))(resolveCircle(d, m.c, m.r, m.nc)) : { ...m, p1: resolvePt(d, m.p1, m.n1), p2: resolvePt(d, m.p2, m.n2) };
  if (m.ao) { const c = dimMid(g); g.at = [c[0] + m.ao[0], c[1] + m.ao[1]]; }
  return g;
}
function arrowAt(path, P, dir, tag) {
  const l = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / l, dir[1] / l], n = [-u[1], u[0]], A = 2.6, B = 0.9;
  path(`M${P[0]} ${P[1]}L${P[0] - u[0] * A + n[0] * B} ${P[1] - u[1] * A + n[1] * B}L${P[0] - u[0] * A - n[0] * B} ${P[1] - u[1] * A - n[1] * B}Z`, { fill: true, w: 0.1, tag });
}
function dimKind(p1, p2, at) {
  const minX = Math.min(p1[0], p2[0]), maxX = Math.max(p1[0], p2[0]), minY = Math.min(p1[1], p2[1]), maxY = Math.max(p1[1], p2[1]);
  if ((at[1] < minY || at[1] > maxY) && maxX - minX > 1e-6) return 'h';
  if ((at[0] < minX || at[0] > maxX) && maxY - minY > 1e-6) return 'v';
  return 'a';
}
function dimValue(m0) {
  const m = dimGeom(m0);
  if (m.kind === 'd') return 2 * m.r;
  if (m.kind === 'r') return m.r;
  const dx = m.p2[0] - m.p1[0], dy = m.p2[1] - m.p1[1], k = m.kind || dimKind(m.p1, m.p2, m.at);
  return k === 'h' ? Math.abs(dx) : k === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
}
function dimItems(m0, path, text, draft) {
  const v = viewById(m0.view); if (!v || !dwData[v.kind]) return;
  const m = draft ? m0 : dimGeom(m0);
  const X = viewXf(v), tag = draft ? null : 'd:' + m.id, S = X.toSheet, at = S(m.at), o = { w: 0.18, tag }, label = (m.kind === 'd' ? 'Ø' : m.kind === 'r' ? 'R' : '') + fmtDim(dimValue(m)), size = 3.2;
  if (m.kind === 'd' || m.kind === 'r') {
    const c = S(m.c), R = m.r * X.s, dir = [at[0] - c[0], at[1] - c[1]], l = Math.hypot(...dir) || 1, u = [dir[0] / l, dir[1] / l];
    const edge = [c[0] + u[0] * R, c[1] + u[1] * R], far = m.kind === 'd' ? [c[0] - u[0] * R, c[1] - u[1] * R] : c;
    path(`M${far[0]} ${far[1]}L${at[0]} ${at[1]}`, o);
    arrowAt(path, edge, [-u[0], -u[1]], tag); if (m.kind === 'd') arrowAt(path, far, u, tag);
    const right = at[0] >= c[0];
    path(`M${at[0]} ${at[1]}H${at[0] + (right ? 1 : -1) * (label.length * size * 0.55 + 2)}`, o);
    text(at[0] + (right ? 1 : -1), at[1] - 1, label, size, { anchor: right ? 'start' : 'end', tag });
    return;
  }
  const P1 = S(m.p1), P2 = S(m.p2), k = m.kind || dimKind(m.p1, m.p2, m.at), gap = 1, over = 1.5;
  if (k === 'h' || k === 'v') {
    const ax = k === 'h' ? 1 : 0;                        // coordinate that the dimension line holds
    const lineC = at[ax];
    for (const P of [P1, P2]) { const sgn = Math.sign(lineC - P[ax]) || 1, a = [...P], b = [...P]; a[ax] = P[ax] + sgn * gap; b[ax] = lineC + sgn * over; path(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`, o); }
    const A = [...P1], B = [...P2]; A[ax] = lineC; B[ax] = lineC;
    path(`M${A[0]} ${A[1]}L${B[0]} ${B[1]}`, o);
    arrowAt(path, A, [A[0] - B[0], A[1] - B[1]], tag); arrowAt(path, B, [B[0] - A[0], B[1] - A[1]], tag);
    const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    if (k === 'h') text(mid[0], mid[1] - 1, label, size, { anchor: 'middle', tag });
    else text(mid[0] - 1, mid[1], label, size, { anchor: 'middle', rot: -90, tag });
    return;
  }
  const d = [P2[0] - P1[0], P2[1] - P1[1]], l = Math.hypot(...d) || 1, n = [-d[1] / l, d[0] / l], off = (at[0] - P1[0]) * n[0] + (at[1] - P1[1]) * n[1];
  const A = [P1[0] + n[0] * off, P1[1] + n[1] * off], B = [P2[0] + n[0] * off, P2[1] + n[1] * off], sg = Math.sign(off) || 1;
  for (const [P, Q] of [[P1, A], [P2, B]]) path(`M${P[0] + n[0] * gap * sg} ${P[1] + n[1] * gap * sg}L${Q[0] + n[0] * over * sg} ${Q[1] + n[1] * over * sg}`, o);
  path(`M${A[0]} ${A[1]}L${B[0]} ${B[1]}`, o);
  arrowAt(path, A, [A[0] - B[0], A[1] - B[1]], tag); arrowAt(path, B, [B[0] - A[0], B[1] - A[1]], tag);
  let ang = Math.atan2(d[1], d[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  const mid = [(A[0] + B[0]) / 2 + n[0] * sg * 1, (A[1] + B[1]) / 2 + n[1] * sg * 1];
  text(mid[0], mid[1], label, size, { anchor: 'middle', rot: ang, tag });
}
function renderSheet() {
  if (!sheetEl || workspace !== 'drawing' || !dw()) return;
  const [W, H] = sheetSize();
  sheetSvg.setAttribute('viewBox', `${dwCam.x} ${dwCam.y} ${dwCam.w} ${dwCam.h}`);
  sheetSvg.replaceChildren();
  sheetSvg.append(sv('rect', { x: 0, y: 0, width: W, height: H, class: 'paper' }));
  const sel = dwSel ? (dwSel.type === 'view' ? 'v:' : 'd:') + dwSel.id : null;
  for (const it of displayList()) {
    const cls = (it.tag && it.tag === sel ? 'sel' : '') + (it.tag ? ' pick' : '');
    if (it.t === 'path') sheetSvg.append(sv('path', { d: it.d, 'stroke-width': it.w, 'stroke-dasharray': it.dash ? it.dash.join(' ') : null, class: (it.fill ? 'ink fill ' : 'ink ') + cls, 'data-tag': it.tag }));
    else { const e = sv('text', { x: it.x, y: it.y, 'font-size': it.size, 'text-anchor': it.anchor, class: 'ink-text ' + cls + (it.bold ? ' bold' : ''), 'data-tag': it.tag, transform: it.rot ? `rotate(${it.rot} ${it.x} ${it.y})` : null }); e.textContent = it.s; sheetSvg.append(e); }
  }
  // tool feedback
  if (dwHover?.p) { const r = dwCam.w / 250; sheetSvg.append(sv('circle', { cx: dwHover.P[0], cy: dwHover.P[1], r, class: 'snap' })); }
  if (dwHover?.circle) { const v = viewById(dwHover.view), X = viewXf(v), c = X.toSheet(dwHover.circle.c); sheetSvg.append(sv('circle', { cx: c[0], cy: c[1], r: dwHover.circle.r * X.s, class: 'snap ring' })); }
  if (dwDraft?.p1 && !dwDraft.p2) { const v = viewById(dwDraft.view), P = viewXf(v).toSheet(dwDraft.p1); sheetSvg.append(sv('circle', { cx: P[0], cy: P[1], r: dwCam.w / 250, class: 'snap on' })); }
}

// ---------- interaction ----------
function sheetPoint(e) { const r = sheetSvg.getBoundingClientRect(); return [dwCam.x + (e.clientX - r.left) / r.width * dwCam.w, dwCam.y + (e.clientY - r.top) / r.height * dwCam.h]; }
const pxToMm = () => dwCam.w / sheetSvg.getBoundingClientRect().width;
function nearestSnap(P, onlyView) {
  let best = null, bd = 8 * pxToMm();
  for (const v of dw().views) {
    if (onlyView && v.id !== onlyView) continue;
    const d = dwData[v.kind]; if (!d) continue; const X = viewXf(v);
    for (const s of d.snaps) { const Q = X.toSheet(s), dd = Math.hypot(Q[0] - P[0], Q[1] - P[1]); if (dd < bd) { bd = dd; best = { view: v.id, p: s, P: Q }; } }
  }
  return best;
}
function nearestCircle(P) {
  let best = null, bd = 6 * pxToMm();
  for (const v of dw().views) {
    const d = dwData[v.kind]; if (!d) continue; const X = viewXf(v);
    for (const c of d.circles) { const C = X.toSheet(c.c), dd = Math.abs(Math.hypot(C[0] - P[0], C[1] - P[1]) - c.r * X.s); if (dd < bd) { bd = dd; best = { view: v.id, circle: c }; } }
  }
  return best;
}
function viewAt(P) {
  for (const v of [...dw().views].reverse()) { const d = dwData[v.kind]; if (!d) continue; const s = dw().scale, m = 3, [vx, vy] = viewPos(v); if (Math.abs(P[0] - vx) <= s * d.w / 2 + m && Math.abs(P[1] - vy) <= s * d.h / 2 + m) return v; }
  return null;
}
function wireSheet() {
  sheetSvg.addEventListener('wheel', e => {
    e.preventDefault(); const P = sheetPoint(e), k = Math.exp(e.deltaY * 0.0015);
    const w = Math.min(4000, Math.max(20, dwCam.w * k)), f = w / dwCam.w;
    dwCam = { x: P[0] - (P[0] - dwCam.x) * f, y: P[1] - (P[1] - dwCam.y) * f, w, h: dwCam.h * f }; renderSheet();
  }, { passive: false });
  let drag = null;
  sheetSvg.addEventListener('pointerdown', e => {
    const P = sheetPoint(e);
    if (e.button === 1 || (e.button === 0 && !dwTool && !viewAt(P) && !e.target.closest('[data-tag^="d:"]'))) { drag = { pan: true, x: e.clientX, y: e.clientY, cam: { ...dwCam } }; sheetSvg.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    if (dwTool) return;                                  // tools act on click (pointerup)
    const dimTag = e.target.closest('[data-tag^="d:"]')?.getAttribute('data-tag');
    if (dimTag) { const m = dw().dims.find(x => x.id === dimTag.slice(2)); dwSel = { type: 'dim', id: m.id }; drag = { dim: m, start: P, at0: [...dimGeom(m).at], moved: false }; sheetSvg.setPointerCapture(e.pointerId); renderSheet(); return; }
    const v = viewAt(P);
    if (v) { dwSel = { type: 'view', id: v.id }; drag = { view: v, start: P, x0: v.x, y0: v.y, g0: v.gap ?? 18, moved: false }; sheetSvg.setPointerCapture(e.pointerId); renderSheet(); }
  });
  sheetSvg.addEventListener('pointermove', e => {
    const P = sheetPoint(e); dwCursor = P;
    if (drag?.pan) { const k = pxToMm(); dwCam = { ...drag.cam, x: drag.cam.x - (e.clientX - drag.x) * k, y: drag.cam.y - (e.clientY - drag.y) * k }; renderSheet(); return; }
    if (drag?.view) {
      if (!drag.moved) { checkpoint(); drag.moved = true; dw().auto = false; }
      const v = drag.view, dx = P[0] - drag.start[0], dy = P[1] - drag.start[1];
      if (v.parent && viewById(v.parent)) v.gap = Math.max(2, drag.g0 + (v.dir === 'right' ? dx : v.dir === 'left' ? -dx : v.dir === 'down' ? dy : -dy));
      else { v.x = drag.x0 + dx; v.y = drag.y0 + dy; }
      renderSheet(); return;
    }
    if (drag?.dim) {
      if (!drag.moved) { checkpoint(); drag.moved = true; }
      const m = drag.dim, s = dw().scale, at = [drag.at0[0] + (P[0] - drag.start[0]) / s, drag.at0[1] + (P[1] - drag.start[1]) / s], c = dimMid(dimGeom({ ...m, ao: null }));
      m.at = at; m.ao = [at[0] - c[0], at[1] - c[1]];
      renderSheet(); return;
    }
    if (dwTool === 'dim') { dwHover = dwDraft?.p2 ? null : nearestSnap(P, dwDraft?.view); renderSheet(); }
    else if (dwTool === 'dia') { dwHover = dwDraft ? null : nearestCircle(P); renderSheet(); }
  });
  sheetSvg.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    if (d) { if (d.moved) persist(); return; }
    if (e.button !== 0) return;
    const P = sheetPoint(e);
    if (dwTool === 'dim') {
      if (!dwDraft) { const s = nearestSnap(P); if (s) dwDraft = { view: s.view, p1: s.p }; }
      else if (!dwDraft.p2) { const s = nearestSnap(P, dwDraft.view); if (s && Math.hypot(s.p[0] - dwDraft.p1[0], s.p[1] - dwDraft.p1[1]) > 1e-6) dwDraft.p2 = s.p; else if (!s) toast('Click a point on the same view'); }
      else {
        const v = viewById(dwDraft.view), at = viewXf(v).toLocal(P);
        const dd = dwData[v.kind];
        const mid = [(dwDraft.p1[0] + dwDraft.p2[0]) / 2, (dwDraft.p1[1] + dwDraft.p2[1]) / 2];
        checkpoint(); dw().dims.push({ id: uid(), view: dwDraft.view, p1: dwDraft.p1, p2: dwDraft.p2, n1: normPt(dd, dwDraft.p1), n2: normPt(dd, dwDraft.p2), kind: dimKind(dwDraft.p1, dwDraft.p2, at), at, ao: [at[0] - mid[0], at[1] - mid[1]] }); persist();
        dwDraft = null;
      }
      dwHover = null; renderSheet(); defaultHint(); return;
    }
    if (dwTool === 'dia') {
      if (!dwDraft) { const c = nearestCircle(P); if (c) dwDraft = { view: c.view, circle: c.circle }; }
      else { const v = viewById(dwDraft.view), at = viewXf(v).toLocal(P); checkpoint(); dw().dims.push({ id: uid(), view: dwDraft.view, kind: 'd', c: dwDraft.circle.c, r: dwDraft.circle.r, nc: normPt(dwData[v.kind], dwDraft.circle.c), at, ao: [at[0] - dwDraft.circle.c[0], at[1] - dwDraft.circle.c[1]] }); persist(); dwDraft = null; }
      dwHover = null; renderSheet(); defaultHint(); return;
    }
    if (dwTool?.startsWith('place:')) { checkpoint(); const kind = dwTool.slice(6); dw().views.push({ id: uid(), kind, x: P[0], y: P[1], hidden: kind !== 'iso' }); persist(); dwTool = null; renderRibbon(); dwRefresh().then(renderSheet); defaultHint(); return; }
    if (!d && !dwTool) { dwSel = null; renderSheet(); }
  });
  window.addEventListener('keydown', e => {
    if (workspace !== 'drawing' || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    if (e.ctrlKey || e.metaKey) return;                  // undo/redo and the like stay global
    const k = e.key;
    e.stopImmediatePropagation();
    if (k === 'Escape') { if (dwDraft) dwDraft = null; else if (dwTool) dwTool = null; else dwSel = null; dwHover = null; renderRibbon(); renderSheet(); defaultHint(); }
    else if ((k === 'Delete' || k === 'Backspace') && dwSel) dwDeleteSel();
    else if (k === 'd' || k === 'D') dwSetTool('dim');
    else if (k === 'f' || k === 'F') { dwFit(); renderSheet(); }
  }, true);
  window.addEventListener('resize', () => { if (workspace === 'drawing') { dwFit(); renderSheet(); } });
}
function dwSetTool(t) { if (workspace !== 'drawing') return; dwTool = dwTool === t ? null : t; dwDraft = null; dwHover = null; renderRibbon(); renderSheet(); defaultHint(); }
function dwDeleteSel() {
  checkpoint();
  if (dwSel.type === 'dim') dw().dims = dw().dims.filter(m => m.id !== dwSel.id);
  else {
    for (const c of dw().views) if (c.parent === dwSel.id) { const [x, y] = viewPos(c); c.x = x; c.y = y; delete c.parent; }
    dw().views = dw().views.filter(v => v.id !== dwSel.id); dw().dims = dw().dims.filter(m => m.view !== dwSel.id);
  }
  dwSel = null; persist(); renderSheet();
}
function dwStandardViews() {
  const L = standardLayout(); if (!L) return;
  const had = dw().views.length;
  checkpoint(); Object.assign(dw(), { scale: L.scale, views: L.views, dims: [], auto: true }); persist(); renderSheet();
  if (had) toast('Standard views laid out. Undo brings the previous layout back.');
}
function dwToggleHidden() {
  const v = dwSel?.type === 'view' && viewById(dwSel.id); if (!v) { toast('Select a view first'); return; }
  checkpoint(); v.hidden = !v.hidden; persist(); renderSheet();
}
function dwSheetDialog() {
  const D = dw(), t = D.title || (D.title = {});
  const before = JSON.stringify(D);
  openPanelDialog({ title: 'Sheet & Title Block', icon: 'properties', okLabel: 'OK', help: 'Scale applies to every view; dimensions always show true model sizes.',
    body: () => {
      const sel = (id, opts, val, on) => { const s = h('select', { id }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l))); s.addEventListener('change', () => on(s.value)); return s; };
      const txt = (id, key, label) => { const i = h('input', { type: 'text', id, value: t[key] || '', autocomplete: 'off' }); i.addEventListener('input', () => { t[key] = i.value; renderSheet(); }); return h('div', { class: 'row' }, h('label', { class: 'rl', for: id }, label), i); };
      return [section_('Sheet',
        h('div', { class: 'row' }, h('label', { class: 'rl', for: 'dw-size' }, 'Size'), sel('dw-size', Object.keys(SHEETS).map(k => [k, k + ' landscape']), D.sheet, v => { D.sheet = v; dwFit(); renderSheet(); })),
        h('div', { class: 'row' }, h('label', { class: 'rl', for: 'dw-scale' }, 'Scale'), sel('dw-scale', SCALES.map(s => [s, scaleLabel(s)]), D.scale, v => {
          const s0 = D.scale, s1 = +v, [W, H] = sheetSize();      // keep views spread around the sheet centre
          for (const vw of D.views) { vw.x = W / 2 + (vw.x - W / 2) * s1 / s0; vw.y = H / 2 + (vw.y - H / 2) * s1 / s0; }
          D.scale = s1; D.auto = false; renderSheet(); }))),
        section_('Title block', txt('dw-author', 'author', 'Drawn by'), txt('dw-part', 'partNo', 'Part no.'), txt('dw-mat', 'material', 'Material'), txt('dw-date', 'date', 'Date'))];
    },
    onOK: () => { if (JSON.stringify(dw()) !== before) { const now = JSON.stringify(dw()); doc.drawing = JSON.parse(before); checkpoint(); doc.drawing = JSON.parse(now); persist(); } renderSheet(); },
    onCancel: () => { doc.drawing = JSON.parse(before); renderSheet(); },
  });
}

// ---------- PDF ----------
function drawingPDF() {
  const [W, H] = sheetSize(), k = 72 / 25.4, L = displayList();
  const X = x => (x * k).toFixed(3), Y = y => ((H - y) * k).toFixed(3);
  const enc = s => { let o = ''; for (const ch of s) { const c = ch.charCodeAt(0); if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch; else if (ch === '—') o += '\\227'; else if (c < 128) o += ch; else if (c >= 160 && c <= 255) o += '\\' + c.toString(8); else o += '?'; } return o; };   // WinAnsi matches Latin-1 for 160–255
  let cs = '1 J 1 j 0 G 0 g\n';
  for (const it of L) {
    if (it.t === 'path') {
      cs += `${(it.w * k).toFixed(3)} w ${it.dash ? `[${it.dash.map(v => (v * k).toFixed(2)).join(' ')}] 0 d` : '[] 0 d'}\n`;
      for (const s of parsePath(it.d).segs) {
        if (s[0] === 'M') cs += `${X(s[1])} ${Y(s[2])} m\n`; else if (s[0] === 'L') cs += `${X(s[1])} ${Y(s[2])} l\n`;
        else if (s[0] === 'C') cs += `${X(s[1])} ${Y(s[2])} ${X(s[3])} ${Y(s[4])} ${X(s[5])} ${Y(s[6])} c\n`; else cs += 'h\n';
      }
      cs += it.fill ? 'b\n' : 'S\n';
    } else {
      const size = it.size * k, wEst = it.s.length * it.size * 0.55, sh = it.anchor === 'middle' ? -wEst / 2 : it.anchor === 'end' ? -wEst : 0;
      const a = -it.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
      const ox = it.x + sh * Math.cos(it.rot * Math.PI / 180), oy = it.y + sh * Math.sin(it.rot * Math.PI / 180);
      cs += `BT /${it.bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${c.toFixed(5)} ${sn.toFixed(5)} ${(-sn).toFixed(5)} ${c.toFixed(5)} ${X(ox)} ${Y(oy)} Tm (${enc(it.s)}) Tj ET\n`;
    }
  }
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(W * k).toFixed(2)} ${(H * k).toFixed(2)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${cs.length} >>\nstream\n${cs}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${enc(doc.name || 'Drawing')}) /Producer (Draftwork) >>`,
  ];
  let out = '%PDF-1.4\n', offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Uint8Array.from(out, ch => ch.charCodeAt(0) & 255);
}
function drawingSVG() {
  const [W, H] = sheetSize();
  const body = displayList().map(it => it.t === 'path' ? `<path d="${it.d}" fill="${it.fill ? '#000' : 'none'}" stroke="#000" stroke-width="${it.w}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`
    : `<text x="${it.x}" y="${it.y}" font-family="Helvetica, Arial, sans-serif" font-size="${it.size}"${it.bold ? ' font-weight="bold"' : ''} text-anchor="${it.anchor}"${it.rot ? ` transform="rotate(${it.rot} ${it.x} ${it.y})"` : ''}>${it.s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n<rect width="${W}" height="${H}" fill="#fff"/>\n${body}\n</svg>\n`;
}
function exportDrawing() {
  const name = slug() + '-drawing';
  saveFile(name + '.zip', makeZip([{ name: name + '.pdf', data: drawingPDF() }, { name: name + '.svg', data: drawingSVG() }]), 'application/zip');
}
