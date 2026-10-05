// Compute per transfer, per block: one coin per hook block (default params), a buy and a sell, the engine's CU
// read from the program logs. Plus the heaviest 6-slot stack. Budget: stack + script ≤ 30,000 CU (ENGINE-SPEC).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { boot } from "../src/boot.js";
import { signB64, type Hookrz } from "../src/service.js";
import { BLOCK_IDS } from "../src/layout.js";
import { RUNTIME } from "../src/env.js";
import type { ForkChain } from "../src/fork.js";
import type { TxRecord } from "../src/chain.js";
import { PublicKey } from "@solana/web3.js";
import { forkFundGate, gateMints } from "../src/marks.js";
import { HookrzEngine } from "../src/hook.js";

let svc: Hookrz, chain: ForkChain;
const rows: any[] = [];
before(async () => {
  svc = (await boot({ db: ":memory:", forkState: null, thresholdSol: 10 })).svc;
  chain = svc.chain as ForkChain;
});
after(() => {
  mkdirSync(RUNTIME, { recursive: true });
  writeFileSync(`${RUNTIME}/cu-per-block.json`, JSON.stringify(rows, null, 2));
  console.table(rows);
});
/** CU of the hook's Execute only (the engine invoked by Token-2022 inside the transfer, not open_wallet). */
function engineCu(r: TxRecord) {
  const id = svc.hook!.id.toBase58();
  let inHook = false, cu = 0;
  for (const l of r.logs) {
    if (l.startsWith(`Program ${id} invoke [`)) inHook = !l.endsWith("[1]");
    const m = new RegExp(`Program ${id} consumed (\\d+) of`).exec(l);
    if (m && inHook) cu = Math.max(cu, Number(m[1]));
  }
  return cu;
}
const toHour = (h: number) => { const now = chain.clock().unix; chain.warp(((h * 3600 - (now % 86400)) + 86400) % 86400 + 1); };
const w = (sol = 20) => { const k = Keypair.generate(); chain.fund(k.publicKey, sol); return k; };

async function measure(label: string, stack: any[]) {
  toHour(13);
  const creator = w(), buyer = w();
  const ticker = `CU${rows.length}`;
  const prep = await svc.prepareLaunch({ meta: { name: label.slice(0, 32), ticker }, stack, creator: creator.publicKey.toBase58() });
  await svc.submitLaunch({ mint: prep.mint, signed: prep.transactions.map((t: any) => signB64(t.base64, creator)) });
  // The landing path for the gated blocks: a pass for the buyer (Allowlist Phase), BONK in its ATA (Token Gate).
  const ids = stack.map((x: any) => x.id);
  if (ids.includes("allowlist-phase")) {
    const ix = (svc.hook as HookrzEngine).setMarkIx(creator.publicKey, new PublicKey(prep.mint), buyer.publicKey, 2);
    const tx = new (await import("@solana/web3.js")).Transaction({ feePayer: creator.publicKey, recentBlockhash: (await chain.blockhash()).blockhash }).add(ix);
    tx.sign(creator);
    assert.ok((await svc.sendTx(tx.serialize().toString("base64"))).ok, "pass");
  }
  if (ids.includes("token-gate")) forkFundGate(chain, new PublicKey(gateMints()["$BONK"]), buyer.publicKey, 10n ** 12n);
  chain.warp(700); // past every launch window
  const send = async (side: "buy" | "sell", amount: number) => {
    const p = await svc.prepareTrade({ ticker, side, amount, wallet: buyer.publicKey.toBase58(), minOut: "1" });
    return svc.sendTx(signB64(p.transaction, buyer));
  };
  const b = await send("buy", 0.01);
  chain.warp(3600 * 2 + 600); // past cooldowns and hold timers (still inside 13–21 UTC)
  const held = svc.holders(ticker).find((h: any) => h.wallet === buyer.publicKey.toBase58());
  const s = await send("sell", Math.max(1, Math.floor(Number(held?.raw ?? 1e6) / 1e6 / 10)));
  rows.push({ stack: label, buyCU: engineCu(b), buy: b.ok ? "ok" : b.code, sellCU: engineCu(s), sell: s.ok ? "ok" : s.code });
}

test("engine CU per hook block (default params) and for a full 6-slot stack", async () => {
  for (const id of Object.keys(BLOCK_IDS).filter((x) => x !== "custom")) await measure(id, [{ id }]);
  await measure("6 slots: sandwich, cooldown, hold, breaker, sell-cap, lock-in", [{ id: "sandwich-guard" }, { id: "sell-cooldown" }, { id: "hold-timer" }, { id: "circuit-breaker" }, { id: "sell-cap" }, { id: "lock-in", params: { pct: 10 } }]);
  for (const r of rows) assert.ok(r.buyCU < 30_000 && r.sellCU < 30_000, `${r.stack} over budget`);
});
