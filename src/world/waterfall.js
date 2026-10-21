// The falls: water squeezes off a granite boulder step in chutes through the gaps between the lip rocks
// (one main jet through the cleft, plus thin strands that cling to the rock instead of springing free).
// Each chute is its own sheet, thrown out along a ballistic arc from the brink and UV-mapped
// along the fall, so it can go from a glassy tongue at the lip to white, roped, ragged water
// that breaks apart before it punches into the pool. Chutes are found from whatever rocks sit
// on the lip, so moving a stone there re-shapes the falls.
import * as THREE from 'three';
import { WF_Z, WF_LEN, WF_DROP, streamCenter, streamHalfW, streamSlope, waterLevel, groundAt } from './shape.js';
import { rockWaterRadius } from './rocks.js';
import { fogGLSL } from '../core/env.js';
import { RNG, clamp, smoothstep } from '../noise.js';
import { SIM } from './water.js';

const G = 9.8;

const chuteVert = /* glsl */`
attribute vec4 aCh;     // seed, chute width, distance to the chute's edge (m), fall fraction
attribute vec3 aTan;    // across the chute
attribute float aLayer; // 0 outer skin, 1 inner core of the jet
varying float vLayer;
varying vec2 vUv;       // u across, s = metres along the arc from the brink
varying vec4 vCh;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec3 vTan;
void main(){
  vUv = uv; vCh = aCh; vTan = aTan; vLayer = aLayer;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorldPos = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const chuteFrag = /* glsl */`
uniform sampler2D tScene;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSkyAmb;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform sampler2D uNoise;
uniform float uNight;
uniform float uSnow;
uniform float uPoolY;
${fogGLSL}
varying float vLayer;
varying vec2 vUv;
varying vec4 vCh;
varying vec3 vWorldPos;
varying vec3 vN;
varying vec3 vTan;

vec3 skyCol(vec3 R){
  float h = max(R.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.42));
  float cs = max(dot(R, uSunDir), 0.0);
  c += uSunColor * (pow(cs, 10.0) * 0.35 + pow(cs, 120.0) * 1.0) * (1.0 - uNight);
  return c;
}
float ropes(float X, float s){
  return texture2D(uNoise, vec2(X * 0.45, (s - uTime * 2.0) * 0.09)).b * 0.5
       + texture2D(uNoise, vec2(X * 1.15 + 0.31, (s - uTime * 2.6) * 0.2)).g * 0.32
       + texture2D(uNoise, vec2(X * 2.9 + 0.71, (s - uTime * 3.1) * 0.42)).b * 0.18;
}

void main(){
  float seed = vCh.x + vLayer * 3.17, W = vCh.y, edge = vCh.z, fall = vCh.w;
  float core = vLayer;
  float thin = 1.0 - smoothstep(0.3, 0.7, W); // a low-flow strand: glassy, beaded, hugging the rock
  float s = vUv.y;
  float X = vUv.x * W + seed * 7.13;
  vec3 wp = vWorldPos;

  // ---- aeration: ropes of white water that thicken as the jet falls, with surges running down ----
  float streak = ropes(X, s);
  float pulse = texture2D(uNoise, vec2(seed * 0.37 + X * 0.05, (s - uTime * 2.3) * 0.13)).r;
  float edgeK = 1.0 - smoothstep(0.0, 0.22, edge);
  float cov = mix(0.06, 0.94, pow(fall, 0.8)) + edgeK * 0.5 * smoothstep(-0.05, 0.12, s) + (pulse - 0.5) * 0.4 * smoothstep(0.05, 0.3, fall);
  cov += smoothstep(0.72, 1.0, fall) * 0.5; // fully aerated by the time it hits the pool
  cov += core * (0.18 + 0.2 * fall);         // the inner core is mostly white water
  cov *= 1.0 - thin * 0.55;
  float white = smoothstep(1.0 - cov, 1.0 - cov + 0.2, streak);

  // ---- normal: rope cross-sections across the sheet ----
  float e = 0.025;
  float dX = (ropes(X + e, s) - streak) / e;
  vec3 N = normalize(vN);
  N = gl_FrontFacing ? N : -N;
  N = normalize(N - vTan * dX * 0.085);
  vec3 V = normalize(cameraPosition - wp);
  float NdV = abs(dot(N, V));
  float F = clamp(0.02 + 0.98 * pow(1.0 - NdV, 5.0), 0.0, 0.9);

  float shadow = 1.0;
  if (uShadowOn > 0.5) {
    vec4 sc = uShadowMatrix * vec4(wp, 1.0);
    sc.xyz /= sc.w;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) shadow = texture(tShadow, vec3(sc.xy, sc.z - 0.001));
  }
  float sunVis = shadow * smoothstep(-0.02, 0.06, uSunDir.y);
  vec3 L = normalize(uSunDir);

  // ---- glassy water: what's behind, tinted, plus the sky ----
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec2 ruv = clamp(suv + (N.xy * 0.04 + vec2(dX * 0.016, (streak - 0.5) * 0.04)) * (1.0 - white), vec2(0.001), vec2(0.999));
  vec3 refr = texture2D(tScene, ruv).rgb;
  // a sheet a few centimetres thick: the view through it is dimmed, green, and milky with bubbles
  float milk = smoothstep(0.02, 0.5, fall) * 0.45 + edgeK * 0.2;
  vec3 glass = refr * vec3(0.55, 0.74, 0.68) + vec3(0.03, 0.1, 0.085) * uSkyAmb;
  glass = mix(glass, vec3(0.75, 0.86, 0.85) * (uSkyAmb * 0.8 + uSunColor * uSunIntensity * 0.06 * sunVis), milk * 0.6);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  glass = mix(glass, skyCol(R), F);
  vec3 H = normalize(L + V);
  glass += uSunColor * uSunIntensity * (pow(max(dot(N, H), 0.0), 320.0) * 3.0) * sunVis * (0.3 + F);
  // the bending tongue at the brink catches the sky in a bright rolling line
  float rim = exp(-pow((s - 0.05 - (pulse - 0.5) * 0.06) / 0.07, 2.0)) * (1.0 - white) * (0.4 + 0.6 * texture2D(uNoise, vec2(X * 0.3, uTime * 0.05)).g);
  glass += skyCol(vec3(0.0, 0.6, 0.8)) * 0.25 * rim;

  // ---- white water: lit foam, glowing when the sun is behind it ----
  vec3 foamLight = uSunColor * uSunIntensity * (0.35 + 0.65 * max(dot(N, L), 0.0)) * sunVis * 0.32 + uSkyAmb * 1.05;
  foamLight += uSunColor * uSunIntensity * pow(max(dot(-V, L), 0.0), 4.0) * sunVis * 0.18;
  // rope crests catch the light, the valleys between them and the inner core sit in shade
  vec3 foamCol = vec3(0.92, 0.95, 0.96) * foamLight * (0.72 + 0.32 * streak) * mix(1.0, 0.72, core);
  // the jet's underside, where it curls toward the rock, is darker
  foamCol *= 1.0 - 0.18 * smoothstep(0.2, 0.0, s) * smoothstep(-0.2, 0.0, s);
  vec3 col = mix(glass, foamCol, white * 0.95);
  col = applyFog(col, cameraPosition, wp, uSunDir);

  // ---- coverage: fades in over the lip, ragged edges, breaking into ropes and drops lower down ----
  float a0 = smoothstep(-0.34, -0.12, s);
  float rag = texture2D(uNoise, vec2(X * 1.7, (s - uTime * 2.4) * 0.3)).r;
  // ragged sides: thin edge water tears into strands, more so as it falls
  float rag2 = texture2D(uNoise, vec2(X * 4.1 + 0.4, (s - uTime * 2.8) * 0.7)).g;
  float cut = smoothstep(0.0, 0.04, edge - (rag - 0.35) * (0.06 + fall * 0.34) - (rag2 - 0.5) * 0.04);
  float holes = smoothstep(0.3, 0.44, streak + 0.35 * (1.0 - fall));
  float breakup = mix(1.0, holes, smoothstep(0.35, 0.9, fall) * 0.85);
  float glassA = mix(0.5, 0.86, smoothstep(0.0, 0.25, edge)) + F * 0.3;
  float alpha = a0 * cut * breakup * mix(glassA, 1.0, white);
  // thin strands run as beads and fingers of water rather than a sheet
  float bead = texture2D(uNoise, vec2(X * 0.9 + 0.13, (s - uTime * 1.6) * 0.55)).g;
  alpha *= mix(1.0, smoothstep(0.28, 0.5, bead + 0.3 * (1.0 - fall)), thin * 0.8);
  alpha *= 1.0 - smoothstep(0.86, 1.0, fall) * (0.35 + 0.65 * rag);
  // dissolve into the churn instead of slicing off at the pool surface
  alpha *= smoothstep(0.0, 0.1 + rag * 0.16, wp.y - uPoolY);
  alpha *= mix(1.0, 0.85, core);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}`;

// the brink isn't a ruler line: the same per-lateral wobble the water ribbon uses
export const brinkWobble = (lat) => 0.14 * Math.sin(lat * 2.1 + 0.7) + 0.07 * Math.sin(lat * 4.7 + 1.9) + 0.03 * Math.sin(lat * 9.3);

export class Waterfall {
  constructor(water, rocks) {
    this.water = water;
    this.rocks = rocks;
    const wu = water.uniforms;
    this.uniforms = {
      tScene: wu.tScene, tShadow: wu.tShadow, uShadowMatrix: wu.uShadowMatrix, uShadowOn: wu.uShadowOn,
      uResolution: wu.uResolution, uTime: wu.uTime, uSunDir: wu.uSunDir, uSunColor: wu.uSunColor, uSunIntensity: wu.uSunIntensity,
      uSkyAmb: wu.uSkyAmb, uZenith: wu.uZenith, uHorizon: wu.uHorizon, uNoise: wu.uNoise, uNight: wu.uNight, uSnow: wu.uSnow,
      uFogColor: wu.uFogColor, uFogSunColor: wu.uFogSunColor, uFogDensity: wu.uFogDensity, uFogHeight: wu.uFogHeight,
      uPoolY: { value: waterLevel(WF_Z + WF_LEN + 0.5) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: chuteVert, fragmentShader: chuteFrag, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    // lateral coverage of falling water, for the ribbon's plunge foam
    this.covData = new Uint8Array(256 * 4);
    this.covTex = new THREE.DataTexture(this.covData, 256, 1, THREE.RGBAFormat);
    this.covTex.magFilter = this.covTex.minFilter = THREE.LinearFilter;
    wu.tChuteCov.value = this.covTex;
    this.rebuild();
  }

  // open stretches of the lip between emergent rocks and the banks
  findChutes() {
    const z = WF_Z - 0.05, hw = streamHalfW(WF_Z), wl = waterLevel(z), k = Math.sqrt(1 + streamSlope(z) ** 2), c = streamCenter(z);
    const N = 700, dl = (2 * hw) / N;
    const open = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const lat = -hw + (i + 0.5) * dl;
      open[i] = Math.abs(lat) / hw < 0.92 && groundAt(c + lat * k, z) < wl - 0.03 ? 1 : 0;
    }
    for (const rk of this.rocks) {
      if (!rk.stream || rk.moving || Math.abs(rk.z - WF_Z) > 2) continue;
      const R = rockWaterRadius(rk);
      if (R <= 0) continue;
      // rocks just upstream of the brink split the flow as surely as rocks right on it
      const dz = Math.max(0, Math.abs(rk.z - (WF_Z - 0.35)) - 0.35);
      if (dz >= R) continue;
      const half = Math.sqrt(R * R - dz * dz) * 0.9;
      const lat = (rk.x - streamCenter(rk.z)) / Math.sqrt(1 + streamSlope(rk.z) ** 2);
      for (let i = Math.max(0, Math.floor((lat - half + hw) / dl)); i <= Math.min(N - 1, Math.ceil((lat + half + hw) / dl)); i++) open[i] = 0;
    }
    const chutes = [];
    let start = -1;
    for (let i = 0; i <= N; i++) {
      if (i < N && open[i]) { if (start < 0) start = i; continue; }
      if (start >= 0) {
        const a = -hw + start * dl, b = -hw + i * dl;
        if (b - a > 0.22) chutes.push({ a, b, w: b - a });
        start = -1;
      }
    }
    return chutes;
  }

  rebuild() {
    const chutes = this.chutes = this.findChutes();
    const rng = new RNG(77);
    const pos = [], uv = [], ch = [], tan = [], lay = [], idx = [];
    const v0Base = WF_LEN * Math.sqrt(G / (2 * WF_DROP));
    // inner core first (drawn behind), then the outer skin
    for (const layer of [1, 0]) chutes.forEach((cu, ci) => {
      const seed = ci * 1.37 + rng.next();
      const mid = (cu.a + cu.b) / 2;
      const nu = clamp(Math.ceil(cu.w / 0.07), 6, 48), nv = 40;
      const base = pos.length / 3;
      const thick = clamp(cu.w / 1.2, 0.4, 1); // wide chutes carry more water and throw further
      const thin = 1 - smoothstep(0.3, 0.7, cu.w); // narrow ones barely leave the rock
      const squeeze = layer ? 0.86 : 1;         // the core is narrower and falls a little closer to the rock
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const lat0 = mid + (cu.a + u * cu.w - mid) * squeeze;
        const z0 = WF_Z + brinkWobble(lat0) - layer * 0.03;
        const y0 = waterLevel(z0) - layer * 0.025;
        const centre = 1 - (2 * u - 1) ** 2;
        // thin water at the chute's sides clings to the rocks; the thick middle bows outward
        const v0 = v0Base * (0.82 + 0.22 * Math.sqrt(centre) + 0.1 * centre * thick + 0.05 * Math.sin(lat0 * 3.1 + seed)) * (layer ? 0.9 : 1) * (1 - thin * 0.62);
        const pool = waterLevel(z0 + WF_LEN + 0.4);
        const tEnd = Math.sqrt((2 * (y0 - pool + 0.18)) / G);
        const tStart = layer ? -0.08 : -0.24;
        if (!layer && (i === 0 || i === nu)) (cu.edges = cu.edges || []).push({ lat0, mid, z0, y0, v0, tEnd, side: i ? 1 : -1 });
        let s = 0, prev = null, prevT = 0;
        for (let j = 0; j <= nv; j++) {
          const f = j / nv;
          const t = tStart + (tEnd - tStart) * Math.pow(f, 1.25);
          const fall = clamp(t / tEnd, 0, 1);
          // the jet necks in as it accelerates, then flares as it breaks apart
          const spread = 1 - 0.1 * fall + (layer ? 0.3 : 0.24) * fall * fall;
          const lat = mid + (lat0 - mid) * spread;
          const z = z0 + v0 * t;
          const y = t < 0 ? waterLevel(z) + 0.012 - layer * 0.02 : y0 + 0.012 - 0.5 * G * t * t;
          const sl = Math.sqrt(1 + streamSlope(z) ** 2);
          const x = streamCenter(z) + lat * sl;
          // arc length from the brink (the approach over the sill counts negative)
          if (t >= 0) s = prevT < 0 || !prev ? v0 * t : s + Math.hypot(x - prev[0], y - prev[1], z - prev[2]);
          pos.push(x, y, z);
          prev = [x, y, z]; prevT = t;
          uv.push(u, t < 0 ? v0 * t : s);
          const edge = Math.min(u, 1 - u) * cu.w * squeeze * spread;
          ch.push(seed, cu.w, edge, fall);
          tan.push(1 / sl, 0, -streamSlope(z) / sl);
          lay.push(layer);
        }
      }
      const W = nv + 1;
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = base + i * W + j, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aCh', new THREE.Float32BufferAttribute(ch, 4));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // face downstream (towards +z), so lighting is consistent from the pool side
    const n = g.attributes.normal;
    let sum = 0;
    for (let i = 0; i < n.count; i++) sum += n.getZ(i);
    if (sum < 0) { for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); }
    g.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    // lateral coverage for the plunge foam and the spray
    const d = this.covData;
    for (let i = 0; i < 256; i++) {
      const lat = SIM.latMin + (i + 0.5) / 256 * SIM.dLat;
      let cov = 0;
      for (const cu of chutes) {
        const flare = cu.w * 0.12 + 0.12;
        cov = Math.max(cov, smoothstep(cu.a - flare, cu.a + 0.1, lat) * (1 - smoothstep(cu.b - 0.1, cu.b + flare, lat)) * clamp(cu.w / 0.8, 0.45, 1));
      }
      d[i * 4] = cov * 255; d[i * 4 + 1] = d[i * 4 + 2] = 0; d[i * 4 + 3] = 255;
    }
    this.covTex.needsUpdate = true;
    this.totalW = chutes.reduce((s, c) => s + c.w, 0);
  }

  // a drop tearing off a chute's edge partway down: position and velocity on the jet's arc
  edgeDrop(out = {}) {
    const cu = this.chutes[Math.floor(Math.random() * this.chutes.length)];
    if (!cu || !cu.edges) return null;
    const e = cu.edges[Math.random() < 0.5 ? 0 : 1];
    const t = e.tEnd * (0.15 + Math.random() * 0.7);
    const fall = t / e.tEnd;
    const lat = e.mid + (e.lat0 - e.mid) * (1 - 0.1 * fall + 0.24 * fall * fall);
    const z = e.z0 + e.v0 * t, sl = Math.sqrt(1 + streamSlope(z) ** 2);
    out.x = streamCenter(z) + lat * sl; out.y = e.y0 - 0.5 * G * t * t; out.z = z;
    out.vx = e.side * (0.15 + Math.random() * 0.35); out.vy = -G * t; out.vz = e.v0 * (0.9 + Math.random() * 0.2);
    return out;
  }

  // a random point where falling water meets the pool (weighted by chute width)
  footPoint(out = {}) {
    let r = Math.random() * this.totalW;
    let cu = this.chutes[0];
    for (const c of this.chutes) { r -= c.w; if (r <= 0) { cu = c; break; } }
    if (!cu) return null;
    const lat = cu.a + Math.random() * cu.w;
    const z = WF_Z + brinkWobble(lat) + WF_LEN * (1.05 + Math.random() * 0.3);
    out.x = streamCenter(z) + lat * Math.sqrt(1 + streamSlope(z) ** 2);
    out.z = z; out.y = waterLevel(z); out.w = cu.w;
    return out;
  }
}
