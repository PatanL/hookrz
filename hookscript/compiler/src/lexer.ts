// Hookscript lexer. Newlines are whitespace (statements start with keywords), positions are kept for errors.
import { ONE } from './math.ts';

export type Unit = 'dur' | 'pct' | 'sol' | null;
export type Tok =
  | { t: 'num'; v: bigint; unit: Unit; text: string; line: number; col: number; end: number }
  | { t: 'str'; v: string; line: number; col: number; end: number }
  | { t: 'id'; v: string; line: number; col: number; end: number }
  | { t: 'op'; v: string; line: number; col: number; end: number }
  | { t: 'eof'; v: ''; line: number; col: number; end: number };

export class CompileError extends Error {
  line: number; col: number; hint?: string;
  constructor(message: string, line: number, col: number, hint?: string) { super(message); this.line = line; this.col = col; this.hint = hint; }
}

const OPS = ['==', '!=', '<=', '>=', '+=', '-=', '=>', '<', '>', '=', '+', '-', '*', '/', '%', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';'];
const DUR: Record<string, bigint> = {
  s: 1n, sec: 1n, secs: 1n, second: 1n, seconds: 1n, m: 60n, min: 60n, mins: 60n, minute: 60n, minutes: 60n,
  h: 3600n, hr: 3600n, hrs: 3600n, hour: 3600n, hours: 3600n, d: 86400n, day: 86400n, days: 86400n,
  w: 604800n, week: 604800n, weeks: 604800n, ms: 0n,
};

/** Parse a decimal literal "12.5" into a 6-decimal bigint, exactly. */
function decimal(text: string): bigint | null {
  const m = text.replace(/_/g, '').match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(6, '0');
  if (frac.length > 6 && /[1-9]/.test(frac.slice(6))) return null;
  return BigInt(m[1]) * ONE + BigInt(frac.slice(0, 6) || '0');
}

export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 1, lineStart = 0;
  const s = src.replace(/\r\n?/g, '\n');
  const col = (p: number) => p - lineStart + 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') { i++; line++; lineStart = i; continue; }
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '#' || (ch === '/' && s[i + 1] === '/')) { while (i < s.length && s[i] !== '\n') i++; continue; }
    const start = i, c0 = col(i);
    if (ch === '"' || ch === '“' || ch === '”') {
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== '"' && s[j] !== '”' && s[j] !== '“') {
        if (s[j] === '\n') throw new CompileError('Unterminated string', line, c0, 'Close the message with a " on the same line.');
        if (s[j] === '\\' && j + 1 < s.length) { v += s[j + 1]; j += 2; continue; }
        v += s[j++];
      }
      if (j >= s.length) throw new CompileError('Unterminated string', line, c0);
      out.push({ t: 'str', v, line, col: c0, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i;
      while (j < s.length && /[0-9_.]/.test(s[j])) { if (s[j] === '.' && !/[0-9]/.test(s[j + 1] ?? '')) break; j++; }
      const numText = s.slice(i, j);
      let v = decimal(numText.startsWith('.') ? '0' + numText : numText);
      if (v === null) throw new CompileError(`Bad number "${numText}"`, line, c0, 'Numbers have at most 6 decimals.');
      let unit: Unit = null;
      // suffix glued to the number
      const sm = s.slice(j).match(/^(ms|seconds|second|secs|sec|minutes|minute|mins|min|hours|hour|hrs|hr|days|day|weeks|week|bps|s|m|h|d|w|x|k|K|M|B|%)(?![A-Za-z0-9_])/)
        ?? s.slice(j).match(/^[ \t]+(seconds|second|minutes|minute|hours|hour|days|day|weeks|week|percent)(?![A-Za-z0-9_])/);
      if (sm) {
        const suf = sm[1];
        let consume = true;
        if (suf === '%') {
          // percent literal unless an operand follows (then it's modulo) — "25% of x" is a percent
          // after a number literal, "%" is modulo only when a number or "(" follows: 10%3, 7 % (x)
          if (/^[ \t]*[0-9(]/.test(s.slice(j + 1))) consume = false;
        }
        if (consume) {
          if (suf in DUR) {
            if (suf === 'ms') v = v / 1000n; else v = v * DUR[suf];
            unit = 'dur';
          } else if (suf === '%' || suf === 'percent') { v = v / 100n; unit = 'pct'; }
          else if (suf === 'bps') { v = v / 10_000n; unit = 'pct'; }
          else if (suf === 'x') { /* multiplier */ }
          else if (suf === 'k' || suf === 'K') v *= 1000n;
          else if (suf === 'M') v *= 1_000_000n;
          else if (suf === 'B') v *= 1_000_000_000n;
          j += sm[0].length;
        }
      }
      // " sol" unit tag
      const so = s.slice(j).match(/^[ \t]*(sol|SOL)(?![A-Za-z0-9_])/);
      if (so && unit === null) { unit = 'sol'; j += so[0].length; }
      out.push({ t: 'num', v, unit, text: s.slice(start, j), line, col: c0, end: j });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j), line, col: c0, end: j });
      i = j;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, line, col: c0, end: i + op.length }); i += op.length; continue; }
    if (ch === '≤' || ch === '≥' || ch === '≠') { out.push({ t: 'op', v: ch === '≤' ? '<=' : ch === '≥' ? '>=' : '!=', line, col: c0, end: i + 1 }); i++; continue; }
    if (ch === '&' && s[i + 1] === '&') { out.push({ t: 'id', v: 'and', line, col: c0, end: i + 2 }); i += 2; continue; }
    if (ch === '|' && s[i + 1] === '|') { out.push({ t: 'id', v: 'or', line, col: c0, end: i + 2 }); i += 2; continue; }
    if (ch === '!') { out.push({ t: 'id', v: 'not', line, col: c0, end: i + 1 }); i++; continue; }
    throw new CompileError(`Unexpected character "${ch}"`, line, c0);
  }
  out.push({ t: 'eof', v: '', line, col: col(i), end: i });
  return out;
}
