// Launch simulator: a seeded crowd of traders hits a bonding curve for six hours, and every
// transfer goes through engine.evaluate(). Same seed + same stack = same result, so the
// configurator can show "with your stack" vs "no rules" side by side.
import { evaluate, feeAt, normalize } from './engine.js';

export const SUPPLY = 1_000_000_000;
// Meteora DBC-style virtual-reserve curve tuned like the common 1B / ~85 SOL launch.
export const CURVE = { vSol0: 30, vTok0: 1_073_000_191, gradTok: 279_900_191, gradSol: 85 };

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export class Curve {
  constructor() { this.vSol = CURVE.vSol0; this.vTok = CURVE.vTok0; this.k = this.vSol * this.vTok; this.graduated = false; }
  get price() { return this.vSol / this.vTok; }               // SOL per token
  get progress() { return Math.min(1, (CURVE.vTok0 - this.vTok) / (CURVE.vTok0 - CURVE.gradTok)); }
  get raised() { return this.vSol - CURVE.vSol0; }
  quoteBuy(sol, feePct) { const net = sol * (1 - feePct / 100); const nv = this.vSol + net; const nt = this.k / nv; return { out: Math.min(this.vTok - nt, this.vTok - CURVE.gradTok), nv, nt, fee: sol - net }; }
  quoteSell(tok, feePct) { const nt = this.vTok + tok; const nv = this.k / nt; const gross = this.vSol - nv; return { out: gross * (1 - feePct / 100), nv, nt, fee: gross * feePct / 100 }; }
  priceAfterBuy(sol, f) { const q = this.quoteBuy(sol, f); return q.nv / q.nt; }
  priceAfterSell(tok, f) { const q = this.quoteSell(tok, f); return q.nv / q.nt; }
  applyBuy(sol, f) { const q = this.quoteBuy(sol, f); this.vSol = q.nv; this.vTok = this.vTok - q.out; this.k = this.vSol * this.vTok; if (this.vTok <= CURVE.gradTok + 1) this.graduated = true; return q; }
  applySell(tok, f) { const q = this.quoteSell(tok, f); this.vSol = q.nv; this.vTok = q.nt; return q; }
}

export const ARCHETYPES = {
  sniper: { name: 'Snipers', n: 8, color: 'refuse' },
  bundler: { name: 'Bundle wallets', n: 18, color: 'refuse' },
  sandwich: { name: 'Sandwich bots', n: 3, color: 'refuse' },
  whale: { name: 'Whales', n: 3, color: 'warn' },
  flipper: { name: 'Flippers', n: 24, color: 'warn' },
  paper: { name: 'Paper hands', n: 30, color: 'warn' },
  believer: { name: 'Believers', n: 110, color: 'ice' },
  creator: { name: 'Creator', n: 1, color: 'ice' },
};

const HOURS = 6, T_END = HOURS * 3600, LAUNCH_HOUR_UTC = 14;

/** Build the seeded intent schedule: who wants to do what, when. Independent of the stack. */
function intents(seed) {
  const r = rng(seed);
  const out = [];
  let id = 0;
  const wallets = [];
  const mk = (type, extra = {}) => { const w = { id: id++, type, hasPass: false, gateBal: 0, blocked: false, ...extra }; wallets.push(w); return w; };
  const at = (t, w, kind, size, extra = {}) => out.push({ t: Math.max(0, Math.round(t * 10) / 10), w: w.id, kind, size, ...extra });

  const creator = mk('creator', { hasPass: true, gateBal: 2e5 });
  at(0, creator, 'buy', 1.0);
  at(2700 + r() * 1800, creator, 'sell', 1.0); // tries to dump the dev bag 45–75 min in

  for (let i = 0; i < ARCHETYPES.sniper.n; i++) {
    const w = mk('sniper', { blocked: r() < 0.25, gateBal: r() < 0.2 ? 2e5 : 0 });
    at(r() * 3, w, 'buy', 0.8 + r() * 2.2);
    at(60 + r() * 600, w, 'sell', 1.0);
  }
  const bundleSlot = 1 + Math.floor(r() * 3);
  const bundleMain = mk('bundler');
  for (let i = 0; i < ARCHETYPES.bundler.n - 1; i++) {
    const w = mk('bundler');
    at(bundleSlot * 0.4 + r() * 0.3, w, 'buy', 0.3 + r() * 0.6);
    at(240 + r() * 120, w, 'send', 1.0, { to: bundleMain.id }); // consolidate
  }
  at(900 + r() * 600, bundleMain, 'sell', 1.0);
  for (let i = 0; i < ARCHETYPES.sandwich.n; i++) {
    const w = mk('sandwich');
    for (let k = 0; k < 10; k++) { const t = 120 + r() * (T_END - 600); at(t, w, 'buy', 0.5 + r() * 1.5, { sandwich: true }); at(t + 0.4 + r() * 0.4, w, 'sell', 1.0, { sandwich: true }); }
  }
  for (let i = 0; i < ARCHETYPES.whale.n; i++) {
    const w = mk('whale', { hasPass: r() < 0.6, gateBal: r() < 0.7 ? 5e5 : 0 });
    const t0 = 600 + r() * 3000;
    at(t0, w, 'buy', 6 + r() * 8); at(t0 + 300, w, 'buy', 4 + r() * 4);
    at(7200 + r() * 7200, w, 'sell', 1.0, { retry: true });
  }
  for (let i = 0; i < ARCHETYPES.flipper.n; i++) {
    const w = mk('flipper', { hasPass: r() < 0.3, gateBal: r() < 0.4 ? 2e5 : 0 });
    const t0 = r() * (T_END - 1800);
    at(t0, w, 'buy', 0.2 + r() * 1.2); at(t0 + 120 + r() * 1100, w, 'sell', 1.0, { retry: true });
  }
  for (let i = 0; i < ARCHETYPES.paper.n; i++) {
    const w = mk('paper', { hasPass: r() < 0.4, gateBal: r() < 0.5 ? 2e5 : 0 });
    const t0 = r() * (T_END - 3600);
    at(t0, w, 'buy', 0.1 + r() * 0.6); at(t0 + 1800 + r() * 3600, w, 'sell', 1.0, { retry: true });
  }
  for (let i = 0; i < ARCHETYPES.believer.n; i++) {
    const w = mk('believer', { hasPass: r() < 0.55, gateBal: r() < 0.75 ? 2e5 : 0 });
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) at(r() * T_END, w, 'buy', 0.04 + r() * 0.45);
    if (r() < 0.15) at(T_END * (0.5 + r() * 0.5), w, 'sell', 0.3);
  }
  out.sort((a, b) => a.t - b.t || a.w - b.w);
  return { intents: out, wallets };
}

/**
 * Simulate a launch. Returns aggregate stats, a price series and an event log.
 * stack: [{id, params}] (empty = no rules)
 */
export function simulate(stackIn, { seed = 7 } = {}) {
  const stack = normalize(stackIn);
  const { intents: plan, wallets } = intents(seed);
  const queue = plan.map((x) => ({ ...x }));
  const curve = new Curve();
  const bal = new Map(), ws = new Map();
  const W = (id) => { if (!ws.has(id)) ws.set(id, { lots: [], lastBuySlot: null, lastSellT: null, firstT: null, sold: false, spent: 0, got: 0 }); return ws.get(id); };
  const B = (id) => bal.get(id) ?? 0;
  const slotBuys = new Map(), hourSold = new Map(), windowOpen = new Map();
  const breaker = stack.find((s) => s.id === 'circuit-breaker');
  const byBlock = {}, byType = {}, log = [], series = [];
  let burnedSol = 0, feesSol = 0, landed = 0, refused = 0, gradT = null;
  for (const k of Object.keys(ARCHETYPES)) byType[k] = { attempts: 0, landed: 0, refused: 0, spent: 0, got: 0 };
  let nextCandle = 0;

  for (let qi = 0; qi < queue.length; qi++) {
    const ev = queue[qi];
    if (ev.t > T_END) break;
    while (ev.t >= nextCandle) { series.push({ t: nextCandle, p: curve.price, prog: curve.progress }); nextCandle += 120; }
    const w = wallets[ev.w], st = W(ev.w);
    const slot = Math.floor(ev.t / 0.4);
    const fee = feeAt(stack, ev.t);
    let amount, priceAfter, sol = 0;
    if (curve.graduated && ev.kind !== 'send') continue;
    if (ev.kind === 'buy') { sol = ev.size; const q = curve.quoteBuy(sol, fee); amount = q.out; priceAfter = q.nv / q.nt; if (amount <= 0) continue; }
    else { amount = B(ev.w) * Math.min(1, ev.size); if (amount < 1) continue; priceAfter = ev.kind === 'sell' ? curve.priceAfterSell(amount, fee) : curve.price; }
    const toId = ev.kind === 'send' ? ev.to : ev.w;
    const wIdx = breaker ? Math.floor(ev.t / (breaker.params.window * 60)) : 0;
    if (breaker && !windowOpen.has(wIdx)) windowOpen.set(wIdx, curve.price);
    const ctx = {
      kind: ev.kind, amount, supply: SUPPLY, t: ev.t, slot, hour: Math.floor(LAUNCH_HOUR_UTC + ev.t / 3600) % 24,
      progress: curve.progress, priceAfter, windowOpenPrice: windowOpen.get(wIdx) ?? 0,
      srcBefore: ev.kind === 'buy' ? 0 : B(ev.w), dstAfter: ev.kind === 'sell' ? 0 : B(toId) + amount,
      isCreatorSrc: w.type === 'creator' && ev.kind !== 'buy', isCreator: w.type === 'creator', w: st,
      slotBuys: slotBuys.get(slot) ?? 0, hourSold: hourSold.get(Math.floor(ev.t / 3600)) ?? 0,
      hasPass: wallets[toId].hasPass, gateBal: wallets[toId].gateBal, blocked: w.blocked || wallets[toId].blocked,
    };
    const v = evaluate(stack, ctx);
    const T = byType[w.type]; T.attempts++;
    if (!v.ok) {
      refused++; T.refused++; byBlock[v.refusedBy] = (byBlock[v.refusedBy] ?? 0) + 1;
      if (log.length < 4000) log.push({ t: ev.t, type: w.type, wallet: ev.w, kind: ev.kind, amount, sol, ok: false, by: v.refusedBy, msg: v.message, verdicts: v.verdicts });
      // adaptive traders come back later with half the size
      if (ev.retry && (ev.tries ?? 0) < 4) {
        const nt = ev.t + 300 + (ev.tries ?? 0) * 600;
        const nx = { ...ev, t: nt, size: Math.max(0.15, ev.size * 0.5), tries: (ev.tries ?? 0) + 1 };
        let j = qi + 1; while (j < queue.length && queue[j].t <= nt) j++; queue.splice(j, 0, nx);
      }
      continue;
    }
    landed++; T.landed++;
    if (ev.kind === 'buy') {
      const q = curve.applyBuy(sol, fee);
      bal.set(ev.w, B(ev.w) + q.out); st.lots.push({ t: ev.t, amt: q.out }); if (st.lots.length > 8) st.lots.shift();
      st.lastBuySlot = slot; st.firstT ??= ev.t; T.spent += sol; feesSol += q.fee; if (fee > 1) burnedSol += q.fee * (fee - 1) / fee;
      slotBuys.set(slot, (slotBuys.get(slot) ?? 0) + 1);
      if (curve.graduated && gradT == null) gradT = ev.t;
    } else if (ev.kind === 'sell') {
      const q = curve.applySell(amount, fee);
      bal.set(ev.w, B(ev.w) - amount); st.lastSellT = ev.t; st.sold = true; T.got += q.out; feesSol += q.fee; if (fee > 1) burnedSol += q.fee * (fee - 1) / fee;
      hourSold.set(Math.floor(ev.t / 3600), (hourSold.get(Math.floor(ev.t / 3600)) ?? 0) + amount);
      consumeLots(st, amount);
    } else {
      bal.set(ev.w, B(ev.w) - amount); bal.set(toId, B(toId) + amount); consumeLots(st, amount);
      const ds = W(toId); ds.lots.push({ t: ev.t, amt: amount }); ds.firstT ??= ev.t;
    }
    if (log.length < 4000) log.push({ t: ev.t, type: w.type, wallet: ev.w, kind: ev.kind, amount, sol, ok: true, verdicts: v.verdicts });
  }
  series.push({ t: T_END, p: curve.price, prog: curve.progress });

  const holders = [...bal.entries()].filter(([, b]) => b > 1).sort((a, b) => b[1] - a[1]);
  const held = holders.reduce((a, [, b]) => a + b, 0) || 1;
  const top10 = holders.slice(0, 10).reduce((a, [, b]) => a + b, 0) / held;
  const peak = Math.max(...series.map((s) => s.p));
  let maxDraw = 0, hi = 0;
  for (const s of series) { hi = Math.max(hi, s.p); maxDraw = Math.max(maxDraw, 1 - s.p / hi); }
  const bots = ['sniper', 'bundler', 'sandwich'].reduce((a, k) => ({ attempts: a.attempts + byType[k].attempts, landed: a.landed + byType[k].landed, got: a.got + byType[k].got, spent: a.spent + byType[k].spent }), { attempts: 0, landed: 0, got: 0, spent: 0 });
  return {
    seed, hours: HOURS, landed, refused, byBlock, byType, series, log,
    holders: holders.length, top10, peakPrice: peak, endPrice: curve.price, maxDrawdown: maxDraw,
    progress: curve.progress, raised: curve.raised, graduated: curve.graduated, gradT,
    feesSol, burnedSol, botPnl: bots.got - bots.spent, botLanded: bots.landed, botAttempts: bots.attempts,
  };
}

function consumeLots(st, amount) {
  let left = amount; // oldest lots leave first
  while (left > 0 && st.lots.length) { const l = st.lots[0]; if (l.amt <= left) { left -= l.amt; st.lots.shift(); } else { l.amt -= left; left = 0; } }
}

/** Format helpers shared by pages that show sim output. */
export const fmtSol = (n) => `${n < 0 ? '−' : ''}${Math.abs(n) >= 100 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(2)} SOL`;
