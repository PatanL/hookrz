// Ready-made rulebooks (PRESETS) for the coins page, the coin page's not-found state and the remixes page.
// Each card links to Launch with the rulebook loaded (build.html?preset=<id>).
import { PRESETS, ENGINE, ENFORCERS } from '../data/blocks.js';
import { budget, normalize } from '../engine/engine.js';
import { esc } from '../core/format.js';
import { miniStack } from './coin-shared.js';

/** Each preset with its normalized stack and engine budget. */
export const STARTERS = PRESETS.map((p) => {
  const stack = normalize(p.slots.map(([id, params]) => ({ id, params })));
  return { ...p, stack, budget: budget(stack), href: `build.html?preset=${encodeURIComponent(p.id)}` };
});

export const cuLabel = (b) => (b.hasHook ? `${b.cu.toLocaleString('en-US')} CU` : 'No hook');
export const cuPct = (b) => Math.min(100, (b.cu / ENGINE.cuBudget) * 100);
export const enfList = (b) => b.enforcers.map((e) => `<span class="enf ${e}" data-tip="${esc(ENFORCERS[e]?.long ?? '')}"><i></i>${esc(ENFORCERS[e]?.name ?? e)}</span>`).join('');

const arrow = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

/** A grid of rulebook cards: the rules as pixel tiles, the name, one plain line and one way in. */
export function presetCards({ compact = false, cta = 'Launch with this' } = {}) {
  return `<div class="pcards${compact ? ' compact' : ''}">${STARTERS.map((p) => `
    <a class="pcard" href="${p.href}">
      <span class="pc-mid">${miniStack(p.stack, { size: compact ? 24 : 28, gap: 4 })}</span>
      <span class="pc-top"><b>${esc(p.name)}</b><span class="pc-n">${p.stack.length} rules</span></span>
      <span class="pc-blurb">${esc(p.blurb)}</span>
      <span class="pc-go">${esc(cta)}${arrow}</span>
    </a>`).join('')}</div>`;
}
