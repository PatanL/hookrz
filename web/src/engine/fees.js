// Fee routing for keeper rules: which part of a coin's trading fees the platform claims, and whose it is.
// Shared by the site (the launch review and the coin page) and the server (server/src/fees.ts re-exports it, and the
// DBC config and the keeper are built from it), so the split a creator reviews is the split the chain is given.
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
import { normalize } from './engine.js';
import { byId } from '../data/blocks.js';

/** Points of the post-protocol trading fee, out of 100 (FEES). */
export const CREATOR_POINTS = 50;
export const PLATFORM_POINTS = 50;
/** Meteora DBC's protocol cut of every trading fee (PROTOCOL_FEE_PERCENT). */
export const PROTOCOL_PCT = 20;
/** DBC's minimum permanently locked LP share. */
export const MIN_LOCKED_LP_PCT = 10;

/** Built-in keeper rules that spend `params.pct`% of the creator's fees. */
export const SHARE_RULES = ['buyback-burn', 'holder-rewards', 'first-buyer-rebate', 'tithe', 'kingmaker', 'diamond-tiers'];
/** Every block the keeper acts on (Sniper Fee → Burn: the scheduler is the curve's; the burn is the keeper's). */
export const KEEPER_RULES = new Set([...SHARE_RULES, 'sniper-fee-burn']);

/**
 * The keeper's shares of the creator's fees: one per built-in share rule, plus one per Hookscript `payout` line.
 * Each: { key (block id, or `script:<i>`), id, label, bps (of the creator's fees, 10000 = all), kind: burn|pay,
 * mode? stream|pot|split, to?, params? }.
 */
export function shares(stackIn, abi) {
  const stack = normalize(stackIn);
  const out = [];
  for (const s of stack) {
    if (!SHARE_RULES.includes(s.id)) continue;
    out.push({ key: s.id, id: s.id, label: byId[s.id].name, bps: Math.round(Number(s.params.pct) * 100), kind: s.id === 'buyback-burn' ? 'burn' : 'pay', params: s.params });
  }
  if (stack.some((s) => s.id === 'custom')) {
    (abi?.payouts ?? []).forEach((p, i) => out.push({ key: `script:${i}`, id: 'custom', label: p.mode === 'split' ? `payout to wallets where ${p.to}` : `payout to ${p.to}${p.mode === 'pot' ? ' (pot)' : ''}`, bps: p.share_bps, kind: 'pay', mode: p.mode, to: p.to }));
  }
  return out;
}

/** Sniper Fee → Burn's DBC fee scheduler (the same numbers server/src/curve.ts writes into the config). */
export function sniperOf(stackIn) {
  const p = normalize(stackIn).find((s) => s.id === 'sniper-fee-burn')?.params;
  return p ? { startBps: Math.min(9900, Math.round(p.start * 100)), seconds: Math.max(1, Math.round(p.seconds)) } : null;
}

/** { shares, shareBps (Σ, of the creator's fees), sniper, creatorTradingFeePercentage, partnerLockedLpPct, keeper }. */
export function feeRouting(stackIn, abi) {
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
export function validateShares(stackIn, abi) {
  const stack = normalize(stackIn);
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

/** The coin's permanently locked LP share from LP Lock (else the DBC minimum). */
export function lockedLpPctOf(stackIn) {
  const p = normalize(stackIn).find((s) => s.id === 'lp-lock')?.params;
  return p ? Math.max(MIN_LOCKED_LP_PCT, Math.min(100, Math.round(p.pct))) : MIN_LOCKED_LP_PCT;
}

/** LP after migration: the keeper's routed share is a permanently locked partner position taken from the creator's share;
 *  the total locked never drops below the coin's LP Lock (or the DBC minimum of 10%). */
export function lpSplit(lockedLpPct, partnerLocked) {
  const partner = Math.max(0, Math.min(100, partnerLocked));
  const creatorLocked = Math.max(0, Math.min(100 - partner, lockedLpPct - partner));
  return { partnerLocked: partner, creatorLocked, creatorUnlocked: 100 - partner - creatorLocked };
}

/** The DBC config's fee fields for a stack: what POST /v1/launch/prepare returns as `curve.feeSplit`. */
export function feeSplit(stackIn, abi) {
  const R = feeRouting(stackIn, abi);
  const lp = lpSplit(lockedLpPctOf(stackIn), R.partnerLockedLpPct);
  return { creatorTradingFeePercentage: R.creatorTradingFeePercentage, partnerLockedLpPct: lp.partnerLocked, creatorLockedLpPct: lp.creatorLocked, creatorLpPct: lp.creatorUnlocked, keeperShareBps: R.shareBps };
}

/**
 * Who gets what of every trade, for the site, in % of the trade after Meteora's protocol cut (`protocolPct`). `split` (a prepare's curve.feeSplit) overrides the local numbers when the server built
 * the launch, so a script payout the browser can't see still counts.
 * → { keeper, creatorPct, platformPct, rulesPct, shareOfCreatorPct, rules[{ key, id, label, kind, to, pct, shareOfCreatorPct }],
 *     lpForRulesPct, sniper{ startPct, endPct, seconds } | null, creatorViaKeeper }
 */
export function splitView(stackIn, { abi, tradeFeePct = 1, split = null } = {}) {
  const R = feeRouting(stackIn, abi);
  const shareBps = split?.keeperShareBps ?? R.shareBps;
  // one point of the post-protocol fee, in % of the trade: Meteora keeps PROTOCOL_PCT of every trading fee first,
  // so on a 1% fee the creator's 50 points are 0.4% of the trade, not 0.5%
  const pt = (tradeFeePct / 100) * (1 - PROTOCOL_PCT / 100);
  const rules = R.shares.map((s) => ({ key: s.key, id: s.id, label: s.label, kind: s.kind, to: s.id === 'tithe' ? s.params?.to || null : s.to ?? null, pct: (s.bps / 200) * pt, shareOfCreatorPct: s.bps / 100 }));
  const listed = R.shares.reduce((a, s) => a + s.bps, 0);
  if (shareBps > listed) rules.push({ key: 'script', id: 'custom', label: 'Your own rule', kind: 'pay', to: null, pct: ((shareBps - listed) / 200) * pt, shareOfCreatorPct: (shareBps - listed) / 100 });
  return {
    keeper: R.keeper || shareBps > 0,
    creatorPct: (CREATOR_POINTS - shareBps / 200) * pt,
    platformPct: PLATFORM_POINTS * pt,
    rulesPct: (shareBps / 200) * pt,
    shareOfCreatorPct: shareBps / 100,
    rules,
    lpForRulesPct: split?.partnerLockedLpPct ?? Math.ceil(shareBps / 100),
    sniper: R.sniper ? { startPct: R.sniper.startBps / 100, endPct: 1, seconds: R.sniper.seconds } : null,
    creatorViaKeeper: !!R.sniper || split?.creatorTradingFeePercentage === 0,
    protocolPct: tradeFeePct * PROTOCOL_PCT / 100,
  };
}
