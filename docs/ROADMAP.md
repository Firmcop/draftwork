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

Next
- [ ] Sketch extend, splines, text
- [ ] Press pull; sweep with guide rails/twist
- [ ] Run the kernel in a Web Worker so long rebuilds don't pause the UI
- [ ] Desktop packaging (Tauri)

## Phase 2 — Drawings, assemblies, animation
Components, joints, motion; 2D drawings with dimensions; render; add-ins.

## Phase 3 — Manufacturing
2.5D milling, routing, laser/plasma toolpaths, G-code post-processors; sheet metal; plastic design; nesting.

## Phase 4 — Simulation
Static stress and deflection (FEA) on a server.

## Phase 5 — Generative design
Topology optimization on top of simulation.
