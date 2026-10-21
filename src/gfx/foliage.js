// Foliage materials (leaf cards, needles, grass, bark) with wind, flutter, shake,
// seasonal colour and shadow-aware translucency. Plus the canvas textures they use.
import * as THREE from 'three';
import { U, commonGLSL, patchMaterial } from '../core/env.js';
import { canvasTexture } from './textures.js';
import { mulberry32 } from '../noise.js';

// ---------- textures ----------
// Channel use: R = brightness, G = per-leaf random (colour pick), B = vein/shade, A = alpha
function leafPath(g, len, wid, kind) {
  g.beginPath();
  if (kind === 'aspen') {
    // round-ish heart with a point
    g.moveTo(0, 0);
    g.bezierCurveTo(wid * 0.9, -len * 0.05, wid * 0.75, -len * 0.85, 0, -len);
    g.bezierCurveTo(-wid * 0.75, -len * 0.85, -wid * 0.9, -len * 0.05, 0, 0);
  } else if (kind === 'willow') {
    g.moveTo(0, 0);
    g.quadraticCurveTo(wid * 0.5, -len * 0.5, 0, -len);
    g.quadraticCurveTo(-wid * 0.5, -len * 0.5, 0, 0);
  } else {
    g.ellipse(0, -len / 2, wid / 2, len / 2, 0, 0, Math.PI * 2);
  }
}

export function makeLeafClusterTexture(kind = 'aspen', seed = 1) {
  const rnd = mulberry32(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // twigs
    g.strokeStyle = 'rgb(60,40,140)'; g.lineWidth = 2.2;
    const tips = [];
    for (let b = 0; b < 5; b++) {
      const sx = w * 0.5 + (rnd() - 0.5) * 30, sy = h * 0.98;
      const ex = w * (0.1 + rnd() * 0.8), ey = h * (0.08 + rnd() * 0.5);
      g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo((sx + ex) / 2 + (rnd() - 0.5) * 60, (sy + ey) / 2, ex, ey); g.stroke();
      for (let k = 0; k < 9; k++) { const t = 0.3 + k / 9 * 0.7; tips.push([sx + (ex - sx) * t + (rnd() - 0.5) * 50, sy + (ey - sy) * t + (rnd() - 0.5) * 40]); }
    }
    const n = kind === 'willow' ? 70 : 52;
    for (let i = 0; i < n; i++) {
      const [x, y] = tips[Math.floor(rnd() * tips.length)];
      const len = kind === 'willow' ? 34 + rnd() * 14 : 26 + rnd() * 12;
      const wid = kind === 'willow' ? 9 + rnd() * 4 : len * (0.85 + rnd() * 0.2);
      g.save(); g.translate(x, y); g.rotate((rnd() - 0.5) * 2.6);
      const br = Math.floor(170 + rnd() * 85), rv = Math.floor(rnd() * 255);
      // stem
      g.strokeStyle = `rgb(${br * 0.6},${rv},120)`; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, 6); g.lineTo(0, 0); g.stroke();
      leafPath(g, len, wid, kind);
      g.fillStyle = `rgb(${br},${rv},230)`; g.fill();
      // midrib & edge shade
      g.strokeStyle = `rgba(${br * 0.8},${rv},150,0.9)`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.9); g.stroke();
      g.restore();
    }
  }, { linear: true });
}

export function makeNeedleTexture(seed = 3) {
  const rnd = mulberry32(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // a drooping branch spray along the texture's v axis (base at bottom)
    const branches = [[w * 0.5, h, w * 0.5, 4]];
    for (let s = 0; s < 9; s++) {
      const t = 0.15 + s / 9 * 0.8; const y = h * (1 - t);
      branches.push([w * 0.5, y, w * 0.5 + (s % 2 ? 1 : -1) * (40 + rnd() * 60) * (1 - t * 0.5), y - 20 - rnd() * 20]);
    }
    for (const [x0, y0, x1, y1] of branches) {
      g.strokeStyle = 'rgb(70,50,90)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const L = Math.hypot(x1 - x0, y1 - y0);
      const nN = Math.floor(L / 2.2);
      for (let i = 0; i < nN; i++) {
        const t = i / nN; const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const ang = Math.atan2(y1 - y0, x1 - x0);
        for (const sgn of [-1, 1]) {
          const a = ang + sgn * (0.9 + rnd() * 0.5);
          const nl = 9 + rnd() * 8 * (1 - t * 0.4);
          const br = Math.floor(150 + rnd() * 105);
          g.strokeStyle = `rgb(${br},${Math.floor(rnd() * 255)},200)`; g.lineWidth = 1.6;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * nl, y + Math.sin(a) * nl); g.stroke();
        }
      }
    }
  }, { linear: true });
}

export function makeScaleSprayTexture(seed = 5, flowers = false) {
  const rnd = mulberry32(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * 118;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.9;
      const br = Math.floor(140 + rnd() * 115);
      g.fillStyle = `rgb(${br},${Math.floor(rnd() * 255)},210)`;
      g.beginPath(); g.ellipse(x, y, 4 + rnd() * 7, 3 + rnd() * 5, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    if (flowers) {
      for (let i = 0; i < 60; i++) {
        const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.5) * 100;
        const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r * 0.8 - 20;
        g.fillStyle = `rgb(255,255,${Math.floor(rnd() * 40)})`; // B low = flower marker
        g.beginPath(); g.arc(x, y, 3 + rnd() * 4, 0, Math.PI * 2); g.fill();
      }
    }
  }, { linear: true });
}

// ---------- shader pieces ----------
const foliageVertHead = /* glsl */`
${commonGLSL}
attribute vec3 aTint;
attribute float aShake;
attribute vec4 aLeaf;    // xyz: card centre (object space), w: phase
varying vec3 vWorldPos;
varying vec3 vTint;
varying float vPhase;
varying float vHeightF;
uniform float uStiff;
uniform float uFlutter;
uniform float uTreeH;
`;

// Shared world-space wind displacement for trees (trunk + leaves use the same so they stay attached)
const treeWindVertex = /* glsl */`
  vec4 mvPosition = vec4(transformed, 1.0);
  vec3 objP = transformed;
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    vec3 basePos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float instScale = length(instanceMatrix[1].xyz);
  #else
    vec3 basePos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float instScale = 1.0;
  #endif
  vec4 wpos = modelMatrix * mvPosition;
  float hgt = max(objP.y, 0.0) * instScale;
  float hf = hgt / max(uTreeH * instScale, 0.1);
  vec2 wdir = windField(basePos, basePos.x * 0.37 + basePos.z * 0.21);
  float bend = hf * hf * uStiff * uTreeH * instScale;
  vec2 disp = wdir * bend;
  // shake when clicked
  disp += vec2(sin(uTime * 13.0 + basePos.x), cos(uTime * 11.0 + basePos.z)) * aShake * hf * hf * 0.35 * instScale;
  // leaf flutter (quaking)
  #ifdef IS_LEAF
    float ph = aLeaf.w * 6.2831;
    float fl = sin(uTime * (9.0 + aLeaf.w * 7.0) + ph) * (0.35 + 0.65 * uWind.z) + sin(uTime * 23.0 + ph * 3.0) * 0.25;
    vec3 fdir = normalize(normal + vec3(0.001));
    wpos.xyz += (mat3(modelMatrix) * fdir) * fl * uFlutter * (0.4 + aShake * 4.0) * instScale;
  #endif
  wpos.xz += disp;
  wpos.y -= dot(disp, disp) * 0.15 / max(hgt, 0.5);
  vWorldPos = wpos.xyz;
  vHeightF = hf;
  mvPosition = viewMatrix * wpos;
  gl_Position = projectionMatrix * mvPosition;
`;

// Translucency: override RE_Direct to add back-lit transmission using shadowed light colour
const translucencyChunk = (k) => /* glsl */`$
uniform float uTransl;
uniform float uTranslK;
void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = pow(clamp(dot(geometryViewDir, -directLight.direction), 0.0, 1.0), 3.0);
  float wrap = clamp(dot(-geometryNormal, directLight.direction) * 0.5 + 0.5, 0.0, 1.0);
  reflectedLight.directDiffuse += material.diffuseColor * directLight.color * (back * 1.6 + wrap * 0.35) * uTransl * uTranslK;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Foliage
`;

/*
  opts: { map, colors: {sA, sB, aA, aB, wA, wB}, flutter, stiff, treeH, deciduous, transl, isLeaf, key }
*/
export function makeFoliageMaterial(opts) {
  const mat = new THREE.MeshStandardMaterial({
    map: opts.map, side: THREE.DoubleSide, roughness: opts.rough ?? 0.75, metalness: 0,
    alphaToCoverage: true,
  });
  const c = opts.colors;
  const uniforms = {
    uStiff: { value: opts.stiff ?? 0.03 }, uFlutter: { value: opts.flutter ?? 0.0 }, uTreeH: { value: opts.treeH ?? 10 },
    uTransl: { value: opts.transl ?? 1.0 }, uTranslK: { value: opts.translK ?? 0.5 },
    uSA: { value: new THREE.Color(...c.sA) }, uSB: { value: new THREE.Color(...c.sB) },
    uAA: { value: new THREE.Color(...c.aA) }, uAB: { value: new THREE.Color(...c.aB) },
    uFlowerCol: { value: new THREE.Color(...(c.flower || [1, 1, 1])) },
    uDecid: { value: opts.deciduous ? 1 : 0 },
  };
  patchMaterial(mat, {
    uniforms,
    vertexHead: (opts.isLeaf ? '#define IS_LEAF\n' : '') + foliageVertHead,
    fragmentHead: /* glsl */`
      ${commonGLSL}
      varying vec3 vWorldPos; varying vec3 vTint; varying float vHeightF;
      uniform vec3 uSA, uSB, uAA, uAB, uFlowerCol; uniform float uDecid;
    `,
    vertex: {
      project_vertex: treeWindVertex + `vTint = aTint;`,
      worldpos_vertex: `vec4 worldPosition = vec4(vWorldPos, 1.0);`,
    },
    fragment: {
      map_fragment: /* glsl */`
        vec4 tx = texture2D(map, vMapUv);
        float pick = tx.g;
        // seasonal leaf drop
        float drop = uDecid * smoothstep(1.0, 1.9, uSeason + hash12(floor(vMapUv * 24.0) + vTint.xy * 13.0) * 0.6);
        if (drop > 0.5) discard;
        float camD = length(vWorldPos - cameraPosition);
        float nearFade = smoothstep(1.2, 5.0, camD);
        float autumn = clamp(uSeason, 0.0, 1.0);
        vec3 cs = mix(uSA, uSB, pick);
        vec3 ca = mix(uAA, uAB, pick);
        vec3 leaf = mix(cs, ca, autumn * mix(1.0, vTint.z, uDecid)) * (0.55 + 0.6 * tx.r);
        // twigs: blue channel low & G marker
        float twig = smoothstep(0.75, 0.55, tx.b);
        leaf = mix(leaf, vec3(0.16, 0.12, 0.09), twig * step(0.5, 1.0 - tx.b) * 0.0 + twig * 0.8);
        // flower markers (blue ~0)
        leaf = mix(leaf, uFlowerCol * (0.8 + 0.3 * tx.r), smoothstep(0.2, 0.05, tx.b) * clamp(uSeason * 1.5, 0.0, 1.0) * (1.0 - clamp(uSeason - 1.0, 0.0, 1.0)));
        leaf *= vec3(vTint.x, vTint.y, 1.0) * mix(0.75, 1.1, vHeightF);
        // snow dusting
        leaf = mix(leaf, vec3(0.9, 0.93, 0.97), snowCover(vWorldPos) * smoothstep(0.2, 0.9, vHeightF) * 0.55 * (1.0 - uDecid));
        diffuseColor.rgb *= leaf;
        float aw = max(fwidth(tx.a) * 0.6, 0.02);
        diffuseColor.a = smoothstep(0.45 - aw, 0.45 + aw, tx.a) * nearFade;
        if (diffuseColor.a < 0.01) discard;
      `,
      lights_physical_pars_fragment: translucencyChunk(0),
      normal_fragment_maps: `normal = normalize(vNormal);`,
    },
  }, 'foliage-leaf');
  return mat;
}

export function makeFoliageDepthMaterial(map, isLeaf, opts = {}) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  patchMaterial(mat, {
    uniforms: { uStiff: { value: opts.stiff ?? 0.03 }, uFlutter: { value: opts.flutter ?? 0 }, uTreeH: { value: opts.treeH ?? 10 } },
    vertexHead: (isLeaf ? '#define IS_LEAF\n' : '') + foliageVertHead.replace('attribute vec3 aTint;', 'attribute vec3 aTint;'),
    vertex: { project_vertex: treeWindVertex },
  }, isLeaf ? 'foliage-depth-leaf' : 'foliage-depth-bark');
  return mat;
}

// Bark: aspen (white with black eyes) or brown furrowed
export function makeBarkMaterial(kind, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, alphaToCoverage: true });
  patchMaterial(mat, {
    uniforms: { uStiff: { value: opts.stiff ?? 0.03 }, uFlutter: { value: 0 }, uTreeH: { value: opts.treeH ?? 10 }, uKind: { value: kind } },
    vertexHead: foliageVertHead + `varying vec3 vObj;`,
    fragmentHead: /* glsl */`
      ${commonGLSL}
      varying vec3 vWorldPos; varying vec3 vTint; varying float vHeightF; varying vec3 vObj;
      uniform float uKind;
    `,
    vertex: { project_vertex: treeWindVertex + `vTint = aTint; vObj = objP;`, worldpos_vertex: `vec4 worldPosition = vec4(vWorldPos, 1.0);` },
    fragment: {
      map_fragment: /* glsl */`
        float camD = length(vWorldPos - cameraPosition);
        diffuseColor.a = smoothstep(0.8, 3.5, camD);
        if (diffuseColor.a < 0.01) discard;
        float ang = atan(vObj.x, vObj.z);
        vec2 buv = vec2(ang * 0.32, vObj.y * 0.55);
        vec4 nb = texture2D(uNoise, buv * vec2(1.0, 0.6) + vTint.xy);
        vec4 nb2 = texture2D(uNoise, buv * 3.0 + vTint.yx);
        vec3 col;
        if (uKind < 0.5) {
          // aspen: chalky cream-white, dark lenticels & branch scars, darker base
          col = mix(vec3(0.78, 0.78, 0.7), vec3(0.9, 0.89, 0.82), nb2.b);
          float eye = smoothstep(0.78, 0.86, nb.r) ;
          float lent = smoothstep(0.72, 0.8, texture2D(uNoise, vec2(ang * 1.2, vObj.y * 6.0) + vTint.xy).b);
          col = mix(col, vec3(0.08, 0.07, 0.06), max(eye, lent * 0.8));
          col = mix(vec3(0.18, 0.16, 0.13), col, smoothstep(0.0, 1.4, vObj.y + nb.g * 0.6));
          col = mix(col, col * vec3(0.85, 0.95, 0.75), smoothstep(0.6, 0.8, nb2.r) * 0.4); // greenish tint patches
        } else if (uKind < 1.5) {
          // conifer: grey-brown furrowed
          float furrow = smoothstep(0.3, 0.7, texture2D(uNoise, vec2(ang * 2.0, vObj.y * 0.4)).b);
          col = mix(vec3(0.16, 0.11, 0.08), vec3(0.36, 0.27, 0.2), furrow) * (0.8 + 0.4 * nb2.r);
        } else if (uKind > 2.5) {
          // red-osier dogwood / willow stems
          col = mix(vec3(0.45, 0.06, 0.04), vec3(0.65, 0.16, 0.08), nb2.b);
        } else {
          // juniper: shreddy red-grey
          float strip = smoothstep(0.3, 0.7, texture2D(uNoise, vec2(ang * 3.0 + vObj.y * 0.4, vObj.y * 0.15)).b);
          col = mix(vec3(0.3, 0.2, 0.15), vec3(0.55, 0.5, 0.45), strip) * (0.8 + 0.3 * nb2.r);
        }
        col = mix(col, vec3(0.9, 0.93, 0.97), snowCover(vWorldPos) * smoothstep(0.6, 0.9, normalize(vNormal).y) * 0.8);
        diffuseColor.rgb *= col;
      `,
    },
  }, 'bark');
  return mat;
}

export function makeBarkDepthMaterial(opts = {}) {
  return makeFoliageDepthMaterial(null, false, { ...opts, key: 'barkd' + (opts.treeH || 10) });
}
