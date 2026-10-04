// Coin avatars: the ticker's first letter in voxel type on a chrome-glass tile (seeded tint), or the uploaded image.
import { voxelSVG } from './voxel.js';
import { esc } from '../core/format.js';

export function avatar(coin, size = 44) {
  if (coin.image) return `<span class="avatar" style="--a:${size}px"><img src="${esc(coin.image)}" alt=""></span>`;
  const h = [...coin.ticker].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const hue = 200 + (h % 50) - 10; // stays in the ice-blue family
  const cell = Math.max(2, size / 13);
  return `<span class="avatar" style="--a:${size}px;--hue:${hue}">${voxelSVG(coin.ticker[0], { cell, gap: cell * 0.16, depth: 0.3, glow: false, title: coin.ticker })}</span>`;
}
