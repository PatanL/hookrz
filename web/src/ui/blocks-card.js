// Rule cards for the catalog, and the small pieces the catalog and the details drawer share.
// The default view speaks plain words: a pixel icon, the rule's name and one sentence. Codes, CU, enforcers and
// routes live in the details drawer.
import { ENFORCERS, hex, familyOf } from '../data/blocks.js';
import { esc } from '../core/format.js';
import { pxTile, ruleName, plainLine } from './coin-shared.js';

/** Which transfer kinds each hook block checks (mirrors the `check` functions in data/blocks.js). */
export const CHECKS = {
  'snipe-shield': ['buy'], 'anti-bundle': ['buy'], 'max-wallet': ['buy', 'send'], 'rising-max': ['buy', 'send'],
  'sandwich-guard': ['sell'], 'blocklist': ['buy', 'sell', 'send'], 'allowlist-phase': ['buy'],
  'sell-cap': ['sell'], 'sell-cooldown': ['sell'], 'hold-timer': ['sell', 'send'], 'circuit-breaker': ['buy', 'sell'],
  'trading-hours': ['buy', 'sell'], 'seasoned-sells': ['sell'], 'outflow-cap': ['sell'], 'lock-in': ['sell'],
  'creator-vest': ['sell', 'send'], 'token-gate': ['buy', 'send'], 'chapters': ['buy'],
};

export const STATE_LABEL = { none: 'None', global: 'Stack slot', wallet: 'Wallet record' };
export const STATE_LONG = {
  none: 'Reads only the transfer itself. Nothing is stored.',
  global: 'Keeps counters in its 32-byte slot of the Stack account.',
  wallet: 'Reads and writes a per-holder Wallet record PDA ["w", mint, token account].',
};

/** Family labels in plain words (the Custom family is "your own"). */
export const FAMILY_LABEL = { guard: 'Guard', pace: 'Pace', burn: 'Burn', flow: 'Flow', crown: 'Crown', custom: 'Your own' };
export const famLabel = (id) => FAMILY_LABEL[id] ?? familyOf(id)?.name ?? id;
/** Family blurbs in plain words, where the catalog's leans on a technical word. */
const FAMILY_BLURB = { flow: 'Vesting, rewards and payouts, paid from the creator\'s fees.' };
export const famBlurb = (f) => FAMILY_BLURB[f.id] ?? f.blurb;
export function familyName(b) { return famLabel(b.family); }

export { plainLine };

export function enfBadges(b) {
  return [b.enforcedBy, b.also].filter(Boolean)
    .map((e) => `<span class="enf ${e}" title="${esc(ENFORCERS[e].long)}"><i></i>${ENFORCERS[e].name}</span>`).join('');
}

export function routeChip(b) {
  return b.route === 'record'
    ? `<span class="chip bk-route rec" title="A receiving wallet needs a Wallet record. The hookrz router opens it inside the buy.">Wallet record</span>`
    : `<span class="chip ice bk-route" title="Works on every route, aggregators included.">Any route</span>`;
}

const stripParen = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '');

/** "0.05–2% of supply", "10s–600s", "$BONK / $WIF / …" */
export function paramRange(p) {
  if (p.options) return p.options.join(' / ');
  if (p.text) return 'Plain English';
  const a = stripParen(p.fmt(p.min)), b = stripParen(p.fmt(p.max));
  for (let i = Math.min(a.length, b.length); i > 0; i--) {
    const s = a.slice(-i);
    if (s[0] === ' ' && b.endsWith(s)) return `${a.slice(0, -i)}–${b.slice(0, -i)}${s}`;
  }
  return `${a}–${b}`;
}
export const paramValue = (p, v) => (p.options || p.text ? String(v) : p.fmt(v));

/** Risk / creator power / unreviewed / never-refuses notes, in plain words. */
export function flagsHtml(b, { long = false } = {}) {
  const out = [];
  if (b.risk) out.push(`<div class="bk-flag risk"><span class="chip refuse">Heads-up</span><span>${esc(long ? b.risk : b.risk.split('. ')[0] + '.')}</span></div>`);
  if (b.power) out.push(`<div class="bk-flag warn"><span class="chip warnchip">Creator power</span><span>${long ? 'The creator can add block markers until the list freezes. The coin page shows the list and when it freezes.' : 'The creator can ban wallets until the list freezes.'}</span></div>`);
  if (b.unreviewed) out.push(`<div class="bk-flag warn"><span class="chip warnchip">Unreviewed</span><span>${long ? 'Every coin with its own rule carries this badge on its page until a reviewer signs off on the Hookscript.' : 'Badge stays until a reviewer signs off.'}</span></div>`);
  if (b.recordsOnly && long) out.push(`<div class="bk-flag"><span class="chip">Never blocks</span><span>Stamps Wallet records; the keeper pays from them.</span></div>`);
  return out.join('');
}

const go = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

/** One catalog card: pixel icon, name, one plain sentence, one way to use it. */
export function card(b) {
  const name = ruleName(b);
  const warn = b.risk ? `<p class="bk-warn risk">${esc(b.risk.split('. ')[0])}.</p>` : '';
  return `<article class="bk-card${b.id === 'custom' ? ' is-own' : ''}" data-id="${b.id}" id="b-${b.id}" data-card="${b.id}">
    ${pxTile(b.family, { size: 40 })}
    <div class="bk-body">
      <h3 class="bk-name"><button type="button" data-open="${b.id}">${esc(name)}</button></h3>
      <p class="bk-tag">${esc(plainLine(b))}</p>
      ${warn}
      <div class="bk-actions">
        <a class="bk-use" href="build.html?add=${b.id}">Use this rule${go}</a>
        <button type="button" class="bk-more" data-open="${b.id}">${b.id === 'custom' ? 'Try it here' : 'How it works'}</button>
      </div>
    </div>
  </article>`;
}

export { hex, pxTile };
