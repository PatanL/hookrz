import '../styles/base.css';
import '../styles/blocks.css';
import { mountChrome } from '../ui/chrome.js';
import { FAMILIES, hex, errName } from '../data/blocks.js';
import { api } from '../api/client.js';
import { esc, q } from '../core/format.js';
import { installTips, pxTile, ruleName } from '../ui/coin-shared.js';
import { card, famLabel, famBlurb, plainLine } from '../ui/blocks-card.js';
import { ideasSection } from '../ui/blocks-ideas.js';
import { openDetail } from '../ui/blocks-detail.js';

mountChrome('blocks');
installTips();
const app = document.getElementById('app');
const state = { fam: '', q: '' };

main();

async function main() {
  const blocks = await api.blocks();
  const famCount = (id) => blocks.filter((b) => b.family === id).length;
  const fams = FAMILIES.filter((f) => f.id !== 'custom');
  const own = blocks.find((b) => b.id === 'custom');

  app.innerHTML = `
  <section class="bk-hero">
    <div class="wrap">
      <span class="eyebrow">Rules</span>
      <h1 class="chrome-text">Rules your coin can enforce on every trade</h1>
      <p class="lede">Pick a few when you launch, or write your own in plain English. Once your coin is live, the chain checks them on every buy, sell and send, and nobody can change them.</p>
    </div>
  </section>

  <div class="wrap">${ideasSection()}</div>

  <section class="bk-cat" id="all" aria-labelledby="all-h">
    <div class="wrap bk-cat-head">
      <span class="eyebrow">Ready-made rules</span>
      <h2 id="all-h">Every rule, by what it does</h2>
      <p class="bk-cat-sub">${blocks.length - 1} rules with settings you can tune. Mix up to six on one coin.</p>
    </div>
    <div class="bk-filters" id="filters">
      <div class="wrap bk-frow">
        <div class="bk-chips" role="group" aria-label="Show rules for">
          <button type="button" data-fam="" class="on">All</button>
          ${fams.map((f) => `<button type="button" data-fam="${f.id}">${pxTile(f.id, { size: 20 })}${esc(famLabel(f.id))}</button>`).join('')}
        </div>
        <label class="bk-search"><span class="sr">Search rules</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="m11 11 3.5 3.5"/></svg>
          <input class="input" id="fQ" type="search" placeholder="Search rules" autocomplete="off">
        </label>
      </div>
    </div>

    <div class="wrap bk-main">
      ${fams.map((f) => `
      <section class="bk-family" id="${f.id}" data-family="${f.id}">
        <header class="bk-fhead">
          ${pxTile(f.id, { size: 44 })}
          <div class="bk-fcopy"><h3>${esc(famLabel(f.id))} <span class="bk-verb">${esc(f.verb.toLowerCase())}</span></h3><p>${esc(famBlurb(f))}</p></div>
          <span class="bk-fn">${famCount(f.id)} rules</span>
        </header>
        <div class="bk-grid">${blocks.filter((b) => b.family === f.id).map(card).join('')}</div>
      </section>`).join('')}
      <div class="bk-empty panel" id="empty" hidden>
        <p><b>No rule matches.</b> <span class="muted">Try another word, or describe the rule you want in plain English.</span></p>
        <div class="row wrap-row" style="gap:8px"><button class="btn btn-glass btn-sm" id="clear">Show all rules</button><button class="btn btn-chrome btn-sm" data-open="custom">Write your own</button></div>
      </div>
    </div>
  </section>

  <div class="wrap">
    <aside class="bk-own panel" id="custom" data-family="custom">
      ${pxTile('custom', { size: 52 })}
      <div class="bk-own-copy">
        <h2>Don't see your rule? Write your own.</h2>
        <p class="muted">${esc(plainLine(own))} Every one is tested against 10,000 trades and checked so holders can always sell eventually, before it can launch.</p>
      </div>
      <div class="bk-own-cta"><button type="button" class="btn btn-chrome" data-open="custom">Try it here</button><a class="btn btn-glass" href="build.html?add=custom">Use it in a launch</a></div>
    </aside>
  </div>`;

  // ── rule ideas: more / fewer
  const moreBtn = app.querySelector('#ideasMore');
  const grid = app.querySelector('#ideaGrid');
  const label = () => {
    const open = grid.classList.contains('all');
    const hidden = [...grid.children].filter((c) => !c.offsetParent).length;
    moreBtn.textContent = open ? 'Show fewer ideas' : `Show ${hidden} more ideas`;
    moreBtn.setAttribute('aria-expanded', String(open));
  };
  moreBtn.addEventListener('click', () => {
    const open = grid.classList.toggle('all');
    label();
    if (!open) app.querySelector('#ideas').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  label();
  matchMedia('(max-width: 760px)').addEventListener?.('change', label);

  // ── filters: family chips + search (codes and setting names still match, for people who know them)
  const cards = [...app.querySelectorAll('.bk-card')];
  const byIdCard = Object.fromEntries(cards.map((c) => [c.dataset.id, c]));
  const listed = blocks.filter((b) => byIdCard[b.id]);
  const text = Object.fromEntries(listed.map((b) => [b.id, [b.id, b.name, ruleName(b), b.tagline, plainLine(b), b.refuses, b.family, famLabel(b.family), hex(b.code), b.code != null ? errName(b.code) : '', ...b.params.map((p) => p.label)].join(' ').toLowerCase()]));
  const match = (b) => (!state.fam || b.family === state.fam) && (!state.q || state.q.split(/\s+/).every((w) => text[b.id].includes(w)));

  function apply() {
    let n = 0;
    for (const b of listed) { const ok = match(b); byIdCard[b.id].hidden = !ok; if (ok) n++; }
    for (const s of app.querySelectorAll('.bk-family')) s.hidden = !s.querySelector('.bk-card:not([hidden])');
    app.querySelector('#empty').hidden = n > 0;
    app.querySelectorAll('[data-fam]').forEach((x) => { const on = x.dataset.fam === state.fam; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  }
  const reset = () => { Object.assign(state, { fam: '', q: '' }); app.querySelector('#fQ').value = ''; apply(); };
  app.querySelectorAll('[data-fam]').forEach((x) => x.addEventListener('click', () => { state.fam = state.fam === x.dataset.fam ? '' : x.dataset.fam; apply(); }));
  app.querySelector('#fQ').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); apply(); });
  app.querySelector('#clear').addEventListener('click', reset);

  // ── details: a rule (data-open) or a rule idea (data-see); a click on a card's empty space opens it too
  app.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const see = e.target.closest('[data-see]');
    if (see) { openDetail('custom', { idea: see.dataset.see, opener: see }); return; }
    const t = e.target.closest('[data-open]');
    if (t) { openDetail(t.dataset.open, { opener: t }); return; }
    const c = e.target.closest('.bk-card');
    if (c && !e.target.closest('button,input,label')) openDetail(c.dataset.id, { opener: c.querySelector('[data-open]') });
  });

  apply();

  // deep links: blocks.html#pace, blocks.html?b=hold-timer, blocks.html?idea=king-of-the-hill
  const hash = location.hash.slice(1);
  let userScrolled = false;
  const mark = () => { userScrolled = true; };
  ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, mark, { once: true, passive: true }));
  const jump = () => { if (hash && !userScrolled) document.getElementById(hash)?.scrollIntoView({ block: 'start', behavior: 'instant' }); };
  if (hash) { requestAnimationFrame(jump); document.fonts?.ready.then(jump); addEventListener('load', jump, { once: true }); }
  const b = q('b'), idea = q('idea');
  if (idea) openDetail('custom', { idea });
  else if (b) openDetail(b);
}
