// ===== Geometry kernel: sketches -> solids via feature history =====
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

export const PLANES = {
  XY: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1], label: 'Top (XY)' },
  XZ: { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0], label: 'Front (XZ)' },
  YZ: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0], label: 'Right (YZ)' },
};
const EPS = { join: 0.004, cut: 0.02 }; // overlap added to tools so faces never coincide exactly
const CIRCLE_SEG = 72;
const ARC_SEG = 12;

// A plane is 'XY' | 'XZ' | 'YZ' or a picked frame { o, x, n } (origin, in-plane X direction, normal).
export function planeBasis(plane) {
  if (plane && typeof plane === 'object') {
    const n = new THREE.Vector3(...plane.n).normalize(), u = new THREE.Vector3(...plane.x).normalize();
    return { u, v: n.clone().cross(u), n, o: new THREE.Vector3(...plane.o) };
  }
  const p = PLANES[plane] || PLANES.XY;
  return { u: new THREE.Vector3(...p.u), v: new THREE.Vector3(...p.v), n: new THREE.Vector3(...p.n), o: new THREE.Vector3() };
}
export function frameFromPoint(point, normal) {
  const n = normal.clone().normalize();
  let x = new THREE.Vector3(1, 0, 0).sub(n.clone().multiplyScalar(n.x));
  if (x.lengthSq() < 1e-6) x = new THREE.Vector3(0, 1, 0).sub(n.clone().multiplyScalar(n.y));
  x.normalize();
  const r = v => Math.round(v * 1e6) / 1e6;
  return { o: [r(point.x), r(point.y), r(point.z)], x: [r(x.x), r(x.y), r(x.z)], n: [r(n.x), r(n.y), r(n.z)] };
}
// flip mirrors the sketch's Y axis and normal, so a plane can face the other way (e.g. a bottom face).
export function planeMatrix(plane, offset = 0, flip = false) {
  const { u, v, n, o } = planeBasis(plane);
  const pos = o.clone().add(n.clone().multiplyScalar(offset || 0));
  if (flip) { v.negate(); n.negate(); }
  const m = new THREE.Matrix4().makeBasis(u, v, n);
  m.setPosition(pos);
  return m;
}

// ---- 2D profiles -> closed polygons (CCW) ----
export function profilePolygon(pr) {
  const s = new THREE.Shape();
  let div = ARC_SEG;
  let rot = 0, ox = pr.cx || 0, oy = pr.cy || 0;
  switch (pr.kind) {
    case 'rect': {
      const w = Math.abs(pr.w), h = Math.abs(pr.h);
      const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
      const r = Math.max(0, Math.min(pr.r || 0, w / 2 - 1e-3, h / 2 - 1e-3));
      if (r <= 1e-3) { s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); }
      else {
        s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
        s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
        s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
        s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, 1.5 * Math.PI, false);
      }
      rot = (pr.rot || 0) * Math.PI / 180;
      break;
    }
    case 'circle': s.absarc(0, 0, Math.abs(pr.r), 0, Math.PI * 2, false); div = CIRCLE_SEG; break;
    case 'polygon': {
      const n = Math.max(3, Math.min(64, Math.round(pr.sides || 6)));
      const a0 = (pr.rot || 0) * Math.PI / 180 + Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + i * 2 * Math.PI / n;
        const x = Math.abs(pr.r) * Math.cos(a), y = Math.abs(pr.r) * Math.sin(a);
        i ? s.lineTo(x, y) : s.moveTo(x, y);
      }
      break;
    }
    case 'slot': {
      const W = Math.abs(pr.width), r = W / 2;
      const a = Math.max(0, Math.abs(pr.length) / 2 - r);
      s.moveTo(-a, -r); s.lineTo(a, -r); s.absarc(a, 0, r, -Math.PI / 2, Math.PI / 2, false);
      s.lineTo(-a, r); s.absarc(-a, 0, r, Math.PI / 2, 1.5 * Math.PI, false);
      div = 24; rot = (pr.rot || 0) * Math.PI / 180;
      break;
    }
    case 'loop': {
      const pts = [];
      for (const sg of pr.segs || []) {
        pts.push(new THREE.Vector2(sg.a[0], sg.a[1]));
        if (sg.t === 'bez') { for (let i = 1; i < 24; i++) { const q = bezPoint(sg.P, i / 24); pts.push(new THREE.Vector2(q[0], q[1])); } }
        else if (sg.t === 'arc') {
          const { r, a0, a1 } = arcMid(sg), n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (2 * Math.PI) * CIRCLE_SEG));
          for (let i = 1; i < n; i++) { const t = a0 + (a1 - a0) * i / n; pts.push(new THREE.Vector2(sg.c[0] + r * Math.cos(t), sg.c[1] + r * Math.sin(t))); }
        }
      }
      if (pts.length < 3) throw new Error('A loop needs at least 3 points');
      if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
      return pts;
    }
    case 'poly': {
      const pts = (pr.pts || []).map(q => new THREE.Vector2(+q.x || 0, +q.y || 0));
      if (pts.length < 3) throw new Error('A line profile needs at least 3 points');
      if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
      return pts;
    }
    default: throw new Error('Unknown profile type');
  }
  let pts = s.getPoints(div);
  // drop duplicate closing / consecutive points
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q.distanceToSquared(p) > 1e-10) out.push(p);
  }
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 1e-10) out.pop();
  const c = Math.cos(rot), sn = Math.sin(rot);
  pts = out.map(p => new THREE.Vector2(ox + p.x * c - p.y * sn, oy + p.x * sn + p.y * c));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  return pts;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function polyContains(poly, p) { return pointInPoly(p, poly); }
export function polyArea(poly) { return Math.abs(THREE.ShapeUtils.area(poly)); }

// Nesting: a profile fully inside another becomes a hole; inside a hole becomes an island.
export function buildRegions(profiles) {
  const polys = profiles.map(profilePolygon);
  const areas = polys.map(polyArea);
  const n = polys.length;
  const depth = new Array(n).fill(0), parent = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (i === j || areas[j] <= areas[i]) continue;
      const step = Math.max(1, Math.floor(polys[i].length / 24));
      let all = true;
      for (let k = 0; k < polys[i].length; k += step) if (!pointInPoly(polys[i][k], polys[j])) { all = false; break; }
      if (all) { depth[i]++; if (best < 0 || areas[j] < areas[best]) best = j; }
    }
    parent[i] = best;
  }
  const regions = [];
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2) continue;
    const holes = [];
    for (let k = 0; k < n; k++) if (parent[k] === i && depth[k] === depth[i] + 1) holes.push(polys[k]);
    regions.push({ outer: polys[i], holes, index: i });
  }
  return { regions, polys };
}

// ---- mesh helpers ----
function prep(g) {
  let geo = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
  geo.clearGroups();
  // drop zero-area triangles (sphere poles, cone tips)
  const p = geo.attributes.position.array, keep = [];
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz > 1e-16) for (let k = 0; k < 9; k++) keep.push(p[i + k]);
  }
  if (keep.length !== p.length) geo.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  geo.computeVertexNormals();
  return geo;
}
function flip(g) {
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) {
    const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t;
  }
  g.attributes.position.needsUpdate = true;
}
export function signedVolume(g) {
  const p = g.attributes.position.array; let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2], bx = p[i + 3], by = p[i + 4], bz = p[i + 5], cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
export function surfaceArea(g) {
  const p = g.attributes.position.array; let s = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.length; i += 9) {
    a.set(p[i], p[i + 1], p[i + 2]); b.set(p[i + 3], p[i + 4], p[i + 5]); c.set(p[i + 6], p[i + 7], p[i + 8]);
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s;
}

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false;
const OPS = { join: ADDITION, cut: SUBTRACTION, intersect: INTERSECTION };
function csg(a, b, op) {
  const A = new Brush(a), B = new Brush(b);
  A.updateMatrixWorld(); B.updateMatrixWorld();
  const r = evaluator.evaluate(A, B, OPS[op]);
  return prep(r.geometry);
}

// ---- feature tools ----
// Closed areas a feature uses from a sketch: legacy profiles (nested ones become holes) + picked regions.
export function sketchAreas(sk, refs) {
  const use = sketchUse(sk, refs);
  const { regions } = buildRegions(use.profiles);
  const out = regions.map(r => ({ outer: r.outer, holes: r.holes }));
  for (const rg of use.regions) out.push({ outer: profilePolygon({ kind: 'loop', segs: rg.outer }), holes: rg.holes.map(h => profilePolygon({ kind: 'loop', segs: h })) });
  return out;
}
export function extrudeTool(sk, f, extend, M) {
  const regions = sketchAreas(sk, f.regions);
  if (!regions.length) throw new Error(f.regions?.length ? 'The picked profiles no longer exist. Edit this feature and pick them again.' : 'The sketch has no closed profiles to extrude');
  const d = Math.abs(+f.distance);
  if (!(d > 0)) throw new Error('Distance must be greater than 0 mm');
  let z0, z1;
  if (f.direction === 'reverse') { z0 = -d; z1 = 0; }
  else if (f.direction === 'symmetric') { z0 = -d / 2; z1 = d / 2; }
  else { z0 = 0; z1 = d; }
  if (extend) { const e = EPS[extend] || 0; z0 -= e; z1 += e; }
  let tool = null;
  for (const r of regions) {
    const shape = new THREE.Shape(r.outer);
    shape.holes = r.holes.map(h => new THREE.Path(h));
    let g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1, steps: 1 });
    g.translate(0, 0, z0);
    g = prep(g);
    tool = tool ? csg(tool, g, 'join') : g;
  }
  tool.applyMatrix4(M);
  return tool;
}

function revolveContour(poly, axis, angleDeg) {
  const full = angleDeg >= 359.999;
  const A = (full ? 360 : angleDeg) * Math.PI / 180;
  const S = Math.max(8, Math.ceil(96 * A / (2 * Math.PI)));
  let ra = poly.map(p => axis === 'u' ? [p.y, p.x] : [p.x, p.y]);
  const rs = ra.map(q => q[0]);
  const minR = Math.min(...rs), maxR = Math.max(...rs);
  if (minR < -1e-6 && maxR > 1e-6) throw new Error('The profile crosses the revolve axis');
  if (maxR <= 1e-6) ra = ra.map(([r, a]) => [-r, a]);
  ra = ra.map(([r, a]) => [Math.max(r, 0), a]);
  if (THREE.ShapeUtils.isClockWise(ra.map(([r, a]) => new THREE.Vector2(r, a)))) ra.reverse();
  const local = (r, a, t) => axis === 'u' ? [a, r * Math.cos(t), r * Math.sin(t)] : [r * Math.cos(t), a, -r * Math.sin(t)];
  const n = ra.length, rings = full ? S : S + 1, P = [];
  for (let k = 0; k < rings; k++) { const t = A * k / S; for (const [r, a] of ra) P.push(local(r, a, t)); }
  const idx = (k, i) => (full ? k % S : k) * n + (i % n);
  const tris = [];
  for (let k = 0; k < S; k++) for (let i = 0; i < n; i++) {
    const a = idx(k, i), b = idx(k + 1, i), c = idx(k + 1, i + 1), d = idx(k, i + 1);
    tris.push([a, b, c], [a, c, d]);
  }
  if (!full) {
    const faces = THREE.ShapeUtils.triangulateShape(ra.map(([r, a]) => new THREE.Vector2(r, a)), []);
    for (const [x, y, z] of faces) { tris.push([idx(0, x), idx(0, z), idx(0, y)]); tris.push([idx(S, x), idx(S, y), idx(S, z)]); }
  }
  const pos = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    va.fromArray(P[a]); vb.fromArray(P[b]); vc.fromArray(P[c]);
    if (vb.clone().sub(va).cross(vc.clone().sub(va)).lengthSq() < 1e-14) continue;
    pos.push(...P[a], ...P[b], ...P[c]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (signedVolume(g) < 0) flip(g);
  g.computeVertexNormals();
  return g;
}

export function revolveTool(sk, f, M) {
  const regions = sketchAreas(sk, f.regions);
  if (!regions.length) throw new Error('The sketch has no closed profiles to revolve');
  const ang = Math.min(360, Math.abs(+f.angle));
  if (!(ang > 0)) throw new Error('Angle must be greater than 0°');
  let tool = null;
  for (const r of regions) {
    if (f.axis && f.axis !== 'u' && f.axis !== 'v') throw new Error('Revolving around a construction axis needs the exact engine');
    let g = revolveContour(r.outer, f.axis, ang);
    for (const h of r.holes) g = csg(g, revolveContour(h, f.axis, ang), 'cut');
    tool = tool ? csg(tool, g, 'join') : g;
  }
  tool.applyMatrix4(M);
  return tool;
}

const pos = (v, name) => { if (!(+v > 0)) throw new Error(name + ' must be greater than 0 mm'); return +v; };
// Primitive solids placed on a plane: local Z is the plane normal.
export function primitiveTool(f, M, extend) {
  const e = extend ? (EPS[extend] || 0) : 0;
  const cx = +f.cx || 0, cy = +f.cy || 0;
  let g;
  switch (f.type) {
    case 'box': {
      const w = pos(f.w, 'Length'), d = pos(f.d, 'Width'), h = pos(f.h, 'Height');
      g = new THREE.BoxGeometry(w, d, h + 2 * e); g.translate(cx, cy, h / 2);
      break;
    }
    case 'cylinder': {
      const r = pos(f.diameter, 'Diameter') / 2, h = pos(f.h, 'Height');
      g = new THREE.CylinderGeometry(r, r, h + 2 * e, 72, 1, false); g.rotateX(Math.PI / 2); g.translate(cx, cy, h / 2);
      break;
    }
    case 'sphere': {
      const r = pos(f.diameter, 'Diameter') / 2;
      g = new THREE.SphereGeometry(r, 64, 32); g.translate(cx, cy, 0);
      break;
    }
    case 'torus': {
      const R = pos(f.major, 'Major diameter') / 2, r = pos(f.minor, 'Minor diameter') / 2;
      if (r >= R) throw new Error('Minor diameter must be smaller than the major diameter');
      g = new THREE.TorusGeometry(R, r, 32, 96); g.translate(cx, cy, 0);
      break;
    }
    case 'hole': {
      const r = pos(f.diameter, 'Diameter') / 2, depth = pos(f.depth, 'Depth');
      const pts = [[0, 0.03]];
      if (f.cbore) {
        const R = pos(f.cbDiameter, 'Counterbore diameter') / 2, cd = pos(f.cbDepth, 'Counterbore depth');
        if (R <= r) throw new Error('Counterbore diameter must be larger than the hole diameter');
        if (cd >= depth) throw new Error('Counterbore depth must be less than the hole depth');
        pts.push([R, 0.03], [R, -cd], [r, -cd]);
      } else pts.push([r, 0.03]);
      // flat bottoms overshoot slightly so a hole as deep as the part never ends on a coplanar face
      const bottom = -depth - (f.tip === false ? EPS.cut : 0);
      pts.push([r, bottom]);
      const tipH = f.tip === false ? 0 : r / Math.tan(((+f.tipAngle || 118) / 2) * Math.PI / 180);
      pts.push([0, bottom - tipH]);
      g = revolveContour(pts.map(([x, y]) => new THREE.Vector2(x, y)), 'v', 360);
      g.rotateX(Math.PI / 2); g.translate(cx, cy, 0);
      break;
    }
    default: throw new Error('Unknown primitive');
  }
  g = prep(g);
  g.applyMatrix4(M);
  return g;
}

const AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
function patternMatrices(f, res) {
  const count = Math.max(2, Math.min(50, Math.round(+f.count || 2)));
  const axisAt = (k, dflt) => AXES[k] ? { o: [0, 0, 0], d: AXES[k] } : k ? axisOf(k, res) : { o: [0, 0, 0], d: AXES[dflt] };
  const A1 = axisAt(f.axis, f.kind === 'circular' ? 'Z' : 'X'), axis = new THREE.Vector3(...A1.d), at = new THREE.Vector3(...A1.o);
  const ms = [];
  if (f.kind === 'circular') {
    const total = Math.min(360, Math.abs(+f.angle || 360));
    const step = total >= 359.999 ? (2 * Math.PI) / count : (total * Math.PI / 180) / (count - 1);
    for (let i = 1; i < count; i++) ms.push(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeRotationAxis(axis, step * i)).multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z)));
  } else {
    const count2 = Math.max(1, Math.min(50, Math.round(+f.count2 || 1)));
    const axis2 = new THREE.Vector3(...axisAt(f.axis2, 'Y').d);
    for (let j = 0; j < count2; j++) for (let i = 0; i < count; i++) {
      if (!i && !j) continue;
      ms.push(new THREE.Matrix4().makeTranslation(axis.clone().multiplyScalar((+f.spacing || 0) * i).add(axis2.clone().multiplyScalar((+f.spacing2 || 0) * j))));
    }
  }
  return ms;
}
function mirrorGeom(g, plane, res) {
  const m = g.clone();
  if (['XY', 'XZ', 'YZ', undefined, null, ''].includes(plane)) { const s = plane === 'XY' ? [1, 1, -1] : plane === 'XZ' ? [1, -1, 1] : [-1, 1, 1]; m.applyMatrix4(new THREE.Matrix4().makeScale(...s)); }
  else {   // reflect through a construction plane: I - 2 n nᵀ about its origin
    const p = resolvePlane(plane, res), M = planeMatrix(p.base, p.offset, p.flip), e = M.elements, n = new THREE.Vector3(e[8], e[9], e[10]).normalize(), o = new THREE.Vector3(e[12], e[13], e[14]);
    const R = new THREE.Matrix4().set(1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0, -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0, -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0, 0, 0, 0, 1);
    m.applyMatrix4(new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z)));
  }
  flip(m); m.computeVertexNormals();
  return m;
}
function boxesOverlap(a, b) {
  a.computeBoundingBox(); b.computeBoundingBox();
  return a.boundingBox.intersectsBox(b.boundingBox);
}
function mergeSimple(a, b) {
  const pa = a.attributes.position.array, pb = b.attributes.position.array;
  const p = new Float32Array(pa.length + pb.length); p.set(pa); p.set(pb, pa.length);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.computeVertexNormals();
  return g;
}
const triCount = g => g.attributes.position.count / 3;

// ---- planes ----
export function resolvePlane(ref, out) {
  if (PLANES[ref]) return { base: ref, offset: 0, flip: false };
  if (ref && typeof ref === 'object') return { base: ref, offset: 0, flip: false };
  const p = out.planes.get(ref);
  if (!p) throw new Error('Its plane is missing. Choose another plane.');
  return p;
}
// ---- construction geometry: planes (offset, at angle, midplane, tangent, three points), axes, points ----
const ORIGIN_AXES = { X: { o: [0, 0, 0], d: [1, 0, 0] }, Y: { o: [0, 0, 0], d: [0, 1, 0] }, Z: { o: [0, 0, 0], d: [0, 0, 1] } };
export function axisOf(ref, out) {
  if (ORIGIN_AXES[ref]) return ORIGIN_AXES[ref];
  const a = out.axes?.get(ref); if (!a) throw new Error('Its axis is missing. Choose another axis.');
  return a;
}
function frameOfMatrix(M) {
  const e = M.elements, r = v => Math.round(v * 1e9) / 1e9;
  return { o: [r(e[12]), r(e[13]), r(e[14])], x: [r(e[0]), r(e[1]), r(e[2])], n: [r(e[8]), r(e[9]), r(e[10])] };
}
const V3 = a => new THREE.Vector3(...a);
function planeOfRef(ref, out) { const p = resolvePlane(ref, out); return planeMatrix(p.base, p.offset, p.flip); }
function constructStep(f, out) {
  if (f.type === 'axis') {
    let o, d;
    if (f.mode === 'edge' || f.mode === 'cyl') { if (!f.o || !f.d) throw new Error(f.mode === 'cyl' ? 'Click a cylindrical face' : 'Click a straight edge'); o = f.o; d = f.d; }
    else if (f.mode === 'planes') {
      const A = planeOfRef(f.base || 'XY', out), B = planeOfRef(f.base2 || 'XZ', out), fa = frameOfMatrix(A), fb = frameOfMatrix(B);
      const n1 = V3(fa.n), n2 = V3(fb.n), dir = n1.clone().cross(n2); if (dir.lengthSq() < 1e-12) throw new Error('The two planes are parallel, so they do not meet in a line');
      const d1 = n1.dot(V3(fa.o)), d2 = n2.dot(V3(fb.o)), pt = n2.clone().cross(dir).multiplyScalar(d1).add(dir.clone().cross(n1).multiplyScalar(d2)).divideScalar(dir.lengthSq());
      o = pt.toArray(); d = dir.normalize().toArray();
    } else {
      const p1 = f.p1 || [0, 0, 0], p2 = f.p2 || [0, 0, 10], dv = V3(p2).sub(V3(p1));
      if (dv.lengthSq() < 1e-12) throw new Error('The two points are the same');
      o = p1; d = dv.normalize().toArray();
    }
    const l = Math.hypot(...d); out.axes.set(f.id, { o, d: d.map(v => v / l) }); return true;
  }
  if (f.type === 'point') {
    let p;
    if (f.mode === 'vertex') { if (!f.p) throw new Error('Click a corner on the model'); p = f.p; }
    else if (f.mode === 'center') { if (!f.p) throw new Error('Click a round edge on the model'); p = f.p; }
    else p = [+f.x || 0, +f.y || 0, +f.z || 0];
    out.points.set(f.id, { p }); return true;
  }
  if (f.type !== 'plane') return false;
  const mode = f.mode || 'offset';
  if (mode === 'offset') {
    const p = resolvePlane(f.base || 'XY', out);
    out.planes.set(f.id, { base: p.base, offset: p.offset + (+f.offset || 0), flip: !!p.flip !== !!f.flip });
    return true;
  }
  let frame;
  if (mode === 'angle') {
    const M = planeOfRef(f.base || 'XY', out), fr = frameOfMatrix(M);
    let ax;
    if (f.axis === 'u' || f.axis === 'v' || !f.axis) { const e = M.elements, dir = f.axis === 'v' ? [e[4], e[5], e[6]] : [e[0], e[1], e[2]]; ax = { o: fr.o, d: dir }; }
    else ax = axisOf(f.axis, out);
    const R = new THREE.Matrix4().makeTranslation(...ax.o).multiply(new THREE.Matrix4().makeRotationAxis(V3(ax.d).normalize(), THREE.MathUtils.degToRad(+f.angle || 0))).multiply(new THREE.Matrix4().makeTranslation(...ax.o.map(v => -v)));
    frame = frameOfMatrix(M.clone().premultiply(R));
  } else if (mode === 'mid') {
    const A = frameOfMatrix(planeOfRef(f.base || 'XY', out)), B = frameOfMatrix(planeOfRef(f.base2 || f.base || 'XY', out));
    const n1 = V3(A.n), n2 = V3(B.n); if (n1.dot(n2) < 0) n2.negate();
    const d1 = n1.dot(V3(A.o)), d2 = n2.dot(V3(B.o));
    if (n1.clone().cross(n2).lengthSq() < 1e-10) { const o = V3(A.o).add(n1.clone().multiplyScalar((d2 - d1) / 2)); frame = { o: o.toArray(), x: A.x, n: A.n }; }
    else { const nb = n1.clone().sub(n2), db = d1 - d2, o = nb.clone().multiplyScalar(db / nb.lengthSq()); frame = frameFromPoint(o, nb.normalize()); }
  } else if (mode === 'tangent') {
    if (!f.frame) throw new Error('Click a curved face where the plane should touch');
    frame = f.frame;
  } else if (mode === '3pt') {
    const [a, b, c] = [f.p1, f.p2, f.p3]; if (!a || !b || !c) throw new Error('Pick three points');
    const u = V3(b).sub(V3(a)), w = V3(c).sub(V3(a)), n = u.clone().cross(w);
    if (n.lengthSq() < 1e-12) throw new Error('The three points are in a line');
    frame = { o: a, x: u.normalize().toArray(), n: n.normalize().toArray() };
  } else throw new Error('Unknown plane type');
  out.planes.set(f.id, { base: frame, offset: +f.offset || 0, flip: !!f.flip });
  return true;
}
function placement(f, out) {
  const p = resolvePlane(f.plane || 'XY', out);
  return planeMatrix(p.base, p.offset + (+f.offset || 0), !!f.flip !== !!p.flip);
}

// ---- bodies ----
function newBody(out, id, geom, fid) {
  out.bodyCount++;
  out.bodies.set(id, { id, name: 'Body ' + out.bodyCount, geom, feature: fid });
  out.lastBody = id;
}
function replaceBody(out, id, geom) {
  const b = out.bodies.get(id);
  if (!geom || triCount(geom) === 0) { out.bodies.delete(id); if (out.lastBody === id) out.lastBody = [...out.bodies.keys()].pop() || null; return; }
  out.bodies.set(id, { ...b, geom });
}
function defaultTarget(out, target) {
  if (target && out.bodies.has(target)) return target;
  if (out.lastBody && out.bodies.has(out.lastBody)) return out.lastBody;
  return [...out.bodies.keys()].pop() || null;
}
// Applies a tool solid with Fusion-style operations: new body, join, cut, intersect.
function applyTool(out, f, tool, op, target, idSuffix = '') {
  if (op === 'new' || out.bodies.size === 0) {
    if ((op === 'cut' || op === 'intersect') && out.bodies.size === 0) throw new Error('There is no body to ' + op + ' yet. Use New Body first.');
    newBody(out, f.id + idSuffix, tool.clone(), f.id);
    return { op: 'new', target: f.id + idSuffix };
  }
  if (op === 'join') {
    const id = defaultTarget(out, target);
    replaceBody(out, id, csg(out.bodies.get(id).geom, tool, 'join')); out.lastBody = id;
    return { op, target: id };
  }
  if (op === 'cut') {
    const ids = target && out.bodies.has(target) ? [target] : [...out.bodies.keys()];
    let hit = false;
    for (const id of ids) {
      const b = out.bodies.get(id);
      if (!boxesOverlap(b.geom, tool)) continue;
      hit = true; replaceBody(out, id, csg(b.geom, tool, 'cut'));
    }
    if (!hit) throw new Error('The cut does not touch any body');
    return { op, target: target || null };
  }
  if (op === 'intersect') {
    const id = defaultTarget(out, target);
    replaceBody(out, id, csg(out.bodies.get(id).geom, tool, 'intersect'));
    return { op, target: id };
  }
  throw new Error('Unknown operation');
}

const SOLID_TYPES = new Set(['extrude', 'revolve', 'box', 'cylinder', 'sphere', 'torus', 'hole']);
export const FEATURE_TYPES = ['sketch', 'plane', 'extrude', 'revolve', 'box', 'cylinder', 'sphere', 'torus', 'hole', 'pattern', 'mirror', 'move', 'combine', 'remove'];

function cloneOut(o) {
  return { bodies: new Map(o.bodies), bodyCount: o.bodyCount, lastBody: o.lastBody, sketches: new Map(o.sketches), planes: new Map(o.planes), axes: new Map(o.axes), points: new Map(o.points),
    status: new Map(o.status), tools: new Map(o.tools), before: new Map(o.before) };
}
// Replays the feature history up to and including index `upto` (null = all).
// `cache` (optional array) keeps the state after each feature so edits replay only from the changed feature on.
export function regenerate(features, upto = null, cache = null) {
  let out = { bodies: new Map(), bodyCount: 0, lastBody: null, sketches: new Map(), planes: new Map(), axes: new Map(), points: new Map(), status: new Map(), tools: new Map(), before: new Map() };
  const end = upto == null ? features.length : Math.min(upto + 1, features.length);
  let key = '', reuse = !!cache;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (i >= end) { out.status.set(f.id, { state: 'rolled' }); continue; }
    key += '|' + JSON.stringify(f);
    if (reuse && cache[i] && cache[i].key === key) { out = cloneOut(cache[i].out); continue; }
    reuse = false;
    step(f, out);
    if (cache) { cache[i] = { key, out: cloneOut(out) }; cache.length = i + 1; }
  }
  return out;
}

function step(f, out) {
  out.before.set(f.id, [...out.bodies.values()].map(b => b.id));
  if (f.suppressed) { out.status.set(f.id, { state: 'suppressed' }); return; }
  try {
    if (f.error) throw new Error(f.error);
    if (constructStep(f, out)) { /* plane, axis or point */ }
    else if (f.type === 'sketch') {
      out.sketches.set(f.id, { matrix: placement(f, out), feature: sketchWithGeo(f) });
    } else if (SOLID_TYPES.has(f.type)) {
      const op = f.type === 'hole' ? 'cut' : (f.op || 'join');
      const ext = out.bodies.size && (op === 'join' || op === 'cut') ? op : null;
      let tool;
      if (f.type === 'extrude' || f.type === 'revolve') {
        const sk = out.sketches.get(f.sketch);
        if (!sk) throw new Error('Choose a sketch that comes before this feature');
        tool = f.type === 'extrude' ? extrudeTool(sk.feature, f, ext, sk.matrix) : revolveTool(sk.feature, f, sk.matrix);
      } else tool = primitiveTool(f, placement(f, out), ext);
      const res = applyTool(out, f, tool, op, f.target);
      out.tools.set(f.id, { geom: tool, ...res, op });
    } else if (f.type === 'pattern' || f.type === 'mirror') {
      const src = out.tools.get(f.source);
      if (!src) throw new Error('Choose a feature that comes before this one');
      const copies = f.type === 'mirror' ? [mirrorGeom(src.geom, f.plane, out)] : patternMatrices(f, out).map(m => src.geom.clone().applyMatrix4(m));
      if (src.op === 'new') {
        copies.forEach((g, k) => applyTool(out, f, g, 'new', null, ':' + (k + 1)));
        out.tools.set(f.id, { geom: copies.reduce((a, b) => mergeSimple(a, b)), op: 'new' });
      } else {
        let tool = null;
        for (const g of copies) tool = tool ? (boxesOverlap(tool, g) ? csg(tool, g, 'join') : mergeSimple(tool, g)) : g;
        const res = applyTool(out, f, tool, src.op, src.target);
        out.tools.set(f.id, { geom: tool, ...res, op: src.op });
      }
    } else if (f.type === 'move') {
      const b = out.bodies.get(f.body);
      if (!b) throw new Error('Choose a body to move');
      const d2r = Math.PI / 180;
      const m = new THREE.Matrix4().makeTranslation(+f.dx || 0, +f.dy || 0, +f.dz || 0)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((+f.rx || 0) * d2r, (+f.ry || 0) * d2r, (+f.rz || 0) * d2r, 'XYZ')));
      const g = b.geom.clone().applyMatrix4(m);
      if (f.copy) newBody(out, f.id, g, f.id); else replaceBody(out, b.id, g);
    } else if (f.type === 'combine') {
      const t = out.bodies.get(f.target);
      if (!t) throw new Error('Choose a target body');
      const tools = (f.tools || []).filter(id => id !== f.target && out.bodies.has(id));
      if (!tools.length) throw new Error('Choose at least one tool body');
      let g = t.geom;
      for (const id of tools) g = csg(g, out.bodies.get(id).geom, f.op || 'join');
      replaceBody(out, t.id, g);
      if (!f.keep) for (const id of tools) out.bodies.delete(id);
    } else if (f.type === 'remove') {
      if (!out.bodies.has(f.body)) throw new Error('Choose a body to remove');
      out.bodies.delete(f.body);
    } else if (['fillet', 'chamfer', 'shell', 'draft', 'presspull', 'loft', 'import', 'sweep'].includes(f.type)) {
      throw new Error('This needs the exact geometry engine, which has not loaded in this view');
    }
    out.status.set(f.id, { state: 'ok' });
  } catch (e) {
    out.status.set(f.id, { state: 'error', msg: e.message || String(e) });
  }
}

export function mergeBodies(geoms) {
  if (!geoms.length) return null;
  return geoms.reduce((a, b) => mergeSimple(a, b));
}

// ---- expressions: numbers, units-free arithmetic, parameters, functions ----
const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180),
  min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil };
export function evalExpr(src, vars = {}) {
  const s = String(src).replace(/\s*(mm|deg|°)\b/g, '').trim();
  let i = 0;
  const peek = () => s[i], eat = c => { if (s[i] === c) { i++; return true; } return false; };
  const ws = () => { while (s[i] === ' ') i++; };
  const err = m => { throw new Error(m); };
  function primary() {
    ws();
    if (eat('(')) { const v = expr(); ws(); if (!eat(')')) err('Missing )'); return v; }
    if (eat('-')) return -primary();
    if (eat('+')) return primary();
    const num = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length; ws();
      const name = id[0];
      if (FUNCS[name] && eat('(')) {
        const args = [expr()]; ws();
        while (eat(',')) { args.push(expr()); ws(); }
        if (!eat(')')) err('Missing )');
        return FUNCS[name](...args);
      }
      if (name === 'pi' || name === 'PI') return Math.PI;
      if (name in vars) return vars[name];
      err('Unknown name "' + name + '"');
    }
    err(i < s.length ? 'Unexpected "' + s[i] + '"' : 'Expression ends early');
  }
  function power() { let v = primary(); ws(); if (eat('^')) v = Math.pow(v, power()); return v; }
  function term() { let v = power(); for (;;) { ws(); if (eat('*')) v *= power(); else if (eat('/')) v /= power(); else return v; } }
  function expr() { let v = term(); for (;;) { ws(); if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } }
  if (!s) err('Enter a value');
  const v = expr(); ws();
  if (i < s.length) err('Unexpected "' + s[i] + '"');
  if (!isFinite(v)) err('The result is not a number');
  return v;
}
export function evalParams(params = []) {
  const vars = {}, errors = {};
  for (const p of params) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name || '')) { errors[p.name] = 'Names use letters, digits and _'; continue; }
    try { vars[p.name] = evalExpr(p.expr, vars); } catch (e) { errors[p.name] = e.message; }
  }
  return { vars, errors };
}
// Turns expression strings in features into numbers; a bad expression marks that feature with an error.
export function resolveFeatures(features, vars) {
  const conv = (obj, f) => {
    const o = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'name' || k === 'id' || k === 'error') { o[k] = v; continue; }
      if (typeof v === 'string' && NUMERIC.has(k)) {
        try { o[k] = evalExpr(v, vars); } catch (e) { o[k] = 0; f.error = f.error || (k + ': ' + e.message); }
      } else if (v && typeof v === 'object') o[k] = conv(v, f);
      else o[k] = v;
    }
    return o;
  };
  return features.map(f => { const holder = {}; const r = conv(f, holder); if (holder.error) r.error = holder.error; return r; });
}
const NUMERIC = new Set(['offset', 'distance', 'angle', 'count', 'count2', 'spacing', 'spacing2', 'cx', 'cy', 'w', 'h', 'd', 'r', 'rot', 'sides', 'length', 'width',
  'diameter', 'depth', 'cbDiameter', 'cbDepth', 'radius', 'thickness', 'value', 'neutralOffset', 'wall', 'pathIndex', 'major', 'minor', 'dx', 'dy', 'dz', 'rx', 'ry', 'rz', 'tipAngle', 'x', 'y']);

// ---- crease edges that tolerate T-junctions (boolean output) ----
// Edges are grouped by the infinite line they lie on; two triangles are neighbours when
// their edges on the same line overlap. An edge is drawn when a neighbour bends away.
export function featureEdges(g, angleDeg = 28) {
  const p = g.attributes.position.array, triCount = p.length / 9;
  const cosT = Math.cos(angleDeg * Math.PI / 180);
  const normals = new Float32Array(triCount * 3), reliable = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1e-30;
    const m2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2);
    reliable[t] = l > 2e-4 * Math.sqrt(m2) && l > 1e-7 ? 1 : 0;   // height under ~0.0001 mm: normal too noisy
    normals[t * 3] = nx / l; normals[t * 3 + 1] = ny / l; normals[t * 3 + 2] = nz / l;
  }
  const groups = new Map();
  const Q = v => Math.round(v * 200);          // direction quantum
  const QO = v => Math.round(v * 20);          // offset quantum (0.05 mm)
  for (let t = 0; t < triCount; t++) for (let e = 0; e < 3; e++) {
    const a = t * 9 + e * 3, b = t * 9 + ((e + 1) % 3) * 3;
    let dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
    const L = Math.hypot(dx, dy, dz); if (L < 1e-6) continue;
    dx /= L; dy /= L; dz /= L;
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && (dy < -1e-9 || (Math.abs(dy) <= 1e-9 && dz < 0)))) { dx = -dx; dy = -dy; dz = -dz; }
    const ta = p[a] * dx + p[a + 1] * dy + p[a + 2] * dz, tb = p[b] * dx + p[b + 1] * dy + p[b + 2] * dz;
    const ox = p[a] - ta * dx, oy = p[a + 1] - ta * dy, oz = p[a + 2] - ta * dz;
    const key = Q(dx) + ',' + Q(dy) + ',' + Q(dz) + '|' + QO(ox) + ',' + QO(oy) + ',' + QO(oz);
    let arr = groups.get(key); if (!arr) groups.set(key, arr = []);
    arr.push({ t, a, b, ta, tb, t0: Math.min(ta, tb), t1: Math.max(ta, tb) });
  }
  const out = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((x, y) => x.t0 - y.t0);
    for (let i = 0; i < arr.length; i++) {
      const E = arr[i];
      if (!reliable[E.t]) continue;
      // parameter of E's endpoints along the shared line direction
      const ta = E.ta, tb = E.tb, span = tb - ta;
      for (let j = 0; j < arr.length; j++) {
        if (i === j) continue;
        const F = arr[j];
        if (F.t0 >= E.t1 - 1e-4) break;
        if (F.t === E.t || F.t1 <= E.t0 + 1e-4 || !reliable[F.t]) continue;
        const d = normals[E.t * 3] * normals[F.t * 3] + normals[E.t * 3 + 1] * normals[F.t * 3 + 1] + normals[E.t * 3 + 2] * normals[F.t * 3 + 2];
        if (d >= cosT) continue;
        // draw only the stretch where the two edges overlap
        const s0 = (Math.max(E.t0, F.t0) - ta) / span, s1 = (Math.min(E.t1, F.t1) - ta) / span;
        for (const sv of [s0, s1]) for (let k = 0; k < 3; k++) out.push(p[E.a + k] + (p[E.b + k] - p[E.a + k]) * sv);
      }
    }
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return eg;
}

// ---- export ----
export function toBinarySTL(g, name = 'part') {
  const p = g.attributes.position.array, triCount = p.length / 9;
  const buf = new ArrayBuffer(84 + triCount * 50), dv = new DataView(buf);
  const header = ('Draftwork STL ' + name).slice(0, 79);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, triCount, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3();
  let o = 84;
  for (let i = 0; i < p.length; i += 9) {
    a.set(p[i], p[i + 1], p[i + 2]); b.set(p[i + 3], p[i + 4], p[i + 5]); c.set(p[i + 6], p[i + 7], p[i + 8]);
    const e1 = b.clone().sub(a), e2 = c.clone().sub(a); nrm.copy(e1.cross(e2)).normalize();
    for (const v of [nrm, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true); o += 12; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// Minimal store-only ZIP writer
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
