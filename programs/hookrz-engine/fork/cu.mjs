// CU bench for hookrz_engine inside real Token-2022 transfers (LiteSVM). Run: node cu.mjs
// Prints a markdown table and writes cu.json. "engine" = CU consumed by our Execute (from the program log);
// "tx" = the whole transfer_checked including Token-2022.
import { readFileSync, writeFileSync } from 'node:fs';
import { Fork, pct } from './harness.mjs';

const fixture = (n) => Buffer.from(readFileSync(new URL(`./fixtures/${n}.hex`, import.meta.url), 'utf8').trim(), 'hex');
const SCRIPTS = { koth: fixture('koth'), heavy: fixture('heavy'), empty: fixture('empty'), feegate: fixture('feegate') };

// Params that keep every block on its full (passing) path.
const P = {
  'snipe-shield': { window: 600, max: 2 },
  'anti-bundle': { perSlot: 6, window: 60 },
  'max-wallet': { pct: 10 },
  'rising-max': { from: 5, to: 20, hours: 72 },
  'sandwich-guard': { slots: 150 },
  'sell-cap': { pct: 5 },
  'sell-cooldown': { minutes: 240 },
  'hold-timer': { minutes: 60 },
  'circuit-breaker': { band: 50, window: 60 },
  'trading-hours': { open: 0, close: 24 },
  'lock-in': { pct: 10 },
  'creator-vest': { cliff: 0, days: 7 },
};

/** Engine CU of one transfer of `kind` through `stack` (a list of block ids; 'custom:<fixture>' adds a script). */
async function measure(ids, kind) {
  const f = new Fork();
  // A linear sniper-fee schedule (50% → 1% over 60 s), so scripts that read the fee take the full path.
  const c = f.coin({ feeSchedule: { cliff: 500_000_000n, frequency: 1n, reduction: 8_166_666n, periods: 60 } });
  let script = null;
  const slots = ids.map((id) => {
    if (id.startsWith('custom:')) { script = SCRIPTS[id.slice(7)]; return { id: 'custom', params: {} }; }
    return { id, params: P[id] };
  });
  const r0 = f.initStack(c, slots, { script });
  if (!r0.ok) throw new Error(`init ${ids}: ${r0.err}`);
  f.setPool(c, { quoteReserve: c.threshold }); // curve full enough for lock-in
  f.warp(61); // past the sniper fee
  const a = f.holder(c), b = f.holder(c);
  // History: five receipt lots in a's record (worst case for Hold Timer and window sums), a prior sell.
  for (let i = 0; i < 5; i++) {
    const r = await f.buy(c, a, pct(0.2));
    if (!r.ok) throw new Error(`setup buy ${ids}: ${r.err}\n${r.logs.join('\n')}`);
    f.warp(i < 4 ? 900 : 7200, 400);
  }
  { const r = await f.buy(c, b, pct(0.5)); if (!r.ok) throw new Error(`setup b ${ids}: ${r.err}`); f.warp(7200, 400); } // b holds the KotH crown
  if (kind !== 'buy') {
    const r = await f.sell(c, a, 1000n);
    if (!r.ok) throw new Error(`setup sell ${ids}: ${r.err}`);
    f.warp(5 * 3600, 400);
  }
  if (kind === 'send') { const r = await f.sendTo(c, a, b, 1000n); if (!r.ok) throw new Error(`setup send ${ids}: ${r.err}`); f.warp(3 * 3600, 400); }
  const r = kind === 'buy' ? await f.buy(c, a, pct(0.1)) : kind === 'sell' ? await f.sell(c, a, pct(0.1)) : await f.sendTo(c, a, b, pct(0.1));
  if (!r.ok) throw new Error(`${kind} ${ids}: ${r.err}\n${r.logs.join('\n')}`);
  return { engine: r.engineCu, tx: r.cu };
}

const rows = [];
const base = {};
for (const kind of ['buy', 'sell', 'send']) base[kind] = await measure(['trading-hours'], kind);
rows.push({ what: 'engine base (dispatch, C1 checks, Stack, classification; 1 trivial slot)', ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v.engine])) });

const single = [...Object.keys(P).filter((x) => x !== 'trading-hours'), 'custom:empty', 'custom:feegate', 'custom:koth', 'custom:heavy'];
const perBlock = {};
for (const id of single) {
  const row = { what: id };
  for (const kind of ['buy', 'sell', 'send']) {
    const m = await measure([id], kind);
    row[kind] = m.engine;
  }
  row.marginal = Math.max(row.buy - base.buy.engine, row.sell - base.sell.engine, row.send - base.send.engine);
  perBlock[id] = row.marginal;
  rows.push(row);
}
rows.push({ what: 'trading-hours', buy: base.buy.engine, sell: base.sell.engine, send: base.send.engine, marginal: 0 });

// Worst-case stacks (6 slots).
const worst = [
  ['hold-timer', 'circuit-breaker', 'sandwich-guard', 'sell-cooldown', 'lock-in', 'rising-max'],
  ['hold-timer', 'circuit-breaker', 'sandwich-guard', 'sell-cooldown', 'anti-bundle', 'snipe-shield'],
  ['hold-timer', 'circuit-breaker', 'sandwich-guard', 'sell-cooldown', 'lock-in', 'custom:koth'],
  ['hold-timer', 'circuit-breaker', 'sandwich-guard', 'sell-cooldown', 'lock-in', 'custom:heavy'],
  ['hold-timer', 'circuit-breaker', 'anti-bundle', 'rising-max', 'creator-vest', 'custom:heavy'],
];
const worstRows = [];
for (const st of worst) {
  const row = { what: st.join(' + ') };
  for (const kind of ['buy', 'sell', 'send']) { const m = await measure(st, kind); row[kind] = m.engine; row[`${kind}Tx`] = m.tx; }
  worstRows.push(row);
}

const fmt = (n) => (n == null ? '' : n.toLocaleString('en-US'));
console.log('| Block | buy | sell | send | marginal (max over kinds, minus base) |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.what} | ${fmt(r.buy)} | ${fmt(r.sell)} | ${fmt(r.send)} | ${fmt(r.marginal)} |`);
console.log('\n| Worst-case stack (6 slots) | buy | sell | send | whole tx (max) |');
console.log('|---|---:|---:|---:|---:|');
for (const r of worstRows) console.log(`| ${r.what} | ${fmt(r.buy)} | ${fmt(r.sell)} | ${fmt(r.send)} | ${fmt(Math.max(r.buyTx, r.sellTx, r.sendTx))} |`);
const max = Math.max(...worstRows.flatMap((r) => [r.buy, r.sell, r.send]));
console.log(`\nMax engine CU over the worst-case stacks: ${fmt(max)} (budget 30,000)`);
writeFileSync(new URL('./cu.json', import.meta.url), JSON.stringify({ base, rows, worst: worstRows, max }, null, 1));
if (max > 30000) process.exit(1);
