// Build page: the live budget column — compute, accounts, rent, route, enforcers, warnings,
// what happens at graduation, and the fee split (from FEES in src/api/contract.js).
import { ENFORCERS, ENGINE, byId, rentSol } from '../data/blocks.js';
import { FEES } from '../api/contract.js';
import { cube } from './icons.js';
import { esc } from '../core/format.js';
import { launchProblem } from './hs-editor.js';

/** Launch blockers the engine's budget() doesn't know about (page-level). */
export function pageWarnings(S) {
  const out = [];
  if (!S.stack.length) out.push({ level: 'need', text: 'Add at least one block. hookrz coins launch with a stack.' });
  for (const s of S.stack) {
    if (s.id !== 'custom') continue;
    const p = launchProblem(s.draft);
    if (p) out.push({ ...p, id: s.id });
  }
  return out;
}

const LEVEL = { error: 'Blocks launch', need: 'Needed', risk: 'Risk', warn: 'Heads up', info: 'Note' };

export function budgetHTML(S, c) {
  const { b, warnings } = c;
  const hooks = S.stack.map((s) => byId[s.id]).filter((x) => x.enforcedBy === 'hook');
  const errors = warnings.filter((w) => w.level === 'error' || w.level === 'need');
  const status = !S.stack.length ? ['idle', 'Empty rack'] : errors.length ? ['bad', `${errors.length} to fix`] : ['ok', 'Ready to launch'];
  const cuPct = (n) => (n / ENGINE.cuBudget) * 100;
  const over = b.cu > ENGINE.cuBudget;
  const segs = b.hasHook ? [`<i class="seg base" style="width:${cuPct(ENGINE.cuBase)}%" title="Dispatch and account checks: ${ENGINE.cuBase.toLocaleString('en-US')} CU"></i>`,
    ...hooks.map((h) => `<i class="seg" style="width:${cuPct(h.cu)}%" title="${esc(h.name)}: ${h.cu.toLocaleString('en-US')} CU"></i>`)].join('') : '';
  const pips = Array.from({ length: b.maxAccounts }, (_, i) => `<i class="${i < b.accounts.length ? 'on' : ''}${i === 0 && b.accounts.length ? ' stack' : ''}"></i>`).join('');
  const rec = rentSol(ENGINE.walletRecordBytes);

  // lifetime: who runs when
  const blocks = S.stack.map((s) => byId[s.id]);
  const retire = blocks.filter((x) => x.enforcedBy === 'hook');
  const keep = blocks.filter((x) => x.enforcedBy === 'crank' || x.also === 'crank');
  const fixed = blocks.filter((x) => (x.enforcedBy === 'curve' || x.enforcedBy === 'ext'));
  const cubes = (list) => list.length ? list.map((x) => cube(x.family, { size: 18, title: x.name })).join('') : '<span class="dim">none</span>';


  return `<div class="bud-in">
  <div class="bud-head"><span class="eyebrow">Budget</span><span class="bud-status ${status[0]}" role="status">${status[0] === 'ok' ? '<i class="dot"></i>' : status[0] === 'bad' ? '<i class="dot refuse"></i>' : ''}${status[1]}</span></div>

  <div class="mt">
    <div class="mt-top"><span>Compute per transfer</span><span class="mono"><b class="${over ? 'bad' : ''}">${b.cu.toLocaleString('en-US')}</b> / ${ENGINE.cuBudget.toLocaleString('en-US')} CU</span></div>
    <div class="mt-bar${over ? ' over' : ''}" role="meter" aria-label="Compute units per transfer" aria-valuemin="0" aria-valuemax="${ENGINE.cuBudget}" aria-valuenow="${b.cu}">${segs}</div>
    <div class="mt-foot mono">${b.hasHook ? `dispatch ${ENGINE.cuBase.toLocaleString('en-US')} + ${hooks.length} hook block${hooks.length === 1 ? '' : 's'} · on top of the swap` : 'No hook blocks: no transfer hook, 0 CU'}</div>
  </div>

  <div class="mt">
    <div class="mt-top"><span>Extra accounts</span><span class="mono"><b>${b.accounts.length}</b> / ${b.maxAccounts}</span></div>
    <div class="pips" role="meter" aria-label="Extra accounts" aria-valuemin="0" aria-valuemax="${b.maxAccounts}" aria-valuenow="${b.accounts.length}">${pips}</div>
    ${b.accounts.length ? `<details class="mt-more"><summary>ExtraAccountMetaList</summary><ol>${b.accounts.map((a) => `<li>${esc(a.label)}</li>`).join('')}</ol></details>` : '<div class="mt-foot">Nothing for wallets or aggregators to resolve.</div>'}
  </div>

  <dl class="kv">
    <div><dt>Rent at launch</dt><dd><b class="mono">${b.rentSol ? `${b.rentSol.toFixed(4)} SOL` : '0 SOL'}</b><span>${b.hasHook ? `Stack PDA (${ENGINE.stackBytes} B) + ExtraAccountMetaList` : 'No Stack account needed'}</span></dd></div>
    <div><dt>Wallet records</dt><dd>${b.walletRecordRentSol ? `<b class="mono">~${rec.toFixed(4)} SOL</b><span>per new holder, refunded after graduation. The hookrz router opens it inside the buy.</span>` : '<b>Not needed</b><span>No block keeps per-wallet state.</span>'}</dd></div>
    <div><dt>Route</dt><dd>${b.route === 'any' ? '<b>Every route</b><span>Jupiter and other aggregators can trade it from the first block.</span>' : '<b>hookrz router + aggregators once a wallet record exists</b><span>A new holder\'s first buy goes through the hookrz router.</span>'}</dd></div>
    <div><dt>Enforcers</dt><dd class="enfs">${b.enforcers.length ? b.enforcers.map((k) => `<span class="enf ${k}" title="${esc(ENFORCERS[k].long)}"><i></i>${ENFORCERS[k].name}</span>`).join('') : '<span class="dim">none yet</span>'}</dd></div>
  </dl>

  ${warnings.length ? `<ul class="warns" aria-label="Warnings">${warnings.map((w) => `<li class="w ${w.level}">
    <span class="w-k pixel">${LEVEL[w.level]}</span><span class="w-t">${esc(w.text)}</span>${w.id ? `<button class="w-go" data-act="selWarn" data-id="${w.id}">Open</button>` : ''}</li>`).join('')}</ul>` : ''}

  <div class="life">
    <div class="sub pixel">Lifetime</div>
    <ol class="life-line">
      <li><span class="life-k">On the curve</span><span class="life-c">${cubes(retire)}</span><span class="life-t">Hook blocks refuse transfers from the first trade.</span></li>
      <li class="grad"><span class="life-k">Graduation</span><span class="life-t">The DBC pool removes the hook in the graduating swap and the coin migrates to DAMM v2. Hook blocks retire.</span></li>
      <li><span class="life-k">After</span><span class="life-c">${cubes(keep)}</span><span class="life-t">Crank blocks keep running on LP fees.</span></li>
    </ol>
    ${fixed.length ? `<div class="life-fixed"><span class="life-c">${cubes(fixed)}</span><span>Set at launch in the curve config or the mint. Nothing to run.</span></div>` : ''}
  </div>

  <div class="fees">
    <div class="sub pixel">Fee split · ${FEES.tradeFeePct}% of every trade</div>
    <div class="fee-bar" aria-hidden="true">${FEES.split.map((f, i) => `<i class="f${i}" style="width:${f.pct}%"></i>`).join('')}</div>
    <ul class="fee-rows">
      ${FEES.split.map((f, i) => {
        const you = /creator/i.test(f.who);
        const to = you ? 'You' : esc(f.who);
        const sub = esc(f.note ?? '');
        return `<li class="${you ? 'you' : ''}"><i class="sw f${i}"></i><span class="fr-who">${f.who}<span>${sub}</span></span><span class="fr-to">${to}</span><span class="fr-pct mono">${f.pct}%<span>${((FEES.tradeFeePct * f.pct) / 100).toFixed(2)}% of volume</span></span></li>`;
      }).join('')}
    </ul>
  </div>

  <div class="bud-go">
    <button class="btn btn-glass btn-sm" data-act="toSim">Simulate launch</button>
    <button class="btn btn-chrome btn-sm" data-act="toLaunch" ${c.ok ? '' : 'disabled'}>Launch ${'<svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8h11M9 4l4 4-4 4"/></svg>'}</button>
  </div></div>`;
}
