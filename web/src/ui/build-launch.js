// Launch page, steps 2 and 3: the coin form (name, ticker, image, description, links, optional first buy), then
// "Review and launch" (a plain summary, the cost, the wallet, one button), and the success screen. The page owns the
// step (S.view.step); this module renders steps 2–3 into its root.
// Signing uses the real wallet (Wallet Standard picker in src/wallet/wallet.js): the creator signs a human-readable
// launch manifest, then api.submitLaunch relays the launch (live mode: the wallet signs and sends each transaction).
import { api } from '../api/client.js';
import { FEES } from '../api/contract.js';
import { byId, ENGINE } from '../data/blocks.js';
import { budget, evaluate, feeAt, largestAllowed, normalize } from '../engine/engine.js';
import { splitView } from '../engine/fees.js';
import { isAddress, parseAddresses, shortAddr } from '../core/address.js';
import { Curve, SUPPLY } from '../engine/sim.js';
import { connect, pick, onWallet, address } from '../wallet/wallet.js';
import { ICON } from './icons.js';
import { pixelIcon } from './pixel.js';
import { avatar } from './avatar.js';
import { esc } from '../core/format.js';
import { enfBadges, summaryOf } from './build-rack.js';
import { plainRule } from './build-plain.js';
import { plainProblems } from './build-simple.js';

const MAX_IMG = 1024 * 1024;
const NET_FEE = 0.00001; // two signatures (creator + mint keypair) at 5,000 lamports
const short = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
const normUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const sol = (x) => `${x < 0.1 ? +x.toFixed(3) : +x.toFixed(2)} SOL`;
/** Blocklist marks and Allowlist passes that fit in the launch transaction beside a creator buy. */
export const LAUNCH_MARKS = 3;
const pctOf = (x) => `${+x.toFixed(3)}%`;
const famIcons = (st, size = 18) => st.map((s) => `<span title="${esc(plainRule(s).title)}">${pixelIcon(byId[s.id].family, { size })}</span>`).join('');

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

/**
 * What some rules need before launch, beyond their numbers: the wallet a Tithe pays, and the wallets a Blocklist
 * blocks or an Allowlist Phase lets in from the first second (written in the launch transaction).
 * → { tithe, block, pass, errs{ to, block, pass, marks }, marks[{ owner, blocked?, pass? }], owners, ok, needs }
 */
export function launchExtras(stack, meta, creator = null) {
  const tithe = stack.find((s) => s.id === 'tithe') ?? null;
  const blk = stack.find((s) => s.id === 'blocklist') ?? null;
  const al = stack.find((s) => s.id === 'allowlist-phase') ?? null;
  const errs = {};
  if (tithe) {
    const to = String(tithe.params.to ?? '').trim();
    if (!to) errs.to = 'Name the wallet the tithe pays.';
    else if (!isAddress(to)) errs.to = 'That isn\'t a Solana wallet address.';
  }
  const block = blk ? parseAddresses(meta.block) : { list: [], bad: [] };
  const pass = al ? parseAddresses(meta.pass) : { list: [], bad: [] };
  const badList = (b) => (b.bad.length ? `${b.bad.length === 1 ? `“${b.bad[0].slice(0, 24)}${b.bad[0].length > 24 ? '…' : ''}” isn't` : `${b.bad.length} entries aren't`} a Solana wallet address.` : null);
  if (badList(block)) errs.block = badList(block);
  else if (creator && block.list.includes(creator)) errs.block = 'That\'s your own wallet. You can\'t block yourself.';
  if (badList(pass)) errs.pass = badList(pass);
  const owners = [...new Set([...block.list, ...pass.list])];
  if (owners.length > LAUNCH_MARKS) errs.marks = `${owners.length} wallets: ${LAUNCH_MARKS} fit in the launch. ${blk?.params.lockAt === 'immediately' && block.list.length ? 'Your blocklist freezes at launch, so keep the ones that matter most.' : 'Add the rest from your coin page after launch.'}`;
  const marks = [...block.list.map((owner) => ({ owner, blocked: true })), ...pass.list.map((owner) => ({ owner, pass: true }))];
  return { tithe, block: blk, pass: al, errs, marks, owners: owners.length, ok: !Object.keys(errs).length, needs: !!(tithe || blk || al) };
}

/**
 * go(step): the page's step change (steps 2 and 3 live here). onReset: "Launch another coin".
 */
export function createLaunch({ S, root, paint, plain, sig, ctx, save, clearDraft, toast, go, onReset }) {
  const L = S.launch;
  let addr = address, handle = null, prepT = null, prepBusy = false, prepFail = false, prepErr = null;
  const extras = () => launchExtras(plain(), L.meta, addr);
  onWallet((a) => { addr = a; if (!a) handle = null; if (S.view.step === 3 && !L.busy && !L.done) render(); });

  function render() {
    if (S.view.step < 2 && !L.done) { root.innerHTML = ''; return; }
    paint(root, html());
  }

  function html() {
    const c = ctx();
    if (L.done) return doneHTML();
    return S.view.step === 2 ? detailsHTML(c) : reviewHTML(c);
  }

  // ───── step 2: the coin
  function detailsHTML(c) {
    const m = L.meta, e = L.errs;
    const f = (k, label, input, hint = '') => `<div class="field${e[k] ? ' bad' : ''}"><label for="lf-${k}">${label}</label>${input}${e[k] ? `<span class="ferr" id="le-${k}" role="alert">${esc(e[k])}</span>` : hint ? `<span class="fhint">${hint}</span>` : ''}</div>`;
    const inp = (k, ph, extra = '') => `<input class="input" id="lf-${k}" data-f="${k}" data-fk="lf-${k}" value="${esc(m[k])}" placeholder="${ph}" ${e[k] ? `aria-invalid="true" aria-describedby="le-${k}"` : ''} ${extra}>`;
    return `<div class="l-h"><h2>Name your coin</h2><p class="dim">This is what people see on the coin page and in every list. It can't change after launch.</p></div>
    <div class="lp panel">
    <div class="lp-grid">
      <div class="lp-form">
        <div class="frow">
          ${f('name', 'Name', inp('name', 'Lure Two', 'maxlength="32" autocomplete="off"'))}
          ${f('ticker', 'Ticker', `<div class="tick"><span class="mono">$</span>${inp('ticker', 'LURE2', 'maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false"')}</div>`, 'A–Z and 0–9, up to 10.')}
        </div>
        ${f('desc', `Description <span class="cnt mono" data-cnt>${m.desc.length}/280</span>`, `<textarea class="input" id="lf-desc" data-f="desc" data-fk="lf-desc" rows="3" maxlength="280" placeholder="What the coin is, in a sentence or two.">${esc(m.desc)}</textarea>`)}
        <details class="links"${m.x || m.tg || m.web || e.x || e.tg || e.web ? ' open' : ''}><summary>Links <span class="dim">(optional)</span></summary>
        <div class="frow three">
          ${f('x', 'X', inp('x', '@yourcoin', 'autocomplete="off" spellcheck="false"'))}
          ${f('tg', 'Telegram', inp('tg', 't.me/yourcoin', 'autocomplete="off" spellcheck="false"'))}
          ${f('web', 'Website', inp('web', 'https://yourcoin.xyz', 'type="url" autocomplete="off" spellcheck="false"'))}
        </div></details>
        ${f('buy', 'Your first buy <span class="dim">(optional)</span>', `<div class="tick sol">${inp('buy', '0.5', 'inputmode="decimal" autocomplete="off"')}<span class="mono">SOL</span></div>`)}
        <div class="buycheck" data-buycheck>${buyCheckHTML()}</div>
      </div>
      <div class="lp-side">
        <div class="img-drop${m.image ? ' has' : ''}${e.image ? ' bad' : ''}" data-drop>
          <input type="file" id="lf-img" class="sr" accept="image/png,image/jpeg,image/gif,image/webp" data-fk="lf-img">
          ${m.image ? `<img src="${esc(m.image)}" alt="Your coin image">` : `<span class="img-ph">${pixelIcon('custom', { size: 30, color: 'var(--chrome-4)', accent: 'var(--text-3)' })}<b>Coin image</b><span>PNG, JPG, GIF or WebP · up to 1 MB · shown square</span></span>`}
          <label for="lf-img" class="btn btn-glass btn-sm img-btn">${m.image ? 'Replace' : 'Upload image'}</label>
          ${m.image ? '<button class="btn btn-ghost btn-sm img-x" data-l="noimg">Remove</button>' : ''}
        </div>
        ${e.image ? `<span class="ferr" role="alert">${esc(e.image)}</span>` : ''}
        <div class="coin-pv" data-pv>${previewHTML(c)}</div>
      </div>
    </div>
    ${blockersHTML(c)}
    <div class="lp-foot"><button class="btn btn-ghost" data-act="step" data-to="1">Back</button><span class="dim">Saved on this device as you type.</span><button class="btn btn-chrome" data-l="next" data-fk="l-next" ${prepBusy ? 'disabled' : ''}>${prepBusy ? '<span class="spin"></span>Checking…' : `Next: review ${ICON.arrow}`}</button></div>
    </div>`;
  }

  function buyCheckHTML() {
    const r = creatorBuyCheck(plain(), L.meta.buy);
    if (!r) return '<span class="dim">Bought in the launch transaction, right after your rules switch on, so nobody can buy before you.</span>';
    const tok = `${(r.tokens / 1e6).toFixed(1)}M tokens · ${(r.share * 100).toFixed(2)}% of supply${r.fee > 1 ? ` · ${r.fee.toFixed(0)}% launch fee` : ''}`;
    if (r.ok) return `<span class="bc ok"><i class="dot"></i>Your rules allow this buy · <span class="mono">${tok}</span></span>`;
    const st = plain().find((s) => s.id === r.by);
    const who = st ? plainRule(st).title : byId[r.by].name;
    return `<span class="bc bad"><i class="dot refuse"></i><b title="${esc(byId[r.by].name)}${byId[r.by].code != null ? ` · ${byId[r.by].code}` : ''}">${esc(who)}</b> would block this buy: ${esc(r.msg)}. ${r.max > 0.001 ? `Largest that passes now: <button class="link mono" data-l="maxbuy" data-v="${Math.floor(r.max * 1000) / 1000}">${(Math.floor(r.max * 1000) / 1000).toFixed(3)} SOL</button>` : 'Lower it or skip the first buy.'}</span>`;
  }

  function previewHTML(c) {
    const m = L.meta, T = m.ticker || 'TICKER';
    const st = plain();
    return `<div class="pv-top">${avatar({ ticker: T, image: m.image }, 52)}<div><b class="pv-name">${esc(m.name || 'Your coin')}</b><span class="mono pv-t">$${esc(T)}</span></div></div>
      <p class="pv-desc">${esc(m.desc || 'Your description shows here, on the coin page and in every list.')}</p>
      <div class="pv-stack">${st.length ? famIcons(st) : ''}<span class="dim">${st.length ? `${st.length} rule${st.length === 1 ? '' : 's'}` : 'No rules yet'}${S.parent ? ` · remix of $${esc(S.parent.ticker)}` : ''}</span></div>
      ${c.ok ? '' : '<span class="pv-warn">Your rules need a fix before launch</span>'}`;
  }

  function blockersHTML(c) {
    const bad = plainProblems(c);
    if (!bad.length && c.ok) return '';
    const list = bad.length ? bad : ['Pick at least one rule.'];
    return `<div class="blockers" role="alert"><b>Fix your rules before you launch</b><ul>${list.map((w) => `<li>${esc(w)}</li>`).join('')}</ul><button class="btn btn-glass btn-sm" data-act="step" data-to="1">Back to rules</button></div>`;
  }

  // ───── step 3: review and launch
  function reviewHTML(c) {
    const m = L.meta, st = plain(), busy = L.busy, err = L.err, xo = extras();
    if (xo.ok && (!L.prep || L.prepSig !== prepKey()) && !prepFail) queuePrep();
    const P = xo.ok && L.prepSig === prepKey() ? L.prep : null; // never show (or sign) a launch built for other settings
    const buy = +m.buy || 0;
    const links = [m.x && ['X', m.x], m.tg && ['Telegram', m.tg], m.web && ['Website', m.web]].filter(Boolean);
    const rules = S.stack.map((s) => plainRule(s));
    const refuse = rules.filter((r) => r.refuses), also = rules.filter((r) => !r.refuses);
    const launchSol = P ? P.rentSol + P.launchCostSol + NET_FEE : budget(st).rentSol + FEES.launchCostSol + NET_FEE;
    const ready = P && c.ok && xo.ok && !busy;
    return `<div class="l-h"><h2>Review and launch</h2><p class="dim">Check it, connect your wallet, sign. Your rules switch on before anyone else can trade.</p></div>
    <div class="rv2">
      <div class="rv2-main panel">
        <div class="rv-coin">${avatar({ ticker: m.ticker, image: m.image }, 56)}<div><b>${esc(m.name)}</b> <span class="mono dim">$${esc(m.ticker)}</span><p class="muted">${esc(m.desc || 'No description.')}</p>
          ${links.length ? `<div class="rv-links">${links.map(([k, v]) => `<span><span class="dim">${k}</span> <span class="mono">${esc(v)}</span></span>`).join('')}</div>` : ''}</div>
          <button class="btn btn-ghost btn-sm" data-act="step" data-to="2">Edit</button></div>
        <div class="rv-sec">
          <div class="rv-h"><span class="pixel">Your coin will refuse</span><button class="link" data-act="step" data-to="1">Edit rules</button></div>
          ${refuse.length ? `<ul class="rv-say">${refuse.map((r) => `<li>${pixelIcon('cross', { size: 14, color: 'var(--refuse)' })}<span>${esc(cap(r.refuses))}</span></li>`).join('')}</ul>` : '<p class="muted rv-none">No trades. These rules don\'t block anyone; they move fees and supply instead.</p>'}
          ${also.length ? `<div class="rv-h also"><span class="pixel">It will also</span></div><ul class="rv-say also">${also.map((r) => `<li>${pixelIcon(r.family, { size: 14 })}<span>${esc(r.does)}</span></li>`).join('')}</ul>` : ''}
          ${S.parent ? `<p class="rv-remix dim">${ICON.remix}Remix of <a href="coin.html?t=${encodeURIComponent(S.parent.ticker)}">$${esc(S.parent.ticker)}</a>: your coin page links back to it.</p>` : ''}
        </div>
        ${xo.needs ? `<div class="rv-sec rv-set" data-x-sec>${extrasHTML(xo)}</div>` : ''}
      </div>
      <aside class="rv2-side">
        <div class="rv-card cost2">
          <div class="c2-row"><span>Launch cost</span><b class="mono">${P ? '' : '~'}${sol(launchSol)}</b></div>
          ${buy ? `<div class="c2-row"><span>Your first buy</span><b class="mono">${sol(buy)}</b></div><div class="c2-row tot"><span>Total</span><b class="mono">${sol(launchSol + buy)}</b></div>` : ''}
          <div data-split>${splitHTML(P)}</div>
        </div>
        <div class="wbox${addr ? ' on' : ''}">
          ${addr ? `<span class="dot"></span><div><span class="dim">Your wallet${handle ? ` · ${esc(handle.name)}` : ''}</span><b class="mono">${esc(short(addr))}</b></div><button class="btn btn-ghost btn-sm" data-l="switch" data-fk="l-switch">Switch</button>`
            : `<span class="wb-ico">${pixelIcon('lock', { size: 18 })}</span><div><b>Connect your wallet</b><span class="dim">Phantom, Solflare, Backpack or any Solana wallet.</span></div><button class="btn btn-glass btn-sm" data-l="connect" data-fk="l-connect">Connect</button>`}
        </div>
        ${prepErr && !busy ? `<div class="sg-err fail" role="alert"><b>Couldn't build the launch</b><span>${esc(prepErr)}</span><button class="btn btn-glass btn-sm" data-l="reprep">Try again</button></div>` : ''}
        ${xo.needs && !busy ? `<p class="rv-need" data-x-need ${xo.ok ? 'hidden' : ''}>${pixelIcon('arrow', { size: 14 })}<span>${esc(xo.ok ? '' : needLine(xo))}</span></p>` : ''}
        <button class="btn btn-chrome btn-lg rv-go" data-l="sign" data-fk="l-sign" ${ready ? '' : 'disabled'}>${busy === 'wallet' ? '<span class="spin"></span>Approve in your wallet…' : busy === 'submit' ? '<span class="spin"></span>Launching…' : err?.kind === 'rejected' ? 'Try again' : addr ? 'Sign and launch' : 'Connect and launch'}${busy ? '' : ICON.arrow}</button>
        ${busy ? `<ol class="mini-flow"><li class="${busy === 'wallet' ? 'now' : 'done'}">Sign</li><li class="${busy === 'submit' ? 'now' : ''}">Launch</li><li>Live</li></ol>` : '<p class="rv-note dim">Your wallet asks you to approve. hookrz never holds your keys.</p>'}
        ${err ? `<div class="sg-err ${err.kind}" role="alert"><b>${esc(err.title)}</b><span>${esc(err.text)}</span>${err.kind === 'nosign' ? '<button class="btn btn-glass btn-sm" data-l="switch">Use another wallet</button>' : ''}</div>` : ''}
      </aside>
    </div>
    ${blockersHTML(c)}
    <details class="rv-more"${S.view.txOpen ? ' open' : ''} data-l-more><summary>Transaction details</summary>${techHTML(P, st, buy)}</details>
    <div class="lp-foot"><button class="btn btn-ghost" data-act="step" data-to="2" ${busy ? 'disabled' : ''}>Back</button></div>`;
  }

  /** "Before you launch": the Tithe's wallet, and the wallets to block or let in from the first second. */
  function extrasHTML(xo) {
    const m = L.meta, e = { ...xo.errs };
    if (xo.tithe && !String(xo.tithe.params.to ?? '').trim()) delete e.to; // an empty field gets its hint; the line by the button says what's missing
    const fld = (k, label, input, hint) => `<div class="field xf${e[k] ? ' bad' : ''}" data-xf="${k}"><label for="lx-${k}">${label}</label>${input}<span class="${e[k] ? 'ferr' : 'fhint'}" data-xmsg="${k}"${e[k] ? ' role="alert"' : ''}>${esc(e[k] ?? hint)}</span></div>`;
    const area = (k, ph) => `<textarea class="input mono xa" id="lx-${k}" data-x="${k}" data-fk="lx-${k}" rows="3" spellcheck="false" autocomplete="off" placeholder="${ph}" ${e[k] ? 'aria-invalid="true"' : ''}>${esc(m[k] ?? '')}</textarea>`;
    const lock = xo.block?.params.lockAt;
    const blockHint = lock === 'immediately' ? 'One address per line. Your blocklist freezes at launch, so these are the whole list.'
      : `One address per line. You can add or remove wallets from your coin page until the list freezes ${lock === 'after 24h' ? '24 hours after launch' : 'at graduation'}.`;
    const tithePct = xo.tithe?.params.pct;
    return `<div class="rv-h"><span class="pixel">Before you launch</span></div>
      ${xo.tithe ? fld('to', 'Send the tithe to', `<input class="input mono" id="lx-to" data-x="to" data-fk="lx-to" value="${esc(xo.tithe.params.to ?? '')}" placeholder="Solana wallet address" spellcheck="false" autocomplete="off" ${e.to ? 'aria-invalid="true"' : ''}>`, `This wallet gets ${tithePct}% of your creator fees, for good. It can't change after launch.`) : ''}
      ${xo.block ? fld('block', 'Wallets to block <span class="dim">(optional)</span>', area('block', 'One wallet address per line'), blockHint) : ''}
      ${xo.pass ? fld('pass', 'Wallets with a pass <span class="dim">(optional)</span>', area('pass', 'One wallet address per line'), `Only these wallets can buy in the first ${xo.pass.params.minutes} minutes. You can give more passes from your coin page any time.`) : ''}
      ${xo.block || xo.pass ? `<p class="xlim${e.marks ? ' bad' : ''}" data-xmsg="marks"${e.marks ? ' role="alert"' : ''}>${esc(e.marks ?? `${xo.owners ? `${xo.owners} of the ${LAUNCH_MARKS} wallets` : `Up to ${LAUNCH_MARKS} wallets`} that fit in the launch${xo.block && xo.pass ? ', blocked and passes together' : ''}.${lock === 'immediately' && !xo.pass ? '' : ' Add more from your coin page after launch.'}`)}</p>` : ''}`;
  }
  function needLine(xo) {
    const e = xo.errs;
    if (e.to) return xo.tithe.params.to ? 'Fix the tithe wallet above to launch.' : 'Name the wallet the tithe pays, above, to launch.';
    if (e.marks) return `Keep it to ${LAUNCH_MARKS} wallets at launch.`;
    return 'Fix the wallet addresses above to launch.';
  }

  /** Who gets what of every trade: the launch's own fee split (the server's, once it built the launch). */
  function splitHTML(P) {
    const st = plain();
    const abi = S.stack.find((s) => s.id === 'custom')?.draft?.compile?.abi ?? null;
    const v = splitView(st, { abi, tradeFeePct: FEES.tradeFeePct, split: P?.curve?.feeSplit ?? null });
    const earn = (pct, extra = '') => `<p class="c2-earn">${pixelIcon('flow', { size: 14 })}<span>You earn <b>${pctOf(pct)}</b> of every trade on your coin${extra}.</span></p>`;
    if (!v.keeper) return earn(v.creatorPct);
    const nameOf = (r) => {
      const slot = S.stack.find((s) => s.id === r.id);
      const t = slot ? plainRule(slot).title : r.label;
      return r.id === 'tithe' && r.to && isAddress(r.to) ? `${t} → ${shortAddr(r.to)}` : t;
    };
    const rows = [
      { k: 'you', t: 'You', pct: v.creatorPct },
      ...v.rules.map((r) => ({ k: 'rule', t: nameOf(r), pct: r.pct })),
      { k: 'hz', t: 'hookrz', pct: v.platformPct },
      { k: 'mt', t: 'Meteora (the curve)', pct: v.protocolPct },
    ];
    const total = rows.reduce((a, r) => a + r.pct, 0) || 1;
    const sn = v.sniper;
    return `<div class="c2-split">
      <div class="c2-sh"><span>Every trade pays ${FEES.tradeFeePct}%</span></div>
      <div class="c2-bar" aria-hidden="true">${rows.filter((r) => r.pct > 0).map((r) => `<i class="${r.k}" style="flex:${r.pct / total}"></i>`).join('')}</div>
      <ul class="c2-who">${rows.map((r) => `<li class="${r.k}"><i></i><span>${esc(r.t)}</span><b class="mono">${pctOf(r.pct)}</b></li>`).join('')}</ul>
      ${v.rules.length ? `<p class="c2-note">Your rules get ${+v.shareOfCreatorPct.toFixed(2)}% of your half. hookrz's keeper pays and burns for them, and every step is a public transaction.</p>` : ''}
      ${v.lpForRulesPct > 0 ? `<p class="c2-note">After graduation, ${v.lpForRulesPct}% of the pool is locked to fund your rules.</p>` : ''}
      ${sn ? `<p class="c2-note">The launch fee above ${sn.endPct}% is burned, so the keeper pays you your share.</p>` : ''}
    </div>`;
  }

  /** Everything technical about the launch, folded away: rules with their settings, the instructions, size, cost lines, fee split, the manifest. */
  function techHTML(P, st, buy) {
    const ixs = P?.instructions ?? [];
    const norm = normalize(st);
    return `<div class="tech">
      <div class="rv-sec"><div class="rv-h"><span class="pixel">Rules, in run order</span><span class="mono dim">${norm.length}/${ENGINE.maxSlots}</span></div>
        <ol class="rv-stack">${norm.map((s, i) => { const b = byId[s.id]; return `<li><span class="mono dim">${String(i + 1).padStart(2, '0')}</span>${pixelIcon(b.family, { size: 20 })}<span class="rv-b"><b>${b.name}</b><span class="mono">${esc(summaryOf(s))}</span></span><span class="rv-e">${enfBadges(b)}</span></li>`; }).join('')}</ol></div>
      <div class="rv-sec"><div class="rv-h"><span class="pixel">Launch transaction</span><span class="mono dim">${P ? `${ixs.length} instructions · ${P.transactions?.length > 1 ? `${P.transactions.length} transactions` : 'one transaction'} · ${P.txBytes.toLocaleString('en-US')} / ${P.txLimit.toLocaleString('en-US')} bytes` : extras().ok ? 'Building…' : 'Built once the settings above are filled in'}</span></div>
        ${P ? `<ol class="ixs">${ixs.map((x, i) => { const skip = /optional/.test(x.ix) && !buy; return `<li class="${skip ? 'skip' : ''}"><span class="ix-n mono">${i + 1}</span><div><div class="ix-top"><span class="chip">${esc(x.program)}</span><code class="mono">${esc(x.ix.replace(' (optional)', ''))}</code>${skip ? '<span class="dim ix-s">not included: no first buy</span>' : /optional/.test(x.ix) ? `<span class="mono ix-s">${buy} SOL</span>` : ''}</div><p>${esc(x.note)}</p></div></li>`; }).join('')}</ol>` : '<div class="skel"><i></i><i></i><i></i></div>'}</div>
      ${P ? `<div class="tech-grid">
        <div class="rv-card"><div class="sub pixel">Cost</div><dl class="cost">
          <div><dt>Rules account rent</dt><dd class="mono">${P.rentSol.toFixed(4)} SOL</dd></div>
          <div><dt>Launch cost</dt><dd class="mono">${P.launchCostSol.toFixed(4)} SOL</dd></div>
          <div><dt>First buy</dt><dd class="mono">${buy ? `${buy} SOL` : '—'}</dd></div>
          <div><dt>Network fee</dt><dd class="mono">~${NET_FEE.toFixed(5)} SOL</dd></div>
          <div class="tot"><dt>Total</dt><dd class="mono">${(P.rentSol + P.launchCostSol + buy + NET_FEE).toFixed(4)} SOL</dd></div></dl>
          <p class="fhint">The rent comes back if the rules account is ever closed. Signers: ${P.signers.join(' + ')}.</p></div>
        <div class="rv-card"><div class="sub pixel">Fee split · ${FEES.tradeFeePct}% of every trade</div>
          <ul class="mini-fees">${FEES.split.map((f) => `<li><span>${esc(f.who)}</span><span class="mono">${f.pct}%</span><span class="to">${/creator/i.test(f.who) ? 'You' : esc(f.who)}</span></li>`).join('')}</ul>
          ${P.curve?.feeSplit && P.curve.feeSplit.keeperShareBps + (P.curve.feeSplit.creatorTradingFeePercentage === 0 ? 1 : 0) > 0 ? `<p class="fhint">The pool's config: creator ${P.curve.feeSplit.creatorTradingFeePercentage}% of the fee after Meteora's cut, hookrz ${100 - P.curve.feeSplit.creatorTradingFeePercentage}% (the keeper's share included). After graduation: ${P.curve.feeSplit.partnerLockedLpPct}% of the pool locked for the rules, ${P.curve.feeSplit.creatorLockedLpPct}% locked for you, ${P.curve.feeSplit.creatorLpPct}% yours.</p>` : ''}
          <div class="mint-row"><span class="dim">Mint address</span><span class="mono">${esc(short(P.mint))}</span></div></div>
      </div>` : ''}
      <div class="manifest"><div class="rv-h"><span class="pixel">Launch manifest</span><span class="mono dim">what your wallet signs</span></div>
        <pre class="mono">${esc(manifest(addr ?? '(your wallet)', '(time of signing)'))}</pre></div>
    </div>`;
  }

  function manifest(creator, when) {
    const m = L.meta, st = normalize(plain());
    const lines = [
      'hookrz launch',
      `name: ${m.name.trim()}`,
      `ticker: $${m.ticker}`,
      `creator: ${creator}`,
      ...(S.parent ? [`parent: $${S.parent.ticker}`] : ['parent: none (original rules)']),
      'stack:',
      ...st.map((s, i) => `  ${i + 1}. ${s.id} ${JSON.stringify(s.id === 'custom' ? { prompt: s.params.prompt, hookscript: S.stack[i]?.draft?.compile?.ok ? `${S.stack[i].draft.compile.name ?? 'rule'}: ${S.stack[i].draft.compile.size} bytes, ${S.stack[i].draft.compile.cu} CU worst case` : null } : s.params)}`),
      ...(m.buy && +m.buy ? [`creator buy: ${+m.buy} SOL`] : []),
      ...launchMarkLines(),
      ...(L.prep?.mint ? [`mint: ${L.prep.mint}`] : []),
      `issued: ${when}`,
    ];
    return lines.join('\n');
  }

  function launchMarkLines() {
    const xo = extras();
    const b = xo.marks.filter((x) => x.blocked).map((x) => x.owner), p = xo.marks.filter((x) => x.pass).map((x) => x.owner);
    return [...(b.length ? [`blocked at launch: ${b.join(', ')}`] : []), ...(p.length ? [`passes at launch: ${p.join(', ')}`] : [])];
  }

  function doneHTML() {
    const d = L.done, link = new URL(`coin.html?t=${encodeURIComponent(d.ticker)}`, location.href).href;
    const text = `$${d.ticker} is live on hookrz with ${d.stack.length} rule${d.stack.length === 1 ? '' : 's'} the chain enforces on every trade.`;
    return `<div class="launched panel">
      <div class="done-glow" aria-hidden="true"></div>
      <div class="done-av">${avatar({ ticker: d.ticker, image: d.image }, 96)}</div>
      <span class="eyebrow">Launched</span>
      <h2 class="chrome-text">Your coin is live</h2>
      <p class="lede"><b>${esc(d.name)}</b> <span class="mono">$${esc(d.ticker)}</span> is trading with ${d.stack.length} rule${d.stack.length === 1 ? '' : 's'} switched on${d.parent ? `, remixed from $${esc(d.parent)}` : ''}.</p>
      <div class="done-stack">${famIcons(d.stack, 26)}</div>
      <dl class="done-kv"><div><dt>Mint</dt><dd class="mono">${esc(short(d.mint))}</dd></div><div><dt>Signature</dt><dd class="mono">${esc(short(d.signature))}</dd></div><div><dt>Creator</dt><dd class="mono">${esc(short(d.creator))}</dd></div></dl>
      <div class="done-go">
        <a class="btn btn-chrome btn-lg" href="coin.html?t=${encodeURIComponent(d.ticker)}">Open $${esc(d.ticker)} ${ICON.arrow}</a>
        <button class="btn btn-glass btn-lg" data-l="copy" data-link="${esc(link)}">${ICON.copy} Copy link</button>
        <a class="btn btn-glass btn-lg" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(text)}&via=hookrzfun&url=${encodeURIComponent(link)}">${ICON.x} Share on X</a>
      </div>
      <button class="link done-again" data-l="again">Launch another coin</button>
    </div>`;
  }

  // ───── behaviour
  const prepKey = () => `${sig()}|${L.meta.buy}|${L.meta.ticker}|${JSON.stringify(extras().marks)}`;
  function queuePrep() {
    clearTimeout(prepT);
    prepT = setTimeout(async () => {
      const key = prepKey();
      if (!extras().ok) return;
      try {
        const P = await api.prepareLaunch({ meta: metaOut(), stack: plain(), creator: addr ?? undefined, marks: extras().marks });
        if (key !== prepKey()) return queuePrep();
        L.prep = P; L.prepSig = key; prepFail = false; prepErr = null;
      } catch (e) { if (key !== prepKey()) return queuePrep(); prepFail = true; prepErr = e?.message || 'The server didn\'t answer. Try again.'; }
      if (S.view.step === 3 && !L.done) render();
    }, 250);
  }
  const metaOut = () => {
    const m = L.meta;
    return { name: m.name.trim(), ticker: m.ticker, desc: m.desc.trim(), image: m.image, links: { x: m.x.trim() || null, telegram: m.tg.trim() || null, website: m.web.trim() ? normUrl(m.web.trim()) : null }, creatorBuySol: +m.buy || 0 };
  };

  /** Step 2 → 3: validate the form and check the ticker is free. Resolves true when the coin is ready for review. */
  async function checkCoin({ quiet = false } = {}) {
    L.errs = validate(L.meta);
    if (!L.errs.ticker && L.meta.ticker) {
      prepBusy = true; if (!quiet) render();
      const taken = await api.coin(L.meta.ticker).catch(() => null);
      prepBusy = false;
      if (taken) L.errs.ticker = `$${L.meta.ticker} is taken. Pick another ticker.`;
    }
    return !Object.keys(L.errs).length;
  }
  async function next() {
    if (S.view.step !== 2) return;
    if (!(await checkCoin())) { render(); root.querySelector('[aria-invalid="true"]')?.focus(); return; }
    if (!ctx().ok) { render(); root.querySelector('.blockers')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    L.prep = null; prepFail = false; prepErr = null; L.err = null;
    go(3);
  }

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
    if (!ctx().ok || !extras().ok) { render(); return; }
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
      const r = await api.submitLaunch({ meta: metaOut(), stack: plain(), parent: S.parent?.ticker ?? null, marks: extras().marks, prepared: { ...L.prep, manifest: text, manifestSignature: signature ? Array.from(signature) : null, creator: addr } });
      L.done = { ticker: r.ticker, signature: r.signature, name: L.meta.name.trim(), image: L.meta.image, mint: L.prep?.mint, creator: addr, stack: plain(), parent: S.parent?.ticker ?? null };
      clearDraft();
    } catch (e) {
      L.err = { kind: 'fail', title: 'Launch not sent', text: `${e?.message || 'The launch did not go through.'} Nothing was charged; try again.` };
    }
    L.busy = false;
    render();
    if (L.done) go(3);
  }
  const nosign = (h) => ({ kind: 'nosign', title: `${h?.name ?? 'This wallet'} can't sign messages`, text: 'hookrz asks you to sign the launch details so the rules and the name are provably yours. Phantom, Solflare and Backpack support it; switch to one of them to launch.' });

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
    else if (a === 'connect') doConnect();
    else if (a === 'switch') doSwitch();
    else if (a === 'sign') sign();
    else if (a === 'reprep') { prepFail = false; prepErr = null; L.prepSig = null; render(); }
    else if (a === 'noimg') { L.meta.image = null; save(); render(); }
    else if (a === 'maxbuy') { L.meta.buy = el.dataset.v; save(); render(); root.querySelector('#lf-buy')?.focus(); }
    else if (a === 'copy') {
      const link = el.dataset.link;
      (navigator.clipboard?.writeText(link) ?? Promise.reject()).then(() => toast('Link copied.'), () => toast(link));
    } else if (a === 'again') { L.done = null; L.err = null; L.prep = null; L.errs = {}; L.meta = { name: '', ticker: '', desc: '', image: null, x: '', tg: '', web: '', buy: '', block: '', pass: '' }; onReset(); }
  });
  root.addEventListener('toggle', (e) => { if (e.target.matches?.('[data-l-more]')) S.view.txOpen = e.target.open; }, true);
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.x) { extraInput(el); return; }
    const k = el.dataset.f;
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
    if (!k || S.view.step !== 2 || !L.meta[k]) return;
    const err = validate(L.meta)[k];
    if (err && !L.errs[k]) { L.errs[k] = err; const fld = e.target.closest('.field'); if (fld && !fld.querySelector('.ferr')) { fld.classList.add('bad'); fld.querySelector('.fhint')?.remove(); fld.insertAdjacentHTML('beforeend', `<span class="ferr" id="le-${k}" role="alert">${esc(err)}</span>`); e.target.setAttribute('aria-invalid', 'true'); } }
  });
  /** A "Before you launch" field changed: keep the state, patch the messages and the button, rebuild the launch when it's complete. */
  function extraInput(el) {
    const k = el.dataset.x;
    if (k === 'to') { const t = S.stack.find((s) => s.id === 'tithe'); if (!t) return; t.params.to = el.value.trim(); }
    else L.meta[k] = el.value;
    save();
    patchExtras();
  }
  function patchExtras(touched = false) {
    const xo = extras();
    for (const k of ['to', 'block', 'pass', 'marks']) {
      const msg = root.querySelector(`[data-xmsg="${k}"]`);
      if (!msg) continue;
      // while typing an address, a half-pasted one isn't an error yet: say so on blur (touched) or once it's long enough
      const raw = k === 'to' ? String(xo.tithe?.params.to ?? '') : k === 'marks' ? '' : String(L.meta[k] ?? '');
      const showErr = xo.errs[k] && (touched || k === 'marks' || raw.split(/[\s,;]+/).filter(Boolean).every((x) => x.length >= 32));
      const fresh = document.createElement('div');
      fresh.innerHTML = extrasHTML({ ...xo, errs: showErr ? xo.errs : { ...xo.errs, [k]: undefined } });
      const nm = fresh.querySelector(`[data-xmsg="${k}"]`);
      if (nm) { msg.className = nm.className; msg.textContent = nm.textContent; if (nm.hasAttribute('role')) msg.setAttribute('role', 'alert'); else msg.removeAttribute('role'); }
      const f = root.querySelector(`[data-xf="${k}"]`);
      if (f) { f.classList.toggle('bad', !!showErr); f.querySelector('[data-x]')?.toggleAttribute('aria-invalid', !!showErr); }
    }
    const need = root.querySelector('[data-x-need]'), btn = root.querySelector('[data-l="sign"]');
    if (need) { need.hidden = xo.ok; need.querySelector('span').textContent = xo.ok ? '' : needLine(xo); }
    const built = xo.ok && L.prep && L.prepSig === prepKey();
    if (xo.ok && !built) { prepFail = false; prepErr = null; queuePrep(); }
    if (btn && !built) btn.disabled = true; // enabled again once the launch for these settings is built
    const sp = root.querySelector('[data-split]'); if (sp) sp.innerHTML = splitHTML(built ? L.prep : null);
  }
  root.addEventListener('focusout', (e) => { if (e.target.dataset?.x && S.view.step === 3) patchExtras(true); }, true);
  root.addEventListener('change', (e) => { if (e.target.id === 'lf-img') { readImage(e.target.files?.[0]); e.target.value = ''; } });
  root.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (d && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); d.classList.add('over'); } });
  root.addEventListener('dragleave', (e) => { e.target.closest?.('[data-drop]')?.classList.remove('over'); });
  root.addEventListener('drop', (e) => { const d = e.target.closest('[data-drop]'); if (d && e.dataTransfer?.files?.length) { e.preventDefault(); d.classList.remove('over'); readImage(e.dataTransfer.files[0]); } });

  return {
    render,
    checkCoin,
    /** The rules changed: refresh what steps 2–3 show about them. */
    stackChanged() {
      if (L.done) return;
      if (S.view.step === 2) {
        const pv = root.querySelector('[data-pv]'); if (pv) pv.innerHTML = previewHTML(ctx());
        const bc = root.querySelector('[data-buycheck]'); if (bc) bc.innerHTML = buyCheckHTML();
        const c = ctx(), bl = root.querySelector('.blockers'), h = blockersHTML(c);
        if (bl && !h) bl.remove(); else if (bl) bl.outerHTML = h;
      } else if (S.view.step === 3) { L.prep = null; prepFail = false; prepErr = null; if (!L.busy) render(); }
    },
  };
}
