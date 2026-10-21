// Terrain meshes (near detailed + far mountains) with a procedural material.
import * as THREE from 'three';
import { WORLD, GRID_N, heightGrid, bioGrid, buildGrid, farHeight, terrainSample, WF_Z, WF_LEN, TRAIL, stepOffset } from './shape.js';
import { smoothstep } from '../noise.js';
import { U, commonGLSL, contactGLSL, patchMaterial } from '../core/env.js';

const terrainVertexHead = /* glsl */`
attribute vec4 aBio;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vBio;
`;

const terrainFragHead = /* glsl */`
${commonGLSL}
${contactGLSL}
uniform sampler2D uPebbles;
uniform sampler2D uStrata;
uniform sampler2D uTrail;
uniform sampler2D uStepOff;
uniform float uFar;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec4 vBio;
float tBump;
vec2 tGrad;
float tRough;
float tWet;
float tOcc;
float fallFace;
vec3 tAlbedo;

vec3 bumpNormal(vec3 surf_pos, vec3 surf_norm, float h, float scale){
  vec3 vSigmaX = dFdx(surf_pos), vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm), R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * scale;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}

// triplanar-ish sample of noise for cliffs
vec4 triNoise(vec3 p, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uNoise, p.yz*s) * w.x + texture2D(uNoise, p.xz*s) * w.y + texture2D(uNoise, p.xy*s) * w.z;
}

void terrainSurface(){
  vec3 p = vWorldPos;
  vec3 n = normalize(vWorldNormal);
  float slope = 1.0 - n.y;
  vec4 pa = profileA(p.z);
  float wl = pa.y;
  float lat = (p.x - pa.x) / sqrt(1.0 + profileB(p.z).x * profileB(p.z).x);
  float u = abs(lat) / max(pa.z, 0.1);
  float above = p.y - wl;

  vec4 n1 = texture2D(uNoise, p.xz * 0.013);
  vec4 n2 = texture2D(uNoise, p.xz * 0.11);
  vec4 n3 = texture2D(uNoise, p.xz * 0.6);
  vec4 tn = triNoise(p, n, 0.09);
  vec4 tn2 = triNoise(p, n, 0.45);

  // ---- sandstone ----
  float sy = p.y * 0.5 + (n1.r - 0.5) * 4.0 + (tn.g - 0.5) * 0.8;
  vec3 strata = texture2D(uStrata, vec2(sy / 64.0, 0.5)).rgb;
  vec3 strataFine = texture2D(uStrata, vec2((p.y * 2.3 + (tn.g - 0.5) * 1.5) / 64.0 + 0.37, 0.5)).rgb;
  strata = mix(strata, strataFine, 0.3);
  // the pale (Navajo-white) bands belong to the caprock up top; low on the walls they are salmon and buff
  float hiRock = smoothstep(26.0, 46.0, p.y - wl + (n1.r - 0.5) * 14.0);
  float paleB = smoothstep(0.42, 0.7, dot(strata, vec3(0.3, 0.5, 0.2)));
  strata = mix(strata, strata * vec3(0.9, 0.62, 0.46), paleB * (1.0 - hiRock) * 0.75);
  // cross-bedding: fine slanted laminae
  float hc = (abs(n.x) > abs(n.z) ? p.z : p.x);
  float xb = sin((p.y * 5.0 + hc * 1.4 * sign(sin(floor(p.y * 0.35) * 2.1)) + tn.r * 3.0) * 3.14159);
  strata *= 1.0 - 0.07 * smoothstep(0.6, 1.0, xb);
  float streak = texture2D(uNoise, vec2(hc * 0.045 + p.y * 0.002, p.y * 0.0035)).b * 0.6 + texture2D(uNoise, vec2(hc * 0.13, p.y * 0.01)).g * 0.4;
  float steepF = smoothstep(0.35, 0.85, slope);
  float varnish = smoothstep(0.48, 0.72, streak) * steepF;
  vec3 rock = strata * (0.7 + 0.55 * tn2.b) * mix(1.0, 0.38, varnish);
  rock = mix(rock, rock * vec3(1.08, 0.98, 0.9) + 0.03, (1.0 - steepF) * 0.5 * hiRock); // sun-bleached caprock ledges
  rock *= 0.82 + 0.3 * tn.a;
  // granite-ish rock on forest side and along the creek
  // (kept fairly dark: bright grey outcrops on the hills read as patches of snow from a distance)
  vec3 granite = mix(vec3(0.24, 0.23, 0.21), vec3(0.4, 0.38, 0.34), tn2.b) * (0.8 + 0.3 * tn.r);
  granite = mix(granite, granite * vec3(0.9, 0.8, 0.68), smoothstep(0.55, 0.8, tn.b) * 0.6); // iron staining
  granite = mix(granite, vec3(0.2, 0.27, 0.1), smoothstep(0.62, 0.8, tn2.g) * (1.0 - steepF * 0.5) * 0.6);
  // the mountain's walls: split into big blocks by joints, streaked dark where water runs down them
  vec4 mj = triNoise(p * vec3(1.0, 0.7, 1.0), n, 0.05);
  float mJoint = smoothstep(0.94, 0.985, 1.0 - abs(mj.g * 2.0 - 1.0)) * steepF;
  float wStreak = smoothstep(0.55, 0.85, texture2D(uNoise, vec2((p.x + p.z) * 0.09, p.y * 0.006)).r) * steepF;
  granite *= (1.0 - mJoint * 0.22) * (1.0 - wStreak * 0.4 * smoothstep(40.0, 80.0, p.y));
  rock = mix(rock, granite, clamp(vBio.y * (1.0 - vBio.x) + vBio.z * 0.85, 0.0, 1.0));

  // ---- ground covers ----
  float season = uSeason;
  vec3 grassSummer = mix(vec3(0.16, 0.24, 0.07), vec3(0.26, 0.33, 0.11), n2.r);
  vec3 grassAutumn = mix(vec3(0.3, 0.22, 0.09), vec3(0.45, 0.34, 0.15), n2.r);
  vec3 grass = mix(grassSummer, grassAutumn, clamp(season, 0.0, 1.0));
  grass *= 0.8 + 0.35 * n3.g;
  vec3 soil = mix(vec3(0.33, 0.2, 0.13), vec3(0.5, 0.3, 0.18), n2.g) * (0.85 + 0.3 * n3.b);
  // red desert sand; only the high benches pale toward the cream of the caprock
  vec3 sand = mix(vec3(0.5, 0.21, 0.1), vec3(0.62, 0.3, 0.15), n2.b) * (0.9 + 0.2 * n3.r);
  sand = mix(sand, mix(vec3(0.66, 0.42, 0.27), vec3(0.76, 0.52, 0.34), n2.b), hiRock * 0.8);
  vec3 forestFloor = mix(vec3(0.17, 0.12, 0.08), vec3(0.28, 0.2, 0.11), n2.r);
  // leaf litter speckles (golden aspen leaves in autumn)
  vec4 nl = texture2D(uNoise, p.xz * 1.9 + n2.rg * 0.3);
  float litter = smoothstep(0.62, 0.8, nl.a + nl.b * 0.25 + n2.b * 0.2 - 0.1) * vBio.y * smoothstep(0.3, 0.7, n1.g + 0.2);
  forestFloor = mix(forestFloor, mix(vec3(0.3, 0.25, 0.1), vec3(0.7, 0.48, 0.1), clamp(season, 0.0, 1.0)), litter * 0.7);

  // gravel: pebbles at three sizes bedded in silt (no dark grout), bigger cobbles only in patches
  vec4 peb = texture2D(uPebbles, p.xz * 0.55);
  vec4 pebL = texture2D(uPebbles, p.xz * 0.21 + 0.37);
  vec4 pebS = texture2D(uPebbles, p.xz * 1.7 + 0.71);
  vec3 silt = mix(vec3(0.42, 0.37, 0.3), vec3(0.55, 0.48, 0.38), n3.r);
  vec3 g1 = mix(silt, peb.rgb, smoothstep(0.04, 0.3, peb.a));
  vec3 g2 = mix(silt, pebL.rgb, smoothstep(0.04, 0.3, pebL.a));
  vec3 g3 = mix(silt, pebS.rgb, smoothstep(0.04, 0.3, pebS.a));
  float bigMask = smoothstep(0.45, 0.72, n2.b);
  vec3 gravel = mix(mix(g1, g3, 0.35), g2, bigMask * 0.6) * vec3(0.66, 0.62, 0.58);

  // mix by biome
  vec3 ground = grass;
  ground = mix(ground, soil, smoothstep(0.45, 0.7, n1.g) * 0.5);
  ground = mix(ground, forestFloor, smoothstep(0.3, 0.8, vBio.y) * smoothstep(0.35, 0.65, n1.b + 0.15));
  ground = mix(ground, sand, vBio.x * smoothstep(0.35, 0.6, n1.r + 0.1));
  // desert floor: bare red sand between the shrubs, dark crusted soil (cryptobiotic crust), grit and slickrock
  float arid = vBio.w;
  vec3 desert = sand * mix(0.95, 1.08, n3.g);
  desert = mix(desert, vec3(0.2, 0.12, 0.08) * (0.8 + 0.4 * n3.b), smoothstep(0.55, 0.75, n2.a + (n3.r - 0.5) * 0.4) * 0.6);
  desert = mix(desert, desert * vec3(0.78, 0.74, 0.7), smoothstep(0.5, 0.8, texture2D(uPebbles, p.xz * 0.9).a) * 0.6);
  desert = mix(desert, mix(desert, vec3(0.42, 0.38, 0.2), 0.45), smoothstep(0.62, 0.82, n2.r) * (1.0 - vBio.x) * 0.5); // dry grass litter
  // smooth slickrock showing through the sand: a buff, wind-polished bedrock
  float slick = smoothstep(0.62, 0.74, n1.a + (n2.g - 0.5) * 0.25) * arid * smoothstep(1.6, 2.6, u);
  desert = mix(desert, mix(vec3(0.6, 0.36, 0.22), vec3(0.7, 0.46, 0.3), tn2.b) * (0.85 + 0.25 * tn.a), slick * 0.85);
  ground = mix(ground, desert, arid);
  // above the trees: short tawny alpine turf, cushion plants, lichen-crusted scree
  float alpH = p.y + (n1.g - 0.5) * 18.0 + (n2.r - 0.5) * 6.0;
  float alp = smoothstep(52.0, 80.0, alpH) * vBio.y * (1.0 - uFar * 0.5);
  vec3 turf = mix(vec3(0.13, 0.14, 0.065), vec3(0.25, 0.22, 0.12), n2.g) * (0.85 + 0.3 * n3.g);
  // scree: broad aprons of lichen-grey rubble rather than scattered chips
  turf = mix(turf, vec3(0.3, 0.29, 0.27) * (0.8 + 0.3 * n3.r), smoothstep(0.6, 0.7, n1.b * 0.6 + n2.b * 0.4 + (n3.a - 0.5) * 0.08) * 0.75);
  ground = mix(ground, turf, alp);
  // the trail: a faint line of packed, pale soil, grit and a few roots, patchy where grass creeps back in
  vec2 tuv = (p.xz + ${WORLD.toFixed(1)}) / ${(WORLD * 2).toFixed(1)};
  float trail = texture2D(uTrail, tuv).r * (1.0 - uFar);
  trail *= smoothstep(0.25, 0.7, n3.g * 0.6 + n2.b * 0.5 + trail * 0.3);
  vec3 tread = mix(vec3(0.3, 0.24, 0.17), vec3(0.4, 0.33, 0.25), n3.r) * (0.88 + 0.24 * texture2D(uPebbles, p.xz * 1.3).a);
  tread = mix(tread, forestFloor * 1.15, vBio.y * smoothstep(0.4, 0.8, n2.g) * 0.5);
  ground = mix(ground, tread, trail * 0.45);
  // gravel bars / banks
  float gravelW = 1.0 - smoothstep(1.05, 1.45 + n2.r * 0.6, u);
  gravelW = max(gravelW, (1.0 - smoothstep(0.2, 0.9, above)) * 0.8 * (1.0 - smoothstep(1.2, 2.2, u)));
  ground = mix(ground, gravel, gravelW);

  // forested mountain flanks hold their soil far steeper than open ground; rock shows on the crags
  float rlo = mix(0.32, 0.5, vBio.y * (1.0 - vBio.x) * (1.0 - uFar) * (1.0 - alp * 0.55));
  float rockW = smoothstep(rlo, rlo + 0.23, slope + (tn.r - 0.5) * 0.25);
  rockW = max(rockW, vBio.x * smoothstep(0.18, 0.32, slope));
  // exposed bedrock on some stretches of bank, running down into the edge of the bed
  float bankRock = smoothstep(0.56, 0.7, n1.b + (n2.r - 0.5) * 0.3) * smoothstep(0.7, 0.95, u) * (1.0 - smoothstep(1.35, 1.9, u + n2.g * 0.3));
  rockW = max(rockW, bankRock * 0.9);
  vec3 col = mix(ground, rock, rockW);

  // the granite step and the walls of the plunge pool: spray-darkened rock, slick with algae near the water,
  // thick bright moss on every ledge the spray keeps damp
  // the step's line in plan (it zig-zags along the joints out into the banks; see stepOffset)
  float stepOff = (texture2D(uStepOff, vec2(clamp((lat + 32.0) / 64.0, 0.0, 1.0), 0.5)).r - 0.5) * 6.0;
  float fz = p.z + stepOff - (${WF_Z.toFixed(2)} + ${(WF_LEN * 0.5).toFixed(2)});
  fallFace = (1.0 - smoothstep(0.6, 2.2, abs(fz) + (tn.r - 0.5) * 0.8)) * (1.0 - smoothstep(1.7, 3.0, u));
  // the falls' granite: the same pale, faintly warm stone as the blocks on the lip (not the dark hill rock)
  vec3 fallsG = mix(vec3(0.44, 0.42, 0.39), vec3(0.56, 0.53, 0.48), tn2.b) * (0.82 + 0.3 * tn.a);
  fallsG = mix(fallsG, fallsG * vec3(1.08, 0.97, 0.88), smoothstep(0.5, 0.8, tn.b) * 0.5);
  fallsG = mix(fallsG, vec3(0.62, 0.65, 0.55), smoothstep(0.66, 0.78, tn2.r) * 0.35); // crustose lichen
  // dry and pale up top, darkening to wet stone toward the water
  vec3 wetRock = mix(fallsG * vec3(0.62, 0.64, 0.63), fallsG, smoothstep(0.25, 1.6, above));
  // joints: an irregular net of dark cracks where the granite has split into blocks, and a sheeting joint
  // or two running across the face
  vec4 jn = triNoise(p * vec3(1.0, 1.6, 1.0), n, 0.33);
  float joint = smoothstep(0.95, 0.99, 1.0 - abs(jn.g * 2.0 - 1.0)) + smoothstep(0.965, 0.995, 1.0 - abs(jn.b * 2.0 - 1.0)) * 0.6;
  float sheet = 1.0 - smoothstep(0.02, 0.07, abs(fract(p.y * 1.25 + jn.r * 0.6) - 0.5) - 0.42);
  wetRock *= 1.0 - clamp(joint + sheet * 0.5 * steepF, 0.0, 1.0) * 0.38;
  // moss only in the damp joints and on a few spray-soaked ledges
  float mossF = smoothstep(0.62, 0.78, tn2.g + n.y * 0.2 + smoothstep(0.9, 1.4, u) * 0.08);
  vec3 mossCol = mix(vec3(0.07, 0.15, 0.03), vec3(0.17, 0.26, 0.05), n3.g);
  wetRock = mix(wetRock, mossCol, mossF * 0.45);
  wetRock = mix(wetRock, vec3(0.06, 0.08, 0.04), smoothstep(0.35, 0.0, p.y - wl) * 0.5); // slime at the waterline
  col = mix(col, wetRock, fallFace);
  rockW = max(rockW, fallFace);
  // ...and the same bedrock band running out across the floodplain into both banks: bare slabs where the
  // knobs break the turf, darker and wet only close to the water
  float bz = p.z + stepOff - (${WF_Z.toFixed(2)} - 0.6) + (texture2D(uNoise, vec2(p.x * 0.013, 0.37)).r - 0.5) * 1.0;
  float band = exp(-pow(bz / 1.8, 2.0)) * (1.0 - smoothstep(16.0, 26.0, abs(lat) + (n1.g - 0.5) * 10.0)) * smoothstep(1.15, 1.7, u) * (1.0 - uFar);
  float outc = band * smoothstep(0.28, 0.5, band * 0.55 + slope * 0.9 + (tn.r - 0.5) * 0.5 + (n2.b - 0.5) * 0.3);
  vec3 slabCol = mix(fallsG, fallsG * vec3(0.66, 0.68, 0.66), 1.0 - smoothstep(0.2, 1.2, above));
  col = mix(col, slabCol * (1.0 - joint * 0.5), outc * (1.0 - fallFace));
  rockW = max(rockW, outc);

  // the tarn's bed: clean granite gravel and silt, a band of wet stones at the shore
  float lakeD = uLake.z - p.y;
  float inLk = (1.0 - step(uLake.w + 2.5, length(p.xz - uLake.xy))) * (1.0 - uFar);
  float lakeBed = inLk * smoothstep(-0.02, 0.05, lakeD);
  // pale granite gravel in the shallows, going to dark olive silt strewn with stones in the deep
  vec3 lbed = mix(gravel * vec3(0.74, 0.72, 0.64), vec3(0.1, 0.11, 0.085) * (0.8 + 0.5 * n3.r), smoothstep(0.25, 1.6, lakeD) * 0.85);
  col = mix(col, lbed, lakeBed);
  col *= mix(1.0, 0.7, inLk * (1.0 - smoothstep(0.0, 0.35, -lakeD)) * (1.0 - lakeBed));
  rockW *= 1.0 - lakeBed * 0.5;

  // underwater: pebbles + algae, darker
  float under = smoothstep(0.02, -0.08, above) * (1.0 - smoothstep(1.6, 2.4, u));
  vec3 bed = mix(gravel, gravel * vec3(0.55, 0.75, 0.45), smoothstep(0.4, 1.6, -above) * 0.6 * n2.g);
  col = mix(col, bed, under * (1.0 - rockW * 0.5));

  // wetness near the waterline & rain
  float wetLine = (1.0 - smoothstep(0.0, 0.35 + n2.r * 0.25, above)) * (1.0 - under) * (1.0 - smoothstep(1.5, 2.5, u));
  float wet = max(wetLine, uWet * 0.6);
  col *= mix(1.0, 0.62, wet);
  // moss on north-ish flats near the water on forest side
  col = mix(col, vec3(0.12, 0.2, 0.05), smoothstep(0.65, 0.85, n3.g) * vBio.z * 0.35 * (1.0 - under) * (1.0 - fallFace) * (1.0 - outc));

  // distant forest (beyond hand-placed trees): dark conifer & aspen clumps
  float farW = max(uFar, smoothstep(136.0, 150.0, max(abs(p.x), abs(p.z))));
  float treeLine = 1.0 - smoothstep(380.0, 520.0, p.y + (n1.r - 0.5) * 60.0);
  float forestMask = farW * vBio.y * smoothstep(0.7, 0.35, slope) * treeLine;
  vec4 tc = texture2D(uNoise, p.xz * 0.085);
  float clump = smoothstep(0.3, 0.62, tc.a + (n2.r - 0.5) * 0.4) * smoothstep(0.25, 0.55, n1.b + 0.2);
  vec3 treeCol = mix(vec3(0.03, 0.06, 0.035), mix(vec3(0.06, 0.1, 0.03), vec3(0.6, 0.38, 0.05), clamp(uSeason, 0.0, 1.0) * (1.0 - smoothstep(1.3, 1.8, uSeason))), smoothstep(0.55, 0.75, tc.g));
  col = mix(col, treeCol, clump * forestMask);
  // alpine: rock & snow on the high peaks
  // the high Rockies: dark blue-grey rock faces, above the tree line, and snow only in the summit couloirs
  vec3 farRock = mix(vec3(0.12, 0.12, 0.13), vec3(0.22, 0.21, 0.21), tn2.b) * (0.8 + 0.4 * tn.r);
  col = mix(col, farRock, uFar * rockW * vBio.y * (1.0 - clump * forestMask));
  float alpine = uFar * smoothstep(620.0, 760.0, p.y + (n1.r - 0.5) * 90.0) * smoothstep(0.4, 0.8, vBio.y);
  col = mix(col, vec3(0.9, 0.92, 0.96), alpine * smoothstep(0.5, 0.75, n.y + (n2.r - 0.5) * 0.4));

  // snow
  // winter snow slides off anything steep; the old high snowfields cling to steeper ground, bare only on the crags
  float snowW = max(snowCover(p) * smoothstep(0.55, 0.85, n.y + (n2.r - 0.5) * 0.4),
                    alpineSnow(p) * smoothstep(0.3, 0.55, n.y + (n2.r - 0.5) * 0.3)) * (1.0 - lakeBed);
  col = mix(col, vec3(0.92, 0.94, 0.98), snowW);

  // the ground darkens and turns to damp soil right at the foot of a stone
  float occ = contactAO(p) * (1.0 - uFar);
  col = mix(col, mix(col, vec3(0.16, 0.13, 0.09), 0.5 * (1.0 - snowW)) * 0.82, occ * 0.65);
  tOcc = occ;

  tAlbedo = col;
  // ground micro-relief: texture-space gradient (no screen-derivative blockiness)
  float e = 0.04;
  float h0 = texture2D(uNoise, p.xz * 0.6).b * 0.25 + peb.a * 0.35 * gravelW;
  float hx = texture2D(uNoise, (p.xz + vec2(e, 0.0)) * 0.6).b * 0.25 + texture2D(uPebbles, (p.xz + vec2(e, 0.0)) * 0.55).a * 0.35 * gravelW;
  float hz = texture2D(uNoise, (p.xz + vec2(0.0, e)) * 0.6).b * 0.25 + texture2D(uPebbles, (p.xz + vec2(0.0, e)) * 0.55).a * 0.35 * gravelW;
  tGrad = vec2(hx - h0, hz - h0) / e * 0.06 * (1.0 - rockW) * (1.0 - snowW * 0.8) * (1.0 - uFar);
  tBump = (tn2.b * 1.2 + tn.a * 0.5 + xb * 0.08) * rockW + clump * forestMask * 2.0;
  tRough = mix(mix(0.95, 0.85, rockW), 0.38, wet * (1.0 - snowW));
  tRough = mix(tRough, 0.3, fallFace);
  tWet = wet;
}
`;

// the trail as a soft mask over the near terrain (0.3 m texels)
let trailTex = null;
function trailTexture() {
  if (trailTex) return trailTex;
  const N = 1024, cell = (WORLD * 2) / N, D = new Uint8Array(N * N);
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i], b = TRAIL[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - 1.2 + WORLD) / cell)), i1 = Math.min(N - 1, Math.ceil((Math.max(a.x, b.x) + 1.2 + WORLD) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - 1.2 + WORLD) / cell)), j1 = Math.min(N - 1, Math.ceil((Math.max(a.z, b.z) + 1.2 + WORLD) / cell));
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const x = -WORLD + (k + 0.5) * cell, z = -WORLD + (j + 0.5) * cell;
      const t = Math.min(1, Math.max(0, ((x - a.x) * vx + (z - a.z) * vz) / L2));
      const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
      // the tread wanders a little in width
      const w = 0.3 + 0.1 * Math.sin((a.s + t * Math.sqrt(L2)) * 0.37) + 0.06 * Math.sin((a.s + t * Math.sqrt(L2)) * 1.9);
      const v = 255 * (1 - smoothstep(w * 0.6, w + 0.35, d));
      const q = j * N + k;
      if (v > D[q]) D[q] = v;
    }
  }
  trailTex = new THREE.DataTexture(D, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  trailTex.magFilter = THREE.LinearFilter; trailTex.minFilter = THREE.LinearFilter;
  trailTex.needsUpdate = true;
  return trailTex;
}

// the falls' step offset by lateral distance (-32..32 m), for the shader to follow the same zig-zag line
let stepTex = null;
function stepTexture() {
  if (stepTex) return stepTex;
  const N = 256, D = new Uint8Array(N);
  for (let i = 0; i < N; i++) D[i] = Math.round(255 * Math.min(1, Math.max(0, stepOffset(-32 + (i + 0.5) / N * 64) / 6 + 0.5)));
  stepTex = new THREE.DataTexture(D, N, 1, THREE.RedFormat, THREE.UnsignedByteType);
  stepTex.magFilter = stepTex.minFilter = THREE.LinearFilter;
  stepTex.needsUpdate = true;
  return stepTex;
}

function makeTerrainMaterial(far = false) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  patchMaterial(mat, {
    uniforms: { uFar: { value: far ? 1 : 0 }, uTrail: { value: trailTexture() }, uStepOff: { value: stepTexture() } },
    vertexHead: terrainVertexHead,
    fragmentHead: terrainFragHead,
    vertex: {
      project_vertex: `$
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vBio = aBio;`,
    },
    fragment: {
      map_fragment: `terrainSurface(); diffuseColor.rgb = tAlbedo;`,
      roughnessmap_fragment: `float roughnessFactor = tRough;`,
      normal_fragment_maps: `
        vec3 nW = normalize(vWorldNormal - vec3(tGrad.x, 0.0, tGrad.y));
        normal = normalize(mat3(viewMatrix) * nW);
        normal = bumpNormal(-vViewPosition, normal, tBump, ${far ? '0.0' : '0.03'});`,
      aomap_fragment: `reflectedLight.indirectDiffuse *= 1.0 - tOcc * 0.75; reflectedLight.directDiffuse *= 1.0 - tOcc * 0.3;`,
      emissivemap_fragment: `$
        float cst = caustics(vWorldPos);
        totalEmissiveRadiance += tAlbedo * uSunColor * cst * uSunIntensity * 0.22;`,
    },
  }, far ? 'terrain-far' : 'terrain-near');
  return mat;
}

export function buildTerrain(scene) {
  buildGrid();
  const N = GRID_N + 1;
  const step = (WORLD * 2) / GRID_N;
  // near mesh with skirt
  const vCount = N * N + N * 4;
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const bio = new Float32Array(vCount * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    pos[k * 3] = -WORLD + i * step; pos[k * 3 + 1] = heightGrid[k]; pos[k * 3 + 2] = -WORLD + j * step;
    const hl = heightGrid[j * N + Math.max(0, i - 1)], hr = heightGrid[j * N + Math.min(N - 1, i + 1)];
    const hd = heightGrid[Math.max(0, j - 1) * N + i], hu = heightGrid[Math.min(N - 1, j + 1) * N + i];
    const nx = hl - hr, ny = 2 * step, nz = hd - hu; const l = Math.hypot(nx, ny, nz);
    nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
    for (let c = 0; c < 4; c++) bio[k * 4 + c] = bioGrid[k * 4 + c];
  }
  const idx = [];
  for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx.push(a, c, b, c, d, b);
  }
  // skirt
  const edges = [];
  for (let i = 0; i < N; i++) edges.push(i);                    // z = -W
  for (let i = 0; i < N; i++) edges.push((N - 1) * N + i);      // z = +W
  for (let j = 0; j < N; j++) edges.push(j * N);                // x = -W
  for (let j = 0; j < N; j++) edges.push(j * N + N - 1);        // x = +W
  let sk = N * N;
  for (let e = 0; e < 4; e++) {
    for (let i = 0; i < N; i++) {
      const src = edges[e * N + i]; const k = sk + e * N + i;
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - 12; pos[k * 3 + 2] = pos[src * 3 + 2];
      nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2];
      for (let c = 0; c < 4; c++) bio[k * 4 + c] = bio[src * 4 + c];
      if (i < N - 1) { const a = src, b = edges[e * N + i + 1], c = k, d = k + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aBio', new THREE.BufferAttribute(bio, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const near = new THREE.Mesh(geo, makeTerrainMaterial(false));
  near.receiveShadow = true; near.castShadow = true;
  near.name = 'terrain';
  scene.add(near);

  // far mesh: polar grid, dense near the play area, sparse toward the horizon
  // (fine enough near the seam with the near mesh that canyon terraces don't step visibly)
  const RA = 400, RR = 170, R0 = 120, R1 = 3200;
  const sb = { canyon: 0, forest: 0, riparian: 0, bank: 0, arid: 0 };
  const FNv = (RA + 1) * (RR + 1);
  const fpos = new Float32Array(FNv * 3), fbio = new Float32Array(FNv * 4);
  for (let j = 0; j <= RR; j++) {
    const rr = R0 + (R1 - R0) * Math.pow(j / RR, 2.2);
    for (let i = 0; i <= RA; i++) {
      const a = i / RA * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      let h = farHeight(x, z);
      // hidden under the near mesh: sink it, but only a little right at the seam so no triangle tilts into view
      const inside = WORLD - Math.max(Math.abs(x), Math.abs(z));
      if (inside > 0) h -= Math.min(14, 0.15 + inside * 0.5);
      const k = j * (RA + 1) + i;
      fpos[k * 3] = x; fpos[k * 3 + 1] = h; fpos[k * 3 + 2] = z;
      // the same biomes as the near land continue out into the haze, giving way to the broad
      // forest-west / plateau-east split far out
      const west = Math.min(1, Math.max(0, (-(x + 0.35 * z) + 220) / 480));
      terrainSample(x, z, sb);
      const f = smoothstep(260, 620, rr);
      fbio[k * 4] = sb.canyon + (1 - west - sb.canyon) * f; fbio[k * 4 + 1] = sb.forest + (west - sb.forest) * f;
      fbio[k * 4 + 2] = sb.riparian * (1 - f); fbio[k * 4 + 3] = sb.arid + (1 - west - sb.arid) * f;
    }
  }
  const fidx = [];
  for (let j = 0; j < RR; j++) for (let i = 0; i < RA; i++) {
    const a = j * (RA + 1) + i, b = a + 1, c = a + RA + 1, d = c + 1;
    fidx.push(a, b, c, b, d, c);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fgeo.setAttribute('aBio', new THREE.BufferAttribute(fbio, 4));
  fgeo.setIndex(fidx);
  fgeo.computeVertexNormals();
  const farMesh = new THREE.Mesh(fgeo, makeTerrainMaterial(true));
  farMesh.receiveShadow = true;
  farMesh.name = 'farTerrain';
  scene.add(farMesh);
  return { near, far: farMesh };
}
