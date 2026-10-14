# Draftwork

Parametric CAD in the browser. Sketch on planes or faces, build solids with a feature timeline, edit any dimension (or drive it from parameters) and the whole model rebuilds. Exact solid geometry comes from OpenCascade compiled to WebAssembly; export STEP for CAD/CAM or STL for printing.

**Status:** Phase 1 in progress — see [docs/ROADMAP.md](docs/ROADMAP.md).

## What works

| Area | Features |
|---|---|
| Workspace | Workspace switcher, tabbed ribbon (Solid, Surface, Mesh, Sheet Metal, Plastic, Manage, Utilities, contextual Sketch), browser tree, view cube, navigation bar, timeline with history marker, command dialogs with OK/Cancel |
| Sketch | On origin/offset planes or any flat face (including angled ones). Line, 3-point arc, fit-point spline, 2-point and center rectangle, circle, polygon, slot, construction geometry. Sketch fillet, offset, trim and extend. Constraint solver with 12 geometric constraints and driving dimensions (expressions allowed), degrees-of-freedom status, drag to reshape. Crossing curves split the sketch into areas; Extrude and Revolve use the filled areas or the ones you click |
| Solid | Extrude, revolve, sweep, pipe, loft, hole (simple/counterbore, flat/drill point), box, cylinder, sphere, torus, rectangular and circular pattern, mirror |
| Modify | Press Pull (flat faces), fillet, chamfer, shell, draft (pick edges/faces on the model), combine, move/copy, remove, physical material, appearance |
| Bodies | Multiple bodies with New Body / Join / Cut / Intersect |
| Parameters | User parameters and expressions in any field (`width/2 - edge`, `sqrt(…)`, `sin(…)` …) |
| Construct | Offset planes |
| Inspect | Measure, section analysis, center of mass, properties, bill of materials (CSV) |
| Files | Project save/open (.json), STEP import, STEP and STL export (.zip) |

Edge and face picks for fillet/chamfer/shell are stored as geometric signatures and re-matched after every rebuild, so they survive moderate upstream changes.

## Run it

```bash
npm install
npm run dev        # builds and serves http://localhost:5173/
npm test           # kernel tests in Node (mesh + exact engine)
npm run test:e2e   # full modeling session in headless Chromium
```

`npm run build` writes:

- `dist/index.html` — the whole app in one page; libraries load from jsDelivr
- `dist/engine/occ-gz.wasm` — gzip-compressed OpenCascade (7.3 MB); the page unpacks it in the browser
- `dist/local.html` — the same page wired to `node_modules`, used by the dev server and tests

Deploy `dist/index.html` and `dist/engine/` together on any static host.

## Layout

```
src/
  template.html  page skeleton and import map
  style.css      design tokens (light/dark) and layout
  kernel.js      mesh kernel: profiles, extrude/revolve, CSG booleans, expressions, STL/ZIP writers
  brep.js        exact kernel on OpenCascade (replicad): same feature model + fillet/chamfer/shell, STEP
  icons.js       icon set
  core.js        document model, state, undo/redo, three.js scene, display, mass properties
  solver.js      sketch geometry, constraint solver (minimum-norm Gauss-Newton), DOF analysis, loop detection
  ribbon.js      command registry, workspace tabs, ribbon, menus
  panels.js      browser tree, timeline, dialogs, sketch palette, modals
  interact.js    commands, picking, view cube, navigation, keyboard, engine loader, boot
  sketchui.js    constrained sketch editing: drawing tools, selection, drag, constraints, dimensions
scripts/         build and dev server
tests/           unit (node:test) and end-to-end (Playwright)
docs/            architecture and roadmap
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together.

## Third-party software

| Package | License | Use |
|---|---|---|
| [three.js](https://threejs.org) | MIT | 3D rendering |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg), [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | Mesh booleans (fallback kernel) |
| [replicad](https://replicad.xyz) | MIT | API over OpenCascade |
| [replicad-opencascadejs](https://github.com/sgenoud/replicad) / [OpenCascade](https://dev.opencascade.org) | **LGPL-2.1** | Exact B-rep kernel |

OpenCascade is LGPL-2.1. For a commercial product, keep it as a separately loaded, replaceable library (as now: a standalone `.wasm` file) and include its license and source offer. Get legal advice before shipping.
