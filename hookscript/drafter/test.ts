// Offline drafter smoke test: every prompt must produce a script that compiles, fuzzes clean and passes the honeypot check.
import { draft } from './draft.ts';
const PROMPTS = [
  'No single sell over a quarter of your bag in your first 2h',
  'Sell no more than you bought this hour',
  'Closed on weekends, New York time',
  'No buys after a 30% pump in 10 minutes',
  'King of the hill: biggest buy takes the crown, king cannot sell for 6 hours',
  'Every 100th buy wins the jackpot',
  'Hot potato: pass it within 2 hours',
  'For the first hour you can only buy if a holder invited you',
  'Usurp: steal the crown by buying 1.2x the king, bar decays 1% a minute',
  "Tag, you're it: whoever receives a send can't sell for 6h",
  'One bite: every wallet gets exactly one buy',
  'Louder: for the first 10 minutes every buy has to beat the last buy',
  'No cutting the line: sell once 3 people bought after you or after 12h',
  'Birthday: buyers in the first 60 seconds get a party hat and split 10% of fees',
  'Trades only while the sun is up in Tokyo',
  'Last call: no buys from 23:00 UTC to midnight',
  'Library: one trade per wallet per hour, nothing over 0.5% of supply',
  'Werewolves only: no sells on the full moon',
  'Buys only on odd seconds, sells only on even seconds',
  'FOMO countdown: the last buyer before the timer runs out wins',
  'Stairs: every buy at most 2x the last one',
  'Open mic: one buyer per 30 seconds',
  'No Jupiter buys in the first 5 minutes',
  'Only trade between 9am and 5pm London time',
  'Max wallet 2% of supply',
  'A 10 minute cooldown between sells',
  'Make the chart go up only',
];
let bad = 0;
for (const p of PROMPTS) {
  const r = await draft(p, { provider: 'heuristic', trades: Number(process.env.TRADES ?? 3000) });
  if (!r.ok) bad++;
  console.log(`${r.ok ? 'ok ' : 'BAD'} ${(r.template ?? '').padEnd(20)} ${String(r.cu).padStart(5)} CU  refused ${String(r.fuzz?.refusedPct ?? '-').padStart(5)}%  hp ${r.honeypot?.ok ? 'ok' : 'FLAG'}  "${p}"${r.ok ? '' : '\n    ' + (r.errors[0]?.message ?? '').split('\n')[0]}`);
}
process.exit(bad ? 1 : 0);
