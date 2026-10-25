// @draftwork/rules: the configurator's rules engine. No geometry in here; it turns answers into values for a
// Draftwork design (see @draftwork/core), plus validation, BOM, price and text.
export { compile, parseCSV, normalizeTable, RULE_KINDS } from './project.mjs';
export { parse, evaluate, analyze, display, equal, ExprError, FUNCTIONS, UNITS } from './expr.mjs';

/**
 * Apply an evaluation to a @draftwork/core model: parameter values and feature suppression.
 * Returns the problems found (model parameters or features the rules name but the design does not have).
 */
export function applyToModel(result, model) {
  const problems = [];
  const params = new Set(model.parameters().map(p => p.name));
  const values = {};
  for (const [k, v] of Object.entries(result.model.params)) {
    if (params.has(k)) values[k] = v; else problems.push(`The design has no parameter "${k}"`);
  }
  model.setParams(values);
  const features = model.features();
  const suppress = {};
  for (const [k, v] of Object.entries(result.model.suppressed)) {
    if (features.some(f => f.id === k || f.name === k)) suppress[k] = v; else problems.push(`The design has no feature "${k}"`);
  }
  model.setSuppressed(suppress);
  if (Object.keys(result.model.components).length) problems.push('Component choices are not applied yet: @draftwork/core does not swap derived components');
  return problems;
}
