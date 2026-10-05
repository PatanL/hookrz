#!/usr/bin/env node
// hsc: compile Hookscript files.
//   node compiler/bin/hsc.ts [--listing] [--json] [--hex] file.hs ...
//   node compiler/bin/hsc.ts --rehead file.hex ...   recompute the header (gas_max, flags, sizes) of raw bytecode
import { readFileSync } from 'node:fs';
import { compile } from '../src/compile.ts';
import { analyze, verify } from '../src/interp.ts';
import { fromHex, toHex } from '../src/bytecode.ts';

const args = process.argv.slice(2);
if (args.includes('--rehead')) {
  for (const f of args.filter((a) => !a.startsWith('--'))) {
    const s = fromHex(readFileSync(f, 'utf8').replace(/\s+/g, ''));
    try {
      const i = analyze(s);
      s[3] = i.flags; s[8] = i.gasMax & 0xff; s[9] = i.gasMax >> 8; s[10] = i.globalsLen & 0xff; s[11] = i.globalsLen >> 8; s[12] = i.wvarsLen; s[13] = i.maxStack; s[14] = i.nLocals;
      verify(s);
      console.log(`${f}: gas_max ${i.gasMax} ops ${i.ops}\n${toHex(s)}`);
    } catch (e) { console.log(`${f}: ${(e as { code?: string }).code ?? e}`); process.exitCode = 1; }
  }
  process.exit();
}
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
  if (args.includes('--hex')) { console.log(r.hex); continue; }
  console.log(`${f}: "${r.name}" ${r.size} bytes, ${r.ops} ops, worst case ${r.cu} CU, flags 0x${r.info.flags.toString(16)}`);
  console.log(`  globals: ${r.abi.globals.map((g) => `${g.name}:${g.type}@${g.offset}`).join(', ') || '-'} | wallet: ${r.abi.wallet.map((g) => `${g.name}:${g.type}@${g.offset}`).join(', ') || '-'}`);
  if (listing) console.log(r.listing);
}
process.exit(failed ? 1 : 0);
