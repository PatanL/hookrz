//! Parity runner: reads cases on stdin, one per line, and prints what the Rust VM does.
//!   run <script_hex> <ctx_hex> <globals_hex|-> <wallet_src_hex|-> <wallet_dst_hex|->
//!     -> A <gas> <globals_hex> <src_hex> <dst_hex>        (allow, with the new state)
//!     -> R <reason_id> <arg> <gas> <message_hex>          (refuse; state unchanged)
//!     -> E <error> <gas>
//!   verify <script_hex>  -> V <gas_max> <flags> <max_stack> <n_locals> <globals_len> <wvars_len> <ops> | E <error> 0
//! Build: cargo run --release --example hsrun < cases.txt
use hookscript_vm::{format_reason, run_metered, verify, Ctx, Verdict};
use std::io::{BufRead, Write};

fn unhex(s: &str) -> Vec<u8> {
    if s == "-" {
        return Vec::new();
    }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap_or(0)).collect()
}
fn hex(b: &[u8]) -> String {
    if b.is_empty() {
        return "-".into();
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout());
    for line in stdin.lock().lines() {
        let line = line.unwrap_or_default();
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.is_empty() {
            continue;
        }
        match f[0] {
            "verify" => {
                let code = unhex(f.get(1).copied().unwrap_or("-"));
                match verify(&code) {
                    Ok(i) => writeln!(out, "V {} {} {} {} {} {} {}", i.gas_max, i.flags, i.max_stack, i.n_locals, i.globals_len, i.wvars_len, i.ops),
                    Err(e) => writeln!(out, "E {} 0", e.name()),
                }
                .ok();
            }
            "run" => {
                let code = unhex(f[1]);
                let ctx = match Ctx::decode(&unhex(f[2])) {
                    Some(c) => c,
                    None => {
                        writeln!(out, "E BadCtx 0").ok();
                        continue;
                    }
                };
                let mut g = unhex(f[3]);
                let mut s = unhex(f[4]);
                let mut d = unhex(f[5]);
                let mut gas = 0u32;
                match run_metered(&code, &ctx, &mut g, &mut s, &mut d, &mut gas) {
                    Ok(Verdict::Allow) => writeln!(out, "A {gas} {} {} {}", hex(&g), hex(&s), hex(&d)),
                    Ok(Verdict::Refuse { reason_id, arg }) => {
                        let mut buf = [0u8; 256];
                        let n = format_reason(&code, reason_id, arg, &mut buf);
                        writeln!(out, "R {reason_id} {arg} {gas} {}", hex(&buf[..n]))
                    }
                    Err(e) => writeln!(out, "E {} {gas}", e.name()),
                }
                .ok();
            }
            _ => {
                writeln!(out, "E BadCommand 0").ok();
            }
        }
    }
}
