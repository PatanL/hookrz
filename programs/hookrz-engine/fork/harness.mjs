// LiteSVM harness for hookrz_engine: the mainnet Token-2022 and ATA binaries (from the away-tek fork
// snapshot), our .so, and a stand-in DBC pool/config (accounts owned by the DBC program id with the
// real discriminators and field offsets). Transfers go through Token-2022's transfer_checked with the
// hook accounts resolved by spl-token's own ExtraAccountMetaList resolver, so Execute runs exactly as
// it does inside a DBC swap. Real DBC swaps are covered by BACKEND's e2e (server/tests/e2e-fork.test.ts).
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { address, lamports, getTransactionDecoder } from '@solana/kit';
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initStackData, writeScriptData, setMarkData, SEEDS, IX } from '../js/layout.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAP = process.env.FORK_PROGRAMS ?? '/home/dzliu/away-tek/.runtime/dbc-fork/programs';
export const T22 = spl.TOKEN_2022_PROGRAM_ID;
export const ATA = spl.ASSOCIATED_TOKEN_PROGRAM_ID;
export const SPL = spl.TOKEN_PROGRAM_ID;
// ENGINE_ID runs the suite with the same .so loaded at another address (the program uses the runtime program id).
export const ENGINE = new PublicKey(process.env.ENGINE_ID ?? 'EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr');
export const DBC = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');
export const DBC_AUTHORITY = new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM');
export const SUPPLY = 1_000_000_000_000_000n;
export const DECIMALS = 6;
export const MONDAY = 1_791_129_600n; // 2026-10-05 00:00 HKT = 2026-10-04 16:00 UTC

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), ENGINE)[0];
export const stackPda = (mint) => pda(SEEDS.stack(mint.toBytes()));
export const scriptPda = (mint) => pda(SEEDS.script(mint.toBytes()));
export const metasPda = (mint) => pda(SEEDS.extraMetas(mint.toBytes()));
export const walletPda = (mint, ta) => pda(SEEDS.wallet(mint.toBytes(), ta.toBytes()));
export const markPda = (mint, owner) => pda(SEEDS.mark(mint.toBytes(), owner.toBytes()));

export function soPath() {
  for (const p of [join(HERE, '../target/sbpf-solana-solana/release/hookrz_engine.so'), join(HERE, '../hookrz_engine.so')]) if (existsSync(p)) return p;
  throw new Error('hookrz_engine.so not built');
}

export class Fork {
  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgram(address(T22.toBase58()), readFileSync(`${SNAP}/${T22.toBase58()}.so`));
    this.svm.addProgram(address(ATA.toBase58()), readFileSync(`${SNAP}/${ATA.toBase58()}.so`));
    this.svm.addProgram(address(SPL.toBase58()), readFileSync(`${SNAP}/${SPL.toBase58()}.so`));
    this.svm.addProgram(address(ENGINE.toBase58()), readFileSync(soPath()));
    this.payer = this.funded();
    this.setTime(MONDAY + 15n * 3600n, 1_000n); // 07:00 UTC
    const svm = this.svm;
    this.conn = {
      async getAccountInfo(pk) {
        const a = svm.getAccount(address(pk.toBase58()));
        return a.exists ? { data: Buffer.from(a.data), owner: new PublicKey(a.programAddress), lamports: Number(a.lamports), executable: a.executable } : null;
      },
    };
  }
  funded(sol = 100n) {
    const k = Keypair.generate();
    this.svm.airdrop(address(k.publicKey.toBase58()), lamports(sol * 1_000_000_000n));
    return k;
  }
  now() { const c = this.svm.getClock(); return { unix: c.unixTimestamp, slot: c.slot }; }
  setTime(unix, slot) {
    const c = this.svm.getClock();
    c.unixTimestamp = BigInt(unix);
    if (slot != null) c.slot = BigInt(slot);
    this.svm.setClock(c);
  }
  warp(seconds, slots = Math.max(1, Math.round(seconds * 2.5))) {
    const c = this.svm.getClock();
    c.unixTimestamp += BigInt(seconds);
    c.slot += BigInt(slots);
    this.svm.setClock(c);
  }
  account(pk) { const a = this.svm.getAccount(address(pk.toBase58())); return a.exists ? { data: Buffer.from(a.data), owner: new PublicKey(a.programAddress), lamports: a.lamports } : null; }
  setAccount(pk, owner, data, lam) {
    this.svm.setAccount({ address: address(pk.toBase58()), lamports: lamports(BigInt(lam ?? this.svm.minimumBalanceForRentExemption(BigInt(data.length)))), data, space: BigInt(data.length), programAddress: address(owner.toBase58()), executable: false });
  }
  /** Replace the engine's code in place (as an upgrade does): accounts and the program address stay. */
  loadEngine(path) { this.svm.addProgram(address(ENGINE.toBase58()), readFileSync(path)); this.svm.expireBlockhash(); }
  /** Send instructions; returns { ok, code, err, logs, cu (whole tx), engineCu (Execute / our instruction) }. */
  send(ixs, signers, { units = 1_400_000 } = {}) {
    const tx = new Transaction({ feePayer: signers[0].publicKey, recentBlockhash: this.svm.latestBlockhash() });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units }), ...ixs);
    tx.sign(...signers);
    const r = this.svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
    this.svm.expireBlockhash();
    const m = r instanceof FailedTransactionMetadata ? r.meta() : r;
    const logs = m.logs();
    const mine = logs.map((l) => l.match(new RegExp(`^Program ${ENGINE.toBase58()} consumed (\\d+) of`))).filter(Boolean).map((x) => +x[1]);
    if (r instanceof FailedTransactionMetadata) {
      const err = r.toString();
      const code = err.match(/Custom\((\d+)\)/);
      return { ok: false, err, code: code ? +code[1] : null, logs, cu: Number(m.computeUnitsConsumed()), engineCu: mine.at(-1) ?? null };
    }
    return { ok: true, code: null, logs, cu: Number(m.computeUnitsConsumed()), engineCu: mine.at(-1) ?? null };
  }
  must(ixs, signers, opts) {
    const r = this.send(ixs, signers, opts);
    if (!r.ok) throw new Error(`${r.err}\n${r.logs.join('\n')}`);
    return r;
  }

  /** A hooked mint + vault + stand-in DBC pool and config; supply minted into the vault. */
  coin({ creator = this.funded(), hookProgram = ENGINE, hookAuthority = DBC_AUTHORITY, threshold = 85_000_000_000n, feeSchedule = null } = {}) {
    const mint = Keypair.generate();
    const vaultOwner = this.funded(1n);
    const space = spl.getMintLen([spl.ExtensionType.TransferHook]);
    const vault = spl.getAssociatedTokenAddressSync(mint.publicKey, vaultOwner.publicKey, false, T22);
    this.must([
      SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: mint.publicKey, space, lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(space))), programId: T22 }),
      spl.createInitializeTransferHookInstruction(mint.publicKey, hookAuthority, hookProgram, T22),
      spl.createInitializeMintInstruction(mint.publicKey, DECIMALS, this.payer.publicKey, null, T22),
      spl.createAssociatedTokenAccountIdempotentInstruction(this.payer.publicKey, vault, vaultOwner.publicKey, mint.publicKey, T22),
      spl.createMintToInstruction(mint.publicKey, vault, this.payer.publicKey, SUPPLY, [], T22),
    ], [this.payer, mint]);
    const config = Keypair.generate().publicKey;
    const cfg = Buffer.alloc(1136);
    Buffer.from([40, 220, 194, 251, 41, 199, 123, 253]).copy(cfg, 0);
    cfg.writeBigUInt64LE(threshold, 264);
    if (feeSchedule) { // DBC BaseFeeConfig at 104: cliff u64 · period_frequency u64 · reduction u64 · n_periods u16 · mode u8
      cfg.writeBigUInt64LE(feeSchedule.cliff, 104); cfg.writeBigUInt64LE(feeSchedule.frequency, 112);
      cfg.writeBigUInt64LE(feeSchedule.reduction, 120); cfg.writeUInt16LE(feeSchedule.periods, 128); cfg[130] = feeSchedule.mode ?? 0;
      cfg[234] = 1; // activation by timestamp
    }
    this.setAccount(config, DBC, cfg);
    const pool = Keypair.generate().publicKey;
    const pd = Buffer.alloc(424);
    Buffer.from([237, 219, 184, 23, 42, 189, 169, 35]).copy(pd, 0);
    config.toBuffer().copy(pd, 72);
    creator.publicKey.toBuffer().copy(pd, 104);
    mint.publicKey.toBuffer().copy(pd, 136);
    vault.toBuffer().copy(pd, 168);
    pd.writeBigUInt64LE(this.now().unix, 296); // activation point
    this.setAccount(pool, DBC, pd);
    const c = { mint: mint.publicKey, creator, vault, vaultOwner, pool, config, threshold };
    this.setPool(c, { sqrt: 1n << 64n, quoteReserve: 0n });
    return c;
  }
  setPool(c, { sqrt, quoteReserve }) {
    const a = this.account(c.pool);
    if (sqrt != null) { a.data.writeBigUInt64LE(sqrt & ((1n << 64n) - 1n), 280); a.data.writeBigUInt64LE(sqrt >> 64n, 288); }
    if (quoteReserve != null) a.data.writeBigUInt64LE(quoteReserve, 240);
    this.setAccount(c.pool, DBC, a.data, a.lamports);
  }
  writeScriptIx(c, script, offset, length, signer = c.creator.publicKey) {
    return new TransactionInstruction({ programId: ENGINE, keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: c.mint, isSigner: false, isWritable: false },
      { pubkey: c.pool, isSigner: false, isWritable: false },
      { pubkey: stackPda(c.mint), isSigner: false, isWritable: false },
      { pubkey: scriptPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: Buffer.from(writeScriptData(script, offset, length)) });
  }
  initStackIx(c, slots, { signer = c.creator.publicKey, script = null, parent = null, staged = false, gate = null } = {}) {
    const keys = [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: c.mint, isSigner: false, isWritable: false },
      { pubkey: c.pool, isSigner: false, isWritable: false },
      { pubkey: c.config, isSigner: false, isWritable: false },
      { pubkey: stackPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: metasPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: scriptPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];
    if (parent) keys.push({ pubkey: parent, isSigner: false, isWritable: false });
    if (gate) keys.push({ pubkey: gate, isSigner: false, isWritable: false });
    return new TransactionInstruction({ programId: ENGINE, keys, data: Buffer.from(initStackData(slots, { script, parent: !!parent, staged })) });
  }
  initStack(c, slots, opts) { return this.send([this.initStackIx(c, slots, opts)], [c.creator]); }
  /** set_mark: the creator sets `owner`'s mark (1 blocked, 2 pass). */
  setMarkIx(c, owner, flags, signer = c.creator.publicKey) {
    return new TransactionInstruction({ programId: ENGINE, keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: c.mint, isSigner: false, isWritable: false },
      { pubkey: stackPda(c.mint), isSigner: false, isWritable: false },
      { pubkey: markPda(c.mint, owner), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: Buffer.from(setMarkData(flags, owner.toBytes())) });
  }
  setMark(c, owner, flags, signer = c.creator) { return this.send([this.setMarkIx(c, owner, flags, signer.publicKey)], [signer]); }
  /** Another token's mint (SPL Token by default), as a Token Gate names; `fund(owner, raw)` puts gate tokens in the owner's ATA. */
  gateMint({ decimals = 5, program = SPL } = {}) {
    const mint = Keypair.generate();
    const space = program.equals(SPL) ? spl.MINT_SIZE : spl.getMintLen([]);
    this.must([
      SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: mint.publicKey, space, lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(space))), programId: program }),
      spl.createInitializeMintInstruction(mint.publicKey, decimals, this.payer.publicKey, null, program),
    ], [this.payer, mint]);
    const fund = (owner, amount) => {
      const ata = spl.getAssociatedTokenAddressSync(mint.publicKey, owner, true, program);
      this.must([
        spl.createAssociatedTokenAccountIdempotentInstruction(this.payer.publicKey, ata, owner, mint.publicKey, program),
        spl.createMintToInstruction(mint.publicKey, ata, this.payer.publicKey, BigInt(amount), [], program),
      ], [this.payer]);
      return ata;
    };
    return { mint: mint.publicKey, program, fund };
  }
  /** A holder: a keypair with an ATA for the coin (ImmutableOwner) and, optionally, a wallet record. */
  holder(c, { record = true, owner = null } = {}) {
    const k = owner ?? this.funded(5n);
    const ata = spl.getAssociatedTokenAddressSync(c.mint, k.publicKey, false, T22);
    const ixs = [spl.createAssociatedTokenAccountIdempotentInstruction(this.payer.publicKey, ata, k.publicKey, c.mint, T22)];
    if (record) ixs.push(this.openWalletIx(c, ata, this.payer.publicKey));
    this.must(ixs, [this.payer]);
    return { key: k, ata };
  }
  /** A plain (non-ATA) token account without ImmutableOwner. */
  plainAccount(c, owner) {
    const acct = Keypair.generate();
    const space = spl.getAccountLen([spl.ExtensionType.TransferHookAccount]);
    this.must([
      SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: acct.publicKey, space, lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(space))), programId: T22 }),
      spl.createInitializeAccount3Instruction(acct.publicKey, c.mint, owner, T22),
      this.openWalletIx(c, acct.publicKey, this.payer.publicKey),
    ], [this.payer, acct]);
    return acct.publicKey;
  }
  openWalletIx(c, ta, payer) {
    return new TransactionInstruction({
      programId: ENGINE,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: c.mint, isSigner: false, isWritable: false },
        { pubkey: ta, isSigner: false, isWritable: false },
        { pubkey: walletPda(c.mint, ta), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([IX.openWallet]),
    });
  }
  async transferIx(c, from, to, owner, amount) {
    return spl.createTransferCheckedWithTransferHookInstruction(this.conn, from, c.mint, to, owner, BigInt(amount), DECIMALS, [], 'confirmed', T22);
  }
  /** Curve buy: base vault → holder. */
  async buy(c, h, amount) { return this.send([await this.transferIx(c, c.vault, h.ata, c.vaultOwner.publicKey, amount)], [c.vaultOwner]); }
  /** Curve sell: holder → base vault. */
  async sell(c, h, amount) { return this.send([await this.transferIx(c, h.ata, c.vault, h.key.publicKey, amount)], [h.key]); }
  async sendTo(c, h, to, amount) { return this.send([await this.transferIx(c, h.ata, to.ata ?? to, h.key.publicKey, amount)], [h.key]); }
  balance(ta) { return this.account(ta).data.readBigUInt64LE(64); }
  /** Retire the hook as DBC does at graduation: the TransferHook extension stays, its program id becomes empty. */
  retireHook(c) {
    const a = this.account(c.mint);
    const at = a.data.indexOf(ENGINE.toBuffer());
    if (at < 0) throw new Error('hook program not found in mint');
    a.data.fill(0, at, at + 32);
    this.setAccount(c.mint, T22, a.data, a.lamports);
  }
  closeWalletIx(c, ta, recipient) {
    return new TransactionInstruction({ programId: ENGINE, keys: [
      { pubkey: walletPda(c.mint, ta), isSigner: false, isWritable: true },
      { pubkey: c.mint, isSigner: false, isWritable: false },
      { pubkey: recipient, isSigner: false, isWritable: true },
    ], data: Buffer.from([IX.closeWallet]) });
  }
  closeStackIx(c, recipient) {
    return new TransactionInstruction({ programId: ENGINE, keys: [
      { pubkey: stackPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: metasPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: scriptPda(c.mint), isSigner: false, isWritable: true },
      { pubkey: c.mint, isSigner: false, isWritable: false },
      { pubkey: recipient, isSigner: false, isWritable: true },
    ], data: Buffer.from([IX.closeStack]) });
  }
}

export const pct = (p) => SUPPLY * BigInt(Math.round(p * 10000)) / 1_000_000n; // p percent of supply
