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

Next
- [ ] Sketch constraint solver (coincident, parallel, tangent, equal, dimensions as constraints)
- [ ] Arcs, splines, fillets and trim in sketches
- [ ] Loft, sweep, draft, press pull
- [ ] Sketch and holes on angled and curved faces
- [ ] STEP import
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
