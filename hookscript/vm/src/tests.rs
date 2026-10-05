//! Host unit tests + a randomized no-panic fuzz (`cargo test --release`; FUZZ_ITERS=… for longer runs).
use crate::*;
use std::vec::Vec;

/// Tiny assembler: builds a script with a correct header (gas/flags/sizes from verify's own analysis).
pub(crate) fn script(keys: &[[u8; 32]], reasons: &[(u8, &str)], code: &[u8]) -> Vec<u8> {
    let mut s = Vec::new();
    s.extend_from_slice(b"HS");
    s.push(VERSION);
    s.push(0);
    s.push(keys.len() as u8);
    s.push(reasons.len() as u8);
    s.extend_from_slice(&(code.len() as u16).to_le_bytes());
    s.extend_from_slice(&[0u8; 8]);
    for k in keys {
        s.extend_from_slice(k);
    }
    for (f, t) in reasons {
        s.push(*f);
        s.push(t.len() as u8);
        s.extend_from_slice(t.as_bytes());
    }
    s.extend_from_slice(code);
    if let Ok(info) = analyze(&s) {
        s[3] = info.flags;
        s[8..10].copy_from_slice(&(info.gas_max as u16).to_le_bytes());
        s[10..12].copy_from_slice(&info.globals_len.to_le_bytes());
        s[12] = info.wvars_len;
        s[13] = info.max_stack;
        s[14] = info.n_locals;
    }
    s
}

fn pushi(v: i64) -> Vec<u8> {
    let mut out = std::vec![op::PUSHI];
    let mut x = ((v << 1) ^ (v >> 63)) as u64;
    loop {
        let b = (x & 0x7f) as u8;
        x >>= 7;
        if x == 0 {
            out.push(b);
            break;
        }
        out.push(b | 0x80);
    }
    out
}

fn base_ctx() -> Ctx {
    let mut c = Ctx { decimals: 6, supply: 1_000_000_000_000_000, now: 1_760_000_000, launch_ts: 1_759_990_000, price_e6: 28_000_000, ..Default::default() };
    c.sender.key = [1; 32];
    c.receiver.key = [2; 32];
    c.creator = [9; 32];
    c
}

#[test]
fn empty_script_allows() {
    let s = script(&[], &[], &[]);
    let c = base_ctx();
    let mut g = [0u8; 256];
    assert_eq!(run(&s, &c, &mut g, &mut [], &mut []), Ok(Verdict::Allow));
}

#[test]
fn refuse_big_sell() {
    // refuse if kind == sell and amount > 100
    let mut code = std::vec![op::CTX, op::C_KIND, op::PUSHR, 2, op::EQ, op::CTX, op::C_AMOUNT];
    code.extend(pushi(100));
    code.extend([op::GT, op::MUL]); // bool*bool as dec6 mul would be wrong; use JZ chain instead below
    let _ = code;
    let mut code = std::vec![op::CTX, op::C_KIND, op::PUSHR, 2, op::EQ, op::JZ];
    let tail_start = code.len() + 2;
    let mut tail = std::vec![op::CTX, op::C_AMOUNT];
    tail.extend(pushi(100));
    tail.extend([op::GT, op::JZ, 2, 0, op::REFUSE, 0]);
    code.extend((tail.len() as u16).to_le_bytes());
    let _ = tail_start;
    code.extend(tail);
    let s = script(&[], &[(0, "too big")], &code);
    let mut c = base_ctx();
    c.kind = KIND_SELL;
    c.amount = 150_000_000;
    let mut g = [0u8; 256];
    assert_eq!(run(&s, &c, &mut g, &mut [], &mut []), Ok(Verdict::Refuse { reason_id: 0, arg: 0 }));
    c.amount = 50_000_000;
    assert_eq!(run(&s, &c, &mut g, &mut [], &mut []), Ok(Verdict::Allow));
    c.amount = 150_000_000;
    c.kind = KIND_BUY;
    assert_eq!(run(&s, &c, &mut g, &mut [], &mut []), Ok(Verdict::Allow));
}

#[test]
fn state_commits_only_on_allow() {
    // g.num@0 += 1 ; refuse if g >= 3
    let mut code = std::vec![op::LDG, op::T_NUM, 0];
    code.extend(pushi(1));
    code.extend([op::ADD, op::DUP, op::STG, op::T_NUM, 0]);
    code.extend(pushi(3));
    code.extend([op::GE, op::JZ, 2, 0, op::REFUSE, 0]);
    let s = script(&[], &[(0, "full")], &code);
    let c = base_ctx();
    let mut g = [0u8; 256];
    for _ in 0..2 {
        assert_eq!(run(&s, &c, &mut g, &mut [], &mut []), Ok(Verdict::Allow));
    }
    assert_eq!(i64::from_le_bytes(g[0..8].try_into().unwrap()), 2 * ONE);
    assert_eq!(run(&s, &c, &mut g, &mut [], &mut []), Ok(Verdict::Refuse { reason_id: 0, arg: 0 }));
    assert_eq!(i64::from_le_bytes(g[0..8].try_into().unwrap()), 2 * ONE, "refused run must not write");
}

#[test]
fn keys_and_wallet_vars() {
    // KSTG king <- trader ; STW trader bool@0 <- 1 ; refuse if receiver key == king (never on buy since trader=receiver) ...
    let code = std::vec![
        op::KSTG, 0, op::K_CTX, op::KC_TRADER,
        op::PUSHR, 1, op::STW, op::S_TRADER, op::T_BOOL, 0,
        op::KEQ, op::K_GLOBAL, 0, op::K_CTX, op::KC_RECEIVER,
        op::JZ, 2, 0, op::REFUSE, 0
    ];
    let s = script(&[], &[(0, "king")], &code);
    let mut c = base_ctx();
    c.kind = KIND_SELL;
    let mut g = [0u8; 256];
    let mut ws = [0u8; 32];
    let mut wd = [0u8; 32];
    // sell: trader = sender(1); receiver(2) != king(1) -> allow; sender var set
    assert_eq!(run(&s, &c, &mut g, &mut ws, &mut wd), Ok(Verdict::Allow));
    assert_eq!(&g[0..32], &[1u8; 32]);
    assert_eq!(ws[0], 1);
    assert_eq!(wd[0], 0);
    // buy: trader = receiver(2) -> king=2 == receiver -> refuse; nothing written
    c.kind = KIND_BUY;
    assert_eq!(run(&s, &c, &mut g, &mut ws, &mut wd), Ok(Verdict::Refuse { reason_id: 0, arg: 0 }));
    assert_eq!(&g[0..32], &[1u8; 32]);
}

#[test]
fn reason_formatting() {
    let s = script(&[], &[(fmt::FMT_NUM, "beat {} tokens"), (fmt::FMT_DURATION, "wait {}"), (fmt::FMT_TIME, "at {}"), (fmt::FMT_PERCENT, "up {}")], &[]);
    let mut out = [0u8; 128];
    let n = format_reason(&s, 0, 1_234_567_891_234, &mut out);
    assert_eq!(core::str::from_utf8(&out[..n]).unwrap(), "beat 1,234,567.89 tokens");
    let n = format_reason(&s, 0, 50_000, &mut out);
    assert_eq!(core::str::from_utf8(&out[..n]).unwrap(), "beat 0.05 tokens");
    let n = format_reason(&s, 1, 5_400 * ONE, &mut out);
    assert_eq!(core::str::from_utf8(&out[..n]).unwrap(), "wait 1h 30m");
    let n = format_reason(&s, 2, 1_760_000_000 * ONE, &mut out);
    assert_eq!(core::str::from_utf8(&out[..n]).unwrap(), "at 2025-10-09 08:53 UTC");
    let n = format_reason(&s, 3, 300_000, &mut out);
    assert_eq!(core::str::from_utf8(&out[..n]).unwrap(), "up 30%");
}

#[test]
fn calendar_and_dst() {
    // 2026-10-04 (Sunday) 18:21:39 UTC = 1791138099
    let t = 1_791_138_099;
    assert_eq!(math::clock(t, 3, 0, 0), Some(6)); // Sunday
    assert_eq!(math::clock(t, 0, 0, 0), Some(18 * ONE));
    // New York: EDT (UTC-4) in October -> 14h
    assert_eq!(math::clock(t, 0, -300, 1), Some(14 * ONE));
    // Berlin: CEST (UTC+2) -> 20h
    assert_eq!(math::clock(t, 0, 60, 2), Some(20 * ONE));
    // Sydney: AEDT (UTC+11) from first Sunday of October 2026 (Oct 4, 02:00 local std = Oct 3 16:00 UTC) -> 05h next day
    assert_eq!(math::clock(t, 0, 600, 3), Some(5 * ONE));
    // January: New York is EST (-5)
    let jan = 1_768_500_000; // 2026-01-15 18:00 UTC
    assert_eq!(math::clock(jan, 0, -300, 1), Some(13 * ONE));
    assert_eq!(math::clock(jan, 5, 0, 0), Some(ONE)); // month 1
}

#[test]
fn moon_known_full_moons() {
    // Full moons: 2024-01-25 17:54 UTC, 2025-01-13 22:27 UTC, 2026-10-26 04:12 UTC (approx)
    for t in [1_706_205_240i64, 1_736_807_220] {
        assert_eq!(math::moon(t, 0), Some(4), "full at {t}");
        assert_eq!(math::moon(t + 2 * 86_400, 0), Some(5), "waning gibbous after {t}");
    }
    // New moon 2024-01-11 11:57 UTC
    assert_eq!(math::moon(1_704_974_220, 0), Some(0));
}

#[test]
fn daylight_tokyo() {
    // Tokyo 35.68N 139.69E. 2026-06-21 03:00 UTC = 12:00 JST -> day; 15:00 UTC = 00:00 JST -> night
    let noon = 1_782_010_800;
    assert!(math::daylight(noon, 3568, 13969));
    assert!(!math::daylight(noon + 12 * 3600, 3568, 13969));
    // sunrise Tokyo ~04:25 JST in June = 19:25 UTC previous day; 04:00 JST night, 05:00 JST day
    assert!(!math::daylight(noon - 8 * 3600, 3568, 13969));
    assert!(math::daylight(noon - 7 * 3600, 3568, 13969));
}

#[test]
fn decay_math() {
    // 100 tokens decaying 1% per minute for 60 minutes ≈ 54.7
    let v = math::decay(100 * ONE, 10_000, 3_600 * ONE, 60 * ONE);
    assert!((v - 54_715_664).abs() < 2_000, "{v}");
    assert_eq!(math::decay(100 * ONE, 10_000, 0, 60 * ONE), 100 * ONE);
}

#[test]
fn price_ring() {
    // price_at(ago: 40s) with w = 10s
    let code = std::vec![op::RINGTICK, 0, 10, 0, 0, 0, op::RINGAT, 0, 10, 0, 0, 0, op::REFUSEV, 0];
    let s = script(&[], &[(fmt::FMT_NUM, "{}")], &code);
    let mut c = base_ctx();
    let mut g = [0u8; 256];
    let mut last = 0;
    for i in 0..10i64 {
        c.now = 1_760_000_000 + i * 10;
        c.price_e6 = (100 + i) as u64 * ONE as u64;
        // run without committing (refuse) to read, then commit a tick via an allow-only script
        if let Ok(Verdict::Refuse { arg, .. }) = run(&s, &c, &mut g, &mut [], &mut []) {
            last = arg;
        }
        let tick = script(&[], &[], &[op::RINGTICK, 0, 10, 0, 0, 0]);
        assert_eq!(run(&tick, &c, &mut g, &mut [], &mut []), Ok(Verdict::Allow));
    }
    // at i=9 (price 109) the bucket 4 back has price 105
    assert_eq!(last, 105 * ONE);
}

#[test]
fn ctx_codec_roundtrip_size() {
    assert_eq!(CTX_BYTES, 578);
    assert!(Ctx::decode(&[0u8; CTX_BYTES]).is_some());
    assert!(Ctx::decode(&[0u8; CTX_BYTES - 1]).is_none());
}

// ───────────── randomized no-panic fuzz ─────────────

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn byte(&mut self) -> u8 {
        self.next() as u8
    }
}

fn random_ctx(r: &mut Rng) -> Ctx {
    let mut b = [0u8; CTX_BYTES];
    for x in b.iter_mut() {
        *x = r.byte();
    }
    let mut c = Ctx::decode(&b).unwrap();
    if r.next() % 2 == 0 {
        c.kind %= 3;
        c.decimals %= 12;
        c.now = 1_700_000_000 + (r.next() % 100_000_000) as i64;
    }
    c
}

const OPS: &[u8] = &[
    0x00, 0x01, 0x02, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    0x18, 0x19, 0x1A, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x40,
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46,
];

#[test]
fn fuzz_no_panics() {
    let iters: u64 = std::env::var("FUZZ_ITERS").ok().and_then(|v| v.parse().ok()).unwrap_or(200_000);
    let mut r = Rng(0x9e37_79b9_7f4a_7c15);
    let mut allowed = 0u64;
    let mut refused = 0u64;
    let mut errs = 0u64;
    for i in 0..iters {
        // mostly-valid op streams with small operands, plus pure noise
        let n = (r.next() % 120) as usize;
        let mut code = Vec::with_capacity(n);
        for _ in 0..n {
            if i % 4 == 0 {
                code.push(r.byte());
            } else {
                code.push(OPS[(r.next() % OPS.len() as u64) as usize]);
                for _ in 0..(r.next() % 5) {
                    code.push(if r.next() % 3 == 0 { r.byte() } else { (r.next() % 4) as u8 });
                }
            }
        }
        let nk = (r.next() % 3) as usize;
        let keys: Vec<[u8; 32]> = (0..nk).map(|_| [r.byte(); 32]).collect();
        let s = script(&keys, &[(1, "a {}"), (3, "b {}")], &code);
        let s2 = {
            let mut t = s.clone();
            // header noise sometimes
            if r.next() % 8 == 0 {
                let k = (r.next() as usize) % t.len();
                t[k] = r.byte();
            }
            t
        };
        let c = random_ctx(&mut r);
        let mut g = [0u8; 256];
        for x in g.iter_mut() {
            *x = r.byte();
        }
        let mut ws = [0u8; 32];
        let mut wd = [0u8; 32];
        let glen = (r.next() % 300) as usize;
        let glen = glen.min(256);
        let _ = verify(&s2);
        let mut gas = 0;
        match run_metered(&s2, &c, &mut g[..glen], &mut ws, &mut wd[..(r.next() % 33) as usize], &mut gas) {
            Ok(Verdict::Allow) => allowed += 1,
            Ok(Verdict::Refuse { reason_id, arg }) => {
                refused += 1;
                let mut out = [0u8; 200];
                let _ = format_reason(&s2, reason_id, arg, &mut out);
            }
            Err(_) => errs += 1,
        }
        assert!(gas <= GAS_LIMIT + 1000);
        // pure noise as a whole script
        let mut noise = std::vec![0u8; (r.next() % 1100) as usize];
        for x in noise.iter_mut() {
            *x = r.byte();
        }
        if noise.len() > 3 {
            noise[0] = b'H';
            noise[1] = b'S';
            noise[2] = 1;
        }
        let _ = verify(&noise);
        let _ = run(&noise, &c, &mut g, &mut ws, &mut wd);
    }
    std::println!("fuzz: {iters} iters, allow {allowed}, refuse {refused}, err {errs}");
}

// ───────────── fast arithmetic == i128 reference ─────────────
fn ref_muldiv(a: i64, b: i64, c: i64) -> i64 {
    if c == 0 {
        0
    } else {
        math::sat((a as i128) * (b as i128) / (c as i128))
    }
}
fn ref_tok(raw: u64, d: u8) -> i64 {
    let p = |k: u32| 10u128.checked_pow(k).unwrap_or(u128::MAX);
    let v: u128 = if d >= 6 { if d - 6 > 38 { 0 } else { raw as u128 / p((d - 6) as u32) } } else { (raw as u128).saturating_mul(p((6 - d) as u32)) };
    if v > i64::MAX as u128 { i64::MAX } else { v as i64 }
}

#[test]
fn fast_math_matches_i128() {
    let iters: u64 = std::env::var("MATH_ITERS").ok().and_then(|v| v.parse().ok()).unwrap_or(2_000_000);
    let mut r = Rng(0x1234_5678_9abc_def1);
    let edge = [0i64, 1, -1, 2, -2, ONE, -ONE, ONE - 1, i64::MAX, i64::MIN, i64::MAX - 1, i64::MIN + 1, 1 << 32, -(1 << 32), (1 << 32) - 1, 1 << 62, -(1 << 62), 999_999_999_999, 1_000_000_000_000_000];
    let pick = |r: &mut Rng| -> i64 {
        match r.next() % 6 {
            0 => edge[(r.next() % edge.len() as u64) as usize],
            1 => (r.next() % 1_000_000) as i64 - 500_000,
            2 => (r.next() >> (r.next() % 64)) as i64,
            3 => -((r.next() >> (r.next() % 64)) as i64),
            4 => r.next() as i64,
            _ => ((r.next() % 1_000_000_000_000_000) as i64) * if r.next() % 2 == 0 { 1 } else { -1 },
        }
    };
    for _ in 0..iters {
        let (a, b, c) = (pick(&mut r), pick(&mut r), pick(&mut r));
        assert_eq!(math::muldiv(a, b, c), ref_muldiv(a, b, c), "muldiv({a},{b},{c})");
        assert_eq!(math::mul(a, b), ref_muldiv(a, b, ONE), "mul({a},{b})");
        assert_eq!(math::div(a, b), if b == 0 { 0 } else { ref_muldiv(a, ONE, b) }, "div({a},{b})");
        let raw = r.next() >> (r.next() % 64);
        let d = (r.next() % 30) as u8;
        assert_eq!(math::tok(raw, d), ref_tok(raw, d), "tok({raw},{d})");
        assert_eq!(math::n(a), a.saturating_mul(ONE));
    }
    for &a in &edge {
        for &b in &edge {
            for &c in &edge {
                assert_eq!(math::muldiv(a, b, c), ref_muldiv(a, b, c), "edge muldiv({a},{b},{c})");
            }
        }
    }
}

#[test]
fn ring_edge_values_no_panic() {
    let tick = script(&[], &[(1, "{}")], &[op::RINGTICK, 0, 10, 0, 0, 0, op::RINGAT, 0, 10, 0, 0, 0, op::REFUSEV, 0]);
    let edges = [i64::MIN, i64::MIN + 1, -1, 0, 1, i64::MAX, i64::MAX - 1, 176_000_000, 176_000_001];
    let mut c = base_ctx();
    for &stored in &edges {
        for &p in &edges {
            for now in [0i64, 1, 1_760_000_000, i64::MAX, i64::MIN] {
                let mut g = [0u8; 256];
                g[0..8].copy_from_slice(&stored.to_le_bytes());
                for i in 0..5 {
                    g[8 + 8 * i..16 + 8 * i].copy_from_slice(&p.to_le_bytes());
                }
                c.now = now;
                let _ = run(&tick, &c, &mut g, &mut [], &mut []);
            }
        }
    }
}

// ───────────── structured fuzz: stack-aware programs with valid operands ─────────────
fn gen_program(r: &mut Rng) -> Vec<u8> {
    let mut code = Vec::new();
    let mut depth: i32 = 0;
    let n = 5 + (r.next() % 60) as usize;
    let small = |r: &mut Rng| -> u8 { (r.next() % 4) as u8 };
    for _ in 0..n {
        let pick = r.next() % 40;
        // (opcode, pops, pushes)
        let (o, pop, push): (u8, i32, i32) = match pick {
            0..=5 => (if r.next() % 2 == 0 { op::PUSHI } else { op::PUSHR }, 0, 1),
            6 => (op::CTX, 0, 1),
            7 => (op::WAL, 0, 1),
            8 => (op::WIN, 1, 1),
            9 => (op::CLOCK, 0, 1),
            10 => (op::DAYLIGHT, 0, 1),
            11 => (op::MOON, 0, 1),
            12 => (op::DECAY, 4, 1),
            13 => (op::RINGTICK, 0, 0),
            14 => (op::RINGAT, 0, 1),
            15 => (op::LDG, 0, 1),
            16 => (op::STG, 1, 0),
            17 => (op::LDW, 0, 1),
            18 => (op::STW, 1, 0),
            19 => (op::KEQ, 0, 1),
            20 => (op::KSTG, 0, 0),
            21 => (op::KSTW, 0, 0),
            22 => (op::LDL, 0, 1),
            23 => (op::STL, 1, 0),
            24 => (op::DUP, 1, 2),
            25 => (op::POP, 1, 0),
            26 => (op::MULDIV, 3, 1),
            27 => (op::JZ, 1, 0),
            28 => (op::JNZ, 1, 0),
            29 => (op::REFUSEV, 1, 0),
            30 => ([op::NEG, op::ABS, op::NOT][(r.next() % 3) as usize], 1, 1),
            _ => ([op::ADD, op::SUB, op::MUL, op::DIV, op::MOD, op::MIN, op::MAX, op::EQ, op::NE, op::LT, op::LE, op::GT, op::GE][(r.next() % 13) as usize], 2, 1),
        };
        if depth < pop || depth - pop + push > 30 {
            code.push(op::PUSHR);
            code.push((r.next() % 100) as u8);
            depth += 1;
            continue;
        }
        code.push(o);
        match o {
            op::PUSHI | op::PUSHR => {
                let v: i64 = match r.next() % 4 {
                    0 => (r.next() % 200) as i64 - 100,
                    1 => r.next() as i64,
                    2 => [i64::MIN, i64::MAX, 0, -1, ONE][(r.next() % 5) as usize],
                    _ => (r.next() % 2_000_000_000_000) as i64,
                };
                let mut x = ((v << 1) ^ (v >> 63)) as u64;
                loop {
                    let b = (x & 0x7f) as u8;
                    x >>= 7;
                    if x == 0 {
                        code.push(b);
                        break;
                    }
                    code.push(b | 0x80);
                }
            }
            op::CTX => code.push((r.next() % 16) as u8),
            op::WAL => code.extend([small(r), (r.next() % 14) as u8]),
            op::WIN => code.extend([small(r), (r.next() % 2) as u8]),
            op::CLOCK => code.extend([(r.next() % 9) as u8, r.byte(), r.byte(), small(r)]),
            op::DAYLIGHT => code.extend([r.byte(), r.byte(), r.byte(), r.byte()]),
            op::MOON => code.push((r.next() % 3) as u8),
            op::RINGTICK | op::RINGAT => {
                code.push([0u8, 48, 96, 160, 208][(r.next() % 5) as usize]);
                code.extend((1 + (r.next() % 3600) as u32).to_le_bytes());
            }
            op::LDG | op::STG => {
                let t = small(r);
                code.extend([t, (r.next() % 248) as u8]);
            }
            op::LDW | op::STW => {
                let t = small(r);
                code.extend([small(r), t, (r.next() % 24) as u8]);
            }
            op::KEQ => code.extend([small(r), (r.next() % 7) as u8, small(r), (r.next() % 7) as u8]),
            op::KSTG => code.extend([(r.next() % 224) as u8, small(r), (r.next() % 4) as u8]),
            op::KSTW => code.extend([small(r), 0, small(r), (r.next() % 4) as u8]),
            op::LDL | op::STL => code.push((r.next() % 32) as u8),
            op::JZ | op::JNZ => code.extend([0, 0]), // fall-through target keeps verify happy
            op::REFUSEV => code.push((r.next() % 2) as u8),
            _ => {}
        }
        depth = depth - pop + push;
        if o == op::REFUSEV {
            break;
        }
    }
    code
}

#[test]
fn structured_fuzz() {
    let iters: u64 = std::env::var("FUZZ_ITERS").ok().and_then(|v| v.parse().ok()).unwrap_or(200_000);
    let mut r = Rng(0xdead_beef_cafe_f00d);
    let (mut allow, mut refuse, mut err, mut verified) = (0u64, 0u64, 0u64, 0u64);
    let mut errs = std::collections::BTreeMap::<&'static str, u64>::new();
    for _ in 0..iters {
        let code = gen_program(&mut r);
        let keys: Vec<[u8; 32]> = (0..(r.next() % 3)).map(|_| [r.byte(); 32]).collect();
        let s = script(&keys, &[(1, "a {}"), (3, "b {}")], &code);
        if verify(&s).is_ok() {
            verified += 1;
        }
        let c = random_ctx(&mut r);
        let mut g = [0u8; 256];
        if r.next() % 2 == 0 {
            for x in g.iter_mut() {
                *x = r.byte();
            }
        }
        let mut ws = [r.byte(); 32];
        let mut wd = [r.byte(); 32];
        let mut gas = 0;
        let res = run_metered(&s, &c, &mut g, &mut ws, &mut wd, &mut gas);
        match res {
            Ok(Verdict::Allow) => allow += 1,
            Ok(Verdict::Refuse { reason_id, arg }) => {
                refuse += 1;
                let mut out = [0u8; 256];
                let _ = format_reason(&s, reason_id, arg, &mut out);
            }
            Err(e) => {
                err += 1;
                *errs.entry(e.name()).or_default() += 1;
            }
        }
        // a verified script never errors at run time (gas, stack and operands are proven statically)
        if let Ok(info) = verify(&s) {
            assert!(res.is_ok(), "verified script failed at run time: {:?}", res);
            assert!(gas <= info.gas_max, "gas {gas} > static {}", info.gas_max);
        }
    }
    std::println!("structured fuzz: {iters} programs, verified {verified}, allow {allow}, refuse {refuse}, err {err} {:?}", errs);
}
