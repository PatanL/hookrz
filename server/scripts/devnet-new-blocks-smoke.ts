// Devnet e2e for the six blocks added in engine v2 (Blocklist, Allowlist Phase, Seasoned Sells, Outflow Cap, Token Gate,
// Chapters): each coin gets a trade the chain must refuse with the block's code, and one it must let through.
//   PAYER=../.secrets/devnet-deployer.json HOOKRZ_MODE=devnet HOOKRZ_ENGINE_ID=5bewmr… RPC_URL=<devnet rpc> npx tsx scripts/devnet-new-blocks-smoke.ts
// A second wallet ("guest") is funded from the payer. Token Gate uses a devnet stand-in for $BONK (created once, kept in
// .runtime/devnet-gate.json). Valueless devnet SOL; never prints keys. Writes .runtime/devnet-new-blocks-smoke.json.
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { RUNTIME } from "../src/env.js";

if (process.env.HOOKRZ_MODE !== "devnet") throw new Error("run with HOOKRZ_MODE=devnet");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.PAYER!, "utf8"))));
const guest = Keypair.generate();
const me = payer.publicKey.toBase58();
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null; // e.g. ONLY=chapters
const want = (id: string) => !ONLY || ONLY.includes(id);
const wait = (ms: number) => new Promise((f) => setTimeout(f, ms));

// $BONK stand-in on devnet (the engine reads the buyer's ATA of whatever mint the gate names)
const gateFile = `${RUNTIME}/devnet-gate.json`;
const { Connection } = await import("@solana/web3.js");
const conn0 = new Connection(process.env.RPC_URL!, "confirmed");
let gateMint = existsSync(gateFile) ? JSON.parse(readFileSync(gateFile, "utf8")).$BONK : null;
if (!gateMint) {
  gateMint = (await createMint(conn0, payer, payer.publicKey, null, 5)).toBase58();
  writeFileSync(gateFile, JSON.stringify({ $BONK: gateMint }, null, 2));
}
process.env.HOOKRZ_GATE_MINTS = JSON.stringify({ $BONK: gateMint });

const { boot } = await import("../src/boot.js");
const { signB64 } = await import("../src/service.js");
const { svc, chain } = await boot({ db: ":memory:", thresholdSol: 1 });
const conn = (chain as any).connection;
const bal = async () => (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
const out: any = { at: new Date().toISOString(), engine: process.env.HOOKRZ_ENGINE_ID, gateMint, guest: guest.publicKey.toBase58(), coins: [] };
console.log("creator", me, "devnet balance", (await bal()).toFixed(3), "· guest", guest.publicKey.toBase58(), "· $BONK stand-in", gateMint);
await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: guest.publicKey, lamports: Math.round((ONLY ? 0.15 * ONLY.length + 0.1 : 0.5) * LAMPORTS_PER_SOL) })), [payer]);

async function launch(name: string, stack: any[], extra: any = {}) {
  const ticker = `${name}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  const prep = await svc.prepareLaunch({ meta: { name: `hookrz devnet ${ticker}`, ticker, creatorBuySol: 0 }, stack, creator: me, ...extra });
  const sub = await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, payer)) });
  console.log(`\n[${ticker}] ${stack.map((s) => s.id).join(" + ")} · mint ${sub.mint}`);
  await wait(2500);
  return { ticker, mint: sub.mint, launch: sub.signatures };
}
async function trade(ticker: string, who: Keypair, side: "buy" | "sell", amount: number, label: string, expect: number | null) {
  const p = await svc.prepareTrade({ ticker, side, amount, wallet: who.publicKey.toBase58() });
  const r = await svc.sendTx(signB64(p.transaction, who));
  const code = r.ok ? null : r.code ?? null;
  const pass = expect === null ? r.ok : code === expect;
  console.log(`  ${pass ? "ok " : "BAD"} ${label}: ${r.ok ? "LANDED" : `REFUSED ${code ?? ""} ${r.error ?? ""}`.trim()} ${r.signature ?? ""}`);
  if (!pass) process.exitCode = 1;
  await wait(1500);
  return { label, side, amount, expect, ok: r.ok, code, pass, signature: r.signature ?? null };
}
const tokensOf = async (ticker: string, who: Keypair) => Number(svc.holders(ticker).find((h: any) => h.wallet === who.publicKey.toBase58())?.raw ?? 0) / 1e6;
const signAll = async (txs: any[], who: Keypair) => { for (const t of txs) { const r = await svc.sendTx(signB64(t.base64, who)); if (!r.ok) throw new Error(`set_mark failed: ${r.error}`); } };

// 1) Blocklist: guest is marked at launch → its buy is refused (6006); the creator's buy lands.
if (want("blocklist")) {
  const c = await launch("HKBL", [{ id: "blocklist", params: { lockAt: "at graduation" } }], { marks: [{ owner: guest.publicKey.toBase58(), blocked: true }] });
  const t = [await trade(c.ticker, guest, "buy", 0.01, "blocked guest buys 0.01 SOL", 6006), await trade(c.ticker, payer, "buy", 0.01, "creator buys 0.01 SOL", null)];
  out.coins.push({ ...c, trades: t });
}
// 2) Allowlist Phase: guest without a pass is refused (6007); after the creator grants a pass, the same buy lands.
if (want("allowlist-phase")) {
  const c = await launch("HKAL", [{ id: "allowlist-phase", params: { minutes: 30 } }]);
  const t = [await trade(c.ticker, guest, "buy", 0.01, "guest without a pass buys", 6007)];
  const m = await (await import("../src/marks.js")).prepareMarks(svc.chain, svc.hook, svc.store, c.ticker, { creator: me, marks: [{ owner: guest.publicKey.toBase58(), pass: true }] });
  await signAll(m.transactions, payer);
  console.log("  creator granted guest a pass");
  await wait(2000);
  t.push(await trade(c.ticker, guest, "buy", 0.01, "guest with a pass buys", null));
  out.coins.push({ ...c, trades: t });
}
// 3) Seasoned Sells (base 20%, +10%/h): selling the whole bag right away is refused (6013); 10% lands.
if (want("seasoned-sells")) {
  const c = await launch("HKSS", [{ id: "seasoned-sells", params: { base: 20, step: 10 } }]);
  const t = [await trade(c.ticker, guest, "buy", 0.02, "guest buys 0.02 SOL", null)];
  const held = await tokensOf(c.ticker, guest);
  t.push(await trade(c.ticker, guest, "sell", Math.floor(held), `sells the whole bag (${Math.floor(held)})`, 6013));
  t.push(await trade(c.ticker, guest, "sell", Math.max(1, Math.floor(held / 10)), "sells 10%", null));
  out.coins.push({ ...c, trades: t });
}
// 4) Outflow Cap (1% of supply per hour): a sell over 1% of supply in the hour is refused (6014); a small one lands.
if (want("outflow-cap")) {
  const c = await launch("HKOC", [{ id: "outflow-cap", params: { pct: 1 } }]);
  const t = [await trade(c.ticker, guest, "buy", 0.15, "guest buys 0.15 SOL", null)];
  const held = await tokensOf(c.ticker, guest);
  console.log(`  guest holds ${held.toLocaleString("en-US")} (${(held / 1e7).toFixed(2)}% of supply)`);
  t.push(await trade(c.ticker, guest, "sell", Math.floor(held), "sells it all at once", held > 1e7 ? 6014 : null));
  t.push(await trade(c.ticker, guest, "sell", Math.floor(Math.min(held, 1e7) / 4), "sells a quarter of a percent", null));
  out.coins.push({ ...c, trades: t });
}
// 5) Token Gate ($BONK stand-in, min 100): guest without it is refused (6017); after getting 1,000 it lands.
if (want("token-gate")) {
  const c = await launch("HKTG", [{ id: "token-gate", params: { ticker: "$BONK", min: 100 } }]);
  const t = [await trade(c.ticker, guest, "buy", 0.01, "guest without $BONK buys", 6017)];
  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, new (await import("@solana/web3.js")).PublicKey(gateMint), guest.publicKey);
  await mintTo(conn, payer, ata.mint, ata.address, payer, 1000 * 1e5);
  console.log("  guest received 1,000 $BONK (stand-in)");
  t.push(await trade(c.ticker, guest, "buy", 0.01, "guest holding 1,000 $BONK buys", null));
  out.coins.push({ ...c, trades: t });
}
// 6) Chapters (3 chapters, chapter 1 cap 0.25% of supply): a buy past the cap is refused (6018); a small one lands.
if (want("chapters")) {
  const c = await launch("HKCH", [{ id: "chapters", params: { n: 3, first: 0.25 } }]);
  const q = await svc.quote({ ticker: c.ticker, side: "buy", amount: 0.05, wallet: guest.publicKey.toBase58() });
  const small = Math.max(0.0001, Math.floor((q.maxAllowed ?? 0.001) * 0.5 * 1e6) / 1e6);
  console.log(`  quote 0.05 SOL: ok=${q.ok} refusedBy=${q.refusedBy ?? "-"} · largest allowed ≈ ${q.maxAllowed?.toFixed?.(6)} SOL`);
  const t = [await trade(c.ticker, guest, "buy", 0.05, "guest buys 0.05 SOL in chapter 1", 6018), await trade(c.ticker, guest, "buy", small, `guest buys ${small} SOL (half the cap)`, null)];
  out.coins.push({ ...c, trades: t });
}
console.log(`\n${out.coins.flatMap((c: any) => c.trades).filter((t: any) => t.pass).length}/${out.coins.flatMap((c: any) => c.trades).length} as expected · balance after ${(await bal()).toFixed(3)}`);
writeFileSync(`${RUNTIME}/devnet-new-blocks-smoke.json`, JSON.stringify(out, null, 2));
(chain as any).stop?.();
process.exit(process.exitCode ?? 0);
