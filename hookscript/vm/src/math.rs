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

#[inline]
pub fn mul(a: i64, b: i64) -> i64 {
    sat((a as i128) * (b as i128) / (ONE as i128))
}

#[inline]
pub fn div(a: i64, b: i64) -> i64 {
    if b == 0 {
        0
    } else {
        sat((a as i128) * (ONE as i128) / (b as i128))
    }
}

#[inline]
pub fn muldiv(a: i64, b: i64, c: i64) -> i64 {
    if c == 0 {
        0
    } else {
        sat((a as i128) * (b as i128) / (c as i128))
    }
}

#[inline]
pub fn rem(a: i64, b: i64) -> i64 {
    a.checked_rem(b).unwrap_or(0)
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
    let d = decimals as u32;
    let v: u128 = if d >= 6 {
        if d - 6 > 38 {
            0
        } else {
            (raw as u128) / pow10(d - 6)
        }
    } else {
        (raw as u128).saturating_mul(pow10(6 - d))
    };
    if v > i64::MAX as u128 {
        i64::MAX
    } else {
        v as i64
    }
}

/// Seconds (or any integer count) -> number.
#[inline]
pub fn n(v: i64) -> i64 {
    v.saturating_mul(ONE)
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

/// days since 1970-01-01 (>= 0) -> (year, month 1-12, day 1-31). Howard Hinnant's algorithm.
pub fn civil(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// (year >= 1970, month, day) -> days since 1970-01-01.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y / 400; // y >= 1969 here
    let yoe = y - era * 400;
    let mm = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mm + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 0 = Monday … 6 = Sunday, for days >= 0.
#[inline]
pub fn weekday(days: i64) -> i64 {
    (days + 3) % 7
}

fn first_sunday(y: i64, m: i64) -> i64 {
    1 + (6 - weekday(days_from_civil(y, m, 1)))
}

fn last_sunday_31(y: i64, m: i64) -> i64 {
    31 - (weekday(days_from_civil(y, m, 31)) + 1) % 7
}

/// Is daylight saving time active at `utc` (clamped) for this rule? std_off in seconds.
/// rule: 0 none, 1 US/Canada, 2 EU/UK, 3 south-east Australia.
pub fn dst_active(utc: i64, std_off: i64, rule: u8) -> bool {
    let y = civil(clamp_t(utc + std_off) / 86_400).0;
    match rule {
        1 => {
            let start = days_from_civil(y, 3, first_sunday(y, 3) + 7) * 86_400 + 7_200 - std_off;
            let end = days_from_civil(y, 11, first_sunday(y, 11)) * 86_400 + 3_600 - std_off;
            utc >= start && utc < end
        }
        2 => {
            let start = days_from_civil(y, 3, last_sunday_31(y, 3)) * 86_400 + 3_600;
            let end = days_from_civil(y, 10, last_sunday_31(y, 10)) * 86_400 + 3_600;
            utc >= start && utc < end
        }
        3 => {
            let end = days_from_civil(y, 4, first_sunday(y, 4)) * 86_400 + 7_200 - std_off;
            let start = days_from_civil(y, 10, first_sunday(y, 10)) * 86_400 + 7_200 - std_off;
            !(utc >= end && utc < start)
        }
        _ => false,
    }
}

/// CLOCK op. tz_min = standard offset in minutes; returns the field (numbers scaled by ONE, weekday raw 0..6).
pub fn clock(now: i64, f: u8, tz_min: i16, rule: u8) -> Option<i64> {
    let utc = clamp_t(now);
    let std_off = (tz_min as i64) * 60;
    let off = if dst_active(utc, std_off, rule) { std_off + 3_600 } else { std_off };
    let local = clamp_t(utc + off);
    let days = local / 86_400;
    let sod = local % 86_400;
    Some(match f {
        0 => n(sod / 3_600),
        1 => n(sod % 3_600 / 60),
        2 => n(sod % 60),
        3 => weekday(days),
        4 => n(civil(days).2),
        5 => n(civil(days).1),
        6 => n(civil(days).0),
        7 => {
            let y = civil(days).0;
            n(days - days_from_civil(y, 1, 1) + 1)
        }
        8 => n(sod / 60),
        _ => return None,
    })
}

// ───────────── trig on centidegrees (Bhaskara I), output × 1e6 ─────────────

pub fn sin_cd(a: i64) -> i64 {
    let a = a.rem_euclid(36_000);
    let (x, sign) = if a < 18_000 { (a, 1) } else { (a - 18_000, -1) };
    let p = x * (18_000 - x);
    sign * (4_000_000 * p / (405_000_000 - p))
}

#[inline]
pub fn cos_cd(a: i64) -> i64 {
    sin_cd(a.rem_euclid(36_000) + 9_000)
}

/// Is the sun above the horizon (−0.833°, standard refraction) at lat/lon (hundredths of a degree)?
pub fn daylight(now: i64, lat_e2: i16, lon_e2: i16) -> bool {
    let t = clamp_t(now);
    let days = t / 86_400;
    let sod = t % 86_400;
    let y = civil(days).0;
    let doy = days - days_from_civil(y, 1, 1) + 1;
    let decl = 2_344 * sin_cd(36_000 * (doy + 284) / 365) / 1_000_000;
    let b = 36_000 * (doy - 81) / 364;
    let eot = (592 * sin_cd(2 * b) - 452 * cos_cd(b) - 90 * sin_cd(b)) / 1_000_000;
    let solar = sod + (lon_e2 as i64) * 12 / 5 + eot;
    let h = (solar - 43_200) * 5 / 12;
    let lat = lat_e2 as i64;
    let a = sin_cd(lat) * sin_cd(decl) / 1_000_000;
    let c = cos_cd(lat) * cos_cd(decl) / 1_000_000 * cos_cd(h) / 1_000_000;
    a + c > -14_538
}

/// Moon elongation from the sun in microdegrees [0, 360e6): 0 = new, 180e6 = full.
pub fn moon_elongation(now: i64) -> i64 {
    let s = (clamp_t(now) - 946_728_000) as i128; // seconds since J2000.0
    let d = (297_850_192 + s * 12_190_749 / 86_400).rem_euclid(360_000_000) as i64;
    let m = (357_529_109 + s * 985_600 / 86_400).rem_euclid(360_000_000) as i64;
    let mp = (134_963_396 + s * 13_064_993 / 86_400).rem_euclid(360_000_000) as i64;
    let corr = 6_289 * sin_cd(mp / 10_000) - 2_100 * sin_cd(m / 10_000)
        + 1_274 * sin_cd((2 * d - mp) / 10_000)
        + 658 * sin_cd(2 * d / 10_000)
        + 214 * sin_cd(2 * mp / 10_000);
    (d + corr / 1_000).rem_euclid(360_000_000)
}

/// MOON op: 0 phase (0 new … 7 waning crescent; principal phases are ±12h windows), 1 illumination 0..1, 2 age in days.
pub fn moon(now: i64, f: u8) -> Option<i64> {
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
        1 => (ONE - cos_cd(e / 10_000)) / 2,
        2 => e * ONE / 12_190_749,
        _ => return None,
    })
}

/// DECAY: x × (1 − rate)^floor(elapsed / every), dec6 fixed point, exponentiation by squaring.
pub fn decay(x: i64, rate: i64, elapsed: i64, every: i64) -> i64 {
    let mut k: i64 = if every <= 0 || elapsed <= 0 { 0 } else { elapsed / every };
    if k > 0x7fff_ffff {
        k = 0x7fff_ffff;
    }
    let r = rate.clamp(0, ONE);
    let mut base = ONE - r;
    let mut acc = ONE;
    let mut i = 0;
    while k > 0 && i < 31 {
        if k & 1 == 1 {
            acc = acc * base / ONE;
        }
        base = base * base / ONE;
        k >>= 1;
        i += 1;
    }
    mul(x, acc)
}
