// Seed coins served by src/api/client.js while MODE is "demo". They are not on chain.
// Lineage (parent) is what makes "Remix" visible: a coin launched from another coin's stack.
import { rng } from '../engine/sim.js';

export const SOL_USD = 150; // demo constant, not a price feed

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fakeKey(seed, suffix = '') {
  const r = rng(seed * 7919 + 13);
  let s = '';
  for (let i = 0; i < 44 - suffix.length; i++) s += B58[Math.floor(r() * 58)];
  return s + suffix;
}
export const short = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`;

const S = (id, params = {}) => ({ id, params });

export const CREATORS = {
  blockwright: { handle: 'blockwright', bio: 'Builds fair launches. Author of Stackmaxxing.' },
  fen: { handle: 'fen.sol', bio: 'Holder-first stacks.' },
  tidepool: { handle: 'tidepool', bio: 'Market structure nerd.' },
  okonkwo: { handle: 'okonkwo', bio: 'Members-only coins.' },
  mira: { handle: 'mira_builds', bio: 'Remixes everything.' },
  sato: { handle: 'satobyte', bio: '' },
  lux: { handle: 'lux.eth', bio: '' },
  gw: { handle: 'gw3n', bio: '' },
};

// minutesAgo = launch age; progress = curve filled; m = demo momentum seed
export const COINS = [
  { ticker: 'STACK', name: 'Stackmaxxing', creator: 'blockwright', minutesAgo: 4320, progress: 1, graduated: true, parent: null,
    desc: 'The original Fair Launch stack. Snipers bounced, bundlers capped, the extra fee burned.',
    stack: [S('snipe-shield', { window: 60, max: 0.3 }), S('anti-bundle', { perSlot: 2, window: 10 }), S('rising-max', { from: 0.5, to: 5, hours: 12 }), S('sniper-fee-burn', { start: 50, seconds: 60 })] },
  { ticker: 'LURE', name: 'Lure', creator: 'mira', minutesAgo: 1880, progress: 0.86, parent: 'STACK',
    desc: 'Stackmaxxing with a tighter wallet cap and holder rewards on top.',
    stack: [S('snipe-shield', { window: 90, max: 0.25 }), S('anti-bundle', { perSlot: 1, window: 15 }), S('rising-max', { from: 0.25, to: 3, hours: 24 }), S('sniper-fee-burn'), S('holder-rewards', { pct: 40 })] },
  { ticker: 'BARB', name: 'Barb', creator: 'gw', minutesAgo: 610, progress: 0.41, parent: 'LURE',
    desc: 'Lure, plus a sandwich guard. Third generation of the Fair Launch family.',
    stack: [S('snipe-shield', { window: 90, max: 0.25 }), S('anti-bundle', { perSlot: 1, window: 15 }), S('rising-max', { from: 0.25, to: 3, hours: 24 }), S('sandwich-guard', { slots: 6 }), S('holder-rewards', { pct: 30 })] },
  { ticker: 'CATCH', name: 'Big Catch', creator: 'sato', minutesAgo: 980, progress: 0.63, parent: 'STACK',
    desc: 'Fair Launch with a circuit breaker instead of the fee burn.',
    stack: [S('snipe-shield'), S('anti-bundle'), S('rising-max'), S('circuit-breaker', { band: 25, window: 5 })] },
  { ticker: 'DRIP', name: 'Drip Theory', creator: 'fen', minutesAgo: 2900, progress: 1, graduated: true, parent: null,
    desc: 'Hold an hour, sell in seasons, and a crown for anyone who never sells.',
    stack: [S('hold-timer', { minutes: 60 }), S('seasoned-sells', { base: 20, step: 10 }), S('diamond-tiers', { hours: 24, pct: 15 }), S('buyback-burn', { pct: 25 }), S('holder-rewards', { pct: 40 })] },
  { ticker: 'CHRM', name: 'Chrome Heart', creator: 'lux', minutesAgo: 420, progress: 0.52, parent: 'DRIP',
    desc: 'Drip Theory with a shorter hold and a Kingmaker crown.',
    stack: [S('hold-timer', { minutes: 30 }), S('seasoned-sells'), S('diamond-tiers', { hours: 12 }), S('kingmaker', { pct: 10 }), S('buyback-burn', { pct: 30 })] },
  { ticker: 'BELL', name: 'Opening Bell', creator: 'tidepool', minutesAgo: 2100, progress: 0.94, parent: null,
    desc: 'Trades like a stock: opening bell at 13:00 UTC, ±20% breaker, one-hour settlement.',
    stack: [S('trading-hours', { open: 13, close: 21 }), S('circuit-breaker', { band: 20, window: 5 }), S('hold-timer', { minutes: 60 }), S('lp-lock', { pct: 100 })] },
  { ticker: 'NIGHT', name: 'Night Shift', creator: 'mira', minutesAgo: 300, progress: 0.27, parent: 'BELL',
    desc: 'Opening Bell for the other side of the planet: the curve trades 01:00–09:00 UTC.',
    stack: [S('trading-hours', { open: 1, close: 9 }), S('circuit-breaker', { band: 15, window: 10 }), S('hold-timer', { minutes: 30 }), S('lp-lock')] },
  { ticker: 'SLOW', name: 'Slow Bleed', creator: 'tidepool', minutesAgo: 1500, progress: 0.71, parent: null,
    desc: 'Nobody dumps the chart in one candle.',
    stack: [S('sell-cap', { pct: 1 }), S('sell-cooldown', { minutes: 15 }), S('circuit-breaker', { band: 20, window: 5 }), S('outflow-cap', { pct: 5 })] },
  { ticker: 'PACE', name: 'Pacemaker', creator: 'sato', minutesAgo: 140, progress: 0.12, parent: 'SLOW',
    desc: 'Slow Bleed with a lock-in until the curve is a quarter full.',
    stack: [S('sell-cap', { pct: 0.5 }), S('sell-cooldown', { minutes: 30 }), S('outflow-cap', { pct: 4 }), S('lock-in', { pct: 25 })] },
  { ticker: 'GATE', name: 'Gatehouse', creator: 'okonkwo', minutesAgo: 760, progress: 0.38, parent: null,
    desc: 'Hold 100K $BONK to get in. Opens in three chapters.',
    stack: [S('token-gate', { ticker: '$BONK', min: 100000 }), S('chapters', { n: 3, first: 0.5 }), S('locked-metadata')] },
  { ticker: 'EMBER', name: 'Ember', creator: 'lux', minutesAgo: 55, progress: 0.06, parent: null,
    desc: 'Everything burns: sniper fee, leftovers, and half the creator fees.',
    stack: [S('sniper-fee-burn', { start: 70, seconds: 120 }), S('buyback-burn', { pct: 50 }), S('leftover-burn'), S('max-wallet', { pct: 2 })] },
  { ticker: 'VOXL', name: 'Voxel Cat', creator: 'gw', minutesAgo: 25, progress: 0.03, parent: 'STACK',
    desc: 'A cat made of cubes, launched on the Fair Launch stack as is.',
    stack: [S('snipe-shield'), S('anti-bundle'), S('rising-max'), S('sniper-fee-burn')] },
  { ticker: 'TITHE', name: 'Tithe Jar', creator: 'fen', minutesAgo: 1200, progress: 0.58, parent: null,
    desc: '10% of creator fees go to an open-source fund, forever.',
    stack: [S('tithe', { pct: 10 }), S('creator-vest', { cliff: 3, days: 30 }), S('max-wallet', { pct: 3 }), S('lp-lock')] },
];

export const coinBy = Object.fromEntries(COINS.map((c) => [c.ticker, c]));

/** Derived, deterministic demo stats. */
export function stats(c, i = COINS.indexOf(c)) {
  const r = rng(1000 + i * 31);
  const mcapSol = 28 + c.progress * 380 * (0.85 + r() * 0.3) + (c.graduated ? 300 + r() * 2200 : 0);
  const trades = Math.round(80 + c.progress * 2600 * (0.6 + r()) + (c.graduated ? 4000 : 0));
  const refusedRate = 0.03 + r() * 0.12;
  return {
    mint: fakeKey(i + 1, 'hk'),
    mcapUsd: mcapSol * SOL_USD,
    vol24Usd: mcapSol * SOL_USD * (0.4 + r() * 2.2) * (c.minutesAgo < 1440 ? 1 : 0.45),
    change24: (r() - 0.32) * (c.minutesAgo < 600 ? 900 : 160),
    holders: Math.round(40 + c.progress * 900 * (0.6 + r()) + (c.graduated ? 1400 : 0)),
    trades, checked: trades, refused: Math.round(trades * refusedRate),
    remixes: COINS.filter((x) => x.parent === c.ticker).length,
    royaltiesSol: 0,
  };
}

/** Lineage helpers. */
export const childrenOf = (t) => COINS.filter((c) => c.parent === t);
export function rootOf(t) { let c = coinBy[t]; while (c?.parent) c = coinBy[c.parent]; return c; }
export function descendants(t) { const out = []; const walk = (x) => childrenOf(x).forEach((c) => { out.push(c); walk(c.ticker); }); walk(t); return out; }
