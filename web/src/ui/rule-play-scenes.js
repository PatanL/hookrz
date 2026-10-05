// "Watch it play": a short scripted scene per rule idea, run against the REAL Hookscript VM.
// Each idea's script is hookscript/examples/<id>.hs (bundled in src/vendor/hookscript.js). runScene() compiles it,
// plays the scene's trades through hs.attempt (the same interpreter the tester and the fuzzer use, state kept between
// trades) and returns frames: every verdict and every refusal message is the VM's own (hs.formatReason). Chips, badges
// and notes are read back from the script's state after each trade, so they can only say what the rule really did.
// Pure module (no DOM, no CSS): the player (rule-play.js) and tests/rule-play.test.mjs both run it.

const M = 60, H = 3600, D = 86400;
/** Default launch: Monday 2026-10-05, 16:00 UTC (the tester's launch time). */
export const T0 = 1_791_216_000n;
const iso = (s) => BigInt(Date.parse(s) / 1000);
const UNIT = 1_000_000n;

// ───────── words ─────────
/** "5h 55m", "29s", "1d 2h" (two units at most, like the VM's own reasons). */
export function dur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < H) { const m = Math.floor(s / M), x = s % M; return x ? `${m}m ${x}s` : `${m}m`; }
  if (s < D) { const h = Math.floor(s / H), m = Math.floor((s % H) / M); return m ? `${h}h ${m}m` : `${h}h`; }
  const d = Math.floor(s / D), h = Math.floor((s % D) / H);
  return h ? `${d}d ${h}h` : `${d}d`;
}
const you = (n) => n === 'You';
/** Subject + verb that agrees: v('You', 'take', 'takes') → "You take". */
const v = (n, base, third) => `${n} ${you(n) ? base : third}`;
const isIt = (n) => (you(n) ? "You're" : `${n} is`);
const PART = { 1: 'everything', 0.5: 'half', 0.25: 'a quarter', 0.1: 'a tenth' };
const tokWord = (n) => `${n.toLocaleString('en-US')} token${n === 1 ? '' : 's'}`;
const solWord = (x) => `${x} SOL`;
const names = (xs) => (xs.length ? xs.length > 3 ? `${xs.slice(0, 3).join(', ')} +${xs.length - 3}` : xs.join(', ') : 'nobody yet');
const hhmm = (unix, off = 0) => { const s = ((unix + off) % D + D) % D; return `${String(Math.floor(s / H)).padStart(2, '0')}:${String(Math.floor((s % H) / M)).padStart(2, '0')}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tokens = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${Math.round(n)}`);
/** "half the", "a quarter of the", "30% of the" (followed by "creator fees"). */
const shareOf = (bps) => ({ 5000: 'half the', 2500: 'a quarter of the' }[bps] ?? `${bps / 100}% of the`);

/** How a scene's clock reads: since launch, or the wall clock the rule cares about. */
const CLOCK = {
  since: { full: (t) => (t ? `Launch +${dur(t)}` : 'Launch'), short: (t) => (t ? `+${dur(t)}` : '0s') },
  hms: {
    full: (t) => (t ? `Launch +${Math.floor(t / H)}:${String(Math.floor((t % H) / M)).padStart(2, '0')}:${String(t % M).padStart(2, '0')}` : 'Launch'),
    short: (t) => `${Math.floor(t / H)}:${String(Math.floor((t % H) / M)).padStart(2, '0')}:${String(t % M).padStart(2, '0')}`,
  },
  utc: { full: (t, u) => `${hhmm(u)} UTC`, short: (t, u) => hhmm(u) },
  tokyo: { full: (t, u) => `${hhmm(u, 9 * H)} in Tokyo`, short: (t, u) => hhmm(u, 9 * H) },
  sec: { full: (t, u) => `${hhmm(u)}:${String(u % 60).padStart(2, '0')} UTC`, short: (t, u) => `:${String(u % 60).padStart(2, '0')}` },
  date: {
    full: (t, u) => { const d = new Date(u * 1000); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${hhmm(u)} UTC`; },
    short: (t, u) => { const d = new Date(u * 1000); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()} ${hhmm(u)}`; },
  },
};

// ───────── the scenes ─────────
// A beat is one trade: { at: seconds since launch, who, buy: SOL | sell: part of bag | send: receiver (+ tok or part),
//   expect: 'ok' | 'no', want: { global: value, 'Name.var': value } checked by the test, ff: true for a fast-forward,
//   say: custom line, note: a line shown only when the VM agrees with `expect` }.
// A crowd beat is { at, crowd: n, sol }: n buys by passers-by, run one by one through the VM, shown as one line.
// chips(V) → [label, value][], badges(V) → [{ who, glyph, text? }], notes(A, B, beat) → [{ glyph, text }] read state.
export const SCENES = {
  'king-of-the-hill': {
    cast: ['Degen', 'Whale', 'Paper hands', 'You'],
    beats: [
      { at: 0, who: 'Degen', buy: 0.5, expect: 'ok', want: { king: 'Degen' } },
      { at: 1 * M, who: 'Whale', buy: 4, expect: 'ok', want: { king: 'Whale' } },
      { at: 2 * M, who: 'Paper hands', buy: 0.3, expect: 'ok', want: { king: 'Whale' } },
      { at: 30 * M, who: 'Whale', sell: 0.5, expect: 'no' },
      { at: 32 * M, who: 'Paper hands', sell: 1, expect: 'ok', note: 'Only the king is locked' },
      { at: 2 * H + 30 * M, ff: true, who: 'You', buy: 3, expect: 'ok', want: { king: 'You' } },
      { at: 2 * H + 31 * M, who: 'Whale', sell: 0.5, expect: 'ok', note: 'Whale lost the crown, so Whale can sell' },
      { at: 2 * H + 33 * M, who: 'You', sell: 0.5, expect: 'no' },
      { at: 8 * H + 35 * M, ff: true, who: 'You', sell: 0.5, expect: 'ok', want: { king: 'You' }, note: 'The 6h lock is over' },
    ],
    chips: (V) => {
      const k = V.g.king;
      if (!k) return [['King', 'nobody yet']];
      const left = 6 * H - (V.t - V.g.crowned_at);
      return [['King', k], ['Sell lock', left > 0 ? `${dur(left)} left` : 'over']];
    },
    badges: (V) => (V.g.king ? [{ who: V.g.king, glyph: 'crown' }] : []),
    notes: (A, B, b) => (B.g.king && B.g.king !== A.g.king ? [{ glyph: 'crown', text: `${v(B.g.king, 'take', 'takes')} the crown`, hi: true }]
      : b.buy != null && A.g.king && B.g.bar === A.g.bar ? [{ glyph: 'crown', text: `Not big enough: ${B.g.king} keeps the crown` }] : []),
    payout: (p) => `The keeper pays the king ${shareOf(p.share_bps)} creator fees while they reign.`,
  },

  tag: {
    cast: ['Degen', 'Whale', 'Paper hands', 'You'],
    beats: [
      { at: 0, who: 'Degen', buy: 1, expect: 'ok' },
      { at: 1 * M, who: 'Whale', buy: 2, expect: 'ok' },
      { at: 5 * M, who: 'Degen', send: 'You', tok: 1000, expect: 'ok', want: { it: 'You' }, say: 'Degen tags You with 1,000 tokens' },
      { at: 6 * M, who: 'You', sell: 0.5, expect: 'no' },
      { at: 7 * M, who: 'You', send: 'Whale', tok: 10, expect: 'ok', want: { it: 'Whale' }, say: 'You tag Whale with 10 tokens' },
      { at: 8 * M, who: 'You', sell: 0.5, expect: 'ok' },
      { at: 20 * M, who: 'Whale', sell: 0.5, expect: 'no' },
      { at: 21 * M, who: 'Whale', send: 'Paper hands', tok: 10, expect: 'ok', want: { it: 'Paper hands' }, say: 'Whale tags Paper hands' },
      { at: 22 * M, who: 'Whale', sell: 0.5, expect: 'ok' },
      { at: 25 * M, who: 'Paper hands', sell: 1, expect: 'no' },
      { at: 6 * H + 25 * M, ff: true, who: 'Paper hands', sell: 1, expect: 'ok', note: 'After 6h the tag wears off' },
    ],
    chips: (V) => {
      const it = V.g.it;
      if (!it) return [['It', 'nobody yet']];
      const left = 6 * H - (V.t - V.g.tagged_at);
      return [['It', it], ['Sell lock', left > 0 ? `${dur(left)} left` : 'over']];
    },
    badges: (V) => (V.g.it ? [{ who: V.g.it, glyph: 'tag' }] : []),
    notes: (A, B) => (B.g.it && B.g.it !== A.g.it ? [{ glyph: 'tag', text: `${isIt(B.g.it)} it` }] : []),
  },

  'hot-potato': {
    cast: ['Degen', 'Whale', 'You'],
    beats: [
      { at: 0, who: 'Degen', buy: 1, expect: 'ok', want: { potato: 'Degen' } },
      { at: 1 * M, who: 'Whale', buy: 2, expect: 'ok' },
      { at: 30 * M, who: 'Degen', sell: 0.5, expect: 'no' },
      { at: 31 * M, who: 'Degen', send: 'Whale', tok: 100, expect: 'ok', want: { potato: 'Whale' }, say: 'Degen passes it to Whale with 100 tokens' },
      { at: 32 * M, who: 'Degen', sell: 0.5, expect: 'ok' },
      { at: 1 * H, who: 'Whale', sell: 0.5, expect: 'no' },
      { at: 2 * H + 40 * M, ff: true, who: 'You', buy: 0.5, expect: 'ok', want: { loser: 'Whale', potato: 'You' } },
      { at: 2 * H + 41 * M, who: 'Whale', buy: 1, expect: 'no' },
      { at: 2 * H + 42 * M, who: 'Whale', sell: 0.5, expect: 'ok', note: 'Burnt, but free to sell' },
      { at: 2 * H + 50 * M, who: 'You', send: 'Degen', tok: 100, expect: 'ok', want: { potato: 'Degen' }, say: 'You pass it to Degen' },
      { at: 1 * D + 3 * H, ff: true, who: 'Whale', buy: 1, expect: 'ok', want: { loser: 'Degen', potato: 'Whale' } },
    ],
    chips: (V) => {
      const p = V.g.potato, out = [];
      if (!p) out.push(['Potato', 'free']);
      else { const left = 2 * H - (V.t - V.g.caught_at); out.push(['Potato', p], ['Burns in', left > 0 ? dur(left) : 'now']); }
      if (V.g.loser && V.t - V.g.burnt_at < D) out.push(['Burnt', V.g.loser]);
      return out;
    },
    badges: (V) => [...(V.g.potato ? [{ who: V.g.potato, glyph: 'potato' }] : []), ...(V.g.loser && V.t - V.g.burnt_at < D ? [{ who: V.g.loser, glyph: 'burn', text: 'burnt' }] : [])],
    notes: (A, B) => [
      ...(B.g.loser && B.g.loser !== A.g.loser ? [{ glyph: 'burn', text: `The potato burns ${B.g.loser}: no buys for a day` }] : []),
      ...(B.g.potato && B.g.potato !== A.g.potato ? [{ glyph: 'potato', text: `${v(B.g.potato, 'catch', 'catches')} the hot potato` }] : []),
    ],
  },

  jackpot: {
    cast: ['Degen', 'Sniper bot', 'Whale', 'You'],
    beats: [
      { at: 0, who: 'Degen', buy: 0.5, expect: 'ok', want: { buys: 1 } },
      { at: 10, who: 'Sniper bot', buy: 0.005, expect: 'ok', want: { buys: 1 }, say: 'Sniper bot buys dust, 0.005 SOL' },
      { at: 1 * M, who: 'Whale', buy: 2, expect: 'ok', want: { buys: 2 } },
      { at: 2 * M, who: 'You', buy: 0.2, expect: 'ok', want: { buys: 3 } },
      { at: 3 * H, ff: true, crowd: 95, sol: 0.03, want: { buys: 98 } },
      { at: 3 * H + 1 * M, who: 'Whale', buy: 1, expect: 'ok', want: { buys: 99 } },
      { at: 3 * H + 2 * M, who: 'Sniper bot', buy: 0.005, expect: 'ok', want: { buys: 99, wins: 0 }, say: 'Sniper bot snipes for #100 with dust' },
      { at: 3 * H + 3 * M, who: 'You', buy: 0.2, expect: 'ok', want: { buys: 100, winner: 'You', wins: 1 } },
      { at: 3 * H + 5 * M, who: 'Degen', buy: 0.5, expect: 'ok', want: { buys: 101, winner: 'You' } },
    ],
    chips: (V) => [['Buys', String(V.g.buys)], ['Pot in', `${100 - (V.g.buys % 100)} buy${100 - (V.g.buys % 100) === 1 ? '' : 's'}`], ['Winner', V.g.winner ?? 'nobody yet']],
    badges: (V) => (V.g.winner ? [{ who: V.g.winner, glyph: 'coin' }] : []),
    notes: (A, B, b) => {
      if (B.g.buys === A.g.buys) return b.crowd ? [] : [{ glyph: 'cross', text: 'Under 0.01 SOL: no number' }];
      if (B.g.wins > A.g.wins) return [{ glyph: 'coin', text: `Buy #${B.g.buys}: ${v(B.g.winner, 'win', 'wins')} the pot`, hi: true }];
      return b.crowd ? [] : [{ glyph: 'coin', text: `Buy #${B.g.buys}` }];
    },
    payout: (p) => `The keeper pays each winner the pot: ${shareOf(p.share_bps)} creator fees since the last win.`,
  },

  fomo: {
    cast: ['Degen', 'Whale', 'Sniper bot', 'You'],
    clock: 'hms',
    beats: [
      { at: 0, who: 'Degen', buy: 0.5, expect: 'ok', want: { last_buyer: 'Degen' } },
      { at: 10 * M, who: 'Whale', buy: 1, expect: 'ok' },
      { at: 20 * M, who: 'You', buy: 0.2, expect: 'ok', want: { last_buyer: 'You' } },
      { at: 1 * H + 20, ff: true, who: 'Sniper bot', buy: 0.01, expect: 'no' },
      { at: 1 * H + 25, who: 'Degen', buy: 0.06, expect: 'ok', want: { last_buyer: 'Degen' } },
      { at: 1 * H + 60, who: 'Sniper bot', buy: 0.01, expect: 'no' },
      { at: 1 * H + 80, who: 'You', buy: 0.1, expect: 'ok', want: { last_buyer: 'You' } },
      { at: 1 * H + 5 * M, ff: true, who: 'Whale', buy: 0.5, expect: 'ok', want: { winner: 'You', round: 1, last_buyer: 'Whale' } },
    ],
    chips: (V) => {
      const live = V.g.deadline != null && V.t < V.g.deadline;
      return [['Clock', V.g.deadline == null ? 'not started' : live ? `${dur(V.g.deadline - V.t)} left` : 'ran out'], ['Last buyer', V.g.last_buyer ?? 'nobody yet'], ...(V.g.winner ? [['Winner', V.g.winner]] : [])];
    },
    badges: (V) => [...(V.g.last_buyer ? [{ who: V.g.last_buyer, glyph: 'hourglass' }] : []), ...(V.g.winner && V.g.winner !== V.g.last_buyer ? [{ who: V.g.winner, glyph: 'coin' }] : [])],
    notes: (A, B) => {
      const out = [];
      if (B.g.round > A.g.round) out.push({ glyph: 'coin', text: `The clock ran out: ${v(B.g.winner, 'win', 'wins')} round ${B.g.round}`, hi: true }, { glyph: 'hourglass', text: 'This buy starts the next round' });
      else if (A.g.deadline == null && B.g.deadline != null) out.push({ glyph: 'hourglass', text: 'The clock starts: 1h to go' });
      else if (B.g.deadline > A.g.deadline) out.push({ glyph: 'hourglass', text: `+30s on the clock: ${dur(B.g.deadline - B.t)} left` });
      return out;
    },
    payout: (p) => `The keeper pays the winner the pot: ${shareOf(p.share_bps)} creator fees since the last round.`,
  },

  'full-moon': {
    cast: ['Degen', 'Paper hands', 'Whale', 'You'],
    launch: iso('2026-10-24T18:00:00Z'),
    clock: 'date',
    probe: `rule "moon"\nglobal light: num\nglobal is_full: bool\nglobal age: num\non buy {\n  set light = moon.illumination\n  set is_full = moon_phase() == full\n  set age = moon.age\n}\n`,
    beats: [
      { at: 0, who: 'Degen', buy: 1, expect: 'ok' },
      { at: 1 * M, who: 'Paper hands', buy: 0.5, expect: 'ok' },
      { at: 6 * H, who: 'Paper hands', sell: 0.25, expect: 'ok' },
      { at: 25 * H, ff: true, who: 'Paper hands', sell: 0.5, expect: 'no' },
      { at: 25 * H + 5 * M, who: 'Whale', buy: 2, expect: 'ok', note: 'Buys stay open under the full moon' },
      { at: 25 * H + 10 * M, who: 'Degen', send: 'You', tok: 1000, expect: 'ok', note: 'Sends work too' },
      { at: 25 * H + 15 * M, who: 'You', sell: 1, expect: 'no' },
      { at: 47 * H, ff: true, who: 'Paper hands', sell: 0.5, expect: 'ok', note: 'The full moon has passed' },
      { at: 47 * H + 2 * M, who: 'You', sell: 1, expect: 'ok' },
    ],
    chips: (V) => [['Moon', V.p.is_full ? 'full' : `${Math.floor(V.p.light * 100)}% lit, ${V.p.age < 14.77 ? 'waxing' : 'waning'}`], ['Sells', V.p.is_full ? 'closed' : 'open']],
    badges: () => [],
  },

  invite: {
    cast: ['Creator', 'Sniper bot', 'Degen', 'You'],
    beats: [
      { at: 0, who: 'Creator', buy: 1, expect: 'ok', say: 'Creator makes the launch buy, 1 SOL' },
      { at: 1, who: 'Sniper bot', buy: 2, expect: 'no' },
      { at: 2 * M, who: 'Creator', send: 'Degen', tok: 1000, expect: 'ok', want: { 'Degen.invited': true }, say: 'Creator invites Degen with 1,000 tokens' },
      { at: 3 * M, who: 'Degen', buy: 0.5, expect: 'ok' },
      { at: 5 * M, who: 'Degen', send: 'You', tok: 10, expect: 'ok', want: { 'You.invited': true }, say: 'Degen invites You with 10 tokens' },
      { at: 6 * M, who: 'You', buy: 0.3, expect: 'ok' },
      { at: 10 * M, who: 'Sniper bot', buy: 2, expect: 'no' },
      { at: 1 * H, ff: true, who: 'Sniper bot', buy: 2, expect: 'ok', want: { 'Sniper bot.invited': false }, note: 'The first hour is over: open to everyone' },
    ],
    chips: (V) => [['Invited', names(V.cast.filter((n) => V.w[n]?.invited))], ['Open to all', V.t < H ? `in ${dur(H - V.t)}` : 'now']],
    badges: (V) => V.cast.filter((n) => V.w[n]?.invited).map((who) => ({ who, glyph: 'envelope' })),
    notes: (A, B) => B.cast.filter((n) => B.w[n]?.invited && !A.w[n]?.invited).map((n) => ({ glyph: 'envelope', text: `${isIt(n)} invited` })),
  },

  'one-bite': {
    cast: ['Degen', 'Sniper bot', 'Whale', 'You'],
    beats: [
      { at: 0, who: 'Degen', buy: 0.5, expect: 'ok', want: { 'Degen.bitten': true } },
      { at: 5, who: 'Sniper bot', buy: 1, expect: 'ok' },
      { at: 1 * M, who: 'Whale', buy: 3, expect: 'ok' },
      { at: 2 * M, who: 'Whale', buy: 3, expect: 'no', say: 'Whale goes back for seconds, 3 SOL' },
      { at: 3 * M, who: 'Sniper bot', sell: 1, expect: 'ok' },
      { at: 4 * M, who: 'Sniper bot', buy: 1, expect: 'no', note: 'Selling doesn’t give the bite back' },
      { at: 1 * D, ff: true, who: 'Degen', buy: 0.5, expect: 'no', say: 'Degen buys the dip, 0.5 SOL' },
      { at: 1 * D + 1 * M, who: 'Degen', send: 'You', tok: 1000, expect: 'ok', want: { 'You.bitten': false }, note: 'A gift isn’t a bite' },
      { at: 1 * D + 2 * M, who: 'You', buy: 0.5, expect: 'ok', want: { 'You.bitten': true } },
    ],
    chips: (V) => [['Bitten', names(V.cast.filter((n) => V.w[n]?.bitten))]],
    badges: (V) => V.cast.filter((n) => V.w[n]?.bitten).map((who) => ({ who, glyph: 'apple' })),
    notes: (A, B) => B.cast.filter((n) => B.w[n]?.bitten && !A.w[n]?.bitten).map((n) => ({ glyph: 'apple', text: `${v(n, 'take', 'takes')} ${you(n) ? 'your' : 'their'} one bite` })),
  },

  louder: {
    cast: ['Paper hands', 'Sniper bot', 'Degen', 'You', 'Whale'],
    beats: [
      { at: 0, who: 'Paper hands', buy: 0.1, expect: 'ok' },
      { at: 10, who: 'Sniper bot', buy: 0.05, expect: 'no' },
      { at: 20, who: 'Degen', buy: 0.5, expect: 'ok' },
      { at: 1 * M, who: 'You', buy: 0.5, expect: 'no', say: 'You buy 0.5 SOL too', note: 'Same SOL, higher price: fewer tokens' },
      { at: 1 * M + 10, who: 'You', buy: 1, expect: 'ok' },
      { at: 3 * M, who: 'Whale', buy: 4, expect: 'ok' },
      { at: 5 * M, who: 'Sniper bot', buy: 1, expect: 'no' },
      { at: 10 * M, ff: true, who: 'Sniper bot', buy: 0.05, expect: 'ok', note: 'The opening auction is over' },
    ],
    chips: (V) => (V.t < 10 * M ? [['Buy to beat', V.g.last_buy ? `${tokens(V.g.last_buy)} tokens` : 'any size'], ['Auction', `${dur(10 * M - V.t)} left`]] : [['Buy to beat', 'any size'], ['Auction', 'over']]),
    badges: () => [],
    notes: (A, B, b) => (b.at < 10 * M && B.g.last_buy !== A.g.last_buy ? [{ glyph: 'speaker', text: `Loudest so far: ${tokens(B.g.last_buy)} tokens` }] : []),
  },

  sunrise: {
    cast: ['Degen', 'Whale', 'Paper hands', 'You'],
    launch: iso('2026-10-05T20:30:00Z'), // 05:30 in Tokyo
    clock: 'tokyo',
    probe: `rule "sun"\nglobal up: bool\non buy {\n  set up = daylight(tz: "Asia/Tokyo")\n}\n`,
    beats: [
      { at: 0, who: 'Degen', buy: 1, expect: 'no' },
      { at: 20 * M, who: 'Degen', buy: 1, expect: 'ok', note: 'Sunrise: the curve opens' },
      { at: 21 * M, who: 'You', buy: 0.5, expect: 'ok' },
      { at: 22 * M, who: 'Degen', send: 'Paper hands', tok: 1000, expect: 'ok' },
      { at: 11 * H + 35 * M, ff: true, who: 'Paper hands', sell: 1, expect: 'ok' },
      { at: 11 * H + 50 * M, who: 'Whale', buy: 2, expect: 'no' },
      { at: 11 * H + 51 * M, who: 'You', sell: 0.5, expect: 'no' },
      { at: 11 * H + 52 * M, who: 'Degen', send: 'You', tok: 500, expect: 'ok', note: 'Sends work at any hour' },
      { at: 24 * H + 20 * M, ff: true, who: 'Whale', buy: 2, expect: 'ok' },
    ],
    chips: (V) => [['Tokyo', hhmm(V.u, 9 * H)], ['Sun', V.p.up ? 'up' : 'down'], ['Trading', V.p.up ? 'open' : 'closed']],
    badges: () => [],
  },

  'last-call': {
    cast: ['Degen', 'Whale', 'You'],
    launch: iso('2026-10-05T22:30:00Z'),
    clock: 'utc',
    beats: [
      { at: 0, who: 'Degen', buy: 1, expect: 'ok' },
      { at: 28 * M, who: 'Whale', buy: 2, expect: 'ok', say: 'Whale squeezes in a buy, 2 SOL' },
      { at: 30 * M, who: 'You', buy: 0.5, expect: 'no' },
      { at: 45 * M, who: 'Degen', sell: 0.5, expect: 'ok', note: 'Sells stay open' },
      { at: 70 * M, who: 'Whale', buy: 1, expect: 'no' },
      { at: 89 * M + 30, who: 'You', buy: 0.5, expect: 'no' },
      { at: 90 * M, who: 'You', buy: 0.5, expect: 'ok', note: 'Midnight: buys reopen' },
      { at: 91 * M, who: 'Whale', buy: 1, expect: 'ok' },
    ],
    chips: (V) => { const hr = Math.floor((((V.u % D) + D) % D) / H); return [['Clock', `${hhmm(V.u)} UTC`], ['Buys', hr === 23 ? 'closed' : 'open'], ['Sells', 'open']]; },
    badges: () => [],
  },

  'odd-even': {
    cast: ['Sniper bot', 'Degen', 'You'],
    clock: 'sec',
    beats: [
      { at: 6, who: 'Sniper bot', buy: 1, expect: 'no' },
      { at: 7, who: 'Sniper bot', buy: 1, expect: 'ok' },
      { at: 8, who: 'Degen', buy: 0.5, expect: 'no' },
      { at: 9, who: 'Degen', buy: 0.5, expect: 'ok' },
      { at: 11, who: 'Sniper bot', sell: 1, expect: 'no' },
      { at: 12, who: 'Sniper bot', sell: 1, expect: 'ok' },
      { at: 13, who: 'You', buy: 0.5, expect: 'ok' },
      { at: 15, who: 'You', send: 'Degen', tok: 100, expect: 'ok', note: 'Sends work on any second' },
      { at: 17, who: 'You', sell: 0.5, expect: 'no' },
      { at: 18, who: 'You', sell: 0.5, expect: 'ok' },
    ],
    chips: (V) => [['Second', String(V.u % 60)], ['Now', V.u % 2 ? 'buys only' : 'sells only']],
    badges: () => [],
  },

  queue: {
    cast: ['Sniper bot', 'Degen', 'Whale', 'You', 'Paper hands'],
    beats: [
      { at: 0, who: 'Sniper bot', buy: 1, expect: 'ok', want: { 'Sniper bot.number': 1 } },
      { at: 30, who: 'Sniper bot', sell: 1, expect: 'no' },
      { at: 1 * M, who: 'Degen', buy: 0.5, expect: 'ok' },
      { at: 2 * M, who: 'Whale', buy: 2, expect: 'ok' },
      { at: 3 * M, who: 'Sniper bot', sell: 1, expect: 'no' },
      { at: 4 * M, who: 'You', buy: 0.5, expect: 'ok', want: { buyers: 4 } },
      { at: 5 * M, who: 'Sniper bot', sell: 1, expect: 'ok', note: '3 wallets bought after #1' },
      { at: 6 * M, who: 'Degen', sell: 0.5, expect: 'no' },
      { at: 7 * M, who: 'Paper hands', buy: 0.3, expect: 'ok' },
      { at: 8 * M, who: 'Degen', sell: 0.5, expect: 'ok', note: '3 wallets bought after #2' },
      { at: 12 * H + 4 * M, ff: true, who: 'You', sell: 0.5, expect: 'ok', note: 'Held 12h: free to sell' },
    ],
    chips: (V) => [['Buyers in line', String(V.g.buyers)]],
    badges: (V) => V.cast.filter((n) => V.w[n]?.number).map((who) => ({ who, glyph: null, text: `#${V.w[who].number}` })),
    notes: (A, B) => B.cast.filter((n) => B.w[n]?.number && !A.w[n]?.number).map((n) => ({ glyph: 'people', text: `${v(n, 'take', 'takes')} number ${B.w[n].number}` })),
  },

  usurp: {
    cast: ['Degen', 'You', 'Whale'],
    beats: [
      { at: 0, who: 'Degen', buy: 1, expect: 'ok', want: { king: 'Degen' } },
      { at: 1 * M, who: 'You', buy: 1.1, expect: 'ok', want: { king: 'Degen' } },
      { at: 2 * M, who: 'Whale', buy: 4, expect: 'ok', want: { king: 'Whale' } },
      { at: 30 * M, who: 'Whale', sell: 0.5, expect: 'no' },
      { at: 31 * M, who: 'Whale', send: 'You', tok: 1000, expect: 'no', say: 'Whale tries to send 1,000 tokens to You' },
      { at: 3 * H, ff: true, who: 'Degen', buy: 1, expect: 'ok', want: { king: 'Degen' }, note: 'The bar fades 1% a minute' },
      { at: 3 * H + 1 * M, who: 'Whale', sell: 0.5, expect: 'ok' },
      { at: 3 * H + 2 * M, who: 'Degen', sell: 0.5, expect: 'no' },
      { at: 15 * H + 5 * M, ff: true, who: 'Degen', sell: 0.5, expect: 'ok', note: 'The 12h crown lapsed' },
    ],
    chips: (V) => {
      if (!V.g.king) return [['King', 'nobody yet']];
      const left = 12 * H - (V.t - V.g.crowned_at);
      return [['King', V.g.king], ['Sell lock', left > 0 ? `${dur(left)} left` : 'over']];
    },
    badges: (V) => (V.g.king ? [{ who: V.g.king, glyph: 'crown' }] : []),
    notes: (A, B, b) => (B.g.king && B.g.king !== A.g.king ? [{ glyph: 'crown', text: `${A.g.king ? v(B.g.king, 'steal', 'steals') : v(B.g.king, 'take', 'takes')} the crown` }]
      : b.buy != null && A.g.king && B.g.bar === A.g.bar ? [{ glyph: 'crown', text: `Under 1.2× the king’s buy: ${B.g.king} keeps it` }] : []),
    payout: (p) => `The keeper pays the king ${shareOf(p.share_bps)} creator fees for every minute they reign.`,
  },

  birthday: {
    cast: ['Sniper bot', 'Degen', 'You', 'Whale'],
    beats: [
      { at: 2, who: 'Sniper bot', buy: 1, expect: 'ok', want: { 'Sniper bot.hat': true } },
      { at: 20, who: 'Degen', buy: 0.5, expect: 'ok', want: { 'Degen.hat': true } },
      { at: 55, who: 'You', buy: 0.3, expect: 'ok', want: { 'You.hat': true } },
      { at: 2 * M, who: 'Whale', buy: 3, expect: 'ok', want: { 'Whale.hat': false }, note: 'Too late for a hat' },
      { at: 5 * M, who: 'Sniper bot', sell: 1, expect: 'ok', want: { 'Sniper bot.hat': false } },
      { at: 6 * M, who: 'Sniper bot', buy: 1, expect: 'ok', want: { 'Sniper bot.hat': false }, note: 'The hat is gone for good' },
      { at: 1 * D, ff: true, who: 'You', send: 'Whale', tok: 100, expect: 'ok', want: { 'You.hat': true }, note: 'Sending keeps the hat on' },
      { at: 1 * D + 5 * M, who: 'Degen', sell: 0.25, expect: 'ok', want: { 'Degen.hat': false } },
    ],
    chips: (V) => [['Party hats', names(V.cast.filter((n) => V.w[n]?.hat))], ['Hat window', V.t < 60 ? `${dur(60 - V.t)} left` : 'closed']],
    badges: (V) => V.cast.filter((n) => V.w[n]?.hat).map((who) => ({ who, glyph: 'hat' })),
    notes: (A, B) => B.cast.flatMap((n) => (B.w[n]?.hat && !A.w[n]?.hat ? [{ glyph: 'hat', text: `${v(n, 'get', 'gets')} a party hat` }]
      : !B.w[n]?.hat && A.w[n]?.hat ? [{ glyph: 'hat', text: `${v(n, 'lose', 'loses')} the hat` }] : [])),
    payout: (p) => `The keeper splits ${shareOf(p.share_bps)} creator fees among everyone wearing a hat.`,
  },

  'open-mic': {
    cast: ['Degen', 'Sniper bot', 'Whale', 'You'],
    beats: [
      { at: 0, who: 'Degen', buy: 0.5, expect: 'ok', want: { mic: 'Degen' } },
      { at: 1, who: 'Sniper bot', buy: 2, expect: 'no' },
      { at: 5, who: 'Degen', buy: 0.5, expect: 'ok', note: 'The mic holder can keep buying' },
      { at: 12, who: 'Whale', buy: 3, expect: 'no' },
      { at: 30, who: 'Sniper bot', buy: 2, expect: 'ok', want: { mic: 'Sniper bot' } },
      { at: 31, who: 'Whale', buy: 3, expect: 'no' },
      { at: 60, who: 'Whale', buy: 3, expect: 'ok', want: { mic: 'Whale' } },
      { at: 61, who: 'You', buy: 0.5, expect: 'no' },
      { at: 90, who: 'You', buy: 0.5, expect: 'ok', want: { mic: 'You' } },
    ],
    chips: (V) => { if (!V.g.mic) return [['Mic', 'open']]; const left = 30 - (V.t - V.g.mic_at); return [['Mic', V.g.mic], ['Next slot', left > 0 ? `in ${dur(left)}` : 'open now']]; },
    badges: (V) => (V.g.mic ? [{ who: V.g.mic, glyph: 'mic' }] : []),
    notes: (A, B) => (B.g.mic && (B.g.mic !== A.g.mic || B.g.mic_at !== A.g.mic_at) ? [{ glyph: 'mic', text: `${v(B.g.mic, 'grab', 'grabs')} the mic` }] : []),
  },
};

// ───────── running a scene ─────────
const zero = (k) => k.every((b) => b === 0);
const same = (a, b) => a.every((x, i) => x === b[i]);

function decodeVars(fields, bytes, nameOf) {
  const out = {};
  if (!bytes?.length) { for (const f of fields) out[f.name] = f.type === 'bool' ? false : f.type === 'key' ? null : f.type === 'time' ? null : 0; return out; }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const f of fields) {
    if (f.type === 'key') { const k = bytes.subarray(f.offset, f.offset + 32); out[f.name] = zero(k) ? null : nameOf(k); }
    else if (f.type === 'num') out[f.name] = Number(dv.getBigInt64(f.offset, true)) / 1e6;
    else if (f.type === 'int') out[f.name] = dv.getInt32(f.offset, true);
    else if (f.type === 'bool') out[f.name] = !!bytes[f.offset];
    else if (f.type === 'time') { const x = dv.getUint32(f.offset, true); out[f.name] = x ? x - 1 : null; } // seconds since launch
  }
  return out;
}

const cache = new WeakMap();
/** Compile once per toolchain module and script. */
function compiled(hs, src) {
  let m = cache.get(hs);
  if (!m) cache.set(hs, (m = new Map()));
  if (!m.has(src)) m.set(src, hs.compile(src));
  return m.get(src);
}

/** The words for a trade. */
function sayBeat(b) {
  if (b.say) return b.say;
  if (b.buy != null) return `${v(b.who, 'buy', 'buys')} ${solWord(b.buy)}`;
  if (b.sell != null) return `${v(b.who, 'sell', 'sells')} ${PART[b.sell] ?? `${Math.round(b.sell * 100)}%`}`;
  return `${v(b.who, 'send', 'sends')} ${b.tok ? tokWord(b.tok) : PART[b.part ?? 0.1]} to ${b.send}`;
}

/**
 * Play scene `id` through the real VM. hs = the toolchain module (src/vendor/hookscript.js).
 * → { id, cast, clock, frames: [{ type: 'start'|'beat'|'crowd', t, ff, jump, time, clock, who, text, verdict, message,
 *     expect, notes, chips, badges, state }], payout } or null when there's no scene or the script doesn't compile.
 */
export function runScene(hs, id) {
  const sc = SCENES[id];
  const src = hs.EXAMPLES?.[id];
  if (!sc || !src) return null;
  const c = compiled(hs, src);
  if (!c.ok) return null;
  const code = c.bytes, abi = c.abi;
  const probe = sc.probe ? compiled(hs, sc.probe) : null;
  const launch = sc.launch ?? T0;
  const clock = CLOCK[sc.clock ?? 'since'];
  const w = new hs.World(launch);
  const idOf = {};
  sc.cast.forEach((n, i) => { idOf[n] = n === 'Creator' ? 0 : i + 1; });
  const CROWD0 = 40;
  for (let i = 0; i <= sc.cast.length; i++) w.wallet(i, i ? 'holder' : 'creator');
  const nameOf = (k) => { const x = w.wallets.find((q) => same(q.key, k)); return !x ? 'someone' : x.id >= CROWD0 ? 'the crowd' : sc.cast.find((n) => idOf[n] === x.id) ?? (x.id === 0 ? 'Creator' : 'someone'); };

  const view = (t) => {
    const g = decodeVars(abi.globals, w.globals, nameOf);
    const wv = {};
    for (const n of sc.cast) wv[n] = decodeVars(abi.wallet, w.wallet(idOf[n]).vars, nameOf);
    let p = {};
    if (probe?.ok) {
      const now = launch + BigInt(t);
      const r = hs.run(probe.bytes, hs.ctx({ kind: 0, now, launchTs: launch, amount: UNIT }), new Uint8Array(256), new Uint8Array(0), new Uint8Array(32));
      p = decodeVars(probe.abi.globals, r.globals, nameOf);
    }
    return { t, u: Number(launch) + t, g, w: wv, p, cast: sc.cast };
  };
  const dress = (f, V) => Object.assign(f, {
    time: clock.short(f.t, Number(launch) + f.t), clock: clock.full(f.t, Number(launch) + f.t),
    chips: (sc.chips?.(V) ?? []).filter(Boolean), badges: sc.badges?.(V) ?? [], state: V,
  });

  const frames = [dress({ type: 'start', t: 0, notes: [] }, view(0))];
  let prevT = 0;
  for (const b of sc.beats) {
    const now = launch + BigInt(b.at);
    const A = view(b.at);
    const f = { t: b.at, ff: !!b.ff, jump: b.ff ? `+${dur(b.at - prevT)}` : null, expect: b.expect ?? 'ok', want: b.want ?? null };
    prevT = b.at;
    if (b.crowd) {
      let ok = 0;
      for (let i = 0; i < b.crowd; i++) {
        const o = hs.attempt(w, code, { kind: 'buy', from: CROWD0 + i, sol: b.sol }, now - BigInt(b.crowd - i) * 60n);
        if (o?.result.verdict?.allow) ok++;
      }
      Object.assign(f, { type: 'crowd', who: null, text: `${b.crowd} buys from the crowd`, verdict: ok === b.crowd ? 'ok' : 'no', message: '' });
      const B = view(b.at);
      f.notes = sc.notes?.(A, B, b) ?? [];
      frames.push(dress(f, B));
      continue;
    }
    const from = idOf[b.who];
    const me = w.wallet(from);
    let o = null;
    if (b.buy != null) o = hs.attempt(w, code, { kind: 'buy', from, sol: b.buy }, now);
    else if (b.sell != null) o = hs.attempt(w, code, { kind: 'sell', from, tokens: (me.balance * BigInt(Math.round(b.sell * 1000))) / 1000n }, now);
    else if (b.send) {
      const tok = b.tok ? BigInt(b.tok) * UNIT : (me.balance * BigInt(Math.round((b.part ?? 0.1) * 1000))) / 1000n;
      o = hs.attempt(w, code, { kind: 'send', from, to: idOf[b.send], tokens: tok }, now);
    }
    let verdict, message = '';
    if (!o) { verdict = 'skip'; message = 'Nothing to trade'; }
    else if (o.result.error) { verdict = 'no'; message = 'The rule stopped with an error, so the chain refuses the trade.'; }
    else if (o.result.verdict.allow) verdict = 'ok';
    else { verdict = 'no'; message = hs.formatReason(code, o.result.verdict.reasonId, o.result.verdict.arg); }
    const B = view(b.at);
    const notes = verdict === 'ok' ? [...(sc.notes?.(A, B, b) ?? [])] : [];
    if (b.note && verdict === f.expect) notes.push({ glyph: verdict === 'ok' ? 'check' : 'cross', text: b.note });
    Object.assign(f, { type: 'beat', who: b.who, kind: b.buy != null ? 'buy' : b.sell != null ? 'sell' : 'send', to: b.send ?? null, text: sayBeat(b), verdict, message, notes });
    frames.push(dress(f, B));
  }
  const p = abi.payouts?.[0];
  return { id, name: abi.name, cast: sc.cast, frames, payout: p && sc.payout ? sc.payout(p) : null };
}

/** How long a frame stays on screen while playing (ms). */
export function frameMs(f) {
  if (f.type === 'start') return 1200;
  let ms = 1500;
  if (f.ff) ms += 400;
  if (f.verdict === 'no') ms += 1000;
  ms += 400 * Math.min(2, f.notes?.length ?? 0);
  return ms;
}
export const sceneMs = (run) => run.frames.reduce((a, f) => a + frameMs(f), 0);

/** Read a `want` key ('king' or 'You.invited') from a frame's state. */
export function wanted(state, key) {
  const [a, b] = key.split('.');
  return b === undefined ? state.g[a] : state.w[a]?.[b];
}
