// Opcodes, operand sizes, gas weights and field ids. Mirrors vm/src/op.rs exactly (the parity test checks).

export const OP = {
  END: 0x00, REFUSE: 0x01, REFUSEV: 0x02, JMP: 0x04, JZ: 0x05, JNZ: 0x06, POP: 0x07, DUP: 0x08,
  PUSHI: 0x09, PUSHR: 0x0a, LDL: 0x0b, STL: 0x0c,
  ADD: 0x10, SUB: 0x11, MUL: 0x12, DIV: 0x13, MOD: 0x14, NEG: 0x15, ABS: 0x16, MIN: 0x17, MAX: 0x18, MULDIV: 0x19, NOT: 0x1a,
  EQ: 0x20, NE: 0x21, LT: 0x22, LE: 0x23, GT: 0x24, GE: 0x25,
  CTX: 0x30, WAL: 0x31, WIN: 0x32, CLOCK: 0x33, DAYLIGHT: 0x34, MOON: 0x35, DECAY: 0x36, RINGTICK: 0x37, RINGAT: 0x38,
  LDG: 0x40, STG: 0x41, LDW: 0x42, STW: 0x43, KEQ: 0x44, KSTG: 0x45, KSTW: 0x46,
} as const;

export const OP_NAME: Record<number, string> = Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k]));

const GAS: Record<number, number> = {};
const set = (ops: number[], g: number) => { for (const o of ops) GAS[o] = g; };
set([OP.END, OP.REFUSE], 40);
set([OP.REFUSEV], 45);
set([OP.JMP, OP.JZ, OP.JNZ], 16);
set([OP.POP, OP.DUP], 10);
set([OP.PUSHI, OP.PUSHR], 30);
set([OP.LDL, OP.STL], 12);
set([OP.ADD, OP.SUB, OP.NEG, OP.ABS, OP.MIN, OP.MAX, OP.NOT], 14);
set([OP.EQ, OP.NE, OP.LT, OP.LE, OP.GT, OP.GE], 14);
set([OP.MUL], 60);
set([OP.DIV, OP.MOD, OP.MULDIV], 160);
set([OP.CTX, OP.WAL], 120);
set([OP.WIN], 220);
set([OP.CLOCK], 520);
set([OP.DAYLIGHT], 700);
set([OP.MOON], 800);
set([OP.DECAY], 900);
set([OP.RINGTICK], 320);
set([OP.RINGAT], 240);
set([OP.LDG, OP.LDW], 45);
set([OP.STG, OP.STW], 50);
set([OP.KEQ], 90);
set([OP.KSTG, OP.KSTW], 80);
/** CU charged per execution of an op, or undefined if not an opcode. */
export const gasOf = (op: number): number | undefined => GAS[op];

export const MAGIC = [0x48, 0x53];
export const VERSION = 1;
export const HEADER_LEN = 16;
export const MAX_CODE = 1024;
export const GLOBALS_LEN = 256;
export const WVARS_LEN = 32;
export const STACK_MAX = 32;
export const LOCALS_MAX = 32;
export const MAX_KEYS = 4;
export const MAX_REASONS = 16;
export const MAX_REASON_LEN = 96;
export const GAS_LIMIT = 8000;
export const RING_BYTES = 48;
export const ONE = 1_000_000n;

export const KIND = { buy: 0, sell: 1, send: 2 } as const;

export const C = {
  KIND: 0, AMOUNT: 1, VALUE: 2, SLOT: 3, NOW: 4, LAUNCH: 5, AGE: 6, LAUNCH_SLOT: 7, SUPPLY: 8, PRICE: 9,
  PROGRESS: 10, MCAP: 11, RAISED: 12, FEE: 13, SAME_WALLET: 14, IS_CREATOR: 15,
} as const;
export const CTX_FIELDS = 16;

export const W = {
  HAS_RECORD: 0, IS_POOL: 1, BALANCE: 2, BALANCE_AFTER: 3, FIRST_RECEIPT: 4, LAST_BUY_SLOT: 5, LAST_BUY: 6,
  LAST_SELL: 7, BOUGHT: 8, SOLD: 9, BUYS: 10, SELLS: 11, LAST_TRADE: 12, HELD: 13,
} as const;
export const WAL_FIELDS = 14;
export const CLOCK_FIELDS = 9;
export const MOON_FIELDS = 3;

export const T = { num: 0, int: 1, time: 2, bool: 3 } as const;
export const TYPE_SIZE = [8, 4, 4, 1];

export const SIDE = { sender: 0, receiver: 1, trader: 2, other: 3 } as const;

export const K = { CTX: 0, CONST: 1, GLOBAL: 2, WVAR: 3 } as const;
export const KC = { ZERO: 0, SENDER: 1, RECEIVER: 2, TRADER: 3, CREATOR: 4, APP: 5, OTHER: 6 } as const;

export const F = {
  CURVE: 0x01, SENDER: 0x02, RECEIVER: 0x04, APP: 0x08, WRITES_GLOBALS: 0x10, WRITES_WALLET: 0x20, READS_GLOBALS: 0x40, READS_WALLET: 0x80,
} as const;

export const FMT = { none: 0, num: 1, int: 2, duration: 3, time: 4, percent: 5 } as const;
export const FMT_MAX = 5;

/** Fixed operand bytes after the opcode (PUSHI/PUSHR: varint, returns -1). */
export function operandLen(op: number): number | undefined {
  switch (op) {
    case OP.PUSHI: case OP.PUSHR: return -1;
    case OP.END: case OP.POP: case OP.DUP: case OP.DECAY: return 0;
    case OP.ADD: case OP.SUB: case OP.MUL: case OP.DIV: case OP.MOD: case OP.NEG: case OP.ABS: case OP.MIN: case OP.MAX: case OP.MULDIV: case OP.NOT: return 0;
    case OP.EQ: case OP.NE: case OP.LT: case OP.LE: case OP.GT: case OP.GE: return 0;
    case OP.REFUSE: case OP.REFUSEV: case OP.LDL: case OP.STL: case OP.CTX: case OP.MOON: return 1;
    case OP.JMP: case OP.JZ: case OP.JNZ: case OP.WAL: case OP.WIN: case OP.LDG: case OP.STG: return 2;
    case OP.LDW: case OP.STW: case OP.KSTG: return 3;
    case OP.CLOCK: case OP.DAYLIGHT: case OP.KEQ: case OP.KSTW: return 4;
    case OP.RINGTICK: case OP.RINGAT: return 5;
    default: return undefined;
  }
}

/** Zigzag LEB128 encode of an i64 (bigint). */
export function varint(v: bigint): number[] {
  let x = BigInt.asUintN(64, (v << 1n) ^ (v >> 63n));
  const out: number[] = [];
  for (;;) {
    const b = Number(x & 0x7fn);
    x >>= 7n;
    if (x === 0n) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}

export const toHex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => { const s = h.trim(); const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16); return out; };
