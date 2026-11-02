# Draftwork for Windows

The Draftwork app in its own window, with the parts of a desktop program the browser version can't have:

- **All processor cores:** the geometry engine runs in background workers, one per spare core (up to 6). After a
  rebuild or an upload, bodies are meshed and their picking data prepared on all of them at once.
- **Graphics card always on:** the browser's GPU blocklist is ignored, so the 3D view never falls back to
  software drawing.
- **More memory** for large models (up to 8 GB for the app's working memory).
- **Compiled engine kept between launches**, and everything works offline.
- **Open with Draftwork:** double-click a `.step`, `.stp`, `.stl` or `.obj` file, or drop it on the icon.

The geometry engine is the same OpenCascade engine as in the browser (compiled to WebAssembly), so results are
identical; the speed-up comes from using several cores, the GPU and the kept compiled code.

## Install

Download `Draftwork-Setup-<version>.exe` from the repository's **Releases** page (or the latest run of the
*Desktop app (Windows)* workflow, under Artifacts) and run it. Windows SmartScreen may warn because the installer
is not code-signed: choose *More info → Run anyway*.

## Build it yourself

```
npm ci && npm run build          # in the repository root: builds dist/site
cd apps/desktop && npm install
npm start                        # run from source
npm run dist:win                 # Windows installer in apps/desktop/release (on Windows)
```
