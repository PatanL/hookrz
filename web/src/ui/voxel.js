// Voxel type: renders text as chrome cubes, the way the brand banner's "BUILD. REMIX. OWN." is built.
// voxelSVG(text, { cell, gap, depth, glow }) -> SVG markup string. Uppercase + digits + . - ! ?, and lowercase for the wordmark.

const G = {
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  B: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  C: ['.XXX.', 'X...X', 'X....', 'X....', 'X....', 'X...X', '.XXX.'],
  D: ['XXXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'XXXX.'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  F: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'X....'],
  G: ['.XXX.', 'X...X', 'X....', 'X.XXX', 'X...X', 'X...X', '.XXXX'],
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  J: ['..XXX', '...X.', '...X.', '...X.', '...X.', 'X..X.', '.XX..'],
  K: ['X...X', 'X..X.', 'X.X..', 'XX...', 'X.X..', 'X..X.', 'X...X'],
  L: ['X....', 'X....', 'X....', 'X....', 'X....', 'X....', 'XXXXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
  N: ['X...X', 'X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  Q: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X.X.X', 'X..X.', '.XX.X'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  S: ['.XXXX', 'X....', 'X....', '.XXX.', '....X', '....X', 'XXXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  U: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  W: ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'X.X.X', '.X.X.'],
  X: ['X...X', 'X...X', '.X.X.', '..X..', '.X.X.', 'X...X', 'X...X'],
  Y: ['X...X', 'X...X', '.X.X.', '..X..', '..X..', '..X..', '..X..'],
  Z: ['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'],
  0: ['.XXX.', 'X...X', 'X..XX', 'X.X.X', 'XX..X', 'X...X', '.XXX.'],
  1: ['.X.', 'XX.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  2: ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.X...', 'XXXXX'],
  3: ['XXXXX', '...X.', '..X..', '...X.', '....X', 'X...X', '.XXX.'],
  4: ['...X.', '..XX.', '.X.X.', 'X..X.', 'XXXXX', '...X.', '...X.'],
  5: ['XXXXX', 'X....', 'XXXX.', '....X', '....X', 'X...X', '.XXX.'],
  6: ['..XX.', '.X...', 'X....', 'XXXX.', 'X...X', 'X...X', '.XXX.'],
  7: ['XXXXX', '....X', '...X.', '..X..', '.X...', '.X...', '.X...'],
  8: ['.XXX.', 'X...X', 'X...X', '.XXX.', 'X...X', 'X...X', '.XXX.'],
  9: ['.XXX.', 'X...X', 'X...X', '.XXXX', '....X', '...X.', '.XX..'],
  '.': ['.', '.', '.', '.', '.', '.', 'X'],
  '-': ['...', '...', '...', 'XXX', '...', '...', '...'],
  '!': ['X', 'X', 'X', 'X', 'X', '.', 'X'],
  '?': ['.XXX.', 'X...X', '....X', '...X.', '..X..', '.....', '..X..'],
  '+': ['.....', '..X..', '..X..', 'XXXXX', '..X..', '..X..', '.....'],
  ' ': ['..', '..', '..', '..', '..', '..', '..'],
  // lowercase — wordmark set (x-height 5, ascenders 7)
  h: ['X...', 'X...', 'XXX.', 'X..X', 'X..X', 'X..X', 'X..X'],
  o: ['....', '....', '.XX.', 'X..X', 'X..X', 'X..X', '.XX.'],
  k: ['X...', 'X...', 'X..X', 'X.X.', 'XX..', 'X.X.', 'X..X'],
  r: ['...', '...', 'X.X', 'XX.', 'X..', 'X..', 'X..'],
  z: ['....', '....', 'XXXX', '..X.', '.X..', 'X...', 'XXXX'],
};

let uid = 0;

/** Text -> voxel SVG markup. cell = cube size in px, gap = space between cubes, depth = extrusion (0..1 of cell). */
export function voxelSVG(text, { cell = 10, gap = cell * 0.09, depth = 0.32, letter = 1, glow = true, title } = {}) {
  const id = 'vx' + (++uid);
  const step = cell + gap;
  const cubes = [];
  let x = 0;
  for (const ch of String(text)) {
    const g = G[ch] ?? G[ch.toUpperCase()] ?? G[' '];
    const w = g[0].length;
    g.forEach((row, r) => {
      for (let c = 0; c < w; c++) if (row[c] === 'X') cubes.push([x + c, r]);
    });
    x += w + letter;
  }
  const cols = Math.max(0, x - letter);
  const d = Math.round(cell * depth);
  const W = cols * step - gap + d, H = 7 * step - gap + d;
  const s = (n) => +n.toFixed(2);
  let back = '', face = '';
  cubes.forEach(([cx, cy], i) => {
    const px = cx * step, py = cy * step;
    // extrusion: side + bottom faces, drawn first
    back += `<path d="M${s(px + cell)} ${s(py)}l${d} ${d}v${cell}l${-d} ${-d}z" fill="url(#${id}s)"/>`;
    back += `<path d="M${s(px)} ${s(py + cell)}l${d} ${d}h${cell}l${-d} ${-d}z" fill="url(#${id}b)"/>`;
    face += `<rect x="${s(px)}" y="${s(py)}" width="${cell}" height="${cell}" fill="url(#${id}f)" style="--i:${i}"/>`;
    face += `<path d="M${s(px + .5)} ${s(py + cell - .5)}V${s(py + .5)}H${s(px + cell - .5)}" stroke="#fff" stroke-opacity=".55" stroke-width="${Math.max(.6, cell * .08)}" fill="none"/>`;
  });
  const label = title ?? text;
  return `<svg class="voxel" viewBox="0 0 ${s(W)} ${s(H)}" width="${s(W)}" height="${s(H)}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#dfe7f2"/><stop offset=".55" stop-color="#9eabc0"/><stop offset=".75" stop-color="#eef3f9"/><stop offset="1" stop-color="#b3bfd2"/></linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5d6a84"/><stop offset="1" stop-color="#2b3448"/></linearGradient>
<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c90ff"/><stop offset="1" stop-color="#1d3f7a"/></linearGradient>
${glow ? `<filter id="${id}g" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="${cell * .7}" result="b"/><feFlood flood-color="#6fb2ff" flood-opacity=".5" result="f"/><feComposite in="f" in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : ''}
</defs>
<g ${glow ? `filter="url(#${id}g)"` : ''}>${back}${face}</g></svg>`;
}

/** The hookrz wordmark: chrome hook mark + voxel "hookrz". size = cube px. */
export function wordmark({ size = 3.2, mark = true } = {}) {
  const vx = voxelSVG('hookrz', { cell: size, gap: size * .18, depth: .34, glow: false, title: 'hookrz' });
  return `${mark ? `<img class="mark" src="${asset('img/hook-mark-128.png')}" alt="" width="34" height="34">` : ''}${vx}`;
}

/** Resolve a public asset relative to the site root (works on / and on /hookrz/ subpaths). */
export function asset(p) {
  return new URL(p, document.querySelector('base')?.href ?? (import.meta.env.BASE_URL.startsWith('.') ? siteRoot() : location.origin + import.meta.env.BASE_URL)).href;
}
function siteRoot() {
  // pages are flat (index.html, build.html, ...) so the site root is the current directory
  return location.href.replace(/[^/]*([?#].*)?$/, '');
}
