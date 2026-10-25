// The configurator server: the customer page, the product API and the generation jobs, with no dependencies
// beyond Node and the workspace packages.
//
//   GET  /                                   the web configurator (apps/configurator)
//   GET  /api/products                       [{ id, title, version, ok }]
//   GET  /api/products/:id                   the bundle a browser needs: rules config (tables inline) and design
//   POST /api/products/:id/quote             { answers } → price, BOM, text, messages (the server's own evaluation)
//   POST /api/products/:id/jobs              { answers, formats? } → a job (422 with the messages if checks fail)
//   GET  /api/jobs/:id                       job status, quote, geometry and file links
//   GET  /api/jobs/:id/files/:name           a finished job's file
//   GET  /vendor/…, /core/…, /rules/…        the libraries the page and its preview worker import
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Catalog } from './catalog.mjs';
import { Jobs, InputError, FORMATS } from './jobs.mjs';
import { createClaude, intake, AIError } from '@draftwork/ai';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
// a package's folder: resolve its entry point, then walk up to the package.json that names it
function pkgDir(name) {
  let d = path.dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    const pj = path.join(d, 'package.json');
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, 'utf8')).name === name) return d;
    const up = path.dirname(d); if (up === d) throw new Error(`Cannot find package ${name}`); d = up;
  }
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.step': 'application/step', '.stl': 'model/stl', '.dxf': 'image/vnd.dxf', '.png': 'image/png' };
const MAX_BODY = 256 * 1024, MAX_INTAKE_BODY = 6 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// core/dist/kernel.mjs imports 'three' and 'replicad' by package name; a Worker has no import map, so point them at
// the vendor copies, relative to /core/dist/ (the same layout on the server and on a static host)
export const coreImports = text => text.replace(/from 'three'/g, "from '../../vendor/three/build/three.module.js'").replace(/from 'replicad'/g, "from '../../vendor/replicad/replicad.js'");

export function createServer({ productsDir, storageDir, appDir = path.join(repo, 'apps/configurator'), llm, aiLimit = { per: 10 * 60 * 1000, max: 20 } } = {}) {
  // customer intake by AI: on when the server has a model (an ANTHROPIC_API_KEY, or one passed in)
  if (llm === undefined && process.env.ANTHROPIC_API_KEY) llm = createClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.DRAFTWORK_AI_MODEL || undefined, browser: false });
  const aiUse = new Map();   // address → recent request times, to keep one visitor from running up the bill
  const aiAllowed = req => {
    const ip = req.socket.remoteAddress || '?', now = Date.now();
    const recent = (aiUse.get(ip) || []).filter(t => now - t < aiLimit.per);
    if (recent.length >= aiLimit.max) return false;
    recent.push(now); aiUse.set(ip, recent);
    if (aiUse.size > 10000) aiUse.clear();
    return true;
  };
  const catalog = new Catalog(productsDir);
  const jobs = new Jobs({ storageDir });
  // URL prefix → folder; /core/ files get their bare imports rewritten so a module Worker can load them
  const mounts = [
    ['/vendor/three/', pkgDir('three')],
    ['/vendor/replicad/', path.join(pkgDir('replicad'), 'dist')],
    ['/vendor/occ/', path.join(pkgDir('replicad-opencascadejs'), 'dist')],
    ['/core/', path.join(repo, 'packages/core')],
    ['/rules/', path.join(repo, 'packages/rules/src')],
    ['/', appDir],
  ];
  const gzCache = new Map();

  const send = (res, status, body, type = 'application/json', extra = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
    res.end(data);
  };
  const fail = (res, status, message, details) => send(res, status, { error: message, ...(details ? { details } : {}) });

  async function readBody(req, max = MAX_BODY) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > max) throw new InputError('Request too large'); chunks.push(c); }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw new InputError('The request body is not JSON'); }
  }
  const publicJob = job => job && {
    id: job.id, product: job.product, title: job.title, status: job.status, created: job.created, finished: job.finished || null, cached: job.cached,
    quote: job.quote, geometry: job.geometry, error: job.error || null, errors: job.errors || null,
    files: (job.files || []).map(f => ({ ...f, url: `/api/jobs/${job.id}/files/${encodeURIComponent(f.name)}` })),
  };

  async function api(req, res, parts) {
    const method = req.method;
    if (parts[0] === 'products' && parts.length === 1 && method === 'GET') return send(res, 200, await catalog.list());
    if (parts[0] === 'products' && parts.length >= 2) {
      const p = await catalog.get(parts[1]);
      if (!p) return fail(res, 404, 'No such product');
      if (parts.length === 2 && method === 'GET') return send(res, 200, p.bundle);
      if (parts[2] === 'quote' && method === 'POST') {
        const { answers } = await readBody(req);
        if (!p.project.ok) return fail(res, 500, 'This product has errors in its rules');
        const r = p.project.evaluate(answers || {});
        return send(res, 200, { ok: r.ok, answers: Object.fromEntries(r.form.map(f => [f.name, f.value ?? null])), price: r.price, bom: r.bom, text: r.text, messages: r.messages });
      }
      if (parts[2] === 'intake' && method === 'POST') {
        if (!llm) return fail(res, 404, 'Describing a need is not switched on for this site');
        if (!aiAllowed(req)) return fail(res, 429, 'Too many requests: please fill in the form, or try again in a few minutes');
        const { message, answers, images } = await readBody(req, MAX_INTAKE_BODY);
        const pics = (Array.isArray(images) ? images : []).slice(0, 3);
        for (const im of pics) if (!IMAGE_TYPES.includes(im?.mediaType) || typeof im.data !== 'string') throw new InputError('Pictures must be JPEG, PNG, WebP or GIF');
        try {
          const r = await intake({ message: typeof message === 'string' ? message : '', images: pics, project: p.project, answers: answers && typeof answers === 'object' ? answers : {}, llm });
          return send(res, 200, { answers: r.answers, changed: r.changed, ignored: r.ignored, questions: r.questions, summary: r.summary });
        } catch (e) {
          if (e instanceof AIError) return fail(res, 502, 'The assistant is not available right now: ' + e.message);
          throw new InputError(e.message);
        }
      }
      if (parts[2] === 'jobs' && method === 'POST') {
        const { answers, formats } = await readBody(req);
        const job = await jobs.submit(p, answers || {}, Array.isArray(formats) ? formats : undefined);
        return send(res, 202, publicJob(job));
      }
    }
    if (parts[0] === 'jobs' && parts[1] && method === 'GET') {
      const job = await jobs.get(parts[1]);
      if (!job) return fail(res, 404, 'No such job');
      if (parts.length === 2) return send(res, 200, publicJob(job));
      if (parts[2] === 'files' && parts[3]) {
        const file = jobs.filePath(job, decodeURIComponent(parts[3]));
        if (!file) return fail(res, 404, 'No such file');
        const name = path.basename(file);
        res.writeHead(200, { 'content-type': TYPES[path.extname(name)] || 'application/octet-stream', 'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"`, 'cache-control': 'private, max-age=86400' });
        return fs.createReadStream(file).pipe(res);
      }
    }
    if (parts[0] === 'formats' && method === 'GET') return send(res, 200, FORMATS);
    if (parts[0] === 'ai' && parts.length === 1 && method === 'GET') return send(res, 200, { intake: !!llm });
    return fail(res, 404, 'Not found');
  }

  async function staticFile(req, res, url) {
    if (url === '/') url = '/index.html';
    const mount = mounts.find(([prefix]) => url.startsWith(prefix));
    if (!mount) return fail(res, 404, 'Not found');
    const [prefix, dir] = mount;
    const file = path.resolve(dir, '.' + url.slice(prefix.length - 1));
    if (!file.startsWith(dir + path.sep)) return fail(res, 404, 'Not found');
    let st; try { st = await fsp.stat(file); } catch (e) { return fail(res, 404, 'Not found'); }
    if (!st.isFile()) return fail(res, 404, 'Not found');
    const ext = path.extname(file), type = TYPES[ext] || 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': prefix === '/' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' };
    if (prefix === '/core/' && (ext === '.mjs' || ext === '.js')) {
      let text = await fsp.readFile(file, 'utf8');
      text = coreImports(text);
      res.writeHead(200, headers); return res.end(text);
    }
    // large engine files go out gzipped (once, then from memory)
    if (st.size > 512 * 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      const key = file + ':' + st.mtimeMs;
      let gz = gzCache.get(key);
      if (!gz) { gz = zlib.gzipSync(await fsp.readFile(file), { level: 6 }); gzCache.set(key, gz); }
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' }); return res.end(gz);
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (url.includes('\0')) return fail(res, 400, 'Bad path');
      if (url.startsWith('/api/')) return await api(req, res, url.slice(5).split('/').filter(Boolean));
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
      return await staticFile(req, res, url);
    } catch (e) {
      if (e instanceof InputError) return fail(res, 422, e.message, e.details);
      console.error(e);
      if (!res.headersSent) fail(res, 500, 'Server error');
    }
  });
  server.on('close', () => { jobs.close(); });
  return Object.assign(server, { catalog, jobs });
}
