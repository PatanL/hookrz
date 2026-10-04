# hookrz

**BUILD. REMIX. OWN.** A Solana launchpad where a coin is built from rule blocks. One Token-2022 transfer-hook
program runs the coin's stack on every transfer. Remix any coin's stack; earn when yours is remixed.

- `web/` — the site (Vite, vanilla JS). `npm run dev` / `npm run build` / `npm test`.
  - `src/data/blocks.js` — the block catalog = the engine spec.
  - `src/engine/` — reference semantics of `hookrz_engine` + the launch simulator.
  - `src/api/contract.js` — the backend contract; `src/api/client.js` implements it.
  - `src/wallet/` — Wallet Standard wallet picker.
- `brand/` — source brand art and the Codex generation scripts.
- `BRIEF.md` — the design system and build brief.
