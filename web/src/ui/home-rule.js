// The hero's live rule card: what you type (or the example you pick) is drafted into a real rule by
// api.draftHookscript (in the browser, in a worker), then one blocked and one allowed trade are found by running short
// trade stories through the same interpreter (home-probe.js). Nothing loads until the visitor interacts.
import { api } from '../api/client.js';
import { esc } from '../core/format.js';
import { pixelIcon } from './pixel.js';
import { probe } from './home-probe.js';

const n = (x) => Number(x ?? 0).toLocaleString('en-US');
const X = pixelIcon('cross', { size: 16, color: 'currentColor', accent: 'currentColor' });
const V = pixelIcon('check', { size: 16, color: 'currentColor', accent: 'currentColor' });
const LOCK = pixelIcon('lock', { size: 16, color: '#c9d3e3' });

/** What the drafter and the interpreter say about the site's example rule (shown before anything loads). */
export const FIRST = {
  label: 'Example rule',
  title: 'No single sell over 25% of your bag in your first 2h',
  blocked: { text: 'A buyer sells half their bag, 30 min after launch', reason: null },
  allowed: { text: 'A buyer sells a fifth of their bag, 30 min after launch' },
  trades: 10000, safe: true,
};

export function cardHTML(r = FIRST) {
  return `<div class="rc-head"><span class="pixel rc-k">${esc(r.label)}</span><span class="rc-st pixel"><i></i><span data-st>Checked</span></span></div>
    <p class="rc-title">${esc(r.title)}</p>
    <ul class="rc-ex">
      ${r.blocked ? `<li class="no"><span class="rc-ic">${X}</span><div><b class="pixel">Blocked</b><span>${esc(r.blocked.text)}</span>${r.blocked.reason ? `<q>${esc(r.blocked.reason)}</q>` : ''}</div></li>` : ''}
      ${r.allowed ? `<li class="ok"><span class="rc-ic">${V}</span><div><b class="pixel">Allowed</b><span>${esc(r.allowed.text)}</span></div></li>` : ''}
    </ul>
    <p class="rc-foot">${LOCK}<span>${r.safe ? `Tested on ${n(r.trades)} trades. Every holder can still sell.` : `In ${n(r.trades)} test trades some holders could never sell, so this rule can’t launch as written.`}</span></p>`;
}

function failHTML(d) {
  const sug = (d?.suggestions ?? []).slice(0, 3);
  return `<div class="rc-head"><span class="pixel rc-k">Your rule</span></div>
    <p class="rc-title plain">hookrz can’t write that one yet.</p>
    ${sug.length ? `<p class="rc-sub">Closest rules it can write:</p><div class="rc-sug">${sug.map((s) => `<button type="button" class="ask-chip" data-fill="${esc(s.prompt)}">${esc(s.title)}</button>`).join('')}</div>` : ''}
    <p class="rc-foot">${LOCK}<span>You can still write it yourself on the launch page.</span></p>`;
}

/**
 * card: the card element. fill(text): put text in the hero input (the card's suggestion buttons call it).
 * Returns run(text): draft text and show the result (latest call wins).
 */
export function mountRuleCard(card, { fill }) {
  let seq = 0, hs = null;
  const toolchain = () => (hs ??= import('../hookscript/hs.js').then((m) => m.load()));
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fill]');
    if (b) { fill(b.dataset.fill); run(b.dataset.fill); }
  });

  async function run(text) {
    const my = ++seq;
    text = text.trim();
    if (!text) { card.classList.remove('busy'); card.innerHTML = cardHTML(); return; }
    card.classList.add('busy');
    const st = card.querySelector('[data-st]');
    if (st) st.textContent = 'Checking';
    try {
      const d = await api.draftHookscript(text);
      if (my !== seq) return;
      if (!d?.ok || !d.script) { card.classList.remove('busy'); card.innerHTML = failHTML(d); return; }
      const lib = await toolchain();
      const c = lib.compile(d.script);
      const ex = c.ok ? probe(lib, c.bytes, d.fuzz?.byKind) : { blocked: null, allowed: null };
      if (my !== seq) return;
      const title = d.title ?? text;
      if (!ex.blocked) Object.assign(ex, fromFuzz(d.fuzz));
      if (ex.blocked && ex.blocked.reason && sameWords(ex.blocked.reason, title)) ex.blocked.reason = null;
      card.classList.remove('busy');
      card.innerHTML = cardHTML({ label: 'Your rule', title, blocked: ex.blocked, allowed: ex.allowed, trades: d.fuzz?.trades ?? 10000, safe: d.honeypot?.ok !== false });
    } catch {
      if (my !== seq) return;
      card.classList.remove('busy');
      card.innerHTML = failHTML(null);
    }
  }
  return { run, warm: () => { toolchain().catch(() => {}); } };
}

/** No short story hit the rule: say what the 10,000-trade test saw instead (share blocked, the most common refusal). */
function fromFuzz(z) {
  if (!z?.trades || !(z.refusedPct > 0)) return { blocked: null, allowed: null };
  const top = Object.entries(z.byReason ?? {}).sort((x, y) => y[1] - x[1])[0]?.[0];
  const pct = z.refusedPct < 1 ? '<1' : `${Math.round(z.refusedPct)}`;
  return { blocked: { text: `${pct}% of ${n(z.trades)} test trades`, reason: top ? top.replace(/\{\}/g, '…') : null }, allowed: null };
}

/** The refusal message just repeats the rule's title (most of the same words): don't show it twice. */
function sameWords(a, b) {
  const w = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim().split(' '));
  const A = w(a), B = w(b);
  const both = [...A].filter((x) => B.has(x)).length;
  return both / Math.max(1, Math.min(A.size, B.size)) > 0.7;
}
