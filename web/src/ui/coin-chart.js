// Market-cap chart for the coin page. The shape comes from api.simulate(coin.stack) (the curve the
// stack produces), mapped onto the coin's real lifetime and pinned to its current market cap.
// SVG, redrawn at the container's pixel width; crosshair with a value readout; volume + refusal lanes.
import { rng, SUPPLY } from '../engine/sim.js';
import { byId } from '../data/blocks.js';
import { usd, esc, pctS } from '../core/format.js';
import { SOL_USD, usdPrice } from './coin-shared.js';

const GRAD_MC = (115 / 279_900_191) * SUPPLY * SOL_USD; // DBC price at 85 SOL raised, as market cap

function interp(series, t) {
  if (t <= series[0].t) return series[0].p;
  for (let i = 1; i < series.length; i++) {
    if (series[i].t >= t) { const a = series[i - 1], b = series[i]; const k = (t - a.t) / (b.t - a.t || 1); return a.p + (b.p - a.p) * k; }
  }
  return series.at(-1).p;
}

/** A coin that just launched: the creator's buy in the launch transaction, then quiet. */
function freshHistory(coin, sim) {
  const now = Date.now(), ageMs = 5 * 60000, launch = now - ageMs, N = 150;
  const startMc = sim.series[0].p * SUPPLY * SOL_USD;
  const r = rng([...coin.ticker].reduce((a, c) => a * 31 + c.charCodeAt(0), 11));
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const mc = i < 3 ? startMc : coin.mcapUsd * (1 + (i < N ? (r() - 0.5) * 0.002 : 0));
    pts.push({ at: launch + (i / N) * ageMs, mc, vol: i === 3 ? Math.max(0.05, (coin.mcapUsd - startMc) / SOL_USD / 4) : 0, ref: 0 });
  }
  return { pts, launch, now, ageMs, gradAt: null, startMc };
}

/** Dense market-cap history over the coin's whole life. */
export function buildHistory(coin, sim) {
  if ((coin.checked ?? 0) < 20) return freshHistory(coin, sim);
  const now = Date.now();
  const ageMs = Math.max(20 * 60, coin.minutesAgo * 60) * 1000;
  const launch = now - ageMs;
  const S = sim.series, T = S.at(-1).t;
  const p0 = S[0].p, pEnd = S.at(-1).p;
  const startMc = p0 * SUPPLY * SOL_USD;
  const grad = coin.phase === 'graduated';
  const gf = grad ? 0.42 : 1; // share of the life spent on the curve
  const curveEnd = grad ? GRAD_MC : coin.mcapUsd;
  // keep the stack's curve shape: scale it in log space so it lands on the market cap; if the
  // curve barely moved, drift there instead
  const simMove = Math.log(pEnd / p0), want = Math.log(curveEnd / startMc);
  const kExp = Math.abs(simMove) > 0.25 && want / simMove > 0.05 ? want / simMove : null;
  const d1 = kExp ? 0 : want - simMove;
  const N = Math.max(240, Math.min(4000, Math.round(ageMs / 10000)));
  const step = ageMs / N;
  const seed = [...coin.ticker].reduce((a, c) => a * 33 + c.charCodeAt(0), 5381);
  const r = rng(seed);
  // Brownian bridge for texture: pinned at launch and now
  const sig = 0.11 * Math.sqrt(step / 3.6e6);
  const B = [0];
  for (let i = 1; i <= N; i++) { const g = (r() + r() + r() + r() - 2) * 1.73; B.push(B[i - 1] + g * sig); }
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let L;
    if (u <= gf) {
      const uu = u / gf;
      L = Math.log(startMc) + Math.log(interp(S, uu * T) / p0) * (kExp ?? 1) + d1 * uu;
    } else {
      const uu = (u - gf) / (1 - gf);
      L = Math.log(GRAD_MC) + (Math.log(coin.mcapUsd) - Math.log(GRAD_MC)) * uu;
    }
    const damp = Math.min(1, u * 40); // the very first minutes follow the curve exactly
    const w = (B[i] - u * B[N]) * damp;
    pts.push({ at: launch + i * step, mc: Math.exp(L + w), vol: 0, ref: 0 });
  }
  pts[pts.length - 1].mc = coin.mcapUsd;
  // pin the value 24h ago to the coin's 24h change (coins older than a day)
  const i24 = Math.round(N * (1 - 8.64e7 / ageMs));
  if (i24 > 0 && i24 < N) {
    const target = coin.mcapUsd / (1 + Math.max(-95, coin.change24) / 100);
    const dl = Math.log(target / pts[i24].mc);
    for (let i = 1; i < N; i++) pts[i].mc *= Math.exp(dl * (i <= i24 ? i / i24 : (N - i) / (N - i24)));
  }
  // volume + refusals from the stack's transfer log (curve phase), noise-driven after graduation
  const idx = (simT) => Math.min(N, Math.max(0, Math.round((simT / T) * gf * N)));
  // refusal marks: the stack's refusal pattern, thinned to the coin's own refused count so the chart and the stats agree
  const refs = sim.log.filter((e) => !e.ok);
  const keep = Math.min(refs.length, coin.refused ?? refs.length);
  const kept = new Set(Array.from({ length: keep }, (_, k) => refs[Math.floor((k * refs.length) / keep)]));
  for (const e of sim.log) {
    const i = idx(e.t);
    if (!e.ok) { if (kept.has(e)) { pts[i].ref++; pts[i].refBy = e.by; } continue; }
    if (e.kind === 'send') continue;
    pts[i].vol += e.sol || e.amount * interp(S, e.t);
  }
  if (grad) for (let i = Math.ceil(gf * N); i <= N; i++) pts[i].vol = Math.abs(B[i] - B[i - 1]) * 60 * (0.3 + r());
  return { pts, launch, now, ageMs, gradAt: grad ? launch + gf * ageMs : null, startMc };
}

/** Market cap change over the last `minutes` (for the Circuit Breaker gauge). */
export function moveOver(h, minutes) {
  const from = Date.now() - minutes * 60000;
  const a = h.pts.find((p) => p.at >= from) ?? h.pts[0];
  return h.pts.at(-1).mc / a.mc - 1;
}

export const TIMEFRAMES = [['1H', 3.6e6], ['6H', 2.16e7], ['24H', 8.64e7], ['ALL', Infinity]];

/** Mounts the chart into `el`. Returns { setTf }. */
export function mountChart(el, h, { tf = 'ALL', onTf } = {}) {
  el.innerHTML = `<div class="ch-plot"><svg class="ch-svg" role="img" aria-label="Market cap chart"></svg><div class="ch-tip" hidden></div></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.ch-tip'), plot = el.querySelector('.ch-plot');
  let view = null, cur = tf;

  function windowPts() {
    const span = TIMEFRAMES.find((x) => x[0] === cur)[1];
    const from = Math.max(h.launch, h.now - span);
    let pts = h.pts.filter((p) => p.at >= from);
    if (pts.length < 2) pts = h.pts.slice(-2);
    // bucket to ~1 point per 3px
    const W = plot.clientWidth || 800;
    const target = Math.max(60, Math.min(360, Math.floor(W / 3)));
    const k = Math.ceil(pts.length / target);
    const out = [];
    for (let i = 0; i < pts.length; i += k) {
      const g = pts.slice(i, i + k);
      out.push({ at: g.at(-1).at, mc: g.at(-1).mc, hi: Math.max(...g.map((x) => x.mc)), lo: Math.min(...g.map((x) => x.mc)), vol: g.reduce((a, x) => a + x.vol, 0), ref: g.reduce((a, x) => a + x.ref, 0), refBy: g.find((x) => x.refBy)?.refBy });
    }
    out[out.length - 1] = { ...out.at(-1), at: h.pts.at(-1).at, mc: h.pts.at(-1).mc };
    return out;
  }

  function draw() {
    const W = Math.max(280, plot.clientWidth), H = W < 560 ? 250 : 330;
    const pad = { l: 6, r: W < 560 ? 58 : 70, t: 18, b: 26 };
    const pts = windowPts();
    const x0 = pts[0].at, x1 = pts.at(-1).at;
    let lo = Math.min(...pts.map((p) => p.lo)), hi = Math.max(...pts.map((p) => p.hi));
    const span = hi - lo || hi * 0.05;
    lo -= span * 0.12; hi += span * 0.1; lo = Math.max(0, lo);
    const volH = 46, refH = 8;
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const X = (t) => pad.l + ((t - x0) / (x1 - x0 || 1)) * pw;
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (ph - refH - 6);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)} ${Y(p.mc).toFixed(1)}`).join('');
    const area = `${line}L${X(x1).toFixed(1)} ${pad.t + ph - refH - 6}L${X(x0).toFixed(1)} ${pad.t + ph - refH - 6}Z`;
    // grid + y labels
    const ticks = niceTicks(lo, hi, 4);
    // axis labels with enough precision that neighbouring ticks never print the same text (narrow ranges, e.g. a fresh coin)
    const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : hi - lo;
    const yl = (v) => { if (v < 1e3 || step >= (v >= 1e6 ? 1e5 : 100)) return usd(v); const k = v >= 1e6 ? 1e6 : 1e3, u = k === 1e6 ? 'M' : 'K'; const d = Math.min(3, Math.max(1, Math.ceil(-Math.log10(step / k)))); return `$${(v / k).toFixed(d)}${u}`; };
    const grid = ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ch-grid"/><text x="${W - pad.r + 10}" y="${(Y(v) + 3.5).toFixed(1)}" class="ch-yl">${yl(v)}</text>`).join('');
    // x labels
    const nx = W < 560 ? 3 : 5;
    const xl = Array.from({ length: nx }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / nx).map((t) => `<text x="${X(t).toFixed(1)}" y="${H - 8}" class="ch-xl" text-anchor="middle">${fmtT(t, x1 - x0)}</text>`).join('');
    // volume
    const vmax = Math.max(...pts.map((p) => p.vol)) || 1;
    const bw = Math.max(1, pw / pts.length - 1);
    const vols = pts.map((p, i) => {
      if (!p.vol) return '';
      const vh = (p.vol / vmax) * volH;
      const up = i === 0 || p.mc >= pts[i - 1].mc;
      return `<rect x="${(X(p.at) - bw / 2).toFixed(1)}" y="${(pad.t + ph - refH - 6 - vh).toFixed(1)}" width="${bw.toFixed(1)}" height="${vh.toFixed(1)}" class="ch-vol${up ? '' : ' dn'}"/>`;
    }).join('');
    const refs = pts.map((p) => (p.ref ? `<rect x="${(X(p.at) - Math.max(1, bw / 2)).toFixed(1)}" y="${pad.t + ph - refH}" width="${Math.max(2, bw).toFixed(1)}" height="${refH}" class="ch-ref" style="opacity:${Math.min(1, 0.35 + p.ref * 0.2)}"/>` : '')).join('');
    const last = pts.at(-1);
    const grad = h.gradAt && h.gradAt > x0 && h.gradAt < x1
      ? `<line x1="${X(h.gradAt).toFixed(1)}" x2="${X(h.gradAt).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph - refH - 6}" class="ch-gradl"/><text x="${(X(h.gradAt) + 6).toFixed(1)}" y="${pad.t + 10}" class="ch-gradt">GRADUATED · DAMM V2</text>` : '';
    const id = 'chg' + Math.random().toString(36).slice(2, 7);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.innerHTML = `<defs>
        <linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb2ff" stop-opacity=".34"/><stop offset=".55" stop-color="#4d9bff" stop-opacity=".08"/><stop offset="1" stop-color="#4d9bff" stop-opacity="0"/></linearGradient>
        <linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4d9bff"/><stop offset=".7" stop-color="#8fcaff"/><stop offset="1" stop-color="#e8f4ff"/></linearGradient>
        <filter id="${id}g" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="3.2"/></filter>
      </defs>
      ${grid}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ph - refH - 6}" y2="${pad.t + ph - refH - 6}" class="ch-base"/>
      ${vols}${grad}
      <path d="${area}" fill="url(#${id}a)"/>
      <path d="${line}" fill="none" stroke="#6fb2ff" stroke-width="3" opacity=".45" filter="url(#${id}g)"/>
      <path d="${line}" fill="none" stroke="url(#${id}l)" stroke-width="1.7" stroke-linejoin="round"/>
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(last.mc).toFixed(1)}" y2="${Y(last.mc).toFixed(1)}" class="ch-last"/>
      <circle cx="${X(last.at).toFixed(1)}" cy="${Y(last.mc).toFixed(1)}" r="3.4" class="ch-dot"/>
      <circle cx="${X(last.at).toFixed(1)}" cy="${Y(last.mc).toFixed(1)}" r="3.4" class="ch-ping"/>
      <g transform="translate(${W - pad.r + 4},${(Y(last.mc) - 10).toFixed(1)})"><path d="M0 10 6 2h${pad.r - 10}v16H6z" class="ch-lastp"/><text x="${(pad.r - 4) / 2 + 3}" y="14" class="ch-lastt" text-anchor="middle">${usd(last.mc)}</text></g>
      ${refs}
      <text x="${pad.l + 2}" y="${pad.t + ph - refH - 10}" class="ch-lane">VOL</text>
      ${xl}
      <g class="ch-x" style="display:none"><line class="ch-xv" y1="${pad.t}" y2="${pad.t + ph}"/><line class="ch-xh" x1="${pad.l}" x2="${W - pad.r}"/><circle r="4.2" class="ch-xd"/>
        <g class="ch-xy"><rect x="${W - pad.r + 4}" width="${pad.r - 6}" height="18" y="-9" class="ch-xyb"/><text x="${W - pad.r + 4 + (pad.r - 6) / 2}" y="4" text-anchor="middle" class="ch-xyt"></text></g></g>`;
    view = { pts, X, Y, W, H, pad };
  }

  function move(e) {
    if (!view) return;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * view.W;
    if (mx < view.pad.l || mx > view.W - view.pad.r) return leave();
    let best = 0, bd = Infinity;
    view.pts.forEach((p, i) => { const d = Math.abs(view.X(p.at) - mx); if (d < bd) { bd = d; best = i; } });
    const p = view.pts[best];
    const x = view.X(p.at), y = view.Y(p.mc);
    const g = svg.querySelector('.ch-x');
    g.style.display = '';
    g.querySelector('.ch-xv').setAttribute('x1', x); g.querySelector('.ch-xv').setAttribute('x2', x);
    g.querySelector('.ch-xh').setAttribute('y1', y); g.querySelector('.ch-xh').setAttribute('y2', y);
    g.querySelector('.ch-xd').setAttribute('cx', x); g.querySelector('.ch-xd').setAttribute('cy', y);
    g.querySelector('.ch-xy').setAttribute('transform', `translate(0,${y})`);
    g.querySelector('.ch-xyt').textContent = usd(p.mc);
    const first = view.pts[0].mc;
    tip.hidden = false;
    tip.innerHTML = `<div class="ch-tt">${fmtFull(p.at)}</div>
      <div class="ch-tr"><span>Market cap</span><b>${usd(p.mc)}</b></div>
      <div class="ch-tr"><span>Price</span><b>${usdPrice(p.mc / SUPPLY)}</b></div>
      <div class="ch-tr"><span>${cur === 'ALL' ? 'Since launch' : 'Change in view'}</span><b class="${p.mc >= first ? 'up' : 'down'}">${pctS((p.mc / first - 1) * 100)}</b></div>
      ${p.vol ? `<div class="ch-tr"><span>Volume</span><b>${p.vol.toFixed(2)} SOL</b></div>` : ''}
      ${p.ref ? `<div class="ch-tr ref"><span>Refused</span><b>${p.ref} · ${esc(byId[p.refBy]?.name ?? '')}</b></div>` : ''}`;
    const sx = rect.width / view.W;
    const tw = tip.offsetWidth;
    let left = x * sx + 14;
    if (left + tw > rect.width - 8) left = x * sx - tw - 14;
    tip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(6, Math.min(y * sx - 30, rect.height - tip.offsetHeight - 30))}px)`;
  }
  function leave() { const g = svg.querySelector('.ch-x'); if (g) g.style.display = 'none'; tip.hidden = true; }
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);

  let raf;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }).observe(plot);
  draw();
  const stats = () => { const pts = windowPts(); return { first: pts[0].mc, last: pts.at(-1).mc, vol: pts.reduce((a, p) => a + p.vol, 0), refused: pts.reduce((a, p) => a + p.ref, 0), grad: !!h.gradAt && h.gradAt > pts[0].at }; };
  return {
    setTf(t) { cur = t; draw(); onTf?.(t, stats()); },
    stats,
  };
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
function fmtT(t, span) {
  const d = new Date(t);
  return span > 1.5 * 8.64e7 ? `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` : hhmm(d);
}
const fmtFull = (t) => { const d = new Date(t); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()} · ${hhmm(d)} UTC`; };
