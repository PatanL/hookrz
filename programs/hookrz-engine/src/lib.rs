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
//! instruction. Hardening carried over from away-rules (docs/HOUSE-RULES.md in away-tek):
//! C1 (forged CPI: source and destination must be accounts of this mint, source transferring, no
//! CPIs), H1 (hold-timer lots never extend earlier lots), M1 (pre-funded PDAs), L1 (pool layout
//! checks beside the discriminator), L2 (close paths only after the hook is retired), S1/S2
//! (liveness from the mint's hook; rent to the on-chain creator / payer).
//!
//! Account layouts and instruction data: see LAYOUT.md.

#![allow(deprecated)]

pub mod blocks;

use blocks::{Ctx, Kind, Lot, WalletView, LOTS, MAX_SLOTS, PARAMS, STATE};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

// The local-fork address, for off-chain callers and tests only. The program itself never reads `ID`:
// every owner and PDA check uses the `program_id` the runtime passes to the entrypoint, so one build
// works at any deployed address (fork, devnet, mainnet). The fork suite runs a second time at a random
// address to prove it (`ENGINE_ID=… npm test`).
solana_program::declare_id!("EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr");

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const DBC_PROGRAM: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
pub const DBC_POOL_AUTHORITY: Pubkey = pubkey!("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
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
// In a DBC config (PoolConfig, also the prefix of ConfigWithTransferHook).
const CONFIG_BASE_FEE: usize = 104; // cliff_fee_numerator u64 · second u64 · third u64 · first u16 · mode u8
const CONFIG_DYNAMIC_FEE_ON: usize = 136;
const CONFIG_ACTIVATION_TYPE: usize = 234;
const CONFIG_MIGRATION_QUOTE_THRESHOLD: usize = 264;

pub const IX_INIT_STACK: u8 = 0xA0;
pub const IX_OPEN_WALLET: u8 = 0xA1;
pub const IX_CLOSE_WALLET: u8 = 0xA2;
pub const IX_CLOSE_STACK: u8 = 0xA3;
pub const IX_WRITE_SCRIPT: u8 = 0xA4;

pub const STACK_SEED: &[u8] = b"stack";
pub const WALLET_SEED: &[u8] = b"w";
pub const SCRIPT_SEED: &[u8] = b"script";
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
pub const INSTRUCTIONS_SYSVAR: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");

const META_SIZE: usize = 35;

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
fn refuse(code: u32) -> ProgramError {
    msg!("Error Code: {}. Error Number: {}", blocks::name_of(code), code);
    ProgramError::Custom(code)
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() >= 16 && data[..8] == EXECUTE_DISCRIMINATOR {
        let amount = u64::from_le_bytes(rd(data, 8));
        return execute(program_id, accounts, amount);
    }
    match data.first() {
        Some(&IX_INIT_STACK) => init_stack(program_id, accounts, &data[1..]),
        Some(&IX_OPEN_WALLET) => open_wallet(program_id, accounts),
        Some(&IX_CLOSE_WALLET) => close_wallet(program_id, accounts),
        Some(&IX_CLOSE_STACK) => close_stack(program_id, accounts),
        Some(&IX_WRITE_SCRIPT) => write_script(program_id, accounts, &data[1..]),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn rd<const N: usize>(d: &[u8], at: usize) -> [u8; N] {
    d[at..at + N].try_into().unwrap()
}
fn u64_at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(rd(d, at))
}
fn i64_at(d: &[u8], at: usize) -> i64 {
    i64::from_le_bytes(rd(d, at))
}
fn key_at(d: &[u8], at: usize) -> &[u8] {
    &d[at..at + 32]
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
fn read_lots(d: &[u8], at: usize) -> [Lot; LOTS] {
    let mut lots = [Lot::default(); LOTS];
    for (i, l) in lots.iter_mut().enumerate() {
        let at = at + i * 12;
        l.t = u32::from_le_bytes(rd(d, at)) as i64;
        l.amount = u64_at(d, at + 4);
    }
    lots
}
fn write_lots(d: &mut [u8], at: usize, count_at: usize, lots: &[Lot; LOTS]) {
    for (i, l) in lots.iter().enumerate() {
        let at = at + i * 12;
        d[at..at + 4].copy_from_slice(&(l.t.clamp(0, u32::MAX as i64) as u32).to_le_bytes());
        d[at + 4..at + 12].copy_from_slice(&l.amount.to_le_bytes());
    }
    d[count_at] = lots.iter().filter(|l| l.amount > 0).count() as u8;
}
fn add_u64(d: &mut [u8], at: usize, v: u64) {
    let x = u64_at(d, at).saturating_add(v);
    d[at..at + 8].copy_from_slice(&x.to_le_bytes());
}
fn inc_u32(d: &mut [u8], at: usize) {
    let x = u32::from_le_bytes(rd(d, at)).saturating_add(1);
    d[at..at + 4].copy_from_slice(&x.to_le_bytes());
}
/// The receiver's record after a receipt (read-modify-write on the account data itself).
/// `taint`: on a send from a wallet that has bought, the receiver inherits the sender's last buy
/// (slot, time) if it is later than its own, so buy → send → sell can't dodge Sandwich Guard.
fn note_receipt(d: &mut [u8], ep: (i64, i64), t: i64, now: i64, slot: u64, amount: u64, buy: bool, taint: Option<(u64, i64)>) {
    let mut lots = read_lots(d, W_LOTS_IN);
    blocks::add_lot(&mut lots, ep, t, amount);
    write_lots(d, W_LOTS_IN, W_LOT_COUNT, &lots);
    if d[W_FLAGS] & WF_HAS_RECEIPT == 0 {
        d[W_FLAGS] |= WF_HAS_RECEIPT;
        d[W_FIRST_RECEIPT_TS..W_FIRST_RECEIPT_TS + 8].copy_from_slice(&now.to_le_bytes());
    }
    if buy {
        d[W_FLAGS] |= WF_HAS_BUY;
        d[W_LAST_BUY_SLOT..W_LAST_BUY_SLOT + 8].copy_from_slice(&slot.to_le_bytes());
        d[W_LAST_BUY_TS..W_LAST_BUY_TS + 8].copy_from_slice(&now.to_le_bytes());
        add_u64(d, W_BOUGHT, amount);
        inc_u32(d, W_BUYS);
    } else if let Some((src_slot, src_ts)) = taint {
        let had = d[W_FLAGS] & WF_HAS_BUY != 0;
        if !had || src_slot > u64_at(d, W_LAST_BUY_SLOT) {
            d[W_LAST_BUY_SLOT..W_LAST_BUY_SLOT + 8].copy_from_slice(&src_slot.to_le_bytes());
        }
        if !had || src_ts > i64_at(d, W_LAST_BUY_TS) {
            d[W_LAST_BUY_TS..W_LAST_BUY_TS + 8].copy_from_slice(&src_ts.to_le_bytes());
        }
        d[W_FLAGS] |= WF_HAS_BUY;
    }
}
/// The sender's record after an outflow.
fn note_outflow(d: &mut [u8], ep: (i64, i64), t: i64, now: i64, amount: u64, sell: bool) {
    let mut lots = read_lots(d, W_LOTS_OUT);
    blocks::add_lot(&mut lots, ep, t, amount);
    write_lots(d, W_LOTS_OUT, W_N_OUT, &lots);
    if sell {
        d[W_FLAGS] |= WF_HAS_SOLD;
        d[W_LAST_SELL_TS..W_LAST_SELL_TS + 8].copy_from_slice(&now.to_le_bytes());
        add_u64(d, W_SOLD, amount);
        inc_u32(d, W_SELLS);
    }
}

/// The wallet record for `token_account`, if this account is one. A record of ours that names a
/// different mint or token account is a forged account list and fails the transfer.
fn load_wallet(program_id: &Pubkey, ai: &AccountInfo, mint: &Pubkey, token_account: &Pubkey) -> Result<Option<WalletRec>, ProgramError> {
    if ai.owner != program_id {
        return Ok(None);
    }
    let d = ai.try_borrow_data()?;
    if d.len() < WALLET_SIZE
        || d[..8] != WALLET_DISC
        || d[W_VERSION] != 1
        || key_at(&d, W_MINT) != mint.as_ref()
        || key_at(&d, W_TOKEN_ACCOUNT) != token_account.as_ref()
    {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(Some(WalletRec {
        flags: d[W_FLAGS],
        first_receipt_ts: i64_at(&d, W_FIRST_RECEIPT_TS),
        last_buy_slot: u64_at(&d, W_LAST_BUY_SLOT),
        last_buy_ts: i64_at(&d, W_LAST_BUY_TS),
        last_sell_ts: i64_at(&d, W_LAST_SELL_TS),
        bought: u64_at(&d, W_BOUGHT),
        sold: u64_at(&d, W_SOLD),
        buys: u32::from_le_bytes(rd(&d, W_BUYS)),
        sells: u32::from_le_bytes(rd(&d, W_SELLS)),
        lots_in: read_lots(&d, W_LOTS_IN),
        lots_out: read_lots(&d, W_LOTS_OUT),
    }))
}

fn execute(program_id: &Pubkey, accounts: &[AccountInfo], amount: u64) -> ProgramResult {
    let [source, mint, destination, _authority, _meta_list, stack_ai, rest @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    // C1: only a live Token-2022 transfer *of this mint* may drive this handler. The source carries
    // TransferHookAccount.transferring = true for the duration of the hook call, and both sides
    // must be accounts of `mint`. This program makes no CPIs, so an account of `mint` can only be
    // transferring inside a genuine transfer of `mint`, whose hook is this program.
    if source.owner != &TOKEN_2022 || mint.owner != &TOKEN_2022 || destination.owner != &TOKEN_2022 {
        return Err(EngineError::NotInTransfer.into());
    }
    let src = source.try_borrow_data()?;
    let dst = destination.try_borrow_data()?;
    if !token_account_of(&src, mint.key) || !token_account_of(&dst, mint.key) || !is_transferring(&src) {
        return Err(EngineError::NotInTransfer.into());
    }

    // The Stack: ours, and for this mint. (Only init_stack creates Stack accounts, at the mint's PDA.)
    if stack_ai.owner != program_id {
        return Err(ProgramError::InvalidAccountData);
    }
    let sd = stack_ai.try_borrow_data()?;
    if sd.len() < STACK_SIZE || sd[..8] != STACK_DISC || sd[S_VERSION] != 1 || key_at(&sd, S_MINT) != mint.key.as_ref() {
        return Err(ProgramError::InvalidAccountData);
    }
    let flags = u16::from_le_bytes(rd(&sd, S_FLAGS));
    let n = (sd[S_SLOT_COUNT] as usize).min(MAX_SLOTS);
    let base_vault = key_at(&sd, S_BASE_VAULT);
    let creator = key_at(&sd, S_CREATOR);
    let launch_slot = u64_at(&sd, S_LAUNCH_SLOT);
    let launch_ts = i64_at(&sd, S_LAUNCH_TS);
    let last_sqrt = u128::from_le_bytes(rd(&sd, S_LAST_SQRT));

    let kind = if source.key.as_ref() == base_vault {
        Kind::Buy
    } else if destination.key.as_ref() == base_vault {
        Kind::Sell
    } else {
        Kind::Send
    };
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let src_owner = key_at(&src, 32);
    let dst_owner = key_at(&dst, 32);
    let src_after = u64_at(&src, 64);
    let dst_after = u64_at(&dst, 64);
    let (supply, decimals) = {
        let md = mint.try_borrow_data()?;
        if md.len() < 82 {
            return Err(ProgramError::InvalidAccountData);
        }
        (u64_at(&md, 36), md[44])
    };
    let mut ctx = Ctx {
        kind,
        amount,
        supply,
        t: now.saturating_sub(launch_ts).max(0),
        slot: clock.slot,
        hour: (now.rem_euclid(86_400) / 3_600) as u32,
        quote_reserve: 0,
        threshold: u64_at(&sd, S_THRESHOLD),
        sqrt_after: 0,
        sqrt_open: 0,
        src_before: src_after.saturating_add(amount),
        dst_after,
        is_creator: dst_owner == creator && clock.slot == launch_slot,
        is_creator_src: src_owner == creator,
        w: WalletView::default(),
        slot_buys: 0,
        creator_base: 0,
    };
    let mut rest = rest.iter();

    // L1: the pool is read only after checking it still names this coin and its vault.
    if flags & F_POOL != 0 {
        let pool = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        if pool.key.as_ref() != key_at(&sd, S_POOL) || pool.owner != &DBC_PROGRAM {
            return Err(ProgramError::InvalidAccountData);
        }
        let pd = pool.try_borrow_data()?;
        if pd.len() < POOL_SQRT_PRICE + 16
            || pd[..8] != DBC_HOOK_POOL_DISC
            || key_at(&pd, POOL_BASE_MINT) != mint.key.as_ref()
            || key_at(&pd, POOL_BASE_VAULT) != base_vault
        {
            return Err(ProgramError::InvalidAccountData);
        }
        ctx.sqrt_after = u128::from_le_bytes(rd(&pd, POOL_SQRT_PRICE));
        ctx.quote_reserve = u64_at(&pd, POOL_QUOTE_RESERVE);
    }

    // Wallet records: the sender's is required unless it's the curve vault (buys); the
    // receiver's unless it's the curve vault (sells).
    let mut wallet_accts: Option<(&AccountInfo, &AccountInfo)> = None;
    let mut dst_rec: Option<WalletRec> = None;
    let mut src_rec: Option<WalletRec> = None;
    if flags & F_WALLETS != 0 {
        let ws = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let wd = rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
        if kind != Kind::Buy {
            src_rec = load_wallet(program_id, ws, mint.key, source.key)?;
            match &src_rec {
                Some(r) => ctx.w = r.view(launch_ts),
                None => return Err(refuse(EngineError::MissingWalletRecord as u32)),
            }
        }
        if kind != Kind::Sell {
            dst_rec = load_wallet(program_id, wd, mint.key, destination.key)?;
            if dst_rec.is_none() {
                return Err(refuse(EngineError::MissingWalletRecord as u32));
            }
        }
        wallet_accts = Some((ws, wd));
    }
    let script_ai = if flags & F_SCRIPT != 0 { Some(rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?) } else { None };
    let ix_sysvar = if flags & F_APP != 0 { Some(rest.next().ok_or(ProgramError::NotEnoughAccountKeys)?) } else { None };

    // Derived per-block inputs from slot state (each block appears at most once).
    let mut slots = [(0u16, [0u8; PARAMS], [0u8; STATE]); MAX_SLOTS];
    let mut window_now: i64 = 0;
    let mut hold_secs: Option<u32> = None;
    #[cfg_attr(not(feature = "hookscript"), allow(unused_assignments, unused_variables))]
    let mut fee_state = [0u8; STATE];
    for (i, s) in slots.iter_mut().enumerate().take(n) {
        let at = S_SLOTS + i * SLOT_SIZE;
        s.0 = u16::from_le_bytes(rd(&sd, at));
        s.1 = rd(&sd, at + 2);
        s.2 = rd(&sd, at + 2 + PARAMS);
        match s.0 {
            blocks::ANTI_BUNDLE => {
                ctx.slot_buys = if u64_at(&s.2, 0) == clock.slot { u64_at(&s.2, 8) } else { 0 };
            }
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
    let creator_dst_mutable = kind != Kind::Sell && dst_owner == creator && !has_extension(&dst, 165, 2, EXT_IMMUTABLE_OWNER);
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
            creator: rd(creator, 0),
            src_key: rd(src_owner, 0),
            dst_key: rd(dst_owner, 0),
            src_before: ctx.src_before,
            dst_before: dst_after.saturating_sub(amount),
            same_wallet: source.key == destination.key,
            app: match ix_sysvar {
                Some(ai) => top_level_program(ai)?,
                None => [0u8; 32],
            },
            fee_state,
            activation_point: u64_at(&sd, S_ACTIVATION_POINT),
            slot: clock.slot,
        };
        run_script(program_id, &sd, script, &ctx, &env, wallet_accts, src_rec.as_ref(), dst_rec.as_ref())?;
    }

    // ───── every check passed: write state ─────
    drop(src);
    drop(dst);
    drop(sd);
    if flags & F_STACK_WRITABLE != 0 {
        let mut sd = stack_ai.try_borrow_mut_data()?;
        for (i, (id, _, st)) in slots.iter().enumerate().take(n) {
            let at = S_SLOTS + i * SLOT_SIZE + 2 + PARAMS;
            match *id {
                blocks::ANTI_BUNDLE if kind == Kind::Buy => {
                    let count = if u64_at(st, 0) == clock.slot { u64_at(st, 8).saturating_add(1) } else { 1 };
                    sd[at..at + 8].copy_from_slice(&clock.slot.to_le_bytes());
                    sd[at + 8..at + 16].copy_from_slice(&count.to_le_bytes());
                }
                blocks::CIRCUIT_BREAKER if kind != Kind::Send => {
                    if i64_at(st, 0) != window_now {
                        sd[at..at + 8].copy_from_slice(&window_now.to_le_bytes());
                        sd[at + 8..at + 24].copy_from_slice(&last_sqrt.to_le_bytes());
                    }
                    sd[S_LAST_SQRT..S_LAST_SQRT + 16].copy_from_slice(&ctx.sqrt_after.to_le_bytes());
                }
                // The creator's launch bag: everything it buys in the slot of its first buy.
                blocks::CREATOR_VEST if creator_buy => {
                    if st[16] == 0 {
                        sd[at..at + 8].copy_from_slice(&amount.to_le_bytes());
                        sd[at + 8..at + 16].copy_from_slice(&clock.slot.to_le_bytes());
                        sd[at + 16] = 1;
                    } else if u64_at(st, 8) == clock.slot {
                        sd[at..at + 8].copy_from_slice(&u64_at(st, 0).saturating_add(amount).to_le_bytes());
                    }
                }
                _ => {}
            }
        }
    }
    if let Some((ws, wd)) = wallet_accts {
        let ep = blocks::lot_epoch(hold_secs);
        if dst_rec.is_some() {
            let taint = src_rec.as_ref().filter(|r| kind == Kind::Send && r.flags & WF_HAS_BUY != 0).map(|r| (r.last_buy_slot, r.last_buy_ts));
            note_receipt(&mut wd.try_borrow_mut_data()?, ep, ctx.t, now, clock.slot, amount, kind == Kind::Buy, taint);
        }
        if src_rec.is_some() {
            note_outflow(&mut ws.try_borrow_mut_data()?, ep, ctx.t, now, amount, kind == Kind::Sell);
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
fn top_level_program(ai: &AccountInfo) -> Result<[u8; 32], ProgramError> {
    if ai.key != &INSTRUCTIONS_SYSVAR {
        return Err(ProgramError::InvalidAccountData);
    }
    let d = ai.try_borrow_data()?;
    let bad = ProgramError::InvalidAccountData;
    if d.len() < 4 {
        return Err(bad);
    }
    let count = u16::from_le_bytes([d[0], d[1]]) as usize;
    let cur = u16::from_le_bytes([d[d.len() - 2], d[d.len() - 1]]) as usize;
    if cur >= count || d.len() < 2 + 2 * count {
        return Err(bad);
    }
    let at = u16::from_le_bytes([d[2 + 2 * cur], d[3 + 2 * cur]]) as usize;
    let n_accounts = d.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).ok_or(ProgramError::InvalidAccountData)?;
    let p = at + 2 + n_accounts * 33;
    d.get(p..p + 32).map(|b| rd(b, 0)).ok_or(bad)
}

/// Hookscript: runs after every block passed; refuses with 6128.
#[cfg(not(feature = "hookscript"))]
fn run_script(_program_id: &Pubkey, _sd: &[u8], _script: &AccountInfo, _ctx: &Ctx, _env: &ScriptEnv, _w: Option<(&AccountInfo, &AccountInfo)>, _s: Option<&WalletRec>, _d: Option<&WalletRec>) -> ProgramResult {
    // Built without the VM: init_stack refuses scripted stacks, so this is unreachable; fail closed.
    Err(refuse(EngineError::CustomRuleRefused as u32))
}

/// The pool's current DBC base fee in bps, from the schedule init_stack copied out of the config.
#[cfg(feature = "hookscript")]
fn fee_bps(st: &[u8; STATE], activation_point: u64, slot: u64, now: i64) -> u16 {
    let current = if st[27] == 0 { slot } else { now.max(0) as u64 };
    blocks::dbc_base_fee_bps(u64_at(st, 0), u64_at(st, 8), u64_at(st, 16), u16::from_le_bytes([st[24], st[25]]), st[26], current, activation_point)
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
    sd: &[u8],
    script: &AccountInfo,
    ctx: &Ctx,
    env: &ScriptEnv,
    wallets: Option<(&AccountInfo, &AccountInfo)>,
    src_rec: Option<&WalletRec>,
    dst_rec: Option<&WalletRec>,
) -> ProgramResult {
    use hookscript_vm as vm;
    if script.owner != program_id || script.key.as_ref() != key_at(sd, S_SCRIPT) {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut sdata = script.try_borrow_mut_data()?;
    if sdata.len() < SCRIPT_SIZE || sdata[..8] != SCRIPT_DISC || sdata[SC_VERSION] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    let len = (u16::from_le_bytes([sdata[SC_CODE_LEN], sdata[SC_CODE_LEN + 1]]) as usize).min(MAX_SCRIPT);
    let (head, tail) = sdata.split_at_mut(SC_CODE);
    let code = &tail[..len];
    // Header (verified at init): flags say which Ctx parts the script reads; globals_len bounds the
    // globals it touches, so only those bytes are copied in and out of the VM.
    let hs_flags = code.get(3).copied().unwrap_or(0xff);
    let glen = code.get(10..12).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).unwrap_or(SCRIPT_GLOBALS).min(SCRIPT_GLOBALS);
    let globals = &mut head[SC_GLOBALS..SC_GLOBALS + glen];
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
        progress_ppm: if !curve || ctx.threshold == 0 { 0 } else { ((ctx.quote_reserve as u128) * 1_000_000 / ctx.threshold as u128).min(1_000_000) as u32 },
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
            ws_data = Some(ws.try_borrow_mut_data()?);
        }
        if dst_rec.is_some() && !env.same_wallet {
            wd_data = Some(wd.try_borrow_mut_data()?);
        }
    }
    let wsrc: &mut [u8] = match ws_data.as_mut() {
        Some(d) => &mut d[W_SCRIPT_VARS..W_SCRIPT_VARS + 32],
        None => &mut empty_s,
    };
    let wdst: &mut [u8] = match wd_data.as_mut() {
        Some(d) => &mut d[W_SCRIPT_VARS..W_SCRIPT_VARS + 32],
        None => &mut empty_d,
    };
    match vm::run(code, &vctx, globals, wsrc, wdst) {
        Ok(vm::Verdict::Allow) => Ok(()),
        Ok(vm::Verdict::Refuse { reason_id, arg }) => {
            let mut buf = [0u8; 160];
            let n = vm::format_reason(code, reason_id, arg, &mut buf).min(buf.len());
            msg!("Hookscript: {}", core::str::from_utf8(&buf[..n]).unwrap_or("refused"));
            Err(refuse(EngineError::CustomRuleRefused as u32))
        }
        Err(e) => {
            msg!("HookscriptFault: {}", e.name());
            Err(refuse(EngineError::CustomRuleRefused as u32))
        }
    }
}

// ───────────────────────── Token-2022 account helpers ─────────────────────────
const EXT_IMMUTABLE_OWNER: u16 = 7;
const EXT_TRANSFER_HOOK: u16 = 14;
const EXT_TRANSFER_HOOK_ACCOUNT: u16 = 15;

/// A Token-2022 token account (base size 165, account type 2 when extended) holding `mint`.
fn token_account_of(d: &[u8], mint: &Pubkey) -> bool {
    d.len() >= 165 && d[..32] == mint.to_bytes() && (d.len() == 165 || d[165] == 2)
}
/// TransferHookAccount (type 15) → `transferring` flag.
fn is_transferring(d: &[u8]) -> bool {
    tlv(d, 165, 2, EXT_TRANSFER_HOOK_ACCOUNT).map(|v| v.first() == Some(&1)).unwrap_or(false)
}
fn has_extension(d: &[u8], account_type_at: usize, account_type: u8, ext: u16) -> bool {
    tlv(d, account_type_at, account_type, ext).is_some()
}
/// Mint TransferHook (type 14): (authority, program id).
fn mint_hook(d: &[u8]) -> Option<([u8; 32], [u8; 32])> {
    tlv(d, 165, 1, EXT_TRANSFER_HOOK).filter(|v| v.len() >= 64).map(|v| (rd(v, 0), rd(v, 32)))
}
fn tlv(d: &[u8], account_type_at: usize, account_type: u8, ext: u16) -> Option<&[u8]> {
    if d.len() <= account_type_at || d[account_type_at] != account_type {
        return None;
    }
    let mut i = account_type_at + 1;
    while i + 4 <= d.len() {
        let t = u16::from_le_bytes([d[i], d[i + 1]]);
        let len = u16::from_le_bytes([d[i + 2], d[i + 3]]) as usize;
        let start = i + 4;
        if start + len > d.len() {
            return None;
        }
        if t == ext {
            return Some(&d[start..start + len]);
        }
        if t == 0 {
            return None;
        }
        i = start + len;
    }
    None
}

// ───────────────────────── init_stack (pool creator, once, in the launch) ─────────────────────────
/// Accounts: creator (signer, w), mint, DBC pool, DBC config, stack (w), extra-account-metas (w),
/// script (w), system program, [parent stack].
fn init_stack(program_id: &Pubkey, accounts: &[AccountInfo], args: &[u8]) -> ProgramResult {
    let [creator, mint, pool, config, stack_ai, meta_list, script_ai, system, more @ ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !creator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // ── instruction data ──
    if args.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let n = args[0] as usize;
    let data_flags = args[1];
    let staged = data_flags & 2 != 0;
    if !(1..=MAX_SLOTS).contains(&n) || data_flags & !3 != 0 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut at = 2;
    let mut slots = [(0u16, [0u8; PARAMS]); MAX_SLOTS];
    for s in slots.iter_mut().take(n) {
        if args.len() < at + 2 + PARAMS {
            return Err(ProgramError::InvalidInstructionData);
        }
        s.0 = u16::from_le_bytes(rd(args, at));
        s.1 = rd(args, at + 2);
        at += 2 + PARAMS;
    }
    if args.len() < at + 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let script_len = u16::from_le_bytes(rd(args, at)) as usize;
    at += 2;
    if args.len() != at + script_len || script_len > MAX_SCRIPT || (staged && script_len != 0) {
        return Err(ProgramError::InvalidInstructionData);
    }
    let inline_script = &args[at..];
    // A script too big for the launch transaction is staged first with write_script (0xA4).
    let staged_ref = if staged {
        let d = script_ai.try_borrow_data()?;
        if script_ai.owner != program_id || d.len() < SCRIPT_SIZE || d[..8] != SCRIPT_DISC || d[SC_VERSION] != 0 {
            msg!("No staged script");
            return Err(ProgramError::InvalidAccountData);
        }
        Some(d)
    } else {
        None
    };
    let script: &[u8] = match &staged_ref {
        Some(d) => {
            let len = (u16::from_le_bytes([d[SC_CODE_LEN], d[SC_CODE_LEN + 1]]) as usize).min(MAX_SCRIPT);
            &d[SC_CODE..SC_CODE + len]
        }
        None => inline_script,
    };
    let script_len = script.len();

    let mut flags = F_ARMED;
    let mut has_custom = false;
    for (i, (id, p)) in slots.iter().take(n).enumerate() {
        if !blocks::known(*id) || !blocks::valid_params(*id, p) || slots[..i].iter().any(|(o, _)| o == id) {
            msg!("Slot {}: unknown block, bad params or a duplicate", i);
            return Err(ProgramError::InvalidInstructionData);
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
        has_custom |= *id == blocks::CUSTOM;
    }
    if has_custom != (script_len > 0) {
        msg!("A Custom slot and a Hookscript go together");
        return Err(ProgramError::InvalidInstructionData);
    }
    #[cfg(not(feature = "hookscript"))]
    if has_custom {
        msg!("This build has no Hookscript VM");
        return Err(ProgramError::InvalidInstructionData);
    }
    #[cfg(feature = "hookscript")]
    if has_custom {
        #[cfg(feature = "hookscript")]
        if let Err(e) = hookscript_vm::verify(script) {
            msg!("Hookscript rejected by verify: {}", e.name());
            return Err(refuse(EngineError::CustomRuleRefused as u32));
        }
        // A script reads the curve (price, progress) and both wallet records.
        flags |= F_SCRIPT | F_POOL | F_WALLETS;
        if script.get(3).is_some_and(|f| f & HS_FLAG_APP != 0) {
            flags |= F_APP;
        }
    }

    // ── the mint must name this program as its hook, with the DBC pool authority as hook authority ──
    if mint.owner != &TOKEN_2022 {
        return Err(ProgramError::IllegalOwner);
    }
    match mint_hook(&mint.try_borrow_data()?) {
        Some((authority, program)) if program == program_id.to_bytes() && authority == DBC_POOL_AUTHORITY.to_bytes() => {}
        _ => {
            msg!("The mint's TransferHook must name hookrz_engine with the DBC pool authority");
            return Err(ProgramError::InvalidAccountData);
        }
    }
    // ── the pool: the DBC hooked curve of this mint, created by the signer ──
    if pool.owner != &DBC_PROGRAM || config.owner != &DBC_PROGRAM {
        return Err(ProgramError::IllegalOwner);
    }
    let (base_vault, sqrt) = {
        let d = pool.try_borrow_data()?;
        if d.len() < POOL_SQRT_PRICE + 16 || d[..8] != DBC_HOOK_POOL_DISC || key_at(&d, POOL_BASE_MINT) != mint.key.as_ref() {
            return Err(ProgramError::InvalidAccountData);
        }
        // Only the pool's creator can arm its stack (no front-running a launch with other rules).
        if key_at(&d, POOL_CREATOR) != creator.key.as_ref() {
            msg!("Only the pool creator can write the stack");
            return Err(ProgramError::InvalidAccountData);
        }
        if key_at(&d, POOL_CONFIG) != config.key.as_ref() {
            return Err(ProgramError::InvalidAccountData);
        }
        (Pubkey::new_from_array(rd(&d, POOL_BASE_VAULT)), u128::from_le_bytes(rd(&d, POOL_SQRT_PRICE)))
    };
    let (threshold, fee_schedule) = {
        let d = config.try_borrow_data()?;
        if d.len() < CONFIG_MIGRATION_QUOTE_THRESHOLD + 8 || (d[..8] != DBC_HOOK_CONFIG_DISC && d[..8] != DBC_CONFIG_DISC) {
            return Err(ProgramError::InvalidAccountData);
        }
        // Custom slot state: the base-fee schedule for Hookscript's fee read (immutable in the config).
        let mut f = [0u8; STATE];
        f[..27].copy_from_slice(&d[CONFIG_BASE_FEE..CONFIG_BASE_FEE + 27]);
        f[27] = d[CONFIG_ACTIVATION_TYPE];
        f[28] = d[CONFIG_DYNAMIC_FEE_ON];
        (u64_at(&d, CONFIG_MIGRATION_QUOTE_THRESHOLD), f)
    };
    let activation_point = u64_at(&pool.try_borrow_data()?, POOL_ACTIVATION_POINT);
    if threshold == 0 {
        return Err(ProgramError::InvalidAccountData);
    }
    // ── the parent stack (a remix), if any ──
    let parent = if data_flags & 1 != 0 {
        let p = more.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let d = p.try_borrow_data()?;
        if p.owner != program_id || d.len() < STACK_SIZE || d[..8] != STACK_DISC {
            return Err(ProgramError::InvalidAccountData);
        }
        Some((*p.key, Pubkey::new_from_array(rd(&d, S_CREATOR))))
    } else {
        None
    };

    // ── PDAs ──
    let (stack_key, stack_bump) = Pubkey::find_program_address(&[STACK_SEED, mint.key.as_ref()], program_id);
    let (meta_key, meta_bump) = Pubkey::find_program_address(&[EXTRA_METAS_SEED, mint.key.as_ref()], program_id);
    let (script_key, script_bump) = Pubkey::find_program_address(&[SCRIPT_SEED, mint.key.as_ref()], program_id);
    if stack_ai.key != &stack_key || meta_list.key != &meta_key || script_ai.key != &script_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if stack_ai.owner == program_id || meta_list.owner == program_id || (script_ai.owner == program_id && !staged) {
        return Err(refuse(EngineError::StackLocked as u32));
    }
    drop(staged_ref);

    // ── ExtraAccountMetaList (indexes: 0 source, 1 mint, 2 destination, 3 authority, 4 this list) ──
    let mut metas: [[u8; META_SIZE]; 6] = [[0; META_SIZE]; 6];
    let mut m = 0;
    metas[m] = pda_meta(&[Seed::Literal(STACK_SEED), Seed::Key(1)], flags & F_STACK_WRITABLE != 0);
    m += 1;
    if flags & F_POOL != 0 {
        metas[m] = fixed_meta(pool.key, false);
        m += 1;
    }
    if flags & F_WALLETS != 0 {
        metas[m] = pda_meta(&[Seed::Literal(WALLET_SEED), Seed::Key(1), Seed::Key(0)], true);
        metas[m + 1] = pda_meta(&[Seed::Literal(WALLET_SEED), Seed::Key(1), Seed::Key(2)], true);
        m += 2;
    }
    if flags & F_SCRIPT != 0 {
        metas[m] = fixed_meta(&script_key, true);
        m += 1;
    }
    if flags & F_APP != 0 {
        metas[m] = fixed_meta(&INSTRUCTIONS_SYSVAR, false);
        m += 1;
    }
    let meta_len = 8 + 4 + 4 + META_SIZE * m;
    create_pda(creator, meta_list, system, meta_len, program_id, &[EXTRA_METAS_SEED, mint.key.as_ref(), &[meta_bump]])?;
    {
        let mut d = meta_list.try_borrow_mut_data()?;
        d[..8].copy_from_slice(&EXECUTE_DISCRIMINATOR);
        d[8..12].copy_from_slice(&((4 + META_SIZE * m) as u32).to_le_bytes());
        d[12..16].copy_from_slice(&(m as u32).to_le_bytes());
        for (i, meta) in metas.iter().take(m).enumerate() {
            d[16 + i * META_SIZE..16 + (i + 1) * META_SIZE].copy_from_slice(meta);
        }
    }

    // ── Script ──
    if staged {
        // Seal the staged script: version 1 makes it immutable and live.
        script_ai.try_borrow_mut_data()?[SC_VERSION] = 1;
    } else if flags & F_SCRIPT != 0 {
        create_pda(creator, script_ai, system, SCRIPT_SIZE, program_id, &[SCRIPT_SEED, mint.key.as_ref(), &[script_bump]])?;
        let mut d = script_ai.try_borrow_mut_data()?;
        d[..8].copy_from_slice(&SCRIPT_DISC);
        d[SC_VERSION] = 1;
        d[SC_BUMP] = script_bump;
        d[SC_CODE_LEN..SC_CODE_LEN + 2].copy_from_slice(&(script_len as u16).to_le_bytes());
        d[SC_CODE..SC_CODE + script_len].copy_from_slice(inline_script);
    }

    // ── Stack ──
    let clock = Clock::get()?;
    create_pda(creator, stack_ai, system, STACK_SIZE, program_id, &[STACK_SEED, mint.key.as_ref(), &[stack_bump]])?;
    let mut d = stack_ai.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&STACK_DISC);
    d[S_VERSION] = 1;
    d[S_BUMP] = stack_bump;
    d[S_FLAGS..S_FLAGS + 2].copy_from_slice(&flags.to_le_bytes());
    d[S_SLOT_COUNT] = n as u8;
    d[13] = meta_bump;
    d[14] = script_bump;
    d[S_MINT..S_MINT + 32].copy_from_slice(mint.key.as_ref());
    d[S_CREATOR..S_CREATOR + 32].copy_from_slice(creator.key.as_ref());
    d[S_POOL..S_POOL + 32].copy_from_slice(pool.key.as_ref());
    d[S_BASE_VAULT..S_BASE_VAULT + 32].copy_from_slice(base_vault.as_ref());
    if let Some((pk, author)) = parent {
        d[S_PARENT_STACK..S_PARENT_STACK + 32].copy_from_slice(pk.as_ref());
        d[S_PARENT_AUTHOR..S_PARENT_AUTHOR + 32].copy_from_slice(author.as_ref());
    }
    d[S_LAUNCH_SLOT..S_LAUNCH_SLOT + 8].copy_from_slice(&clock.slot.to_le_bytes());
    d[S_LAUNCH_TS..S_LAUNCH_TS + 8].copy_from_slice(&clock.unix_timestamp.to_le_bytes());
    for (i, (id, p)) in slots.iter().take(n).enumerate() {
        let at = S_SLOTS + i * SLOT_SIZE;
        d[at..at + 2].copy_from_slice(&id.to_le_bytes());
        d[at + 2..at + 2 + PARAMS].copy_from_slice(p);
        if *id == blocks::CIRCUIT_BREAKER {
            // No window yet: the first trade opens one at the launch price.
            d[at + 2 + PARAMS..at + 2 + PARAMS + 8].copy_from_slice(&i64::MIN.to_le_bytes());
        }
        if *id == blocks::CUSTOM {
            d[at + 2 + PARAMS..at + 2 + PARAMS + STATE].copy_from_slice(&fee_schedule);
        }
    }
    if flags & F_SCRIPT != 0 {
        d[S_SCRIPT..S_SCRIPT + 32].copy_from_slice(script_key.as_ref());
    }
    d[S_LAST_SQRT..S_LAST_SQRT + 16].copy_from_slice(&sqrt.to_le_bytes());
    d[S_THRESHOLD..S_THRESHOLD + 8].copy_from_slice(&threshold.to_le_bytes());
    d[S_ACTIVATION_POINT..S_ACTIVATION_POINT + 8].copy_from_slice(&activation_point.to_le_bytes());
    msg!("hookrz stack armed: {} slots, flags {}", n, flags);
    Ok(())
}

// ───────────────────────── write_script (pool creator, before init_stack) ─────────────────────────
/// Stage a Hookscript too big for the launch transaction, in chunks. Accounts: creator (signer, w),
/// mint, DBC pool, stack (PDA, must not exist yet), script (w, PDA), system program.
/// Data: total_len u16 · offset u16 · bytes. The staged script (version 0) is never run; init_stack
/// with data flag bit 1 verifies and seals it (version 1), after which it can't change.
fn write_script(program_id: &Pubkey, accounts: &[AccountInfo], args: &[u8]) -> ProgramResult {
    let [creator, mint, pool, stack_ai, script_ai, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !creator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if args.len() < 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let total = u16::from_le_bytes([args[0], args[1]]) as usize;
    let offset = u16::from_le_bytes([args[2], args[3]]) as usize;
    let bytes = &args[4..];
    if !(1..=MAX_SCRIPT).contains(&total) || offset + bytes.len() > total {
        return Err(ProgramError::InvalidInstructionData);
    }
    if mint.owner != &TOKEN_2022 || pool.owner != &DBC_PROGRAM {
        return Err(ProgramError::IllegalOwner);
    }
    if !matches!(mint_hook(&mint.try_borrow_data()?), Some((_, p)) if p == program_id.to_bytes()) {
        return Err(ProgramError::InvalidAccountData);
    }
    {
        let d = pool.try_borrow_data()?;
        if d.len() < POOL_SQRT_PRICE + 16
            || d[..8] != DBC_HOOK_POOL_DISC
            || key_at(&d, POOL_BASE_MINT) != mint.key.as_ref()
            || key_at(&d, POOL_CREATOR) != creator.key.as_ref()
        {
            return Err(ProgramError::InvalidAccountData);
        }
    }
    let (stack_key, _) = Pubkey::find_program_address(&[STACK_SEED, mint.key.as_ref()], program_id);
    let (script_key, script_bump) = Pubkey::find_program_address(&[SCRIPT_SEED, mint.key.as_ref()], program_id);
    if stack_ai.key != &stack_key || script_ai.key != &script_key {
        return Err(ProgramError::InvalidSeeds);
    }
    if stack_ai.owner == program_id {
        return Err(refuse(EngineError::StackLocked as u32));
    }
    if script_ai.owner != program_id {
        create_pda(creator, script_ai, system, SCRIPT_SIZE, program_id, &[SCRIPT_SEED, mint.key.as_ref(), &[script_bump]])?;
        let mut d = script_ai.try_borrow_mut_data()?;
        d[..8].copy_from_slice(&SCRIPT_DISC);
        d[SC_VERSION] = 0;
        d[SC_BUMP] = script_bump;
    }
    let mut d = script_ai.try_borrow_mut_data()?;
    if d.len() < SCRIPT_SIZE || d[..8] != SCRIPT_DISC || d[SC_VERSION] != 0 {
        return Err(refuse(EngineError::StackLocked as u32));
    }
    d[SC_CODE_LEN..SC_CODE_LEN + 2].copy_from_slice(&(total as u16).to_le_bytes());
    d[SC_CODE + offset..SC_CODE + offset + bytes.len()].copy_from_slice(bytes);
    Ok(())
}

// ───────────────────────── open_wallet (anyone; idempotent; prepended to hookrz buys) ─────────────────────────
/// Accounts: payer (signer, w), mint, token account, wallet record (w), system program.
fn open_wallet(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [payer, mint, token_account, wallet, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    if token_account.owner != &TOKEN_2022 || mint.owner != &TOKEN_2022 || !token_account_of(&token_account.try_borrow_data()?, mint.key) {
        return Err(ProgramError::InvalidAccountData);
    }
    let (key, bump) = Pubkey::find_program_address(&[WALLET_SEED, mint.key.as_ref(), token_account.key.as_ref()], program_id);
    if wallet.key != &key {
        return Err(ProgramError::InvalidSeeds);
    }
    if wallet.owner == program_id {
        return Ok(());
    }
    create_pda(payer, wallet, system, WALLET_SIZE, program_id, &[WALLET_SEED, mint.key.as_ref(), token_account.key.as_ref(), &[bump]])?;
    let mut d = wallet.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&WALLET_DISC);
    d[W_VERSION] = 1;
    d[W_BUMP] = bump;
    d[W_MINT..W_MINT + 32].copy_from_slice(mint.key.as_ref());
    d[W_TOKEN_ACCOUNT..W_TOKEN_ACCOUNT + 32].copy_from_slice(token_account.key.as_ref());
    d[W_PAYER..W_PAYER + 32].copy_from_slice(payer.key.as_ref());
    Ok(())
}

// ───────────────────────── close (after the hook is retired; anyone may crank) ─────────────────────────
/// Retired = the mint still has its TransferHook extension (extensions can't be removed) but it
/// no longer names this program. Anything else is live (S1: liveness comes from the mint).
fn hook_retired(program_id: &Pubkey, mint: &AccountInfo) -> ProgramResult {
    if mint.owner != &TOKEN_2022 {
        return Err(ProgramError::IllegalOwner);
    }
    match mint_hook(&mint.try_borrow_data()?) {
        Some((_, p)) if p != program_id.to_bytes() => Ok(()),
        _ => {
            msg!("The hook is live until the curve graduates");
            Err(refuse(EngineError::HookLive as u32))
        }
    }
}
fn close_into(target: &AccountInfo, recipient: &AccountInfo) -> ProgramResult {
    let lamports = target.lamports();
    **recipient.try_borrow_mut_lamports()? = recipient.lamports().checked_add(lamports).ok_or(ProgramError::ArithmeticOverflow)?;
    **target.try_borrow_mut_lamports()? = 0;
    target.resize(0)?;
    target.assign(&system_program::ID);
    Ok(())
}
/// Accounts: wallet record (w), mint, rent payer recorded at open (w).
fn close_wallet(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [wallet, mint, recipient] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if wallet.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    {
        let d = wallet.try_borrow_data()?;
        if d.len() < WALLET_SIZE || d[..8] != WALLET_DISC || key_at(&d, W_MINT) != mint.key.as_ref() {
            return Err(ProgramError::InvalidAccountData);
        }
        if key_at(&d, W_PAYER) != recipient.key.as_ref() {
            msg!("Rent goes back to the payer that opened the record");
            return Err(ProgramError::InvalidAccountData);
        }
    }
    hook_retired(program_id, mint)?;
    close_into(wallet, recipient)
}
/// Accounts: stack (w), extra-account-metas (w), script (w), mint, pool creator (w).
fn close_stack(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [stack_ai, meta_list, script_ai, mint, recipient] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if stack_ai.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let has_script = {
        let d = stack_ai.try_borrow_data()?;
        if d.len() < STACK_SIZE || d[..8] != STACK_DISC || key_at(&d, S_MINT) != mint.key.as_ref() {
            return Err(ProgramError::InvalidAccountData);
        }
        // S2: rent goes to the creator recorded on-chain at init.
        if key_at(&d, S_CREATOR) != recipient.key.as_ref() {
            return Err(ProgramError::InvalidAccountData);
        }
        let flags = u16::from_le_bytes(rd(&d, S_FLAGS));
        if flags & F_SCRIPT != 0 && key_at(&d, S_SCRIPT) != script_ai.key.as_ref() {
            return Err(ProgramError::InvalidAccountData);
        }
        flags & F_SCRIPT != 0
    };
    let (meta_key, _) = Pubkey::find_program_address(&[EXTRA_METAS_SEED, mint.key.as_ref()], program_id);
    if meta_list.key != &meta_key {
        return Err(ProgramError::InvalidSeeds);
    }
    hook_retired(program_id, mint)?;
    if meta_list.owner == program_id {
        close_into(meta_list, recipient)?;
    }
    if has_script && script_ai.owner == program_id {
        close_into(script_ai, recipient)?;
    }
    close_into(stack_ai, recipient)
}

// ───────────────────────── helpers ─────────────────────────
/// Create a PDA; M1: a pre-funded address is topped up, then allocated and assigned.
fn create_pda<'a>(payer: &AccountInfo<'a>, target: &AccountInfo<'a>, system: &AccountInfo<'a>, size: usize, owner: &Pubkey, seeds: &[&[u8]]) -> ProgramResult {
    let rent = Rent::get()?.minimum_balance(size);
    if target.lamports() == 0 {
        return invoke_signed(
            &system_instruction::create_account(payer.key, target.key, rent, size as u64, owner),
            &[payer.clone(), target.clone(), system.clone()],
            &[seeds],
        );
    }
    let need = rent.saturating_sub(target.lamports());
    if need > 0 {
        invoke(&system_instruction::transfer(payer.key, target.key, need), &[payer.clone(), target.clone(), system.clone()])?;
    }
    invoke_signed(&system_instruction::allocate(target.key, size as u64), &[target.clone(), system.clone()], &[seeds])?;
    invoke_signed(&system_instruction::assign(target.key, owner), &[target.clone(), system.clone()], &[seeds])
}

enum Seed<'a> {
    Literal(&'a [u8]),
    Key(u8),
}
/// spl-tlv-account-resolution ExtraAccountMeta, discriminator 1: a PDA of the hook program.
fn pda_meta(seeds: &[Seed], writable: bool) -> [u8; META_SIZE] {
    let mut m = [0u8; META_SIZE];
    m[0] = 1;
    let mut i = 1;
    for s in seeds {
        match s {
            Seed::Literal(b) => {
                m[i] = 1;
                m[i + 1] = b.len() as u8;
                m[i + 2..i + 2 + b.len()].copy_from_slice(b);
                i += 2 + b.len();
            }
            Seed::Key(idx) => {
                m[i] = 3;
                m[i + 1] = *idx;
                i += 2;
            }
        }
    }
    m[34] = writable as u8;
    m
}
/// Discriminator 0: a fixed address.
fn fixed_meta(key: &Pubkey, writable: bool) -> [u8; META_SIZE] {
    let mut m = [0u8; META_SIZE];
    m[1..33].copy_from_slice(key.as_ref());
    m[34] = writable as u8;
    m
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
    }
    #[test]
    fn token_accounts_must_hold_this_mint() {
        let mint = Pubkey::new_unique();
        let mut d = vec![0u8; 170];
        d[..32].copy_from_slice(mint.as_ref());
        d[165] = 2;
        assert!(token_account_of(&d, &mint));
        assert!(!token_account_of(&d, &Pubkey::new_unique()));
        d[165] = 1; // a mint, not an account
        assert!(!token_account_of(&d, &mint));
    }
    #[test]
    fn metas_encode_seeds() {
        let m = pda_meta(&[Seed::Literal(WALLET_SEED), Seed::Key(1), Seed::Key(2)], true);
        assert_eq!(&m[..8], &[1, 1, 1, b'w', 3, 1, 3, 2]);
        assert_eq!(m[34], 1);
    }
}
