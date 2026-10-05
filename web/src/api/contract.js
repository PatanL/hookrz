// The hookrz backend contract. The site talks ONLY through src/api/client.js, which implements every
// endpoint below twice: `demo` (in-browser, seeded data + the reference engine) and `live` (fetch to
// API_BASE). When the backend ships, flip MODE in client.js and nothing else in the UI changes.
// The docs page renders this table, so the published contract and the code never drift apart.

export const API_BASE = 'https://api.hookrz.fun';

export const SERVICES = [
  { id: 'engine', name: 'hookrz_engine', kind: 'Solana program', blurb: 'One Token-2022 transfer-hook program for every coin. Reads the coin\'s Stack and runs its blocks on every transfer; can only refuse. No admin key, no CPIs out.' },
  { id: 'router', name: 'hookrz router', kind: 'Solana program', blurb: 'Wraps Meteora DBC swaps: opens the receiver\'s Wallet record when the stack needs one, then swaps with the hook\'s extra accounts resolved.' },
  { id: 'api', name: 'API', kind: 'Service', blurb: 'Builds unsigned launch and trade transactions, gives rule-aware quotes, validates and simulates stacks. Holds no keys.' },
  { id: 'indexer', name: 'Indexer', kind: 'Service', blurb: 'Follows the engine, DBC and DAMM v2 programs; writes coins, trades, verdicts and remix lineage to Postgres; pushes the live stream.' },
  { id: 'keeper', name: 'Keeper', kind: 'Service', blurb: 'Permissionless crank for Crank blocks: claims fee vaults, buys back and burns, posts reward roots, pays rule-game winners. Anyone can run it.' },
  { id: 'hookscript', name: 'Hookscript compiler', kind: 'Service', blurb: 'Turns an English rule into Hookscript with an LLM, compiles it to engine ops, measures CU and fuzzes it against 10,000 generated trades.' },
];

export const ENDPOINTS = [
  { method: 'GET', path: '/v1/blocks', fn: 'blocks', group: 'Catalog', desc: 'Every block: family, enforcer, params with bounds, CU, accounts, error code.' },
  { method: 'GET', path: '/v1/coins', fn: 'coins', group: 'Coins', desc: 'Launches with stack, curve progress and stats. Query: sort, family, phase, q.' },
  { method: 'GET', path: '/v1/coins/:mint', fn: 'coin', group: 'Coins', desc: 'One coin: metadata, stack with live block state, curve, fee split, lineage.' },
  { method: 'GET', path: '/v1/coins/:mint/trades', fn: 'trades', group: 'Coins', desc: 'Recent transfers with the engine\'s verdict per block (landed or refused + error code).' },
  { method: 'GET', path: '/v1/coins/:mint/holders', fn: 'holders', group: 'Coins', desc: 'Top holders, with Wallet-record state (lots, cooldowns, tiers) when the stack keeps it.' },
  { method: 'GET', path: '/v1/coins/:mint/marks', fn: 'marks', group: 'Coins', desc: 'The coin\'s Blocklist and Allowlist passes, read from chain: one mark per wallet address (blocked, pass).' },
  { method: 'GET', path: '/v1/coins/:mint/marks/:owner', fn: 'mark', group: 'Coins', desc: 'One wallet\'s mark on a coin: blocked, has a pass.' },
  { method: 'POST', path: '/v1/quote', fn: 'quote', group: 'Trade', desc: 'Rule-aware quote. If the stack would refuse, returns refusedBy + the largest amount that passes now.' },
  { method: 'POST', path: '/v1/trade/prepare', fn: 'prepareTrade', group: 'Trade', desc: 'Unsigned router swap with hook accounts resolved and the Wallet record opened if needed.' },
  { method: 'POST', path: '/v1/stacks/validate', fn: 'validate', group: 'Stacks', desc: 'CU, extra accounts, rent, route compatibility and warnings for a proposed stack.' },
  { method: 'POST', path: '/v1/stacks/simulate', fn: 'simulate', group: 'Stacks', desc: 'Simulates a launch: runs the stack against a seeded crowd of snipers, bundlers, whales and holders and compares it with no rules.' },
  { method: 'GET', path: '/v1/stacks', fn: 'stacks', group: 'Stacks', desc: 'Rulebooks ranked by how many coins reuse them.' },
  { method: 'GET', path: '/v1/stacks/:id/lineage', fn: 'lineage', group: 'Stacks', desc: 'The remix tree: parent, children and what changed in each remix.' },
  { method: 'POST', path: '/v1/hookscript/draft', fn: 'draftHookscript', group: 'Stacks', desc: 'English → Hookscript draft, compiled ops, CU estimate and fuzz results.' },
  { method: 'POST', path: '/v1/launch/prepare', fn: 'prepareLaunch', group: 'Launch', desc: 'Unsigned launch transaction: mint + DBC pool + engine Stack + ExtraAccountMetaList (+ creator buy, + up to 3 Blocklist / Allowlist marks: body.marks [{ owner, blocked?, pass? }]). Returns the fee split the DBC config gets (curve.feeSplit). Tithe needs params.to, the address it pays.' },
  { method: 'POST', path: '/v1/launch/submit', fn: 'submitLaunch', group: 'Launch', desc: 'Relays the signed launch, waits for confirmation, indexes the coin.' },
  { method: 'GET', path: '/v1/creators/:wallet', fn: 'creator', group: 'Own', desc: 'A creator\'s coins, their rulebooks, and claimable creator fees.' },
  { method: 'POST', path: '/v1/fees/claim/prepare', fn: 'prepareClaim', group: 'Own', desc: 'Unsigned claim of creator fees from the curve pool.' },
  { method: 'POST', path: '/v1/coins/:mint/marks/prepare', fn: 'prepareMarks', group: 'Own', desc: 'Unsigned set_mark transactions for the creator: block or unblock wallets until the Blocklist freezes, grant or revoke Allowlist passes. Body: creator, marks [{ owner, blocked?, pass? }].' },
  { method: 'GET', path: '/v1/coins/:mint/keeper', fn: 'coinKeeper', group: 'Keeper', desc: 'The coin\'s fee routing and keeper ledger: claimed, kept, paid and burned per rule, what is still owed, and every claim, burn and payout with its transaction.' },
  { method: 'GET', path: '/v1/keeper', fn: 'keeper', group: 'Keeper', desc: 'The public keeper: its loop and platform key, every keeper coin\'s totals and the latest actions.' },
  { method: 'WS', path: '/v1/stream?mint=', fn: 'stream', group: 'Live', desc: 'Push stream of transfers and verdicts, curve ticks and keeper actions.' },
  { method: 'GET', path: '/v1/health', fn: 'health', group: 'Live', desc: 'The network the API runs on, its slot and clock: the site links transactions to the matching explorer.' },
];

/** The launch transaction, instruction by instruction (what /v1/launch/prepare returns, in order). */
export const LAUNCH_IXS = [
  { program: 'System + Token-2022', ix: 'create mint', note: 'Extensions: TransferHook → hookrz_engine, MetadataPointer + TokenMetadata. Mint and freeze authority end as none.' },
  { program: 'Meteora DBC', ix: 'createConfigWithTransferHook', note: 'Curve shape, 1% fee split (creator / platform), fee scheduler, migration to DAMM v2, LP lock.' },
  { program: 'Meteora DBC', ix: 'initializeVirtualPoolWithToken2022TransferHook', note: 'The pool becomes the mint\'s transfer-hook authority. It removes the hook in the swap that graduates the curve.' },
  { program: 'hookrz_engine', ix: 'init_stack', note: 'Writes the Stack PDA (blocks + params + parent stack) and the ExtraAccountMetaList. Only the pool creator can call it, once.' },
  { program: 'hookrz router', ix: 'swap (optional)', note: 'The creator\'s first buy, in the same transaction, so nobody can trade before the rules are armed.' },
];

/** Fee split on the curve — DRAFT, the numbers are open for the founder to decide. */
export const FEES = {
  draft: true,
  tradeFeePct: 1.0,
  split: [
    { who: 'Creator', pct: 50, note: 'Claimed straight from the curve pool. Keeper rules (burns, rewards, tithes, script payouts) spend from this share: their part is routed to the keeper at launch and every payout is public.' },
    { who: 'hookrz', pct: 50, note: 'Platform share: engine audits, the public keeper, the API.' },
  ],
  launchCostSol: 0.02,
};
