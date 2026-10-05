#!/usr/bin/env node
// hsc: compile Hookscript files. Usage: node compiler/bin/hsc.ts [--listing] [--json] file.hs ...
import { readFileSync } from 'node:fs';
import { compile } from '../src/compile.ts';

const args = process.argv.slice(2);
const listing = args.includes('--listing');
const json = args.includes('--json');
let failed = 0;
for (const f of args.filter((a) => !a.startsWith('--'))) {
  const src = readFileSync(f, 'utf8');
  const r = compile(src);
  if (!r.ok) {
    failed++;
    for (const e of r.errors) console.error(`${f}:${e.line}:${e.col}: error: ${e.message}${e.hint ? `\n  hint: ${e.hint}` : ''}`);
    continue;
  }
  for (const w of r.warnings) console.error(`${f}:${w.line}:${w.col}: warning: ${w.message}`);
  if (json) { console.log(JSON.stringify({ file: f, name: r.name, hex: r.hex, size: r.size, ops: r.ops, cu: r.cu, flags: r.info.flags, abi: r.abi })); continue; }
  console.log(`${f}: "${r.name}" ${r.size} bytes, ${r.ops} ops, worst case ${r.cu} CU, flags 0x${r.info.flags.toString(16)}`);
  console.log(`  globals: ${r.abi.globals.map((g) => `${g.name}:${g.type}@${g.offset}`).join(', ') || '-'} | wallet: ${r.abi.wallet.map((g) => `${g.name}:${g.type}@${g.offset}`).join(', ') || '-'}`);
  if (listing) console.log(r.listing);
}
process.exit(failed ? 1 : 0);
