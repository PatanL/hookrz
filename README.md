# hookrz (hookrz.fun)

**BUILD. REMIX. OWN.** The original hookrz.fun site: a Solana launchpad where a coin is built from rule blocks. The
site runs in the browser on its own (simulated chain, real in-browser Hookscript drafter and tester).

Since 2026-10-05 this repo is only hookrz.fun's site (`web/`, built by Vercel from `web/vercel.json`). The backend,
the on-chain engine, Hookscript and the redesigned site moved to a separate private project, hookrs (hookrs.fun).

- `web/` — the site (Vite, vanilla JS). `npm run dev` / `npm run build` / `npm test`.
  - `src/data/blocks.js` — the block catalog = the engine spec.
  - `src/engine/` — reference semantics of `hookrz_engine` + the launch simulator.
  - `src/api/contract.js` — the backend contract; `src/api/client.js` implements it.
  - `src/wallet/` — Wallet Standard wallet picker.
- `brand/` — source brand art and the Codex generation scripts.
- `BRIEF.md` — the design system and build brief.
