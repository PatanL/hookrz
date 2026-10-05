//! Hand-assembled Hookscript fixtures for the engine's fork tests and CU bench. Headers are filled from
//! `hookscript_vm::analyze`, so `verify` accepts them; the output matches hookscript/vm/fixtures byte for byte.
//! `heavy.hex` (15 window reads, gas 7,725), `koth-example.hex` and `hot-potato.hex` come from HOOKSCRIPT
//! (hookscript/vm/fixtures and `node compiler/bin/hsc.ts --hex examples/hot-potato.hs`).
//! Run: cargo run --release --example hs_fixtures   → fork/fixtures/*.hex
use hookscript_vm::{analyze, op, verify, VERSION};
use std::{collections::HashMap, fs, path::Path};

struct Asm {
    code: Vec<u8>,
    labels: HashMap<&'static str, usize>,
    fixups: Vec<(usize, &'static str)>,
}
impl Asm {
    fn new() -> Self {
        Asm { code: vec![], labels: HashMap::new(), fixups: vec![] }
    }
    fn b(&mut self, bytes: &[u8]) -> &mut Self {
        self.code.extend_from_slice(bytes);
        self
    }
    fn varint(&mut self, opc: u8, v: i64) -> &mut Self {
        self.code.push(opc);
        let mut x = ((v << 1) ^ (v >> 63)) as u64;
        loop {
            let byte = (x & 0x7f) as u8;
            x >>= 7;
            if x == 0 {
                self.code.push(byte);
                break;
            }
            self.code.push(byte | 0x80);
        }
        self
    }
    /// PUSHI: a number (×1e6 fixed point in the VM).
    fn pushi(&mut self, v: i64) -> &mut Self {
        self.varint(op::PUSHI, v)
    }
    /// PUSHR: a raw integer (kinds, flags).
    fn pushr(&mut self, v: i64) -> &mut Self {
        self.varint(op::PUSHR, v)
    }
    fn jump(&mut self, opc: u8, label: &'static str) -> &mut Self {
        self.code.push(opc);
        self.fixups.push((self.code.len(), label));
        self.code.extend_from_slice(&[0, 0]);
        self
    }
    fn label(&mut self, l: &'static str) -> &mut Self {
        self.labels.insert(l, self.code.len());
        self
    }
    fn finish(mut self, keys: &[[u8; 32]], reasons: &[(u8, &str)]) -> Vec<u8> {
        for (at, l) in &self.fixups {
            let target = self.labels[l];
            let off = (target - (at + 2)) as u16;
            self.code[*at..at + 2].copy_from_slice(&off.to_le_bytes());
        }
        let mut s = Vec::new();
        s.extend_from_slice(b"HS");
        s.push(VERSION);
        s.push(0);
        s.push(keys.len() as u8);
        s.push(reasons.len() as u8);
        s.extend_from_slice(&(self.code.len() as u16).to_le_bytes());
        s.extend_from_slice(&[0u8; 8]);
        for k in keys {
            s.extend_from_slice(k);
        }
        for (f, t) in reasons {
            s.push(*f);
            s.push(t.len() as u8);
            s.extend_from_slice(t.as_bytes());
        }
        s.extend_from_slice(&self.code);
        let info = analyze(&s).expect("analyze");
        s[3] = info.flags;
        s[8..10].copy_from_slice(&(info.gas_max as u16).to_le_bytes());
        s[10..12].copy_from_slice(&info.globals_len.to_le_bytes());
        s[12] = info.wvars_len;
        s[13] = info.max_stack;
        s[14] = info.n_locals;
        verify(&s).expect("verify");
        s
    }
}

/// King of the Hill: the biggest buy takes the crown (globals: king key @0, best amount @32);
/// the king can't sell while holding it. Every buy also counts in the buyer's wallet var @0.
fn koth() -> Vec<u8> {
    let mut a = Asm::new();
    a.b(&[op::CTX, op::C_KIND]).pushr(0).b(&[op::EQ]).jump(op::JZ, "not_buy");
    // receiver.buys_var += 1
    a.b(&[op::LDW, op::S_RECEIVER, op::T_INT, 0]).pushi(1).b(&[op::ADD, op::STW, op::S_RECEIVER, op::T_INT, 0]);
    // if amount > best: best = amount; king = receiver
    a.b(&[op::CTX, op::C_AMOUNT, op::LDG, op::T_NUM, 32, op::GT]).jump(op::JZ, "end");
    a.b(&[op::CTX, op::C_AMOUNT, op::STG, op::T_NUM, 32, op::KSTG, 0, op::K_CTX, op::KC_RECEIVER]).jump(op::JMP, "end");
    a.label("not_buy");
    a.b(&[op::CTX, op::C_KIND]).pushr(1).b(&[op::EQ]).jump(op::JZ, "end");
    a.b(&[op::KEQ, op::K_CTX, op::KC_SENDER, op::K_GLOBAL, 0]).jump(op::JZ, "end");
    a.b(&[op::REFUSE, 0]);
    a.label("end");
    a.b(&[op::END]);
    a.finish(&[], &[(0, "The king can't sell while wearing the crown")])
}

/// Reads the DBC fee: no buys while the curve's fee is above 10% (C_FEE is a fraction, 0.1 = 100_000).
fn feegate() -> Vec<u8> {
    let mut a = Asm::new();
    a.b(&[op::CTX, op::C_KIND]).pushr(0).b(&[op::EQ]).jump(op::JZ, "end");
    a.b(&[op::CTX, op::C_FEE]).pushr(100_000).b(&[op::GT]).jump(op::JZ, "end");
    a.b(&[op::REFUSE, 0]);
    a.label("end");
    a.b(&[op::END]);
    a.finish(&[], &[(0, "The sniper fee is still above 10%")])
}

/// Fixed VM cost: a script that only allows.
fn empty() -> Vec<u8> {
    let mut a = Asm::new();
    a.b(&[op::END]);
    a.finish(&[], &[])
}

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("fork/fixtures");
    fs::create_dir_all(&dir).unwrap();
    for (name, s) in [("koth", koth()), ("empty", empty()), ("feegate", feegate())] {
        let info = verify(&s).unwrap();
        fs::write(dir.join(format!("{name}.hex")), s.iter().map(|b| format!("{b:02x}")).collect::<String>() + "\n").unwrap();
        println!("{name}: {} bytes, gas_max {}, flags {:#04x}", s.len(), info.gas_max, info.flags);
    }
}
