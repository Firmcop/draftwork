// ===== Insert: SVG and DXF as sketches, canvases and decals (images), derived designs =====
function pickFile(accept, asText = true) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, hidden: true });
    inp.addEventListener('change', () => {
      const file = inp.files?.[0]; inp.remove(); if (!file) return resolve(null);
      const rd = new FileReader(); rd.onload = () => resolve({ file, data: rd.result });
      asText === 'url' ? rd.readAsDataURL(file) : asText ? rd.readAsText(file) : rd.readAsArrayBuffer(file);
    });
    document.body.append(inp); inp.click();
  });
}
// ---- 2D geometry collector: welds end points, builds sketch geo ----
function geoBuilder() {
  const g = emptyGeo(), map = new Map(), key = (x, y) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4);
  const P = (x, y) => { const k = key(x, y); let id = map.get(k); if (!id) { id = 'p' + uid(); g.points.push({ id, x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 }); map.set(k, id); } return id; };
  return {
    g,
    line(a, b) { if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return; g.curves.push({ id: 'l' + uid(), kind: 'line', a: P(...a), b: P(...b) }); },
    circle(c, r) { if (r > 1e-6) g.curves.push({ id: 'c' + uid(), kind: 'circle', c: P(...c), r: Math.round(r * 1e6) / 1e6 }); },
    arc(c, r, a0, a1) {   // counter-clockwise from a0 to a1 (radians)
      if (!(r > 1e-6)) return;
      let sweep = a1 - a0; while (sweep <= 0) sweep += 2 * Math.PI; if (sweep > 2 * Math.PI - 1e-9) return this.circle(c, r);
      const A = [c[0] + r * Math.cos(a0), c[1] + r * Math.sin(a0)], B = [c[0] + r * Math.cos(a0 + sweep), c[1] + r * Math.sin(a0 + sweep)];
      g.curves.push({ id: 'a' + uid(), kind: 'arc', c: P(...c), a: P(...A), b: P(...B) });
    },
    spline(pts) {
      const q = pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-6);
      if (q.length < 2) return; if (q.length === 2) return this.line(q[0], q[1]);
      const ids = q.map(p => P(...p)); g.curves.push({ id: 's' + uid(), kind: 'spline', pts: ids, a: ids[0], b: ids.at(-1) });
    },
  };
}
// ---- SVG ----
function svgToGeo(text, scale = 1) {
  const doc2 = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc2.documentElement;
  if (root.nodeName !== 'svg') throw new Error('That is not an SVG file');
  const host = h('div', { style: 'position:absolute;left:-9999px;top:0;width:10px;height:10px;overflow:hidden' }); document.body.append(host);
  const svg = document.importNode(root, true); host.append(svg);
  const B = geoBuilder(); let count = 0;
  try {
    for (const el of svg.querySelectorAll('path, line, polyline, polygon, rect, circle, ellipse')) {
      const m = el.getCTM ? el.getCTM() : null, M = m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [1, 0, 0, 1, 0, 0];
      const T = (x, y) => [(M[0] * x + M[2] * y + M[4]) * scale, -(M[1] * x + M[3] * y + M[5]) * scale];   // SVG y points down
      const det = M[0] * M[3] - M[1] * M[2], sx = Math.hypot(M[0], M[1]), sy = Math.hypot(M[2], M[3]);
      const similar = Math.abs(sx - sy) < 1e-6 * Math.max(sx, 1) && Math.abs(M[0] * M[2] + M[1] * M[3]) < 1e-9;
      const num = a => parseFloat(el.getAttribute(a) || '0');
      const sample = (fn, n = 32) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn(i / n)); return pts; };
      const tag = el.nodeName;
      if (tag === 'line') B.line(T(num('x1'), num('y1')), T(num('x2'), num('y2')));
      else if (tag === 'rect') { const x = num('x'), y = num('y'), w = num('width'), hh = num('height'); const c = [T(x, y), T(x + w, y), T(x + w, y + hh), T(x, y + hh)]; for (let i = 0; i < 4; i++) B.line(c[i], c[(i + 1) % 4]); }
      else if (tag === 'polyline' || tag === 'polygon') {
        const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number), pts = []; for (let i = 0; i + 1 < v.length; i += 2) pts.push(T(v[i], v[i + 1]));
        for (let i = 1; i < pts.length; i++) B.line(pts[i - 1], pts[i]); if (tag === 'polygon' && pts.length > 2) B.line(pts.at(-1), pts[0]);
      } else if (tag === 'circle' && similar) B.circle(T(num('cx'), num('cy')), num('r') * sx * scale);
      else if (tag === 'circle' || tag === 'ellipse') {
        const rx = tag === 'circle' ? num('r') : num('rx'), ry = tag === 'circle' ? num('r') : num('ry'), cx = num('cx'), cy = num('cy');
        const pts = sample(t => T(cx + rx * Math.cos(2 * Math.PI * t), cy + ry * Math.sin(2 * Math.PI * t)), 24); B.spline(pts);
      } else if (tag === 'path') pathToGeo(el.getAttribute('d') || '', T, B, similar ? sx * scale : 0, det < 0);
      count++;
    }
  } finally { host.remove(); }
  if (!B.g.curves.length) throw new Error('No drawable shapes found in the SVG');
  return { geo: B.g, count };
}
function pathToGeo(d, T, B, arcScale, mirrored) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
  let i = 0, cmd = '', cur = [0, 0], start = [0, 0], lastC = null, lastQ = null;
  const n = () => parseFloat(tok[i++]);
  const isNum = () => i < tok.length && !/^[a-zA-Z]$/.test(tok[i]);
  const bez = pts => B.spline(Array.from({ length: 13 }, (_, k) => { const t = k / 12, u = 1 - t; if (pts.length === 4) return T(...[0, 1].map(j => u * u * u * pts[0][j] + 3 * u * u * t * pts[1][j] + 3 * u * t * t * pts[2][j] + t * t * t * pts[3][j])); return T(...[0, 1].map(j => u * u * pts[0][j] + 2 * u * t * pts[1][j] + t * t * pts[2][j])); }));
  while (i < tok.length) {
    if (!isNum()) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), o = rel ? cur : [0, 0];
    if (C === 'M') { cur = [o[0] + n(), o[1] + n()]; start = cur; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; continue; }
    if (C === 'Z') { B.line(T(...cur), T(...start)); cur = start; lastC = lastQ = null; continue; }
    if (C === 'L') { const p = [o[0] + n(), o[1] + n()]; B.line(T(...cur), T(...p)); cur = p; lastC = lastQ = null; continue; }
    if (C === 'H') { const p = [(rel ? cur[0] : 0) + n(), cur[1]]; B.line(T(...cur), T(...p)); cur = p; lastC = lastQ = null; continue; }
    if (C === 'V') { const p = [cur[0], (rel ? cur[1] : 0) + n()]; B.line(T(...cur), T(...p)); cur = p; lastC = lastQ = null; continue; }
    if (C === 'C' || C === 'S') {
      const c1 = C === 'C' ? [o[0] + n(), o[1] + n()] : (lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur);
      const c2 = [o[0] + n(), o[1] + n()], p = [o[0] + n(), o[1] + n()];
      bez([cur, c1, c2, p]); lastC = c2; lastQ = null; cur = p; continue;
    }
    if (C === 'Q' || C === 'T') {
      const c1 = C === 'Q' ? [o[0] + n(), o[1] + n()] : (lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur);
      const p = [o[0] + n(), o[1] + n()]; bez([cur, c1, p]); lastQ = c1; lastC = null; cur = p; continue;
    }
    if (C === 'A') {
      let rx = Math.abs(n()), ry = Math.abs(n()); const phi = n() * Math.PI / 180, large = !!n(), sweep = !!n(), p = [o[0] + n(), o[1] + n()];
      // endpoint -> centre parameterisation (SVG spec F.6.5)
      const cp = Math.cos(phi), sp = Math.sin(phi), dx = (cur[0] - p[0]) / 2, dy = (cur[1] - p[1]) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
      const lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const sgn = large === sweep ? -1 : 1, num_ = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, co = sgn * Math.sqrt(Math.max(0, num_ / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
      const cx1 = co * rx * y1 / ry, cy1 = -co * ry * x1 / rx, cx = cp * cx1 - sp * cy1 + (cur[0] + p[0]) / 2, cy = sp * cx1 + cp * cy1 + (cur[1] + p[1]) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry); let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
      if (arcScale && Math.abs(rx - ry) < 1e-9) {
        // circular arc: exact
        const Cc = T(cx, cy), A0 = T(...cur), A1 = T(...p), ccw = (dt < 0) !== mirrored;   // the y flip turns SVG's positive sweep clockwise
        const a0 = Math.atan2(A0[1] - Cc[1], A0[0] - Cc[0]), a1 = Math.atan2(A1[1] - Cc[1], A1[0] - Cc[0]), r = rx * arcScale;
        ccw ? B.arc(Cc, r, a0, a1) : B.arc(Cc, r, a1, a0);
      } else B.spline(Array.from({ length: 17 }, (_, k) => { const t = t1 + dt * k / 16; return T(cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp); }));
      cur = p; lastC = lastQ = null; continue;
    }
    i++;   // unknown token
  }
}
// ---- DXF ----
function dxfToGeo(text, scale = 1) {
  const L = text.split(/\r?\n/), pairs = [];
  for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i].trim(), 10), L[i + 1].trim()]);
  let units = 4; const B = geoBuilder();
  for (let i = 0; i < pairs.length; i++) if (pairs[i][1] === '$INSUNITS') { units = parseInt(pairs[i + 1][1], 10); break; }
  const uScale = ({ 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }[units] || 1) * scale;
  const S = (x, y) => [x * uScale, y * uScale];
  let i = pairs.findIndex(p => p[0] === 2 && p[1] === 'ENTITIES'); if (i < 0) throw new Error('No ENTITIES section in the DXF file');
  let count = 0;
  const readEnt = () => { const e = { type: pairs[i][1], g: [] }; i++; while (i < pairs.length && pairs[i][0] !== 0) { e.g.push(pairs[i]); i++; } return e; };
  const get = (e, c, d = 0) => { const p = e.g.find(x => x[0] === c); return p ? parseFloat(p[1]) : d; };
  const bulgeSeg = (p1, p2, b) => {
    if (Math.abs(b) < 1e-9) return B.line(p1, p2);
    const th = 4 * Math.atan(b), dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = Math.hypot(dx, dy), r = c / (2 * Math.sin(th / 2));
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2, hgt = r * Math.cos(th / 2), nx = -dy / c, ny = dx / c;
    const cx = mx + nx * hgt, cy = my + ny * hgt, a1 = Math.atan2(p1[1] - cy, p1[0] - cx), a2 = Math.atan2(p2[1] - cy, p2[0] - cx);
    b > 0 ? B.arc([cx, cy], Math.abs(r), a1, a2) : B.arc([cx, cy], Math.abs(r), a2, a1);
  };
  i++;
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) { i++; continue; }
    if (pairs[i][1] === 'ENDSEC') break;
    const e = readEnt();
    if (e.type === 'LINE') { B.line(S(get(e, 10), get(e, 20)), S(get(e, 11), get(e, 21))); count++; }
    else if (e.type === 'CIRCLE') { B.circle(S(get(e, 10), get(e, 20)), get(e, 40) * uScale); count++; }
    else if (e.type === 'ARC') { B.arc(S(get(e, 10), get(e, 20)), get(e, 40) * uScale, get(e, 50) * Math.PI / 180, get(e, 51) * Math.PI / 180); count++; }
    else if (e.type === 'LWPOLYLINE') {
      const closed = (get(e, 70) & 1) === 1, V = [];
      for (const [c, v] of e.g) { if (c === 10) V.push({ x: +v, y: 0, b: 0 }); else if (c === 20 && V.length) V.at(-1).y = +v; else if (c === 42 && V.length) V.at(-1).b = +v; }
      for (let k = 0; k + 1 < V.length + (closed ? 1 : 0); k++) { const a = V[k], b = V[(k + 1) % V.length]; bulgeSeg(S(a.x, a.y), S(b.x, b.y), a.b); }
      count++;
    } else if (e.type === 'POLYLINE') {
      const closed = (get(e, 70) & 1) === 1, V = [];
      while (i < pairs.length && pairs[i][1] === 'VERTEX') { const v = readEnt(); V.push({ x: get(v, 10), y: get(v, 20), b: get(v, 42) }); }
      if (pairs[i]?.[1] === 'SEQEND') readEnt();
      for (let k = 0; k + 1 < V.length + (closed ? 1 : 0); k++) { const a = V[k], b = V[(k + 1) % V.length]; bulgeSeg(S(a.x, a.y), S(b.x, b.y), a.b); }
      count++;
    } else if (e.type === 'SPLINE') {
      const fit = [], ctrl = [], knots = []; const deg = get(e, 71, 3);
      for (const [c, v] of e.g) { if (c === 11) fit.push([+v, 0]); else if (c === 21 && fit.length) fit.at(-1)[1] = +v; else if (c === 10) ctrl.push([+v, 0]); else if (c === 20 && ctrl.length) ctrl.at(-1)[1] = +v; else if (c === 40) knots.push(+v); }
      if (fit.length >= 2) B.spline(fit.map(p => S(...p)));
      else if (ctrl.length > deg && knots.length === ctrl.length + deg + 1) B.spline(sampleBSpline(ctrl, knots, deg, Math.max(12, ctrl.length * 4)).map(p => S(...p)));
      count++;
    } else if (e.type === 'ELLIPSE') {
      const c = [get(e, 10), get(e, 20)], mj = [get(e, 11), get(e, 21)], ratio = get(e, 40, 1), t0 = get(e, 41, 0), t1 = get(e, 42, 2 * Math.PI);
      const mn = [-mj[1] * ratio, mj[0] * ratio], span = t1 > t0 ? t1 - t0 : t1 - t0 + 2 * Math.PI;
      B.spline(Array.from({ length: 25 }, (_, k) => { const t = t0 + span * k / 24; return S(c[0] + mj[0] * Math.cos(t) + mn[0] * Math.sin(t), c[1] + mj[1] * Math.cos(t) + mn[1] * Math.sin(t)); }));
      count++;
    }
  }
  if (!B.g.curves.length) throw new Error('No lines, arcs, circles, polylines or splines found in the DXF');
  return { geo: B.g, count };
}
function sampleBSpline(P, U, p, n) {
  const out = [], a = U[p], b = U[U.length - p - 1];
  for (let s = 0; s <= n; s++) {
    let u = a + (b - a) * s / n; if (s === n) u = b - 1e-9;
    let k = p; while (k < U.length - p - 2 && u >= U[k + 1]) k++;
    const d = []; for (let j = 0; j <= p; j++) d.push([...P[k - p + j]]);
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) { const i2 = k - p + j, al = (u - U[i2]) / ((U[i2 + p - r + 1] - U[i2]) || 1); d[j] = [(1 - al) * d[j - 1][0] + al * d[j][0], (1 - al) * d[j - 1][1] + al * d[j][1]]; }
    out.push(d[p]);
  }
  return out;
}
function startInsert2D(kind) {
  startPick({ prompt: `Select a plane or flat face to place the ${kind.toUpperCase()} on`, planes: true, faces: true, then: async c => {
    const got = await pickFile(kind === 'svg' ? '.svg,image/svg+xml' : '.dxf', true); if (!got) return;
    let res; try { res = kind === 'svg' ? svgToGeo(got.data, 1) : dxfToGeo(got.data, 1); } catch (e) { toast('Could not read ' + got.file.name + ': ' + e.message); return; }
    // move the drawing so its bounding box centre lands on the picked point
    const xs = res.geo.points.map(p => p.x), ys = res.geo.points.map(p => p.y), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ox = (c.local?.x || 0) - (kind === 'svg' ? cx : 0), oy = (c.local?.y || 0) - (kind === 'svg' ? cy : 0);
    for (const p of res.geo.points) { p.x = Math.round((p.x + ox) * 1e6) / 1e6; p.y = Math.round((p.y + oy) * 1e6) / 1e6; }
    checkpoint();
    const f = { id: uid(), type: 'sketch', name: got.file.name.replace(/\.(svg|dxf)$/i, ''), plane: c.plane, offset: c.offset || 0, flip: !!c.flip, profiles: [], geo: res.geo };
    insertFeature(f); scheduleRegen(0); renderTimeline(); renderBrowser();
    toast(`Inserted ${res.geo.curves.length} curves from ${got.file.name} as a sketch`);
  } });
}
// ---- canvas & decal: an image on a plane or face ----
const canvasTex = new Map();   // file id -> { tex, aspect }
function startCanvas(kind = 'canvas') {
  startPick({ prompt: kind === 'decal' ? 'Click the flat face to put the decal on' : 'Select a plane or flat face for the canvas', planes: kind !== 'decal', faces: true, then: async c => {
    const got = await pickFile('image/png,image/jpeg,image/webp,image/gif', 'url'); if (!got) return;
    if (got.file.size > 8e6) { toast('Use an image under 8 MB'); return; }
    const fileId = uid(), snap = JSON.stringify(doc); checkpoint();
    doc.files ||= {}; doc.files[fileId] = { name: got.file.name, url: got.data, kind: 'image' };
    const f = { id: uid(), type: kind, name: got.file.name.replace(/\.\w+$/, ''), file: fileId, plane: c.plane, offset: (c.offset || 0) + (kind === 'decal' ? 0.02 : 0), flip: !!c.flip, cx: c.local?.x || 0, cy: c.local?.y || 0, width: 50, angle: 0, opacity: kind === 'decal' ? 1 : 0.6, mirror: false };
    insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
  } });
}
function drawCanvases(group) {
  for (const f of doc.features) {
    if ((f.type !== 'canvas' && f.type !== 'decal') || f.suppressed || f.hidden || doc.rollback != null && featIndex(f.id) > doc.rollback) continue;
    const file = doc.files?.[f.file]; if (!file) continue;
    let t = canvasTex.get(f.file);
    if (!t) {
      t = { tex: new THREE.TextureLoader().load(file.url, tx => { t.aspect = tx.image.height / tx.image.width || 1; requestRender(); updateScene(); }), aspect: 1 };
      t.tex.colorSpace = THREE.SRGBColorSpace; canvasTex.set(f.file, t);
    }
    const r = resolvedById(f.id) || f;
    let M; try { M = sketchMatrix({ id: f.id, plane: f.plane, offset: +r.offset || 0, flip: f.flip }); } catch (e) { continue; }
    const w = +r.width || 50, hh = w * (t.aspect || 1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: t.tex, transparent: true, opacity: Math.max(0.05, Math.min(1, +r.opacity || 1)), side: THREE.DoubleSide, depthWrite: f.type === 'decal', polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const L = new THREE.Matrix4().makeTranslation(+r.cx || 0, +r.cy || 0, 0).multiply(new THREE.Matrix4().makeRotationZ((+r.angle || 0) * Math.PI / 180)).multiply(new THREE.Matrix4().makeScale(f.mirror ? -1 : 1, 1, 1));
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(M.clone().multiply(L)); mesh.renderOrder = f.type === 'decal' ? 6 : 2; mesh.userData.canvas = f.id;
    group.add(mesh);
  }
}
// ---- derive: bring in the bodies of another Draftwork design ----
async function startDerive() {
  if (!needExact('Insert Derive')) return;
  const got = await pickFile('.json,application/json', true); if (!got) return;
  let sub; try { sub = JSON.parse(got.data); if (!Array.isArray(sub.features)) throw new Error('no features'); } catch (e) { toast('That is not a Draftwork design file'); return; }
  const fileId = uid(), snap = JSON.stringify(doc); checkpoint();
  doc.files ||= {}; doc.files[fileId] = { name: got.file.name, design: { name: sub.name, params: sub.params || [], features: sub.features }, kind: 'design' };
  const f = { id: uid(), type: 'derive', name: (sub.name || got.file.name.replace(/\.json$/i, '')), file: fileId, dx: 0, dy: 0, dz: 0 };
  insertFeature(f); openFeatureDialog(f.id, true, snap); scheduleRegen(0);
}
// the derived design's own features, resolved with its own parameters, travel with the feature to the engine
function expandDerive(features) {
  return features.map(f => {
    if (f.type !== 'derive') return f;
    const d = doc.files?.[f.file]?.design; if (!d) return { ...f, error: 'The derived design is missing' };
    try { return { ...f, sub: resolveFeatures(d.features, evalParams(d.params || []).vars) }; } catch (e) { return { ...f, error: 'The derived design could not be read: ' + e.message }; }
  });
}
function insertDialog(f, idx, out, placement) {
  switch (f.type) {
    case 'canvas': case 'decal':
      out.push(section_('Placement', ...placement(), exField('Center X', f, 'cx'), exField('Center Y', f, 'cy'), exField('Rotation', f, 'angle', '°')),
        section_('Image', h('p', { class: 'note' }, doc.files?.[f.file]?.name || 'Missing image'), exField('Width', f, 'width', 'mm', { min: 0.1 }), exField('Opacity', f, 'opacity', '', { min: 0.05, max: 1, step: 0.05 }), chkField('Mirror', f, 'mirror'),
          h('p', { class: 'note' }, f.type === 'canvas' ? 'Use the canvas as a tracing reference for sketches. Width sets the scale (calibrate by matching a known length).' : 'A picture applied to the face; it is shown in the model and not part of the geometry.')));
      return true;
    case 'derive': {
      const d = doc.files?.[f.file]?.design;
      out.push(section_('Derived design', h('p', { class: 'note' }, d ? `${d.name || 'Design'} · ${d.features.length} features, ${(d.params || []).length} parameters` : 'Missing design'),
        exField('Move X', f, 'dx'), exField('Move Y', f, 'dy'), exField('Move Z', f, 'dz'),
        h('p', { class: 'note' }, 'The bodies are rebuilt from the derived design and copied in. Insert the file again to pick up its changes.')));
      return true;
    }
  }
  return false;
}
