#!/usr/bin/env bash
cd "$(dirname "$0")"
G=./gen-ref.sh
REF=block-guard.png
HOOK=../src/hook-mark.png
BANNER=../src/banner-build-remix-own.png
SAME="Square 1:1. Recreate the attached image exactly - the same chunky chrome voxel cube block, same segmented chrome panels with glowing ice-blue seams, same 3/4 isometric camera angle, same size and position, same lighting, on pure solid black - but replace the shield emblem on its front face with"
END="in the same recessed glowing ice-blue glass style. No text, no letters, no numbers."
STYLE="Style: glossy 3D render of polished chrome and frosted glass with ice-blue glowing seams and soft blue-white reflections, beveled voxel construction, on a pure solid black (#000000) background, no floor, no reflection. No text, no letters, no numbers, no logos, no watermark."
run() { $G "$1" "$2" "$3" >> batch1.log 2>&1; }
run block-pace.png $REF "$SAME a rising bar chart emblem (three vertical bars, short to tall) $END" &
run block-burn.png $REF "$SAME a flame emblem $END" &
wait
run block-flow.png $REF "$SAME a water droplet emblem $END" &
run block-crown.png $REF "$SAME a crown emblem $END" &
wait
run block-custom.png $REF "$SAME a bold plus sign emblem, and make the whole cube frosted translucent glass glowing softly from inside instead of chrome, $END" &
run hero-hook-stack.png $HOOK "Wide 16:9 landscape composition. The exact chrome-and-glass fishing hook from the attached reference image, large, on the right half of the frame, slightly tilted, with a short chain of three small chunky chrome voxel cube blocks (segmented chrome panels with glowing ice-blue seams, emblems: shield, bar chart, crown) hanging from its eye by a glowing glass cable. The left 45% of the frame is empty pure black for headline text. $STYLE" &
wait
run remix-tree.png $REF "Wide 16:9 landscape composition. Using the exact chunky chrome voxel cube block style of the attached image (segmented chrome panels, glowing ice-blue seams): on the left, a stack of three snapped-together cubes; glowing glass cables branch from it to three different remixed stacks on the right, each a different arrangement of 2 to 4 cubes with different glowing emblems (shield, flame, droplet, crown, bar chart), like a family tree. Floating in a black void, lots of negative space. $STYLE" &
run engine-rack.png $REF "Wide 16:9 landscape composition. A long low dark-chrome rack frame seen in 3/4 view holding six cube slots in a row; five slots hold the exact chunky chrome voxel cube blocks of the attached image, with glowing emblems shield, bar chart, flame, droplet, crown; the sixth slot is empty and glowing ice blue. A thin glowing glass cable enters the rack on the left and exits on the right carrying a small bright packet of light. Lots of empty black space above and below. $STYLE" &
wait
echo DONE >> batch1.log
