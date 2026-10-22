// Build stamp shown faintly in the corner; click it to read the notes. Bump VERSION and add a line to the
// top of NOTES with every change (format: MM.DD.YY.HHMM, e.g. 10.04.26.1823; see handoff.md).
export const VERSION = '10.22.26.1323';

export const NOTES = [
  [VERSION, 'New recorded sounds: thuds, stoke (a real wood fire), raven, frog, whistle, wren, chickadee, woodpecker, owl, coyote. Big stones are pitched down. Separate Effects and River volume sliders. Music: Humming Bird Song out; Crow Traditional Song, I Need Thee Every Hour and Taos Moonlight Song in.'],
  ['10.04.26.1823', 'Added this version stamp and these notes.'],
];

export function mountVersion() {
  const el = document.createElement('div');
  el.className = 'ver';
  el.innerHTML = `<div class="ver-notes" hidden>${NOTES.map(([v, t]) => `<p><b>${v}</b> ${t}</p>`).join('')}</div><button class="ver-tag" type="button" aria-label="Version ${VERSION}">v${VERSION}</button>`;
  const notes = el.querySelector('.ver-notes');
  el.querySelector('.ver-tag').addEventListener('click', () => { notes.hidden = !notes.hidden; });
  document.body.appendChild(el);
}
