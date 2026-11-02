// Draftwork for Windows: one window with the Draftwork app. The geometry engine runs in background workers spread
// over the processor cores; graphics use the GPU even where the browser's blocklist would turn it off.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startServer } = require('./server');

app.commandLine.appendSwitch('ignore-gpu-blocklist');            // use the graphics card for the 3D view
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');   // room for large models

const SITE = app.isPackaged ? path.join(process.resourcesPath, 'site') : path.join(__dirname, '../../dist/site');
let win = null, pending = [];
const fileArgs = argv => argv.slice(1).filter(a => /\.(step|stp|stl|obj|json)$/i.test(a) && fs.existsSync(a));

function sendFile(file) {
  if (!win) { pending.push(file); return; }
  try { const data = fs.readFileSync(file); win.webContents.send('open-file', { name: path.basename(file), data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }); }
  catch (e) { dialog.showErrorBox('Draftwork', 'Could not open ' + file + ': ' + e.message); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } fileArgs(argv).forEach(sendFile); });
  app.whenReady().then(async () => {
    if (!fs.existsSync(path.join(SITE, 'index.html'))) { dialog.showErrorBox('Draftwork', 'The app files are missing (' + SITE + '). Run "npm run build" in the repository first.'); app.quit(); return; }
    const srv = await startServer(SITE).catch(e => { dialog.showErrorBox('Draftwork', 'Could not start: ' + e.message); app.quit(); });
    if (!srv) return;
    const port = srv.address().port;
    Menu.setApplicationMenu(null);   // the app has its own menus
    win = new BrowserWindow({
      width: 1600, height: 960, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#F4F5F6', title: 'Draftwork',
      ...(fs.existsSync(path.join(SITE, 'icon-512.png')) ? { icon: path.join(SITE, 'icon-512.png') } : {}),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) { shell.openExternal(url); return { action: 'deny' }; } return { action: 'allow' }; });
    win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools(); });
    ipcMain.on('desktop-info', e => { e.returnValue = { cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), version: app.getVersion() }; });
    ipcMain.on('page-ready', () => { const p = pending; pending = []; p.forEach(sendFile); });
    pending.push(...fileArgs(process.argv));
    await win.loadURL(`http://127.0.0.1:${port}/`);
  });
  app.on('window-all-closed', () => app.quit());
}
