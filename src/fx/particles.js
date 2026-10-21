// CPU particle system rendered as soft point sprites (overlay pass, after water).
import * as THREE from 'three';
import { U } from '../core/env.js';
import { waterLevel, groundAt, isWater } from '../world/shape.js';

const vert = /* glsl */`
attribute vec4 aColor;
attribute vec2 aSize;   // size (m), shape
varying vec4 vColor;
varying float vShape;
uniform float uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize.x * uScale / max(-mv.z, 0.1), 0.0, 256.0);
  // keep sub-pixel particles visible but fainter
  float px = aSize.x * uScale / max(-mv.z, 0.1);
  vColor = aColor;
  vColor.a *= clamp(px / 1.5, 0.15, 1.0);
  vShape = aSize.y;
}`;

const frag = /* glsl */`
varying vec4 vColor;
varying float vShape;
uniform vec3 uLight;
uniform float uLit;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a;
  if (vShape < 0.5) {            // soft round
    a = smoothstep(1.0, 0.2, length(p));
  } else if (vShape < 1.5) {     // streak (rain)
    a = smoothstep(0.12, 0.0, abs(p.x)) * smoothstep(1.0, 0.6, abs(p.y));
  } else if (vShape < 2.5) {     // sparkle
    float d = length(p);
    a = smoothstep(1.0, 0.0, d) * 0.35 + smoothstep(0.12, 0.0, abs(p.x)) * smoothstep(1.0, 0.0, abs(p.y)) + smoothstep(0.12, 0.0, abs(p.y)) * smoothstep(1.0, 0.0, abs(p.x));
    a = clamp(a, 0.0, 1.0);
  } else if (vShape < 3.5) {     // mist: very soft
    float d = length(p);
    a = exp(-d * d * 3.0) * smoothstep(1.0, 0.7, d);
  } else {                        // snowflake / droplet with highlight
    float d = length(p);
    a = smoothstep(1.0, 0.6, d);
  }
  vec3 c = vColor.rgb * mix(vec3(1.0), uLight, uLit);
  gl_FragColor = vec4(c, vColor.a * a);
  if (gl_FragColor.a < 0.003) discard;
}`;

export class Particles {
  constructor(max = 6000, additive = false, lit = true) {
    this.max = max;
    this.n = 0;
    this.p = []; // particle objects pool
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.uniforms = { uScale: { value: 600 }, uLight: { value: new THREE.Vector3(1, 1, 1) }, uLit: { value: lit ? 1 : 0 } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
    this.water = null;
    this.onSplash = null;
  }

  spawn(o) {
    if (this.p.length >= this.max) return null;
    const q = {
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life || 1, age: 0, size: o.size || 0.05, size1: o.size1 ?? o.size ?? 0.05,
      r: o.color ? o.color[0] : 1, g: o.color ? o.color[1] : 1, b: o.color ? o.color[2] : 1, a: o.color ? o.color[3] ?? 1 : 1,
      grav: o.gravity ?? 9.8, drag: o.drag ?? 0.2, shape: o.shape || 0, water: o.water || 'none',
      fadeIn: o.fadeIn || 0.05, flicker: o.flicker || 0, wander: o.wander || 0, seed: Math.random() * 100,
      update: o.update || null,
    };
    this.p.push(q);
    return q;
  }

  update(dt, camera, height) {
    this.uniforms.uScale.value = height * camera.projectionMatrix.elements[5] * 0.5;
    const t = U.uTime.value;
    let w = 0;
    const arr = this.p;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.age += dt;
      if (q.age >= q.life) continue;
      if (q.update) { if (q.update(q, dt, t) === false) continue; }
      else {
        q.vy -= q.grav * dt;
        const d = Math.exp(-q.drag * dt);
        q.vx *= d; q.vy *= d; q.vz *= d;
        if (q.wander) {
          q.vx += Math.sin(t * 1.3 + q.seed) * q.wander * dt;
          q.vz += Math.cos(t * 1.1 + q.seed * 1.7) * q.wander * dt;
          q.vy += Math.sin(t * 0.9 + q.seed * 2.3) * q.wander * 0.5 * dt;
        }
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        if (q.water !== 'none' && q.vy < 0) {
          const wl = waterLevel(q.z);
          if (q.y < wl && isWater(q.x, q.z)) {
            if (q.water === 'ripple' && this.water) this.water.disturb(q.x, q.z, 0.25, 0.012 * Math.min(1, q.size * 20));
            if (q.water === 'ripple' || q.water === 'die') { q.age = q.life; continue; }
          }
          const g = groundAt(q.x, q.z);
          if (q.y < g) { q.age = q.life; continue; }
        }
      }
      arr[w++] = q;
    }
    arr.length = w;
    const n = Math.min(w, this.max);
    for (let i = 0; i < n; i++) {
      const q = arr[i];
      const k = q.age / q.life;
      const fade = Math.min(1, q.age / q.fadeIn) * (1 - Math.pow(k, 2.0));
      const fl = q.flicker ? (0.5 + 0.5 * Math.sin(t * q.flicker + q.seed * 10)) : 1;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.col[i * 4] = q.r; this.col[i * 4 + 1] = q.g; this.col[i * 4 + 2] = q.b; this.col[i * 4 + 3] = q.a * fade * fl;
      this.size[i * 2] = q.size + (q.size1 - q.size) * k; this.size[i * 2 + 1] = q.shape;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

// ---- helpers for common effects ----
export function splashFx(parts, x, y, z, strength = 1) {
  const n = Math.round(14 + strength * 40);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = (0.6 + Math.random() * 1.8) * Math.sqrt(strength);
    parts.spawn({
      x: x + Math.cos(a) * 0.1, y: y + 0.02, z: z + Math.sin(a) * 0.1,
      vx: Math.cos(a) * s * 0.7, vy: (1.8 + Math.random() * 2.6) * Math.sqrt(strength), vz: Math.sin(a) * s * 0.7,
      life: 1.6, size: 0.03 + Math.random() * 0.04, color: [0.85, 0.95, 1.0, 0.9], drag: 0.6, shape: 4, water: 'ripple',
    });
  }
  // crown of mist
  for (let i = 0; i < 6 * strength + 2; i++) {
    const a = Math.random() * Math.PI * 2;
    parts.spawn({
      x: x + Math.cos(a) * 0.2, y: y + 0.1, z: z + Math.sin(a) * 0.2, vx: Math.cos(a) * 0.4, vy: 0.5 + Math.random() * 0.5, vz: Math.sin(a) * 0.4,
      life: 1.2, size: 0.3, size1: 0.9 * strength + 0.3, color: [0.9, 0.95, 1, 0.22], gravity: 0, drag: 2, shape: 3,
    });
  }
}

export function dustFx(parts, x, y, z, color = [0.6, 0.5, 0.38]) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    parts.spawn({ x, y: y + 0.05, z, vx: Math.cos(a) * 0.6, vy: 0.3 + Math.random() * 0.5, vz: Math.sin(a) * 0.6, life: 1.4, size: 0.15, size1: 0.6, color: [...color, 0.35], gravity: -0.1, drag: 2.5, shape: 3 });
  }
}
