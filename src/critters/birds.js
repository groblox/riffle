// Birds: ravens soaring over the canyon, American dippers on stream rocks, a great blue heron.
import * as THREE from 'three';
import { RNG, clamp, smoothstep, lerp } from '../noise.js';
import { groundAt, waterLevel, waterDepthAt, isWater, streamCenter, streamHalfW, streamSlope, BOUNDS, WF_Z } from '../world/shape.js';
import { U } from '../core/env.js';
import { build, critterMaterial, shapeGeo, lerpAngle, angleDiff } from './kit.js';
import { splashFx } from '../fx/particles.js';
import { rockTopAt } from '../world/rocks.js';

function wingPanel(len, chord, fingers = 0, tipTaper = 0.6) {
  // outline in XZ: x outward, z forward (leading edge at +z)
  const pts = [[0, chord * 0.5], [len, chord * 0.5 * tipTaper + chord * 0.05], [len, -chord * 0.4 * tipTaper], [0, -chord * 0.5]];
  if (fingers) {
    const out = [[0, chord * 0.5], [len * 0.75, chord * 0.42]];
    for (let i = 0; i < fingers; i++) {
      const z = chord * 0.4 - i * (chord * 0.8 / fingers);
      out.push([len, z], [len * 0.88, z - chord * 0.08]);
    }
    out.push([len * 0.7, -chord * 0.45], [0, -chord * 0.5]);
    return shapeGeo(out).rotateX(Math.PI / 2);
  }
  return shapeGeo(pts).rotateX(Math.PI / 2);
}

function colorGeo(g, c) {
  const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}

// ---------------- Ravens ----------------
export class Ravens {
  constructor(scene, ctx, count = 3) {
    this.ctx = ctx; this.list = [];
    const rng = this.rng = new RNG(31337);
    const black = [0.025, 0.025, 0.035];
    const bodyGeo = build([
      { p: [0, 0, 0], s: [0.09, 0.08, 0.26], c: black },
      { p: [0, 0.03, 0.24], s: [0.065, 0.065, 0.07], c: black },
      { type: 'cone', p: [0, 0.02, 0.33], s: [0.025, 0.09, 0.03], r: [Math.PI / 2, 0, 0], c: [0.04, 0.04, 0.04] },
      { type: 'box', p: [0, 0, -0.32], s: [0.16, 0.015, 0.18], c: black },
    ]);
    const mat = critterMaterial({ key: 'raven', rough: 0.35 });
    const inner = colorGeo(wingPanel(0.32, 0.26), black);
    const outer = colorGeo(wingPanel(0.36, 0.24, 5, 0.8), black);
    const wmat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.45 });
    for (let i = 0; i < count; i++) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(bodyGeo, mat));
      const wings = [];
      for (const side of [1, -1]) {
        const sh = new THREE.Group(); sh.position.set(0.06 * side, 0.02, 0.03);
        const m1 = new THREE.Mesh(inner, wmat); m1.scale.x = side;
        const el = new THREE.Group(); el.position.x = 0.32 * side;
        const m2 = new THREE.Mesh(outer, wmat); m2.scale.x = side;
        el.add(m2); sh.add(m1, el); grp.add(sh);
        wings.push({ sh, el, side });
      }
      grp.traverse((o) => { o.castShadow = true; });
      grp.scale.setScalar(1.25);
      scene.add(grp);
      const r = {
        grp, wings, cx: rng.range(20, 70), cz: rng.range(-80, 80), R: rng.range(25, 55), ang: rng.range(0, 6.28), angV: rng.range(0.12, 0.22) * (rng.chance(0.5) ? 1 : -1),
        alt: rng.range(30, 55), flap: 0, flapT: 0, bank: 0, heading: 0, nextCall: rng.range(5, 30),
        pick: { r: 2.2, label: 'Common Raven', guide: 'raven', kind: 'raven' }, x: 0, y: 0, z: 0,
      };
      r.pick.obj = r;
      this.list.push(r);
    }
  }
  pickables() { return this.list.map((r) => { r.pick.x = r.x; r.pick.y = r.y; r.pick.z = r.z; return r.pick; }); }
  poke(r) { r.flapT = 3; r.angV *= -1; this.ctx.audio && this.ctx.audio.play('raven', { x: r.x, y: r.y, z: r.z, gain: 1.4 }); r.nextCall = 6; }
  update(dt) {
    const t = U.uTime.value;
    for (const r of this.list) {
      r.ang += r.angV * dt;
      // slowly wander the circle centre
      r.cx += Math.sin(t * 0.05 + r.R) * dt * 0.8; r.cz += Math.cos(t * 0.04 + r.R) * dt * 0.8;
      r.cx = clamp(r.cx, -60, 110); r.cz = clamp(r.cz, -110, 110);
      const x = r.cx + Math.cos(r.ang) * r.R, z = r.cz + Math.sin(r.ang) * r.R;
      const g = Math.max(groundAt(x, z), waterLevel(z));
      const y = g + r.alt + Math.sin(t * 0.3 + r.R) * 4;
      const vx = x - r.x, vz = z - r.z;
      const hd = Math.atan2(vx, vz);
      if (r.x !== 0) r.heading = lerpAngle(r.heading, hd, Math.min(1, dt * 3));
      r.x = x; r.y = lerp(r.y || y, y, Math.min(1, dt)); r.z = z;
      r.bank = lerp(r.bank, -Math.sign(r.angV) * 0.35, dt);
      r.flapT -= dt;
      if (Math.random() < dt * 0.05) r.flapT = 1.5 + Math.random() * 2;
      const flapping = r.flapT > 0;
      r.flap += dt * (flapping ? 7 : 0);
      for (const w of r.wings) {
        const a = flapping ? Math.sin(r.flap) * 0.55 : 0.12 + Math.sin(t * 1.3) * 0.03;
        w.sh.rotation.z = a * w.side;
        w.el.rotation.z = (flapping ? Math.sin(r.flap - 0.8) * 0.4 : 0.05) * w.side;
      }
      r.grp.position.set(r.x, r.y, r.z);
      r.grp.rotation.set(0, r.heading, r.bank, 'YXZ');
      r.nextCall -= dt;
      if (r.nextCall < 0) {
        r.nextCall = 12 + Math.random() * 40;
        if (U.uNight.value < 0.5) this.ctx.audio && this.ctx.audio.play('raven', { x: r.x, y: r.y, z: r.z, gain: 1.0 });
      }
    }
  }
}

// ---------------- American Dipper ----------------
export class Dippers {
  constructor(scene, ctx, rocks, count = 3) {
    this.ctx = ctx; this.list = [];
    const rng = this.rng = new RNG(4545);
    this.rockList = rocks;
    this.refreshPerches();
    const slate = [0.24, 0.26, 0.28], head = [0.3, 0.27, 0.24];
    const geo = build([
      { p: [0, 0.075, 0], s: [0.055, 0.05, 0.075], c: slate },
      { p: [0, 0.115, 0.06], s: [0.035, 0.034, 0.036], c: head },
      { type: 'cone', p: [0, 0.112, 0.103], s: [0.007, 0.025, 0.007], r: [Math.PI / 2, 0, 0], c: [0.08, 0.07, 0.06] },
      { type: 'box', p: [0, 0.1, -0.075], s: [0.04, 0.008, 0.05], r: [-0.7, 0, 0], c: slate },
      { type: 'cyl', p: [0.018, 0.02, 0.0], s: [0.004, 0.045, 0.004], c: [0.75, 0.6, 0.55], seg: 5 },
      { type: 'cyl', p: [-0.018, 0.02, 0.0], s: [0.004, 0.045, 0.004], c: [0.75, 0.6, 0.55], seg: 5 },
      { p: [0.026, 0.122, 0.078], s: [0.006, 0.006, 0.006], c: [0.02, 0.02, 0.02], seg: 6 },
      { p: [-0.026, 0.122, 0.078], s: [0.006, 0.006, 0.006], c: [0.02, 0.02, 0.02], seg: 6 },
    ]);
    const mat = critterMaterial({ key: 'dipper', rough: 0.6 });
    const wingGeo = colorGeo(wingPanel(0.1, 0.06), slate);
    const wmat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 });
    for (let i = 0; i < count && this.perches.length; i++) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(geo, mat);
      grp.add(body);
      const wings = [];
      for (const side of [1, -1]) {
        const p = new THREE.Group(); p.position.set(0.04 * side, 0.09, 0.0);
        const m = new THREE.Mesh(wingGeo, wmat); m.scale.x = side; p.add(m); p.visible = false;
        grp.add(p); wings.push({ p, side });
      }
      grp.scale.setScalar(2.1);
      grp.traverse((o) => { o.castShadow = true; });
      scene.add(grp);
      const perch = this.perches[rng.int(0, this.perches.length - 1)];
      const d = {
        grp, body, wings, x: perch.x, y: perch.y, z: perch.z, perch, state: 'perch', timer: rng.range(2, 6), bob: 0, heading: rng.range(0, 6.28),
        from: null, to: null, t: 0, nextBob: 0.5, nextCall: rng.range(4, 15),
        pick: { r: 0.45, label: 'American Dipper', guide: 'dipper', kind: 'dipper' },
      };
      d.pick.obj = d;
      this.list.push(d);
    }
  }
  // emergent stream rocks; re-run when rocks are moved about
  refreshPerches() {
    const old = this.perches || [];
    this.perches = this.rockList.filter((rk) => rk.stream && rk.y + rk.h > waterLevel(rk.z) + 0.06 && Math.abs(rk.z) < BOUNDS)
      .map((rk) => {
        const y = rockTopAt(rk, rk.cx ?? rk.x, rk.cz ?? rk.z);
        return { x: rk.cx ?? rk.x, z: rk.cz ?? rk.z, y: y > -Infinity ? y : rk.y + rk.h * 0.96, r: rk.r, rk };
      })
      .filter((p) => p.y > waterLevel(p.z) + 0.04);
    for (const d of this.list || []) {
      if (d.perch && !this.perches.find((p) => p.rk === d.perch.rk)) {
        const p = this.perches.find((q) => q.rk === d.perch.rk);
        if (!p && d.state === 'perch') this.flyAway(d, true);
      } else if (d.perch) d.perch = this.perches.find((p) => p.rk === d.perch.rk);
    }
    return old;
  }
  pickables() { return this.list.filter((d) => d.grp.visible).map((d) => { d.pick.x = d.x; d.pick.y = d.y + 0.15; d.pick.z = d.z; return d.pick; }); }
  flyAway(d, far = false) {
    const rng = this.rng;
    let best = null;
    for (let k = 0; k < 30; k++) {
      const p = this.perches[rng.int(0, this.perches.length - 1)];
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist > (far ? 12 : 3) && dist < (far ? 45 : 22)) { best = p; break; }
    }
    if (!best) return;
    d.state = 'fly'; d.from = { x: d.x, y: d.y, z: d.z }; d.to = best; d.t = 0;
    d.dur = Math.hypot(best.x - d.x, best.z - d.z) / 5.5;
  }
  scare(x, z, r) { for (const d of this.list) if (d.state === 'perch' && Math.hypot(d.x - x, d.z - z) < r) this.flyAway(d, true); }
  update(dt) {
    const rng = this.rng, t = U.uTime.value;
    for (const d of this.list) {
      d.grp.visible = U.uNight.value < 0.6 && d.state !== 'under';
      d.timer -= dt;
      if (d.state === 'perch') {
        d.nextBob -= dt;
        if (d.nextBob < 0) { d.bob = 1; d.nextBob = rng.range(0.4, 1.3); }
        d.bob = Math.max(0, d.bob - dt * 4);
        const dip = Math.sin(d.bob * Math.PI) * 0.035;
        d.body.position.y = -dip; d.body.rotation.x = dip * 2;
        if (rng.next() < dt * 0.4) d.heading += rng.range(-1.2, 1.2);
        if (d.timer < 0) {
          d.timer = rng.range(3, 9);
          if (rng.chance(0.35)) {
            // dive in and forage under water
            d.state = 'dive'; d.t = 0; d.from = { x: d.x, y: d.y, z: d.z };
          } else this.flyAway(d);
        }
        for (const w of d.wings) w.p.visible = false;
      } else if (d.state === 'fly') {
        d.t += dt / Math.max(d.dur, 0.2);
        const k = Math.min(1, d.t);
        const e = k * k * (3 - 2 * k);
        const x = lerp(d.from.x, d.to.x, k), z = lerp(d.from.z, d.to.z, k);
        const base = lerp(d.from.y, d.to.y, e);
        const y = Math.max(base + Math.sin(k * Math.PI) * 0.35, waterLevel(z) + 0.25);
        d.heading = Math.atan2(d.to.x - d.from.x, d.to.z - d.from.z);
        d.x = x; d.y = y; d.z = z;
        for (const w of d.wings) { w.p.visible = true; w.p.rotation.z = Math.sin(t * 45) * 0.9 * w.side; }
        d.body.position.y = 0; d.body.rotation.x = -0.1;
        if (k >= 1) { d.state = 'perch'; d.perch = d.to; d.timer = rng.range(3, 8); d.y = d.to.y; }
      } else if (d.state === 'dive') {
        d.t += dt;
        const wl = waterLevel(d.z);
        d.x += Math.sin(d.heading) * dt * 0.5; d.z += Math.cos(d.heading) * dt * 0.5;
        d.y -= dt * 0.8;
        if (d.y < wl) {
          d.state = 'under'; d.t = 0; d.timer = rng.range(2, 4.5);
          splashFx(this.ctx.parts, d.x, wl, d.z, 0.25); this.ctx.water.disturb(d.x, d.z, 0.3, 0.03);
          this.ctx.audio && this.ctx.audio.play('plop', { x: d.x, y: wl, z: d.z, gain: 0.5 });
        }
      } else if (d.state === 'under') {
        d.x += Math.sin(d.heading) * dt * 0.6; d.z += Math.cos(d.heading) * dt * 0.6;
        if (rng.next() < dt * 3) this.ctx.water.disturb(d.x, d.z, 0.2, 0.004);
        if (!isWater(d.x, d.z, 0.1)) d.heading += Math.PI * 0.6;
        if (d.timer < 0) {
          // pop up onto the nearest perch
          let best = null, bd = 1e9;
          for (const p of this.perches) { const dd = Math.hypot(p.x - d.x, p.z - d.z); if (dd < bd) { bd = dd; best = p; } }
          const wl = waterLevel(d.z);
          splashFx(this.ctx.parts, d.x, wl, d.z, 0.2); this.ctx.water.disturb(d.x, d.z, 0.3, 0.02);
          d.state = 'fly'; d.from = { x: d.x, y: wl, z: d.z }; d.to = best; d.t = 0; d.dur = Math.max(0.4, bd / 5);
        }
      }
      d.grp.position.set(d.x, d.y, d.z);
      d.grp.rotation.set(0, d.heading, 0);
    }
  }
}

// ---------------- Great Blue Heron ----------------
// Standing: hunched in the shallows, walking, striking. Flying: the neck drawn back
// into an S with the bill level, legs trailing straight out behind, and deep, slow beats of long bowed
// wings (arm and hand articulate: the hand lags the arm and sweeps back on the upstroke), with glides.
// It lifts off with a few hard strokes, follows the creek a few metres up, then flares and lands.
function heronWing(arm, hand, armCol, edgeCol, tipCol) {
  const paint = (g, fn) => {
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) c.set(fn(p.getX(i), p.getZ(i)), i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const inner = paint(wingPanel(arm, 0.42, 0, 0.9), (x, z) => mixc(armCol, edgeCol, smoothstep(0.08, 0.2, z)));
  const outer = paint(wingPanel(hand, 0.38, 6, 0.75), (x, z) => mixc(mixc(armCol, tipCol, smoothstep(0.05, 0.3, x)), edgeCol, smoothstep(0.1, 0.19, z) * 0.6));
  return { inner, outer };
}

export class Heron {
  constructor(scene, ctx, seed = 2468, startZ = 66) {
    this.ctx = ctx;
    const rng = this.rng = new RNG(seed);
    const blue = [0.32, 0.38, 0.46], light = [0.62, 0.66, 0.7], white = [0.85, 0.86, 0.84], yellow = [0.85, 0.65, 0.2], dark = [0.08, 0.08, 0.1];
    const leg = [0.35, 0.28, 0.2];
    // body (origin at the feet; the rig pivots it about its middle)
    const body = build([
      { p: [0, 0.86, 0], s: [0.13, 0.14, 0.3], r: [0.22, 0, 0], c: blue },
      { p: [0, 0.9, 0.12], s: [0.1, 0.11, 0.14], c: light },
      { type: 'box', p: [0, 0.8, -0.3], s: [0.12, 0.04, 0.2], r: [0.5, 0, 0], c: [0.25, 0.3, 0.38] },
    ]);
    const folded = build([
      { p: [0.1, 0.87, -0.02], s: [0.04, 0.1, 0.26], r: [0.2, 0, 0], c: [0.26, 0.31, 0.4] },
      { p: [-0.1, 0.87, -0.02], s: [0.04, 0.1, 0.26], r: [0.2, 0, 0], c: [0.26, 0.31, 0.4] },
    ]);
    // legs hang from the hip (y = 0.76), so they can swing back in flight
    const legs = build([
      { type: 'cyl', p: [0.05, -0.38, 0.0], s: [0.012, 0.75, 0.012], c: leg, seg: 5 },
      { type: 'cyl', p: [-0.05, -0.38, 0.06], s: [0.012, 0.75, 0.012], r: [0.15, 0, 0], c: leg, seg: 5 },
      { type: 'box', p: [0.05, -0.755, 0.06], s: [0.012, 0.008, 0.12], c: leg },
      { type: 'box', p: [-0.05, -0.75, 0.12], s: [0.012, 0.008, 0.12], r: [0.15, 0, 0], c: leg },
    ]);
    const V = THREE.Vector3;
    // the head, built about its own centre
    const head = (o) => [
      { p: [o[0], o[1], o[2]], s: [0.042, 0.04, 0.062], c: white },
      { type: 'box', p: [o[0], o[1] + 0.03, o[2] - 0.04], s: [0.018, 0.016, 0.13], r: [-0.25, 0, 0], c: dark },
      { type: 'cone', p: [o[0], o[1] - 0.01, o[2] + 0.14], s: [0.02, 0.19, 0.014], r: [Math.PI / 2, 0, 0], c: yellow, seg: 6 },
      { p: [o[0] + 0.032, o[1] + 0.01, o[2] + 0.025], s: [0.008, 0.008, 0.008], c: [0.95, 0.85, 0.2], seg: 6 },
      { p: [o[0] - 0.032, o[1] + 0.01, o[2] + 0.025], s: [0.008, 0.008, 0.008], c: [0.95, 0.85, 0.2], seg: 6 },
    ];
    const neckCurve = new THREE.CatmullRomCurve3([new V(0, 0, 0), new V(0, 0.12, 0.09), new V(0, 0.25, 0.03), new V(0, 0.36, 0.06), new V(0, 0.41, 0.13)]);
    const neck = build([
      { geo: new THREE.TubeGeometry(neckCurve, 18, 0.03, 8, false), c: light },
      { p: [0, 0.0, 0.0], s: [0.045, 0.045, 0.045], c: light },
      ...head([0, 0.415, 0.15]),
      { type: 'box', p: [0, 0.1, 0.1], s: [0.02, 0.18, 0.03], r: [0.4, 0, 0], c: [0.85, 0.85, 0.82] },
    ]);
    // in flight the neck folds down into a deep S, a pouch hanging under the chin, head back on the shoulders
    const flyCurve = new THREE.CatmullRomCurve3([new V(0, 0, -0.02), new V(0, -0.05, 0.07), new V(0, -0.1, 0.15), new V(0, -0.06, 0.22), new V(0, 0.0, 0.24), new V(0, 0.03, 0.27)]);
    const flyNeck = build([
      { geo: new THREE.TubeGeometry(flyCurve, 18, 0.034, 8, false), c: light },
      { p: [0, -0.08, 0.13], s: [0.045, 0.06, 0.07], c: light },
      { type: 'box', p: [0, -0.11, 0.12], s: [0.02, 0.06, 0.06], r: [0.3, 0, 0], c: [0.85, 0.85, 0.82] },
      ...head([0, 0.035, 0.3]),
    ]);
    const mat = critterMaterial({ key: 'heron', rough: 0.7 });
    this.grp = new THREE.Group();
    this.rig = new THREE.Group(); this.rig.position.y = 0.86;
    this.body = new THREE.Mesh(body, mat); this.body.position.y = -0.86;
    this.folded = new THREE.Mesh(folded, mat); this.folded.position.y = -0.86;
    this.legs = new THREE.Mesh(legs, mat);
    this.hip = new THREE.Group(); this.hip.position.set(0, 0.76 - 0.86, -0.02); this.hip.add(this.legs);
    this.neck = new THREE.Mesh(neck, mat);
    this.flyNeck = new THREE.Mesh(flyNeck, mat); this.flyNeck.visible = false;
    this.neckPivot = new THREE.Group(); this.neckPivot.position.set(0, 0.93 - 0.86, 0.22); this.neckPivot.add(this.neck, this.flyNeck);
    this.rig.add(this.body, this.folded, this.hip, this.neckPivot);
    this.grp.add(this.rig);
    const W = heronWing(0.42, 0.52, [0.36, 0.42, 0.5], [0.6, 0.62, 0.64], [0.1, 0.11, 0.14]);
    const wmat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 });
    this.wings = [];
    for (const side of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(0.1 * side, 0.05, 0.06);
      const arm = new THREE.Mesh(W.inner, wmat); arm.scale.x = side;
      const el = new THREE.Group(); el.position.set(0.41 * side, 0, 0);
      const hand = new THREE.Mesh(W.outer, wmat); hand.scale.x = side;
      el.add(hand); sh.add(arm, el); sh.visible = false;
      this.rig.add(sh); this.wings.push({ sh, el, side });
    }
    this.grp.traverse((o) => { o.castShadow = true; });
    scene.add(this.grp);
    this.spots = [];
    for (let z = -BOUNDS; z < BOUNDS; z += 1.5) {
      for (const s of [-1, 1]) {
        const hw = streamHalfW(z);
        const x = streamCenter(z) + s * hw * 0.88 * Math.sqrt(1 + streamSlope(z) ** 2);
        const dep = waterDepthAt(x, z);
        if (dep > 0.08 && dep < 0.32 && Math.abs(z - WF_Z) > 8) this.spots.push({ x, z, s });
      }
    }
    const s = this.spots.reduce((a, b) => (Math.abs(b.z - startZ) < Math.abs(a.z - startZ) ? b : a), this.spots[0]);
    this.x = s.x; this.z = s.z; this.y = groundAt(s.x, s.z);
    this.heading = Math.PI * 0.7; this.state = 'stand'; this.timer = 5; this.strike = 0; this.step = 0;
    this.phase = 0; this.amp = 0; this.bank = 0;
    this.pick = { r: 1.0, label: 'Great Blue Heron', guide: 'heron', kind: 'heron', obj: this };
  }
  pickables() { this.pick.x = this.x; this.pick.y = this.y + (this.state === 'fly' ? 0.86 : 0.8); this.pick.z = this.z; return [this.pick]; }

  takeOff() {
    if (this.state === 'fly') return;
    const rng = this.rng;
    let to = null;
    for (let k = 0; k < 40; k++) { const s = this.spots[rng.int(0, this.spots.length - 1)]; const d = Math.abs(s.z - this.z); if (d > 30 && d < 100) { to = s; break; } }
    if (!to) return;
    // the flight line follows the creek, a little off to one side, rising to cruise height and back down
    const N = 64, path = [];
    const lat0 = this.x - streamCenter(this.z), lat1 = to.x - streamCenter(to.z);
    const y0 = groundAt(this.x, this.z), y1 = groundAt(to.x, to.z);
    for (let i = 0; i <= N; i++) {
      const k = i / N, z = lerp(this.z, to.z, k);
      const x = streamCenter(z) + lerp(lat0, lat1, k) + Math.sin(k * Math.PI) * 1.5;
      const alt = 6.5 * smoothstep(0, 0.3, k) * (1 - smoothstep(0.66, 1, k));
      path.push(new THREE.Vector3(x, Math.max(lerp(y0, y1, k), waterLevel(z)) + alt, z));
    }
    path[0].set(this.x, y0, this.z); path[N].set(to.x, y1, to.z);
    let L = 0; const acc = [0];
    for (let i = 1; i <= N; i++) { L += path[i].distanceTo(path[i - 1]); acc.push(L); }
    this.flight = { path, acc, L, s: 0, v: 0 };
    this.state = 'fly'; this.t = 0;
    this.ctx.audio && this.ctx.audio.play('heron', { x: this.x, y: this.y, z: this.z, gain: 1.0 });
    splashFx(this.ctx.parts, this.x, waterLevel(this.z), this.z, 0.35);
    this.ctx.water && this.ctx.water.disturb(this.x, this.z, 0.6, 0.05);
  }
  pointAt(s, out) {
    const f = this.flight, A = f.acc;
    let i = 1; while (i < A.length - 1 && A[i] < s) i++;
    const u = clamp((s - A[i - 1]) / Math.max(1e-6, A[i] - A[i - 1]), 0, 1);
    return out.lerpVectors(f.path[i - 1], f.path[i], u);
  }
  scare(x, z, r) { if (Math.hypot(this.x - x, this.z - z) < r * 1.5) this.takeOff(); }

  // wings: arm and hand beat together, the hand lagging and sweeping back on the upstroke
  flap(dt, freq, amp) {
    this.phase += dt * Math.PI * 2 * freq;
    this.amp += (amp - this.amp) * Math.min(1, dt * 3);
    const A = this.amp, ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph);
    for (const w of this.wings) {
      w.sh.visible = true;
      w.sh.rotation.set(0, w.side * A * 0.12 * -sn, w.side * (0.2 + A * 0.55 * sn - (1 - A) * 0.24));
      w.el.rotation.set(0, w.side * A * 0.42 * Math.max(0, cs), w.side * (-0.1 + A * 0.28 * Math.sin(ph - 0.9) - (1 - A) * 0.12));
    }
    return sn;
  }

  update(dt, camPos) {
    const rng = this.rng;
    this.timer -= dt;
    if (this.state === 'stand' || this.state === 'walk') {
      for (const w of this.wings) w.sh.visible = false;
      this.folded.visible = true; this.neck.visible = true; this.flyNeck.visible = false;
      this.hip.rotation.x = 0; this.rig.rotation.set(0, 0, 0); this.rig.position.y = 0.86;
      this.neckPivot.rotation.x = 0;
      // too close? leave
      if (camPos && Math.hypot(camPos.x - this.x, camPos.z - this.z) < 2.2 && camPos.y - this.y < 3) this.takeOff();
      if (this.state === 'walk') {
        this.step += dt;
        const nx = this.x + Math.sin(this.heading) * dt * 0.25, nz = this.z + Math.cos(this.heading) * dt * 0.25;
        const dep = waterDepthAt(nx, nz);
        if (dep < 0.4 && groundAt(nx, nz) < waterLevel(nz) + 0.15) { this.x = nx; this.z = nz; } else this.heading += 1.2;
        this.y = groundAt(this.x, this.z);
        this.rig.position.y = 0.86 + Math.abs(Math.sin(this.step * 3)) * 0.015;
        if (this.timer < 0) { this.state = 'stand'; this.timer = rng.range(4, 12); }
      } else if (this.timer < 0) {
        const r = rng.next();
        if (r < 0.4) { this.state = 'walk'; this.timer = rng.range(2, 5); this.heading += rng.range(-0.8, 0.8); }
        else if (r < 0.65) { this.strike = 1; this.timer = rng.range(5, 12); }
        else this.timer = rng.range(3, 8);
      }
      if (this.strike > 0) {
        this.strike -= dt * 1.6;
        const s = Math.sin(Math.max(0, this.strike) * Math.PI);
        this.neckPivot.rotation.x = s * 1.25;
        if (this.strike < 0.5 && this.strike + dt * 1.6 >= 0.5) {
          const bx = this.x + Math.sin(this.heading) * 0.6, bz = this.z + Math.cos(this.heading) * 0.6;
          this.ctx.water.disturb(bx, bz, 0.3, 0.04);
          splashFx(this.ctx.parts, bx, waterLevel(bz), bz, 0.2);
          this.ctx.audio && this.ctx.audio.play('plop', { x: bx, y: this.y, z: bz, gain: 0.4 });
        }
      }
    } else if (this.state === 'fly') {
      const f = this.flight, k = f.s / f.L;
      this.t += dt;
      // speed: a laboured start, an easy 7 m/s along the creek, braking into the landing
      const vT = k < 0.12 ? lerp(1.5, 6, smoothstep(0, 0.12, k)) : k > 0.8 ? lerp(7, 1.2, smoothstep(0.8, 1, k)) : 7;
      f.v += (vT - f.v) * Math.min(1, dt * 2.5);
      const prev = this.pointAt(f.s, this._p0 || (this._p0 = new THREE.Vector3())).clone();
      f.s = Math.min(f.L, f.s + Math.max(0.6, f.v) * dt);
      const p = this.pointAt(f.s, this._p1 || (this._p1 = new THREE.Vector3()));
      const ahead = this.pointAt(Math.min(f.L, f.s + 2.5), this._p2 || (this._p2 = new THREE.Vector3()));
      const k2 = f.s / f.L;
      // a hop off the water to start
      const hop = Math.sin(clamp(this.t / 0.5, 0, 1) * Math.PI) * 0.25 * (k2 < 0.1 ? 1 : 0);
      this.x = p.x; this.z = p.z; this.y = p.y + hop - 0.86 * smoothstep(0.0, 0.08, k2) * (1 - smoothstep(0.93, 1, k2)) + 0.0;
      const hd = Math.atan2(ahead.x - p.x, ahead.z - p.z);
      const dh = angleDiff(this.heading, hd);
      this.heading = lerpAngle(this.heading, hd, Math.min(1, dt * 2.5));
      this.bank += (clamp(-dh * 1.2, -0.45, 0.45) - this.bank) * Math.min(1, dt * 2);
      const vy = (p.y - prev.y) / Math.max(1e-4, dt), vh = Math.max(0.5, Math.hypot(p.x - prev.x, p.z - prev.z) / Math.max(1e-4, dt));
      // wing beat: hard and fast taking off and landing, slow and deep cruising, short glides now and then
      const landing = smoothstep(0.86, 0.97, k2), taking = 1 - smoothstep(0.04, 0.2, k2);
      const glide = k2 > 0.3 && k2 < 0.8 && Math.sin(this.t * 0.55 + 1.3) > 0.55 ? 1 : 0;
      const freq = lerp(1.8, 2.6, Math.max(landing, taking));
      const amp = glide ? 0.12 : lerp(0.78, 1.0, Math.max(landing, taking));
      const sn = this.flap(dt, freq, amp);
      // the body: level in cruise, a touch nose-up climbing, rearing up into the flare
      const pitch = -clamp(Math.atan2(vy, vh) * 0.45, -0.25, 0.3) - 0.55 * landing - 0.35 * taking + 0.04;
      this.rig.rotation.set(pitch, 0, this.bank, 'YXZ');
      this.rig.position.y = 0.86 - sn * this.amp * 0.035;
      // legs trail behind, then swing down for the landing; neck folds once airborne
      this.hip.rotation.x = lerp(0.15, 1.42, smoothstep(0.02, 0.12, k2)) * (1 - landing) + 0.35 * landing;
      const tuck = k2 > 0.05 && k2 < 0.95;
      this.neck.visible = !tuck; this.flyNeck.visible = tuck;
      this.neckPivot.rotation.x = tuck ? -pitch * 0.6 : -0.4;
      this.folded.visible = false;
      if (f.s >= f.L - 1e-3) {
        this.state = 'stand'; this.timer = 6;
        this.y = groundAt(this.x, this.z);
        splashFx(this.ctx.parts, this.x, waterLevel(this.z), this.z, 0.2);
        this.ctx.water && this.ctx.water.disturb(this.x, this.z, 0.5, 0.03);
      }
    }
    this.grp.position.set(this.x, this.y - 0.05, this.z);
    this.grp.rotation.set(0, this.heading, 0);
  }
}
