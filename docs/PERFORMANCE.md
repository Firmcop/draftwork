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

## v0.49: STEP import benchmark (before → after)

Procedure: `npm run bench:import` (`tests/bench/make-fixtures.mjs`, then `tests/bench/bench-import.mjs --trials 3`).
The built app in Chromium (software graphics, 2 cores, no helper engines); same machine, build mode and procedure
before and after. Medians of 3 trials (ranges in `tests/bench` output); ms from file selection (reopen: from page
start). *First frame*: a frame drawn with the model. *Edit-ready*: every part drawn and selectable (picking data in),
so a wall can be clicked for a sketch and cut.

**container20.step** (Draftwork's 20 ft container, 19 solids, 1.8 MB):

| Workflow | First frame | Edit-ready |
|---|---|---|
| Cold upload (fresh profile, nothing cached) | 1781 → 1948 (ranges overlap: unchanged) | 2576 → 2590 (unchanged) |
| Same file again (new design) | 581 → 328 | 1094 → 751 |
| Reopen the project | 1374 → 1403 (unchanged) | 1569 → 1599 (unchanged) |
| Insert into a populated project (19 parts) | 649 → 348 | 1936 → 687 |

**parts300.step** (300 parts, 12 MB):

| Workflow | First frame | Edit-ready |
|---|---|---|
| Cold upload | 4389 → 4706 (ranges overlap) | 9866 → 8773 |
| Same file again | 2583 → 539 | 7468 → 4464 |
| Reopen | 1491 → 1404 | 5483 → 5054 |
| Insert into a populated project | 2514 → 352 | 9192 → 6035 |

Cold phases (after; engine worker): parse 1079 ms, transfer to exact B-Rep 2512 ms, serialization 152 ms; then
meshes 2.5 s and picking data 2.0 s (300 parts). For the container: parse 375 ms, transfer 616 ms.

### What the measurements showed, and the changes

1. **Re-reading files already read** (repeat import, insert of a file used before): the cache was keyed by a random
   per-import id, so every upload parsed the STEP again (2.2 s for 300 parts even warm). Now keyed by the file's
   SHA-256, length and importer/kernel version (`step:` payloads); the checked/repaired solids are cached too, so the
   geometry check is not repeated.
2. **Inserting rebuilt the whole project**: a new import cleared the engine's timeline cache, so every existing part
   was rebuilt and re-meshed (19 → 38 meshes for the container insert). Now only steps from the import that changed
   are rebuilt.
3. **Picking data one body at a time, behind the geometry check**: 300 engine round trips after the meshes, queued
   behind the check (1.0 s for the container, 3.6 s for 300 parts between "all drawn" and "selectable"). Now in
   batches of 48 right after the meshes; the check runs after the model is selectable.

Not changed: the cold STEP parse and B-Rep transfer (OpenCascade's reader, in the worker). It is now the largest
cold cost; replacing it would mean a different kernel, which the measurements do not justify yet.
