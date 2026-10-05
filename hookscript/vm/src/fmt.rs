//! Refusal messages: the reason table and `{}` formatting, without alloc.

use crate::{math, parse, ONE};

pub const FMT_NONE: u8 = 0;
pub const FMT_NUM: u8 = 1;
pub const FMT_INT: u8 = 2;
pub const FMT_DURATION: u8 = 3;
pub const FMT_TIME: u8 = 4;
pub const FMT_PERCENT: u8 = 5;
pub const FMT_MAX: u8 = 5;

/// The `id`-th reason of a script: (format of its `{}` value, UTF-8 text).
pub fn reason(code: &[u8], id: u8) -> Option<(u8, &[u8])> {
    let h = parse(code).ok()?;
    let mut p = 0usize;
    let mut i = 0u8;
    while i < h.n_reasons {
        let fmt = *h.reasons.get(p)?;
        let len = *h.reasons.get(p + 1)? as usize;
        let text = h.reasons.get(p + 2..p + 2 + len)?;
        if i == id {
            return Some((fmt, text));
        }
        p += 2 + len;
        i += 1;
    }
    None
}

struct W<'a> {
    out: &'a mut [u8],
    n: usize,
}
impl W<'_> {
    fn b(&mut self, c: u8) {
        if let Some(s) = self.out.get_mut(self.n) {
            *s = c;
            self.n += 1;
        }
    }
    fn s(&mut self, t: &[u8]) {
        for c in t {
            self.b(*c);
        }
    }
    /// unsigned integer, optional thousands separators, zero-padded to `width`.
    fn u(&mut self, mut v: u64, commas: bool, width: usize) {
        let mut d = [0u8; 20];
        let mut k = 0;
        loop {
            if let Some(s) = d.get_mut(k) {
                *s = b'0' + (v % 10) as u8;
            }
            v /= 10;
            k += 1;
            if v == 0 || k >= 20 {
                break;
            }
        }
        while k < width && k < 20 {
            if let Some(s) = d.get_mut(k) {
                *s = b'0';
            }
            k += 1;
        }
        let mut i = k;
        while i > 0 {
            i -= 1;
            self.b(*d.get(i).unwrap_or(&b'0'));
            if commas && i > 0 && i % 3 == 0 {
                self.b(b',');
            }
        }
    }
    fn num(&mut self, v: i64) {
        if v < 0 {
            self.b(b'-');
        }
        let a = v.unsigned_abs();
        let ip = a / ONE as u64;
        let mut fp = a % ONE as u64;
        self.u(ip, true, 0);
        let mut digits = 6;
        if ip >= 100 {
            fp /= 10_000;
            digits = 2;
        }
        while digits > 0 && fp % 10 == 0 {
            fp /= 10;
            digits -= 1;
        }
        if digits > 0 {
            self.b(b'.');
            self.u(fp, false, digits);
        }
    }
}

/// Render reason `id` with its `{}` placeholder filled by `arg`. Returns bytes written (truncated to `out.len()`).
pub fn format_reason(code: &[u8], id: u8, arg: i64, out: &mut [u8]) -> usize {
    let (fmt, text) = match reason(code, id) {
        Some(r) => r,
        None => return 0,
    };
    let mut w = W { out, n: 0 };
    let mut i = 0usize;
    let mut done = false;
    while i < text.len() {
        let c = *text.get(i).unwrap_or(&b' ');
        if !done && fmt != FMT_NONE && c == b'{' && text.get(i + 1) == Some(&b'}') {
            value(&mut w, fmt, arg);
            done = true;
            i += 2;
            continue;
        }
        w.b(c);
        i += 1;
    }
    w.n
}

fn value(w: &mut W<'_>, fmt: u8, v: i64) {
    match fmt {
        FMT_NUM => w.num(v),
        FMT_INT => {
            if v < 0 {
                w.b(b'-');
            }
            w.u(v.unsigned_abs() / ONE as u64, true, 0);
        }
        FMT_DURATION => {
            let s = if v < 0 { 0 } else { (v / ONE) as u64 };
            let (d, h, m, sec) = (s / 86_400, s % 86_400 / 3_600, s % 3_600 / 60, s % 60);
            if d > 0 {
                w.u(d, true, 0);
                w.b(b'd');
                if h > 0 {
                    w.b(b' ');
                    w.u(h, false, 0);
                    w.b(b'h');
                }
            } else if h > 0 {
                w.u(h, false, 0);
                w.b(b'h');
                if m > 0 {
                    w.b(b' ');
                    w.u(m, false, 0);
                    w.b(b'm');
                }
            } else if m > 0 {
                w.u(m, false, 0);
                w.b(b'm');
                if sec > 0 {
                    w.b(b' ');
                    w.u(sec, false, 0);
                    w.b(b's');
                }
            } else {
                w.u(sec, false, 0);
                w.b(b's');
            }
        }
        FMT_TIME => {
            let t = math::clamp_t(v / ONE);
            let (y, mo, d) = math::civil(t / 86_400);
            let sod = t % 86_400;
            w.u(y as u64, false, 4);
            w.b(b'-');
            w.u(mo as u64, false, 2);
            w.b(b'-');
            w.u(d as u64, false, 2);
            w.b(b' ');
            w.u((sod / 3_600) as u64, false, 2);
            w.b(b':');
            w.u((sod % 3_600 / 60) as u64, false, 2);
            w.s(b" UTC");
        }
        FMT_PERCENT => {
            w.num(math::mul(v, 100 * ONE));
            w.b(b'%');
        }
        _ => {}
    }
}
