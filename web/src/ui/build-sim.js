// Build page: "Simulate launch" — the stack vs no rules against the same seeded crowd.
// KPI comparison, a market-cap chart with both series, refusals by block, the crowd table
// and sample refused transfers. The chart is drawn at the container's real pixel width.
import { ARCHETYPES, SUPPLY, fmtSol } from '../engine/sim.js';
import { byId, hex } from '../data/blocks.js';
import { cube, ICON } from './icons.js';
import { voxelSVG } from './voxel.js';
import { esc, num, clock } from '../core/format.js';

const WALLETS = Object.values(ARCHETYPES).reduce((a, x) => a + x.n, 0);
const CROWD = {
  sniper: 'Buy 0.8–3 SOL in the first three seconds, dump within ten minutes.',
  bundler: 'Seventeen wallets buy in one slot, consolidate, then sell from one.',
  sandwich: 'Buy and sell around other trades, ten round trips each.',
  whale: 'Buy 6–14 SOL twice, sell everything hours later.',
  flipper: 'Buy, then sell within twenty minutes. Retry smaller if refused.',
  paper: 'Buy small, sell within one to two hours.',
  believer: 'Buy one to three times across six hours and mostly hold.',
  creator: 'Buys 1 SOL at launch, tries to sell it all 45–75 minutes in.',
};
const ONE = { sniper: 'Sniper', bundler: 'Bundle wallet', sandwich: 'Sandwich bot', whale: 'Whale', flipper: 'Flipper', paper: 'Paper hands', believer: 'Believer', creator: 'Creator' };
const THREAT = { refuse: 'bot', warn: 'fast', ice: 'hold' };
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const sol = (x) => `${x > 0 ? '+' : ''}${fmtSol(x)}`;

export function secHead(n, eyebrow, title, lede) {
  return `<div class="sec-num" aria-hidden="true">${voxelSVG(n, { cell: 5, gap: 0.8, depth: 0.36, glow: true })}</div>
    <div class="sec-txt"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p class="lede">${lede}</p></div>`;
}

export function simHTML(S, currentSig) {
  const { res, busy, seed, err } = S.sim;
  const stale = res && S.sim.sig !== currentSig;
  return `
  <div class="sec-head">
    ${secHead('02', 'Simulation', 'Simulate launch', `Run the stack against a seeded crowd of ${WALLETS} wallets for the first six hours. The same crowd trades the same curve with no rules, side by side. Every transfer goes through the engine's reference code.`)}
    ${res ? `<div class="sim-ctl">
      <span class="crowd-id"><span class="pixel">Crowd</span><b class="mono">#${String(seed).padStart(4, '0')}</b></span>
      <button class="btn btn-glass" data-act="crowd" data-fk="sim-crowd" ${busy ? 'disabled' : ''} title="Same stack, a different seeded crowd">New crowd</button>
      <button class="btn btn-chrome" data-act="sim" data-fk="sim-run" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin" aria-hidden="true"></span>Running…' : 'Run again'}${busy ? '' : ICON.arrow}</button>
    </div>` : ''}
  </div>
  ${err ? `<p class="sim-err" role="alert">${esc(err)}</p>` : ''}
  <div class="sim-body${busy ? ' busy' : ''}" aria-busy="${!!busy}">
    ${res ? resultsHTML(S, res, stale) : emptyHTML(S, busy)}
  </div>`;
}

function emptyHTML(S, busy) {
  return `<div class="sim-empty panel">
    <div class="se-top">
      <div><div class="sub pixel">The crowd · #${String(S.sim.seed).padStart(4, '0')}</div><p class="muted">${WALLETS} wallets, eight kinds of trader, six hours from the first block. Bots hit the first seconds; holders arrive all day.</p></div>
      <button class="btn btn-chrome btn-lg" data-act="sim" data-fk="sim-run2" ${busy || !S.stack.length ? 'disabled' : ''}>${busy ? '<span class="spin" aria-hidden="true"></span>Running…' : `Simulate launch ${ICON.arrow}`}</button>
    </div>
    ${!S.stack.length ? '<p class="se-need">Add blocks to the rack first; then see what they refuse.</p>' : ''}
    <ul class="crowd">${Object.entries(ARCHETYPES).map(([k, a]) => `<li class="cw ${THREAT[a.color]}"><b class="mono">${a.n}</b><span class="cw-n">${a.name}</span><span class="cw-d">${CROWD[k]}</span></li>`).join('')}</ul>
  </div>`;
}

function resultsHTML(S, res, stale) {
  const a = res.withStack, z = res.noRules;
  const tries = a.landed + a.refused;
  return `
  <div class="sim-meta">
    <span>${WALLETS} wallets · ${a.hours}h · same crowd both runs</span>
    <span><b class="mono">${num(tries)}</b> transfers tried · <b class="mono">${num(a.landed)}</b> landed · <b class="mono bad">${num(a.refused)}</b> refused</span>
    <span class="stale" data-stale ${stale ? '' : 'hidden'}>Stack changed since this run. <button class="link" data-act="sim">Run again</button></span>
  </div>
  <div class="kpis">${kpis(a, z)}</div>
  <div class="sim-grid">
    <div class="panel card chart-card">
      <div class="card-h"><span class="pixel">Market cap, SOL · first 6 hours</span>
        <span class="legend"><span class="lg you"><i></i>Your stack</span><span class="lg none"><i></i>No rules</span><span class="lg rf"><i></i>Refused transfer</span></span></div>
      <div class="chart" data-chart role="img" aria-label="Market cap in SOL over six hours. Your stack ends at ${fmtSol(a.endPrice * SUPPLY)}, no rules ends at ${fmtSol(z.endPrice * SUPPLY)}."></div>
    </div>
    <div class="panel card">
      <div class="card-h"><span class="pixel">Refusals by block</span><span class="mono dim">${num(a.refused)} of ${num(tries)} · ${tries ? pct(a.refused / tries) : '0%'}</span></div>
      ${byBlockHTML(S, a)}
    </div>
  </div>
  <div class="sim-grid two">
    <div class="panel card">
      <div class="card-h"><span class="pixel">The crowd, trader by trader</span><span class="mono dim">your stack · no rules</span></div>
      ${crowdTable(a, z)}
    </div>
    <div class="panel card">
      <div class="card-h"><span class="pixel">Refused transfers · sample</span><span class="mono dim">what each wallet saw</span></div>
      ${samplesHTML(a)}
    </div>
  </div>`;
}

function kpis(a, z) {
  const tiles = [
    { k: 'Bot trades landed', you: `${a.botLanded}<small>/${a.botAttempts}</small>`, none: `${z.botLanded}/${z.botAttempts}`, va: a.botLanded, vz: z.botLanded, lower: true, d: rel(a.botLanded, z.botLanded) },
    { k: 'Bot PnL', you: sol(a.botPnl), none: sol(z.botPnl), va: a.botPnl, vz: z.botPnl, lower: true, signed: true, d: a.botPnl < z.botPnl ? `${fmtSol(z.botPnl - a.botPnl).replace(' SOL', '')} SOL less` : a.botPnl > z.botPnl ? `${fmtSol(a.botPnl - z.botPnl).replace(' SOL', '')} SOL more` : 'same' },
    { k: 'Top-10 holder share', you: pct(a.top10), none: pct(z.top10), va: a.top10, vz: z.top10, lower: true, d: pts(a.top10, z.top10) },
    { k: 'Max drawdown', you: pct(a.maxDrawdown), none: pct(z.maxDrawdown), va: a.maxDrawdown, vz: z.maxDrawdown, lower: true, d: pts(a.maxDrawdown, z.maxDrawdown) },
    { k: a.graduated ? 'Graduated at' : 'Curve progress', you: a.graduated ? clock(a.gradT) : pct(a.progress), none: z.graduated ? `grad. ${clock(z.gradT)}` : pct(z.progress), va: a.graduated ? 1 : a.progress, vz: z.graduated ? 1 : z.progress, lower: false, d: a.graduated && !z.graduated ? 'graduated' : pts(a.progress, z.progress) },
    { k: 'Fees burned', you: fmtSol(a.burnedSol), none: fmtSol(z.burnedSol), va: a.burnedSol, vz: z.burnedSol, lower: false, d: a.burnedSol === z.burnedSol ? 'same' : `${a.burnedSol > z.burnedSol ? '+' : '−'}${Math.abs(a.burnedSol - z.burnedSol).toFixed(2)} SOL` },
  ];
  return tiles.map((t) => {
    const same = Math.abs(t.va - t.vz) < 1e-9;
    const better = !same && (t.lower ? t.va < t.vz : t.va > t.vz);
    const max = Math.max(Math.abs(t.va), Math.abs(t.vz)) || 1;
    const w = (v) => Math.max(1.5, (Math.abs(v) / max) * 100);
    return `<div class="kpi">
      <div class="kpi-k pixel">${t.k}</div>
      <div class="kpi-v mono">${t.you}</div>
      <div class="kpi-z"><span>No rules</span><b class="mono">${t.none}</b></div>
      <div class="kpi-bars" aria-hidden="true"><i class="you${t.signed && t.va < 0 ? ' neg' : ''}" style="width:${w(t.va)}%"></i><i class="none${t.signed && t.vz < 0 ? ' neg' : ''}" style="width:${w(t.vz)}%"></i></div>
      <div class="kpi-d ${same ? 'same' : better ? 'better' : 'worse'}">${same ? 'No change' : `${better ? '▲' : '▼'} ${t.d}`}</div>
    </div>`;
  }).join('');
}
const rel = (a, z) => (z ? `${Math.round(Math.abs(1 - a / z) * 100)}% ${a < z ? 'fewer' : 'more'}` : a ? `${a} more` : 'same');
const pts = (a, z) => `${a < z ? '−' : '+'}${Math.abs((a - z) * 100).toFixed(1)} pts`;

function byBlockHTML(S, a) {
  const rows = Object.entries(a.byBlock).sort((x, y) => y[1] - x[1]);
  if (!rows.length) return '<p class="muted card-empty">Nothing was refused. With this crowd, every transfer passed the stack.</p>';
  const max = rows[0][1];
  const slotOf = (id) => S.stack.findIndex((s) => s.id === id);
  return `<ul class="rbars">${rows.map(([id, n]) => {
    const b = byId[id], i = slotOf(id);
    return `<li><span class="rb-c">${cube(b.family, { size: 26, state: 'refused' })}</span>
      <span class="rb-n"><b>${b.name}</b><span class="mono">${hex(b.code)}${i >= 0 ? ` · slot ${String(i + 1).padStart(2, '0')}` : ''}</span></span>
      <span class="rb-v mono">${num(n)}<small>${((n / a.refused) * 100).toFixed(0)}%</small></span>
      <span class="rb-t"><i style="width:${(n / max) * 100}%"></i></span></li>`;
  }).join('')}</ul>
  ${kindsHTML(a)}
  ${idleHooks(S, a)}`;
}
function kindsHTML(a) {
  const k = { buy: [0, 0], sell: [0, 0], send: [0, 0] };
  for (const e of a.log) { const x = k[e.kind]; if (!x) continue; x[0]++; if (!e.ok) x[1]++; }
  const first = a.log.find((e) => !e.ok);
  return `<div class="kinds">${Object.entries(k).map(([n, [t, r]]) => `<div><span class="kind ${n}">${n}s</span><b class="mono">${r}<small>/${t}</small></b><span class="lbar"><i style="width:${t ? (r / t) * 100 : 0}%"></i></span><span class="mono dim">${t ? pct(r / t, 0) : '—'} refused</span></div>`).join('')}</div>
  ${first ? `<p class="rb-first">First refusal at <b class="mono">+${clock(first.t)}</b>: a ${ONE[first.type].toLowerCase()}'s ${first.kind}, by ${byId[first.by].name}.</p>` : ''}`;
}
function idleHooks(S, a) {
  const idle = S.stack.map((s) => byId[s.id]).filter((b) => b.check && b.id !== 'custom' && !a.byBlock[b.id]);
  return idle.length ? `<p class="rb-idle">${idle.map((b) => `<b>${b.name}</b>`).join(', ')} refused nothing with this crowd${idle.length > 1 ? '; they' : '; it'} may still catch what this crowd didn't try, or an earlier slot refused first.</p>` : '';
}

function crowdTable(a, z) {
  return `<div class="tscroll"><table class="table ctab">
    <thead><tr><th>Trader</th><th class="r">Wallets</th><th class="r tried">Tried</th><th class="r">Landed</th><th class="r">Refused</th><th class="bar-h">Landed share</th><th class="r">No rules</th></tr></thead>
    <tbody>${Object.entries(ARCHETYPES).map(([k, x]) => {
      const t = a.byType[k], u = z.byType[k];
      const share = t.attempts ? t.landed / t.attempts : 0;
      return `<tr class="${THREAT[x.color]}"><td><span class="ct-dot"></span>${x.name}</td><td class="r mono dim">${x.n}</td><td class="r mono tried">${t.attempts}</td><td class="r mono">${t.landed}</td>
        <td class="r mono ${t.refused ? 'bad' : 'dim'}">${t.refused}</td>
        <td class="bar-c"><span class="lbar" title="${pct(share, 0)} landed"><i style="width:${share * 100}%"></i></span><span class="mono lpct">${t.attempts ? pct(share, 0) : '—'}</span></td>
        <td class="r mono dim">${u.landed}/${u.attempts}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td>All traders</td><td class="r mono dim">${WALLETS}</td><td class="r mono tried">${a.landed + a.refused}</td><td class="r mono">${a.landed}</td><td class="r mono ${a.refused ? 'bad' : 'dim'}">${a.refused}</td>
      <td class="bar-c"><span class="lbar"><i style="width:${(a.landed / Math.max(1, a.landed + a.refused)) * 100}%"></i></span><span class="mono lpct">${pct(a.landed / Math.max(1, a.landed + a.refused), 0)}</span></td><td class="r mono dim">${z.landed}/${z.landed + z.refused}</td></tr></tfoot></table></div>
  <p class="ct-note">Refused whales, flippers and paper hands come back five minutes later with half the size, up to four times, so the totals include retries. Bots don't adapt. A stack that refuses a lot can still let most holders through.</p>`;
}

function samplesHTML(a) {
  const refused = a.log.filter((e) => !e.ok);
  if (!refused.length) return '<p class="muted card-empty">No refused transfers to show.</p>';
  // a spread: up to two per block, then the earliest others
  const per = {}, pick = [];
  for (const e of refused) { per[e.by] = (per[e.by] ?? 0) + 1; if (per[e.by] <= 2) pick.push(e); if (pick.length >= 8) break; }
  for (const e of refused) { if (pick.length >= 8) break; if (!pick.includes(e)) pick.push(e); }
  pick.sort((x, y) => x.t - y.t);
  return `<ul class="rlog">${pick.map((e) => {
    const b = byId[e.by];
    return `<li>
      <span class="rl-t mono">+${clock(e.t)}</span>
      <span class="rl-who"><span class="kind ${e.kind}">${e.kind}</span><span>${ONE[e.type]}</span></span>
      <span class="rl-by">${cube(b.family, { size: 18, state: 'refused' })}<span>${b.name}</span><span class="mono rl-code">${hex(b.code)}</span></span>
      <span class="rl-amt mono" title="${num(e.amount)} tokens">${((e.amount / SUPPLY) * 100).toFixed(2)}%${e.kind === 'buy' ? `<small>${e.sol.toFixed(2)} SOL</small>` : '<small>of supply</small>'}</span>
      <span class="rl-msg">${esc(e.msg)}</span>
    </li>`;
  }).join('')}</ul>`;
}

// ───────────────────────── chart ─────────────────────────
let ro = null;
export function mountChart(root, S) {
  const host = root.querySelector('[data-chart]');
  ro?.disconnect(); ro = null;
  if (!host || !S.sim.res) return;
  const draw = () => drawChart(host, S.sim.res);
  draw();
  let w = host.clientWidth;
  ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - w) > 2) { w = host.clientWidth; draw(); } });
  ro.observe(host);
}

function nice(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = []; for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { a, b, ticks };
}

function drawChart(host, res) {
  const A = res.withStack, Z = res.noRules;
  const W = Math.max(280, host.clientWidth), small = W < 560;
  const H = small ? 230 : 290;
  const P = { l: 46, r: small ? 12 : 92, t: 16, b: 50 };
  const T = A.hours * 3600;
  const mc = (p) => p * SUPPLY;
  const vals = [...A.series, ...Z.series].map((s) => mc(s.p));
  const { a: y0, b: y1, ticks } = nice(Math.min(...vals) * 0.96, Math.max(...vals) * 1.02);
  const x = (t) => P.l + (t / T) * (W - P.l - P.r);
  const plotB = H - P.b, y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (plotB - P.t);
  const path = (ser) => ser.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)} ${y(mc(s.p)).toFixed(1)}`).join('');
  const area = `${path(A.series)}L${x(A.series.at(-1).t).toFixed(1)} ${plotB}L${x(0)} ${plotB}Z`;
  const rugY = plotB + 10;
  const refusedTs = A.log.filter((e) => !e.ok).map((e) => e.t);
  const hours = Array.from({ length: A.hours + 1 }, (_, i) => i);
  const endA = A.series.at(-1), endZ = Z.series.at(-1);
  let la = y(mc(endA.p)), lz = y(mc(endZ.p));
  if (Math.abs(la - lz) < 26) { const m = (la + lz) / 2; if (la <= lz) { la = m - 13; lz = m + 13; } else { la = m + 13; lz = m - 13; } }
  const grad = (R, cls) => {
    if (R.gradT == null) return '';
    const gx = x(R.gradT), left = gx > (P.l + W - P.r) / 2;
    const label = small ? `Graduates · ${clock(R.gradT)}` : `${cls === 'you' ? 'Your stack' : 'No rules'} graduates · ${clock(R.gradT)}`;
    return `<g class="gmark ${cls}"><line x1="${gx}" x2="${gx}" y1="${P.t}" y2="${plotB}"/><text x="${left ? gx - 6 : gx + 6}" y="${P.t + (cls === 'you' ? 10 : 24)}" text-anchor="${left ? 'end' : 'start'}">${label}</text></g>`;
  };
  const fmtY = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : `${+v.toFixed(0)}`);
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="csvg">
    <defs><linearGradient id="simArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d9bff" stop-opacity=".28"/><stop offset="1" stop-color="#4d9bff" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${ticks.filter((v) => v >= y0 && v <= y1).map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${P.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${fmtY(v)}</text>`).join('')}</g>
    <g class="xaxis">${hours.map((h) => `<text x="${x(h * 3600)}" y="${H - 6}" text-anchor="${h === 0 ? 'start' : h === A.hours ? 'end' : 'middle'}">${h}h</text>`).join('')}</g>
    ${grad(Z, 'none')}${grad(A, 'you')}
    <path class="area" d="${area}" fill="url(#simArea)"/>
    <path class="ln none" d="${path(Z.series)}"/>
    <path class="ln you" d="${path(A.series)}"/>
    <g class="rug"><line class="rug-base" x1="${P.l}" x2="${W - P.r}" y1="${rugY + 8}" y2="${rugY + 8}"/>${refusedTs.map((t) => `<rect x="${(x(t) - 0.75).toFixed(1)}" y="${rugY}" width="1.5" height="8"/>`).join('')}</g>
    ${small ? '' : `<g class="endl"><circle class="you" cx="${x(endA.t)}" cy="${y(mc(endA.p))}" r="3.5"/><circle class="none" cx="${x(endZ.t)}" cy="${y(mc(endZ.p))}" r="3.5"/>
      <text class="you" x="${x(endA.t) + 9}" y="${la + 4}">${fmtY(mc(endA.p))}<tspan x="${x(endA.t) + 9}" dy="12">Your stack</tspan></text>
      <text class="none" x="${x(endZ.t) + 9}" y="${lz + 4}">${fmtY(mc(endZ.p))}<tspan x="${x(endZ.t) + 9}" dy="12">No rules</tspan></text></g>`}
    <g class="hover" visibility="hidden"><line class="hx" y1="${P.t}" y2="${plotB}"/><circle class="you" r="4"/><circle class="none" r="4"/></g>
    <rect class="hit" x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${plotB - P.t + 20}" fill="transparent"/>
  </svg><div class="tip" hidden></div>`;

  const svg = host.querySelector('svg'), hov = svg.querySelector('.hover'), tip = host.querySelector('.tip');
  const [ca, cz] = hov.querySelectorAll('circle'), hx = hov.querySelector('.hx');
  const at = (ser, t) => ser.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), ser[0]);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const t = Math.max(0, Math.min(T, ((clientX - r.left - P.l) / (W - P.l - P.r)) * T));
    const sa = at(A.series, t), sz = at(Z.series, t);
    const X = x(sa.t);
    hov.setAttribute('visibility', 'visible');
    hx.setAttribute('x1', X); hx.setAttribute('x2', X);
    ca.setAttribute('cx', X); ca.setAttribute('cy', y(mc(sa.p)));
    cz.setAttribute('cx', x(sz.t)); cz.setAttribute('cy', y(mc(sz.p)));
    const near = refusedTs.filter((rt) => Math.abs(rt - sa.t) <= 60).length;
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-t mono">+${clock(sa.t)}</div>
      <div class="tip-r"><i class="you"></i>Your stack<b class="mono">${fmtSol(mc(sa.p))}</b></div>
      <div class="tip-r"><i class="none"></i>No rules<b class="mono">${fmtSol(mc(sz.p))}</b></div>
      <div class="tip-r sm"><span>Curve</span><b class="mono">${pct(sa.prog, 0)} · ${pct(sz.prog, 0)}</b></div>
      ${near ? `<div class="tip-r sm bad"><span>Refused ±1 min</span><b class="mono">${near}</b></div>` : ''}`;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(W - tw - 4, Math.max(4, X + 12 > W - tw - 10 ? X - tw - 12 : X + 12))}px`;
    tip.style.top = `${P.t + 6}px`;
  };
  const hide = () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
}
