#!/usr/bin/env node
// Draftwork configurator as an MCP server (stdio), so AI assistants can configure, price and build your products.
// The assistant only supplies answers: the rules engine checks them and works out the price, and the kernel makes
// the files, exactly as on the web configurator.
//
//   node services/mcp/server.mjs [--products folder] [--out folder]
//
// Claude Desktop (claude_desktop_config.json):
//   { "mcpServers": { "draftwork": { "command": "node", "args": ["/path/to/draftwork/services/mcp/server.mjs", "--products", "/path/to/products"] } } }
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../generator/src/catalog.mjs';
import { display } from '@draftwork/rules';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
const catalogs = (opt.products ? [opt.products] : [path.join(here, '../../products'), path.join(here, '../../packages/rules/examples')]).map(d => new Catalog(d));
const outRoot = path.resolve(opt.out || path.join(process.cwd(), 'draftwork-out'));
const log = (...a) => process.stderr.write(a.join(' ') + '\n');   // stdout is the protocol

async function findProduct(id) {
  for (const c of catalogs) { const p = await c.get(id); if (p) return p; }
  throw new UserError(`No product "${id}". Use list_products to see the ids.`);
}
class UserError extends Error {}

const answersSchema = { type: 'object', additionalProperties: true, description: 'Input name → value. Leave out inputs the user did not decide: they take their defaults.' };
const TOOLS = [
  { name: 'list_products', description: 'List the configurable products, with their ids and titles.', inputSchema: { type: 'object', properties: {} } },
  { name: 'describe_product', description: 'The questions (inputs) of one product: type, unit, allowed options, limits, defaults and help. Read this before quoting.', inputSchema: { type: 'object', properties: { product: { type: 'string' } }, required: ['product'] } },
  { name: 'quote', description: 'Price a configuration and check it. Returns whether it is valid, the messages (errors must be fixed), the price lines and total, the parts list and the part number. Prices come from the product\'s own rules.', inputSchema: { type: 'object', properties: { product: { type: 'string' }, answers: answersSchema }, required: ['product'] } },
  { name: 'make_files', description: 'Build the configured part and write its CAD and drawing files (STEP, STL, drawing views as SVG, flat pattern DXF for sheet metal) to a folder on this computer. Refused when the configuration does not pass its checks.', inputSchema: { type: 'object', properties: { product: { type: 'string' }, answers: answersSchema, formats: { type: 'array', items: { type: 'string', enum: ['step', 'stl', 'svg', 'dxf'] } } }, required: ['product'] } },
];

async function listProducts() {
  const seen = new Set(), out = [];
  for (const c of catalogs) for (const p of await c.list()) if (p.ok && !seen.has(p.id)) { seen.add(p.id); out.push({ id: p.id, title: p.title, version: p.version }); }
  return out;
}

async function describeProduct({ product }) {
  const p = await findProduct(product);
  const form = p.project.evaluate({}).form;
  return {
    id: p.id, title: p.title, currency: p.config.currency || null,
    inputs: form.map(f => ({ name: f.name, label: f.label, type: f.type, ...(f.unit ? { unit: f.unit } : {}), ...(f.options ? { options: f.options } : {}), ...(f.min != null ? { min: f.min } : {}), ...(f.max != null ? { max: f.max } : {}), ...(f.step ? { step: f.step } : {}), default: f.value ?? null, ...(f.group ? { group: f.group } : {}), ...(f.help ? { help: f.help } : {}), ...(f.visible === false ? { shownNow: false } : {}) })),
    note: 'Choice values must be one of the options. Some inputs depend on others: re-check with quote.',
  };
}

function evaluate(p, answers) {
  if (!p.project.ok) throw new UserError('This product has errors in its rules; ask its engineer to fix them.');
  return p.project.evaluate(answers && typeof answers === 'object' ? answers : {});
}

async function quote({ product, answers }) {
  const p = await findProduct(product), r = evaluate(p, answers);
  return {
    valid: r.ok, product: p.id, title: r.text.title || p.title, part_number: r.text.part_number || null,
    answers: Object.fromEntries(r.form.map(f => [f.name, f.value ?? null])),
    messages: r.messages.map(m => `${m.level}: ${m.message}`),
    price: { currency: r.price.currency, lines: r.price.lines, total: r.price.total },
    parts: r.bom.map(b => `${display(b.qty)} ${b.unit} × ${b.item}`),
  };
}

let enginePromise = null;
async function makeFiles({ product, answers, formats }) {
  const p = await findProduct(product), r = evaluate(p, answers);
  if (!r.ok) throw new UserError('The configuration does not pass its checks: ' + r.messages.filter(m => m.level === 'error').map(m => m.message).join('; '));
  const want = ['step', 'stl', 'svg', 'dxf'].filter(f => (Array.isArray(formats) && formats.length ? formats : ['step', 'stl', 'svg']).includes(f));
  const { createEngine, viewSVG } = await import('@draftwork/core');
  enginePromise ||= createEngine();
  const model = (await enginePromise).open(p.design);
  model.setParams(r.model.params).setSuppressed(r.model.suppressed);
  const g = await model.rebuild();
  if (!g.ok) throw new UserError('The model did not rebuild: ' + g.errors.map(e => `${e.name}: ${e.message}`).join('; '));
  const base = (r.text.part_number || p.id).replace(/[^\w.-]+/g, '_').slice(0, 80);
  const dir = path.join(outRoot, base);
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  const write = async (name, data) => { const f = path.join(dir, name); await fs.writeFile(f, data); files.push(f); };
  if (want.includes('step')) await write(base + '.step', await model.export('step'));
  if (want.includes('stl')) await write(base + '.stl', await model.export('stl'));
  if (want.includes('svg')) for (const [k, v] of Object.entries(await model.project(['front', 'top', 'right', 'iso']))) await write(`${base}-${k}.svg`, viewSVG(v));
  if (want.includes('dxf') && g.sheetMetal.length) await write(base + '-flat.dxf', await model.export('dxf-flat'));
  await model.reset();
  return { folder: dir, files, size_mm: g.bbox?.size.map(v => +v.toFixed(3)), volume_mm3: +g.volume.toFixed(3), price_total: r.price.total, currency: r.price.currency };
}

const HANDLERS = { list_products: listProducts, describe_product: describeProduct, quote, make_files: makeFiles };

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'draftwork-configurator', version: '0.1.0' },
        instructions: 'Configure Draftwork products: list_products, then describe_product, then quote until valid, then make_files if the user wants CAD files. Prices and checks come from the product rules; never state a price you did not get from quote.' };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS };
    case 'tools/call': {
      const fn = HANDLERS[params?.name];
      if (!fn) return { content: [{ type: 'text', text: `Unknown tool ${params?.name}` }], isError: true };
      try { const out = await fn(params.arguments || {}); return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: Array.isArray(out) ? { products: out } : out }; }
      catch (e) { if (!(e instanceof UserError)) log(e.stack); return { content: [{ type: 'text', text: e.message }], isError: true }; }
    }
  }
  if (id === undefined) return undefined;   // a notification
  throw Object.assign(new Error('Method not found: ' + method), { code: -32601 });
}

const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  try {
    const result = await handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
  } catch (e) {
    if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
});
log(`draftwork MCP server ready; files go to ${outRoot}`);
