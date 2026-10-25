// End-to-end: the customer web configurator served by services/generator. The page loads the example product,
// builds the 3D preview in the browser, updates the price at once when options change, refuses an invalid
// quantity, and fetches release files from the server (built once, then from the cache).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../services/generator/src/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-gen-'));
const server = createServer({ productsDir: path.join(root, 'packages/rules/examples'), storageDir: storage });
await new Promise(r => server.listen(5241, r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const total = () => page.textContent('#total');
const seq = () => page.evaluate(() => +document.querySelector('#view').dataset.seq || 0);
const tris = () => page.evaluate(() => +document.querySelector('#view').dataset.triangles || 0);
const waitSeq = async n => { for (let i = 0; i < 240; i++) { if ((await seq()) >= n) return true; await W(250); } return false; };

const t0 = Date.now();
await page.goto('http://localhost:5241/');
await page.waitForSelector('#total', { timeout: 30000 });
check((await page.textContent('#title')) === 'Bearing bracket', 'the page loads the product');
check((await page.locator('.field').count()) === 5, 'the form shows the 5 options');
const price0 = await total();
check(/^KES /.test(price0), 'a price shows straight away (' + price0 + ')');
check(await waitSeq(1) && (await tris()) > 100, `the 3D preview is built in the browser (${await tris()} triangles, ${((Date.now() - t0) / 1000).toFixed(1)} s from load)`);
check(/120|100 × 60 × 35/.test(await page.textContent('#viewStatus')), 'the preview reports the model size (' + (await page.textContent('#viewStatus')) + ')');

// options: price is instant, preview follows
const before = await seq();
await page.click('.chips button:has-text("20 mm")');
const price1 = await total();
check(price1 !== price0, `the price changes at once (${price0} → ${price1})`);
check(/BB-20-M-C/.test(await page.textContent('#partNumber')), 'the part number follows the options');
check(await waitSeq(before + 1) && /120 × 80 × 42/.test(await page.textContent('#viewStatus')), 'the preview rebuilds to 120 × 80 × 42 mm (' + (await page.textContent('#viewStatus')) + ')');
check(/a=/.test(page.url()) && /ShaftSize/.test(decodeURIComponent(page.url())), 'the address holds the configuration, so it can be shared');

// a bad answer
await page.fill('#f-Quantity', '800'); await page.press('#f-Quantity', 'Tab'); await W(200);
check(/production quote/.test(await page.textContent('#messages')) && await page.isDisabled('#generate'), 'too many is refused with the product\'s own message and files are not offered');
await page.fill('#f-Quantity', '0'); await page.press('#f-Quantity', 'Tab'); await W(200);
check(/below the minimum of 1/.test(await page.textContent('.field.bad .err')), 'a quantity below 1 is marked on the field');
await page.fill('#f-Quantity', '12'); await page.press('#f-Quantity', 'Tab'); await W(200);
check(/Volume discount/.test(await page.textContent('#price')) && !(await page.isDisabled('#generate')), '12 off earns the volume discount');

// files
await page.click('#generate');
await page.waitForSelector('#files a', { timeout: 120000 });
const names = await page.$$eval('#files a', as => as.map(a => a.getAttribute('download')));
check(names.includes('BB-20-M-C.step') && names.includes('BB-20-M-C.stl') && names.some(n => /iso\.svg$/.test(n)), 'the server makes STEP, STL and drawing views (' + names.join(', ') + ')');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#files a[download$=".step"]')]);
check(fs.readFileSync(await dl.path(), 'utf8').startsWith('ISO-10303-21;'), 'the STEP file downloads');
await page.fill('#f-Quantity', '20'); await page.press('#f-Quantity', 'Tab'); await W(200);
check((await page.locator('#files a').count()) === 0, 'changing an option clears the old files');
await page.click('#generate');
await page.waitForSelector('#files a', { timeout: 30000 });
check(/from the cache/.test(await page.textContent('#jobStatus')), 'the same geometry in another quantity comes from the cache');

// phone width
await page.setViewportSize({ width: 390, height: 844 }); await W(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, 'no sideways scrolling at phone width (' + overflow + ' px)');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close(); fs.rmSync(storage, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
