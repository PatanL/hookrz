// Coin page: "Where the fees go", for coins whose rules spend fees (burns, rewards, a tithe, a script's payouts, the
// sniper fee). The routing in one sentence, then per rule what the public keeper has paid, burned and still owes, and its
// latest claims, burns and payouts, each linked to its transaction. Live: GET /v1/coins/:mint/keeper (api.coinKeeper).
// A coin launched in this browser has nothing on a chain, so it shows its routing and an honest empty ledger.
import { api, MODE } from '../api/client.js';
import { FEES } from '../api/contract.js';
import { byId } from '../data/blocks.js';
import { splitView } from '../engine/fees.js';
import { esc } from '../core/format.js';
import { sol, tok, shortKey, pxTile, ruleName } from './coin-shared.js';

const LAMPORTS = 1e9, TOKEN = 1e6;
const DUST = 0.00005; // SOL: below this an amount reads as "less than 0.0001"
/** SOL for the ledger: tiny amounts say so instead of rounding to 0.0000. */
const amt = (x) => (!x ? '0 SOL' : x < DUST ? '<0.0001 SOL' : sol(x));
/** The keeper's bucket notes, in plain words (a dust payout waiting for the minimum isn't worth a line). */
function plainNote(r) {
  const t = String(r.note ?? '');
  if (!t) return null;
  if (/below the payout minimum/.test(t)) return r.owedSol >= DUST ? 'Small amounts wait until there\'s enough to send.' : null;
  if (/^Not routed at launch/.test(t)) return 'This coin launched before fees were routed to its rules, so there is nothing to pay from.';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const pctOf = (x) => `${+(+x).toFixed(3)}%`;
const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const secs = (s) => (s >= 120 && s % 60 === 0 ? `${s / 60} minutes` : s === 60 ? 'minute' : `${s} seconds`);

/** Solscan for the API's network (devnet → ?cluster=devnet); null where there is no public explorer (a local fork). */
export function explorer(mode) {
  if (mode !== 'devnet' && mode !== 'mainnet') return null;
  const q = mode === 'devnet' ? '?cluster=devnet' : '';
  return { tx: (sig) => `https://solscan.io/tx/${sig}${q}`, account: (a) => `https://solscan.io/account/${a}${q}` };
}
export const txLink = (ex, sig, label = 'View transaction') => (!sig ? '' : ex
  ? `<a class="kp-tx mono" href="${esc(ex.tx(sig))}" target="_blank" rel="noopener" title="${esc(sig)}">${esc(shortKey(sig))}<span aria-hidden="true"> ↗</span><span class="sr"> ${label}</span></a>`
  : `<span class="kp-tx mono dim" data-tip="${esc(sig)}">${esc(shortKey(sig))}</span>`);
const acct = (ex, a) => (ex ? `<a class="mono" href="${esc(ex.account(a))}" target="_blank" rel="noopener" title="${esc(a)}">${esc(shortKey(a))}</a>` : `<span class="mono" data-tip="${esc(a)}">${esc(shortKey(a))}</span>`);

/** The coin's fee routing in plain words (one or two sentences). */
export function routingLine(coin, v) {
  const names = v.rules.map((r) => ruleLabel(r).name);
  const list = names.length <= 3 ? names.join(names.length === 3 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1') : 'its rules';
  const parts = [`Every trade pays a ${FEES.tradeFeePct}% fee. Meteora keeps a fifth; hookrz and the creator split the rest.`];
  if (v.rules.length) parts.push(`Of the creator's half, ${+v.shareOfCreatorPct.toFixed(2)}% goes to ${list}; the rest is the creator's${v.creatorViaKeeper ? ', paid out by the keeper' : ''}.`);
  else if (v.creatorViaKeeper) parts.push('The creator\'s half is paid out by the keeper.');
  if (v.sniper) parts.push(`The launch fee above 1% (it started at ${+v.sniper.startPct.toFixed(2)}% and fell over the first ${secs(v.sniper.seconds)}) buys $${coin.ticker} back and burns it.`);
  if (v.lpForRulesPct > 0) parts.push(`After graduation, ${v.lpForRulesPct}% of the pool stays locked to keep paying ${v.rules.length === 1 ? 'it' : 'them'}.`);
  return parts.join(' ');
}

/** What one rule is called here, and where its share goes. */
function ruleLabel(r) {
  if (r.id === 'custom') return { name: 'Own rule', sub: r.label };
  const b = byId[r.id];
  return { name: b ? ruleName(b) : r.label, sub: null };
}

function actionLine(a, coin, rulesByKey, ex) {
  const s = a.lamports != null ? Number(a.lamports) / LAMPORTS : null;
  const t = a.tokens != null ? Number(a.tokens) / TOKEN : null;
  const rule = a.rule ? rulesByKey[a.rule] : null;
  const rn = rule ? ruleLabel(rule).name : null;
  const d = a.detail ?? {};
  if (!a.ok && a.kind !== 'error') return { k: 'Failed', tone: 'bad', text: `${a.kind === 'claim' ? 'A claim' : a.kind === 'burn' ? 'A burn' : 'A payout'}${rn ? ` for ${esc(rn)}` : ''} didn't land. It retries next round.`, tip: d.error ?? null };
  switch (a.kind) {
    case 'claim': return { k: 'Claimed', tone: 'in', text: `${s != null ? `<b>${amt(s)}</b> of fees` : 'Fees'} ${d.source === 'damm-v2' ? 'from the graduated pool' : 'from the curve'}` };
    case 'burn': return { k: 'Burned', tone: 'burn', text: `Bought back and burned ${t != null ? `<b>${tok(t)}</b> $${esc(coin.ticker)}` : `$${esc(coin.ticker)}`}${s != null ? ` for ${amt(s)}` : ''}${rn ? ` · ${esc(rn)}` : ''}` };
    case 'payout': return { k: 'Paid', tone: 'out', text: `<b>${amt(s ?? 0)}</b> to ${a.dest === coin.creator ? 'the creator' : a.dest ? acct(ex, a.dest) : 'a holder'}${rn && a.dest !== coin.creator ? ` · ${esc(rn)}` : ''}` };
    case 'pot': return { k: 'Winner', tone: 'out', text: `New winner ${a.dest ? acct(ex, a.dest) : ''}${rn ? ` · ${esc(rn)}` : ''}` };
    case 'graduation': return { k: 'Graduated', tone: 'in', text: 'The curve filled. Winners and lists are fixed for the rules that pay after graduation.' };
    case 'migrate': return { k: 'Moved', tone: 'in', text: 'Liquidity moved to the graduated pool (Meteora DAMM v2).' };
    case 'deferred': return { k: 'Waiting', tone: 'wait', text: `${rn ? `${esc(rn)}: ` : ''}${esc(d.reason ?? 'waiting for the next round')}` };
    case 'error': return { k: 'Retrying', tone: 'bad', text: 'A step didn\'t finish. It retries next round.', tip: d.error ?? null };
    default: return { k: a.kind, tone: '', text: '' };
  }
}

export function mountKeeper(el, coin) {
  el.innerHTML = `<div class="ph"><h3>Where the fees go</h3></div><div class="kp-body"><div class="skel"><i></i><i></i><i></i></div></div>`;
  Promise.all([api.coinKeeper(coin.ticker), api.health().catch(() => ({ mode: null }))])
    .then(([K, h]) => render(K, explorer(h?.mode)))
    .catch(() => { el.querySelector('.kp-body').innerHTML = '<p class="kp-empty dim">The fee ledger didn\'t load. Refresh to try again.</p>'; });

  function render(K, ex) {
    const abi = null; // the server's routing (K.routing) already counts a script's payouts
    const local = splitView(coin.stack, { abi, tradeFeePct: FEES.tradeFeePct });
    const R = K?.routing;
    // the server's numbers win: they include a Hookscript's payout lines, which only the compiled script knows
    const v = R ? { ...local, shareOfCreatorPct: R.keeperShareOfCreatorPct, creatorViaKeeper: !!R.creatorPassThrough, lpForRulesPct: R.afterGraduation?.partnerLockedLpPct ?? local.lpForRulesPct, rules: (K.rules ?? []).filter((r) => r.sharePct != null) } : local;
    const T = K?.totals ?? {};
    const rules = K?.rules ?? [];
    const rulesByKey = Object.fromEntries(rules.map((r) => [r.key, r]));
    const actions = (K?.actions ?? []).filter((a) => a.kind !== 'error' || a === K.actions[0]).slice(0, 12);
    const any = (T.claimedSol ?? 0) > 0 || actions.length > 0;
    const live = MODE === 'live';
    const n = (x) => (x > 0 ? amt(x) : '—');
    el.innerHTML = `
      <div class="ph"><h3>Where the fees go <span class="pk">paid by the keeper</span></h3>${K?.lastRound ? `<span class="dim kp-last">checked ${ago(K.lastRound * 1000)}</span>` : ''}</div>
      <div class="kp-body">
        <p class="kp-route">${esc(routingLine(coin, v))}</p>
        ${any ? `<div class="kp-tot">
          <div><span class="k">Claimed</span><b class="num">${n(T.claimedSol)}</b></div>
          <div><span class="k">Paid out</span><b class="num">${n(T.paidSol)}</b></div>
          <div><span class="k">Burned</span><b class="num">${T.burnedTokens > 0 ? `${tok(T.burnedTokens)}` : '—'}</b>${T.burnedSol > 0 ? `<small class="num">for ${amt(T.burnedSol)}</small>` : ''}</div>
          <div><span class="k">Still owed</span><b class="num">${n(T.owedSol)}</b></div>
        </div>` : ''}
        <ul class="kp-rules" aria-label="Each rule's share">
          ${rules.map((r) => {
            const L = ruleLabel(r), fam = byId[r.id]?.family ?? 'custom';
            const share = r.sharePct == null ? 'fee above 1%' : `${+r.sharePct.toFixed(2)}% of creator fees`;
            const dest = r.id === 'tithe' && r.to ? ` · to ${acct(ex, r.to)}` : '';
            const nums = r.kind === 'burn'
              ? [`burned <b>${r.burnedTokens > 0 ? `${tok(r.burnedTokens)} $${esc(coin.ticker)}` : 'nothing yet'}</b>${r.burnedSol > 0 ? ` for ${amt(r.burnedSol)}` : ''}`]
              : [`paid <b>${r.paidSol > 0 ? amt(r.paidSol) : 'nothing yet'}</b>`];
            if (r.owedSol >= DUST) nums.push(`owed <b>${amt(r.owedSol)}</b>`);
            const note = plainNote(r);
            return `<li>
              <span class="kp-ic">${pxTile(fam, { size: 30 })}</span>
              <div class="kp-n"><b>${esc(L.name)}</b><span class="dim">${esc(share)}${L.sub ? ` · ${esc(L.sub)}` : ''}${dest}</span>${note ? `<span class="kp-note">${esc(note)}</span>` : ''}</div>
              ${any ? `<span class="kp-nums num">${nums.map((x) => `<span>${x}</span>`).join('<i>·</i>')}</span>` : ''}
            </li>`;
          }).join('')}
        </ul>
        ${any ? `<div class="kp-acts"><div class="kp-ah"><span class="pixel">Latest</span><span class="dim">every step is a public transaction</span></div>
          <ol>${actions.map((a) => {
            const x = actionLine(a, coin, rulesByKey, ex);
            return `<li class="${x.tone}"><span class="kp-k pixel">${esc(x.k)}</span><span class="kp-t"${x.tip ? ` data-tip="${esc(String(x.tip).slice(0, 200))}"` : ''}>${x.text}</span><span class="kp-w dim">${a.at ? ago(a.at) : ''}</span>${txLink(ex, a.sig)}</li>`;
          }).join('')}</ol></div>`
          : `<p class="kp-empty">${pxTile('flow', { size: 26 })}<span><b>Nothing claimed yet.</b> ${live ? `The keeper claims $${esc(coin.ticker)}'s fees as trades build them up, then pays and burns for each rule here, every step with its transaction.` : 'Claims, burns and payouts show here, each with its transaction.'}</span></p>`}
      </div>`;
  }
}
