# hookrz_engine: accounts, instruction data and param encodings

Program id (local fork): `EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr` (`program-keypair.json`). All integers are little-endian.
A JS encoder for everything on this page is in `js/layout.mjs` (`packParams`, `initStackData`, `decodeStack`, `decodeWallet`, PDAs); BACKEND can import it.

## PDAs (seeds, program = hookrz_engine)
| Account | Seeds |
|---|---|
| Stack | `["stack", mint]` |
| Script | `["script", mint]` |
| Wallet record | `["w", mint, token_account]` |
| ExtraAccountMetaList | `["extra-account-metas", mint]` |

## Instructions

### `init_stack` (`0xA0`): pool creator, once, in the launch
Accounts:
| # | Account | Notes |
|---|---|---|
| 0 | creator | signer, writable, pays rent. Must equal the DBC pool's `creator` |
| 1 | mint | Token-2022 mint. Its TransferHook must name hookrz_engine, with authority = DBC pool authority `FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM` |
| 2 | pool | DBC `TransferHookPool` of this mint |
| 3 | config | the pool's DBC config (`ConfigWithTransferHook` or `PoolConfig`), for `migration_quote_threshold` (Lock-in progress) |
| 4 | stack | writable, PDA |
| 5 | extra-account-metas | writable, PDA |
| 6 | script | writable, PDA (always passed; created only for a Hookscript stack) |
| 7 | system program | |
| 8 | parent stack | only if data flag bit 0 (a remix); its creator becomes `parent_author` |

Data:
```
0     u8   0xA0
1     u8   slot_count (1..=6)
2     u8   flags: bit 0 = a parent stack is passed as account 8; bit 1 = the script was staged with write_script (then script_len = 0)
3     slot_count × { block_id u16 | params [u8; 24] }      (26 bytes each)
+0    u16  script_len (0 = no Hookscript; must be > 0 exactly when a Custom slot (128) is present)
+2    [u8; script_len] Hookscript bytecode (≤ 1024)
```
Refusals: bad data, an unknown block, a duplicate block, params outside the ranges below → `InvalidInstructionData`;
already initialized → custom error **6143** `StackLocked`; a script that fails `hookscript_vm::verify` → **6128**.
(A build with `--no-default-features` has no VM and refuses every scripted stack.)

The ExtraAccountMetaList is written in this order, each entry only if the stack needs it:
1. Stack PDA (writable only if the stack has Anti-Bundle, Circuit Breaker or Creator Vesting, else read-only)
2. DBC pool (fixed address, read-only) if Circuit Breaker or Lock-in
3. Wallet(src) PDA `["w", mint, source]` and 4. Wallet(dst) PDA `["w", mint, destination]` (both writable) if Sandwich Guard, Sell Cooldown, Hold Timer or Custom
5. Script (fixed address, writable) if Custom
6. Instructions sysvar `Sysvar1nstructions1111111111111111111111111` (read-only) if the script's header has the APP flag (0x08, reads `transfer.app`)

A Custom slot (Hookscript) always adds the pool and both wallet records (scripts read price/progress and wallets).

### `write_script` (`0xA4`): pool creator, before init_stack (scripts too big for the launch transaction)
Accounts: creator (signer, w; the DBC pool's creator), mint (its hook names hookrz_engine), pool, stack PDA (must not exist yet),
script PDA (w), system program. Data:
```
0  u8   0xA4
1  u16  total script length (1..=1024)
3  u16  offset of this chunk
5  [u8] chunk bytes
```
The first call creates the Script account (version 0 = staged; never run). Chunks may be rewritten until init_stack is called with
data flag bit 1, which verifies the staged script and seals it (version 1). After that, write_script → **6143**.

### `open_wallet` (`0xA1`): anyone, idempotent
Accounts: payer (signer, w), mint, token account (Token-2022, of this mint), wallet record (w, PDA), system program. Data: `[0xA1]`.
The payer gets the rent back after graduation. A pre-funded record address is handled (M1).

### `close_wallet` (`0xA2`): anyone, after the hook is retired
Accounts: wallet record (w), mint, rent payer recorded at open (w). Data: `[0xA2]`. While the mint's hook still names
hookrz_engine → **6142** `HookLive`.

### `close_stack` (`0xA3`): anyone, after the hook is retired
Accounts: stack (w), extra-account-metas (w), script (w; pass the PDA even if the stack has no script), mint, pool creator (w).
Data: `[0xA3]`. Rent of all three goes to the creator recorded in the Stack. Live hook → **6142**.

### `Execute` (spl-transfer-hook-interface)
Token-2022 calls it with `[source, mint, destination, authority, extra-account-metas, …metas above]`.
- Refused with **6000** `NotInTransfer` unless source and destination are Token-2022 accounts of this mint and the
  source's TransferHookAccount `transferring` flag is set (C1).
- **buy** = source is the pool base vault, **sell** = destination is the base vault, otherwise **send**.
- If the stack uses wallet records: a missing record for the sender (sells, sends) or receiver (buys, sends) → **6141** `MissingWalletRecord`.
- Slots run in order; the first refusal fails the transfer with that block's code; the program log reads
  `Error Code: MaxWalletExceeded. Error Number: 6003`. Then the Hookscript, if any: a refusal logs
  `Hookscript: <reason text>` and fails with **6128**; a VM fault logs `HookscriptFault: <name>` and fails with 6128.
- State is written only after every check passed (the VM writes globals and wallet vars only on Allow).
- Hookscript Ctx: filled as hookscript/SPEC.md §8 says. `fee_bps` is the DBC base fee from the schedule copied at init (no dynamic
  fee); `price_e6`, `progress_ppm` and `fee_bps` are filled only when the script has the CURVE flag; `app` is zeros unless
  the script has the APP flag. Balances are before the transfer. `lots_in` / `lots_out` are the record's lots, oldest first.

## Block ids and params (24-byte slot param area; unused bytes must be 0)
block_id = error code − 6000. bps = percent × 100.

| id | Block | Code | Params (offset: type = value from blocks.js) | Ranges enforced at init |
|---|---|---|---|---|
| 1 | snipe-shield | 6001 | 0: u32 window seconds = `window`; 4: u16 max bps = `max`×100 | window 10..600, max 5..200 |
| 2 | anti-bundle | 6002 | 0: u32 window seconds = `window`×60; 4: u16 `perSlot` | 60..3600, 1..6 |
| 3 | max-wallet | 6003 | 0: u16 bps = `pct`×100 | 50..1000 |
| 4 | rising-max | 6004 | 0: u16 from bps = `from`×100; 2: u16 to bps = `to`×100; 4: u32 seconds = `hours`×3600 | 25..500, 100..2000, 3600..259200 |
| 5 | sandwich-guard | 6005 | 0: u32 `slots` | 1..150 |
| 8 | sell-cap | 6008 | 0: u16 bps = `pct`×100 | 10..500 |
| 9 | sell-cooldown | 6009 | 0: u32 seconds = `minutes`×60 | 60..14400 |
| 10 | hold-timer | 6010 | 0: u32 seconds = `minutes`×60 | 300..86400 |
| 11 | circuit-breaker | 6011 | 0: u32 window seconds = `window`×60; 4: u16 band bps = `band`×100 | 60..3600, 500..5000 |
| 12 | trading-hours | 6012 | 0: u8 `open` (UTC hour); 1: u8 `close` | open 0..23, close 1..24, **open < close** |
| 15 | lock-in | 6015 | 0: u16 bps = `pct`×100 (curve fill) | 1000..6000 |
| 16 | creator-vest | 6016 | 0: u32 cliff seconds = `cliff`×86400; 4: u32 vest seconds = `days`×86400 | 0..2592000, 604800..31536000 |
| 128 | custom | 6128 | none (all zero); the Hookscript runs after every slot | |

How the engine fills the reference `ctx` on chain:
- `t` = now − `launch_ts` (clamped ≥ 0); `hour` = UTC hour of the chain clock; `slot` = Clock slot; `supply` = mint supply.
- `amount` = transfer amount; `dstAfter` = destination balance after the transfer; `srcBefore` = source balance after + amount.
- `isCreator` (Snipe Shield, Anti-Bundle exemption) = destination owner is the Stack's creator **and** the slot is the launch slot.
- `isCreatorSrc` (Creator Vesting) = source owner is the creator. Hardening: while Creator Vesting is in the stack, the creator
  may only receive into accounts with ImmutableOwner (every ATA), else 6016, so `SetAuthority` can't move a vested bag.
- `progress` = pool `quote_reserve` / config `migration_quote_threshold` (stored at init). Read from the pool during the swap, i.e. after DBC applied the trade.
- `priceAfter` = pool sqrt price²; `windowOpenPrice` = sqrt² of the last trade's price when the window opened (the price at init for the first window).
- `w` = the sender's wallet record; `slotBuys` = buys already landed in this slot (Anti-Bundle state).
- `creatorBase` (Creator Vesting) = the creator's launch bag: everything it bought in the slot of its first buy (normally the
  launch transaction), kept in the slot state. Coins the creator gets later are free. The check is
  `srcBefore − amount < creatorBase × (1 − clamp((t − cliff) / span, 0, 1))` with nothing vested before the cliff.
- Comparisons are exact integer maths over raw units (e.g. Max Wallet: `dstAfter × 10000 > supply × bps`).

Known differences from the reference text (the checks themselves match blocks.js exactly):
- Creator Vesting is per owner: every creator-owned token account is held to the launch-bag line (an ATA is the only
  normal case). JS callers that don't know `creatorBase` fall back to the sender's whole balance.
- Hold Timer lots round the receipt time up to an epoch of ceil(hold / 4), so coins unlock between `hold` and 1.25 × `hold`
  after they arrive (the H1 fix: 5 lots always suffice and dust never extends an earlier lot). Quotes should use the stored lot times.
- A send passes the sender's last buy (`last_buy_slot`, `last_buy_ts`) to the receiver when it is later than the receiver's own,
  so buy → send to a second account → sell is still refused by Sandwich Guard (the reference sim does the same). The flip side:
  someone who just bought can send dust to lock a wallet's sells for up to `slots` slots (≤ 150, ~60 s), at the cost of a buy.
  Sell Cooldown is not carried: a cooldown per wallet can always be split across wallets.
- Hold Timer can't be laundered through sends: locked coins can't leave, and coins that arrive by a send start a new lot.

## Stack account (640 bytes)
| Off | Field | Type | Notes |
|---|---|---|---|
| 0 | discriminator | [u8; 8] | sha256("account:Stack")[..8] = `3a46a8f4bca9814f` |
| 8 | version | u8 | 1 |
| 9 | bump | u8 | |
| 10 | flags | u16 | 1 armed · 2 pool meta · 4 wallet metas · 8 script · 16 stack writable · 32 instructions sysvar meta (script APP flag) |
| 12 | slot_count | u8 | 1..6 |
| 13 | meta_bump | u8 | |
| 14 | script_bump | u8 | |
| 15 | reserved | u8 | |
| 16 | mint | Pubkey | |
| 48 | creator | Pubkey | DBC pool creator; init signer; close_stack rent receiver |
| 80 | pool | Pubkey | DBC pool |
| 112 | base_vault | Pubkey | out of it = buy, into it = sell |
| 144 | parent_stack | Pubkey | zero unless remixed |
| 176 | parent_author | Pubkey | parent Stack's creator |
| 208 | launch_slot | u64 | slot of init_stack |
| 216 | launch_ts | i64 | unix time of init_stack |
| 224 | slots[6] | 6 × 58 | `block_id u16 · params [u8;24] · state [u8;32]` |
| 572 | script | Pubkey | Script PDA (zero if none); replaces the docs' inline 64-byte script |
| 604 | last_sqrt | u128 | sqrt price after the last curve trade (Circuit Breaker) |
| 620 | migration_quote_threshold | u64 | from the DBC config at init (Lock-in) |
| 628 | activation_point | u64 | DBC pool activation point (slot or unix time), for the Hookscript fee read |
| 636 | reserved | [u8; 4] | |

Slot state:
- Anti-Bundle `0: u64 slot · 8: u64 buys in it`.
- Circuit Breaker `0: i64 window index (now / window) · 8: u128 window-open sqrt price`.
- Creator Vesting `0: u64 launch bag (raw) · 8: u64 slot of the creator's first buy · 16: u8 recorded`.
- Custom `0..27: the DBC config's BaseFeeConfig (cliff_fee_numerator u64 · period_frequency u64 · reduction_factor u64 ·
  number_of_period u16 · base_fee_mode u8) · 27: u8 activation type (0 slot, 1 timestamp) · 28: u8 dynamic fee on`, copied at init.
  Hookscript's `fee_bps` is the scheduler's base fee now (linear or exponential, as the DBC SDK computes it); the dynamic fee and
  the rate limiter's size-dependent part are not included.
- Others unused.

## Wallet record (328 bytes)
| Off | Field | Type | Notes |
|---|---|---|---|
| 0 | discriminator | [u8; 8] | sha256("account:Wallet")[..8] = `18593b8b519ae85f` |
| 8 | version | u8 | 1 |
| 9 | bump | u8 | |
| 10 | flags | u8 | 1 has bought (or received from a wallet that bought: see the send taint) · 2 has sold · 4 has received |
| 11 | lot_count | u8 | receipt lots with amount > 0 |
| 12 | first_receipt_ts | i64 | unix |
| 20 | last_buy_slot | u64 | Sandwich Guard; inherited through sends |
| 28 | last_sell_ts | i64 | unix; Sell Cooldown |
| 36 | lots_in[5] | 5 × { u32 t, u64 amount } | receipts; `t` = seconds since launch, rounded up (see below). Hold Timer, Hookscript received-in-window |
| 96 | mint | Pubkey | |
| 128 | token_account | Pubkey | |
| 160 | payer | Pubkey | gets the rent back |
| 192 | script_vars | [u8; 32] | Hookscript `wallet.var` state |
| 224 | last_buy_ts | i64 | unix |
| 232 | bought | u64 | raw units bought from the curve |
| 240 | sold | u64 | raw units sold to the curve |
| 248 | buys | u32 | |
| 252 | sells | u32 | |
| 256 | n_out | u8 | outflow lots with amount > 0 |
| 257 | reserved | [u8; 7] | |
| 264 | lots_out[5] | 5 × { u32 t, u64 amount } | sells and outgoing sends (Hookscript sold-in-window) |
| 324 | reserved | [u8; 4] | |

Lot buckets: with a Hold Timer, epoch = ceil(hold / 4) and a lot stays live for `hold`; otherwise hourly buckets that stay
live for 4 hours. A receipt (or outflow) at `t` lands in the lot `ceil(t / epoch) × epoch`; at most 5 bucket times are
ever live at once, so no live lot is ever evicted or moved.

## Script account `["script", mint]` (1,296 bytes, hookscript/SPEC.md §8)
| Off | Field |
|---|---|
| 0 | discriminator sha256("account:Script")[..8] = `9813738f0113e179` |
| 8 | version u8 = 1 |
| 9 | bump u8 |
| 10 | code_len u16 |
| 12 | reserved [u8; 4] |
| 16 | globals [u8; 256] (the keeper reads them here) |
| 272 | code [u8; 1024] (first `code_len` bytes) |
