// Site chrome shared by every page: header (wordmark, nav, wallet), modal, toast, footer.
// Usage in a page module:  import { mountChrome } from '../ui/chrome.js'; mountChrome('build');
import { wordmark, asset } from './voxel.js';
import { ICON } from './icons.js';
import { connect, pick, onWallet } from '../wallet/wallet.js';

export const X_URL = 'https://x.com/hookrzfun';
export const X_HANDLE = 'hookrzfun';

export const NAV = [
  { id: 'coins', href: 'coins.html', label: 'Coins' },
  { id: 'stacks', href: 'stacks.html', label: 'Stacks' },
  { id: 'blocks', href: 'blocks.html', label: 'Blocks' },
  { id: 'build', href: 'build.html', label: 'Build' },
  { id: 'docs', href: 'docs.html', label: 'Docs' },
];

export function mountChrome(active) {
  const top = document.createElement('div');
  top.innerHTML = `
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="index.html" aria-label="hookrz home">${wordmark({ size: 3.4 })}</a>
      <nav class="nav" id="nav">${NAV.map((n) => `<a href="${n.href}" class="${n.id === active ? 'on' : ''}">${n.label}</a>`).join('')}</nav>
      <div class="header-actions">
        <a class="x-link" href="${X_URL}" target="_blank" rel="noopener" aria-label="hookrz on X (@${X_HANDLE})" title="@${X_HANDLE} on X">${ICON.x}<span>@${X_HANDLE}</span></a>
        <button class="btn btn-glass btn-sm" data-wallet-btn>Connect wallet</button>
        <a class="btn btn-chrome btn-sm" href="build.html">Build a coin</a>
        <button class="btn btn-ghost btn-sm menu-btn" aria-label="Menu" id="menuBtn">${ICON.menu}</button>
      </div>
    </div>
  </header>`;
  document.body.prepend(...top.children);
  document.getElementById('menuBtn').onclick = () => document.getElementById('nav').classList.toggle('open');

  const foot = document.createElement('footer');
  foot.className = 'site-footer';
  foot.innerHTML = `<div class="wrap"><div class="cols">
    <div class="stack" style="gap:14px"><a class="brand" href="index.html">${wordmark({ size: 3 })}</a>
      <p style="max-width:34ch">Build a coin from rule blocks. Solana runs the stack on every transfer. hookrz never holds a key.</p>
      <p class="pixel" style="font-size:10px;color:var(--text-3)">BUILD. REMIX. OWN.</p></div>
    <div><h4>Make</h4><a href="build.html">Build a coin</a><a href="blocks.html">Block catalog</a><a href="build.html#presets">Presets</a></div>
    <div><h4>Explore</h4><a href="coins.html">Coins</a><a href="stacks.html">Stacks &amp; remixes</a><a href="docs.html">Docs</a></div>
    <div><h4>Follow</h4><a href="${X_URL}" target="_blank" rel="noopener">X · @${X_HANDLE}</a><h4 style="margin-top:20px">Under the hood</h4><a href="docs.html#engine">The engine</a><a href="docs.html#api">API contract</a><a href="docs.html#trust">Trust model</a></div>
  </div><hr class="hr" style="margin:32px 0 18px"><div class="row between wrap-row" style="gap:12px"><span>© 2026 hookrz · hookrz.fun</span><span class="mono">Token-2022 transfer hooks · Meteora DBC</span></div></div>`;
  document.body.append(foot);

  bindWalletButtons();
}

/** Every [data-wallet-btn] on the page shows the wallet state and opens the picker (src/wallet/wallet.js). */
export function bindWalletButtons(root = document) {
  const btns = [...root.querySelectorAll('[data-wallet-btn]')];
  onWallet((addr) => {
    for (const b of btns) {
      if (addr) { b.innerHTML = `<span class="dot"></span><span class="mono">${addr.slice(0, 4)}…${addr.slice(-4)}</span>`; b.title = 'Wallet: switch, copy or disconnect'; }
      else { if (b.dataset.label) b.textContent = b.dataset.label; else b.innerHTML = '<span>Connect<span class="hide-sm"> wallet</span></span>'; b.title = ''; }
    }
  });
  for (const b of btns) b.onclick = () => pick().then((h) => toast(`Connected ${h.name}`)).catch(() => {});
}

/** The connected wallet handle, opening the picker if needed. Resolves null if the visitor closes it. */
export async function requireWallet() {
  try { return await connect(); } catch { return null; }
}

/** Minimal modal. render(el, close) wires up the content. */
export function modal(html, render) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal panel" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Close">${ICON.stop}</button>${html}</div>`;
  document.body.append(back);
  const el = back.querySelector('.modal');
  const close = () => { el.dispatchEvent(new Event('modal-close')); back.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelector('.modal-x').onclick = close;
  render?.(el, close);
  return { el, close };
}

let toastTimer;
export function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast fade-in';
  t.textContent = text;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

export { asset };
