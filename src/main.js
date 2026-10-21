import * as THREE from 'three';
import { U, initEnv } from './core/env.js';
import { Controls } from './core/controls.js';
import { Interaction } from './core/interact.js';
import { Pipeline } from './gfx/pipeline.js';
import { buildTerrain } from './world/terrain.js';
import { layoutRocks, Rocks } from './world/rocks.js';
import { Sky } from './world/sky.js';
import { Water } from './world/water.js';
import { Waterfall } from './world/waterfall.js';
import { Lake } from './world/lake.js';
import { Vegetation } from './world/vegetation.js';
import { Particles } from './fx/particles.js';
import { Leaves } from './fx/leaves.js';
import { Fishes } from './critters/fish.js';
import { Butterflies, Dragonflies } from './critters/bugs.js';
import { Ravens, Dippers, Heron } from './critters/birds.js';
import { Chipmunks, Lizards, Frogs, Grasshoppers } from './critters/ground.js';
import { UnderRock } from './critters/under.js';
import { Camp } from './world/camp.js';
import { Fossils } from './world/fossils.js';
import { AudioEngine } from './audio/audio.js';
import { UI } from './ui/ui.js';
import * as shapeModule from './world/shape.js';
import { smoothstep, clamp } from './noise.js';
import { WF_Z, WF_LEN, streamCenter, waterLevel, groundAt, streamTurb, streamHalfW } from './world/shape.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  document.getElementById('ui').innerHTML = '<div style="position:fixed;inset:0;display:grid;place-items:center;font-family:Inter,sans-serif;color:#f6efe4;text-align:center;padding:24px">Riffle needs WebGL 2 with hardware acceleration.<br><span style="opacity:.6;font-size:13px">Try a recent Chrome, Edge or Firefox with graphics acceleration enabled.</span></div>';
  throw e;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const overlay = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.15, 7000);
camera.layers.enable(1);

const tick = () => new Promise((r) => setTimeout(r, 16));

// High is the default and is meant to keep a current mid/high-end GPU (e.g. an RTX 4070 Ti) busy;
// if it runs badly on first load we fall back to Low (see the frame-rate check in frame()).
const QUALITY = [
  { name: 'Low', dpr: 0.75, msaa: 2, shadow: 2048, shadowR: 1.5, grass: 0.3, grassFar: 100, refl: 0.35, ao: null },
  { name: 'High', dpr: 1.0, msaa: 4, shadow: 8192, shadowR: 2.5, grass: 1.0, grassFar: 165, refl: 1.0, ao: { scale: 1.0, samples: 16 } },
  { name: 'Ultra', dpr: 1.5, msaa: 4, shadow: 8192, shadowR: 3, grass: 1.0, grassFar: 200, refl: 1.0, ao: { scale: 1.0, samples: 24 } },
];

const audio = new AudioEngine();
const app = { scene, overlay, camera, renderer, canvas, audio, U, pointerInside: true };
window.__riffle = app;
app.shape = shapeModule;

const ui = new UI(document.getElementById('ui'), {
  setTime: (t) => { app.sky.time = t; },
  togglePause: () => { app.sky.paused = !app.sky.paused; ui.setPaused(app.sky.paused); },
  setWeather: (w) => {
    app.sky.cloudTarget = w === 'clear' ? 0.28 : w === 'cloudy' ? 0.82 : 0.95;
    app.sky.rainTarget = w === 'rain' ? 1 : 0;
    app.windBase = w === 'rain' ? Math.max(1.0, app.windUser) : app.windUser;
  },
  setSeason: (s) => { app.seasonTarget = s; },
  setWind: (v) => { app.windUser = v; app.windBase = v; },
  setVolume: (v) => audio.setVolume(v),
  setMusicVolume: (v) => audio.setMusicVolume(v),
  toggleMute: () => { audio.setMuted(!audio.muted); ui.setMuted(audio.muted); },
  toggleMusic: () => { audio.setMusic(!audio.musicOn); ui.setMusic(audio.musicOn); },
  setQuality: (q) => app.setQuality(q),
  pageSound: () => audio.play('page', { gain: 0.6, wet: 0.05 }),
  bookSound: (name) => audio.play(name, { gain: 0.8, wet: 0.04 }),
  setControls: (on) => { const c = app.controls; if (!c) return; c.enabled = on; c.keys.clear(); c.velocity.set(0, 0, 0); },
  toggleCamp: () => app.camp && app.camp.toggle(),
});
app.ui = ui;

async function boot() {
  ui.setProgress(0.05, 'Weaving noise…');
  await tick();
  initEnv();
  ui.setProgress(0.15, 'Carving the canyon…');
  await tick();
  const rockData = layoutRocks();
  buildTerrain(scene);
  ui.setProgress(0.35, 'Placing boulders…');
  await tick();
  app.rocks = new Rocks(scene, rockData);
  app.sky = new Sky(scene);
  ui.setProgress(0.45, 'Growing aspens and grass…');
  await tick();
  const qIdx = params.has('q') ? parseInt(params.get('q'), 10) : 1;
  app.quality = QUALITY[qIdx];
  // grass is built at full (High) density; lower presets draw a fraction of each chunk
  app.veg = new Vegetation(scene, rockData, 1, 1.6);
  ui.setProgress(0.7, 'Filling the creek…');
  await tick();
  app.water = new Water(renderer, rockData);
  overlay.add(app.water.mesh);
  app.falls = new Waterfall(app.water, rockData);
  overlay.add(app.falls.mesh);
  app.lake = new Lake(overlay, app.water.uniforms);
  app.parts = new Particles(5000, false, true); app.parts.water = app.water;
  app.sparks = new Particles(2500, true, false);
  overlay.add(app.parts.points, app.sparks.points);
  // silt stirred off the creek bed lives in the main scene so the water refracts and tints it
  app.silt = new Particles(600, false, true);
  scene.add(app.silt.points);
  app.leaves = new Leaves(scene, app.water);
  ui.setProgress(0.82, 'Waking the critters…');
  await tick();
  const ctx = { water: app.water, parts: app.parts, audio, onEvent: null };
  app.fish = new Fishes(scene, ctx, 26);
  app.butterflies = new Butterflies(scene, ctx, app.veg.flowers, 16);
  app.dragonflies = new Dragonflies(scene, ctx, 10);
  app.ravens = new Ravens(scene, ctx, 3);
  app.dippers = new Dippers(scene, ctx, rockData, 3);
  app.heron = new Heron(scene, ctx);
  app.chipmunks = new Chipmunks(scene, ctx, 8);
  app.lizards = new Lizards(scene, ctx, rockData, 7);
  app.frogs = new Frogs(scene, ctx, 8);
  app.hoppers = new Grasshoppers(scene, ctx);
  app.under = new UnderRock(scene, ctx);
  app.critterList = [app.fish, app.butterflies, app.dragonflies, app.ravens, app.dippers, app.heron, app.chipmunks, app.lizards, app.frogs, app.under];

  app.pipeline = new Pipeline(renderer);
  app.controls = new Controls(camera, canvas);
  const c0 = app.controls;
  app.interact = new Interaction(app);
  app.camp = new Camp(scene, app);
  app.fossils = new Fossils(scene, app);
  app.fossils.seed(app.rocks.rocks, (r) => app.rocks.canCarry(r));
  // the orbiting eye never dips inside a boulder (the erratic is big enough to swallow it)
  c0.solidAt = (x, z) => app.rocks.supportAt(x, z);
  audio.onHeard = (id) => ui.discover(id, 'heard');

  // initial state
  app.windUser = 0.6; app.windBase = 0.6;
  app.seasonTarget = 1; U.uSeason.value = 1;
  const c = app.controls;
  if (params.has('t')) app.sky.time = parseFloat(params.get('t'));
  if (params.has('x')) c.target.x = c.smoothTarget.x = parseFloat(params.get('x'));
  if (params.has('z')) c.target.z = c.smoothTarget.z = parseFloat(params.get('z'));
  if (params.has('d')) c.dist = c.distT = parseFloat(params.get('d'));
  if (params.has('yaw')) c.yaw = c.yawT = parseFloat(params.get('yaw'));
  if (params.has('p')) c.pitchOffset = c.pitchOffsetT = parseFloat(params.get('p'));
  if (params.has('pause')) app.sky.paused = true;
  if (params.has('season')) { app.seasonTarget = U.uSeason.value = parseFloat(params.get('season')); }
  if (params.has('rain')) { app.sky.rainTarget = U.uRain.value = 1; app.sky.cloudTarget = U.uCloud.value = 0.95; }

  canvas.addEventListener('pointerenter', () => { app.pointerInside = true; });
  canvas.addEventListener('pointerleave', () => { app.pointerInside = false; });

  function resize() {
    const q = app.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * q.dpr * (params.has('dpr') ? parseFloat(params.get('dpr')) : 1);
    const w = Math.max(2, Math.floor(window.innerWidth * dpr)), h = Math.max(2, Math.floor(window.innerHeight * dpr));
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    canvas.width = w; canvas.height = h;
    renderer.setViewport(0, 0, w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    app.pipeline.setSize(w, h, q.msaa);
    app.water.setSize(w, h);
    app.height = h;
  }
  app.setQuality = (q) => {
    app.quality = QUALITY[q];
    app.veg.lodScale = app.quality.grass;
    app.veg.grassFar = app.quality.grassFar;
    app.sky.setShadowQuality(app.quality.shadow, app.quality.shadowR);
    app.water.reflScale = app.quality.refl;
    const ao = app.quality.ao;
    app.pipeline.ao.on = !!ao;
    if (ao) Object.assign(app.pipeline.ao, ao);
    resize();
  };
  window.addEventListener('resize', resize);
  app.setQuality(qIdx);
  ui.selectSeg('.quality', 'q', qIdx);

  // keyboard shortcuts (UI-level)
  c.on('key', (e) => {
    if (!c.enabled) return;
    if (e.code === 'KeyH') ui.toggleHidden();
    if (e.code === 'KeyJ') ui.toggleGuide();
    if (e.code === 'KeyP') { app.sky.paused = !app.sky.paused; ui.setPaused(app.sky.paused); }
    if (e.code === 'KeyM') { audio.setMuted(!audio.muted); ui.setMuted(audio.muted); }
    if (e.code === 'KeyN') { audio.setMusic(!audio.musicOn); ui.setMusic(audio.musicOn); }
    if (e.code === 'KeyT') app.sky.time = (app.sky.time + 1) % 24;
    if (e.code === 'Slash') ui.toggleHints();
    if (e.code === 'Escape') ui.toggleGuide(false);
  });

  // ---- intro: slow cinematic orbit until the player enters ----
  let entered = false;
  if (!params.has('d')) { c.dist = c.distT = 46; }
  ui.setProgress(0.9, 'Tuning the light…');
  await tick();
  try {
    camera.updateMatrixWorld();
    await renderer.compileAsync(scene, camera);
    await renderer.compileAsync(overlay, camera);
  } catch (e) { console.warn('precompile', e); }
  ui.setProgress(1, 'Ready');
  ui.ready(() => {
    entered = true;
    audio.init();
    c.enabled = true;
    if (!params.has('d')) c.distT = 30;
  });
  if (params.has('play')) document.querySelector('.enter').click();

  // ---- ambient effect spawners ----
  const acc = { mist: 0, fly: 0, rain: 0, leaf: 0, midge: 0 };
  function ambientFx(dt) {
    const f = c.smoothTarget;
    // waterfall: churning white water and spray where the chutes punch into the pool, drops tearing
    // off the edges of the jets, and mist drifting downstream
    const wfz = WF_Z + WF_LEN + 0.25, wfx = streamCenter(wfz);
    if (Math.hypot(f.x - wfx, f.z - wfz) < 110 && app.falls.chutes.length) {
      const fp = acc.fp || (acc.fp = {});
      const W = app.falls.totalW;
      acc.mist += dt * (18 + W * 14);
      while (acc.mist > 1) {
        acc.mist -= 1;
        app.falls.footPoint(fp);
        // boiling white churn right at the impact
        app.parts.spawn({ x: fp.x + (Math.random() - 0.5) * 0.25, y: fp.y + 0.02, z: fp.z + Math.random() * 0.35, vx: (Math.random() - 0.5) * 0.5, vy: 0.35 + Math.random() * 0.7, vz: 0.15 + Math.random() * 0.5, life: 0.9 + Math.random() * 0.6, size: 0.18, size1: 0.75, color: [0.95, 0.97, 1, 0.22], gravity: 0.6, drag: 1.6, shape: 3 });
        // spray thrown up and out
        for (let k = 0; k < 2; k++) {
          app.falls.footPoint(fp);
          app.parts.spawn({ x: fp.x, y: fp.y + 0.04, z: fp.z - 0.05 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 1.4, vy: 1.0 + Math.random() * 2.0, vz: 0.1 + Math.random() * 1.6, life: 1.1, size: 0.016 + Math.random() * 0.016, color: [0.9, 0.96, 1, 0.8], drag: 0.35, shape: 4, water: 'die' });
        }
        // mist rolling downstream off the pool
        if (Math.random() < 0.35) {
          app.falls.footPoint(fp);
          app.parts.spawn({ x: fp.x + (Math.random() - 0.5) * 0.6, y: fp.y + 0.15 + Math.random() * 0.3, z: fp.z + 0.3 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 0.25, vy: 0.12 + Math.random() * 0.2, vz: 0.35 + Math.random() * 0.4, life: 3.5, size: 0.5, size1: 2.0, color: [0.92, 0.96, 1, 0.045], gravity: -0.02, drag: 0.6, shape: 3 });
        }
        // drops tearing off the sides of the jets
        if (Math.random() < 0.6) {
          const d = app.falls.edgeDrop(fp);
          if (d) app.parts.spawn({ x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, life: 0.9, size: 0.014 + Math.random() * 0.014, color: [0.88, 0.95, 1, 0.85], drag: 0.15, shape: 4, water: 'ripple' });
        }
      }
      if (Math.random() < dt * 22) { app.falls.footPoint(fp); app.water.disturb(fp.x, fp.z + Math.random() * 0.5, 0.3, 0.025 + fp.w * 0.012); }
    }
    // fireflies at night, midges by day near water
    const night = U.uNight.value;
    if (night > 0.5 && U.uSeason.value < 1.5 && U.uRain.value < 0.3) {
      acc.fly += dt * 4 * night;
      while (acc.fly > 1) {
        acc.fly -= 1;
        const x = f.x + (Math.random() - 0.5) * 60, z = f.z + (Math.random() - 0.5) * 60;
        const g = Math.max(groundAt(x, z), waterLevel(z));
        app.sparks.spawn({ x, y: g + 0.3 + Math.random() * 1.8, z, life: 6 + Math.random() * 6, size: 0.12, color: [0.75, 1.0, 0.35, 1], gravity: 0, drag: 1, shape: 0, wander: 0.9, flicker: 2.2 + Math.random() * 2, fadeIn: 1.5 });
      }
    }
    if (night < 0.3 && U.uRain.value < 0.3 && U.uSeason.value < 1.6) {
      acc.midge += dt * 14;
      while (acc.midge > 1) {
        acc.midge -= 1;
        const z = f.z + (Math.random() - 0.5) * 40;
        const x = streamCenter(z) + (Math.random() - 0.5) * streamHalfW(z) * 2.6;
        const y = Math.max(groundAt(x, z), waterLevel(z)) + 0.4 + Math.random() * 1.5;
        app.sparks.spawn({ x, y, z, life: 4 + Math.random() * 3, size: 0.025, color: [1, 0.95, 0.8, 0.5], gravity: 0, drag: 2, wander: 3, flicker: 9, fadeIn: 1 });
      }
    }
    // rain / snow around the camera
    const cp = camera.position;
    const rain = U.uRain.value;
    const snowing = U.uSeason.value > 1.6;
    if (rain > 0.05) {
      acc.rain += dt * rain * (snowing ? 220 : 650);
      while (acc.rain > 1) {
        acc.rain -= 1;
        const x = cp.x + (Math.random() - 0.5) * 50, z = cp.z + (Math.random() - 0.5) * 50;
        const y = cp.y + 6 + Math.random() * 14;
        if (snowing) app.parts.spawn({ x, y, z, vx: U.uWind.value.x * 1.2, vy: -1.1, vz: U.uWind.value.y * 1.2, life: 14, size: 0.05, color: [1, 1, 1, 0.9], gravity: 0, drag: 0, shape: 4, wander: 1.2, water: 'die' });
        else app.parts.spawn({ x, y, z, vx: U.uWind.value.x * 2, vy: -14, vz: U.uWind.value.y * 2, life: 2.5, size: 0.35, color: [0.75, 0.8, 0.9, 0.28], gravity: 0, drag: 0, shape: 1, water: 'die' });
      }
    }
    // autumn leaves drifting from aspens in the wind
    if (U.uSeason.value > 0.5 && U.uSeason.value < 1.7) {
      acc.leaf += dt * (0.4 + U.uWind.value.z * 2.5 * (0.5 + app.gust));
      while (acc.leaf > 1) {
        acc.leaf -= 1;
        const near = app.veg.trees.filter((tr) => (tr.kind === 'aspen' || tr.kind === 'willow') && Math.abs(tr.x - f.x) < 45 && Math.abs(tr.z - f.z) < 45);
        if (near.length) {
          const tr = near[Math.floor(Math.random() * near.length)];
          const a = Math.random() * 6.28;
          app.leaves.spawn(tr.x + Math.cos(a) * tr.r * 0.8, tr.y + tr.h * (0.5 + Math.random() * 0.4), tr.z + Math.sin(a) * tr.r * 0.8);
        }
      }
    }
  }

  // ---- frame loop ----
  let last = performance.now();
  const sunScreen = new THREE.Vector3();
  let fpsAcc = 0, fpsN = 0, flash = 0;
  app.gust = 0;
  const right = new THREE.Vector3();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    last = now;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 1) {
      const fps = fpsN / fpsAcc;
      ui.setFps(Math.round(fps));
      fpsAcc = 0; fpsN = 0;
      // first-run safety net: if the default preset is struggling, step down once and say so
      if (entered && !params.has('q') && app.quality === QUALITY[1] && !app.qualityChecked) {
        app.fpsLog = (app.fpsLog || []).concat(fps);
        if (app.fpsLog.length >= 6) {
          app.qualityChecked = true;
          const avg = app.fpsLog.slice(2).reduce((a, b) => a + b, 0) / (app.fpsLog.length - 2);
          if (avg < 32) { app.setQuality(0); ui.selectSeg('.quality', 'q', 0); ui.toast('Switched to Low quality for a smoother frame rate', '', 3500); }
        }
      }
    }
    U.uTime.value += dt;
    const t = U.uTime.value;

    if (!entered) c.yawT += dt * 0.04;
    c.update(dt);
    camera.updateMatrixWorld();
    U.uCamPos.value.copy(camera.position);

    // season & wind
    U.uSeason.value += (app.seasonTarget - U.uSeason.value) * Math.min(1, dt * 0.6);
    U.uSnow.value = smoothstep(1.4, 2.0, U.uSeason.value);
    app.gust = smoothstep(0.3, 0.9, 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3));
    const wv = U.uWind.value;
    const wa = 0.7 + Math.sin(t * 0.017) * 0.3;
    wv.x = Math.cos(wa); wv.y = Math.sin(wa);
    wv.z += ((app.windBase ?? 0.6) * (0.75 + app.gust * 0.5) - wv.z) * Math.min(1, dt * 0.8);

    app.sky.update(dt, c.smoothTarget, c.dist * 1.1 + 22);
    app.sky.follow(camera.position);
    ui.setClock(app.sky.time, U.uSeason.value);

    app.interact.update(dt);
    app.water.update(dt);
    app.rocks.update(dt);
    app.veg.update(dt, camera.position);
    const cur = app.interact.cursor;
    app.fish.update(dt);
    app.butterflies.update(dt, c.smoothTarget);
    app.dragonflies.update(dt);
    app.ravens.update(dt);
    app.dippers.update(dt);
    app.heron.update(dt, camera.position);
    app.chipmunks.update(dt, cur);
    app.lizards.update(dt, cur);
    app.frogs.update(dt, cur);
    app.hoppers.update(dt);
    app.under.update(dt);
    app.camp.update(dt);
    app.fossils.update(dt);
    ambientFx(dt);
    app.leaves.update(dt);
    const light = app.parts.uniforms.uLight.value;
    const sl = U.uSunIntensity.value * 0.18 + 0.05;
    light.set(U.uSkyAmb.value.r * 1.4 + sl * U.uSunColor.value.r, U.uSkyAmb.value.g * 1.4 + sl * U.uSunColor.value.g, U.uSkyAmb.value.b * 1.4 + sl * U.uSunColor.value.b);
    app.parts.update(dt, camera, app.height);
    app.silt.uniforms.uLight.value.copy(light);
    app.silt.update(dt, camera, app.height);
    app.sparks.update(dt, camera, app.height);

    // audio
    camera.getWorldDirection(right); right.cross(camera.up).normalize();
    audio.update(dt, {
      camPos: camera.position, right, focus: c.smoothTarget, zoom: c.dist, wind: wv.z, gust: app.gust, rain: U.uRain.value,
      night: U.uNight.value, season: U.uSeason.value, turb: clamp(streamTurb(c.smoothTarget.z) + 0.3, 0, 1.5),
      onThunder: () => { flash = 1; ui.flash(0.8); },
    });

    // render
    renderer.shadowMap.needsUpdate = true;
    // one planar reflection a frame: the tarn's when it's in view up close, otherwise the creek's
    app.water.renderReflection(scene, camera, c.smoothTarget.z, app.lake.wantsReflection(camera) ? app.shape.LAKE.y : undefined);
    app.water.bindFrame(app.pipeline, camera, app.sky.sun);
    sunScreen.copy(app.sky.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const inFront = sunScreen.z < 1;
    const edge = Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y));
    const vis = inFront ? (1 - smoothstep(0.9, 1.5, edge)) * smoothstep(-0.03, 0.08, app.sky.sunDir.y) * (1 - U.uCloud.value * 0.75) : 0;
    flash *= Math.exp(-dt * 6);
    app.pipeline.exposure = (0.82 + U.uNight.value * 0.75) * (1 + flash * 1.5);
    const nt = U.uNight.value;
    app.pipeline.finalMat.uniforms.uTint.value.set(1 - nt * 0.22, 1 - nt * 0.1, 1 + nt * 0.18);
    // golden hours: sunlit things warm, shadows cool; dawn rosier and paler, evening deeper gold
    {
      const e = app.sky.sunDir.y, low = smoothstep(-0.12, 0.03, e) * (1 - smoothstep(0.14, 0.4, e)) * (1 - U.uCloud.value * 0.5);
      const am = app.sky.time < 12;
      const fu = app.pipeline.finalMat.uniforms;
      fu.uHighTint.value.set(1 + low * (am ? 0.045 : 0.07), 1 + low * (am ? 0.0 : -0.01), 1 - low * (am ? 0.03 : 0.1));
      fu.uShadowTint.value.set(1 - low * (am ? 0.06 : 0.04), 1 - low * 0.02, 1 + low * (am ? 0.09 : 0.08));
    }
    app.pipeline.render(scene, overlay, camera, { sunUv: { x: sunScreen.x * 0.5 + 0.5, y: sunScreen.y * 0.5 + 0.5, vis } });
  }
  requestAnimationFrame(frame);
}
boot().catch((e) => { console.error(e); ui.setProgress(1, 'Something went wrong: ' + e.message); });
