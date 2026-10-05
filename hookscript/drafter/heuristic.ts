// Offline English -> Hookscript drafter: recognizes the rule families in examples/ and fills in their numbers.
// Used when no ANTHROPIC_API_KEY is set (and as a last resort if the API fails).
//
// It only answers when it is confident: a prompt must be about trading and must hit a template's anchor phrase or
// enough of its cues. Otherwise it says so and points at the closest rules it knows. The rule title always describes
// what the script does (the template's own title); the user's sentence is kept only as the draft's `prompt`.
// Prompts that ask to stop holders from ever selling are refused up front (honeypotIntent), for every provider.

export type HeuristicResult =
  | { kind: 'match'; script: string; title: string; template: string; score: number }
  | { kind: 'unknown'; suggestions: Suggestion[] };
export interface Suggestion { template: string; title: string; prompt: string }
/** Kept for callers of the old API: a confident match, or null. */
export interface HeuristicDraft { script: string; template: string; matched: boolean; title?: string }

const q = (s: string) => s.replace(/"/g, "'").replace(/[{}]/g, '');

/** All "<number><unit>" mentions in the prompt. */
function amounts(p: string) {
  const out: { v: number; unit: string; text: string }[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(%|percent|x|times|seconds?|secs?|s\b|minutes?|mins?|m\b|hours?|hrs?|h\b|days?|d\b|weeks?|w\b|sol\b)?/gi;
  for (const m of p.matchAll(re)) {
    const u = (m[2] ?? '').toLowerCase();
    const unit = u.startsWith('%') || u.startsWith('percent') ? '%' : u === 'x' || u === 'times' ? 'x' : /^s(ec)?/.test(u) ? 's' : /^m(in)?/.test(u) ? 'm' : /^h/.test(u) ? 'h' : /^d/.test(u) ? 'd' : /^w/.test(u) ? 'w' : u === 'sol' ? 'sol' : '';
    out.push({ v: Number(m[1]), unit, text: m[0] });
  }
  return out;
}
type A = ReturnType<typeof amounts>;
const dur = (a: A, def: string, units = ['s', 'm', 'h', 'd', 'w']) => { const x = a.find((y) => units.includes(y.unit)); return x ? `${x.v}${x.unit}` : def; };
const pct = (a: A, def: number) => a.find((y) => y.unit === '%')?.v ?? def;
const plain = (a: A, def: number) => a.find((y) => y.unit === '')?.v ?? def;
const mult = (a: A, def: number) => a.find((y) => y.unit === 'x')?.v ?? def;
const ordinal = (n: number) => { const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; return `${n}${s}`; };

const CITIES = ['tokyo', 'new york', 'london', 'paris', 'berlin', 'seoul', 'singapore', 'hong kong', 'shanghai', 'sydney', 'los angeles', 'chicago', 'dubai', 'mumbai', 'lagos', 'sao paulo', 'toronto', 'madrid', 'rome', 'amsterdam'];
const city = (p: string) => CITIES.find((c) => p.includes(c));
const TZ_WORDS: Record<string, string> = { utc: 'UTC', gmt: 'UTC', est: 'America/New_York', et: 'America/New_York', pst: 'America/Los_Angeles', pt: 'America/Los_Angeles', cet: 'Europe/Paris', jst: 'Asia/Tokyo', kst: 'Asia/Seoul' };
function tzOf(p: string): string | null {
  const c = city(p);
  if (c) return c.replace(/\b\w/g, (x) => x.toUpperCase());
  for (const [w, z] of Object.entries(TZ_WORDS)) if (new RegExp(`\\b${w}\\b`).test(p)) return z;
  return null;
}

/** The prompt has to be about a coin's transfers at all. */
const DOMAIN = /\b(buy|buys|buying|bought|buyers?|sell|sells|selling|sold|sellers?|send|sends|sending|sent|trade|trades|trading|traders?|swap|swaps|wallets?|holders?|hold|holds|holding|tokens?|coins?|price|chart|curve|transfers?|bags?|supply|mcap|market cap|launch|fees?|sol|jupiter|aggregators?|whales?|snipers?|bots?|dev|creator|crown|king|jackpot|potato|closed)\b/;

interface Template {
  name: string;
  /** any one of these alone identifies the template */
  anchors: RegExp[];
  /** supporting phrases; `need` of them identify it without an anchor (0 = anchors only) */
  cues: RegExp[];
  need: number;
  /** a prompt that drafts this template (suggestions) */
  example: string;
  make: (p: string) => { title: string; body: string };
}

const SELL = /\b(sells?|selling|sold|dump|dumps|dumping)\b/;
const BUY = /\b(buys?|buying|bought|buyers?|purchases?)\b/;

const TEMPLATES: Template[] = [
  {
    name: 'usurp', anchors: [/\busurp/, /\bsteal (the )?crown\b/], cues: [/\b(crown|king)\b/, /\b\d+(\.\d+)?\s*x\b/, /\bdecay/, /\boutbid/], need: 3,
    example: 'Usurp: steal the crown by buying 1.2x the king; the bar decays 1% a minute',
    make: (p) => {
      const a = amounts(p);
      const m = mult(a, 1.2), r = pct(a, 1), lock = dur(a.filter((x) => x.unit === 'h'), '12h');
      return { title: `Usurp the crown: beat the king by ${m}x`, body: `global king: key
global bar: num
global crowned_at: time
payout 50% to king

on buy:
  if amount > decay(bar, rate: ${r}%, every: 1m, since: crowned_at) * ${m}x {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
  }

on sell, send:
  refuse if wallet == king and since(crowned_at) < ${lock}
    because "Abdicate first: someone has to outbid you. The crown lapses in {${lock} - since(crowned_at)}"
` };
    },
  },
  {
    name: 'king-of-the-hill', anchors: [/\bking of the hill\b/, /\b(biggest|largest|top) buy(er)? (takes|gets|wins|is|becomes) (the )?(crown|king)\b/],
    cues: [/\bking\b/, /\bcrown(ed)?\b/, /\b(biggest|largest|top)\b[^.]{0,20}\bbuy/, /\b(throne|reign|outbids?)\b/], need: 2,
    example: 'King of the Hill: the biggest buy takes the crown, and the king can\'t sell for 6h unless someone outbids them',
    make: (p) => {
      const a = amounts(p);
      const h = dur(a, '6h', ['h', 'm', 'd']);
      const share = Math.min(100, pct(a, 50));
      return { title: `King of the Hill: the biggest buy is king for ${h}`, body: `global king: key
global bar: num
global crowned_at: time
global reigns: int
payout ${share}% to king

on buy {
  let need = fade(bar, over: ${h}, since: crowned_at)
  if amount > need {
    set king = buyer
    set bar = amount
    set crowned_at = clock.now
    set reigns += 1
  }
}

on sell, send:
  refuse if wallet == king and since(crowned_at) < ${h}
    because "You're the king: no selling or sending for {${h} - since(crowned_at)}, unless someone outbids you"
` };
    },
  },
  {
    name: 'jackpot', anchors: [/\bjackpots?\b/, /\blotter(y|ies)\b/, /\bevery\s+\d+(st|nd|rd|th)?\s+(buy|buyer|purchase)s?\b/], cues: [], need: 0,
    example: 'Every 100th buy wins the jackpot',
    make: (p) => {
      const n = Math.max(2, Math.round(plain(amounts(p), 100)));
      const share = Math.min(100, pct(amounts(p), 25));
      return { title: `Every ${ordinal(n)} buy wins the pot`, body: `global buys: int
global winner: key
global wins: int
payout ${share}% to winner as pot

on buy {
  if value >= 0.01 sol {
    set buys += 1
    if buys % ${n} == 0 {
      set winner = buyer
      set wins += 1
    }
  }
}
` };
    },
  },
  {
    name: 'hot-potato', anchors: [/\bhot potato\b/, /\bpotato\b[^.]{0,40}\b(pass|move|send|within|hours?|minutes?)\b/], cues: [], need: 0,
    example: 'Hot potato: pass it within 2 hours',
    make: (p) => {
      const h = dur(amounts(p), '2h', ['h', 'm']);
      return { title: `Hot potato: pass it on within ${h}`, body: `global potato: key
global caught_at: time
global loser: key
global burnt_at: time
global passes: int

if potato != none and since(caught_at) >= ${h} {
  set loser = potato
  set burnt_at = caught_at + ${h}
  set potato = none
}

on buy {
  refuse if buyer == loser and since(burnt_at) < 24h
    because "The hot potato burnt you: no buys for {24h - since(burnt_at)}"
  if potato == none {
    set potato = buyer
    set caught_at = clock.now
  }
}

on send {
  if sender == potato and receiver != potato {
    set potato = receiver
    set caught_at = clock.now
    set passes += 1
  }
}

on sell:
  refuse if seller == potato
    because "You're holding the hot potato: send any amount to someone to pass it, or it burns in {${h} - since(caught_at)}"
` };
    },
  },
  {
    name: 'tag', anchors: [/\byou'?re it\b/], cues: [/\btag(ged|s)?\b/, /\b(send|sends|sent|receives?|received)\b/, SELL], need: 3,
    example: "Tag, you're it: whoever receives a send can't sell for 6h",
    make: (p) => {
      const h = dur(amounts(p), '6h', ['h', 'm', 'd']);
      return { title: `Tag: whoever gets sent tokens can't sell for ${h}`, body: `global it: key
global tagged_at: time

on send:
  if receiver != sender {
    set it = receiver
    set tagged_at = clock.now
  }

on sell:
  refuse if seller == it and since(tagged_at) < ${h}
    because "You're it! Tag someone (send them any amount) before you sell, or wait {${h} - since(tagged_at)}"
` };
    },
  },
  {
    name: 'invite', anchors: [/\binvite[- ]only\b/], cues: [/\binvit(e|ed|es|ation)\b/, BUY], need: 2,
    example: 'For the first hour you can only buy if a holder invited you',
    make: (p) => {
      const h = dur(amounts(p), '1h', ['h', 'm', 'd']);
      return { title: `Invite only for the first ${h}`, body: `wallet invited: bool

on send:
  if amount >= 1 { set receiver.invited = true }

on buy:
  refuse if coin.age < ${h} and not wallet.invited and not wallet.is_creator
    because "Invite only for now: ask a holder to send you 1 token. Opens to everyone in {${h} - coin.age}"
` };
    },
  },
  {
    name: 'open-mic', anchors: [/\bopen mic\b/, /\bone buyer (per|every|each)\b/], cues: [], need: 0,
    example: 'Open mic: one buyer per 30 seconds',
    make: (p) => {
      const s = dur(amounts(p), '30s', ['s', 'm']);
      return { title: `Open mic: one buyer per ${s}`, body: `global mic: key
global mic_at: time

on buy {
  refuse if since(mic_at) < ${s} and buyer != mic
    because "Someone has the mic. The next slot opens in {${s} - since(mic_at)}"
  if since(mic_at) >= ${s} {
    set mic = buyer
    set mic_at = clock.now
  }
}
` };
    },
  },
  {
    name: 'one-bite', anchors: [/\bone bite\b/, /\b(only )?(one|1|a single) buy (per|for each|each) (wallet|person|address)\b/, /\bbuy (only )?once\b/, /\bonly buy once\b/],
    cues: [/\b(one|1|single|once)\b/, BUY, /\b(wallet|per (person|address))\b/, /\b(ever|exactly)\b/], need: 4,
    example: 'One bite: every wallet gets exactly one buy',
    make: () => ({ title: 'One buy per wallet, ever', body: `wallet bitten: bool

on buy {
  refuse if wallet.bitten
    because "One buy per wallet: you already bought"
  set wallet.bitten = true
}
` }),
  },
  {
    name: 'louder', anchors: [/\blouder\b/, /\bbeat (the )?(last|previous) buy\b/, /\bbigger than the (last|previous) (buy|one)\b/], cues: [], need: 0,
    example: 'Louder: for the first 10 minutes every buy has to beat the last buy',
    make: (p) => {
      const m = dur(amounts(p), '10m', ['m', 'h', 's']);
      return { title: `Louder: for ${m}, every buy must beat the last`, body: `global last_buy: num

on buy {
  refuse if coin.age < ${m} and amount <= last_buy
    because "Louder! Beat the last buy of {last_buy} tokens"
  set last_buy = amount
}
` };
    },
  },
  {
    name: 'queue', anchors: [/\b(no )?cut(ting)? (in )?(the )?line\b/], cues: [/\b(queue|line|behind you|after you)\b/, SELL, /\b\d+\s+(people|wallets|buyers|others)\b/], need: 3,
    example: 'No cutting the line: sell once 3 people bought after you or after 12h',
    make: (p) => {
      const a = amounts(p);
      const n = Math.max(1, Math.round(plain(a, 3))), h = dur(a, '12h', ['h', 'd']);
      return { title: `No cutting the line: sell after ${n} more buyers or ${h}`, body: `global buyers: int
wallet number: int

on buy:
  if wallet.number == 0 {
    set buyers += 1
    set wallet.number = buyers
  }

on sell:
  refuse if wallet.number > 0 and buyers - wallet.number < ${n} and wallet.held < ${h}
    because "No cutting the line: wait for ${n} people to buy after you, or {${h} - wallet.held}"
` };
    },
  },
  {
    name: 'birthday', anchors: [/\bbirthday\b/, /\bparty hats?\b/], cues: [/\bhats?\b/, BUY], need: 2,
    example: 'Birthday: buyers in the first 60 seconds get a party hat and split 10% of fees',
    make: (p) => {
      const s = dur(amounts(p), '60s', ['s', 'm']);
      const share = Math.min(100, pct(amounts(p), 10));
      return { title: `Party hats for buyers in the first ${s}`, body: `wallet hat: bool
payout ${share}% to wallets where hat

on buy:
  if coin.age < ${s} { set wallet.hat = true }

on sell:
  set wallet.hat = false
` };
    },
  },
  {
    name: 'fomo', anchors: [/\bfomo\b/, /\bcountdown\b/, /\blast buyer\b[^.]{0,40}\bwins?\b/], cues: [/\btimer\b/, /\b(last buyer|wins?|pot)\b/], need: 2,
    example: 'FOMO countdown: the last buyer before the timer runs out wins',
    make: () => ({ title: 'FOMO: the last buyer before the countdown ends wins', body: `global deadline: time
global last_buyer: key
global winner: key
global round: int
payout 30% to winner as pot

on buy {
  let live = deadline != 0 and clock.now < deadline
  refuse if live and deadline - clock.now < 1m and value < 0.05 sol
    because "Final minute: buys must be at least 0.05 SOL. {deadline - clock.now} left"
  if not live {
    if last_buyer != none {
      set winner = last_buyer
      set round += 1
    }
    set deadline = clock.now + 1h
  } else {
    set deadline = min(deadline + 30s, clock.now + 1h)
  }
  set last_buyer = buyer
}
` }),
  },
  {
    name: 'stairs', anchors: [/\bstairs\b/, /\bat most \d+(\.\d+)?\s*x (the )?(last|previous)\b/, /\b(twice|double) the (last|previous)\b/], cues: [], need: 0,
    example: 'Stairs: every buy at most 2x the last one',
    make: (p) => {
      const m = mult(amounts(p), 2);
      return { title: `Stairs: every buy at most ${m}x the last`, body: `global last_buy: num

on buy {
  let cap = max(last_buy * ${m}x, supply * 2%)
  refuse if amount > cap
    because "One step at a time: the biggest buy right now is {cap} tokens"
  set last_buy = amount
}
` };
    },
  },
  {
    name: 'full-moon', anchors: [/\bfull moon\b/, /\bwerewol/], cues: [/\bmoon\b/, SELL], need: 2,
    example: 'Werewolves only: no sells on the full moon',
    make: () => ({ title: 'No sells on the full moon', body: `on sell:
  refuse if moon_phase() == full
    because "It's a full moon. Sells reopen when it passes"
` }),
  },
  {
    name: 'sunrise', anchors: [/\bwhile the sun is (up|down)\b/, /\bsun(rise|set)\b/, /\bdaylight\b/], cues: [/\b(sun|night|nighttime|dark)\b/, /\b(trades?|trading|buys?|sells?)\b/], need: 2,
    example: 'Trades only while the sun is up in Tokyo',
    make: (p) => {
      const c = city(p) ?? 'tokyo';
      const C = c.replace(/\b\w/g, (x) => x.toUpperCase());
      const night = /only at night|night only|nighttime only|after dark/.test(p);
      return { title: night ? `Trades only after dark in ${C}` : `Trades only while the sun is up in ${C}`, body: `on buy, sell:
  refuse if ${night ? '' : 'not '}daylight(tz: "${C}")
    because "${night ? `The sun is up in ${C}. Trading opens after dark` : `The sun is down in ${C}. Trading reopens at sunrise`}; sends always work"
` };
    },
  },
  {
    name: 'odd-even', anchors: [/\b(odd|even) seconds?\b/], cues: [], need: 0,
    example: 'Buys only on odd seconds, sells only on even seconds',
    make: () => ({ title: 'Buys on odd seconds, sells on even seconds', body: `on buy:
  refuse if clock.second % 2 == 0 because "Buys only on odd seconds. Try again"
on sell:
  refuse if clock.second % 2 == 1 because "Sells only on even seconds. Try again"
` }),
  },
  {
    name: 'weekend-closed', anchors: [/\bweekends?\b/, /\b(saturdays?|sundays?)\b/], cues: [], need: 0,
    example: 'Closed on weekends, New York time',
    make: (p) => {
      const z = tzOf(p);
      return { title: `Closed on weekends (${z ?? 'UTC'})`, body: `${z ? `timezone "${z}"\n` : ''}on buy, sell:
  refuse if clock.weekday in [sat, sun]
    because "The curve is closed on weekends${z ? ` (${z} time)` : ' (UTC)'}. Sends still work"
` };
    },
  },
  {
    name: 'last-call', anchors: [/\blast call\b/, /\bbar closes\b/], cues: [/\bno buys? (from|after|at|between|during)\b/, /\b\d{1,2}(:\d\d)?\s*(am|pm|utc)\b|\b\d{1,2}:\d\d\b/], need: 2,
    example: 'Last call: no buys from 23:00 UTC to midnight',
    make: (p) => {
      const m = p.match(/(\d{1,2})(?::00)?\s*(am|pm)?/);
      let hr = m ? Number(m[1]) % 24 : 23;
      if (m?.[2] === 'pm' && hr < 12) hr += 12;
      const z = tzOf(p) ?? 'UTC';
      return { title: `Last call: no buys ${String(hr).padStart(2, '0')}:00-${String((hr + 1) % 24).padStart(2, '0')}:00 (${z})`, body: `on buy:
  refuse if clock.hour(tz: "${z}") == ${hr}
    because "Last call was at ${String((hr + 23) % 24).padStart(2, '0')}:59 (${z}). Buys reopen in an hour; sells stay open"
` };
    },
  },
  {
    name: 'trading-hours', anchors: [/\bbetween \d{1,2}\s*(am|pm)?\s*(and|-|to)\s*\d{1,2}/, /\b(business|market|office) hours\b/, /\b9 ?to ?5\b/], cues: [], need: 0,
    example: 'Only trade between 9am and 5pm London time',
    make: (p) => {
      const m = p.match(/(\d{1,2})\s*(am|pm)?\s*(?:and|-|to)\s*(\d{1,2})\s*(am|pm)?/);
      let a = m ? Number(m[1]) : 9, b = m ? Number(m[3]) : 17;
      if (m?.[2] === 'pm' && a < 12) a += 12;
      if ((m?.[4] === 'pm' || (!m?.[4] && b < a)) && b < 12) b += 12;
      const z = tzOf(p) ?? 'America/New_York';
      return { title: `Trades only ${a}:00-${b}:00 (${z})`, body: `timezone "${z}"
on buy, sell:
  refuse if clock.hour < ${a} or clock.hour >= ${b}
    because "The curve trades ${a}:00-${b}:00 ${z} time. Sends always work"
` };
    },
  },
  {
    name: 'library', anchors: [/\blibrary\b/, /\bone trade per (wallet|hour)\b/], cues: [/\bquiet\b/, /\b(one|1) trade\b/], need: 2,
    example: 'Library: one trade per wallet per hour, nothing over 0.5% of supply',
    make: (p) => {
      const a = amounts(p);
      const h = dur(a, '1h', ['h', 'm']);
      const cap = pct(a, 0.5);
      return { title: `Library: one trade per wallet every ${h}, max ${cap}% of supply`, body: `wallet last_trade_at: time

on buy, sell {
  refuse if since(wallet.last_trade_at) < ${h}
    because "Shh. One trade per wallet every ${h}. Next one in {${h} - since(wallet.last_trade_at)}"
  refuse if amount > supply * ${cap}%
    because "Shh. Nothing over ${cap}% of supply in one go"
  set wallet.last_trade_at = clock.now
}
` };
    },
  },
  {
    name: 'pump-pause', anchors: [/\b\d+\s*%\s*pump\b/, /\bpump of \d+/, /\bprice (is )?up (more than |over )?\d+\s*%/], cues: [/\b(pump|pumps|spike|spikes|price)\b/, /\d+\s*%/, BUY, /\b\d+\s*(m|mins?|minutes?|h|hours?)\b/], need: 4,
    example: 'No buys after a 30% pump in 10 minutes',
    make: (p) => {
      const a = amounts(p);
      const x = pct(a, 30), m = dur(a, '10m', ['m', 'h']);
      return { title: `No buys after a ${x}% pump in ${m}`, body: `on buy:
  refuse if curve.price > curve.price_at(ago: ${m}) * ${100 + x}%
    because "Price is up more than ${x}% in ${m}; buys pause until it cools off"
` };
    },
  },
  {
    name: 'no-aggregator', anchors: [/\bjupiter\b/, /\baggregators?\b/], cues: [], need: 0,
    example: 'No Jupiter buys in the first 5 minutes',
    make: (p) => {
      const m = dur(amounts(p), '5m', ['m', 'h']);
      return { title: `Curve only (no aggregator buys) for the first ${m}`, body: `on buy:
  refuse if coin.age < ${m} and transfer.app == program("jupiter")
    because "For now, buy on the curve directly. Aggregators open in {${m} - coin.age}"
` };
    },
  },
  {
    // the literal rule is a honeypot (received(1h) drops to 0); this version adds the escape hatch the checker needs
    name: 'sell-what-you-bought', anchors: [/\bmore than (they|you) (bought|received)\b/, /\bsell\b[^.]{0,30}\bwhat (they|you)('ve| have)? (bought|received)\b/, /\bbought (this|in the last) hour\b/], cues: [], need: 0,
    example: 'Sell no more than you bought this hour',
    make: (p) => {
      const h = dur(amounts(p), '1h', ['h', 'm']);
      return { title: `First day: sell at most what you bought in the last ${h}`, body: `on sell:
  refuse if wallet.held < 24h and amount > wallet.received(window: ${h})
    because "In your first day you can sell at most what you bought in the last ${h}. After 24h, anything goes"
` };
    },
  },
  {
    name: 'max-wallet', anchors: [/\bmax(imum)? wallet\b/, /\bno wallet (can )?(holds?|over|above|more than)\b/, /\bhold more than \d/], cues: [], need: 0,
    example: 'Max wallet 2% of supply',
    make: (p) => {
      const x = pct(amounts(p), 2);
      return { title: `Max wallet ${x}% of supply`, body: `on buy, send:
  refuse if not receiver.is_creator and receiver.balance_after > supply * ${x}%
    because "No wallet can hold more than ${x}% of supply"
` };
    },
  },
  {
    name: 'sell-cooldown', anchors: [/\bcool ?downs?\b[^.]{0,30}\bsells?\b|\bsells?\b[^.]{0,30}\bcool ?downs?\b/, /\bbetween sells\b/, /\bone sell (per|every)\b/], cues: [], need: 0,
    example: 'A 10 minute cooldown between sells',
    make: (p) => {
      const m = dur(amounts(p), '10m', ['m', 'h', 's']);
      return { title: `One sell every ${m}`, body: `on sell:
  refuse if since(wallet.last_sell) < ${m}
    because "One sell every ${m}. Next one in {${m} - since(wallet.last_sell)}"
` };
    },
  },
  {
    name: 'lock-in', anchors: [/\block[- ]?in\b/, /\b(no|zero) (sells|selling|sales)\b[^.]{0,30}\b(first|for|until)\b[^.]{0,20}\d/, /\b(can'?t|cannot|can not) sell\b[^.]{0,20}\b(first|for)\b[^.]{0,15}\d/],
    cues: [SELL, /\b(first|for|until)\b[^.]{0,20}\d+\s*(m|mins?|minutes?|h|hours?|d|days?)\b/, /\b(no|can'?t|cannot|not)\b/], need: 3,
    example: 'No sells for the first 24 hours after launch',
    make: (p) => {
      const h = dur(amounts(p), '24h', ['m', 'h', 'd']);
      const perWallet = /\bafter (you|they|your|their|a wallet'?s?) (buy|bought|first buy|receive|received|get)/.test(p);
      return perWallet
        ? { title: `No sells in your first ${h} of holding`, body: `on sell:
  refuse if wallet.held < ${h}
    because "New holders can't sell for their first ${h}. You can sell in {${h} - wallet.held}"
` }
        : { title: `No sells for the first ${h} after launch`, body: `on sell:
  refuse if coin.age < ${h}
    because "Sells open ${h} after launch: {${h} - coin.age} to go"
` };
    },
  },
  {
    name: 'quarter-bag', anchors: [/\b(quarter|half|\d+(\.\d+)?\s*%)( of)? (your|their|the|a|my) (bag|balance|holdings|position|stack)\b/],
    cues: [SELL, /\b(quarter|half|percent)\b|\d+\s*%/, /\b(bag|balance|holdings|position|stack)\b/, /\b(first|within)\s+\d+\s*(h|hours?|m|mins?|minutes?|d|days?)\b/], need: 3,
    example: 'No single sell over a quarter of your bag in your first 2h',
    make: (p) => {
      const a = amounts(p);
      const x = /\bhalf\b/.test(p) ? 50 : pct(a, 25), h = dur(a, '2h', ['h', 'm', 'd']);
      return { title: `No single sell over ${x}% of your bag in your first ${h}`, body: `on sell:
  refuse if wallet.held < ${h} and amount > wallet.balance * ${x}%
    because "No single sell over ${x}% of your bag in your first ${h}"
` };
    },
  },
];

function scoreOf(t: Template, p: string): { score: number; confident: boolean } {
  const anchors = t.anchors.filter((r) => r.test(p)).length;
  const cues = t.cues.filter((r) => r.test(p)).length;
  return { score: anchors * 10 + cues, confident: anchors > 0 || (t.need > 0 && cues >= t.need) };
}

const DEFAULT_SUGGESTIONS = ['king-of-the-hill', 'lock-in', 'quarter-bag', 'jackpot'];
function suggest(p: string): Suggestion[] {
  const ranked = TEMPLATES.map((t) => ({ t, s: scoreOf(t, p).score })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
  const pick = [...ranked, ...DEFAULT_SUGGESTIONS.map((n) => TEMPLATES.find((t) => t.name === n)!)].filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 3);
  return pick.map((t) => ({ template: t.name, title: t.make(t.example.toLowerCase()).title, prompt: t.example }));
}

/** Match a prompt to a template, only when confident. */
export function heuristicMatch(raw: string): HeuristicResult {
  const p = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (!p || !DOMAIN.test(p)) return { kind: 'unknown', suggestions: suggest(p) };
  let best: { t: Template; score: number } | null = null;
  for (const t of TEMPLATES) {
    const s = scoreOf(t, p);
    if (s.confident && (!best || s.score > best.score)) best = { t, score: s.score };
  }
  if (!best) return { kind: 'unknown', suggestions: suggest(p) };
  const { title, body } = best.t.make(p);
  const t = q(title);
  return { kind: 'match', script: `rule "${t}"\n${body}`, title: t, template: best.t.name, score: best.score };
}

/** Old API: a confident match or null. */
export function heuristicDraft(raw: string): HeuristicDraft | null {
  const m = heuristicMatch(raw);
  return m.kind === 'match' ? { script: m.script, template: m.template, matched: true, title: m.title } : null;
}

export const heuristicTemplates = () => TEMPLATES.map((t) => t.name);

// ───── honeypot intent ─────
/** Phrases that ask to stop selling with no way out. */
const SELL_BLOCK = [
  /\b(can'?t|cannot|can not|never|nobody|no ?one|no-one|unable to|not (be )?allowed to|forbid(den)?|ban(ned)?|block(ed)?|disable[sd]?|prevent(ed)?|stop(ped)?|lock(ed)?)\b[^.,;]{0,30}\b(sell|sells|selling|sold|exit|exits|dump)\b/,
  /\b(no|zero) (sells|selling|sales|exits?)\b/,
  /\b(sells|selling|sales|exits?)\b[^.,;]{0,20}\b(are|is|get|stay|remain)?\s*(blocked|banned|disabled|forbidden|impossible|not allowed|closed|off|locked)\b/,
  /\bonly (buys|buying)\b(?![^.,;]{0,40}\b(for|first|until|during|before|after|on|while|between)\b)/,
];
const FOREVER = /\b(forever|permanent(ly)?|for good|indefinitely|eternal(ly)?|at all|no matter what|under any|ever again|for all time|all time)\b/;
const HONEYPOT_PHRASE = [
  /\bhoneypot\b/,
  /\block (everyone|everybody|all (the )?holders|holders|buyers|all buyers)( in)?\b/,
  /\btrap (everyone|everybody|holders|buyers|people)\b/,
  /\b(chart|price|number|it) (can )?(only (go|goes) up|goes? up only|never (go(es)?|drops?) down|can'?t go down)\b/,
  /\b(go|goes) up only\b/,
  /\bonly (go|goes) up\b/,
  /\bno exits?\b/,
  /\bnever let (anyone|holders|people|them) (sell|exit|out)\b/,
];
/** A bound or condition that makes a sell restriction temporary or partial (then the fuzzer + honeypot check decide). */
const ESCAPE = [
  /\b(for|in|during|within) (the )?(first |next )?\d+/, /\bfirst (\d+|hour|day|minute|week|month|few)\b/, /\buntil\b/, /\bbefore\b/, /\bafter \d/, /\bunless\b/, /\bexcept\b/,
  /\b(over|above|more than|bigger than|larger than|at most|less than|under)\b/, /\d+\s*%/, /\b(quarter|half)\b/,
  /\bweekends?\b/, /\bnights?\b/, /\bsun\b/, /\bmoon\b/, /\b(odd|even) seconds?\b/, /\bbetween\b/, /\bcool ?downs?\b/, /\bper (hour|day|minute|wallet)\b/,
  /\bonce\b/, /\bwhile\b/, /\bking\b/, /\bcrown(ed)?\b/, /\bpotato\b/, /\btag(ged)?\b/, /\byou'?re it\b/, /\bline\b/, /\bqueue\b/,
];

export interface HoneypotIntent { reason: string; alternative: { prompt: string; title: string; script: string } }

/** Does the prompt ask for a rule that stops holders from ever selling? (hookrz refuses those for every provider.) */
export function honeypotIntent(raw: string): HoneypotIntent | null {
  const p = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const phrase = HONEYPOT_PHRASE.some((r) => r.test(p));
  const block = SELL_BLOCK.some((r) => r.test(p));
  const forever = FOREVER.test(p);
  const escape = ESCAPE.some((r) => r.test(p));
  if (!(phrase || (block && (forever || !escape)))) return null;
  const altPrompt = 'No sells for the first 24 hours after launch';
  const alt = heuristicMatch(altPrompt);
  return {
    reason: 'hookrz refuses rules that stop holders from ever selling: every holder must always be able to sell eventually, even when nobody else trades. A time-boxed lock-in (no sells for a while, then sells open) is the safe version.',
    alternative: { prompt: altPrompt, title: alt.kind === 'match' ? alt.title : altPrompt, script: alt.kind === 'match' ? alt.script : '' },
  };
}
