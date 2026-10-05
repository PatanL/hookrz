// Smoke: the full service path on the fork with whatever hook boot() picks.
import { Keypair } from "@solana/web3.js";
import { boot } from "../src/boot.js";
import { signB64 } from "../src/service.js";

const { svc, chain, hookWhy } = await boot({ thresholdSol: 10 });
console.log("hook:", hookWhy);
const fork = chain as any;
const alice = Keypair.generate(), bob = Keypair.generate();
fork.fund(alice.publicKey, 100); fork.fund(bob.publicKey, 100);
const stack = [{ id: "snipe-shield" }, { id: "anti-bundle" }, { id: "rising-max" }, { id: "sniper-fee-burn" }];
const prep = await svc.prepareLaunch({ meta: { name: "Smoke Coin", ticker: "SMOKE", creatorBuySol: 0.01 }, stack, creator: alice.publicKey.toBase58() });
console.log("prepare:", prep.mint, prep.transactions.map((t: any) => `${t.label} ${t.bytes}B`));
const signed = prep.transactions.map((t: any) => signB64(t.base64, alice));
const sub = await svc.submitLaunch({ mint: prep.mint, signed });
console.log("submit:", sub);
console.log("coin:", JSON.stringify(svc.coin("SMOKE"), (k, v) => (k === "budget" || k === "stack" ? undefined : v)).slice(0, 400));
const q = await svc.quote({ ticker: "SMOKE", side: "buy", amount: 0.05, wallet: bob.publicKey.toBase58() });
console.log("quote:", { ok: q.ok, out: q.out, verdicts: q.verdicts, code: q.code, maxAllowed: q.maxAllowed });
const t = await svc.prepareTrade({ ticker: "SMOKE", side: "buy", amount: 0.05, wallet: bob.publicKey.toBase58() });
const r = await svc.sendTx(signB64(t.transaction, bob));
console.log("buy:", r.ok, r.signature, r.code, r.ok ? "" : r.logs.slice(-6).join("\n"));
console.log("trades:", svc.trades("SMOKE").map((x: any) => `${x.kind} ${x.amount.toFixed(0)} ${x.sol} ok=${x.ok} ${x.by ?? ""}`));
console.log("holders:", svc.holders("SMOKE").map((h: any) => `${h.wallet.slice(0, 6)} ${(h.share * 100).toFixed(3)}%`));
