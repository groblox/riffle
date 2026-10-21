// Shared uniforms & GLSL snippets used across materials.
import * as THREE from 'three';
import { getProfileTexture, profileGLSL, WORLD, LAKE, PEAK } from '../world/shape.js';
import { sharedTextures } from '../gfx/textures.js';

export const U = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 0.6, 0) }, // dir.xy, strength, gust
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSunIntensity: { value: 1 },
  uSkyAmb: { value: new THREE.Color(0.5, 0.6, 0.8) },
  uFogColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
  uFogSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  uFogDensity: { value: 0.0012 },
  uFogHeight: { value: 0.012 },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uNight: { value: 0 },
  uSeason: { value: 1 },       // 0 summer, 1 autumn, 2 winter
  uSnow: { value: 0 },
  uRain: { value: 0 },
  uWet: { value: 0 },
  uCloud: { value: 0.35 },
  uProfile: { value: null },
  uNoise: { value: null },
  uPebbles: { value: null },
  uStrata: { value: null },
  uPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  uCamPos: { value: new THREE.Vector3() },
  uContact: { value: null }, // ground occlusion around the feet of rocks (world xz map)
  uLake: { value: new THREE.Vector4(LAKE.x, LAKE.z, LAKE.y, LAKE.r) }, // the tarn: centre xz, water level, radius
};

export function initEnv() {
  const t = sharedTextures();
  U.uProfile.value = getProfileTexture();
  U.uNoise.value = t.noise;
  U.uPebbles.value = t.pebbles;
  U.uStrata.value = t.strata;
}

export const commonGLSL = /* glsl */`
uniform float uTime;
uniform vec4 uWind;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform sampler2D uNoise;
uniform float uSeason;
uniform float uSnow;
uniform float uRain;
uniform float uWet;
uniform float uNight;
uniform vec4 uPushers[8];
uniform vec4 uLake;
${profileGLSL}

// winter snow only settles high up: the canyon rims, the ridgetops and the peaks, never the valley or the lower slopes
// the high mountain keeps its snow all year: a few drifts in the hollows about the tarn, more and larger
// patches higher up, joining into snowfields toward the summit (a little higher in summer)
float alpineSnow(vec3 wp){
  float near = 1.0 - smoothstep(120.0, 175.0, length(wp.xz - vec2(${PEAK.x.toFixed(1)}, ${PEAK.z.toFixed(1)})));
  if (near <= 0.0) return 0.0;
  float n1 = texture2D(uNoise, wp.xz * 0.009 + 0.3).g, n2 = texture2D(uNoise, wp.xz * 0.024 + 0.7).r, n3 = texture2D(uNoise, wp.xz * 0.11).b;
  // how much of the ground is snow at this height
  float cov = clamp((wp.y + (n1 - 0.5) * 16.0 - ${(LAKE.y + 10).toFixed(1)} + (1.0 - clamp(uSeason, 0.0, 1.0)) * -6.0) / 55.0, 0.0, 1.0);
  cov = pow(cov, 0.8);
  // which patches: crisp-edged drifts
  float drift = n2 * 0.9 + n3 * 0.1;
  float s = smoothstep(1.0 - cov - 0.04, 1.0 - cov + 0.04, drift) * smoothstep(0.05, 0.2, cov);
  // nothing settles on the tarn's bed
  s *= smoothstep(0.0, 0.3, wp.y - uLake.z) + step(uLake.w + 3.0, length(wp.xz - uLake.xy));
  return clamp(s, 0.0, 1.0) * near;
}
float snowCover(vec3 wp){
  float a = alpineSnow(wp);
  if (uSnow <= 0.0) return a;
  float zc = clamp(wp.z, -330.0, 330.0);
  float h = wp.y - waterLevelAt(zc);
  float n = texture2D(uNoise, wp.xz * 0.013).g;
  float drift = texture2D(uNoise, wp.xz * 0.045 + 0.3).b;   // drifts and blown-bare patches
  // the Colorado side lies under a blanket from the banks up, patchy only close to the water; the desert side
  // is dusted, with bare red ground showing through low down, and whitens with height
  vec4 pa = profileA(zc);
  float desert = smoothstep(-4.0, 14.0, wp.x - pa.x);
  // distance out from the water's edge: the channel itself (and anything under water) stays clear
  float bank = abs(wp.x - pa.x) - pa.z;
  float co = smoothstep(0.2, 1.6, bank + (n - 0.5) * 1.2) * mix(0.62 + 0.38 * smoothstep(0.3, 0.55, drift), 1.0, smoothstep(3.0, 10.0, h));
  // the desert's patches: windblown drifts in the lee of things, ragged at the edges
  float dd = drift * 0.6 + texture2D(uNoise, wp.xz * 0.13 + 0.7).r * 0.25 + texture2D(uNoise, wp.xz * 0.012).a * 0.3;
  float de = mix(0.7 * smoothstep(0.42, 0.78, dd), 1.0, smoothstep(8.0, 45.0, h + (n - 0.5) * 24.0)) * smoothstep(0.3, 2.5, bank);
  return max(a, uSnow * mix(co, de, desert) * smoothstep(-0.3, -0.05, h));
}

float hash11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy+p3.yzz)*p3.zyx); }

// Large-scale gust field + local sway. Returns xz displacement direction*amount (unitless, scale by height).
vec2 windField(vec3 wp, float phase){
  vec2 dir = uWind.xy;
  float gust = texture2D(uNoise, wp.xz*0.0035 - dir*uTime*0.045).r;
  gust = smoothstep(0.25, 0.85, gust);
  float s = uWind.z * (0.35 + gust*1.3);
  float sway = sin(uTime*1.9 + phase + dot(wp.xz, vec2(0.31,0.23)))*0.6 + sin(uTime*3.3 + phase*1.7 + wp.x*0.5)*0.3;
  return dir * s * (0.55 + 0.45*sway) + vec2(-dir.y, dir.x) * s * 0.18 * sin(uTime*2.3 + phase*2.1);
}
// Push vegetation away from interactors (cursor, critters)
vec2 pushField(vec3 wp){
  vec2 o = vec2(0.0);
  for(int i=0;i<8;i++){
    vec4 p = uPushers[i];
    vec2 d = wp.xz - p.xz;
    float r = p.w;
    if (r <= 0.0) continue;
    float l = length(d);
    float k = 1.0 - smoothstep(r*0.3, r, l);
    float dy = abs(wp.y - p.y);
    k *= 1.0 - smoothstep(1.0, 3.0, dy);
    o += (d / max(l, 0.001)) * k * 0.9;
  }
  return o;
}

float causticPattern(vec2 uv, float t){
  vec2 p = mod(uv*6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n+1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0/length(vec2(p.x / (sin(i.x+tt)/inten), p.y / (cos(i.y+tt)/inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 7.0), 0.0, 3.0);
}
// Caustics for a submerged world point; returns light multiplier (0..)
float caustics(vec3 wp){
  float wl = waterLevelAt(wp.z);
  float depth = wl - wp.y;
  if (depth <= 0.0) return 0.0;
  vec4 pa = profileA(wp.z);
  float lat = abs(wp.x - pa.x) / max(pa.z, 0.1);
  if (lat > 1.6) return 0.0;
  // project along sun so caustics shift with sun angle
  vec2 uv = wp.xz + uSunDir.xz / max(uSunDir.y, 0.2) * depth;
  float flow = pa.w;
  vec2 fl = vec2(0.0, uTime*flow*0.25);
  float c = causticPattern(uv*0.32 - fl*0.32, uTime*0.55) * 0.65 + causticPattern(uv*0.53 + vec2(0.3,0.7) - fl*0.53, uTime*0.7 + 3.0) * 0.45;
  float fade = smoothstep(0.0, 0.12, depth) * exp(-depth*0.55);
  return c * fade * (1.0 - smoothstep(1.2, 1.6, lat));
}
`;

// Contact occlusion where rocks meet the ground (baked by Rocks into a world-space map).
export const contactGLSL = /* glsl */`
uniform sampler2D uContact;
float contactAO(vec3 p){
  vec2 uv = (p.xz + ${WORLD.toFixed(1)}) / ${(WORLD * 2).toFixed(1)};
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  return texture2D(uContact, uv).r;
}
`;

// Fog (height-based exponential with sun inscatter). Needs uniforms below.
export const fogGLSL = /* glsl */`
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeight;
vec3 applyFog(vec3 col, vec3 camPos, vec3 wp, vec3 sunDir){
  vec3 rd = wp - camPos;
  float dist = length(rd);
  rd /= max(dist, 1e-4);
  float b = uFogHeight;
  float a = uFogDensity * exp(-b * (camPos.y - 2.0));
  float ry = rd.y * b;
  float fogAmt = abs(ry) > 1e-4 ? a * (1.0 - exp(-dist * ry)) / ry : a * dist;
  fogAmt = 1.0 - exp(-max(fogAmt, 0.0) - dist * 0.00014);
  float sunAmt = pow(max(dot(rd, sunDir), 0.0), 6.0);
  vec3 fc = mix(uFogColor, uFogSunColor, sunAmt);
  // distant ridges sit in a deeper blue haze instead of washing out white (which reads as snow);
  // right at the horizon it returns to the sky's colour so the land's edge doesn't show
  float farK = 1.0 - smoothstep(2900.0, 3400.0, dist);
  fc = mix(fc, fc * vec3(0.52, 0.64, 0.9), smoothstep(200.0, 1200.0, dist) * farK * (1.0 - sunAmt) * 0.85);
  // ...and the land never quite dissolves into it: the ranges keep their silhouettes
  fogAmt = min(fogAmt, mix(1.0, 0.72, farK));
  return mix(col, fc, clamp(fogAmt, 0.0, 1.0));
}
`;

// Patch a built-in material with extra shader code. hooks: { uniforms, vertexHead, vertex: {chunk: code}, fragmentHead, fragment: {chunk: code} }
// fragment/vertex map: key '#include <x>' replaced by provided code (use '$' to insert original).
export function patchMaterial(mat, hooks, key) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, hooks.uniforms || {});
    shader.vertexShader = (hooks.vertexHead || '') + '\n' + shader.vertexShader;
    shader.fragmentShader = (hooks.fragmentHead || '') + '\n' + shader.fragmentShader;
    for (const [k, v] of Object.entries(hooks.vertex || {})) {
      const inc = `#include <${k}>`;
      if (!shader.vertexShader.includes(inc)) console.warn('patch: missing vertex chunk', k);
      shader.vertexShader = shader.vertexShader.replace(inc, v.split('$').join(inc + '\n'));
    }
    for (const [k, v] of Object.entries(hooks.fragment || {})) {
      const inc = `#include <${k}>`;
      if (!shader.fragmentShader.includes(inc)) console.warn('patch: missing fragment chunk', k);
      shader.fragmentShader = shader.fragmentShader.replace(inc, v.split('$').join(inc + '\n'));
    }
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => key || hooks.key || 'patched';
  return mat;
}

// Common "world position varying" vertex snippet
export const worldPosVertex = /* glsl */`
  vec4 wPos4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wPos4 = instanceMatrix * wPos4;
  #endif
  wPos4 = modelMatrix * wPos4;
  vWorldPos = wPos4.xyz;
`;
