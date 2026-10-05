// "Watch it play": an auto-playing mini story per rule idea. A small cast trades against the REAL rule (the idea's
// Hookscript, compiled by the bundled toolchain and run by its interpreter, state kept between trades), so every
// "Blocked" and every message on screen is what the chain would say. Scenes and the runner live in
// rule-play-scenes.js (shared with tests/rule-play.test.mjs). Used on the home page (with tabs) and in the Rules
// page's idea drawer. Plays only while on screen; with reduced motion it waits for "Next".
import '../styles/rule-play.css';
import { pixelIcon } from './pixel.js';
import { esc } from '../core/format.js';
import { ideaById } from '../data/ideas.js';
import { SCENES, runScene, frameMs } from './rule-play-scenes.js';

export const hasPlay = (id) => !!SCENES[id];
export const PLAY_IDS = Object.keys(SCENES);

let toolchain = null;
const loadHs = () => (toolchain ??= import('../hookscript/hs.js').then((m) => m.load()));
const runs = new Map();
async function sceneRun(id) {
  if (!runs.has(id)) runs.set(id, loadHs().then((hs) => runScene(hs, id)));
  return runs.get(id);
}

// ───────── the cast, in the brand's 12×12 pixel language ('#' chrome, '+' ice, '.' empty) ─────────
const AV = {
  whale: ['............', '.......+.+..', '........+...', '#...........', '##..######..', '.##########.', '.#######.##.', '############', '############', '.#++++++++#.', '..++++++++..', '............'],
  degen: ['............', '...++++++...', '..++++++++..', '..++++++++++', '..########..', '..#..##..#..', '..#..##..#..', '..########..', '..##....##..', '...######...', '....####....', '............'],
  paper: ['....#.#.....', '..#.#.#.#...', '..#.#.#.#...', '..#.#.#.#...', '..#######..#', '..#######.##', '..#########.', '..++++++##..', '..#######...', '...#####....', '...#####....', '............'],
  you: ['............', '....####....', '...######...', '...#.##.#...', '...######...', '...##..##...', '....####....', '............', '..++++++++..', '.++++++++++.', '.++++++++++.', '............'],
  creator: ['............', '....++++....', '...++++++...', '..++++++++..', '...######...', '...#.##.#...', '...######...', '....####....', '..########..', '.##########.', '.##########.', '............'],
};
const AV_OF = { Whale: 'whale', 'Sniper bot': 'bot', 'Paper hands': 'paper', Degen: 'degen', You: 'you', Creator: 'creator' };
function grid(rows, size, color = '#dfe7f2', accent = '#8fcaff') {
  let r = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < 12) {
      const c = row[x];
      if (c === '.') { x++; continue; }
      let x2 = x; while (x2 + 1 < 12 && row[x2 + 1] === c) x2++;
      r += `<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${c === '+' ? accent : color}"/>`;
      x = x2 + 1;
    }
  });
  return `<svg class="px-icon" viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${r}</svg>`;
}
const avatar = (name, size = 28) => (AV_OF[name] === 'bot' || !AV[AV_OF[name]] ? pixelIcon(AV_OF[name] === 'bot' ? 'bot' : 'people', { size, color: '#dfe7f2' }) : grid(AV[AV_OF[name]], size));
const glyph = (name, size = 14, o = {}) => pixelIcon(name, { size, color: '#dfe7f2', accent: '#8fcaff', ...o });

const IC = {
  pause: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><rect x="2" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="M2 1h2v1h2v1h2v1h2v4H8v1H6v1H4v1H2z" fill="currentColor"/></svg>',
  step: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="M1 1h2v1h2v1h2v6H5v1H3v1H1z" fill="currentColor"/><rect x="8" y="1" width="3" height="10" fill="currentColor"/></svg>',
  again: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 1h6v1h1v1h1v2H9V3H3v1H2v4h1v1h4v2H3v-1H2V9H1V3h1V2h1z" fill="currentColor"/><path d="M7 4h4v4h-1V6H9V5H7z" fill="currentColor"/></svg>',
  arrow: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  ff: '<svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true" shape-rendering="crispEdges"><path d="M0 0h2v1h1v1h1v1h1v4H4v1H3v1H2v1H0zM6 0h2v1h1v1h1v1h1v4h-1v1H9v1H8v1H6z" fill="currentColor"/></svg>',
};
const V_OK = pixelIcon('check', { size: 12, color: 'currentColor', accent: 'currentColor' });
const V_NO = pixelIcon('cross', { size: 12, color: 'currentColor', accent: 'currentColor' });

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RESOLVE = 520; // ms between a trade appearing and the chain's answer

/**
 * Mount a player in `el`. ids: the ideas it can play (more than one → tabs). launch: show "Launch with this".
 * label: a small heading above the tabs. head: false drops the stage's own title (when the page already shows it).
 * onShow(id) runs whenever another idea comes on stage. Returns { show(id), destroy() }.
 */
export function mountRulePlay(el, { ids, launch = true, label = '', head = true, onShow = null } = {}) {
  ids = ids.filter(hasPlay);
  if (!ids.length) return null;
  const tabs = ids.length > 1;
  const uid = `rp${Math.random().toString(36).slice(2, 7)}`;
  el.classList.add('rp');
  el.classList.toggle('rp-bare', !head);
  el.innerHTML = `
    ${label || tabs ? `<div class="rp-top">${label ? `<span class="rp-k pixel">${IC.play}${esc(label)}</span>` : ''}
      ${tabs ? `<div class="rp-tabs" role="tablist" aria-label="Rule ideas">${ids.map((id, i) => `<button type="button" role="tab" class="rp-tab" id="${uid}-t${i}" data-id="${id}" aria-controls="${uid}-p" aria-selected="${i ? 'false' : 'true'}" tabindex="${i ? -1 : 0}">${glyph(ideaById[id].icon, 16)}<span>${esc(ideaById[id].name)}</span></button>`).join('')}</div>` : ''}</div>` : ''}
    <div class="rp-stage" id="${uid}-p" ${tabs ? 'role="tabpanel"' : ''}>
      <header class="rp-head">
        <span class="rp-ic" data-o="ic"></span>
        <div class="rp-ht"><b class="rp-name" data-o="name"></b><span class="rp-short" data-o="short"></span></div>
        <div class="rp-clock"><span class="rp-sim pixel">Simulation</span><b class="mono" data-o="clock">Launch</b></div>
      </header>
      <ul class="rp-cast" data-o="cast" aria-label="Who’s trading"></ul>
      <div class="rp-chips" data-o="chips" aria-label="What the rule remembers"></div>
      <ol class="rp-feed" data-o="feed" aria-live="off"></ol>
      <p class="rp-pay" data-o="pay"></p>
      <div class="rp-bar">
        <div class="rp-prog" data-o="prog" aria-hidden="true"></div>
        <div class="rp-ctl">
          <button type="button" class="rp-btn" data-act="play"></button>
          <button type="button" class="rp-btn ic" data-act="step" aria-label="Next trade" title="Next trade">${IC.step}</button>
          <button type="button" class="rp-btn ic" data-act="again" aria-label="Start over" title="Start over">${IC.again}</button>
          ${launch ? `<a class="rp-launch" data-o="launch" href="#">Launch with this ${IC.arrow}</a>` : ''}
        </div>
      </div>
    </div>`;

  const $ = (k) => el.querySelector(`[data-o="${k}"]`);
  const feed = $('feed');
  const S = { id: null, run: null, i: 0, playing: !reduced(), picked: false, timer: 0, resolveT: 0, visible: false, waiting: false, seq: 0, dead: false };

  // ── static parts for an idea (no toolchain needed)
  function frame(id) {
    const x = ideaById[id];
    $('ic').innerHTML = glyph(x.icon, 26);
    $('name').textContent = x.name;
    $('short').textContent = x.short;
    const a = $('launch');
    if (a) a.href = `build.html?idea=${encodeURIComponent(id)}`;
    $('cast').innerHTML = SCENES[id].cast.map((n) => `<li class="rp-who" data-who="${esc(n)}"><span class="rp-av"><span class="rp-tile">${avatar(n, 28)}</span><span class="rp-badges"></span></span><span class="rp-nm">${esc(n)}</span></li>`).join('');
    $('chips').innerHTML = '';
    feed.classList.remove('full');
    $('pay').innerHTML = '';
    $('prog').innerHTML = '';
    $('clock').textContent = '';
    feed.innerHTML = '<li class="rp-wait"><span class="rp-dots"><i></i><i></i><i></i></span>Loading the rule…</li>';
    const all = [...el.querySelectorAll('.rp-tab')];
    all.forEach((t) => { const on = t.dataset.id === id; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    if (all.length && !all.some((t) => t.tabIndex === 0)) all[0].tabIndex = 0;
  }

  async function show(id, { user = false } = {}) {
    if (!hasPlay(id)) return;
    if (user) S.picked = true;
    clearTimeout(S.timer); clearTimeout(S.resolveT); S.pending = null;
    const changed = S.id !== id;
    S.id = id; S.run = null; S.i = 0;
    const my = ++S.seq;
    frame(id);
    if (changed) onShow?.(id);
    if (!S.visible && !S.loadNow) return; // loads when it comes on screen
    let run = null;
    try { run = await sceneRun(id); } catch { /* bundle failed */ }
    if (my !== S.seq || S.dead) return;
    if (!run) { feed.innerHTML = '<li class="rp-wait">This scene didn’t load. Reload the page to try again.</li>'; return; }
    S.run = run;
    $('prog').innerHTML = run.frames.slice(1).map((f) => `<i class="${f.type === 'crowd' ? 'crowd' : ''}"></i>`).join('');
    $('pay').innerHTML = run.payout ? `${glyph('coin', 14)}<span>${esc(run.payout)}</span>` : `${glyph('lock', 14)}<span>This rule only blocks trades. It never moves anyone’s funds.</span>`;
    feed.innerHTML = '';
    paint(run.frames[0]);
    feed.insertAdjacentHTML('beforeend', intro(id, 'The coin launches with this rule'));
    S.i = 1;
    syncButtons();
    schedule(frameMs(run.frames[0]));
  }

  // (in the drawer the rule's line is already in the header above)
  const intro = (id, lead) => `<li class="rp-sys">${glyph('custom', 12)}<span><b>${lead}${head ? ':' : '.'}</b>${head ? ` ${esc(ideaById[id].line)}` : ''}${reduced() ? ' Press Next to trade.' : ''}</span></li>`;

  // ── painting
  function paint(f) {
    $('clock').textContent = f.clock;
    const chips = $('chips');
    const old = Object.fromEntries([...chips.children].map((c) => [c.dataset.k, c.dataset.v]));
    chips.innerHTML = f.chips.map(([k, val]) => `<span class="rp-chip${old[k] !== undefined && old[k] !== val ? ' flash' : ''}" data-k="${esc(k)}" data-v="${esc(val)}"><span class="pixel">${esc(k)}</span><b>${esc(val)}</b></span>`).join('');
    badges(f.badges);
  }
  /** Move badges between cast tiles (FLIP: a crown slides from the old king to the new one). */
  function badges(list) {
    const before = new Map([...el.querySelectorAll('.rp-badge')].map((b) => [b.dataset.key, b.getBoundingClientRect()]));
    el.querySelectorAll('.rp-badges').forEach((b) => { b.innerHTML = ''; });
    const seen = {};
    for (const b of list) {
      const box = el.querySelector(`.rp-who[data-who="${CSS.escape(b.who)}"] .rp-badges`);
      if (!box) continue;
      const k = b.glyph ?? 'text';
      seen[k] = (seen[k] ?? 0) + 1;
      const key = `${k}:${b.who}`;
      box.insertAdjacentHTML('beforeend', `<span class="rp-badge${b.glyph ? '' : ' txt'}" data-key="${esc(key)}" data-g="${esc(k)}">${b.glyph ? glyph(b.glyph, 14) : `<span class="pixel">${esc(b.text)}</span>`}</span>`);
    }
    if (reduced()) return;
    // single-holder badges (crown, potato, tag, mic): slide from wherever that glyph was before
    const prevByGlyph = {};
    for (const [key, r] of before) { const g = key.split(':')[0]; (prevByGlyph[g] ??= []).push([key, r]); }
    el.querySelectorAll('.rp-badge').forEach((n) => {
      const g = n.dataset.g, now = n.getBoundingClientRect();
      let from = before.get(n.dataset.key);
      if (!from && seen[g] === 1 && prevByGlyph[g]?.length === 1) from = prevByGlyph[g][0][1];
      if (!from) { n.animate([{ transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.7 }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' }); return; }
      const dx = from.left - now.left, dy = from.top - now.top;
      if (dx || dy) n.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1.15)` }, { transform: 'translate(0, -10px) scale(1.2)', offset: 0.6 }, { transform: 'none' }], { duration: 640, easing: 'cubic-bezier(.3,.7,.2,1)' });
    });
  }
  const tile = (who) => (who ? el.querySelector(`.rp-who[data-who="${CSS.escape(who)}"]`) : null);
  /**
   * Wrap every change to the feed in this. It fills from the top; once full it pins the newest line to the bottom and
   * older lines slide up and fade out at the top.
   */
  function fitting(change) {
    const before = new Map([...feed.children].map((li) => [li, li.getBoundingClientRect().top]));
    change();
    if (!feed.classList.contains('full') && feed.scrollHeight > feed.clientHeight + 1) feed.classList.add('full');
    if (feed.classList.contains('full')) {
      const top = feed.getBoundingClientRect().top;
      while (feed.children.length > 1 && feed.firstElementChild.getBoundingClientRect().bottom < top - 4) feed.firstElementChild.remove();
    }
    if (reduced()) return;
    for (const li of feed.children) {
      const t0 = before.get(li);
      const dy = t0 == null ? 0 : t0 - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }
  function lineHTML(f) {
    const icon = f.type === 'crowd' ? glyph('people', 16) : avatar(f.who, 16);
    return `<span class="rp-t mono">${esc(f.time)}</span><span class="rp-a">${icon}</span><span class="rp-what">${esc(f.text)}</span><span class="rp-v pixel"><span class="rp-dots"><i></i><i></i><i></i></span></span>`;
  }
  function resolve(li, f, idx) {
    const ok = f.verdict === 'ok';
    li.classList.remove('pend');
    li.classList.add(ok ? 'ok' : 'no');
    fitting(() => {
      li.querySelector('.rp-v').innerHTML = ok ? `${V_OK}${f.type === 'crowd' ? 'All go through' : 'Goes through'}` : `${V_NO}Blocked`;
      if (!ok && f.message) li.insertAdjacentHTML('beforeend', `<q class="rp-msg">${esc(f.message)}</q>`);
      if (f.notes.length) li.insertAdjacentHTML('beforeend', `<span class="rp-notes">${f.notes.map((n) => `<span class="rp-note${n.hi ? ' hi' : ''}">${n.glyph ? glyph(n.glyph, 13) : ''}<span>${esc(n.text)}</span></span>`).join('')}</span>`);
    });
    paint(f);
    const t = tile(f.who);
    if (t) { t.classList.remove('act'); t.classList.add(ok ? 'ok' : 'no'); setTimeout(() => t.classList.remove('ok', 'no'), 900); }
    const seg = $('prog').children[idx - 1];
    if (seg) seg.className = `on ${ok ? '' : 'no'}`;
  }

  function step() {
    const run = S.run;
    if (!run) return;
    if (S.i >= run.frames.length) { restart(); return; }
    const idx = S.i++;
    const f = run.frames[idx];
    flush();
    el.querySelectorAll('.rp-who.act').forEach((t) => t.classList.remove('act'));
    const li = document.createElement('li');
    li.className = `rp-ln pend${f.type === 'crowd' ? ' crowd' : ''}`;
    li.innerHTML = lineHTML(f);
    fitting(() => {
      if (f.jump) feed.insertAdjacentHTML('beforeend', `<li class="rp-ff"><span class="pixel">${IC.ff}${esc(f.jump)}</span></li>`);
      feed.append(li);
    });
    if (f.jump) { const c = $('clock'); c.classList.remove('jump'); void c.offsetWidth; c.classList.add('jump'); }
    $('clock').textContent = f.clock;
    tile(f.who)?.classList.add('act');
    if (reduced() || !S.playing) resolve(li, f, idx);
    else { S.pending = [li, f, idx]; S.resolveT = setTimeout(flush, RESOLVE); }
    syncButtons();
  }

  /** Show the chain's answer for the trade on screen now (if it's still pending). */
  function flush() {
    clearTimeout(S.resolveT);
    const p = S.pending;
    S.pending = null;
    if (p && !S.dead) resolve(...p);
  }

  function restart() {
    clearTimeout(S.timer); clearTimeout(S.resolveT); S.pending = null;
    if (!S.run) return;
    feed.innerHTML = '';
    feed.classList.remove('full');
    el.querySelectorAll('.rp-who').forEach((t) => t.classList.remove('act', 'ok', 'no'));
    [...$('prog').children].forEach((s) => { s.className = ''; });
    const f0 = S.run.frames[0];
    el.querySelectorAll('.rp-badges').forEach((b) => { b.innerHTML = ''; });
    paint(f0);
    feed.insertAdjacentHTML('beforeend', intro(S.id, 'A fresh launch'));
    S.i = 1;
    syncButtons();
    schedule(frameMs(f0));
  }

  // ── the clock: one timer; it holds while the player is off screen or the tab is hidden
  function schedule(ms) {
    clearTimeout(S.timer);
    if (!S.playing || reduced()) return;
    S.timer = setTimeout(tick, ms);
  }
  function tick() {
    if (S.dead || !el.isConnected) { destroy(); return; }
    if (!S.playing) return;
    if (!S.visible || document.hidden) { S.waiting = true; return; }
    const run = S.run;
    if (!run) return;
    if (S.i >= run.frames.length) {
      // the end: next tab (until someone picks one), else play it again
      if (tabs && !S.picked) { const j = (ids.indexOf(S.id) + 1) % ids.length; show(ids[j]); }
      else restart();
      return;
    }
    const f = run.frames[S.i];
    step();
    schedule(frameMs(f) + (S.i >= run.frames.length ? 2600 : 0));
  }
  function wake() { if (S.waiting && S.visible && !document.hidden) { S.waiting = false; tick(); } }

  function syncButtons() {
    const b = el.querySelector('[data-act="play"]');
    const r = reduced();
    b.hidden = r;
    b.innerHTML = S.playing ? `${IC.pause}<span>Pause</span>` : `${IC.play}<span>Play</span>`;
    b.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    const st = el.querySelector('[data-act="step"]');
    st.classList.toggle('ic', !r);
    st.innerHTML = r ? `${IC.step}<span>Next</span>` : IC.step;
    feed.setAttribute('aria-live', S.playing && !r ? 'off' : 'polite');
    el.dataset.state = S.playing && !r ? 'playing' : 'paused';
  }

  // ── wiring
  el.addEventListener('click', (e) => {
    const t = e.target.closest('.rp-tab');
    if (t) { show(t.dataset.id, { user: true }); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'play') {
      S.playing = !S.playing;
      S.picked = true;
      syncButtons();
      if (S.playing) { if (S.run && S.i >= S.run.frames.length) restart(); else schedule(250); } else clearTimeout(S.timer);
    } else if (act === 'step') {
      S.picked = true;
      if (!reduced() && S.playing) { S.playing = false; clearTimeout(S.timer); syncButtons(); }
      step();
    } else if (act === 'again') { S.picked = true; restart(); }
  });
  el.querySelector('.rp-tabs')?.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const all = [...el.querySelectorAll('.rp-tab')];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    all[j].focus();
    show(all[j].dataset.id, { user: true });
  });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
    for (const x of es) {
      if (x.target === el) {
        S.visible = x.isIntersecting && x.intersectionRatio > 0.25;
        if (S.visible) wake();
      } else if (x.isIntersecting && !S.loadNow) { S.loadNow = true; show(S.id); }
    }
  }, { threshold: [0, 0.25, 0.5] }) : null;
  const near = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting) && !S.loadNow) { S.loadNow = true; near.disconnect(); show(S.id); } }, { rootMargin: '600px 0px' }) : null;
  if (io) { io.observe(el); near.observe(el); } else { S.visible = true; S.loadNow = true; }
  const onVis = () => wake();
  document.addEventListener('visibilitychange', onVis);

  function destroy() {
    S.dead = true;
    clearTimeout(S.timer); clearTimeout(S.resolveT);
    io?.disconnect(); near?.disconnect();
    document.removeEventListener('visibilitychange', onVis);
  }

  syncButtons();
  show(ids[0]);
  return { show: (id) => show(id, { user: true }), destroy };
}
