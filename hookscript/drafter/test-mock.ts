// Exercises the Anthropic provider path with a mock client: request shape (cached system prompt, fallbacks),
// retry with compiler errors, retry with honeypot findings.
import { draft } from './draft.ts';

const replies = [
  // 1: compile error (time compared with a duration)
  'rule "no dumps"\non sell:\n  refuse if wallet.first_receipt < 2h and amount > wallet.balance * 25%\n    because "slow down"\n',
  // 2: compiles but is a honeypot (no escape)
  '```hookscript\nrule "no dumps"\non sell:\n  refuse if amount > wallet.received(window: 1h)\n    because "slow down"\n```',
  // 3: fixed
  'Here you go:\nrule "no dumps"\non sell:\n  refuse if wallet.held < 2h and amount > wallet.balance * 25%\n    because "No single sell over 25% of your bag in your first 2h"\n',
];
const seen: any[] = [];
const client = { beta: { messages: { create: async (req: any) => { seen.push(structuredClone(req)); return { stop_reason: 'end_turn', content: [{ type: 'text', text: replies[seen.length - 1] }] }; } } } };
const r = await draft('No dumping in the first 2h', { client, trades: 2000 });
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok ' : 'BAD'} ${m}`); if (!c) process.exitCode = 1; };
ok(r.ok && r.provider === 'anthropic' && r.attempts.length === 3, `3 attempts, final ok (${r.attempts.map((a) => a.problem ?? 'ok').join(' | ')})`);
ok(seen[0].model === 'claude-opus-5-5', 'default model claude-opus-5-5');
ok(seen[0].system[0].cache_control?.type === 'ephemeral' && seen[0].system[0].text.includes('## 5. Op set') && seen[0].system[0].text.includes('examples/king-of-the-hill.hs'), 'system prompt = SPEC + examples, cached');
ok(seen[0].fallbacks === 'default' && seen[0].betas.includes('server-side-fallback-2026-07-01'), 'server-side fallback enabled');
ok(/Comparing a time with a duration/.test(JSON.stringify(seen[1].messages.at(-1))), 'retry 1 carries the compiler error');
ok(/honeypot/i.test(JSON.stringify(seen[2].messages.at(-1))), 'retry 2 carries the honeypot finding');
ok(seen[2].messages.length === 5 && seen[2].messages[1].role === 'assistant', 'history is append-only (assistant content kept)');
ok(r.script.startsWith('rule "no dumps"') && !!r.bytecodeHex && r.honeypot?.ok === true, 'returns script + bytecode + honeypot ok');
