// Render pipeline:
//  1) opaque scene -> rtScene (HDR, MSAA, depth texture)
//  1b) screen-space ambient occlusion from the depth buffer (+ bilateral blur), optional
//  2) composite rtScene colour+depth (with AO and aerial fog) -> rtMain, writing depth
//  3) water + transparents -> rtMain (water samples rtScene for refraction)
//  4) bloom chain + light shafts
//  5) final grade/tonemap -> screen
import * as THREE from 'three';
import { U, fogGLSL } from '../core/env.js';

const fsVert = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function fsMaterial(frag, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra });
}

// SSAO: hemisphere samples around each pixel's view-space position, normal rebuilt from depth
const aoFrag = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uRes;
uniform float uRadius;
uniform float uFrame;
varying vec2 vUv;
vec3 viewPos(vec2 uv){
  float d = textureLod(tDepth, uv, 0.0).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d = texture2D(tDepth, vUv).r;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv);
  vec2 px = 1.0 / uRes;
  // normal from the flatter of the two neighbours on each axis (keeps silhouettes clean)
  vec3 pr = viewPos(vUv + vec2(px.x, 0.0)) - P, pl = P - viewPos(vUv - vec2(px.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, px.y)) - P, pd = P - viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl, dy = abs(pu.z) < abs(pd.z) ? pu : pd;
  vec3 N = normalize(cross(dx, dy));
  float dist = -P.z;
  float rad = uRadius * (1.0 + dist * 0.015);
  float rpx = rad * uProj[1][1] * 0.5 * uRes.y / dist;   // radius in pixels
  rpx = clamp(rpx, 2.0, 90.0);
  float rot = ign(gl_FragCoord.xy + uFrame * 5.588) * 6.2831;
  const int NS = SAMPLES;
  float ao = 0.0;
  for (int i = 0; i < NS; i++) {
    float t = (float(i) + 0.5) / float(NS);
    float a = rot + float(i) * 2.39996;
    vec2 off = vec2(cos(a), sin(a)) * rpx * t * t * px;
    vec3 S = viewPos(vUv + off);
    vec3 v = S - P;
    float l = length(v);
    float fall = 1.0 - smoothstep(rad * 0.6, rad * 1.6, l);
    ao += clamp(dot(N, v) / max(l, 1e-3) - 0.22, 0.0, 0.78) * fall;
  }
  ao = clamp(1.0 - ao / float(NS) * 3.2, 0.0, 1.0);
  ao = ao * ao * (3.0 - 2.0 * ao);
  ao = mix(1.0, ao, 1.0 - smoothstep(60.0, 140.0, dist));
  gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
}`;

const aoBlurFrag = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uTexel;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tAO, vUv);
  float z = c.g, sum = c.r, w = 1.0;
  for (int i = 1; i <= 4; i++) {
    for (int sgn = -1; sgn <= 1; sgn += 2) {
      vec4 s = textureLod(tAO, vUv + uDir * uTexel * float(i * sgn) * 1.5, 0.0);
      float k = exp(-abs(s.g - z) / max(z * 0.03, 0.05)) * (1.0 - float(i) * 0.15);
      sum += s.r * k; w += k;
    }
  }
  gl_FragColor = vec4(sum / w, z, 0.0, 1.0);
}`;

const compositeFrag = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tAO;
uniform float uAO;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
${fogGLSL}
varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tColor, vUv).rgb;
  if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, vUv).r, uAO);
  if (d < 1.0) {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc; vp /= vp.w;
    vec3 wp = (uCamWorld * vp).xyz;
    c = applyFog(c, uCamPos, wp, uSunDir);
  }
  gl_FragColor = vec4(c, 1.0);
  gl_FragDepth = d;
}`;

const brightFrag = /* glsl */`
uniform sampler2D tColor;
uniform float uThreshold;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec3 c = vec3(0.0);
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  c = min(c, vec3(60.0));
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThreshold * 0.6, uThreshold * 1.6, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const downFrag = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv).rgb * 0.5;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0, -1.0)).rgb * 0.125;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0,  1.0)).rgb * 0.125;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0,  1.0)).rgb * 0.125;
  gl_FragColor = vec4(c, 1.0);
}`;

const upFrag = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
void main(){
  vec3 c = vec3(0.0);
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2( 0.0, -1.0)).rgb * 2.0;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0,  0.0)).rgb * 2.0;
  c += texture2D(tColor, vUv).rgb * 4.0;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0,  0.0)).rgb * 2.0;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  c += texture2D(tColor, vUv + uTexel * vec2( 0.0,  1.0)).rgb * 2.0;
  c += texture2D(tColor, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c /= 16.0;
  gl_FragColor = vec4(texture2D(tPrev, vUv).rgb + c * uWeight, 1.0);
}`;

// Light shafts: radial blur of the sky mask toward the sun
const shaftMaskFrag = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uAspect;
varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tColor, vUv).rgb;
  float sky = step(0.99999, d);
  vec2 dv = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float fall = exp(-dot(dv, dv) * 6.0);
  gl_FragColor = vec4(min(c, vec3(8.0)) * sky * fall, 1.0);
}`;
const shaftBlurFrag = /* glsl */`
uniform sampler2D tColor;
uniform vec2 uSunUv;
uniform float uStep;
varying vec2 vUv;
void main(){
  vec2 dir = (uSunUv - vUv) * uStep;
  vec3 acc = vec3(0.0);
  vec2 uv = vUv;
  float w = 1.0, tw = 0.0;
  for (int i = 0; i < 24; i++){
    acc += texture2D(tColor, uv).rgb * w;
    tw += w;
    w *= 0.955;
    uv += dir;
  }
  gl_FragColor = vec4(acc / tw, 1.0);
}`;

const finalFrag = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tShafts;
uniform sampler2D tDepth;
uniform float uExposure;
uniform float uBloom;
uniform float uShafts;
uniform float uTime;
uniform float uSaturation;
uniform vec3 uTint;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform vec2 uResolution;
uniform float uVignette;
uniform float uFade;
varying vec2 vUv;

vec3 ACES(vec3 x){
  // Narkowicz fit with a touch of shoulder softening
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = vUv;
  // subtle chromatic aberration toward edges
  vec2 cdir = (uv - 0.5);
  float ca = dot(cdir, cdir) * 0.0025;
  vec3 c;
  c.r = texture2D(tColor, uv + cdir * ca).r;
  c.g = texture2D(tColor, uv).g;
  c.b = texture2D(tColor, uv - cdir * ca).b;
  c += texture2D(tBloom, uv).rgb * uBloom;
  c += texture2D(tShafts, uv).rgb * uShafts;
  c *= uExposure;
  c *= uTint;
  // filmic
  c = ACES(c);
  // saturation & gentle S-curve (the "animated" pop)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = clamp(c, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
  // split tone (set by the time of day): warm where the low sun lights things, cool sky-fill in the shadows
  float lt = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadowTint, uHighTint, smoothstep(0.04, 0.55, lt));
  // vignette
  vec2 vv = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  c *= mix(1.0, smoothstep(1.25, 0.25, length(vv)), uVignette);
  c = toSRGB(c);
  // grain + dither
  float g = hash(uv * uResolution + fract(uTime * 7.13) * 100.0) - 0.5;
  c += g * 0.018;
  c *= uFade;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.msaa = 4;
    this.bloomLevels = 6;

    this.compositeMat = fsMaterial(compositeFrag, {
      tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uSunDir: U.uSunDir, tAO: { value: null }, uAO: { value: 0 },
      uFogColor: U.uFogColor, uFogSunColor: U.uFogSunColor, uFogDensity: U.uFogDensity, uFogHeight: U.uFogHeight,
    }, { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth });
    this.brightMat = fsMaterial(brightFrag, { tColor: { value: null }, uThreshold: { value: 1.6 }, uTexel: { value: new THREE.Vector2() } });
    this.downMat = fsMaterial(downFrag, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = fsMaterial(upFrag, { tColor: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } });
    this.shaftMaskMat = fsMaterial(shaftMaskFrag, { tColor: { value: null }, tDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.shaftBlurMat = fsMaterial(shaftBlurFrag, { tColor: { value: null }, uSunUv: { value: new THREE.Vector2() }, uStep: { value: 0.03 } });
    this.finalMat = fsMaterial(finalFrag, {
      tColor: { value: null }, tBloom: { value: null }, tShafts: { value: null }, tDepth: { value: null },
      uExposure: { value: 1 }, uBloom: { value: 0.06 }, uShafts: { value: 0.0 }, uTime: U.uTime, uSaturation: { value: 1.2 },
      uTint: { value: new THREE.Vector3(1, 1, 1) }, uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) }, uResolution: { value: new THREE.Vector2() }, uVignette: { value: 0.35 }, uFade: { value: 1 },
    });
    this.exposure = 1;
    this.ao = { on: false, scale: 0.5, samples: 12, strength: 0.85, radius: 0.9 };
    this.aoFrame = 0;
    this.blackCopyMat = fsMaterial(`uniform sampler2D tColor; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tColor, vUv); }`, { tColor: { value: null } });
    this.w = 0; this.h = 0;
  }

  setSize(w, h, msaa = 4) {
    this.w = w; this.h = h; this.msaa = msaa;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    const dispose = (rt) => { if (rt) { rt.dispose(); if (rt.depthTexture) rt.depthTexture.dispose(); } };
    dispose(this.rtScene); dispose(this.rtMain);
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { ...opt, samples: msaa });
    this.rtScene.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    this.rtMain = new THREE.WebGLRenderTarget(w, h, { ...opt, samples: 0 });
    this.rtMain.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    // ambient occlusion targets
    dispose(this.rtAO); dispose(this.rtAO2);
    this.rtAO = this.rtAO2 = null;
    if (this.ao.on) {
      const aw = Math.max(1, Math.round(w * this.ao.scale)), ah = Math.max(1, Math.round(h * this.ao.scale));
      const ao = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      this.rtAO = new THREE.WebGLRenderTarget(aw, ah, ao);
      this.rtAO2 = new THREE.WebGLRenderTarget(aw, ah, ao);
      if (this.aoMat) this.aoMat.dispose();
      this.aoMat = fsMaterial(aoFrag, {
        tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(aw, ah) }, uRadius: { value: this.ao.radius }, uFrame: { value: 0 },
      }, { defines: { SAMPLES: this.ao.samples } });
      this.aoBlurMat = this.aoBlurMat || fsMaterial(aoBlurFrag, { tAO: { value: null }, uTexel: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2() } });
    }
    // bloom chain
    if (this.bloomDown) for (const rt of [...this.bloomDown, ...this.bloomUp]) rt.dispose();
    this.bloomDown = []; this.bloomUp = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < this.bloomLevels; i++) {
      this.bloomDown.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      this.bloomUp.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    dispose(this.rtShaftA); dispose(this.rtShaftB);
    const sw = Math.max(1, w >> 2), sh = Math.max(1, h >> 2);
    this.rtShaftA = new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtShaftB = new THREE.WebGLRenderTarget(sw, sh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.finalMat.uniforms.uResolution.value.set(w, h);
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, overlayScene, camera, hooks = {}) {
    const r = this.renderer;
    r.autoClear = false;
    // 1) opaque
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, camera);

    // 1b) ambient occlusion
    const cm = this.compositeMat.uniforms;
    if (this.ao.on && this.rtAO) {
      const am = this.aoMat.uniforms;
      am.tDepth.value = this.rtScene.depthTexture;
      am.uProj.value.copy(camera.projectionMatrix); am.uInvProj.value.copy(camera.projectionMatrixInverse);
      am.uFrame.value = (this.aoFrame = (this.aoFrame + 1) % 64);
      this.pass(this.aoMat, this.rtAO);
      const bm = this.aoBlurMat.uniforms;
      bm.uTexel.value.set(1 / this.rtAO.width, 1 / this.rtAO.height);
      bm.tAO.value = this.rtAO.texture; bm.uDir.value.set(1, 0); this.pass(this.aoBlurMat, this.rtAO2);
      bm.tAO.value = this.rtAO2.texture; bm.uDir.value.set(0, 1); this.pass(this.aoBlurMat, this.rtAO);
      cm.tAO.value = this.rtAO.texture; cm.uAO.value = this.ao.strength;
    } else cm.uAO.value = 0;

    // 2) composite with fog -> rtMain (writes depth)
    cm.tColor.value = this.rtScene.texture; cm.tDepth.value = this.rtScene.depthTexture;
    cm.uInvProj.value.copy(camera.projectionMatrixInverse);
    cm.uCamWorld.value.copy(camera.matrixWorld);
    cm.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    r.setRenderTarget(this.rtMain);
    r.clear(true, true, true);
    this.quad.material = this.compositeMat;
    r.render(this.quadScene, this.quadCam);

    // 3) water + transparents
    if (hooks.beforeOverlay) hooks.beforeOverlay(this);
    r.setRenderTarget(this.rtMain);
    r.render(overlayScene, camera);

    // 4) bloom
    const bm = this.brightMat.uniforms;
    bm.tColor.value = this.rtMain.texture; bm.uTexel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.brightMat, this.bloomDown[0]);
    for (let i = 1; i < this.bloomLevels; i++) {
      const src = this.bloomDown[i - 1];
      this.downMat.uniforms.tColor.value = src.texture;
      this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.downMat, this.bloomDown[i]);
    }
    // upsample: up[i] = down[i] + blur(up[i+1])
    let prev = this.bloomDown[this.bloomLevels - 1];
    for (let i = this.bloomLevels - 2; i >= 0; i--) {
      const um = this.upMat.uniforms;
      um.tColor.value = prev.texture; um.tPrev.value = this.bloomDown[i].texture;
      um.uTexel.value.set(1 / prev.width, 1 / prev.height); um.uWeight.value = 1.0;
      this.pass(this.upMat, this.bloomUp[i]);
      prev = this.bloomUp[i];
    }

    // light shafts
    const sunUv = hooks.sunUv;
    let shafts = 0;
    if (sunUv && sunUv.vis > 0.01) {
      const mm = this.shaftMaskMat.uniforms;
      mm.tColor.value = this.rtMain.texture; mm.tDepth.value = this.rtMain.depthTexture;
      mm.uSunUv.value.set(sunUv.x, sunUv.y); mm.uAspect.value = this.w / this.h;
      this.pass(this.shaftMaskMat, this.rtShaftA);
      const sb = this.shaftBlurMat.uniforms;
      sb.uSunUv.value.set(sunUv.x, sunUv.y);
      sb.tColor.value = this.rtShaftA.texture; sb.uStep.value = 0.035; this.pass(this.shaftBlurMat, this.rtShaftB);
      sb.tColor.value = this.rtShaftB.texture; sb.uStep.value = 0.012; this.pass(this.shaftBlurMat, this.rtShaftA);
      shafts = sunUv.vis;
    }

    // 5) final
    const fm = this.finalMat.uniforms;
    fm.tColor.value = this.rtMain.texture; fm.tBloom.value = this.bloomUp[0].texture;
    fm.tShafts.value = this.rtShaftA.texture; fm.uShafts.value = shafts * 0.35;
    fm.tDepth.value = this.rtMain.depthTexture;
    fm.uExposure.value = this.exposure;
    this.pass(this.finalMat, null);
  }
}
