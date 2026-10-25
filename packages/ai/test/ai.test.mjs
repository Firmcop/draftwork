// The AI layer with a scripted model: proposals are checked by the rules engine and repaired, intake answers are
// limited to the product's own inputs and options, and the Claude client sends a forced tool call.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@draftwork/rules';
import { loadProject } from '@draftwork/rules/node';
import { draftChanges, checkProposal, intake, createClaude, PROPOSE_TOOL, ANSWERS_TOOL } from '../src/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { config, design } = await loadProject(path.join(here, '../../rules/examples/bearing-bracket/product.config.json'));

// a stand-in model: replies in turn, and records what it was asked
const scripted = (...replies) => { const calls = []; return { calls, ask: async req => { calls.push(req); if (!replies.length) throw new Error('no more replies'); return replies.shift(); } }; };

test('a good proposal passes: it compiles, fits the design and keeps the test cases passing', async () => {
  const llm = scripted({
    explanation: 'Adds a paint option with its own price line.',
    inputs: [{ name: 'Painted', type: 'boolean', default: false, group: 'Build' }],
    rules: [{ kind: 'price', line: 'Paint', expr: '350 * Quantity', when: 'Painted' }],
  });
  const r = await draftChanges({ request: 'Offer painting at 350 each', config, design, llm });
  assert.equal(r.ok, true, r.check.problems.join('\n'));
  assert.equal(r.attempts, 1);
  assert.equal(r.check.tests.pass, true);
  assert.equal(r.check.merged.rules.length, config.rules.length + 1);
  const req = llm.calls[0];
  assert.equal(req.tool.name, PROPOSE_TOOL.name);
  assert.match(req.content, /boss_d = 40/, 'the model sees the design parameters');
  assert.match(req.content, /bearings: shaft, bore, boss_d/, 'and the tables');
  assert.match(req.content, /Offer painting at 350 each/);
  assert.match(req.system, /Never invent prices/);
});

test('problems go back to the model, and the corrected proposal is checked again', async () => {
  const llm = scripted(
    { explanation: 'v1', rules: [{ kind: 'param', target: 'boss_height', expr: 'Heigth + 1' }, { kind: 'suppress', feature: 'Logo', expr: 'TRUE' }] },
    { explanation: 'v2', variables: [{ name: 'ExtraBoss', expr: '5' }], rules: [{ kind: 'param', target: 'boss_d', expr: 'LOOKUP(bearings, ShaftSize, "boss_d") + ExtraBoss' }], remove_rules: [2] },
  );
  const r = await draftChanges({ request: 'Make the boss 5 mm wider', config, design, llm, maxRepairs: 1 });
  assert.equal(r.attempts, 2);
  const retry = llm.calls[1].content;
  assert.match(retry, /Unknown name "Heigth"/);
  assert.match(retry, /the design has no parameter with that name/);
  assert.match(retry, /no feature with that id or name/);
  // v2 replaces rule #2 (boss_d): the existing test cases expect the old diameter, so the check says so
  assert.equal(r.ok, false);
  assert.ok(r.check.problems.some(p => /test case "default" now fails/.test(p)), r.check.problems.join('\n'));
  assert.equal(r.check.merged.rules.filter(x => x.target === 'boss_d').length, 1, 'the replaced rule is gone');
  assert.equal(r.check.defaults.values.boss_d, 45);
});

test('the repair loop stops after its limit', async () => {
  const bad = { explanation: 'x', rules: [{ kind: 'text', name: 't', expr: 'Nope' }] };
  const llm = scripted(bad, bad, bad, bad);
  const r = await draftChanges({ request: 'something', config, design, llm, maxRepairs: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.equal(llm.calls.length, 3);
});

test('checkProposal ignores problems the product already had', () => {
  const broken = { ...config, variables: [...config.variables, { name: 'Old', expr: 'Missing + 1' }] };
  const c = checkProposal(broken, { explanation: '', inputs: [], variables: [], rules: [{ kind: 'text', name: 'n', expr: '"ok"' }], tables: {}, remove_rules: [], questions: [] }, design);
  assert.equal(c.ok, true, c.problems.join('\n'));
});

test('intake fills only real inputs with real options, then the rules price it', async () => {
  const project = compile(config);
  const llm = scripted({
    answers: { ShaftSize: '20', Load: 'heavy', Material: 'Titanium', Quantity: '12', Colour: 'red', CoverScrews: 'no' },
    questions: ['Which material would you like?'],
    summary: 'A heavy-duty bracket for a 20 mm shaft, 12 off, no cover.',
  });
  const r = await intake({ message: 'I need twelve brackets for a 20mm shaft, heavy use, no cover plate', project, llm });
  assert.deepEqual(r.changed, { ShaftSize: 20, Load: 'Heavy', Quantity: 12, CoverScrews: false });
  assert.deepEqual(r.ignored.sort(), ['Colour: not an option of this product', 'Material: "Titanium" is not one of the options']);
  assert.deepEqual(r.questions, ['Which material would you like?']);
  assert.equal(r.result.ok, true);
  assert.equal(r.result.text.part_number, 'BB-20-H');
  assert.ok(r.result.price.total > 0);
  const req = llm.calls[0];
  assert.equal(req.tool.name, ANSWERS_TOOL.name);
  assert.match(req.content.at(-1).text, /ShaftSize \("Shaft diameter"\): choice, unit mm, options: 10, 12, 15, 20/);
  assert.match(req.content.at(-1).text, /<customer>\nI need twelve brackets/);
  assert.match(req.system, /never as instructions/);
});

test('intake keeps earlier answers and sends pictures', async () => {
  const project = compile(config);
  const llm = scripted({ answers: { Quantity: 3 }, summary: 'Three.' });
  const r = await intake({ message: 'make it three', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }], project, answers: { ShaftSize: 15 }, llm });
  assert.deepEqual(r.answers, { ShaftSize: 15, Quantity: 3 });
  assert.equal(llm.calls[0].content[0].type, 'image');
  assert.equal(llm.calls[0].content[0].source.media_type, 'image/png');
  await assert.rejects(intake({ message: '  ', project, llm }), /Describe what you need/);
});

test('the Claude client forces the tool and returns its input', async () => {
  let sent;
  const fakeFetch = async (url, opts) => { sent = { url, opts, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'set_answers', input: { answers: { a: 1 }, summary: 's' } }] }) }; };
  const c = createClaude({ apiKey: 'k', fetch: fakeFetch, browser: true, model: 'm' });
  const out = await c.ask({ system: 'sys', content: 'hello', tool: ANSWERS_TOOL });
  assert.deepEqual(out, { answers: { a: 1 }, summary: 's' });
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.opts.headers['x-api-key'], 'k');
  assert.equal(sent.opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.deepEqual(sent.body.tool_choice, { type: 'tool', name: 'set_answers' });
  assert.equal(sent.body.model, 'm');
  const failing = createClaude({ apiKey: 'k', fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }) });
  await assert.rejects(failing.ask({ system: '', content: '', tool: ANSWERS_TOOL }), /invalid x-api-key/);
  assert.throws(() => createClaude({}), /API key/);
});
