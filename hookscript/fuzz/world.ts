// A small launch world for fuzzing Hookscript: a DBC-style curve, wallets with engine-like Wallet records, the
// script's globals and per-wallet vars, and a seeded crowd that reuses the site simulator's archetypes
// (web/src/engine/sim.js): snipers, bundlers, sandwich bots, whales, flippers, paper hands, believers, creator.
import { run, type RunResult } from '../compiler/src/interp.ts';
import { ctx as mkCtx, wallet as mkWallet, type Ctx, type Lot } from '../compiler/src/ctx.ts';

export const DEC = 6;
export const UNIT = 1_000_000n; // raw units per token
export const SUPPLY = 1_000_000_000n * UNIT;
const CURVE = { vSol0: 30, vTok0: 1_073_000_191, gradTok: 279_900_191 };
const SLOT_S = 0.4;

export function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  const f = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return { f, int: (n: number) => Math.floor(f() * n), pick: <T>(xs: T[]) => xs[Math.floor(f() * xs.length)] };
}
export type Rng = ReturnType<typeof rng>;

export interface WRec {
  id: number; key: Uint8Array; type: string; balance: bigint; firstReceiptTs: bigint; lastBuySlot: bigint; lastBuyTs: bigint; lastSellTs: bigint;
  bought: bigint; sold: bigint; buys: number; sells: number; lotsIn: Lot[]; lotsOut: Lot[]; vars: Uint8Array;
}

export const POOL_KEY = (() => { const k = new Uint8Array(32); k.fill(0xb0); return k; })();
export const CREATOR_KEY = (() => { const k = new Uint8Array(32); k.fill(0xc0); return k; })();

export class World {
  vSol = CURVE.vSol0; vTok = CURVE.vTok0;
  globals = new Uint8Array(256);
  wallets: WRec[] = [];
  launchTs: bigint; launchSlot = 300_000_000n;
  app = new Uint8Array(32);
  constructor(launchTs: bigint) { this.launchTs = launchTs; }

  clone(): World {
    const w = new World(this.launchTs);
    w.vSol = this.vSol; w.vTok = this.vTok; w.globals = this.globals.slice(); w.app = this.app;
    w.wallets = this.wallets.map((x) => ({ ...x, lotsIn: x.lotsIn.map((l) => ({ ...l })), lotsOut: x.lotsOut.map((l) => ({ ...l })), vars: x.vars.slice() }));
    return w;
  }

  wallet(id: number, type = 'fresh'): WRec {
    while (this.wallets.length <= id) {
      const i = this.wallets.length;
      const key = i === 0 ? CREATOR_KEY : (() => { const k = new Uint8Array(32); k[0] = 0x11; k[1] = i & 0xff; k[2] = (i >> 8) & 0xff; k[31] = 0x77; return k; })();
      this.wallets.push({ id: i, key, type: i === 0 ? 'creator' : type, balance: 0n, firstReceiptTs: 0n, lastBuySlot: 0n, lastBuyTs: 0n, lastSellTs: 0n, bought: 0n, sold: 0n, buys: 0, sells: 0, lotsIn: [], lotsOut: [], vars: new Uint8Array(32) });
    }
    return this.wallets[id];
  }

  get price() { return this.vSol / this.vTok; } // SOL per whole token
  priceE6(vSol = this.vSol, vTok = this.vTok) { return BigInt(Math.max(0, Math.floor((vSol / vTok) * 1e9 * 1e6))); }
  progressPpm(vTok = this.vTok) { return Math.max(0, Math.min(1_000_000, Math.floor(((CURVE.vTok0 - vTok) / (CURVE.vTok0 - CURVE.gradTok)) * 1e6))); }
  get graduated() { return this.vTok <= CURVE.gradTok + 1; }

  /** tokens out for `sol` in (1% fee), clamped to the graduation point */
  quoteBuy(sol: number) { const net = sol * 0.99; const nv = this.vSol + net; const nt = (this.vSol * this.vTok) / nv; const out = Math.min(this.vTok - nt, this.vTok - CURVE.gradTok); return { out: Math.max(0, out), nv, nt: this.vTok - Math.max(0, out) }; }
  quoteSell(tok: number) { const nt = this.vTok + tok; const nv = (this.vSol * this.vTok) / nt; return { out: (this.vSol - nv) * 0.99, nv, nt }; }

  view(w: WRec | null, isPool: boolean) {
    if (!w) return mkWallet({ key: POOL_KEY, isPool, hasRecord: false });
    return mkWallet({
      key: w.key, hasRecord: true, isPool: false, balance: w.balance, firstReceiptTs: w.firstReceiptTs, lastBuySlot: w.lastBuySlot,
      lastBuyTs: w.lastBuyTs, lastSellTs: w.lastSellTs, bought: w.bought, sold: w.sold, buys: w.buys, sells: w.sells,
      lotsIn: w.lotsIn.slice(-5), lotsOut: w.lotsOut.slice(-5),
    });
  }

  /** Build the Ctx for a transfer (before applying it). amountRaw in raw units. */
  ctxFor(kind: number, now: bigint, from: WRec | null, to: WRec | null, amountRaw: bigint, priceAfterE6: bigint, progressAfter: number): Ctx {
    return mkCtx({
      kind, amount: amountRaw, decimals: DEC, supply: SUPPLY, slot: this.launchSlot + BigInt(Math.floor(Number(now - this.launchTs) / SLOT_S)), now,
      launchTs: this.launchTs, launchSlot: this.launchSlot, priceE6: priceAfterE6, progressPpm: progressAfter,
      quoteReserve: BigInt(Math.floor((this.vSol - CURVE.vSol0) * 1e9)), feeBps: 100, creator: CREATOR_KEY, app: this.app,
      sameWallet: !!from && !!to && from.id === to.id, sender: this.view(from, kind === 0), receiver: this.view(to, kind === 1),
    });
  }
}

export interface Attempt { kind: 'buy' | 'sell' | 'send'; w: number; to?: number; sol?: number; frac?: number; t: number; retry?: boolean; tries?: number; type: string }

const lot = (w: World, now: bigint, amount: bigint): Lot => ({ t: Number(now - w.launchTs), amount });
function consume(lots: Lot[], amount: bigint) {
  let left = amount;
  while (left > 0n && lots.length) { const l = lots[0]; if (l.amount <= left) { left -= l.amount; lots.shift(); } else { l.amount -= left; left = 0n; } }
}

export interface Outcome { ctx: Ctx; code: Uint8Array; globals: Uint8Array; src: Uint8Array; dst: Uint8Array; result: RunResult; kind: string; type: string }

/**
 * Try one transfer against the script; apply it to the world if allowed. Returns null if it isn't possible
 * (zero balance, curve exhausted).
 */
export function attempt(w: World, code: Uint8Array, a: { kind: 'buy' | 'sell' | 'send'; from: number; to?: number; sol?: number; tokens?: bigint }, now: bigint): Outcome | null {
  let ctx: Ctx, from: WRec | null, to: WRec | null, amount: bigint;
  let applyCurve: (() => void) | null = null;
  if (a.kind === 'buy') {
    to = w.wallet(a.from); from = null;
    const q = w.quoteBuy(a.sol ?? 0.1);
    amount = BigInt(Math.floor(q.out * 1e6));
    if (amount <= 0n) return null;
    ctx = w.ctxFor(0, now, null, to, amount, w.priceE6(q.nv, q.nt), w.progressPpm(q.nt));
    applyCurve = () => { w.vSol = q.nv; w.vTok = q.nt; };
  } else if (a.kind === 'sell') {
    from = w.wallet(a.from); to = null;
    amount = a.tokens ?? 0n;
    if (amount <= 0n || amount > from.balance) return null;
    const q = w.quoteSell(Number(amount) / 1e6);
    ctx = w.ctxFor(1, now, from, null, amount, w.priceE6(q.nv, q.nt), w.progressPpm(q.nt));
    applyCurve = () => { w.vSol = q.nv; w.vTok = q.nt; };
  } else {
    from = w.wallet(a.from); to = w.wallet(a.to ?? a.from);
    amount = a.tokens ?? 0n;
    if (amount <= 0n || amount > from.balance) return null;
    ctx = w.ctxFor(2, now, from, to, amount, w.priceE6(), w.progressPpm());
  }
  const src = from ? from.vars : new Uint8Array(0);
  const dst = to && !(from && to.id === from.id) ? to.vars : new Uint8Array(0);
  const g0 = w.globals.slice(), s0 = src.slice(), d0 = dst.slice();
  const result = run(code, ctx, w.globals, src, dst);
  const out: Outcome = { ctx, code, globals: g0, src: s0, dst: d0, result, kind: a.kind, type: (from ?? to)!.type };
  if (result.verdict?.allow) {
    w.globals = result.globals;
    if (from) from.vars = result.walletSrc.length ? result.walletSrc : from.vars;
    if (to && !(from && to.id === from.id)) to.vars = result.walletDst.length ? result.walletDst : to.vars;
    applyCurve?.();
    const slot = ctx.slot;
    if (from) { from.balance -= amount; from.lotsOut.push(lot(w, now, amount)); if (from.lotsOut.length > 5) from.lotsOut.shift(); consume(from.lotsIn, amount); }
    if (to) { to.balance += amount; to.lotsIn.push(lot(w, now, amount)); if (to.lotsIn.length > 5) to.lotsIn.shift(); if (to.firstReceiptTs === 0n) to.firstReceiptTs = now; }
    if (a.kind === 'buy' && to) { to.lastBuySlot = slot; to.lastBuyTs = now; to.bought += amount; to.buys++; }
    if (a.kind === 'sell' && from) { from.lastSellTs = now; from.sold += amount; from.sells++; }
  }
  return out;
}

const ARCH = { sniper: 8, bundler: 18, sandwich: 3, whale: 3, flipper: 24, paper: 30, believer: 110, sender: 20 };

/** A seeded schedule of intents over `hours`, shaped like web/src/engine/sim.js (plus sends between holders). */
export function intents(r: Rng, hours: number): { plan: Attempt[]; types: string[] } {
  const T = hours * 3600;
  const plan: Attempt[] = [];
  const types: string[] = ['creator'];
  let id = 1;
  const mk = (type: string) => { types[id] = type; return id++; };
  const at = (t: number, w: number, kind: Attempt['kind'], extra: Partial<Attempt> = {}) => plan.push({ t: Math.max(0, Math.round(t)), w, kind, type: types[w], ...extra });
  at(0, 0, 'buy', { sol: 1.0 });
  at(2700 + r.f() * 1800, 0, 'sell', { frac: 1, retry: true });
  for (let i = 0; i < ARCH.sniper; i++) { const w = mk('sniper'); at(r.f() * 3, w, 'buy', { sol: 0.8 + r.f() * 2.2 }); at(60 + r.f() * 600, w, 'sell', { frac: 1, retry: true }); }
  const main = mk('bundler');
  for (let i = 0; i < ARCH.bundler - 1; i++) { const w = mk('bundler'); at(0.4 + r.f() * 1.2, w, 'buy', { sol: 0.3 + r.f() * 0.6 }); at(240 + r.f() * 120, w, 'send', { to: main, frac: 1 }); }
  at(900 + r.f() * 600, main, 'sell', { frac: 1, retry: true });
  for (let i = 0; i < ARCH.sandwich; i++) { const w = mk('sandwich'); for (let k = 0; k < 6; k++) { const t = 120 + r.f() * (T - 600); at(t, w, 'buy', { sol: 0.5 + r.f() * 1.5 }); at(t + 1, w, 'sell', { frac: 1 }); } }
  for (let i = 0; i < ARCH.whale; i++) { const w = mk('whale'); const t0 = 600 + r.f() * Math.min(3000, T / 3); at(t0, w, 'buy', { sol: 6 + r.f() * 8 }); at(t0 + 300, w, 'buy', { sol: 4 + r.f() * 4 }); at(T * (0.3 + r.f() * 0.6), w, 'sell', { frac: 1, retry: true }); }
  for (let i = 0; i < ARCH.flipper; i++) { const w = mk('flipper'); const t0 = r.f() * (T - 1800); at(t0, w, 'buy', { sol: 0.2 + r.f() * 1.2 }); at(t0 + 120 + r.f() * 1100, w, 'sell', { frac: 1, retry: true }); }
  for (let i = 0; i < ARCH.paper; i++) { const w = mk('paper'); const t0 = r.f() * (T - 3600); at(t0, w, 'buy', { sol: 0.1 + r.f() * 0.6 }); at(t0 + 1800 + r.f() * 3600, w, 'sell', { frac: r.f() < 0.5 ? 1 : 0.5, retry: true }); }
  const believers: number[] = [];
  for (let i = 0; i < ARCH.believer; i++) {
    const w = mk('believer'); believers.push(w);
    const n = 1 + Math.floor(r.f() * 3);
    for (let k = 0; k < n; k++) at(r.f() * T, w, 'buy', { sol: 0.04 + r.f() * 0.45, retry: true });
    if (r.f() < 0.25) at(T * (0.4 + r.f() * 0.6), w, 'sell', { frac: r.f() < 0.5 ? 0.3 : 1, retry: true });
  }
  // senders: believers gift to friends (new wallets) and to each other; friends sometimes sell or pass it on
  for (let i = 0; i < ARCH.sender; i++) {
    const from = r.pick(believers);
    const t = r.f() * T;
    const friend = r.f() < 0.5 ? mk('friend') : r.pick(believers);
    at(t, from, 'send', { to: friend, frac: 0.05 + r.f() * 0.3, retry: true });
    if (r.f() < 0.4) at(t + 60 + r.f() * 3600, friend, 'send', { to: r.pick(believers), frac: 0.5 });
    if (r.f() < 0.3) at(t + 600 + r.f() * 7200, friend, 'sell', { frac: 1, retry: true });
  }
  plan.sort((a, b) => a.t - b.t || a.w - b.w);
  return { plan, types };
}
