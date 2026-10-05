// Hookscript parser: tokens -> AST (positions on every node).
import { lex, CompileError, type Tok, type Unit } from './lexer.ts';

export interface Pos { line: number; col: number }
export type Expr =
  | { k: 'num'; v: bigint; unit: Unit; pos: Pos }
  | { k: 'bool'; v: boolean; pos: Pos }
  | { k: 'none'; pos: Pos }
  | { k: 'str'; v: string; pos: Pos }
  | { k: 'path'; parts: string[]; pos: Pos }
  | { k: 'call'; parts: string[]; args: Arg[]; pos: Pos }
  | { k: 'un'; op: '-' | 'not'; e: Expr; pos: Pos }
  | { k: 'bin'; op: string; a: Expr; b: Expr; pos: Pos }
  | { k: 'in'; e: Expr; list: Expr[]; neg: boolean; pos: Pos };
export interface Arg { name?: string; e: Expr; pos: Pos }

export type Stmt =
  | { k: 'let'; name: string; e: Expr; pos: Pos }
  | { k: 'set'; target: string[]; op: '=' | '+=' | '-='; e: Expr; pos: Pos }
  | { k: 'refuse'; cond: Expr | null; msg: string | null; msgPos: Pos | null; pos: Pos }
  | { k: 'allow'; cond: Expr | null; pos: Pos }
  | { k: 'if'; cond: Expr; then: Stmt[]; else: Stmt[]; pos: Pos }
  | { k: 'on'; kinds: string[]; body: Stmt[]; pos: Pos }
  | { k: 'when'; cond: Expr; body: Stmt[]; pos: Pos };

export interface Decl { scope: 'global' | 'wallet'; name: string; type: string; pos: Pos }
export interface Payout { pct: bigint; to: string; mode: 'stream' | 'pot' | 'split'; pos: Pos }
export interface Program { name: string; timezone: string | null; tzPos: Pos | null; decls: Decl[]; payouts: Payout[]; body: Stmt[] }

const KINDS = new Set(['buy', 'sell', 'send', 'trade', 'trades', 'any', 'transfer', 'transfers', 'buys', 'sells', 'sends', 'all', 'every']);
const TYPES = new Set(['num', 'number', 'int', 'time', 'bool', 'key', 'pubkey', 'wallet', 'amount', 'tokens', 'duration']);
const STMT_START = new Set(['let', 'set', 'refuse', 'allow', 'if', 'on', 'when', 'global', 'wallet', 'payout', 'timezone', 'rule']);

class P {
  i = 0;
  toks: Tok[];
  constructor(toks: Tok[]) { this.toks = toks; }
  get cur(): Tok { return this.toks[this.i]; }
  peek(n = 1): Tok { return this.toks[Math.min(this.i + n, this.toks.length - 1)]; }
  pos(t: Tok = this.cur): Pos { return { line: t.line, col: t.col }; }
  err(msg: string, t: Tok = this.cur, hint?: string): never { throw new CompileError(msg, t.line, t.col, hint); }
  isOp(v: string, t: Tok = this.cur) { return t.t === 'op' && t.v === v; }
  isId(v: string, t: Tok = this.cur) { return t.t === 'id' && t.v === v; }
  eatOp(v: string) { if (this.isOp(v)) { this.i++; return true; } return false; }
  eatId(v: string) { if (this.isId(v)) { this.i++; return true; } return false; }
  expectOp(v: string, hint?: string) { if (!this.eatOp(v)) this.err(`Expected "${v}" but found ${this.describe()}`, this.cur, hint); }
  ident(what = 'a name'): string {
    const t = this.cur;
    if (t.t !== 'id') this.err(`Expected ${what} but found ${this.describe()}`);
    this.i++;
    return t.v;
  }
  describe(t: Tok = this.cur) {
    if (t.t === 'eof') return 'the end of the script';
    if (t.t === 'str') return `"${t.v}"`;
    if (t.t === 'num') return t.text;
    return `"${t.v}"`;
  }
}

export function parse(src: string): Program {
  const p = new P(lex(src));
  const prog: Program = { name: '', timezone: null, tzPos: null, decls: [], payouts: [], body: [] };
  while (p.eatOp(';'));
  if (p.isId('rule')) {
    p.i++;
    const t = p.cur;
    if (t.t !== 'str') p.err('Expected the rule name in quotes after "rule"', t, 'Example: rule "closed on weekends"');
    prog.name = t.v;
    p.i++;
  } else {
    p.err('A script starts with rule "name"', p.cur, 'Example: rule "closed on weekends"');
  }
  while (p.cur.t !== 'eof') {
    if (p.eatOp(';')) continue;
    const t = p.cur;
    if (p.isId('timezone')) {
      p.i++;
      const z = p.cur;
      if (z.t !== 'str') p.err('Expected a timezone in quotes', z, 'Example: timezone "America/New_York"');
      prog.timezone = z.v; prog.tzPos = p.pos(z); p.i++;
      continue;
    }
    if ((p.isId('global') || (p.isId('wallet') && p.peek().t === 'id') || (p.isId('coin') && p.peek().t === 'id' && !p.isOp('.', p.peek()))) && !p.isOp('.', p.peek())) {
      const scope = p.isId('global') || p.isId('coin') ? 'global' : 'wallet';
      p.i++;
      p.eatId('var');
      const nt = p.cur;
      const name = p.ident('a variable name');
      let type = 'num';
      if (p.eatOp(':')) {
        const tt = p.cur;
        type = p.ident('a type (num, int, time, bool, key)');
        if (!TYPES.has(type)) p.err(`Unknown type "${type}"`, tt, 'Types: num, int, time, bool, key.');
      }
      if (p.isOp('=')) p.err('Globals and wallet vars start at 0 / false / none; initial values are not supported', p.cur, 'Drop the "= …" and use a let constant instead.');
      prog.decls.push({ scope, name, type, pos: p.pos(nt) });
      continue;
    }
    if (p.isId('payout')) {
      p.i++;
      const nt = p.cur;
      if (nt.t !== 'num' || nt.unit !== 'pct') p.err('Expected a percentage after "payout"', nt, 'Example: payout 50% to king');
      p.i++;
      p.eatId('of'); p.eatId('fees'); p.eatId('creator'); p.eatId('fees');
      if (!p.eatId('to')) p.err('Expected "to"', p.cur, 'Example: payout 50% to king');
      if (p.eatId('wallets') || p.eatId('holders')) {
        p.eatId('where'); p.eatId('with');
        const name = p.ident('a wallet bool var');
        prog.payouts.push({ pct: nt.v, to: name, mode: 'split', pos: p.pos(nt) });
      } else {
        p.eatId('the'); p.eatId('coin'); p.eatOp('.');
        const name = p.ident('a key global');
        let mode: 'stream' | 'pot' = 'stream';
        if (p.eatId('as')) { if (!p.eatId('pot')) p.err('Expected "pot"'); mode = 'pot'; }
        prog.payouts.push({ pct: nt.v, to: name, mode, pos: p.pos(nt) });
      }
      continue;
    }
    if (p.isId('rule')) p.err('Only one rule per script', t);
    prog.body.push(...section(p, true));
  }
  return prog;
}

/** A top-level item: a section (on/when) or a statement. */
function section(p: P, top: boolean): Stmt[] {
  const t = p.cur;
  if (p.isId('on')) {
    p.i++;
    const kinds: string[] = [];
    do {
      const kt = p.cur;
      const k = p.ident('buy, sell, send, trade or any');
      if (!KINDS.has(k)) p.err(`"on ${k}" isn't a transfer kind`, kt, 'Use on buy, on sell, on send, on trade (buy or sell) or on any.');
      kinds.push(k);
    } while (p.eatOp(',') || p.eatId('or') || p.eatId('and'));
    const body = sectionBody(p, top);
    return [{ k: 'on', kinds, body, pos: p.pos(t) }];
  }
  if (p.isId('when')) {
    p.i++;
    const cond = expr(p);
    const body = sectionBody(p, top);
    return [{ k: 'when', cond, body, pos: p.pos(t) }];
  }
  return [stmt(p)];
}

function sectionBody(p: P, top: boolean): Stmt[] {
  if (p.eatOp('{')) return block(p);
  p.eatOp(':');
  // ':' form: statements until the next section header (or block end)
  const body: Stmt[] = [];
  while (p.cur.t !== 'eof' && !p.isOp('}') && !p.isId('on') && !p.isId('when') && !(top && (p.isId('global') || p.isId('payout') || p.isId('timezone')))) {
    if (p.eatOp(';')) continue;
    body.push(stmt(p));
  }
  return body;
}

function block(p: P): Stmt[] {
  const out: Stmt[] = [];
  while (!p.isOp('}')) {
    if (p.cur.t === 'eof') p.err('Missing "}"', p.cur);
    if (p.eatOp(';')) continue;
    if (p.isId('on') || p.isId('when')) out.push(...section(p, false));
    else out.push(stmt(p));
  }
  p.i++;
  return out;
}

function stmt(p: P): Stmt {
  const t = p.cur;
  const pos = p.pos(t);
  if (p.eatId('let')) {
    const name = p.ident('a name after "let"');
    if (!p.eatOp('=')) p.expectOp('=');
    return { k: 'let', name, e: expr(p), pos };
  }
  if (p.eatId('set') || p.eatId('mark')) {
    const target: string[] = [p.ident('what to set (a global like coin.king or a wallet var like wallet.hat)')];
    while (p.eatOp('.')) target.push(p.ident());
    let op: '=' | '+=' | '-=';
    if (p.eatOp('=') || p.eatId('to')) op = '=';
    else if (p.eatOp('+=')) op = '+=';
    else if (p.eatOp('-=')) op = '-=';
    else if (p.isOp('==')) p.err('Use "=" to set a value ("==" compares)', p.cur);
    else p.err(`Expected "=", "+=" or "-=" after set ${target.join('.')}`, p.cur);
    return { k: 'set', target, op: op!, e: expr(p), pos };
  }
  if (p.eatId('refuse') || p.eatId('deny') || p.eatId('block') || p.eatId('reject')) {
    let cond: Expr | null = null;
    if (p.eatId('if') || p.eatId('when') || p.eatId('unless')) {
      const neg = p.toks[p.i - 1].v === 'unless';
      cond = expr(p);
      if (neg) cond = { k: 'un', op: 'not', e: cond, pos: cond.pos };
    }
    let msg: string | null = null, msgPos: Pos | null = null;
    if (p.eatId('because') || p.eatId('with') || p.eatId('reason') || p.eatOp(':')) {
      const m = p.cur;
      if (m.t !== 'str') p.err('Expected the refusal message in quotes after "because"', m, 'Example: because "Closed on weekends"');
      msg = m.v; msgPos = p.pos(m); p.i++;
    }
    if (cond === null && msg === null) p.err('Expected "if <condition>" or "because" after refuse', p.cur);
    return { k: 'refuse', cond, msg, msgPos, pos };
  }
  if (p.eatId('allow') || p.eatId('accept') || p.eatId('pass')) {
    let cond: Expr | null = null;
    if (p.eatId('if') || p.eatId('when')) cond = expr(p);
    return { k: 'allow', cond, pos };
  }
  if (p.eatId('if')) return ifStmt(p, pos);
  if (p.isId('else')) p.err('"else" without a matching "if { … }"', t);
  if (p.isOp('}')) p.err('Unexpected "}"', t);
  if (t.t === 'id' && (p.isOp('=', p.peek()) || p.isOp('+=', p.peek()) || p.isOp('-=', p.peek()) || p.isOp('.', p.peek()))) {
    // bare assignment "coin.x = 1" -> hint
    let j = p.i; while (p.toks[j].t === 'id' && p.isOp('.', p.toks[j + 1])) j += 2;
    if (p.isOp('=', p.toks[j + 1]) || p.isOp('+=', p.toks[j + 1]) || p.isOp('-=', p.toks[j + 1])) p.err('Assignments start with "set"', t, `Write: set ${p.toks.slice(p.i, j + 1).map((x) => x.v).join('')} …`);
  }
  p.err(`Expected a statement (let, set, refuse, allow, if) but found ${p.describe()}`, t);
}

function ifStmt(p: P, pos: Pos): Stmt {
  const cond = expr(p);
  p.eatId('then');
  let then: Stmt[];
  if (p.eatOp('{')) then = block(p);
  else { p.eatOp(':'); then = [stmt(p)]; }
  let els: Stmt[] = [];
  if (p.eatId('else')) {
    const ep = p.pos();
    if (p.eatId('if')) els = [ifStmt(p, ep)];
    else if (p.eatOp('{')) els = block(p);
    else { p.eatOp(':'); els = [stmt(p)]; }
  }
  return { k: 'if', cond, then, else: els, pos };
}

// ───── expressions ─────
function expr(p: P): Expr { return orE(p); }

function orE(p: P): Expr {
  let a = andE(p);
  while (p.isId('or')) { const pos = p.pos(); p.i++; a = { k: 'bin', op: 'or', a, b: andE(p), pos }; }
  return a;
}
function andE(p: P): Expr {
  let a = notE(p);
  while (p.isId('and')) { const pos = p.pos(); p.i++; a = { k: 'bin', op: 'and', a, b: notE(p), pos }; }
  return a;
}
function notE(p: P): Expr {
  if (p.isId('not')) { const pos = p.pos(); p.i++; return { k: 'un', op: 'not', e: notE(p), pos }; }
  return cmpE(p);
}
const CMP: Record<string, string> = { '==': '==', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=', '=': '==' };
function cmpE(p: P): Expr {
  const a = sumE(p);
  const t = p.cur;
  if (t.t === 'op' && CMP[t.v] && !(t.v === '=' )) { p.i++; return { k: 'bin', op: CMP[t.v], a, b: sumE(p), pos: p.pos(t) }; }
  if (t.t === 'op' && t.v === '=') p.err('Use "==" to compare', t);
  if (p.isId('is')) {
    p.i++;
    const neg = p.eatId('not');
    if (p.eatId('in')) return inList(p, a, neg, t);
    if (p.eatId('above') || p.eatId('over') || (p.eatId('greater') && p.eatId('than'))) return { k: 'bin', op: neg ? '<=' : '>', a, b: sumE(p), pos: p.pos(t) };
    if (p.eatId('below') || p.eatId('under') || (p.eatId('less') && p.eatId('than'))) return { k: 'bin', op: neg ? '>=' : '<', a, b: sumE(p), pos: p.pos(t) };
    return { k: 'bin', op: neg ? '!=' : '==', a, b: sumE(p), pos: p.pos(t) };
  }
  if (p.isId('in')) { p.i++; return inList(p, a, false, t); }
  if (p.isId('not') && p.isId('in', p.peek())) { p.i += 2; return inList(p, a, true, t); }
  if (p.isId('between')) {
    p.i++;
    const lo = sumE(p);
    if (!p.eatId('and')) p.err('Expected "and" in "between … and …"');
    const hi = sumE(p);
    const pos = p.pos(t);
    return { k: 'bin', op: 'and', a: { k: 'bin', op: '>=', a, b: lo, pos }, b: { k: 'bin', op: '<=', a, b: hi, pos }, pos };
  }
  return a;
}
function inList(p: P, e: Expr, neg: boolean, t: Tok): Expr {
  const open = p.eatOp('[') ? ']' : p.eatOp('(') ? ')' : null;
  if (!open) p.err('Expected "[" after "in"', p.cur, 'Example: clock.weekday in [sat, sun]');
  const list: Expr[] = [];
  if (!p.isOp(open!)) {
    do { list.push(sumE(p)); } while (p.eatOp(','));
  }
  p.expectOp(open!);
  if (!list.length) p.err('Empty list', t);
  return { k: 'in', e, list, neg, pos: p.pos(t) };
}
function sumE(p: P): Expr {
  let a = mulE(p);
  while (p.isOp('+') || p.isOp('-')) { const t = p.cur; p.i++; a = { k: 'bin', op: t.v, a, b: mulE(p), pos: p.pos(t) }; }
  return a;
}
function mulE(p: P): Expr {
  let a = unE(p);
  for (;;) {
    if (p.isOp('*') || p.isOp('/') || p.isOp('%')) { const t = p.cur; p.i++; a = { k: 'bin', op: t.v, a, b: unE(p), pos: p.pos(t) }; continue; }
    if (p.isId('of') && a.k === 'num' && a.unit === 'pct') { const t = p.cur; p.i++; a = { k: 'bin', op: '*', a: unE(p), b: a, pos: p.pos(t) }; continue; }
    if (p.isId('times')) { const t = p.cur; p.i++; a = { k: 'bin', op: '*', a, b: unE(p), pos: p.pos(t) }; continue; }
    return a;
  }
}
function unE(p: P): Expr {
  if (p.isOp('-')) { const pos = p.pos(); p.i++; return { k: 'un', op: '-', e: unE(p), pos }; }
  if (p.isOp('+')) { p.i++; return unE(p); }
  return postfix(p);
}
function postfix(p: P): Expr {
  const t = p.cur;
  const pos = p.pos(t);
  if (t.t === 'num') { p.i++; return { k: 'num', v: t.v, unit: t.unit, pos }; }
  if (t.t === 'str') { p.i++; return { k: 'str', v: t.v, pos }; }
  if (p.eatOp('(')) { const e = expr(p); p.expectOp(')'); return e; }
  if (t.t === 'id') {
    if (t.v === 'true' || t.v === 'false') { p.i++; return { k: 'bool', v: t.v === 'true', pos }; }
    if (t.v === 'none' || t.v === 'nobody' || t.v === 'null' || t.v === 'nil') { p.i++; return { k: 'none', pos }; }
    if (STMT_START.has(t.v) && !['wallet', 'set', 'on'].includes(t.v)) p.err(`"${t.v}" can't start an expression`, t);
    p.i++;
    const parts = [t.v];
    while (p.isOp('.') && p.peek().t === 'id') { p.i++; parts.push(p.ident()); }
    if (p.isOp('(')) {
      p.i++;
      const args: Arg[] = [];
      if (!p.isOp(')')) {
        do {
          const at = p.cur;
          if (at.t === 'id' && p.isOp(':', p.peek())) { p.i += 2; args.push({ name: at.v, e: expr(p), pos: p.pos(at) }); }
          else args.push({ e: expr(p), pos: p.pos(at) });
        } while (p.eatOp(','));
      }
      p.expectOp(')', 'Close the call with ")"');
      return { k: 'call', parts, args, pos };
    }
    return { k: 'path', parts, pos };
  }
  if (t.t === 'eof') p.err('The script ended in the middle of an expression', t);
  p.err(`Expected a value but found ${p.describe()}`, t);
}

/** Parse a standalone expression (message placeholders). */
export function parseExpression(src: string): Expr {
  const p = new P(lex(src));
  const e = expr(p);
  if (p.cur.t !== 'eof') p.err(`Unexpected ${p.describe()}`);
  return e;
}
