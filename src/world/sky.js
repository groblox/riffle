// Sky dome (gradient, sun, moon, clouds, stars, milky way) + time of day lighting.
import * as THREE from 'three';
import { U } from '../core/env.js';
import { smoothstep, clamp, lerp } from '../noise.js';

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // at far plane
}`;

const skyFrag = /* glsl */`
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
uniform float uTime, uNight, uCloud, uRain, uSunIntensity;
uniform sampler2D uNoise;
varying vec3 vDir;

float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

float cloudDensity(vec2 p){
  float d = texture2D(uNoise, p*0.9).r * 0.55 + texture2D(uNoise, p*2.3 + 0.3).g * 0.3 + texture2D(uNoise, p*5.7 + 0.7).b * 0.15;
  return d;
}

void main(){
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float hc = max(h, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(hc, 0.42));
  // below horizon: darker haze
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));

  float cosA = dot(dir, uSunDir);
  float sunUp = smoothstep(-0.15, 0.05, uSunDir.y);
  // mie glow
  vec3 glow = uSunColor * (pow(max(cosA, 0.0), 10.0) * 0.35 + pow(max(cosA, 0.0), 120.0) * 1.2) * sunUp;
  // horizon warm band toward sun at low sun
  float lowSun = 1.0 - smoothstep(0.0, 0.45, uSunDir.y);
  glow += uSunColor * pow(max(cosA*0.5+0.5, 0.0), 3.0) * exp(-abs(h)*7.0) * 0.45 * lowSun * sunUp;
  col += glow;
  // sun disk
  float disk = smoothstep(0.99955, 0.99975, cosA);
  col += uSunColor * disk * 60.0 * sunUp * (1.0 - uCloud*0.6);

  // stars & milky way
  if (uNight > 0.01) {
    vec3 sp = dir * 420.0;
    vec3 cell = floor(sp);
    float s = hash13(cell);
    vec3 cp = fract(sp) - 0.5;
    float star = smoothstep(0.996, 1.0, s) * smoothstep(0.35, 0.0, length(cp));
    float tw = 0.6 + 0.4 * sin(uTime * (2.0 + s * 9.0) + s * 40.0);
    vec3 starCol = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 7.0));
    vec3 mwN = normalize(vec3(0.35, 0.25, 0.9));
    float band = exp(-pow(dot(dir, mwN) * 4.2, 2.0));
    vec2 mwuv = vec2(atan(dir.x, dir.z), dir.y) * 0.6;
    float mw = band * (texture2D(uNoise, mwuv * 0.8).r * 0.6 + texture2D(uNoise, mwuv * 2.5).g * 0.4);
    float dust = smoothstep(0.45, 0.75, texture2D(uNoise, mwuv * 1.7 + 0.3).r) * band;
    vec3 night = starCol * star * tw * 3.0 + vec3(0.55, 0.58, 0.75) * mw * 0.11 * (1.0 - dust * 0.8);
    // fine star dust
    float fine = smoothstep(0.985, 1.0, hash13(floor(dir * 1400.0))) * (0.3 + band);
    night += vec3(0.7, 0.75, 0.9) * fine * 0.5;
    col += night * uNight * smoothstep(-0.05, 0.15, h) * (1.0 - uCloud);
  }
  // moon
  float cosM = dot(dir, uMoonDir);
  float moon = smoothstep(0.99935, 0.99955, cosM);
  vec3 mp = dir - uMoonDir;
  float crater = texture2D(uNoise, mp.xy * 22.0 + 0.5).g;
  col += vec3(0.9, 0.92, 1.0) * moon * (1.6 + crater * 0.8) * uNight;
  col += vec3(0.35, 0.45, 0.7) * pow(max(cosM, 0.0), 40.0) * 0.08 * uNight;

  // clouds
  if (h > -0.02) {
    vec2 cuv = dir.xz / (h + 0.09) * 0.045 + vec2(uTime * 0.0012, uTime * 0.0004);
    float d = cloudDensity(cuv);
    float cov = mix(0.72, 0.38, uCloud);
    float c = smoothstep(cov, cov + 0.22, d);
    float thick = smoothstep(cov, cov + 0.4, d);
    // lighting: sample toward sun
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.02;
    float dl = cloudDensity(cuv + toSun);
    float shade = clamp(1.0 - (dl - d) * 4.0, 0.25, 1.0);
    vec3 lit = uSunColor * (0.5 + 0.9 * pow(max(cosA, 0.0), 4.0)) * shade * sunUp;
    vec3 amb = mix(uHorizon, uZenith, 0.5) * 0.9 + vec3(0.02, 0.025, 0.035) * uNight;
    vec3 cc = amb * (1.0 - thick * 0.45) + lit * (1.0 - thick * 0.5) * 0.85;
    // silver lining
    cc += uSunColor * pow(max(cosA, 0.0), 14.0) * (1.0 - thick) * 1.2 * sunUp;
    cc = mix(cc, cc * 0.35 + vec3(0.04), uRain);
    float fade = smoothstep(-0.02, 0.22, h);
    col = mix(col, cc, c * fade * (0.95));
  }
  col = mix(col, col * 0.45 + vec3(0.06, 0.065, 0.07) * (1.0 - uNight), uRain * 0.85);
  gl_FragColor = vec4(col, 1.0);
}`;

// --- keyframes by sun elevation (y component of sun dir) ---
const C = (r, g, b) => new THREE.Color(r, g, b);
const keys = [
  { e: -0.35, zen: C(0.0025, 0.004, 0.012), hor: C(0.006, 0.01, 0.022), sun: C(0.25, 0.35, 0.6), si: 0.1, fog: C(0.008, 0.012, 0.025), fogS: C(0.02, 0.025, 0.05), amb: C(0.02, 0.03, 0.06), dens: 0.0016 },
  { e: -0.12, zen: C(0.012, 0.022, 0.07), hor: C(0.08, 0.06, 0.09), sun: C(0.3, 0.38, 0.6), si: 0.12, fog: C(0.05, 0.05, 0.08), fogS: C(0.25, 0.12, 0.1), amb: C(0.05, 0.06, 0.1), dens: 0.0022 },
  // the low sun: deep orange at the horizon, gold a few degrees up, warm white by mid-morning. Shadows take
  // a cool blue fill from the open sky while the sun is low.
  { e: -0.02, zen: C(0.05, 0.1, 0.24), hor: C(0.85, 0.38, 0.2), sun: C(1.0, 0.32, 0.1), si: 0.6, fog: C(0.3, 0.22, 0.24), fogS: C(1.0, 0.42, 0.18), amb: C(0.19, 0.19, 0.3), dens: 0.0024 },
  { e: 0.06, zen: C(0.11, 0.22, 0.52), hor: C(1.0, 0.55, 0.3), sun: C(1.0, 0.5, 0.22), si: 2.6, fog: C(0.5, 0.46, 0.52), fogS: C(1.0, 0.58, 0.3), amb: C(0.31, 0.37, 0.58), dens: 0.0019 },
  { e: 0.15, zen: C(0.13, 0.28, 0.68), hor: C(0.92, 0.7, 0.52), sun: C(1.0, 0.7, 0.44), si: 3.7, fog: C(0.58, 0.6, 0.68), fogS: C(1.0, 0.74, 0.48), amb: C(0.37, 0.45, 0.65), dens: 0.0015 },
  { e: 0.3, zen: C(0.13, 0.32, 0.78), hor: C(0.68, 0.73, 0.82), sun: C(1.0, 0.86, 0.7), si: 4.4, fog: C(0.6, 0.67, 0.78), fogS: C(1.0, 0.88, 0.7), amb: C(0.38, 0.47, 0.64), dens: 0.0012 },
  { e: 0.6, zen: C(0.1, 0.3, 0.8), hor: C(0.58, 0.72, 0.92), sun: C(1.0, 0.96, 0.9), si: 5.0, fog: C(0.62, 0.72, 0.88), fogS: C(1.0, 0.95, 0.85), amb: C(0.4, 0.5, 0.7), dens: 0.001 },
  { e: 1.0, zen: C(0.09, 0.28, 0.78), hor: C(0.55, 0.7, 0.92), sun: C(1.0, 0.97, 0.93), si: 5.2, fog: C(0.62, 0.72, 0.9), fogS: C(1.0, 0.96, 0.88), amb: C(0.4, 0.5, 0.72), dens: 0.001 },
];
function sampleKeys(e) {
  let i = 0;
  while (i < keys.length - 2 && e > keys[i + 1].e) i++;
  const a = keys[i], b = keys[i + 1];
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
  const s = t * t * (3 - 2 * t);
  const out = {};
  for (const k of ['zen', 'hor', 'sun', 'fog', 'fogS', 'amb']) out[k] = a[k].clone().lerp(b[k], s);
  out.si = lerp(a.si, b.si, s); out.dens = lerp(a.dens, b.dens, s);
  return out;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uZenith: U.uZenith, uHorizon: U.uHorizon, uSunDir: U.uSunDir, uSunColor: U.uSunColor, uTime: U.uTime,
      uNight: U.uNight, uCloud: U.uCloud, uRain: U.uRain, uNoise: U.uNoise, uSunIntensity: U.uSunIntensity,
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    };
    const geo = new THREE.SphereGeometry(4500, 48, 24);
    this.mat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    const sc = this.sun.shadow.camera;
    sc.near = 1; sc.far = 500; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
    scene.add(this.sun); scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x8899bb, 0x443322, 1.0);
    scene.add(this.hemi);

    this.time = 15.4;       // hours
    this.timeSpeed = 1 / 50; // hours per second (full day ~20 min)
    this.paused = false;
    this.cloudTarget = 0.3;
    this.rainTarget = 0;
    this.shadowRadius = 60;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.state = sampleKeys(0.3);
  }

  setShadowQuality(size, radius = 2) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.radius = radius;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  update(dt, focus, viewRadius) {
    if (!this.paused) this.time = (this.time + dt * this.timeSpeed) % 24;
    const a = (this.time - 6) / 12 * Math.PI; // 0 at sunrise, PI at sunset
    const sd = this.sunDir.set(Math.cos(a), Math.sin(a) * 0.88, -Math.sin(a) * 0.42 - 0.18).normalize();
    const md = this.moonDir.set(-Math.cos(a) * 0.8, -Math.sin(a) * 0.75 + 0.1, 0.35).normalize();
    this.uniforms.uMoonDir.value.copy(md);

    const st = sampleKeys(sd.y);
    // mornings and evenings differ: dawn light is paler and rosier, through cool clean air; evening light
    // is a deeper, richer gold through the day's dust
    const low = smoothstep(-0.1, 0.02, sd.y) * (1 - smoothstep(0.12, 0.36, sd.y));
    if (this.time < 12) {
      st.sun.lerp(C(1.0, 0.8, 0.62), 0.28 * low); st.hor.lerp(C(0.98, 0.7, 0.62), 0.32 * low);
      st.fog.lerp(C(0.64, 0.64, 0.72), 0.35 * low); st.fogS.lerp(C(1.0, 0.8, 0.64), 0.35 * low);
    } else {
      st.sun.lerp(C(1.0, 0.56, 0.28), 0.12 * low); st.hor.lerp(C(1.0, 0.5, 0.3), 0.22 * low); st.fogS.lerp(C(1.0, 0.55, 0.28), 0.25 * low);
    }
    this.state = st;
    // weather
    U.uCloud.value += (this.cloudTarget - U.uCloud.value) * Math.min(1, dt * 0.25);
    U.uRain.value += (this.rainTarget - U.uRain.value) * Math.min(1, dt * 0.2);
    U.uWet.value += ((U.uRain.value > 0.2 ? 1 : 0) - U.uWet.value) * Math.min(1, dt * (U.uRain.value > 0.2 ? 0.1 : 0.02));
    const overcast = Math.max(U.uCloud.value - 0.4, 0) / 0.6 * 0.6 + U.uRain.value * 0.5;

    const night = 1 - smoothstep(-0.2, 0.0, sd.y);
    U.uNight.value = night;
    U.uZenith.value.copy(st.zen);
    U.uHorizon.value.copy(st.hor);
    const grey = (c, k) => { const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15; c.lerp(new THREE.Color(l, l, l * 1.05), k); };
    grey(U.uZenith.value, overcast * 0.8); grey(U.uHorizon.value, overcast * 0.6);
    U.uSunColor.value.copy(st.sun);

    // Directional light: sun by day, moon by night
    const useMoon = sd.y < -0.06;
    const ld = useMoon ? md : sd;
    const lightDir = new THREE.Vector3().copy(ld);
    if (lightDir.y < 0.06) { lightDir.y = 0.06; lightDir.normalize(); }
    U.uSunDir.value.copy(useMoon ? lightDir : sd);
    const dimByCloud = 1 - overcast * 0.75;
    if (useMoon) {
      this.sun.color.setRGB(0.55, 0.65, 1.0);
      this.sun.intensity = 0.35 * smoothstep(-0.06, -0.2, sd.y) * dimByCloud;
    } else {
      this.sun.color.copy(st.sun);
      this.sun.intensity = st.si * smoothstep(-0.06, 0.03, sd.y) * dimByCloud;
    }
    U.uSunIntensity.value = this.sun.intensity;
    this.hemi.color.copy(st.amb).multiplyScalar(1 + overcast * 0.5);
    this.hemi.groundColor.copy(st.amb).multiply(new THREE.Color(0.55, 0.42, 0.32));
    this.hemi.intensity = Math.PI * 0.75;
    U.uSkyAmb.value.copy(st.amb);
    U.uFogColor.value.copy(st.fog); grey(U.uFogColor.value, overcast * 0.6);
    U.uFogSunColor.value.copy(st.fogS); grey(U.uFogSunColor.value, overcast * 0.8);
    // morning mist
    const morning = smoothstep(4.5, 6.5, this.time) * (1 - smoothstep(7.5, 10, this.time));
    U.uFogDensity.value = st.dens * 0.45 * (1 + morning * 1.1 + U.uRain.value * 2.5);
    U.uFogHeight.value = 0.012 + morning * 0.05;

    // follow focus with shadow camera, snapped to texels
    const r = clamp(viewRadius, 30, 110);
    if (Math.abs(r - this.shadowRadius) > 4) {
      this.shadowRadius = r;
      const sc = this.sun.shadow.camera;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.updateProjectionMatrix();
    }
    const texel = (this.shadowRadius * 2) / this.sun.shadow.mapSize.x;
    // snap in light space
    const lightZ = lightDir.clone();
    const lightX = new THREE.Vector3(0, 1, 0).cross(lightZ).normalize();
    const lightY = lightZ.clone().cross(lightX);
    const px = Math.round(focus.dot(lightX) / texel) * texel;
    const py = Math.round(focus.dot(lightY) / texel) * texel;
    const pz = focus.dot(lightZ);
    const snapped = new THREE.Vector3().addScaledVector(lightX, px).addScaledVector(lightY, py).addScaledVector(lightZ, pz);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(lightDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  follow(camPos) { this.mesh.position.copy(camPos); }
}
