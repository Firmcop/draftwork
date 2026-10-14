# Architecture

## Document model

A design is one JSON document:

```js
{
  version: 2, name, units: 'mm', material, rollback,   // rollback: index of the history marker or null
  params: [{ name, expr, comment }],                    // user parameters
  features: [ { id, type, name, suppressed?, ...type-specific fields } ],
  bodyMeta: { [bodyId]: { name?, hidden?, material?, color? } },
  showOrigin, sketchShown, planeHidden
}
```

Feature types: `sketch`, `plane`, `extrude`, `revolve`, `loft`, `box`, `cylinder`, `sphere`, `torus`, `hole`, `pattern`, `mirror`, `move`, `combine`, `remove`, `fillet`, `chamfer`, `shell`, `draft`, `import`.

A plane reference is `'XY' | 'XZ' | 'YZ'`, the id of an offset-plane feature, or a picked frame `{ o, x, n }` (origin, in-plane X, normal) for angled faces. Imported STEP text lives in `doc.files[fileId]`; the `import` feature only references it, so rebuild cache keys stay small. Files are parsed once per session (async) into `importShapes` before rebuilds use them.

Any numeric field may hold an expression string. Before each rebuild, `resolveFeatures` evaluates expressions against the user parameters; a bad expression marks that feature with an error instead of failing the rebuild.

Body ids derive from the feature that created the body (`featureId` or `featureId:n` for pattern copies), so names, materials and visibility survive rebuilds and engine switches.

## Rebuild

`regenerate(features, rollback, cache)` replays the history in order. Both kernels share this contract and return:

```js
{ bodies: Map<id, body>, sketches, planes, status: Map<featureId, {state, msg}>, tools, before, beforeBodies? }
```

- `status` is `ok | error | suppressed | rolled` per feature; errors never stop later features.
- `tools` holds each feature's tool solid (drawn as the translucent preview when a feature is selected).
- `cache` stores the state after each feature, keyed by the JSON of everything up to it, so editing step *n* replays only from *n*.

### Exact kernel (`brep.js`)

OpenCascade via replicad. Sketch profiles become 2D drawings (nested profiles are cut, islands fused), placed on a `Plane` built from the sketch's plane reference, then extruded or revolved. Booleans, fillets, chamfers and shells are exact.

- **References:** fillet/chamfer edges and shell faces are stored as signatures (edge midpoint, length, curve type; face center, normal, surface type). After each rebuild `matchRefs` finds the nearest current edge/face of the same type within a tolerance. This is a geometric answer to the topological naming problem — robust to moderate changes, not to topology changes.
- **Memory:** OpenCascade objects live in WebAssembly memory. Shapes the kernel creates are tracked; after each rebuild `brepCollect` frees any shape no cache entry or result still uses. Transforms in replicad free their input, so the kernel always clones first.
- **Display:** meshes and true edges are computed lazily per body record and cached on it.

### Mesh kernel (`kernel.js`)

Fallback when WebAssembly cannot start. Same features via three.js geometry and three-bvh-csg booleans. Cut/join tools overshoot by a few microns so faces never coincide exactly, which keeps the CSG fast and stable. Fillet/chamfer/shell report that they need the exact engine.

## Engine loading

The page renders the first frame with the mesh kernel, then loads replicad and the OpenCascade glue from jsDelivr, fetches `engine/occ-gz.wasm`, unpacks it with `DecompressionStream` (if gzip), starts OpenCascade and switches kernels. The badge in the app bar shows which engine is active and why if the exact one failed.

## UI

- `ribbon.js` — one registry of commands (`cmd` for working ones, `planned` with a roadmap phase for the rest). Tabs and dropdowns are data.
- `panels.js` — browser tree, timeline (click selects, click again or double-click edits, drag the marker to roll back), command dialogs. A new feature is inserted immediately for live preview; Cancel restores the snapshot taken before the command.
- `interact.js` — picking (planes, faces, edges), sketch tools, measure, view cube, keyboard.

Undo/redo store whole-document snapshots; rapid edits to one field are grouped.

## Testing

- `tests/kernel.test.mjs`, `tests/brep.test.mjs` — volumes against hand calculations, reference survival, STEP output.
- `tests/e2e.mjs` — headless Chromium session: engine load, edge pick + fillet, sketch → extrude → shell, STEP download. A `window.__dw` hook (localhost only) projects model coordinates to screen points.
