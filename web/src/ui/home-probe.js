// One blocked and one allowed trade for a drafted rule, found by running short trade stories through the real
// Hookscript interpreter (the same one the build page's tester uses). Pure: no DOM, so it can run anywhere.
//
// probe(hs, bytes) -> { blocked: { text, reason } | null, allowed: { text } | null }
//   hs    the Hookscript toolchain module (src/hookscript/hs.js load())
//   bytes the compiled rule (hs.compile(script).bytes)

const T0 = 1_791_216_000n; // a fixed launch time: Monday, noon in New York, so market-hours rules have a story too
const C = 0, A = 1, B = 2; // the creator, a buyer, a new wallet
const WHO = ['The creator', 'A buyer', 'A new wallet'];

const MIN = 60, HOUR = 3600, DAY = 86400;
const when = (s) => (s < HOUR ? `${Math.round(s / MIN)} min` : s < DAY ? `${+(s / HOUR).toFixed(1)}h` : `${Math.round(s / DAY)} day${s >= 2 * DAY ? 's' : ''}`) + ' after launch';
const share = (f) => ({ 0.1: 'a tenth of', 0.2: 'a fifth of', 0.5: 'half', 1: 'all of' })[f] ?? `${Math.round(f * 100)}% of`;

// a step: [seconds since launch, wallet, kind, SOL for a buy | share of the bag for a sell or send, receiver]
const buy = (t, who, sol) => [t, who, 'buy', sol];
const sell = (t, who, f) => [t, who, 'sell', f];
const send = (t, who, f, to) => [t, who, 'send', f, to];

function say([t, who, kind, x, to], extra = '') {
  const w = WHO[who];
  if (kind === 'buy') return `${w} buys ${x} SOL${extra}, ${when(t)}`;
  if (kind === 'sell') return `${w} sells ${share(x)} their bag${extra}, ${when(t)}`;
  return `${w} sends ${share(x)} their bag to ${to === B ? 'a friend' : WHO[to].toLowerCase()}${extra}, ${when(t)}`;
}

// Pairs of stories that differ in one thing. The first pair whose endings disagree (one blocked, one allowed) wins.
// [kind the pair is about, story X, story Y, extra words for X, extra words for Y]
const PAIRS = [
  ['sell', [buy(60, A, 1), sell(30 * MIN, A, 0.5)], [buy(60, A, 1), sell(30 * MIN, A, 0.2)]],
  ['sell', [buy(60, A, 1), sell(30 * MIN, A, 0.5)], [buy(60, A, 1), sell(DAY, A, 0.5)]],
  ['sell', [buy(60, A, 1), sell(5 * MIN, A, 0.5)], [buy(60, A, 1), sell(DAY, A, 0.5)]],
  ['sell', [buy(60, A, 1), sell(30 * MIN, A, 0.1), sell(32 * MIN, A, 0.1)], [buy(60, A, 1), sell(30 * MIN, A, 0.1), sell(3 * HOUR, A, 0.1)], ' again', ' again'],
  ['sell', [buy(0, C, 1), buy(60, A, 1), sell(DAY, C, 0.5)], [buy(0, C, 1), buy(60, A, 1), sell(DAY, A, 0.5)]],
  ['buy', [buy(60, A, 1), buy(2 * MIN, B, 0.5)], [buy(60, A, 1), buy(2 * MIN, B, 2)], ' right after a 1 SOL buy', ' right after a 1 SOL buy'],
  ['buy', [buy(0, C, 0.5), buy(5 * MIN, B, 0.5)], [buy(0, C, 0.5), send(4 * MIN, C, 0.1, B), buy(5 * MIN, B, 0.5)], '', ' after a holder sent them a token'],
  ['buy', [buy(5 * MIN, B, 0.5)], [buy(DAY, B, 0.5)]],
  ['buy', [buy(5 * MIN, B, 8)], [buy(5 * MIN, B, 0.1)]],
  ['buy', [buy(60, A, 1), buy(10 * MIN, A, 0.5)], [buy(60, A, 1), buy(10 * MIN, B, 0.5)], ' again', ''],
  ['buy', [buy(60, A, 0.2), buy(15 * MIN, A, 12), buy(16 * MIN, B, 0.5)], [buy(60, A, 0.2), buy(15 * MIN, A, 12), buy(3 * HOUR, B, 0.5)], ' after a 12 SOL pump', ' after a 12 SOL pump'],
  ['buy', [buy(9 * HOUR, B, 0.5)], [buy(5 * MIN, B, 0.5)]],
  ['buy', [buy(7 * HOUR, B, 0.5)], [buy(5 * MIN, B, 0.5)]],
  ['buy', [buy(5 * DAY, B, 0.5)], [buy(5 * MIN, B, 0.5)]],
  ['sell', [buy(60, A, 1), send(10 * MIN, A, 0.5, B), sell(30 * MIN, B, 0.5)], [buy(60, A, 1), send(10 * MIN, A, 0.5, B), sell(DAY, B, 0.5)], ' of sent tokens', ' of sent tokens'],
  ['send', [buy(60, A, 1), send(30 * MIN, A, 0.5, B)], [buy(60, A, 1), send(30 * MIN, A, 0.1, B)]],
  ['send', [buy(60, A, 1), send(30 * MIN, A, 0.5, B)], [buy(60, A, 1), send(DAY, A, 0.5, B)]],
];

/** Run a story on a fresh launch. null if a setup step was refused (the story doesn't apply to this rule). */
function run(hs, bytes, steps) {
  const w = new hs.World(T0);
  for (let i = 0; i < WHO.length; i++) w.wallet(i, i ? 'holder' : 'creator');
  let last = null;
  for (let i = 0; i < steps.length; i++) {
    const [t, who, kind, x, to] = steps[i];
    const me = w.wallet(who);
    const tokens = BigInt(Math.floor(Number(me.balance) * (x ?? 0)));
    if (kind !== 'buy' && tokens <= 0n) return null;
    const now = T0 + BigInt(t);
    const o = kind === 'buy' ? hs.attempt(w, bytes, { kind, from: who, sol: x }, now)
      : kind === 'sell' ? hs.attempt(w, bytes, { kind, from: who, tokens }, now)
        : hs.attempt(w, bytes, { kind, from: who, to, tokens }, now);
    if (!o) return null;
    const r = o.result;
    const ok = !r.error && r.verdict.allow;
    if (i < steps.length - 1) { if (!ok) return null; continue; }
    last = { ok, reason: ok ? null : r.error ? 'The rule stopped with an error, so the trade is refused.' : hs.formatReason(bytes, r.verdict.reasonId, r.verdict.arg) };
  }
  return last;
}

/** byKind: the fuzz report's refusals per kind, used to try the most telling pairs first. */
export function probe(hs, bytes, byKind = {}) {
  const weight = (k) => -(byKind[k]?.refused ?? 0);
  const order = PAIRS.map((p, i) => [p, i]).sort((a, b) => weight(a[0][0]) - weight(b[0][0]) || a[1] - b[1]).map(([p]) => p);
  let lone = null;
  for (const [, X, Y, lx = '', ly = ''] of order) {
    const x = run(hs, bytes, X), y = run(hs, bytes, Y);
    if (!x || !y) continue;
    if (x.ok !== y.ok) {
      const [bad, good] = x.ok ? [[Y, ly, y], [X, lx, x]] : [[X, lx, x], [Y, ly, y]];
      return { blocked: { text: say(bad[0].at(-1), bad[1]), reason: bad[2].reason }, allowed: { text: say(good[0].at(-1), good[1]) } };
    }
    if (!x.ok && !lone) lone = { text: say(X.at(-1), lx), reason: x.reason };
  }
  if (lone) return { blocked: lone, allowed: null };
  const first = PAIRS[0][1];
  return { blocked: null, allowed: { text: say(first.at(-1)) } };
}
