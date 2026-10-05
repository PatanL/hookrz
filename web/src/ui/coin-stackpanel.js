// "Rules on this coin": every rule in order, with a LIVE plain-words line computed from its settings, the coin
// (age, curve progress, chart) and the visitor's local position. Ticks every second. Codes, compute and enforcers
// show on hover and in the "Technical details" fold.
import { byId, hex, capAt, chapterOf } from '../data/blocks.js';
import { feeAt } from '../engine/engine.js';
import { SUPPLY } from '../engine/sim.js';
import { clock, esc } from '../core/format.js';
import { enfBadges, tok, sol, pxTile, ruleName, techTip } from './coin-shared.js';
import { moveOver } from './coin-chart.js';

const GRAD_SOL = 85;
const nextHourS = () => { const d = new Date(); return 3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds()); };
const pc = (v) => `${+(+v).toFixed(2)}%`;
const dur = (s) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : clock(s));
const meter = (k, cls = '') => `<span class="sp-meter ${cls}"><i style="width:${(Math.max(0, Math.min(1, k)) * 100).toFixed(1)}%"></i></span>`;

/** What a rule is doing right now, in plain words -> { tone: ok|warn|refuse|dim|info, html } */
function liveState(slot, x) {
  const b = byId[slot.id], p = slot.params;
  const { coin, ageS, pos, hist } = x;
  const grad = coin.phase === 'graduated';
  const now = Date.now();
  if (grad && b.enforcedBy === 'hook') return { tone: 'dim', html: 'Off: the curve filled and the coin graduated, so this rule no longer checks trades.' };
  const held = pos.tokens > 0;
  switch (b.id) {
    case 'snipe-shield': {
      const left = p.window - ageS;
      return left > 0 ? { tone: 'warn', html: `Buys over ${pc(p.max)} of supply are blocked for <b class="num">${clock(left)}</b> more.` }
        : { tone: 'ok', html: `The launch window is over. Buys of any size go through.` };
    }
    case 'anti-bundle': {
      const left = p.window * 60 - ageS;
      return left > 0 ? { tone: 'warn', html: `Bundles are blocked for <b class="num">${clock(left)}</b> more: at most ${p.perSlot} buy${p.perSlot > 1 ? 's' : ''} can land at the same moment.` }
        : { tone: 'ok', html: `The bundle window is over. Buys land freely.` };
    }
    case 'max-wallet': {
      const cap = SUPPLY * p.pct / 100;
      return { tone: 'info', html: `No wallet can hold more than <b class="num">${pc(p.pct)}</b> (${tok(cap)} coins)${held ? `. You hold <b class="num">${pc(pos.tokens / SUPPLY * 100)}</b>` : ''}.` };
    }
    case 'rising-max': {
      const cap = capAt(p, ageS), full = p.hours * 3600;
      return ageS < full
        ? { tone: 'info', html: `Wallets can hold up to <b class="num">${cap.toFixed(2)}%</b> right now, rising to ${pc(p.to)} in <b class="num">${dur(full - ageS)}</b>.${meter(ageS / full)}` }
        : { tone: 'ok', html: `Fully open: wallets can hold up to <b class="num">${pc(p.to)}</b>.` };
    }
    case 'sandwich-guard': {
      const lock = p.slots * 0.4, since = pos.lastBuyAt ? (now - pos.lastBuyAt) / 1000 : Infinity;
      return since < lock ? { tone: 'warn', html: `You can sell in <b class="num">${(lock - since).toFixed(1)}s</b>.` }
        : { tone: 'info', html: `Selling right after buying is blocked for about ${lock.toFixed(1)}s${held ? '. You can sell now' : ''}.` };
    }
    case 'blocklist': return { tone: 'warn', html: `The creator can ban wallets from holding this coin. The list freezes ${esc(p.lockAt)}.` };
    case 'allowlist-phase': {
      const left = p.minutes * 60 - ageS;
      return left > 0 ? { tone: 'warn', html: `Only pass holders can buy, for <b class="num">${dur(left)}</b> more.` } : { tone: 'ok', html: `Open to everyone now.` };
    }
    case 'sell-cap': return { tone: 'info', html: `Biggest sell allowed: <b class="num">${tok(SUPPLY * p.pct / 100)}</b> coins at once.` };
    case 'sell-cooldown': {
      const left = pos.lastSellAt ? p.minutes * 60 - (now - pos.lastSellAt) / 1000 : 0;
      return left > 0 ? { tone: 'warn', html: `Your next sell opens in <b class="num">${clock(left)}</b>.${meter(1 - left / (p.minutes * 60))}` }
        : { tone: held ? 'ok' : 'info', html: held ? `You can sell now. After that, wait ${p.minutes}m.` : `One sell per wallet every ${p.minutes}m.` };
    }
    case 'hold-timer': {
      const holdMs = p.minutes * 60000;
      const span = p.minutes >= 60 ? `${p.minutes / 60}h` : `${p.minutes}m`;
      if (!held) return { tone: 'info', html: `New coins wait ${span} before they can be sold or sent.` };
      const settling = pos.lots.filter((l) => now - l.at < holdMs);
      const lockedAmt = settling.reduce((a, l) => a + l.amt, 0);
      if (!settling.length) return { tone: 'ok', html: `All <b class="num">${tok(pos.tokens)}</b> of yours are free to sell.` };
      const next = Math.min(...settling.map((l) => holdMs - (now - l.at))) / 1000;
      return { tone: 'warn', html: `Yours: <b class="num">${tok(Math.max(0, pos.tokens - lockedAmt))}</b> free, <b class="num">${tok(lockedAmt)}</b> waiting. The next batch frees in <b class="num">${clock(next)}</b>.` };
    }
    case 'circuit-breaker': {
      const mv = moveOver(hist, p.window) * 100;
      const k = (Math.max(-p.band, Math.min(p.band, mv)) + p.band) / (2 * p.band);
      const near = Math.abs(mv) > p.band * 0.75;
      return { tone: near ? 'warn' : 'ok', html: `Price moved <b class="num ${mv >= 0 ? 'up' : 'down'}">${mv >= 0 ? '+' : '−'}${Math.abs(mv).toFixed(1)}%</b> in the last ${p.window}m. Trades that push it past ±${p.band}% are blocked.
        <span class="sp-band"><span class="sp-band-l num">−${p.band}%</span><span class="sp-band-t"><i class="sp-band-z"></i><i class="sp-band-m" style="left:${(k * 100).toFixed(1)}%"></i></span><span class="sp-band-l num">+${p.band}%</span></span>` };
    }
    case 'trading-hours': {
      const d = new Date(), sec = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      const o = p.open * 3600, c = p.close * 3600;
      const isOpen = sec >= o && sec < c;
      const toOpen = (o - sec + 86400) % 86400 || 86400;
      return isOpen ? { tone: 'ok', html: `<span class="sp-pill open">Open</span> Closes in <b class="num">${clock(c - sec)}</b> (${String(p.close).padStart(2, '0')}:00 UTC).` }
        : { tone: 'refuse', html: `<span class="sp-pill closed">Closed</span> Opens in <b class="num">${clock(toOpen)}</b> (${String(p.open).padStart(2, '0')}:00 UTC). Trades are blocked until then.` };
    }
    case 'seasoned-sells': {
      if (!held || !pos.firstAt) return { tone: 'info', html: `On day one you can sell up to ${p.base}% of your balance at once, plus ${p.step}% for every hour you hold.` };
      const hrs = Math.floor((now - pos.firstAt) / 3.6e6), share = Math.min(100, p.base + p.step * hrs);
      return { tone: share >= 100 ? 'ok' : 'info', html: `You can sell <b class="num">${share}%</b> of your balance at once${share < 100 ? `, +${p.step}% in <b class="num">${clock(3600 - ((now - pos.firstAt) / 1000) % 3600)}</b>` : ''}.` };
    }
    case 'outflow-cap': {
      const used = Math.min(p.pct, x.hourSoldPct);
      return { tone: used > p.pct * 0.8 ? 'warn' : 'info', html: `Sold this hour: <b class="num">${used.toFixed(2)}%</b> of the ${pc(p.pct)} limit. Resets in <b class="num">${clock(nextHourS())}</b>.${meter(used / p.pct, used > p.pct * 0.8 ? 'hot' : '')}` };
    }
    case 'lock-in': {
      const prog = coin.progress * 100;
      return prog < p.pct
        ? { tone: 'refuse', html: `Selling opens when the curve is ${p.pct}% full. It's <b class="num">${prog.toFixed(1)}%</b> full now, about <b class="num">${((p.pct - prog) / 100 * GRAD_SOL).toFixed(1)} SOL</b> of buys to go.${meter(prog / p.pct, 'lock')}` }
        : { tone: 'ok', html: `Selling is open: the curve passed ${p.pct}%.` };
    }
    case 'sniper-fee-burn': {
      const fee = feeAt(coin.stack, ageS);
      return ageS < p.seconds && !grad ? { tone: 'warn', html: `The fee is <b class="num">${fee.toFixed(1)}%</b> right now and drops to 1% in <b class="num">${clock(p.seconds - ageS)}</b>. The extra is burned.` }
        : { tone: 'ok', html: `The fee is back to 1%. The early extra fee was burned.` };
    }
    case 'buyback-burn': return { tone: 'info', html: `Next buyback and burn in <b class="num">${clock(nextHourS())}</b>, from ${p.pct}% of the creator's fees${grad ? ' (now LP fees)' : ''}.` };
    case 'leftover-burn': return grad ? { tone: 'ok', html: 'Coins the curve didn\'t sell were burned when it filled.' } : { tone: 'info', html: 'Coins the curve doesn\'t sell get burned when it fills.' };
    case 'creator-vest': {
      const cliff = p.cliff * 86400;
      if (ageS < cliff) return { tone: 'info', html: `The creator's own coins are locked for <b class="num">${dur(cliff - ageS)}</b> more.` };
      const k = Math.min(1, (ageS - cliff) / (p.days * 86400));
      return { tone: 'info', html: `<b class="num">${(k * 100).toFixed(1)}%</b> of the creator's coins are unlocked.${meter(k)}` };
    }
    case 'holder-rewards': return { tone: 'info', html: `Next payout snapshot in <b class="num">${clock(nextHourS())}</b>: ${p.pct}% of the creator's fees go to wallets holding over ${pc(p.min)}${held && pos.tokens >= SUPPLY * p.min / 100 ? '. <b>You qualify</b>' : ''}.` };
    case 'first-buyer-rebate': return { tone: 'info', html: `The first ${p.n} buyers who still hold when the curve fills share ${p.pct}% of the creator's fees.` };
    case 'tithe': return { tone: 'info', html: `${p.pct}% of the creator's fees go to a fixed wallet. Next payout in <b class="num">${clock(nextHourS())}</b>.` };
    case 'lp-lock': return grad ? { tone: 'ok', html: `${p.pct}% of the liquidity is locked for good.` } : { tone: 'info', html: `When the curve fills, ${p.pct}% of the liquidity gets locked for good.` };
    case 'token-gate': return { tone: 'info', html: `Only wallets holding <b class="num">${(+p.min).toLocaleString('en-US')}</b> ${esc(p.ticker)} can get this coin.` };
    case 'chapters': {
      const ch = chapterOf(p, coin.progress), next = ((ch + 1) / p.n) * 100;
      return { tone: 'info', html: `Chapter <b class="num">${ch + 1} of ${p.n}</b>: wallets can hold up to ${pc(p.first * 2 ** ch)}${ch + 1 < p.n ? `. The next chapter opens at ${next.toFixed(0)}% full` : ''}.
        <span class="sp-chap">${Array.from({ length: p.n }, (_, i) => `<i class="${i < ch ? 'done' : i === ch ? 'cur' : ''}"></i>`).join('')}</span>` };
    }
    case 'diamond-tiers': {
      if (!held || !pos.firstAt) return { tone: 'info', html: `Wallets that never sell for ${p.hours}h earn a crown and share ${p.pct}% of the creator's fees.` };
      if (pos.soldEver) return { tone: 'dim', html: 'You sold, so this wallet can no longer earn a crown.' };
      const left = p.hours * 3600 - (now - pos.firstAt) / 1000;
      return left > 0 ? { tone: 'info', html: `Your crown comes in <b class="num">${dur(left)}</b> if you don't sell.${meter(1 - left / (p.hours * 3600))}` } : { tone: 'ok', html: '<b>You wear a crown.</b> Crowned wallets get paid every hour.' };
    }
    case 'kingmaker': return { tone: 'info', html: `The biggest holder when the curve fills gets ${p.pct}% of the creator's fees for 30 days.` };
    case 'locked-metadata': return { tone: 'ok', html: 'The name, ticker and image can never change.' };
    case 'custom': return { tone: 'warn', html: `${p.prompt ? `“${esc(p.prompt)}”. ` : ''}The creator's own rule, written in Hookscript. Not reviewed yet.` };
    default: return { tone: 'info', html: esc(b.tagline) };
  }
}

export function mountStackPanel(el, x) {
  const { coin } = x;
  const bud = coin.budget;
  const grad = coin.phase === 'graduated';
  const rows = coin.stack.map((s, i) => {
    const b = byId[s.id];
    const retired = grad && b.enforcedBy === 'hook';
    // risky rules (Lock-in, Blocklist) already say so in their live line and in the red banner at the top of the page
    return `<li class="sp-row${retired ? ' retired' : ''}${b.risk || b.power ? ' risky' : ''}">
      ${pxTile(b.family, { size: 40, state: retired ? 'off' : '' })}
      <div class="sp-body">
        <div class="sp-top"><span class="sp-name" data-tip="${esc(techTip(b))}">${esc(ruleName(b))}</span></div>
        <div class="sp-live" data-i="${i}"></div>
      </div>
    </li>`;
  }).join('');
  const cuK = bud.cu / bud.cuBudget;
  el.innerHTML = `
    <div class="ph"><h3>Rules on this coin <span class="pk">${coin.stack.length} rule${coin.stack.length === 1 ? '' : 's'} · what each one does right now</span></h3></div>
    <ol class="sp-list">${rows}</ol>
    <details class="sp-tech">
      <summary><span>Technical details</span><span class="dim">compute, accounts, error codes</span></summary>
      <ul class="sp-codes">${coin.stack.map((s) => { const b = byId[s.id]; return `<li><span>${esc(ruleName(b))}</span><span class="mono dim">${esc(b.summary(s.params))}</span><span class="sp-enf">${enfBadges(b)}</span><span class="mono">${b.code != null ? hex(b.code) : '—'}</span><span class="mono">${b.cu ? `${b.cu.toLocaleString('en-US')} CU` : 'off path'}</span></li>`; }).join('')}</ul>
      <div class="sp-foot">
        <div class="sp-f"><span class="k">Compute</span><span class="v num">${bud.cu.toLocaleString('en-US')} <span class="dim">/ ${bud.cuBudget.toLocaleString('en-US')} CU</span></span>${meter(cuK)}</div>
        <div class="sp-f"><span class="k">Extra accounts</span><span class="v num" data-tip="${esc(bud.accounts.map((a) => a.label).join(' · ') || 'None')}">${bud.accounts.length} <span class="dim">/ ${bud.maxAccounts}</span></span><span class="s">${bud.accounts.length ? esc(bud.accounts.map((a) => a.key === 'stack' ? 'Stack PDA' : a.key.startsWith('wallet') ? 'Wallet records' : a.key === 'pool' ? 'DBC pool' : a.label.split(' (')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')) : 'none'}</span></div>
        <div class="sp-f"><span class="k">Route</span><span class="v">${bud.route === 'record' ? 'hookrz router' : 'Any route'}</span><span class="s">${bud.route === 'record' ? `Opens a Wallet record in your first buy (${sol(bud.walletRecordRentSol)} rent, refunded after graduation). Aggregators work once it exists.` : 'Aggregators and wallets swap it directly.'}</span></div>
        <div class="sp-f"><span class="k">At graduation</span><span class="v">${grad ? 'Hook retired' : 'Hook retires'}</span><span class="s">Hook blocks retire at graduation; Crank blocks keep running on LP fees.</span></div>
      </div>
    </details>`;
  const lines = [...el.querySelectorAll('.sp-live')];
  const tick = () => {
    const ctx = x.ctx();
    coin.stack.forEach((s, i) => {
      const st = liveState(s, ctx);
      lines[i].className = `sp-live ${st.tone}`;
      if (lines[i]._h !== st.html) { lines[i].innerHTML = st.html; lines[i]._h = st.html; }
    });
  };
  tick();
  setInterval(tick, 1000);
  return { tick };
}
