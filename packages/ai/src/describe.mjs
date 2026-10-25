// Compact, plain-text descriptions of a design and a product for the model to read. Everything a rule may refer to
// is listed by its exact name; nothing else from the design (geometry, sketches) is sent.
import { FUNCTIONS, normalizeTable, display } from '@draftwork/rules';

export function describeDesign(design) {
  if (!design) return 'No design.';
  const lines = [`Design "${design.name || 'untitled'}" (units ${design.units || 'mm'}).`, 'Parameters (name = expression // comment):'];
  for (const p of design.params || []) lines.push(`  ${p.name} = ${p.expr}${p.comment ? '   // ' + p.comment : ''}`);
  if (!(design.params || []).length) lines.push('  (none)');
  lines.push('Features in timeline order (id: name, type):');
  for (const f of design.features || []) lines.push(`  ${f.id}: ${f.name || f.id}, ${f.type}${f.suppressed ? ' (suppressed)' : ''}`);
  return lines.join('\n');
}

export function describeProduct(config = {}) {
  const lines = [];
  lines.push('Inputs:');
  for (const i of config.inputs || []) {
    const bits = [i.type || 'number'];
    if (i.unit) bits.push('unit ' + i.unit);
    if (i.min != null) bits.push('min ' + i.min);
    if (i.max != null) bits.push('max ' + i.max);
    if (i.options != null) bits.push('options ' + (Array.isArray(i.options) ? i.options.map(display).join(' | ') : '= ' + i.options));
    if (i.default != null) bits.push('default ' + display(i.default));
    if (i.visible) bits.push('visible when ' + i.visible);
    lines.push(`  ${i.name}${i.label && i.label !== i.name ? ` ("${i.label}")` : ''}: ${bits.join(', ')}`);
  }
  if (!(config.inputs || []).length) lines.push('  (none)');
  lines.push('Tables (columns; first rows):');
  for (const [name, t] of Object.entries(config.tables || {})) {
    try { const n = normalizeTable(t); lines.push(`  ${name}: ${n.columns.join(', ')}; ${n.rows.slice(0, 4).map(r => r.join(' / ')).join('; ')}${n.rows.length > 4 ? `; … (${n.rows.length} rows)` : ''}`); }
    catch (e) { lines.push(`  ${name}: (unreadable: ${e.message})`); }
  }
  if (!Object.keys(config.tables || {}).length) lines.push('  (none)');
  lines.push('Variables:');
  for (const v of config.variables || []) lines.push(`  ${v.name} = ${v.expr}`);
  if (!(config.variables || []).length) lines.push('  (none)');
  lines.push('Rules:');
  (config.rules || []).forEach((r, i) => lines.push(`  #${i + 1} ${JSON.stringify(r)}`));
  if (!(config.rules || []).length) lines.push('  (none)');
  if (config.currency) lines.push(`Currency: ${config.currency}`);
  return lines.join('\n');
}

export const LANGUAGE = `Formula language (spreadsheet-like):
- Numbers are millimetres and degrees; a unit after a number converts it: 2.5 cm, 1 in, 30 deg.
- Text in double quotes; text compares without regard to case. TRUE, FALSE. Lists: [a, b] or ("a", "b").
- Operators: + - * / ^ %, & joins text, = <> < <= > >=, AND OR NOT, x IN ("a", "b").
- Functions: ${Object.keys(FUNCTIONS).join(', ')}.
- Tables: LOOKUP(table, key, "column"[, default]) matches the first column exactly; RANGELOOKUP(table, value, "column") takes the row with the largest first-column value at or below value (price breaks, sizes); COLUMN(table, "column") lists a column (for choice options).
- IF(cond, a, b) evaluates only the branch it takes. Names are case-sensitive and must already exist or be added in the same proposal.
Rule kinds (JSON objects in "rules"):
- {"kind":"param","target":<design parameter name>,"expr":<number formula>}  sets a design parameter
- {"kind":"suppress","feature":<feature id or name>,"expr":<true to suppress>}
- {"kind":"component","slot":<name>,"expr":<text>}
- {"kind":"validate","level":"error"|"warning"|"info","expr":<must be true>,"message":<text; {formula} is filled in>}
- {"kind":"bom","item":<text, or "=formula">,"qty":<formula>,"unit":<text>}
- {"kind":"price","line":<text>,"expr":<amount formula>}
- {"kind":"text","name":<name>,"expr":<text formula>}
Any rule may have "when": <formula> (the rule applies only when true).
Inputs: {"name","label","type":"number"|"choice"|"boolean"|"text","unit","min","max","step","default","options":[...] or a formula string such as "COLUMN(t, \\"c\\")","visible":<formula>,"group"}.
Variables: {"name","expr"}.`;
