// hookrz.fun — home. Hero with the live rack, the engine, block families, how a transfer gets hooked,
// remix lineage, the fee split and trending coins. All data comes through src/api/client.js.
import '../styles/base.css';
import '../styles/home.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG } from '../ui/voxel.js';
import { cube, ICON } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { usd, pctS, esc } from '../core/format.js';
import { FAMILIES, ENFORCERS, ENGINE, BLOCKS, byId } from '../data/blocks.js';
import { api, diffStacks } from '../api/client.js';
import { FEES } from '../api/contract.js';
import { mountRack } from '../ui/home-rack.js';
import { mountFlow } from '../ui/home-flow.js';
import { mountLineage } from '../ui/home-lineage.js';

mountChrome('');

const ARROW = ICON.arrow;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const sol = (n) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)} SOL`;
const ENF_ORDER = ['hook', 'curve', 'crank', 'ext'];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const app = document.getElementById('app');
app.classList.add('home');
app.innerHTML = `
<section class="hero">
  <div class="wrap">
    <span class="eyebrow rv">Transfer-hook launchpad on Solana</span>
    <h1 class="hero-title rv" style="--d:60ms"><span class="sr">Build. Remix. Own.</span>
      <span class="vx-one" aria-hidden="true">${vx('BUILD. REMIX. OWN.')}</span>
      <span class="vx-three" aria-hidden="true">${['BUILD.', 'REMIX.', 'OWN.'].map((w) => `<span>${vx(w)}</span>`).join('')}</span>
    </h1>
    <div class="hero-grid">
      <div class="hero-copy">
        <div class="hero-lead">
        <p class="lede rv" style="--d:120ms">Build a coin from rule blocks. Solana runs your stack on every transfer, so a trade that breaks a rule never lands. Remix any coin's stack in one click, and earn every time someone remixes yours.</p>
        <div class="hero-ctas rv" style="--d:180ms">
          <a class="btn btn-chrome btn-lg" href="build.html">Build a coin ${ARROW}</a>
          <a class="btn btn-glass btn-lg" href="stacks.html">Browse stacks</a>
        </div>
        </div>
        <ul class="hero-facts rv" style="--d:240ms">
          <li><i class="hf"></i><span><b>Refused on chain.</b> Hook blocks run inside Token-2022 on every transfer, on every route.</span></li>
          <li><i class="hf"></i><span><b>Armed before the first trade.</b> Mint, curve and stack launch in one transaction.</span></li>
          <li><i class="hf"></i><span><b>No keys.</b> The engine can only refuse a transfer. It never moves funds.</span></li>
        </ul>
      </div>
      <div class="hero-rack-wrap rv" style="--d:140ms">
        <div class="rack px" id="rack"><div class="rack-skel"></div></div>
        <div class="rack-floor" aria-hidden="true"></div>
      </div>
    </div>
    <div class="stats-strip px rv" id="stats" style="--d:200ms">
      ${[['coins', 'Coins launched'], ['checked', 'Transfers checked'], ['refused', 'Refused'], ['remixes', 'Remixes']].map(([k, l]) => `
      <div class="stat"><span class="stat-k pixel">${l}</span><b class="num" data-s="${k}">&nbsp;</b><span class="stat-sub" data-sub="${k}">&nbsp;</span></div>`).join('')}
    </div>
  </div>
</section>

<section class="section engine" id="engine">
  <div class="wrap engine-grid">
    <figure class="engine-art">
      <img class="rv" src="img/brand/engine-rack.webp" srcset="img/brand/engine-rack-900.webp 900w, img/brand/engine-rack.webp 1672w" sizes="(max-width: 1020px) 100vw, 760px" alt="The hookrz engine: six block slots on one cable" width="1672" height="941" decoding="async">
      <figcaption class="engine-vs rv">
        <div class="vs-row old">
          <span class="vs-k pixel">One program, one rule</span>
          <span class="vs-cubes">${cube('guard', { size: 24 })}${cube('x', { size: 24, state: 'empty' }).repeat(ENGINE.maxSlots - 1)}</span>
          <span class="vs-t">A mint names one hook program, so a coin usually gets one rule.</span>
        </div>
        <div class="vs-row">
          <span class="vs-k pixel">hookrz_engine</span>
          <span class="vs-cubes">${FAMILIES.map((f) => cube(f.id, { size: 24, state: 'lit' })).join('')}</span>
          <span class="vs-t">Every coin names the same engine. It runs a stack of up to ${ENGINE.maxSlots} blocks.</span>
        </div>
      </figcaption>
    </figure>
    <div class="engine-copy">
      <div class="section-head rv">
        <span class="eyebrow">The engine</span>
        <h2>One engine.<br><span class="chrome-text">A whole stack.</span></h2>
        <p class="lede">A Token-2022 mint can point at exactly one transfer-hook program. So a coin usually gets one rule, or a program written just for it. hookrz points every coin at one audited engine, <span class="mono">hookrz_engine</span>, that reads the coin's stack and runs up to ${ENGINE.maxSlots} blocks in slot order on every transfer.</p>
      </div>
      <div class="engine-stats rv">
        <div class="nr"><b class="num">${ENGINE.maxSlots}</b><span class="pixel">Slots per stack</span></div>
        <div class="nr"><b class="num">${ENGINE.cuBudget.toLocaleString('en-US')}</b><span class="pixel">CU per transfer</span></div>
        <div class="nr"><b class="num">0</b><span class="pixel">Keys held</span></div>
      </div>
      <ul class="enforcers rv">
        ${ENF_ORDER.map((k) => `<li><span class="enf ${k}"><i></i>${ENFORCERS[k].name}</span><span>${ENFORCERS[k].long}</span><span class="mono dim">${plural(BLOCKS.filter((b) => b.enforcedBy === k).length, 'block')}</span></li>`).join('')}
      </ul>
    </div>
  </div>
</section>

<section class="section families" id="families">
  <div class="wrap">
    <div class="section-head rv">
      <span class="eyebrow">The blocks</span>
      <h2>Six families. <span class="chrome-text">${BLOCKS.length} blocks.</span></h2>
      <p class="lede">Each block is one rule with bounded settings you tune. Snap up to ${ENGINE.maxSlots} into a stack. The engine checks the blocks that refuse; the curve and the public keeper run the rest.</p>
    </div>
    <div class="fam-grid">${FAMILIES.map(famCard).join('')}</div>
  </div>
</section>

<section class="section how" id="how">
  <div class="wrap">
    <div class="how-head">
      <div class="section-head rv">
        <span class="eyebrow">Under the hood</span>
        <h2>How a transfer <span class="chrome-text">gets hooked.</span></h2>
        <p class="lede">Every transfer of a hookrz coin goes through Token-2022, which calls the engine before a single token moves. Pick a trade and watch a six-block stack decide it.</p>
      </div>
      <img class="how-art rv" src="img/brand/hero-hook-stack.webp" srcset="img/brand/hero-hook-stack-900.webp 900w, img/brand/hero-hook-stack.webp 1672w" sizes="(max-width: 1020px) 100vw, 820px" alt="" width="1672" height="941" loading="lazy" decoding="async">
    </div>
    <div class="flow px rv" id="flow"></div>
  </div>
</section>

<section class="section remix" id="remix">
  <div class="wrap">
    <div class="remix-top">
      <div class="section-head rv">
        <span class="eyebrow">Remix</span>
        <h2>Fork any stack <span class="chrome-text">in one click.</span></h2>
        <p class="lede">Every stack is public. Open a coin, hit Remix, tune a block or swap one out, and launch. The new coin keeps a parent link, so its lineage is on chain and the royalty knows where to go.</p>
        <div><a class="btn btn-chrome btn-lg" href="stacks.html">Remix a stack ${ARROW}</a></div>
      </div>
      <img class="remix-art rv" src="img/brand/remix-tree.webp" srcset="img/brand/remix-tree-900.webp 900w, img/brand/remix-tree.webp 1672w" sizes="(max-width: 1020px) 100vw, 640px" alt="One stack of blocks branching into three remixes" width="1672" height="941" loading="lazy" decoding="async">
    </div>
    <div class="lineage px rv" id="lineage"><div class="lin-head"><span class="pixel">Lineage</span><span class="lin-title"></span></div><div class="lin-body"></div></div>
  </div>
</section>

<section class="section own" id="own">
  <div class="wrap">
    <div class="own-head">
      <div class="section-head rv">
        <span class="eyebrow">Own</span>
        <h2>Get paid when <span class="chrome-text">your stack travels.</span></h2>
        <p class="lede">Every trade on the curve pays a ${FEES.tradeFeePct}% fee. Half goes to the coin's creator. When someone remixes your stack, you earn a tenth of the fee on every trade of their coin.</p>
      </div>
      <div class="own-example rv" id="ownEx"></div>
    </div>
    <div class="fee px rv" id="fee">
      <div class="fee-main">
        <div class="fee-head"><span class="pixel">The ${FEES.tradeFeePct}% trade fee</span><span class="pixel dim">1 cube = 1% of the fee</span></div>
        <div class="fee-cells" role="img" aria-label="${FEES.split.map((s) => `${s.who} ${s.pct}%`).join(', ')}">${feeCells()}</div>
        <div class="fee-legend">${FEES.split.map((s, i) => `
          <div class="fl fl-${i}"><span class="fl-sw"></span><b class="num">${s.pct}%</b><span class="fl-who">${s.who}</span><p>${esc(s.note)}</p></div>`).join('')}
        </div>
      </div>
      <div class="fee-ex" id="feeEx"></div>
    </div>
  </div>
</section>

<section class="section trending" id="trending">
  <div class="wrap">
    <div class="trend-head rv">
      <div class="section-head"><span class="eyebrow">Trending</span><h2>Moving now.</h2></div>
      <a class="btn btn-glass" href="coins.html">All coins ${ARROW}</a>
    </div>
    <div class="coin-grid" id="trend">${'<div class="coin-card skel"></div>'.repeat(6)}</div>
  </div>
</section>

<section class="section cta-band">
  <div class="wrap">
    <div class="cta px rv">
      <img class="cta-art" src="img/banner-build-remix-own.webp" srcset="img/banner-build-remix-own-1000.webp 1000w, img/banner-build-remix-own.webp 2000w" sizes="(max-width: 1240px) 100vw, 1160px" alt="BUILD. REMIX. OWN.: chrome blocks in a rack, branching into remixes" width="2000" height="667" loading="lazy" decoding="async">
      <div class="cta-body">
        <div>
          <h2>Snap the blocks.<br><span class="chrome-text">Launch in one transaction.</span></h2>
          <p class="lede">Mint, curve, stack and your first buy land together, so nobody trades before the rules are armed. Launching costs <span class="mono">${FEES.launchCostSol} SOL</span>.</p>
        </div>
        <div class="cta-btns"><a class="btn btn-chrome btn-lg" href="build.html">Build a coin ${ARROW}</a><a class="btn btn-glass btn-lg" href="build.html#presets">Start from a preset</a></div>
      </div>
    </div>
  </div>
</section>`;

reveal();
mountFlow(document.getElementById('flow'));
load().catch(() => {
  // the API is unreachable: keep the static page, say so where live data would be
  document.getElementById('rack').innerHTML = '<p class="rack-down">The live feed is reconnecting. Refresh in a moment.</p>';
  document.getElementById('trend').innerHTML = '';
});

async function load() {
  const [coins, stackSrc, stacks, lineage] = await Promise.all([api.coins({ sort: 'volume' }), api.coin('STACK'), api.stacks(), api.lineage('STACK')]);

  // stats strip
  const S = {
    coins: coins.length, checked: coins.reduce((a, c) => a + c.checked, 0),
    refused: coins.reduce((a, c) => a + c.refused, 0), remixes: coins.filter((c) => c.parent).length,
  };
  const set = (k, v, sub) => { document.querySelector(`[data-s="${k}"]`).textContent = fmt(v); if (sub != null) document.querySelector(`[data-sub="${k}"]`).textContent = sub; };
  const subs = () => ({
    coins: `${coins.filter((c) => c.phase === 'graduated').length} graduated to DAMM v2`,
    checked: 'by hookrz_engine, live',
    refused: `${((S.refused / S.checked) * 100).toFixed(1)}% of transfers`,
    remixes: `from ${new Set(coins.filter((c) => c.parent).map((c) => c.parent)).size} parent stacks`,
  });
  Object.entries(subs()).forEach(([k, s]) => set(k, S[k], s));

  // hero rack: the $STACK stack, streaming from the newest coin on the curve that runs it unchanged
  // (a graduated coin's hook is retired, so the live feed comes from a coin still on its curve)
  const twins = coins.filter((c) => c.phase === 'curve' && (c.ticker === stackSrc.ticker || c.parent === stackSrc.ticker))
    .filter((c) => { const d = diffStacks(stackSrc.stack, c.stack); return !d.added.length && !d.removed.length && !d.tuned.length; })
    .sort((a, b) => a.minutesAgo - b.minutesAgo);
  const live = stackSrc.phase === 'curve' ? stackSrc : twins[0] ?? stackSrc;
  mountRack(document.getElementById('rack'), {
    live, source: stackSrc,
    onVerdict: (ev) => {
      S.checked++; if (!ev.ok) S.refused++;
      set('checked', S.checked); set('refused', S.refused, subs().refused);
    },
  });

  // remix lineage
  const lin = document.getElementById('lineage');
  const count = (n) => n.children.reduce((a, c) => a + 1 + count(c), 0);
  lin.querySelector('.lin-title').innerHTML = `<b>${esc(lineage.coin.name)}</b> <span class="dim">· $${esc(lineage.coin.ticker)} by ${esc(lineage.coin.creatorInfo?.handle ?? lineage.coin.creator)} ·</span> <span class="num">${count(lineage)}</span> <span class="dim">remixes</span>`;
  mountLineage(lin.querySelector('.lin-body'), lineage);

  // own: the top stack's royalties and a worked fee example from its busiest remix
  const top = stacks[0];
  const kid = coins.filter((c) => c.parent === top.ticker).sort((a, b) => b.vol24Usd - a.vol24Usd)[0];
  const share = (who) => FEES.split.find((s) => s.who === who)?.pct ?? 0;
  const fee = kid ? (kid.vol24Usd * FEES.tradeFeePct) / 100 : 0;
  document.getElementById('ownEx').innerHTML = `
    <a class="own-top nr" href="coin.html?t=${esc(top.ticker)}">
      ${avatar(top, 52)}
      <div class="own-id"><span class="pixel dim">Top stack</span><b>${esc(top.name)}</b><small>$${esc(top.ticker)} · by ${esc(top.creatorInfo?.handle ?? top.creator)}</small></div>
      <div class="own-n"><b class="num">${top.remixCount}</b><span class="pixel">Remixes</span></div>
      <div class="own-n"><b class="num ice">${sol(top.royaltiesSol)}</b><span class="pixel">Royalties · 24h</span></div>
    </a>
    <p class="own-note">Royalties go one level up: a remix of a remix pays the stack it forked, not the original.</p>`;
  document.getElementById('feeEx').innerHTML = kid ? `
      <span class="pixel fee-ex-k">Worked example · last 24h</span>
      <p><a class="mono" href="coin.html?t=${esc(kid.ticker)}">$${esc(kid.ticker)}</a> remixed ${esc(top.name)} and traded <b class="num">${usd(kid.vol24Usd)}</b>. Its <b class="num">${usd(fee)}</b> in fees split three ways:</p>
      <ul>
        <li><span class="sw s0"></span><span>${esc(kid.creatorInfo?.handle ?? kid.creator)}<small>creator of $${esc(kid.ticker)}</small></span><b class="num">${usd((fee * share('Creator')) / 100)}</b></li>
        <li><span class="sw s1"></span><span>hookrz<small>engine, keeper, API</small></span><b class="num">${usd((fee * share('hookrz')) / 100)}</b></li>
        <li><span class="sw s2"></span><span>${esc(top.creatorInfo?.handle ?? top.creator)}<small>author of the stack it remixed</small></span><b class="num ice">${usd((fee * share('Stack author')) / 100)}</b></li>
      </ul>` : '';

  // trending
  document.getElementById('trend').innerHTML = coins.slice(0, 6).map(coinCard).join('');
  reveal(document.getElementById('trend'));
}

/** Voxel display line plus a faces-only copy that a moving mask sweeps across: a chrome glint. */
function vx(text) {
  const svg = voxelSVG(text, { cell: 12, gap: 1.6, glow: true, title: '' });
  const vb = /viewBox="([^"]+)"/.exec(svg)[1];
  const faces = (svg.match(/<rect [^>]*\/>/g) ?? []).map((r) => r.replace(/fill="[^"]*"/, 'fill="#fff"').replace(/ style="[^"]*"/, '')).join('');
  return `<span class="vx-g">${svg}<span class="vx-glint"><svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><g fill-opacity=".85">${faces}</g></svg></span></span>`;
}

function famCard(f, i) {
  const list = BLOCKS.filter((b) => b.family === f.id);
  return `<a class="fam nr rv" style="--d:${(i % 3) * 70}ms" href="blocks.html#${f.id}">
    <div class="fam-top">
      <img src="img/brand/block-${f.id}-sm.webp" alt="" width="240" height="240" loading="lazy" decoding="async">
      <div class="fam-id"><span class="pixel">${esc(f.verb)}</span><h3>${esc(f.name)}</h3><span class="mono dim">${plural(list.length, 'block')}</span></div>
    </div>
    <p>${esc(f.blurb)}</p>
    <ul class="fam-list">${list.map((b) => `<li><span class="enf ${b.enforcedBy}" title="${esc(ENFORCERS[b.enforcedBy].long)}"><i></i></span>${esc(b.name)}</li>`).join('')}</ul>
    <span class="fam-go">Open ${esc(f.name)} ${ARROW}</span>
  </a>`;
}

function feeCells() {
  // 20 columns x 5 rows = 100 cells; columns are filled share by share
  const cols = [];
  FEES.split.forEach((s, i) => { for (let c = 0; c < s.pct / 5; c++) cols.push(i); });
  return cols.map((g, c) => `<span class="fc-col g${g}" style="--c:${c}">${'<i></i>'.repeat(5)}</span>`).join('');
}

function coinCard(c, i) {
  const grad = c.phase === 'graduated';
  const ch = Math.max(-99.9, c.change24);
  return `<a class="coin nr rv" style="--d:${(i % 3) * 70}ms" href="coin.html?t=${esc(c.ticker)}">
    <div class="coin-top">${avatar(c, 48)}
      <div class="coin-id"><b>${esc(c.name)}</b><span class="mono">$${esc(c.ticker)}</span></div>
      <span class="coin-chg num ${ch >= 0 ? 'up' : 'down'}">${pctS(ch)}</span></div>
    <div class="coin-nums">
      <div><span class="pixel">Market cap</span><b class="num">${usd(c.mcapUsd)}</b></div>
      <div><span class="pixel">Vol 24h</span><b class="num">${usd(c.vol24Usd)}</b></div>
      <div><span class="pixel">Holders</span><b class="num">${fmt(c.holders)}</b></div>
    </div>
    <div class="coin-curve${grad ? ' grad' : ''}"><div class="bar"><i style="width:${Math.max(2, c.progress * 100).toFixed(1)}%"></i></div>
      <span class="pixel">${grad ? 'Graduated · DAMM v2' : `Curve ${Math.round(c.progress * 100)}%`}</span></div>
    <div class="coin-foot">
      <span class="coin-stack" title="${c.stack.length} blocks">${c.stack.map((s) => cube(familyOfBlock(s.id), { size: 22 })).join('')}</span>
      ${c.parent ? `<span class="chip ice">${ICON.remix}Remix of $${esc(c.parent)}</span>` : `<span class="chip">Original</span>`}
    </div>
  </a>`;
}

function familyOfBlock(id) { return byId[id]?.family ?? 'custom'; }

/** Reveal-on-scroll. Content stays visible for reduced motion, automation and crawlers. */
let io;
function reveal(root = document) {
  const els = [...root.querySelectorAll('.rv:not(.in)')];
  if (root !== document && root.classList?.contains('rv')) els.push(root);
  const skip = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.webdriver || !('IntersectionObserver' in window);
  if (skip) {
    els.forEach((e) => e.classList.add('in'));
    if (navigator.webdriver) document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
    return;
  }
  document.documentElement.classList.add('rv-on');
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  els.forEach((e) => io.observe(e));
}

