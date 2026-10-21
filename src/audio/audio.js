// WebAudio soundscape. Mostly synthesized; a few recorded sounds (public/audio/sfx: the creek's bed, stones,
// the folio's leather and paper) are layered in once they've loaded, with the synthesized versions standing in
// until then. The music is a playlist of recorded flute (public/audio/music), streamed.
import { clamp, smoothstep, lerp } from '../noise.js';
import { streamCenter, waterLevel, streamHalfW, lateral, WF_Z, bioAt } from '../world/shape.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0, fx: 0, fz: -1 };
    this.volume = 0.9;      // effects and ambience
    this.musicVolume = 0.3;
    this.musicOn = true;
    this.muted = false;
    this.timers = {};
    this.onHeard = null; // callback(id) when a species is heard
    this.fire = null;    // { x, y, z, k } while a campfire burns
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.sr = ctx.sampleRate;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 3; this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    // reverb (canyon): long tail + discrete echoes off the walls
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(3.2, 2.4, [[0.32, 0.35], [0.61, 0.22], [0.95, 0.12]]);
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.55;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 1; this.ambBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.0; this.musicBus.connect(this.master);
    // the recordings carry their own room; just a breath of the canyon on top
    const musicVerb = ctx.createGain(); musicVerb.gain.value = 0.12; this.musicBus.connect(musicVerb).connect(this.reverb);

    // noise buffers
    this.white = this.makeNoise('white', 4);
    this.pink = this.makeNoise('pink', 4);
    this.brown = this.makeNoise('brown', 4);
    this.setupAmbience();
    this.setupMusic();
    this.loadSamples();
    this.ready = true;
    this.sfx.gain.value = this.ambBus.gain.value = this.volume;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, ctx.currentTime, 1.5);
  }

  setVolume(v) {
    this.volume = v;
    if (this.ready) for (const b of [this.sfx, this.ambBus]) b.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }
  setMusicVolume(v) { this.musicVolume = v; }
  setMuted(m) { this.muted = m; if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.15); }
  setMusic(on) { this.musicOn = on; }

  makeNoise(kind, secs) {
    const n = Math.floor(this.sr * secs);
    const buf = this.ctx.createBuffer(2, n, this.sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
    }
    return buf;
  }

  makeIR(secs, decay, echoes = []) {
    const n = Math.floor(this.sr * secs);
    const buf = this.ctx.createBuffer(2, n, this.sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / this.sr;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / secs, decay) * 0.5 * Math.min(1, t * 60);
      }
      for (const [et, eg] of echoes) {
        const start = Math.floor((et + (ch ? 0.013 : 0)) * this.sr);
        for (let k = 0; k < this.sr * 0.18 && start + k < n; k++) d[start + k] += (Math.random() * 2 - 1) * eg * Math.exp(-k / (this.sr * 0.04));
      }
    }
    return buf;
  }

  // ---- recorded samples ----
  loadSamples() {
    this.samples = {};
    const base = `${import.meta.env.BASE_URL}audio/sfx/`;
    const files = {
      creek: ['creek-1', 'creek-2'], rocks: ['river-rocks-1', 'river-rocks-2'], large: ['large-rocks-1', 'large-rocks-2'],
      folioOpen: ['folio-open'], page: ['page-turn'],
    };
    for (const [key, names] of Object.entries(files)) {
      Promise.all(names.map((n) => fetch(base + n + '.mp3').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((b) => this.ctx.decodeAudioData(b))))
        .then((bufs) => { this.samples[key] = bufs.map((buffer) => ({ buffer, hits: this.onsets(buffer) })); })
        .catch((e) => console.warn(`[audio] couldn't load ${key}:`, e.message));
    }
  }
  // where the hits are in a recording of stones knocking together, so single knocks can be cut out of it
  onsets(buf) {
    const d = buf.getChannelData(0), hop = Math.floor(buf.sampleRate * 0.004), env = [];
    for (let i = 0; i + hop <= d.length; i += hop) { let m = 0; for (let j = i; j < i + hop; j++) m = Math.max(m, Math.abs(d[j])); env.push(m); }
    const peak = env.reduce((a, b) => Math.max(a, b), 0), hits = [];
    let last = -1e9, avg = 0;
    env.forEach((e, k) => {
      if (e > peak * 0.18 && e > avg * 3.5 && k - last > 15) { hits.push({ t: k * hop / buf.sampleRate, a: e / peak }); last = k; }
      avg = avg * 0.85 + e * 0.15;
    });
    return hits;
  }
  // play part of a sample: from `from` seconds for `dur` (to the end if omitted), faded out over `fade`
  sample(key, dest, t, { from = 0, dur, rate = 1, gain = 1, fade = 0.05, pick } = {}) {
    const set = this.samples && this.samples[key];
    if (!set) return null;
    const sm = pick ?? set[Math.floor(Math.random() * set.length)];
    const s = this.ctx.createBufferSource(); s.buffer = sm.buffer; s.playbackRate.value = rate;
    const len = Math.min(dur ?? 1e9, sm.buffer.duration - from) / rate;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, t + Math.max(0, len - fade)); g.gain.linearRampToValueAtTime(0.0001, t + len);
    s.connect(g).connect(dest); s.start(t, from, len * rate + 0.01);
    return sm;
  }
  // one knock (with whatever chatter follows it) cut from the stone recordings; bigger stones ring lower
  knock(dest, t, size, gain, dur = 0.3) {
    const key = size > 0.9 && this.samples.large ? 'large' : 'rocks';
    const set = this.samples[key];
    if (!set) return false;
    const sm = set[Math.floor(Math.random() * set.length)];
    if (!sm.hits.length) return false;
    const h = sm.hits[Math.floor(Math.random() * sm.hits.length)];
    const rate = clamp(Math.pow(key === 'large' ? 1 / size : 0.5 / Math.max(size, 0.15), 0.35), 0.7, 1.35) * rand(0.95, 1.05);
    this.sample(key, dest, t, { pick: sm, from: Math.max(0, h.t - 0.006), dur, rate, gain: gain / Math.max(0.4, h.a), fade: dur * 0.4 });
    return true;
  }

  // ---- routing helpers ----
  spatial(x, y, z, ref = 10, roll = 1.2) {
    const L = this.listener;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z;
    const d = Math.hypot(dx, dy, dz);
    const g = 1 / Math.pow(1 + d / ref, roll);
    const pan = clamp((dx * L.rx + dz * L.rz) / Math.max(d, 1) * 0.9, -0.95, 0.95);
    return { g, pan, d };
  }
  out(pan = 0, gain = 1, wet = 0.2, bus = this.sfx) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p).connect(bus);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w).connect(this.reverb); }
    return g;
  }
  noiseSrc(buf = this.white, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.loopStart = 0; s.start(this.ctx.currentTime, Math.random() * 3);
    return s;
  }
  env(param, t0, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    param.exponentialRampToValueAtTime(Math.max(end, 0.0001), t0 + a + d);
  }
  tone(dest, type, f0, f1, t0, dur, peak, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    const g = ctx.createGain();
    this.env(g.gain, t0, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + attack + dur + 0.05);
    return o;
  }
  burst(dest, t0, dur, peak, type = 'bandpass', freq = 1000, q = 1, freq1 = null, buf = this.white) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freq1) f.frequency.exponentialRampToValueAtTime(freq1, t0 + dur);
    const g = ctx.createGain(); this.env(g.gain, t0, Math.min(0.004, dur * 0.2), peak, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.05);
  }

  // a struck body: a handful of damped sine modes [freq, decay time constant (s), level], the way a stone,
  // a brass stud or a book board rings for a moment when hit
  modes(dest, t0, list) {
    const ctx = this.ctx;
    for (const [f, d, a] of list) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.0012); g.gain.setTargetAtTime(0, t0 + 0.0012, d);
      o.connect(g).connect(dest); o.start(t0); o.stop(t0 + d * 8 + 0.01);
    }
  }
  // one air bubble ringing as it forms (Minnaert resonance): a sine that rises in pitch as it dies away.
  // Damping follows the bubble's size (van den Doel); xi sets how far the pitch climbs.
  bub(dest, t0, f0, a, xi = 0.1) {
    const ctx = this.ctx;
    const dd = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5), T = 5 / dd;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t0); o.frequency.linearRampToValueAtTime(f0 * (1 + xi * dd * T), t0 + T);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.0015); g.gain.setTargetAtTime(0, t0 + 0.0015, 1 / dd);
    o.connect(g).connect(dest); o.start(t0); o.stop(t0 + T + 0.02);
  }
  // dry paper fluttering: band-limited noise whose level jitters every few milliseconds
  flutter(dest, t0, dur, peak, freq = 2600, q = 0.9, rate = 45) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.pink;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
    const n = Math.max(2, Math.round(dur * rate));
    for (let i = 1; i <= n; i++) {
      const k = i / n, shape = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.7;
      g.gain.linearRampToValueAtTime(peak * shape * rand(0.25, 1), t0 + k * dur);
    }
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.03);
    s.connect(hp).connect(f).connect(g).connect(dest); s.start(t0, Math.random() * 3); s.stop(t0 + dur + 0.08);
  }
  // old leather flexing: stick-slip, a train of tiny ticks through a woody resonance, slowing then catching
  creak(dest, t0, dur, peak, f = 560) {
    let tt = t0;
    while (tt < t0 + dur) {
      const k = (tt - t0) / dur;
      const a = peak * Math.sin(Math.PI * k) * rand(0.5, 1);
      this.modes(dest, tt, [[f * rand(0.93, 1.07), 0.004, a], [f * 2.7 * rand(0.95, 1.05), 0.0025, a * 0.5]]);
      tt += (0.012 + 0.03 * Math.sin(Math.PI * k) ** 2) * rand(0.6, 1.4);
    }
  }

  // ---- one-shot sounds ----
  play(name, o = {}) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const sp = o.x !== undefined ? this.spatial(o.x, o.y ?? 0, o.z, o.ref ?? 10) : { g: 1, pan: 0, d: 0 };
    const gain = (o.gain ?? 1) * sp.g;
    if (gain < 0.004) return;
    const wet = o.wet ?? clamp(0.12 + sp.d / 120, 0.1, 0.6);
    const out = this.out(sp.pan, gain, wet);
    const size = o.size ?? 1;
    switch (name) {
      case 'splash': {
        // a body breaking the surface: a hollow whump, spray, then the bubbles it dragged down
        this.tone(out, 'sine', 170 / Math.sqrt(size), 70, t, 0.12 + 0.08 * size, 0.45 * size, 0.004);
        this.burst(out, t, 0.18 + size * 0.22, 0.32 * size, 'bandpass', 1500, 0.6, 600, this.pink);
        this.burst(out, t + 0.01, 0.1 + size * 0.1, 0.16, 'highpass', 3800, 0.7);
        this.bub(out, t + 0.02, rand(380, 520) / Math.sqrt(size), 0.28 * size, 0.35);
        const nb = Math.round(5 + size * 9);
        for (let i = 0; i < nb; i++) this.bub(out, t + rand(0.04, 0.2 + 0.45 * size), rand(500, 2400), rand(0.03, 0.11), rand(0.08, 0.2));
        break;
      }
      case 'plop': {
        // the classic plop: one bubble pinched off as the cavity closes, its pitch swooping up
        this.bub(out, t + 0.008, rand(480, 760), 0.32, rand(0.45, 0.7));
        this.burst(out, t, 0.03, 0.08, 'bandpass', 2600, 1, null, this.pink);
        for (let i = 0; i < 3; i++) this.bub(out, t + rand(0.05, 0.25), rand(900, 2200), rand(0.03, 0.07), 0.12);
        break;
      }
      case 'sip': this.bub(out, t, rand(900, 1300), 0.12, 0.5); this.bub(out, t + 0.03, rand(1600, 2200), 0.05, 0.2); break;
      case 'skip': {
        this.burst(out, t, 0.012, 0.3, 'highpass', 3000, 0.7);
        this.bub(out, t + 0.005, rand(1100, 1500), 0.12, 0.4);
        this.burst(out, t, 0.08, 0.08, 'bandpass', 2200, 0.8, 900, this.pink);
        break;
      }
      case 'throw': this.burst(out, t, 0.25, 0.12, 'bandpass', 600, 1.2, 2200); break;
      case 'clack': {
        if (this.knock(out, t, size, 0.6)) break;
        // stone on stone: a hard contact click, then a few stiff, quickly damped modes; bigger stones ring
        // lower. Stones rarely meet just once, so it chatters a little as it settles.
        const k = 1 / Math.sqrt(clamp(size, 0.25, 4));
        const hit = (tt, s) => {
          const f0 = rand(1500, 2300) * k;
          this.burst(out, tt, 0.005, 0.55 * s, 'highpass', 3200, 0.7);
          this.modes(out, tt, [[f0, 0.011, 0.3 * s], [f0 * rand(1.45, 1.62), 0.008, 0.2 * s], [f0 * rand(2.2, 2.55), 0.006, 0.13 * s],
            [f0 * rand(3.1, 3.6), 0.004, 0.08 * s], [rand(420, 600) * k, 0.016, 0.22 * s]]);
        };
        hit(t, 1);
        let tt = t, s = 1;
        const n = Math.random() < 0.8 ? Math.floor(rand(1, 4)) : 0;
        for (let i = 0; i < n; i++) { tt += rand(0.035, 0.08) * (1 + i * 0.3); s *= rand(0.3, 0.55); hit(tt, s); }
        for (let i = 0; i < 4; i++) this.burst(out, t + rand(0.01, 0.12), 0.004, rand(0.02, 0.05), 'bandpass', rand(3000, 6000), 2); // grit
        break;
      }
      case 'thud': {
        // knocking on something too heavy to ring: low, dead modes and a gritty tail
        const k = 1 / Math.sqrt(clamp(size, 0.25, 4));
        this.modes(out, t, [[rand(110, 150) * k, 0.045, 0.5], [rand(260, 330) * k, 0.025, 0.25], [rand(800, 1000) * k, 0.008, 0.14]]);
        this.burst(out, t, 0.07, 0.3, 'lowpass', 600, 0.8, null, this.pink);
        for (let i = 0; i < 6; i++) this.burst(out, t + rand(0.01, 0.2), 0.005, rand(0.02, 0.06), 'bandpass', rand(2500, 5500), 2);
        break;
      }
      case 'scrape': {
        // grit grinding as a stone is levered over, ending in a knock as it rolls onto its side
        const d = 0.25 + size * 0.2, k = 1 / Math.sqrt(clamp(size, 0.25, 4));
        if (this.samples.rocks) {
          // the rattle of the stones it was bedded among, under a low grind
          this.burst(out, t, d, 0.07, 'bandpass', 700, 1.2, 1600, this.pink);
          for (let i = 0; i < 10; i++) this.burst(out, t + Math.random() * d, rand(0.003, 0.009), rand(0.02, 0.06), 'bandpass', rand(1500, 5200), rand(2, 4));
          this.knock(out, t + d * 0.6, size, 0.45, 0.55);
          break;
        }
        for (let i = 0; i < 26; i++) this.burst(out, t + Math.random() * d, rand(0.003, 0.009), rand(0.03, 0.1), 'bandpass', rand(1500, 5200), rand(2, 4));
        this.burst(out, t, d, 0.07, 'bandpass', 700, 1.2, 1600, this.pink);
        this.modes(out, t + d, [[rand(300, 420) * k, 0.03, 0.25], [rand(900, 1200) * k, 0.01, 0.15]]);
        this.burst(out, t + d, 0.006, 0.2, 'highpass', 2500, 0.7);
        break;
      }
      case 'plunk': {
        // a stone into deep water: the big cavity's low bloop climbing as it collapses, then a boil of bubbles
        this.bub(out, t + 0.01, rand(200, 280) / Math.sqrt(size), 0.5, 0.5);
        this.burst(out, t, 0.1, 0.22, 'bandpass', 1100, 0.8, 400, this.pink);
        for (let i = 0; i < 9; i++) this.bub(out, t + rand(0.06, 0.6), rand(400, 1600), rand(0.04, 0.12), rand(0.1, 0.25));
        break;
      }
      case 'rustle': {
        const ctx2 = ctx; const s = ctx2.createBufferSource(); s.buffer = this.white;
        const f = ctx2.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.5;
        const hp = ctx2.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
        const g = ctx2.createGain(); g.gain.setValueAtTime(0.0001, t);
        const dur = 1.2 * size + 0.4;
        for (let i = 0; i < 24; i++) { const tt = t + (i / 24) * dur; g.gain.linearRampToValueAtTime(rand(0.05, 0.4) * (1 - i / 24) * size, tt); }
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
        s.connect(hp).connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.2);
        break;
      }
      case 'chime': {
        const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
        const base = Math.floor(rand(0, 4));
        [0, 2, 4].forEach((k, i) => { const f = scale[(base + k) % scale.length]; const tt = t + i * 0.07; this.tone(out, 'sine', f, f, tt, 1.6, 0.12, 0.004); this.tone(out, 'sine', f * 2, f * 2, tt, 0.6, 0.03, 0.004); });
        break;
      }
      case 'pop': this.tone(out, 'sine', 500, 900, t, 0.06, 0.15); break;
      case 'hopper': for (let i = 0; i < 10; i++) this.burst(out, t + i * 0.035, 0.012, 0.2, 'bandpass', 6500, 4); break;
      case 'frogeep': this.tone(out, 'sine', 1400, 2600, t, 0.07, 0.15); break;
      case 'chorusfrog': {
        const n = 14; const f0 = rand(1900, 2300);
        for (let i = 0; i < n; i++) this.burst(out, t + i * 0.035, 0.02, 0.25, 'bandpass', f0 + i * 60, 6);
        break;
      }
      case 'raven': {
        const n = Math.random() < 0.5 ? 2 : 3;
        for (let i = 0; i < n; i++) {
          const tt = t + i * rand(0.38, 0.5);
          const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
          const f0 = rand(280, 340); o1.frequency.setValueAtTime(f0, tt); o1.frequency.linearRampToValueAtTime(f0 * 0.82, tt + 0.3);
          const ws = ctx.createWaveShaper(); ws.curve = this.distCurve(30);
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 2;
          const bp2 = ctx.createBiquadFilter(); bp2.type = 'peaking'; bp2.frequency.value = 700; bp2.gain.value = 8;
          const g = ctx.createGain(); this.env(g.gain, tt, 0.03, 0.35, 0.28);
          o1.connect(ws).connect(bp).connect(bp2).connect(g).connect(out); o1.start(tt); o1.stop(tt + 0.4);
        }
        this.heard('raven');
        break;
      }
      case 'heron': {
        const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
        o1.frequency.setValueAtTime(190, t); o1.frequency.linearRampToValueAtTime(130, t + 0.55);
        const ws = ctx.createWaveShaper(); ws.curve = this.distCurve(60);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 1.5;
        const g = ctx.createGain(); this.env(g.gain, t, 0.04, 0.4, 0.55);
        o1.connect(ws).connect(bp).connect(g).connect(out); o1.start(t); o1.stop(t + 0.7);
        this.burst(out, t, 0.6, 0.15, 'bandpass', 500, 0.8); // wing whoosh
        break;
      }
      case 'whistle': {
        // player's bird call: two-note whistle
        this.tone(out, 'sine', 1900, 2050, t, 0.32, 0.18, 0.04);
        this.tone(out, 'sine', 1500, 1450, t + 0.42, 0.4, 0.16, 0.04);
        break;
      }
      case 'thunder': {
        const s = ctx.createBufferSource(); s.buffer = this.brown;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(70, t + 5);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1.0, t + 0.08 + Math.random() * 0.3);
        for (let i = 0; i < 6; i++) g.gain.exponentialRampToValueAtTime(rand(0.2, 0.9), t + 0.5 + i * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
        s.connect(lp).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + 6.2);
        break;
      }
      case 'tick': this.burst(out, t, 0.02, 0.15, 'bandpass', 2400, 3); break;
      case 'stoke': {
        // fresh air into the fire: a soft whoosh, then a flurry of crackles
        this.burst(out, t, 0.75, 0.32, 'lowpass', 260, 0.7, 1300, this.pink);
        for (let i = 0; i < 16; i++) this.burst(out, t + rand(0.05, 1.1), rand(0.004, 0.014), rand(0.08, 0.35), 'bandpass', rand(1500, 5200), rand(1.5, 4));
        break;
      }
      case 'page': {
        if (this.sample('page', out, t, { rate: rand(0.94, 1.06), gain: 0.55 })) break;
        // a dry paper leaf turning: lifted with a crinkle, fanning air as it swings, set down with a soft pat
        this.flutter(out, t, 0.42, 0.11, 2400, 0.8, 55);
        this.burst(out, t + 0.04, 0.3, 0.06, 'bandpass', 900, 0.7, 2600, this.pink);
        this.burst(out, t + 0.4, 0.05, 0.07, 'lowpass', 1600, 0.7, null, this.pink);
        break;
      }
      // the field guide's stages (timed to the CSS in style.css / Folio.setOpen)
      case 'bookShut': this.sample('folioOpen', out, t, { from: 0.62, rate: 0.92, gain: 0.65, fade: 0.3 }); break;
      case 'bookOpen': {
        if (this.sample('folioOpen', out, t, { gain: 0.7, fade: 0.3 })) break;
        // the cover lifts against a stiff old spine (a slow creak), swings over with the leaves fluttering in
        // its draught, and comes to rest flat on the far side with a soft whump of air
        this.creak(out, t, 0.36, 0.09, 520);
        this.burst(out, t + 0.04, 0.4, 0.035, 'bandpass', 420, 2, 650, this.pink);
        this.flutter(out, t + 0.24, 0.48, 0.1, 2800, 0.8, 60);
        this.burst(out, t + 0.3, 0.42, 0.07, 'bandpass', 700, 0.7, 1800, this.pink);
        this.modes(out, t + 0.78, [[rand(85, 100), 0.035, 0.3], [rand(190, 220), 0.018, 0.12]]);
        this.burst(out, t + 0.77, 0.14, 0.16, 'lowpass', 700, 0.7, 200, this.pink);
        this.flutter(out, t + 0.8, 0.16, 0.05, 3200, 1, 70);
        break;
      }
      case 'zip': for (let i = 0; i < 16; i++) this.burst(out, t + i * 0.021, 0.012, 0.16, 'bandpass', 2400 + i * 110, 6); break;
      default: break;
    }
  }

  heard(id) { if (this.onHeard) this.onHeard(id); }

  distCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return c;
  }

  // ---- songs (scheduled by update) ----
  canyonWren(x, y, z) {
    const sp = this.spatial(x, y, z, 30, 0.8);
    const out = this.out(sp.pan, 0.9 * sp.g, 0.7);
    const t0 = this.ctx.currentTime + 0.05;
    let tt = t0, f = rand(3600, 4000);
    const n = Math.floor(rand(11, 15));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const dur = 0.06 + k * 0.05;
      this.tone(out, 'sine', f, f * 0.93, tt, dur, 0.12 * (1 - k * 0.3), 0.01);
      tt += 0.11 - Math.sin(k * Math.PI) * 0.03 + k * 0.04;
      f *= 0.935;
    }
    // closing buzzy notes
    for (let i = 0; i < 2; i++) { this.tone(out, 'triangle', f * 1.1, f * 0.8, tt, 0.12, 0.07, 0.01); tt += 0.18; }
    this.heard('canyonwren');
  }
  chickadee(x, y, z) {
    const sp = this.spatial(x, y, z, 25, 0.9);
    const out = this.out(sp.pan, 0.7 * sp.g, 0.35);
    const t = this.ctx.currentTime + 0.05;
    this.tone(out, 'sine', 3300, 3250, t, 0.28, 0.12, 0.02);
    this.tone(out, 'sine', 2750, 2700, t + 0.36, 0.17, 0.1, 0.02);
    this.tone(out, 'sine', 2750, 2700, t + 0.6, 0.17, 0.1, 0.02);
    this.heard('chickadee');
  }
  woodpecker(x, y, z) {
    const sp = this.spatial(x, y, z, 25, 0.9);
    const out = this.out(sp.pan, 0.8 * sp.g, 0.45);
    const t = this.ctx.currentTime + 0.05;
    const n = Math.floor(rand(14, 22));
    let tt = t;
    for (let i = 0; i < n; i++) { this.burst(out, tt, 0.02, 0.35 * (1 - i / n * 0.5), 'bandpass', 1300, 5); tt += 0.05 + i * 0.0025; }
    this.heard('woodpecker');
  }
  owl(x, y, z) {
    const sp = this.spatial(x, y, z, 40, 0.7);
    const out = this.out(sp.pan, 0.9 * sp.g, 0.6);
    const t = this.ctx.currentTime + 0.05;
    const pattern = [[0, 0.35], [0.55, 0.16], [0.75, 0.22], [1.25, 0.4], [1.85, 0.4]];
    for (const [o, d] of pattern) this.tone(out, 'sine', 330, 300, t + o, d, 0.22, 0.06);
    this.heard('owl');
  }
  coyotes(x, y, z) {
    const sp = this.spatial(x, y, z, 60, 0.6);
    const out = this.out(sp.pan, 0.55 * sp.g, 0.85);
    const t0 = this.ctx.currentTime + 0.05;
    for (let v = 0; v < 3; v++) {
      let t = t0 + v * rand(0.3, 1.2);
      for (let i = 0; i < 4; i++) {
        const o = this.ctx.createOscillator(); o.type = 'triangle';
        const f0 = rand(500, 750);
        o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * rand(1.5, 2.0), t + 0.25); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.6);
        const vib = this.ctx.createOscillator(); vib.frequency.value = rand(5, 8); const vg = this.ctx.createGain(); vg.gain.value = 25;
        vib.connect(vg).connect(o.frequency);
        const g = this.ctx.createGain(); this.env(g.gain, t, 0.05, 0.08, 0.55);
        o.connect(g).connect(out); o.start(t); vib.start(t); o.stop(t + 0.7); vib.stop(t + 0.7);
        t += rand(0.5, 0.9);
      }
    }
    this.heard('coyote');
  }
  cricket(pan, gain, rate) {
    const out = this.out(pan, gain, 0.2, this.ambBus);
    const t = this.ctx.currentTime + 0.02;
    const f = rand(4100, 4500);
    for (let i = 0; i < 3; i++) this.tone(out, 'sine', f, f, t + i * 0.045 * rate, 0.025, 0.05, 0.003);
  }
  bubble(pan, gain) {
    const out = this.out(pan, gain, 0.1, this.ambBus);
    const t = this.ctx.currentTime + 0.01;
    const f = rand(350, 1300);
    this.tone(out, 'sine', f, f * rand(1.4, 2.6), t, rand(0.02, 0.07), rand(0.15, 0.4), 0.002);
  }

  // ---- campfire: a low roar with crackles and the odd pop, only while a camp is pitched (this.fire set by Camp) ----
  updateFire(dt, f) {
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this.fireAmb) {
      if (!f) return;
      const s = this.noiseSrc(this.brown, 1);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      s.connect(lp).connect(g).connect(p).connect(this.ambBus);
      this.fireAmb = { g, p }; this.crackleAcc = 0;
    }
    const a = this.fireAmb;
    if (!f) { a.g.gain.setTargetAtTime(0, now, 0.3); return; }
    const sp = this.spatial(f.x, f.y, f.z, 3, 1.3);
    a.g.gain.setTargetAtTime(0.16 * sp.g * f.k, now, 0.2); a.p.pan.setTargetAtTime(sp.pan, now, 0.2);
    if (sp.g * f.k < 0.01) return;
    this.crackleAcc += dt * (5 + 8 * f.k);
    while (this.crackleAcc > 1) {
      this.crackleAcc -= 1;
      const t = now + rand(0.01, 0.06);
      const out = this.out(clamp(sp.pan + rand(-0.15, 0.15), -1, 1), sp.g * Math.min(f.k, 1.4), 0.12);
      if (Math.random() < 0.1) { this.burst(out, t, rand(0.01, 0.025), rand(0.3, 0.55), 'bandpass', rand(700, 1400), 1.5); this.burst(out, t + 0.004, 0.006, 0.25, 'highpass', 4000, 0.7); }
      else this.burst(out, t, rand(0.003, 0.012), rand(0.05, 0.25), 'bandpass', rand(1800, 5200), rand(1.5, 4));
    }
  }

  // ---- ambience ----
  setupAmbience() {
    const ctx = this.ctx;
    const mk = (buf, type, freq, q, pan = 0, rate = 1) => {
      const s = this.noiseSrc(buf, rate);
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      s.connect(f).connect(g).connect(p).connect(this.ambBus);
      return { s, f, g, p };
    };
    this.amb = {
      rumble: mk(this.brown, 'lowpass', 380, 0.5),
      babble: mk(this.pink, 'bandpass', 900, 0.6),
      sparkle: mk(this.pink, 'bandpass', 2400, 1.0),
      fall: mk(this.pink, 'lowpass', 2400, 0.4),
      fallHi: mk(this.white, 'bandpass', 5000, 0.5),
      wind: mk(this.pink, 'bandpass', 500, 0.8),
      leaves: mk(this.white, 'highpass', 3800, 0.5),
      rain: mk(this.white, 'bandpass', 3000, 0.4),
      rainLow: mk(this.pink, 'lowpass', 800, 0.5),
    };
    // babble modulator
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.37; const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(this.amb.babble.f.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = ctx.createGain(); lg2.gain.value = 200;
    lfo2.connect(lg2).connect(this.amb.wind.f.frequency); lfo2.start();
    // running water, rendered once into loops of different lengths so their repeats never line up:
    // the brook's gurgle, the glassy chatter over the riffles, and the deep boil under the falls
    let delay = 50;
    const loop = (o) => {
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      g.connect(p).connect(this.ambBus);
      const n = { g, p, w: 1, wT: 1 };
      // rendering takes a moment, so each loop fades in when it's ready rather than holding up the start
      setTimeout(() => {
        const s = ctx.createBufferSource(); s.buffer = this.renderBubbles(o); s.loop = true;
        s.playbackRate.value = rand(0.97, 1.03); s.connect(g); s.start();
      }, delay);
      delay += 350; // one at a time, so no single frame takes the whole hit
      return n;
    };
    this.amb.brook = loop({ secs: 10.3, rate: 20, fLo: 260, fHi: 1700, cluster: 6, xi: 0.12 });
    this.amb.riffle = loop({ secs: 7.1, rate: 30, fLo: 850, fHi: 3400, cluster: 3, xi: 0.08 });
    this.amb.plunge = loop({ secs: 8.7, rate: 28, fLo: 130, fHi: 800, cluster: 5, xi: 0.15 });
    // the recorded creek, under all of it: the two takes crossfaded end to end, each a touch off-pitch
    {
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      g.connect(p).connect(this.ambBus);
      this.amb.bed = { g, p, w: 1, wT: 1, next: 0, take: 0 };
    }
    this.cricketAcc = 0; this.dripAcc = 0;
    this.next = { wren: rand(6, 20), chick: rand(4, 15), wood: rand(20, 50), owl: rand(10, 40), coyote: rand(40, 120), thunder: rand(15, 40) };
    this.crickets = Array.from({ length: 5 }, () => ({ pan: rand(-0.9, 0.9), gain: rand(0.25, 0.7), period: rand(0.45, 0.7), acc: Math.random() }));
  }

  // keep the creek recording going: start the next take a crossfade before the current one ends
  updateBed() {
    const b = this.amb.bed, set = this.samples && this.samples.creek;
    if (!set) return;
    const ctx = this.ctx, X = 2.5;
    if (b.next === 0) b.next = ctx.currentTime + 0.1;
    if (ctx.currentTime < b.next - 1) return;
    const sm = set[b.take++ % set.length], rate = rand(0.95, 1.04);
    const from = 0.15, len = (sm.buffer.duration - 0.3) / rate, t = b.next;
    const s = ctx.createBufferSource(); s.buffer = sm.buffer; s.playbackRate.value = rate;
    const g = ctx.createGain();
    // equal-power ramps, so the swap doesn't dip
    const N = 32, up = new Float32Array(N), dn = new Float32Array(N);
    for (let i = 0; i < N; i++) { up[i] = Math.sin(i / (N - 1) * Math.PI / 2); dn[i] = Math.cos(i / (N - 1) * Math.PI / 2); }
    g.gain.setValueAtTime(0, t); g.gain.setValueCurveAtTime(up, t, X); g.gain.setValueCurveAtTime(dn, t + len - X, X);
    s.connect(g).connect(b.g); s.start(t, from, len * rate);
    b.next = t + len - X;
  }

  // bubbles summed offline into a seamless stereo loop (each channel its own bubbles, so it's wide).
  // They arrive in clusters, the way water gurgles in pockets, and bigger bubbles ring louder.
  renderBubbles({ secs, rate, fLo, fHi, cluster, xi }) {
    const sr = this.sr, n = Math.floor(sr * secs);
    const buf = this.ctx.createBuffer(2, n, sr);
    const lo = Math.log(fLo), hi = Math.log(fHi);
    let ss = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const nc = Math.round(rate * secs);
      for (let c = 0; c < nc; c++) {
        const tc = Math.floor(Math.random() * n), fc = Math.exp(lo + (hi - lo) * Math.random() ** 1.4);
        const m = 1 + Math.floor(Math.random() * cluster);
        for (let j = 0; j < m; j++) {
          const t0 = tc + Math.floor(Math.random() * 0.09 * sr);
          const f0 = fc * rand(0.8, 1.25);
          const dd = 0.043 * f0 + 0.0014 * Math.pow(f0, 1.5), sg = xi * dd * rand(0.6, 1.6);
          const a = rand(0.3, 1) * Math.sqrt(600 / f0);
          // rung until it has died to ~2%, decaying by a constant factor per sample
          const len = Math.floor(Math.min(3.9 / dd, 0.12) * sr), w = 2 * Math.PI * f0 / sr, dw = w * sg / sr;
          const att = Math.floor(sr * 0.0015), tail = Math.floor(len * 0.8), r = Math.exp(-dd / sr);
          let ph = 0, e = a;
          for (let i = 0; i < len; i++) {
            ph += w + dw * i;
            const fade = i < att ? i / att : i > tail ? (len - i) / (len - tail) : 1;
            d[(t0 + i) % n] += e * Math.sin(ph) * fade;
            e *= r;
          }
        }
      }
      for (let i = 0; i < n; i++) ss += d[i] * d[i];
    }
    // normalise to a known loudness so the mix levels below mean something
    const k = 0.1 / Math.sqrt(ss / (2 * n) || 1);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k; }
    return buf;
  }

  // ---- music: recorded Native American flute, a few pieces shuffled, with long quiet spells between ----
  // Streamed through an <audio> element (no decoding whole tracks up front) into the music bus.
  setupMusic() {
    const ctx = this.ctx;
    const base = `${import.meta.env.BASE_URL}audio/music/`;
    this.tracks = ['northern', 'taos-traditional-song', 'taos-traditional-song-2', 'taos-round-dance', 'humming-bird-song', 'the-eagles-bed']
      .map((n) => `${base}${n}.mp3`);
    this.bag = []; this.lastTrack = -1;
    const el = this.trackEl = new Audio();
    el.preload = 'auto';
    this.trackGain = ctx.createGain(); this.trackGain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(this.trackGain).connect(this.musicBus);
    el.addEventListener('ended', () => { this.trackOn = false; this.musicT = rand(25, 55); });
    el.addEventListener('error', () => { this.trackOn = false; this.musicT = rand(25, 55); });
    // this runs inside the click that started the sound, so priming the element here lets it play later
    // without one (mobile browsers otherwise refuse)
    el.src = this.nextTrack();
    el.play().then(() => { if (!this.trackOn) el.pause(); }).catch(() => {});
    this.trackOn = false;
    this.musicT = 8;
  }

  // shuffled without repeats until all have played, and never the same piece twice running
  nextTrack() {
    if (!this.bag.length) {
      this.bag = this.tracks.map((_, i) => i).sort(() => Math.random() - 0.5);
      if (this.bag[this.bag.length - 1] === this.lastTrack) this.bag.unshift(this.bag.pop());
    }
    this.lastTrack = this.bag.pop();
    return this.tracks[this.lastTrack];
  }

  updateMusic(dt) {
    const now = this.ctx.currentTime, el = this.trackEl;
    this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVolume * 1.8 : 0, now, this.musicOn ? 0.15 : 1.5);
    if (!this.musicOn) {
      // fade out, then pause where it was so it picks up from there
      this.offT = (this.offT ?? 0) + dt;
      if (this.trackOn && !el.paused && this.offT > 4) el.pause();
      return;
    }
    this.offT = 0;
    if (this.trackOn) {
      if (el.paused) el.play().catch(() => {});
      return;
    }
    this.musicT -= dt;
    if (this.musicT < 0) {
      if (!el.paused) el.pause();
      if (el.currentTime > 0.5 || el.ended) el.src = this.nextTrack();
      el.currentTime = 0;
      this.trackOn = true;
      this.trackGain.gain.cancelScheduledValues(now);
      this.trackGain.gain.setValueAtTime(0, now);
      this.trackGain.gain.linearRampToValueAtTime(1.4, now + 3);
      el.play().catch(() => { this.trackOn = false; this.musicT = 10; });
    }
  }

  update(dt, st) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const L = this.listener;
    L.x = st.camPos.x; L.y = st.camPos.y; L.z = st.camPos.z;
    L.rx = st.right.x; L.rz = st.right.z;
    // focus point drives "what you hear" more than camera height
    const fx = st.focus.x, fz = st.focus.z;
    const zoom = st.zoom; // camera distance
    const hearX = lerp(fx, L.x, 0.3), hearZ = lerp(fz, L.z, 0.3);
    const lat = Math.abs(lateral(hearX, hearZ));
    const hw = streamHalfW(hearZ);
    const dStream = Math.max(0, lat - hw * 0.6);
    const heightAbove = Math.max(0, L.y - waterLevel(hearZ));
    const distEff = Math.hypot(dStream, heightAbove * 0.5);
    const near = 1 / Math.pow(1 + distEff / 7, 1.4);
    const sx = streamCenter(hearZ);
    const panStream = clamp(((sx - L.x) * L.rx + (hearZ - L.z) * L.rz) / Math.max(1, Math.hypot(sx - L.x, hearZ - L.z)) * 0.6, -0.8, 0.8);
    const a = this.amb, k = 0.25;
    const set = (n, v, pan) => { n.g.gain.setTargetAtTime(v, now, k); if (pan !== undefined) n.p.pan.setTargetAtTime(pan, now, k); };
    const turb = st.turb ?? 0.3;
    // slow swells, so the creek breathes rather than drones
    for (const n of [a.brook, a.riffle, a.plunge, a.bed]) {
      if (Math.random() < dt * 0.4) n.wT = rand(0.65, 1.25);
      n.w += (n.wT - n.w) * Math.min(1, dt * 0.8);
    }
    set(a.rumble, 0.1 * near + 0.02, panStream * 0.5);
    const rec = this.samples && this.samples.creek ? 1 : 0;
    set(a.babble, 0.1 * near * (0.6 + turb) * (1 - rec * 0.45), panStream);
    set(a.sparkle, 0.018 * near * (0.5 + turb), panStream);
    set(a.brook, 0.36 * near * (0.7 + turb * 0.6) * a.brook.w * (1 - rec * 0.35), panStream);
    set(a.bed, 0.45 * near * (0.75 + turb * 0.5) * (0.8 + a.bed.w * 0.2), panStream * 0.7);
    this.updateBed();
    set(a.riffle, 0.3 * near * (0.25 + turb) * a.riffle.w, panStream * 0.8);
    // waterfall point source
    const wf = this.spatial(streamCenter(WF_Z + 0.8), waterLevel(WF_Z + 0.8), WF_Z + 0.8, 10, 1.3);
    set(a.fall, 0.2 * wf.g, wf.pan); set(a.fallHi, 0.04 * wf.g, wf.pan);
    set(a.plunge, 0.38 * wf.g * a.plunge.w, wf.pan);
    // wind
    const wind = st.wind;
    const alt = smoothstep(10, 120, zoom);
    set(a.wind, (0.06 + wind * 0.25) * (0.5 + alt * 0.8 + st.gust * 0.6), 0);
    const bio = bioAt(fx, fz);
    set(a.leaves, (0.015 + bio.forest * 0.06) * (0.3 + st.gust * 1.4) * wind * (st.season < 1.6 ? 1 : 0.2), 0);
    // rain
    set(a.rain, st.rain * 0.22, 0); set(a.rainLow, st.rain * 0.3, 0);

    // rain drips on water
    if (st.rain > 0.1) { this.dripAcc += dt * st.rain * 25; while (this.dripAcc > 1) { this.dripAcc -= 1; this.bubble(rand(-0.9, 0.9), 0.05 * st.rain); } }
    this.updateFire(dt, this.fire);

    const day = 1 - st.night;
    const winter = st.season > 1.6;
    // crickets at night (not in winter)
    if (st.night > 0.3 && !winter && st.rain < 0.5) {
      for (const c of this.crickets) {
        c.acc += dt / c.period;
        if (c.acc > 1) { c.acc -= 1; this.cricket(c.pan, c.gain * 0.25 * st.night, 1); }
      }
    }
    // birds & night calls
    const nx = this.next;
    for (const key in nx) nx[key] -= dt;
    const L2 = st.focus;
    if (nx.wren < 0) { nx.wren = rand(25, 70); if (day > 0.6 && st.rain < 0.4) this.canyonWren(L2.x + rand(40, 70), L2.y + rand(15, 35), L2.z + rand(-40, 40)); }
    if (nx.chick < 0) { nx.chick = rand(15, 45); if (day > 0.6 && st.rain < 0.4) this.chickadee(L2.x - rand(15, 40), L2.y + 6, L2.z + rand(-30, 30)); }
    if (nx.wood < 0) { nx.wood = rand(40, 100); if (day > 0.6) this.woodpecker(L2.x - rand(20, 50), L2.y + 8, L2.z + rand(-40, 40)); }
    if (nx.owl < 0) { nx.owl = rand(30, 80); if (st.night > 0.6) this.owl(L2.x - rand(30, 60), L2.y + 15, L2.z + rand(-50, 50)); }
    if (nx.coyote < 0) { nx.coyote = rand(90, 220); if (st.night > 0.7) this.coyotes(L2.x + rand(60, 140), L2.y + 30, L2.z + rand(-100, 100)); }
    if (nx.thunder < 0) { nx.thunder = rand(18, 45); if (st.rain > 0.6) { this.play('thunder', { gain: 0.8, wet: 0.5 }); if (st.onThunder) st.onThunder(); } }

    this.updateMusic(dt);
  }
}
