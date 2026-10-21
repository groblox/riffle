// Falling, drifting, floating leaves. Fall from shaken trees, drift on wind,
// land on the stream and ride the current (over the waterfall, around rocks).
import * as THREE from 'three';
import { U, commonGLSL, patchMaterial } from '../core/env.js';
import { canvasTexture } from '../gfx/textures.js';
import { waterLevel, groundAt, isWater, flowAt } from '../world/shape.js';

function leafTexture() {
  return canvasTexture(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.translate(32, 60);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(26, -4, 22, -44, 0, -54);
    g.bezierCurveTo(-22, -44, -26, -4, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(150,150,150,1)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 4); g.lineTo(0, -48); g.stroke();
    g.lineWidth = 1;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, -i * 10); g.lineTo(12, -i * 10 - 8); g.moveTo(0, -i * 10); g.lineTo(-12, -i * 10 - 8); g.stroke(); }
  });
}

export class Leaves {
  constructor(scene, water, max = 600) {
    this.max = max;
    this.water = water;
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.0, 0);
    const mat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
    patchMaterial(mat, {
      fragmentHead: commonGLSL,
      fragment: {
        normal_fragment_maps: `normal = normalize(vNormal);`,
        lights_physical_pars_fragment: /* glsl */`$
          void RE_Direct_Leaf2( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
            RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
            reflectedLight.directDiffuse += material.diffuseColor * directLight.color * abs(dot(geometryNormal, directLight.direction)) * 0.25;
          }
          #undef RE_Direct
          #define RE_Direct RE_Direct_Leaf2
        `,
      },
    }, 'leafp');
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.flow = { x: 0, z: 0 };
  }

  spawn(x, y, z, color, opts = {}) {
    if (this.items.length >= this.max) this.items.shift();
    const c = color || this.randomColor();
    this.items.push({
      x, y, z, vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0,
      rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      sx: (Math.random() - 0.5) * 6, sy: (Math.random() - 0.5) * 4, sz: (Math.random() - 0.5) * 6,
      mode: opts.mode || 'fall', age: 0, life: opts.life || 90 + Math.random() * 60, size: opts.size || (0.07 + Math.random() * 0.04),
      c, seed: Math.random() * 100, boat: !!opts.boat,
    });
  }

  randomColor() {
    const s = U.uSeason.value;
    const r = Math.random();
    if (s < 0.5) return [0.25 + r * 0.1, 0.38 + r * 0.1, 0.08];
    return r < 0.55 ? [0.95, 0.68, 0.08] : r < 0.85 ? [0.92, 0.45, 0.05] : [0.7, 0.2, 0.05];
  }

  update(dt) {
    const t = U.uTime.value;
    const wind = U.uWind.value;
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const L = items[i];
      L.age += dt;
      if (L.age > L.life) { items.splice(i, 1); continue; }
      if (L.mode === 'fall') {
        // flutter: drag-dominated with oscillation
        L.vy += (-1.1 - L.vy) * Math.min(1, dt * 2.5);
        const sw = Math.sin(t * 3.1 + L.seed) * 0.9;
        L.vx += ((wind.x * wind.z * 2.2) + sw * Math.cos(L.seed) - L.vx) * Math.min(1, dt * 1.5);
        L.vz += ((wind.y * wind.z * 2.2) + sw * Math.sin(L.seed) - L.vz) * Math.min(1, dt * 1.5);
        L.x += L.vx * dt; L.y += L.vy * dt; L.z += L.vz * dt;
        L.rx += L.sx * dt; L.ry += L.sy * dt; L.rz += L.sz * dt;
        const wl = waterLevel(L.z);
        if (isWater(L.x, L.z, 0.02) && L.y <= wl + 0.01) {
          L.mode = 'water'; L.y = wl; L.rx = -Math.PI / 2 + (Math.random() - 0.5) * 0.3; L.rz = 0;
          this.water.disturb(L.x, L.z, 0.2, 0.006);
          L.life = Math.max(L.life, L.age + 120);
        } else {
          const g = groundAt(L.x, L.z);
          if (L.y <= g + 0.02) { L.mode = 'ground'; L.y = g + 0.02; L.rx = -Math.PI / 2 + (Math.random() - 0.5) * 0.5; L.rz = 0; L.life = Math.min(L.life, L.age + 30 + Math.random() * 30); }
        }
      } else if (L.mode === 'water') {
        const f = flowAt(L.x, L.z, this.flow);
        const k = L.boat ? 0.85 : 0.95;
        L.vx += (f.x * k - L.vx) * Math.min(1, dt * 1.6) + Math.sin(t * 0.7 + L.seed) * 0.05 * dt;
        L.vz += (f.z * k - L.vz) * Math.min(1, dt * 1.6);
        L.x += L.vx * dt; L.z += L.vz * dt;
        const sp = Math.hypot(L.vx, L.vz);
        L.ry += (Math.sin(t * 0.5 + L.seed) * 0.6 + sp * 0.4) * dt;
        const wl = waterLevel(L.z);
        L.y = wl + 0.012 + Math.sin(t * 2 + L.seed) * 0.004;
        if (!isWater(L.x, L.z, 0.0)) { // pushed ashore: nudge back to centre
          L.vx *= -0.3; L.vz *= 0.5;
          const g = groundAt(L.x, L.z);
          if (g > wl + 0.05) { L.mode = 'ground'; L.y = g + 0.02; L.life = L.age + 20; }
        }
        if (Math.random() < dt * 0.3) this.water.disturb(L.x, L.z, 0.15, 0.002);
      }
    }
    // write instances
    const n = Math.min(items.length, this.max);
    for (let i = 0; i < n; i++) {
      const L = items[i];
      this.e.set(L.rx, L.ry, L.rz, L.mode === 'fall' ? 'XYZ' : 'YXZ');
      if (L.mode !== 'fall') this.e.set(-Math.PI / 2, L.ry, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      const fade = Math.min(1, (L.life - L.age) / 3);
      const sc = L.size * (L.boat ? 3.5 : 1) * fade;
      this.s.set(sc, sc, sc);
      this.p.set(L.x, L.y, L.z);
      this.m4.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.instanceColor.setXYZ(i, L.c[0], L.c[1], L.c[2]);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
