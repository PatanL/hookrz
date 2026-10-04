import '../styles/base.css';
import '../styles/blocks.css';
import { mountChrome } from '../ui/chrome.js';
import { asset, voxelSVG } from '../ui/voxel.js';
import { FAMILIES, ENFORCERS, ENGINE, rentSol, hex } from '../data/blocks.js';
import { api } from '../api/client.js';
import { esc, q } from '../core/format.js';
import { card } from '../ui/blocks-card.js';
import { openDetail } from '../ui/blocks-detail.js';

mountChrome('blocks');
const app = document.getElementById('app');
const ENF_ORDER = ['hook', 'curve', 'crank', 'ext'];
const state = { fam: '', enf: '', wallet: false, q: '' };

main();

async function main() {
  const blocks = await api.blocks();
  const count = (fn) => blocks.filter(fn).length;
  const famCount = (id) => count((b) => b.family === id);
  const enfCount = (e) => count((b) => b.enforcedBy === e);

  app.innerHTML = `
  <section class="bk-hero">
    <div class="wrap">
      <div class="bk-hero-top">
        <div class="bk-hero-copy">
          <span class="eyebrow">Block catalog</span>
          <h1 class="chrome-text">Every block</h1>
          <p class="lede">Each block says what the chain refuses, who enforces it and what it costs per transfer. Snap up to ${ENGINE.maxSlots} into a stack.</p>
        </div>
        <dl class="bk-counts">
          <div class="big"><dt>Blocks</dt><dd class="num">${blocks.length}</dd></div>
          <div class="big"><dt>Families</dt><dd class="num">${FAMILIES.length}</dd></div>
          ${ENF_ORDER.map((e) => `<div title="${esc(ENFORCERS[e].long)}"><dt><span class="enf ${e}"><i></i>${ENFORCERS[e].name}</span></dt><dd class="num">${enfCount(e)}</dd></div>`).join('')}
        </dl>
      </div>
      <nav class="bk-fams" aria-label="Jump to a family">
        ${FAMILIES.map((f) => `<a href="#${f.id}" class="bk-fam" data-jump="${f.id}">
          <img src="${asset(`img/brand/block-${f.id}-sm.webp`)}" alt="" width="240" height="240" loading="eager" decoding="async">
          <span class="bk-fam-name">${f.name}</span><span class="bk-fam-n pixel">${famCount(f.id)} blocks</span></a>`).join('')}
      </nav>
      <div class="bk-legend">
        ${ENF_ORDER.map((e) => `<div><span class="enf ${e}"><i></i>${ENFORCERS[e].name}</span><p>${esc(ENFORCERS[e].long)}.</p></div>`).join('')}
      </div>
    </div>
  </section>

  <div class="bk-filters" id="filters">
    <div class="wrap">
      <div class="bk-frow">
        <div class="bk-seg" role="group" aria-label="Family">
          <button data-fam="" class="on">All</button>
          ${FAMILIES.map((f) => `<button data-fam="${f.id}">${f.name}</button>`).join('')}
        </div>
        <div class="bk-seg enfs" role="group" aria-label="Enforced by">
          ${ENF_ORDER.map((e) => `<button data-enf="${e}" title="${esc(ENFORCERS[e].long)}"><span class="enf ${e}"><i></i></span>${ENFORCERS[e].name}</button>`).join('')}
        </div>
        <label class="bk-check" title="Blocks that keep a per-holder Wallet record (~${rentSol(ENGINE.walletRecordBytes).toFixed(4)} SOL rent, refunded after graduation)">
          <input type="checkbox" id="fWallet"><span class="sw" aria-hidden="true"></span>Needs wallet record
        </label>
        <div class="bk-search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="m11 11 3.5 3.5"/></svg>
          <input class="input" id="fQ" type="search" placeholder="Search or 0x1773" aria-label="Search blocks" autocomplete="off">
        </div>
        <span class="bk-shown mono" id="shown" aria-live="polite"></span>
      </div>
    </div>
  </div>

  <div class="wrap bk-main">
    ${FAMILIES.map((f, i) => `
    <section class="bk-family" id="${f.id}" data-family="${f.id}">
      <header class="bk-fhead">
        <img class="bk-frender" src="${asset(`img/brand/block-${f.id}-sm.webp`)}" alt="" width="240" height="240" loading="lazy" decoding="async">
        <div class="bk-fcopy">
          <span class="eyebrow">Family ${String(i + 1).padStart(2, '0')} · ${famCount(f.id)} blocks</span>
          <h2>${f.name} <span class="bk-verb">${esc(f.verb)}</span></h2>
          <p>${esc(f.blurb)}</p>
          <div class="bk-fenf">${ENF_ORDER.filter((e) => blocks.some((b) => b.family === f.id && b.enforcedBy === e)).map((e) => `<span class="enf ${e}"><i></i>${blocks.filter((b) => b.family === f.id && b.enforcedBy === e).length} ${ENFORCERS[e].name}</span>`).join('')}</div>
        </div>
        <div class="bk-fnum" aria-hidden="true">${voxelSVG(String(i + 1), { cell: 10, gap: 1.6, glow: true })}</div>
      </header>
      <div class="bk-grid">${blocks.filter((b) => b.family === f.id).map(card).join('')}</div>
    </section>`).join('')}
    <div class="bk-empty panel" id="empty" hidden>
      <p><b>No block matches.</b> <span class="muted">Try another word, or search an error code like <span class="mono">${hex(0x1773)}</span>.</span></p>
      <button class="btn btn-glass btn-sm" id="clear">Clear filters</button>
    </div>
    <aside class="bk-cta panel">
      <div><h3>Have a rule that isn't here?</h3><p class="muted">Describe it in English. The Custom block writes it in Hookscript, measures its CU and fuzzes it against 10,000 trades before it can launch.</p></div>
      <div class="row wrap-row" style="gap:10px"><button class="btn btn-chrome" data-open="custom">Try the Custom block</button><a class="btn btn-glass" href="docs.html#hookscript">Read about Hookscript</a></div>
    </aside>
  </div>`;

  // ── filters
  const cards = [...app.querySelectorAll('.bk-card')];
  const byIdCard = Object.fromEntries(cards.map((c) => [c.dataset.id, c]));
  const text = Object.fromEntries(blocks.map((b) => [b.id, [b.id, b.name, b.tagline, b.refuses, b.family, hex(b.code), b.code ?? '', ...b.params.map((p) => p.label), b.error ? b.error(Object.fromEntries(b.params.map((p) => [p.key, p.def]))) : ''].join(' ').toLowerCase()]));
  const match = (b) => (!state.fam || b.family === state.fam)
    && (!state.enf || b.enforcedBy === state.enf || b.also === state.enf)
    && (!state.wallet || b.state === 'wallet')
    && (!state.q || state.q.split(/\s+/).every((w) => text[b.id].includes(w)));

  function apply() {
    let n = 0;
    for (const b of blocks) { const ok = match(b); byIdCard[b.id].hidden = !ok; if (ok) n++; }
    for (const s of app.querySelectorAll('.bk-family')) s.hidden = !s.querySelector('.bk-card:not([hidden])');
    app.querySelector('#empty').hidden = n > 0;
    app.querySelector('#shown').textContent = n === blocks.length ? `${n} blocks` : `${n} of ${blocks.length}`;
    app.querySelectorAll('[data-fam]').forEach((x) => x.classList.toggle('on', x.dataset.fam === state.fam));
    app.querySelectorAll('[data-enf]').forEach((x) => { x.classList.toggle('on', x.dataset.enf === state.enf); x.setAttribute('aria-pressed', String(x.dataset.enf === state.enf)); });
    app.querySelector('#fWallet').checked = state.wallet;
  }
  const reset = () => { Object.assign(state, { fam: '', enf: '', wallet: false, q: '' }); app.querySelector('#fQ').value = ''; apply(); };

  app.querySelectorAll('[data-fam]').forEach((x) => x.addEventListener('click', () => { state.fam = x.dataset.fam; apply(); }));
  app.querySelectorAll('[data-enf]').forEach((x) => x.addEventListener('click', () => { state.enf = state.enf === x.dataset.enf ? '' : x.dataset.enf; apply(); }));
  app.querySelector('#fWallet').addEventListener('change', (e) => { state.wallet = e.target.checked; apply(); });
  app.querySelector('#fQ').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); apply(); });
  app.querySelector('#clear').addEventListener('click', reset);

  // ── jump to a family (clears filters that would hide it)
  app.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const id = a.dataset.jump;
    if (state.fam && state.fam !== id || app.querySelector(`#${id}`).hidden) reset();
    history.replaceState(history.state, '', `${location.search}#${id}`);
    app.querySelector(`#${id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  // ── details
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open]');
    if (t) openDetail(t.dataset.open, { opener: t });
  });

  apply();

  // deep links: blocks.html#burn, blocks.html?b=hold-timer
  const hash = location.hash.slice(1);
  let userScrolled = false;
  const mark = () => { userScrolled = true; };
  ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, mark, { once: true, passive: true }));
  const jump = () => { if (hash && !userScrolled) document.getElementById(hash)?.scrollIntoView({ block: 'start', behavior: 'instant' }); };
  if (hash) { requestAnimationFrame(jump); document.fonts?.ready.then(jump); addEventListener('load', jump, { once: true }); }
  const b = q('b');
  if (b) openDetail(b);
}
