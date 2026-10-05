// Rule-aware quotes: the site's reference engine (web/src/engine/engine.js `evaluate`) run over LIVE
// chain state, plus the coin's Hookscript (HOOKSCRIPT's TS interpreter) when it has one.
// The ctx is built from the chain (curve price, balances, clock, the on-chain Stack and Wallet records
// when the engine keeps them) and, where the engine's state isn't decoded yet, from the indexer's history.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { evaluate, normalize, budget } from "../../web/src/engine/engine.js";
import { byId } from "../../web/src/data/blocks.js";
import { SUPPLY } from "./curve.js";
import { HOOKSCRIPT_DIR } from "./env.js";
import type { Store, CoinRow } from "./store.js";
import type { WalletView } from "./hook.js";

export type Ctx = Record<string, any>;
export type Verdict = { ok: boolean; verdicts: { id: string; ok: boolean }[]; refusedBy?: string; code?: number; message?: string; script?: any };

/** Live wallet state for the engine ctx: on-chain record first, indexer history otherwise. Times are seconds since launch. */
export function walletState(store: Store, coin: CoinRow, owner: string | null, rec: WalletView | null) {
  const empty = { lots: [] as { t: number; amt: number }[], lastBuySlot: null as number | null, lastSellT: null as number | null, firstT: null as number | null };
  if (!owner) return empty;
  if (rec) {
    return {
      lots: rec.lots.map((l) => ({ t: l.t, amt: Number(l.amount) / 1e6 })),
      lastBuySlot: rec.lastBuySlot,
      lastSellT: rec.lastSellTs == null ? null : rec.lastSellTs - coin.launch_ts,
      firstT: rec.firstReceiptTs == null ? null : rec.firstReceiptTs - coin.launch_ts,
    };
  }
  const w = { ...empty, lots: [] as { t: number; amt: number }[] };
  for (const tr of store.walletTrades(coin.mint, owner)) {
    const received = (tr.kind === "buy" && tr.wallet === owner) || (tr.kind === "send" && tr.dest === owner);
    if (received) {
      w.lots.push({ t: tr.t, amt: tr.tokens });
      w.firstT ??= tr.t;
      if (tr.kind === "buy") w.lastBuySlot = tr.slot;
    } else {
      if (tr.kind === "sell") w.lastSellT = tr.t;
      let left = tr.tokens; // oldest lots leave first
      while (left > 0 && w.lots.length) {
        const l = w.lots[0];
        if (l.amt <= left) { left -= l.amt; w.lots.shift(); } else { l.amt -= left; left = 0; }
      }
    }
  }
  return w;
}

/** Market-wide counters the stack reads: buys in this slot, sold this hour, the breaker window's opening price. */
export function marketState(store: Store, coin: CoinRow, now: { slot: number; unix: number; price: number }) {
  const t = now.unix - coin.launch_ts;
  const stack = normalize(coin.stack) as { id: string; params: any }[];
  const breaker = stack.find((s) => s.id === "circuit-breaker");
  const hourStart = coin.launch_ts + Math.floor(t / 3600) * 3600;
  const recent = store.tradesSince(coin.mint, Math.min(hourStart, breaker ? coin.launch_ts + Math.floor(t / (breaker.params.window * 60)) * breaker.params.window * 60 : hourStart));
  const slotBuys = recent.filter((x) => x.kind === "buy" && x.slot === now.slot).length;
  const hourSold = recent.filter((x) => x.kind === "sell" && x.ts >= hourStart).reduce((a, x) => a + x.tokens, 0);
  let windowOpenPrice = now.price;
  if (breaker) {
    const ws = coin.launch_ts + Math.floor(t / (breaker.params.window * 60)) * breaker.params.window * 60;
    const first = recent.find((x) => x.ts >= ws && x.price_before != null);
    if (first) windowOpenPrice = first.price_before!;
  }
  return { t, slotBuys, hourSold, windowOpenPrice };
}

export function buildCtx(a: {
  kind: "buy" | "sell" | "send"; tokens: number; coin: CoinRow; owner: string | null; now: { slot: number; unix: number };
  progress: number; priceAfter: number; market: ReturnType<typeof marketState>; balance: number; dstBalance?: number;
  wallet: ReturnType<typeof walletState>; isCreatorLaunchBuy?: boolean;
  /** Creator Vesting's launch bag (whole tokens) from the Stack; undefined = unknown (the check then uses the balance). */
  creatorBase?: number;
  /** The trader's mark flags (1 blocked, 2 pass; Blocklist / Allowlist Phase); undefined = unknown (not blocked, has a pass). */
  marks?: number;
  /** The receiver's gate-token balance (whole gate tokens; Token Gate); undefined = unknown (treated as holding the gate). */
  gateBal?: number;
}): Ctx {
  const isCreator = !!a.owner && a.owner === a.coin.creator;
  return {
    kind: a.kind, amount: a.tokens, supply: SUPPLY, t: a.market.t, slot: a.now.slot, hour: new Date(a.now.unix * 1000).getUTCHours(),
    progress: a.progress, priceAfter: a.priceAfter, windowOpenPrice: a.market.windowOpenPrice,
    srcBefore: a.kind === "buy" ? 0 : a.balance, dstAfter: a.kind === "sell" ? 0 : (a.dstBalance ?? a.balance) + a.tokens,
    isCreatorSrc: isCreator && a.kind !== "buy", isCreator: !!a.isCreatorLaunchBuy, w: a.wallet,
    slotBuys: a.market.slotBuys, hourSold: a.market.hourSold,
    hasPass: a.marks === undefined ? true : (a.marks & 2) !== 0, gateBal: a.gateBal ?? Number.POSITIVE_INFINITY, blocked: ((a.marks ?? 0) & 1) !== 0,
    ...(a.creatorBase !== undefined ? { creatorBase: a.creatorBase } : {}),
  };
}

// ───────── Hookscript (HOOKSCRIPT's reference interpreter + compiler), loaded lazily when they exist ─────────
let hs: any | null | undefined;
/** { run, formatReason, priceE6FromSqrtQ64, compile?, draft? } from hookscript/compiler (and drafter), or null. */
export async function hookscript(): Promise<any | null> {
  if (hs && hs.compile && hs.draft) return hs; // complete: cached (pieces still in progress are looked up again)
  const load = async (rel: string) => {
    const p = resolve(HOOKSCRIPT_DIR, rel);
    if (!existsSync(p)) return null;
    try { return await import(pathToFileURL(p).href); } catch (e) { console.warn(`hookscript ${rel}:`, (e as Error).message); return null; }
  };
  const index = (await load("compiler/src/index.ts")) ?? (await load("compiler/index.ts"));
  const interp = index?.run ? index : await load("compiler/src/interp.ts");
  const math = await load("compiler/src/math.ts");
  const compiler = index?.compile ? index : ((await load("compiler/src/compile.ts")) ?? (await load("compiler/src/compiler.ts")));
  const fuzzer = await load("fuzz/fuzz.ts");
  const drafter = (await load("drafter/index.ts")) ?? (await load("drafter/src/index.ts")) ?? (await load("drafter/draft.ts")) ?? (await load("drafter/drafter.ts"));
  if (!interp?.run) { hs = null; return null; }
  hs = {
    run: interp.run, formatReason: interp.formatReason ?? index?.formatReason, verify: interp.verify,
    priceE6FromSqrtQ64: math?.priceE6FromSqrtQ64 ?? index?.priceE6FromSqrtQ64,
    compile: compiler?.compile ?? null, draft: drafter?.draft ?? drafter?.draftHookscript ?? null, fuzz: fuzzer?.fuzz ?? null,
  };
  return hs;
}

/** Inputs for the script's ctx (SPEC §8), in raw units, from live chain state. */
export type ScriptInputs = {
  kind: "buy" | "sell" | "send"; amountRaw: bigint; slot: number; now: number; launchTs: number; launchSlot: number;
  sqrtPrice: bigint; progress: number; quoteReserve: bigint; feeBps: number; creator: string;
  sender: { owner: string; isPool: boolean; balanceRaw: bigint; rec: WalletView | null };
  receiver: { owner: string; isPool: boolean; balanceRaw: bigint; rec: WalletView | null };
  globals: Uint8Array; // Script account [16, 272)
};
function hsWallet(w: ScriptInputs["sender"]) {
  const r = w.rec;
  return {
    key: new PublicKey(w.owner).toBytes(), hasRecord: !!r, isPool: w.isPool, balance: w.balanceRaw,
    firstReceiptTs: BigInt(r?.firstReceiptTs ?? 0), lastBuySlot: BigInt(r?.lastBuySlot ?? 0), lastBuyTs: BigInt(r?.lastBuyTs ?? 0), lastSellTs: BigInt(r?.lastSellTs ?? 0),
    bought: r?.bought ?? 0n, sold: r?.sold ?? 0n, buys: r?.buys ?? 0, sells: r?.sells ?? 0,
    lotsIn: (r?.lots ?? []).map((l) => ({ t: l.t, amount: l.amount })), lotsOut: (r?.lotsOut ?? []).map((l) => ({ t: l.t, amount: l.amount })),
  };
}
/** Run the coin's script exactly as the engine would for this transfer. */
export async function runScript(code: Uint8Array, x: ScriptInputs) {
  const lib = await hookscript();
  if (!lib) return { available: false as const };
  const ctx = {
    kind: x.kind === "buy" ? 0 : x.kind === "sell" ? 1 : 2, amount: x.amountRaw, decimals: 6, supply: 1_000_000_000_000_000n,
    slot: BigInt(x.slot), now: BigInt(x.now), launchTs: BigInt(x.launchTs), launchSlot: BigInt(x.launchSlot),
    priceE6: lib.priceE6FromSqrtQ64 ? lib.priceE6FromSqrtQ64(x.sqrtPrice, 6) : 0n, progressPpm: Math.min(1_000_000, Math.round(x.progress * 1e6)),
    quoteReserve: x.quoteReserve, feeBps: x.feeBps, creator: new PublicKey(x.creator).toBytes(), app: new Uint8Array(32), sameWallet: false,
    sender: hsWallet(x.sender), receiver: hsWallet(x.receiver),
  };
  const src = x.sender.rec ? Uint8Array.from(x.sender.rec.scriptVars) : new Uint8Array(0);
  const dst = x.receiver.rec ? Uint8Array.from(x.receiver.rec.scriptVars) : new Uint8Array(0);
  const r = lib.run(code, ctx, Uint8Array.from(x.globals), src, dst);
  if (r.error) return { available: true as const, ok: false, error: r.error, gas: r.gas, message: `HookscriptFault: ${r.error}` };
  if (r.verdict?.allow) return { available: true as const, ok: true, gas: r.gas };
  const message = lib.formatReason ? lib.formatReason(code, r.verdict.reasonId, r.verdict.arg) : "Refused by the coin's custom rule";
  return { available: true as const, ok: false, gas: r.gas, reasonId: r.verdict.reasonId, message };
}

/** Run the stack's hook blocks, then the coin's Hookscript (if any) — the engine's order. */
export async function judge(coin: CoinRow, ctx: Ctx, script?: () => Promise<ScriptInputs | null>): Promise<Verdict> {
  const v = evaluate(coin.stack, ctx) as Verdict;
  if (!v.ok || !coin.script?.bytecode || !script) return v;
  const inputs = await script();
  if (!inputs) return v;
  const r = await runScript(Uint8Array.from(Buffer.from(coin.script.bytecode, "base64")), inputs);
  if (!r.available) return { ...v, script: { skipped: "Hookscript interpreter not available yet" } };
  if (!r.ok) return { ok: false, verdicts: [...v.verdicts.filter((x) => x.id !== "custom"), { id: "custom", ok: false }], refusedBy: "custom", code: 6128, message: r.message, script: r };
  return { ...v, script: r };
}

export { budget, normalize, PublicKey };
