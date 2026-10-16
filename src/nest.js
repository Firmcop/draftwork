// ===== Nesting: pack 2D part outlines onto sheets (raster bottom-left fill with 90° rotations) =====
import { makeGrid } from './camcore.js';
import { fillMask } from './slicer.js';

// part = { id, name, loops: [[x,y]...] (outer + holes, even-odd), qty }
// o = { width, height, gap, res, rotations: [0, 90, 180, 270], maxSheets }
const nestRot = (p, a) => a === 90 ? [-p[1], p[0]] : a === 180 ? [-p[0], -p[1]] : a === 270 ? [p[1], -p[0]] : [p[0], p[1]];
function partRaster(loops, ang, res, gap) {
  const L = loops.map(l => l.map(p => nestRot(p, ang)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of L) for (const p of l) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const pad = gap / 2 + res;
  const G = makeGrid(x0 - pad, y0 - pad, x1 + pad, y1 + pad, res);
  const M = fillMask(G, L);
  // grow by half the gap (square-ish dilation by cells) so neighbours keep the gap
  const r = Math.ceil(gap / 2 / res);
  let D = M;
  if (r > 0) {
    D = new Uint8Array(M.length);
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      if (!M[j * G.nx + i]) continue;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (di * di + dj * dj > r * r) continue; const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < G.nx && jj < G.ny) D[jj * G.nx + ii] = 1; }
    }
  }
  // keep only the filled cells as offsets (sparse) plus the bounding size
  const cells = [], core = []; let area = 0;
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { if (D[j * G.nx + i]) cells.push(i, j); if (M[j * G.nx + i]) core.push(i, j); }
  for (let k = 0; k < M.length; k++) area += M[k];
  return { nx: G.nx, ny: G.ny, cells, core, ox: G.x0, oy: G.y0, loops: L, area: area * res * res };
}
export function nestParts(parts, o) {
  const res = +o.res || 1, gap = (o.gap === '' || o.gap == null || !Number.isFinite(+o.gap)) ? 2 : Math.max(0, +o.gap), W = +o.width, H = +o.height, edge = +o.margin || 0;
  const rots = (o.rotations || [0, 90, 180, 270]).filter(a => [0, 90, 180, 270].includes(a));
  const SW = Math.floor((W - 2 * edge) / res), SH = Math.floor((H - 2 * edge) / res);
  if (!(SW > 0 && SH > 0)) throw new Error('The sheet is too small');
  // instances, largest first
  const inst = [];
  for (const p of parts) for (let q = 0; q < Math.max(0, Math.round(+p.qty || 0)); q++) inst.push(p);
  const rasters = new Map(); const R = (p, a) => { const k = p.id + ':' + a; if (!rasters.has(k)) rasters.set(k, partRaster(p.loops, a, res, gap)); return rasters.get(k); };
  inst.sort((a, b) => R(b, 0).area - R(a, 0).area);
  const sheets = [], unplaced = [];
  const newSheet = () => { const s = { occ: new Uint8Array(SW * SH), placed: [], used: 0 }; sheets.push(s); return s; };
  // the part itself must lie on the sheet; its gap halo may hang over the edge but must not touch another part's halo
  const fits = (s, r, X, Y) => {
    for (let k = 0; k < r.core.length; k += 2) { const i = X + r.core[k], j = Y + r.core[k + 1]; if (i < 0 || j < 0 || i >= SW || j >= SH) return false; }
    for (let k = 0; k < r.cells.length; k += 2) { const i = X + r.cells[k], j = Y + r.cells[k + 1]; if (i >= 0 && j >= 0 && i < SW && j < SH && s.occ[j * SW + i]) return false; }
    return true;
  };
  // the gap is already in each raster; keep the actual outline inside the sheet by allowing the padding to hang over the edge
  for (const p of inst) {
    let done = false;
    for (const s of sheets.length ? sheets : [newSheet()]) {
      let best = null;
      for (const a of rots) {
        const r = R(p, a), hang = Math.ceil(gap / 2 / res) + 1;
        for (let Y = -hang; Y <= SH - r.ny + hang && !(best && Y > best.Y); Y++) {
          for (let X = -hang; X <= SW - r.nx + hang; X++) {
            if (fits(s, r, X, Y)) { if (!best || Y < best.Y || (Y === best.Y && X < best.X)) best = { X, Y, a, r }; break; }
          }
        }
      }
      if (best) { place(s, best, p); done = true; break; }
    }
    if (!done) {
      if (sheets.length >= (+o.maxSheets || 20)) { unplaced.push(p.name); continue; }
      const s = newSheet(); let best = null;
      for (const a of rots) { const r = R(p, a), hang = Math.ceil(gap / 2 / res) + 1; for (let Y = -hang; Y <= SH - r.ny + hang && !best; Y++) for (let X = -hang; X <= SW - r.nx + hang; X++) if (fits(s, r, X, Y)) { best = { X, Y, a, r }; break; } if (best) break; }
      if (best) place(s, best, p); else { sheets.pop(); unplaced.push(p.name); }
    }
  }
  function place(s, b, p) {
    for (let k = 0; k < b.r.cells.length; k += 2) { const i = b.X + b.r.cells[k], j = b.Y + b.r.cells[k + 1]; if (i >= 0 && j >= 0 && i < SW && j < SH) s.occ[j * SW + i] = 1; }
    // sheet coordinates of the outline: cell (X, Y) of the sheet holds raster cell (0, 0) at raster origin ox, oy
    const dx = edge + b.X * res - b.r.ox, dy = edge + b.Y * res - b.r.oy;
    s.placed.push({ id: p.id, name: p.name, angle: b.a, dx, dy, loops: b.r.loops.map(l => l.map(q => [q[0] + dx, q[1] + dy])) });
    s.used += b.r.area;
  }
  return { sheets: sheets.map(s => ({ placed: s.placed, utilisation: s.used / (W * H) })), unplaced, width: W, height: H };
}
export function nestDXF(nest) {
  const o = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const line = (a, b, layer) => o.push('0', 'LINE', '8', layer, '10', a[0].toFixed(4), '20', a[1].toFixed(4), '11', b[0].toFixed(4), '21', b[1].toFixed(4));
  nest.sheets.forEach((s, k) => {
    const ox = k * (nest.width + 50);   // sheets side by side
    const c = [[0, 0], [nest.width, 0], [nest.width, nest.height], [0, nest.height]];
    for (let i = 0; i < 4; i++) line([c[i][0] + ox, c[i][1]], [c[(i + 1) % 4][0] + ox, c[(i + 1) % 4][1]], 'SHEET');
    for (const p of s.placed) for (const L of p.loops) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; line([a[0] + ox, a[1]], [b[0] + ox, b[1]], 'PARTS'); }
  });
  o.push('0', 'ENDSEC', '0', 'EOF');
  return o.join('\n') + '\n';
}
