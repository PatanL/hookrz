// Probe: a SOL-quoted Meteora DBC TransferHook launch on the fork, hooked to away-rules (stand-in until
// hookrz_engine exists). Proves: config + hooked pool + hook init, a hooked buy with re-resolved extra
// accounts, a sell, the curve completing, the hook retired, migration to DAMM v2.
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, NATIVE_MINT, createTransferCheckedWithTransferHookInstruction, getAssociatedTokenAddressSync, getTransferHook, unpackMint } from "@solana/spl-token";
import {
  DynamicBondingCurveClient, buildCurve, TokenType, TokenAuthorityOption, BaseFeeMode, CollectFeeMode, MigrationOption, MigrationFeeOption, ActivationType,
  deriveDbcPoolAddress, deriveDbcPoolAuthority, SwapMode, DAMM_V2_MIGRATION_FEE_ADDRESS, DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { ForkChain } from "../src/fork.js";
import { sdkConnection } from "../src/sdk-connection.js";

const RULES = new PublicKey("3mx9QjgLoR6BadkSCbEzE8rzKGgiF24VyjT1PzUxqYSu");
const chain = new ForkChain({ dir: ".runtime/dbc-fork", programs: [{ id: RULES.toBase58(), so: ".runtime/away_rules.so" }] });
const conn = sdkConnection(chain);
const dbc = new DynamicBondingCurveClient(conn, "confirmed");
const alice = Keypair.generate(), bob = Keypair.generate();
chain.fund(alice.publicKey, 1000);
chain.fund(bob.publicKey, 1000);

async function send(label: string, tx: Transaction, signers: Keypair[], cu = 1_000_000) {
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await chain.blockhash()).blockhash;
  tx.instructions = tx.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId));
  if (cu) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }));
  tx.partialSign(...signers);
  const bytes = tx.serialize();
  const r = await chain.send(bytes);
  console.log(label, r.ok ? "OK" : "FAIL", r.signature.slice(0, 16), "bytes", bytes.length, "cu", r.units, r.ok ? "" : `code ${r.code}`);
  if (!r.ok) throw Object.assign(new Error(label), { rec: r });
  return r;
}

const params = buildCurve({
  token: { tokenType: TokenType.Token2022, tokenBaseDecimal: 6, tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: {
    baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
  },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps25, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
  liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 0, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 100, creatorLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  percentageSupplyOnMigration: 20,
  migrationQuoteThreshold: 85,
} as any);

const config = Keypair.generate(), mint = Keypair.generate();
const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, config.publicKey);
const tx = await dbc.partner.createConfigAndPoolWithTransferHook({
  ...params, config: config.publicKey, feeClaimer: alice.publicKey, leftoverReceiver: alice.publicKey, quoteMint: NATIVE_MINT, payer: alice.publicKey,
  transferHookProgram: RULES,
  preCreatePoolParam: { baseMint: mint.publicKey, poolCreator: alice.publicKey, name: "Probe Coin", symbol: "PROBE", uri: "https://hookrz.fun/m/probe.json" },
} as any);
const rulesPda = PublicKey.findProgramAddressSync([Buffer.from("rules"), mint.publicKey.toBuffer()], RULES)[0];
const metaPda = PublicKey.findProgramAddressSync([Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()], RULES)[0];
const init = Buffer.alloc(12);
init[0] = 0xa0; init[1] = 1; init.writeUInt16LE(5000, 2); init.writeUInt32LE(60, 4);
tx.add(new TransactionInstruction({ programId: RULES, keys: [
  { pubkey: alice.publicKey, isSigner: true, isWritable: true }, { pubkey: mint.publicKey, isSigner: false, isWritable: false }, { pubkey: pool, isSigner: false, isWritable: false },
  { pubkey: rulesPda, isSigner: false, isWritable: true }, { pubkey: metaPda, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
], data: init }));
console.log("ixs", tx.instructions.map((i) => i.programId.toBase58().slice(0, 6)));
await send("launch", tx, [alice, config, mint], 0);

const conf = (await dbc.state.getPoolConfig(config.publicKey))!;
async function swap(who: Keypair, sell: boolean, amount: bigint) {
  const st = (await dbc.state.getPool(pool))!;
  const unix = (await chain.read([])).unix;
  const q = dbc.pool.swapQuote2({ virtualPool: st, config: conf, swapBaseForQuote: sell, swapMode: SwapMode.PartialFill, amountIn: new BN(amount.toString()), slippageBps: 500, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: new BN(unix.toString()) });
  const t = await dbc.pool.swap2WithTransferHook({ owner: who.publicKey, pool, swapBaseForQuote: sell, swapMode: SwapMode.PartialFill, amountIn: new BN(amount.toString()), minimumAmountOut: new BN(1), referralTokenAccount: null } as any);
  const ata = getAssociatedTokenAddressSync(mint.publicKey, who.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const [src, dst, auth] = sell ? [ata, st.poolState.baseVault, who.publicKey] : [st.poolState.baseVault, ata, deriveDbcPoolAuthority()];
  const hookIx = await createTransferCheckedWithTransferHookInstruction(conn, src, mint.publicKey, dst, auth, 0n, 6, [], "confirmed", TOKEN_2022_PROGRAM_ID);
  const resolved = hookIx.keys.slice(4);
  const i = t.instructions.findIndex((x) => x.programId.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID));
  const swapIx = t.instructions[i];
  console.log("  tail", swapIx.keys.slice(-resolved.length).map((k) => k.pubkey.toBase58().slice(0, 6)), "resolved", resolved.map((k) => k.pubkey.toBase58().slice(0, 6)));
  swapIx.keys.splice(swapIx.keys.length - resolved.length, resolved.length, ...resolved);
  return { r: await send(`${sell ? "sell" : "buy"} ${amount}`, t, [who]), q };
}
const b = await swap(bob, false, 1_000_000_000n);
console.log("bought", b.q.outputAmount.toString());
await swap(bob, true, BigInt(b.q.outputAmount.toString()) / 2n);
chain.warp(120);
let amt = 100_000_000_000n;
for (let i = 0; i < 60 && (await dbc.state.getPoolQuoteTokenCurveProgress(pool)) < 1; i++) {
  try { await swap(bob, false, amt); chain.warp(61); } catch (e: any) { if (e.rec?.code !== 6003) throw e; amt = amt / 2n; }
}
const m = unpackMint(mint.publicKey, (await chain.read([mint.publicKey])).accounts[0] as any, TOKEN_2022_PROGRAM_ID);
console.log("hook after completion:", getTransferHook(m)?.programId.toBase58(), "progress", await dbc.state.getPoolQuoteTokenCurveProgress(pool));
const mig = await dbc.migration.migrateToDammV2({ pool, payer: alice.publicKey, dammConfig: DAMM_V2_MIGRATION_FEE_ADDRESS[MigrationFeeOption.FixedBps25] });
await send("migrate", mig.transaction, [alice, mig.firstPositionNftKeypair, mig.secondPositionNftKeypair]);
console.log("PROBE OK");
