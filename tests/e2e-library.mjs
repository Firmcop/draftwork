// End-to-end: design types, tabs, the design library (projects, folders, versions, part numbers), Save / Save As / Save Copy As.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PORT = 5214, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const tabs = () => page.evaluate(() => window.__dw.tabs());
const lib = () => page.evaluate(() => window.__dw.lib());
const fileMenu = async label => { await page.click('#abFile'); await W(150); await page.click(`.menu .mi:has-text("${label}")`); await W(700); };
const box = async (w) => { await page.click('.rbtn[aria-label^="Box"]'); await W(400); if (!(await page.locator('.node .nlab:text-is("XY")').isVisible())) await page.click('.node:has-text("Origin") .tw'); await W(200); await page.click('.node .nlab:text-is("XY")'); await W(1200); if (w) { await page.fill('#dx-w', String(w)).catch(() => {}); await W(300); } await page.click('.dialog .btn.ok'); await W(1200); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });
await W(800);
let t = await tabs();
check(t.list.length === 1 && t.list[0].type === 'hybrid' && await page.isVisible('#docTabs .dtab.on'), 'one design tab on start (hybrid) ' + JSON.stringify(t.list.map(x => x.name)));

// New Design dialog: Part (Standard)
await fileMenu('New Part, Assembly or Hybrid'); await page.click('.studycard[data-type="part"]'); await W(1200);
t = await tabs();
check(t.list.length === 2 && t.active === 1 && t.list[1].type === 'part', 'New Design › Part opens a second tab ' + JSON.stringify(t));
check(/Part · Standard/.test(await page.textContent('#btree')), 'browser shows the design type');
await box();
t = await tabs();
check(t.list[1].features === 1 && t.list[1].dirty, 'box added; tab marked edited');
// part designs refuse components
const blocked = await page.evaluate(() => { window.__dw.run('newcomp'); return document.querySelector('#toast').textContent; });
check(/single component/.test(blocked), 'New Component is refused in a part design: ' + blocked);

// first save: name, new part number, new folder in the default project
await page.click('#abSave'); await W(600);
check(await page.isVisible('#save-name') && await page.isVisible('#save-loc'), 'first Save asks for name and location');
await page.fill('#save-name', 'Bracket');
await page.click('#save-newfolder'); await W(200); await page.fill('.inlineask-input', 'Brackets'); await page.keyboard.press('Enter'); await W(500);
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/lib-save.png' });
await page.click('#save-ok'); await W(1200);
let L = await lib(); t = await tabs();
check(L.designs.length === 1 && L.designs[0].name === 'Bracket' && L.designs[0].version === 1 && /^DW-\d{5}$/.test(L.designs[0].pn) && L.projects[0].folders.includes('Brackets'), 'saved as v1 with a part number in a new folder ' + JSON.stringify(L));
check(t.list[1].name === 'Bracket' && !t.list[1].dirty && t.list[1].version === 1 && /v1/.test(await page.textContent('#docTabs .dtab.on')), 'tab shows the saved name and v1');
const pn1 = L.designs[0].pn;

// edit + save again with a description: version 2
await page.evaluate(() => { const d = window.__dw.doc(); d.features[0].h = 40; window.__dw.setDoc(d); }); await W(1500);
await page.keyboard.press('Control+s'); await W(500);
await page.fill('#save-desc', 'Taller'); await page.click('#save-ok'); await W(1000);
L = await lib();
check(L.designs[0].version === 2, 'Ctrl+S saves version 2');

// versions dialog: open v1 in a tab, then promote it
await fileMenu('Versions'); await W(400);
check((await page.locator('#versions-table tbody tr').count()) === 2 && /Taller/.test(await page.textContent('#versions-table')), 'versions dialog lists v2 (Taller) and v1');
await page.click('[data-promote="1"]'); await W(1500);
L = await lib(); t = await tabs();
check(L.designs[0].version === 3 && t.list[t.active].version === 3, 'promoting v1 makes it v3');
const h3 = await page.evaluate(() => window.__dw.doc().features[0].h);
check(+h3 !== 40, 'the open tab shows the promoted geometry (h = ' + h3 + ')');

// Save As: copy without drawings, new part number; the tab becomes the copy
await fileMenu('Save As'); await page.fill('#save-name', 'Bracket long'); await page.click('#save-ok'); await W(1200);
L = await lib(); t = await tabs();
const copy = L.designs.find(d => d.name === 'Bracket long');
check(L.designs.length === 2 && copy && copy.pn !== pn1 && copy.version === 1 && t.list[t.active].name === 'Bracket long', 'Save As makes a separate design with its own part number ' + JSON.stringify(L.designs));

// data panel: list, open the original in a tab
await page.click('#abData'); await W(600);
check(await page.isVisible('#dataPanel') && /Brackets/.test(await page.textContent('#dp-list')), 'data panel lists the folder');
await page.dblclick('#dp-list .dpitem.folder:has-text("Brackets")'); await W(500);
check((await page.locator('#dp-list .dpitem[data-id]').count()) === 2, 'folder holds both designs');
if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/lib-data.png' });
const before = (await tabs()).list.length;
// the original is not open any more (the tab became the copy): opening it adds a tab
await page.dblclick('#dp-list .dpitem[data-id]:has-text("Bracket") >> nth=1'); await W(1500);
t = await tabs();
check(t.list.length === before + 1 && t.list[t.active].name === 'Bracket' && t.list[t.active].version === 3, 'double-click opens the saved design in a new tab ' + JSON.stringify(t.list.map(x => x.name)));
await page.dblclick('#dp-list .dpitem[data-id]:has-text("Bracket long")'); await W(800);
check((await tabs()).list.length === t.list.length, 'opening a design that is already open switches to its tab');
await page.click('#dataPanel .dphead .x'); await W(200);

// Save Copy As on a component (hybrid design with two bodies)
await page.click('#newTabBtn'); await W(400); await page.click('.studycard[data-type="hybrid"]'); await W(1000);
await page.evaluate(() => window.__dw.setDoc({ version: 2, name: 'Pair', units: 'mm', params: [], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {}, meta: { type: 'hybrid' }, features: [
  { id: 'a', type: 'box', name: 'A', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 20, d: 20, h: 10, op: 'new' }, { id: 'b', type: 'box', name: 'B', plane: 'XY', offset: 0, cx: 40, cy: 0, w: 10, d: 10, h: 10, op: 'new' }],
  components: [{ id: 'c1', name: 'Small block', bodies: ['b'], grounded: false }] })); await W(2000);
if (!(await page.locator('#btree .node:has-text("Small block")').count())) await page.locator('#btree .node:has-text("Components") .tw').first().click().catch(e => console.log('tw', e.message));
await W(300); if (process.env.DBG) console.log(await page.textContent('#btree'));
await page.locator('#btree .node:has-text("Small block")').first().click({ button: 'right' }); await W(300);
await page.click('.menu .mi:has-text("Save Copy As")'); await W(500);
check((await page.inputValue('#save-name')) === 'Small block', 'Save Copy As proposes the component name');
await page.click('#save-ok'); await W(1200);
L = await lib();
const sb = L.designs.find(d => d.name === 'Small block');
check(sb && sb.type === 'part' && sb.version === 1, 'component saved as its own part design ' + JSON.stringify(sb));
// open it: only the component's body remains
await page.click('#abData'); await W(500);
await page.click('#dp-crumbs .crumb >> nth=0'); await W(400);
await page.dblclick('#dp-list .dpitem[data-id]:has-text("Small block")'); await W(2500);
const st = await page.evaluate(() => window.__dw.state());
check(st.bodies.length === 1 && /=1,000$/.test(st.bodies[0]), 'the copy holds only the 10 mm block (' + st.bodies + ')');
await page.click('#dataPanel .dphead .x'); await W(200);

// close a tab with unsaved changes: asked to save
await page.evaluate(() => { const d = window.__dw.doc(); d.features[0].h = 12; window.__dw.setDoc(d); }); await W(1200);
await page.evaluate(() => window.__dw.mark());
const n0 = (await tabs()).list.length;
await page.click('#docTabs .dtab.on .dtx'); await W(400);
check(await page.isVisible('#close-discard'), 'closing an edited tab asks whether to save');
await page.click('#close-discard'); await W(800);
check((await tabs()).list.length === n0 - 1, 'Don’t save closes the tab');

// tabs survive a reload
const names = (await tabs()).list.map(x => x.name);
await page.reload(); await page.waitForFunction(() => window.__dw && window.__dw.tabs && document.querySelector('#docTabs .dtab'), null, { timeout: 60000 }); await W(1500);
const after = (await tabs()).list.map(x => x.name);
check(JSON.stringify(after) === JSON.stringify(names), 'open tabs come back after a reload ' + JSON.stringify(after));
L = await lib();
check(L.designs.length === 3, 'the library is kept in the browser (' + L.designs.length + ' designs)');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
