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

Feature types: `sketch`, `plane`, `extrude`, `revolve`, `loft`, `sweep`, `presspull`, `box`, `cylinder`, `sphere`, `torus`, `hole`, `pattern`, `mirror`, `move`, `combine`, `remove`, `fillet`, `chamfer`, `shell`, `draft`, `import`.

A plane reference is `'XY' | 'XZ' | 'YZ'`, the id of an offset-plane feature, or a picked frame `{ o, x, n }` (origin, in-plane X, normal) for angled faces. Imported STEP text lives in `doc.files[fileId]`; the `import` feature only references it, so rebuild cache keys stay small. Files are parsed once per session (async) into `importShapes` before rebuilds use them.

Any numeric field may hold an expression string. Before each rebuild, `resolveFeatures` evaluates expressions against the user parameters; a bad expression marks that feature with an error instead of failing the rebuild.

Body ids derive from the feature that created the body (`featureId` or `featureId:n` for pattern copies), so names, materials and visibility survive rebuilds and engine switches.

## Sketches

A sketch holds `geo = { points, curves, cons }`: points, lines, arcs (counter-clockwise from `a` to `b` around `c`) and circles, plus constraints and dimensions. `'O'` is the fixed origin point.

`solver.js` turns each constraint into residual equations and solves with a minimum-norm Gauss-Newton step (`Δ = −Jᵀ(JJᵀ + μI)⁻¹ r`), so under-constrained geometry moves as little as possible. While dragging, the dragged points are weighted 10⁶ so the rest of the sketch gives way first. `analyzeSketch` row-reduces the Jacobian for the degrees of freedom and marks entities in the null space as free (drawn blue). New constraints must reduce the degrees of freedom; redundant ones are refused, and conflicting ones fail to solve.

Tangency between curves that share an endpoint uses "perpendicular to the radius at that point" instead of a distance condition. The distance form has a zero first derivative at the solution and would hide degrees of freedom.

At rebuild time `sketchWithGeo` re-solves the sketch with dimension expressions evaluated, so parameters drive sketch geometry. Closed chains of non-construction lines and arcs (and circles) become `loop` / `circle` profiles for the kernels. 
**Regions.** `geoRegions` builds a planar arrangement of all non-construction curves (`curveSplits` finds every crossing, then faces are traced), so crossing curves divide the sketch into areas like Fusion does. Each area gets an interior sample point and a default fill: even-odd over the closed loops, and areas outside every loop (closed only by crossing open curves) count as filled. An extrude or revolve stores the areas the user clicked as sample points `regions: [{x, y}]`; after any edit, each point picks whichever area now contains it, and with none stored the filled areas are used. **Splines.** A spline curve stores its fit points (`pts`, ordinary points, so constraints and dragging work on them). `splineBeziers` turns them into cubic Bézier spans with chord-weighted Catmull-Rom tangents; the arrangement, the region tracing (exact area by 3-point Gauss–Legendre), the mesh kernel and the exact kernel (`cubicBezierCurveTo`) all use the same spans, so the solid matches what is drawn. Crossings with a Bézier are found on a polyline and polished with Newton's method.

Trim uses the same crossings: it removes the clicked piece and attaches the new end points to the cutting curve with point-on constraints.

Older sketches with primitive profiles (`rect`, `circle`, `polygon`, `slot`, `poly`) still work.

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

The page renders the first frame with the mesh kernel, then starts the exact engine and switches kernels. The badge in the app bar shows which engine is active and why if the exact one failed.

The exact engine runs in a **Web Worker**, so a long rebuild never freezes the interface:

- The build wraps `solver.js`, `kernel.js`, `brep.js` and `enginehost.js` in one self-contained `async function engineFactory(urls)`. `engineclient.js` starts a module worker from `engineFactory.toString()` (a Blob URL), passing absolute library URLs read from the page's import map, and the worker loads replicad and the OpenCascade glue, fetches `engine/occ-gz.wasm` and unpacks it with `DecompressionStream`.
- If the page may not start workers (for example a strict content security policy), the same `engineFactory` runs on the page instead (`?inline-engine` forces this for testing).
- Messages carry plain data only. OCC shapes stay in the worker and are named by integer tokens. A rebuild returns body records `{ id, name, feature, shape: token }` plus, for shapes the page has not seen, the display mesh (typed arrays, transferred without copying), face/edge signatures and mass properties. Tool-preview meshes are fetched on demand. Freed shapes are reported so the page drops their data.
- Picking, reference matching (same rule as `matchRefs`), measurements and mass properties all work from that shipped data, so the page never waits on the worker except for rebuilds, STEP import and STEP export.
- Edits made while a rebuild runs queue exactly one more rebuild with the latest document.

## UI

- `ribbon.js` — one registry of commands (`cmd` for working ones, `planned` with a roadmap phase for the rest). Tabs and dropdowns are data.
- `panels.js` — browser tree, timeline (click selects, click again or double-click edits, drag the marker to roll back), command dialogs. A new feature is inserted immediately for live preview; Cancel restores the snapshot taken before the command.
- `interact.js` — picking (planes, faces, edges), sketch tools, measure, view cube, keyboard.

Undo/redo store whole-document snapshots; rapid edits to one field are grouped.

## Testing

- `tests/kernel.test.mjs`, `tests/brep.test.mjs` — volumes against hand calculations, reference survival, STEP output.
- `tests/e2e.mjs` — headless Chromium session: engine load, edge pick + fillet, sketch → extrude → shell, STEP download. A `window.__dw` hook (localhost only) projects model coordinates to screen points.
