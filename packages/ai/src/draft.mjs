// Draft product changes from a plain-language request ("hinges go heavy duty above 80 kg"). The model proposes
// additions; the rules engine decides: the proposal is merged into a copy of the product, compiled, checked against
// the design and run against the product's test cases. Problems go back to the model to fix (a few times at most),
// and whatever comes out is a proposal for an engineer to accept, never applied by itself.
import { compile } from '@draftwork/rules';
import { describeDesign, describeProduct, LANGUAGE } from './describe.mjs';

const anyObject = { type: 'object', additionalProperties: true };
export const PROPOSE_TOOL = {
  name: 'propose_changes',
  description: 'Propose additions and removals for the configurable product. Use only names that exist or that this proposal adds.',
  input_schema: {
    type: 'object',
    properties: {
      explanation: { type: 'string', description: 'One or two plain sentences for the engineer: what the changes do and any assumption made.' },
      inputs: { type: 'array', items: anyObject, description: 'New inputs (form questions).' },
      variables: { type: 'array', items: anyObject, description: 'New named formulas.' },
      rules: { type: 'array', items: anyObject, description: 'New rules.' },
      tables: { type: 'object', additionalProperties: { type: 'string' }, description: 'New lookup tables: name → CSV text with a header row.' },
      remove_rules: { type: 'array', items: { type: 'integer' }, description: 'Numbers (#) of existing rules to remove, when the request replaces them.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Questions for the engineer when the request is missing a fact (a price, a limit). Leave the related change out.' },
    },
    required: ['explanation'],
  },
};

const DRAFT_SYSTEM = `You help an engineer set up a configurable product on a parametric CAD design in Draftwork.
The product has inputs (the form a customer fills in), lookup tables, variables and rules written in a small formula language.
Turn the engineer's request into the smallest set of changes that does what they asked, by calling propose_changes.
Never invent prices, limits or part numbers the engineer did not give: ask in "questions" instead and leave that change out.
Set design parameters only with "param" rules whose target is one of the design's parameter names, and suppress only features listed in the design.

${LANGUAGE}`;

/**
 * draftChanges({ request, config, design, llm, maxRepairs }) →
 *   { ok, proposal, check, attempts }   where check = checkProposal(...) of the final proposal
 */
export async function draftChanges({ request, config = {}, design = null, llm, maxRepairs = 2 }) {
  if (!request || !String(request).trim()) throw new Error('Describe the change you want');
  const context = `${describeDesign(design)}\n\nThe product now:\n${describeProduct(config)}`;
  let content = `${context}\n\nThe engineer asks:\n${request}`;
  let proposal, check, attempts = 0;
  for (;;) {
    attempts++;
    proposal = normalizeProposal(await llm.ask({ system: DRAFT_SYSTEM, content, tool: PROPOSE_TOOL }));
    check = checkProposal(config, proposal, design);
    if (check.ok || attempts > maxRepairs) break;
    content = `${context}\n\nThe engineer asks:\n${request}\n\nYour previous proposal:\n${JSON.stringify(proposal)}\n\nIt has these problems; send a corrected complete proposal:\n${check.problems.map(p => '- ' + p).join('\n')}`;
  }
  return { ok: check.ok, proposal, check, attempts };
}

function normalizeProposal(p) {
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const tables = {};
  for (const [k, v] of Object.entries(p?.tables && typeof p.tables === 'object' ? p.tables : {})) if (typeof v === 'string') tables[k] = v;
  return {
    explanation: String(p?.explanation || ''),
    inputs: arr(p?.inputs), variables: arr(p?.variables), rules: arr(p?.rules), tables,
    remove_rules: Array.isArray(p?.remove_rules) ? p.remove_rules.filter(n => Number.isInteger(n)) : [],
    questions: Array.isArray(p?.questions) ? p.questions.map(String) : [],
  };
}

/** Merge a proposal into a copy of the product. Rules to remove are numbered from 1, as the model saw them. */
export function applyProposal(config, proposal) {
  const c = JSON.parse(JSON.stringify(config || {}));
  c.inputs = [...(c.inputs || []), ...proposal.inputs];
  c.variables = [...(c.variables || []), ...proposal.variables];
  const drop = new Set(proposal.remove_rules.map(n => n - 1));
  c.rules = [...(c.rules || []).filter((_, i) => !drop.has(i)), ...proposal.rules];
  c.tables = { ...(c.tables || {}) };
  for (const [k, csv] of Object.entries(proposal.tables)) c.tables[k] = { csv };
  return c;
}

/**
 * Check a proposal against the product and the design without applying it:
 *   problems: new compile errors, rules aimed at parameters or features the design does not have, failing test
 *             cases, and errors the product shows for its default answers
 *   ok: no problems
 */
export function checkProposal(config, proposal, design = null) {
  const merged = applyProposal(config, proposal);
  const problems = [];
  const key = e => `${e.section}|${e.name}|${e.field}|${e.message}`;
  const before = new Set(compile(config || {}).errors.map(key));
  const project = compile(merged);
  for (const e of project.errors) if (!before.has(key(e))) problems.push(`${e.section}${e.name != null ? ' ' + e.name : ''}${e.field ? ' (' + e.field + ')' : ''}: ${e.message}`);
  if (design) {
    const params = new Set((design.params || []).map(p => p.name)), feats = design.features || [];
    for (const r of proposal.rules) {
      if (r.kind === 'param' && r.target && !params.has(r.target)) problems.push(`rule sets "${r.target}", but the design has no parameter with that name (it has: ${[...params].join(', ') || 'none'})`);
      if (r.kind === 'suppress' && r.feature && !feats.some(f => f.id === r.feature || f.name === r.feature)) problems.push(`rule suppresses "${r.feature}", but the design has no feature with that id or name`);
    }
  }
  let tests = null, defaults = null;
  if (project.ok) {
    defaults = project.evaluate({});
    for (const m of defaults.messages) if (m.level === 'error' && m.source.kind !== 'validate') problems.push(`with the default answers: ${m.message}`);
    if ((merged.tests || []).length) {
      tests = project.runTests(merged.tests);
      for (const r of tests.results) if (!r.pass) problems.push(`test case "${r.name}" now fails: ${r.failures.join('; ')}`);
    }
  }
  return { ok: problems.length === 0, problems, merged, tests, defaults: defaults && { values: defaults.values, price: defaults.price, messages: defaults.messages } };
}
