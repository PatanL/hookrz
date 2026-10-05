// Home hero: the LIVE RACK. The Fair Launch preset sits in the engine's six slots; every transfer runs
// along the rail under the slots, lights each block it passes and either lands at the end or stops at
// the block that refused it (coral, with the block's message and its custom error number).
import { cube, ICON } from './icons.js';
import { byId, hex, errName, ENGINE, ENFORCERS } from '../data/blocks.js';
import { budget } from '../engine/engine.js';
import { api } from '../api/client.js';
import { short } from '../data/coins.js';
import { num, esc } from '../core/format.js';

const TRAVEL_MS = 1500;          // rail entry → exit
const MAX_IN_FLIGHT = 3;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * preset: an entry of PRESETS; its stack goes in the slots and the transfers run through it.
 * onVerdict(ev): called once per transfer as its verdict lands on screen.
 */
export function mountRack(el, { preset, onVerdict }) {
  const stack = preset.slots.map(([id, params]) => ({ id, params }));
  const slots = Array.from({ length: ENGINE.maxSlots }, (_, i) => (stack[i] ? { ...byId[stack[i].id], params: stack[i].params } : null));
  const hookCount = slots.filter((b) => b?.enforcedBy === 'hook').length;
  const cu = budget(stack).cu;
  const href = `build.html?preset=${encodeURIComponent(preset.id)}`;

  el.innerHTML = `
  <div class="rack-head">
    <a class="rack-coin" href="${href}"><span class="rack-mark">${cube('guard', { size: 40 })}</span><span><b>${esc(preset.name)} stack</b><small>${esc(preset.name)} · every transfer through the engine</small></span></a>
    <span class="rack-live"><i></i>Running</span>
  </div>
  <p class="rack-sub"><span class="mono">${ENGINE.program}</span><span class="sep"></span><span class="num">${stack.length}</span>/<span class="num">${ENGINE.maxSlots}</span> slots<span class="sep"></span><span class="num">${cu.toLocaleString('en-US')}</span> CU<a class="rack-use" href="${href}">Launch with this stack ${ICON.arrow}</a></p>
  <div class="rack-chassis">
    <div class="rack-bays">
      ${slots.map((b, i) => `
      <div class="rack-slot${b ? ' has enf-' + b.enforcedBy : ' empty'}" data-i="${i}">
        <div class="bay">${b ? cube(b.family, { size: 60, title: b.name }) : cube('x', { size: 60, state: 'empty' })}<span class="bay-tag mono"></span></div>
      </div>`).join('')}
    </div>
    <div class="rack-rail" aria-hidden="true"><span class="cap in"></span><span class="cap out"></span><div class="rack-packets"></div></div>
    <div class="rack-labels">
      ${slots.map((b, i) => `
      <div class="rack-label${b ? '' : ' empty'}">
        <span class="slot-n pixel">${String(i + 1).padStart(2, '0')}</span>
        <span class="slot-name">${b ? esc(b.name) : 'Open slot'}</span>
        <span class="slot-code">${b ? (b.code != null ? `<span class="mono" title="${esc(errName(b.code))}">${hex(b.code)}</span>` : `<span class="enf ${b.enforcedBy}"><i></i>${ENFORCERS[b.enforcedBy].name}</span>`) : '<span class="dim">—</span>'}</span>
      </div>`).join('')}
    </div>
    <div class="rack-ends pixel" aria-hidden="true"><span>Transfer in</span><span>Lands</span></div>
  </div>
  <ol class="rack-legend">${slots.map((b, i) => b ? `<li><span class="pixel">${String(i + 1).padStart(2, '0')}</span>${esc(b.name)}<em>${b.code != null ? hex(b.code) : ENFORCERS[b.enforcedBy].name}</em></li>` : '').join('')}</ol>
  <div class="rack-verdict idle">
    <div class="rv-l1"><span class="rv-kind pixel">—</span><span class="rv-amt">Waiting for the next transfer</span><span class="rv-state pixel"></span></div>
    <div class="rv-l2">&nbsp;</div>
  </div>
  <div class="rack-counters">
    <div><span class="pixel">Transfers checked</span><b class="num" data-c="checked">0</b></div>
    <div><span class="pixel">Refused</span><b class="num refuse" data-c="refused">0</b></div>
    <div><span class="pixel">Refusal rate</span><b class="num" data-c="rate">0%</b></div>
  </div>`;

  const bays = [...el.querySelectorAll('.rack-slot')];
  const cubes = bays.map((s) => s.querySelector('.cube'));
  const tags = bays.map((s) => s.querySelector('.bay-tag'));
  const rail = el.querySelector('.rack-rail');
  const lane = el.querySelector('.rack-packets');
  const outCap = el.querySelector('.cap.out');
  const verdict = el.querySelector('.rack-verdict');
  const counters = Object.fromEntries([...el.querySelectorAll('[data-c]')].map((x) => [x.dataset.c, x]));
  let checked = 0, refused = 0;

  // x of the rail start, each bay centre, and the rail end — relative to the rail
  let pts = [];
  const measure = () => {
    const r = rail.getBoundingClientRect();
    pts = [0, ...bays.map((b) => { const q = b.querySelector('.bay').getBoundingClientRect(); return q.left + q.width / 2 - r.left; }), r.width];
  };
  measure();
  const ro = new ResizeObserver(measure); ro.observe(rail);

  // add a class for `ms`, restarting it if it is already on
  const timers = new WeakMap();
  const pulse = (node, cls, ms) => {
    let m = timers.get(node);
    if (!m) timers.set(node, (m = {}));
    clearTimeout(m[cls]);
    if (node.classList.contains(cls)) { node.classList.remove(cls); void node.offsetWidth; }
    node.classList.add(cls);
    m[cls] = setTimeout(() => node.classList.remove(cls), ms);
  };

  const flashSlot = (i, hook) => {
    if (!slots[i]) return;
    pulse(cubes[i], hook ? 'lit' : 'touch', hook ? 560 : 380);
    if (hook) pulse(bays[i], 'is-lit', 560);
  };
  const refuseSlot = (i, ev) => {
    pulse(cubes[i], 'refused', 1700);
    pulse(bays[i], 'is-refused', 1700);
    tags[i].textContent = hex(slots[i].code);
  };

  const show = (ev) => {
    const b = ev.by ? byId[ev.by] : null;
    const i = b ? slots.findIndex((s) => s?.id === b.id) : -1;
    const amt = ev.kind === 'buy'
      ? `<span class="num">${(ev.sol ?? 0).toFixed(2)} SOL</span><span class="dim">→</span><span class="num">${num(ev.amount)}</span> <span class="dim">tokens</span>`
      : `<span class="num">${num(ev.amount)}</span> <span class="dim">tokens</span>`;
    verdict.className = 'rack-verdict ' + (ev.ok ? 'ok' : 'no');
    verdict.innerHTML = `
      <div class="rv-l1"><span class="rv-kind pixel k-${ev.kind}">${ev.kind}</span><span class="rv-amt">${amt}<span class="sep"></span><span class="mono dim">${esc(short(ev.wallet))}</span></span>
        <span class="rv-state pixel">${ev.ok ? `${ICON.check}Landed` : `${ICON.stop}Refused ${hex(b?.code)}`}</span></div>
      <div class="rv-l2">${ev.ok
        ? `Passed ${ev.verdicts?.length ?? hookCount} of ${hookCount} hook checks in slot order`
        : `<b>${esc(b?.name ?? 'Block')}</b> <span class="dim">· slot ${String(i + 1).padStart(2, '0')} · ${esc(errName(b?.code))} ·</span> ${esc(ev.msg ?? '')}`}</div>`;
    if (hookCount) checked++;
    if (!ev.ok) refused++;
    counters.checked.textContent = checked.toLocaleString('en-US');
    counters.refused.textContent = refused.toLocaleString('en-US');
    counters.rate.textContent = rate(refused, checked);
    pulse(counters.checked, 'bump', 400);
    if (!ev.ok) pulse(counters.refused, 'bump', 400);
    onVerdict?.(ev);
  };

  // ---- packets ----
  const flying = new Set();
  let raf = 0, visible = true;
  const frame = (now) => {
    raf = 0;
    const span = pts[pts.length - 1] - pts[0];
    for (const k of flying) {
      if (k.done) continue;
      let x = pts[0] + span * Math.min(1, (now - k.t0) / TRAVEL_MS);
      while (k.next < pts.length && x >= pts[k.next]) {
        const at = k.next;
        if (at === pts.length - 1) { finish(k, true); break; }
        const b = slots[at - 1];
        if (b && !k.ev.ok && k.ev.by === b.id) { x = pts[at]; finish(k, false, at - 1); break; }
        if (b) flashSlot(at - 1, b.enforcedBy === 'hook');
        k.next++;
      }
      k.el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    }
    if ([...flying].some((k) => !k.done)) raf = requestAnimationFrame(frame);
  };
  const finish = (k, landed, i) => {
    k.done = true;
    if (landed) { pulse(outCap, 'hit', 600); k.el.classList.add('gone'); setTimeout(() => { k.el.remove(); flying.delete(k); }, 260); }
    else { refuseSlot(i, k.ev); k.el.classList.add('stop'); setTimeout(() => { k.el.classList.add('gone'); }, 1100); setTimeout(() => { k.el.remove(); flying.delete(k); }, 1400); }
    show(k.ev);
  };
  const launch = (ev) => {
    if (!visible || document.hidden || reduced() || pts.length < 2) return instant(ev);
    if ([...flying].filter((k) => !k.done).length >= MAX_IN_FLIGHT) return; // the rail is busy; skip drawing this one
    const p = document.createElement('i');
    p.className = 'pkt k-' + ev.kind + (ev.ok ? '' : ' will-refuse');
    lane.append(p);
    flying.add({ el: p, ev, t0: performance.now(), next: 1, done: false });
    if (!raf) raf = requestAnimationFrame(frame);
  };
  // no travel (reduced motion / off screen): set the states directly
  const instant = (ev) => {
    const stopAt = ev.ok ? -1 : slots.findIndex((s) => s?.id === ev.by);
    slots.forEach((b, i) => { if (b && (stopAt < 0 || i < stopAt)) flashSlot(i, b.enforcedBy === 'hook'); });
    if (stopAt >= 0) refuseSlot(stopAt, ev); else pulse(outCap, 'hit', 600);
    show(ev);
  };

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
  io.observe(el);
  const stop = api.stream(null, launch, { stack });
  const end = () => { stop(); ro.disconnect(); io.disconnect(); cancelAnimationFrame(raf); };
  addEventListener('pagehide', end, { once: true });
  return end;
}

const rate = (r, c) => (c ? `${((r / c) * 100).toFixed(1)}%` : '0%');
