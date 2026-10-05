# hookrz_engine status

_Updated 2026-10-04 20:20._

- **Program id (local fork):** `EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr`. The keypair `program-keypair.json` is local only
  (gitignored: a public keypair would let anyone deploy to the address first). Use a fresh one for devnet/mainnet.
- **.so:** `hookrz_engine.so` + `.sha256` is the stable, **stripped** deployable (145,704 bytes ≈ 0.74 SOL of rent at
  5,080 lamports/byte). `target/sbpf-solana-solana/release/hookrz_engine.so` is the latest unstripped build (~180 KB, same code).
- **Instruction data, accounts, params, layouts:** `LAYOUT.md`. JS encoder/decoder: `js/layout.mjs` (BACKEND wraps it in `server/src/layout.ts`).

## Done (steps 1–5)
1. Execute (C1 anti-forgery, buy/sell/send against the base vault), init_stack (creator-only, once → 6143), open_wallet,
   close_wallet / close_stack (only after the hook is retired → 6142), ExtraAccountMetaList. No PDA derivation in Execute.
2. All 12 phase-1 blocks with blocks.js codes, params and ranges: snipe-shield, anti-bundle, max-wallet, rising-max,
   sandwich-guard, sell-cap, sell-cooldown, hold-timer (H1 lots), circuit-breaker (exact sqrt² maths, L1 pool checks),
   trading-hours, lock-in (DBC quote_reserve / migration_quote_threshold), creator-vest.
3. Parity vectors from `web/src/engine/engine.js`: **9,625 / 9,625 pass**.
4. Hookscript linked (`hookscript-vm` path dependency; default feature `hookscript`): `verify` at init (→ 6128), run after the
   blocks (→ 6128, reason text in the log), globals and wallet vars persist on Allow. Script account layout from
   hookscript/SPEC.md §8. Wallet record grew to 328 bytes with the fields SPEC.md §8 asked for (bought, sold, buys, sells,
   last_buy_ts, outflow lots). Scripts too big for the launch tx are staged with `write_script` (0xA4) and sealed by init_stack.
5. CU measured in LiteSVM (below): worst case **13,481 CU** (budget 30,000), on the pinocchio build.

Final VM (19:50): linked against HOOKSCRIPT's calibrated VM (gas includes the `450 + 30 × reasons` setup charge, cap 8,000).
The engine API use was already final: `verify` at init_stack, `Refuse { reason_id, arg }` → `format_reason(code, id, arg)` in
the log. Fixtures replaced with hookscript/vm/fixtures (`heavy` is now 15 window reads at gas 7,725) plus the compiled
`koth-example.hex` (examples/king-of-the-hill.hs) and `hot-potato.hex`; `tests/fixtures.rs` checks every fixture still
passes the linked `verify`. A fork test runs both compiled examples on chain. BACKEND's `cd server && npm test`: 16/16 pass
on this .so.

Any deployed address (19:40): every owner and PDA check uses the runtime `program_id` passed to the entrypoint. The one
hard-coded use (`&ID` in the Script owner check) is gone; `declare_id!` stays only as the local-fork default for off-chain
callers and `cargo test`, and nothing on chain reads it. The fork suite passes both at the default id (`npm test`) and with
the same .so loaded at a random address (`npm run test:any-address`), so the devnet build is this same .so.

Follow-ups done (coordinator, 19:05):
- **Sandwich Guard taint:** a send passes the sender's last buy (slot and time) to the receiver if later than its own, so
  buy → send to a second account → sell inside the lockout is refused (fork test). The sim does the same. Trade-off: someone
  who just bought can send dust to hold a wallet's sells for up to `slots` slots (≤ 150, ~60 s), paying for a buy each time.
- **Hold Timer through sends:** already safe: locked coins can't leave, and coins that arrive by a send start a new lot.
- **Sell Cooldown** is per wallet and can be split across wallets (sybil); left as is.
- **Creator Vesting now matches the site:** the creator's launch bag (everything it buys in the slot of its first buy,
  normally the launch transaction) is stored in the slot state; nothing of it may leave before the cliff, then it unlocks in a
  straight line over `days`. Coins the creator gets later are free. blocks.js `check()` and its error text changed to match
  (`vestLocked`, ctx `creatorBase`), the sim tracks the launch bag, and `web/src/ui/blocks-detail.js`'s creator-vest
  "lands" scenario now sells a vested-sized amount (one-line change; the old one would be refused under the new rule).
  `cd web && npm test`: 8 pass. Creator Vesting now writes slot state, so its Stack is writable (transfers serialize on it).
- **DBC fee for Hookscript:** init_stack copies the config's base-fee schedule into the Custom slot state and the pool's
  activation point into the Stack; `fee_bps` is the scheduler's current base fee (linear or exponential). The dynamic fee and
  the rate limiter's size-dependent part are not included. Fork test: a script refuses buys while the fee is above 10%.

Fork tests (LiteSVM with the mainnet Token-2022 + ATA binaries and stand-in DBC pool/config accounts): **17 pass** (and 17 at a random program address), covering
every block's refusal and pass path, C1 (direct Execute → 6000), creator-only init, re-init (6143), bad params, the creator
launch-buy exemption, H1 dust, 6141, L1, Creator Vesting's launch bag and straight line plus its ImmutableOwner guard, the
Sandwich Guard send taint, close paths (6142, then refunds), M1 pre-funded PDAs, King of the Hill (6128 + globals + wallet
vars), staged scripts, a script reading the DBC fee, and the compiled king-of-the-hill.hs and hot-potato.hs examples. BACKEND's e2e
(`server/tests/e2e-fork.test.ts`) runs the engine against the real DBC binary (launch, refusals, graduation, close).

## Deploy size (20:20)
Goal: ≤ 148,000 bytes deployed without dropping features. Done: **145,704 bytes** stripped, every feature and test kept.

| Step | .so bytes (unstripped / stripped) |
|---|---:|
| Before: solana-program, `msg!` formatting, its default panic handler | 284,368 / – |
| 1. No `core::fmt` on chain: static log strings + `sol_log_64` for numbers, a silent panic handler | 268,360 / 225,296 |
| 2. pinocchio 0.11 + pinocchio-system (zero-copy entrypoint, `no_std`, no allocator, non-formatting panic handler) | 192,552 / 168,672 |
| 3. One non-generic `create_pda`; no 128-bit division in the engine (u64 maths for the fee base and curve progress) | – / 166,592 |
| 4. `opt-level = "z"` for everything | 177,888 / 142,368 (but wallet-record CU ×2.5) |
| 5. **Final:** engine at `opt-level = 3`, dependencies (VM, pinocchio) at `"z"`; ASCII-only log text (no UTF-8 validator) | – / **145,704** |
| (for reference) the same without the Hookscript VM (`--no-default-features`) | – / 86,800 |

What's in the 145,704: ~58 KB is the Hookscript VM (run, verify/analyze at init, window sums, clock/moon/daylight maths),
~12 KB the 12 blocks, the rest the engine (Execute, init_stack, wallet records, CPIs) and ~5 KB of core's panic-message
plumbing (bounds-check panics reference number Display even though the handler never formats; removing that needs
`build-std` with `panic_immediate_abort`, which the platform-tools toolchain doesn't offer). The VM's `format_reason` is no
longer called on chain, so it isn't linked. Overflow checks stay on.

Deploy the stripped file: `llvm-objcopy --strip-all target/sbpf-solana-solana/release/hookrz_engine.so hookrz_engine.so`
(`cargo build-sbf` strips the same way).

Log change (for the indexer): a Hookscript refusal now logs the reason's template unformatted plus a numbers line (see
LAYOUT.md, Execute). `server/src/service.ts explain()` takes the text after `Hookscript: ` as the message, so it will show
`{}` where the value goes; BACKEND should fill it with the TS `format_reason` from the numbers line (or from its own quote).
All error codes and the `Error Code: … Error Number: …` lines are unchanged.

## Changes BACKEND should know
- Wallet record is **328 bytes** (was 224); `js/layout.mjs` decodeWallet reads the new fields.
- A Custom slot adds the pool and both wallet records to the meta list; a script with the APP flag (header byte 3 & 0x08)
  also adds the instructions sysvar. `server/src/layout.ts metaListEntries` needs both for scripted stacks.
- Creator Vesting: the meta list marks the Stack writable when the stack has Creator Vesting (as for Anti-Bundle and the
  breaker). Quotes should pass `creatorBase` (`js/layout.mjs creatorBaseOf(decodeStack(...))`) in the reference ctx; without it
  the JS check treats the creator's whole balance as the launch bag.
- Script account: 1,296 bytes, globals at offset 16, code at 272. `writeScriptData` + init flag `staged` for big scripts.
- Use quote-token fee collection on the DBC config: a base-token fee claim out of the base vault would count as a buy
  (and need the claimer's Wallet record on stacks that keep records).

## Known gaps
- Hookscript `fee_bps` has no dynamic fee (BACKEND's configs don't enable it).
- Sell Cooldown can be split across wallets (sybil), by design.
- Creator Vesting holds every creator-owned token account to the launch-bag line (normally there is only the ATA).
- A staged script that is never sealed keeps its rent (no close path for it yet).
- With the calibrated VM, real CU stays under the script's `gas_max` (heavy: gas 7,725, ~5,000 CU of VM time on top of the
  empty-script cost).

## CU (LiteSVM, engine's own Execute CU from the program log; pinocchio build)
Each block alone, on a passing transfer with history (5 receipt lots, a prior sell, a linear sniper-fee schedule).
"marginal" = max over kinds minus the base. The pinocchio entrypoint halved the base cost (was ~2,650).

| Block | buy | sell | send | marginal |
|---|---:|---:|---:|---:|
| engine base (dispatch, C1 checks, Stack, classification; 1 trivial slot) | 1,209 | 1,211 | 1,195 | |
| snipe-shield | 1,219 | 1,206 | 1,200 | 10 |
| anti-bundle | 1,279 | 1,250 | 1,244 | 70 |
| max-wallet | 1,312 | 1,202 | 1,308 | 113 |
| rising-max | 1,498 | 1,200 | 1,495 | 300 |
| sandwich-guard (loads + writes wallet records) | 2,188 | 2,270 | 3,164 | 1,969 |
| sell-cap | 1,200 | 1,313 | 1,196 | 102 |
| sell-cooldown (wallet records) | 2,187 | 2,274 | 3,163 | 1,968 |
| hold-timer (wallet records + lots) | 2,219 | 2,364 | 3,307 | 2,112 |
| circuit-breaker (pool read + slot state) | 2,780 | 2,784 | 1,670 | 1,573 |
| trading-hours | 1,209 | 1,211 | 1,195 | 0 |
| lock-in (pool read) | 1,324 | 1,437 | 1,320 | 226 |
| creator-vest (slot state) | 1,249 | 1,251 | 1,245 | 50 |
| custom: empty script (pool + wallets + VM fixed cost) | 3,693 | 3,742 | 5,090 | 3,895 |
| custom: fee gate (reads price, progress, DBC fee) | 6,492 | 6,048 | 7,396 | 6,201 |
| custom: hand-assembled KotH | 6,000 | 5,578 | 6,595 | 5,400 |
| custom: heavy (gas_max 7,725, 15 window sums) | 10,060 | 10,216 | 11,975 | 10,780 |

| Worst-case 6-slot stack | buy | sell | send |
|---|---:|---:|---:|
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + lock-in + rising-max | 4,483 | 4,504 | 4,466 |
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + anti-bundle + snipe-shield | 4,244 | 4,408 | 4,180 |
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + lock-in + custom (KotH) | 7,876 | 7,722 | 7,477 |
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + lock-in + custom (heavy) | 12,247 | 12,671 | 13,168 |
| hold-timer + circuit-breaker + anti-bundle + rising-max + creator-vest + custom (heavy) | 12,590 | 12,509 | **13,481** |

Compiled example scripts on their heaviest paths (`fork/cu.mjs`):

| Script, path | alone | + the 5 heavy blocks | verdict |
|---|---:|---:|---|
| hot-potato: buy catches the potato | 7,880 | 9,744 | ok |
| hot-potato: send passes the potato | 10,607 | 11,467 | ok |
| hot-potato: buy burns the holder and catches | 10,337 | 12,231 | ok |
| hot-potato: burnt wallet's buy | 8,156 | 9,903 | 6128 |
| hot-potato: holder's sell | 8,856 | 10,803 | 6128 |
| king-of-the-hill: buy takes the crown | 9,010 | 10,874 | ok |
| king-of-the-hill: buy outbids the faded bar | 9,137 | 10,989 | ok |
| king-of-the-hill: king's send | 8,234 | 8,950 | 6128 |
| king-of-the-hill: sell by a non-king | 5,541 | 7,627 | ok |

Worst case: **13,481 CU** (budget 30,000). Refusals no longer format text, so they now cost less than the landing paths.
The whole `transfer_checked` (Token-2022 plus its extra-account resolution plus the engine) is 32k–50k CU in these runs, so
swaps should set a compute-unit limit.

## Build and test
```
export PATH=$HOME/.cache/solana/v1.57/platform-tools/rust/bin:$HOME/.cache/solana/v1.57/platform-tools/llvm/bin:$PATH CARGO_HOME=$HOME/.cache/solana/cargo-home
cargo build --release --target sbpf-solana-solana          # → target/sbpf-solana-solana/release/hookrz_engine.so (with the VM)
llvm-objcopy --strip-all target/sbpf-solana-solana/release/hookrz_engine.so hookrz_engine.so   # the deployable (145,704 B)
cargo build --release --target sbpf-solana-solana --no-default-features   # without the VM (refuses scripted stacks)
cargo test --release                                       # host unit tests (11) + fixture verify + parity vectors (9,625)
node vectors/gen.mjs                                       # regenerate vectors from web/src/engine (then cargo test)
cargo run --release --example hs_fixtures                  # re-assemble empty/koth/feegate (heavy, koth-example, hot-potato come from hookscript/)
cd fork && npm install && npm test                         # LiteSVM fork tests (17)
cd fork && npm run test:any-address                        # the same 17 with the .so loaded at another address
cd fork && node cu.mjs                                     # CU table → fork/cu.json
```

## Test results
- Parity: 9,625 / 9,625 vectors pass (12 block files incl. 2,668 Creator Vesting cases, 1,501 random multi-block stacks,
  the 8 engine.test.mjs cases). The generator dropped 2 circuit-breaker vectors where the float reference can't resolve 1 raw
  unit at the band edge.
- Host unit tests: 11 pass, plus the fixture verify test. Fork tests: 17 pass at the default id and 17 at a random
  address. `web` npm test: 8 pass. BACKEND `server` npm test: 17 pass on the stripped pinocchio .so.
