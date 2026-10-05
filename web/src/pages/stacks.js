import '../styles/base.css';
import '../styles/stacks.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG, asset } from '../ui/voxel.js';
import { ICON } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { byId } from '../data/blocks.js';
import { api } from '../api/client.js';
import { usd, ago, esc, num } from '../core/format.js';
import { installTips, miniStack, handleOf, testChip, pxTile, ruleName, plainLine } from '../ui/coin-shared.js';
import { presetCards } from '../ui/coin-presets.js';
import { lineageTree } from '../ui/coin-lineage.js';

// Remixes: reuse a coin's or a rulebook's rules in one click. Rulebooks first; once coins launch, the most remixed rules rank below.
mountChrome('stacks');
installTips();
const app = document.getElementById('app');

app.innerHTML = `
<section class="sk-hero">
  <div class="wrap sk-hero-g">
    <div class="sk-copy">
      <span class="eyebrow">Remixes</span>
      <h1 class="chrome-text sk-h1">Remixes</h1>
      <p class="lede">Like a coin's rules? Remix them: one click copies every rule and setting into a new launch, and you change whatever you want. Each remix keeps a link to the coin it came from, so anyone can see where its rules started.</p>
      <div class="sk-kpis" id="kpis" hidden></div>
    </div>
    <div class="sk-art" aria-hidden="true"><img src="${asset('img/brand/remix-tree-900.webp')}" srcset="${asset('img/brand/remix-tree-900.webp')} 900w, ${asset('img/brand/remix-tree.webp')} 1672w" sizes="(max-width: 900px) 100vw, 560px" alt="" width="900" height="506"></div>
  </div>
</section>

<section class="sk-main">
  <div class="wrap">
    <div class="sk-sh"><h2>Start from a rulebook</h2><p class="muted">Ready-made sets of rules. Remix one, name your coin, launch.</p></div>
    ${presetCards({ cta: 'Remix this' })}

    <div class="panel sk-board" id="board" hidden>
      <div class="ph">
        <h3>Most remixed rules <span class="pk" id="boardCount"></span></h3>
        <div class="seg" id="sort"><button data-s="remixes" class="on">Most remixed</button><button data-s="new">Newest</button></div>
      </div>
      <div class="sk-thead"><span>#</span><span>Coin</span><span>Creator</span><span class="r">Remixes</span><span>Rules</span><span></span></div>
      <ol class="sk-rows" id="rows"></ol>
    </div>
  </div>
</section>`;

const $ = (s) => app.querySelector(s);
let stacks = [], open = null, sortBy = 'remixes';
const lineageCache = new Map();

function rankMark(i) {
  return i < 3 ? `<span class="sk-rank top" aria-label="Rank ${i + 1}">${voxelSVG(String(i + 1), { cell: 3.6, gap: 0.5, depth: 0.34, glow: false })}</span>` : `<span class="sk-rank num">${i + 1}</span>`;
}

function row(s, i) {
  const isOpen = open === s.ticker;
  return `<li class="sk-row${isOpen ? ' open' : ''}" data-t="${esc(s.ticker)}">
    <button class="sk-r" aria-expanded="${isOpen}" aria-controls="d-${esc(s.ticker)}">
      ${rankMark(i)}
      <span class="sk-stack">
        ${avatar(s, 40)}
        <span class="sk-nm"><b>${esc(s.name)}</b><span class="sk-sub"><span class="num">$${esc(s.ticker)}</span>${testChip(s)}</span></span>
      </span>
      <span class="sk-auth">${esc(handleOf(s))}</span>
      <span class="sk-rmx r num"><b>${s.remixCount}</b><i class="sk-l">remix${s.remixCount === 1 ? '' : 'es'}</i></span>
      <span class="sk-fams">${miniStack(s.stack, { size: 18, gap: 3 })}</span>
      <span class="sk-chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span>
    </button>
    <div class="sk-detail" id="d-${esc(s.ticker)}" ${isOpen ? '' : 'hidden'}>${isOpen ? detail(s) : ''}</div>
  </li>`;
}

function detail(s) {
  const tree = lineageCache.get(s.ticker);
  const family = s.family ?? [s];
  const remixVol = family.slice(1).reduce((a, c) => a + c.vol24Usd, 0);
  return `<div class="sk-d">
    <div class="sk-d-l">
      <div class="sk-d-h"><span class="pk">Remix tree</span><span class="dim">${family.length} coin${family.length > 1 ? 's' : ''} with these rules · remixes traded ${usd(remixVol)} in 24h</span></div>
      ${tree ? lineageTree(tree, { current: s.ticker }) : '<div class="sk-load">Loading remixes…</div>'}
      ${tree && !tree.children.length ? `<p class="sk-none">${pxTile('x', { size: 22, state: 'empty' })}<span>No remixes yet. Remix these rules and your coin branches off here.</span></p>` : ''}
    </div>
    <div class="sk-d-r">
      <div class="sk-d-h"><span class="pk">The rules</span><span class="dim">by ${esc(handleOf(s))} · ${ago(s.minutesAgo)}</span></div>
      <ol class="sk-blocks">${s.stack.map((x) => { const b = byId[x.id]; return `<li>${pxTile(b.family, { size: 30 })}<span class="sk-bn"><b>${esc(ruleName(b))}</b><span>${esc(plainLine(b))}</span></span></li>`; }).join('')}</ol>
      <div class="sk-d-cta">
        <a class="btn btn-chrome" href="build.html?remix=${encodeURIComponent(s.ticker)}">${ICON.remix}Remix this</a>
        <a class="btn btn-glass" href="coin.html?t=${encodeURIComponent(s.ticker)}">View $${esc(s.ticker)}</a>
      </div>
    </div>
  </div>`;
}

function sorted() {
  const k = { remixes: (a, b) => b.remixCount - a.remixCount || a.minutesAgo - b.minutesAgo, new: (a, b) => a.minutesAgo - b.minutesAgo }[sortBy];
  return [...stacks].sort(k);
}

function renderRows() {
  $('#rows').innerHTML = sorted().map(row).join('');
}

async function toggle(t) {
  open = open === t ? null : t;
  renderRows();
  if (open && !lineageCache.has(open)) {
    const tree = await api.lineage(open);
    lineageCache.set(open, tree);
    if (open === t) {
      const el = app.querySelector(`.sk-row[data-t="${CSS.escape(t)}"] .sk-detail`);
      if (el) el.innerHTML = detail(stacks.find((s) => s.ticker === t));
    }
  }
}

$('#rows').addEventListener('click', (e) => {
  const b = e.target.closest('.sk-r');
  if (!b) return;
  toggle(b.closest('.sk-row').dataset.t);
});
$('#sort').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  sortBy = b.dataset.s;
  app.querySelectorAll('#sort button').forEach((x) => x.classList.toggle('on', x === b));
  renderRows();
});

(async () => {
  const [st, all] = await Promise.all([api.stacks(), api.coins()]);
  stacks = st;
  open = null;
  if (!st.length) return; // nothing launched yet: the rulebooks are the way in
  const remixes = st.reduce((a, s) => a + s.remixCount, 0);
  $('#kpis').innerHTML = [['Coins', num(st.length)], ['Remix launches', num(remixes)], ['Creators', num(new Set(all.map((c) => c.creator)).size)]]
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v num">${v}</span></div>`).join('');
  $('#kpis').hidden = false;
  $('#board').hidden = false;
  $('#boardCount').textContent = `${st.length} coin${st.length === 1 ? '' : 's'}`;
  $('#sort').hidden = st.length < 2;
  renderRows();
  toggle(sorted()[0].ticker); // the top one starts open
})();

