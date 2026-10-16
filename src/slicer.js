// ===== Additive (FFF) slicer: layers, perimeters, solid and sparse infill, skirt, Marlin G-code =====
import { makeGrid, distanceField, contours, simplify, loopArea } from './camcore.js';
const slNum = (v, d) => (v === '' || v == null || !Number.isFinite(+v)) ? d : +v;

// cut the triangle soup at height z into closed loops (xy)
export function sliceLoops(tris, z) {
  const segs = [];
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const P = [[tris[t], tris[t + 1], tris[t + 2]], [tris[t + 3], tris[t + 4], tris[t + 5]], [tris[t + 6], tris[t + 7], tris[t + 8]]];
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3], da = a[2] - z, db = b[2] - z;
      if ((da < 0 && db >= 0) || (db < 0 && da >= 0)) { const s = da / (da - db); pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]); }
    }
    if (pts.length === 2 && Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) > 1e-9) segs.push(pts);
  }
  // chain by matching end points
  const key = p => Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4), ends = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const used = new Uint8Array(segs.length), loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1;
    const L = [segs[i][0], segs[i][1]]; let cur = key(segs[i][1]); const start = key(segs[i][0]);
    for (let guard = 0; guard < segs.length && cur !== start; guard++) {
      const nx = (ends.get(cur) || []).find(j => !used[j]); if (nx == null) break;
      used[nx] = 1; const s = segs[nx], far = key(s[0]) === cur ? s[1] : s[0]; L.push(far); cur = key(far);
    }
    if (L.length > 3 && cur === start) { L.pop(); loops.push(L); }
  }
  return loops;
}
// even-odd fill of loops into a grid mask
export function fillMask(G, loops) {
  const m = new Uint8Array(G.nx * G.ny), xs = [];
  for (let j = 0; j < G.ny; j++) {
    const y = G.y0 + j * G.g; xs.length = 0;
    for (const L of loops) for (let k = 0; k < L.length; k++) { const a = L[k], b = L[(k + 1) % L.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.max(0, Math.ceil((xs[k] - G.x0) / G.g)), i1 = Math.min(G.nx - 1, Math.floor((xs[k + 1] - G.x0) / G.g)); for (let i = i0; i <= i1; i++) m[j * G.nx + i] = 1; }
  }
  return m;
}
// straight infill lines at an angle, spacing s, inside a mask (segments [x0,y0,x1,y1])
function hatch(G, mask, ang, s, minLen) {
  const ca = Math.cos(ang), sa = Math.sin(ang), cx = G.x0 + G.nx * G.g / 2, cy = G.y0 + G.ny * G.g / 2, half = Math.hypot(G.nx, G.ny) * G.g / 2, out = [];
  const inside = (x, y) => { const i = Math.round((x - G.x0) / G.g), j = Math.round((y - G.y0) / G.g); return i >= 0 && j >= 0 && i < G.nx && j < G.ny && mask[j * G.nx + i]; };
  let dir = 1;
  for (let v = -half; v <= half; v += s) {
    const runs = []; let start = null;
    for (let u = -half; u <= half + G.g; u += G.g * 0.5) {
      const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca, inn = inside(x, y);
      if (inn && start == null) start = [x, y]; else if (!inn && start) { const e = [x - G.g * 0.5 * ca, y - G.g * 0.5 * sa]; if (Math.hypot(e[0] - start[0], e[1] - start[1]) >= minLen) runs.push([...start, ...e]); start = null; }
    }
    if (!runs.length) continue;
    if (dir < 0) { runs.reverse(); for (const r of runs) { const t0 = r[0], t1 = r[1]; r[0] = r[2]; r[1] = r[3]; r[2] = t0; r[3] = t1; } }
    out.push(...runs); dir = -dir;
  }
  return out;
}
// slice a part (triangles in mm, already on the plate: min z = 0) into layers of extrusion paths
export function slicePart(tris, o) {
  const w = +o.lineWidth || (+o.nozzle || 0.4) * 1.125, h = +o.layer || 0.2, h0 = +o.firstLayer || Math.max(h, 0.25);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]); }
  if (!(hi[2] > lo[2])) throw new Error('Nothing to slice');
  const skirtGap = +o.skirtGap || 3, margin = skirtGap + w * 4, g = Math.max(w / 4, Math.sqrt((hi[0] - lo[0] + 2 * margin) * (hi[1] - lo[1] + 2 * margin) / 2.5e5));
  const G = makeGrid(lo[0] - margin, lo[1] - margin, hi[0] + margin, hi[1] + margin, g);
  const zs = []; for (let z = h0; z <= hi[2] + 1e-6; z += h) zs.push(z);
  if (!zs.length || zs[zs.length - 1] < hi[2] - h / 2) zs.push(Math.min(hi[2], (zs.at(-1) || 0) + h));
  const masks = zs.map(z => fillMask(G, sliceLoops(tris, z - (z === zs[0] ? h0 : h) / 2)));   // sample mid-layer
  const P = Math.max(1, Math.round(+o.perimeters || 2)), top = Math.max(0, Math.round(slNum(o.topLayers, 4))), bot = Math.max(0, Math.round(slNum(o.bottomLayers, 3))), dens = Math.max(0, Math.min(1, slNum(o.infill, 20) / 100));
  const layers = [];
  zs.forEach((z, li) => {
    const M = masks[li], D = distanceField(M, G.nx, G.ny, g), paths = [];
    const tooSmall = !M.some(Boolean);
    if (tooSmall) { layers.push({ z, h: li ? h : h0, paths }); return; }
    // perimeters, outermost last (better surface)
    const per = [];
    for (let k = P - 1; k >= 0; k--) for (const L of contours(D, G, w * (k + 0.5))) { const S = simplify(L, g * 0.5); if (S.length >= 3 && Math.abs(loopArea(S)) > w * w) per.push({ kind: k === 0 ? 'outer' : 'inner', pts: S }); }
    paths.push(...per);
    // infill region: inside the innermost perimeter (slight overlap)
    const inner = new Uint8Array(M.length); for (let k = 0; k < M.length; k++) inner[k] = M[k] && D[k] >= w * (P - 0.15) ? 1 : 0;
    // solid where this is near the bottom or top of the part (nothing below / above within the set number of layers)
    const solid = new Uint8Array(M.length), sparse = new Uint8Array(M.length);
    for (let k = 0; k < M.length; k++) {
      if (!inner[k]) continue;
      let s = li < bot || li >= zs.length - top;
      for (let d = 1; !s && d <= bot; d++) if (!masks[li - d][k]) s = true;
      for (let d = 1; !s && d <= top; d++) if (li + d < zs.length && !masks[li + d][k]) s = true;
      (s ? solid : sparse)[k] = 1;
    }
    const ang = (li % 2 ? -1 : 1) * Math.PI / 4;
    for (const r of hatch(G, solid, ang, w, w)) paths.push({ kind: 'solid', pts: [[r[0], r[1]], [r[2], r[3]]], open: true });
    if (dens > 0.001) for (const r of hatch(G, sparse, ang, w / dens, w)) paths.push({ kind: 'infill', pts: [[r[0], r[1]], [r[2], r[3]]], open: true });
    // skirt around the first layer
    if (li === 0 && slNum(o.skirt, 1) > 0) {
      const out = new Uint8Array(M.length); for (let k = 0; k < M.length; k++) out[k] = M[k] ? 0 : 1;
      const Do = distanceField(out, G.nx, G.ny, g);
      for (const L of contours(Do, G, skirtGap)) { const S = simplify(L, g * 0.5); if (S.length >= 3 && loopArea(S) < 0) paths.unshift({ kind: 'skirt', pts: [...S].reverse() }); }
    }
    layers.push({ z, h: li ? h : h0, paths });
  });
  return { layers, bbox: [lo, hi], lineWidth: w, grid: g };
}
// Marlin-flavour G-code with absolute extrusion, retraction on long travels
export function printGcode(sl, o) {
  const fd = +o.filament || 1.75, area = Math.PI * (fd / 2) ** 2, w = sl.lineWidth, out = [], f = v => (Math.round(v * 1000) / 1000).toString();
  const sp = { outer: (+o.speedOuter || 30) * 60, inner: (+o.speedInner || 45) * 60, solid: (+o.speedInfill || 60) * 60, infill: (+o.speedInfill || 60) * 60, skirt: 30 * 60, travel: (+o.speedTravel || 150) * 60, first: (+o.speedFirst || 20) * 60 };
  const retr = slNum(o.retract, 0.8);
  let E = 0, x = null, y = null, time = 0, length = 0, retracted = false;
  out.push(`; Draftwork slicer — ${o.name || 'part'}`, `; layer ${o.layer} mm, ${sl.layers.length} layers, line width ${f(w)} mm, infill ${o.infill}%`,
    `M140 S${slNum(o.bedTemp, 60)}`, `M104 S${slNum(o.nozzleTemp, 210)}`, 'G28', `M190 S${slNum(o.bedTemp, 60)}`, `M109 S${slNum(o.nozzleTemp, 210)}`, 'G90', 'M82', 'G92 E0', 'M107');
  const travel = (nx, ny) => {
    const d = x == null ? 0 : Math.hypot(nx - x, ny - y);
    if (d > 2 && retr > 0 && !retracted) { E -= retr; out.push(`G1 E${f(E)} F2400`); retracted = true; }
    out.push(`G0 X${f(nx)} Y${f(ny)} F${sp.travel}`); time += d / sp.travel; x = nx; y = ny;
  };
  sl.layers.forEach((L, li) => {
    out.push(`;LAYER:${li}`, `G0 Z${f(L.z)} F${sp.travel}`);
    if (li === 1) out.push(`M106 S${Math.round(255 * (slNum(o.fan, 100) / 100))}`);
    for (const p of L.paths) {
      const pts = p.open ? p.pts : [...p.pts, p.pts[0]];
      travel(pts[0][0], pts[0][1]);
      if (retracted) { E += retr; out.push(`G1 E${f(E)} F2400`); retracted = false; }
      const feed = li === 0 ? sp.first : sp[p.kind] || sp.inner;
      let first = true;
      for (const q of pts.slice(1)) {
        const d = Math.hypot(q[0] - x, q[1] - y); if (d < 1e-6) continue;
        E += d * w * L.h / area; length += d; time += d / feed;
        out.push(`G1 X${f(q[0])} Y${f(q[1])} E${f(E)}${first ? ' F' + feed : ''}`); first = false; x = q[0]; y = q[1];
      }
    }
  });
  out.push('M107', 'M104 S0', 'M140 S0', `G91`, `G1 Z10 F600`, 'G90', 'G28 X0 Y0', 'M84');
  const filament = Math.max(0, E + (retracted ? retr : 0)), grams = filament * area / 1000 * (+o.density || 1.24);
  return { gcode: out.join('\n') + '\n', stats: { minutes: time, filament, grams, path: length } };
}
