// Fossils: about 3% of the stones you can lift have one lying underneath, pressed into a little slab
// of shale or limestone. Click it to collect it into the field notes. Six kinds from the rocks of
// Colorado and Utah; each is drawn from one outline generator, so the slab in the world and the
// sketch in the folio show the same animal (or leaf).
import * as THREE from 'three';
import { RNG } from '../noise.js';
import { groundAt, waterLevel, isWater } from './shape.js';

// ---------- outlines in a unit box (x right, y down; about -0.9..0.9 by -0.7..0.7) ----------
const TAU = Math.PI * 2;
const mirror = (half) => [...half, ...half.slice().reverse().map(([x, y]) => [-x, y])];

function trilobite() {
  // Elrathia: a broad head shield, thirteen thorax segments, a small tail shield
  const W = (t) => (t < 0.3 ? 0.47 * Math.sqrt(Math.max(0, 1 - ((0.3 - t) / 0.3) ** 2)) : 0.47 * (1 - 0.42 * ((t - 0.3) / 0.7) ** 1.5)) * (t > 0.9 ? Math.sqrt(Math.max(0, (1 - t) / 0.1)) : 1);
  const Y = (t) => -0.66 + t * 1.32;
  const half = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; half.push([W(t), Y(t)]); }
  const out = mirror(half);
  const lines = [];
  // head border and the glabella (the raised central lobe), eyes
  const border = []; for (let i = 0; i <= 20; i++) { const t = 0.03 + i / 20 * 0.25; border.push([W(t) * 0.86, Y(t) + 0.03]); }
  lines.push(mirror(border).slice(0, -1));
  lines.push([[-0.11, -0.36], [-0.12, -0.5], [-0.08, -0.58], [0.08, -0.58], [0.12, -0.5], [0.11, -0.36]]);
  for (const s of [-1, 1]) lines.push([[0.2 * s, -0.5], [0.28 * s, -0.46], [0.26 * s, -0.4]]);
  // axial furrows
  for (const s of [-1, 1]) { const l = []; for (let i = 0; i <= 10; i++) { const t = 0.31 + i / 10 * 0.6; l.push([s * (0.15 - 0.07 * (t - 0.31)), Y(t)]); } lines.push(l); }
  // thorax segments, bowing back at the sides
  for (let k = 0; k < 13; k++) {
    const t = 0.31 + k * 0.042, w = W(t) * 0.97;
    lines.push([[-w, Y(t) + 0.03], [-w * 0.5, Y(t) + 0.005], [0, Y(t)], [w * 0.5, Y(t) + 0.005], [w, Y(t) + 0.03]]);
  }
  for (let k = 0; k < 3; k++) { const t = 0.88 + k * 0.03, w = W(t) * 0.7; lines.push([[-w, Y(t) + 0.02], [0, Y(t)], [w, Y(t) + 0.02]]); }
  return { out, lines, spots: [] };
}

function ammonite() {
  // a logarithmic coil, ribbed across the outer two whorls
  const R = 0.66, b = Math.log(2.3) / TAU;
  const S = (th) => [Math.cos(th) * R * Math.exp(b * th) * 1.04, Math.sin(th) * R * Math.exp(b * th)];
  const out = []; for (let i = 0; i < 64; i++) out.push(S(i / 64 * TAU - TAU + 0.0001).map((v) => v / Math.exp(b * (i / 64 * TAU - TAU))));
  const spiral = []; for (let i = 0; i <= 160; i++) spiral.push(S(-i / 160 * 5 * Math.PI));
  const lines = [spiral];
  for (let th = 0; th > -2 * TAU; th -= 0.15) {
    const a = S(th - TAU), c = S(th), k = th < -TAU ? 0.6 : 1;
    if (th < -TAU && Math.round(th / 0.15) % 2) continue;
    // ribs swing forward a little across the whorl
    const m = S(th + 0.07 * k);
    lines.push([[a[0] * 1.03 + (c[0] - a[0]) * 0.05, a[1] * 1.03 + (c[1] - a[1]) * 0.05], [(a[0] + m[0]) / 2 * 1.0, (a[1] + m[1]) / 2], [c[0] * 0.985, c[1] * 0.985]]);
  }
  return { out, lines, spots: [[0, 0, 0.03]] };
}

function knightia() {
  // a small herring on its side: fusiform body, forked tail, spine and ribs
  const top = (x) => -0.25 * Math.pow(Math.sin(Math.PI * (x + 0.82) / 1.5), 0.85);
  const bot = (x) => 0.27 * Math.pow(Math.sin(Math.PI * (x + 0.82) / 1.5), 0.8);
  const out = [];
  for (let i = 0; i <= 30; i++) { const x = -0.82 + i / 30 * 1.42; out.push([x, Math.min(top(x), -0.045)]); }
  out.push([0.66, -0.06], [0.9, -0.27], [0.84, -0.04], [0.8, 0], [0.84, 0.04], [0.9, 0.27], [0.66, 0.06]);
  for (let i = 30; i >= 0; i--) { const x = -0.82 + i / 30 * 1.42; out.push([x, Math.max(bot(x), 0.045)]); }
  const lines = [];
  const spine = []; for (let i = 0; i <= 20; i++) { const x = -0.44 + i / 20 * 1.08; spine.push([x, -0.02 + 0.03 * Math.sin(i / 20 * Math.PI)]); }
  lines.push(spine);
  for (let x = -0.4; x < 0.62; x += 0.038) { const y = -0.02 + 0.03 * Math.sin((x + 0.44) / 1.08 * Math.PI); lines.push([[x, y - 0.03], [x + 0.01, y + 0.03]]); }
  for (let x = -0.38; x < 0.16; x += 0.05) lines.push([[x, 0.0], [x - 0.07, bot(x - 0.07) * 0.86]]);
  for (let x = -0.3; x < 0.4; x += 0.06) lines.push([[x, -0.03], [x - 0.05, top(x - 0.05) * 0.8]]);
  lines.push([[-0.47, top(-0.47) * 0.95], [-0.43, 0.0], [-0.48, bot(-0.48) * 0.95]]);                 // gill cover
  for (let i = 0; i < 6; i++) lines.push([[0.0 + i * 0.03, top(0.0 + i * 0.03)], [0.06 + i * 0.035, top(0.0) - 0.08 + i * 0.012]]); // dorsal fin
  for (let i = 0; i < 6; i++) { const s = i < 3 ? -1 : 1, k = i % 3; lines.push([[0.68, s * 0.05], [0.88 - k * 0.04, s * (0.26 - k * 0.07)]]); } // tail rays
  for (let i = 0; i < 4; i++) lines.push([[0.3 + i * 0.03, bot(0.3 + i * 0.03)], [0.36 + i * 0.03, bot(0.3) + 0.06]]); // anal fin
  return { out, lines, spots: [[-0.68, -0.05, 0.045]] };
}

function leaf() {
  // Fagopsis: a toothed, elliptic leaf with straight parallel side veins
  const L0 = -0.72, L1 = 0.82;
  const half = (t) => 0.3 * Math.pow(Math.sin(Math.PI * t), 0.85) * (1 - 0.15 * t);
  const out = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60; out.push([L0 + t * (L1 - L0), -(half(t) + 0.018 * Math.abs(Math.sin(t * 14 * Math.PI)) * (t > 0.08 && t < 0.95 ? 1 : 0)) + 0.06 * t * t]); }
  for (let i = 60; i >= 0; i--) { const t = i / 60; out.push([L0 + t * (L1 - L0), half(t) + 0.018 * Math.abs(Math.sin(t * 14 * Math.PI + 0.5)) * (t > 0.08 && t < 0.95 ? 1 : 0) + 0.06 * t * t]); }
  const mid = []; for (let i = 0; i <= 20; i++) { const t = i / 20; mid.push([L0 + t * (L1 - L0), 0.06 * t * t]); }
  const lines = [mid, [[-0.96, 0.08], [-0.86, 0.04], [L0, 0]]];
  for (let k = 1; k <= 12; k++) {
    const t = k / 13.5, x = L0 + t * (L1 - L0), y = 0.06 * t * t, dx = 0.2, tt = Math.min(0.97, t + dx / (L1 - L0));
    for (const s of [-1, 1]) lines.push([[x, y], [L0 + tt * (L1 - L0), y + s * half(tt) * 0.92 + 0.02]]);
  }
  return { out, lines, spots: [] };
}

function brachiopod() {
  // Spirifer: a winged shell with a straight hinge, ribs fanning from the beak, a central fold
  const beak = [0, -0.36];
  const out = [[-0.8, -0.28]];
  for (let i = 0; i <= 40; i++) { const f = i / 40 * Math.PI; out.push([-Math.cos(f) * 0.8 * (1 - 0.12 * Math.sin(f)), -0.28 + Math.sin(f) * 0.72 * (0.82 + 0.18 * Math.sin(f))]); }
  out.push([0.8, -0.28], [0.12, -0.3], [0.04, -0.4], [-0.04, -0.4], [-0.12, -0.3]);
  const rim = out.slice(1, 42);
  const lines = [];
  for (let i = 1; i < rim.length - 1; i += 2) { const p = rim[i]; lines.push([[beak[0] + (p[0] - beak[0]) * 0.08, beak[1] + (p[1] - beak[1]) * 0.08], [p[0] * 0.98, p[1] * 0.98 - 0.005]]); }
  for (const s of [-1, 1]) lines.push([[0.03 * s, -0.33], [0.16 * s, 0.1], [0.2 * s, 0.4]]);
  for (const k of [0.45, 0.68, 0.86]) lines.push(rim.map(([x, y]) => [beak[0] + (x - beak[0]) * k, beak[1] + (y - beak[1]) * k]));
  return { out, lines, spots: [] };
}

function crinoid() {
  // a sea-lily stem of stacked discs, and three loose discs with their star-shaped canals
  const P = (t) => [-0.82 + t * 1.5, 0.22 - t * 0.5 + 0.12 * Math.sin(t * Math.PI)];
  const N = (t) => { const a = P(t - 0.01), c = P(t + 0.01); const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy); return [-dy / l, dx / l]; };
  const w = 0.075, up = [], dn = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30, p = P(t), n = N(t); up.push([p[0] + n[0] * w, p[1] + n[1] * w]); dn.push([p[0] - n[0] * w, p[1] - n[1] * w]); }
  const out = [...up, ...dn.reverse()];
  const lines = [];
  for (let i = 1; i < 38; i++) { const t = i / 38, p = P(t), n = N(t); lines.push([[p[0] + n[0] * w * 0.97, p[1] + n[1] * w * 0.97], [p[0] - n[0] * w * 0.97, p[1] - n[1] * w * 0.97]]); }
  const discs = [[0.36, 0.36, 0.1], [-0.46, -0.36, 0.085], [0.7, 0.3, 0.075]];
  const spots = [];
  for (const [x, y, r] of discs) {
    const c = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU; c.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.92]); }
    lines.push(c);
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU - Math.PI / 2; lines.push([[x, y], [x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45]]); }
    spots.push([x, y, r * 0.15]);
  }
  return { out, lines, spots, extra: discs };
}

// rock colour, body colour, ink: as found in the field
export const FOSSILS = [
  { id: 'trilobite', name: 'Elrathia Trilobite', shape: trilobite(), stone: '#b8ab92', body: '#3a3530', scale: 0.16 },
  { id: 'ammonite', name: 'Ammonite', shape: ammonite(), stone: '#6f6a62', body: '#9a7c55', scale: 0.17 },
  { id: 'knightia', name: 'Knightia Herring', shape: knightia(), stone: '#d2c09c', body: '#7a5634', scale: 0.17 },
  { id: 'fossilleaf', name: 'Florissant Leaf', shape: leaf(), stone: '#d8cdb4', body: '#8a5a2e', scale: 0.17 },
  { id: 'brachiopod', name: 'Spirifer Brachiopod', shape: brachiopod(), stone: '#8d8a82', body: '#cfc3a8', scale: 0.15 },
  { id: 'crinoid', name: 'Crinoid Stem', shape: crinoid(), stone: '#9b978d', body: '#d9d0bc', scale: 0.17 },
];

// ---------- slab textures (colour + relief) drawn from the outlines ----------
function slabTextures(f, seed) {
  const N = 256, rng = new RNG(seed);
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const col = mk(), bmp = mk();
  const g = col.getContext('2d'), h = bmp.getContext('2d');
  const P = ([x, y]) => [N / 2 + x * N * 0.42, N / 2 + y * N * 0.42];
  const path = (pts, close) => { const p = new Path2D(); pts.forEach((q, i) => { const [x, y] = P(q); if (i) p.lineTo(x, y); else p.moveTo(x, y); }); if (close) p.closePath(); return p; };
  // the matrix: mottled, with fine laminae
  g.fillStyle = f.stone; g.fillRect(0, 0, N, N);
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
  for (let i = 0; i < 260; i++) {
    const x = rng.range(0, N), y = rng.range(0, N), r = rng.range(2, 18);
    g.fillStyle = `rgba(${rng.chance(0.5) ? '255,250,235' : '40,30,20'},${rng.range(0.03, 0.08)})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    h.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${rng.range(0.03, 0.07)})`;
    h.beginPath(); h.arc(x, y, r * 0.6, 0, TAU); h.fill();
  }
  for (let i = 0; i < 14; i++) { const y = rng.range(0, N); g.fillStyle = 'rgba(60,45,30,0.05)'; g.fillRect(0, y, N, rng.range(1, 3)); }
  // the fossil itself: a little darker or paler than the rock, raised, its grooves cut in
  const body = path(f.shape.out, true);
  g.save(); g.shadowColor = 'rgba(20,12,6,0.45)'; g.shadowBlur = 5; g.shadowOffsetX = 1.5; g.shadowOffsetY = 2;
  g.fillStyle = f.body; g.globalAlpha = 0.85; g.fill(body); g.restore();
  h.save(); h.filter = 'blur(2px)'; h.fillStyle = '#c8c8c8'; h.fill(body); h.restore();
  g.lineCap = h.lineCap = 'round'; g.lineJoin = h.lineJoin = 'round';
  g.strokeStyle = 'rgba(25,16,8,0.55)'; g.lineWidth = 1.2;
  h.strokeStyle = '#5a5a5a'; h.lineWidth = 1.6;
  for (const l of f.shape.lines) { const p = path(l, false); g.stroke(p); h.stroke(p); }
  g.lineWidth = 1.6; g.strokeStyle = 'rgba(25,16,8,0.6)'; g.stroke(body);
  for (const [x, y, r] of f.shape.spots) { const [px, py] = P([x, y]); g.fillStyle = 'rgba(20,14,8,0.7)'; g.beginPath(); g.arc(px, py, r * N * 0.42, 0, TAU); g.fill(); }
  const t1 = new THREE.CanvasTexture(col); t1.colorSpace = THREE.SRGBColorSpace; t1.anisotropy = 4;
  const t2 = new THREE.CanvasTexture(bmp); t2.anisotropy = 4;
  return { map: t1, bump: t2 };
}

// a thin, irregular slab; the cylinder's top cap carries the fossil
function slabGeometry(seed) {
  const g = new THREE.CylinderGeometry(1, 1.06, 1, 22, 1);
  const p = g.attributes.position, rng = new RNG(seed), jit = Array.from({ length: 23 }, () => rng.range(0.86, 1.08));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r < 1e-3) continue;
    const a = Math.atan2(z, x), k = jit[Math.round(((a + Math.PI) / TAU) * 22) % 22];
    p.setXYZ(i, x * k, p.getY(i) + (p.getY(i) > 0 ? rng.range(-0.08, 0.04) : 0), z * k * 0.82);
  }
  g.translate(0, 0.5, 0);
  g.computeVertexNormals();
  return g;
}

export class Fossils {
  constructor(scene, app) {
    this.scene = scene; this.app = app;
    this.list = [];       // fossils lying in the open, waiting to be picked up
    this.anims = [];
    this.kinds = FOSSILS.map((f, i) => {
      const tx = slabTextures(f, 40 + i);
      // the cylinder's groups: side, top (the fossil), bottom
      const side = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.stone).multiplyScalar(0.72), roughness: 0.95 });
      const top = new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 2.2, roughness: 0.85 });
      return { f, mat: [side, top, side], geo: slabGeometry(70 + i) };
    });
    // one of each sits far below the world so its shader is compiled with everything else at load
    this.warm = this.kinds.map((k) => { const m = new THREE.Mesh(k.geo, k.mat); m.position.set(0, -400, 0); m.scale.setScalar(0.01); scene.add(m); return m; });
  }

  // assign fossils to the liftable stones (deterministic, so the same stones hide them every visit)
  seed(rocks, canCarry) {
    const rng = new RNG(1977);
    const order = [0, 1, 2, 3, 4, 5];
    let n = 0;
    for (const rk of rocks) if (canCarry(rk) && rng.chance(0.03)) { rk.fossil = order[n % order.length]; n++; if (n % 6 === 0) rng.shuffle ? rng.shuffle(order) : order.push(order.shift()); }
    this.hidden = n;
    return n;
  }

  // a stone was lifted off one: it lies there in the dirt (or on the creek bed)
  reveal(kind, x, z, rk) {
    const k = this.kinds[kind], f = k.f;
    const m = new THREE.Mesh(k.geo, k.mat);
    const s = f.scale * (0.9 + Math.random() * 0.25);
    const y = groundAt(x, z) - 0.01;
    m.position.set(x, y, z);
    m.rotation.set((Math.random() - 0.5) * 0.12, Math.random() * TAU, (Math.random() - 0.5) * 0.12);
    m.scale.set(s, s * 0.22, s);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    const wet = isWater(x, z) && y < waterLevel(z);
    const fo = { kind, f, m, x, z, y, pick: { x, y: y + 0.05, z, r: 0.32, label: `Fossil · ${f.name}`, hint: 'click to collect', kind: 'fossil' } };
    fo.pick.obj = fo;
    this.list.push(fo);
    rk.fossil = null;
    return fo;
  }

  pickables() { return this.list.map((f) => f.pick); }

  collect(fo) {
    const a = this.app;
    const i = this.list.indexOf(fo);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.anims.push({ fo, t: 0 });
    a.audio.play('clack', { x: fo.x, y: fo.y, z: fo.z, gain: 0.35, size: 0.25 });
    setTimeout(() => a.audio.play('chime', { x: fo.x, y: fo.y + 0.3, z: fo.z, gain: 0.55, wet: 0.5 }), 180);
    const n = (parseInt(a.ui.load('riffle.fossils') || '0', 10) || 0) + 1;
    a.ui.save('riffle.fossils', String(n));
    if (!a.ui.discover(fo.f.id, 'found')) a.ui.toast(`<div class="t-n">${fo.f.name}</div><div class="t-l">fossil collected · ${n} in your pack</div>`, 'small', 2600);
  }

  update(dt) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const an = this.anims[i];
      an.t += dt;
      const u = Math.min(1, an.t / 0.55), m = an.fo.m;
      m.position.y = an.fo.y + Math.sin(u * Math.PI * 0.5) * 0.45;
      m.rotation.y += dt * 5;
      m.scale.multiplyScalar(u > 0.5 ? Math.exp(-dt * 9) : 1);
      if (u >= 1) { this.scene.remove(m); this.anims.splice(i, 1); }
    }
  }
}
