// ---------- 20 ft shipping container: reference model ----------
// ISO 1AA-like external size 6058 × 2438 × 2591 mm. X along the length (doors at +X), Y across, Z up.
// Every part is its own component; posts and rails are marked as structure so openings warn when they run into them.
function containerFeatures(o = {}) {
  const L = o.length || 6058, W = o.width || 2438, H = o.height || 2591;
  const t = 2, cd = 36, pitch = 278, post = 150, bsr = 160, tsr = 100, er = 60, floorT = 28;
  const z0 = bsr, z1 = H - tsr, wallH = z1 - z0;
  const F = [];
  const box = (id, name, cx, cy, z, w, d, h, role) => F.push({ id, type: 'box', name, plane: 'XY', offset: z, flip: false, cx, cy, w, d, h, op: 'newcomp', ...(role ? { role } : {}) });
  // trapezoidal corrugation along a straight run: outer face on `outer`, ridges outward, valleys `cd` inward; 2 mm sheet
  const wave = (a, b) => {
    const len = b - a, n = Math.floor(len / pitch), lead = (len - n * pitch) / 2, pts = [[a, 0], [a + lead, 0]];
    const seg = [72, 67, 72, 67];
    for (let k = 0; k < n; k++) { let x = a + lead + k * pitch; pts.push([x + seg[0], 0]); x += seg[0]; pts.push([x + seg[1], cd]); x += seg[1]; pts.push([x + seg[2], cd]); x += seg[2]; pts.push([x + seg[3], 0]); }
    pts.push([b, 0]);
    return pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 1e-9 || Math.abs(p[1] - pts[i - 1][1]) > 1e-9);
  };
  // closed outline of the sheet: outer line along the wave, back along the wave offset by the thickness
  const sheet = (pts, map) => {
    const outer = pts.map(([s, d]) => map(s, d)), inner = pts.slice().reverse().map(([s, d]) => map(s, d + t));
    const ring = [...outer, ...inner];
    return { kind: 'loop', segs: ring.map((p, i) => ({ t: 'line', a: p, b: ring[(i + 1) % ring.length] })) };
  };
  const sketch = (id, name, profile) => F.push({ id, type: 'sketch', name, plane: 'XY', offset: z0, flip: false, profiles: [profile] });
  const wall = (id, name, sk) => F.push({ id, type: 'extrude', name, sketch: sk, distance: wallH, direction: 'one', op: 'newcomp' });
  // side walls between the corner posts (left at +Y, right at −Y), rear end wall at −X
  const xs = wave(-L / 2 + post, L / 2 - post), ys = wave(-W / 2 + post, W / 2 - post);
  sketch('ct_skL', 'Left wall profile', sheet(xs, (s, d) => [s, W / 2 - d]));
  wall('ct_wallL', 'Left side wall', 'ct_skL');
  sketch('ct_skR', 'Right wall profile', sheet(xs, (s, d) => [s, -W / 2 + d]));
  wall('ct_wallR', 'Right side wall', 'ct_skR');
  sketch('ct_skE', 'Rear wall profile', sheet(ys, (s, d) => [-L / 2 + d, s]));
  wall('ct_wallE', 'Rear end wall', 'ct_skE');
  // front: two door leaves between the posts
  const dw = (W - 2 * post) / 2;
  box('ct_doorL', 'Door leaf left', L / 2 - 20, dw / 2, z0, 40, dw, wallH);
  box('ct_doorR', 'Door leaf right', L / 2 - 20, -dw / 2, z0, 40, dw, wallH);
  // corner posts
  for (const [sx, sy, nm] of [[1, 1, 'front left'], [1, -1, 'front right'], [-1, 1, 'rear left'], [-1, -1, 'rear right']])
    box('ct_post' + (sx > 0 ? 'F' : 'R') + (sy > 0 ? 'L' : 'R'), 'Corner post ' + nm, sx * (L / 2 - post / 2), sy * (W / 2 - post / 2), 0, post, post, H, 'structure');
  // rails: bottom and top, sides and ends
  for (const [sy, nm] of [[1, 'left'], [-1, 'right']]) {
    box('ct_bsr' + nm[0].toUpperCase(), 'Bottom side rail ' + nm, 0, sy * (W / 2 - 25), 0, L - 2 * post, 50, bsr, 'structure');
    box('ct_tsr' + nm[0].toUpperCase(), 'Top side rail ' + nm, 0, sy * (W / 2 - 30), z1, L - 2 * post, 60, tsr, 'structure');
  }
  for (const [sx, nm] of [[1, 'front'], [-1, 'rear']]) {
    box('ct_ber' + nm[0].toUpperCase(), 'Bottom end rail ' + nm, sx * (L / 2 - er / 2), 0, 0, er, W - 2 * post, bsr, 'structure');
    box('ct_ter' + nm[0].toUpperCase(), 'Top end rail ' + nm, sx * (L / 2 - er / 2), 0, z1, er, W - 2 * post, tsr, 'structure');
  }
  // floor between the rails, roof sheet on top
  box('ct_floor', 'Floor', 0, 0, bsr - floorT, L - 2 * er, W - 2 * 50, floorT);
  box('ct_roof', 'Roof', 0, 0, H - t, L - 2 * post, W - 2 * 60, t);
  return F;
}
