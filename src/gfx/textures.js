// Procedurally generated textures. All tileable.
import * as THREE from 'three';
import { mulberry32, clamp } from '../noise.js';

function hash2(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// periodic value noise
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const m = (a) => ((a % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// periodic gradient noise (smoother, less blocky)
function gnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const m = (a) => ((a % period) + period) % period;
  const g = (i, j) => { const a = hash2(m(i), m(j), seed) * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g00 = g(xi, yi), g10 = g(xi + 1, yi), g01 = g(xi, yi + 1), g11 = g(xi + 1, yi + 1);
  const n00 = g00[0] * fx + g00[1] * fy, n10 = g10[0] * (fx - 1) + g10[1] * fy;
  const n01 = g01[0] * fx + g01[1] * (fy - 1), n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 0.7071 + 0.5;
}
function fbm(x, y, period, oct, seed, fn = gnoise) {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let o = 0; o < oct; o++) { s += a * fn(x * f, y * f, period * f, seed + o * 17); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
function worley(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const mx = ((cx % period) + period) % period, my = ((cy % period) + period) % period;
    const px = cx + hash2(mx, my, seed), py = cy + hash2(mx, my, seed + 99);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(mx, my, seed + 7); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}

function makeTex(data, size, opts = {}) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = opts.aniso || 8;
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// RGBA: r = low fbm, g = mid fbm, b = high fbm, a = worley edges
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const r = fbm(u * 4, v * 4, 4, 5, 1);
    const g = fbm(u * 8, v * 8, 8, 4, 2);
    const b = fbm(u * 16, v * 16, 16, 4, 3);
    const [f1, f2] = worley(u * 12, v * 12, 12, 5);
    const i = (y * size + x) * 4;
    data[i] = clamp((r - 0.5) * 1.8 + 0.5, 0, 1) * 255;
    data[i + 1] = clamp((g - 0.5) * 1.8 + 0.5, 0, 1) * 255;
    data[i + 2] = clamp((b - 0.5) * 1.6 + 0.5, 0, 1) * 255;
    data[i + 3] = clamp(f2 - f1, 0, 1) * 255;
  }
  return makeTex(data, size);
}

// Pebbles / gravel: rgb = colour, a = height (dome)
export function makePebbleTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const P = 22;
  const palette = [
    [0.62, 0.58, 0.54], [0.5, 0.47, 0.44], [0.7, 0.45, 0.33], [0.55, 0.32, 0.24], [0.78, 0.72, 0.62],
    [0.4, 0.38, 0.36], [0.66, 0.55, 0.42], [0.35, 0.33, 0.3], [0.82, 0.6, 0.45], [0.58, 0.5, 0.5],
  ];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * P, v = y / size * P;
    const wu = u + (fbm(x / size * 8, y / size * 8, 8, 2, 11) - 0.5) * 0.6;
    const wv = v + (fbm(x / size * 8, y / size * 8, 8, 2, 12) - 0.5) * 0.6;
    const [f1, f2, id] = worley(wu, wv, P, 21);
    const edge = f2 - f1;
    const dome = clamp(edge * 2.4, 0, 1);
    const hgt = Math.sqrt(dome);
    const c = palette[Math.floor(id * palette.length) % palette.length];
    const grain = fbm(x / size * 64, y / size * 64, 64, 2, 31, vnoise);
    const shade = (0.55 + 0.45 * hgt) * (0.85 + 0.3 * grain);
    const gap = edge < 0.06 ? 0.35 : 1;
    const i = (y * size + x) * 4;
    data[i] = clamp(c[0] * shade * gap, 0, 1) * 255;
    data[i + 1] = clamp(c[1] * shade * gap, 0, 1) * 255;
    data[i + 2] = clamp(c[2] * shade * gap, 0, 1) * 255;
    data[i + 3] = hgt * 255;
  }
  return makeTex(data, size, { srgb: false });
}

// Sandstone strata palette (1D, linear colour)
export function makeStrataTexture() {
  const W = 256;
  const data = new Uint8Array(W * 4);
  const rnd = mulberry32(77);
  const cols = [
    [0.91, 0.82, 0.69], [0.85, 0.55, 0.37], [0.71, 0.33, 0.18], [0.49, 0.2, 0.13], [0.6, 0.45, 0.43],
    [0.94, 0.9, 0.84], [0.8, 0.42, 0.21], [0.76, 0.38, 0.22], [0.66, 0.3, 0.18], [0.88, 0.62, 0.42],
  ];
  const weights = [2, 3, 4, 2, 1, 1, 3, 4, 3, 2];
  const pick = () => { let tot = weights.reduce((a, b) => a + b, 0); let r = rnd() * tot; for (let i = 0; i < cols.length; i++) { r -= weights[i]; if (r <= 0) return cols[i]; } return cols[0]; };
  let x = 0;
  while (x < W) {
    const th = 1 + Math.floor(rnd() * rnd() * 14);
    const c = pick(); const j = 0.9 + rnd() * 0.2;
    for (let k = 0; k < th && x < W; k++, x++) {
      const fade = 0.96 + 0.04 * Math.sin(k * 1.7);
      data[x * 4] = clamp(c[0] * j * fade, 0, 1) * 255;
      data[x * 4 + 1] = clamp(c[1] * j * fade, 0, 1) * 255;
      data[x * 4 + 2] = clamp(c[2] * j * fade, 0, 1) * 255;
      data[x * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Water detail normal map: rg = normal xy, b = height, a = foam pattern
export function makeWaterNormalTexture(size = 256) {
  const hgt = new Float32Array(size * size);
  const foam = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // anisotropic-ish ripples: stretch across flow (x) a bit
    let h = 0;
    h += (gnoise(u * 6, v * 4, 6, 41) - 0.5) * 1.0;
    h += (gnoise(u * 12, v * 9, 12, 42) - 0.5) * 0.5;
    h += (gnoise(u * 24, v * 18, 24, 43) - 0.5) * 0.25;
    h += (gnoise(u * 48, v * 40, 48, 44) - 0.5) * 0.12;
    hgt[y * size + x] = h;
    const [f1, f2] = worley(u * 10, v * 10, 10, 50);
    const [g1, g2] = worley(u * 23, v * 23, 23, 51);
    foam[y * size + x] = clamp((f2 - f1) * 1.5, 0, 1) * 0.6 + clamp((g2 - g1) * 1.5, 0, 1) * 0.4;
  }
  const data = new Uint8Array(size * size * 4);
  const s = 6.0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yd = (y - 1 + size) % size, yu = (y + 1) % size;
    const dx = (hgt[y * size + xr] - hgt[y * size + xl]) * s;
    const dy = (hgt[yu * size + x] - hgt[yd * size + x]) * s;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    data[i] = clamp(-dx / l * 0.5 + 0.5, 0, 1) * 255;
    data[i + 1] = clamp(-dy / l * 0.5 + 0.5, 0, 1) * 255;
    data[i + 2] = clamp(hgt[y * size + x] * 0.8 + 0.5, 0, 1) * 255;
    data[i + 3] = foam[y * size + x] * 255;
  }
  return makeTex(data, size);
}

// Canvas helper
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let _shared = null;
export function sharedTextures() {
  if (_shared) return _shared;
  _shared = {
    noise: makeNoiseTexture(256),
    pebbles: makePebbleTexture(512),
    strata: makeStrataTexture(),
    waterNormal: makeWaterNormalTexture(256),
  };
  return _shared;
}
