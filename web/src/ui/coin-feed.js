// Live trades feed (api.stream). Each row: kind, amount, wallet, time and each rule's answer
// (lit = let it through, coral = blocked it, dark = not reached). Blocked rows say which rule; the error code is on hover.
import { api } from '../api/client.js';
import { byId, hex, errName } from '../data/blocks.js';
import { esc } from '../core/format.js';
import { tok, sol, shortKey, pxTile, ruleName } from './coin-shared.js';

const MAX = 14;

// Rules whose state is known right now (a launch window that has closed, a closed market, a lock-in)
// decide a transfer before anything else does; line streamed verdicts up with them.
const WINDOWED = { 'snipe-shield': (p) => p.window, 'anti-bundle': (p) => p.window * 60, 'allowlist-phase': (p) => p.minutes * 60 };
export function reconcile(e, coin, ageS = coin.minutesAgo * 60) {
  if (coin.phase === 'graduated') return e;
  const slots = coin.stack;
  const idx = (id) => slots.findIndex((s) => s.id === id);
  if (!e.ok && WINDOWED[e.by]) { const s = slots[idx(e.by)]; if (s && ageS > WINDOWED[e.by](s.params)) return null; }
  const firstIdx = e.ok ? Infinity : idx(e.by);
  const closers = [];
  const th = slots.find((s) => s.id === 'trading-hours');
  if (th && e.kind !== 'send') { const h = new Date().getUTCHours(); if (!(h >= th.params.open && h < th.params.close)) closers.push(th); }
  const li = slots.find((s) => s.id === 'lock-in');
  if (li && e.kind === 'sell' && coin.progress * 100 < li.params.pct) closers.push(li);
  for (const s of closers.sort((a, b) => idx(a.id) - idx(b.id))) {
    const i = idx(s.id);
    if (i >= firstIdx) continue;
    const before = slots.slice(0, i).filter((x) => byId[x.id].check).map((x) => ({ id: x.id, ok: true }));
    return { ...e, ok: false, by: s.id, msg: byId[s.id].error(s.params, {}), verdicts: [...before, { id: s.id, ok: false }] };
  }
  return e;
}
const age = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 2 ? 'now' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };

export function mountFeed(el, coin) {
  const grad = coin.phase === 'graduated';
  const hooks = coin.stack.map((s) => byId[s.id]).filter((b) => b.check);
  const st = { filter: 'all', rows: [], src: 'live', paused: false };
  let landed = 0, refused = 0;

  el.innerHTML = `
    <div class="ph">
      <h3><span class="live-dot"></span>Live trades <span class="pk" id="fdCount"></span></h3>
      <div class="seg" id="fdSeg">${grad
    ? '<button data-src="live" class="on">DAMM v2</button><button data-src="curve">Curve record</button>'
    : '<button data-f="all" class="on">All</button><button data-f="refused">Blocked</button><button data-f="landed">Passed</button>'}</div>
    </div>
    <div class="fd-head"><span>Kind</span><span>Amount</span><span>Wallet</span><span>Rules</span><span>Result</span><span>Age</span></div>
    <ol class="fd-list" id="fdList"></ol>
    <div class="fd-foot dim" id="fdFoot"></div>`;
  const list = el.querySelector('#fdList');

  function verdicts(e) {
    if (grad && st.src === 'live') return '<span class="fd-nohook" data-tip="The trade rules switched off at graduation">—</span>';
    if (!hooks.length) return '<span class="fd-nohook">no trade rules</span>';
    return `<span class="mstack" style="--mg:3px">${hooks.map((b) => {
      const v = e.verdicts?.find((x) => x.id === b.id);
      return `<span class="mcube" data-tip="${esc(ruleName(b))}: ${!v ? 'not reached' : v.ok ? 'let it through' : 'blocked it'}">${v ? pxTile(b.family, { size: 16, state: v.ok ? 'lit' : 'refused' }) : pxTile(b.family, { size: 16 })}</span>`;
    }).join('')}</span>`;
  }

  function row(e) {
    const b = e.by ? byId[e.by] : null;
    const amt = e.kind === 'buy' && e.sol ? `<b>${sol(e.sol, false)}</b> SOL <span class="dim">→ ${tok(e.amount)}</span>` : `<b>${tok(e.amount)}</b> <span class="dim">${esc(coin.ticker)}</span>`;
    return `<li class="fd-row${e.ok ? '' : ' ref'}${e.fresh ? ' fresh' : ''}">
      <span class="fd-k ${e.kind}">${e.kind}</span>
      <span class="fd-a num">${amt}</span>
      <span class="fd-w num">${shortKey(e.wallet)}</span>
      <span class="fd-v">${verdicts(e)}</span>
      <span class="fd-r">${e.ok ? '<span class="fd-landed">Passed</span>' : `<span class="fd-code" data-tip="${esc(`Error ${hex(b?.code)} ${errName(b?.code)}`)}">Blocked</span>`}</span>
      <span class="fd-t num" data-at="${e.at}">${e.at ? age(e.at) : 'curve'}</span>
      ${e.ok ? '' : `<span class="fd-msg"><b>${esc(b ? ruleName(b) : '')}</b> ${esc(e.msg ?? '')}</span>`}
    </li>`;
  }

  function render() {
    const rows = st.rows.filter((e) => st.filter === 'all' || (st.filter === 'refused' ? !e.ok : e.ok)).slice(0, MAX);
    list.innerHTML = rows.length ? rows.map(row).join('') : `<li class="fd-empty">${st.filter === 'refused' ? 'Nothing blocked in the latest trades.' : 'Waiting for the next trade…'}</li>`;
    st.rows.forEach((e) => { e.fresh = false; });
    el.querySelector('#fdCount').textContent = grad && st.src === 'curve' ? 'final trades on the curve' : `${landed + refused} seen · ${refused} blocked`;
    el.querySelector('#fdFoot').innerHTML = grad
      ? (st.src === 'live' ? 'The trade rules switched off at graduation, so pool trades run no rules.' : 'The last trades the rules checked before the curve filled.')
      : `Rules run in order. The first one that says no blocks the whole trade.`;
  }

  el.querySelector('#fdSeg').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('#fdSeg button').forEach((x) => x.classList.toggle('on', x === b));
    if (b.dataset.f) { st.filter = b.dataset.f; render(); return; }
    st.src = b.dataset.src;
    if (st.src === 'curve') {
      const ts = await api.trades(coin.ticker, { limit: MAX });
      curveRows = ts.map((t) => ({ ...t, at: null }));
      st.rows = curveRows; st.filter = 'all';
    } else { st.rows = liveRows; }
    render();
  });

  let liveRows = [], curveRows = [];
  st.rows = liveRows;
  // the latest transfers first, then the stream keeps it moving
  api.trades(coin.ticker, { limit: 30 }).then((ts) => {
    let t = Date.now() - 3000;
    const seed = ts.map((x) => reconcile(x, coin)).filter((x) => x && (!grad || x.ok)).slice(0, 10).map((x) => { t -= 4000 + Math.random() * 14000; return { ...x, at: t }; });
    seed.forEach((e) => (e.ok ? landed++ : refused++));
    liveRows.push(...seed);
    if (st.src === 'live') render();
  });
  // keep the list calm: at most one new row every 700ms
  const queue = [];
  api.stream(coin.ticker, (raw) => {
    const e = reconcile(raw, coin);
    if (!e || (grad && !e.ok)) return; // nothing is refused after the hook retires
    queue.push(e);
    if (queue.length > 6) queue.shift();
  });
  setInterval(() => {
    const e = queue.shift();
    if (e) {
      e.fresh = true; e.at = Date.now();
      if (e.ok) landed++; else refused++;
      liveRows.unshift(e); liveRows.length = Math.min(liveRows.length, 40);
      if (st.src === 'live') { st.rows = liveRows; render(); }
      return;
    }
    list.querySelectorAll('.fd-t[data-at]').forEach((n) => { if (+n.dataset.at) n.textContent = age(+n.dataset.at); });
  }, 700);
  render();
}
