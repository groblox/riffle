// Rock geometry generator + material.
// Geometry: a star-shaped radial function. An ellipsoid is smooth-min'd against fracture planes
// (flat joint faces with eroded, rounded edges), then lumped with noise, grooved along sandstone
// bedding and split by joint cracks. Cavity / edge / crack terms are measured on the radial
// function itself, so every level of detail shades the same.
// Geometry is normalised: y in [0, 1] (bottom to top), horizontal radius 1, and carries a
// width-by-height profile (for the water).
// Material: textured in rock-local space (rocks can be picked up without the texture swimming):
// cross-bedded sandstone with varnish streaks, speckled granite with veins and water streaks,
// lichen, moss, soil contact, waterline staining and relief normals.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RNG, Simplex, clamp, smoothstep } from '../noise.js';
import { commonGLSL, patchMaterial } from '../core/env.js';
import { WF_Z } from './shape.js';

const rockFragHead = /* glsl */`
${commonGLSL}
uniform sampler2D uStrata;
const float WF_Z = ${WF_Z.toFixed(2)};
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocal;       // rock-local position in metres, centred, unrotated
varying vec3 vLocalN;
varying vec3 vR0;
varying vec3 vR1;
varying vec3 vR2;
varying vec4 vRock;        // moss, colour variant, kind, seed
varying vec4 vRockColor;   // tint, ground height under the rock
varying vec3 vCurv;        // ao, convex edge, crack
varying float vH01;        // 0 at the base, 1 at the top
varying vec2 vRockB;       // soil line (fraction of height it was buried to), wetness
float rRough, rAO;
vec3 rAlbedo;
vec3 rNormalW;
float rFade, rMidFade;

vec4 triN(vec3 p, vec3 w, float s){
  return texture2D(uNoise, p.yz*s) * w.x + texture2D(uNoise, p.xz*s) * w.y + texture2D(uNoise, p.xy*s) * w.z;
}
// relief used for normal detail (weathered grain, pits, flakes, laminae), in rock space
float rockRelief(vec3 p, vec3 w, float kind){
  vec4 a = triN(p, w, 0.6);
  vec4 b = triN(p, w, 2.3);
  float ridge = 1.0 - abs(a.g * 2.0 - 1.0);
  float soft = mix(0.32, 1.0, kind); // sandstone weathers smooth between its laminae
  float h = (a.b * 0.45 * rMidFade + ridge * ridge * 0.22 * rMidFade) * soft + a.r * 0.25
          + (b.b * 0.2 * rFade + (1.0 - abs(b.g * 2.0 - 1.0)) * 0.08 * rFade) * soft;
  // sandstone: laminae stand proud as fine ribs; granite: crystal grain
  h += (1.0 - kind) * sin(p.y * 38.0 + a.r * 6.0) * 0.045 * rMidFade;
  h += kind * b.a * 0.08 * rFade;
  return h;
}

void rockSurface(){
  vec3 n = normalize(vWorldNormal);
  vec3 ln = normalize(vLocalN);
  vec3 p = vWorldPos;
  vec3 lp = vLocal + vRock.w * 31.0;
  float foot = length(fwidth(p));
  rFade = 1.0 - smoothstep(0.006, 0.03, foot);
  rMidFade = 1.0 - smoothstep(0.03, 0.14, foot);
  vec3 tw = pow(abs(ln), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
  vec4 t1 = triN(lp, tw, 0.17);
  vec4 t2 = triN(lp, tw, 0.9);
  vec4 t3 = triN(lp, tw, 3.5);
  float kind = vRock.z; // 0 sandstone, 1 granite
  float ao = vCurv.x, edge = vCurv.y, crack = vCurv.z;
  // weathering, lichen and moss belong to the stone's own top: turn it over and they go with it
  float up = ln.y;

  // ---- sandstone: cross-bedded sets, mottling, liesegang bands, varnish ----
  float bedY = vLocal.y * 2.4 + (t1.r - 0.5) * 0.7;
  vec3 strata = texture2D(uStrata, vec2(bedY / 40.0 + vRock.w * 7.0, 0.5)).rgb;
  vec3 sand = mix(vec3(0.78, 0.56, 0.4), strata, 0.5);
  sand = mix(vec3(dot(sand, vec3(0.3, 0.5, 0.2))) * vec3(1.12, 0.95, 0.82), sand, 0.68);
  sand *= 0.84 + 0.26 * t1.g;
  float setC = vLocal.y * 1.6 + t1.b * 0.6;
  float setI = floor(setC);
  float sa = hash11(setI + vRock.w * 13.0) * 6.2831;
  float dip = (hash11(setI * 1.7 + vRock.w * 5.0) - 0.3) * 1.1;
  float lam = fract((vLocal.y + dot(vLocal.xz, vec2(cos(sa), sin(sa))) * dip) * 11.0 + t2.r * 0.8);
  sand *= mix(1.0, 0.92 + 0.12 * smoothstep(0.0, 0.6, lam), rMidFade * 0.9);
  sand = mix(sand, sand * 1.12 + 0.03, (1.0 - smoothstep(0.0, 0.05, fract(setC))) * rMidFade * 0.5);
  sand *= mix(1.0, 0.9 + 0.2 * t2.b, rMidFade);
  sand *= mix(1.0, 0.9 + 0.2 * t3.b, rFade);
  float lies = sin((t1.b * 4.0 + vLocal.y * 1.3) * 6.2831);
  sand = mix(sand, sand * vec3(0.78, 0.6, 0.5), smoothstep(0.85, 1.0, lies) * 0.22 * rMidFade);
  float vstreak = texture2D(uNoise, vec2((lp.x + lp.z) * 0.55, lp.y * 0.06)).b;
  float varn = smoothstep(0.52, 0.78, vstreak) * smoothstep(0.7, 0.2, abs(up)) * smoothstep(0.05, 0.4, vH01);
  sand = mix(sand, sand * vec3(0.42, 0.33, 0.28), varn * 0.6);
  sand = mix(sand, sand * 1.1 + vec3(0.05, 0.04, 0.03), smoothstep(0.55, 0.95, up) * 0.35);

  // ---- granite: grey with warm staining, mafic specks, feldspar, veins, water streaks ----
  vec3 gran = mix(vec3(0.44, 0.43, 0.41), vec3(0.52, 0.49, 0.45), t1.b) * (0.84 + 0.26 * t1.g);
  gran = mix(gran, gran * vec3(1.12, 0.99, 0.88), smoothstep(0.45, 0.8, t1.r) * 0.6);
  vec4 t4 = triN(lp, tw, 8.0);
  float speck = smoothstep(0.6, 0.72, t4.b) * (0.5 + 0.5 * t3.b);
  float felds = smoothstep(0.36, 0.24, t4.g);
  float pinkRock = step(0.55, fract(vRock.y * 3.7));
  gran = mix(gran, vec3(0.1, 0.1, 0.105), speck * 0.4 * rFade);
  gran = mix(gran, vec3(0.78, 0.75, 0.7), felds * 0.35 * rFade);
  gran = mix(gran, vec3(0.7, 0.52, 0.44), smoothstep(0.58, 0.74, t4.r) * 0.3 * pinkRock * rFade);
  gran *= mix(1.0, 0.88 + 0.24 * t2.b, rMidFade);
  vec3 vd = normalize(hash32(vec2(vRock.w * 91.0, 3.1)) * 2.0 - 1.0);
  float vOff = (hash11(vRock.w * 53.0) - 0.5) * 0.5;
  float vein = (1.0 - smoothstep(0.012, 0.03, abs(dot(vLocal, vd) - vOff + (t2.r - 0.5) * 0.08))) * step(hash11(vRock.w * 17.0), 0.4);
  gran = mix(gran, vec3(0.86, 0.84, 0.8), vein * 0.85);
  float gstreak = texture2D(uNoise, vec2((lp.x - lp.z) * 0.7, lp.y * 0.05 + 0.3)).g;
  gran = mix(gran, gran * vec3(0.42, 0.42, 0.44), smoothstep(0.55, 0.8, gstreak) * smoothstep(0.75, 0.25, abs(up)) * 0.55 * smoothstep(0.1, 0.5, vH01));
  gran *= 0.82 + 0.3 * smoothstep(0.25, 0.75, triN(lp * 0.37, tw, 0.17).g); // broad weathering patches
  gran = mix(gran, gran * vec3(0.88, 0.84, 0.78), smoothstep(0.3, 0.9, up) * 0.4);

  vec3 col = mix(sand, gran, kind) * vRockColor.rgb;
  // curvature: grime in hollows and cracks, worn pale edges
  col *= mix(0.6, 1.0, ao);
  col *= 1.0 - crack * 0.6;
  col = mix(col, col * 1.15 + 0.02, edge * 0.5);

  float wl = waterLevelAt(p.z);
  float above = p.y - wl;
  vec4 pa = profileA(p.z);
  float nearStream = 1.0 - step(pa.z * 2.2, abs(p.x - pa.x));
  // high-water mark: pale mineral band above the waterline
  float band = smoothstep(0.12, 0.28, above) * (1.0 - smoothstep(0.3, 0.55 + t1.r * 0.2, above));
  col = mix(col, col * vec3(1.08, 1.06, 1.0) + 0.035, band * 0.45 * nearStream);
  // crustose lichen: pale grey-green, chartreuse map lichen, orange
  float lichMask = smoothstep(0.6, 0.78, t2.b + t1.b * 0.35) * smoothstep(0.5, 0.72, t1.r + 0.25) * smoothstep(-0.2, 0.5, up) * smoothstep(0.35, 0.7, above + (1.0 - nearStream));
  float rosette = smoothstep(0.05, 0.2, t3.a) * 0.3 + 0.7;
  float lsel = fract(vRock.y * 7.31 + t1.a * 0.4);
  vec3 lc = lsel < 0.45 ? vec3(0.62, 0.66, 0.54) : (lsel < 0.75 ? vec3(0.66, 0.72, 0.22) : vec3(0.88, 0.48, 0.1));
  col = mix(col, lc * rosette * (0.8 + 0.2 * t3.r) * 0.85, lichMask * mix(0.25, 0.5, kind) * (0.6 + 0.4 * edge));
  // moss on tops, shaded faces and in hollows (forest side)
  float moss = vRock.x * smoothstep(0.35, 0.8, up - n.z * 0.15 + (t1.g - 0.5) * 0.6) * smoothstep(0.35, 0.65, t2.g + 0.15 + (1.0 - ao) * 0.3) * (1.0 - edge * 0.6);
  vec3 mossCol = mix(vec3(0.09, 0.18, 0.035), vec3(0.26, 0.3, 0.07), t3.r * rFade + (1.0 - rFade) * 0.5);
  mossCol = mix(mossCol, vec3(0.3, 0.26, 0.1), clamp(uSeason - 0.3, 0.0, 1.0) * 0.4);
  col = mix(col, mossCol, moss);
  // soil contact: a damp, dirty skirt where the rock meets the ground
  float soil = 1.0 - smoothstep(0.0, 0.14 + t2.g * 0.14, p.y - vRockColor.w);
  // ...and the band that was underground stays dirty when the stone is lifted or turned over
  soil = max(soil, (1.0 - smoothstep(vRockB.x - 0.05, vRockB.x + 0.03 + t2.r * 0.04, vH01)) * step(0.01, vRockB.x) * 0.85);
  // wet & under water: darker, more saturated, algae film
  float wet = nearStream * (1.0 - smoothstep(0.0, 0.22 + t2.r * 0.15, above));
  wet = max(wet, max(uWet * 0.7, vRockB.y * (0.75 + 0.25 * smoothstep(0.3, 0.7, t2.b))));
  // spray off the falls keeps the rocks around the plunge pool dark and glistening
  // (only the faces down in the spray, not the dry, lichened tops of the big lip boulders)
  float spray = (1.0 - smoothstep(0.5, 2.0, length(vec2((p.x - profileA(WF_Z).x) * 0.7, p.z - WF_Z - 0.8)))) * (1.0 - smoothstep(0.2, 1.0, p.y - waterLevelAt(WF_Z + 1.5)));
  wet = max(wet, spray * (0.5 + 0.3 * t2.b));
  float under = nearStream * smoothstep(0.02, -0.1, above);
  col = mix(col, mix(col * 0.75, vec3(0.3, 0.25, 0.19), 0.45), soil * 0.55 * (1.0 - under));
  col = mix(col, col * vec3(0.5, 0.66, 0.42), under * 0.65 * smoothstep(0.35, 0.65, t2.g + (1.0 - ao) * 0.2));
  vec3 wetCol = col * 0.6;
  wetCol = max(mix(vec3(dot(wetCol, vec3(0.33))), wetCol, 1.2), vec3(0.0));
  col = mix(col, wetCol, wet);
  // snow caps
  float snowW = snowCover(vWorldPos) * smoothstep(0.45, 0.8, n.y + (t2.r - 0.5) * 0.3) * step(0.0, above);
  col = mix(col, vec3(0.92, 0.94, 0.98), snowW);
  rAlbedo = max(col, vec3(0.0));
  rRough = mix(mix(0.92, 0.8, kind) - edge * 0.1, 0.32, wet * (1.0 - moss));
  rRough = mix(rRough, 0.95, max(moss, snowW));
  rAO = ao * mix(1.0, 0.75, soil * (1.0 - under)) * (1.0 - crack * 0.4) * (0.72 + 0.28 * smoothstep(-0.6, 0.4, n.y));

  // relief normal: finite differences in rock space, rotated into the world
  float e = 0.02;
  float h0 = rockRelief(lp, tw, kind);
  vec3 g = vec3(rockRelief(lp + vec3(e, 0.0, 0.0), tw, kind) - h0, rockRelief(lp + vec3(0.0, e, 0.0), tw, kind) - h0, rockRelief(lp + vec3(0.0, 0.0, e), tw, kind) - h0) / e;
  g -= dot(g, ln) * ln;
  float polish = (1.0 - smoothstep(1.0, 1.35, abs(p.x - pa.x) / max(pa.z, 0.1))) * (1.0 - smoothstep(0.2, 0.6, above)); // creek-worn: smooth below the flood line
  float k = mix(0.042, 0.035, kind) * (1.0 - snowW * 0.7) * (1.0 - moss * 0.5) * (1.0 - polish * 0.6);
  rNormalW = normalize(mat3(vR0, vR1, vR2) * normalize(ln - g * k));
}
`;

const rockVertHead = /* glsl */`
attribute vec4 aRock;      // moss, colorVar, kind, seed
attribute vec4 aRockColor; // tint rgb, ground height
attribute vec3 aCurv;      // ao, convex edge, crack
attribute vec2 aRockB;     // soil line, wetness
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vR0;
varying vec3 vR1;
varying vec3 vR2;
varying vec4 vRock;
varying vec4 vRockColor;
varying vec3 vCurv;
varying float vH01;
varying vec2 vRockB;
`;

export function makeRockMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  patchMaterial(mat, {
    vertexHead: rockVertHead,
    fragmentHead: rockFragHead,
    vertex: {
      project_vertex: `$
        vec3 rsc = vec3(1.0);
        mat3 rR = mat3(1.0);
        vec4 rw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        rsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        rR = mat3(instanceMatrix[0].xyz / rsc.x, instanceMatrix[1].xyz / rsc.y, instanceMatrix[2].xyz / rsc.z);
        rw = instanceMatrix * rw;
        #endif
        rw = modelMatrix * rw;
        rR = mat3(modelMatrix) * rR;
        vWorldPos = rw.xyz;
        vLocal = (transformed - vec3(0.0, 0.5, 0.0)) * rsc;
        vLocalN = normalize(objectNormal / rsc);
        vWorldNormal = normalize(rR * vLocalN);
        vR0 = rR[0]; vR1 = rR[1]; vR2 = rR[2];
        vH01 = transformed.y;
        vRock = aRock;
        vRockColor = aRockColor;
        vCurv = aCurv;
        vRockB = aRockB;`,
    },
    fragment: {
      map_fragment: `rockSurface(); diffuseColor.rgb *= rAlbedo;`,
      roughnessmap_fragment: `float roughnessFactor = rRough;`,
      normal_fragment_maps: `normal = normalize(mat3(viewMatrix) * rNormalW);`,
      aomap_fragment: `reflectedLight.indirectDiffuse *= rAO; reflectedLight.indirectSpecular *= mix(rAO, 1.0, 0.3);`,
      emissivemap_fragment: `$
        totalEmissiveRadiance += rAlbedo * uSunColor * caustics(vWorldPos) * uSunIntensity * 0.22;`,
    },
  }, 'rock');
  return mat;
}

// ---- shape styles ----
// ay/az: ellipsoid axes; planes: fracture faces (count, offset range, how vertical their normals are);
// round: smooth-min radius (edge rounding); lumps: noise amplitudes; beds/cracks: sandstone grooves, joints.
const STYLES = {
  round:   { ay: [0.62, 0.85], az: [0.75, 1.0], planes: [3, 6], off: [0.8, 0.95], planeY: 0.7, round: [0.1, 0.16], lumps: [0.07, 0.03, 0.01], beds: 0, cracks: 0.45, crackVert: false, top: false },
  // the erratic: a glacial deposit, a blocky mass of granite plucked from a cliff and carried miles on the ice:
  // broad joint faces and a flat-ish weathered top, edges rounded by the ice and the ages since
  erratic: { ay: [0.66, 0.74], az: [0.82, 0.92], planes: [12, 15], off: [0.42, 0.6], planeY: 0.8, round: [0.025, 0.035], lumps: [0.035, 0.02, 0.008], beds: 0, cracks: 1, crackVert: true, top: true },
  angular: { ay: [0.6, 0.8], az: [0.7, 0.95], planes: [5, 8], off: [0.7, 0.9], planeY: 0.6, round: [0.06, 0.09], lumps: [0.05, 0.025, 0.01], beds: 0, cracks: 0.6, crackVert: false, top: false },
  block:   { ay: [0.65, 0.95], az: [0.7, 0.95], planes: [5, 9], off: [0.62, 0.85], planeY: 0.35, round: [0.035, 0.06], lumps: [0.035, 0.02, 0.008], beds: 1, cracks: 0.6, crackVert: true, top: true },
  slab:    { ay: [0.32, 0.45], az: [0.7, 1.0], planes: [5, 8], off: [0.58, 0.82], planeY: 0.15, round: [0.05, 0.08], lumps: [0.03, 0.015, 0.006], beds: 1, cracks: 0.5, crackVert: true, top: true },
  flat:    { ay: [0.3, 0.42], az: [0.75, 1.0], planes: [4, 7], off: [0.72, 0.92], planeY: 0.15, round: [0.07, 0.1], lumps: [0.04, 0.015, 0.006], beds: 0, cracks: 0.3, crackVert: true, top: true },
  // bedrock of the falls: squat, flat-topped granite blocks bounded by near-vertical joints, a sheeting
  // joint or two across their faces, edges only a little rounded by the water
  ledge:   { ay: [0.46, 0.56], az: [0.85, 1.0], planes: [7, 10], off: [0.58, 0.76], planeY: 0.12, round: [0.022, 0.036], lumps: [0.022, 0.012, 0.006], beds: 0.35, cracks: 0.9, crackVert: true, top: true },
  cobble:  { ay: [0.5, 0.7], az: [0.7, 0.95], planes: [1, 3], off: [0.82, 0.95], planeY: 0.6, round: [0.18, 0.25], lumps: [0.03, 0.01, 0.0], beds: 0, cracks: 0, crackVert: false, top: false },
};

function randDir(rng, yScale) {
  const d = new THREE.Vector3(rng.gauss(), rng.gauss() * yScale, rng.gauss());
  return d.normalize();
}

// Returns f(vx, vy, vz) -> [radius, crack] for a unit direction.
function rockShape(seed, style) {
  const S = STYLES[style];
  const rng = new RNG(seed);
  const s = new Simplex(seed);
  const ax = 1, ay = rng.range(...S.ay), az = rng.range(...S.az);
  const ell = (x, y, z) => 1 / Math.sqrt((x * x) / (ax * ax) + (y * y) / (ay * ay) + (z * z) / (az * az));
  const planes = [];
  // a flat bed to rest on, and for blocks a weathered top
  const bd = new THREE.Vector3(rng.gauss() * 0.08, -1, rng.gauss() * 0.08).normalize();
  planes.push({ x: bd.x, y: bd.y, z: bd.z, o: ay * rng.range(0.3, 0.5) });
  if (S.top) {
    const td = new THREE.Vector3(rng.gauss() * 0.2, 1, rng.gauss() * 0.2).normalize();
    planes.push({ x: td.x, y: td.y, z: td.z, o: ay * rng.range(0.72, 0.9) });
  }
  const nP = rng.int(S.planes[0], S.planes[1]);
  for (let i = 0; i < nP; i++) {
    const d = randDir(rng, S.planeY);
    planes.push({ x: d.x, y: d.y, z: d.z, o: ell(d.x, d.y, d.z) * rng.range(S.off[0], S.off[1]) });
  }
  const k = rng.range(S.round[0], S.round[1]);
  const [A1, A2, A3] = S.lumps;
  const cracks = [];
  for (let i = 0; i < 3; i++) {
    if (!rng.chance(S.cracks * (i === 0 ? 1 : 0.4))) continue;
    const d = S.crackVert ? new THREE.Vector3(rng.gauss(), rng.gauss() * 0.15, rng.gauss()).normalize() : randDir(rng, 1);
    cracks.push({ nx: d.x, ny: d.y, nz: d.z, o: rng.range(-0.35, 0.35), w: rng.range(0.035, 0.055), depth: rng.range(0.03, 0.055), seed: rng.range(0, 100) });
  }
  const skirt = rng.range(0.16, 0.26);
  const bedF = S.beds ? rng.range(5, 8) * S.beds / ay : 0, bedPh = rng.range(0, 6.28), bedDepth = rng.range(0.018, 0.032);
  return (vx, vy, vz) => {
    // smooth minimum over the ellipsoid and every plane: flat faces, rounded edges
    let sum = Math.exp(-ell(vx, vy, vz) / k);
    for (const pl of planes) {
      const dd = vx * pl.x + vy * pl.y + vz * pl.z;
      if (dd > 1e-3) sum += Math.exp(-(pl.o / dd) / k);
    }
    let r = -k * Math.log(sum);
    // the buried half is fuller than an ellipsoid: the ground meets the stone at its flank, not under a bulge
    if (vy < 0) r *= 1 + skirt * smoothstep(0, -0.7, vy) * (1 - vy * vy * 0.5);
    // lumps (domain-warped so they don't read as noise blobs)
    const wx = s.noise3(vx * 0.9 + 11, vy * 0.9, vz * 0.9) * 0.35;
    r *= 1 + s.noise3(vx * 1.1 + wx, vy * 1.1, vz * 1.1 - wx) * A1
           + s.noise3(vx * 2.6 + 5, vy * 2.6 + wx, vz * 2.6) * A2
           + (A3 ? s.noise3(vx * 6.5 + 9, vy * 6.5, vz * 6.5) * A3 : 0);
    const px = vx * r, py = vy * r, pz = vz * r;
    // sandstone: softer beds weather back into horizontal grooves on the sides
    if (bedF) {
      const g = Math.sin(py * bedF + bedPh + s.noise3(px * 1.5, py * 1.5, pz * 1.5) * 1.2);
      r -= bedDepth * (1 - vy * vy) * smoothstep(0.35, 1.0, g);
    }
    // joint cracks: V-grooves along planes, fading in and out along their length
    let crack = 0;
    for (const c of cracks) {
      const sd = px * c.nx + py * c.ny + pz * c.nz - c.o;
      if (Math.abs(sd) > c.w * 3) continue;
      const along = smoothstep(-0.1, 0.45, s.noise3(px * 1.8 + c.seed, py * 1.8, pz * 1.8));
      const g = Math.exp(-((sd / c.w) ** 2)) * along;
      r -= c.depth * g;
      crack = Math.max(crack, g);
    }
    return [r, crack];
  };
}

const _probe = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
// cavity (+ concave) / convexity of the radial function around a direction, at angular scale a
function radialCavity(f, v, r0, a) {
  _t1.set(Math.abs(v.y) < 0.9 ? 0 : 1, Math.abs(v.y) < 0.9 ? 1 : 0, 0).cross(v).normalize();
  _t2.crossVectors(v, _t1);
  let acc = 0;
  for (let i = 0; i < 5; i++) {
    const ang = i / 5 * Math.PI * 2;
    _probe.copy(v).addScaledVector(_t1, Math.cos(ang) * a).addScaledVector(_t2, Math.sin(ang) * a).normalize();
    acc += f(_probe.x, _probe.y, _probe.z)[0];
  }
  return (acc / 5 - r0) / (a * a); // > 0: hollow, < 0: ridge
}

export function makeRockGeometry(seed, style, detail = 4) {
  const f = rockShape(seed, style);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const N = pos.count;
  const v = new THREE.Vector3();
  const cv = new Float32Array(N * 3);
  let minY = 1e9, maxY = -1e9, maxH = 0;
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const [r, crack] = f(v.x, v.y, v.z);
    const fine = radialCavity(f, v, r, 0.07);
    const broad = radialCavity(f, v, r, 0.22);
    const x = v.x * r, y = v.y * r, z = v.z * r;
    pos.setXYZ(i, x, y, z);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); maxH = Math.max(maxH, Math.hypot(x, z));
    // ao: hollows at two scales + cracks + underside; edge: convex ridges get worn pale
    cv[i * 3] = clamp(1 - Math.max(broad, 0) * 0.5 - Math.max(fine, 0) * 0.12 - crack * 0.25 - smoothstep(0.1, -0.8, v.y) * 0.25, 0.25, 1);
    cv[i * 3 + 1] = smoothstep(0.4, 2.6, -fine);
    cv[i * 3 + 2] = crack;
  }
  // normalise: base at y = 0, top at y = 1, horizontal radius 1
  const sy = 1 / (maxY - minY), sh = 1 / maxH;
  for (let i = 0; i < N; i++) pos.setXYZ(i, pos.getX(i) * sh, (pos.getY(i) - minY) * sy, pos.getZ(i) * sh);
  g.computeVertexNormals();
  g.setAttribute('aCurv', new THREE.BufferAttribute(cv, 3));
  g.computeBoundingSphere();
  g.userData.prof = widthProfile(g);
  return g;
}

// ---- width-by-height profile (how wide the rock is where the water cuts it) ----
export const PROF_N = 12;
function widthProfile(g) {
  const P = g.attributes.position.array;
  const prof = new Float32Array(PROF_N);
  for (let i = 0; i < P.length; i += 3) {
    const b = Math.min(PROF_N - 1, Math.floor(P[i + 1] * PROF_N));
    prof[b] = Math.max(prof[b], Math.hypot(P[i], P[i + 2]));
  }
  return prof;
}
