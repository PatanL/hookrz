// Launch page: every rule in plain trader words (no codes, CU or slots) and the rulebooks' pixel icons and outcomes.
// The advanced view (Customize) keeps the technical copy.
import { PRESETS, byId } from '../data/blocks.js';
import { titleOf } from './hs-editor.js';

const pct = (v) => `${+(+v).toFixed(2)}%`;
const secs = (s) => (s >= 120 && s % 60 === 0 ? `${s / 60} minutes` : s === 60 ? 'minute' : `${s} seconds`);
const mins = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`);
const hrs = (h) => `${String(h).padStart(2, '0')}:00`;
const big = (n) => (+n).toLocaleString('en-US');
const first = (s) => (s === 'minute' ? 'first minute' : `first ${s}`);

/**
 * Each rule as { title, does, refuses }: `does` is a full sentence for the rule list, `refuses` a phrase that completes
 * "Your coin will refuse …" (null when the rule never refuses a trade; then `does` reads after "It will also …").
 */
const PLAIN = {
  // guard
  'snipe-shield': (p) => ({ title: 'No snipers', does: `Buys bigger than ${pct(p.max)} of supply are blocked in the ${first(secs(p.window))}.`, refuses: `buys over ${pct(p.max)} of supply in the ${first(secs(p.window))}` }),
  'anti-bundle': (p) => ({ title: 'No bundles', does: `Only ${p.perSlot} buy${p.perSlot === 1 ? '' : 's'} can land at the same instant for the first ${p.window} minute${p.window === 1 ? '' : 's'}, so bundlers can't sweep the launch.`, refuses: `bundled buys: more than ${p.perSlot} at the same instant in the first ${p.window} minute${p.window === 1 ? '' : 's'}` }),
  'max-wallet': (p) => ({ title: 'Wallet cap', does: `No wallet can hold more than ${pct(p.pct)} of supply.`, refuses: `any wallet going over ${pct(p.pct)} of supply` }),
  'rising-max': (p) => ({ title: 'Rising wallet cap', does: `Wallets can hold ${pct(p.from)} of supply at launch; the cap rises to ${pct(p.to)} over ${p.hours} hour${p.hours === 1 ? '' : 's'}.`, refuses: `wallets going over the cap (${pct(p.from)} at launch, ${pct(p.to)} after ${p.hours}h)` }),
  'sandwich-guard': (p) => ({ title: 'No sandwiches', does: `A wallet that just bought can't sell in the next ${(p.slots * 0.4).toFixed(1)} seconds, which stops sandwich bots.`, refuses: `selling within ${(p.slots * 0.4).toFixed(1)} seconds of buying` }),
  blocklist: (p) => ({ title: 'Blocklist', does: `You can name wallets that can't trade it. The list freezes ${p.lockAt}.`, refuses: 'trades by wallets on your blocklist' }),
  'allowlist-phase': (p) => ({ title: 'Allowlist first', does: `For the first ${mins(p.minutes)}, only wallets with a pass can buy.`, refuses: `buys without a pass in the first ${mins(p.minutes)}` }),
  // pace
  'sell-cap': (p) => ({ title: 'Sell cap', does: `No single sell can be bigger than ${pct(p.pct)} of supply.`, refuses: `any single sell over ${pct(p.pct)} of supply` }),
  'sell-cooldown': (p) => ({ title: 'Sell cooldown', does: `Each wallet can sell once every ${mins(p.minutes)}.`, refuses: `a second sell from the same wallet within ${mins(p.minutes)}` }),
  'hold-timer': (p) => ({ title: 'Hold timer', does: `Coins have to sit in a wallet for ${mins(p.minutes)} before they can be sold or sent.`, refuses: `selling or sending coins held for less than ${mins(p.minutes)}` }),
  'circuit-breaker': (p) => ({ title: 'Circuit breaker', does: `The price can't move more than ${p.band}% within ${p.window} minute${p.window === 1 ? '' : 's'}.`, refuses: `trades that move the price more than ${p.band}% within ${p.window} minute${p.window === 1 ? '' : 's'}` }),
  'trading-hours': (p) => ({ title: 'Trading hours', does: `It trades from ${hrs(p.open)} to ${hrs(p.close)} UTC every day. Sends between wallets always work.`, refuses: `trades outside ${hrs(p.open)}–${hrs(p.close)} UTC` }),
  'seasoned-sells': (p) => ({ title: 'Sell in slices', does: `New holders can sell ${p.base}% of their bag at once, plus ${p.step}% more for every hour they hold.`, refuses: `sells bigger than a holder's share so far (${p.base}% of the bag, +${p.step}% per hour held)` }),
  'outflow-cap': (p) => ({ title: 'Hourly sell limit', does: `All holders together can sell at most ${pct(p.pct)} of supply per hour.`, refuses: `sells once ${pct(p.pct)} of supply has been sold in the same hour` }),
  'lock-in': (p) => ({ title: 'Lock-in', does: `Nobody can sell until the curve is ${p.pct}% full. Your coin page shows this in red.`, refuses: `every sell until the curve is ${p.pct}% full` }),
  // burn
  'sniper-fee-burn': (p) => ({ title: 'Sniper fee, burned', does: `The trading fee starts at ${p.start}% and falls to 1% over the ${first(secs(p.seconds))}; the extra fee buys the coin back and burns it.`, refuses: null }),
  'buyback-burn': (p) => ({ title: 'Buyback and burn', does: `${p.pct}% of your creator fees buy the coin back and burn it, every hour.`, refuses: null }),
  'leftover-burn': () => ({ title: 'Leftovers burned', does: "Any tokens the curve didn't sell are burned when the coin graduates.", refuses: null }),
  // flow
  'creator-vest': (p) => ({ title: 'Creator vesting', does: `Your own launch buy unlocks slowly: nothing for ${p.cliff} day${p.cliff === 1 ? '' : 's'}, then evenly over ${p.days} days.`, refuses: `the creator selling a launch bag that hasn't unlocked yet` }),
  'holder-rewards': (p) => ({ title: 'Holder rewards', does: `${p.pct}% of your creator fees are paid out to holders every hour.`, refuses: null }),
  'first-buyer-rebate': (p) => ({ title: 'First-buyer rebate', does: `The first ${p.n} buyers who still hold at graduation split ${p.pct}% of your creator fees.`, refuses: null }),
  tithe: (p) => ({ title: 'Tithe', does: `${p.pct}% of your creator fees go to a wallet you name, for good.`, refuses: null }),
  'lp-lock': (p) => ({ title: 'Liquidity locked', does: `${p.pct}% of the liquidity is locked forever when the coin graduates.`, refuses: null }),
  // crown
  'token-gate': (p) => ({ title: 'Holders only', does: `Only wallets holding at least ${big(p.min)} ${p.ticker} can buy or receive it.`, refuses: `buys from wallets holding less than ${big(p.min)} ${p.ticker}` }),
  chapters: (p) => ({ title: 'Chapters', does: `The launch opens in ${p.n} chapters: wallets can hold ${pct(p.first)} of supply in the first, and the cap doubles each chapter.`, refuses: `buys over the current chapter's cap (${pct(p.first)} of supply to start)` }),
  'diamond-tiers': (p) => ({ title: 'Diamond crowns', does: `Wallets that don't sell for ${p.hours} hours earn a crown; crown holders share ${p.pct}% of your creator fees.`, refuses: null }),
  kingmaker: (p) => ({ title: 'Kingmaker', does: `The biggest holder at graduation gets ${p.pct}% of your creator fees for 30 days.`, refuses: null }),
  'locked-metadata': () => ({ title: 'Locked name and image', does: 'The name, ticker and image can never be changed.', refuses: null }),
};

/** Plain words for one stack slot ({ id, params, draft }). The custom rule speaks for itself: its title and the creator's own words. */
export function plainRule(s) {
  const b = byId[s.id];
  if (s.id === 'custom') {
    const st = s.draft;
    const title = st?.title || (st?.compile?.ok && st.compile.name) || titleOf(st?.source) || 'Your own rule';
    const about = st?.about || (s.params.prompt ?? '').trim();
    const said = about.replace(/[.\s]+$/, '');
    const named = title !== 'Your own rule' && title.trim() !== said;
    const refuses = !said ? null : named ? `trades that break “${title}”: ${said.charAt(0).toLowerCase()}${said.slice(1)}` : `trades that break your rule: “${said}”`;
    return { family: 'custom', title, does: about || 'Describe it in English and hookrz writes it.', refuses, own: true };
  }
  try { return { family: b.family, ...PLAIN[s.id](s.params) }; } catch { return { family: b?.family ?? 'custom', title: b?.name ?? s.id, does: b?.tagline ?? '', refuses: null }; }
}

/** Rulebook cards: a pixel icon and one outcome sentence each (names and slots come from PRESETS). */
export const BOOK = {
  'fair-launch': { icon: 'guard', outcome: 'Stops snipers and bundlers, then gets out of the way.' },
  'slow-bleed': { icon: 'pace', outcome: 'Nobody can dump the chart in one candle.' },
  diamond: { icon: 'crown', outcome: 'Rewards the people who hold, and burns the rest.' },
  club: { icon: 'lock', outcome: 'Only holders of another coin get in, a chapter at a time.' },
  market: { icon: 'clock', outcome: 'Trades like a stock: opening bell, breaker, settlement.' },
};
export const RULEBOOKS = PRESETS.map((p) => ({ ...p, ...(BOOK[p.id] ?? { icon: 'custom', outcome: p.blurb }) }));

/** The rulebook this stack is (its custom rule aside), or null when the rules were mixed by hand. */
export function bookOf(stack) {
  const ids = stack.filter((s) => s.id !== 'custom').map((s) => s.id).join(',');
  return ids ? RULEBOOKS.find((p) => p.slots.map((x) => x[0]).join(',') === ids) ?? null : null;
}
