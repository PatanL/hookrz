// Pieces shared by the coins explorer, the coin page, the remixes page and the rules catalog:
// pixel rule tiles, number formats, a viewport-clamped tooltip, the family filter emblem.
import './coin-shared.css';
import { EMBLEM } from './icons.js';
import { pixelIcon } from './pixel.js';
import { byId, ENFORCERS, hex, errName } from '../data/blocks.js';
import { esc } from '../core/format.js';
import { SOL_USD } from '../data/coins.js';

export { SOL_USD };

/** "Test" chip for coins marked `test` (no contract address). */
export const testChip = (c) => (c?.test ? '<span class="tchip" data-tip="Test coin: it has no contract address">Test</span>' : '');

/** "@handle" for a shaped coin. */
export const handleOf = (c) => '@' + (c?.creatorInfo?.handle ?? c?.creator ?? '');

/** Compact token count: 8.50M, 412K, 1.2B. */
export function tok(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : 2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return a >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2);
}
/** SOL with sensible precision. */
export function sol(n, unit = true) {
  const a = Math.abs(n);
  const s = a >= 1000 ? Math.round(n).toLocaleString('en-US') : a >= 100 ? n.toFixed(1) : a >= 1 ? n.toFixed(2) : a >= 0.01 ? n.toFixed(3) : a === 0 ? '0' : n.toFixed(4);
  return unit ? `${s} SOL` : s;
}
/** Tiny USD prices: $0.00002450 */
export function usdPrice(n) {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n <= 0) return '$0';
  const d = Math.max(2, -Math.floor(Math.log10(n)) + 2);
  return `$${n.toFixed(Math.min(d, 12))}`;
}
/** Signed % that never reads below −99.9% (a price can't fall more than all the way). */
export const chg = (n) => Math.max(-99.9, n);
export const pct = (n, d = 1) => `${(n * 100).toFixed(d)}%`;

/** Short key: 7xKq…9fhk */
export const shortKey = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');

/** A signature-looking base58 string. */
export function randomSig(len = 88) {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => B58[b % 58]).join('');
}

/** One plain sentence per rule, where the catalog's tagline leans on a technical word. */
const PLAIN = {
  'anti-bundle': 'Only a couple of buys can land at the same moment, so bundles fail.',
  'blocklist': 'The creator can ban wallets from holding the coin, until the list freezes.',
  'hold-timer': 'New coins have to sit a while before they can be sold or sent.',
  'circuit-breaker': 'Trades that move the price too far, too fast are blocked.',
  'trading-hours': 'Trading opens and closes at set hours, like a stock market.',
  'lock-in': 'Buys only, until the curve is part full. Then selling opens.',
  'leftover-burn': 'Coins the curve didn\'t sell are burned when it fills.',
  'lp-lock': 'When the curve fills, its liquidity is locked for good.',
  'kingmaker': 'The biggest holder when the curve fills gets a share of fees for 30 days.',
  'custom': 'Describe any rule in plain English and hookrz writes it for you.',
};
export const plainLine = (b) => PLAIN[b.id] ?? b.tagline;

/** A rule's name in plain words (the Custom block is "your own rule"). */
export const ruleName = (b) => (b?.id === 'custom' ? 'Your own rule' : b?.name ?? '');
/** One rule's display line for tooltips: its name and what it does. */
export function blockTip(slot) {
  const b = byId[slot.id];
  if (!b) return slot.id;
  return `${ruleName(b)}: ${plainLine(b)}`;
}
/** The technical line for a rule, shown only on hover: error code, compute, who enforces it. */
export function techTip(b) {
  if (!b) return '';
  const who = [b.enforcedBy, b.also].filter(Boolean).map((e) => ENFORCERS[e].name).join(' + ');
  return [b.code != null ? `Error ${hex(b.code)} ${errName(b.code)}` : 'Never blocks a trade', b.cu ? `${b.cu.toLocaleString('en-US')} CU` : 'no compute on trades', `enforced by ${who}`].join(' · ');
}

/**
 * A pixel rule tile: the family's pixel icon on a small notched square.
 * state: '' | 'lit' (passed) | 'refused' (blocked) | 'empty' | 'off' (retired)
 */
export function pxTile(family, { size = 28, state = '', title = '' } = {}) {
  const icon = Math.max(12, Math.floor((size * 0.62) / 6) * 6);
  const accent = state === 'refused' ? '#ffb4ad' : '#8fcaff';
  return `<span class="pxt${state ? ` ${state}` : ''}" style="--pt:${size}px${size >= 40 ? ';--st:4px' : ''}"${title ? ` data-tip="${esc(title)}"` : ''}>${state === 'empty' ? '' : pixelIcon(family, { size: icon, accent })}</span>`;
}

/** A row of pixel rule tiles, one per rule, each with a tooltip. */
export function miniStack(stack, { size = 22, gap, states } = {}) {
  return `<span class="mstack" style="--ms:${size}px${gap != null ? `;--mg:${gap}px` : ''}">${stack.map((s, i) => {
    const b = byId[s.id];
    if (!b) return '';
    return `<span class="mcube" data-tip="${esc(blockTip(s))}">${pxTile(b.family, { size, state: states?.[i] ?? '' })}</span>`;
  }).join('')}</span>`;
}

/** Enforcer badges for a block (primary + secondary). */
export function enfBadges(b) {
  return [b.enforcedBy, b.also].filter(Boolean).map((e) => `<span class="enf ${e}" data-tip="${esc(ENFORCERS[e].long)}"><i></i>${ENFORCERS[e].name}</span>`).join('');
}

export const emblem = (family) => `<span class="emb">${EMBLEM[family] ?? EMBLEM.custom}</span>`;
export { hex };

// ---------- tooltip: one fixed element, clamped to the viewport ----------
let tipEl = null, tipFor = null;
export function installTips() {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.className = 'hz-tip';
  tipEl.setAttribute('role', 'tooltip');
  document.body.append(tipEl);
  const hide = () => { tipFor = null; tipEl.classList.remove('on'); };
  const show = (t) => {
    if (tipFor === t) return;
    tipFor = t;
    tipEl.textContent = t.dataset.tip;
    tipEl.classList.add('on');
    const r = t.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tipEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t && t.dataset.tip) show(t); else hide();
  });
  document.addEventListener('pointerleave', hide);
  addEventListener('scroll', hide, { passive: true });
}

/** Copy text and flash the button. */
export async function copyText(text, btn, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
  if (btn) {
    const old = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = label;
    setTimeout(() => { btn.innerHTML = old; btn.classList.remove('copied'); }, 1200);
  }
}
