// Docs: engine architecture, account layouts, the live budget panel and the launch timeline.
import { BLOCKS, ENGINE, ENFORCERS, PRESETS, byId, rentSol, familyOf } from '../data/blocks.js';
import { budget } from '../engine/engine.js';
import { SERVICES, LAUNCH_IXS } from '../api/contract.js';
import { cube } from './icons.js';
import { esc } from '../core/format.js';
import { tintJSON } from './docs-hookscript.js';

const svc = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
const n = (x) => x.toLocaleString('en-US');
export const solf = (x, d = 4) => `${x.toFixed(d)} SOL`;

// ───────── architecture ─────────
export function archDiagram() {
  const node = (cls, kind, name, line) => `<div class="arch-node ${cls}"><span class="pixel">${kind}</span><b>${name}</b><small>${line}</small></div>`;
  const arrow = (label) => `<div class="arch-arrow" aria-hidden="true"><span class="mono">${label}</span></div>`;
  const off = (cls, s, line, link) => `<div class="arch-off ${cls}"><span class="pixel">Off chain · ${esc(s.kind)}</span><b>${esc(s.name)}</b><small>${line}</small><em class="mono">${link}</em></div>`;
  return `<figure class="arch" aria-label="hookrz architecture">
    <div class="arch-band" aria-hidden="true"><span class="pixel">On chain · Solana</span></div>
    ${off('a-api', svc.api, 'Unsigned transactions, rule-aware quotes, stack validation', '↓ tx for the wallet to sign')}
    ${off('a-hs', svc.hookscript, 'English to Hookscript, CU measured, fuzzed', '↓ ops into the Stack at launch')}
    ${node('n-wallet', 'Signer', 'Wallet', 'Signs the swap or launch')}
    ${arrow('swap')}
    ${node('n-router', 'Program', 'hookrz router', 'Opens Wallet records, resolves hook accounts')}
    ${arrow('CPI')}
    ${node('n-dbc', 'Meteora', 'DBC pool', 'Bonding curve, fee vaults, hook authority')}
    ${arrow('transfer')}
    ${node('n-t22', 'Program', 'Token-2022', 'Moves the coin, calls the hook')}
    ${arrow('Execute')}
    ${node('n-engine', 'Program', 'hookrz_engine', 'Runs the stack. Can only refuse.')}
    ${off('a-keeper', svc.keeper, 'Claims fee vaults, buys back and burns, pays rewards and royalties', '↑ public crank txs')}
    ${off('a-idx', svc.indexer, 'Coins, trades, verdicts and lineage into Postgres; the live stream', '↑ follows engine, DBC, DAMM v2')}
  </figure>`;
}

// ───────── account layouts ─────────
function rows(list) {
  let off = 0;
  return list.map(([field, type, bytes, note, grp]) => { const r = { off, field, type, bytes, note, grp }; off += bytes; return r; });
}
export const STACK_LAYOUT = rows([
  ['discriminator', '[u8; 8]', 8, 'Account type tag', 'h'],
  ['version', 'u8', 1, 'Layout version (1)', 'h'],
  ['bump', 'u8', 1, 'PDA bump', 'h'],
  ['flags', 'u16', 2, 'Armed · blocklist frozen · has wallet records · has script', 'h'],
  ['slot_count', 'u8', 1, '1 to 6', 'h'],
  ['reserved', '[u8; 3]', 3, '', 'h'],
  ['mint', 'Pubkey', 32, 'The coin', 'k'],
  ['creator', 'Pubkey', 32, 'The pool creator: the only signer init_stack accepts, and who gets the rent back from close_stack', 'k'],
  ['pool', 'Pubkey', 32, 'Meteora DBC virtual pool', 'k'],
  ['base_vault', 'Pubkey', 32, 'DBC base vault. Out of it = buy, into it = sell', 'k'],
  ['parent_stack', 'Pubkey', 32, 'The Stack this one remixed; zero for an original', 'k'],
  ['parent_author', 'Pubkey', 32, 'Creator of the parent Stack, copied at init: the royalty receiver', 'k'],
  ['launch_slot', 'u64', 8, 'Slot of init_stack: time zero for every block', 't'],
  ['launch_ts', 'i64', 8, 'Unix time of init_stack', 't'],
  [`slots[${ENGINE.maxSlots}]`, '[Slot; 6]', ENGINE.maxSlots * 58, `${ENGINE.maxSlots} × 58 bytes, run in order`, 's'],
  ['script', '[u8; 64]', 64, 'Compiled Hookscript: up to 16 four-byte ops (Custom block)', 'x'],
  ['reserved', '[u8; 4]', 4, '', 'x'],
]);
export const SLOT_LAYOUT = rows([
  ['block_id', 'u16', 2, 'Catalog id; 0 = empty slot', 's'],
  ['params', '[u8; 24]', 24, 'Packed settings. Snipe Shield: window u32 + max in bps u16', 's'],
  ['state', '[u8; 32]', 32, 'Block counters. Anti-Bundle: current slot + buys in it. Circuit Breaker: window index + opening sqrt price', 's'],
]);
export const WALLET_LAYOUT = rows([
  ['discriminator', '[u8; 8]', 8, 'Account type tag', 'h'],
  ['version', 'u8', 1, 'Layout version (1)', 'h'],
  ['bump', 'u8', 1, 'PDA bump', 'h'],
  ['flags', 'u8', 1, 'Has pass · has sold · crowned', 'h'],
  ['lot_count', 'u8', 1, '0 to 5', 'h'],
  ['first_receipt_ts', 'i64', 8, 'First time this account received the coin. Seasoned Sells, Diamond Tiers, wallet.first_receipt', 't'],
  ['last_buy_slot', 'u64', 8, 'Sandwich Guard', 't'],
  ['last_sell_ts', 'i64', 8, 'Sell Cooldown', 't'],
  ['lots[5]', '[Lot; 5]', 60, '5 × { seconds since launch u32, amount u64 }. Hold Timer, wallet.received(window)', 's'],
]);
const GRP = { h: 'Header', k: 'Keys', t: 'Times', s: 'Slots / lots', x: 'Script' };

export function byteMap(layout, total) {
  const groups = [];
  for (const r of layout) { const g = groups.at(-1); if (g && g.grp === r.grp) g.bytes += r.bytes; else groups.push({ grp: r.grp, bytes: r.bytes }); }
  return `<div class="bmap" role="img" aria-label="Byte map, ${total} bytes">${groups.map((g) => `<span class="g-${g.grp}" style="flex:${g.bytes}" title="${GRP[g.grp]}: ${g.bytes} bytes"><b>${GRP[g.grp]}</b><i class="mono">${g.bytes}</i></span>`).join('')}</div>`;
}

export function layoutTable(layout, { total } = {}) {
  const sum = layout.reduce((a, r) => a + r.bytes, 0);
  return `<div class="tscroll"><table class="table dc-ltable"><thead><tr><th>Offset</th><th>Field</th><th>Type</th><th class="r">Bytes</th><th>What</th></tr></thead><tbody>
    ${layout.map((r) => `<tr><td class="mono dim">${r.off}</td><td class="mono"><span class="sw g-${r.grp}"></span>${esc(r.field)}</td><td class="mono dim">${esc(r.type)}</td><td class="mono r">${r.bytes}</td><td class="note">${esc(r.note)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td colspan="2">Total</td><td class="mono r">${sum}${total && total !== sum ? ` ≠ ${total}` : ''}</td><td class="note">${total ? `Rent-exempt: <span class="mono">${solf(rentSol(sum), 5)}</span>` : ''}</td></tr></tfoot></table></div>`;
}

/** Every entry an ExtraAccountMetaList can hold, and which hook blocks add it. */
export function metaEntries() {
  const map = new Map();
  for (const b of BLOCKS.filter((x) => x.enforcedBy === 'hook')) {
    for (const a of budget([{ id: b.id }]).accounts) {
      if (!map.has(a.key)) map.set(a.key, { ...a, by: [] });
      map.get(a.key).by.push(b);
    }
  }
  return [...map.values()];
}
export function metaTable() {
  const list = metaEntries();
  return `<div class="tscroll"><table class="table dc-mtable"><thead><tr><th>Entry</th><th>Resolves to</th><th>Added by</th></tr></thead><tbody>
    ${list.map((e) => `<tr><td class="mono">${esc(e.key)}</td><td>${esc(e.label)}</td><td class="by">${e.key === 'stack' ? '<span class="dim">every stack with a Hook block</span>' : e.by.map((b) => `<a href="blocks.html?b=${b.id}">${esc(b.name)}</a>`).join(', ')}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// ───────── live budget panel ─────────
const CU_SHADES = ['#8fcaff', '#6fb4ff', '#4d9bff', '#3b84ea', '#2f6fd0', '#2a5fb5'];

export function budgetPanel(root) {
  let pi = 0;
  root.innerHTML = `<div class="bud panel">
    <div class="bud-tabs" role="tablist" aria-label="Preset stacks">${PRESETS.map((p, i) => `<button role="tab" data-p="${i}">${esc(p.name)}</button>`).join('')}</div>
    <div class="bud-body" data-o="body" aria-live="polite"></div>
  </div>`;
  const render = () => {
    const p = PRESETS[pi], stack = p.slots.map(([id, params]) => ({ id, params })), r = budget(stack);
    root.querySelectorAll('[data-p]').forEach((x) => { x.classList.toggle('on', +x.dataset.p === pi); x.setAttribute('aria-selected', String(+x.dataset.p === pi)); });
    const hooks = stack.map((s) => byId[s.id]).filter((b) => b.enforcedBy === 'hook');
    const seg = (w, cls, title, color = '') => `<span class="${cls}" style="width:${(w / r.cuBudget) * 100}%;${color ? `background:${color}` : ''}" title="${esc(title)}"></span>`;
    root.querySelector('[data-o="body"]').innerHTML = `
      <p class="bud-blurb"><b>${esc(p.name)}.</b> ${esc(p.blurb)} <span class="mono dim">budget(${esc(p.id)})</span></p>
      <div class="bud-stack">${stack.map((s, i) => { const b = byId[s.id]; return `<a class="bud-slot" href="blocks.html?b=${b.id}"><span class="mono dim">${i + 1}</span>${cube(b.family, { size: 28 })}<span>${esc(b.name)}</span><span class="enf ${b.enforcedBy}"><i></i>${ENFORCERS[b.enforcedBy].name}</span></a>`; }).join('')}
        ${Array.from({ length: r.maxSlots - stack.length }, (_, i) => `<span class="bud-slot empty"><span class="mono dim">${stack.length + i + 1}</span>${cube('x', { size: 28, state: 'empty' })}<span class="dim">empty</span></span>`).join('')}</div>
      <div class="bud-cu">
        <div class="row between"><span class="pixel">Compute per transfer</span><span class="mono"><b>${n(r.cu)}</b> <span class="dim">/ ${n(r.cuBudget)} CU</span></span></div>
        <div class="bud-bar">${r.hasHook ? seg(ENGINE.cuBase, 'base', `Engine base ${n(ENGINE.cuBase)} CU`) + hooks.map((b, i) => seg(b.cu, 'blk', `${b.name} ${n(b.cu)} CU`, CU_SHADES[i % 6])).join('') : ''}</div>
        <div class="bud-legend">${r.hasHook ? `<span><i class="base"></i>Engine base <b class="mono">${n(ENGINE.cuBase)}</b></span>${hooks.map((b, i) => `<span><i style="background:${CU_SHADES[i % 6]}"></i>${esc(b.name)} <b class="mono">${n(b.cu)}</b></span>`).join('')}` : '<span class="dim">No Hook blocks: the mint has no transfer hook and the engine never runs.</span>'}</div>
      </div>
      <dl class="bud-stats">
        <div><dt>Extra accounts</dt><dd class="num">${r.accounts.length}<span class="dim"> / ${r.maxAccounts}</span></dd></div>
        <div><dt>Stack + list rent</dt><dd class="num">${r.rentSol ? solf(r.rentSol) : '0 SOL'}</dd></div>
        <div><dt>Route</dt><dd>${r.route === 'record' ? 'Wallet record' : 'Any route'}</dd></div>
        <div><dt>Enforcers</dt><dd class="bud-enf">${r.enforcers.map((e) => `<span class="enf ${e}"><i></i>${ENFORCERS[e].name}</span>`).join('')}</dd></div>
      </dl>
      ${r.accounts.length ? `<div class="bud-accts"><span class="pixel">ExtraAccountMetaList</span><ol>${r.accounts.map((a) => `<li><span class="mono">${esc(a.key)}</span> ${esc(a.label)}</li>`).join('')}</ol></div>` : ''}
      ${r.warnings.length ? `<ul class="bud-warn">${r.warnings.map((w) => `<li class="${w.level}"><span class="chip ${w.level === 'risk' || w.level === 'error' ? 'refuse' : w.level === 'warn' ? 'warnchip' : 'ice'}">${w.level === 'info' ? 'Note' : w.level}</span><span>${esc(w.text)}</span></li>`).join('')}</ul>` : `<p class="bud-ok"><span class="dot ice"></span> Valid: within every engine limit, no warnings.</p>`}
      <details class="bud-raw"><summary>Raw <span class="mono">budget()</span> output</summary><pre class="json"><code>${tintJSON({ ...r, accounts: r.accounts.map((a) => a.key), rentSol: +r.rentSol.toFixed(6), walletRecordRentSol: +r.walletRecordRentSol.toFixed(6), warnings: r.warnings.map((w) => `${w.level}: ${w.text}`) })}</code></pre></details>`;
  };
  root.querySelectorAll('[data-p]').forEach((x) => x.addEventListener('click', () => { pi = +x.dataset.p; render(); }));
  render();
}

// ───────── launch timeline ─────────
export function launchTimeline() {
  return `<ol class="ltl">${LAUNCH_IXS.map((x, i) => `<li>
    <span class="ltl-n mono">${i + 1}</span>
    <div class="ltl-c"><div class="ltl-h"><span class="chip${x.program.includes('hookrz') ? ' ice' : ''}">${esc(x.program)}</span><code>${esc(x.ix)}</code></div><p>${esc(x.note)}</p></div>
  </li>`).join('')}</ol>`;
}

export function txBar(bytes, limit) {
  const pct = Math.min(100, (bytes / limit) * 100);
  return `<div class="txbar"><div class="row between"><span class="pixel">Launch transaction, Fair Launch stack</span><span class="mono"><b>${n(bytes)}</b> <span class="dim">/ ${n(limit)} bytes</span></span></div>
    <div class="txbar-track"><span style="width:${pct}%"></span></div><p class="dim">${n(limit - bytes)} bytes to spare. Every stack fits: ${ENGINE.maxSlots} slots add at most ${ENGINE.maxSlots * 26} bytes of instruction data.</p></div>`;
}

export { familyOf };
