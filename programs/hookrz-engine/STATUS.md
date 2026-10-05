# hookrz_engine status

_Updated 2026-10-04 22:00. The deployed devnet program (5bewmr…, 145,704 B) is the previous build; this tree is the
upgrade candidate (not deployed): `node server/scripts/deploy-engine.cjs … --upgrade`._

- **Program id (local fork):** `EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr`. The keypair `program-keypair.json` is local only
  (gitignored: a public keypair would let anyone deploy to the address first). Use a fresh one for devnet/mainnet.
- **.so:** `hookrz_engine.so` + `.sha256` is the stable, **stripped** deployable: **137,968 bytes**, sha256
  `8da568a15f4293410576af0ebaf56dae0a680de3c74d82eea1fece8f7270c0d1` (≈ 0.701 SOL of rent at 5,080 lamports/byte for a fresh
  deploy; an in-place upgrade keeps the existing 145,704-byte program-data account, so it needs no extra SOL).
  `target/sbpf-solana-solana/release/hookrz_engine.so` is the latest unstripped build (~157 KB, same code).
  `fork/fixtures/deployed-v1.so` is the build deployed on devnet (145,704 B, sha256 `1a78d1f9…`), kept for the upgrade test.
- **Instruction data, accounts, params, layouts:** `LAYOUT.md`. JS encoder/decoder: `js/layout.mjs` (BACKEND wraps it in `server/src/layout.ts`).

## Done (step 6, 22:00): the six remaining hook blocks, all native
Every hook block in blocks.js now runs on chain: 18 blocks + Hookscript. All six fit natively, with room to spare, because the
engine lost every bounds-check panic (see Deploy size). No Hookscript fallback was needed.

| Block | Code | Mechanism | Extra accounts | Marginal CU (max of buy/sell/send) |
|---|---|---|---|---:|
| blocklist | 6006 | a mark PDA `["mark", mint, owner]` per owner (bit 1), set by the creator with `set_mark` (0xA5) while the list is open: launch slot, or `lock` seconds after launch (24h; `0xFFFFFFFF` = until graduation, when the hook is retired; 0 = launch slot only). Refuses the sender's owner (sells, sends) or the receiver's owner (buys, sends) | 2 (both owners' marks; account-data seeds) | 134 |
| allowlist-phase | 6007 | the same mark, bit 2 = pass, granted by the creator any time; buys during the first `minutes` need a pass. The creator's launch-slot buy is exempt | 2 (shared with Blocklist) | 133 |
| seasoned-sells | 6013 | wallet record's first receipt: cap = srcBefore × min(100, base + step × hours)% | the 2 wallet records | 1,507 (the wallet-record path) |
| outflow-cap | 6014 | slot state `hour since launch · sold`, the bucketed counter Anti-Bundle already used (shared code); Stack writable | 0 | 170 |
| token-gate | 6017 | init_stack takes the gate mint; the meta list derives the receiver owner's ATA of it (external PDA of the ATA program, seeds from account data); param = raw minimum | 4 (gate mint, its token program, ATA program, the ATA) | 113 |
| chapters | 6018 | DBC `quote_reserve` / stored threshold (as Lock-in), exact integer `chapterOf`; cap = first_bps << chapter | 1 (the pool) | 526 |

New instruction **`set_mark` (0xA5)**, creator-signed (LAYOUT.md).

Bytes each block adds to the stripped .so, measured by building the final source without it (all six: +11,392):

| Block(s) | Bytes |
|---|---:|
| blocklist + allowlist-phase + `set_mark` + the two mark metas (shared; the allowlist check itself is ~50 B) | 5,592 |
| token-gate (init_stack gate mint, 4 metas incl. the external ATA PDA, the ATA read) | 4,152 |
| seasoned-sells | 856 |
| outflow-cap (shares Anti-Bundle's bucketed counter) | 528 |
| chapters | 520 |

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

## Deploy size (22:00)
Goal: ≤ 147,400 bytes deployed (about 0.75 SOL) with all 18 blocks. Done: **137,968 bytes** stripped, 7,736 bytes smaller
than the deployed 12-block build.

| Step | .so bytes (unstripped / stripped) |
|---|---:|
| Before: solana-program, `msg!` formatting, its default panic handler | 284,368 / – |
| 1. No `core::fmt` on chain: static log strings + `sol_log_64` for numbers, a silent panic handler | 268,360 / 225,296 |
| 2. pinocchio 0.11 + pinocchio-system (zero-copy entrypoint, `no_std`, no allocator, non-formatting panic handler) | 192,552 / 168,672 |
| 3. One non-generic `create_pda`; no 128-bit division in the engine (u64 maths for the fee base and curve progress) | – / 166,592 |
| 4. `opt-level = "z"` for everything | 177,888 / 142,368 (but wallet-record CU ×2.5) |
| 5. Engine at `opt-level = 3`, dependencies (VM, pinocchio) at `"z"`; ASCII-only log text (no UTF-8 validator) | – / 145,704 (deployed) |
| 6. Same 12 blocks with no bounds-check panics in the engine: account data is read through fixed-size array views (`head::<N>()`: one length check per account, then every field offset is checked at compile time), slots and lots via `as_chunks`, `p: &[u8; 24]` params, `get()` for variable data. Each removed panic site was ~60 B (call, `lddw` of a Location, a 16-byte relocation; 142 sites). The 17 static `Error Code: … Error Number: …` strings (an `lddw` + relocation each) became one names table with compile-time offsets; the line is built in a stack buffer | – / 126,576 (measured: the final source minus the six blocks) |
| 7. **Final: + the six blocks, `set_mark`, mark and gate metas** | 156,680 / **137,968** |
| (for reference) the same without the Hookscript VM (`--no-default-features`) | – / 86,800 (12 blocks, 20:20); 74,272 now (18 blocks) |

Left on the table, if size is ever needed again: core's panic formatting is still linked by three `copy_from_slice` calls in the
Hookscript VM (`exec`, `ring_read`, `ring_write`); making those infallible would drop `<u64 as Display>::fmt`, `pad_integral` and
`do_count_chars` (~3.5 KB). The engine at `opt-level = 2` is another ~2.6 KB smaller (not measured for CU).

What was in the 145,704 (before step 6): ~58 KB is the Hookscript VM (run, verify/analyze at init, window sums, clock/moon/daylight maths),
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

## Changes BACKEND should know (22:00, done in server/)
- `js/layout.mjs`: BLOCK_IDS + packParams for the six blocks; `IX.setMark`, `setMarkData`, `SEEDS.mark`, `MARK`, `decodeMark`,
  `gateOf`, `hourSoldOf`, `GATE_TOKENS` ($BONK/$WIF/$JUP mainnet mints; $HOOKRZ has none and is refused), `BLOCKLIST_LOCK`.
  Token Gate packs `minRaw` (whole `min` × 10^decimals of the gate mint).
- `server/src/layout.ts` meta-list order (marks, then gate mint, token program, ATA program, ATA), `initStackAccounts` gate
  mint, `setMarkAccounts`; `hook.ts` `setMarkIx`, `markPda`, `readMark`, `extrasFromStack`; new `server/src/marks.ts`
  (gate resolution, marks list/read/prepare, fork stand-in gate mints).
- Launch: `resolveGate` maps the ticker to a mint on this network (`HOOKRZ_GATE_MINTS='{"$BONK":"<mint>"}'` overrides; devnet has
  none of the mainnet mints) → `GATE_NOT_LIVE` / `GATE_MINT_MISSING` at prepare. `body.marks: [{ owner, blocked?, pass? }]` are
  written in the init_stack transaction (the only way to fill a Blocklist that freezes "immediately"; 3 marks fit beside a creator buy).
- Endpoints: `GET /v1/coins/:mint/marks`, `GET /v1/coins/:mint/marks/:owner`, `POST /v1/coins/:mint/marks/prepare`
  (creator-only; unsigned set_mark txs, ~13 per tx; `BLOCKLIST_FROZEN` when the block bit can't change).
- Swaps: the DBC SDK resolves hook accounts with dummy keys, which throws on account-data seeds; `market.ts buildSwap` now
  rebuilds the list from the Stack's flags for stacks with marks or a Token Gate (`extrasFromStack`). Other stacks are unchanged.
- Quotes: `buildCtx` takes the trader's mark flags and gate balance (`traderLists`); the creator-buy check reads the creator's gate balance.

## Changes BACKEND should know (earlier)
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
- Marks are never closed (65 B each, ~0.0013 SOL, paid by the creator); a close path after the hook is retired is not written.
- Third-party clients that resolve hook accounts with the spl-token / DBC SDK resolver before the buyer's token account exists
  (or with dummy accounts) can't build swaps for Blocklist / Allowlist / Token Gate coins; hookrz's own builder can. The whole
  `transfer_checked` (Token-2022's PDA derivations for marks and the gate ATA plus the engine) is ~55k–70k CU for those stacks.
- Blocklist marks are per owner: a blocked holder can still use a fresh wallet (as with any blocklist).
- Hookscript `fee_bps` has no dynamic fee (BACKEND's configs don't enable it).
- Sell Cooldown can be split across wallets (sybil), by design.
- Creator Vesting holds every creator-owned token account to the launch-bag line (normally there is only the ATA).
- A staged script that is never sealed keeps its rent (no close path for it yet).
- With the calibrated VM, real CU stays under the script's `gas_max` (heavy: gas 7,725, ~5,000 CU of VM time on top of the
  empty-script cost).

## CU (LiteSVM, engine's own Execute CU from the program log; pinocchio build)
Each block alone, on a passing transfer with history (5 receipt lots, a prior sell, a linear sniper-fee schedule).
"marginal" = max over kinds minus the base. The pinocchio entrypoint halved the base cost (was ~2,650).

Current build (22:00). The array-view rewrite also cut the engine base by ~100 CU and the wallet-record path by ~450 CU.

| Block | buy | sell | send | marginal |
|---|---:|---:|---:|---:|
| engine base (dispatch, C1 checks, Stack, classification; 1 trivial slot) | 1,112 | 1,107 | 1,088 | |
| blocklist (both marks exist) | 1,191 | 1,193 | 1,222 | 134 |
| allowlist-phase (pass granted) | 1,196 | 1,192 | 1,221 | 133 |
| seasoned-sells (wallet records) | 1,851 | 2,036 | 2,595 | 1,507 |
| outflow-cap (slot state) | 1,152 | 1,277 | 1,141 | 170 |
| token-gate (gate ATA read) | 1,212 | 1,174 | 1,201 | 113 |
| chapters (pool read) | 1,638 | 1,203 | 1,197 | 526 |
| hold-timer (wallet records + lots) | 1,881 | 2,013 | 2,718 | 1,630 |
| circuit-breaker | 2,664 | 2,661 | 1,556 | 1,554 |
| custom: heavy (gas_max 7,725) | 9,646 | 9,810 | 11,300 | 10,212 |

| Worst-case 6-slot stack (current build) | buy | sell | send |
|---|---:|---:|---:|
| hold-timer + circuit-breaker + anti-bundle + rising-max + creator-vest + custom (heavy) | 12,023 | 11,967 | **12,655** |
| hold-timer + circuit-breaker + token-gate + blocklist + seasoned-sells + custom (heavy) | 11,913 | 12,260 | 12,605 |
| token-gate + allowlist-phase + outflow-cap + circuit-breaker + hold-timer + custom (heavy) | 11,924 | 12,265 | 12,610 |
| hold-timer + circuit-breaker + allowlist-phase + chapters + creator-vest + custom (heavy) | 12,245 | 12,059 | 12,501 |

Worst case **12,655 CU** (budget 30,000), down from 13,481. Full table: `fork/cu.json` (`node fork/cu.mjs`). The whole
`transfer_checked` for stacks with marks or a Token Gate is 52k–70k CU (Token-2022 derives the mark and ATA PDAs).

Previous build (20:20, for reference):

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
llvm-objcopy --strip-all target/sbpf-solana-solana/release/hookrz_engine.so hookrz_engine.so   # the deployable (137,968 B)
cargo build --release --target sbpf-solana-solana --no-default-features   # without the VM (refuses scripted stacks)
cargo test --release                                       # host unit tests (14) + fixture verify + parity vectors (19,870)
node vectors/gen.mjs                                       # regenerate vectors from web/src/engine (then cargo test)
cargo run --release --example hs_fixtures                  # re-assemble empty/koth/feegate (heavy, koth-example, hot-potato come from hookscript/)
cd fork && npm install && npm test                         # LiteSVM fork tests (27: engine, new-blocks, upgrade)
cd fork && npm run test:any-address                        # the same 27 with the .so loaded at another address
cd fork && node cu.mjs                                     # CU table → fork/cu.json
```

## Test results (22:00)
- Parity: **19,870 / 19,870** vectors pass: the original 9,625 (byte-identical apart from four neutral ctx fields) plus
  10,245 for the six new blocks (edge cases from each `check()`, 400 random each, 1,500 random stacks over all 18 blocks).
- Host unit tests: 14 pass (incl. every error line and the lot sort against a stable reference) + the fixture verify test.
- Fork tests: **27 pass** at the default id and 27 at a random address: the 17 earlier ones, a refusal and a pass for each
  new block (blocklist ×2 incl. freeze and "immediately", allowlist ×2, seasoned-sells, outflow-cap, token-gate incl. a
  Token-2022 gate, chapters, every meta kind in one stack), and an in-place upgrade from the deployed build.
- `cd server && npm test`: **30 pass** (4 new end-to-end tests with the real DBC: Members Club with $BONK, Blocklist + Allowlist
  via launch marks and the marks endpoints, Seasoned Sells, Hourly Outflow Cap; JS quote and chain agree on every trade).
  `npx tsc --noEmit` clean. `cd web && npm test`: 31 pass.

## Test results (20:20)
- Parity: 9,625 / 9,625 vectors pass (12 block files incl. 2,668 Creator Vesting cases, 1,501 random multi-block stacks,
  the 8 engine.test.mjs cases). The generator dropped 2 circuit-breaker vectors where the float reference can't resolve 1 raw
  unit at the band edge.
- Host unit tests: 11 pass, plus the fixture verify test. Fork tests: 17 pass at the default id and 17 at a random
  address. `web` npm test: 8 pass. BACKEND `server` npm test: 17 pass on the stripped pinocchio .so.
