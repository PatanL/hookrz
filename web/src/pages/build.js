// Launch page (build.html): three steps by default — 1 Rules (a rulebook, your own rule in English, ideas, a quick
// bot test), 2 Coin, 3 Review and launch — with "Customize rules" opening the full configurator (palette → rack →
// editor, the budget and the simulator) on the same state. All page state lives in one object (S); the rules, the
// coin form and the view persist in localStorage so a reload never loses work.
// URL: ?preset=<id> ?add=<block> ?remix=<ticker> ?rule=<English> ?idea=<example> (one-shot), #presets #stack
// #simulate #launch, and the steps #rules #coin #review (back/forward move between steps).
import '../styles/base.css';
import '../styles/build.css';
import { mountChrome, toast } from '../ui/chrome.js';
import { byId, ENGINE, defaults } from '../data/blocks.js';
import { budget, normalize } from '../engine/engine.js';
import { api, diffStacks } from '../api/client.js';
import { q } from '../core/format.js';
import { remixBarHTML, paletteHTML, rackHTML, editorHTML } from '../ui/build-rack.js';
import { budgetHTML, pageWarnings } from '../ui/build-budget.js';
import { simHTML, mountChart } from '../ui/build-sim.js';
import { createLaunch } from '../ui/build-launch.js';
import { headHTML, stepsHTML, remixLineHTML, booksHTML, ownHTML, ownStatusHTML, sumHTML } from '../ui/build-simple.js';
import { RULEBOOKS, bookOf, plainRule } from '../ui/build-plain.js';
import { ideaById } from '../data/ideas.js';
import { stateFromDraft, upgradeState, wire as wireHs, refresh as refreshHs, needsCheck, ideaState, STARTER } from '../ui/hs-editor.js';

mountChrome('build');

const KEY = 'hookrz:build-draft';
let n = 0;
const uid = () => `s${Date.now().toString(36)}${(n++).toString(36)}`;
const slotOf = (id, params) => ({ uid: uid(), id, params: { ...defaults(id), ...(params ?? {}) }, draft: null });

/** The whole page state. */
export const S = {
  stack: [],              // [{ uid, id, params, draft }] — slot order = array order
  sel: null,              // uid of the selected slot
  fam: 'guard',           // open palette family
  parent: null,           // remix parent: { ticker, name, handle, stack, image }
  hist: [],               // undo snapshots of the stack
  drafting: {},           // uid -> true while a Hookscript draft is in flight
  draftErr: {},           // uid -> message
  sim: { seed: 7, res: null, busy: false, sig: null, err: null },
  view: {
    step: 1,              // 1 rules · 2 coin · 3 review and launch
    adv: false,           // "Customize rules" open
    ownText: '',          // the own-rule text box (written into the Custom block on "Write my rule")
    ownEdit: false,       // the own-rule text box is open over an existing rule
    ownMsg: null,         // a note under the text box before any rule exists
    code: false,          // "Show the code" open
    txOpen: false,        // "Transaction details" open
  },
  launch: {
    meta: { name: '', ticker: '', desc: '', image: null, x: '', tg: '', web: '', buy: '' },
    errs: {}, prep: null, prepSig: null, busy: false, err: null, done: null,
  },
};


/** The stack as launched: params, plus the Custom block's Hookscript source once it compiles. */
export const plain = () => S.stack.map((s) => ({ id: s.id, params: { ...s.params, ...(s.id === 'custom' && s.draft?.compile?.ok ? { script: s.draft.source } : {}) } }));
export const sig = () => JSON.stringify(plain().map((s) => [s.id, s.params]));
const selSlot = () => S.stack.find((s) => s.uid === S.sel) ?? null;
const ownSlot = () => S.stack.find((s) => s.id === 'custom') ?? null;

// ───────────────────────── persistence ─────────────────────────
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const data = {
      v: 2, fam: S.fam, sel: S.stack.findIndex((s) => s.uid === S.sel), parent: S.parent?.ticker ?? null, seed: S.sim.seed,
      stack: S.stack.map((s) => ({ id: s.id, params: s.params, draft: s.draft ? { ...s.draft, _t: undefined } : null })), meta: S.launch.meta,
      view: { adv: S.view.adv, ownText: S.view.ownText, code: S.view.code },
    };
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch { try { localStorage.setItem(KEY, JSON.stringify({ ...data, meta: { ...data.meta, image: null } })); } catch { /* storage off */ } }
  }, 200);
}
function loadDraft() { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } }
function clearDraft() { try { localStorage.removeItem(KEY); } catch { /* */ } }

// ───────────────────────── layout ─────────────────────────
const app = document.getElementById('app');
app.innerHTML = `
<section class="l-top"><div class="wrap l-wrap">
  <div class="l-head" id="lHead">${headHTML()}<ol class="l-steps" id="lSteps" aria-label="Launch steps"></ol></div>
  <div id="remixLine"></div>
</div></section>
<section class="l-s1" id="stepRules" aria-label="Step 1: rules"><div class="wrap l-wrap">
  <div class="l-rules">
    <div class="l-pick">
      <div class="l-blk" id="presets"></div>
      <div class="l-blk own" id="own"></div>
    </div>
    <aside class="l-sum panel" id="sum" aria-label="Your rules"></aside>
  </div>
</div></section>
<div class="l-adv" id="adv" hidden>
  <section class="adv-top"><div class="wrap">
    <div class="adv-h"><div><span class="eyebrow">Customize rules</span><h2>Every rule, every number</h2><p class="dim">Tune settings, reorder, and add any rule from the catalog. Changes show up in step 1 too.</p></div>
      <button class="btn btn-glass btn-sm" data-act="adv">Close customize</button></div>
    <div id="remixBar"></div>
  </div></section>
  <section class="b-bench" id="stack" aria-label="Rule configurator"><div class="wrap">
    <div class="bench">
      <aside class="pal panel" id="pal" aria-label="Rule palette"></aside>
      <div class="rack-panel" id="rack"></div>
      <div class="editor panel" id="editor" aria-live="polite"></div>
      <aside class="bud panel" id="bud" aria-label="Budget"></aside>
    </div>
  </div></section>
  <section class="b-sim" id="simulate"><div class="wrap" id="sim"></div></section>
</div>
<section class="l-s23" id="launch" aria-label="Launch"><div class="wrap l-wrap" id="launchRoot"></div></section>`;

const $ = (id) => document.getElementById(id);
function paint(el, html) {
  const a = document.activeElement;
  const fk = a && el.contains(a) ? a.dataset.fk : null;
  el.innerHTML = html;
  if (fk) el.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
}

function ctx() {
  const b = budget(plain());
  const warnings = [...pageWarnings(S), ...b.warnings];
  return { S, b, warnings, ok: !warnings.some((w) => w.level === 'error' || w.level === 'need'), diff: S.parent ? diffStacks(S.parent.stack, plain()) : null };
}

const canGo = (k) => k === 1 || (S.stack.length > 0 && (k === 2 || S.view.step >= 2));
function renderTop() { paint($('lSteps'), stepsHTML(S, canGo)); paint($('remixLine'), remixLineHTML(S)); }
function renderBooks() { paint($('presets'), booksHTML(S)); }
function renderOwn() { paint($('own'), ownHTML(S)); }
/** The own-rule card's live parts only (status, title), so typing in its text box or code keeps the caret. */
function patchOwn() {
  const box = $('own');
  if (!box.contains(document.activeElement)) { renderOwn(); return; }
  const st = box.querySelector('[data-own-status]'); if (st) st.innerHTML = ownStatusHTML(S);
  const s = ownSlot(), t = box.querySelector('[data-own-title]'); if (s && t) t.textContent = plainRule(s).title;
}
function renderSum(c = ctx()) { paint($('sum'), sumHTML(S, c, sig())); }
function renderBench(c = ctx()) {
  if (!S.view.adv) return;
  paint($('remixBar'), remixBarHTML(S, c));
  paint($('pal'), paletteHTML(S));
  paint($('rack'), rackHTML(S, c));
  paint($('bud'), budgetHTML(S, c));
}
function renderEditor(c = ctx()) { if (S.view.adv) paint($('editor'), editorHTML(S, c)); }
function renderSim() { if (!S.view.adv) return; paint($('sim'), simHTML(S, sig())); mountChart($('sim'), S); }
function renderView() {
  const done = !!S.launch.done, k = S.view.step;
  $('stepRules').hidden = done || k !== 1;
  $('adv').hidden = done || k !== 1 || !S.view.adv;
  $('launch').hidden = !done && k === 1;
  document.body.dataset.step = done ? 'done' : String(k);
}
const launch = createLaunch({ S, root: $('launchRoot'), paint, plain, sig, ctx, save, clearDraft, toast, go: (k) => goStep(k), onReset: resetAll });
function renderAll() {
  const c = ctx();
  renderView(); renderTop();
  if (S.view.step === 1 && !S.launch.done) { renderBooks(); renderOwn(); renderSum(c); renderBench(c); renderEditor(c); renderSim(); }
  launch.render();
}

/** After any change to the rules: everything that depends on them (the editor and the own-rule card stay put while typing). */
function changed({ editor = true, own = true } = {}) {
  const c = ctx();
  renderTop(); renderBooks();
  if (own) renderOwn(); else patchOwn();
  renderSum(c);
  if (S.view.adv) {
    renderBench(c);
    if (editor) renderEditor(c);
    $('sim').classList.toggle('stale', !!S.sim.res && S.sim.sig !== sig());
    if (S.sim.res) { const st = $('sim').querySelector('[data-stale]'); if (st) st.hidden = S.sim.sig === sig(); }
    else renderSim(); // no results yet: the empty panel's button depends on whether the stack has blocks
  }
  launch.stackChanged();
  save();
}

// ───────────────────────── steps ─────────────────────────
const HASH = { 1: '#rules', 2: '#coin', 3: '#review' };
let going = 0;
/** Move to step k (1–3). Step 2 needs a rule; step 3 needs a valid coin (else it lands on step 2 with the errors). */
async function goStep(k, { push = true, scroll = true } = {}) {
  const me = ++going;
  if (S.launch.done) { renderAll(); scrollTo({ top: 0, behavior: 'instant' }); return; }
  if (k >= 2 && !S.stack.length) { if (S.view.step === 1) toast('Pick a rulebook or write your own rule first.'); k = 1; }
  if (k === 3 && !S.launch.done) {
    const ok = await launch.checkCoin({ quiet: true });
    if (me !== going) return;
    if (!ok) k = 2;
    else { S.launch.prep = null; S.launch.err = null; }
  }
  const from = S.view.step;
  S.view.step = k;
  if (push && location.hash !== HASH[k]) history.pushState({ step: k }, '', location.pathname + location.search + HASH[k]);
  renderAll();
  if (scroll && from !== k) scrollTo({ top: 0, behavior: 'instant' });
  if (k === 2 && Object.keys(S.launch.errs).length) $('launchRoot').querySelector('[aria-invalid="true"]')?.focus();
}
/** Where the URL fragment points: a step, or an old anchor (#presets, #stack, #simulate, #launch). */
async function fromHash() {
  const h = location.hash.slice(1);
  if (h === 'coin' || h === 'launch') return goStep(2, { push: false });
  if (h === 'review') return goStep(3, { push: false });
  await goStep(1, { push: false, scroll: false });
  if (h === 'stack' || h === 'simulate') { if (!S.view.adv) toggleAdv(true, false); settleOn($(h)); }
  else if (h === 'presets') settleOn($('presets'));
}
/** Scroll to an anchor, and once more after the Customize images load (they push it down) unless the visitor scrolled. */
function settleOn(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ block: 'start' });
    const y = scrollY;
    setTimeout(() => { if (Math.abs(scrollY - y) < 4) el.scrollIntoView({ block: 'start' }); }, 700);
  });
}
window.addEventListener('popstate', fromHash);

function toggleAdv(open = !S.view.adv, scroll = true) {
  S.view.adv = open;
  renderView();
  const c = ctx();
  if (open) { renderBench(c); renderEditor(c); renderSim(); }
  renderOwn(); renderSum(c);
  save();
  if (open && scroll) requestAnimationFrame(() => $('adv').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ───────────────────────── actions ─────────────────────────
function snapshot() { S.hist.push(S.stack.map((s) => ({ ...s, params: { ...s.params } }))); if (S.hist.length > 30) S.hist.shift(); }

function add(id, at = S.stack.length) {
  const b = byId[id];
  if (!b) return;
  const have = S.stack.findIndex((s) => s.id === id);
  if (have >= 0) { S.sel = S.stack[have].uid; changed(); toast(`${b.name} is already in slot ${have + 1}.`); return; }
  if (S.stack.length >= ENGINE.maxSlots) { toast(`The rack holds ${ENGINE.maxSlots} blocks. Remove one first.`); return; }
  snapshot();
  const s = slotOf(id);
  S.stack.splice(Math.max(0, Math.min(at, S.stack.length)), 0, s);
  S.sel = s.uid;
  changed();
}
function remove(u, { quiet = false } = {}) {
  const i = S.stack.findIndex((s) => s.uid === u);
  if (i < 0) return;
  snapshot();
  const [s] = S.stack.splice(i, 1);
  if (S.sel === u) S.sel = S.stack[Math.min(i, S.stack.length - 1)]?.uid ?? null;
  if (s.id === 'custom') { delete S.draftErr[u]; S.view.ownEdit = false; }
  changed();
  if (!quiet) toast(S.view.adv ? `Removed ${byId[s.id].name} from slot ${i + 1}.` : `Removed ${plainRule(s).title}.`);
}
function moveTo(u, to) {
  const i = S.stack.findIndex((s) => s.uid === u);
  to = Math.max(0, Math.min(to, S.stack.length - 1));
  if (i < 0 || i === to) return;
  snapshot();
  const [s] = S.stack.splice(i, 1);
  S.stack.splice(to, 0, s);
  changed();
}
function loadStack(slots, { sel = 0 } = {}) {
  snapshot();
  S.stack = slots.slice(0, ENGINE.maxSlots).map((x) => {
    const { script, ...params } = x.params ?? {};
    const s = slotOf(x.id, params);
    // a remixed Custom block keeps its Hookscript (re-checked below)
    if (x.id === 'custom' && script) s.draft = { source: script, prompt: (params.prompt ?? '').trim(), compile: null, check: null };
    return s;
  });
  S.sel = S.stack[sel]?.uid ?? null;
  if (S.stack[0]) S.fam = byId[S.stack[0].id].family;
}
/** Pick a rulebook (or un-pick the current one). Your own rule stays, after the rulebook's rules. */
function pickBook(id) {
  const p = RULEBOOKS.find((x) => x.id === id);
  if (!p) return;
  const own = ownSlot(), was = bookOf(S.stack)?.id, mixed = !was && S.stack.some((s) => s.id !== 'custom');
  snapshot();
  S.stack = [...(was === id ? [] : p.slots.map(([bid, prm]) => slotOf(bid, prm))), ...(own ? [own] : [])];
  S.sel = S.stack[0]?.uid ?? null;
  if (S.stack[0]) S.fam = byId[S.stack[0].id].family;
  changed();
  if (mixed && was !== id) toast(`Swapped your rules for ${p.name}. Undo is under Customize rules.`);
}
function startEmpty() {
  if (!S.stack.length && !S.parent) return;
  snapshot();
  S.stack = []; S.sel = null; S.parent = null;
  changed();
  toast('Empty rack. Pick blocks from the palette.');
}
function undo() {
  const prev = S.hist.pop();
  if (!prev) return;
  S.stack = prev;
  if (!S.stack.some((s) => s.uid === S.sel)) S.sel = S.stack[0]?.uid ?? null;
  changed();
}
function resetAll() {
  S.stack = []; S.sel = null; S.parent = null; S.hist = []; S.sim.res = null; S.sim.sig = null;
  Object.assign(S.view, { step: 1, ownText: '', ownEdit: false, ownMsg: null, code: false, txOpen: false });
  clearDraft();
  history.replaceState(null, '', location.pathname);
  renderAll();
  scrollTo({ top: 0 });
}

/** The drafter said no (honeypot request, or a rule it can't draft): why, plus rules it can draft instead. */
function declined(d) {
  const opts = d.alternative ? [d.alternative] : (d.suggestions ?? []);
  const hp = d.honeypot?.ok === false;
  return { text: hp ? (d.message ?? '') : "hookrz can't draft that rule yet. Pick a close one, or write the Hookscript yourself.", honeypot: hp, options: opts.map((o) => ({ label: o.title ?? o.prompt, text: o.prompt })) };
}
async function draftScript(u) {
  const s = S.stack.find((x) => x.uid === u);
  if (!s) return;
  const prompt = (s.params.prompt ?? '').trim();
  if (prompt.length < 8) { S.draftErr[u] = 'Describe the rule in a full sentence.'; renderEditor(); renderOwn(); return; }
  S.drafting[u] = true; delete S.draftErr[u]; renderEditor(); renderOwn();
  try {
    const d = await api.draftHookscript(prompt);
    if (d.ok === false && !d.bytecodeHex) S.draftErr[u] = declined(d);
    else { s.draft = stateFromDraft(d, prompt); S.view.ownEdit = false; S.view.ownText = ''; }
  } catch (e) { S.draftErr[u] = e?.message || 'The Hookscript compiler did not answer. Try again.'; }
  delete S.drafting[u];
  changed();
  checkHs(s);
}
/** Compile + fuzz + honeypot for a slot whose script hasn't been checked yet (a fresh draft from a server without the
 *  full report, a reload, a hand-written start, an idea). */
function checkHs(s) {
  if (s?.id === 'custom' && needsCheck(s.draft)) refreshHs(s.uid, s.draft, (_st, info) => { if (info.checked) changed({ editor: false, own: false }); else { patchOwn(); renderSum(); save(); } });
}

/** "Write my rule": the text box becomes the Custom block's prompt (adding the block if needed), then the drafter runs. */
function ownDraft(text = S.view.ownText) {
  text = String(text ?? '').trim().slice(0, 280);
  S.view.ownText = text;
  if (text.length < 8) { S.view.ownMsg = 'Describe the rule in a full sentence, like the example in the box.'; renderOwn(); $('own-prompt')?.focus(); return; }
  S.view.ownMsg = null;
  let s = ownSlot();
  if (!s) {
    if (S.stack.length >= ENGINE.maxSlots) { S.view.ownMsg = `A coin carries ${ENGINE.maxSlots} rules at most. Remove one under Customize rules first.`; renderOwn(); return; }
    snapshot();
    s = slotOf('custom', { prompt: text });
    S.stack.push(s);
    S.sel = s.uid; S.fam = 'custom';
  } else { s.params.prompt = text; if (s.draft) S.view.ownEdit = true; }
  draftScript(s.uid);
}
/** ?idea= and the Ideas strip: the exact example script becomes your own rule (checked as usual). */
async function loadIdea(name) {
  const st = await ideaState(name).catch(() => null);
  if (!st) { toast('That idea isn’t available. Pick another one.'); return; }
  const meta = ideaById[name];
  if (meta) { st.title = meta.name; st.about = meta.line; st.prompt = meta.name; } // the site's name and plain line for it
  let s = ownSlot();
  if (!s && S.stack.length >= ENGINE.maxSlots) { toast(`A coin carries ${ENGINE.maxSlots} rules at most. Remove one under Customize rules first.`); return; }
  snapshot();
  if (!s) { s = slotOf('custom', { prompt: st.prompt }); S.stack.push(s); }
  else s.params.prompt = st.prompt;
  s.draft = st;
  delete S.draftErr[s.uid];
  Object.assign(S.view, { ownEdit: false, ownText: '', ownMsg: null });
  S.sel = s.uid; S.fam = 'custom';
  changed();
  checkHs(s);
}

async function runSim(newCrowd = false) {
  if (S.sim.busy) return;
  if (newCrowd) S.sim.seed = 1 + Math.floor(Math.random() * 9998);
  S.sim.busy = true; S.sim.err = null; renderSim(); renderSum();
  try {
    const t0 = performance.now();
    const res = await api.simulate(plain(), { seed: S.sim.seed });
    const left = 520 - (performance.now() - t0); // let the run read as a run
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    S.sim.res = res; S.sim.sig = sig();
  } catch (e) { S.sim.err = e?.message || 'Simulation failed. Try again.'; }
  S.sim.busy = false;
  $('sim').classList.remove('stale');
  renderSim(); renderSum();
  save();
}

// ───────────────────────── events ─────────────────────────
const ACT = {
  // step 1 (default view)
  step: (el) => goStep(+el.dataset.to),
  book: (el) => pickBook(el.dataset.id),
  toOwn: () => {
    const box = $('own');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('own-prompt')?.focus({ preventScroll: true }), 300);
  },
  ownDraft: () => ownDraft(),
  ownExample: (el) => { S.view.ownText = el.dataset.text; ownDraft(el.dataset.text); },
  ownChange: () => { const s = ownSlot(); S.view.ownEdit = true; S.view.ownText = s?.params.prompt ?? ''; renderOwn(); $('own-prompt')?.focus(); },
  ownCancel: () => { S.view.ownEdit = false; renderOwn(); },
  ownRm: () => { const s = ownSlot(); if (s) { S.view.ownText = ''; remove(s.uid); } },
  idea: (el) => loadIdea(el.dataset.id),
  adv: () => toggleAdv(),
  fullSim: () => { if (!S.view.adv) toggleAdv(true, false); settleOn($('simulate')); },
  // Customize (the advanced view)
  fam: (el) => { S.fam = el.dataset.fam; paint($('pal'), paletteHTML(S)); save(); },
  add: (el) => add(el.dataset.id),
  sel: (el) => { S.sel = el.dataset.uid; S.fam = byId[S.stack.find((s) => s.uid === S.sel)?.id]?.family ?? S.fam; changed(); },
  rm: (el) => remove(el.dataset.uid),
  mv: (el) => { const i = S.stack.findIndex((s) => s.uid === el.dataset.uid); moveTo(el.dataset.uid, i + +el.dataset.d); },
  preset: (el) => pickBook(el.dataset.id),
  empty: () => startEmpty(),
  undo: () => undo(),
  reset: (el) => { const s = S.stack.find((x) => x.uid === el.dataset.uid); if (!s) return; snapshot(); s.params = { ...defaults(s.id), ...(s.id === 'custom' ? { prompt: s.params.prompt } : {}) }; changed(); },
  parentParams: (el) => { const s = S.stack.find((x) => x.uid === el.dataset.uid); const p = S.parent?.stack.find((x) => x.id === s?.id); if (!s || !p) return; snapshot(); s.params = { ...p.params }; changed(); },
  draft: (el) => draftScript(el.dataset.uid),
  write: (el) => { const s = S.stack.find((x) => x.uid === el.dataset.uid); if (!s) return; s.draft = { source: STARTER, prompt: (s.params.prompt ?? '').trim(), compile: null, check: null }; changed(); checkHs(s); $('editor').querySelector('textarea[data-hse]')?.focus(); },
  example: (el) => { const s = selSlot(); if (!s) return; s.params.prompt = el.dataset.text; renderEditor(); changed({ editor: false }); draftScript(s.uid); },
  leaveRemix: () => { snapshot(); S.parent = null; S.stack = []; S.sel = null; history.replaceState(null, '', location.pathname + location.hash); changed(); toast('Starting fresh: pick a rulebook or write your own rule.'); },
  sim: () => runSim(false),
  crowd: () => runSim(true),
  toSim: () => { $('simulate').scrollIntoView({ behavior: 'smooth' }); },
  toLaunch: () => goStep(2),
  toPal: () => { const b = $('pal').querySelector('.pb:not(.in) .pb-main'); b?.focus(); $('pal').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('pal').classList.add('flash'); setTimeout(() => $('pal').classList.remove('flash'), 900); },
  toRack: () => { goStep(1).then(() => { if (!S.view.adv) toggleAdv(true, false); $('stack').scrollIntoView({ behavior: 'smooth' }); }); },
  selWarn: (el) => { const s = S.stack.find((x) => x.id === el.dataset.id); if (s) { S.sel = s.uid; changed(); $('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !app.contains(el) || el.disabled) return;
  const f = ACT[el.dataset.act];
  if (f) { e.preventDefault(); f(el, e); }
});
app.addEventListener('toggle', (e) => { if (e.target.matches?.('[data-own-code]')) { S.view.code = e.target.open; save(); } }, true);

// params: sliders, selects, the custom prompt — patch in place so a dragged slider keeps focus
app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('[data-own]')) { S.view.ownText = el.value; if (S.view.ownMsg) { S.view.ownMsg = null; $('own').querySelector('.own-err')?.remove(); } save(); return; }
  if (!el.matches('[data-p]')) return;
  const s = S.stack.find((x) => x.uid === el.dataset.uid);
  if (!s) return;
  const b = byId[s.id], p = b.params.find((x) => x.key === el.dataset.p);
  let v = el.value;
  if (el.type === 'range') {
    const d = (String(p.step).split('.')[1] ?? '').length;
    v = +(+v).toFixed(d);
    const out = $('editor').querySelector(`[data-pv="${p.key}"]`);
    if (out) out.textContent = p.fmt ? p.fmt(v) : v;
    el.setAttribute('aria-valuetext', p.fmt ? p.fmt(v) : String(v));
    el.style.setProperty('--fill', `${((v - p.min) / (p.max - p.min)) * 100}%`);
    const par = el.closest('.prm')?.querySelector('.prm-parent');
    if (par) par.classList.toggle('diff', S.parent?.stack.find((x) => x.id === s.id)?.params[p.key] !== v);
  }
  if (p.text) {
    const st = $('editor').querySelector('.hs-stale');
    if (st) st.hidden = !s.draft?.prompt || s.draft.prompt === v.trim();
  }
  s.params[p.key] = v;
  const msg = $('editor').querySelector('[data-errmsg]');
  if (msg && b.error) msg.textContent = b.error(s.params, {});
  changed({ editor: false });
});
// Enter writes the rule (Shift+Enter is a new line)
app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('[data-own]')) { e.preventDefault(); ownDraft(); }
});

// the Hookscript editor (own-rule card or Customize): compile as you type, then fuzz + honeypot (the budget and the launch gate follow)
wireHs(app, {
  get: (u) => S.stack.find((x) => x.uid === u)?.draft ?? null,
  onChange: (_u, _st, info) => {
    if (info.checked) { changed({ editor: false, own: false }); return; }
    const c = ctx();
    if (S.view.adv) { paint($('bud'), budgetHTML(S, c)); paint($('rack'), rackHTML(S, c)); }
    patchOwn(); renderSum(c); launch.stackChanged(); save();
  },
});

// keyboard: palette tabs (arrows), rack slots (arrows move focus, Shift+arrows reorder, Delete removes)
app.addEventListener('keydown', (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const i = (tabs.indexOf(tab) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
    S.fam = tabs[i].dataset.fam; paint($('pal'), paletteHTML(S)); $('pal').querySelector(`[data-fam="${S.fam}"]`)?.focus(); save();
    e.preventDefault(); return;
  }
  const bay = e.target.closest('.bay-main');
  if (bay) {
    const u = bay.dataset.uid, i = S.stack.findIndex((s) => s.uid === u);
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp', fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if ((back || fwd) && e.shiftKey) { moveTo(u, i + (fwd ? 1 : -1)); $('rack').querySelector(`[data-fk="bay-${u}"]`)?.focus(); e.preventDefault(); }
    else if (back || fwd) { const nx = S.stack[i + (fwd ? 1 : -1)]; if (nx) $('rack').querySelector(`[data-fk="bay-${nx.uid}"]`)?.focus(); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { remove(u); const nx = S.stack[Math.min(i, S.stack.length - 1)]; if (nx) $('rack').querySelector(`[data-fk="bay-${nx.uid}"]`)?.focus(); e.preventDefault(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && S.view.adv && !e.target.closest('input, textarea, select')) { undo(); e.preventDefault(); }
});

// drag & drop: palette → rack (insert), rack → rack (reorder), rack → palette (remove)
let drag = null;
app.addEventListener('dragstart', (e) => {
  const pb = e.target.closest?.('[data-drag-block]'), bay = e.target.closest?.('[data-drag-slot]');
  if (pb) { drag = { block: pb.dataset.dragBlock }; e.dataTransfer.effectAllowed = 'copy'; }
  else if (bay) { drag = { slot: bay.dataset.dragSlot }; e.dataTransfer.effectAllowed = 'move'; bay.classList.add('dragging'); }
  else return;
  e.dataTransfer.setData('text/plain', drag.block ?? drag.slot);
  $('rack').classList.add('dnd');
});
function dropIndex(e) {
  const bay = e.target.closest('.bay');
  if (bay) return +bay.dataset.bay;
  return e.target.closest('.rack') ? S.stack.length : null;
}
app.addEventListener('dragover', (e) => {
  if (!drag) return;
  const i = dropIndex(e);
  const overPal = drag.slot && e.target.closest('#pal');
  if (i == null && !overPal) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = overPal ? 'move' : drag.block ? 'copy' : 'move';
  $('rack').querySelectorAll('.bay.over').forEach((x) => x.classList.remove('over'));
  $('pal').classList.toggle('drop-out', !!overPal);
  if (i != null) $('rack').querySelector(`.bay[data-bay="${Math.min(i, drag.block ? S.stack.length : S.stack.length - 1)}"]`)?.classList.add('over');
});
app.addEventListener('drop', (e) => {
  if (!drag) return;
  e.preventDefault();
  const d = drag; endDrag();
  if (d.slot && e.target.closest('#pal')) { remove(d.slot); return; }
  const i = dropIndex(e);
  if (i == null) return;
  if (d.block) add(d.block, i);
  else moveTo(d.slot, i);
});
function endDrag() { drag = null; $('rack').classList.remove('dnd'); $('pal').classList.remove('drop-out'); app.querySelectorAll('.over, .dragging').forEach((x) => x.classList.remove('over', 'dragging')); }
app.addEventListener('dragend', endDrag);

// ───────────────────────── boot ─────────────────────────
async function boot() {
  const draft = loadDraft();
  const params = new URLSearchParams(location.search);
  const remix = (q('remix') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const preset = q('preset'), addId = q('add'), rule = (q('rule') ?? '').trim().slice(0, 280), idea = (q('idea') ?? '').trim().toLowerCase();
  if (draft?.meta) S.launch.meta = { ...S.launch.meta, ...draft.meta };
  if (draft?.fam) S.fam = draft.fam;
  if (draft?.seed) S.sim.seed = draft.seed;
  if (draft?.view) { S.view.adv = !!draft.view.adv; S.view.ownText = draft.view.ownText ?? ''; S.view.code = !!draft.view.code; }
  const restore = () => {
    S.stack = (draft?.stack ?? []).filter((s) => byId[s.id]).slice(0, ENGINE.maxSlots).map((s) => ({ ...slotOf(s.id, s.params), draft: upgradeState(s.draft) }));
    S.sel = S.stack[draft?.sel]?.uid ?? S.stack[0]?.uid ?? null;
  };
  const parentFrom = (c) => ({ ticker: c.ticker, name: c.name, handle: c.creatorInfo?.handle ?? c.creator, stack: normalize(c.stack), image: c.image ?? null, coin: c });

  if (remix) {
    const c = await api.coin(remix).catch(() => null);
    if (c) {
      S.parent = parentFrom(c);
      if (draft?.parent === c.ticker && draft.stack?.length) restore();
      else { loadStack(c.stack); S.hist = []; }
    } else { restore(); toast(`No coin with the ticker $${remix}.`); }
  } else if (preset && RULEBOOKS.some((p) => p.id === preset)) {
    const p = RULEBOOKS.find((x) => x.id === preset);
    restore();
    const own = ownSlot();
    loadStack(p.slots.map(([id, prm]) => ({ id, params: prm }))); S.hist = [];
    if (own) S.stack.push(own); // a rule you wrote stays with the new rulebook
  } else {
    restore();
    if (draft?.parent) { const c = await api.coin(draft.parent).catch(() => null); if (c) S.parent = parentFrom(c); }
  }
  if (addId && byId[addId]) {
    const have = S.stack.find((s) => s.id === addId);
    if (have) S.sel = have.uid;
    else if (S.stack.length < ENGINE.maxSlots) { const s = slotOf(addId); S.stack.push(s); S.sel = s.uid; if (addId !== 'custom') toast(`Added ${plainRule(s).title}. Tune it under Customize rules.`); }
    else toast(`Your coin already has ${ENGINE.maxSlots} rules, so ${byId[addId].name} was not added. Remove one first.`);
    S.fam = byId[addId].family;
    if (addId === 'custom' && !ownSlot()?.draft) { S.view.ownText = ownSlot()?.params.prompt ?? ''; }
  }
  if (S.sel) S.fam = byId[selSlot()?.id]?.family ?? S.fam;
  // ?preset, ?add, ?rule and ?idea are one-shot; the saved draft carries the work from here
  const once = ['preset', 'add', 'rule', 'idea'].filter((k) => params.has(k));
  if (once.length) { once.forEach((k) => params.delete(k)); history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash); }

  const h = location.hash.slice(1);
  renderAll();
  for (const s of S.stack) checkHs(s); // a restored Hookscript is compiled and checked again
  save();
  if (idea) await loadIdea(idea);
  else if (rule) { S.view.ownText = rule; ownDraft(rule); }
  if (rule || idea) {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    requestAnimationFrame(() => $('own').scrollIntoView({ block: 'center' }));
  } else if (h) fromHash();
}

boot();
