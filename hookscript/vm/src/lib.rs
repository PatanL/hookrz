//! # hookscript-vm
//!
//! The Hookscript virtual machine that `hookrz_engine` runs on every transfer of a coin with a Custom block.
//! It is **refuse-only** (it returns Allow or Refuse; it cannot move funds or call out), **bounded** (forward-only
//! jumps, so no loops; a gas meter with an 8,000 CU ceiling) and **total**: `no_std`, no alloc, no `unsafe`, and no
//! panic on any input. State (coin globals and per-wallet vars) is written back only when the verdict is Allow.
//!
//! The format, op set and cost model are specified in `hookscript/SPEC.md`. The TypeScript reference interpreter in
//! `hookscript/compiler/src/interp.ts` has the same semantics; `cargo run --example hsrun` is the parity runner.
#![no_std]
#![forbid(unsafe_code)]
#![deny(clippy::indexing_slicing, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[cfg(test)]
extern crate std;

mod fmt;
pub mod math;
pub mod op;
mod verify;

pub use fmt::{format_reason, reason};
pub use math::price_e6_from_sqrt_q64;
pub use verify::{analyze, verify, Info};

use math::{n, tok, u2i};

/// Fixed point: every Hookscript number is an i64 with 6 decimals (1.0 = 1_000_000).
pub const ONE: i64 = 1_000_000;
pub const MAGIC: [u8; 2] = *b"HS";
pub const VERSION: u8 = 1;
pub const HEADER_LEN: usize = 16;
/// Whole script (header + keys + reasons + code) is at most this many bytes.
pub const MAX_CODE: usize = 1024;
/// Coin globals: bytes in `Script.globals`.
pub const GLOBALS_LEN: usize = 256;
/// Per-wallet script vars: bytes in each Wallet record.
pub const WVARS_LEN: usize = 32;
pub const STACK_MAX: usize = 32;
pub const LOCALS_MAX: usize = 32;
pub const MAX_KEYS: usize = 4;
pub const MAX_REASONS: usize = 16;
pub const MAX_REASON_LEN: usize = 96;
/// Hard gas ceiling per run, in compute units.
pub const GAS_LIMIT: u32 = 8_000;

pub const KIND_BUY: u8 = 0;
pub const KIND_SELL: u8 = 1;
pub const KIND_SEND: u8 = 2;

/// One receipt (or outflow) lot of a Wallet record.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Lot {
    /// Seconds since `Ctx::launch_ts`.
    pub t: u32,
    /// Raw token units.
    pub amount: u64,
}

/// What the engine knows about one side of the transfer. All token amounts are raw units.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct WalletView {
    /// Owner of the token account (for the pool side: the pool authority / vault owner).
    pub key: [u8; 32],
    /// A Wallet record exists for this token account.
    pub has_record: bool,
    /// This side is the DBC base vault (buy source / sell destination).
    pub is_pool: bool,
    /// Token balance **before** this transfer.
    pub balance: u64,
    /// First time this account received the coin (unix seconds), 0 = never.
    pub first_receipt_ts: i64,
    pub last_buy_slot: u64,
    /// Unix seconds, 0 = never.
    pub last_buy_ts: i64,
    /// Unix seconds, 0 = never.
    pub last_sell_ts: i64,
    /// Cumulative tokens bought / sold (0 if the record doesn't track them).
    pub bought: u64,
    pub sold: u64,
    pub buys: u32,
    pub sells: u32,
    /// Receipts (buys and incoming sends), oldest first; `n_in` used.
    pub n_in: u8,
    pub lots_in: [Lot; 5],
    /// Outflows (sells and outgoing sends), oldest first; `n_out` used.
    pub n_out: u8,
    pub lots_out: [Lot; 5],
}

/// Everything a Hookscript can read. The engine fills it once per transfer (see SPEC.md "Ctx").
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ctx {
    /// KIND_BUY (source = pool base vault), KIND_SELL (destination = base vault), KIND_SEND.
    pub kind: u8,
    /// Raw token units moved.
    pub amount: u64,
    /// Mint decimals.
    pub decimals: u8,
    /// Raw total supply.
    pub supply: u64,
    pub slot: u64,
    /// Unix seconds (Clock sysvar).
    pub now: i64,
    pub launch_ts: i64,
    pub launch_slot: u64,
    /// Quote raw units (lamports) per whole token, × 1e6. See `price_e6_from_sqrt_q64`.
    pub price_e6: u64,
    /// Curve progress, parts per million (1_000_000 = graduated).
    pub progress_ppm: u32,
    /// Quote (SOL) in the curve, lamports.
    pub quote_reserve: u64,
    /// Current trading fee, basis points.
    pub fee_bps: u16,
    pub creator: [u8; 32],
    /// Program id of the top-level instruction that caused this transfer (instructions sysvar); zeros if unknown.
    pub app: [u8; 32],
    /// Source and destination are the same token account (wallet_dst is ignored; receiver vars alias sender vars).
    pub same_wallet: bool,
    pub sender: WalletView,
    pub receiver: WalletView,
}

/// The script's decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    /// `reason_id` indexes the script's reason table; `arg` fills its `{}` placeholder (0 if none).
    Refuse { reason_id: u8, arg: i64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum VmError {
    BadMagic = 1,
    BadVersion = 2,
    TooLong = 3,
    BadLength = 4,
    BadOpcode = 5,
    BadOperand = 6,
    BadJump = 7,
    StackOverflow = 8,
    StackUnderflow = 9,
    OutOfGas = 10,
    BadSlot = 11,
    BadKey = 12,
    BadReason = 13,
    BadHeader = 14,
    StackMismatch = 15,
    TooManyLabels = 16,
}

impl VmError {
    pub const fn name(self) -> &'static str {
        match self {
            VmError::BadMagic => "BadMagic",
            VmError::BadVersion => "BadVersion",
            VmError::TooLong => "TooLong",
            VmError::BadLength => "BadLength",
            VmError::BadOpcode => "BadOpcode",
            VmError::BadOperand => "BadOperand",
            VmError::BadJump => "BadJump",
            VmError::StackOverflow => "StackOverflow",
            VmError::StackUnderflow => "StackUnderflow",
            VmError::OutOfGas => "OutOfGas",
            VmError::BadSlot => "BadSlot",
            VmError::BadKey => "BadKey",
            VmError::BadReason => "BadReason",
            VmError::BadHeader => "BadHeader",
            VmError::StackMismatch => "StackMismatch",
            VmError::TooManyLabels => "TooManyLabels",
        }
    }
}

/// Parsed script header.
#[derive(Clone, Copy, Debug)]
pub struct Header<'a> {
    pub flags: u8,
    pub n_keys: u8,
    pub n_reasons: u8,
    pub gas_max: u16,
    pub globals_len: u16,
    pub wvars_len: u8,
    pub max_stack: u8,
    pub n_locals: u8,
    pub keys: &'a [u8],
    pub reasons: &'a [u8],
    pub code: &'a [u8],
}

#[inline]
fn byte(b: &[u8], i: usize) -> Result<u8, VmError> {
    b.get(i).copied().ok_or(VmError::BadLength)
}

/// Parse and bounds-check the header, key table and reason table.
pub fn parse(script: &[u8]) -> Result<Header<'_>, VmError> {
    if script.len() > MAX_CODE {
        return Err(VmError::TooLong);
    }
    if script.len() < HEADER_LEN {
        return Err(VmError::BadLength);
    }
    if byte(script, 0)? != MAGIC[0] || byte(script, 1)? != MAGIC[1] {
        return Err(VmError::BadMagic);
    }
    if byte(script, 2)? != VERSION {
        return Err(VmError::BadVersion);
    }
    let flags = byte(script, 3)?;
    let n_keys = byte(script, 4)?;
    let n_reasons = byte(script, 5)?;
    let code_len = u16::from_le_bytes([byte(script, 6)?, byte(script, 7)?]) as usize;
    let gas_max = u16::from_le_bytes([byte(script, 8)?, byte(script, 9)?]);
    let globals_len = u16::from_le_bytes([byte(script, 10)?, byte(script, 11)?]);
    let wvars_len = byte(script, 12)?;
    let max_stack = byte(script, 13)?;
    let n_locals = byte(script, 14)?;
    if byte(script, 15)? != 0
        || n_keys as usize > MAX_KEYS
        || n_reasons as usize > MAX_REASONS
        || globals_len as usize > GLOBALS_LEN
        || wvars_len as usize > WVARS_LEN
        || max_stack as usize > STACK_MAX
        || n_locals as usize > LOCALS_MAX
    {
        return Err(VmError::BadHeader);
    }
    let keys_end = HEADER_LEN + 32 * n_keys as usize;
    let keys = script.get(HEADER_LEN..keys_end).ok_or(VmError::BadLength)?;
    let mut p = keys_end;
    let mut i = 0;
    while i < n_reasons {
        let fmt = byte(script, p)?;
        let len = byte(script, p + 1)? as usize;
        if fmt > fmt::FMT_MAX || len > MAX_REASON_LEN {
            return Err(VmError::BadReason);
        }
        p += 2 + len;
        if p > script.len() {
            return Err(VmError::BadLength);
        }
        i += 1;
    }
    let reasons = script.get(keys_end..p).ok_or(VmError::BadLength)?;
    let code = script.get(p..).ok_or(VmError::BadLength)?;
    if code.len() != code_len {
        return Err(VmError::BadLength);
    }
    Ok(Header { flags, n_keys, n_reasons, gas_max, globals_len, wvars_len, max_stack, n_locals, keys, reasons, code })
}

// ───────────── operand readers ─────────────

#[inline]
pub(crate) fn rd8(c: &[u8], pc: &mut usize) -> Result<u8, VmError> {
    let v = c.get(*pc).copied().ok_or(VmError::BadOperand)?;
    *pc += 1;
    Ok(v)
}
#[inline]
pub(crate) fn rd16(c: &[u8], pc: &mut usize) -> Result<u16, VmError> {
    let a = rd8(c, pc)?;
    let b = rd8(c, pc)?;
    Ok(u16::from_le_bytes([a, b]))
}
#[inline]
pub(crate) fn rd32(c: &[u8], pc: &mut usize) -> Result<u32, VmError> {
    let a = rd16(c, pc)?;
    let b = rd16(c, pc)?;
    Ok((a as u32) | ((b as u32) << 16))
}
/// Zigzag LEB128, at most 10 bytes.
pub(crate) fn rdvar(c: &[u8], pc: &mut usize) -> Result<i64, VmError> {
    let mut x: u64 = 0;
    let mut shift = 0u32;
    loop {
        let b = rd8(c, pc)?;
        if shift == 63 && (b & 0x7e) != 0 {
            return Err(VmError::BadOperand);
        }
        x |= ((b & 0x7f) as u64) << shift;
        if b & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift > 63 {
            return Err(VmError::BadOperand);
        }
    }
    Ok(((x >> 1) as i64) ^ -((x & 1) as i64))
}

// ───────────── context reads ─────────────

pub(crate) fn ctx_field(ctx: &Ctx, f: u8) -> Result<i64, VmError> {
    let d = ctx.decimals;
    Ok(match f {
        op::C_KIND => ctx.kind as i64,
        op::C_AMOUNT => tok(ctx.amount, d),
        op::C_VALUE => math::muldiv(tok(ctx.amount, d), u2i(ctx.price_e6), 1_000_000_000_000_000),
        op::C_SLOT => n(u2i(ctx.slot)),
        op::C_NOW => n(ctx.now),
        op::C_LAUNCH => n(ctx.launch_ts),
        op::C_AGE => n(ctx.now.saturating_sub(ctx.launch_ts)),
        op::C_LAUNCH_SLOT => n(u2i(ctx.launch_slot)),
        op::C_SUPPLY => tok(ctx.supply, d),
        op::C_PRICE => u2i(ctx.price_e6),
        op::C_PROGRESS => ctx.progress_ppm as i64,
        op::C_MCAP => math::muldiv(tok(ctx.supply, d), u2i(ctx.price_e6), 1_000_000_000_000_000),
        op::C_RAISED => u2i(ctx.quote_reserve / 1_000),
        op::C_FEE => (ctx.fee_bps as i64) * 100,
        op::C_SAME_WALLET => ctx.same_wallet as i64,
        op::C_IS_CREATOR => (*ctx_key(ctx, op::KC_TRADER) == ctx.creator) as i64,
        _ => return Err(VmError::BadOperand),
    })
}

/// Resolve a wallet side to 0 = sender, 1 = receiver.
#[inline]
pub(crate) fn side_of(ctx: &Ctx, side: u8) -> Result<u8, VmError> {
    let buy = ctx.kind == KIND_BUY;
    match side {
        op::S_SENDER => Ok(0),
        op::S_RECEIVER => Ok(1),
        op::S_TRADER => Ok(if buy { 1 } else { 0 }),
        op::S_OTHER => Ok(if buy { 0 } else { 1 }),
        _ => Err(VmError::BadOperand),
    }
}

fn wal_field(ctx: &Ctx, s: u8, f: u8) -> Result<i64, VmError> {
    let w = if s == 0 { &ctx.sender } else { &ctx.receiver };
    let d = ctx.decimals;
    let t = |ts: i64| if ts == 0 { 0 } else { n(ts) };
    Ok(match f {
        op::W_HAS_RECORD => w.has_record as i64,
        op::W_IS_POOL => w.is_pool as i64,
        op::W_BALANCE => tok(w.balance, d),
        op::W_BALANCE_AFTER => {
            let b = tok(w.balance, d);
            let a = tok(ctx.amount, d);
            if s == 0 {
                b.saturating_sub(a).max(0)
            } else {
                b.saturating_add(a)
            }
        }
        op::W_FIRST_RECEIPT => t(w.first_receipt_ts),
        op::W_LAST_BUY_SLOT => n(u2i(w.last_buy_slot)),
        op::W_LAST_BUY => t(w.last_buy_ts),
        op::W_LAST_SELL => t(w.last_sell_ts),
        op::W_BOUGHT => tok(w.bought, d),
        op::W_SOLD => tok(w.sold, d),
        op::W_BUYS => n(w.buys as i64),
        op::W_SELLS => n(w.sells as i64),
        op::W_LAST_TRADE => t(w.last_buy_ts.max(w.last_sell_ts)),
        op::W_HELD => {
            if w.first_receipt_ts == 0 {
                0
            } else {
                n(ctx.now.saturating_sub(w.first_receipt_ts).max(0))
            }
        }
        _ => return Err(VmError::BadOperand),
    })
}

/// Sum of lots (dir 0 = receipts, 1 = outflows) at or after now − window.
fn window_sum(ctx: &Ctx, s: u8, dir: u8, window: i64) -> Result<i64, VmError> {
    let w = if s == 0 { &ctx.sender } else { &ctx.receiver };
    let (cnt, lots) = match dir {
        0 => (w.n_in, &w.lots_in),
        1 => (w.n_out, &w.lots_out),
        _ => return Err(VmError::BadOperand),
    };
    let secs = if window < 0 { 0 } else { window / ONE };
    let cutoff = ctx.now.saturating_sub(secs);
    let mut sum: i64 = 0;
    for (i, l) in lots.iter().enumerate() {
        if i >= cnt as usize {
            break;
        }
        if ctx.launch_ts.saturating_add(l.t as i64) >= cutoff {
            sum = sum.saturating_add(tok(l.amount, ctx.decimals));
        }
    }
    Ok(sum)
}

const ZERO_KEY: [u8; 32] = [0u8; 32];

fn ctx_key(ctx: &Ctx, id: u8) -> &[u8; 32] {
    let buy = ctx.kind == KIND_BUY;
    match id {
        op::KC_SENDER => &ctx.sender.key,
        op::KC_RECEIVER => &ctx.receiver.key,
        op::KC_TRADER => {
            if buy {
                &ctx.receiver.key
            } else {
                &ctx.sender.key
            }
        }
        op::KC_CREATOR => &ctx.creator,
        op::KC_APP => &ctx.app,
        op::KC_OTHER => {
            if buy {
                &ctx.sender.key
            } else {
                &ctx.receiver.key
            }
        }
        _ => &ZERO_KEY,
    }
}

// ───────────── typed storage ─────────────

fn load(area: &[u8], present: bool, ty: u8, off: u8, launch_ts: i64) -> Result<i64, VmError> {
    let size = op::type_size(ty).ok_or(VmError::BadOperand)?;
    let o = off as usize;
    let b = area.get(o..o + size).ok_or(VmError::BadSlot)?;
    if !present {
        return Ok(0);
    }
    let mut buf = [0u8; 8];
    for (d, s) in buf.iter_mut().zip(b.iter()) {
        *d = *s;
    }
    Ok(match ty {
        op::T_NUM => i64::from_le_bytes(buf),
        op::T_INT => n(i32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as i64),
        op::T_TIME => {
            let v = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as i64;
            if v == 0 {
                0
            } else {
                n(launch_ts.saturating_add(v - 1))
            }
        }
        _ => (buf[0] != 0) as i64,
    })
}

fn store(area: &mut [u8], present: bool, ty: u8, off: u8, v: i64, launch_ts: i64) -> Result<(), VmError> {
    let size = op::type_size(ty).ok_or(VmError::BadOperand)?;
    let o = off as usize;
    let b = area.get_mut(o..o + size).ok_or(VmError::BadSlot)?;
    if !present {
        return Ok(());
    }
    let mut buf = [0u8; 8];
    match ty {
        op::T_NUM => buf = v.to_le_bytes(),
        op::T_INT => {
            let w = (v / ONE).clamp(i32::MIN as i64, i32::MAX as i64) as i32;
            buf[..4].copy_from_slice(&w.to_le_bytes());
        }
        op::T_TIME => {
            let r: i64 = if v == 0 {
                0
            } else {
                (v / ONE).saturating_sub(launch_ts).saturating_add(1).clamp(1, u32::MAX as i64)
            };
            buf[..4].copy_from_slice(&(r as u32).to_le_bytes());
        }
        _ => buf[0] = (v != 0) as u8,
    }
    for (d, s) in b.iter_mut().zip(buf.iter()) {
        *d = *s;
    }
    Ok(())
}

// ───────────── the machine ─────────────

struct Mem {
    g: [u8; GLOBALS_LEN],
    glen: usize,
    ws: [u8; WVARS_LEN],
    wd: [u8; WVARS_LEN],
    has_s: bool,
    has_d: bool,
    same: bool,
}

impl Mem {
    /// (area, present) for resolved side 0/1.
    fn wvars(&self, s: u8) -> (&[u8], bool) {
        if s == 0 || self.same {
            (&self.ws, self.has_s)
        } else {
            (&self.wd, self.has_d)
        }
    }
    fn wvars_mut(&mut self, s: u8) -> (&mut [u8], bool) {
        if s == 0 || self.same {
            (&mut self.ws, self.has_s)
        } else {
            (&mut self.wd, self.has_d)
        }
    }
    fn globals(&self) -> &[u8] {
        self.g.get(..self.glen).unwrap_or(&[])
    }
    fn globals_mut(&mut self) -> &mut [u8] {
        let l = self.glen;
        self.g.get_mut(..l).unwrap_or(&mut [])
    }
}

fn key_of<'a>(h: &Header<'a>, ctx: &'a Ctx, mem: &'a Mem, kind: u8, arg: u8) -> Result<&'a [u8], VmError> {
    match kind {
        op::K_CTX => {
            if arg > op::KC_OTHER {
                return Err(VmError::BadKey);
            }
            Ok(ctx_key(ctx, arg))
        }
        op::K_CONST => {
            if arg >= h.n_keys {
                return Err(VmError::BadKey);
            }
            let o = 32 * arg as usize;
            h.keys.get(o..o + 32).ok_or(VmError::BadKey)
        }
        op::K_GLOBAL => {
            let o = arg as usize;
            mem.globals().get(o..o + 32).ok_or(VmError::BadSlot)
        }
        op::K_WVAR => {
            let s = side_of(ctx, arg)?;
            let (a, present) = mem.wvars(s);
            if present {
                a.get(0..32).ok_or(VmError::BadSlot)
            } else {
                Ok(&ZERO_KEY)
            }
        }
        _ => Err(VmError::BadKey),
    }
}

fn key_copy(h: &Header<'_>, ctx: &Ctx, mem: &Mem, kind: u8, arg: u8) -> Result<[u8; 32], VmError> {
    let k = key_of(h, ctx, mem, kind, arg)?;
    let mut out = [0u8; 32];
    for (d, s) in out.iter_mut().zip(k.iter()) {
        *d = *s;
    }
    Ok(out)
}

struct Stack {
    v: [i64; STACK_MAX],
    n: usize,
}

impl Stack {
    #[inline]
    fn push(&mut self, x: i64) -> Result<(), VmError> {
        let slot = self.v.get_mut(self.n).ok_or(VmError::StackOverflow)?;
        *slot = x;
        self.n += 1;
        Ok(())
    }
    #[inline]
    fn pop(&mut self) -> Result<i64, VmError> {
        if self.n == 0 {
            return Err(VmError::StackUnderflow);
        }
        self.n -= 1;
        self.v.get(self.n).copied().ok_or(VmError::StackUnderflow)
    }
}

fn ring_read(g: &[u8], off: usize, i: usize) -> Result<i64, VmError> {
    let o = off + 8 * i;
    let b = g.get(o..o + 8).ok_or(VmError::BadSlot)?;
    let mut buf = [0u8; 8];
    buf.copy_from_slice(b);
    Ok(i64::from_le_bytes(buf))
}
fn ring_write(g: &mut [u8], off: usize, i: usize, v: i64) -> Result<(), VmError> {
    let o = off + 8 * i;
    let b = g.get_mut(o..o + 8).ok_or(VmError::BadSlot)?;
    b.copy_from_slice(&v.to_le_bytes());
    Ok(())
}

/// Price ring (curve.price_at): [bucket+1 : i64][p0..p4 : i64], bucket = now / w.
fn ring_tick(g: &mut [u8], off: usize, w: u32, now: i64, price: i64) -> Result<(), VmError> {
    if w == 0 || off + op::RING_BYTES > g.len() {
        return Err(VmError::BadSlot);
    }
    let b = math::clamp_t(now) / (w as i64);
    let stored = ring_read(g, off, 0)?;
    let cur = b + 1;
    if stored == 0 || cur < stored || cur - stored >= 5 {
        for i in 0..5 {
            ring_write(g, off, 1 + i, 0)?;
        }
    } else if cur > stored {
        let mut k = stored; // clear buckets stored .. b (as indices stored-1+1 .. b)
        while k < cur {
            ring_write(g, off, 1 + (k % 5) as usize, 0)?;
            k += 1;
        }
    } else {
        return Ok(());
    }
    ring_write(g, off, 1 + (b % 5) as usize, price)?;
    ring_write(g, off, 0, cur)
}

fn ring_at(g: &[u8], off: usize, w: u32, now: i64, price: i64) -> Result<i64, VmError> {
    if w == 0 || off + op::RING_BYTES > g.len() {
        return Err(VmError::BadSlot);
    }
    let b = math::clamp_t(now) / (w as i64);
    let stored = ring_read(g, off, 0)?;
    if stored == 0 {
        return Ok(price);
    }
    let last = stored - 1;
    let mut j: i64 = 4;
    while j >= 0 {
        let bucket = b - j;
        if bucket >= 0 && bucket <= last && bucket > last - 5 {
            let v = ring_read(g, off, 1 + (bucket % 5) as usize)?;
            if v != 0 {
                return Ok(v);
            }
        }
        j -= 1;
    }
    Ok(price)
}

/// Per-op hook, for CU calibration benches only (`run_traced`). `run` uses a no-op tracer that compiles away.
pub trait Tracer {
    fn op(&mut self, pc: usize, op: u8);
}
struct NoTrace;
impl Tracer for NoTrace {
    #[inline(always)]
    fn op(&mut self, _pc: usize, _op: u8) {}
}

/// Run a script against one transfer.
///
/// * `code`: the whole script (header + tables + ops), ≤ 1,024 bytes.
/// * `globals`: the coin's 256-byte globals area (`Script.globals`).
/// * `wallet_src` / `wallet_dst`: the 32-byte script-var areas of the source / destination Wallet records.
///   Pass an empty slice when there is no record (pool vault side, or not opened): reads give 0, writes are dropped.
///
/// State is written back only on `Ok(Verdict::Allow)`.
pub fn run(
    code: &[u8],
    ctx: &Ctx,
    globals: &mut [u8],
    wallet_src: &mut [u8],
    wallet_dst: &mut [u8],
) -> Result<Verdict, VmError> {
    let mut gas = 0u32;
    run_metered(code, ctx, globals, wallet_src, wallet_dst, &mut gas)
}

/// `run`, also reporting the gas (CU) charged.
pub fn run_metered(
    code: &[u8],
    ctx: &Ctx,
    globals: &mut [u8],
    wallet_src: &mut [u8],
    wallet_dst: &mut [u8],
    gas_used: &mut u32,
) -> Result<Verdict, VmError> {
    run_traced(code, ctx, globals, wallet_src, wallet_dst, gas_used, &mut NoTrace)
}

/// `run_metered` with a per-op tracer (benches).
pub fn run_traced<T: Tracer>(
    code: &[u8],
    ctx: &Ctx,
    globals: &mut [u8],
    wallet_src: &mut [u8],
    wallet_dst: &mut [u8],
    gas_used: &mut u32,
    tracer: &mut T,
) -> Result<Verdict, VmError> {
    *gas_used = 0;
    let h = parse(code)?;
    let mut mem = Mem {
        g: [0u8; GLOBALS_LEN],
        glen: globals.len().min(GLOBALS_LEN),
        ws: [0u8; WVARS_LEN],
        wd: [0u8; WVARS_LEN],
        has_s: wallet_src.len() >= WVARS_LEN,
        has_d: !ctx.same_wallet && wallet_dst.len() >= WVARS_LEN,
        same: ctx.same_wallet,
    };
    for (d, s) in mem.g.iter_mut().zip(globals.iter()) {
        *d = *s;
    }
    if mem.has_s {
        for (d, s) in mem.ws.iter_mut().zip(wallet_src.iter()) {
            *d = *s;
        }
    }
    if mem.has_d {
        for (d, s) in mem.wd.iter_mut().zip(wallet_dst.iter()) {
            *d = *s;
        }
    }
    let verdict = exec(&h, ctx, &mut mem, gas_used, tracer)?;
    if verdict == Verdict::Allow {
        for (d, s) in globals.iter_mut().zip(mem.g.iter()) {
            *d = *s;
        }
        if mem.has_s {
            for (d, s) in wallet_src.iter_mut().zip(mem.ws.iter()) {
                *d = *s;
            }
        }
        if mem.has_d {
            for (d, s) in wallet_dst.iter_mut().zip(mem.wd.iter()) {
                *d = *s;
            }
        }
    }
    Ok(verdict)
}

fn exec<T: Tracer>(h: &Header<'_>, ctx: &Ctx, mem: &mut Mem, gas: &mut u32, tracer: &mut T) -> Result<Verdict, VmError> {
    let c = h.code;
    let mut st = Stack { v: [0i64; STACK_MAX], n: 0 };
    let mut loc = [0i64; LOCALS_MAX];
    let mut pc = 0usize;
    loop {
        let o = match c.get(pc) {
            Some(b) => *b,
            None => return Ok(Verdict::Allow),
        };
        tracer.op(pc, o);
        let w = op::gas(o).ok_or(VmError::BadOpcode)?;
        *gas = gas.saturating_add(w as u32);
        if *gas > GAS_LIMIT {
            return Err(VmError::OutOfGas);
        }
        pc += 1;
        match o {
            op::END => return Ok(Verdict::Allow),
            op::REFUSE | op::REFUSEV => {
                let r = rd8(c, &mut pc)?;
                if r >= h.n_reasons {
                    return Err(VmError::BadReason);
                }
                let arg = if o == op::REFUSEV { st.pop()? } else { 0 };
                return Ok(Verdict::Refuse { reason_id: r, arg });
            }
            op::JMP | op::JZ | op::JNZ => {
                let off = rd16(c, &mut pc)? as usize;
                let target = pc + off;
                if target > c.len() {
                    return Err(VmError::BadJump);
                }
                let take = match o {
                    op::JMP => true,
                    op::JZ => st.pop()? == 0,
                    _ => st.pop()? != 0,
                };
                if take {
                    pc = target;
                }
            }
            op::POP => {
                st.pop()?;
            }
            op::DUP => {
                let a = st.pop()?;
                st.push(a)?;
                st.push(a)?;
            }
            op::PUSHI => {
                let v = rdvar(c, &mut pc)?;
                st.push(n(v))?;
            }
            op::PUSHR => {
                let v = rdvar(c, &mut pc)?;
                st.push(v)?;
            }
            op::LDL => {
                let i = rd8(c, &mut pc)? as usize;
                let v = *loc.get(i).ok_or(VmError::BadOperand)?;
                st.push(v)?;
            }
            op::STL => {
                let i = rd8(c, &mut pc)? as usize;
                let v = st.pop()?;
                *loc.get_mut(i).ok_or(VmError::BadOperand)? = v;
            }
            op::NEG | op::ABS | op::NOT => {
                let a = st.pop()?;
                st.push(match o {
                    op::NEG => a.saturating_neg(),
                    op::ABS => a.saturating_abs(),
                    _ => (a == 0) as i64,
                })?;
            }
            op::MULDIV => {
                let cc = st.pop()?;
                let b = st.pop()?;
                let a = st.pop()?;
                st.push(math::muldiv(a, b, cc))?;
            }
            op::ADD | op::SUB | op::MUL | op::DIV | op::MOD | op::MIN | op::MAX | op::EQ | op::NE | op::LT
            | op::LE | op::GT | op::GE => {
                let b = st.pop()?;
                let a = st.pop()?;
                st.push(match o {
                    op::ADD => a.saturating_add(b),
                    op::SUB => a.saturating_sub(b),
                    op::MUL => math::mul(a, b),
                    op::DIV => math::div(a, b),
                    op::MOD => math::rem(a, b),
                    op::MIN => a.min(b),
                    op::MAX => a.max(b),
                    op::EQ => (a == b) as i64,
                    op::NE => (a != b) as i64,
                    op::LT => (a < b) as i64,
                    op::LE => (a <= b) as i64,
                    op::GT => (a > b) as i64,
                    _ => (a >= b) as i64,
                })?;
            }
            op::CTX => {
                let f = rd8(c, &mut pc)?;
                st.push(ctx_field(ctx, f)?)?;
            }
            op::WAL => {
                let side = rd8(c, &mut pc)?;
                let f = rd8(c, &mut pc)?;
                let s = side_of(ctx, side)?;
                st.push(wal_field(ctx, s, f)?)?;
            }
            op::WIN => {
                let side = rd8(c, &mut pc)?;
                let dir = rd8(c, &mut pc)?;
                let s = side_of(ctx, side)?;
                let win = st.pop()?;
                st.push(window_sum(ctx, s, dir, win)?)?;
            }
            op::CLOCK => {
                let f = rd8(c, &mut pc)?;
                let tz = rd16(c, &mut pc)? as i16;
                let rule = rd8(c, &mut pc)?;
                if rule > 3 {
                    return Err(VmError::BadOperand);
                }
                st.push(math::clock(ctx.now, f, tz, rule).ok_or(VmError::BadOperand)?)?;
            }
            op::DAYLIGHT => {
                let lat = rd16(c, &mut pc)? as i16;
                let lon = rd16(c, &mut pc)? as i16;
                st.push(math::daylight(ctx.now, lat, lon) as i64)?;
            }
            op::MOON => {
                let f = rd8(c, &mut pc)?;
                st.push(math::moon(ctx.now, f).ok_or(VmError::BadOperand)?)?;
            }
            op::DECAY => {
                let every = st.pop()?;
                let elapsed = st.pop()?;
                let rate = st.pop()?;
                let x = st.pop()?;
                st.push(math::decay(x, rate, elapsed, every))?;
            }
            op::RINGTICK => {
                let off = rd8(c, &mut pc)? as usize;
                let w = rd32(c, &mut pc)?;
                ring_tick(mem.globals_mut(), off, w, ctx.now, u2i(ctx.price_e6))?;
            }
            op::RINGAT => {
                let off = rd8(c, &mut pc)? as usize;
                let w = rd32(c, &mut pc)?;
                st.push(ring_at(mem.globals(), off, w, ctx.now, u2i(ctx.price_e6))?)?;
            }
            op::LDG => {
                let ty = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)?;
                st.push(load(mem.globals(), true, ty, off, ctx.launch_ts)?)?;
            }
            op::STG => {
                let ty = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)?;
                let v = st.pop()?;
                store(mem.globals_mut(), true, ty, off, v, ctx.launch_ts)?;
            }
            op::LDW => {
                let side = rd8(c, &mut pc)?;
                let ty = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)?;
                let s = side_of(ctx, side)?;
                let (a, present) = mem.wvars(s);
                st.push(load(a, present, ty, off, ctx.launch_ts)?)?;
            }
            op::STW => {
                let side = rd8(c, &mut pc)?;
                let ty = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)?;
                let s = side_of(ctx, side)?;
                let v = st.pop()?;
                let (a, present) = mem.wvars_mut(s);
                store(a, present, ty, off, v, ctx.launch_ts)?;
            }
            op::KEQ => {
                let ka = rd8(c, &mut pc)?;
                let aa = rd8(c, &mut pc)?;
                let kb = rd8(c, &mut pc)?;
                let ab = rd8(c, &mut pc)?;
                let eq = key_of(h, ctx, mem, ka, aa)? == key_of(h, ctx, mem, kb, ab)?;
                st.push(eq as i64)?;
            }
            op::KSTG => {
                let off = rd8(c, &mut pc)? as usize;
                let k = rd8(c, &mut pc)?;
                let a = rd8(c, &mut pc)?;
                let key = key_copy(h, ctx, mem, k, a)?;
                let dst = mem.globals_mut().get_mut(off..off + 32).ok_or(VmError::BadSlot)?;
                dst.copy_from_slice(&key);
            }
            op::KSTW => {
                let side = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)? as usize;
                let k = rd8(c, &mut pc)?;
                let a = rd8(c, &mut pc)?;
                let s = side_of(ctx, side)?;
                let key = key_copy(h, ctx, mem, k, a)?;
                let (area, present) = mem.wvars_mut(s);
                let dst = area.get_mut(off..off + 32).ok_or(VmError::BadSlot)?;
                if present {
                    dst.copy_from_slice(&key);
                }
            }
            _ => return Err(VmError::BadOpcode),
        }
    }
}

// ───────────── binary Ctx codec (tests, parity runner, CU bench) ─────────────

/// Size of `Ctx::encode` output.
pub const CTX_BYTES: usize = 8 + 8 * 8 + 2 + 32 + 32 + 2 * WALLET_BYTES;
const WALLET_BYTES: usize = 32 + 4 + 4 + 4 + 8 * 7 + 60 + 60; // key, 4 flags, buys, sells, 7 × u64, 2 × 5 lots

struct Rd<'a> {
    b: &'a [u8],
    p: usize,
}
impl<'a> Rd<'a> {
    fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
        let s = self.b.get(self.p..self.p + N)?;
        let mut a = [0u8; N];
        a.copy_from_slice(s);
        self.p += N;
        Some(a)
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take()?))
    }
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_le_bytes(self.take()?))
    }
    fn lots(&mut self) -> Option<[Lot; 5]> {
        let mut l = [Lot::default(); 5];
        for x in l.iter_mut() {
            x.t = self.u32()?;
            x.amount = self.u64()?;
        }
        Some(l)
    }
    fn wallet(&mut self) -> Option<WalletView> {
        let key = self.take::<32>()?;
        let has_record = self.u8()? != 0;
        let is_pool = self.u8()? != 0;
        let n_in = self.u8()?;
        let n_out = self.u8()?;
        let buys = self.u32()?;
        let sells = self.u32()?;
        Some(WalletView {
            key,
            has_record,
            is_pool,
            n_in,
            n_out,
            buys,
            sells,
            balance: self.u64()?,
            first_receipt_ts: self.i64()?,
            last_buy_slot: self.u64()?,
            last_buy_ts: self.i64()?,
            last_sell_ts: self.i64()?,
            bought: self.u64()?,
            sold: self.u64()?,
            lots_in: self.lots()?,
            lots_out: self.lots()?,
        })
    }
}

impl Ctx {
    /// Decode the fixed little-endian layout documented in SPEC.md ("Binary Ctx").
    pub fn decode(b: &[u8]) -> Option<Ctx> {
        if b.len() != CTX_BYTES {
            return None;
        }
        let mut r = Rd { b, p: 0 };
        let kind = r.u8()?;
        let decimals = r.u8()?;
        let same_wallet = r.u8()? != 0;
        let _pad = r.u8()?;
        let progress_ppm = r.u32()?;
        Some(Ctx {
            kind,
            decimals,
            same_wallet,
            progress_ppm,
            amount: r.u64()?,
            supply: r.u64()?,
            slot: r.u64()?,
            now: r.i64()?,
            launch_ts: r.i64()?,
            launch_slot: r.u64()?,
            price_e6: r.u64()?,
            quote_reserve: r.u64()?,
            fee_bps: r.u16()?,
            creator: r.take()?,
            app: r.take()?,
            sender: r.wallet()?,
            receiver: r.wallet()?,
        })
    }
}

#[cfg(test)]
mod tests;
