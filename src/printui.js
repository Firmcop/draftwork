// ===== Manufacture › Additive: print setup, slicing, layer preview, G-code export =====
const PRINT_DEFAULTS = { bedX: 220, bedY: 220, bedZ: 250, nozzle: 0.4, filament: 1.75, material: 'PLA', nozzleTemp: 210, bedTemp: 60, density: 1.24,
  layer: 0.2, firstLayer: 0.28, perimeters: 2, infill: 20, topLayers: 4, bottomLayers: 3, skirt: 1, skirtGap: 3,
  speedOuter: 30, speedInner: 45, speedInfill: 60, speedTravel: 150, speedFirst: 20, retract: 0.8, fan: 100, up: '+Z', bodies: null };
const MATERIALS_AM = { PLA: [210, 60, 1.24], PETG: [240, 80, 1.27], ABS: [245, 100, 1.04], TPU: [225, 50, 1.21] };
const printGroup = new THREE.Group(); scene.add(printGroup);
let printCache = null, printLayer = null;
const prn = () => { if (!doc.print) doc.print = { ...PRINT_DEFAULTS }; return doc.print; };

function printTris(o) {
  const R = AXIS_ROT[o.up || '+Z'](), tris = [], v = new THREE.Vector3();
  for (const id of result.bodies.keys()) {
    if (bodyHidden(id) || isSurfBody(id) || (o.bodies && !o.bodies.includes(id))) continue;
    const b = result.bodies.get(id), g = b.shape ? brepGeomNI(b) : b.geom; if (!g) continue;
    const M = R.clone().multiply(bodyXf(id)), p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(M); tris.push(v.x, v.y, v.z); }
  }
  // lay it on the plate, centred
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]); }
  const d = [o.bedX / 2 - (lo[0] + hi[0]) / 2, o.bedY / 2 - (lo[1] + hi[1]) / 2, -lo[2]];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) tris[i + k] += d[k];
  return { tris: new Float32Array(tris), size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}
async function slicePrint() {
  if (!needExact('Slicing')) return null;
  const o = prn(), key = JSON.stringify(o) + '|' + [...result.bodies.values()].map(b => b.shape || b.geom?.uuid).join(',');
  if (printCache?.key === key) return printCache;
  const { tris, size } = printTris(o);
  if (!tris.length) { toast('There is no solid body to print'); return null; }
  if (size[0] > o.bedX || size[1] > o.bedY || size[2] > o.bedZ) toast(`The part (${fmt(size[0])} × ${fmt(size[1])} × ${fmt(size[2])} mm) is larger than the build volume`);
  $('#busy').hidden = false; await new Promise(r => setTimeout(r, 20));
  try {
    const sl = slicePart(tris, o), g = printGcode(sl, { ...o, name: doc.name });
    printCache = { key, sl, ...g, size };
    printLayer = sl.layers.length - 1;
    renderBrowser();
  } catch (e) { console.error(e); toast('Slicing failed: ' + e.message); return null; }
  finally { $('#busy').hidden = true; }
  return printCache;
}
const AM_COLORS = { outer: 0xd9534a, inner: 0xe8913a, solid: 0x9bbf3a, infill: 0x3a7bd5, skirt: 0x8a8f96 };
function drawPrint() {
  clearGroup(printGroup);
  if (workspace !== 'manufacture' || activeTab !== 'ADDITIVE') { for (const [, sb] of shownBodies) sb.mesh.visible = sb.edges.visible = !bodyHidden(sb.rec.id); requestRender(); return; }
  const o = prn(), ox = -o.bedX / 2, oy = -o.bedY / 2;
  // build plate
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(o.bedX, o.bedY), new THREE.MeshBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  plate.position.z = -0.05; printGroup.add(plate);
  printGroup.add(line([[ox, oy, 0], [-ox, oy, 0], [-ox, -oy, 0], [ox, -oy, 0]], 0x8a8f96, { loop: true }));
  for (const [, sb] of shownBodies) sb.mesh.visible = sb.edges.visible = false;   // the sliced part stands in for the bodies
  const pc = printCache; if (!pc) { requestRender(); return; }
  const upto = Math.min(printLayer ?? pc.sl.layers.length - 1, pc.sl.layers.length - 1), byKind = {};
  for (let li = 0; li <= upto; li++) {
    const L = pc.sl.layers[li], cur = li === upto;
    for (const p of L.paths) {
      const k = (cur ? 'c:' : 'o:') + p.kind, arr = byKind[k] || (byKind[k] = []), pts = p.open ? p.pts : [...p.pts, p.pts[0]];
      for (let i = 1; i < pts.length; i++) arr.push(pts[i - 1][0] + ox, pts[i - 1][1] + oy, L.z, pts[i][0] + ox, pts[i][1] + oy, L.z);
    }
  }
  for (const [k, arr] of Object.entries(byKind)) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const cur = k.startsWith('c:'), kind = k.slice(2);
    printGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: AM_COLORS[kind] || 0xffffff, transparent: !cur, opacity: cur ? 1 : (kind === 'outer' ? 0.55 : 0.18) })));
  }
  requestRender();
}
function openPrintSetup() {
  const o = prn(), snap = JSON.stringify(o);
  const changed = () => { printCache = null; drawPrint(); };
  openPanelDialog({ title: 'Print Setup', icon: 'make', okLabel: 'OK', help: 'Settings for fused-filament (FFF) printers. Values are millimetres, °C and mm/s.',
    body: () => [
      section_('Printer', exField('Bed X', o, 'bedX', 'mm', { min: 10, after: changed }), exField('Bed Y', o, 'bedY', 'mm', { min: 10, after: changed }), exField('Height', o, 'bedZ', 'mm', { min: 10 }), exField('Nozzle', o, 'nozzle', 'mm', { min: 0.1, max: 2, after: changed }), exField('Filament', o, 'filament', 'mm', { min: 1, max: 3 })),
      section_('Material', selField('Material', o, 'material', Object.keys(MATERIALS_AM).map(m => [m, m]), { rerender: true, after: () => { const m = MATERIALS_AM[o.material]; [o.nozzleTemp, o.bedTemp, o.density] = m; } }), exField('Nozzle temperature', o, 'nozzleTemp', '°C'), exField('Bed temperature', o, 'bedTemp', '°C')),
      section_('Quality', exField('Layer height', o, 'layer', 'mm', { min: 0.04, max: 1, after: changed, id: 'am-layer' }), exField('First layer', o, 'firstLayer', 'mm', { min: 0.05, max: 1, after: changed }), exField('Perimeters', o, 'perimeters', '', { min: 1, max: 10, after: changed }),
        exField('Top layers', o, 'topLayers', '', { min: 0, max: 20, after: changed }), exField('Bottom layers', o, 'bottomLayers', '', { min: 0, max: 20, after: changed }), exField('Infill', o, 'infill', '%', { min: 0, max: 100, after: changed, id: 'am-infill' })),
      section_('Placement', selField('Up direction', o, 'up', [['+Z', '+Z (as modelled)'], ['-Z', '−Z (upside down)'], ['+X', '+X'], ['-X', '−X'], ['+Y', '+Y'], ['-Y', '−Y']], { after: changed }), chkField('Skirt', o, 'skirt', { after: changed })),
      section_('Speeds', exField('Outer wall', o, 'speedOuter', 'mm/s', { min: 1 }), exField('Inner walls', o, 'speedInner', 'mm/s', { min: 1 }), exField('Infill', o, 'speedInfill', 'mm/s', { min: 1 }), exField('First layer', o, 'speedFirst', 'mm/s', { min: 1 }), exField('Travel', o, 'speedTravel', 'mm/s', { min: 1 }), exField('Retraction', o, 'retract', 'mm', { min: 0 })),
    ],
    onOK: () => { const now = JSON.stringify(doc.print); if (now !== snap) { doc.print = JSON.parse(snap); checkpoint(); doc.print = JSON.parse(now); persist(); } printCache = null; drawPrint(); },
    onCancel: () => { doc.print = JSON.parse(snap); printCache = null; drawPrint(); },
  });
}
async function openSlicePreview() {
  activeTab = 'ADDITIVE'; renderRibbon();
  const pc = await slicePrint(); if (!pc) return;
  const n = pc.sl.layers.length, slider = h('input', { type: 'range', id: 'am-slider', min: 1, max: n, value: (printLayer ?? n - 1) + 1, style: 'width:100%' });
  const info = h('p', { class: 'note', id: 'am-info' });
  const upd = () => { printLayer = +slider.value - 1; const L = pc.sl.layers[printLayer]; info.textContent = `Layer ${printLayer + 1} / ${n} · Z ${fmt(L.z)} mm`; drawPrint(); };
  slider.addEventListener('input', upd);
  const st = pc.stats;
  openPanelDialog({ title: 'Slice Preview', icon: 'make', okLabel: 'Close',
    help: 'Red: outer walls · orange: inner walls · green: solid top/bottom · blue: infill · grey: skirt.',
    body: () => [section_(null, slider, info,
      h('dl', { class: 'stat' }, ...[['Size', pc.size.map(v => fmt(v)).join(' × ') + ' mm'], ['Layers', String(n)], ['Print time', fmtMin(st.minutes)], ['Filament', fmt(st.filament / 1000) + ' m · ' + fmt(st.grams) + ' g'], ['Material', `${prn().material} ${prn().nozzleTemp}/${prn().bedTemp} °C`]].flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('div', { class: 'row' }, h('span', { class: 'rl' }), h('button', { class: 'btn', type: 'button', id: 'am-export', onclick: () => exportPrint() }, 'Save G-code (.zip)')))],
    onOK: () => drawPrint(), onCancel: () => drawPrint() });
  upd();
}
async function exportPrint() {
  const pc = await slicePrint(); if (!pc) return;
  const base = slug() + '-print';
  saveFile(base + '.zip', makeZip([{ name: base + '.gcode', data: pc.gcode }]), 'application/zip');
}
// ribbon commands (this module loads after the ribbon)
cmd('am.setup', 'Print Setup', 'gear', { run: () => openPrintSetup() });
cmd('am.slice', 'Slice', 'make', { run: () => openSlicePreview() });
cmd('am.export', 'Export G-code', 'exportstl', { run: () => exportPrint() });
