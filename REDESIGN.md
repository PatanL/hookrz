# hookrz website redesign: shared brief (every agent reads this first)

## Why
The user's feedback: the site is overwhelming. A first-time visitor sees the mechanism before the benefit, about 15 new terms
(block, stack, slot, rack, preset, family, enforcer, Hook/Curve/Crank/Mint, CU, wallet record, Hookscript, remix,
lineage, royalty), error numbers and compute budgets, a Build page with 30 buttons and three columns competing for the
first decision, and a 7,700 px home page (12,200 px on phone). Our best and easiest feature, "say your rule in plain
English" (Hookscript), sits in the sixth palette tab.

## Goals
1. **Benefit first, in trader words.** "Launch a coin snipers can't snipe and devs can't dump." The mechanism comes second.
2. **One obvious path: Launch in 3 steps**:
   1. pick a rulebook, or describe your own rule in English;
   2. name your coin;
   3. review, sign, done.

   Everything else (the six-slot rack, the 29-rule palette, the budget panel, the simulator details) is **behind
   "Customize"**. Every current feature stays reachable for power users.
3. **Plain words in the default view.** No error numbers, CU, enforcer badges, "slot", "rack", "Token-2022", "ExtraAccountMeta",
   "wallet record" or "route" in primary UI. Those live in details drawers, hover tooltips, the advanced view and Docs.
4. **Short pages.** Home ≤ about 5 desktop screens and ≤ 900 words. One primary call to action per section.
5. **Pixel and voxel vibe.**
   - The pixel hook logo (`img/hook-pixel.svg`), the voxel display type (`voxelSVG`), Silkscreen pixel labels.
   - **The new pixel icon set** `src/ui/pixel.js`: `pixelIcon(name, {size, color, accent})` for guard, pace, burn, flow,
     crown, custom, check, cross, lock, arrow, bot, plus `hookMark(h)`. Use pixel icons for rule families in the default
     UI.
   - The chrome cube renders can stay as occasional hero art, not on every card.
6. **Mobile first.** Everything must work at 390 px, with short pages.

## Vocabulary (user-facing)
| Say | Not |
|---|---|
| **rule** | block (OK in advanced view and Docs) |
| **rulebook** (a preset or a coin's set of rules) | stack, rack, slots |
| **your own rule** / **write a rule in English** (Hookscript is fine as the language's name, once) | custom block |
| **blocked** / **refused** (a trade that breaks a rule) | 6001 · SnipeWindow (codes only in details) |
| **remix** (copy a coin's rules) and **earn when people remix yours** | lineage, parent stack, royalty math |

## Information architecture (nav already changed by the coordinator in `src/ui/chrome.js`)
**Launch** (build.html) · **Coins** (coins.html; stacks.html and coin.html live under it) · **Rules** (blocks.html) · **Docs** (docs.html). Header CTA: "Launch a coin".

## Page specs
- **Home** (`index.html` → `src/pages/home.js`), about 5 sections:
  1. **Hero:**
     - benefit headline (keep the voxel BUILD. REMIX. OWN. as a brand line if it fits, but the benefit sentence must be the first readable thing);
     - one big input "Describe your coin's rule…" with 3–4 example chips. Submitting goes to `build.html` with the rule pre-filled and drafted (pass via URL, e.g. `build.html?rule=<text>`, coordinated with LAUNCH);
     - a secondary "Pick a ready-made rulebook".
  2. **How it works in 3 steps**, with pixel icons.
  3. **Rulebooks:** the 5 presets as plain cards ("Stops snipers and bundlers"), each "Launch with this".
  4. **Your own rule:** a live mini demo of English → rule → "a sell over 25% in the first 2h is blocked".
  5. **Coins:** trending, or the honest empty state with a CTA.

  Plus a compact "Why it's safe" line: the chain enforces it, rules can't move funds, hookrz holds no keys. The engine, transfer path and royalty math move to Docs.
- **Launch** (`build.html`) is a **3-step flow by default**:
  1. **Rules.** Rulebook cards OR "describe your own rule" (the real Hookscript drafter, already in the site; see `src/ui/hs-editor.js`). Show a plain list of what the chosen rules do. An optional "Test against 197 bots" button gives a compact result (the full simulator stays in Customize).
  2. **Coin.** Name, ticker, image, description, links, optional first buy.
  3. **Review & launch.** A plain summary, connect wallet, sign (the existing launch code in `src/ui/build-launch.js`).

  A "Customize rules" toggle opens the existing advanced UI (rack, palette, editor, budget, simulator). Keep `?preset=`, `?add=`, `?remix=` working and add `?rule=`.
- **Rules** (`blocks.html`): a calm grid by family with pixel icons and one plain sentence each, minimal filters, and the details drawer keeps all technical info (codes, CU, enforcer, tester).
- **Coins / coin / stacks:** plain words, codes on hover only. The coin page's rules panel says what each rule does right now in plain words. Stacks becomes "Remixes & royalties" (reached from Coins).
- **Docs:** unchanged except plain intro copy. Docs is where the technical depth lives.

## Hard rules
- Don't change behaviour you don't own.
  - Keep demo vs live mode logic (`src/api/client.js`), the wallet module, the Hookscript integration and the engine data
    (`src/data/blocks.js` must not change; it is parity-tested against the on-chain program).
  - `cd web && npm test` must stay green.
- **Site rules:**
  - no "demo/preview/mock/devnet/coming soon" wording (the simulator may say Simulation);
  - **never "0x"**;
  - X link stays in the header (`chrome.js`);
  - no fake coins or numbers.
- **Browser use is serialized across agents:** wrap EVERY Playwright run in
  `flock /tmp/hookrz-browser.lock node your-script.mjs`. One browser at a time machine-wide; close it at the end of the script.
  Real-visitor mode: `--disable-blink-features=AutomationControlled` and an init script setting `navigator.webdriver` to false,
  then scroll through the page. Check 1440×900 and 390×844 for no console errors and no horizontal overflow. Read your
  screenshots and iterate.
- The dev server is already running at http://100.97.32.64:4430 (Vite HMR). Don't start another on that port.
- **Never `git commit` or `git push`.** The coordinator reviews and pushes. Check `tail -1 ~/spark-health/health.log` before heavy work.
- **Ownership:**
  - **HOME:** `src/pages/home.js`, `src/styles/home.css`, `src/ui/home-*.js`, and `src/styles/base.css` (global tokens, type and components; others request changes from HOME via their report).
  - **LAUNCH:** `src/pages/build.js`, `src/styles/build.css`, `src/ui/build-*.js`, `src/ui/hs-editor.js`.
  - **PAGES:** `src/pages/{blocks,coins,coin,stacks,docs}.js`, their CSS, `src/ui/blocks-*.js`, `src/ui/coin-*.js`, `src/ui/docs-*.js`.
  - Anything shared you need changed (`chrome.js`, `pixel.js`, `client.js`, `icons.js`): say so in your report instead of editing it.
