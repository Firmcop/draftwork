# @draftwork/rules

The configurator's rules engine. A **project** (`product.config.json`) holds the form a customer fills in, lookup
tables, named formulas and rules. Evaluating it for one set of answers gives the values that drive a Draftwork
design, plus validation messages, a bill of materials, a price and document text. It has no geometry in it and
evaluates in about a millisecond, so prices and checks can update on every keystroke; `@draftwork/core` turns the
result into a model and files.

```js
import { compile, applyToModel } from '@draftwork/rules';
import { createEngine } from '@draftwork/core';

const project = compile(config);           // project.errors lists problems, with section, name and field
const r = project.evaluate({ ShaftSize: 20, Load: 'Heavy', Quantity: 12 });
// r.ok, r.form (inputs with live options, limits, visibility), r.values, r.messages,
// r.model { params, suppressed, components }, r.bom, r.price { currency, lines, total }, r.text
r.explain('width');                         // how a value was worked out, back to the answers

const model = (await createEngine()).open(design);
applyToModel(r, model);                     // sets parameters and suppression; returns any mismatches
await model.rebuild();
```

## The project file

| Section | Holds |
| --- | --- |
| `inputs` | The form: `number` (with `unit`, `min`, `max`, `step`), `choice` (`options`: a list or a formula such as `COLUMN(table, "col")`), `boolean`, `text`. `visible`, `options`, `min`, `max` can be formulas; a default starting with `=` is a formula. Hidden inputs use their default. |
| `tables` | Lookup tables: a path to a CSV file (header row first), CSV text, or `{ columns, rows }`. |
| `variables` | Named formulas, used by other formulas. |
| `rules` | `param` (a design parameter: `target`, `expr`), `suppress` (`feature` by id or timeline name, `expr` true to suppress), `component` (`slot`, `expr`), `validate` (`expr` must be true, else `message` at `level` error, warning or info; `{formula}` in the message is filled in), `bom` (`item`, or `=formula`; `qty`; `unit`), `price` (`line`, `expr`), `text` (`name`, `expr`). Any rule can have `when`. |
| `tests` | Test cases: `answers` and `expect` (`{ name: value, "price.total": n, "model.suppressed.X": true, messages: "text" }`). |

Rules can use inputs, variables and other `param` targets by name. Names are checked when the project compiles
(with "did you mean"), circular references are reported as a path, and evaluation errors become messages that
name the formula, without cascading.

## Formulas

Spreadsheet-style: `+ - * / ^ %`, `&` joins text, `= <> < <= > >=`, `AND OR NOT`, `IN (…)`, lists `[a, b]`.
Lengths are millimetres and angles degrees as in Draftwork; a unit after a number converts it (`2.5 cm`, `1 in`, `30 deg`).
Text compares without regard to case.

Functions: `IF IFS SWITCH AND OR NOT MIN MAX SUM AVERAGE COUNT ABS SQRT EXP LN LOG10 ROUND ROUNDUP ROUNDDOWN CEILING FLOOR
MOD POWER SIN COS TAN ASIN ACOS ATAN ATAN2 BETWEEN CLAMP IN LIST ITEM LEN UPPER LOWER TRIM CONCAT TEXT VALUE CONTAINS
ISBLANK ERROR`, and for tables `LOOKUP(table, key, column[, default])` (exact match on the first column),
`RANGELOOKUP(table, value, column[, default])` (largest first-column value at or below: price breaks, sizes) and
`COLUMN(table, column)`.

## Command line

```bash
node packages/rules/bin/draftwork-configure.mjs packages/rules/examples/bearing-bracket/product.config.json \
  --answer ShaftSize=20 --answer Load=Heavy --answer Quantity=12 --explain width --out out/
node packages/rules/bin/draftwork-configure.mjs <project> --test        # run the project's test cases
```

Prints messages and the price, rebuilds the model and writes STEP, STL, view SVGs and `quote.json`.

## Example

`examples/bearing-bracket` configures the modeler's sample bracket: shaft size from a bearings table sets the bore,
boss and footprint; load class sets plate thickness; cover screws switch the tapped holes; material and quantity set
the price with volume discounts.
