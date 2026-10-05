// The hookrz backend: launch and trade builders, rule-aware quotes, the indexer and the read API.
// Holds no user keys. The platform key only claims the partner fee share and cranks migrations.
import { EventEmitter } from "node:events";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { deriveDbcPoolAuthority, DYNAMIC_BONDING_CURVE_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";
import bs58 from "bs58";
import { budget, normalize, evaluate } from "../../web/src/engine/engine.js";
import { byId, BLOCKS, ERR_NAMES } from "../../web/src/data/blocks.js";
import { simulate as runSim } from "../../web/src/engine/sim.js";
import { LAUNCH_IXS, FEES } from "../../web/src/api/contract.js";
import { buildLaunch } from "./launch.js";
import { snapshot, rawQuote, buildSwap, buildMigration, tokenBalance, sqrtToPrice, AppError, ensure, type Snapshot } from "./market.js";
import { SUPPLY, curveConfig, firstBuyRaw } from "./curve.js";
import { buildCtx, judge, marketState, walletState, hookscript } from "./rules.js";
import type { Chain, TxRecord } from "./chain.js";
import type { HookProgram } from "./hook.js";
import type { Store, CoinRow, TradeRow } from "./store.js";
import { Keeper } from "./keeper.js";

const LAMPORTS = 1e9, RAW = 1e6;
const SWAP2_HOOK = "swap2WithTransferHook";
const PENDING_TTL = 15 * 60_000;

export type ServiceOpts = { chain: Chain; store: Store; hook: HookProgram | null; platform: Keypair; solUsd?: number; thresholdSol?: number; publicBase?: string; autoMigrate?: boolean };
type Pending = { keys: { mint: Keypair; config: Keypair }; mint: string; ticker: string; name: string; desc: string; image: string | null; links: any; creator: string; pool: string; config: string; baseVault: string; hookProgram: string | null; stack: any[]; script: any | null; parent: string | null; expires: number; signatures: string[] };

export class Hookrz {
  readonly chain: Chain;
  readonly store: Store;
  readonly hook: HookProgram | null;
  readonly platform: Keypair;
  readonly events = new EventEmitter();
  readonly keeper: Keeper;
  solUsd: number;
  thresholdSol: number;
  publicBase: string;
  autoMigrate: boolean;
  private pending = new Map<string, Pending>();
  private drafts = new Map<string, any>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(o: ServiceOpts) {
    this.chain = o.chain;
    this.store = o.store;
    this.hook = o.hook;
    this.platform = o.platform;
    this.solUsd = o.solUsd ?? 150;
    this.thresholdSol = o.thresholdSol ?? 85;
    this.publicBase = o.publicBase ?? "http://127.0.0.1:8830";
    this.autoMigrate = o.autoMigrate ?? true;
    this.events.setMaxListeners(1000);
    this.keeper = new Keeper(this);
    this.chain.onTx((r) => void this.enqueue(() => this.index(r)));
  }
  /** Index transactions one at a time, in arrival order. */
  private enqueue<T>(f: () => Promise<T>): Promise<T> {
    const p = this.queue.then(f, f);
    this.queue = p.catch((e) => console.error("indexer:", e));
    return p;
  }
  idle() {
    return this.queue;
  }

  // ───────────────────────────── launch ─────────────────────────────
  async prepareLaunch(body: any) {
    const meta = body.meta ?? {};
    const stack = normalize(body.stack ?? []);
    const ticker = String(meta.ticker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    ensure(ticker, "Ticker required");
    const name = String(meta.name ?? "").trim().slice(0, 32);
    ensure(name, "Name required");
    const taken = this.store.findCoin(ticker);
    ensure(!taken, `$${ticker} is taken`, "TICKER_TAKEN");
    const b = budget(stack);
    const creatorKey = body.creator ? new PublicKey(body.creator) : null;
    const buySol = Math.max(0, Number(meta.creatorBuySol ?? body.creatorBuySol ?? 0) || 0);
    const parent = body.parent ? this.store.findCoin(String(body.parent)) : null;
    // Hookscript for a Custom block: { source } (compiled here) or { source, bytecode(base64) }.
    let script = body.script ?? null;
    if (stack.some((x: any) => x.id === "custom")) {
      // the site sends the source in the Custom slot's params (and as body.script); the server compiles it itself
      const slotSrc = stack.find((x: any) => x.id === "custom")?.params?.script;
      if (!script?.source && slotSrc) script = { source: String(slotSrc) };
      if (script?.source) script = { source: String(script.source) }; // never trust client bytecode: recompile
      // The site sends only the Custom block's English prompt: draft it (the drafter compiles and fuzzes every draft).
      const prompt = stack.find((x: any) => x.id === "custom")?.params?.prompt;
      if (!script && prompt) {
        const d = await this.draft(String(prompt));
        if (d.ok === false) throw new AppError("SCRIPT_DRAFT_FAILED", `Couldn't draft a safe Hookscript for "${prompt}": ${d.errors?.[0]?.message ?? d.warnings?.[0] ?? "the draft failed its checks"}`, 422, d);
        const hex = d.bytecodeHex ?? null;
        script = { source: d.script ?? d.source, bytecode: hex ? Buffer.from(hex, "hex").toString("base64") : (d.bytecode ?? null), abi: d.abi ?? null, fuzz: d.fuzz ?? null, honeypot: d.honeypot ?? null, prompt };
      }
      if (!script?.bytecode && script?.source) {
        const lib = await hookscript();
        if (!lib?.compile) throw new AppError("UNAVAILABLE", "The Hookscript compiler is not available yet", 503);
        const out = lib.compile(String(script.source));
        if (out && out.ok === false) throw new AppError("SCRIPT_INVALID", `Hookscript doesn't compile: ${out.errors.map((e: any) => `${e.line}:${e.col} ${e.message}`).join("; ")}`, 400, out.errors);
        const code: Uint8Array = out instanceof Uint8Array ? out : (out.bytes ?? out.code ?? out.bytecode);
        const verdict = this.scriptCheck(lib, String(script.source), code);
        if (!verdict.ok) throw new AppError("SCRIPT_UNSAFE", verdict.message, 422, verdict.report);
        script = { source: String(script.source), bytecode: Buffer.from(code).toString("base64"), abi: out.abi ?? null, cu: out.cu ?? null, fuzz: verdict.report?.fuzz ?? null, honeypot: verdict.report?.honeypot ?? null };
      }
      ensure(script?.bytecode, "A Custom block needs its Hookscript: pass script.source (or draft one at /v1/hookscript/draft)", "SCRIPT_REQUIRED");
    } else script = null;
    const preview = {
      instructions: LAUNCH_IXS.filter((_x: any, i: number) => b.hasHook || i !== 3).map((x: any) => ({ ...x })),
      txLimit: 1232, rentSol: b.rentSol, launchCostSol: FEES.launchCostSol, fees: FEES, signers: ["creator", "mint keypair"],
    };
    if (!b.hasHook) preview.instructions[0] = { ...preview.instructions[0], note: "Extensions: MetadataPointer + TokenMetadata. No transfer hook: this stack has no Hook blocks." };
    // The creator's buy runs through the stack too (Snipe Shield and Anti-Bundle exempt it; caps don't).
    let creatorBuy: any = null;
    if (buySol > 0 && b.hasHook) {
      const { params, features } = curveConfig(stack, { thresholdSol: Number(body.curve?.thresholdSol ?? this.thresholdSol) });
      const fee = features.feeScheduler?.startBps ?? 100;
      const verdictAt = (sol: number) => {
        const tokens = Number(firstBuyRaw(params, BigInt(Math.round(sol * LAMPORTS)), fee)) / RAW;
        return { tokens, v: evaluate(stack, { kind: "buy", amount: tokens, supply: SUPPLY, t: 0, slot: 0, hour: new Date().getUTCHours(), progress: 0, priceAfter: 0, windowOpenPrice: 0, srcBefore: 0, dstAfter: tokens, isCreatorSrc: false, isCreator: true, w: { lots: [], lastBuySlot: null, lastSellT: null, firstT: null }, slotBuys: 0, hourSold: 0, hasPass: true, gateBal: 0, blocked: false }) };
      };
      const at = verdictAt(buySol);
      let maxSol = buySol;
      if (!at.v.ok) {
        let lo = 0, hi = buySol;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (verdictAt(m).v.ok) lo = m; else hi = m; }
        maxSol = Math.floor(lo * 1e4) / 1e4;
      }
      creatorBuy = { sol: buySol, tokens: at.tokens, ok: at.v.ok, refusedBy: at.v.refusedBy ?? null, code: at.v.code ?? null, message: at.v.message ?? null, maxSol, feePct: fee / 100 };
      if (!at.v.ok) throw new AppError("CREATOR_BUY_REFUSED", `Your first buy would be refused on chain (${at.v.code} · ${at.v.refusedBy}): ${at.v.message}. The largest first buy this stack allows is ${maxSol} SOL.`, 409, creatorBuy);
    }
    // Without a wallet yet, build against a placeholder creator so the site can show sizes and steps. The
    // mint is kept: a later prepare for the same launch (with the wallet) reuses it, so the address is stable.
    const creator = creatorKey ?? Keypair.generate().publicKey;
    this.gcPending();
    const prior = body.mint ? this.pending.get(String(body.mint)) : undefined;
    const reuse = prior && (!prior.creator || prior.creator === creatorKey?.toBase58()) ? prior.keys : null;
    const built = await buildLaunch(this.chain, this.hook, {
      creator, platform: this.platform.publicKey, name, symbol: ticker, uri: (m) => `${this.publicBase}/v1/meta/${m}.json`,
      stack, creatorBuyLamports: BigInt(Math.round(buySol * LAMPORTS)), thresholdSol: Number(body.curve?.thresholdSol ?? this.thresholdSol),
      parentStack: parent && this.hook ? this.hook.stackPda(new PublicKey(parent.mint)) : null, parentAuthor: parent ? new PublicKey(parent.creator) : null,
      script: script?.bytecode ? Uint8Array.from(Buffer.from(script.bytecode, "base64")) : null,
      keys: reuse,
    });
    {
      this.pending.set(built.mint, {
        keys: built.keys, mint: built.mint, ticker, name, desc: String(meta.desc ?? ""), image: meta.image ?? null, links: meta.links ?? {}, creator: creatorKey?.toBase58() ?? "",
        pool: built.pool, config: built.config, baseVault: built.baseVault, hookProgram: built.hookProgram, stack, script, parent: parent?.ticker ?? null,
        expires: Date.now() + PENDING_TTL, signatures: [],
      });
    }
    return {
      ...preview,
      mint: built.mint,
      pool: built.pool,
      config: built.config,
      hookProgram: built.hookProgram,
      hooked: built.hooked,
      curve: built.features,
      creatorBuy,
      txBytes: Math.max(...built.transactions.map((t) => t.bytes)),
      transactions: creatorKey ? built.transactions : built.transactions.map(({ base64: _b, ...t }) => t),
      parent: parent?.ticker ?? null,
      instructions: preview.instructions,
      creator: creatorKey?.toBase58() ?? null,
    };
  }
  private gcPending() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expires < now) this.pending.delete(k);
  }

  /** The wallet sent the launch transactions itself (signatures), or hands us signed bytes to relay (signed). */
  async submitLaunch(body: any) {
    const p = body.prepared ?? body;
    const mint = String(p.mint ?? "");
    const pend = this.pending.get(mint);
    ensure(pend || this.store.getCoin(mint), "Unknown launch: prepare it again", "UNKNOWN_LAUNCH");
    const sigs: string[] = [];
    for (const b64 of p.signed ?? []) {
      const r = await this.sendTx(b64);
      if (!r.ok) throw new AppError("LAUNCH_FAILED", `Launch transaction failed: ${r.error}`, 400, { logs: r.logs.slice(-15) });
      sigs.push(r.signature);
    }
    sigs.push(...(p.signatures ?? []));
    for (const s of sigs) await this.waitFor(s);
    await this.idle();
    const coin = this.store.getCoin(mint);
    ensure(coin && coin.stage !== "pending", "The launch has not landed yet", "NOT_LANDED");
    return { ok: true, ticker: coin.ticker, mint, signature: coin.launch_sig ?? sigs.at(-1) ?? null, signatures: sigs };
  }

  // ───────────────────────────── transactions ─────────────────────────────
  async sendTx(b64: string): Promise<TxRecord> {
    const r = await this.chain.send(Buffer.from(b64, "base64"));
    await this.idle();
    return r;
  }
  async waitFor(sig: string, ms = 60_000) {
    const end = Date.now() + ms;
    for (;;) {
      const r = await this.chain.record(sig);
      if (r) return r;
      if (Date.now() > end) throw new AppError("TIMEOUT", `Transaction ${sig} not confirmed`, 504);
      await new Promise((f) => setTimeout(f, 800));
    }
  }

  // ───────────────────────────── quotes and trades ─────────────────────────────
  private coinOr404(key: string) {
    const c = this.store.findCoin(key);
    if (!c) throw new AppError("NOT_FOUND", `No coin ${key}`, 404);
    return c;
  }
  private async live(c: CoinRow) {
    return snapshot(this.chain, new PublicKey(c.pool));
  }

  /** Rule-aware quote. buy: amount in SOL; sell: amount in tokens. wallet: the trader's address (or a demo wallet ctx). */
  async quote(body: any) {
    const c = this.coinOr404(String(body.mint ?? body.ticker));
    const side = body.side === "sell" ? "sell" : "buy";
    const amount = Number(body.amount);
    ensure(amount > 0 && Number.isFinite(amount), "Amount must be positive");
    const owner = typeof body.wallet === "string" ? body.wallet : typeof body.owner === "string" ? body.owner : null;
    const s = await this.live(c);
    const ctxFor = await this.ctxBuilder(c, s, side, owner);
    const scriptFor = c.script?.bytecode ? await this.scriptBuilder(c, s, side, owner) : null;
    const at = (amt: number) => {
      const input = side === "buy" ? BigInt(Math.floor(amt * LAMPORTS)) : BigInt(Math.floor(amt * RAW));
      const q = rawQuote(this.chain, s, side, input);
      const tokens = side === "buy" ? Number(q.output) / RAW : amt;
      const tokensRaw = side === "buy" ? q.output : input;
      return { q, ctx: ctxFor(tokens, sqrtToPrice(q.nextSqrt)), script: scriptFor ? () => scriptFor(tokensRaw, q.nextSqrt, q.feeBps) : undefined };
    };
    const first = at(amount);
    const hooked = s.stage === "curve" && !!s.hookProgram;
    const v = hooked ? await judge(c, first.ctx, first.script) : { ok: true, verdicts: [] as any[] };
    let maxAllowed = amount;
    if (!v.ok) {
      let lo = 0, hi = amount;
      for (let i = 0; i < 32; i++) {
        const m = (lo + hi) / 2;
        const p = at(m);
        if ((await judge(c, p.ctx, p.script)).ok) lo = m;
        else hi = m;
      }
      maxAllowed = lo;
    }
    const out = side === "buy" ? Number(first.q.output) / RAW : Number(first.q.output) / LAMPORTS;
    return {
      ok: v.ok, out, price: s.price, priceUsd: s.price * this.solUsd, verdicts: v.verdicts, refusedBy: (v as any).refusedBy ?? null, code: (v as any).code ?? null,
      message: (v as any).message ?? null, maxAllowed, stage: s.stage, feeBps: first.q.feeBps, progress: s.progress, ctx: first.ctx,
      raw: { input: first.q.input.toString(), output: first.q.output.toString(), fee: first.q.fee.toString() },
    };
  }

  private async ctxBuilder(c: CoinRow, s: Snapshot, side: "buy" | "sell", owner: string | null) {
    const ownerKey = owner ? new PublicKey(owner) : null;
    const bal = ownerKey ? await tokenBalance(this.chain, new PublicKey(c.mint), ownerKey) : null;
    const rec = ownerKey && this.hook && bal ? await this.hook.readWallet(this.chain, new PublicKey(c.mint), bal.ata).catch(() => null) : null;
    const w = walletState(this.store, c, owner, rec);
    const market = marketState(this.store, c, { slot: s.slot, unix: s.unix, price: s.price });
    const balance = bal ? Number(bal.raw) / RAW : 0;
    const vest = normalize(c.stack).some((x: any) => x.id === "creator-vest") && this.hook?.kind === "hookrz";
    const stackAcc = vest ? await this.hook!.readStack(this.chain, new PublicKey(c.mint)).catch(() => null) : null;
    const creatorBase = stackAcc ? Number(stackAcc.creatorBase) / RAW : undefined;
    return (tokens: number, priceAfter: number) =>
      buildCtx({ kind: side, tokens, coin: c, owner, now: { slot: s.slot, unix: s.unix }, progress: s.progress, priceAfter, market, balance, wallet: w, creatorBase });
  }

  /** Script ctx inputs for this trader and side (SPEC §8), from the Stack, Script and Wallet records on chain. */
  private async scriptBuilder(c: CoinRow, s: Snapshot, side: "buy" | "sell", owner: string | null) {
    const hook = this.hook;
    if (!hook || hook.kind !== "hookrz") return null;
    const mint = new PublicKey(c.mint);
    const stack = await hook.readStack(this.chain, mint);
    const scriptKey = (hook as any).scriptPda(mint) as PublicKey;
    const { accounts: [sa] } = await this.chain.read([scriptKey]);
    if (!stack || !sa) return null;
    const globals = Uint8Array.from(Buffer.from(sa.data).subarray(16, 272));
    const pool = { owner: deriveDbcPoolAuthority().toBase58(), isPool: true, balanceRaw: 0n, rec: null };
    const me = owner ? await tokenBalance(this.chain, mint, new PublicKey(owner)) : null;
    const meRec = me && owner ? await hook.readWallet(this.chain, mint, me.ata).catch(() => null) : null;
    const trader = { owner: owner ?? PublicKey.default.toBase58(), isPool: false, balanceRaw: me?.raw ?? 0n, rec: meRec };
    return async (amountRaw: bigint, nextSqrt: bigint, feeBps: number) => ({
      kind: side, amountRaw, slot: s.slot, now: s.unix, launchTs: stack.launchTs, launchSlot: stack.launchSlot, sqrtPrice: nextSqrt,
      progress: s.progress, quoteReserve: BigInt(Math.round(s.raisedSol * LAMPORTS)), feeBps, creator: stack.creator,
      sender: side === "buy" ? pool : trader, receiver: side === "buy" ? trader : pool, globals,
    });
  }

  /** Unsigned swap for the wallet to sign (POST /v1/trade/prepare). */
  async prepareTrade(body: any) {
    const c = this.coinOr404(String(body.mint ?? body.ticker));
    const side = body.side === "sell" ? "sell" : "buy";
    ensure(typeof body.wallet === "string", "wallet (address) required");
    const owner = new PublicKey(body.wallet);
    const amount = Number(body.amount);
    ensure(amount > 0, "Amount must be positive");
    const slippageBps = Math.max(1, Math.min(5000, Number(body.slippageBps ?? 300)));
    const s = await this.live(c);
    const input = side === "buy" ? BigInt(Math.floor(amount * LAMPORTS)) : BigInt(Math.floor(amount * RAW));
    const q = rawQuote(this.chain, s, side, input);
    const minOut = body.minOut != null ? BigInt(body.minOut) : (q.output * BigInt(10_000 - slippageBps)) / 10_000n;
    const needsRecord = !!this.hook && s.stage === "curve" && this.hook.needsWalletRecord(c.stack);
    const { tx, opened } = await buildSwap(this.chain, this.hook, s, owner, side, input, minOut > 0n ? minOut : 1n, { needsRecord });
    const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return {
      mint: c.mint, ticker: c.ticker, side, amount, stage: s.stage, route: s.stage === "graduated" ? "Meteora DAMM v2" : s.hookProgram ? "Meteora DBC (TransferHook)" : "Meteora DBC",
      transaction: bytes.toString("base64"), bytes: bytes.length, expectedOut: q.output.toString(), minOut: minOut.toString(), openedRecords: opened,
      hookAccounts: s.hookProgram && this.hook ? (await budget(c.stack)).accounts : [],
    };
  }

  // ───────────────────────────── indexer ─────────────────────────────
  async index(r: TxRecord) {
    const keys = new Set(r.accounts);
    // a launch we prepared lands: the pool now exists
    for (const [mint, p] of this.pending) {
      if (!keys.has(mint) && !keys.has(p.pool) && !keys.has(p.config)) continue;
      p.signatures.push(r.signature);
      if (!r.ok) continue;
      const { accounts: [pool] } = await this.chain.read([new PublicKey(p.pool)]);
      if (!pool) continue;
      const stackAcc = this.hook && p.hookProgram ? await this.hook.readStack(this.chain, new PublicKey(mint)).catch(() => null) : null;
      if (p.hookProgram && this.hook?.kind === "hookrz" && !stackAcc) continue; // pool without its stack: not armed yet
      this.pending.delete(mint);
      const s = await snapshot(this.chain, new PublicKey(p.pool));
      this.store.upsertCoin({
        mint, ticker: p.ticker, name: p.name, desc: p.desc, image: p.image, links: p.links, creator: p.creator, pool: p.pool, config: p.config, base_vault: p.baseVault,
        hook_program: p.hookProgram, stack: p.stack, script: p.script, parent: p.parent, launch_sig: r.signature,
        launch_slot: stackAcc?.launchSlot || r.slot, launch_ts: stackAcc?.launchTs || r.unix, created_at: Date.now(),
        stage: s.stage, price: s.price, progress: s.progress, raised_sol: s.raisedSol, threshold_sol: s.thresholdSol,
      });
      this.emit(mint, { type: "launch", mint, ticker: p.ticker, sig: r.signature, at: Date.now() });
    }
    for (const c of this.store.coins()) {
      if (!keys.has(c.mint)) continue;
      await this.indexTrade(c, r);
    }
  }

  private async indexTrade(c: CoinRow, r: TxRecord) {
    if (r.signature === c.launch_sig && r.ok) {
      // the creator's first buy can ride in the launch tx: fall through to balance diffing
    }
    const s = await snapshot(this.chain, new PublicKey(c.pool)).catch(() => null);
    const vaults = new Set([c.base_vault, s?.ammState?.tokenAVault?.toBase58()].filter(Boolean) as string[]);
    const base = (list: typeof r.pre) => list.filter((b) => b.mint === c.mint);
    const pre = new Map(base(r.pre).map((b) => [b.account, b]));
    const post = new Map(base(r.post).map((b) => [b.account, b]));
    // The launch transaction creates the base vault holding the whole supply: its "before" is the full supply.
    const before = (acct: string) => pre.get(acct)?.raw ?? (acct === c.base_vault && post.has(acct) ? String(SUPPLY * RAW) : "0");
    const delta = (acct: string) => BigInt(post.get(acct)?.raw ?? before(acct)) - BigInt(before(acct));
    const quoteDelta = () => {
      const qv = [s?.quoteVault?.toBase58(), s?.ammState?.tokenBVault?.toBase58()].filter(Boolean) as string[];
      let d = 0n;
      for (const b of r.post) if (qv.includes(b.account)) d += BigInt(b.raw) - BigInt(r.pre.find((x) => x.account === b.account)?.raw ?? "0");
      return d;
    };
    const t = r.unix - c.launch_ts;
    const priceBefore = c.price;
    const priceAfter = s?.price ?? c.price;
    const hookrz = c.hook_program && this.hook?.kind === "hookrz" && c.hook_program === this.hook.id.toBase58();
    const verdictsFor = (refusedBy: string | null) => {
      const hooks = normalize(c.stack).filter((x: any) => byId[x.id]?.enforcedBy === "hook" && byId[x.id]?.check);
      const out: { id: string; ok: boolean }[] = [];
      for (const h of hooks) {
        out.push({ id: h.id, ok: h.id !== refusedBy });
        if (h.id === refusedBy) break;
      }
      return out;
    };
    const rows: TradeRow[] = [];
    if (r.ok) {
      const vaultDelta = [...vaults].reduce((a, v) => a + delta(v), 0n);
      const holders = [...new Set([...pre.keys(), ...post.keys()])].filter((a) => !vaults.has(a));
      if (vaultDelta < 0n) {
        const to = holders.find((a) => delta(a) > 0n);
        const b = to ? post.get(to)! : null;
        rows.push(this.row(r, c, { kind: "buy", wallet: b?.owner ?? r.signers[0], tokens: Number(-vaultDelta) / RAW, sol: Number(quoteDelta()) / LAMPORTS, t, priceBefore, priceAfter, verdicts: verdictsFor(null) }));
      } else if (vaultDelta > 0n) {
        const from = holders.find((a) => delta(a) < 0n);
        const b = from ? (pre.get(from) ?? post.get(from))! : null;
        rows.push(this.row(r, c, { kind: "sell", wallet: b?.owner ?? r.signers[0], tokens: Number(vaultDelta) / RAW, sol: Number(-quoteDelta()) / LAMPORTS, t, priceBefore, priceAfter, verdicts: verdictsFor(null) }));
      } else {
        const from = holders.find((a) => delta(a) < 0n), to = holders.find((a) => delta(a) > 0n);
        if (from && to) rows.push(this.row(r, c, { kind: "send", wallet: (pre.get(from) ?? post.get(from))!.owner, dest: post.get(to)!.owner, tokens: Number(delta(to)) / RAW, sol: 0, t, priceBefore, priceAfter, verdicts: verdictsFor(null) }));
      }
      for (const [acct, b] of post) if (!vaults.has(acct)) this.store.setHolder(c.mint, acct, b.owner, b.raw);
    } else if (r.code != null) {
      // A refusal: decode the intent from the DBC swap instruction (input/output token accounts, amount_0).
      const sw = r.ixs.find((i) => i.program === DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58());
      let kind: "buy" | "sell" | "send" = "send", tokens = 0, sol = 0, wallet = r.signers[0];
      if (sw) {
        const data = Buffer.from(sw.data, "base64");
        const amount0 = data.length >= 16 ? data.readBigUInt64LE(8) : 0n;
        const input = sw.accounts[3];
        const payerAta = getAssociatedTokenAddressSync(new PublicKey(c.mint), new PublicKey(wallet), true, TOKEN_2022_PROGRAM_ID).toBase58();
        kind = input === payerAta ? "sell" : "buy";
        if (kind === "buy") sol = Number(amount0) / LAMPORTS;
        else tokens = Number(amount0) / RAW;
      }
      const { by, msg } = this.explain(c, r, !!hookrz);
      rows.push(this.row(r, c, { kind, wallet, tokens, sol, t, priceBefore, priceAfter: priceBefore, ok: false, code: r.code, by, msg, verdicts: by ? verdictsFor(by) : null }));
    }
    for (const row of rows) {
      this.store.addTrade(row);
      this.emit(c.mint, this.tradeEvent(c, row));
    }
    if (s) {
      const graduatedNow = s.stage !== c.stage;
      this.store.upsertCoin({ mint: c.mint, stage: s.stage, price: s.price, progress: s.progress, raised_sol: s.raisedSol, threshold_sol: s.thresholdSol, amm_pool: s.stage === "graduated" ? s.ammId.toBase58() : c.amm_pool });
      if (graduatedNow) this.emit(c.mint, { type: "stage", mint: c.mint, stage: s.stage, at: Date.now() });
      if (s.stage === "graduating" && this.autoMigrate) setTimeout(() => void this.keeper.migrate(c.mint).catch((e) => console.error("migrate:", e.message)), 0);
    }
  }

  private row(r: TxRecord, c: CoinRow, x: { kind: "buy" | "sell" | "send"; wallet: string; dest?: string; tokens: number; sol: number; t: number; priceBefore: number; priceAfter: number; ok?: boolean; code?: number | null; by?: string | null; msg?: string | null; verdicts: any[] | null }): TradeRow {
    return { sig: r.signature, mint: c.mint, wallet: x.wallet, kind: x.kind, tokens: x.tokens, sol: x.sol, ok: x.ok ?? true, code: x.code ?? null, by: x.by ?? null, msg: x.msg ?? null, verdicts: x.verdicts, slot: r.slot, ts: r.unix, t: x.t, price_before: x.priceBefore, price_after: x.priceAfter, units: r.units, dest: x.dest ?? null };
  }

  /** Which block refused, from the custom error code (and the engine's log line). */
  explain(c: CoinRow, r: TxRecord, hookrz: boolean) {
    const code = r.code;
    const engineLog = r.logs.filter((l) => l.startsWith("Program log:") && !/Instruction:/.test(l)).map((l) => l.slice(13)).find((l) => /refus|limit|window|cap|closed|cooldown|settl|breaker|custom|wallet/i.test(l)) ?? null;
    if (!hookrz) return { by: null, msg: engineLog ?? `Refused by the transfer hook (${code})` };
    const block = BLOCKS.find((b: any) => b.code === code);
    if (code === 6128) {
      const hs = r.logs.find((l) => l.startsWith("Program log: Hookscript"))?.slice(13).replace(/^Hookscript:\s*/, "");
      return { by: "custom", msg: hs ?? engineLog ?? "Refused by the coin's custom rule" };
    }
    if (block) {
      const slot = normalize(c.stack).find((s: any) => s.id === block.id);
      return { by: block.id, msg: block.error?.(slot?.params ?? {}, {}) ?? engineLog };
    }
    return { by: null, msg: code != null ? `${code} · ${ERR_NAMES[code] ?? "Custom"}${engineLog ? `: ${engineLog}` : ""}` : engineLog };
  }

  private tradeEvent(c: CoinRow, t: TradeRow) {
    return { type: "trade", mint: c.mint, ticker: c.ticker, t: t.t, kind: t.kind, amount: t.tokens, sol: t.sol, ok: t.ok, by: t.by, code: t.code, msg: t.msg, verdicts: t.verdicts ?? [], wallet: t.wallet, sig: t.sig, at: t.ts * 1000, slot: t.slot };
  }
  private emit(mint: string, e: any) {
    this.events.emit("event", { mint, ...e });
  }

  // ───────────────────────────── read API (shapes match web/src/api/client.js demo mode) ─────────────────────────────
  shapeCoin(c: CoinRow, all?: CoinRow[]) {
    const now = Math.floor(Date.now() / 1000);
    const st = this.store.stats(c.mint, now - 86400);
    const holders = this.store.holders(c.mint).length;
    const list = all ?? this.store.coins();
    const mcapUsd = c.price * SUPPLY * this.solUsd;
    const change24 = st.price24 ? (c.price / st.price24 - 1) * 100 : 0;
    const stack = normalize(c.stack);
    return {
      ticker: c.ticker, name: c.name, desc: c.desc, image: c.image, links: c.links, creator: c.creator, parent: c.parent, mint: c.mint, pool: c.pool,
      minutesAgo: Math.max(0, Math.round((Date.now() - c.created_at) / 60000)), progress: c.progress, graduated: c.stage === "graduated",
      stage: c.stage, ammPool: c.amm_pool, hookProgram: c.hook_program, raisedSol: c.raised_sol, thresholdSol: c.threshold_sol, priceSol: c.price,
      mcapUsd, vol24Usd: st.vol24Sol * this.solUsd, change24, holders, trades: st.trades, checked: st.trades, refused: st.refused,
      remixes: list.filter((x) => x.parent === c.ticker).length, royaltiesSol: 0,
      stack, creatorInfo: { handle: c.creator.slice(0, 4) + "…" + c.creator.slice(-4) }, phase: c.stage === "graduated" ? "graduated" : "curve",
      families: [...new Set(stack.map((x: any) => byId[x.id]?.family))], budget: budget(stack), script: c.script ? { source: c.script.source ?? null, hasBytecode: !!c.script.bytecode } : null,
      launchSig: c.launch_sig, launchTs: c.launch_ts,
    };
  }
  coins(q: any = {}) {
    const all = this.store.coins();
    let list = all.map((c) => this.shapeCoin(c, all));
    if (q.family) list = list.filter((c) => c.families.includes(q.family));
    if (q.phase) list = list.filter((c) => c.phase === q.phase);
    if (q.q) {
      const s = String(q.q).toLowerCase();
      list = list.filter((c) => (c.ticker + c.name + c.creator).toLowerCase().includes(s));
    }
    const key: Record<string, (c: any) => number> = { mcap: (c) => -c.mcapUsd, volume: (c) => -c.vol24Usd, new: (c) => c.minutesAgo, remixes: (c) => -c.remixes, change: (c) => -c.change24 };
    const k = key[q.sort] ?? key.mcap;
    return list.sort((a, b) => k(a) - k(b));
  }
  coin(key: string) {
    const c = this.store.findCoin(key);
    return c && c.stage !== "pending" ? this.shapeCoin(c) : null;
  }
  trades(key: string, limit = 40) {
    const c = this.coinOr404(key);
    return this.store.trades(c.mint, limit).map((t) => this.tradeEvent(c, t));
  }
  holders(key: string) {
    const c = this.coinOr404(key);
    const total = SUPPLY * RAW;
    return this.store.holders(c.mint).slice(0, 50).map((h) => ({ wallet: h.owner, account: h.account, raw: h.raw, share: Number(h.raw) / total, tier: null, isCreator: h.owner === c.creator }));
  }
  stacks() {
    const list = this.coins();
    const desc = (t: string): any[] => list.filter((c) => c.parent === t).flatMap((c) => [c, ...desc(c.ticker)]);
    return list.filter((c) => !c.parent).map((c) => ({ ...c, family: [c, ...desc(c.ticker)] }))
      .map((c) => ({ ...c, remixCount: c.family.length - 1, royaltiesSol: c.family.filter((x: any) => x.parent === c.ticker).reduce((a: number, x: any) => a + (x.vol24Usd / this.solUsd) * 0.01 * 0.1, 0) }))
      .sort((a, b) => b.remixCount - a.remixCount || b.royaltiesSol - a.royaltiesSol);
  }
  lineage(key: string) {
    const list = this.coins();
    const by = Object.fromEntries(list.map((c) => [c.ticker, c]));
    const start = this.store.findCoin(key);
    if (!start || !by[start.ticker]) return null;
    const node = (t: string): any => ({ coin: by[t], diff: diffStacks(by[by[t].parent ?? ""]?.stack ?? [], by[t].stack), children: list.filter((c) => c.parent === t).map((c) => node(c.ticker)) });
    let root = by[start.ticker];
    while (root.parent && by[root.parent]) root = by[root.parent];
    return node(root.ticker);
  }
  creator(handle: string) {
    const list = this.coins();
    const mine = list.filter((c) => c.creator === handle);
    const remixesOfMine = list.filter((c) => mine.some((m) => m.ticker === c.parent) && c.creator !== handle);
    return { handle, coins: mine, remixesOfMine, claimableSol: 0, royaltiesSol: 0 };
  }
  validate(stack: any[]) {
    return budget(stack ?? []);
  }
  simulate(stack: any[], seed = 7) {
    return { withStack: runSim(stack ?? [], { seed }), noRules: runSim([], { seed }) };
  }
  /** The launch gate for a hand-written or edited script: 10,000 fuzzed trades with zero errors, and the honeypot check. Cached per source. */
  private checks = new Map<string, { ok: boolean; message: string; report: any }>();
  scriptCheck(lib: any, source: string, code: Uint8Array) {
    const hit = this.checks.get(source);
    if (hit) return hit;
    if (!lib?.fuzz) return { ok: true, message: "", report: null }; // fuzzer not available: the drafter path still checks
    const { fuzz: z, honeypot: h } = lib.fuzz(code, { trades: 10_000, seed: 1, rust: false });
    const ok = !z.errors && !z.panics && h.ok;
    const message = ok ? "" : z.errors || z.panics
      ? `The Hookscript faulted on ${z.errors + z.panics} of ${z.trades} fuzzed trades`
      : `The Hookscript failed the honeypot check: ${h.notes?.[0] ?? "some holders could never sell"}. Add a time-based way out.`;
    const r = { ok, message, report: { fuzz: z, honeypot: h } };
    this.checks.set(source, r);
    if (this.checks.size > 500) this.checks.delete(this.checks.keys().next().value!);
    return r;
  }

  /** English → Hookscript (HOOKSCRIPT's drafter: Anthropic API when ANTHROPIC_API_KEY is set, else the offline heuristic;
   *  every draft is compiled, fuzzed and honeypot-checked before it comes back). HOOKSCRIPT_PROVIDER forces one. */
  async draft(prompt: string) {
    ensure(prompt.trim().length >= 4 && prompt.length <= 600, "Describe the rule in a sentence (4–600 characters)");
    const lib = await hookscript();
    const drafter = lib?.draft ?? lib?.draftHookscript;
    if (!drafter) throw new AppError("UNAVAILABLE", "The Hookscript drafter is not available yet", 503);
    // The site re-prepares a launch on every edit: drafts (compile + 10,000-trade fuzz) are cached per prompt.
    const key = prompt.trim();
    const hit = this.drafts.get(key);
    if (hit) return hit;
    const d = await drafter(prompt, { provider: (process.env.HOOKSCRIPT_PROVIDER as any) ?? "auto" });
    if (d?.ok) {
      this.drafts.set(key, d);
      if (this.drafts.size > 500) this.drafts.delete(this.drafts.keys().next().value!);
    }
    return d;
  }
  /** Token metadata JSON the mint's URI points at. */
  meta(mint: string) {
    const c = this.store.getCoin(mint) ?? [...this.pending.values()].find((p) => p.mint === mint) as any;
    if (!c) return null;
    return { name: c.name, symbol: c.ticker, description: c.desc, image: c.image && !String(c.image).startsWith("data:") ? c.image : `${this.publicBase}/v1/image/${mint}`, extensions: c.links ?? {} };
  }
}

export function diffStacks(a: any[], b: any[]) {
  const A = Object.fromEntries(normalize(a).map((s: any) => [s.id, s.params])), B = Object.fromEntries(normalize(b).map((s: any) => [s.id, s.params]));
  const added = Object.keys(B).filter((k) => !A[k]), removed = Object.keys(A).filter((k) => !B[k]);
  const tuned = Object.keys(B).filter((k) => A[k] && JSON.stringify(A[k]) !== JSON.stringify(B[k]));
  return { added, removed, tuned };
}

/** Sign helper for tests and the fork faucet wallet: sign a prepared base64 tx with local keypairs. */
export function signB64(b64: string, ...signers: Keypair[]) {
  const tx = Transaction.from(Buffer.from(b64, "base64"));
  tx.partialSign(...signers);
  return tx.serialize().toString("base64");
}
export { bs58, VersionedTransaction, deriveDbcPoolAuthority, buildMigration };
