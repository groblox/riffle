// Rocks: procedural boulders (sandstone blocks and slabs, granite rounds), clusters, pebbles,
// stepping stones — and rock play: pick up, carry, stack, throw and turn over the small ones.
import * as THREE from 'three';
import { RNG, clamp, smoothstep } from '../noise.js';
import { buildGrid, groundAt, waterLevel, streamCenter, streamHalfW, streamSlope, bioAt, normalAt, WF_Z, BOUNDS, WORLD, isWater, trailNear, campsiteAt, ERRATIC, LAKE, inLake, stepOffset } from './shape.js';
import { makeRockMaterial, makeRockGeometry, PROF_N } from './rockgen.js';
import { U } from '../core/env.js';
export { makeRockMaterial };

// ---- layout ----
export function layoutRocks(seed = 9) {
  buildGrid(); // placement samples the terrain height grid
  const rng = new RNG(seed);
  const rocks = [];
  // the trail's tread, the campsites and the erratic's footprint stay clear of loose rock
  const blocked = (x, z, r) => trailNear(x, z).d < 0.9 + r * 0.8 || !!campsiteAt(x, z, r + 0.6) || Math.hypot(x - ERRATIC.x, z - ERRATIC.z) < ERRATIC.r * 0.95 + r * 0.5;
  const add = (r) => { if (!r.stream && !r.house && (blocked(r.x, r.z, r.r) || (!r.lake && inLake(r.x, r.z, -0.2)))) return r; rocks.push(r); return r; };
  const kindAt = (x, z) => { const b = bioAt(x, z); return b.canyon > 0.5 ? 0 : b.forest > 0.5 ? 1 : (rng.chance(0.5) ? 0 : 1); };
  // a big rock rarely sits alone: spalls and smaller stones gather at its foot
  const satellites = (p, n) => {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, 6.28), d = p.r * rng.range(0.8, 1.15);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const g = groundAt(x, z);
      if (g < waterLevel(z) + 0.05) continue;
      const r = p.r * rng.range(0.14, 0.38);
      const h = r * rng.range(0.5, 0.85);
      add({ x, z, y: g - h * rng.range(0.22, 0.4), r, h, rot: rng.range(0, 6.28), kind: p.kind, moss: p.moss * rng.range(0.5, 1), sat: true });
    }
  };

  // boulders in the stream
  for (let z = -BOUNDS - 20; z < BOUNDS + 20; z += rng.range(2.5, 7)) {
    if (z > WF_Z - 4 && z < WF_Z + 16) continue; // keep the falls and plunge pool open
    const hw = streamHalfW(z), c = streamCenter(z), k = Math.sqrt(1 + streamSlope(z) ** 2);
    const cnt = rng.chance(0.35) ? 2 : 1;
    for (let q = 0; q < cnt; q++) {
      const lat = rng.range(-0.85, 0.85) * hw;
      const x = c + lat * k;
      const wl = waterLevel(z);
      const bed = groundAt(x, z);
      const r = rng.range(0.35, 1.2) * (rng.chance(0.15) ? 1.5 : 1);
      const depth = wl - bed;
      const emerge = rng.range(-0.15, 0.55);
      const h = Math.max(0.3, (depth + emerge) * 1.1 + r * 0.1);
      add({ x, z, y: bed - 0.15, r, h: Math.min(h, r * 1.3), rot: rng.range(0, 6.28), kind: kindAt(x, z), moss: rng.range(0.1, 0.7), stream: true });
    }
  }
  // waterfall: the creek drops over a band of jointed granite bedrock that crosses the valley floor (the
  // terrain carries the same band out into both banks). The lip is the band's broken edge: squat blocks
  // bounded by joints, tops near one level, the water squeezing through the joints between them: one
  // main jet through the cleft, a thin strand past a shoulder, a sheet over a drowned block near the right
  // bank. Pocket water above, a rocky plunge pool below. Every stone on the lip is a real rock, so moving
  // one re-shapes the falls.
  {
    const wlLip = waterLevel(WF_Z - 0.05);
    const hw = streamHalfW(WF_Z), k = Math.sqrt(1 + streamSlope(WF_Z) ** 2);
    const pool = waterLevel(WF_Z + 2);
    const at = (lat, zz) => streamCenter(zz) + lat * k;
    const along = Math.atan(streamSlope(WF_Z)); // joint faces square to the flow
    // [lateral m, radius, top above the lip water, z offset, moss]
    const lip = [
      // (nothing sits across the brink itself: no row of blocks reading as stepping stones over the falls)
      [-4.9, 1.5, 0.95, 0.4, 0.12],    // the band running on into the banks
      [4.7, 1.4, 0.85, 0.35, 0.12],
    ];
    for (const [l, r, above, dz, moss] of lip) {
      const zz = WF_Z - r * 0.66 + dz;
      const top = wlLip + above;
      const base = Math.min(groundAt(at(l, zz), zz), wlLip - 0.3) - r * 0.3;
      add({ x: at(l, zz), z: zz, y: base, r, h: top - base, rot: along + rng.range(-0.1, 0.1), zs: 1.12, kind: 1, moss, stream: true, big: true, fixed: true, ledge: true, bed: true, tint: [1.22, 1.14, 1.08] });
    }
    // the same bedrock showing in both banks: blocks half-buried in the scarp the floodplain steps down
    for (const side of [-1, 1]) for (const [l, r, rise] of [[7.4, 1.2, 0.12], [12.5, 1.3, 0.06]]) {
      const lat0 = side * (l + rng.range(-0.4, 0.4));
      const lat = lat0, zz = WF_Z - stepOffset(lat0) - rng.range(0.6, 1.2);
      const x = at(lat, zz), gUp = groundAt(x, zz - 1.2);
      const h = r * rng.range(0.6, 0.8);
      add({ x, z: zz, y: gUp + rise - h, r, h, rot: along + rng.range(-0.15, 0.15), zs: rng.range(0.9, 1.15), kind: 1, moss: rng.range(0.05, 0.18), big: true, fixed: true, ledge: true, bed: true, tint: [1.2, 1.12, 1.06] });
    }
    // blocks that have broken off the step, lying at its foot half drowned, flanking where the jets land
    for (const [l, r, above, dz] of [[-1.7, 1.0, -0.75, 0.75], [2.3, 1.1, -0.6, 0.7], [-3.4, 0.8, -0.95, 0.9], [0.95, 0.55, -1.45, 1.6]]) {
      const zz = WF_Z + dz;
      const top = wlLip + above;
      const base = groundAt(at(l, zz), zz) - r * 0.3;
      add({ x: at(l, zz), z: zz, y: base, r, h: top - base, rot: along + rng.range(-0.5, 0.5), kind: 1, moss: 0.2, stream: true, big: true, fixed: true, ledge: true, bed: true, tint: [1.15, 1.08, 1.03] });
    }
    // drowned stones the water pours over: chockstones in the cleft and the slots
    for (const [l, r, under] of [[0.15, 0.5, 0.04], [-2.9, 0.3, 0.04], [3.25, 0.45, -0.3]]) {
      const zz = WF_Z - r * 0.55;
      const top = wlLip - under;
      const base = groundAt(at(l, zz), zz) - 0.3;
      add({ x: at(l, zz), z: zz, y: base, r, h: top - base, rot: rng.range(0, 6.28), kind: 1, moss: 0.25, stream: true, sill: true, fixed: true });
    }
    // pocket water above the step: boulders breaking the surface, kept off the line into the cleft
    for (let i = 0, n = 0; i < 40 && n < 7; i++) {
      const zz = WF_Z - rng.range(1.4, 4.2);
      const l = rng.range(-0.85, 0.85) * streamHalfW(zz);
      if (Math.abs(l - 0.15) < 0.75) continue;
      const r = rng.range(0.35, 0.8);
      const wl = waterLevel(zz), bed = groundAt(at(l, zz), zz);
      const top = wl + rng.range(0.08, 0.4);
      add({ x: at(l, zz), z: zz, y: Math.min(bed, wl - 0.2) - 0.2, r, h: top - Math.min(bed, wl - 0.2) + 0.2, rot: Math.atan(streamSlope(zz)) + rng.range(-0.4, 0.4), kind: 1, moss: rng.range(0.1, 0.3), stream: true, bed: true });
      n++;
    }
    // plunge boulders at the foot of the fall
    for (let i = 0; i < 5; i++) {
      const l = rng.range(-1.1, 1.1);
      const zz = WF_Z + rng.range(1.0, 2.8);
      const x = streamCenter(zz) + l * hw * k;
      const top = waterLevel(zz) + rng.range(-0.2, 0.18);
      const r = rng.range(0.35, 0.65);
      add({ x, z: zz, y: top - r * 1.2, r, h: r * 1.2, rot: rng.range(0, 6.28), kind: 1, moss: 0.15, stream: true });
    }
    // pool edge boulders
    for (let i = 0; i < 9; i++) {
      const zz = WF_Z + rng.range(3, 18);
      const side = rng.chance(0.5) ? 1 : -1;
      const hw2 = streamHalfW(zz);
      const x = streamCenter(zz) + side * hw2 * rng.range(0.85, 1.25);
      const p = add({ x, z: zz, y: groundAt(x, zz) - 0.3, r: rng.range(0.9, 2.0), h: rng.range(0.9, 1.6), rot: rng.range(0, 6.28), kind: kindAt(x, zz), moss: rng.range(0.1, 0.4), stream: true, big: true });
      satellites(p, rng.int(1, 3));
    }
  }
  // stepping stones across the shallow crossing at z ~ 12: chunky blocks bedded in the gravel, tops just dry
  {
    const z0 = 12; const hw = streamHalfW(z0);
    const n = Math.round(hw * 2 / 1.05);
    for (let i = 0; i <= n; i++) {
      const lat = -hw * 0.98 + (i / n) * hw * 1.96 + rng.range(-0.1, 0.1);
      const zz = z0 + Math.sin(i * 1.3) * 0.35;
      const x = streamCenter(zz) + lat * Math.sqrt(1 + streamSlope(zz) ** 2);
      const wl = waterLevel(zz), bed = groundAt(x, zz);
      if (bed > wl + 0.04) continue;
      const top = wl + rng.range(0.08, 0.16);
      const y = Math.min(bed, wl - 0.1) - rng.range(0.06, 0.12);
      add({ x, z: zz, y, r: rng.range(0.42, 0.56), h: top - y, rot: rng.range(0, 6.28), kind: 1, moss: 0.35, stream: true, flat: true, stepping: true });
    }
  }
  // rocky stretches of bank: boulders shouldering into the water with smaller stones packed between
  const bankMask = (z, side) => 0.5 + 0.5 * Math.sin(z * 0.045 + side * 2.3 + 1.1) * Math.sin(z * 0.017 + side * 0.7 + 4.0);
  for (const side of [-1, 1]) {
    for (let z = -BOUNDS - 10; z < BOUNDS + 10; z += rng.range(0.7, 1.5)) {
      if ((z > WF_Z - 5 && z < WF_Z + 18) || Math.abs(z - 12) < 3 || bankMask(z, side) < 0.6) continue;
      const hw = streamHalfW(z), k = Math.sqrt(1 + streamSlope(z) ** 2);
      const x = streamCenter(z) + side * hw * rng.range(0.8, 1.18) * k;
      const g = groundAt(x, z), wl = waterLevel(z);
      const r = rng.chance(0.3) ? rng.range(0.7, 1.4) : rng.range(0.25, 0.6);
      const h = r * rng.range(0.55, 0.9);
      const inW = g < wl - 0.02;
      add({ x, z, y: inW ? g - 0.12 : g - h * rng.range(0.3, 0.45), r, h, rot: rng.range(0, 6.28), kind: kindAt(x, z), moss: rng.range(0.15, 0.6) * (side < 0 ? 1 : 0.4), stream: inW, big: r > 1.3 });
    }
  }
  // cobble and boulder fields on the riffle beds: stones breaking the surface, the shallows chattering over them
  for (const [zc, len, n] of [[48, 10, 130], [-72, 11, 120], [12, 7, 45]]) {
    for (let i = 0; i < n; i++) {
      const z = zc + rng.gauss() * len * 0.6;
      if (Math.abs(z - 12) < 1.3) continue; // keep the stepping line clear
      const hw = streamHalfW(z), k = Math.sqrt(1 + streamSlope(z) ** 2);
      const x = streamCenter(z) + rng.range(-0.9, 0.9) * hw * k;
      const bed = groundAt(x, z), wl = waterLevel(z);
      if (bed > wl - 0.03) continue;
      const r = rng.chance(0.15) ? rng.range(0.45, 0.85) : rng.range(0.12, 0.4);
      const h = r * rng.range(0.55, 0.85);
      add({ x, z, y: bed - h * rng.range(0.2, 0.45), r, h, rot: rng.range(0, 6.28), kind: kindAt(x, z), moss: rng.range(0.2, 0.7), stream: true });
    }
  }
  // sandstone ledges: bedrock shelves stepping down into the creek along the canyon (east) bank
  for (let z = -BOUNDS; z < BOUNDS; z += rng.range(2.2, 4.5)) {
    if ((z > WF_Z - 5 && z < WF_Z + 18) || Math.abs(z - 12) < 4) continue;
    if (Math.sin(z * 0.031 + 2.0) < 0.35 || rng.chance(0.3)) continue;
    const hw = streamHalfW(z), k = Math.sqrt(1 + streamSlope(z) ** 2);
    const x = streamCenter(z) + hw * rng.range(0.85, 1.3) * k;
    const g = groundAt(x, z), wl = waterLevel(z);
    const r = rng.range(1.2, 2.6), h = rng.range(0.35, 0.65);
    add({ x, z, y: Math.min(g, wl) - h * 0.45, r, h, rot: Math.atan(streamSlope(z)) + rng.range(-0.3, 0.3), kind: 0, moss: 0.1, stream: g < wl, ledge: true, big: true });
  }
  // shore & meadow rocks
  for (let i = 0; i < 380; i++) {
    const z = rng.range(-BOUNDS - 30, BOUNDS + 30);
    const side = rng.chance(0.5) ? 1 : -1;
    const hw = streamHalfW(z);
    const off = hw + Math.pow(rng.next(), 2.2) * 55;
    const x = streamCenter(z) + side * off;
    const g = groundAt(x, z);
    if (g < waterLevel(z) + 0.05) continue;
    const n = normalAt(x, z);
    const b = bioAt(x, z);
    const big = rng.chance(0.18);
    const r = big ? rng.range(1.2, 2.8) : rng.range(0.25, 0.9);
    const h = r * rng.range(0.55, 1.0);
    const p = add({ x, z, y: g - h * rng.range(0.28, 0.45) - (1 - n.y) * r * 0.8, r, h, rot: rng.range(0, 6.28), kind: b.canyon > 0.5 ? 0 : b.forest > 0.5 ? 1 : (rng.chance(0.5) ? 0 : 1), moss: b.forest * rng.range(0.3, 1), big });
    if (big) satellites(p, rng.int(2, 4));
  }
  // loose cobbles along the banks: the ones you can pick up, stack and turn over
  for (let i = 0; i < 170; i++) {
    const z = rng.range(-BOUNDS, BOUNDS);
    const side = rng.chance(0.5) ? 1 : -1;
    const hw = streamHalfW(z);
    // mostly on the open gravel at the water's edge, where you can see them; some up in the grass
    const x = streamCenter(z) + side * (rng.chance(0.75) ? hw * rng.range(0.9, 1.3) : hw * rng.range(1.3, 1.6) + rng.range(0, 3));
    const g = groundAt(x, z);
    if (g < waterLevel(z) + 0.02 || normalAt(x, z).y < 0.85) continue;
    const r = rng.range(0.18, 0.42);
    const h = r * rng.range(0.5, 0.8);
    add({ x, z, y: g - h * rng.range(0.2, 0.32), r, h, rot: rng.range(0, 6.28), kind: kindAt(x, z), moss: rng.range(0, 0.35) * bioAt(x, z).forest });
  }
  // more loose stones out in the meadows and woods, and along the edges of the trail
  for (let i = 0; i < 700; i++) {
    let x, z;
    if (rng.chance(0.3)) {
      const tz = rng.range(-60, 30), tx = rng.range(-100, 12), t = trailNear(tx, tz);
      if (t.d > 8) continue;
      const a = rng.range(0, 6.28), d = rng.range(1.3, 3.2);
      x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d;
    } else {
      z = rng.range(-BOUNDS, BOUNDS);
      const hw = streamHalfW(z);
      x = streamCenter(z) + (rng.chance(0.6) ? -1 : 1) * (hw * 1.5 + Math.pow(rng.next(), 1.6) * 50);
    }
    const g = groundAt(x, z);
    if (g < waterLevel(z) + 0.05 || normalAt(x, z).y < 0.8 || inLake(x, z, -0.3)) continue;
    const b = bioAt(x, z);
    const r = rng.range(0.16, 0.4);
    const h = r * rng.range(0.5, 0.8);
    add({ x, z, y: g - h * rng.range(0.2, 0.32), r, h, rot: rng.range(0, 6.28), kind: b.canyon > 0.5 || b.arid > 0.6 ? 0 : 1, moss: rng.range(0, 0.45) * b.forest });
  }
  // the erratic: a house-sized granite boulder dropped in the meadow, half sunk in the turf, with the
  // slabs that have split off it lying at its foot
  {
    const E = ERRATIC, g = groundAt(E.x, E.z);
    // bedded down to the lowest ground round its foot, so it never stands proud on its downhill side
    let gmin = g;
    for (let a = 0; a < 6.28; a += 0.3) for (const d of [0.7, 0.9, 1.05]) gmin = Math.min(gmin, groundAt(E.x + Math.cos(a) * E.r * d, E.z + Math.sin(a) * E.r * d));
    const p = add({ x: E.x, z: E.z, y: Math.min(g - E.h * 0.16, gmin - 1.6), r: E.r, h: E.h, rot: 0.7, kind: 1, moss: 0.34, big: true, fixed: true, house: true, tint: [1.14, 1.06, 1.0] });
    for (const [a, d, r, hk] of [[0.4, 1.0, 3.0, 0.7], [2.1, 1.02, 2.2, 0.8], [3.3, 0.98, 3.6, 0.55], [4.6, 1.02, 1.8, 0.8], [5.5, 1.05, 1.2, 0.7], [1.2, 1.12, 0.8, 0.7], [2.9, 1.1, 1.0, 0.6]]) {
      const x = E.x + Math.cos(a) * E.r * d, z = E.z + Math.sin(a) * E.r * d, gg = groundAt(x, z);
      add({ x, z, y: gg - r * hk * 0.3, r, h: r * hk, rot: rng.range(0, 6.28), kind: 1, moss: p.moss * 0.8, big: r > 1.3, house: true });
    }
  }
  // the tarn: glacier-dropped granite boulders along its shore (a few out in the shallows) and a fan of
  // talus under the headwall, where blocks prised off by frost come to rest
  {
    const L = LAKE;
    for (let i = 0; i < 18; i++) {
      const a = rng.range(0, 6.28), d = L.r + rng.range(-1.6, 3.5);
      const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d, g = groundAt(x, z);
      const r = rng.range(0.45, 1.5), h = r * rng.range(0.55, 0.85);
      add({ x, z, y: g - h * rng.range(0.25, 0.4), r, h, rot: rng.range(0, 6.28), kind: 1, moss: rng.range(0, 0.15), big: r > 1.2, lake: true });
    }
    for (let i = 0; i < 46; i++) {
      // the headwall rises to the west of the water
      const a = Math.PI + rng.range(-1.2, 1.2), d = L.r + rng.range(4, 20);
      const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
      if (normalAt(x, z).y < 0.5) continue;
      const r = rng.range(0.25, 1.3) * (d > L.r + 12 ? 1.2 : 0.8), h = r * rng.range(0.5, 0.8);
      // bedded to the downhill side of its footprint, so it never perches on the slope
      let g = groundAt(x, z);
      for (let q = 0; q < 6.28; q += 0.8) g = Math.min(g, groundAt(x + Math.cos(q) * r * 0.75, z + Math.sin(q) * r * 0.75));
      add({ x, z, y: g - h * 0.2, r, h, rot: rng.range(0, 6.28), kind: 1, moss: 0, big: r > 1.2, lake: true, talus: true });
    }
  }
  // canyon talus: big sandstone blocks near cliff bases
  for (let i = 0; i < 220; i++) {
    const x = rng.range(-BOUNDS - 30, BOUNDS + 40), z = rng.range(-BOUNDS - 30, BOUNDS + 30);
    const b = bioAt(x, z);
    if (b.canyon < 0.6) continue;
    const n = normalAt(x, z);
    if (n.y < 0.7) continue;
    const g = groundAt(x, z);
    if (g < waterLevel(z) + 0.5) continue;
    const r = rng.range(0.8, 3.5);
    const h = r * rng.range(0.5, 0.9);
    const p = add({ x, z, y: g - h * rng.range(0.25, 0.4), r, h, rot: rng.range(0, 6.28), kind: 0, moss: 0, big: r > 1.5 });
    if (r > 1.6 && rng.chance(0.6)) satellites(p, rng.int(1, 3));
  }
  // hoodoo-ish stacks on canyon ledges
  for (let i = 0; i < 26; i++) {
    const x = rng.range(20, BOUNDS + 40), z = rng.range(-BOUNDS - 30, BOUNDS + 30);
    const b = bioAt(x, z); if (b.canyon < 0.9) continue;
    const n = normalAt(x, z); if (n.y < 0.9) continue;
    const g = groundAt(x, z);
    const r = rng.range(1.2, 2.2);
    const hood = add({ x, z, y: g - 0.3, r, h: r * rng.range(2.2, 3.4), rot: rng.range(0, 6.28), kind: 0, moss: 0, big: true, hoodoo: true });
    add({ x: x + rng.range(-0.3, 0.3), z: z + rng.range(-0.3, 0.3), y: hood.y + hood.h - 0.25 * r, r: r * 1.2, h: r * 0.7, rot: rng.range(0, 6.28), kind: 0, moss: 0, big: true, hoodoo: true });
  }
  return rocks;
}

// Effective radius at the water surface (for flow obstacles)
export function rockWaterRadius(rk) {
  const wl = waterLevel(rk.z);
  const top = rk.y + rk.h;
  if (top < wl) return -(wl - top); // submerged: negative = depth below surface
  const t = clamp((wl - rk.y) / rk.h, 0, 0.999);
  if (rk.prof) {
    const f = t * PROF_N - 0.5, i = clamp(Math.floor(f), 0, PROF_N - 2), u = clamp(f - i, 0, 1);
    return rk.r * Math.max(0.2, rk.prof[i] * (1 - u) + rk.prof[i + 1] * u);
  }
  const s = clamp((t - 0.4) / 0.6, -1, 1);
  return rk.r * Math.sqrt(Math.max(0.05, 1 - s * s));
}

// ---- world-space top height field of a rock in its current pose (for stacking & perching) ----
const TF = 14;
const _v = new THREE.Vector3(), _o = new THREE.Vector3();
function buildTopField(rk) {
  const P = rk.hull, m = rk.matrix;
  const R = Math.max(rk.r, rk.r * rk.zs) * 1.08 + 0.05;
  const top = new Float32Array(TF * TF).fill(-Infinity);
  const x0 = rk.cx - R, z0 = rk.cz - R, cell = (2 * R) / TF;
  for (let i = 0; i < P.length; i += 3) {
    _v.set(P[i], P[i + 1], P[i + 2]).applyMatrix4(m);
    const gx = Math.floor((_v.x - x0) / cell), gz = Math.floor((_v.z - z0) / cell);
    if (gx < 0 || gz < 0 || gx >= TF || gz >= TF) continue;
    const k = gz * TF + gx;
    if (_v.y > top[k]) top[k] = _v.y;
  }
  for (let it = 0; it < 2; it++) {
    const src = top.slice();
    for (let z = 0; z < TF; z++) for (let x = 0; x < TF; x++) {
      if (src[z * TF + x] > -Infinity) continue;
      let s = 0, c = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, zz = z + j;
        if (xx < 0 || zz < 0 || xx >= TF || zz >= TF) continue;
        const t = src[zz * TF + xx];
        if (t > -Infinity) { s += t; c++; }
      }
      if (c >= 5) top[z * TF + x] = s / c; // only holes surrounded by rock, not the outline
    }
  }
  rk.tf = { top, x0, z0, cell };
}
// world y of a rock's upper surface at x, z (-Infinity off the rock)
export function rockTopAt(rk, x, z) {
  if (!rk.hull) return rk.y + rk.h;
  if (!rk.tf) buildTopField(rk);
  const { top, x0, z0, cell } = rk.tf;
  const fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  let s = 0, w = 0, mx = -Infinity;
  for (let b = 0; b <= 1; b++) for (let a = 0; a <= 1; a++) {
    const xx = i + a, zz = j + b;
    if (xx < 0 || zz < 0 || xx >= TF || zz >= TF) continue;
    const t = top[zz * TF + xx];
    if (t === -Infinity) continue;
    const ww = (a ? tx : 1 - tx) * (b ? tz : 1 - tz);
    s += t * ww; w += ww; mx = Math.max(mx, t);
  }
  return w > 0.25 ? s / w : -Infinity;
}

const CARRY_R = 0.62;
const up = new THREE.Vector3(0, 1, 0);

export class Rocks {
  constructor(scene, rocks) {
    this.scene = scene;
    this.rocks = rocks;
    this.material = makeRockMaterial();
    // shape variants, each at three levels of detail (same shape, different tessellation)
    const defs = [];
    for (let i = 0; i < 5; i++) defs.push({ style: 'block', seed: 100 + i });
    for (let i = 0; i < 2; i++) defs.push({ style: 'slab', seed: 150 + i });
    for (let i = 0; i < 5; i++) defs.push({ style: 'round', seed: 200 + i });
    for (let i = 0; i < 2; i++) defs.push({ style: 'angular', seed: 250 + i });
    for (let i = 0; i < 2; i++) defs.push({ style: 'flat', seed: 300 + i });
    for (let i = 0; i < 2; i++) defs.push({ style: 'cobble', seed: 350 + i });
    for (let i = 0; i < 4; i++) defs.push({ style: 'ledge', seed: 400 + i });
    defs.push({ style: 'erratic', seed: 781, house: true }); // the erratic has a shape of its own
    const houseVi = defs.length - 1;
    const byStyle = {};
    defs.forEach((d, i) => { if (!d.house) (byStyle[d.style] = byStyle[d.style] || []).push(i); });
    const LODS = [5, 4, 3];
    const variants = [];
    defs.forEach((d, vi) => LODS.forEach((det, li) => variants.push({ vi, li, style: d.style, geo: makeRockGeometry(d.seed, d.style, d.house ? [18, 10, 4][li] : det) })));
    this.variants = variants;
    const lodOf = (rk) => (rk.r >= 1.3 || rk.sill ? 0 : rk.r >= 0.45 ? 1 : 2);
    // assign rocks to variants
    const buckets = variants.map(() => []);
    const rng = new RNG(5);
    const pick = (style) => rng.pick(byStyle[style]);
    for (const rk of rocks) {
      let vi;
      if (rk.house && rk.r > 4) vi = houseVi;
      else if (rk.flat) vi = pick('flat');
      else if (rk.bed) vi = pick('ledge');
      else if (rk.ledge) vi = pick('slab');
      else if (rk.talus) vi = pick('angular');
      else if (rk.sill) vi = pick(rk.kind === 1 ? 'round' : 'block');
      else if (rk.kind === 0) vi = pick(rk.r < 0.4 || rng.chance(0.3) ? 'slab' : 'block');
      else vi = pick(rk.r < 0.45 && rng.chance(0.6) ? 'cobble' : rng.chance(0.25) ? 'angular' : 'round');
      const k = vi * LODS.length + lodOf(rk);
      rk.variant = k; rk.index = buckets[k].length;
      rk.prof = variants[k].geo.userData.prof;
      // the coarsest tessellation of the same shape serves as the collision hull
      rk.hull = variants[vi * LODS.length + 2].geo.attributes.position.array;
      buckets[k].push(rk);
    }
    this.meshes = [];
    variants.forEach((v, vi) => {
      const list = buckets[vi];
      if (!list.length) return;
      const im = new THREE.InstancedMesh(v.geo, this.material, list.length);
      const aRock = new Float32Array(list.length * 4);
      const aCol = new Float32Array(list.length * 4);
      const aB = new Float32Array(list.length * 2);
      list.forEach((rk, i) => {
        rk.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.08, 0.08), rk.rot, rng.range(-0.08, 0.08)));
        rk.zs = rk.zs ?? rng.range(0.8, 1.1);
        rk.s = new THREE.Vector3(rk.r, rk.h, rk.r * rk.zs);
        rk.mesh = im;
        rk.matrix = new THREE.Matrix4().compose(new THREE.Vector3(rk.x, rk.y, rk.z), rk.q, rk.s);
        rk.baseMatrix = rk.matrix.clone();
        im.setMatrixAt(i, rk.matrix);
        this.syncDerived(rk);
        aRock[i * 4] = rk.moss; aRock[i * 4 + 1] = rng.next(); aRock[i * 4 + 2] = rk.kind; aRock[i * 4 + 3] = rng.next();
        const tb = rng.range(0.82, 1.05);
        const tint = rk.tint ? rk.tint.map((v) => v * tb) : rk.kind === 0 ? [tb * rng.range(0.95, 1.05), tb * rng.range(0.93, 1.0), tb * rng.range(0.9, 1.0)] : [tb * rng.range(0.97, 1.04), tb, tb * rng.range(0.95, 1.02)];
        aCol[i * 4] = tint[0]; aCol[i * 4 + 1] = tint[1]; aCol[i * 4 + 2] = tint[2]; aCol[i * 4 + 3] = groundAt(rk.x, rk.z);
        // how deep it sits in the soil (the dirty band stays on the stone when it's lifted)
        const gy = groundAt(rk.x, rk.z);
        aB[i * 2] = rk.stream ? 0 : clamp((gy - rk.y) / rk.h + 0.06, 0, 0.6); aB[i * 2 + 1] = 0;
      });
      v.geo = v.geo.clone();
      im.geometry = v.geo;
      v.geo.setAttribute('aRock', new THREE.InstancedBufferAttribute(aRock, 4));
      v.geo.setAttribute('aRockColor', new THREE.InstancedBufferAttribute(aCol, 4));
      v.geo.setAttribute('aRockB', new THREE.InstancedBufferAttribute(aB, 2));
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      im.frustumCulled = false;
      scene.add(im);
      this.meshes.push(im);
    });
    this.buildGrid();
    this.bakeContact();
    this.bodies = [];
    this.drying = new Set();
    this.onMoved = null;   // (rk, from) after a rock comes to rest somewhere new
    this.onImpact = null;  // (rk, x, y, z, speed, water)
    this.buildPebbles(scene);
  }

  // centre, pick sphere, top field: everything derived from the matrix
  syncDerived(rk) {
    const c = _v.set(0, 0.5, 0).applyMatrix4(rk.matrix);
    rk.cx = c.x; rk.cz = c.z;
    rk.center = rk.center || new THREE.Vector3();
    rk.center.copy(c);
    rk.radius = Math.max(rk.r, rk.h) * 1.05;
    rk.tf = null;
    if (rk.pick) { rk.pick.x = c.x; rk.pick.y = c.y; rk.pick.z = c.z; }
  }

  buildGrid() {
    this.grid = new Map();
    for (const r of this.rocks) this.gridAdd(r);
  }
  gridKey(x, z) { return `${Math.floor(x / 6)},${Math.floor(z / 6)}`; }
  gridAdd(r) { const k = this.gridKey(r.x, r.z); r.gk = k; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(r); }
  gridRemove(r) { const l = this.grid.get(r.gk); if (l) { const i = l.indexOf(r); if (i >= 0) l.splice(i, 1); } }
  near(x, z, out = []) {
    out.length = 0;
    const cx = Math.floor(x / 6), cz = Math.floor(z / 6);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.grid.get(`${cx + i},${cz + j}`);
      if (l) for (const r of l) out.push(r);
    }
    return out;
  }

  // highest solid surface under x, z: ground or any resting rock
  supportAt(x, z, ignore = null, list = null) {
    let y = groundAt(x, z);
    const L = list || this.near(x, z, this._near || (this._near = []));
    for (const r of L) {
      if (r === ignore || r.moving) continue;
      const dx = x - r.cx, dz = z - r.cz, R = Math.max(r.r, r.r * r.zs) * 1.1;
      if (dx * dx + dz * dz > R * R) continue;
      const t = rockTopAt(r, x, z);
      if (t > y) y = t;
    }
    return y;
  }

  canCarry(rk) { return rk.r <= CARRY_R && !rk.sill && !rk.fixed && !rk.hoodoo && !rk.big; }

  // lowest centre height at which the rock (in pose q) clears everything under it
  restHeight(rk, q, cx, cz) {
    const P = rk.hull, s = rk.s;
    const list = this.near(cx, cz, this._restNear || (this._restNear = []));
    let best = -Infinity, lowY = Infinity;
    const o = _o;
    for (let i = 0; i < P.length; i += 6) {
      o.set(P[i] * s.x, (P[i + 1] - 0.5) * s.y, P[i + 2] * s.z).applyQuaternion(q);
      if (o.y > 0.1 * rk.h) continue;
      const oy = o.y;
      const need = this.supportAt(cx + o.x, cz + o.z, rk, list) - oy;
      if (need > best) best = need;
      if (oy < lowY) lowY = oy;
    }
    return { y: best, low: lowY };
  }

  // let gravity roll the rock into a nearby stable pose (local search that lowers its centre)
  settlePose(rk, q, cx, cz) {
    const qq = q.clone(), tq = new THREE.Quaternion(), ax = new THREE.Vector3();
    let cur = this.restHeight(rk, qq, cx, cz).y;
    let step = 0.12;
    for (let it = 0; it < 14 && step > 0.015; it++) {
      let bestY = cur, bestQ = null;
      for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ax.set(x, 0, z);
        tq.setFromAxisAngle(ax, step).multiply(qq);
        const y = this.restHeight(rk, tq, cx, cz).y;
        if (y < bestY - 0.002) { bestY = y; bestQ = tq.clone(); }
      }
      if (bestQ) { qq.copy(bestQ); cur = bestY; } else step *= 0.5;
    }
    return { q: qq, y: cur };
  }

  setPose(rk, C, q) {
    rk.q.copy(q);
    const p = _v.set(0, 0.5 * rk.h, 0).applyQuaternion(q).negate().add(C);
    rk.matrix.compose(p, q, rk.s);
    rk.mesh.setMatrixAt(rk.index, rk.matrix);
    rk.mesh.instanceMatrix.needsUpdate = true;
  }
  setAttr(rk, name, comp, value) {
    const a = rk.mesh.geometry.attributes[name];
    a.array[rk.index * a.itemSize + comp] = value;
    a.needsUpdate = true;
  }

  // ---- rock play ----
  bodyOf(rk) { return this.bodies.find((b) => b.rk === rk); }
  begin(rk, mode) {
    let b = this.bodyOf(rk);
    if (!b) {
      b = { rk, C: rk.center.clone(), v: new THREE.Vector3(), w: new THREE.Vector3(), q: rk.q.clone(), from: { x: rk.x, z: rk.z, stream: rk.stream }, bounces: 0, inWater: false, t: 0 };
      this.bodies.push(b);
      this.gridRemove(rk);
      rk.moving = true;
      // wobbling rocks snap back to their pose first
      const wi = this.wobbles.findIndex((w) => w.rk === rk);
      if (wi >= 0) { this.wobbles.splice(wi, 1); rk.mesh.setMatrixAt(rk.index, rk.baseMatrix); }
    }
    b.mode = mode; b.t = 0;
    b.inWater = isWater(b.C.x, b.C.z) && b.C.y < waterLevel(b.C.z);
    return b;
  }
  grab(rk) {
    const b = this.begin(rk, 'held');
    b.hold = b.C.clone();
    b.baseQ = rk.q.clone();
    return b;
  }
  holdAt(rk, x, z) {
    const b = this.bodyOf(rk);
    if (!b || b.mode !== 'held') return;
    const R = Math.max(rk.r, rk.h);
    b.hold.set(x, Math.max(this.supportAt(x, z, rk), isWater(x, z) ? waterLevel(z) : -Infinity) + R * 0.75 + 0.35, z);
  }
  release(rk) {
    const b = this.bodyOf(rk);
    if (!b || b.mode !== 'held') return;
    b.mode = 'fly';
    const sp = b.v.length();
    if (sp > 8) b.v.multiplyScalar(8 / sp);
    // a flick sets it tumbling
    b.w.set(b.v.z, 0, -b.v.x).multiplyScalar(1.4).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.5));
    b.bounces = 0;
  }
  // turn a stone over: it rolls away from the viewer, showing its underside and what lived beneath
  flip(rk, viewDir) {
    if (this.bodyOf(rk)) return null;
    const b = this.begin(rk, 'flip');
    const d = new THREE.Vector3(viewDir.x, 0, viewDir.z).normalize();
    b.axis = new THREE.Vector3().crossVectors(up, d).normalize();
    b.angle = Math.PI * (0.75 + Math.random() * 0.2);
    b.C0 = b.C.clone();
    b.C1 = b.C.clone().addScaledVector(d, rk.r * 1.45 + 0.08);
    b.q0 = rk.q.clone();
    b.dur = 0.55 + rk.r * 0.4;
    return b;
  }

  update(dt) {
    this.updateWobbles(dt);
    for (let i = this.bodies.length - 1; i >= 0; i--) if (this.stepBody(this.bodies[i], dt)) this.bodies.splice(i, 1);
    if (this.drying.size) for (const rk of this.drying) {
      if (rk.moving) continue;
      const wetNow = rk.y < waterLevel(rk.z) && isWater(rk.cx, rk.cz);
      rk.wet = wetNow ? 1 : Math.max(0, rk.wet - dt / 45);
      this.setAttr(rk, 'aRockB', 1, rk.wet);
      if (rk.wet <= 0) this.drying.delete(rk);
    }
  }

  stepBody(b, dt) {
    const rk = b.rk;
    b.t += dt;
    const q = new THREE.Quaternion();
    if (b.mode === 'held') {
      // critically damped spring toward the hold point, with a little swing
      const k = 70, c = 2 * Math.sqrt(k);
      const ax = (b.hold.x - b.C.x) * k - b.v.x * c, ay = (b.hold.y - b.C.y) * k - b.v.y * c, az = (b.hold.z - b.C.z) * k - b.v.z * c;
      b.v.x += ax * dt; b.v.y += ay * dt; b.v.z += az * dt;
      b.C.addScaledVector(b.v, dt);
      const tilt = new THREE.Vector3(b.v.z, 0, -b.v.x);
      const ang = Math.min(tilt.length() * 0.07, 0.4);
      if (ang > 1e-4) q.setFromAxisAngle(tilt.normalize(), ang);
      q.multiply(b.baseQ);
      b.q.slerp(q, Math.min(1, dt * 10));
      this.setPose(rk, b.C, b.q);
      this.waterContact(b);
      this.setAttr(rk, 'aRockColor', 3, groundAt(b.C.x, b.C.z));
      return false;
    }
    if (b.mode === 'flip') {
      const u = Math.min(1, b.t / b.dur);
      const e = u * u * (3 - 2 * u);
      b.C.lerpVectors(b.C0, b.C1, e);
      b.C.y += Math.sin(u * Math.PI) * (0.18 + rk.h * 0.35);
      q.setFromAxisAngle(b.axis, b.angle * e).multiply(b.q0);
      b.q.copy(q);
      this.setPose(rk, b.C, b.q);
      if (u >= 1) this.toSettle(b, 0.3);
      return false;
    }
    if (b.mode === 'fly') {
      const g = b.inWater ? 9.8 * 0.55 : 9.8;
      b.v.y -= g * dt;
      if (b.inWater) b.v.multiplyScalar(Math.exp(-2.8 * dt));
      b.C.addScaledVector(b.v, dt);
      b.C.x = clamp(b.C.x, -WORLD + 2, WORLD - 2); b.C.z = clamp(b.C.z, -WORLD + 2, WORLD - 2);
      const wl = b.w.length();
      if (wl > 1e-4) { q.setFromAxisAngle(_v.copy(b.w).divideScalar(wl), wl * dt); b.q.premultiply(q).normalize(); }
      this.waterContact(b);
      const rest = this.restHeight(rk, b.q, b.C.x, b.C.z).y;
      if (b.C.y <= rest) {
        const vy = -b.v.y;
        b.C.y = rest;
        if (vy > 2.4 && b.bounces < 2 && !b.inWater) {
          b.bounces++;
          b.v.y = vy * 0.3; b.v.x *= 0.5; b.v.z *= 0.5; b.w.multiplyScalar(0.5);
          if (this.onImpact) this.onImpact(rk, b.C.x, b.C.y - rk.h * 0.4, b.C.z, vy, false);
        } else {
          if (this.onImpact) this.onImpact(rk, b.C.x, b.C.y - rk.h * 0.4, b.C.z, Math.max(vy, 1), b.inWater);
          this.toSettle(b, 0.18);
        }
      }
      this.setPose(rk, b.C, b.q);
      return false;
    }
    if (b.mode === 'settle') {
      const u = Math.min(1, b.t / b.dur);
      const e = 1 - (1 - u) * (1 - u);
      b.C.lerpVectors(b.sC0, b.sC1, e);
      b.q.slerpQuaternions(b.sq0, b.sq1, e);
      this.setPose(rk, b.C, b.q);
      if (u >= 1) { this.finish(b); return true; }
      return false;
    }
    return true;
  }

  waterContact(b) {
    const rk = b.rk;
    const wl = waterLevel(b.C.z);
    const inW = isWater(b.C.x, b.C.z) && b.C.y - rk.h * 0.3 < wl;
    if (inW !== b.inWater) {
      b.inWater = inW;
      if (this.onImpact && b.mode !== 'held') this.onImpact(rk, b.C.x, wl, b.C.z, Math.abs(b.v.y) + 0.5, true, 'surface');
      else if (this.onImpact) this.onImpact(rk, b.C.x, wl, b.C.z, 0.6, true, 'surface');
    }
    if (inW) { rk.wet = 1; this.drying.add(rk); }
  }

  toSettle(b, dur) {
    const rk = b.rk;
    const s = this.settlePose(rk, b.q, b.C.x, b.C.z);
    b.mode = 'settle'; b.t = 0; b.dur = dur;
    b.sC0 = b.C.clone(); b.sq0 = b.q.clone();
    b.sq1 = s.q; b.sC1 = new THREE.Vector3(b.C.x, s.y - 0.012, b.C.z);
  }

  finish(b) {
    const rk = b.rk;
    rk.moving = false;
    rk.baseMatrix.copy(rk.matrix);
    this.syncDerived(rk);
    // bottom / extent of the resting rock, for the water and the critters
    const r = this.restHeight(rk, rk.q, rk.cx, rk.cz);
    rk.x = rk.cx; rk.z = rk.cz;
    rk.y = rk.center.y + r.low;
    const wl = waterLevel(rk.z);
    rk.stream = isWater(rk.x, rk.z) && rk.y < wl - 0.02;
    this.setAttr(rk, 'aRockColor', 3, groundAt(rk.x, rk.z));
    this.gridAdd(rk);
    this.bakeContact();
    if (this.onMoved) this.onMoved(rk, b.from);
  }

  // ---- contact occlusion: a soft dark footprint on the ground around every resting rock ----
  bakeContact() {
    const N = 2048, cell = (2 * WORLD) / N;
    if (!this.contact) {
      this.contact = new Uint8Array(N * N);
      const t = new THREE.DataTexture(this.contact, N, N, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.contactTex = U.uContact.value = t;
    }
    const D = this.contact;
    D.fill(0);
    const m = rk => rk.matrix.elements;
    for (const rk of this.rocks) {
      if (rk.moving) continue;
      const e = m(rk);
      const g = groundAt(rk.cx, rk.cz);
      const above = rk.y + rk.h - g;
      if (above < 0.03) continue;
      // footprint: the rock's width where it meets the ground, in its own (stretched, rotated) frame
      const frac = clamp((g - rk.y) / rk.h, 0, 0.95);
      const fw = rk.prof ? rk.prof[Math.min(PROF_N - 1, Math.floor(frac * PROF_N))] : 0.9;
      const ax = e[0], az = e[2], bx = e[8], bz = e[10];
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      const Rf = Math.max(0.3, fw), spread = (0.4 + 0.6 * Math.min(above, 2)) / rk.r;
      const str = clamp(0.45 + above * 0.4, 0.45, 0.92) * 255;
      const ext = (Rf + spread) * Math.max(rk.r, rk.r * rk.zs);
      const i0 = Math.max(0, Math.floor((rk.cx - ext + WORLD) / cell)), i1 = Math.min(N - 1, Math.ceil((rk.cx + ext + WORLD) / cell));
      const j0 = Math.max(0, Math.floor((rk.cz - ext + WORLD) / cell)), j1 = Math.min(N - 1, Math.ceil((rk.cz + ext + WORLD) / cell));
      for (let j = j0; j <= j1; j++) {
        const dz = -WORLD + (j + 0.5) * cell - rk.cz;
        for (let i = i0; i <= i1; i++) {
          const dx = -WORLD + (i + 0.5) * cell - rk.cx;
          const lx = (dx * ax + dz * az) / (la * la), lz = (dx * bx + dz * bz) / (lb * lb);
          const d = Math.hypot(lx, lz);
          const f = 1 - smoothstep(Rf * 0.92, Rf + spread, d);
          const o = str * f * Math.sqrt(f);
          const k = j * N + i;
          if (o > D[k]) D[k] = o;
        }
      }
    }
    this.contactTex.needsUpdate = true;
  }

  // ---- little nudges for rocks too big to lift ----
  wobble(rk) {
    if (this.wobbles.find((w) => w.rk === rk) || rk.moving) return;
    this.wobbles.push({ rk, t: 0 });
  }
  get wobbles() { return this._wobbles || (this._wobbles = []); }
  updateWobbles(dt) {
    if (!this.wobbles.length) return;
    const m = new THREE.Matrix4(), r = new THREE.Matrix4(), t1 = new THREE.Matrix4(), t2 = new THREE.Matrix4();
    for (let i = this.wobbles.length - 1; i >= 0; i--) {
      const w = this.wobbles[i];
      w.t += dt;
      const a = Math.sin(w.t * 18) * Math.exp(-w.t * 4) * 0.07 * Math.min(1, 1.2 / w.rk.r);
      const pivot = new THREE.Vector3(w.rk.x, w.rk.y, w.rk.z);
      t1.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
      r.makeRotationAxis(new THREE.Vector3(Math.cos(w.rk.rot), 0, Math.sin(w.rk.rot)), a);
      t2.makeTranslation(pivot.x, pivot.y, pivot.z);
      m.copy(t2).multiply(r).multiply(t1).multiply(w.rk.baseMatrix);
      w.rk.mesh.setMatrixAt(w.rk.index, m);
      w.rk.mesh.instanceMatrix.needsUpdate = true;
      if (w.t > 1.5) { w.rk.mesh.setMatrixAt(w.rk.index, w.rk.baseMatrix); this.wobbles.splice(i, 1); }
    }
  }

  buildPebbles(scene) {
    const rng = new RNG(31);
    const geos = [makeRockGeometry(900, 'cobble', 2), makeRockGeometry(901, 'flat', 2), makeRockGeometry(902, 'slab', 2)];
    const list = [];
    for (let i = 0; i < 4200; i++) {
      const z = rng.range(-BOUNDS - 25, BOUNDS + 25);
      const hw = streamHalfW(z);
      const lat = rng.range(-1, 1) * hw * rng.range(0.6, 1.9);
      const x = streamCenter(z) + lat * Math.sqrt(1 + streamSlope(z) ** 2);
      const g = groundAt(x, z), wl = waterLevel(z);
      if (g - wl > 0.9) continue;
      const r = rng.range(0.06, 0.22) * (rng.chance(0.1) ? 1.8 : 1);
      list.push({ x, z, g, r, kind: rng.chance(0.5) ? 1 : 0 });
    }
    // debris at the foot of the bigger rocks
    for (const rk of this.rocks) {
      if (rk.r < 0.6 || rk.hoodoo || rk.sill) continue;
      const n = Math.round(rk.r * rng.range(2, 5));
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.28), d = rk.r * rng.range(0.8, 1.3);
        const x = rk.x + Math.cos(a) * d, z = rk.z + Math.sin(a) * d * rk.zs;
        const g = groundAt(x, z);
        if (g < waterLevel(z) - 0.6) continue;
        list.push({ x, z, g, r: rng.range(0.04, 0.12) * (rk.kind === 0 ? 1.3 : 1), kind: rk.kind });
      }
    }
    const parts = [[], [], []];
    for (const pb of list) parts[pb.kind === 0 ? (rng.chance(0.6) ? 2 : 1) : (rng.chance(0.75) ? 0 : 1)].push(pb);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    parts.forEach((L, gi) => {
      if (!L.length) return;
      const geo = geos[gi];
      const im = new THREE.InstancedMesh(geo, this.material, L.length);
      const aRock = new Float32Array(L.length * 4), aCol = new Float32Array(L.length * 4), aB = new Float32Array(L.length * 2);
      L.forEach((pb, i) => {
        q.setFromEuler(new THREE.Euler(rng.range(-0.25, 0.25), rng.range(0, 6.28), rng.range(-0.25, 0.25)));
        const h = pb.r * rng.range(0.45, 0.8);
        sc.set(pb.r, h, pb.r * rng.range(0.7, 1.1));
        p.set(pb.x, pb.g - h * 0.3, pb.z);
        m4.compose(p, q, sc); im.setMatrixAt(i, m4);
        aRock[i * 4] = 0; aRock[i * 4 + 1] = rng.next(); aRock[i * 4 + 2] = pb.kind; aRock[i * 4 + 3] = rng.next();
        const t = rng.range(0.75, 1.2);
        aCol[i * 4] = t * rng.range(0.9, 1.1); aCol[i * 4 + 1] = t; aCol[i * 4 + 2] = t * rng.range(0.9, 1.05); aCol[i * 4 + 3] = pb.g - h * 0.1;
      });
      geo.setAttribute('aRock', new THREE.InstancedBufferAttribute(aRock, 4));
      geo.setAttribute('aRockColor', new THREE.InstancedBufferAttribute(aCol, 4));
      geo.setAttribute('aRockB', new THREE.InstancedBufferAttribute(aB, 2));
      im.receiveShadow = true; im.castShadow = false; im.frustumCulled = false;
      scene.add(im);
    });
  }
}
