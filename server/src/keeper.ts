// The public keeper. It cranks DBC → DAMM v2 migration, and enforces every Crank rule with the fee share the coin
// routed to the platform at launch (src/fees.ts). Each round (default every 60 s), per coin with keeper rules:
//   1. claim  — the pool's partner trading fee (DBC claimTradingFee2; per pool, so accounting is per coin), and after
//               graduation the platform's locked DAMM v2 position fees. The claimed amount is the vault's own delta.
//   2. split  — hookrz keeps exactly its 50 points; Sniper Fee → Burn's excess (everything above the 1% base fee in the
//               window) goes to burning; each rule's share accrues to its bucket; the rounding / pass-through part is
//               the creator's.
//   3. spend  — burns: buy the coin and burn it (Token-2022 burn) in one transaction; payouts: SOL transfers.
// Every claim, buy-and-burn and payout is its own public transaction, logged with its signature (GET /v1/keeper and
// GET /v1/coins/:mint/keeper). The platform key moves funds only as the coin's published rules say.
// Keeper failures never block trading: a round is best effort, refusals are simulated before sending and deferred,
// and nothing here runs inside the indexer queue.
import { PublicKey, Transaction, SystemProgram, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync, unpackMint } from "@solana/spl-token";
import { deriveDbcPoolAuthority, deriveDammV2PoolAuthority, derivePositionNftAccount, getBaseFeeHandler, TradeDirection, AccountsType } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import BN from "bn.js";
import { normalize } from "../../web/src/engine/engine.js";
import { snapshot, buildSwap, buildMigration, rawQuote, tokenBalance, envelope, sdk, DAMM_V2_PROGRAM_ID, type Snapshot } from "./market.js";
import { curveFeatures, INCINERATOR, BASE_DECIMALS } from "./curve.js";
import { feeRouting, allocateCurve, allocateLp, PROTOCOL_PCT, type Routing, type Share } from "./fees.js";
import { decodeWallet } from "./layout.js";
import type { HookrzEngine } from "./hook.js";
import { customCode, type TxRecord } from "./chain.js";
import type { CoinRow } from "./store.js";
import type { Hookrz } from "./service.js";

export type KeeperAction = { kind: string; mint: string; signature: string | null; detail: any; at: number };

type Bucket = { accrued: string; paid: string; burned: string; burnedRaw: string; owed: string; lastAt: number | null; note: string | null };
export type Ledger = {
  v: 1;
  mint: string;
  claimed: { curve: string; amm: string };
  /** hookrz's 50 points of curve fees, kept by the platform. */
  platform: string;
  /** Owed to the creator: its pass-through share (Sniper Fee → Burn coins) and rounding. */
  creator: Bucket;
  /** Per keeper rule (share key, or "sniper-fee-burn" for the excess). */
  rules: Record<string, Bucket>;
  sniper: { settled: boolean; excess: string };
  state: {
    graduatedAt: number | null;
    king: string | null;
    kingUntil: number | null;
    firstBuyers: string[] | null;
    /** Pot payouts: the last winner key paid (per share key). */
    pots: Record<string, string>;
    /** Script globals (hex) as last read; frozen once the hook is retired. */
    globals: string | null;
    /** Split payouts: owners whose bool var was true when the hook retired (records may be closed later). */
    split: Record<string, string[]> | null;
  };
  lastClaimAt: number | null;
  lastRound: number | null;
  lastError: string | null;
};

export type KeeperOptions = {
  /** Round interval; 0 = no background loop (tests call tick()). */
  tickMs: number;
  /** Claim when the pool holds at least this much for the platform, or hourly otherwise. */
  minClaim: bigint;
  /** Smallest buy-and-burn; smaller amounts wait in the bucket. */
  minBurn: bigint;
  /** Smallest transfer to one wallet; smaller amounts wait in the bucket. */
  minPayout: bigint;
  /** Holder Rewards, Diamond Tiers and Buyback & Burn run at most this often (seconds). */
  everyS: number;
  /** Sniper Fee → Burn: claim only after the fee window plus this grace, so every window trade is indexed. */
  sniperGraceS: number;
  /** Pro-rata payouts go to at most this many wallets per round (largest first). */
  maxRecipients: number;
  /** Buy-and-burn chunks per coin per round. */
  burnChunks: number;
};
const sol = (x: string | undefined, d: number) => BigInt(Math.round(Number(x ?? d) * 1e9));
export function keeperOptions(): KeeperOptions {
  const e = process.env;
  return {
    tickMs: Number(e.KEEPER_TICK_MS ?? 60_000),
    minClaim: sol(e.KEEPER_MIN_CLAIM_SOL, 0.01),
    minBurn: sol(e.KEEPER_MIN_BURN_SOL, 0.005),
    minPayout: sol(e.KEEPER_MIN_PAYOUT_SOL, 0.001),
    everyS: Number(e.KEEPER_EVERY_S ?? 3600),
    sniperGraceS: Number(e.KEEPER_SNIPER_GRACE_S ?? 60),
    maxRecipients: Number(e.KEEPER_MAX_RECIPIENTS ?? 200),
    burnChunks: Number(e.KEEPER_BURN_CHUNKS ?? 4),
  };
}

const U64_MAX = new BN("18446744073709551615");
const FEE_DENOM = 1_000_000_000n;
const KING_DAYS = 30;
const PER_TX = 18;
const big = (x: string | null | undefined) => BigInt(x ?? "0");
const bucket = (): Bucket => ({ accrued: "0", paid: "0", burned: "0", burnedRaw: "0", owed: "0", lastAt: null, note: null });
const add = (b: Bucket, k: "accrued" | "paid" | "burned" | "burnedRaw" | "owed", v: bigint) => { b[k] = (big(b[k]) + v).toString(); };
const toSol = (x: string | bigint) => Number(BigInt(x)) / 1e9;

type Transfer = { to: string; lamports: bigint; key: string; detail?: any };
type Round = { force?: boolean };

export class Keeper {
  /** Recent actions, newest first (also persisted in the store's keeper_actions). */
  readonly log: KeeperAction[] = [];
  opts: KeeperOptions = keeperOptions();
  /** Migrations in flight (one send per pool). */
  private migrating = new Set<string>();
  /** Per-coin queue: rounds and the graduation snapshot never interleave on one ledger. */
  private locks = new Map<string, Promise<unknown>>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  lastTick: number | null = null;
  private abiCache = new Map<string, any>();
  constructor(private svc: Hookrz) {}

  // ───────────────────────────── loop ─────────────────────────────
  start(ms = this.opts.tickMs) {
    if (this.timer || ms <= 0) return;
    this.timer = setInterval(() => void this.tick().catch((e) => console.error("keeper:", e?.message ?? e)), ms);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  get running() {
    return !!this.timer;
  }

  /** One keeper round over every coin with keeper rules (or just `mint`). Never throws. */
  async tick(o: Round & { mint?: string } = {}) {
    if (this.ticking) return { skipped: "a round is already running" };
    this.ticking = true;
    const done: string[] = [];
    try {
      for (const c of this.svc.store.coins()) {
        if (o.mint && c.mint !== o.mint && c.ticker !== o.mint) continue;
        // a completed curve nobody migrated yet (the indexer's auto-migration missed it): crank it
        if (c.stage === "graduating" && this.svc.autoMigrate) await this.migrate(c.mint).catch((e) => this.fail(c.mint, e, "migrate"));
        if (!this.routing(c).keeper) continue;
        try {
          await this.round(c, o);
        } catch (e: any) {
          this.fail(c.mint, e);
        }
        done.push(c.ticker);
      }
    } finally {
      this.ticking = false;
      this.lastTick = Date.now();
    }
    return { coins: done };
  }

  /** The coin's keeper shares (its stack's crank rules and its script's payouts). */
  routing(c: CoinRow): Routing {
    return feeRouting(c.stack, this.abi(c));
  }
  private abi(c: CoinRow) {
    if (!c.script) return null;
    if (c.script.abi) return c.script.abi;
    return this.abiCache.get(c.mint) ?? null; // filled lazily by scriptAbi()
  }

  ledger(mint: string): Ledger {
    const L = this.svc.store.keeperLedger(mint) as Ledger | null;
    if (L) return L;
    return {
      v: 1, mint, claimed: { curve: "0", amm: "0" }, platform: "0", creator: bucket(), rules: {}, sniper: { settled: false, excess: "0" },
      state: { graduatedAt: null, king: null, kingUntil: null, firstBuyers: null, pots: {}, globals: null, split: null },
      lastClaimAt: null, lastRound: null, lastError: null,
    };
  }
  private save(L: Ledger) {
    this.svc.store.setKeeperLedger(L.mint, L);
  }
  private b(L: Ledger, key: string) {
    return (L.rules[key] ??= bucket());
  }

  // ───────────────────────────── migration (phase 1) ─────────────────────────────
  private lock<T>(mint: string, f: () => Promise<T>): Promise<T> {
    const p = (this.locks.get(mint) ?? Promise.resolve()).then(f, f);
    const tail = p.catch(() => undefined);
    this.locks.set(mint, tail);
    void tail.then(() => { if (this.locks.get(mint) === tail) this.locks.delete(mint); });
    return p;
  }

  async migrate(mint: string) {
    if (this.migrating.has(mint)) return null;
    this.migrating.add(mint);
    try {
      const c = this.svc.store.getCoin(mint);
      if (!c) return null;
      const s = await snapshot(this.svc.chain, new PublicKey(c.pool));
      if (s.stage !== "graduating") return null;
      const { tx, ammPool } = await buildMigration(this.svc.chain, s, this.svc.platform.publicKey);
      tx.partialSign(this.svc.platform);
      const r = await this.svc.chain.send(tx.serialize());
      if (!r.ok) throw new Error(`migration failed: ${r.error}\n${r.logs.slice(-8).join("\n")}`);
      this.record({ kind: "migrate", mint, signature: r.signature, detail: { ammPool: ammPool.toBase58() }, at: Date.now() });
      // Kingmaker and First-Buyer Rebate read the holders as of the migration.
      if (this.routing(c).keeper) {
        await this.lock(mint, async () => {
          const L = this.ledger(mint);
          await this.atGraduation(c, await snapshot(this.svc.chain, new PublicKey(c.pool)), L).catch((e) => this.fail(mint, e, "graduation"));
          this.save(L);
        });
      }
      return r.signature;
    } finally {
      this.migrating.delete(mint);
    }
  }

  // ───────────────────────────── one coin ─────────────────────────────
  private round(c: CoinRow, o: Round) {
    return this.lock(c.mint, () => this.roundLocked(c, o));
  }
  private async roundLocked(c: CoinRow, o: Round) {
    const L = this.ledger(c.mint);
    try {
      const R = this.routing(c);
      if (c.script && !c.script.abi && !this.abiCache.has(c.mint)) await this.scriptAbi(c);
      let s = await snapshot(this.svc.chain, new PublicKey(c.pool));
      const graduated = s.stage === "graduated";
      // A pot's winner changed, or the coin just graduated: claim everything first, so the round's fees are in.
      const globals = await this.globals(c, L, !!L.state.graduatedAt);
      const potChange = R.shares.some((sh) => sh.mode === "pot" && this.keyAt(c, globals, sh.to!) && this.keyAt(c, globals, sh.to!) !== (L.state.pots[sh.key] ?? null));
      const claimAll = o.force || potChange || (graduated && !L.state.graduatedAt);
      // Each phase is on its own: a failed claim or burn never holds back the payouts already owed.
      const errors: string[] = [];
      const step = async (name: string, f: () => Promise<unknown>) => {
        try { await f(); } catch (e: any) { errors.push(`${name}: ${String(e?.message ?? e).slice(0, 200)}`); this.fail(c.mint, e, name); }
      };
      await step("claim", () => this.claimCurve(c, s, L, R, claimAll));
      if (graduated) {
        await step("graduation", () => this.atGraduation(c, s, L));
        await step("claim", () => this.claimAmm(c, s, L, R, claimAll));
      }
      this.save(L);
      s = await snapshot(this.svc.chain, new PublicKey(c.pool));
      await step("burn", () => this.burns(c, s, L, o));
      await step("payout", () => this.payouts(c, s, L, R, globals, o));
      L.lastRound = s.unix;
      L.lastError = errors.length ? errors.join("; ") : null;
    } catch (e: any) {
      L.lastError = String(e?.message ?? e).slice(0, 300);
      throw e;
    } finally {
      this.save(L);
    }
  }

  // ───────────────────────────── 1. claims ─────────────────────────────
  private async claimCurve(c: CoinRow, s: Snapshot, L: Ledger, R: Routing, all: boolean) {
    const pending = BigInt((s.virtual.poolState as any).partnerQuoteFee.toString());
    if (pending <= 0n) return;
    // Sniper Fee → Burn: the window's excess is attributed from its indexed trades, so claim once the window is over.
    if (R.sniper && !L.sniper.settled && s.unix < c.launch_ts + R.sniper.seconds + this.opts.sniperGraceS) return;
    const due = all || pending >= this.opts.minClaim || L.lastClaimAt == null || s.unix - L.lastClaimAt >= this.opts.everyS;
    if (!due) return;
    const { dbc } = sdk(this.svc.chain);
    const me = this.svc.platform.publicKey;
    // The claim's base leg (0 tokens) still runs the transfer hook. Blocklist / Allowlist marks and the Token Gate ATA
    // derive from account owners, which the SDK resolves with dummy keys: rebuild them from the Stack (as buildSwap does).
    const hook = this.svc.hook;
    const offline = hook?.kind === "hookrz" && s.hookProgram && hook.id.equals(s.hookProgram)
      ? await (hook as HookrzEngine).extrasFromStack(this.svc.chain, s.mint, s.baseVault, getAssociatedTokenAddressSync(s.mint, me, true, TOKEN_2022_PROGRAM_ID), deriveDbcPoolAuthority(), me, true)
      : null;
    const partner = offline
      ? Object.assign(Object.create(dbc.partner), { getRemainingAccountsForTransferHook: async () => ({ info: { slices: [{ accountsType: AccountsType.TransferHookBase, length: offline.length }] }, accounts: offline }) })
      : dbc.partner;
    const tx: Transaction = await partner.claimPartnerTradingFee2({ feeClaimer: me, payer: me, pool: s.pool, maxBaseAmount: new BN(0), maxQuoteAmount: U64_MAX, receiver: me });
    const r = await this.send(tx, 300_000);
    if (!r.ok) return this.action(c.mint, { kind: "claim", rule: null, ok: false, sig: r.signature, detail: { source: "dbc", error: r.error, logs: r.logs.slice(-4) } });
    const claimed = -vaultDelta(r, s.quoteVault.toBase58()) || pending;
    add0(L.claimed, "curve", claimed);
    L.lastClaimAt = s.unix;
    this.action(c.mint, { kind: "claim", rule: null, ok: true, sig: r.signature, lamports: claimed, detail: { source: "dbc", pool: s.pool.toBase58() } });
    let base = claimed;
    if (R.sniper && !L.sniper.settled) {
      const excess = this.sniperExcess(c, s);
      const burn = excess < claimed ? excess : claimed;
      const bk = this.b(L, "sniper-fee-burn");
      add(bk, "accrued", burn);
      add(bk, "owed", burn);
      L.sniper = { settled: true, excess: excess.toString() };
      base -= burn;
    }
    // A coin launched before keeper phase 2 never routed its shares (creator 50): the claim is all hookrz's 50 points.
    const onchain = (s.config as any).creatorTradingFeePercentage as number;
    const routed = onchain === R.creatorTradingFeePercentage;
    if (!routed) for (const sh of R.shares) this.b(L, sh.key).note = "Not routed at launch (the pool's creator share is " + onchain + "%): nothing to pay from";
    const a = allocateCurve(base, onchain, routed ? R.shares : []);
    L.platform = (big(L.platform) + a.platform).toString();
    add(L.creator, "accrued", a.creator);
    add(L.creator, "owed", a.creator);
    for (const [k, v] of a.rules) {
      add(this.b(L, k), "accrued", v);
      add(this.b(L, k), "owed", v);
    }
    this.save(L);
  }

  /**
   * The part of the partner fees that is Sniper Fee → Burn's excess: per landed trade in the fee window, the partner's
   * share of the trading fee times (fee − base fee) / fee, with the fee numerator DBC's scheduler charged at that time.
   */
  sniperExcess(c: CoinRow, s: Snapshot) {
    const cfg: any = s.config;
    const bf = cfg.poolFees.baseFee;
    const h = getBaseFeeHandler(bf.cliffFeeNumerator, bf.firstFactor, bf.secondFactor, bf.thirdFactor, bf.baseFeeMode);
    const min = BigInt(h.getMinBaseFeeNumerator().toString());
    const partnerPct = BigInt(100 - cfg.creatorTradingFeePercentage);
    let excess = 0n;
    for (const t of this.svc.store.tradesSince(c.mint, c.launch_ts)) {
      if (t.kind === "send" || !t.ok) continue;
      const num = BigInt(h.getBaseFeeNumeratorFromIncludedFeeAmount(new BN(t.ts), new BN(s.activationPoint), t.kind === "buy" ? TradeDirection.QuoteToBase : TradeDirection.BaseToQuote, new BN(1)).toString());
      if (num <= min) continue;
      const lamports = BigInt(Math.round(t.sol * 1e9));
      // buys: the quote vault took the input, fee included; sells: it paid out the output, fee excluded
      const fee = t.kind === "buy" ? (lamports * num) / FEE_DENOM : (lamports * num) / (FEE_DENOM - num);
      const trading = fee - (fee * BigInt(PROTOCOL_PCT)) / 100n;
      const partner = (trading * partnerPct) / 100n;
      excess += (partner * (num - min)) / num;
    }
    return excess;
  }

  /** After graduation: the platform's permanently locked DAMM v2 position (the routed LP share) and its fees. */
  private async claimAmm(c: CoinRow, s: Snapshot, L: Ledger, R: Routing, all: boolean) {
    const lockedPct = (s.config as any).partnerPermanentLockedLiquidityPercentage as number;
    if (!lockedPct || !s.ammState) return;
    const { amm } = sdk(this.svc.chain);
    const me = this.svc.platform.publicKey;
    for (const p of await this.positions(s)) {
      const state = await amm.fetchPositionState(p.position);
      const pending = BigInt(getUnClaimLpFee(s.ammState, state).feeTokenB.toString());
      if (pending <= 0n) continue;
      const due = all || pending >= this.opts.minClaim || L.lastClaimAt == null || s.unix - L.lastClaimAt >= this.opts.everyS;
      if (!due) continue;
      const st = s.ammState;
      const tx: Transaction = await amm.claimPositionFee({
        owner: me, feePayer: me, pool: s.ammId, position: p.position, positionNftAccount: p.nftAccount,
        tokenAMint: st.tokenAMint, tokenBMint: st.tokenBMint, tokenAVault: st.tokenAVault, tokenBVault: st.tokenBVault, tokenAProgram: TOKEN_2022_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
      } as any);
      const r = await this.send(tx, 300_000);
      if (!r.ok) { this.action(c.mint, { kind: "claim", rule: null, ok: false, sig: r.signature, detail: { source: "damm-v2", error: r.error, logs: r.logs.slice(-4) } }); continue; }
      const claimed = -vaultDelta(r, st.tokenBVault.toBase58()) || pending;
      add0(L.claimed, "amm", claimed);
      L.lastClaimAt = s.unix;
      this.action(c.mint, { kind: "claim", rule: null, ok: true, sig: r.signature, lamports: claimed, detail: { source: "damm-v2", position: p.position.toBase58() } });
      const a = allocateLp(claimed, lockedPct, R.shares);
      add(L.creator, "accrued", a.creator);
      add(L.creator, "owed", a.creator);
      for (const [k, v] of a.rules) {
        add(this.b(L, k), "accrued", v);
        add(this.b(L, k), "owed", v);
      }
      this.save(L);
    }
  }

  /** DAMM v2 positions of the coin's pool whose NFT the platform holds. */
  async positions(s: Snapshot) {
    const list = await this.svc.chain.programAccounts(DAMM_V2_PROGRAM_ID, [{ memcmp: { offset: 8, bytes: s.ammId.toBytes() } }]);
    const out: { position: PublicKey; nftMint: PublicKey; nftAccount: PublicKey }[] = [];
    for (const p of list) {
      if (p.account.data.length < 72) continue;
      const nftMint = new PublicKey(p.account.data.subarray(40, 72));
      const nftAccount = derivePositionNftAccount(nftMint);
      const { accounts: [na] } = await this.svc.chain.read([nftAccount]);
      if (na && na.data.length >= 64 && new PublicKey(na.data.subarray(32, 64)).equals(this.svc.platform.publicKey)) out.push({ position: p.pubkey, nftMint, nftAccount });
    }
    return out;
  }

  // ───────────────────────────── graduation snapshots ─────────────────────────────
  private async atGraduation(c: CoinRow, s: Snapshot, L: Ledger) {
    if (L.state.graduatedAt || s.stage !== "graduated") return;
    const ids = normalize(c.stack).map((x: any) => x.id);
    const holders = await this.holders(c, s, { excludeCreator: true });
    if (ids.includes("kingmaker")) {
      const top = [...holders.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))[0];
      L.state.king = top?.[0] ?? null;
      L.state.kingUntil = s.unix + KING_DAYS * 86400;
    }
    const fbr = normalize(c.stack).find((x: any) => x.id === "first-buyer-rebate") as any;
    if (fbr) {
      const firsts: string[] = [];
      for (const t of this.svc.store.db.prepare("SELECT wallet FROM trades WHERE mint = ? AND ok = 1 AND kind = 'buy' ORDER BY ts, slot, rowid").all(c.mint) as any[]) {
        if (t.wallet === c.creator || t.wallet === this.svc.platform.publicKey.toBase58() || firsts.includes(t.wallet)) continue;
        firsts.push(t.wallet);
        if (firsts.length >= fbr.params.n) break;
      }
      L.state.firstBuyers = firsts.filter((w) => (holders.get(w) ?? 0n) > 0n);
    }
    // The hook is retired: the script can't change its globals or wallet vars any more. Keep them (close_stack and
    // close_wallet may delete the accounts later).
    if (c.script) {
      await this.globals(c, L, false);
      const splits = this.routing(c).shares.filter((x) => x.mode === "split");
      if (splits.length) {
        L.state.split = {};
        for (const sh of splits) L.state.split[sh.key] = (await this.flagged(c, sh.to!)).map((x) => x.owner);
      }
    }
    L.state.graduatedAt = s.unix;
    this.action(c.mint, { kind: "graduation", rule: null, ok: true, detail: { king: L.state.king, kingUntil: L.state.kingUntil, firstBuyers: L.state.firstBuyers, split: L.state.split } });
  }

  // ───────────────────────────── 2. burns ─────────────────────────────
  private async burns(c: CoinRow, s: Snapshot, L: Ledger, o: Round) {
    for (const key of ["sniper-fee-burn", "buyback-burn"]) {
      const bk = L.rules[key];
      if (!bk) continue;
      if (key === "buyback-burn" && !o.force && bk.lastAt != null && s.unix - bk.lastAt < this.opts.everyS) continue;
      let owed = big(bk.owed);
      if (owed < (o.force ? 10_000n : this.opts.minBurn)) continue; // forced rounds still skip dust
      for (let i = 0; i < this.opts.burnChunks && owed > 0n; i++) {
        const res = await this.buyAndBurn(c, owed, key).catch((e: any) => ({ deferred: `The keeper's buy couldn't be built: ${String(e?.message ?? e).slice(0, 160)}` }));
        if ("deferred" in res) {
          if (bk.note !== res.deferred) this.action(c.mint, { kind: "deferred", rule: key, ok: true, lamports: owed, detail: { reason: res.deferred } });
          bk.note = res.deferred;
          break;
        }
        add(bk, "owed", -res.spent);
        add(bk, "burned", res.spent);
        add(bk, "burnedRaw", res.burnedRaw);
        bk.lastAt = s.unix;
        bk.note = null;
        owed -= res.spent;
        this.save(L);
        if (!res.partial) break;
      }
    }
  }

  /** Why the keeper can't buy this coin on the curve right now (null: it can). Never a platform exemption: it waits. */
  private curveBlocked(c: CoinRow, s: Snapshot): string | null {
    if (c.script?.bytecode) return "Hookscript coin: buybacks wait for graduation, so the keeper's buys never play the coin's game";
    const t = s.unix - c.launch_ts;
    for (const x of normalize(c.stack) as { id: string; params: any }[]) {
      if (x.id === "snipe-shield" && t < x.params.window) return `Snipe Shield window open (${x.params.window - t}s left)`;
      if (x.id === "anti-bundle" && t < x.params.window * 60) return "Anti-Bundle window open: the keeper doesn't take buyers' slots";
      if (x.id === "allowlist-phase" && t < x.params.minutes * 60) return "Allowlist phase open";
    }
    return null;
  }

  /** Buy the coin with `lamports` (or the largest part the coin's rules allow now) and burn what it bought, in one tx. */
  async buyAndBurn(c: CoinRow, lamports: bigint, rule: string): Promise<{ deferred: string } | { spent: bigint; burnedRaw: bigint; sig: string; partial: boolean }> {
    const chain = this.svc.chain, me = this.svc.platform.publicKey, mint = new PublicKey(c.mint);
    const s = await snapshot(chain, new PublicKey(c.pool));
    if (s.stage === "graduating") return { deferred: "The curve is graduating; burns resume on DAMM v2" };
    const onCurve = s.stage === "curve";
    let input = lamports;
    if (onCurve && s.hookProgram) {
      const why = this.curveBlocked(c, s);
      if (why) return { deferred: why };
      // The keeper is an ordinary buyer: the coin's own rules decide how much it may buy (caps, breaker, hours).
      const q = await this.svc.quote({ mint: c.mint, side: "buy", amount: Number(lamports) / 1e9, wallet: me.toBase58() });
      if (!q.ok) {
        const max = BigInt(Math.floor(q.maxAllowed * 0.95 * 1e9));
        if (max < 10_000n) return { deferred: `Refused by ${q.refusedBy ?? "the stack"} (${q.code}) for the keeper's buy: ${q.message ?? ""}`.trim() };
        input = max;
      }
    }
    const rq = rawQuote(chain, s, "buy", input);
    const minOut = (rq.output * 99n) / 100n;
    if (minOut <= 0n) return { deferred: `${toSol(input)} SOL buys less than one raw unit; waiting for more` };
    const needsRecord = onCurve && !!this.svc.hook && this.svc.hook.needsWalletRecord(c.stack);
    const { tx } = await buildSwap(chain, this.svc.hook, s, me, "buy", input, minOut, { needsRecord });
    const ata = getAssociatedTokenAddressSync(mint, me, true, TOKEN_2022_PROGRAM_ID);
    tx.add(createBurnCheckedInstruction(ata, mint, me, minOut, BASE_DECIMALS, [], TOKEN_2022_PROGRAM_ID));
    tx.sign(this.svc.platform);
    const sim = await chain.simulate(tx.serialize());
    if (sim.error) {
      const code = customCode(sim.error) ?? customCode(sim.logs.join("\n"));
      return { deferred: `The keeper's buy would fail (${code ?? sim.error}); retrying next round` };
    }
    const supply0 = await this.supply(mint);
    const r = await chain.send(tx.serialize());
    if (!r.ok) {
      this.action(c.mint, { kind: "burn", rule, ok: false, sig: r.signature, lamports: input, detail: { error: r.error, logs: r.logs.slice(-4) } });
      return { deferred: `The keeper's buy failed (${r.code ?? r.error})` };
    }
    // Whatever the swap returned above minOut is burned too, so the keeper never holds the coin.
    const left = (await tokenBalance(chain, mint, me)).raw;
    let sweep: string | null = null;
    if (left > 0n) {
      const t2 = new Transaction().add(createBurnCheckedInstruction(ata, mint, me, left, BASE_DECIMALS, [], TOKEN_2022_PROGRAM_ID));
      const r2 = await this.send(t2, 0);
      if (r2.ok) sweep = r2.signature;
    }
    const burnedRaw = supply0 - (await this.supply(mint));
    const vault = onCurve ? s.quoteVault.toBase58() : s.ammState.tokenBVault.toBase58();
    const spent = vaultDelta(r, vault) || input;
    this.action(c.mint, { kind: "burn", rule, ok: true, sig: r.signature, lamports: spent, tokens: burnedRaw, detail: { route: onCurve ? "Meteora DBC" : "Meteora DAMM v2", sweep } });
    return { spent, burnedRaw, sig: r.signature, partial: input < lamports };
  }
  private async supply(mint: PublicKey) {
    const { accounts: [m] } = await this.svc.chain.read([mint]);
    return unpackMint(mint, m as any, TOKEN_2022_PROGRAM_ID).supply;
  }

  // ───────────────────────────── 3. payouts ─────────────────────────────
  private async payouts(c: CoinRow, s: Snapshot, L: Ledger, R: Routing, globals: Uint8Array | null, o: Round) {
    const plan: Transfer[] = [];
    const now = s.unix;
    const hourly = (bk: Bucket) => o.force || bk.lastAt == null || now - bk.lastAt >= this.opts.everyS;
    let holders: Map<string, bigint> | null = null;
    const getHolders = async () => (holders ??= await this.holders(c, s, { excludeCreator: true }));
    const supply = await this.supply(new PublicKey(c.mint));
    for (const sh of R.shares) {
      if (sh.kind !== "pay") continue;
      const bk = this.b(L, sh.key);
      const owed = big(bk.owed);
      if (sh.mode === "pot") {
        // The pot goes, whole, to each NEW winner (SPEC "Payouts"); a winner seen with an empty pot still ends the round.
        const w = this.keyAt(c, globals, sh.to!);
        if (w && w !== (L.state.pots[sh.key] ?? null)) {
          // the winner counts as paid once the transfer lands (pay() marks it), so a failed send is retried for them
          if (owed > 0n) plan.push({ to: w, lamports: owed, key: sh.key, detail: { pot: w } });
          else {
            L.state.pots[sh.key] = w;
            this.action(c.mint, { kind: "pot", rule: sh.key, ok: true, dest: w, lamports: 0n, detail: { note: "new winner, empty pot" } });
          }
        }
        continue;
      }
      if (owed <= 0n) continue;
      switch (sh.id) {
        case "tithe":
          plan.push({ to: String(sh.params.to), lamports: owed, key: sh.key });
          break;
        case "holder-rewards": {
          if (!hourly(bk)) break;
          const min = (supply * BigInt(Math.round(Number(sh.params.min) * 10_000))) / 1_000_000n;
          const list = [...(await getHolders()).entries()].filter(([, v]) => v > 0n && v >= min);
          plan.push(...proRata(list, owed, sh.key, this.opts.maxRecipients));
          break;
        }
        case "diamond-tiers": {
          if (!hourly(bk)) break;
          const crowned = await this.crowned(c, s, Number(sh.params.hours), await getHolders());
          plan.push(...proRata(crowned, owed, sh.key, this.opts.maxRecipients));
          break;
        }
        case "first-buyer-rebate": {
          const list = L.state.firstBuyers;
          if (!list?.length) break; // accrues until graduation
          plan.push(...equal(list, owed, sh.key));
          break;
        }
        case "kingmaker": {
          if (!L.state.graduatedAt) break; // accrues until graduation
          const to = L.state.king && now < (L.state.kingUntil ?? 0) ? L.state.king : c.creator; // after 30 days the share returns to the creator
          plan.push({ to, lamports: owed, key: sh.key, detail: { king: to === L.state.king } });
          break;
        }
        case "custom": {
          if (sh.mode === "stream") {
            const to = this.keyAt(c, globals, sh.to!);
            if (to) plan.push({ to, lamports: owed, key: sh.key }); // no king yet: the share waits for one
          } else if (sh.mode === "split") {
            const live = L.state.split?.[sh.key] ?? (await this.flagged(c, sh.to!)).map((x) => x.owner);
            const all = await this.holders(c, s, { excludeCreator: false });
            const list = [...new Set(live)].filter((w) => (all.get(w) ?? 0n) > 0n);
            plan.push(...equal(list, owed, sh.key));
          }
          break;
        }
      }
    }
    const cr = big(L.creator.owed);
    if (cr > 0n) plan.push({ to: c.creator, lamports: cr, key: "creator" });
    await this.pay(c, L, plan, o);
  }

  /** Send the planned transfers (≤ 18 per transaction); amounts below the minimum, or too small to open an empty account, wait. */
  private async pay(c: CoinRow, L: Ledger, plan: Transfer[], o: Round) {
    const min = o.force ? 1n : this.opts.minPayout;
    const rent = BigInt(await this.svc.chain.rent(0));
    const keys = [...new Set(plan.map((p) => p.to))].map((k) => new PublicKey(k));
    const { accounts } = keys.length ? await this.svc.chain.read(keys) : { accounts: [] as any[] };
    const exists = new Map(keys.map((k, i) => [k.toBase58(), !!accounts[i]]));
    const ok = plan.filter((p) => p.lamports >= min && (exists.get(p.to) || p.lamports >= rent) && p.to !== this.svc.platform.publicKey.toBase58());
    for (let i = 0; i < ok.length; i += PER_TX) {
      const batch = ok.slice(i, i + PER_TX);
      const tx = new Transaction().add(...batch.map((p) => SystemProgram.transfer({ fromPubkey: this.svc.platform.publicKey, toPubkey: new PublicKey(p.to), lamports: p.lamports })));
      const r = await this.send(tx, 0);
      for (const p of batch) {
        const bk = p.key === "creator" ? L.creator : this.b(L, p.key);
        if (r.ok) {
          add(bk, "owed", -p.lamports);
          add(bk, "paid", p.lamports);
          bk.lastAt = r.unix;
          bk.note = null;
          if (p.detail?.pot) L.state.pots[p.key] = p.detail.pot;
        }
        this.action(c.mint, { kind: "payout", rule: p.key, ok: r.ok, sig: r.signature, dest: p.to, lamports: p.lamports, detail: r.ok ? (p.detail ?? null) : { error: r.error } });
      }
      this.save(L);
    }
    // Amounts below the payout minimum (or too small to open an empty account) wait in their bucket; the rule says why.
    // A pot too small to send rolls over to the next winner.
    for (const p of plan) {
      if (ok.includes(p) || p.key === "creator") continue;
      this.b(L, p.key).note = `waiting: ${toSol(p.lamports).toFixed(9)} SOL is below the payout minimum`;
      if (p.detail?.pot) L.state.pots[p.key] = p.detail.pot;
    }
  }

  // ───────────────────────────── reads ─────────────────────────────
  /** Holders by owner (raw units), from every Token-2022 account of the mint on chain. Pool vaults, the platform and the
   *  burn address are never holders; built-in rules also leave out the creator (its own fees would flow back to it). */
  async holders(c: CoinRow, s: Snapshot | null, o: { excludeCreator: boolean }) {
    const mint = new PublicKey(c.mint);
    const list = await this.svc.chain.programAccounts(TOKEN_2022_PROGRAM_ID, [{ memcmp: { offset: 0, bytes: mint.toBytes() } }]);
    const skip = new Set([deriveDbcPoolAuthority().toBase58(), deriveDammV2PoolAuthority().toBase58(), this.svc.platform.publicKey.toBase58(), INCINERATOR.toBase58(), PublicKey.default.toBase58()]);
    if (o.excludeCreator) skip.add(c.creator);
    const out = new Map<string, bigint>();
    for (const a of list) {
      const d = a.account.data;
      if (d.length < 165 || (d.length > 165 && d[165] !== 2)) continue; // token accounts only (not the mint)
      const owner = new PublicKey(d.subarray(32, 64)).toBase58();
      if (skip.has(owner)) continue;
      const amount = d.readBigUInt64LE(64);
      if (amount > 0n) out.set(owner, (out.get(owner) ?? 0n) + amount);
    }
    void s;
    return out;
  }

  /** Diamond Tiers: holders whose first receipt is at least `hours` old and who never sold. From the engine's Wallet
   *  records when the coin keeps them (first_receipt_ts, has-sold flag), plus the indexer, which also sees DAMM v2 sells. */
  async crowned(c: CoinRow, s: Snapshot, hours: number, holders: Map<string, bigint>): Promise<[string, bigint][]> {
    const cutoff = s.unix - hours * 3600;
    const hist = new Map<string, { first: number | null; sold: boolean }>();
    for (const t of this.svc.store.db.prepare("SELECT wallet, dest, kind, ts FROM trades WHERE mint = ? AND ok = 1 ORDER BY ts, rowid").all(c.mint) as any[]) {
      const rx = t.kind === "buy" ? t.wallet : t.kind === "send" ? t.dest : null;
      if (rx) { const h = hist.get(rx) ?? { first: null, sold: false }; h.first ??= t.ts; hist.set(rx, h); }
      if (t.kind === "sell") { const h = hist.get(t.wallet) ?? { first: null, sold: false }; h.sold = true; hist.set(t.wallet, h); }
    }
    const recs = new Map<string, { first: number | null; sold: boolean }>();
    if (this.svc.hook?.kind === "hookrz" && this.svc.hook.needsWalletRecord(c.stack)) {
      for (const r of await this.records(c)) recs.set(r.owner, { first: r.rec.firstReceiptTs, sold: (r.rec.flags & 2) !== 0 || (recs.get(r.owner)?.sold ?? false) });
    }
    const out: [string, bigint][] = [];
    for (const [owner, bal] of holders) {
      const h = hist.get(owner), r = recs.get(owner);
      if (h?.sold || r?.sold) continue;
      const first = r?.first ?? h?.first ?? null;
      if (first == null || first > cutoff) continue;
      out.push([owner, bal]);
    }
    return out;
  }

  /** The coin's Wallet records (engine-owned, this mint), with the owner and balance of each token account. */
  async records(c: CoinRow) {
    const hook = this.svc.hook;
    if (!hook || hook.kind !== "hookrz") return [];
    const mint = new PublicKey(c.mint);
    const list = await this.svc.chain.programAccounts(hook.id, [{ dataSize: 328 }, { memcmp: { offset: 96, bytes: mint.toBytes() } }]);
    const tas = list.map((x) => new PublicKey(x.account.data.subarray(128, 160)));
    const { accounts } = tas.length ? await this.svc.chain.read(tas) : { accounts: [] as any[] };
    return list.map((x, i) => {
      const ta = accounts[i];
      return { address: x.pubkey, rec: decodeWallet(x.account.data), owner: ta && ta.data.length >= 72 ? new PublicKey(ta.data.subarray(32, 64)).toBase58() : null, balance: ta && ta.data.length >= 72 ? ta.data.readBigUInt64LE(64) : 0n };
    }).filter((x) => x.owner) as { address: PublicKey; rec: ReturnType<typeof decodeWallet>; owner: string; balance: bigint }[];
  }

  /** Split payouts: owners whose bool wallet var `name` is true (Wallet record var area at 192 + the ABI offset). */
  async flagged(c: CoinRow, name: string) {
    const v = (this.abi(c)?.wallet ?? []).find((x: any) => x.name === name);
    if (!v) return [];
    return (await this.records(c)).filter((r) => r.rec.scriptVars[v.offset] !== 0).map((r) => ({ owner: r.owner, balance: r.balance }));
  }

  /** Script globals: the Script account's 256 bytes at offset 16 while it exists, else the copy kept at graduation. */
  private async globals(c: CoinRow, L: Ledger, frozen: boolean): Promise<Uint8Array | null> {
    if (!c.script || !this.svc.hook || this.svc.hook.kind !== "hookrz") return null;
    if (frozen && L.state.globals) return Uint8Array.from(Buffer.from(L.state.globals, "hex"));
    const key = (this.svc.hook as any).scriptPda(new PublicKey(c.mint)) as PublicKey;
    const { accounts: [a] } = await this.svc.chain.read([key]);
    if (a && a.owner.equals(this.svc.hook.id) && a.data.length >= 272) {
      const g = Uint8Array.from(a.data.subarray(16, 272));
      L.state.globals = Buffer.from(g).toString("hex");
      return g;
    }
    return L.state.globals ? Uint8Array.from(Buffer.from(L.state.globals, "hex")) : null;
  }
  /** A `key` global by name (null when none). */
  keyAt(c: CoinRow, globals: Uint8Array | null, name: string): string | null {
    const g = (this.abi(c)?.globals ?? []).find((x: any) => x.name === name && x.type === "key");
    if (!g || !globals) return null;
    const k = globals.subarray(g.offset, g.offset + 32);
    return k.every((x) => x === 0) ? null : new PublicKey(k).toBase58();
  }
  private async scriptAbi(c: CoinRow) {
    if (!c.script?.source) return null;
    const { hookscript } = await import("./rules.js");
    const lib = await hookscript();
    const out = lib?.compile?.(String(c.script.source));
    const abi = out?.ok ? out.abi : null;
    this.abiCache.set(c.mint, abi);
    return abi;
  }

  // ───────────────────────────── plumbing ─────────────────────────────
  private async send(tx: Transaction, cu: number): Promise<TxRecord> {
    const me = this.svc.platform.publicKey;
    await envelope(this.svc.chain, me, tx, cu);
    if (!cu) tx.instructions = tx.instructions.filter((i: TransactionInstruction) => !i.programId.equals(ComputeBudgetProgram.programId));
    tx.sign(this.svc.platform);
    return this.svc.chain.send(tx.serialize());
  }
  private action(mint: string, a: { kind: string; rule: string | null; ok: boolean; sig?: string | null; dest?: string | null; lamports?: bigint | null; tokens?: bigint | null; detail?: any }) {
    const at = Date.now();
    const row = { mint, kind: a.kind, rule: a.rule, ok: a.ok, sig: a.sig ?? null, dest: a.dest ?? null, lamports: a.lamports != null ? a.lamports.toString() : null, tokens: a.tokens != null ? a.tokens.toString() : null, detail: a.detail ?? null, at };
    this.svc.store.addKeeperAction(row);
    this.record({ kind: a.kind, mint, signature: row.sig, detail: { rule: a.rule, ok: a.ok, dest: row.dest, lamports: row.lamports, tokens: row.tokens, ...(a.detail ?? {}) }, at });
  }
  private fail(mint: string, e: any, phase: string | null = null) {
    const msg = String(e?.message ?? e).slice(0, 300);
    console.error(`keeper ${this.svc.store.getCoin(mint)?.ticker ?? mint}${phase ? ` ${phase}` : ""}:`, process.env.KEEPER_DEBUG ? e?.stack : msg);
    this.action(mint, { kind: "error", rule: null, ok: false, detail: { phase, error: msg } });
  }
  private record(a: KeeperAction) {
    this.log.unshift(a);
    this.log.length = Math.min(this.log.length, 500);
    if (a.kind === "migrate") this.svc.store.addKeeperAction({ mint: a.mint, kind: "migrate", ok: true, sig: a.signature, detail: a.detail, at: a.at });
    this.svc.events.emit("event", { type: "keeper", ...a });
  }

  // ───────────────────────────── API ─────────────────────────────
  /** GET /v1/coins/:mint/keeper — the coin's fee routing and keeper ledger, every amount with its transactions. */
  view(c: CoinRow, o: { actions?: boolean } = {}) {
    const R = this.routing(c);
    const L = this.ledger(c.mint);
    const f = curveFeatures(c.stack);
    const bkView = (b: Bucket) => ({ accruedSol: toSol(b.accrued), paidSol: toSol(b.paid), burnedSol: toSol(b.burned), burnedTokens: Number(big(b.burnedRaw)) / 10 ** BASE_DECIMALS, owedSol: toSol(b.owed), lamports: { accrued: b.accrued, paid: b.paid, burned: b.burned, owed: b.owed }, burnedRaw: b.burnedRaw, lastAt: b.lastAt, note: b.note });
    const rules = [
      ...(R.sniper ? [{ key: "sniper-fee-burn", id: "sniper-fee-burn", label: "Sniper Fee → Burn", sharePct: null, kind: "burn" }] : []),
      ...R.shares.map((s) => ({ key: s.key, id: s.id, label: s.label, sharePct: s.bps / 100, kind: s.kind, mode: s.mode ?? null, to: s.id === "tithe" ? s.params?.to ?? null : s.to ?? null })),
    ].map((r) => ({ ...r, ...bkView(L.rules[r.key] ?? bucket()) }));
    const sum = (k: "paid" | "burned" | "owed" | "burnedRaw") => Object.values(L.rules).reduce((a, b) => a + big(b[k]), 0n);
    const claimed = big(L.claimed.curve) + big(L.claimed.amm);
    return {
      mint: c.mint, ticker: c.ticker, keeper: R.keeper, platform: this.svc.platform.publicKey.toBase58(),
      routing: {
        tradeFeeNote: "Meteora keeps 20% of every trading fee; the points below split the other 80%.",
        creatorTradingFeePct: R.creatorTradingFeePercentage, platformClaimPct: 100 - R.creatorTradingFeePercentage, hookrzPct: 50,
        routedPct: R.shareBps / 200, keeperShareOfCreatorPct: R.shareBps / 100,
        creatorPassThrough: !!R.sniper,
        sniper: R.sniper ? { startPct: R.sniper.startBps / 100, endPct: 1, seconds: R.sniper.seconds } : null,
        afterGraduation: { partnerLockedLpPct: R.partnerLockedLpPct, lockedLpPct: f.lockedLpPct },
      },
      totals: {
        claimedSol: toSol(claimed), claimedCurveSol: toSol(L.claimed.curve), claimedAmmSol: toSol(L.claimed.amm),
        keptSol: toSol(L.platform), paidSol: toSol(sum("paid") + big(L.creator.paid)), burnedSol: toSol(sum("burned")), burnedTokens: Number(sum("burnedRaw")) / 10 ** BASE_DECIMALS,
        owedSol: toSol(sum("owed") + big(L.creator.owed)), creatorPaidSol: toSol(L.creator.paid), creatorOwedSol: toSol(L.creator.owed),
        lamports: { claimed: claimed.toString(), kept: L.platform, paid: (sum("paid") + big(L.creator.paid)).toString(), burned: sum("burned").toString(), owed: (sum("owed") + big(L.creator.owed)).toString() },
      },
      rules,
      creator: { wallet: c.creator, ...bkView(L.creator) },
      state: { ...L.state, globals: undefined, sniperExcessSol: toSol(L.sniper.excess), sniperSettled: L.sniper.settled },
      lastRound: L.lastRound, lastClaimAt: L.lastClaimAt, lastError: L.lastError,
      actions: o.actions === false ? [] : this.svc.store.keeperActions(c.mint, 100),
    };
  }
  /** GET /v1/keeper — the loop, the platform key, every keeper coin's totals and the latest actions. */
  overview() {
    const coins = this.svc.store.coins().filter((c) => this.routing(c).keeper).map((c) => {
      const v = this.view(c, { actions: false });
      return { mint: c.mint, ticker: c.ticker, stage: c.stage, rules: v.rules.map((r) => r.key), totals: v.totals, lastRound: v.lastRound, lastError: v.lastError };
    });
    return { running: this.running, intervalMs: this.opts.tickMs, lastTick: this.lastTick, platform: this.svc.platform.publicKey.toBase58(), coins, actions: this.svc.store.keeperActions(null, 100) };
  }
}

/** post − pre of one token account in a transaction (positive: it received). */
function vaultDelta(r: TxRecord, account: string) {
  const pre = BigInt(r.pre.find((b) => b.account === account)?.raw ?? "0");
  const post = BigInt(r.post.find((b) => b.account === account)?.raw ?? "0");
  return post - pre;
}
function add0(o: { curve: string; amm: string }, k: "curve" | "amm", v: bigint) {
  o[k] = (BigInt(o[k]) + v).toString();
}
/** Pro rata by balance, largest holders first, at most `max` wallets; rounding stays owed. */
function proRata(list: [string, bigint][], owed: bigint, key: string, max: number): Transfer[] {
  const top = [...list].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, max);
  const total = top.reduce((a, [, v]) => a + v, 0n);
  if (total <= 0n) return [];
  return top.map(([to, v]) => ({ to, lamports: (owed * v) / total, key, detail: { balanceRaw: v.toString() } })).filter((t) => t.lamports > 0n);
}
function equal(list: string[], owed: bigint, key: string): Transfer[] {
  if (!list.length) return [];
  const each = owed / BigInt(list.length);
  return each > 0n ? list.map((to) => ({ to, lamports: each, key })) : [];
}
export type { Share };
