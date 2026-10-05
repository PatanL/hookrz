// Curve and mint blocks → the Meteora DBC config. These blocks are not in the hook: they are fields of
// the coin's own DBC config, fixed at launch.
//   sniper-fee-burn → linear fee scheduler from `start`% down to 1% over `seconds` (the keeper burns the excess)
//   lp-lock         → creator's permanently locked share of the DAMM v2 position (else the 10% DBC minimum)
//   leftover-burn   → leftover receiver = the incinerator
//   locked-metadata → token update authority: none (Immutable)
// Keeper rules route their share of the creator's fees through the partner side (src/fees.ts):
//   creatorTradingFeePercentage = 50 − ceil(Σshares/2), or 0 with Sniper Fee → Burn; partner locked LP = ceil(Σshares)%.
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getNextSqrtPriceFromInput, getDeltaAmountBaseUnsigned, Rounding, buildCurve, TokenType, TokenAuthorityOption, BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption, ActivationType } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { normalize } from "../../web/src/engine/engine.js";
import { feeRouting, CREATOR_POINTS, type ScriptAbi } from "./fees.js";

export const SUPPLY = 1_000_000_000; // whole tokens
export const BASE_DECIMALS = 6;
export const QUOTE_DECIMALS = 9;
export const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
/** Creator's share of the post-protocol trading fee for a coin without keeper rules (FEES: creator 50 / hookrz 50). */
export const CREATOR_FEE_PCT = CREATOR_POINTS;

export type CurveOptions = { thresholdSol?: number; percentageSupplyOnMigration?: number; scriptAbi?: ScriptAbi };

export function curveFeatures(stackIn: any[]) {
  const stack = normalize(stackIn) as { id: string; params: any }[];
  const get = (id: string) => stack.find((s) => s.id === id)?.params ?? null;
  const fee = get("sniper-fee-burn");
  const lp = get("lp-lock");
  return {
    feeScheduler: fee ? { startBps: Math.min(9900, Math.round(fee.start * 100)), endBps: 100, seconds: Math.max(1, Math.round(fee.seconds)) } : null,
    lockedLpPct: lp ? Math.max(10, Math.min(100, Math.round(lp.pct))) : 10,
    leftoverBurn: !!get("leftover-burn"),
    lockedMetadata: !!get("locked-metadata"),
  };
}

/** DBC ConfigParameters for one coin. */
export function curveConfig(stack: any[], opts: CurveOptions = {}) {
  const f0 = curveFeatures(stack);
  const routing = feeRouting(stack, opts.scriptAbi);
  const lp = lpSplit(f0.lockedLpPct, routing.partnerLockedLpPct);
  const f = { ...f0, feeSplit: { creatorTradingFeePercentage: routing.creatorTradingFeePercentage, partnerLockedLpPct: lp.partnerLocked, creatorLockedLpPct: lp.creatorLocked, creatorLpPct: lp.creatorUnlocked, keeperShareBps: routing.shareBps } };
  // Linear scheduler: one period per second (at most 600), fee falls by an equal step each period.
  const periods = f.feeScheduler ? Math.min(600, f.feeScheduler.seconds) : 0;
  return {
    features: f,
    params: buildCurve({
      token: {
        tokenType: TokenType.Token2022,
        tokenBaseDecimal: BASE_DECIMALS,
        tokenQuoteDecimal: QUOTE_DECIMALS,
        tokenAuthorityOption: f.lockedMetadata ? TokenAuthorityOption.Immutable : TokenAuthorityOption.CreatorUpdateAuthority,
        totalTokenSupply: SUPPLY,
        leftover: 0,
      },
      fee: {
        baseFeeParams: {
          baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
          feeSchedulerParam: f.feeScheduler
            ? { startingFeeBps: f.feeScheduler.startBps, endingFeeBps: f.feeScheduler.endBps, numberOfPeriod: periods, totalDuration: f.feeScheduler.seconds }
            : { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
        },
        dynamicFeeEnabled: false,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: routing.creatorTradingFeePercentage,
        poolCreationFee: 0,
        enableFirstSwapWithMinFee: false,
      },
      migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps25, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
      liquidityDistribution: {
        partnerPermanentLockedLiquidityPercentage: lp.partnerLocked,
        partnerLiquidityPercentage: 0,
        creatorPermanentLockedLiquidityPercentage: lp.creatorLocked,
        creatorLiquidityPercentage: lp.creatorUnlocked,
      },
      lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
      activationType: ActivationType.Timestamp,
      percentageSupplyOnMigration: opts.percentageSupplyOnMigration ?? 20,
      migrationQuoteThreshold: opts.thresholdSol ?? 85,
    } as any),
  };
}

/** LP after migration: the keeper's routed share is a permanently locked partner position taken from the creator's share;
 *  the total locked never drops below the coin's LP Lock (or the DBC minimum of 10%). */
export function lpSplit(lockedLpPct: number, partnerLocked: number) {
  const partner = Math.max(0, Math.min(100, partnerLocked));
  const creatorLocked = Math.max(0, Math.min(100 - partner, lockedLpPct - partner));
  return { partnerLocked: partner, creatorLocked, creatorUnlocked: 100 - partner - creatorLocked };
}

/** Tokens (raw) the creator's first buy gets at launch, on the curve's first segment, after the t=0 fee. */
export function firstBuyRaw(params: any, lamports: bigint, feeBps: number) {
  if (lamports <= 0n) return 0n;
  const net = (lamports * BigInt(10_000 - feeBps)) / 10_000n;
  const sqrt0 = params.sqrtStartPrice as BN, seg = params.curve[0];
  let next = getNextSqrtPriceFromInput(sqrt0, seg.liquidity, new BN(net.toString()), false);
  if (next.gt(seg.sqrtPrice)) next = seg.sqrtPrice; // a first buy never needs more than the first segment
  return BigInt(getDeltaAmountBaseUnsigned(sqrt0, next, seg.liquidity, Rounding.Down).toString());
}
