# Precision CAD specification — status

Tracks the unified specification for sketching, drawings and assemblies (modules A–F) against Draftwork.
Status: **done** = implemented and covered by automated tests · **partial** = works with stated limits ·
**existing** = was already in Draftwork before this work · **open** = not started.

## Phase 0 — audit (v0.37)

| Area | Found in Draftwork | Key files |
|---|---|---|
| Geometry kernel | Exact OpenCascade B-rep in a worker; mesh fallback | `brep.js`, `enginehost.js`, `kernel.js` |
| Sketch solver | Minimum-norm Gauss–Newton; 12 geometric constraints and driving dimensions; DOF analysis; refuses conflicting and redundant constraints | `solver.js`, `sketchui.js` |
| Keyboard / pointer | Fusion shortcut map; heads-up size input; capture-phase key handling | `interact.js`, `sketchhud.js`, `ui2.js` |
| Assemblies | Components, ground, joints (rigid, revolute, slider, cylindrical, planar), as-built, loops, limits; saved with the design | `assembly.js`, `assembly2.js` |
| Drawings | Views with exact hidden lines, third-angle, section/detail/projected views, dimensions, centre marks, balloons, parts list, notes, tolerances, sheets A4–A2, PDF, DXF | `drawing.js`, `drawing2.js` |
| Persistence | Document JSON in IndexedDB (projects, designs, versions); download/open `.json` | `library.js` |
| Risk | References re-matched by geometric signature after each rebuild: robust to moderate edits, not to topology changes | `brep.js` (`brepSigMap`) |

## Module A — intelligent sketching

| Requirement | Status | Notes |
|---|---|---|
| A1 endpoints, vertices, origin, construction points | done | exact solved positions |
| A1 midpoints | done | new point gets a `midpoint` constraint |
| A1 centers of circles and arcs | done | |
| A1 quadrants | done | `onCircle` + horizontal/vertical with the centre |
| A1 intersections | done | line–line, line–circle/arc, circle–circle, within segment and arc spans; `onLine`/`onCircle` on both |
| A1 grid | existing | 1 mm when “Snap to 1 mm” is on |
| A1 projected references and model edges | partial | through Project (projected curves become snappable sketch curves); no direct snapping to unprojected model edges |
| A1 distinct markers | done | square, triangle, circle-dot, diamond, ×, bow-tie, dot |
| A2 horizontal / vertical | done | constraint added |
| A2 parallel / perpendicular | done | 1.5° capture, constraint added |
| A2 tangent | done | line leaving an arc end |
| A2 coincidence | done | via point snaps |
| A2 alignment with existing points | done | dotted guide, exact x or y; not persisted (temporary guide) |
| A2 collinear, equal, symmetry inference | done (v0.42) | collinear when continuing a line's extension; equal length / radius within a few pixels; symmetric points across construction lines |
| A2 disable automatic constraints | done | palette: Auto constraints, Inference; per-category snap switches; Ctrl override |
| A2 remove individual constraints | existing | select glyph, Delete |
| A3 constraint set | existing | + one-line angle dimension (angle to the sketch x axis) |
| A3 conflict / redundancy feedback | done | refused; names and highlights the constraints in the way (single culprits, else related constraints) |

## Module B — dynamic dimensioning

| Requirement | Status | Notes |
|---|---|---|
| Live values near the cursor | existing | |
| Typed values drive real geometry and dimensions | done | length, angle, width, height, diameter, radius, distance constraints |
| Preview updates while typing | done | |
| Line length + angle, chaining | done | angle kept as a dimension |
| Rectangle anchored at first corner | done | |
| Circle diameter or radius (`25r`, `r25`) | done | |
| Arc chord + radius | done | 3-point arc tool |
| Polygon size + side count | done | 3–64 sides |
| Enter / Tab / Esc, no shortcut leakage, invalid input | done | bad fields outlined; message names the field |
| Units and expressions | existing | document units; `mm cm m in ft`, parameters |
| B6 acceptance list | done | `tests/e2e-precision.mjs` |

## Module D — assembly placement (Phase 2, v0.38)

| Requirement | Status | Notes |
|---|---|---|
| D1 vertices and endpoints | done | from line edges; cylinder seams excluded |
| D1 edge midpoints | done | |
| D1 circle and arc centres, hole centres | done | offered from anywhere along the rim |
| D1 cylinder and hole axes | done | |
| D1 planar face centres | done | |
| D1 face corners | done | (the face's vertices) |
| D1 component origins / local coordinate systems | done | |
| D1 edge intersections, named points, work planes, construction axes | done (v0.42) | virtual corners of coplanar edges (re-found from both edges); construction and origin planes, construction and origin axes, construction points (fixed side) |
| D1 geometry decides accuracy, cursor only chooses | done | screen distance ranks candidates; positions come from B-rep signatures |
| D2 highlight and distinct markers | done | square, triangle, circle-dot, dashed circle (axis), diamond (face) |
| D2 pick on moving part, then stationary part; preview | existing + done | the parts move live; Cancel restores |
| D2 suggest a joint | done | two axes → cylindrical, axis/centre pairs → revolute, two corners → ball, two faces → rigid; applied until the user chooses a type |
| D2 numeric offsets / clearance | existing | offset along the joint direction, plus each joint value |
| D2 feedback: selected references, joint, remaining DOF | done | hint names reference, body and component; dialog states the remaining motion |
| D3 shaft-to-hole, hole-centre, flush faces, offset placement | done | through centre/axis references and offsets |
| D3 centering between faces, frame members, hole patterns | done (v0.42) | centre between two parallel faces; Align a second hole sets the rotation (revolute, cylindrical, rigid); frame-member presets not provided |
| D4 rigid, revolute, slider, cylindrical, planar | existing | |
| D4 ball | done | angle, pitch, roll about the shared point |
| D4 grounded component | existing | |
| D4 no joint from a temporary snap | done | joints are made only on OK |
| D5 respects grounded parts, loops, limits | existing | |
| D5 incompatible joints | done | both sides fixed → error; both on the same part → error |
| D5 under-constrained feedback | done | browser shows free / n DOF / fully constrained |
| D5 over-constrained loops | existing | loops that cannot close are flagged |
| D5 save and reopen | done | references stored with their source signatures; tested after reload |
| D6 selection cycling | done | Tab / Shift+Tab |
| D6 configurable snap categories, temporary override | done (v0.41) | per type in the joint dialog; Ctrl = faces, axes and planes only |

Verification: `node --test tests/asmref.test.mjs` and `node scripts/build.mjs && node tests/e2e-placement.mjs`.
By hand: two components, Assemble ▸ Joint (J), hover a corner: a square marker and “Vertex on …” in the hint; Tab cycles;
click, then click a corner on the other part: Ball is suggested and the corners meet exactly.

## Module C — drawings (Phase 3, v0.39)

| Requirement | Status | Notes |
|---|---|---|
| C1 Create Drawing / from model / from assembly | done | whole design in assembled positions |
| C1 from selected component | done | component alone; follows the component's current bodies |
| C1 from selected body | done | |
| C1 from selected face | done | the face's normal sets the front view; the whole part is drawn |
| C1 from exploded assembly | done (v0.40) | Create Drawing ▸ Exploded assembly |
| C1 open existing drawing | done | File ▸ Open Drawing, workspace switcher |
| C1 toolbar and browser context menus | done | File menu, command search, browser body/component menus |
| C2 source identity and orientation preserved | done | `doc.drawing.source`, `doc.drawing.orient` (face re-found after model changes) |
| C3 standard and isometric views | existing | exact hidden-line removal in the engine |
| C3 projected views aligned to a base view | existing | |
| C3 first- and third-angle | done | layout mirrors; existing projected views flip when switching |
| C3 hidden lines visible / removed | existing | per view |
| C3 section, detail views | existing | |
| C3 auxiliary, broken, exploded views | done (v0.40–v0.41) | |
| C4 linear, aligned, angular, radial, diameter dims; centre marks, centrelines, notes, leaders | existing | |
| C4 hole / thread callouts, GD&T, datums, surface finish, welding | done (v0.40–v0.41) | |
| C4 never invent values | done | empty title fields print a dash; revision and drawing number start empty |
| C7 A4–A0 and custom sheets | done | custom 50–5000 mm per side |
| C7 scale, units, projection standard | done | |
| C7 title block: drawing no., part no., revision, material, finish, author, approval status, date | done | plus checked by and approver |
| C7 PDF and vector export, DXF | existing | use the active sheet size |

Verification: `node scripts/build.mjs && node tests/e2e-drawing3.mjs` (face orientation checked on an axis-aligned face and on one turned 30°, to 0.01 mm).
By hand: File ▸ Create Drawing from Face…, click a flat face, choose A1 and First angle, Create. Double-click the title block to fill it in.

## Module C — manufacturing drawings (Phase 4, v0.40)

| Requirement | Status | Notes |
|---|---|---|
| C6 detect that a drawing may be out of date | done | fingerprint of features, components, joints, parameters, visibility, source, orientation, explode |
| C6 notify and offer a controlled update | done | banner with Update, OUT OF DATE stamp on the sheet (also in PDF); the earlier views stay until Update |
| C6 regenerate model-derived geometry | done | views, sections, details from the exact model |
| C6 preserve manual annotations | done | dimensions, callouts, notes, balloons kept and re-found |
| C6 flag invalid or displaced annotations | done | Δ changed (with old value), ! geometry not found; Mark reviewed |
| C6 record source revisions and update status | done | `doc.drawing.revs` (number, date, fingerprint, changed, lost) |
| C6 no silent overwrite | done | adding a view to an out-of-date drawing updates it and says so; a new drawing source always gets fresh views |
| C4 hole callouts | done | simple / counterbore / countersink / tapped (thread, pitch, LH, drill), depth or THRU, n× identical holes |
| C4 thread callouts | done | thread features on shafts and holes; nominal size only when it matches a metric size, otherwise THREAD Ø… |
| C4 never invent specifications | done | no feature → measured Ø, marked “(measured; no hole feature)”; several matching features → measured, with a note; no thread class or tolerance added |
| C5 exploded assembly views | done | drawing-wide explode factor (Sheet & Title Block, or Create Drawing ▸ Exploded assembly) |
| C5 balloons, parts list from instances | existing | balloons on removed parts are flagged on Update |
| C5 links to component drawings | done (v0.42) | Component Sheets: one sheet per component in its own coordinates; the parts list's DWG column links to it |
| C3 auxiliary and broken views | done (v0.41) | |
| C7 DXF of supported entities | existing | |

Verification: `node scripts/build.mjs && node tests/e2e-drawing4.mjs`.
By hand: make a drawing, add a hole callout (Annotate ▸ Hole / Thread Callout) and a dimension, then change the model in Design:
the drawing says OUT OF DATE; Update shows the new values with Δ markers.

## Phase 5 — advanced capabilities (v0.41)

| Requirement | Status | Notes |
|---|---|---|
| C3 auxiliary views | done | from an inclined edge on a principal view; exact projection square-on to the face (tested to 0.01 mm); VIEW letter and viewing arrow |
| C3 broken views | done | horizontal or vertical band removed; dimensions across it keep the true length; break lines; centre marks and centrelines in the band skipped |
| C4 GD&T feature control frames | done | 14 characteristics as vector glyphs, Ø zone, Ⓜ/Ⓛ, three datums with modifiers |
| C4 datum references | done | datum feature symbols; letters skip I, O, Q |
| C4 surface finish | done | ISO 1302: any process, removal required, removal not permitted; Ra and method |
| C4 welding symbols | done | fillet, square, V, bevel, plug; arrow / other / both sides; size, length, all-around, field weld, tail note |
| C4 never invent values | done | empty tolerance prints “?” and is an error in the check |
| Automated drawing checks | done | out of date, flagged / lost / unspecified annotations, GD&T rules (tolerance, datum required / forbidden, undefined or duplicate datums), views off the border or over the title block, overlaps, empty title fields, approval, duplicate dimensions |
| D6 assembly snap categories, enable/disable | done | per type in the joint dialog, kept per browser |
| D6 temporary override | done | Ctrl: faces and axes only |
| A2 collinear / equal / symmetry inference | done (v0.42) | |
| D1 edge intersections, construction planes and axes as joint origins | done (v0.42) | |
| D3 centering between faces, hole-pattern alignment | done (v0.42) | |
| C5 links to component drawings | done (v0.42) | Component Sheets: one sheet per component in its own coordinates; the parts list's DWG column links to it |

Verification: `node scripts/build.mjs && node tests/e2e-drawing5.mjs`.

## Gaps closed (v0.42)

All open items from Phases 1–5 are implemented and tested in `tests/snap.test.mjs`, `tests/asmref.test.mjs` and
`tests/e2e-gaps2.mjs`: collinear / equal / symmetry inference; joint origins on edge intersections, between parallel
faces and on construction planes, axes and points; hole-pattern alignment; component sheets linked from the parts list.
Not provided: dedicated frame-member alignment presets (the general references cover square and round tube ends).

## Phase 1 verification

```bash
npm install
npm test                                   # includes tests/snap.test.mjs (snap geometry, solver persistence)
node scripts/build.mjs && node tests/e2e-precision.mjs
```

By hand: open a part, Create Sketch on XY, press L. Hover near the origin, a line's middle, a circle's centre or top,
or where two lines cross: each shows its own marker, and clicking places the point exactly there. Draw a line almost level:
H appears and the line snaps level. Type `3000`, Tab, `30`, Enter: a 3000 mm line at 30°, with both values kept as dimensions.

## Speed (v0.43)

Precision work on imported and inserted models depends on them loading quickly. Measured on a 1.3 MB STEP file (31 solids) and a 97-feature inserted design:

| Step | Before | After |
|---|---|---|
| Undo entry / saved document with the file | 1.3 MB each | about 2 KB |
| STEP import | 4.8–5.6 s | 3.7 s |
| Reading the import on reopen | 1.2 s (STEP parse) | 0.16 s (cached BREP) |
| Insert a design already built or saved | 7.5 s | 1.2 s |

Picking signatures are computed after the shapes appear, so references resolve a moment later on large imports; display meshes use an angular tolerance of 0.35 rad (about 18 segments per circle). Exact geometry, measurements and exports are unchanged. `tests/e2e-perf.mjs` guards each of these.
