#!/usr/bin/env bash
cd "$(dirname "$0")"
G=../gen/gen-ref.sh
BASE="Square 1:1 logo mark for a crypto launchpad called hookrz, centered, filling about 62% of the frame, pure solid black (#000000) background, generous margins. Palette: polished chrome / silver plus ONE accent, ice blue (#8fcaff to #4d9bff) glow. Bold, simple silhouette that still reads as a fishing hook at 32 px. No text, no letters, no numbers, no watermark."
run() { $G "$1" "$2" "$BASE $3" >> gen2.log 2>&1; }
run r2-a-blockhook-3d.png 03-block-stack-hook.png "Refine the attached concept: exactly six chunky chrome cube blocks snapped together into a bold J-shaped fishing hook, a chrome ring eye on top, a sharp chrome barb at the end. Each cube has one small glowing ice-blue emblem, in order from the top: shield, bar chart, flame, droplet, crown, plus. Cubes are uniform, crisp bevels, thin glowing seams between them, clean studio lighting, symmetric and iconic." &
run r2-b-blockhook-flat.png 03-block-stack-hook.png "Flat 2D vector logo version of the attached concept: six rounded square tiles forming a J-shaped fishing hook with a ring eye on top and a barb at the end, each tile a flat silver tile with a simple ice-blue line icon (shield, bars, flame, droplet, crown, plus). No 3D, no gradients except a subtle silver tone, crisp edges, works as an app icon and favicon." &
wait
run r2-c-voxel-chunky.png 01-voxel-hook.png "Refine the attached voxel hook: make it chunkier and bolder, built from fewer, bigger glossy chrome cubes (the stroke is 2 cubes thick), stepped pixel curve, a square voxel ring eye on top, a voxel barb, thin glowing ice-blue seams, front view with slight depth, matching a voxel 3D pixel-art wordmark." &
run r2-d-voxel-h.png 05-monoline-h.png "A lowercase letter h built from glossy chrome voxel cubes (3D pixel art), where the right leg of the h curls down and back up into a fishing-hook barb. Thin glowing ice-blue seams between cubes, front view with slight depth. It should read both as the letter h and as a hook." &
wait
run r2-e-h-appicon.png 05-monoline-h.png "Premium app icon: a rounded-square black glass tile with a thin ice-blue inner glow edge; on it, a chrome monoline lowercase h whose right leg ends in a hook barb, centered, glossy, simple, iconic." &
run r2-f-mascot-catch.png 10-sticker-mascot.png "Mascot scene version of the attached sticker character: the cute chunky chrome hook with two glowing ice-blue dot eyes has just hooked a small angry coral-red pixel bot (a tiny red voxel creature with an X face, representing a sniper bot) dangling from its barb. Thick white sticker outline around the whole composition, playful, meme-friendly, premium." &
wait
echo DONE >> gen2.log
