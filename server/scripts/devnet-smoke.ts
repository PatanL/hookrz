// Devnet smoke (valueless devnet SOL): the same service code on a real cluster. hookrz_engine is not
// deployed on devnet yet (no SOL for the ~2.9 SOL deploy), so this launches a curve-only stack (no hook):
// sniper-fee-burn (DBC fee scheduler) + lp-lock + locked-metadata, then a buy and a sell through the
// trade builder, all indexed by the devnet RpcChain. Signs as a local devnet wallet; never prints keys.
//   PAYER=/path/to/devnet-keypair.json HOOKRZ_MODE=devnet npx tsx scripts/devnet-smoke.ts
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";
import { boot } from "../src/boot.js";
import { signB64 } from "../src/service.js";
import { RUNTIME } from "../src/env.js";

if (process.env.HOOKRZ_MODE !== "devnet") throw new Error("run with HOOKRZ_MODE=devnet");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.PAYER!, "utf8"))));
const { svc, chain } = await boot({ db: ":memory:", thresholdSol: 1 });
const conn = (chain as any).connection;
const bal = async () => (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
console.log("creator", payer.publicKey.toBase58(), "devnet balance", await bal());
const ticker = `HKD${Date.now().toString(36).slice(-4).toUpperCase()}`;
const stack = [{ id: "sniper-fee-burn", params: { start: 20, seconds: 30 } }, { id: "lp-lock", params: { pct: 100 } }, { id: "locked-metadata" }];
const prep = await svc.prepareLaunch({ meta: { name: `hookrz devnet ${ticker}`, ticker, creatorBuySol: 0.001 }, stack, creator: payer.publicKey.toBase58() });
console.log("launch txs:", prep.transactions.map((t: any) => `${t.label} ${t.bytes}B`));
const sub = await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, payer)) });
console.log("launched", sub.ticker, "mint", sub.mint, "sigs", sub.signatures);
await new Promise((f) => setTimeout(f, 2000));
const q = await svc.quote({ ticker, side: "buy", amount: 0.002, wallet: payer.publicKey.toBase58() });
console.log("quote buy 0.002 SOL →", q.out, "tokens, fee bps", q.feeBps, "ok", q.ok);
const buy = await svc.prepareTrade({ ticker, side: "buy", amount: 0.002, wallet: payer.publicKey.toBase58() });
const rb = await svc.sendTx(signB64(buy.transaction, payer));
console.log("buy", rb.ok ? "landed" : `failed ${rb.error}`, rb.signature);
const held = svc.holders(ticker).find((h: any) => h.wallet === payer.publicKey.toBase58());
const sellAmt = Math.floor(Number(held?.raw ?? 0) / 1e6 / 4);
const sell = await svc.prepareTrade({ ticker, side: "sell", amount: sellAmt, wallet: payer.publicKey.toBase58() });
const rs = await svc.sendTx(signB64(sell.transaction, payer));
console.log("sell", sellAmt, rs.ok ? "landed" : `failed ${rs.error}`, rs.signature);
const trades = svc.trades(ticker);
console.log("indexed:", trades.map((t: any) => `${t.kind} ${t.amount.toFixed(0)} tok ${t.sol} SOL ${t.ok ? "ok" : t.code}`));
console.log("balance after", await bal());
writeFileSync(`${RUNTIME}/devnet-smoke.json`, JSON.stringify({ at: new Date().toISOString(), ticker, mint: sub.mint, pool: prep.pool, config: prep.config, launch: sub.signatures, buy: rb.signature, sell: rs.signature, trades, coin: svc.coin(ticker) }, null, 2));
(chain as any).stop?.();
process.exit(0);
