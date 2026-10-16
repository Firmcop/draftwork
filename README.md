# Draftwork

Parametric CAD in the browser. Sketch on planes or faces, build solids with a feature timeline, edit any dimension (or drive it from parameters) and the whole model rebuilds. Exact solid geometry comes from OpenCascade compiled to WebAssembly; export STEP for CAD/CAM or STL for printing.

**Status:** Phase 1 in progress — see [docs/ROADMAP.md](docs/ROADMAP.md).

## What works

| Area | Features |
|---|---|
| Workspace | Workspace switcher, tabbed ribbon (Solid, Surface, Mesh, Sheet Metal, Plastic, Manage, Utilities, contextual Sketch), browser tree, view cube, navigation bar, timeline with history marker, command dialogs with OK/Cancel |
| Sketch | On origin/offset planes or any flat face (including angled ones). Line, 3-point arc, fit-point spline, 2-point and center rectangle, circle, polygon, slot, point, text (built-in outline font), construction geometry. Sketch fillet, offset, trim, extend, mirror, circular pattern, project model edges. Constraint solver with 12 geometric constraints and driving dimensions (expressions allowed), degrees-of-freedom status, drag to reshape. Crossing curves split the sketch into areas; Extrude and Revolve use the filled areas or the ones you click |
| Solid | Extrude, revolve, sweep, pipe, loft, hole (simple/counterbore, flat/drill point), box, cylinder, sphere, torus, coil, rib, web, emboss/deboss, thread (cosmetic or modeled, metric coarse), thicken, boundary fill, rectangular/circular pattern and pattern on path (around construction axes too), mirror (about planes or faces) |
| Modify | Press Pull (flat and curved faces), fillet, chamfer, shell, draft (pick edges/faces on the model), replace face, split face, split body, scale, align, combine, move/copy, remove, physical material, appearance |
| Surface | Extrude, revolve, sweep and loft surfaces from open or closed sketch curves; patch (flat or filling) from a sketch or picked boundary edges; offset, ruled, trim (by plane or surface), untrim, extend, delete face, stitch (closed results become solids), unstitch, reverse normal, thicken |
| Sheet metal | Rules as user parameters (thickness, bend radius, K-factor); base flange from a sketch, edge flanges (any angle, chained on flange edges), contour flange from an open chain with automatic bends; unfold/refold; flat pattern viewer with size, bend lines and DXF export |
| Plastic | Rules as user parameters (wall, draft, clearance); screw boss (draft, blind/through hole, gusset ribs), cantilever snap fit, lip and groove around a shell opening, rest pads (drafted), rib and web |
| Form | Subdivision modelling: box, quadball, cylinder, torus and plane cages smoothed with Catmull-Clark; pick cage points and move or scale them, with X symmetry; result as smooth mesh or solid |
| Mesh | Insert STL (binary/ASCII) and OBJ with units and Y-up options; tessellate bodies; face groups; repair (weld, orient, fill holes); remesh; reduce (quadric edge collapse); smooth (Taubin, keeps sharp edges); plane cut with cap; convert to exact solid (prismatic or faceted); STL export |
| Simulation | Several studies per design. **Static stress**: study materials (E, ν, yield), fixed constraints (per axis), forces, pressures, gravity; von Mises stress, displacement and safety factor plots with exaggerated deformation; reactions. **Modal frequencies**: natural frequencies and mode shapes with or without supports, effective mass fractions, animated modes. **Thermal** (steady state): fixed temperatures, heat sources, convection; temperature and heat-flux plots with a heat balance. Voxel hexahedral mesh with incompatible modes (coarse/medium/fine), multigrid-preconditioned solvers, HTML reports. Validated against beam theory (deflection within 1 %, first frequency within 0.3 %) and 1D conduction (exact) |
| Manufacture | Milling CAM: setups (tool axis from any side, stock box, work origin and offset), tool library, face, 2D pocket (pick floors), 2D contour (outside/inside), drilling (holes found automatically; peck, dwell, through), 3D pocket clearing (z-level roughing with stock to leave), parallel and waterline finishing; toolpath preview, material-removal simulation with gouge check, cycle-time estimate, post processors (Fanuc, Haas, LinuxCNC, GRBL) with a setup sheet |
| Additive | FFF slicer: printer and material presets, layer height, perimeters, top/bottom solid layers, sparse infill, skirt, orientation; layer-by-layer preview, print time and filament estimate, Marlin G-code |
| Nest | Pack parts onto sheets: sheet-metal flat patterns or top-view outlines, quantities, gap, 90° rotations, parts inside holes, several sheets, utilisation, DXF export |
| Bodies | Multiple solid, surface and mesh bodies with New Body / Join / Cut / Intersect |
| Assemble | Components; rigid groups; joints and as-built joints (rigid, revolute, slider, cylindrical, planar) on face centers and round edges; limits; closed loops (linkages); drag parts to move them; drive and animate joints; motion links (gear and rack ratios); contact sets that stop dragged parts where they touch |
| Parameters | User parameters and expressions in any field (`width/2 - edge`, `sqrt(…)`, `sin(…)` …) |
| Construct | Offset plane, plane at angle, midplane, tangent plane, plane through 3 points; axis through cylinder, along edge, through two points, at two planes; point at vertex, circle centre or coordinates |
| Drawing | Drawing workspace with several sheets (tabs): front/top/right/isometric views with exact hidden lines, section views with hatching, detail views (2× by default), centre marks and centrelines on holes, linear/diameter/radius/angle dimensions that follow model changes, with tolerances (±, deviation, limits, basic), precision and text overrides; balloons tied to the parts list, notes with leaders, parts list, title block (sheet n / N); export as a multi-page PDF plus SVG and DXF per sheet |
| Inspect | Measure, section analysis, center of mass, properties, bill of materials (CSV), interference, zebra stripes, curvature comb |
| Insert | SVG and DXF as sketches (exact lines, arcs, circles; curves as splines), canvas and decal images, derive bodies from another design |
| Configure | Configuration table (parameter values and suppressed features per variant), rules that suppress features by condition; `if()` and comparisons in expressions |
| Select | Window and crossing selection with hide/isolate/remove, selection filters |
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
  enginehost.js  message interface to the exact kernel (runs in a Web Worker)
  engineclient.js page side: starts the worker (or runs inline), body proxies, picking data
  assembly.js    components, joint solving, joint dialog and animation
  drawing.js     drawing workspace: views, dimensions, title block, PDF writer
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
