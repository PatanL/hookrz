//! Fixed-point arithmetic, calendar, timezone, sun and moon math.
//! Every function is total (no panics, no overflow) and integer-only, so the TypeScript
//! interpreter (compiler/src/interp.ts) can match it bit for bit with BigInt.

use crate::ONE;

/// Clock math clamps unix time into [0, 2^40] seconds.
pub const T_MAX: i64 = 1 << 40;

#[inline]
pub fn sat(v: i128) -> i64 {
    if v > i64::MAX as i128 {
        i64::MAX
    } else if v < i64::MIN as i128 {
        i64::MIN
    } else {
        v as i64
    }
}

// sBPF has no signed division and, with overflow checks on, every `*` becomes a libcall. These helpers keep the
// integer results identical while compiling to native div64/mul64: values are proven in range at each call site.

/// trunc(a / b) for b > 0 (same as Rust's `/`), via unsigned division.
#[inline]
pub fn sdiv(a: i64, b: i64) -> i64 {
    let q = a.unsigned_abs() / (b as u64);
    if a < 0 {
        (q as i64).wrapping_neg()
    } else {
        q as i64
    }
}

/// a.rem_euclid(m) for m > 0, via unsigned remainder.
#[inline]
pub fn srem_e(a: i64, m: i64) -> i64 {
    let r = (a.unsigned_abs() % (m as u64)) as i64;
    if a < 0 && r != 0 {
        m - r
    } else {
        r
    }
}

#[inline]
fn wm(a: i64, b: i64) -> i64 {
    a.wrapping_mul(b)
}

/// 128/64 -> 64 division (Hacker's Delight `divlu`), u1 < v required. No u128 division libcall.
fn divlu(u1: u64, u0: u64, v: u64) -> u64 {
    const B: u64 = 1 << 32;
    let s = v.leading_zeros();
    let v = v << s;
    let vn1 = v >> 32;
    let vn0 = v & 0xffff_ffff;
    let un32 = if s == 0 { u1 } else { (u1 << s) | (u0 >> (64 - s)) };
    let un10 = u0 << s;
    let un1 = un10 >> 32;
    let un0 = un10 & 0xffff_ffff;
    let mut q1 = un32 / vn1;
    let mut rhat = un32 - q1.wrapping_mul(vn1);
    while q1 >= B || q1.wrapping_mul(vn0) > B.wrapping_mul(rhat) + un1 {
        q1 -= 1;
        rhat += vn1;
        if rhat >= B {
            break;
        }
    }
    let un21 = un32.wrapping_mul(B).wrapping_add(un1).wrapping_sub(q1.wrapping_mul(v));
    let mut q0 = un21 / vn1;
    rhat = un21 - q0.wrapping_mul(vn1);
    while q0 >= B || q0.wrapping_mul(vn0) > B.wrapping_mul(rhat) + un0 {
        q0 -= 1;
        rhat += vn1;
        if rhat >= B {
            break;
        }
    }
    q1.wrapping_mul(B) + q0
}

/// floor(x * y / z) for u64s; None if z == 0 or the quotient doesn't fit in u64.
#[inline]
pub fn mul_div_u64(x: u64, y: u64, z: u64) -> Option<u64> {
    if z == 0 {
        return None;
    }
    // 64x64 -> 128 product from 32-bit halves
    let (x1, x0) = (x >> 32, x & 0xffff_ffff);
    let (y1, y0) = (y >> 32, y & 0xffff_ffff);
    let p00 = x0.wrapping_mul(y0);
    let p01 = x0.wrapping_mul(y1);
    let p10 = x1.wrapping_mul(y0);
    let p11 = x1.wrapping_mul(y1);
    let mid = (p00 >> 32) + (p01 & 0xffff_ffff) + (p10 & 0xffff_ffff);
    let lo = (p00 & 0xffff_ffff) | (mid << 32);
    let hi = p11 + (p01 >> 32) + (p10 >> 32) + (mid >> 32);
    if hi == 0 {
        return Some(lo / z);
    }
    if hi >= z {
        return None;
    }
    Some(divlu(hi, lo, z))
}

/// Signed trunc(a * b / c), saturating at the i64 bounds; c == 0 gives 0.
/// Bit-identical to `sat((a as i128) * (b as i128) / (c as i128))`.
pub fn muldiv(a: i64, b: i64, c: i64) -> i64 {
    if c == 0 {
        return 0;
    }
    let neg = (a < 0) ^ (b < 0) ^ (c < 0);
    let q = mul_div_u64(a.unsigned_abs(), b.unsigned_abs(), c.unsigned_abs());
    match (q, neg) {
        (None, false) => i64::MAX,
        (None, true) => i64::MIN,
        (Some(q), false) => {
            if q > i64::MAX as u64 {
                i64::MAX
            } else {
                q as i64
            }
        }
        (Some(q), true) => {
            if q >= 1u64 << 63 {
                i64::MIN
            } else {
                -(q as i64)
            }
        }
    }
}

#[inline]
pub fn mul(a: i64, b: i64) -> i64 {
    muldiv(a, b, ONE)
}

#[inline]
pub fn div(a: i64, b: i64) -> i64 {
    if b == 0 {
        0
    } else {
        muldiv(a, ONE, b)
    }
}

/// Rust's `a % b` (sign of a), with b == 0 and MIN % -1 giving 0. Unsigned remainder underneath.
#[inline]
pub fn rem(a: i64, b: i64) -> i64 {
    if b == 0 || b == -1 {
        return 0;
    }
    let r = (a.unsigned_abs() % b.unsigned_abs()) as i64;
    if a < 0 {
        r.wrapping_neg()
    } else {
        r
    }
}

/// u64 -> i64, clamped.
#[inline]
pub fn u2i(v: u64) -> i64 {
    if v > i64::MAX as u64 {
        i64::MAX
    } else {
        v as i64
    }
}

const P10: [u64; 20] = [
    1,
    10,
    100,
    1_000,
    10_000,
    100_000,
    1_000_000,
    10_000_000,
    100_000_000,
    1_000_000_000,
    10_000_000_000,
    100_000_000_000,
    1_000_000_000_000,
    10_000_000_000_000,
    100_000_000_000_000,
    1_000_000_000_000_000,
    10_000_000_000_000_000,
    100_000_000_000_000_000,
    1_000_000_000_000_000_000,
    10_000_000_000_000_000_000,
];

fn pow10(k: u32) -> u128 {
    let mut r: u128 = 1;
    let mut i = 0;
    while i < k && i < 38 {
        r = r.saturating_mul(10);
        i += 1;
    }
    r
}

/// Raw token units -> Hookscript number (whole tokens, 6 decimals).
pub fn tok(raw: u64, decimals: u8) -> i64 {
    let v: u64 = if decimals >= 6 {
        match P10.get((decimals - 6) as usize) {
            Some(p) => raw / p,
            None => 0, // 10^20 > u64::MAX >= raw
        }
    } else {
        match P10.get((6 - decimals) as usize) {
            Some(p) => raw.checked_mul(*p).unwrap_or(u64::MAX),
            None => u64::MAX,
        }
    };
    u2i(v)
}

/// Seconds (or any integer count) -> number, saturating.
#[inline]
pub fn n(v: i64) -> i64 {
    if v > i64::MAX / ONE {
        i64::MAX
    } else if v < i64::MIN / ONE {
        i64::MIN
    } else {
        v.wrapping_mul(ONE)
    }
}

/// Helper for the engine: DBC sqrt price (Q64.64 of sqrt(quote_raw / base_raw)) -> `Ctx::price_e6`,
/// i.e. quote raw units (lamports) per whole base token, times 1e6.
pub fn price_e6_from_sqrt_q64(sqrt_price: u128, base_decimals: u8) -> u64 {
    let s = sqrt_price >> 32; // Q?.32
    let p = match s.checked_mul(s) {
        Some(p) => p, // price per raw unit, Q64
        None => return u64::MAX,
    };
    let k = (base_decimals as u32).saturating_add(6);
    if k > 38 {
        return u64::MAX;
    }
    let scale = pow10(k);
    let r = match p.checked_mul(scale) {
        Some(x) => x >> 64,
        None => (p >> 64).saturating_mul(scale),
    };
    if r > u64::MAX as u128 {
        u64::MAX
    } else {
        r as u64
    }
}

// ───────────── calendar ─────────────

#[inline]
pub fn clamp_t(t: i64) -> i64 {
    if t < 0 {
        0
    } else if t > T_MAX {
        T_MAX
    } else {
        t
    }
}

/// days since 1970-01-01 (>= 0) -> (year, month 1-12, day 1-31). Howard Hinnant's algorithm, unsigned.
pub fn civil(days: i64) -> (i64, i64, i64) {
    let z = days.max(0) as u64 + 719_468;
    let era = z / 146_097;
    let doe = z - era.wrapping_mul(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era.wrapping_mul(400);
    let doy = doe - (yoe.wrapping_mul(365) + yoe / 4 - yoe / 100);
    let mp = (doy.wrapping_mul(5) + 2) / 153;
    let d = doy - (mp.wrapping_mul(153) + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    ((if m <= 2 { y + 1 } else { y }) as i64, m as i64, d as i64)
}

/// (year >= 1970, month, day) -> days since 1970-01-01.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = (if m <= 2 { y - 1 } else { y }).max(0) as u64;
    let era = y / 400;
    let yoe = y - era.wrapping_mul(400);
    let mm = (if m > 2 { m - 3 } else { m + 9 }) as u64;
    let doy = (mm.wrapping_mul(153) + 2) / 5 + d as u64 - 1;
    let doe = yoe.wrapping_mul(365) + yoe / 4 - yoe / 100 + doy;
    (era.wrapping_mul(146_097) + doe) as i64 - 719_468
}

/// 0 = Monday … 6 = Sunday, for days >= 0.
#[inline]
pub fn weekday(days: i64) -> i64 {
    ((days.max(0) as u64 + 3) % 7) as i64
}

fn first_sunday(y: i64, m: i64) -> i64 {
    1 + (6 - weekday(days_from_civil(y, m, 1)))
}

fn last_sunday_31(y: i64, m: i64) -> i64 {
    31 - srem_e(weekday(days_from_civil(y, m, 31)) + 1, 7)
}

/// Is daylight saving time active at `utc` (clamped) for this rule? std_off in seconds.
/// rule: 0 none, 1 US/Canada, 2 EU/UK, 3 south-east Australia.
pub fn dst_active(utc: i64, std_off: i64, rule: u8) -> bool {
    if rule == 0 || rule > 3 {
        return false;
    }
    let y = civil(sdiv(clamp_t(utc + std_off), 86_400)).0;
    let at = |m: i64, d: i64, secs: i64| wm(days_from_civil(y, m, d), 86_400) + secs;
    match rule {
        1 => utc >= at(3, first_sunday(y, 3) + 7, 7_200 - std_off) && utc < at(11, first_sunday(y, 11), 3_600 - std_off),
        2 => utc >= at(3, last_sunday_31(y, 3), 3_600) && utc < at(10, last_sunday_31(y, 10), 3_600),
        _ => !(utc >= at(4, first_sunday(y, 4), 7_200 - std_off) && utc < at(10, first_sunday(y, 10), 7_200 - std_off)),
    }
}

/// CLOCK op. tz_min = standard offset in minutes; returns the field (numbers scaled by ONE, weekday raw 0..6).
pub fn clock(now: i64, f: u8, tz_min: i16, rule: u8) -> Option<i64> {
    if f > 8 {
        return None;
    }
    let utc = clamp_t(now);
    let std_off = wm(tz_min as i64, 60);
    let off = if dst_active(utc, std_off, rule) { std_off + 3_600 } else { std_off };
    let local = clamp_t(utc + off) as u64;
    let days = (local / 86_400) as i64;
    let sod = local % 86_400;
    Some(match f {
        0 => n((sod / 3_600) as i64),
        1 => n((sod % 3_600 / 60) as i64),
        2 => n((sod % 60) as i64),
        3 => weekday(days),
        4 => n(civil(days).2),
        5 => n(civil(days).1),
        6 => n(civil(days).0),
        7 => {
            let y = civil(days).0;
            n(days - days_from_civil(y, 1, 1) + 1)
        }
        _ => n((sod / 60) as i64),
    })
}

// ───────────── trig on centidegrees (Bhaskara I), output × 1e6 ─────────────

pub fn sin_cd(a: i64) -> i64 {
    let a = srem_e(a, 36_000) as u64;
    let (x, neg) = if a < 18_000 { (a, false) } else { (a - 18_000, true) };
    let p = x.wrapping_mul(18_000 - x);
    let v = (p.wrapping_mul(4_000_000) / (405_000_000 - p)) as i64;
    if neg {
        -v
    } else {
        v
    }
}

#[inline]
pub fn cos_cd(a: i64) -> i64 {
    sin_cd(srem_e(a, 36_000) + 9_000)
}

/// Is the sun above the horizon (−0.833°, standard refraction) at lat/lon (hundredths of a degree)?
pub fn daylight(now: i64, lat_e2: i16, lon_e2: i16) -> bool {
    let t = clamp_t(now) as u64;
    let days = (t / 86_400) as i64;
    let sod = (t % 86_400) as i64;
    let y = civil(days).0;
    let doy = days - days_from_civil(y, 1, 1) + 1;
    let decl = sdiv(wm(2_344, sin_cd(sdiv(wm(36_000, doy + 284), 365))), 1_000_000);
    let b = sdiv(wm(36_000, doy - 81), 364);
    let eot = sdiv(wm(592, sin_cd(wm(2, b))) - wm(452, cos_cd(b)) - wm(90, sin_cd(b)), 1_000_000);
    let solar = sod + sdiv(wm(lon_e2 as i64, 12), 5) + eot;
    let h = sdiv(wm(solar - 43_200, 5), 12);
    let lat = lat_e2 as i64;
    let a = sdiv(wm(sin_cd(lat), sin_cd(decl)), 1_000_000);
    let c = sdiv(wm(sdiv(wm(cos_cd(lat), cos_cd(decl)), 1_000_000), cos_cd(h)), 1_000_000);
    a + c > -14_538
}

/// trunc(s * rate / 86_400) without overflow (s up to ±1.1e12, rate up to 1.4e7); exact.
fn per_day(s: i64, rate: i64) -> i64 {
    let q = sdiv(s, 86_400);
    let r = s - wm(q, 86_400);
    wm(q, rate) + sdiv(wm(r, rate), 86_400)
}

/// Moon elongation from the sun in microdegrees [0, 360e6): 0 = new, 180e6 = full.
pub fn moon_elongation(now: i64) -> i64 {
    let s = clamp_t(now) - 946_728_000; // seconds since J2000.0
    let d = srem_e(297_850_192 + per_day(s, 12_190_749), 360_000_000);
    let m = srem_e(357_529_109 + per_day(s, 985_600), 360_000_000);
    let mp = srem_e(134_963_396 + per_day(s, 13_064_993), 360_000_000);
    let corr = wm(6_289, sin_cd(sdiv(mp, 10_000))) - wm(2_100, sin_cd(sdiv(m, 10_000)))
        + wm(1_274, sin_cd(sdiv(wm(2, d) - mp, 10_000)))
        + wm(658, sin_cd(sdiv(wm(2, d), 10_000)))
        + wm(214, sin_cd(sdiv(wm(2, mp), 10_000)));
    srem_e(d + sdiv(corr, 1_000), 360_000_000)
}

/// MOON op: 0 phase (0 new … 7 waning crescent; principal phases are ±12h windows), 1 illumination 0..1, 2 age in days.
pub fn moon(now: i64, f: u8) -> Option<i64> {
    if f > 2 {
        return None;
    }
    let e = moon_elongation(now);
    const W: i64 = 6_095_000;
    Some(match f {
        0 => {
            if e < W || e >= 360_000_000 - W {
                0
            } else if (e - 90_000_000).abs() < W {
                2
            } else if (e - 180_000_000).abs() < W {
                4
            } else if (e - 270_000_000).abs() < W {
                6
            } else if e < 90_000_000 {
                1
            } else if e < 180_000_000 {
                3
            } else if e < 270_000_000 {
                5
            } else {
                7
            }
        }
        1 => sdiv(ONE - cos_cd(sdiv(e, 10_000)), 2),
        _ => (wm(e, ONE) as u64 / 12_190_749) as i64,
    })
}

/// DECAY: x × (1 − rate)^floor(elapsed / every), dec6 fixed point, exponentiation by squaring.
pub fn decay(x: i64, rate: i64, elapsed: i64, every: i64) -> i64 {
    let mut k: u64 = if every <= 0 || elapsed <= 0 { 0 } else { elapsed as u64 / every as u64 };
    if k > 0x7fff_ffff {
        k = 0x7fff_ffff;
    }
    let r = rate.clamp(0, ONE) as u64;
    let mut base = ONE as u64 - r;
    let mut acc = ONE as u64;
    let mut i = 0;
    while k > 0 && i < 31 {
        if k & 1 == 1 {
            acc = acc.wrapping_mul(base) / ONE as u64;
        }
        base = base.wrapping_mul(base) / ONE as u64;
        k >>= 1;
        i += 1;
    }
    mul(x, acc as i64)
}
