// Block cards and the small pieces the catalog and the details drawer share.
import { cube } from './icons.js';
import { ENFORCERS, hex, familyOf } from '../data/blocks.js';
import { esc } from '../core/format.js';

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

/** Risk / power / unreviewed / never-refuses flags. */
export function flagsHtml(b, { long = false } = {}) {
  const out = [];
  if (b.risk) out.push(`<div class="bk-flag risk"><span class="chip refuse">Risk</span><span>${esc(long ? b.risk : b.risk.split('. ')[0] + '.')}</span></div>`);
  if (b.power) out.push(`<div class="bk-flag warn"><span class="chip warnchip">Creator power</span><span>${long ? 'The creator can add block markers until the list freezes. The coin page shows the list and when it freezes.' : 'The creator can add markers until the list freezes.'}</span></div>`);
  if (b.unreviewed) out.push(`<div class="bk-flag warn"><span class="chip warnchip">Unreviewed</span><span>${long ? 'Every custom block carries this badge on its coin page until a reviewer signs off on the Hookscript.' : 'Badge stays until a reviewer signs off.'}</span></div>`);
  if (b.recordsOnly) out.push(`<div class="bk-flag"><span class="chip">Never refuses</span><span>Stamps Wallet records; the keeper pays from them.</span></div>`);
  return out.join('');
}

export function familyName(b) { return familyOf(b.family)?.name ?? b.family; }

/** One catalog card. */
export function card(b) {
  const hook = b.enforcedBy === 'hook';
  const params = b.params.length
    ? `<dl class="bk-params">${b.params.map((p) => `<div><dt>${esc(p.label)}</dt><dd><span class="mono">${esc(paramRange(p))}</span></dd></div>`).join('')}</dl>`
    : `<p class="bk-noparams dim">No settings. Add it and it's on.</p>`;
  return `<article class="bk-card${hook ? ' is-hook' : ''}" data-id="${b.id}" id="b-${b.id}">
    <button class="bk-head" data-open="${b.id}" aria-label="${esc(b.name)}: details">
      ${cube(b.family, { size: 46 })}
      <span class="bk-title"><span class="bk-name">${esc(b.name)}</span><span class="bk-famlabel pixel">${esc(familyName(b))}</span></span>
      ${b.code == null ? '<span></span>' : `<span class="bk-code mono" title="Custom error code when refused">${hex(b.code)}</span>`}
    </button>
    <p class="bk-tag">${esc(b.tagline)}</p>
    <div class="bk-badges">${enfBadges(b)}${routeChip(b)}</div>
    ${params}
    <div class="bk-meta">
      <div><span>CU</span><b class="num${b.cu ? '' : ' zero'}">${b.cu ? b.cu.toLocaleString('en-US') : '0'}</b></div>
      <div><span>Accounts</span><b class="num${b.accts ? '' : ' zero'}">+${b.accts}</b></div>
      <div><span>State</span><b>${STATE_LABEL[b.state]}</b></div>
    </div>
    ${b.risk || b.power || b.unreviewed || b.recordsOnly ? `<div class="bk-flags">${flagsHtml(b)}</div>` : ''}
    <div class="bk-actions">
      <a class="btn btn-glass btn-sm" href="build.html?add=${b.id}">Add to a stack</a>
      <button class="btn btn-ghost btn-sm" data-open="${b.id}">Details <span aria-hidden="true">→</span></button>
    </div>
  </article>`;
}
