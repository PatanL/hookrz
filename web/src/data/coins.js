// Coin data helpers. There are no seeded coins; launches come from the API (or this browser while MODE is 'demo').
// Lineage (parent) is what makes "Remix" visible: a coin launched from another coin's stack.
import { rng, CURVE, SUPPLY } from '../engine/sim.js';

export const SOL_USD = 150; // demo constant, not a price feed

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fakeKey(seed, suffix = '') {
  const r = rng(seed * 7919 + 13);
  let s = '';
  for (let i = 0; i < 44 - suffix.length; i++) s += B58[Math.floor(r() * 58)];
  return s + suffix;
}
export const short = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`;


export const CREATORS = {};

// No coins are seeded. The explorer shows real launches only (and, while MODE is 'demo', coins launched from this browser).
export const COINS = [];

export const coinBy = Object.fromEntries(COINS.map((c) => [c.ticker, c]));

/** Derived, deterministic demo stats. */
export function stats(c, i = COINS.indexOf(c)) {
  const r = rng(1000 + i * 31);
  // on the curve, market cap is exactly the curve price at this progress (so quotes and cards agree)
  const mcapSol = c.graduated ? curveMcapSol(1) * (1.6 + r() * 5.5) : curveMcapSol(c.progress);
  const trades = Math.round(80 + c.progress * 2600 * (0.6 + r()) + (c.graduated ? 4000 : 0));
  const refusedRate = 0.03 + r() * 0.12;
  return {
    mint: c.test ? null : fakeKey(i + 1, 'hk'),
    mcapUsd: mcapSol * SOL_USD,
    vol24Usd: mcapSol * SOL_USD * (0.4 + r() * 2.2) * (c.minutesAgo < 1440 ? 1 : 0.45),
    change24: c.test ? 2.4 : Math.max(-92, (r() - 0.32) * (c.minutesAgo < 600 ? 900 : 160)),
    holders: Math.round(40 + c.progress * 900 * (0.6 + r()) + (c.graduated ? 1400 : 0)),
    trades, checked: trades, refused: Math.round(trades * refusedRate),
    remixes: COINS.filter((x) => x.parent === c.ticker).length,
    royaltiesSol: 0,
  };
}

/** Market cap (SOL) of a coin whose curve is `progress` filled: price × supply on the virtual-reserve curve. */
export function curveMcapSol(progress) {
  const k = CURVE.vSol0 * CURVE.vTok0;
  const vTok = CURVE.vTok0 - (CURVE.vTok0 - CURVE.gradTok) * Math.min(0.999, progress);
  return (k / vTok / vTok) * SUPPLY;
}

/** Lineage helpers. */
export const childrenOf = (t) => COINS.filter((c) => c.parent === t);
export function rootOf(t) { let c = coinBy[t]; while (c?.parent) c = coinBy[c.parent]; return c; }
export function descendants(t) { const out = []; const walk = (x) => childrenOf(x).forEach((c) => { out.push(c); walk(c.ticker); }); walk(t); return out; }
