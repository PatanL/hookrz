// Hookscript compiler: AST -> typed IR (names resolved, units checked) -> bytecode with a verified header.
import { parse, parseExpression, type Expr, type Stmt, type Program, type Pos, type Arg } from './parser.ts';
import { CompileError } from './lexer.ts';
import {
  OP, C, W, T, K, KC, SIDE, FMT, ONE, GAS_LIMIT, GLOBALS_LEN, WVARS_LEN, LOCALS_MAX, MAX_KEYS, MAX_REASONS, MAX_REASON_LEN,
  MAX_CODE, RING_BYTES, HEADER_LEN, VERSION, varint, toHex, gasOf,
} from './bytecode.ts';
import * as M from './math.ts';
import { zone, UNSUPPORTED, knownZones, type Zone } from './tz.ts';
import { analyze, verify, type Info } from './interp.ts';
import { decodeBase58 } from './base58.ts';

// ───── types ─────
export type Unit = 'time' | 'dur' | 'tok' | 'sol' | 'pct' | 'price' | 'count' | 'days' | null;
export type Ty =
  | { t: 'num'; unit: Unit }
  | { t: 'bool' }
  | { t: 'key' }
  | { t: 'enum'; e: 'kind' | 'weekday' | 'moon' };
const NUM = (unit: Unit = null): Ty => ({ t: 'num', unit });
const BOOL: Ty = { t: 'bool' };
const KEY: Ty = { t: 'key' };
const ENUM = (e: 'kind' | 'weekday' | 'moon'): Ty => ({ t: 'enum', e });
const tyName = (t: Ty) => (t.t === 'num' ? (t.unit === 'time' ? 'a time' : t.unit === 'dur' ? 'a duration' : 'a number') : t.t === 'bool' ? 'a condition' : t.t === 'key' ? 'a wallet key' : `a ${t.e}`);

type KRef = [number, number];
type IR =
  | { k: 'const'; v: bigint; ty: Ty }
  | { k: 'none'; ty: Ty }
  | { k: 'ctx'; f: number; ty: Ty }
  | { k: 'wal'; side: number; f: number; ty: Ty }
  | { k: 'win'; side: number; dir: number; w: IR; ty: Ty }
  | { k: 'clock'; f: number; tz: number; rule: number; ty: Ty }
  | { k: 'daylight'; lat: number; lon: number; ty: Ty }
  | { k: 'moon'; f: number; ty: Ty }
  | { k: 'decay'; x: IR; rate: IR; elapsed: IR; every: IR; ty: Ty }
  | { k: 'ringat'; off: number; w: number; ty: Ty }
  | { k: 'ldg'; st: number; off: number; ty: Ty }
  | { k: 'ldw'; side: number; st: number; off: number; ty: Ty }
  | { k: 'ldl'; slot: number; ty: Ty }
  | { k: 'key'; ref: KRef; ty: Ty }
  | { k: 'keq'; a: KRef; b: KRef; ty: Ty }
  | { k: 'un'; op: number; e: IR; ty: Ty }
  | { k: 'bin'; op: number; a: IR; b: IR; ty: Ty }
  | { k: 'muldiv'; a: IR; b: IR; c: IR; ty: Ty }
  | { k: 'and' | 'or'; a: IR; b: IR; ty: Ty }
  | { k: 'any'; items: IR[]; ty: Ty }; // OR of pre-built conditions (in-lists)

type SIR =
  | { k: 'stl'; slot: number; e: IR }
  | { k: 'stg'; st: number; off: number; e: IR }
  | { k: 'stw'; side: number; st: number; off: number; e: IR }
  | { k: 'kstg'; off: number; ref: KRef }
  | { k: 'kstw'; side: number; ref: KRef }
  | { k: 'refuse'; cond: IR | null; reason: number; arg: IR | null }
  | { k: 'allow'; cond: IR | null }
  | { k: 'if'; cond: IR; then: SIR[]; else: SIR[] };

export interface Diag { message: string; line: number; col: number; hint?: string }

// ───── storage ─────
interface Var { scope: 'global' | 'wallet'; name: string; ty: Ty; st: number; off: number; size: number; declared: boolean; pos: Pos }
const ST_KEY = 99;
function storageOf(ty: Ty): { st: number; size: number } {
  if (ty.t === 'key') return { st: ST_KEY, size: 32 };
  if (ty.t === 'bool') return { st: T.bool, size: 1 };
  if (ty.t === 'num' && ty.unit === 'time') return { st: T.time, size: 4 };
  if (ty.t === 'num' && ty.unit === 'count') return { st: T.int, size: 4 };
  return { st: T.num, size: 8 };
}
const DECL_TY: Record<string, Ty> = {
  num: NUM(), number: NUM(), amount: NUM('tok'), tokens: NUM('tok'), int: NUM('count'), time: NUM('time'), duration: NUM('dur'),
  bool: BOOL, key: KEY, pubkey: KEY, wallet: KEY,
};

const RESERVED = new Set([
  'buy', 'sell', 'send', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'new', 'full', 'first_quarter', 'last_quarter', 'waxing_crescent', 'waxing_gibbous', 'waning_gibbous', 'waning_crescent',
  'amount', 'kind', 'value', 'trader', 'buyer', 'seller', 'app', 'supply', 'now', 'wallet', 'sender', 'receiver', 'from', 'to', 'other',
  'transfer', 'coin', 'clock', 'curve', 'moon', 'true', 'false', 'none', 'key', 'since',
]);
const WEEKDAYS: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6, tues: 1, thur: 3, thurs: 3, weds: 2 };
const MOONS: Record<string, number> = { new: 0, new_moon: 0, waxing_crescent: 1, first_quarter: 2, waxing_gibbous: 3, full: 4, full_moon: 4, waning_gibbous: 5, last_quarter: 6, third_quarter: 6, waning_crescent: 7 };
const KINDS: Record<string, number> = { buy: 0, sell: 1, send: 2 };
const VIEWS: Record<string, { side: number; key: number }> = {
  wallet: { side: SIDE.trader, key: KC.TRADER }, trader: { side: SIDE.trader, key: KC.TRADER },
  sender: { side: SIDE.sender, key: KC.SENDER }, from: { side: SIDE.sender, key: KC.SENDER }, seller: { side: SIDE.sender, key: KC.SENDER }, src: { side: SIDE.sender, key: KC.SENDER },
  receiver: { side: SIDE.receiver, key: KC.RECEIVER }, to: { side: SIDE.receiver, key: KC.RECEIVER }, buyer: { side: SIDE.receiver, key: KC.RECEIVER }, dst: { side: SIDE.receiver, key: KC.RECEIVER }, recipient: { side: SIDE.receiver, key: KC.RECEIVER },
  other: { side: SIDE.other, key: KC.OTHER }, counterparty: { side: SIDE.other, key: KC.OTHER },
};
const WFIELDS: Record<string, [number, Ty]> = {
  has_record: [W.HAS_RECORD, BOOL], is_pool: [W.IS_POOL, BOOL], balance: [W.BALANCE, NUM('tok')], balance_before: [W.BALANCE, NUM('tok')],
  balance_after: [W.BALANCE_AFTER, NUM('tok')], first_receipt: [W.FIRST_RECEIPT, NUM('time')], first_buy: [W.FIRST_RECEIPT, NUM('time')],
  last_buy_slot: [W.LAST_BUY_SLOT, NUM()], last_buy: [W.LAST_BUY, NUM('time')], last_sell: [W.LAST_SELL, NUM('time')],
  bought: [W.BOUGHT, NUM('tok')], sold: [W.SOLD, NUM('tok')], buys: [W.BUYS, NUM('count')], sells: [W.SELLS, NUM('count')],
  last_trade: [W.LAST_TRADE, NUM('time')], held: [W.HELD, NUM('dur')], hold_time: [W.HELD, NUM('dur')], age: [W.HELD, NUM('dur')],
};
const V2_FIELDS = new Set([W.BOUGHT, W.SOLD, W.BUYS, W.SELLS, W.LAST_BUY, W.LAST_TRADE]);
const CLOCKF: Record<string, [number, Ty]> = {
  hour: [0, NUM('count')], minute: [1, NUM('count')], second: [2, NUM('count')], weekday: [3, ENUM('weekday')], dow: [3, ENUM('weekday')], day_of_week: [3, ENUM('weekday')],
  day: [4, NUM('count')], date: [4, NUM('count')], month: [5, NUM('count')], year: [6, NUM('count')], day_of_year: [7, NUM('count')], minute_of_day: [8, NUM('count')],
};
const PROGRAMS: Record<string, string> = {
  jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  meteora_dbc: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  dbc: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
  meteora_damm_v2: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
  damm_v2: 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG',
};

class Unknown extends Error {}

function dist(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const suggest = (w: string, list: string[]) => { const c = list.map((x) => [x, dist(w, x)] as const).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1]); return c.length ? `Did you mean ${c[0][0]}?` : undefined; };

// ───── the checker ─────
interface Scope { vars: Map<string, { slot: number; ty: Ty } | { alias: KRef; ty: Ty }>; parent: Scope | null }

class Checker {
  errors: Diag[] = [];
  warnings: Diag[] = [];
  vars = new Map<string, Var>(); // "global:name" / "wallet:name"
  implicitTypes = new Map<string, Ty>();
  phase: 'infer' | 'final' = 'infer';
  zone: Zone = { name: 'UTC', off: 0, rule: 0, lat: 5148, lon: 0 };
  rings = new Map<number, number>(); // w -> off
  ringList: { ago: number; w: number; off: number }[] = [];
  keys: string[] = []; // hex
  reasons: { fmt: number; text: string }[] = [];
  nextSlot = 0;
  maxSlot = 0;
  scope: Scope = { vars: new Map(), parent: null };
  gUsed = 0;
  wUsed = 0;
  usesV2 = false;
  usesApp = false;
  inHandler: Set<number> | null = null; // kinds the current code can run for

  prog: Program;
  constructor(prog: Program) { this.prog = prog; }

  err(msg: string, pos: Pos, hint?: string): never { throw new CompileError(msg, pos.line, pos.col, hint); }
  warn(msg: string, pos: Pos, hint?: string) { if (this.phase === 'final' && !this.warnings.some((w) => w.message === msg)) this.warnings.push({ message: msg, line: pos.line, col: pos.col, hint }); }

  lookupVar(scope: 'global' | 'wallet', name: string): Var | undefined { return this.vars.get(`${scope}:${name}`); }

  // ── declarations
  declare(prog: Program) {
    if (prog.timezone !== null) {
      const z = zone(prog.timezone);
      if (!z) this.diag(new CompileError(`Unknown timezone "${prog.timezone}"`, prog.tzPos!.line, prog.tzPos!.col, UNSUPPORTED.has(prog.timezone.toLowerCase()) ? 'Its daylight-saving rule isn\'t modeled; use a fixed offset like "UTC+12".' : `Use an IANA name (e.g. ${knownZones().slice(1, 5).join(', ')}) or "UTC+8".`));
      else this.zone = { lat: undefined, lon: undefined, ...z };
    }
    // explicit
    for (const d of prog.decls) {
      if (RESERVED.has(d.name)) { this.diag(new CompileError(`"${d.name}" is a built-in name; pick another`, d.pos.line, d.pos.col)); continue; }
      if (this.vars.has(`${d.scope}:${d.name}`)) { this.diag(new CompileError(`${d.name} is declared twice`, d.pos.line, d.pos.col)); continue; }
      const ty = DECL_TY[d.type];
      this.vars.set(`${d.scope}:${d.name}`, { scope: d.scope, name: d.name, ty, ...storageOf(ty), off: -1, declared: true, pos: d.pos });
    }
  }

  /** Syntactic pre-walk: implicit set targets in order of first appearance. */
  implicitTargets(body: Stmt[], out: { scope: 'global' | 'wallet'; name: string; pos: Pos }[]) {
    for (const s of body) {
      if (s.k === 'set') {
        const t = this.targetOf(s.target, s.pos, true);
        if (t && !this.vars.has(`${t.scope}:${t.name}`) && !out.some((o) => o.scope === t.scope && o.name === t.name)) out.push({ scope: t.scope, name: t.name, pos: s.pos });
      } else if (s.k === 'if') { this.implicitTargets(s.then, out); this.implicitTargets(s.else, out); }
      else if (s.k === 'on' || s.k === 'when') this.implicitTargets(s.body, out);
    }
  }

  /** set target path -> (scope, name, side). */
  targetOf(parts: string[], pos: Pos, quiet = false): { scope: 'global' | 'wallet'; name: string; side: number } | null {
    const fail = (m: string, h?: string) => { if (quiet) return null; this.err(m, pos, h); };
    if (parts.length === 1) {
      if (VIEWS[parts[0]] || RESERVED.has(parts[0])) return fail(`Can't set ${parts[0]}`, 'Set a coin global (set coin.x = …) or a wallet var (set wallet.x = …).');
      return { scope: 'global', name: parts[0], side: 0 };
    }
    if ((parts[0] === 'coin' || parts[0] === 'global' || parts[0] === 'g') && parts.length === 2) {
      if (['supply', 'age', 'launch', 'creator', 'launch_slot'].includes(parts[1])) return fail(`coin.${parts[1]} is read-only`);
      return { scope: 'global', name: parts[1], side: 0 };
    }
    let p = parts;
    let view = VIEWS[p[0]];
    if (p[0] === 'wallet' && p.length === 3 && VIEWS[p[1]]) { view = VIEWS[p[1]]; p = p.slice(1); }
    if (view && p.length === 2) {
      if (WFIELDS[p[1]] || p[1] === 'key' || p[1] === 'is_creator') return fail(`${parts.join('.')} is read-only`, 'Wallet vars are your own names, e.g. set wallet.hat = true.');
      return { scope: 'wallet', name: p[1], side: view.side };
    }
    return fail(`Can't set ${parts.join('.')}`, 'Set a coin global (set coin.x = …) or a wallet var (set wallet.x = …).');
  }

  diag(e: unknown) {
    if (e instanceof Unknown) return;
    if (e instanceof CompileError) { if (this.phase === 'final' && !this.errors.some((x) => x.line === e.line && x.col === e.col)) this.errors.push({ message: e.message, line: e.line, col: e.col, hint: e.hint }); return; }
    throw e;
  }

  allocate(order: { scope: 'global' | 'wallet'; name: string; pos: Pos }[]) {
    for (const o of order) {
      const ty = this.implicitTypes.get(`${o.scope}:${o.name}`);
      if (!ty) { this.diag(new CompileError(`Can't tell what type ${o.name} is`, o.pos.line, o.pos.col, `Declare it: ${o.scope === 'global' ? 'global' : 'wallet'} ${o.name}: num (or int, time, bool, key)`)); continue; }
      if (RESERVED.has(o.name)) { this.diag(new CompileError(`"${o.name}" is a built-in name; pick another`, o.pos.line, o.pos.col)); continue; }
      const t2: Ty = ty.t === 'enum' ? NUM() : ty;
      this.vars.set(`${o.scope}:${o.name}`, { scope: o.scope, name: o.name, ty: ty.t === 'enum' ? ty : t2, ...storageOf(t2), off: -1, declared: false, pos: o.pos });
    }
    for (const v of this.vars.values()) {
      if (v.scope === 'global') { v.off = this.gUsed; this.gUsed += v.size; }
      else { v.off = this.wUsed; this.wUsed += v.size; }
    }
    if (this.gUsed > GLOBALS_LEN) this.diag(new CompileError(`Globals use ${this.gUsed} of ${GLOBALS_LEN} bytes`, 1, 1, 'Use int (4 bytes) or time (4 bytes) instead of num (8), or fewer keys (32 each).'));
    if (this.wUsed > WVARS_LEN) this.diag(new CompileError(`Wallet vars use ${this.wUsed} of ${WVARS_LEN} bytes`, 1, 1, 'A key takes all 32 bytes; num 8, int/time 4, bool 1.'));
  }

  // ── scopes
  push() { this.scope = { vars: new Map(), parent: this.scope }; }
  pop() { this.scope = this.scope.parent!; }
  local(name: string) { for (let s: Scope | null = this.scope; s; s = s.parent) { const v = s.vars.get(name); if (v) return v; } return undefined; }

  // ── statements
  stmts(body: Stmt[]): SIR[] {
    const out: SIR[] = [];
    for (const s of body) {
      try { out.push(...this.stmt(s)); } catch (e) { this.diag(e); }
    }
    return out;
  }

  stmt(s: Stmt): SIR[] {
    switch (s.k) {
      case 'let': {
        if (this.scope.vars.has(s.name)) this.err(`${s.name} is already defined`, s.pos);
        if (RESERVED.has(s.name) || VIEWS[s.name]) this.err(`"${s.name}" is a built-in name; pick another`, s.pos);
        let ir: IR;
        try { ir = this.expr(s.e); } catch (e) { if (e instanceof Unknown) { this.scope.vars.set(s.name, { slot: -1, ty: NUM() }); this.unknownLets.add(s.name); } throw e; }
        if (ir.ty.t === 'key') {
          if (ir.k !== 'key' && ir.k !== 'none') this.err('A key let must be a wallet or key global', s.pos);
          this.scope.vars.set(s.name, { alias: ir.k === 'key' ? ir.ref : [K.CTX, KC.ZERO], ty: KEY });
          return [];
        }
        if (this.nextSlot >= LOCALS_MAX) this.err(`Too many lets (max ${LOCALS_MAX})`, s.pos);
        const slot = this.nextSlot++;
        this.maxSlot = Math.max(this.maxSlot, this.nextSlot);
        this.scope.vars.set(s.name, { slot, ty: ir.ty });
        return [{ k: 'stl', slot, e: ir }];
      }
      case 'set': {
        if (s.target.length === 1 && this.local(s.target[0])) this.err(`${s.target[0]} is a let (a fixed value for this transfer)`, s.pos, `To remember it, use a global: set coin.${s.target[0]} = …`);
        const t = this.targetOf(s.target, s.pos)!;
        const key = `${t.scope}:${t.name}`;
        let rhs: IR;
        if (s.op === '=') {
          rhs = this.expr(s.e);
          if (this.phase === 'infer' && !this.vars.has(key) && !this.implicitTypes.has(key)) {
            const ty: Ty = rhs.k === 'none' ? KEY : rhs.ty;
            this.implicitTypes.set(key, ty);
          }
        } else {
          rhs = this.expr(s.e);
          if (rhs.ty.t !== 'num') this.err(`${s.op} needs a number`, s.e.pos);
          if (this.phase === 'infer' && !this.vars.has(key) && !this.implicitTypes.has(key)) this.implicitTypes.set(key, NUM(rhs.ty.t === 'num' && rhs.ty.unit !== 'time' ? rhs.ty.unit : null));
        }
        const v = this.vars.get(key);
        if (!v) { if (this.phase === 'infer') return []; this.err(`Unknown ${t.scope === 'global' ? 'global' : 'wallet var'} ${t.name}`, s.pos); }
        if (s.op !== '=') {
          if (v.ty.t !== 'num') this.err(`${t.name} isn't a number`, s.pos);
          const cur: IR = t.scope === 'global' ? { k: 'ldg', st: v.st, off: v.off, ty: v.ty } : { k: 'ldw', side: t.side, st: v.st, off: v.off, ty: v.ty };
          rhs = this.arith(s.op === '+=' ? '+' : '-', cur, rhs, s.pos);
        }
        // type check
        if (v.ty.t === 'key') {
          if (rhs.k === 'none') rhs = { k: 'key', ref: [K.CTX, KC.ZERO], ty: KEY };
          if (rhs.k !== 'key') this.err(`${t.name} holds a wallet key; set it to a wallet (e.g. buyer) or none`, s.e.pos);
          const ref = (rhs as { ref: KRef }).ref;
          return [t.scope === 'global' ? { k: 'kstg', off: v.off, ref } : { k: 'kstw', side: t.side, ref }];
        }
        if (rhs.k === 'none') rhs = { k: 'const', v: 0n, ty: v.ty };
        if (!this.compatible(v.ty, rhs.ty)) this.err(`${t.name} is ${tyName(v.ty)} but this is ${tyName(rhs.ty)}`, s.e.pos);
        if (v.ty.t === 'num' && rhs.ty.t === 'num' && v.ty.unit === 'time' && rhs.ty.unit === 'dur') this.err(`${t.name} is a time but this is a duration`, s.e.pos, 'Did you mean clock.now + …?');
        return [t.scope === 'global' ? { k: 'stg', st: v.st, off: v.off, e: rhs } : { k: 'stw', side: t.side, st: v.st, off: v.off, e: rhs }];
      }
      case 'refuse': {
        const cond = s.cond ? this.cond(s.cond) : null;
        const { reason, arg } = this.reason(s.msg, s.msgPos ?? s.pos);
        if (cond && cond.k === 'const') {
          if (cond.v === 0n) { this.warn('This refuse can never happen (its condition is always false)', s.pos); return []; }
          return [{ k: 'refuse', cond: null, reason, arg }];
        }
        return [{ k: 'refuse', cond, reason, arg }];
      }
      case 'allow': return [{ k: 'allow', cond: s.cond ? this.cond(s.cond) : null }];
      case 'if': {
        const cond = this.cond(s.cond);
        this.push(); const then = this.stmts(s.then); this.pop();
        this.push(); const els = this.stmts(s.else); this.pop();
        if (cond.k === 'const') return cond.v !== 0n ? then : els;
        return [{ k: 'if', cond, then, else: els }];
      }
      case 'on': {
        const set = new Set<number>();
        for (const k of s.kinds) {
          if (k === 'buy' || k === 'buys') set.add(0);
          else if (k === 'sell' || k === 'sells') set.add(1);
          else if (k === 'send' || k === 'sends') set.add(2);
          else if (k === 'trade' || k === 'trades') { set.add(0); set.add(1); }
          else { set.add(0); set.add(1); set.add(2); }
        }
        const prev = this.inHandler;
        this.inHandler = set;
        this.push(); const body = this.stmts(s.body); this.pop();
        this.inHandler = prev;
        if (set.size === 3) return body;
        const kind: IR = { k: 'ctx', f: C.KIND, ty: ENUM('kind') };
        let cond: IR;
        if (set.size === 1) cond = { k: 'bin', op: OP.EQ, a: kind, b: { k: 'const', v: BigInt([...set][0]), ty: ENUM('kind') }, ty: BOOL };
        else { const missing = [0, 1, 2].find((x) => !set.has(x))!; cond = { k: 'bin', op: OP.NE, a: kind, b: { k: 'const', v: BigInt(missing), ty: ENUM('kind') }, ty: BOOL }; }
        return [{ k: 'if', cond, then: body, else: [] }];
      }
      case 'when': {
        const cond = this.cond(s.cond);
        this.push(); const body = this.stmts(s.body); this.pop();
        return [{ k: 'if', cond, then: body, else: [] }];
      }
    }
  }
  unknownLets = new Set<string>();

  reason(msg: string | null, pos: Pos): { reason: number; arg: IR | null } {
    let text = msg ?? `Refused by the coin's custom rule`;
    let arg: IR | null = null;
    let fmt: number = FMT.none;
    const m = text.match(/\{([^{}]*)\}/g);
    if (m && m.length > 1) this.err('A message can show one {value}', pos);
    if (m && m.length === 1) {
      const inner = m[0].slice(1, -1).trim();
      if (inner) {
        let e: Expr;
        try { e = parseExpr(inner); } catch (er) { if (er instanceof CompileError) this.err(`In the message's {${inner}}: ${er.message}`, pos, er.hint); throw er; }
        arg = this.expr(fixPos(e, pos));
        if (arg.ty.t !== 'num') this.err(`{${inner}} must be a number, time or duration`, pos);
        const u = (arg.ty as { unit: Unit }).unit;
        fmt = u === 'time' ? FMT.time : u === 'dur' ? FMT.duration : u === 'pct' ? FMT.percent : u === 'count' ? FMT.int : FMT.num;
        text = text.replace(m[0], '{}');
      }
    }
    let bytes = new TextEncoder().encode(text);
    if (bytes.length > MAX_REASON_LEN) {
      this.warn(`Message cut to ${MAX_REASON_LEN} bytes`, pos);
      let cut = MAX_REASON_LEN;
      while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
      text = new TextDecoder().decode(bytes.slice(0, cut));
      bytes = bytes.slice(0, cut);
    }
    let id = this.reasons.findIndex((r) => r.text === text && r.fmt === fmt);
    if (id < 0) {
      if (this.reasons.length >= MAX_REASONS) this.err(`Too many different messages (max ${MAX_REASONS})`, pos);
      id = this.reasons.length;
      this.reasons.push({ fmt, text });
    }
    return { reason: id, arg };
  }

  compatible(a: Ty, b: Ty) {
    if (a.t !== b.t) return false;
    if (a.t === 'enum' && b.t === 'enum') return a.e === b.e;
    return true;
  }

  cond(e: Expr): IR {
    const ir = this.expr(e);
    if (ir.ty.t !== 'bool') this.err(`Expected a condition but this is ${tyName(ir.ty)}`, e.pos, ir.ty.t === 'key' ? 'Compare it, e.g. wallet == coin.king or coin.king != none.' : 'Compare it, e.g. amount > 100.');
    return ir;
  }

  // ── expressions
  expr(e: Expr): IR {
    switch (e.k) {
      case 'num': return { k: 'const', v: e.v, ty: NUM(e.unit === 'dur' ? 'dur' : e.unit === 'pct' ? 'pct' : e.unit === 'sol' ? 'sol' : null) };
      case 'bool': return { k: 'const', v: e.v ? 1n : 0n, ty: BOOL };
      case 'none': return { k: 'none', ty: KEY };
      case 'str': this.err('A string can only be a message or a tz: / key("…") argument', e.pos);
      case 'path': return this.path(e.parts, e.pos);
      case 'call': return this.call(e.parts, e.args, e.pos);
      case 'un': {
        if (e.op === 'not') { const a = this.cond(e.e); return fold({ k: 'un', op: OP.NOT, e: a, ty: BOOL }); }
        const a = this.expr(e.e);
        if (a.ty.t !== 'num') this.err(`Can't negate ${tyName(a.ty)}`, e.pos);
        return fold({ k: 'un', op: OP.NEG, e: a, ty: a.ty });
      }
      case 'in': {
        const x = this.expr(e.e);
        const items = e.list.map((it) => this.compare('==', x, this.expr(it), it.pos));
        let ir: IR = items.length === 1 ? items[0] : fold({ k: 'any', items, ty: BOOL });
        if (e.neg) ir = fold({ k: 'un', op: OP.NOT, e: ir, ty: BOOL });
        return ir;
      }
      case 'bin': {
        if (e.op === 'and' || e.op === 'or') {
          const a = this.cond(e.a), b = this.cond(e.b);
          return fold({ k: e.op, a, b, ty: BOOL });
        }
        const a = this.expr(e.a), b = this.expr(e.b);
        if (['==', '!=', '<', '<=', '>', '>='].includes(e.op)) return this.compare(e.op, a, b, e.pos);
        return this.arith(e.op, a, b, e.pos);
      }
    }
  }

  compare(op: string, a0: IR, b0: IR, pos: Pos): IR {
    let a = a0, b = b0;
    if (a.k === 'none' && b.ty.t !== 'key') a = { k: 'const', v: 0n, ty: b.ty };
    if (b.k === 'none' && a.ty.t !== 'key') b = { k: 'const', v: 0n, ty: a.ty };
    if (a.ty.t === 'key' || b.ty.t === 'key') {
      if (a.ty.t !== 'key' || b.ty.t !== 'key') this.err(`Can't compare ${tyName(a.ty)} with ${tyName(b.ty)}`, pos);
      if (op !== '==' && op !== '!=') this.err('Keys can only be compared with == or !=', pos);
      const ra: KRef = a.k === 'key' ? a.ref : [K.CTX, KC.ZERO];
      const rb: KRef = b.k === 'key' ? b.ref : [K.CTX, KC.ZERO];
      const eq: IR = { k: 'keq', a: ra, b: rb, ty: BOOL };
      return op === '==' ? eq : { k: 'un', op: OP.NOT, e: eq, ty: BOOL };
    }
    if (!this.compatible(a.ty, b.ty)) this.err(`Can't compare ${tyName(a.ty)} with ${tyName(b.ty)}`, pos, a.ty.t === 'enum' && b.ty.t === 'num' ? 'Compare with a name like buy, sat or full.' : undefined);
    if (a.ty.t === 'bool' && op !== '==' && op !== '!=') this.err('Conditions can only be compared with == or !=', pos);
    if (a.ty.t === 'num' && b.ty.t === 'num') {
      const ua = a.ty.unit, ub = b.ty.unit;
      if ((ua === 'time' && ub === 'dur') || (ua === 'dur' && ub === 'time')) {
        const t = ua === 'time' ? 'the time' : 'the time on the right';
        this.err(`Comparing a time with a duration`, pos, `Use since(${t}) to get how long ago it was, e.g. since(wallet.first_receipt) < 2h.`);
      }
    }
    const opc = { '==': OP.EQ, '!=': OP.NE, '<': OP.LT, '<=': OP.LE, '>': OP.GT, '>=': OP.GE }[op]!;
    return fold({ k: 'bin', op: opc, a, b, ty: BOOL });
  }

  arith(op: string, a: IR, b: IR, pos: Pos): IR {
    if (a.k === 'none') a = { k: 'const', v: 0n, ty: NUM() };
    if (b.k === 'none') b = { k: 'const', v: 0n, ty: NUM() };
    if (a.ty.t !== 'num' || b.ty.t !== 'num') this.err(`Arithmetic needs numbers, not ${tyName(a.ty.t !== 'num' ? a.ty : b.ty)}`, pos);
    const ua = (a.ty as { unit: Unit }).unit, ub = (b.ty as { unit: Unit }).unit;
    let unit: Unit = null;
    const same = (x: Unit, y: Unit) => (x === y ? x : x === null ? y : y === null ? x : null);
    switch (op) {
      case '+':
        if (ua === 'time' && ub === 'time') this.err('Adding two times', pos, 'Subtract them for a duration, or add a duration to a time.');
        unit = ua === 'time' || ub === 'time' ? 'time' : same(ua, ub);
        break;
      case '-':
        if (ua === 'time' && ub === 'time') unit = 'dur';
        else if (ua === 'time') unit = 'time';
        else if (ub === 'time') this.err('Subtracting a time from a duration', pos, 'Use since(t) for how long ago t was.');
        else unit = same(ua, ub);
        break;
      case '*': unit = ua === 'pct' ? ub : ub === 'pct' ? ua : ua === null ? ub : ub === null ? ua : null; break;
      case '/': unit = ua === ub ? null : ub === null || ub === 'pct' ? ua : null; break;
      case '%': unit = ua; break;
      default: this.err(`Unknown operator ${op}`, pos);
    }
    if (unit === 'time' && op !== '+' && op !== '-') unit = null;
    const opc = { '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD }[op]!;
    return fold({ k: 'bin', op: opc, a, b, ty: NUM(unit) });
  }

  globalIR(v: Var): IR {
    if (v.ty.t === 'key') return { k: 'key', ref: [K.GLOBAL, v.off], ty: KEY };
    return { k: 'ldg', st: v.st, off: v.off, ty: v.ty };
  }
  walletVarIR(v: Var, side: number): IR {
    if (v.ty.t === 'key') return { k: 'key', ref: [K.WVAR, side], ty: KEY };
    return { k: 'ldw', side, st: v.st, off: v.off, ty: v.ty };
  }

  varRef(scope: 'global' | 'wallet', name: string, pos: Pos, side = 0): IR | null {
    const v = this.vars.get(`${scope}:${name}`);
    if (v) return scope === 'global' ? this.globalIR(v) : this.walletVarIR(v, side);
    if (this.phase === 'infer') {
      // implicit: typed in an earlier pass -> placeholder of that type; not yet -> can't type this statement yet
      const ty = this.implicitTypes.get(`${scope}:${name}`);
      if (ty) {
        if (ty.t === 'key') return { k: 'key', ref: scope === 'global' ? [K.GLOBAL, 0] : [K.WVAR, side], ty: KEY };
        return scope === 'global' ? { k: 'ldg', st: T.num, off: 0, ty } : { k: 'ldw', side, st: T.num, off: 0, ty };
      }
      if (this.pendingImplicit.has(`${scope}:${name}`)) throw new Unknown();
    }
    return null;
  }
  pendingImplicit = new Set<string>();

  path(parts: string[], pos: Pos): IR {
    const [p0] = parts;
    if (parts.length === 1) {
      const l = this.local(p0);
      if (l) {
        if (this.unknownLets.has(p0) && 'slot' in l && l.slot === -1) throw new Unknown();
        return 'alias' in l ? { k: 'key', ref: l.alias, ty: KEY } : { k: 'ldl', slot: l.slot, ty: l.ty };
      }
      const g = this.varRef('global', p0, pos);
      if (g) return g;
      switch (p0) {
        case 'amount': return this.transfer('amount', pos);
        case 'kind': return this.transfer('kind', pos);
        case 'value': return this.transfer('value', pos);
        case 'app': return this.transfer('app', pos);
        case 'supply': return { k: 'ctx', f: C.SUPPLY, ty: NUM('tok') };
        case 'now': return { k: 'ctx', f: C.NOW, ty: NUM('time') };
        case 'price': return { k: 'ctx', f: C.PRICE, ty: NUM('price') };
        case 'age': return { k: 'ctx', f: C.AGE, ty: NUM('dur') };
      }
      if (VIEWS[p0]) return { k: 'key', ref: [K.CTX, VIEWS[p0].key], ty: KEY };
      if (p0 in KINDS) return { k: 'const', v: BigInt(KINDS[p0]), ty: ENUM('kind') };
      if (p0 in WEEKDAYS) return { k: 'const', v: BigInt(WEEKDAYS[p0]), ty: ENUM('weekday') };
      if (p0 in MOONS) return { k: 'const', v: BigInt(MOONS[p0]), ty: ENUM('moon') };
      if (this.phase === 'infer') throw new Unknown();
      const names = [...this.vars.values()].map((v) => v.name);
      this.err(`Unknown name "${p0}"`, pos, suggest(p0, [...names, 'amount', 'kind', 'value', 'supply', 'now', 'wallet', 'buyer', 'seller', 'sender', 'receiver', 'trader']) ?? 'Read the transfer (transfer.amount), a wallet (wallet.balance), the curve, the clock, or a global you set.');
    }
    switch (p0) {
      case 'transfer': case 'tx': case 'trade':
        if (parts.length !== 2) break;
        return this.transfer(parts[1], pos);
      case 'coin': case 'global': case 'g': case 'token': {
        if (parts.length !== 2) break;
        const f = parts[1];
        const g = this.varRef('global', f, pos);
        if (g) return g;
        switch (f) {
          case 'supply': return { k: 'ctx', f: C.SUPPLY, ty: NUM('tok') };
          case 'age': return { k: 'ctx', f: C.AGE, ty: NUM('dur') };
          case 'launch': case 'launched': case 'launch_time': case 'launch_ts': return { k: 'ctx', f: C.LAUNCH, ty: NUM('time') };
          case 'launch_slot': return { k: 'ctx', f: C.LAUNCH_SLOT, ty: NUM() };
          case 'creator': case 'dev': return { k: 'key', ref: [K.CTX, KC.CREATOR], ty: KEY };
          case 'mcap': case 'market_cap': return { k: 'ctx', f: C.MCAP, ty: NUM('sol') };
          case 'price': return { k: 'ctx', f: C.PRICE, ty: NUM('price') };
        }
        if (this.phase === 'infer') throw new Unknown();
        this.err(`coin.${f} isn't set anywhere`, pos, suggest(f, [...this.vars.values()].filter((v) => v.scope === 'global').map((v) => v.name)) ?? `Set it first (set coin.${f} = …) or declare it (global ${f}: num).`);
      }
      case 'clock': case 'time': {
        if (parts.length !== 2) break;
        return this.clockField(parts[1], null, pos);
      }
      case 'curve': case 'pool': case 'market': {
        if (parts.length !== 2) break;
        switch (parts[1]) {
          case 'price': return { k: 'ctx', f: C.PRICE, ty: NUM('price') };
          case 'progress': return { k: 'ctx', f: C.PROGRESS, ty: NUM('pct') };
          case 'mcap': case 'market_cap': case 'marketcap': return { k: 'ctx', f: C.MCAP, ty: NUM('sol') };
          case 'raised': case 'reserve': case 'liquidity': return { k: 'ctx', f: C.RAISED, ty: NUM('sol') };
          case 'fee': case 'fees': case 'fee_rate': return { k: 'ctx', f: C.FEE, ty: NUM('pct') };
        }
        this.err(`Unknown curve field "${parts[1]}"`, pos, suggest(parts[1], ['price', 'progress', 'mcap', 'raised', 'fee', 'price_at']) ?? 'curve has price, price_at(ago:), progress, mcap, raised, fee.');
      }
      case 'moon': {
        if (parts.length !== 2) break;
        if (parts[1] === 'phase') return { k: 'moon', f: 0, ty: ENUM('moon') };
        if (parts[1] === 'illumination' || parts[1] === 'light') return { k: 'moon', f: 1, ty: NUM('pct') };
        if (parts[1] === 'age') return { k: 'moon', f: 2, ty: NUM('days') };
        if (parts[1] === 'full') return this.compare('==', { k: 'moon', f: 0, ty: ENUM('moon') }, { k: 'const', v: 4n, ty: ENUM('moon') }, pos);
        if (parts[1] === 'new') return this.compare('==', { k: 'moon', f: 0, ty: ENUM('moon') }, { k: 'const', v: 0n, ty: ENUM('moon') }, pos);
        this.err(`Unknown moon field "${parts[1]}"`, pos, 'moon has phase, illumination, age, full, new.');
      }
    }
    // wallet views
    let p = parts;
    let view = VIEWS[p0];
    if (p0 === 'wallet' && p.length >= 2 && VIEWS[p[1]] && p[1] !== 'wallet') { view = VIEWS[p[1]]; p = p.slice(1); }
    if (view) {
      if (p.length === 1 || (p.length === 2 && p[1] === 'key')) return { k: 'key', ref: [K.CTX, view.key], ty: KEY };
      if (p.length === 2) {
        const f = p[1];
        const v = this.varRef('wallet', f, pos, view.side);
        if (v) return v;
        if (f === 'is_creator' || f === 'is_dev') return { k: 'keq', a: [K.CTX, view.key], b: [K.CTX, KC.CREATOR], ty: BOOL };
        const wf = WFIELDS[f];
        if (wf) {
          if (V2_FIELDS.has(wf[0])) this.usesV2 = true; // filled by hookrz_engine from the Wallet record's counters
          return { k: 'wal', side: view.side, f: wf[0], ty: wf[1] };
        }
        if (f === 'received' || f === 'sent' || f === 'sold_in') this.err(`${p0}.${f} needs a window`, pos, `Write ${p0}.${f}(window: 1h).`);
        if (this.phase === 'infer') throw new Unknown();
        this.err(`Unknown wallet field or var "${f}"`, pos, suggest(f, [...Object.keys(WFIELDS), 'key', 'is_creator', ...[...this.vars.values()].filter((x) => x.scope === 'wallet').map((x) => x.name)]) ?? `Wallet fields: balance, held, first_receipt, last_sell, … or set your own: set wallet.${f} = …`);
      }
    }
    this.err(`Unknown name "${parts.join('.')}"`, pos, 'Read transfer.*, wallet.*, curve.*, coin.*, clock.* or moon.*.');
  }

  transfer(f: string, pos: Pos): IR {
    switch (f) {
      case 'kind': case 'type': case 'side': return { k: 'ctx', f: C.KIND, ty: ENUM('kind') };
      case 'amount': case 'size': case 'tokens': return { k: 'ctx', f: C.AMOUNT, ty: NUM('tok') };
      case 'value': case 'sol': case 'value_sol': return { k: 'ctx', f: C.VALUE, ty: NUM('sol') };
      case 'slot': return { k: 'ctx', f: C.SLOT, ty: NUM() };
      case 'trader': return { k: 'key', ref: [K.CTX, KC.TRADER], ty: KEY };
      case 'from': case 'sender': case 'seller': case 'source': return { k: 'key', ref: [K.CTX, KC.SENDER], ty: KEY };
      case 'to': case 'receiver': case 'buyer': case 'destination': return { k: 'key', ref: [K.CTX, KC.RECEIVER], ty: KEY };
      case 'app': case 'program': case 'via': this.usesApp = true; return { k: 'key', ref: [K.CTX, KC.APP], ty: KEY };
      case 'same_wallet': return { k: 'ctx', f: C.SAME_WALLET, ty: BOOL };
      case 'by_creator': case 'by_dev': return { k: 'ctx', f: C.IS_CREATOR, ty: BOOL };
      case 'now': case 'time': return { k: 'ctx', f: C.NOW, ty: NUM('time') };
      case 'price': return { k: 'ctx', f: C.PRICE, ty: NUM('price') };
    }
    this.err(`Unknown transfer field "${f}"`, pos, suggest(f, ['kind', 'amount', 'value', 'slot', 'trader', 'from', 'to', 'app', 'same_wallet', 'by_creator']) ?? 'transfer has kind, amount, value, slot, trader, from, to, app, same_wallet, by_creator.');
  }

  tzArg(args: Arg[], pos: Pos): Zone {
    const a = args.find((x) => x.name === 'tz' || x.name === 'timezone' || x.name === 'zone' || (!x.name && x.e.k === 'str'));
    if (!a) return this.zone;
    if (a.e.k !== 'str') this.err('tz: takes a timezone in quotes', a.pos, 'Example: clock.hour(tz: "Asia/Tokyo")');
    const z = zone(a.e.v);
    if (!z) this.err(`Unknown timezone "${a.e.v}"`, a.pos, UNSUPPORTED.has(a.e.v.toLowerCase()) ? 'Its daylight-saving rule isn\'t modeled; use a fixed offset like "UTC+12".' : suggest(a.e.v, knownZones()) ?? 'Use an IANA name like "Asia/Tokyo" or an offset like "UTC+8".');
    return z!;
  }

  clockField(f: string, args: Arg[] | null, pos: Pos): IR {
    if (f === 'now' || f === 'time' || f === 'unix') return { k: 'ctx', f: C.NOW, ty: NUM('time') };
    if (f === 'slot') return { k: 'ctx', f: C.SLOT, ty: NUM() };
    const cf = CLOCKF[f];
    if (!cf) this.err(`Unknown clock field "${f}"`, pos, suggest(f, ['now', 'slot', ...Object.keys(CLOCKF)]) ?? 'clock has now, slot, hour, minute, second, weekday, day, month, year, day_of_year, minute_of_day.');
    const z = args ? this.tzArg(args, pos) : this.zone;
    return { k: 'clock', f: cf[0], tz: z.off, rule: z.rule, ty: cf[1] };
  }

  arg(args: Arg[], name: string, idx: number, pos: Pos, what: string, aliases: string[] = []): Expr {
    const a = args.find((x) => x.name === name || aliases.includes(x.name ?? '')) ?? args.filter((x) => !x.name)[idx];
    if (!a) this.err(`Missing ${name}: ${what}`, pos);
    return a!.e;
  }
  numArg(args: Arg[], name: string, idx: number, pos: Pos, what: string, aliases: string[] = []): IR {
    const e = this.arg(args, name, idx, pos, what, aliases);
    const ir = this.expr(e);
    if (ir.ty.t !== 'num') this.err(`${name} must be ${what}`, e.pos);
    return ir;
  }
  constDur(args: Arg[], name: string, idx: number, pos: Pos, aliases: string[] = []): bigint {
    const e = this.arg(args, name, idx, pos, 'a duration like 10m', aliases);
    const ir = this.expr(e);
    if (ir.k !== 'const' || ir.ty.t !== 'num') this.err(`${name}: must be a fixed duration like 10m`, e.pos);
    return (ir as { v: bigint }).v;
  }

  call(parts: string[], args: Arg[], pos: Pos): IR {
    const name = parts.join('.');
    const p0 = parts[0];
    if (parts.length === 2 && (p0 === 'clock' || p0 === 'time')) return this.clockField(parts[1], args, pos);
    switch (name) {
      case 'since': case 'elapsed': case 'time_since': {
        const t = this.numArg(args, 't', 0, pos, 'a time');
        if (t.ty.t === 'num' && t.ty.unit === 'dur') this.err('since() takes a time, not a duration', pos, 'since(wallet.first_receipt) is how long ago that was.');
        return this.arith('-', { k: 'ctx', f: C.NOW, ty: NUM('time') }, t.ty.t === 'num' && t.ty.unit === null ? { ...t, ty: NUM('time') } : t, pos);
      }
      case 'min': case 'max': {
        if (args.length < 2) this.err(`${name}() needs at least two values`, pos);
        const xs = args.map((a) => this.expr(a.e));
        for (const [i, x] of xs.entries()) if (x.ty.t !== 'num') this.err(`${name}() takes numbers`, args[i].pos);
        return xs.slice(1).reduce((acc, x) => fold({ k: 'bin', op: name === 'min' ? OP.MIN : OP.MAX, a: acc, b: x, ty: acc.ty }), xs[0]);
      }
      case 'abs': { const x = this.numArg(args, 'x', 0, pos, 'a number'); return fold({ k: 'un', op: OP.ABS, e: x, ty: x.ty }); }
      case 'clamp': {
        const x = this.numArg(args, 'x', 0, pos, 'a number'), lo = this.numArg(args, 'lo', 1, pos, 'a number', ['min']), hi = this.numArg(args, 'hi', 2, pos, 'a number', ['max']);
        return fold({ k: 'bin', op: OP.MIN, a: fold({ k: 'bin', op: OP.MAX, a: x, b: lo, ty: x.ty }), b: hi, ty: x.ty });
      }
      case 'decay': {
        const x = this.numArg(args, 'x', 0, pos, 'a number', ['value']);
        const rate = this.numArg(args, 'rate', 1, pos, 'a percent like 1%', ['by', 'pct']);
        const every = this.numArg(args, 'every', 2, pos, 'a duration like 1m', ['per']);
        const t = this.numArg(args, 'since', 3, pos, 'a time', ['from', 'start']);
        const elapsed = this.arith('-', { k: 'ctx', f: C.NOW, ty: NUM('time') }, t.ty.t === 'num' && t.ty.unit === null ? { ...t, ty: NUM('time') } : t, pos);
        return { k: 'decay', x, rate, elapsed, every, ty: x.ty };
      }
      case 'fade': {
        const x = this.numArg(args, 'x', 0, pos, 'a number', ['value']);
        const over = this.numArg(args, 'over', 1, pos, 'a duration like 6h', ['within', 'in']);
        const t = this.numArg(args, 'since', 2, pos, 'a time', ['from', 'start']);
        const elapsed = this.arith('-', { k: 'ctx', f: C.NOW, ty: NUM('time') }, t.ty.t === 'num' && t.ty.unit === null ? { ...t, ty: NUM('time') } : t, pos);
        const left = fold({ k: 'bin', op: OP.MAX, a: this.arith('-', over, elapsed, pos), b: { k: 'const', v: 0n, ty: NUM('dur') }, ty: NUM('dur') });
        return { k: 'muldiv', a: x, b: left, c: over, ty: x.ty };
      }
      case 'daylight': case 'sun_up': case 'is_daylight': case 'sunlight': {
        const la = args.find((a) => a.name === 'lat'), lo = args.find((a) => a.name === 'lon' || a.name === 'lng');
        if (la || lo) {
          if (!la || !lo) this.err('daylight() needs both lat: and lon:', pos);
          const v = (e: Expr, lim: number) => { const ir = this.expr(e); if (ir.k !== 'const' || ir.ty.t !== 'num') this.err('lat/lon must be numbers', e.pos); const d = Number((ir as { v: bigint }).v) / 1e6; if (Math.abs(d) > lim) this.err('Out of range', e.pos); return Math.round(d * 100); };
          return { k: 'daylight', lat: v(la!.e, 90), lon: v(lo!.e, 180), ty: BOOL };
        }
        const z = this.tzArg(args, pos);
        if (z.lat === undefined) this.err('daylight() needs a city timezone (like "Asia/Tokyo") or lat:/lon:', pos);
        return { k: 'daylight', lat: z.lat!, lon: z.lon!, ty: BOOL };
      }
      case 'moon_phase': case 'moon.phase': return { k: 'moon', f: 0, ty: ENUM('moon') };
      case 'moon_illumination': case 'moon.illumination': return { k: 'moon', f: 1, ty: NUM('pct') };
      case 'moon_age': case 'moon.age': return { k: 'moon', f: 2, ty: NUM('days') };
      case 'full_moon': case 'is_full_moon': return this.compare('==', { k: 'moon', f: 0, ty: ENUM('moon') }, { k: 'const', v: 4n, ty: ENUM('moon') }, pos);
      case 'key': case 'program': case 'pubkey': case 'address': {
        const a = args[0];
        if (!a || a.e.k !== 'str') this.err(`${name}() takes an address in quotes`, pos, 'Example: program("jupiter") or key("JUP6Lkb…")');
        const s = (a!.e as { v: string }).v;
        const b58 = PROGRAMS[s.toLowerCase()] ?? s;
        let bytes: Uint8Array;
        try { bytes = decodeBase58(b58); } catch { this.err(`"${s}" isn't a base58 address`, a!.pos, `Known programs: ${Object.keys(PROGRAMS).join(', ')}`); }
        if (bytes!.length !== 32) this.err(`"${s}" isn't a 32-byte address`, a!.pos);
        const hex = toHex(bytes!);
        let idx = this.keys.indexOf(hex);
        if (idx < 0) { if (this.keys.length >= MAX_KEYS) this.err(`At most ${MAX_KEYS} constant keys`, pos); idx = this.keys.length; this.keys.push(hex); }
        return { k: 'key', ref: [K.CONST, idx], ty: KEY };
      }
      case 'curve.price_at': case 'price_at': case 'curve.price_ago': {
        const ago = this.constDur(args, 'ago', 0, pos, ['window', 'before']);
        const secs = ago / ONE;
        if (secs < 4n || secs > 4n * 0xffff_ffffn) this.err('price_at(ago:) must be at least 4s', pos);
        const w = Number(secs / 4n);
        let off = this.rings.get(w);
        if (off === undefined) { off = -1; this.rings.set(w, off); this.ringList.push({ ago: Number(secs), w, off }); }
        return { k: 'ringat', off, w, ty: NUM('price') };
      }
    }
    // wallet windows
    let p = parts;
    let view = VIEWS[p0];
    if (p0 === 'wallet' && p.length === 3 && VIEWS[p[1]]) { view = VIEWS[p[1]]; p = p.slice(1); }
    if (view && p.length === 2) {
      const f = p[1];
      const dir = f === 'received' || f === 'bought_in' || f === 'in' ? 0 : f === 'sent' || f === 'sold' || f === 'out' || f === 'sold_in' ? 1 : -1;
      if (dir >= 0) {
        const w = this.numArg(args, 'window', 0, pos, 'a duration like 1h', ['in', 'within', 'last', 'over']);
        if (dir === 1) this.usesV2 = true; // outflow lots, filled by hookrz_engine
        return { k: 'win', side: view.side, dir, w, ty: NUM('tok') };
      }
    }
    if (parts.length === 2 && VIEWS[p0] === undefined && p0 !== 'curve' && p0 !== 'moon') { /* fallthrough */ }
    this.err(`Unknown function ${name}()`, pos, suggest(name, ['since', 'min', 'max', 'abs', 'clamp', 'decay', 'fade', 'daylight', 'moon_phase', 'key', 'program', 'curve.price_at', 'wallet.received', 'wallet.sent']) ?? 'Built-ins: since, min, max, abs, clamp, decay, fade, daylight, moon_phase, key, program, curve.price_at, wallet.received, wallet.sent, clock.hour(tz:).');
  }
}

function fixPos(e: Expr, pos: Pos): Expr {
  const walk = (x: Expr): Expr => {
    const y = { ...x, pos } as Expr;
    if (y.k === 'un') y.e = walk(y.e);
    if (y.k === 'bin') { y.a = walk(y.a); y.b = walk(y.b); }
    if (y.k === 'in') { y.e = walk(y.e); y.list = y.list.map(walk); }
    if (y.k === 'call') y.args = y.args.map((a) => ({ ...a, e: walk(a.e), pos }));
    return y;
  };
  return walk(e);
}

/** Parse one expression (used for `{…}` inside messages). */
export const parseExpr = (src: string): Expr => parseExpression(src);


// ───── constant folding (mirrors the VM's integer semantics) ─────
function fold(ir: IR): IR {
  const c = (x: IR): x is { k: 'const'; v: bigint; ty: Ty } => x.k === 'const';
  if (ir.k === 'un' && c(ir.e)) {
    const v = ir.e.v;
    const r = ir.op === OP.NEG ? M.sat(-v) : ir.op === OP.ABS ? M.sat(v < 0n ? -v : v) : v === 0n ? 1n : 0n;
    return { k: 'const', v: r, ty: ir.ty };
  }
  if (ir.k === 'bin' && c(ir.a) && c(ir.b)) {
    const a = ir.a.v, b = ir.b.v;
    let v: bigint;
    switch (ir.op) {
      case OP.ADD: v = M.sat(a + b); break;
      case OP.SUB: v = M.sat(a - b); break;
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
      case OP.GE: v = a >= b ? 1n : 0n; break;
      default: return ir;
    }
    return { k: 'const', v, ty: ir.ty };
  }
  if ((ir.k === 'and' || ir.k === 'or') && (c(ir.a) || c(ir.b))) {
    if (c(ir.a)) { const t = ir.a.v !== 0n; return ir.k === 'and' ? (t ? ir.b : ir.a) : t ? ir.a : ir.b; }
    if (c(ir.b)) { const t = (ir.b as { v: bigint }).v !== 0n; if (ir.k === 'and' && t) return ir.a; if (ir.k === 'or' && !t) return ir.a; }
  }
  if (ir.k === 'any') {
    const items = ir.items.filter((x) => !(c(x) && x.v === 0n));
    if (items.some((x) => c(x) && x.v !== 0n)) return { k: 'const', v: 1n, ty: BOOL };
    if (!items.length) return { k: 'const', v: 0n, ty: BOOL };
    return items.length === 1 ? items[0] : { ...ir, items };
  }
  return ir;
}

// ───── code generation ─────
class Asm {
  b: number[] = [];
  labels: number[] = [];
  fix: { at: number; label: number }[] = [];
  label() { this.labels.push(-1); return this.labels.length - 1; }
  place(l: number) { this.labels[l] = this.b.length; }
  op(...xs: number[]) { this.b.push(...xs); }
  jump(op: number, l: number) { this.b.push(op, 0, 0); this.fix.push({ at: this.b.length - 2, label: l }); }
  finish(): Uint8Array {
    for (const f of this.fix) {
      const off = this.labels[f.label] - (f.at + 2);
      if (off < 0 || off > 0xffff) throw new Error('bad jump');
      this.b[f.at] = off & 0xff; this.b[f.at + 1] = off >> 8;
    }
    return Uint8Array.from(this.b);
  }
}

const isSimple = (ir: IR) => ['const', 'ctx', 'wal', 'ldg', 'ldw', 'ldl'].includes(ir.k); // cheap to re-read
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

class Gen {
  a = new Asm();
  temps: number;
  constructor(firstTemp: number) { this.temps = firstTemp; }
  maxTemp = 0;

  push(v: bigint) {
    if (v % ONE === 0n && (v / ONE) * ONE === v) this.a.op(OP.PUSHI, ...varint(v / ONE));
    else this.a.op(OP.PUSHR, ...varint(v));
  }

  expr(ir: IR) {
    const a = this.a;
    switch (ir.k) {
      case 'const':
        if (ir.ty.t === 'num') this.push(ir.v); else a.op(OP.PUSHR, ...varint(ir.v));
        return;
      case 'none': a.op(OP.PUSHR, 0); return;
      case 'ctx': a.op(OP.CTX, ir.f); return;
      case 'wal': a.op(OP.WAL, ir.side, ir.f); return;
      case 'win': this.expr(ir.w); a.op(OP.WIN, ir.side, ir.dir); return;
      case 'clock': a.op(OP.CLOCK, ir.f, ...u16(ir.tz & 0xffff), ir.rule); return;
      case 'daylight': a.op(OP.DAYLIGHT, ...u16(ir.lat & 0xffff), ...u16(ir.lon & 0xffff)); return;
      case 'moon': a.op(OP.MOON, ir.f); return;
      case 'decay': this.expr(ir.x); this.expr(ir.rate); this.expr(ir.elapsed); this.expr(ir.every); a.op(OP.DECAY); return;
      case 'ringat': a.op(OP.RINGAT, ir.off, ...u32(ir.w)); return;
      case 'ldg': a.op(OP.LDG, ir.st, ir.off); return;
      case 'ldw': a.op(OP.LDW, ir.side, ir.st, ir.off); return;
      case 'ldl': a.op(OP.LDL, ir.slot); return;
      case 'key': throw new Error('key used as a value');
      case 'keq': a.op(OP.KEQ, ir.a[0], ir.a[1], ir.b[0], ir.b[1]); return;
      case 'un': this.expr(ir.e); a.op(ir.op); return;
      case 'bin': this.expr(ir.a); this.expr(ir.b); a.op(ir.op); return;
      case 'muldiv': this.expr(ir.a); this.expr(ir.b); this.expr(ir.c); a.op(OP.MULDIV); return;
      case 'and': case 'or': {
        const end = a.label();
        this.expr(ir.a); a.op(OP.DUP); a.jump(ir.k === 'and' ? OP.JZ : OP.JNZ, end); a.op(OP.POP); this.expr(ir.b);
        a.place(end);
        return;
      }
      case 'any': {
        // in-list: share the tested value through a temp local when it isn't a single load
        const first = ir.items[0];
        let items = ir.items;
        let release = false;
        if (first.k === 'bin' && !isSimple(first.a) && ir.items.every((x) => x.k === 'bin' && sameIR(x.a, first.a))) {
          const t = this.temps++;
          this.maxTemp = Math.max(this.maxTemp, this.temps);
          if (this.temps > LOCALS_MAX) throw new CompileError('Expression needs too many temporaries', 1, 1);
          this.expr(first.a); a.op(OP.STL, t);
          items = ir.items.map((x) => ({ ...(x as { k: 'bin'; op: number; a: IR; b: IR; ty: Ty }), a: { k: 'ldl', slot: t, ty: first.a.ty } as IR }));
          release = true;
        }
        const end = a.label();
        items.forEach((x, i) => {
          this.expr(x);
          if (i < items.length - 1) { a.op(OP.DUP); a.jump(OP.JNZ, end); a.op(OP.POP); }
        });
        a.place(end);
        if (release) this.temps--;
        return;
      }
    }
  }

  /** Jump to `l` when the condition is false (short-circuit, no value left on the stack). */
  jumpIfFalse(cond: IR, l: number) {
    if (cond.k === 'un' && cond.op === OP.NOT) return this.jumpIfTrue(cond.e, l);
    if (cond.k === 'and') { this.jumpIfFalse(cond.a, l); this.jumpIfFalse(cond.b, l); return; }
    if (cond.k === 'or') { const t = this.a.label(); this.jumpIfTrue(cond.a, t); this.jumpIfFalse(cond.b, l); this.a.place(t); return; }
    this.expr(cond); this.a.jump(OP.JZ, l);
  }
  /** Jump to `l` when the condition is true. */
  jumpIfTrue(cond: IR, l: number) {
    if (cond.k === 'un' && cond.op === OP.NOT) return this.jumpIfFalse(cond.e, l);
    if (cond.k === 'or') { this.jumpIfTrue(cond.a, l); this.jumpIfTrue(cond.b, l); return; }
    if (cond.k === 'and') { const f = this.a.label(); this.jumpIfFalse(cond.a, f); this.jumpIfTrue(cond.b, l); this.a.place(f); return; }
    if (cond.k === 'any' && cond.items.every((x) => x.k !== 'bin' || isSimple(x.a))) { for (const x of cond.items) this.jumpIfTrue(x, l); return; }
    this.expr(cond); this.a.jump(OP.JNZ, l);
  }

  stmts(ss: SIR[]) { for (const s of ss) this.stmt(s); }
  stmt(s: SIR) {
    const a = this.a;
    switch (s.k) {
      case 'stl': this.expr(s.e); a.op(OP.STL, s.slot); return;
      case 'stg': this.expr(s.e); a.op(OP.STG, s.st, s.off); return;
      case 'stw': this.expr(s.e); a.op(OP.STW, s.side, s.st, s.off); return;
      case 'kstg': a.op(OP.KSTG, s.off, s.ref[0], s.ref[1]); return;
      case 'kstw': a.op(OP.KSTW, s.side, 0, s.ref[0], s.ref[1]); return;
      case 'refuse': {
        const skip = a.label();
        if (s.cond) this.jumpIfFalse(s.cond, skip);
        if (s.arg) { this.expr(s.arg); a.op(OP.REFUSEV, s.reason); } else a.op(OP.REFUSE, s.reason);
        a.place(skip);
        return;
      }
      case 'allow': {
        const skip = a.label();
        if (s.cond) this.jumpIfFalse(s.cond, skip);
        a.op(OP.END);
        a.place(skip);
        return;
      }
      case 'if': {
        const els = a.label(), end = a.label();
        this.jumpIfFalse(s.cond, els);
        this.stmts(s.then);
        if (s.else.length) { a.jump(OP.JMP, end); a.place(els); this.stmts(s.else); a.place(end); }
        else { a.place(els); a.place(end); }
        return;
      }
    }
  }
}

function sameIR(x: IR, y: IR): boolean { return JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(y, (_, v) => (typeof v === 'bigint' ? v.toString() : v)); }

function patchRings(ss: SIR[], map: Map<number, number>) {
  const fix = (ir: IR): IR => {
    switch (ir.k) {
      case 'ringat': return { ...ir, off: map.get(ir.w)! };
      case 'win': return { ...ir, w: fix(ir.w) };
      case 'decay': return { ...ir, x: fix(ir.x), rate: fix(ir.rate), elapsed: fix(ir.elapsed), every: fix(ir.every) };
      case 'un': return { ...ir, e: fix(ir.e) };
      case 'bin': return { ...ir, a: fix(ir.a), b: fix(ir.b) };
      case 'muldiv': return { ...ir, a: fix(ir.a), b: fix(ir.b), c: fix(ir.c) };
      case 'and': case 'or': return { ...ir, a: fix(ir.a), b: fix(ir.b) };
      case 'any': return { ...ir, items: ir.items.map(fix) };
      default: return ir;
    }
  };
  const st = (s: SIR): SIR => {
    switch (s.k) {
      case 'stl': case 'stg': case 'stw': return { ...s, e: fix(s.e) };
      case 'refuse': return { ...s, cond: s.cond && fix(s.cond), arg: s.arg && fix(s.arg) };
      case 'allow': return { ...s, cond: s.cond && fix(s.cond) };
      case 'if': return { ...s, cond: fix(s.cond), then: s.then.map(st), else: s.else.map(st) };
      default: return s;
    }
  };
  return ss.map(st);
}

// ───── public API ─────
export interface Abi {
  name: string; timezone: string;
  globals: { name: string; type: string; offset: number; size: number }[];
  wallet: { name: string; type: string; offset: number; size: number }[];
  rings: { ago: number; bucket: number; offset: number }[];
  payouts: { share_bps: number; to: string; mode: 'stream' | 'pot' | 'split' }[];
  reasons: string[];
  needs: { walletV2: boolean; app: boolean };
}
export interface CompileOk {
  ok: true; name: string; bytes: Uint8Array; hex: string; size: number; ops: number; cu: number; info: Info; abi: Abi;
  warnings: Diag[]; listing: string;
}
export interface CompileFail { ok: false; errors: Diag[]; warnings: Diag[] }
export type CompileResult = CompileOk | CompileFail;

const typeName = (v: Var) => (v.ty.t === 'key' ? 'key' : v.st === T.bool ? 'bool' : v.st === T.time ? 'time' : v.st === T.int ? 'int' : 'num');

export function compile(src: string): CompileResult {
  let prog: Program;
  try { prog = parse(src); } catch (e) {
    if (e instanceof CompileError) return { ok: false, errors: [{ message: e.message, line: e.line, col: e.col, hint: e.hint }], warnings: [] };
    throw e;
  }
  const ck = new Checker(prog);
  ck.phase = 'final';
  ck.declare(prog);
  const declErrors = [...ck.errors];
  ck.errors = [];
  // inference passes
  const order: { scope: 'global' | 'wallet'; name: string; pos: Pos }[] = [];
  ck.implicitTargets(prog.body, order);
  for (const o of order) ck.pendingImplicit.add(`${o.scope}:${o.name}`);
  ck.phase = 'infer';
  for (let pass = 0; pass < 6; pass++) {
    const before = ck.implicitTypes.size;
    const saved = { keys: [...ck.keys], reasons: [...ck.reasons], nextSlot: ck.nextSlot, maxSlot: ck.maxSlot, rings: new Map(ck.rings), ringList: [...ck.ringList] };
    ck.scope = { vars: new Map(), parent: null };
    ck.unknownLets.clear();
    ck.stmts(prog.body);
    Object.assign(ck, { keys: saved.keys, reasons: saved.reasons, nextSlot: saved.nextSlot, maxSlot: saved.maxSlot, rings: saved.rings, ringList: saved.ringList });
    if (ck.implicitTypes.size === before && pass > 0) break;
  }
  ck.phase = 'final';
  ck.errors = declErrors;
  ck.pendingImplicit.clear();
  ck.allocate(order);
  ck.scope = { vars: new Map(), parent: null };
  ck.unknownLets.clear();
  let body = ck.stmts(prog.body);
  // payouts
  let total = 0n;
  for (const p of prog.payouts) {
    total += p.pct;
    if (p.mode === 'split') { const v = ck.vars.get(`wallet:${p.to}`); if (!v || v.ty.t !== 'bool') ck.diag(new CompileError(`payout … to wallets where ${p.to}: ${p.to} must be a bool wallet var`, p.pos.line, p.pos.col)); }
    else { const v = ck.vars.get(`global:${p.to}`); if (!v || v.ty.t !== 'key') ck.diag(new CompileError(`payout … to ${p.to}: ${p.to} must be a key global (who gets paid)`, p.pos.line, p.pos.col)); }
  }
  if (total > ONE) ck.diag(new CompileError('Payouts add up to more than 100% of creator fees', prog.payouts[0].pos.line, prog.payouts[0].pos.col));
  // rings go after the declared vars
  const ringMap = new Map<number, number>();
  for (const r of ck.ringList) { r.off = ck.gUsed; ringMap.set(r.w, r.off); ck.gUsed += RING_BYTES; }
  if (ck.gUsed > GLOBALS_LEN && ck.ringList.length) ck.diag(new CompileError(`Globals + price_at samples use ${ck.gUsed} of ${GLOBALS_LEN} bytes`, 1, 1, 'Each different price_at(ago:) window takes 48 bytes.'));
  body = patchRings(body, ringMap);
  if (ck.errors.length) return { ok: false, errors: ck.errors.sort((a, b) => a.line - b.line || a.col - b.col), warnings: ck.warnings };

  // code
  const g = new Gen(ck.maxSlot);
  for (const r of ck.ringList) g.a.op(OP.RINGTICK, r.off, ...u32(r.w));
  try { g.stmts(body); } catch (e) {
    if (e instanceof CompileError) return { ok: false, errors: [{ message: e.message, line: e.line, col: e.col, hint: e.hint }], warnings: ck.warnings };
    throw e;
  }
  // trailing END is implicit; strip a final END (falling off the end allows, for free)
  const code = g.a.finish();
  const keys = ck.keys.map((h) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))));
  const reasonBytes: number[] = [];
  for (const r of ck.reasons) { const t = new TextEncoder().encode(r.text); reasonBytes.push(r.fmt, t.length, ...t); }
  const total0 = HEADER_LEN + 32 * keys.length + reasonBytes.length + code.length;
  const s = new Uint8Array(total0);
  s.set([0x48, 0x53, VERSION, 0, keys.length, ck.reasons.length, ...u16(code.length)], 0);
  keys.forEach((k, i) => s.set(k, HEADER_LEN + 32 * i));
  s.set(reasonBytes, HEADER_LEN + 32 * keys.length);
  s.set(code, HEADER_LEN + 32 * keys.length + reasonBytes.length);
  if (total0 > MAX_CODE) return { ok: false, errors: [{ message: `The script is ${total0} bytes; the limit is ${MAX_CODE}`, line: 1, col: 1, hint: 'Shorten messages, merge conditions, or drop a rule.' }], warnings: ck.warnings };
  let info: Info;
  try { info = analyzeNoLimit(s); } catch (e) {
    const code2 = (e as { code?: string }).code ?? String(e);
    const msg = code2 === 'StackOverflow' ? 'An expression is too deeply nested (stack limit 32)' : code2 === 'TooManyLabels' ? 'Too many nested conditions (more than 64 open branches)' : `Internal: ${code2}`;
    return { ok: false, errors: [{ message: msg, line: 1, col: 1, hint: 'Split the condition into separate refuse statements.' }], warnings: ck.warnings };
  }
  if (info.gasMax > GAS_LIMIT) return { ok: false, errors: [{ message: `Worst case costs ${info.gasMax.toLocaleString('en-US')} CU; the limit is ${GAS_LIMIT.toLocaleString('en-US')}`, line: 1, col: 1, hint: 'Clock, moon, daylight and decay reads are the expensive ones: read each once into a let.' }], warnings: ck.warnings };
  s[3] = info.flags;
  s.set(u16(info.gasMax), 8);
  s.set(u16(info.globalsLen), 10);
  s[12] = info.wvarsLen; s[13] = info.maxStack; s[14] = info.nLocals;
  info = verify(s);
  const vars = [...ck.vars.values()];
  const abi: Abi = {
    name: prog.name, timezone: ck.zone.name,
    globals: vars.filter((v) => v.scope === 'global').map((v) => ({ name: v.name, type: typeName(v), offset: v.off, size: v.size })),
    wallet: vars.filter((v) => v.scope === 'wallet').map((v) => ({ name: v.name, type: typeName(v), offset: v.off, size: v.size })),
    rings: ck.ringList.map((r) => ({ ago: r.ago, bucket: r.w, offset: r.off })),
    payouts: prog.payouts.map((p) => ({ share_bps: Number(p.pct / 100n), to: p.to, mode: p.mode })),
    reasons: ck.reasons.map((r) => r.text),
    needs: { walletV2: ck.usesV2, app: ck.usesApp },
  };
  return { ok: true, name: prog.name, bytes: s, hex: toHex(s), size: s.length, ops: info.ops, cu: info.gasMax, info, abi, warnings: ck.warnings, listing: disasm(s) };
}

function analyzeNoLimit(s: Uint8Array): Info { return analyze(s, { noLimit: true }); }
function opLen(s: Uint8Array, i: number, o: number): number {
  if (o === OP.PUSHI || o === OP.PUSHR) { let j = i; while (j < s.length && (s[j] & 0x80)) j++; return j - i + 1; }
  const L: Record<number, number> = { [OP.REFUSE]: 1, [OP.REFUSEV]: 1, [OP.LDL]: 1, [OP.STL]: 1, [OP.CTX]: 1, [OP.MOON]: 1, [OP.JMP]: 2, [OP.JZ]: 2, [OP.JNZ]: 2, [OP.WAL]: 2, [OP.WIN]: 2, [OP.LDG]: 2, [OP.STG]: 2, [OP.LDW]: 3, [OP.STW]: 3, [OP.KSTG]: 3, [OP.CLOCK]: 4, [OP.DAYLIGHT]: 4, [OP.KEQ]: 4, [OP.KSTW]: 4, [OP.RINGTICK]: 5, [OP.RINGAT]: 5 };
  return L[o] ?? 0;
}

/** Human-readable listing. */
export function disasm(s: Uint8Array): string {
  const codeLen = s[6] | (s[7] << 8);
  const start = s.length - codeLen;
  const lines: string[] = [];
  const names: Record<number, string> = Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k]));
  for (let i = start; i < s.length;) {
    const at = i - start;
    const o = s[i++];
    const len = opLen(s, i, o);
    const operands = Array.from(s.slice(i, i + len));
    let txt = names[o] ?? `?${o}`;
    if (o === OP.PUSHI || o === OP.PUSHR) {
      let x = 0n, sh = 0n; for (const b of operands) { x |= BigInt(b & 0x7f) << sh; sh += 7n; }
      const v = (x >> 1n) ^ -(x & 1n);
      txt += ` ${o === OP.PUSHI ? v : v.toString() + (v % ONE === 0n ? '' : ` (${Number(v) / 1e6})`)}`;
    } else if (o === OP.JMP || o === OP.JZ || o === OP.JNZ) txt += ` → ${at + 3 + (operands[0] | (operands[1] << 8))}`;
    else if (operands.length) txt += ' ' + operands.join(' ');
    lines.push(`${String(at).padStart(4)}  ${txt}`);
    i += len;
  }
  return lines.join('\n');
}
