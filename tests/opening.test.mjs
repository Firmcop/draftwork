// Create Opening and the 20 ft container reference model: real cuts through corrugated walls, positions from
// the wall edges, frames, warnings for posts and rails, deep single-solid containers, STEP export with the openings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernels } from './load-kernels.mjs';

const K = await loadKernels({ exact: true }), RC = K.getRC();
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/container.js'), 'utf8');
const containerFeatures = (0, eval)('(' + src.slice(src.indexOf('function containerFeatures')) + ')');
const base = K.resolveFeatures(containerFeatures(), {});
const vol = (r, id) => RC.measureVolume(r.bodies.get(id).shape);
const okAll = r => { const e = [...r.status].filter(([, s]) => s.state === 'error'); assert.equal(e.length, 0, JSON.stringify(e)); };
// the left side wall's outside face (y = +1219, facing +Y), as a face pick stores it
const onLeft = o => ({ type: 'opening', plane: 'XZ', offset: -1219, flip: true, target: 'ct_wallL', shape: 'rect', ...o });
const door = onLeft({ id: 'door', name: 'Door', w: 900, h: 2100, fromLeft: 1000, fromBottom: 0 });
const win = onLeft({ id: 'win', name: 'Window', w: 1200, h: 1000, fromLeft: 3000, fromBottom: 900 });

test('20 ft container: 19 separate parts, posts and rails marked as structure', () => {
  const r = K.regenerateBrep(base); okAll(r);
  assert.equal(r.bodies.size, 19);
  const b = r.bodies.get('ct_wallL').shape.boundingBox.bounds;
  assert.deepEqual(b[0].map(Math.round).concat(b[1].map(Math.round)), [-2879, 1181, 160, 2879, 1219, 2491], 'corrugated wall between posts and rails');
  assert.equal(r.bodies.get('ct_postFL').role, 'structure');
});

test('door 900 × 2100 and window 1200 × 1000 cut the corrugated wall where they are placed', () => {
  const r0 = K.regenerateBrep(base), w0 = vol(r0, 'ct_wallL');
  const rd = K.regenerateBrep([...base, door]); okAll(rd);
  const removedDoor = w0 - vol(rd, 'ct_wallL');
  // a 900 wide strip of corrugated 2 mm sheet over 2100 mm: between 900 × 2100 × 2 and that times the developed length ratio
  assert.ok(removedDoor > 900 * 2100 * 2 * 0.95 && removedDoor < 900 * 2100 * 2 * 1.35, 'door removes the sheet in its outline: ' + removedDoor);
  assert.equal(rd.status.get('door').info.wallW, 5758);
  // seen from outside the left wall, "left" is the door end (+X): the door spans x = 2879 − 1000 − 900 … 2879 − 1000
  const probe = (x, z) => { const p = RC.makeBaseBox(2, 44, 2).translate(x, 1200, z); try { return RC.measureVolume(rd.bodies.get('ct_wallL').shape.intersect(p)); } catch (e) { return 0; } };
  assert.equal(probe(2879 - 1000 - 450, 1200), 0, 'no wall inside the door');
  assert.ok(probe(2879 - 1000 + 300, 1200) > 0, 'wall beside the door');
  const rw = K.regenerateBrep([...base, door, win]); okAll(rw);
  assert.ok(vol(rd, 'ct_wallL') - vol(rw, 'ct_wallL') > 1200 * 1000 * 2 * 0.95, 'window added independently');
  // editing the window afterwards moves it
  const rw2 = K.regenerateBrep([...base, door, { ...win, fromLeft: 3500 }]); okAll(rw2);
  assert.ok(Math.abs(vol(rw2, 'ct_wallL') - vol(rw, 'ct_wallL')) < 0.02 * vol(rw, 'ct_wallL'), 'moved window, similar material removed');
});

test('overlapping openings, a frame, and warnings for structure', () => {
  const over = onLeft({ id: 'over', name: 'Vent', w: 600, h: 400, fromLeft: 1700, fromBottom: 1900 });   // overlaps the door's top
  const r = K.regenerateBrep([...base, door, over]); okAll(r);
  const framed = { ...win, frame: true, frameWidth: 50 };
  const rf = K.regenerateBrep([...base, framed]); okAll(rf);
  assert.ok(rf.bodies.has('win:frame') && vol(rf, 'win:frame') > 0, 'frame is its own body');
  assert.equal(rf.bodies.get('win:frame').name, 'Window frame');
  // the frame fills the band cut around the opening: wall + frame do not overlap
  let ov = 0; try { ov = RC.measureVolume(rf.bodies.get('ct_wallL').shape.intersect(rf.bodies.get('win:frame').shape)); } catch (e) { }
  assert.ok(ov < 1, 'frame and wall do not overlap: ' + ov);
  const low = K.regenerateBrep([...base, { ...door, frame: true, frameWidth: 60 }]);
  assert.match(low.status.get('door').warn || '', /Bottom side rail left/, 'a frame reaching into the rail is flagged');
  const past = K.regenerateBrep([...base, { ...door, fromLeft: 5000 }]);
  assert.match(past.status.get('door').msg, /runs past the wall/);
  const wrongFace = K.regenerateBrep([...base, { ...door, target: 'ct_floor' }]);
  assert.equal(wrongFace.status.get('door').state, 'error', 'an opening that misses its body is an error, not a silent success');
});

test('a whole container in one solid: only the picked wall is opened', () => {
  const box = RC.makeBaseBox(6058, 2438, 2591), shell = box.cut(RC.makeBaseBox(6054, 2434, 2587).translate(0, 0, 2));
  K.brepImportSTEP && 0;
  const imp = K.regenerateBrep([{ id: 'b', type: 'box', plane: 'XY', offset: 0, cx: 0, cy: 0, w: 6058, d: 2438, h: 2591, op: 'new' }, { id: 'in', type: 'box', plane: 'XY', offset: 2, cx: 0, cy: 0, w: 6054, d: 2434, h: 2587, op: 'cut' },
    { id: 'o', type: 'opening', name: 'Door', plane: 'XZ', offset: 1219, flip: false, target: 'b', shape: 'rect', w: 900, h: 2100, fromLeft: 2000, fromBottom: 2 }]);
  okAll(imp);
  const removed = RC.measureVolume(shell) - RC.measureVolume(imp.bodies.get('b').shape);
  assert.ok(Math.abs(removed - 900 * 2100 * 2) < 1, 'only the front sheet is cut (the back wall 2.4 m away is untouched): ' + removed);
});

test('openings are in the exported STEP', async () => {
  const r = K.regenerateBrep([...base, door]);
  const blob = K.brepSTEP([{ shape: r.bodies.get('ct_wallL').shape, name: 'Left side wall' }]);
  const text = await blob.text();
  await K.brepImportSTEP('rt', text);
  const back = K.regenerateBrep([{ id: 'i', type: 'import', file: 'rt' }]);
  assert.ok(Math.abs(RC.measureVolume([...back.bodies.values()][0].shape) - vol(r, 'ct_wallL')) < 1, 'exported wall has the door');
});
