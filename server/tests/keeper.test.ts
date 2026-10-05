// Keeper phase 2 on the local fork (real DBC, DAMM v2, Token-2022 binaries + hookrz_engine): fee routing at launch,
// partner-fee claims, buy-and-burn, every payout rule, Hookscript payouts, and the failure paths.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { boot } from "../src/boot.js";
import { buildApp } from "../src/app.js";
import { signB64, type Hookrz } from "../src/service.js";
import { snapshot, tokenBalance } from "../src/market.js";
import { allocateCurve, allocateLp, feeRouting } from "../src/fees.js";
import { getBaseFeeHandler } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import type { ForkChain } from "../src/fork.js";

let svc: Hookrz, chain: ForkChain, app: ReturnType<typeof buildApp>;
const LAMPORTS = 1_000_000_000;

before(async () => {
  svc = (await boot({ db: ":memory:", forkState: null, thresholdSol: 10 })).svc;
  chain = svc.chain as ForkChain;
  app = buildApp(svc);
});

const wallet = (sol = 50) => {
  const k = Keypair.generate();
  chain.fund(k.publicKey, sol);
  return k;
};
const lamports = async (k: PublicKey | string) => (await chain.read([new PublicKey(k)])).accounts[0]?.lamports ?? 0;
const supply = async (mint: string) => unpackMint(new PublicKey(mint), (await chain.read([new PublicKey(mint)])).accounts[0] as any, TOKEN_2022_PROGRAM_ID).supply;
const raw = async (mint: string, owner: Keypair) => (await tokenBalance(chain, new PublicKey(mint), owner.publicKey)).raw;
const big = (x: string) => BigInt(x);

async function launch(creator: Keypair, ticker: string, stack: any[], creatorBuySol = 0, extra: any = {}) {
  const prep = await svc.prepareLaunch({ meta: { name: `${ticker} coin`, ticker, creatorBuySol }, stack, creator: creator.publicKey.toBase58(), ...extra });
  await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, creator)) });
  return { prep, mint: prep.mint as string, pool: new PublicKey(prep.pool!) };
}
async function trade(who: Keypair, ticker: string, side: "buy" | "sell", amount: number) {
  const prep = await svc.prepareTrade({ ticker, side, amount, wallet: who.publicKey.toBase58(), minOut: "1" });
  const r = await svc.sendTx(signB64(prep.transaction, who));
  assert.ok(r.ok, `${ticker} ${side} ${amount}: ${r.error} ${r.logs.slice(-3).join(" | ")}`);
  return r;
}
const partnerPending = async (pool: PublicKey) => BigInt((await snapshot(chain, pool)).virtual.poolState.partnerQuoteFee.toString());
const actions = (mint: string) => svc.store.keeperActions(mint, 500).reverse();
/** Payouts of one rule in the last round, by destination. */
const paid = (mint: string, rule: string, since = 0) => {
  const m = new Map<string, bigint>();
  for (const a of actions(mint)) if (a.kind === "payout" && a.ok && a.rule === rule && (a as any).id > since) m.set(a.dest!, (m.get(a.dest!) ?? 0n) + big(a.lamports!));
  return m;
};
const lastId = (mint: string) => (svc.store.keeperActions(mint, 1)[0] as any)?.id ?? 0;
async function graduate(ticker: string, pool: PublicKey) {
  for (let i = 0; i < 60 && (await snapshot(chain, pool)).stage === "curve"; i++) await trade(wallet(50), ticker, "buy", 2);
  for (let k = 0; k < 40 && (await snapshot(chain, pool)).stage !== "graduated"; k++) {
    await svc.idle();
    await new Promise((f) => setTimeout(f, 50));
  }
  assert.equal((await snapshot(chain, pool)).stage, "graduated");
}

test("fee routing at launch: keeper shares move to the partner side; coins without keeper rules keep 50/50", async () => {
  // pure routing maths
  const plain = feeRouting([{ id: "snipe-shield" }, { id: "lp-lock" }]);
  assert.equal(plain.creatorTradingFeePercentage, 50);
  assert.equal(plain.partnerLockedLpPct, 0);
  assert.equal(plain.keeper, false);
  const r = feeRouting([{ id: "buyback-burn", params: { pct: 25 } }, { id: "tithe", params: { pct: 10, to: PublicKey.default.toBase58() } }]);
  assert.equal(r.creatorTradingFeePercentage, 50 - 18, "35% of the creator's 50 points = 17.5, routed as 18");
  assert.equal(r.partnerLockedLpPct, 35);
  const a = allocateCurve(68_000_000n, 32, r.shares);
  assert.equal(a.platform, 50_000_000n, "hookrz keeps exactly its 50 points of the claim");
  assert.equal(a.rules.get("buyback-burn"), 12_500_000n);
  assert.equal(a.rules.get("tithe"), 5_000_000n);
  assert.equal(a.creator, 500_000n, "the rounding half point goes back to the creator");
  const lp = allocateLp(35_000n, 35, r.shares);
  assert.equal(lp.rules.get("buyback-burn"), 25_000n);
  assert.equal(lp.rules.get("tithe"), 10_000n);
  assert.equal(feeRouting([{ id: "sniper-fee-burn" }]).creatorTradingFeePercentage, 0, "Sniper Fee → Burn routes the creator's whole share");
  assert.throws(() => allocateCurve(1_000n, 50, r.shares), /points/, "a pool that never routed the shares can't fund them (coins launched before phase 2)");

  // on chain: the DBC config of a plain coin and of a keeper coin
  const c = wallet();
  const P = await launch(c, "PLAIN", [{ id: "max-wallet", params: { pct: 10 } }]);
  const pc: any = (await snapshot(chain, P.pool)).config;
  assert.equal(pc.creatorTradingFeePercentage, 50);
  assert.equal(pc.partnerPermanentLockedLiquidityPercentage, 0);
  assert.equal(svc.coin("PLAIN")!.keeper, null);
  const t = wallet(1);
  const K = await launch(c, "ROUTE", [{ id: "lp-lock", params: { pct: 100 } }, { id: "buyback-burn", params: { pct: 25 } }, { id: "tithe", params: { pct: 10, to: t.publicKey.toBase58() } }]);
  const kc: any = (await snapshot(chain, K.pool)).config;
  assert.equal(kc.creatorTradingFeePercentage, 32);
  assert.equal(kc.partnerPermanentLockedLiquidityPercentage, 35);
  assert.equal(kc.creatorPermanentLockedLiquidityPercentage, 65, "LP Lock 100%: the creator's part stays locked too");
  assert.equal(kc.creatorLiquidityPercentage, 0);
  assert.equal(K.prep.curve.feeSplit.creatorTradingFeePercentage, 32);

  // launch-time checks
  await assert.rejects(svc.prepareLaunch({ meta: { name: "x", ticker: "NOTITHE" }, stack: [{ id: "tithe" }], creator: c.publicKey.toBase58() }), /TITHE|address/);
  await assert.rejects(svc.prepareLaunch({ meta: { name: "x", ticker: "TOOMUCH" }, stack: [{ id: "holder-rewards", params: { pct: 80 } }, { id: "buyback-burn", params: { pct: 30 } }], creator: c.publicKey.toBase58() }), /100%/);
});

let K1: Awaited<ReturnType<typeof launch>>;
let k1c: Keypair, alice: Keypair, bob: Keypair, dust: Keypair, church: Keypair;

test("nothing is paid when fees are 0", async () => {
  k1c = wallet();
  church = wallet(1);
  K1 = await launch(k1c, "KEEP", [
    { id: "hold-timer", params: { minutes: 5 } },
    { id: "buyback-burn", params: { pct: 40 } },
    { id: "holder-rewards", params: { pct: 20, min: 0.01 } },
    { id: "tithe", params: { pct: 10, to: church.publicKey.toBase58() } },
    { id: "diamond-tiers", params: { hours: 1, pct: 20 } },
  ]);
  const cfg: any = (await snapshot(chain, K1.pool)).config;
  assert.equal(cfg.creatorTradingFeePercentage, 5, "90% of the creator's fees routed: 50 − 45");
  assert.equal(await partnerPending(K1.pool), 0n);
  const before = await lamports(svc.platform.publicKey);
  await svc.keeper.tick({ force: true });
  assert.deepEqual(actions(K1.mint).filter((a) => a.kind !== "deferred"), [], "no claim, no payout, no burn");
  assert.equal(await lamports(svc.platform.publicKey), before, "not even a fee was spent");
  const v = (await app.inject({ method: "GET", url: `/v1/coins/KEEP/keeper` })).json();
  assert.equal(v.totals.claimedSol, 0);
  assert.equal(v.routing.creatorTradingFeePct, 5);
});

test("buyback-burn, tithe, holder-rewards and diamond-tiers: claim, split, burn and pay exactly", async () => {
  alice = wallet(50); bob = wallet(50); dust = wallet(5);
  await trade(alice, "KEEP", "buy", 0.6);
  await trade(bob, "KEEP", "buy", 0.4);
  await trade(dust, "KEEP", "buy", 0.000_01); // well under Holder Rewards' 0.01% minimum
  chain.warp(2 * 3600); // past Diamond Tiers' 1h and the hold timer
  await trade(bob, "KEEP", "sell", Number(await raw(K1.mint, bob)) / 1e6 / 4); // bob sold: no crown
  await svc.idle();
  const pending = await partnerPending(K1.pool);
  assert.ok(pending > 0n);
  const supply0 = await supply(K1.mint);
  const churchBefore = await lamports(church.publicKey);
  const mark = lastId(K1.mint);
  await svc.keeper.tick({ force: true });
  const L = svc.keeper.ledger(K1.mint);
  // claim: exactly what the pool held for the partner, read from the vault's own delta
  assert.equal(big(L.claimed.curve), pending);
  assert.ok((await partnerPending(K1.pool)) * 100n <= big(L.rules["buyback-burn"].burned), "only the keeper's own buyback fee is left unclaimed");
  const want = allocateCurve(pending, 5, svc.keeper.routing(svc.store.getCoin(K1.mint)!).shares);
  assert.equal(big(L.platform), want.platform, "hookrz keeps 50/95 of the claim");
  for (const k of ["buyback-burn", "holder-rewards", "tithe", "diamond-tiers"]) assert.equal(big(L.rules[k].accrued), want.rules.get(k), k);
  // buyback-burn: the keeper bought the coin and burned it, and holds none
  const bb = L.rules["buyback-burn"];
  assert.ok(big(bb.burned) > 0n && big(bb.burned) <= want.rules.get("buyback-burn")!);
  assert.equal(big(bb.burned) + big(bb.owed), big(bb.accrued));
  assert.equal(supply0 - (await supply(K1.mint)), big(bb.burnedRaw), "supply fell by exactly the burned amount");
  assert.equal((await tokenBalance(chain, new PublicKey(K1.mint), svc.platform.publicKey)).raw, 0n);
  const burn = actions(K1.mint).find((a) => a.kind === "burn" && a.ok)!;
  assert.ok(burn.sig && (await chain.record(burn.sig))?.ok);
  // tithe: the named address got its share, to the lamport
  assert.equal(BigInt(await lamports(church.publicKey)) - BigInt(churchBefore), want.rules.get("tithe"));
  // holder rewards: pro rata by balance, creator and dust left out
  const hr = paid(K1.mint, "holder-rewards", mark);
  const a = await raw(K1.mint, alice), b = await raw(K1.mint, bob);
  const owedHr = want.rules.get("holder-rewards")!;
  assert.deepEqual([...hr.keys()].sort(), [alice.publicKey.toBase58(), bob.publicKey.toBase58()].sort());
  assert.equal(hr.get(alice.publicKey.toBase58()), (owedHr * a) / (a + b));
  assert.equal(hr.get(bob.publicKey.toBase58()), (owedHr * b) / (a + b));
  // diamond tiers: alice and dust held 2h and never sold (pro rata by balance); bob sold
  const dt = paid(K1.mint, "diamond-tiers", mark);
  const d = await raw(K1.mint, dust), owedDt = want.rules.get("diamond-tiers")!;
  assert.ok(!dt.has(bob.publicKey.toBase58()), "a seller wears no crown");
  assert.equal(dt.get(alice.publicKey.toBase58()), (owedDt * a) / (a + d));
  const rec = await (svc.hook as any).readWallet(chain, new PublicKey(K1.mint), (await tokenBalance(chain, new PublicKey(K1.mint), alice.publicKey)).ata);
  assert.ok(rec.firstReceiptTs <= (await snapshot(chain, K1.pool)).unix - 3600, "the crown comes from the engine's Wallet record");
  // the creator's rounding share
  assert.equal(big(L.creator.accrued), want.creator);
  // every payout is a public transaction that landed
  for (const x of actions(K1.mint).filter((x) => x.kind === "payout")) assert.ok((await chain.record(x.sig!))?.ok, x.sig!);
  const view = (await app.inject({ method: "GET", url: `/v1/coins/${K1.mint}/keeper` })).json();
  assert.equal(view.totals.lamports.claimed, pending.toString());
  assert.ok(view.actions.some((x: any) => x.kind === "burn" && x.sig));
  const all = (await app.inject({ method: "GET", url: "/v1/keeper" })).json();
  assert.ok(all.coins.some((x: any) => x.ticker === "KEEP"));
  assert.ok(all.actions.length > 0);
});

test("keeper failures never block trading", async () => {
  await trade(alice, "KEEP", "buy", 0.2);
  const k = svc.keeper as any;
  const send = k.send;
  k.send = async () => { throw new Error("RPC down"); };
  try {
    const r = await svc.keeper.tick({ force: true });
    assert.ok(r, "the round returns instead of throwing");
    assert.match(String(svc.keeper.ledger(K1.mint).lastError), /RPC down/);
    assert.ok(actions(K1.mint).some((x) => x.kind === "error"));
    await trade(bob, "KEEP", "buy", 0.05); // trading carries on
  } finally {
    k.send = send;
  }
  const pending = await partnerPending(K1.pool);
  await svc.keeper.tick({ force: true });
  assert.equal(svc.keeper.ledger(K1.mint).lastError, null, "the next round recovers");
  assert.ok(actions(K1.mint).some((x) => x.kind === "claim" && x.ok && big(x.lamports!) === pending));
});

let K2: Awaited<ReturnType<typeof launch>>;
let k2c: Keypair, early1: Keypair, early2: Keypair, late: Keypair;

test("sniper-fee-burn: everything above the 1% base fee is burned; the creator is paid its share of the rest", async () => {
  k2c = wallet();
  K2 = await launch(k2c, "SNIPE", [
    { id: "sniper-fee-burn", params: { start: 50, seconds: 60 } },
    { id: "kingmaker", params: { pct: 20 } },
    { id: "first-buyer-rebate", params: { n: 10, pct: 20 } },
  ]);
  const cfg: any = (await snapshot(chain, K2.pool)).config;
  assert.equal(cfg.creatorTradingFeePercentage, 0);
  assert.equal(cfg.partnerPermanentLockedLiquidityPercentage, 40);
  early1 = wallet(50); early2 = wallet(50); late = wallet(80);
  // chain truth for the excess: the partner-fee accumulator's change in each window trade × (fee − 1%) / fee
  const bf = cfg.poolFees.baseFee;
  const h = getBaseFeeHandler(bf.cliffFeeNumerator, bf.firstFactor, bf.secondFactor, bf.thirdFactor, bf.baseFeeMode);
  const minNum = BigInt(h.getMinBaseFeeNumerator().toString());
  let truth = 0n;
  const windowTrade = async (who: Keypair, side: "buy" | "sell", amount: number) => {
    const before = await partnerPending(K2.pool);
    const r = await trade(who, "SNIPE", side, amount);
    const num = BigInt(h.getBaseFeeNumeratorFromIncludedFeeAmount(new BN(r.unix), new BN((await snapshot(chain, K2.pool)).activationPoint), 0 as any, new BN(1)).toString());
    truth += (((await partnerPending(K2.pool)) - before) * (num - minNum)) / num;
  };
  await windowTrade(early1, "buy", 0.5); // ~49% fee
  await windowTrade(early2, "buy", 0.3);
  await windowTrade(early1, "sell", Number(await raw(K2.mint, early1)) / 1e6 / 10);
  await svc.keeper.tick({ force: true });
  assert.equal(big(svc.keeper.ledger(K2.mint).claimed.curve), 0n, "no claim while the fee window is open");
  chain.warp(200);
  await trade(late, "SNIPE", "buy", 1); // 1% fee
  await svc.idle();
  const pending = await partnerPending(K2.pool);
  const supply0 = await supply(K2.mint);
  const creator0 = await lamports(k2c.publicKey);
  await svc.keeper.tick({ force: true });
  const L = svc.keeper.ledger(K2.mint);
  assert.equal(big(L.claimed.curve), pending);
  // the excess, recomputed independently from the two window trades: trading fee × 80% × (fee − 1%) / fee
  const excess = big(L.sniper.excess);
  assert.ok(excess > 0n && excess < pending);
  const diff = excess > truth ? excess - truth : truth - excess;
  assert.ok(diff <= 3n, `excess ${excess} vs chain ${truth}: within rounding (buys and a sell in the window)`);
  const lateFee = (1_000_000_000n * 10_000_000n) / 1_000_000_000n; // 1% of 1 SOL
  const lateTrading = lateFee - (lateFee * 20n) / 100n;
  assert.ok(pending - excess >= lateTrading, "the base part covers at least the post-window 1% trade");
  const sb = L.rules["sniper-fee-burn"];
  assert.equal(big(sb.accrued), excess);
  assert.equal(big(sb.burned) + big(sb.owed), excess);
  assert.ok(big(sb.burned) > 0n);
  assert.equal(supply0 - (await supply(K2.mint)), big(sb.burnedRaw));
  const base = pending - excess;
  const want = allocateCurve(base, 0, svc.keeper.routing(svc.store.getCoin(K2.mint)!).shares);
  assert.equal(big(L.platform), want.platform, "hookrz keeps 50 points of the base fees only");
  assert.ok(want.creator >= (base * 30n) / 100n && want.creator <= (base * 30n) / 100n + 3n, "50 − 20/2 − 20/2 = 30 points of the base fees");
  assert.equal(BigInt(await lamports(k2c.publicKey)) - BigInt(creator0), want.creator, "the creator got its 30 points of the base fees");
  assert.equal(big(L.rules.kingmaker.owed), want.rules.get("kingmaker"), "kingmaker accrues until graduation");
  assert.equal(big(L.rules["first-buyer-rebate"].owed), want.rules.get("first-buyer-rebate"));
});

test("kingmaker and first-buyer-rebate pay at graduation; after it the keeper claims its DAMM v2 position fees", async () => {
  // early2 sells everything before graduation: not a first buyer that still holds
  await trade(early2, "SNIPE", "sell", Number(await raw(K2.mint, early2)) / 1e6);
  await trade(late, "SNIPE", "buy", 3); // late becomes the biggest holder
  await graduate("SNIPE", K2.pool);
  await svc.keeper.tick({ force: true });
  const L = svc.keeper.ledger(K2.mint);
  assert.ok(L.state.graduatedAt);
  assert.equal(L.state.king, late.publicKey.toBase58(), "the top holder at migration (curve vault and creator excluded)");
  assert.ok(L.state.firstBuyers!.includes(early1.publicKey.toBase58()));
  assert.ok(!L.state.firstBuyers!.includes(early2.publicKey.toBase58()), "sold out before graduation");
  assert.ok(L.state.firstBuyers!.length <= 10);
  const km = paid(K2.mint, "kingmaker");
  assert.equal(km.get(late.publicKey.toBase58()), big(L.rules.kingmaker.paid));
  assert.equal(big(L.rules.kingmaker.owed), 0n);
  const fb = paid(K2.mint, "first-buyer-rebate");
  const each = [...fb.values()];
  assert.equal(new Set(each).size, 1, "an equal split");
  assert.deepEqual([...fb.keys()].sort(), [...L.state.firstBuyers!].sort());
  // DAMM v2: trade, then the keeper claims its locked partner position (40% of the LP) and splits it 20/20
  const positions = await svc.keeper.positions(await snapshot(chain, K2.pool));
  assert.equal(positions.length, 1, "the platform owns one (permanently locked) position");
  await trade(late, "SNIPE", "buy", 2);
  await trade(early1, "SNIPE", "sell", Number(await raw(K2.mint, early1)) / 1e6 / 2);
  const mark = lastId(K2.mint);
  const kingBefore = big(L.rules.kingmaker.paid);
  await svc.keeper.tick({ force: true });
  const L2 = svc.keeper.ledger(K2.mint);
  const amm = big(L2.claimed.amm);
  assert.ok(amm > 0n, "claimed the DAMM v2 position fees");
  const claim = actions(K2.mint).find((x) => x.kind === "claim" && x.detail?.source === "damm-v2")!;
  assert.equal(big(claim.lamports!), amm);
  const want = allocateLp(amm, 40, svc.keeper.routing(svc.store.getCoin(K2.mint)!).shares);
  assert.equal(big(L2.rules.kingmaker.paid) - kingBefore, want.rules.get("kingmaker"));
  assert.equal(paid(K2.mint, "kingmaker", mark).get(late.publicKey.toBase58()), want.rules.get("kingmaker"));
});

const KOTH = `rule "King of the Hill"
global king: key
global bar: num
global crowned_at: time

payout 50% to king

on buy {
  let need = fade(bar, over: 6h, since: crowned_at)
  if amount > need {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
  }
}

on sell, send {
  refuse if wallet == king and since(crowned_at) < 6h
    because "You're the king: no selling or sending for {6h - since(crowned_at)}"
}
`;

test("Hookscript stream: `payout 50% to king` pays the key in the global; buybacks wait for graduation", async () => {
  const creator = wallet(), king = wallet(50), rival = wallet(50);
  const H = await launch(creator, "KING", [{ id: "custom", params: { prompt: "koth" } }, { id: "buyback-burn", params: { pct: 20 } }], 0, { script: { source: KOTH } });
  const cfg: any = (await snapshot(chain, H.pool)).config;
  assert.equal(cfg.creatorTradingFeePercentage, 15, "50% + 20% of the creator's fees = 35 points routed");
  chain.warp(5);
  await trade(king, "KING", "buy", 0.5);
  await trade(rival, "KING", "buy", 0.05);
  await svc.idle();
  const pending = await partnerPending(H.pool);
  const k0 = await lamports(king.publicKey);
  await svc.keeper.tick({ force: true });
  const L = svc.keeper.ledger(H.mint);
  const want = allocateCurve(pending, 15, svc.keeper.routing(svc.store.getCoin(H.mint)!).shares);
  assert.equal(BigInt(await lamports(king.publicKey)) - BigInt(k0), want.rules.get("script:0"), "the king got 50% of the creator's fees");
  assert.equal(big(L.rules["script:0"].paid), want.rules.get("script:0"));
  // the keeper never buys a Hookscript coin on the curve (its buy would play the game: here, take the crown)
  assert.equal(big(L.rules["buyback-burn"].burned), 0n);
  assert.match(String(L.rules["buyback-burn"].note), /Hookscript/);
  assert.ok(actions(H.mint).some((x) => x.kind === "deferred" && x.rule === "buyback-burn"));
  await trade(rival, "KING", "buy", 0.01); // trading unaffected
  // after graduation the deferred buyback burns on DAMM v2
  chain.warp(7 * 3600);
  await graduate("KING", H.pool);
  const s0 = await supply(H.mint);
  await svc.keeper.tick({ force: true });
  const L2 = svc.keeper.ledger(H.mint);
  assert.ok(big(L2.rules["buyback-burn"].burned) > 0n, "burned after graduation");
  assert.equal(s0 - (await supply(H.mint)), big(L2.rules["buyback-burn"].burnedRaw));
  assert.ok(actions(H.mint).some((x) => x.kind === "burn" && x.ok && x.detail?.route === "Meteora DAMM v2"));
});

const POT = `rule "Big buy pot"
global winner: key
payout 40% to winner as pot
on buy {
  if value >= 0.2 sol { set winner = buyer }
}
`;

test("Hookscript pot: the whole pot goes to each new winner", async () => {
  const creator = wallet(), w1 = wallet(50), w2 = wallet(50), small = wallet(50);
  const H = await launch(creator, "POT", [{ id: "custom", params: { prompt: "pot" } }], 0, { script: { source: POT } });
  await trade(small, "POT", "buy", 0.1);
  await trade(w1, "POT", "buy", 0.3);
  await trade(small, "POT", "buy", 0.1);
  await svc.idle();
  const p1 = await partnerPending(H.pool);
  await svc.keeper.tick({ force: true });
  const pot1 = allocateCurve(p1, 30, svc.keeper.routing(svc.store.getCoin(H.mint)!).shares).rules.get("script:0")!;
  assert.equal(paid(H.mint, "script:0").get(w1.publicKey.toBase58()), pot1, "winner 1 takes the pot");
  // no new winner: the next round's share waits in the pot
  await trade(small, "POT", "buy", 0.1);
  await svc.idle();
  const p2 = await partnerPending(H.pool);
  await svc.keeper.tick({ force: true });
  const pot2 = allocateCurve(p2, 30, svc.keeper.routing(svc.store.getCoin(H.mint)!).shares).rules.get("script:0")!;
  assert.equal(big(svc.keeper.ledger(H.mint).rules["script:0"].owed), pot2, "still in the pot");
  await trade(w2, "POT", "buy", 0.25);
  await svc.idle();
  const p3 = await partnerPending(H.pool);
  await svc.keeper.tick({ force: true });
  const pot3 = allocateCurve(p3, 30, svc.keeper.routing(svc.store.getCoin(H.mint)!).shares).rules.get("script:0")!;
  assert.equal(paid(H.mint, "script:0").get(w2.publicKey.toBase58()), pot2 + pot3, "winner 2 takes everything since winner 1");
  assert.equal(svc.keeper.ledger(H.mint).state.pots["script:0"], w2.publicKey.toBase58());
});

const HATS = `rule "Party hats"
wallet hat: bool
payout 20% to wallets where hat
on buy:
  if coin.age < 60s { set wallet.hat = true }
on sell:
  set wallet.hat = false
`;

test("Hookscript split: wallets whose bool var is true (and still hold) split the share equally", async () => {
  const creator = wallet(), h1 = wallet(50), h2 = wallet(50), h3 = wallet(50), late = wallet(50);
  const H = await launch(creator, "HATS", [{ id: "custom", params: { prompt: "hats" } }], 0, { script: { source: HATS } });
  await trade(h1, "HATS", "buy", 0.2);
  await trade(h2, "HATS", "buy", 0.1);
  await trade(h3, "HATS", "buy", 0.1);
  chain.warp(120);
  await trade(late, "HATS", "buy", 0.3); // after 60 s: no hat
  await trade(h3, "HATS", "sell", Number(await raw(H.mint, h3)) / 1e6 / 2); // selling takes the hat off
  await svc.idle();
  const pending = await partnerPending(H.pool);
  await svc.keeper.tick({ force: true });
  const share = allocateCurve(pending, 40, svc.keeper.routing(svc.store.getCoin(H.mint)!).shares).rules.get("script:0")!;
  const got = paid(H.mint, "script:0");
  assert.deepEqual([...got.keys()].sort(), [h1.publicKey.toBase58(), h2.publicKey.toBase58()].sort());
  assert.equal(got.get(h1.publicKey.toBase58()), share / 2n);
  assert.equal(got.get(h2.publicKey.toBase58()), share / 2n);
});
