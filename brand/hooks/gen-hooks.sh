#!/usr/bin/env bash
# Hook mark concept round 1 (Codex / ChatGPT image generation). Two at a time.
cd "$(dirname "$0")"
G=../gen/gen-ref.sh
LOGO=../src/hook-logo-v2.png
CUBE=../gen/block-guard.png
BASE="Square 1:1 logo mark concept for a crypto launchpad called hookrz. A single fishing-hook symbol, centered, filling about 60% of the frame, on a pure solid black (#000000) background with generous empty margins. Palette: polished chrome / silver and ONE accent color, ice blue (#8fcaff to #4d9bff) glow. Must read clearly as a hook even at small size. No text, no letters, no numbers, no watermark."
run() { $G "$1" "$2" "$BASE $3" >> gen.log 2>&1; }
run 01-voxel-hook.png $CUBE "Style: the hook is built entirely from small glossy chrome voxel cubes (like 3D pixel art), the cubes have thin glowing ice-blue seams, chunky stepped curve, isometric 3/4 view, soft ice-blue rim light." &
run 02-pixel-8bit.png - "Style: flat 2D 8-bit pixel art icon, crisp square pixels on a 24x24 grid scaled up, silver/white pixels with ice-blue highlight pixels and a 1-pixel ice-blue glow outline, no anti-aliasing, game-UI icon feel." &
wait
run 03-block-stack-hook.png $CUBE "Style: six small chunky chrome cube blocks (like the attached block, each with a tiny glowing ice-blue emblem: shield, bars, flame, droplet, crown, plus) stacked and snapped together so that together they form the shape of a J-shaped fishing hook, the top cube has a ring eye, glossy 3D render." &
run 04-glass-core.png $LOGO "Style: the same hook silhouette as the attached logo but made of thick frosted translucent glass, with a glowing ice-blue light core running through the inside of the shank like a filament, subtle refraction, soft studio render." &
wait
run 05-monoline-h.png - "Style: minimal geometric monoline logo: one continuous rounded stroke that draws a lowercase letter h whose right leg curls down and up into a fishing-hook barb, like a monogram, chrome gradient stroke with subtle ice-blue glow, flat vector, very clean, works as an app icon." &
run 06-hook-catches-cube.png $CUBE "Style: a chunky chrome fishing hook, its point hooking through the top of a single small glowing ice-blue glass cube (a block being caught), dynamic 3/4 angle, glossy 3D, tiny sparks at the contact point." &
wait
run 07-circuit-hook.png $LOGO "Style: a sleek chrome hook whose surface is engraved with fine glowing ice-blue circuit-board traces and small nodes that flow along the curve to the barb, high-tech, premium 3D render." &
run 08-painted-hook.png $LOGO "Style: hand-painted painterly illustration in the style of a stylized animated feature film (visible brush strokes, designed light and shadow shapes), a warm-silver chrome hook with a strong rim light and an ice-blue glow, dark painted background vignette, emblem-like." &
wait
run 09-isometric-badge.png - "Style: isometric 3D app-icon badge: a rounded-square chrome tile with a raised fishing-hook shape extruded from its surface, glowing ice-blue edges, glossy, like a premium iOS app icon floating on black." &
run 10-sticker-mascot.png $LOGO "Style: playful sticker / mascot version: a cute chunky cartoon chrome hook with a subtle smug expression made only of two small ice-blue glowing dot eyes, thick white sticker outline, slight drop shadow, meme-friendly but still premium." &
wait
echo DONE >> gen.log
