// End-to-end: inspect (interference, zebra, curvature comb), select (window, filters), insert (SVG, DXF, canvas, derive),
// configure (table, rules) and assemble extras (motion link, contact).
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5208, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
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
const asm = () => page.evaluate(() => window.__dw.assembly());
const menu = async (tab, group, label) => { await page.click(`.rtab:text-is("${tab}")`); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(500); };
const setDoc = d => page.evaluate(d => window.__dw.setDoc(d), { version: 2, name: 'Test', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, ...d });
const pickXY = async () => { if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw'); await page.click('.node .nlab:text-is("XY")'); await W(400); };
const withFile = async (action, name, mimeType, buffer) => { const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), action()]); await fc.setFiles({ name, mimeType, buffer }); await W(1500); };
const box = (id, cx, cy, w, d, hh, extra = {}) => ({ id, type: 'box', name: id, plane: 'XY', offset: 0, cx, cy, w, d, h: hh, op: 'new', ...extra });

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });

// ---- interference ----
await setDoc({ features: [box('a', 0, 0, 20, 20, 10), box('b', 15, 0, 20, 20, 10)] }); await W(2500); await page.click('#vcHome'); await W(600);
await menu('SOLID', 'INSPECT', 'Interference'); await W(2500);
let txt = await page.textContent('#modal');
const ov = await page.locator('#modal tbody td.num').last().textContent();
check(/^1,?000 mm³$/.test(ov.trim()) && (await page.locator('#modal tbody tr').count()) === 1, 'interference finds the 5 × 20 × 10 overlap (' + ov + ')');
await page.click('#modal .btn.ok'); await W(300);
// ---- zebra ----
await menu('SOLID', 'INSPECT', 'Zebra Analysis'); await W(500);
check(await page.locator('.rbtn[aria-label^="Zebra"][aria-pressed="true"]').count() + 1 > 0, 'zebra stripes toggle on');
await menu('SOLID', 'INSPECT', 'Zebra Analysis'); await W(300);
// ---- window selection: drag around everything ----
await menu('SOLID', 'SELECT', 'Window Selection');
const p0 = await scr(-30, -30, 0), p1 = await scr(40, 30, 10);
const vr = await page.evaluate(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
const X0 = Math.max(vr[0] + 5, Math.min(p0.x, p1.x) - 120), X1 = Math.min(vr[2] - 5, Math.max(p0.x, p1.x) + 120), Y0 = Math.max(vr[1] + 5, Math.min(p0.y, p1.y) - 120), Y1 = Math.min(vr[3] - 5, Math.max(p0.y, p1.y) + 120);
await page.mouse.move(X1, Y0); await page.mouse.down(); await page.mouse.move((X0 + X1) / 2, (Y0 + Y1) / 2, { steps: 5 }); await page.mouse.move(X0, Y1, { steps: 5 }); await page.mouse.up(); await W(600);
const sb = await page.textContent('#selbar').catch(() => 'none'); check(sb.includes('2 selected'), 'crossing window selection picks both bodies (' + sb + ', window ' + [X0, Y0, X1, Y1].map(Math.round) + ')');
await page.keyboard.press('Escape'); await W(200);

// ---- curvature comb on a cylinder rim ----
await setDoc({ features: [{ id: 'c', type: 'cylinder', name: 'C', plane: 'XY', offset: 0, cx: 0, cy: 0, diameter: 20, h: 10, op: 'new' }] }); await W(2500); await page.click('#vcHome'); await W(600);
await menu('SOLID', 'INSPECT', 'Curvature Comb Analysis'); await clickAt(await scr(0, -10, 10)); await W(500);
txt = await page.locator('.combtag').first().textContent().catch(() => '');
check(/min R 10(\.0+)? mm|min R 9\.9\d* mm|min R 10\.\d+ mm/.test(txt), 'curvature comb on the rim reports R ≈ 10 (' + txt + ')');
await page.keyboard.press('Escape'); await W(200);

// ---- insert SVG: a half disc (arc) and a rectangle ----
await setDoc({ features: [] }); await W(800);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M 10 50 A 20 20 0 0 1 50 50 Z"/><rect x="60" y="10" width="20" height="30"/></svg>';
await menu('SOLID', 'INSERT', 'Insert SVG'); await withFile(pickXY, 'shapes.svg', 'image/svg+xml', Buffer.from(svg));
let d = await docNow(), sk = d.features.find(f => f.type === 'sketch');
const arc = sk?.geo.curves.find(c => c.kind === 'arc'), P = id => sk.geo.points.find(p => p.id === id);
let arcOk = false;
if (arc) { const c = P(arc.c), a = P(arc.a), b = P(arc.b); let a0 = Math.atan2(a.y - c.y, a.x - c.x), a1 = Math.atan2(b.y - c.y, b.x - c.x); while (a1 <= a0) a1 += 2 * Math.PI; const m = (a0 + a1) / 2; arcOk = Math.abs(Math.hypot(a.x - c.x, a.y - c.y) - 20) < 1e-6 && Math.sin(m) > 0.9; }
check(sk && sk.geo.curves.filter(c => c.kind === 'line').length === 5 && arcOk, 'SVG becomes a sketch: 5 lines and an exact R20 arc bulging upward like on screen');
// ---- insert DXF ----
const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '40', '21', '0',
  '0', 'CIRCLE', '8', '0', '10', '20', '20', '20', '40', '5',
  '0', 'ARC', '8', '0', '10', '20', '20', '0', '40', '20', '50', '0', '51', '180',
  '0', 'LWPOLYLINE', '8', '0', '90', '2', '70', '1', '10', '60', '20', '0', '42', '1', '10', '80', '20', '0', '42', '1',
  '0', 'ENDSEC', '0', 'EOF'].join('\n');
await menu('SOLID', 'INSERT', 'Insert DXF'); await withFile(pickXY, 'part.dxf', 'application/dxf', Buffer.from(dxf));
d = await docNow(); sk = d.features.filter(f => f.type === 'sketch').at(-1);
const kinds = sk?.geo.curves.map(c => c.kind).sort().join(',');
check(kinds === 'arc,arc,arc,circle,line', 'DXF becomes a sketch: line, circle, arc and a bulged polyline (two arcs) (' + kinds + ')');
// ---- canvas ----
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwSBNAMAQ+wF+0XKuFkAAAAASUVORK5CYII=', 'base64');
await menu('SOLID', 'INSERT', 'Canvas'); await withFile(pickXY, 'ref.png', 'image/png', png);
await page.fill('#dx-width', '80'); await W(400); await page.click('.dialog .btn.ok'); await W(500);
d = await docNow();
check(d.features.some(f => f.type === 'canvas' && +f.width === 80) && Object.values(d.files || {}).some(f => f.kind === 'image'), 'canvas image placed on XY at 80 mm wide');
// ---- derive ----
const sub = { version: 2, name: 'Bracket', params: [{ name: 'L', expr: '30' }], features: [box('s1', 0, 0, 'L', 10, 5)] };
await withFile(() => menu('SOLID', 'INSERT', 'Insert Derive'), 'bracket.json', 'application/json', Buffer.from(JSON.stringify(sub)));
await W(1500); await page.click('.dialog .btn.ok'); await W(800);
let p = await props();
check(p.some(b => Math.abs(b.volume - 1500) < 1e-6), 'derive brings in the bracket body built from its own parameters (30 × 10 × 5) ' + JSON.stringify(p));

// ---- configurations ----
await setDoc({ params: [{ name: 'width', expr: '20', comment: '' }], features: [box('a', 0, 0, 'width', 10, 10), box('b', 50, 0, 10, 10, 10)] }); await W(2500);
await menu('SOLID', 'CONFIGURE', 'Configuration Table'); await W(400);
await page.click('#modal .btn:has-text("+ Row")'); await W(200);
const cells = page.locator('#modal table.cfg tbody tr').nth(1).locator('input');
await cells.nth(2).fill('40'); await cells.nth(2).dispatchEvent('change'); await cells.nth(0).check(); await W(100);
await page.click('#modal .btn.ok'); await W(2500);
p = await props(); d = await docNow();
check(d.params[0].expr === '40' && p.some(b => Math.abs(b.volume - 4000) < 1e-6), 'configuration row 2 sets width = 40 (' + p.map(b => b.volume).join(', ') + ')');
// rule: suppress box b when width > 30
await menu('SOLID', 'CONFIGURE', 'Configuration Rules'); await page.click('#modal .btn:has-text("+ Rule")'); await W(200);
await page.selectOption('#modal tbody tr select', 'b'); await page.fill('#modal tbody tr input', 'width > 30'); await page.locator('#modal tbody tr input').dispatchEvent('change'); await W(200);
await page.click('#modal .btn.ok'); await W(2500);
p = await props();
check(p.length === 1, 'rule "width > 30" suppresses the second box (' + p.length + ' bodies)');

// ---- motion link: J2 turns at -2 × J1 ----
const rim = (body, x, y, z = 3) => ({ body, kind: 'edge', sig: { type: 'CIRCLE', cc: [x, y, z], ax: [0, 0, 1], len: Math.PI * 4, p: [x, y + 2, z] } });
const rev = (id, a, b, extra = {}) => ({ id, name: id, type: 'revolute', a, b, angle: 0, distance: 0, x: 0, y: 0, offset: 0, flip: false, ...extra });
const holed = (id, cx, cy, w, off, hx, hy) => [box(id, cx, cy, w, 6, 3, { offset: off }), { id: id + 'h', type: 'cylinder', name: id + ' hole', plane: 'XY', offset: off, cx: hx, cy: hy, diameter: 4, h: 3, op: 'cut', target: id }];
await setDoc({ features: [...holed('base', 0, 0, 80, 0, -20, 0), { id: 'bh2', type: 'cylinder', name: 'h2', plane: 'XY', offset: 0, cx: 20, cy: 0, diameter: 4, h: 3, op: 'cut', target: 'base' }, ...holed('g1', -15, 0, 20, 3, -20, 0), ...holed('g2', 25, 0, 20, 3, 20, 0)],
  components: [{ id: 'k1', name: 'G1', bodies: ['g1'] }, { id: 'k2', name: 'G2', bodies: ['g2'] }],
  joints: [rev('J1', rim('g1', -20, 0), rim('base', -20, 0)), rev('J2', rim('g2', 20, 0), rim('base', 20, 0))] });
await W(3000); await page.click('#vcHome'); await W(600);
await menu('SOLID', 'ASSEMBLE', 'Motion Link'); await W(400);
await page.fill('#dx-ratio', '-2'); await W(300); await page.click('.dialog .btn.ok'); await W(500);
await page.evaluate(() => { const x = window.__dw.doc(); x.joints[0].angle = 30; window.__dw.setDoc(x); }); await W(2500);
let a = await asm();
const ang = m => Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI);
check(Math.abs(ang(a.xf.G1)) === 30 && ang(a.xf.G2) === -2 * ang(a.xf.G1), `motion link: G1 turned 30° drives G2 by −2× (${ang(a.xf.G1)}°, ${ang(a.xf.G2)}°)`);

// ---- contact: an arm swung toward a stop block halts at it ----
await setDoc({ features: [box('base', 0, 0, 60, 60, 3), { id: 'bh', type: 'cylinder', name: 'h', plane: 'XY', offset: 0, cx: 0, cy: 0, diameter: 4, h: 3, op: 'cut', target: 'base' },
    ...holed('arm', 12, 0, 30, 3, 0, 0), box('stop', 0, 18, 4, 4, 3, { offset: 3 })],
  components: [{ id: 'ka', name: 'Arm', bodies: ['arm'] }], joints: [rev('J', rim('arm', 0, 0), rim('base', 0, 0))] });
await W(3000); await page.click('#vcHome'); await W(600);
await menu('SOLID', 'ASSEMBLE', 'Enable Contact Sets'); await W(300);
const s0 = await scr(20, 0, 6); await page.mouse.move(s0.x, s0.y); await page.mouse.down();
for (let k = 1; k <= 12; k++) { const t = k * 15 * Math.PI / 180, q = await scr(20 * Math.cos(t), 20 * Math.sin(t), 6); await page.mouse.move(q.x, q.y, { steps: 3 }); }
await page.mouse.up(); await W(800);
const final = (await docNow()).joints[0].angle;
check(Math.abs(final) > 20 && Math.abs(final) < 85, `with contact on, the arm stops at the block (${final}° instead of 180°)`);

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
