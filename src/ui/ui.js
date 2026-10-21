// DOM overlay: intro, HUD, controls dock, tooltip, discovery toasts, field guide.
import { GUIDE } from './guide.js';
import { Folio, SKETCH_DEFS, sketchSVG } from './folio.js';

const ICONS = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 18.5z"/></svg>',
  rain: '<svg viewBox="0 0 24 24"><path d="M7 14.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.2A3.4 3.4 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/></svg>',
  leafS: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l8-8"/></svg>',
  leafA: '<svg viewBox="0 0 24 24"><path d="M12 3l2 4 4-1-1 4 3 2-4 2 1 4-4-1-1 4-1-4-4 1 1-4-4-2 3-2-1-4 4 1z"/></svg>',
  snow: '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" class="fill"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13M16 5.5v13"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  music: '<svg viewBox="0 0 24 24"><path d="M9 17.5V6l10-2v11.5"/><circle cx="6.8" cy="17.5" r="2.3"/><circle cx="16.8" cy="15.5" r="2.3"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6.5v13"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  tent: '<svg viewBox="0 0 24 24"><path d="M2.5 19.5L12 5l9.5 14.5z"/><path d="M12 5v2M9.2 19.5L12 14.5l2.8 5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M6.5 9.5l5.5 5.5 5.5-5.5"/></svg>',
  wind: '<svg viewBox="0 0 24 24"><path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8"/></svg>',
};

export class UI {
  constructor(root, cb) {
    this.root = root; this.cb = cb;
    this.found = new Set(JSON.parse(this.load('riffle.found') || '[]'));
    this.hidden = false;
    root.innerHTML = `
      <div id="intro" class="intro">
        <div class="intro-inner">
          <div class="eyebrow">a nature toy</div>
          <h1>Riffle</h1>
          <p class="sub">A canyon creek where Colorado aspen meets Utah sandstone.</p>
          <div class="loader"><div class="bar"></div></div>
          <div class="status">Shaping the canyon…</div>
          <button class="enter" disabled>Enter the canyon</button>
          <div class="keys-intro">
            <span><b>WASD</b> wander</span><span><b>Scroll</b> zoom</span><span><b>Right-drag</b> look around</span><span><b>Click</b> anything</span>
          </div>
          <div class="hp">Best with headphones</div>
        </div>
      </div>
      <div id="hud" class="hud hidden">
        <div class="brand"><span class="name">Riffle</span><span class="clock">5:00 pm</span><span class="dot">·</span><span class="season">Autumn</span></div>
        <button class="guide-btn glass" title="Field Guide (J)">${ICONS.book}<span>Field Guide</span><span class="count">0/0</span></button>
        <div class="dock glass">
          <div class="dock-head">
            <button class="ib play" title="Pause time (P)">${ICONS.pause}</button>
            <div class="tod-label">Golden hour</div>
            <button class="ib collapse" title="Collapse panel">${ICONS.chevron}</button>
          </div>
          <div class="dock-body"><div class="dock-inner">
            <input type="range" class="time" min="0" max="24" step="0.01" value="17" title="Time of day">
            <div class="row">
              <div class="seg weather">
                <button data-w="clear" class="on" title="Clear">${ICONS.sun}</button>
                <button data-w="cloudy" title="Cloudy">${ICONS.cloud}</button>
                <button data-w="rain" title="Rain">${ICONS.rain}</button>
              </div>
              <div class="seg season">
                <button data-s="0" title="Summer">${ICONS.leafS}</button>
                <button data-s="1" class="on" title="Autumn">${ICONS.leafA}</button>
                <button data-s="2" title="Winter">${ICONS.snow}</button>
              </div>
            </div>
            <div class="row slider-row">
              <span class="lbl" title="Wind">${ICONS.wind}</span><span class="name">Wind</span>
              <input type="range" class="wind" min="0" max="1.6" step="0.01" value="0.6">
            </div>
            <div class="sep"></div>
            <div class="row slider-row">
              <button class="ib mute" title="Mute everything (M)">${ICONS.sound}</button><span class="name">Sound</span>
              <input type="range" class="vol" min="0" max="1" step="0.01" value="0.9"><span class="val vol-val">90</span>
            </div>
            <div class="row slider-row">
              <button class="ib music on" title="Music on / off (N)">${ICONS.music}</button><span class="name">Music</span>
              <input type="range" class="mvol" min="0" max="1" step="0.01" value="0.3"><span class="val mvol-val">30</span>
            </div>
            <div class="sep"></div>
            <div class="row foot">
              <div class="seg quality" title="Graphics quality">
                <button data-q="0">Low</button><button data-q="1" class="on">High</button><button data-q="2">Ultra</button>
              </div>
              <button class="ib camp" title="Pitch a camp (C)">${ICONS.tent}</button>
              <button class="ib photo" title="Hide interface (H)">${ICONS.camera}</button>
            </div>
            <div class="fps"></div>
          </div></div>
        </div>
        <div class="hints">
          <div class="hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> wander</div>
          <div class="hint"><kbd>Scroll</kbd> zoom · <kbd>Right-drag</kbd> / <kbd>Q</kbd><kbd>E</kbd> orbit</div>
          <div class="hint"><kbd>Click</kbd> creatures, trees, flowers, rocks, water</div>
          <div class="hint"><kbd>Drag</kbd> through water to trail your hand</div>
          <div class="hint"><kbd>Drag</kbd> a small stone to carry, stack or throw it · <kbd>Click</kbd> one to turn it over</div>
          <div class="hint"><kbd>F</kbd> skip a stone · <kbd>G</kbd> plant a flower · <kbd>B</kbd> float a leaf</div>
          <div class="hint"><kbd>C</kbd> pitch a camp · <kbd>R</kbd> rotate it · <kbd>X</kbd> pack it up</div>
          <div class="hint"><kbd>Space</kbd> whistle · <kbd>H</kbd> hide UI · <kbd>?</kbd> hints</div>
        </div>
      </div>
      <div id="tooltip" class="tooltip"></div>
      <div id="toasts"></div>
      <div id="discoveries"></div>
      ${SKETCH_DEFS}
      <div id="guide" class="guide"></div>
      <div id="flash"></div>
    `;
    this.$ = (s) => root.querySelector(s);
    this.intro = this.$('#intro');
    this.hud = this.$('#hud');
    this.tooltip = this.$('#tooltip');
    this.toasts = this.$('#toasts');
    this.disc = this.$('#discoveries');
    this.discQueue = []; this.discBusy = false;
    this.guide = this.$('#guide');
    this.folio = new Folio(this, this.guide);
    this.bindControls();
    this.renderGuide();
  }

  load(k) { try { return localStorage.getItem(k); } catch { return null; } }
  save(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

  setProgress(p, text) {
    this.$('.loader .bar').style.width = `${Math.round(p * 100)}%`;
    if (text) this.$('.status').textContent = text;
  }
  ready(onEnter) {
    const b = this.$('.enter');
    b.disabled = false; b.classList.add('ready');
    this.$('.status').textContent = 'Ready';
    this.$('.loader').classList.add('done');
    const go = () => {
      this.intro.classList.add('gone');
      this.hud.classList.remove('hidden');
      setTimeout(() => this.$('.hints').classList.add('faded'), 30000);
      onEnter();
    };
    b.addEventListener('click', go, { once: true });
  }

  bindControls() {
    const cb = this.cb;
    const time = this.$('.time');
    time.addEventListener('input', () => cb.setTime(parseFloat(time.value)));
    this.$('.play').addEventListener('click', () => cb.togglePause());
    this.root.querySelectorAll('.weather button').forEach((b) => b.addEventListener('click', () => { this.setSeg('.weather', b); cb.setWeather(b.dataset.w); }));
    this.root.querySelectorAll('.season button').forEach((b) => b.addEventListener('click', () => { this.setSeg('.season', b); cb.setSeason(parseFloat(b.dataset.s)); }));
    this.root.querySelectorAll('.quality button').forEach((b) => b.addEventListener('click', () => { this.setSeg('.quality', b); cb.setQuality(parseInt(b.dataset.q, 10)); }));
    const wind = this.$('.wind'); wind.addEventListener('input', () => cb.setWind(parseFloat(wind.value)));
    // the two levels, remembered between visits
    const level = (sel, key, set) => {
      const el = this.$(sel), out = this.$(`${sel}-val`);
      const saved = parseFloat(this.load(key));
      if (saved >= 0 && saved <= 1) el.value = saved;
      const apply = () => { const v = parseFloat(el.value); out.textContent = Math.round(v * 100); set(v); };
      el.addEventListener('input', () => { apply(); this.save(key, el.value); });
      apply();
    };
    level('.vol', 'riffle.vol', (v) => cb.setVolume(v));
    level('.mvol', 'riffle.musicVol', (v) => cb.setMusicVolume(v));
    // the panel folds down to its header (remembered too)
    const dock = this.$('.dock');
    const fold = (on) => {
      dock.classList.toggle('collapsed', on);
      this.$('.collapse').title = on ? 'Show controls' : 'Collapse panel';
      this.save('riffle.dockFolded', on ? '1' : '0');
    };
    fold(this.load('riffle.dockFolded') === '1');
    this.$('.collapse').addEventListener('click', () => fold(!dock.classList.contains('collapsed')));
    this.$('.tod-label').addEventListener('click', () => fold(!dock.classList.contains('collapsed')));
    this.$('.mute').addEventListener('click', () => cb.toggleMute());
    this.$('.music').addEventListener('click', () => cb.toggleMusic());
    this.$('.photo').addEventListener('click', () => this.toggleHidden());
    this.$('.camp').addEventListener('click', () => cb.toggleCamp && cb.toggleCamp());
    this.$('.guide-btn').addEventListener('click', () => this.toggleGuide());
    // stop pointer events on UI from reaching the canvas
    for (const el of [this.hud.querySelector('.dock'), this.$('.guide-btn'), this.guide]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }
  }
  setSeg(sel, btn) { this.root.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b === btn)); }
  selectSeg(sel, attr, val) { this.root.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b.dataset[attr] === String(val))); }

  setPaused(p) { this.$('.play').innerHTML = p ? ICONS.play : ICONS.pause; }
  setMuted(m) { this.$('.mute').innerHTML = m ? ICONS.mute : ICONS.sound; }
  setMusic(on) { this.$('.music').classList.toggle('on', on); }
  setCamp(on) { this.$('.camp').classList.toggle('on', on); }
  toggleHidden(force) {
    this.hidden = force ?? !this.hidden;
    this.hud.classList.toggle('photo', this.hidden);
    this.toasts.classList.toggle('photo', this.hidden);
    this.disc.classList.toggle('photo', this.hidden);
  }
  toggleHints() { this.$('.hints').classList.toggle('faded'); }

  setClock(hours, season) {
    const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
    const ap = h >= 12 ? 'pm' : 'am';
    const hh = ((h + 11) % 12) + 1;
    this.$('.clock').textContent = `${hh}:${String(m).padStart(2, '0')} ${ap}`;
    this.$('.season').textContent = season < 0.5 ? 'Summer' : season < 1.5 ? 'Autumn' : 'Winter';
    this.clockStr = `${hh}:${String(m).padStart(2, '0')} ${ap}, ${this.$('.season').textContent.toLowerCase()}`;
    const t = this.$('.time');
    if (document.activeElement !== t) t.value = hours;
    let label = 'Night';
    if (hours >= 5 && hours < 6.5) label = 'Dawn';
    else if (hours >= 6.5 && hours < 8.5) label = 'Morning light';
    else if (hours >= 8.5 && hours < 15.5) label = 'Day';
    else if (hours >= 15.5 && hours < 18.2) label = 'Golden hour';
    else if (hours >= 18.2 && hours < 19.5) label = 'Dusk';
    this.$('.tod-label').textContent = label;
  }
  setFps(f) { this.$('.fps').textContent = f ? `${f} fps` : ''; }

  showTooltip(text, x, y, hint) {
    if (!text) { this.tooltip.classList.remove('on'); return; }
    const key = text + (hint || '');
    if (this.tooltipKey !== key) {
      this.tooltipKey = key;
      this.tooltip.textContent = text;
      if (hint) { const h = document.createElement('span'); h.className = 'tt-hint'; h.textContent = hint; this.tooltip.appendChild(h); }
    }
    this.tooltip.style.transform = `translate(${x + 16}px, ${y + 14}px)`;
    this.tooltip.classList.add('on');
  }

  toast(html, cls = '', ms = 4200) {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.innerHTML = html;
    this.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => el.remove(), 600); }, ms);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  discover(id, how = 'seen') {
    if (!id || this.found.has(id)) return false;
    const e = GUIDE.find((g) => g.id === id);
    if (!e) return false;
    this.found.add(id);
    this.save('riffle.found', JSON.stringify([...this.found]));
    this.folio.record(id, how, this.clockStr);
    this.discQueue.push(`${sketchSVG(id, 'toast-sk')}<div class="t-k">${how === 'heard' ? 'Heard' : 'New'} · ${e.cat} <span class="t-c">${this.found.size}/${GUIDE.length}</span></div><div class="t-n">${e.name}</div><div class="t-l">${e.latin}</div><div class="t-f">${e.fact}</div>`);
    this.pumpDiscoveries();
    this.renderGuide();
    this.$('.guide-btn').classList.add('pulse');
    setTimeout(() => this.$('.guide-btn').classList.remove('pulse'), 1600);
    return true;
  }

  pumpDiscoveries() {
    if (this.discBusy || !this.discQueue.length) return;
    this.discBusy = true;
    const el = document.createElement('div');
    el.className = 'toast discover';
    el.innerHTML = this.discQueue.shift();
    this.disc.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    setTimeout(() => {
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(() => { el.remove(); this.discBusy = false; this.pumpDiscoveries(); }, 700);
    }, 6500);
  }

  renderGuide() {
    this.$('.guide-btn .count').textContent = `${this.found.size}/${GUIDE.length}`;
    this.folio.render();
  }
  toggleGuide(force) {
    const open = force ?? !this.folio.want;
    if (open === this.folio.want) return;
    this.folio.setOpen(open);
    // the book has the keyboard while it's open (A / D turn its pages instead of walking)
    this.cb.setControls && this.cb.setControls(!open);
  }

  flash(strength = 1) {
    const f = this.$('#flash');
    f.style.transition = 'none'; f.style.opacity = String(0.5 * strength);
    requestAnimationFrame(() => { f.style.transition = 'opacity 0.8s ease-out'; f.style.opacity = '0'; });
  }
}
