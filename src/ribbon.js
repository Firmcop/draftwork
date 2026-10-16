// ===== Commands, workspace tabs, ribbon and menus =====
const CMD = {};
function cmd(id, label, iconKey, o = {}) { CMD[id] = { id, label, icon: iconKey, ...o }; }
const P1 = 'Phase 1', P2 = 'Phase 2', P3 = 'Phase 3', P4 = 'Phase 4', P5 = 'Phase 5';
const planned = (id, label, iconKey, phase = P1, o = {}) => cmd(id, label, iconKey, { phase, ...o });

// solid › create
cmd('sketch', 'Create Sketch', 'sketch', { run: () => startCreateSketch() });
cmd('form', 'Create Form', 'form', { run: () => newForm() });
cmd('derive', 'Derive', 'derive', { run: () => startDerive() });
cmd('extrude', 'Extrude', 'extrude', { key: 'E', run: () => newProfileFeature('extrude') });
cmd('revolve', 'Revolve', 'revolve', { run: () => newProfileFeature('revolve') });
cmd('sweep', 'Sweep', 'sweep', { run: () => newSweep(false) }); cmd('loft', 'Loft', 'loft', { run: () => newLoft() }); cmd('rib', 'Rib', 'rib', { run: () => startRibWeb('rib') }); cmd('web', 'Web', 'web', { run: () => startRibWeb('web') }); cmd('emboss', 'Emboss', 'emboss', { run: () => startEmboss() });
cmd('hole', 'Hole', 'hole', { key: 'H', run: () => startPlaced('hole') });
cmd('thread', 'Thread', 'thread', { run: () => newEdgeFeature('thread') });
cmd('box', 'Box', 'box', { run: () => startPlaced('box') });
cmd('cylinder', 'Cylinder', 'cylinder', { run: () => startPlaced('cylinder') });
cmd('sphere', 'Sphere', 'sphere', { run: () => startPlaced('sphere') });
cmd('torus', 'Torus', 'torus', { run: () => startPlaced('torus') });
cmd('coil', 'Coil', 'coil', { run: () => startPlaced('coil') }); cmd('pipe', 'Pipe', 'pipe', { run: () => newSweep(true) });
cmd('patrect', 'Rectangular Pattern', 'patrect', { run: () => newRepeat('pattern', 'linear') });
cmd('patcirc', 'Circular Pattern', 'patcirc', { run: () => newRepeat('pattern', 'circular') });
cmd('patpath', 'Pattern on Path', 'patpath', { run: () => startPatternOnPath() });
cmd('mirror', 'Mirror', 'mirror', { run: () => newRepeat('mirror') });
cmd('thicken', 'Thicken', 'thicken', { run: () => newEdgeFeature('thicken') }); cmd('boundary', 'Boundary Fill', 'boundary', { run: () => startBoundaryFill() });
// solid › modify
cmd('presspull', 'Press Pull', 'presspull', { key: 'Q', run: () => newEdgeFeature('presspull') });
cmd('fillet', 'Fillet', 'fillet', { key: 'F', run: () => newEdgeFeature('fillet') });
cmd('chamfer', 'Chamfer', 'chamfer', { run: () => newEdgeFeature('chamfer') }); cmd('shell', 'Shell', 'shell', { run: () => newEdgeFeature('shell') }); cmd('draft', 'Draft', 'draft', { run: () => newEdgeFeature('draft') }); cmd('scale', 'Scale', 'scale', { run: () => startScale() });
cmd('combine', 'Combine', 'combine', { run: () => newCombine() });
cmd('replaceface', 'Replace Face', 'replaceface', { run: () => newEdgeFeature('replaceface') }); cmd('splitface', 'Split Face', 'splitface', { run: () => newEdgeFeature('splitface') }); cmd('splitbody', 'Split Body', 'splitbody', { run: () => startSplitBody() });
cmd('move', 'Move/Copy', 'move', { key: 'M', run: () => newMove() });
cmd('align', 'Align', 'align', { run: () => startAlign() });
cmd('delete', 'Delete', 'delete', { key: 'Del', run: () => deleteSelection() });
cmd('material', 'Physical Material', 'material', { run: () => openMaterialDialog() });
cmd('appearance', 'Appearance', 'appearance', { key: 'A', run: () => openAppearanceDialog() });
cmd('params', 'Change Parameters', 'params', { run: () => openParamsModal() });
// configure
cmd('cfgtable', 'Configuration Table', 'configure', { run: () => openConfigTable() }); cmd('cfgrules', 'Configuration Rules', 'configure', { run: () => openConfigRules() });
// construct
cmd('offsetplane', 'Offset Plane', 'plane', { run: () => startOffsetPlane() });
cmd('planeangle', 'Plane at Angle', 'planeangle', { run: () => startPlaneAtAngle() }); cmd('midplane', 'Midplane', 'midplane', { run: () => startMidplane() }); cmd('planetangent', 'Tangent Plane', 'plane', { run: () => startTangentPlane() });
cmd('plane3p', 'Plane Through Three Points', 'plane', { run: () => startPlane3p() });
cmd('axiscyl', 'Axis Through Cylinder/Cone/Torus', 'axis', { run: () => startAxisCyl() }); cmd('axis2p', 'Axis Through Two Points', 'axis', { run: () => startAxis2p() });
cmd('axisedge', 'Axis Through Edge', 'axis', { run: () => startAxisEdge() }); cmd('axis2planes', 'Axis Through Two Planes', 'axis', { run: () => startAxis2planes() });
cmd('pointv', 'Point at Vertex', 'point', { run: () => startPointVertex() }); cmd('pointc', 'Point at Center of Circle', 'point', { run: () => startPointCenter() }); cmd('pointxyz', 'Point by Coordinates', 'point', { run: () => startPointXYZ() });
// inspect
cmd('measure', 'Measure', 'measure', { key: 'I', run: () => startMeasure() });
cmd('interference', 'Interference', 'interference', { run: () => openInterference() }); cmd('curvature', 'Curvature Comb Analysis', 'curvature', { run: () => toggleCombMode() }); cmd('zebra', 'Zebra Analysis', 'zebra', { run: () => toggleZebra() });
cmd('section', 'Section Analysis', 'section', { run: () => openSectionDialog() });
cmd('com', 'Center of Mass', 'com', { run: () => toggleCOM() });
cmd('properties', 'Properties', 'properties', { run: () => openPropertiesModal() });
// insert
cmd('insderive', 'Insert Derive', 'derive', { run: () => startDerive() }); cmd('decal', 'Decal', 'decal', { run: () => startCanvas('decal') }); cmd('canvas', 'Canvas', 'canvas', { run: () => startCanvas('canvas') });
cmd('insstep', 'Insert STEP', 'insertmesh', { run: () => startImportSTEP() }); cmd('insmesh', 'Insert Mesh', 'insertmesh', { run: () => startInsertMesh() }); cmd('inssvg', 'Insert SVG', 'insertsvg', { run: () => startInsert2D('svg') }); cmd('insdxf', 'Insert DXF', 'insertsvg', { run: () => startInsert2D('dxf') });
// assemble
cmd('newcomp', 'New Component', 'component', { run: () => newComponent() }); cmd('joint', 'Joint', 'joint', { key: 'J', run: () => newJoint() }); cmd('asbuilt', 'As-built Joint', 'joint', { run: () => newJoint(true) });
cmd('rigid', 'Rigid Group', 'component', { run: () => newRigidGroup() }); cmd('drive', 'Drive Joints', 'motion', { run: () => { const j = (selJoint && joints().find(x => x.id === selJoint)) || joints().at(-1); j ? editJoint(j.id) : toast('There are no joints yet'); } }); cmd('motionlink', 'Motion Link', 'motion', { run: () => openMotionLink() }); cmd('contact', 'Enable Contact Sets', 'motion', { run: () => toggleContact() });
// select
cmd('select', 'Select', 'select', { run: () => cancelModes(true) });
cmd('window', 'Window Selection', 'window', { run: () => startWindowSelect() }); cmd('filters', 'Selection Filters', 'filter', { run: () => openSelectionFilters() });
// surface
for (const [k, t, l, ic] of [['s.extrude', 'sextrude', 'Extrude Surface', 'patch'], ['s.revolve', 'srevolve', 'Revolve Surface', 'revolve'], ['s.sweep', 'ssweep', 'Sweep Surface', 'sweep'], ['s.loft', 'sloft', 'Loft Surface', 'loft'], ['s.patch', 'patch', 'Patch', 'patch'], ['s.offset', 'soffset', 'Offset Surface', 'offsetsurf'], ['s.ruled', 'ruled', 'Ruled Surface', 'offsetsurf'],
  ['s.trim', 'trim', 'Trim', 'trim'], ['s.untrim', 'untrim', 'Untrim', 'trim'], ['s.extend', 'sextend', 'Extend', 'extend'], ['s.stitch', 'stitch', 'Stitch', 'stitch'], ['s.unstitch', 'unstitch', 'Unstitch', 'stitch'], ['s.reverse', 'reverse', 'Reverse Normal', 'patch'], ['s.delete', 'deleteface', 'Delete Face', 'delete']])
  cmd(k, l, ic, { run: () => newSurface(t) });
cmd('s.thicken', 'Thicken', 'thicken', { run: () => newEdgeFeature('thicken') });
// mesh
cmd('m.insert', 'Insert Mesh', 'insertmesh', { run: () => startInsertMesh() }); cmd('m.tessellate', 'Tessellate', 'remesh', { run: () => newMesh('tessellate') }); cmd('m.facegroups', 'Generate Face Groups', 'remesh', { run: () => newMesh('facegroups') });
cmd('m.repair', 'Repair', 'remesh', { run: () => newMesh('meshrepair') }); cmd('m.remesh', 'Remesh', 'remesh', { run: () => newMesh('remesh') }); cmd('m.reduce', 'Reduce', 'reduce', { run: () => newMesh('reduce') }); cmd('m.smooth', 'Smooth', 'smooth', { run: () => newMesh('smooth') });
cmd('m.convert', 'Convert Mesh', 'insertmesh', { run: () => newMesh('meshconvert') }); cmd('m.planecut', 'Plane Cut', 'splitbody', { run: () => newMesh('meshplane') });
cmd('exportstl', 'Export STL', 'exportstl', { run: () => openExportDialog() });
// sheet metal
cmd('sm.flange', 'Flange', 'flange', { run: () => newSheet('flange') }); cmd('sm.contour', 'Contour Flange', 'contourflange', { run: () => newSheet('contourflange') }); cmd('sm.unfold', 'Unfold', 'unfold', { run: () => newSheet('unfold') });
cmd('sm.refold', 'Refold', 'unfold', { run: () => newSheet('refold') }); cmd('sm.flat', 'Create Flat Pattern', 'unfold', { run: () => openFlatPattern() }); cmd('sm.rules', 'Sheet Metal Rules', 'sheetrules', { run: () => openSheetRules() });
// plastic
cmd('pl.rules', 'Plastic Rules', 'plasticrules', { run: () => openPlasticRules() }); cmd('pl.boss', 'Boss', 'boss', { run: () => newPlastic('boss') }); cmd('pl.snap', 'Snap Fit', 'snapfit', { run: () => newPlastic('snapfit') }); cmd('pl.lip', 'Lip / Groove', 'lip', { run: () => newPlastic('lip') });
cmd('pl.rest', 'Rest', 'boss', { run: () => newPlastic('rest') }); cmd('pl.rib', 'Rib', 'rib', { run: () => startRibWeb('rib') }); cmd('pl.web', 'Web', 'web', { run: () => startRibWeb('web') });
// manage / utilities
cmd('bom', 'Bill of Materials', 'bom', { run: () => openBOMModal() });
cmd('make3d', '3D Print', 'make', { run: () => openExportDialog() });
planned('addins', 'Scripts and Add-Ins', 'addins', P2); planned('taskmgr', 'Task Manager', 'utility', P2);
planned('pmi', 'Create PMI', 'pmi', P2); planned('co2', 'Carbon Footprint', 'co2', P4);
// sketch (contextual)
cmd('k.line', 'Line', 'line', { key: 'L', run: () => setSketchTool('line') });
cmd('k.rect2', '2-Point Rectangle', 'rect2', { key: 'R', run: () => setSketchTool('rect2') });
cmd('k.rectc', 'Center Rectangle', 'rectc', { run: () => setSketchTool('rectc') });
cmd('k.circle', 'Center Diameter Circle', 'circle', { key: 'C', run: () => setSketchTool('circle') });
cmd('k.polygon', 'Circumscribed Polygon', 'polygon', { key: 'P', run: () => setSketchTool('polygon') });
cmd('k.slot', 'Center to Center Slot', 'slot', { key: 'S', run: () => setSketchTool('slot') });
cmd('k.arc', 'Three-Point Arc', 'arc', { key: 'A', run: () => setSketchTool('arc3') }); cmd('k.spline', 'Fit Point Spline', 'spline', { run: () => setSketchTool('spline') }); cmd('k.point', 'Point', 'spoint', { run: () => setSketchTool('point') }); cmd('k.text', 'Text', 'text', { run: () => setSketchTool('text') });
cmd('k.mirror', 'Sketch Mirror', 'mirror', { run: () => startSketchMirror() }); cmd('k.cpattern', 'Sketch Circular Pattern', 'patcirc', { run: () => startSketchCPattern() }); cmd('k.project', 'Project', 'insertmesh', { run: () => setSketchTool('project') });
cmd('k.dimension', 'Sketch Dimension', 'dimension', { key: 'D', run: () => { if (geoSel.size) addDimension(); else { setSketchTool('select'); toast('Select a line, two points, a circle or arc, or two lines, then press D'); } } });
cmd('k.fillet', 'Sketch Fillet', 'fillet2d', { run: () => setSketchTool('fillet2d') }); cmd('k.trim', 'Trim', 'trim2d', { key: 'T', run: () => setSketchTool('trim') }); cmd('k.extend', 'Extend', 'extend', { run: () => setSketchTool('extend') }); cmd('k.offset', 'Offset', 'offset2d', { key: 'O', run: () => offsetSelection() });
cmd('k.move', 'Move/Copy', 'move', { run: () => setSketchTool('select') });
cmd('k.delete', 'Delete', 'delete', { key: 'Del', run: () => { if (geoSel.size) deleteGeoSelection(); else if (selProfile) deleteProfile(selProfile); else toast('Select something to delete'); } });
for (const [k, l] of [['coincident', 'Coincident'], ['collinear', 'Collinear'], ['tangent', 'Tangent'], ['equal', 'Equal'], ['parallel', 'Parallel'], ['perpendicular', 'Perpendicular'], ['fix', 'Fix/Unfix'], ['horizontal', 'Horizontal/Vertical'], ['concentric', 'Concentric'], ['midpoint', 'Midpoint']])
  cmd('k.c.' + k, l, k, { key: k === 'horizontal' ? 'H' : undefined, run: () => applyConstraint(k) });
cmd('k.c.symmetry', 'Symmetry', 'symmetry', { run: () => applyConstraint('symmetry') });
cmd('k.construction', 'Normal/Construction', 'construction', { key: 'X', run: () => toggleConstruction() });
cmd('k.select', 'Select', 'select', { run: () => setSketchTool('select') });
cmd('k.finish', 'Finish Sketch', 'finish', { run: () => finishSketch() });

// drawing workspace
cmd('dw.std', 'Standard Views', 'patrect', { run: () => dwStandardViews() });
for (const [k, l] of Object.entries(VIEW_KINDS)) cmd('dw.view.' + k, l + ' View', k === 'iso' ? 'box' : 'lookat', { run: () => dwSetTool('place:' + k) });
cmd('dw.hidden', 'Hidden Lines On/Off', 'eyeoff', { run: () => dwToggleHidden() });
cmd('dw.dim', 'Dimension', 'dimension', { key: 'D', run: () => dwSetTool('dim') });
cmd('dw.dia', 'Diameter Dimension', 'circle', { run: () => dwSetTool('dia') });
cmd('dw.sheet', 'Sheet & Title Block', 'properties', { run: () => dwSheetDialog() });
cmd('dw.rad', 'Radius Dimension', 'arc', { run: () => dwSetTool('rad') });
cmd('dw.ang', 'Angle Dimension', 'planeangle', { run: () => dwSetTool('ang') });
cmd('dw.section', 'Section View', 'section', { run: () => dwSetTool('section') });
cmd('dw.centers', 'Center Marks On/Off', 'point', { run: () => dwToggleCenters() });
cmd('dw.parts', 'Parts List', 'bom', { run: () => dwToggleParts() });
cmd('dw.fit', 'Fit Sheet', 'fit', { key: 'F', run: () => { dwFit(); renderSheet(); } });
cmd('dw.export', 'Export PDF, SVG, DXF (.zip)', 'exportstl', { run: () => exportDrawingAll() });
cmd('dw.detail', 'Detail View', 'zoom', { run: () => dwSetTool('detail') }); cmd('dw.balloon', 'Balloon', 'bom', { run: () => dwSetTool('balloon') }); cmd('dw.note', 'Note', 'text', { run: () => dwSetTool('note') });
cmd('dw.addsheet', 'New Sheet', 'doc', { run: () => addSheet() }); cmd('dw.delsheet', 'Delete Sheet', 'delete', { run: () => deleteSheet() });
cmd('dw.finish', 'Finish Drawing', 'finish', { run: () => exitDrawing() });
const TABS = {
  MILLING: [
    { name: 'SETUP', bar: ['cam.setup'], menu: ['cam.setup', 'cam.tools'] },
    { name: '2D', bar: ['cam.face', 'cam.pocket', 'cam.contour'], menu: ['cam.face', 'cam.pocket', 'cam.contour'] },
    { name: '3D', bar: ['cam.rough', 'cam.parallel', 'cam.waterline'], menu: ['cam.rough', 'cam.parallel', 'cam.waterline'] },
    { name: 'DRILLING', bar: ['cam.drill'], menu: ['cam.drill'] },
    { name: 'ACTIONS', bar: ['cam.generate', 'cam.simulate', 'cam.post'], menu: ['cam.generate', 'cam.simulate', 'cam.post'] },
    { name: 'MANAGE', bar: ['cam.tools'], menu: ['cam.tools'] },
  ],
  'STATIC STRESS': [
    { name: 'STUDY', bar: ['sim.study'], menu: ['sim.study'] },
    { name: 'MATERIALS', bar: ['sim.mats'], menu: ['sim.mats'] },
    { name: 'CONSTRAINTS', bar: ['sim.fixed'], menu: ['sim.fixed'] },
    { name: 'LOADS', bar: ['sim.force', 'sim.pressure', 'sim.gravity'], menu: ['sim.force', 'sim.pressure', 'sim.gravity'] },
    { name: 'MESH', bar: ['sim.mesh'], menu: ['sim.mesh'] },
    { name: 'SOLVE', bar: ['sim.solve'], menu: ['sim.solve'] },
    { name: 'RESULTS', bar: ['sim.results', 'sim.report'], menu: ['sim.results', 'sim.report'] },
  ],
  ADDITIVE: [
    { name: 'SETUP', bar: ['am.setup'], menu: ['am.setup'] },
    { name: 'NEST', bar: ['nest'], menu: ['nest'] },
    { name: 'SLICE', bar: ['am.slice'], menu: ['am.slice'] },
    { name: 'EXPORT', bar: ['am.export'], menu: ['am.export'] },
  ],
  DRAWING: [
    { name: 'VIEWS', bar: ['dw.std', 'dw.view.front', 'dw.view.iso', 'dw.section', 'dw.detail'], menu: ['dw.std', '-', ...Object.keys(VIEW_KINDS).map(k => 'dw.view.' + k), 'dw.section', 'dw.detail', '-', 'dw.hidden', 'dw.centers'] },
    { name: 'ANNOTATE', bar: ['dw.dim', 'dw.dia', 'dw.rad', 'dw.ang', 'dw.note'], menu: ['dw.dim', 'dw.dia', 'dw.rad', 'dw.ang', '-', 'dw.note', 'dw.balloon', '-', 'dw.centers', 'dw.hidden'] },
    { name: 'TABLES', bar: ['dw.parts', 'dw.balloon'], menu: ['dw.parts', 'dw.balloon'] },
    { name: 'SHEET', bar: ['dw.sheet', 'dw.addsheet', 'dw.fit'], menu: ['dw.sheet', 'dw.fit', '-', 'dw.addsheet', 'dw.delsheet'] },
    { name: 'EXPORT', bar: ['dw.export'], menu: ['dw.export'] },
    { name: 'FINISH DRAWING', finish: true, bar: ['dw.finish'], menu: [] },
  ],
  SOLID: [
    { name: 'CREATE', bar: ['sketch', 'extrude', 'revolve', 'sweep', 'loft', 'hole', 'box', 'patrect', 'mirror'], menu: ['sketch', 'form', 'derive', '-', 'extrude', 'revolve', 'sweep', 'loft', 'rib', 'web', 'emboss', '-', 'hole', 'thread', '-', 'box', 'cylinder', 'sphere', 'torus', 'coil', 'pipe', '-', { sub: 'Pattern', icon: 'patrect', items: ['patrect', 'patcirc', 'patpath'] }, 'mirror', '-', 'thicken', 'boundary'] },
    { name: 'MODIFY', bar: ['presspull', 'fillet', 'chamfer', 'shell', 'draft', 'combine', 'move', 'params'], menu: ['presspull', 'fillet', 'chamfer', 'shell', 'draft', 'scale', 'combine', '-', 'replaceface', 'splitface', 'splitbody', '-', 'move', 'align', 'delete', '-', 'material', 'appearance', '-', 'params'] },
    { name: 'CONFIGURE', bar: ['cfgtable'], menu: ['cfgtable', 'cfgrules'] },
    { name: 'CONSTRUCT', bar: ['offsetplane', 'planeangle', 'axiscyl'], menu: ['offsetplane', 'planeangle', 'midplane', 'planetangent', 'plane3p', '-', 'axiscyl', 'axisedge', 'axis2p', 'axis2planes', '-', 'pointv', 'pointc', 'pointxyz'] },
    { name: 'INSPECT', bar: ['measure', 'section', 'com'], menu: ['measure', 'interference', '-', 'curvature', 'zebra', '-', 'section', 'com', '-', 'properties'] },
    { name: 'INSERT', bar: ['insstep', 'insmesh', 'inssvg', 'canvas'], menu: ['insstep', '-', 'insderive', 'decal', 'canvas', '-', 'insmesh', 'inssvg', 'insdxf'] },
    { name: 'ASSEMBLE', bar: ['newcomp', 'joint'], menu: ['newcomp', '-', 'joint', 'asbuilt', 'rigid', '-', 'drive', 'motionlink', 'contact'] },
    { name: 'SELECT', bar: ['select'], menu: ['select', 'window', 'filters'] },
  ],
  SURFACE: [
    { name: 'CREATE', bar: ['sketch', 's.extrude', 's.patch', 's.offset', 's.loft'], menu: ['sketch', '-', 's.extrude', 's.revolve', 's.sweep', 's.loft', 's.patch', 's.offset', 's.ruled', '-', 's.thicken'] },
    { name: 'MODIFY', bar: ['s.trim', 's.untrim', 's.extend', 's.stitch', 's.thicken'], menu: ['s.trim', 's.untrim', 's.extend', '-', 's.stitch', 's.unstitch', 's.reverse', 's.delete', '-', 'presspull', 'fillet', 'chamfer', 'splitface', 'splitbody', 'move', 'scale'] },
    { name: 'CONSTRUCT', bar: ['offsetplane'], menu: ['offsetplane', 'planeangle', 'midplane', 'planetangent', 'plane3p', '-', 'axiscyl', 'axisedge', 'axis2p', '-', 'pointv', 'pointc'] },
    { name: 'INSPECT', bar: ['measure', 'section'], menu: ['measure', 'section', 'curvature', 'zebra'] },
    { name: 'SELECT', bar: ['select'], menu: ['select', 'window'] },
  ],
  MESH: [
    { name: 'CREATE', bar: ['m.insert', 'm.tessellate'], menu: ['m.insert', 'm.tessellate'] },
    { name: 'PREPARE', bar: ['m.facegroups', 'm.repair'], menu: ['m.facegroups', 'm.repair'] },
    { name: 'MODIFY', bar: ['m.remesh', 'm.reduce', 'm.smooth', 'm.convert'], menu: ['m.remesh', 'm.reduce', 'm.smooth', 'm.planecut', '-', 'm.convert'] },
    { name: 'INSPECT', bar: ['measure', 'section'], menu: ['measure', 'section', 'properties'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
    { name: 'EXPORT', bar: ['exportstl'], menu: ['exportstl'] },
  ],
  'SHEET METAL': [
    { name: 'CREATE', bar: ['sketch', 'sm.flange', 'sm.contour', 'extrude'], menu: ['sketch', 'sm.flange', 'sm.contour', '-', 'extrude', 'hole', 'patrect', 'patcirc', 'mirror'] },
    { name: 'MODIFY', bar: ['sm.unfold', 'sm.refold', 'sm.flat', 'sm.rules'], menu: ['sm.unfold', 'sm.refold', 'sm.flat', '-', 'presspull', 'fillet', 'chamfer', 'splitbody', 'move', '-', 'sm.rules'] },
    { name: 'CONSTRUCT', bar: ['offsetplane'], menu: ['offsetplane'] },
    { name: 'INSPECT', bar: ['measure'], menu: ['measure', 'section'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
  ],
  PLASTIC: [
    { name: 'SETUP', bar: ['pl.rules'], menu: ['pl.rules'] },
    { name: 'CREATE', bar: ['sketch', 'extrude', 'pl.boss', 'pl.snap', 'pl.lip', 'pl.rib'], menu: ['sketch', 'extrude', 'revolve', 'box', '-', 'pl.boss', 'pl.snap', 'pl.lip', 'pl.rest', 'pl.rib', 'pl.web', '-', 'hole', 'thread', 'emboss'] },
    { name: 'MODIFY', bar: ['fillet', 'shell', 'draft'], menu: ['presspull', 'fillet', 'chamfer', 'shell', 'draft', '-', 'splitbody', 'splitface', 'combine', 'move'] },
    { name: 'INSPECT', bar: ['measure', 'section'], menu: ['measure', 'section'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
  ],
  MANAGE: [{ name: 'BOM', bar: ['bom'], menu: ['bom', 'properties'] }],
  UTILITIES: [
    { name: 'MAKE', bar: ['make3d'], menu: ['make3d', 'exportstl'] },
    { name: 'NEST', bar: ['nest'], menu: ['nest'] },
    { name: 'ADD-INS', bar: ['addins'], menu: ['addins'] },
    { name: 'UTILITY', bar: ['taskmgr', 'params'], menu: ['taskmgr', 'params'] },
    { name: 'INSPECT', bar: ['measure', 'section', 'com', 'co2'], menu: ['measure', 'section', 'com', 'properties', 'co2'] },
    { name: 'CREATE PMI', bar: ['pmi'], menu: ['pmi'] },
    { name: 'SELECT', bar: ['select'], menu: ['select'] },
  ],
  SKETCH: [
    { name: 'CREATE', bar: ['k.line', 'k.rect2', 'k.circle', 'k.arc', 'k.polygon', 'k.slot', 'k.dimension'], menu: ['k.line', { sub: 'Rectangle', icon: 'rect2', items: ['k.rect2', 'k.rectc'] }, 'k.circle', 'k.arc', 'k.polygon', 'k.slot', 'k.spline', '-', 'k.point', 'k.text', 'k.mirror', 'k.cpattern', 'k.project', '-', 'k.dimension'] },
    { name: 'MODIFY', bar: ['k.construction', 'k.fillet', 'k.trim', 'k.offset', 'k.delete'], menu: ['k.construction', '-', 'k.fillet', 'k.trim', 'k.extend', 'k.offset', '-', 'k.move', 'k.delete'] },
    { name: 'CONSTRAINTS', bar: ['k.c.horizontal', 'k.c.coincident', 'k.c.tangent', 'k.c.equal', 'k.c.parallel', 'k.c.perpendicular', 'k.c.fix'], menu: ['k.c.horizontal', 'k.c.coincident', 'k.c.collinear', 'k.c.tangent', 'k.c.equal', 'k.c.parallel', 'k.c.perpendicular', 'k.c.fix', 'k.c.concentric', 'k.c.midpoint', 'k.c.symmetry'] },
    { name: 'INSPECT', bar: ['measure'], menu: ['measure', 'section'] },
    { name: 'SELECT', bar: ['k.select'], menu: ['k.select'] },
    { name: 'FINISH SKETCH', bar: ['k.finish'], menu: ['k.finish'], finish: true },
  ],
};
const WORKSPACES = [['Design', null], ['Generative Design', P5], ['Render', P2], ['Animation', P2], ['Simulation', null], ['Manufacture', null], ['Drawing', null]];

function runCmd(id) {
  const c = CMD[id]; if (!c) return;
  closeMenus();
  if (!c.run) { toast(`${c.label} is planned for ${c.phase}${c.note ? '. ' + c.note : ''}`); return; }
  if (mode === 'sketch' && !id.startsWith('k.') && !['measure', 'section', 'com', 'params', 'properties', 'bom', 'exportstl', 'make3d', 'select'].includes(id)) finishSketch(true);
  c.run();
}
function tip(c) { return c.label + (c.key ? ` (${c.key})` : '') + (c.phase ? ` · planned, ${c.phase}` : ''); }

function renderRibbon() {
  const tabs = $('#rtabs'); tabs.replaceChildren();
  const names = workspace === 'drawing' ? ['DRAWING'] : workspace === 'manufacture' ? ['MILLING', 'ADDITIVE'] : workspace === 'simulation' ? ['STATIC STRESS'] : Object.keys(TABS).filter(t => !['SKETCH', 'DRAWING', 'MILLING', 'ADDITIVE', 'STATIC STRESS'].includes(t));
  if (mode === 'sketch' && workspace !== 'drawing') names.push('SKETCH');
  if (mode !== 'sketch' && activeTab === 'SKETCH') activeTab = 'SOLID';
  if (!names.includes(activeTab)) activeTab = names[0];
  for (const t of names) {
    tabs.append(h('button', { class: 'rtab' + (t === 'SKETCH' ? ' ctx' : ''), role: 'tab', 'aria-selected': String(activeTab === t), onclick: () => { activeTab = t; renderRibbon(); if (workspace === 'manufacture') { drawCam(); drawPrint(); renderBrowser(); defaultHint(); } } }, t));
  }
  const groups = $('#rgroups'); groups.replaceChildren();
  for (const g of TABS[activeTab]) {
    const bar = h('div', { class: 'rbar' });
    for (const id of g.bar) {
      const c = CMD[id];
      const pressed = (workspace === 'drawing' && ((id === 'dw.dim' && dwTool === 'dim') || (id === 'dw.dia' && dwTool === 'dia') || (id === 'dw.rad' && dwTool === 'rad') || (id === 'dw.ang' && dwTool === 'ang') || (id === 'dw.section' && dwTool === 'section') || (id === 'dw.detail' && dwTool === 'detail') || (id === 'dw.balloon' && dwTool === 'balloon') || (id === 'dw.note' && dwTool === 'note') || (id.startsWith('dw.view.') && dwTool === 'place:' + id.slice(8)))) || (mode === 'sketch' && id === 'k.' + sketchTool) || (id === 'k.select' && sketchTool === 'select' && mode === 'sketch') || (id === 'measure' && measure) || (id === 'section' && section) || (id === 'com' && showCOM) || (id === 'zebra' && zebraOn) || (id === 'curvature' && combMode) || (id === 'contact' && !!doc.contact?.on);
      if (g.finish) bar.append(h('button', { class: 'rbtn finish', title: tip(c), 'aria-label': c.label, onclick: () => runCmd(id), html: icon(c.icon) + '<span>' + c.label.toUpperCase() + '</span>' }));
      else bar.append(h('button', { class: 'rbtn' + (c.phase ? ' planned' : ''), title: tip(c), 'aria-label': tip(c), 'aria-pressed': pressed ? 'true' : null, onclick: () => runCmd(id), html: icon(c.icon) }));
    }
    const lab = h('button', { class: 'rlabel', 'aria-haspopup': 'true', html: g.name + icon('caret') });
    lab.addEventListener('click', e => { e.stopPropagation(); openMenu(lab, g.menu); });
    groups.append(h('div', { class: 'rgroup', role: 'group', 'aria-label': g.name }, bar, g.finish ? h('span', { class: 'rlabel', style: 'pointer-events:none' }, '') : lab));
  }
}

// dropdown menus
function closeMenus() { $('#menus').replaceChildren(); document.querySelectorAll('[aria-expanded="true"][aria-haspopup]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
function menuItem(it, level) {
  if (it === '-') return h('div', { class: 'msep' });
  if (typeof it === 'string') return cmdItem(it);
  if (it.head) return h('div', { class: 'mhead' }, it.head);
  if (it.sub) {
    const b = h('button', { class: 'mi', html: icon(it.icon) + `<span class="lab">${it.sub}</span>` + icon('chevron') });
    const open = () => { document.querySelectorAll('.menu[data-level="' + (level + 1) + '"]').forEach(m => m.remove()); document.querySelectorAll('.mi.open').forEach(x => x.classList.remove('open')); b.classList.add('open'); openMenu(b, it.items, { side: true, level: level + 1 }); };
    b.addEventListener('mouseenter', open); b.addEventListener('click', e => { e.stopPropagation(); open(); });
    return b;
  }
  if (it.action) {
    return h('button', { class: 'mi' + (it.phase ? ' planned' : ''), role: 'menuitemcheckbox', 'aria-checked': it.checked != null ? String(it.checked) : null, onclick: e => { e.stopPropagation(); closeMenus(); it.action(); },
      html: icon(it.icon || 'generic') + `<span class="lab">${it.label}</span>` + (it.phase ? `<span class="tag">${it.phase}</span>` : it.key ? `<span class="key">${it.key}</span>` : '<span></span>') });
  }
  return null;
}
function cmdItem(it) {
  const c = CMD[it]; if (!c) return null;
  return h('button', { class: 'mi' + (c.phase ? ' planned' : ''), onclick: e => { e.stopPropagation(); runCmd(it); }, title: c.note || null,
    html: icon(c.icon) + `<span class="lab">${c.label}</span>` + (c.phase ? `<span class="tag">${c.phase}</span>` : c.key ? `<span class="key">${c.key}</span>` : '<span></span>') });
}
function openMenu(anchor, items, o = {}) {
  const level = o.level || 0;
  if (!o.side) closeMenus();
  const m = h('div', { class: 'menu', role: 'menu', 'data-level': String(level) });
  items.forEach(it => { const el = menuItem(it, level); if (el) m.append(el); });
  $('#menus').append(m);
  const r = anchor.getBoundingClientRect();
  let x = o.side ? r.right + 2 : r.left, y = o.side ? r.top - 4 : r.bottom + 2;
  if (o.at) { x = o.at.x; y = o.at.y; }
  x = Math.max(6, Math.min(x, window.innerWidth - m.offsetWidth - 6));
  if (o.side && r.right + m.offsetWidth > window.innerWidth) x = Math.max(6, r.left - m.offsetWidth - 2);
  y = Math.max(6, Math.min(y, window.innerHeight - m.offsetHeight - 6));
  m.style.left = x + 'px'; m.style.top = y + 'px';
  if (!o.side && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');
  return m;
}
document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu') && !e.target.closest('[aria-haspopup]')) closeMenus(); });

function openWorkspaceMenu() {
  openMenu($('#wsBtn'), [{ head: 'Workspaces' }, ...WORKSPACES.map(([n, ph]) => ({ label: n.toUpperCase(), icon: n === 'Design' ? 'doc' : n === 'Simulation' ? 'analysis' : n === 'Manufacture' ? 'make' : n === 'Drawing' ? 'properties' : n === 'Animation' ? 'motion' : n === 'Render' ? 'appearance' : 'form', phase: ph, checked: (n === 'Design' && workspace === 'design') || (n === 'Drawing' && workspace === 'drawing') || (n === 'Manufacture' && workspace === 'manufacture') || (n === 'Simulation' && workspace === 'simulation') ? true : null, action: () => { const leave = () => { if (workspace === 'drawing') exitDrawing(); if (workspace === 'manufacture') exitManufacture(); if (workspace === 'simulation') exitSimulation(); }; if (ph) toast(`The ${n} workspace is planned for ${ph}`); else if (n === 'Drawing') { if (workspace !== 'drawing') { leave(); enterDrawing(); } } else if (n === 'Manufacture') { if (workspace !== 'manufacture') { leave(); enterManufacture(); } } else if (n === 'Simulation') { if (workspace !== 'simulation') { leave(); enterSimulation(); } } else if (n === 'Design') leave(); } }))]);
}
function openFileMenu() {
  openMenu($('#abFile'), [
    { label: 'New design', icon: 'doc', action: () => loadDoc(blankDoc(), 'New design. Undo brings the previous one back.') },
    { label: 'Open sample: bearing bracket', icon: 'bodyi', action: () => loadDoc(sampleDoc(), 'Sample bracket opened') },
    '-',
    { label: 'Open project (.json)…', icon: 'file', action: () => $('#fileInput').click() },
    { label: 'Save project (.json)', icon: 'save', key: 'Ctrl S', action: () => saveProject() },
    { label: 'Import STEP…', icon: 'insertmesh', action: () => startImportSTEP() },
    { label: 'Export STEP / STL (.zip)…', icon: 'exportstl', action: () => openExportDialog() },
    '-',
    { label: 'Keyboard shortcuts and roadmap', icon: 'help', action: () => openHelpModal() },
  ]);
}
