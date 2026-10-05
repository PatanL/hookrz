// Fee routing for keeper rules: which part of a coin's trading fees the platform claims, and whose it is.
// The math lives in web/src/engine/fees.js, shared with the site (the launch review shows the creator this exact split);
// this module types it for the server and adds the keeper's lamport allocation.
//   curve, no Sniper Fee → Burn: creatorTradingFeePercentage = 50 − ceil(Σshares / 2); the platform claims
//       50 + ceil(Σshares / 2) points per pool, keeps exactly 50 of them, spends Σshares / 2 on the rules and returns
//       the rounding half point (if any) to the creator.
//   curve, with Sniper Fee → Burn: creatorTradingFeePercentage = 0 (the keeper burns the excess, keeps 50 points of the
//       rest, spends Σshares / 2 on the rules and pays the creator its remaining 50 − Σshares / 2 points every round).
//   after graduation (DAMM v2): a permanently locked partner position of ceil(Σshares)% of the LP; all of its fees go
//       to the rules (rounding to the creator).
// Coins without keeper rules keep creator 50 / hookrz 50 on the curve and 100% of the LP for the creator.
import * as F from "../../web/src/engine/fees.js";

/** Points of the post-protocol trading fee, out of 100 (FEES). */
export const CREATOR_POINTS: number = F.CREATOR_POINTS;
export const PLATFORM_POINTS: number = F.PLATFORM_POINTS;
/** Meteora DBC's protocol cut of every trading fee (PROTOCOL_FEE_PERCENT). */
export const PROTOCOL_PCT: number = F.PROTOCOL_PCT;

/** Built-in keeper rules that spend `params.pct`% of the creator's fees. */
export const SHARE_RULES = F.SHARE_RULES as readonly string[];
/** Every block the keeper acts on (Sniper Fee → Burn: the scheduler is the curve's; the burn is the keeper's). */
export const KEEPER_RULES: Set<string> = F.KEEPER_RULES;

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

export const shares = F.shares as (stackIn: any[], abi?: ScriptAbi) => Share[];
/** Sniper Fee → Burn's DBC fee scheduler (the same numbers curve.ts writes into the config). */
export const sniperOf = F.sniperOf as (stackIn: any[]) => { startBps: number; seconds: number } | null;
export const feeRouting = F.feeRouting as (stackIn: any[], abi?: ScriptAbi) => Routing;
/** The keeper's shares must fit inside the creator's fees, and each built-in rule's params inside blocks.js bounds. */
export const validateShares = F.validateShares as (stackIn: any[], abi?: ScriptAbi) => string | null;

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
