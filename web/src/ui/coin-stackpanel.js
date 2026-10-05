// "Rules on this coin": every slot in order, with a LIVE state line computed from the block's params,
// the coin (age, curve progress, chart) and the visitor's local position. Ticks every second.
import { byId, ENGINE, hex, capAt, chapterOf } from '../data/blocks.js';
import { feeAt } from '../engine/engine.js';
import { SUPPLY } from '../engine/sim.js';
import { cube } from './icons.js';
import { clock, esc } from '../core/format.js';
import { enfBadges, tok, sol } from './coin-shared.js';
import { moveOver } from './coin-chart.js';

const GRAD_SOL = 85;
const nextHourS = () => { const d = new Date(); return 3600 - (d.getUTCMinutes() * 60 + d.getUTCSeconds()); };
const pc = (v) => `${+(+v).toFixed(2)}%`;
const dur = (s) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : clock(s));
const meter = (k, cls = '') => `<span class="sp-meter ${cls}"><i style="width:${(Math.max(0, Math.min(1, k)) * 100).toFixed(1)}%"></i></span>`;

/** -> { tone: ok|warn|refuse|dim|info, html } */
function liveState(slot, x) {
  const b = byId[slot.id], p = slot.params;
  const { coin, ageS, pos, hist } = x;
  const grad = coin.phase === 'graduated';
  const now = Date.now();
  if (grad && b.enforcedBy === 'hook') return { tone: 'dim', html: 'Retired at graduation. The DBC pool removed the hook in the graduating swap.' };
  const held = pos.tokens > 0;
  switch (b.id) {
    case 'snipe-shield': {
      const left = p.window - ageS;
      return left > 0 ? { tone: 'warn', html: `Window open · <b class="num">${clock(left)}</b> left · buys over ${pc(p.max)} of supply are refused` }
        : { tone: 'ok', html: `Window closed. It ran the first ${p.window}s; buys of any size pass it now.` };
    }
    case 'anti-bundle': {
      const left = p.window * 60 - ageS;
      return left > 0 ? { tone: 'warn', html: `Bundle window open · <b class="num">${clock(left)}</b> left · ${p.perSlot} buy${p.perSlot > 1 ? 's' : ''} per slot` }
        : { tone: 'ok', html: `Window closed after ${p.window}m. Any number of buys can land per slot now.` };
    }
    case 'max-wallet': {
      const cap = SUPPLY * p.pct / 100;
      return { tone: 'info', html: `Cap <b class="num">${tok(cap)}</b> tokens per wallet${held ? ` · you hold <b class="num">${pc(pos.tokens / SUPPLY * 100)}</b>` : ''}` };
    }
    case 'rising-max': {
      const cap = capAt(p, ageS), full = p.hours * 3600;
      return ageS < full
        ? { tone: 'info', html: `Cap now <b class="num">${cap.toFixed(2)}%</b> (${tok(SUPPLY * cap / 100)}) · reaches ${pc(p.to)} in <b class="num">${dur(full - ageS)}</b>${meter(ageS / full)}` }
        : { tone: 'ok', html: `Fully open: wallets can hold up to <b class="num">${pc(p.to)}</b> (${tok(SUPPLY * p.to / 100)})` };
    }
    case 'sandwich-guard': {
      const lock = p.slots * 0.4, since = pos.lastBuyAt ? (now - pos.lastBuyAt) / 1000 : Infinity;
      return since < lock ? { tone: 'warn', html: `Your sells open in <b class="num">${(lock - since).toFixed(1)}s</b>` }
        : { tone: 'info', html: `Sells open ${p.slots} slots (~${lock.toFixed(1)}s) after a buy${held ? ' · you are clear to sell' : ''}` };
    }
    case 'blocklist': return { tone: 'warn', html: `The creator can add block markers. The list freezes ${esc(p.lockAt)}.` };
    case 'allowlist-phase': {
      const left = p.minutes * 60 - ageS;
      return left > 0 ? { tone: 'warn', html: `Pass holders only · opens to everyone in <b class="num">${dur(left)}</b>` } : { tone: 'ok', html: `Phase over. Anyone can buy.` };
    }
    case 'sell-cap': return { tone: 'info', html: `Largest sell now: <b class="num">${tok(SUPPLY * p.pct / 100)}</b> tokens per transaction` };
    case 'sell-cooldown': {
      const left = pos.lastSellAt ? p.minutes * 60 - (now - pos.lastSellAt) / 1000 : 0;
      return left > 0 ? { tone: 'warn', html: `Your next sell opens in <b class="num">${clock(left)}</b>${meter(1 - left / (p.minutes * 60))}` }
        : { tone: held ? 'ok' : 'info', html: held ? 'You can sell now. The next one waits ' + p.minutes + 'm.' : `One sell per wallet every ${p.minutes}m` };
    }
    case 'hold-timer': {
      const holdMs = p.minutes * 60000;
      if (!held) return { tone: 'info', html: `Each buy settles for ${p.minutes >= 60 ? p.minutes / 60 + 'h' : p.minutes + 'm'} before it can move` };
      const settling = pos.lots.filter((l) => now - l.at < holdMs);
      const lockedAmt = settling.reduce((a, l) => a + l.amt, 0);
      if (!settling.length) return { tone: 'ok', html: `All <b class="num">${tok(pos.tokens)}</b> of yours are settled and free to move` };
      const next = Math.min(...settling.map((l) => holdMs - (now - l.at))) / 1000;
      return { tone: 'warn', html: `Yours: <b class="num">${tok(Math.max(0, pos.tokens - lockedAmt))}</b> free · <b class="num">${tok(lockedAmt)}</b> settling, next lot frees in <b class="num">${clock(next)}</b>` };
    }
    case 'circuit-breaker': {
      const mv = moveOver(hist, p.window) * 100;
      const k = (Math.max(-p.band, Math.min(p.band, mv)) + p.band) / (2 * p.band);
      const near = Math.abs(mv) > p.band * 0.75;
      return { tone: near ? 'warn' : 'ok', html: `This ${p.window}m window: <b class="num ${mv >= 0 ? 'up' : 'down'}">${mv >= 0 ? '+' : '−'}${Math.abs(mv).toFixed(1)}%</b> of ±${p.band}%
        <span class="sp-band"><span class="sp-band-l num">−${p.band}%</span><span class="sp-band-t"><i class="sp-band-z"></i><i class="sp-band-m" style="left:${(k * 100).toFixed(1)}%"></i></span><span class="sp-band-l num">+${p.band}%</span></span>` };
    }
    case 'trading-hours': {
      const d = new Date(), sec = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      const o = p.open * 3600, c = p.close * 3600;
      const isOpen = sec >= o && sec < c;
      const toOpen = (o - sec + 86400) % 86400 || 86400;
      return isOpen ? { tone: 'ok', html: `<span class="sp-pill open">Open</span> closes in <b class="num">${clock(c - sec)}</b> · ${String(p.close).padStart(2, '0')}:00 UTC` }
        : { tone: 'refuse', html: `<span class="sp-pill closed">Closed</span> opens in <b class="num">${clock(toOpen)}</b> · ${String(p.open).padStart(2, '0')}:00 UTC. Curve trades are refused until then.` };
    }
    case 'seasoned-sells': {
      if (!held || !pos.firstAt) return { tone: 'info', html: `Day one: sell up to ${p.base}% of your balance at once, +${p.step}% each hour held` };
      const hrs = Math.floor((now - pos.firstAt) / 3.6e6), share = Math.min(100, p.base + p.step * hrs);
      return { tone: share >= 100 ? 'ok' : 'info', html: `You can sell <b class="num">${share}%</b> of your balance at once${share < 100 ? ` · +${p.step}% in <b class="num">${clock(3600 - ((now - pos.firstAt) / 1000) % 3600)}</b>` : ''}` };
    }
    case 'outflow-cap': {
      const used = Math.min(p.pct, x.hourSoldPct);
      return { tone: used > p.pct * 0.8 ? 'warn' : 'info', html: `This hour: <b class="num">${used.toFixed(2)}%</b> of ${pc(p.pct)} sold · resets in <b class="num">${clock(nextHourS())}</b>${meter(used / p.pct, used > p.pct * 0.8 ? 'hot' : '')}` };
    }
    case 'lock-in': {
      const prog = coin.progress * 100;
      return prog < p.pct
        ? { tone: 'refuse', html: `Sells closed · curve <b class="num">${prog.toFixed(1)}%</b> of ${p.pct}% · opens after ~<b class="num">${((p.pct - prog) / 100 * GRAD_SOL).toFixed(1)} SOL</b> more in buys${meter(prog / p.pct, 'lock')}` }
        : { tone: 'ok', html: `Sells open since the curve passed ${p.pct}%` };
    }
    case 'sniper-fee-burn': {
      const fee = feeAt(coin.stack, ageS);
      return ageS < p.seconds && !grad ? { tone: 'warn', html: `Fee now <b class="num">${fee.toFixed(1)}%</b> · back to 1% in <b class="num">${clock(p.seconds - ageS)}</b>` }
        : { tone: 'ok', html: `Fee is 1%. The first ${p.seconds}s charged up to ${p.start}% and the extra was burned.` };
    }
    case 'buyback-burn': return { tone: 'info', html: `Next keeper buyback in <b class="num">${clock(nextHourS())}</b> · ${p.pct}% of creator fees${grad ? ', now from LP fees' : ''}` };
    case 'leftover-burn': return grad ? { tone: 'ok', html: 'Unsold curve tokens were burned in the migration' } : { tone: 'info', html: 'Unsold curve tokens burn in the graduating swap' };
    case 'creator-vest': {
      const cliff = p.cliff * 86400;
      if (ageS < cliff) return { tone: 'info', html: `Cliff: the creator's launch buy is locked for <b class="num">${dur(cliff - ageS)}</b>` };
      const k = Math.min(1, (ageS - cliff) / (p.days * 86400));
      return { tone: 'info', html: `Creator bag <b class="num">${(k * 100).toFixed(1)}%</b> vested${meter(k)}` };
    }
    case 'holder-rewards': return { tone: 'info', html: `Next snapshot in <b class="num">${clock(nextHourS())}</b> · ${p.pct}% of creator fees to wallets over ${pc(p.min)}${held && pos.tokens >= SUPPLY * p.min / 100 ? ' · <b>you qualify</b>' : ''}` };
    case 'first-buyer-rebate': return { tone: 'info', html: `First ${p.n} buyers who still hold at graduation split ${p.pct}% of creator fees` };
    case 'tithe': return { tone: 'info', html: `${p.pct}% of creator fees to a fixed address · next payout in <b class="num">${clock(nextHourS())}</b>` };
    case 'lp-lock': return grad ? { tone: 'ok', html: `${p.pct}% of the DAMM v2 position is locked for good` } : { tone: 'info', html: `Locks ${p.pct}% of the DAMM v2 position at graduation` };
    case 'token-gate': return { tone: 'info', html: `Receivers must hold <b class="num">${(+p.min).toLocaleString('en-US')}</b> ${esc(p.ticker)}` };
    case 'chapters': {
      const ch = chapterOf(p, coin.progress), next = ((ch + 1) / p.n) * 100;
      return { tone: 'info', html: `Chapter <b class="num">${ch + 1} of ${p.n}</b> · wallet cap ${pc(p.first * 2 ** ch)}${ch + 1 < p.n ? ` · next chapter at ${next.toFixed(0)}% curve` : ''}
        <span class="sp-chap">${Array.from({ length: p.n }, (_, i) => `<i class="${i < ch ? 'done' : i === ch ? 'cur' : ''}"></i>`).join('')}</span>` };
    }
    case 'diamond-tiers': {
      if (!held || !pos.firstAt) return { tone: 'info', html: `Wallets that never sell for ${p.hours}h earn a crown · ${p.pct}% of creator fees` };
      if (pos.soldEver) return { tone: 'dim', html: 'You sold, so this wallet can no longer earn a crown' };
      const left = p.hours * 3600 - (now - pos.firstAt) / 1000;
      return left > 0 ? { tone: 'info', html: `Your crown in <b class="num">${dur(left)}</b> if you don't sell${meter(1 - left / (p.hours * 3600))}` } : { tone: 'ok', html: '<b>You wear a crown.</b> The keeper pays your tier hourly.' };
    }
    case 'kingmaker': return { tone: 'info', html: grad ? `The top holder at graduation earns ${p.pct}% of creator fees for 30 days` : `The top holder at graduation earns ${p.pct}% of creator fees for 30 days` };
    case 'locked-metadata': return { tone: 'ok', html: 'Metadata update authority: none' };
    case 'custom': return { tone: 'warn', html: 'Hookscript block · unreviewed' };
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
    const note = b.risk ? `<div class="sp-risk"><b>Risk</b> ${esc(b.risk.replace(' Every coin page shows this in red.', ''))}</div>`
      : b.power ? `<div class="sp-risk"><b>Creator power</b> The creator can block addresses until the list freezes ${esc(s.params.lockAt)}.</div>` : '';
    return `<li class="sp-row${retired ? ' retired' : ''}${b.risk || b.power ? ' risky' : ''}">
      <span class="sp-slot num">${String(i + 1).padStart(2, '0')}</span>
      ${cube(b.family, { size: 44, state: retired ? '' : b.enforcedBy === 'hook' ? 'lit' : '' })}
      <div class="sp-body">
        <div class="sp-top">
          <span class="sp-name">${esc(b.name)}</span>
          <span class="sp-sum">${esc(b.summary(s.params))}</span>
          <span class="sp-enf">${enfBadges(b)}${b.code != null ? `<span class="sp-code num" data-tip="Custom error the engine returns when this block refuses">${hex(b.code)}</span>` : ''}</span>
        </div>
        <div class="sp-live" data-i="${i}"></div>
        ${note}
      </div>
      <span class="sp-cu num" data-tip="${b.cu ? 'Compute units the engine spends on this block per transfer' : 'Runs off the transfer path: no compute on transfers'}">${b.cu ? `${b.cu.toLocaleString('en-US')}<small>CU</small>` : '<span class="dim">—</span><small>off path</small>'}</span>
    </li>`;
  }).join('');
  const empty = Array.from({ length: Math.max(0, ENGINE.maxSlots - coin.stack.length) }, (_, i) => `<li class="sp-row empty"><span class="sp-slot num">${String(coin.stack.length + i + 1).padStart(2, '0')}</span>${cube('x', { size: 44, state: 'empty' })}<div class="sp-body"><span class="dim">Open slot</span></div></li>`).join('');
  const cuK = bud.cu / bud.cuBudget;
  el.innerHTML = `
    <div class="ph"><h3>Rules on this coin <span class="pk">${coin.stack.length} of ${ENGINE.maxSlots} slots</span></h3><span class="sp-legend">${['hook', 'curve', 'crank', 'ext'].filter((e) => bud.enforcers.includes(e)).map((e) => `<span class="enf ${e}"><i></i>${{ hook: 'Hook', curve: 'Curve', crank: 'Crank', ext: 'Mint' }[e]}</span>`).join('')}</span></div>
    <ol class="sp-list">${rows}${empty}</ol>
    <div class="sp-foot">
      <div class="sp-f"><span class="k">Compute</span><span class="v num">${bud.cu.toLocaleString('en-US')} <span class="dim">/ ${bud.cuBudget.toLocaleString('en-US')} CU</span></span>${meter(cuK)}</div>
      <div class="sp-f"><span class="k">Extra accounts</span><span class="v num" data-tip="${esc(bud.accounts.map((a) => a.label).join(' · ') || 'None')}">${bud.accounts.length} <span class="dim">/ ${bud.maxAccounts}</span></span><span class="s">${bud.accounts.length ? esc(bud.accounts.map((a) => a.key === 'stack' ? 'Stack PDA' : a.key.startsWith('wallet') ? 'Wallet records' : a.key === 'pool' ? 'DBC pool' : a.label.split(' (')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')) : 'none'}</span></div>
      <div class="sp-f"><span class="k">Route</span><span class="v">${bud.route === 'record' ? 'hookrz router' : 'Any route'}</span><span class="s">${bud.route === 'record' ? `Opens a Wallet record in your first buy (${sol(bud.walletRecordRentSol)} rent, refunded after graduation). Aggregators work once it exists.` : 'Aggregators and wallets swap it directly.'}</span></div>
      <div class="sp-f"><span class="k">At graduation</span><span class="v">${grad ? 'Hook retired' : 'Hook retires'}</span><span class="s">Hook blocks retire at graduation; Crank blocks keep running on LP fees.</span></div>
    </div>`;
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
