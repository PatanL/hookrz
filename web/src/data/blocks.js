// The hookrz block catalog — single source of truth for the site AND the spec of the on-chain engine.
// Each block maps 1:1 to a slot type in the `hookrz_engine` Token-2022 transfer-hook program
// (block id = u16 in the Stack account, params = packed into the slot's 24-byte param area).
//
// enforcedBy:
//   hook  — the engine refuses the transfer inside Token-2022's Execute CPI (custom error `code`)
//   curve — a Meteora DBC config field set at launch (fee scheduler, migration, LP lock)
//   crank — the permissionless hookrz keeper acts on fee vaults on a schedule; every action is a public tx
//   ext   — a Token-2022 extension / authority set on the mint at creation
// state:  none | global (lives in the Stack slot) | wallet (needs the receiver's Wallet record PDA)
// route:  any (aggregators work) | record (a receiving wallet needs a Wallet record; hookrz's router opens it inside the buy)
// cu:     compute units the engine spends on this block per transfer (measured target; hook blocks only)
// accts:  extra accounts this block adds to the mint's ExtraAccountMetaList

export const FAMILIES = [
  { id: 'guard', name: 'Guard', verb: 'Who gets in', blurb: 'Keep snipers, bundlers and sandwich bots off the launch.' },
  { id: 'pace', name: 'Pace', verb: 'How fast it moves', blurb: 'Caps, cooldowns and breakers that slow a dump down.' },
  { id: 'burn', name: 'Burn', verb: 'Where supply goes', blurb: 'Fees and leftovers that buy the coin back and burn it.' },
  { id: 'flow', name: 'Flow', verb: 'Who gets paid', blurb: 'Vesting, rewards and tithes routed from the fee vaults.' },
  { id: 'crown', name: 'Crown', verb: 'Who gets status', blurb: 'Gates, chapters and tiers for the people who hold.' },
  { id: 'custom', name: 'Custom', verb: 'Write your own', blurb: 'Describe a rule in English and hookrz drafts it in Hookscript.' },
];

export const ENFORCERS = {
  hook: { name: 'Hook', long: 'Refused by the hookrz engine on every transfer' },
  curve: { name: 'Curve', long: 'Set in the Meteora DBC config at launch' },
  crank: { name: 'Crank', long: 'Done by the public hookrz keeper; every action is a transaction' },
  ext: { name: 'Mint', long: 'A Token-2022 setting fixed when the mint is created' },
};

export const ENGINE = {
  program: 'hookrz_engine',
  maxSlots: 6,
  cuBudget: 30000,       // ceiling for the whole stack per transfer, on top of the swap
  cuBase: 4200,          // dispatch, account checks, transfer classification
  maxExtraAccounts: 10,  // ExtraAccountMetaList entries beyond the Stack PDA
  stackBytes: 640,
  walletRecordBytes: 96,
  rentPerByteYear: 6960, // lamports per byte incl. 128-byte header (rent-exempt minimum)
};
export const rentSol = (bytes) => ((bytes + 128) * ENGINE.rentPerByteYear) / 1e9;

const pct = (v) => `${+(+v).toFixed(2)}%`;
const mins = (m) => (m >= 60 ? `${+(m / 60).toFixed(1)}h` : `${m}m`);
const hrs = (h) => `${String(h).padStart(2, '0')}:00`;

export const BLOCKS = [
  // ───────────── GUARD ─────────────
  {
    id: 'snipe-shield', code: 0x1771, family: 'guard', name: 'Snipe Shield', enforcedBy: 'hook', state: 'global', route: 'any', cu: 1900, accts: 0,
    tagline: 'Big buys in the first seconds are refused.',
    refuses: 'A buy larger than the cap while the launch window is open. The creator\'s buy inside the launch transaction is exempt.',
    params: [
      { key: 'window', label: 'Launch window', min: 10, max: 600, step: 10, def: 60, fmt: (v) => `${v}s` },
      { key: 'max', label: 'Largest buy', min: 0.05, max: 2, step: 0.05, def: 0.3, fmt: (v) => `${pct(v)} of supply` },
    ],
    summary: (p) => `${pct(p.max)} max · ${p.window}s`,
    error: (p) => `Launch window: buys over ${pct(p.max)} of supply are refused for the first ${p.window}s`,
    check: (c, p) => c.kind === 'buy' && !c.isCreator && c.t < p.window && c.amount > c.supply * p.max / 100,
  },
  {
    id: 'anti-bundle', code: 0x1772, family: 'guard', name: 'Anti-Bundle', enforcedBy: 'hook', state: 'global', route: 'any', cu: 2100, accts: 0,
    tagline: 'Only a few buys can land in the same block.',
    refuses: 'A buy beyond the per-slot limit while the bundle window is open. Bundlers buy with dozens of wallets in one block; this caps them.',
    params: [
      { key: 'perSlot', label: 'Buys per slot', min: 1, max: 6, step: 1, def: 2, fmt: (v) => `${v}` },
      { key: 'window', label: 'Bundle window', min: 1, max: 60, step: 1, def: 10, fmt: (v) => `${v}m` },
    ],
    summary: (p) => `${p.perSlot}/slot · ${p.window}m`,
    error: (p) => `Too many buys in this slot: at most ${p.perSlot} per slot for the first ${p.window} minutes`,
    check: (c, p) => c.kind === 'buy' && !c.isCreator && c.t < p.window * 60 && c.slotBuys >= p.perSlot,
  },
  {
    id: 'max-wallet', code: 0x1773, family: 'guard', name: 'Max Wallet', enforcedBy: 'hook', state: 'none', route: 'any', cu: 1500, accts: 0,
    tagline: 'No wallet can hold more than a set share.',
    refuses: 'A transfer that leaves the receiving wallet above the cap. The curve vault is exempt.',
    params: [{ key: 'pct', label: 'Cap per wallet', min: 0.5, max: 10, step: 0.5, def: 2, fmt: (v) => `${pct(v)} of supply` }],
    summary: (p) => `${pct(p.pct)} cap`,
    error: (p) => `Wallet would hold more than ${pct(p.pct)} of supply`,
    check: (c, p) => c.kind !== 'sell' && c.dstAfter > c.supply * p.pct / 100,
  },
  {
    id: 'rising-max', code: 0x1774, family: 'guard', name: 'Rising Max Wallet', enforcedBy: 'hook', state: 'none', route: 'any', cu: 1700, accts: 0,
    tagline: 'The wallet cap starts tight and opens up over time.',
    refuses: 'A transfer that leaves the receiving wallet above the cap at this moment. The cap rises in a straight line.',
    params: [
      { key: 'from', label: 'Starting cap', min: 0.25, max: 5, step: 0.25, def: 0.5, fmt: (v) => pct(v) },
      { key: 'to', label: 'Final cap', min: 1, max: 20, step: 0.5, def: 5, fmt: (v) => pct(v) },
      { key: 'hours', label: 'Opens over', min: 1, max: 72, step: 1, def: 12, fmt: (v) => `${v}h` },
    ],
    summary: (p) => `${pct(p.from)}→${pct(p.to)} · ${p.hours}h`,
    error: (p, c) => `Wallet would hold more than the current ${pct(capAt(p, c?.t ?? 0))} cap`,
    check: (c, p) => c.kind !== 'sell' && c.dstAfter > c.supply * capAt(p, c.t) / 100,
  },
  {
    id: 'sandwich-guard', code: 0x1775, family: 'guard', name: 'Sandwich Guard', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 2600, accts: 2,
    tagline: 'A wallet that just bought can\'t sell in the same breath.',
    refuses: 'A sell from a wallet that bought within the last few slots. That is the shape of a sandwich or a same-block flip.',
    params: [{ key: 'slots', label: 'Lockout', min: 1, max: 150, step: 1, def: 4, fmt: (v) => `${v} slots (~${(v * 0.4).toFixed(1)}s)` }],
    summary: (p) => `${p.slots}-slot lockout`,
    error: (p) => `Bought too recently: sells open ${p.slots} slots after a buy`,
    check: (c, p) => c.kind === 'sell' && c.w.lastBuySlot != null && c.slot - c.w.lastBuySlot < p.slots,
  },
  {
    id: 'blocklist', code: 0x1776, family: 'guard', name: 'Blocklist', enforcedBy: 'hook', state: 'global', route: 'any', cu: 1400, accts: 2, power: true,
    tagline: 'Named addresses can\'t receive the coin.',
    refuses: 'A transfer to or from an owner with a block marker (PDA ["block", mint, owner]). The creator adds markers; they freeze at graduation.',
    params: [{ key: 'lockAt', label: 'List freezes', options: ['at graduation', 'after 24h', 'immediately'], def: 'at graduation' }],
    summary: (p) => `freezes ${p.lockAt}`,
    error: () => 'This address is on the coin\'s blocklist',
    check: (c) => c.blocked,
  },
  {
    id: 'allowlist-phase', code: 0x1777, family: 'guard', name: 'Allowlist Phase', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 1600, accts: 1,
    tagline: 'For the first stretch, only pass holders can buy.',
    refuses: 'A buy from a wallet without a pass while the allowlist phase is open. Passes are claimed from a Merkle root with one signature.',
    params: [{ key: 'minutes', label: 'Allowlist phase', min: 5, max: 1440, step: 5, def: 30, fmt: mins }],
    summary: (p) => `${mins(p.minutes)} phase`,
    error: (p) => `Allowlist phase: only pass holders can buy for the first ${mins(p.minutes)}`,
    check: (c, p) => c.kind === 'buy' && c.t < p.minutes * 60 && !c.hasPass,
  },

  // ───────────── PACE ─────────────
  {
    id: 'sell-cap', code: 0x1778, family: 'pace', name: 'Sell Cap', enforcedBy: 'hook', state: 'none', route: 'any', cu: 1300, accts: 0,
    tagline: 'One sell can only move so much.',
    refuses: 'A single sell larger than the cap. Big holders have to scale out.',
    params: [{ key: 'pct', label: 'Largest sell', min: 0.1, max: 5, step: 0.1, def: 1, fmt: (v) => `${pct(v)} of supply` }],
    summary: (p) => `${pct(p.pct)} per sell`,
    error: (p) => `Sell is larger than ${pct(p.pct)} of supply`,
    check: (c, p) => c.kind === 'sell' && c.amount > c.supply * p.pct / 100,
  },
  {
    id: 'sell-cooldown', code: 0x1779, family: 'pace', name: 'Sell Cooldown', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 2400, accts: 2,
    tagline: 'One sell per wallet, then wait.',
    refuses: 'A second sell from the same wallet before the cooldown ends.',
    params: [{ key: 'minutes', label: 'Cooldown', min: 1, max: 240, step: 1, def: 15, fmt: mins }],
    summary: (p) => `${mins(p.minutes)} cooldown`,
    error: (p) => `Cooldown: one sell every ${mins(p.minutes)}`,
    check: (c, p) => c.kind === 'sell' && c.w.lastSellT != null && c.t - c.w.lastSellT < p.minutes * 60,
  },
  {
    id: 'hold-timer', code: 0x177a, family: 'pace', name: 'Hold Timer', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 3800, accts: 2,
    tagline: 'Coins have to sit before they can leave.',
    refuses: 'A sell or send that would dip into coins received less than the hold time ago. Each receipt is its own lot, so new buys never extend old ones.',
    params: [{ key: 'minutes', label: 'Hold', min: 5, max: 1440, step: 5, def: 60, fmt: mins }],
    summary: (p) => `${mins(p.minutes)} hold`,
    error: (p) => `Still settling: coins can move ${mins(p.minutes)} after they arrive`,
    check: (c, p) => c.kind !== 'buy' && c.amount > freeBalance(c, p.minutes * 60) + 1e-9,
  },
  {
    id: 'circuit-breaker', code: 0x177b, family: 'pace', name: 'Circuit Breaker', enforcedBy: 'hook', state: 'global', route: 'any', cu: 4200, accts: 1,
    tagline: 'Price can only move so far per window.',
    refuses: 'A curve trade whose post-trade price lands outside ±band of the price when the window opened. Reads the DBC pool\'s sqrt price.',
    params: [
      { key: 'band', label: 'Band', min: 5, max: 50, step: 1, def: 20, fmt: (v) => `±${v}%` },
      { key: 'window', label: 'Window', min: 1, max: 60, step: 1, def: 5, fmt: (v) => `${v}m` },
    ],
    summary: (p) => `±${p.band}% / ${p.window}m`,
    error: (p) => `Breaker: price would move more than ${p.band}% in this ${p.window}-minute window`,
    check: (c, p) => c.kind !== 'send' && c.windowOpenPrice > 0 && Math.abs(c.priceAfter / c.windowOpenPrice - 1) * 100 > p.band,
  },
  {
    id: 'trading-hours', code: 0x177c, family: 'pace', name: 'Trading Hours', enforcedBy: 'hook', state: 'none', route: 'any', cu: 1200, accts: 0,
    tagline: 'The curve opens and closes like a market.',
    refuses: 'A curve trade outside the daily window (UTC). Plain sends between wallets still work.',
    params: [
      { key: 'open', label: 'Opens (UTC)', min: 0, max: 23, step: 1, def: 13, fmt: hrs },
      { key: 'close', label: 'Closes (UTC)', min: 1, max: 24, step: 1, def: 21, fmt: hrs },
    ],
    summary: (p) => `${hrs(p.open)}–${hrs(p.close)} UTC`,
    error: (p) => `Market closed: the curve trades ${hrs(p.open)}–${hrs(p.close)} UTC`,
    check: (c, p) => c.kind !== 'send' && !(c.hour >= p.open && c.hour < p.close),
  },
  {
    id: 'seasoned-sells', code: 0x177d, family: 'pace', name: 'Seasoned Sells', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 2600, accts: 2,
    tagline: 'The longer you hold, the more you can sell at once.',
    refuses: 'A sell bigger than the wallet\'s seasoned share: a base share of its balance, plus a step for every hour since its first buy.',
    params: [
      { key: 'base', label: 'Day-one sell', min: 5, max: 50, step: 5, def: 20, fmt: (v) => `${v}% of balance` },
      { key: 'step', label: 'Added per hour', min: 5, max: 50, step: 5, def: 10, fmt: (v) => `+${v}%` },
    ],
    summary: (p) => `${p.base}% +${p.step}%/h`,
    error: (p) => `Not seasoned yet: sell at most ${p.base}% of your balance, +${p.step}% per hour held`,
    check: (c, p) => c.kind === 'sell' && c.w.firstT != null && c.amount > c.srcBefore * Math.min(1, (p.base + p.step * Math.floor((c.t - c.w.firstT) / 3600)) / 100) + 1e-9,
  },
  {
    id: 'outflow-cap', code: 0x177e, family: 'pace', name: 'Hourly Outflow Cap', enforcedBy: 'hook', state: 'global', route: 'any', cu: 2200, accts: 0,
    tagline: 'The whole market can only sell so much per hour.',
    refuses: 'A sell that would push the total sold in the current hour above the cap.',
    params: [{ key: 'pct', label: 'Sells per hour', min: 1, max: 20, step: 0.5, def: 5, fmt: (v) => `${pct(v)} of supply` }],
    summary: (p) => `${pct(p.pct)}/h`,
    error: (p) => `This hour\'s sell allowance (${pct(p.pct)} of supply) is used up`,
    check: (c, p) => c.kind === 'sell' && c.hourSold + c.amount > c.supply * p.pct / 100,
  },
  {
    id: 'lock-in', code: 0x177f, family: 'pace', name: 'Lock-in Phase', enforcedBy: 'hook', state: 'none', route: 'any', cu: 2900, accts: 1, risk: 'Holders cannot sell until the curve reaches the threshold. Every coin page shows this in red.',
    tagline: 'Buys only, until the curve is part full.',
    refuses: 'Any sell before the curve is filled to the threshold.',
    params: [{ key: 'pct', label: 'Sells open at', min: 10, max: 60, step: 5, def: 25, fmt: (v) => `${v}% filled` }],
    summary: (p) => `sells at ${p.pct}%`,
    error: (p) => `Lock-in: sells open when the curve is ${p.pct}% filled`,
    check: (c, p) => c.kind === 'sell' && c.progress * 100 < p.pct,
  },

  // ───────────── BURN ─────────────
  {
    id: 'sniper-fee-burn', code: null, family: 'burn', name: 'Sniper Fee → Burn', enforcedBy: 'curve', state: 'none', route: 'any', cu: 0, accts: 0, also: 'crank',
    tagline: 'The first minute costs a lot, and the extra fee is burned.',
    refuses: 'Nothing is refused. The DBC fee scheduler starts the trading fee high and decays it to 1%; the keeper uses everything above 1% to buy the coin back and burn it.',
    params: [
      { key: 'start', label: 'Starting fee', min: 5, max: 90, step: 5, def: 50, fmt: (v) => `${v}%` },
      { key: 'seconds', label: 'Decays over', min: 10, max: 600, step: 10, def: 60, fmt: (v) => `${v}s` },
    ],
    summary: (p) => `${p.start}%→1% · ${p.seconds}s`,
    fee: (p, t) => (t >= p.seconds ? 1 : p.start - (p.start - 1) * (t / p.seconds)),
  },
  {
    id: 'buyback-burn', code: null, family: 'burn', name: 'Buyback & Burn', enforcedBy: 'crank', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'Part of the creator\'s fees buys the coin and burns it.',
    refuses: 'Nothing is refused. Every hour the keeper claims the creator fee share, swaps the chosen part for the coin and burns it. Each burn links to its transaction.',
    params: [{ key: 'pct', label: 'Share of creator fees', min: 10, max: 100, step: 5, def: 25, fmt: (v) => `${v}%` }],
    summary: (p) => `${p.pct}% of creator fees`,
  },
  {
    id: 'leftover-burn', code: null, family: 'burn', name: 'Leftover Burn', enforcedBy: 'curve', state: 'none', route: 'any', cu: 0, accts: 0, also: 'crank',
    tagline: 'Whatever the curve didn\'t sell is burned at graduation.',
    refuses: 'Nothing is refused. The DBC leftover receiver is set to the burn vault, so unsold tokens are burned in the migration instead of going back to anyone.',
    params: [],
    summary: () => 'burn leftovers',
  },

  // ───────────── FLOW ─────────────
  {
    id: 'creator-vest', code: 0x1780, family: 'flow', name: 'Creator Vesting', enforcedBy: 'hook', state: 'none', route: 'any', cu: 2000, accts: 0,
    tagline: 'The creator\'s own bag unlocks slowly.',
    refuses: 'A sell or send from the creator\'s wallet beyond the vested part of its launch buy: nothing before the cliff, then a straight line.',
    params: [
      { key: 'cliff', label: 'Cliff', min: 0, max: 30, step: 1, def: 3, fmt: (v) => `${v}d` },
      { key: 'days', label: 'Vests over', min: 7, max: 365, step: 1, def: 30, fmt: (v) => `${v}d` },
    ],
    summary: (p) => `${p.cliff}d cliff · ${p.days}d`,
    error: (p) => `Creator vesting: ${p.cliff}-day cliff, then unlocks over ${p.days} days`,
    check: (c, p) => c.isCreatorSrc && c.kind !== 'buy' && c.t < (p.cliff * 86400),
  },
  {
    id: 'holder-rewards', code: null, family: 'flow', name: 'Holder Rewards', enforcedBy: 'crank', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'Part of the fees goes back to the people holding.',
    refuses: 'Nothing is refused. Hourly the keeper snapshots holders, posts a Merkle root and funds a claim vault with the chosen share of creator fees.',
    params: [
      { key: 'pct', label: 'Share of creator fees', min: 10, max: 100, step: 5, def: 40, fmt: (v) => `${v}%` },
      { key: 'min', label: 'Minimum hold', min: 0, max: 0.5, step: 0.01, def: 0.01, fmt: (v) => `${pct(v)} of supply` },
    ],
    summary: (p) => `${p.pct}% to holders`,
  },
  {
    id: 'first-buyer-rebate', code: null, family: 'flow', name: 'First-Buyer Rebate', enforcedBy: 'crank', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'The first wallets in get fees back.',
    refuses: 'Nothing is refused. The first N distinct buyers that still hold at graduation split the chosen share of creator fees.',
    params: [
      { key: 'n', label: 'First buyers', min: 10, max: 500, step: 10, def: 100, fmt: (v) => `${v}` },
      { key: 'pct', label: 'Share of creator fees', min: 5, max: 50, step: 5, def: 20, fmt: (v) => `${v}%` },
    ],
    summary: (p) => `first ${p.n} · ${p.pct}%`,
  },
  {
    id: 'tithe', code: null, family: 'flow', name: 'Tithe', enforcedBy: 'crank', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'A slice of fees goes to a wallet you name.',
    refuses: 'Nothing is refused. The keeper sends the chosen share of creator fees to a fixed address: a charity, a DAO, an artist. The address can\'t be changed after launch.',
    params: [{ key: 'pct', label: 'Share of creator fees', min: 1, max: 50, step: 1, def: 10, fmt: (v) => `${v}%` }],
    summary: (p) => `${p.pct}% tithe`,
  },
  {
    id: 'lp-lock', code: null, family: 'flow', name: 'LP Lock', enforcedBy: 'curve', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'Graduation liquidity is locked for good.',
    refuses: 'Nothing is refused. The DBC config locks this share of the DAMM v2 position permanently at migration; LP fees still flow to the fee split.',
    params: [{ key: 'pct', label: 'Locked liquidity', min: 50, max: 100, step: 5, def: 100, fmt: (v) => `${v}%` }],
    summary: (p) => `${p.pct}% locked`,
  },

  // ───────────── CROWN ─────────────
  {
    id: 'token-gate', code: 0x1781, family: 'crown', name: 'Token Gate', enforcedBy: 'hook', state: 'none', route: 'any', cu: 2300, accts: 2,
    tagline: 'Only holders of another token can get in.',
    refuses: 'A buy or receive by a wallet holding less than the minimum of the gate token. The gate balance is read from the receiver\'s associated token account.',
    params: [
      { key: 'ticker', label: 'Gate token', options: ['$BONK', '$WIF', '$JUP', '$HOOKRZ'], def: '$BONK' },
      { key: 'min', label: 'Minimum held', min: 1, max: 1000000, step: 1, def: 100000, fmt: (v) => `${(+v).toLocaleString('en-US')}` },
    ],
    summary: (p) => `holds ${shortNum(p.min)} ${p.ticker}`,
    error: (p) => `Gated: hold at least ${(+p.min).toLocaleString('en-US')} ${p.ticker} to receive this coin`,
    check: (c, p) => c.kind !== 'sell' && !(c.gateBal >= p.min),
  },
  {
    id: 'chapters', code: 0x1782, family: 'crown', name: 'Chapters', enforcedBy: 'hook', state: 'none', route: 'any', cu: 2700, accts: 1,
    tagline: 'The launch opens in chapters, each with a bigger cap.',
    refuses: 'A buy above the current chapter\'s wallet cap. A new chapter opens each time the curve fills another slice.',
    params: [
      { key: 'n', label: 'Chapters', min: 2, max: 5, step: 1, def: 3, fmt: (v) => `${v}` },
      { key: 'first', label: 'Chapter 1 cap', min: 0.25, max: 3, step: 0.25, def: 0.5, fmt: (v) => `${pct(v)} of supply` },
    ],
    summary: (p) => `${p.n} chapters · ${pct(p.first)}→`,
    error: (p, c) => `Chapter ${chapterOf(p, c?.progress ?? 0) + 1}: wallets can hold ${pct(p.first * 2 ** chapterOf(p, c?.progress ?? 0))} until the next chapter`,
    check: (c, p) => c.kind === 'buy' && c.dstAfter > c.supply * (p.first * 2 ** chapterOf(p, c.progress)) / 100,
  },
  {
    id: 'diamond-tiers', code: null, family: 'crown', name: 'Diamond Tiers', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 1800, accts: 2, also: 'crank', recordsOnly: true,
    tagline: 'Wallets that never sell earn crowns, and crowns earn fees.',
    refuses: 'Nothing is refused. The engine stamps each wallet record with its first buy and its first sell; the keeper pays the top tier from creator fees.',
    params: [
      { key: 'hours', label: 'Crown after', min: 1, max: 168, step: 1, def: 24, fmt: (v) => `${v}h unsold` },
      { key: 'pct', label: 'Share of creator fees', min: 5, max: 50, step: 5, def: 15, fmt: (v) => `${v}%` },
    ],
    summary: (p) => `crown at ${p.hours}h`,
  },
  {
    id: 'kingmaker', code: null, family: 'crown', name: 'Kingmaker', enforcedBy: 'crank', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'The biggest holder at graduation wears the crown.',
    refuses: 'Nothing is refused. At migration the keeper reads the top holder (curve vault excluded) and routes them the chosen share of creator fees for 30 days.',
    params: [{ key: 'pct', label: 'Share of creator fees', min: 5, max: 50, step: 5, def: 10, fmt: (v) => `${v}%` }],
    summary: (p) => `${p.pct}% to the king`,
  },
  {
    id: 'locked-metadata', code: null, family: 'crown', name: 'Locked Metadata', enforcedBy: 'ext', state: 'none', route: 'any', cu: 0, accts: 0,
    tagline: 'Name, ticker and image can never change.',
    refuses: 'Nothing is refused. The Token-2022 metadata update authority is set to none in the launch transaction.',
    params: [],
    summary: () => 'metadata frozen',
  },

  // ───────────── CUSTOM ─────────────
  {
    id: 'custom', code: 0x17f0, family: 'custom', name: 'Custom Block', enforcedBy: 'hook', state: 'wallet', route: 'record', cu: 5000, accts: 2, unreviewed: true,
    tagline: 'Say the rule in English. hookrz drafts it in Hookscript.',
    refuses: 'Whatever your Hookscript says. Hookscript is a small rule language the engine runs inside its own budget: comparisons over amount, balances, time, price and wallet counters. It has no loops and no calls out, and it can only refuse. Each draft is fuzzed against 10,000 generated trades before you can launch it.',
    params: [{ key: 'prompt', label: 'Your rule', text: true, def: 'Wallets can\'t sell more than they bought in the last hour' }],
    summary: () => 'Hookscript',
    error: () => 'Refused by the coin\'s custom rule',
    check: () => false,
  },
];

// ───────── helpers used by block checks (also the engine's reference semantics) ─────────
export function capAt(p, t) {
  const k = Math.min(1, Math.max(0, t / (p.hours * 3600)));
  return p.from + (p.to - p.from) * k;
}
export function chapterOf(p, progress) {
  return Math.min(p.n - 1, Math.floor(progress * p.n));
}
export function freeBalance(c, holdS) {
  const locked = (c.w.lots ?? []).filter((l) => c.t - l.t < holdS).reduce((a, l) => a + l.amt, 0);
  return Math.max(0, c.srcBefore - locked);
}
export function shortNum(n) {
  n = +n;
  if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return +(n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export const byId = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));
export const familyOf = (id) => FAMILIES.find((f) => f.id === id);
export function defaults(id) {
  const b = byId[id];
  return Object.fromEntries(b.params.map((p) => [p.key, p.def]));
}
/** "0x1773" style hex for an error code. */
export const hex = (n) => (n == null ? '—' : '0x' + n.toString(16));

/** Ready-made stacks the configurator offers as starting points. */
export const PRESETS = [
  { id: 'fair-launch', name: 'Fair Launch', blurb: 'Stops snipers and bundlers, then gets out of the way.', slots: [['snipe-shield'], ['anti-bundle'], ['rising-max'], ['sniper-fee-burn']] },
  { id: 'slow-bleed', name: 'Slow Bleed', blurb: 'Nobody can dump the chart in one candle.', slots: [['sell-cap'], ['sell-cooldown'], ['circuit-breaker'], ['outflow-cap']] },
  { id: 'diamond', name: 'Diamond Hands', blurb: 'Rewards the people who hold, and burns the rest.', slots: [['hold-timer'], ['seasoned-sells'], ['diamond-tiers'], ['buyback-burn'], ['holder-rewards']] },
  { id: 'club', name: 'Members Club', blurb: 'Only holders of another coin get in, in chapters.', slots: [['token-gate'], ['chapters'], ['max-wallet'], ['locked-metadata']] },
  { id: 'market', name: 'Market Hours', blurb: 'Trades like a stock: opening bell, breaker, settlement.', slots: [['trading-hours'], ['circuit-breaker'], ['hold-timer'], ['lp-lock']] },
];
