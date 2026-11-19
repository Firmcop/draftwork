# Performance: findings and measurements

## Where import time goes

Opening a STEP file runs these stages, in order:

1. **Reading the file** (OpenCascade's STEP reader, in the engine worker). This is the largest single cost and
   cannot be split up; it runs once per file, after which the solids are cached in the engine's own format.
2. **Building the timeline** (fast: the import step only places the solids).
3. **Display meshes** for every body, plus mass properties.
4. **Picking data** (face/edge signatures) for clicking faces and edges.
5. **Geometry check** of each solid (and repair where possible).

Before v0.48 the page waited for stages 1–3 for *all* bodies before showing any, and stage 5 ran inside stage 1.

## What changed (v0.43–v0.48)

| Change | Effect |
|---|---|
| Parts appear right after reading; meshes stream in batches | the model is visible and usable seconds earlier on large files |
| Helper engines on spare cores (browser: cores − 2, Windows app: cores − 1, up to 6) | meshing and picking data run in parallel |
| Display tolerance from the model's size (1/20000 of it) | small parts of a large model are meshed several times faster; exact geometry unchanged |
| Geometry check and picking data after the view is complete | they no longer delay the first view |
| Compiled engine kept between launches | STEP reading about 2× faster from the second launch |
| Parsed solids and inserted designs cached | reopening and re-inserting skip reading/rebuilding |
| Runs of holes and cuts as one boolean | 96 holes: 8.4 s → 0.6 s |

## Measurements (test machine: 2 cores, software graphics)

300-part STEP file (12 MB: plates with holes, bolts, filleted brackets):

| | v0.47 | v0.48 |
|---|---|---|
| First parts on screen | 6.6 s | 4.2–4.4 s |
| All parts shown | 7.3–7.6 s | about 6.9 s |

Reading the file takes about 4.2 s of that on this machine and is now the dominant cost; on a real PC with a graphics
card and more cores the remaining stages shrink further (they run on the helper engines and the GPU).

Fusion 360 is a native program using all cores for every stage, including reading the file; Draftwork's engine is
OpenCascade compiled to WebAssembly, so reading a large STEP file is the stage where the gap remains.
