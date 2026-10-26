# Roadmap

## Phase 1 — Parametric modeling core *(in progress)*

Done
- [x] Workspace UI: ribbon, browser, view cube, timeline, dialogs
- [x] Sketch tools: line, rectangles, circle, polygon, slot
- [x] Extrude, revolve, hole, primitives, patterns, mirror, offset planes
- [x] Multiple bodies, combine, move/copy
- [x] User parameters and expressions
- [x] Exact B-rep kernel (OpenCascade), mesh fallback
- [x] Fillet, chamfer, shell with persistent edge/face picks
- [x] STEP and STL export; measure, section, mass properties, BOM
- [x] Loft, draft
- [x] Sketches and holes on angled flat faces
- [x] STEP import (multi-solid files become separate bodies)
- [x] Sketch constraint solver: coincident, horizontal/vertical, parallel, perpendicular, tangent, equal, collinear, concentric, midpoint, fix, point-on; driving dimensions (length, distance, radius, diameter, angle) with expressions; degrees-of-freedom status; redundant and conflicting constraints refused
- [x] Three-point arcs, construction geometry
- [x] Sweep and pipe (solid or hollow) along open or closed sketched paths
- [x] Sketch fillet (keeps a virtual corner so dimensions survive), sketch offset, symmetry constraint, point-to-line dimension
- [x] Regions from crossing curves; pick which areas to extrude or revolve by clicking them
- [x] Sketch trim (cuts back to crossings, keeps the new ends attached)
- [x] Sketch extend; fit-point splines (exact cubic Béziers in both the arrangement and the B-rep)
- [x] Press Pull on flat faces (pull out to add, push in to cut)
- [x] Press Pull on curved faces (holes grow/shrink, bosses thicken)
- [x] Spline constraints (point on spline, tangent to a line or arc at an end), exact spline trim, spline offset
- [x] Exact kernel runs in a Web Worker (falls back to the page when workers are blocked)
- [x] Construction geometry: planes (offset, angle, mid, tangent, 3 points), axes (cylinder, edge, 2 points, 2 planes), points (vertex, centre, xyz); patterns and mirrors use them
- [x] Modify: split body, split face, scale, align, replace face, thicken, boundary fill, pattern on path
- [x] Create: coil, thread (cosmetic/modeled), rib, web, emboss/deboss
- [x] Sketch point, text (embedded outline font), mirror, circular pattern, project model edges
- [x] Create Form: subdivision cages (box, quadball, cylinder, torus, plane), cage point editing with symmetry
- [x] Inspect (interference, zebra, curvature comb), select (window, filters), insert (SVG, DXF, canvas, decal, derive), configurations (table, rules), motion links, contact sets
- [x] Mesh: insert STL/OBJ, tessellate, face groups, repair, remesh, reduce, smooth, plane cut, convert to B-rep
- [x] Plastic: rules, boss, snap fit, lip/groove, rest, rib/web
- [x] Sheet metal: rules, base/edge/contour flanges, unfold/refold, flat pattern + DXF (bend allowance from K-factor)
- [x] Surface bodies and tools: extrude/revolve/sweep/loft surface, patch, offset, ruled, trim, untrim, extend, delete face, stitch to solid, unstitch, reverse normal, thicken
- [x] Designs (v0.30): design types (Part standard/sheet metal, Assembly, Hybrid), design tabs, a local design library (projects, folders, data panel, upload), Save with part numbers and version descriptions, Save As (with or without drawings), Save Copy As for components, version history with open and promote

Next
- [ ] Spline handles (tangent direction and weight); extend for splines
- [ ] Press Pull on edges (fillet) and fillet faces (change radius); offset faces that meet neighbours at an angle; sweep with guide rails/twist
- [x] v0.31 Extents: extrude (distance, two sides, to object, all; start offset, taper, thin walls), revolve (angle, two sides, full; symmetric/flipped), hole (simple, counterbore, countersink; tapped metric coarse, cosmetic or modeled thread; distance, to object, through all)
- [x] v0.32 Shape control: chamfer (equal, two distances, distance + angle), variable-radius and full round fillets, Offset Face (neighbouring flat faces extend), Silhouette Split (body or faces), sweep guide rail and end scale, loft along a centre line and to a start/end point
- [x] v0.34 Gaps closed: loft rails (one or two) and end conditions (free, normal, smooth); sweep twist; assembly designs put every body in its own component; New Component operation in hybrid designs; insert saved designs from the library as updatable components; document units (mm, cm, m, in) for display and length fields, unit suffixes in any value
- [x] v0.33 Interface: right-click command wheel (repeat last command, context list for the selected body, sketch wheel), preferences (Z/Y up, theme, new-design type and material, right-drag pan/orbit), Create Drawing from the browser (whole design, a body or a component), job status
- [x] v0.35 Sketch and navigation: plane-picking cursor with highlighted plane/face and tip; origin planes laid out as a corner; click-move-click shapes; heads-up size input while drawing (type, Tab, Enter → dimensions); sketches stay visible after Finish until used; Fusion keyboard shortcuts (S Model Toolbox, V, Shift+J, Shift+N, 1, L/R/C from the model, Ctrl+N/O/B/[/], Ctrl+Alt+V/B/N/P/R, Ctrl+C/V bodies, drawing and simulation keys, Shift+middle-drag orbit); camera clipping follows the model so big imports stay visible
- [x] v0.36 Desktop app: installable web app (manifest, icons, standalone window, offline cache via service worker, update notice) published to GitHub Pages on every push; File → Install Desktop App; native installer (Tauri) planned when file-system integration is needed
- [x] v0.37 Precision sketching (spec Phase 1): SnapEngine with exact endpoint/midpoint/center/quadrant/intersection/on-curve/alignment/grid snaps and distinct markers; snapped points keep their relationship as constraints; line inference (H, V, parallel, perpendicular, tangent); Auto constraints and per-category snap switches; Ctrl to place without snapping; conflict messages name the constraints in the way; live preview of typed sizes; polygon sides, circle radius entry, arc chord and radius; one-line angle dimensions; Fit and camera clipping include sketches
- [x] v0.38 Assembly placement (spec Phase 2): joint origins on vertices, edge midpoints, circle/hole centres, cylinder axes, face centres and component origins, derived from the B-rep and re-found after rebuilds; markers per type with Tab cycling; joint type suggestions; ball joint; remaining degrees of freedom in the browser and joint dialog; joints between two fixed parts flagged
- [x] v0.39 Core drawings (spec Phase 3): Create Drawing from design/assembly, component, body or face (face sets the base view, part kept whole, follows model changes); first-angle projection and ISO projection symbol; A1, A0 and custom sheets; title block with drawing number, revision, finish, approval status and approver; drawing source recorded; File menu entries
- [x] v0.40 Manufacturing drawings (spec Phase 4): out-of-date detection from a model fingerprint, stored view geometry, OUT OF DATE stamp and banner, controlled Update that flags changed and lost annotations (Mark reviewed), update record; hole and thread callouts from feature data with a measured-only fallback; exploded assembly drawings
- [x] v0.41 Advanced drawings and placement (spec Phase 5): auxiliary and broken views; GD&T frames, datum, surface finish and welding symbols; Drawing Check; assembly snap categories and Ctrl override
- [ ] Desktop packaging (Tauri)

## Phase 2 — Drawings, assemblies, animation *(started)*

Done (drawings)
- [x] Multiple sheets, detail views, centrelines, balloons, notes, dimension tolerances, multi-page PDF, DXF export


Done
- [x] Components (group bodies; ground)
- [x] Joints: rigid, revolute, slider, cylindrical, planar; origins on flat faces and round edges; offset, flip; live values
- [x] Joint animation; assembled positions in display, mass properties, STL and STEP export
- [x] Joint origins re-found after rebuilds; sketches on a component's face move with it
- [x] Closed loops of joints (four-bar linkages) solved; joint limits; drag parts along their free motion
- [x] As-built joints (join parts where they sit); rigid groups; components, groups and joints shown in the timeline

Next
- [ ] Joint origins between two faces and on construction planes/axes (vertices, midpoints and axes done in v0.38)
- [ ] Components as separate designs (external references); assembly steps placed between features in the timeline
- [x] 2D drawings: standard views with exact hidden lines, associative dimensions (linear, diameter), title block, PDF/SVG export
- [x] Drawings: section views with hatching, centre marks, radius and angle dimensions, parts list
- [ ] Drawings: detail views, centerlines on side views of holes, more sheets, balloons, tolerances and notes
- [ ] Render; add-ins

## Phase 3 — Manufacturing *(started)*

Done
- [x] Milling: setups, tool library, face, 2D pocket/contour, drilling, 3D roughing, parallel and waterline finishing, simulation with gouge check, Fanuc/Haas/LinuxCNC/GRBL posts, setup sheet

Next
- [x] Additive: FFF slicing with perimeters, solid/sparse infill, skirt, preview and Marlin G-code
- [x] Nesting of flat patterns and outlines onto sheets with DXF export
- [ ] Supports for overhangs, turning, adaptive (constant-engagement) clearing, tool holders and collision checks
2.5D milling, routing, laser/plasma toolpaths, G-code post-processors; sheet metal; plastic design; nesting.

## Phase 4 — Simulation *(started)*

Done
- [x] Linear static stress (voxel FEA with bending-accurate elements), fixed/force/pressure/gravity, stress, displacement, safety factor, report
- [x] Geometric multigrid preconditioner (Galerkin coarse grids, Chebyshev smoothing): about 10 solver iterations regardless of mesh size
- [x] Modal frequencies: natural frequencies and mode shapes (LOBPCG), supported or free, effective mass fractions, animated mode shapes
- [x] Steady-state thermal: fixed temperatures, heat sources, convection; temperature and heat-flux plots, heat balance
- [x] Several studies per design, each with its own ribbon tab; loads spread by tributary area
- [x] Thermal stress: steady-state temperatures drive thermal expansion, combined with mechanical loads; reference temperature
- [x] Linear buckling: geometric stiffness from the static stresses, load factors, critical loads and buckling shapes

Next
- [ ] Tetrahedral meshing that follows curved faces, contacts between bodies, nonlinear materials
Static stress and deflection (FEA) on a server.

## Phase 5 — Generative design
Topology optimization on top of simulation.
