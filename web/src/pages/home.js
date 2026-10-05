// hookrz.fun — home. Benefit first: say your rule in plain English (drafted and checked live), rule ideas you can
// watch play out against the real rule (src/ui/rule-play.js) and launch as they are, the five rulebooks, coins, and
// the brand line. The engine, the transfer path and the fee details
// live in Docs. All data comes through src/api/client.js.
import '../styles/base.css';
import '../styles/home.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG } from '../ui/voxel.js';
import { pixelIcon, hookMark } from '../ui/pixel.js';
import { ICON } from '../ui/icons.js';
import { avatar } from '../ui/avatar.js';
import { usd, pctS, esc } from '../core/format.js';
import { PRESETS, byId } from '../data/blocks.js';
import { api } from '../api/client.js';
import { EXAMPLES } from '../hookscript/examples.js';
import { IDEAS, glyph } from '../ui/home-ideas.js';
import { mountRuleCard, cardHTML } from '../ui/home-rule.js';
import { mountRulePlay, hasPlay } from '../ui/rule-play.js';

mountChrome('');

const ARROW = ICON.arrow;
const icon = (name, size = 24, o = {}) => pixelIcon(name, { size, color: '#dfe7f2', ...o });

// hero example chips, from the rules the drafter knows by heart (src/hookscript/examples.js)
const ex = (label) => EXAMPLES.find((e) => e.label === label)?.text ?? '';
const CHIPS = [
  ['No sell over 25% in 2h', ex('Quarter bag')],
  ['King of the Hill', ex('King of the Hill')],
  ['Invite only', ex('Invite only')],
  ['Louder opening', ex('Louder')],
].filter(([, t]) => t);

// rulebooks in plain words (the preset blurbs, with two made plainer)
const OUTCOME = {
  club: 'Only holders of a coin you pick can buy in.',
  market: 'Trades like a stock: market hours and a crash breaker.',
};
const famsOf = (p) => [...new Set(p.slots.flat().map((id) => byId[id]?.family).filter(Boolean))];

// "Watch it play": the ideas with a tab on home (each plays a short scene through its real script)
const FEATURED = ['king-of-the-hill', 'tag', 'hot-potato', 'jackpot', 'fomo'];
const PLAY = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 1h2v1h2v1h2v1h2v4H8v1H6v1H4v1H2z" fill="currentColor"/></svg>';

const STEPS = [
  [glyph('custom', { size: 28 }), 'Pick your rules', 'Choose a rulebook, or describe your own rule in plain English.'],
  [glyph('coin', { size: 28 }), 'Name your coin', 'Name, ticker and image. Add a first buy if you like.'],
  [glyph('check', { size: 28 }), 'Launch in one transaction', 'Coin, curve and rules go live together, so nobody trades before the rules are on.'],
];

const SAFE = [
  ['guard', 'The chain enforces every rule'],
  ['lock', 'Rules can only refuse a trade, never move funds'],
  ['check', 'hookrz never holds your keys'],
];

const BRAND = [
  ['BUILD.', 'Pick a rulebook or write your own rule.'],
  ['REMIX.', 'Reuse any coin’s rules in one click.'],
  ['OWN.', 'Your coin, your rules, enforced on chain.'],
];

const app = document.getElementById('app');
app.classList.add('home');
app.innerHTML = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <h1 class="hero-h">Launch a coin snipers can’t snipe and <span class="chrome-text">whales can’t dump.</span></h1>
      <p class="hero-sub">Pick a rulebook or say your own rule in plain English. Solana refuses every trade that breaks it, from the first block.</p>
      <form class="ask" id="ask" action="build.html" method="get" autocomplete="off">
        <label class="sr" for="askIn">Describe your coin’s rule</label>
        <div class="ask-box">
          <span class="ask-ic" aria-hidden="true">${icon('custom', 22)}</span>
          <textarea id="askIn" name="rule" rows="1" maxlength="280" placeholder="Describe your coin’s rule…" spellcheck="false"></textarea>
          <button class="btn btn-chrome btn-lg ask-go" type="submit">Build it ${ARROW}</button>
        </div>
        <div class="ask-chips" role="group" aria-label="Example rules">
          <span class="pixel ask-try">Try</span>
          ${CHIPS.map(([l, t], i) => `<button type="button" class="ask-chip${i ? '' : ' on'}" data-ex="${esc(t)}">${esc(l)}</button>`).join('')}
        </div>
      </form>
      <a class="ask-alt" href="build.html#presets">or pick a ready-made rulebook ${ARROW}</a>
    </div>
    <div class="hero-art">
      <div class="hang" aria-hidden="true"><i class="hang-line"></i>${hookMark(150)}</div>
      <div class="rcard px" id="rcard" aria-live="polite">${cardHTML()}</div>
    </div>
  </div>
  <div class="wrap">
    <ul class="safe" aria-label="Why it’s safe">
      ${SAFE.map(([i, t]) => `<li>${icon(i, 16)}<span>${t}</span></li>`).join('')}
    </ul>
  </div>
</section>

<section class="section steps-sec">
  <div class="wrap">
    <ol class="steps">
      ${STEPS.map(([ic, h, p], i) => `<li class="step tile sf">
        <span class="step-n" aria-hidden="true">${voxelSVG(String(i + 1), { cell: 6, gap: 0.8, glow: false, title: '' })}</span>
        <span class="step-ic">${ic}</span>
        <div><h3>${h}</h3><p>${p}</p></div>
      </li>`).join('')}
    </ol>
  </div>
</section>

<section class="section ideas" id="ideas">
  <div class="wrap">
    <div class="ideas-head">
      <div class="section-head sf">
        <span class="eyebrow">Rule ideas</span>
        <h2>Coins that play by <span class="chrome-text">their own rules.</span></h2>
        <p class="lede">Watch one play out. Every trade runs through the real rule, so each “Blocked” is what the chain would say. Every idea is tested so holders can always sell.</p>
      </div>
      <a class="ask-alt own-link sf" href="#ask" id="ownLink">${glyph('custom', { size: 16 })}Or write your own rule</a>
    </div>
    <div class="ideas-play">
      <div class="ideas-stage" id="rulePlay"></div>
      <div class="ideas-list">
        <span class="il-k pixel">Launch one as it is</span>
        <div class="idea-grid" id="ideaGrid">
          ${IDEAS.map((d) => `<div class="idea tile">
            <a class="idea-go" href="build.html?idea=${encodeURIComponent(d.id)}">
              <span class="idea-ic">${glyph(d.icon, { size: 22 })}</span>
              <span class="idea-tx"><b>${esc(d.name)}</b><span>${esc(d.short)}</span></span>
            </a>
            ${hasPlay(d.id) ? `<button type="button" class="idea-watch" data-watch="${esc(d.id)}" aria-label="Watch ${esc(d.name)} play" title="Watch it play">${PLAY}</button>` : ''}
          </div>`).join('')}
        </div>
        <button type="button" class="btn btn-glass idea-more" id="ideaMore">See all ${IDEAS.length} rule ideas</button>
      </div>
    </div>
  </div>
</section>

<section class="section books" id="rulebooks">
  <div class="wrap">
    <div class="section-head sf">
      <span class="eyebrow">Rulebooks</span>
      <h2>Or start from a rulebook.</h2>
    </div>
    <div class="book-grid">
      ${PRESETS.map((p) => `<a class="book tile sf" href="build.html?preset=${encodeURIComponent(p.id)}">
        <span class="book-ics">${famsOf(p).map((f) => icon(f, 22)).join('')}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(OUTCOME[p.id] ?? p.blurb)}</p>
        <span class="book-go">Launch with this ${ARROW}</span>
      </a>`).join('')}
    </div>
  </div>
</section>

<section class="section coins-sec" id="coins">
  <div class="wrap"><div id="trend" class="trend-skel" aria-busy="true"></div></div>
</section>

<section class="section brand-sec">
  <div class="wrap">
    <div class="brand-band px sf">
      <div class="brand-words">
        ${BRAND.map(([w, t]) => `<div class="bw"><span class="bw-vx">${vx(w)}</span><p>${t}</p></div>`).join('')}
      </div>
    </div>
  </div>
</section>`;

// ───────── hero: the rule input and its live card ─────────
const form = document.getElementById('ask');
const input = document.getElementById('askIn');
const chips = [...form.querySelectorAll('.ask-chip')];
const fit = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
const mark = (text) => chips.forEach((c) => c.classList.toggle('on', c.dataset.ex === text));
const card = mountRuleCard(document.getElementById('rcard'), { fill: (t) => { input.value = t; fit(); mark(t); } });

let typing, typer;
input.addEventListener('input', () => {
  clearInterval(typer);
  fit();
  mark(input.value.trim());
  clearTimeout(typing);
  const t = input.value.trim();
  typing = setTimeout(() => { if (!t || t.length >= 8) card.run(t || ''); }, 650);
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
input.addEventListener('focus', card.warm, { once: true });
form.addEventListener('pointerenter', card.warm, { once: true });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = input.value.trim();
  if (!t) { input.focus(); form.classList.remove('nudge'); void form.offsetWidth; form.classList.add('nudge'); return; }
  location.href = `build.html?rule=${encodeURIComponent(t)}`;
});
chips.forEach((c) => c.addEventListener('click', () => {
  clearTimeout(typing);
  type(c.dataset.ex);
  mark(c.dataset.ex);
  card.run(c.dataset.ex);
}));
addEventListener('resize', fit);

/** Fill the input like someone typing it (instant when motion is reduced). */
function type(text) {
  clearInterval(typer);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { input.value = text; fit(); return; }
  let i = 0;
  const step = Math.max(2, Math.ceil(text.length / 28));
  typer = setInterval(() => {
    i = Math.min(text.length, i + step);
    input.value = text.slice(0, i);
    fit();
    if (i >= text.length) clearInterval(typer);
  }, 16);
}

document.getElementById('ownLink').onclick = (e) => {
  e.preventDefault();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  setTimeout(() => input.focus({ preventScroll: true }), reduce ? 0 : 450);
};
document.getElementById('ideaMore').onclick = (e) => { e.currentTarget.previousElementSibling.classList.add('all'); };

// ───────── rule ideas: watch one play out against its real script ─────────
const stage = document.getElementById('rulePlay');
const rows = Object.fromEntries([...document.querySelectorAll('#ideaGrid [data-watch]')].map((b) => [b.dataset.watch, b.closest('.idea')]));
const player = mountRulePlay(stage, {
  ids: FEATURED, label: 'Watch it play',
  onShow: (id) => { for (const [k, r] of Object.entries(rows)) { r.classList.toggle('on', k === id); r.querySelector('[data-watch]').setAttribute('aria-pressed', String(k === id)); } },
});
document.getElementById('ideaGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-watch]');
  if (!b || !player) return;
  player.show(b.dataset.watch);
  const r = stage.getBoundingClientRect();
  if (r.top < 64 || r.top > innerHeight * 0.5) scrollTo({ top: scrollY + r.top - 84, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

// ───────── coins ─────────
loadCoins();

/** Coins launched on hookrz, test coins left out. With none yet, the board says so. */
async function loadCoins() {
  const el = document.getElementById('trend');
  const coins = (await api.coins({ sort: 'volume' }).catch(() => [])).filter((c) => !c.test);
  el.classList.remove('trend-skel');
  el.removeAttribute('aria-busy');
  if (!coins.length) {
    el.innerHTML = `
    <div class="empty sf">
      <span class="empty-art" aria-hidden="true">${hookMark(64)}</span>
      <div class="empty-copy">
        <span class="eyebrow">Coins</span>
        <h2>No coins yet.</h2>
        <p class="lede">The first coin launched on hookrz leads this board.</p>
      </div>
      <a class="btn btn-chrome btn-lg" href="build.html">Launch the first coin ${ARROW}</a>
    </div>`;
    return;
  }
  const shown = coins.slice(0, 3);
  el.innerHTML = `
    <div class="trend-head sf">
      <div class="section-head"><span class="eyebrow">Coins</span><h2>Trending now.</h2></div>
      <a class="btn btn-glass" href="coins.html">All coins ${ARROW}</a>
    </div>
    <div class="coin-grid">${shown.map(coinCard).join('')}${shown.length < 3 ? `<a class="coin coin-next sf" href="build.html">${hookMark(44)}<b>Launch the next one</b><span class="dim">With a rule idea, a rulebook or your own rule.</span><span class="book-go">Launch a coin ${ARROW}</span></a>` : ''}</div>`;
}

function coinCard(c) {
  const grad = c.phase === 'graduated';
  const ch = Math.max(-99.9, c.change24 ?? 0);
  const fams = [...new Set((c.stack ?? []).map((s) => byId[s.id]?.family ?? 'custom'))];
  return `<a class="coin sf" href="coin.html?t=${esc(c.ticker)}">
    <div class="coin-top">${avatar(c, 44)}
      <div class="coin-id"><b>${esc(c.name)}</b><span class="mono">$${esc(c.ticker)}</span></div>
      <span class="coin-chg num ${ch >= 0 ? 'up' : 'down'}">${pctS(ch)}</span></div>
    <div class="coin-nums">
      <div><span class="pixel">Market cap</span><b class="num">${usd(c.mcapUsd)}</b></div>
      <div><span class="pixel">Volume 24h</span><b class="num">${usd(c.vol24Usd)}</b></div>
    </div>
    <div class="coin-curve"><div class="bar"><i style="width:${Math.max(2, (c.progress ?? 0) * 100).toFixed(1)}%"></i></div>
      <span class="pixel">${grad ? 'Graduated' : `Curve ${Math.round((c.progress ?? 0) * 100)}%`}</span></div>
    <div class="coin-foot"><span class="coin-rules">${fams.map((f) => icon(f, 18)).join('')}</span><span class="dim">${c.stack?.length ?? 0} rule${c.stack?.length === 1 ? '' : 's'}</span></div>
  </a>`;
}

/** Voxel display word plus a faces-only copy that a moving mask sweeps across: a chrome glint. */
function vx(text) {
  const svg = voxelSVG(text, { cell: 9, gap: 1.2, glow: true, title: text });
  const vb = /viewBox="([^"]+)"/.exec(svg)[1];
  const faces = (svg.match(/<rect [^>]*\/>/g) ?? []).map((r) => r.replace(/fill="[^"]*"/, 'fill="#fff"').replace(/ style="[^"]*"/, '')).join('');
  return `<span class="vx-g">${svg}<span class="vx-glint" aria-hidden="true"><svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><g fill-opacity=".85">${faces}</g></svg></span></span>`;
}
