// In-place upgrade: coins armed and traded under the deployed build (fixtures/deployed-v1.so, sha256 1a78d1f9…, the
// devnet program as of 2026-10-04) keep working when the program is replaced by the current build at the same address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Fork, pct, soPath, stackPda, walletPda } from './harness.mjs';
import { decodeStack, decodeWallet } from '../js/layout.mjs';

const ok = (r, what) => assert.ok(r.ok, `${what}: ${r.err}\n${r.logs?.join('\n')}`);
const refused = (r, code, what) => assert.equal(r.code, code, `${what}: expected ${code}, got ${r.ok ? 'success' : r.err}`);
const V1 = new URL('./fixtures/deployed-v1.so', import.meta.url).pathname;

test('upgrade in place: Stacks, Wallet records and Scripts written by the deployed build keep working', async () => {
  const f = new Fork();
  f.loadEngine(V1);
  // Three coins under v1: wallet records, Stack-writing blocks (incl. the creator's launch bag), and a Hookscript.
  const c1 = f.coin(), c2 = f.coin(), c3 = f.coin();
  ok(f.initStack(c1, [{ id: 'hold-timer', params: { minutes: 60 } }, { id: 'sandwich-guard', params: { slots: 4 } }, { id: 'sell-cooldown', params: { minutes: 15 } }]), 'v1 init 1');
  const creator2 = f.holder(c2, { owner: c2.creator });
  ok(f.initStack(c2, [{ id: 'anti-bundle', params: { perSlot: 2, window: 10 } }, { id: 'circuit-breaker', params: { band: 20, window: 5 } }, { id: 'creator-vest', params: { cliff: 3, days: 30 } }]), 'v1 init 2');
  const koth = Buffer.from(readFileSync(new URL('./fixtures/koth.hex', import.meta.url), 'utf8').trim(), 'hex');
  ok(f.initStack(c3, [{ id: 'sell-cap', params: { pct: 1 } }, { id: 'custom', params: {} }], { script: koth }), 'v1 init 3');
  const a = f.holder(c1), b = f.holder(c1);
  ok(await f.buy(c1, a, 1_000_000n), 'v1 buy');
  ok(await f.buy(c2, creator2, pct(2)), 'v1 creator launch buy');
  const x = f.holder(c2, { record: false }), y = f.holder(c2, { record: false });
  ok(await f.buy(c2, x, 100n), 'v1 bundle buy 1 (creator buy was exempt)');
  const k = f.holder(c3), r = f.holder(c3);
  ok(await f.buy(c3, k, pct(1)), 'v1 king');
  const before = { s1: f.account(stackPda(c1.mint)).data, s2: f.account(stackPda(c2.mint)).data, w: f.account(walletPda(c1.mint, a.ata)).data };

  f.loadEngine(soPath());
  assert.notEqual(soPath(), V1);
  // Nothing was rewritten by the upgrade itself.
  assert.ok(f.account(stackPda(c1.mint)).data.equals(before.s1) && f.account(stackPda(c2.mint)).data.equals(before.s2) && f.account(walletPda(c1.mint, a.ata)).data.equals(before.w));
  // Coin 2: Anti-Bundle's slot counter from v1 carries on in the same slot; the launch bag recorded by v1 stays locked.
  refused(await f.buy(c2, y, 100n), 6002, 'third buy in the slot v1 counted');
  refused(await f.sell(c2, creator2, 1n), 6016, 'the v1 launch bag is still vesting');
  assert.equal(Buffer.from(decodeStack(f.account(stackPda(c2.mint)).data).slots[2].state, 'hex').readBigUInt64LE(0), pct(2));
  f.warp(2, 2);
  ok(await f.buy(c2, y, 100n), 'next slot');
  // Coin 1: the lot from v1 still settles; the record keeps counting.
  refused(await f.sell(c1, a, 1n), 6010, 'v1 lot still settling');
  refused(await f.sendTo(c1, a, b, 1n), 6010, 'no sends from the young lot');
  f.warp(3600 + 900, 2000);
  ok(await f.sell(c1, a, 500_000n), 'unlocks on the v1 schedule');
  refused(await f.sell(c1, a, 1n), 6009, 'cooldown from the sell just made');
  const w = decodeWallet(f.account(walletPda(c1.mint, a.ata)).data);
  assert.ok(w.buys === 1 && w.sells === 1 && w.bought === 1_000_000n && w.sold === 500_000n);
  // Coin 3: the v1 Script account and its globals keep running.
  refused(await f.sell(c3, k, 10n), 6128, 'the king crowned under v1 can\'t sell');
  ok(await f.buy(c3, r, pct(2)), 'a new king');
  ok(await f.sell(c3, k, 10n), 'the old king sells');
  // Old stacks have no Blocklist or Allowlist: their marks can't carry flags.
  assert.equal(f.setMark(c1, a.key.publicKey, 1).ok, false);
});
