// Fee routing for keeper rules: which part of a coin's trading fees the platform claims, and whose it is.
//
// Meteora DBC splits every trading fee: Meteora keeps 20% (protocol); the rest is split between the coin's creator
// (`creatorTradingFeePercentage`) and the partner (the platform, which is the config's fee claimer). hookrz's split is
// creator 50 / hookrz 50 of that rest (FEES in web/src/api/contract.js). A keeper rule spends a share of the CREATOR's
// fees, and the platform can't claim creator fees, so a coin with keeper rules routes those shares through the partner
// side at launch:
//   curve, no Sniper Fee → Burn: creatorTradingFeePercentage = 50 − ceil(Σshares / 2); the platform claims
//       50 + ceil(Σshares / 2) points per pool, keeps exactly 50 of them, spends Σshares / 2 on the rules and returns
//       the rounding half point (if any) to the creator.
//   curve, with Sniper Fee → Burn: creatorTradingFeePercentage = 0, because the split is fixed for the pool's life
//       and only a 0% creator share lets everything above the 1% base fee be burned. The keeper burns that excess,
//       keeps 50 points of the rest, spends Σshares / 2 on the rules and pays the creator its remaining
//       50 − Σshares / 2 points, every round, each a public transfer.
//   after graduation (DAMM v2): the creator owns the LP and its fees. The routed shares become a permanently locked
//       partner position of ceil(Σshares)% of the LP (taken from the creator's share); the keeper claims its fees and
//       spends all of them on the rules (hookrz keeps nothing after graduation, as before), rounding to the creator.
// Coins without keeper rules keep creator 50 / hookrz 50 on the curve and 100% of the LP for the creator.
import { normalize } from "../../web/src/engine/engine.js";
import { byId } from "../../web/src/data/blocks.js";

/** Points of the post-protocol trading fee, out of 100 (FEES). */
export const CREATOR_POINTS = 50;
export const PLATFORM_POINTS = 50;
/** Meteora DBC's protocol cut of every trading fee (PROTOCOL_FEE_PERCENT). */
export const PROTOCOL_PCT = 20;

/** Built-in keeper rules that spend `params.pct`% of the creator's fees. */
export const SHARE_RULES = ["buyback-burn", "holder-rewards", "first-buyer-rebate", "tithe", "kingmaker", "diamond-tiers"] as const;
/** Every block the keeper acts on (Sniper Fee → Burn: the scheduler is the curve's; the burn is the keeper's). */
export const KEEPER_RULES = new Set<string>([...SHARE_RULES, "sniper-fee-burn"]);

export type Share = {
  /** Ledger key: the block id, or `script:<i>` for a Hookscript payout. */
  key: string;
  id: string;
  label: string;
  /** Share of the creator's fees, in basis points (10000 = all of it). */
  bps: number;
  kind: "burn" | "pay";
  /** Hookscript payouts: stream / pot / split, and the global (or wallet var) it names. */
  mode?: "stream" | "pot" | "split";
  to?: string;
  params?: any;
};
export type ScriptAbi = { payouts?: { share_bps: number; to: string; mode: "stream" | "pot" | "split" }[]; globals?: any[]; wallet?: any[] } | null | undefined;

export type Routing = {
  shares: Share[];
  /** Σ shares, basis points of the creator's fees. */
  shareBps: number;
  sniper: { startBps: number; seconds: number } | null;
  /** DBC config field: creator's percent of the post-protocol trading fee. */
  creatorTradingFeePercentage: number;
  /** DBC config field: the platform's permanently locked share of the DAMM v2 LP after migration. */
  partnerLockedLpPct: number;
  /** Anything for the keeper to do with fees on this coin. */
  keeper: boolean;
};

export function shares(stackIn: any[], abi?: ScriptAbi): Share[] {
  const stack = normalize(stackIn) as { id: string; params: any }[];
  const out: Share[] = [];
  for (const s of stack) {
    if (!(SHARE_RULES as readonly string[]).includes(s.id)) continue;
    out.push({ key: s.id, id: s.id, label: byId[s.id].name, bps: Math.round(Number(s.params.pct) * 100), kind: s.id === "buyback-burn" ? "burn" : "pay", params: s.params });
  }
  if (stack.some((s) => s.id === "custom")) {
    (abi?.payouts ?? []).forEach((p, i) => out.push({ key: `script:${i}`, id: "custom", label: p.mode === "split" ? `payout to wallets where ${p.to}` : `payout to ${p.to}${p.mode === "pot" ? " (pot)" : ""}`, bps: p.share_bps, kind: "pay", mode: p.mode, to: p.to }));
  }
  return out;
}

/** Sniper Fee → Burn's DBC fee scheduler (the same numbers curve.ts writes into the config). */
export function sniperOf(stackIn: any[]) {
  const p = (normalize(stackIn) as { id: string; params: any }[]).find((s) => s.id === "sniper-fee-burn")?.params;
  return p ? { startBps: Math.min(9900, Math.round(p.start * 100)), seconds: Math.max(1, Math.round(p.seconds)) } : null;
}

export function feeRouting(stackIn: any[], abi?: ScriptAbi): Routing {
  const list = shares(stackIn, abi);
  const shareBps = list.reduce((a, s) => a + s.bps, 0);
  const fee = sniperOf(stackIn);
  const routedPoints = Math.ceil(shareBps / 200); // shareBps / 100 % of the creator's 50 points = shareBps / 200 points
  return {
    shares: list,
    shareBps,
    sniper: fee,
    creatorTradingFeePercentage: fee ? 0 : CREATOR_POINTS - routedPoints,
    partnerLockedLpPct: Math.ceil(shareBps / 100),
    keeper: list.length > 0 || !!fee,
  };
}

/** The keeper's shares must fit inside the creator's fees, and each built-in rule's params inside blocks.js bounds. */
export function validateShares(stackIn: any[], abi?: ScriptAbi): string | null {
  const stack = normalize(stackIn) as { id: string; params: any }[];
  for (const s of stack) {
    if (!KEEPER_RULES.has(s.id)) continue;
    for (const p of byId[s.id].params ?? []) {
      if (p.min == null) continue;
      const v = Number(s.params[p.key]);
      if (!Number.isFinite(v) || v < p.min || v > p.max) return `${byId[s.id].name}: ${p.label} must be between ${p.min} and ${p.max}`;
    }
  }
  const total = shares(stackIn, abi).reduce((a, s) => a + s.bps, 0);
  if (total > 10_000) return `The keeper rules spend ${total / 100}% of the creator's fees; the most they can share is 100%`;
  return null;
}

/** A curve claim of `claimed` lamports (the base part, after any sniper excess), split per the coin's config. */
export function allocateCurve(claimed: bigint, creatorPct: number, list: Share[]) {
  const partnerPoints = BigInt(100 - creatorPct);
  const out = new Map<string, bigint>();
  if (claimed <= 0n || partnerPoints <= 0n) return { platform: 0n, creator: 0n, rules: out };
  // The shares must have been routed at launch: never allocate more points than the partner side receives.
  const need = BigInt(PLATFORM_POINTS) * 200n + BigInt(list.reduce((a, s) => a + s.bps, 0));
  if (need > partnerPoints * 200n) throw new Error(`keeper shares need ${Number(need) / 200} points; the pool routes ${partnerPoints}`);
  const platform = (claimed * BigInt(PLATFORM_POINTS)) / partnerPoints;
  let spent = platform;
  for (const s of list) {
    const v = (claimed * BigInt(s.bps)) / (200n * partnerPoints);
    out.set(s.key, v);
    spent += v;
  }
  return { platform, creator: claimed - spent, rules: out };
}

/** A DAMM v2 partner-position claim: all of it belongs to the rules (rounding to the creator). */
export function allocateLp(claimed: bigint, lockedPct: number, list: Share[]) {
  const out = new Map<string, bigint>();
  if (claimed <= 0n || lockedPct <= 0) return { platform: 0n, creator: claimed > 0n ? claimed : 0n, rules: out };
  let spent = 0n;
  for (const s of list) {
    const v = (claimed * BigInt(s.bps)) / (100n * BigInt(lockedPct));
    out.set(s.key, v);
    spent += v;
  }
  return { platform: 0n, creator: claimed - spent, rules: out };
}
