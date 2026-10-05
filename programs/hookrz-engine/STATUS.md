# hookrz_engine status

_Updated 2026-10-04 19:40._

- **Program id (local fork):** `EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr`. The keypair `program-keypair.json` is local only
  (gitignored: a public keypair would let anyone deploy to the address first). Use a fresh one for devnet/mainnet.
- **.so:** `target/sbpf-solana-solana/release/hookrz_engine.so` (latest build) and `hookrz_engine.so` + `.sha256` (last stable copy; Hookscript VM linked).
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
5. CU measured in LiteSVM (below): worst case **19,399 CU** (budget 30,000).

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

Fork tests (LiteSVM with the mainnet Token-2022 + ATA binaries and stand-in DBC pool/config accounts): **16 pass**, covering
every block's refusal and pass path, C1 (direct Execute → 6000), creator-only init, re-init (6143), bad params, the creator
launch-buy exemption, H1 dust, 6141, L1, Creator Vesting's launch bag and straight line plus its ImmutableOwner guard, the
Sandwich Guard send taint, close paths (6142, then refunds), M1 pre-funded PDAs, King of the Hill (6128 + globals + wallet
vars), staged scripts, and a script reading the DBC fee. BACKEND's e2e
(`server/tests/e2e-fork.test.ts`) runs the engine against the real DBC binary (launch, refusals, graduation, close).

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
- For HOOKSCRIPT: on SBF the VM costs about 1,200 CU fixed plus ~1.4 × the script's `gas_max` (the `heavy` fixture,
  gas_max 7,840, costs ~11,100 CU of VM time).

## CU (LiteSVM, engine's own Execute CU from the program log)
Each block alone, on a passing transfer with history (5 receipt lots, a prior sell, a linear sniper-fee schedule).
"marginal" = max over kinds minus the base.

| Block | buy | sell | send | marginal |
|---|---:|---:|---:|---:|
| engine base (dispatch, C1 checks, Stack, classification; 1 trivial slot) | 2,671 | 2,661 | 2,643 | |
| snipe-shield | 2,681 | 2,656 | 2,648 | 10 |
| anti-bundle | 2,729 | 2,684 | 2,676 | 58 |
| max-wallet | 2,774 | 2,652 | 2,756 | 113 |
| rising-max | 2,960 | 2,650 | 2,943 | 300 |
| sandwich-guard (loads + writes wallet records) | 4,078 | 4,147 | 5,002 | 2,359 |
| sell-cap | 2,662 | 2,763 | 2,644 | 102 |
| sell-cooldown (wallet records) | 4,077 | 4,151 | 5,001 | 2,358 |
| hold-timer (wallet records + lots) | 4,109 | 4,241 | 5,145 | 2,502 |
| circuit-breaker (pool read + slot state) | 4,433 | 4,425 | 3,303 | 1,764 |
| trading-hours | 2,671 | 2,661 | 2,643 | 0 |
| lock-in (pool read) | 2,985 | 3,086 | 2,967 | 425 |
| creator-vest (slot state) | 2,696 | 2,686 | 2,678 | 35 |
| custom: empty script (pool + wallets + VM fixed cost) | 5,494 | 5,528 | 6,480 | 3,837 |
| custom: fee gate (reads price, progress, DBC fee) | 8,111 | 7,821 | 8,773 | 6,130 |
| custom: King of the Hill (gas_max 820) | 6,903 | 6,424 | 7,139 | 4,496 |
| custom: heavy (gas_max 7,840, 30 window sums) | 15,984 | 16,156 | 17,567 | 14,924 |

Wallet-record blocks share their cost: the records are loaded and written once per transfer, however many blocks use them.
A script with the CURVE flag adds ~2,300 CU (u128 price, progress and fee maths).

| Worst-case 6-slot stack | buy | sell | send |
|---|---:|---:|---:|
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + lock-in + rising-max | 6,763 | 6,771 | 6,688 |
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + anti-bundle + snipe-shield | 6,528 | 6,675 | 6,402 |
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + lock-in + custom (KotH) | 8,970 | 8,759 | 8,206 |
| hold-timer + circuit-breaker + sandwich-guard + sell-cooldown + lock-in + custom (heavy) | 18,502 | 18,942 | 19,085 |
| hold-timer + circuit-breaker + anti-bundle + rising-max + creator-vest + custom (heavy) | 18,850 | 18,781 | **19,399** |

A heavy script that also reads the curve would land near 21,700. The whole `transfer_checked` (Token-2022 plus its
extra-account resolution plus the engine) is 30k–55k CU in these runs, so swaps should set a compute-unit limit.

## Build and test
```
export PATH=$HOME/.cache/solana/v1.57/platform-tools/rust/bin:$HOME/.cache/solana/v1.57/platform-tools/llvm/bin:$PATH CARGO_HOME=$HOME/.cache/solana/cargo-home
cargo build --release --target sbpf-solana-solana          # → target/sbpf-solana-solana/release/hookrz_engine.so (with the VM)
cargo build --release --target sbpf-solana-solana --no-default-features   # without the VM (refuses scripted stacks)
cargo test --release                                       # host unit tests (11) + parity vectors (9,625)
node vectors/gen.mjs                                       # regenerate vectors from web/src/engine (then cargo test)
cargo run --release --example hs_fixtures                  # hand-assembled Hookscript fixtures → fork/fixtures/*.hex
cd fork && npm install && npm test                         # LiteSVM fork tests (16)
cd fork && npm run test:any-address                        # the same 16 with the .so loaded at another address
cd fork && node cu.mjs                                     # CU table → fork/cu.json
```

## Test results
- Parity: 9,625 / 9,625 vectors pass (12 block files incl. 2,668 Creator Vesting cases, 1,501 random multi-block stacks,
  the 8 engine.test.mjs cases). The generator dropped 2 circuit-breaker vectors where the float reference can't resolve 1 raw
  unit at the band edge.
- Host unit tests: 11 pass. Fork tests: 16 pass at the default id and 16 pass at a random address. `web` npm test: 8 pass.
