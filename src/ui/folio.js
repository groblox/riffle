// The field guide as a worn leather folio: a two-page spread with ribbon tabs per category, an index of
// pencil-and-wash sketches on the left page and the selected entry's study on the right. It arrives shut,
// unclasps, and opens like a book (the front cover swings over on the spine); closing runs the other way.
// Its leaves turn with A / D or the arrow keys, or a sideways swipe.
import { GUIDE } from './guide.js';
import fauna from './sketches/fauna.js';
import insects from './sketches/insects.js';
import flora from './sketches/flora.js';
import fossils from './sketches/fossils.js';

const SKETCH = { ...fauna, ...insects, ...flora, ...fossils };
// a tall, narrow screen: the book lies flat (see the matching block in style.css), so no leaf swings
const flat = () => { try { return matchMedia('(orientation: portrait) and (max-width: 900px)').matches; } catch { return false; } };
const CATS = [
  { id: 'Fish', label: 'Fish' },
  { id: 'Birds', label: 'Birds' },
  { id: 'Insects', label: 'Insects' },
  { id: 'Mammals', label: 'Mammals' },
  { id: 'Herps', label: 'Herps', cats: ['Reptiles', 'Amphibians'] },
  { id: 'Plants', label: 'Plants' },
  { id: 'Geology', label: 'Rocks' },
  { id: 'Fossils', label: 'Fossils' },
];
const inCat = (c, g) => (c.cats || [c.id]).includes(g.cat);
const catOf = (g) => CATS.find((c) => inCat(c, g)) || CATS[0];
// reading order through the whole book: category by category
const ORDER = CATS.flatMap((c) => GUIDE.filter((g) => inCat(c, g)));

// shared SVG filters: a slight tremor on the ink, and bleeding, granulating washes
export const SKETCH_DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <filter id="sk-ink" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="sk-wash" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="8" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feGaussianBlur in="d" stdDeviation="0.7" result="b"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="2" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.35" result="ga"/>
      <feComposite in="b" in2="ga" operator="in"/>
    </filter>
  </defs>
</svg>`;

// a sketch: the same drawing twice, once showing only its washes and once only its linework,
// so each layer takes one filter
export function sketchSVG(id, cls = '') {
  const s = SKETCH[id];
  if (!s) return `<svg class="sketch ${cls}" viewBox="0 0 240 160"></svg>`;
  return `<svg class="sketch ${cls}" viewBox="0 0 240 160"><g class="lw" filter="url(#sk-wash)">${s}</g><g class="li" filter="url(#sk-ink)">${s}</g></svg>`;
}

export class Folio {
  constructor(ui, el) {
    this.ui = ui; this.el = el;
    this.cat = CATS[0].id;
    this.sel = null;
    this.turning = null;
    this.want = false; this.timers = [];
    this.meta = JSON.parse(ui.load('riffle.foundMeta') || '{}');
    el.innerHTML = `
      <div class="folio-back"></div>
      <div class="folio">
        <div class="cover cover-r"></div>
        <div class="tabs">${CATS.map((c) => `<button class="tab" data-c="${c.id}"><span>${c.label}</span></button>`).join('')}</div>
        <div class="page right"><div class="entry"></div><i class="corner"></i></div>
        <div class="spine"></div>
        <div class="leaf">
          <div class="leaf-in">
            <div class="cover cover-l"></div>
            <div class="page left">
              <div class="pg-head"><h2>Field Notes</h2><span class="pg-count"></span></div>
              <div class="pg-sub">Riffle Creek &amp; the canyon country</div>
              <div class="pg-cat"></div>
              <div class="index"></div>
              <div class="pg-foot"><span class="for-mouse"><kbd>A</kbd> <kbd>D</kbd> turn the leaves · click what you find in the world to record it</span><span class="for-touch">swipe the page to turn the leaves</span></div>
              <i class="dogear"></i>
            </div>
          </div>
          <div class="leaf-out"><div class="emboss"><span>Field Notes</span><em>Riffle Creek</em></div><i class="strap"></i></div>
        </div>
        <button class="folio-close" title="Close (J)">&times;</button>
      </div>`;
    this.$ = (s) => el.querySelector(s);
    this.folioEl = this.$('.folio');
    el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.c === this.cat) return;
      const from = CATS.findIndex((c) => c.id === this.cat), to = CATS.findIndex((c) => c.id === b.dataset.c);
      this.go(() => { this.cat = b.dataset.c; this.sel = null; }, to > from ? 1 : -1);
    }));
    this.$('.index').addEventListener('click', (e) => {
      const c = e.target.closest('.cell');
      if (!c || c.dataset.id === this.sel) return;
      const ids = [...this.$('.index').children].map((x) => x.dataset.id);
      this.show(c.dataset.id, ids.indexOf(c.dataset.id) > ids.indexOf(this.sel) ? 1 : -1);
    });
    // a sideways swipe across the book turns its leaves
    let sw = null;
    this.folioEl.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && !e.target.closest('.tabs, .folio-close')) sw = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.folioEl.addEventListener('pointerup', (e) => {
      if (!sw || e.pointerType !== 'touch') return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y, quick = performance.now() - sw.t < 600;
      sw = null;
      if (quick && this.isOpen() && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.step(dx < 0 ? 1 : -1);
    });
    this.folioEl.addEventListener('pointercancel', () => { sw = null; });
    window.addEventListener('resize', () => this.fit());
    this.$('.folio-close').addEventListener('click', () => this.ui.toggleGuide(false));
    this.$('.folio-back').addEventListener('click', () => this.ui.toggleGuide(false));
    // while the book is open it has the keyboard (registered before the camera's listener, so it can
    // swallow the keys it uses)
    window.addEventListener('keydown', (e) => {
      if (!this.want) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.code;
      // holding a key riffles through the leaves at a readable pace rather than at key-repeat rate
      if (e.repeat && /Key[ADWS]|Arrow/.test(k)) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (performance.now() - (this.lastTurn || 0) < 280) return;
      }
      if (/Key[ADWS]|Arrow/.test(k)) {
        this.lastTurn = performance.now();
        // no turning while the cover is still swinging
        if (!this.isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      }
      if (k === 'KeyA' || k === 'ArrowLeft') this.step(-1);
      else if (k === 'KeyD' || k === 'ArrowRight') this.step(1);
      else if (k === 'KeyJ' || k === 'Escape') this.ui.toggleGuide(false);
      else if (k === 'KeyW' || k === 'ArrowUp') this.stepCat(-1);
      else if (k === 'KeyS' || k === 'ArrowDown') this.stepCat(1);
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    });
  }

  // lying flat, the strip's cells are sized so the last one in view is cut off: a plain sign that it scrolls
  fit() {
    const idx = this.$('.index');
    if (!flat()) { idx.style.removeProperty('--cw'); return; }
    const W = idx.clientWidth, target = innerWidth >= 600 ? 130 : 92, gap = 8;
    const k = Math.max(2, Math.floor((W + gap) / (target + gap)));
    idx.style.setProperty('--cw', idx.children.length <= k ? `${target}px` : `${(W - k * gap) / (k + 0.45)}px`);
  }

  // fully open and readable (not merely on its way)
  isOpen() { return this.el.classList.contains('ready'); }

  // the book's choreography, one class per stage:
  //   shown   the closed book comes up into view and rests, cover showing
  //   unclasp the strap pops off the front cover
  //   open    the cover swings over on the spine and the book slides across
  //   ready   ribbons, spine shading and the close button come in
  // closing peels them off in reverse. Reversing mid-way picks up from wherever it has got to.
  setOpen(want) {
    if (want === this.want) return;
    this.want = want;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const cl = this.el.classList, sound = (s) => this.ui.cb.bookSound && this.ui.cb.bookSound(s);
    const at = (ms, fn) => this.timers.push(setTimeout(fn, ms));
    const quick = flat(); // lying flat nothing swings, so there is nothing to wait for
    if (want) {
      this.render();
      let t = 0;
      // the cover comes up in about 0.3 s and is held still for half a second before it opens
      if (!cl.contains('shown')) { cl.add('shown'); t = quick ? 0 : 600; }
      if (!cl.contains('unclasp')) { at(t, () => cl.add('unclasp')); t += quick ? 0 : 200; }
      if (!cl.contains('open')) { at(t, () => { cl.add('open'); sound('bookOpen'); }); t += quick ? 320 : 1050; }
      at(t, () => cl.add('ready'));
    } else {
      if (this.turning) this.turning.finish();
      cl.remove('ready');
      let t = 0;
      if (cl.contains('open')) { cl.remove('open'); at(quick ? 0 : 380, () => sound('bookShut')); t = quick ? 200 : 760; }
      if (cl.contains('unclasp')) { at(t, () => cl.remove('unclasp')); t += quick ? 0 : 240; }
      at(t, () => cl.remove('shown'));
    }
  }

  record(id, how, when) {
    this.meta[id] = { how, when };
    this.ui.save('riffle.foundMeta', JSON.stringify(this.meta));
    // open to the newest entry next time
    const g = GUIDE.find((e) => e.id === id);
    if (g) { this.cat = catOf(g).id; this.sel = id; }
  }

  // next / previous entry, running on into the neighbouring category at either end
  step(dir) {
    const i = ORDER.findIndex((g) => g.id === this.sel);
    const g = ORDER[(i + dir + ORDER.length) % ORDER.length];
    if (catOf(g).id === this.cat) this.show(g.id, dir);
    else this.go(() => { this.sel = g.id; this.cat = catOf(g).id; }, dir);
  }
  stepCat(dir) {
    const i = CATS.findIndex((c) => c.id === this.cat);
    const c = CATS[(i + dir + CATS.length) % CATS.length];
    this.go(() => { this.cat = c.id; this.sel = null; }, dir);
  }

  // another entry on the same spread: the study on the right page is swapped, with no leaf turned
  show(id, dir = 0) {
    if (this.turning) this.turning.finish();
    this.sel = id;
    this.render();
    this.swap(dir);
  }

  // the study on the right page changes: a fade, or (lying flat) a short slide the way the page was moved
  swap(dir = 0) {
    const entry = this.$('.entry');
    entry.classList.remove('swap', 'swap-fwd', 'swap-back'); void entry.offsetWidth;
    entry.classList.add(flat() && dir ? (dir > 0 ? 'swap-fwd' : 'swap-back') : 'swap');
    entry.scrollTop = 0;
  }

  // turn a leaf: forward, the old right page lifts off and swings over the spine; back, a leaf swings
  // in from the left carrying the earlier page
  go(change, dir) {
    if (this.turning) { this.turning.finish(); }
    if (flat()) { change(); this.render(); this.swap(dir); this.ui.cb.pageSound && this.ui.cb.pageSound(); return; }
    const entry = this.$('.entry');
    const oldHTML = entry.innerHTML;
    change();
    const fl = document.createElement('div');
    fl.className = `flip ${dir > 0 ? 'fwd' : 'back'}`;
    const front = document.createElement('div'); front.className = 'face front';
    const back = document.createElement('div'); back.className = 'face rear';
    fl.append(front, back);
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      fl.remove(); this.turning = null;
      if (dir < 0) this.render();
    };
    if (dir > 0) {
      front.innerHTML = `<div class="entry">${oldHTML}</div>`;
      this.render();
    } else {
      this.render(false, true); // left page updates now; the right page waits under the incoming leaf
      const tmp = document.createElement('div');
      tmp.className = 'entry';
      tmp.innerHTML = this.entryHTML(GUIDE.find((g) => g.id === this.sel));
      front.appendChild(tmp);
    }
    this.folioEl.appendChild(fl);
    fl.addEventListener('animationend', finish);
    setTimeout(finish, 900);
    this.turning = { finish };
    this.ui.cb.pageSound && this.ui.cb.pageSound();
  }

  entryHTML(g) {
    const f = this.ui.found.has(g.id), m = this.meta[g.id];
    const how = m ? (m.how === 'heard' ? 'heard' : m.how === 'found' ? 'found under a stone' : 'observed') : (g.heard ? 'heard' : 'observed');
    return f ? `
      <div class="plate">${sketchSVG(g.id, 'big')}<i class="tape a"></i><i class="tape b"></i></div>
      <h3>${g.name}</h3>
      <div class="latin">${g.latin}</div>
      <p class="note">${g.fact}</p>
      <div class="when">${how}${m && m.when ? ` · ${m.when}` : ''}</div>
      <div class="stamp">${g.cat}</div>` : `
      <div class="plate empty"><div class="q">?</div></div>
      <h3 class="unk">${g.heard ? 'A sound of the canyon' : 'Not yet recorded'}</h3>
      <p class="note dim">${g.heard ? 'Something out there calls at certain hours. Listen, and note it down when you hear it.' : 'Somewhere along the creek. Keep your eyes open and ' + (this.ui.touch ? 'tap' : 'click') + ' what you find.'}</p>`;
  }

  render(_turn, keepEntry) {
    const found = this.ui.found;
    this.$('.pg-count').textContent = `${found.size} of ${GUIDE.length}`;
    const cat = CATS.find((c) => c.id === this.cat);
    const list = GUIDE.filter((g) => inCat(cat, g));
    this.el.querySelectorAll('.tab').forEach((b) => {
      const c = CATS.find((x) => x.id === b.dataset.c);
      const n = GUIDE.filter((g) => inCat(c, g)), f = n.filter((g) => found.has(g.id)).length;
      b.classList.toggle('on', b.dataset.c === this.cat);
      b.classList.toggle('full', f === n.length);
      b.title = `${c.label}: ${f} of ${n.length}`;
    });
    // the ribbons scroll sideways when they don't all fit: keep the open one in view
    const tabs = this.$('.tabs'), on = tabs.querySelector('.on');
    if (on && tabs.scrollWidth > tabs.clientWidth + 1) tabs.scrollTo({ left: on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2, behavior: this.isOpen() ? 'smooth' : 'auto' });
    const nf = list.filter((g) => found.has(g.id)).length;
    this.$('.pg-cat').innerHTML = `<span>${cat.label}</span><em>${nf} / ${list.length}</em>`;
    if (!this.sel || !list.some((g) => g.id === this.sel)) this.sel = (list.find((g) => found.has(g.id)) || list[0]).id;
    const idx = this.$('.index'), keep = idx.dataset.cat === this.cat ? idx.scrollLeft : 0;
    idx.innerHTML = list.map((g, i) => {
      const f = found.has(g.id);
      const tilt = ((i * 37) % 7 - 3) * 0.5;
      return `<button class="cell ${f ? 'found' : ''} ${g.id === this.sel ? 'sel' : ''}" data-id="${g.id}" style="--tilt:${tilt}deg">
        ${f ? sketchSVG(g.id, 'thumb') : '<div class="blank">?</div>'}
        <span class="cn">${f ? g.name : g.heard ? 'listen…' : '· · ·'}</span>
      </button>`;
    }).join('');
    // lying flat the index is a strip that scrolls sideways: it stays where it was, and the chosen one is kept in view
    idx.dataset.cat = this.cat;
    this.fit();
    idx.scrollLeft = keep;
    const sel = idx.querySelector('.sel');
    if (sel && idx.scrollWidth > idx.clientWidth + 1) {
      const a = sel.getBoundingClientRect(), b = idx.getBoundingClientRect();
      if (a.left < b.left + 4) idx.scrollLeft += a.left - b.left - 10;
      else if (a.right > b.right - 4) idx.scrollLeft += a.right - b.right + 10;
    }
    if (!keepEntry) this.$('.entry').innerHTML = this.entryHTML(GUIDE.find((e) => e.id === this.sel));
  }
}
