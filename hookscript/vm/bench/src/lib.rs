//! CU bench program (never deployed). Case data (in account 0):
//!   mode u8 (0 = plain run, 1 = traced run) | script_len u16 | script | ctx (578) | globals (256) | src (32) | dst (32)
//! Return data: total u32 (CU of the whole run call, syscall overhead removed) | verdict u8 | gas u32 | n u16 | n × (op u8, pc u16, cu u16)
//! Per-op cu = CU between consecutive tracer calls minus the tracer's own overhead (measured each run).
use hookscript_vm::{run_metered, run_traced, Ctx, Tracer, Verdict, CTX_BYTES};
use solana_program::{account_info::AccountInfo, compute_units::sol_remaining_compute_units, entrypoint, entrypoint::ProgramResult, program::set_return_data, program_error::ProgramError, pubkey::Pubkey};

entrypoint!(process);

const MAXN: usize = 120;
struct T {
    n: usize,
    total: usize,
    ops: [u8; MAXN],
    pcs: [u16; MAXN],
    rem: [u64; MAXN],
}
impl Tracer for T {
    #[inline(never)]
    fn op(&mut self, _pc: usize, op: u8) {
        self.total += 1;
        if self.n < MAXN {
            self.ops[self.n] = op;
            self.pcs[self.n] = _pc as u16;
            self.rem[self.n] = sol_remaining_compute_units();
            self.n += 1;
        }
    }
}

fn process(_: &Pubkey, accounts: &[AccountInfo], ix: &[u8]) -> ProgramResult {
    let bad = || ProgramError::InvalidInstructionData;
    // case data lives in account 0 (scripts + ctx + state don't fit a transaction); ix = nonce
    let acc = accounts.first().ok_or_else(bad)?;
    let held = acc.try_borrow_data()?;
    let data: &[u8] = &held;
    let _ = ix;
    let mode = *data.first().ok_or_else(bad)?;
    if mode == 2 {
        // micro-bench: [2][fn u8][a i64][b i64][c i64] -> CU per call (100 calls)
        let f = *data.get(1).ok_or_else(bad)?;
        let rd = |o: usize| -> Result<i64, ProgramError> { let mut x = [0u8; 8]; x.copy_from_slice(data.get(o..o + 8).ok_or_else(bad)?); Ok(i64::from_le_bytes(x)) };
        let (a, b, c) = (rd(2)?, rd(10)?, rd(18)?);
        use core::hint::black_box as bb;
        use hookscript_vm::math;
        let t0 = sol_remaining_compute_units();
        let mut acc = 0i64;
        for _ in 0..100 {
            acc ^= match f {
                0 => math::muldiv(bb(a), bb(b), bb(c)),
                1 => math::tok(bb(a) as u64, bb(b) as u8),
                2 => math::clock(bb(a), bb(b) as u8, bb(c) as i16, 1).unwrap_or(0),
                3 => math::daylight(bb(a), bb(b) as i16, bb(c) as i16) as i64,
                4 => math::moon(bb(a), bb(b) as u8).unwrap_or(0),
                5 => math::decay(bb(a), bb(b), bb(c), 1),
                6 => math::civil(bb(a)).0,
                7 => math::days_from_civil(bb(a), bb(b), bb(c)),
                8 => math::dst_active(bb(a), bb(b), bb(c) as u8) as i64,
                9 => math::sin_cd(bb(a)),
                10 => math::moon_elongation(bb(a)),
                _ => 0,
            };
        }
        let t1 = sol_remaining_compute_units();
        let mut out = [0u8; 16];
        out[0..8].copy_from_slice(&((t0 - t1) / 100).to_le_bytes());
        out[8..16].copy_from_slice(&bb(acc).to_le_bytes());
        set_return_data(&out);
        return Ok(());
    }
    let len = u16::from_le_bytes([*data.get(1).ok_or_else(bad)?, *data.get(2).ok_or_else(bad)?]) as usize;
    let script = data.get(3..3 + len).ok_or_else(bad)?;
    let mut p = 3 + len;
    let ctx = Ctx::decode(data.get(p..p + CTX_BYTES).ok_or_else(bad)?).ok_or_else(bad)?;
    p += CTX_BYTES;
    let mut g = [0u8; 256];
    g.copy_from_slice(data.get(p..p + 256).ok_or_else(bad)?);
    p += 256;
    let mut s = [0u8; 32];
    s.copy_from_slice(data.get(p..p + 32).ok_or_else(bad)?);
    p += 32;
    let mut d = [0u8; 32];
    d.copy_from_slice(data.get(p..p + 32).ok_or_else(bad)?);
    let mut gas = 0u32;
    let mut out = [0u8; 620];
    // syscall overhead: two back-to-back reads
    let c0 = sol_remaining_compute_units();
    let c1 = sol_remaining_compute_units();
    let sys = c0 - c1;
    let (total, verdict, n) = if mode == 0 {
        let a = sol_remaining_compute_units();
        let r = run_metered(script, &ctx, &mut g, &mut s, &mut d, &mut gas);
        let b = sol_remaining_compute_units();
        (a - b - sys, r, 0)
    } else {
        let mut t = T { n: 0, total: 0, ops: [0; MAXN], pcs: [0; MAXN], rem: [0; MAXN] };
        // tracer overhead: two back-to-back tracer calls
        t.op(0, 0xff);
        t.op(0, 0xff);
        let over = t.rem[0] - t.rem[1];
        t.n = 0;
        t.total = 0;
        let a = sol_remaining_compute_units();
        let r = run_traced(script, &ctx, &mut g, &mut s, &mut d, &mut gas, &mut t);
        let b = sol_remaining_compute_units();
        let mut q = 11usize;
        // a truncated trace can't attribute the tail: drop the last recorded op
        let n = if t.total > t.n { t.n.saturating_sub(1) } else { t.n };
        for i in 0..n {
            let next = if i + 1 < t.n { t.rem[i + 1] } else { b + sys };
            let cu = t.rem[i].saturating_sub(next).saturating_sub(over);
            out[q] = t.ops[i];
            out[q + 1..q + 3].copy_from_slice(&t.pcs[i].to_le_bytes());
            out[q + 3..q + 5].copy_from_slice(&(cu.min(65535) as u16).to_le_bytes());
            q += 5;
        }
        // first op starts after parse: report parse cost as op 0xfe
        let parse = a.saturating_sub(if t.n > 0 { t.rem[0] } else { b }).saturating_sub(sys);
        out[q] = 0xfe;
        out[q + 3..q + 5].copy_from_slice(&(parse.min(65535) as u16).to_le_bytes());
        (a - b - sys - over * t.n as u64, r, n + 1)
    };
    out[0..4].copy_from_slice(&(total as u32).to_le_bytes());
    out[4] = match verdict {
        Ok(Verdict::Allow) => 0,
        Ok(Verdict::Refuse { .. }) => 1,
        Err(e) => 100 + e as u8,
    };
    out[5..9].copy_from_slice(&gas.to_le_bytes());
    out[9..11].copy_from_slice(&(n as u16).to_le_bytes());
    set_return_data(&out[..11 + 5 * n]);
    Ok(())
}
