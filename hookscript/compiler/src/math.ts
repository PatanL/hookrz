// Bit-exact BigInt port of vm/src/math.rs. Every operation mirrors the Rust integer semantics
// (truncating division, saturating i64, rem_euclid where Rust uses it).

export const ONE = 1_000_000n;
export const I64_MAX = (1n << 63n) - 1n;
export const I64_MIN = -(1n << 63n);
export const U64_MAX = (1n << 64n) - 1n;
export const T_MAX = 1n << 40n;

export const sat = (v: bigint): bigint => (v > I64_MAX ? I64_MAX : v < I64_MIN ? I64_MIN : v);
export const mul = (a: bigint, b: bigint) => sat((a * b) / ONE);
export const div = (a: bigint, b: bigint) => (b === 0n ? 0n : sat((a * ONE) / b));
export const muldiv = (a: bigint, b: bigint, c: bigint) => (c === 0n ? 0n : sat((a * b) / c));
export const rem = (a: bigint, b: bigint) => (b === 0n || (a === I64_MIN && b === -1n) ? 0n : a % b);
export const u2i = (v: bigint) => (v > I64_MAX ? I64_MAX : v);
export const n = (v: bigint) => sat(v * ONE);
export const remE = (a: bigint, m: bigint) => ((a % m) + m) % m;
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const maxB = (a: bigint, b: bigint) => (a > b ? a : b);
export { minB as min, maxB as max };

function pow10(k: number): bigint { return 10n ** BigInt(Math.min(k, 38)); }

/** Raw token units -> Hookscript number (6 decimals). */
export function tok(raw: bigint, decimals: number): bigint {
  const d = decimals;
  let v: bigint;
  if (d >= 6) v = d - 6 > 38 ? 0n : raw / pow10(d - 6);
  else { v = raw * pow10(6 - d); const U128 = (1n << 128n) - 1n; if (v > U128) v = U128; }
  return v > I64_MAX ? I64_MAX : v;
}

export function priceE6FromSqrtQ64(sqrt: bigint, baseDecimals: number): bigint {
  const U128 = (1n << 128n) - 1n;
  const s = sqrt >> 32n;
  const p = s * s;
  if (p > U128) return U64_MAX;
  const k = baseDecimals + 6;
  if (k > 38) return U64_MAX;
  const scale = pow10(k);
  let r = p * scale;
  if (r > U128) { r = (p >> 64n) * scale; if (r > U128) r = U128; } else r >>= 64n;
  return r > U64_MAX ? U64_MAX : r;
}

export const clampT = (t: bigint) => (t < 0n ? 0n : t > T_MAX ? T_MAX : t);

export function civil(days: bigint): [bigint, bigint, bigint] {
  const z = days + 719_468n;
  const era = z / 146_097n;
  const doe = z - era * 146_097n;
  const yoe = (doe - doe / 1460n + doe / 36_524n - doe / 146_096n) / 365n;
  const y = yoe + era * 400n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const d = doy - (153n * mp + 2n) / 5n + 1n;
  const m = mp < 10n ? mp + 3n : mp - 9n;
  return [m <= 2n ? y + 1n : y, m, d];
}

export function daysFromCivil(y0: bigint, m: bigint, d: bigint): bigint {
  const y = m <= 2n ? y0 - 1n : y0;
  const era = y / 400n;
  const yoe = y - era * 400n;
  const mm = m > 2n ? m - 3n : m + 9n;
  const doy = (153n * mm + 2n) / 5n + d - 1n;
  const doe = yoe * 365n + yoe / 4n - yoe / 100n + doy;
  return era * 146_097n + doe - 719_468n;
}

export const weekday = (days: bigint) => (days + 3n) % 7n;
const firstSunday = (y: bigint, m: bigint) => 1n + (6n - weekday(daysFromCivil(y, m, 1n)));
const lastSunday31 = (y: bigint, m: bigint) => 31n - ((weekday(daysFromCivil(y, m, 31n)) + 1n) % 7n);

export function dstActive(utc: bigint, stdOff: bigint, rule: number): boolean {
  const y = civil(clampT(utc + stdOff) / 86_400n)[0];
  if (rule === 1) {
    const start = daysFromCivil(y, 3n, firstSunday(y, 3n) + 7n) * 86_400n + 7_200n - stdOff;
    const end = daysFromCivil(y, 11n, firstSunday(y, 11n)) * 86_400n + 3_600n - stdOff;
    return utc >= start && utc < end;
  }
  if (rule === 2) {
    const start = daysFromCivil(y, 3n, lastSunday31(y, 3n)) * 86_400n + 3_600n;
    const end = daysFromCivil(y, 10n, lastSunday31(y, 10n)) * 86_400n + 3_600n;
    return utc >= start && utc < end;
  }
  if (rule === 3) {
    const end = daysFromCivil(y, 4n, firstSunday(y, 4n)) * 86_400n + 7_200n - stdOff;
    const start = daysFromCivil(y, 10n, firstSunday(y, 10n)) * 86_400n + 7_200n - stdOff;
    return !(utc >= end && utc < start);
  }
  return false;
}

/** CLOCK op. Returns undefined for a bad field. */
export function clock(now: bigint, f: number, tzMin: number, rule: number): bigint | undefined {
  const utc = clampT(now);
  const stdOff = BigInt(tzMin) * 60n;
  const off = dstActive(utc, stdOff, rule) ? stdOff + 3_600n : stdOff;
  const local = clampT(utc + off);
  const days = local / 86_400n;
  const sod = local % 86_400n;
  switch (f) {
    case 0: return n(sod / 3_600n);
    case 1: return n((sod % 3_600n) / 60n);
    case 2: return n(sod % 60n);
    case 3: return weekday(days);
    case 4: return n(civil(days)[2]);
    case 5: return n(civil(days)[1]);
    case 6: return n(civil(days)[0]);
    case 7: { const y = civil(days)[0]; return n(days - daysFromCivil(y, 1n, 1n) + 1n); }
    case 8: return n(sod / 60n);
    default: return undefined;
  }
}

export function sinCd(a0: bigint): bigint {
  const a = remE(a0, 36_000n);
  const [x, sign] = a < 18_000n ? [a, 1n] : [a - 18_000n, -1n];
  const p = x * (18_000n - x);
  return sign * ((4_000_000n * p) / (405_000_000n - p));
}
export const cosCd = (a: bigint) => sinCd(remE(a, 36_000n) + 9_000n);

export function daylight(now: bigint, latE2: number, lonE2: number): boolean {
  const t = clampT(now);
  const days = t / 86_400n;
  const sod = t % 86_400n;
  const y = civil(days)[0];
  const doy = days - daysFromCivil(y, 1n, 1n) + 1n;
  const decl = (2_344n * sinCd((36_000n * (doy + 284n)) / 365n)) / 1_000_000n;
  const b = (36_000n * (doy - 81n)) / 364n;
  const eot = (592n * sinCd(2n * b) - 452n * cosCd(b) - 90n * sinCd(b)) / 1_000_000n;
  const solar = sod + (BigInt(lonE2) * 12n) / 5n + eot;
  const h = ((solar - 43_200n) * 5n) / 12n;
  const lat = BigInt(latE2);
  const a = (sinCd(lat) * sinCd(decl)) / 1_000_000n;
  const c = (((cosCd(lat) * cosCd(decl)) / 1_000_000n) * cosCd(h)) / 1_000_000n;
  return a + c > -14_538n;
}

export function moonElongation(now: bigint): bigint {
  const s = clampT(now) - 946_728_000n;
  const d = remE(297_850_192n + (s * 12_190_749n) / 86_400n, 360_000_000n);
  const m = remE(357_529_109n + (s * 985_600n) / 86_400n, 360_000_000n);
  const mp = remE(134_963_396n + (s * 13_064_993n) / 86_400n, 360_000_000n);
  const corr = 6_289n * sinCd(mp / 10_000n) - 2_100n * sinCd(m / 10_000n)
    + 1_274n * sinCd((2n * d - mp) / 10_000n)
    + 658n * sinCd((2n * d) / 10_000n)
    + 214n * sinCd((2n * mp) / 10_000n);
  return remE(d + corr / 1_000n, 360_000_000n);
}

const abs = (x: bigint) => (x < 0n ? -x : x);
export function moon(now: bigint, f: number): bigint | undefined {
  const e = moonElongation(now);
  const W = 6_095_000n;
  if (f === 0) {
    if (e < W || e >= 360_000_000n - W) return 0n;
    if (abs(e - 90_000_000n) < W) return 2n;
    if (abs(e - 180_000_000n) < W) return 4n;
    if (abs(e - 270_000_000n) < W) return 6n;
    if (e < 90_000_000n) return 1n;
    if (e < 180_000_000n) return 3n;
    if (e < 270_000_000n) return 5n;
    return 7n;
  }
  if (f === 1) return (ONE - cosCd(e / 10_000n)) / 2n;
  if (f === 2) return (e * ONE) / 12_190_749n;
  return undefined;
}

export function decay(x: bigint, rate: bigint, elapsed: bigint, every: bigint): bigint {
  let k = every <= 0n || elapsed <= 0n ? 0n : elapsed / every;
  if (k > 0x7fff_ffffn) k = 0x7fff_ffffn;
  const r = rate < 0n ? 0n : rate > ONE ? ONE : rate;
  let base = ONE - r;
  let acc = ONE;
  let i = 0;
  while (k > 0n && i < 31) {
    if ((k & 1n) === 1n) acc = (acc * base) / ONE;
    base = (base * base) / ONE;
    k >>= 1n;
    i++;
  }
  return mul(x, acc);
}
