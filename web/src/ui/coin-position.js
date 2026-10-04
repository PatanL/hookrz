// The visitor's position in one coin, kept in this browser per ticker. The trade ticket writes it;
// the ticket's sell side and the stack panel's wallet-state lines (Hold Timer, Sell Cooldown, ...) read it.
const KEY = (t) => `hookrz:pos:${t}`;
const listeners = new Set();

const empty = () => ({ tokens: 0, costSol: 0, lots: [], firstAt: null, lastBuyAt: null, lastSellAt: null, buys: 0, sells: 0, soldEver: false, record: false, history: [] });

export function getPos(ticker) {
  try { return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY(ticker))) ?? {}) }; } catch { return empty(); }
}
function save(ticker, p) {
  try { localStorage.setItem(KEY(ticker), JSON.stringify(p)); } catch { /* storage blocked: position lives for this page */ }
  mem.set(ticker, p);
  for (const f of listeners) f(ticker, p);
}
const mem = new Map();
export const pos = (ticker) => mem.get(ticker) ?? getPos(ticker);

export function onPos(f) { listeners.add(f); return () => listeners.delete(f); }

export function recordBuy(ticker, { tokens, sol, sig }) {
  const p = pos(ticker), now = Date.now();
  p.tokens += tokens; p.costSol += sol; p.buys++;
  p.lots.push({ at: now, amt: tokens }); if (p.lots.length > 12) { const x = p.lots.shift(); p.lots[0].amt += x.amt; }
  p.firstAt ??= now; p.lastBuyAt = now; p.record = true;
  p.history = [{ side: 'buy', tokens, sol, sig, at: now }, ...p.history].slice(0, 10);
  save(ticker, p);
  return p;
}

export function recordSell(ticker, { tokens, sol, sig }) {
  const p = pos(ticker), now = Date.now();
  const t = Math.min(tokens, p.tokens);
  p.costSol = p.tokens > 0 ? p.costSol * (1 - t / p.tokens) : 0;
  p.tokens = Math.max(0, p.tokens - t); p.sells++; p.lastSellAt = now; p.soldEver = true;
  let left = t; // oldest lots leave first
  while (left > 0 && p.lots.length) { const l = p.lots[0]; if (l.amt <= left) { left -= l.amt; p.lots.shift(); } else { l.amt -= left; left = 0; } }
  if (p.tokens < 1) { p.tokens = 0; p.lots = []; }
  p.history = [{ side: 'sell', tokens: t, sol, sig, at: now }, ...p.history].slice(0, 10);
  save(ticker, p);
  return p;
}

/** The wallet state api.quote() expects, in the coin's clock (seconds since launch). */
export function walletCtx(p, coinAgeS) {
  const now = Date.now();
  const toT = (at) => (at == null ? null : coinAgeS - (now - at) / 1000);
  return {
    balance: p.tokens,
    lots: p.lots.map((l) => ({ t: toT(l.at), amt: l.amt })),
    lastBuySlot: p.lastBuyAt == null ? null : Math.floor(toT(p.lastBuyAt) / 0.4),
    lastSellT: toT(p.lastSellAt),
    firstT: toT(p.firstAt),
    hasPass: true,
  };
}
