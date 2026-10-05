// Fee routing shared with the server (server/src/fees.ts re-exports src/engine/fees.js), the launch review's split,
// wallet-address checks, and when a Blocklist can still change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeRouting, feeSplit, splitView, validateShares, lpSplit } from '../src/engine/fees.js';
import { isAddress, parseAddresses } from '../src/core/address.js';
import { blocklistOpen } from '../src/api/client.js';
import { byId } from '../src/data/blocks.js';

const A = 'So11111111111111111111111111111111111111112';
const B = '6DKRZXJupVva5xrPPXUFcbPnmTMLq35df7xVs4nsDvJt';

test('no keeper rules: creator 50 / hookrz 50, the creator earns 0.4% of every trade (after the Meteora cut)', () => {
  const st = [{ id: 'max-wallet', params: { pct: 2 } }, { id: 'lp-lock', params: { pct: 100 } }];
  assert.deepEqual(feeSplit(st), { creatorTradingFeePercentage: 50, partnerLockedLpPct: 0, creatorLockedLpPct: 100, creatorLpPct: 0, keeperShareBps: 0 });
  const v = splitView(st);
  assert.equal(v.keeper, false);
  assert.equal(v.creatorPct, 0.4); // 50 points of the 0.8% left after Meteora's 20%
});

test('keeper rules route their share of the creator fees through the platform (server/STATUS.md table)', () => {
  const st = [{ id: 'holder-rewards', params: { pct: 20, min: 0.1 } }, { id: 'tithe', params: { pct: 10, to: B } }];
  const R = feeRouting(st);
  assert.equal(R.shareBps, 3000);
  assert.equal(R.creatorTradingFeePercentage, 35); // 50 − ⌈Σ/2⌉
  assert.equal(R.partnerLockedLpPct, 30); // ⌈Σ⌉% of the LP after graduation
  const v = splitView(st);
  assert.ok(Math.abs(v.creatorPct - 0.28) < 1e-12 && Math.abs(v.rulesPct - 0.12) < 1e-12 && Math.abs(v.platformPct - 0.4) < 1e-12);
  assert.equal(v.rules.find((r) => r.id === 'tithe').to, B);
  assert.equal(v.lpForRulesPct, 30);
  // an odd share rounds the routed points up; the keeper hands the half point back
  assert.equal(feeRouting([{ id: 'tithe', params: { pct: 7, to: B } }]).creatorTradingFeePercentage, 46);
});

test('Sniper Fee → Burn sets the creator share to 0 and the keeper pays the creator', () => {
  const st = [{ id: 'sniper-fee-burn', params: { start: 30, seconds: 60 } }, { id: 'tithe', params: { pct: 10, to: B } }];
  assert.equal(feeSplit(st).creatorTradingFeePercentage, 0);
  const v = splitView(st);
  assert.equal(v.creatorViaKeeper, true);
  assert.deepEqual(v.sniper, { startPct: 30, endPct: 1, seconds: 60 });
  assert.ok(Math.abs(v.creatorPct - 0.36) < 1e-12);
});

test('LP Lock and the rules\' locked share never lock less than LP Lock, and the server\'s split wins', () => {
  assert.deepEqual(lpSplit(100, 30), { partnerLocked: 30, creatorLocked: 70, creatorUnlocked: 0 });
  assert.deepEqual(lpSplit(10, 30), { partnerLocked: 30, creatorLocked: 0, creatorUnlocked: 70 });
  // a Hookscript payout only the server's compiled ABI knows: the remainder shows as the coin's own rule
  const v = splitView([{ id: 'custom', params: {} }], { split: { keeperShareBps: 5000, partnerLockedLpPct: 50, creatorTradingFeePercentage: 25 } });
  assert.equal(v.rules.length, 1);
  assert.equal(v.rules[0].label, 'Your own rule');
  assert.ok(Math.abs(v.creatorPct - 0.2) < 1e-12);
  assert.equal(v.lpForRulesPct, 50);
  assert.match(validateShares([{ id: 'tithe', params: { pct: 80 } }]), /between 1 and 50/);
});

test('the tithe address is a keeper-only param, and Token Gate offers only tokens with a mint', () => {
  assert.deepEqual(byId.tithe.params.map((p) => p.key), ['pct', 'to']);
  assert.equal(byId.tithe.enforcedBy, 'crank');
  assert.ok(!byId['token-gate'].params.find((p) => p.key === 'ticker').options.includes('$HOOKRZ'));
});

test('wallet addresses: 32 bytes of base58; a pasted list keeps the good ones and names the rest', () => {
  assert.ok(isAddress(A) && isAddress(B) && isAddress('11111111111111111111111111111111'));
  assert.ok(!isAddress('0x52908400098527886E0F7030069857D2E4169EE7'));
  assert.ok(!isAddress(B.slice(0, 40)) && !isAddress(`${B}l`) && !isAddress(''));
  const p = parseAddresses(`${A}\n${B}, ${A}\nnope`);
  assert.deepEqual(p.list, [A, B]);
  assert.deepEqual(p.bad, ['nope']);
  assert.equal(p.dup, 1);
});

test('a Blocklist stays open until graduation, for 24h, or only in the launch transaction', () => {
  const coin = (lockAt, o = {}) => ({ stack: [{ id: 'blocklist', params: { lockAt } }], launchTs: 1000, phase: 'curve', ...o });
  assert.equal(blocklistOpen(coin('at graduation'), 1e9), true);
  assert.equal(blocklistOpen(coin('at graduation', { phase: 'graduated' }), 2000), false);
  assert.equal(blocklistOpen(coin('after 24h'), 1000 + 86399), true);
  assert.equal(blocklistOpen(coin('after 24h'), 1000 + 86400), false);
  assert.equal(blocklistOpen(coin('immediately'), 1001), false);
  assert.equal(blocklistOpen({ stack: [], launchTs: 1000 }, 1001), false);
});
