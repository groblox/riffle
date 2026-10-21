// Tiny modeling kit: merge scaled/rotated primitives with vertex colours into one geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { U, commonGLSL, patchMaterial } from '../core/env.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();

function colorize(g, c) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// parts: { type: 'sphere'|'cone'|'box'|'cyl'|custom geometry, p, s, r, c, seg }
export function build(parts) {
  const geos = parts.map((pt) => {
    let g;
    const seg = pt.seg || 12;
    if (pt.geo) g = pt.geo.clone();
    else if (pt.type === 'cone') g = new THREE.ConeGeometry(1, 1, seg, 1);
    else if (pt.type === 'box') g = new THREE.BoxGeometry(1, 1, 1);
    else if (pt.type === 'cyl') g = new THREE.CylinderGeometry(pt.rt ?? 1, pt.rb ?? 1, 1, seg, 1);
    else g = new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.75));
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    const s = pt.s || [1, 1, 1];
    tmpE.set(...(pt.r || [0, 0, 0]));
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(...(pt.p || [0, 0, 0])), tmpQ, new THREE.Vector3(...s));
    g.applyMatrix4(tmpM);
    colorize(g, pt.c || [1, 1, 1]);
    return g;
  });
  const m = mergeGeometries(geos, false);
  m.computeBoundingSphere();
  return m;
}

export function critterMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.7, metalness: 0, side: opts.side || THREE.FrontSide, transparent: !!opts.transparent, opacity: opts.opacity ?? 1 });
  if (opts.snowFree !== false) {
    patchMaterial(mat, {
      fragmentHead: commonGLSL,
      fragment: opts.fragment || {},
      vertexHead: opts.vertexHead || '',
      vertex: opts.vertex || {},
      uniforms: opts.uniforms || {},
    }, opts.fragment || opts.vertex ? (opts.key || 'critter-x') : 'critter');
  }
  return mat;
}

// Flat wing / fin shape from 2D outline points (x,y), in XY plane
export function shapeGeo(points, holes = []) {
  const sh = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(sh);
  return g;
}

export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
