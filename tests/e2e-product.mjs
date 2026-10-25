// End-to-end: the Product Configurator. Open the bearing-bracket example product on its design, see the rules
// evaluate, drive the live model from the Try it form, run the test cases, catch a typo, capture a parameter on a
// fresh design, keep or discard edits, and export the product bundle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ex = path.join(root, 'packages/rules/examples/bearing-bracket');
const product = JSON.parse(fs.readFileSync(path.join(ex, 'product.config.json'), 'utf8'));
for (const [name, file] of Object.entries(product.tables)) product.tables[name] = { csv: fs.readFileSync(path.join(ex, file), 'utf8') };
delete product.model; delete product.product;
const design = JSON.parse(fs.readFileSync(path.join(ex, 'bracket.design.json'), 'utf8'));

const PORT = 5231, server = serve(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log(e.stack); });
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
const W = ms => page.waitForTimeout(ms);
let failed = 0;
const check = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const docNow = () => page.evaluate(() => window.__dw.doc());
const state = () => page.evaluate(() => window.__dw.state());
const menu = async (tab, group, label) => { await page.click(`.rtab:text-is("${tab}")`); await W(150); await page.click(`.rlabel:has-text("${group}")`); await W(200); await page.locator('.menu .mi', { has: page.locator(`text="${label}"`) }).first().click(); await W(500); };
const setDoc = d => page.evaluate(d => window.__dw.setDoc(d), d);
const tab = async name => { await page.click(`.prodtabs button:has-text("${name}")`); await W(250); };
const status = () => page.textContent('.prodstatus');
const param = async name => (await docNow()).params.find(p => p.name === name)?.expr;
const waitParam = async (name, want) => { for (let i = 0; i < 40; i++) { if ((await param(name)) === want) return true; await W(150); } return false; };
const bodyVolume = async () => { const s = await state(); return Number((s.bodies[0] || '').split('=')[1]?.replace(/,/g, '')); };

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => /Exact engine/.test(document.querySelector('#engineBadge')?.textContent || ''), null, { timeout: 120000 });

// ---- open the example product on its design ----
await setDoc({ ...design, product }); await W(2500);
const vol0 = await bodyVolume();
await menu('SOLID', 'CONFIGURE', 'Product Configurator'); await W(400);
check(await page.isVisible('#modal.wide .prodtabs'), 'the configurator opens wide with its tabs');
check(/No problems/.test(await status()), 'the example product compiles (' + (await status()) + ')');
check((await page.locator('.prodgrid tbody tr').count()) === 5, 'Form tab lists the 5 inputs');
await tab('Rules');
const ruleRows = page.locator('.prodgrid tbody tr');
check((await ruleRows.count()) === product.rules.length, `Rules tab lists all ${product.rules.length} rules`);
const nowOf = async i => (await ruleRows.nth(i).locator('td.num').textContent()).trim();
check(await nowOf(0) === '12' && await nowOf(1) === '40', `"Now" shows bore_d = 12 and boss_d = 40 for the defaults (${await nowOf(0)}, ${await nowOf(1)})`);
const supNow = (await ruleRows.nth(7).locator('td.num').textContent()).trim();
check(supNow === 'kept', `the tap-hole rule reads "kept" by default (${supNow})`);

// ---- try it: live model ----
await tab('Try it');
check(/Total/.test(await page.textContent('.prodout')), 'Try it shows a price with a total');
await page.check('.prodform label:has-text("Live model") input'); await W(300);
await page.selectOption('#prodf-ShaftSize', { label: '20 mm' }); await W(400);
await page.selectOption('#prodf-Load', { label: 'Heavy' }); await W(400);
check(await waitParam('boss_d', '52') && (await param('thickness')) === '14' && (await param('width')) === '120', `live model: 20 mm heavy sets boss_d 52, thickness 14, width 120 (${await param('boss_d')}, ${await param('thickness')}, ${await param('width')})`);
await W(2500);
const vol1 = await bodyVolume();
check(vol1 > vol0 * 1.3, `the rebuilt bracket is bigger (${vol0} → ${vol1} mm³)`);
check(/consider Steel S275/.test(await page.textContent('.prodmsgs')), 'the heavy-aluminium warning shows');
await page.selectOption('.prodexplain select', 'width'); await W(250);
const tree = await page.textContent('.prodtree');
check(/width = 120/.test(tree) && /boss_d = 52/.test(tree) && /ShaftSize = 20\s*\(answer\)/.test(tree), 'Explain traces width back to the shaft answer');
await page.uncheck('.prodform label:has-text("Live model") input'); await W(200);
await page.click('.prodform .prodfield:has-text("Tapped holes") input[type="checkbox"]'); await W(300);
await page.click('.prodform .btn.go'); await W(2500);
const d1 = await docNow();
check(d1.features.find(f => f.name === 'M3 tap hole').suppressed === true && d1.features.find(f => f.name === 'Bolt circle').suppressed === true, 'Apply to model suppresses the tap holes when cover screws are off');
await page.fill('.prodform input[aria-label="Test case name"]', 'heavy 20 no screws');
await page.click('.prodform button:has-text("Save as test case")'); await W(300);

// ---- tests ----
check((await page.locator('.prodtabs button[aria-pressed="true"]').textContent()).startsWith('Tests'), 'saving a case moves to the Tests tab');
check((await page.locator('.prodgrid tbody tr').count()) === 5, 'the new case joins the 4 example cases');
await page.click('.prodbar .btn.go:has-text("Run tests")'); await W(300);
const res = await page.textContent('.prodbar .note');
check(/5 of 5 pass/.test(res) && /every branch tested/.test(res), 'all 5 test cases pass with every branch tested (' + res + ')');

// ---- a typo is caught, with a suggestion and a badge ----
await tab('Variables');
const formula = page.locator('.prodgrid tbody tr').filter({ has: page.locator('input[value="Bearing"]') }).locator('input[aria-label="Formula"]');
await formula.fill('LOOKUP(bearings, ShaftSise, "bearing")'); await formula.press('Tab'); await W(300);
check(/did you mean "ShaftSize"/.test(await page.textContent('.prodprobs')), 'an unknown name is reported with a suggestion');
check((await page.locator('.prodtabs button:has-text("Variables") .prodbadge').textContent()) === '1', 'the Variables tab shows a problem badge');
check(await page.locator('.prodgrid tr.err').count() === 1, 'the row with the problem is marked');
await tab('Try it');
check(/Fix the problems/.test(await page.textContent('.prodpane')), 'Try it waits until the problems are fixed');

// ---- cancel discards, OK keeps ----
await page.click('#modal .dfoot .btn:text-is("Cancel")'); await W(300);
check((await docNow()).product.tests.length === 4, 'Cancel keeps the product as it was (4 tests)');
await menu('SOLID', 'CONFIGURE', 'Product Configurator'); await W(400);
await tab('Tests');
await page.locator('.prodgrid tbody tr').last().locator('button[aria-label^="Delete test"]').click(); await W(200);
await page.click('#modal .dfoot .btn.ok'); await W(300);
check((await docNow()).product.tests.length === 3, 'OK saves edits with the design (3 tests)');
await page.keyboard.press('Control+z'); await W(500);
check((await docNow()).product.tests.length === 4, 'Undo brings the deleted test back');

// ---- export ----
await menu('SOLID', 'CONFIGURE', 'Product Configurator'); await W(400);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('#modal .dfoot .btn:text-is("Export…")')]);
let zipOk = false;
if (dl) { const buf = fs.readFileSync(await dl.path()); const s = buf.toString('latin1'); zipOk = buf[0] === 0x50 && buf[1] === 0x4b && s.includes('product.config.json') && s.includes('tables/bearings.csv') && s.includes('.design.json'); }
check(!!dl && /-product\.zip$/.test(dl.suggestedFilename()) && zipOk, 'Export downloads a zip with product.config.json, the design and the CSV tables' + (dl ? ` (${dl.suggestedFilename()})` : ''));
await page.click('#modal .dfoot .btn:text-is("Cancel")'); await W(300);

// ---- capture on a fresh design ----
await setDoc({ version: 2, name: 'Plate', units: 'mm', params: [{ name: 'width', expr: '40' }, { name: 'height', expr: '10' }], bodyMeta: {}, showOrigin: false, sketchShown: {}, planeHidden: {},
  features: [{ id: 'b', type: 'box', name: 'Plate', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 'width', d: 20, h: 'height', op: 'new' }] });
await W(2000);
await menu('SOLID', 'CONFIGURE', 'Product Configurator'); await W(400);
check(/Start by capturing/.test(await status()), 'a design without a product starts empty');
await page.selectOption('select[aria-label="Capture a parameter"]', 'width'); await W(300);
const inName = await page.inputValue('.prodgrid tbody tr input[aria-label="Input name"]');
check(inName === 'Width' && /No problems/.test(await status()), `capturing width makes input "${inName}" and compiles`);
await tab('Rules');
check((await page.inputValue('.prodgrid tbody tr input[aria-label="Formula"]')) === 'Width', 'and a rule width = Width');
await tab('Try it');
await page.fill('#prodf-Width', '15'); await page.press('#prodf-Width', 'Tab'); await W(300);
check(/below the minimum of 20/.test(await page.textContent('.prodmsgs')), 'answers outside the captured range are refused (min = half the value)');
await page.fill('#prodf-Width', '60'); await page.press('#prodf-Width', 'Tab'); await W(300);
await page.click('.prodform .btn.go'); await W(2000);
check((await param('width')) === '60' && Math.abs((await bodyVolume()) - 60 * 20 * 10) < 1, 'Apply sets width = 60 and the plate rebuilds (12,000 mm³)');
await page.click('#modal .dfoot .btn.ok'); await W(300);
check(!(await page.isVisible('#modal.wide')), 'the dialog closes and the modal is no longer wide');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
