// Trade ticket: Buy / Sell with a rule-aware quote (api.quote), the real wallet picker, a confirm
// modal that shows the route and the hook's extra accounts, and the visitor's position.
import { api } from '../api/client.js';
import { byId, hex, errName } from '../data/blocks.js';
import { feeAt } from '../engine/engine.js';
import { SUPPLY } from '../engine/sim.js';
import { cube, ICON } from './icons.js';
import { modal, toast, requireWallet } from './chrome.js';
import { onWallet } from '../wallet/wallet.js';
import { esc, ago } from '../core/format.js';
import { tok, sol, usdPrice, randomSig, shortKey, copyText, SOL_USD } from './coin-shared.js';
import { pos, recordBuy, recordSell, walletCtx, onPos } from './coin-position.js';

const BUY_CHIPS = [0.1, 0.5, 1, 2, 5];
const SELL_CHIPS = [0.25, 0.5, 0.75, 1];
const SLIPPAGE = 1;

export function mountTicket(el, coin) {
  const T = coin.ticker;
  if (coin.phase === 'graduated') return mountGraduated(el, coin);

  const hooks = coin.stack.map((s) => byId[s.id]).filter((b) => b.check);
  const st = { side: 'buy', amt: '', q: null, loading: false, addr: null, price: null };
  const ageS = coin.minutesAgo * 60;

  el.innerHTML = `
    <div class="tk-tabs" role="tablist">
      <button role="tab" data-side="buy" class="on">Buy</button>
      <button role="tab" data-side="sell">Sell</button>
    </div>
    <div class="tk-body">
      <div class="tk-field">
        <div class="tk-lab"><label for="tkAmt" id="tkPayL">You pay</label><span id="tkHave" class="dim"></span></div>
        <div class="tk-in"><input id="tkAmt" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="tkUnit"><span class="tk-unit" id="tkUnit">SOL</span></div>
        <div class="tk-quick" id="tkQuick"></div>
      </div>
      <div class="tk-arrow" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 2v10M3 8l4 4 4-4"/></svg></div>
      <div class="tk-out">
        <div class="tk-lab"><span>You receive</span><span class="dim">estimate</span></div>
        <div class="tk-outv" id="tkOut"><span class="num">0</span><small id="tkOutU">${esc(T)}</small></div>
      </div>
      <dl class="tk-rows" id="tkRows"></dl>
      <div class="tk-check" id="tkCheck"></div>
      <button class="btn btn-chrome btn-lg tk-go" id="tkGo">Connect wallet</button>
      <div class="tk-pos" id="tkPos"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const input = $('#tkAmt');

  function renderSide() {
    el.querySelectorAll('.tk-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.side === st.side));
    el.classList.toggle('selling', st.side === 'sell');
    $('#tkPayL').textContent = st.side === 'buy' ? 'You pay' : 'You sell';
    $('#tkUnit').textContent = st.side === 'buy' ? 'SOL' : T;
    $('#tkOutU').textContent = st.side === 'buy' ? T : 'SOL';
    input.placeholder = st.side === 'buy' ? '0.00' : '0';
    const p = pos(T);
    $('#tkHave').innerHTML = st.side === 'sell' ? (p.tokens > 0 ? `You hold <b class="num">${tok(p.tokens)}</b>` : `You hold no $${esc(T)}`) : '';
    $('#tkQuick').innerHTML = st.side === 'buy'
      ? BUY_CHIPS.map((v) => `<button class="tk-chip" data-v="${v}">${v} SOL</button>`).join('')
      : SELL_CHIPS.map((f) => `<button class="tk-chip" data-f="${f}" ${p.tokens > 0 ? '' : 'disabled'}>${f === 1 ? 'Max' : f * 100 + '%'}</button>`).join('');
  }

  function rows() {
    const amt = parseFloat(st.amt) || 0;
    const fee = feeAt(coin.stack, ageS);
    const q = st.q;
    const priceUsd = q?.priceUsd ?? st.price;
    const feeSol = st.side === 'buy' ? amt * fee / 100 : (q ? q.out / (1 - fee / 100) * fee / 100 : 0);
    const bud = coin.budget;
    const needRecord = st.side === 'buy' && bud.walletRecordRentSol > 0 && !pos(T).record;
    $('#tkRows').innerHTML = `
      <div><dt>Price</dt><dd class="num">${priceUsd ? usdPrice(priceUsd) : '—'}</dd></div>
      <div><dt>Trading fee</dt><dd class="num">${fee.toFixed(fee % 1 ? 1 : 0)}%${amt ? ` · ${sol(feeSol)}` : ''}</dd></div>
      <div><dt>Route</dt><dd>${bud.hasHook ? 'hookrz router' : 'Any route'}</dd></div>
      ${needRecord ? `<div><dt>Wallet record</dt><dd class="num" data-tip="Your per-holder record PDA for this coin; rent is refunded after graduation">${sol(bud.walletRecordRentSol)} rent</dd></div>` : ''}`;
  }

  function verdictCubes(q) {
    return hooks.map((b) => {
      const v = q?.verdicts?.find((x) => x.id === b.id);
      const s = !v ? 'empty' : v.ok ? 'lit' : 'refused';
      return `<span class="mcube" data-tip="${esc(b.name)}: ${!v ? 'not reached' : v.ok ? 'passes' : 'refuses'}">${s === 'empty' ? cube(b.family, { size: 20 }) : cube(b.family, { size: 20, state: s })}</span>`;
    }).join('');
  }

  function check() {
    const amt = parseFloat(st.amt) || 0;
    const box = $('#tkCheck');
    box.className = 'tk-check';
    if (!hooks.length) { box.innerHTML = `<div class="tk-ok"><span class="tk-ok-t">No hook blocks on this coin. Every route works and nothing is refused.</span></div>`; return; }
    if (!amt) { box.innerHTML = `<div class="tk-idle"><span class="mstack" style="--mg:4px">${hooks.map((b) => `<span class="mcube" data-tip="${esc(b.name)}">${cube(b.family, { size: 20 })}</span>`).join('')}</span><span>Enter an amount to check it against ${hooks.length} hook block${hooks.length > 1 ? 's' : ''}.</span></div>`; return; }
    if (st.loading && !st.q) { box.innerHTML = `<div class="tk-idle"><span class="tk-spin"></span><span>Checking the stack…</span></div>`; return; }
    const q = st.q;
    if (!q) return;
    if (q.ok) {
      box.classList.add('ok');
      box.innerHTML = `<div class="tk-ok"><span class="mstack" style="--mg:4px">${verdictCubes(q)}</span><span class="tk-ok-t"><b>Passes</b> all ${hooks.length} hook block${hooks.length > 1 ? 's' : ''}</span></div>`;
      return;
    }
    const b = byId[q.refusedBy];
    const unit = st.side === 'buy' ? 'SOL' : T;
    const maxOk = q.maxAllowed > (st.side === 'buy' ? 0.0005 : 1);
    const maxTxt = st.side === 'buy' ? sol(q.maxAllowed, false) : tok(q.maxAllowed);
    box.classList.add('ref');
    box.innerHTML = `<div class="tk-ref">
      <div class="tk-ref-h">${cube(b.family, { size: 38, state: 'refused' })}
        <div><div class="tk-ref-n">Refused by <b>${esc(b.name)}</b></div><div class="tk-ref-c num">error ${hex(q.code)} · slot ${coin.stack.findIndex((s) => s.id === b.id) + 1}</div></div></div>
      <p class="tk-ref-m">${esc(q.message)}</p>
      <div class="tk-ref-v"><span class="mstack" style="--mg:4px">${verdictCubes(q)}</span></div>
      ${maxOk ? `<button class="btn btn-glass btn-sm tk-max" id="tkMax">Use largest allowed (${maxTxt} ${esc(unit)})</button>` : `<p class="tk-ref-none">${noneLine(q)}</p>`}
    </div>`;
    $('#tkMax')?.addEventListener('click', () => { setAmt(st.side === 'buy' ? floorTo(q.maxAllowed, 4) : Math.floor(q.maxAllowed)); });
  }

  // when nothing passes, say which block holds every size back and when it lets go
  function noneLine(q) {
    const probe = st.probe;
    const b = byId[probe?.refusedBy ?? q.refusedBy];
    const slot = coin.stack.find((s) => s.id === b.id);
    const p = pos(T), now = Date.now();
    let when = '';
    if (b.id === 'hold-timer') { const ms = slot.params.minutes * 60000; const next = p.lots.filter((l) => now - l.at < ms).map((l) => ms - (now - l.at)); if (next.length) when = ` Your first lot frees in ${clockS(Math.min(...next) / 1000)}.`; }
    if (b.id === 'sell-cooldown' && p.lastSellAt) { const left = slot.params.minutes * 60 - (now - p.lastSellAt) / 1000; if (left > 0) when = ` Your next sell opens in ${clockS(left)}.`; }
    if (b.id === 'sandwich-guard' && p.lastBuyAt) when = ' Sells open a few seconds after your buy.';
    if (b.id === 'lock-in') when = ` The curve is ${(coin.progress * 100).toFixed(1)}% filled; sells open at ${slot.params.pct}%.`;
    if (b.id === 'trading-hours') when = ` The curve trades ${String(slot.params.open).padStart(2, '0')}:00–${String(slot.params.close).padStart(2, '0')}:00 UTC.`;
    return `No ${st.side} of any size passes right now: <b>${esc(b.name)}</b> refuses even the smallest.${when}`;
  }
  const clockS = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(x).padStart(2, '0')}`; };

  function out() {
    const q = st.q, amt = parseFloat(st.amt) || 0;
    $('#tkOut').querySelector('.num').textContent = !amt || !q ? '0' : st.side === 'buy' ? tok(q.out) : sol(q.out, false);
    $('#tkOut').classList.toggle('loading', st.loading);
  }

  function go() {
    const btn = $('#tkGo');
    const amt = parseFloat(st.amt) || 0;
    const p = pos(T);
    btn.className = 'btn btn-chrome btn-lg tk-go';
    btn.disabled = false;
    if (!st.addr) { btn.textContent = 'Connect wallet'; btn.classList.add('connect'); return; }
    if (!amt) { btn.textContent = st.side === 'buy' ? `Buy $${T}` : `Sell $${T}`; btn.disabled = true; return; }
    if (st.side === 'sell' && amt > p.tokens + 1e-6) { btn.textContent = p.tokens ? `Not enough $${T}` : `You hold no $${T}`; btn.disabled = true; return; }
    if (st.loading || !st.q) { btn.textContent = 'Checking rules…'; btn.disabled = true; return; }
    if (!st.q.ok) { btn.textContent = `Refused by ${byId[st.q.refusedBy].name}`; btn.disabled = true; btn.classList.add('refused'); return; }
    btn.textContent = st.side === 'buy' ? `Buy $${T}` : `Sell $${T}`;
  }

  function position() {
    const p = pos(T);
    const box = $('#tkPos');
    if (!p.tokens && !p.history.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const priceSol = (st.q?.price ?? (st.price ? st.price / SOL_USD : 0));
    const val = p.tokens * priceSol;
    const pnl = p.costSol > 0 ? (val / p.costSol - 1) * 100 : 0;
    box.innerHTML = `<div class="tk-pos-h"><span class="pk">Your position</span><span class="dim num">${(p.tokens / SUPPLY * 100).toFixed(3)}% of supply</span></div>
      <div class="tk-pos-v"><span class="num"><b>${tok(p.tokens)}</b> ${esc(T)}</span><span class="num">≈ ${sol(val)}${p.costSol > 0 && p.tokens ? ` <i class="${pnl >= 0 ? 'up' : 'down'}">${pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(1)}%</i>` : ''}</span></div>
      <ul class="tk-hist">${p.history.slice(0, 3).map((h) => `<li><span class="tk-hk ${h.side}">${h.side}</span><span class="num">${tok(h.tokens)}</span><span class="num dim">${sol(h.sol)}</span><span class="num dim">${shortKey(h.sig)}</span><span class="dim">${ago((Date.now() - h.at) / 60000)}</span></li>`).join('')}</ul>`;
  }

  const render = () => { rows(); check(); out(); go(); position(); };

  let timer, reqId = 0;
  async function quote() {
    const amt = parseFloat(st.amt) || 0;
    const id = ++reqId;
    if (!amt) { st.q = null; st.loading = false; render(); return; }
    st.loading = true; render();
    const q = await api.quote({ ticker: T, side: st.side, amount: amt, wallet: walletCtx(pos(T), ageS) });
    // nothing passes: probe the smallest trade to find the block that holds every size back
    st.probe = !q.ok && !(q.maxAllowed > (st.side === 'buy' ? 0.0005 : 1))
      ? await api.quote({ ticker: T, side: st.side, amount: st.side === 'buy' ? 0.001 : 1, wallet: walletCtx(pos(T), ageS) }) : null;
    if (id !== reqId) return;
    st.q = q; st.loading = false; st.price = q.priceUsd;
    render();
  }
  const schedule = () => { clearTimeout(timer); st.loading = true; go(); out(); timer = setTimeout(quote, 260); };
  function setAmt(v) { st.amt = String(v); input.value = st.amt; quote(); }
  const floorTo = (v, d) => Math.floor(v * 10 ** d) / 10 ** d;

  input.addEventListener('input', () => {
    const v = input.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    if (v !== input.value) input.value = v;
    st.amt = v; st.q = null; schedule(); check();
  });
  el.querySelector('.tk-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.side === st.side) return;
    st.side = b.dataset.side; st.amt = ''; input.value = ''; st.q = null;
    renderSide(); render(); input.focus({ preventScroll: true });
  });
  $('#tkQuick').addEventListener('click', (e) => {
    const b = e.target.closest('.tk-chip'); if (!b || b.disabled) return;
    if (b.dataset.v) setAmt(b.dataset.v);
    else setAmt(Math.floor(pos(T).tokens * +b.dataset.f));
  });
  $('#tkGo').addEventListener('click', async () => {
    if (!st.addr) { const h = await requireWallet(); if (h) toast(`Connected ${h.name}`); return; }
    if (st.q?.ok) confirm();
  });

  function confirm() {
    const side = st.side, amt = parseFloat(st.amt), q = st.q;
    const bud = coin.budget;
    const fee = feeAt(coin.stack, ageS);
    const needRecord = side === 'buy' && bud.walletRecordRentSol > 0 && !pos(T).record;
    const outTxt = side === 'buy' ? `${tok(q.out)} ${T}` : sol(q.out);
    const minTxt = side === 'buy' ? `${tok(q.out * (1 - SLIPPAGE / 100))} ${T}` : sol(q.out * (1 - SLIPPAGE / 100));
    const feeSol = side === 'buy' ? amt * fee / 100 : q.out / (1 - fee / 100) * fee / 100;
    const accts = bud.accounts;
    modal(`<div class="cf">
      <span class="eyebrow">Confirm ${side}</span>
      <h3 class="cf-h">${side === 'buy' ? 'Buy' : 'Sell'} $${esc(T)}</h3>
      <div class="cf-swap">
        <div><span class="k">You ${side === 'buy' ? 'pay' : 'sell'}</span><b class="num">${side === 'buy' ? sol(amt) : `${tok(amt)} ${esc(T)}`}</b></div>
        <span class="cf-arr">${ICON.arrow}</span>
        <div><span class="k">You receive</span><b class="num">≈ ${esc(outTxt)}</b></div>
      </div>
      <dl class="cf-rows">
        <div><dt>Route</dt><dd>${bud.hasHook ? 'hookrz router → Meteora DBC pool' : 'Meteora DBC pool'}</dd></div>
        <div class="cf-full"><dt>Hook accounts the router resolves (${accts.length})</dt><dd>${accts.length ? `<ul class="cf-acc">${accts.map((a) => `<li>${esc(a.label)}</li>`).join('')}</ul>` : 'None'}</dd></div>
        ${needRecord ? `<div><dt>Wallet record</dt><dd><b class="num">${sol(bud.walletRecordRentSol)}</b> rent. The router opens your record in this buy; refunded after graduation.</dd></div>` : ''}
        <div><dt>Trading fee</dt><dd class="num">${fee.toFixed(fee % 1 ? 1 : 0)}% · ${sol(feeSol)}</dd></div>
        <div><dt>Minimum received</dt><dd class="num">${esc(minTxt)} <span class="dim">(${SLIPPAGE}% slippage)</span></dd></div>
        <div><dt>Rule check</dt><dd><span class="mstack" style="--mg:3px">${verdictCubes(q)}</span> <span class="cf-pass">Passes ${hooks.length} hook block${hooks.length === 1 ? '' : 's'}</span></dd></div>
      </dl>
      <button class="btn btn-chrome btn-lg cf-go" id="cfGo">Confirm in wallet</button>
      <p class="cf-note">One transaction. If the stack refuses it on chain, it fails and only the network fee is spent.</p>
    </div>`, (m, close) => {
      m.classList.add('cf-modal');
      m.querySelector('#cfGo').onclick = async () => {
        const cf = m.querySelector('.cf');
        cf.innerHTML = `<div class="cf-wait"><span class="cf-cubes">${hooks.slice(0, 6).map((b, i) => `<span style="--d:${i * 0.12}s">${cube(b.family, { size: 26 })}</span>`).join('') || cube('custom', { size: 26 })}</span>
          <h3 class="cf-h">Submitting…</h3><p class="muted">Waiting for the transaction to land. The engine runs ${hooks.length || 'no'} hook block${hooks.length === 1 ? '' : 's'} on it.</p></div>`;
        // the wallet signs the prepared swap and sends it (demo mode: a simulated landing, same timing)
        let res;
        try { res = await api.trade({ ticker: T, side, amount: amt }); } catch (e) { res = { ok: false, code: null, error: e?.message ?? String(e) }; }
        if (!res.ok) {
          const b = res.code ? Object.values(byId).find((x) => x.code === res.code) : null;
          cf.innerHTML = `<div class="cf-done"><span class="eyebrow">Refused</span>
            <h3 class="cf-h">${res.code ? `${hex(res.code)} · ${esc(errName(res.code))}` : 'Not sent'}</h3>
            <p class="muted">${esc(b ? `${b.name}: ${res.message ?? b.error?.(coin.stack.find((s) => s.id === b.id)?.params ?? {}, {}) ?? ''}` : res.message ?? res.error ?? 'The transaction did not go through.')} Only the network fee was spent.</p>
            <button class="btn btn-glass btn-lg cf-go" id="cfDone">Close</button></div>`;
          cf.querySelector('#cfDone').onclick = close;
          return;
        }
        const sig = res.signature;
        if (side === 'buy') recordBuy(T, { tokens: q.out, sol: amt, sig }); else recordSell(T, { tokens: amt, sol: q.out, sig });
        cf.innerHTML = `<div class="cf-done">
          <span class="cf-check">${ICON.check}</span>
          <span class="eyebrow">Landed</span>
          <h3 class="cf-h">${side === 'buy' ? `Bought ${tok(q.out)} $${esc(T)}` : `Sold ${tok(amt)} $${esc(T)}`}</h3>
          <p class="muted">${side === 'buy' ? `for ${sol(amt)}` : `for ${sol(q.out)}`} · every hook block passed</p>
          <div class="cf-sig"><span class="k">Signature</span><span class="num" title="${sig}">${sig.slice(0, 10)}…${sig.slice(-10)}</span><button class="icon-btn" id="cfCopy" aria-label="Copy signature">${ICON.copy}</button></div>
          <button class="btn btn-glass btn-lg cf-go" id="cfDone">Done</button>
        </div>`;
        cf.querySelector('#cfCopy').onclick = (e) => copyText(sig, e.currentTarget, ICON.check);
        cf.querySelector('#cfDone').onclick = close;
        toast(`Landed: ${side === 'buy' ? `bought ${tok(q.out)}` : `sold ${tok(amt)}`} $${T}`);
        st.amt = ''; input.value = ''; st.q = null;
        renderSide(); render();
      };
    });
  }

  onWallet((a) => { st.addr = a; go(); });
  onPos((t) => { if (t === T) { renderSide(); position(); go(); } });
  renderSide(); render();
  // a price for the position line before the first quote
  api.quote({ ticker: T, side: 'buy', amount: 0.01 }).then((q) => { st.price = q.priceUsd; if (!st.q) { rows(); position(); } });
  setInterval(position, 30000);
}

function mountGraduated(el, coin) {
  const cranks = coin.stack.map((s) => byId[s.id]).filter((b) => b.enforcedBy !== 'hook' || b.also);
  el.classList.add('grad');
  el.innerHTML = `<div class="tk-grad">
    <span class="chip solid">Graduated</span>
    <h3 class="tk-grad-h">Trading on Meteora DAMM v2</h3>
    <p class="muted">The curve filled and migrated. The DBC pool removed the transfer hook in the graduating swap, so the hook blocks retired and $${esc(coin.ticker)} now trades on every route like any Token-2022 coin.</p>
    <dl class="tk-rows">
      <div><dt>Pool</dt><dd>Meteora DAMM v2</dd></div>
      <div><dt>Transfer hook</dt><dd>Removed</dd></div>
      ${coin.budget.walletRecordRentSol > 0 ? '<div><dt>Wallet records</dt><dd>Rent refundable to holders</dd></div>' : ''}
      <div><dt>Still running</dt><dd>${cranks.length ? esc(cranks.map((b) => b.name).join(', ')) : 'Nothing'}</dd></div>
    </dl>
    <div class="tk-grad-rec">
      <div><span class="k">Raised</span><b class="num">85 SOL</b></div>
      <div><span class="k">Checked</span><b class="num">${coin.checked.toLocaleString('en-US')}</b></div>
      <div><span class="k">Refused</span><b class="num ref">${coin.refused.toLocaleString('en-US')}</b></div>
    </div>
    <p class="tk-grad-n dim">The curve record stays on chain. Crank blocks keep running on LP fees; every keeper action is a public transaction.</p>
  </div>`;
}
