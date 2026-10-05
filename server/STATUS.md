# hookrz server: status

Owner: BACKEND agent. Spec: `../ENGINE-SPEC.md`. Updated 2026-10-04.

## What works

### Local fork
The fork runs LiteSVM with:
- the mainnet Meteora DBC, DAMM v2, Token-2022, SPL Token and ATA programs (a checksummed snapshot copied from away-tek
  into `.runtime/dbc-fork`);
- the DAMM v2 migration configs;
- **hookrz_engine** from `programs/hookrz-engine/hookrz_engine.so` (the stable copy; `ENGINE_BUILD=latest` uses the
  newest `target/` build), id `EiZ3npNmrPCkAjskdMR7RDJQcojC9p8CHNr1dR4DPxKr`.

The quote token is native SOL.

#### Launch builder (`src/launch.ts`)
- Steps, in order:
  1. DBC `createConfigWithTransferHook`;
  2. `initializeVirtualPoolWithToken2022TransferHook`, which creates the mint with TransferHook → hookrz_engine and
     authority = the DBC pool authority, plus metadata pointer and token metadata;
  3. `init_stack`;
  4. an optional creator buy.
- Groups are packed greedily under 1,232 bytes.
  - **init_stack and the creator buy always share one transaction.** The buy lands in the launch slot, where Snipe Shield
    and Anti-Bundle exempt it.
  - Fair Launch plus a creator buy = 2 transactions: config + pool (1,152 B), then init_stack + creator buy (977 B).
  - Splitting pool from init_stack is safe: until init_stack writes the Stack and the meta list every transfer fails,
    and only the pool creator can init.
- **Big Hookscripts:** when init_stack + buy doesn't fit, the script is staged with `write_script` (0xA4) chunks
  (700 B) and sealed by `init_stack` (staged flag). Example: config + pool → write_script → last chunk + init_stack +
  creator buy (1,152 / 1,081 / 1,184 B).
- **Resume:** preparing again with the same `mint` skips the config and pool that already landed. Example: the wallet
  closed between the two launch transactions (tested).
- Fresh mint and config keypairs are made by the server and partially sign. The wallet only adds the creator
  signature. The mint is stable from the site's preview prepare (no wallet yet) to the wallet prepare.
- The creator buy is checked against the stack before signing: `CREATOR_BUY_REFUSED` with the largest buy that passes.
- Curve and mint blocks map to the DBC config (`src/curve.ts`):
  - sniper-fee-burn → a linear fee scheduler, `start`% → 1% over `seconds`;
  - lp-lock → the creator's permanently locked LP share (otherwise the DBC minimum of 10%);
  - leftover-burn → leftover receiver = the incinerator;
  - locked-metadata → TokenAuthorityOption.Immutable.
- Fees are collected in the quote token (`CollectFeeMode.QuoteToken`), so no base-token fee claim ever leaves the vault
  as a "buy".
- Fee split: `creatorTradingFeePercentage` is 50. The platform, as partner and fee claimer, gets the other 50; the
  keeper pays the 10% author royalty out of that.
- Remixes pass the parent Stack: the engine records `parent_author` on chain (tested).
- Custom blocks (Hookscript) accept any of:
  - `script.bytecode`;
  - `script.source`, compiled with HOOKSCRIPT's `compile()`;
  - only the block's English `prompt`, as the site sends it, which goes through HOOKSCRIPT's `draft()`. Every draft is
    compiled, fuzzed over 10,000 trades and honeypot-checked. Drafts are cached per prompt.
  - The site sends the edited source in the Custom slot's `params.script` (and as `script.source`). The server never
    trusts client bytecode: it recompiles, fuzzes 10,000 trades and runs the honeypot check, and a failure is
    `422 SCRIPT_UNSAFE` (tested with `hookscript/fuzz/honeypots/no-sells.hs`).
- The ExtraAccountMetaList the creator buy resolves offline matches LAYOUT.md:
  - the Stack is writable for anti-bundle, circuit-breaker and creator-vest;
  - the pool is included for the breaker, lock-in and custom;
  - wallet records for the record blocks and custom;
  - the Script for custom;
  - the instructions sysvar for APP-flag scripts.

#### Trade builder (`src/market.ts`)
- DBC `swap2WithTransferHook` with the hook's extra accounts re-resolved for the real transfer (the patchRuledSwap
  pattern). The compute-unit limit is 400k.
- It opens the receiver's Wallet record (ATA + `open_wallet`) when the stack keeps records. Only an engine-owned record
  counts (away-tek M1).
- After graduation, trades go through DAMM v2 (cp-amm SDK).

#### Rule-aware quote (`src/rules.ts`)
- Runs `web/src/engine/engine.js` `evaluate` over live state:
  - curve price and progress, the clock and balances;
  - Wallet records (328 B), decoded with ENGINE's own `js/layout.mjs`;
  - Creator Vesting's `creatorBase` from the Stack (`creatorBaseOf`);
  - slot buys, hour sold and the breaker window from the indexer.
- Returns `maxAllowed` by bisection.
- **Hookscript coins** then run HOOKSCRIPT's TS reference interpreter (`hookscript/compiler/src/index.ts` `run`). It
  gets the SPEC §8 Ctx built from the Stack, the Script account's globals (offset 16), and both Wallet records:
  lots in and out, bought, sold, buys, sells, last buy time and script vars. The refusal text is `formatReason`'s,
  the same one the engine logs.

#### Indexer (`Hookrz.index`)
- Every transaction goes through it, landed or refused. Fork: every send. Devnet: the RPC poller plus the relay.
- Landed trades are classified from base-vault deltas: buy, sell or send. The launch transaction counts as a full-supply
  vault.
- Refusals are decoded from the DBC swap instruction plus the custom error, then mapped to the block with the block's
  message: `6001 → snipe-shield`, or `6128 → custom` with the script's own `Hookscript: …` reason.
- It also tracks:
  - holders, from post balances;
  - stage, price and progress, from the pool;
  - SSE events.

#### Keeper (`src/keeper.ts`)
- Auto-migration of a completed curve to DAMM v2 is real.
- Burns, royalties and Hookscript game payouts are typed stubs (`planBurns`, `planRoyalties`, `planGamePayouts`).
  Payouts would read `Script.globals` at offset 16 plus the ABI offset.

#### API (`src/app.ts`, Fastify)
- Every endpoint in `web/src/api/contract.js`, with the demo JSON shapes.
- `/v1/hookscript/draft` calls HOOKSCRIPT's drafter: the Anthropic API when `ANTHROPIC_API_KEY` is set (none on this
  machine), otherwise the offline heuristic, about 1 s.
- Extra endpoints:

  | Endpoint | Purpose |
  |---|---|
  | `POST /v1/tx/send` | relay a signed transaction (the fork has no public RPC) |
  | `GET /v1/tx/:sig` | look up a transaction |
  | `GET /v1/meta/:mint.json` | the mint's metadata URI |
  | `GET /v1/image/:mint` | the coin's image |
  | `GET /v1/stream?mint=` | live events (SSE) |
  | `GET /v1/keeper` | keeper log |
  | `POST /v1/fork/airdrop`, `POST /v1/fork/warp` | fork only |

### E2E on the fork: `npm run test:e2e` (`tests/e2e-fork.test.ts`): 9 pass, 0 skipped
The engine under test is the stable .so, sha256 `60c7ab77…`, with the Hookscript VM.

Every trade is quoted by the JS engine first, then sent anyway with minOut = 1, so the chain gives its own verdict.
For Hookscript coins the JS side is HOOKSCRIPT's TS interpreter. JS and chain matched on **all 40 trades**. The table is
in `.runtime/e2e-results.json`.

| Step | JS | Chain | Engine CU |
|---|---|---|---|
| 1. Fair Launch (snipe-shield, anti-bundle, rising-max, sniper-fee-burn), creator buy in the launch tx | ok | ok | — |
| 2. ordinary buy (80% of the quoted max) | ok | ok | 3,355 |
| 3. a 0.5 SOL buy in the 60 s window | 6001 | 6001 (log `SnipeWindow`) | 3,608 |
| 3b. three buys in one slot | ok, ok, 6002 | ok, ok, 6002 | ≤ 3,660 |
| 4. warp 120 s, then sell half | ok | ok | 2,916 |
| 4. a 2 SOL buy against the rising-max 0.5% cap | 6004 | 6004 | 3,865 |
| 5. **King of the Hill** (`hookscript/examples` source compiled at launch): the king buys 0.5 SOL, a rival buys 0.05 | ok, ok | ok, ok | 9,263 / 8,617 |
| 5. the king tries to sell | **6128** | **6128**, log `Hookscript: The king can't sell or send for 5h 58m: someone has to outbid you` | 11,883 |
| 5. the rival sells | ok | ok | 6,691 |
| 5. the king sells after 6 h | ok | ok | 7,322 |
| 5b. a long script, staged with write_script and sealed by init_stack, then a buy | ok | ok | 10,221 |
| 5b. an APP-flag script (instructions sysvar in the meta list): creator buy at launch, then a buy | ok | ok | 6,999 |
| 6. fill the curve (17 buys after a 13 h warp) | ok ×17 | ok ×17 | 3,243 |
| 6. DBC retires the hook in the graduating swap (mint TransferHook → default); the keeper migrates to DAMM v2 | — | ok | — |
| 6. buy and sell on DAMM v2 | ok ×2 | ok ×2 | — |
| 7. sell-cooldown + sandwich-guard coin: the router opens the Wallet record in the buy | ok | ok | 4,103 |
| 7. sell in the same breath | 6005 | 6005 | 4,389 |
| 7. second sell inside the cooldown | 6009 | 6009 | 4,381 |
| 7. close_wallet while the hook is live | — | 6142 | — |
| 7. after graduation: close_wallet refunds the record's rent to its payer (anyone cranks); close_stack refunds the creator | — | ok | — |

### Engine CU per transfer (`tests/cu.test.ts`; `.runtime/cu-per-block.json`)
Each row is one coin with that block at its default params. The figure is the hook's Execute only, measured inside the
real DBC → Token-2022 → engine CPI chain. ENGINE's own table (worst case 19,085 CU with a heavy script) is in
`programs/hookrz-engine/STATUS.md`.

| Block | Buy | Sell |
|---|---|---|
| snipe-shield | 2,642 | 2,654 |
| anti-bundle | 2,692 | 2,684 |
| max-wallet | 2,733 | 2,648 |
| rising-max | 2,921 | 2,648 |
| sandwich-guard | 3,992 | 4,089 |
| sell-cap | 2,625 | 2,763 |
| sell-cooldown | 3,991 | 4,061 |
| hold-timer | 4,009 | 4,151 |
| circuit-breaker | 4,441 | 4,466 |
| trading-hours | 2,636 | 2,663 |
| lock-in | 2,936 | 3,756 (6015 refusal) |
| creator-vest | 2,649 | 2,676 |
| 6 slots: sandwich, cooldown, hold, breaker, sell-cap, lock-in | **6,398** | **6,857** |

Opening a Wallet record inside a buy (`open_wallet`, top level) costs about 4,700 CU on top.

`npm test` also runs `tests/api.test.ts` (7 pass). It covers:
- a launch over HTTP, with the mint stable from preview to wallet;
- resuming a half-landed launch;
- a remix: parent author on chain, lineage, stacks;
- quote → prepare → relay;
- a refusal indexed as `by: snipe-shield`;
- `/v1/hookscript/draft` (heuristic provider, fuzz panics 0);
- a Custom block launched from its English prompt alone;
- a hand-written honeypot script refused at prepare, and King of the Hill launched from source;
- reads, validate, simulate, the event stream.

### Browser check (live mode, stub wallet): passed
`scripts/browser-check.mjs` ran real-visitor Playwright (`--disable-blink-features=AutomationControlled`,
`navigator.webdriver = false`):
- the site from a scratch copy of `web/` with `VITE_API_BASE=http://127.0.0.1:8830` on 127.0.0.1:4431;
- the server on a fresh fork that follows wall time;
- a stub Wallet Standard wallet whose keys sign in Node and relay through `/v1/tx/send`.

The check ran against the engine build before ENGINE's 19:25 follow-ups. The launch and trade code paths it exercised
are covered against the current .so by the API and e2e tests.

The flow and what it showed:
1. `build.html?preset=fair-launch`: details, review, connect "Stub Wallet", sign the manifest. Both launch transactions
   landed and the done screen opened.
2. `coin.html`: the coin loaded from the server.
3. The ticket quoted 0.002 SOL → "Passes all 3 hook blocks". Confirm sent the real prepared swap: **Landed, 38.2K
   tokens**.
4. A 1 SOL buy is refused in the quote: "Refused by Snipe Shield · error 6001 … Use largest allowed (0.150 SOL)".
5. The live feed lists both real transfers with their verdict cubes.

No page errors. One 404 console line came from the ticker-availability check; it is fixed with `?optional=1`.
The browser was closed and vite and the server were stopped.

### Devnet: the curve-only path works, the engine is not deployed
`HOOKRZ_MODE=devnet npx tsx scripts/devnet-smoke.ts` used the away devnet test wallet (valueless devnet SOL; the key was
never printed). It launched a curve-only coin (sniper-fee-burn 20%→1%/30 s + lp-lock 100% + locked-metadata), then
bought and sold through the same builders. Everything was indexed by `RpcChain`.

| What | Value |
|---|---|
| ticker | HKD28AN |
| mint | `7tYer3xUUoUqysD5db9knMvWVJTsTYJ6psVCYMFuytqq` |
| pool | `9DbQCocEVstNAvx9LVksg3p4D2B3GvZR5LCeKNLc3RC` |
| launch txs | `4q1Gzv11mpPguH3dBeK3KWTBb2j8n3fFU6yBv272JtNDZAtJ81hTyUANeuJRxUXDESvsnYUETEzphiNB4gKjy5f4`, `N6s4t5B97kocRrTEv9TXwmHXLPQnefsvSFRrdebur1nfRukduHemhaLrJM33egrjH2vE9aSkJN3sehoc7inmWWF` |
| buy | `NasknJxuHXMDACMvVEWtwLHw1k6s1PLYHAq57g3UHpNaGbHjDQYsZSbLfuLY9KduZcWtPBmoPustQmfrXuUVnKE` |
| sell | `4Usq2Su3YABSHWw4n3pX1hJ4rsXgpP5qJHRCRv495jXXxg9d7w3vUb8ubNXMRQe78SY3AYN39oBRvu8y1U2dYjak` |
| cost | about 0.018 devnet SOL |

**Deploying hookrz_engine to devnet is blocked on devnet SOL.**
- `scripts/devnet-preflight.ts` confirms the dependencies are on devnet:
  - DBC, DAMM v2, Token-2022;
  - the DAMM v2 FixedBps25 migration config `7F6dnUc…`;
  - the DBC pool authority is the same address as on mainnet.
- The .so is now 292,672 B, with the Hookscript VM. Its program data rent is 1.488 SOL, so a deploy needs about
  **3.0 SOL** at peak (buffer + program data).
- The only funded wallet has 0.098 SOL, and the devnet faucet rate-limited three airdrop requests.

What's needed:
1. Send ≥ 3.1 devnet SOL to the fresh deployer `9zpog7qQjsVax4qGnFzYtXcKyWpeMr6yfyAJZhJNdTN5`, either from
   faucet.solana.com with a GitHub login or by transfer. Its key is in `.secrets/devnet-deployer.json`; the fresh program
   key is `.secrets/hookrz-engine-devnet-program.json` → `5bewmrVEU8PZYqRQrYABwQB45tBuFMT4PVuWj2GiAQFQ`.
2. **ENGINE:** the engine's script path checks `script.owner == ID`, where `ID` is the hardcoded `declare_id!`. Either
   build a devnet .so with `declare_id!("5bewmr…")`, or switch that check to the runtime `program_id`.
3. Deploy:
   ```
   solana program deploy --url devnet --keypair .secrets/devnet-deployer.json --program-id .secrets/hookrz-engine-devnet-program.json hookrz_engine.so
   ```
   Then set the upgrade authority to a multisig or `--final` before anything real.
4. Run with `HOOKRZ_MODE=devnet HOOKRZ_ENGINE_ID=5bewmr… RPC_URL=<a dedicated devnet RPC> npm start`. The public RPC
   answered with many 429s. No DBC config setup is needed, because every launch creates its own config. The platform
   fee-claimer key is `.secrets/platform.json` (created on first devnet boot).

## Run
```
cd server && npm install
npm test                      # api + cu + e2e on fresh in-memory forks (~10 s)
npm start                     # API on http://127.0.0.1:8830; dev fork persisted (.runtime/fork-state.bin + fork.sqlite), clock follows wall time
THRESHOLD_SOL=85 PORT=8830 npm start
HOOK=away-rules npm start     # the away-rules stand-in (the DBC TransferHook path without hookrz_engine)
npx tsx scripts/probe-away-rules.ts      # raw SOL-quoted DBC TransferHook launch → trade → refusal → graduate → migrate, away-rules
npx tsx scripts/devnet-preflight.ts      # devnet dependencies + deployer balance
```
To run the site in live mode:
```
cd web && VITE_API_BASE=http://127.0.0.1:8830 npx vite --host 127.0.0.1 --port 4431
```
`web/.env.example` shows the variable. Demo mode is unchanged when it is unset.

## Web wiring (my scope: `web/src/api/client.js` + `web/.env.example`)
- `MODE = 'live'` when `VITE_API_BASE` is set:
  - every endpoint goes through the server;
  - `blocks()` stays local, because the catalog carries code;
  - `stream()` uses SSE for a coin and stays simulated for the build rack.
- Launch: `submitLaunch` re-prepares for the connected wallet (same mint, fresh blockhash, parent), calls
  `signAndSend` on each transaction in order, then `/v1/launch/submit` indexes the coin.
- New functions: `api.prepareTrade` and `api.trade` (prepare → `signAndSend` → the chain's verdict). In demo mode,
  `trade` simulates a landing.
- **The coordinator has to apply one change outside my scope.** The trade ticket (`web/src/ui/coin-ticket.js`) still
  fakes its signature. `web-patches/coin-ticket-live.patch` makes its Confirm call `api.trade()`, and shows the code and
  block when the chain refuses. It applies cleanly (`git apply -p0`); the browser check ran with it.

## Blocked on / waiting for
- **Devnet SOL** for the engine deploy (≈ 3.0 SOL). See the devnet section above.
- **ENGINE:** the script owner check uses the hardcoded `declare_id!`. A devnet deploy at a fresh address needs a build
  with that id, or a switch to the runtime `program_id`.
- **Coordinator:** apply `web-patches/coin-ticket-live.patch` so the trade ticket sends the real prepared transaction.
- Keeper phase 2: burns, royalties and Hookscript payouts are typed stubs.
