// End-to-end: the installable desktop build (dist/site) — manifest, icons, service worker and offline app shell.
// The CDN is not reachable in CI sandboxes, so jsdelivr requests are answered from node_modules.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), site = path.join(root, 'dist/site');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wasm': 'application/wasm' };
const PORT = 5231;
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(site, u);
  if (!f.startsWith(site) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(PORT);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
await ctx.route(/cdn\.jsdelivr\.net\/npm\//, r => {
  const f = path.join(root, 'node_modules', new URL(r.request().url()).pathname.replace(/^\/npm\//, '').replace(/^(@?[^@/]+(?:\/[^@/]+)?)@[^/]+/, '$1'));
  if (!fs.existsSync(f)) return r.fulfill({ status: 404 });
  r.fulfill({ status: 200, headers: { 'content-type': types[path.extname(f)] || 'text/javascript', 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
});
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
check(/^<!doctype html>/i.test(html) && /rel="manifest"/.test(html), 'site page is a full document that links the manifest');
const man = JSON.parse(fs.readFileSync(path.join(site, 'manifest.webmanifest'), 'utf8'));
check(man.name === 'Draftwork' && man.display === 'standalone' && man.icons.some(i => i.sizes === '512x512') && man.icons.some(i => i.purpose === 'maskable'), 'manifest: standalone window, 192/512 and maskable icons');
for (const i of man.icons) check(fs.existsSync(path.join(site, i.src)), 'icon present: ' + i.src);
check(fs.readFileSync(path.join(site, 'sw.js'), 'utf8').includes(`draftwork-${pkg.version}`), 'service worker cache is versioned with the release');

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 180000 });
check(true, 'app boots with the exact engine from the site build');
check(await page.evaluate(() => window.DRAFTWORK_VERSION) === pkg.version, 'page knows its version: ' + pkg.version);
check(await page.title() === 'Draftwork Modeler', 'window title');
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 30000 });
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { active: !!r.active, scope: r.scope }; });
check(sw.active && sw.scope.endsWith('/'), 'service worker installed and active: ' + sw.scope);
const cached = await page.evaluate(async () => { const ks = await caches.keys(), c = await caches.open(ks.find(k => k.startsWith('draftwork-'))); return (await c.keys()).map(r => new URL(r.url).pathname); });
check(cached.includes('/engine/occ-gz.wasm') && cached.includes('/index.html'), 'app shell and engine cached for offline use: ' + cached.length + ' entries');
await page.click('#abFile'); await page.waitForTimeout(150); await page.click('.menu .mi:has-text("Install Desktop App")'); await page.waitForTimeout(400);
check(/install icon/.test(await page.textContent('#modal')), 'File → Install Desktop App explains how to install');
await page.click('#modal .btn.ok');
// the shell opens with the network down
await page.reload(); await page.waitForTimeout(1500);
await ctx.setOffline(true);
const res = await page.goto(`http://localhost:${PORT}/`).catch(e => null);
check(res && res.ok() && /Draftwork/.test(await page.content()), 'app page opens offline from the cache');
await ctx.setOffline(false);
check(!errors.filter(e => !/Failed to fetch|NetworkError|net::/.test(e)).length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall PWA checks passed');
process.exit(failed ? 1 : 0);
