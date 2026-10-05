import '../styles/base.css';
import '../styles/coins.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG } from '../ui/voxel.js';
import { cube, EMBLEM } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { FAMILIES, BLOCKS, PRESETS, ENGINE, byId, hex, errName } from '../data/blocks.js';
import { api } from '../api/client.js';
import { usd, pctS, num, ago, esc } from '../core/format.js';
import { miniStack, handleOf, installTips, chg, testChip } from '../ui/coin-shared.js';
import { presetCards } from '../ui/coin-presets.js';
import { reconcile } from '../ui/coin-feed.js';

mountChrome('coins');
installTips();

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const state = {
  family: params.get('family') || '',
  phase: params.get('phase') || '',
  sort: params.get('sort') || 'mcap',
  q: params.get('q') || '',
};
const SORTS = [
  ['mcap', 'Market cap'], ['volume', '24h volume'], ['new', 'Newest'], ['remixes', 'Most remixed'], ['change', '24h change'],
];
const PHASES = [['', 'All'], ['curve', 'On curve'], ['graduated', 'Graduated']];
const GRAD_SOL = 85;

app.innerHTML = `
<section class="cx-hero">
  <div class="wrap">
    <div class="cx-head">
      <div class="cx-title">
        <span class="eyebrow">Explorer · every transfer checked</span>
        <h1 class="cx-h1" aria-label="Coins">${voxelSVG('COINS', { cell: 11, gap: 1.2, depth: 0.34 })}</h1>
        <p class="lede">Every coin launched on hookrz and the stack of rules it runs. The engine checks each transfer against the stack and refuses what it forbids, on chain.</p>
      </div>
      <div class="cx-stats panel" id="stats">${statCells(null)}</div>
    </div>
    <div class="cx-live panel" id="live">
      <div class="cx-live-h">
        <span class="live-dot refuse"></span>
        <span class="pixel cx-live-t">Refused just now</span>
        <span class="cx-live-empty" id="liveEmpty">No refusals yet. When a coin's stack refuses a transfer, it shows up here.</span>
      </div>
      <div class="cx-live-list" id="liveList" hidden></div>
    </div>
  </div>
</section>

<section class="cx-main">
  <div class="wrap">
    <div class="cx-controls" id="controls" hidden>
      <div class="cx-fams" role="group" aria-label="Family">
        <button class="fchip" data-fam="">All</button>
        ${FAMILIES.map((f) => `<button class="fchip" data-fam="${f.id}" data-tip="${esc(f.verb)}: ${esc(f.blurb)}"><span class="emb">${EMBLEM[f.id]}</span>${f.name}</button>`).join('')}
      </div>
      <div class="cx-tools">
        <div class="seg" id="phase" role="group" aria-label="Phase">${PHASES.map(([v, l]) => `<button data-phase="${v}">${l}</button>`).join('')}</div>
        <label class="cx-sort"><span class="sr">Sort</span>
          <select class="input" id="sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </label>
        <label class="cx-search"><span class="sr">Search</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="4.8"/><path d="m10.6 10.6 3.6 3.6"/></svg>
          <input class="input" id="q" type="search" placeholder="Search coins" autocomplete="off" spellcheck="false">
        </label>
      </div>
    </div>
    <div class="cx-meta" id="meta" hidden><span id="count" class="dim"></span><span class="dim cx-hint">Hover a cube to see the rule. <span class="r-sq"></span>refused / checked transfers.</span></div>
    <div class="cx-grid" id="grid"></div>
    <div class="cx-more" id="more" hidden></div>
  </div>
</section>`;

const $ = (s) => app.querySelector(s);

// ---------------- aggregate stats ----------------
const plural = (n, w) => `${num(n)} ${w}${n === 1 ? '' : 's'}`;
function statCells(list) {
  if (list && !list.length) return zeroStats();
  const sum = (k) => (list ?? []).reduce((a, c) => a + (c[k] ?? 0), 0);
  const checked = sum('checked'), refused = sum('refused');
  const cells = [
    ['Coins', list ? num(list.length) : '—', list ? `${list.filter((c) => c.phase === 'graduated').length} graduated` : ''],
    ['24h volume', list ? usd(sum('vol24Usd')) : '—', list ? `${plural(list.filter((c) => c.vol24Usd > 0).length, 'coin')} traded` : ''],
    ['Checked', list ? num(checked) : '—', 'transfers, on chain'],
    ['Refused', list ? num(refused) : '—', list && checked ? `${((refused / checked) * 100).toFixed(1)}% of transfers` : ''],
  ];
  return cells.map(([k, v, s], i) => `<div class="cx-stat${i === 3 ? ' ref' : ''}"><span class="k">${k}</span><span class="v num">${v}</span><span class="s">${s}</span></div>`).join('');
}

/** No coins yet: say so, then show what is true about the engine instead of zeros. */
function zeroStats() {
  const cells = [
    ['Coins', '0', 'none launched yet'],
    ['Blocks', num(BLOCKS.length), `in ${FAMILIES.length} families`],
    ['Starter stacks', num(PRESETS.length), 'ready to remix'],
    ['Engine budget', ENGINE.cuBudget.toLocaleString('en-US'), 'CU per transfer'],
  ];
  return cells.map(([k, v, s]) => `<div class="cx-stat"><span class="k">${k}</span><span class="v num">${v}</span><span class="s">${s}</span></div>`).join('');
}

/** The explorer with nothing launched: one line, two ways in, and the starter stacks. */
function zero() {
  return `<div class="cx-zero">
    <div class="cx-zero-hero panel">
      <div class="cx-zero-copy">
        <div class="cx-zero-cubes">${FAMILIES.map(() => cube('x', { size: 30, state: 'empty' })).join('')}</div>
        <h2 class="cx-zero-h">No coins yet</h2>
        <p class="lede">Snap rule blocks into a stack and launch it; the first coin shows up here with every transfer the engine checks.</p>
        <div class="cx-zero-cta"><a class="btn btn-chrome btn-lg" href="build.html">Build the first coin</a><a class="btn btn-glass btn-lg" href="build.html#presets">Start from a preset</a></div>
      </div>
    </div>
    <div class="cx-zero-h3"><h3>Starter stacks</h3><span class="dim">Open one in Build, tune it, launch.</span></div>
    ${presetCards()}
  </div>`;
}

// ---------------- grid ----------------
function card(c) {
  const t = encodeURIComponent(c.ticker);
  const ch = chg(c.change24);
  const isNew = c.minutesAgo < 60;
  const raised = Math.min(GRAD_SOL, c.progress * GRAD_SOL);
  const refusedPct = c.checked ? (c.refused / c.checked) * 100 : 0;
  return `<article class="ccard${c.phase === 'graduated' ? ' grad' : ''}">
    <a class="cc-link" href="coin.html?t=${t}" aria-label="${esc(c.name)} ($${esc(c.ticker)})"></a>
    <div class="cc-top">
      ${avatar(c, 52)}
      <div class="cc-id">
        <div class="cc-name">${esc(c.name)}</div>
        <div class="cc-sub"><span class="cc-tk">$${esc(c.ticker)}</span>${testChip(c)}<span class="cc-by">${esc(handleOf(c))}</span></div>
        <div class="cc-age">${isNew ? '<span class="cc-new">New</span>' : ''}${ago(c.minutesAgo)}</div>
      </div>
      <div class="cc-chg ${ch > 0.05 ? 'up' : ch < -0.05 ? 'down' : ''}"><span class="num">${pctS(ch)}</span><span class="k">24h</span></div>
    </div>
    ${c.desc ? `<p class="cc-desc">${esc(c.desc)}</p>` : ''}
    <div class="cc-nums">
      <div><span class="k">Market cap</span><span class="v num">${usd(c.mcapUsd)}</span></div>
      <div><span class="k">Vol 24h</span><span class="v num">${usd(c.vol24Usd)}</span></div>
      <div><span class="k">Holders</span><span class="v num">${num(c.holders)}</span></div>
    </div>
    ${c.phase === 'graduated'
    ? `<div class="cc-curve"><div class="cc-grad"><span class="chip solid">Graduated</span><span class="dim">Trading on Meteora DAMM v2</span></div></div>`
    : `<div class="cc-curve"><div class="cc-cl"><span class="k">Curve</span><span class="num"><b>${(c.progress * 100).toFixed(c.progress < 0.1 ? 1 : 0)}%</b> · ${raised.toFixed(1)} / ${GRAD_SOL} SOL</span></div><div class="cbar ticks"><i style="width:${Math.max(1.5, c.progress * 100)}%"></i></div></div>`}
    <div class="cc-stack">
      <div class="cc-blocks">${miniStack(c.stack, { size: 26, gap: 5 })}<span class="cc-slots num">${c.stack.length}/6</span></div>
      <div class="cc-checks num" data-tip="${num(c.refused)} of ${num(c.checked)} transfers refused (${refusedPct.toFixed(1)}%)"><span class="r">${num(c.refused)}</span><span class="dim">/ ${num(c.checked)}</span></div>
    </div>
    <div class="cc-foot">
      ${c.parent ? `<a class="chip ice cc-parent" href="coin.html?t=${encodeURIComponent(c.parent)}"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 2v4a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v2"/></svg>Remix of $${esc(c.parent)}</a>` : '<span class="chip">Original stack</span>'}
      <span class="cc-remixes${c.remixes ? ' has' : ''}" data-tip="${c.remixes ? `${c.remixes} coin${c.remixes > 1 ? 's' : ''} launched on this stack` : 'Nobody has remixed this stack yet'}">${remixGlyph}<span class="num">${c.remixes}</span> remix${c.remixes === 1 ? '' : 'es'}</span>
    </div>
  </article>`;
}
const remixGlyph = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2v4a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v2M12 2v3M4 14v-2"/><rect x="2.5" y="1" width="3" height="3"/><rect x="10.5" y="1" width="3" height="3"/></svg>`;

function empty() {
  const fam = FAMILIES.find((f) => f.id === state.family);
  return `<div class="cx-empty panel">
    <div class="cx-empty-cubes">${cube('x', { size: 34, state: 'empty' })}${cube('x', { size: 34, state: 'empty' })}${cube('x', { size: 34, state: 'empty' })}</div>
    <h3>No coins match</h3>
    <p class="muted">Nothing ${state.q ? `matches “${esc(state.q)}”` : 'fits these filters'}${fam ? ` with a ${fam.name} block` : ''}${state.phase ? ` ${state.phase === 'curve' ? 'on the curve' : 'that has graduated'}` : ''}.</p>
    <div class="row wrap-row" style="justify-content:center"><button class="btn btn-glass btn-sm" id="clear">Clear filters</button><a class="btn btn-chrome btn-sm" href="build.html">Build one</a></div>
  </div>`;
}

let reqId = 0, total = null, famCount = {}, gradCount = 0;
async function load() {
  const id = ++reqId;
  if (total === 0) { // nothing launched: no filters to show, just the way in
    $('#controls').hidden = true; $('#meta').hidden = true;
    $('#grid').className = 'cx-grid is-empty';
    $('#grid').innerHTML = zero();
    return;
  }
  $('#controls').hidden = false; $('#meta').hidden = false;
  // a short list leaves room for the way to the next coin
  if (total < 6 && $('#more').hidden) {
    $('#more').innerHTML = `<div class="cx-zero-h3"><h3>Launch the next one</h3><span class="dim">Start from a starter stack, tune it in Build, launch.</span><a class="btn btn-glass btn-sm" href="build.html">Build a coin</a></div>${presetCards({ compact: true })}`;
    $('#more').hidden = false;
  }
  syncControls();
  const list = await api.coins({ sort: state.sort, family: state.family || undefined, phase: state.phase || undefined, q: state.q.trim() || undefined });
  if (id !== reqId) return;
  $('#grid').innerHTML = list.length ? list.map(card).join('') : empty();
  $('#grid').classList.toggle('is-empty', !list.length);
  $('#count').textContent = `${list.length} coin${list.length === 1 ? '' : 's'}${state.family || state.phase || state.q ? ' match' : ''}`;
  $('#clear')?.addEventListener('click', () => { Object.assign(state, { family: '', phase: '', q: '' }); $('#q').value = ''; load(); });
}

function syncControls() {
  app.querySelectorAll('.fchip').forEach((b) => {
    const on = b.dataset.fam === state.family;
    b.classList.toggle('on', on);
    // a family no coin uses has nothing to filter; keep it visible but off (unless it is the active one)
    b.disabled = !!b.dataset.fam && !famCount[b.dataset.fam] && !on;
  });
  app.querySelectorAll('#phase button').forEach((b) => {
    const on = b.dataset.phase === state.phase;
    b.classList.toggle('on', on);
    b.disabled = b.dataset.phase === 'graduated' && !gradCount && !on;
  });
  $('#sort').value = state.sort;
  const p = new URLSearchParams();
  for (const k of ['family', 'phase', 'q']) if (state[k]) p.set(k, state[k]);
  if (state.sort !== 'mcap') p.set('sort', state.sort);
  history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
}

app.querySelector('.cx-fams').addEventListener('click', (e) => {
  const b = e.target.closest('.fchip'); if (!b || b.disabled) return;
  state.family = b.dataset.fam === state.family && b.dataset.fam ? '' : b.dataset.fam;
  load();
});
$('#phase').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; state.phase = b.dataset.phase; load(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; load(); });
let qt;
$('#q').value = state.q;
$('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { state.q = e.target.value; load(); }, 160); });

// ---------------- refused just now ----------------
// Fed only by live refusals from launched coins (never the test coin); empty until one happens.
const MAX_LIVE = 6;
const live = [];
const queue = [];
const ageTxt = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 2 ? 'now' : s < 60 ? s + 's' : Math.floor(s / 60) + 'm'; };
function liveItem(e) {
  const b = byId[e.by];
  return `<a class="lv${e.fresh ? ' fresh' : ''}" href="coin.html?t=${encodeURIComponent(e.ticker)}">
    ${cube(b?.family ?? 'custom', { size: 30, state: 'refused' })}
    <span class="lv-body">
      <span class="lv-top"><b>$${esc(e.ticker)}</b><span class="lv-b">${esc(b?.name ?? e.by)}</span><span class="lv-code" data-tip="${esc(`${hex(b?.code)} ${errName(b?.code)}`)}">${hex(b?.code)}</span></span>
      <span class="lv-msg">${esc(e.msg)}</span>
    </span>
    <span class="lv-age num" data-at="${e.at}">${ageTxt(e.at)}</span>
  </a>`;
}
function renderLive() {
  $('#liveEmpty').hidden = live.length > 0;
  $('#liveList').hidden = !live.length;
  $('#liveList').innerHTML = live.map(liveItem).join('');
  live.forEach((e) => { e.fresh = false; });
}
function watchRefusals(all) {
  // hook blocks only run on the curve; the test coin is never streamed here
  const watch = all.filter((c) => !c.test && c.phase === 'curve' && c.budget.hasHook).slice(0, 6);
  for (const c of watch) {
    api.stream(c.ticker, (raw) => {
      const e = reconcile(raw, c);
      if (!e || e.ok || !e.by) return;
      queue.push({ ticker: c.ticker, by: e.by, msg: e.msg });
      if (queue.length > MAX_LIVE) queue.splice(0, queue.length - MAX_LIVE);
    });
  }
  if (!watch.length) return;
  setInterval(() => {
    if (queue.length) { const e = queue.shift(); e.at = Date.now(); e.fresh = true; live.unshift(e); live.length = Math.min(live.length, MAX_LIVE); renderLive(); return; }
    app.querySelectorAll('.lv-age').forEach((n) => { n.textContent = ageTxt(+n.dataset.at); });
  }, 1400);
}

// ---------------- boot ----------------
(async () => {
  const all = await api.coins();
  total = all.length;
  famCount = {}; for (const c of all) for (const f of c.families) famCount[f] = (famCount[f] ?? 0) + 1;
  gradCount = all.filter((c) => c.phase === 'graduated').length;
  $('#stats').innerHTML = statCells(all);
  load();
  watchRefusals(all);
})();
