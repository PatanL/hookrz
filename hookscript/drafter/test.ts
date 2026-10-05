// Offline drafter tests:
//  - 27 rule prompts must each produce a script that compiles, fuzzes clean and passes the honeypot check, with a title
//    that describes the script (the template's own title, never the user's sentence);
//  - honeypot-intent prompts are refused with honeypot.ok = false, a reason and a safe alternative;
//  - off-topic prompts are refused (ok:false, no script) with suggestions.
import { draft } from './draft.ts';

const TRADES = Number(process.env.TRADES ?? 3000);
const GOOD: [string, string][] = [
  ['No single sell over a quarter of your bag in your first 2h', 'quarter-bag'],
  ['Sell no more than you bought this hour', 'sell-what-you-bought'],
  ['Closed on weekends, New York time', 'weekend-closed'],
  ['No buys after a 30% pump in 10 minutes', 'pump-pause'],
  ['King of the hill: biggest buy takes the crown, king cannot sell for 6 hours', 'king-of-the-hill'],
  ['Every 100th buy wins the jackpot', 'jackpot'],
  ['Hot potato: pass it within 2 hours', 'hot-potato'],
  ['For the first hour you can only buy if a holder invited you', 'invite'],
  ['Usurp: steal the crown by buying 1.2x the king, bar decays 1% a minute', 'usurp'],
  ["Tag, you're it: whoever receives a send can't sell for 6h", 'tag'],
  ['One bite: every wallet gets exactly one buy', 'one-bite'],
  ['Louder: for the first 10 minutes every buy has to beat the last buy', 'louder'],
  ['No cutting the line: sell once 3 people bought after you or after 12h', 'queue'],
  ['Birthday: buyers in the first 60 seconds get a party hat and split 10% of fees', 'birthday'],
  ['Trades only while the sun is up in Tokyo', 'sunrise'],
  ['Last call: no buys from 23:00 UTC to midnight', 'last-call'],
  ['Library: one trade per wallet per hour, nothing over 0.5% of supply', 'library'],
  ['Werewolves only: no sells on the full moon', 'full-moon'],
  ['Buys only on odd seconds, sells only on even seconds', 'odd-even'],
  ['FOMO countdown: the last buyer before the timer runs out wins', 'fomo'],
  ['Stairs: every buy at most 2x the last one', 'stairs'],
  ['Open mic: one buyer per 30 seconds', 'open-mic'],
  ['No Jupiter buys in the first 5 minutes', 'no-aggregator'],
  ['Only trade between 9am and 5pm London time', 'trading-hours'],
  ['Max wallet 2% of supply', 'max-wallet'],
  ['A 10 minute cooldown between sells', 'sell-cooldown'],
  ['No selling for the first 24 hours after launch', 'lock-in'],
];
// the site's own suggestions (web/src/hookscript/examples.js)
GOOD.push(
  ["King of the Hill: the biggest buy takes the crown, and the king can't sell for 6h unless someone outbids them", 'king-of-the-hill'],
  ['Invite only for the first hour: you can buy only if a holder sent you a token', 'invite'],
);
const HONEYPOT = [
  'Nobody can ever sell', 'Sells are blocked forever', 'Make the chart go up only', 'Holders can never sell', "You can't sell this coin",
  'No selling', 'No selling, ever', 'Lock everyone in', 'Block all sells permanently', 'Disable selling at all', 'Only buys allowed',
  'Price can only go up', 'nobody can sell or send', 'sells are disabled', 'Trap the buyers so they never exit',
];
const OFF_TOPIC = [
  "What's the weather in Tokyo tomorrow?", 'Write me a poem about the ocean', 'I like making pancakes on Sunday mornings', 'Who won the world cup in 2022?',
  'Translate hello into French', 'asdf qwerty zxcv', 'My toddler is an odd kid', 'Tell me a joke about a king', 'How do I bake sourdough bread?',
  'Recommend a good movie for tonight', 'The quick brown fox jumps over the lazy dog', 'Explain quantum computing in 5 minutes', 'What is 2 + 2?',
  'Book a flight to Paris for next weekend', 'hello', 'Play some jazz music between 9am and 5pm', 'Is the moon made of cheese?', 'Set an alarm for 7am',
  'Count to 100 slowly', 'Wake me at sunrise in Tokyo', 'Pump up the volume', 'Draw a hat on a cat', '', '   ',
];

let bad = 0;
const fail = (m: string) => { bad++; console.log(`BAD ${m}`); };
for (const [p, want] of GOOD) {
  const r = await draft(p, { provider: 'heuristic', trades: TRADES });
  // the title is the template's own: rewording the request around the same rule doesn't change it
  const again = await draft(`Please make this rule: ${p}!!`, { provider: 'heuristic', trades: 200 });
  const titleOk = !!r.title && r.script.startsWith(`rule "${r.title}"`) && again.title === r.title && !/please/i.test(r.title);
  if (!r.ok || r.template !== want || !titleOk) fail(`good "${p}": ok=${r.ok} template=${r.template} (want ${want}) title="${r.title}" ${r.errors[0]?.message ?? ''}`);
  else console.log(`ok  ${want.padEnd(20)} ${String(r.cu).padStart(5)} CU  refused ${String(r.fuzz?.refusedPct).padStart(5)}%  "${r.title}"`);
}
for (const p of HONEYPOT) {
  for (const provider of ['heuristic', 'auto'] as const) {
    const r = await draft(p, { provider, trades: TRADES });
    if (r.ok || r.script || r.honeypot?.ok !== false || !r.honeypot.notes[0] || !r.alternative?.script) fail(`honeypot "${p}" (${provider}): ok=${r.ok} script=${!!r.script} honeypot=${JSON.stringify(r.honeypot)?.slice(0, 80)}`);
  }
}
console.log(`honeypot intent: ${HONEYPOT.length} prompts refused with a reason and a safe alternative`);
for (const p of OFF_TOPIC) {
  const r = await draft(p, { provider: 'heuristic', trades: TRADES });
  if (r.ok || r.script || !r.suggestions?.length || !r.errors[0]?.hint) fail(`off-topic "${p}": ok=${r.ok} template=${r.template} title=${r.title}`);
}
console.log(`off-topic: ${OFF_TOPIC.length} prompts declined with suggestions`);
// the alternative offered for honeypots is itself a safe draft
const alt = await draft('No sells for the first 24 hours after launch', { provider: 'heuristic', trades: TRADES });
if (!alt.ok || alt.honeypot?.ok !== true) fail('the suggested alternative must pass the honeypot check');
console.log(bad ? `${bad} FAILED` : 'drafter tests: all passed');
process.exit(bad ? 1 : 0);
