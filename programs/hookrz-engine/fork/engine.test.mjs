// hookrz_engine inside real Token-2022 transfers (LiteSVM). Run: npm test (in this folder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransactionInstruction, Keypair } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { Fork, pct, ENGINE, T22, stackPda, metasPda, walletPda, SUPPLY } from './harness.mjs';
import { decodeStack, decodeWallet } from '../js/layout.mjs';

const ok = (r, what) => assert.ok(r.ok, `${what}: ${r.err}\n${r.logs?.join('\n')}`);
const refused = (r, code, what) => assert.equal(r.code, code, `${what}: expected ${code}, got ${r.ok ? 'success' : r.err}`);

test('init_stack: creator only, once, valid params, hook named with the DBC authority', () => {
  const f = new Fork();
  const c = f.coin();
  const stranger = f.funded();
  const slots = [{ id: 'max-wallet', params: { pct: 2 } }];
  assert.equal(f.send([f.initStackIx(c, slots, { signer: stranger.publicKey })], [stranger]).ok, false, 'a stranger arms the stack');
  assert.equal(f.initStack(c, [{ id: 'max-wallet', params: { pct: 20 } }]).ok, false, 'max-wallet 20% is out of range');
  assert.equal(f.initStack(c, [{ id: 'max-wallet', params: { pct: 2 } }, { id: 'max-wallet', params: { pct: 3 } }]).ok, false, 'duplicate block');
  assert.equal(f.initStack(c, [{ id: 'trading-hours', params: { open: 20, close: 9 } }]).ok, false, 'empty session');
  assert.equal(f.initStack(c, [{ id: 'custom', params: {} }]).ok, false, 'a Custom slot without a script');
  ok(f.initStack(c, slots), 'creator init');
  refused(f.initStack(c, slots), 6143, 're-init');
  const s = decodeStack(f.account(stackPda(c.mint)).data);
  assert.equal(s.slots.length, 1);
  assert.equal(s.slots[0].block, 'max-wallet');
  assert.ok(Buffer.from(s.creator).equals(c.creator.publicKey.toBuffer()));
  assert.ok(Buffer.from(s.baseVault).equals(c.vault.toBuffer()));
  assert.equal(s.migrationQuoteThreshold, c.threshold);
  // A mint whose hook authority isn't the DBC pool authority (could swap the hook out) is refused.
  const c2 = f.coin({ hookAuthority: Keypair.generate().publicKey });
  assert.equal(f.initStack(c2, slots).ok, false, 'foreign hook authority');
});

test('C1: Execute outside a transfer of this mint is refused with 6000', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'hold-timer', params: { minutes: 60 } }]), 'init');
  const a = f.holder(c), b = f.holder(c);
  ok(await f.buy(c, a, 1000n), 'buy');
  const ix = await f.transferIx(c, a.ata, b.ata, a.key.publicKey, 1n);
  // Same accounts Token-2022 would pass to the hook, called directly: source isn't transferring.
  const hookKeys = [ix.keys[0], ix.keys[1], ix.keys[2], ix.keys[3], ...ix.keys.slice(4).filter((k) => !k.pubkey.equals(ENGINE))].map((k) => ({ ...k, isSigner: false }));
  const data = Buffer.alloc(16);
  Buffer.from([105, 37, 101, 197, 75, 251, 102, 26]).copy(data);
  data.writeBigUInt64LE(1n, 8);
  const metaIdx = hookKeys.findIndex((k) => k.pubkey.equals(metasPda(c.mint)));
  const ordered = [...hookKeys.slice(0, 4), hookKeys[metaIdx], ...hookKeys.filter((_, i) => i > 3 && i !== metaIdx)];
  const r = f.send([new TransactionInstruction({ programId: ENGINE, keys: ordered, data })], [f.payer]);
  refused(r, 6000, 'direct execute');
});

test('classification: buys, sells and sends; snipe shield and the creator launch buy', async () => {
  const f = new Fork();
  const c = f.coin();
  const creator = f.holder(c, { owner: c.creator });
  ok(f.initStack(c, [{ id: 'snipe-shield', params: { window: 60, max: 0.3 } }]), 'init');
  ok(await f.buy(c, creator, pct(1)), 'creator launch buy in the launch slot is exempt');
  const a = f.holder(c), b = f.holder(c);
  refused(await f.buy(c, a, pct(0.31)), 6001, 'sniper');
  ok(await f.buy(c, a, pct(0.3)), 'at the cap');
  f.warp(5);
  refused(await f.buy(c, creator, pct(1)), 6001, 'creator after the launch slot is not exempt');
  ok(await f.sendTo(c, a, b, pct(0.3)), 'send is not a buy');
  ok(await f.sell(c, b, pct(0.3)), 'sell is not a buy');
  f.warp(60);
  ok(await f.buy(c, a, pct(1)), 'after the window');
});

test('anti-bundle: per-slot buy limit inside the window', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'anti-bundle', params: { perSlot: 2, window: 10 } }]), 'init');
  const hs = [f.holder(c), f.holder(c), f.holder(c)];
  f.warp(1, 1);
  ok(await f.buy(c, hs[0], 100n), 'buy 1');
  ok(await f.buy(c, hs[1], 100n), 'buy 2');
  refused(await f.buy(c, hs[2], 100n), 6002, 'buy 3 in the same slot');
  ok(await f.sendTo(c, hs[0], hs[2], 1n), 'sends are not counted');
  f.warp(1, 1);
  ok(await f.buy(c, hs[2], 100n), 'next slot');
  f.warp(600);
  for (const h of hs) ok(await f.buy(c, h, 100n), 'after the window');
});

test('max-wallet and rising-max', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'rising-max', params: { from: 0.5, to: 5, hours: 12 } }]), 'init');
  const a = f.holder(c), b = f.holder(c);
  ok(await f.buy(c, a, pct(0.5)), 'at the starting cap');
  refused(await f.buy(c, a, 1n), 6004, 'one unit over');
  f.warp(6 * 3600);
  ok(await f.buy(c, a, pct(2.25)), 'cap is 2.75% at 6h');
  refused(await f.buy(c, a, 1n), 6004, 'over 2.75%');
  ok(await f.buy(c, b, pct(1)), 'b buys 1%');
  refused(await f.sendTo(c, a, b, pct(2)), 6004, 'a send that leaves b at 3% also counts');
  ok(await f.sell(c, a, pct(2.75)), 'sells are exempt (the vault)');
});

test('sandwich-guard, sell-cap, sell-cooldown', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'sandwich-guard', params: { slots: 4 } }, { id: 'sell-cap', params: { pct: 1 } }, { id: 'sell-cooldown', params: { minutes: 15 } }]), 'init');
  const a = f.holder(c);
  ok(await f.buy(c, a, pct(3)), 'buy');
  f.warp(1, 3);
  refused(await f.sell(c, a, 100n), 6005, 'sell 3 slots after the buy');
  f.warp(1, 1);
  refused(await f.sell(c, a, pct(1) + 1n), 6008, 'sell over 1%');
  ok(await f.sell(c, a, pct(1)), 'sell 1%');
  f.warp(15 * 60 - 1);
  refused(await f.sell(c, a, 100n), 6009, 'cooldown');
  f.warp(1);
  ok(await f.sell(c, a, 100n), 'after the cooldown');
  const w = decodeWallet(f.account(walletPda(c.mint, a.ata)).data);
  assert.ok(w.hasBought && w.hasSold && w.hasReceived);
});

test('hold-timer: lots, dust never extends an earlier lock (H1), missing records (6141)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'hold-timer', params: { minutes: 60 } }]), 'init');
  const a = f.holder(c), dusty = f.holder(c), b = f.holder(c);
  ok(await f.buy(c, dusty, 1000n), 'attacker buys');
  f.warp(2 * 3600);
  const t0 = f.now().unix;
  ok(await f.buy(c, a, 1_000_000n), 'buy');
  refused(await f.sell(c, a, 1n), 6010, 'sell right away');
  refused(await f.sendTo(c, a, b, 1n), 6010, 'send right away');
  // The attacker sends 1 raw unit every 10 minutes until the first lot unlocks.
  const launch = decodeStack(f.account(stackPda(c.mint)).data).launchTs;
  const lotT = decodeWallet(f.account(walletPda(c.mint, a.ata)).data).lots.find((l) => l.amount > 0n).t;
  const unlock = launch + BigInt(lotT) + 3600n;
  for (let i = 0; i < 9 && f.now().unix + 600n < unlock; i++) { f.warp(600); ok(await f.sendTo(c, dusty, a, 1n), 'dust'); }
  f.setTime(unlock, f.now().slot + 100n);
  ok(await f.sell(c, a, 1_000_000n), 'the bought coins unlock on time');
  assert.ok(f.now().unix - t0 <= 3600n + 900n, 'unlocks within hold + hold/4');
  refused(await f.sell(c, a, 1n), 6010, 'only the dust is still settling');
  // A receiver without a record can't get coins while the stack keeps wallet records.
  const bare = f.holder(c, { record: false });
  refused(await f.buy(c, bare, 1n), 6141, 'buy into an account without a record');
  refused(await f.sendTo(c, b, bare, 0n), 6141, 'send to an account without a record');
});

test('circuit-breaker: post-trade sqrt price within ±band of the window open (L1 pool checks)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'circuit-breaker', params: { band: 20, window: 5 } }]), 'init');
  const a = f.holder(c);
  const s0 = 1n << 64n;
  const sqrtOf = (ratio) => { const x = s0 * s0 * BigInt(Math.round(ratio * 1e6)) / 1_000_000n; let r = x, y = (r + 1n) / 2n; while (y < r) { r = y; y = (r + x / r) / 2n; } return r; };
  f.setPool(c, { sqrt: sqrtOf(1.21) });
  refused(await f.buy(c, a, 100n), 6011, '+21%');
  f.setPool(c, { sqrt: sqrtOf(1.19) });
  ok(await f.buy(c, a, 100n), '+19%');
  f.setPool(c, { sqrt: sqrtOf(1.25) });
  refused(await f.buy(c, a, 100n), 6011, 'still against the window open');
  f.setPool(c, { sqrt: sqrtOf(1.0) });
  ok(await f.sendTo(c, a, f.holder(c), 1n), 'sends ignore the breaker');
  f.warp(301);
  f.setPool(c, { sqrt: sqrtOf(1.19 * 1.19) });
  ok(await f.buy(c, a, 100n), 'a new window opens at the last trade price (1.19)');
  f.setPool(c, { sqrt: sqrtOf(0.79) });
  refused(await f.sell(c, a, 100n), 6011, 'dump > 20% below the window open');
  // L1: a pool that no longer names this mint at its offset is refused.
  const p = f.account(c.pool);
  p.data.fill(7, 136, 168);
  f.setAccount(c.pool, p.owner, p.data, p.lamports);
  f.setPool(c, { sqrt: sqrtOf(1.4161) });
  assert.equal((await f.buy(c, a, 100n)).ok, false, 'pool with a foreign base mint');
});

test('trading-hours and lock-in', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'trading-hours', params: { open: 13, close: 21 } }, { id: 'lock-in', params: { pct: 25 } }]), 'init');
  const a = f.holder(c), b = f.holder(c);
  const day = f.now().unix - (f.now().unix % 86400n);
  f.setTime(day + 12n * 3600n + 3599n);
  refused(await f.buy(c, a, 1000n), 6012, '12:59 UTC');
  f.setTime(day + 13n * 3600n);
  ok(await f.buy(c, a, 1000n), '13:00 UTC');
  f.setPool(c, { quoteReserve: c.threshold / 4n - 1n });
  refused(await f.sell(c, a, 10n), 6015, 'curve under 25%');
  f.setPool(c, { quoteReserve: c.threshold / 4n });
  ok(await f.sell(c, a, 10n), 'curve at 25%');
  f.setTime(day + 21n * 3600n);
  refused(await f.sell(c, a, 10n), 6012, '21:00 UTC');
  ok(await f.sendTo(c, a, b, 10n), 'sends work after hours');
});

test('creator-vest: the launch bag is locked until the cliff, then unlocks in a straight line; later buys are free', async () => {
  const f = new Fork();
  const c = f.coin();
  const creator = f.holder(c, { owner: c.creator });
  const other = f.holder(c);
  ok(f.initStack(c, [{ id: 'creator-vest', params: { cliff: 3, days: 30 } }]), 'init');
  ok(await f.buy(c, creator, pct(2)), 'launch buy');
  ok(await f.buy(c, creator, pct(0.5)), 'a second buy in the launch slot joins the bag');
  const st = decodeStack(f.account(stackPda(c.mint)).data).slots[0].state;
  assert.equal(Buffer.from(st, 'hex').readBigUInt64LE(0), pct(2.5), 'launch bag recorded');
  f.warp(10);
  ok(await f.buy(c, creator, pct(1)), 'a later buy (not vested)');
  refused(await f.sell(c, creator, pct(1) + 1n), 6016, 'dipping into the bag before the cliff');
  ok(await f.sell(c, creator, pct(1)), 'the later coins are free');
  refused(await f.sendTo(c, creator, other, 1n), 6016, 'no sends from the bag before the cliff');
  const plain = f.plainAccount(c, c.creator.publicKey);
  refused(await f.buy(c, { ata: plain }, 1n), 6016, 'a creator account whose owner can change');
  const launch = decodeStack(f.account(stackPda(c.mint)).data).launchTs;
  f.setTime(launch + 3n * 86400n + 15n * 86400n, f.now().slot + 1000n); // halfway down the line
  ok(await f.sell(c, creator, pct(1.25)), 'half the bag is vested');
  refused(await f.sell(c, creator, 1n), 6016, 'the other half is not');
  f.setTime(launch + 33n * 86400n, f.now().slot + 1000n);
  ok(await f.sell(c, creator, pct(1.25)), 'fully vested');
});

test('sandwich-guard: a send passes the sender\'s last buy to the receiver (no buy → send → sell)', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'sandwich-guard', params: { slots: 10 } }]), 'init');
  const a = f.holder(c), b = f.holder(c);
  ok(await f.buy(c, a, pct(1)), 'front-run buy');
  ok(await f.sendTo(c, a, b, pct(1)), 'send to a second account');
  refused(await f.sell(c, b, pct(1)), 6005, 'sell from the second account in the same window');
  const w = decodeWallet(f.account(walletPda(c.mint, b.ata)).data);
  assert.ok(w.hasBought && w.buys === 0, 'tainted, not counted as a buy');
  f.warp(5, 10);
  ok(await f.sell(c, b, pct(1)), 'after the lockout');
});

test('close: refused while the hook is live (6142), then rent goes back', async () => {
  const f = new Fork();
  const c = f.coin();
  ok(f.initStack(c, [{ id: 'hold-timer', params: { minutes: 60 } }]), 'init');
  const a = f.holder(c);
  ok(await f.buy(c, a, 1000n), 'buy');
  const cranker = f.funded();
  refused(f.send([f.closeWalletIx(c, a.ata, f.payer.publicKey)], [cranker]), 6142, 'close wallet while live');
  refused(f.send([f.closeStackIx(c, c.creator.publicKey)], [cranker]), 6142, 'close stack while live');
  f.retireHook(c);
  assert.equal(f.send([f.closeWalletIx(c, a.ata, cranker.publicKey)], [cranker]).ok, false, 'rent to someone else');
  const before = f.account(f.payer.publicKey).lamports;
  ok(f.send([f.closeWalletIx(c, a.ata, f.payer.publicKey)], [cranker]), 'close wallet after graduation');
  assert.ok(f.account(f.payer.publicKey).lamports > before, 'payer refunded');
  assert.equal(f.account(walletPda(c.mint, a.ata)), null);
  const cb = f.account(c.creator.publicKey).lamports;
  ok(f.send([f.closeStackIx(c, c.creator.publicKey)], [cranker]), 'close stack after graduation');
  assert.ok(f.account(c.creator.publicKey).lamports > cb, 'creator refunded');
  assert.equal(f.account(stackPda(c.mint)), null);
  assert.equal(f.account(metasPda(c.mint)), null);
  ok(await f.sendTo(c, a, f.holder(c, { record: false }), 1n), 'the coin moves freely after graduation');
});

test('hookscript reads the DBC fee schedule (linear, by timestamp)', async () => {
  const { readFileSync } = await import('node:fs');
  const f = new Fork();
  const cliff = 500_000_000n, end = 10_000_000n;
  const c = f.coin({ feeSchedule: { cliff, frequency: 1n, reduction: (cliff - end) / 60n, periods: 60 } });
  const script = Buffer.from(readFileSync(new URL('./fixtures/feegate.hex', import.meta.url), 'utf8').trim(), 'hex');
  ok(f.initStack(c, [{ id: 'custom', params: {} }], { script }), 'init');
  const a = f.holder(c);
  const r = await f.buy(c, a, 100n);
  refused(r, 6128, 'fee 50% at launch');
  assert.ok(r.logs.some((l) => l.includes('The sniper fee is still above 10%')));
  f.warp(48); // 48 periods: 50% − 48 × 0.8167% ≈ 10.8%
  refused(await f.buy(c, a, 100n), 6128, 'fee still above 10%');
  f.warp(2); // 50 periods ≈ 9.2%
  ok(await f.buy(c, a, 100n), 'fee under 10%');
});

test('pre-funded PDAs (M1) are still created', async () => {
  const f = new Fork();
  const c = f.coin();
  for (const pk of [stackPda(c.mint), metasPda(c.mint)]) f.svm.airdrop((await import('@solana/kit')).address(pk.toBase58()), (await import('@solana/kit')).lamports(1_000_000n));
  ok(f.initStack(c, [{ id: 'hold-timer', params: { minutes: 60 } }]), 'init over pre-funded addresses');
  const k = f.funded();
  const ata = spl.getAssociatedTokenAddressSync(c.mint, k.publicKey, false, T22);
  ok(f.send([spl.createAssociatedTokenAccountIdempotentInstruction(f.payer.publicKey, ata, k.publicKey, c.mint, T22)], [f.payer]), 'ata');
  f.svm.airdrop((await import('@solana/kit')).address(walletPda(c.mint, ata).toBase58()), (await import('@solana/kit')).lamports(900_000n));
  ok(f.send([f.openWalletIx(c, ata, f.payer.publicKey)], [f.payer]), 'open over a pre-funded record');
  ok(f.send([f.openWalletIx(c, ata, f.payer.publicKey)], [f.payer]), 'open is idempotent');
  ok(await f.buy(c, { key: k, ata }, 5n), 'buy');
  assert.equal(SUPPLY - f.balance(c.vault), 5n);
});

test('hookscript: King of the Hill refuses the king\'s sell (6128); globals and wallet vars persist', async () => {
  const { readFileSync } = await import('node:fs');
  const { decodeScript } = await import('../js/layout.mjs');
  const { scriptPda } = await import('./harness.mjs');
  const f = new Fork();
  const c = f.coin();
  const script = Buffer.from(readFileSync(new URL('./fixtures/koth.hex', import.meta.url), 'utf8').trim(), 'hex');
  const bad = Buffer.from(script);
  bad[8] ^= 1; // gas_max no longer matches verify
  refused(f.initStack(c, [{ id: 'custom', params: {} }], { script: bad }), 6128, 'a script that fails verify');
  ok(f.initStack(c, [{ id: 'sell-cap', params: { pct: 1 } }, { id: 'custom', params: {} }], { script }), 'init with a script');
  const a = f.holder(c), b = f.holder(c);
  ok(await f.buy(c, a, pct(1)), 'a buys 1% and takes the crown');
  const r = await f.sell(c, a, 10n);
  refused(r, 6128, 'the king sells');
  assert.ok(r.logs.some((l) => l.includes("Hookscript: The king can't sell while wearing the crown")), r.logs.join('\n'));
  ok(await f.sendTo(c, a, b, 10n), 'the king may send');
  ok(await f.buy(c, b, pct(0.5)), 'a smaller buy');
  ok(await f.sell(c, b, 10n), 'b is not the king');
  ok(await f.buy(c, b, pct(2)), 'b takes the crown');
  ok(await f.sell(c, a, 10n), 'a, dethroned, sells');
  refused(await f.sell(c, b, 10n), 6128, 'the new king sells');
  refused(await f.sell(c, b, pct(1.5)), 6008, 'blocks run before the script');
  const g = decodeScript(f.account(scriptPda(c.mint)).data).globals;
  assert.ok(Buffer.from(g.slice(0, 32)).equals(b.key.publicKey.toBuffer()), 'king in globals');
  const vars = (h) => Buffer.from(decodeWallet(f.account(walletPda(c.mint, h.ata)).data).scriptVars).readInt32LE(0);
  assert.equal(vars(a), 1);
  assert.equal(vars(b), 2);
  const w = decodeWallet(f.account(walletPda(c.mint, b.ata)).data);
  assert.equal(w.buys, 2);
  assert.equal(w.bought, pct(2.5));
  assert.equal(w.sells, 1);
});

test('write_script: a big script is staged in chunks by the creator, sealed by init_stack, then immutable', async () => {
  const { readFileSync } = await import('node:fs');
  const f = new Fork();
  const c = f.coin();
  const script = Buffer.from(readFileSync(new URL('./fixtures/koth.hex', import.meta.url), 'utf8').trim(), 'hex');
  const stranger = f.funded();
  assert.equal(f.send([f.writeScriptIx(c, script, 0, 60, stranger.publicKey)], [stranger]).ok, false, 'only the pool creator stages');
  ok(f.send([f.writeScriptIx(c, script, 0, 60)], [c.creator]), 'chunk 1');
  ok(f.send([f.writeScriptIx(c, script, 60, script.length - 60)], [c.creator]), 'chunk 2');
  ok(f.initStack(c, [{ id: 'custom', params: {} }], { staged: true }), 'init with the staged script');
  refused(f.send([f.writeScriptIx(c, script, 0, 10)], [c.creator]), 6143, 'no edits after init');
  const a = f.holder(c);
  ok(await f.buy(c, a, pct(1)), 'buy');
  refused(await f.sell(c, a, 1n), 6128, 'the staged King of the Hill runs');
  // init_stack with the staged flag but nothing staged is refused.
  const c2 = f.coin();
  assert.equal(f.initStack(c2, [{ id: 'custom', params: {} }], { staged: true }).ok, false);
});
