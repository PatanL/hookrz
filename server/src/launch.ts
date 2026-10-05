// Launch transaction builder (POST /v1/launch/prepare).
//   1. DBC createConfig(WithTransferHook): curve, fee scheduler (sniper-fee-burn), LP lock, leftover receiver
//   2. DBC initializeVirtualPoolWithToken2022TransferHook: creates the Token-2022 mint (TransferHook →
//      hookrz_engine, authority = DBC pool authority; MetadataPointer + TokenMetadata) and the pool
//   3. hookrz_engine init_stack: Stack (+ Script) + ExtraAccountMetaList, in the SAME transaction as 2,
//      so no transfer can run before the rules are armed
//   4. optional creator buy (opens the creator's Wallet record when the stack keeps one)
// Packed greedily into as few transactions as fit 1,232 bytes; 2+3 always share one.
import { Keypair, PublicKey, Transaction, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveDbcPoolAddress, deriveDbcTokenVaultAddress, deriveDbcPoolAuthority, AccountsType } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { budget, normalize } from "../../web/src/engine/engine.js";
import { curveConfig, INCINERATOR } from "./curve.js";
import { sdk, ensure, AppError } from "./market.js";
import type { HookProgram } from "./hook.js";
import { hookSlots } from "./layout.js";
import { resolveGate, withGateMin } from "./marks.js";
import type { ScriptAbi } from "./fees.js";
import type { Chain } from "./chain.js";

export const TX_LIMIT = 1232;

export type LaunchInput = {
  creator: PublicKey;
  platform: PublicKey;
  name: string;
  symbol: string;
  uri: string | ((mint: string) => string);
  stack: any[];
  creatorBuyLamports?: bigint;
  thresholdSol?: number;
  parentStack?: PublicKey | null;
  parentAuthor?: PublicKey | null;
  script?: Uint8Array | null;
  /** The script's compiler ABI: its `payout` declarations are keeper shares routed at launch (src/fees.ts). */
  scriptAbi?: ScriptAbi;
  /** Reuse the throwaway mint/config keypairs of an earlier prepare (same launch, fresh blockhash). */
  keys?: { mint: Keypair; config: Keypair } | null;
  /** Blocklist marks / Allowlist passes written in the init_stack transaction (the launch slot: a Blocklist that freezes
   *  "immediately" can only be set here). The creator's launch buy needs no pass (Allowlist Phase exempts it). */
  marks?: { owner: PublicKey; flags: number }[];
};

type Group = { label: string; ixs: TransactionInstruction[]; signers: Keypair[] };

export function txSize(tx: Transaction) {
  const m = tx.compileMessage();
  return 1 + 64 * m.header.numRequiredSignatures + m.serialize().length;
}

export async function buildLaunch(chain: Chain, hook: HookProgram | null, a: LaunchInput) {
  const { dbc } = sdk(chain);
  const b = budget(a.stack);
  ensure(b.ok, b.warnings.find((w: any) => w.level === "error")?.text ?? "Invalid stack", "STACK_INVALID");
  // A hook only when the engine runs a slot: Diamond Tiers is read by the keeper, not run by the engine.
  const hooked = hookSlots(a.stack).length > 0;
  ensure(!hooked || hook, "The hook engine is not available on this network", "ENGINE_UNAVAILABLE");
  const config = a.keys?.config ?? Keypair.generate(), mint = a.keys?.mint ?? Keypair.generate();
  const uri = typeof a.uri === "function" ? a.uri(mint.publicKey.toBase58()) : a.uri;
  ensure(a.name.length >= 1 && a.name.length <= 32 && a.symbol.length >= 1 && a.symbol.length <= 10 && uri.length <= 200, "Name ≤ 32, ticker ≤ 10, uri ≤ 200 characters");
  const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, config.publicKey);
  const baseVault = deriveDbcTokenVaultAddress(pool, mint.publicKey);
  const { params, features } = curveConfig(a.stack, { thresholdSol: a.thresholdSol, scriptAbi: a.scriptAbi });
  const common = {
    ...params,
    config: config.publicKey,
    feeClaimer: a.platform,
    leftoverReceiver: features.leftoverBurn ? INCINERATOR : a.creator,
    quoteMint: NATIVE_MINT,
    payer: a.creator,
  };

  const groups: Group[] = [];
  // createConfigAndPool* builds both instructions offline (createPool alone would read the config from chain).
  const both = hooked
    ? await dbc.partner.createConfigAndPoolWithTransferHook({ ...common, transferHookProgram: hook!.id, preCreatePoolParam: { baseMint: mint.publicKey, poolCreator: a.creator, name: a.name, symbol: a.symbol, uri } } as any)
    : await dbc.partner.createConfigAndPool({ ...common, preCreatePoolParam: { baseMint: mint.publicKey, poolCreator: a.creator, name: a.name, symbol: a.symbol, uri } } as any);
  const ixs = both.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId));
  const cut = ixs.findIndex((i) => i.keys.some((k) => k.pubkey.equals(mint.publicKey)));
  ensure(cut > 0, "unexpected DBC createConfigAndPool layout");
  // Resuming a launch whose first transaction(s) already landed (same mint and config keys): skip what exists.
  const { accounts: [cfgAcc, poolAcc, stackAcc] } = await chain.read([config.publicKey, pool, hooked ? hook!.stackPda(mint.publicKey) : pool]);
  ensure(!(hooked && stackAcc && poolAcc), "This launch already landed", "ALREADY_LAUNCHED");
  if (!cfgAcc) groups.push({ label: "DBC createConfig" + (hooked ? "WithTransferHook" : ""), ixs: ixs.slice(0, cut), signers: [config] });
  // Token Gate: the ticker's mint on this network (refuses $HOOKRZ and mints that aren't here); init_stack packs the raw minimum.
  const gate = hooked ? await resolveGate(chain, a.stack) : null;
  const initArgs = { creator: a.creator, mint: mint.publicKey, pool, config: config.publicKey, baseVault, stack: withGateMin(a.stack, gate), parentStack: a.parentStack, parentAuthor: a.parentAuthor, script: a.script, gateMint: gate?.mint ?? null };
  const marks = a.marks ?? [];
  ensure(!marks.length || (hooked && hook!.setMarkIx), "Marks need the hookrz engine", "ENGINE_UNAVAILABLE");
  const markIxs = marks.map((m) => hook!.setMarkIx!(a.creator, mint.publicKey, m.owner, m.flags));
  const poolIxs = ixs.slice(cut);

  // The creator buy (optional), built from the config alone (the pool isn't on chain yet).
  let buyIxs: TransactionInstruction[] = [];
  let buyLabel = "creator buy";
  if (a.creatorBuyLamports && a.creatorBuyLamports > 0n) {
    const ata = getAssociatedTokenAddressSync(mint.publicKey, a.creator, false, TOKEN_2022_PROGRAM_ID);
    const pre: TransactionInstruction[] = [];
    let extra: any = {};
    if (hooked) {
      const extras = hook!.expectedExtras(mint.publicKey, pool, baseVault, ata, a.stack, a.script, { sourceOwner: deriveDbcPoolAuthority(), destinationOwner: a.creator, gate });
      ensure(extras, "This hook program cannot resolve accounts before launch; buy after the launch lands", "NO_FIRST_BUY");
      extra = { transferHookAccountsInfo: { slices: [{ accountsType: AccountsType.TransferHookBase, length: extras.length }] }, transferHookAccounts: extras };
      if (hook!.needsWalletRecord(a.stack)) pre.push(hook!.openWalletIx(a.creator, mint.publicKey, ata)!);
    }
    const swapTx: Transaction = hooked
      ? await (dbc.pool as any).buildSwap2WithTransferHookBuyTx(
          { buyer: a.creator, receiver: a.creator, buyAmount: new BN(a.creatorBuyLamports.toString()), minimumAmountOut: new BN(1), referralTokenAccount: null, ...extra },
          mint.publicKey, config.publicKey, params.poolFees.baseFee, params.activationType, NATIVE_MINT, false,
        )
      : await (dbc.pool as any).buildSwapBuyTx({ buyer: a.creator, receiver: a.creator, buyAmount: new BN(a.creatorBuyLamports.toString()), minimumAmountOut: new BN(1), referralTokenAccount: null }, mint.publicKey, config.publicKey, params.poolFees.baseFee, false, params.activationType, 1, NATIVE_MINT, false);
    // ATA create must precede open_wallet (which checks the token account), so put it first.
    const sw = swapTx.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId));
    const ataIdx = sw.findIndex((i) => i.keys.some((k) => k.pubkey.equals(ata)) && i.programId.toBase58().startsWith("ATok"));
    buyIxs = pre.length && ataIdx >= 0 ? [...sw.slice(0, ataIdx + 1), ...pre, ...sw.slice(ataIdx + 1)] : [...pre, ...sw];
    if (pre.length) buyLabel += " (opens the Wallet record)";
  }

  const fits = (list: TransactionInstruction[]) => txSize(new Transaction({ feePayer: a.creator, recentBlockhash: PublicKey.default.toBase58() }).add(...list)) <= TX_LIMIT;
  if (!poolAcc) groups.push({ label: hooked ? "DBC initializeVirtualPoolWithToken2022TransferHook" : "DBC initializeVirtualPoolWithToken2022", ixs: poolIxs, signers: [mint] });
  if (hooked) {
    // init_stack and the creator buy go in ONE transaction, so the buy lands in the launch slot (Snipe Shield and
    // Anti-Bundle exempt it there). Splitting pool and init_stack is safe: until init_stack writes the Stack and the
    // ExtraAccountMetaList every transfer of the mint fails, and only the pool creator can init (or stage a script).
    const inline = [...hook!.initIxs(initArgs), ...markIxs];
    const marksLabel = markIxs.length ? ` + set_mark × ${markIxs.length}` : "";
    if (fits([...inline, ...buyIxs])) groups.push({ label: "hookrz_engine init_stack" + marksLabel + (buyIxs.length ? ` + ${buyLabel}` : ""), ixs: [...inline, ...buyIxs], signers: [] });
    else {
      // A long Hookscript: stage it with write_script chunks, then seal it with init_stack (staged).
      ensure(a.script && hook!.writeScriptIxs, markIxs.length ? `init_stack, ${markIxs.length} launch mark(s) and the creator buy don't fit one transaction: launch with fewer marks and add the rest after launch (a Blocklist that freezes "immediately" can only be written at launch)` : "init_stack does not fit one transaction", "TX_TOO_LARGE");
      for (const w of hook!.writeScriptIxs(a.creator, mint.publicKey, pool, a.script!, 700)) groups.push({ label: "hookrz_engine write_script", ixs: [w], signers: [] });
      const sealed = [...hook!.initIxs({ ...initArgs, staged: true }), ...markIxs];
      if (fits([...sealed, ...buyIxs])) groups.push({ label: "hookrz_engine init_stack (seals the staged script)" + marksLabel + (buyIxs.length ? ` + ${buyLabel}` : ""), ixs: [...sealed, ...buyIxs], signers: [] });
      else {
        groups.push({ label: "hookrz_engine init_stack (seals the staged script)", ixs: sealed, signers: [] });
        if (buyIxs.length) groups.push({ label: `${buyLabel} (own transaction: not exempt from Snipe Shield / Anti-Bundle)`, ixs: buyIxs, signers: [] });
      }
    }
  } else if (buyIxs.length) groups.push({ label: buyLabel, ixs: buyIxs, signers: [] });

  const { blockhash } = await chain.blockhash();
  const txs: { label: string; tx: Transaction; signers: Keypair[] }[] = [];
  let cur: { labels: string[]; tx: Transaction; signers: Keypair[] } | null = null;
  const fresh = () => {
    const tx = new Transaction({ feePayer: a.creator, recentBlockhash: blockhash });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));
    return { labels: [] as string[], tx, signers: [] as Keypair[] };
  };
  for (const g of groups) {
    if (cur) {
      const trial = new Transaction({ feePayer: a.creator, recentBlockhash: blockhash }).add(...cur.tx.instructions, ...g.ixs);
      if (txSize(trial) <= TX_LIMIT) {
        cur.tx = trial;
        cur.labels.push(g.label);
        cur.signers.push(...g.signers);
        continue;
      }
      txs.push({ label: cur.labels.join(" + "), tx: cur.tx, signers: cur.signers });
    }
    cur = fresh();
    cur.tx.add(...g.ixs);
    cur.labels.push(g.label);
    cur.signers.push(...g.signers);
    if (txSize(cur.tx) > TX_LIMIT) {
      // Drop the explicit compute budget (default 200k CU per instruction suffices) before giving up.
      cur.tx.instructions = cur.tx.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId));
      if (txSize(cur.tx) > TX_LIMIT) throw new AppError("TX_TOO_LARGE", `${g.label} is ${txSize(cur.tx)} bytes, over ${TX_LIMIT}`);
    }
  }
  txs.push({ label: cur!.labels.join(" + "), tx: cur!.tx, signers: cur!.signers });
  for (const t of txs) if (t.signers.length) t.tx.partialSign(...t.signers);

  return {
    mint: mint.publicKey.toBase58(),
    pool: pool.toBase58(),
    config: config.publicKey.toBase58(),
    baseVault: baseVault.toBase58(),
    hooked,
    hookProgram: hooked ? hook!.id.toBase58() : null,
    features,
    stack: normalize(a.stack),
    transactions: txs.map((t) => ({
      label: t.label,
      bytes: txSize(t.tx),
      base64: t.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      signers: t.tx.compileMessage().accountKeys.slice(0, t.tx.compileMessage().header.numRequiredSignatures).map((k) => k.toBase58()),
    })),
    blockhash,
    keys: { mint, config },
  };
}
