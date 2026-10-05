// Wire a chain, the hook program, the store and the service from settings. Used by the server and tests.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ForkChain } from "./fork.js";
import { RpcChain } from "./rpc.js";
import { HookrzEngine, AwayRules, type HookProgram } from "./hook.js";
import { Store } from "./store.js";
import { Hookrz } from "./service.js";
import { env, engineSo, engineId, AWAY_RULES_ID, AWAY_RULES_SO, RUNTIME, ROOT } from "./env.js";
import { forkGateMints } from "./marks.js";

export function loadKeypair(path: string, create = false) {
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  if (!create) throw new Error(`missing keypair ${path}`);
  const k = Keypair.generate();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify([...k.secretKey]), { mode: 0o600 });
  return k;
}

/** Which hook program to use: hookrz_engine when ENGINE has built it (and published its id), else away-rules. */
export function pickHook(): { hook: HookProgram; so: string | null; why: string } {
  const so = engineSo(), id = engineId();
  if (env.hook !== "away-rules" && so && id) return { hook: new HookrzEngine(new PublicKey(id)), so, why: `hookrz_engine ${id} from ${so}` };
  if (env.hook === "hookrz") throw new Error(`HOOK=hookrz but hookrz_engine is not ready (so: ${so ?? "missing"}, id: ${id ?? "missing"})`);
  return { hook: new AwayRules(new PublicKey(AWAY_RULES_ID)), so: AWAY_RULES_SO, why: `stand-in away-rules ${AWAY_RULES_ID} (hookrz_engine ${so ? "built" : "not built"}, id ${id ?? "unpublished"})` };
}

export async function boot(o: { db?: string; forkState?: string | null; publicBase?: string; thresholdSol?: number; wallClock?: boolean } = {}) {
  if (env.mode === "mainnet") throw new Error("mainnet mode is gated off");
  const store = new Store(o.db ?? env.db);
  if (env.mode === "devnet") {
    const deployed = process.env.HOOKRZ_ENGINE_ID ?? engineId();
    const hook = deployed ? new HookrzEngine(new PublicKey(deployed)) : null;
    const platform = loadKeypair(resolve(ROOT, ".secrets/platform.json"), true);
    const chain = new RpcChain(env.rpc, hook ? [hook.id] : []);
    const svc = new Hookrz({ chain, store, hook, platform, solUsd: env.solUsd, thresholdSol: o.thresholdSol ?? env.thresholdSol, publicBase: o.publicBase, autoMigrate: true });
    chain.start();
    return { svc, chain, hookWhy: hook ? `hookrz_engine ${hook.id.toBase58()} (devnet)` : "no engine deployed on devnet" };
  }
  const { hook, so, why } = pickHook();
  const chain = new ForkChain({ dir: env.forkDir, programs: so ? [{ id: hook.id.toBase58(), so }] : [], statePath: o.forkState ?? env.forkState, wallClock: o.wallClock ?? process.env.FORK_WALL_CLOCK === "true" });
  const platform = loadKeypair(resolve(RUNTIME, "platform-fork.json"), true);
  chain.fund(platform.publicKey, 1000);
  forkGateMints(chain); // Token Gate tickers need their mints on the fork (mainnet addresses, stand-in data)
  const svc = new Hookrz({ chain, store, hook, platform, solUsd: env.solUsd, thresholdSol: o.thresholdSol ?? env.thresholdSol, publicBase: o.publicBase, autoMigrate: true });
  return { svc, chain, hookWhy: why };
}
