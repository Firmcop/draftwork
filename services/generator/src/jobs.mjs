// Jobs: answers → rules (here, instantly) → geometry files (in the worker thread, one at a time).
// Files are cached by what decides the geometry (product, design, parameter values, suppression, formats), so a
// configuration someone already built returns at once; the quote (price, BOM, text) is per job.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const FORMATS = ['step', 'stl', 'svg', 'dxf'];

export class InputError extends Error {
  constructor(message, details) { super(message); this.details = details; }
}

export class Jobs {
  constructor({ storageDir, maxQueue = 50 }) {
    this.dir = path.resolve(storageDir);
    this.maxQueue = maxQueue;
    this.jobs = new Map();
    this.queue = [];
    this.running = null;
    this.worker = null;
    this.waiters = new Map();
  }

  startWorker() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./worker.mjs', import.meta.url));
    this.worker.on('message', msg => this.finish(msg));
    this.worker.on('error', e => { if (this.running) this.finish({ id: this.running.id, ok: false, error: 'Worker crashed: ' + e.message }); this.worker = null; });
    this.worker.on('exit', () => { this.worker = null; });
    this.worker.unref();
  }

  async close() { if (this.worker) { const w = this.worker; this.worker = null; await w.terminate(); } }

  /**
   * Start a job. product: a catalog entry. Throws InputError (with the rule messages) when the answers do not
   * pass the product's checks: nothing is built for an invalid configuration.
   */
  async submit(product, answers = {}, formats = ['step', 'stl', 'svg']) {
    if (!product.project.ok) throw new InputError('This product has errors in its rules', product.project.errors.slice(0, 5));
    formats = FORMATS.filter(f => formats.includes(f));   // fixed order, so the cache key does not depend on how they were listed
    if (!formats.length) throw new InputError('Ask for at least one of: ' + FORMATS.join(', '));
    const r = product.project.evaluate(answers);
    const quote = { answers: Object.fromEntries(r.form.map(f => [f.name, f.value ?? null])), price: r.price, bom: r.bom, text: r.text, messages: r.messages };
    if (!r.ok) throw new InputError('The configuration does not pass its checks', r.messages.filter(m => m.level === 'error'));
    const hash = crypto.createHash('sha256').update(JSON.stringify({ p: product.id, v: product.config.version ?? null, d: product.designHash, params: r.model.params, sup: r.model.suppressed, f: formats })).digest('hex').slice(0, 24);
    const job = { id: crypto.randomUUID(), product: product.id, title: r.text.title || product.title, status: 'queued', created: new Date().toISOString(), hash, formats, quote, files: [], geometry: null, cached: false };
    this.jobs.set(job.id, job);
    const manifest = await readJSON(path.join(this.dir, 'files', hash, 'manifest.json'));
    if (manifest) {
      Object.assign(job, { status: 'done', cached: true, files: manifest.files, geometry: manifest.geometry, finished: job.created });
      await this.save(job);
      return job;
    }
    if (this.queue.length >= this.maxQueue) { this.jobs.delete(job.id); throw new InputError('The generator is busy: try again in a minute'); }
    const base = (r.text.part_number || product.id).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'part';
    this.queue.push({ job, task: { id: job.id, design: product.design, params: r.model.params, suppressed: r.model.suppressed, formats, base, dir: path.join(this.dir, 'files', hash) } });
    await this.save(job);
    this.pump();
    return job;
  }

  pump() {
    if (this.running || !this.queue.length) return;
    this.startWorker();
    const next = this.queue.shift();
    this.running = next.job;
    next.job.status = 'running'; next.job.started = new Date().toISOString();
    this.worker.ref();
    this.worker.postMessage(next.task);
  }

  async finish(msg) {
    const job = this.jobs.get(msg.id);
    this.running = null;
    this.worker?.unref();
    if (job) {
      job.finished = new Date().toISOString();
      if (msg.ok) {
        job.status = 'done'; job.files = msg.files; job.geometry = msg.geometry;
        await fs.writeFile(path.join(this.dir, 'files', job.hash, 'manifest.json'), JSON.stringify({ files: msg.files, geometry: msg.geometry }, null, 2));
      } else { job.status = 'failed'; job.error = msg.error; if (msg.errors) job.errors = msg.errors; }
      await this.save(job);
      for (const w of this.waiters.get(job.id) || []) w(job);
      this.waiters.delete(job.id);
    }
    this.pump();
  }

  async get(id) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const job = await readJSON(path.join(this.dir, 'jobs', id + '.json'));
    if (job) this.jobs.set(id, job);
    return job;
  }

  /** Resolves when the job is done or failed (for tests and scripts). */
  wait(id) {
    const job = this.jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'failed') return Promise.resolve(job);
    return new Promise(res => { if (!this.waiters.has(id)) this.waiters.set(id, []); this.waiters.get(id).push(res); });
  }

  /** Where a finished job's file lives on disk, or null. */
  filePath(job, name) {
    if (!job || job.status !== 'done' || !job.files.some(f => f.name === name)) return null;
    return path.join(this.dir, 'files', job.hash, name);
  }

  async save(job) {
    await fs.mkdir(path.join(this.dir, 'jobs'), { recursive: true });
    await fs.writeFile(path.join(this.dir, 'jobs', job.id + '.json'), JSON.stringify(job, null, 2));
  }
}

async function readJSON(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { return null; } }
