// The tarn: a small, still, very clear lake in the cirque high on the mountain. Like the creek it is drawn
// over the finished scene: what lies on the bed is seen through the water (bent a little by the surface),
// tinted by the depth it passes through, clear over the pale granite gravel at the edges and deepening to a
// blue-green in the middle. The surface mirrors the headwall, its snowfields and the sky in a planar
// reflection rendered when the lake is in view (a small skyline map baked at load stands in otherwise),
// and carries only the faintest breath of ripples, with cat's-paws where the wind touches it.
import * as THREE from 'three';
import { U, fogGLSL } from '../core/env.js';
import { LAKE, groundAt, normalAt } from './shape.js';
import { smoothstep } from '../noise.js';

const AZ = 256, EL = 48, EL_MAX = 0.75; // fallback reflection map: azimuth x elevation (radians up to EL_MAX)

const vert = /* glsl */`
attribute float aWet;
varying vec3 vWP;
varying float vWet;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWP = w.xyz; vWet = aWet;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */`
uniform sampler2D uNoise;
uniform sampler2D tDetail;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tRefl;
uniform sampler2D tSkyline;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform mat4 uReflMatrix;
uniform float uReflY;
uniform float uReflOn;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec2 uResolution;
uniform float uTime;
uniform vec4 uWind;
uniform float uRain;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSkyAmb;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uNight;
${fogGLSL}
varying vec3 vWP;
varying float vWet;

vec3 recon(vec2 uv, float d){
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc; vp /= vp.w;
  return (uCamWorld * vp).xyz;
}
vec3 skyCol(vec3 R){
  float h = max(R.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.42));
  float cs = max(dot(R, uSunDir), 0.0);
  c += uSunColor * (pow(cs, 10.0) * 0.35 + pow(cs, 120.0) * 1.0) * (1.0 - uNight);
  return c;
}
vec2 dn(vec2 p){ return texture2D(tDetail, p).rg * 2.0 - 1.0; }

void main(){
  if (vWet < 0.5) discard;
  vec3 wp = vWP;
  vec2 q = wp.xz;
  vec3 V = normalize(cameraPosition - wp);
  float viewDist = length(cameraPosition - wp);

  // ---- what lies beneath (from the scene's depth) ----
  vec2 suv = gl_FragCoord.xy / uResolution;
  float sd0 = texture2D(tDepth, suv).r;
  vec3 sp0 = recon(suv, sd0);
  float vdepth = sd0 >= 1.0 ? 30.0 : wp.y - sp0.y;
  if (vdepth < 0.0) discard;
  float thick0 = sd0 >= 1.0 ? 30.0 : length(sp0 - wp);

  // ---- the surface: nearly a mirror ----
  // long slow swells, a fine shiver, and cat's-paws where gusts touch down and drift across
  vec2 sw = dn(q * 0.045 + vec2(uTime * 0.004, -uTime * 0.003)) * 0.6 + dn(q * 0.11 - vec2(uTime * 0.006, 0.0) + 0.37) * 0.4;
  vec2 fine = dn(q * 0.9 + vec2(uTime * 0.03, uTime * 0.02)) * 0.5 + dn(q * 2.1 - vec2(uTime * 0.05, -uTime * 0.04) + 0.6) * 0.5;
  float paws = smoothstep(0.5, 0.85, texture2D(uNoise, q * 0.035 - uWind.xy * uTime * 0.02).r) * clamp(uWind.z * 1.4, 0.0, 1.0);
  vec2 wr = dn(q * 1.6 - uWind.xy * uTime * 0.7) * 0.5 + dn(q * 3.3 + uWind.xy * uTime * 0.35) * 0.5;
  // rain rings
  vec2 rn = dn(q * 2.6 + vec2(uTime * 0.7, -uTime * 0.5)) * uRain;
  vec2 pert = sw * 0.035 + fine * (0.008 + uWind.z * 0.01) + wr * paws * 0.2 + rn * 0.25;
  vec3 N = normalize(vec3(pert.x, 1.0, pert.y));
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.03 + 0.97 * pow(1.0 - NdV, 4.5);
  F = min(F, 0.95);

  // ---- refraction ----
  vec2 ruv = clamp(suv + N.xz * 0.35 * clamp(thick0, 0.0, 2.0) / max(viewDist, 1.0), vec2(0.001), vec2(0.999));
  float sd = texture2D(tDepth, ruv).r;
  vec3 sp = recon(ruv, sd);
  if (sd < 1.0 && length(sp - cameraPosition) < viewDist - 0.02) { ruv = suv; sd = sd0; sp = sp0; }
  float thick = sd >= 1.0 ? 30.0 : length(sp - wp);
  float bedDepth = sd >= 1.0 ? 30.0 : max(wp.y - sp.y, 0.0);
  vec3 refr = texture2D(tScene, ruv).rgb;

  // sun on the surface (the headwall shades the lake late in the day)
  float shadow = 1.0;
  if (uShadowOn > 0.5) {
    vec4 sc = uShadowMatrix * vec4(wp, 1.0);
    sc.xyz /= sc.w;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      vec2 ts = vec2(1.0 / 4096.0) * 1.5;
      shadow = 0.25 * (texture(tShadow, vec3(sc.xy + vec2(-ts.x, -ts.y), sc.z - 0.0008)) + texture(tShadow, vec3(sc.xy + vec2(ts.x, -ts.y), sc.z - 0.0008))
                     + texture(tShadow, vec3(sc.xy + vec2(-ts.x, ts.y), sc.z - 0.0008)) + texture(tShadow, vec3(sc.xy + vec2(ts.x, ts.y), sc.z - 0.0008)));
    }
  }
  float sunVis = shadow * smoothstep(-0.02, 0.06, uSunDir.y);

  // ---- the water itself: snowmelt, almost nothing in it ----
  // red goes first, then green: clear over the gravel, aquamarine at a metre or two, deep blue-green beyond
  vec3 absorb = vec3(0.34, 0.12, 0.1);
  vec3 Tr = exp(-absorb * thick - vec3(0.2, 0.09, 0.07) * bedDepth);
  vec3 lightIn = uSkyAmb * 0.85 + uSunColor * uSunIntensity * 0.1 * max(uSunDir.y, 0.0) * (0.4 + 0.6 * sunVis);
  vec3 scatterCol = vec3(0.006, 0.032, 0.045) * lightIn;
  // caustics: the ripples focus the sun into a slow net of light on the shallow bed
  vec2 cq = sp.xz;
  float c1 = 1.0 - abs(texture2D(uNoise, cq * 0.42 + vec2(uTime * 0.012, uTime * 0.008)).r * 2.0 - 1.0);
  float c2 = 1.0 - abs(texture2D(uNoise, cq * 0.57 - vec2(uTime * 0.01, -uTime * 0.013) + 0.3).g * 2.0 - 1.0);
  float caus = pow(c1 * c2, 5.0) * (1.0 - smoothstep(0.3, 2.5, bedDepth)) * smoothstep(0.02, 0.15, bedDepth);
  refr += uSunColor * uSunIntensity * caus * sunVis * 0.05;
  vec3 body = refr * Tr + scatterCol * (1.0 - Tr);

  // ---- reflection ----
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = skyCol(R);
  // fallback: the baked skyline around the cirque
  float az = atan(R.z, R.x) / 6.28318 + 0.5;
  float el = asin(clamp(R.y, 0.0, 1.0));
  vec4 rf = texture2D(tSkyline, vec2(az, clamp(el / ${EL_MAX.toFixed(3)}, 0.0, 1.0)));
  vec3 lit = uSunColor * uSunIntensity * (0.35 + 0.5 * clamp(uSunDir.y * 1.5, 0.0, 1.0)) + uSkyAmb * 0.55;
  vec3 baked = mix(sky, rf.rgb * lit * 0.6, step(0.004, rf.a) * rf.a);
  // the real mirror image, softened a touch by the ripples
  vec4 rc = uReflMatrix * vec4(wp, 1.0);
  vec2 rv = rc.xy / rc.w + N.xz * 0.06;
  vec2 rr = vec2(0.0015, 0.0025) * (1.0 + paws * 3.0 + uRain * 3.0);
  vec3 mirror = texture2D(tRefl, clamp(rv, vec2(0.001), vec2(0.999))).rgb * 0.4;
  mirror += texture2D(tRefl, clamp(rv + vec2(rr.x, rr.y), vec2(0.001), vec2(0.999))).rgb * 0.15;
  mirror += texture2D(tRefl, clamp(rv + vec2(-rr.x, rr.y), vec2(0.001), vec2(0.999))).rgb * 0.15;
  mirror += texture2D(tRefl, clamp(rv + vec2(rr.x, -rr.y), vec2(0.001), vec2(0.999))).rgb * 0.15;
  mirror += texture2D(tRefl, clamp(rv + vec2(-rr.x, -rr.y), vec2(0.001), vec2(0.999))).rgb * 0.15;
  float planeOk = uReflOn * (1.0 - smoothstep(0.05, 0.3, abs(uReflY - wp.y)));
  vec3 refl = mix(baked, mirror, planeOk);
  // the cat's-paws break the mirror up and show more of the sky
  refl = mix(refl, sky * 0.9, paws * 0.2);

  vec3 col = mix(body, refl, F);

  // sun glitter: a tight core and a soft sheen
  vec3 H = normalize(normalize(uSunDir) + V);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 2200.0) * 30.0 + pow(nh, 220.0) * 0.8;
  col += uSunColor * uSunIntensity * spec * sunVis * F * 3.0 * (1.0 - uNight * 0.6);

  // a soft line where the water meets the shore
  float alpha = smoothstep(0.0, 0.035, vdepth);
  col = applyFog(col, cameraPosition, wp, uSunDir);
  gl_FragColor = vec4(col, alpha);
}`;

// what the lake sees in each direction: the colour of the land a ray from the water meets, or sky
function bakeSkyline() {
  const data = new Uint8Array(AZ * EL * 4);
  const eye = LAKE.y + 0.5;
  const n = new THREE.Vector3();
  for (let i = 0; i < AZ; i++) {
    const a = (i + 0.5) / AZ * Math.PI * 2 - Math.PI;
    const dx = Math.cos(a), dz = Math.sin(a);
    // march outward once, keeping the terrain's elevation angle as seen from the water
    const prof = [];
    for (let d = LAKE.r * 0.6; d < 700; d *= 1.03) {
      const x = LAKE.x + dx * d, z = LAKE.z + dz * d, h = groundAt(x, z);
      prof.push({ d, x, z, h, e: Math.atan2(h - eye, d) });
    }
    for (let j = 0; j < EL; j++) {
      const e = (j + 0.5) / EL * EL_MAX;
      const hit = prof.find((q) => q.e >= e);
      const k = (j * AZ + i) * 4;
      if (!hit) { data[k + 3] = 0; continue; }
      normalAt(hit.x, hit.z, n);
      const up = hit.h;
      // snow above the drifts' line on gentle ground, then bare granite on the steeps, turf and trees below
      let c;
      const snow = Math.min(1, Math.max(0, (up - LAKE.y - 4) / 55)) * smoothstep(0.5, 0.75, n.y);
      if (n.y < 0.6) c = [0.3, 0.29, 0.28];
      else if (up > LAKE.y - 25) c = [0.2, 0.21, 0.12];
      else c = [0.05, 0.09, 0.05];
      c = c.map((v, q) => v + (0.92 - v) * snow * (q === 2 ? 1.02 : 1));
      const fog = Math.exp(-hit.d / 900);
      data[k] = Math.min(255, c[0] * 255); data[k + 1] = Math.min(255, c[1] * 255); data[k + 2] = Math.min(255, c[2] * 255);
      data[k + 3] = Math.max(2, fog * 255);
    }
  }
  const t = new THREE.DataTexture(data, AZ, EL, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class Lake {
  // `wu`: the creek's uniforms, whose scene, depth, shadow and reflection bindings the lake shares
  constructor(scene, wu) {
    const S = LAKE.r + 5, N = 72;
    const geo = new THREE.PlaneGeometry(S * 2, S * 2, N, N).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, dep = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + LAKE.x, z = pos.getZ(i) + LAKE.z;
      pos.setXYZ(i, x, LAKE.y, z);
      dep[i] = LAKE.y - groundAt(x, z);
    }
    // only the basin itself holds water: flood out from the middle, so ground that dips below the water
    // level outside the moraine (the slope falling away downhill) stays dry. The mask runs a cell past the
    // flood so the true shoreline comes from the depth buffer, not the grid.
    const W = N + 1, wet = new Uint8Array(pos.count), st = [Math.floor(W / 2) * W + Math.floor(W / 2)];
    while (st.length) {
      const k = st.pop();
      if (wet[k] || dep[k] <= 0) continue;
      wet[k] = 1;
      const i = k % W, j = (k - i) / W;
      if (i > 0) st.push(k - 1); if (i < W - 1) st.push(k + 1); if (j > 0) st.push(k - W); if (j < W - 1) st.push(k + W);
    }
    const mask = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) {
      const i = k % W, j = (k - i) / W;
      for (let dj = -2; dj <= 2 && !mask[k]; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && ii < W && jj >= 0 && jj < W && wet[jj * W + ii]) { mask[k] = 1; break; }
      }
    }
    geo.setAttribute('aWet', new THREE.BufferAttribute(mask, 1));
    geo.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: {
        tSkyline: { value: bakeSkyline() },
        tDetail: wu.tDetail, tScene: wu.tScene, tDepth: wu.tDepth, tRefl: wu.tRefl,
        tShadow: wu.tShadow, uShadowMatrix: wu.uShadowMatrix, uShadowOn: wu.uShadowOn,
        uReflMatrix: wu.uReflMatrix, uReflY: wu.uReflY, uReflOn: wu.uReflOn,
        uInvProj: wu.uInvProj, uCamWorld: wu.uCamWorld, uResolution: wu.uResolution,
        uNoise: U.uNoise, uTime: U.uTime, uWind: U.uWind, uRain: U.uRain, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSunIntensity: U.uSunIntensity,
        uSkyAmb: U.uSkyAmb, uZenith: U.uZenith, uHorizon: U.uHorizon, uNight: U.uNight,
        uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogHeight: U.uFogHeight,
      },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.name = 'lake';
    scene.add(this.mesh);
    this.sphere = new THREE.Sphere(new THREE.Vector3(LAKE.x, LAKE.y, LAKE.z), S * 1.45);
    this.frustum = new THREE.Frustum();
    this.pm = new THREE.Matrix4();
  }

  // whether this frame's planar reflection should be the lake's rather than the creek's: when it's on screen,
  // fairly close and seen from above
  wantsReflection(camera) {
    const p = camera.position;
    if (p.y < LAKE.y + 0.1 || p.distanceTo(this.sphere.center) > 170) return false;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    return this.frustum.setFromProjectionMatrix(this.pm).intersectsSphere(this.sphere);
  }
}
