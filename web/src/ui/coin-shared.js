// Pieces shared by the coins explorer, the coin page and the stacks leaderboard:
// mini stacks of cubes, number formats, a viewport-clamped tooltip, the family filter emblem.
import './coin-shared.css';
import { cube, EMBLEM } from './icons.js';
import { byId, ENFORCERS, hex } from '../data/blocks.js';
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

/** One block's display line for tooltips. */
export function blockTip(slot) {
  const b = byId[slot.id];
  if (!b) return slot.id;
  return `${b.name} · ${b.summary(slot.params)}`;
}

/** A row of mini chrome cubes, one per slot, each with a tooltip. */
export function miniStack(stack, { size = 22, gap, states } = {}) {
  return `<span class="mstack" style="--ms:${size}px${gap != null ? `;--mg:${gap}px` : ''}">${stack.map((s, i) => {
    const b = byId[s.id];
    if (!b) return '';
    return `<span class="mcube" data-tip="${esc(blockTip(s))}">${cube(b.family, { size, state: states?.[i] ?? '' })}</span>`;
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
