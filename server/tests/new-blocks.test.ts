// The six hook blocks added to hookrz_engine on 2026-10-04, end to end on the local fork with the real Meteora DBC:
// launch through the API, quote with the JS reference engine, then send the real prepared swap (minOut 1) so the chain
// gives its own verdict. Blocklist / Allowlist Phase (marks written by the creator), Seasoned Sells, Hourly Outflow Cap,
// Token Gate ($BONK stand-in mint on the fork) and Chapters.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { boot } from "../src/boot.js";
import { signB64, type Hookrz } from "../src/service.js";
import { buildApp } from "../src/app.js";
import { forkFundGate, gateMints } from "../src/marks.js";
import type { ForkChain } from "../src/fork.js";

let svc: Hookrz, chain: ForkChain;
before(async () => {
  svc = (await boot({ db: ":memory:", forkState: null, thresholdSol: 10 })).svc;
  chain = svc.chain as ForkChain;
});
const wallet = (sol = 50) => {
  const k = Keypair.generate();
  chain.fund(k.publicKey, sol);
  return k;
};
async function launch(creator: Keypair, ticker: string, stack: any[], creatorBuySol = 0, extra: any = {}) {
  const prep = await svc.prepareLaunch({ meta: { name: `${ticker} coin`, ticker, creatorBuySol }, stack, creator: creator.publicKey.toBase58(), ...extra });
  for (const t of prep.transactions) assert.ok(t.bytes <= 1232, `${t.label} is ${t.bytes} bytes`);
  await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, creator)) });
  return prep;
}
/** JS quote, then the real swap; the two verdicts must agree. Returns the chain's verdict ("ok" or the code). */
async function trade(who: Keypair, ticker: string, side: "buy" | "sell", amount: number) {
  const q = await svc.quote({ ticker, side, amount, wallet: who.publicKey.toBase58() });
  const prep = await svc.prepareTrade({ ticker, side, amount, wallet: who.publicKey.toBase58(), minOut: "1" });
  assert.ok(prep.bytes <= 1232, `swap is ${prep.bytes} bytes`);
  const r = await svc.sendTx(signB64(prep.transaction, who));
  const js = q.ok ? "ok" : String(q.code), onchain = r.ok ? "ok" : String(r.code);
  assert.equal(js, onchain, `${ticker} ${side} ${amount}: JS ${js} (${q.message ?? ""}) vs chain ${onchain} (${r.error ?? ""})\n${r.logs.slice(-6).join("\n")}`);
  return { verdict: onchain, q, r };
}
const tokensOf = (ticker: string, who: Keypair) => Number(svc.holders(ticker).find((h: any) => h.wallet === who.publicKey.toBase58())?.raw ?? 0) / 1e6;
async function marks(ticker: string, creator: Keypair, list: any[]) {
  const app = buildApp(svc);
  const res = await app.inject({ method: "POST", url: `/v1/coins/${ticker}/marks/prepare`, payload: { creator: creator.publicKey.toBase58(), marks: list } });
  const body = res.json();
  if (res.statusCode !== 200) return body;
  for (const t of body.transactions) {
    const r = await svc.sendTx(signB64(t.base64, creator));
    assert.ok(r.ok, `set_mark: ${r.error}\n${r.logs.slice(-5).join("\n")}`);
  }
  return body;
}

test("Token Gate + Chapters (Members Club): gated buys, chapter caps, a refused $HOOKRZ gate", async () => {
  const bonk = new PublicKey(gateMints()["$BONK"]);
  const creator = wallet(), a = wallet(), b = wallet();
  // $HOOKRZ has no mint: refused at prepare with a clear error.
  await assert.rejects(svc.prepareLaunch({ meta: { name: "x", ticker: "HKZG" }, stack: [{ id: "token-gate", params: { ticker: "$HOOKRZ", min: 10 } }], creator: creator.publicKey.toBase58() }), (e: any) => e.code === "GATE_NOT_LIVE");
  forkFundGate(chain, bonk, creator.publicKey, 100_000n * 100_000n); // 100,000 BONK (5 decimals)
  const club = [{ id: "token-gate", params: { ticker: "$BONK", min: 100000 } }, { id: "chapters", params: { n: 3, first: 0.5 } }, { id: "max-wallet", params: { pct: 5 } }, { id: "locked-metadata" }];
  await launch(creator, "CLUB", club, 0.001);
  const stack = await svc.hook!.readStack(chain, new PublicKey(svc.coin("CLUB")!.mint));
  assert.equal(stack!.gate!.mint, bonk.toBase58());
  assert.equal(stack!.gate!.minRaw, 10_000_000_000n);
  assert.equal((await trade(a, "CLUB", "buy", 0.001)).verdict, "6017", "no BONK");
  forkFundGate(chain, bonk, a.publicKey, 10_000_000_000n - 1n);
  assert.equal((await trade(a, "CLUB", "buy", 0.001)).verdict, "6017", "one raw unit short");
  forkFundGate(chain, bonk, a.publicKey, 10_000_000_000n);
  assert.equal((await trade(a, "CLUB", "buy", 0.001)).verdict, "ok", "holds the gate");
  // Chapter 1 caps a wallet at 0.5% of supply: the quote's largest allowed buy lands, a bigger one is refused on chain too.
  const q = await svc.quote({ ticker: "CLUB", side: "buy", amount: 1, wallet: a.publicKey.toBase58() });
  assert.equal(q.code, 6018);
  assert.equal((await trade(a, "CLUB", "buy", 1)).verdict, "6018", "over the chapter-1 cap");
  assert.equal((await trade(a, "CLUB", "buy", Math.floor(q.maxAllowed * 0.98 * 1e6) / 1e6)).verdict, "ok", "up to the cap");
  assert.ok(tokensOf("CLUB", a) <= 5_000_000 && tokensOf("CLUB", a) > 4_500_000, `a holds ${tokensOf("CLUB", a)}`);
  // Sells are never gated (b has no BONK and never needs it to sell; a sells part of its bag).
  assert.equal((await trade(a, "CLUB", "sell", 1000)).verdict, "ok");
  assert.equal((await trade(b, "CLUB", "buy", 0.001)).verdict, "6017");
});

test("Blocklist + Allowlist Phase: marks written at launch and by the creator; the list freezes", async () => {
  const creator = wallet(), x = wallet(), y = wallet(), z = wallet();
  const stack = [{ id: "blocklist", params: { lockAt: "after 24h" } }, { id: "allowlist-phase", params: { minutes: 30 } }];
  // Marks for a coin without the block are refused at prepare.
  await assert.rejects(svc.prepareLaunch({ meta: { name: "n", ticker: "NOBL" }, stack: [{ id: "max-wallet" }], marks: [{ owner: x.publicKey.toBase58(), blocked: true }], creator: creator.publicKey.toBase58() }), (e: any) => e.code === "NO_BLOCKLIST");
  await launch(creator, "GATE", stack, 0.001, { marks: [{ owner: x.publicKey.toBase58(), blocked: true }, { owner: y.publicKey.toBase58(), pass: true }] });
  assert.equal((await trade(x, "GATE", "buy", 0.001)).verdict, "6006", "x was blocked at launch");
  assert.equal((await trade(y, "GATE", "buy", 0.001)).verdict, "ok", "y got a pass at launch");
  assert.equal((await trade(z, "GATE", "buy", 0.001)).verdict, "6007", "z has no pass");
  const app = buildApp(svc);
  const stranger = await app.inject({ method: "POST", url: "/v1/coins/GATE/marks/prepare", payload: { creator: z.publicKey.toBase58(), marks: [{ owner: z.publicKey.toBase58(), pass: true }] } });
  assert.equal(stranger.json().error, "NOT_CREATOR");
  const r = await marks("GATE", creator, [{ owner: z.publicKey.toBase58(), pass: true }, { owner: y.publicKey.toBase58(), blocked: true }]);
  assert.equal(r.transactions.length, 1);
  assert.equal((await trade(z, "GATE", "buy", 0.001)).verdict, "ok", "z got a pass from the creator");
  assert.equal((await trade(y, "GATE", "sell", 100)).verdict, "6006", "y is blocked now: can't sell");
  const one = (await app.inject({ method: "GET", url: `/v1/coins/GATE/marks/${y.publicKey.toBase58()}` })).json();
  assert.deepEqual([one.blocked, one.pass], [true, true]);
  const all = (await app.inject({ method: "GET", url: "/v1/coins/GATE/marks" })).json();
  assert.equal(all.length, 3, "x, y and z (the creator's launch buy needs no pass)");
  chain.warp(86_400);
  const frozen = await marks("GATE", creator, [{ owner: y.publicKey.toBase58(), blocked: false }]);
  assert.equal(frozen.error, "BLOCKLIST_FROZEN");
  await marks("GATE", creator, [{ owner: x.publicKey.toBase58(), pass: true }]); // passes are never frozen
  assert.equal((await trade(x, "GATE", "buy", 0.001)).verdict, "6006", "x stays blocked");
  assert.equal((await trade(wallet(), "GATE", "buy", 0.001)).verdict, "ok", "after the phase, anyone not blocked buys");
});

test("Seasoned Sells: one sell may take base% of the balance, +step% per hour held", async () => {
  const creator = wallet(), a = wallet();
  await launch(creator, "SEAS", [{ id: "seasoned-sells", params: { base: 20, step: 10 } }]);
  assert.equal((await trade(a, "SEAS", "buy", 0.05)).verdict, "ok");
  const bag = tokensOf("SEAS", a);
  assert.equal((await trade(a, "SEAS", "sell", Math.floor(bag * 0.25))).verdict, "6013", "25% > 20% in the first hour");
  assert.equal((await trade(a, "SEAS", "sell", Math.floor(bag * 0.19))).verdict, "ok", "19% of the balance");
  chain.warp(3_600);
  assert.equal((await trade(a, "SEAS", "sell", Math.floor(tokensOf("SEAS", a) * 0.31))).verdict, "6013", "31% > 30% after 1h");
  assert.equal((await trade(a, "SEAS", "sell", Math.floor(tokensOf("SEAS", a) * 0.29))).verdict, "ok", "29% after 1h");
});

test("Hourly Outflow Cap: total sold in the hour across all wallets", async () => {
  const creator = wallet(), a = wallet(), b = wallet();
  await launch(creator, "FLOW", [{ id: "outflow-cap", params: { pct: 1 } }]);
  assert.equal((await trade(a, "FLOW", "buy", 1)).verdict, "ok");
  assert.equal((await trade(b, "FLOW", "buy", 1)).verdict, "ok");
  assert.ok(tokensOf("FLOW", a) > 10_000_000 && tokensOf("FLOW", b) > 10_000_000, "both hold over 1% of supply");
  assert.equal((await trade(a, "FLOW", "sell", 6_000_000)).verdict, "ok", "0.6% of supply");
  assert.equal((await trade(b, "FLOW", "sell", 4_000_001)).verdict, "6014", "1 token over the hour's 1%");
  assert.equal((await trade(b, "FLOW", "sell", 4_000_000)).verdict, "ok", "exactly the cap");
  assert.equal((await trade(a, "FLOW", "sell", 1)).verdict, "6014", "used up");
  chain.warp(3_600);
  assert.equal((await trade(a, "FLOW", "sell", 9_000_000)).verdict, "ok", "a new hour");
});
