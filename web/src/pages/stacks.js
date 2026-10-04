import '../styles/base.css';
import '../styles/stacks.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG, asset } from '../ui/voxel.js';
import { cube, EMBLEM, ICON } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { byId, FAMILIES } from '../data/blocks.js';
import { FEES } from '../api/contract.js';
import { api } from '../api/client.js';
import { usd, ago, esc, num } from '../core/format.js';
import { installTips, miniStack, handleOf, sol, enfBadges, SOL_USD } from '../ui/coin-shared.js';
import { lineageTree } from '../ui/coin-lineage.js';

mountChrome('stacks');
installTips();
const app = document.getElementById('app');
const fam = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));
const authorPct = FEES.split.find((s) => s.who === 'Stack author').pct;

app.innerHTML = `
<section class="sk-hero">
  <div class="wrap sk-hero-g">
    <div class="sk-copy">
      <span class="eyebrow">Stacks · remix lineage · royalties</span>
      <h1 class="sk-h1" aria-label="Remix. Own.">${voxelSVG('REMIX. OWN.', { cell: 9, gap: 1, depth: 0.34 })}</h1>
      <p class="lede">Any coin's stack can be remixed into a new launch in one click. The new coin keeps a link to its parent, and the parent stack's author earns ${authorPct}% of the ${FEES.tradeFeePct}% trade fee on every coin that remixes it, one level up.</p>
      <div class="sk-split" aria-label="Trade fee split">
        <span class="sk-split-l"><b class="num">${FEES.tradeFeePct}%</b> trade fee</span>
        <span class="sk-split-bar">${FEES.split.map((s) => `<span class="sk-seg ${s.who === 'Stack author' ? 'auth' : s.who === 'Creator' ? 'cr' : 'pl'}" style="flex:${s.pct}" data-tip="${esc(s.note)}"><b class="num">${s.pct}%</b><i>${s.who === 'Stack author' ? 'author' : s.who}</i></span>`).join('')}</span>
      </div>
      <div class="sk-kpis" id="kpis"></div>
    </div>
    <div class="sk-art" aria-hidden="true"><img src="${asset('img/brand/remix-tree-900.webp')}" srcset="${asset('img/brand/remix-tree-900.webp')} 900w, ${asset('img/brand/remix-tree.webp')} 1672w" sizes="(max-width: 900px) 100vw, 640px" alt="" width="900" height="506"></div>
  </div>
</section>

<section class="sk-main">
  <div class="wrap sk-grid">
    <div class="panel sk-board">
      <div class="ph">
        <h3>Original stacks <span class="pk" id="boardCount"></span></h3>
        <div class="seg" id="sort"><button data-s="remixes" class="on">Most remixed</button><button data-s="royalties">Royalties</button><button data-s="new">Newest</button></div>
      </div>
      <div class="sk-thead"><span>#</span><span>Stack</span><span>Author</span><span class="r">Remixes</span><span class="r">Royalties 24h</span><span>Families</span><span></span></div>
      <ol class="sk-rows" id="rows"></ol>
    </div>
    <aside class="sk-side">
      <div class="panel sk-authors" id="authors"></div>
      <div class="panel sk-how">
        <div class="ph"><h3>How remix royalties work</h3></div>
        <ol class="sk-steps">
          <li>${cube('guard', { size: 30 })}<div><b>Pick a stack</b><span>“Remix this stack” opens Build with every block and param copied.</span></div></li>
          <li>${cube('pace', { size: 30 })}<div><b>Change what you want</b><span>Tune params, add or drop blocks. The launch writes the parent stack into your coin's Stack account.</span></div></li>
          <li>${cube('crown', { size: 30 })}<div><b>The author earns</b><span>${authorPct}% of your coin's ${FEES.tradeFeePct}% trade fee goes to the parent stack's author, paid by the keeper. One level up only; originals keep it.</span></div></li>
        </ol>
      </div>
    </aside>
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
        <span class="sk-nm"><b>${esc(s.name)}</b><span class="sk-sub"><span class="num">$${esc(s.ticker)}</span>${miniStack(s.stack, { size: 16, gap: 3 })}</span></span>
      </span>
      <span class="sk-auth">${esc(handleOf(s))}</span>
      <span class="sk-rmx r num"><b>${s.remixCount}</b><i class="sk-l">remixes</i></span>
      <span class="sk-roy r num"><b>${sol(s.royaltiesSol, false)}</b> SOL<i class="sk-l">royalties 24h</i></span>
      <span class="sk-fams">${s.families.map((f) => `<span class="sk-fam" data-tip="${esc(fam[f]?.name ?? f)}">${EMBLEM[f] ?? ''}</span>`).join('')}</span>
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
      <div class="sk-d-h"><span class="pk">Remix lineage</span><span class="dim">${family.length} coin${family.length > 1 ? 's' : ''} on this family · remixes traded ${usd(remixVol)} in 24h</span></div>
      ${tree ? lineageTree(tree, { current: s.ticker }) : '<div class="sk-load">Loading lineage…</div>'}
    </div>
    <div class="sk-d-r">
      <div class="sk-d-h"><span class="pk">The stack</span><span class="dim">by ${esc(handleOf(s))} · ${ago(s.minutesAgo)}</span></div>
      <ol class="sk-blocks">${s.stack.map((x) => { const b = byId[x.id]; return `<li>${cube(b.family, { size: 30 })}<span class="sk-bn"><b>${esc(b.name)}</b><span class="num">${esc(b.summary(x.params))}</span></span><span class="sk-be">${enfBadges(b)}</span></li>`; }).join('')}</ol>
      <div class="sk-d-cta">
        <a class="btn btn-chrome" href="build.html?remix=${encodeURIComponent(s.ticker)}">${ICON.remix}Remix this stack</a>
        <a class="btn btn-glass" href="coin.html?t=${encodeURIComponent(s.ticker)}">View $${esc(s.ticker)}</a>
      </div>
      <p class="sk-d-note dim">Launch on this stack and ${esc(handleOf(s))} earns ${authorPct}% of your coin's trade fee.</p>
    </div>
  </div>`;
}

function sorted() {
  const k = { remixes: (a, b) => b.remixCount - a.remixCount || b.royaltiesSol - a.royaltiesSol, royalties: (a, b) => b.royaltiesSol - a.royaltiesSol || b.remixCount - a.remixCount, new: (a, b) => a.minutesAgo - b.minutesAgo }[sortBy];
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

function renderAuthors(all) {
  const by = new Map();
  for (const c of all) {
    const k = c.creator;
    if (!by.has(k)) by.set(k, { coin: c, handle: handleOf(c), coins: 0, stacks: 0, remixes: 0, royalties: 0, fees: 0 });
    const a = by.get(k);
    a.coins++;
    a.fees += c.vol24Usd * FEES.tradeFeePct / 100 * (FEES.split[0].pct / 100) / SOL_USD;
  }
  for (const s of stacks) { const a = by.get(s.creator); if (!a) continue; a.stacks++; a.remixes += s.remixCount; a.royalties += s.royaltiesSol; }
  const list = [...by.values()].sort((a, b) => b.royalties - a.royalties || b.remixes - a.remixes || b.fees - a.fees).slice(0, 6);
  const max = Math.max(...list.map((a) => a.royalties + a.fees)) || 1;
  $('#authors').innerHTML = `
    <div class="ph"><h3>Top authors <span class="pk">last 24h</span></h3></div>
    <ol class="sk-alist">${list.map((a, i) => `<li>
      <span class="sk-an num">${i + 1}</span>
      <span class="sk-aa">${avatar(a.coin, 30)}</span>
      <span class="sk-ab"><b>${esc(a.handle)}</b><span class="dim">${a.stacks} stack${a.stacks === 1 ? '' : 's'} · ${a.coins} coin${a.coins === 1 ? '' : 's'} · ${a.remixes} remix${a.remixes === 1 ? '' : 'es'}</span>
        <span class="sk-abar" data-tip="Royalties ${sol(a.royalties)} · creator fees ${sol(a.fees)}"><i class="roy" style="width:${(a.royalties / max) * 100}%"></i><i class="fee" style="width:${(a.fees / max) * 100}%"></i></span></span>
      <span class="sk-av num"><b>${sol(a.royalties, false)}</b><small>royalty SOL</small></span>
    </li>`).join('')}</ol>
    <div class="sk-alegend"><span><i class="roy"></i>Royalties</span><span><i class="fee"></i>Creator fees</span></div>`;
}

(async () => {
  const [st, all] = await Promise.all([api.stacks(), api.coins()]);
  stacks = st;
  open = null;
  $('#boardCount').textContent = `${st.length} stacks`;
  const remixes = st.reduce((a, s) => a + s.remixCount, 0);
  const roy = st.reduce((a, s) => a + s.royaltiesSol, 0);
  const authors = new Set(all.map((c) => c.creator)).size;
  $('#kpis').innerHTML = [
    ['Original stacks', num(st.length)], ['Remix launches', num(remixes)], ['Royalties 24h', `${sol(roy, false)} SOL`], ['Authors', num(authors)],
  ].map(([k, v]) => `<div><span class="k">${k}</span><span class="v num">${v}</span></div>`).join('');
  renderRows();
  renderAuthors(all);
  if (st[0]) toggle(st[0].ticker); // the top stack starts open
})();
