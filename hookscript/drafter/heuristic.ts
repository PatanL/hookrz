// Offline English -> Hookscript drafter: recognizes the rule families in examples/ and fills in their numbers.
// Used when no ANTHROPIC_API_KEY is set (and as a last resort if the API fails).

export interface HeuristicDraft { script: string; template: string; matched: boolean }

const q = (s: string) => s.replace(/"/g, "'").replace(/[{}]/g, '');
const title = (p: string) => { const t = p.trim().replace(/\s+/g, ' '); return q(t.length > 60 ? t.slice(0, 59).replace(/\s+\S*$/, '') + '…' : t); };

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
const dur = (a: ReturnType<typeof amounts>, def: string, units = ['s', 'm', 'h', 'd', 'w']) => { const x = a.find((y) => units.includes(y.unit)); return x ? `${x.v}${x.unit}` : def; };
const pct = (a: ReturnType<typeof amounts>, def: number) => a.find((y) => y.unit === '%')?.v ?? def;
const plain = (a: ReturnType<typeof amounts>, def: number) => a.find((y) => y.unit === '')?.v ?? def;
const mult = (a: ReturnType<typeof amounts>, def: number) => a.find((y) => y.unit === 'x')?.v ?? def;

const CITIES = ['tokyo', 'new york', 'london', 'paris', 'berlin', 'seoul', 'singapore', 'hong kong', 'shanghai', 'sydney', 'los angeles', 'chicago', 'dubai', 'mumbai', 'lagos', 'sao paulo', 'toronto', 'madrid', 'rome', 'amsterdam'];
const city = (p: string) => CITIES.find((c) => p.includes(c));
const TZ_WORDS: Record<string, string> = { utc: 'UTC', gmt: 'UTC', est: 'America/New_York', et: 'America/New_York', pst: 'America/Los_Angeles', pt: 'America/Los_Angeles', cet: 'Europe/Paris', jst: 'Asia/Tokyo', kst: 'Asia/Seoul' };
function tzOf(p: string): string | null {
  const c = city(p);
  if (c) return c.replace(/\b\w/g, (x) => x.toUpperCase());
  for (const [w, z] of Object.entries(TZ_WORDS)) if (new RegExp(`\\b${w}\\b`).test(p)) return z;
  return null;
}

type T = { name: string; test: (p: string) => boolean; make: (p: string, raw: string) => string };

const TEMPLATES: T[] = [
  {
    name: 'usurp', test: (p) => /usurp|steal the crown|1\.2x|outbid.*crown/.test(p),
    make: (p, raw) => {
      const a = amounts(p);
      const m = mult(a, 1.2), r = pct(a, 1), lock = dur(a.filter((x) => x.unit === 'h'), '12h');
      return `rule "${title(raw)}"
global king: key
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
`;
    },
  },
  {
    name: 'king-of-the-hill', test: (p) => /king|hill|crown|biggest buy/.test(p),
    make: (p, raw) => {
      const a = amounts(p);
      const h = dur(a, '6h', ['h', 'm', 'd']);
      const share = pct(a, 50);
      return `rule "${title(raw)}"
global king: key
global bar: num
global crowned_at: time
global reigns: int
payout ${Math.min(100, share)}% to king

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
`;
    },
  },
  {
    name: 'jackpot', test: (p) => /jackpot|lottery|every\s+\d+(st|nd|rd|th)?\s+buy|\d+(st|nd|rd|th)\s+buy/.test(p),
    make: (p, raw) => {
      const n = plain(amounts(p), 100);
      const share = pct(amounts(p), 25);
      return `rule "${title(raw)}"
global buys: int
global winner: key
global wins: int
payout ${Math.min(100, share)}% to winner as pot

on buy {
  if value >= 0.01 sol {
    set buys += 1
    if buys % ${n} == 0 {
      set winner = buyer
      set wins += 1
    }
  }
}
`;
    },
  },
  {
    name: 'hot-potato', test: (p) => /potato/.test(p),
    make: (p, raw) => {
      const h = dur(amounts(p), '2h', ['h', 'm']);
      return `rule "${title(raw)}"
global potato: key
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
`;
    },
  },
  {
    name: 'tag', test: (p) => /\btag\b|you'?re it|tagged/.test(p),
    make: (p, raw) => {
      const h = dur(amounts(p), '6h', ['h', 'm', 'd']);
      return `rule "${title(raw)}"
global it: key
global tagged_at: time

on send:
  if receiver != sender {
    set it = receiver
    set tagged_at = clock.now
  }

on sell:
  refuse if seller == it and since(tagged_at) < ${h}
    because "You're it! Tag someone (send them any amount) before you sell, or wait {${h} - since(tagged_at)}"
`;
    },
  },
  {
    name: 'invite', test: (p) => /invite/.test(p),
    make: (p, raw) => {
      const h = dur(amounts(p), '1h', ['h', 'm', 'd']);
      return `rule "${title(raw)}"
wallet invited: bool

on send:
  if amount >= 1 { set receiver.invited = true }

on buy:
  refuse if coin.age < ${h} and not wallet.invited and not wallet.is_creator
    because "Invite only for now: ask a holder to send you 1 token. Opens to everyone in {${h} - coin.age}"
`;
    },
  },
  {
    name: 'open-mic', test: (p) => /open mic|one buyer per|one buy per \d+ ?s/.test(p),
    make: (p, raw) => {
      const s = dur(amounts(p), '30s', ['s', 'm']);
      return `rule "${title(raw)}"
global mic: key
global mic_at: time

on buy {
  refuse if since(mic_at) < ${s} and buyer != mic
    because "Someone has the mic. The next slot opens in {${s} - since(mic_at)}"
  if since(mic_at) >= ${s} {
    set mic = buyer
    set mic_at = clock.now
  }
}
`;
    },
  },
  {
    name: 'one-bite', test: (p) => /one bite|one buy\b|only buy once|single buy|buy once/.test(p),
    make: (_p, raw) => `rule "${title(raw)}"
wallet bitten: bool

on buy {
  refuse if wallet.bitten
    because "One buy per wallet: you already bought"
  set wallet.bitten = true
}
`,
  },
  {
    name: 'louder', test: (p) => /louder|beat the (last|previous) buy|bigger than the last/.test(p),
    make: (p, raw) => {
      const m = dur(amounts(p), '10m', ['m', 'h', 's']);
      return `rule "${title(raw)}"
global last_buy: num

on buy {
  refuse if coin.age < ${m} and amount <= last_buy
    because "Louder! Beat the last buy of {last_buy} tokens"
  set last_buy = amount
}
`;
    },
  },
  {
    name: 'queue', test: (p) => /queue|line|cutting|cut the line/.test(p),
    make: (p, raw) => {
      const a = amounts(p);
      const n = plain(a, 3), h = dur(a, '12h', ['h', 'd']);
      return `rule "${title(raw)}"
global buyers: int
wallet number: int

on buy:
  if wallet.number == 0 {
    set buyers += 1
    set wallet.number = buyers
  }

on sell:
  refuse if wallet.number > 0 and buyers - wallet.number < ${n} and wallet.held < ${h}
    because "No cutting the line: wait for ${n} people to buy after you, or {${h} - wallet.held}"
`;
    },
  },
  {
    name: 'birthday', test: (p) => /birthday|party hat|\bhat\b/.test(p),
    make: (p, raw) => {
      const s = dur(amounts(p), '60s', ['s', 'm']);
      const share = pct(amounts(p), 10);
      return `rule "${title(raw)}"
wallet hat: bool
payout ${Math.min(100, share)}% to wallets where hat

on buy:
  if coin.age < ${s} { set wallet.hat = true }

on sell:
  set wallet.hat = false
`;
    },
  },
  {
    name: 'fomo', test: (p) => /fomo|countdown|last buyer|timer/.test(p),
    make: (_p, raw) => `rule "${title(raw)}"
global deadline: time
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
`,
  },
  {
    name: 'stairs', test: (p) => /stairs|at most \d+(\.\d+)?x|twice the (last|previous)|double the (last|previous)/.test(p),
    make: (p, raw) => {
      const m = mult(amounts(p), 2);
      return `rule "${title(raw)}"
global last_buy: num

on buy {
  let cap = max(last_buy * ${m}x, supply * 2%)
  refuse if amount > cap
    because "One step at a time: the biggest buy right now is {cap} tokens"
  set last_buy = amount
}
`;
    },
  },
  {
    name: 'full-moon', test: (p) => /full moon|werewol|moon/.test(p),
    make: (_p, raw) => `rule "${title(raw)}"
on sell:
  refuse if moon_phase() == full
    because "It's a full moon. Sells reopen when it passes"
`,
  },
  {
    name: 'sunrise', test: (p) => /sunrise|sun is up|sun is down|daylight|while the sun|at night|nighttime/.test(p),
    make: (p, raw) => {
      const c = city(p) ?? 'tokyo';
      const C = c.replace(/\b\w/g, (x) => x.toUpperCase());
      const night = /only at night|night only|nighttime only|after dark/.test(p);
      return `rule "${title(raw)}"
on buy, sell:
  refuse if ${night ? '' : 'not '}daylight(tz: "${C}")
    because "${night ? `The sun is up in ${C}. Trading opens after dark` : `The sun is down in ${C}. Trading reopens at sunrise`}; sends always work"
`;
    },
  },
  {
    name: 'odd-even', test: (p) => /odd|even second/.test(p),
    make: (_p, raw) => `rule "${title(raw)}"
on buy:
  refuse if clock.second % 2 == 0 because "Buys only on odd seconds. Try again"
on sell:
  refuse if clock.second % 2 == 1 because "Sells only on even seconds. Try again"
`,
  },
  {
    name: 'weekend-closed', test: (p) => /weekend|saturday|sunday/.test(p),
    make: (p, raw) => {
      const z = tzOf(p);
      return `rule "${title(raw)}"
${z ? `timezone "${z}"\n` : ''}on buy, sell:
  refuse if clock.weekday in [sat, sun]
    because "The curve is closed on weekends${z ? ` (${z} time)` : ' (UTC)'}. Sends still work"
`;
    },
  },
  {
    name: 'last-call', test: (p) => /last call|closes? at|bar closes|no buys after \d/.test(p),
    make: (p, raw) => {
      const m = p.match(/(\d{1,2})(?::00)?\s*(am|pm)?/);
      let hr = m ? Number(m[1]) % 24 : 23;
      if (m?.[2] === 'pm' && hr < 12) hr += 12;
      const z = tzOf(p) ?? 'UTC';
      return `rule "${title(raw)}"
on buy:
  refuse if clock.hour(tz: "${z}") == ${hr}
    because "Last call was at ${String((hr + 23) % 24).padStart(2, '0')}:59 (${z}). Buys reopen in an hour; sells stay open"
`;
    },
  },
  {
    name: 'trading-hours', test: (p) => /between \d{1,2}\s*(am|pm)?\s*(and|-|to)\s*\d{1,2}|business hours|market hours|9 ?to ?5/.test(p),
    make: (p, raw) => {
      const m = p.match(/(\d{1,2})\s*(am|pm)?\s*(?:and|-|to)\s*(\d{1,2})\s*(am|pm)?/);
      let a = m ? Number(m[1]) : 9, b = m ? Number(m[3]) : 17;
      if (m?.[2] === 'pm' && a < 12) a += 12;
      if ((m?.[4] === 'pm' || (!m?.[4] && b < a)) && b < 12) b += 12;
      const z = tzOf(p) ?? 'America/New_York';
      return `rule "${title(raw)}"
timezone "${z}"
on buy, sell:
  refuse if clock.hour < ${a} or clock.hour >= ${b}
    because "The curve trades ${a}:00-${b}:00 ${z} time. Sends always work"
`;
    },
  },
  {
    name: 'library', test: (p) => /library|quiet|one trade per (wallet|hour)/.test(p),
    make: (p, raw) => {
      const a = amounts(p);
      const h = dur(a, '1h', ['h', 'm']);
      const cap = pct(a, 0.5);
      return `rule "${title(raw)}"
wallet last_trade_at: time

on buy, sell {
  refuse if since(wallet.last_trade_at) < ${h}
    because "Shh. One trade per wallet every ${h}. Next one in {${h} - since(wallet.last_trade_at)}"
  refuse if amount > supply * ${cap}%
    because "Shh. Nothing over ${cap}% of supply in one go"
  set wallet.last_trade_at = clock.now
}
`;
    },
  },
  {
    name: 'pump-pause', test: (p) => /pump|price (is )?up|spike|price.*%|% .*price/.test(p),
    make: (p, raw) => {
      const a = amounts(p);
      const x = pct(a, 30), m = dur(a, '10m', ['m', 'h']);
      return `rule "${title(raw)}"
on buy:
  refuse if curve.price > curve.price_at(ago: ${m}) * ${100 + x}%
    because "Price is up more than ${x}% in ${m}; buys pause until it cools off"
`;
    },
  },
  {
    name: 'no-aggregator', test: (p) => /jupiter|aggregator|router/.test(p),
    make: (p, raw) => {
      const m = dur(amounts(p), '5m', ['m', 'h']);
      return `rule "${title(raw)}"
on buy:
  refuse if coin.age < ${m} and transfer.app == program("jupiter")
    because "For now, buy on the curve directly. Aggregators open in {${m} - coin.age}"
`;
    },
  },
  {
    name: 'sell-what-you-bought', test: (p) => /more than (they|you) bought|sell.*what.*bought|bought this hour/.test(p),
    // the literal rule is a honeypot (received(1h) drops to 0); this version adds the escape hatch the checker needs
    make: (p, raw) => {
      const h = dur(amounts(p), '1h', ['h', 'm']);
      return `rule "${title(raw)}"
on sell:
  refuse if wallet.held < 24h and amount > wallet.received(window: ${h})
    because "In your first day you can sell at most what you bought in the last ${h}. After 24h, anything goes"
`;
    },
  },
  {
    name: 'max-wallet', test: (p) => /max(imum)? wallet|no wallet (over|above|more than)|hold more than|bag over/.test(p),
    make: (p, raw) => {
      const x = pct(amounts(p), 2);
      return `rule "${title(raw)}"
on buy, send:
  refuse if not receiver.is_creator and receiver.balance_after > supply * ${x}%
    because "No wallet can hold more than ${x}% of supply"
`;
    },
  },
  {
    name: 'sell-cooldown', test: (p) => /cooldown|between sells|one sell (per|every)/.test(p),
    make: (p, raw) => {
      const m = dur(amounts(p), '10m', ['m', 'h', 's']);
      return `rule "${title(raw)}"
on sell:
  refuse if since(wallet.last_sell) < ${m}
    because "One sell every ${m}. Next one in {${m} - since(wallet.last_sell)}"
`;
    },
  },
  {
    name: 'quarter-bag', test: (p) => /sell|bag|dump/.test(p),
    make: (p, raw) => {
      const a = amounts(p);
      const x = pct(a, 25), h = dur(a, '2h', ['h', 'm', 'd']);
      return `rule "${title(raw)}"
on sell:
  refuse if wallet.held < ${h} and amount > wallet.balance * ${x}%
    because "No single sell over ${x}% of your bag in your first ${h}"
`;
    },
  },
];

export function heuristicDraft(raw: string): HeuristicDraft {
  const p = raw.toLowerCase();
  for (const t of TEMPLATES) if (t.test(p)) return { script: t.make(p, raw), template: t.name, matched: true };
  return { script: TEMPLATES.at(-1)!.make(p, raw), template: 'quarter-bag', matched: false };
}

export const heuristicTemplates = () => TEMPLATES.map((t) => t.name);
