// A real cluster (devnet) behind the Chain interface. The indexer feed polls getSignaturesForAddress for
// the engine program and every watched coin (failed transactions included, so refusals are indexed).
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, VersionedTransaction, type VersionedTransactionResponse } from "@solana/web3.js";
import { customCode, type Chain, type ChainRead, type Simulation, type TxRecord, type TokenBalance } from "./chain.js";

export class RpcChain implements Chain {
  readonly mode = "devnet" as const;
  readonly connection: Connection;
  private subs = new Set<(r: TxRecord) => void>();
  private seen = new Map<string, TxRecord>();
  private watched: PublicKey[];
  private timer: NodeJS.Timeout | null = null;
  private cursor = new Map<string, string>();

  constructor(url: string, watch: PublicKey[] = []) {
    this.connection = new Connection(url, { commitment: "confirmed" });
    this.watched = watch;
  }
  watch(k: PublicKey) {
    if (!this.watched.some((w) => w.equals(k))) this.watched.push(k);
  }
  start(ms = 4000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll().catch((e) => console.warn("rpc poll:", e.message)), ms);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private async poll() {
    for (const k of this.watched) {
      const until = this.cursor.get(k.toBase58());
      const list = await this.connection.getSignaturesForAddress(k, { until, limit: 50 }, "confirmed");
      if (!list.length) continue;
      this.cursor.set(k.toBase58(), list[0].signature);
      if (!until) continue; // first poll only sets the cursor
      for (const s of list.reverse()) if (!this.seen.has(s.signature)) await this.fetchAndEmit(s.signature);
    }
  }
  private async fetchAndEmit(sig: string) {
    const r = await this.record(sig);
    if (r) for (const f of this.subs) f(r);
    return r;
  }

  async read(keys: PublicKey[]): Promise<ChainRead> {
    const out: ChainRead = { slot: 0, unix: 0n, accounts: [] };
    for (let i = 0; i < Math.max(1, keys.length); i += 99) {
      const chunk = keys.slice(i, i + 99);
      const { context, value } = await this.connection.getMultipleAccountsInfoAndContext([...chunk, SYSVAR_CLOCK_PUBKEY]);
      const clock = value.pop()!;
      out.slot = context.slot;
      out.unix = clock.data.readBigInt64LE(32);
      out.accounts.push(...(value as any));
    }
    return out;
  }
  rent(bytes: number) {
    return this.connection.getMinimumBalanceForRentExemption(bytes);
  }
  blockhash() {
    return this.connection.getLatestBlockhash("confirmed");
  }
  async simulate(bytes: Uint8Array): Promise<Simulation> {
    const { value } = await this.connection.simulateTransaction(VersionedTransaction.deserialize(bytes), { sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" });
    return { error: value.err ? JSON.stringify(value.err) : null, logs: value.logs ?? [], units: value.unitsConsumed ?? null };
  }
  async send(bytes: Uint8Array): Promise<TxRecord> {
    // skipPreflight so a refusal lands as a failed transaction (and is indexed as one), like a wallet that sends anyway.
    const sig = await this.connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 3 });
    // Poll statuses over HTTP (no websocket subscription: public RPCs rate-limit those first).
    for (let i = 0; i < 60; i++) {
      await new Promise((f) => setTimeout(f, 1000));
      const { value: [st] } = await this.connection.getSignatureStatuses([sig]).catch(() => ({ value: [null] }) as any);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" || st.err)) {
        for (let k = 0; k < 10; k++) {
          const r = await this.fetchAndEmit(sig);
          if (r) return r;
          await new Promise((f) => setTimeout(f, 1000));
        }
      }
    }
    throw new Error(`transaction ${sig} not confirmed in 60 s`);
  }
  onTx(f: (r: TxRecord) => void) {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  }
  async record(sig: string): Promise<TxRecord | null> {
    if (this.seen.has(sig)) return this.seen.get(sig)!;
    const t = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!t) return null;
    const r = toRecord(sig, t);
    this.seen.set(sig, r);
    return r;
  }
}

function toRecord(sig: string, t: VersionedTransactionResponse): TxRecord {
  const msg = t.transaction.message;
  const keys = [...msg.staticAccountKeys.map((k) => k.toBase58()), ...(t.meta?.loadedAddresses?.writable ?? []).map((k) => k.toBase58()), ...(t.meta?.loadedAddresses?.readonly ?? []).map((k) => k.toBase58())];
  const bal = (list: any[] | null | undefined): TokenBalance[] => (list ?? []).map((b) => ({ account: keys[b.accountIndex], mint: b.mint, owner: b.owner ?? "", raw: b.uiTokenAmount.amount }));
  const err = t.meta?.err ? JSON.stringify(t.meta.err) : null;
  return {
    signature: sig, slot: t.slot, unix: t.blockTime ?? 0, ok: !t.meta?.err, error: err, code: customCode(err) ?? (err ? customCode((t.meta?.logMessages ?? []).join("\n")) : null),
    logs: t.meta?.logMessages ?? [], accounts: keys, signers: keys.slice(0, msg.header.numRequiredSignatures), pre: bal(t.meta?.preTokenBalances), post: bal(t.meta?.postTokenBalances),
    units: t.meta?.computeUnitsConsumed ?? null,
    ixs: msg.compiledInstructions.map((i) => ({ program: keys[i.programIdIndex], accounts: i.accountKeyIndexes.map((k) => keys[k]), data: Buffer.from(i.data).toString("base64") })),
  };
}
