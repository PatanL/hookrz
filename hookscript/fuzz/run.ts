#!/usr/bin/env node
// Fuzz + honeypot-check Hookscript files. Usage: node fuzz/run.ts [--trades N] [--seed S] [--json out.json] examples/*.hs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { compile } from '../compiler/src/compile.ts';
import { fuzz, RUNNER } from './fuzz.ts';
import { buildRunner } from '../compiler/test/parity.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const trades = Number(opt('--trades', '10000'));
const seed = Number(opt('--seed', '1'));
const jsonOut = opt('--json', '');
const files = args.filter((a, i) => !a.startsWith('--') && !['--trades', '--seed', '--json'].includes(args[i - 1]));
if (!existsSync(RUNNER)) { try { buildRunner(); } catch (e) { console.error(`(Rust runner unavailable: ${String(e).slice(0, 120)})`); } }

const rows: Record<string, unknown>[] = [];
let bad = 0;
for (const f of files) {
  const c = compile(readFileSync(f, 'utf8'));
  if (!c.ok) { console.log(`${basename(f)}: compile error ${c.errors[0].line}:${c.errors[0].col} ${c.errors[0].message}`); bad++; continue; }
  const t0 = Date.now();
  const { fuzz: z, honeypot: h } = fuzz(c.bytes, { trades, seed });
  const ms = Date.now() - t0;
  const kinds = Object.entries(z.byKind).map(([k, v]) => `${k} ${v.refused}/${v.attempts}`).join(', ');
  console.log(`${basename(f).padEnd(26)} refused ${String(z.refusedPct).padStart(5)}%  (${kinds})  errors ${z.errors}  panics ${z.panics}  CU avg ${z.avgCu} max ${z.maxCu} static ${z.staticCu}  rust ${z.rust ? `${z.rust.identical}/${z.rust.checked}` : 'n/a'}  honeypot ${h.ok ? 'ok' : 'FLAGGED'} (${h.checkedWallets} exits, slowest ${h.maxExitHours.toFixed(1)}h)  ${ms}ms`);
  if (!h.ok) for (const l of h.locked.slice(0, 3)) console.log(`    locked ${l.wallet} (${l.type}) ${l.startTokens} -> ${l.leftTokens} tokens after ${l.tries} tries: "${l.lastMessage}"`);
  for (const n of h.notes) console.log(`    note: ${n}`);
  if (z.errors || z.panics || (z.rust && z.rust.identical !== z.rust.checked)) bad++;
  rows.push({ file: basename(f), name: c.name, bytes: c.size, ops: c.ops, staticCu: c.cu, fuzz: z, honeypot: h });
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
process.exit(bad ? 1 : 0);
