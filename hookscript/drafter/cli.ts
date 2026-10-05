#!/usr/bin/env node
// node drafter/cli.ts [--offline] [--json] "No single sell over a quarter of your bag in your first 2h"
import { draft } from './draft.ts';

const args = process.argv.slice(2);
const prompt = args.filter((a) => !a.startsWith('--')).join(' ');
if (!prompt) { console.error('usage: node drafter/cli.ts [--offline] [--json] "<rule in English>"'); process.exit(2); }
const r = await draft(prompt, { provider: args.includes('--offline') ? 'heuristic' : 'auto' });
if (args.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); }
console.log(r.script);
console.log(`# ${r.ok ? 'OK' : 'REJECTED'} via ${r.provider}${r.model ? ` (${r.model})` : ''}${r.template ? ` template ${r.template}` : ''} · ${r.bytes} bytes · ${r.ops} ops · worst ${r.cu} CU`);
if (r.fuzz) console.log(`# fuzz: ${r.fuzz.trades} trades, refused ${r.fuzz.refusedPct}%, panics ${r.fuzz.panics}, CU avg ${r.fuzz.avgCu} max ${r.fuzz.maxCu}${r.fuzz.rust ? `, rust parity ${r.fuzz.rust.identical}/${r.fuzz.rust.checked}` : ''}`);
if (r.honeypot) console.log(`# honeypot: ${r.honeypot.ok ? 'ok' : 'FLAGGED'}${r.honeypot.notes.length ? ' - ' + r.honeypot.notes.join(' ') : ''}`);
for (const w of r.warnings) console.log(`# warning: ${w}`);
for (const e of r.errors) console.log(`# error ${e.line}:${e.col}: ${e.message}`);
process.exit(r.ok ? 0 : 1);
