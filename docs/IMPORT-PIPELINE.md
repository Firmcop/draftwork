# STEP import pipeline

Draftwork is a single-page browser app (also packaged as the Windows app). There is no server step: files never
leave the computer. Geometry work runs in the engine worker (OpenCascade compiled to WebAssembly); the page (UI
thread) handles files, the scene and storage.

## Entry points

| Path | Entry | Shared code |
|---|---|---|
| Upload (Insert › STEP, `#stepInput`) | `importStepFile(file)` (interact.js) | everything below |
| Open a local file: drag and drop onto the window, Windows "Open with Draftwork" | `openAnyFile` (opening.js) → `importStepFile` | same as upload |
| Insert into an existing (populated) project | `importStepFile` adds an `import` step to the open design | same as upload |
| Reopen a saved project / tab | `start()` → `loadStored` / `restoreSession` → `ensureImports()` (interact.js) | cache lookup, then the rebuild below |
| Open a project file (.json) | `openProjectFile` → `openInTab` → `ensureImports()` | as reopen |

## Stages, and where they run

| Stage | Where | Code |
|---|---|---|
| Read the file (`FileReader.readAsText`) | UI thread (async read; decoding to a string) | `importStepFile` |
| Content key (SHA-256 of the text) and cache lookup | UI thread (`crypto.subtle`, IndexedDB) | `stepContentKey`, `cachedPayload` |
| Send to the engine (`postMessage`, string copy) | UI → worker | `brepImportSTEP` (engineclient.js) |
| File into the engine's file system | worker | `brepImportSTEP` (brep.js) — phase `fsWrite` |
| STEP parsing (`STEPControl_Reader.ReadFile`) | worker | phase `parse` |
| Transfer into exact B-Rep bodies (`TransferRoots`, includes OpenCascade's shape processing) | worker | phase `transfer` |
| Loose faces → surface bodies | worker | phase `scan` |
| Serialise the solids for the cache (BREP text) | worker | phase `serialize` |
| Store the solids (IndexedDB `payloads`, key `step:<sha256>:<length>:<importer>`) | UI thread (structured clone), then IndexedDB | `payloadSave` |
| Rebuild the timeline (import step places the solids) | worker | `regen` (enginehost.js) |
| Tessellation (display meshes) + mass properties | worker; for more than 24 new bodies streamed in batches, also on helper engines | `meshPayload`, `streamMeshes` |
| Mesh transfer (typed arrays, transferred, no copy) and decoding | worker → UI | `ingestMesh` |
| Scene insertion, first rendered frame | UI thread (three.js, WebGL) | `updateScene`, `fillShownMeshes` |
| Picking data (face/edge signatures for selecting faces, sketching on them, cutting) | worker (or helpers, with the mesh) | `sigs` op, `pumpSigs` |
| Geometry check and repair (`BRepCheck_Analyzer`, `ShapeFix_Solid`) | worker, after the view | `checkimport` op |
| Save the project (lean document in localStorage; the STEP text in IndexedDB once) | UI thread | `persist`, `leanDoc` |

Reopening skips reading and parsing: the solids come from the content cache (`importbrep`), then the rebuild,
tessellation and picking data run as above.

## Measuring

`window.__dw.importTrace()` returns the timeline of the last import (ms from file selection; for a reopen, from page
start): `fileRead`, `engineImport`, `regenDone`, `firstFrame` (a frame drawn with the model), `meshesIn` (every part
drawn), `editReady` (every part selectable), `checked`, plus engine phases, triangles and mesh size.

```
node tests/bench/make-fixtures.mjs          # writes tests/bench/fixtures/container20.step and parts300.step
node tests/bench/bench-import.mjs --trials 3 # cold, repeat, reopen, insert into a populated project
```
