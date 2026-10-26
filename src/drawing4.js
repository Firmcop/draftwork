// ===== Drawing annotations for manufacturing (DrawingAnnotation): GD&T feature control frames, datum feature symbols,
// surface finish (ISO 1302) and welding symbols (ISO 2553 style), plus automated drawing checks =====
// Symbols are sheet objects (D.symbols) with a position `at` and an optional leader point `p`, in sheet millimetres.
// Every glyph is drawn as vector paths so the PDF, SVG and DXF carry it exactly. Values come only from the user:
// an empty tolerance prints "?" and the drawing check reports it.

const GDT = {
  straightness: { label: 'Straightness', datum: 'no' }, flatness: { label: 'Flatness', datum: 'no' }, circularity: { label: 'Circularity', datum: 'no' },
  cylindricity: { label: 'Cylindricity', datum: 'no' }, profileLine: { label: 'Profile of a line', datum: 'opt' }, profileSurface: { label: 'Profile of a surface', datum: 'opt' },
  perpendicularity: { label: 'Perpendicularity', datum: 'yes' }, angularity: { label: 'Angularity', datum: 'yes' }, parallelism: { label: 'Parallelism', datum: 'yes' },
  position: { label: 'Position', datum: 'opt' }, concentricity: { label: 'Concentricity', datum: 'yes' }, symmetry: { label: 'Symmetry', datum: 'yes' },
  runout: { label: 'Circular runout', datum: 'yes' }, totalRunout: { label: 'Total runout', datum: 'yes' },
};
const WELDS = { fillet: 'Fillet', square: 'Square butt', v: 'V butt', bevel: 'Bevel butt', plug: 'Plug / slot' };
const FINISH = { any: 'Any process', removal: 'Material removal required', noRemoval: 'Material removal not permitted' };
const symList = () => dw().symbols || (dw().symbols = []);

// characteristic glyph centred at (x, y) in a cell about 5 mm high
function gdtGlyph(path, k, x, y, tag) {
  const w = 0.25, P = d => path(d, { w, tag }), C = (cx, cy, r) => `M${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}Z`;
  switch (k) {
    case 'straightness': P(`M${x - 1.8} ${y}H${x + 1.8}`); break;
    case 'flatness': P(`M${x - 1.6} ${y + 1}L${x - 0.6} ${y - 1}H${x + 1.8}L${x + 0.8} ${y + 1}Z`); break;
    case 'circularity': P(C(x, y, 1.6)); break;
    case 'cylindricity': P(C(x, y, 1.2)); P(`M${x - 2} ${y + 1.6}L${x - 0.5} ${y - 1.6}M${x + 0.5} ${y + 1.6}L${x + 2} ${y - 1.6}`); break;
    case 'profileLine': P(`M${x - 1.8} ${y + 1}A1.8 1.8 0 0 1 ${x + 1.8} ${y + 1}`); break;
    case 'profileSurface': P(`M${x - 1.8} ${y + 1}A1.8 1.8 0 0 1 ${x + 1.8} ${y + 1}Z`); break;
    case 'perpendicularity': P(`M${x - 1.8} ${y + 1.6}H${x + 1.8}M${x} ${y + 1.6}V${y - 1.8}`); break;
    case 'angularity': P(`M${x + 1.8} ${y + 1.6}H${x - 1.8}L${x + 1.4} ${y - 1.6}`); break;
    case 'parallelism': P(`M${x - 1.5} ${y + 1.6}L${x - 0.3} ${y - 1.6}M${x + 0.3} ${y + 1.6}L${x + 1.5} ${y - 1.6}`); break;
    case 'position': P(C(x, y, 1.2)); P(`M${x - 2} ${y}H${x + 2}M${x} ${y - 2}V${y + 2}`); break;
    case 'concentricity': P(C(x, y, 1.7)); P(C(x, y, 0.8)); break;
    case 'symmetry': P(`M${x - 1.8} ${y}H${x + 1.8}M${x - 1.1} ${y - 1.1}H${x + 1.1}M${x - 1.1} ${y + 1.1}H${x + 1.1}`); break;
    case 'runout': P(`M${x - 1.2} ${y + 1.6}L${x + 1} ${y - 1.4}`); path(`M${x + 1.5} ${y - 1.9}L${x + 0.25} ${y - 1.25}L${x + 1.05} ${y - 0.6}Z`, { w: 0.1, fill: true, tag }); break;
    case 'totalRunout': P(`M${x - 2} ${y + 1.6}H${x + 1.6}M${x - 1.8} ${y + 1.6}L${x - 0.4} ${y - 1.4}M${x - 0.2} ${y + 1.6}L${x + 1.2} ${y - 1.4}`);
      for (const ox of [-0.4, 1.2]) path(`M${x + ox + 0.5} ${y - 1.9}L${x + ox - 0.75} ${y - 1.25}L${x + ox + 0.05} ${y - 0.6}Z`, { w: 0.1, fill: true, tag }); break;
  }
}
const circled = (path, text, x, y, ch, tag) => { path(`M${x + 1.4} ${y}A1.4 1.4 0 1 0 ${x - 1.4} ${y}A1.4 1.4 0 1 0 ${x + 1.4} ${y}Z`, { w: 0.2, tag }); text(x, y + 0.75, ch, 2, { anchor: 'middle', tag }); };
const txtW = (s, size) => String(s).length * size * 0.58;
function leader(path, from, to, tag, arrow = true) {
  path(`M${from[0]} ${from[1]}L${to[0]} ${to[1]}`, { w: 0.18, tag });
  if (arrow) arrowAt(path, to, [to[0] - from[0], to[1] - from[1]], tag);
}
// the symbol's display items; returns its bounding box (for checks)
function symbolItems(s, path, text) {
  const tag = 's:' + s.id, [x, y] = s.at;
  if (s.type === 'fcf') {
    const h = 6, cells = [];
    cells.push({ w: 7, draw: cx => gdtGlyph(path, s.char, cx, y + h / 2, tag) });
    const tol = (s.dia ? 'Ø' : '') + (String(s.tol ?? '').trim() || '?');
    const tw = txtW(tol, 3) + (s.mod ? 3.6 : 0) + 3;
    cells.push({ w: tw, draw: cx => { text(cx - tw / 2 + 1.5, y + h / 2 + 1.1, tol, 3, { tag }); if (s.mod) circled(path, text, cx + tw / 2 - 2.2, y + h / 2, s.mod, tag); } });
    for (const dref of (s.datums || []).filter(d => d?.l)) {
      const dw2 = txtW(dref.l, 3) + (dref.mod ? 3.6 : 0) + 3;
      cells.push({ w: dw2, draw: cx => { text(cx - dw2 / 2 + 1.5, y + h / 2 + 1.1, dref.l, 3, { tag }); if (dref.mod) circled(path, text, cx + dw2 / 2 - 2.2, y + h / 2, dref.mod, tag); } });
    }
    const W = cells.reduce((a, c) => a + c.w, 0);
    path(`M${x} ${y}H${x + W}V${y + h}H${x}Z`, { w: 0.3, tag });
    let cx = x; for (const c of cells) { c.draw(cx + c.w / 2); cx += c.w; if (cx < x + W - 0.01) path(`M${cx} ${y}V${y + h}`, { w: 0.25, tag }); }
    if (s.p) leader(path, [s.p[0] < x ? x : s.p[0] > x + W ? x + W : x + W / 2, s.p[1] < y ? y : y + h].map((v, i) => i === 1 && s.p[1] >= y && s.p[1] <= y + h ? y + h / 2 : v), s.p, tag);
    return [x, y, x + W, y + h];
  }
  if (s.type === 'datum') {
    // letter in a square, joined to a filled triangle on the feature
    const b = 6, l = String(s.letter || '?');
    path(`M${x} ${y}H${x + b}V${y + b}H${x}Z`, { w: 0.3, tag }); text(x + b / 2, y + b / 2 + 1.2, l, 3.5, { anchor: 'middle', bold: true, tag });
    if (s.p) {
      const from = [x + b / 2, s.p[1] > y ? y + b : y], d = [s.p[0] - from[0], s.p[1] - from[1]], L = Math.hypot(...d) || 1, u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
      path(`M${from[0]} ${from[1]}L${s.p[0] - u[0] * 2.2} ${s.p[1] - u[1] * 2.2}`, { w: 0.18, tag });
      path(`M${s.p[0]} ${s.p[1]}L${s.p[0] - u[0] * 2.2 + n[0] * 1.5} ${s.p[1] - u[1] * 2.2 + n[1] * 1.5}L${s.p[0] - u[0] * 2.2 - n[0] * 1.5} ${s.p[1] - u[1] * 2.2 - n[1] * 1.5}Z`, { w: 0.1, fill: true, tag });
    }
    return [x, y, x + b, y + b];
  }
  if (s.type === 'finish') {
    // ISO 1302: short leg, long leg; bar = removal required, circle = removal not permitted; value above the extension
    const H = 6, v = [x, y + H * 0.45], b = [x + H * 0.32, y + H], t = [x + H * 0.95, y], ext = [x + H * 0.95 + 8 + txtW(s.ra ? 'Ra ' + s.ra : '', 2.6), y];
    path(`M${v[0]} ${v[1]}L${b[0]} ${b[1]}L${t[0]} ${t[1]}`, { w: 0.25, tag });
    if (s.process === 'removal') path(`M${v[0]} ${v[1]}H${x + H * 0.75}`, { w: 0.25, tag });
    if (s.process === 'noRemoval') path(`M${b[0] + 1.1} ${b[1] - 1.9}A1.05 1.05 0 1 0 ${b[0] - 1} ${b[1] - 1.9}A1.05 1.05 0 1 0 ${b[0] + 1.1} ${b[1] - 1.9}Z`, { w: 0.2, tag });
    if (s.ra || s.method) { path(`M${t[0]} ${t[1]}H${ext[0]}`, { w: 0.25, tag }); }
    if (s.ra) text(t[0] + 1, y - 1, 'Ra ' + s.ra, 2.6, { tag });
    if (s.method) text(t[0] + 1, y + 3.2, s.method, 2.2, { tag });
    if (s.p) leader(path, b, s.p, tag);
    return [x, y - 4, ext[0], y + H];
  }
  if (s.type === 'weld') {
    // reference line from the arrow; symbol below the line for the arrow side, above for the other side
    const L = 26, ref0 = [x, y], ref1 = [x + L, y];
    path(`M${ref0[0]} ${ref0[1]}H${ref1[0]}`, { w: 0.3, tag });
    path(`M${ref1[0]} ${ref1[1]}L${ref1[0] + 3} ${ref1[1] - 3}M${ref1[0]} ${ref1[1]}L${ref1[0] + 3} ${ref1[1] + 3}`, { w: 0.25, tag });   // tail
    if (s.p) leader(path, ref0, s.p, tag);
    if (s.allAround) path(`M${x + 1.5} ${y}A1.5 1.5 0 1 0 ${x - 1.5} ${y}A1.5 1.5 0 1 0 ${x + 1.5} ${y}Z`, { w: 0.25, tag });
    if (s.field) { path(`M${x} ${y}V${y - 6}`, { w: 0.25, tag }); path(`M${x} ${y - 6}L${x + 3.5} ${y - 5}L${x} ${y - 4}Z`, { w: 0.1, fill: true, tag }); }
    const sides = s.side === 'both' ? [1, -1] : [s.side === 'other' ? -1 : 1];
    const cx = x + 11;
    for (const sg of sides) {
      const Y = (dy) => y + sg * dy;
      switch (s.weld) {
        case 'fillet': path(`M${cx - 2} ${Y(0)}V${Y(4)}L${cx + 2} ${Y(0)}`, { w: 0.25, tag }); break;
        case 'square': path(`M${cx - 1} ${Y(0)}V${Y(3.5)}M${cx + 1} ${Y(0)}V${Y(3.5)}`, { w: 0.25, tag }); break;
        case 'v': path(`M${cx - 2.5} ${Y(4)}L${cx} ${Y(0)}L${cx + 2.5} ${Y(4)}`, { w: 0.25, tag }); break;
        case 'bevel': path(`M${cx - 1.5} ${Y(0)}V${Y(4)}M${cx - 1.5} ${Y(0)}L${cx + 2} ${Y(4)}`, { w: 0.25, tag }); break;
        case 'plug': path(`M${cx - 2.5} ${Y(0)}V${Y(2.5)}H${cx + 2.5}V${Y(0)}`, { w: 0.25, tag }); break;
      }
      const ty = sg > 0 ? y + 3.6 : y - 1.4;
      if (s.size) text(cx - 3, ty, String(s.size), 2.6, { anchor: 'end', tag });
      if (s.length) text(cx + 3, ty, String(s.length), 2.6, { tag });
    }
    if (s.note) text(ref1[0] + 4, y + 1, s.note, 2.4, { tag });
    return [x - 2, y - 7, ref1[0] + 4 + txtW(s.note || '', 2.4), y + 7];
  }
  return null;
}
// ---------- placing and editing ----------
function symbolToolClick(P, e) {
  const type = dwTool.slice(4);
  const needsLeader = type === 'datum' || type === 'weld';
  if (!dwDraft && !(e.shiftKey && !needsLeader)) { const sn = nearestSnap(P); dwDraft = { p: sn ? sn.P : P }; dwHover = null; renderSheet(); defaultHint(); return; }
  const s = { id: uid(), type, at: P, p: dwDraft?.p || null };
  if (type === 'fcf') Object.assign(s, { char: 'position', tol: '', dia: true, mod: '', datums: [{ l: 'A' }, { l: '' }, { l: '' }] });
  if (type === 'datum') s.letter = nextDatumLetter();
  if (type === 'finish') Object.assign(s, { process: 'removal', ra: '', method: '' });
  if (type === 'weld') Object.assign(s, { weld: 'fillet', side: 'arrow', size: '', length: '', allAround: false, field: false, note: '' });
  checkpoint(); symList().push(s); persist();
  dwDraft = null; dwTool = null; renderRibbon(); renderSheet();
  symbolEditDialog(s.id, true);
}
function nextDatumLetter() {
  const used = new Set(dwSheets().flatMap(sh => (sh.symbols || []).filter(x => x.type === 'datum').map(x => x.letter)));
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (l !== 'I' && l !== 'O' && l !== 'Q' && !used.has(l)) return l; }
  return '?';
}
function symbolEditDialog(id, isNew = false) {
  const s = symList().find(x => x.id === id); if (!s) return;
  const before = JSON.stringify(s);
  const sel = (sid, opts, val, on) => { const e2 = h('select', { id: sid }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l))); e2.addEventListener('change', () => { on(e2.value); renderSheet(); }); return e2; };
  const txt = (sid, key, label, o = {}) => { const i = h('input', { type: 'text', id: sid, value: s[key] ?? '', autocomplete: 'off', inputmode: o.num ? 'decimal' : 'text', style: o.w ? 'width:' + o.w : '' }); i.addEventListener('input', () => { s[key] = i.value; renderSheet(); }); i.addEventListener('keydown', ev => ev.stopPropagation()); return h('div', { class: 'row' }, h('label', { class: 'rl', for: sid }, label), i); };
  const chk = (sid, key, label) => { const c = h('input', { type: 'checkbox', id: sid, checked: !!s[key] }); c.addEventListener('change', () => { s[key] = c.checked; renderSheet(); }); return h('label', { class: 'chk', for: sid }, c, label); };
  const MODS = [['', 'None'], ['M', 'Ⓜ maximum material'], ['L', 'Ⓛ least material']];
  const titles = { fcf: 'Feature Control Frame', datum: 'Datum Feature', finish: 'Surface Finish', weld: 'Welding Symbol' };
  openPanelDialog({ title: titles[s.type], icon: 'pmi', okLabel: 'OK',
    help: s.type === 'fcf' ? 'Geometric tolerance. Enter the tolerance yourself: an empty value prints “?” and the drawing check reports it.' : s.type === 'weld' ? 'Arrow side welds go below the reference line, other side above. Size and length print beside the symbol.' : s.type === 'finish' ? 'ISO 1302 surface texture. Ra prints above the extension line.' : 'The letter is referenced by feature control frames.',
    body: () => {
      if (s.type === 'fcf') {
        const datumRow = i => { const dr = s.datums[i] ||= { l: '' }; const inp = h('input', { type: 'text', id: 'sy-d' + i, value: dr.l, maxlength: 2, style: 'width:44px', autocomplete: 'off', 'aria-label': 'Datum ' + (i + 1) });
          inp.addEventListener('input', () => { dr.l = inp.value.toUpperCase(); renderSheet(); }); inp.addEventListener('keydown', ev => ev.stopPropagation());
          return h('div', { class: 'row' }, h('label', { class: 'rl', for: 'sy-d' + i }, ['Primary', 'Secondary', 'Tertiary'][i] + ' datum'), h('div', { style: 'display:flex;gap:6px' }, inp, sel('sy-dm' + i, MODS, dr.mod || '', v => { dr.mod = v; }))); };
        return [section_('Tolerance', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'sy-char' }, 'Characteristic'), sel('sy-char', Object.entries(GDT).map(([k, v]) => [k, v.label]), s.char, v => { s.char = v; rerenderDialog(); })),
          txt('sy-tol', 'tol', 'Tolerance (mm)', { num: true, w: '90px' }), chk('sy-dia', 'dia', 'Diameter zone (Ø)'),
          h('div', { class: 'row' }, h('label', { class: 'rl', for: 'sy-mod' }, 'Material condition'), sel('sy-mod', MODS, s.mod || '', v => { s.mod = v; }))),
          section_('Datums' + (GDT[s.char]?.datum === 'yes' ? ' (required)' : GDT[s.char]?.datum === 'no' ? ' (none for form tolerances)' : ''), ...(GDT[s.char]?.datum === 'no' ? [] : [0, 1, 2].map(datumRow)))];
      }
      if (s.type === 'datum') return [section_('Datum', txt('sy-letter', 'letter', 'Letter', { w: '60px' }))];
      if (s.type === 'finish') return [section_('Surface', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'sy-proc' }, 'Process'), sel('sy-proc', Object.entries(FINISH), s.process, v => { s.process = v; })), txt('sy-ra', 'ra', 'Ra (µm)', { num: true, w: '90px' }), txt('sy-method', 'method', 'Method'))];
      return [section_('Weld', h('div', { class: 'row' }, h('label', { class: 'rl', for: 'sy-weld' }, 'Type'), sel('sy-weld', Object.entries(WELDS), s.weld, v => { s.weld = v; })),
        h('div', { class: 'row' }, h('label', { class: 'rl', for: 'sy-side' }, 'Side'), sel('sy-side', [['arrow', 'Arrow side'], ['other', 'Other side'], ['both', 'Both sides']], s.side, v => { s.side = v; })),
        txt('sy-size', 'size', 'Size', { w: '90px' }), txt('sy-len', 'length', 'Length', { w: '90px' }), chk('sy-all', 'allAround', 'All around'), chk('sy-field', 'field', 'Field weld'), txt('sy-note', 'note', 'Tail note'))];
    },
    onOK: () => { persist(); renderSheet(); defaultHint(); },
    onCancel: () => { if (isNew) dw().symbols = symList().filter(x => x !== s); else Object.assign(s, JSON.parse(before)); renderSheet(); defaultHint(); },
  });
}

// ---------- automated drawing checks ----------
// Each finding: { level: 'error' | 'warning' | 'info', msg, sheet, sel?: { type, id } }
function drawingChecks() {
  const R = doc.drawing; if (!R) return [];
  const out = [], act = R.active, add = (level, msg, sheet, sel) => out.push({ level, msg, sheet: sheet?.name || '', sheetId: sheet?.id, sel });
  if (dwStaleState) add('error', 'The drawing is out of date: the model changed after its last update. Use Update.', null);
  const datumsDefined = new Map();
  for (const s of R.sheets) for (const sy of s.symbols || []) if (sy.type === 'datum' && sy.letter) datumsDefined.set(sy.letter, (datumsDefined.get(sy.letter) || 0) + 1);
  for (const [l, n] of datumsDefined) if (n > 1) add('error', `Datum ${l} is defined ${n} times`, null);
  try {
    for (const s of R.sheets) {
      R.active = s.id;
      const [W, H] = sheetSize(), t = s.title || {};
      for (const [k, label] of [['drawingNo', 'drawing number'], ['partNo', 'part number'], ['revision', 'revision'], ['material', 'material'], ['author', 'drawn by']]) if (!String(t[k] || '').trim()) add('warning', `Title block: no ${label}`, s);
      if (!/^(Approved|Released)$/.test(t.approval || '')) add('info', 'Title block: not approved yet (' + (t.approval || 'Not approved') + ')', s);
      // views on the paper, clear of the title block and of each other
      const boxes = s.views.filter(v => dwData[vk(v)]).map(v => { const X = viewXf(v), d = dwData[vk(v)]; const w = v.brk ? brokenWidth(v, d) : d.w; return { v, b: v.kind === 'detail' && X.clip ? [X.clip.cx - X.clip.r, X.clip.cy - X.clip.r, X.clip.cx + X.clip.r, X.clip.cy + X.clip.r] : [X.x - X.s * w / 2, X.y - X.s * d.h / 2, X.x + X.s * w / 2, X.y + X.s * d.h / 2] }; });
      const tb = [W - 10 - TB.w, H - 10 - TB.h, W - 10, H - 10], hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
      const vname = v => (VIEW_KINDS[v.kind] || (v.kind === 'aux' ? 'Auxiliary' : v.kind[0].toUpperCase() + v.kind.slice(1))) + ' view' + (v.label ? ' ' + v.label : '');
      for (const { v, b } of boxes) {
        if (b[0] < 10 || b[1] < 10 || b[2] > W - 10 || b[3] > H - 10) add('error', vname(v) + ' runs off the drawing border', s, { type: 'view', id: v.id });
        if (hit(b, tb)) add('error', vname(v) + ' overlaps the title block', s, { type: 'view', id: v.id });
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].v.kind !== 'detail' && boxes[j].v.kind !== 'detail' && hit(boxes[i].b, boxes[j].b)) add('warning', vname(boxes[i].v) + ' and ' + vname(boxes[j].v) + ' overlap', s, { type: 'view', id: boxes[i].v.id });
      if (!(s.dims || []).length && s.views.length) add('warning', 'No dimensions on this sheet', s);
      // annotations
      const seen = new Map();
      for (const m of s.dims || []) {
        if (m.flag?.kind === 'lost') add('error', 'A ' + (m.kind === 'hc' ? 'callout' : 'dimension') + ' lost its geometry in the last update', s, { type: 'dim', id: m.id });
        else if (m.flag) add('warning', 'A ' + (m.kind === 'hc' ? 'callout' : 'dimension') + ' changed in the last update and is not reviewed yet', s, { type: 'dim', id: m.id });
        if (m.kind === 'hc' && m.src !== 'feature') add('warning', 'Hole callout ' + (m.lines || [])[0] + ' has no hole specification (' + (m.src === 'ambiguous' ? 'several features match' : 'measured only') + ')', s, { type: 'dim', id: m.id });
        if (m.kind !== 'hc') { const key = m.view + ':' + (m.kind || 'lin') + ':' + fmtDim(dimValue(m)); if (seen.has(key)) add('info', 'Dimension ' + dwDimLabel(m) + ' appears twice on the same view', s, { type: 'dim', id: m.id }); seen.set(key, 1); }
      }
      for (const sy of s.symbols || []) {
        if (sy.type === 'fcf') {
          const g = GDT[sy.char], ds = (sy.datums || []).filter(d => d?.l).map(d => d.l);
          if (!String(sy.tol || '').trim() || !(+sy.tol > 0)) add('error', `${g.label} frame has no tolerance value`, s, { type: 'symbol', id: sy.id });
          if (g.datum === 'yes' && !ds.length) add('error', `${g.label} needs a datum reference`, s, { type: 'symbol', id: sy.id });
          if (g.datum === 'no' && ds.length) add('error', `${g.label} is a form tolerance and takes no datum`, s, { type: 'symbol', id: sy.id });
          for (const l of ds) if (!datumsDefined.has(l)) add('warning', `Datum ${l} is referenced but no datum feature symbol defines it`, s, { type: 'symbol', id: sy.id });
          if (!sy.p) add('info', `${g.label} frame has no leader to its feature`, s, { type: 'symbol', id: sy.id });
        }
        if (sy.type === 'finish' && !String(sy.ra || '').trim()) add('warning', 'Surface finish symbol has no Ra value', s, { type: 'symbol', id: sy.id });
        if (sy.type === 'weld' && !String(sy.size || '').trim()) add('warning', WELDS[sy.weld] + ' weld has no size', s, { type: 'symbol', id: sy.id });
      }
      for (const b of s.balloons || []) if (b.flag) add('error', 'A balloon points at a part that no longer exists', s, { type: 'balloon', id: b.id });
    }
  } finally { R.active = act; }
  return out;
}
function openDrawingChecks() {
  const list = drawingChecks(), order = { error: 0, warning: 1, info: 2 };
  list.sort((a, b) => order[a.level] - order[b.level]);
  const n = l => list.filter(x => x.level === l).length;
  const body = h('div', { class: 'dwchecks', style: 'min-width:440px;max-height:60vh;overflow:auto;padding:0 14px' },
    h('p', { class: 'note', id: 'dwc-summary' }, list.length ? `${n('error')} error${n('error') === 1 ? '' : 's'}, ${n('warning')} warning${n('warning') === 1 ? '' : 's'}, ${n('info')} note${n('info') === 1 ? '' : 's'}` : 'No problems found.'),
    ...list.map(f => h('button', { class: 'dwcheck lvl-' + f.level, type: 'button', 'data-level': f.level, onclick: () => {
      closeModal();
      if (f.sheetId && f.sheetId !== doc.drawing.active) switchSheet(f.sheetId);
      if (f.sel) { dwSel = f.sel; renderSheet(); }
    } }, h('span', { class: 'lvl' }, f.level === 'error' ? 'Error' : f.level === 'warning' ? 'Warning' : 'Note'), h('span', {}, f.msg + (f.sheet ? ' · ' + f.sheet : '')))));
  openModal('Drawing Check', 'analysis', body);
}
queueMicrotask(() => {
  cmd('dw.fcf', 'Feature Control Frame', 'pmi', { run: () => dwSetTool('sym:fcf') });
  cmd('dw.datum', 'Datum Feature', 'pmi', { run: () => dwSetTool('sym:datum') });
  cmd('dw.sfinish', 'Surface Finish', 'pmi', { run: () => dwSetTool('sym:finish') });
  cmd('dw.weld', 'Welding Symbol', 'pmi', { run: () => dwSetTool('sym:weld') });
  cmd('dw.check', 'Drawing Check', 'analysis', { run: () => openDrawingChecks() });
});

// ---------- broken views: a band of a long part is cut out; dimensions keep true lengths ----------
// v.brk = { dir: 'h' | 'v', a, b } in the view's own coordinates (a < b); the band shrinks to BREAK_GAP mm on paper.
const BREAK_GAP = 8;
function breakMap(v, d, s) {
  const { dir, a, b } = v.brk, g = BREAK_GAP / s, ax = dir === 'h' ? 0 : 1;
  const c = x => x <= a ? x : x >= b ? x - (b - a) + g : a + (x - a) / (b - a) * g;
  const ci = x => x <= a ? x : x >= a + g ? x + (b - a) - g : a + (x - a) * (b - a) / g;
  const lo = c(ax ? d.cy - d.h / 2 : d.cx - d.w / 2), hi = c(ax ? d.cy + d.h / 2 : d.cx + d.w / 2);
  return { ax, c, ci, mid: (lo + hi) / 2, len: hi - lo, a, g };
}
const brokenWidth = (v, d) => v.brk?.dir === 'h' ? breakMap(v, d, dw().scale).len : d.w;
const brokenHeight = (v, d) => v.brk?.dir === 'v' ? breakMap(v, d, dw().scale).len : d.h;
// remove the parts of a path that fall inside the band (curves crossing it are flattened)
function clipBand(segs, brk) {
  const ax = brk.dir === 'h' ? 0 : 1, a = brk.a, b = brk.b, inBand = q => q[ax] > a + 1e-9 && q[ax] < b - 1e-9;
  const out = []; let cur = null, pen = false;
  const lineTo = (p, q) => {
    // pieces of p→q outside (a, b)
    const ts = [0, 1];
    for (const e of [a, b]) { const den = q[ax] - p[ax]; if (Math.abs(den) > 1e-12) { const t = (e - p[ax]) / den; if (t > 1e-9 && t < 1 - 1e-9) ts.push(t); } }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i], t1 = ts[i + 1], P0 = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0], P1 = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1], m = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
      if (inBand(m)) { pen = false; continue; }
      if (!pen) { out.push(['M', P0[0], P0[1]]); pen = true; }
      out.push(['L', P1[0], P1[1]]);
    }
  };
  let start = null;
  for (const sg of segs) {
    if (sg[0] === 'M') { cur = [sg[1], sg[2]]; start = cur; pen = false; continue; }
    if (sg[0] === 'Z') { if (start && cur) lineTo(cur, start); cur = start; continue; }
    if (sg[0] === 'L') { const q = [sg[1], sg[2]]; lineTo(cur, q); cur = q; continue; }
    if (sg[0] === 'C') {
      const p0 = cur, c1 = [sg[1], sg[2]], c2 = [sg[3], sg[4]], p3 = [sg[5], sg[6]], lo = Math.min(p0[ax], c1[ax], c2[ax], p3[ax]), hi = Math.max(p0[ax], c1[ax], c2[ax], p3[ax]);
      if (hi <= a + 1e-9 || lo >= b - 1e-9) { if (!pen) { out.push(['M', p0[0], p0[1]]); pen = true; } out.push(sg); }
      else { let prev = p0; for (let i = 1; i <= 16; i++) { const t = i / 16, mt = 1 - t, q = [0, 1].map(k => mt * mt * mt * p0[k] + 3 * mt * mt * t * c1[k] + 3 * mt * t * t * c2[k] + t * t * t * p3[k]); lineTo(prev, q); prev = q; } }
      cur = p3;
    }
  }
  return out;
}
// break lines across the view at both cut edges (thin, with a zigzag in the middle)
function breakLineItems(v, d, X, path, tag) {
  const ax = v.brk.dir === 'h' ? 0 : 1, m2 = 2 / X.s;
  const span = ax === 0 ? [d.cy - d.h / 2 - m2, d.cy + d.h / 2 + m2] : [d.cx - d.w / 2 - m2, d.cx + d.w / 2 + m2];
  for (const e of [v.brk.a, v.brk.b]) {
    const S0 = X.toSheet(ax === 0 ? [e, span[0]] : [span[0], e]), S1 = X.toSheet(ax === 0 ? [e, span[1]] : [span[1], e]);
    const M = [(S0[0] + S1[0]) / 2, (S0[1] + S1[1]) / 2], acr = [S1[0] - S0[0], S1[1] - S0[1]], L = Math.hypot(...acr) || 1, u = [acr[0] / L, acr[1] / L], al = [u[1], -u[0]];
    const at = (t, o) => [M[0] + u[0] * t + al[0] * o, M[1] + u[1] * t + al[1] * o];
    const pts = [S0, at(-2, 0), at(-1, 1.2), at(1, -1.2), at(2, 0), S1];
    path('M' + pts.map(q => q[0].toFixed(3) + ' ' + q[1].toFixed(3)).join('L'), { w: 0.18, tag });
  }
}
function breakToolClick(P) {
  if (!dwDraft) { const v = viewAt(P); if (!v || v.kind === 'detail' || v.kind === 'iso') { toast('Click on a front, top, side, section or auxiliary view'); return; } dwDraft = { view: v.id, p1: viewXf(v).toLocal(P) }; defaultHint(); return; }
  const v = viewById(dwDraft.view), q = viewXf(v).toLocal(P), p = dwDraft.p1, dir = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? 'h' : 'v', k = dir === 'h' ? 0 : 1;
  const a = Math.min(p[k], q[k]), b = Math.max(p[k], q[k]);
  if (b - a < 1) { toast('Drag across a longer stretch of the part'); return; }
  checkpoint(); v.brk = { dir, a, b }; persist(); dwDraft = null; dwTool = null; renderRibbon(); renderSheet(); defaultHint();
  toast('Broken view: ' + fmtDim(b - a) + ' mm removed from the drawing; dimensions across the break still show the true length');
}
function removeBreak() {
  const v = dwSel?.type === 'view' && viewById(dwSel.id); if (!v?.brk) { toast('Select a broken view first'); return; }
  checkpoint(); delete v.brk; persist(); renderSheet();
}

// ---------- auxiliary views: looking square-on at a face that is inclined in a principal view ----------
// In each principal view, page x and page y (down) are these model directions:
const VIEW_BASIS = { front: [[1, 0, 0], [0, 0, -1]], top: [[1, 0, 0], [0, -1, 0]], right: [[0, 1, 0], [0, 0, -1]], left: [[0, -1, 0], [0, 0, -1]], back: [[-1, 0, 0], [0, 0, -1]], bottom: [[1, 0, 0], [0, 1, 0]] };
function auxCamera(parentKind, edge, place) {
  const [U, V] = VIEW_BASIS[parentKind], e = [edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]], L = Math.hypot(...e) || 1, eu = [e[0] / L, e[1] / L];
  const n2 = [-eu[1], eu[0]], mid = [(edge[0][0] + edge[1][0]) / 2, (edge[0][1] + edge[1][1]) / 2];
  const sgn = Math.sign((place[0] - mid[0]) * n2[0] + (place[1] - mid[1]) * n2[1]) || 1;
  const to3 = (a, b) => [0, 1, 2].map(i => a * U[i] + b * V[i]);
  return { dir: to3(sgn * n2[0], sgn * n2[1]), x: to3(eu[0], eu[1]) };
}
function auxToolClick(P) {
  if (!dwDraft) {
    const l = nearestLine(P); if (!l) { toast('Click an inclined edge on a front, top or side view'); return; }
    const v = viewById(l.view);
    if (!VIEW_BASIS[v.kind]) { toast('Auxiliary views are taken from the front, top, side, back or bottom view'); return; }
    const e = [l.line[1][0] - l.line[0][0], l.line[1][1] - l.line[0][1]];
    if (Math.abs(e[0]) < 1e-6 || Math.abs(e[1]) < 1e-6) toast('That edge is square to the view: the auxiliary view will match a principal view');
    dwDraft = { view: v.id, line: l.line }; defaultHint(); renderSheet(); return;
  }
  const v = viewById(dwDraft.view), local = viewXf(v).toLocal(P);
  const label = String.fromCharCode(65 + dw().views.filter(w => ['section', 'detail', 'aux'].includes(w.kind)).length);
  checkpoint();
  dw().views.push({ id: uid(), kind: 'aux', label, of: v.kind, parentView: v.id, edge: dwDraft.line, cam: auxCamera(v.kind, dwDraft.line, local), x: P[0], y: P[1], hidden: false });
  persist(); dwDraft = null; dwTool = null; renderRibbon(); dwRefresh().then(renderSheet); defaultHint();
}
// viewing arrow on the parent view: perpendicular to the edge, pointing at the face, with the view letter
function auxArrowItems(av, pv, X, path, text) {
  const tag = 'v:' + av.id, e = av.edge, mid = X.toSheet([(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2]);
  const A = X.toSheet(e[0]), B = X.toSheet(e[1]), d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d) || 1, n = [-d[1] / L, d[0] / L];
  const toView = [av.x - mid[0], av.y - mid[1]], sg = Math.sign(toView[0] * n[0] + toView[1] * n[1]) || 1, u = [n[0] * sg, n[1] * sg];
  const tail = [mid[0] + u[0] * 12, mid[1] + u[1] * 12], tip = [mid[0] + u[0] * 3, mid[1] + u[1] * 3];
  path(`M${tail[0]} ${tail[1]}L${tip[0]} ${tip[1]}`, { w: 0.25, tag }); arrowAt(path, tip, [-u[0], -u[1]], tag);
  text(tail[0] + u[0] * 2.5, tail[1] + u[1] * 2.5 + 1.4, av.label, 4, { anchor: 'middle', bold: true, tag });
}
queueMicrotask(() => {
  cmd('dw.aux', 'Auxiliary View', 'section', { run: () => dwSetTool('aux') });
  cmd('dw.break', 'Break View', 'splitbody', { run: () => dwSetTool('break') });
  cmd('dw.unbreak', 'Remove Break', 'splitbody', { run: () => removeBreak() });
});
