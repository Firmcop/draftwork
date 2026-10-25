// A small three.js viewer for the preview meshes: Z up like Draftwork, orbit, fit on the first model.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '3D preview of the configured part');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
  camera.up.set(0, 0, 1);
  camera.position.set(300, -400, 260);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a929c, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, -1.4, 2); scene.add(sun);
  const back = new THREE.DirectionalLight(0xffffff, 0.5); back.position.set(-1, 1.2, -0.5); scene.add(back);
  const group = new THREE.Group(); scene.add(group);
  const material = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, metalness: 0.35, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x2b3138, transparent: true, opacity: 0.55 });
  let fitted = false, moved = false, frame = 0;
  controls.addEventListener('start', () => { moved = true; });   // once someone turns the view, keep their view

  const bg = () => { const c = getComputedStyle(host).backgroundColor; renderer.setClearColor(new THREE.Color(c && c !== 'rgba(0, 0, 0, 0)' ? c : '#e9ecf0')); };
  const resize = () => { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); if (fitted && !moved) fit(); };
  new ResizeObserver(resize).observe(host); resize(); bg();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bg);
  const loop = () => { frame = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();

  function fit() {
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const v = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);   // narrow screens: the width decides
    const r = size.length() / 2, dist = r / Math.sin(Math.min(v, hfov) / 2) * 1.05;
    const dir = new THREE.Vector3(0.62, -0.95, 0.72).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
    controls.target.copy(center); controls.update();
  }

  function show(meshes) {
    for (const o of [...group.children]) { o.geometry.dispose(); group.remove(o); }
    for (const m of meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      group.add(new THREE.Mesh(g, material));
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), edgeMat));
    }
    if (!fitted && meshes.length) { fit(); fitted = true; }
    host.dataset.triangles = String(meshes.reduce((s, m) => s + m.idx.length / 3, 0));
  }
  return { show, fit, dispose: () => { cancelAnimationFrame(frame); renderer.dispose(); } };
}
