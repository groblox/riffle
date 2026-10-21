// Third-person "toy" camera: WASD pans a focus point over the land, scroll zooms,
// right-drag / Q,E orbit. Pitch eases flatter when zoomed in for an immersive view.
// The focus is held inside the valley by a soft bumper, and the eye never strays near the world's edge.
// Holding Shift slows everything (walking, orbiting, zooming) for fine framing.
// Seated (in a camp chair or the tent) the eye is fixed in place and dragging / A D Q E W S only turn the head.
import * as THREE from 'three';
import { groundAt, waterLevel, isWater, streamCenter, VIEW, TRAIL, CAMPSITES } from '../world/shape.js';
import { clamp, smoothstep, lerp } from '../noise.js';

const FINE = 0.28; // Shift: precision movement

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
    this.listeners = { click: [], down: [], up: [], key: [] };
    this.downPos = new THREE.Vector2();
    this.leftDown = false;
    this.autoTour = 0;
    this.seat = null;      // { eye, yaw, pitch, yawT, pitchT } while sitting
    this.blend = 1;        // 0..1 easing between a seated view and the orbit view
    this.from = null;
    this.solidAt = null;   // (x, z) -> top of anything solid there (big rocks), set by the app

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      for (const f of this.listeners.key) f(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      try { dom.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.dragButton = e.button; this.dragging = true;
      this.last.set(e.clientX, e.clientY);
      this.downPos.set(e.clientX, e.clientY);
      this.moved = 0;
      if (e.button === 0) { this.leftDown = true; for (const f of this.listeners.down) f(e); }
    });
    dom.addEventListener('pointermove', (e) => {
      this.mouse.set(e.clientX, e.clientY);
      this.updateNdc();
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last.set(e.clientX, e.clientY);
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.seat) {
        const s = this.seat, f = e.shiftKey ? FINE : 1, z = this.camera.fov / 50;
        s.yawT -= dx * 0.0042 * f * z;
        s.pitchT = clamp(s.pitchT - dy * 0.0035 * f * z, -1.0, 1.0);
      } else if (this.dragButton === 2 || this.dragButton === 1 || (this.dragButton === 0 && e.shiftKey)) {
        const f = e.shiftKey ? FINE : 1;
        this.yawT -= dx * 0.005 * f;
        this.pitchOffsetT = clamp(this.pitchOffsetT + dy * 0.003 * f, -0.5, 0.6);
      }
    });
    dom.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this.leftDown) {
        this.leftDown = false;
        for (const f of this.listeners.up) f(e);
        if (this.moved < 6) for (const f of this.listeners.click) f(e);
      }
      this.dragging = false;
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0016 * (e.shiftKey ? FINE : 1));
      if (this.seat) this.seat.fovT = clamp(this.seat.fovT * k, 18, 55); // seated: scroll narrows the view, like field glasses
      else this.distT = clamp(this.distT * k, 3.5, VIEW.maxDist);
    }, { passive: false });
  }

  on(type, f) { this.listeners[type].push(f); }

  updateNdc() {
    const r = this.dom.getBoundingClientRect();
    this.mouseNdc.set(((this.mouse.x - r.left) / r.width) * 2 - 1, -((this.mouse.y - r.top) / r.height) * 2 + 1);
  }

  basePitch(dist) {
    // close: nearly level (immersive); far: looking down (diorama)
    return lerp(0.13, 0.95, Math.pow(smoothstep(3.5, 150, dist), 0.6));
  }

  surfaceY(x, z) {
    const g = groundAt(x, z);
    return isWater(x, z) ? Math.max(g, waterLevel(z)) : g;
  }

  // sit down: the eye moves to a fixed spot (eye) looking along yaw; only the head turns from here
  sit(eye, yaw, pitch = -0.06) {
    const c = this.camera;
    this.from = { p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov };
    this.blend = 0;
    if (this.seat) { yaw = this.seat.yaw + Math.atan2(Math.sin(yaw - this.seat.yaw), Math.cos(yaw - this.seat.yaw)); }
    this.seat = { eye: eye.clone(), yaw, pitch, yawT: yaw, pitchT: pitch, fov: 50, fovT: 50 };
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
    this.velocity.lerp(want, 1 - Math.exp(-dt * 6));
    this.target.addScaledVector(this.velocity, dt);
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

    const pitch = clamp(this.basePitch(this.dist) + this.pitchOffset, 0.04, 1.45);
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
    let minY = isWater(pos.x, pos.z) ? Math.max(groundAt(pos.x, pos.z), waterLevel(pos.z)) + 0.55 : groundAt(pos.x, pos.z) + 1.05;
    // never inside a boulder
    if (this.solidAt) minY = Math.max(minY, this.solidAt(pos.x, pos.z) + 0.7);
    if (pos.y < minY) pos.y = minY;
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
      const turn = dt * 1.1 * fine * (c.fov / 50);
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
    if (!this.seat) { c.fov = f.fov + (50 - f.fov) * e; c.updateProjectionMatrix(); }
  }
}
