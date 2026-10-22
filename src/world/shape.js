// The shape of the world: stream path, water levels, and terrain height.
// Everything (terrain mesh, water ribbon, placement, camera, critters) samples these.
import * as THREE from 'three';
import { Simplex, smoothstep as S, clamp } from '../noise.js';

export const WORLD = 160;          // near terrain half-size (m)
export const BOUNDS = 118;         // placement extent for rocks, plants and critters
// where the camera may go: the focus stays in the valley (z, and lateral offset from the creek), and the
// eye itself stays well inside the detailed terrain so the edge of the world never comes into view
export const VIEW = { z: 98, west: 60, east: 62, cam: 126, maxDist: 125 };
export const WF_Z = -38;           // waterfall lip z
export const PZ0 = -340, PZ1 = 340; // stream profile range
export const PROFILE_N = 4096;

const noise = new Simplex(1337);
const noiseB = new Simplex(4242);
const G = (z, c, s) => Math.exp(-(((z - c) / s) ** 2));

function rawCenter(z) {
  return 15 * Math.sin(z * 0.019 + 0.6) + 7 * Math.sin(z * 0.043 + 2.1) + 2.0 * Math.sin(z * 0.103 + 0.3)
    // straighten a little at the waterfall
    - 3.0 * G(z, WF_Z, 10) * Math.sin(z * 0.043 + 2.1);
}
export const WF_DROP = 1.9;   // waterfall height (m)
export const WF_LEN = 0.85;   // horizontal length of the falling jet (m)
function fallDrop(z, soft) {
  if (soft > 0.01) {
    // beside the creek the step is two ledges of the bedrock band, the lower one a little downstream
    const a = S(WF_Z - 0.3 - soft, WF_Z + 0.45 + soft * 0.6, z), b = S(WF_Z + 0.95 - soft * 0.4, WF_Z + 1.7 + soft, z);
    return (WF_DROP + 0.05) * (0.58 * a + 0.42 * b);
  }
  // slight drawdown approaching the brink, then a free-fall parabola off the sill
  const t = clamp((z - WF_Z) / WF_LEN, 0, 1);
  return 0.05 * S(WF_Z - 2.5, WF_Z, z) + WF_DROP * t * t;
}
function rawLevel(z, soft = 0) {
  return 4.2 - 0.016 * z
    - fallDrop(z, soft)
    - 0.45 * S(27 - soft, 34 + soft, z)
    - 0.4 * S(95 - soft, 101 + soft, z);
}
function rawHalfW(z) {
  return 3.5 + 1.0 * Math.sin(z * 0.05 + 1) + 0.6 * Math.sin(z * 0.13 + 0.2)
    + 5.2 * G(z, WF_Z + 10, 8) + 3.4 * G(z, 68, 13)
    - 1.3 * G(z, 31, 5) - 1.0 * G(z, 98, 5) - 1.3 * G(z, WF_Z - 3, 4)
    + 1.5 * G(z, -100, 14)
    // shallow, wide riffles: the stepping-stone crossing and two gravel runs
    + 1.0 * G(z, 12, 8) + 2.2 * G(z, 48, 9) + 1.8 * G(z, -72, 10);
}
function rawDepth(z) {
  return 0.7 + 0.2 * Math.sin(z * 0.07 + 0.5) + 2.1 * G(z, WF_Z + 9, 7) + 1.1 * G(z, 68, 12)
    - 0.35 * G(z, 31, 4) - 0.3 * G(z, 98, 4) + 0.6 * G(z, -100, 10)
    - 0.6 * G(z, 12, 6) - 0.42 * G(z, 48, 9) - 0.55 * G(z, -72, 10)
    // the crest above the falls is a shallow, bouldery shelf (pocket water); it only drops away under the jets
    - 0.8 * S(WF_Z + 0.2, WF_Z - 0.6, z) * G(z, WF_Z - 1.5, 2.5);
}
function rawTurb(z) {
  return 0.8 * G(z, WF_Z + 1.1, 1.6) + 0.55 * G(z, 31, 4) + 0.5 * G(z, 98, 3.5) + 0.25 * G(z, WF_Z - 6, 6)
    + 0.1 * G(z, 12, 5) + 0.2 * G(z, 48, 7) + 0.14 * G(z, -72, 8);
}

// ---- Precomputed profile (fast lookups, shared with GPU) ----
const P = {
  center: new Float32Array(PROFILE_N), level: new Float32Array(PROFILE_N), halfW: new Float32Array(PROFILE_N),
  speed: new Float32Array(PROFILE_N), slope: new Float32Array(PROFILE_N), depth: new Float32Array(PROFILE_N),
  turb: new Float32Array(PROFILE_N), curv: new Float32Array(PROFILE_N),
};
const Q = 3.6;
for (let i = 0; i < PROFILE_N; i++) {
  const z = PZ0 + (PZ1 - PZ0) * i / (PROFILE_N - 1);
  const c = rawCenter(z), h = 0.05;
  P.center[i] = c;
  P.slope[i] = (rawCenter(z + h) - rawCenter(z - h)) / (2 * h);
  P.curv[i] = (rawCenter(z + 2) - 2 * c + rawCenter(z - 2)) / 4;
  P.level[i] = rawLevel(z);
  P.halfW[i] = rawHalfW(z);
  P.depth[i] = rawDepth(z);
  P.turb[i] = rawTurb(z);
  const fall = G(z, WF_Z + 0.4, 0.8);
  P.speed[i] = clamp(Q / (2 * P.halfW[i] * P.depth[i] * 0.7), 0.1, 2.4) + 2.2 * fall;
}

function sampleP(arr, z) {
  const f = (z - PZ0) / (PZ1 - PZ0) * (PROFILE_N - 1);
  const i = clamp(Math.floor(f), 0, PROFILE_N - 2); const t = clamp(f - i, 0, 1);
  return arr[i] * (1 - t) + arr[i + 1] * t;
}
export const streamCenter = (z) => sampleP(P.center, z);
export const waterLevel = (z) => rawLevel(z);
export const streamHalfW = (z) => sampleP(P.halfW, z);
export const streamSpeed = (z) => sampleP(P.speed, z);
export const streamSlope = (z) => sampleP(P.slope, z);
export const streamDepth = (z) => sampleP(P.depth, z);
export const streamTurb = (z) => sampleP(P.turb, z);

// Signed lateral offset from stream centre, corrected for meander angle.
export function lateral(x, z) {
  const s = streamSlope(z);
  return (x - streamCenter(z)) / Math.sqrt(1 + s * s);
}

// Flow velocity at a point (m/s) in xz. Fast in the middle, slow at edges.
export function flowAt(x, z, out = { x: 0, z: 0 }) {
  const s = streamSlope(z); const inv = 1 / Math.sqrt(1 + s * s);
  const u = Math.abs(lateral(x, z)) / streamHalfW(z);
  const sp = streamSpeed(z) * Math.max(0, 1 - u * u) * 1.15;
  out.x = s * inv * sp; out.z = inv * sp;
  return out;
}

// ---------------- Terrain ----------------
function eastDist(z) { return 33 + 9 * Math.sin(z * 0.031 + 1) + 7 * noise.noise2(z * 0.017, 3.3) + 6 * G(z, -20, 25); }
function westDist(z) { return 26 + 8 * Math.sin(z * 0.027 + 2) + 5 * noise.noise2(z * 0.02, 9.1); }

// The mountain: a granite massif west of the meadow, its summit about 165 m above the creek. Forested lower
// slopes steepen into broken rock and snowfields; high on the east face a glacier once scooped out a cirque,
// and a small tarn sits in the bowl under the headwall. A spur runs down toward the stepping stones.
export const PEAK = { x: -165, z: -40 };
const CREST = [[-170, -110], [-162, 30]];
// height by distance east of the crest: [distance, height]
const PROFILE = [[0, 172], [12, 158], [26, 124], [38, 92], [47, 76], [60, 64], [78, 50], [96, 37], [112, 25], [126, 15], [140, 7], [155, 2], [175, 0]];
const SPUR = [[-132, -24], [-96, -10], [-56, 2]];
export const LAKE = { x: -118, z: -34, r: 9, y: 0 };   // y: the water level, set from the terrain below
const CIRQUE = { R: 24, deep: 5.2 };
function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return [Math.hypot(x - ax - vx * t, z - az - vz * t), t];
}
function profileAt(d) {
  const P = PROFILE;
  if (d <= 0) return P[0][1];
  for (let i = 0; i < P.length - 1; i++) {
    if (d > P[i + 1][0]) continue;
    // smooth (cosine-eased) between control points, so slopes flow from one into the next
    const t = (d - P[i][0]) / (P[i + 1][0] - P[i][0]);
    const m0 = i ? (P[i + 1][1] - P[i - 1][1]) / (P[i + 1][0] - P[i - 1][0]) : (P[1][1] - P[0][1]) / P[1][0];
    const m1 = i < P.length - 2 ? (P[i + 2][1] - P[i][1]) / (P[i + 2][0] - P[i][0]) : 0;
    const L = P[i + 1][0] - P[i][0], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * L * m0 + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * L * m1;
  }
  return 0;
}
function mountain(x, z) {
  const wx = x + 10 * noiseB.noise2(x * 0.011 + 3.1, z * 0.011), wz = z + 10 * noiseB.noise2(x * 0.011 - 5.3, z * 0.011 + 2.2);
  const [dc] = segDist(wx, wz, CREST[0][0], CREST[0][1], CREST[1][0], CREST[1][1]);
  // the crest sags into saddles north and south of the summit
  const sag = 1 - 0.28 * (1 - G(wz, PEAK.z, 40));
  let m = profileAt(dc) * sag;
  // the spur: a broad, rounded shoulder the trail climbs
  for (let i = 0; i < SPUR.length - 1; i++) {
    const [d, t] = segDist(wx, wz, SPUR[i][0], SPUR[i][1], SPUR[i + 1][0], SPUR[i + 1][1]);
    m += (i === 0 ? 6 + 4 * t : 10 * (1 - t)) * Math.exp(-((d / 16) ** 2));
  }
  // ribs and gullies running down the fall line, broken crags up high
  const rib = noise.ridged2(x * 0.012 + 2.3, z * 0.026, 2) - 0.45;
  m += rib * 3 * S(15, 70, m) * (1 - S(120, 160, m) * 0.5);
  // the headwall: buttresses and the gullies between them running straight down the face (the gullies
  // keep their snow longest)
  const gul = noise.ridged2(x * 0.02 + 5.1, z * 0.055 + 1.7, 3) - 0.5;
  m += Math.sign(gul) * Math.pow(Math.abs(gul) * 2, 1.4) * 8 * S(70, 115, m);
  m += (noise.ridged2(x * 0.04 + 7, z * 0.04, 3) - 0.4) * 12 * S(84, 128, m);
  m += (noise.ridged2(x * 0.11 + 2, z * 0.11 - 3, 2) - 0.45) * 4 * S(90, 125, m); // broken crags and ledges
  m += noise.fbm2(x * 0.09, z * 0.09, 2) * 1.6 * S(8, 40, m);
  return m;
}
// the cirque: a bowl scooped into the face under a steep headwall, the tarn's basin in its floor, and a low
// moraine damming it on the downhill side. It only ever cuts into the mountain, apart from the moraine.
function cirque(x, z, h) {
  const nx = noise.noise2(x * 0.06 + 1.7, z * 0.06), nz = noise.noise2(x * 0.06 - 4.1, z * 0.06 + 3.3);
  const d = Math.hypot(x - LAKE.x + nx * 2.2, (z - LAKE.z + nz * 2.2) * 0.9);
  const R = CIRQUE.R, L = LAKE.r;
  if (d > R + 12) return h;
  let bowl;
  // a shelf of shallows round the edge, then a drop-off into the deep middle
  if (d < L) { const t = d / L; bowl = LAKE.y - 0.3 - 1.0 * (1 - t * t) - CIRQUE.deep * (1 - S(0.3, 0.78, t)); }
  else bowl = LAKE.y - 0.3 + 0.9 * S(L, L + 1.5, d) + 14 * ((d - L) / (R - L)) ** 2;
  bowl += noise.fbm2(x * 0.15, z * 0.15, 2) * 0.35 * S(L + 1, L + 5, d);
  h = Math.min(h, h + (bowl - h) * (1 - S(R - 6, R + 12, d)));
  if (d > L - 0.2) {
    // the moraine: a rounded bank of rubble just above the water, falling away outside
    const lip = LAKE.y + 0.5 + 0.9 * S(L, L + 2.5, d) * (1 - S(L + 3, L + 7, d));
    h = Math.max(h, h + (lip - h) * (1 - S(L + 3, L + 9, d)));
  }
  return h;
}

// how far (along z) the falls' step is offset at a given lateral distance from the creek: it zig-zags along
// the bedrock's joints, a metre or so either way, on each bank independently (none in the channel itself)
export function stepOffset(lat) {
  const d = Math.abs(lat), s = lat < 0 ? 0 : 1;
  return (1.3 * noise.noise2(d * 0.15 + s * 7.3, 1.3) + 0.5 * noise.noise2(d * 0.5, s * 3.1 + 2.0)) * S(2.5, 7, d);
}
// where the falls' bedrock band shows at the surface beside the creek (0..1): along the step, fading out
// some 20-odd metres into each bank
export function outcropBand(x, z, d = Math.abs(lateral(x, z)), hw = streamHalfW(z)) {
  const bz = z + stepOffset(lateral(x, z)) - (WF_Z - 0.6) + noise.noise2(x * 0.08, 7.7) * 0.5;
  if (Math.abs(bz) > 3.5) return 0;
  return Math.exp(-((bz / 1.8) ** 2)) * (1 - S(16, 26, d + noise.noise2(x * 0.05, z * 0.05) * 5)) * S(hw * 1.15, hw * 1.7, d);
}

// Returns height and fills biome weights.
const _bio = { canyon: 0, forest: 0, riparian: 0, bank: 0, arid: 0 };
export function terrainBase(x, z, bio = _bio) {
  const c = streamCenter(z), hw = streamHalfW(z), s = streamSlope(z);
  const k = Math.sqrt(1 + s * s);
  const dxRaw = x - c;
  const dx = dxRaw / k;
  const d = Math.abs(dx);
  const Wz = waterLevel(z);
  const D = streamDepth(z);
  const curv = sampleP(P.curv, z);

  // irregular shoreline
  const sn = noise.fbm2(x * 0.07, z * 0.07, 3) * 0.22 + noise.noise2(x * 0.35, z * 0.35) * 0.05;
  const u = d / hw + sn;

  // outer vs inner bank of a bend
  const outer = clamp(-Math.sign(dx) * Math.sign(curv) * Math.min(1, Math.abs(curv) * 60), -1, 1);
  const bankH = 0.55 + 0.45 * outer + 0.15 * noise.noise2(x * 0.05, z * 0.05);
  const bankW = 0.55 - 0.3 * outer; // inner bends: wide gravel bars

  let h;
  // soft version of level for the floodplain (waterfall ledge widens away from stream)
  // beside the falls the ledge stays a steep wall for a few metres (the sides of the plunge-pool alcove)
  const soft = Math.min(12, Math.max(0, d - hw * (1 + 0.7 * G(z, WF_Z, 6))) * 0.18);
  // in plan the step follows the joints of the bedrock out into the banks rather than a straight line
  const floorLevel = soft > 0.01 ? rawLevel(z + stepOffset(dx) * G(z, WF_Z, 9), soft) : Wz;
  if (u < 1) {
    const t = Math.max(0, u);
    const bed = Wz - D * (1 - Math.pow(t, 2.2));
    // stones & ripples on the bed
    const bump = noise.noise2(x * 0.9, z * 0.9) * 0.06 + noise.ridged2(x * 0.25, z * 0.25, 2) * 0.1;
    h = bed + bump * (1 - t * 0.5);
  } else {
    const bank = bankH * S(1, 1 + bankW + 0.5, u);
    const fl = Math.max(0, d - hw * (1.6 + bankW)) * 0.028;
    h = Wz + (floorLevel - Wz) * S(1, 3, u) + bank + fl;
    // meadow undulation
    h += (noise.fbm2(x * 0.03, z * 0.03, 3) * 0.9 + noise.noise2(x * 0.12, z * 0.12) * 0.15) * S(hw * 2, hw * 5, d);
    // the bedrock band the falls drop over breaks the surface along the lip of the step, out into both
    // banks: low rounded knobs of ice-smoothed granite
    const ob = outcropBand(x, z, d, hw);
    if (ob > 0) h += ob * (0.25 + 0.5 * Math.max(0, noise.noise2(x * 0.3 + 4.1, z * 0.3)));
  }

  // East canyon walls (Utah sandstone, terraced)
  let e = dxRaw - eastDist(z);
  e += noise.fbm2(x * 0.018, z * 0.018, 4) * 14 + noise.noise2(x * 0.06, z * 0.06) * 3;
  let canyon = 0;
  if (e > -12) {
    const hRamp = 52 * Math.pow(S(-8, 46, e), 0.9);
    const step = 7.2 + 1.5 * noiseB.noise2(x * 0.01, z * 0.01);
    const t = hRamp / step;
    const fi = Math.floor(t), fr = t - fi;
    const riser = S(0.62, 1.0, fr);
    const terr = (fi + riser) * step;
    // talus apron at the base of each riser
    const tal = S(0, 0.6, fr) * 0.25 * step * (1 - riser);
    const hc = terr + tal + noise.noise2(x * 0.2, z * 0.2) * 0.3 * S(0, 4, hRamp);
    h += hc;
    canyon = S(-6, 6, e);
  }

  // West forested hills (Colorado side)
  let wv = -dxRaw - westDist(z);
  wv += noise.fbm2(x * 0.02 + 5, z * 0.02, 3) * 10;
  let forest = 0;
  if (wv > -15) {
    const r = noise.ridged2(x * 0.012, z * 0.012, 4);
    const hill = 26 * S(-6, 75, wv) + r * 12 * S(0, 50, wv) + noise.fbm2(x * 0.04, z * 0.04, 3) * 2.5 * S(-5, 20, wv);
    // the foothills give way to the mountain proper
    const mtn = mountain(x, z), mw = S(-25, 40, wv);
    h += hill * (1 - mw) + Math.max(mtn, hill * 0.6) * mw;
    if (LAKE.y) h = cirque(x, z, h);
    forest = S(-14, 6, wv);
  }

  // A secondary hint of uplift across the waterfall ledge (fault scarp)
  bio.canyon = canyon;
  bio.forest = forest;
  bio.riparian = 1 - S(hw * 1.4, hw * 3.5, d);
  bio.bank = u;
  // the desert (east) side dries out once you leave the creek's reach: sand, sage, juniper
  const ar = dx / hw + noise.fbm2(x * 0.035 + 3.1, z * 0.035, 2) * 1.6;
  bio.arid = Math.max(canyon, S(1.5, 3.4, ar) * (1 - forest));
  return h;
}

// the tarn sits a few metres down into the slope where the cirque is cut
LAKE.y = terrainBase(LAKE.x, LAKE.z) - 6;
export function inLake(x, z, margin = 0) { return Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4 && groundAt(x, z) < LAKE.y - margin; }

// ---------------- Trail, campsites and the big boulder ----------------
// A faint footpath leaves the west end of the stepping stones, crosses the meadow below the boulder and
// climbs the mountain's east face in long traverses and switchbacks to the tarn. The route was laid out
// offline by a grade-limited path search (legs under 20%, cut-and-filled turns); here it is smoothed and
// benched into the hillside.
const TRAIL_CTRL = [[10.4,12.2],[8.5,11.7],[6.5,11.1],[4.6,10.5],[2.7,9.9],[0.8,9.3],[-1.0,8.6],[-3.0,8.1],[-4.9,7.5],[-6.8,6.9],[-8.6,6.1],[-10.3,5.1],[-12.1,4.1],[-13.8,3.0],[-15.4,1.9],[-16.9,0.6],[-18.3,-0.8],[-19.7,-2.2],[-21.2,-3.6],[-22.8,-4.8],[-24.3,-6.1],[-25.3,-7.8],[-26.1,-9.7],[-26.7,-11.6],[-27.3,-13.5],[-28.0,-15.4],[-28.6,-17.3],[-29.2,-19.2],[-29.7,-21.1],[-30.0,-23.1],[-30.3,-25.1],[-30.2,-27.0],[-29.5,-28.9],[-28.9,-30.8],[-28.5,-32.8],[-28.4,-34.8],[-28.8,-36.8],[-29.9,-38.4],[-31.8,-38.9],[-33.6,-38.1],[-35.2,-36.8],[-36.4,-35.3],[-37.4,-33.6],[-38.1,-31.7],[-38.4,-29.7],[-38.5,-27.7],[-38.5,-25.7],[-38.5,-23.7],[-38.8,-21.8],[-39.0,-19.8],[-39.0,-17.8],[-39.0,-15.8],[-39.0,-13.8],[-39.0,-11.8],[-38.7,-9.8],[-38.4,-7.8],[-38.1,-5.8],[-38.0,-3.8],[-38.1,-1.9],[-38.5,0.1],[-39.0,2.0],[-39.8,3.9],[-40.8,5.6],[-41.5,7.5],[-42.3,9.3],[-43.2,11.1],[-44.0,12.9],[-44.6,14.8],[-45.2,16.7],[-45.5,18.7],[-45.5,20.7],[-45.7,22.7],[-46.1,24.7],[-46.9,26.5],[-48.1,28.1],[-49.9,28.8],[-51.8,28.2],[-53.0,26.7],[-53.8,24.8],[-54.3,22.9],[-54.5,20.9],[-55.0,19.0],[-55.6,17.1],[-56.3,15.2],[-57.2,13.4],[-58.1,11.6],[-58.7,9.7],[-59.0,7.7],[-59.0,5.7],[-59.0,3.7],[-58.8,1.7],[-58.5,-0.2],[-58.3,-2.2],[-58.3,-4.2],[-58.7,-6.2],[-59.4,-8.0],[-60.9,-9.3],[-62.9,-9.3],[-64.5,-8.2],[-65.7,-6.6],[-66.6,-4.8],[-67.2,-2.9],[-67.8,-1.0],[-68.5,0.8],[-69.6,2.5],[-71.2,3.7],[-73.1,3.3],[-74.2,1.7],[-74.6,-0.2],[-74.6,-2.2],[-74.3,-4.2],[-73.7,-6.1],[-73.2,-8.0],[-73.1,-10.0],[-73.4,-12.0],[-73.7,-14.0],[-74.2,-15.9],[-74.8,-17.8],[-75.4,-19.7],[-76.0,-21.6],[-76.7,-23.5],[-76.8,-25.5],[-76.4,-27.5],[-75.9,-29.4],[-75.4,-31.3],[-75.1,-33.3],[-75.0,-35.3],[-75.1,-37.3],[-75.4,-39.3],[-75.5,-41.3],[-75.2,-43.3],[-74.6,-45.2],[-74.5,-47.1],[-74.6,-49.1],[-74.9,-51.1],[-75.0,-53.1],[-74.9,-55.1],[-74.6,-57.1],[-74.5,-59.1],[-74.5,-61.1],[-74.8,-63.1],[-75.2,-65.0],[-76.1,-66.8],[-77.3,-68.3],[-79.2,-68.9],[-81.0,-68.1],[-82.1,-66.4],[-82.9,-64.6],[-83.3,-62.6],[-83.6,-60.7],[-84.5,-58.9],[-85.2,-57.0],[-85.5,-55.0],[-85.5,-53.0],[-85.6,-51.0],[-85.9,-49.1],[-86.7,-47.2],[-88.0,-45.8],[-90.0,-45.8],[-91.4,-47.2],[-92.1,-49.0],[-92.4,-51.0],[-92.7,-53.0],[-93.1,-54.9],[-94.0,-56.7],[-95.3,-58.3],[-96.5,-59.8],[-97.2,-61.7],[-97.7,-63.6],[-98.1,-65.6],[-98.7,-67.5],[-99.5,-69.3],[-100.5,-71.1],[-101.2,-73.0],[-101.9,-74.8],[-103.1,-76.4],[-104.9,-77.2],[-106.3,-76.1],[-106.5,-74.1],[-106.0,-72.2],[-105.1,-70.4],[-104.4,-68.5],[-104.0,-66.6],[-103.9,-64.6],[-104.3,-62.6],[-105.8,-61.4],[-107.5,-62.3],[-108.5,-64.0],[-109.1,-65.9],[-109.8,-67.8],[-110.6,-69.6],[-111.9,-71.1],[-113.8,-71.7],[-115.0,-70.2],[-114.9,-68.2],[-114.5,-66.2],[-114.5,-64.3],[-114.3,-62.3],[-113.8,-60.3],[-112.8,-58.6],[-111.8,-56.9],[-111.0,-55.1],[-110.6,-53.1],[-110.3,-51.1],[-110.0,-49.2],[-109.5,-46.8],[-109.0,-44.3],[-108.6,-41.9],[-108.1,-39.4],[-107.6,-37.0],[-106.3,-32.0],[-106.4,-27.0],[-108.2,-22.6],[-110.8,-19.0]];
export const TRAIL = [];   // { x, z, y (ground before benching), s (distance along) }
{
  const C = TRAIL_CTRL, cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  let s = 0;
  for (let i = 0; i < C.length - 1; i++) {
    const a = C[Math.max(0, i - 1)], b = C[i], c = C[i + 1], d = C[Math.min(C.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 0.75));
    for (let k = 0; k < n; k++) {
      const t = k / n, x = cr(a[0], b[0], c[0], d[0], t), z = cr(a[1], b[1], c[1], d[1], t);
      const q = TRAIL[TRAIL.length - 1];
      if (q) s += Math.hypot(x - q.x, z - q.z);
      TRAIL.push({ x, z, y: 0, s });
    }
  }
  const e = C[C.length - 1], q = TRAIL[TRAIL.length - 1];
  TRAIL.push({ x: e[0], z: e[1], y: 0, s: s + Math.hypot(e[0] - q.x, e[1] - q.z) });
  for (const p of TRAIL) p.y = terrainBase(p.x, p.z);
  // the tread follows the ground, but eased so it never jerks up and down over little bumps
  for (let it = 0; it < 14; it++) for (let i = 1; i < TRAIL.length - 1; i++) TRAIL[i].y = (TRAIL[i - 1].y + TRAIL[i].y * 2 + TRAIL[i + 1].y) / 4;
  // ...and held to a walkable grade through the turns: cut the humps (upper envelope) and fill the dips
  // (lower envelope) under a grade limit, and take the middle of the two
  {
    const GM = 0.22, n = TRAIL.length, U = TRAIL.map((p) => p.y), L = U.slice();
    for (let i = 1; i < n; i++) { const ds = TRAIL[i].s - TRAIL[i - 1].s; U[i] = Math.min(U[i], U[i - 1] + GM * ds); L[i] = Math.max(L[i], L[i - 1] - GM * ds); }
    for (let i = n - 2; i >= 0; i--) { const ds = TRAIL[i + 1].s - TRAIL[i].s; U[i] = Math.min(U[i], U[i + 1] + GM * ds); L[i] = Math.max(L[i], L[i + 1] - GM * ds); }
    for (let i = 0; i < n; i++) TRAIL[i].y = (U[i] + L[i]) / 2;
  }
}
// segment lookup grid
const TG = 8, trailGrid = new Map();
for (let i = 0; i < TRAIL.length - 1; i++) {
  const a = TRAIL[i], b = TRAIL[i + 1];
  for (const [x, z] of [[a.x, a.z], [b.x, b.z]]) for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
    const k = `${Math.floor(x / TG) + gx},${Math.floor(z / TG) + gz}`;
    let l = trailGrid.get(k); if (!l) trailGrid.set(k, l = []);
    if (l[l.length - 1] !== i) l.push(i);
  }
}
// nearest point on the trail (within ~8 m): distance, centreline ground height, distance along
const _tn = { d: Infinity, y: 0, s: 0, x: 0, z: 0 };
export function trailNear(x, z, out = _tn) {
  out.d = Infinity;
  const l = trailGrid.get(`${Math.floor(x / TG)},${Math.floor(z / TG)}`);
  if (!l) return out;
  for (const i of l) {
    const a = TRAIL[i], b = TRAIL[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz || 1;
    const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / L2, 0, 1);
    const px = a.x + vx * t, pz = a.z + vz * t, d = Math.hypot(x - px, z - pz);
    if (d < out.d) { out.d = d; out.y = a.y + (b.y - a.y) * t; out.s = a.s + (b.s - a.s) * t; out.x = px; out.z = pz; }
  }
  return out;
}
export const trailDist = (x, z) => trailNear(x, z).d;

// Campsites: level clearings along the way where a camp pitches cleanly (the camp can still go on any
// flat, dry spot). Each is levelled to the mean height of its ground, blending out over a few metres.
export const CAMPSITES = [
  { name: 'Boulder Meadow', x: -7, z: 21, r: 5.5 },
  { name: 'Gravel Bar', x: -4, z: 46, r: 5 },
  { name: 'Aspen Flat', x: -18, z: -17.4, r: 5 },
  { name: 'Spruce Shelf', x: -52.3, z: 5.5, r: 4.5 },
  { name: 'High Camp', x: -90.5, z: -75.3, r: 4.5 },
  { name: 'Tarn Camp', x: -114.4, z: -13.3, r: 4.5, blend: 6 },
];
for (const c of CAMPSITES) {
  let sum = 0, n = 0;
  for (let a = 0; a < 6.28; a += 0.5) for (const rr of [0, c.r * 0.5, c.r]) { sum += terrainBase(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr); n++; }
  c.y = sum / n;
}
export function campsiteAt(x, z, pad = 0) {
  for (const c of CAMPSITES) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return c;
  return null;
}

// The granite erratic in the meadow west of the crossing: a glacial deposit twice the size of a house (rocks.js builds it)
export const ERRATIC = { x: -24, z: 29, r: 10.4, h: 12.4 };

const _trn = { d: 0, y: 0, s: 0, x: 0, z: 0 };
export function terrainSample(x, z, bio = _bio) {
  let h = terrainBase(x, z, bio);
  // none of this reaches into the creek bed
  const dry = S(1.08, 1.6, Math.abs(lateral(x, z)) / streamHalfW(z));
  if (dry <= 0) return h;
  // campsites: a level pad, its edge eased back into the slope
  for (const c of CAMPSITES) {
    const d = Math.hypot(x - c.x, z - c.z), b = c.blend ?? 9;
    if (d < c.r + b) h += (c.y - h) * (1 - S(c.r, c.r + b, d)) * dry;
  }
  // the trail (on top of everything): benched level across the slope, its tread worn a few centimetres in
  const t = trailNear(x, z, _trn);
  if (t.d < 2.8) {
    h += (t.y - h) * (1 - S(0.9, 2.8, t.d)) * 0.97 * dry;
    h -= 0.05 * (1 - S(0.25, 0.75, t.d)) * dry;
  }
  return h;
}

export function terrainHeightRaw(x, z) { return terrainSample(x, z); }

// Far terrain adds big mountains and mesas beyond the play area.
const noiseC = new Simplex(9001);
export function farHeight(x, z) {
  const h = terrainSample(x, z);
  const r = Math.hypot(x, z);
  const m = S(175, 760, r);
  if (m <= 0) return h;
  const c = streamCenter(clamp(z, PZ0, PZ1));
  const valley = 1 - (1 - S(30, 380, Math.abs(x - c))) * S(120, 260, Math.abs(z));
  // domain warp for organic ranges
  const wx = x + 160 * noiseC.fbm2(x * 0.0012, z * 0.0012, 3);
  const wz = z + 160 * noiseC.fbm2(x * 0.0012 + 7.3, z * 0.0012 - 2.1, 3);
  const westW = S(220, -260, x + 0.35 * z);
  // Forested foothills close in, the high Rockies far out in the haze
  const hills = (noiseC.fbm2(wx * 0.0028, wz * 0.0028, 4) * 0.5 + 0.55) * 120 * S(170, 480, r);
  // broad massifs with gentle crests (soft-ridged), detail in small amplitude
  let sr = 0, amp = 1, fq = 0.00055, nrm = 0;
  for (let o = 0; o < 5; o++) { const n = noiseC.noise2(wx * fq + o * 13.1, wz * fq - o * 7.7); sr += amp * (1 - n * n); nrm += amp; amp *= 0.45; fq *= 2.1; }
  sr /= nrm;
  const massif = Math.pow(S(0.35, 0.95, sr), 1.6);
  const peaks = hills + massif * 820 * S(650, 2000, r);
  // Colorado Plateau: terraced mesas and buttes
  const mb = noiseB.fbm2(wx * 0.0021, wz * 0.0021, 4);
  let plateau = S(-0.08, 0.06, mb) * 95 + S(0.18, 0.26, mb) * 55 + S(0.38, 0.44, mb) * 40;
  const step = 22;
  const tf = plateau / step, fi = Math.floor(tf), fr = tf - fi;
  plateau = (fi + S(0.7, 1.0, fr)) * step + noiseC.noise2(x * 0.02, z * 0.02) * 3;
  return h + (peaks * westW + plateau * (1 - westW) * S(260, 700, r)) * m * valley;
}

// ---- Height grid for fast exact sampling of the near mesh ----
export const GRID_N = 400; // segments
const GRID_STEP = (WORLD * 2) / GRID_N;
export const heightGrid = new Float32Array((GRID_N + 1) * (GRID_N + 1));
export const bioGrid = new Float32Array((GRID_N + 1) * (GRID_N + 1) * 4);
let gridBuilt = false;
export function buildGrid() {
  if (gridBuilt) return;
  const b = { canyon: 0, forest: 0, riparian: 0, bank: 0, arid: 0 };
  for (let j = 0; j <= GRID_N; j++) {
    const z = -WORLD + j * GRID_STEP;
    for (let i = 0; i <= GRID_N; i++) {
      const x = -WORLD + i * GRID_STEP;
      const k = j * (GRID_N + 1) + i;
      heightGrid[k] = terrainSample(x, z, b);
      bioGrid[k * 4] = b.canyon; bioGrid[k * 4 + 1] = b.forest; bioGrid[k * 4 + 2] = b.riparian; bioGrid[k * 4 + 3] = b.arid;
    }
  }
  gridBuilt = true;
}
export function groundAt(x, z) {
  const fx = (x + WORLD) / GRID_STEP, fz = (z + WORLD) / GRID_STEP;
  if (fx < 0 || fz < 0 || fx >= GRID_N || fz >= GRID_N) return farHeight(x, z);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const N = GRID_N + 1;
  const a = heightGrid[j * N + i], b = heightGrid[j * N + i + 1], c = heightGrid[(j + 1) * N + i], d = heightGrid[(j + 1) * N + i + 1];
  // match mesh triangulation: (a, c, b) and (c, d, b)
  if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}
export function bioAt(x, z, out = { canyon: 0, forest: 0, riparian: 0, arid: 0 }) {
  const i = clamp(Math.round((x + WORLD) / GRID_STEP), 0, GRID_N), j = clamp(Math.round((z + WORLD) / GRID_STEP), 0, GRID_N);
  const k = (j * (GRID_N + 1) + i) * 4;
  out.canyon = bioGrid[k]; out.forest = bioGrid[k + 1]; out.riparian = bioGrid[k + 2]; out.arid = bioGrid[k + 3];
  return out;
}
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.5;
  out.set(groundAt(x - e, z) - groundAt(x + e, z), 2 * e, groundAt(x, z - e) - groundAt(x, z + e)).normalize();
  return out;
}
// Water surface height if there is water here, else -Infinity
export function waterAt(x, z) {
  const w = waterLevel(z);
  return groundAt(x, z) < w ? w : -Infinity;
}
export function isWater(x, z, margin = 0) { return groundAt(x, z) < waterLevel(z) - margin; }
export function waterDepthAt(x, z) { return Math.max(0, waterLevel(z) - groundAt(x, z)); }

// ---- GPU profile texture: row0 = center, level, halfW, speed; row1 = slope, depth, turb, curv ----
let profileTex = null;
export function getProfileTexture() {
  if (profileTex) return profileTex;
  const data = new Float32Array(PROFILE_N * 2 * 4);
  for (let i = 0; i < PROFILE_N; i++) {
    data[i * 4] = P.center[i]; data[i * 4 + 1] = P.level[i]; data[i * 4 + 2] = P.halfW[i]; data[i * 4 + 3] = P.speed[i];
    const o = (PROFILE_N + i) * 4;
    data[o] = P.slope[i]; data[o + 1] = P.depth[i]; data[o + 2] = P.turb[i]; data[o + 3] = P.curv[i];
  }
  profileTex = new THREE.DataTexture(data, PROFILE_N, 2, THREE.RGBAFormat, THREE.FloatType);
  profileTex.magFilter = THREE.LinearFilter; profileTex.minFilter = THREE.LinearFilter;
  profileTex.wrapS = profileTex.wrapT = THREE.ClampToEdgeWrapping;
  profileTex.needsUpdate = true;
  return profileTex;
}
// GLSL helpers to sample profile
export const profileGLSL = /* glsl */`
uniform sampler2D uProfile;
vec4 profileA(float z){ float u = (z - (${PZ0.toFixed(1)})) / (${(PZ1 - PZ0).toFixed(1)}); u = (u*${(PROFILE_N - 1).toFixed(1)} + 0.5)/${PROFILE_N.toFixed(1)}; return texture2D(uProfile, vec2(u, 0.25)); }
vec4 profileB(float z){ float u = (z - (${PZ0.toFixed(1)})) / (${(PZ1 - PZ0).toFixed(1)}); u = (u*${(PROFILE_N - 1).toFixed(1)} + 0.5)/${PROFILE_N.toFixed(1)}; return texture2D(uProfile, vec2(u, 0.75)); }
float waterLevelAt(float z){ return profileA(z).y; }
`;
