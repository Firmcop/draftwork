// The product catalog: one folder per product under the products directory, each holding product.config.json,
// its Draftwork design and its CSV tables (the layout the modeler's Export writes). Products are compiled once and
// reloaded when their files change.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { compile } from '@draftwork/rules';
import { loadProject } from '@draftwork/rules/node';

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export class Catalog {
  constructor(dir) { this.dir = path.resolve(dir); this.cache = new Map(); }

  async ids() {
    let entries = [];
    try { entries = await fs.readdir(this.dir, { withFileTypes: true }); } catch (e) { return []; }
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      try { await fs.access(path.join(this.dir, e.name, 'product.config.json')); out.push(e.name); } catch (err) { /* not a product */ }
    }
    return out.sort();
  }

  /** Every product with its title and whether it compiles, for a picker or an admin page. */
  async list() {
    const out = [];
    for (const id of await this.ids()) {
      try { const p = await this.get(id); out.push({ id, title: p.title, version: p.config.version ?? null, ok: p.project.ok, errors: p.project.errors.length }); }
      catch (e) { out.push({ id, title: id, ok: false, errors: 1, message: e.message }); }
    }
    return out;
  }

  async get(id) {
    if (!ID_RE.test(id || '')) return null;
    const folder = path.join(this.dir, id), file = path.join(folder, 'product.config.json');
    let stamp;
    try { stamp = await folderStamp(folder); } catch (e) { return null; }
    const hit = this.cache.get(id);
    if (hit && hit.stamp === stamp) return hit;
    const { config, design } = await loadProject(file);
    if (!design) throw new Error(`Product ${id} has no design (model.design in product.config.json)`);
    const project = compile(config);
    const designText = JSON.stringify(design);
    const entry = {
      id, stamp, config, design, project,
      title: config.title || config.product || id,
      designHash: crypto.createHash('sha256').update(designText).digest('hex').slice(0, 16),
      // what a browser needs to run the rules and the preview itself: the tests and file paths stay on the server
      bundle: { id, title: config.title || config.product || id, config: { ...config, tests: undefined, model: undefined }, design },
    };
    this.cache.set(id, entry);
    return entry;
  }
}

// changes when any file in the product folder (or its tables folder) changes
async function folderStamp(folder) {
  const parts = [];
  const walk = async (dir, depth) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2) await walk(p, depth + 1); }
      else { const s = await fs.stat(p); parts.push(`${p}:${s.size}:${s.mtimeMs}`); }
    }
  };
  await walk(folder, 0);
  return parts.sort().join('|');
}
