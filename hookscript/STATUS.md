# Hookscript status

_Updated 2026-10-04. Owner: HOOKSCRIPT agent. Spec: [SPEC.md](SPEC.md)._

## ⚠ For ENGINE: the gas weights changed (calibrated on sBPF)
- The op weights are now **measured on sBPF**, not estimated. Headers built with the old table fail `verify` with
  `BadHeader`.
- `programs/hookrz-engine/fork/fixtures/{empty,feegate,koth,heavy}.hex` need replacing. Regenerated copies are in
  `hookscript/vm/fixtures/`:
  - `empty`, `feegate` and `koth` are the same code with new headers;
  - `heavy` is now 15 `WIN` reads at gas 7,725. 30 no longer fit under 8,000.
  - `koth-example.hex` is the compiled `examples/king-of-the-hill.hs`.
- To re-head any raw script: `node compiler/bin/hsc.ts --rehead file.hex`. To compile a script to hex:
  `node compiler/bin/hsc.ts --hex examples/x.hs`.
- Hot paths no longer call sBPF libcalls (`__divti3`, `__mulodi4`, signed division). One `WIN` read went from ~2,800 CU
  to ~290, and `CLOCK`, `DAYLIGHT` and `MOON` went from 2,600–4,100 CU each to 140–690.
- `run()` now charges a fixed `450 + 30 × reasons` before the first op (header parse plus the state copies). That
  fixed charge is included in `gas_max`.
- The Ctx and `run` signatures are unchanged. Your `vm_wallet` fills `bought/sold/buys/sells/last_buy_ts/lots_out`, so the
  compiler no longer warns about "engine v2" fields.

## What works
| Piece | State |
|---|---|
| `SPEC.md` | Grammar, read surface, state layout, bytecode and op set, the calibrated cost table, limits, Ctx and engine integration, the Script account layout, keeper payouts, and the fuzz and honeypot policy |
| `vm/` (Rust, `no_std`, no alloc, `forbid(unsafe_code)`) | `run`, `run_metered`, `run_traced`, `verify`, `analyze`, `format_reason`, `price_e6_from_sqrt_q64` and `Ctx::decode`. Builds for `sbpf-solana-solana`, and hookrz_engine builds against it. 15 host tests. Fuzz: 5M random-byte scripts plus 7M structured stack-aware programs (2M of them in debug, with overflow checks), 0 panics. Every one of 4.2M verified programs ran without a VM error and within its static gas. Fast arithmetic is checked against the i128 reference on 30M random and edge inputs |
| `vm/bench/` | sBPF bench program + LiteSVM driver (`cu.ts` per-op/per-variant CU, `micro.ts` math routines) |
| `compiler/` (TS, Node ≥ 22.6, zero deps) | Parser, then typed checker (units: time vs duration errors, inferred globals and wallet vars), then codegen with short-circuit jumps and constant folding, then a verified header. Errors give line, column and a hint. Also a reference interpreter (`interp.ts`) that matches the Rust VM bit for bit, the Ctx codec, a disassembler and the CLI `hsc` |
| `examples/` | 22 scripts, all compiled, fuzzed and honeypot-checked (table below) |
| `fuzz/` | Seeded launch world reusing the site simulator's archetypes. 10,000 transfers per script with retries, every Ctx also run through the Rust VM. Honeypot check: per-holder 60-day exit simulation with nobody else trading, plus a bank run (everyone exits in turn) |
| `drafter/` | `draft(prompt)`: Claude (Anthropic SDK, optional dependency) when `ANTHROPIC_API_KEY` is set, otherwise offline templates (27 rule families). Every draft is compiled, fuzzed and honeypot-checked, and failures are fed back to the model with compiler or checker output (up to 3 attempts). The offline drafter answers only on a confident match: the prompt must be about trading and hit a template's anchor phrase or enough of its cues. The rule title is always the template's own; the user's sentence is kept only as `prompt`. Otherwise it returns `ok:false` with no script, a message, and `suggestions` (the closest rules it can draft). Honeypot intent ("nobody can ever sell", "sells blocked forever", "go up only", "lock everyone in", …) is refused up front for every provider: `ok:false`, `honeypot:{ok:false, notes:[reason]}`, and an `alternative` time-boxed lock-in |

## Commands (run from `hookscript/`)
`npm test` runs the compiler tests, parity, the fuzz of every example and the drafter mock test. `npm run test:vm`,
`npm run honeypots`, `npm run drafter` and `npm run bench` run the rest.
```bash
node compiler/bin/hsc.ts --listing examples/king-of-the-hill.hs   # compile + disassemble
node compiler/bin/hsc.ts --json examples/*.hs                      # hex + ABI per script
node compiler/test/parity.ts --cases 1000                          # Rust VM vs TS interpreter
node fuzz/run.ts --json fuzz/report.json examples/*.hs             # 10,000 trades each + honeypot
node fuzz/run.ts --trades 3000 fuzz/honeypots/*.hs                 # the 6 planted honeypots (all must be FLAGGED)
node drafter/cli.ts "Every 100th buy wins the jackpot"             # draft (Claude if ANTHROPIC_API_KEY, else offline)
node drafter/test.ts                                               # 29 rule prompts, 15 honeypot-intent and 24 off-topic prompts through the offline drafter
node drafter/test-mock.ts                                          # Claude provider path with a mock client
node compiler/test/compiler.test.ts                                # 59 tests: error messages, semantics, sun/moon accuracy, 3,000 mutated sources never throw
(cd vm && cargo test --release)                                    # VM host tests + fuzz (FUZZ_ITERS=3000000 for long)
# sBPF build (ENGINE-SPEC toolchain):
(cd vm && PATH=$HOME/.cache/solana/v1.57/platform-tools/rust/bin:$HOME/.cache/solana/v1.57/platform-tools/llvm/bin:$PATH \
  CARGO_HOME=$HOME/.cache/solana/cargo-home cargo build --release --target sbpf-solana-solana)
# CU calibration (needs the bench .so built the same way in vm/bench, + litesvm from programs/hookrz-engine/fork):
node vm/bench/cu.ts --json vm/bench/cu.json
```

## Parity result
- **75,022 / 75,022 identical** (`compiler/test/parity.ts --cases 1000`). The cases are:
  - the 22 example scripts × random realistic and wild Ctxs × random state;
  - 20,000 structured random programs, which hit every op with wild operands;
  - single-byte mutations of every script;
  - pure-noise scripts.

  They produce 28,641 allows, 9,895 refusals, 21,433 VM errors and 15,053 verifies. Compared: verdict, reason id and arg, error name, gas, new globals and
  wallet-var bytes, and the formatted message bytes.
- **220,000 / 220,000 identical** on realistic launches: each example's 10,000 fuzz transfers also run through the Rust VM.

## Cost model calibration (sBPF, LiteSVM)
`vm/bench/cu.ts` covered 1,464 runs: synthetic worst cases for every op and variant, plus 60 transfers of each example.
- **Real CU ≤ gas charged in every run.** The largest real/gas ratio is 0.905 and the smallest margin is 144 CU.
- Per-op maxima and weights are in `vm/bench/cu.json` and SPEC §6.
- Static worst case ≥ observed in every fuzz run.

## Fuzz numbers per example (10,000 transfers each, seed 1)
| Example | Bytes | Ops | Static worst CU | CU avg / max seen | Refused | Errors / panics | Rust parity | Honeypot |
|---|---|---|---|---|---|---|---|---|
| king-of-the-hill | 197 | 46 | 5,485 | 2,547 / 3,990 | 6.5% (sells by the king) | 0 / 0 | 10,000/10,000 | ok (lock ≤ 6h) |
| usurp | 176 | 39 | 5,555 | 2,875 / 4,060 | 6.7% | 0 / 0 | 10,000/10,000 | ok (≤ 12h) |
| jackpot (every 100th buy) | 69 | 23 | 3,100 | 1,972 / 3,100 | 0% | 0 / 0 | 10,000/10,000 | ok |
| first-2h-quarter (site example) | 110 | 15 | 2,140 | 1,279 / 2,140 | 22.3% | 0 / 0 | 10,000/10,000 | ok |
| weekend-closed (NY time, DST) | 131 | 17 | 2,345 | 2,178 / 2,345 | 62.4% | 0 / 0 | 10,000/10,000 | ok (≤ 2 days) |
| pump-pause (30% in 10m) | 122 | 12 | 2,115 | 1,798 / 2,115 | 6.7% | 0 / 0 | 10,000/10,000 | ok |
| hot-potato | 316 | 64 | 7,155 | 3,026 / 4,255 | 4.1% | 0 / 0 | 10,000/10,000 | ok (≤ 2h) |
| fomo (countdown pot) ★ new | 191 | 53 | 4,790 | 2,764 / 4,225 | 0% | 0 / 0 | 10,000/10,000 | ok |
| stairs (≤ 2× last buy) ★ new | 117 | 20 | 2,615 | 2,117 / 2,615 | 5.0% | 0 / 0 | 10,000/10,000 | ok |
| open-mic (1 buyer / 30s) ★ new | 124 | 27 | 2,705 | 2,066 / 2,425 | 22.3% | 0 / 0 | 10,000/10,000 | ok |
| invite | 169 | 26 | 3,130 | 1,716 / 2,500 | 19.2% | 0 / 0 | 10,000/10,000 | ok |
| tag | 159 | 27 | 3,400 | 1,364 / 2,715 | 2.0% | 0 / 0 | 10,000/10,000 | ok (≤ 6h) |
| one-bite | 80 | 9 | 1,355 | 1,154 / 1,355 | 64.0% | 0 / 0 | 10,000/10,000 | ok |
| louder | 92 | 16 | 1,885 | 1,341 / 1,885 | 6.8% | 0 / 0 | 10,000/10,000 | ok |
| queue | 167 | 36 | 4,305 | 2,220 / 3,130 | 14.0% | 0 / 0 | 10,000/10,000 | ok (≤ 12h) |
| birthday (party hats) | 52 | 16 | 2,080 | 1,521 / 1,820 | 0% | 0 / 0 | 10,000/10,000 | ok |
| sunrise (Tokyo daylight) | 107 | 7 | 1,545 | 1,513 / 1,545 | 72.5% | 0 / 0 | 10,000/10,000 | ok (≤ 12h) |
| last-call | 107 | 9 | 1,330 | 1,151 / 1,330 | 4.6% | 0 / 0 | 10,000/10,000 | ok |
| library | 167 | 25 | 2,540 | 2,343 / 2,540 | 51.4% | 0 / 0 | 10,000/10,000 | ok |
| full-moon | 81 | 9 | 1,550 | 1,010 / 1,550 | 2.3% | 0 / 0 | 10,000/10,000 | ok (≤ 24h) |
| odd-even | 140 | 22 | 2,540 | 1,727 / 1,925 | 47.1% | 0 / 0 | 10,000/10,000 | ok |
| no-aggregator-launch (`transfer.app`) | 157 | 14 | 1,885 | 1,153 / 1,885 | 3.1% | 0 / 0 | 10,000/10,000 | ok |

The honeypot checker flags all 6 planted honeypots in `fuzz/honeypots/`:
- sell only what you bought this hour;
- no sells;
- an eternal king;
- a 90-day lock;
- sell only above 2× (caught by the bank run);
- creator-only sells.

## Site compatibility
The four scripts the site's `draftDemo` shows today compile verbatim with the `rule / when / let / refuse if … because` form:
- "sell no more than you bought", 95 B;
- weekend, 94 B;
- pump, 109 B;
- quarter-bag, 117 B.

The honeypot check flags the first one: the bank run gets stuck on "You can sell at most what you bought in the last 2h". The other three pass.

## Integration notes
- **BACKEND:** `import { draft } from '../../hookscript/drafter/draft.ts'`. Import by relative path: Node strips TS types
  only outside `node_modules`. It returns the `draftHookscript` shape
  (`prompt, script, ops, cu, fuzz{trades, refusedPct, panics, maxCu}, reviewed:false`) plus `ok, bytecodeHex, bytes,
  honeypot, warnings, errors, abi, provider, model, template, attempts`.
  - `cu` is the static worst case, compared against 8,000. `fuzz.maxCu` is the largest seen in fuzzing, and `fuzz.avgCu` the typical cost.
  - `abi` gives the globals, wallet vars and payouts the keeper reads.
  - For quotes, `import { compile, run, ctx } from 'hookscript'` (`compiler/src/index.ts`).
- **Keeper:** payout declarations are in `abi.payouts` (`stream` / `pot` / `split`), and the globals are at `Script` offset 16 + `abi.globals[i].offset`.
- **Site:** the site docs still say "16 ops and three constants" and "at most 8,000 CU". The real limits are 1,024 bytes and
  8,000 CU (SPEC §7). The demo `draftDemo` example #1 ("sell no more than you bought this hour") is a honeypot. The
  offline drafter returns a safe version with a 24h escape. `compiler/src/index.ts` and `interp.ts` are browser-safe;
  `fuzz/` and `drafter/` use Node APIs.

## Blocked / not done
- No live Claude call was made: there's no `ANTHROPIC_API_KEY` on this machine. The provider path is tested with a mock client.
  `@anthropic-ai/sdk` is installed as an optional dependency in `hookscript/node_modules`.
- The NZ, Chile, Iran, Israel and Egypt DST rules aren't modeled. Those zones are refused with a hint to use a fixed offset.
