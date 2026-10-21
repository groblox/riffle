// A small cozy campsite the visitor can pitch on any flat, dry spot: dome tent, two camp chairs,
// a stone fire ring with a live fire, a folding table with lantern and mug, and a woodpile.
// One camp at a time; pitching again moves it. Built procedurally, a handful of draw calls per piece.
// Level campsites along the trail are marked while choosing a spot, and the camp snaps onto them.
// Sit in a chair or inside the tent: you stay put and can look around (Esc to get up).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, commonGLSL, patchMaterial } from '../core/env.js';
import { groundAt, waterLevel, normalAt, WORLD, CAMPSITES } from './shape.js';
import { RNG, clamp, smoothstep, lerp } from '../noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);

// ---------- geometry helpers: every part carries position/normal/uv/color so a set merges into one draw ----------
function finish(geo, col, heat) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  const c = new Float32Array(p.count * 3);
  const pv = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    pv.fromBufferAttribute(p, i); nv.fromBufferAttribute(n, i);
    const v = typeof col === 'function' ? col(pv, nv, i) : col;
    c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (heat !== undefined && !geo.attributes.aHeat) {
    const h = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { pv.fromBufferAttribute(p, i); h[i] = typeof heat === 'function' ? heat(pv) : heat; }
    geo.setAttribute('aHeat', new THREE.BufferAttribute(h, 1));
  }
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color', 'aHeat'].includes(k)) geo.deleteAttribute(k);
  return geo.index ? geo.toNonIndexed() : geo;
}
function merge(list) { const g = mergeGeometries(list, false); g.computeBoundingSphere(); return g; }

function rod(a, b, r, col, seg = 8, r1 = r) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r, d.length(), seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
  return finish(g, col);
}
function tube(pts, r, col, seg = 6, n = 0) {
  return finish(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n || pts.length * 4, r, seg, false), col);
}
// parametric sheet (u, v in 0..1); skip(u, v) drops cells (door openings)
function sheet(nu, nv, fn, col, skip, heat) {
  const pos = [], uv = [], idx = [], hv = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv); pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
    if (typeof heat === 'function' && heat.length === 2) hv.push(heat(i / nu, j / nv));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (skip && skip((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // a heat function of (u, v) is sampled per grid vertex rather than per position
  if (hv.length) { g.setAttribute('aHeat', new THREE.Float32BufferAttribute(hv, 1)); heat = undefined; }
  return finish(g, typeof col === 'function' ? (p, n, k) => col(p, n, uv[k * 2], uv[k * 2 + 1]) : col, heat);
}
function box(sx, sy, sz, x, y, z, col, ry = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return finish(g, col);
}
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// ---------- the tent: two-pole dome with rainfly, D door (open, flap rolled up), guy lines ----------
function buildTent() {
  const A = 1.1, B = 0.76, H = 1.12, N = 3;
  const se = (c) => Math.sign(c) * Math.pow(Math.abs(c), 2 / N);
  const sagAt = (th) => 0.5 + 0.5 * Math.cos(4 * th);   // 0 along the pole diagonals, 1 midway between them
  // a point on the shell: th around the footprint (front = +z at PI/2), t from apex (0) to ground (1)
  const P = (th, t, inf = 0) => {
    const sag = sagAt(th);
    const k = t * (1 - 0.07 * sag * Math.sin(Math.PI * t));
    const h = H * Math.pow(Math.max(0, 1 - Math.pow(t, 2.3)), 0.55) * (1 - 0.06 * sag * t);
    return V(se(Math.cos(th)) * A * k * (1 + inf), h + inf * H * (1 - t * 0.4), se(Math.sin(th)) * B * k * (1 + inf));
  };
  const DOOR = Math.PI / 2, DW = 0.52, DH = 0.86 * H;
  // how far inside the door opening a point is (> 0 inside): straight sides, an elliptical arch on top.
  // The body is cut along its zero line per pixel, so the edge stays a smooth curve however close you look.
  const doorIn = (th, y) => {
    let d = th - DOOR; d = Math.atan2(Math.sin(d), Math.cos(d));
    const dx = d / DW, dy = y / DH;
    const wall = dy < 0.45 ? 1 - Math.abs(dx) : 1 - Math.hypot(dx, (dy - 0.45) / 0.55);
    return Math.min(wall * 0.5, (dy - 0.05) * 1.2);
  };
  const diag = (th) => { const d = fract((th - Math.PI / 4) / (Math.PI / 2)); return Math.min(d, 1 - d) * (Math.PI / 2); };
  const BODY = [0.72, 0.62, 0.43], FLY = [0.5, 0.19, 0.1], TUB = [0.17, 0.18, 0.2];
  const cloth = [], frame = [];
  // inner tent body
  // fine enough that the door's cut edge stays smooth seen from inside
  cloth.push(sheet(256, 72, (u, v) => P(u * TAU, v), (p, n, u, v) => {
    const th = u * TAU;
    let c = BODY;
    if (diag(th) < 0.035) c = mul3(c, 0.8);                           // pole sleeves
    c = mix3(c, TUB, smoothstep(0.9, 0.95, v));                        // bathtub floor walls
    c = mix3(c, mul3(BODY, 0.8), smoothstep(-0.04, -0.012, doorIn(th, P(th, v).y))); // the zip's binding round the door
    return mul3(c, 0.95 + 0.05 * Math.sin(th * 37) * Math.sin(v * 29));
  }, (u, v) => doorIn(u * TAU, P(u * TAU, v).y) > 0.035, (u, v) => doorIn(u * TAU, P(u * TAU, v).y)));
  // rainfly: down to the pegged corners, scalloped between them, short over the door
  const tmax = (th) => (0.62 + 0.3 * (1 - sagAt(th)) ** 2) * (1 - 0.32 * Math.exp(-(((th - DOOR) / 0.45) ** 2)));
  cloth.push(sheet(96, 14, (u, v) => P(u * TAU, v * tmax(u * TAU), 0.035), (p, n, u, v) => {
    let c = FLY;
    if (diag(u * TAU) < 0.03) c = mul3(c, 0.78);
    c = mul3(c, 1 - 0.25 * smoothstep(0.88, 1, v));
    return mul3(c, 0.94 + 0.06 * Math.sin(u * 211) * Math.sin(v * 17));
  }));
  // door flap rolled up along the top of the arch
  const tAt = (th, y) => { let a = 0, b = 1; for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if (P(th, m).y > y) a = m; else b = m; } return (a + b) / 2; };
  const roll = [];
  for (let i = 0; i <= 14; i++) {
    const s = -0.92 + 1.84 * i / 14, th = DOOR + s * DW;
    const y = (0.45 + 0.55 * Math.sqrt(Math.max(0, 1 - s * s))) * DH;
    roll.push(P(th, tAt(th, y), 0.03).add(V(0, 0.025, 0)));
  }
  cloth.push(tube(roll, 0.032, mul3(BODY, 0.82), 8, 40));
  // floor and two sleeping bags, glimpsed through the door
  cloth.push(sheet(48, 3, (u, v) => { const p = P(u * TAU, 0.985); return V(p.x * v, 0.012, p.z * v); }, [0.14, 0.15, 0.17]));
  for (const [z, col] of [[-0.2, [0.08, 0.27, 0.3]], [0.22, [0.62, 0.42, 0.12]]]) {
    const g = new THREE.CapsuleGeometry(0.17, 1.15, 4, 12); g.rotateZ(Math.PI / 2); g.scale(1, 0.42, 1); g.translate(0.08, 0.075, z);
    cloth.push(finish(g, (p) => mul3(col, 0.85 + 0.15 * Math.sin(p.x * 30))));
  }
  cloth.push(box(0.16, 0.07, 0.3, -0.78, 0.05, -0.05, [0.78, 0.74, 0.66]));
  // poles over the fly, crossing at the apex
  const POLE = [0.5, 0.52, 0.55];
  for (const th0 of [Math.PI / 4, 3 * Math.PI / 4]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) pts.push(P(th0, 1 - i / 12, 0.05));
    for (let i = 1; i <= 12; i++) pts.push(P(th0 + Math.PI, i / 12, 0.05));
    pts[0].y = pts[pts.length - 1].y = 0.015;
    frame.push(tube(pts, 0.0075, POLE, 6, 80));
  }
  // guy lines & stakes
  const stake = (g, dir) => frame.push(rod(g.clone().add(V(0, -0.03, 0)), g.clone().add(V(-dir.x * 0.03, 0.07, -dir.z * 0.03)), 0.005, [0.75, 0.32, 0.08], 5));
  for (const th of [0, Math.PI, 1.5 * Math.PI]) {
    const top = P(th, 0.6, 0.036);
    const base = P(th, 1, 0); const dir = V(base.x, 0, base.z).normalize();
    const g = V(base.x * 1.55, 0.0, base.z * 1.55);
    frame.push(rod(top, g.clone().add(V(0, 0.05, 0)), 0.0022, [0.86, 0.82, 0.68], 4));
    stake(g, dir);
  }
  for (const th of [0.25, 0.75, 1.25, 1.75].map((k) => k * Math.PI)) {
    const base = P(th, 1, 0); const dir = V(base.x, 0, base.z).normalize();
    stake(V(base.x * 1.07, 0, base.z * 1.07), dir);
  }
  // everything else in the cloth draw is solid (only the body has a door cut in it)
  for (const g of cloth) if (!g.attributes.aHeat) g.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(-1), 1));
  return { cloth: merge(cloth), frame: merge(frame), H, A, B };
}

// ---------- folding quad chair (seat faces +z); a plaid blanket over one of them ----------
function buildChair(canvas, blanket) {
  const F = [0.09, 0.09, 0.1], R = 0.011;
  const fr = [], cl = [];
  const canvasCol = (p, n, u, v) => mul3(canvas, (u < 0.06 || u > 0.94 || v > 0.94 ? 0.7 : 1) * (0.93 + 0.07 * Math.sin(u * 60) * Math.sin(v * 41)));
  for (const s of [-1, 1]) {
    const x = 0.26 * s;
    fr.push(rod(V(x, 0, 0.23), V(x * 0.98, 0.64, 0.2), R, F, 6));            // front leg, up to the arm
    fr.push(rod(V(x, 0, -0.22), V(x * 0.98, 0.47, -0.2), R, F, 6));           // back leg
    fr.push(rod(V(x * 0.98, 0.47, -0.2), V(x * 1.02, 0.93, -0.36), R, F, 6)); // back post
    fr.push(rod(V(x, 0.03, 0.22), V(x, 0.44, -0.2), R * 0.8, F, 5));          // side cross-braces
    fr.push(rod(V(x, 0.03, -0.21), V(x, 0.44, 0.21), R * 0.8, F, 5));
    fr.push(rod(V(x * 0.98, 0.46, 0.21), V(x * 0.98, 0.46, -0.2), R, F, 6));  // seat rail
    fr.push(rod(V(x * 0.99, 0.64, 0.21), V(x, 0.66, -0.27), R, F, 6));        // arm bar
    cl.push(box(0.06, 0.018, 0.42, x, 0.668, -0.03, mul3(canvas, 0.55)));
    for (const z of [0.23, -0.22]) { const f = new THREE.CylinderGeometry(0.022, 0.025, 0.014, 8); f.translate(x, 0.007, z); fr.push(finish(f, F)); }
  }
  for (const z of [0.22, -0.21]) {
    fr.push(rod(V(-0.26, 0.03, z), V(0.26, 0.44, z), R * 0.8, F, 5));
    fr.push(rod(V(0.26, 0.03, z), V(-0.26, 0.44, z), R * 0.8, F, 5));
  }
  // slung seat and back
  cl.push(sheet(12, 10, (u, v) => V(lerp(-0.25, 0.25, u), 0.462 - 0.055 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), lerp(0.21, -0.2, v)), canvasCol));
  cl.push(sheet(12, 10, (u, v) => {
    const y = lerp(0.5, 0.9, v);
    return V(lerp(-0.255, 0.255, u), y, -0.21 - 0.14 * (y - 0.47) / 0.46 - 0.035 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
  }, canvasCol));
  // cup holder on the right arm
  const cup = new THREE.CylinderGeometry(0.042, 0.036, 0.07, 12, 1, true); cup.translate(0.335, 0.635, 0.13);
  cl.push(finish(cup, mul3(canvas, 0.5)));
  fr.push(rod(V(0.27, 0.64, 0.13), V(0.3, 0.64, 0.13), 0.006, F, 4));
  if (blanket) {
    const path = new THREE.CatmullRomCurve3([V(0, 0.6, -0.232), V(0, 0.82, -0.288), V(0, 0.94, -0.345), V(0, 0.975, -0.39), V(0, 0.9, -0.435), V(0, 0.72, -0.462), V(0, 0.5, -0.482)]);
    const red = [0.5, 0.09, 0.07], green = [0.05, 0.11, 0.07];
    cl.push(sheet(40, 48, (u, v) => {
      const p = path.getPoint(v), e = Math.abs(u - 0.5) * 2;
      return V(lerp(-0.3, 0.3, u), p.y - 0.07 * e * e * smoothstep(0.3, 0.5, Math.abs(v - 0.45) + 0.2), p.z + 0.012 * Math.sin(u * 20 + v * 4) * smoothstep(0.35, 0.9, v));
    }, (p, n, u, v) => {
      let c = red;
      if (fract(u * 5) < 0.3) c = mix3(c, green, 0.65);
      if (fract(v * 6) < 0.3) c = mix3(c, green, 0.65);
      return mul3(c, v > 0.97 || v < 0.03 ? 0.8 : 1);
    }));
  }
  return { frame: merge(fr), cloth: merge(cl) };
}

// ---------- folding table: roll-up slat top, X legs; lantern, enamel mug, pot ----------
function buildTable() {
  const AL = [0.6, 0.61, 0.63], fr = [], wood = [], ware = [];
  for (let i = 0; i < 7; i++) {
    const t = 0.66 + 0.08 * Math.sin(i * 3.1);
    wood.push(box(0.64, 0.014, 0.052, 0, 0.472, -0.18 + i * 0.06, [0.72 * t, 0.53 * t, 0.32 * t]));
  }
  for (const z of [-0.2, 0.2]) fr.push(rod(V(-0.31, 0.458, z), V(0.31, 0.458, z), 0.009, AL, 6));
  for (const x of [-0.28, 0.28]) {
    fr.push(rod(V(x, 0, -0.19), V(x, 0.455, 0.19), 0.01, AL, 6));
    fr.push(rod(V(x, 0, 0.19), V(x, 0.455, -0.19), 0.01, AL, 6));
  }
  fr.push(rod(V(-0.28, 0.228, 0), V(0.28, 0.228, 0), 0.008, AL, 6));
  const top = 0.479;
  // lantern (glass is its own glowing mesh)
  const LG = [0.08, 0.2, 0.12];
  let g = new THREE.CylinderGeometry(0.052, 0.056, 0.035, 16); g.translate(-0.17, top + 0.0175, 0.02); ware.push(finish(g, LG));
  g = new THREE.ConeGeometry(0.06, 0.045, 16); g.translate(-0.17, top + 0.16, 0.02); ware.push(finish(g, LG));
  for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; fr.push(rod(V(-0.17 + Math.cos(a) * 0.046, top + 0.035, 0.02 + Math.sin(a) * 0.046), V(-0.17 + Math.cos(a) * 0.046, top + 0.14, 0.02 + Math.sin(a) * 0.046), 0.0035, [0.12, 0.12, 0.12], 4)); }
  g = new THREE.TorusGeometry(0.045, 0.004, 6, 16, Math.PI); g.translate(-0.17, top + 0.18, 0.02); fr.push(finish(g, [0.15, 0.15, 0.15]));
  const glass = new THREE.CylinderGeometry(0.04, 0.04, 0.105, 16); glass.translate(-0.17, top + 0.088, 0.02);
  // speckled blue enamel mug with a black rim (and coffee in it)
  const ENAMEL = [0.12, 0.26, 0.5];
  g = new THREE.CylinderGeometry(0.04, 0.037, 0.085, 18); g.translate(0.12, top + 0.0425, 0.1);
  ware.push(finish(g, (p, n) => n.y > 0.9 ? [0.1, 0.055, 0.03] : p.y > top + 0.078 ? [0.05, 0.05, 0.05] : fract(Math.sin(p.x * 913 + p.y * 1771 + p.z * 517) * 4373) > 0.86 ? [0.85, 0.86, 0.88] : ENAMEL));
  g = new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI * 1.2); g.rotateZ(-Math.PI * 0.6); g.translate(0.162, top + 0.045, 0.1); ware.push(finish(g, ENAMEL));
  // blackened pot with a lid
  g = new THREE.CylinderGeometry(0.07, 0.066, 0.075, 18); g.translate(0.13, top + 0.0375, -0.11); ware.push(finish(g, (p, n) => n.y > 0.9 ? [0.3, 0.3, 0.31] : [0.07, 0.07, 0.075]));
  g = new THREE.SphereGeometry(0.012, 8, 6); g.translate(0.13, top + 0.085, -0.11); ware.push(finish(g, [0.1, 0.1, 0.1]));
  return { frame: merge(fr), wood: merge(wood), ware: merge(ware), glass: finish(glass, [1, 0.95, 0.85]) };
}

// ---------- split-wood pile, chopping stump and axe ----------
function buildWoodpile(rng) {
  const parts = [];
  const BARK = [0.27, 0.2, 0.14], END = [0.72, 0.56, 0.38];
  const split = (x, y, z, r, len, ry, rz) => {
    const g = new THREE.CylinderGeometry(r, r * 0.95, len, 7, 1);
    g.rotateY(rng.range(0, TAU)); g.rotateZ(Math.PI / 2 + rz); g.rotateY(ry); g.translate(x, y, z);
    const ax = V(1, 0, 0).applyAxisAngle(V(0, 0, 1), rz).applyAxisAngle(UP, ry);
    parts.push(finish(g, (p, n) => Math.abs(n.dot(ax)) > 0.9 ? mul3(END, 0.85 + 0.15 * Math.sin(p.length() * 300)) : mul3(BARK, 0.8 + 0.3 * rng.next())));
  };
  const rows = [[-0.13, 0, 0.13], [-0.065, 0.065], [0]];
  rows.forEach((row, j) => row.forEach((z) => split(rng.range(-0.03, 0.03), 0.06 + j * 0.105, z, rng.range(0.052, 0.066), rng.range(0.4, 0.46), rng.range(-0.08, 0.08), rng.range(-0.03, 0.03))));
  // stump with the axe left in it
  let g = new THREE.CylinderGeometry(0.16, 0.19, 0.32, 14, 1); g.translate(0.55, 0.15, 0.12);
  parts.push(finish(g, (p, n) => n.y > 0.9 ? mul3(END, 0.8 + 0.2 * Math.sin(Math.hypot(p.x - 0.55, p.z - 0.12) * 120)) : mul3(BARK, 0.9)));
  parts.push(rod(V(0.58, 0.33, 0.12), V(0.8, 0.66, 0.16), 0.014, [0.62, 0.44, 0.24], 6));
  g = new THREE.BoxGeometry(0.11, 0.06, 0.014); g.rotateZ(-0.98); g.translate(0.585, 0.335, 0.12);
  parts.push(finish(g, (p) => p.y < 0.32 ? [0.6, 0.6, 0.62] : [0.15, 0.15, 0.16]));
  return merge(parts);
}

// ---------- fire ring: stones, a teepee of sticks over crossed logs, a bed of coals ----------
function buildFire(rng, sandstone) {
  const stones = [], fuel = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + rng.range(-0.12, 0.12), rr = rng.range(0.44, 0.49), s = rng.range(0.85, 1.2);
    let g = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const ph = [rng.range(0, 9), rng.range(0, 9), rng.range(0, 9)];
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const d = 1 + 0.14 * Math.sin(v.x * 3.1 + ph[0]) * Math.sin(v.y * 2.7 + ph[1]) + 0.08 * Math.sin(v.z * 5.3 + ph[2] + v.x * 2);
      v.multiplyScalar(d);
      if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
      p.setXYZ(k, v.x, v.y, v.z);
    }
    g.scale(0.15 * s, 0.1 * s, 0.12 * s);
    g.rotateY(-a + rng.range(-0.3, 0.3));
    g.translate(Math.cos(a) * rr, 0.035 * s, Math.sin(a) * rr);
    g.computeVertexNormals();
    const base = sandstone && rng.chance(0.7) ? [0.56, 0.32, 0.2] : [0.42, 0.4, 0.37];
    const cx = Math.cos(a), cz = Math.sin(a), jit = rng.range(0.85, 1.1);
    stones.push(finish(g, (q, nn) => {
      const inward = -(nn.x * cx + nn.z * cz);
      const soot = smoothstep(-0.1, 0.6, inward) * smoothstep(0.0, 0.1, q.y) * 0.85;
      return mix3(mul3(base, jit * (0.85 + 0.15 * Math.sin(q.x * 90 + q.z * 70))), [0.04, 0.035, 0.03], soot);
    }));
  }
  const heatAt = (p) => clamp(1.15 - Math.hypot(p.x, p.z) * 2.8 - p.y * 1.3, 0, 1);
  const BARK = [0.3, 0.22, 0.15];
  // two crossed base logs
  for (const a of [0.35, 1.95]) {
    const g = new THREE.CylinderGeometry(0.045, 0.05, 0.66, 9, 6);
    g.rotateZ(Math.PI / 2); g.rotateY(-a); g.translate(0, 0.045 + (a > 1 ? 0.03 : 0), 0);
    fuel.push(finish(g, BARK, heatAt));
  }
  // teepee
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * TAU + rng.range(-0.2, 0.2), rr = rng.range(0.19, 0.25);
    const b = V(Math.cos(a) * rr, 0.02, Math.sin(a) * rr), t = V(rng.range(-0.03, 0.03), rng.range(0.38, 0.46), rng.range(-0.03, 0.03));
    const d = new THREE.Vector3().subVectors(t, b);
    const g = new THREE.CylinderGeometry(0.02, rng.range(0.024, 0.034), d.length(), 7, 5);
    g.applyMatrix4(new THREE.Matrix4().compose(b.clone().add(t).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), V(1, 1, 1)));
    fuel.push(finish(g, mul3(BARK, rng.range(0.8, 1.15)), heatAt));
  }
  // bed of coals and a few loose embers
  const coal = new THREE.RingGeometry(0.001, 0.25, 28, 5); coal.rotateX(-Math.PI / 2);
  const cp = coal.attributes.position;
  for (let k = 0; k < cp.count; k++) { const x = cp.getX(k), z = cp.getZ(k); cp.setY(k, 0.012 + 0.018 * (Math.sin(x * 61) * Math.sin(z * 53) * 0.5 + 0.5) * (1 - Math.hypot(x, z) / 0.25)); }
  coal.computeVertexNormals();
  fuel.push(finish(coal, [0.1, 0.085, 0.075], (p) => clamp(1.05 - Math.hypot(p.x, p.z) * 3.2, 0, 1)));
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, TAU), rr = rng.range(0.05, 0.22);
    const g = new THREE.IcosahedronGeometry(rng.range(0.018, 0.034), 0); g.translate(Math.cos(a) * rr, 0.02, Math.sin(a) * rr);
    fuel.push(finish(g, [0.08, 0.07, 0.06], 0.9 - rr * 2));
  }
  return { stones: merge(stones), fuel: merge(fuel) };
}

// ---------- materials ----------
function emberMaterial(k) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  patchMaterial(mat, {
    uniforms: { uFireK: k },
    vertexHead: 'attribute float aHeat; varying float vHeat; varying vec3 vEmWP;',
    fragmentHead: `${commonGLSL}\nuniform float uFireK; varying float vHeat; varying vec3 vEmWP;`,
    vertex: { project_vertex: '$\n vHeat = aHeat; vEmWP = (modelMatrix * vec4(transformed, 1.0)).xyz;' },
    fragment: {
      color_fragment: '$\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.026, 0.022), smoothstep(0.08, 0.55, vHeat));',
      emissivemap_fragment: /* glsl */`$
        vec4 en = texture2D(uNoise, vEmWP.xz * 2.7 + vec2(vEmWP.y * 1.9, 0.0));
        vec4 en2 = texture2D(uNoise, vEmWP.zy * 3.3 + vec2(uTime * 0.03, 0.0));
        float cracks = 1.0 - smoothstep(0.02, 0.14, en.a + (en2.b - 0.5) * 0.06);
        float pulse = 0.6 + 0.4 * sin(uTime * (1.7 + en.r * 2.0) + en2.g * 12.0);
        float hh = vHeat * vHeat;
        float glow = hh * (0.18 + cracks * 1.5 + smoothstep(0.6, 1.0, vHeat) * 0.6) * pulse * uFireK;
        totalEmissiveRadiance += mix(vec3(1.0, 0.18, 0.03), vec3(1.0, 0.5, 0.14), cracks * hh) * glow * 3.2;`,
    },
  }, 'camp-ember');
  return mat;
}

// tent fabric: from inside, daylight (or firelight) glows through it
function tentMaterial(glow) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  patchMaterial(mat, {
    uniforms: { uGlow: { value: glow } },
    vertexHead: 'attribute float aHeat; varying float vDoor;',
    fragmentHead: 'uniform vec3 uGlow; varying float vDoor;',
    vertex: { project_vertex: '$\n vDoor = aHeat;' },
    fragment: {
      // the door opening, cut along a smooth line
      map_fragment: '$\n if (vDoor > 0.0) discard;',
      emissivemap_fragment: '$\n totalEmissiveRadiance += diffuseColor.rgb * uGlow;',
    },
  }, 'camp-tent');
  return mat;
}

// worn dirt around the camp, soft-edged, with ash and charcoal around the fire ring
function dirtMaterial(firePos) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  patchMaterial(mat, {
    uniforms: { uFirePos: { value: firePos } },
    vertexHead: 'attribute float aEdge; varying float vEdge; varying vec3 vDWP;',
    fragmentHead: `${commonGLSL}\nuniform vec2 uFirePos; varying float vEdge; varying vec3 vDWP;`,
    vertex: { project_vertex: '$\n vEdge = aEdge; vDWP = (modelMatrix * vec4(transformed, 1.0)).xyz;' },
    fragment: {
      map_fragment: /* glsl */`
        vec4 n1 = texture2D(uNoise, vDWP.xz * 0.33);
        vec4 n2 = texture2D(uNoise, vDWP.xz * 1.6);
        vec4 n3 = texture2D(uNoise, vDWP.xz * 5.0);
        float a = 1.0 - smoothstep(0.5, 1.0, vEdge + (n1.r - 0.5) * 0.5 + (n2.g - 0.5) * 0.14);
        vec3 soil = mix(vec3(0.27, 0.2, 0.14), vec3(0.42, 0.33, 0.23), n2.b) * (0.85 + 0.3 * n3.r);
        soil = mix(soil, vec3(0.5, 0.45, 0.38), smoothstep(0.7, 0.85, n3.a) * 0.5); // grit
        float d = distance(vDWP.xz, uFirePos) + (n2.r - 0.5) * 0.18;
        soil = mix(soil, vec3(0.33, 0.32, 0.3), (1.0 - smoothstep(0.4, 0.95, d)) * 0.75);  // ash
        soil = mix(soil, vec3(0.04, 0.035, 0.03), 1.0 - smoothstep(0.18, 0.5, d));     // charcoal
        soil *= mix(1.0, 0.65, uWet);
        soil = mix(soil, vec3(0.9, 0.92, 0.96), snowCover(vDWP) * 0.8 * smoothstep(0.9, 1.6, d) * smoothstep(0.4, 0.7, n2.g + 0.2));
        diffuseColor.rgb = soil;
        diffuseColor.a = a * 0.94;`,
    },
  }, 'camp-dirt');
  return mat;
}

const flameVert = /* glsl */`
varying vec2 vUv; varying float vFade;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFade = 1.0 - smoothstep(60.0, 140.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const flameFrag = /* glsl */`
uniform sampler2D uNoise; uniform float uTime; uniform float uK; uniform float uSeed; uniform float uMode;
varying vec2 vUv; varying float vFade;
void main(){
  vec2 uv = vUv;
  if (uMode > 0.5) {
    // warm haze hanging round the fire
    float d = length((uv - vec2(0.5, 0.4)) * vec2(1.0, 1.3)) * 2.0;
    gl_FragColor = vec4(vec3(1.0, 0.42, 0.12) * exp(-d * d * 3.5) * 0.22 * uK * vFade, 1.0);
    return;
  }
  float t = uTime;
  float n = texture2D(uNoise, vec2(uv.x * 0.7 + uSeed, uv.y * 0.5 - t * 0.85)).r;
  float n2 = texture2D(uNoise, vec2(uv.x * 1.5 - uSeed, uv.y * 1.1 - t * 1.6)).g;
  float y = uv.y;
  float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.8 * y + (n2 - 0.5) * 0.3 * y;
  float w = mix(0.66, 0.05, pow(y, 0.75));
  float body = 1.0 - smoothstep(w * 0.25, w, abs(x));
  float top = 1.0 - smoothstep(0.3, 0.95, y + (n2 - 0.5) * 0.55 + (n - 0.5) * 0.35);
  float a = body * top * smoothstep(0.0, 0.07, y);
  vec3 col = mix(vec3(1.0, 0.2, 0.03), vec3(1.0, 0.58, 0.2), smoothstep(0.1, 0.6, a));
  col = mix(col, vec3(1.0, 0.88, 0.65), smoothstep(0.55, 1.0, a) * (1.0 - y));
  gl_FragColor = vec4(col * a * uK * 2.4 * vFade, 1.0);
}`;
function flameMaterial(k, seed, mode) {
  return new THREE.ShaderMaterial({
    vertexShader: flameVert, fragmentShader: flameFrag,
    uniforms: { uNoise: U.uNoise, uTime: U.uTime, uK: k, uSeed: { value: seed }, uMode: { value: mode } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// layout in camp space: the fire at the origin, the tent behind it with its door to the fire
const LAYOUT = [
  { id: 'tent', x: 0.35, z: -2.65, r: 1.35, label: 'Dome Tent' },
  { id: 'fire', x: 0, z: 0, r: 0.62, label: 'Campfire', hint: 'click to stoke' },
  { id: 'chair', x: -1.2, z: 0.45, r: 0.42, label: 'Camp Chair', hint: 'click to sit down', blanket: true },
  { id: 'chair', x: 1.25, z: 0.6, r: 0.42, label: 'Camp Chair', hint: 'click to sit down' },
  { id: 'table', x: 2.05, z: -0.5, r: 0.42, yaw: 0.5, label: 'Camp Table', hint: 'click to toggle the lantern' },
  { id: 'wood', x: -1.95, z: -1.45, r: 0.62, yaw: 1.1, label: 'Woodpile', hint: 'click to throw a log on' },
];
const PATCH = { x: 0.25, z: -1.3, rx: 3.0, rz: 3.4 };

export class Camp {
  constructor(scene, app) {
    this.app = app;
    this.scene = scene;
    this.placed = null;     // current pose { x, z, rot } or null
    this.placing = false;
    this.rotOff = 0;
    this.heat = 1;          // fire strength; stoking pushes it up for a while
    this.lantern = true;
    this.seated = null;     // the chair or tent you're sitting in
    this.picks = [];
    this.hidden = [];       // grass/flower instances tucked away under the camp
    this.acc = { flame: 0, ember: 0, smoke: 0, check: 0 };
    this.fireK = { value: 0 };
    const rng = new RNG(808);

    const M = this.mats = {
      frame: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 }),
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
      ware: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }),
      stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, emissive: new THREE.Color(1, 0.62, 0.25), emissiveIntensity: 0 }),
      tent: tentMaterial(this.tentGlow = new THREE.Color(0, 0, 0)),
      ember: emberMaterial(this.fireK),
    };
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x9dffb0, transparent: true, opacity: 0.38, depthWrite: false });

    const tent = buildTent();
    const table = buildTable();
    const fire = buildFire(rng, false);
    const chairCols = [[0.16, 0.27, 0.19], [0.44, 0.15, 0.1]];
    const meshesFor = (it, ci) => {
      switch (it.id) {
        case 'tent': return [[tent.cloth, M.tent], [tent.frame, M.frame]];
        case 'chair': { const c = buildChair(chairCols[ci % 2], it.blanket); return [[c.frame, M.frame], [c.cloth, M.cloth]]; }
        case 'table': return [[table.frame, M.frame], [table.wood, M.wood], [table.ware, M.ware], [table.glass, M.glass]];
        case 'wood': return [[buildWoodpile(rng), M.wood]];
        case 'fire': return [[fire.stones, M.stone], [fire.fuel, M.ember]];
        default: return [];
      }
    };
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    let ci = 0;
    this.items = LAYOUT.map((it) => {
      const g = new THREE.Group();
      for (const [geo, mat] of meshesFor(it, it.id === 'chair' ? ci++ : 0)) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true; m.receiveShadow = true;
        m.userData.mat = mat;
        g.add(m);
      }
      this.root.add(g);
      const yaw = it.yaw ?? Math.atan2(-it.x, -it.z) + (it.id === 'tent' ? 0.1 : 0);
      return { ...it, yaw, group: g, wx: 0, wy: 0, wz: 0 };
    });
    this.fire = this.items.find((i) => i.id === 'fire');
    this.tent = this.items.find((i) => i.id === 'tent');

    // dirt patch: polar grid in camp space, draped on the ground when placed
    const RINGS = 18, SEGS = 72;
    const pos = new Float32Array((1 + RINGS * SEGS) * 3), edge = new Float32Array(1 + RINGS * SEGS), idx = [];
    this.patchLocal = [[PATCH.x, PATCH.z]];
    for (let j = 1; j <= RINGS; j++) for (let i = 0; i < SEGS; i++) {
      const r = j / RINGS, a = i / SEGS * TAU;
      this.patchLocal.push([PATCH.x + Math.cos(a) * PATCH.rx * r, PATCH.z + Math.sin(a) * PATCH.rz * r]);
      edge[1 + (j - 1) * SEGS + i] = r;
    }
    for (let i = 0; i < SEGS; i++) idx.push(0, 1 + (i + 1) % SEGS, 1 + i);
    for (let j = 1; j < RINGS; j++) for (let i = 0; i < SEGS; i++) {
      const a = 1 + (j - 1) * SEGS + i, b = 1 + (j - 1) * SEGS + (i + 1) % SEGS, c = a + SEGS, d = b + SEGS;
      idx.push(a, b, c, b, d, c);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    pg.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    pg.setIndex(idx);
    this.firePos2 = new THREE.Vector2();
    this.patch = new THREE.Mesh(pg, dirtMaterial(this.firePos2));
    this.patch.receiveShadow = true; this.patch.visible = false; this.patch.frustumCulled = false;
    this.patch.renderOrder = -1;
    scene.add(this.patch);

    // flames: two camera-facing flame cards and a warm haze, drawn with the other transparents
    this.flames = new THREE.Group();
    this.flameK = { value: 0 }; this.hazeK = { value: 0 };
    const fg = new THREE.PlaneGeometry(0.46, 0.66).translate(0, 0.33, 0);
    const f1 = new THREE.Mesh(fg, flameMaterial(this.flameK, 0.0, 0));
    const f2 = new THREE.Mesh(fg, flameMaterial(this.flameK, 0.43, 0)); f2.scale.set(0.75, 0.8, 0.75); f2.position.set(0.05, 0, -0.03);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8).translate(0, 0.55, 0), flameMaterial(this.hazeK, 0, 1));
    for (const m of [f1, f2, halo]) { m.renderOrder = 4; m.frustumCulled = false; this.flames.add(m); }
    this.flames.visible = false;
    app.overlay.add(this.flames);

    // firelight: always in the scene (intensity 0 without a camp) so pitching a camp never recompiles shaders
    this.light = new THREE.PointLight(0xff9450, 0, 11, 1.7);
    scene.add(this.light);

    // campsite markers, shown while choosing a spot: a soft ring on the levelled ground
    this.siteMarks = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    this.siteRingMat = ringMat;
    for (const c of CAMPSITES) {
      const g = new THREE.RingGeometry(c.r - 0.25, c.r, 64).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, ringMat);
      m.position.set(c.x, groundAt(c.x, c.z) + 0.06, c.z);
      m.renderOrder = 5; m.frustumCulled = false;
      this.siteMarks.add(m);
    }
    this.siteMarks.visible = false;
    app.overlay.add(this.siteMarks);
  }

  // ---- placement ----
  toggle() {
    if (this.placing) { this.cancel(); return; }
    this.getUp();
    this.placing = true;
    this.prev = this.placed;
    this.setGhost(true);
    this.root.visible = true;
    this.patch.visible = false;
    this.flames.visible = false;
    this.app.ui.setCamp && this.app.ui.setCamp(true);
    this.siteMarks.visible = true;
    this.app.ui.toast('<div class="t-n">Pick a spot</div><div class="t-l">flat, dry ground · the rings are level campsites · click to pitch · R rotate · Esc cancel</div>', 'small', 3800);
  }
  cancel() {
    if (!this.placing) return;
    this.placing = false;
    this.siteMarks.visible = false;
    this.setGhost(false);
    this.app.ui.setCamp && this.app.ui.setCamp(false);
    if (this.prev) this.settle(this.prev, true);
    else this.root.visible = false;
  }
  rotate() { if (this.placing) this.rotOff += Math.PI / 4; }

  confirm() {
    if (!this.placing || !this.ghost || !this.ghostOk) {
      if (this.placing && this.ghost) this.app.audio.play('tick', { x: this.ghost.x, y: groundAt(this.ghost.x, this.ghost.z), z: this.ghost.z, gain: 0.5 });
      return;
    }
    this.placing = false;
    this.siteMarks.visible = false;
    this.setGhost(false);
    this.app.ui.setCamp && this.app.ui.setCamp(false);
    const first = !this.placed;
    this.settle({ ...this.ghost }, false);
    const a = this.app, f = this.fire;
    a.audio.play('rustle', { x: this.tent.wx, y: this.tent.wy + 0.5, z: this.tent.wz, gain: 0.9, size: 1.2 });
    setTimeout(() => a.audio.play('thud', { x: this.tent.wx, y: this.tent.wy, z: this.tent.wz, gain: 0.35, size: 0.3 }), 250);
    a.audio.play('stoke', { x: f.wx, y: f.wy + 0.3, z: f.wz, gain: 0.7 });
    this.heat = 1.8;
    for (let i = 0; i < 40; i++) this.ember(true);
    a.interact.scareAll(f.wx, f.wz, 6);
    a.ui.toast(`<div class="t-n">${first ? 'Camp pitched' : 'Camp moved'}</div><div class="t-l">click the fire to stoke it · a chair to sit · C to move · X to pack up</div>`, 'small', 3800);
  }

  // pitch directly (console / tests): faces the camera unless rot is given; returns the reason if the spot is bad
  place(x, z, rot, force = false) {
    const cam = this.app.camera.position;
    const pose = { x, z, rot: rot ?? Math.atan2(cam.x - x, cam.z - z) };
    const why = this.check(pose);
    if (why && !force) return why;
    if (this.placing) { this.placing = false; this.siteMarks.visible = false; this.setGhost(false); this.app.ui.setCamp && this.app.ui.setCamp(false); }
    this.settle(pose, false);
    return why;
  }

  packUp() {
    if (this.placing) this.cancel();
    if (!this.placed) return;
    this.getUp();
    const a = this.app;
    a.audio.play('rustle', { x: this.tent.wx, y: this.tent.wy + 0.5, z: this.tent.wz, gain: 0.8 });
    for (let i = 0; i < 12; i++) a.parts.spawn({ x: this.fire.wx + (Math.random() - 0.5) * 0.3, y: this.fire.wy + 0.2, z: this.fire.wz + (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.4, life: 4, size: 0.2, size1: 1.2, color: [0.6, 0.6, 0.62, 0.14], gravity: -0.05, drag: 0.6, shape: 3 });
    this.placed = null;
    this.restoreGround();
    this.root.visible = false; this.patch.visible = false; this.flames.visible = false;
    this.light.intensity = 0;
    this.picks = [];
    a.audio.fire = null;
    a.ui.toast('<div class="t-n">Camp packed up</div><div class="t-l">leave no trace</div>', 'small', 2400);
  }

  setGhost(on) {
    for (const it of this.items) for (const m of it.group.children) {
      m.material = on ? this.ghostMat : m.userData.mat;
      m.castShadow = !on;
    }
  }

  // camp space -> world for a pose
  toWorld(pose, lx, lz, out = new THREE.Vector3()) {
    const c = Math.cos(pose.rot), s = Math.sin(pose.rot);
    return out.set(pose.x + lx * c + lz * s, 0, pose.z - lx * s + lz * c);
  }

  // drop every piece onto the ground for this pose
  arrange(pose) {
    const v = new THREE.Vector3();
    for (const it of this.items) {
      this.toWorld(pose, it.x, it.z, v);
      let sum = 0, lo = Infinity;
      for (let k = 0; k < 5; k++) {
        const a = k / 4 * TAU, rr = k === 4 ? 0 : it.r * 0.7;
        const g = groundAt(v.x + Math.cos(a) * rr, v.z + Math.sin(a) * rr);
        sum += g; lo = Math.min(lo, g);
      }
      it.wx = v.x; it.wz = v.z; it.wy = (sum / 5 + lo) / 2 - 0.01;
      it.group.position.set(v.x, it.wy, v.z);
      it.group.rotation.y = pose.rot + it.yaw;
    }
  }

  // is this a good spot? returns a reason when it is not
  check(pose) {
    const a = this.app, v = new THREE.Vector3();
    if (Math.abs(pose.x) > WORLD - 12 || Math.abs(pose.z) > WORLD - 12) return 'too far out';
    let lo = Infinity, hi = -Infinity;
    for (const it of this.items) {
      this.toWorld(pose, it.x, it.z, v);
      for (let k = 0; k < 9; k++) {
        const ang = k / 8 * TAU, rr = k === 8 ? 0 : it.r * 0.85;
        const x = v.x + Math.cos(ang) * rr, z = v.z + Math.sin(ang) * rr;
        const g = groundAt(x, z);
        // the edge of the camp may run right down to the waterline; nothing stands in the water
        if (g < waterLevel(z) + (k === 8 ? 0.06 : -0.02)) return 'in the water';
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
      if (normalAt(v.x, v.z).y < 0.86) return 'too steep';
    }
    if (hi - lo > 0.75) return 'too uneven';
    const R = 4.5;
    for (const rk of a.rocks.rocks) {
      if (rk.r < 0.12 || Math.abs(rk.cx - pose.x) > R + rk.r || Math.abs(rk.cz - pose.z) > R + rk.r) continue;
      for (const it of this.items) {
        this.toWorld(pose, it.x, it.z, v);
        if (Math.hypot(rk.cx - v.x, rk.cz - v.z) < it.r * 0.9 + rk.r * 0.7) return 'rocks in the way';
      }
    }
    for (const t of a.veg.trees) {
      if (Math.abs(t.x - pose.x) > R + 3 || Math.abs(t.z - pose.z) > R + 3) continue;
      const tr = ['sage', 'rabbit', 'willow'].includes(t.kind) ? t.r * 0.35 : 0.4;
      for (const it of this.items) {
        this.toWorld(pose, it.x, it.z, v);
        if (Math.hypot(t.x - v.x, t.z - v.z) < it.r + tr) return t.kind === 'sage' || t.kind === 'rabbit' || t.kind === 'willow' ? 'brush in the way' : 'trees in the way';
      }
    }
    return null;
  }

  // final placement: ground patch, grass cleared, pickables, fire lit
  settle(pose, quiet) {
    this.placed = pose;
    this.arrange(pose);
    this.root.visible = true;
    this.flames.visible = true;
    // drape the dirt patch
    const p = this.patch.geometry.attributes.position, v = new THREE.Vector3();
    this.patchLocal.forEach(([lx, lz], i) => {
      this.toWorld(pose, lx, lz, v);
      p.setXYZ(i, v.x, groundAt(v.x, v.z) + 0.025, v.z);
    });
    p.needsUpdate = true;
    this.patch.geometry.computeVertexNormals();
    this.patch.geometry.computeBoundingSphere();
    this.patch.visible = true;
    this.firePos2.set(this.fire.wx, this.fire.wz);
    this.clearGround(pose);
    // hover / click targets
    const H = { tent: 0.55, fire: 0.25, chair: 0.5, table: 0.45, wood: 0.25 }, Rr = { tent: 1.0, fire: 0.42, chair: 0.4, table: 0.36, wood: 0.4 };
    this.picks = this.items.map((it) => ({ x: it.wx, y: it.wy + H[it.id], z: it.wz, r: Rr[it.id], label: it.label, hint: it.hint, kind: 'camp', obj: it }));
    this.tentPick = this.picks[0];
    this.light.position.set(this.fire.wx, this.fire.wy + 0.45, this.fire.wz);
    this.flames.position.set(this.fire.wx, this.fire.wy + 0.03, this.fire.wz);
    if (!quiet) this.heat = Math.max(this.heat, 1.2);
  }

  inFootprint(pose, x, z, pad = 0) {
    const c = Math.cos(pose.rot), s = Math.sin(pose.rot);
    const dx = x - pose.x, dz = z - pose.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (((lx - PATCH.x) / PATCH.rx) ** 2 + ((lz - PATCH.z) / PATCH.rz) ** 2 < 0.6 * 0.6) return true;
    for (const it of this.items) if ((lx - it.x) ** 2 + (lz - it.z) ** 2 < (it.r + pad) ** 2) return true;
    return false;
  }

  // tuck grass tufts and flowers inside the camp out of sight; remember them to restore later
  clearGround(pose) {
    this.restoreGround();
    const veg = this.app.veg, m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), p = new THREE.Vector3();
    const R = Math.max(PATCH.rx, PATCH.rz) + 2;
    const tuck = (im, i) => { im.getMatrixAt(i, m); this.hidden.push({ im, i, e: m.elements.slice() }); im.setMatrixAt(i, zero); im.instanceMatrix.needsUpdate = true; };
    for (const g of veg.grassChunks) {
      const c = g.userData.center;
      if (Math.abs(c.x - pose.x) > 12 + R || Math.abs(c.z - pose.z) > 12 + R) continue;
      for (const im of g.children) {
        if (!im.isInstancedMesh) continue;
        const n = im.instanceMatrix.count;
        for (let i = 0; i < n; i++) {
          im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
          if (Math.abs(p.x - pose.x) > R || Math.abs(p.z - pose.z) > R) continue;
          if (this.inFootprint(pose, p.x, p.z, 0.15)) tuck(im, i);
        }
      }
    }
    if (veg.flowerMesh) for (const f of veg.flowers) if (this.inFootprint(pose, f.x, f.z, 0.2)) tuck(veg.flowerMesh, f.index);
  }
  restoreGround() {
    const m = new THREE.Matrix4();
    for (const h of this.hidden) { m.fromArray(h.e); h.im.setMatrixAt(h.i, m); h.im.instanceMatrix.needsUpdate = true; }
    this.hidden = [];
  }

  // ---- interaction ----
  pickables() { return this.placing ? [] : this.seated ? this.picks.filter((p) => p.obj !== this.seated) : this.picks; }

  click(it) {
    const a = this.app;
    switch (it.id) {
      case 'fire': this.stoke(1); break;
      case 'wood': {
        a.audio.play('thud', { x: this.fire.wx, y: this.fire.wy + 0.2, z: this.fire.wz, gain: 0.5, size: 0.35 });
        setTimeout(() => this.stoke(1.3), 180);
        break;
      }
      case 'chair': {
        // settle in: the eye drops to a seated height over the chair, facing the fire
        const eye = it.group.localToWorld(new THREE.Vector3(0, 1.1, -0.06));
        this.sitIn(it, eye, it.group.rotation.y + Math.PI, -0.18);
        a.audio.play('rustle', { x: it.wx, y: it.wy + 0.4, z: it.wz, gain: 0.35, size: 0.4 });
        break;
      }
      case 'table': {
        this.lantern = !this.lantern;
        a.audio.play('tick', { x: it.wx, y: it.wy + 0.6, z: it.wz, gain: 0.7 });
        break;
      }
      case 'tent': {
        // crawl in and sit at the back, looking out through the open door
        a.audio.play('zip', { x: it.wx, y: it.wy + 0.5, z: it.wz, gain: 0.8 });
        const eye = it.group.localToWorld(new THREE.Vector3(0.05, 0.72, -0.3));
        this.sitIn(it, eye, it.group.rotation.y + Math.PI, -0.1);
        break;
      }
      default: break;
    }
  }

  sitIn(it, eye, yaw, pitch) {
    const a = this.app;
    this.seated = it;
    a.controls.sit(eye, yaw, pitch);
    const tent = it.id === 'tent';
    const night = U.uNight.value > 0.5;
    a.ui.toast(`<div class="t-n">${tent ? 'In the tent' : 'Sitting by the fire'}</div><div class="t-l">drag or A/D to look around · scroll to look closer${tent && night ? ' · Z to sleep till dawn' : ''} · Esc to get up</div>`, 'small', 4200);
  }
  getUp() {
    if (!this.seated) return false;
    const a = this.app, it = this.seated;
    this.seated = null;
    a.controls.stand();
    a.audio.play(it.id === 'tent' ? 'zip' : 'rustle', { x: it.wx, y: it.wy + 0.4, z: it.wz, gain: it.id === 'tent' ? 0.6 : 0.3, size: 0.4 });
    return true;
  }
  // a night in the tent: wake at first light
  sleep() {
    const a = this.app;
    if (!this.seated || this.seated.id !== 'tent' || U.uNight.value < 0.5 || !a.sky) return;
    a.ui.flash(0.25);
    setTimeout(() => { a.sky.time = 6.2; a.ui.toast('<div class="t-n">Morning</div><div class="t-l">you slept until first light</div>', 'small', 3000); }, 400);
  }

  stoke(k = 1) {
    const a = this.app, f = this.fire;
    this.heat = Math.min(2.4, this.heat + 0.7 * k);
    a.audio.play('stoke', { x: f.wx, y: f.wy + 0.3, z: f.wz, gain: 0.9 * k });
    for (let i = 0; i < 26 * k; i++) this.ember(true);
    for (let i = 0; i < 6; i++) this.smoke(true);
  }

  ember(burst) {
    const f = this.fire, s = this.app.sparks;
    const ang = Math.random() * TAU, rr = Math.random() * 0.15;
    const v = burst ? 1.5 + Math.random() * 2.5 : 0.7 + Math.random() * 1.1;
    s.spawn({
      x: f.wx + Math.cos(ang) * rr, y: f.wy + 0.25 + Math.random() * 0.2, z: f.wz + Math.sin(ang) * rr,
      vx: (Math.random() - 0.5) * (burst ? 1.2 : 0.3), vy: v, vz: (Math.random() - 0.5) * (burst ? 1.2 : 0.3),
      life: 1.2 + Math.random() * 2.2, size: 0.012 + Math.random() * 0.014, color: [2.4, 0.8, 0.22, 1],
      gravity: -0.15, drag: 0.9, shape: 0, wander: 1.6, flicker: 10 + Math.random() * 10,
    });
  }
  smoke(thick) {
    const f = this.fire;
    const step = (q, dt) => {
      const w = U.uWind.value, s = 0.25 + w.z * 1.3;
      const k = Math.min(1, dt * 0.5);
      q.vx += (w.x * s - q.vx) * k; q.vz += (w.y * s - q.vz) * k; q.vy += (0.3 - q.vy) * k * 0.6;
      q.vx += Math.sin(U.uTime.value * 0.9 + q.seed) * 0.12 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    };
    this.app.parts.spawn({
      x: f.wx + (Math.random() - 0.5) * 0.15, y: f.wy + 0.5 + Math.random() * 0.2, z: f.wz + (Math.random() - 0.5) * 0.15,
      vx: 0, vy: 0.55 + Math.random() * 0.3, vz: 0, life: 5 + Math.random() * 3, size: 0.18, size1: 1.5 + Math.random(),
      color: [0.48, 0.47, 0.46, thick ? 0.16 : 0.075], shape: 3, fadeIn: 0.8, update: step,
    });
  }

  update(dt) {
    const a = this.app, t = U.uTime.value;
    if (this.placing) {
      const cur = a.interact.cursor, cam = a.camera.position;
      if (cur.active) {
        const rot = Math.atan2(cam.x - cur.x, cam.z - cur.z) + this.rotOff;
        if (!this.ghost) this.ghost = { x: cur.x, z: cur.z, rot };
        const g = this.ghost;
        g.x = cur.x; g.z = cur.z;
        // close to a marked campsite: snap onto it
        this.site = null;
        for (const c of CAMPSITES) if (Math.hypot(cur.x - c.x, cur.z - c.z) < c.r + 1.5) { g.x = c.x; g.z = c.z; this.site = c; }
        const dr = Math.atan2(Math.sin(rot - g.rot), Math.cos(rot - g.rot));
        g.rot += dr * Math.min(1, dt * 8);
        this.arrange(g);
        this.root.visible = true;
        this.acc.check -= dt;
        if (this.acc.check <= 0) {
          this.acc.check = 0.12;
          this.why = this.check(g);
          this.ghostOk = !this.why;
          this.ghostMat.color.set(this.ghostOk ? 0x9dffb0 : 0xff7a66);
        }
      } else this.root.visible = false;
      this.placeLabel = this.ghostOk ? (this.site ? `Pitch camp · ${this.site.name}` : 'Pitch camp here') : 'Can’t camp here';
      this.siteRingMat.opacity = 0.28 + 0.12 * Math.sin(t * 3);
      this.placeHint = (this.ghostOk ? 'click to pitch' : this.why || '') + ' · R rotate · Esc cancel';
      this.ghostMat.opacity = 0.3 + 0.08 * Math.sin(t * 5);
      a.audio.fire = null;
      this.light.intensity = 0;
      return;
    }
    if (!this.placed) return;
    const f = this.fire, night = U.uNight.value, rain = U.uRain.value;
    this.heat += (1 - this.heat) * Math.min(1, dt * 0.12);
    const flick = 0.82 + 0.1 * Math.sin(t * 9.3) + 0.06 * Math.sin(t * 23.1 + 1.3) + 0.05 * Math.sin(t * 4.1 + 0.4);
    const k = this.heat * (1 - rain * 0.35);
    this.fireK.value = k * (0.75 + 0.25 * flick);
    this.flameK.value = k * flick;
    this.hazeK.value = k * (0.25 + night * 0.9);
    this.light.intensity = k * flick * (1.6 + night * 5.5);
    this.light.position.y = f.wy + 0.42 + 0.04 * Math.sin(t * 7.1);
    // flame cards face the camera; taller when stoked
    const cam = a.camera.position;
    const yaw = Math.atan2(cam.x - f.wx, cam.z - f.wz);
    this.flames.children.forEach((m, i) => {
      m.rotation.y = yaw;
      if (i < 2) m.scale.y = (i ? 0.8 : 1) * (0.75 + 0.35 * k) * (0.92 + 0.12 * Math.sin(t * (6 + i * 3.7)));
    });
    // lantern glows at dusk and after
    this.mats.glass.emissiveIntensity = this.lantern ? 0.22 + 4.2 * smoothstep(0.15, 0.7, night) * (0.95 + 0.05 * Math.sin(t * 13)) : 0;
    this.tentPick.hint = night > 0.5 ? 'click to crawl in (and sleep till dawn)' : 'click to crawl in';
    // inside the tent the fabric glows with whatever light falls on it
    if (this.seated && this.seated.id === 'tent') {
      const sc = U.uSunColor.value, si = U.uSunIntensity.value * smoothstep(-0.05, 0.15, U.uSunDir.value.y), sk = U.uSkyAmb.value;
      const fl = this.light.intensity * 0.012;
      this.tentGlow.setRGB(sc.r * si * 0.045 + sk.r * 0.1 + fl, sc.g * si * 0.045 + sk.g * 0.1 + fl * 0.55, sc.b * si * 0.045 + sk.b * 0.1 + fl * 0.25);
    } else this.tentGlow.setRGB(0, 0, 0);
    // embers and smoke (only when near enough to see)
    const d = Math.hypot(cam.x - f.wx, cam.z - f.wz);
    if (d < 120) {
      this.acc.ember += dt * (2 + 3 * k);
      while (this.acc.ember > 1) { this.acc.ember -= 1; this.ember(false); }
      this.acc.smoke += dt * (2.2 + 1.5 * k);
      while (this.acc.smoke > 1) { this.acc.smoke -= 1; this.smoke(false); }
    }
    a.audio.fire = { x: f.wx, y: f.wy + 0.3, z: f.wz, k: clamp(k, 0, 2) };
  }
}
