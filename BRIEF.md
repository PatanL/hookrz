# hookrz — build brief (read this first)

hookrz.fun is a Solana launchpad where a coin is built from **rule blocks**. One Token-2022 transfer-hook
program (`hookrz_engine`) runs the coin's **stack** of blocks on every transfer. Tagline (from the brand banner):
**BUILD. REMIX. OWN.**

- **Build**: snap up to 6 blocks into a stack (Guard, Pace, Burn, Flow, Crown, Custom families). Tune each one.
- **Remix**: any coin's stack can be forked in one click into a new launch. The remix keeps a parent link (lineage).
- **Own**: the stack's author earns a royalty (10% of the 1% trade fee) on every coin that remixes their stack,
  one level up only. Creators also get 50% of their own coin's trading fee.

Competitors: hookedpad.com (one rule per coin, 29 separate hook programs) and spec.fun (configurator, 71
"extensions"). Our edge: a Token-2022 mint can point at only ONE hook program, so others give a coin one rule or
bolt rules into ad-hoc programs. hookrz points every coin at one audited engine that runs a whole **stack**, with
remix lineage and royalties. Say this plainly; don't name competitors on the site.

## This must look and read like the launched product
- **No "demo", "preview", "simulated", "mock", "coming soon", "devnet" wording anywhere in the UI.** The site is
  launch-ready UI. Data that has no backend yet comes from `src/api/client.js` (MODE 'demo' answers locally),
  but the UI presents it as live. Only exception: the Build page's **launch simulator** is a real feature, so it's
  called "Simulate launch" / "Simulation" there.
- Wallet connect is REAL (`src/wallet/wallet.js`, Wallet Standard: Phantom, Solflare, Backpack…). Use
  `connect()` (returns the wallet handle, opens the picker if needed), `pick()`, `onWallet(addr => …)`,
  `address`, and `handle.signMessage(bytes)`. Header buttons with `data-wallet-btn` are wired by
  `mountChrome()`; call `bindWalletButtons(root)` from `src/ui/chrome.js` for buttons you add later.

## Stack
Vite multi-page, vanilla ES modules, no framework. Dev server already running: **http://100.97.32.64:4430/**
(HMR; don't start another on that port). Pages: index (home), coins, coin (?t=TICKER), stacks, blocks, build
(?remix=TICKER, #presets), docs. Each page = `<page>.html` → `src/pages/<id>.js` + `src/styles/<id>.css`.

## Shared modules — USE them, DON'T edit them (other agents work in parallel)
| File | What |
|---|---|
| `src/styles/base.css` | tokens + components: `.wrap .section .section-head .panel .btn(.btn-chrome .btn-glass .btn-ghost .btn-sm .btn-lg) .chip(.ice .refuse .solid) .eyebrow .lede .chrome-text .pixel .mono .num .cube .enf(.hook .curve .crank .ext) .table .field .input .avatar .toast .modal` |
| `src/ui/chrome.js` | `mountChrome(navId)`, `bindWalletButtons(root)`, `requireWallet()`, `modal(html, render)`, `toast(text)` |
| `src/ui/voxel.js` | `voxelSVG(text, {cell, gap, depth, glow})` chrome voxel type (A–Z 0–9 . - ! ? +), `wordmark()`, `asset(path)` |
| `src/ui/icons.js` | `EMBLEM[family]` SVGs, `ICON.*`, `cube(family, {size, state:'lit'|'refused'|'empty'})` CSS chrome cube |
| `src/ui/avatar.js` | `avatar(coin, size)` |
| `src/core/format.js` | `usd pctS num ago clock esc q` |
| `src/data/blocks.js` | `FAMILIES ENFORCERS ENGINE BLOCKS byId familyOf defaults hex PRESETS rentSol` — the catalog (params have min/max/step/def/fmt or options or text) |
| `src/engine/engine.js` | `budget(stack)` (CU, accounts, rent, route, warnings), `evaluate(stack, ctx)`, `normalize`, `feeAt` |
| `src/engine/sim.js` | `simulate(stack, {seed})` → stats/series/log, `ARCHETYPES`, `Curve`, `SUPPLY`, `fmtSol` |
| `src/api/client.js` | `api.*` — the ONLY data source: blocks, coins, coin, trades, holders, quote, validate, simulate, stacks, lineage, draftHookscript, prepareLaunch, submitLaunch, creator, stream(ticker, cb) ; `diffStacks` |
| `src/api/contract.js` | `ENDPOINTS SERVICES LAUNCH_IXS FEES API_BASE` — the backend contract |
| `src/data/coins.js` | seed coins (only via api), `SOL_USD`, `short()` |

If you truly need a shared change, make it in your own page files instead, or report it back — don't edit shared files.
You may add new files `src/ui/<yourpage>-*.js`.

## Look
Black (#030409) + chrome + frosted glass + one hue: ice blue (`--ice #8fcaff`, `--ice-2 #4d9bff`). Coral
`--refuse` only for refused transfers. Fonts: Archivo (headlines use `font-variation-settings:'wdth' 118`,
weight 800), Silkscreen for small pixel labels (`.pixel`, `.eyebrow`, `.chip`), JetBrains Mono for numbers and
addresses. Blocky shapes: small radii, stepped pixel corners (`clip-path: var(--notch)`). Big display lines can be
voxel type (`voxelSVG`). Glow sparingly. Generous spacing, strong hierarchy, real content density (this is a
trading product, not a template).

Brand renders (black backgrounds; on our dark page use `mix-blend-mode: screen` so the black disappears):
`public/img/brand/block-{guard,pace,burn,flow,crown,custom}.webp` (640px; `-sm` 240px) — chrome cube per family;
`hero-hook-stack.webp` (chrome hook with blocks hanging, empty left side), `remix-tree.webp` (one stack branching into
three remixes), `engine-rack.webp` (rack of 6 slots, cable through it) — 1672×941, `-900` variants.
`public/img/hook-mark-{64,128,256,512}.png` (the logo hook), `public/img/banner-build-remix-own.webp` (the brand
banner). Reference them as `img/...` (relative; base is './').

## Voice
Plain, confident, short. Say what the thing does and what the chain refuses. No hype, no emoji, no exclamation
marks. Terms: block, stack, slot, remix, lineage, royalty, engine, refuse/refused, land/landed, curve, graduate.
Numbers in mono.

## Backend awareness (the UI must reflect the real architecture)
- Enforcers per block: Hook (engine refuses the transfer, custom error code), Curve (Meteora DBC config), Crank
  (public keeper acts on fee vaults), Mint (Token-2022 setting). Show them with `.enf` badges.
- Engine limits: 6 slots, 30,000 CU per transfer, extra accounts (ExtraAccountMetaList), Stack PDA rent,
  Wallet records (per-holder PDA, ~0.0016 SOL rent, refunded after graduation; the hookrz router opens it in the
  buy; aggregator routes work once it exists).
- Hook blocks retire at graduation: the DBC pool is the mint's transfer-hook authority and removes the hook in the
  graduating swap; the coin migrates to DAMM v2. Crank blocks keep running on LP fees.
- Launch = one transaction: create mint (TransferHook → hookrz_engine) → DBC createConfigWithTransferHook →
  initializeVirtualPoolWithToken2022TransferHook → hookrz_engine init_stack (Stack + ExtraAccountMetaList) →
  optional creator buy. See `LAUNCH_IXS`.
- Quotes are rule-aware: before signing, the API says whether the stack would refuse and the largest amount that
  passes now (`api.quote`).

## Done means
- Your pages render at 1440×900 and 390×844 with **no console errors and no horizontal overflow**. Check with
  `node /tmp/claude-1000/-home-dzliu-pzliu/42a852ba-b22d-412e-80db-a9dad2c6b621/scratchpad/shot2.mjs <url> <out.png> <w> <h> <fullPage 0|1>`
  (prints overflowX + errors), then LOOK at the PNGs (Read tool) and fix what looks off. Iterate until it looks
  like a top-tier crypto product.
- Every interactive control does something sensible.
- Report: files you created/changed, what each page has, anything you couldn't do.
