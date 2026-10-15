// Loads src/kernel.js + src/brep.js as one module for Node tests (they share globals in the browser bundle).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = p => pathToFileURL(path.join(root, 'node_modules', p)).href;

export async function loadKernels({ exact = false } = {}) {
  const strip = s => s.split('\n').filter(l => !/^import /.test(l)).map(l => l.replace(/^export /, '')).join('\n');
  const code = `import * as THREE from '${nm('three/build/three.module.js')}';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from '${nm('three-bvh-csg/build/index.module.js')}';
import * as RCmod from '${nm('replicad/dist/replicad.js')}';
${strip(fs.readFileSync(path.join(root, 'src/font.js'), 'utf8'))}
${strip(fs.readFileSync(path.join(root, 'src/solver.js'), 'utf8'))}
${strip(fs.readFileSync(path.join(root, 'src/kernel.js'), 'utf8'))}
${strip(fs.readFileSync(path.join(root, 'src/brep.js'), 'utf8'))}
${strip(fs.readFileSync(path.join(root, 'src/brepsurf.js'), 'utf8'))}
${strip(fs.readFileSync(path.join(root, 'src/brepsheet.js'), 'utf8'))}
${strip(fs.readFileSync(path.join(root, 'src/brepplastic.js'), 'utf8'))}
export function setOC(oc) { RCmod.setOC(oc); RC = RCmod; }
export { sheetFlatData, regenerate, regenerateBrep, resolveFeatures, evalParams, evalExpr, signedVolume, brepProps, brepMeshOf, brepSigMap, brepCollect, brepSTEP, brepImportSTEP, frameFromPoint, toBinarySTL, makeZip, solveSketch, analyzeSketch, applySolved, geoProfiles, geoPaths, geoRegions, pickRegions, curveSplits, arrCurves, extendTarget, splineBeziers, bezPoint, splineFull, splineSpans, splineClosest, splineAt };
export const THREEns = THREE;`;
  // three-bvh-csg imports bare 'three' / 'three-mesh-bvh'; Node resolves them from node_modules next to the file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftwork-test-'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const file = path.join(dir, 'kernels.mjs');
  fs.writeFileSync(file, code);
  const K = await import(pathToFileURL(file).href);
  if (exact) {
    const { default: opencascade } = await import(nm('replicad-opencascadejs/dist/replicad_single.js'));
    const wasmBinary = fs.readFileSync(path.join(root, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm'));
    K.setOC(await opencascade({ wasmBinary }));
  }
  return K;
}

// The sample document lives in src/core.js; extract it so tests use exactly what users see.
export function sampleDoc() {
  const src = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
  const body = src.slice(src.indexOf('function sampleDoc()'), src.indexOf('const blankDoc'));
  const uid = () => Math.random().toString(36).slice(2, 9); // used inside sampleDoc
  return (0, eval)('(' + body.replace('function sampleDoc()', 'function (uid)') + ')')(uid);
}
export { zlib };
