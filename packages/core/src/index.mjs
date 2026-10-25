// draftwork-core: open a Draftwork design, drive it with parameter values and suppression, rebuild it with the
// exact kernel, and export files, without the modeler's interface. Runs in Node (servers, scripts, tests) and in
// browsers (a configurator page or Web Worker). It calls the same engine host the modeler's worker uses.
import * as K from '../dist/kernel.mjs';

const VIEW_KINDS = ['front', 'top', 'right', 'left', 'back', 'bottom', 'iso'];

let enginePromise = null;

/**
 * Load OpenCascade once per process (or page) and return an engine.
 * Node: no options needed; the WebAssembly comes from node_modules.
 * Browser: pass { wasmBinary } (an ArrayBuffer or Uint8Array) and optionally { opencascade } (the glue's default export).
 */
export function createEngine(opts = {}) {
  if (!enginePromise) enginePromise = loadOC(opts).then(oc => { K.setOC(oc); return new Engine(); });
  return enginePromise;
}

// OpenCascade reports progress (e.g. while writing STEP) through print(); by default it would go to stdout, which
// belongs to the program using the core (an MCP server speaks its protocol there). Send it to stderr / the console.
const quietPrint = msg => { if (globalThis.process?.stderr?.write) globalThis.process.stderr.write(msg + '\n'); else console.debug(msg); };

async function loadOC({ wasmBinary, opencascade, print = quietPrint } = {}) {
  const factory = opencascade || (await import('replicad-opencascadejs')).default;
  if (!wasmBinary) {
    const [{ readFile }, { createRequire }] = await Promise.all([import('node:fs/promises'), import('node:module')]);
    const require = createRequire(import.meta.url);
    wasmBinary = await readFile(require.resolve('replicad-opencascadejs/wasm'));
  }
  return factory({ wasmBinary, print, printErr: print });
}

class Engine {
  /** Open a design (the JSON document the modeler saves). The document is copied; the original is never changed. */
  open(doc, opts = {}) { return new Model(doc, opts); }
  /** Evaluate one Draftwork expression against a set of variables (numbers only, as in the modeler). */
  evalExpr(expr, vars = {}) { return K.evalExpr(expr, vars); }
}

export class Model {
  constructor(doc, { files } = {}) {
    if (!doc || !Array.isArray(doc.features)) throw new Error('Not a Draftwork design: missing features');
    this.doc = structuredClone(doc);
    this.doc.params ||= [];
    this.files = files || this.doc.files || {};
    this.host = K.engineHost(K.RCmod);
    this.last = null;
    this.importsLoaded = false;
  }

  /** User parameters with their current expression, evaluated value and configurator metadata. */
  parameters() {
    const { vars, errors } = K.evalParams(this.doc.params);
    return this.doc.params.map(p => ({
      name: p.name, expr: String(p.expr), value: vars[p.name], error: errors[p.name] || null,
      comment: p.comment || '', role: p.role || 'internal', min: p.min ?? null, max: p.max ?? null, options: p.options ?? null,
    }));
  }

  /** Features in timeline order, for picking what a configuration may suppress. */
  features() { return this.doc.features.map(f => ({ id: f.id, name: f.name || f.id, type: f.type, suppressed: !!f.suppressed })); }

  /** Set parameters by name: numbers, or expression strings in Draftwork's syntax ("width/2", "25 mm"). */
  setParams(values) {
    for (const [name, v] of Object.entries(values)) {
      const p = this.doc.params.find(q => q.name === name);
      if (!p) throw new Error(`Unknown parameter "${name}"`);
      if (typeof v !== 'number' && typeof v !== 'string') throw new Error(`Parameter "${name}" takes a number or an expression`);
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`Parameter "${name}" must be finite`);
      p.expr = String(v);
    }
    return this;
  }

  /** Suppress (true) or restore (false) features, addressed by id or by their name in the timeline. */
  setSuppressed(map) {
    for (const [key, on] of Object.entries(map)) {
      const f = this.feature(key);
      f.suppressed = !!on;
    }
    return this;
  }

  feature(key) {
    const f = this.doc.features.find(x => x.id === key) || this.doc.features.find(x => x.name === key);
    if (!f) throw new Error(`Unknown feature "${key}"`);
    return f;
  }

  /**
   * Rebuild the whole history (the modeler's rollback marker is ignored: a configured product is always complete).
   * Applies the design's own configuration rules (doc.configRules) exactly as the modeler does.
   */
  async rebuild() {
    const t0 = Date.now();
    const { vars, errors: paramErrors } = K.evalParams(this.doc.params);
    const paramErrs = Object.entries(paramErrors).map(([name, msg]) => ({ kind: 'parameter', name, message: msg }));
    if (paramErrs.length) return this.finish({ ok: false, errors: paramErrs, bodies: [], ms: Date.now() - t0 });

    await this.loadImports();
    let features = K.resolveFeatures(this.doc.features, vars);
    features = applyConfigRules(features, this.doc.configRules, vars);
    const unsupported = features.filter(f => f.type === 'derive' && !f.suppressed);
    const out = await this.host.handle('regen', { features, rollback: null });

    const names = new Map(this.doc.features.map(f => [f.id, f.name || f.id]));
    const errors = out.status
      .filter(([, s]) => s.state === 'error')
      .map(([id, s]) => ({ kind: 'feature', feature: id, name: names.get(id) || id, message: s.msg || 'error' }));
    for (const f of unsupported) errors.push({ kind: 'feature', feature: f.id, name: f.name || f.id, message: 'Derived components are not supported by draftwork-core yet' });

    const meshByTok = new Map(out.meshes.map(m => [m.tok, m]));
    for (const [tok, m] of meshByTok) this.meshCache.set(tok, m);
    for (const t of out.freed) this.meshCache.delete(t);
    const meta = this.doc.bodyMeta || {};
    const bodies = out.bodies.map(([id, b]) => {
      const m = this.meshCache.get(b.shape);
      return {
        id, name: meta[id]?.name || b.name, feature: b.feature, surface: b.surface, hidden: !!meta[id]?.hidden, tok: b.shape,
        volume: m?.props.volume ?? 0, area: m?.props.area ?? 0, centerOfMass: m?.props.com ?? null, bbox: m ? bboxOf(m.pos) : null,
      };
    });
    const visible = bodies.filter(b => !b.hidden);
    const res = {
      ok: errors.length === 0, errors, bodies,
      volume: visible.reduce((s, b) => s + b.volume, 0),
      bbox: mergeBoxes(visible.map(b => b.bbox).filter(Boolean)),
      sheetMetal: out.sheets.map(([id, s]) => ({ body: id, ...s })),
      warnings: this.doc.joints?.length ? ['Joints are not solved by draftwork-core yet: components are exported where they were modeled'] : [],
      ms: Date.now() - t0,
    };
    return this.finish(res);
  }

  get meshCache() { return (this._meshes ||= new Map()); }

  finish(res) { this.last = res; return res; }

  async loadImports() {
    if (this.importsLoaded) return;
    for (const f of this.doc.features) {
      if (f.type === 'import' && f.file && this.files[f.file] && !K.importShapes.has(f.file)) await K.brepImportSTEP(f.file, this.files[f.file].text ?? this.files[f.file]);
    }
    this.importsLoaded = true;
  }

  pick(bodies) {
    if (!this.last) throw new Error('Call rebuild() first');
    const all = this.last.bodies.filter(b => !b.hidden && !b.surface);
    if (!bodies) return all;
    return bodies.map(k => { const b = this.last.bodies.find(x => x.id === k || x.name === k); if (!b) throw new Error(`Unknown body "${k}"`); return b; });
  }

  /**
   * Export the last rebuild. kind: 'step' | 'stl' | 'dxf-flat'.
   *   step     → Uint8Array, one STEP file with every visible solid (or opts.bodies)
   *   stl      → Uint8Array, binary STL of the same bodies merged
   *   dxf-flat → string, flat pattern of one sheet-metal body (opts.body, or the first)
   */
  async export(kind, opts = {}) {
    if (kind === 'step') {
      const items = this.pick(opts.bodies).map(b => ({ tok: b.tok, name: b.name, color: this.doc.bodyMeta?.[b.id]?.color }));
      if (!items.length) throw new Error('Nothing to export');
      return this.host.handle('step', { items });
    }
    if (kind === 'stl') {
      const parts = this.pick(opts.bodies).map(b => this.meshCache.get(b.tok)).filter(Boolean);
      if (!parts.length) throw new Error('Nothing to export');
      return new Uint8Array(K.toBinarySTL(mergedGeometry(parts), this.doc.name || 'part'));
    }
    if (kind === 'dxf-flat') {
      const sheets = this.last?.sheetMetal || [];
      const body = opts.body || sheets[0]?.body;
      if (!body) throw new Error('This design has no sheet-metal body');
      const fd = await this.host.handle('flat', { body });
      if (!fd) throw new Error(`Body "${body}" has no flat pattern`);
      return K.dxfOf(fd, body);
    }
    throw new Error(`Unknown export kind "${kind}"`);
  }

  /** Sheet-metal flat pattern data: outline polylines, bend lines, size, thickness, bend radius and K-factor. */
  async flatPattern(body) {
    const b = body || this.last?.sheetMetal[0]?.body;
    return b ? this.host.handle('flat', { body: b }) : null;
  }

  /**
   * Exact hidden-line projections for drawings, one per view kind. Each view: { vis, hid } SVG path strings in model
   * millimetres (y down) and its bounding box. viewSVG() turns one into a standalone SVG file.
   */
  async project(kinds = ['front', 'top', 'right', 'iso'], opts = {}) {
    for (const k of kinds) if (!VIEW_KINDS.includes(k)) throw new Error(`Unknown view "${k}"`);
    const items = this.pick(opts.bodies).map(b => ({ tok: b.tok, id: b.id }));
    return this.host.handle('project', { items, kinds });
  }

  /**
   * Display meshes of the last rebuild for a 3D preview: one per visible solid, as plain typed arrays
   * ({ id, name, pos: Float32Array xyz, nrm: Float32Array, idx: Uint32Array }) that can cross to a page from a Worker.
   */
  meshes(opts = {}) {
    return this.pick(opts.bodies).map(b => { const m = this.meshCache.get(b.tok); return m && { id: b.id, name: b.name, pos: m.pos, nrm: m.nrm, idx: m.idx }; }).filter(Boolean);
  }

  /** A JSON-friendly copy of the design with the current parameter values and suppression applied. */
  toJSON() { return structuredClone(this.doc); }

  /** Clear the rebuild cache (frees kernel memory held for incremental rebuilds). */
  async reset() { await this.host.handle('reset'); this.last = null; this._meshes = null; }
}

// Same rule semantics as the modeler's Configure › Rules: a rule suppresses its feature when its expression is true.
export function applyConfigRules(features, rules, vars) {
  if (!rules?.length) return features;
  const off = new Set();
  for (const r of rules) { if (!r.feature || !r.expr) continue; try { if (K.evalExpr(r.expr, vars)) off.add(r.feature); } catch (e) { /* the modeler ignores bad rules too */ } }
  return off.size ? features.map(f => off.has(f.id) ? { ...f, suppressed: true } : f) : features;
}

/** One projected view as a standalone SVG document (visible lines solid, hidden lines dashed). */
export function viewSVG(view, { margin = 10, stroke = 0.35 } = {}) {
  // the projection's bbox has y up; its SVG paths have y down
  const bb = view.bbox || [[0, 0], [100, 100]];
  const x0 = bb[0][0] - margin, y0 = -bb[1][1] - margin, w = bb[1][0] - bb[0][0] + 2 * margin, h = bb[1][1] - bb[0][1] + 2 * margin;
  const path = (d, dash) => `<path d="${d}" fill="none" stroke="#000" stroke-width="${stroke}"${dash ? ' stroke-dasharray="2 1.2"' : ''}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}mm" height="${h}mm">${view.hid.map(d => path(d, true)).join('')}${view.vis.map(d => path(d, false)).join('')}</svg>\n`;
}

/** Write several files ({ name, data: string | Uint8Array }) into one .zip, returned as a Uint8Array. */
export async function zip(files) { return new Uint8Array(await K.makeZip(files).arrayBuffer()); }

function bboxOf(pos) {
  if (!pos?.length) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  return { min: lo, max: hi, size: hi.map((v, k) => v - lo[k]) };
}
function mergeBoxes(boxes) {
  if (!boxes.length) return null;
  const lo = [0, 1, 2].map(k => Math.min(...boxes.map(b => b.min[k]))), hi = [0, 1, 2].map(k => Math.max(...boxes.map(b => b.max[k])));
  return { min: lo, max: hi, size: hi.map((v, k) => v - lo[k]) };
}
function mergedGeometry(parts) {
  let n = 0; for (const p of parts) n += p.idx.length * 3;
  const pos = new Float32Array(n); let o = 0;
  for (const p of parts) for (const i of p.idx) { pos[o++] = p.pos[i * 3]; pos[o++] = p.pos[i * 3 + 1]; pos[o++] = p.pos[i * 3 + 2]; }
  const g = new K.THREE.BufferGeometry();
  g.setAttribute('position', new K.THREE.BufferAttribute(pos, 3));
  return g;
}

