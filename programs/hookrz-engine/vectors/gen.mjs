// Parity vectors: ctx -> verdict from the reference engine (web/src/engine/engine.js + web/src/data/blocks.js).
// Run: node vectors/gen.mjs   (writes vectors/<block>.json and vectors/stacks.json)
//
// Each vector carries the reference ctx in chain units (raw token amounts, sqrt prices, quote reserve /
// threshold) plus the packed slots the Rust engine reads. The verdict is whatever evaluate() returns on
// the float ctx derived from those integers. A vector is kept only if every block's float verdict agrees
// with the exact integer meaning of the same check (a float can't tell 1 raw unit apart at a boundary);
// the dropped count is printed.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../../web/src/engine/engine.js';
import { byId, defaults, capAt } from '../../../web/src/data/blocks.js';
import { packParams, BLOCK_IDS } from '../js/layout.mjs';

const OUT = dirname(fileURLToPath(import.meta.url));
const SUPPLY = 1_000_000_000_000_000n; // 1B tokens, 6 decimals
const Q64 = 2 ** 64;

// ───── seeded PRNG ─────
let seed = 0x5eed1e55;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const big = (lo, hi) => BigInt(lo) + BigInt(Math.floor(rnd() * Number(BigInt(hi) - BigInt(lo) + 1n)));
const KINDS = ['buy', 'sell', 'send'];

/** A random step-aligned value of one blocks.js param. */
function randParam(spec) {
  const steps = Math.round((spec.max - spec.min) / spec.step);
  return +(spec.min + spec.step * ri(0, steps)).toFixed(6);
}
function randParams(id) {
  const b = byId[id], p = {};
  for (const s of b.params) p[s.key] = s.options ? s.def : randParam(s);
  if (id === 'trading-hours' && p.open >= p.close) { p.open = Math.min(p.open, 22); p.close = ri(p.open + 1, 24); }
  return p;
}

// ───── chain ctx (BigInt) ─────
function base() {
  return {
    kind: 'buy', amount: 1_000_000n, supply: SUPPLY, t: 3600, slot: 9000n, hour: 15,
    quoteReserve: 50n * 10n ** 9n, threshold: 100n * 10n ** 9n, sqrtAfter: 1n << 64n, sqrtOpen: 1n << 64n,
    srcBefore: 0n, dstAfter: 0n, isCreator: false, isCreatorSrc: false,
    w: { lots: [], lastBuySlot: null, lastSellT: null, firstT: null }, slotBuys: 0, creatorBase: 0n,
    // Inputs of the blocks added later (neutral defaults: nobody blocked, everyone holds a pass and the gate).
    blocked: false, hasPass: true, hourSold: 0n, gateBal: U64_MAX,
  };
}
const U64_MAX = (1n << 64n) - 1n;
const ctxOf = (o) => ({ ...base(), ...o, w: { ...base().w, ...(o.w ?? {}) } });

/** The reference engine's float ctx for a chain ctx. */
function jsCtx(c) {
  const sp = (s) => (Number(s) / Q64) ** 2;
  return {
    kind: c.kind, amount: Number(c.amount), supply: Number(c.supply), t: c.t, slot: Number(c.slot), hour: c.hour,
    progress: Number(c.quoteReserve) / Number(c.threshold), priceAfter: sp(c.sqrtAfter), windowOpenPrice: sp(c.sqrtOpen),
    srcBefore: Number(c.srcBefore), dstAfter: Number(c.dstAfter), isCreatorSrc: c.isCreatorSrc, isCreator: c.isCreator,
    w: { lots: c.w.lots.map((l) => ({ t: l.t, amt: Number(l.amt) })), lastBuySlot: c.w.lastBuySlot == null ? null : Number(c.w.lastBuySlot), lastSellT: c.w.lastSellT, firstT: c.w.firstT },
    slotBuys: c.slotBuys, creatorBase: Number(c.creatorBase), hourSold: Number(c.hourSold), hasPass: c.hasPass, gateBal: Number(c.gateBal), blocked: c.blocked,
  };
}

// ───── exact integer meaning of the float checks (only the ones a float can blur) ─────
const bpsOf = (x) => BigInt(Math.round(x * 100));
const overBps = (a, s, bps) => a * 10000n > s * bps;
function exact(id, p, c) {
  switch (id) {
    case 'snipe-shield': return c.kind === 'buy' && !c.isCreator && c.t < p.window && overBps(c.amount, c.supply, bpsOf(p.max));
    case 'max-wallet': return c.kind !== 'sell' && overBps(c.dstAfter, c.supply, bpsOf(p.pct));
    case 'sell-cap': return c.kind === 'sell' && overBps(c.amount, c.supply, bpsOf(p.pct));
    case 'rising-max': {
      if (c.kind === 'sell') return false;
      const s = BigInt(p.hours * 3600), tc = BigInt(Math.min(Math.max(c.t, 0), p.hours * 3600));
      return c.dstAfter * 10000n * s > c.supply * (bpsOf(p.from) * (s - tc) + bpsOf(p.to) * tc);
    }
    case 'circuit-breaker': {
      if (c.kind === 'send' || c.sqrtOpen === 0n) return false;
      const a = c.sqrtAfter ** 2n * 10000n, o = c.sqrtOpen ** 2n, b = BigInt(p.band * 100);
      return a > o * (10000n + b) || a < o * (10000n - b);
    }
    case 'lock-in': return c.kind === 'sell' && c.quoteReserve * 10000n < bpsOf(p.pct) * c.threshold;
    case 'creator-vest': {
      if (!c.isCreatorSrc || c.kind === 'buy') return false;
      const cliff = p.cliff * 86400, span = p.days * 86400;
      const el = c.t < cliff ? 0n : BigInt(Math.min(c.t - cliff, span));
      return (c.srcBefore - c.amount) * BigInt(span) < c.creatorBase * (BigInt(span) - el);
    }
    case 'seasoned-sells': {
      if (c.kind !== 'sell' || c.w.firstT == null) return false;
      const h = Math.floor(Math.max(0, c.t - c.w.firstT) / 3600);
      const p100 = BigInt(Math.min(100, p.base + p.step * Math.min(h, 100)));
      return c.amount * 100n > c.srcBefore * p100;
    }
    case 'outflow-cap': return c.kind === 'sell' && overBps(c.hourSold + c.amount, c.supply, bpsOf(p.pct));
    case 'token-gate': return c.kind !== 'sell' && c.gateBal < BigInt(p.min) * 10n ** BigInt(p.decimals);
    case 'chapters': {
      if (c.kind !== 'buy') return false;
      let k = 0n;
      const n = BigInt(p.n);
      while (k + 1n < n && c.quoteReserve * n >= (k + 1n) * c.threshold) k++;
      return overBps(c.dstAfter, c.supply, bpsOf(p.first) << k);
    }
    default: return null; // the float check is exact for this block
  }
}

// ───── vector assembly ─────
const files = {};
let kept = 0, dropped = 0;
const droppedBy = {};
function add(file, name, stack, c) {
  const norm = stack.map((s) => ({ id: s.id, params: { ...defaults(s.id), ...(s.params ?? {}) } }));
  const jc = jsCtx(c);
  for (const s of norm) {
    const e = exact(s.id, s.params, c);
    if (e !== null && e !== !!byId[s.id].check(jc, s.params)) { dropped++; droppedBy[s.id] = (droppedBy[s.id] ?? 0) + 1; return; }
  }
  const r = evaluate(norm, jc);
  const index = r.ok ? null : norm.findIndex((s) => s.id === r.refusedBy);
  (files[file] ??= []).push({
    name,
    stack: norm,
    slots: norm.map((s) => ({ id: BLOCK_IDS[s.id], params: Buffer.from(packParams(s.id, s.params)).toString('hex') })),
    ctx: {
      kind: c.kind, amount: String(c.amount), supply: String(c.supply), t: c.t, slot: String(c.slot), hour: c.hour,
      quoteReserve: String(c.quoteReserve), threshold: String(c.threshold), sqrtAfter: String(c.sqrtAfter), sqrtOpen: String(c.sqrtOpen),
      srcBefore: String(c.srcBefore), dstAfter: String(c.dstAfter), isCreator: c.isCreator, isCreatorSrc: c.isCreatorSrc,
      w: { lots: c.w.lots.map((l) => ({ t: l.t, amt: String(l.amt) })), lastBuySlot: c.w.lastBuySlot == null ? null : String(c.w.lastBuySlot), lastSellT: c.w.lastSellT, firstT: c.w.firstT },
      slotBuys: c.slotBuys, creatorBase: String(c.creatorBase),
      blocked: c.blocked, hasPass: c.hasPass, hourSold: String(c.hourSold), gateBal: String(c.gateBal),
    },
    expect: { ok: r.ok, code: r.ok ? null : r.code, index, refusedBy: r.ok ? null : r.refusedBy },
  });
  kept++;
}

/** Threshold amount (exact) for "x > supply * pct%" style checks. */
const thr = (pct) => SUPPLY * bpsOf(pct) / 10000n;
const around = (x) => [x - 1n, x, x + 1n, x / 2n, x * 2n, 0n].filter((v) => v >= 0n);

// ───── per-block cases ─────
const HOOK_IDS = ['snipe-shield', 'anti-bundle', 'max-wallet', 'rising-max', 'sandwich-guard', 'sell-cap', 'sell-cooldown', 'hold-timer', 'circuit-breaker', 'trading-hours', 'lock-in', 'creator-vest'];

// engine.test.mjs cases, in chain units.
{
  const S = SUPPLY;
  add('reference-tests', 'max wallet: at the cap passes', [{ id: 'max-wallet', params: { pct: 2 } }], ctxOf({ kind: 'buy', amount: 1n, dstAfter: S * 2n / 100n }));
  add('reference-tests', 'max wallet: 2.01% refused', [{ id: 'max-wallet', params: { pct: 2 } }], ctxOf({ kind: 'buy', amount: 1n, dstAfter: S * 201n / 10000n }));
  const sn = [{ id: 'snipe-shield', params: { window: 60, max: 0.3 } }];
  add('reference-tests', 'snipe: 1% at t=10 refused', sn, ctxOf({ kind: 'buy', amount: S / 100n, t: 10 }));
  add('reference-tests', 'snipe: 1% at t=61 passes', sn, ctxOf({ kind: 'buy', amount: S / 100n, t: 61 }));
  add('reference-tests', 'snipe: creator launch buy exempt', sn, ctxOf({ kind: 'buy', amount: S / 100n, t: 0, isCreator: true }));
  const ht = [{ id: 'hold-timer', params: { minutes: 60 } }];
  const w = { lots: [{ t: 0, amt: 100n }, { t: 3500, amt: 50n }] };
  add('reference-tests', 'hold: free 100 of 150', ht, ctxOf({ kind: 'sell', amount: 100n, srcBefore: 150n, t: 3700, w }));
  add('reference-tests', 'hold: 101 dips into the young lot', ht, ctxOf({ kind: 'sell', amount: 101n, srcBefore: 150n, t: 3700, w }));
  add('reference-tests', 'first refusal in slot order wins', [{ id: 'sell-cap', params: { pct: 0.1 } }, { id: 'lock-in', params: { pct: 90 } }],
    ctxOf({ kind: 'sell', amount: S / 100n, srcBefore: S / 50n }));
}

for (const id of HOOK_IDS) {
  const f = id;
  const d = defaults(id);
  const st = (p) => [{ id, params: p }];
  for (let rep = 0; rep < 2; rep++) {
    const p = rep === 0 ? d : randParams(id);
    for (const kind of KINDS) {
      switch (id) {
        case 'snipe-shield':
          for (const t of [0, p.window - 1, p.window, p.window + 1]) for (const amount of around(thr(p.max))) for (const isCreator of [false, true])
            add(f, `edge ${kind} t=${t} amt=${amount} creator=${isCreator}`, st(p), ctxOf({ kind, t, amount, isCreator }));
          break;
        case 'anti-bundle':
          for (const t of [0, p.window * 60 - 1, p.window * 60]) for (const slotBuys of [0, p.perSlot - 1, p.perSlot, p.perSlot + 1]) for (const isCreator of [false, true])
            add(f, `edge ${kind} t=${t} slotBuys=${slotBuys} creator=${isCreator}`, st(p), ctxOf({ kind, t, slotBuys, isCreator }));
          break;
        case 'max-wallet':
          for (const dstAfter of around(thr(p.pct))) add(f, `edge ${kind} dst=${dstAfter}`, st(p), ctxOf({ kind, dstAfter }));
          break;
        case 'rising-max': {
          const H = p.hours * 3600;
          for (const t of [0, 1, Math.floor(H / 2), H - 1, H, H + 100]) {
            const cap = SUPPLY * (bpsOf(p.from) * BigInt(H - Math.min(t, H)) + bpsOf(p.to) * BigInt(Math.min(t, H))) / (10000n * BigInt(H));
            for (const dstAfter of around(cap)) add(f, `edge ${kind} t=${t} dst=${dstAfter}`, st(p), ctxOf({ kind, t, dstAfter }));
          }
          break;
        }
        case 'sandwich-guard':
          for (const gap of [0, 1, p.slots - 1, p.slots, p.slots + 1, -1]) add(f, `edge ${kind} gap=${gap}`, st(p), ctxOf({ kind, slot: 9000n, w: { lastBuySlot: 9000 - gap } }));
          add(f, `edge ${kind} never bought`, st(p), ctxOf({ kind, slot: 9000n }));
          break;
        case 'sell-cap':
          for (const amount of around(thr(p.pct))) add(f, `edge ${kind} amt=${amount}`, st(p), ctxOf({ kind, amount }));
          break;
        case 'sell-cooldown':
          for (const gap of [0, 1, p.minutes * 60 - 1, p.minutes * 60, p.minutes * 60 + 1]) add(f, `edge ${kind} gap=${gap}`, st(p), ctxOf({ kind, t: 20000, w: { lastSellT: 20000 - gap } }));
          add(f, `edge ${kind} never sold`, st(p), ctxOf({ kind, t: 20000 }));
          break;
        case 'hold-timer': {
          const H = p.minutes * 60, t = 100000;
          const lots = [{ t: t - H - 1, amt: 1000n }, { t: t - H, amt: 300n }, { t: t - H + 1, amt: 200n }, { t: t - 5, amt: 50n }, { t: t + 60, amt: 7n }];
          const locked = 200n + 50n + 7n;
          for (const srcBefore of [2000n, locked, locked - 1n, 0n]) for (const amount of [0n, 1n, srcBefore - locked - 1n, srcBefore - locked, srcBefore - locked + 1n, srcBefore].filter((x) => x >= 0n))
            add(f, `edge ${kind} src=${srcBefore} amt=${amount}`, st(p), ctxOf({ kind, t, amount, srcBefore, w: { lots } }));
          break;
        }
        case 'circuit-breaker': {
          const so = 10n << 60n;
          const b = BigInt(p.band * 100);
          const isq = (n) => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
          const up = isq(so * so * (10000n + b) / 10000n), dn = isq(so * so * (10000n - b) / 10000n);
          for (const sa of [so, up - 1000n, up + 1000n, dn - 1000n, dn + 1000n, so * 2n, so / 2n, 11n << 60n, 9n << 60n, 12n << 60n, 8n << 60n])
            add(f, `edge ${kind} sa=${sa}`, st(p), ctxOf({ kind, sqrtOpen: so, sqrtAfter: sa }));
          add(f, `edge ${kind} no window price`, st(p), ctxOf({ kind, sqrtOpen: 0n, sqrtAfter: so }));
          break;
        }
        case 'trading-hours':
          for (const hour of [0, p.open - 1, p.open, p.close - 1, p.close, 23].filter((h) => h >= 0 && h <= 23)) add(f, `edge ${kind} hour=${hour}`, st(p), ctxOf({ kind, hour }));
          break;
        case 'lock-in': {
          const T = 85n * 10n ** 9n;
          const at = T * bpsOf(p.pct) / 10000n;
          for (const qr of [0n, at - 1n, at, at + 1n, T, T * 2n]) add(f, `edge ${kind} qr=${qr}`, st(p), ctxOf({ kind, quoteReserve: qr, threshold: T }));
          break;
        }
        case 'creator-vest': {
          const cliff = p.cliff * 86400, span = p.days * 86400;
          const X = SUPPLY / 50n; // a 2% launch bag
          for (const t of [0, cliff - 1, cliff, cliff + 1, cliff + Math.floor(span / 3), cliff + span - 1, cliff + span, cliff + span + 100].filter((x) => x >= 0))
            for (const creatorBase of [0n, X]) for (const srcBefore of [X, X + X / 2n]) {
              const el = BigInt(t < cliff ? 0 : Math.min(t - cliff, span));
              const lockedNum = creatorBase * (BigInt(span) - el); // locked × span
              const free = srcBefore - lockedNum / BigInt(span); // floor of the exact free amount, ±1 below
              for (const amount of [0n, 1n, free - 1n, free, free + 1n, srcBefore].filter((a) => a >= 0n))
                for (const isCreatorSrc of [true, false])
                  add(f, `edge ${kind} t=${t} base=${creatorBase} src=${srcBefore} amt=${amount} creatorSrc=${isCreatorSrc}`, st(p), ctxOf({ kind, t, creatorBase, srcBefore, amount, isCreatorSrc }));
            }
          break;
        }
      }
    }
  }
}

// ───── random ctx (shared by per-block random cases and random stacks) ─────
function randomCtx() {
  const kind = pick(KINDS);
  const t = pick([ri(0, 120), ri(0, 4000), ri(0, 300000), ri(0, 40 * 86400)]);
  const slot = big(1000, 10_000_000);
  const pctAmt = () => SUPPLY * big(0, 3000) / 100000n; // 0..3% of supply
  const nLots = ri(0, 5);
  const lots = Array.from({ length: nLots }, () => ({ t: Math.max(0, t - ri(-300, 100000)), amt: pctAmt() / 10n }));
  const so = rnd() < 0.1 ? 0n : big(1n << 50n, 1n << 90n);
  const sa = so === 0n ? big(1n << 50n, 1n << 90n) : so * big(500, 1500) / 1000n;
  const threshold = big(10n ** 9n, 10n ** 12n);
  return ctxOf({
    kind, t, slot, hour: ri(0, 23), amount: pctAmt(), srcBefore: pctAmt() * big(1, 4), dstAfter: pctAmt() * 2n,
    quoteReserve: threshold * big(0, 1200) / 1000n, threshold, sqrtAfter: sa, sqrtOpen: so,
    isCreator: rnd() < 0.15, isCreatorSrc: rnd() < 0.3, slotBuys: ri(0, 8), creatorBase: rnd() < 0.2 ? 0n : pctAmt() * big(1, 4),
    w: {
      lots,
      lastBuySlot: rnd() < 0.3 ? null : String(slot - big(0, 200)),
      lastSellT: rnd() < 0.3 ? null : Math.max(0, t - ri(0, 20000)),
      firstT: rnd() < 0.3 ? null : Math.max(0, t - ri(0, 20000)),
    },
  });
}
for (const id of HOOK_IDS) for (let i = 0; i < 400; i++) add(id, `random ${i}`, [{ id, params: randParams(id) }], randomCtx());

// ───── random stacks: slot order and the first refusal ─────
for (let i = 0; i < 1500; i++) {
  const ids = [...HOOK_IDS].sort(() => rnd() - 0.5).slice(0, ri(2, 6));
  add('stacks', `stack ${i}`, ids.map((id) => ({ id, params: randParams(id) })), randomCtx());
}
add('stacks', 'empty stack passes', [], randomCtx());

// ───── the six blocks added on 2026-10-04 (appended so every vector above keeps its random draws) ─────
const NEW_IDS = ['blocklist', 'allowlist-phase', 'seasoned-sells', 'outflow-cap', 'token-gate', 'chapters'];
/** Params for the new blocks: options drawn at random; Token Gate in raw units (decimals 0: raw = whole). */
function randParamsNew(id) {
  const p = randParams(id);
  for (const s of byId[id].params) if (s.options) p[s.key] = pick(s.options);
  if (id === 'token-gate') { p.ticker = '$GATE'; p.decimals = 0; }
  return p;
}
function randomCtxNew() {
  const c = randomCtx();
  const pctAmt = () => SUPPLY * big(0, 3000) / 100000n;
  c.blocked = rnd() < 0.2;
  c.hasPass = rnd() < 0.5;
  c.hourSold = rnd() < 0.3 ? 0n : pctAmt() * big(1, 8);
  c.gateBal = rnd() < 0.2 ? 0n : big(0, 2_000_000);
  return c;
}
for (const id of NEW_IDS) {
  const f = id;
  for (let rep = 0; rep < 3; rep++) {
    const p = rep === 0 ? { ...defaults(id), ...(id === 'token-gate' ? { ticker: '$GATE', decimals: 0 } : {}) } : randParamsNew(id);
    const st = (q) => [{ id, params: q }];
    for (const kind of KINDS) {
      switch (id) {
        case 'blocklist':
          for (const blocked of [false, true]) add(f, `edge ${kind} blocked=${blocked} lock=${p.lockAt}`, st(p), ctxOf({ kind, blocked }));
          break;
        case 'allowlist-phase':
          for (const t of [0, p.minutes * 60 - 1, p.minutes * 60, p.minutes * 60 + 1]) for (const hasPass of [false, true]) for (const isCreator of [false, true])
            add(f, `edge ${kind} t=${t} pass=${hasPass} creator=${isCreator}`, st(p), ctxOf({ kind, t, hasPass, isCreator }));
          break;
        case 'seasoned-sells': {
          const t = 400_000;
          for (const h of [0, 1, 2, 7, 8, 9, 50, 200]) for (const d of [0, 1, 3599]) for (const srcBefore of [1_000_000n, 999_999n, 7n, 0n]) {
            const pc = BigInt(Math.min(100, p.base + p.step * h));
            const x = srcBefore * pc / 100n;
            for (const amount of [0n, x - 1n, x, x + 1n, srcBefore, srcBefore + 1n].filter((a) => a >= 0n))
              add(f, `edge ${kind} h=${h} d=${d} src=${srcBefore} amt=${amount}`, st(p), ctxOf({ kind, t, amount, srcBefore, w: { firstT: t - h * 3600 - d } }));
          }
          add(f, `edge ${kind} never received`, st(p), ctxOf({ kind, amount: 5n, srcBefore: 5n }));
          break;
        }
        case 'outflow-cap': {
          const cap = thr(p.pct);
          for (const hourSold of [0n, cap / 2n, cap - 1n, cap, cap + 1n]) for (const amount of around(cap > hourSold ? cap - hourSold : 1n))
            add(f, `edge ${kind} sold=${hourSold} amt=${amount}`, st(p), ctxOf({ kind, hourSold, amount }));
          break;
        }
        case 'token-gate': {
          const min = BigInt(p.min);
          for (const gateBal of [0n, min - 1n, min, min + 1n, min * 1000n, U64_MAX]) add(f, `edge ${kind} gate=${gateBal}`, st(p), ctxOf({ kind, gateBal }));
          break;
        }
        case 'chapters': {
          const T = 85n * 10n ** 9n, n = BigInt(p.n);
          for (let k = 0n; k <= n; k++) {
            const at = k * T / n;
            for (const qr of [at - 1n, at, at + 1n, T * 3n].filter((q) => q >= 0n)) {
              const ch = (() => { let j = 0n; while (j + 1n < n && qr * n >= (j + 1n) * T) j++; return j; })();
              const cap = SUPPLY * (bpsOf(p.first) << ch) / 10000n;
              for (const dstAfter of around(cap)) add(f, `edge ${kind} qr=${qr} dst=${dstAfter}`, st(p), ctxOf({ kind, quoteReserve: qr, threshold: T, dstAfter }));
            }
          }
          break;
        }
      }
    }
  }
}
for (const id of NEW_IDS) for (let i = 0; i < 400; i++) add(id, `random ${i}`, [{ id, params: randParamsNew(id) }], randomCtxNew());
// Random stacks over all 18 hook blocks: slot order and the first refusal.
const ALL_IDS = [...HOOK_IDS, ...NEW_IDS];
for (let i = 0; i < 1500; i++) {
  const ids = [...ALL_IDS].sort(() => rnd() - 0.5).slice(0, ri(2, 6));
  add('stacks-all', `stack ${i}`, ids.map((id) => ({ id, params: NEW_IDS.includes(id) ? randParamsNew(id) : randParams(id) })), randomCtxNew());
}

// lastBuySlot came out as a string in the random ctx (slot is a BigInt); normalize for JSON + Number().
for (const [file, list] of Object.entries(files)) {
  writeFileSync(join(OUT, `${file}.json`), JSON.stringify(list, null, 0).replace(/\},\{"name"/g, '},\n{"name"') + '\n');
}
const summary = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length]));
console.log(JSON.stringify({ kept, dropped, droppedBy, files: summary }, null, 1));
