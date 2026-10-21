// Life under stones: turn a rock over and something is usually there. On land a ground beetle
// sprints for cover, a millipede ambles off (and curls up if poked), or a tiger salamander waddles
// away; in the creek a sculpin darts to the next stone, a stonefly nymph clings to the bed and
// caddisfly larvae drag their pebble cases. Also leaves a damp, dark patch where the stone lay.
import * as THREE from 'three';
import { RNG, smoothstep } from '../noise.js';
import { groundAt, isWater, normalAt, lateral, streamHalfW, bioAt } from '../world/shape.js';
import { U } from '../core/env.js';
import { build, critterMaterial } from './kit.js';

const SPECIES = {
  beetle:     { label: 'Ground Beetle', guide: 'beetle', r: 0.25 },
  millipede:  { label: 'Millipede', guide: 'millipede', r: 0.3 },
  salamander: { label: 'Western Tiger Salamander', guide: 'salamander', r: 0.4 },
  sculpin:    { label: 'Mottled Sculpin', guide: 'sculpin', r: 0.35 },
  stonefly:   { label: 'Stonefly Nymph', guide: 'stonefly', r: 0.25 },
  caddis:     { label: 'Caddisfly Larva', guide: 'caddis', r: 0.25 },
};

function legs(list, n, z0, z1, x, len, c, y = 0.004, splay = 0.45) {
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? z0 : z0 + (z1 - z0) * i / (n - 1);
    for (const s of [1, -1]) list.push({ type: 'box', p: [s * (x + len * 0.45), y, z], s: [len, 0.0016, 0.0016], r: [0, s * (i - (n - 1) / 2) * splay, -s * 0.35], c });
  }
}

function makeGeos() {
  const G = {};
  {
    const shell = [0.05, 0.06, 0.065], sheen = [0.07, 0.1, 0.09], leg = [0.04, 0.04, 0.04];
    const p = [
      { p: [0, 0.009, -0.004], s: [0.011, 0.0072, 0.018], c: shell },
      { p: [0, 0.0105, -0.004], s: [0.008, 0.004, 0.015], c: sheen },
      { p: [0, 0.009, 0.013], s: [0.0085, 0.006, 0.007], c: shell },
      { p: [0, 0.008, 0.021], s: [0.0055, 0.004, 0.0055], c: shell },
      { type: 'box', p: [0.007, 0.009, 0.03], s: [0.0012, 0.0012, 0.016], r: [0, 0.35, 0], c: leg },
      { type: 'box', p: [-0.007, 0.009, 0.03], s: [0.0012, 0.0012, 0.016], r: [0, -0.35, 0], c: leg },
    ];
    legs(p, 3, -0.008, 0.012, 0.008, 0.016, leg);
    G.beetle = build(p);
  }
  {
    const dark = [0.1, 0.11, 0.07], yel = [0.72, 0.62, 0.18], belly = [0.55, 0.5, 0.22];
    const p = [
      { p: [0, 0.013, 0.072], s: [0.02, 0.011, 0.022], c: dark },
      { p: [0, 0.009, 0.074], s: [0.018, 0.007, 0.02], c: belly },
      { p: [0.014, 0.02, 0.08], s: [0.0045, 0.0045, 0.0045], c: [0.02, 0.02, 0.02], seg: 6 },
      { p: [-0.014, 0.02, 0.08], s: [0.0045, 0.0045, 0.0045], c: [0.02, 0.02, 0.02], seg: 6 },
      { p: [0, 0.014, 0.025], s: [0.019, 0.013, 0.05], c: dark },
      { p: [0, 0.009, 0.025], s: [0.017, 0.008, 0.046], c: belly },
      { p: [0, 0.013, -0.025], s: [0.016, 0.012, 0.03], c: dark },
      { type: 'cone', p: [0, 0.012, -0.088], s: [0.011, 0.095, 0.007], r: [-Math.PI / 2, 0, 0], c: dark, seg: 8 },
    ];
    const rng = new RNG(71);
    for (let i = 0; i < 11; i++) {
      const z = rng.range(-0.1, 0.085), w = z > 0.05 ? 0.014 : z > -0.04 ? 0.015 : 0.007;
      p.push({ p: [rng.range(-w, w), 0.02 + (z < -0.05 ? -0.004 : 0), z], s: [rng.range(0.004, 0.007), 0.004, rng.range(0.005, 0.009)], c: yel, seg: 6 });
    }
    for (const [z, s] of [[0.045, 1], [0.045, -1], [-0.03, 1], [-0.03, -1]]) {
      p.push({ type: 'box', p: [s * 0.024, 0.006, z], s: [0.022, 0.006, 0.006], r: [0, s * (z > 0 ? -0.5 : 0.5), -s * 0.3], c: dark });
    }
    G.salamander = build(p);
  }
  {
    const seg = [0.22, 0.09, 0.05], spot = [0.75, 0.55, 0.15], leg = [0.55, 0.45, 0.3];
    G.milliSeg = build([
      { p: [0, 0.0055, 0], s: [0.0058, 0.0048, 0.0062], c: seg, seg: 8 },
      { p: [0.0048, 0.0062, 0], s: [0.0016, 0.0016, 0.0022], c: spot, seg: 5 },
      { p: [-0.0048, 0.0062, 0], s: [0.0016, 0.0016, 0.0022], c: spot, seg: 5 },
      { type: 'box', p: [0.0062, 0.0015, 0], s: [0.004, 0.001, 0.001], r: [0, 0, -0.6], c: leg },
      { type: 'box', p: [-0.0062, 0.0015, 0], s: [0.004, 0.001, 0.001], r: [0, 0, 0.6], c: leg },
    ]);
    G.milliHead = build([
      { p: [0, 0.005, 0], s: [0.0055, 0.0045, 0.006], c: [0.12, 0.05, 0.03], seg: 8 },
      { type: 'box', p: [0.004, 0.007, 0.008], s: [0.001, 0.001, 0.01], r: [0.3, 0.5, 0], c: leg },
      { type: 'box', p: [-0.004, 0.007, 0.008], s: [0.001, 0.001, 0.01], r: [0.3, -0.5, 0], c: leg },
    ]);
  }
  {
    const brown = [0.3, 0.26, 0.17], dark = [0.13, 0.11, 0.07], pale = [0.62, 0.58, 0.45];
    const p = [
      { p: [0, 0.01, 0.022], s: [0.017, 0.0105, 0.019], c: brown },
      { p: [0, 0.006, 0.022], s: [0.015, 0.006, 0.017], c: pale },
      { p: [0, 0.009, -0.01], s: [0.012, 0.009, 0.032], c: brown },
      { type: 'cone', p: [0, 0.008, -0.05], s: [0.007, 0.034, 0.004], r: [-Math.PI / 2, 0, 0], c: dark, seg: 6 },
      { type: 'box', p: [0, 0.009, -0.075], s: [0.002, 0.012, 0.012], c: dark },
      { type: 'box', p: [0.019, 0.006, 0.012], s: [0.022, 0.0018, 0.016], r: [0, 0.3, -0.25], c: brown },
      { type: 'box', p: [-0.019, 0.006, 0.012], s: [0.022, 0.0018, 0.016], r: [0, -0.3, 0.25], c: brown },
      { type: 'box', p: [0, 0.019, -0.005], s: [0.0018, 0.008, 0.034], c: dark },
      { p: [0.009, 0.017, 0.032], s: [0.003, 0.003, 0.003], c: [0.6, 0.5, 0.2], seg: 5 },
      { p: [-0.009, 0.017, 0.032], s: [0.003, 0.003, 0.003], c: [0.6, 0.5, 0.2], seg: 5 },
    ];
    const rng = new RNG(72);
    for (let i = 0; i < 9; i++) p.push({ p: [rng.range(-0.01, 0.01), 0.014, rng.range(-0.035, 0.03)], s: [0.005, 0.003, 0.006], c: dark, seg: 5 });
    G.sculpin = build(p);
  }
  {
    const body = [0.42, 0.33, 0.15], dark = [0.2, 0.15, 0.07];
    const p = [
      { p: [0, 0.004, 0.02], s: [0.0055, 0.0028, 0.0055], c: dark },
      { p: [0, 0.004, 0.011], s: [0.0068, 0.0026, 0.004], c: body },
      { p: [0, 0.004, 0.004], s: [0.0072, 0.0026, 0.004], c: dark },
      { p: [0, 0.004, -0.003], s: [0.007, 0.0026, 0.004], c: body },
      { p: [0, 0.0038, -0.017], s: [0.0055, 0.0024, 0.012], c: body },
      { type: 'box', p: [0.002, 0.004, -0.036], s: [0.0008, 0.0008, 0.014], r: [0, 0.12, 0], c: dark },
      { type: 'box', p: [-0.002, 0.004, -0.036], s: [0.0008, 0.0008, 0.014], r: [0, -0.12, 0], c: dark },
      { type: 'box', p: [0.004, 0.0045, 0.03], s: [0.0007, 0.0007, 0.014], r: [0, 0.3, 0], c: dark },
      { type: 'box', p: [-0.004, 0.0045, 0.03], s: [0.0007, 0.0007, 0.014], r: [0, -0.3, 0], c: dark },
    ];
    legs(p, 3, -0.003, 0.011, 0.006, 0.013, dark, 0.003, 0.6);
    G.stonefly = build(p);
  }
  {
    const rng = new RNG(73);
    const p = [
      { type: 'cyl', rt: 0.0042, rb: 0.0048, p: [0, 0.005, 0], s: [1, 0.026, 1], r: [Math.PI / 2, 0, 0], c: [0.42, 0.37, 0.3], seg: 8 },
      { p: [0, 0.005, 0.014], s: [0.0032, 0.003, 0.004], c: [0.15, 0.1, 0.05], seg: 6 },
    ];
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, 6.28), z = rng.range(-0.012, 0.012);
      const t = rng.range(0.3, 0.6);
      p.push({ p: [Math.cos(a) * 0.0045, 0.005 + Math.sin(a) * 0.0045, z], s: [0.0022, 0.0018, 0.0024], c: [t, t * 0.92, t * 0.8], seg: 5 });
    }
    legs(p, 3, 0.012, 0.016, 0.003, 0.006, [0.2, 0.15, 0.08], 0.003, 0.3);
    G.caddis = build(p);
  }
  return G;
}

export class UnderRock {
  constructor(scene, ctx) {
    this.scene = scene; this.ctx = ctx;
    this.rng = new RNG(8282);
    this.geo = makeGeos();
    this.mat = critterMaterial({ key: 'under', rough: 0.55 });
    this.matShiny = critterMaterial({ key: 'under-shiny', rough: 0.22 });
    this.list = [];
    this.pending = [];
    this.patches = [];
    this.patchMat = new THREE.MeshStandardMaterial({ color: 0x1d150e, roughness: 0.55, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  // what tends to live under a stone here
  choose(x, z, wet) {
    const r = this.rng.next();
    if (wet) return r < 0.36 ? 'sculpin' : r < 0.7 ? 'stonefly' : 'caddis';
    const damp = Math.abs(lateral(x, z)) < streamHalfW(z) * 2.4 || bioAt(x, z).forest > 0.5;
    if (damp) return r < 0.42 ? 'beetle' : r < 0.7 ? 'millipede' : 'salamander';
    return r < 0.65 ? 'beetle' : 'millipede';
  }

  // a stone was lifted off x, z; reveal what was under it after `delay` seconds
  reveal(x, z, r, wet, delay = 0.3) {
    const kind = this.choose(x, z, wet);
    this.pending.push({ x, z, r, wet, kind, t: delay });
    if (!wet) this.addPatch(x, z, r);
    return SPECIES[kind];
  }

  addPatch(x, z, r) {
    const seg = 28, rings = 3;
    const pos = [], col = [], idx = [];
    const rng = this.rng;
    const jit = Array.from({ length: seg }, () => rng.range(0.75, 1.05));
    pos.push(x, groundAt(x, z) + 0.012, z); col.push(1, 1, 1, 0.85);
    for (let k = 1; k <= rings; k++) {
      for (let i = 0; i < seg; i++) {
        const a = i / seg * Math.PI * 2, rr = r * 0.85 * (k / rings) * jit[i];
        const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
        pos.push(px, groundAt(px, pz) + 0.012, pz);
        col.push(1, 1, 1, k === rings ? 0 : 0.85 - k * 0.2);
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    for (let k = 1; k < rings; k++) for (let i = 0; i < seg; i++) {
      const a = 1 + (k - 1) * seg + i, b = 1 + (k - 1) * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = this.patchMat.clone();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    this.patches.push({ m, t: 0, life: 45 });
  }

  spawn(p) {
    const rng = this.rng;
    const sp = SPECIES[p.kind];
    const a = rng.range(0, 6.28), d = rng.range(0, p.r * 0.35);
    const c = {
      kind: p.kind, x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, heading: rng.range(0, 6.28),
      state: 'go', t: 0, timer: 0, age: 0, scale: 0, grow: 1, speed: 0, turn: 0, darts: 0, wet: p.wet,
      pick: { r: sp.r, label: sp.label, guide: sp.guide, kind: 'under' },
    };
    c.pick.obj = c;
    const grp = new THREE.Group();
    if (p.kind === 'millipede') {
      c.segs = [];
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(i === 0 ? this.geo.milliHead : this.geo.milliSeg, this.mat);
        m.castShadow = true;
        this.scene.add(m);
        c.segs.push(m);
      }
      c.trail = [];
      c.life = 30;
    } else {
      const m = new THREE.Mesh(this.geo[p.kind], p.kind === 'beetle' ? this.matShiny : this.mat);
      m.castShadow = true;
      grp.add(m);
      c.mesh = m;
      if (p.kind === 'caddis') {
        // a few larvae share the underside of a stone
        for (let i = 0; i < 2; i++) {
          const m2 = new THREE.Mesh(this.geo.caddis, this.mat);
          m2.position.set(rng.range(-0.08, 0.08), 0, rng.range(-0.08, 0.08)); m2.rotation.y = rng.range(0, 6.28);
          grp.add(m2);
        }
      }
    }
    c.grp = grp;
    c.size = { beetle: 2.2, millipede: 2.0, salamander: 1.5, sculpin: 2.3, stonefly: 3.0, caddis: 2.8 }[p.kind];
    c.life = c.life || { beetle: 4.5, salamander: 28, sculpin: 9, stonefly: 22, caddis: 35 }[p.kind];
    this.scene.add(grp);
    this.list.push(c);
    this.startMove(c, true);
  }

  startMove(c, first = false) {
    const rng = this.rng;
    switch (c.kind) {
      case 'beetle': c.state = 'go'; c.speed = rng.range(0.45, 0.7); c.timer = rng.range(0.4, 0.9); c.turn = rng.range(-3, 3); break;
      case 'millipede': c.state = 'go'; c.speed = 0.045; c.timer = rng.range(2, 5); c.turn = rng.range(-0.8, 0.8); break;
      case 'salamander': c.state = first ? 'pause' : 'go'; c.speed = 0.07; c.timer = first ? 1.2 : rng.range(1.2, 2.5); c.turn = rng.range(-0.6, 0.6); break;
      case 'sculpin': c.state = 'go'; c.speed = rng.range(0.8, 1.3); c.timer = rng.range(0.18, 0.32); c.turn = 0; c.heading += rng.range(-1.2, 1.2); c.darts++; break;
      case 'stonefly': c.state = 'go'; c.speed = 0.035; c.timer = rng.range(1, 3); c.turn = rng.range(-1, 1); break;
      case 'caddis': c.state = 'go'; c.speed = 0.008; c.timer = rng.range(3, 6); c.turn = rng.range(-0.3, 0.3); break;
      default: break;
    }
  }

  pickables() {
    return this.list.filter((c) => c.state !== 'hide').map((c) => {
      c.pick.x = c.x; c.pick.y = c.y + 0.04; c.pick.z = c.z;
      return c.pick;
    });
  }

  scare(x, z, r) {
    for (const c of this.list) {
      if (Math.hypot(c.x - x, c.z - z) > r || c.state === 'hide') continue;
      if (c.kind === 'beetle' || c.kind === 'sculpin') { c.heading = Math.atan2(c.x - x, c.z - z); this.startMove(c); }
    }
  }

  poke(c) {
    const a = this.ctx.audio;
    if (c.kind === 'millipede') { c.state = 'curl'; c.timer = 4.5; c.curl = 0; a && a.play('tick', { x: c.x, y: c.y, z: c.z, gain: 0.25 }); return; }
    if (c.kind === 'salamander') { c.state = 'pause'; c.timer = 1.6; c.heading += Math.PI * 0.6; return; }
    if (c.kind === 'caddis') { c.state = 'pause'; c.timer = 4; return; }
    c.heading += Math.PI + this.rng.range(-0.6, 0.6);
    this.startMove(c);
  }

  surfaceY(c) {
    const g = groundAt(c.x, c.z);
    return g + (c.wet ? 0.004 : 0.002);
  }

  update(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.spawn(p); this.pending.splice(i, 1); }
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.t += dt;
      p.m.material.opacity = smoothstep(0, 0.3, p.t) * (1 - smoothstep(p.life * 0.4, p.life, p.t)) * (0.75 - U.uRain.value * 0.3);
      if (p.t > p.life) { this.scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); this.patches.splice(i, 1); }
    }
    const t = U.uTime.value;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      c.age += dt;
      c.timer -= dt;
      if (c.age > c.life && c.state !== 'hide' && c.state !== 'curl') { c.state = 'hide'; c.timer = 0.7; }
      if (c.state === 'go') {
        c.heading += c.turn * dt;
        const nx = c.x + Math.sin(c.heading) * c.speed * dt, nz = c.z + Math.cos(c.heading) * c.speed * dt;
        // land animals keep out of the water, water animals stay in it
        if (isWater(nx, nz) === c.wet && normalAt(nx, nz).y > 0.55) { c.x = nx; c.z = nz; }
        else c.heading += Math.PI * (0.5 + this.rng.next());
        if (c.timer < 0) {
          if (c.kind === 'beetle') this.startMove(c);
          else if (c.kind === 'sculpin') { c.state = 'pause'; c.timer = this.rng.range(0.8, 2.2); if (c.darts >= 4) c.age = c.life; }
          else { c.state = 'pause'; c.timer = this.rng.range(0.5, c.kind === 'caddis' ? 4 : 1.5); }
        }
      } else if (c.state === 'pause') {
        if (c.timer < 0) this.startMove(c);
      } else if (c.state === 'curl') {
        c.curl = Math.min(1, c.curl + dt * 2.5);
        if (c.timer < 0) { c.curl = Math.max(0, c.curl - dt * 4); if (c.curl <= 0) this.startMove(c); }
      } else if (c.state === 'hide') {
        if (c.timer < 0) { this.remove(c); this.list.splice(i, 1); continue; }
      }
      // appear / burrow away
      const target = c.state === 'hide' ? 0 : 1;
      c.scale += (target - c.scale) * Math.min(1, dt * (c.state === 'hide' ? 6 : 10));
      c.y = this.surfaceY(c);
      if (c.kind === 'millipede') this.poseMillipede(c, dt);
      else {
        let yaw = c.heading;
        if (c.kind === 'salamander' && c.state === 'go') yaw += Math.sin(t * 9) * 0.18;
        if (c.kind === 'beetle' && c.state === 'go') c.mesh.position.y = Math.abs(Math.sin(t * 40)) * 0.0015;
        if (c.kind === 'sculpin' && c.state === 'pause') c.mesh.rotation.z = Math.sin(t * 3 + c.x) * 0.02;
        c.grp.position.set(c.x, c.y, c.z);
        c.grp.rotation.set(0, yaw, 0);
        c.grp.scale.setScalar(c.size * Math.max(c.scale, 0.001));
      }
    }
  }

  // body segments follow the head's trail; curled up they coil into a flat spiral
  poseMillipede(c, dt) {
    const S = c.size, L = 0.0105 * S;
    const tr = c.trail;
    if (!tr.length || Math.hypot(tr[0].x - c.x, tr[0].z - c.z) > L * 0.25) tr.unshift({ x: c.x, z: c.z });
    if (tr.length > 200) tr.length = 200;
    let si = 0, acc = 0;
    let px = c.x, pz = c.z;
    for (let k = 0; k < c.segs.length; k++) {
      const m = c.segs[k];
      // walk back along the trail to arc-length k*L
      const want = k * L;
      while (si < tr.length - 1) {
        const a = tr[si], b = tr[si + 1];
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        if (acc + d >= want) { const u = (want - acc) / Math.max(d, 1e-6); px = a.x + (b.x - a.x) * u; pz = a.z + (b.z - a.z) * u; break; }
        acc += d; si++;
      }
      if (si >= tr.length - 1) { px = tr[tr.length - 1].x - Math.sin(c.heading) * (want - acc); pz = tr[tr.length - 1].z - Math.cos(c.heading) * (want - acc); }
      if (c.curl > 0) {
        const ang = c.heading + k * 0.62, rad = (0.006 + k * 0.0016) * S;
        const cxp = c.x + Math.sin(ang) * rad, czp = c.z + Math.cos(ang) * rad;
        const e = c.curl * c.curl * (3 - 2 * c.curl);
        px += (cxp - px) * e; pz += (czp - pz) * e;
      }
      const prev = k === 0 ? null : c.segs[k - 1].position;
      m.position.set(px, groundAt(px, pz) + 0.002, pz);
      if (prev) m.rotation.set(0, Math.atan2(prev.x - px, prev.z - pz), 0); else m.rotation.set(0, c.heading, 0);
      m.scale.setScalar(S * Math.max(c.scale, 0.001));
    }
  }

  remove(c) {
    if (c.segs) for (const m of c.segs) this.scene.remove(m);
    this.scene.remove(c.grp);
  }
}

export { SPECIES as UNDER_SPECIES };
