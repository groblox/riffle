// Third-person "toy" camera: WASD pans a focus point over the land, scroll zooms,
// right-drag / Q,E orbit. Pitch eases flatter when zoomed in for an immersive view.
// The focus is held inside the valley by a soft bumper, and the eye never strays near the world's edge.
// Holding Shift slows everything (walking, orbiting, zooming) for fine framing.
// Seated (in a camp chair or the tent) the eye is fixed in place and dragging / A D Q E W S only turn the head.
// Touch: one finger drags the land along (it glides on a little when let go), two fingers turn and tilt the
// view (a twist turns it too) and pinch zooms. A tap is a click; press and hold, then drag, is the hand
// (carrying a stone, trailing it through the water).
import * as THREE from 'three';
import { groundAt, waterLevel, isWater, streamCenter, VIEW, TRAIL, CAMPSITES } from '../world/shape.js';
import { clamp, smoothstep, lerp } from '../noise.js';

const FINE = 0.28; // Shift: precision movement
const SLOP = 10;    // px a finger may wander and still count as a tap or a hold
const HOLD = 0.32;  // s of stillness before a press becomes a hold

export class Controls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(8.5, 0, 16);
    this.smoothTarget = this.target.clone();
    this.yaw = 0.18;        // radians; 0 = looking toward -z
    this.yawT = this.yaw;
    this.pitchOffset = 0; this.pitchOffsetT = 0;
    this.dist = 34; this.distT = 34;
    this.keys = new Set();
    this.mouse = new THREE.Vector2(0, 0);
    this.mouseNdc = new THREE.Vector2(0, 0);
    this.dragging = false; this.dragButton = -1;
    this.last = new THREE.Vector2();
    this.enabled = false;
    this.velocity = new THREE.Vector3();
    this.listeners = { click: [], down: [], up: [], key: [], hold: [] };
    this.downPos = new THREE.Vector2();
    this.leftDown = false;
    this.autoTour = 0;
    this.seat = null;      // { eye, yaw, pitch, yawT, pitchT } while sitting
    this.blend = 1;        // 0..1 easing between a seated view and the orbit view
    this.from = null;
    this.solidAt = null;   // (x, z) -> top of anything solid there (big rocks), set by the app
    this.flight = null;    // a glide to somewhere (flyTo); any steering of your own ends it
    this.occP = 0;         // extra pitch while a wall is behind the eye: the view rises over it instead of sinking in
    this.baseFov = 50;     // widened on tall (portrait) screens so the view isn't a slot; see setAspect
    // touch
    this.touches = new Map();  // pointerId -> { x, y }
    this.touch = false;        // the last input was a finger (the UI switches to touch hints and buttons)
    this.onTouchMode = null;   // (on) -> void, set by the app
    this.held = false;         // a press held still long enough to become the hand
    this.holdT = -1;
    this.panning = false;
    this.multi = false;        // two fingers took part in this touch: no tap, no hold
    this.pan = new THREE.Vector3();
    this.panVel = new THREE.Vector3();
    this.panFrom = new THREE.Vector2();
    this.panT = 0;
    this.gest = null;          // two-finger gesture { cx, cy, span, ang }
    this.lastTouchUp = -1e9;
    this.ray = new THREE.Raycaster();

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      for (const f of this.listeners.key) f(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { this.touchDown(e); return; }
      this.setTouch(false);
      if (!this.enabled) return;
      try { dom.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.mouse.set(e.clientX, e.clientY);
      this.updateNdc();
      this.dragButton = e.button; this.dragging = true;
      this.last.set(e.clientX, e.clientY);
      this.downPos.set(e.clientX, e.clientY);
      this.moved = 0;
      if (e.button === 0) { this.leftDown = true; for (const f of this.listeners.down) f(e); }
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') { this.touchMove(e); return; }
      if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) this.setTouch(false);
      this.mouse.set(e.clientX, e.clientY);
      this.updateNdc();
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last.set(e.clientX, e.clientY);
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.seat) {
        const s = this.seat, f = e.shiftKey ? FINE : 1, z = this.camera.fov / this.baseFov;
        s.yawT -= dx * 0.0042 * f * z;
        s.pitchT = clamp(s.pitchT - dy * 0.0035 * f * z, -1.0, 1.0);
      } else if (this.dragButton === 2 || this.dragButton === 1 || (this.dragButton === 0 && e.shiftKey)) {
        const f = e.shiftKey ? FINE : 1;
        this.yawT -= dx * 0.005 * f;
        this.pitchOffsetT = clamp(this.pitchOffsetT + dy * 0.003 * f, -0.5, 0.6);
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') { this.touchUp(e); return; }
      if (e.button === 0 && this.leftDown) {
        this.leftDown = false;
        for (const f of this.listeners.up) f(e);
        if (this.moved < 6) for (const f of this.listeners.click) f(e);
      }
      this.dragging = false;
    });
    dom.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') { this.touchUp(e, true); return; }
      if (this.leftDown) { this.leftDown = false; this.emit('up', e); }
      this.dragging = false;
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016 * (e.shiftKey ? FINE : 1));
      if (this.seat) this.seat.fovT = clamp(this.seat.fovT * k, this.baseFov * 0.36, this.baseFov * Math.max(1.1, this.seat.wide)); // seated: scroll narrows the view, like field glasses
      else this.distT = clamp(this.distT * k, 3.5, VIEW.maxDist);
    }, { passive: false });
  }

  on(type, f) { this.listeners[type].push(f); }
  emit(type, e) { for (const f of this.listeners[type]) f(e); }

  setTouch(on) {
    if (on === this.touch) return;
    this.touch = on;
    if (this.onTouchMode) this.onTouchMode(on);
  }

  // the view keeps a horizontal field of at least ~42 degrees, so a phone held upright still sees the valley
  setAspect(aspect) {
    const fov = Math.max(50, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(21)) / aspect)));
    const k = fov / this.baseFov;
    this.baseFov = fov;
    if (this.seat) { this.seat.fov *= k; this.seat.fovT *= k; }
    else if (this.blend >= 1) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  // ---- touch ----
  touchDown(e) {
    this.setTouch(true);
    if (!this.enabled) return;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 1) {
      this.mouse.set(e.clientX, e.clientY);
      this.updateNdc();
      this.last.set(e.clientX, e.clientY);
      this.downPos.set(e.clientX, e.clientY);
      this.panFrom.copy(this.downPos);
      this.moved = 0;
      this.dragging = true; this.dragButton = 0;
      this.held = false; this.panning = false; this.multi = false;
      this.holdT = performance.now() / 1000 + HOLD; // when the press becomes a hold (wall clock: slow frames mustn't stretch it)
      this.panVel.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
      this.leftDown = true;
      this.emit('down', e);
    } else if (this.touches.size === 2) {
      // a second finger: whatever the first was starting (a tap, a hold, a carry) is called off
      this.multi = true; this.holdT = -1; this.panning = false;
      if (this.leftDown) { this.leftDown = false; this.held = false; this.emit('up', e); }
      this.gest = this.gesture();
    }
  }

  gesture() {
    const [a, b] = [...this.touches.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, span: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (this.touches.size === 1) {
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last.set(e.clientX, e.clientY);
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.mouse.set(e.clientX, e.clientY);
      this.updateNdc();
      if (this.seat) {
        // seated, one finger looks around; the view follows it the way a photo is dragged
        if (this.moved < SLOP && !this.multi) return;
        this.holdT = -1;
        const s = this.seat, z = this.camera.fov / this.baseFov;
        s.yawT += dx * 0.0042 * z;
        s.pitchT = clamp(s.pitchT + dy * 0.0035 * z, -1.0, 1.0);
        return;
      }
      if (this.held) return;
      if (!this.panning && (this.multi || this.moved > SLOP)) { this.panning = true; this.holdT = -1; }
      if (this.panning) this.panBy(this.panFrom.x, this.panFrom.y, e.clientX, e.clientY);
      this.panFrom.set(e.clientX, e.clientY);
    } else if (this.touches.size === 2 && this.gest) {
      const g = this.gesture(), p = this.gest;
      const dx = g.cx - p.cx, dy = g.cy - p.cy, k = p.span / g.span;
      let da = g.ang - p.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (this.seat) {
        const s = this.seat, z = this.camera.fov / this.baseFov;
        s.fovT = clamp(s.fovT * k, this.baseFov * 0.36, this.baseFov * Math.max(1.1, s.wide));
        s.yawT += dx * 0.0042 * z;
        s.pitchT = clamp(s.pitchT + dy * 0.0035 * z, -1.0, 1.0);
      } else {
        this.distT = clamp(this.distT * k, 3.5, VIEW.maxDist);
        this.yawT -= dx * 0.006 - (g.span > 70 ? da : 0);
        this.pitchOffsetT = clamp(this.pitchOffsetT + dy * 0.004, -0.5, 0.6);
      }
      this.gest = g;
    }
  }

  touchUp(e, cancelled) {
    if (!this.touches.delete(e.pointerId)) return;
    const n = this.touches.size;
    if (n === 0) {
      this.dragging = false;
      this.lastTouchUp = performance.now() / 1000;
      if (this.leftDown) {
        this.leftDown = false;
        this.mouse.set(e.clientX, e.clientY);
        this.updateNdc();
        const tap = !cancelled && !this.multi && !this.held && !this.panning && this.moved < SLOP;
        this.emit('up', e);
        if (tap) this.emit('click', e);
      }
      // let go mid-swipe: the land glides on a little
      if (this.panning && performance.now() / 1000 - this.panT < 0.08) {
        const v = this.panVel, l = v.length(), max = 6 + this.dist * 2.5;
        if (l > max) v.multiplyScalar(max / l);
        this.velocity.copy(v);
      }
      this.panning = false; this.held = false; this.holdT = -1; this.gest = null;
    } else if (n === 1) {
      // back to one finger after a pinch: it carries on dragging the land from where it is now
      const [t] = this.touches.values();
      this.last.set(t.x, t.y); this.panFrom.set(t.x, t.y);
      this.panning = !this.seat; this.gest = null;
    } else if (n === 2) this.gest = this.gesture();
  }

  // where a screen point's ray meets the level of the focus (null near or above the horizon)
  planeHit(sx, sy, out) {
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera({ x: ((sx - r.left) / r.width) * 2 - 1, y: -((sy - r.top) / r.height) * 2 + 1 }, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y > -0.04) return null;
    const t = Math.min((this.smoothTarget.y - o.y) / d.y, this.dist * 5 + 20);
    if (t < 0) return null;
    return out.set(o.x + d.x * t, this.smoothTarget.y, o.z + d.z * t);
  }

  // drag the land: the patch of ground under the finger stays under it
  panBy(x0, y0, x1, y1) {
    const a = this.planeHit(x0, y0, new THREE.Vector3()), b = a && this.planeHit(x1, y1, new THREE.Vector3());
    const d = new THREE.Vector3();
    if (a && b) d.subVectors(a, b);
    else {
      // too near the horizon to grab: a flat push scaled by distance instead
      const k = 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.max(1, this.dom.clientHeight);
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw), mx = -(x1 - x0) * k, mz = -(y1 - y0) * k * 2;
      d.set(mx * c + mz * s, 0, -mx * s + mz * c);
    }
    const l = d.length(), max = this.dist * 0.6 + 2;
    if (l > max) d.multiplyScalar(max / l);
    this.pan.add(d);
    const now = performance.now() / 1000, dt = Math.max(1 / 240, now - this.panT);
    this.panVel.lerp(d.clone().divideScalar(dt), now - this.panT > 0.1 ? 1 : 0.4);
    this.panT = now;
  }

  updateNdc() {
    const r = this.dom.getBoundingClientRect();
    this.mouseNdc.set(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
  }

  basePitch(dist) {
    // close: nearly level (immersive); far: looking down (diorama)
    return lerp(0.13, 0.95, Math.pow(smoothstep(3.5, 150, dist), 0.6));
  }

  // is the eye (or the last stretch of the line to it) inside the terrain at this pitch? Only that end counts:
  // the focus itself trails the ground a little while it climbs, and the rock near it isn't what's in the way.
  rayBlocked(pitch) {
    const f = this.smoothTarget, cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dx = Math.sin(this.yaw) * cp * this.dist, dy = sp * this.dist, dz = Math.cos(this.yaw) * cp * this.dist;
    for (let i = 8; i <= 14; i++) {
      const u = i / 14;
      if (f.y + dy * u < this.surfaceY(f.x + dx * u, f.z + dz * u) - 0.35) return true;
    }
    return false;
  }

  // glide the focus to (x, z) and settle the zoom at `dist`
  flyTo(x, z, dist = 18) {
    if (this.seat) return;
    const t = this.target, far = Math.hypot(x - t.x, z - t.z);
    this.flight = { x0: t.x, z0: t.z, x1: x, z1: z, d0: this.distT, d1: dist, t: 0, dur: clamp(0.9 + far / 70, 0.9, 2.4) };
  }

  surfaceY(x, z) {
    const g = groundAt(x, z);
    return isWater(x, z) ? Math.max(g, waterLevel(z)) : g;
  }

  // sit down: the eye moves to a fixed spot (eye) looking along yaw; only the head turns from here
  sit(eye, yaw, pitch = -0.06, wide = 1) {
    const c = this.camera;
    this.from = { p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov };
    this.blend = 0;
    if (this.seat) { yaw = this.seat.yaw + Math.atan2(Math.sin(yaw - this.seat.yaw), Math.cos(yaw - this.seat.yaw)); }
    this.seat = { eye: eye.clone(), yaw, pitch, yawT: yaw, pitchT: pitch, fov: c.fov, fovT: this.baseFov * wide, wide };
    this.velocity.set(0, 0, 0);
    this.target.set(eye.x, 0, eye.z); this.smoothTarget.set(eye.x, eye.y - 1, eye.z);
    this.dist = this.distT = 3.5;
  }
  // stand up a step behind where you sat, looking the same way
  stand() {
    const s = this.seat;
    if (!s) return;
    const c = this.camera;
    this.from = { p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov };
    this.blend = 0;
    this.seat = null;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    this.target.set(s.eye.x + fx * 2.2, 0, s.eye.z + fz * 2.2);
    this.smoothTarget.copy(this.target); this.smoothTarget.y = groundAt(this.target.x, this.target.z);
    this.yaw = this.yawT = s.yaw;
    this.dist = this.distT = 6;
    this.pitchOffset = this.pitchOffsetT = 0;
  }

  // soft bumper: past the edge of the valley the focus is pushed back and outward motion dies away.
  // The trail and its campsites are open too, so you can follow the path up the mountain.
  bound(dt) {
    const t = this.target, v = this.velocity;
    const zc = clamp(t.z, -VIEW.z, VIEW.z), c = streamCenter(zc);
    const xc = clamp(t.x, c - VIEW.west, c + VIEW.east);
    let ex = t.x - xc, ez = t.z - zc;
    if (ex || ez) {
      let best = Infinity, bx = 0, bz = 0;
      for (let i = 0; i < TRAIL.length; i += 2) { const p = TRAIL[i], d = (t.x - p.x) ** 2 + (t.z - p.z) ** 2; if (d < best) { best = d; bx = p.x; bz = p.z; } }
      let R = 9;
      for (const s of CAMPSITES) { const d = (t.x - s.x) ** 2 + (t.z - s.z) ** 2; if (d < best) { best = d; bx = s.x; bz = s.z; R = s.r + 7; } }
      const d = Math.sqrt(best), o = Math.max(0, d - R);
      if (o * o < ex * ex + ez * ez) { ex = (t.x - bx) * o / (d || 1); ez = (t.z - bz) * o / (d || 1); }
    }
    const l = Math.hypot(ex, ez);
    if (l < 1e-6) return;
    const nx = ex / l, nz = ez / l;
    const vo = v.x * nx + v.z * nz;
    if (vo > 0) { const k = vo * (1 - Math.exp(-dt * 14)); v.x -= nx * k; v.z -= nz * k; }
    const k = 1 - Math.exp(-dt * 8);
    t.x -= ex * k; t.z -= ez * k;
    const over = l - 2.5; // never squash more than a couple of metres past it
    if (over > 0) { t.x -= nx * over; t.z -= nz * over; }
  }

  update(dt) {
    const k = this.keys;
    let fx = 0, fz = 0;
    const fine = k.has('ShiftLeft') || k.has('ShiftRight') ? FINE : 1;
    if (this.holdT > 0) {
      if (performance.now() / 1000 >= this.holdT) { this.holdT = -1; if (this.leftDown && !this.multi && this.moved < SLOP && !this.seat) { this.held = true; this.emit('hold'); } }
    }
    if (this.seat) { this.updateSeat(dt, fine); return; }
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (k.has('KeyQ')) this.yawT += dt * 1.4 * fine;
      if (k.has('KeyE')) this.yawT -= dt * 1.4 * fine;
      if (k.has('Equal') || k.has('NumpadAdd')) this.distT = clamp(this.distT * Math.exp(-dt * 1.5 * fine), 3.5, VIEW.maxDist);
      if (k.has('Minus') || k.has('NumpadSubtract')) this.distT = clamp(this.distT * Math.exp(dt * 1.5 * fine), 3.5, VIEW.maxDist);
    }
    const speed = (4 + this.dist * 0.55) * fine;
    const len = Math.hypot(fx, fz);
    const want = new THREE.Vector3();
    if (len > 0) {
      fx /= len; fz /= len;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      // forward is -z rotated by yaw
      want.set(fx * c + fz * s, 0, -fx * s + fz * c).multiplyScalar(speed);
    }
    if (this.panning) this.velocity.set(0, 0, 0);
    else this.velocity.lerp(want, 1 - Math.exp(-dt * 6));
    if (this.flight) {
      const F = this.flight;
      if (len > 0 || this.panning) this.flight = null;
      else {
        F.t = Math.min(1, F.t + dt / F.dur);
        const e = F.t * F.t * (3 - 2 * F.t);
        this.target.x = F.x0 + (F.x1 - F.x0) * e; this.target.z = F.z0 + (F.z1 - F.z0) * e;
        this.distT = F.d0 + (F.d1 - F.d0) * e;
        this.velocity.set(0, 0, 0);
        if (F.t >= 1) this.flight = null;
      }
    }
    this.target.addScaledVector(this.velocity, dt);
    this.target.add(this.pan); this.pan.set(0, 0, 0);
    this.bound(dt);
    const gy = this.surfaceY(this.target.x, this.target.z);
    // average surroundings so focus glides smoothly
    const r = 2.5;
    const avg = (gy * 2 + this.surfaceY(this.target.x + r, this.target.z) + this.surfaceY(this.target.x - r, this.target.z)
      + this.surfaceY(this.target.x, this.target.z + r) + this.surfaceY(this.target.x, this.target.z - r)) / 6;
    this.target.y = avg + 0.25;

    const a = 1 - Math.exp(-dt * 7);
    this.smoothTarget.lerp(this.target, a);
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * 8));
    this.dist += (this.distT - this.dist) * (1 - Math.exp(-dt * 6));
    this.pitchOffset += (this.pitchOffsetT - this.pitchOffset) * (1 - Math.exp(-dt * 8));

    // rock between the focus and the eye (a cliff behind you, a ridge in the way) would have the eye sink into
    // the wall and be hoisted onto its surface. Instead the camera tips up and looks down over it, by the least
    // amount that clears it; it rises quickly and settles back slowly.
    const pitch0 = clamp(this.basePitch(this.dist) + this.pitchOffset, 0.04, 1.45);
    let need = 0;
    if (this.rayBlocked(pitch0)) {
      let lo = 0, hi = 1.45 - pitch0;
      if (this.rayBlocked(pitch0 + hi)) need = hi;
      else { for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2; if (this.rayBlocked(pitch0 + m)) lo = m; else hi = m; } need = hi; }
    }
    this.occP += clamp((need - this.occP) * (1 - Math.exp(-dt * (need > this.occP ? 5 : 1.2))), -0.7 * dt, 1.5 * dt);
    const pitch = Math.min(1.45, pitch0 + this.occP);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const off = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    // the eye stays inside the detailed terrain: if orbiting or zooming would carry it out,
    // the focus slides inward instead
    const C = VIEW.cam;
    const sx = this.smoothTarget.x + off.x, sz = this.smoothTarget.z + off.z;
    const ox = sx > C ? sx - C : sx < -C ? sx + C : 0, oz = sz > C ? sz - C : sz < -C ? sz + C : 0;
    if (ox || oz) { this.smoothTarget.x -= ox; this.smoothTarget.z -= oz; this.target.x -= ox; this.target.z -= oz; }
    const pos = this.smoothTarget.clone().add(off);
    // keep camera above ground / water
    // (the highest of a few spots around the eye, so it starts to rise just before a ledge reaches it)
    let minY = isWater(pos.x, pos.z) ? Math.max(groundAt(pos.x, pos.z), waterLevel(pos.z)) + 0.55 : groundAt(pos.x, pos.z) + 1.05;
    for (let i = 0; i < 4; i++) minY = Math.max(minY, groundAt(pos.x + (i % 2 ? 1.2 : -1.2) * (i < 2 ? 1 : 0), pos.z + (i % 2 ? 1.2 : -1.2) * (i < 2 ? 0 : 1)) + 1.05);
    // never inside a boulder
    if (this.solidAt) minY = Math.max(minY, this.solidAt(pos.x, pos.z) + 0.7);
    // that floor climbs fast but only sinks gently, so riding over a cliff edge or a terrace doesn't snap the view
    if (this.floorY === undefined || Math.abs(minY - this.floorY) > 40 || this.blend < 1) this.floorY = minY;
    else { const d = minY - this.floorY; this.floorY += d > 0 ? Math.min(d, 20 * dt) : Math.max(d, -6 * dt); }
    if (pos.y < this.floorY) pos.y = this.floorY;
    this.camera.position.copy(pos);
    // look slightly above the focus when close, so the horizon shows
    const look = this.smoothTarget.clone();
    look.y += lerp(0.35, 0, smoothstep(4, 40, this.dist));
    this.camera.lookAt(look);
    this.ease(dt);
  }

  updateSeat(dt, fine) {
    const s = this.seat, k = this.keys, c = this.camera;
    if (this.enabled) {
      const turn = dt * 1.1 * fine * (c.fov / this.baseFov);
      if (k.has('KeyA') || k.has('ArrowLeft') || k.has('KeyQ')) s.yawT += turn;
      if (k.has('KeyD') || k.has('ArrowRight') || k.has('KeyE')) s.yawT -= turn;
      if (k.has('KeyW') || k.has('ArrowUp')) s.pitchT = clamp(s.pitchT + turn * 0.8, -1.0, 1.0);
      if (k.has('KeyS') || k.has('ArrowDown')) s.pitchT = clamp(s.pitchT - turn * 0.8, -1.0, 1.0);
    }
    const a = 1 - Math.exp(-dt * 9);
    s.yaw += (s.yawT - s.yaw) * a;
    s.pitch += (s.pitchT - s.pitch) * a;
    s.fov += (s.fovT - s.fov) * (1 - Math.exp(-dt * 6));
    // a slow breath
    const t = performance.now() / 1000;
    c.position.copy(s.eye); c.position.y += Math.sin(t * 1.3) * 0.006;
    c.rotation.set(s.pitch + Math.sin(t * 0.7) * 0.003, s.yaw, 0, 'YXZ');
    c.fov = s.fov; c.updateProjectionMatrix();
    this.ease(dt);
  }

  // glide between the seated view and the orbit view
  ease(dt) {
    if (this.blend >= 1) return;
    const c = this.camera, f = this.from;
    this.blend = Math.min(1, this.blend + dt / 1.0);
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    c.position.lerpVectors(f.p, c.position, e);
    c.quaternion.slerpQuaternions(f.q, c.quaternion.clone(), e);
    if (!this.seat) { c.fov = f.fov + (this.baseFov - f.fov) * e; c.updateProjectionMatrix(); }
  }
}
