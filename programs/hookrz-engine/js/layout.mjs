// hookrz_engine encoders/decoders (see ../LAYOUT.md). Dependency-free: keys are 32-byte Uint8Arrays
// (pass `pubkey.toBytes()`); derive PDAs with your own web3 library from the seeds below.

export const PROGRAM_ID = 'EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr';
export const IX = { initStack: 0xa0, openWallet: 0xa1, closeWallet: 0xa2, closeStack: 0xa3, writeScript: 0xa4 };
export const EXECUTE_DISCRIMINATOR = Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26]);
export const STACK_SIZE = 640;
export const WALLET_SIZE = 328;
export const SCRIPT_SIZE = 1296;
export const LOTS = 5;
const enc = new TextEncoder();
export const SEEDS = {
  stack: (mint) => [enc.encode('stack'), mint],
  script: (mint) => [enc.encode('script'), mint],
  wallet: (mint, tokenAccount) => [enc.encode('w'), mint, tokenAccount],
  extraMetas: (mint) => [enc.encode('extra-account-metas'), mint],
};

/** block id (u16 in the Stack) = error code - 6000. */
export const BLOCK_IDS = {
  'snipe-shield': 1, 'anti-bundle': 2, 'max-wallet': 3, 'rising-max': 4, 'sandwich-guard': 5,
  'sell-cap': 8, 'sell-cooldown': 9, 'hold-timer': 10, 'circuit-breaker': 11, 'trading-hours': 12,
  'lock-in': 15, 'creator-vest': 16, custom: 128,
};
export const BLOCK_NAMES = Object.fromEntries(Object.entries(BLOCK_IDS).map(([k, v]) => [v, k]));

const bps = (pct) => Math.round(pct * 100);
/** Pack one block's params (blocks.js units, defaults already filled) into the 24-byte slot area. */
export function packParams(id, p) {
  const b = new Uint8Array(24), v = new DataView(b.buffer);
  const u16 = (at, x) => v.setUint16(at, x, true), u32 = (at, x) => v.setUint32(at, x, true);
  switch (id) {
    case 'snipe-shield': u32(0, p.window); u16(4, bps(p.max)); break;
    case 'anti-bundle': u32(0, p.window * 60); u16(4, p.perSlot); break;
    case 'max-wallet': u16(0, bps(p.pct)); break;
    case 'rising-max': u16(0, bps(p.from)); u16(2, bps(p.to)); u32(4, p.hours * 3600); break;
    case 'sandwich-guard': u32(0, p.slots); break;
    case 'sell-cap': u16(0, bps(p.pct)); break;
    case 'sell-cooldown': u32(0, p.minutes * 60); break;
    case 'hold-timer': u32(0, p.minutes * 60); break;
    case 'circuit-breaker': u32(0, p.window * 60); u16(4, bps(p.band)); break;
    case 'trading-hours': b[0] = p.open; b[1] = p.close; break;
    case 'lock-in': u16(0, bps(p.pct)); break;
    case 'creator-vest': u32(0, p.cliff * 86400); u32(4, p.days * 86400); break;
    case 'custom': break;
    default: throw new Error(`${id} is not a hook block of hookrz_engine`);
  }
  return b;
}

/**
 * init_stack instruction data. slots: [{ id, params }] with params in blocks.js units (normalize() first),
 * hook blocks only, in slot order. script: Uint8Array bytecode or null. parent: true if a parent stack is passed.
 * staged: true if the script was already written with writeScriptData chunks (then pass script = null).
 */
export function initStackData(slots, { script = null, parent = false, staged = false } = {}) {
  const sl = script ? script.length : 0;
  const out = new Uint8Array(3 + slots.length * 26 + 2 + sl);
  const v = new DataView(out.buffer);
  out[0] = IX.initStack; out[1] = slots.length; out[2] = (parent ? 1 : 0) | (staged ? 2 : 0);
  slots.forEach((s, i) => {
    const at = 3 + i * 26;
    v.setUint16(at, BLOCK_IDS[s.id], true);
    out.set(packParams(s.id, s.params), at + 2);
  });
  const at = 3 + slots.length * 26;
  v.setUint16(at, sl, true);
  if (sl) out.set(script, at + 2);
  return out;
}

/**
 * write_script (0xA4) data: one chunk of a script staged before init_stack (for scripts too big for the launch tx).
 * Accounts: creator (signer, w), mint, pool, stack PDA, script PDA (w), system program.
 */
export function writeScriptData(script, offset, length) {
  const chunk = script.slice(offset, offset + length);
  const out = new Uint8Array(5 + chunk.length);
  const v = new DataView(out.buffer);
  out[0] = IX.writeScript; v.setUint16(1, script.length, true); v.setUint16(3, offset, true);
  out.set(chunk, 5);
  return out;
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const u128 = (v, at) => v.getBigUint64(at, true) | (v.getBigUint64(at + 8, true) << 64n);

export function decodeStack(data) {
  const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const key = (at) => d.slice(at, at + 32);
  const n = d[12];
  const slots = [];
  for (let i = 0; i < n; i++) {
    const at = 224 + i * 58;
    slots.push({ blockId: v.getUint16(at, true), block: BLOCK_NAMES[v.getUint16(at, true)], params: hex(d.slice(at + 2, at + 26)), state: hex(d.slice(at + 26, at + 58)) });
  }
  const flags = v.getUint16(10, true);
  return {
    version: d[8], bump: d[9], flags, armed: !!(flags & 1), hasPool: !!(flags & 2), hasWallets: !!(flags & 4), hasScript: !!(flags & 8), stackWritable: !!(flags & 16), hasApp: !!(flags & 32),
    mint: key(16), creator: key(48), pool: key(80), baseVault: key(112), parentStack: key(144), parentAuthor: key(176),
    launchSlot: v.getBigUint64(208, true), launchTs: v.getBigInt64(216, true), slots,
    script: key(572), lastSqrt: u128(v, 604), migrationQuoteThreshold: v.getBigUint64(620, true), activationPoint: v.getBigUint64(628, true),
  };
}

/** Creator Vesting state of a decoded Stack: the creator's launch bag (raw units) for the reference ctx's `creatorBase`. */
export function creatorBaseOf(stack) {
  const s = stack.slots.find((x) => x.block === 'creator-vest');
  if (!s) return 0n;
  const b = Uint8Array.from(s.state.match(/../g).map((h) => parseInt(h, 16)));
  const v = new DataView(b.buffer);
  return b[16] ? v.getBigUint64(0, true) : 0n;
}

export function decodeWallet(data) {
  const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const flags = d[10];
  const lotsAt = (base) => Array.from({ length: LOTS }, (_, i) => ({ t: v.getUint32(base + i * 12, true), amount: v.getBigUint64(base + i * 12 + 4, true) }));
  return {
    version: d[8], bump: d[9], flags, hasBought: !!(flags & 1), hasSold: !!(flags & 2), hasReceived: !!(flags & 4),
    firstReceiptTs: v.getBigInt64(12, true), lastBuySlot: v.getBigUint64(20, true), lastSellTs: v.getBigInt64(28, true),
    /** Receipt lots (Hold Timer; Hookscript received-in-window). `lotsOut`: sells and outgoing sends. t = seconds since launch. */
    lots: lotsAt(36), mint: d.slice(96, 128), tokenAccount: d.slice(128, 160), payer: d.slice(160, 192), scriptVars: d.slice(192, 224),
    lastBuyTs: v.getBigInt64(224, true), bought: v.getBigUint64(232, true), sold: v.getBigUint64(240, true),
    buys: v.getUint32(248, true), sells: v.getUint32(252, true), lotsOut: lotsAt(264),
  };
}

/** Script account (hookscript/SPEC.md §8): code and the 256-byte globals the keeper reads. */
export function decodeScript(data) {
  const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const len = v.getUint16(10, true);
  return { version: d[8], bump: d[9], codeLen: len, globals: d.slice(16, 272), code: d.slice(272, 272 + len) };
}

/** Wallet record → the reference engine's ctx.w (times in seconds since launch). */
export function walletCtx(w, launchTs) {
  return {
    lots: w.lots.filter((l) => l.amount > 0n).map((l) => ({ t: l.t, amt: Number(l.amount) })),
    lastBuySlot: w.hasBought ? Number(w.lastBuySlot) : null,
    lastSellT: w.hasSold ? Number(w.lastSellTs - BigInt(launchTs)) : null,
    firstT: w.hasReceived ? Number(w.firstReceiptTs - BigInt(launchTs)) : null,
  };
}
