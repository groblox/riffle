// Trout: rainbow, brown and cutthroat. Hold in the current facing upstream, cruise their pool,
// dart from disturbances and sip insects from the surface.
import * as THREE from 'three';
import { RNG, clamp } from '../noise.js';
import { flowAt, waterLevel, waterDepthAt, isWater, streamCenter, streamHalfW, streamSlope, BOUNDS } from '../world/shape.js';
import { U, commonGLSL, patchMaterial } from '../core/env.js';
import { lerpAngle } from './kit.js';
import { splashFx } from '../fx/particles.js';

function fishGeometry() {
  const pos = [], nor = [], idx = [];
  const R = 22, S = 14;
  for (let i = 0; i <= R; i++) {
    const t = i / R;
    const z = t - 0.5;
    let r = 0.105 * Math.pow(Math.sin(Math.PI * clamp(t * 0.88 + 0.1, 0, 1)), 0.75);
    if (t < 0.14) r = Math.max(r, 0.016);
    const h = r * 1.15, w = r * 0.58;
    for (let s = 0; s <= S; s++) {
      const a = s / S * Math.PI * 2;
      pos.push(Math.cos(a) * w, Math.sin(a) * h, z);
      const n = new THREE.Vector3(Math.cos(a) / Math.max(w, 0.01), Math.sin(a) / Math.max(h, 0.01), 0).normalize();
      nor.push(n.x, n.y, n.z * 0 + (t > 0.9 ? (t - 0.9) * 6 : 0));
    }
  }
  const W = S + 1;
  for (let i = 0; i < R; i++) for (let s = 0; s < S; s++) {
    const a = i * W + s, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // nose cap
  const tip = pos.length / 3; pos.push(0, -0.005, 0.51); nor.push(0, 0, 1);
  for (let s = 0; s < S; s++) idx.push(R * W + s, R * W + s + 1, tip);
  // fins (double sided triangles)
  const fin = (pts) => {
    const b = pos.length / 3;
    for (const p of pts) { pos.push(...p); nor.push(1, 0, 0); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 1);
  };
  fin([[0, 0, -0.44], [0, 0.14, -0.62], [0, 0, -0.55]]);
  fin([[0, 0, -0.44], [0, 0, -0.55], [0, -0.14, -0.62]]);
  fin([[0, 0.1, 0.02], [0, 0.17, -0.06], [0, 0.1, -0.14]]);   // dorsal
  fin([[0, -0.08, -0.12], [0, -0.13, -0.2], [0, -0.06, -0.24]]); // anal
  fin([[0.03, -0.06, 0.24], [0.11, -0.1, 0.16], [0.03, -0.07, 0.14]]); // pectoral
  fin([[-0.03, -0.06, 0.24], [-0.11, -0.1, 0.16], [-0.03, -0.07, 0.14]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function fishMaterial(species) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.1, side: THREE.DoubleSide });
  const uniforms = { uAmp: { value: 0.05 }, uFreq: { value: 9 }, uPhase: { value: Math.random() * 10 }, uSpecies: { value: species } };
  patchMaterial(mat, {
    uniforms,
    vertexHead: `${commonGLSL}\nuniform float uAmp, uFreq, uPhase; varying vec3 vObj;`,
    fragmentHead: `${commonGLSL}\nuniform float uSpecies; varying vec3 vObj;`,
    vertex: {
      begin_vertex: `$
        float ft = clamp(position.z + 0.5, 0.0, 1.0);
        float sw = sin(ft * 6.5 - uPhase);
        transformed.x += sw * uAmp * pow(1.0 - ft, 1.5);
        transformed.x += sin(uPhase * 0.5) * uAmp * 0.15;
        vObj = position;`,
    },
    fragment: {
      map_fragment: /* glsl */`
        vec3 o = vObj;
        float t = o.z + 0.5;
        float up = clamp(o.y / 0.12, -1.0, 1.0);
        float spots = smoothstep(0.62, 0.7, texture2D(uNoise, o.zy * vec2(2.2, 3.0) + o.x * 0.5 + uSpecies).a + texture2D(uNoise, o.zy * 5.0).b * 0.2);
        vec3 back, side, belly, stripe; float stripeW;
        if (uSpecies < 0.5) {          // rainbow
          back = vec3(0.12, 0.15, 0.08); side = vec3(0.6, 0.6, 0.55); belly = vec3(0.85, 0.85, 0.8);
          stripe = vec3(0.8, 0.28, 0.35); stripeW = 0.75;
        } else if (uSpecies < 1.5) {   // brown
          back = vec3(0.2, 0.14, 0.05); side = vec3(0.55, 0.4, 0.16); belly = vec3(0.8, 0.7, 0.4);
          stripe = vec3(0.6, 0.38, 0.12); stripeW = 0.2;
        } else {                        // cutthroat
          back = vec3(0.16, 0.16, 0.06); side = vec3(0.6, 0.52, 0.3); belly = vec3(0.85, 0.75, 0.6);
          stripe = vec3(0.75, 0.4, 0.3); stripeW = 0.4;
        }
        vec3 col = mix(belly, side, smoothstep(-0.75, -0.15, up));
        col = mix(col, back, smoothstep(0.05, 0.65, up));
        col = mix(col, stripe, exp(-pow(up * 3.2, 2.0)) * stripeW * smoothstep(0.08, 0.3, t));
        float spotZone = uSpecies > 1.5 ? smoothstep(0.7, 0.2, t) : 1.0;
        col = mix(col, vec3(0.04, 0.03, 0.02), spots * smoothstep(-0.3, 0.3, up) * spotZone * 0.85);
        if (uSpecies > 0.5 && uSpecies < 1.5) {
          float red = smoothstep(0.7, 0.76, texture2D(uNoise, o.zy * 3.7 + 0.5).a);
          col = mix(col, vec3(0.75, 0.15, 0.08), red * smoothstep(0.4, -0.2, abs(up)) * 0.9);
        }
        if (uSpecies > 1.5) { // throat slash
          col = mix(col, vec3(0.9, 0.25, 0.1), smoothstep(0.85, 0.92, t) * smoothstep(-0.3, -0.75, up));
        }
        diffuseColor.rgb = col;
      `,
    },
  }, 'fish');
  mat.userData.u = uniforms;
  return mat;
}

const SPECIES = [
  { id: 'rainbow', label: 'Rainbow Trout' },
  { id: 'brown', label: 'Brown Trout' },
  { id: 'cutthroat', label: 'Cutthroat Trout' },
];

export class Fishes {
  constructor(scene, ctx, count = 24) {
    this.ctx = ctx;
    this.rng = new RNG(808);
    this.list = [];
    const geo = fishGeometry();
    const rng = this.rng;
    let tries = 0;
    while (this.list.length < count && tries++ < 5000) {
      // favour pools
      const zr = rng.next();
      const z = zr < 0.35 ? rng.range(-34, -20) : zr < 0.6 ? rng.range(55, 82) : rng.range(-BOUNDS, BOUNDS);
      const hw = streamHalfW(z);
      const lat = rng.range(-0.6, 0.6) * hw;
      const x = streamCenter(z) + lat * Math.sqrt(1 + streamSlope(z) ** 2);
      if (waterDepthAt(x, z) < 0.5) continue;
      const sp = rng.chance(0.15) ? 2 : rng.chance(0.4) ? 1 : 0;
      const mat = fishMaterial(sp);
      const mesh = new THREE.Mesh(geo, mat);
      const L = rng.range(0.26, 0.48) * (sp === 1 ? 1.15 : 1);
      mesh.scale.setScalar(L);
      mesh.castShadow = false; mesh.receiveShadow = true;
      scene.add(mesh);
      const f = {
        mesh, mat, x, z, y: waterLevel(z) - 0.3, home: { x, z }, heading: Math.PI, swim: 0, state: 'hold', timer: rng.range(1, 5),
        target: { x, z }, len: L, species: sp, vy: 0, pitch: 0, nextRise: rng.range(8, 40), nextJump: rng.range(100, 400), flee: 0,
        pick: { r: Math.max(0.35, L), label: SPECIES[sp].label, guide: SPECIES[sp].id, kind: 'fish' },
      };
      f.pick.obj = f;
      this.list.push(f);
    }
    this.flow = { x: 0, z: 0 };
  }

  scare(x, z, r) {
    for (const f of this.list) {
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < r && f.state !== 'jump') {
        f.state = 'flee'; f.timer = 0.8 + Math.random() * 0.8;
        f.fleeDir = Math.atan2(f.x - x, f.z - z) + (Math.random() - 0.5) * 0.8;
      }
    }
  }

  pickables() { return this.list.map((f) => { f.pick.x = f.x; f.pick.y = f.y; f.pick.z = f.z; return f.pick; }); }

  update(dt) {
    const { water, parts, audio } = this.ctx;
    const rng = this.rng;
    for (const f of this.list) {
      const fl = flowAt(f.x, f.z, this.flow);
      const flowSp = Math.hypot(fl.x, fl.z);
      const wl = waterLevel(f.z);
      const depth = waterDepthAt(f.x, f.z);
      let desired = f.heading, swimT = 0, amp = 0.05, freq = 9;
      f.timer -= dt;
      f.nextRise -= dt; f.nextJump -= dt;
      if (f.state === 'hold' || f.state === 'cruise') {
        const dx = f.target.x - f.x, dz = f.target.z - f.z;
        const dist = Math.hypot(dx, dz);
        const upstream = Math.atan2(-fl.x, -fl.z - 1e-4);
        if (dist > 0.8) { desired = Math.atan2(dx, dz); swimT = 0.5 + flowSp * 0.3; amp = 0.07; freq = 11; }
        else { desired = flowSp > 0.08 ? upstream : f.heading + Math.sin(f.timer) * 0.3; swimT = flowSp * 0.98; amp = 0.04 + flowSp * 0.03; }
        if (f.timer < 0) {
          f.timer = rng.range(2, 8);
          for (let k = 0; k < 8; k++) {
            const tx = f.home.x + rng.range(-4, 4), tz = f.home.z + rng.range(-5, 5);
            if (waterDepthAt(tx, tz) > 0.45) { f.target.x = tx; f.target.z = tz; break; }
          }
        }
        if (f.nextRise < 0 && depth > 0.3) { f.state = 'rise'; f.nextRise = rng.range(15, 50); }
      } else if (f.state === 'flee') {
        desired = f.fleeDir; swimT = 2.8; amp = 0.11; freq = 20;
        if (f.timer < 0) { f.state = 'hold'; f.timer = 2; f.target.x = f.x; f.target.z = f.z; }
      } else if (f.state === 'rise') {
        swimT = flowSp; amp = 0.05;
        const ty = wl - 0.05;
        f.y += (ty - f.y) * Math.min(1, dt * 3);
        if (f.y > wl - 0.09) {
          water.disturb(f.x + Math.sin(f.heading) * f.len * 0.4, f.z + Math.cos(f.heading) * f.len * 0.4, 0.25, 0.025);
          audio && audio.play('sip', { x: f.x, y: wl, z: f.z, gain: 0.5 });
          f.state = 'hold'; f.timer = 1.5;
        }
      } else if (f.state === 'jumpPrep') {
        swimT = 1.8; amp = 0.1; freq = 18;
        f.y += (wl - 0.25 - f.y) * Math.min(1, dt * 4);
        if (f.timer < 0) {
          f.state = 'jump'; f.vy = 3.4 + rng.range(0, 1.2); f.jumpSp = 1.4;
          splashFx(parts, f.x, wl, f.z, 0.5);
          water.disturb(f.x, f.z, 0.45, 0.06);
          audio && audio.play('splash', { x: f.x, y: wl, z: f.z, gain: 0.6, size: 0.5 });
          this.ctx.onEvent && this.ctx.onEvent('fishjump', f);
        }
      }
      if (f.state === 'jump') {
        f.vy -= 9.8 * dt;
        f.y += f.vy * dt;
        f.x += Math.sin(f.heading) * f.jumpSp * dt; f.z += Math.cos(f.heading) * f.jumpSp * dt;
        f.pitch = Math.atan2(f.vy, f.jumpSp);
        amp = 0.13; freq = 22;
        if (f.vy < 0 && f.y < wl) {
          f.state = 'flee'; f.timer = 0.6; f.fleeDir = f.heading; f.pitch = 0;
          splashFx(parts, f.x, wl, f.z, 0.9);
          water.disturb(f.x, f.z, 0.6, 0.1);
          audio && audio.play('splash', { x: f.x, y: wl, z: f.z, gain: 0.9, size: 0.8 });
        }
      } else {
        // steer
        f.heading = lerpAngle(f.heading, desired, Math.min(1, dt * (f.state === 'flee' ? 6 : 2.2)));
        f.swim += (swimT - f.swim) * Math.min(1, dt * 3);
        const fx = Math.sin(f.heading), fz = Math.cos(f.heading);
        // avoid shallows ahead
        const ax = f.x + fx * 0.8, az = f.z + fz * 0.8;
        if (waterDepthAt(ax, az) < 0.3) { f.heading += dt * 3.5 * (f.species % 2 ? 1 : -1); if (f.state === 'flee') f.fleeDir += 0.4; }
        const nx = f.x + (fx * f.swim + fl.x) * dt, nz = f.z + (fz * f.swim + fl.z) * dt;
        if (waterDepthAt(nx, nz) > 0.22) { f.x = nx; f.z = nz; }
        else { f.x -= fl.x * dt * 0.2; }
        if (f.state !== 'rise' && f.state !== 'jumpPrep') {
          const ty = waterLevel(f.z) - clamp(depth * 0.55, 0.16, 1.1) + Math.sin(U.uTime.value * 0.7 + f.home.x) * 0.03;
          f.y += (ty - f.y) * Math.min(1, dt * 1.5);
        }
        f.pitch *= Math.exp(-dt * 4);
      }
      f.mat.userData.u.uAmp.value += (amp - f.mat.userData.u.uAmp.value) * Math.min(1, dt * 4);
      f.mat.userData.u.uFreq.value = freq;
      f.mat.userData.u.uPhase.value += freq * dt;
      f.mesh.position.set(f.x, f.y, f.z);
      f.mesh.rotation.set(-f.pitch, f.heading, 0, 'YXZ');
    }
  }
}
