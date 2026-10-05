//! hookrz_engine: one Token-2022 transfer hook for every hookrz coin.
//!
//! Each coin's mint names this program as its TransferHook (authority: the Meteora DBC pool
//! authority, so the curve removes the hook in the graduating swap). At launch the pool creator
//! writes the coin's rule stack once (`init_stack`); on every transfer Token-2022 calls `Execute`,
//! which classifies the transfer (buy / sell / send against the pool's base vault), runs the
//! stack's blocks in slot order and refuses with the first block's error code. Hookscript, if the
//! coin has one, runs after the blocks. State is written only after every check passed.
//!
//! The program holds no keys, makes no CPIs inside `Execute`, can't move funds and has no admin
//! instruction. The only creator power after launch is `set_mark` (Blocklist marks until the list
//! freezes; Allowlist passes), and only for blocks the stack named at launch. Hardening carried over
//! from away-rules (docs/HOUSE-RULES.md in away-tek):
//! C1 (forged CPI: source and destination must be accounts of this mint, source transferring, no
//! CPIs), H1 (hold-timer lots never extend earlier lots), M1 (pre-funded PDAs), L1 (pool layout
//! checks beside the discriminator), L2 (close paths only after the hook is retired), S1/S2
//! (liveness from the mint's hook; rent to the on-chain creator / payer).
//!
//! Account data is read through fixed-size array views (`head`): one length check per account,
//! after which every field offset is checked at compile time, so the program carries no
//! bounds-check panics (and none of core's panic-formatting code).
//!
//! Account layouts and instruction data: see LAYOUT.md.

#![cfg_attr(target_os = "solana", no_std)]

pub mod blocks;

use blocks::{Ctx, Kind, Lot, WalletView, LOTS, MAX_SLOTS, PARAMS, STATE};
use pinocchio::{
    cpi::{Seed as CpiSeed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};

type Pubkey = Address;
const fn pubkey(s: &str) -> Address {
    Address::from_str_const(s)
}
const SYSTEM_PROGRAM: Address = Address::new_from_array([0u8; 32]);

/// The local-fork address, for off-chain callers and tests only. The program itself never reads it:
/// every owner and PDA check uses the `program_id` the runtime passes to the entrypoint, so one build
/// works at any deployed address (fork, devnet, mainnet). The fork suite runs a second time at a random
/// address to prove it (`ENGINE_ID=… npm test`).
pub const LOCAL_FORK_ID: Address = pubkey("EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr");

// pinocchio entrypoint: zero-copy accounts, no allocator, a panic handler that never formats.
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::program_entrypoint!(process_instruction);
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::no_allocator!();
#[cfg(not(feature = "no-entrypoint"))]
pinocchio::nostd_panic_handler!();

pub const TOKEN_2022: Pubkey = pubkey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const SPL_TOKEN: Pubkey = pubkey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM: Pubkey = pubkey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const DBC_PROGRAM: Pubkey = pubkey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
pub const DBC_POOL_AUTHORITY: Pubkey = pubkey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
/// sha256("spl-transfer-hook-interface:execute")[..8]
pub const EXECUTE_DISCRIMINATOR: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
/// DBC account discriminators.
pub const DBC_HOOK_POOL_DISC: [u8; 8] = [237, 219, 184, 23, 42, 189, 169, 35];
pub const DBC_HOOK_CONFIG_DISC: [u8; 8] = [40, 220, 194, 251, 41, 199, 123, 253];
pub const DBC_CONFIG_DISC: [u8; 8] = [26, 108, 14, 123, 116, 230, 129, 43];
// Byte offsets in a DBC pool (8-byte discriminator + bytemuck PoolState).
const POOL_CONFIG: usize = 72;
const POOL_CREATOR: usize = 104;
const POOL_BASE_MINT: usize = 136;
const POOL_BASE_VAULT: usize = 168;
const POOL_QUOTE_RESERVE: usize = 240;
const POOL_SQRT_PRICE: usize = 280;
const POOL_ACTIVATION_POINT: usize = 296;
/// Bytes of a DBC pool the engine reads in Execute (through the sqrt price) and at init (through the activation point).
const POOL_MIN: usize = POOL_SQRT_PRICE + 16;
const POOL_MIN_INIT: usize = POOL_ACTIVATION_POINT + 8;
// In a DBC config (PoolConfig, also the prefix of ConfigWithTransferHook).
const CONFIG_BASE_FEE: usize = 104; // cliff_fee_numerator u64 · second u64 · third u64 · first u16 · mode u8
const CONFIG_DYNAMIC_FEE_ON: usize = 136;
const CONFIG_ACTIVATION_TYPE: usize = 234;
const CONFIG_MIGRATION_QUOTE_THRESHOLD: usize = 264;
const CONFIG_MIN: usize = CONFIG_MIGRATION_QUOTE_THRESHOLD + 8;
/// SPL Token / Token-2022 base sizes.
const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;

pub const IX_INIT_STACK: u8 = 0xA0;
pub const IX_OPEN_WALLET: u8 = 0xA1;
pub const IX_CLOSE_WALLET: u8 = 0xA2;
pub const IX_CLOSE_STACK: u8 = 0xA3;
pub const IX_WRITE_SCRIPT: u8 = 0xA4;
pub const IX_SET_MARK: u8 = 0xA5;

pub const STACK_SEED: &[u8] = b"stack";
pub const WALLET_SEED: &[u8] = b"w";
pub const SCRIPT_SEED: &[u8] = b"script";
pub const MARK_SEED: &[u8] = b"mark";
pub const EXTRA_METAS_SEED: &[u8] = b"extra-account-metas";

// ───────── Stack account (640 bytes) ─────────
/// sha256("account:Stack")[..8]
pub const STACK_DISC: [u8; 8] = [58, 70, 168, 244, 188, 169, 129, 79];
pub const STACK_SIZE: usize = 640;
pub const S_VERSION: usize = 8;
pub const S_BUMP: usize = 9;
pub const S_FLAGS: usize = 10;
pub const S_SLOT_COUNT: usize = 12;
pub const S_MINT: usize = 16;
pub const S_CREATOR: usize = 48;
pub const S_POOL: usize = 80;
pub const S_BASE_VAULT: usize = 112;
pub const S_PARENT_STACK: usize = 144;
pub const S_PARENT_AUTHOR: usize = 176;
pub const S_LAUNCH_SLOT: usize = 208;
pub const S_LAUNCH_TS: usize = 216;
pub const S_SLOTS: usize = 224;
pub const SLOT_SIZE: usize = 2 + PARAMS + STATE; // 58
pub const S_SCRIPT: usize = 572;
pub const S_LAST_SQRT: usize = 604;
pub const S_THRESHOLD: usize = 620;
/// DBC pool activation point (slot or unix time, per the config's activation type), for the fee.
pub const S_ACTIVATION_POINT: usize = 628;

pub const F_ARMED: u16 = 1;
pub const F_POOL: u16 = 2;
pub const F_WALLETS: u16 = 4;
pub const F_SCRIPT: u16 = 8;
pub const F_STACK_WRITABLE: u16 = 16;
pub const F_APP: u16 = 32;
/// Blocklist / Allowlist Phase: the owners' marks are in the meta list.
pub const F_MARKS: u16 = 64;
/// Token Gate: the gate mint, its token program, the ATA program and the receiver's gate ATA are in the meta list.
pub const F_GATE: u16 = 128;

// ───────── Wallet record (328 bytes) ─────────
/// sha256("account:Wallet")[..8]
pub const WALLET_DISC: [u8; 8] = [24, 89, 59, 139, 81, 154, 232, 95];
pub const WALLET_SIZE: usize = 328;
pub const W_VERSION: usize = 8;
pub const W_BUMP: usize = 9;
pub const W_FLAGS: usize = 10;
pub const W_LOT_COUNT: usize = 11;
pub const W_FIRST_RECEIPT_TS: usize = 12;
pub const W_LAST_BUY_SLOT: usize = 20;
pub const W_LAST_SELL_TS: usize = 28;
pub const W_LOTS_IN: usize = 36;
pub const W_MINT: usize = 96;
pub const W_TOKEN_ACCOUNT: usize = 128;
pub const W_PAYER: usize = 160;
pub const W_SCRIPT_VARS: usize = 192;
pub const W_LAST_BUY_TS: usize = 224;
pub const W_BOUGHT: usize = 232;
pub const W_SOLD: usize = 240;
pub const W_BUYS: usize = 248;
pub const W_SELLS: usize = 252;
pub const W_N_OUT: usize = 256;
pub const W_LOTS_OUT: usize = 264;
pub const WF_HAS_BUY: u8 = 1;
pub const WF_HAS_SOLD: u8 = 2;
pub const WF_HAS_RECEIPT: u8 = 4;
const LOTS_BYTES: usize = LOTS * 12;

// ───────── Mark ["mark", mint, owner] (65 bytes): Blocklist / Allowlist Phase ─────────
pub const MARK_SIZE: usize = 65;
pub const MARK_BLOCKED: u8 = 1;
pub const MARK_PASS: u8 = 2;
pub const M_MINT: usize = 1;
pub const M_OWNER: usize = 33;

// ───────── Script account (1,296 bytes; layout from hookscript/SPEC.md §8) ─────────
/// sha256("account:Script")[..8]
pub const SCRIPT_DISC: [u8; 8] = [152, 19, 115, 143, 1, 19, 225, 121];
pub const SCRIPT_SIZE: usize = 1296;
pub const SC_VERSION: usize = 8;
pub const SC_BUMP: usize = 9;
pub const SC_CODE_LEN: usize = 10;
pub const SC_GLOBALS: usize = 16;
pub const SC_CODE: usize = 272;
pub const MAX_SCRIPT: usize = 1024;
pub const SCRIPT_GLOBALS: usize = 256;
/// Hookscript header flag: the script reads `transfer.app` (needs the instructions sysvar).
#[cfg_attr(not(feature = "hookscript"), allow(dead_code))]
const HS_FLAG_APP: u8 = 0x08;
pub const INSTRUCTIONS_SYSVAR: Pubkey = pubkey("Sysvar1nstructions1111111111111111111111111");

const META_SIZE: usize = 35;
/// Most ExtraAccountMetaList entries: Stack, pool, 2 wallets, script, sysvar, 2 marks, 4 gate accounts.
const MAX_METAS: usize = 12;

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineError {
    NotInTransfer = 6000,
    CustomRuleRefused = 6128,
    MissingWalletRecord = 6141,
    HookLive = 6142,
    StackLocked = 6143,
}
impl From<EngineError> for ProgramError {
    fn from(e: EngineError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

/// Error names in code order (6000..=6018, 6128, 6141, 6142, 6143), for the Anchor-style log line.
const ERROR_NAMES: &[u8] = b"NotInTransfer SnipeWindow BundleLimit MaxWalletExceeded RisingCapExceeded SandwichLockout \
Blocklisted NoAllowlistPass SellCapExceeded SellCooldown StillSettling CircuitBreaker MarketClosed NotSeasoned \
HourlyOutflowCap LockInPhase CreatorVesting TokenGated ChapterCap CustomRuleRefused MissingWalletRecord HookLive StackLocked";

/// End offset of each name in ERROR_NAMES (computed at compile time).
const ERROR_NAME_ENDS: [u16; 23] = {
    let mut out = [0u16; 23];
    let (mut i, mut k) = (0, 0);
    while i < ERROR_NAMES.len() {
        if ERROR_NAMES[i] == b' ' {
            out[k] = i as u16;
            k += 1;
        }
        i += 1;
    }
    out[22] = ERROR_NAMES.len() as u16;
    out
};

/// Fail with `code`, logging `Error Code: MaxWalletExceeded. Error Number: 6003` (the indexer matches on it).
fn refuse(code: u32) -> ProgramError {
    log(error_line(code, &mut [0u8; 64]));
    ProgramError::Custom(code)
}
/// The Anchor-style refusal line for `code`, built in `b` without core::fmt.
fn error_line(code: u32, b: &mut [u8; 64]) -> &str {
    let idx = match code {
        6000..=6018 => code - 6000,
        6128 => 19,
        6141..=6143 => code - 6121,
        _ => 23,
    } as usize;
    let start = match idx.checked_sub(1) {
        Some(i) => ERROR_NAME_ENDS.get(i).map_or(0, |&e| e as usize + 1),
        None => 0,
    };
    let name = ERROR_NAME_ENDS.get(idx).and_then(|&e| ERROR_NAMES.get(start..e as usize)).unwrap_or_default();
    let mut n = 0;
    for part in [&b"Error Code: "[..], name, b". Error Number: "] {
        if let Some(d) = b.get_mut(n..n + part.len()) {
            d.copy_from_slice(part);
            n += part.len();
        }
    }
    for div in [1000, 100, 10, 1] {
        if let Some(d) = b.get_mut(n) {
            *d = b'0' + (code / div % 10) as u8;
            n += 1;
        }
    }
    // SAFETY: every byte is ASCII.
    unsafe { core::str::from_utf8_unchecked(&b[..n.min(64)]) }
}
/// Logging without core::fmt: static text only (numbers go through `log_64`).
fn log(s: &str) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_log_(s.as_ptr(), s.len() as u64)
    };
    #[cfg(not(target_os = "solana"))]
    let _ = s;
}
fn log_64(a: u64, b: u64, c: u64, d: u64, e: u64) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_log_64_(a, b, c, d, e)
    };
    #[cfg(not(target_os = "solana"))]
    let _ = (a, b, c, d, e);
}
/// PDA derivation (a syscall on chain; never called by host tests).
#[cfg(target_os = "solana")]
fn find_pda(seeds: &[&[u8]], program_id: &Address) -> (Address, u8) {
    Address::find_program_address(seeds, program_id)
}
#[cfg(not(target_os = "solana"))]
fn find_pda(_seeds: &[&[u8]], _program_id: &Address) -> (Address, u8) {
    unimplemented!("PDA derivation is on-chain only")
}
#[cfg_attr(not(feature = "hookscript"), allow(dead_code))]
/// Log `prefix` + `text` through a stack buffer, no formatting. Non-ASCII bytes are logged as `?`,
/// so the line is always valid UTF-8 for the log syscall without linking a UTF-8 validator (the
/// exact text is in the Script account; off-chain code formats it from the reason id and arg).
fn log_join(prefix: &str, text: &[u8]) {
    let mut buf = [0u8; 160];
    let mut n = 0;
    for &c in prefix.as_bytes().iter().chain(text) {
        if let Some(d) = buf.get_mut(n) {
            *d = if c.is_ascii() { c } else { b'?' };
            n += 1;
        }
    }
    // SAFETY: every byte is ASCII.
    log(unsafe { core::str::from_utf8_unchecked(&buf[..n.min(160)]) });
}

pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if let Some((disc, rest)) = data.split_first_chunk::<8>() {
        if *disc == EXECUTE_DISCRIMINATOR {
            let amount = rest.first_chunk::<8>().ok_or(ProgramError::InvalidInstructionData)?;
            return execute(program_id, accounts, u64::from_le_bytes(*amount));
        }
    }
    let Some((&ix, args)) = data.split_first() else {
        return Err(ProgramError::InvalidInstructionData);
    };
    match ix {
        IX_INIT_STACK => init_stack(program_id, accounts, args),
        IX_OPEN_WALLET => open_wallet(program_id, accounts),
        IX_CLOSE_WALLET => close_wallet(program_id, accounts),
        IX_CLOSE_STACK => close_stack(program_id, accounts),
        IX_WRITE_SCRIPT => write_script(program_id, accounts, args),
        IX_SET_MARK => set_mark(program_id, accounts, args),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// The first `N` bytes of `d` as an array, or InvalidAccountData if `d` is shorter. Every constant
/// offset into the result is in bounds at compile time.
#[inline(always)]
fn head<const N: usize>(d: &[u8]) -> Result<&[u8; N], ProgramError> {
    d.first_chunk::<N>().ok_or(ProgramError::InvalidAccountData)
}
#[inline(always)]
fn head_mut<const N: usize>(d: &mut [u8]) -> Result<&mut [u8; N], ProgramError> {
    d.first_chunk_mut::<N>().ok_or(ProgramError::InvalidAccountData)
}
/// `N` bytes at a constant offset of a fixed layout (in bounds by construction; the check folds away).
#[inline(always)]
fn sub<const N: usize>(d: &[u8], at: usize) -> &[u8; N] {
    d.get(at..).and_then(|s| s.first_chunk::<N>()).unwrap()
}
#[inline(always)]
fn sub_mut<const N: usize>(d: &mut [u8], at: usize) -> &mut [u8; N] {
    d.get_mut(at..).and_then(|s| s.first_chunk_mut::<N>()).unwrap()
}
#[inline(always)]
fn rd<const N: usize>(d: &[u8], at: usize) -> [u8; N] {
    *sub::<N>(d, at)
}
#[inline(always)]
fn u64_at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(rd(d, at))
}
#[inline(always)]
fn i64_at(d: &[u8], at: usize) -> i64 {
    i64::from_le_bytes(rd(d, at))
}
#[inline(always)]
fn key_at(d: &[u8], at: usize) -> &[u8; 32] {
    sub::<32>(d, at)
}

// ───────────────────────── Execute (Token-2022, inside every transfer of a hooked mint) ─────────────────────────
#[cfg_attr(not(feature = "hookscript"), allow(dead_code))]
struct WalletRec {
    flags: u8,
    first_receipt_ts: i64,
    last_buy_slot: u64,
    last_buy_ts: i64,
    last_sell_ts: i64,
    bought: u64,
    sold: u64,
    buys: u32,
    sells: u32,
    lots_in: [Lot; LOTS],
    lots_out: [Lot; LOTS],
}
impl WalletRec {
    fn view(&self, launch_ts: i64) -> WalletView {
        WalletView {
            lots: self.lots_in,
            last_buy_slot: (self.flags & WF_HAS_BUY != 0).then_some(self.last_buy_slot),
            last_sell_t: (self.flags & WF_HAS_SOLD != 0).then_some(self.last_sell_ts.saturating_sub(launch_ts)),
            first_t: (self.flags & WF_HAS_RECEIPT != 0).then_some(self.first_receipt_ts.saturating_sub(launch_ts)),
        }
    }
}
fn read_lots(d: &[u8; LOTS_BYTES]) -> [Lot; LOTS] {
    let mut lots = [Lot::default(); LOTS];
    for (l, c) in lots.iter_mut().zip(d.as_chunks::<12>().0) {
        l.t = blocks::u32_at(c, 0) as i64;
        l.amount = blocks::u64_at(c, 4);
    }
    lots
}
/// Write the lots back; returns how many have an amount.
fn write_lots(d: &mut [u8; LOTS_BYTES], lots: &[Lot; LOTS]) -> u8 {
    for (c, l) in d.as_chunks_mut::<12>().0.iter_mut().zip(lots) {
        c[..4].copy_from_slice(&(l.t.clamp(0, u32::MAX as i64) as u32).to_le_bytes());
        c[4..].copy_from_slice(&l.amount.to_le_bytes());
    }
    lots.iter().filter(|l| l.amount > 0).count() as u8
}
#[inline(always)]
fn add_u64(d: &mut [u8; WALLET_SIZE], at: usize, v: u64) {
    let x = u64_at(d, at).saturating_add(v);
    *sub_mut(d, at) = x.to_le_bytes();
}
#[inline(always)]
fn inc_u32(d: &mut [u8; WALLET_SIZE], at: usize) {
    let x = u32::from_le_bytes(rd(d, at)).saturating_add(1);
    *sub_mut(d, at) = x.to_le_bytes();
}
/// Add `amount` at `t` to the lots at `at` (receipts or outflows) and store the live-lot count at `count_at`.
fn note_lot(d: &mut [u8; WALLET_SIZE], at: usize, count_at: usize, ep: (i64, i64), t: i64, amount: u64) {
    let mut lots = read_lots(sub(d, at));
    blocks::add_lot(&mut lots, ep, t, amount);
    let live = write_lots(sub_mut(d, at), &lots);
    d[count_at] = live;
}
/// The receiver's record after a receipt (read-modify-write on the account data itself).
/// `taint`: on a send from a wallet that has bought, the receiver inherits the sender's last buy
/// (slot, time) if it is later than its own, so buy → send → sell can't dodge Sandwich Guard.
#[allow(clippy::too_many_arguments)]
fn note_receipt(d: &mut [u8; WALLET_SIZE], ep: (i64, i64), t: i64, now: i64, slot: u64, amount: u64, buy: bool, taint: Option<(u64, i64)>) {
    note_lot(d, W_LOTS_IN, W_LOT_COUNT, ep, t, amount);
    if d[W_FLAGS] & WF_HAS_RECEIPT == 0 {
        d[W_FLAGS] |= WF_HAS_RECEIPT;
        *sub_mut(d, W_FIRST_RECEIPT_TS) = now.to_le_bytes();
    }
    if buy {
        d[W_FLAGS] |= WF_HAS_BUY;
        *sub_mut(d, W_LAST_BUY_SLOT) = slot.to_le_bytes();
        *sub_mut(d, W_LAST_BUY_TS) = now.to_le_bytes();
        add_u64(d, W_BOUGHT, amount);
        inc_u32(d, W_BUYS);
    } else if let Some((src_slot, src_ts)) = taint {
        let had = d[W_FLAGS] & WF_HAS_BUY != 0;
        if !had || src_slot > u64_at(d, W_LAST_BUY_SLOT) {
            *sub_mut(d, W_LAST_BUY_SLOT) = src_slot.to_le_bytes();
        }
        if !had || src_ts > i64_at(d, W_LAST_BUY_TS) {
            *sub_mut(d, W_LAST_BUY_TS) = src_ts.to_le_bytes();
        }
        d[W_FLAGS] |= WF_HAS_BUY;
    }
}
/// The sender's record after an outflow.
fn note_outflow(d: &mut [u8; WALLET_SIZE], ep: (i64, i64), t: i64, now: i64, amount: u64, sell: bool) {
    note_lot(d, W_LOTS_OUT, W_N_OUT, ep, t, amount);
    if sell {
        d[W_FLAGS] |= WF_HAS_SOLD;
        *sub_mut(d, W_LAST_SELL_TS) = now.to_le_bytes();
        add_u64(d, W_SOLD, amount);
        inc_u32(d, W_SELLS);
    }
}

/// The wallet record for `token_account`, if this account is one. A record of ours that names a
/// different mint or token account is a forged account list and fails the transfer.
fn load_wallet(program_id: &Pubkey, ai: &AccountView, mint: &Pubkey, token_account: &Pubkey) -> Result<Option<WalletRec>, ProgramError> {
    if !ai.owned_by(program_id) {
        return Ok(None);
    }
    let db = ai.try_borrow()?;
    let d = head::<WALLET_SIZE>(&db)?;
    if d[..8] != WALLET_DISC || d[W_VERSION] != 1 || key_at(d, W_MINT) != mint.as_array() || key_at(d, W_TOKEN_ACCOUNT) != token_account.as_array() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(Some(WalletRec {
        flags: d[W_FLAGS],
        first_receipt_ts: i64_at(d, W_FIRST_RECEIPT_TS),
        last_buy_slot: u64_at(d, W_LAST_BUY_SLOT),
        last_buy_ts: i64_at(d, W_LAST_BUY_TS),
        last_sell_ts: i64_at(d, W_LAST_SELL_TS),
        bought: u64_at(d, W_BOUGHT),
        sold: u64_at(d, W_SOLD),
        buys: blocks::u32_at(d, W_BUYS),
        sells: blocks::u32_at(d, W_SELLS),
        lots_in: read_lots(sub(d, W_LOTS_IN)),
        lots_out: read_lots(sub(d, W_LOTS_OUT)),
    }))
}

/// A bucketed counter in slot state (`0: u64 key · 8: u64 value`): the value if the key is current, else 0.
/// Anti-Bundle keys it by slot, the Hourly Outflow Cap by the hour since launch.
#[inline(always)]
fn bucket(st: &[u8; STATE], key: u64) -> u64 {
    if u64_at(st, 0) == key {
        u64_at(st, 8)
    } else {
        0
    }
}

fn execute(program_id: &Pubkey, accounts: &mut [AccountView], amount: u64) -> ProgramResult {
    let [source, mint, destination, _authority, _meta_list, stack_ai, rest @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    // C1: only a live Token-2022 transfer *of this mint* may drive this handler. The source carries
    // TransferHookAccount.transferring = true for the duration of the hook call, and both sides
    // must be accounts of `mint`. This program makes no CPIs, so an account of `mint` can only be
    // transferring inside a genuine transfer of `mint`, whose hook is this program.
    if !source.owned_by(&TOKEN_2022) || !mint.owned_by(&TOKEN_2022) || !destination.owned_by(&TOKEN_2022) {
        return Err(EngineError::NotInTransfer.into());
    }
    let srcb = source.try_borrow()?;
    let dstb = destination.try_borrow()?;
    let (Some(src), Some(dst)) = (token_account(&srcb, mint.address()), token_account(&dstb, mint.address())) else {
        return Err(EngineError::NotInTransfer.into());
    };
    if !is_transferring(&srcb) {
        return Err(EngineError::NotInTransfer.into());
    }

    // The Stack: ours, and for this mint. (Only init_stack creates Stack accounts, at the mint's PDA.)
    if !stack_ai.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountData);
    }
    let sdb = stack_ai.try_borrow()?;
    let sd = head::<STACK_SIZE>(&sdb)?;
    if sd[..8] != STACK_DISC || sd[S_VERSION] != 1 || key_at(sd, S_MINT) != mint.address().as_array() {
        return Err(ProgramError::InvalidAccountData);
    }
    let flags = blocks::u16_at(sd, S_FLAGS);
    let n = (sd[S_SLOT_COUNT] as usize).min(MAX_SLOTS);
    let base_vault = key_at(sd, S_BASE_VAULT);
    let creator = key_at(sd, S_CREATOR);
    let launch_slot = u64_at(sd, S_LAUNCH_SLOT);
    let launch_ts = i64_at(sd, S_LAUNCH_TS);
    let last_sqrt = u128::from_le_bytes(rd(sd, S_LAST_SQRT));

    let kind = if source.address().as_array() == base_vault {
        Kind::Buy
    } else if destination.address().as_array() == base_vault {
        Kind::Sell
    } else {
        Kind::Send
    };
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let src_owner = key_at(src, 32);
    let dst_owner = key_at(dst, 32);
    let src_after = u64_at(src, 64);
    let dst_after = u64_at(dst, 64);
    let (supply, decimals) = {
        let md = mint.try_borrow()?;
        let m = head::<MINT_LEN>(&md)?;
        (u64_at(m, 36), m[44])
    };
    let mut ctx = Ctx {
        kind,
        amount,
        supply,
        t: now.saturating_sub(launch_ts).max(0),
        slot: clock.slot,
        hour: (now.rem_euclid(86_400) / 3_600) as u32,
        quote_reserve: 0,
        threshold: u64_at(sd, S_THRESHOLD),
        sqrt_after: 0,
        sqrt_open: 0,
        src_before: src_after.saturating_add(amount),
        dst_after,
        is_creator: dst_owner == creator && clock.slot == launch_slot,
        is_creator_src: src_owner == creator,
        w: WalletView::default(),
        slot_buys: 0,
        creator_base: 0,
        blocked: false,
        has_pass: false,
        hour_sold: 0,
        gate_bal: 0,
    };
    // Hours since launch: the Hourly Outflow Cap's bucket.
    let hour_now = (ctx.t / 3_600) as u64;
    let mut rest = rest.iter_mut();

    // L1: the pool is read only after checking it still names this coin and its vault.
    if flags & F_POOL != 0 {
        let pool = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        if pool.address().as_array() != key_at(sd, S_POOL) || !pool.owned_by(&DBC_PROGRAM) {
            return Err(ProgramError::InvalidAccountData);
        }
        let pdb = pool.try_borrow()?;
        let pd = head::<POOL_MIN>(&pdb)?;
        if pd[..8] != DBC_HOOK_POOL_DISC || key_at(pd, POOL_BASE_MINT) != mint.address().as_array() || key_at(pd, POOL_BASE_VAULT) != base_vault {
            return Err(ProgramError::InvalidAccountData);
        }
        ctx.sqrt_after = u128::from_le_bytes(rd(pd, POOL_SQRT_PRICE));
        ctx.quote_reserve = u64_at(pd, POOL_QUOTE_RESERVE);
    }

    // Wallet records: the sender's is required unless it's the curve vault (buys); the
    // receiver's unless it's the curve vault (sells).
    let mut wallet_accts: Option<(&mut AccountView, &mut AccountView)> = None;
    let mut dst_rec: Option<WalletRec> = None;
    let mut src_rec: Option<WalletRec> = None;
    if flags & F_WALLETS != 0 {
        let ws = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let wd = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        if kind != Kind::Buy {
            src_rec = load_wallet(program_id, ws, mint.address(), source.address())?;
            match &src_rec {
                Some(r) => ctx.w = r.view(launch_ts),
                None => return Err(refuse(EngineError::MissingWalletRecord as u32)),
            }
        }
        if kind != Kind::Sell {
            dst_rec = load_wallet(program_id, wd, mint.address(), destination.address())?;
            if dst_rec.is_none() {
                return Err(refuse(EngineError::MissingWalletRecord as u32));
            }
        }
        wallet_accts = Some((ws, wd));
    }
    let script_ai = if flags & F_SCRIPT != 0 { Some(rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?) } else { None };
    let ix_sysvar = if flags & F_APP != 0 { Some(rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?) } else { None };

    // Marks (Blocklist, Allowlist Phase): the PDA ["mark", mint, owner] of the sender's and the receiver's
    // owner. Only set_mark creates accounts at these addresses, so one of ours is that owner's mark.
    if flags & F_MARKS != 0 {
        let mut marks = [0u8; 2];
        for m in marks.iter_mut() {
            let ai = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
            if ai.owned_by(program_id) {
                *m = ai.try_borrow()?.first().copied().unwrap_or(0);
            }
        }
        // The curve vault's side never counts: the source on buys, the destination on sells.
        ctx.blocked = (kind != Kind::Buy && marks[0] & MARK_BLOCKED != 0) || (kind != Kind::Sell && marks[1] & MARK_BLOCKED != 0);
        ctx.has_pass = marks[1] & MARK_PASS != 0;
    }
    // Token Gate: the receiver owner's associated token account of the gate mint (derived by Token-2022
    // from the meta list: gate mint, its token program, the ATA program, then the ATA). Missing = 0.
    if flags & F_GATE != 0 {
        let gate_mint = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let gate_ata = rest.nth(2).ok_or(ProgramError::NotEnoughAccountKeys)?;
        let gb = gate_ata.try_borrow()?;
        ctx.gate_bal = match gb.first_chunk::<72>() {
            Some(a) if key_at(a, 0) == gate_mint.address().as_array() && key_at(a, 32) == dst_owner => u64_at(a, 64),
            _ => 0,
        };
    }

    // Derived per-block inputs from slot state (each block appears at most once).
    let mut slots = [(0u16, [0u8; PARAMS], [0u8; STATE]); MAX_SLOTS];
    let mut window_now: i64 = 0;
    let mut hold_secs: Option<u32> = None;
    #[cfg_attr(not(feature = "hookscript"), allow(unused_assignments, unused_variables))]
    let mut fee_state = [0u8; STATE];
    for (s, c) in slots.iter_mut().zip(sd[S_SLOTS..S_SCRIPT].as_chunks::<SLOT_SIZE>().0).take(n) {
        s.0 = blocks::u16_at(c, 0);
        s.1 = rd(c, 2);
        s.2 = rd(c, 2 + PARAMS);
        match s.0 {
            blocks::ANTI_BUNDLE => ctx.slot_buys = bucket(&s.2, clock.slot),
            blocks::OUTFLOW_CAP => ctx.hour_sold = bucket(&s.2, hour_now),
            blocks::CIRCUIT_BREAKER => {
                let window_secs = blocks::u32_at(&s.1, 0).max(1) as i64;
                window_now = now.div_euclid(window_secs);
                ctx.sqrt_open = if i64_at(&s.2, 0) == window_now { u128::from_le_bytes(rd(&s.2, 8)) } else { last_sqrt };
            }
            blocks::HOLD_TIMER => hold_secs = Some(blocks::u32_at(&s.1, 0)),
            blocks::CREATOR_VEST => ctx.creator_base = if s.2[16] != 0 { u64_at(&s.2, 0) } else { 0 },
            blocks::CUSTOM => fee_state = s.2,
            _ => {}
        }
    }
    // Creator vesting: the creator's coins may only sit in accounts whose owner can't be changed
    // (ImmutableOwner, as every ATA), or SetAuthority would carry a vested bag out of reach.
    let creator_dst_mutable = kind != Kind::Sell && dst_owner == creator && !has_extension(&dstb, TOKEN_ACCOUNT_LEN, 2, EXT_IMMUTABLE_OWNER);
    let creator_buy = kind == Kind::Buy && dst_owner == creator;

    for (id, p, _) in slots.iter().take(n) {
        let refused = blocks::check(*id, p, &ctx) || (*id == blocks::CREATOR_VEST && creator_dst_mutable);
        if refused {
            return Err(refuse(blocks::code_of(*id)));
        }
    }

    if let Some(script) = script_ai {
        let env = ScriptEnv {
            decimals,
            now,
            launch_ts,
            launch_slot,
            creator: *creator,
            src_key: *src_owner,
            dst_key: *dst_owner,
            src_before: ctx.src_before,
            dst_before: dst_after.saturating_sub(amount),
            same_wallet: source.address() == destination.address(),
            app: match ix_sysvar {
                Some(ai) => top_level_program(ai)?,
                None => [0u8; 32],
            },
            fee_state,
            activation_point: u64_at(sd, S_ACTIVATION_POINT),
            slot: clock.slot,
        };
        let w = wallet_accts.as_mut().map(|(a, b)| (&mut **a, &mut **b));
        run_script(program_id, sd, script, &ctx, &env, w, src_rec.as_ref(), dst_rec.as_ref())?;
    }

    // ───── every check passed: write state ─────
    drop(srcb);
    drop(dstb);
    drop(sdb);
    if flags & F_STACK_WRITABLE != 0 {
        let mut sdm = stack_ai.try_borrow_mut()?;
        let sdm = head_mut::<STACK_SIZE>(&mut sdm)?;
        let mut breaker_traded = false;
        for ((id, _, st), c) in slots.iter().zip(sdm[S_SLOTS..S_SCRIPT].as_chunks_mut::<SLOT_SIZE>().0).take(n) {
            let ns: &mut [u8; STATE] = sub_mut(c, 2 + PARAMS);
            // Bucketed counters: Anti-Bundle counts buys per slot, the Outflow Cap sums sells per hour.
            let counter = match *id {
                blocks::ANTI_BUNDLE if kind == Kind::Buy => Some((clock.slot, 1)),
                blocks::OUTFLOW_CAP if kind == Kind::Sell => Some((hour_now, amount)),
                _ => None,
            };
            if let Some((key, add)) = counter {
                let v = bucket(st, key).saturating_add(add);
                *sub_mut(ns, 0) = key.to_le_bytes();
                *sub_mut(ns, 8) = v.to_le_bytes();
            }
            match *id {
                blocks::CIRCUIT_BREAKER if kind != Kind::Send => {
                    if i64_at(st, 0) != window_now {
                        *sub_mut(ns, 0) = window_now.to_le_bytes();
                        *sub_mut(ns, 8) = last_sqrt.to_le_bytes();
                    }
                    breaker_traded = true;
                }
                // The creator's launch bag: everything it buys in the slot of its first buy.
                blocks::CREATOR_VEST if creator_buy => {
                    if st[16] == 0 {
                        *sub_mut(ns, 0) = amount.to_le_bytes();
                        *sub_mut(ns, 8) = clock.slot.to_le_bytes();
                        ns[16] = 1;
                    } else if u64_at(st, 8) == clock.slot {
                        *sub_mut(ns, 0) = u64_at(st, 0).saturating_add(amount).to_le_bytes();
                    }
                }
                _ => {}
            }
        }
        if breaker_traded {
            *sub_mut(sdm, S_LAST_SQRT) = ctx.sqrt_after.to_le_bytes();
        }
    }
    if let Some((ws, wd)) = wallet_accts {
        let ep = blocks::lot_epoch(hold_secs);
        if dst_rec.is_some() {
            let taint = src_rec.as_ref().filter(|r| kind == Kind::Send && r.flags & WF_HAS_BUY != 0).map(|r| (r.last_buy_slot, r.last_buy_ts));
            note_receipt(head_mut(&mut wd.try_borrow_mut()?)?, ep, ctx.t, now, clock.slot, amount, kind == Kind::Buy, taint);
        }
        if src_rec.is_some() {
            note_outflow(head_mut(&mut ws.try_borrow_mut()?)?, ep, ctx.t, now, amount, kind == Kind::Sell);
        }
    }
    Ok(())
}

/// What the Hookscript Ctx needs beyond the blocks' Ctx.
#[allow(dead_code)]
struct ScriptEnv {
    decimals: u8,
    now: i64,
    launch_ts: i64,
    launch_slot: u64,
    creator: [u8; 32],
    src_key: [u8; 32],
    dst_key: [u8; 32],
    src_before: u64,
    dst_before: u64,
    same_wallet: bool,
    app: [u8; 32],
    /// The Custom slot's state: the DBC base-fee schedule copied at init (see LAYOUT.md).
    fee_state: [u8; STATE],
    activation_point: u64,
    slot: u64,
}

/// Program id of the top-level instruction being executed, from the instructions sysvar
/// (`u16 count · u16 offsets[count] · instructions… · u16 current index`).
fn top_level_program(ai: &AccountView) -> Result<[u8; 32], ProgramError> {
    const BAD: ProgramError = ProgramError::InvalidAccountData;
    if ai.address() != &INSTRUCTIONS_SYSVAR {
        return Err(BAD);
    }
    let d = ai.try_borrow()?;
    let u16_get = |at: usize| d.get(at..)?.first_chunk::<2>().map(|b| u16::from_le_bytes(*b) as usize);
    let count = u16_get(0).ok_or(BAD)?;
    let cur = d.len().checked_sub(2).and_then(u16_get).ok_or(BAD)?;
    if cur >= count {
        return Err(BAD);
    }
    let at = u16_get(2 + 2 * cur).ok_or(BAD)?;
    let n_accounts = u16_get(at).ok_or(BAD)?;
    d.get(at + 2 + n_accounts * 33..).and_then(|b| b.first_chunk::<32>()).copied().ok_or(BAD)
}

/// Hookscript: runs after every block passed; refuses with 6128.
#[cfg(not(feature = "hookscript"))]
#[allow(clippy::too_many_arguments)]
fn run_script(_program_id: &Pubkey, _sd: &[u8; STACK_SIZE], _script: &mut AccountView, _ctx: &Ctx, _env: &ScriptEnv, _w: Option<(&mut AccountView, &mut AccountView)>, _s: Option<&WalletRec>, _d: Option<&WalletRec>) -> ProgramResult {
    // Built without the VM: init_stack refuses scripted stacks, so this is unreachable; fail closed.
    Err(refuse(EngineError::CustomRuleRefused as u32))
}

/// The pool's current DBC base fee in bps, from the schedule init_stack copied out of the config.
#[cfg(feature = "hookscript")]
fn fee_bps(st: &[u8; STATE], activation_point: u64, slot: u64, now: i64) -> u16 {
    let current = if st[27] == 0 { slot } else { now.max(0) as u64 };
    blocks::dbc_base_fee_bps(u64_at(st, 0), u64_at(st, 8), u64_at(st, 16), blocks::u16_at(st, 24), st[26], current, activation_point)
}

#[cfg(feature = "hookscript")]
fn vm_wallet(key: [u8; 32], is_pool: bool, balance: u64, rec: Option<&WalletRec>, full: bool) -> hookscript_vm::WalletView {
    let mut w = hookscript_vm::WalletView { key, is_pool, balance, has_record: rec.is_some(), ..Default::default() };
    if let Some(r) = rec.filter(|_| full) {
        let lot = |l: &Lot| hookscript_vm::Lot { t: l.t.clamp(0, u32::MAX as i64) as u32, amount: l.amount };
        let (lin, n_in) = blocks::sorted_lots(&r.lots_in);
        let (lout, n_out) = blocks::sorted_lots(&r.lots_out);
        w.has_record = true;
        w.first_receipt_ts = if r.flags & WF_HAS_RECEIPT != 0 { r.first_receipt_ts } else { 0 };
        w.last_buy_slot = if r.flags & WF_HAS_BUY != 0 { r.last_buy_slot } else { 0 };
        w.last_buy_ts = if r.flags & WF_HAS_BUY != 0 { r.last_buy_ts } else { 0 };
        w.last_sell_ts = if r.flags & WF_HAS_SOLD != 0 { r.last_sell_ts } else { 0 };
        w.bought = r.bought;
        w.sold = r.sold;
        w.buys = r.buys;
        w.sells = r.sells;
        w.n_in = n_in;
        w.n_out = n_out;
        for i in 0..LOTS {
            w.lots_in[i] = lot(&lin[i]);
            w.lots_out[i] = lot(&lout[i]);
        }
    }
    w
}

#[cfg(feature = "hookscript")]
#[allow(clippy::too_many_arguments)]
fn run_script(
    program_id: &Pubkey,
    sd: &[u8; STACK_SIZE],
    script: &mut AccountView,
    ctx: &Ctx,
    env: &ScriptEnv,
    wallets: Option<(&mut AccountView, &mut AccountView)>,
    src_rec: Option<&WalletRec>,
    dst_rec: Option<&WalletRec>,
) -> ProgramResult {
    use hookscript_vm as vm;
    if !script.owned_by(program_id) || script.address().as_array() != key_at(sd, S_SCRIPT) {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut sdb = script.try_borrow_mut()?;
    let sdata = head_mut::<SCRIPT_SIZE>(&mut sdb)?;
    if sdata[..8] != SCRIPT_DISC || sdata[SC_VERSION] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    let len = (blocks::u16_at(sdata, SC_CODE_LEN) as usize).min(MAX_SCRIPT);
    let (hd, tail) = sdata.split_at_mut(SC_CODE);
    let code = &tail[..len];
    // Header (verified at init): flags say which Ctx parts the script reads; globals_len bounds the
    // globals it touches, so only those bytes are copied in and out of the VM.
    let hs_flags = code.get(3).copied().unwrap_or(0xff);
    let glen = code.get(10..).and_then(|b| b.first_chunk::<2>()).map(|b| u16::from_le_bytes(*b) as usize).unwrap_or(SCRIPT_GLOBALS).min(SCRIPT_GLOBALS);
    let globals = &mut hd[SC_GLOBALS..SC_GLOBALS + glen];
    let curve = hs_flags & vm::op::F_CURVE != 0;
    let wallets_full = hs_flags & (vm::op::F_SENDER | vm::op::F_RECEIVER) != 0;
    let vctx = vm::Ctx {
        kind: match ctx.kind {
            Kind::Buy => vm::KIND_BUY,
            Kind::Sell => vm::KIND_SELL,
            Kind::Send => vm::KIND_SEND,
        },
        amount: ctx.amount,
        decimals: env.decimals,
        supply: ctx.supply,
        slot: ctx.slot,
        now: env.now,
        launch_ts: env.launch_ts,
        launch_slot: env.launch_slot,
        price_e6: if curve { vm::price_e6_from_sqrt_q64(ctx.sqrt_after, env.decimals) } else { 0 },
        progress_ppm: if curve { blocks::progress_ppm(ctx.quote_reserve, ctx.threshold) } else { 0 },
        quote_reserve: ctx.quote_reserve,
        fee_bps: if curve { fee_bps(&env.fee_state, env.activation_point, env.slot, env.now) } else { 0 },
        creator: env.creator,
        app: env.app,
        same_wallet: env.same_wallet,
        sender: vm_wallet(env.src_key, ctx.kind == Kind::Buy, env.src_before, src_rec, wallets_full),
        receiver: vm_wallet(env.dst_key, ctx.kind == Kind::Sell, env.dst_before, dst_rec, wallets_full),
    };
    let mut empty_s: [u8; 0] = [];
    let mut empty_d: [u8; 0] = [];
    let (mut ws_data, mut wd_data) = (None, None);
    if let Some((ws, wd)) = wallets {
        if src_rec.is_some() {
            ws_data = Some(ws.try_borrow_mut()?);
        }
        if dst_rec.is_some() && !env.same_wallet {
            wd_data = Some(wd.try_borrow_mut()?);
        }
    }
    // Both records were length-checked by load_wallet.
    let wsrc: &mut [u8] = match ws_data.as_mut().and_then(|d| d.get_mut(W_SCRIPT_VARS..W_SCRIPT_VARS + 32)) {
        Some(v) => v,
        None => &mut empty_s,
    };
    let wdst: &mut [u8] = match wd_data.as_mut().and_then(|d| d.get_mut(W_SCRIPT_VARS..W_SCRIPT_VARS + 32)) {
        Some(v) => v,
        None => &mut empty_d,
    };
    match vm::run(code, &vctx, globals, wsrc, wdst) {
        Ok(vm::Verdict::Allow) => Ok(()),
        Ok(vm::Verdict::Refuse { reason_id, arg }) => {
            // The reason's template as stored in the script ("{}" unfilled), then the numbers:
            // 6128, reason id, arg (i64 as u64), the template's format kind. Off-chain code formats
            // the message with format_reason (TS) from these.
            let (fmt, text) = vm::reason(code, reason_id).unwrap_or((0, b"refused"));
            log_join("Hookscript: ", text);
            log_64(6128, reason_id as u64, arg as u64, fmt as u64, 0);
            Err(refuse(EngineError::CustomRuleRefused as u32))
        }
        Err(e) => {
            log_join("HookscriptFault: ", e.name().as_bytes());
            Err(refuse(EngineError::CustomRuleRefused as u32))
        }
    }
}

// ───────────────────────── Token-2022 account helpers ─────────────────────────
const EXT_IMMUTABLE_OWNER: u16 = 7;
const EXT_TRANSFER_HOOK: u16 = 14;
const EXT_TRANSFER_HOOK_ACCOUNT: u16 = 15;

/// A Token-2022 token account (base size 165, account type 2 when extended) holding `mint`.
fn token_account<'a>(d: &'a [u8], mint: &Pubkey) -> Option<&'a [u8; TOKEN_ACCOUNT_LEN]> {
    let a = d.first_chunk::<TOKEN_ACCOUNT_LEN>()?;
    (key_at(a, 0) == mint.as_array() && (d.len() == TOKEN_ACCOUNT_LEN || d.get(TOKEN_ACCOUNT_LEN) == Some(&2))).then_some(a)
}
/// TransferHookAccount (type 15) → `transferring` flag.
fn is_transferring(d: &[u8]) -> bool {
    tlv(d, TOKEN_ACCOUNT_LEN, 2, EXT_TRANSFER_HOOK_ACCOUNT).is_some_and(|v| v.first() == Some(&1))
}
fn has_extension(d: &[u8], account_type_at: usize, account_type: u8, ext: u16) -> bool {
    tlv(d, account_type_at, account_type, ext).is_some()
}
/// Mint TransferHook (type 14): (authority, program id).
fn mint_hook(d: &[u8]) -> Option<([u8; 32], [u8; 32])> {
    tlv(d, TOKEN_ACCOUNT_LEN, 1, EXT_TRANSFER_HOOK).and_then(|v| v.first_chunk::<64>()).map(|v| (rd(v, 0), rd(v, 32)))
}
fn tlv(d: &[u8], account_type_at: usize, account_type: u8, ext: u16) -> Option<&[u8]> {
    if d.get(account_type_at) != Some(&account_type) {
        return None;
    }
    let mut rest = d.get(account_type_at + 1..)?;
    while let Some((h, tail)) = rest.split_first_chunk::<4>() {
        let t = u16::from_le_bytes([h[0], h[1]]);
        let len = u16::from_le_bytes([h[2], h[3]]) as usize;
        let v = tail.get(..len)?;
        if t == ext {
            return Some(v);
        }
        if t == 0 {
            return None;
        }
        rest = tail.get(len..)?;
    }
    None
}

// ───────────────────────── init_stack (pool creator, once, in the launch) ─────────────────────────
/// Accounts: creator (signer, w), mint, DBC pool, DBC config, stack (w), extra-account-metas (w),
/// script (w), system program, [parent stack], [gate mint].
fn init_stack(program_id: &Pubkey, accounts: &mut [AccountView], args: &[u8]) -> ProgramResult {
    let [creator, mint, pool, config, stack_ai, meta_list, script_ai, system, more @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !creator.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.address() != &SYSTEM_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }

    // ── instruction data ──
    const BAD_DATA: ProgramError = ProgramError::InvalidInstructionData;
    let [n, data_flags, body @ ..] = args else {
        return Err(BAD_DATA);
    };
    let (n, data_flags) = (*n as usize, *data_flags);
    let staged = data_flags & 2 != 0;
    if !(1..=MAX_SLOTS).contains(&n) || data_flags & !3 != 0 {
        return Err(BAD_DATA);
    }
    let raw = body.as_chunks::<{ 2 + PARAMS }>().0;
    if raw.len() < n {
        return Err(BAD_DATA);
    }
    let mut slots = [(0u16, [0u8; PARAMS]); MAX_SLOTS];
    for (s, c) in slots.iter_mut().zip(raw).take(n) {
        s.0 = blocks::u16_at(c, 0);
        s.1 = rd(c, 2);
    }
    let (len_bytes, inline_script) = body.get(n * (2 + PARAMS)..).and_then(|b| b.split_first_chunk::<2>()).ok_or(BAD_DATA)?;
    let script_len = u16::from_le_bytes(*len_bytes) as usize;
    if inline_script.len() != script_len || script_len > MAX_SCRIPT || (staged && script_len != 0) {
        return Err(BAD_DATA);
    }
    // A script too big for the launch transaction is staged first with write_script (0xA4).
    let staged_ref = if staged {
        let d = script_ai.try_borrow()?;
        if !script_ai.owned_by(program_id) || !head::<SCRIPT_SIZE>(&d).is_ok_and(|a| a[..8] == SCRIPT_DISC && a[SC_VERSION] == 0) {
            log("No staged script");
            return Err(ProgramError::InvalidAccountData);
        }
        Some(d)
    } else {
        None
    };
    let script: &[u8] = match &staged_ref {
        Some(d) => {
            let a = head::<SCRIPT_SIZE>(d)?;
            let len = (blocks::u16_at(a, SC_CODE_LEN) as usize).min(MAX_SCRIPT);
            &a[SC_CODE..SC_CODE + len]
        }
        None => inline_script,
    };
    let script_len = script.len();

    let mut flags = F_ARMED;
    let mut has_custom = false;
    for (i, (id, p)) in slots.iter().take(n).enumerate() {
        if !blocks::known(*id) || !blocks::valid_params(*id, p) || slots.iter().take(i).any(|(o, _)| o == id) {
            log("A slot has an unknown block, bad params or a duplicate");
            log_64(i as u64, *id as u64, 0, 0, 0);
            return Err(BAD_DATA);
        }
        if blocks::needs_pool(*id) {
            flags |= F_POOL;
        }
        if blocks::needs_wallets(*id) {
            flags |= F_WALLETS;
        }
        if blocks::writes_stack(*id) {
            flags |= F_STACK_WRITABLE;
        }
        if blocks::needs_marks(*id) {
            flags |= F_MARKS;
        }
        if *id == blocks::TOKEN_GATE {
            flags |= F_GATE;
        }
        has_custom |= *id == blocks::CUSTOM;
    }
    if has_custom != (script_len > 0) {
        log("A Custom slot and a Hookscript go together");
        return Err(BAD_DATA);
    }
    #[cfg(not(feature = "hookscript"))]
    if has_custom {
        log("This build has no Hookscript VM");
        return Err(BAD_DATA);
    }
    #[cfg(feature = "hookscript")]
    if has_custom {
        if let Err(e) = hookscript_vm::verify(script) {
            log_join("Hookscript rejected by verify: ", e.name().as_bytes());
            return Err(refuse(EngineError::CustomRuleRefused as u32));
        }
        // A script reads the curve (price, progress) and both wallet records.
        flags |= F_SCRIPT | F_POOL | F_WALLETS;
        if script.get(3).is_some_and(|f| f & HS_FLAG_APP != 0) {
            flags |= F_APP;
        }
    }

    // ── the mint must name this program as its hook, with the DBC pool authority as hook authority ──
    if !mint.owned_by(&TOKEN_2022) {
        return Err(ProgramError::IllegalOwner);
    }
    match mint_hook(&mint.try_borrow()?) {
        Some((authority, program)) if program == program_id.to_bytes() && authority == DBC_POOL_AUTHORITY.to_bytes() => {}
        _ => {
            log("The mint's TransferHook must name hookrz_engine with the DBC pool authority");
            return Err(ProgramError::InvalidAccountData);
        }
    }
    // ── the pool: the DBC hooked curve of this mint, created by the signer ──
    if !pool.owned_by(&DBC_PROGRAM) || !config.owned_by(&DBC_PROGRAM) {
        return Err(ProgramError::IllegalOwner);
    }
    let (base_vault, sqrt, activation_point) = {
        let db = pool.try_borrow()?;
        let d = head::<POOL_MIN_INIT>(&db)?;
        if d[..8] != DBC_HOOK_POOL_DISC || key_at(d, POOL_BASE_MINT) != mint.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        // Only the pool's creator can arm its stack (no front-running a launch with other rules).
        if key_at(d, POOL_CREATOR) != creator.address().as_array() {
            log("Only the pool creator can write the stack");
            return Err(ProgramError::InvalidAccountData);
        }
        if key_at(d, POOL_CONFIG) != config.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        (*key_at(d, POOL_BASE_VAULT), u128::from_le_bytes(rd(d, POOL_SQRT_PRICE)), u64_at(d, POOL_ACTIVATION_POINT))
    };
    let (threshold, fee_schedule) = {
        let db = config.try_borrow()?;
        let d = head::<CONFIG_MIN>(&db)?;
        if d[..8] != DBC_HOOK_CONFIG_DISC && d[..8] != DBC_CONFIG_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        // Custom slot state: the base-fee schedule for Hookscript's fee read (immutable in the config).
        let mut f = [0u8; STATE];
        f[..27].copy_from_slice(&d[CONFIG_BASE_FEE..CONFIG_BASE_FEE + 27]);
        f[27] = d[CONFIG_ACTIVATION_TYPE];
        f[28] = d[CONFIG_DYNAMIC_FEE_ON];
        (u64_at(d, CONFIG_MIGRATION_QUOTE_THRESHOLD), f)
    };
    if threshold == 0 {
        return Err(ProgramError::InvalidAccountData);
    }
    // ── the parent stack (a remix), if any ──
    let mut more = more.iter();
    let parent = if data_flags & 1 != 0 {
        let p = more.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let db = p.try_borrow()?;
        let d = head::<STACK_SIZE>(&db)?;
        if !p.owned_by(program_id) || d[..8] != STACK_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        Some((*p.address(), *key_at(d, S_CREATOR)))
    } else {
        None
    };
    // ── Token Gate: another token's mint (SPL Token or Token-2022), passed after the parent ──
    let gate = if flags & F_GATE != 0 {
        let g = more.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let token_program = if g.owned_by(&TOKEN_2022) { TOKEN_2022 } else { SPL_TOKEN };
        let ok = g.owned_by(&token_program) && g.address() != mint.address() && head::<MINT_LEN>(&g.try_borrow()?).is_ok_and(|m| m[45] == 1);
        if !ok {
            log("The gate must be another token's mint");
            return Err(ProgramError::InvalidAccountData);
        }
        Some((*g.address(), token_program))
    } else {
        None
    };

    // ── PDAs ──
    let (stack_key, stack_bump) = find_pda(&[STACK_SEED, mint.address().as_ref()], program_id);
    let (meta_key, meta_bump) = find_pda(&[EXTRA_METAS_SEED, mint.address().as_ref()], program_id);
    let (script_key, script_bump) = find_pda(&[SCRIPT_SEED, mint.address().as_ref()], program_id);
    if stack_ai.address() != &stack_key || meta_list.address() != &meta_key || script_ai.address() != &script_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if stack_ai.owned_by(program_id) || meta_list.owned_by(program_id) || (script_ai.owned_by(program_id) && !staged) {
        return Err(refuse(EngineError::StackLocked as u32));
    }
    drop(staged_ref);

    // ── ExtraAccountMetaList (account indexes: 0 source, 1 mint, 2 destination, 3 authority, 4 this list, 5.. the metas) ──
    let mut metas = [[0u8; META_SIZE]; MAX_METAS];
    let mut m = 0usize;
    let mut push = |m: &mut usize, x: [u8; META_SIZE]| {
        if let Some(s) = metas.get_mut(*m) {
            *s = x;
            *m += 1;
        }
    };
    push(&mut m, meta(1, &[1, 5, b's', b't', b'a', b'c', b'k', 3, 1], flags & F_STACK_WRITABLE != 0));
    if flags & F_POOL != 0 {
        push(&mut m, fixed_meta(pool.address(), false));
    }
    if flags & F_WALLETS != 0 {
        push(&mut m, meta(1, &[1, 1, b'w', 3, 1, 3, 0], true));
        push(&mut m, meta(1, &[1, 1, b'w', 3, 1, 3, 2], true));
    }
    if flags & F_SCRIPT != 0 {
        push(&mut m, fixed_meta(&script_key, true));
    }
    if flags & F_APP != 0 {
        push(&mut m, fixed_meta(&INSTRUCTIONS_SYSVAR, false));
    }
    // Marks: ["mark", mint, owner] with the owner read from the token account's data (offset 32).
    if flags & F_MARKS != 0 {
        push(&mut m, meta(1, &[1, 4, b'm', b'a', b'r', b'k', 3, 1, 4, 0, 32, 32], false));
        push(&mut m, meta(1, &[1, 4, b'm', b'a', b'r', b'k', 3, 1, 4, 2, 32, 32], false));
    }
    if let Some((g, token_program)) = &gate {
        // The receiver owner's ATA: a PDA of the ATA program (discriminator 128 + its index) with seeds
        // [destination owner, gate token program, gate mint].
        let gi = (5 + m) as u8;
        push(&mut m, fixed_meta(g, false));
        push(&mut m, fixed_meta(token_program, false));
        push(&mut m, fixed_meta(&ATA_PROGRAM, false));
        push(&mut m, meta(128 + gi + 2, &[4, 2, 32, 32, 3, gi + 1, 3, gi], false));
    }
    create_pda(creator, meta_list, 16 + META_SIZE * m, program_id, &[EXTRA_METAS_SEED, mint.address().as_ref(), &[meta_bump]])?;
    {
        let mut db = meta_list.try_borrow_mut()?;
        let (h, list) = db.split_first_chunk_mut::<16>().ok_or(ProgramError::InvalidAccountData)?;
        h[..8].copy_from_slice(&EXECUTE_DISCRIMINATOR);
        h[8..12].copy_from_slice(&((4 + META_SIZE * m) as u32).to_le_bytes());
        h[12..].copy_from_slice(&(m as u32).to_le_bytes());
        for (d, s) in list.as_chunks_mut::<META_SIZE>().0.iter_mut().zip(metas.iter().take(m)) {
            *d = *s;
        }
    }

    // ── Script ──
    if staged {
        // Seal the staged script: version 1 makes it immutable and live.
        head_mut::<SCRIPT_SIZE>(&mut script_ai.try_borrow_mut()?)?[SC_VERSION] = 1;
    } else if flags & F_SCRIPT != 0 {
        create_pda(creator, script_ai, SCRIPT_SIZE, program_id, &[SCRIPT_SEED, mint.address().as_ref(), &[script_bump]])?;
        let mut db = script_ai.try_borrow_mut()?;
        let d = head_mut::<SCRIPT_SIZE>(&mut db)?;
        d[..8].copy_from_slice(&SCRIPT_DISC);
        d[SC_VERSION] = 1;
        d[SC_BUMP] = script_bump;
        d[SC_CODE_LEN..SC_CODE_LEN + 2].copy_from_slice(&(script_len as u16).to_le_bytes());
        for (a, b) in d[SC_CODE..].iter_mut().zip(inline_script) {
            *a = *b;
        }
    }

    // ── Stack ──
    let clock = Clock::get()?;
    create_pda(creator, stack_ai, STACK_SIZE, program_id, &[STACK_SEED, mint.address().as_ref(), &[stack_bump]])?;
    let mut db = stack_ai.try_borrow_mut()?;
    let d = head_mut::<STACK_SIZE>(&mut db)?;
    d[..8].copy_from_slice(&STACK_DISC);
    d[S_VERSION] = 1;
    d[S_BUMP] = stack_bump;
    d[S_FLAGS..S_FLAGS + 2].copy_from_slice(&flags.to_le_bytes());
    d[S_SLOT_COUNT] = n as u8;
    d[13] = meta_bump;
    d[14] = script_bump;
    *sub_mut(d, S_MINT) = mint.address().to_bytes();
    *sub_mut(d, S_CREATOR) = creator.address().to_bytes();
    *sub_mut(d, S_POOL) = pool.address().to_bytes();
    *sub_mut(d, S_BASE_VAULT) = base_vault;
    if let Some((pk, author)) = parent {
        *sub_mut(d, S_PARENT_STACK) = pk.to_bytes();
        *sub_mut(d, S_PARENT_AUTHOR) = author;
    }
    *sub_mut(d, S_LAUNCH_SLOT) = clock.slot.to_le_bytes();
    *sub_mut(d, S_LAUNCH_TS) = clock.unix_timestamp.to_le_bytes();
    if flags & F_SCRIPT != 0 {
        *sub_mut(d, S_SCRIPT) = script_key.to_bytes();
    }
    *sub_mut(d, S_LAST_SQRT) = sqrt.to_le_bytes();
    *sub_mut(d, S_THRESHOLD) = threshold.to_le_bytes();
    *sub_mut(d, S_ACTIVATION_POINT) = activation_point.to_le_bytes();
    for (c, (id, p)) in d[S_SLOTS..S_SCRIPT].as_chunks_mut::<SLOT_SIZE>().0.iter_mut().zip(&slots).take(n) {
        *sub_mut(c, 0) = id.to_le_bytes();
        *sub_mut(c, 2) = *p;
        let st: &mut [u8; STATE] = sub_mut(c, 2 + PARAMS);
        match *id {
            // No window yet: the first trade opens one at the launch price.
            blocks::CIRCUIT_BREAKER => *sub_mut(st, 0) = i64::MIN.to_le_bytes(),
            blocks::CUSTOM => *st = fee_schedule,
            // The gate mint, for readers (Execute gets the mint from the meta list).
            blocks::TOKEN_GATE => *st = gate.map(|g| g.0.to_bytes()).unwrap_or_default(),
            _ => {}
        }
    }
    log("hookrz stack armed (slots, flags)");
    log_64(n as u64, flags as u64, 0, 0, 0);
    Ok(())
}

// ───────────────────────── write_script (pool creator, before init_stack) ─────────────────────────
/// Stage a Hookscript too big for the launch transaction, in chunks. Accounts: creator (signer, w),
/// mint, DBC pool, stack (PDA, must not exist yet), script (w, PDA), system program.
/// Data: total_len u16 · offset u16 · bytes. The staged script (version 0) is never run; init_stack
/// with data flag bit 1 verifies and seals it (version 1), after which it can't change.
fn write_script(program_id: &Pubkey, accounts: &mut [AccountView], args: &[u8]) -> ProgramResult {
    let [creator, mint, pool, stack_ai, script_ai, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !creator.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.address() != &SYSTEM_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }
    let Some((hdr, bytes)) = args.split_first_chunk::<4>() else {
        return Err(ProgramError::InvalidInstructionData);
    };
    let total = u16::from_le_bytes([hdr[0], hdr[1]]) as usize;
    let offset = u16::from_le_bytes([hdr[2], hdr[3]]) as usize;
    if !(1..=MAX_SCRIPT).contains(&total) || offset + bytes.len() > total {
        return Err(ProgramError::InvalidInstructionData);
    }
    if !mint.owned_by(&TOKEN_2022) || !pool.owned_by(&DBC_PROGRAM) {
        return Err(ProgramError::IllegalOwner);
    }
    if !matches!(mint_hook(&mint.try_borrow()?), Some((_, p)) if p == program_id.to_bytes()) {
        return Err(ProgramError::InvalidAccountData);
    }
    {
        let db = pool.try_borrow()?;
        let d = head::<POOL_MIN>(&db)?;
        if d[..8] != DBC_HOOK_POOL_DISC || key_at(d, POOL_BASE_MINT) != mint.address().as_array() || key_at(d, POOL_CREATOR) != creator.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
    }
    let (stack_key, _) = find_pda(&[STACK_SEED, mint.address().as_ref()], program_id);
    let (script_key, script_bump) = find_pda(&[SCRIPT_SEED, mint.address().as_ref()], program_id);
    if stack_ai.address() != &stack_key || script_ai.address() != &script_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if stack_ai.owned_by(program_id) {
        return Err(refuse(EngineError::StackLocked as u32));
    }
    if !script_ai.owned_by(program_id) {
        create_pda(creator, script_ai, SCRIPT_SIZE, program_id, &[SCRIPT_SEED, mint.address().as_ref(), &[script_bump]])?;
        let mut db = script_ai.try_borrow_mut()?;
        let d = head_mut::<SCRIPT_SIZE>(&mut db)?;
        d[..8].copy_from_slice(&SCRIPT_DISC);
        d[SC_VERSION] = 0;
        d[SC_BUMP] = script_bump;
    }
    let mut db = script_ai.try_borrow_mut()?;
    let d = match head_mut::<SCRIPT_SIZE>(&mut db) {
        Ok(d) if d[..8] == SCRIPT_DISC && d[SC_VERSION] == 0 => d,
        _ => return Err(refuse(EngineError::StackLocked as u32)),
    };
    d[SC_CODE_LEN..SC_CODE_LEN + 2].copy_from_slice(&(total as u16).to_le_bytes());
    d.get_mut(SC_CODE + offset..SC_CODE + offset + bytes.len()).ok_or(ProgramError::InvalidInstructionData)?.copy_from_slice(bytes);
    Ok(())
}

// ───────────────────────── set_mark (creator; Blocklist marks and Allowlist passes) ─────────────────────────
/// Set the mark of one owner: bit 1 = blocked (Blocklist), bit 2 = pass (Allowlist Phase). Each bit
/// needs its block in the stack. The blocked bit can change only while the list is open: in the
/// launch slot, or until `lock` seconds after launch (Blocklist param; u32::MAX = while the hook is
/// live, i.e. until graduation); after that → 6143. Passes can be granted at any time.
/// Accounts: creator (signer, w; the Stack's creator), mint, stack, mark (w, PDA ["mark", mint, owner]),
/// system program. Data: flags u8 · owner [32]. The creator pays the mark's rent (65 bytes).
fn set_mark(program_id: &Pubkey, accounts: &mut [AccountView], args: &[u8]) -> ProgramResult {
    let [creator, mint, stack_ai, mark, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !creator.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.address() != &SYSTEM_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }
    let Some((&flags, owner)) = args.split_first() else {
        return Err(ProgramError::InvalidInstructionData);
    };
    let owner: &[u8; 32] = owner.try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    if !stack_ai.owned_by(program_id) {
        return Err(ProgramError::InvalidAccountData);
    }
    let (allowed, open) = {
        let db = stack_ai.try_borrow()?;
        let sd = head::<STACK_SIZE>(&db)?;
        if sd[..8] != STACK_DISC || key_at(sd, S_MINT) != mint.address().as_array() || key_at(sd, S_CREATOR) != creator.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        let clock = Clock::get()?;
        let t = clock.unix_timestamp.saturating_sub(i64_at(sd, S_LAUNCH_TS));
        let (mut allowed, mut open) = (0u8, clock.slot == u64_at(sd, S_LAUNCH_SLOT));
        // Unused slots are zero (block id 0).
        for c in sd[S_SLOTS..S_SCRIPT].as_chunks::<SLOT_SIZE>().0 {
            match blocks::u16_at(c, 0) {
                blocks::BLOCKLIST => {
                    allowed |= MARK_BLOCKED;
                    open |= t < blocks::u32_at(c, 2) as i64;
                }
                blocks::ALLOWLIST => allowed |= MARK_PASS,
                _ => {}
            }
        }
        (allowed, open)
    };
    if flags & !allowed != 0 {
        log("The stack has no block for this mark");
        return Err(ProgramError::InvalidInstructionData);
    }
    let (key, bump) = find_pda(&[MARK_SEED, mint.address().as_ref(), owner], program_id);
    if mark.address() != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if !mark.owned_by(program_id) {
        create_pda(creator, mark, MARK_SIZE, program_id, &[MARK_SEED, mint.address().as_ref(), owner, &[bump]])?;
        let mut db = mark.try_borrow_mut()?;
        let d = head_mut::<MARK_SIZE>(&mut db)?;
        *sub_mut(d, M_MINT) = mint.address().to_bytes();
        *sub_mut(d, M_OWNER) = *owner;
    }
    let mut db = mark.try_borrow_mut()?;
    let d = head_mut::<MARK_SIZE>(&mut db)?;
    if (d[0] ^ flags) & MARK_BLOCKED != 0 && !open {
        log("The blocklist is frozen");
        return Err(refuse(EngineError::StackLocked as u32));
    }
    d[0] = flags;
    Ok(())
}

// ───────────────────────── open_wallet (anyone; idempotent; prepended to hookrz buys) ─────────────────────────
/// Accounts: payer (signer, w), mint, token account, wallet record (w), system program.
fn open_wallet(program_id: &Pubkey, accounts: &mut [AccountView]) -> ProgramResult {
    let [payer, mint, token_account, wallet, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.address() != &SYSTEM_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }
    if !token_account.owned_by(&TOKEN_2022) || !mint.owned_by(&TOKEN_2022) || self::token_account(&token_account.try_borrow()?, mint.address()).is_none() {
        return Err(ProgramError::InvalidAccountData);
    }
    let (key, bump) = find_pda(&[WALLET_SEED, mint.address().as_ref(), token_account.address().as_ref()], program_id);
    if wallet.address() != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if wallet.owned_by(program_id) {
        return Ok(());
    }
    create_pda(payer, wallet, WALLET_SIZE, program_id, &[WALLET_SEED, mint.address().as_ref(), token_account.address().as_ref(), &[bump]])?;
    let mut db = wallet.try_borrow_mut()?;
    let d = head_mut::<WALLET_SIZE>(&mut db)?;
    d[..8].copy_from_slice(&WALLET_DISC);
    d[W_VERSION] = 1;
    d[W_BUMP] = bump;
    *sub_mut(d, W_MINT) = mint.address().to_bytes();
    *sub_mut(d, W_TOKEN_ACCOUNT) = token_account.address().to_bytes();
    *sub_mut(d, W_PAYER) = payer.address().to_bytes();
    Ok(())
}

// ───────────────────────── close (after the hook is retired; anyone may crank) ─────────────────────────
/// Retired = the mint still has its TransferHook extension (extensions can't be removed) but it
/// no longer names this program. Anything else is live (S1: liveness comes from the mint).
fn hook_retired(program_id: &Pubkey, mint: &AccountView) -> ProgramResult {
    if !mint.owned_by(&TOKEN_2022) {
        return Err(ProgramError::IllegalOwner);
    }
    match mint_hook(&mint.try_borrow()?) {
        Some((_, p)) if p != program_id.to_bytes() => Ok(()),
        _ => {
            log("The hook is live until the curve graduates");
            Err(refuse(EngineError::HookLive as u32))
        }
    }
}
/// Move all lamports to `recipient`, then zero the account (data length, lamports and owner = System).
fn close_into(target: &mut AccountView, recipient: &mut AccountView) -> ProgramResult {
    let lamports = target.lamports();
    recipient.set_lamports(recipient.lamports().checked_add(lamports).ok_or(ProgramError::ArithmeticOverflow)?);
    target.set_lamports(0);
    target.close()
}
/// Accounts: wallet record (w), mint, rent payer recorded at open (w).
fn close_wallet(program_id: &Pubkey, accounts: &mut [AccountView]) -> ProgramResult {
    let [wallet, mint, recipient] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !wallet.owned_by(program_id) {
        return Err(ProgramError::IllegalOwner);
    }
    {
        let db = wallet.try_borrow()?;
        let d = head::<WALLET_SIZE>(&db)?;
        if d[..8] != WALLET_DISC || key_at(d, W_MINT) != mint.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        if key_at(d, W_PAYER) != recipient.address().as_array() {
            log("Rent goes back to the payer that opened the record");
            return Err(ProgramError::InvalidAccountData);
        }
    }
    hook_retired(program_id, mint)?;
    close_into(wallet, recipient)
}
/// Accounts: stack (w), extra-account-metas (w), script (w), mint, pool creator (w).
fn close_stack(program_id: &Pubkey, accounts: &mut [AccountView]) -> ProgramResult {
    let [stack_ai, meta_list, script_ai, mint, recipient] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !stack_ai.owned_by(program_id) {
        return Err(ProgramError::IllegalOwner);
    }
    let has_script = {
        let db = stack_ai.try_borrow()?;
        let d = head::<STACK_SIZE>(&db)?;
        if d[..8] != STACK_DISC || key_at(d, S_MINT) != mint.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        // S2: rent goes to the creator recorded on-chain at init.
        if key_at(d, S_CREATOR) != recipient.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        let flags = blocks::u16_at(d, S_FLAGS);
        if flags & F_SCRIPT != 0 && key_at(d, S_SCRIPT) != script_ai.address().as_array() {
            return Err(ProgramError::InvalidAccountData);
        }
        flags & F_SCRIPT != 0
    };
    let (meta_key, _) = find_pda(&[EXTRA_METAS_SEED, mint.address().as_ref()], program_id);
    if meta_list.address() != &meta_key {
        return Err(ProgramError::InvalidSeeds);
    }
    hook_retired(program_id, mint)?;
    if meta_list.owned_by(program_id) {
        close_into(meta_list, recipient)?;
    }
    if has_script && script_ai.owned_by(program_id) {
        close_into(script_ai, recipient)?;
    }
    close_into(stack_ai, recipient)
}

// ───────────────────────── helpers ─────────────────────────
/// Create a PDA; M1: a pre-funded address is topped up, then allocated and assigned.
/// `seeds` (≤ 4, bump included) sign for the PDA.
fn create_pda(payer: &AccountView, target: &AccountView, size: usize, owner: &Address, seeds: &[&[u8]]) -> ProgramResult {
    let rent = Rent::get()?.try_minimum_balance(size)?;
    let n = seeds.len().min(4);
    let seed = |i: usize| CpiSeed::from(if i < n { seeds[i] } else { &[][..] });
    let all = [seed(0), seed(1), seed(2), seed(3)];
    let signer = [Signer::from(&all[..n])];
    if target.lamports() == 0 {
        return CreateAccount { from: payer, to: target, lamports: rent, space: size as u64, owner }.invoke_signed(&signer);
    }
    let need = rent.saturating_sub(target.lamports());
    if need > 0 {
        Transfer { from: payer, to: target, lamports: need }.invoke()?;
    }
    Allocate { account: target, space: size as u64 }.invoke_signed(&signer)?;
    Assign { account: target, owner }.invoke_signed(&signer)
}

/// One spl-tlv-account-resolution ExtraAccountMeta: discriminator (0 fixed address, 1 PDA of this
/// program, 128 + i PDA of the program at account index i), 32-byte address config, signer, writable.
/// PDA seeds are packed: literal [1, len, bytes], account key [3, index], account data [4, index, offset, len].
fn meta(disc: u8, config: &[u8], writable: bool) -> [u8; META_SIZE] {
    let mut m = [0u8; META_SIZE];
    m[0] = disc;
    for (a, b) in m[1..33].iter_mut().zip(config) {
        *a = *b;
    }
    m[34] = writable as u8;
    m
}
/// Discriminator 0: a fixed address.
fn fixed_meta(key: &Pubkey, writable: bool) -> [u8; META_SIZE] {
    meta(0, key.as_ref(), writable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_offsets_add_up() {
        assert_eq!(S_SLOTS + MAX_SLOTS * SLOT_SIZE, S_SCRIPT);
        assert_eq!(S_THRESHOLD + 8 + 12, STACK_SIZE);
        assert_eq!(S_ACTIVATION_POINT + 8 + 4, STACK_SIZE);
        assert_eq!(W_LOTS_IN + LOTS * 12, W_MINT);
        assert_eq!(W_SCRIPT_VARS + 32, W_LAST_BUY_TS);
        assert_eq!(W_LOTS_OUT + LOTS * 12 + 4, WALLET_SIZE);
        assert_eq!(M_OWNER + 32, MARK_SIZE);
    }
    #[test]
    fn token_accounts_must_hold_this_mint() {
        let mint = Address::new_from_array([7u8; 32]);
        let mut d = vec![0u8; 170];
        d[..32].copy_from_slice(mint.as_ref());
        d[165] = 2;
        assert!(token_account(&d, &mint).is_some());
        assert!(token_account(&d, &Address::new_from_array([8u8; 32])).is_none());
        d[165] = 1; // a mint, not an account
        assert!(token_account(&d, &mint).is_none());
        assert!(token_account(&d[..100], &mint).is_none());
    }
    #[test]
    fn metas_encode_seeds() {
        let m = meta(1, &[1, 1, b'w', 3, 1, 3, 2], true);
        assert_eq!(&m[..8], &[1, 1, 1, b'w', 3, 1, 3, 2]);
        assert_eq!(m[34], 1);
        let f = fixed_meta(&ATA_PROGRAM, false);
        assert_eq!(f[0], 0);
        assert_eq!(&f[1..33], ATA_PROGRAM.as_ref());
        assert_eq!(f[34], 0);
    }
    #[test]
    fn error_lines_name_every_code() {
        assert_eq!(ERROR_NAMES.split(|&c| c == b' ').count(), 23);
        for code in (6000..=6018).chain([6128, 6141, 6142, 6143]) {
            let want = format!("Error Code: {}. Error Number: {code}", blocks::name_of(code));
            assert_eq!(error_line(code, &mut [0u8; 64]), want);
        }
        assert_eq!(error_line(6100, &mut [0u8; 64]), "Error Code: . Error Number: 6100");
    }
    #[test]
    fn tlv_walks_extensions() {
        let mut d = vec![0u8; 165];
        d.push(2); // account type: token account
        d.extend_from_slice(&[7, 0, 0, 0]); // ImmutableOwner, empty
        d.extend_from_slice(&[15, 0, 1, 0, 1]); // TransferHookAccount { transferring: true }
        assert!(has_extension(&d, 165, 2, EXT_IMMUTABLE_OWNER));
        assert!(is_transferring(&d));
        d.truncate(d.len() - 1); // a truncated entry is not read
        assert!(!is_transferring(&d));
    }
}
