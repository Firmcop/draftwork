// End-to-end: Mesh tab — insert STL, remesh, reduce, smooth, face groups, plane cut, convert, tessellate.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5207, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const scr = (x, y, z) => page.evaluate(([x, y, z]) => window.__dw.screen(x, y, z), [x, y, z]);
const clickAt = async p => { await page.mouse.move(p.x, p.y); await W(80); await page.mouse.click(p.x, p.y); await W(500); };
const state = () => page.evaluate(() => window.__dw.state());
const props = () => page.evaluate(() => window.__dw.props());
const docNow = () => page.evaluate(() => window.__dw.doc());
const menu = async (group, label) => { await page.click('.rtab:text-is("MESH")'); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(600); };
const ok = async () => { await page.click('.dialog .btn.ok'); await W(1200); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
const meshInfo = () => page.evaluate(() => [...window.__dw.meshes()]);
// binary STL of a 20 mm cube
const v = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]];
const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
const buf = Buffer.alloc(84 + F.length * 50); buf.writeUInt32LE(F.length, 80);
F.forEach((t, i) => t.forEach((vi, k) => v[vi].forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
await page.click('#abFile'); await page.click('text=New design'); await W(1000);
const [fc] = await Promise.all([page.waitForEvent('filechooser'), menu('CREATE', 'Insert Mesh')]);
await fc.setFiles({ name: 'cube.stl', mimeType: 'model/stl', buffer: buf }); await W(2500);
let m = await meshInfo();
check(m.length === 1 && m[0].tris === 12 && m[0].closed && Math.abs(m[0].volume - 8000) < 1e-3, 'binary STL inserted: closed 12-triangle cube of 8,000 mm³ ' + JSON.stringify(m));
await ok();
await menu('MODIFY', 'Remesh'); await page.fill('#dx-edge', '3'); await W(2500); await ok();
m = await meshInfo(); const n1 = m[0].tris;
check(n1 > 300 && m[0].closed && Math.abs(m[0].volume - 8000) < 5, 'remesh to ~3 mm edges (' + n1 + ' triangles)');
await menu('MODIFY', 'Reduce'); await page.fill('#dx-percent', '20'); await W(2500); await ok();
m = await meshInfo();
check(m[0].tris <= n1 * 0.22 && m[0].closed, 'reduce to 20% (' + m[0].tris + ')');
await menu('MODIFY', 'Smooth'); await W(2000); await ok();
await menu('PREPARE', 'Generate Face Groups'); await W(2000); await ok();
m = await meshInfo();
check(m[0].groups >= 6, 'face groups found the cube sides (' + m[0].groups + ')');
await page.click('#vcHome'); await W(600);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/mesh.png' });
await menu('MODIFY', 'Convert Mesh'); await W(3000); await ok();
let p = await props(), st = await state();
check(st.features.at(-1) === 'meshconvert:ok' && p.some(b => !b.surface && b.volume > 6000), 'convert mesh makes a solid ' + JSON.stringify(st.features.slice(-2)) + JSON.stringify(p));
// tessellate a box
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'T', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [{ id: 'b', type: 'cylinder', name: 'C', plane: 'XY', offset: 0, cx: 0, cy: 0, diameter: 20, h: 10, op: 'new' }] }));
await W(2000);
await menu('CREATE', 'Tessellate'); await W(2000); await ok();
m = await meshInfo();
check(m.length === 1 && m[0].closed && Math.abs(m[0].volume - Math.PI * 100 * 10) < 20, 'tessellate turns the cylinder into a closed mesh (' + m[0]?.tris + ' tris, ' + m[0]?.volume + ')');

// ---- Create Form: pull the top of a subdivision box up ----
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'F', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, features: [] })); await W(800);
await page.click('.rtab:text-is("SOLID")'); await W(150); await page.click('.rlabel:has-text("CREATE")'); await W(200); await page.locator('.menu .mi', { has: page.locator('text="Create Form"') }).first().click(); await W(400);
if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw');
await page.click('.node .nlab:text-is("XY")'); await W(2500); await page.click('#vcHome'); await W(800);
m = await meshInfo(); const fv0 = m[0]?.volume;
const top = await page.evaluate(() => window.__dw.screen(0, 0, 40)); await page.mouse.click(top.x, top.y); await W(400);
await page.click('#fm-move'); await W(2500);
m = await meshInfo();
check(fv0 > 20000 && m[0].closed && m[0].volume > fv0 + 1000, 'create form: smooth box, pulling the top cage point up 5 mm adds volume (' + Math.round(fv0) + ' → ' + Math.round(m[0].volume) + ')');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/form.png' });
await page.click('.dialog .btn.ok'); await W(500);

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
