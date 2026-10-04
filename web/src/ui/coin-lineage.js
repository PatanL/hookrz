// Remix lineage tree (coin page + stacks leaderboard). Input: the node api.lineage() returns
// { coin, diff:{added,removed,tuned}, children:[...] }. Nested HTML with connector lines, so it
// wraps cleanly on a phone; the path from the root to `current` is lit.
import { avatar } from './avatar.js';
import { byId } from '../data/blocks.js';
import { esc, usd } from '../core/format.js';
import { handleOf, miniStack } from './coin-shared.js';

const name = (id) => byId[id]?.name ?? id;

function diffChips(n, isRoot) {
  if (isRoot) return '<span class="dchip root">Original stack</span>';
  const { added, removed, tuned } = n.diff;
  const out = [
    ...added.map((id) => `<span class="dchip add" data-tip="Added ${esc(name(id))}">+${esc(name(id))}</span>`),
    ...removed.map((id) => `<span class="dchip rem" data-tip="Removed ${esc(name(id))}">−${esc(name(id))}</span>`),
    ...tuned.map((id) => `<span class="dchip tune" data-tip="Retuned ${esc(name(id))}">~${esc(name(id))}</span>`),
  ];
  return out.length ? out.join('') : '<span class="dchip same">Same stack, as is</span>';
}

/**
 * @param root     lineage node
 * @param current  ticker to highlight
 * @param stack    show each node's mini stack
 */
export function lineageTree(root, { current = null, stack = true } = {}) {
  const path = new Set();
  const find = (n, trail) => {
    if (n.coin.ticker === current) { [...trail, n.coin.ticker].forEach((t) => path.add(t)); return true; }
    return n.children.some((c) => find(c, [...trail, n.coin.ticker]));
  };
  if (current) find(root, []);
  const count = (n) => n.children.reduce((a, c) => a + 1 + count(c), 0);

  const node = (n, depth) => {
    const c = n.coin;
    const cur = c.ticker === current;
    const kids = n.children.length;
    return `<li class="${path.has(c.ticker) ? 'on-path' : ''}">
      <a class="lnode${cur ? ' cur' : ''}" href="coin.html?t=${encodeURIComponent(c.ticker)}">
        ${avatar(c, 32)}
        <span class="ln-main">
          <span class="ln-top"><b class="ln-t">$${esc(c.ticker)}</b><span class="ln-h">${esc(handleOf(c))}</span>${cur ? '<span class="ln-here">this coin</span>' : ''}</span>
          <span class="ln-diff">${diffChips(n, depth === 0)}</span>
          <span class="ln-meta ln-meta-m num">${usd(c.mcapUsd)}${kids ? ` · ${kids} remix${kids > 1 ? 'es' : ''}` : ''}</span>
        </span>
        <span class="ln-side">
          ${stack ? miniStack(c.stack, { size: 14, gap: 3 }) : ''}
          <span class="ln-meta num">${usd(c.mcapUsd)}${kids ? ` · ${kids} remix${kids > 1 ? 'es' : ''}` : ''}</span>
        </span>
      </a>
      ${kids ? `<ul>${n.children.map((k) => node(k, depth + 1)).join('')}</ul>` : ''}
    </li>`;
  };
  return `<div class="ltree" data-size="${count(root) + 1}"><ul>${node(root, 0)}</ul></div>`;
}
