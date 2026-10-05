// Paths and settings. Everything is overridable by environment variables; defaults suit the local fork.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(SERVER_DIR, "..");
export const WEB = resolve(ROOT, "web");
export const ENGINE_DIR = resolve(ROOT, "programs/hookrz-engine");
export const HOOKSCRIPT_DIR = resolve(ROOT, "hookscript");
export const RUNTIME = resolve(SERVER_DIR, ".runtime");

export const env = {
  mode: (process.env.HOOKRZ_MODE ?? "fork") as "fork" | "devnet" | "mainnet",
  port: Number(process.env.PORT ?? 8830),
  host: process.env.HOST ?? "127.0.0.1",
  forkDir: process.env.FORK_DIR ?? (existsSync(resolve(RUNTIME, "dbc-fork/snapshot.json")) ? resolve(RUNTIME, "dbc-fork") : "/home/dzliu/away-tek/.runtime/dbc-fork"),
  /** Persist the fork between restarts (dev server). Tests use a fresh in-memory fork. */
  forkState: process.env.FORK_STATE ?? null,
  db: process.env.DB ?? ":memory:",
  rpc: process.env.RPC_URL ?? "https://api.devnet.solana.com",
  /** Graduation threshold in SOL (DBC migrationQuoteThreshold). */
  thresholdSol: Number(process.env.THRESHOLD_SOL ?? 85),
  solUsd: Number(process.env.SOL_USD ?? 150),
  /** Force the stand-in hook (away-rules) even when hookrz_engine is built. */
  hook: process.env.HOOK ?? "auto",
};

/** ENGINE's hookrz_engine.so: the last stable copy by default (ENGINE_BUILD=latest picks the newest target/ build). */
export function engineSo(): string | null {
  if (process.env.ENGINE_SO) return process.env.ENGINE_SO;
  const stable = resolve(ENGINE_DIR, "hookrz_engine.so");
  const builds = [resolve(ENGINE_DIR, "target/sbpf-solana-solana/release/hookrz_engine.so"), resolve(ENGINE_DIR, "target/deploy/hookrz_engine.so")].filter(existsSync);
  if (process.env.ENGINE_BUILD === "latest") return [stable, ...builds].filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  return existsSync(stable) ? stable : (builds[0] ?? null);
}

/** The engine's program id, as ENGINE publishes it in programs/hookrz-engine/STATUS.md (or HOOKRZ_ENGINE_ID). */
export function engineId(): string | null {
  if (process.env.HOOKRZ_ENGINE_ID) return process.env.HOOKRZ_ENGINE_ID;
  for (const f of ["STATUS.md", "LAYOUT.md", "README.md"]) {
    const p = resolve(ENGINE_DIR, f);
    if (!existsSync(p)) continue;
    const m = /program id[^`\n]*`([1-9A-HJ-NP-Za-km-z]{32,44})`/i.exec(readFileSync(p, "utf8")) ?? /\b(?:id|ID)\b[^\n]*?([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(readFileSync(p, "utf8"));
    if (m) return m[1];
  }
  const src = resolve(ENGINE_DIR, "src/lib.rs");
  if (existsSync(src)) {
    const m = /declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/.exec(readFileSync(src, "utf8"));
    if (m) return m[1];
  }
  return null;
}

export const AWAY_RULES_ID = "3mx9QjgLoR6BadkSCbEzE8rzKGgiF24VyjT1PzUxqYSu";
export const AWAY_RULES_SO = existsSync(resolve(RUNTIME, "away_rules.so")) ? resolve(RUNTIME, "away_rules.so") : "/home/dzliu/away-tek/programs/away-rules/away_rules.so";
