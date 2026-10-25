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
| A2 collinear, equal, symmetry inference | open | available as manual constraints |
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
| D1 edge intersections, named points, work planes, construction axes | open | |
| D1 geometry decides accuracy, cursor only chooses | done | screen distance ranks candidates; positions come from B-rep signatures |
| D2 highlight and distinct markers | done | square, triangle, circle-dot, dashed circle (axis), diamond (face) |
| D2 pick on moving part, then stationary part; preview | existing + done | the parts move live; Cancel restores |
| D2 suggest a joint | done | two axes → cylindrical, axis/centre pairs → revolute, two corners → ball, two faces → rigid; applied until the user chooses a type |
| D2 numeric offsets / clearance | existing | offset along the joint direction, plus each joint value |
| D2 feedback: selected references, joint, remaining DOF | done | hint names reference, body and component; dialog states the remaining motion |
| D3 shaft-to-hole, hole-centre, flush faces, offset placement | done | through centre/axis references and offsets |
| D3 centering between faces, frame members, hole patterns | open | |
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
| D6 configurable snap categories, temporary override | open | (sketch has both; assembly not yet) |

Verification: `node --test tests/asmref.test.mjs` and `node scripts/build.mjs && node tests/e2e-placement.mjs`.
By hand: two components, Assemble ▸ Joint (J), hover a corner: a square marker and “Vertex on …” in the hint; Tab cycles;
click, then click a corner on the other part: Ball is suggested and the corners meet exactly.

## Module C and later phases

| Phase | Scope | Status |
|---|---|---|
| 3 Core drawings | drawing from selected component/body/face, first-angle, A1/A0/custom sheets, title block fields (revision, finish, approval) | open (base/projected views, dimensions, PDF exist) |
| 4 Manufacturing drawings | out-of-date detection with controlled update preserving annotations, revision record, exploded/auxiliary/broken views | open (section, detail, BOM, balloons, DXF exist) |
| 5 Advanced | ball/planar suggestions, alignment inference, GD&T, datum, surface finish, welding symbols, drawing checks | open |

## Phase 1 verification

```bash
npm install
npm test                                   # includes tests/snap.test.mjs (snap geometry, solver persistence)
node scripts/build.mjs && node tests/e2e-precision.mjs
```

By hand: open a part, Create Sketch on XY, press L. Hover near the origin, a line's middle, a circle's centre or top,
or where two lines cross: each shows its own marker, and clicking places the point exactly there. Draw a line almost level:
H appears and the line snaps level. Type `3000`, Tab, `30`, Enter: a 3000 mm line at 30°, with both values kept as dimensions.
