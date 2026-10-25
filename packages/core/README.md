# @draftwork/core

Headless Draftwork: open a design, drive it with parameter values and feature suppression, rebuild it with the exact
(OpenCascade) kernel, and export files, with no modeler interface. It is the base for the configurator: the rules
engine produces values, this package turns them into geometry and release files.

The kernel is built from the same `src/` files as the modeler's engine worker (`build.mjs` reads the module list
from `scripts/build.mjs`), and the API calls the same engine host, so a design gives the same result here as in the app.

## Use

```js
import { createEngine, viewSVG, zip } from '@draftwork/core';

const engine = await createEngine();             // Node: loads OpenCascade from node_modules
const model = engine.open(design);               // a design JSON saved by Draftwork (copied, never changed)

model.parameters();                              // [{ name, expr, value, role, min, max, ... }]
model.setParams({ width: 120, boss_h: '35 mm' }) // numbers or Draftwork expressions
     .setSuppressed({ 'Bolt circle': true });    // feature id or timeline name

const r = await model.rebuild();
// { ok, errors[], warnings[], bodies[{ id, name, volume, area, centerOfMass, bbox }], volume, bbox, sheetMetal[], ms }

await model.export('step');                      // Uint8Array
await model.export('stl');                       // Uint8Array (binary STL)
await model.export('dxf-flat');                  // string, sheet-metal flat pattern with OUTLINE and BEND layers
const views = await model.project(['front', 'top', 'right', 'iso']);   // exact hidden-line projections
viewSVG(views.front);                            // standalone SVG, visible solid and hidden dashed
await zip([{ name: 'part.step', data: step }]);  // Uint8Array
```

The design's own configuration rules (Configure › Rules in the modeler) are applied on every rebuild.
Errors never throw: a bad parameter expression or a failing feature comes back in `errors` with its name.

In a browser, pass the engine yourself: `createEngine({ wasmBinary, opencascade })`.

## Command line

```bash
npm run build:core
node packages/core/bin/draftwork-core.mjs design.json --set width=120 --suppress "Bolt circle" --out out/
node packages/core/bin/draftwork-core.mjs --sample --set boss_h=35      # the built-in bearing bracket
```

Writes `<name>.step`, `<name>.stl`, one SVG per view, `<name>-flat.dxf` for sheet metal, and `report.json`
(parameters, suppressed features, volume, size, errors, timings).

## Tests

`npm run test:core` (also part of `npm test`): volume parity with the modeler's kernel test, parameter and
suppression changes, configuration rules, error reporting, STEP/STL/SVG/DXF/zip output.

## Not yet

- Derived components (`derive` features) and assembly joints: reported as an error / warning for now.
- Drawing sheets with dimensions and title block as PDF (the projection is here; the sheet layout is still in the app).
- Mass needs material densities, which live in the app; volume, area and centre of mass are returned.
