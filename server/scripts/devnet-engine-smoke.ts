// Devnet e2e with the REAL engine (hookrz_engine deployed on devnet): rules refuse on a public cluster.
//   PAYER=../.secrets/devnet-deployer.json HOOKRZ_MODE=devnet HOOKRZ_ENGINE_ID=5bewmr… RPC_URL=<devnet rpc> npx tsx scripts/devnet-engine-smoke.ts
// 1) Fair Launch coin: a small buy lands; a sniper-sized buy inside the launch window is refused on chain (6001).
// 2) King of the Hill coin (Hookscript): the king's buy lands; the king's sell is refused on chain (6128) with the rule's text.
// Valueless devnet SOL; never prints keys. Writes .runtime/devnet-engine-smoke.json.
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";
import { boot } from "../src/boot.js";
import { signB64 } from "../src/service.js";
import { RUNTIME } from "../src/env.js";

if (process.env.HOOKRZ_MODE !== "devnet") throw new Error("run with HOOKRZ_MODE=devnet");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.PAYER!, "utf8"))));
const me = payer.publicKey.toBase58();
const { svc, chain } = await boot({ db: ":memory:", thresholdSol: 1 });
const conn = (chain as any).connection;
const bal = async () => (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
const wait = (ms: number) => new Promise((f) => setTimeout(f, ms));
const out: any = { at: new Date().toISOString(), engine: process.env.HOOKRZ_ENGINE_ID, coins: [] };
console.log("creator", me, "devnet balance", (await bal()).toFixed(3));

async function launch(name: string, stack: any[], extra: any = {}) {
  const ticker = `${name}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  const prep = await svc.prepareLaunch({ meta: { name: `hookrz devnet ${ticker}`, ticker, creatorBuySol: 0 }, stack, creator: me, ...extra });
  const sub = await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, payer)) });
  console.log(`\n[${ticker}] launched mint ${sub.mint} (${prep.transactions.map((t: any) => `${t.label} ${t.bytes}B`).join(", ")})`);
  await wait(2500);
  return { ticker, mint: sub.mint, launch: sub.signatures };
}
async function trade(ticker: string, side: "buy" | "sell", amount: number, label: string) {
  const p = await svc.prepareTrade({ ticker, side, amount, wallet: me });
  const r = await svc.sendTx(signB64(p.transaction, payer));
  const ex = r.ok ? null : await (svc as any).explain?.(r).catch?.(() => null);
  console.log(`  ${label}: ${r.ok ? "LANDED" : `REFUSED ${r.code ?? ""} ${r.error ?? ""}`} ${r.signature}${ex?.message ? `\n    message: ${ex.message}` : ""}`);
  return { label, side, amount, ok: r.ok, code: r.code ?? null, signature: r.signature, message: ex?.message ?? null };
}

// 1) Fair Launch: snipe shield (60 s window, max 0.3% of supply per buy), anti-bundle, rising max wallet.
{
  const c = await launch("HKF", [{ id: "snipe-shield", params: { window: 60, max: 0.3 } }, { id: "anti-bundle" }, { id: "rising-max" }]);
  const q = await svc.quote({ ticker: c.ticker, side: "buy", amount: 0.5, wallet: me });
  console.log(`  quote 0.5 SOL: ok=${q.ok} refusedBy=${q.refusedBy ?? "-"} largest allowed now ≈ ${q.maxAllowed?.toFixed?.(4)} SOL`);
  const t1 = await trade(c.ticker, "buy", 0.002, "small buy 0.002 SOL");
  const t2 = await trade(c.ticker, "buy", 0.5, "sniper-sized buy 0.5 SOL inside the window");
  out.coins.push({ ...c, trades: [t1, t2] });
}
// 2) King of the Hill (Hookscript)
{
  const source = readFileSync(new URL("../../hookscript/examples/king-of-the-hill.hs", import.meta.url), "utf8");
  const c = await launch("HKK", [{ id: "custom", params: { script: source } }], { script: { source } });
  const t1 = await trade(c.ticker, "buy", 0.01, "king's buy 0.01 SOL");
  await wait(2000);
  const held = svc.holders(c.ticker).find((h: any) => h.wallet === me);
  const amt = Math.max(1, Math.floor(Number(held?.raw ?? 0) / 1e6 / 2));
  const t2 = await trade(c.ticker, "sell", amt, `king sells half (${amt} tokens)`);
  out.coins.push({ ...c, trades: [t1, t2] });
}
console.log("\nbalance after", (await bal()).toFixed(3));
writeFileSync(`${RUNTIME}/devnet-engine-smoke.json`, JSON.stringify(out, null, 2));
(chain as any).stop?.();
process.exit(0);
