// The block details drawer: full spec, live settings, the rendered error, and a tester that runs
// the reference engine (engine.evaluate) against one transfer. Non-hook blocks get an explainer
// of what the curve, keeper or mint does instead.
import { byId, defaults, hex, errName, ENFORCERS, familyOf } from '../data/blocks.js';
import { evaluate, largestAllowed } from '../engine/engine.js';
import { SUPPLY } from '../engine/sim.js';
import { FEES } from '../api/contract.js';
import { api } from '../api/client.js';
import { esc } from '../core/format.js';
import { toast } from './chrome.js';
import { CHECKS, STATE_LABEL, STATE_LONG, paramValue, flagsHtml, famLabel, plainLine } from './blocks-card.js';
import { pxTile, ruleName } from './coin-shared.js';
import { ideaById, ideaTile } from './blocks-ideas.js';
import { mountRulePlay, hasPlay } from './rule-play.js';
import { editorHTML as hsEditorHTML, stateFromDraft, ideaState, refresh as refreshHs, wire as wireHs, needsCheck, testerHTML, mountTester, EXAMPLES } from './hs-editor.js';

// ───────── formatting ─────────
export const dur = (s) => {
  s = Math.max(0, s);
  if (s < 60) return `${+s.toFixed(1)}s`;
  if (s < 3600) { const m = Math.floor(s / 60), r = Math.round(s % 60); return r ? `${m}m ${r}s` : `${m}m`; }
  if (s < 86400) return `${+(s / 3600).toFixed(1)}h`;
  return `${+(s / 86400).toFixed(1)}d`;
};
const pctf = (v) => `${+(+v).toFixed(3)}%`;
const sol = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' SOL';
const KIND_NOUN = { buy: 'buy', sell: 'sell', send: 'send' };

// ───────── tester knobs ─────────
const PCT = [0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 15, 20];
const T = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, 14400, 21600, 43200, 86400, 172800, 259200, 345600, 432000, 604800, 1209600, 2592000, 5184000];

const KNOB = {
  amountPct: { label: () => 'Amount', steps: PCT.slice(1), fmt: (v) => `${v}% of supply` },
  t: { label: () => 'Time since launch', steps: T, fmt: dur },
  isCreator: { label: () => 'It is the creator\'s buy inside the launch transaction', toggle: true, when: (k) => k.kind === 'buy' },
  slotBuys: { label: () => 'Buys already landed in this slot', min: 0, max: 8, step: 1, fmt: (v) => `${v}`, when: (k) => k.kind === 'buy' },
  dstBal: { label: (k) => (k.kind === 'send' ? 'Receiver holds before' : 'Buyer holds before'), steps: PCT, fmt: (v) => `${v}% of supply`, when: (k) => k.kind !== 'sell' },
  srcBal: { label: (k) => (k.kind === 'send' ? 'Sender holds' : 'Seller holds'), steps: PCT.slice(1), fmt: (v) => `${v}% of supply`, when: (k) => k.kind !== 'buy' },
  lastBuyAgo: { label: () => 'This wallet\'s last buy', steps: [null, 0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 100, 150, 300], fmt: (v) => (v == null ? 'never' : `${v} slot${v === 1 ? '' : 's'} ago`), when: (k) => k.kind === 'sell' },
  blocked: { label: () => 'Sender or receiver has a block marker', toggle: true },
  hasPass: { label: () => 'Buyer holds an allowlist pass', toggle: true, when: (k) => k.kind === 'buy' },
  lastSellAgo: { label: () => 'This wallet\'s last sell', steps: [null, 0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300], fmt: (v) => (v == null ? 'never' : `${dur(v * 60)} ago`), when: (k) => k.kind === 'sell' },
  recentPct: { label: () => 'Of that, received recently', steps: PCT, fmt: (v) => `${v}% of supply`, when: (k) => k.kind !== 'buy' },
  recentAgo: { label: () => 'Received this long ago', steps: [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440, 2880], fmt: (v) => `${dur(v * 60)} ago`, when: (k) => k.kind !== 'buy' },
  move: { label: () => 'Price after the trade vs. window open', min: -60, max: 60, step: 1, fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`, when: (k) => k.kind !== 'send' },
  hour: { label: () => 'Hour of the trade (UTC)', min: 0, max: 23, step: 1, fmt: (v) => `${String(v).padStart(2, '0')}:00` },
  heldH: { label: () => 'Hours since this wallet\'s first buy', steps: [0, 0.5, 1, 2, 3, 4, 5, 6, 8, 12, 24, 48], fmt: (v) => `${v}h`, when: (k) => k.kind === 'sell' },
  hourSold: { label: () => 'Already sold this hour', steps: PCT, fmt: (v) => `${v}% of supply`, when: (k) => k.kind === 'sell' },
  progress: { label: () => 'Curve filled', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
  isCreatorSrc: { label: () => 'Sender is the creator', toggle: true, when: (k) => k.kind !== 'buy' },
  gateBal: { label: (k, P) => `Receiver holds of ${P.ticker ?? 'the gate token'}`, steps: [0, 100, 1000, 10000, 50000, 100000, 250000, 500000, 1000000], fmt: (v) => v.toLocaleString('en-US'), when: (k) => k.kind !== 'sell' },
};

const BASE = { kind: 'buy', amountPct: 0.5, t: 30, isCreator: false, slotBuys: 0, dstBal: 0, srcBal: 1, lastBuyAgo: null, blocked: false, hasPass: true, lastSellAgo: null, recentPct: 0, recentAgo: 30, move: 0, hour: 15, heldH: 0, hourSold: 0, progress: 30, isCreatorSrc: false, gateBal: 0 };

/** Per block: which knobs matter, a transfer it refuses, and a nearby one that lands. */
const SCEN = {
  'snipe-shield': { knobs: ['isCreator'], refuse: { kind: 'buy', amountPct: 0.5, t: 20 }, land: { amountPct: 0.25 } },
  'anti-bundle': { knobs: ['slotBuys', 'isCreator'], refuse: { kind: 'buy', amountPct: 0.1, t: 30, slotBuys: 2 }, land: { slotBuys: 1 } },
  'max-wallet': { knobs: ['dstBal'], refuse: { kind: 'buy', amountPct: 1, dstBal: 1.5 }, land: { amountPct: 0.4 } },
  'rising-max': { knobs: ['dstBal'], refuse: { kind: 'buy', amountPct: 0.5, dstBal: 0.25, t: 1800 }, land: { t: 21600 } },
  'sandwich-guard': { knobs: ['srcBal', 'lastBuyAgo'], refuse: { kind: 'sell', amountPct: 0.2, srcBal: 0.5, lastBuyAgo: 1 }, land: { lastBuyAgo: 10 } },
  'blocklist': { knobs: ['blocked'], refuse: { kind: 'send', amountPct: 0.1, srcBal: 0.5, blocked: true }, land: { blocked: false } },
  'allowlist-phase': { knobs: ['hasPass'], refuse: { kind: 'buy', amountPct: 0.1, t: 600, hasPass: false }, land: { hasPass: true } },
  'sell-cap': { knobs: ['srcBal'], refuse: { kind: 'sell', amountPct: 1.5, srcBal: 3 }, land: { amountPct: 0.75 } },
  'sell-cooldown': { knobs: ['srcBal', 'lastSellAgo'], refuse: { kind: 'sell', amountPct: 0.2, srcBal: 1, lastSellAgo: 5, t: 3600 }, land: { lastSellAgo: 20 } },
  'hold-timer': { knobs: ['srcBal', 'recentPct', 'recentAgo'], refuse: { kind: 'sell', amountPct: 0.6, srcBal: 1, recentPct: 0.6, recentAgo: 20, t: 7200 }, land: { amountPct: 0.4 } },
  'circuit-breaker': { knobs: ['move'], refuse: { kind: 'buy', amountPct: 2, move: 28 }, land: { amountPct: 1, move: 12 } },
  'trading-hours': { knobs: ['hour'], refuse: { kind: 'buy', amountPct: 0.2, hour: 9 }, land: { hour: 15 } },
  'seasoned-sells': { knobs: ['srcBal', 'heldH'], refuse: { kind: 'sell', amountPct: 0.5, srcBal: 1, heldH: 0.5, t: 7200 }, land: { heldH: 5, t: 21600 } },
  'outflow-cap': { knobs: ['srcBal', 'hourSold'], refuse: { kind: 'sell', amountPct: 1, srcBal: 2, hourSold: 4.5 }, land: { hourSold: 2 } },
  'lock-in': { knobs: ['srcBal', 'progress'], refuse: { kind: 'sell', amountPct: 0.2, srcBal: 1, progress: 12 }, land: { progress: 40 } },
  'creator-vest': { knobs: ['isCreatorSrc', 'srcBal'], refuse: { kind: 'sell', amountPct: 0.5, srcBal: 2, isCreatorSrc: true, t: 86400 }, land: { amountPct: 0.05, t: 345600 } },
  'token-gate': { knobs: ['gateBal'], refuse: { kind: 'buy', amountPct: 0.2, gateBal: 1000 }, land: { gateBal: 500000 } },
  'chapters': { knobs: ['dstBal', 'progress'], refuse: { kind: 'buy', amountPct: 0.4, dstBal: 0.3, progress: 10 }, land: { progress: 50 } },
};

function buildCtx(k) {
  const S = SUPPLY, amount = (k.amountPct / 100) * S, t = k.t, slot = Math.floor(t / 0.4);
  const srcBefore = k.kind === 'buy' ? 0 : (k.srcBal / 100) * S;
  return {
    kind: k.kind, amount, supply: S, t, slot, hour: k.hour, progress: k.progress / 100,
    priceAfter: 1 + k.move / 100, windowOpenPrice: 1,
    srcBefore, dstAfter: k.kind === 'sell' ? 0 : (k.dstBal / 100) * S + amount,
    isCreatorSrc: k.isCreatorSrc && k.kind !== 'buy', isCreator: k.isCreator && k.kind === 'buy',
    w: {
      lots: k.recentPct > 0 ? [{ t: t - k.recentAgo * 60, amt: Math.min(k.recentPct / 100 * S, srcBefore) }] : [],
      lastBuySlot: k.lastBuyAgo == null ? null : slot - k.lastBuyAgo,
      lastSellT: k.lastSellAgo == null ? null : t - k.lastSellAgo * 60,
      firstT: t - k.heldH * 3600,
    },
    slotBuys: k.slotBuys, hourSold: (k.hourSold / 100) * S, hasPass: k.hasPass, gateBal: k.gateBal, blocked: k.blocked,
  };
}

// ───────── controls ─────────
function near(steps, v) {
  const i = steps.indexOf(v);
  if (i >= 0) return i;
  let bi = 0, bd = Infinity;
  steps.forEach((s, j) => { if (s != null && v != null && Math.abs(s - v) < bd) { bd = Math.abs(s - v); bi = j; } });
  return bi;
}

function knobHtml(key, k, P) {
  const d = KNOB[key];
  const label = d.label(k, P);
  if (d.toggle) return `<label class="bd-toggle" data-knob="${key}"><input type="checkbox" ${k[key] ? 'checked' : ''}><span class="sw" aria-hidden="true"></span><span>${esc(label)}</span></label>`;
  const steps = d.steps;
  const min = steps ? 0 : d.min, max = steps ? steps.length - 1 : d.max, step = steps ? 1 : d.step;
  const val = steps ? near(steps, k[key]) : k[key];
  return `<div class="bd-knob" data-knob="${key}"><div class="bd-prow"><label for="k-${key}">${esc(label)}</label><output class="mono">${esc(d.fmt(k[key]))}</output></div>
    <input type="range" id="k-${key}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
}

function paramHtml(p, v) {
  if (p.options) return `<div class="bd-param" data-param="${p.key}"><div class="bd-prow"><label for="p-${p.key}">${esc(p.label)}</label></div>
    <select class="input" id="p-${p.key}">${p.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  if (p.text) return `<div class="bd-param" data-param="${p.key}"><div class="bd-prow"><label for="p-${p.key}">${esc(p.label)}</label></div>
    <textarea class="input" id="p-${p.key}" rows="2" maxlength="240">${esc(v)}</textarea></div>`;
  return `<div class="bd-param" data-param="${p.key}"><div class="bd-prow"><label for="p-${p.key}">${esc(p.label)}</label><output class="mono">${esc(p.fmt(v))}</output></div>
    <input type="range" id="p-${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">
    <div class="bd-prange mono"><span>${esc(String(p.fmt(p.min)).replace(/\s*\(.*\)$/, ''))}</span><span>${esc(String(p.fmt(p.max)).replace(/\s*\(.*\)$/, ''))}</span></div></div>`;
}

// ───────── explainer panels for blocks that don't refuse ─────────
const VOL = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const CREATOR_PCT = FEES.split.find((s) => s.who === 'Creator')?.pct ?? 50;

const CRANK_DEST = {
  'buyback-burn': () => 'swapped for the coin and burned, every hour',
  'holder-rewards': (P) => `funded into a claim vault for holders with at least ${pctf(P.min)} of supply, by balance`,
  'first-buyer-rebate': (P, v) => `split across the first ${P.n} buyers still holding at graduation: about ${sol(v / P.n)} each`,
  'tithe': () => 'sent to the tithe address fixed at launch',
  'kingmaker': () => 'paid to the top holder at graduation, for 30 days',
  'diamond-tiers': () => 'split among wallets wearing a crown',
};

function crankPanel(b) {
  let vi = 3;
  return {
    html: () => `<div class="bd-crank">
      <div class="bd-knob"><div class="bd-prow"><label for="k-vol">Trading volume</label><output class="mono" data-o="vol"></output></div>
      <input type="range" id="k-vol" min="0" max="${VOL.length - 1}" step="1" value="${vi}"></div>
      <div class="bd-flow" data-o="flow"></div>
      <p class="bd-note">The keeper is a public crank: anyone can run it, and every claim, swap, burn and payout is its own transaction on the coin page. After graduation it keeps going on the DAMM v2 LP fees.</p></div>`,
    mount(el, get) { el.querySelector('#k-vol').oninput = (e) => { vi = +e.target.value; this.update(el, get()); }; },
    update(el, P) {
      const v = VOL[vi], fee = v * FEES.tradeFeePct / 100, creator = fee * CREATOR_PCT / 100, share = creator * P.pct / 100;
      el.querySelector('[data-o="vol"]').textContent = `${v.toLocaleString('en-US')} SOL / day`;
      el.querySelector('[data-o="flow"]').innerHTML = [
        ['Volume', `${v.toLocaleString('en-US')} SOL`, 'per day on the curve'],
        [`${FEES.tradeFeePct}% fee`, sol(fee), 'collected by the pool'],
        [`Creator ${CREATOR_PCT}%`, sol(creator), 'the creator\'s fee share'],
        [`${b.name} ${P.pct}%`, sol(share), CRANK_DEST[b.id](P, share)],
      ].map(([k, n, s], i) => `<div class="bd-fstep${i === 3 ? ' hi' : ''}"><span class="pixel">${esc(k)}</span><b class="num">${n}</b><small>${esc(s)}</small></div>`).join('');
    },
  };
}

function feePanel(b) {
  let tSel = 10, buy = 1, W = 560;
  const BUYS = [0.1, 0.25, 0.5, 1, 2, 5, 10];
  const chart = (P) => {
    const H = W < 450 ? 200 : 220, L = 44, R = 16, Tp = 18, B = 34;
    const tMax = Math.max(20, Math.ceil(P.seconds * 1.35 / 10) * 10), fMax = Math.max(5, P.start);
    const x = (t) => L + (W - L - R) * t / tMax, y = (f) => Tp + (H - Tp - B) * (1 - f / fMax);
    const pts = []; for (let i = 0; i <= 120; i++) { const t = tMax * i / 120; pts.push([x(t), y(b.fee(P, t))]); }
    const line = pts.map(([a, c], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${c.toFixed(1)}`).join('');
    const area = `M${x(0)} ${y(1)}` + pts.map(([a, c]) => `L${a.toFixed(1)} ${c.toFixed(1)}`).join('') + `L${x(tMax)} ${y(1)}Z`;
    const yt = [1, Math.round(fMax / 2), fMax], xt = [0, Math.round(P.seconds / 2), P.seconds, tMax];
    const ts = Math.min(tSel, tMax), fs = b.fee(P, ts);
    return `<svg viewBox="0 0 ${W} ${H}" class="bd-chart" role="img" aria-label="Trading fee from ${P.start}% at launch to 1% after ${P.seconds} seconds">
      <defs><linearGradient id="fburn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fcaff" stop-opacity=".32"/><stop offset="1" stop-color="#8fcaff" stop-opacity=".03"/></linearGradient></defs>
      ${yt.map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(f)}" y2="${y(f)}" class="g${f === 1 ? ' base' : ''}"/><text x="${L - 8}" y="${y(f) + 3.5}" text-anchor="end">${f}%</text>`).join('')}
      ${xt.map((t) => `<text x="${x(t)}" y="${H - 12}" text-anchor="middle">${t}s</text>`).join('')}
      <path d="${area}" fill="url(#fburn)"/>
      <path d="${line}" class="ln"/>
      <text x="${x(Math.min(P.seconds * 0.22, tMax)) + 6}" y="${y(1) - 8}" class="lbl">burned</text>
      <text x="${W - R}" y="${y(1) - 8}" text-anchor="end" class="lbl dim">1% base fee</text>
      <line x1="${x(ts)}" x2="${x(ts)}" y1="${Tp}" y2="${H - B}" class="cross"/>
      <rect x="${x(ts) - 4}" y="${y(fs) - 4}" width="8" height="8" class="dot"/>
      <rect x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}" fill="transparent" class="hit"/>
    </svg>`;
  };
  return {
    html: () => `<div class="bd-fee"><div class="bd-chartwrap" data-o="chart"></div>
      <div class="bd-knobs two">
        <div class="bd-knob"><div class="bd-prow"><label for="k-ft">Seconds after launch</label><output class="mono" data-o="ft"></output></div><input type="range" id="k-ft" min="0" max="600" step="1" value="${tSel}"></div>
        <div class="bd-knob"><div class="bd-prow"><label for="k-fb">Buy size</label><output class="mono" data-o="fb"></output></div><input type="range" id="k-fb" min="0" max="${BUYS.length - 1}" step="1" value="3"></div>
      </div>
      <p class="bd-readout" data-o="read" aria-live="polite"></p>
      <p class="bd-note">Nothing is refused. Meteora DBC's fee scheduler sets the fee per swap; the keeper claims everything above the 1% base and uses it to buy the coin back and burn it. After the decay, trading pays the normal 1%.</p></div>`,
    mount(el, get) {
      const ft = el.querySelector('#k-ft');
      ft.oninput = () => { tSel = +ft.value; this.update(el, get()); };
      el.querySelector('#k-fb').oninput = (e) => { buy = BUYS[+e.target.value]; this.update(el, get()); };
      el.querySelector('[data-o="chart"]').addEventListener('pointermove', (e) => {
        const svg = e.currentTarget.querySelector('svg'); if (!svg) return;
        const r = svg.getBoundingClientRect(), P = get();
        const tMax = Math.max(20, Math.ceil(P.seconds * 1.35 / 10) * 10);
        const px = ((e.clientX - r.left) / r.width) * W;
        tSel = Math.round(Math.max(0, Math.min(tMax, ((px - 44) / (W - 60)) * tMax)));
        ft.value = tSel; this.update(el, P);
      });
    },
    update(el, P) {
      el.querySelector('#k-ft').max = Math.max(20, Math.ceil(P.seconds * 1.35 / 10) * 10);
      tSel = Math.min(tSel, +el.querySelector('#k-ft').max);
      const box = el.querySelector('[data-o="chart"]');
      W = Math.round(Math.max(300, Math.min(560, (box.clientWidth || 560) - 8)));
      box.innerHTML = chart(P);
      const f = b.fee(P, tSel), fee = buy * f / 100, burned = buy * Math.max(0, f - 1) / 100, base = buy * Math.min(f, 1) / 100;
      el.querySelector('[data-o="ft"]').textContent = `${tSel}s`;
      el.querySelector('[data-o="fb"]').textContent = `${buy} SOL`;
      el.querySelector('[data-o="read"]').innerHTML = f > 1
        ? `At <b class="num">${tSel}s</b> the fee is <b class="num">${f.toFixed(1)}%</b>. A <b class="num">${buy} SOL</b> buy pays <b class="num">${sol(fee)}</b>: <b class="num ice">${sol(burned)}</b> buys the coin back and burns it, <b class="num">${sol(base)}</b> is the normal 1% split.`
        : `At <b class="num">${tSel}s</b> the decay is over: a <b class="num">${buy} SOL</b> buy pays the normal <b class="num">1%</b> (${sol(base)}). Nothing extra is burned.`;
    },
  };
}

function staticPanel(rows, note) {
  return {
    html: () => `<div class="bd-kv">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b class="mono">${v}</b></div>`).join('')}</div>${note ? `<p class="bd-note">${note}</p>` : ''}`,
    mount() {}, update() {},
  };
}

function lpPanel() {
  return {
    html: () => `<div class="bd-lp"><div class="bd-bar" data-o="bar"></div><div class="bd-kv" data-o="kv"></div>
      <p class="bd-note">Nothing is refused. Meteora DBC locks the share at migration; the lock is permanent and no key can undo it. LP fees from the locked part still flow to the fee split and the keeper.</p></div>`,
    mount() {},
    update(el, P) {
      el.querySelector('[data-o="bar"]').innerHTML = `<span class="lock" style="width:${P.pct}%">${P.pct}% locked for good</span>${P.pct < 100 ? `<span class="free" style="width:${100 - P.pct}%">${100 - P.pct}%</span>` : ''}`;
      el.querySelector('[data-o="kv"]').innerHTML = `<div><span>Locked</span><b class="mono">${P.pct}% of the DAMM v2 position</b></div><div><span>Unlocked</span><b class="mono">${100 - P.pct}% to the creator's LP position</b></div><div><span>Set by</span><b class="mono">DBC config, at launch</b></div>`;
    },
  };
}

function diamondPanel(b) {
  let held = 30, sold = false;
  const crank = crankPanel(b);
  return {
    html: () => `<div class="bd-knobs two">
        <div class="bd-knob"><div class="bd-prow"><label for="k-dh">Hours since first buy</label><output class="mono" data-o="dh"></output></div><input type="range" id="k-dh" min="0" max="168" step="1" value="${held}"></div>
        <label class="bd-toggle"><input type="checkbox" id="k-ds"><span class="sw" aria-hidden="true"></span><span>The wallet has sold</span></label>
      </div>
      <div class="bd-verdict" data-o="crown"></div>
      <p class="bd-note">Nothing is refused. On every transfer the engine stamps the holder's Wallet record with its first buy and its first sell. The keeper reads the records and pays the crowned wallets.</p>
      <h4 class="bd-h4">Where the crown money comes from</h4>${crank.html()}`,
    mount(el, get) {
      el.querySelector('#k-dh').oninput = (e) => { held = +e.target.value; this.update(el, get()); };
      el.querySelector('#k-ds').onchange = (e) => { sold = e.target.checked; this.update(el, get()); };
      crank.mount(el, get);
    },
    update(el, P) {
      el.querySelector('[data-o="dh"]').textContent = `${held}h`;
      const crowned = !sold && held >= P.hours;
      const v = el.querySelector('[data-o="crown"]');
      v.className = `bd-verdict ${crowned ? 'ok' : 'wait'}`;
      v.innerHTML = `${pxTile('crown', { size: 40, state: crowned ? 'lit' : 'empty' })}<div><b class="bd-vt">${crowned ? 'Crowned' : sold ? 'No crown' : 'Not yet'}</b>
        <p>${crowned ? `Held ${held}h without selling: this wallet earns from the crown share.` : sold ? 'The record shows a sell, so this wallet can\'t earn the crown on this coin.' : `${P.hours - held}h more without selling and this wallet is crowned.`}</p></div>`;
      crank.update(el, P);
    },
  };
}

function customPanel(idea = null) {
  const KEY = idea ? `bd-idea-${idea}` : 'bd-custom';
  let st = null, seq = 0, tester = null, wired = false;
  return {
    html: () => `<div class="bd-hs">
      ${idea ? '' : `<div class="bd-hsgo"><button class="btn btn-chrome btn-sm" data-act="draft">Draft from your rule</button>
        <span class="bd-hsex"><span class="dim">or try</span>${EXAMPLES.map((x) => `<button type="button" class="bd-chip" data-ex="${esc(x.text)}" title="${esc(x.text)}">${esc(x.label)}</button>`).join('')}</span></div>`}
      <div data-o="hs" aria-live="polite"></div>
      <div class="bd-hstest" data-o="testbox" hidden><h4 class="bd-h4">Try some trades</h4>
        <p class="bd-sub">Buy, sell and send as different wallets and watch the rule decide. The rule remembers between trades, so a crown taken by one buy is still there on the next sell.</p>
        <div data-o="tester"></div></div>
      <p class="bd-note">Hookscript reads the trade, both wallets, the clock, the curve and its own memory, and it can only say no. No loops, no calls out. At most 1,024 bytes and 8,000 CU worst case, or it doesn't compile. Every script is fuzzed against 10,000 generated trades and honeypot-checked before it can launch.</p></div>`,
    mount(el, get) {
      el.querySelector('[data-act="draft"]')?.addEventListener('click', () => this.draft(el, get().prompt));
      el.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
        const ta = el.closest('.bd')?.querySelector('#p-prompt');
        if (ta) { ta.value = b.dataset.ex; ta.dispatchEvent(new Event('input', { bubbles: true })); }
        this.draft(el, b.dataset.ex);
      }));
      if (!wired) { wired = true; wireHs(el, { get: () => st, onChange: () => tester?.sourceChanged() }); }
      if (idea) this.load(el); else this.draft(el, get().prompt);
    },
    async show(el, my) {
      const out = el.querySelector('[data-o="hs"]');
      out.innerHTML = hsEditorHTML(st, KEY, { rows: idea ? 12 : 8 });
      if (needsCheck(st)) refreshHs(KEY, st, () => tester?.sourceChanged());
      const box = el.querySelector('[data-o="testbox"]');
      box.hidden = false;
      if (!tester) {
        const t = el.querySelector('[data-o="tester"]');
        t.innerHTML = testerHTML();
        tester = await mountTester(t, () => st?.source ?? '');
      } else tester.sourceChanged();
      return my;
    },
    async load(el) {
      const my = ++seq, out = el.querySelector('[data-o="hs"]');
      out.innerHTML = `<div class="bd-hsload"><span></span><span></span><span></span><em>Loading the rule…</em></div>`;
      let s0 = null;
      try { s0 = await ideaState(idea); } catch { /* bundle failed to load */ }
      if (my !== seq || !out.isConnected) return;
      if (!s0) { out.innerHTML = '<p class="bd-hserr">This rule didn\'t load. Try again in a moment.</p>'; return; }
      st = s0;
      this.show(el, my);
    },
    async draft(el, prompt) {
      const my = ++seq, out = el.querySelector('[data-o="hs"]');
      const text = (prompt || EXAMPLES[0].text).trim();
      out.innerHTML = `<div class="bd-hsload"><span></span><span></span><span></span><em>Drafting, fuzzing and checking for honeypots…</em></div>`;
      let d;
      try { d = await api.draftHookscript(text); } catch (e) { if (my === seq) out.innerHTML = `<p class="bd-hserr">${esc(e?.message ?? 'The drafter did not answer. Try again.')}</p>`; return; }
      if (my !== seq || !out.isConnected) return;
      if (d.ok === false && !d.bytecodeHex) {
        // the drafter said no: a honeypot request or a rule it can't draft. Explain and offer what it can draft.
        const opts = d.alternative ? [d.alternative] : (d.suggestions ?? []);
        const hp = d.honeypot?.ok === false;
        out.innerHTML = `<div class="bd-declined${hp ? ' hp' : ''}"><p><b>${hp ? 'Not allowed: holders must always be able to sell eventually.' : 'Not drafted.'}</b> ${esc(hp ? (d.message ?? '') : "hookrz can't draft that rule yet. Pick a close one, or write the Hookscript yourself.")}</p>
          ${opts.length ? `<div class="bd-declined-opts"><span class="dim">${hp ? 'Safe version' : 'Closest rules'}</span>${opts.map((o, k) => `<button class="btn btn-glass btn-sm" type="button" data-redraft="${k}">${esc(o.title ?? o.prompt)}</button>`).join('')}</div>` : ''}</div>`;
        out.querySelectorAll('[data-redraft]').forEach((b) => { b.onclick = () => this.draft(el, opts[+b.dataset.redraft].prompt); });
        return;
      }
      st = stateFromDraft(d, text);
      this.show(el, my);
    },
    update() {},
  };
}

function leftoverPanel() {
  return {
    html: () => `<ol class="bd-steps">
      <li><b>The curve completes.</b> The swap that fills it triggers migration.</li>
      <li><b>Meteora migrates the pool to DAMM v2.</b> The base tokens needed for liquidity move into the new pool.</li>
      <li><b>Whatever is left goes to the burn vault.</b> The DBC config names the burn vault as the leftover receiver, fixed at launch.</li>
      <li><b>The keeper burns it.</b> One public transaction, linked on the coin page.</li></ol>
      <p class="bd-note">Nothing is refused. Without this block, leftovers go back to the leftover receiver like any other DBC launch.</p>`,
    mount() {}, update() {},
  };
}

function explainer(b) {
  switch (b.id) {
    case 'sniper-fee-burn': return { title: 'The fee curve', panel: feePanel(b) };
    case 'leftover-burn': return { title: 'What happens at graduation', panel: leftoverPanel() };
    case 'lp-lock': return { title: 'The graduation position', panel: lpPanel() };
    case 'diamond-tiers': return { title: 'Who wears a crown', panel: diamondPanel(b) };
    case 'custom': return { title: 'Your rule, in Hookscript', panel: customPanel() };
    case 'locked-metadata': return { title: 'What the mint says', panel: staticPanel([
      ['Metadata update authority', 'none'], ['Set in', 'create mint (launch instruction 1)'], ['Name, ticker, image, URI', 'final'],
    ], 'Nothing is refused. Token-2022 keeps the metadata on the mint itself, and with no update authority nobody can change it again, hookrz included.') };
    default: return b.enforcedBy === 'crank' ? { title: 'What the keeper does', panel: crankPanel(b) } : null;
  }
}

// ───────── the drawer ─────────
let current = null;
const ARROW = '<svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8h11M9 4l4 4-4 4"/></svg>';

/** The technical spec, at the bottom of the drawer: enforcer, checks, compute, accounts, code, state, route. */
function techHtml(b, id) {
  const rows = [
    ['Enforced by', [b.enforcedBy, b.also].filter(Boolean).map((e) => `<span class="enf ${e}"><i></i>${ENFORCERS[e].name}</span> <span class="muted">${esc(ENFORCERS[e].long)}</span>`).join('<br>')],
    ['Checks', CHECKS[id] ? CHECKS[id].map((x) => x + 's').join(' · ') : b.id === 'custom' ? 'what your rule says' : 'no transfers'],
    ['CU per transfer', `<span class="num">${b.cuRange ? `${b.cuRange[0].toLocaleString('en-US')}–${b.cuRange[1].toLocaleString('en-US')}` : b.cu ? b.cu.toLocaleString('en-US') : '0'}</span>`],
    ['Extra accounts', `<span class="num">+${b.accts}</span>`],
    ['Error code', `<span class="num">${hex(b.code)}</span>${b.code != null ? ` <span class="dim">${errName(b.code)}</span>` : ''}`],
    ['State', `${STATE_LABEL[b.state]} <span class="muted">${esc(STATE_LONG[b.state])}</span>`],
    ['Route', b.route === 'record' ? 'Wallet record <span class="muted">A receiving wallet needs its record. The hookrz router opens it inside the buy; aggregator routes work once it exists.</span>' : 'Any <span class="muted">Works through the hookrz router, aggregators and wallet-to-wallet sends.</span>'],
  ];
  return `<details class="bd-sec bd-tech"><summary><span class="bd-h">Under the hood</span><span class="bd-tech-s">Code ${hex(b.code)} · ${b.cu ? `${b.cu.toLocaleString('en-US')} CU` : 'no compute'} · ${[b.enforcedBy, b.also].filter(Boolean).map((e) => ENFORCERS[e].name).join(' + ')}</span></summary>
    <dl class="bd-kvt">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></details>`;
}

/**
 * Open the details drawer for a rule (`id`), or for a rule idea written in Hookscript ({ idea: '<example name>' }).
 */
export function openDetail(id, { opener, idea = null } = {}) {
  const ix = idea ? ideaById[idea] : null;
  if (idea && !ix) return;
  if (ix) id = 'custom';
  const b = byId[id];
  if (!b) return;
  current?.close(true);
  const fam = familyOf(b.family);
  const P = { ...defaults(id) };
  const scen = ix ? null : SCEN[id];
  let K = scen ? { ...BASE, ...scen.refuse } : null;
  const hasTester = !!scen;
  const exp = hasTester ? null : ix ? { title: 'The rule, in Hookscript', panel: customPanel(ix.id) } : explainer(b);
  const params = ix ? [] : b.params;
  const useHref = ix ? `build.html?idea=${encodeURIComponent(ix.id)}` : `build.html?add=${id}`;

  const back = document.createElement('div');
  back.className = 'bd-back';
  back.innerHTML = `<aside class="bd" role="dialog" aria-modal="true" aria-labelledby="bd-title" tabindex="-1">
    <header class="bd-head">
      ${ix ? ideaTile(ix, 52) : pxTile(b.family, { size: 52 })}
      <div class="bd-ht"><span class="bd-eye">${ix ? 'Rule idea · written in Hookscript' : b.id === 'custom' ? 'Written in Hookscript' : `${esc(famLabel(b.family))} · ${esc(fam.verb.toLowerCase())}`}</span><h2 id="bd-title">${esc(ix ? ix.name : ruleName(b))}</h2><p>${esc(ix ? ix.line : plainLine(b))}</p></div>
      <button class="bd-x" aria-label="Close"><svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l8 8M11 3l-8 8"/></svg></button>
    </header>
    <div class="bd-body">
      ${ix || b.id === 'custom' ? '' : `<section class="bd-sec bd-first"><h3 class="bd-h">What it does</h3><p class="bd-refuses">${esc(b.refuses)}</p></section>`}
      ${ix && hasPlay(ix.id) ? `<section class="bd-sec bd-first bd-play"><h3 class="bd-h">Watch it play</h3><div data-o="play"></div></section>` : ''}
      ${!ix && (b.risk || b.power || b.unreviewed) ? `<div class="bk-flags">${flagsHtml(b, { long: true })}</div>` : ''}
      ${params.length ? `<section class="bd-sec"><div class="row between"><h3 class="bd-h">Settings</h3><button class="btn btn-ghost btn-sm" data-act="reset">Reset</button></div>
        <div class="bd-params">${params.map((p) => paramHtml(p, P[p.key])).join('')}</div></section>` : ''}
      ${hasTester ? `<section class="bd-sec bd-test"><div class="row between wrap-row" style="gap:8px"><h3 class="bd-h">Try a trade</h3>
          <div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" data-scen="refuse">One it blocks</button><button class="btn btn-ghost btn-sm" data-scen="land">One that goes through</button></div></div>
        <p class="bd-sub">Runs the engine's own code on one trade: the same answer a quote gives before you sign.</p>
        <div class="bd-seg" role="radiogroup" aria-label="Trade kind">${['buy', 'sell', 'send'].map((x) => `<button role="radio" data-kind="${x}">${x[0].toUpperCase() + x.slice(1)}${CHECKS[id].includes(x) ? '' : '<small>not checked</small>'}</button>`).join('')}</div>
        <div class="bd-knobs" data-o="knobs"></div>
        <div class="bd-verdict" data-o="verdict" aria-live="polite"></div>
      </section>` : ''}
      ${b.error && b.id !== 'custom' ? `<section class="bd-sec"><h3 class="bd-h">What a blocked trade says</h3>
        <div class="bd-err"><p data-o="err"></p><span class="mono code" title="Error ${hex(b.code)} ${errName(b.code)}">${hex(b.code)}</span></div></section>` : ''}
      ${exp ? `<section class="bd-sec"><h3 class="bd-h">${esc(exp.title)}</h3><div data-o="exp">${exp.panel.html()}</div></section>` : ''}
      ${ix ? '' : techHtml(b, id)}
    </div>
    <footer class="bd-foot"><a class="btn btn-chrome" href="${useHref}">${ix ? 'Launch with this' : 'Use this rule'} ${ARROW}</a><button class="btn btn-glass" data-act="copy">Copy link</button></footer>
  </aside>`;
  document.body.append(back);
  document.documentElement.classList.add('bd-lock');
  const el = back.querySelector('.bd');
  requestAnimationFrame(() => back.classList.add('in'));

  // ── params
  const refreshParams = () => {
    for (const p of params) {
      const o = el.querySelector(`[data-param="${p.key}"] output`);
      if (o) o.textContent = paramValue(p, P[p.key]);
    }
    const err = el.querySelector('[data-o="err"]');
    if (err) err.textContent = b.error(P);
    if (hasTester) runTest();
    if (exp) exp.panel.update(el.querySelector('[data-o="exp"]'), P);
  };
  for (const p of params) {
    const input = el.querySelector(`#p-${p.key}`);
    if (!input) continue;
    input.addEventListener('input', () => { P[p.key] = p.options || p.text ? input.value : +input.value; refreshParams(); });
  }
  el.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
    Object.assign(P, defaults(id));
    for (const p of params) { const i = el.querySelector(`#p-${p.key}`); if (i) i.value = P[p.key]; }
    refreshParams();
  });

  // ── tester
  function renderKnobs() {
    const box = el.querySelector('[data-o="knobs"]');
    const keys = ['amountPct', 't', ...scen.knobs].filter((key) => !KNOB[key].when || KNOB[key].when(K));
    box.innerHTML = keys.map((key) => knobHtml(key, K, P)).join('');
    for (const key of keys) {
      const d = KNOB[key], wrap = box.querySelector(`[data-knob="${key}"]`), input = wrap.querySelector('input');
      input.addEventListener(d.toggle ? 'change' : 'input', () => {
        K[key] = d.toggle ? input.checked : d.steps ? d.steps[+input.value] : +input.value;
        if (!d.toggle) wrap.querySelector('output').textContent = d.fmt(K[key]);
        runTest();
      });
    }
    el.querySelectorAll('[data-kind]').forEach((x) => { x.setAttribute('aria-checked', String(x.dataset.kind === K.kind)); x.classList.toggle('on', x.dataset.kind === K.kind); });
  }
  function runTest() {
    const stack = [{ id, params: { ...P } }];
    const v = evaluate(stack, buildCtx(K));
    const box = el.querySelector('[data-o="verdict"]');
    const what = `${KIND_NOUN[K.kind][0].toUpperCase() + KIND_NOUN[K.kind].slice(1)} of ${K.amountPct}% of supply, ${dur(K.t)} after launch`;
    if (v.ok) {
      const unchecked = !CHECKS[id].includes(K.kind);
      box.className = 'bd-verdict ok';
      box.innerHTML = `${pxTile('check', { size: 40, state: 'lit' })}<div><b class="bd-vt">Goes through</b><span class="bd-vwhat">${esc(what)}</span>
        <p>${unchecked ? `${esc(b.name)} doesn't check ${K.kind}s, so the trade goes through.` : `${esc(b.name)} lets it through. The trade settles.`}</p></div>`;
    } else {
      const hi = K.amountPct;
      const lo = largestAllowed(stack, (a) => buildCtx({ ...K, amountPct: a }), hi);
      const hint = lo > 1e-6 ? `Largest ${K.kind} that goes through now: <b class="num">${+lo.toFixed(3)}% of supply</b>` : `No ${K.kind} of any size goes through right now.`;
      box.className = 'bd-verdict no';
      box.innerHTML = `${pxTile('cross', { size: 40, state: 'refused' })}<div><b class="bd-vt">Blocked <span class="mono" title="Error ${hex(v.code)} ${errName(v.code)}">${hex(v.code)}</span></b><span class="bd-vwhat">${esc(what)}</span>
        <p class="msg">${esc(v.message)}</p><p class="hint">${hint}</p></div>`;
    }
  }
  if (hasTester) {
    el.querySelectorAll('[data-kind]').forEach((x) => x.addEventListener('click', () => { K.kind = x.dataset.kind; renderKnobs(); runTest(); }));
    el.querySelectorAll('[data-scen]').forEach((x) => x.addEventListener('click', () => {
      K = { ...BASE, ...scen.refuse, ...(x.dataset.scen === 'land' ? scen.land : {}) };
      renderKnobs(); runTest();
    }));
    renderKnobs();
  }
  if (exp) exp.panel.mount(el.querySelector('[data-o="exp"]'), () => P);
  refreshParams();
  // a rule idea plays a short scene through its real script first (the footer already has "Launch with this")
  const play = ix && hasPlay(ix.id) ? mountRulePlay(el.querySelector('[data-o="play"]'), { ids: [ix.id], launch: false, head: false }) : null;

  // ── chrome: close, copy, focus, url
  const url = new URL(location.href);
  if (ix) { url.searchParams.set('idea', ix.id); url.searchParams.delete('b'); } else { url.searchParams.set('b', id); url.searchParams.delete('idea'); }
  history.replaceState(history.state, '', url);
  const keydown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = [...el.querySelectorAll('a[href],button,input,select,textarea,summary')].filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', keydown);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  el.querySelector('.bd-x').onclick = () => close();
  el.querySelector('[data-act="copy"]').onclick = async () => {
    const link = `${location.origin}${location.pathname}?${ix ? `idea=${ix.id}` : `b=${id}`}`;
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link); }
  };
  el.focus({ preventScroll: true });

  function close(replaced = false) {
    play?.destroy();
    document.removeEventListener('keydown', keydown);
    back.classList.remove('in');
    back.classList.add('out');
    setTimeout(() => back.remove(), 180);
    if (!replaced) {
      document.documentElement.classList.remove('bd-lock');
      const u = new URL(location.href); u.searchParams.delete('b'); u.searchParams.delete('idea'); history.replaceState(history.state, '', u);
      opener?.focus?.({ preventScroll: true });
    }
    if (current?.el === el) current = null;
  }
  current = { el, close };
  return current;
}
