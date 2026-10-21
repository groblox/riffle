// Vegetation: trees (aspen, spruce, juniper), shrubs (sage, rabbitbrush, willow/dogwood),
// desert plants (yucca, prickly pear, Mormon tea), grass tufts (green meadow, dry desert bunchgrass),
// reeds and wildflowers. Placement by biome. Instanced everywhere.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG, Simplex, clamp, smoothstep } from '../noise.js';
import {
  groundAt, waterLevel, streamCenter, streamHalfW, streamSlope, bioAt, normalAt, lateral, BOUNDS, WF_Z, WF_LEN, trailNear, campsiteAt, inLake, outcropBand,
} from './shape.js';
import { U, commonGLSL, patchMaterial, contactGLSL } from '../core/env.js';
import {
  makeLeafClusterTexture, makeNeedleTexture, makeScaleSprayTexture,
  makeFoliageMaterial, makeFoliageDepthMaterial, makeBarkMaterial,
} from '../gfx/foliage.js';
import { canvasTexture } from '../gfx/textures.js';

const noise = new Simplex(777);

// ---------------- geometry helpers ----------------
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.leaf = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vert(p, n, u, v, leaf = [0, 0, 0, 0]) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.leaf.push(...leaf);
    return this.count - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.leaf, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// tube along points with radii
function addTube(B, pts, radii, seg = 7) {
  const base = B.count;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    let side = new THREE.Vector3().crossVectors(t, Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const side2 = new THREE.Vector3().crossVectors(side, t).normalize();
    for (let s = 0; s <= seg; s++) {
      const a = s / seg * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(side2, Math.sin(a));
      B.vert(p.clone().addScaledVector(n, radii[i]), n, s / seg, i / (pts.length - 1));
    }
  }
  const W = seg + 1;
  for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < seg; s++) {
    const a = base + i * W + s, b = a + 1, c = a + W, d = c + 1;
    B.idx.push(a, c, b, b, c, d);
  }
}

// a leaf card (quad) at centre c with axes right/up (half sizes), outward normal for lighting
function addCard(B, c, right, upv, nrm, phase, uv0 = [0, 0], uv1 = [1, 1]) {
  const leaf = [c.x, c.y, c.z, phase];
  const a = B.vert(c.clone().sub(right).sub(upv), nrm, uv0[0], uv0[1], leaf);
  const b = B.vert(c.clone().add(right).sub(upv), nrm, uv1[0], uv0[1], leaf);
  const d = B.vert(c.clone().add(right).add(upv), nrm, uv1[0], uv1[1], leaf);
  const e = B.vert(c.clone().sub(right).add(upv), nrm, uv0[0], uv1[1], leaf);
  B.idx.push(a, b, d, a, d, e);
}

function randomUnit(rng) {
  const u = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
}

// ---------------- tree builders ----------------
function buildAspen(seed) {
  const rng = new RNG(seed);
  const H = rng.range(9, 12.5);
  const trunk = new GeoBuilder(), leaves = new GeoBuilder();
  const lean = new THREE.Vector3(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4));
  const pts = [], radii = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector3(lean.x * t * t + Math.sin(t * 5 + seed) * 0.06, t * H, lean.z * t * t + Math.cos(t * 4 + seed) * 0.06));
    radii.push(0.17 * (1 - t * 0.82) + (i === 0 ? 0.05 : 0));
  }
  addTube(trunk, pts, radii, 8);
  const crownC = new THREE.Vector3(lean.x * 0.6, H * 0.74, lean.z * 0.6);
  const crownR = new THREE.Vector3(rng.range(1.8, 2.5), H * 0.27, rng.range(1.8, 2.5));
  // branches
  const tips = [];
  const nb = rng.int(7, 11);
  for (let b = 0; b < nb; b++) {
    const t = rng.range(0.5, 0.92);
    const p0 = new THREE.Vector3(lean.x * t * t, t * H, lean.z * t * t);
    const ang = rng.range(0, Math.PI * 2);
    const len = rng.range(1.0, 2.3) * (1.2 - t * 0.5);
    const dir = new THREE.Vector3(Math.cos(ang), rng.range(0.6, 1.2), Math.sin(ang)).normalize();
    const p1 = p0.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, 0.1, 0));
    const p2 = p0.clone().addScaledVector(dir, len);
    addTube(trunk, [p0, p1, p2], [0.045, 0.03, 0.012], 4);
    tips.push(p2, p1);
  }
  // leaf cards
  const n = 150;
  for (let i = 0; i < n; i++) {
    let c;
    if (i < tips.length * 4) {
      c = tips[i % tips.length].clone().add(randomUnit(rng).multiplyScalar(rng.range(0.1, 0.9)));
    } else {
      const d = randomUnit(rng); const r = Math.pow(rng.next(), 0.35);
      c = crownC.clone().add(new THREE.Vector3(d.x * crownR.x * r, d.y * crownR.y * r, d.z * crownR.z * r));
    }
    const out = c.clone().sub(crownC); out.y *= 0.6; out.normalize();
    const s = rng.range(0.55, 0.8);
    const nrm = out.clone().lerp(randomUnit(rng), 0.35).normalize();
    // card orientation: random around outward axis
    const tmp = Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(nrm, tmp).normalize();
    const upv = new THREE.Vector3().crossVectors(right, nrm).normalize();
    const rot = rng.range(0, Math.PI * 2);
    const r2 = right.clone().multiplyScalar(Math.cos(rot)).addScaledVector(upv, Math.sin(rot)).multiplyScalar(s);
    const u2 = upv.clone().multiplyScalar(Math.cos(rot)).addScaledVector(right, -Math.sin(rot)).multiplyScalar(s);
    const lightN = out.clone().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize();
    addCard(leaves, c, r2, u2, lightN, rng.next());
  }
  return { trunk: trunk.build(), leaves: leaves.build(), H };
}

// Engelmann spruce, in several forms so the skyline of tops isn't one shape repeated: a fine spire leader,
// a leader bent by snow or wind, a forked double top, a blunt top that lost its leader, a dead spike-top
// standing out of a living crown, and a narrow columnar tree of the high slopes.
function buildSpruce(seed, form = 'spire') {
  const rng = new RNG(seed);
  const H = rng.range(11, 16) * (form === 'blunt' ? 0.85 : form === 'column' ? 1.05 : 1);
  const trunk = new GeoBuilder(), leaves = new GeoBuilder();
  // the stem's line: straight below, the top can lean or bend
  const lean = form === 'bent' ? rng.range(0.6, 1.1) : rng.range(0, 0.2), la = rng.range(0, 6.28);
  const axis = (y) => { const t = Math.max(0, (y / H - 0.7) / 0.3); return new THREE.Vector3(Math.cos(la) * lean * t * t, y, Math.sin(la) * lean * t * t); };
  const top = form === 'blunt' ? H * rng.range(0.86, 0.92) : form === 'spike' ? H * rng.range(0.9, 0.93) : H;
  const pts = [], radii = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, y = t * (form === 'spike' ? H : top); pts.push(axis(y)); radii.push(0.28 * (1 - t * (form === 'spike' ? 0.95 : 0.92))); }
  addTube(trunk, pts, radii, 7);
  const baseR = form === 'column' ? rng.range(1.7, 2.2) : rng.range(2.5, 3.4);
  const pw = form === 'column' ? rng.range(0.6, 0.75) : rng.range(0.92, 1.1);
  // the crown's outline: a narrow apex for most, a rounded shoulder for the blunt top
  const radiusAt = (t) => {
    let R = baseR * Math.pow(1 - t, pw) + 0.26;
    if (form === 'blunt') R = Math.max(R, 0.75 * smoothstep(1.0, 0.8, t) * (1 - t * 0.3));
    return R;
  };
  const whorl = (c, R, tFrac) => {
    const k = Math.max(4, Math.round(5 + R * 1.5));
    const off = rng.range(0, Math.PI * 2);
    for (let i = 0; i < k; i++) {
      if (rng.chance(tFrac > 0.6 ? 0.03 : 0.07)) continue; // a missing limb here and there
      const a = off + i / k * Math.PI * 2 + rng.range(-0.25, 0.25);
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const L = R * rng.range(0.82, 1.12) * (rng.chance(0.05) ? 1.2 : 1);
      const droop = -0.25 * L + 0.1;
      const base = c.clone();
      const tip = base.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, droop, 0));
      const mid = base.clone().lerp(tip, 0.5);
      const along = tip.clone().sub(base).multiplyScalar(0.5);
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(L * 0.46 + 0.28);
      const lightN = dir.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, 0.75, 0)).normalize();
      // flat spray + tilted copy for volume
      addCard(leaves, mid, side, along, lightN, rng.next(), [0, 0], [1, 1]);
      const tilt = side.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, L * 0.25, 0));
      addCard(leaves, mid.clone().add(new THREE.Vector3(0, 0.08, 0)), tilt, along, lightN, rng.next(), [0, 0], [1, 1]);
    }
  };
  const crownTop = form === 'double' ? H * 0.82 : top - 0.3;
  for (let y = 1.0; y < crownTop; y += rng.range(0.3, 0.42)) {
    const t = (y - 1.0) / (H - 1.0);
    whorl(axis(y), radiusAt(t), t);
  }
  // a leader: a thin stem with little tufts of new growth up it, ending in a fine tip
  const leader = (from, dir, len, r0) => {
    const lp = [], lr = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4; lp.push(from.clone().addScaledVector(dir, len * t)); lr.push(r0 * (1 - t * 0.85)); }
    addTube(trunk, lp, lr, 5);
    for (let y = 0.15; y < len - 0.15; y += rng.range(0.18, 0.28)) {
      const c = from.clone().addScaledVector(dir, y), R = 0.12 + 0.55 * (1 - y / len) * rng.range(0.7, 1.1);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + rng.range(0, 1.5);
        const d = new THREE.Vector3(Math.cos(a), -0.1, Math.sin(a));
        addCard(leaves, c.clone().addScaledVector(d, R * 0.5), new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(R * 0.45 + 0.1), d.clone().multiplyScalar(R * 0.5), new THREE.Vector3(0, 1, 0), rng.next());
      }
    }
    const tip = from.clone().addScaledVector(dir, len);
    addCard(leaves, tip, new THREE.Vector3(0.16, 0, 0), dir.clone().multiplyScalar(0.32), new THREE.Vector3(0, 1, 0), 0.3);
    addCard(leaves, tip, new THREE.Vector3(0, 0, 0.16), dir.clone().multiplyScalar(0.32), new THREE.Vector3(0, 1, 0), 0.6);
  };
  const up = (y) => axis(y + 0.2).sub(axis(y)).normalize();
  if (form === 'double') {
    // two leaders where the old one was killed, both turned up toward the light
    const y0 = H * 0.8, c0 = axis(y0);
    for (const s of [-1, 1]) {
      const a = la + s * Math.PI / 2;
      const d = new THREE.Vector3(Math.cos(a) * 0.32, 1, Math.sin(a) * 0.32).normalize();
      const len = H * rng.range(0.16, 0.22);
      for (let y = 0.4; y < len - 0.6; y += rng.range(0.32, 0.42)) whorl(c0.clone().addScaledVector(d, y), 0.9 * (1 - y / len) + 0.2, 0.9);
      leader(c0.clone().addScaledVector(d, len * 0.55), d, len * 0.5, 0.05);
    }
  } else if (form === 'spike') {
    // the dead top: a bare grey spike with a few snapped-off branch stubs
    for (let i = 0; i < 6; i++) {
      const y = top + rng.range(0, H - top - 0.3), a = rng.range(0, 6.28), c = axis(y);
      addTube(trunk, [c, c.clone().add(new THREE.Vector3(Math.cos(a) * 0.35, -0.08, Math.sin(a) * 0.35))], [0.025, 0.008], 3);
    }
  } else if (form === 'blunt') {
    // a few upturned limbs trying to take over as leader
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, 6.28), c = axis(top - 0.4);
      leader(c.clone().add(new THREE.Vector3(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4)), new THREE.Vector3(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize(), rng.range(0.5, 0.9), 0.03);
    }
  } else {
    const len = form === 'column' ? rng.range(0.6, 0.9) : rng.range(0.7, 1.3);
    leader(axis(top - 0.3), up(top - 0.3), len, 0.05);
  }
  return { trunk: trunk.build(), leaves: leaves.build(), H };
}

function buildJuniper(seed) {
  const rng = new RNG(seed);
  const H = rng.range(3.2, 5.0);
  const trunk = new GeoBuilder(), leaves = new GeoBuilder();
  const blobs = [];
  const stems = rng.int(2, 3);
  for (let s = 0; s < stems; s++) {
    const a = rng.range(0, 6.28);
    const pts = [], radii = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new THREE.Vector3(Math.cos(a) * t * 1.1 + Math.sin(t * 7 + s) * 0.15, t * H * rng.range(0.75, 0.95), Math.sin(a) * t * 1.1 + Math.cos(t * 6 + s) * 0.15));
      radii.push(0.18 * (1 - t * 0.75));
    }
    addTube(trunk, pts, radii, 6);
    blobs.push(pts[6], pts[4]);
  }
  for (let i = 0; i < 3; i++) blobs.push(new THREE.Vector3(rng.range(-1, 1), H * rng.range(0.4, 0.8), rng.range(-1, 1)));
  for (const b of blobs) {
    const r = rng.range(0.9, 1.4);
    for (let i = 0; i < 22; i++) {
      const d = randomUnit(rng); d.y = Math.abs(d.y) * 0.8 + 0.1;
      const c = b.clone().addScaledVector(d, r * Math.pow(rng.next(), 0.4));
      const nrm = d.clone().normalize();
      const tmp = Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(nrm, tmp).normalize().multiplyScalar(rng.range(0.45, 0.7));
      const upv = new THREE.Vector3().crossVectors(right, nrm).normalize().multiplyScalar(rng.range(0.45, 0.7));
      addCard(leaves, c, right, upv, nrm, rng.next());
    }
  }
  return { trunk: trunk.build(), leaves: leaves.build(), H };
}

function buildShrub(seed, kind) {
  const rng = new RNG(seed);
  const leaves = new GeoBuilder(), trunk = new GeoBuilder();
  let R = 0.7, Hh = 0.8, n = 26, cs = 0.5;
  if (kind === 'willow') { R = 1.3; Hh = 2.6; n = 60; cs = 0.75; }
  if (kind === 'rabbit') { R = 0.6; Hh = 0.8; n = 22; cs = 0.45; }
  if (kind === 'sage') { R = 0.75; Hh = 0.85; n = 26; cs = 0.48; }
  if (kind === 'willow') {
    for (let s = 0; s < 9; s++) {
      const a = rng.range(0, 6.28), sp = rng.range(0.2, 0.6);
      const p0 = new THREE.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
      const p2 = new THREE.Vector3(Math.cos(a) * R * sp * 1.4, Hh * rng.range(0.8, 1.1), Math.sin(a) * R * sp * 1.4);
      const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(0, 0.1, 0));
      addTube(trunk, [p0, p1, p2], [0.03, 0.022, 0.01], 4);
    }
  } else {
    for (let s = 0; s < 4; s++) {
      const a = rng.range(0, 6.28);
      addTube(trunk, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.2, Hh * 0.45, Math.sin(a) * 0.2)], [0.04, 0.02], 4);
    }
  }
  const center = new THREE.Vector3(0, Hh * 0.55, 0);
  for (let i = 0; i < n; i++) {
    const d = randomUnit(rng);
    if (kind === 'willow') { d.y = Math.abs(d.y) * 1.6 - 0.3; }
    else d.y = Math.abs(d.y);
    const r = Math.pow(rng.next(), 0.4);
    const c = new THREE.Vector3(d.x * R * r, Hh * (kind === 'willow' ? 0.55 + d.y * 0.35 : 0.2 + d.y * 0.7) , d.z * R * r);
    const nrm = c.clone().sub(center).normalize();
    const tmp = Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(nrm, tmp).normalize().multiplyScalar(cs * rng.range(0.8, 1.2));
    const upv = new THREE.Vector3().crossVectors(right, nrm).normalize().multiplyScalar(cs * rng.range(0.8, 1.2));
    addCard(leaves, c, right, upv, nrm.clone().lerp(new THREE.Vector3(0, 1, 0), 0.3).normalize(), rng.next());
  }
  return { trunk: trunk.build(), leaves: leaves.build(), H: Hh };
}

// ---------------- desert plants (vertex-coloured, no cards) ----------------
function colorize(g, col) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(typeof col === 'function' ? col(g, i) : col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}
function merge(parts) {
  const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'color'].includes(k)) q.deleteAttribute(k); return q; }));
  g.computeBoundingSphere();
  return g;
}
// narrow-leaf yucca: a rosette of stiff blue-green swords, dead ones bleached at the base,
// sometimes last year's dry flower stalk
function buildYucca(seed) {
  const rng = new RNG(seed);
  const parts = [];
  const n = rng.int(38, 54);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + rng.range(-0.2, 0.2);
    const tilt = Math.pow(i / n, 0.6) * 1.25 + rng.range(-0.08, 0.08); // inner leaves upright, outer ones splay
    const L = rng.range(0.38, 0.62) * (1 - 0.25 * (i / n)), W = 0.022;
    const dead = i > n * 0.82 && rng.chance(0.6);
    const pos = [], nor = [];
    const S = 4;
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const out = new THREE.Vector3().crossVectors(side, dir).normalize();
    const pts = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const p = dir.clone().multiplyScalar(L * t);
      p.y -= (dead ? 0.25 : 0.06) * t * t * L * Math.sin(tilt); // tips droop a little
      const w = W * (1 - t * 0.92);
      pts.push([p.clone().addScaledVector(side, -w), p.clone().addScaledVector(side, w)]);
    }
    for (let s = 0; s < S; s++) {
      const [a0, a1] = pts[s], [b0, b1] = pts[s + 1];
      for (const v of [a0, a1, b1, a0, b1, b0]) { pos.push(v.x, v.y + 0.02, v.z); nor.push(out.x * 0.6, 0.8, out.z * 0.6); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const base = dead ? [0.42, 0.34, 0.22] : [0.2 + rng.range(-0.03, 0.03), 0.28, 0.18];
    parts.push(colorize(g, (gg, k) => { const y = gg.attributes.position.getY(k); const t = Math.min(1, y / 0.4); return dead ? base : [base[0] * (0.6 + 0.5 * t) + 0.08 * t, base[1] * (0.6 + 0.5 * t), base[2] * (0.6 + 0.6 * t)]; }));
  }
  if (rng.chance(0.55)) {
    const h = rng.range(0.9, 1.4);
    const st = new THREE.CylinderGeometry(0.008, 0.016, h, 5, 1);
    st.translate(0, h / 2, 0); st.rotateZ(rng.range(-0.12, 0.12));
    parts.push(colorize(st, [0.36, 0.27, 0.17]));
    for (let k = 0; k < 7; k++) {
      const pod = new THREE.SphereGeometry(0.022, 5, 4); pod.scale(1, 1.6, 1);
      const t = 0.65 + k * 0.05;
      pod.translate(Math.sin(k * 2.1) * 0.035, h * t, Math.cos(k * 2.1) * 0.035);
      parts.push(colorize(pod, [0.3, 0.22, 0.14]));
    }
  }
  return merge(parts);
}
// prickly pear: pads growing off pads, grey-green with a purple blush, a few red fruits
function buildPricklyPear(seed) {
  const rng = new RNG(seed);
  const parts = [];
  const pad = (p, rot, s, depth) => {
    const g = new THREE.SphereGeometry(1, 9, 7);
    g.scale(0.09 * s, 0.12 * s, 0.022 * s);
    g.rotateZ(rot.z); g.rotateY(rot.y);
    g.translate(p.x, p.y, p.z);
    const blush = rng.range(0, 0.5);
    parts.push(colorize(g, (gg, k) => { const y = gg.attributes.position.getY(k) - p.y; const e = Math.min(1, Math.abs(y) / (0.12 * s)); return [0.17 + blush * 0.12 * e, 0.27 - blush * 0.05 * e, 0.13 + blush * 0.06 * e]; }));
    if (depth < 2) {
      const kids = rng.int(depth === 0 ? 2 : 0, depth === 0 ? 3 : 2);
      for (let i = 0; i < kids; i++) {
        const z = rot.z + rng.range(-0.9, 0.9);
        const tip = new THREE.Vector3(-Math.sin(z) * 0.2 * s, Math.cos(z) * 0.2 * s, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot.y);
        pad(p.clone().add(tip), { z, y: rot.y + rng.range(-0.8, 0.8) }, s * 0.85, depth + 1);
      }
    } else if (rng.chance(0.5)) {
      const f = new THREE.SphereGeometry(0.018, 5, 4); f.scale(1, 1.4, 1);
      f.translate(p.x, p.y + 0.12 * s, p.z);
      parts.push(colorize(f, [0.45, 0.04, 0.1]));
    }
  };
  const clumps = rng.int(2, 4);
  for (let c = 0; c < clumps; c++) {
    const a = rng.range(0, 6.28), r = rng.range(0, 0.25);
    pad(new THREE.Vector3(Math.cos(a) * r, 0.08, Math.sin(a) * r), { z: rng.range(-0.5, 0.5), y: rng.range(0, 6.28) }, rng.range(0.9, 1.15), 0);
  }
  return merge(parts);
}
// Mormon tea (Ephedra): a broom of jointed yellow-green stems
function buildEphedra(seed) {
  const rng = new RNG(seed);
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const a = rng.range(0, 6.28), lean = rng.range(0.05, 0.55), h = rng.range(0.35, 0.7) * (1 - lean * 0.4);
    const g = new THREE.CylinderGeometry(0.004, 0.007, h, 3, 1);
    g.translate(0, h / 2, 0); g.rotateZ(lean); g.rotateY(a);
    const c = rng.range(0.85, 1.1);
    parts.push(colorize(g, [0.27 * c, 0.3 * c, 0.1 * c]));
  }
  return merge(parts);
}
// ferns: fronds arching out of damp rock and drooping (optionally with a few red flowers)
function buildFernClump(seed, flowers) {
  const rng = new RNG(seed);
  const pos = [], nor = [], col = [];
  const quad = (a, b, c, d, n, cl) => { for (const v of [a, b, c, a, c, d]) { pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); col.push(...cl); } };
  const fronds = rng.int(6, 9);
  for (let f = 0; f < fronds; f++) {
    const yaw = rng.range(-1.1, 1.1), L = rng.range(0.25, 0.48), lift = rng.range(0.2, 0.7);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const S = 7;
    const green = [rng.range(0.1, 0.16), rng.range(0.24, 0.32), rng.range(0.03, 0.06)];
    for (let i = 1; i <= S; i++) {
      const t = i / S;
      // out and up from the seep, then arching over and hanging down
      const p = dir.clone().multiplyScalar(L * t).add(new THREE.Vector3(0, L * (lift * t - 1.1 * t * t), 0));
      const w = 0.035 * (1 - t * 0.7);
      for (const sg of [-1, 1]) {
        const q = p.clone().addScaledVector(side, sg * w * 2.2);
        const a = p.clone().addScaledVector(dir, -w * 0.5), b = p.clone().addScaledVector(dir, w * 0.5);
        const c = q.clone().addScaledVector(dir, w * 0.6), d = q.clone().addScaledVector(dir, -w * 0.4);
        a.y += 0.004; c.y -= w * 0.6; d.y -= w * 0.6;
        const g = green.map((v) => v * rng.range(0.85, 1.2));
        quad(a, b, c, d, new THREE.Vector3(0, 1, 0), g);
      }
    }
  }
  if (flowers) {
    for (let i = 0; i < rng.int(2, 5); i++) {
      const p = new THREE.Vector3(rng.range(-0.2, 0.2), rng.range(-0.05, 0.12), rng.range(0.08, 0.28));
      const s = 0.022;
      const red = [0.62, 0.05, 0.03];
      quad(p.clone().add(new THREE.Vector3(-s, 0, 0)), p.clone().add(new THREE.Vector3(s, 0, 0)), p.clone().add(new THREE.Vector3(s, s * 1.6, 0.01)), p.clone().add(new THREE.Vector3(-s, s * 1.6, 0.01)), new THREE.Vector3(0, 0, 1), red);
      quad(p.clone().add(new THREE.Vector3(0, 0, -s)), p.clone().add(new THREE.Vector3(0, 0, s)), p.clone().add(new THREE.Vector3(0.01, s * 1.6, s)), p.clone().add(new THREE.Vector3(0.01, s * 1.6, -s)), new THREE.Vector3(1, 0, 0), red);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function makeDesertPlantMaterial(key) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
  patchMaterial(mat, {
    vertexHead: 'varying vec3 vPlantWP;',
    fragmentHead: commonGLSL + '\nvarying vec3 vPlantWP;',
    vertex: { project_vertex: `$\n vPlantWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;` },
    fragment: { color_fragment: `$\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.95), snowCover(vPlantWP) * 0.4);` },
  }, key);
  return mat;
}

// ---------------- grass ----------------
function buildTuft(seed, blades, h, w, bend) {
  const rng = new RNG(seed);
  const pos = [], nor = [], uv = [], rnd = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 0.24;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const facing = rng.range(0, Math.PI * 2);
    const lean = rng.range(0.1, 0.5) * bend;
    const hh = h * rng.range(0.55, 1.1);
    const ww = w * rng.range(0.7, 1.2);
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    const sx = Math.cos(facing) * ww, sz = Math.sin(facing) * ww;
    const base = pos.length / 3;
    const segs = 3;
    const rv = rng.next();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const wt = (1 - t * 0.85) * (i === segs ? 0.0 : 1);
      const px = bx + lx * t * t * hh, pz = bz + lz * t * t * hh, py = t * hh;
      pos.push(px - sx * wt, py, pz - sz * wt, px + sx * wt, py, pz + sz * wt);
      const nx = -Math.sin(facing), nz = Math.cos(facing);
      for (let k = 0; k < 2; k++) { nor.push(nx * 0.35, 0.94, nz * 0.35); uv.push(k, t); rnd.push(rv); }
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2;
      idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 1));
  g.setIndex(idx);
  return g;
}

function makeGrassMaterial(colors, key, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82, alphaToCoverage: true });
  patchMaterial(mat, {
    uniforms: {
      uBaseS: { value: new THREE.Color(...colors.baseS) }, uTipS: { value: new THREE.Color(...colors.tipS) },
      uBaseA: { value: new THREE.Color(...colors.baseA) }, uTipA: { value: new THREE.Color(...colors.tipA) },
      uTransl: { value: 1 }, uGrassStiff: { value: opts.stiff ?? 0.55 },
    },
    vertexHead: /* glsl */`
      ${commonGLSL}
      attribute float aRnd;
      attribute vec3 aTint;
      varying float vT; varying float vR; varying vec3 vTintG; varying vec3 vWorldPos;
      uniform float uGrassStiff;
    `,
    fragmentHead: /* glsl */`
      ${commonGLSL}
      ${contactGLSL}
      varying float vT; varying float vR; varying vec3 vTintG; varying vec3 vWorldPos;
      uniform vec3 uBaseS, uTipS, uBaseA, uTipA;
    `,
    vertex: {
      project_vertex: /* glsl */`
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 basePos = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
        #else
          vec3 basePos = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
        #endif
        vec4 wpos = modelMatrix * mvPosition;
        // deep snow buries the tufts: only their dry tips stand out of it
        wpos.y = basePos.y + (wpos.y - basePos.y) * (1.0 - snowCover(basePos) * 0.72);
        float t = uv.y;
        vec2 w = windField(wpos.xyz, aRnd * 6.28);
        vec2 p = pushField(basePos);
        float k = t * t;
        float hgt = wpos.y - basePos.y;
        vec2 d = (w * uGrassStiff + p * 1.2) * k * max(hgt, 0.05) * 1.2;
        float l = length(d);
        if (l > hgt * 0.9) d *= hgt * 0.9 / l;
        wpos.xz += d;
        wpos.y -= dot(d, d) * 0.5 / max(hgt, 0.2);
        vWorldPos = wpos.xyz;
        mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;
        vT = t; vR = aRnd; vTintG = aTint;
      `,
      worldpos_vertex: `vec4 worldPosition = vec4(vWorldPos, 1.0);`,
    },
    fragment: {
      map_fragment: /* glsl */`
        float camD = length(vWorldPos - cameraPosition);
        diffuseColor.a = smoothstep(0.35, 1.5, camD);
        if (diffuseColor.a < 0.01) discard;
        float autumn = clamp(uSeason, 0.0, 1.0);
        vec3 base = mix(uBaseS, uBaseA, autumn);
        vec3 tip = mix(uTipS, uTipA, autumn);
        vec3 gc = mix(base, tip, smoothstep(0.0, 1.0, vT)) * (0.8 + 0.4 * vR) * vTintG;
        gc = mix(gc, vec3(0.88, 0.9, 0.95), snowCover(vWorldPos) * (1.0 - smoothstep(0.0, 0.55, vT)) * 0.85);
        // tufts crowding a stone sit in its shade
        gc *= 1.0 - contactAO(vWorldPos) * 0.45 * (1.0 - vT * 0.6);
        diffuseColor.rgb = gc;
      `,
      lights_physical_pars_fragment: /* glsl */`$
        void RE_Direct_Grass( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          float back = pow(clamp(dot(geometryViewDir, -directLight.direction), 0.0, 1.0), 4.0);
          reflectedLight.directDiffuse += material.diffuseColor * directLight.color * back * vT * 0.9;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Grass
      `,
      normal_fragment_maps: `normal = normalize(vNormal);`,
      // fake AO at the base
      aomap_fragment: `$ reflectedLight.indirectDiffuse *= mix(0.55, 1.0, vT); reflectedLight.directDiffuse *= mix(0.7, 1.0, vT);`,
    },
  }, key);
  return mat;
}

// ---------------- flowers ----------------
function makeFlowerAtlas() {
  return canvasTexture(1024, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    const cell = 256;
    const stem = (x0, top, col = '#4f6b2a') => {
      g.strokeStyle = col; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, H); g.quadraticCurveTo(x0 + 8, (H + top) / 2, x0, top); g.stroke();
      // leaves
      g.fillStyle = col;
      for (let i = 0; i < 3; i++) {
        const y = H - 40 - i * 40; const s = i % 2 ? 1 : -1;
        g.beginPath(); g.ellipse(x0 + s * 18, y, 22, 6, s * 0.6, 0, Math.PI * 2); g.fill();
      }
    };
    // 0: Colorado columbine
    {
      const cx = cell * 0.5, cy = 70;
      stem(cx, cy + 20);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i / 5 * Math.PI * 2;
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.fillStyle = '#5a6fd6'; g.beginPath(); g.ellipse(0, -34, 14, 36, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#7d8ff0'; g.beginPath(); g.ellipse(0, -30, 7, 24, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i + 0.5) / 5 * Math.PI * 2;
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.fillStyle = '#f6f3ea'; g.beginPath(); g.ellipse(0, -20, 11, 20, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      g.fillStyle = '#f2c84a'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
    }
    // 1: Indian paintbrush
    {
      const cx = cell * 1.5;
      stem(cx, 60, '#5d6b2c');
      for (let i = 0; i < 26; i++) {
        const y = 40 + i * 4.2, w = 22 - i * 0.35;
        g.fillStyle = i % 3 === 0 ? '#ff6a2a' : i % 3 === 1 ? '#e8401e' : '#f58a3c';
        g.beginPath(); g.ellipse(cx + Math.sin(i * 2.1) * w * 0.6, y, 12, 9, Math.sin(i), 0, Math.PI * 2); g.fill();
      }
    }
    // 2: purple aster
    {
      const cx = cell * 2.5, cy = 74;
      stem(cx, cy + 10);
      g.fillStyle = '#a77ad9';
      for (let i = 0; i < 22; i++) {
        const a = i / 22 * Math.PI * 2;
        g.save(); g.translate(cx, cy); g.rotate(a);
        g.beginPath(); g.ellipse(0, -30, 6, 26, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.fillStyle = '#f4c534'; g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d9962a'; g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.fill();
    }
    // 3: blanketflower / yellow daisy
    {
      const cx = cell * 3.5, cy = 74;
      stem(cx, cy + 10, '#5c7030');
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        g.save(); g.translate(cx, cy); g.rotate(a);
        const grad = g.createLinearGradient(0, 0, 0, -56);
        grad.addColorStop(0, '#c8321e'); grad.addColorStop(0.55, '#f08a24'); grad.addColorStop(1, '#ffd23a');
        g.fillStyle = grad; g.beginPath(); g.ellipse(0, -30, 11, 28, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.fillStyle = '#6b2414'; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();
    }
  });
}

function buildFlowerGeo() {
  // 3 crossed vertical quads, base at y=0, size 1x1 (scaled per instance)
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI;
    const dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
    for (let k = 0; k < 4; k++) nor.push(0, 1, 0);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function makeFlowerMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, alphaToCoverage: true });
  patchMaterial(mat, {
    vertexHead: /* glsl */`${commonGLSL}
      attribute float aType; attribute float aBloom; varying vec3 vWorldPos; varying float vBloomF;`,
    fragmentHead: `${commonGLSL} varying float vBloomF;`,
    vertex: {
      uv_vertex: `$ vMapUv.x = (vMapUv.x + aType) * 0.25;`,
      project_vertex: /* glsl */`
        vec3 tp = transformed;
        // bloom pop: scale up around the head
        tp.xz *= 1.0 + aBloom * 0.5 * smoothstep(0.4, 1.0, tp.y);
        tp.y *= 1.0 + aBloom * 0.15;
        vec4 mvPosition = instanceMatrix * vec4(tp, 1.0);
        vec3 basePos = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
        vec4 wpos = modelMatrix * mvPosition;
        float t = tp.y;
        vec2 w = windField(wpos.xyz, basePos.x * 3.1) * 0.7 + pushField(basePos) * 1.4;
        float hgt = wpos.y - basePos.y;
        wpos.xz += w * t * t * hgt * 0.8 + vec2(sin(uTime * 20.0 + basePos.x), cos(uTime * 17.0)) * aBloom * 0.06 * t;
        vWorldPos = wpos.xyz;
        mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;
        vBloomF = aBloom;
      `,
      worldpos_vertex: `vec4 worldPosition = vec4(vWorldPos, 1.0);`,
    },
    fragment: {
      map_fragment: `$
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.36, 0.22), smoothstep(1.2, 1.8, uSeason) * 0.8);
        if (uSeason > 1.85) discard;`,
      emissivemap_fragment: `$ totalEmissiveRadiance += diffuseColor.rgb * vBloomF * 0.6;`,
    },
  }, 'flower');
  return mat;
}

// ---------------- the drift log at the plunge pool ----------------
// A spruce the creek brought down in a flood: bark mostly gone and the wood weathered silver, long checks
// split along the grain, a torn root wad at one end, snapped-off branch stubs, a splintered break at the other.
// Built along +z (root end at z = 0), u around and v along it in metres.
function buildDriftLog(seed, LEN = 5.2, R0 = 0.3, roots = true) {
  const rng = new RNG(seed), nz = new Simplex(seed);
  const NA = 18, NL = 56;
  const axis = (t) => new THREE.Vector3(0.09 * Math.sin(t * 2.4 + 0.4), 0.07 * Math.sin(Math.PI * t), t * LEN);
  const rad = (t, a) => {
    let r = R0 * (1 - 0.34 * t) + (roots ? R0 * 0.62 : 0) * Math.exp(-t * LEN / 0.45); // taper, flaring into the root collar
    r *= 1 + 0.06 * Math.sin(3 * a + t * 3) + 0.05 * nz.noise2(Math.cos(a) * 1.3 + t * 6, Math.sin(a) * 1.3); // buttress lobes, knots
    return r;
  };
  const pos = [], uv = [], idx = [];
  // the broken top: the last ring's staves run on as splinters of different lengths
  const splinter = Array.from({ length: NA }, (_, i) => Math.max(0, nz.noise2(i * 0.9, 3.1)) * 0.5 + (rng.chance(0.2) ? rng.range(0.1, 0.35) : 0));
  for (let j = 0; j <= NL; j++) {
    const t = j / NL, c = axis(t);
    for (let i = 0; i <= NA; i++) {
      const a = (i % NA) / NA * Math.PI * 2, r = rad(t, a) * (j === NL ? 0.75 : 1);
      const ext = j === NL ? splinter[i % NA] : 0;
      pos.push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, c.z + ext);
      uv.push(i / NA, t * LEN + ext);
    }
  }
  for (let j = 0; j < NL; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // end caps: the root end's torn face and the top's broken heart (pulled in a little)
  const capAt = (j, z, inward) => {
    const ci = pos.length / 3, c = axis(j / NL);
    pos.push(c.x, c.y, c.z + z); uv.push(0.5, j / NL * LEN + z);
    for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1; if (inward) idx.push(ci, b, a); else idx.push(ci, a, b); }
  };
  capAt(0, 0.06, false);
  capAt(NL, -0.04, true);
  const main = new THREE.BufferGeometry();
  main.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  main.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  main.setIndex(idx);
  main.computeVertexNormals();
  const parts = [main.toNonIndexed()];
  // the root wad: thick roots torn off short, splaying back from the collar
  for (let i = 0; i < (roots ? 10 : 0); i++) {
    const a = i / 10 * Math.PI * 2 + rng.range(-0.25, 0.25), len = rng.range(0.4, 1.2) * R0 / 0.3, r0 = rng.range(0.05, 0.1) * R0 / 0.3;
    const d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const p0 = new THREE.Vector3(d.x * 0.2, d.y * 0.2, 0.15);
    const p1 = p0.clone().addScaledVector(d, len * 0.5).add(new THREE.Vector3(0, 0, -len * 0.15));
    const p2 = p0.clone().addScaledVector(d, len).add(new THREE.Vector3(rng.range(-0.1, 0.1), rng.range(-0.1, 0.1), -len * 0.35));
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const tg = new THREE.TubeGeometry(curve, 8, r0, 6, false);
    const pa = tg.attributes.position, ax = new THREE.Vector3();
    // taper toward the snapped tip
    for (let k = 0; k < pa.count; k++) {
      const q = Math.floor(k / 7) / 8, cc = curve.getPoint(Math.min(1, q));
      ax.fromBufferAttribute(pa, k).sub(cc).multiplyScalar(1 - q * 0.7).add(cc);
      pa.setXYZ(k, ax.x, ax.y, ax.z);
    }
    tg.computeVertexNormals();
    parts.push(tg.toNonIndexed());
  }
  // branch stubs: dead limbs snapped off a hand's width to a forearm's length from the stem
  for (let i = 0; i < 6; i++) {
    const t = rng.range(0.22, 0.95), a = rng.range(0, Math.PI * 2), c = axis(t);
    const d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.45).normalize();
    const r = rad(t, a), len = rng.range(0.06, 0.28) * R0 / 0.3;
    const g = new THREE.CylinderGeometry(rng.range(0.022, 0.034) * R0 / 0.3, rng.range(0.04, 0.055) * R0 / 0.3, len + r, 7, 1);
    g.translate(0, (len + r) / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    g.translate(c.x, c.y, c.z);
    parts.push(g.toNonIndexed());
  }
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

function makeDriftwoodMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  patchMaterial(mat, {
    vertexHead: 'varying vec3 vDW; varying vec3 vDN; varying vec2 vLUv;',
    fragmentHead: `${commonGLSL}\nvarying vec3 vDW; varying vec3 vDN; varying vec2 vLUv; float dWet;`,
    vertex: { project_vertex: '$\n vDW = (modelMatrix * vec4(transformed, 1.0)).xyz; vDN = normalize(mat3(modelMatrix) * objectNormal); vLUv = uv;' },
    fragment: {
      map_fragment: /* glsl */`
        vec2 lu = vLUv;
        float warp = texture2D(uNoise, vec2(lu.x * 2.0, lu.y * 0.05)).r;
        float grain = texture2D(uNoise, vec2(lu.x * 7.0 + warp * 0.8, lu.y * 0.09)).b;
        float fine = texture2D(uNoise, vec2(lu.x * 23.0 + warp, lu.y * 0.4)).g;
        // weathered, sun-silvered wood with long checks along the grain
        vec3 wood = mix(vec3(0.2, 0.185, 0.165), vec3(0.37, 0.35, 0.31), grain) * (0.85 + 0.25 * fine);
        wood = mix(wood, wood * vec3(1.06, 0.98, 0.88), smoothstep(0.5, 0.8, warp) * 0.5); // tea-stained by the water
        float check = smoothstep(0.74, 0.8, texture2D(uNoise, vec2(lu.x * 11.0 + warp * 0.3, lu.y * 0.035)).g);
        wood *= 1.0 - check * 0.6;
        // a few last plates of bark, mostly on the underside and toward the root end
        vec4 bn = texture2D(uNoise, lu * vec2(1.6, 0.21));
        float barkM = smoothstep(0.58, 0.66, bn.r + (1.0 - clamp(lu.y / 5.0, 0.0, 1.0)) * 0.12 - vDN.y * 0.18);
        vec3 bark = mix(vec3(0.11, 0.075, 0.055), vec3(0.24, 0.16, 0.11), texture2D(uNoise, lu * vec2(6.0, 1.5)).g);
        vec3 col = mix(wood, bark, barkM);
        // soaked dark in the pool and the spray, a slick of green algae along the waterline
        float wl = waterLevelAt(vDW.z);
        dWet = 1.0 - smoothstep(0.0, 0.45, vDW.y - wl);
        float spray = 1.0 - smoothstep(2.0, 6.0, length(vec2(vDW.x - profileA(${WF_Z.toFixed(2)}).x, vDW.z - ${(WF_Z + 1).toFixed(2)})));
        dWet = max(dWet, spray * 0.6 + uWet * 0.5);
        col *= mix(1.0, 0.48, dWet);
        col = mix(col, vec3(0.07, 0.12, 0.04), (1.0 - smoothstep(0.0, 0.14, abs(vDW.y - wl - 0.03))) * 0.7);
        col = mix(col, vec3(0.9, 0.93, 0.97), snowCover(vDW) * smoothstep(0.6, 0.9, vDN.y) * 0.8);
        diffuseColor.rgb *= col;`,
      roughnessmap_fragment: 'float roughnessFactor = mix(0.88, 0.42, dWet);',
    },
  }, 'driftwood');
  return mat;
}

// ---------------- the vegetation system ----------------
export class Vegetation {
  constructor(scene, rocks, quality = 1, grassDensity = 1) {
    this.scene = scene;
    this.rng = new RNG(4242);
    this.rocks = rocks;
    this.trees = [];       // interactive trees
    this.flowers = [];     // interactive flowers
    this.shrubs = [];
    this.grassChunks = [];
    this.quality = quality;
    this.lodScale = 1;
    this.grassDensity = grassDensity;
    this.grassFar = 125;
    this.buildRockIndex();
    this.buildTrees();
    this.buildShrubs();
    this.buildDesert();
    this.buildHangingGarden();
    this.buildGrass();
    this.buildFlowers();
    this.buildLogs();
  }

  buildRockIndex() {
    this.rockGrid = new Map();
    for (const r of this.rocks) {
      const k = `${Math.floor(r.x / 6)},${Math.floor(r.z / 6)}`;
      if (!this.rockGrid.has(k)) this.rockGrid.set(k, []);
      this.rockGrid.get(k).push(r);
    }
  }
  // within a rock's footprint (k scales its radius: grass tufts may lean against the stone)
  nearRock(x, z, pad = 0.3, k = 1) {
    const cx = Math.floor(x / 6), cz = Math.floor(z / 6);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.rockGrid.get(`${cx + i},${cz + j}`);
      if (!l) continue;
      for (const r of l) { const dx = x - r.x, dz = z - r.z; if (dx * dx + dz * dz < (r.r * k + pad) ** 2) return true; }
    }
    return false;
  }

  // Tries to find positions satisfying test(x, z, info) -> weight (0..1)
  scatter(count, test, opts = {}) {
    const rng = this.rng;
    const out = [];
    const tries = count * (opts.tries || 12);
    const ext = opts.extent || BOUNDS + 25;
    for (let i = 0; i < tries && out.length < count; i++) {
      const x = rng.range(-ext, ext), z = rng.range(-ext, ext);
      const g = groundAt(x, z);
      const wl = waterLevel(z);
      const above = g - wl;
      if (above < (opts.minAbove ?? 0.12) || inLake(x, z, -0.3)) continue;
      const n = normalAt(x, z);
      const b = bioAt(x, z);
      const u = Math.abs(lateral(x, z)) / streamHalfW(z);
      const w = test({ x, z, g, above, n, b, u, rng });
      if (w <= 0 || rng.next() > w) continue;
      if (trailNear(x, z).d < (opts.trailPad ?? 1.6) || campsiteAt(x, z, opts.trailPad ?? 1.6)) continue;
      if (opts.rockPad !== undefined && this.nearRock(x, z, opts.rockPad)) continue;
      if (opts.spacing && out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < opts.spacing ** 2)) continue;
      out.push({ x, z, y: g, n, b, u });
    }
    return out;
  }

  makeTreeSet(name, builders, placements, matOpts, barkKind, tintFn) {
    const variants = builders.map((f, i) => f(i));
    const H = variants.reduce((a, v) => a + v.H, 0) / variants.length;
    const leafMat = makeFoliageMaterial({ ...matOpts, treeH: H, key: name + '-leaf', isLeaf: true });
    const leafDepth = makeFoliageDepthMaterial(matOpts.map, true, { stiff: matOpts.stiff, flutter: matOpts.flutter, treeH: H, key: name + '-ld' });
    const barkMat = makeBarkMaterial(barkKind, { stiff: matOpts.stiff, treeH: H });
    const barkDepth = makeFoliageDepthMaterial(null, false, { stiff: matOpts.stiff, treeH: H, key: name + '-bd' });
    const per = variants.map(() => []);
    placements.forEach((p, i) => per[i % variants.length].push(p));
    const rng = this.rng;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    variants.forEach((vr, vi) => {
      const list = per[vi];
      if (!list.length) return;
      const n = list.length;
      const tint = new Float32Array(n * 3);
      const shake = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      shake.setUsage(THREE.DynamicDrawUsage);
      const leafGeo = vr.leaves.clone(), trunkGeo = vr.trunk.clone();
      const leafIM = new THREE.InstancedMesh(leafGeo, leafMat, n);
      const trunkIM = new THREE.InstancedMesh(trunkGeo, barkMat, n);
      list.forEach((p, i) => {
        const sc = p.scale ?? rng.range(0.75, 1.2);
        // conifers stand a degree or two off true, never quite in step with each other
        if (name === 'spruce') q.setFromEuler(new THREE.Euler(rng.range(-0.035, 0.035), rng.range(0, Math.PI * 2), rng.range(-0.035, 0.035), 'YXZ'));
        else q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
        s.set(sc, sc, sc);
        v.set(p.x, p.y - 0.15, p.z);
        m4.compose(v, q, s);
        leafIM.setMatrixAt(i, m4); trunkIM.setMatrixAt(i, m4);
        const t = tintFn(p, rng);
        tint[i * 3] = t[0]; tint[i * 3 + 1] = t[1]; tint[i * 3 + 2] = t[2];
        this.trees.push({ kind: name, x: p.x, z: p.z, y: p.y, h: vr.H * sc, r: (name === 'spruce' ? 2.5 : name === 'aspen' ? 2.0 : 1.6) * sc, shakeAttr: shake, index: i, shake: 0, leafIM });
      });
      const tintAttr = new THREE.InstancedBufferAttribute(tint, 3);
      for (const g of [leafGeo, trunkGeo]) { g.setAttribute('aTint', tintAttr); g.setAttribute('aShake', shake); }
      leafIM.customDepthMaterial = leafDepth; trunkIM.customDepthMaterial = barkDepth;
      for (const im of [leafIM, trunkIM]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.scene.add(im); }
    });
  }

  buildTrees() {
    const rng = this.rng;
    const grove = (x, z) => noise.fbm2(x * 0.018, z * 0.018, 3);
    // Aspens: groves (clones) on the forest side & meadow edges
    const aspens = this.scatter(Math.round(230 * this.quality + 40), ({ x, z, g, n, b, u, above }) => {
      if (n.y < 0.82 || u < 1.9 || above < 0.5) return 0;
      const gv = grove(x, z);
      return (b.forest * 0.9 + 0.12) * smoothstep(0.0, 0.25, gv) * (1 - b.canyon) * (1 - b.arid) * (1 - smoothstep(26, 48, g));
    }, { rockPad: 0.8, spacing: 2.6 });
    const aspenTex = makeLeafClusterTexture('aspen', 11);
    this.makeTreeSet('aspen', [buildAspen.bind(null, 1), buildAspen.bind(null, 2), buildAspen.bind(null, 3), buildAspen.bind(null, 4)], aspens, {
      map: aspenTex, flutter: 0.06, stiff: 0.022, deciduous: true, transl: 1.0, translK: 0.38,
      colors: { sA: [0.16, 0.3, 0.06], sB: [0.3, 0.42, 0.1], aA: [0.88, 0.42, 0.03], aB: [0.98, 0.68, 0.08] },
    }, 0, (p, r) => {
      // per-clone autumn timing: some still greenish, some orange
      const g = grove(p.x * 1.7, p.z * 1.7);
      return [r.range(0.92, 1.08), r.range(0.9, 1.05), clamp(0.6 + g * 1.4 + r.range(-0.1, 0.1), 0.35, 1.0)];
    });

    // Spruce: higher on forest slopes
    // the timberline: a ragged edge a little below the tarn, where the last trees go stunted and sparse
    const treeLine = (x, z) => 84 + noise.fbm2(x * 0.03 + 9, z * 0.03, 2) * 16;
    const spruces = this.scatter(Math.round(640 * this.quality + 30), ({ x, z, g, n, b, u, above }) => {
      if (n.y < 0.68 || u < 2.2 || above < 0.6) return 0;
      const tl = treeLine(x, z);
      return b.forest * smoothstep(1.5, 12, above) * (grove(x, z) < 0.05 ? 1 : 0.2) * (1 - smoothstep(tl - 34, tl, g) * 0.92);
    }, { rockPad: 0.9, spacing: 3.2 });
    // ...and shrink toward it (krummholz)
    for (const p of spruces) { const tl = treeLine(p.x, p.z); p.scale = rng.range(0.8, 1.15) * (1 - 0.6 * smoothstep(tl - 30, tl + 4, p.y)); }
    // a few spruce standing over the falls, as they do over every mountain cascade
    for (let i = 0, n = 0; i < 300 && n < 7; i++) {
      const z = WF_Z + rng.range(-7, 9), hw = streamHalfW(z);
      const lat = (rng.chance(0.7) ? -1 : 1) * hw * rng.range(1.9, 3.6);
      const x = streamCenter(z) + lat * Math.sqrt(1 + streamSlope(z) ** 2);
      const y = groundAt(x, z);
      if (normalAt(x, z).y < 0.8 || y < waterLevel(z) + 0.5 || this.nearRock(x, z, 1.0)) continue;
      if (spruces.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 9)) continue;
      spruces.push({ x, z, y, scale: rng.range(0.8, 1.15) });
      n++;
    }
    const needleTex = makeNeedleTexture(3);
    const forms = ['spire', 'spire', 'bent', 'double', 'spire', 'blunt', 'spike', 'column', 'bent', 'column'];
    this.makeTreeSet('spruce', forms.map((f, i) => buildSpruce.bind(null, 7 + i, f)), spruces, {
      map: needleTex, flutter: 0.0, stiff: 0.012, deciduous: false, transl: 0.3, translK: 0.25, rough: 0.85,
      colors: { sA: [0.035, 0.075, 0.04], sB: [0.085, 0.15, 0.08], aA: [0.04, 0.08, 0.045], aB: [0.09, 0.15, 0.09] },
    }, 1, (p, r) => [r.range(0.85, 1.1), r.range(0.9, 1.1), 1]);

    // Junipers & pinyon on the canyon side and scattered over the desert floor
    const junipers = this.scatter(Math.round(190 * this.quality + 20), ({ n, b, u, above }) => {
      if (n.y < 0.8 || u < 2.5 || above < 0.6) return 0;
      return b.canyon * 0.9 + b.arid * 0.45 + (1 - b.forest) * 0.05;
    }, { rockPad: 0.6, spacing: 4.5 });
    const sprayTex = makeScaleSprayTexture(5);
    this.makeTreeSet('juniper', [buildJuniper.bind(null, 21), buildJuniper.bind(null, 22), buildJuniper.bind(null, 23)], junipers, {
      map: sprayTex, flutter: 0.0, stiff: 0.02, deciduous: false, transl: 0.3, translK: 0.2,
      colors: { sA: [0.12, 0.15, 0.1], sB: [0.24, 0.26, 0.17], aA: [0.12, 0.15, 0.1], aB: [0.24, 0.26, 0.17] },
    }, 2, (p, r) => [r.range(0.85, 1.1), r.range(0.9, 1.1), 1]);
  }

  buildShrubs() {
    const sets = [
      { kind: 'sage', count: 900, tex: makeScaleSprayTexture(41), colors: { sA: [0.36, 0.38, 0.3], sB: [0.55, 0.56, 0.47], aA: [0.38, 0.38, 0.3], aB: [0.56, 0.55, 0.46] },
        test: ({ n, b, u }) => (n.y < 0.8 || u < 2.5) ? 0 : (b.canyon * 0.6 + b.arid * 0.9 + (1 - b.forest) * 0.08) },
      { kind: 'rabbit', count: 340, tex: makeScaleSprayTexture(42, true), colors: { sA: [0.3, 0.38, 0.18], sB: [0.4, 0.46, 0.24], aA: [0.34, 0.38, 0.2], aB: [0.44, 0.46, 0.26], flower: [1.0, 0.78, 0.08] },
        test: ({ n, b, u }) => (n.y < 0.8 || u < 2.2) ? 0 : (b.canyon * 0.4 + b.arid * 0.6 + (1 - b.forest) * 0.12) },
      { kind: 'willow', count: 170, tex: makeLeafClusterTexture('willow', 43), colors: { sA: [0.18, 0.32, 0.08], sB: [0.3, 0.4, 0.12], aA: [0.85, 0.5, 0.08], aB: [0.92, 0.72, 0.2] },
        test: ({ n, b, u, above }) => (n.y < 0.75 || u < 1.25 || u > 3.2 - b.arid * 0.9 || above > 2.2) ? 0 : 1, deciduous: true },
    ];
    const rng = this.rng;
    for (const set of sets) {
      const pl = this.scatter(Math.round(set.count * this.quality), set.test, { rockPad: 0.4, spacing: set.kind === 'willow' ? 1.6 : 1.0 });
      const builders = [0, 1, 2].map((i) => () => buildShrub(100 + i + set.kind.length * 10, set.kind));
      this.makeTreeSet(set.kind, builders, pl.map((p) => ({ ...p, scale: rng.range(0.7, 1.3) })), {
        map: set.tex, flutter: set.kind === 'willow' ? 0.04 : 0.01, stiff: set.kind === 'willow' ? 0.05 : 0.04, deciduous: !!set.deciduous, transl: 0.8, translK: 0.4,
        colors: set.colors,
      }, set.kind === 'willow' ? 3 : 1, (p, r) => [r.range(0.85, 1.1), r.range(0.9, 1.1), r.range(0.6, 1.0)]);
    }
    // willow stems: deep red (red-osier dogwood)
    for (const m of this.scene.children) {
      if (m.isInstancedMesh && m.material.userData && m.material.customProgramCacheKey && m.material.customProgramCacheKey() === 'bark3') {
        // handled in bark shader via kind 3
      }
    }
  }

  buildDesert() {
    const sets = [
      { kind: 'yucca', builders: [buildYucca.bind(null, 61), buildYucca.bind(null, 62), buildYucca.bind(null, 63)], count: 260, spacing: 1.2, w: (b) => b.arid * 0.8 + b.canyon * 0.3, s: [0.75, 1.25] },
      { kind: 'pear', builders: [buildPricklyPear.bind(null, 71), buildPricklyPear.bind(null, 72), buildPricklyPear.bind(null, 73)], count: 220, spacing: 0.9, w: (b) => b.arid * 0.7 + b.canyon * 0.3, s: [0.8, 1.4] },
      { kind: 'ephedra', builders: [buildEphedra.bind(null, 81), buildEphedra.bind(null, 82)], count: 240, spacing: 1.0, w: (b) => b.arid * 0.7 + b.canyon * 0.5, s: [0.8, 1.3] },
    ];
    const rng = this.rng;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const set of sets) {
      const pl = this.scatter(Math.round(set.count * this.quality), ({ n, b, u }) => (n.y < 0.82 || u < 2.6) ? 0 : set.w(b), { rockPad: 0.3, spacing: set.spacing });
      const mat = makeDesertPlantMaterial('desert-' + set.kind);
      set.builders.forEach((f, vi) => {
        const list = pl.filter((_, i) => i % set.builders.length === vi);
        if (!list.length) return;
        const im = new THREE.InstancedMesh(f(), mat, list.length);
        list.forEach((p, i) => {
          const k = rng.range(...set.s);
          q.setFromAxisAngle(up, rng.range(0, 6.28));
          m4.compose(v.set(p.x, p.y - 0.03, p.z), q, sc.set(k, k * rng.range(0.85, 1.15), k));
          im.setMatrixAt(i, m4);
          this.shrubs.push({ kind: set.kind, x: p.x, z: p.z, y: p.y, r: 0.4 * k });
        });
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
        this.scene.add(im);
      });
    }
  }

  // ferns and moss-loving greenery tucked into the damp walls and boulder gaps around the falls
  buildHangingGarden() {
    const rng = new RNG(91);
    const mat = makeDesertPlantMaterial('garden');
    const geos = [buildFernClump(1, false), buildFernClump(2, false), buildFernClump(3, false)];
    const lists = geos.map(() => []);
    for (let i = 0; i < 6000 && lists.reduce((a, l) => a + l.length, 0) < 260; i++) {
      const z = WF_Z + rng.range(-3.5, WF_LEN + 6);
      const hw = streamHalfW(z);
      const lat = (rng.chance(0.5) ? 1 : -1) * hw * rng.range(0.85, 2.1);
      const x = streamCenter(z) + lat * Math.sqrt(1 + streamSlope(z) ** 2);
      const y = groundAt(x, z), n = normalAt(x, z);
      if (n.y > 0.9 || y < waterLevel(z) + 0.06 || y > waterLevel(z) + 2.6 || this.nearRock(x, z, 0.05)) continue;
      // thickest on the steep damp faces right beside the spray
      if (rng.next() > (1 - n.y) * 2.5 + 0.15 - Math.abs(z - WF_Z) * 0.04) continue;
      lists[rng.int(0, geos.length - 1)].push({ x, y, z, yaw: Math.atan2(n.x, n.z), s: rng.range(0.8, 1.35) });
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    geos.forEach((geo, gi) => {
      const list = lists[gi];
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.yaw + rng.range(-0.3, 0.3));
        m4.compose(v.set(p.x, p.y + 0.02, p.z), q, sc.set(p.s, p.s, p.s));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = false; im.receiveShadow = true; im.computeBoundingSphere();
      this.scene.add(im);
    });
  }

  buildGrass() {
    const rng = this.rng;
    const tufts = [buildTuft(1, 9, 0.55, 0.024, 1), buildTuft(2, 8, 0.75, 0.022, 1.2), buildTuft(3, 10, 0.42, 0.026, 0.8)];
    const meadowMat = makeGrassMaterial({ baseS: [0.08, 0.14, 0.03], tipS: [0.3, 0.45, 0.12], baseA: [0.16, 0.11, 0.05], tipA: [0.6, 0.43, 0.19] }, 'grass');
    // desert bunchgrass (Indian ricegrass, galleta): fine, upright, straw-coloured clumps
    const dryTufts = [buildTuft(4, 16, 0.5, 0.01, 0.6), buildTuft(5, 12, 0.36, 0.012, 0.9), buildTuft(6, 20, 0.62, 0.009, 0.5)];
    const dryMat = makeGrassMaterial({ baseS: [0.2, 0.17, 0.08], tipS: [0.62, 0.53, 0.3], baseA: [0.22, 0.16, 0.08], tipA: [0.68, 0.55, 0.32] }, 'grass');
    const reedGeo = buildTuft(9, 9, 1.5, 0.018, 0.5);
    const reedMat = makeGrassMaterial({ baseS: [0.04, 0.09, 0.03], tipS: [0.22, 0.36, 0.1], baseA: [0.08, 0.1, 0.03], tipA: [0.55, 0.48, 0.2] }, 'grass', { stiff: 0.3 });
    const CH = 24;
    const chunks = new Map();
    const getChunk = (x, z) => {
      const k = `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
      if (!chunks.has(k)) chunks.set(k, { items: [], reeds: [], cx: (Math.floor(x / CH) + 0.5) * CH, cz: (Math.floor(z / CH) + 0.5) * CH });
      return chunks.get(k);
    };
    const total = Math.round(190000 * this.quality * this.grassDensity);
    const ext = BOUNDS + 18;
    let placed = 0;
    for (let i = 0; i < total * 3 && placed < total; i++) {
      const x = rng.range(-ext, ext), z = rng.range(-ext, ext);
      const wl = waterLevel(z), g = groundAt(x, z);
      const above = g - wl;
      if (above < 0.04 || inLake(x, z, -0.15)) continue;
      const n = normalAt(x, z);
      if (n.y < 0.78) continue;
      const b = bioAt(x, z);
      const u = Math.abs(lateral(x, z)) / streamHalfW(z);
      // density
      let d = 1.0;
      d *= 1 - b.canyon * 0.75;
      d *= 1 - b.forest * 0.35;
      // the desert floor is mostly bare sand between scattered bunchgrass
      // high on the mountain the turf is short, tawny and thin, and gives out under the snow
      const alp = smoothstep(52, 82, g + rng.range(-8, 8)) * b.forest;
      const dry = b.arid > 0.35 + rng.range(-0.15, 0.15) || alp > 0.5;
      d *= 1 - b.arid * 0.88;
      d *= 1 - smoothstep(70, 108, g) * 0.85 * b.forest;
      d *= smoothstep(1.02, 1.35, u);
      d *= 1 - outcropBand(x, z) * 0.8; // bare bedrock along the falls' step
      const patch = noise.fbm2(x * 0.05, z * 0.05, 2);
      d *= smoothstep(-0.45, 0.15, patch);
      if (rng.next() > d) continue;
      // the trail: a thinly grassed tread in the middle, grass closing in at the edges
      const td = trailNear(x, z).d;
      if (td < 0.8 && rng.next() > 0.3 + smoothstep(0.2, 0.8, td) * 0.7) continue;
      if (this.nearRock(x, z, 0, 0.8)) continue;
      const c = getChunk(x, z);
      const tall = b.riparian;
      c.items.push({ x, z, y: g, s: rng.range(0.7, 1.25) * (1 + tall * 0.5) * (1 - b.canyon * 0.3) * (1 - alp * 0.45), v: rng.int(0, 2) + (dry ? 3 : 0), tint: [rng.range(0.85, 1.12), rng.range(0.85, 1.1), rng.range(0.85, 1.1)] });
      placed++;
    }
    // reeds / sedges at the water's edge (slow water)
    for (let i = 0; i < 9000 * this.quality; i++) {
      const z = rng.range(-ext, ext);
      const hw = streamHalfW(z);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * hw * rng.range(0.85, 1.3);
      const x = streamCenter(z) + lat * 1.0;
      const g = groundAt(x, z), wl = waterLevel(z);
      if (g < wl - 0.25 || g > wl + 0.35) continue;
      if (Math.abs(z - WF_Z) < 4) continue;
      if (noise.fbm2(x * 0.08, z * 0.08, 2) < 0.05) continue;
      if (this.nearRock(x, z, 0.1)) continue;
      getChunk(x, z).reeds.push({ x, z, y: g, s: rng.range(0.6, 1.2), tint: [rng.range(0.9, 1.1), rng.range(0.9, 1.1), 1] });
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (const c of chunks.values()) {
      const group = new THREE.Group();
      group.userData.center = new THREE.Vector3(c.cx, 0, c.cz);
      for (let v = 0; v < 6; v++) {
        const list = c.items.filter((it) => it.v === v);
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
        if (!list.length) continue;
        const geo = (v < 3 ? tufts[v] : dryTufts[v - 3]).clone();
        const im = new THREE.InstancedMesh(geo, v < 3 ? meadowMat : dryMat, list.length);
        const tint = new Float32Array(list.length * 3);
        list.forEach((it, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
          sc.set(it.s, it.s * rng.range(0.8, 1.2), it.s); p.set(it.x, it.y - 0.03, it.z);
          m4.compose(p, q, sc); im.setMatrixAt(i, m4);
          tint.set(it.tint, i * 3);
        });
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
        im.receiveShadow = true; im.castShadow = false;
        im.layers.set(1);
        im.userData.full = list.length;
        im.computeBoundingSphere();
        group.add(im);
      }
      if (c.reeds.length) {
        const geo = reedGeo.clone();
        const im = new THREE.InstancedMesh(geo, reedMat, c.reeds.length);
        const tint = new Float32Array(c.reeds.length * 3);
        c.reeds.forEach((it, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
          sc.set(it.s, it.s, it.s); p.set(it.x, it.y - 0.05, it.z);
          m4.compose(p, q, sc); im.setMatrixAt(i, m4); tint.set(it.tint, i * 3);
        });
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
        im.receiveShadow = true; im.castShadow = true; im.computeBoundingSphere();
        group.add(im);
      }
      this.scene.add(group);
      this.grassChunks.push(group);
    }
  }

  buildFlowers() {
    const rng = this.rng;
    const atlas = makeFlowerAtlas();
    const mat = makeFlowerMaterial(atlas);
    const geo = buildFlowerGeo();
    const pl = [];
    // flowers in patches
    const centers = this.scatter(70, ({ n, b, u }) => (n.y < 0.85 || u < 1.4) ? 0 : (1 - b.canyon * 0.8) * (1 - b.arid * 0.75), {});
    for (const c of centers) {
      const type = c.b.riparian > 0.5 ? (rng.chance(0.6) ? 0 : 2) : c.b.forest > 0.5 ? rng.pick([0, 0, 2]) : rng.pick([1, 2, 3, 3]);
      const cnt = rng.int(6, 16);
      for (let i = 0; i < cnt; i++) {
        const x = c.x + rng.gauss() * 2.2, z = c.z + rng.gauss() * 2.2;
        const g = groundAt(x, z);
        if (g < waterLevel(z) + 0.1 || normalAt(x, z).y < 0.8 || trailNear(x, z).d < 0.9) continue;
        pl.push({ x, z, y: g, type: rng.chance(0.85) ? type : rng.int(0, 3), s: rng.range(0.32, 0.55) });
      }
    }
    const EXTRA = 160;
    const n = pl.length + EXTRA;
    const im = new THREE.InstancedMesh(geo, mat, n);
    const aType = new Float32Array(n), aBloom = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    aBloom.setUsage(THREE.DynamicDrawUsage);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    pl.forEach((f, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
      sc.set(f.s, f.s * (f.type === 1 ? 1.1 : 1), f.s); p.set(f.x, f.y - 0.02, f.z);
      m4.compose(p, q, sc); im.setMatrixAt(i, m4);
      aType[i] = f.type;
      this.flowers.push({ ...f, index: i, bloom: 0, h: f.s });
    });
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = pl.length; i < n; i++) im.setMatrixAt(i, zero);
    this.extraStart = pl.length; this.extraNext = 0; this.extraCount = EXTRA; this.growing = [];
    this.typeAttr = new THREE.InstancedBufferAttribute(aType, 1);
    geo.setAttribute('aType', this.typeAttr);
    geo.setAttribute('aBloom', aBloom);
    im.receiveShadow = true; im.castShadow = false;
    im.computeBoundingSphere();
    this.scene.add(im);
    this.flowerMesh = im; this.bloomAttr = aBloom;
  }

  buildLogs() {
    // a few fallen aspen/spruce logs
    const rng = this.rng;
    const barkMat = makeBarkMaterial(1, { stiff: 0, treeH: 10 });
    const spots = this.scatter(14, ({ n, b, u }) => (n.y < 0.85 || u < 1.8) ? 0 : b.forest + 0.1, { rockPad: 1.5, spacing: 12 });
    const B = new GeoBuilder();
    const pts = [], radii = [];
    for (let i = 0; i <= 6; i++) { pts.push(new THREE.Vector3(0, 0, -3 + i)); radii.push(0.26 - i * 0.015); }
    addTube(B, pts, radii, 9);
    const geo = B.build();
    const n = spots.length;
    const im = new THREE.InstancedMesh(geo, barkMat, n);
    const tint = new Float32Array(n * 3).fill(1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    spots.forEach((s, i) => {
      q.setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), Math.PI / 2 * 0));
      const sc = rng.range(0.8, 1.3);
      m4.compose(new THREE.Vector3(s.x, s.y + 0.12, s.z), q, new THREE.Vector3(sc, sc, sc));
      im.setMatrixAt(i, m4);
    });
    // a spruce washed down in a flood and dropped at the plunge pool's edge: root wad aground on the gravel,
    // the broken top lying out awash, a couple of smaller limbs jammed against it by the same flood
    {
      const at = (lat, z) => [streamCenter(z) + lat * streamHalfW(z), z];
      const [ax, az] = at(-1.22, WF_Z + 1.6), [bx, bz] = at(-0.42, WF_Z + 5.4);
      const LEN = Math.hypot(bx - ax, bz - az);
      const ay = Math.max(groundAt(ax, az) + 0.24, waterLevel(az) + 0.3);
      const by = Math.max(waterLevel(bz) - 0.06, groundAt(bx, bz) + 0.2);
      const mat = makeDriftwoodMaterial();
      const place = (geo, x0, y0, z0, x1, y1, z1, roll) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x0, y0, z0);
        m.lookAt(x1, y1, z1);
        m.rotateZ(roll);
        m.castShadow = true; m.receiveShadow = true;
        this.scene.add(m);
        return m;
      };
      const log = place(buildDriftLog(31, LEN, 0.3), ax, ay, az, bx, by, bz, 0.7);
      log.name = 'driftLog';
      this.driftLog = log;
      // limbs: one lying against the log's upstream side, one half on the gravel
      const lerp3 = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
      const [p0x, p0y, p0z] = lerp3(0.55), [q0x, q0y, q0z] = lerp3(0.25);
      place(buildDriftLog(57, 2.6, 0.07, false), p0x - 0.15, p0y + 0.12, p0z - 0.3, p0x - 1.9, Math.max(waterLevel(p0z - 1.4) - 0.05, groundAt(p0x - 1.9, p0z - 1.4) + 0.06), p0z - 1.4, 1.9);
      place(buildDriftLog(73, 1.8, 0.055, false), q0x + 0.3, q0y + 0.1, q0z + 0.2, q0x + 1.6, groundAt(q0x + 1.6, q0z + 0.9) + 0.05, q0z + 0.9, 0.4);
    }
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    geo.setAttribute('aShake', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
    im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);
  }

  plantFlower(x, z, type) {
    const y = groundAt(x, z);
    const i = this.extraStart + (this.extraNext++ % this.extraCount);
    const f = { x, z, y, type, s: 0.4 + Math.random() * 0.15, index: i, bloom: 0, h: 0.45, rot: Math.random() * 6.28, grow: 0 };
    // replace any older flower record using the same slot
    this.flowers = this.flowers.filter((o) => o.index !== i);
    this.flowers.push(f);
    this.typeAttr.array[i] = type; this.typeAttr.needsUpdate = true;
    this.growing.push(f);
    return f;
  }

  shakeTree(t, amount = 1) { t.shake = Math.min(1.5, t.shake + amount); }
  bloomFlower(f) { f.bloom = 1; }

  update(dt, camPos) {
    // decay shakes
    let dirty = new Set();
    for (const t of this.trees) {
      if (t.shake > 0.001) {
        t.shake *= Math.exp(-dt * 1.8);
        if (t.shake < 0.002) t.shake = 0;
        t.shakeAttr.array[t.index] = t.shake;
        dirty.add(t.shakeAttr);
      }
    }
    for (const a of dirty) a.needsUpdate = true;
    let bd = false;
    for (const f of this.flowers) {
      if (f.bloom > 0) { f.bloom = Math.max(0, f.bloom - dt * 0.5); this.bloomAttr.array[f.index] = f.bloom; bd = true; }
    }
    if (bd) this.bloomAttr.needsUpdate = true;
    if (this.growing.length) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      for (let i = this.growing.length - 1; i >= 0; i--) {
        const f = this.growing[i];
        f.grow = Math.min(1, f.grow + dt * 0.7);
        const e = 1 - Math.pow(1 - f.grow, 3);
        const over = 1 + Math.sin(f.grow * Math.PI) * 0.15;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rot + (1 - e) * 2);
        sc.set(f.s * e * over, f.s * e, f.s * e * over); p.set(f.x, f.y - 0.02, f.z);
        m4.compose(p, q, sc); this.flowerMesh.setMatrixAt(f.index, m4);
        if (f.grow >= 1) this.growing.splice(i, 1);
      }
      this.flowerMesh.instanceMatrix.needsUpdate = true;
    }
    // grass distance culling
    for (const g of this.grassChunks) {
      const c = g.userData.center;
      const d = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      const far = this.grassFar;
      g.visible = d < far;
      if (g.visible) {
        const f = this.lodScale * (1 - smoothstep(far * 0.24, far, d) * 0.8);
        for (const im of g.children) if (im.userData.full) im.count = Math.max(1, Math.floor(im.userData.full * f));
      }
    }
  }
}
