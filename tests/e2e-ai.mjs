// End-to-end: the AI features, with the AI service simulated (no key, no network).
//  1. Draftwork's Product Configurator: "Ask AI" drafts rules with the user's own key (calls are intercepted);
//     the proposal is checked, shown, and added only when the engineer says so.
//  2. The web configurator served with a model: "Describe what you need" fills in the options.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { createServer } from '../services/generator/src/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ex = path.join(root, 'packages/rules/examples/bearing-bracket');
const product = JSON.parse(fs.readFileSync(path.join(ex, 'product.config.json'), 'utf8'));
for (const [name, file] of Object.entries(product.tables)) product.tables[name] = { csv: fs.readFileSync(path.join(ex, file), 'utf8') };
delete product.model; delete product.product;
const design = JSON.parse(fs.readFileSync(path.join(ex, 'bracket.design.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const errors = [];

// ---------- 1. Ask AI in the modeler ----------
{
  const server = serve(5261);
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  const W = ms => page.waitForTimeout(ms);
  const sent = [];
  const replies = [
    // first answer refers to a name that does not exist; the check sends it back, the second answer fixes it
    { explanation: 'Adds a paint option.', inputs: [{ name: 'Painted', type: 'boolean', default: false, group: 'Build' }], rules: [{ kind: 'price', line: 'Paint', expr: '350 * Qty', when: 'Painted' }] },
    { explanation: 'Adds a paint option priced at 350 per bracket.', inputs: [{ name: 'Painted', type: 'boolean', default: false, group: 'Build' }], rules: [{ kind: 'price', line: 'Paint', expr: '350 * Quantity', when: 'Painted' }] },
  ];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    sent.push({ headers: req.headers(), body: JSON.parse(req.postData()) });
    const input = replies.shift();
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ content: [{ type: 'tool_use', id: 't', name: 'propose_changes', input }] }) });
  });
  await page.goto('http://localhost:5261/');
  await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
  await page.evaluate(d => window.__dw.setDoc(d), { ...design, product }); await W(2000);
  await page.click('.rtab:text-is("SOLID")'); await W(150);
  await page.click('.rlabel:has-text("CONFIGURE")'); await W(200);
  await page.locator('.menu .mi', { has: page.locator('text="Product Configurator"') }).first().click(); await W(400);
  await page.click('.prodtabs button:has-text("Rules")'); await W(250);
  check(/your own Anthropic API key, kept only in this browser/.test(await page.textContent('.prodai')), 'without a key, Ask AI explains what it needs');
  await page.fill('.prodai input[aria-label="Anthropic API key"]', 'sk-ant-test');
  await page.click('.prodai button:has-text("Use this key")'); await W(200);
  await page.fill('.prodai textarea', 'Offer painting at 350 per bracket');
  await page.click('.prodai button:has-text("Draft")');
  await page.waitForSelector('.prodproposal', { timeout: 20000 });
  check(sent.length === 2, `a bad first draft is sent back and fixed (${sent.length} calls)`);
  check(sent[0].headers['x-api-key'] === 'sk-ant-test' && sent[0].headers['anthropic-dangerous-direct-browser-access'] === 'true', 'the call uses the engineer\'s key from this browser');
  check(sent[0].body.tool_choice?.name === 'propose_changes' && /boss_d = 40/.test(sent[0].body.messages[0].content), 'the model is asked for a structured proposal and sees the design');
  check(/Unknown name "Qty"/.test(sent[1].body.messages[0].content), 'the retry tells the model what was wrong');
  const prop = await page.textContent('.prodproposal');
  check(/priced at 350 per bracket/.test(prop) && /\+ input/.test(prop) && /\+ rule/.test(prop), 'the proposal is shown with its changes');
  check(/Checked: compiles, fits the design, 4 test case\(s\) still pass \(fixed after 1 retry\)/.test(prop), 'and the result of the check (' + prop.match(/Checked:[^.]*\./)?.[0] + ')');
  const before = await page.locator('.prodgrid tbody tr').count();
  await page.click('.prodproposal button:has-text("Add to product")'); await W(300);
  check((await page.locator('.prodgrid tbody tr').count()) === before + 1, 'Add to product adds the rule to the table');
  await page.click('.prodtabs button:has-text("Try it")'); await W(300);
  await page.click('.prodform .prodfield:has-text("Painted") input[type="checkbox"]'); await W(300);
  check(/Paint/.test(await page.textContent('.prodout')), 'the new option prices paint on Try it');
  await page.click('#modal .dfoot .btn.ok'); await W(300);
  const d = await page.evaluate(() => window.__dw.doc());
  check(d.product.rules.length === product.rules.length + 1 && d.product.inputs.some(i => i.name === 'Painted'), 'OK keeps the AI-drafted changes with the design');
  await page.close(); server.close();
}

// ---------- 2. Describe what you need, on the web configurator ----------
{
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-ai-'));
  const asked = [];
  const llm = { ask: async req => { asked.push(req); return { answers: { ShaftSize: 20, Load: 'Heavy', Quantity: 12, CoverScrews: false }, questions: ['Which material would you like?'], summary: 'Twelve heavy-duty brackets for a 20 mm shaft, without cover screws.' }; } };
  const server = createServer({ productsDir: path.join(root, 'packages/rules/examples'), storageDir: storage, llm });
  await new Promise(r => server.listen(5262, r));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5262/');
  await page.waitForSelector('#assist:not([hidden])', { timeout: 30000 });
  check(true, 'the describe box shows when the server has a model');
  const price0 = await page.textContent('#total');
  await page.fill('#need', 'I need twelve brackets for a 20mm shaft, heavy use, no cover plate');
  await page.click('#assistGo');
  await page.waitForFunction(() => /Twelve heavy-duty/.test(document.querySelector('#assistNote')?.textContent || ''), null, { timeout: 20000 });
  check(await page.getAttribute('.chips button:has-text("20 mm")', 'aria-pressed') === 'true' && await page.getAttribute('.chips button:has-text("Heavy")', 'aria-pressed') === 'true', 'the options are filled in');
  check((await page.inputValue('#f-Quantity')) === '12' && !(await page.isChecked('#f-CoverScrews')), 'including quantity and the cover screws');
  check((await page.textContent('#total')) !== price0 && /BB-20-H$/.test((await page.textContent('#partNumber')).trim()), 'the rules price the new configuration (' + (await page.textContent('#total')) + ')');
  check(/Which material would you like\?/.test(await page.textContent('#assistNote')), 'the assistant\'s question is shown');
  check(/<customer>\nI need twelve brackets/.test(asked[0].content.at(-1).text), 'the description reaches the model as customer text');
  await page.close(); server.close(); fs.rmSync(storage, { recursive: true, force: true });
}

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
process.exit(failed ? 1 : 0);
