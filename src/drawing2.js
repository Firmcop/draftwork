// ===== Drawing extras: detail views, balloons, notes, tolerances, several sheets, multi-page PDF, DXF =====
const circleD = (cx, cy, r) => `M${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}Z`;
// keep the parts of a path inside a circle (curves are flattened)
function clipD(d, c) {
  const segs = parsePath(d).segs, out = []; let cur = null, start = null;
  const inside = p => Math.hypot(p[0] - c.cx, p[1] - c.cy) <= c.r;
  const cross = (a, b) => {   // parameters where segment a-b meets the circle
    const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - c.cx, fy = a[1] - c.cy, A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.r * c.r, D = B * B - 4 * A * C;
    if (A < 1e-18 || D < 0) return []; const s = Math.sqrt(D); return [(-B - s) / (2 * A), (-B + s) / (2 * A)].filter(t => t > 0 && t < 1);
  };
  const lineTo = (a, b) => {
    const ts = [0, ...cross(a, b), 1], P = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 0; i + 1 < ts.length; i++) { const m = P((ts[i] + ts[i + 1]) / 2); if (!inside(m)) continue; const p = P(ts[i]), q = P(ts[i + 1]); out.push(`M${p[0].toFixed(3)} ${p[1].toFixed(3)}L${q[0].toFixed(3)} ${q[1].toFixed(3)}`); }
  };
  for (const s of segs) {
    if (s[0] === 'M') { cur = [s[1], s[2]]; start = cur; }
    else if (s[0] === 'L') { const p = [s[1], s[2]]; lineTo(cur, p); cur = p; }
    else if (s[0] === 'C') { const p0 = cur; let prev = p0; for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t, p = [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * s[1 + k] + 3 * u * t * t * s[3 + k] + t * t * t * s[5 + k]); lineTo(prev, p); prev = p; } cur = [s[5], s[6]]; }
    else if (s[0] === 'Z' && start) { lineTo(cur, start); cur = start; }
  }
  return out.join('');
}
// ---- dimension text: value, precision, tolerance, override ----
function dwDimLabel(m) {
  const v = m.kind === 'ang' ? dimValue(m) : dimValue(m) / UNIT_DEFS[docUnit()][0], pre = m.kind === 'd' ? 'Ø' : m.kind === 'r' ? 'R' : '', post = m.kind === 'ang' ? '°' : '';
  const f = x => m.prec != null && m.prec !== '' ? (+x).toFixed(+m.prec) : fmtDim(x);
  const t = m.tol || {}, plus = +t.plus || 0, minus = +t.minus || 0;
  let s = pre + f(v) + post;
  if (t.kind === 'sym') s += ' ±' + f(plus);
  else if (t.kind === 'dev') s += ` +${f(plus)}/-${f(minus)}`;
  else if (t.kind === 'limits') s = pre + f(v + plus) + '/' + f(v - minus) + post;
  if (m.text) s = String(m.text).replace(/<>/g, s);
  return s;
}
function dimEditDialog(id) {
  const m = dw().dims.find(x => x.id === id); if (!m) return;
  const before = JSON.stringify(m), t = m.tol || (m.tol = { kind: 'none', plus: 0.1, minus: 0.1 });
  const live = () => renderSheet();
  openPanelDialog({ title: 'Dimension', icon: 'dimension', okLabel: 'OK', help: 'Tolerances print after the value. Use <> in the text to place the measured value.',
    body: () => [
      section_('Value', h('p', { class: 'note' }, 'Measured: ' + fmtDim(dimValue(m))), exField('Decimals (blank = auto)', m, 'prec', '', { min: 0, max: 6, after: live }),
        row('Text', (() => { const i = h('input', { type: 'text', id: 'dd-text', value: m.text || '', placeholder: '<>', autocomplete: 'off' }); i.addEventListener('input', () => { m.text = i.value; live(); }); i.addEventListener('keydown', ev => ev.stopPropagation()); return i; })(), 'dd-text')),
      section_('Tolerance', segField('Type', t, 'kind', [['none', 'None'], ['sym', '±'], ['dev', '+/−'], ['limits', 'Limits'], ['basic', 'Basic']], { rerender: true, after: live }),
        t.kind === 'sym' ? exField('Tolerance', t, 'plus', '', { min: 0, after: live, id: 'dd-plus' }) : null,
        t.kind === 'dev' || t.kind === 'limits' ? exField('Upper', t, 'plus', '', { after: live, id: 'dd-plus' }) : null,
        t.kind === 'dev' || t.kind === 'limits' ? exField('Lower', t, 'minus', '', { after: live, id: 'dd-minus' }) : null),
    ],
    onOK: () => { const now = JSON.stringify(m); if (now !== before) { Object.assign(m, JSON.parse(before)); checkpoint(); Object.assign(m, JSON.parse(now)); persist(); } renderSheet(); },
    onCancel: () => { for (const k of Object.keys(m)) delete m[k]; Object.assign(m, JSON.parse(before)); renderSheet(); },
  });
}
// ---- balloons: item numbers of the parts list, attached to a part on a view ----
function partItemOf(bodyId) {
  const rows = partsRows(), c = compOfBody(bodyId), name = c ? c.name : bodyName(bodyId), mat = bodyMaterial(c ? c.bodies.find(id => result.bodies.has(id)) || bodyId : bodyId);
  const i = rows.findIndex(r => r[0] === name && r[2] === mat); return i >= 0 ? i + 1 : null;
}
function bodyAtView(v, p) {
  const d = dwData[vk(v)]; if (!d?.boxes?.length) return null;
  let best = null, ba = Infinity;
  for (const b of d.boxes) { const [x0, y0, x1, y1] = b.b; if (p[0] >= x0 - 0.5 && p[0] <= x1 + 0.5 && p[1] >= y0 - 0.5 && p[1] <= y1 + 0.5) { const a = (x1 - x0) * (y1 - y0); if (a < ba) { ba = a; best = b.id; } } }
  return best;
}
function balloonItems(b, path, text) {
  const v = viewById(b.view); if (!v || !dwData[vk(v)]) return;
  const X = viewXf(v), P = X.toSheet(b.p), C = X.toSheet(b.at), r = 4, tag = 'b:' + b.id, n = partItemOf(b.body) ?? '?';
  const l = Math.hypot(C[0] - P[0], C[1] - P[1]) || 1, E = [C[0] - (C[0] - P[0]) / l * r, C[1] - (C[1] - P[1]) / l * r];
  path(`M${P[0]} ${P[1]}L${E[0]} ${E[1]}`, { w: 0.18, tag });
  path(circleD(P[0], P[1], 0.6), { w: 0.1, fill: true, tag });
  path(circleD(C[0], C[1], r), { w: 0.3, tag });
  text(C[0], C[1] + 1.3, String(n), 3.6, { anchor: 'middle', bold: true, tag });
}
// ---- notes: free text, optionally with a leader arrow ----
function noteItems(nt, path, text) {
  const tag = 'n:' + nt.id, size = +nt.size || 3, lines = String(nt.text || '').split('\n');
  lines.forEach((ln, i) => text(nt.at[0], nt.at[1] + i * size * 1.35, ln, size, { tag }));
  if (nt.p) {
    const w = Math.max(...lines.map(s => s.length)) * size * 0.55, E = [nt.at[0] + (nt.p[0] > nt.at[0] + w / 2 ? w + 1 : -1), nt.at[1] - size * 0.35];
    path(`M${E[0]} ${E[1]}L${nt.p[0]} ${nt.p[1]}`, { w: 0.18, tag }); arrowAt(path, nt.p, [nt.p[0] - E[0], nt.p[1] - E[1]], tag);
  }
}
function noteEditDialog(id, isNew = false) {
  const nt = (dw().notes || []).find(x => x.id === id); if (!nt) return;
  const before = JSON.stringify(nt);
  const ta = h('textarea', { id: 'dn-text', rows: 4, style: 'width:100%;font:inherit' }); ta.value = nt.text || '';
  ta.addEventListener('input', () => { nt.text = ta.value; renderSheet(); }); ta.addEventListener('keydown', ev => ev.stopPropagation());
  openPanelDialog({ title: 'Note', icon: 'text', okLabel: 'OK', help: 'Notes print on the sheet; drag them to move.',
    body: () => [section_('Text', ta, exField('Height', nt, 'size', 'mm', { min: 1, max: 20, after: renderSheet }))],
    onOK: () => { if (!String(nt.text).trim()) dw().notes = dw().notes.filter(x => x !== nt); persist(); renderSheet(); defaultHint(); },
    onCancel: () => { if (isNew) dw().notes = dw().notes.filter(x => x !== nt); else Object.assign(nt, JSON.parse(before)); renderSheet(); defaultHint(); },
  });
  setTimeout(() => { ta.focus(); ta.select(); }, 30);
}
// ---- the three new sheet tools ----
function drawTool2Click(P, e) {
  const D = dw();
  if (dwTool === 'detail') {
    if (!dwDraft) { const v = viewAt(P); if (!v || v.kind === 'detail') { toast('Click inside a view'); return; } dwDraft = { view: v.id, c: viewXf(v).toLocal(P) }; }
    else if (!dwDraft.r) { const v = viewById(dwDraft.view), X = viewXf(v), C = X.toSheet(dwDraft.c); dwDraft.r = Math.max(1, Math.hypot(P[0] - C[0], P[1] - C[1])) / X.s; }
    else {
      const label = String.fromCharCode(65 + D.views.filter(w => w.kind === 'section' || w.kind === 'detail').length);
      checkpoint(); D.views.push({ id: uid(), kind: 'detail', of: dwDraft.view, c: dwDraft.c, r: dwDraft.r, k: 2, label, x: P[0], y: P[1], hidden: false });
      persist(); dwDraft = null; dwTool = null; renderRibbon();
    }
  } else if (dwTool === 'balloon') {
    if (!dwDraft) {
      const v = viewAt(P); if (!v) { toast('Click a part on a view'); return; }
      if (v.kind === 'iso') { toast('Balloons go on front, top, side or detail views'); return; }
      const sn = nearestSnap(P, v.id), p = sn ? sn.p : viewXf(v).toLocal(P), body = bodyAtView(v, p);
      if (!body) { toast('No part there'); return; }
      dwDraft = { view: v.id, p, body };
    } else {
      const v = viewById(dwDraft.view);
      checkpoint(); (D.balloons ||= []).push({ id: uid(), view: dwDraft.view, p: dwDraft.p, at: viewXf(v).toLocal(P), body: dwDraft.body }); persist(); dwDraft = null;
    }
  } else if (dwTool === 'note') {
    if (!dwDraft && !e.shiftKey) { const sn = nearestSnap(P); dwDraft = { p: sn ? sn.P : P }; }
    else {
      const id = uid(); checkpoint(); (D.notes ||= []).push({ id, at: P, p: dwDraft?.p || null, text: 'NOTE', size: 3 }); persist();
      dwDraft = null; dwTool = null; renderRibbon(); renderSheet(); noteEditDialog(id, true); return;
    }
  }
  dwHover = null; renderSheet(); defaultHint();
}
// ---- sheets ----
function renderSheetTabs() {
  if (!sheetEl) return;
  let bar = sheetEl.querySelector('.sheettabs');
  if (!bar) { bar = h('div', { class: 'sheettabs', role: 'tablist', 'aria-label': 'Sheets' }); sheetEl.append(bar); }
  const R = doc.drawing; if (!R) { bar.replaceChildren(); return; }
  dw();   // migrate old drawings
  bar.replaceChildren(...doc.drawing.sheets.map(s => h('button', { class: 'stab', role: 'tab', 'aria-selected': String(s.id === doc.drawing.active), onclick: () => switchSheet(s.id), ondblclick: () => dwSheetDialog() }, s.name || 'Sheet')),
    h('button', { class: 'stab add', 'aria-label': 'New sheet', title: 'New sheet', onclick: () => addSheet() }, '+'));
}
async function switchSheet(id) {
  if (doc.drawing.active === id) return;
  doc.drawing.active = id; dwSel = null; dwDraft = null; dwTool = null;
  await dwRefresh(); renderSheetTabs(); renderRibbon(); renderSheet(); persist();
}
async function addSheet() {
  checkpoint();
  const R = doc.drawing, cur = dw(), s = { id: uid(), name: 'Sheet ' + (R.sheets.length + 1), sheet: cur.sheet, scale: cur.scale, views: [], dims: [], notes: [], balloons: [], auto: false, title: { ...(cur.title || {}) } };
  R.sheets.push(s); R.active = s.id; persist();
  await dwRefresh(); renderSheetTabs(); renderSheet();
  toast('New sheet: place views from the ribbon (Base views or Standard Views)');
}
function deleteSheet() {
  const R = doc.drawing; if (!R || R.sheets.length < 2) { toast('A drawing keeps at least one sheet'); return; }
  checkpoint(); const i = R.sheets.findIndex(s => s.id === R.active); R.sheets.splice(i, 1); R.active = R.sheets[Math.max(0, i - 1)].id; persist();
  renderSheetTabs(); renderSheet();
}
// ---- export: every sheet as a PDF page, plus SVG and DXF per sheet ----
function pdfPage(L, W, H) {
  const k = 72 / 25.4, X = x => (x * k).toFixed(3), Y = y => ((H - y) * k).toFixed(3);
  const enc = s => { let o = ''; for (const ch of s) { const c = ch.charCodeAt(0); if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch; else if (ch === '—') o += '\\227'; else if (c < 128) o += ch; else if (c >= 160 && c <= 255) o += '\\' + c.toString(8); else o += '?'; } return o; };
  let cs = '1 J 1 j 0 G 0 g\n';
  const segsOut = sg => { let o = ''; for (const s2 of sg) { if (s2[0] === 'M') o += `${X(s2[1])} ${Y(s2[2])} m\n`; else if (s2[0] === 'L') o += `${X(s2[1])} ${Y(s2[2])} l\n`; else if (s2[0] === 'C') o += `${X(s2[1])} ${Y(s2[2])} ${X(s2[3])} ${Y(s2[4])} ${X(s2[5])} ${Y(s2[6])} c\n`; else o += 'h\n'; } return o; };
  for (const it of L) {
    if (it.t === 'hatch') {
      const sg = parsePath(it.d).segs; let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const s2 of sg) for (let q = 1; q < s2.length; q += 2) { bx0 = Math.min(bx0, s2[q]); bx1 = Math.max(bx1, s2[q]); by0 = Math.min(by0, s2[q + 1]); by1 = Math.max(by1, s2[q + 1]); }
      cs += 'q\n' + segsOut(sg) + `W* n ${(0.18 * k).toFixed(3)} w [] 0 d\n`;
      const sp = 2.5 * Math.SQRT2;
      for (let c0 = bx0 + by0 - (by1 - by0) - sp; c0 <= bx1 + by1 + sp; c0 += sp) cs += `${X(c0 - by0)} ${Y(by0)} m ${X(c0 - by1)} ${Y(by1)} l\n`;
      cs += 'S Q\n';
    } else if (it.t === 'path') {
      cs += `${(it.w * k).toFixed(3)} w ${it.dash ? `[${it.dash.map(v => (v * k).toFixed(2)).join(' ')}] 0 d` : '[] 0 d'}\n` + segsOut(parsePath(it.d).segs) + (it.fill ? 'b\n' : 'S\n');
    } else {
      const size = it.size * k, wEst = it.s.length * it.size * 0.55, sh = it.anchor === 'middle' ? -wEst / 2 : it.anchor === 'end' ? -wEst : 0;
      const a = -it.rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), ox = it.x + sh * Math.cos(it.rot * Math.PI / 180), oy = it.y + sh * Math.sin(it.rot * Math.PI / 180);
      cs += `BT /${it.bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${c.toFixed(5)} ${sn.toFixed(5)} ${(-sn).toFixed(5)} ${c.toFixed(5)} ${X(ox)} ${Y(oy)} Tm (${enc(it.s)}) Tj ET\n`;
    }
  }
  return { cs, W: W * k, H: H * k, enc };
}
function multiPagePDF(pages) {
  const enc = pages[0].enc, n = pages.length;
  // 1 catalog, 2 pages, 3 font F1, 4 font F2, 5 info, then page/content pairs
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${enc(doc.name || 'Drawing')}) /Producer (Draftwork) >>`];
  pages.forEach((p, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.W.toFixed(2)} ${p.H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + 2 * i} 0 R >>`);
    objs.push(`<< /Length ${p.cs.length} >>\nstream\n${p.cs}endstream`);
  });
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Uint8Array.from(out, ch => ch.charCodeAt(0) & 255);
}
function sheetDXF(L) {
  const o = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'], H = sheetSize()[1];
  const line = (a, b) => o.push('0', 'LINE', '8', '0', '10', a[0].toFixed(4), '20', (H - a[1]).toFixed(4), '11', b[0].toFixed(4), '21', (H - b[1]).toFixed(4));
  for (const it of L) {
    if (it.t === 'path') { let cur = null, st = null; for (const s of parsePath(it.d).segs) { if (s[0] === 'M') { cur = [s[1], s[2]]; st = cur; } else if (s[0] === 'L') { const p = [s[1], s[2]]; line(cur, p); cur = p; } else if (s[0] === 'C') { let prev = cur; for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t, p = [0, 1].map(k => u * u * u * cur[k] + 3 * u * u * t * s[1 + k] + 3 * u * t * t * s[3 + k] + t * t * t * s[5 + k]); line(prev, p); prev = p; } cur = [s[5], s[6]]; } else if (s[0] === 'Z' && st) { line(cur, st); cur = st; } } }
    else if (it.t === 'text') o.push('0', 'TEXT', '8', 'TEXT', '10', it.x.toFixed(4), '20', (H - it.y).toFixed(4), '40', it.size.toFixed(3), '1', it.s, '50', String(-it.rot || 0), '72', it.anchor === 'middle' ? '1' : it.anchor === 'end' ? '2' : '0', '11', it.x.toFixed(4), '21', (H - it.y).toFixed(4));
  }
  o.push('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n') + '\n';
}
async function exportDrawingAll() {
  const R = doc.drawing, keep = R.active, pages = [], files = [], base = slug() + '-drawing';
  await dwRefresh();
  for (const s of R.sheets) {
    R.active = s.id;
    const [W, H] = sheetSize(), L = displayList();
    pages.push(pdfPage(L, W, H));
    const nm = R.sheets.length > 1 ? `${base}-${(s.name || 'sheet').replace(/\W+/g, '_')}` : base;
    files.push({ name: nm + '.svg', data: drawingSVG() }, { name: nm + '.dxf', data: sheetDXF(L) });
  }
  R.active = keep;
  saveFile(base + '.zip', makeZip([{ name: base + '.pdf', data: multiPagePDF(pages) }, ...files]), 'application/zip');
}
