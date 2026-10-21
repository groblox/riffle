// Fossil sketches, drawn from the same outlines as the slabs in the world: the slab in a buff wash,
// the fossil in its own wash, ink outline, thin ink for segments, ribs and veins, hatching along the shadow side.
import { FOSSILS } from '../../world/fossils.js';

const X = (x) => (120 + x * 92).toFixed(1), Y = (y) => (80 + y * 92).toFixed(1);
const d = (pts, close) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x)} ${Y(y)}`).join('') + (close ? 'Z' : '');

function sketch(f) {
  const s = f.shape;
  // the slab: a rough, flat-topped stone a little bigger than the fossil
  const slab = [];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, k = 1 + 0.06 * Math.sin(i * 2.7) + 0.04 * Math.sin(i * 5.3);
    slab.push([Math.cos(a) * 0.98 * k, Math.sin(a) * 0.74 * k]);
  }
  const hatch = [];
  for (let i = 0; i < 9; i++) { const a = 0.35 + i * 0.12; hatch.push(`M${X(Math.cos(a) * 0.9)} ${Y(Math.sin(a) * 0.68)}l5 -5`); }
  return `
    <path class="wash" fill="${f.stone}" d="${d(slab, true)}"/>
    <path class="wash" fill="${f.body}" d="${d(s.out, true)}"/>
    <path class="ink thin" d="${d(slab, true)}"/>
    <path class="ink" d="${d(s.out, true)}"/>
    <path class="ink thin" d="${s.lines.map((l) => d(l, false)).join('')}"/>
    ${s.spots.map(([x, y, r]) => `<circle class="spot" cx="${X(x)}" cy="${Y(y)}" r="${(r * 92).toFixed(1)}"/>`).join('')}
    <path class="hatch" d="${hatch.join('')}"/>
    <path class="ink thin" d="M10 150c60-3 160 2 220-1"/>`;
}

export default Object.fromEntries(FOSSILS.map((f) => [f.id, sketch(f)]));
