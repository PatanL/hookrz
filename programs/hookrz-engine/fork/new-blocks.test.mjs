// The six blocks added on 2026-10-04 (blocklist, allowlist-phase, seasoned-sells, outflow-cap, token-gate, chapters):
// a refusal and a pass for each, inside real Token-2022 transfers (LiteSVM). Run: npm test (in this folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fork, pct, stackPda, metasPda, markPda, T22 } from './harness.mjs';
import { decodeStack, decodeMark, hourSoldOf, gateOf } from '../js/layout.mjs';

const ok = (r, what) => assert.ok(r.ok, `${what}: ${r.err}\n${r.logs?.join('\n')}`);
const refused = (r, code, what) => assert.equal(r.code, code, `${what}: expected ${code}, got ${r.ok ? 'success' : r.err}`);
const BLOCKED = 1, PASS = 2;

test('blocklist: marked owners can\'t buy, sell, send or receive; the creator edits the list until it freezes (6006, 6143)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'blocklist', params: { lockAt: 'after 24h' } }]), 'init');
  // Marks are per owner: no wallet records needed.
  const a = f.holder(c, { record: false }), b = f.holder(c, { record: false });
  ok(await f.buy(c, a, 1000n), 'unmarked buy');
  const stranger = f.funded();
  assert.equal(f.setMark(c, b.key.publicKey, BLOCKED, stranger).ok, false, 'only the creator marks');
  assert.equal(f.setMark(c, b.key.publicKey, PASS).ok, false, 'no pass bit without Allowlist Phase');
  ok(f.setMark(c, b.key.publicKey, BLOCKED), 'the creator blocks b');
  const r = await f.buy(c, b, 10n);
  refused(r, 6006, 'blocked buy');
  assert.ok(r.logs.some((l) => l.includes('Error Code: Blocklisted. Error Number: 6006')), r.logs.join('\n'));
  refused(await f.sendTo(c, a, b, 10n), 6006, 'send to a blocked owner');
  ok(f.setMark(c, a.key.publicKey, BLOCKED), 'block a, who holds coins');
  refused(await f.sell(c, a, 10n), 6006, 'blocked sell');
  refused(await f.sendTo(c, a, f.holder(c, { record: false }), 10n), 6006, 'blocked send');
  ok(f.setMark(c, a.key.publicKey, 0), 'unblock a');
  ok(await f.sell(c, a, 10n), 'unblocked sell');
  const m = decodeMark(f.account(markPda(c.mint, b.key.publicKey)).data);
  assert.ok(m.blocked && !m.pass && Buffer.from(m.owner).equals(b.key.publicKey.toBuffer()) && Buffer.from(m.mint).equals(c.mint.toBuffer()));
  // The mark is per owner: every token account of b is blocked.
  refused(await f.buy(c, { ata: f.plainAccount(c, b.key.publicKey) }, 1n), 6006, 'any account of a blocked owner');
  f.warp(86_400);
  refused(f.setMark(c, a.key.publicKey, BLOCKED), 6143, 'the list froze 24h after launch');
  refused(f.setMark(c, b.key.publicKey, 0), 6143, 'and can\'t be emptied either');
  refused(await f.buy(c, b, 10n), 6006, 'b stays blocked');
  ok(await f.buy(c, a, 10n), 'a stays unblocked');
});

test('blocklist: "immediately" = the launch slot only; "at graduation" = while the hook is live', async () => {
  const f = new Fork();
  const c = f.coin();
  const x = f.holder(c, { record: false }), y = f.holder(c, { record: false });
  ok(f.send([f.initStackIx(c, [{ id: 'blocklist', params: { lockAt: 'immediately' } }]), f.setMarkIx(c, x.key.publicKey, BLOCKED)], [c.creator]), 'list written in the launch transaction');
  refused(await f.buy(c, x, 1n), 6006, 'x is blocked from the start');
  f.warp(1, 1);
  refused(f.setMark(c, y.key.publicKey, BLOCKED), 6143, 'frozen right after the launch slot');
  ok(await f.buy(c, y, 1n), 'y trades');
  const c2 = f.coin();
  ok(f.initStack(c2, [{ id: 'blocklist', params: { lockAt: 'at graduation' } }]), 'init (at graduation)');
  f.warp(60 * 86_400);
  ok(f.setMark(c2, x.key.publicKey, BLOCKED), 'still editable 60 days in');
  const x2 = f.holder(c2, { owner: x.key, record: false });
  refused(await f.buy(c2, x2, 1n), 6006, 'blocked');
});

test('allowlist-phase: only pass holders can buy while the phase is open (6007)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'allowlist-phase', params: { minutes: 30 } }]), 'init');
  const creator = f.holder(c, { owner: c.creator, record: false });
  ok(await f.buy(c, creator, 100n), 'the creator\'s buy in the launch slot is exempt');
  const a = f.holder(c, { record: false }), b = f.holder(c, { record: false });
  refused(await f.buy(c, a, 100n), 6007, 'no pass');
  assert.equal(f.setMark(c, a.key.publicKey, BLOCKED).ok, false, 'no blocked bit without Blocklist');
  ok(f.setMark(c, a.key.publicKey, PASS), 'the creator grants a pass');
  ok(await f.buy(c, a, 100n), 'pass holder buys');
  ok(await f.sendTo(c, a, b, 10n), 'sends are not gated');
  ok(await f.sell(c, a, 10n), 'sells are not gated');
  refused(await f.buy(c, b, 1n), 6007, 'b has no pass');
  f.warp(1, 1);
  refused(await f.buy(c, creator, 100n), 6007, 'after the launch slot the creator needs a pass too');
  f.warp(30 * 60);
  ok(await f.buy(c, b, 100n), 'after the phase anyone buys');
});

test('allowlist + blocklist share one mark per owner', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'blocklist', params: { lockAt: 'after 24h' } }, { id: 'allowlist-phase', params: { minutes: 60 } }]), 'init');
  const a = f.holder(c, { record: false });
  ok(f.setMark(c, a.key.publicKey, PASS | BLOCKED), 'pass and block');
  refused(await f.buy(c, a, 1n), 6006, 'blocklist runs first (slot order)');
  ok(f.setMark(c, a.key.publicKey, PASS), 'unblock, keep the pass');
  ok(await f.buy(c, a, 1n), 'pass holder buys');
  f.warp(86_400);
  ok(f.setMark(c, f.funded().publicKey, PASS), 'passes are never frozen');
  refused(f.setMark(c, a.key.publicKey, PASS | BLOCKED), 6143, 'blocking is frozen after 24h');
  ok(f.setMark(c, a.key.publicKey, 0), 'clearing a pass is not (the block bit is unchanged)');
});

test('seasoned-sells: one sell may take base% of the balance, +step% per hour since the first receipt (6013)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'seasoned-sells', params: { base: 20, step: 10 } }]), 'init');
  const a = f.holder(c);
  ok(await f.buy(c, a, 1_000_000n), 'buy');
  refused(await f.sell(c, a, 200_001n), 6013, 'over 20% in the first hour');
  ok(await f.sell(c, a, 200_000n), '20% of the balance');
  f.warp(3_600);
  refused(await f.sell(c, a, 240_001n), 6013, 'over 30% of 800,000 after 1h');
  ok(await f.sell(c, a, 240_000n), '30% after 1h');
  ok(await f.buy(c, a, 40_000n), 'a later buy does not reset the clock');
  f.warp(7 * 3_600);
  ok(await f.sell(c, a, 600_000n), 'the whole balance after 8h (20% + 8 × 10%)');
  const bare = f.holder(c, { record: false });
  refused(await f.buy(c, bare, 1n), 6141, 'the block keeps wallet records');
});

test('outflow-cap: total sold in the current hour, across all wallets (6014)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'outflow-cap', params: { pct: 1 } }]), 'init');
  const a = f.holder(c, { record: false }), b = f.holder(c, { record: false });
  ok(await f.buy(c, a, pct(2)), 'a buys');
  ok(await f.buy(c, b, pct(2)), 'b buys');
  ok(await f.sell(c, a, pct(0.6)), 'a sells 0.6%');
  refused(await f.sell(c, b, pct(0.4) + 1n), 6014, 'b would push the hour past 1%');
  ok(await f.sell(c, b, pct(0.4)), 'b sells up to the cap');
  refused(await f.sell(c, a, 1n), 6014, 'the hour is used up');
  ok(await f.sendTo(c, a, b, pct(0.5)), 'sends are not sells');
  ok(await f.buy(c, a, 1n), 'buys are not sells');
  const s = decodeStack(f.account(stackPda(c.mint)).data);
  assert.equal(hourSoldOf(s, 0), pct(1), 'hour 0 sold');
  f.warp(3_600);
  ok(await f.sell(c, a, pct(0.9)), 'a new hour');
  assert.equal(hourSoldOf(decodeStack(f.account(stackPda(c.mint)).data), 1), pct(0.9));
});

test('token-gate: buys and receives need the gate token in the receiver\'s ATA (6017)', async () => {
  const f = new Fork();
  const c = f.coin();
  const g = f.gateMint({ decimals: 5 });
  const slots = [{ id: 'token-gate', params: { ticker: '$BONK', min: 100, decimals: 5 } }]; // 100 tokens = 10,000,000 raw
  assert.equal(f.initStack(c, slots).ok, false, 'the gate mint account is required');
  assert.equal(f.initStack(c, slots, { gate: c.mint }).ok, false, 'a coin can\'t gate itself');
  assert.equal(f.initStack(c, slots, { gate: f.holder(c, { record: false }).ata }).ok, false, 'the gate must be a mint');
  ok(f.initStack(c, slots, { gate: g.mint }), 'init');
  const s = decodeStack(f.account(stackPda(c.mint)).data);
  assert.ok(s.hasGate && Buffer.from(gateOf(s).mint).equals(g.mint.toBuffer()) && gateOf(s).minRaw === 10_000_000n);
  const a = f.holder(c, { record: false }), b = f.holder(c, { record: false });
  refused(await f.buy(c, a, 100n), 6017, 'no gate token account');
  g.fund(a.key.publicKey, 9_999_999n);
  refused(await f.buy(c, a, 100n), 6017, 'one raw unit short');
  g.fund(a.key.publicKey, 1n);
  ok(await f.buy(c, a, 100n), 'holds the minimum');
  refused(await f.sendTo(c, a, b, 10n), 6017, 'the receiver needs the gate too');
  ok(await f.sell(c, a, 10n), 'sells need no gate');
  g.fund(b.key.publicKey, 10_000_000n);
  ok(await f.sendTo(c, a, b, 10n), 'gated receiver');
  // A Token-2022 gate mint works the same way.
  const c2 = f.coin();
  const g2 = f.gateMint({ decimals: 6, program: T22 });
  ok(f.initStack(c2, [{ id: 'token-gate', params: { ticker: '$X', min: 1, decimals: 6 } }], { gate: g2.mint }), 'init (Token-2022 gate)');
  const x = f.holder(c2, { record: false });
  refused(await f.buy(c2, x, 1n), 6017, 'no Token-2022 gate tokens');
  g2.fund(x.key.publicKey, 1_000_000n);
  ok(await f.buy(c2, x, 1n), 'Token-2022 gate held');
});

test('chapters: the wallet cap doubles with each slice of curve progress (6018)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'chapters', params: { n: 3, first: 0.5 } }]), 'init');
  const a = f.holder(c, { record: false });
  ok(await f.buy(c, a, pct(0.5)), 'chapter 1: 0.5%');
  refused(await f.buy(c, a, 1n), 6018, 'over the chapter-1 cap');
  f.setPool(c, { quoteReserve: c.threshold / 3n });
  refused(await f.buy(c, a, 1n), 6018, 'a hair under a third filled: still chapter 1');
  f.setPool(c, { quoteReserve: (c.threshold + 2n) / 3n });
  ok(await f.buy(c, a, pct(0.5)), 'chapter 2: 1%');
  refused(await f.buy(c, a, 1n), 6018, 'over 1%');
  f.setPool(c, { quoteReserve: c.threshold * 2n });
  ok(await f.buy(c, a, pct(1)), 'last chapter (3 of 3): 2%');
  refused(await f.buy(c, a, 1n), 6018, 'the last chapter caps too');
  ok(await f.sendTo(c, a, f.holder(c, { record: false }), pct(1)), 'sends are not capped');
  ok(await f.sell(c, a, pct(0.5)), 'sells are not capped');
});

test('every meta kind at once: marks and the gate ATA resolve after pool, wallets, script', async () => {
  const { readFileSync } = await import('node:fs');
  const f = new Fork();
  const c = f.coin();
  const g = f.gateMint({ decimals: 0 });
  const script = Buffer.from(readFileSync(new URL('./fixtures/koth.hex', import.meta.url), 'utf8').trim(), 'hex');
  ok(f.initStack(c, [
    { id: 'blocklist', params: { lockAt: 'at graduation' } }, { id: 'allowlist-phase', params: { minutes: 5 } },
    { id: 'token-gate', params: { ticker: '$G', min: 5, decimals: 0 } }, { id: 'chapters', params: { n: 2, first: 3 } },
    { id: 'outflow-cap', params: { pct: 20 } }, { id: 'custom', params: {} },
  ], { script, gate: g.mint }), 'init');
  const s = decodeStack(f.account(stackPda(c.mint)).data);
  assert.ok(s.hasPool && s.hasWallets && s.hasScript && s.hasMarks && s.hasGate && s.stackWritable);
  const metas = f.account(metasPda(c.mint)).data;
  assert.equal(metas.readUInt32LE(12), 11, 'stack, pool, 2 wallets, script, 2 marks, gate mint, token program, ATA program, gate ATA');
  const a = f.holder(c), b = f.holder(c);
  g.fund(a.key.publicKey, 5n);
  refused(await f.buy(c, a, 100n), 6007, 'no pass yet');
  ok(f.setMark(c, a.key.publicKey, PASS), 'pass');
  ok(await f.buy(c, a, pct(1)), 'pass + gate + chapter cap + script');
  refused(await f.sendTo(c, a, b, 1n), 6017, 'b holds no gate token');
  g.fund(b.key.publicKey, 5n);
  ok(f.setMark(c, b.key.publicKey, BLOCKED), 'block b');
  refused(await f.sendTo(c, a, b, 1n), 6006, 'blocked');
  ok(f.setMark(c, b.key.publicKey, 0), 'unblock b');
  ok(await f.sendTo(c, a, b, 1n), 'every meta resolved and passed (KotH lets the king send)');
});
