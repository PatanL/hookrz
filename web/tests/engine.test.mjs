// Reference-engine vectors. The Rust hookrz_engine must agree with every case here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, budget } from '../src/engine/engine.js';
import { simulate, SUPPLY } from '../src/engine/sim.js';
import { BLOCKS, PRESETS, ENGINE } from '../src/data/blocks.js';

const base = { supply: SUPPLY, t: 3600, slot: 9000, hour: 15, progress: 0.5, priceAfter: 1, windowOpenPrice: 1, srcBefore: 0, dstAfter: 0,
  isCreatorSrc: false, isCreator: false, w: { lots: [], lastBuySlot: null, lastSellT: null, firstT: null }, slotBuys: 0, hourSold: 0, hasPass: true, gateBal: 1e9, blocked: false };
const ctx = (o) => ({ ...base, ...o, w: { ...base.w, ...(o.w ?? {}) } });

test('max wallet refuses a buy that ends above the cap, not one at it', () => {
  const st = [{ id: 'max-wallet', params: { pct: 2 } }];
  assert.equal(evaluate(st, ctx({ kind: 'buy', amount: 1, dstAfter: SUPPLY * 0.02 })).ok, true);
  const r = evaluate(st, ctx({ kind: 'buy', amount: 1, dstAfter: SUPPLY * 0.0201 }));
  assert.equal(r.ok, false); assert.equal(r.code, 0x1773);
});

test('snipe shield only applies inside the window and never to the creator launch buy', () => {
  const st = [{ id: 'snipe-shield', params: { window: 60, max: 0.3 } }];
  const big = SUPPLY * 0.01;
  assert.equal(evaluate(st, ctx({ kind: 'buy', amount: big, t: 10 })).ok, false);
  assert.equal(evaluate(st, ctx({ kind: 'buy', amount: big, t: 61 })).ok, true);
  assert.equal(evaluate(st, ctx({ kind: 'buy', amount: big, t: 0, isCreator: true })).ok, true);
});

test('hold timer locks only lots younger than the hold', () => {
  const st = [{ id: 'hold-timer', params: { minutes: 60 } }];
  const w = { lots: [{ t: 0, amt: 100 }, { t: 3500, amt: 50 }] };
  assert.equal(evaluate(st, ctx({ kind: 'sell', amount: 100, srcBefore: 150, t: 3700, w })).ok, true);
  assert.equal(evaluate(st, ctx({ kind: 'sell', amount: 101, srcBefore: 150, t: 3700, w })).ok, false);
});

test('first refusal in slot order wins', () => {
  const st = [{ id: 'sell-cap', params: { pct: 0.1 } }, { id: 'lock-in', params: { pct: 90 } }];
  const r = evaluate(st, ctx({ kind: 'sell', amount: SUPPLY * 0.01, srcBefore: SUPPLY * 0.02 }));
  assert.equal(r.refusedBy, 'sell-cap');
});

test('budget: presets fit the engine; crank-only stacks have no hook', () => {
  for (const p of PRESETS) { const b = budget(p.slots.map(([id]) => ({ id }))); assert.ok(b.ok, p.id); assert.ok(b.cu <= ENGINE.cuBudget); }
  const b = budget([{ id: 'buyback-burn' }, { id: 'lp-lock' }]);
  assert.equal(b.hasHook, false); assert.equal(b.cu, 0); assert.equal(b.route, 'any');
});

test('budget: seven blocks or a duplicate is an error', () => {
  const ids = BLOCKS.filter((b) => b.enforcedBy === 'hook').slice(0, 7).map((b) => ({ id: b.id }));
  assert.equal(budget(ids).ok, false);
  assert.equal(budget([{ id: 'max-wallet' }, { id: 'max-wallet' }]).ok, false);
});

test('every hook block has a unique error code and an error message', () => {
  const codes = BLOCKS.filter((b) => b.check).map((b) => b.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const b of BLOCKS.filter((x) => x.check)) assert.ok(b.error(Object.fromEntries(b.params.map((p) => [p.key, p.def])), base).length > 10, b.id);
});

test('simulation is deterministic and Fair Launch stops most bot trades', () => {
  const st = PRESETS.find((p) => p.id === 'fair-launch').slots.map(([id]) => ({ id }));
  const a = simulate(st, { seed: 7 }), b = simulate(st, { seed: 7 }), none = simulate([], { seed: 7 });
  assert.equal(a.landed, b.landed);
  assert.ok(a.botLanded < none.botLanded * 0.5);
  assert.equal(none.refused, 0);
});
