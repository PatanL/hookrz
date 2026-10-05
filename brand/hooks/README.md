# hookrz hook mark: pixel version (chosen 2026-10-04)

The user picked the 8-bit pixel hook (`02-pixel-8bit.png`, a Codex/ChatGPT image) over the chrome 3D hook.
It was traced to a true pixel grid (31×60, 7 colours) so it stays crisp at any size:
- `../src/hook-pixel.svg`: master vector (crispEdges rects). The site header and footer use it via `web/public/img/hook-pixel.svg`.
- `../src/hook-pixel-1x.png`: 1 px per cell. `pixel-hook-final.json`: the grid and palette.
- `hook-pixel-small-32.png` (18×32) and `-16.png` (10×17): chunkier hand-tuned derivatives for favicons.
- `web/public/favicon-16.png`, `favicon-32.png`, `favicon.ico`: on a dark rounded tile, so they read on light and dark tab bars.
- `web/public/img/hook-mark-{64,128,256,512}.png`: transparent, integer-scaled. `apple-touch-icon.png` sits on a dark background.
- `../src/x-avatar-pixel-400.png`: X profile picture.
- `web/public/img/og-v3.png`: share card (`web/_brand/og3.mjs`).

The concept rounds are in this folder (`round1-sheet.png`, `round2-sheet.png`, `avatar-mock.png`). They're regenerable with `gen-hooks.sh` and `gen-hooks-r2.sh`.
The marketing videos (`hookrz-marketing/`) still show the chrome hook and would need a re-render to match.
