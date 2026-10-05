// Launch page, the default view: the header with the three steps, the remix line, and step 1 (rulebooks, your own
// rule, ideas, "Your rules" with the quick bot test). Pure render functions; build.js owns the state and the events.
// Plain words only: codes, CU and slots live behind "Customize rules".
import { SUPPLY, ARCHETYPES } from '../engine/sim.js';
import { ENGINE, BLOCKS } from '../data/blocks.js';
import { pixelIcon } from './pixel.js';
import { avatar } from './avatar.js';
import { ICON } from './icons.js';
import { esc } from '../core/format.js';
import { editorHTML as hsEditorHTML } from './hs-editor.js';
import { plainRule, RULEBOOKS, bookOf } from './build-plain.js';
import { IDEAS } from '../data/ideas.js';

export const STEPS = ['Rules', 'Coin', 'Launch'];
export const CROWD = Object.values(ARCHETYPES).reduce((a, x) => a + x.n, 0);
const icon = (name, size = 24, o = {}) => pixelIcon(name, { size, ...o });
const STRIP = IDEAS.filter((x) => x.strip);
const n = (x) => Number(x ?? 0).toLocaleString('en-US');

// ───────────────────────── header ─────────────────────────
export function headHTML() {
  return `<div class="l-title">
    <span class="eyebrow">Launch a coin</span>
    <h1><span class="chrome-text">Rules. Name. Launch.</span></h1>
    <p class="lede">Pick the rules your coin can't break, name it, sign. Solana enforces the rules on every trade.</p>
  </div>`;
}

export function stepsHTML(S, canGo) {
  const at = S.view.step, done = !!S.launch.done;
  return STEPS.map((label, i) => {
    const k = i + 1, on = k === at && !done, past = k < at || done;
    const go = !done && k !== at && canGo(k);
    const inner = `<span class="ls-n">${past ? ICON.check : k}</span><span class="ls-l">${label}</span>`;
    return `<li class="${on ? 'on' : past ? 'done' : ''}">${go ? `<button class="ls" data-act="step" data-to="${k}" data-fk="ls-${k}">${inner}</button>` : `<span class="ls"${on ? ' aria-current="step"' : ''}>${inner}</span>`}</li>`;
  }).join('<li class="ls-sep" aria-hidden="true"></li>');
}

export function remixLineHTML(S) {
  if (!S.parent) return '';
  const P = S.parent;
  return `<div class="l-remix">${avatar(P.coin ?? { ticker: P.ticker, image: P.image }, 30)}
    <span><b>Remixing <a href="coin.html?t=${encodeURIComponent(P.ticker)}">$${esc(P.ticker)}</a></b>: you're starting from its rules.</span>
    <button class="link" data-act="leaveRemix">Start fresh</button></div>`;
}

// ───────────────────────── step 1: rulebooks ─────────────────────────
export function booksHTML(S) {
  const on = bookOf(S.stack)?.id;
  return `<div class="l-h"><h2>Pick a rulebook</h2><p class="dim">Ready-made rules for the usual launch problems.</p></div>
  <div class="books" role="group" aria-label="Rulebooks">
    ${RULEBOOKS.map((p) => `<button class="book${on === p.id ? ' on' : ''}" data-act="book" data-id="${p.id}" data-fk="book-${p.id}" aria-pressed="${on === p.id}">
      <span class="book-ic">${icon(p.icon, 30)}</span>
      <span class="book-t"><b>${esc(p.name)}</b><span>${esc(p.outcome)}</span></span>
      <span class="book-n pixel">${on === p.id ? `${ICON.check}Picked` : `${p.slots.length} rules`}</span>
    </button>`).join('')}
    <button class="book own-card" data-act="toOwn" data-fk="book-own">
      <span class="book-ic">${icon('custom', 30)}</span>
      <span class="book-t"><b>Your own rule</b><span>Say it in English. hookrz writes it and tests it.</span></span>
      <span class="book-n pixel">${ownSlot(S)?.draft ? `${ICON.check}Added` : 'Write one'}</span>
    </button>
  </div>`;
}

// ───────────────────────── step 1: your own rule ─────────────────────────
const ownSlot = (S) => S.stack.find((s) => s.id === 'custom') ?? null;
const fresh = (st) => !!st?.check && st.check.source === st.source;

/** Where the custom rule stands, in plain words: { kind: wait|ok|bad, text, sub? }. */
export function ownStatus(S, s) {
  const st = s?.draft;
  if (!s) return null;
  if (S.drafting[s.uid]) return { kind: 'wait', text: 'Writing your rule…' };
  if (!st || !st.source?.trim()) return { kind: 'bad', text: 'Not written yet. Describe it above and press Write my rule.' };
  if (!st.compile) return { kind: 'wait', text: 'Reading your rule…' };
  if (!st.compile.ok) return { kind: 'bad', text: "The rule's code has a mistake, so it can't launch yet.", sub: 'Open “Show the code” to fix it, or describe the rule again.' };
  if (!fresh(st)) return { kind: 'wait', text: `Testing it on ${n(10000)} trades and making sure every holder can still sell…` };
  const k = st.check;
  if (k.panics || k.errors) return { kind: 'bad', text: 'It broke during the test trades, so it can\'t launch. Describe it differently.' };
  if (!k.honeypot?.ok) return { kind: 'bad', text: 'Not allowed: some holders could never sell.', sub: 'Every coin has to let holders sell eventually. Add a time limit, like “for the first 2 hours”.' };
  const top = Object.entries(k.byReason ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  return { kind: 'ok', text: `Tested on ${n(k.trades)} trades. Every holder can still sell eventually.`, sub: top ? `A blocked trader sees: “${top.replace(/\{\}/g, '…')}”` : null };
}

export function ownHTML(S) {
  const s = ownSlot(S), st = s?.draft, edit = !s || !st || S.view.ownEdit;
  const busy = s && S.drafting[s.uid], err = (s ? S.draftErr[s.uid] : null) ?? S.view.ownMsg;
  const text = S.view.ownText || (s && !st ? s.params.prompt ?? '' : '');
  const head = `<div class="l-h"><h2>Or describe your own rule</h2><p class="dim">Say it in English. hookrz writes it in Hookscript, then tests it before you can launch.</p></div>`;
  const form = `<div class="own-form">
      <label class="sr" for="own-prompt">Your rule, in English</label>
      <textarea class="input own-in" id="own-prompt" rows="2" maxlength="280" data-own="1" data-fk="own-prompt" placeholder="No single sell over a quarter of your bag in your first 2 hours">${esc(text)}</textarea>
      <div class="own-go">
        <button class="btn btn-chrome" data-act="ownDraft" data-fk="own-draft" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin" aria-hidden="true"></span>Writing…' : 'Write my rule'}</button>
        ${s && st && S.view.ownEdit ? '<button class="btn btn-ghost btn-sm" data-act="ownCancel">Keep the current rule</button>' : ''}
      </div>
      ${declinedHTML(err)}
    </div>`;
  const card = s && st && !edit ? ownCardHTML(S, s) : '';
  return `${head}${edit ? form : ''}${card}
    <div class="ideas"><span class="pixel ideas-k">Ideas</span><div class="ideas-row">${STRIP.map((x) => `<button class="idea${st?.idea === x.id ? ' on' : ''}" data-act="idea" data-id="${x.id}" data-fk="idea-${x.id}" title="${esc(x.short)}" aria-pressed="${st?.idea === x.id}">${icon(x.icon, 16)}<span>${esc(x.name)}</span></button>`).join('')}</div></div>`;
}

function declinedHTML(err) {
  if (!err) return '';
  if (typeof err === 'string') return `<p class="own-err" role="alert">${esc(err)}</p>`;
  return `<div class="hs-declined${err.honeypot ? ' hp' : ''}" role="alert"><p><b>${err.honeypot ? 'Not allowed: holders must always be able to sell eventually.' : 'hookrz couldn’t write that one.'}</b> ${esc(err.honeypot ? err.text : 'Try one of these, or say it another way.')}</p>
    ${err.options.length ? `<div class="hs-ex"><span class="dim">${err.honeypot ? 'Safe version' : 'Close rules'}</span>${err.options.map((o, k) => `<button class="hs-chip" data-act="ownExample" data-text="${esc(o.text)}" data-fk="alt-${k}" title="${esc(o.text)}">${esc(o.label)}</button>`).join('')}</div>` : ''}</div>`;
}

function ownCardHTML(S, s) {
  const r = plainRule(s), st = s.draft;
  return `<div class="own-rule">
    <div class="own-top"><span class="own-ic">${icon('custom', 26)}</span>
      <div class="own-t"><b data-own-title>${esc(r.title)}</b><p>${esc(r.does)}</p></div>
      <div class="own-acts"><button class="btn btn-ghost btn-sm" data-act="ownChange" data-fk="own-change">Change</button><button class="btn btn-ghost btn-sm" data-act="ownRm" data-fk="own-rm">Remove</button></div>
    </div>
    <div class="own-st" data-own-status aria-live="polite">${ownStatusHTML(S)}</div>
    ${S.view.adv ? '<p class="own-code-note dim">The code is open under Customize rules, below.</p>'
      : `<details class="own-code" data-own-code${S.view.code ? ' open' : ''}><summary>Show the code</summary>
        ${hsEditorHTML(st, s.uid, { rows: 8 })}
        <p class="hs-note-2">Hookscript is the small rule language your coin's rule is written in. Edit it here: it's checked again as you type. Rules people write show an Unreviewed badge on the coin page until hookrz reviews them.</p>
      </details>`}
  </div>`;
}

/** The live part of the own-rule card (patched in place while the checks run, so typing in the code never loses focus). */
export function ownStatusHTML(S) {
  const s = ownSlot(S), stt = ownStatus(S, s);
  if (!stt) return '';
  const mark = stt.kind === 'ok' ? icon('check', 16, { color: 'var(--up)' }) : stt.kind === 'bad' ? icon('cross', 16, { color: 'var(--refuse)' }) : '<span class="spin" aria-hidden="true"></span>';
  return `<span class="own-mark ${stt.kind}">${mark}</span><span><b>${esc(stt.text)}</b>${stt.sub ? `<span>${esc(stt.sub)}</span>` : ''}</span>`;
}

// ───────────────────────── step 1: your rules (summary column) ─────────────────────────
/** Launch blockers in plain words (the technical text stays in Customize's budget panel). */
export function plainProblems(c) {
  return c.warnings.filter((w) => w.level === 'error' || w.level === 'need').map((w) => {
    const t = w.text;
    if (/hookrz coins launch with a stack/.test(t)) return null; // the empty state already says it
    if (/^Custom Block:/.test(t)) return w.level === 'need' ? 'Your own rule is still being tested.' : 'Your own rule can\'t launch yet. See above.';
    if (/CU per transfer/.test(t)) return 'These rules are too heavy to run together. Drop one.';
    if (/extra accounts/.test(t)) return 'These rules read too much at once. Drop one.';
    if (/twice/.test(t)) return t.replace(/ is in the stack twice\./, ' is in your rules twice.');
    if (/holds \d+ blocks at most/.test(t)) return `A coin carries ${ENGINE.maxSlots} rules at most.`;
    return t;
  }).filter(Boolean);
}

export function sumHTML(S, c, curSig) {
  const rules = S.stack.map((s) => ({ s, r: plainRule(s) }));
  const book = bookOf(S.stack);
  const probs = plainProblems(c);
  const label = !rules.length ? 'Your rules' : book && rules.length === book.slots.length ? `${book.name}` : book ? `${book.name} + your own rule` : S.parent ? `$${S.parent.ticker}'s rules` : 'Your rules';
  return `<div class="sum-in">
    <div class="sum-h"><span class="pixel">${esc(label)}</span>${rules.length ? `<span class="dim">${rules.length} rule${rules.length === 1 ? '' : 's'}</span>` : ''}</div>
    ${rules.length ? `<ul class="yr">${rules.map(({ s, r }) => `<li class="${r.own ? 'own' : ''}"><span class="yr-ic">${icon(r.family, 20)}</span><div><b>${esc(r.title)}</b><span>${esc(r.does)}</span></div></li>`).join('')}</ul>`
      : `<div class="sum-empty">${icon('lock', 28, { color: 'var(--text-3)', accent: 'var(--chrome-4)' })}<p>Pick a rulebook or write your own rule. What your coin will refuse shows up here.</p></div>`}
    ${probs.length ? `<ul class="sum-probs" role="alert">${probs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    <button class="btn btn-chrome btn-lg sum-next" data-act="step" data-to="2" data-fk="sum-next" ${rules.length ? '' : 'disabled'}>Next: name your coin ${ICON.arrow}</button>
    <button class="sum-adv" data-act="adv" data-fk="adv" aria-expanded="${!!S.view.adv}" aria-controls="adv">${S.view.adv ? 'Close customize' : 'Customize rules'}<span class="dim">${S.view.adv ? '' : `tune numbers, add any of the ${BLOCKS.length} rules`}</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="${S.view.adv ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'}"/></svg></button>
  </div>`;
}

