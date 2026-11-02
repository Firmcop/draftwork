// Smoke test for the desktop app itself (run with: xvfb-run electron smoke.js, or `npm run smoke` on Windows):
// starts the real main process, waits for the engine and its helpers, imports a STEP file handed over as
// "Open with", and prints the result. Exits 0 when everything worked.
process.env.DRAFTWORK_SMOKE = '1';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const step = process.argv.find(a => /\.(step|stp)$/i.test(a));
require('./main.js');
app.whenReady().then(() => setTimeout(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const js = s => win.webContents.executeJavaScript(s);
  const until = async (expr, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr).catch(() => false)) return true; await new Promise(r => setTimeout(r, 250)); } return false; };
  const out = {};
  const t0 = Date.now();
  out.engine = await until(`/Exact engine/.test(document.querySelector('#engineBadge')?.textContent || '')`);
  out.engineMs = Date.now() - t0;
  out.desktop = await js('JSON.stringify({ helpers: window.DRAFTWORK_DESKTOP?.helpers, cores: window.DRAFTWORK_DESKTOP?.cores, memoryGB: window.DRAFTWORK_DESKTOP?.memoryGB })');
  out.helpersUp = await until(`window.__dw.helpers() >= Math.min(2, window.DRAFTWORK_DESKTOP.helpers)`);
  out.gpu = await js(`(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
  if (step) {
    const t1 = Date.now();
    // the file on the command line is opened by the app itself, like double-clicking it in Windows
    out.imported = await until(`window.__dw.state().features.includes('import:ok') && document.querySelector('#busy').hidden`);
    out.importMs = Date.now() - t1;
    out.bodies = await js('window.__dw.state().bodies.length');
    out.pickData = await js('window.__dw.pickData()');
  }
  console.log('SMOKE', JSON.stringify(out));
  app.exit(out.engine && (!step || out.imported) ? 0 : 1);
}, 500));
