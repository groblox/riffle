// Ground critters: chipmunks, lizards, chorus frogs, grasshoppers.
import * as THREE from 'three';
import { RNG, clamp, smoothstep, lerp } from '../noise.js';
import { groundAt, waterLevel, isWater, streamCenter, streamHalfW, streamSlope, bioAt, normalAt, lateral, BOUNDS } from '../world/shape.js';
import { U } from '../core/env.js';
import { build, critterMaterial, lerpAngle } from './kit.js';
import { splashFx, dustFx } from '../fx/particles.js';
import { rockTopAt } from '../world/rocks.js';

function findSpot(rng, test, tries = 400) {
  for (let i = 0; i < tries; i++) {
    const x = rng.range(-BOUNDS, BOUNDS), z = rng.range(-BOUNDS, BOUNDS);
    const g = groundAt(x, z);
    if (g < waterLevel(z) + 0.05) continue;
    const n = normalAt(x, z);
    if (n.y < 0.85) continue;
    const b = bioAt(x, z);
    const u = Math.abs(lateral(x, z)) / streamHalfW(z);
    if (test({ x, z, g, b, u })) return { x, z };
  }
  return { x: rng.range(-20, 20), z: rng.range(-20, 20) };
}

// ---------------- Chipmunks ----------------
export class Chipmunks {
  constructor(scene, ctx, count = 7) {
    this.ctx = ctx; this.list = [];
    const rng = this.rng = new RNG(707);
    const fur = [0.55, 0.32, 0.15], belly = [0.82, 0.72, 0.55], dark = [0.08, 0.06, 0.05], white = [0.88, 0.85, 0.78];
    const geo = build([
      { p: [0, 0.045, 0], s: [0.035, 0.034, 0.06], c: fur },
      { p: [0, 0.035, 0.005], s: [0.03, 0.026, 0.052], c: belly },
      { p: [0, 0.075, 0.0], s: [0.006, 0.006, 0.05], c: dark },
      { p: [0.013, 0.073, 0.0], s: [0.004, 0.004, 0.045], c: white },
      { p: [-0.013, 0.073, 0.0], s: [0.004, 0.004, 0.045], c: white },
      { p: [0.02, 0.068, 0.0], s: [0.004, 0.004, 0.042], c: dark },
      { p: [-0.02, 0.068, 0.0], s: [0.004, 0.004, 0.042], c: dark },
      { p: [0, 0.065, 0.06], s: [0.025, 0.023, 0.028], c: fur },
      { p: [0, 0.06, 0.085], s: [0.008, 0.008, 0.008], c: dark, seg: 6 },
      { p: [0.015, 0.088, 0.055], s: [0.007, 0.01, 0.004], c: fur, seg: 6 },
      { p: [-0.015, 0.088, 0.055], s: [0.007, 0.01, 0.004], c: fur, seg: 6 },
      { p: [0.017, 0.07, 0.072], s: [0.005, 0.005, 0.005], c: dark, seg: 6 },
      { p: [-0.017, 0.07, 0.072], s: [0.005, 0.005, 0.005], c: dark, seg: 6 },
    ]);
    const tailGeo = build([{ p: [0, 0.035, -0.0], s: [0.018, 0.04, 0.014], c: [0.42, 0.26, 0.13] }]);
    const mat = critterMaterial({ key: 'chip', rough: 0.85 });
    for (let i = 0; i < count; i++) {
      const s = findSpot(rng, ({ b, u }) => u > 2.2 && b.canyon < 0.6 && rng.chance(0.3 + b.forest * 0.7));
      const grp = new THREE.Group();
      const body = new THREE.Mesh(geo, mat);
      const tail = new THREE.Mesh(tailGeo, mat); tail.position.set(0, 0.045, -0.055);
      const bodyPivot = new THREE.Group(); bodyPivot.add(body, tail);
      grp.add(bodyPivot);
      grp.scale.setScalar(1.6);
      grp.traverse((o) => { o.castShadow = true; });
      scene.add(grp);
      const c = { grp, body: bodyPivot, tail, x: s.x, z: s.z, home: { ...s }, state: 'idle', timer: rng.range(1, 4), heading: rng.range(0, 6.28), sit: 0, hop: 0, tx: s.x, tz: s.z,
        pick: { r: 0.35, label: 'Least Chipmunk', guide: 'chipmunk', kind: 'chipmunk' } };
      c.pick.obj = c;
      this.list.push(c);
    }
  }
  pickables() { return this.list.filter((c) => c.grp.visible).map((c) => { c.pick.x = c.x; c.pick.y = groundAt(c.x, c.z) + 0.1; c.pick.z = c.z; return c.pick; }); }
  scare(x, z, r) {
    for (const c of this.list) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < r) {
        const a = Math.atan2(c.x - x, c.z - z) + this.rng.range(-0.5, 0.5);
        c.tx = c.x + Math.sin(a) * 5; c.tz = c.z + Math.cos(a) * 5;
        c.state = 'run'; c.speed = 4.5; c.timer = 3;
      }
    }
  }
  update(dt, cursor) {
    const rng = this.rng, t = U.uTime.value;
    for (const c of this.list) {
      c.grp.visible = U.uNight.value < 0.55 && U.uSeason.value < 1.7;
      if (!c.grp.visible) continue;
      c.timer -= dt;
      if (cursor && cursor.active && Math.hypot(cursor.x - c.x, cursor.z - c.z) < 1.4 && c.state !== 'run') this.scare(cursor.x, cursor.z, 2);
      if (c.state === 'idle') {
        c.sit += ((Math.sin(t * 0.5 + c.home.x) > 0.2 ? 1 : 0) - c.sit) * Math.min(1, dt * 4);
        if (rng.next() < dt * 0.8) c.heading += rng.range(-1, 1);
        c.tail.rotation.x = -0.6 + Math.sin(t * 9) * 0.25 * (rng.next() < 0.5 ? 1 : 0.2);
        if (c.timer < 0) {
          c.state = 'run'; c.speed = 2.8; c.timer = 3;
          const a = rng.range(0, 6.28), d = rng.range(1.5, 4.5);
          c.tx = clamp(c.home.x + Math.sin(a) * d, -BOUNDS, BOUNDS); c.tz = clamp(c.home.z + Math.cos(a) * d, -BOUNDS, BOUNDS);
        }
      } else {
        c.sit += (0 - c.sit) * Math.min(1, dt * 10);
        const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
        c.heading = lerpAngle(c.heading, Math.atan2(dx, dz), Math.min(1, dt * 12));
        const step = Math.min(d, c.speed * dt);
        const nx = c.x + Math.sin(c.heading) * step, nz = c.z + Math.cos(c.heading) * step;
        if (!isWater(nx, nz)) { c.x = nx; c.z = nz; } else { c.tx = c.x - dx; c.tz = c.z - dz; }
        c.hop += dt * 16;
        c.tail.rotation.x = -0.2 + Math.sin(c.hop) * 0.2;
        if (d < 0.1 || c.timer < 0) { c.state = 'idle'; c.timer = rng.range(1.5, 5); }
      }
      const g = groundAt(c.x, c.z);
      const hopY = c.state === 'run' ? Math.abs(Math.sin(c.hop)) * 0.04 : 0;
      c.grp.position.set(c.x, g + hopY, c.z);
      c.grp.rotation.set(0, c.heading, 0);
      c.body.rotation.x = -c.sit * 0.9;
      c.body.position.z = -c.sit * 0.02;
    }
  }
}

// ---------------- Lizards ----------------
export class Lizards {
  constructor(scene, ctx, rocks, count = 6) {
    this.ctx = ctx; this.list = [];
    const rng = this.rng = new RNG(5151);
    const sand = [0.55, 0.45, 0.32], dark = [0.25, 0.2, 0.15], blue = [0.2, 0.35, 0.65];
    const geo = build([
      { p: [0, 0.018, 0], s: [0.022, 0.012, 0.055], c: sand },
      { p: [0, 0.012, 0], s: [0.02, 0.008, 0.05], c: blue },
      { p: [0, 0.02, 0.065], s: [0.014, 0.01, 0.022], c: sand },
      { type: 'cone', p: [0, 0.014, -0.11], s: [0.012, 0.13, 0.008], r: [-Math.PI / 2, 0, 0], c: sand, seg: 6 },
      { p: [0.008, 0.028, 0.02], s: [0.006, 0.004, 0.01], c: dark, seg: 5 },
      { p: [-0.008, 0.028, -0.01], s: [0.006, 0.004, 0.01], c: dark, seg: 5 },
      { p: [0.0, 0.028, -0.035], s: [0.006, 0.004, 0.01], c: dark, seg: 5 },
      { type: 'box', p: [0.028, 0.008, 0.035], s: [0.03, 0.005, 0.006], r: [0, 0.6, 0], c: sand },
      { type: 'box', p: [-0.028, 0.008, 0.035], s: [0.03, 0.005, 0.006], r: [0, -0.6, 0], c: sand },
      { type: 'box', p: [0.028, 0.008, -0.03], s: [0.03, 0.005, 0.006], r: [0, -0.6, 0], c: sand },
      { type: 'box', p: [-0.028, 0.008, -0.03], s: [0.03, 0.005, 0.006], r: [0, 0.6, 0], c: sand },
    ]);
    const mat = critterMaterial({ key: 'lizard', rough: 0.6 });
    const basking = rocks.filter((r) => r.kind === 0 && !r.stream && r.r > 0.8 && !r.hoodoo);
    for (let i = 0; i < count; i++) {
      let s;
      if (basking.length && rng.chance(0.7)) { const r = basking[rng.int(0, basking.length - 1)]; s = { x: r.cx, z: r.cz, y: rockTopAt(r, r.cx, r.cz), rock: r }; }
      else { const p = findSpot(rng, ({ b, u }) => b.canyon > 0.5 && u > 3); s = { ...p, y: groundAt(p.x, p.z) }; }
      const grp = new THREE.Group();
      const m = new THREE.Mesh(geo, mat); grp.add(m);
      grp.scale.setScalar(2.0);
      grp.traverse((o) => { o.castShadow = true; });
      scene.add(grp);
      const L = { grp, m, x: s.x, z: s.z, y: s.y, rock: s.rock, heading: rng.range(0, 6.28), state: 'bask', timer: rng.range(2, 6), push: 0,
        pick: { r: 0.35, label: 'Sagebrush Lizard', guide: 'lizard', kind: 'lizard' } };
      L.pick.obj = L;
      this.list.push(L);
    }
  }
  surfaceY(L) {
    const g = groundAt(L.x, L.z);
    if (!L.rock) return g;
    const t = rockTopAt(L.rock, L.x, L.z);
    return Math.max(g, t);
  }
  pickables() { return this.list.filter((l) => l.grp.visible).map((l) => { l.pick.x = l.x; l.pick.y = l.y + 0.05; l.pick.z = l.z; return l.pick; }); }
  scare(x, z, r) {
    for (const L of this.list) if (Math.hypot(L.x - x, L.z - z) < r) {
      L.state = 'dash'; L.timer = 0.5 + Math.random() * 0.4; L.heading = Math.atan2(L.x - x, L.z - z) + (Math.random() - 0.5);
    }
  }
  update(dt, cursor) {
    const rng = this.rng;
    for (const L of this.list) {
      L.grp.visible = U.uNight.value < 0.4 && U.uRain.value < 0.5 && U.uSeason.value < 1.6;
      if (!L.grp.visible) continue;
      L.timer -= dt;
      if (cursor && cursor.active && Math.hypot(cursor.x - L.x, cursor.z - L.z) < 1.2 && L.state !== 'dash') this.scare(cursor.x, cursor.z, 2);
      if (L.state === 'bask') {
        if (L.timer < 0) {
          const r = rng.next();
          if (r < 0.45) { L.push = 1; L.timer = rng.range(2, 6); this.ctx.onEvent && this.ctx.onEvent('pushup', L); }
          else if (r < 0.75) { L.state = 'dash'; L.timer = rng.range(0.2, 0.5); L.heading += rng.range(-1.5, 1.5); }
          else L.timer = rng.range(2, 6);
        }
        L.push = Math.max(0, L.push - dt * 0.8);
        L.m.position.y = Math.abs(Math.sin(L.push * Math.PI * 5)) * 0.02 * (L.push > 0 ? 1 : 0);
      } else {
        const nx = L.x + Math.sin(L.heading) * 4.5 * dt, nz = L.z + Math.cos(L.heading) * 4.5 * dt;
        if (!isWater(nx, nz)) { L.x = nx; L.z = nz; } else L.heading += Math.PI;
        L.m.rotation.y = Math.sin(L.timer * 60) * 0.25;
        if (L.timer < 0) { L.state = 'bask'; L.timer = rng.range(2, 6); L.m.rotation.y = 0; }
      }
      L.y = this.surfaceY(L);
      L.grp.position.set(L.x, L.y, L.z);
      L.grp.rotation.set(0, L.heading, 0);
    }
  }
}

// ---------------- Frogs ----------------
export class Frogs {
  constructor(scene, ctx, count = 7) {
    this.ctx = ctx; this.list = [];
    const rng = this.rng = new RNG(6161);
    const green = [0.28, 0.36, 0.12], dark = [0.08, 0.1, 0.04], belly = [0.75, 0.72, 0.55], gold = [0.8, 0.6, 0.1];
    const geo = build([
      { p: [0, 0.025, 0], s: [0.03, 0.022, 0.04], r: [-0.3, 0, 0], c: green },
      { p: [0, 0.018, 0.0], s: [0.027, 0.016, 0.036], c: belly },
      { p: [0, 0.035, 0.035], s: [0.024, 0.016, 0.022], c: green },
      { p: [0.014, 0.046, 0.04], s: [0.008, 0.008, 0.008], c: gold, seg: 6 },
      { p: [-0.014, 0.046, 0.04], s: [0.008, 0.008, 0.008], c: gold, seg: 6 },
      { p: [0.006, 0.042, 0.0], s: [0.005, 0.003, 0.03], c: dark, seg: 5 },
      { p: [-0.006, 0.042, 0.0], s: [0.005, 0.003, 0.03], c: dark, seg: 5 },
      { p: [0.03, 0.012, -0.02], s: [0.012, 0.01, 0.03], c: green, seg: 6 },
      { p: [-0.03, 0.012, -0.02], s: [0.012, 0.01, 0.03], c: green, seg: 6 },
      { p: [0.022, 0.01, 0.03], s: [0.005, 0.012, 0.005], c: green, seg: 5 },
      { p: [-0.022, 0.01, 0.03], s: [0.005, 0.012, 0.005], c: green, seg: 5 },
    ]);
    const mat = critterMaterial({ key: 'frog', rough: 0.35 });
    for (let i = 0; i < count; i++) {
      const grp = new THREE.Group(); grp.add(new THREE.Mesh(geo, mat));
      grp.scale.setScalar(2.2);
      grp.traverse((o) => { o.castShadow = true; });
      scene.add(grp);
      const f = { grp, state: 'sit', timer: 0, croak: rng.range(2, 20), pick: { r: 0.3, label: 'Boreal Chorus Frog', guide: 'frog', kind: 'frog' } };
      f.pick.obj = f;
      this.place(f);
      this.list.push(f);
    }
  }
  place(f) {
    const rng = this.rng;
    for (let k = 0; k < 200; k++) {
      const z = rng.range(-BOUNDS + 5, BOUNDS - 5);
      const hw = streamHalfW(z), side = rng.chance(0.5) ? 1 : -1;
      const lat = side * hw * rng.range(1.0, 1.25);
      const x = streamCenter(z) + lat * Math.sqrt(1 + streamSlope(z) ** 2);
      const g = groundAt(x, z), wl = waterLevel(z);
      if (g < wl + 0.02 || g > wl + 0.3) continue;
      if (streamHalfW(z) > 7) continue;
      f.x = x; f.z = z; f.y = g;
      f.heading = Math.atan2(streamCenter(z) - x, 0) ;
      f.state = 'sit'; f.grp.visible = true;
      return;
    }
  }
  pickables() { return this.list.filter((f) => f.state === 'sit').map((f) => { f.pick.x = f.x; f.pick.y = f.y + 0.05; f.pick.z = f.z; return f.pick; }); }
  scare(x, z, r) { for (const f of this.list) if (f.state === 'sit' && Math.hypot(f.x - x, f.z - z) < r) this.jump(f); }
  jump(f) {
    f.state = 'jump';
    const cx = streamCenter(f.z);
    const dir = Math.sign(cx - f.x) || 1;
    f.vx = dir * 1.6; f.vz = (Math.random() - 0.5) * 0.6; f.vy = 2.2; f.heading = Math.atan2(f.vx, f.vz);
    this.ctx.audio && this.ctx.audio.play('frogeep', { x: f.x, y: f.y, z: f.z, gain: 0.5 });
  }
  update(dt, cursor) {
    for (const f of this.list) {
      if (f.state === 'sit') {
        if (cursor && cursor.active && Math.hypot(cursor.x - f.x, cursor.z - f.z) < 1.0) this.jump(f);
        f.croak -= dt;
        if (U.uNight.value > 0.4 && f.croak < 0) {
          f.croak = 1.5 + Math.random() * 6;
          this.ctx.audio && this.ctx.audio.play('chorusfrog', { x: f.x, y: f.y, z: f.z, gain: 0.6 });
          f.puff = 1;
        }
        f.puff = Math.max(0, (f.puff || 0) - dt * 2);
        f.grp.scale.setScalar(2.2 * (1 + Math.sin((f.puff || 0) * 20) * 0.05 * (f.puff > 0 ? 1 : 0)));
      } else if (f.state === 'jump') {
        f.vy -= 9.8 * dt;
        f.x += f.vx * dt; f.z += f.vz * dt; f.y += f.vy * dt;
        const wl = waterLevel(f.z);
        if (f.vy < 0 && f.y < wl && isWater(f.x, f.z)) {
          splashFx(this.ctx.parts, f.x, wl, f.z, 0.3);
          this.ctx.water.disturb(f.x, f.z, 0.35, 0.05);
          this.ctx.audio && this.ctx.audio.play('plop', { x: f.x, y: wl, z: f.z, gain: 0.7 });
          f.state = 'gone'; f.timer = 12 + Math.random() * 20; f.grp.visible = false;
        } else if (f.y < groundAt(f.x, f.z)) { f.y = groundAt(f.x, f.z); f.state = 'sit'; }
      } else if (f.state === 'gone') {
        f.timer -= dt;
        if (f.timer < 0) this.place(f);
      }
      f.grp.position.set(f.x, f.y, f.z);
      f.grp.rotation.set(f.state === 'jump' ? -Math.atan2(f.vy, 1.6) * 0.6 : 0, f.heading, 0, 'YXZ');
    }
  }
}

// ---------------- Grasshoppers (spawned from grass on click) ----------------
export class Grasshoppers {
  constructor(scene, ctx) {
    this.ctx = ctx; this.pool = [];
    const geo = build([
      { p: [0, 0.01, 0], s: [0.008, 0.008, 0.03], c: [0.45, 0.42, 0.2] },
      { p: [0, 0.014, 0.025], s: [0.007, 0.008, 0.008], c: [0.4, 0.38, 0.18] },
      { type: 'box', p: [0.008, 0.016, -0.015], s: [0.003, 0.018, 0.03], r: [0.5, 0, 0], c: [0.38, 0.32, 0.15] },
      { type: 'box', p: [-0.008, 0.016, -0.015], s: [0.003, 0.018, 0.03], r: [0.5, 0, 0], c: [0.38, 0.32, 0.15] },
    ]);
    const wing = build([{ type: 'box', p: [0, 0.018, -0.005], s: [0.05, 0.002, 0.03], c: [0.85, 0.6, 0.15] }]);
    const mat = critterMaterial({ key: 'hopper' });
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, mat));
      const w = new THREE.Mesh(wing, mat); g.add(w);
      g.scale.setScalar(2.2); g.visible = false;
      scene.add(g);
      this.pool.push({ g, w, active: false });
    }
  }
  burst(x, z, n = 4) {
    let k = 0;
    for (const h of this.pool) {
      if (h.active || k >= n) continue;
      k++;
      h.active = true; h.g.visible = true;
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 1.5;
      h.x = x + Math.cos(a) * 0.3; h.z = z + Math.sin(a) * 0.3; h.y = groundAt(h.x, h.z) + 0.05;
      h.vx = Math.cos(a) * s; h.vz = Math.sin(a) * s; h.vy = 2.2 + Math.random() * 1.6;
      h.hops = 1 + Math.floor(Math.random() * 2);
    }
    this.ctx.audio && this.ctx.audio.play('hopper', { x, y: groundAt(x, z), z, gain: 0.6 });
  }
  update(dt) {
    for (const h of this.pool) {
      if (!h.active) continue;
      h.vy -= 9.8 * dt;
      h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
      h.w.visible = h.vy > -1;
      h.w.scale.x = 1 + Math.sin(U.uTime.value * 80) * 0.3;
      const g = groundAt(h.x, h.z);
      if (h.y < g) {
        if (isWater(h.x, h.z)) { this.ctx.water.disturb(h.x, h.z, 0.2, 0.01); h.active = false; h.g.visible = false; continue; }
        if (h.hops-- > 0) { h.y = g; h.vy = 2 + Math.random(); } else { h.active = false; h.g.visible = false; continue; }
      }
      h.g.position.set(h.x, h.y, h.z);
      h.g.rotation.set(0, Math.atan2(h.vx, h.vz), 0);
    }
  }
}
