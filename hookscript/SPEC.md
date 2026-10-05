# Hookscript v1: language, bytecode, VM

Hookscript is the rule language of the hookrz **Custom block**. A creator describes a rule in English, the drafter writes
it in Hookscript, the compiler turns it into bytecode (≤ 1,024 bytes), the fuzzer runs it against 10,000 generated
trades and a honeypot check, and `hookrz_engine` runs it on every transfer of the coin.

Three promises hold for every script, whatever its author wrote:

1. **Refuse-only.** A script returns *Allow* or *Refuse*. It cannot move tokens or lamports, call other programs, or
   change anything outside its own state.
2. **Bounded.** Jumps only go forward, so there are no loops. Every op has a fixed CU weight, the compiler proves the
   worst path costs ≤ 8,000 CU, and the VM meters gas at run time as well.
3. **Total.** The VM is `no_std`, has no alloc and no `unsafe`, and does not panic on any input (random bytes included). It is
   deterministic: the same bytes, context and state always give the same verdict and the same new state.

State is the difference from every other launchpad. A script has **coin globals** (256 bytes) and **per-wallet vars** (32
bytes in each Wallet record). It can update them on any transfer it allows, which is enough for games such as King of the
Hill, jackpots, tag, queues and invites. Payouts are never done on chain: the **keeper** reads the named globals and
pays from creator fees (see [Payouts](#payouts-keeper)).

Contents: [Language](#1-language) · [Read surface](#2-read-surface) · [State](#3-state) · [Bytecode](#4-bytecode) ·
[Ops](#5-op-set) · [Cost model](#6-cost-model) · [Limits](#7-limits) · [Ctx and engine integration](#8-ctx-and-engine-integration) ·
[Payouts (keeper)](#payouts-keeper) · [Safety checks](#9-fuzz-and-honeypot-check) · [Toolchain](#10-toolchain)

---

## 1. Language

```hookscript
rule "King of the Hill"
# The biggest buy takes the crown. To take it you have to beat the king's buy, and that bar fades
# to zero over 6h. While crowned, the king can't sell or send; the crown (and the lock) lapses 6h after
# the coronation unless someone outbids. The keeper streams half the creator fees to the king.

global king: key
global bar: num
global crowned_at: time
global reigns: int

payout 50% to king

on buy {
  let need = fade(bar, over: 6h, since: crowned_at)
  if amount > need {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
    set reigns += 1
  }
}

on sell, send {
  refuse if wallet == king and since(crowned_at) < 6h
    because "You're the king: no selling or sending for {6h - since(crowned_at)}, unless someone outbids you"
}
```

### Program structure
```
program  := 'rule' STRING NL  header*  section*
header   := 'timezone' STRING
          | 'global' NAME ':' type                     # coin global (starts at 0 / false / none)
          | 'wallet' ['var'] NAME ':' type              # per-wallet var
          | 'payout' PERCENT 'to' NAME ['as' 'pot']    # keeper payout (stream or pot)
          | 'payout' PERCENT 'to' 'wallets' 'where' NAME  # keeper split
section  := 'on' kinds ( '{' stmt* '}' | ':' stmt* )   # ':' form runs until the next section
          | 'when' expr ( '{' stmt* '}' | ':'? stmt* ) # legacy guard: the site's `rule / when / let / refuse if` form
          | stmt                                       # top level: runs on every transfer
kinds    := kind (',' kind)*      kind := buy | sell | send | trade (= buy, sell) | any | transfer
type     := num | int | time | bool | key
```

### Statements
| Statement | Meaning |
|---|---|
| `let x = expr` | Local value (scoped to the run). |
| `set target = expr` · `set target += expr` · `set target -= expr` | Write a global (`coin.x` or bare `x`) or a wallet var (`wallet.x`, `sender.x`, `receiver.x`, `buyer.x`, `seller.x`, `other.x`). Writes take effect for later reads in the same run, and are **kept only if the transfer is allowed**. |
| `refuse if cond because "message {expr}"` | Refuse when `cond` holds. `because` may sit on the next line. One `{expr}` placeholder is allowed. Its value is shown with the unit the compiler infers: tokens, duration (`1h 30m`), time (`2026-10-04 18:00 UTC`) or percent. |
| `refuse because "…"` | Refuse unconditionally, usually inside an `if`. |
| `allow` · `allow if cond` | Stop here and allow (state is kept). Useful as an escape hatch: `allow if wallet.is_creator`. |
| `if cond { … } else if cond { … } else { … }` | Branching. One-liners: `if cond then stmt`, `if cond: stmt`. |
| `refuse unless cond because "…"` | Same as `refuse if not cond`. |

Undeclared globals and wallet vars may be introduced by their first `set`. The type is inferred from the value: a number
gives `num`, a time gives `time`, a bool gives `bool`, a key gives `key`. Declare them explicitly to pick compact types
(`int`, `time`).

### Expressions
`or`, `and`, `not`, `==` `!=` `<` `<=` `>` `>=` (`is` / `is not` are aliases), `x in [a, b]`, `x not in [...]`,
`+ - * / %`, unary `-`, and parentheses. Comparisons between keys (`wallet == king`, `king == none`) are allowed; keys
cannot be used in arithmetic.

**Numbers** are fixed point with 6 decimals: `1`, `0.25`, `1_000_000`. Suffixes:

| Suffix | Meaning |
|---|---|
| `s` `m` `h` `d` `w` | durations in seconds: `90s`, `10m`, `2h`, `1d`, `1w` |
| `%` | percent: `25%` = 0.25 |
| `bps` | basis points: `50bps` = 0.005 |
| `x` | multiplier: `1.2x` = 1.2 |
| `k` `M` `B` | thousand, million, billion |
| `sol` | a SOL amount (a unit tag only) |

`x % 2` is the modulo operator. `25%` is a percent literal when no operand follows it.

**Literals:** `true`, `false`, `none` (the zero key), the kinds `buy` `sell` `send`, the weekdays `mon`…`sun` (or
`monday`…), and the moon phases `new` `waxing_crescent` `first_quarter` `waxing_gibbous` `full` `waning_gibbous`
`last_quarter` `waning_crescent`.

**Units are checked.** Comparing a time with a duration (`wallet.first_receipt < 2h`) is a compile error that suggests
`since(wallet.first_receipt) < 2h`. Adding two times is also an error.

### Built-in functions (all bounded, all deterministic)
| Function | Result |
|---|---|
| `since(t)` | `clock.now - t` (a duration). `since` of a never-set time (0) is very large. |
| `min(a, b, …)` · `max(a, b, …)` · `abs(x)` · `clamp(x, lo, hi)` | |
| `decay(x, rate: 1%, every: 1m, since: t)` | `x × (1 − rate)^floor(since(t) / every)`, exponential decay |
| `fade(x, over: 6h, since: t)` | `x × max(0, over − since(t)) / over`, linear decay to 0 |
| `daylight(tz: "Asia/Tokyo")` · `daylight(lat: 35.68, lon: 139.69)` | true while the sun is up there (solar altitude > −0.833°). Sunrise and sunset fall within a few minutes of published times (≤ 10 min, tested) |
| `moon_phase()` (= `moon.phase`) · `moon.illumination` (0–1) · `moon.age` (days) | Moon phase from the clock with the main lunar perturbations: full-moon instants within 25 min of the 2025 almanac (tested). The principal phases `new`, `first_quarter`, `full` and `last_quarter` are 24-hour windows centred on the exact moment. |
| `clock.hour(tz: "Asia/Tokyo")` (any `clock` field) | that field in that zone, DST included |
| `curve.price_at(ago: 10m)` | the coin's own price sample from about `ago` back (see [rings](#price-rings)) |
| `wallet.received(window: 1h)` · `wallet.sent(window: 1h)` (alias `sold(window:)`) | tokens in or out of this account within the window, from the record's last 5 lots |
| `key("base58…")` · `program("jupiter")` | constant key (max 4 per script). Known programs: `jupiter`, `meteora_dbc`, `meteora_damm_v2`. |

**Timezones.** `timezone` and `tz:` take an IANA name or a fixed offset (`"UTC+8"`, `"-05:30"`). DST is applied for US/Canada
zones (2nd Sun Mar → 1st Sun Nov), EU/UK zones (last Sun Mar → last Sun Oct, 01:00 UTC) and south-east Australia
(1st Sun Oct → 1st Sun Apr). Other named zones (Tokyo, Shanghai, Singapore, Kolkata, Dubai, São Paulo, …) use their
fixed offsets. The compiler lists every zone it knows (`compiler/src/tz.ts`). `daylight(tz:)` uses that zone's main city.

---

## 2. Read surface

All numbers are 6-decimal fixed point. Token amounts are whole tokens (`1.5` = 1.5 tokens, whatever the mint's decimals).
Times are unix seconds. Durations are seconds.

### `transfer` (bare aliases in brackets)
| Name | Type | Meaning |
|---|---|---|
| `transfer.kind` [`kind`] | buy · sell · send | **buy** = source is the pool's base vault, **sell** = destination is the base vault, otherwise **send** |
| `transfer.amount` [`amount`] | tokens | tokens moved |
| `transfer.value` [`value`] | SOL | amount × curve price |
| `transfer.trader` [`trader`] | key | buyer on a buy, seller on a sell, sender on a send |
| `transfer.from` · `transfer.to` [`buyer` = to, `seller` = from] | key | owners of the source / destination token accounts |
| `transfer.app` [`app`] | key | program of the top-level instruction that caused this transfer (e.g. `program("jupiter")`) |
| `transfer.slot` | number | current slot |
| `transfer.same_wallet` | bool | source and destination are the same account |
| `transfer.by_creator` | bool | the trader is the coin's creator |

### Wallets: `wallet` (the trader), `sender`/`from`, `receiver`/`to`, `buyer` (= receiver), `seller` (= sender), `other` (the counterparty)
`wallet.src` and `wallet.dst` are accepted as aliases for `sender` and `receiver`. Used alone, each of these names is the
owner's key, e.g. `set king = wallet`.

| Field | Type | Meaning |
|---|---|---|
| `.key` | key | owner of the token account |
| `.balance` | tokens | balance **before** this transfer |
| `.balance_after` | tokens | balance after it |
| `.first_receipt` | time | first time this account got the coin (0 = never) |
| `.held` | duration | `now − first_receipt` (0 if never) |
| `.last_buy` · `.last_sell` · `.last_trade` | time | 0 = never |
| `.last_buy_slot` | number | |
| `.bought` · `.sold` | tokens | cumulative |
| `.buys` · `.sells` | count | cumulative |
| `.received(window: D)` · `.sent(window: D)` | tokens | in / out within D (last 5 lots each way) |
| `.has_record` · `.is_pool` · `.is_creator` | bool | |
| `.NAME` | declared type | this wallet's script var |

### `curve` (Meteora DBC pool)
| Name | Type | Meaning |
|---|---|---|
| `curve.price` | lamports per token | price after this trade |
| `curve.price_at(ago: D)` | lamports per token | the coin's own sample from about D back |
| `curve.progress` | 0 – 1 | share of the curve filled |
| `curve.mcap` | SOL | price × supply |
| `curve.raised` | SOL | quote in the curve |
| `curve.fee` | fraction | current trading fee (0.01 = 1%) |

### `coin`
`coin.supply` [`supply`] (tokens), `coin.age` (duration since launch), `coin.launch` (time), `coin.launch_slot`,
`coin.creator` (key), `coin.NAME` (a global; bare `NAME` works too).

### `clock` (optional `(tz: "…")` on every field except `now`/`slot`)
`clock.now` [`now`] (time), `clock.slot`, `clock.hour` 0–23, `clock.minute`, `clock.second`, `clock.weekday` (mon…sun),
`clock.day` 1–31, `clock.month` 1–12, `clock.year`, `clock.day_of_year` 1–366, `clock.minute_of_day` 0–1439.
Without `tz:` the `timezone` header applies (UTC if none).

---

## 3. State

### Coin globals: `Script.globals`, 256 bytes
Typed slots, allocated by the compiler in declaration order (implicit ones in order of first `set`), byte-packed,
little-endian:

| Type | Bytes | Stored as | Range |
|---|---|---|---|
| `num` | 8 | i64, 6 decimals | ±9.2 × 10¹² |
| `int` | 4 | i32, whole numbers (fraction truncated, saturating) | ±2.1 × 10⁹ |
| `time` | 4 | u32 = seconds since `launch_ts` + 1; 0 = unset | launch … +136 years |
| `bool` | 1 | 0 / 1 | |
| `key` | 32 | raw pubkey; zero = `none` | |

Price rings for `curve.price_at` take 48 bytes each and are appended after the declared globals.

### Per-wallet vars: 32 bytes in each Wallet record
These use the same types and packing as globals, with 32 bytes per record. A `key` var fills all 32 bytes. Records the transfer
doesn't pass give 0 on read and drop writes. This covers the pool vault side, and accounts that have no Wallet record.
When source == destination (`same_wallet`), `receiver.x` and `sender.x` name the same bytes.

### Write rule
The VM works on copies. **Globals and both wallet areas are written back only on Allow.** On Refuse or error nothing changes.

### ABI (layout JSON)
The compiler emits the layout next to the bytecode, so the keeper, indexer and site can decode state:
```json
{ "name": "King of the Hill", "timezone": "UTC",
  "globals": [ {"name": "king", "type": "key", "offset": 0, "size": 32},
               {"name": "bar", "type": "num", "offset": 32, "size": 8},
               {"name": "crowned_at", "type": "time", "offset": 40, "size": 4},
               {"name": "reigns", "type": "int", "offset": 44, "size": 4} ],
  "wallet": [], "rings": [],
  "payouts": [ {"share_bps": 5000, "to": "king", "mode": "stream"} ],
  "reasons": [ "You're the king: no selling or sending for {}, unless someone outbids you" ],
  "needs": { "walletV2": false, "app": false } }
```
(That is the real output for `examples/king-of-the-hill.hs`. A wallet var looks like `{"name": "hat", "type": "bool", "offset": 0, "size": 1}`, and a
ring looks like `{"ago": 600, "bucket": 150, "offset": 44}`.)

---

## 4. Bytecode

A script is one byte string of at most **1,024 bytes**: a header, then the key table, then the reason table, then the
code.

### Header (16 bytes, little-endian)
| Offset | Field | Notes |
|---|---|---|
| 0 | magic `"HS"` | `0x48 0x53` |
| 2 | version `u8` | `1` |
| 3 | flags `u8` | see below; must equal what `verify` recomputes |
| 4 | n_keys `u8` | ≤ 4 |
| 5 | n_reasons `u8` | ≤ 16 |
| 6 | code_len `u16` | bytes of op stream; must be exactly the bytes left |
| 8 | gas_max `u16` | worst-case CU over all paths; must equal `verify`'s |
| 10 | globals_len `u16` | bytes of globals used (≤ 256) |
| 12 | wvars_len `u8` | bytes of wallet vars used (≤ 32) |
| 13 | max_stack `u8` | ≤ 32 |
| 14 | n_locals `u8` | ≤ 32 |
| 15 | reserved `u8` | 0 |

**Flags:** `0x01` CURVE (reads price/progress/mcap/raised/fee, or uses a ring), `0x02` SENDER (reads the sender's
WalletView), `0x04` RECEIVER, `0x08` APP (reads `transfer.app`), `0x10` WRITES_GLOBALS, `0x20` WRITES_WALLET,
`0x40` READS_GLOBALS, `0x80` READS_WALLET (vars). The engine may skip filling Ctx parts the flags don't name.

**Keys:** `n_keys × 32` bytes. **Reasons:** for each, `fmt u8 | len u8 | text[len]`, where len ≤ 96 and the text is UTF-8 with at most one `{}`.
fmt: `0` none, `1` number, `2` integer, `3` duration, `4` time, `5` percent.

### Encoding rules
* The op stream is executed from offset 0. Running off the end means **Allow**.
* Jumps carry a `u16` offset **forward** from the end of the jump op. A target may equal `code_len` (that means Allow).
  `verify` also requires that targets land on an op start.
* `PUSHI`/`PUSHR` operands are zigzag LEB128 varints of at most 10 bytes.
* Values on the stack are `i64`. Numbers are scaled by 10⁶. Booleans are raw `0/1`. Enums are raw small integers: kind
  0/1/2, weekday 0 = Monday … 6, moon phase 0 … 7.

---

## 5. Op set

`[a b → c]` shows the stack effect, with the top of the stack on the right. All arithmetic saturates at the `i64` bounds. A divisor of 0 gives 0.
**CU** is the gas weight, measured on sBPF (see §6). Some ops add an operand-dependent extra.

| Op | Hex | Operands | Stack | Semantics | CU |
|---|---|---|---|---|---|
| END | 00 | – | – | Allow | 60 |
| REFUSE | 01 | r u8 | – | Refuse{r, arg 0} | 60 |
| REFUSEV | 02 | r u8 | [v →] | Refuse{r, arg v} | 70 |
| JMP | 04 | off u16 | – | pc += off | 70 |
| JZ / JNZ | 05 / 06 | off u16 | [c →] | jump if c == 0 / ≠ 0 | 85 |
| POP / DUP | 07 / 08 | – | [a →] / [a → a a] | | 40 / 60 |
| PUSHI | 09 | varint v | [→ v·10⁶] | integer constant | 85 + 15/byte |
| PUSHR | 0A | varint v | [→ v] | raw constant (fractions, bools, enums) | 85 + 15/byte |
| LDL / STL | 0B / 0C | i u8 (< 32) | [→ x] / [x →] | locals, initially 0 | 65 / 70 |
| ADD SUB | 10 11 | – | [a b → c] | saturating | 80 |
| MUL | 12 | – | [a b → a·b/10⁶] | exact 128-bit intermediate, truncates toward 0 | 280 |
| DIV | 13 | – | [a b → a·10⁶/b] | b = 0 → 0 | 280 |
| MOD | 14 | – | [a b → a % b] | sign of a; b = 0 → 0 | 95 |
| NEG ABS | 15 16 | – | [a → c] | saturating | 75 |
| MIN MAX | 17 18 | – | [a b → c] | | 85 |
| MULDIV | 19 | – | [a b c → a·b/c] | exact 128-bit, c = 0 → 0 | 280 |
| NOT | 1A | – | [a → a == 0] | | 60 |
| EQ NE LT LE GT GE | 20–25 | – | [a b → 0/1] | signed | 80 |
| CTX | 30 | f u8 | [→ v] | context field, table below | 105 (+200 value, mcap) |
| WAL | 31 | side u8, f u8 | [→ v] | wallet field, table below | 135 |
| WIN | 32 | side u8, dir u8 | [d → sum] | lots (dir 0 in, 1 out) with `launch_ts + t ≥ now − floor(d/10⁶)` | 330 |
| CLOCK | 33 | f u8, tz i16 (std offset, minutes), rule u8 | [→ v] | f: 0 hour, 1 minute, 2 second, 3 weekday, 4 day, 5 month, 6 year, 7 day_of_year, 8 minute_of_day. rule: 0 none, 1 US, 2 EU, 3 AU | 155 (+100 f 4–6, +180 f 7, +450 DST rule) |
| DAYLIGHT | 34 | lat i16, lon i16 (1/100°) | [→ 0/1] | sun above −0.833° | 550 |
| MOON | 35 | f u8 | [→ v] | 0 phase, 1 illumination, 2 age (days) | 375 |
| DECAY | 36 | – | [x rate elapsed every → y] | `x·(1−clamp(rate,0,1))^min(floor(elapsed/every), 2³¹−1)` by squaring, truncating each step | 810 |
| RINGTICK | 37 | off u8, w u32 (s) | – | update the price ring at `off` | 240 |
| RINGAT | 38 | off u8, w u32 | [→ p] | ring lookup | 270 |
| LDG / STG | 40 / 41 | ty u8, off u8 | [→ v] / [v →] | typed global | 135 / 140 |
| LDW / STW | 42 / 43 | side u8, ty u8, off u8 | [→ v] / [v →] | typed wallet var | 160 |
| KEQ | 44 | kindA u8, argA u8, kindB u8, argB u8 | [→ 0/1] | 32-byte key compare | 195 |
| KSTG | 45 | off u8, kind u8, arg u8 | – | globals[off..off+32] = key | 160 |
| KSTW | 46 | side u8, off u8 (0), kind u8, arg u8 | – | wallet var = key | 170 |

Before the first op, `run` charges **450 + 30 × n_reasons**. This covers the header and reason-table parse and copying the globals and wallet vars in and
out. An op's base weight is charged when it is fetched. Its extra is charged after its operands are decoded and before it executes.

**Types** `ty`: 0 num, 1 int, 2 time, 3 bool. **Sides:** 0 sender, 1 receiver, 2 trader (receiver on buy, else sender),
3 other (sender on buy, else receiver). **Key refs** `(kind, arg)`: kind 0 ctx, where arg is 0 zero, 1 sender, 2 receiver, 3 trader,
4 creator, 5 app, 6 other; kind 1 is constant key `arg`; kind 2 is global key at offset `arg`; kind 3 is the wallet-var key of side `arg`.

**CTX fields:** 0 kind, 1 amount, 2 value (SOL), 3 slot, 4 now, 5 launch, 6 age, 7 launch_slot, 8 supply, 9 price,
10 progress, 11 mcap (SOL), 12 raised (SOL), 13 fee, 14 same_wallet, 15 trader-is-creator.
**WAL fields:** 0 has_record, 1 is_pool, 2 balance, 3 balance_after, 4 first_receipt, 5 last_buy_slot, 6 last_buy,
7 last_sell, 8 bought, 9 sold, 10 buys, 11 sells, 12 last_trade, 13 held.

Conversions: tokens = `raw / 10^(decimals−6)` (or `× 10^(6−decimals)`), clamped to i64. `value` and `mcap` use
`tokens × price_e6 / 10¹⁵`. `raised` is `quote_reserve / 1000`. `progress` is `progress_ppm`. `fee` is `fee_bps × 100`.

### Price rings
`curve.price_at(ago: D)` uses the bucket width `w = floor(D / 4)` seconds and a 48-byte ring: `[bucket+1: i64][p0..p4: i64]`.
The compiler puts a `RINGTICK` at the very start of the program. That records the price as the opening price of the current bucket
`floor(now / w)` and clears the buckets it skipped. `RINGAT` returns the opening price of the oldest of the last 5
buckets that saw a trade, which is the price from between D and D + w ago. If there are no samples yet, it returns the current price.
Refused transfers don't record samples.

### Time and calendar math
Unix time is clamped to `[0, 2^40]`. Civil dates use Hinnant's algorithm. Trigonometry uses Bhaskara I's sine on
centidegrees (×10⁶). The sun uses Cooper's declination, a 3-term equation of time, and the altitude test. The moon uses
mean elongation plus 5 periodic terms. `math.rs` is the normative definition, and `interp.ts` matches it bit for bit.

---

## 6. Cost model

Gas is denominated in **sBPF compute units** and is an upper bound on what `run` really costs. That covers the whole call: parse,
ops, state copies and commit. It does not cover the engine's work to fill `Ctx`, or `format_reason`, which runs only on a refusal.

* **Calibration.** `vm/bench/` is an sBPF program that runs a script with a per-op tracer
  (`sol_remaining_compute_units` around every op). `vm/bench/cu.ts` drives it on LiteSVM in two sets:
  - synthetic worst cases for every op and variant: 10-byte varints, 128-bit multiply-divide slow paths, five
    in-window lots, every CLOCK field × DST rule, 2³¹ decay periods, ring resets, equal 32-byte keys, and 16 reasons + 4 keys;
  - 60 real transfers of every example.

  Each weight is the measured maximum plus about 15%. Across all 1,464 runs, real CU ≤ gas charged: the largest real/gas
  ratio is 0.905 and the smallest margin is 144 CU. Results are in `vm/bench/cu.json`.
* **The VM avoids sBPF libcalls.** Overflow-checked `*`, signed `/` and 128-bit division compile to slow
  runtime calls on sBPF. The VM uses unsigned division, domain-proven `wrapping_mul` and a Hacker's-Delight 128/64
  division, so a `WIN` read costs about 290 CU and `DAYLIGHT` about 480. The results are bit-identical to the i128 reference
  (checked on 30M random and edge inputs).
* **Static worst case.** `verify` and the compiler compute the most expensive path through the DAG of forward jumps, base
  charge included, and write it to the header as `gas_max`. A script with `gas_max > 8,000` does not compile.
* **Dynamic meter.** `run` charges every op as it executes and returns `OutOfGas` past 8,000. A verified script can never
  get there: 4.2M verified random programs were checked to finish within their static `gas_max`.
* Examples fall between 1,330 CU (last-call) and 7,155 CU (hot-potato) worst case. Typical runs cost 1,000–3,000 CU. The site's Custom block
  line (5,000 CU) is a typical figure; 8,000 is the hard ceiling.

## 7. Limits
| Limit | Value |
|---|---|
| Script bytes (header + keys + reasons + code) | 1,024 |
| Worst-case gas | 8,000 CU |
| Stack depth / locals | 32 / 32 |
| Constant keys | 4 |
| Reasons | 16, ≤ 96 bytes each, one `{}` |
| Globals / wallet vars | 256 / 32 bytes |
| Pending forward jump targets during `verify` | 64. Deeper nesting of conditions is rejected at compile time |

---

## 8. Ctx and engine integration

```rust
// hookscript_vm (path dependency: hookscript-vm = { path = "../../hookscript/vm" })
pub fn run(code: &[u8], ctx: &Ctx, globals: &mut [u8], wallet_src: &mut [u8], wallet_dst: &mut [u8])
    -> Result<Verdict, VmError>;
pub fn run_metered(…, gas_used: &mut u32) -> Result<Verdict, VmError>;
pub fn verify(code: &[u8]) -> Result<Info, VmError>;          // at init_stack
pub fn format_reason(code: &[u8], id: u8, arg: i64, out: &mut [u8]) -> usize;   // for msg!
pub fn price_e6_from_sqrt_q64(sqrt_price: u128, base_decimals: u8) -> u64;     // DBC sqrt price → Ctx::price_e6

pub enum Verdict { Allow, Refuse { reason_id: u8, arg: i64 } }

pub struct Lot { pub t: u32 /* s since launch_ts */, pub amount: u64 /* raw */ }
pub struct WalletView {
    pub key: [u8; 32], pub has_record: bool, pub is_pool: bool,
    pub balance: u64 /* raw, BEFORE the transfer */,
    pub first_receipt_ts: i64, pub last_buy_slot: u64, pub last_buy_ts: i64, pub last_sell_ts: i64,
    pub bought: u64, pub sold: u64, pub buys: u32, pub sells: u32,
    pub n_in: u8, pub lots_in: [Lot; 5], pub n_out: u8, pub lots_out: [Lot; 5],
}
pub struct Ctx {
    pub kind: u8 /* 0 buy, 1 sell, 2 send */, pub amount: u64, pub decimals: u8, pub supply: u64,
    pub slot: u64, pub now: i64, pub launch_ts: i64, pub launch_slot: u64,
    pub price_e6: u64, pub progress_ppm: u32, pub quote_reserve: u64, pub fee_bps: u16,
    pub creator: [u8; 32], pub app: [u8; 32], pub same_wallet: bool,
    pub sender: WalletView, pub receiver: WalletView,
}
```

**How ENGINE fills it:**
* `kind` uses the Stack's base_vault rule. `amount` is the Execute amount. `decimals` and `supply` come from the mint. `slot` and `now` come from Clock.
  `launch_ts` and `launch_slot` come from the Stack.
* `price_e6 = price_e6_from_sqrt_q64(pool.sqrt_price, decimals)` (DBC pool `sqrt_price` at offset 280, guarded like
  away-rules). `progress_ppm` is `(quote_reserve − 0) / migration_quote_threshold × 10⁶`, or 0 if not computed. `quote_reserve` and `fee_bps` come from the pool and
  config. When `flags & CURVE == 0` all of these may be 0.
* `app` is the program id of the current top-level instruction (instructions sysvar), only when `flags & APP`. It
  needs the instructions sysvar in the ExtraAccountMetaList. Without it, leave zeros.
* `sender` and `receiver`: `key` is the token account owner, and `is_pool` is set for the base vault side. The other fields come from the Wallet
  record if there is one. **Balances are before the transfer.** Token-2022 calls the hook after moving the tokens, so use
  `source.amount + amount` and `destination.amount − amount`. `lots_in` is the record's receipt lots (WALLET_LAYOUT `lots`,
  unspent receipts consumed oldest-first). `lots_out` holds the last 5 outflows. `bought`, `sold`, `buys`, `sells` and `last_buy_ts`
  are the record's counters. hookrz_engine fills all of these, and the fuzzer models them the same way.
* `same_wallet` is true when source == destination token account. Pass the record as `wallet_src` and `&mut []` as
  `wallet_dst`.
* `wallet_src` / `wallet_dst` are the 32-byte script-var areas of the two Wallet records. Pass `&mut []` when a side has no
  record (pool vault side, or not opened).
* `globals` may be the first `globals_len` bytes of `Script.globals` (header offset 10). `verify` proves that every access stays
  inside it.
* Run it **after** the prebuilt blocks, as in ENGINE-SPEC. On `Refuse{reason_id, arg}`, `msg!` the
  `format_reason` text and fail with **6128 CustomRuleRefused**. On `Allow`, the VM has already written globals and wallet vars
  into the slices. Persist them with the rest of the state.
* **On `Err(VmError)`, fail with 6128 and log `HookscriptFault: <name>`.** `verify` at `init_stack` guarantees that
  well-formed scripts never error. Reject a script that fails `verify` with 6128 at init.

### Script account `["script", mint]` (1,296 bytes)
| Offset | Field |
|---|---|
| 0 | discriminator `[u8; 8]` (engine's tag) |
| 8 | version `u8` = 1 |
| 9 | bump `u8` |
| 10 | code_len `u16` |
| 12 | reserved `[u8; 4]` |
| 16 | globals `[u8; 256]` (fixed offset, so the keeper can read it without parsing the code) |
| 272 | code `[u8; 1024]` (first `code_len` bytes used) |

The script source and its layout JSON are stored by the server and shown on the coin page. The compiler is
deterministic, so anyone can recompile the source and compare the bytes with the Script account.

### Binary Ctx (tests, the parity runner and CU benches only)
This is a fixed 578-byte little-endian layout, `Ctx::decode`. In order: kind u8, decimals u8, same_wallet u8, pad u8, progress_ppm u32,
amount u64, supply u64, slot u64, now i64, launch_ts i64, launch_slot u64, price_e6 u64, quote_reserve u64, fee_bps u16,
creator [32], app [32], then sender and receiver as WalletView. A WalletView is 220 bytes: key [32], has_record u8, is_pool u8, n_in u8,
n_out u8, buys u32, sells u32, balance u64, first_receipt_ts i64, last_buy_slot u64, last_buy_ts i64, last_sell_ts i64,
bought u64, sold u64, lots_in 5 × (t u32, amount u64), lots_out 5 × (t u32, amount u64).

---

## Payouts (keeper)
The engine never moves funds. A script declares what the public keeper should pay from **creator fees**:

| Declaration | Keeper behaviour |
|---|---|
| `payout 50% to king` | **stream.** Each keeper tick (≈ 1 min), 50% of the creator fees accrued since the last tick go to the key in the global `king`, if it isn't `none`. |
| `payout 25% to winner as pot` | **pot.** 25% of creator fees accrue into a pot. Whenever the global `winner` changes to a new non-zero key, the whole pot goes to that key. |
| `payout 10% to wallets where hat` | **split.** Each tick, 10% of the accrued fees are split equally among wallets whose bool var `hat` is true and whose balance is > 0. |

The shares in one script total at most 100% of the creator's fee share. The keeper reads `Script.globals` at offset 16 + the
ABI offset, and Wallet records' var area via `getProgramAccounts` + memcmp. Every payout is a public transaction. If the creator fee vault
is empty, nothing is paid. Payouts are best effort and never block trading.

---

## 9. Fuzz and honeypot check
Every compiled script, drafted or hand-written, goes through `fuzz/`:
* **Fuzz:** 10,000 generated transfers from a seeded crowd that reuses the site simulator's archetypes: snipers, bundlers,
  sandwich bots, whales, flippers, paper hands, believers and the creator. It covers buys, sells and sends to new and
  existing wallets, launch times spread across the year (DST, weekends, moon phases, day and night), and retries
  after refusals. The fuzzer reports the refused %, refusals by reason and by kind, errors/panics (must be 0), observed max gas and
  static worst-case gas.
* **Honeypot check:** at the end of each fuzz run, for every holder, the checker simulates an exit with **nobody else trading**. It tries
  to sell the full balance, then 50%, 25%, 10%, 1% and 1 token, at times stepping out to +60 days (odd and even seconds,
  day and night, weekdays and weekends, every moon phase). Allowed sells are applied with their state writes. A script is
  **flagged** if any holder can't get below 1% of their bag.
* **Bank run:** for the first launches, every holder exits in turn, biggest bag first, in one shared world. This catches rules
  that depend on the price staying high or on other people acting. It is the case where "sell only above 2× launch price"
  traps the last holders out.
* A script is also flagged if fuzzing refused every sell. A flag is a hard failure for drafts. The drafter retries with the
  findings, and the site shows the reason. `fuzz/honeypots/` holds 6 planted honeypots, and all are flagged.

## 10. Toolchain
| Piece | Path | Run (from `hookscript/`) |
|---|---|---|
| VM (Rust, no_std) | `vm/` | `cd vm && cargo test --release`. sBPF: the ENGINE-SPEC build line |
| Parity runner | `vm/examples/hsrun.rs` + `compiler/test/parity.ts` | `node compiler/test/parity.ts --cases 1000` |
| CU calibration | `vm/bench/` | build the bench `.so` for sBPF, then `node vm/bench/cu.ts` |
| Compiler + reference interpreter (TS, Node ≥ 22.6, no deps) | `compiler/src/` | `node compiler/bin/hsc.ts [--listing\|--json\|--hex] file.hs` · `--rehead file.hex` |
| Compiler tests | `compiler/test/compiler.test.ts` | `node compiler/test/compiler.test.ts` |
| Fuzzer + honeypot | `fuzz/` | `node fuzz/run.ts [--trades N] [--json out] examples/*.hs` |
| Drafter | `drafter/` | `node drafter/cli.ts [--offline] "English rule"` |
| Examples | `examples/*.hs` | 22 scripts |

### Drafter API
```ts
import { draft } from './drafter/draft.ts';
const d = await draft('Every 100th buy wins the jackpot', { provider: 'auto' /* | 'anthropic' | 'heuristic' */ });
// d: { ok, prompt, script, bytecodeHex, bytes, ops, cu /* static worst case */,
//      fuzz: { trades, refusedPct, panics, maxCu /* seen */, avgCu, errors, byKind, byReason, rust },
//      honeypot: { ok, locked[], bankRun?, notes[] }, warnings[], errors[], abi, reviewed: false,
//      provider: 'anthropic' | 'heuristic', model, template, attempts[] }
```
* **Providers.** The Anthropic provider uses the official SDK (`@anthropic-ai/sdk`, an optional dependency) and runs when
  `ANTHROPIC_API_KEY` is set. The model is `HOOKSCRIPT_MODEL`, defaulting to `claude-opus-5-5`; `claude-sonnet-5-5` also works.
  The system prompt is this spec plus every example, prompt-cached. The provider uses the server-side refusal fallback
  (`fallbacks: "default"`). Without a key, the offline provider fills in templates for the example families.
* **Checks.** Every draft is compiled, fuzzed (10,000 trades) and honeypot-checked. A failure is sent back to the model with
  the compiler errors (line, column, the source line) or the honeypot findings, for up to 3 attempts.
