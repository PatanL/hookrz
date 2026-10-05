// Local fork: LiteSVM loaded with the real mainnet Meteora DBC, DAMM v2, Token-2022, SPL Token and ATA
// binaries (checksummed snapshot), the DAMM v2 migration configs, and the hookrz engine. The clock is
// warp-able. Nothing here ever talks to a public network. Adapted from away-tek/away-ui src/server/fork.ts.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { LiteSVM, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { address, getTransactionDecoder, lamports, type Transaction as KitTx } from "@solana/kit";
import { PublicKey, Keypair, VersionedMessage } from "@solana/web3.js";
import bs58 from "bs58";
import { customCode, matches, type AccountFilter, type Chain, type ChainRead, type ProgramAccount, type Simulation, type TokenBalance, type TxRecord } from "./chain.js";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type ExtraProgram = { id: string; so: string };

export class ForkChain implements Chain {
  readonly mode = "fork" as const;
  readonly svm: LiteSVM;
  readonly fixture: any;
  readonly faucet = Keypair.generate();
  /** Advance the clock by one second (two slots) after every landed transaction, like a live cluster. */
  autoAdvance = true;
  /** Dev server: keep the chain clock at or after wall time, like a live cluster (tests warp instead). */
  wallClock = false;
  private records = new Map<string, TxRecord>();
  private order: string[] = [];
  private subs = new Set<(r: TxRecord) => void>();
  private readonly statePath: string | null;

  constructor(opts: { dir: string; programs?: ExtraProgram[]; statePath?: string | null; wallClock?: boolean }) {
    this.wallClock = !!opts.wallClock;
    const { dir } = opts;
    this.fixture = JSON.parse(readFileSync(`${dir}/snapshot.json`, "utf8"));
    this.statePath = opts.statePath ?? null;
    const resume = !!this.statePath && existsSync(this.statePath);
    this.svm = resume ? LiteSVM.loadFromFile(this.statePath!) : new LiteSVM().withNativeMints();
    if (!resume) {
      for (const p of this.fixture.programs) {
        const bytes = readFileSync(`${dir}/programs/${p.id}.so`);
        if (createHash("sha256").update(bytes).digest("hex") !== p.hash) throw new Error(`Fork binary checksum mismatch: ${p.id}`);
        this.svm.addProgram(address(p.id), bytes);
      }
      for (const a of this.fixture.accounts) {
        const data = Buffer.from(a.data, "base64");
        this.svm.setAccount({ address: address(a.address), lamports: lamports(BigInt(a.lamports)), data, space: BigInt(data.length), programAddress: address(a.owner), executable: a.executable });
      }
      const clock = this.svm.getClock();
      clock.slot = BigInt(this.fixture.slot);
      clock.unixTimestamp = BigInt(this.fixture.unix);
      this.svm.setClock(clock);
      if (!this.svm.getAccount(address("So11111111111111111111111111111111111111112")).exists) throw new Error("native mint missing on the fork");
    } else if (existsSync(`${this.statePath}.records.json`)) {
      for (const r of JSON.parse(readFileSync(`${this.statePath}.records.json`, "utf8")) as TxRecord[]) {
        this.records.set(r.signature, r);
        this.order.push(r.signature);
      }
    }
    // Our own programs are (re)loaded on every start so a rebuilt .so takes effect.
    for (const p of opts.programs ?? []) this.svm.addProgram(address(p.id), readFileSync(p.so));
    this.svm.withSigverify(true);
    // Accept any recent blockhash: a launch signs 2–3 transactions with one blockhash, and the fork rolls
    // the blockhash after every landed transaction (so repeated identical trades get fresh signatures).
    this.svm.withBlockhashCheck(false);
    this.svm.airdrop(address(this.faucet.publicKey.toBase58()), lamports(1_000_000_000_000n));
  }

  loadProgram(id: string, so: string) {
    this.svm.addProgram(address(id), readFileSync(so));
  }

  private persist() {
    if (!this.statePath) return;
    mkdirSync(dirname(this.statePath), { recursive: true });
    this.svm.saveToFile(this.statePath);
    writeFileSync(`${this.statePath}.records.json`, JSON.stringify(this.order.map((s) => this.records.get(s))));
  }

  /** Move the chain clock forward (seconds, plus 2 slots per second). */
  warp(seconds: number) {
    const c = this.svm.getClock();
    c.unixTimestamp += BigInt(Math.floor(seconds));
    c.slot += BigInt(Math.max(1, Math.floor(seconds * 2)));
    this.svm.setClock(c);
    this.svm.expireBlockhash();
  }
  /** Next slot, same second (to test per-slot rules). */
  nextSlot(n = 1) {
    const c = this.svm.getClock();
    c.slot += BigInt(n);
    this.svm.setClock(c);
    this.svm.expireBlockhash();
  }
  clock() {
    const c = this.svm.getClock();
    return { slot: Number(c.slot), unix: Number(c.unixTimestamp) };
  }

  private sync() {
    if (!this.wallClock) return;
    const behind = Math.floor(Date.now() / 1000) - Number(this.svm.getClock().unixTimestamp);
    if (behind > 0) this.warp(behind);
  }
  async read(keys: PublicKey[]): Promise<ChainRead> {
    this.sync();
    const c = this.svm.getClock();
    const accounts = keys.map((k) => {
      const a = this.svm.getAccount(address(k.toBase58()));
      return a.exists
        ? { owner: new PublicKey(a.programAddress), data: Buffer.from(a.data), executable: a.executable, lamports: Number(a.lamports), rentEpoch: 0 }
        : null;
    });
    return { slot: Number(c.slot), unix: c.unixTimestamp, accounts };
  }
  async programAccounts(program: PublicKey, filters: AccountFilter[]): Promise<ProgramAccount[]> {
    this.sync();
    return this.svm.getProgramAccounts(address(program.toBase58()))
      .filter((a) => matches(a.data as Uint8Array, filters))
      .map((a) => ({ pubkey: new PublicKey(a.address), account: { owner: new PublicKey(a.programAddress), data: Buffer.from(a.data), executable: a.executable, lamports: Number(a.lamports), rentEpoch: 0 } }));
  }
  async rent(bytes: number) {
    return Number(this.svm.minimumBalanceForRentExemption(BigInt(bytes)));
  }
  async blockhash() {
    return { blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: Number(this.svm.getClock().slot) + 150 };
  }
  async simulate(bytes: Uint8Array): Promise<Simulation> {
    const r = this.svm.simulateTransaction(getTransactionDecoder().decode(bytes));
    const m = r.meta();
    return { error: r instanceof FailedTransactionMetadata ? shortErr(r.toString()) : null, logs: m.logs(), units: Number(m.computeUnitsConsumed()) };
  }

  private ixsOf(tx: KitTx, keys: string[]) {
    try {
      const m = VersionedMessage.deserialize(tx.messageBytes as unknown as Uint8Array);
      return m.compiledInstructions.map((i) => ({ program: keys[i.programIdIndex], accounts: i.accountKeyIndexes.map((k) => keys[k]), data: Buffer.from(i.data).toString("base64") }));
    } catch {
      return [];
    }
  }
  private keysOf(tx: KitTx) {
    // Static account keys of the compiled message (legacy or v0 without lookups resolved).
    const msg = tx.messageBytes as unknown as Uint8Array;
    let o = 0;
    if (msg[0] & 0x80) o = 1; // versioned prefix
    const numSigners = msg[o];
    o += 3;
    const [n, w] = shortvec(msg, o);
    o += w;
    const keys: string[] = [];
    for (let i = 0; i < n; i++) keys.push(bs58.encode(msg.subarray(o + i * 32, o + i * 32 + 32)));
    return { keys, signers: keys.slice(0, numSigners) };
  }
  private balances(keys: string[]): TokenBalance[] {
    const out: TokenBalance[] = [];
    for (const k of keys) {
      const a = this.svm.getAccount(address(k));
      if (!a.exists || (a.programAddress !== TOKEN && a.programAddress !== TOKEN22)) continue;
      const d = Buffer.from(a.data);
      if (!(d.length === 165 || (d.length > 165 && d[165] === 2))) continue;
      out.push({ account: k, mint: new PublicKey(d.subarray(0, 32)).toBase58(), owner: new PublicKey(d.subarray(32, 64)).toBase58(), raw: d.readBigUInt64LE(64).toString() });
    }
    return out;
  }

  async send(bytes: Uint8Array): Promise<TxRecord> {
    this.sync();
    const tx = getTransactionDecoder().decode(bytes);
    const { keys, signers } = this.keysOf(tx);
    const pre = this.balances(keys);
    const clock = this.svm.getClock();
    const sig = Object.values(tx.signatures)[0];
    const signature = sig ? bs58.encode(sig as Uint8Array) : "";
    const r = this.svm.sendTransaction(tx);
    const failed = r instanceof FailedTransactionMetadata;
    const meta: TransactionMetadata = failed ? (r as FailedTransactionMetadata).meta() : (r as TransactionMetadata);
    const error = failed ? shortErr((r as FailedTransactionMetadata).toString()) : null;
    const logs = meta.logs();
    const rec: TxRecord = {
      signature,
      slot: Number(clock.slot),
      unix: Number(clock.unixTimestamp),
      ok: !failed,
      error,
      code: failed ? (customCode(error) ?? customCode(logs.join("\n"))) : null,
      logs,
      accounts: keys,
      signers,
      pre,
      post: failed ? pre : this.balances(keys),
      units: Number(meta.computeUnitsConsumed()),
      ixs: this.ixsOf(tx, keys),
    };
    if (!this.records.has(signature)) this.order.push(signature);
    this.records.set(signature, rec);
    if (!failed && this.autoAdvance) this.warp(1);
    else this.svm.expireBlockhash();
    this.persist();
    for (const f of this.subs) f(rec);
    return rec;
  }
  onTx(f: (r: TxRecord) => void) {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  }
  async record(signature: string) {
    return this.records.get(signature) ?? null;
  }
  allRecords() {
    return this.order.map((s) => this.records.get(s)!);
  }

  /** Valueless fork-only SOL for a test wallet. */
  fund(owner: PublicKey, sol = 100) {
    this.svm.airdrop(address(owner.toBase58()), lamports(BigInt(Math.round(sol * 1e9))));
  }
}

/** `FailedTransactionMetadata { err: InstructionError(7, Custom(6004)), meta: … }` → `InstructionError(7, Custom(6004))`. */
function shortErr(s: string) {
  return /err: (.*?), meta:/s.exec(s)?.[1] ?? s.slice(0, 200);
}

function shortvec(b: Uint8Array, o: number): [number, number] {
  let len = 0, size = 0;
  for (;;) {
    const e = b[o + size];
    len |= (e & 0x7f) << (size * 7);
    size++;
    if ((e & 0x80) === 0) break;
  }
  return [len, size];
}

