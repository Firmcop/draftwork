// The MCP server, spoken to over stdio like an AI assistant would: handshake, tool list, describe, quote, files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-mcp-'));
const proc = spawn(process.execPath, [path.join(here, '../server.mjs'), '--products', path.join(here, '../../../packages/rules/examples'), '--out', out], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', nextId = 1;
const waiting = new Map(), stray = [];
proc.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let msg; try { msg = JSON.parse(line); } catch (e) { stray.push(line); continue; }
    waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
  }
});
const rpc = (method, params) => new Promise(res => { const id = nextId++; waiting.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return { ...r.result, data: r.result.isError ? null : JSON.parse(r.result.content[0].text) }; };
test.after(() => { proc.kill(); fs.rmSync(out, { recursive: true, force: true }); });

test('handshake and tool list', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'draftwork-configurator');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc('tools/list', {});
  assert.deepEqual(list.result.tools.map(t => t.name), ['list_products', 'describe_product', 'quote', 'make_files']);
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');
  assert.equal((await rpc('nope/method', {})).error.code, -32601);
});

test('list, describe and quote', async () => {
  assert.deepEqual((await call('list_products', {})).data, [{ id: 'bearing-bracket', title: 'Bearing bracket', version: 1 }]);
  const d = (await call('describe_product', { product: 'bearing-bracket' })).data;
  const shaft = d.inputs.find(i => i.name === 'ShaftSize');
  assert.deepEqual(shaft.options, [10, 12, 15, 20]);
  assert.equal(d.currency, 'KES');
  const q = (await call('quote', { product: 'bearing-bracket', answers: { ShaftSize: 20, Load: 'Heavy', Quantity: 12 } })).data;
  assert.equal(q.valid, true);
  assert.equal(q.price.total, 25293.88);
  assert.equal(q.part_number, 'BB-20-H-C');
  assert.ok(q.messages.some(m => /^warning: .*consider Steel S275/.test(m)));
  const bad = (await call('quote', { product: 'bearing-bracket', answers: { Quantity: 900 } })).data;
  assert.equal(bad.valid, false);
  const missing = await call('quote', { product: 'gate' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /No product "gate"/);
});

test('make_files builds the part on this computer, and refuses invalid configurations', async () => {
  const r = await call('make_files', { product: 'bearing-bracket', answers: { ShaftSize: 15 }, formats: ['step', 'svg'] });
  assert.equal(r.isError, undefined, r.content[0].text);
  assert.deepEqual(r.data.size_mm, [110, 70, 38]);
  assert.equal(r.data.files.length, 5);
  assert.match(fs.readFileSync(r.data.files.find(f => f.endsWith('.step')), 'utf8'), /^ISO-10303-21;/);
  assert.ok(r.data.folder.startsWith(out));
  const no = await call('make_files', { product: 'bearing-bracket', answers: { Quantity: 900 } });
  assert.equal(no.isError, true);
  assert.match(no.content[0].text, /production quote/);
  assert.deepEqual(stray.filter(l => l.trim()), [], 'nothing but protocol messages on stdout');
});
