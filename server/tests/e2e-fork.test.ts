// End to end on the local fork: real Meteora DBC, DAMM v2, Token-2022 binaries + hookrz_engine.
// Every trade is quoted by the JS reference engine first, then forced on chain with minOut = 1 so the
// chain gives its own verdict; the two are recorded side by side (server/.runtime/e2e-results.json).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getTransferHook, unpackMint } from "@solana/spl-token";
import { boot } from "../src/boot.js";
import { signB64, type Hookrz } from "../src/service.js";
import { snapshot } from "../src/market.js";
import { liveHookProgram, HookrzEngine } from "../src/hook.js";
import { hookscript } from "../src/rules.js";
import { RUNTIME } from "../src/env.js";
import type { ForkChain } from "../src/fork.js";
import type { TxRecord } from "../src/chain.js";

let svc: Hookrz, chain: ForkChain, hookWhy: string;
const rows: any[] = [];
const results: any = { startedAt: new Date().toISOString(), steps: {} };
/** CU of the hook's Execute inside the transfer (not open_wallet or other top-level engine calls). */
const engineCu = (r: TxRecord, id: string) => {
  let inHook = false, cu: number | null = null;
  for (const l of r.logs) {
    if (l.startsWith(`Program ${id} invoke [`)) inHook = !l.endsWith("[1]");
    const m = new RegExp(`Program ${id} consumed (\\d+) of`).exec(l);
    if (m && inHook) cu = Math.max(cu ?? 0, Number(m[1]));
  }
  return cu;
};

before(async () => {
  const b = await boot({ db: ":memory:", forkState: null, thresholdSol: 10 });
  svc = b.svc;
  hookWhy = b.hookWhy;
  chain = svc.chain as ForkChain;
  console.log("hook program:", hookWhy);
  results.hook = hookWhy;
});
after(() => {
  mkdirSync(RUNTIME, { recursive: true });
  results.verdicts = rows;
  writeFileSync(`${RUNTIME}/e2e-results.json`, JSON.stringify(results, null, 2));
  console.log("\nJS engine vs chain:");
  console.table(rows.map((r) => ({ step: r.step, who: r.who, side: r.side, amount: r.amount, js: r.js, chain: r.chain, match: r.match, engineCU: r.engineCu, sig: r.sig.slice(0, 12) })));
});

const wallet = (sol = 50) => {
  const k = Keypair.generate();
  chain.fund(k.publicKey, sol);
  return k;
};
async function launch(creator: Keypair, ticker: string, stack: any[], creatorBuySol = 0, extra: any = {}) {
  const prep = await svc.prepareLaunch({ meta: { name: `${ticker} coin`, ticker, creatorBuySol }, stack, creator: creator.publicKey.toBase58(), ...extra });
  for (const t of prep.transactions) assert.ok(t.bytes <= 1232, `${t.label} is ${t.bytes} bytes`);
  const sub = await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, creator)) });
  return { prep, sub, mint: new PublicKey(prep.mint!), coin: svc.coin(ticker)! };
}
/** Quote with the JS engine, then send the real prepared transaction (minOut 1) and compare verdicts. */
async function trade(step: string, who: Keypair, label: string, ticker: string, side: "buy" | "sell", amount: number) {
  const q = await svc.quote({ ticker, side, amount, wallet: who.publicKey.toBase58() });
  const prep = await svc.prepareTrade({ ticker, side, amount, wallet: who.publicKey.toBase58(), minOut: "1" });
  const r = await svc.sendTx(signB64(prep.transaction, who));
  const js = q.ok ? "ok" : String(q.code);
  const onchain = r.ok ? "ok" : String(r.code);
  const engine = svc.hook!.id.toBase58();
  const row = { step, who: label, side, amount, js, chain: onchain, match: js === onchain, engineCu: engineCu(r, engine), units: r.units, sig: r.signature, stage: q.stage, out: q.out, refusedBy: q.refusedBy, opened: prep.openedRecords };
  rows.push(row);
  return { q, r, prep, row };
}
const fair = [{ id: "snipe-shield" }, { id: "anti-bundle" }, { id: "rising-max" }, { id: "sniper-fee-burn" }];

let FAIR: Awaited<ReturnType<typeof launch>>;
let A: Keypair | null = null, B: Keypair | null = null;
const alice = () => (A ??= wallet(100));
const bob = () => (B ??= wallet(100));

test("1. launch a Fair Launch coin (snipe-shield, anti-bundle, rising-max, sniper-fee-burn)", async () => {
  assert.ok(svc.hook instanceof HookrzEngine, `needs hookrz_engine, got ${hookWhy}`);
  FAIR = await launch(alice(), "FAIR", fair, 0.005);
  const { accounts: [m] } = await chain.read([FAIR.mint]);
  const mint = unpackMint(FAIR.mint, m as any, TOKEN_2022_PROGRAM_ID);
  assert.equal(getTransferHook(mint)!.programId.toBase58(), svc.hook!.id.toBase58());
  assert.equal(mint.mintAuthority, null);
  const stack = await svc.hook!.readStack(chain, FAIR.mint);
  assert.ok(stack && stack.flags & 1, "stack armed");
  assert.deepEqual(stack.slots.map((s) => s.block), ["snipe-shield", "anti-bundle", "rising-max"]);
  const cfg = await snapshot(chain, new PublicKey(FAIR.prep.pool!));
  const t = svc.trades("FAIR");
  assert.equal(t.length, 1, "creator buy indexed");
  assert.equal(t[0].kind, "buy");
  assert.ok(t[0].ok);
  results.steps.launch = { mint: FAIR.prep.mint, pool: FAIR.prep.pool, txs: FAIR.prep.transactions.map((x: any) => ({ label: x.label, bytes: x.bytes })), signatures: FAIR.sub.signatures, creatorBuyTokens: t[0].amount, stage: cfg.stage, feeScheduler: FAIR.prep.curve.feeScheduler };
});

test("2. an ordinary buy lands", async () => {
  const q = await svc.quote({ ticker: "FAIR", side: "buy", amount: 1, wallet: bob().publicKey.toBase58() });
  assert.equal(q.ok, false, "1 SOL in the first minute is a snipe");
  const amount = Math.floor(q.maxAllowed * 0.8 * 1e6) / 1e6;
  const { r, row } = await trade("2 ordinary buy", bob(), "bob", "FAIR", "buy", amount);
  assert.ok(r.ok, `buy failed: ${r.error}`);
  assert.ok(row.match);
  results.steps.ordinaryBuy = { sig: r.signature, sol: amount, tokens: row.out };
});

test("3. a big buy inside the snipe window is refused with 6001 (JS engine agrees)", async () => {
  const carol = wallet(100);
  const { r, q, row } = await trade("3 snipe", carol, "carol", "FAIR", "buy", 0.5);
  assert.equal(q.code, 6001);
  assert.equal(r.ok, false);
  assert.equal(r.code, 6001);
  assert.ok(r.logs.some((l) => /SnipeWindow/.test(l)), "engine log names the error");
  await svc.idle();
  const refused = svc.trades("FAIR").find((x) => x.sig === r.signature)!;
  assert.equal(refused.ok, false);
  assert.equal(refused.by, "snipe-shield");
  assert.equal(refused.code, 6001);
  results.steps.snipeRefused = { sig: r.signature, code: r.code, indexedAs: refused.by, row };
});

test("3b. anti-bundle: a third buy in the same slot is refused with 6002", async () => {
  chain.autoAdvance = false; // keep every buy in one slot
  try {
    const out: any[] = [];
    for (const name of ["b1", "b2", "b3"]) out.push(await trade("3b bundle", wallet(5), name, "FAIR", "buy", 0.002));
    assert.deepEqual(out.map((x) => (x.r.ok ? "ok" : x.r.code)), ["ok", "ok", 6002]);
    assert.equal(out[2].q.code, 6002, "JS engine sees the same slot count");
    results.steps.antiBundle = out.map((x) => ({ sig: x.r.signature, slot: x.r.slot, ok: x.r.ok, code: x.r.code }));
  } finally {
    chain.autoAdvance = true;
    chain.warp(1);
  }
});

test("4. warp the clock past the snipe window: a sell lands; rising-max still caps big buys (6004)", async () => {
  chain.warp(120);
  const bal = svc.holders("FAIR").find((h: any) => h.wallet === bob().publicKey.toBase58())!;
  const tokens = Math.floor((Number(bal.raw) / 1e6) * 0.5);
  const { r, row } = await trade("4 sell after warp", bob(), "bob", "FAIR", "sell", tokens);
  assert.ok(r.ok, `sell failed: ${r.error}`);
  assert.ok(row.match);
  const whale = wallet(100);
  const big = await trade("4 rising-max", whale, "whale", "FAIR", "buy", 2);
  assert.equal(big.r.code, 6004);
  assert.equal(big.q.code, 6004);
  results.steps.sellAfterWarp = { sig: r.signature, tokens, risingMaxRefusal: big.r.signature };
});

const KOTH_SRC = `rule "King of the Hill"
global king: key
global bar: num
global crowned_at: time

payout 50% to king

on buy {
  let need = max(fade(bar, over: 6h, since: crowned_at), 1)
  if amount > need {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
  }
}

on sell, send {
  refuse if wallet == king and since(crowned_at) < 6h
    because "The king can't sell or send for {6h - since(crowned_at)}: someone has to outbid you"
}
`;

test("5. a Hookscript King-of-the-Hill coin refuses the king's sell", async (t) => {
  const lib = await hookscript();
  if (!lib?.compile) {
    t.skip("waiting on HOOKSCRIPT: hookscript/compiler does not export compile() yet (the interpreter adapter is wired)");
    results.steps.koth = { skipped: "HOOKSCRIPT compile() not exported yet" };
    return;
  }
  const creator = wallet(50), king = wallet(50), rival = wallet(50);
  const L = await launch(creator, "KOTH", [{ id: "custom", params: { prompt: "King of the Hill" } }], 0, { script: { source: KOTH_SRC } });
  chain.warp(5);
  const crown = await trade("5 koth crown", king, "king", "KOTH", "buy", 0.5);
  assert.ok(crown.r.ok, `${crown.r.error} ${crown.r.logs.slice(-4).join(" | ")}`);
  const small = await trade("5 koth small", rival, "rival", "KOTH", "buy", 0.05);
  assert.ok(small.r.ok, `${small.r.error}`);
  chain.warp(60);
  const held = svc.holders("KOTH").find((h: any) => h.wallet === king.publicKey.toBase58())!;
  const dump = await trade("5 koth king sells", king, "king", "KOTH", "sell", Math.floor(Number(held.raw) / 1e6 / 2));
  assert.equal(dump.q.code, 6128, "the Hookscript interpreter refuses the king's sell");
  assert.equal(dump.r.code, 6128, "the engine refuses it on chain");
  await svc.idle();
  const indexed = svc.trades("KOTH").find((x: any) => x.sig === dump.r.signature)!;
  assert.equal(indexed.by, "custom");
  assert.match(String(indexed.msg), /king/i, "the refusal carries the script's own reason");
  assert.match(String(dump.q.message), /king/i, "so does the quote");
  const ok = await trade("5 koth rival sells", rival, "rival", "KOTH", "sell", 1000);
  assert.ok(ok.r.ok, `${ok.r.error}`);
  chain.warp(6 * 3600 + 60);
  const later = await trade("5 koth king after 6h", king, "king", "KOTH", "sell", 1000);
  assert.ok(later.r.ok, `${later.r.error} ${later.r.logs.slice(-4).join(" | ")}`);
  results.steps.koth = { mint: L.prep.mint, crown: crown.r.signature, refused6128: dump.r.signature, engineLog: dump.r.logs.find((l) => /king|Custom/i.test(l)) ?? null, kingSellsAfter6h: later.r.signature };
});

test("5b. a script too big for the launch tx is staged with write_script; an APP-flag script resolves the instructions sysvar", async (t) => {
  const lib = await hookscript();
  if (!lib?.compile) return t.skip("waiting on HOOKSCRIPT compile()");
  // ~12 never-firing rules with long reasons: well past what fits next to the pool instruction
  const rules = Array.from({ length: 7 }, (_, i) => `  refuse if amount > ${900_000_000 + i}000000 and coin.age < ${i + 1}m\n    because "Rule ${i + 1}: this sentence is only here to make the compiled script long enough to need staging"`).join("\n");
  const big = `rule "Long script"\non buy, sell, send {\n${rules}\n}\n`;
  const creator = wallet(50), buyer = wallet(50);
  const L = await launch(creator, "BIGS", [{ id: "custom", params: { prompt: "long" } }, { id: "max-wallet" }], 0.001, { script: { source: big } });
  const labels = L.prep.transactions.map((x: any) => x.label);
  assert.ok(labels.some((l: string) => /write_script/.test(l)), `expected staged chunks, got ${labels.join(" | ")}`);
  assert.ok(labels.some((l: string) => /seals the staged script/.test(l)));
  const st = await svc.hook!.readStack(chain, L.mint);
  assert.ok(st?.script, "Script account linked from the Stack");
  const b = await trade("5b staged-script buy", buyer, "buyer", "BIGS", "buy", 0.01);
  assert.ok(b.r.ok, `${b.r.error} ${b.r.logs.slice(-3).join(" | ")}`);
  // APP flag: the meta list adds the instructions sysvar; the creator buy in the launch tx resolves it offline
  const app = await launch(wallet(50), "APPF", [{ id: "custom", params: { prompt: "app" } }], 0.001, { script: { source: `rule "Curve only for the first 5 minutes"\non buy:\n  refuse if coin.age < 5m and transfer.app == program("jupiter")\n    because "For the first 5 minutes, buy on the curve directly"\n` } });
  assert.ok(svc.trades("APPF").some((x: any) => x.kind === "buy" && x.ok), "creator buy landed with the instructions sysvar resolved");
  const ab = await trade("5b app-flag buy", buyer, "buyer", "APPF", "buy", 0.01);
  assert.ok(ab.r.ok, `${ab.r.error} ${ab.r.logs.slice(-3).join(" | ")}`);
  results.steps.stagedScript = { launchTxs: L.prep.transactions.map((x: any) => ({ label: x.label, bytes: x.bytes })), buy: b.r.signature, appFlagLaunch: app.sub.signatures, appFlagBuy: ab.r.signature };
});

test("6. fill the curve: it graduates, the hook is retired, trades continue on DAMM v2", async () => {
  chain.warp(13 * 3600); // rising-max is fully open (5%) after 12h
  let i = 0;
  const buyers: Keypair[] = [];
  while ((await snapshot(chain, new PublicKey(FAIR.prep.pool!))).stage === "curve" && i++ < 60) {
    const w = wallet(50);
    buyers.push(w);
    const q = await svc.quote({ ticker: "FAIR", side: "buy", amount: 5, wallet: w.publicKey.toBase58() });
    const amount = q.ok ? 5 : Math.floor(q.maxAllowed * 0.97 * 1e6) / 1e6;
    const { r } = await trade("6 fill", w, `filler${i}`, "FAIR", "buy", amount);
    assert.ok(r.ok, `fill buy ${i} failed: ${r.error} ${r.logs.slice(-4).join(" | ")}`);
  }
  await svc.idle();
  await new Promise((f) => setTimeout(f, 50));
  await svc.idle();
  const hookAfter = await liveHookProgram(chain, FAIR.mint);
  assert.equal(hookAfter, null, "DBC retired the transfer hook in the graduating swap");
  let s = await snapshot(chain, new PublicKey(FAIR.prep.pool!));
  for (let k = 0; k < 20 && s.stage !== "graduated"; k++) {
    await new Promise((f) => setTimeout(f, 100));
    s = await snapshot(chain, new PublicKey(FAIR.prep.pool!));
  }
  assert.equal(s.stage, "graduated", "keeper migrated the pool to DAMM v2");
  const mig = svc.keeper.log.find((a) => a.kind === "migrate" && a.mint === FAIR.prep.mint)!;
  assert.ok(mig?.signature);
  const post = await trade("6 post-grad buy", buyers[0], "filler1", "FAIR", "buy", 0.5);
  assert.ok(post.r.ok, `post-graduation buy failed: ${post.r.error}`);
  assert.equal(post.q.stage, "graduated");
  const held = svc.holders("FAIR").find((h: any) => h.wallet === buyers[1].publicKey.toBase58())!;
  const sell = await trade("6 post-grad sell", buyers[1], "filler2", "FAIR", "sell", Math.floor(Number(held.raw) / 1e6 / 2));
  assert.ok(sell.r.ok, `post-graduation sell failed: ${sell.r.error}`);
  assert.equal(svc.coin("FAIR")!.phase, "graduated");
  results.steps.graduation = { fillBuys: i, migration: mig.signature, ammPool: s.ammId.toBase58(), postGradBuy: post.r.signature, postGradSell: sell.r.signature };
});

test("7. wallet records: opened by the router, 6142 while live, close_wallet refunds rent after graduation", async () => {
  const dave = wallet(50), erin = wallet(100);
  const stack = [{ id: "sell-cooldown", params: { minutes: 15 } }, { id: "sandwich-guard" }];
  const L = await launch(dave, "REC", stack, 0);
  const hook = svc.hook as HookrzEngine;
  const buy = await trade("7 record buy", erin, "erin", "REC", "buy", 0.02);
  assert.ok(buy.r.ok, `${buy.r.error}`);
  assert.equal(buy.prep.openedRecords.length, 1, "router opened erin's Wallet record inside the buy");
  const ata = getAssociatedTokenAddressSync(L.mint, erin.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const rec = await hook.readWallet(chain, L.mint, ata);
  assert.ok(rec && rec.lastBuySlot != null, "record written by the hook");
  // sandwich-guard: selling in the same breath is refused
  const flip = await trade("7 sandwich", erin, "erin", "REC", "sell", 1000);
  assert.equal(flip.r.code, 6005);
  assert.equal(flip.q.code, 6005);
  chain.warp(5);
  const s1 = await trade("7 first sell", erin, "erin", "REC", "sell", 1000);
  assert.ok(s1.r.ok, `${s1.r.error}`);
  const s2 = await trade("7 cooldown", erin, "erin", "REC", "sell", 1000);
  assert.equal(s2.r.code, 6009);
  assert.equal(s2.q.code, 6009);
  // closing while the hook is live is refused
  const early = new Transaction().add(hook.closeWalletIx(L.mint, ata, erin.publicKey));
  early.feePayer = erin.publicKey;
  early.recentBlockhash = (await chain.blockhash()).blockhash;
  early.sign(erin);
  const e = await chain.send(early.serialize());
  assert.equal(e.code, 6142);
  // graduate it
  chain.warp(3600);
  for (let i = 0; i < 40 && (await snapshot(chain, new PublicKey(L.prep.pool!))).stage === "curve"; i++) {
    const w = wallet(50);
    const { r } = await trade("7 fill", w, `rfill${i}`, "REC", "buy", 5);
    assert.ok(r.ok, `${r.error}`);
  }
  await svc.idle();
  assert.equal(await liveHookProgram(chain, L.mint), null);
  const before = (await chain.read([erin.publicKey])).accounts[0]!.lamports;
  const recKey = hook.walletPda(L.mint, ata);
  const rent = (await chain.read([recKey])).accounts[0]!.lamports;
  const close = new Transaction().add(hook.closeWalletIx(L.mint, ata, erin.publicKey));
  const cranker = wallet(1); // anyone may crank it; the rent goes to the payer recorded at open
  close.feePayer = cranker.publicKey;
  close.recentBlockhash = (await chain.blockhash()).blockhash;
  close.sign(cranker);
  const c = await chain.send(close.serialize());
  assert.ok(c.ok, `close_wallet failed: ${c.error} ${c.logs.slice(-3).join(" | ")}`);
  const afterBal = (await chain.read([erin.publicKey])).accounts[0]!.lamports;
  assert.equal(afterBal - before, rent, "the record's rent went back to erin");
  assert.equal((await chain.read([recKey])).accounts[0], null);
  const cs = new Transaction().add(hook.closeStackIx(L.mint, dave.publicKey));
  cs.feePayer = cranker.publicKey;
  cs.recentBlockhash = (await chain.blockhash()).blockhash;
  cs.sign(cranker);
  const sres = await chain.send(cs.serialize());
  assert.ok(sres.ok, `close_stack failed: ${sres.error} ${sres.logs.slice(-3).join(" | ")}`);
  results.steps.walletRecords = { mint: L.prep.mint, openedIn: buy.r.signature, sandwich6005: flip.r.signature, cooldown6009: s2.r.signature, early6142: e.signature, closeWallet: c.signature, rentRefunded: rent, closeStack: sres.signature };
});
