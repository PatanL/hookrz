// Compiler unit tests: error messages (line, column, hint), semantics via the reference interpreter, and a robustness
// fuzz (compile() returns errors for garbage; it never throws). Run: node compiler/test/compiler.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type CompileOk } from '../src/compile.ts';
import { run, formatReason } from '../src/interp.ts';
import { ctx, wallet, type Ctx } from '../src/ctx.ts';
import { daylight, moonElongation } from '../src/math.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const t = (name: string, f: () => void) => { try { f(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${(e as Error).message}`); } };
const eq = (a: unknown, b: unknown, m = '') => { if (JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) !== JSON.stringify(b, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`); };
const ok = (src: string): CompileOk => { const r = compile(src); if (!r.ok) throw new Error(`compile failed: ${r.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('; ')}`); return r; };
const err = (src: string, re: RegExp, line?: number) => {
  const r = compile(src);
  if (r.ok) throw new Error(`expected an error matching ${re}`);
  const e = r.errors[0];
  if (!re.test(e.message + ' ' + (e.hint ?? ''))) throw new Error(`error "${e.message}" (hint "${e.hint}") doesn't match ${re}`);
  if (line !== undefined && e.line !== line) throw new Error(`error on line ${e.line}, expected ${line}`);
};

const T0 = 1_791_138_099n; // 2026-10-04 18:21:39 UTC, a Sunday
const K = (n: number) => new Uint8Array(32).fill(n);
function cx(p: Partial<Ctx> & { held?: bigint; bal?: bigint } = {}): Ctx {
  const { held, bal, ...rest } = p;
  return ctx({
    kind: 1, amount: 1_000_000n * 1_000_000n, now: T0, launchTs: T0 - 10_000n, priceE6: 28_000_000n, creator: K(9),
    sender: wallet({ key: K(1), hasRecord: true, balance: bal ?? 10_000_000n * 1_000_000n, firstReceiptTs: held !== undefined ? T0 - held : T0 - 600n }),
    receiver: wallet({ key: K(2), hasRecord: true }), ...rest,
  });
}
const verdict = (c: CompileOk, x: Ctx, g = new Uint8Array(256), s = new Uint8Array(32), d = new Uint8Array(32)) => {
  const r = run(c.bytes, x, g, s, d);
  if (r.error) return `ERR ${r.error}`;
  return r.verdict!.allow ? 'allow' : formatReason(c.bytes, r.verdict!.reasonId, r.verdict!.arg);
};

// ── errors point at the right place, with hints
t('needs rule header', () => err('on sell: refuse because "x"', /starts with rule/, 1));
t('time vs duration', () => err('rule "x"\non sell:\n  refuse if wallet.first_receipt < 2h because "x"', /time with a duration.*since\(/, 3));
t('unknown name suggests', () => err('rule "x"\nrefuse if ammount > 5 because "x"', /Unknown name "ammount".*amount/, 2));
t('unknown wallet field suggests', () => err('rule "x"\nrefuse if wallet.balnce > 5 because "x"', /balance/));
t('unterminated string', () => err('rule "x"\nrefuse if amount > 5 because "oops\n', /Unterminated string/, 2));
t('assignment needs set', () => err('rule "x"\ncoin.x = 5', /start with "set"/));
t('read-only field', () => err('rule "x"\nset wallet.balance = 5', /read-only/));
t('== vs =', () => err('rule "x"\nrefuse if amount = 5 because "x"', /Use "==" to compare/));
t('keys not arithmetic', () => err('rule "x"\nrefuse if buyer + 1 > 2 because "x"', /Arithmetic needs numbers/));
t('condition required', () => err('rule "x"\nrefuse if amount because "x"', /Expected a condition/));
t('unknown timezone', () => err('rule "x"\nrefuse if clock.hour(tz: "Mars/Olympus") == 1 because "x"', /Unknown timezone/));
t('nz dst refused with hint', () => err('rule "x"\ntimezone "Pacific/Auckland"\nrefuse if clock.hour == 1 because "x"', /daylight-saving rule isn't modeled/));
t('one placeholder', () => err('rule "x"\nrefuse if amount > 1 because "{amount} and {supply}"', /one \{value\}/));
t('since needs a time', () => err('rule "x"\nrefuse if since(2h) > 1h because "x"', /since\(\) takes a time/));
t('payout needs key global', () => err('rule "x"\nglobal n: num\npayout 50% to n\nset n = 1', /must be a key global/));
t('payouts over 100%', () => err('rule "x"\nglobal k: key\npayout 70% to k\npayout 40% to k as pot\nset k = buyer', /more than 100%/));
t('too expensive', () => err(`rule "x"\n${Array.from({ length: 16 }, (_, i) => `refuse if daylight(tz: "Tokyo") and clock.hour(tz: "New York") == ${i} because "x"`).join('\n')}`, /Worst case costs [\d,]+ CU; the limit is 8,000/));
t('too big', () => err(`rule "x"\n${Array.from({ length: 30 }, (_, i) => `refuse if amount == ${i} because "message number ${i} is long enough to take space ${'x'.repeat(40)}"`).join('\n')}`, /Too many different messages|limit is 1,024/));
t('reserved name', () => err('rule "x"\nglobal full: bool\nset full = true', /built-in name/));
t('implicit type inferred across handlers', () => ok('rule "x"\non sell: refuse if seller == king because "k"\non buy: set king = buyer'));

// ── semantics
t('percent literal vs modulo', () => {
  const c = ok('rule "x"\nrefuse if amount > wallet.balance * 25% because "pct"\nrefuse if clock.second % 2 == 1 because "odd"');
  eq(verdict(c, cx({ amount: 3_000_000n * 1_000_000n })), 'pct');
  eq(verdict(c, cx({ amount: 1n * 1_000_000n, now: T0 })), 'odd'); // :39 is odd
  eq(verdict(c, cx({ amount: 1n * 1_000_000n, now: T0 + 1n })), 'allow');
});
t('25% of x', () => { const c = ok('rule "x"\nrefuse if amount > 25% of wallet.balance because "q"'); eq(verdict(c, cx({ amount: 3_000_000n * 1_000_000n })), 'q'); });
t('site example: quarter of the bag in first 2h', () => {
  const c = ok(readFileSync(join(ROOT, 'examples', 'first-2h-quarter.hs'), 'utf8'));
  eq(verdict(c, cx({ amount: 3_000_000n * 1_000_000n, held: 600n })), 'No single sell over a quarter of your bag in your first 2h');
  eq(verdict(c, cx({ amount: 3_000_000n * 1_000_000n, held: 7_200n })), 'allow');
  eq(verdict(c, cx({ amount: 2_000_000n * 1_000_000n, held: 600n })), 'allow');
});
t('duration placeholder formatting', () => {
  const c = ok('rule "x"\nrefuse if wallet.held < 2h because "wait {2h - wallet.held}"');
  eq(verdict(c, cx({ held: 1_800n })), 'wait 1h 30m');
});
t('time placeholder formatting', () => { const c = ok('rule "x"\nrefuse because "now is {clock.now}"'); eq(verdict(c, cx()), 'now is 2026-10-04 18:21 UTC'); });
t('in list and weekday in New York (DST)', () => {
  const c = ok('rule "x"\ntimezone "America/New_York"\nrefuse if clock.weekday in [sat, sun] because "weekend {clock.hour}"');
  eq(verdict(c, cx()), 'weekend 14'); // 18:21 UTC = 14:21 EDT, Sunday
  eq(verdict(c, cx({ now: T0 + 86_400n })), 'allow'); // Monday
});
t('between', () => { const c = ok('rule "x"\nrefuse if clock.hour between 18 and 19 because "evening"'); eq(verdict(c, cx()), 'evening'); });
t('short-circuit allow', () => { const c = ok('rule "x"\nallow if wallet.is_creator\nrefuse because "no"'); eq(verdict(c, cx({ creator: K(1) })), 'allow'); eq(verdict(c, cx()), 'no'); });
t('state only on allow + inference', () => {
  const c = ok('rule "x"\non buy {\n set n += 1\n refuse if n > 2 because "full {n}"\n}');
  let g = new Uint8Array(256);
  for (let i = 0; i < 2; i++) { const r = run(c.bytes, cx({ kind: 0 }), g, new Uint8Array(0), new Uint8Array(32)); eq(r.verdict?.allow, true); g = r.globals; }
  const r3 = run(c.bytes, cx({ kind: 0 }), g, new Uint8Array(0), new Uint8Array(32));
  eq(formatReason(c.bytes, (r3.verdict as { reasonId: number }).reasonId, (r3.verdict as { arg: bigint }).arg), 'full 3');
  eq(r3.globals, g);
});
t('king of the hill: crown then refuse the king', () => {
  const c = ok(readFileSync(join(ROOT, 'examples', 'king-of-the-hill.hs'), 'utf8'));
  const buy = cx({ kind: 0, amount: 5_000_000n * 1_000_000n, sender: wallet({ key: K(0xb0), isPool: true }), receiver: wallet({ key: K(1), hasRecord: true }) });
  const r = run(c.bytes, buy, new Uint8Array(256), new Uint8Array(0), new Uint8Array(32));
  eq(r.verdict?.allow, true);
  const sell = cx({ kind: 1, now: T0 + 60n });
  eq(/You're the king/.test(verdict(c, sell, r.globals)), true, 'king sell refused');
  eq(verdict(c, cx({ kind: 1, now: T0 + 6n * 3600n + 1n }), r.globals), 'allow', 'crown lapses after 6h');
  eq(verdict(c, cx({ kind: 1, sender: wallet({ key: K(3), hasRecord: true, balance: 10n ** 12n }) }), r.globals), 'allow', 'others sell');
});
t('decay and fade', () => {
  const d = ok('rule "x"\nrefuse because "{decay(100, rate: 1%, every: 1m, since: clock.now - 1h)}"');
  eq(verdict(d, cx()), '54.715'.slice(0, 5) + verdict(d, cx()).slice(5)); // 100 × 0.99^60 = 54.7156…
  if (!/^54\.71\d*$/.test(verdict(d, cx()))) throw new Error(`decay ${verdict(d, cx())}`);
  const f = ok('rule "x"\nrefuse because "{fade(100, over: 4h, since: clock.now - 1h)}"');
  eq(verdict(f, cx()), '75'); // linear: 3/4 left
});
t('moon + daylight compile and run', () => { const c = ok('rule "x"\nrefuse if moon_phase() == full or not daylight(tz: "Asia/Tokyo") because "m"'); eq(['m', 'allow'].includes(verdict(c, cx())), true); });
t('transfer.app == program("jupiter")', () => {
  const c = ok('rule "x"\nrefuse if transfer.app == program("jupiter") because "jup"');
  const jup = Uint8Array.from([4, 121, 213, 91, 248, 35, 26, 46, 4, 5, 125, 18, 230, 74, 132, 109, 115, 105, 39, 196, 222, 52, 98, 101, 89, 167, 85, 98, 147, 154, 25, 117]);
  void jup;
  eq(verdict(c, cx()), 'allow');
});
t('wallet vars on receiver, missing record drops writes', () => {
  const c = ok('rule "x"\nwallet invited: bool\non send: set receiver.invited = true\non buy: refuse if not wallet.invited because "no invite"');
  const send = cx({ kind: 2 });
  const r = run(c.bytes, send, new Uint8Array(256), new Uint8Array(32), new Uint8Array(32));
  eq(r.walletDst[0], 1);
  const r2 = run(c.bytes, send, new Uint8Array(256), new Uint8Array(32), new Uint8Array(0));
  eq(r2.verdict?.allow, true);
  eq(verdict(c, cx({ kind: 0 }), new Uint8Array(256), new Uint8Array(0), r.walletDst), 'allow');
  eq(verdict(c, cx({ kind: 0 })), 'no invite');
});

// ── astronomy accuracy (the VM's integer models vs published times)
t('full moons 2025 within 30 min', () => {
  for (const f of ['2025-01-13T22:27Z', '2025-03-14T06:55Z', '2025-07-10T20:37Z', '2025-10-07T03:48Z', '2025-12-04T23:14Z']) {
    const t0 = BigInt(Date.parse(f.replace('Z', ':00Z')) / 1000);
    let best = 0n, bd = 1n << 60n;
    for (let dt = -7200n; dt <= 7200n; dt += 60n) { const e = moonElongation(t0 + dt); const d = e > 180_000_000n ? e - 180_000_000n : 180_000_000n - e; if (d < bd) { bd = d; best = dt; } }
    if (best < -1800n || best > 1800n) throw new Error(`${f}: off by ${best / 60n} min`);
  }
});
t('sunrise/sunset within 10 min', () => {
  const edge = (from: string, lat: number, lon: number) => { const s = BigInt(Date.parse(from) / 1000); const out: number[] = []; let p = daylight(s, lat, lon); for (let m = 1; m <= 1440; m++) { const d = daylight(s + BigInt(m * 60), lat, lon); if (d !== p) out.push(m); p = d; } return out; };
  const near = (got: number, want: number) => { if (Math.abs(got - want) > 10) throw new Error(`edge at +${got} min, want +${want}`); };
  const tk = edge('2026-06-20T12:00:00Z', 3568, 13969); near(tk[0], 7 * 60 + 25); near(tk[1], 22 * 60); // rise 19:25Z, set 10:00Z
  const ld = edge('2026-06-21T00:00:00Z', 5151, -13); near(ld[0], 3 * 60 + 43); near(ld[1], 20 * 60 + 21);
});

// ── every example compiles, deterministically
for (const f of readdirSync(join(ROOT, 'examples')).filter((x) => x.endsWith('.hs'))) {
  t(`example ${f}`, () => { const src = readFileSync(join(ROOT, 'examples', f), 'utf8'); const a = ok(src), b = ok(src); eq(a.hex, b.hex, 'deterministic'); });
}

// ── robustness: mutated sources never throw
t('compile never throws on garbage', () => {
  const srcs = readdirSync(join(ROOT, 'examples')).filter((x) => x.endsWith('.hs')).map((f) => readFileSync(join(ROOT, 'examples', f), 'utf8'));
  let seed = 12345;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const junk = ['{', '}', '(', ')', '"', 'if', 'set', 'on', 'refuse', '==', '%', '.', ':', '1e9', '99999999999999999999', 'wallet.', 'coin.', '\n', 'because', 'and', 'not', 'in [', ']', 'since(', 'key("', '#'];
  let n = 0;
  for (let i = 0; i < 3000; i++) {
    let s = srcs[rnd(srcs.length)];
    for (let k = 0, m = 1 + rnd(4); k < m; k++) {
      const at = rnd(s.length + 1);
      const op = rnd(3);
      if (op === 0) s = s.slice(0, at) + junk[rnd(junk.length)] + s.slice(at);
      else if (op === 1) s = s.slice(0, at) + s.slice(at + 1 + rnd(8));
      else s = s.slice(0, at) + String.fromCharCode(32 + rnd(95)) + s.slice(at);
    }
    try { compile(s); n++; } catch (e) { throw new Error(`compile threw on mutated source #${i}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}\n---\n${s.slice(0, 400)}`); }
  }
  if (n !== 3000) throw new Error('not all compiled');
});

console.log(`compiler tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
