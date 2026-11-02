# Import formats and what you can edit

Every import is classified when it is read. The import step's dialog (double-click it in the timeline) and the
message after the upload say which kind it is and what to do next.

| You import | Classified as | What you can do |
|---|---|---|
| STEP with closed solids | **Editable CAD solids** | Everything: cuts, holes, Create Opening, fillets, shells, booleans, joints, drawings, STEP export. Solids that fail OpenCascade's geometry check are repaired on import when possible (ShapeFix); the count is shown. |
| STEP with solids that still fail the check | **CAD solids, some failing the check** | Same features, but booleans on the failing solids may not work. Re-export them from the source program. |
| STEP with faces only (surface model) | **Surface model** | Trim, cut and split the surfaces; Stitch closes a watertight set into a solid; Thicken gives a surface a wall. No volume. |
| STEP with both | **Solids and surfaces** | Each body as above. Loose faces are kept as surface bodies (earlier versions dropped them). |
| STL/OBJ, closed and manifold | **Watertight mesh** | Mesh tools (remesh, reduce, smooth, plane cut). Mesh › Convert Mesh makes a solid you can cut: it follows the triangles, so it is an approximation, not exact CAD geometry. Over 20,000 triangles: Reduce first. |
| STL/OBJ with open edges | **Open mesh** | Mesh › Repair (fill holes) first. Converting it as it is gives a **surface**, never a solid with made-up volume. |
| STL/OBJ with edges shared by more than two triangles | **Non-manifold mesh** | Viewing and measuring only until Mesh › Repair fixes it. |
| SVG / DXF | Sketch | Exact lines, arcs and circles to extrude, revolve or cut. |
| Images (canvas, decal) | Display only | Reference pictures; not geometry. |

Cuts never apply to meshes directly: a cut that only reaches a mesh body says to convert it first. A cut that
reaches a solid but removes nothing is reported as an error with the fix (usually: flip the direction).

## Cutting openings in imported walls

**Create Opening** (Solid › Create) works on any solid wall, imported or modelled:

1. Click the outside face of the wall.
2. Choose a preset (door 900 × 2100, double door, windows, vent, service penetration Ø150, cable entry Ø50) or enter the size.
3. Position it from the wall's left and bottom edges as seen from outside, or centre it.
4. Optionally add a frame: it replaces the wall in a band around the opening and is its own body.
5. OK. The wall's exact geometry is cut; only that wall is cut, even when the whole container is one solid.

Openings stay in the timeline: double-click to change size or position, or delete them. Posts and rails an
opening runs into are named in a warning and left whole.
