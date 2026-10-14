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

Next
- [ ] Sketch text; spline handles (tangent direction and weight); extend for splines
- [ ] Press Pull on edges (fillet) and fillet faces (change radius); offset faces that meet neighbours at an angle; sweep with guide rails/twist
- [ ] Desktop packaging (Tauri)

## Phase 2 — Drawings, assemblies, animation *(started)*

Done
- [x] Components (group bodies; ground)
- [x] Joints: rigid, revolute, slider, cylindrical, planar; origins on flat faces and round edges; offset, flip; live values
- [x] Joint animation; assembled positions in display, mass properties, STL and STEP export
- [x] Joint origins re-found after rebuilds; sketches on a component's face move with it

Next
- [ ] Closed loops of joints (four-bar linkages); joint limits; drag to move along free axes
- [ ] As-built joints, rigid groups, motion links; contact sets
- [ ] Joints and components in the timeline; components as separate designs (external references)
- [ ] 2D drawings with dimensions; render; add-ins

## Phase 3 — Manufacturing
2.5D milling, routing, laser/plasma toolpaths, G-code post-processors; sheet metal; plastic design; nesting.

## Phase 4 — Simulation
Static stress and deflection (FEA) on a server.

## Phase 5 — Generative design
Topology optimization on top of simulation.
