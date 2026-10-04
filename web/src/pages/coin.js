import '../styles/base.css';
import '../styles/coin.css';
import { mountChrome, toast } from '../ui/chrome.js';
import { voxelSVG } from '../ui/voxel.js';
import { cube, ICON, EMBLEM } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { byId } from '../data/blocks.js';
import { FEES } from '../api/contract.js';
import { api } from '../api/client.js';
import { SUPPLY } from '../engine/sim.js';
import { usd, pctS, num, ago, esc, q } from '../core/format.js';
import { installTips, handleOf, shortKey, copyText, chg, sol, SOL_USD } from '../ui/coin-shared.js';
import { lineageTree } from '../ui/coin-lineage.js';
import { buildHistory, mountChart, TIMEFRAMES } from '../ui/coin-chart.js';
import { mountStackPanel } from '../ui/coin-stackpanel.js';
import { mountTicket } from '../ui/coin-ticket.js';
import { mountFeed } from '../ui/coin-feed.js';
import { pos, onPos } from '../ui/coin-position.js';

mountChrome('coins');
installTips();
const app = document.getElementById('app');
const T = (q('t') || 'STACK').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'STACK';
const GRAD_SOL = 85;
const loadedAt = Date.now();

boot();

async function boot() {
  app.innerHTML = `<section class="cn-top"><div class="wrap"><div class="cn-skel"><span></span><span></span><span></span></div></div></section>`;
  const coin = await api.coin(T);
  if (!coin) return notFound();
  document.title = `$${coin.ticker} · ${coin.name} · hookrz`;
  const grad = coin.phase === 'graduated';
  const [sim, lineage, holders, all] = await Promise.all([
    api.simulate(coin.stack, { seed: [...coin.ticker].reduce((a, c) => a + c.charCodeAt(0), 0) }),
    api.lineage(coin.ticker).catch(() => null),
    api.holders(coin.ticker),
    api.coins(),
  ]);
  const hist = buildHistory(coin, sim.withStack);
  const risky = coin.stack.map((s) => ({ s, b: byId[s.id] })).filter(({ b }) => b.risk || b.power);
  const parent = coin.parent ? all.find((c) => c.ticker === coin.parent) : null;
  const children = all.filter((c) => c.parent === coin.ticker);

  app.innerHTML = `
  <section class="cn-top">
    <div class="wrap">
      <nav class="cn-crumb" aria-label="Breadcrumb"><a href="coins.html">Coins</a><span>/</span><span class="mono">$${esc(coin.ticker)}</span></nav>
      <div class="cn-head">
        <div class="cn-av">${avatar(coin, 88)}</div>
        <div class="cn-id">
          <div class="cn-l1">
            <h1>${esc(coin.name)}</h1>
            <span class="cn-tk">$${esc(coin.ticker)}</span>
            ${grad ? '<span class="chip solid">Graduated</span>' : '<span class="chip ice"><span class="dot ice"></span>On curve</span>'}
          </div>
          <div class="cn-l2">
            <span>by <b>${esc(handleOf(coin))}</b></span>
            <span class="sep"></span>
            <span>launched ${ago(coin.minutesAgo)}</span>
            <span class="sep"></span>
            <span class="cn-mint">mint <span class="mono" title="${esc(coin.mint)}">${shortKey(coin.mint)}</span><button class="icon-btn" id="copyMint" aria-label="Copy mint address">${ICON.copy}</button></span>
            ${parent ? `<span class="sep"></span><a class="chip ice cn-parent" href="coin.html?t=${encodeURIComponent(parent.ticker)}">Remix of $${esc(parent.ticker)}</a>` : ''}
          </div>
          ${coin.desc ? `<p class="cn-desc">${esc(coin.desc)}</p>` : ''}
        </div>
        <div class="cn-act">
          <a class="btn btn-chrome" href="build.html?remix=${encodeURIComponent(coin.ticker)}">${ICON.remix}Remix this stack</a>
          <div class="cn-share">
            <button class="btn btn-glass" id="share"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 10V2M4.5 5.5 8 2l3.5 3.5M3 9v5h10V9"/></svg>Share</button>
            <a class="btn btn-glass cn-x" href="https://x.com/intent/tweet?text=${encodeURIComponent(`$${coin.ticker} runs a ${coin.stack.length}-block stack on hookrz.fun`)}&url=${encodeURIComponent(location.href)}" target="_blank" rel="noopener" aria-label="Post on X">${ICON.x}</a>
          </div>
        </div>
      </div>
      ${risky.length ? `<div class="cn-risk">${risky.map(({ s, b }) => `<div>${cube(b.family, { size: 22, state: 'refused' })}<span><b>${esc(b.name)}</b> ${esc(riskLine(b, s, coin))}</span></div>`).join('')}</div>` : ''}
      <div class="cn-stats">${statCells(coin)}</div>
    </div>
  </section>

  <section class="cn-main">
    <div class="wrap cn-grid">
      <div class="cn-col">
        <div class="panel cn-chart" id="chartP">
          <div class="cn-ch-h">
            <div class="cn-ch-v">
              <span class="pk">Market cap</span>
              <div class="cn-ch-big"><span class="cn-ch-d">$</span>${voxelSVG(usd(coin.mcapUsd).slice(1), { cell: 5.2, gap: 0.8, depth: 0.34, glow: false })}</div>
              <div class="cn-ch-sub"><span id="tfChg" class="num"></span><span class="dim" id="tfLbl"></span><span class="dim num" id="tfPx"></span></div>
            </div>
            <div class="seg" id="tf">${TIMEFRAMES.map(([k, ms]) => `<button data-tf="${k}" ${ms !== Infinity && ms > hist.ageMs * 1.05 && k !== '1H' ? 'disabled' : ''}>${k}</button>`).join('')}</div>
          </div>
          <div id="chart"></div>
          <div class="cn-ch-leg"><span><i class="lg-line"></i>Market cap</span><span><i class="lg-vol"></i>Volume</span><span><i class="lg-ref"></i>Refused transfers</span>${hist.gradAt ? '<span><i class="lg-grad"></i>Graduation</span>' : ''}</div>
        </div>
        <div class="panel cn-stack" id="stackP"></div>
        <div class="panel cn-feed" id="feedP"></div>
      </div>
      <aside class="cn-side">
        <div class="panel cn-ticket" id="ticketP"></div>
      </aside>
    </div>
    <div class="wrap cn-grid2">
      <div class="panel cn-lin" id="linP"></div>
    </div>
    <div class="wrap cn-grid3">
      <div class="panel cn-hold" id="holdP"></div>
      <div class="panel cn-fees" id="feesP"></div>
    </div>
  </section>`;

  const $ = (s) => app.querySelector(s);
  $('#copyMint').onclick = (e) => { copyText(coin.mint, e.currentTarget, ICON.check); toast('Mint address copied'); };
  $('#share').onclick = async () => {
    const url = location.href;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: `$${coin.ticker} on hookrz`, url }); return; } catch { /* closed */ } }
    await copyText(url); toast('Link copied');
  };

  // chart
  const ageH = hist.ageMs / 3.6e6;
  const tf0 = ageH <= 24 ? 'ALL' : '24H';
  const chart = mountChart($('#chart'), hist, {
    tf: tf0,
    onTf: (k, s) => {
      app.querySelectorAll('#tf button').forEach((b) => b.classList.toggle('on', b.dataset.tf === k));
      const c = (s.last / s.first - 1) * 100;
      $('#tfChg').textContent = pctS(c);
      $('#tfChg').className = `num ${c >= 0 ? 'up' : 'down'}`;
      $('#tfLbl').textContent = k === 'ALL' ? 'since launch' : `past ${k.toLowerCase().replace('h', ' hours').replace('1 hours', 'hour')}`;
      $('#tfPx').textContent = `· ${s.refused} refused in view`;
      const lg = app.querySelector('.lg-grad'); if (lg) lg.parentElement.style.display = s.grad ? '' : 'none';
    },
  });
  chart.setTf(tf0);
  $('#tf').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) chart.setTf(b.dataset.tf); });

  // the stack: live states
  const log = sim.withStack.log, lastT = sim.withStack.series.at(-1).t;
  const hourSoldPct = log.filter((e) => e.ok && e.kind === 'sell' && e.t > lastT - 3600).reduce((a, e) => a + e.amount, 0) / SUPPLY * 100;
  const stackP = mountStackPanel($('#stackP'), {
    coin,
    ctx: () => ({ coin, ageS: coin.minutesAgo * 60 + (Date.now() - loadedAt) / 1000, pos: pos(coin.ticker), hist, hourSoldPct }),
  });
  onPos((t) => { if (t === coin.ticker) stackP.tick(); });

  mountTicket($('#ticketP'), coin);
  mountFeed($('#feedP'), coin);
  renderLineage($('#linP'), coin, lineage, parent, children);
  renderHolders($('#holdP'), coin, holders);
  renderFees($('#feesP'), coin, parent, children);
}

function riskLine(b, s, coin) {
  if (b.id === 'lock-in') {
    const prog = coin.progress * 100;
    return prog < s.params.pct ? `Holders cannot sell until the curve is ${s.params.pct}% filled. It is ${prog.toFixed(1)}% filled now.` : `Sells opened when the curve passed ${s.params.pct}%.`;
  }
  if (b.power) return `The creator can block addresses from holding this coin. The list freezes ${s.params.lockAt}.`;
  return b.risk;
}

function statCells(c) {
  const grad = c.phase === 'graduated';
  const ref = c.checked ? (c.refused / c.checked) * 100 : 0;
  const ch = chg(c.change24);
  const raised = Math.min(GRAD_SOL, c.progress * GRAD_SOL);
  return `
    <div class="cs"><span class="k">Market cap</span><span class="v num">${usd(c.mcapUsd)}</span><span class="s num ${ch > 0.05 ? 'up' : ch < -0.05 ? 'down' : ''}">${pctS(ch)} 24h</span></div>
    <div class="cs"><span class="k">24h volume</span><span class="v num">${usd(c.vol24Usd)}</span><span class="s num">${sol(c.vol24Usd / SOL_USD)}</span></div>
    <div class="cs"><span class="k">Holders</span><span class="v num">${num(c.holders)}</span><span class="s">${grad ? 'wallets' : 'wallets on the curve'}</span></div>
    <div class="cs"><span class="k">Checked</span><span class="v num">${num(c.checked)}</span><span class="s">transfers, on chain</span></div>
    <div class="cs ref"><span class="k">Refused</span><span class="v num">${num(c.refused)}</span><span class="s num">${ref.toFixed(1)}% of transfers</span></div>
    <div class="cs curve">${grad
    ? `<span class="k">Graduated</span><span class="v cs-grad">Trading on Meteora DAMM v2</span><div class="cbar"><i style="width:100%"></i></div><span class="s">Curve filled at ${GRAD_SOL} SOL · hook retired</span>`
    : `<span class="k">Curve</span><span class="v num">${(c.progress * 100).toFixed(1)}%</span><div class="cbar ticks"><i style="width:${Math.max(1, c.progress * 100)}%"></i></div><span class="s num">${raised.toFixed(1)} / ${GRAD_SOL} SOL · graduates at ${GRAD_SOL} SOL</span>`}</div>`;
}

function renderLineage(el, coin, tree, parent, children) {
  const author = handleOf(coin);
  el.innerHTML = `
    <div class="ph"><h3>Remix lineage <span class="pk">${tree ? countNodes(tree) : 1} coins on this family of stacks</span></h3><a class="btn btn-glass btn-sm" href="stacks.html">All stacks</a></div>
    <div class="cn-lin-body">
      <p class="cn-roy">${cube('crown', { size: 26 })}<span><b>${esc(author)}</b> earns 10% of the trade fee on remixes of this stack, one level up.${parent ? ` This coin remixes <a href="coin.html?t=${encodeURIComponent(parent.ticker)}" class="mono">$${esc(parent.ticker)}</a>, so 10% of its fee goes to <b>${esc(handleOf(parent))}</b>.` : ' This is an original stack, so its creator keeps that 10% too.'}</span></p>
      ${tree ? lineageTree(tree, { current: coin.ticker }) : ''}
      <div class="cn-lin-cta">
        <span class="dim">${children.length ? `${children.length} coin${children.length > 1 ? 's' : ''} launched on this stack.` : 'Nobody has remixed this stack yet.'} Remixing copies every block and param; change what you want and launch.</span>
        <a class="btn btn-chrome btn-sm" href="build.html?remix=${encodeURIComponent(coin.ticker)}">${ICON.remix}Remix $${esc(coin.ticker)}</a>
      </div>
    </div>`;
}
const countNodes = (n) => 1 + n.children.reduce((a, c) => a + countNodes(c), 0);

function renderHolders(el, coin, holdersIn) {
  const holders = [...holdersIn].sort((a, b) => b.share - a.share).slice(0, 10);
  const max = Math.max(...holders.map((h) => h.share));
  const p = pos(coin.ticker);
  const crown = coin.stack.some((s) => s.id === 'diamond-tiers');
  el.innerHTML = `
    <div class="ph"><h3>Top holders <span class="pk">${coin.phase === 'graduated' ? 'DAMM v2 pool excluded' : 'curve vault excluded'}</span></h3></div>
    <table class="table cn-ht">
      <thead><tr><th>#</th><th>Wallet</th><th>Share</th></tr></thead>
      <tbody>${holders.map((h, i) => `<tr>
        <td class="num dim">${i + 1}</td>
        <td class="cn-hw"><span class="mono">${shortKey(h.wallet)}</span>${h.tier === 'crown' ? `<span class="chip ice cn-crown" data-tip="${crown ? 'Diamond Tiers crown: this wallet has never sold' : 'Crown tier: this wallet has never sold'}">${EMBLEM.crown}Crown</span>` : ''}</td>
        <td><span class="cn-share"><span class="cn-sbar"><i style="width:${(h.share / max) * 100}%"></i></span><span class="num">${(h.share * 100).toFixed(2)}%</span></span></td>
      </tr>`).join('')}
      ${p.tokens > 0 ? `<tr class="you"><td class="num">—</td><td><span class="chip solid">You</span></td><td><span class="cn-share"><span class="cn-sbar"><i style="width:${Math.min(100, (p.tokens / SUPPLY / max) * 100)}%"></i></span><span class="num">${(p.tokens / SUPPLY * 100).toFixed(3)}%</span></span></td></tr>` : ''}
      </tbody>
    </table>`;
}

function renderFees(el, coin, parent, children) {
  const fee24 = coin.vol24Usd * FEES.tradeFeePct / 100;
  const share = (who) => FEES.split.find((s) => s.who === who).pct / 100;
  const creatorPct = share('Creator') + (parent ? 0 : share('Stack author'));
  const royaltyIn = children.reduce((a, c) => a + c.vol24Usd * FEES.tradeFeePct / 100 * share('Stack author'), 0);
  const line = (k, usdV, note = '', cls = '') => `<div class="fe-row ${cls}"><span class="fe-k">${k}${note ? `<small>${note}</small>` : ''}</span><span class="fe-v num">${sol(usdV / SOL_USD)}<small>${usd(usdV)}</small></span></div>`;
  el.innerHTML = `
    <div class="ph"><h3>Fees <span class="pk">last 24h</span></h3><span class="dim num fe-tot">${sol(fee24 / SOL_USD)} in fees</span></div>
    <div class="fe-body">
      <div class="fe-split">${FEES.split.map((s) => `<span class="fe-seg ${s.who === 'Stack author' ? 'auth' : s.who === 'Creator' ? 'cr' : 'pl'}" style="flex:${s.pct}" data-tip="${esc(s.who)}: ${esc(s.note)}"><b>${s.pct}%</b></span>`).join('')}</div>
      <div class="fe-leg"><span><i class="cr"></i>Creator</span><span><i class="pl"></i>hookrz</span><span><i class="auth"></i>${parent ? `Stack author ${esc(handleOf(parent))}` : 'Stack author (the creator, on an original)'}</span></div>
      <p class="fe-note dim">Every trade pays a ${FEES.tradeFeePct}% fee, split three ways.</p>
      ${line(`Creator ${esc(handleOf(coin))}`, fee24 * creatorPct, `${Math.round(creatorPct * 100)}% of the fee${parent ? '' : ', royalty included'}`, 'hi')}
      ${parent ? line(`Royalty to ${esc(handleOf(parent))}`, fee24 * share('Stack author'), `author of $${esc(parent.ticker)}'s stack`) : ''}
      ${line('hookrz', fee24 * share('hookrz'), 'engine audits, keeper gas, API')}
      ${line('Royalties in from remixes', royaltyIn, children.length ? `${children.length} remix${children.length > 1 ? 'es' : ''} pay ${esc(handleOf(coin))} 10% of their fee` : 'no remixes yet', royaltyIn ? 'in' : '')}
    </div>`;
}

async function notFound() {
  document.title = 'Coin not found · hookrz';
  const all = await api.coins({ sort: 'volume' });
  app.innerHTML = `<section class="cn-nf"><div class="wrap">
    <div class="panel cn-nf-box">
      <div class="cn-nf-cubes">${cube('x', { size: 40, state: 'empty' })}${cube('guard', { size: 40 })}${cube('x', { size: 40, state: 'empty' })}</div>
      <span class="eyebrow">No coin at this ticker</span>
      <h1 class="cn-nf-h">$${esc(T)} hasn't launched</h1>
      <p class="lede">Nothing on hookrz trades under $${esc(T)}. It may use a different ticker, or it's yours to build.</p>
      <div class="row wrap-row" style="justify-content:center"><a class="btn btn-chrome" href="build.html">Build $${esc(T)}</a><a class="btn btn-glass" href="coins.html">Browse coins</a></div>
      <div class="cn-nf-list"><span class="pk">Trading now</span>${all.slice(0, 6).map((c) => `<a href="coin.html?t=${encodeURIComponent(c.ticker)}">${avatar(c, 26)}<span class="mono">$${esc(c.ticker)}</span><span class="dim num">${usd(c.mcapUsd)}</span></a>`).join('')}</div>
    </div>
  </div></section>`;
}
