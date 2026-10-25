// Node helper: load a project file from disk, with its CSV tables and its Draftwork design.
//   product.config.json   { "model": { "design": "bracket.design.json" }, "tables": { "sizes": "tables/sizes.csv" }, ... }
import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadProject(file) {
  const dir = path.dirname(path.resolve(file));
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  const tables = {};
  for (const [name, t] of Object.entries(config.tables || {})) {
    tables[name] = typeof t === 'string' && /\.csv$/i.test(t) && !t.includes('\n') ? { csv: await fs.readFile(path.resolve(dir, t), 'utf8') } : t;
  }
  let design = null;
  if (typeof config.model?.design === 'string') {
    const raw = JSON.parse(await fs.readFile(path.resolve(dir, config.model.design), 'utf8'));
    design = raw.design || raw;   // a saved project file or a bare design
  }
  return { config: { ...config, tables }, design, dir };
}
