# hookrz engine: the shared build spec (all agents read this first)

Goal: make hookrz actually work, fast. A real launch on a local LiteSVM fork (real Meteora DBC, DAMM v2 and Token-2022
binaries), then devnet, then mainnet. Ship the smallest real thing first, then widen.

**Our differentiator is Hookscript:** a creator writes a rule in plain English, an LLM drafts it in Hookscript, it
compiles to bytecode, gets fuzzed against 10,000 generated trades, is stored on-chain at launch, and the one engine runs
it on every transfer. Competitors already have pieces of this:
- hookedpad has a live "custom hook" (AI → short rule set → compiler → on-chain) and game hooks such as "King of the Hill"
  (program 63VLLdKEZVjwKN4Y6CqeeFkLGzMoSZxFAXsfiLwnKKkD: the biggest buy takes the crown and the king earns about 0.5% of trades).
- spec.fun's AI only maps sentences onto its catalog.

Ours must be **more expressive (stateful games), safer (refuse-only, bounded, fuzzed) and composable** with the
prebuilt blocks in one stack.

## Repos and ownership (don't edit another agent's area; coordinate through this file)
| Area | Path | Owner |
|---|---|---|
| On-chain engine (native Rust, no Anchor) | `hookrz/programs/hookrz-engine/` | ENGINE agent |
| Hookscript: VM crate, compiler, fuzzer, drafter | `hookrz/hookscript/` (`vm/` Rust no_std crate, `compiler/` TS, `fuzz/`, `drafter/`) | HOOKSCRIPT agent |
| Server: API, launch/trade tx builders, indexer, fork harness, e2e | `hookrz/server/` | BACKEND agent |
| Site | `hookrz/web/` | BACKEND agent may only touch `web/src/api/client.js` (live mode) and add `web/.env.example`. Don't change the demo behaviour; live mode is opt-in via `VITE_API_BASE` |
| Coordinator | the root `ENGINE-SPEC.md`, `git` commits | Claude (coordinator). **Agents never `git commit` or `git push`.** A push to main deploys hookrz.fun |

## Proven prior work to copy from (read-only, never edit)
- `/home/dzliu/away-tek/programs/away-rules/` is a working Token-2022 transfer hook (754 lines, native Rust):
  - an Execute handler that checks the transferring flag and that source/destination are token accounts of this mint;
  - ExtraAccountMetaList init;
  - a DBC pool sqrt-price read at offset 280, guarded by mint and vault checks;
  - per-token-account settlement lots (= our Hold Timer);
  - a session clock (= Trading Hours) and a circuit breaker (= Circuit Breaker);
  - close and refund instructions that only work after the hook is retired.

  Its security review (`/home/dzliu/away-tek/docs/HOUSE-RULES.md`) lists real bugs (C1 forged CPI, H1 lot extension, M1
  pre-funded PDA, …); **don't reintroduce them.**
- Build: `PATH=$HOME/.cache/solana/v1.57/platform-tools/rust/bin:$HOME/.cache/solana/v1.57/platform-tools/llvm/bin:$PATH CARGO_HOME=$HOME/.cache/solana/cargo-home cargo build --release --target sbpf-solana-solana` (ARM64, works). Host tests: `cargo test --release` with the same env.
- Fork harness: `/home/dzliu/away-tek/src/server/fork.ts` (LiteSVM loaded with real DBC, DAMM v2 and Token-2022 binaries, warp-able clock), `src/server/dbc.ts` (DBC TransferHook config and pool creation, `patchRuledSwap` re-resolving hook accounts), `scripts/test-dbc-*.ts`, `tests/rules.test.ts`. The one-tx launch was 1,222 of 1,232 bytes; a split launch is safe because no transfer can succeed before the ExtraAccountMetaList exists.
- Server patterns: `/home/dzliu/away-ui/src/server/` (indexer.ts, creator-fees.ts, fees.ts, limiter.ts, store.ts, app.ts).
- Reference semantics, which the Rust must match: `hookrz/web/src/engine/engine.js` (`evaluate`), the `check()` functions and params in `hookrz/web/src/data/blocks.js`, and `hookrz/web/tests/engine.test.mjs`. Errors are `ERR_NAMES` in blocks.js.

## Program
`hookrz_engine`: one program for every coin. The mint's TransferHook names it, with authority = the DBC pool authority (`FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM`), so the curve removes the hook in the graduating swap.

### Accounts (PDAs of hookrz_engine)
- `Stack` `["stack", mint]`: header + 6 slots as published in the site docs (`web/src/ui/docs-engine.js` STACK_LAYOUT /
  SLOT_LAYOUT): `block_id u16 | params [u8;24] | state [u8;32]` per slot, keys (mint, creator, pool, base_vault,
  parent_stack, parent_author), launch_slot/ts, flags. **Change from the docs:** the inline 64-byte script is replaced by a
  pointer flag. Hookscript lives in `Script`.
- `Script` `["script", mint]`: `version u8 | len u16 | bytecode [u8; ≤1024] | globals [u8; 256]` (persistent coin-level
  state for stateful rules: counters, a "king" pubkey + amount, last-trade slot, …). Exact layout is owned by HOOKSCRIPT and
  documented in `hookscript/SPEC.md`.
- `Wallet` `["w", mint, token_account]`: as WALLET_LAYOUT (lots, first_receipt_ts, last_buy_slot, last_sell_ts, flags) +
  **32 bytes of per-wallet script state** (for Hookscript `wallet.var`). Opened by the server's buy transaction (or by
  anyone, with rent refundable after graduation).
- `ExtraAccountMetaList` `["extra-account-metas", mint]` (spl-transfer-hook-interface standard). Entries: the Stack, the
  pool (read-only), Wallet(src), Wallet(dst), Script, and anything needed by the blocks in the stack.

### Instructions
| Instruction | Who / when |
|---|---|
| `Execute` (spl-transfer-hook-interface discriminator) | Token-2022, inside every transfer. Classify: **buy** = source is the pool base vault, **sell** = destination is the base vault, otherwise **send**. Run slots in order; the first refusal returns its custom error (blocks.js codes). Then run the Hookscript, if any (6128 on refuse). Write state only after all checks pass |
| `init_stack` (0xA0) | Pool creator, once, in the launch tx: writes Stack (+ Script) and the ExtraAccountMetaList. Fails with 6143 if already initialized |
| `open_wallet` (0xA1) | Anyone, for a token account of this mint |
| `close_wallet` (0xA2) / `close_stack` (0xA3) | Anyone, **only after the hook is retired** (the mint's TransferHook program ≠ hookrz_engine), else 6142. Rent goes back to the payer and creator respectively |

Engine errors: `6000 NotInTransfer`, `6141 MissingWalletRecord`, `6142 HookLive`, `6143 StackLocked`.

### Phase-1 blocks (hook)
These match `blocks.js` exactly: ids, params, defaults, codes.

| Block | Code |
|---|---|
| snipe-shield | 6001 |
| anti-bundle | 6002 |
| max-wallet | 6003 |
| rising-max | 6004 |
| sandwich-guard | 6005 |
| sell-cap | 6008 |
| sell-cooldown | 6009 |
| hold-timer | 6010 |
| circuit-breaker | 6011 |
| trading-hours | 6012 |
| lock-in | 6015 |
| creator-vest | 6016 |
| custom (Hookscript) | 6128 |

Later: blocklist, allowlist-phase, seasoned-sells, outflow-cap, token-gate, chapters.

**Curve/mint blocks are not in the hook.** BACKEND sets them in the launch tx: sniper-fee-burn (DBC fee scheduler), lp-lock (DBC
locked LP), leftover-burn (leftover receiver), locked-metadata (update authority none).

**Budget:** total stack + script ≤ 30,000 CU per transfer. Measure it in tests and report it per block.

### Parity
ENGINE exports `programs/hookrz-engine/vectors/*.json` (ctx → expected verdict) generated from `web/src/engine/engine.js`.
The Rust host tests must pass every vector, and BACKEND's e2e must show the same verdicts on the fork.

## Hookscript (HOOKSCRIPT agent owns the language; summary of requirements)
- **Refuse-only and bounded.** No loops (or only bounded ones), no CPIs, no lamport moves; a hard op budget (target ≤ 8,000 CU worst case); deterministic.
- **Reads:**
  - transfer: kind, amount, source and destination owners, slot, unix time, hour or weekday in a chosen timezone;
  - wallet: balance before/after, received/sold in a window, first_receipt, last_buy_slot, last_sell_ts, its own `var`s;
  - curve: price, progress, market cap from DBC;
  - coin: supply, launch age, its own `globals`.
- **Writes:** coin `globals` and per-wallet `var`s, only if the transfer is allowed. That lets it express stateful and
  game rules, e.g.:
  - King of the Hill: track the biggest buy and its wallet, and refuse the king's sells while the crown is held;
  - every-Nth-buy counters;
  - cooldowns;
  - rising bars.
- **Payouts:** the engine never moves funds. Game payouts (king rewards, lottery pots) are paid by the public keeper from
  creator fees, reading the `globals`. BACKEND's keeper does that.
- **Toolchain:**
  - a text syntax (the site already shows `rule "…" / when … / let … / refuse if … because "…"`; evolve it);
  - a TS compiler → bytecode;
  - a Rust VM crate the ENGINE links;
  - a TS reference interpreter for the site and server with byte-for-byte parity tests against the Rust VM;
  - a fuzzer (10,000 generated trades → refused %, panics = 0, max CU);
  - an LLM drafter (English → Hookscript), with a pluggable provider: Anthropic API if `ANTHROPIC_API_KEY` is set, otherwise
    a local heuristic. Every draft is compiled and fuzzed before it's returned.
- **Interface for ENGINE:** `hookscript_vm::run(code: &[u8], ctx: &Ctx, globals: &mut [u8], wallet_src: &mut [u8], wallet_dst: &mut [u8]) -> Result<Verdict, VmError>`. HOOKSCRIPT defines `Ctx` in the crate. The ENGINE fills it.

## Server (BACKEND agent)
- **Stack:** Node 22, Hono or Fastify (match away-ui/signed), SQLite (`node:sqlite`).
- **Endpoints:** those in `web/src/api/contract.js` with the same JSON shapes `web/src/api/client.js` returns in demo mode.
- **Modes:** `fork` (LiteSVM, default for dev and e2e), `devnet`, `mainnet` (gated off).
- **Launch tx builder:**
  1. create the mint with TransferHook → hookrz_engine and metadata;
  2. DBC `createConfigWithTransferHook` + `initializeVirtualPoolWithToken2022TransferHook`;
  3. `init_stack`, plus the ExtraAccountMetaList;
  4. an optional creator buy.

  Split it into 2 transactions if it exceeds 1,232 bytes. Curve/mint blocks map to the DBC config.
- **Trade builder:** DBC swap with the hook accounts resolved, opening the Wallet record when needed.
- **Rule-aware quote:** the JS engine + the TS Hookscript interpreter over live chain state.
- **Indexer:** coins, trades, holders, refusals (failed transactions with our custom errors), lineage.
- **Keeper:** burns, the remix royalty, Hookscript game payouts. Phase 2; stub the interface now.
- **E2E on the fork, before anything else:**
  1. launch a Fair Launch coin;
  2. buy;
  3. a sniper buy is refused with 6001;
  4. a Hookscript King-of-the-Hill coin refuses the king's sell;
  5. fill the curve until it graduates; the hook is retired;
  6. close_wallet refunds rent.

## Rules for agents
- **Machine limits:** at most 3 agents total in this session, and **only BACKEND may run a browser**, one at a time, closed after. Check
  `tail -1 ~/spark-health/health.log` (availGB) before heavy builds; don't start one below 30 GB.
- **No secrets in logs.** Never print keys. Devnet/mainnet keys live in `hookrz/.secrets/` (gitignored).
- **Reports:** short `STATUS.md` in your own area, kept current: what works, how to run it, what's blocked.
