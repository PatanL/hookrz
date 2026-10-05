// Starter stacks (PRESETS) for the explorer's empty state, the coin page's not-found state and the
// stacks page. Each one links to Build with the preset loaded (build.html?preset=<id>).
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

/** A grid of preset cards. */
export function presetCards({ compact = false } = {}) {
  return `<div class="pcards${compact ? ' compact' : ''}">${STARTERS.map((p) => `
    <a class="pcard" href="${p.href}">
      <span class="pc-top"><b>${esc(p.name)}</b><span class="pc-n num">${p.stack.length} blocks</span></span>
      <span class="pc-blurb">${esc(p.blurb)}</span>
      <span class="pc-mid">${miniStack(p.stack, { size: compact ? 20 : 24, gap: 4 })}</span>
      <span class="pc-cu"><span class="pc-cu-l"><span class="pk">Per transfer</span><span class="num">${cuLabel(p.budget)}</span></span><span class="pc-bar" data-tip="${esc(cuLabel(p.budget))} of the engine's ${ENGINE.cuBudget.toLocaleString('en-US')} CU per transfer"><i style="width:${cuPct(p.budget)}%"></i></span></span>
      <span class="pc-go">Start from this stack${arrow}</span>
    </a>`).join('')}</div>`;
}
