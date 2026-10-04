// Docs: API reference + live examples, error codes, the fee split.
import { BLOCKS, PRESETS, defaults, hex, rentSol, ENGINE } from '../data/blocks.js';
import { ENDPOINTS, API_BASE, FEES } from '../api/contract.js';
import { api } from '../api/client.js';
import { esc } from '../core/format.js';
import { tintJSON } from './docs-hookscript.js';

const n = (x) => x.toLocaleString('en-US');

// ───────── API reference ─────────
export function apiReference() {
  const groups = [...new Set(ENDPOINTS.map((e) => e.group))];
  return `<div class="api-base"><span class="pixel">Base URL</span><code>${esc(API_BASE)}</code><span class="dim">JSON over HTTPS · one WebSocket for the stream</span></div>
  <div class="api-groups">${groups.map((g) => `<section class="api-group"><h4>${esc(g)}</h4><ul>${ENDPOINTS.filter((e) => e.group === g).map((e) => `
    <li><span class="api-m m-${e.method.toLowerCase()}">${e.method}</span><div><code class="api-path">${esc(e.path).replace(/(:[a-z]+)/g, '<em>$1</em>')}</code><p>${esc(e.desc)}</p></div></li>`).join('')}</ul></section>`).join('')}</div>`;
}

const round = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isInteger(x) ? +x.toPrecision(6) : x)));

/** Three live calls against the API client, pretty-printed and trimmed. */
export async function apiExamples(root) {
  const fair = PRESETS.find((p) => p.id === 'fair-launch');
  const stack = fair.slots.map(([id]) => ({ id }));
  const quoteReq = { ticker: 'SLOW', side: 'sell', amount: 15_000_000, wallet: { balance: 20_000_000 } };
  const launchReq = { meta: { name: 'Fair Weather', ticker: 'FAIR' }, stack, creator: '7xKq…creator' };
  const [val, quote, launch] = await Promise.all([api.validate(stack), api.quote(quoteReq), api.prepareLaunch(launchReq)]);
  const ex = [
    {
      id: 'validate', method: 'POST', path: '/v1/stacks/validate', req: { stack },
      res: round({ ok: val.ok, slots: val.slots, cu: val.cu, cuBudget: val.cuBudget, accounts: val.accounts.map((a) => a.key), maxAccounts: val.maxAccounts, rentSol: val.rentSol, route: val.route, enforcers: val.enforcers, warnings: val.warnings }),
      note: 'Fair Launch: three Hook blocks and a Curve block. 9,900 CU of a 30,000 budget, one extra account, any route.',
    },
    {
      id: 'quote', method: 'POST', path: '/v1/quote', req: { mint: 'SLOW', side: 'sell', amount: quoteReq.amount, wallet: quoteReq.wallet },
      res: round({ ok: quote.ok, refusedBy: quote.refusedBy, code: quote.code != null ? hex(quote.code) : null, message: quote.message, maxAllowed: Math.abs(quote.maxAllowed - Math.round(quote.maxAllowed)) < 0.01 ? Math.round(quote.maxAllowed) : Math.floor(quote.maxAllowed), out: quote.out, price: quote.price }),
      note: 'A 1.5%-of-supply sell into a Sell Cap of 1%: the quote names the block, its error, and the largest sell that passes now.',
    },
    {
      id: 'launch', method: 'POST', path: '/v1/launch/prepare', req: { meta: launchReq.meta, stack, creator: launchReq.creator },
      res: round({ mint: launch.mint, instructions: launch.instructions.map((x) => `${x.program}: ${x.ix}`), txBytes: launch.txBytes, txLimit: launch.txLimit, rentSol: launch.rentSol, launchCostSol: launch.launchCostSol, signers: launch.signers, transaction: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAA…(base64, unsigned)' }),
      note: 'One unsigned transaction: mint, DBC config, pool, Stack, account list. The creator and the fresh mint keypair sign it.',
    },
  ];
  root.innerHTML = `<div class="apx panel">
    <div class="apx-tabs" role="tablist">${ex.map((e, i) => `<button role="tab" data-x="${i}"><span class="api-m m-${e.method.toLowerCase()}">${e.method}</span><code>${e.path}</code></button>`).join('')}</div>
    <div class="apx-body" data-o="x"></div></div>`;
  const show = (i) => {
    const e = ex[i];
    root.querySelectorAll('[data-x]').forEach((b) => { b.classList.toggle('on', +b.dataset.x === i); b.setAttribute('aria-selected', String(+b.dataset.x === i)); });
    root.querySelector('[data-o="x"]').innerHTML = `<p class="apx-note">${esc(e.note)}</p>
      <div class="apx-cols"><div><span class="pixel">Request</span><pre class="json"><code>${tintJSON(e.req)}</code></pre></div>
      <div><span class="pixel">Response · 200</span><pre class="json"><code>${tintJSON(e.res)}</code></pre></div></div>`;
  };
  root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => show(+b.dataset.x)));
  show(0);
  return { val, quote, launch };
}

// ───────── errors ─────────
export const ENGINE_ERRORS = [
  { code: 0x1770, name: 'NotInTransfer', msg: 'Not inside a transfer of this mint. Direct calls and calls from another coin\'s hook are refused.' },
  { code: 0x17fd, name: 'MissingWalletRecord', msg: 'The receiving token account has no Wallet record for this coin. Buy through hookrz once, or open the record first.' },
  { code: 0x17fe, name: 'HookLive', msg: 'The hook is still live. Wallet records and the Stack close after graduation.' },
  { code: 0x17ff, name: 'StackLocked', msg: 'Only the pool creator can initialize this coin\'s stack, and only once.' },
];

export function errorTable() {
  const blocks = BLOCKS.filter((b) => b.code != null).sort((a, b) => a.code - b.code);
  return `<div class="tscroll"><table class="table dc-etable"><thead><tr><th>Code</th><th>Block</th><th>Message, default settings</th></tr></thead><tbody>
    ${blocks.map((b) => `<tr><td class="mono code">${hex(b.code)}<small>${b.code}</small></td><td><a href="blocks.html?b=${b.id}">${esc(b.name)}</a></td><td class="msg">${esc(b.error(defaults(b.id)))}${b.id === 'custom' ? '<span class="dim"> (or the rule\'s own <code>because</code> message)</span>' : ''}</td></tr>`).join('')}
    <tr class="sep"><td colspan="3"><span class="pixel">Engine</span></td></tr>
    ${ENGINE_ERRORS.map((e) => `<tr><td class="mono code">${hex(e.code)}<small>${e.code}</small></td><td class="mono">${e.name}</td><td class="msg">${esc(e.msg)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ───────── fees ─────────
const FEE_TONE = { Creator: 'c', hookrz: 'p', 'Stack author': 'a' };
export function feesVisual() {
  const cells = FEES.split.flatMap((s) => Array.from({ length: s.pct }, () => FEE_TONE[s.who] ?? 'p'));
  const per = 1000 * FEES.tradeFeePct / 100;
  return `<div class="fees">
    <div class="fees-grid" role="img" aria-label="${FEES.split.map((s) => `${s.who} ${s.pct}`).join(', ')} of every 100 fee units">${cells.map((t, i) => `<i class="t-${t}" style="--i:${i}"></i>`).join('')}</div>
    <div class="tscroll"><table class="table fees-table"><thead><tr><th>Who</th><th class="r">Of every 100</th><th class="r">Per 1,000 SOL traded</th><th>How it's paid</th></tr></thead><tbody>
      ${FEES.split.map((s) => `<tr><td><span class="fsw t-${FEE_TONE[s.who] ?? 'p'}"></span><b>${esc(s.who)}</b></td><td class="mono r">${s.pct}</td><td class="mono r">${(per * s.pct / 100).toFixed(2)} SOL</td><td class="note">${esc(s.note)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td><b>Trading fee</b></td><td class="mono r">100</td><td class="mono r">${per.toFixed(2)} SOL</td><td class="note">${FEES.tradeFeePct}% of every curve trade, buys and sells.</td></tr></tfoot></table></div>
  </div>
  <dl class="fees-facts">
    <div><dt>Launch</dt><dd><span class="mono">${FEES.launchCostSol} SOL</span> plus rent: <span class="mono">${rentSol(ENGINE.stackBytes).toFixed(4)} SOL</span> for the Stack and about <span class="mono">${rentSol(8 + 4 + 35).toFixed(4)} SOL</span> for a one-entry account list. The rent comes back after graduation.</dd></div>
    <div><dt>Wallet record</dt><dd><span class="mono">${rentSol(ENGINE.walletRecordBytes).toFixed(4)} SOL</span> rent, only on stacks that keep per-holder records. Refunded to the holder after graduation.</dd></div>
    <div><dt>Refused transfer</dt><dd>The network fee only. Nothing settles, nothing else is charged.</dd></div>
  </dl>`;
}
