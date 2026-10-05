// Reference semantics of the `hookrz_engine` transfer hook, in JavaScript.
// The site uses it for the configurator budget, the simulator, quotes and the live feeds.
// The Rust program will share test vectors with this file (tests/engine.test.mjs), so the
// UI never promises a verdict the chain wouldn't give.
import { byId, ENGINE, rentSol, defaults } from '../data/blocks.js';

/** Which extra accounts each hook block needs; the engine adds the union to ExtraAccountMetaList. */
const NEEDS = {
  'circuit-breaker': ['pool'], 'lock-in': ['pool'], 'chapters': ['pool'],
  'blocklist': ['blockSrc', 'blockDst'], 'token-gate': ['gateMint', 'gateAta'], 'allowlist-phase': ['passDst'],
  'custom': ['pool', 'script'],
};
const ACCOUNT_LABEL = {
  stack: 'Stack PDA ["stack", mint]', pool: 'Meteora DBC pool (read-only price + progress)',
  walletSrc: 'Wallet record of sender ["w", mint, source]', walletDst: 'Wallet record of receiver ["w", mint, destination]',
  blockSrc: 'Block marker of sender ["block", mint, owner]', blockDst: 'Block marker of receiver ["block", mint, owner]',
  gateMint: 'Gate token mint', gateAta: 'Receiver\'s gate-token account (ATA derived from destination owner)',
  passDst: 'Allowlist pass of receiver ["pass", mint, owner]',
  script: 'Hookscript account ["script", mint]: bytecode + the coin\'s script state',
};

/** stack: [{ id, params }] -> normalized slots with defaults filled in */
export function normalize(stack) {
  return stack.filter((s) => byId[s.id]).map((s) => ({ id: s.id, params: { ...defaults(s.id), ...(s.params ?? {}) } }));
}

/** Cost and compatibility of a stack, exactly what POST /v1/stacks/validate returns. */
export function budget(stackIn) {
  const stack = normalize(stackIn);
  const blocks = stack.map((s) => byId[s.id]);
  const hooks = blocks.filter((b) => b.enforcedBy === 'hook');
  const hasHook = hooks.length > 0;
  const accounts = new Set(hasHook ? ['stack'] : []);
  for (const b of hooks) {
    if (b.state === 'wallet') { accounts.add('walletSrc'); accounts.add('walletDst'); }
    for (const a of NEEDS[b.id] ?? []) accounts.add(a);
  }
  const cu = hasHook ? ENGINE.cuBase + hooks.reduce((a, b) => a + b.cu, 0) : 0;
  const walletRecords = accounts.has('walletDst');
  const extra = accounts.size;
  const metaBytes = 8 + 4 + extra * 35;
  const rent = (hasHook ? rentSol(ENGINE.stackBytes) + rentSol(metaBytes) : 0);
  const warnings = [];
  const ids = stack.map((s) => s.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) warnings.push({ level: 'error', text: `${byId[dupes[0]].name} is in the stack twice.` });
  if (stack.length > ENGINE.maxSlots) warnings.push({ level: 'error', text: `A stack holds ${ENGINE.maxSlots} blocks at most.` });
  if (cu > ENGINE.cuBudget) warnings.push({ level: 'error', text: `The stack needs ${cu.toLocaleString()} CU per transfer; the engine allows ${ENGINE.cuBudget.toLocaleString()}.` });
  if (extra > ENGINE.maxExtraAccounts + 1) warnings.push({ level: 'error', text: `Too many extra accounts (${extra}); remove a block that reads other accounts.` });
  if (ids.includes('max-wallet') && ids.includes('rising-max')) warnings.push({ level: 'warn', text: 'Max Wallet and Rising Max Wallet overlap; the tighter cap wins on every transfer.' });
  if (ids.includes('max-wallet') && ids.includes('chapters')) warnings.push({ level: 'warn', text: 'Chapters already caps wallets; Max Wallet only matters once the last chapter opens.' });
  for (const b of blocks) if (b.risk) warnings.push({ level: 'risk', text: `${b.name}: ${b.risk}` });
  if (blocks.some((b) => b.power)) warnings.push({ level: 'warn', text: 'Blocklist gives the creator a power over holders. It is shown on the coin page and freezes on schedule.' });
  if (blocks.some((b) => b.unreviewed)) warnings.push({ level: 'warn', text: 'Custom blocks carry an "unreviewed" badge until a reviewer signs off on the Hookscript.' });
  if (walletRecords) warnings.push({ level: 'info', text: 'Wallet records: a new holder needs a record (~' + rentSol(ENGINE.walletRecordBytes).toFixed(4) + ' SOL rent, refunded after graduation). The hookrz router opens it inside the buy; aggregator routes work once it exists.' });
  if (!hasHook && stack.length) warnings.push({ level: 'info', text: 'No hook blocks: the mint gets no transfer hook, so it trades on every route with no extra accounts.' });
  return {
    slots: stack.length, maxSlots: ENGINE.maxSlots,
    hasHook, cu, cuBudget: ENGINE.cuBudget,
    accounts: [...accounts].map((k) => ({ key: k, label: ACCOUNT_LABEL[k] })), maxAccounts: ENGINE.maxExtraAccounts + 1,
    rentSol: rent, walletRecordRentSol: walletRecords ? rentSol(ENGINE.walletRecordBytes) : 0,
    route: walletRecords ? 'record' : 'any',
    enforcers: [...new Set(blocks.flatMap((b) => [b.enforcedBy, b.also].filter(Boolean)))],
    ok: !warnings.some((w) => w.level === 'error'),
    warnings,
  };
}

/**
 * Run the stack's hook blocks against one transfer, in slot order; the first refusal wins
 * (that's the custom error the transaction fails with).
 * ctx: { kind:'buy'|'sell'|'send', amount, supply, t, slot, hour, progress, priceAfter, windowOpenPrice,
 *        srcBefore, dstAfter, isCreatorSrc, w:{lots,lastBuySlot,lastSellT,firstT}, slotBuys, hourSold, hasPass, gateBal, blocked }
 */
export function evaluate(stackIn, ctx) {
  const stack = normalize(stackIn);
  const verdicts = [];
  for (const s of stack) {
    const b = byId[s.id];
    if (!b.check) continue;
    const refused = !!b.check(ctx, s.params);
    verdicts.push({ id: b.id, ok: !refused });
    if (refused) return { ok: false, verdicts, refusedBy: b.id, code: b.code, message: b.error(s.params, ctx) };
  }
  return { ok: true, verdicts };
}

/** Largest amount (tokens) of `kind` that passes, by bisection over evaluate(). ctxFor(amount) builds the ctx. */
export function largestAllowed(stack, ctxFor, hi) {
  if (evaluate(stack, ctxFor(hi)).ok) return hi;
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate(stack, ctxFor(mid)).ok) lo = mid; else hi = mid;
  }
  return lo;
}

/** Trading fee (%) at time t: the DBC scheduler if Sniper Fee → Burn is in the stack, else the 1% base. */
export function feeAt(stackIn, t) {
  const s = normalize(stackIn).find((x) => x.id === 'sniper-fee-burn');
  return s ? byId[s.id].fee(s.params, t) : 1;
}
