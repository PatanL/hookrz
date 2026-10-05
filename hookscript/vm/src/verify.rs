//! Static verification: every op decodes, every operand is in range, jumps are forward and land on an op,
//! the stack never under/overflows on any path, and the longest path costs at most GAS_LIMIT.
//! The header's gas_max / flags / sizes must equal what verification recomputes (so the compiler and the
//! VM agree on the cost model, and the engine can trust the flags).
//! Uses O(1) memory: a table of at most 64 pending forward jump targets.

use crate::{op, parse, rd16, rd32, rd8, rdvar, VmError, GAS_LIMIT, GLOBALS_LEN, LOCALS_MAX, STACK_MAX, WVARS_LEN};

/// What verification learned about a script.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Info {
    /// Worst-case gas (CU) over every path.
    pub gas_max: u32,
    pub flags: u8,
    pub max_stack: u8,
    pub n_locals: u8,
    pub globals_len: u16,
    pub wvars_len: u8,
    /// Number of ops.
    pub ops: u16,
}

const LABELS: usize = 64;

struct Labels {
    target: [u16; LABELS],
    depth: [u8; LABELS],
    gas: [u32; LABELS],
    n: usize,
}

impl Labels {
    fn add(&mut self, target: usize, depth: u8, gas: u32) -> Result<(), VmError> {
        let t = target as u16;
        let mut i = 0;
        while i < self.n {
            if self.target.get(i) == Some(&t) {
                if self.depth.get(i) != Some(&depth) {
                    return Err(VmError::StackMismatch);
                }
                if let Some(g) = self.gas.get_mut(i) {
                    if gas > *g {
                        *g = gas;
                    }
                }
                return Ok(());
            }
            i += 1;
        }
        if self.n >= LABELS {
            return Err(VmError::TooManyLabels);
        }
        if let (Some(a), Some(b), Some(c)) =
            (self.target.get_mut(self.n), self.depth.get_mut(self.n), self.gas.get_mut(self.n))
        {
            *a = t;
            *b = depth;
            *c = gas;
        }
        self.n += 1;
        Ok(())
    }
    /// Remove labels targeting `pc`, merging them into `cur`.
    fn take(&mut self, pc: usize, cur: &mut Option<(u8, u32)>) -> Result<(), VmError> {
        let mut i = 0;
        while i < self.n {
            let t = self.target.get(i).copied().unwrap_or(0) as usize;
            if t == pc {
                let d = self.depth.get(i).copied().unwrap_or(0);
                let g = self.gas.get(i).copied().unwrap_or(0);
                match cur {
                    None => *cur = Some((d, g)),
                    Some((cd, cg)) => {
                        if *cd != d {
                            return Err(VmError::StackMismatch);
                        }
                        if g > *cg {
                            *cg = g;
                        }
                    }
                }
                // swap-remove
                let last = self.n - 1;
                let (lt, ld, lg) = (
                    self.target.get(last).copied().unwrap_or(0),
                    self.depth.get(last).copied().unwrap_or(0),
                    self.gas.get(last).copied().unwrap_or(0),
                );
                if let (Some(a), Some(b), Some(c)) =
                    (self.target.get_mut(i), self.depth.get_mut(i), self.gas.get_mut(i))
                {
                    *a = lt;
                    *b = ld;
                    *c = lg;
                }
                self.n = last;
                continue;
            }
            i += 1;
        }
        Ok(())
    }
    /// Any label strictly inside (lo, hi) means a jump into the middle of an op.
    fn inside(&self, lo: usize, hi: usize) -> bool {
        let mut i = 0;
        while i < self.n {
            let t = self.target.get(i).copied().unwrap_or(0) as usize;
            if t > lo && t < hi {
                return true;
            }
            i += 1;
        }
        false
    }
}

fn need(cond: bool, e: VmError) -> Result<(), VmError> {
    if cond {
        Ok(())
    } else {
        Err(e)
    }
}

fn check_key(kind: u8, arg: u8, n_keys: u8, flags: &mut u8, gl: &mut usize, wl: &mut usize) -> Result<(), VmError> {
    match kind {
        op::K_CTX => {
            need(arg <= op::KC_OTHER, VmError::BadKey)?;
            if arg == op::KC_APP {
                *flags |= op::F_APP;
            }
        }
        op::K_CONST => need(arg < n_keys, VmError::BadKey)?,
        op::K_GLOBAL => {
            need(arg as usize + 32 <= GLOBALS_LEN, VmError::BadSlot)?;
            *flags |= op::F_READS_GLOBALS;
            *gl = (*gl).max(arg as usize + 32);
        }
        op::K_WVAR => {
            need(arg <= op::S_OTHER, VmError::BadOperand)?;
            *flags |= op::F_READS_WALLET;
            *wl = WVARS_LEN;
        }
        _ => return Err(VmError::BadKey),
    }
    Ok(())
}

fn side_flags(side: u8) -> Result<u8, VmError> {
    Ok(match side {
        op::S_SENDER => op::F_SENDER,
        op::S_RECEIVER => op::F_RECEIVER,
        op::S_TRADER | op::S_OTHER => op::F_SENDER | op::F_RECEIVER,
        _ => return Err(VmError::BadOperand),
    })
}

/// Verify a whole script. Call it once when the script is stored (init_stack) and in the compiler.
pub fn verify(script: &[u8]) -> Result<Info, VmError> {
    let h = parse(script)?;
    let info = analyze(script)?;
    if h.gas_max as u32 != info.gas_max
        || h.flags != info.flags
        || h.max_stack != info.max_stack
        || h.n_locals != info.n_locals
        || h.globals_len != info.globals_len
        || h.wvars_len != info.wvars_len
    {
        return Err(VmError::BadHeader);
    }
    Ok(info)
}

/// `verify` without the final header-equality check (what an assembler uses to fill the header).
pub fn analyze(script: &[u8]) -> Result<Info, VmError> {
    let h = parse(script)?;
    let c = h.code;
    let len = c.len();
    let mut labels = Labels { target: [0; LABELS], depth: [0; LABELS], gas: [0; LABELS], n: 0 };
    let mut cur: Option<(u8, u32)> = Some((0, op::run_base(h.n_reasons)));
    let mut pc = 0usize;
    let mut gas_max = 0u32;
    let mut max_stack = 0u8;
    let mut flags = 0u8;
    let mut gl = 0usize;
    let mut wl = 0usize;
    let mut nl = 0usize;
    let mut ops = 0u16;
    while pc < len {
        labels.take(pc, &mut cur)?;
        let start = pc;
        let o = rd8(c, &mut pc)?;
        let mut w = op::gas(o).ok_or(VmError::BadOpcode)? as u32;
        ops = ops.saturating_add(1);
        // (pop, push, kind) kind: 0 normal, 1 terminal, 2 jmp, 3 conditional
        let mut target = 0usize;
        let (pop, push, kind): (u8, u8, u8) = match o {
            op::END => (0, 0, 1),
            op::REFUSE | op::REFUSEV => {
                let r = rd8(c, &mut pc)?;
                need(r < h.n_reasons, VmError::BadReason)?;
                (if o == op::REFUSEV { 1 } else { 0 }, 0, 1)
            }
            op::JMP | op::JZ | op::JNZ => {
                let off = rd16(c, &mut pc)? as usize;
                target = pc + off;
                need(target <= len, VmError::BadJump)?;
                if o == op::JMP {
                    (0, 0, 2)
                } else {
                    (1, 0, 3)
                }
            }
            op::POP => (1, 0, 0),
            op::DUP => (1, 2, 0),
            op::PUSHI | op::PUSHR => {
                let at = pc;
                rdvar(c, &mut pc)?;
                w += op::extra_push(pc - at) as u32;
                (0, 1, 0)
            }
            op::LDL | op::STL => {
                let i = rd8(c, &mut pc)? as usize;
                need(i < LOCALS_MAX, VmError::BadOperand)?;
                nl = nl.max(i + 1);
                if o == op::LDL {
                    (0, 1, 0)
                } else {
                    (1, 0, 0)
                }
            }
            op::NEG | op::ABS | op::NOT => (1, 1, 0),
            op::MULDIV => (3, 1, 0),
            op::ADD | op::SUB | op::MUL | op::DIV | op::MOD | op::MIN | op::MAX | op::EQ | op::NE | op::LT
            | op::LE | op::GT | op::GE => (2, 1, 0),
            op::CTX => {
                let f = rd8(c, &mut pc)?;
                need(f < op::CTX_FIELDS, VmError::BadOperand)?;
                w += op::extra_ctx(f) as u32;
                if matches!(f, op::C_VALUE | op::C_PRICE | op::C_PROGRESS | op::C_MCAP | op::C_RAISED | op::C_FEE) {
                    flags |= op::F_CURVE;
                }
                (0, 1, 0)
            }
            op::WAL => {
                let side = rd8(c, &mut pc)?;
                let f = rd8(c, &mut pc)?;
                flags |= side_flags(side)?;
                need(f < op::WAL_FIELDS, VmError::BadOperand)?;
                (0, 1, 0)
            }
            op::WIN => {
                let side = rd8(c, &mut pc)?;
                let dir = rd8(c, &mut pc)?;
                flags |= side_flags(side)?;
                need(dir <= 1, VmError::BadOperand)?;
                (1, 1, 0)
            }
            op::CLOCK => {
                let f = rd8(c, &mut pc)?;
                rd16(c, &mut pc)?;
                let rule = rd8(c, &mut pc)?;
                need(f < op::CLOCK_FIELDS && rule <= 3, VmError::BadOperand)?;
                w += op::extra_clock(f, rule) as u32;
                (0, 1, 0)
            }
            op::DAYLIGHT => {
                rd16(c, &mut pc)?;
                rd16(c, &mut pc)?;
                (0, 1, 0)
            }
            op::MOON => {
                let f = rd8(c, &mut pc)?;
                need(f < op::MOON_FIELDS, VmError::BadOperand)?;
                (0, 1, 0)
            }
            op::DECAY => (4, 1, 0),
            op::RINGTICK | op::RINGAT => {
                let off = rd8(c, &mut pc)? as usize;
                let wd = rd32(c, &mut pc)?;
                need(wd >= 1, VmError::BadOperand)?;
                need(off + op::RING_BYTES <= GLOBALS_LEN, VmError::BadSlot)?;
                gl = gl.max(off + op::RING_BYTES);
                flags |= op::F_CURVE | op::F_READS_GLOBALS;
                if o == op::RINGTICK {
                    flags |= op::F_WRITES_GLOBALS;
                    (0, 0, 0)
                } else {
                    (0, 1, 0)
                }
            }
            op::LDG | op::STG => {
                let ty = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)? as usize;
                let size = op::type_size(ty).ok_or(VmError::BadOperand)?;
                need(off + size <= GLOBALS_LEN, VmError::BadSlot)?;
                gl = gl.max(off + size);
                if o == op::LDG {
                    flags |= op::F_READS_GLOBALS;
                    (0, 1, 0)
                } else {
                    flags |= op::F_WRITES_GLOBALS;
                    (1, 0, 0)
                }
            }
            op::LDW | op::STW => {
                let side = rd8(c, &mut pc)?;
                let ty = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)? as usize;
                need(side <= op::S_OTHER, VmError::BadOperand)?;
                let size = op::type_size(ty).ok_or(VmError::BadOperand)?;
                need(off + size <= WVARS_LEN, VmError::BadSlot)?;
                wl = wl.max(off + size);
                if o == op::LDW {
                    flags |= op::F_READS_WALLET;
                    (0, 1, 0)
                } else {
                    flags |= op::F_WRITES_WALLET;
                    (1, 0, 0)
                }
            }
            op::KEQ => {
                let ka = rd8(c, &mut pc)?;
                let aa = rd8(c, &mut pc)?;
                let kb = rd8(c, &mut pc)?;
                let ab = rd8(c, &mut pc)?;
                check_key(ka, aa, h.n_keys, &mut flags, &mut gl, &mut wl)?;
                check_key(kb, ab, h.n_keys, &mut flags, &mut gl, &mut wl)?;
                (0, 1, 0)
            }
            op::KSTG => {
                let off = rd8(c, &mut pc)? as usize;
                let k = rd8(c, &mut pc)?;
                let a = rd8(c, &mut pc)?;
                need(off + 32 <= GLOBALS_LEN, VmError::BadSlot)?;
                gl = gl.max(off + 32);
                check_key(k, a, h.n_keys, &mut flags, &mut gl, &mut wl)?;
                flags |= op::F_WRITES_GLOBALS;
                (0, 0, 0)
            }
            op::KSTW => {
                let side = rd8(c, &mut pc)?;
                let off = rd8(c, &mut pc)? as usize;
                let k = rd8(c, &mut pc)?;
                let a = rd8(c, &mut pc)?;
                need(side <= op::S_OTHER, VmError::BadOperand)?;
                need(off + 32 <= WVARS_LEN, VmError::BadSlot)?;
                wl = WVARS_LEN;
                check_key(k, a, h.n_keys, &mut flags, &mut gl, &mut wl)?;
                flags |= op::F_WRITES_WALLET;
                (0, 0, 0)
            }
            _ => return Err(VmError::BadOpcode),
        };
        if labels.inside(start, pc) {
            return Err(VmError::BadJump);
        }
        if let Some((d, g)) = cur {
            need(d >= pop, VmError::StackUnderflow)?;
            let nd = d - pop + push;
            need(nd as usize <= STACK_MAX, VmError::StackOverflow)?;
            max_stack = max_stack.max(nd);
            let ng = g.saturating_add(w);
            match kind {
                1 => {
                    gas_max = gas_max.max(ng);
                    cur = None;
                }
                2 => {
                    labels.add(target, nd, ng)?;
                    cur = None;
                }
                3 => {
                    labels.add(target, nd, ng)?;
                    cur = Some((nd, ng));
                }
                _ => cur = Some((nd, ng)),
            }
        }
    }
    labels.take(len, &mut cur)?;
    if labels.n != 0 {
        return Err(VmError::BadJump);
    }
    if let Some((_, g)) = cur {
        gas_max = gas_max.max(g);
    }
    if gas_max > GAS_LIMIT {
        return Err(VmError::OutOfGas);
    }
    Ok(Info {
        gas_max,
        flags,
        max_stack,
        n_locals: nl as u8,
        globals_len: gl as u16,
        wvars_len: wl as u8,
        ops,
    })
}
