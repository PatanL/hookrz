// Build page: the configurator (palette → rack → editor), the live budget, "Simulate launch",
// and the wallet-signed launch flow. All page state lives in one object (S); the draft stack and
// the launch form persist in localStorage so a reload never loses work.
import '../styles/base.css';
import '../styles/build.css';
import { mountChrome, toast } from '../ui/chrome.js';
import { byId, ENGINE, PRESETS, defaults } from '../data/blocks.js';
import { budget, normalize } from '../engine/engine.js';
import { api, diffStacks } from '../api/client.js';
import { q } from '../core/format.js';
import { headHTML, remixBarHTML, paletteHTML, rackHTML, editorHTML } from '../ui/build-rack.js';
import { budgetHTML, pageWarnings } from '../ui/build-budget.js';
import { simHTML, mountChart } from '../ui/build-sim.js';
import { createLaunch } from '../ui/build-launch.js';
import { stateFromDraft, upgradeState, wire as wireHs, refresh as refreshHs, needsCheck, STARTER } from '../ui/hs-editor.js';

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
  launch: {
    step: 0,
    meta: { name: '', ticker: '', desc: '', image: null, x: '', tg: '', web: '', buy: '' },
    errs: {}, prep: null, prepSig: null, busy: false, err: null, done: null,
  },
};

/** The stack as launched: params, plus the Custom block's Hookscript source once it compiles. */
export const plain = () => S.stack.map((s) => ({ id: s.id, params: { ...s.params, ...(s.id === 'custom' && s.draft?.compile?.ok ? { script: s.draft.source } : {}) } }));
export const sig = () => JSON.stringify(plain().map((s) => [s.id, s.params]));
const selSlot = () => S.stack.find((s) => s.uid === S.sel) ?? null;

// ───────────────────────── persistence ─────────────────────────
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const data = {
      v: 1, fam: S.fam, sel: S.stack.findIndex((s) => s.uid === S.sel), parent: S.parent?.ticker ?? null, seed: S.sim.seed,
      stack: S.stack.map((s) => ({ id: s.id, params: s.params, draft: s.draft ? { ...s.draft, _t: undefined } : null })), meta: S.launch.meta,
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
<section class="b-top"><div class="wrap">
  <div class="b-head" id="bHead"></div>
  <div id="remixBar"></div>
</div></section>
<section class="b-bench" id="stack" aria-label="Stack configurator"><div class="wrap">
  <div class="bench">
    <aside class="pal panel" id="pal" aria-label="Block palette"></aside>
    <div class="rack-panel" id="rack"></div>
    <div class="editor panel" id="editor" aria-live="polite"></div>
    <aside class="bud panel" id="bud" aria-label="Stack budget"></aside>
  </div>
</div></section>
<section class="b-sim" id="simulate"><div class="wrap" id="sim"></div></section>
<section class="b-launch" id="launch"><div class="wrap" id="launchRoot"></div></section>`;

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

function renderHead() { paint($('bHead'), headHTML(S)); }
function renderBench(c = ctx()) {
  paint($('remixBar'), remixBarHTML(S, c));
  paint($('pal'), paletteHTML(S));
  paint($('rack'), rackHTML(S, c));
  paint($('bud'), budgetHTML(S, c));
}
function renderEditor(c = ctx()) { paint($('editor'), editorHTML(S, c)); }
function renderSim() { paint($('sim'), simHTML(S, sig())); mountChart($('sim'), S); }
const launch = createLaunch({ S, root: $('launchRoot'), paint, plain, sig, ctx, save, clearDraft, toast, onReset: resetAll });
function renderAll() { const c = ctx(); renderHead(); renderBench(c); renderEditor(c); renderSim(); launch.render(); }

/** After any change to the stack: everything that depends on it, except the editor when a control is live. */
function changed({ editor = true } = {}) {
  const c = ctx();
  renderHead(); renderBench(c);
  if (editor) renderEditor(c);
  $('sim').classList.toggle('stale', !!S.sim.res && S.sim.sig !== sig());
  if (S.sim.res) { const st = $('sim').querySelector('[data-stale]'); if (st) st.hidden = S.sim.sig === sig(); }
  else renderSim(); // no results yet: the empty panel's button depends on whether the stack has blocks
  launch.stackChanged();
  save();
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
function remove(u) {
  const i = S.stack.findIndex((s) => s.uid === u);
  if (i < 0) return;
  snapshot();
  const [s] = S.stack.splice(i, 1);
  if (S.sel === u) S.sel = S.stack[Math.min(i, S.stack.length - 1)]?.uid ?? null;
  changed();
  toast(`Removed ${byId[s.id].name} from slot ${i + 1}.`);
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
function loadPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  loadStack(p.slots.map(([bid, params]) => ({ id: bid, params })));
  changed();
  toast(`Loaded ${p.name}. Undo puts your last stack back.`);
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
  clearDraft();
  history.replaceState(null, '', location.pathname);
  renderAll();
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
  if (prompt.length < 8) { S.draftErr[u] = 'Describe the rule in a full sentence.'; renderEditor(); return; }
  S.drafting[u] = true; delete S.draftErr[u]; renderEditor();
  try {
    const d = await api.draftHookscript(prompt);
    if (d.ok === false && !d.bytecodeHex) S.draftErr[u] = declined(d);
    else s.draft = stateFromDraft(d, prompt);
  } catch (e) { S.draftErr[u] = e?.message || 'The Hookscript compiler did not answer. Try again.'; }
  delete S.drafting[u];
  changed();
  checkHs(s);
}
/** Compile + fuzz + honeypot for a slot whose script hasn't been checked yet (a fresh draft from a server without the
 *  full report, a reload, a hand-written start). */
function checkHs(s) {
  if (s?.id === 'custom' && needsCheck(s.draft)) refreshHs(s.uid, s.draft, (_st, info) => { if (info.checked) changed({ editor: false }); else save(); });
}

async function runSim(newCrowd = false) {
  if (S.sim.busy) return;
  if (newCrowd) S.sim.seed = 1 + Math.floor(Math.random() * 9998);
  S.sim.busy = true; S.sim.err = null; renderSim();
  try {
    const t0 = performance.now();
    const res = await api.simulate(plain(), { seed: S.sim.seed });
    const left = 520 - (performance.now() - t0); // let the run read as a run
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    S.sim.res = res; S.sim.sig = sig();
  } catch (e) { S.sim.err = e?.message || 'Simulation failed. Try again.'; }
  S.sim.busy = false;
  $('sim').classList.remove('stale');
  renderSim();
  save();
}

// ───────────────────────── events ─────────────────────────
const ACT = {
  fam: (el) => { S.fam = el.dataset.fam; paint($('pal'), paletteHTML(S)); save(); },
  add: (el) => add(el.dataset.id),
  sel: (el) => { S.sel = el.dataset.uid; S.fam = byId[S.stack.find((s) => s.uid === S.sel)?.id]?.family ?? S.fam; changed(); },
  rm: (el) => remove(el.dataset.uid),
  mv: (el) => { const i = S.stack.findIndex((s) => s.uid === el.dataset.uid); moveTo(el.dataset.uid, i + +el.dataset.d); },
  preset: (el) => loadPreset(el.dataset.id),
  empty: () => startEmpty(),
  undo: () => undo(),
  reset: (el) => { const s = S.stack.find((x) => x.uid === el.dataset.uid); if (!s) return; snapshot(); s.params = { ...defaults(s.id), ...(s.id === 'custom' ? { prompt: s.params.prompt } : {}) }; changed(); },
  parentParams: (el) => { const s = S.stack.find((x) => x.uid === el.dataset.uid); const p = S.parent?.stack.find((x) => x.id === s?.id); if (!s || !p) return; snapshot(); s.params = { ...p.params }; changed(); },
  draft: (el) => draftScript(el.dataset.uid),
  write: (el) => { const s = S.stack.find((x) => x.uid === el.dataset.uid); if (!s) return; s.draft = { source: STARTER, prompt: (s.params.prompt ?? '').trim(), compile: null, check: null }; changed(); checkHs(s); $('editor').querySelector('textarea[data-hse]')?.focus(); },
  example: (el) => { const s = selSlot(); if (!s) return; s.params.prompt = el.dataset.text; renderEditor(); changed({ editor: false }); draftScript(s.uid); },
  leaveRemix: () => { snapshot(); S.parent = null; S.stack = []; S.sel = null; history.replaceState(null, '', location.pathname); changed(); toast('Starting from an empty rack.'); },
  sim: () => runSim(false),
  crowd: () => runSim(true),
  toSim: () => { $('simulate').scrollIntoView({ behavior: 'smooth' }); },
  toLaunch: () => { $('launch').scrollIntoView({ behavior: 'smooth' }); },
  toPal: () => { const b = $('pal').querySelector('.pb:not(.in) .pb-main'); b?.focus(); $('pal').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); $('pal').classList.add('flash'); setTimeout(() => $('pal').classList.remove('flash'), 900); },
  toRack: () => { $('stack').scrollIntoView({ behavior: 'smooth' }); },
  selWarn: (el) => { const s = S.stack.find((x) => x.id === el.dataset.id); if (s) { S.sel = s.uid; changed(); $('editor').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !app.contains(el) || el.disabled) return;
  const f = ACT[el.dataset.act];
  if (f) { e.preventDefault(); f(el, e); }
});

// params: sliders, selects, the custom prompt — patch in place so a dragged slider keeps focus
app.addEventListener('input', (e) => {
  const el = e.target;
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

// the Hookscript editor: compile as you type, then fuzz + honeypot (the budget and the launch gate follow)
wireHs(app, {
  get: (u) => S.stack.find((x) => x.uid === u)?.draft ?? null,
  onChange: (_u, _st, info) => { if (info.checked) changed({ editor: false }); else { const c = ctx(); paint($('bud'), budgetHTML(S, c)); paint($('rack'), rackHTML(S, c)); launch.stackChanged(); save(); } },
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
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.target.closest('input, textarea, select')) { undo(); e.preventDefault(); }
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
  const preset = q('preset'), addId = q('add');
  if (draft?.meta) S.launch.meta = { ...S.launch.meta, ...draft.meta };
  if (draft?.fam) S.fam = draft.fam;
  if (draft?.seed) S.sim.seed = draft.seed;
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
  } else if (preset && PRESETS.some((p) => p.id === preset)) {
    const p = PRESETS.find((x) => x.id === preset);
    loadStack(p.slots.map(([id, prm]) => ({ id, params: prm }))); S.hist = [];
  } else {
    restore();
    if (draft?.parent) { const c = await api.coin(draft.parent).catch(() => null); if (c) S.parent = parentFrom(c); }
  }
  if (addId && byId[addId]) {
    const have = S.stack.find((s) => s.id === addId);
    if (have) S.sel = have.uid;
    else if (S.stack.length < ENGINE.maxSlots) { const s = slotOf(addId); S.stack.push(s); S.sel = s.uid; }
    else toast(`The rack is full, so ${byId[addId].name} was not added. Remove a block first.`);
    S.fam = byId[addId].family;
  }
  if (S.sel) S.fam = byId[selSlot()?.id]?.family ?? S.fam;
  // ?preset and ?add are one-shot; the draft carries the work from here
  if (params.has('preset') || params.has('add')) { params.delete('preset'); params.delete('add'); history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash); }

  renderAll();
  for (const s of S.stack) checkHs(s); // a restored Hookscript is compiled and checked again
  save();
  if (location.hash) {
    const t = document.getElementById(location.hash.slice(1));
    if (t) requestAnimationFrame(() => t.scrollIntoView({ block: 'start' }));
  }
}

window.addEventListener('hashchange', () => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }));
boot();

