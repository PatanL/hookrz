// Coin page: the Blocklist and Allowlist passes, for coins with those rules. Everyone sees who is blocked and who has a
// pass (read from chain in live mode: GET /v1/coins/:mint/marks). The coin's creator, with the launch wallet connected,
// also gets an editor: add or remove wallets → api.setMarks prepares the set_mark transactions, the wallet signs and
// sends each one, and the list reloads. The blocked bit freezes per the Blocklist's setting; passes never freeze.
import { api, blocklistOpen } from '../api/client.js';
import { normalize } from '../engine/engine.js';
import { onWallet } from '../wallet/wallet.js';
import { parseAddresses } from '../core/address.js';
import { esc } from '../core/format.js';
import { toast } from './chrome.js';
import { shortKey, pxTile, copyText } from './coin-shared.js';
import { explorer } from './coin-keeper.js';
import { ICON } from './icons.js';

const SHOW = 12;
const mins = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`);
const ERR = {
  BLOCKLIST_FROZEN: 'The blocklist is frozen: it can\'t change any more.',
  NOT_CREATOR: 'Only the wallet that launched this coin can change its lists.',
  NO_BLOCKLIST: 'This coin has no blocklist.',
  NO_ALLOWLIST: 'This coin has no pass list.',
};

export function mountMarks(el, coin) {
  const stack = normalize(coin.stack);
  const blk = stack.find((s) => s.id === 'blocklist'), al = stack.find((s) => s.id === 'allowlist-phase');
  const creatorKey = coin.creatorWallet ?? coin.creator; // live: the creator's address; this browser: the launch wallet
  const grad = coin.phase === 'graduated';
  const st = { list: null, err: null, open: false, ex: null, me: null, busy: null, msg: null, more: false, unix: null, draft: { block: '', pass: '' } };

  onWallet((a) => { st.me = a; if (st.list) render(); });
  load();

  async function load() {
    try {
      const [list, h] = await Promise.all([api.marks(coin.ticker), api.health().catch(() => ({ mode: null, unix: null }))]);
      st.list = list ?? []; st.ex = explorer(h?.mode); st.unix = h?.unix ?? null;
      st.open = blk ? blocklistOpen(coin, h?.unix ?? Math.floor(Date.now() / 1000)) : false;
      st.err = null;
    } catch (e) { st.list = st.list ?? []; st.err = e?.message ?? 'The lists didn\'t load.'; }
    render();
  }

  const isCreator = () => !!st.me && st.me === creatorKey && !grad;

  function listHTML(kind, items, live = true) {
    const can = isCreator() && !st.busy && live && (kind === 'pass' || st.open);
    const shown = st.more ? items : items.slice(0, SHOW);
    if (!items.length) return `<p class="mk-none dim">${kind === 'block' ? 'Nobody is blocked.' : 'No passes yet.'}</p>`;
    return `<ul class="mk-list">${shown.map((m) => `<li>
      <span class="mono mk-a" title="${esc(m.owner)}">${st.ex ? `<a href="${esc(st.ex.account(m.owner))}" target="_blank" rel="noopener">${esc(shortKey(m.owner))}</a>` : esc(shortKey(m.owner))}</span>
      ${st.me && m.owner === st.me ? '<span class="chip">You</span>' : ''}
      <button class="icon-btn mk-cp" data-mk="copy" data-o="${esc(m.owner)}" aria-label="Copy address">${ICON.copy}</button>
      ${can ? `<button class="btn btn-ghost btn-sm mk-rm" data-mk="${kind === 'block' ? 'unblock' : 'unpass'}" data-o="${esc(m.owner)}">${kind === 'block' ? 'Unblock' : 'Remove pass'}</button>` : ''}
    </li>`).join('')}</ul>
    ${items.length > SHOW && !st.more ? `<button class="link mk-more" data-mk="more">Show all ${items.length}</button>` : ''}`;
  }

  function editHTML(kind) {
    const label = kind === 'block' ? 'Block wallets' : 'Give passes';
    const d = st.draft[kind], p = parseAddresses(d);
    const bad = p.bad.length ? `${p.bad.length === 1 ? `“${p.bad[0].slice(0, 24)}${p.bad[0].length > 24 ? '…' : ''}” isn't` : `${p.bad.length} entries aren't`} a Solana wallet address.` : kind === 'block' && st.me && p.list.includes(st.me) ? 'That\'s your own wallet. You can\'t block yourself.' : null;
    const busy = st.busy === kind;
    return `<div class="mk-add field${bad ? ' bad' : ''}">
      <label for="mk-${kind}">${label}</label>
      <textarea class="input mono" id="mk-${kind}" data-mkin="${kind}" rows="2" spellcheck="false" autocomplete="off" placeholder="One wallet address per line" ${st.busy ? 'disabled' : ''}>${esc(d)}</textarea>
      <div class="mk-go"><span class="${bad ? 'ferr' : 'fhint'}" data-mkmsg="${kind}">${esc(bad ?? (p.list.length ? `${p.list.length} wallet${p.list.length === 1 ? '' : 's'}. Your wallet signs ${p.list.length > 12 ? 'a few transactions' : 'one transaction'}.` : kind === 'block' ? 'They can\'t buy, sell or receive the coin.' : 'They can buy during the pass-only phase.'))}</span>
        <button class="btn btn-glass btn-sm" data-mk="${kind}" ${p.list.length && !bad && !st.busy ? '' : 'disabled'}>${busy ? '<span class="spin"></span>Approve in your wallet…' : kind === 'block' ? 'Block' : 'Give passes'}</button></div>
    </div>`;
  }

  function render() {
    const items = st.list ?? [];
    const blocked = items.filter((m) => m.blocked), passes = items.filter((m) => m.pass);
    const me = isCreator();
    const lockAt = blk?.params.lockAt;
    // the chain's clock when the API gives it (it is the one the rule reads), else the page's
    const ageS = coin.launchTs != null && st.unix ? st.unix - coin.launchTs : coin.minutesAgo * 60;
    const phaseLeft = al ? al.params.minutes * 60 - ageS : 0;
    const title = blk && al ? 'Blocklist and passes' : blk ? 'Blocklist' : 'Passes';
    el.innerHTML = `
      <div class="ph"><h3>${title}</h3>${blk ? `<span class="chip ${st.open ? 'ice' : ''} mk-state">${grad ? 'Retired' : st.open ? (lockAt === 'after 24h' ? 'Open for 24h after launch' : 'Open until graduation') : 'Frozen'}</span>` : ''}</div>
      <div class="mk-body">
        ${grad ? '<p class="mk-note">The trade rules retired when the coin graduated, so these lists no longer apply.</p>' : ''}
        ${st.err ? `<p class="mk-note bad">${esc(st.err)}</p>` : ''}
        ${blk ? `<section class="mk-sec">
          <div class="mk-h">${pxTile('guard', { size: 22, state: blocked.length ? 'refused' : '' })}<b>Blocked wallets</b><span class="pk">${blocked.length}</span></div>
          <p class="dim mk-p">These wallets can't buy, sell or receive $${esc(coin.ticker)}. ${grad ? '' : st.open ? `The creator can change the list ${lockAt === 'after 24h' ? 'for 24 hours after launch' : 'until the coin graduates'}.` : 'The list is frozen: nobody can change it any more.'}</p>
          ${st.list ? listHTML('block', blocked) : '<div class="skel"><i></i><i></i></div>'}
          ${me && st.open ? editHTML('block') : ''}
        </section>` : ''}
        ${al ? `<section class="mk-sec">
          <div class="mk-h">${pxTile('lock', { size: 22 })}<b>Wallets with a pass</b><span class="pk">${passes.length}</span></div>
          <p class="dim mk-p">${phaseLeft > 0 ? `For the first ${mins(al.params.minutes)}, only these wallets can buy.` : `Only these wallets could buy in the first ${mins(al.params.minutes)}. That phase is over: anyone can buy now.`}</p>
          ${st.list ? listHTML('pass', passes, phaseLeft > 0) : '<div class="skel"><i></i><i></i></div>'}
          ${me && phaseLeft > 0 ? editHTML('pass') : ''}
        </section>` : ''}
        ${st.msg ? `<p class="mk-msg ${st.msg.kind}" role="status">${esc(st.msg.text)}</p>` : ''}
        ${!me && !grad ? `<p class="mk-foot dim">${st.me ? 'Only the wallet that launched the coin can change these lists.' : 'The coin\'s creator connects the launch wallet to change these lists.'}</p>` : ''}
      </div>`;
  }

  async function apply(kind, marks, done) {
    st.busy = kind; st.msg = null; render();
    try {
      const r = await api.setMarks({ ticker: coin.ticker, marks });
      if (typeof r?.blocklistOpen === 'boolean' && blk) st.open = r.blocklistOpen;
      const n = r?.marks?.length ?? marks.length;
      st.msg = { kind: 'ok', text: n ? `Saved: ${n} wallet${n === 1 ? '' : 's'} changed${r?.signatures?.length ? ` in ${r.signatures.length} transaction${r.signatures.length === 1 ? '' : 's'}` : ''}.` : 'Nothing to change: the list already says that.' };
      done?.();
    } catch (e) {
      const msg = String(e?.message ?? e ?? '');
      if (e?.code === 'BLOCKLIST_FROZEN') st.open = false;
      st.msg = { kind: 'bad', text: ERR[e?.code] ?? (e?.code === 4001 || /reject|denied|declin|cancel|closed|abort|dismiss/i.test(msg) ? 'You declined in your wallet. Nothing changed.' : msg || 'The change didn\'t go through. Try again.') };
    }
    st.busy = null;
    await load();
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mk]');
    if (!b || b.disabled) return;
    const k = b.dataset.mk, o = b.dataset.o;
    if (k === 'copy') { copyText(o, b, ICON.check); toast('Address copied'); }
    else if (k === 'more') { st.more = true; render(); }
    else if (k === 'unblock') apply('block', [{ owner: o, blocked: false }]);
    else if (k === 'unpass') apply('pass', [{ owner: o, pass: false }]);
    else if (k === 'block' || k === 'pass') {
      const p = parseAddresses(st.draft[k]);
      if (!p.list.length || p.bad.length) return;
      apply(k, p.list.map((owner) => (k === 'block' ? { owner, blocked: true } : { owner, pass: true })), () => { st.draft[k] = ''; });
    }
  });
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.mkin;
    if (!k) return;
    st.draft[k] = e.target.value;
    // patch the hint and the button in place, so the caret stays where it is
    const fresh = document.createElement('div');
    fresh.innerHTML = editHTML(k);
    const msg = el.querySelector(`[data-mkmsg="${k}"]`), nm = fresh.querySelector(`[data-mkmsg="${k}"]`);
    if (msg && nm) { msg.className = nm.className; msg.textContent = nm.textContent; }
    const btn = el.querySelector(`button[data-mk="${k}"]`), nb = fresh.querySelector(`button[data-mk="${k}"]`);
    if (btn && nb) btn.disabled = nb.disabled;
    e.target.closest('.mk-add')?.classList.toggle('bad', !!fresh.querySelector('.mk-add.bad'));
  });
}
