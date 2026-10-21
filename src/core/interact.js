// Picking & interaction: hover labels, clicks on creatures/plants/rocks/water/ground,
// dragging a hand through the water, carrying / stacking / throwing / turning over stones,
// skipping stones, planting flowers, floating leaves, whistling.
import * as THREE from 'three';
import { U } from './env.js';
import { groundAt, waterLevel, isWater, bioAt, normalAt, flowAt, WF_Z } from '../world/shape.js';
import { splashFx, dustFx } from '../fx/particles.js';
import { rockTopAt } from '../world/rocks.js';
import { TREE_IDS, FLOWER_IDS } from '../ui/guide.js';
import { clamp } from '../noise.js';

const TREE_LABEL = { aspen: 'Quaking Aspen', spruce: 'Engelmann Spruce', juniper: 'Utah Juniper', sage: 'Big Sagebrush', rabbit: 'Rubber Rabbitbrush', willow: 'Willow & Red-osier Dogwood' };
const FLOWER_LABEL = ['Colorado Blue Columbine', 'Indian Paintbrush', 'Purple Aster', 'Blanketflower'];

export class Interaction {
  constructor(app) {
    this.app = app;
    this.ray = new THREE.Raycaster();
    this.cursor = { x: 0, y: 0, z: 0, active: false, water: false };
    this.hovered = null;
    this.dragAcc = 0;
    this.stones = [];
    this.lastHoverT = 0;
    this.stoneGeo = new THREE.SphereGeometry(1, 10, 8).scale(1, 0.4, 0.85);
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x7b746c, roughness: 0.6 });
    // soft cursor ring that hugs the ground / water
    const ringGeo = new THREE.RingGeometry(0.82, 1.0, 48).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xfff1dc, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 5; this.ring.frustumCulled = false;
    app.overlay.add(this.ring);
    this.ringPulse = 0;
    const c = app.controls;
    c.on('click', (e) => { this.ringPulse = 1; this.click(e); });
    c.on('down', () => { this.dragging = true; this.pressDown(); });
    c.on('up', () => { this.dragging = false; this.pressUp(); });
    this.press = null;      // stone under the pointer when the button went down
    this.carrying = null;   // stone being carried
    app.rocks.onImpact = (rk, x, y, z, speed, water, what) => this.rockImpact(rk, x, y, z, speed, water, what);
    app.rocks.onMoved = (rk, from) => this.rockMoved(rk, from);
    c.on('key', (e) => this.key(e));
  }

  // ---- ray helpers ----
  setRay() {
    this.ray.setFromCamera(this.app.controls.mouseNdc, this.app.camera);
    return this.ray.ray;
  }
  surfaceAt(x, z) {
    const g = groundAt(x, z), w = waterLevel(z);
    if (isWater(x, z)) return { y: w, water: true };
    return { y: g, water: false };
  }
  marchGround(ray, maxT = 700) {
    const o = ray.origin, d = ray.direction;
    let t = 0.3, prevT = 0;
    while (t < maxT) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const s = this.surfaceAt(x, z);
      if (y < s.y) {
        let a = prevT, b = t;
        for (let i = 0; i < 14; i++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
          if (my < this.surfaceAt(mx, mz).y) b = m; else a = m;
        }
        const x2 = o.x + d.x * b, z2 = o.z + d.z * b;
        const s2 = this.surfaceAt(x2, z2);
        return { x: x2, y: s2.y, z: z2, t: b, water: s2.water };
      }
      prevT = t;
      t += Math.max(0.12, t * 0.012);
    }
    return null;
  }

  allPickables() {
    const a = this.app;
    const list = [];
    for (const c of a.critterList) list.push(...c.pickables());
    if (a.camp) list.push(...a.camp.pickables());
    if (a.fossils) list.push(...a.fossils.pickables());
    for (const t of a.veg.trees) {
      if (!t.pick) {
        const small = ['sage', 'rabbit'].includes(t.kind);
        t.pick = { x: t.x, y: t.y + t.h * (small ? 0.5 : 0.62), z: t.z, r: small ? Math.max(0.6, t.r * 0.7) : t.r * 1.05, label: TREE_LABEL[t.kind], guide: TREE_IDS[t.kind], kind: 'tree', obj: t, lowPri: true };
      }
      list.push(t.pick);
    }
    for (const f of a.veg.flowers) {
      if (!f.pick) f.pick = { x: f.x, y: f.y + f.s * 0.7, z: f.z, r: 0.38, label: FLOWER_LABEL[f.type], guide: FLOWER_IDS[f.type], kind: 'flower', obj: f };
      list.push(f.pick);
    }
    for (const r of a.rocks.rocks) {
      if (r.r < 0.16 || r.moving) continue;
      if (!r.pick) {
        const small = a.rocks.canCarry(r);
        const name = r.house && r.r > 4 ? 'Glacial Erratic' : r.stepping ? 'Stepping Stone' : r.kind === 0 ? (small ? 'Sandstone Chunk' : 'Sandstone Boulder') : (small ? 'Granite Cobble' : 'Granite Boulder');
        r.pick = { x: r.center.x, y: r.center.y, z: r.center.z, r: Math.max(r.radius * 0.85, 0.28), label: name, hint: small ? 'drag to carry · click to turn over' : null, guide: r.kind === 0 ? 'sandstone' : 'granite', kind: 'rock', obj: r, lowPri: !small };
      }
      list.push(r.pick);
    }
    return list;
  }

  pickObject(ray, maxT) {
    const o = ray.origin, d = ray.direction;
    let best = null, bestT = maxT;
    const v = new THREE.Vector3();
    for (const p of this.allPickables()) {
      v.set(p.x - o.x, p.y - o.y, p.z - o.z);
      const tc = v.dot(d);
      if (tc < 0) continue;
      const d2 = v.lengthSq() - tc * tc;
      // small things get a forgiving, distance-scaled radius
      const r = p.lowPri ? p.r : Math.max(p.r, tc * 0.012);
      if (d2 > r * r) continue;
      const th = tc - Math.sqrt(r * r - d2);
      const score = th - (p.lowPri ? 0 : 0.8);
      if (score < bestT) { bestT = score; best = p; }
    }
    return best;
  }

  update(dt) {
    const a = this.app;
    const ray = this.setRay();
    const hit = this.marchGround(ray);
    const cur = this.cursor;
    if (hit) { cur.x = hit.x; cur.y = hit.y; cur.z = hit.z; cur.water = hit.water; cur.active = a.controls.enabled && a.pointerInside; }
    else cur.active = false;
    // hover pick (throttled)
    this.lastHoverT -= dt;
    if (this.lastHoverT < 0) {
      this.lastHoverT = 0.06;
      const placing = a.camp && a.camp.placing;
      this.hovered = a.controls.enabled && a.pointerInside && !this.carrying && !placing ? this.pickObject(ray, hit ? hit.t + 0.5 : 800) : null;
      const grabbable = this.hovered && this.hovered.kind === 'rock' && a.rocks.canCarry(this.hovered.obj);
      a.canvas.classList.toggle('hover', !!this.hovered || (cur.active && cur.water));
      a.canvas.classList.toggle('grab', !!grabbable && !this.carrying);
      a.canvas.classList.toggle('grabbing', !!this.carrying);
      const m = a.controls.mouse;
      if (placing) a.ui.showTooltip(cur.active && !a.controls.dragging ? a.camp.placeLabel : null, m.x, m.y, a.camp.placeHint);
      else a.ui.showTooltip(this.hovered && !a.controls.dragging ? this.hovered.label : null, m.x, m.y, this.hovered && this.hovered.hint);
    }
    // carrying a stone: lift it once the pointer starts to drag, then it follows the cursor
    if (this.press && !this.carrying && a.controls.leftDown && a.controls.moved > 6) {
      const rk = this.carrying = this.press; this.press = null;
      const x0 = rk.cx, z0 = rk.cz, wet = this.stoneWet(rk), fresh = !rk.lifted;
      a.rocks.grab(rk);
      a.audio.play('scrape', { x: x0, y: rk.y, z: z0, gain: 0.35, size: rk.r });
      this.lifted(rk);
      this.uncover(x0, z0, rk.r, wet, fresh, rk);
    }
    if (this.carrying && cur.active) a.rocks.holdAt(this.carrying, cur.x, cur.z);
    // cursor parts the grass
    const P = U.uPushers.value;
    if (cur.active && !cur.water) P[0].set(cur.x, cur.y, cur.z, a.controls.leftDown ? 1.4 : 0.85);
    else P[0].set(0, -1000, 0, 0);
    // hand in the water
    if (this.dragging && !this.carrying && !this.press && !(a.camp && a.camp.placing) && !a.controls.seat && a.controls.leftDown && cur.active && cur.water && a.controls.moved > 4) {
      this.dragAcc += dt;
      if (this.dragAcc > 0.035) {
        this.dragAcc = 0;
        a.water.disturb(cur.x, cur.z, 0.32, 0.018);
        a.fish.scare(cur.x, cur.z, 2.5);
        if (Math.random() < 0.08) a.audio.play('plop', { x: cur.x, y: cur.y, z: cur.z, gain: 0.25 });
      }
    }
    this.updateStones(dt);
    // cursor ring
    const show = cur.active && !a.controls.dragging || (cur.active && a.controls.leftDown);
    const target = show && !a.ui.hidden ? (this.hovered || this.carrying ? 0.55 : 0.22) : 0;
    this.ringMat.opacity += (target - this.ringMat.opacity) * Math.min(1, dt * 10);
    if (cur.active) {
      const n = cur.water ? new THREE.Vector3(0, 1, 0) : normalAt(cur.x, cur.z);
      const camD = a.camera.position.distanceTo(new THREE.Vector3(cur.x, cur.y, cur.z));
      this.ringPulse = Math.max(0, this.ringPulse - dt * 2.5);
      const s = clamp(camD * 0.012, 0.18, 1.6) * (1 + this.ringPulse * 0.8) * (this.hovered ? 1.15 + Math.sin(U.uTime.value * 6) * 0.06 : 1);
      this.ring.position.set(cur.x, cur.y + 0.03, cur.z);
      this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      this.ring.scale.setScalar(s);
      this.ringMat.color.set(this.carrying ? 0xffe2a8 : this.hovered ? 0xffc27a : cur.water ? 0xbff3ff : 0xfff1dc);
    }
  }

  scareAll(x, z, r) {
    for (const c of this.app.critterList) if (c.scare) c.scare(x, z, r);
  }

  discover(p, how) { if (p && p.guide) this.app.ui.discover(p.guide, how); }

  click() {
    const a = this.app;
    if (a.camp && a.camp.placing) { a.camp.confirm(); return; }
    const ray = this.setRay();
    const hit = this.marchGround(ray);
    const p = this.pickObject(ray, hit ? hit.t + 0.5 : 800);
    if (p) { this.clickObject(p, hit); return; }
    if (!hit) return;
    if (hit.water) {
      splashFx(a.parts, hit.x, hit.y, hit.z, 0.7);
      a.water.disturb(hit.x, hit.z, 0.55, 0.09);
      a.audio.play('splash', { x: hit.x, y: hit.y, z: hit.z, gain: 0.9, size: 0.7 });
      this.scareAll(hit.x, hit.z, 4);
    } else {
      const b = bioAt(hit.x, hit.z);
      const n = normalAt(hit.x, hit.z);
      if (n.y > 0.8 && b.canyon < 0.7) {
        a.hoppers.burst(hit.x, hit.z, 3 + Math.floor(Math.random() * 3));
        a.audio.play('rustle', { x: hit.x, y: hit.y, z: hit.z, gain: 0.35, size: 0.4 });
      } else {
        dustFx(a.parts, hit.x, hit.y, hit.z, b.canyon > 0.5 ? [0.75, 0.48, 0.32] : [0.55, 0.48, 0.38]);
        a.audio.play('tick', { x: hit.x, y: hit.y, z: hit.z, gain: 0.6 });
      }
      this.scareAll(hit.x, hit.z, 2.5);
    }
  }

  clickObject(p, hit) {
    const a = this.app;
    const o = p.obj;
    this.discover(p);
    switch (p.kind) {
      case 'fish':
        a.fish.scare(p.x, p.z, 1.5);
        a.water.disturb(p.x, p.z, 0.4, 0.04);
        a.audio.play('plop', { x: p.x, y: waterLevel(p.z), z: p.z, gain: 0.4 });
        break;
      case 'butterfly': a.butterflies.scare(p.x, p.z, 1.5); a.audio.play('pop', { x: p.x, y: p.y, z: p.z, gain: 0.25 }); break;
      case 'dragonfly': a.dragonflies.scare(p.x, p.z, 1.5); break;
      case 'raven': a.ravens.poke(o); break;
      case 'dipper': a.dippers.flyAway(o, true); break;
      case 'heron': a.heron.takeOff(); break;
      case 'chipmunk': a.chipmunks.scare(p.x, p.z, 1); break;
      case 'lizard': if (o.state === 'bask' && Math.random() < 0.5) { o.push = 1; } else a.lizards.scare(p.x, p.z, 1); break;
      case 'frog': a.frogs.jump(o); break;
      case 'tree': {
        a.veg.shakeTree(o, ['sage', 'rabbit'].includes(o.kind) ? 0.6 : 1);
        a.audio.play('rustle', { x: o.x, y: o.y + o.h * 0.6, z: o.z, gain: 1.0, size: o.kind === 'spruce' ? 0.7 : 1 });
        const leafy = (o.kind === 'aspen' || o.kind === 'willow') && U.uSeason.value < 1.7;
        const n = leafy ? 26 : o.kind === 'rabbit' ? 0 : 4;
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * 6.28, rr = Math.random() * o.r;
          a.leaves.spawn(o.x + Math.cos(ang) * rr, o.y + o.h * (0.45 + Math.random() * 0.45), o.z + Math.sin(ang) * rr, o.kind === 'spruce' ? [0.25, 0.3, 0.15] : null);
        }
        if (o.kind === 'rabbit' || o.kind === 'sage') this.pollen(o.x, o.y + o.h * 0.6, o.z, o.kind === 'rabbit' ? [1, 0.85, 0.3] : [0.85, 0.9, 0.8], 20);
        this.scareAll(o.x, o.z, 4);
        break;
      }
      case 'flower': {
        a.veg.bloomFlower(o);
        a.audio.play('chime', { x: o.x, y: o.y, z: o.z, gain: 0.7, wet: 0.5 });
        this.pollen(o.x, o.y + o.s * 0.8, o.z, [1, 0.9, 0.45], 26);
        // invite the nearest butterfly
        let best = null, bd = 1e9;
        for (const b of a.butterflies.list) { const d = Math.hypot(b.x - o.x, b.z - o.z); if (d < bd) { bd = d; best = b; } }
        if (best && bd < 40) { best.state = 'fly'; best.target = { x: o.x, z: o.z, y: o.y + o.s * 0.85, flower: o }; best.timer = 12; }
        break;
      }
      case 'rock': this.clickRock(o); break;
      case 'under': a.under.poke(o); break;
      case 'camp': a.camp.click(o); break;
      case 'fossil': a.fossils.collect(o); break;
      default: break;
    }
  }

  // ---- stones: knock, nudge, turn over, carry ----
  clickRock(o) {
    const a = this.app;
    const top = o.center.y + o.h * 0.4;
    if (a.rocks.canCarry(o)) {
      // turn it over: it rolls away from you and whatever lived beneath is caught in the open
      const dir = new THREE.Vector3(o.cx - a.camera.position.x, 0, o.cz - a.camera.position.z);
      const x0 = o.cx, z0 = o.cz;
      const wet = this.stoneWet(o), fresh = !o.lifted;
      if (!a.rocks.flip(o, dir)) return;
      a.audio.play('scrape', { x: x0, y: top, z: z0, gain: 0.6, size: o.r });
      this.lifted(o);
      this.uncover(x0, z0, o.r, wet, fresh, o);
    } else if (o.r < 1.3 && !o.sill && !o.hoodoo && !o.fixed) {
      a.rocks.wobble(o);
      a.audio.play('clack', { x: o.cx, y: top, z: o.cz, gain: 0.9, size: o.r * 1.5 });
      dustFx(a.parts, o.cx, top, o.cz, o.kind === 0 ? [0.7, 0.5, 0.36] : [0.6, 0.55, 0.5]);
    } else {
      // too big to budge: a dull knock, and sandstone sheds a trickle of grains
      a.audio.play('thud', { x: o.cx, y: top, z: o.cz, gain: 0.8, size: o.r });
      if (o.kind === 0) this.sandTrickle(o);
      else dustFx(a.parts, o.cx, top, o.cz, [0.6, 0.56, 0.52]);
    }
    this.scareAll(o.cx, o.cz, 3);
  }

  stoneWet(o) { return isWater(o.cx, o.cz) && o.y < waterLevel(o.cz) - 0.03; }

  // whatever lived under a stone is caught in the open (only where it had lain undisturbed)
  uncover(x, z, r, wet, fresh, rk) {
    const a = this.app;
    if (wet) this.silt(x, z, r);
    else dustFx(a.parts, x, groundAt(x, z), z, [0.42, 0.34, 0.25]);
    // about one stone in thirty hides a fossil
    if (rk && rk.fossil != null && a.fossils) {
      const fo = a.fossils.reveal(rk.fossil, x, z, rk);
      setTimeout(() => a.ui.toast(`<div class="t-n">A fossil!</div><div class="t-l">${fo.f.name} · click it to collect</div>`, 'small', 3000), 650);
    }
    if (!fresh) return;
    // only about half the stones have anything living under them; the rest just leave a damp print
    if (rk && rk.life == null) rk.life = Math.random() < 0.5;
    if (rk && !rk.life) { if (!wet) a.under.addPatch(x, z, r); return; }
    const found = a.under.reveal(x, z, r, wet, 0.25);
    if (found) setTimeout(() => {
      if (!a.ui.discover(found.guide, 'found')) a.ui.toast(`<div class="t-n">${found.label}</div><div class="t-l">under the stone</div>`, 'small', 2200);
    }, 700);
  }

  // a stone leaves the ground: anything near is disturbed, stones stacked on it drop
  lifted(rk) {
    const a = this.app;
    rk.lifted = true;
    this.scareAll(rk.cx, rk.cz, 2.5);
    for (const r of a.rocks.rocks) if (r.restOn === rk && !r.moving) { r.restOn = null; a.rocks.begin(r, 'fly'); }
  }

  pressDown() {
    const a = this.app;
    this.press = null;
    if ((a.camp && a.camp.placing) || a.controls.seat) return;
    const p = this.pickObject(this.setRay(), 800);
    if (p && p.kind === 'rock' && a.rocks.canCarry(p.obj) && !p.obj.moving) this.press = p.obj;
  }

  pressUp() {
    const a = this.app;
    this.press = null;
    if (this.carrying) { a.rocks.release(this.carrying); this.carrying = null; }
  }

  rockImpact(rk, x, y, z, speed, water, what) {
    const a = this.app;
    const size = rk.r;
    if (water && what === 'surface') {
      const k = clamp(speed * size * 0.35, 0.08, 1);
      splashFx(a.parts, x, y, z, k);
      a.water.disturb(x, z, 0.25 + size * 0.8, 0.03 + k * 0.12);
      a.audio.play(speed > 1.2 ? 'plunk' : 'plop', { x, y, z, gain: 0.4 + k * 0.5, size: size * 2 });
      a.fish.scare(x, z, 3 + k * 3);
      return;
    }
    const g = clamp(speed / 5, 0.2, 1);
    if (water) {
      a.audio.play('plop', { x, y: waterLevel(z), z, gain: 0.25 * g });
      this.silt(x, z, size * 0.7);
    } else {
      // landing on another stone rings; landing on soil thumps
      const onRock = a.rocks.supportAt(x, z, rk) > groundAt(x, z) + 0.04;
      a.audio.play(onRock ? 'clack' : 'thud', { x, y, z, gain: (onRock ? 0.9 : 0.6) * g, size: size * 1.6 });
      dustFx(a.parts, x, y, z, rk.kind === 0 ? [0.68, 0.5, 0.36] : [0.55, 0.5, 0.42]);
    }
    this.scareAll(x, z, 2 + speed * 0.4);
  }

  rockMoved(rk, from) {
    const a = this.app;
    // what is it resting on? (a stack of three or more makes a cairn)
    let under = null, best = groundAt(rk.cx, rk.cz) + 0.04;
    for (const r of a.rocks.near(rk.cx, rk.cz)) {
      if (r === rk) continue;
      const t = rockTopAt(r, rk.cx, rk.cz);
      if (t > best && t < rk.center.y) { best = t; under = r; }
    }
    rk.restOn = under;
    let n = 1;
    for (let r = rk.restOn; r && n < 12; r = r.restOn) n++;
    if (n >= 3 && n > (this.bestCairn || 2)) {
      this.bestCairn = n;
      a.ui.toast(`<div class="t-n">A cairn of ${n}</div><div class="t-l">${n >= 5 ? 'remarkably steady hands' : 'steady hands'}</div>`, 'small', 2600);
      a.audio.play('chime', { x: rk.cx, y: rk.center.y, z: rk.cz, gain: 0.5, wet: 0.5 });
    }
    // stones in the creek change how it flows
    if (from.stream || rk.stream) a.water.refreshFlow(from.z, rk.z);
    // a stone set on (or taken off) the lip re-splits the falls
    if (Math.abs(from.z - WF_Z) < 2.5 || Math.abs(rk.z - WF_Z) < 2.5) a.falls.rebuild();
    a.dippers.refreshPerches();
  }

  // a cloud of silt kicked up off the bed, drifting downstream
  silt(x, z, r) {
    const a = this.app;
    const f = flowAt(x, z);
    const y = groundAt(x, z) + 0.05;
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * 6.28, rr = Math.random() * r;
      a.silt.spawn({ x: x + Math.cos(ang) * rr, y: y + Math.random() * 0.12, z: z + Math.sin(ang) * rr, vx: f.x * 0.45 + Math.cos(ang) * 0.2, vy: 0.05 + Math.random() * 0.08, vz: f.z * 0.45 + Math.sin(ang) * 0.2, life: 5 + Math.random() * 4, size: 0.3, size1: 1.0 + r * 1.5, color: [0.5, 0.42, 0.3, 0.5], gravity: 0.012, drag: 0.4, shape: 3, fadeIn: 0.3 });
    }
  }

  sandTrickle(o) {
    const a = this.app;
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * 6.28;
      const x = o.cx + Math.cos(ang) * o.r * 0.7, z = o.cz + Math.sin(ang) * o.r * 0.7 * o.zs;
      const top = rockTopAt(o, x, z);
      a.parts.spawn({ x, y: (top > -Infinity ? top : o.center.y) + 0.02, z, vx: Math.cos(ang) * 0.25, vy: 0.1 + Math.random() * 0.3, vz: Math.sin(ang) * 0.25, life: 1.2, size: 0.018, color: [0.78, 0.58, 0.42, 0.9], drag: 0.6, shape: 4, gravity: 9.8 });
    }
    dustFx(a.parts, o.cx, o.center.y, o.cz, [0.72, 0.52, 0.38]);
  }

  pollen(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      this.app.sparks.spawn({
        x: x + (Math.random() - 0.5) * 0.3, y, z: z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 0.8, vy: 0.3 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.8,
        life: 2 + Math.random() * 2, size: 0.05 + Math.random() * 0.05, color: [...color, 0.9], gravity: -0.05, drag: 1.4, shape: 2, wander: 0.8, flicker: 6,
      });
    }
  }

  // ---- stones ----
  throwStone() {
    const a = this.app;
    const cur = this.cursor;
    if (!cur.active) return;
    const cam = a.camera.position;
    const fwd = new THREE.Vector3(cur.x - cam.x, 0, cur.z - cam.z);
    const dist = fwd.length();
    fwd.normalize();
    // throw from a little ahead of the camera (or near the target when zoomed out)
    const startDist = Math.max(0, dist - 22);
    const sx = cam.x + fwd.x * Math.max(1.5, startDist), sz = cam.z + fwd.z * Math.max(1.5, startDist);
    const sy = Math.max(groundAt(sx, sz), isWater(sx, sz) ? waterLevel(sz) : -1e9) + 1.4;
    const tx = cur.x, ty = cur.y, tz = cur.z;
    const dx = tx - sx, dz = tz - sz, hd = Math.hypot(dx, dz);
    const speed = clamp(hd / 0.9, 8, 22);
    const T = hd / speed;
    const vy = (ty - sy) / T + 0.5 * 9.8 * T;
    const m = new THREE.Mesh(this.stoneGeo, this.stoneMat);
    m.scale.setScalar(0.07); m.castShadow = true;
    a.scene.add(m);
    this.stones.push({ m, x: sx, y: sy, z: sz, vx: dx / T, vy, vz: dz / T, skips: 0, state: 'air', spin: 0, life: 0 });
    a.audio.play('throw', { x: sx, y: sy, z: sz, gain: 0.5 });
  }

  updateStones(dt) {
    const a = this.app;
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i];
      s.life += dt;
      if (s.state === 'air') {
        s.vy -= 9.8 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        s.spin += dt * 30;
        const wl = waterLevel(s.z);
        if (isWater(s.x, s.z) && s.y <= wl) {
          const hs = Math.hypot(s.vx, s.vz);
          const angle = Math.atan2(-s.vy, hs);
          if (hs > 3.2 && angle < 0.42 && s.skips < 14) {
            s.skips++;
            s.y = wl; s.vy = -s.vy * 0.62; s.vx *= 0.82; s.vz *= 0.82;
            a.water.disturb(s.x, s.z, 0.28, 0.035);
            splashFx(a.parts, s.x, wl, s.z, 0.12);
            a.audio.play('skip', { x: s.x, y: wl, z: s.z, gain: 0.7 });
          } else {
            a.water.disturb(s.x, s.z, 0.35, 0.06);
            splashFx(a.parts, s.x, wl, s.z, 0.35);
            a.audio.play('plop', { x: s.x, y: wl, z: s.z, gain: 0.8 });
            a.fish.scare(s.x, s.z, 3);
            if (s.skips >= 2) a.ui.toast(`${s.skips} skips${s.skips >= 6 ? ' — beautiful' : s.skips >= 4 ? ' — nice!' : ''}`, 'skip', 2000);
            s.state = 'sink'; s.life = 0;
          }
        } else if (s.y <= groundAt(s.x, s.z)) {
          s.y = groundAt(s.x, s.z) + 0.02;
          a.audio.play('clack', { x: s.x, y: s.y, z: s.z, gain: 0.6, size: 0.5 });
          dustFx(a.parts, s.x, s.y, s.z);
          this.scareAll(s.x, s.z, 3);
          s.state = 'rest'; s.life = 0;
        }
      } else if (s.state === 'sink') {
        s.y -= dt * 0.5;
        if (s.life > 2.5 || s.y < groundAt(s.x, s.z)) { a.scene.remove(s.m); this.stones.splice(i, 1); continue; }
      } else if (s.state === 'rest' && s.life > 30) { a.scene.remove(s.m); this.stones.splice(i, 1); continue; }
      s.m.position.set(s.x, s.y, s.z);
      s.m.rotation.set(0, s.spin, 0);
    }
  }

  key(e) {
    const a = this.app;
    if (!a.controls.enabled) return;
    const cur = this.cursor;
    switch (e.code) {
      case 'KeyF': this.throwStone(); break;
      case 'KeyC': if (a.camp && !this.carrying) a.camp.toggle(); break;
      case 'KeyR': if (a.camp) a.camp.rotate(); break;
      case 'KeyX': if (a.camp) a.camp.packUp(); break;
      case 'Escape': if (a.camp && !a.camp.getUp()) a.camp.cancel(); break;
      case 'KeyZ': if (a.camp) a.camp.sleep(); break;
      case 'KeyG':
        if (cur.active && !cur.water && normalAt(cur.x, cur.z).y > 0.7) {
          const type = Math.floor(Math.random() * 4);
          a.veg.plantFlower(cur.x, cur.z, type);
          a.audio.play('chime', { x: cur.x, y: cur.y, z: cur.z, gain: 0.5, wet: 0.4 });
          this.pollen(cur.x, cur.y + 0.2, cur.z, [0.7, 1, 0.6], 14);
        }
        break;
      case 'KeyB':
        if (cur.active && cur.water) {
          a.leaves.spawn(cur.x, cur.y + 0.02, cur.z, [0.95, 0.6, 0.1], { mode: 'water', boat: true, life: 240 });
          a.water.disturb(cur.x, cur.z, 0.3, 0.02);
          a.audio.play('plop', { x: cur.x, y: cur.y, z: cur.z, gain: 0.3 });
        }
        break;
      case 'Space': {
        e.preventDefault();
        a.audio.play('whistle', { gain: 0.6, wet: 0.5 });
        setTimeout(() => {
          const f = a.controls.smoothTarget;
          if (U.uNight.value < 0.5) {
            if (Math.random() < 0.6) a.audio.chickadee(f.x - 15 - Math.random() * 20, f.y + 6, f.z + (Math.random() - 0.5) * 30);
            else a.audio.canyonWren(f.x + 40, f.y + 20, f.z + (Math.random() - 0.5) * 40);
          } else a.audio.owl(f.x - 40, f.y + 15, f.z + (Math.random() - 0.5) * 40);
        }, 1400 + Math.random() * 900);
        for (const c of a.chipmunks.list) if (Math.hypot(c.x - cur.x, c.z - cur.z) < 25) { c.state = 'idle'; c.sit = 1; c.timer = 3; }
        break;
      }
      default: break;
    }
  }
}
