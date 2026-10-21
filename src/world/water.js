// Stream water: ribbon mesh following the channel, a GPU ripple + foam simulation advected
// by a precomputed flow field (potential flow around rocks), planar reflections,
// depth-aware refraction / absorption, sun glints with shadows, flow-mapped detail and waterfall.
import * as THREE from 'three';
import {
  PZ0, PZ1, WF_Z, WF_LEN, WF_DROP, streamCenter, streamHalfW, streamSlope, waterLevel, streamSpeed, groundAt, streamTurb, profileGLSL,
} from './shape.js';
import { U, fogGLSL } from '../core/env.js';
import { sharedTextures } from '../gfx/textures.js';
import { rockWaterRadius } from './rocks.js';
import { clamp, smoothstep } from '../noise.js';

export const SIM = { latMin: -14, latMax: 14, z0: -150, z1: 150, W: 256, H: 2752 };
SIM.dLat = SIM.latMax - SIM.latMin; SIM.dZ = SIM.z1 - SIM.z0;
SIM.cell = SIM.dLat / SIM.W;

const fsVert = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const simFrag = /* glsl */`
uniform sampler2D tState;
uniform sampler2D tFlow;
uniform vec2 uTexel;
uniform float uDt;
uniform vec2 uDomain;
uniform vec2 uOrigin;
uniform vec4 uDrops[24];
uniform int uDropCount;
uniform float uRain;
uniform float uSeed;
uniform float uC2;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec4 fl = texture2D(tFlow, vUv);
  vec2 vel = fl.rg;
  vec2 back = vUv - vel * uDt / uDomain;
  vec4 c = texture2D(tState, back);
  vec4 l = texture2D(tState, back - vec2(uTexel.x, 0.0));
  vec4 r = texture2D(tState, back + vec2(uTexel.x, 0.0));
  vec4 d = texture2D(tState, back - vec2(0.0, uTexel.y));
  vec4 u = texture2D(tState, back + vec2(0.0, uTexel.y));
  float h = c.r, hp = c.g;
  float lap = l.r + r.r + d.r + u.r - 4.0 * h;
  float hn = h + (h - hp) * 0.992 + uC2 * lap;
  hn *= 0.9985;
  float mask = fl.b;
  hn *= 1.0 - mask;
  // foam: advected, diffused slightly, sourced by obstacles/turbulence, decays
  float f = mix(c.b, (l.b + r.b + d.b + u.b) * 0.25, 0.06);
  float flick = hash(floor(vUv / uTexel * 0.5) + floor(uTime * 6.0));
  f += fl.a * uDt * (0.5 + 1.2 * flick);
  f *= exp(-uDt * (0.5 + 1.4 * smoothstep(0.7, 0.05, length(vel))));
  f *= 1.0 - mask * 0.5;
  vec2 pm = uOrigin + vUv * uDomain;
  for (int i = 0; i < 24; i++) {
    if (i >= uDropCount) break;
    vec4 dr = uDrops[i];
    float dist = length(pm - dr.xy);
    if (dist < dr.z) {
      float k = cos(dist / dr.z * 1.5707963);
      hn -= dr.w * k * k;
      f += abs(dr.w) * k * 4.0 * step(0.0, dr.w);
    }
  }
  if (uRain > 0.0) {
    float rr = hash(floor(vUv / uTexel) + uSeed * 17.0);
    if (rr > 1.0 - uRain * 0.0009) hn -= 0.03;
  }
  gl_FragColor = vec4(clamp(hn, -1.0, 1.0), h, clamp(f, 0.0, 3.0), 1.0);
}`;

const waterVert = /* glsl */`
attribute vec2 aSim;
attribute float aSteep;
attribute float aFall;
varying float vFall;
varying vec3 vWorldPos;
varying vec2 vSim;
varying float vSteep;
varying vec3 vGeoN;
uniform float uTime;
void main(){
  vec3 p = position;
  vSteep = aSteep;
  vFall = aFall;
  // waterfall sheet shimmer
  p.y += sin(uTime * 13.0 + p.x * 3.0 + p.y * 5.0) * 0.015 * aSteep;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorldPos = w.xyz;
  vSim = aSim;
  vGeoN = normalize(normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const waterFrag = /* glsl */`
uniform sampler2D tSim;
uniform sampler2D tFlow;
uniform sampler2D tDetail;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tRefl;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform mat4 uReflMatrix;
uniform float uReflY;
uniform float uReflOn;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec2 uResolution;
uniform vec2 uSimTexel;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSkyAmb;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform sampler2D uNoise;
uniform vec4 uWind;
uniform float uRain;
uniform float uNight;
uniform float uSnow;
uniform sampler2D tChuteCov;
${profileGLSL}
${fogGLSL}
varying vec3 vWorldPos;
varying vec2 vSim;
varying float vSteep;
varying float vFall;
varying vec3 vGeoN;

const vec2 SIM_ORIGIN = vec2(${SIM.latMin.toFixed(1)}, ${SIM.z0.toFixed(1)});
const vec2 SIM_DOMAIN = vec2(${SIM.dLat.toFixed(1)}, ${SIM.dZ.toFixed(1)});
const float CELL = ${SIM.cell.toFixed(5)};
const float WFZ = ${WF_Z.toFixed(3)};
const float WFLEN = ${WF_LEN.toFixed(3)};

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
  vec3 wp = vWorldPos;
  vec2 simUv = (vSim - SIM_ORIGIN) / SIM_DOMAIN;
  float inSim = step(0.0, simUv.x) * step(simUv.x, 1.0) * step(0.0, simUv.y) * step(simUv.y, 1.0);
  vec4 st = texture2D(tSim, simUv) * inSim;
  float hl = texture2D(tSim, simUv - vec2(uSimTexel.x, 0.0)).r;
  float hr = texture2D(tSim, simUv + vec2(uSimTexel.x, 0.0)).r;
  float hd = texture2D(tSim, simUv - vec2(0.0, uSimTexel.y)).r;
  float hu = texture2D(tSim, simUv + vec2(0.0, uSimTexel.y)).r;
  vec2 grad = vec2(hr - hl, hu - hd) / (2.0 * CELL) * inSim;

  vec4 pa = profileA(wp.z);
  vec4 pb = profileB(wp.z);
  float u = abs(vSim.x) / max(pa.z, 0.1);
  vec4 fl = texture2D(tFlow, simUv);
  vec2 vel = mix(vec2(0.0, pa.w * max(0.0, 1.0 - u * u)), fl.rg, inSim);
  float speed = length(vel);
  float turb = pb.z;

  // ---- screen-space scene info ----
  vec2 suv = gl_FragCoord.xy / uResolution;
  float viewDist = length(wp - cameraPosition);
  float sd0 = texture2D(tDepth, suv).r;
  vec3 sp0 = recon(suv, sd0);
  float thick0 = sd0 >= 1.0 ? 50.0 : length(sp0 - wp);
  float vdepth = sd0 >= 1.0 ? 50.0 : (wp.y - sp0.y);
  float shallow = 1.0 - smoothstep(0.05, 0.6, vdepth);

  // ---- flow-mapped detail normals ----
  float T = 1.4;
  float ph0 = fract(uTime / T), ph1 = fract(uTime / T + 0.5);
  float wgt = abs(ph0 - 0.5) * 2.0;
  vec2 fv = vec2(vel.x, vel.y);
  vec2 o0 = fv * ph0 * T, o1 = fv * ph1 * T;
  vec2 q = wp.xz;
  vec2 n0 = dn((q - o0) * 0.32) * 0.6 + dn((q - o0) * 0.83 + 0.21) * 0.4;
  vec2 n1 = dn((q - o1) * 0.32 + 0.5) * 0.6 + dn((q - o1) * 0.83 + 0.71) * 0.4;
  vec2 dnm = mix(n0, n1, wgt);
  // fine glitter layer
  vec2 g0 = dn((q - o0 * 1.2) * 2.3 + 0.13), g1 = dn((q - o1 * 1.2) * 2.3 + 0.63);
  vec2 gl = mix(g0, g1, wgt);
  // wind cat's-paws on calm water
  float gust = smoothstep(0.45, 0.85, texture2D(uNoise, q * 0.018 - uWind.xy * uTime * 0.06).r) * uWind.z;
  vec2 wr = dn(q * 1.7 - uWind.xy * uTime * 0.9) * 0.5 + dn(q * 3.1 + uWind.xy * uTime * 0.4) * 0.5;

  // ---- waterfall coordinates ----
  float fz = vFall;                                          // 0 at the brink, 1 at the foot
  // emergent rocks on the lip split the sheet: no curtain falls behind them
  float gap = texture2D(tFlow, vec2((vSim.x - SIM_ORIGIN.x) / SIM_DOMAIN.x, (WFZ - 0.12 - SIM_ORIGIN.y) / SIM_DOMAIN.y)).b;
  gap = smoothstep(0.25, 0.75, gap);
  float chan = (1.0 - smoothstep(0.82, 1.0, u)) * (1.0 - gap);
  float curtain = smoothstep(-0.02, 0.06, fz) * (1.0 - smoothstep(0.96, 1.08, fz)) * chan;
  float fallT = clamp(fz, 0.0, 1.0);
  float brink = smoothstep(-3.2, -0.3, wp.z - WFZ) * (1.0 - smoothstep(0.05, 0.3, fz)) * chan;   // glassy tongue
  // plunge zone: only where the chutes actually land
  float chuteCov = texture2D(tChuteCov, vec2((vSim.x - SIM_ORIGIN.x) / SIM_DOMAIN.x, 0.5)).r;
  float foot = smoothstep(0.9, 1.05, fz) * (1.0 - smoothstep(1.0 + 0.5 / WFLEN, 1.0 + 2.4 / WFLEN, fz * (1.0 - chuteCov * 0.25))) * (1.0 - smoothstep(0.8, 1.0, u)) * chuteCov;

  // plunge pool: the falls keep the whole pool stirred, strongest near the foot
  vec2 footP = vec2(profileA(WFZ + WFLEN).x, WFZ + WFLEN);
  float poolD = length((q - footP) * vec2(0.8, 1.0));
  float poolAg = smoothstep(WFZ - 0.3, WFZ + WFLEN, wp.z) * exp(-poolD / 14.0) * (1.0 - smoothstep(0.85, 1.05, u));
  float amp = 0.1 + speed * 0.22 + turb * 0.5 + shallow * speed * 0.35 + uRain * 0.15 + poolAg * 0.35;
  amp *= 1.0 - brink * 0.85;
  // slow swells and a wind ruffle: still water is never quite a mirror
  vec2 sw = dn(q * 0.07 + vec2(0.0, -uTime * 0.03)) * 0.6 + dn(q * 0.16 + vec2(uTime * 0.02, 0.0) + 0.37) * 0.4;
  float calm = 1.0 - smoothstep(0.3, 1.2, speed);
  // rings of surge running out from where the falls land
  vec2 rd = (q - footP) / max(poolD, 0.01);
  float ring = sin(poolD * 6.5 - uTime * 5.0 + dn(q * 0.25).x * 2.0) * exp(-poolD / 4.5) * poolAg;
  vec2 pert = dnm * amp + gl * (0.05 + speed * 0.06 + poolAg * 0.05) * (1.0 - brink * 0.8) + wr * (gust * 0.22 + 0.05) * calm
            + sw * (0.1 + poolAg * 0.12) * calm + rd * ring * 0.09 - grad * 0.85;
  // brink: smooth stream-wise corrugations as the water accelerates over the sill
  vec2 bn = dn(vec2(vSim.x * 0.9, (wp.z - uTime * 1.6) * 0.22));
  pert += vec2(bn.x * 0.22, bn.y * 0.04) * brink;
  // curtain: vertical ropes of water rippling across
  vec2 cn = dn(vec2(vSim.x * 1.6, wp.y * 0.45 + uTime * 2.6)) * 0.6 + dn(vec2(vSim.x * 3.7 + 0.3, wp.y * 0.9 + uTime * 3.4)) * 0.4;
  pert = mix(pert, vec2(cn.x * 0.55, cn.y * 0.15), curtain);
  vec3 Ng = normalize(vGeoN);
  vec3 N = normalize(Ng + vec3(pert.x, pert.y * curtain * 0.5, pert.y * (1.0 - curtain)));
  vec3 Nsharp = normalize(Ng + vec3(pert.x + gl.x * 0.12 * (1.0 - curtain), 0.0, pert.y + gl.y * 0.12) * 1.1);

  vec3 V = normalize(cameraPosition - wp);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F = clamp(F, 0.0, 0.92);

  // ---- refraction ----
  vec2 distort = N.xz * 0.6 * clamp(thick0, 0.0, 1.2) / max(viewDist, 1.0);
  vec2 ruv = clamp(suv + distort, vec2(0.001), vec2(0.999));
  float sd = texture2D(tDepth, ruv).r;
  vec3 sp = recon(ruv, sd);
  if (sd < 1.0 && length(sp - cameraPosition) < viewDist - 0.02) { ruv = suv; sd = sd0; sp = sp0; }
  float thick = sd >= 1.0 ? 50.0 : length(sp - wp);
  vec3 refr = texture2D(tScene, ruv).rgb;

  // shadow at the surface
  float shadow = 1.0;
  if (uShadowOn > 0.5) {
    vec4 sc = uShadowMatrix * vec4(wp, 1.0);
    sc.xyz /= sc.w;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
      float s = 0.0;
      vec2 ts = vec2(1.0 / 4096.0) * 1.5;
      s += texture(tShadow, vec3(sc.xy + vec2(-ts.x, -ts.y), sc.z - 0.0008));
      s += texture(tShadow, vec3(sc.xy + vec2( ts.x, -ts.y), sc.z - 0.0008));
      s += texture(tShadow, vec3(sc.xy + vec2(-ts.x,  ts.y), sc.z - 0.0008));
      s += texture(tShadow, vec3(sc.xy + vec2( ts.x,  ts.y), sc.z - 0.0008));
      shadow = s * 0.25;
    }
  }
  float sunVis = shadow * smoothstep(-0.02, 0.06, uSunDir.y);

  // absorption & in-scattering (clear mountain water: emerald in depth)
  // mountain water: clear in the shallows, deep green in the pools; the falls churn the pool milky with bubbles
  // depth below the surface matters, not just path length: deep pools go dark and murky green
  float bedDepth = max(vdepth, 0.0);
  vec3 absorb = vec3(0.6, 0.17, 0.26) * (1.0 + poolAg * 0.8);
  vec3 Tr = exp(-absorb * thick * 1.2 - vec3(0.45, 0.22, 0.3) * smoothstep(0.5, 2.5, bedDepth) * bedDepth * 0.5);
  vec3 lightIn = uSkyAmb * 0.9 + uSunColor * uSunIntensity * 0.12 * max(uSunDir.y, 0.0) * (0.4 + 0.6 * sunVis);
  vec3 scatterCol = mix(vec3(0.02, 0.07, 0.055), vec3(0.12, 0.2, 0.18), poolAg * 0.7) * lightIn;
  vec3 body = refr * Tr + scatterCol * (1.0 - Tr);
  // sunlit sediment glow in shallows
  body += vec3(0.06, 0.05, 0.02) * shallow * uSunIntensity * sunVis * 0.05;

  // ---- reflection ----
  vec4 rc = uReflMatrix * vec4(wp, 1.0);
  // rougher water -> wobblier, blurrier reflections (5-tap blur along the surface)
  float rough = clamp(0.3 + speed * 0.35 + poolAg * 0.9 + turb * 0.6 + uRain * 0.4, 0.0, 1.2);
  vec2 rv = rc.xy / rc.w + N.xz * (0.05 + rough * 0.06);
  vec2 rr = vec2(0.004, 0.007) * rough * (1.0 + 4.0 / max(viewDist, 1.0));
  vec3 refl = texture2D(tRefl, clamp(rv, vec2(0.001), vec2(0.999))).rgb * 0.36;
  refl += texture2D(tRefl, clamp(rv + vec2(rr.x, rr.y), vec2(0.001), vec2(0.999))).rgb * 0.16;
  refl += texture2D(tRefl, clamp(rv + vec2(-rr.x, rr.y * 0.5), vec2(0.001), vec2(0.999))).rgb * 0.16;
  refl += texture2D(tRefl, clamp(rv + vec2(rr.x * 0.5, -rr.y), vec2(0.001), vec2(0.999))).rgb * 0.16;
  refl += texture2D(tRefl, clamp(rv + vec2(-rr.x * 0.7, -rr.y * 0.6), vec2(0.001), vec2(0.999))).rgb * 0.16;
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = skyCol(R);
  float planeOk = (1.0 - smoothstep(0.25, 0.9, abs(wp.y - uReflY))) * uReflOn * (1.0 - vSteep) * (1.0 - curtain);
  refl = mix(sky, refl, planeOk);
  // haze distant reflections
  refl = mix(refl, sky, (1.0 - smoothstep(0.0, 0.3, R.y)) * 0.25);

  // micro-roughness dims the mirror a little where the surface is broken up
  F *= 1.0 - clamp(rough - 0.3, 0.0, 1.0) * 0.35;
  vec3 col = mix(body, refl, F);
  // brink: polished lip catches the sky in a bright rolling line
  float rim = exp(-pow((fz - 0.04) / 0.07, 2.0)) * chan;
  col += sky * 0.35 * rim;
  // thin falling sheet: light passes through as green-gold
  vec3 thinLight = uSkyAmb * 0.8 + uSunColor * uSunIntensity * 0.1 * max(dot(-V, uSunDir) * 0.5 + 0.5, 0.2);
  col = mix(col, col * 0.7 + vec3(0.07, 0.2, 0.15) * thinLight, curtain * 0.45);

  // ---- sun glints ----
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float nh = max(dot(Nsharp, H), 0.0);
  // kept soft: a few bright points and a gentle sheen rather than a field of sparkles
  float spec = pow(nh, 1400.0) * 26.0 + pow(nh, 160.0) * 1.1 + pow(max(dot(N, H), 0.0), 40.0) * 0.06;
  col += uSunColor * uSunIntensity * spec * sunVis * F * 4.0 * (1.0 - uNight * 0.6);

  // backlit translucency on wave crests / rapids
  float sss = pow(clamp(dot(V, -L + N * 0.5), 0.0, 1.0), 3.0) * (turb + speed * 0.3 + shallow * 0.2);
  col += vec3(0.1, 0.32, 0.22) * uSunColor * uSunIntensity * sss * sunVis * 0.06;

  // ---- foam ----
  float foamAmt = (st.b + turb * 0.45 * (1.0 - u * u)) * (1.0 - brink * 0.9) + foot * 0.45;
  foamAmt += smoothstep(0.12, 0.0, vdepth) * smoothstep(0.4, 1.2, speed) * 0.6;
  // rafts of foam drifting off the plunge pool
  foamAmt += poolAg * smoothstep(0.42, 0.75, texture2D(uNoise, q * 0.21 + vec2(0.0, -uTime * 0.09)).r + texture2D(uNoise, q * 0.6 - vec2(0.0, uTime * 0.2)).g * 0.25) * 0.75;
  vec2 fo0 = (q - o0 * 1.05), fo1 = (q - o1 * 1.05);
  float fp = mix(texture2D(tDetail, fo0 * 0.45).a, texture2D(tDetail, fo1 * 0.45 + 0.5).a, wgt);
  float fp2 = mix(texture2D(tDetail, fo0 * 1.35 + 0.2).a, texture2D(tDetail, fo1 * 1.35 + 0.7).a, wgt);
  float pat = fp * 0.6 + fp2 * 0.4;
  float th = 1.0 - clamp(foamAmt, 0.0, 1.6) * 0.55;
  float foam = smoothstep(th, th + 0.2, pat);
  // waterfall aeration: white ropes that thicken as the jet falls, glassy gaps between
  float s1 = texture2D(uNoise, vec2(vSim.x * 0.85, wp.y * 0.16 + uTime * 1.5)).b;
  float s2 = texture2D(uNoise, vec2(vSim.x * 2.2 + 0.31, wp.y * 0.33 + uTime * 2.3)).g;
  float s3 = texture2D(uNoise, vec2(vSim.x * 5.0 + 0.7, wp.y * 0.7 + uTime * 3.1)).b;
  float streak = s1 * 0.5 + s2 * 0.32 + s3 * 0.18;
  float cov = mix(0.04, 0.78, pow(fallT, 1.3)) + smoothstep(0.6, 0.95, u) * 0.3;
  float aer = smoothstep(1.0 - cov, 1.0 - cov + 0.22, streak) * (0.75 + 0.25 * s3);
  foam = mix(foam, aer, curtain);
  // dense churn: bubbly, broken texture rather than flat white
  float churn = smoothstep(1.0, 2.6, foamAmt);
  float bub = texture2D(tDetail, fo0 * 2.6 + 0.3).a * 0.5 + texture2D(tDetail, fo1 * 3.4 + 0.8).a * 0.5;
  foam = max(foam, churn * smoothstep(0.25, 0.65, bub + churn * 0.25) * (1.0 - curtain));
  // boils at the foot: domes of upwelling white water
  float boil = texture2D(tDetail, (q - vec2(0.0, uTime * 0.45)) * 0.8).a * 0.6 + texture2D(uNoise, q * 0.6 - vec2(0.0, uTime * 0.12)).r * 0.4;
  float footK = foot * (1.0 - smoothstep(0.0, 1.0, (fz - 1.0) * WFLEN));
  foam = max(foam, smoothstep(0.62 - footK * 0.45, 0.8 - footK * 0.3, boil) * foot * 0.9);
  foam = clamp(foam, 0.0, 1.0);
  vec3 foamLight = uSunColor * uSunIntensity * (0.35 + 0.65 * max(dot(N, L), 0.0)) * sunVis * 0.32 + uSkyAmb * 1.05;
  vec3 foamCol = vec3(0.92, 0.95, 0.96) * foamLight;
  // bubbly sub-surface tint around foam
  col = mix(col, col * 0.8 + foamLight * vec3(0.12, 0.2, 0.19), smoothstep(0.1, 0.7, foamAmt) * 0.35);
  col = mix(col, foamCol, foam * 0.92);


  col = applyFog(col, cameraPosition, wp, uSunDir);
  float alpha = smoothstep(0.0, 0.06, vdepth);
  // the falling sheet itself is drawn by the waterfall chutes
  alpha *= 1.0 - curtain;
  // no water sheet hanging beside the channel where the ribbon steps down
  alpha *= 1.0 - smoothstep(-0.15, 0.0, fz) * (1.0 - smoothstep(1.0, 1.4, fz)) * max(smoothstep(0.95, 1.1, u), gap);
  alpha = max(alpha, foam * smoothstep(0.0, 0.02, vdepth) * (1.0 - curtain));
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col, alpha);
}`;

export class Water {
  constructor(renderer, rocks) {
    this.renderer = renderer;
    this.rocks = rocks;
    this.drops = [];
    this.time = 0;
    this.simAcc = 0;
    this.buildFlow();
    this.buildSim();
    this.buildMesh();
    this.buildReflection();
  }

  // ---------- flow field ----------
  buildFlow() {
    const FW = this.FW = 128, FH = this.FH = 1376;
    this.flowHalf = new Uint16Array(FW * FH * 4);
    this.flowTex = new THREE.DataTexture(this.flowHalf, FW, FH, THREE.RGBAFormat, THREE.HalfFloatType);
    this.flowTex.magFilter = THREE.LinearFilter; this.flowTex.minFilter = THREE.LinearFilter;
    this.flowTex.wrapS = this.flowTex.wrapT = THREE.ClampToEdgeWrapping;
    this.computeFlowRows(0, FH);
  }

  // re-solve the flow where rocks have been moved (an obstacle reaches ~12 m up and down stream)
  refreshFlow(zA, zB) {
    const j0 = Math.floor((Math.min(zA, zB) - 12 - SIM.z0) / SIM.dZ * this.FH);
    const j1 = Math.ceil((Math.max(zA, zB) + 12 - SIM.z0) / SIM.dZ * this.FH);
    this.computeFlowRows(clamp(j0, 0, this.FH), clamp(j1, 0, this.FH));
  }

  computeFlowRows(j0, j1) {
    const FW = this.FW, FH = this.FH, out = this.flowHalf, toHalf = THREE.DataUtils.toHalfFloat;
    // emergent / shallow rocks in the stream as obstacles
    const obs = [];
    for (const rk of this.rocks) {
      if (!rk.stream || rk.moving) continue;
      const R = rockWaterRadius(rk);
      const k = Math.sqrt(1 + streamSlope(rk.z) ** 2);
      const lat = (rk.x - streamCenter(rk.z)) / k;
      obs.push({ lat, z: rk.z, R, sub: R < 0 ? -R : 0 });
    }
    const buckets = new Map();
    for (const o of obs) { const b = Math.floor(o.z / 4); if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(o); }
    for (let j = j0; j < j1; j++) {
      const z = SIM.z0 + (j + 0.5) / FH * SIM.dZ;
      const hw = streamHalfW(z), spd0 = streamSpeed(z), wl = waterLevel(z), c = streamCenter(z), k = Math.sqrt(1 + streamSlope(z) ** 2);
      const turb = streamTurb(z);
      const near = [];
      for (let b = Math.floor(z / 4) - 3; b <= Math.floor(z / 4) + 2; b++) if (buckets.has(b)) near.push(...buckets.get(b));
      for (let i = 0; i < FW; i++) {
        const lat = SIM.latMin + (i + 0.5) / FW * SIM.dLat;
        const u = Math.abs(lat) / hw;
        const x = c + lat * k;
        const ground = groundAt(x, z);
        const depth = wl - ground;
        let U0 = spd0 * Math.max(0, 1 - u * u) * 1.15 * smoothstep(0.0, 0.25, depth);
        let vz = U0, vl = 0, mask = depth < 0.0 ? 1 : 0, foam = 0;
        for (const o of near) {
          const a = z - o.z, bb = lat - o.lat;
          const r2 = a * a + bb * bb;
          if (o.R > 0) {
            const R = o.R, R2 = R * R;
            if (r2 < R2) { mask = 1; vz = 0; vl = 0; continue; }
            if (r2 > R2 * 36) continue;
            const r4 = r2 * r2;
            vz += U0 * (-R2 * (a * a - bb * bb) / r4);
            vl += U0 * (-R2 * 2 * a * bb / r4);
            const r = Math.sqrt(r2);
            if (a > 0) {
              const wake = Math.exp(-a / (5 * R)) * Math.exp(-((bb / (R * 1.1)) ** 2));
              vz *= 1 - 0.65 * wake;
              vl += Math.sin(a * 2.2 / R) * wake * U0 * 0.25; // eddies
            }
            foam += smoothstep(R + 0.45, R, r) * Math.min(U0, 2) * (a < 0 ? 1.6 : 0.9);
          } else if (o.sub < 0.35) {
            const R = 0.8; const r = Math.sqrt(r2);
            foam += smoothstep(R, 0.2, r) * Math.min(U0, 2) * (0.35 - o.sub) * 1.5;
          }
        }
        if (depth > 0 && depth < 0.16) foam += smoothstep(0.4, 1.2, U0) * 0.5;
        foam += turb * 0.55 * Math.max(0, 1 - u * u);
        const o = (j * FW + i) * 4;
        out[o] = toHalf(vl); out[o + 1] = toHalf(vz); out[o + 2] = toHalf(mask); out[o + 3] = toHalf(foam);
      }
    }
    this.flowTex.needsUpdate = true;
  }

  // ---------- simulation ----------
  buildSim() {
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.simA = new THREE.WebGLRenderTarget(SIM.W, SIM.H, opt);
    this.simB = new THREE.WebGLRenderTarget(SIM.W, SIM.H, opt);
    const drops = Array.from({ length: 24 }, () => new THREE.Vector4());
    this.simMat = new THREE.ShaderMaterial({
      vertexShader: fsVert, fragmentShader: simFrag,
      uniforms: {
        tState: { value: null }, tFlow: { value: this.flowTex }, uTexel: { value: new THREE.Vector2(1 / SIM.W, 1 / SIM.H) },
        uDt: { value: 1 / 60 }, uDomain: { value: new THREE.Vector2(SIM.dLat, SIM.dZ) }, uOrigin: { value: new THREE.Vector2(SIM.latMin, SIM.z0) },
        uDrops: { value: drops }, uDropCount: { value: 0 }, uRain: { value: 0 }, uSeed: { value: 0 },
        uC2: { value: Math.pow(1.5 * (1 / 60) / SIM.cell, 2) }, uTime: U.uTime,
      },
      depthTest: false, depthWrite: false,
    });
    this.simScene = new THREE.Scene();
    this.simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    this.simQuad.frustumCulled = false;
    this.simScene.add(this.simQuad);
    this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // clear
    const r = this.renderer;
    r.setRenderTarget(this.simA); r.setClearColor(0x000000, 0); r.clear();
    r.setRenderTarget(this.simB); r.clear();
    r.setRenderTarget(null);
  }

  stepSim(dt) {
    const r = this.renderer;
    const m = this.simMat.uniforms;
    const n = Math.min(this.drops.length, 24);
    for (let i = 0; i < n; i++) m.uDrops.value[i].copy(this.drops[i]);
    m.uDropCount.value = n;
    this.drops.splice(0, n);
    m.tState.value = this.simA.texture;
    m.uDt.value = dt;
    m.uRain.value = U.uRain.value;
    m.uSeed.value = Math.random() * 1000;
    r.setRenderTarget(this.simB);
    r.render(this.simScene, this.simCam);
    const t = this.simA; this.simA = this.simB; this.simB = t;
  }

  // world-space disturbance. strength ~ metres of depression (0.02 small, 0.2 big splash)
  disturb(x, z, radius = 0.4, strength = 0.06) {
    const k = Math.sqrt(1 + streamSlope(z) ** 2);
    const lat = (x - streamCenter(z)) / k;
    if (this.drops.length > 60) return;
    this.drops.push(new THREE.Vector4(lat, z, radius, strength));
  }

  // ---------- mesh ----------
  buildMesh() {
    // z samples: dense around the waterfall
    const zs = [];
    let z = -260;
    while (z < 260) {
      zs.push(z);
      const nearFall = Math.abs(z - (WF_Z + 0.6)) < 2.5;
      z += nearFall ? 0.08 : (Math.abs(z) < 160 ? 0.4 : 1.2);
    }
    const cols = 34;
    const pos = [], sim = [], steep = [], nor = [];
    const fall = [];
    // the brink isn't a ruler line: shift the fall profile per lateral position
    const wob = (lat) => 0.14 * Math.sin(lat * 2.1 + 0.7) + 0.07 * Math.sin(lat * 4.7 + 1.9) + 0.03 * Math.sin(lat * 9.3);
    for (const zz of zs) {
      const c = streamCenter(zz), hw = streamHalfW(zz), k = Math.sqrt(1 + streamSlope(zz) ** 2);
      const ext = Math.min(hw * 1.55 + 1.6, 14);
      const nearF = Math.exp(-(((zz - WF_Z) / 2.5) ** 2));
      for (let i = 0; i <= cols; i++) {
        const t = i / cols * 2 - 1;
        const lat = Math.sign(t) * Math.pow(Math.abs(t), 1.15) * ext;
        const ze = zz - wob(lat) * nearF;
        const wl = waterLevel(ze);
        const dl = (waterLevel(ze + 0.05) - waterLevel(ze - 0.05)) / 0.1;
        const n = new THREE.Vector3(0, 1, -dl).normalize();
        pos.push(c + lat * k, wl, zz);
        sim.push(lat, zz);
        steep.push(smoothstep(0.35, 1.2, Math.abs(dl)));
        nor.push(n.x, n.y, n.z);
        fall.push((ze - WF_Z) / WF_LEN);
      }
    }
    const idx = [];
    const W = cols + 1;
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < cols; i++) {
      const a = j * W + i, b = a + 1, c2 = a + W, d = c2 + 1;
      idx.push(a, c2, b, c2, d, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSim', new THREE.Float32BufferAttribute(sim, 2));
    geo.setAttribute('aSteep', new THREE.Float32BufferAttribute(steep, 1));
    geo.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 1));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const tex = sharedTextures();
    this.uniforms = {
      tSim: { value: this.simA.texture }, tFlow: { value: this.flowTex }, tDetail: { value: tex.waterNormal },
      tScene: { value: null }, tDepth: { value: null }, tRefl: { value: null },
      tShadow: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 },
      uReflMatrix: { value: new THREE.Matrix4() }, uReflY: { value: 0 }, uReflOn: { value: 1 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) }, uSimTexel: { value: new THREE.Vector2(1 / SIM.W, 1 / SIM.H) },
      uTime: U.uTime, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSunIntensity: U.uSunIntensity, uSkyAmb: U.uSkyAmb,
      uZenith: U.uZenith, uHorizon: U.uHorizon, uNoise: U.uNoise, uWind: U.uWind, uRain: U.uRain, uNight: U.uNight, uSnow: U.uSnow,
      uProfile: U.uProfile, tChuteCov: { value: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) },
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogHeight: U.uFogHeight,
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: waterVert, fragmentShader: waterFrag, uniforms: this.uniforms,
      transparent: true, depthWrite: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  // ---------- reflection ----------
  buildReflection() {
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(0);
    this.reflRT = null;
    this.reflScale = 0.5;
  }

  setSize(w, h) {
    if (this.reflRT) this.reflRT.dispose();
    this.reflRT = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w * this.reflScale)), Math.max(1, Math.floor(h * this.reflScale)), { type: THREE.HalfFloatType, samples: 0 });
    this.uniforms.uResolution.value.set(w, h);
  }

  renderReflection(scene, camera, focusZ, planeY = waterLevel(focusZ)) {
    const r = this.renderer;
    this.uniforms.uReflY.value = planeY;
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < planeY + 0.05) { this.uniforms.uReflOn.value = 0; return; }
    this.uniforms.uReflOn.value = 1;
    const normal = new THREE.Vector3(0, 1, 0);
    const planePos = new THREE.Vector3(camPos.x, planeY, camPos.z);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const view = new THREE.Vector3().subVectors(planePos, camPos).reflect(normal).negate().add(planePos);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(planePos, look).reflect(normal).negate().add(planePos);
    const rc = this.reflCam;
    rc.position.copy(view);
    rc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    rc.lookAt(target);
    rc.near = camera.near; rc.far = camera.far;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    const tm = this.uniforms.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique clip
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, planeY - 0.05, 0));
    plane.applyMatrix4(rc.matrixWorldInverse);
    const cp = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = rc.projectionMatrix;
    const qv = new THREE.Vector4(
      (Math.sign(cp.x) + pm.elements[8]) / pm.elements[0],
      (Math.sign(cp.y) + pm.elements[9]) / pm.elements[5],
      -1, (1 + pm.elements[10]) / pm.elements[14]);
    cp.multiplyScalar(2 / cp.dot(qv));
    pm.elements[2] = cp.x; pm.elements[6] = cp.y; pm.elements[10] = cp.z + 1; pm.elements[14] = cp.w;
    rc.projectionMatrixInverse.copy(pm).invert();
    r.setRenderTarget(this.reflRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, rc);
  }

  update(dt) {
    this.simAcc += dt;
    const step = 1 / 60;
    let n = 0;
    while (this.simAcc >= step && n < 3) { this.stepSim(step); this.simAcc -= step; n++; }
    if (this.simAcc > step * 3) this.simAcc = 0;
    this.uniforms.tSim.value = this.simA.texture;
  }

  bindFrame(pipeline, camera, sunLight) {
    const u = this.uniforms;
    u.tScene.value = pipeline.rtScene.texture;
    u.tDepth.value = pipeline.rtScene.depthTexture;
    u.tRefl.value = this.reflRT.texture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    const sm = sunLight.shadow.map;
    if (sm && sm.depthTexture) {
      u.tShadow.value = sm.depthTexture;
      u.uShadowMatrix.value.copy(sunLight.shadow.matrix);
      u.uShadowOn.value = 1;
    } else u.uShadowOn.value = 0;
  }
}
