// Build page: the launch flow — Details → Review → Sign — and the success screen.
// Sign uses the real wallet (Wallet Standard picker in src/wallet/wallet.js): the creator signs a
// human-readable launch manifest, then api.submitLaunch relays the launch.
import { api } from '../api/client.js';
import { FEES } from '../api/contract.js';
import { byId, ENGINE } from '../data/blocks.js';
import { evaluate, feeAt, largestAllowed, normalize } from '../engine/engine.js';
import { Curve, SUPPLY } from '../engine/sim.js';
import { connect, pick, onWallet, address } from '../wallet/wallet.js';
import { cube, ICON } from './icons.js';
import { avatar } from './avatar.js';
import { esc } from '../core/format.js';
import { secHead } from './build-sim.js';
import { enfBadges, summaryOf } from './build-rack.js';

const STEPS = ['Details', 'Review', 'Sign'];
const MAX_IMG = 1024 * 1024;
const NET_FEE = 0.00001; // two signatures (creator + mint keypair) at 5,000 lamports
const short = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
const normUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export function validate(m) {
  const e = {};
  const name = m.name.trim();
  if (!name) e.name = 'Give your coin a name.';
  else if (name.length > 32) e.name = 'Keep the name to 32 characters.';
  if (!m.ticker) e.ticker = 'Pick a ticker.';
  else if (!/^[A-Z0-9]{1,10}$/.test(m.ticker)) e.ticker = 'Use A–Z and 0–9 only, up to 10 characters.';
  if (m.desc.length > 280) e.desc = 'Keep the description to 280 characters.';
  const x = m.x.trim(), tg = m.tg.trim(), web = m.web.trim();
  if (x && !/^(@?[A-Za-z0-9_]{1,15}|(https?:\/\/)?(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?)$/i.test(x)) e.x = 'Use @handle or an x.com link.';
  if (tg && !/^(@?[A-Za-z0-9_]{5,32}|(https?:\/\/)?(t|telegram)\.me\/\+?[A-Za-z0-9_-]{3,64}\/?)$/i.test(tg)) e.tg = 'Use a t.me link or @group.';
  if (web) { try { const u = new URL(normUrl(web)); if (!u.hostname.includes('.')) throw 0; } catch { e.web = 'Use a full link, like https://yourcoin.xyz'; } }
  if (m.buy !== '' && m.buy != null) { const b = +m.buy; if (!Number.isFinite(b) || b < 0) e.buy = 'Enter an amount in SOL.'; else if (b > 50) e.buy = 'The creator buy is capped at 50 SOL.'; }
  return e;
}

/** Would the stack refuse the creator's own launch buy? Same engine code the chain runs. */
export function creatorBuyCheck(stack, solIn) {
  const amt = +solIn;
  if (!amt) return null;
  const c = new Curve(), fee = feeAt(stack, 0);
  const ctxFor = (s) => {
    const q = c.quoteBuy(s, fee);
    return { kind: 'buy', amount: q.out, supply: SUPPLY, t: 0, slot: 0, hour: new Date().getUTCHours(), progress: 0, priceAfter: q.nv / q.nt, windowOpenPrice: c.price,
      srcBefore: 0, dstAfter: q.out, isCreatorSrc: false, isCreator: true, w: { lots: [], lastBuySlot: null, lastSellT: null, firstT: null },
      slotBuys: 0, hourSold: 0, hasPass: true, gateBal: Infinity, blocked: false };
  };
  const q = c.quoteBuy(amt, fee);
  const v = evaluate(stack, ctxFor(amt));
  const out = { tokens: q.out, share: q.out / SUPPLY, fee, ok: v.ok };
  if (!v.ok) { out.by = v.refusedBy; out.code = v.code; out.msg = v.message; out.max = largestAllowed(stack, ctxFor, amt); }
  return out;
}

export function createLaunch({ S, root, paint, plain, sig, ctx, save, clearDraft, toast, onReset }) {
  const L = S.launch;
  let addr = address, handle = null, prepT = null, prepBusy = false, prepFail = false;
  onWallet((a) => { addr = a; if (!a) handle = null; if (L.step === 2 && !L.busy && !L.done) render(); });

  function render() { paint(root, html()); }

  function html() {
    const c = ctx();
    return `<div class="sec-head">${secHead('03', 'Launch', 'Launch it', 'One transaction creates the mint, the curve and your stack, and arms the rules before anyone else can trade. You sign; hookrz never holds a key.')}</div>
    ${L.done ? doneHTML() : `
    <ol class="steps" aria-label="Launch steps">${STEPS.map((s, i) => `<li class="${i === L.step ? 'on' : i < L.step ? 'done' : ''}">
      ${i < L.step ? `<button class="st" data-l="go" data-to="${i}" data-fk="st-${i}">` : `<span class="st" ${i === L.step ? 'aria-current="step"' : ''}>`}<span class="st-n mono">${i < L.step ? ICON.check : i + 1}</span><span class="st-l">${s}</span>${i < L.step ? '</button>' : '</span>'}</li>`).join('<li class="st-sep" aria-hidden="true"></li>')}</ol>
    <div class="lp panel">${[detailsHTML, reviewHTML, signHTML][L.step](c)}</div>`}`;
  }

  // ───── step 1: details
  function detailsHTML(c) {
    const m = L.meta, e = L.errs;
    const f = (k, label, input, hint = '') => `<div class="field${e[k] ? ' bad' : ''}"><label for="lf-${k}">${label}</label>${input}${e[k] ? `<span class="ferr" id="le-${k}" role="alert">${esc(e[k])}</span>` : hint ? `<span class="fhint">${hint}</span>` : ''}</div>`;
    const inp = (k, ph, extra = '') => `<input class="input" id="lf-${k}" data-f="${k}" data-fk="lf-${k}" value="${esc(m[k])}" placeholder="${ph}" ${e[k] ? `aria-invalid="true" aria-describedby="le-${k}"` : ''} ${extra}>`;
    return `<div class="lp-grid">
      <div class="lp-form">
        <div class="frow">
          ${f('name', 'Name', inp('name', 'Lure Two', 'maxlength="32" autocomplete="off"'))}
          ${f('ticker', 'Ticker', `<div class="tick"><span class="mono">$</span>${inp('ticker', 'LURE2', 'maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false"')}</div>`, 'A–Z and 0–9, up to 10.')}
        </div>
        ${f('desc', `Description <span class="cnt mono" data-cnt>${m.desc.length}/280</span>`, `<textarea class="input" id="lf-desc" data-f="desc" data-fk="lf-desc" rows="3" maxlength="280" placeholder="What the coin is, in a sentence or two.">${esc(m.desc)}</textarea>`)}
        <div class="frow three">
          ${f('x', 'X', inp('x', '@yourcoin', 'autocomplete="off" spellcheck="false"'))}
          ${f('tg', 'Telegram', inp('tg', 't.me/yourcoin', 'autocomplete="off" spellcheck="false"'))}
          ${f('web', 'Website', inp('web', 'https://yourcoin.xyz', 'type="url" autocomplete="off" spellcheck="false"'))}
        </div>
        ${f('buy', 'Creator first buy <span class="dim">(optional)</span>', `<div class="tick sol">${inp('buy', '0.5', 'inputmode="decimal" autocomplete="off"')}<span class="mono">SOL</span></div>`)}
        <div class="buycheck" data-buycheck>${buyCheckHTML()}</div>
      </div>
      <div class="lp-side">
        <div class="img-drop${m.image ? ' has' : ''}${e.image ? ' bad' : ''}" data-drop>
          <input type="file" id="lf-img" class="sr" accept="image/png,image/jpeg,image/gif,image/webp" data-fk="lf-img">
          ${m.image ? `<img src="${esc(m.image)}" alt="Your coin image">` : `<span class="img-ph">${cube('custom', { size: 40, state: 'empty' })}<b>Coin image</b><span>PNG, JPG, GIF or WebP · up to 1 MB · shown square</span></span>`}
          <label for="lf-img" class="btn btn-glass btn-sm img-btn">${m.image ? 'Replace' : 'Upload image'}</label>
          ${m.image ? '<button class="btn btn-ghost btn-sm img-x" data-l="noimg">Remove</button>' : ''}
        </div>
        ${e.image ? `<span class="ferr" role="alert">${esc(e.image)}</span>` : ''}
        <div class="coin-pv" data-pv>${previewHTML(c)}</div>
      </div>
    </div>
    ${blockersHTML(c)}
    <div class="lp-foot"><span class="dim">Saved on this device as you type.</span><button class="btn btn-chrome" data-l="next" data-fk="l-next" ${prepBusy ? 'disabled' : ''}>${prepBusy ? '<span class="spin"></span>Checking…' : `Review launch ${ICON.arrow}`}</button></div>`;
  }

  function buyCheckHTML() {
    const r = creatorBuyCheck(plain(), L.meta.buy);
    if (!r) return '<span class="dim">Bought in the launch transaction, after the rules are armed. Snipe Shield and Anti-Bundle exempt it; every other block checks it like any buy.</span>';
    const tok = `${(r.tokens / 1e6).toFixed(1)}M tokens · ${(r.share * 100).toFixed(2)}% of supply${r.fee > 1 ? ` · ${r.fee.toFixed(0)}% launch fee` : ''}`;
    if (r.ok) return `<span class="bc ok"><i class="dot"></i>Passes the stack · <span class="mono">${tok}</span></span>`;
    const b = byId[r.by];
    return `<span class="bc bad"><i class="dot refuse"></i><b>${esc(b.name)}</b> would refuse this buy <span class="mono">${b.code != null ? `(0x${b.code.toString(16)})` : ''}</span>: ${esc(r.msg)}. ${r.max > 0.001 ? `Largest that passes now: <button class="link mono" data-l="maxbuy" data-v="${Math.floor(r.max * 1000) / 1000}">${(Math.floor(r.max * 1000) / 1000).toFixed(3)} SOL</button>` : 'Lower it or skip the creator buy.'}</span>`;
  }

  function previewHTML(c) {
    const m = L.meta, T = m.ticker || 'TICKER';
    const st = plain();
    return `<div class="pv-top">${avatar({ ticker: T, image: m.image }, 52)}<div><b class="pv-name">${esc(m.name || 'Your coin')}</b><span class="mono pv-t">$${esc(T)}</span></div><span class="chip ice">On the curve</span></div>
      <p class="pv-desc">${esc(m.desc || 'Your description shows here, on the coin page and in every list.')}</p>
      <div class="pv-stack">${st.length ? st.map((s) => cube(byId[s.id].family, { size: 22, title: byId[s.id].name })).join('') : '<span class="dim">No blocks yet</span>'}<span class="mono dim">${st.length} block${st.length === 1 ? '' : 's'}${S.parent ? ` · remix of $${esc(S.parent.ticker)}` : ''}</span></div>
      ${c.ok ? '' : '<span class="pv-warn">Stack has issues to fix</span>'}`;
  }

  function blockersHTML(c) {
    const bad = c.warnings.filter((w) => w.level === 'error' || w.level === 'need');
    if (!bad.length) return '';
    return `<div class="blockers" role="alert"><b>Fix the stack before you launch</b><ul>${bad.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul><button class="btn btn-glass btn-sm" data-act="toRack">Back to the rack</button></div>`;
  }

  // ───── step 2: review
  function reviewHTML(c) {
    const m = L.meta, st = normalize(plain()), P = L.prep;
    if ((!P || L.prepSig !== prepKey()) && !prepFail) queuePrep();
    const buy = +m.buy || 0;
    const ixs = P?.instructions ?? [];
    const links = [m.x && ['X', m.x], m.tg && ['Telegram', m.tg], m.web && ['Website', m.web]].filter(Boolean);
    const cost = P ? P.rentSol + P.launchCostSol + buy + NET_FEE : 0;
    return `<div class="lp-grid review">
      <div class="rv-main">
        <div class="rv-coin">${avatar({ ticker: m.ticker, image: m.image }, 56)}<div><b>${esc(m.name)}</b> <span class="mono dim">$${esc(m.ticker)}</span><p class="muted">${esc(m.desc || 'No description.')}</p>
          ${links.length ? `<div class="rv-links">${links.map(([k, v]) => `<span><span class="dim">${k}</span> <span class="mono">${esc(v)}</span></span>`).join('')}</div>` : ''}</div>
          <button class="btn btn-ghost btn-sm" data-l="go" data-to="0">Edit</button></div>
        <div class="rv-sec"><div class="rv-h"><span class="pixel">Stack</span><span class="mono dim">${st.length}/${ENGINE.maxSlots} slots${S.parent ? ` · parent $${esc(S.parent.ticker)} by @${esc(S.parent.handle)}` : ' · original'}</span><button class="link" data-act="toRack">Edit stack</button></div>
          <ol class="rv-stack">${st.map((s, i) => { const b = byId[s.id]; return `<li><span class="mono dim">${String(i + 1).padStart(2, '0')}</span>${cube(b.family, { size: 26 })}<span class="rv-b"><b>${b.name}</b><span class="mono">${esc(summaryOf(s))}</span></span><span class="rv-e">${enfBadges(b)}</span></li>`; }).join('')}</ol></div>
        <div class="rv-sec"><div class="rv-h"><span class="pixel">Launch transaction</span><span class="mono dim">${P ? `${ixs.length} instructions · one transaction` : 'Building…'}</span></div>
          ${P ? `<ol class="ixs">${ixs.map((x, i) => { const skip = /optional/.test(x.ix) && !buy; return `<li class="${skip ? 'skip' : ''}"><span class="ix-n mono">${i + 1}</span><div><div class="ix-top"><span class="chip">${esc(x.program)}</span><code class="mono">${esc(x.ix.replace(' (optional)', ''))}</code>${skip ? '<span class="dim ix-s">not included: no creator buy</span>' : /optional/.test(x.ix) ? `<span class="mono ix-s">${buy} SOL</span>` : ''}</div><p>${esc(x.note)}</p></div></li>`; }).join('')}</ol>` : '<div class="skel"><i></i><i></i><i></i><i></i></div>'}
        </div>
      </div>
      <div class="rv-side">
        ${P ? `<div class="rv-card">
          <div class="mt-top"><span>Transaction size</span><span class="mono"><b>${P.txBytes.toLocaleString('en-US')}</b> / ${P.txLimit.toLocaleString('en-US')} bytes</span></div>
          <div class="mt-bar tx${P.txBytes > P.txLimit ? ' over' : ''}" role="meter" aria-label="Transaction size" aria-valuemin="0" aria-valuemax="${P.txLimit}" aria-valuenow="${P.txBytes}"><i class="seg" style="width:${Math.min(100, (P.txBytes / P.txLimit) * 100)}%"></i></div>
          <div class="mt-foot mono">${P.txLimit - P.txBytes} bytes to spare · fits one transaction</div>
        </div>
        <div class="rv-card"><div class="sub pixel">Cost</div><dl class="cost">
          <div><dt>Stack rent</dt><dd class="mono">${P.rentSol.toFixed(4)} SOL</dd></div>
          <div><dt>Launch cost</dt><dd class="mono">${P.launchCostSol.toFixed(4)} SOL</dd></div>
          <div><dt>Creator buy</dt><dd class="mono">${buy ? `${buy} SOL` : '—'}</dd></div>
          <div><dt>Network fee</dt><dd class="mono">~${NET_FEE.toFixed(5)} SOL</dd></div>
          <div class="tot"><dt>Total</dt><dd class="mono">${cost.toFixed(4)} SOL</dd></div></dl>
          <p class="fhint">Stack rent comes back if the Stack account is ever closed. Signers: ${P.signers.join(' + ')}.</p></div>
        <div class="rv-card"><div class="sub pixel">Fee split · ${FEES.tradeFeePct}% of every trade</div>
          <ul class="mini-fees">${FEES.split.map((f, i) => `<li class="${i === 2 ? 'roy' : ''}"><span>${f.who}</span><span class="mono">${f.pct}%</span><span class="to">${i === 0 ? 'You' : i === 1 ? 'hookrz' : S.parent ? `@${esc(S.parent.handle)}` : 'You'}</span></li>`).join('')}</ul></div>
        <div class="rv-card mint"><span class="dim">Mint address</span><span class="mono">${esc(short(P.mint))}</span></div>` : '<div class="skel tall"><i></i><i></i><i></i></div>'}
      </div>
    </div>
    ${blockersHTML(c)}
    <div class="lp-foot"><button class="btn btn-ghost" data-l="go" data-to="0">Back</button><button class="btn btn-chrome" data-l="next" data-fk="l-next2" ${P && c.ok ? '' : 'disabled'}>Continue to sign ${ICON.arrow}</button></div>`;
  }

  // ───── step 3: sign
  function signHTML(c) {
    const busy = L.busy, err = L.err;
    return `<div class="lp-grid sign">
      <div class="sg-main">
        <div class="wbox${addr ? ' on' : ''}">
          ${addr ? `<span class="dot"></span><div><span class="dim">Creator wallet${handle ? ` · ${esc(handle.name)}` : ''}</span><b class="mono">${esc(addr)}</b></div><button class="btn btn-ghost btn-sm" data-l="switch" data-fk="l-switch">Switch</button>`
            : `<span class="wb-ico">${ICON.lock}</span><div><b>Connect the creator wallet</b><span class="dim">Phantom, Solflare, Backpack or any Wallet Standard wallet.</span></div><button class="btn btn-chrome" data-l="connect" data-fk="l-connect">Connect wallet</button>`}
        </div>
        <div class="manifest"><div class="rv-h"><span class="pixel">Launch manifest</span><span class="mono dim">what your wallet signs</span></div>
          <pre class="mono">${esc(manifest(addr ?? '(connect a wallet)', '(time of signing)'))}</pre></div>
      </div>
      <div class="sg-side">
        <ol class="flow">
          <li class="${busy === 'wallet' ? 'now' : busy === 'submit' ? 'done' : ''}"><b>Sign the manifest</b><span>Your wallet signs the exact name, ticker, stack and parent above. It moves no SOL.</span></li>
          <li class="${busy === 'submit' ? 'now' : ''}"><b>Launch</b><span>hookrz relays the launch transaction: mint, curve, Stack and ExtraAccountMetaList${+L.meta.buy ? ', then your first buy' : ''}, in that order.</span></li>
          <li><b>Live</b><span>The coin page opens with the stack armed. Hook blocks refuse from the first trade.</span></li>
        </ol>
        ${err ? `<div class="sg-err ${err.kind}" role="alert"><b>${esc(err.title)}</b><span>${esc(err.text)}</span>${err.kind === 'nosign' ? '<button class="btn btn-glass btn-sm" data-l="switch">Use another wallet</button>' : ''}</div>` : ''}
      </div>
    </div>
    ${blockersHTML(c)}
    <div class="lp-foot"><button class="btn btn-ghost" data-l="go" data-to="1" ${busy ? 'disabled' : ''}>Back</button>
      <button class="btn btn-chrome btn-lg" data-l="sign" data-fk="l-sign" ${busy || !c.ok ? 'disabled' : ''}>${busy === 'wallet' ? '<span class="spin"></span>Approve in your wallet…' : busy === 'submit' ? '<span class="spin"></span>Launching…' : err?.kind === 'rejected' ? 'Try again' : addr ? 'Sign &amp; launch' : 'Connect &amp; sign'}${busy ? '' : ICON.arrow}</button></div>`;
  }

  function manifest(creator, when) {
    const m = L.meta, st = normalize(plain());
    const lines = [
      'hookrz launch',
      `name: ${m.name.trim()}`,
      `ticker: $${m.ticker}`,
      `creator: ${creator}`,
      ...(S.parent ? [`parent: $${S.parent.ticker} (stack by @${S.parent.handle})`] : ['parent: none (original stack)']),
      'stack:',
      ...st.map((s, i) => `  ${i + 1}. ${s.id} ${JSON.stringify(s.id === 'custom' ? { prompt: s.params.prompt, hookscript: S.stack[i]?.draft ? `${S.stack[i].draft.ops} ops` : null } : s.params)}`),
      ...(m.buy && +m.buy ? [`creator buy: ${+m.buy} SOL`] : []),
      ...(L.prep?.mint ? [`mint: ${L.prep.mint}`] : []),
      `issued: ${when}`,
    ];
    return lines.join('\n');
  }

  function doneHTML() {
    const d = L.done, link = new URL(`coin.html?t=${encodeURIComponent(d.ticker)}`, location.href).href;
    const text = `$${d.ticker} is live on hookrz: ${d.stack.length} rule block${d.stack.length === 1 ? '' : 's'} the chain enforces on every transfer.`;
    return `<div class="launched panel">
      <div class="done-glow" aria-hidden="true"></div>
      <div class="done-av">${avatar({ ticker: d.ticker, image: d.image }, 96)}</div>
      <span class="eyebrow">Launched</span>
      <h2 class="chrome-text">Your coin is live</h2>
      <p class="lede"><b>${esc(d.name)}</b> <span class="mono">$${esc(d.ticker)}</span> is on the curve with ${d.stack.length} block${d.stack.length === 1 ? '' : 's'} armed${d.parent ? `, remixed from $${esc(d.parent)}` : ''}.</p>
      <div class="done-stack">${d.stack.map((s) => cube(byId[s.id].family, { size: 30, state: 'lit', title: byId[s.id].name })).join('')}</div>
      <dl class="done-kv"><div><dt>Mint</dt><dd class="mono">${esc(short(d.mint))}</dd></div><div><dt>Signature</dt><dd class="mono">${esc(short(d.signature))}</dd></div><div><dt>Creator</dt><dd class="mono">${esc(short(d.creator))}</dd></div></dl>
      <div class="done-go">
        <a class="btn btn-chrome btn-lg" href="coin.html?t=${encodeURIComponent(d.ticker)}">Open $${esc(d.ticker)} ${ICON.arrow}</a>
        <button class="btn btn-glass btn-lg" data-l="copy" data-link="${esc(link)}">${ICON.copy} Copy link</button>
        <a class="btn btn-glass btn-lg" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}">${ICON.x} Share on X</a>
      </div>
      <button class="link done-again" data-l="again">Build another coin</button>
    </div>`;
  }

  // ───── behaviour
  const prepKey = () => `${sig()}|${L.meta.buy}|${L.meta.ticker}`;
  function queuePrep() {
    clearTimeout(prepT);
    prepT = setTimeout(async () => {
      const key = prepKey();
      try {
        const P = await api.prepareLaunch({ meta: metaOut(), stack: plain(), creator: addr ?? undefined });
        if (key !== prepKey()) return queuePrep();
        L.prep = P; L.prepSig = key; prepFail = false;
      } catch (e) { prepFail = true; toast(`Couldn't build the launch transaction: ${e?.message || 'try again'}`); }
      if (L.step >= 1 && !L.done) render();
    }, 250);
  }
  const metaOut = () => {
    const m = L.meta;
    return { name: m.name.trim(), ticker: m.ticker, desc: m.desc.trim(), image: m.image, links: { x: m.x.trim() || null, telegram: m.tg.trim() || null, website: m.web.trim() ? normUrl(m.web.trim()) : null }, creatorBuySol: +m.buy || 0 };
  };

  async function next() {
    if (L.step === 0) {
      L.errs = validate(L.meta);
      if (!Object.keys(L.errs).length && !ctx().ok) { render(); root.querySelector('.blockers')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (!L.errs.ticker && L.meta.ticker) {
        prepBusy = true; render();
        const taken = await api.coin(L.meta.ticker).catch(() => null);
        prepBusy = false;
        if (taken) L.errs.ticker = `$${L.meta.ticker} is taken. Pick another ticker.`;
      }
      if (Object.keys(L.errs).length) { render(); root.querySelector('[aria-invalid="true"]')?.focus(); return; }
      L.step = 1; L.prep = null; prepFail = false; render(); focusTop();
    } else if (L.step === 1) {
      if (!L.prep || !ctx().ok) return;
      L.step = 2; L.err = null; render(); focusTop();
    }
  }
  function focusTop() { root.querySelector('.steps')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); root.querySelector('.steps .on .st')?.focus?.({ preventScroll: true }); }

  async function doConnect() {
    try { handle = await connect(); addr = address ?? addr; L.err = null; } catch { /* closed the picker */ }
    render();
  }
  async function doSwitch() {
    try { handle = await pick(); addr = address ?? addr; L.err = null; } catch { /* kept the old one */ }
    render();
  }

  async function sign() {
    if (L.busy) return;
    if (!ctx().ok) { render(); return; }
    L.err = null;
    try { handle = await connect(); addr = address ?? addr; } catch { L.err = { kind: 'nowallet', title: 'No wallet connected', text: 'Connect a wallet to sign the launch. If you don\'t have one, the picker links to Phantom, Solflare and Backpack.' }; render(); return; }
    if (typeof handle?.signMessage !== 'function') { L.err = nosign(handle); render(); return; }
    L.busy = 'wallet'; render();
    const text = manifest(addr, new Date().toISOString());
    let signature;
    try { signature = await handle.signMessage(new TextEncoder().encode(text)); }
    catch (e) {
      const msg = String(e?.message ?? e ?? '');
      L.busy = false;
      if (/can't sign messages|not supported|signMessage is not|unsupported/i.test(msg)) L.err = nosign(handle);
      else if (e?.code === 4001 || /reject|denied|declin|cancel|closed|abort|dismiss/i.test(msg)) L.err = { kind: 'rejected', title: 'Signature declined', text: 'You declined the request in your wallet. Nothing was sent and nothing was charged. Sign again when you\'re ready.' };
      else L.err = { kind: 'fail', title: 'The wallet didn\'t sign', text: msg || 'Something went wrong in the wallet. Try again.' };
      render(); return;
    }
    L.busy = 'submit'; render();
    try {
      const r = await api.submitLaunch({ meta: metaOut(), stack: plain(), parent: S.parent?.ticker ?? null, prepared: { ...L.prep, manifest: text, manifestSignature: signature ? Array.from(signature) : null, creator: addr } });
      L.done = { ticker: r.ticker, signature: r.signature, name: L.meta.name.trim(), image: L.meta.image, mint: L.prep?.mint, creator: addr, stack: plain(), parent: S.parent?.ticker ?? null };
      clearDraft();
    } catch (e) {
      L.err = { kind: 'fail', title: 'Launch not sent', text: `${e?.message || 'The launch did not go through.'} Nothing was charged; try again.` };
    }
    L.busy = false;
    render();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const nosign = (h) => ({ kind: 'nosign', title: `${h?.name ?? 'This wallet'} can't sign messages`, text: 'hookrz asks the creator to sign the launch manifest so the stack and metadata are provably yours. Phantom, Solflare and Backpack support it; switch to one of them to launch.' });

  function readImage(file) {
    delete L.errs.image;
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) { L.errs.image = 'Use a PNG, JPG, GIF or WebP image.'; render(); return; }
    if (file.size > MAX_IMG) { L.errs.image = `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is 1 MB.`; render(); return; }
    const fr = new FileReader();
    fr.onload = () => { L.meta.image = fr.result; save(); render(); };
    fr.onerror = () => { L.errs.image = 'Couldn\'t read that file. Try another.'; render(); };
    fr.readAsDataURL(file);
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-l]');
    if (!el || el.disabled) return;
    const a = el.dataset.l;
    if (a === 'next') next();
    else if (a === 'go') { const to = +el.dataset.to; if (to < L.step && !L.busy) { L.step = to; L.err = null; render(); focusTop(); } }
    else if (a === 'connect') doConnect();
    else if (a === 'switch') doSwitch();
    else if (a === 'sign') sign();
    else if (a === 'noimg') { L.meta.image = null; save(); render(); }
    else if (a === 'maxbuy') { L.meta.buy = el.dataset.v; save(); render(); root.querySelector('#lf-buy')?.focus(); }
    else if (a === 'copy') {
      const link = el.dataset.link;
      (navigator.clipboard?.writeText(link) ?? Promise.reject()).then(() => toast('Link copied.'), () => toast(link));
    } else if (a === 'again') { L.done = null; L.step = 0; L.err = null; L.prep = null; L.errs = {}; L.meta = { name: '', ticker: '', desc: '', image: null, x: '', tg: '', web: '', buy: '' }; onReset(); }
  });
  root.addEventListener('input', (e) => {
    const el = e.target, k = el.dataset.f;
    if (!k) return;
    if (k === 'ticker') {
      const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      if (v !== el.value) { const p = el.selectionStart - (el.value.length - v.length); el.value = v; el.setSelectionRange(Math.max(0, p), Math.max(0, p)); }
    }
    if (k === 'buy') el.value = el.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    L.meta[k] = el.value;
    if (L.errs[k]) { delete L.errs[k]; const fld = el.closest('.field'); fld?.classList.remove('bad'); fld?.querySelector('.ferr')?.remove(); el.removeAttribute('aria-invalid'); }
    if (k === 'desc') { const cn = root.querySelector('[data-cnt]'); if (cn) cn.textContent = `${el.value.length}/280`; }
    if (k === 'buy') { const bc = root.querySelector('[data-buycheck]'); if (bc) bc.innerHTML = buyCheckHTML(); }
    const pv = root.querySelector('[data-pv]'); if (pv) pv.innerHTML = previewHTML(ctx());
    save();
  });
  root.addEventListener('focusout', (e) => {
    const k = e.target.dataset?.f;
    if (!k || L.step !== 0 || !L.meta[k]) return;
    const err = validate(L.meta)[k];
    if (err && !L.errs[k]) { L.errs[k] = err; const fld = e.target.closest('.field'); if (fld && !fld.querySelector('.ferr')) { fld.classList.add('bad'); fld.querySelector('.fhint')?.remove(); fld.insertAdjacentHTML('beforeend', `<span class="ferr" id="le-${k}" role="alert">${esc(err)}</span>`); e.target.setAttribute('aria-invalid', 'true'); } }
  });
  root.addEventListener('change', (e) => { if (e.target.id === 'lf-img') { readImage(e.target.files?.[0]); e.target.value = ''; } });
  root.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (d && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); d.classList.add('over'); } });
  root.addEventListener('dragleave', (e) => { e.target.closest?.('[data-drop]')?.classList.remove('over'); });
  root.addEventListener('drop', (e) => { const d = e.target.closest('[data-drop]'); if (d && e.dataTransfer?.files?.length) { e.preventDefault(); d.classList.remove('over'); readImage(e.dataTransfer.files[0]); } });

  return {
    render,
    /** The stack changed in the rack: refresh what the launch flow shows about it. */
    stackChanged() {
      if (L.done) return;
      if (L.step === 0) {
        const pv = root.querySelector('[data-pv]'); if (pv) pv.innerHTML = previewHTML(ctx());
        const bc = root.querySelector('[data-buycheck]'); if (bc) bc.innerHTML = buyCheckHTML();
        const c = ctx(), bl = root.querySelector('.blockers'), html = blockersHTML(c);
        if (bl && !html) bl.remove(); else if (bl) bl.outerHTML = html;
      } else { L.prep = null; prepFail = false; if (L.step === 2 && !L.busy) { L.step = 1; L.err = null; } if (!L.busy) render(); }
    },
  };
}
