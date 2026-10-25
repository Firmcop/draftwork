// The configurator server: product API, quotes, jobs with validation and caching, files, and the static mounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-gen-test-'));
const server = createServer({ productsDir: path.join(root, 'packages/rules/examples'), storageDir: storage });
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
test.after(() => { server.close(); fs.rmSync(storage, { recursive: true, force: true }); });

const get = async u => { const r = await fetch(base + u); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (u, body, raw) => { const r = await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
// a request whose path is sent exactly as written (fetch would tidy away "..")
const rawGet = p => new Promise((resolve, reject) => {
  const s = net.connect(server.address().port, 'localhost', () => s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  let out = ''; s.on('data', d => { out += d; }); s.on('end', () => resolve(+out.split(' ')[1])); s.on('error', reject);
});

test('lists products and serves a bundle without the server-only parts', async () => {
  const list = await get('/api/products');
  assert.deepEqual(list.body, [{ id: 'bearing-bracket', title: 'Bearing bracket', version: 1, ok: true, errors: 0 }]);
  const b = await get('/api/products/bearing-bracket');
  assert.equal(b.status, 200);
  assert.equal(b.body.config.tests, undefined, 'test cases stay on the server');
  assert.equal(b.body.config.model, undefined);
  assert.match(b.body.config.tables.bearings.csv, /^shaft,bore/);
  assert.equal(b.body.design.features.length, 11);
  assert.equal((await get('/api/products/nope')).status, 404);
  assert.equal((await get('/api/products/..%2F..%2Fetc')).status, 404);
});

test('quotes on the server match the rules', async () => {
  const q = await post('/api/products/bearing-bracket/quote', { answers: { ShaftSize: 20, Load: 'Heavy', Quantity: 12 } });
  assert.equal(q.status, 200);
  assert.equal(q.body.price.total, 25293.88);
  assert.equal(q.body.text.part_number, 'BB-20-H-C');
  assert.equal(q.body.answers.Material, 'Aluminium 6061');
});

test('a job builds files once; the same geometry comes from the cache', async () => {
  const a = await post('/api/products/bearing-bracket/jobs', { answers: { ShaftSize: 15 }, formats: ['step', 'svg'] });
  assert.equal(a.status, 202);
  const done = await server.jobs.wait(a.body.id);
  assert.equal(done.status, 'done', done.error);
  const pub = (await get('/api/jobs/' + a.body.id)).body;
  assert.deepEqual(pub.files.map(f => f.name), ['BB-15-M-C.step', 'BB-15-M-C-front.svg', 'BB-15-M-C-top.svg', 'BB-15-M-C-right.svg', 'BB-15-M-C-iso.svg']);
  assert.deepEqual(pub.geometry.size_mm, [110, 70, 38]);
  const step = await fetch(base + pub.files[0].url);
  assert.equal(step.headers.get('content-disposition'), 'attachment; filename="BB-15-M-C.step"');
  assert.match(await step.text(), /^ISO-10303-21;/);
  // quantity changes the price, not the geometry: same files, straight from the cache
  const b = await post('/api/products/bearing-bracket/jobs', { answers: { ShaftSize: 15, Quantity: 40 }, formats: ['svg', 'step'] });
  assert.equal(b.body.status, 'done');
  assert.equal(b.body.cached, true);
  assert.notEqual(b.body.quote.price.total, pub.quote.price.total);
  assert.deepEqual(b.body.files.map(f => f.name), pub.files.map(f => f.name));
});

test('invalid configurations are refused with the product\'s messages', async () => {
  const r = await post('/api/products/bearing-bracket/jobs', { answers: { Quantity: 800 } });
  assert.equal(r.status, 422);
  assert.match(r.body.details[0].message, /production quote/);
  const bad = await post('/api/products/bearing-bracket/jobs', { answers: {}, formats: ['exe'] });
  assert.equal(bad.status, 422);
  assert.equal((await post('/api/products/bearing-bracket/jobs', null, '{nope')).status, 422);
  assert.equal((await post('/api/products/bearing-bracket/jobs', null, JSON.stringify({ answers: { x: 'y'.repeat(300 * 1024) } }))).status, 422);
});

test('files and jobs cannot be reached by guessing or by path tricks', async () => {
  assert.equal((await get('/api/jobs/not-a-job')).status, 404);
  assert.equal((await get('/api/jobs/00000000-0000-0000-0000-000000000000')).status, 404);
  const job = (await post('/api/products/bearing-bracket/jobs', { answers: { ShaftSize: 15 }, formats: ['step', 'svg'] })).body;
  assert.equal((await get(`/api/jobs/${job.id}/files/..%2Fmanifest.json`)).status, 404);
  assert.equal((await get(`/api/jobs/${job.id}/files/manifest.json`)).status, 404, 'only the files listed for the job');
  for (const p of ['/../package.json', '/core/../../package.json', '/vendor/three/../../../package.json', '/rules/../../../.git/config', '/%2e%2e/package.json'])
    assert.equal(await rawGet(p), 404, p);
});

test('the page and the libraries it imports are served, engine files gzipped', async () => {
  const page = await fetch(base + '/');
  assert.match(await page.text(), /<script type="module" src="\.\/app\.mjs">/);
  const core = await (await fetch(base + '/core/dist/kernel.mjs')).text();
  assert.match(core, /from '\.\.\/\.\.\/vendor\/three\/build\/three\.module\.js'/);
  assert.doesNotMatch(core, /from 'three'|from 'replicad'/);
  const rules = await fetch(base + '/rules/index.mjs');
  assert.equal(rules.headers.get('content-type'), 'text/javascript');
  const wasm = await fetch(base + '/vendor/occ/replicad_single.wasm', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(wasm.headers.get('content-encoding'), 'gzip');
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
});

test('customer intake is off without a model, and on with one', async () => {
  assert.deepEqual((await get('/api/ai')).body, { intake: false });
  assert.equal((await post('/api/products/bearing-bracket/intake', { message: 'hi' })).status, 404);
  const calls = [];
  const llm = { ask: async req => { calls.push(req); return { answers: { ShaftSize: 20, Load: 'Heavy', Size: 'XL' }, questions: ['How many?'], summary: 'A heavy 20 mm bracket.' }; } };
  const s2 = createServer({ productsDir: path.join(root, 'packages/rules/examples'), storageDir: storage, llm, aiLimit: { per: 60000, max: 2 } });
  await new Promise(r => s2.listen(0, r));
  const b2 = `http://localhost:${s2.address().port}`;
  const p2 = async body => { const r = await fetch(b2 + '/api/products/bearing-bracket/intake', { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  try {
    assert.deepEqual(await (await fetch(b2 + '/api/ai')).json(), { intake: true });
    const r = await p2({ message: 'heavy duty, 20 mm shaft', answers: { Quantity: 5 }, images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.answers, { Quantity: 5, ShaftSize: 20, Load: 'Heavy' });
    assert.deepEqual(r.body.ignored, ['Size: not an option of this product']);
    assert.deepEqual(r.body.questions, ['How many?']);
    assert.equal(calls[0].content[0].type, 'image');
    assert.equal((await p2({ message: 'x', images: [{ mediaType: 'application/pdf', data: 'x' }] })).status, 422);
    assert.equal((await p2({ message: 'third' })).status, 429, 'the rate limit holds');
  } finally { s2.close(); }
});
