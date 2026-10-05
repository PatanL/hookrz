// Reference interpreter: the same semantics as vm/src/lib.rs (run), verify.rs (analyze/verify) and fmt.rs,
// bit for bit, using BigInt for i64. The site and server use it for quotes; the fuzzer runs it on 10,000 trades;
// the parity test compares it with the Rust VM.
import {
  OP, gasOf, MAGIC, VERSION, HEADER_LEN, MAX_CODE, GLOBALS_LEN, WVARS_LEN, STACK_MAX, LOCALS_MAX, MAX_KEYS, MAX_REASONS,
  MAX_REASON_LEN, GAS_LIMIT, RING_BYTES, C, W, T, TYPE_SIZE, K, KC, F, FMT, FMT_MAX, CTX_FIELDS, WAL_FIELDS, CLOCK_FIELDS, MOON_FIELDS,
} from './bytecode.ts';
import * as M from './math.ts';
import type { Ctx, WalletView } from './ctx.ts';

const { ONE, sat, n, tok, u2i } = M;

export class VmError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
const err = (c: string): never => { throw new VmError(c); };

export type Verdict = { allow: true } | { allow: false; reasonId: number; arg: bigint };

export interface Header {
  flags: number; nKeys: number; nReasons: number; gasMax: number; globalsLen: number; wvarsLen: number; maxStack: number; nLocals: number;
  keys: Uint8Array; reasons: Uint8Array; code: Uint8Array;
}

export function parse(s: Uint8Array): Header {
  if (s.length > MAX_CODE) err('TooLong');
  if (s.length < HEADER_LEN) err('BadLength');
  if (s[0] !== MAGIC[0] || s[1] !== MAGIC[1]) err('BadMagic');
  if (s[2] !== VERSION) err('BadVersion');
  const flags = s[3], nKeys = s[4], nReasons = s[5];
  const codeLen = s[6] | (s[7] << 8);
  const gasMax = s[8] | (s[9] << 8);
  const globalsLen = s[10] | (s[11] << 8);
  const wvarsLen = s[12], maxStack = s[13], nLocals = s[14];
  if (s[15] !== 0 || nKeys > MAX_KEYS || nReasons > MAX_REASONS || globalsLen > GLOBALS_LEN || wvarsLen > WVARS_LEN || maxStack > STACK_MAX || nLocals > LOCALS_MAX) err('BadHeader');
  const keysEnd = HEADER_LEN + 32 * nKeys;
  if (keysEnd > s.length) err('BadLength');
  let p = keysEnd;
  for (let i = 0; i < nReasons; i++) {
    if (p >= s.length) err('BadLength');
    const fmt = s[p];
    if (p + 1 >= s.length) err('BadLength');
    const len = s[p + 1];
    if (fmt > FMT_MAX || len > MAX_REASON_LEN) err('BadReason');
    p += 2 + len;
    if (p > s.length) err('BadLength');
  }
  const code = s.subarray(p);
  if (code.length !== codeLen) err('BadLength');
  return { flags, nKeys, nReasons, gasMax, globalsLen, wvarsLen, maxStack, nLocals, keys: s.subarray(HEADER_LEN, keysEnd), reasons: s.subarray(keysEnd, p), code };
}

// ───── operand readers (pc is boxed) ─────
type PC = { pc: number };
const rd8 = (c: Uint8Array, r: PC) => { if (r.pc >= c.length) err('BadOperand'); return c[r.pc++]; };
const rd16 = (c: Uint8Array, r: PC) => { const a = rd8(c, r); const b = rd8(c, r); return a | (b << 8); };
const rd16s = (c: Uint8Array, r: PC) => { const v = rd16(c, r); return v >= 0x8000 ? v - 0x10000 : v; };
const rd32 = (c: Uint8Array, r: PC) => { const a = rd16(c, r); const b = rd16(c, r); return a + b * 0x10000; };
function rdvar(c: Uint8Array, r: PC): bigint {
  let x = 0n, shift = 0;
  for (;;) {
    const b = rd8(c, r);
    if (shift === 63 && (b & 0x7e) !== 0) err('BadOperand');
    x |= BigInt(b & 0x7f) << BigInt(shift);
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 63) err('BadOperand');
  }
  x = BigInt.asUintN(64, x);
  return (x >> 1n) ^ -(x & 1n);
}

// ───── context reads ─────
const keyEq = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < 32; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false; return true; };
const ZERO = new Uint8Array(32);

function ctxKey(c: Ctx, id: number): Uint8Array {
  const buy = c.kind === 0;
  switch (id) {
    case KC.SENDER: return c.sender.key;
    case KC.RECEIVER: return c.receiver.key;
    case KC.TRADER: return buy ? c.receiver.key : c.sender.key;
    case KC.CREATOR: return c.creator;
    case KC.APP: return c.app;
    case KC.OTHER: return buy ? c.sender.key : c.receiver.key;
    default: return ZERO;
  }
}

function ctxField(c: Ctx, f: number): bigint {
  const d = c.decimals;
  switch (f) {
    case C.KIND: return BigInt(c.kind);
    case C.AMOUNT: return tok(c.amount, d);
    case C.VALUE: return M.muldiv(tok(c.amount, d), u2i(c.priceE6), 1_000_000_000_000_000n);
    case C.SLOT: return n(u2i(c.slot));
    case C.NOW: return n(c.now);
    case C.LAUNCH: return n(c.launchTs);
    case C.AGE: return n(sat(c.now - c.launchTs));
    case C.LAUNCH_SLOT: return n(u2i(c.launchSlot));
    case C.SUPPLY: return tok(c.supply, d);
    case C.PRICE: return u2i(c.priceE6);
    case C.PROGRESS: return BigInt(c.progressPpm);
    case C.MCAP: return M.muldiv(tok(c.supply, d), u2i(c.priceE6), 1_000_000_000_000_000n);
    case C.RAISED: return u2i(c.quoteReserve / 1000n);
    case C.FEE: return BigInt(c.feeBps) * 100n;
    case C.SAME_WALLET: return c.sameWallet ? 1n : 0n;
    case C.IS_CREATOR: return keyEq(ctxKey(c, KC.TRADER), c.creator) ? 1n : 0n;
    default: return err('BadOperand');
  }
}

function sideOf(c: Ctx, side: number): number {
  const buy = c.kind === 0;
  switch (side) {
    case 0: return 0;
    case 1: return 1;
    case 2: return buy ? 1 : 0;
    case 3: return buy ? 0 : 1;
    default: return err('BadOperand');
  }
}

function walField(c: Ctx, s: number, f: number): bigint {
  const w = s === 0 ? c.sender : c.receiver;
  const d = c.decimals;
  const t = (ts: bigint) => (ts === 0n ? 0n : n(ts));
  switch (f) {
    case W.HAS_RECORD: return w.hasRecord ? 1n : 0n;
    case W.IS_POOL: return w.isPool ? 1n : 0n;
    case W.BALANCE: return tok(w.balance, d);
    case W.BALANCE_AFTER: { const b = tok(w.balance, d), a = tok(c.amount, d); if (s === 0) { const r = sat(b - a); return r < 0n ? 0n : r; } return sat(b + a); }
    case W.FIRST_RECEIPT: return t(w.firstReceiptTs);
    case W.LAST_BUY_SLOT: return n(u2i(w.lastBuySlot));
    case W.LAST_BUY: return t(w.lastBuyTs);
    case W.LAST_SELL: return t(w.lastSellTs);
    case W.BOUGHT: return tok(w.bought, d);
    case W.SOLD: return tok(w.sold, d);
    case W.BUYS: return n(BigInt(w.buys));
    case W.SELLS: return n(BigInt(w.sells));
    case W.LAST_TRADE: return t(w.lastBuyTs > w.lastSellTs ? w.lastBuyTs : w.lastSellTs);
    case W.HELD: { if (w.firstReceiptTs === 0n) return 0n; const h = sat(c.now - w.firstReceiptTs); return n(h < 0n ? 0n : h); }
    default: return err('BadOperand');
  }
}

function windowSum(c: Ctx, s: number, dir: number, window: bigint): bigint {
  const w: WalletView = s === 0 ? c.sender : c.receiver;
  if (dir !== 0 && dir !== 1) err('BadOperand');
  const lots = dir === 0 ? w.lotsIn : w.lotsOut;
  const secs = window < 0n ? 0n : window / ONE;
  const cutoff = sat(c.now - secs);
  let sum = 0n;
  for (let i = 0; i < 5 && i < lots.length; i++) {
    if (sat(c.launchTs + BigInt(lots[i].t)) >= cutoff) sum = sat(sum + tok(lots[i].amount, c.decimals));
  }
  return sum;
}

// ───── typed storage ─────
const dvOf = (a: Uint8Array) => new DataView(a.buffer, a.byteOffset, a.byteLength);

function load(area: Uint8Array, present: boolean, ty: number, off: number, launch: bigint): bigint {
  const size = TYPE_SIZE[ty];
  if (size === undefined) err('BadOperand');
  if (off + size > area.length) err('BadSlot');
  if (!present) return 0n;
  const dv = dvOf(area);
  switch (ty) {
    case T.num: return dv.getBigInt64(off, true);
    case T.int: return n(BigInt(dv.getInt32(off, true)));
    case T.time: { const v = BigInt(dv.getUint32(off, true)); return v === 0n ? 0n : n(sat(launch + v - 1n)); }
    default: return area[off] !== 0 ? 1n : 0n;
  }
}

function store(area: Uint8Array, present: boolean, ty: number, off: number, v: bigint, launch: bigint) {
  const size = TYPE_SIZE[ty];
  if (size === undefined) err('BadOperand');
  if (off + size > area.length) err('BadSlot');
  if (!present) return;
  const dv = dvOf(area);
  switch (ty) {
    case T.num: dv.setBigInt64(off, v, true); return;
    case T.int: { let w = v / ONE; if (w < -2147483648n) w = -2147483648n; if (w > 2147483647n) w = 2147483647n; dv.setInt32(off, Number(w), true); return; }
    case T.time: {
      let r: bigint;
      if (v === 0n) r = 0n;
      else { r = sat(sat(v / ONE - launch) + 1n); if (r < 1n) r = 1n; if (r > 0xffff_ffffn) r = 0xffff_ffffn; }
      dv.setUint32(off, Number(r), true); return;
    }
    default: area[off] = v !== 0n ? 1 : 0;
  }
}

interface Mem { g: Uint8Array; ws: Uint8Array; wd: Uint8Array; hasS: boolean; hasD: boolean; same: boolean }
const wvars = (m: Mem, s: number): [Uint8Array, boolean] => (s === 0 || m.same ? [m.ws, m.hasS] : [m.wd, m.hasD]);

function keyOf(h: Header, c: Ctx, m: Mem, kind: number, arg: number): Uint8Array {
  switch (kind) {
    case K.CTX: if (arg > KC.OTHER) err('BadKey'); return ctxKey(c, arg);
    case K.CONST: if (arg >= h.nKeys) err('BadKey'); return h.keys.subarray(32 * arg, 32 * arg + 32);
    case K.GLOBAL: if (arg + 32 > m.g.length) err('BadSlot'); return m.g.subarray(arg, arg + 32);
    case K.WVAR: { const s = sideOf(c, arg); const [a, present] = wvars(m, s); return present ? a.subarray(0, 32) : ZERO; }
    default: return err('BadKey');
  }
}

const ringRead = (g: Uint8Array, off: number, i: number) => { const o = off + 8 * i; if (o + 8 > g.length) err('BadSlot'); return dvOf(g).getBigInt64(o, true); };
const ringWrite = (g: Uint8Array, off: number, i: number, v: bigint) => { const o = off + 8 * i; if (o + 8 > g.length) err('BadSlot'); dvOf(g).setBigInt64(o, v, true); };

function ringTick(g: Uint8Array, off: number, w: number, now: bigint, price: bigint) {
  if (w === 0 || off + RING_BYTES > g.length) err('BadSlot');
  const b = M.clampT(now) / BigInt(w);
  const stored = ringRead(g, off, 0);
  const cur = b + 1n;
  if (stored === 0n || cur < stored || cur - stored >= 5n) { for (let i = 0; i < 5; i++) ringWrite(g, off, 1 + i, 0n); }
  else if (cur > stored) { for (let k = stored; k < cur; k++) ringWrite(g, off, 1 + Number(k % 5n), 0n); }
  else return;
  ringWrite(g, off, 1 + Number(b % 5n), price);
  ringWrite(g, off, 0, cur);
}

function ringAt(g: Uint8Array, off: number, w: number, now: bigint, price: bigint): bigint {
  if (w === 0 || off + RING_BYTES > g.length) err('BadSlot');
  const b = M.clampT(now) / BigInt(w);
  const stored = ringRead(g, off, 0);
  if (stored === 0n) return price;
  const last = stored - 1n;
  for (let j = 4n; j >= 0n; j--) {
    const bucket = b - j;
    if (bucket >= 0n && bucket <= last && bucket > last - 5n) {
      const v = ringRead(g, off, 1 + Number(bucket % 5n));
      if (v !== 0n) return v;
    }
  }
  return price;
}

export interface RunResult { verdict?: Verdict; error?: string; gas: number; globals: Uint8Array; walletSrc: Uint8Array; walletDst: Uint8Array }

/**
 * Run a script. Inputs are not mutated; the result carries the new state (equal to the inputs unless allowed).
 * walletSrc / walletDst: the 32-byte var areas, or empty arrays when there is no record.
 */
export function run(code: Uint8Array, c: Ctx, globals: Uint8Array, walletSrc: Uint8Array, walletDst: Uint8Array): RunResult {
  const box = { gas: 0 };
  const g0 = globals.slice(), s0 = walletSrc.slice(), d0 = walletDst.slice();
  try {
    const h = parse(code);
    const glen = Math.min(globals.length, GLOBALS_LEN);
    const mem: Mem = {
      g: globals.slice(0, glen), ws: new Uint8Array(WVARS_LEN), wd: new Uint8Array(WVARS_LEN),
      hasS: walletSrc.length >= WVARS_LEN, hasD: !c.sameWallet && walletDst.length >= WVARS_LEN, same: c.sameWallet,
    };
    if (mem.hasS) mem.ws.set(walletSrc.subarray(0, WVARS_LEN));
    if (mem.hasD) mem.wd.set(walletDst.subarray(0, WVARS_LEN));
    const v = exec(h, c, mem, box);
    if (v.allow) {
      const g1 = g0.slice(); g1.set(mem.g, 0);
      const s1 = s0.slice(); if (mem.hasS) s1.set(mem.ws, 0);
      const d1 = d0.slice(); if (mem.hasD) d1.set(mem.wd, 0);
      return { verdict: v, gas: box.gas, globals: g1, walletSrc: s1, walletDst: d1 };
    }
    return { verdict: v, gas: box.gas, globals: g0, walletSrc: s0, walletDst: d0 };
  } catch (e) {
    if (e instanceof VmError) return { error: e.code, gas: box.gas, globals: g0, walletSrc: s0, walletDst: d0 };
    throw e; // a JS exception here is a bug in the interpreter (a "panic")
  }
}

function exec(h: Header, c: Ctx, m: Mem, box: { gas: number }): Verdict {
  const code = h.code;
  const st: bigint[] = [];
  const push = (x: bigint) => { if (st.length >= STACK_MAX) err('StackOverflow'); st.push(x); };
  const pop = (): bigint => { if (st.length === 0) err('StackUnderflow'); return st.pop() as bigint; };
  const loc: bigint[] = new Array(LOCALS_MAX).fill(0n);
  const r: PC = { pc: 0 };
  for (;;) {
    if (r.pc >= code.length) return { allow: true };
    const o = code[r.pc];
    const w = gasOf(o);
    if (w === undefined) err('BadOpcode');
    box.gas += w as number;
    if (box.gas > GAS_LIMIT) err('OutOfGas');
    r.pc++;
    switch (o) {
      case OP.END: return { allow: true };
      case OP.REFUSE: case OP.REFUSEV: {
        const id = rd8(code, r);
        if (id >= h.nReasons) err('BadReason');
        const arg = o === OP.REFUSEV ? pop() : 0n;
        return { allow: false, reasonId: id, arg };
      }
      case OP.JMP: case OP.JZ: case OP.JNZ: {
        const off = rd16(code, r);
        const target = r.pc + off;
        if (target > code.length) err('BadJump');
        const take = o === OP.JMP ? true : o === OP.JZ ? pop() === 0n : pop() !== 0n;
        if (take) r.pc = target;
        break;
      }
      case OP.POP: pop(); break;
      case OP.DUP: { const a = pop(); push(a); push(a); break; }
      case OP.PUSHI: push(n(rdvar(code, r))); break;
      case OP.PUSHR: push(rdvar(code, r)); break;
      case OP.LDL: { const i = rd8(code, r); if (i >= LOCALS_MAX) err('BadOperand'); push(loc[i]); break; }
      case OP.STL: { const i = rd8(code, r); const v = pop(); if (i >= LOCALS_MAX) err('BadOperand'); loc[i] = v; break; }
      case OP.NEG: push(sat(-pop())); break;
      case OP.ABS: { const a = pop(); push(sat(a < 0n ? -a : a)); break; }
      case OP.NOT: push(pop() === 0n ? 1n : 0n); break;
      case OP.MULDIV: { const cc = pop(); const b = pop(); const a = pop(); push(M.muldiv(a, b, cc)); break; }
      case OP.ADD: case OP.SUB: case OP.MUL: case OP.DIV: case OP.MOD: case OP.MIN: case OP.MAX:
      case OP.EQ: case OP.NE: case OP.LT: case OP.LE: case OP.GT: case OP.GE: {
        const b = pop(); const a = pop();
        let v: bigint;
        switch (o) {
          case OP.ADD: v = sat(a + b); break;
          case OP.SUB: v = sat(a - b); break;
          case OP.MUL: v = M.mul(a, b); break;
          case OP.DIV: v = M.div(a, b); break;
          case OP.MOD: v = M.rem(a, b); break;
          case OP.MIN: v = a < b ? a : b; break;
          case OP.MAX: v = a > b ? a : b; break;
          case OP.EQ: v = a === b ? 1n : 0n; break;
          case OP.NE: v = a !== b ? 1n : 0n; break;
          case OP.LT: v = a < b ? 1n : 0n; break;
          case OP.LE: v = a <= b ? 1n : 0n; break;
          case OP.GT: v = a > b ? 1n : 0n; break;
          default: v = a >= b ? 1n : 0n;
        }
        push(v);
        break;
      }
      case OP.CTX: { const f = rd8(code, r); push(ctxField(c, f)); break; }
      case OP.WAL: { const side = rd8(code, r); const f = rd8(code, r); const s = sideOf(c, side); push(walField(c, s, f)); break; }
      case OP.WIN: { const side = rd8(code, r); const dir = rd8(code, r); const s = sideOf(c, side); const win = pop(); push(windowSum(c, s, dir, win)); break; }
      case OP.CLOCK: {
        const f = rd8(code, r); const tz = rd16s(code, r); const rule = rd8(code, r);
        if (rule > 3) err('BadOperand');
        const v = M.clock(c.now, f, tz, rule); if (v === undefined) err('BadOperand');
        push(v as bigint); break;
      }
      case OP.DAYLIGHT: { const lat = rd16s(code, r); const lon = rd16s(code, r); push(M.daylight(c.now, lat, lon) ? 1n : 0n); break; }
      case OP.MOON: { const f = rd8(code, r); const v = M.moon(c.now, f); if (v === undefined) err('BadOperand'); push(v as bigint); break; }
      case OP.DECAY: { const every = pop(); const elapsed = pop(); const rate = pop(); const x = pop(); push(M.decay(x, rate, elapsed, every)); break; }
      case OP.RINGTICK: { const off = rd8(code, r); const w2 = rd32(code, r); ringTick(m.g, off, w2, c.now, u2i(c.priceE6)); break; }
      case OP.RINGAT: { const off = rd8(code, r); const w2 = rd32(code, r); push(ringAt(m.g, off, w2, c.now, u2i(c.priceE6))); break; }
      case OP.LDG: { const ty = rd8(code, r); const off = rd8(code, r); push(load(m.g, true, ty, off, c.launchTs)); break; }
      case OP.STG: { const ty = rd8(code, r); const off = rd8(code, r); const v = pop(); store(m.g, true, ty, off, v, c.launchTs); break; }
      case OP.LDW: { const side = rd8(code, r); const ty = rd8(code, r); const off = rd8(code, r); const s = sideOf(c, side); const [a, p] = wvars(m, s); push(load(a, p, ty, off, c.launchTs)); break; }
      case OP.STW: { const side = rd8(code, r); const ty = rd8(code, r); const off = rd8(code, r); const s = sideOf(c, side); const v = pop(); const [a, p] = wvars(m, s); store(a, p, ty, off, v, c.launchTs); break; }
      case OP.KEQ: {
        const ka = rd8(code, r), aa = rd8(code, r), kb = rd8(code, r), ab = rd8(code, r);
        const x = keyOf(h, c, m, ka, aa); const y = keyOf(h, c, m, kb, ab);
        push(keyEq(x, y) ? 1n : 0n); break;
      }
      case OP.KSTG: {
        const off = rd8(code, r), k = rd8(code, r), a = rd8(code, r);
        const key = keyOf(h, c, m, k, a).slice(0, 32);
        if (off + 32 > m.g.length) err('BadSlot');
        m.g.set(key, off); break;
      }
      case OP.KSTW: {
        const side = rd8(code, r), off = rd8(code, r), k = rd8(code, r), a = rd8(code, r);
        const s = sideOf(c, side);
        const key = keyOf(h, c, m, k, a).slice(0, 32);
        const [area, present] = wvars(m, s);
        if (off + 32 > area.length) err('BadSlot');
        if (present) area.set(key, off);
        break;
      }
      default: err('BadOpcode');
    }
  }
}

// ───── static analysis (verify.rs) ─────
export interface Info { gasMax: number; flags: number; maxStack: number; nLocals: number; globalsLen: number; wvarsLen: number; ops: number }

export function analyze(s: Uint8Array, opts: { noLimit?: boolean } = {}): Info {
  const h = parse(s);
  const c = h.code, len = c.length;
  const labels: { target: number; depth: number; gas: number }[] = [];
  const addLabel = (target: number, depth: number, gas: number) => {
    const l = labels.find((x) => x.target === target);
    if (l) { if (l.depth !== depth) err('StackMismatch'); if (gas > l.gas) l.gas = gas; return; }
    if (labels.length >= 64) err('TooManyLabels');
    labels.push({ target, depth, gas });
  };
  let cur: [number, number] | null = [0, 0];
  const take = (pc: number) => {
    for (let i = 0; i < labels.length;) {
      const l = labels[i];
      if (l.target === pc) {
        if (cur === null) cur = [l.depth, l.gas];
        else { if (cur[0] !== l.depth) err('StackMismatch'); if (l.gas > cur[1]) cur[1] = l.gas; }
        labels[i] = labels[labels.length - 1]; labels.pop();
        continue;
      }
      i++;
    }
  };
  const need = (cond: boolean, e: string) => { if (!cond) err(e); };
  let gasMax = 0, maxStack = 0, flags = 0, gl = 0, wl = 0, nl = 0, ops = 0;
  const checkKey = (kind: number, arg: number) => {
    switch (kind) {
      case K.CTX: need(arg <= KC.OTHER, 'BadKey'); if (arg === KC.APP) flags |= F.APP; break;
      case K.CONST: need(arg < h.nKeys, 'BadKey'); break;
      case K.GLOBAL: need(arg + 32 <= GLOBALS_LEN, 'BadSlot'); flags |= F.READS_GLOBALS; gl = Math.max(gl, arg + 32); break;
      case K.WVAR: need(arg <= 3, 'BadOperand'); flags |= F.READS_WALLET; wl = WVARS_LEN; break;
      default: err('BadKey');
    }
  };
  const sideFlags = (side: number) => (side === 0 ? F.SENDER : side === 1 ? F.RECEIVER : side <= 3 ? F.SENDER | F.RECEIVER : err('BadOperand'));
  const r: PC = { pc: 0 };
  while (r.pc < len) {
    take(r.pc);
    const start = r.pc;
    const o = rd8(c, r);
    const w = gasOf(o);
    if (w === undefined) err('BadOpcode');
    ops++;
    let target = 0;
    let pop = 0, push = 0, kind = 0;
    switch (o) {
      case OP.END: kind = 1; break;
      case OP.REFUSE: case OP.REFUSEV: { const id = rd8(c, r); need(id < h.nReasons, 'BadReason'); pop = o === OP.REFUSEV ? 1 : 0; kind = 1; break; }
      case OP.JMP: case OP.JZ: case OP.JNZ: { const off = rd16(c, r); target = r.pc + off; need(target <= len, 'BadJump'); if (o === OP.JMP) kind = 2; else { pop = 1; kind = 3; } break; }
      case OP.POP: pop = 1; break;
      case OP.DUP: pop = 1; push = 2; break;
      case OP.PUSHI: case OP.PUSHR: rdvar(c, r); push = 1; break;
      case OP.LDL: case OP.STL: { const i = rd8(c, r); need(i < LOCALS_MAX, 'BadOperand'); nl = Math.max(nl, i + 1); if (o === OP.LDL) push = 1; else pop = 1; break; }
      case OP.NEG: case OP.ABS: case OP.NOT: pop = 1; push = 1; break;
      case OP.MULDIV: pop = 3; push = 1; break;
      case OP.ADD: case OP.SUB: case OP.MUL: case OP.DIV: case OP.MOD: case OP.MIN: case OP.MAX:
      case OP.EQ: case OP.NE: case OP.LT: case OP.LE: case OP.GT: case OP.GE: pop = 2; push = 1; break;
      case OP.CTX: { const f = rd8(c, r); need(f < CTX_FIELDS, 'BadOperand'); if ([C.VALUE, C.PRICE, C.PROGRESS, C.MCAP, C.RAISED, C.FEE].includes(f as never)) flags |= F.CURVE; push = 1; break; }
      case OP.WAL: { const side = rd8(c, r); const f = rd8(c, r); flags |= sideFlags(side); need(f < WAL_FIELDS, 'BadOperand'); push = 1; break; }
      case OP.WIN: { const side = rd8(c, r); const dir = rd8(c, r); flags |= sideFlags(side); need(dir <= 1, 'BadOperand'); pop = 1; push = 1; break; }
      case OP.CLOCK: { const f = rd8(c, r); rd16(c, r); const rule = rd8(c, r); need(f < CLOCK_FIELDS && rule <= 3, 'BadOperand'); push = 1; break; }
      case OP.DAYLIGHT: rd16(c, r); rd16(c, r); push = 1; break;
      case OP.MOON: { const f = rd8(c, r); need(f < MOON_FIELDS, 'BadOperand'); push = 1; break; }
      case OP.DECAY: pop = 4; push = 1; break;
      case OP.RINGTICK: case OP.RINGAT: {
        const off = rd8(c, r); const wd = rd32(c, r);
        need(wd >= 1, 'BadOperand'); need(off + RING_BYTES <= GLOBALS_LEN, 'BadSlot');
        gl = Math.max(gl, off + RING_BYTES); flags |= F.CURVE | F.READS_GLOBALS;
        if (o === OP.RINGTICK) flags |= F.WRITES_GLOBALS; else push = 1;
        break;
      }
      case OP.LDG: case OP.STG: {
        const ty = rd8(c, r); const off = rd8(c, r); const size = TYPE_SIZE[ty]; if (size === undefined) err('BadOperand');
        need(off + size <= GLOBALS_LEN, 'BadSlot'); gl = Math.max(gl, off + size);
        if (o === OP.LDG) { flags |= F.READS_GLOBALS; push = 1; } else { flags |= F.WRITES_GLOBALS; pop = 1; }
        break;
      }
      case OP.LDW: case OP.STW: {
        const side = rd8(c, r); const ty = rd8(c, r); const off = rd8(c, r);
        need(side <= 3, 'BadOperand'); const size = TYPE_SIZE[ty]; if (size === undefined) err('BadOperand');
        need(off + size <= WVARS_LEN, 'BadSlot'); wl = Math.max(wl, off + size);
        if (o === OP.LDW) { flags |= F.READS_WALLET; push = 1; } else { flags |= F.WRITES_WALLET; pop = 1; }
        break;
      }
      case OP.KEQ: { const ka = rd8(c, r), aa = rd8(c, r), kb = rd8(c, r), ab = rd8(c, r); checkKey(ka, aa); checkKey(kb, ab); push = 1; break; }
      case OP.KSTG: { const off = rd8(c, r), k = rd8(c, r), a = rd8(c, r); need(off + 32 <= GLOBALS_LEN, 'BadSlot'); gl = Math.max(gl, off + 32); checkKey(k, a); flags |= F.WRITES_GLOBALS; break; }
      case OP.KSTW: { const side = rd8(c, r), off = rd8(c, r), k = rd8(c, r), a = rd8(c, r); need(side <= 3, 'BadOperand'); need(off + 32 <= WVARS_LEN, 'BadSlot'); wl = WVARS_LEN; checkKey(k, a); flags |= F.WRITES_WALLET; break; }
      default: err('BadOpcode');
    }
    if (labels.some((l) => l.target > start && l.target < r.pc)) err('BadJump');
    if (cur !== null) {
      const [d, g] = cur as [number, number];
      need(d >= pop, 'StackUnderflow');
      const nd = d - pop + push;
      need(nd <= STACK_MAX, 'StackOverflow');
      maxStack = Math.max(maxStack, nd);
      const ng = g + (w as number);
      if (kind === 1) { gasMax = Math.max(gasMax, ng); cur = null; }
      else if (kind === 2) { addLabel(target, nd, ng); cur = null; }
      else if (kind === 3) { addLabel(target, nd, ng); cur = [nd, ng]; }
      else cur = [nd, ng];
    }
  }
  take(len);
  if (labels.length) err('BadJump');
  if (cur !== null) gasMax = Math.max(gasMax, (cur as [number, number])[1]);
  if (gasMax > GAS_LIMIT && !opts.noLimit) err('OutOfGas');
  return { gasMax, flags, maxStack, nLocals: nl, globalsLen: gl, wvarsLen: wl, ops };
}

export function verify(s: Uint8Array): Info {
  const h = parse(s);
  const i = analyze(s);
  if (h.gasMax !== i.gasMax || h.flags !== i.flags || h.maxStack !== i.maxStack || h.nLocals !== i.nLocals || h.globalsLen !== i.globalsLen || h.wvarsLen !== i.wvarsLen) err('BadHeader');
  return i;
}

// ───── reasons (fmt.rs) ─────
export function reason(code: Uint8Array, id: number): { fmt: number; text: Uint8Array } | null {
  let h: Header;
  try { h = parse(code); } catch { return null; }
  let p = 0;
  for (let i = 0; i < h.nReasons; i++) {
    const fmt = h.reasons[p], len = h.reasons[p + 1];
    const text = h.reasons.subarray(p + 2, p + 2 + len);
    if (i === id) return { fmt, text };
    p += 2 + len;
  }
  return null;
}

const groups = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
function fmtNum(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const ip = a / ONE;
  let fp = a % ONE;
  let digits = 6;
  if (ip >= 100n) { fp /= 10_000n; digits = 2; }
  while (digits > 0 && fp % 10n === 0n) { fp /= 10n; digits--; }
  return (neg ? '-' : '') + groups(ip) + (digits > 0 ? '.' + fp.toString().padStart(digits, '0') : '');
}
export function formatValue(fmt: number, v: bigint): string {
  switch (fmt) {
    case FMT.num: return fmtNum(v);
    case FMT.int: return (v < 0n ? '-' : '') + groups((v < 0n ? -v : v) / ONE);
    case FMT.duration: {
      const s = v < 0n ? 0n : v / ONE;
      const d = s / 86_400n, h = (s % 86_400n) / 3_600n, m = (s % 3_600n) / 60n, sec = s % 60n;
      if (d > 0n) return `${groups(d)}d` + (h > 0n ? ` ${h}h` : '');
      if (h > 0n) return `${h}h` + (m > 0n ? ` ${m}m` : '');
      if (m > 0n) return `${m}m` + (sec > 0n ? ` ${sec}s` : '');
      return `${sec}s`;
    }
    case FMT.time: {
      const t = M.clampT(v / ONE);
      const [y, mo, d] = M.civil(t / 86_400n);
      const sod = t % 86_400n;
      const p2 = (x: bigint) => x.toString().padStart(2, '0');
      return `${y.toString().padStart(4, '0')}-${p2(mo)}-${p2(d)} ${p2(sod / 3_600n)}:${p2((sod % 3_600n) / 60n)} UTC`;
    }
    case FMT.percent: return fmtNum(M.mul(v, 100n * ONE)) + '%';
    default: return '';
  }
}

/** Reason text with its `{}` filled, as the engine logs it. (Bytes-faithful for ASCII/UTF-8 text.) */
export function formatReason(code: Uint8Array, id: number, arg: bigint): string {
  const r = reason(code, id);
  if (!r) return '';
  const text = new TextDecoder().decode(r.text);
  if (r.fmt === FMT.none) return text;
  const i = text.indexOf('{}');
  return i < 0 ? text : text.slice(0, i) + formatValue(r.fmt, arg) + text.slice(i + 2);
}

/** Byte-exact twin of fmt.rs format_reason (works on raw bytes, even invalid UTF-8). */
export function formatReasonBytes(code: Uint8Array, id: number, arg: bigint, max = 256): Uint8Array {
  const r = reason(code, id);
  if (!r) return new Uint8Array(0);
  const out: number[] = [];
  let done = false;
  for (let i = 0; i < r.text.length;) {
    const c = r.text[i];
    if (!done && r.fmt !== FMT.none && c === 0x7b && r.text[i + 1] === 0x7d) {
      for (const ch of new TextEncoder().encode(formatValue(r.fmt, arg))) out.push(ch);
      done = true; i += 2; continue;
    }
    out.push(c); i++;
  }
  return Uint8Array.from(out.slice(0, max));
}
