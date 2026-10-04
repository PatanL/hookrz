// Home: "How a transfer gets hooked". Pick buy / sell / send, a size and a moment in the launch;
// the sample stack is run through the reference engine (engine.evaluate, same semantics as the
// on-chain hookrz_engine) and every slot shows its verdict.
import { evaluate, budget } from '../engine/engine.js';
import { Curve, SUPPLY, CURVE } from '../engine/sim.js';
import { byId, hex, ENGINE, ENFORCERS } from '../data/blocks.js';
import { cube, ICON } from './icons.js';
import { num, esc } from '../core/format.js';

/** A plausible six-slot stack that refuses in different slots depending on the trade. */
export const SAMPLE = [
  { id: 'snipe-shield', params: { window: 60, max: 0.3 } },
  { id: 'circuit-breaker', params: { band: 20, window: 5 } },
  { id: 'max-wallet', params: { pct: 3 } },
  { id: 'sell-cap', params: { pct: 1 } },
  { id: 'hold-timer', params: { minutes: 60 } },
  { id: 'buyback-burn', params: { pct: 25 } },
];

// moments in the launch: time since launch, curve progress, the wallet's bag (% of supply) and when its
// coins arrived (fractions of the bag), and what the receiver of a send already holds
const WHEN = {
  launch: { label: 'Launch +30s', t: 30, progress: 0.03, bal: 0.25, lots: [[8, 1]], recv: 0.2 },
  hour: { label: 'Launch +2h', t: 7200, progress: 0.38, bal: 1.5, lots: [[300, 0.4], [5400, 0.6]], recv: 2 },
  day: { label: 'Launch +1d', t: 90000, progress: 0.82, bal: 1.5, lots: [[3000, 0.6], [60000, 0.4]], recv: 2.5 },
};
// which transfers each sample block looks at (the rest pass straight through it)
const APPLIES = { 'snipe-shield': ['buy'], 'circuit-breaker': ['buy', 'sell'], 'max-wallet': ['buy', 'send'], 'sell-cap': ['sell'], 'hold-timer': ['sell', 'send'] };
const BUY = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];   // SOL
const PART = [10, 25, 50, 75, 100];                 // % of the wallet's bag

const WALLET_ICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h15v12H3z"/><path d="M3 7l12-3v3"/><path d="M14 12h7v4h-7z"/></svg>`;
const T22_ICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M8.5 12h7M12 8.5v7" stroke-width="1.4" opacity=".7"/></svg>`;
const ENGINE_ICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18v12H3z"/><path d="M7 9v6M11 9v6M15 9v6" stroke-width="2.4"/><path d="M19 9v6" opacity=".4" stroke-width="2.4"/></svg>`;

export function mountFlow(el) {
  const state = { kind: 'buy', size: { buy: 3, sell: 1, send: 1 }, when: 'hour' };
  const b = budget(SAMPLE);
  const blocks = SAMPLE.map((s) => byId[s.id]);
  const acctLabel = { stack: 'Stack PDA', walletSrc: 'Wallet record · sender', walletDst: 'Wallet record · receiver', pool: 'DBC pool (price)' };

  el.innerHTML = `
  <div class="flow-controls">
    <div class="ctl"><span class="ctl-k pixel">Transfer</span>
      <div class="seg" role="group" aria-label="Transfer kind">${['buy', 'sell', 'send'].map((k) => `<button type="button" data-kind="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
    <div class="ctl ctl-size"><span class="ctl-k pixel">Size</span>
      <div class="size-row"><input type="range" min="0" step="1" aria-label="Size"><output class="num"></output></div></div>
    <div class="ctl"><span class="ctl-k pixel">When</span>
      <div class="seg" role="group" aria-label="Moment in the launch">${Object.entries(WHEN).map(([k, w]) => `<button type="button" data-when="${k}">${w.label}</button>`).join('')}</div></div>
  </div>
  <p class="flow-wallet"></p>
  <div class="flow-diagram">
    <div class="fnode nr f-wallet"><span class="fstep pixel">01</span><span class="fico">${WALLET_ICO}</span><b>Wallet</b><small class="fw-text"></small></div>
    <div class="farrow" aria-hidden="true"><i></i></div>
    <div class="fnode nr f-t22"><span class="fstep pixel">02</span><span class="fico">${T22_ICO}</span><b>Token-2022</b><small><span class="mono">transfer_checked</span> sees the mint's TransferHook and calls the engine before anything moves.</small></div>
    <div class="farrow" aria-hidden="true"><i></i></div>
    <div class="fengine nr">
      <div class="fengine-head"><span class="fstep pixel">03</span><span class="fico">${ENGINE_ICO}</span><div><span class="fe-name"><b class="mono">hookrz_engine</b><span class="dim"> · Execute</span></span><small>Runs the stack in slot order. The first refusal wins.</small></div>
        <span class="fcu"><span class="num">${b.cu.toLocaleString('en-US')}</span><span class="dim"> / ${ENGINE.cuBudget.toLocaleString('en-US')} CU</span></span></div>
      <div class="faccts"><span class="pixel dim">Reads via ExtraAccountMetaList</span>${b.accounts.map((a) => `<span class="acct" title="${esc(a.label)}">${acctLabel[a.key] ?? esc(a.label)}</span>`).join('')}</div>
      <ol class="fslots">${blocks.map((x, i) => `
        <li class="fslot nr" data-i="${i}"><span class="fslot-n pixel">${String(i + 1).padStart(2, '0')}</span><span class="fcube">${cube(x.family, { size: 40 })}</span>
          <b>${esc(x.name)}</b><span class="fparam">${esc(x.summary(SAMPLE[i].params))}</span><span class="fhex mono">${x.code != null ? hex(x.code) : ENFORCERS[x.enforcedBy].name}</span><span class="fv pixel"></span></li>`).join('')}</ol>
    </div>
    <div class="farrow last" aria-hidden="true"><i></i></div>
    <div class="fnode nr fresult"><span class="fstep pixel">04</span><span class="fico fres-ico"></span><b class="fres-title"></b><small class="fres-code mono"></small><small class="fres-text"></small></div>
  </div>`;

  const $ = (s) => el.querySelector(s);
  const range = $('input[type=range]'), out = $('output');
  const slotEls = [...el.querySelectorAll('.fslot')];
  let stagger = [];

  const ctxFor = () => {
    const w = WHEN[state.when];
    const curve = new Curve();
    const targetTok = curve.vTok - (curve.vTok - CURVE.gradTok) * Math.min(0.999, w.progress);
    curve.vSol = curve.k / targetTok; curve.vTok = targetTok;
    const bag = (SUPPLY * w.bal) / 100;
    const lots = w.lots.map(([t, f]) => ({ t, amt: bag * f }));
    const kind = state.kind;
    let amount, sol = 0, priceAfter;
    if (kind === 'buy') { sol = BUY[state.size.buy]; amount = curve.quoteBuy(sol, 1).out; priceAfter = curve.priceAfterBuy(sol, 1); }
    else { amount = (bag * PART[state.size[kind]]) / 100; priceAfter = kind === 'sell' ? curve.priceAfterSell(amount, 1) : curve.price; }
    return {
      kind, amount, sol, supply: SUPPLY, t: w.t, slot: Math.floor(w.t / 0.4), hour: 15, progress: w.progress,
      priceAfter, windowOpenPrice: curve.price,
      srcBefore: kind === 'buy' ? 0 : bag,
      dstAfter: kind === 'buy' ? bag + amount : kind === 'send' ? (SUPPLY * w.recv) / 100 + amount : 0,
      isCreatorSrc: false, isCreator: false,
      w: { lots, lastBuySlot: Math.floor(lots[lots.length - 1].t / 0.4), lastSellT: null, firstT: lots[0].t },
      slotBuys: 0, hourSold: 0, hasPass: true, gateBal: 0, blocked: false,
    };
  };

  const pctOf = (tok) => `${+((tok / SUPPLY) * 100).toFixed(2)}%`;

  const render = (animate = true) => {
    const { kind } = state;
    const w = WHEN[state.when];
    el.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.kind === kind)));
    el.querySelectorAll('[data-when]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.when === state.when)));
    const scale = kind === 'buy' ? BUY : PART;
    range.max = String(scale.length - 1);
    range.value = String(state.size[kind]);
    range.style.setProperty('--fill', `${(state.size[kind] / (scale.length - 1)) * 100}%`);

    const ctx = ctxFor();
    const v = evaluate(SAMPLE, ctx);
    const what = kind === 'buy' ? `${BUY[state.size.buy]} SOL` : `${PART[state.size[kind]]}% of the bag`;
    out.textContent = kind === 'buy' ? `${BUY[state.size.buy]} SOL` : `${PART[state.size[kind]]}%`;
    $('.flow-wallet').innerHTML = kind === 'buy'
      ? `A wallet holding <b class="num">${pctOf((SUPPLY * w.bal) / 100)}</b> of supply buys <b class="num">${num(ctx.amount)}</b> tokens (<b class="num">${pctOf(ctx.amount)}</b>) with <b class="num">${what}</b>, <span class="num">${w.label.replace('Launch ', '')}</span> after launch, curve <b class="num">${Math.round(w.progress * 100)}%</b> full.`
      : kind === 'sell'
        ? `A wallet holding <b class="num">${pctOf((SUPPLY * w.bal) / 100)}</b> of supply sells <b class="num">${num(ctx.amount)}</b> tokens (<b class="num">${pctOf(ctx.amount)}</b>), <span class="num">${w.label.replace('Launch ', '')}</span> after launch. ${state.when === 'hour' ? 'Part of its bag arrived 30 minutes ago.' : state.when === 'launch' ? 'Its whole bag arrived 22 seconds ago.' : 'Its coins arrived hours ago.'}`
        : `A wallet sends <b class="num">${num(ctx.amount)}</b> tokens (<b class="num">${pctOf(ctx.amount)}</b>) to a wallet that already holds <b class="num">${w.recv}%</b>, <span class="num">${w.label.replace('Launch ', '')}</span> after launch.`;
    el.querySelector('.fw-text').innerHTML = `Signs a <b>${kind}</b> of <span class="mono">${kind === 'buy' ? what : num(ctx.amount)}</span>`;

    const stopAt = v.ok ? -1 : SAMPLE.findIndex((s) => s.id === v.refusedBy);
    const checked = blocks.filter((x, i) => x.check && (!APPLIES[x.id] || APPLIES[x.id].includes(kind)) && (stopAt < 0 || i < stopAt)).length;
    stagger.forEach(clearTimeout); stagger = [];
    slotEls.forEach((s, i) => {
      const blk = blocks[i];
      let st, label;
      if (!blk.check) { st = 'off'; label = 'Off path'; }
      else if (stopAt >= 0 && i > stopAt) { st = 'skip'; label = 'Not reached'; }
      else if (i === stopAt) { st = 'refused'; label = 'Refused'; }
      else if (APPLIES[blk.id] && !APPLIES[blk.id].includes(kind)) { st = 'na'; label = `Skips ${kind}s`; }
      else { st = 'pass'; label = 'Pass'; }
      const apply = () => {
        s.className = 'fslot nr ' + st;
        s.querySelector('.cube').className = 'cube' + (st === 'pass' ? ' lit' : st === 'refused' ? ' refused' : '');
        s.querySelector('.fv').innerHTML = (st === 'pass' ? ICON.check : st === 'refused' ? ICON.stop : '') + `<span>${label}</span>`;
      };
      if (animate && !reduce()) { s.className = 'fslot nr pending'; stagger.push(setTimeout(apply, 120 + i * 110)); } else apply();
    });

    const res = el.querySelector('.fresult');
    const settle = () => {
      const blk = v.ok ? null : byId[v.refusedBy];
      res.className = 'fnode nr fresult ' + (v.ok ? 'ok' : 'no');
      el.querySelector('.flow-diagram').classList.toggle('refused', !v.ok);
      el.querySelector('.fres-ico').innerHTML = v.ok ? ICON.check : ICON.stop;
      el.querySelector('.fres-title').textContent = v.ok ? 'Lands' : 'Refused';
      el.querySelector('.fres-code').textContent = v.ok ? `${checked} ${checked === 1 ? 'check' : 'checks'} passed` : `custom error ${hex(blk.code)}`;
      el.querySelector('.fres-text').innerHTML = v.ok
        ? `The tokens move. ${blocks.filter((x) => !x.check).map((x) => esc(x.name)).join(', ')} runs later on the keeper, off the transfer path.`
        : `<b>${esc(blk.name)}:</b> ${esc(v.message)}. Token-2022 fails the whole transaction; nothing moves.`;
    };
    if (animate && !reduce()) { res.className = 'fnode nr fresult pending'; stagger.push(setTimeout(settle, 120 + (stopAt >= 0 ? stopAt + 1 : SAMPLE.length) * 110 + 80)); } else settle();
  };

  el.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]'), w = e.target.closest('[data-when]');
    if (k) { state.kind = k.dataset.kind; render(); }
    if (w) { state.when = w.dataset.when; render(); }
  });
  range.addEventListener('input', () => { state.size[state.kind] = +range.value; render(); });
  render(false);
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
