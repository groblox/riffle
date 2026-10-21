// Butterflies (swallowtail, mourning cloak, painted lady) and dragonflies.
import * as THREE from 'three';
import { RNG, clamp, smoothstep } from '../noise.js';
import { groundAt, waterLevel, isWater, streamCenter, streamHalfW, BOUNDS } from '../world/shape.js';
import { U } from '../core/env.js';
import { canvasTexture } from '../gfx/textures.js';
import { build, critterMaterial, lerpAngle } from './kit.js';

function wingTexture(kind) {
  return canvasTexture(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    g.save();
    // forewing (upper) and hindwing (lower), body at x=0, y=64
    const fore = new Path2D();
    fore.moveTo(2, 60); fore.bezierCurveTo(30, 10, 90, 2, 124, 8); fore.bezierCurveTo(118, 40, 90, 62, 2, 66); fore.closePath();
    const hind = new Path2D();
    hind.moveTo(2, 64);
    if (kind === 0) { hind.bezierCurveTo(60, 60, 92, 80, 80, 104); hind.lineTo(84, 124); hind.lineTo(72, 108); hind.bezierCurveTo(40, 118, 14, 96, 2, 70); }
    else { hind.bezierCurveTo(60, 60, 96, 80, 84, 104); hind.bezierCurveTo(60, 120, 14, 100, 2, 70); }
    hind.closePath();
    const base = kind === 0 ? '#f5cf3a' : kind === 1 ? '#4a1e1c' : '#e8792a';
    g.fillStyle = base; g.fill(fore); g.fill(hind);
    g.clip(fore); g.restore(); g.save();
    // markings
    if (kind === 0) {
      g.save(); g.clip(fore);
      g.fillStyle = '#141210';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(20 + i * 24, 0); g.lineTo(30 + i * 24, 0); g.lineTo(20 + i * 18, 70); g.lineTo(10 + i * 18, 70); g.fill(); }
      g.lineWidth = 9; g.strokeStyle = '#141210'; g.stroke(fore);
      g.restore();
      g.save(); g.clip(hind);
      g.lineWidth = 14; g.strokeStyle = '#141210'; g.stroke(hind);
      g.fillStyle = '#3a6cd8'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(30 + i * 14, 100 - i * 3, 3, 0, 7); g.fill(); }
      g.fillStyle = '#ea7a1e'; g.beginPath(); g.arc(70, 104, 4, 0, 7); g.fill();
      g.restore();
    } else if (kind === 1) {
      for (const p of [fore, hind]) {
        g.save(); g.clip(p);
        g.lineWidth = 12; g.strokeStyle = '#f0dca0'; g.stroke(p);
        g.lineWidth = 4; g.strokeStyle = '#1a0c0a'; g.stroke(p);
        g.restore();
      }
      g.fillStyle = '#4f7ae0';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(40 + i * 13, 20 + i * 3, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(20 + i * 11, 100 - i * 2, 2.5, 0, 7); g.fill(); }
    } else {
      g.save(); g.clip(fore);
      g.fillStyle = '#1c120c'; g.beginPath(); g.moveTo(70, 0); g.lineTo(128, 0); g.lineTo(128, 40); g.lineTo(80, 50); g.fill();
      g.fillStyle = '#f4f0e6'; for (const [x, y] of [[100, 12], [112, 22], [92, 26]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
      g.fillStyle = '#1c120c'; g.beginPath(); g.arc(55, 40, 7, 0, 7); g.fill();
      g.restore();
      g.save(); g.clip(hind);
      g.fillStyle = '#1c120c'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(30 + i * 13, 100 - i * 2, 4, 0, 7); g.fill(); }
      g.lineWidth = 5; g.strokeStyle = '#2a1a10'; g.stroke(hind);
      g.restore();
    }
    // body-side darkening
    const gr = g.createLinearGradient(0, 0, 30, 0);
    gr.addColorStop(0, 'rgba(30,20,15,0.6)'); gr.addColorStop(1, 'rgba(30,20,15,0)');
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, 0, 30, 128);
  });
}

const BUTTERFLIES = [
  { id: 'swallowtail', label: 'Western Tiger Swallowtail' },
  { id: 'mourningcloak', label: 'Mourning Cloak' },
  { id: 'paintedlady', label: 'Painted Lady' },
];

export class Butterflies {
  constructor(scene, ctx, flowers, count = 16) {
    this.ctx = ctx; this.flowers = flowers; this.list = [];
    const rng = this.rng = new RNG(99);
    const texs = [0, 1, 2].map(wingTexture);
    const wingGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
    const bodyGeo = build([{ p: [0, 0, 0], s: [0.012, 0.012, 0.07], c: [0.12, 0.1, 0.08] }, { p: [0, 0.004, 0.04], s: [0.014, 0.014, 0.014], c: [0.1, 0.08, 0.07] }]);
    const bodyMat = critterMaterial({ key: 'bfly-body' });
    for (let i = 0; i < count; i++) {
      const kind = i % 3;
      const mat = new THREE.MeshStandardMaterial({ map: texs[kind], side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.8 });
      const grp = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      const wR = new THREE.Mesh(wingGeo, mat), wL = new THREE.Mesh(wingGeo, mat);
      const span = kind === 0 ? 0.13 : 0.11;
      wR.scale.set(span, 1, span * 1.1); wL.scale.set(-span, 1, span * 1.1);
      const pR = new THREE.Group(), pL = new THREE.Group();
      pR.add(wR); pL.add(wL);
      grp.add(body, pR, pL);
      grp.traverse((o) => { o.castShadow = true; });
      scene.add(grp);
      const f = flowers[rng.int(0, flowers.length - 1)] || { x: 0, z: 0, y: 0 };
      const b = {
        grp, pR, pL, kind, x: f.x + rng.range(-5, 5), z: f.z + rng.range(-5, 5), y: 0, vx: 0, vy: 0, vz: 0,
        state: 'fly', timer: rng.range(2, 8), target: null, flap: rng.range(0, 6), heading: 0, seed: rng.range(0, 100),
        pick: { r: 0.45, label: BUTTERFLIES[kind].label, guide: BUTTERFLIES[kind].id, kind: 'butterfly' },
      };
      b.y = groundAt(b.x, b.z) + 1;
      b.pick.obj = b;
      this.pickTarget(b);
      this.list.push(b);
    }
  }

  pickTarget(b) {
    const rng = this.rng;
    if (this.flowers.length && rng.chance(0.75)) {
      let best = null;
      for (let k = 0; k < 10; k++) {
        const f = this.flowers[rng.int(0, this.flowers.length - 1)];
        const d = Math.hypot(f.x - b.x, f.z - b.z);
        if (d < 30 && (!best || d < best.d)) best = { f, d };
      }
      if (best) { b.target = { x: best.f.x, z: best.f.z, y: best.f.y + best.f.h * 0.85, flower: best.f }; return; }
    }
    const x = b.x + rng.range(-10, 10), z = b.z + rng.range(-10, 10);
    b.target = { x, z, y: groundAt(x, z) + rng.range(0.6, 2.5), flower: null };
  }

  scare(x, z, r) {
    for (const b of this.list) {
      if (Math.hypot(b.x - x, b.z - z) < r) {
        b.state = 'fly'; b.vy = 1.8; b.timer = 2; b.target = { x: b.x + (b.x - x) * 3, z: b.z + (b.z - z) * 3, y: b.y + 2.5, flower: null };
      }
    }
  }

  pickables() { return this.list.filter((b) => b.grp.visible).map((b) => { b.pick.x = b.x; b.pick.y = b.y; b.pick.z = b.z; return b.pick; }); }

  update(dt, focus) {
    const night = U.uNight.value;
    const t = U.uTime.value;
    const rain = U.uRain.value;
    for (const b of this.list) {
      // keep butterflies around the player: quietly relocate stragglers to flowers nearby
      if (focus && Math.hypot(b.x - focus.x, b.z - focus.z) > 70) {
        const near = this.flowers.filter((f) => Math.hypot(f.x - focus.x, f.z - focus.z) < 45);
        if (near.length) {
          const f = near[Math.floor(Math.random() * near.length)];
          b.x = f.x + (Math.random() - 0.5) * 6; b.z = f.z + (Math.random() - 0.5) * 6; b.y = groundAt(b.x, b.z) + 1.5;
          b.state = 'fly'; this.pickTarget(b);
        }
      }
      const asleep = night > 0.5 || rain > 0.5 || U.uSeason.value > 1.6;
      b.grp.visible = !asleep;
      if (asleep) continue;
      b.timer -= dt;
      if (b.state === 'fly') {
        const tg = b.target;
        const dx = tg.x - b.x, dy = tg.y - b.y, dz = tg.z - b.z;
        const d = Math.hypot(dx, dy, dz);
        const sp = 1.4;
        const ax = dx / (d + 0.01) * sp - b.vx + Math.sin(t * 4.1 + b.seed) * 1.6;
        const az = dz / (d + 0.01) * sp - b.vz + Math.cos(t * 3.7 + b.seed) * 1.6;
        const ay = dy / (d + 0.01) * sp - b.vy + Math.sin(t * 6.3 + b.seed * 2) * 2.2;
        b.vx += ax * dt * 2; b.vy += ay * dt * 2; b.vz += az * dt * 2;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        const g = groundAt(b.x, b.z);
        if (b.y < g + 0.2) { b.y = g + 0.2; b.vy = Math.abs(b.vy); }
        b.flap += dt * 11;
        const amp = 1.15;
        const a = Math.sin(b.flap) * amp * 0.5 + 0.35;
        b.pR.rotation.z = a; b.pL.rotation.z = -a;
        b.heading = lerpAngle(b.heading, Math.atan2(b.vx, b.vz), Math.min(1, dt * 5));
        if (d < 0.25 && tg.flower) { b.state = 'perch'; b.timer = 3 + Math.random() * 8; b.x = tg.x; b.z = tg.z; b.y = tg.y; }
        else if (d < 0.6 || b.timer < 0) { b.timer = 4 + Math.random() * 6; this.pickTarget(b); }
      } else {
        // perched: wings slowly open & close, basking
        b.flap += dt * 1.4;
        const a = (Math.sin(b.flap) * 0.5 + 0.5) * 1.3;
        b.pR.rotation.z = a; b.pL.rotation.z = -a;
        b.vx = b.vy = b.vz = 0;
        if (b.timer < 0) { b.state = 'fly'; b.vy = 1; this.pickTarget(b); b.timer = 6; }
      }
      b.grp.position.set(b.x, b.y, b.z);
      b.grp.rotation.set(0, b.heading, 0);
    }
  }
}

// ---------------- Dragonflies ----------------
// Built to the real plan: two huge compound eyes meeting on top of the head, a stout thorax slanted back,
// a ten-segment abdomen (the meadowhawk's scarlet with dark joints and side marks, the darner's brown with
// paired sky-blue spots), and four separately hinged veined wings with a dark pterostigma near each tip.
// They patrol the edge of the creek in darts and hovers and settle on dry reed stalks at the water's edge:
// the meadowhawk on the very tip, wings swept forward and down; the darner hanging off the side.
const DRAGONS = [
  { id: 'meadowhawk', label: 'Variegated Meadowhawk', scale: 1.2, eye: [0.5, 0.16, 0.08], thorax: [0.42, 0.24, 0.12], abd: [0.72, 0.16, 0.06], mark: [0.18, 0.05, 0.03], spot: [0.95, 0.85, 0.35], amber: 'rgba(205,130,40,0.35)' },
  { id: 'darner', label: 'Blue-eyed Darner', scale: 1.45, eye: [0.2, 0.5, 0.95], thorax: [0.3, 0.22, 0.14], abd: [0.16, 0.11, 0.08], mark: [0.08, 0.06, 0.05], spot: [0.25, 0.6, 1.0], amber: null },
];

function dragonWingTexture(hind, amber) {
  return canvasTexture(256, 64, (g) => {
    g.clearRect(0, 0, 256, 64);
    // outline: leading edge along the bottom (it faces forward on the model), base at the left
    const p = new Path2D();
    if (hind) { p.moveTo(2, 58); p.lineTo(236, 56); p.bezierCurveTo(254, 54, 254, 36, 236, 32); p.bezierCurveTo(170, 22, 80, 6, 30, 4); p.bezierCurveTo(10, 4, 2, 20, 2, 40); }
    else { p.moveTo(2, 58); p.lineTo(238, 56); p.bezierCurveTo(254, 54, 254, 38, 238, 34); p.bezierCurveTo(170, 28, 80, 26, 20, 40); p.bezierCurveTo(8, 44, 2, 50, 2, 54); }
    p.closePath();
    g.save(); g.clip(p);
    g.fillStyle = 'rgba(225,235,240,0.3)'; g.fillRect(0, 0, 256, 64);
    if (amber) { const gr = g.createLinearGradient(0, 0, hind ? 70 : 40, 0); gr.addColorStop(0, amber); gr.addColorStop(1, 'rgba(205,130,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 90, 64); }
    // long veins, then a lattice of cross-veins
    g.strokeStyle = 'rgba(30,26,22,0.75)'; g.lineWidth = 1.6;
    for (const y of [56, 52, 47]) { g.beginPath(); g.moveTo(0, y); g.lineTo(250, y - (56 - y) * 0.2); g.stroke(); }
    g.lineWidth = 1;
    for (const [y0, y1] of [[44, 40], [40, 30], [36, 20], [30, 10]]) { if (!hind && y1 < 28) continue; g.beginPath(); g.moveTo(4, y0); g.bezierCurveTo(80, y0 - 2, 160, y1 + 8, 244, y1 + 14); g.stroke(); }
    g.strokeStyle = 'rgba(30,26,22,0.4)'; g.lineWidth = 0.7;
    for (let x = 6; x < 250; x += 5 + Math.sin(x) * 1.5) { g.beginPath(); g.moveTo(x, 57); g.lineTo(x + 2, hind ? 4 : 26); g.stroke(); }
    for (let i = 0; i < 70; i++) { const x = 10 + (i * 37) % 230, y = 10 + (i * 23) % 44; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 3); g.stroke(); }
    // nodus and the pterostigma
    g.fillStyle = 'rgba(25,18,12,0.95)'; g.fillRect(118, 50, 4, 8);
    g.fillStyle = 'rgba(40,24,14,0.92)'; g.fillRect(212, 49, 16, 7);
    g.restore();
    g.strokeStyle = 'rgba(30,26,22,0.8)'; g.lineWidth = 1.2; g.stroke(p);
  });
}

function dragonBody(sp) {
  const parts = [];
  // head: two big eyes meeting on top, the face below them
  for (const s of [-1, 1]) parts.push({ p: [0.0042 * s, 0.0018, 0.0262], s: [0.0052, 0.0058, 0.0056], c: sp.eye, seg: 10 });
  parts.push({ p: [0, -0.0018, 0.0298], s: [0.0034, 0.0028, 0.0022], c: [0.8, 0.72, 0.42], seg: 8 });
  // thorax, slanted back, with pale side stripes
  parts.push({ p: [0, 0, 0.0145], s: [0.0052, 0.0064, 0.0088], r: [-0.45, 0, 0], c: sp.thorax, seg: 10 });
  for (const s of [-1, 1]) parts.push({ p: [0.0046 * s, 0.0004, 0.0145], s: [0.0012, 0.0052, 0.0022], r: [-0.45, 0, 0], c: sp.spot, seg: 6 });
  // legs folded up under the thorax
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) parts.push({ type: 'cyl', p: [0.0026 * s, -0.0062, 0.019 - i * 0.003], s: [0.0006, 0.006, 0.0006], r: [0.9 - i * 0.25, 0, -0.5 * s], c: [0.1, 0.08, 0.06], seg: 4 });
  // abdomen: ten segments, swollen at the base, slender, a slight club at the tip
  let z = 0.0085;
  for (let k = 0; k < 10; k++) {
    const len = k < 2 ? 0.0045 : k < 8 ? 0.0064 : 0.0042;
    const r = k === 0 ? 0.0033 : k === 1 ? 0.0029 : k < 7 ? 0.0021 : 0.00235;
    z -= len;
    parts.push({ p: [0, 0, z + len / 2], s: [r, r * 0.95, len * 0.68], c: sp.abd, seg: 8 });
    parts.push({ type: 'cyl', p: [0, 0, z + 0.0002], s: [r * 1.0, 0.0005, r * 1.0], r: [Math.PI / 2, 0, 0], c: sp.mark, seg: 8 });
    if (k >= 2 && k < 9) {
      if (sp.id === 'darner') for (const s of [-1, 1]) parts.push({ p: [0.0011 * s, r * 0.75, z + len * 0.62], s: [0.0011, 0.0006, 0.0015], c: sp.spot, seg: 6 });
      else for (const s of [-1, 1]) parts.push({ p: [r * 0.82 * s, -r * 0.1, z + len * 0.4], s: [0.0006, 0.0012, 0.0016], c: sp.mark, seg: 6 });
    }
  }
  for (const s of [-1, 1]) parts.push({ type: 'cone', p: [0.0007 * s, 0, z - 0.0016], s: [0.0006, 0.0032, 0.0006], r: [-Math.PI / 2, 0, 0], c: sp.mark, seg: 4 });
  return build(parts);
}

export class Dragonflies {
  constructor(scene, ctx, count = 9) {
    this.ctx = ctx; this.list = [];
    const rng = this.rng = new RNG(1212);
    const wingGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
    const mats = DRAGONS.map((sp) => [false, true].map((hind) => new THREE.MeshStandardMaterial({
      map: dragonWingTexture(hind, sp.amber), transparent: true, side: THREE.DoubleSide, roughness: 0.18, metalness: 0.15, depthWrite: false,
    })));
    const bodyMat = critterMaterial({ key: 'dfly', rough: 0.35 });
    const bodies = DRAGONS.map(dragonBody);
    // dry reed stalks along the banks to perch on
    const stalkGeo = build([{ type: 'cyl', p: [0, 0.45, 0], s: [0.0028, 0.9, 0.0028], c: [0.3, 0.22, 0.12], seg: 5 }, { type: 'cyl', p: [0.012, 0.8, 0], s: [0.002, 0.12, 0.002], r: [0, 0, -0.35], c: [0.26, 0.19, 0.1], seg: 4 }]);
    const stalkMat = critterMaterial({ key: 'dfly-stalk', rough: 0.9 });
    for (let i = 0; i < count; i++) {
      const si = i % 2, sp = DRAGONS[si];
      const grp = new THREE.Group();
      const body = new THREE.Mesh(bodies[si], bodyMat);
      grp.add(body);
      const wings = [];
      for (const [z, side, len, chord, hind] of [[0.017, 1, 0.043, 0.0088, 0], [0.017, -1, 0.043, 0.0088, 0], [0.0095, 1, 0.041, 0.0118, 1], [0.0095, -1, 0.041, 0.0118, 1]]) {
        const w = new THREE.Mesh(wingGeo, mats[si][hind]);
        w.scale.set(len * side, 1, chord);
        w.position.z = -chord * 0.42;
        const p = new THREE.Group(); p.position.set(0.0022 * side, 0.0052, z); p.add(w);
        grp.add(p); wings.push({ p, side, hind });
      }
      grp.scale.setScalar(sp.scale);
      grp.traverse((o) => { o.castShadow = true; });
      scene.add(grp);
      const z = rng.range(-BOUNDS + 10, BOUNDS - 10);
      const x = streamCenter(z) + rng.range(-1, 1) * streamHalfW(z);
      // the perch: a dead reed stalk standing at the edge of the water near home
      const ps = rng.chance(0.5) ? 1 : -1;
      let px = streamCenter(z) + ps * streamHalfW(z), pz = z;
      for (let k = 0; k < 20 && groundAt(px, pz) < waterLevel(pz) - 0.05; k++) px += ps * 0.2;
      const stalk = new THREE.Mesh(stalkGeo, stalkMat);
      const sh = rng.range(0.75, 1.1);
      stalk.position.set(px, Math.max(groundAt(px, pz), waterLevel(pz) - 0.1) - 0.02, pz);
      stalk.scale.set(1, sh, 1); stalk.rotation.set(rng.range(-0.08, 0.08), rng.range(0, 6.28), rng.range(-0.08, 0.08));
      stalk.castShadow = true;
      scene.add(stalk);
      stalk.updateMatrixWorld();
      const tip = new THREE.Vector3(0, 0.9, 0).applyMatrix4(stalk.matrixWorld);
      const d = {
        sp, grp, wings, x, z, y: waterLevel(z) + 0.6, vx: 0, vy: 0, vz: 0, home: { x, z }, target: { x, z, y: waterLevel(z) + 0.6 },
        timer: rng.range(0.5, 2), heading: 0, seed: rng.range(0, 100), state: 'fly', perch: { tip, side: stalk.rotation.y }, toPerch: rng.range(6, 20), stalk,
        pick: { r: 0.4, label: sp.label, guide: sp.id, kind: 'dragonfly' },
      };
      d.pick.obj = d;
      this.list.push(d);
    }
  }
  scare(x, z, r) { for (const d of this.list) if (Math.hypot(d.x - x, d.z - z) < r) { d.timer = 0; d.flee = 1; if (d.state !== 'fly') { d.state = 'fly'; d.vy = 1.2; } d.toPerch = 8 + Math.random() * 8; } }
  pickables() { return this.list.filter((d) => d.grp.visible).map((d) => { d.pick.x = d.x; d.pick.y = d.y; d.pick.z = d.z; return d.pick; }); }
  update(dt) {
    const t = U.uTime.value;
    const sleep = U.uNight.value > 0.4 || U.uRain.value > 0.5 || U.uSeason.value > 1.5;
    for (const d of this.list) {
      d.grp.visible = !sleep;
      if (sleep) continue;
      d.timer -= dt; d.toPerch -= dt;
      const darner = d.sp.id === 'darner';
      if (d.state === 'fly' && d.toPerch < 0) {
        d.state = 'land';
        // meadowhawks sit on the tip; darners hang off the side of the stalk, a little below it
        const o = darner ? 0.006 * d.sp.scale : 0, hd = d.heading, back = darner ? 0 : 0.017 * d.sp.scale;
        d.target = { x: d.perch.tip.x + Math.cos(d.perch.side) * o - Math.sin(hd) * back, y: d.perch.tip.y + (darner ? -0.02 : 0.0075 * d.sp.scale), z: d.perch.tip.z + Math.sin(d.perch.side) * o - Math.cos(hd) * back };
      }
      if (d.state === 'fly' && d.timer < 0) {
        const r = d.flee ? 10 : 6;
        const z = clamp(d.home.z + this.rng.range(-r, r), -BOUNDS, BOUNDS);
        const hw = streamHalfW(z);
        const x = streamCenter(z) + this.rng.range(-1.1, 1.1) * hw;
        const base = Math.max(waterLevel(z), groundAt(x, z));
        d.target = { x, z, y: base + this.rng.range(0.25, 1.3) };
        d.timer = this.rng.range(0.6, 2.8);
        d.flee = 0;
      }
      if (d.state === 'perch') {
        // perched: still, the odd twitch of the head and wings
        d.vx = d.vy = d.vz = 0;
        if (d.timer < 0) { d.state = 'fly'; d.timer = 0; d.toPerch = this.rng.range(10, 26); d.vy = 0.8; }
      } else {
        const dx = d.target.x - d.x, dy = d.target.y - d.y, dz = d.target.z - d.z;
        // critically damped spring toward target -> darting then hovering
        const k = d.state === 'land' ? 5 : 9, c = 2 * Math.sqrt(k);
        d.vx += (dx * k - d.vx * c) * dt; d.vy += (dy * k - d.vy * c) * dt; d.vz += (dz * k - d.vz * c) * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.state === 'land' && Math.hypot(dx, dy, dz) < 0.012) {
          d.state = 'perch'; d.timer = this.rng.range(5, 14);
          d.x = d.target.x; d.y = d.target.y; d.z = d.target.z;
          if (darner) d.heading = d.perch.side + Math.PI / 2;
          else { const back = 0.017 * d.sp.scale; d.x = d.perch.tip.x - Math.sin(d.heading) * back; d.z = d.perch.tip.z - Math.cos(d.heading) * back; }
        }
      }
      const sp = Math.hypot(d.vx, d.vz);
      if (sp > 0.3) d.heading = lerpAngle(d.heading, Math.atan2(d.vx, d.vz), Math.min(1, dt * 10));
      const perched = d.state === 'perch';
      const hover = perched ? 0 : Math.sin(t * 3 + d.seed) * 0.02;
      d.grp.position.set(d.x, d.y + hover, d.z);
      // flying: body level, nose dipping into a dart; perched: the darner hangs nearly vertical
      const pitch = perched ? (darner ? -1.35 : -0.08) : -clamp(sp * 0.08, 0, 0.4);
      d.grp.rotation.set(pitch, d.heading, 0, 'YXZ');
      if (perched) {
        // wings at rest: the meadowhawk sweeps them forward and down, the darner holds them flat out
        const tw = Math.sin(t * 0.9 + d.seed) > 0.97 ? Math.sin(t * 40) * 0.08 : 0;
        for (const w of d.wings) {
          w.p.rotation.set(0, darner ? 0 : w.side * (w.hind ? 0.1 : 0.32), w.side * ((darner ? -0.02 : -0.22) + tw));
        }
      } else {
        // a blur of wingbeats; fore and hind pairs out of phase
        for (const w of d.wings) {
          const ph = t * 2 * Math.PI * 27 + d.seed + (w.hind ? Math.PI / 2 : 0);
          w.p.rotation.set(0, 0, w.side * Math.sin(ph) * 0.6);
        }
      }
    }
  }
}
