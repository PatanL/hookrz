//! Pure block logic: the Rust twin of `check()` in `web/src/data/blocks.js`.
//!
//! No Solana types here, so the host parity tests (`tests/vectors.rs`) run exactly the code the
//! program runs. Amounts are raw token units (u64); percentages are basis points; times are
//! seconds; all comparisons are exact integer maths (the JS reference uses floats over the same
//! quantities).

/// Hold-timer lots per wallet record.
pub const LOTS: usize = 5;
/// Bytes of packed params per slot.
pub const PARAMS: usize = 24;
/// Bytes of per-slot state.
pub const STATE: usize = 32;
/// Most slots a stack holds.
pub const MAX_SLOTS: usize = 6;

// Block ids: the u16 stored in a Stack slot. Always `error code - 6000`.
pub const SNIPE_SHIELD: u16 = 1;
pub const ANTI_BUNDLE: u16 = 2;
pub const MAX_WALLET: u16 = 3;
pub const RISING_MAX: u16 = 4;
pub const SANDWICH_GUARD: u16 = 5;
pub const SELL_CAP: u16 = 8;
pub const SELL_COOLDOWN: u16 = 9;
pub const HOLD_TIMER: u16 = 10;
pub const CIRCUIT_BREAKER: u16 = 11;
pub const TRADING_HOURS: u16 = 12;
pub const LOCK_IN: u16 = 15;
pub const CREATOR_VEST: u16 = 16;
/// The Hookscript slot. Its check is a no-op; the script itself runs after every slot.
pub const CUSTOM: u16 = 128;

pub const fn code_of(id: u16) -> u32 {
    6000 + id as u32
}

pub fn name_of(code: u32) -> &'static str {
    match code {
        6000 => "NotInTransfer",
        6001 => "SnipeWindow",
        6002 => "BundleLimit",
        6003 => "MaxWalletExceeded",
        6004 => "RisingCapExceeded",
        6005 => "SandwichLockout",
        6008 => "SellCapExceeded",
        6009 => "SellCooldown",
        6010 => "StillSettling",
        6011 => "CircuitBreaker",
        6012 => "MarketClosed",
        6015 => "LockInPhase",
        6016 => "CreatorVesting",
        6128 => "CustomRuleRefused",
        6141 => "MissingWalletRecord",
        6142 => "HookLive",
        6143 => "StackLocked",
        _ => "Custom",
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Buy,
    Sell,
    Send,
}

/// One hold-timer lot: `t` is the receipt time in seconds since launch (rounded, see `lot_time`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Lot {
    pub t: i64,
    pub amount: u64,
}

/// The sender's wallet record as the blocks see it (the JS `ctx.w`). Times are seconds since launch.
#[derive(Clone, Copy, Debug, Default)]
pub struct WalletView {
    pub lots: [Lot; LOTS],
    pub last_buy_slot: Option<u64>,
    pub last_sell_t: Option<i64>,
    pub first_t: Option<i64>,
}

/// Everything a block may read about one transfer (the JS `ctx`).
#[derive(Clone, Copy, Debug)]
pub struct Ctx {
    pub kind: Kind,
    pub amount: u64,
    pub supply: u64,
    /// Seconds since launch (`now - launch_ts`, never negative).
    pub t: i64,
    pub slot: u64,
    /// UTC hour, 0..=23.
    pub hour: u32,
    /// Curve progress = quote_reserve / threshold (DBC `quote_reserve` / config `migration_quote_threshold`).
    pub quote_reserve: u64,
    pub threshold: u64,
    /// DBC Q64.64 sqrt price after the trade, and at the open of the breaker window (0 = none).
    pub sqrt_after: u128,
    pub sqrt_open: u128,
    pub src_before: u64,
    pub dst_after: u64,
    /// The receiver is the creator and this is the launch slot (the creator's launch buy).
    pub is_creator: bool,
    /// The sender is the creator's wallet.
    pub is_creator_src: bool,
    pub w: WalletView,
    /// Buys already landed in this slot (Anti-Bundle state).
    pub slot_buys: u64,
    /// The creator's launch bag (Creator Vesting state): what the creator bought in the slot of its first buy.
    pub creator_base: u64,
}

pub fn u16_at(p: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([p[at], p[at + 1]])
}
pub fn u32_at(p: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([p[at], p[at + 1], p[at + 2], p[at + 3]])
}

/// `a * 10_000 > supply * bps`, i.e. a > supply * bps / 10_000, exactly.
fn over_bps(a: u64, supply: u64, bps: u16) -> bool {
    (a as u128) * 10_000 > (supply as u128) * (bps as u128)
}

/// Does block `id` with packed `params` refuse this transfer? (`true` = refuse.)
/// Unknown ids never refuse here; `validate` keeps them out of a Stack.
pub fn check(id: u16, p: &[u8], c: &Ctx) -> bool {
    match id {
        // c.kind === 'buy' && !c.isCreator && c.t < p.window && c.amount > c.supply * p.max / 100
        SNIPE_SHIELD => {
            let window = u32_at(p, 0) as i64;
            let max_bps = u16_at(p, 4);
            c.kind == Kind::Buy && !c.is_creator && c.t < window && over_bps(c.amount, c.supply, max_bps)
        }
        // c.kind === 'buy' && !c.isCreator && c.t < p.window * 60 && c.slotBuys >= p.perSlot
        ANTI_BUNDLE => {
            let window = u32_at(p, 0) as i64;
            let per_slot = u16_at(p, 4) as u64;
            c.kind == Kind::Buy && !c.is_creator && c.t < window && c.slot_buys >= per_slot
        }
        // c.kind !== 'sell' && c.dstAfter > c.supply * p.pct / 100
        MAX_WALLET => c.kind != Kind::Sell && over_bps(c.dst_after, c.supply, u16_at(p, 0)),
        // c.kind !== 'sell' && c.dstAfter > c.supply * capAt(p, c.t) / 100
        RISING_MAX => c.kind != Kind::Sell && over_rising_cap(c.dst_after, c.supply, u16_at(p, 0), u16_at(p, 2), u32_at(p, 4), c.t),
        // c.kind === 'sell' && c.w.lastBuySlot != null && c.slot - c.w.lastBuySlot < p.slots
        SANDWICH_GUARD => {
            let slots = u32_at(p, 0) as i128;
            c.kind == Kind::Sell && matches!(c.w.last_buy_slot, Some(b) if (c.slot as i128) - (b as i128) < slots)
        }
        // c.kind === 'sell' && c.amount > c.supply * p.pct / 100
        SELL_CAP => c.kind == Kind::Sell && over_bps(c.amount, c.supply, u16_at(p, 0)),
        // c.kind === 'sell' && c.w.lastSellT != null && c.t - c.w.lastSellT < p.minutes * 60
        SELL_COOLDOWN => {
            let secs = u32_at(p, 0) as i128;
            c.kind == Kind::Sell && matches!(c.w.last_sell_t, Some(s) if (c.t as i128) - (s as i128) < secs)
        }
        // c.kind !== 'buy' && c.amount > freeBalance(c, p.minutes * 60)
        HOLD_TIMER => c.kind != Kind::Buy && c.amount > free_balance(c.src_before, &c.w.lots, c.t, u32_at(p, 0)),
        // c.kind !== 'send' && c.windowOpenPrice > 0 && |priceAfter / windowOpenPrice - 1| * 100 > p.band
        CIRCUIT_BREAKER => c.kind != Kind::Send && c.sqrt_open > 0 && outside_band(c.sqrt_after, c.sqrt_open, u16_at(p, 4)),
        // c.kind !== 'send' && !(c.hour >= p.open && c.hour < p.close)
        TRADING_HOURS => c.kind != Kind::Send && !(c.hour >= p[0] as u32 && c.hour < p[1] as u32),
        // c.kind === 'sell' && c.progress * 100 < p.pct
        LOCK_IN => c.kind == Kind::Sell && (c.quote_reserve as u128) * 10_000 < (u16_at(p, 0) as u128) * (c.threshold as u128),
        // c.isCreatorSrc && c.kind !== 'buy' && c.srcBefore - c.amount < vestLocked(p, c.t, c.creatorBase)
        CREATOR_VEST => c.is_creator_src && c.kind != Kind::Buy && under_vest(c.src_before, c.amount, c.creator_base, u32_at(p, 0), u32_at(p, 4), c.t),
        _ => false,
    }
}

/// Rising Max: dst > supply * cap(t), cap(t) = from + (to - from) * clamp(t / secs, 0, 1), exactly.
pub fn over_rising_cap(dst: u64, supply: u64, from_bps: u16, to_bps: u16, secs: u32, t: i64) -> bool {
    if secs == 0 {
        return over_bps(dst, supply, to_bps);
    }
    let s = secs as u128;
    let tc = t.clamp(0, secs as i64) as u128;
    // cap * s = from * (s - tc) + to * tc   (a convex combination, never negative)
    let cap_s = (from_bps as u128) * (s - tc) + (to_bps as u128) * tc;
    (dst as u128) * 10_000 * s > (supply as u128) * cap_s
}

/// Creator Vesting: would the creator's balance after this transfer drop below the still-locked part
/// of its launch bag? Nothing vests before the cliff; then the bag unlocks in a straight line over
/// `vest` seconds. Exact: after * vest < base * (vest - clamp(t - cliff, 0, vest)).
pub fn under_vest(src_before: u64, amount: u64, base: u64, cliff: u32, vest: u32, t: i64) -> bool {
    let after = src_before as i128 - amount as i128;
    if vest == 0 {
        return after < if t < cliff as i64 { base as i128 } else { 0 };
    }
    let v = vest as i128;
    let elapsed = if t < cliff as i64 { 0 } else { ((t as i128) - cliff as i128).min(v) };
    after * v < (base as i128) * (v - elapsed)
}

/// DBC base fee in bps at `current` (slot or unix time): the fee scheduler (linear, exponential) over
/// `(current - activation) / period_frequency` periods, capped at `n_periods`, as the DBC SDK computes it.
/// The rate limiter (mode 2) and the dynamic fee depend on the trade or on volatility; they report the base fee.
pub fn dbc_base_fee_bps(cliff: u64, period_frequency: u64, reduction: u64, n_periods: u16, mode: u8, current: u64, activation: u64) -> u16 {
    let num = if period_frequency == 0 {
        cliff
    } else {
        let period = (current.saturating_sub(activation) / period_frequency).min(n_periods as u64);
        match mode {
            0 => cliff.saturating_sub(period.saturating_mul(reduction)),
            1 => exponential_fee(cliff, reduction, period),
            _ => cliff,
        }
    };
    (num / 100_000).min(10_000) as u16
}
fn exponential_fee(cliff: u64, reduction_bps: u64, period: u64) -> u64 {
    const ONE: u128 = 1 << 64;
    if period == 0 || reduction_bps == 0 {
        return cliff;
    }
    let base = ONE.saturating_sub(((reduction_bps as u128) << 64) / 10_000);
    let (mut result, mut cur, mut e) = (ONE, base, period);
    while e > 0 {
        if e & 1 == 1 {
            result = result * cur / ONE;
        }
        cur = cur * cur / ONE;
        e >>= 1;
    }
    ((cliff as u128) * result / ONE) as u64
}

/// Coins in lots received less than `hold` seconds ago.
pub fn locked(lots: &[Lot], t: i64, hold: u32) -> u64 {
    lots.iter()
        .filter(|l| l.amount > 0 && (t as i128) - (l.t as i128) < hold as i128)
        .fold(0u64, |a, l| a.saturating_add(l.amount))
}
pub fn free_balance(src_before: u64, lots: &[Lot], t: i64, hold: u32) -> u64 {
    src_before.saturating_sub(locked(lots, t, hold))
}

/// Lot bucketing for receipt (`lots_in`) and outflow (`lots_out`) lots: `(epoch, live)` seconds.
/// With a Hold Timer: epoch = ceil(hold / (LOTS-1)) and live = hold (the H1 fix from away-rules).
/// Without one: hourly buckets covering the last 4 hours (for Hookscript's received/sold windows).
/// Since live <= (LOTS-1) * epoch, at most LOTS distinct bucket times are live at once, so every
/// receipt finds its own lot and a later receipt never extends an earlier lot. Hold Timer coins
/// unlock between `hold` and `hold + epoch` after they arrive (up to 25% later than the hold).
pub fn lot_epoch(hold: Option<u32>) -> (i64, i64) {
    match hold {
        Some(h) => (((h as i64 + LOTS as i64 - 2) / (LOTS as i64 - 1)).max(1), h as i64),
        None => (3_600, 4 * 3_600),
    }
}
/// A receipt's lot time: `t` (seconds since launch) rounded UP to the epoch.
pub fn lot_time(epoch: i64, t: i64) -> i64 {
    let e = epoch.max(1);
    (t + e - 1).div_euclid(e) * e
}

/// Record `amount` at `t` (seconds since launch). Zero amounts change nothing.
pub fn add_lot(lots: &mut [Lot; LOTS], (epoch, live): (i64, i64), t: i64, amount: u64) {
    if amount == 0 {
        return;
    }
    let lt = lot_time(epoch, t);
    if let Some(l) = lots.iter_mut().find(|l| l.amount > 0 && l.t == lt) {
        l.amount = l.amount.saturating_add(amount);
        return;
    }
    if let Some(l) = lots.iter_mut().find(|l| l.amount == 0 || (t as i128) - (l.t as i128) >= live as i128) {
        *l = Lot { t: lt, amount };
        return;
    }
    // Unreachable by construction (see lot_epoch). Fail safe: merge into the latest lot, which only
    // ever moves that lot later, never an earlier one.
    let mut i = 0;
    for j in 1..LOTS {
        if lots[j].t > lots[i].t {
            i = j;
        }
    }
    lots[i].t = lots[i].t.max(lt);
    lots[i].amount = lots[i].amount.saturating_add(amount);
}

/// Lots with an amount, oldest first (for Hookscript).
pub fn sorted_lots(lots: &[Lot; LOTS]) -> ([Lot; LOTS], u8) {
    let mut out = [Lot::default(); LOTS];
    let mut n = 0usize;
    for l in lots.iter().filter(|l| l.amount > 0) {
        let mut i = n;
        while i > 0 && out[i - 1].t > l.t {
            out[i] = out[i - 1];
            i -= 1;
        }
        out[i] = *l;
        n += 1;
    }
    (out, n as u8)
}

// ───────── circuit breaker: exact |p/p0 - 1| > band with p = sqrt^2, in 320-bit integers ─────────
type U320 = [u64; 5];

fn mul_small(a: &U320, k: u64) -> U320 {
    let mut out = [0u64; 5];
    let mut carry = 0u128;
    for i in 0..5 {
        let v = (a[i] as u128) * (k as u128) + carry;
        out[i] = v as u64;
        carry = v >> 64;
    }
    out
}
fn square(x: u128) -> U320 {
    let l = [x as u64, (x >> 64) as u64];
    let mut out = [0u64; 5];
    for i in 0..2 {
        let mut carry = 0u128;
        for j in 0..2 {
            let v = (l[i] as u128) * (l[j] as u128) + out[i + j] as u128 + carry;
            out[i + j] = v as u64;
            carry = v >> 64;
        }
        out[i + 2] = carry as u64;
    }
    out
}
fn cmp(a: &U320, b: &U320) -> core::cmp::Ordering {
    for i in (0..5).rev() {
        if a[i] != b[i] {
            return a[i].cmp(&b[i]);
        }
    }
    core::cmp::Ordering::Equal
}
/// sqrt_after^2 * 10_000 > sqrt_open^2 * (10_000 + band) or < sqrt_open^2 * (10_000 - band).
pub fn outside_band(sqrt_after: u128, sqrt_open: u128, band_bps: u16) -> bool {
    let a = mul_small(&square(sqrt_after), 10_000);
    let o = square(sqrt_open);
    let up = mul_small(&o, 10_000 + band_bps as u64);
    if cmp(&a, &up) == core::cmp::Ordering::Greater {
        return true;
    }
    let band = (band_bps as u64).min(10_000);
    let down = mul_small(&o, 10_000 - band);
    cmp(&a, &down) == core::cmp::Ordering::Less
}

/// Run the slots in order; the first refusal wins. Returns `(slot index, error code)`.
pub fn evaluate(slots: &[(u16, [u8; PARAMS])], c: &Ctx) -> Option<(usize, u32)> {
    for (i, (id, p)) in slots.iter().enumerate() {
        if check(*id, p, c) {
            return Some((i, code_of(*id)));
        }
    }
    None
}

// ───────── params: packing ranges (blocks.js min/max, converted to the packed units) ─────────
/// Is this block a phase-1 hook block the engine runs?
pub fn known(id: u16) -> bool {
    matches!(
        id,
        SNIPE_SHIELD
            | ANTI_BUNDLE
            | MAX_WALLET
            | RISING_MAX
            | SANDWICH_GUARD
            | SELL_CAP
            | SELL_COOLDOWN
            | HOLD_TIMER
            | CIRCUIT_BREAKER
            | TRADING_HOURS
            | LOCK_IN
            | CREATOR_VEST
            | CUSTOM
    )
}

/// Params within the site's ranges, and unused param bytes zero. See LAYOUT.md.
pub fn valid_params(id: u16, p: &[u8]) -> bool {
    let used = match id {
        SNIPE_SHIELD | ANTI_BUNDLE | CIRCUIT_BREAKER => 6,
        RISING_MAX | CREATOR_VEST => 8,
        MAX_WALLET | SELL_CAP | LOCK_IN | TRADING_HOURS => 2,
        SANDWICH_GUARD | SELL_COOLDOWN | HOLD_TIMER => 4,
        CUSTOM => 0,
        _ => return false,
    };
    if p.len() != PARAMS || p[used..].iter().any(|&b| b != 0) {
        return false;
    }
    let r16 = |at: usize, lo: u16, hi: u16| (lo..=hi).contains(&u16_at(p, at));
    let r32 = |at: usize, lo: u32, hi: u32| (lo..=hi).contains(&u32_at(p, at));
    match id {
        SNIPE_SHIELD => r32(0, 10, 600) && r16(4, 5, 200),
        ANTI_BUNDLE => r32(0, 60, 3_600) && r16(4, 1, 6),
        MAX_WALLET => r16(0, 50, 1_000),
        RISING_MAX => r16(0, 25, 500) && r16(2, 100, 2_000) && r32(4, 3_600, 72 * 3_600),
        SANDWICH_GUARD => r32(0, 1, 150),
        SELL_CAP => r16(0, 10, 500),
        SELL_COOLDOWN => r32(0, 60, 240 * 60),
        HOLD_TIMER => r32(0, 300, 1_440 * 60),
        CIRCUIT_BREAKER => r32(0, 60, 3_600) && r16(4, 500, 5_000),
        // open < close: an empty session would refuse every curve trade forever.
        TRADING_HOURS => p[0] <= 23 && (1..=24).contains(&p[1]) && p[0] < p[1],
        LOCK_IN => r16(0, 1_000, 6_000),
        CREATOR_VEST => r32(0, 0, 30 * 86_400) && r32(4, 7 * 86_400, 365 * 86_400),
        CUSTOM => true,
        _ => false,
    }
}

/// Blocks that read or write the wallet records (Wallet(src), Wallet(dst) in the meta list).
pub fn needs_wallets(id: u16) -> bool {
    matches!(id, SANDWICH_GUARD | SELL_COOLDOWN | HOLD_TIMER | CUSTOM)
}
/// Blocks that read the DBC pool.
pub fn needs_pool(id: u16) -> bool {
    matches!(id, CIRCUIT_BREAKER | LOCK_IN)
}
/// Blocks that write their slot state (the Stack becomes writable on every transfer).
pub fn writes_stack(id: u16) -> bool {
    matches!(id, ANTI_BUNDLE | CIRCUIT_BREAKER | CREATOR_VEST)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_receipt_gets_its_own_lot() {
        for hold in [300u32, 3_600, 7_200, 86_400] {
            let mut lots = [Lot::default(); LOTS];
            let mut t = 0i64;
            let mut seed = 7u64;
            for _ in 0..5_000 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                t += (seed >> 33) as i64 % (hold as i64 / 3 + 1);
                let before = lots;
                let ep = lot_epoch(Some(hold));
                add_lot(&mut lots, ep, t, 5);
                let lt = lot_time(ep.0, t);
                assert!(lots.iter().any(|l| l.t == lt && l.amount > 0), "receipt merged into a foreign lot (hold {hold})");
                // Earlier live lots never move.
                for (a, b) in before.iter().zip(lots.iter()) {
                    if a.amount > 0 && t - a.t < hold as i64 && a.t != lt {
                        assert_eq!(a, b);
                    }
                }
                let epoch = (hold as i64 + 3) / 4;
                assert!(lt >= t && lt < t + epoch);
            }
        }
    }

    #[test]
    fn dust_cannot_extend_an_earlier_lock() {
        let hold = 3_600;
        let mut lots = [Lot::default(); LOTS];
        let ep = lot_epoch(Some(hold));
        add_lot(&mut lots, ep, 0, 1_000_000);
        let first_unlock = lot_time(ep.0, 0) + hold as i64;
        let mut dust = 0u64;
        let mut t = 100;
        while t < first_unlock {
            add_lot(&mut lots, ep, t, 1);
            dust += 1;
            t += 100;
        }
        assert_eq!(locked(&lots, first_unlock - 1, hold), 1_000_000 + dust);
        assert!(locked(&lots, first_unlock, hold) <= dust);
        let before = lots;
        add_lot(&mut lots, ep, 50, 0);
        assert_eq!(before, lots);
    }

    #[test]
    fn hourly_lots_cover_the_last_four_hours() {
        let ep = lot_epoch(None);
        let mut lots = [Lot::default(); LOTS];
        let mut t = 0;
        for i in 0..2_000u64 {
            t += (i as i64 * 7919) % 1_800;
            add_lot(&mut lots, ep, t, 1 + i % 3);
            let (sorted, n) = sorted_lots(&lots);
            assert!(sorted[..n as usize].windows(2).all(|w| w[0].t < w[1].t));
            // Every receipt of the last 4 hours is still counted.
            assert!(sorted[..n as usize].iter().any(|l| l.t == lot_time(ep.0, t)));
        }
    }

    #[test]
    fn band_is_exact_and_never_overflows() {
        let max_sqrt: u128 = 79_226_673_521_066_979_257_578_248_091; // DBC MAX_SQRT_PRICE
        assert!(!outside_band(max_sqrt, max_sqrt, 500));
        let s0 = 10u128 << 60;
        // (11/10)^2 = 1.21 exactly: on the 21% band edge passes, 20% refuses.
        assert!(!outside_band(11u128 << 60, s0, 2_100));
        assert!(outside_band(11u128 << 60, s0, 2_000));
        // (9/10)^2 = 0.81: 19% edge passes, 18% refuses.
        assert!(!outside_band(9u128 << 60, s0, 1_900));
        assert!(outside_band(9u128 << 60, s0, 1_800));
    }

    #[test]
    fn dbc_fee_schedule() {
        // 50% → 1% over 60 periods of 1 s (BACKEND's sniper-fee-burn): numerators in 1e9.
        let (cliff, end, n) = (500_000_000u64, 10_000_000u64, 60u16);
        let red = (cliff - end) / n as u64;
        assert_eq!(dbc_base_fee_bps(cliff, 1, red, n, 0, 1_000, 1_000), 5_000);
        assert_eq!(dbc_base_fee_bps(cliff, 1, red, n, 0, 1_030, 1_000), 2_550);
        assert_eq!(dbc_base_fee_bps(cliff, 1, red, n, 0, 9_999, 1_000), 100);
        // Exponential: 50% × (1 − 10%)^2 = 40.5%.
        assert_eq!(dbc_base_fee_bps(cliff, 10, 1_000, 100, 1, 1_020, 1_000), 4_050);
        assert_eq!(dbc_base_fee_bps(cliff, 0, red, n, 0, 5, 0), 5_000);
    }

    #[test]
    fn creator_bag_vests_after_the_cliff() {
        let (cliff, vest) = (3 * 86_400u32, 30 * 86_400u32);
        // Before the cliff the whole launch bag is locked; coins bought later are free.
        assert!(!under_vest(1_500, 500, 1_000, cliff, vest, 86_400));
        assert!(under_vest(1_500, 501, 1_000, cliff, vest, 86_400));
        // Halfway through the line, half the bag is free.
        let mid = cliff as i64 + vest as i64 / 2;
        assert!(!under_vest(1_000, 500, 1_000, cliff, vest, mid));
        assert!(under_vest(1_000, 501, 1_000, cliff, vest, mid));
        // Fully vested at cliff + vest.
        assert!(!under_vest(1_000, 1_000, 1_000, cliff, vest, (cliff + vest) as i64));
        // No launch bag: nothing locked.
        assert!(!under_vest(10, 10, 0, cliff, vest, 0));
    }

    #[test]
    fn rising_cap_is_a_straight_line() {
        let supply = 1_000_000_000_000_000u64;
        // from 0.5% to 5% over 12h: at 6h the cap is 2.75%.
        let at = |pct_e4: u64| supply / 10_000 * pct_e4;
        assert!(!over_rising_cap(at(275), supply, 50, 500, 43_200, 21_600));
        assert!(over_rising_cap(at(275) + 1, supply, 50, 500, 43_200, 21_600));
        assert!(!over_rising_cap(at(500), supply, 50, 500, 43_200, 999_999));
        assert!(over_rising_cap(at(50) + 1, supply, 50, 500, 43_200, -5));
    }
}
