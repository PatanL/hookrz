// The site's Hookscript is the real toolchain (../hookscript bundled into src/vendor/hookscript.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as hs from '../src/vendor/hookscript.js';
import { runJob } from '../src/hookscript/jobs.js';
import { EXAMPLES } from '../src/hookscript/examples.js';

const HS = new URL('../../hookscript/', import.meta.url);

test('the bundle is up to date with ../hookscript (run `npm run hookscript` if not)', async (t) => {
  if (!existsSync(HS)) return t.skip('../hookscript is not checked out here');
  const { sourceHash } = await import('../scripts/bundle-hookscript.mjs');
  assert.equal(hs.SOURCE_HASH, sourceHash());
});

test('every suggested example drafts offline, compiles, fuzzes 10,000 trades and passes the honeypot check', async () => {
  const want = ['king-of-the-hill', 'invite', 'louder', 'quarter-bag'];
  for (const [i, ex] of EXAMPLES.entries()) {
    const d = await hs.draft(ex.text, { provider: 'heuristic', trades: 10_000 });
    assert.equal(d.ok, true, ex.label);
    assert.equal(d.template, want[i], ex.label);
    assert.equal(d.fuzz.trades, 10_000);
    assert.equal(d.fuzz.panics + d.fuzz.errors, 0);
    assert.equal(d.honeypot.ok, true, ex.label);
    assert.ok(d.bytes <= 1024 && d.cu <= 8000);
  }
});

test('no honeypot-shaped rule is ever suggested', () => {
  for (const ex of EXAMPLES) assert.doesNotMatch(ex.text, /bought (this|in the last)|no more than (you|they)/i, ex.label);
  const src = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js') && !f.includes('vendor'));
  for (const f of src) assert.doesNotMatch(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), /sell no more than you bought/i, f);
});

test('compile errors carry line and column; a honeypot fails the check the launch requires', async () => {
  const c = hs.compile('rule "x"\non sell:\n  refuse if wallet.first_receipt < 2h because "too soon"\n');
  assert.equal(c.ok, false);
  assert.equal(c.errors[0].line, 3);
  assert.ok(c.errors[0].col > 0 && c.errors[0].message);
  const trap = await runJob(hs, 'check', { source: 'rule "diamond hands only"\non sell: refuse because "No selling, ever"\n', trades: 2000 });
  assert.equal(trap.compile.ok, true);
  assert.equal(trap.check.honeypot.ok, false);
  const ok = await runJob(hs, 'check', { source: hs.EXAMPLES['king-of-the-hill'], trades: 10_000 });
  assert.equal(ok.check.trades, 10_000);
  assert.equal(ok.check.honeypot.ok, true);
});

test('the interpreter keeps King of the Hill state between transfers', () => {
  const code = hs.compile(hs.EXAMPLES['king-of-the-hill']).bytes;
  const w = new hs.World(1_791_216_000n);
  for (let i = 0; i < 3; i++) w.wallet(i);
  const t0 = 1_791_216_000n;
  assert.ok(hs.attempt(w, code, { kind: 'buy', from: 1, sol: 1 }, t0).result.verdict.allow);
  const sell = hs.attempt(w, code, { kind: 'sell', from: 1, tokens: w.wallet(1).balance / 2n }, t0 + 60n);
  assert.equal(sell.result.verdict.allow, false);
  assert.match(hs.formatReason(code, sell.result.verdict.reasonId, sell.result.verdict.arg), /king/i);
  assert.ok(hs.attempt(w, code, { kind: 'sell', from: 1, tokens: w.wallet(1).balance / 2n }, t0 + 7n * 3600n).result.verdict.allow);
});
