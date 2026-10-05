// The HTTP API end to end on a fresh fork: launch (prepare → sign → submit via relay), remix lineage,
// quote, trade (prepare → sign → relay), reads, validate, simulate, and the live event stream.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { boot } from "../src/boot.js";
import { buildApp } from "../src/app.js";
import { signB64, type Hookrz } from "../src/service.js";
import type { ForkChain } from "../src/fork.js";

let svc: Hookrz, app: ReturnType<typeof buildApp>;
const post = async (url: string, body: any) => {
  const r = await app.inject({ method: "POST", url, payload: body });
  return { status: r.statusCode, body: r.json() };
};
const get = async (url: string) => {
  const r = await app.inject({ method: "GET", url });
  return { status: r.statusCode, body: r.json() };
};
const creator = Keypair.generate(), trader = Keypair.generate(), remixer = Keypair.generate();

before(async () => {
  svc = (await boot({ db: ":memory:", forkState: null, thresholdSol: 10 })).svc;
  app = buildApp(svc);
  for (const k of [creator, trader, remixer]) await post("/v1/fork/airdrop", { wallet: k.publicKey.toBase58(), sol: 50 });
});

async function launchVia(who: Keypair, ticker: string, stack: any[], parent: string | null = null) {
  // the site prepares a preview before the wallet connects, then again with it: the mint must not change
  const meta = { name: `${ticker} coin`, ticker, desc: "api test", creatorBuySol: 0.01 };
  const pre = await post("/v1/launch/prepare", { meta, stack });
  const prep = await post("/v1/launch/prepare", { meta, stack, creator: who.publicKey.toBase58(), parent, mint: pre.body.mint });
  assert.equal(prep.body.mint, pre.body.mint);
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  assert.ok(prep.body.transactions.every((t: any) => t.base64 && t.bytes <= 1232));
  const signed = prep.body.transactions.map((t: any) => signB64(t.base64, who));
  const sub = await post("/v1/launch/submit", { prepared: { ...prep.body, signed } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return { prep: prep.body, sub: sub.body };
}

test("launch through the API, then read it back", async () => {
  // preview without a wallet: sizes and steps, no transactions to sign
  const preview = await post("/v1/launch/prepare", { meta: { name: "Preview", ticker: "PREV" }, stack: [{ id: "max-wallet" }] });
  assert.equal(preview.status, 200);
  assert.ok(preview.body.mint, "a preview already has its mint address");
  assert.ok(preview.body.transactions.every((t: any) => !t.base64), "nothing to sign without a wallet");
  assert.ok(preview.body.txBytes > 0 && preview.body.instructions.length === 5);

  const { sub } = await launchVia(creator, "APIX", [{ id: "snipe-shield" }, { id: "max-wallet" }, { id: "lp-lock" }, { id: "locked-metadata" }]);
  assert.equal(sub.ticker, "APIX");
  const coin = await get("/v1/coins/APIX");
  assert.equal(coin.status, 200);
  for (const k of ["ticker", "name", "mint", "progress", "mcapUsd", "vol24Usd", "holders", "trades", "checked", "refused", "remixes", "phase", "families", "budget", "stack", "minutesAgo"]) assert.ok(k in coin.body, `coin.${k}`);
  assert.equal(coin.body.phase, "curve");
  assert.equal((await get(`/v1/coins/${coin.body.mint}`)).body.ticker, "APIX", "by mint too");
  const missing = await app.inject({ method: "GET", url: "/v1/coins/NOPE?optional=1" });
  assert.equal(missing.statusCode, 200);
  assert.equal(missing.json(), null, "ticker check answers null, not 404");
  assert.equal((await get("/v1/coins/NOPE")).status, 404);
  const list = await get("/v1/coins?sort=new");
  assert.equal(list.body.length, 1);
  const taken = await post("/v1/launch/prepare", { meta: { name: "dupe", ticker: "APIX" }, stack: [], creator: creator.publicKey.toBase58() });
  assert.equal(taken.status, 400);
  assert.equal(taken.body.error, "TICKER_TAKEN");
});

test("remix: a child stack records its parent; lineage and stacks reflect it", async () => {
  await launchVia(remixer, "APIKID", [{ id: "snipe-shield", params: { window: 120 } }, { id: "max-wallet" }], "APIX");
  const kid = (await get("/v1/coins/APIKID")).body;
  assert.equal(kid.parent, "APIX");
  const stack = await svc.hook!.readStack(svc.chain, new (await import("@solana/web3.js")).PublicKey(kid.mint));
  assert.equal(stack!.parentAuthor, creator.publicKey.toBase58(), "parent author recorded on chain");
  const lin = (await get("/v1/stacks/APIKID/lineage")).body;
  assert.equal(lin.coin.ticker, "APIX");
  assert.equal(lin.children[0].coin.ticker, "APIKID");
  assert.deepEqual(lin.children[0].diff.tuned, ["snipe-shield"]);
  const stacks = (await get("/v1/stacks")).body;
  assert.equal(stacks[0].ticker, "APIX");
  assert.equal(stacks[0].remixCount, 1);
});

test("quote, trade/prepare, relay, trades, holders, stream", async () => {
  const events: any[] = [];
  const off = (e: any) => events.push(e);
  svc.events.on("event", off);
  const q = await post("/v1/quote", { mint: "APIX", side: "buy", amount: 1, wallet: trader.publicKey.toBase58() });
  assert.equal(q.status, 200);
  assert.equal(q.body.ok, false);
  assert.equal(q.body.code, 6001);
  for (const k of ["ok", "out", "price", "priceUsd", "verdicts", "refusedBy", "code", "message", "maxAllowed"]) assert.ok(k in q.body, `quote.${k}`);
  const amount = Math.floor(q.body.maxAllowed * 0.9 * 1e6) / 1e6;
  const prep = await post("/v1/trade/prepare", { mint: "APIX", side: "buy", amount, wallet: trader.publicKey.toBase58() });
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const sent = await post("/v1/tx/send", { tx: signB64(prep.body.transaction, trader) });
  assert.equal(sent.body.ok, true, JSON.stringify(sent.body));
  // a refused one, sent anyway: indexed as a refusal with the block that refused it
  const bad = await post("/v1/trade/prepare", { mint: "APIX", side: "buy", amount: 1, wallet: trader.publicKey.toBase58(), minOut: "1" });
  const refused = await post("/v1/tx/send", { tx: signB64(bad.body.transaction, trader) });
  assert.equal(refused.body.ok, false);
  assert.equal(refused.body.code, 6001);
  assert.equal(refused.body.explain.by, "snipe-shield");
  const trades = (await get("/v1/coins/APIX/trades")).body;
  assert.ok(trades.some((t: any) => t.ok && t.kind === "buy" && t.wallet === trader.publicKey.toBase58()));
  assert.ok(trades.some((t: any) => !t.ok && t.by === "snipe-shield" && t.code === 6001));
  for (const k of ["t", "kind", "amount", "sol", "ok", "verdicts", "wallet", "sig"]) assert.ok(k in trades[0], `trade.${k}`);
  const holders = (await get("/v1/coins/APIX/holders")).body;
  assert.ok(holders.some((h: any) => h.wallet === trader.publicKey.toBase58() && h.share > 0));
  const coin = (await get("/v1/coins/APIX")).body;
  assert.equal(coin.refused, 1);
  assert.ok(events.some((e) => e.type === "trade" && e.ok) && events.some((e) => e.type === "trade" && !e.ok && e.code === 6001));
  svc.events.off("event", off);
});

test("a launch whose second transaction never landed resumes with the same mint", async () => {
  const who = Keypair.generate();
  await post("/v1/fork/airdrop", { wallet: who.publicKey.toBase58(), sol: 10 });
  const meta = { name: "Resume", ticker: "RESUME", creatorBuySol: 0.005 };
  const stack = [{ id: "snipe-shield" }, { id: "hold-timer" }];
  const first = (await post("/v1/launch/prepare", { meta, stack, creator: who.publicKey.toBase58() })).body;
  assert.equal(first.transactions.length, 2);
  const r1 = await post("/v1/tx/send", { tx: signB64(first.transactions[0].base64, who) });
  assert.equal(r1.body.ok, true);
  // the wallet closed before signing the second one; the site prepares again with the same mint
  const again = (await post("/v1/launch/prepare", { meta, stack, creator: who.publicKey.toBase58(), mint: first.mint })).body;
  assert.equal(again.mint, first.mint);
  assert.equal(again.transactions.length, 1, "only init_stack + creator buy remain");
  const sub = await post("/v1/launch/submit", { mint: again.mint, signed: again.transactions.map((t: any) => signB64(t.base64, who)) });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal((await get("/v1/coins/RESUME")).body.stage, "curve");
});

test("hookscript draft, and a Custom block launched from its English prompt alone", async () => {
  const t0 = Date.now();
  const d = await post("/v1/hookscript/draft", { prompt: "No single sell over a quarter of your bag in your first 2h" });
  assert.equal(d.status, 200, JSON.stringify(d.body).slice(0, 300));
  assert.equal(d.body.ok, true);
  for (const k of ["prompt", "script", "cu", "fuzz", "reviewed"]) assert.ok(k in d.body, `draft.${k}`);
  assert.equal(d.body.fuzz.panics, 0);
  const draftMs = Date.now() - t0;
  const who = Keypair.generate();
  await post("/v1/fork/airdrop", { wallet: who.publicKey.toBase58(), sol: 10 });
  const prep = await post("/v1/launch/prepare", { meta: { name: "Drafted", ticker: "DRAFT" }, stack: [{ id: "custom", params: { prompt: "No single sell over a quarter of your bag in your first 2h" } }], creator: who.publicKey.toBase58() });
  assert.equal(prep.status, 200, JSON.stringify(prep.body).slice(0, 300));
  const sub = await post("/v1/launch/submit", { mint: prep.body.mint, signed: prep.body.transactions.map((t: any) => signB64(t.base64, who)) });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const coin = (await get("/v1/coins/DRAFT")).body;
  assert.ok(coin.script?.source?.includes("rule"), "the drafted source is stored with the coin");
  console.log(`draft ${draftMs} ms, provider ${d.body.provider}, ${d.body.bytes} B, fuzz refused ${d.body.fuzz.refusedPct}%`);
});

test("validate, simulate, creator, health, blocks", async () => {
  const v = (await post("/v1/stacks/validate", { stack: [{ id: "max-wallet" }, { id: "rising-max" }] })).body;
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w: any) => /overlap/.test(w.text)));
  const sim = (await post("/v1/stacks/simulate", { stack: [{ id: "snipe-shield" }], seed: 7 })).body;
  assert.ok(sim.withStack.refused > 0 && sim.noRules.refused === 0);
  const cr = (await get(`/v1/creators/${creator.publicKey.toBase58()}`)).body;
  assert.equal(cr.coins.length, 1);
  assert.equal(cr.remixesOfMine.length, 1);
  const h = (await get("/v1/health")).body;
  assert.equal(h.mode, "fork");
  assert.equal(h.hook.kind, "hookrz");
  assert.ok((await get("/v1/blocks")).body.length > 20);
  const meta = await get(`/v1/meta/${(await get("/v1/coins/APIX")).body.mint}.json`);
  assert.equal(meta.body.symbol, "APIX");
  void (svc.chain as ForkChain);
});
