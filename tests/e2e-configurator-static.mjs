// End-to-end: the web configurator as a static site (how GitHub Pages hosts it). It is built with
// scripts/build-configurator.mjs and served under a sub-path by a plain file server with no API, so the page must
// load its product from data/, build the preview and make the release files in the browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-static-'));
execFileSync(process.execPath, [path.join(root, 'scripts/build-configurator.mjs'), '--out', path.join(site, 'configurator')], { stdio: 'inherit' });

// a plain static host under /draftwork/, like https://<owner>.github.io/draftwork/
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const requests = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  requests.push(url);
  if (!url.startsWith('/draftwork/')) { res.writeHead(404); return res.end(); }
  let file = path.join(site, url.slice('/draftwork/'.length));
  if (file.endsWith(path.sep) || url.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(5251);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const seq = () => page.evaluate(() => +document.querySelector('#view').dataset.seq || 0);
const waitSeq = async n => { for (let i = 0; i < 240; i++) { if ((await seq()) >= n) return true; await W(250); } return false; };

await page.goto('http://localhost:5251/draftwork/configurator/');
await page.waitForSelector('#total', { timeout: 30000 });
check((await page.textContent('#title')) === 'Bearing bracket', 'the static page loads its product from data/');
check(await waitSeq(1) && /100 × 60 × 35/.test(await page.textContent('#viewStatus')), 'the preview builds with the gzipped engine unpacked in the browser (' + (await page.textContent('#viewStatus')) + ')');
const before = await seq(), price0 = await page.textContent('#total');
await page.click('.chips button:has-text("Steel S275")');
check((await page.textContent('#total')) !== price0, 'the price changes at once');
await page.click('.chips button:has-text("15 mm")');
const waitView = async re => { for (let i = 0; i < 240; i++) { if (re.test(await page.textContent('#viewStatus'))) return true; await W(250); } return false; };
check((await seq()) >= before && await waitView(/110 × 70 × 38/), 'the preview follows the options (' + (await page.textContent('#viewStatus')) + ')');
check(/[?&]product=bearing-bracket/.test(page.url()) && page.url().includes('/draftwork/configurator/'), 'the shareable address stays under the site path');

await page.click('#generate');
await page.waitForSelector('#files a', { timeout: 120000 });
const names = await page.$$eval('#files a', as => as.map(a => a.getAttribute('download')));
check(names.includes('BB-15-M-C.step') && names.includes('BB-15-M-C.stl') && names.filter(n => n.endsWith('.svg')).length === 4, 'the browser makes STEP, STL and 4 drawing views (' + names.join(', ') + ')');
check(/made in this browser/.test(await page.textContent('#jobStatus')), 'the status says the files were made in the browser');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#files a[download$=".step"]')]);
check(fs.readFileSync(await dl.path(), 'utf8').startsWith('ISO-10303-21;'), 'the STEP file downloads');
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#files a[download$="-front.svg"]')]);
check(/^<svg [^>]*viewBox=/.test(fs.readFileSync(await dl2.path(), 'utf8')), 'a drawing view downloads as SVG');
check(!requests.some(u => u.includes('/api/')), 'no server API is needed');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
