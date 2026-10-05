// Fuzz a compiled Hookscript against generated launches (10,000 transfers by default) and run the honeypot check.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, attempt, intents, rng, UNIT, type Outcome, type WRec } from './world.ts';
import { verify, formatReason, parse } from '../compiler/src/interp.ts';
import { decodeBase58 } from '../compiler/src/base58.ts';

const JUPITER = decodeBase58('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const DBC = decodeBase58('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
const ROUTER = (() => { const k = new Uint8Array(32); k.fill(0x4b); return k; })();
import { runLine, rustRun, tsLine } from '../compiler/test/parity.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNNER = join(ROOT, 'vm', 'target', 'release', 'examples', 'hsrun');

export interface FuzzReport {
  trades: number; allowed: number; refused: number; refusedPct: number; errors: number; panics: number;
  byKind: Record<string, { attempts: number; refused: number }>;
  byReason: Record<string, number>;
  maxCu: number; avgCu: number; staticCu: number;
  launches: number; seed: number;
  rust: { checked: number; identical: number; panics: number } | null;
}
export interface HoneypotReport {
  ok: boolean; checkedWallets: number; locked: { wallet: string; type: string; startTokens: number; leftTokens: number; tries: number; lastMessage: string }[];
  allSellsRefused: boolean; maxExitHours: number; notes: string[];
  bankRun?: { failedAt: number; wallet: string; type: string; startTokens: number; leftTokens: number; lastMessage: string };
}

const DAY = 86_400;
/** How long to wait after a refused round, given how long we've already waited since the last allowed sell:
 * 1s steps (odd/even seconds), then 5m, then hourly for 3 days (every hour of every weekday), then 7h steps
 * (co-prime with 24h, so it keeps sampling every hour of the day) out to 60 days. */
const nextWait = (waited: number) => (waited < 60 ? 1 : waited < 3600 ? 300 : waited < 3 * DAY ? 3600 : 7 * 3600);
const FRACTIONS = [1, 0.5, 0.25, 0.1, 0.01];

/**
 * Exit simulation: with nobody else trading, can this holder sell down below 1% of their bag within 60 days?
 * Tries the full balance, then smaller slices (down to 1 token), at times stepping out through odd/even seconds,
 * hours, days and weeks. Allowed sells are applied with their state writes.
 */
function exitSim(w0: World, code: Uint8Array, id: number, start: bigint, inPlace = false): { left: bigint; tries: number; hours: number; msg: string; end: bigint } {
  const w = inPlace ? w0 : w0.clone();
  const me = w.wallet(id);
  const bag = me.balance;
  const target = bag / 100n;
  let t = start, tries = 0, waited = 0, msg = '';
  while (me.balance > target && tries < 4000 && t - start <= BigInt(60 * DAY)) {
    let ok = false;
    const sizes = [...FRACTIONS.map((f) => BigInt(Math.floor(Number(me.balance) * f))), UNIT];
    for (const amt of sizes) {
      if (amt <= 0n || amt > me.balance) continue;
      tries++;
      const o = attempt(w, code, { kind: 'sell', from: id, tokens: amt }, t);
      if (!o) continue;
      if (o.result.verdict?.allow) { ok = true; break; }
      if (o.result.verdict && !o.result.verdict.allow) msg = formatReason(code, o.result.verdict.reasonId, o.result.verdict.arg);
      else msg = `VM error ${o.result.error}`;
    }
    if (ok) { waited = 0; t += 1n; continue; }
    const step = nextWait(waited);
    waited += step;
    t += BigInt(step);
  }
  return { left: me.balance, tries, hours: Number(t - start) / 3600, msg, end: t };
}

/** Bank run: every holder exits in turn, biggest first, in one shared world (catches price- or crowd-dependent locks). */
function bankRun(w0: World, code: Uint8Array, start: bigint): { id: number; type: string; bag: bigint; left: bigint; msg: string; order: number } | null {
  const w = w0.clone();
  const holders = w.wallets.filter((x) => x.balance > UNIT).sort((a, b) => (b.balance > a.balance ? 1 : -1));
  let t = start;
  for (const [i, h] of holders.entries()) {
    const bag = h.balance;
    const ex = exitSim(w, code, h.id, t, true);
    if (ex.left > bag / 100n) return { id: h.id, type: h.type, bag, left: ex.left, msg: ex.msg, order: i };
    t = ex.end + 1n;
  }
  return null;
}

export interface FuzzOptions { trades?: number; seed?: number; honeypot?: boolean; rust?: boolean | 'auto'; holdersPerLaunch?: number }

export function fuzz(code: Uint8Array, opts: FuzzOptions = {}): { fuzz: FuzzReport; honeypot: HoneypotReport } {
  const N = opts.trades ?? 10_000;
  const seed = opts.seed ?? 1;
  const info = verify(code);
  const h = parse(code);
  const rep: FuzzReport = { trades: 0, allowed: 0, refused: 0, refusedPct: 0, errors: 0, panics: 0, byKind: {}, byReason: {}, maxCu: 0, avgCu: 0, staticCu: info.gasMax, launches: 0, seed, rust: null };
  const hp: HoneypotReport = { ok: true, checkedWallets: 0, locked: [], allSellsRefused: false, maxExitHours: 0, notes: [] };
  const lines: string[] = [];
  const keepLines = opts.rust === true || (opts.rust !== false && existsSync(RUNNER));
  let gasSum = 0;
  let sellAttempts = 0, sellRefused = 0;
  const record = (o: Outcome) => {
    rep.trades++;
    const k = (rep.byKind[o.kind] ??= { attempts: 0, refused: 0 });
    k.attempts++;
    if (o.kind === 'sell') sellAttempts++;
    gasSum += o.result.gas;
    rep.maxCu = Math.max(rep.maxCu, o.result.gas);
    if (o.result.error) { rep.errors++; return; }
    if (o.result.verdict!.allow) rep.allowed++;
    else {
      rep.refused++; k.refused++;
      if (o.kind === 'sell') sellRefused++;
      const text = formatReason(code, o.result.verdict!.reasonId, 0n).replace(/\{\}/g, '…');
      const key = new TextDecoder().decode(reasonText(h, o.result.verdict!.reasonId)) || text;
      rep.byReason[key] = (rep.byReason[key] ?? 0) + 1;
    }
    if (keepLines && lines.length < 40_000) lines.push(runLine(o.code, o.ctx, o.globals, o.src, o.dst));
  };

  const YEAR0 = 1_767_225_600; // 2026-01-01T00:00:00Z
  for (let L = 0; rep.trades < N && L < 500; L++) {
    const r = rng(seed * 7919 + L * 104729 + 13);
    const hours = r.pick([6, 6, 12, 24, 72, 168]);
    const launchTs = BigInt(YEAR0 + r.int(730 * DAY) + r.int(DAY));
    const w = new World(launchTs);
    const { plan, types } = intents(r, hours);
    types.forEach((t, i) => w.wallet(i, t));
    rep.launches++;
    const queue = plan.map((x) => ({ ...x }));
    for (let qi = 0; qi < queue.length && rep.trades < N; qi++) {
      const ev = queue[qi];
      if (w.graduated) break;
      const now = launchTs + BigInt(ev.t);
      const me = w.wallet(ev.w);
      // the app this trade came from: bots love aggregators
      w.app = r.f() < (['sniper', 'bundler', 'sandwich'].includes(ev.type) ? 0.5 : 0.2) ? JUPITER : r.f() < 0.5 ? DBC : ROUTER;
      let o: Outcome | null = null;
      if (ev.kind === 'buy') o = attempt(w, code, { kind: 'buy', from: ev.w, sol: ev.sol }, now);
      else {
        const amt = BigInt(Math.floor(Number(me.balance) * Math.min(1, ev.frac ?? 1)));
        o = attempt(w, code, { kind: ev.kind, from: ev.w, to: ev.to, tokens: amt }, now);
      }
      if (!o) continue;
      record(o);
      if (o.result.verdict && !o.result.verdict.allow && ev.retry && (ev.tries ?? 0) < 4) {
        const nt = ev.t + 300 + (ev.tries ?? 0) * 900 + r.int(120);
        const nx = { ...ev, t: nt, sol: ev.sol ? Math.max(0.03, ev.sol * 0.5) : ev.sol, frac: ev.frac ? Math.max(0.1, ev.frac * 0.5) : ev.frac, tries: (ev.tries ?? 0) + 1 };
        let j = qi + 1; while (j < queue.length && queue[j].t <= nt) j++;
        queue.splice(j, 0, nx);
      }
    }
    // honeypot: special holders (named in key globals) + the biggest bags + a random sample
    if (opts.honeypot !== false) {
      const end = launchTs + BigInt((queue.at(-1)?.t ?? 0) + 1);
      const holders = w.wallets.filter((x) => x.balance > UNIT);
      const special = holders.filter((x) => keyInGlobals(w.globals, x.key));
      const big = [...holders].sort((a, b) => (b.balance > a.balance ? 1 : -1)).slice(0, 6);
      const rand = holders.filter(() => r.f() < 0.15).slice(0, opts.holdersPerLaunch ?? 12);
      const pick = new Map<number, WRec>();
      for (const x of [...special, ...big, ...rand]) pick.set(x.id, x);
      if (rep.launches <= 3) {
        const br = bankRun(w, code, end);
        hp.checkedWallets++;
        if (br) {
          hp.ok = false;
          hp.bankRun = { failedAt: br.order + 1, wallet: `#${br.id}`, type: br.type, startTokens: Number(br.bag / UNIT), leftTokens: Number(br.left / UNIT), lastMessage: br.msg };
        }
      }
      for (const x of pick.values()) {
        hp.checkedWallets++;
        const ex = exitSim(w, code, x.id, end);
        hp.maxExitHours = Math.max(hp.maxExitHours, ex.left <= x.balance / 100n ? ex.hours : 0);
        if (ex.left > x.balance / 100n && hp.locked.length < 8) {
          hp.ok = false;
          hp.locked.push({ wallet: `#${x.id}`, type: x.type, startTokens: Number(x.balance / UNIT), leftTokens: Number(ex.left / UNIT), tries: ex.tries, lastMessage: ex.msg });
        } else if (ex.left > x.balance / 100n) hp.ok = false;
      }
    }
  }
  rep.refusedPct = rep.trades ? Math.round((rep.refused / rep.trades) * 1000) / 10 : 0;
  rep.avgCu = rep.trades ? Math.round(gasSum / rep.trades) : 0;
  if (sellAttempts > 20 && sellRefused === sellAttempts) { hp.allSellsRefused = true; hp.ok = false; hp.notes.push('Every sell in the fuzz run was refused.'); }
  const b = rep.byKind.buy;
  if (b && b.attempts > 20 && b.refused === b.attempts) hp.notes.push('Every buy in the fuzz run was refused: nobody can get in.');
  if (hp.bankRun) hp.notes.push(`Bank run: when holders exit one after another, holder ${hp.bankRun.failedAt} (${hp.bankRun.type}) gets stuck: "${hp.bankRun.lastMessage}"`);
  if (!hp.ok && hp.locked.length) hp.notes.push(`${hp.locked.length} holder(s) couldn't sell below 1% of their bag within 60 days with nobody else trading.`);
  if (keepLines && existsSync(RUNNER)) {
    try {
      const rust = rustRun(RUNNER, lines);
      let identical = 0;
      for (let i = 0; i < lines.length; i++) if (rust[i] === tsLine(lines[i])) identical++;
      rep.rust = { checked: lines.length, identical, panics: 0 };
    } catch (e) {
      rep.rust = { checked: lines.length, identical: 0, panics: 1 };
      rep.panics++;
      hp.notes.push(`Rust VM crashed: ${String(e).slice(0, 200)}`);
    }
  }
  return { fuzz: rep, honeypot: hp };
}

function reasonText(h: ReturnType<typeof parse>, id: number): Uint8Array {
  let p = 0;
  for (let i = 0; i < h.nReasons; i++) { const len = h.reasons[p + 1]; if (i === id) return h.reasons.subarray(p + 2, p + 2 + len); p += 2 + len; }
  return new Uint8Array(0);
}

function keyInGlobals(g: Uint8Array, key: Uint8Array): boolean {
  outer: for (let o = 0; o + 32 <= g.length; o++) {
    for (let i = 0; i < 32; i++) if (g[o + i] !== key[i]) continue outer;
    return true;
  }
  return false;
}
