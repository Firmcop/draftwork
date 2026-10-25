// Generation worker (a worker thread): keeps one OpenCascade engine loaded and turns { design, params, suppressed }
// into release files in a folder. Jobs arrive one at a time; a failure is reported, never fatal.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createEngine, viewSVG } from '@draftwork/core';

const enginePromise = createEngine();

parentPort.on('message', async job => {
  try {
    const engine = await enginePromise;
    const model = engine.open(job.design);
    model.setParams(job.params).setSuppressed(job.suppressed);
    const g = await model.rebuild();
    if (!g.ok) { parentPort.postMessage({ id: job.id, ok: false, error: 'The model did not rebuild', errors: g.errors }); await model.reset(); return; }
    await fs.mkdir(job.dir, { recursive: true });
    const files = [];
    const write = async (name, data) => { await fs.writeFile(path.join(job.dir, name), data); files.push({ name, size: typeof data === 'string' ? Buffer.byteLength(data) : data.length }); };
    const base = job.base;
    if (job.formats.includes('step')) await write(base + '.step', await model.export('step'));
    if (job.formats.includes('stl')) await write(base + '.stl', await model.export('stl'));
    if (job.formats.includes('svg')) {
      const views = await model.project(['front', 'top', 'right', 'iso']);
      for (const [k, v] of Object.entries(views)) await write(`${base}-${k}.svg`, viewSVG(v));
    }
    if (job.formats.includes('dxf') && g.sheetMetal.length) await write(base + '-flat.dxf', await model.export('dxf-flat'));
    const geometry = { volume_mm3: +g.volume.toFixed(3), size_mm: g.bbox?.size.map(v => +v.toFixed(3)), bodies: g.bodies.length, rebuild_ms: g.ms };
    await model.reset();
    parentPort.postMessage({ id: job.id, ok: true, files, geometry });
  } catch (e) {
    parentPort.postMessage({ id: job.id, ok: false, error: e.message });
  }
});
