// A coin's market: the Meteora DBC curve until graduation, then its DAMM v2 pool. Snapshot, raw quote
// and unsigned swap builders (hook accounts re-resolved for the real transfer, Wallet record opened).
// Adapted from away-tek src/server/dbc.ts (curveSnapshot, buildCurveSwap, patchRuledSwap).
import { PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import {
  DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID, DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress, deriveDbcPoolAuthority, SwapMode,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { sdkConnection } from "./sdk-connection.js";
import { resolveHookAccounts, liveHookProgram, type HookProgram } from "./hook.js";
import { BASE_DECIMALS, QUOTE_DECIMALS } from "./curve.js";
import type { Chain } from "./chain.js";

const HOOK_POOL = Buffer.from([237, 219, 184, 23, 42, 189, 169, 35]); // DBC TransferHookPool discriminator

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: any) {
    super(message);
  }
}
export function ensure(c: unknown, msg: string, code = "BAD_REQUEST"): asserts c {
  if (!c) throw new AppError(code, msg);
}

const clients = new WeakMap<Chain, { dbc: DynamicBondingCurveClient; amm: CpAmm }>();
export function sdk(chain: Chain) {
  let c = clients.get(chain);
  if (!c) {
    const conn = sdkConnection(chain);
    c = { dbc: new DynamicBondingCurveClient(conn, "confirmed"), amm: new CpAmm(conn) };
    clients.set(chain, c);
  }
  return c;
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export async function snapshot(chain: Chain, pool: PublicKey) {
  const { dbc, amm } = sdk(chain);
  const { accounts: [raw], slot, unix } = await chain.read([pool]);
  ensure(raw?.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID), "Not a DBC pool", "NOT_FOUND");
  const hooked = Buffer.from(raw!.data).subarray(0, 8).equals(HOOK_POOL);
  const virtual = (await dbc.state.getPool(pool))!;
  const p = virtual.poolState;
  const config = (await dbc.state.getPoolConfig(p.config))!;
  const ammId = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption], p.baseMint, config.quoteMint);
  const migrated = p.isMigrated === 1;
  const complete = migrated || p.quoteReserve.gte(config.migrationQuoteThreshold);
  let ammState: any = null;
  let sqrt = BigInt(p.sqrtPrice.toString());
  if (migrated) {
    ammState = await amm.fetchPoolState(ammId);
    sqrt = BigInt(ammState.sqrtPrice.toString());
  }
  const price = sqrtToPrice(sqrt); // SOL per whole token
  const threshold = BigInt(config.migrationQuoteThreshold.toString());
  const raised = BigInt(p.quoteReserve.toString());
  const progress = complete ? 1 : Number(raised) / Number(threshold);
  const hookProgram = hooked ? await liveHookProgram(chain, p.baseMint) : null;
  return {
    pool, virtual, config, ammId, ammState, slot, unix: Number(unix), hooked, hookProgram,
    mint: p.baseMint as PublicKey, baseVault: p.baseVault as PublicKey, quoteVault: p.quoteVault as PublicKey, creator: p.creator as PublicKey,
    stage: (migrated ? "graduated" : complete ? "graduating" : "curve") as "curve" | "graduating" | "graduated",
    sqrtPrice: sqrt, price, progress, raisedSol: Number(raised) / 1e9, thresholdSol: Number(threshold) / 1e9,
    activationPoint: Number(p.activationPoint.toString()),
  };
}
/** Q64.64 sqrt price (raw quote per raw base) → SOL per whole token. */
export function sqrtToPrice(sqrt: bigint) {
  const s = Number(sqrt) / 2 ** 64;
  return s * s * 10 ** (BASE_DECIMALS - QUOTE_DECIMALS);
}

export type RawQuote = { input: bigint; output: bigint; consumed: bigint; fee: bigint; nextSqrt: bigint; feeBps: number };
/** side buy: input = lamports; sell: input = raw tokens. */
export function rawQuote(chain: Chain, s: Snapshot, side: "buy" | "sell", input: bigint, now = s.unix): RawQuote {
  const { dbc, amm } = sdk(chain);
  if (input <= 0n) return { input, output: 0n, consumed: 0n, fee: 0n, nextSqrt: s.sqrtPrice, feeBps: 0 };
  if (s.stage === "graduated") {
    const q = amm.getQuote({
      inAmount: new BN(input.toString()), inputTokenMint: side === "buy" ? NATIVE_MINT : s.mint, slippage: 0, poolState: s.ammState,
      currentTime: now, currentSlot: s.slot, tokenADecimal: BASE_DECIMALS, tokenBDecimal: QUOTE_DECIMALS, hasReferral: false,
    } as any);
    return { input, output: BigInt(q.swapOutAmount.toString()), consumed: BigInt(q.consumedInAmount.toString()), fee: BigInt(q.totalFee.toString()), nextSqrt: s.sqrtPrice, feeBps: 25 };
  }
  const q = dbc.pool.swapQuote2({
    virtualPool: s.virtual, config: s.config, swapBaseForQuote: side === "sell", swapMode: SwapMode.PartialFill, amountIn: new BN(input.toString()),
    slippageBps: 100, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(now.toString()),
  } as any);
  const fee = BigInt(q.tradingFee.add(q.protocolFee).add(q.referralFee).toString());
  const consumed = BigInt(q.includedFeeInputAmount.toString());
  const gross = side === "buy" ? consumed : BigInt(q.outputAmount.toString()) + fee;
  return { input, output: BigInt(q.outputAmount.toString()), consumed, fee, nextSqrt: BigInt(q.nextSqrtPrice.toString()), feeBps: gross > 0n ? Number((fee * 10_000n) / gross) : 0 };
}

export async function tokenBalance(chain: Chain, mint: PublicKey, owner: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  const { accounts: [a] } = await chain.read([ata]);
  return { ata, raw: a ? unpackAccount(ata, a as any, TOKEN_2022_PROGRAM_ID).amount : 0n, exists: !!a };
}

export async function envelope(chain: Chain, payer: PublicKey, tx: Transaction, cu = 400_000) {
  tx.feePayer = payer;
  tx.recentBlockhash = (await chain.blockhash()).blockhash;
  tx.instructions = tx.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId));
  if (cu) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }));
  return tx;
}

/** Unsigned swap for `owner`. Hooked curve: DBC swap2WithTransferHook with the trailing hook accounts
 *  re-resolved for this exact transfer, and the receiver's Wallet record opened first if the stack keeps one. */
export async function buildSwap(chain: Chain, hook: HookProgram | null, s: Snapshot, owner: PublicKey, side: "buy" | "sell", input: bigint, minOut: bigint, opts: { needsRecord?: boolean } = {}) {
  const { dbc, amm } = sdk(chain);
  ensure(s.stage !== "graduating", "The curve is complete and graduating; trade again once it is on DAMM v2", "GRADUATING");
  let tx: Transaction;
  const opened: string[] = [];
  if (s.stage === "graduated") {
    const p = s.ammState;
    tx = await amm.swap({
      payer: owner, pool: s.ammId, inputTokenMint: side === "buy" ? p.tokenBMint : p.tokenAMint, outputTokenMint: side === "buy" ? p.tokenAMint : p.tokenBMint,
      amountIn: new BN(input.toString()), minimumAmountOut: new BN(minOut.toString()), tokenAMint: p.tokenAMint, tokenBMint: p.tokenBMint,
      tokenAVault: p.tokenAVault, tokenBVault: p.tokenBVault, tokenAProgram: TOKEN_2022_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, referralTokenAccount: null, poolState: p,
    } as any);
  } else if (s.hooked && s.hookProgram) {
    tx = await dbc.pool.swap2WithTransferHook({ owner, pool: s.pool, swapBaseForQuote: side === "sell", swapMode: SwapMode.PartialFill, amountIn: new BN(input.toString()), minimumAmountOut: new BN(minOut.toString()), referralTokenAccount: null } as any);
    const ata = getAssociatedTokenAddressSync(s.mint, owner, true, TOKEN_2022_PROGRAM_ID);
    const [src, dst, auth] = side === "buy" ? [s.baseVault, ata, deriveDbcPoolAuthority()] : [ata, s.baseVault, owner];
    const i = tx.instructions.findIndex((x) => x.programId.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID));
    ensure(i >= 0, "swap instruction missing");
    const swap = tx.instructions[i];
    const resolved = await resolveHookAccounts(chain, s.mint, src, dst, auth);
    // spl-token order: [resolved extras…, hook program, meta list]; DBC takes them as its trailing accounts.
    const tail = swap.keys.slice(-resolved.length);
    ensure(tail.length === resolved.length && tail.at(-2)!.pubkey.equals(s.hookProgram), "Unexpected transfer-hook account layout");
    swap.keys.splice(swap.keys.length - resolved.length, resolved.length, ...resolved);
    if (hook && side === "buy" && opts.needsRecord) {
      const rec = hook.walletPda(s.mint, ata);
      const { accounts: [existing] } = rec ? await chain.read([rec]) : { accounts: [null] };
      // Only a record owned by the engine counts: anyone can send lamports to the address (away-tek M1).
      if (rec && !existing?.owner.equals(hook.id)) {
        tx.instructions.splice(i, 0, createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, s.mint, TOKEN_2022_PROGRAM_ID), hook.openWalletIx(owner, s.mint, ata)!);
        opened.push(rec.toBase58());
      }
    }
  } else {
    tx = await dbc.pool.swap2({ owner, pool: s.pool, swapBaseForQuote: side === "sell", swapMode: SwapMode.PartialFill, amountIn: new BN(input.toString()), minimumAmountOut: new BN(minOut.toString()), referralTokenAccount: null } as any);
  }
  return { tx: await envelope(chain, owner, tx), opened };
}

export async function buildMigration(chain: Chain, s: Snapshot, payer: PublicKey) {
  const { dbc } = sdk(chain);
  ensure(s.stage === "graduating", "This curve is not ready to graduate");
  const r = await dbc.migration.migrateToDammV2({ payer, pool: s.pool, dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[s.config.migrationFeeOption] });
  const tx = await envelope(chain, payer, r.transaction, 1_000_000);
  tx.partialSign(r.firstPositionNftKeypair, r.secondPositionNftKeypair);
  return { tx, ammPool: s.ammId };
}

export { DAMM_V2_PROGRAM_ID };
