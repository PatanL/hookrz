// The Hookscript editor (build page Custom block + the block drawer): an editable script that compiles as you type
// (line/column errors, size, ops, worst-case CU), then a 10,000-trade fuzz and the honeypot check, which a script must
// pass before it can launch. The tester runs buys, sells and sends through the reference interpreter, keeping the
// script's state (globals, wallet vars) between transfers, exactly as the engine would.
import './hs-editor.css';
import { api } from '../api/client.js';
import { esc } from '../core/format.js';
export { EXAMPLES } from '../hookscript/examples.js';

const n = (x) => Number(x ?? 0).toLocaleString('en-US');
const LIM = { bytes: 1024, cu: 8000 };
export const STARTER = `rule "My rule"

on sell:
  refuse if wallet.held < 1h and amount > wallet.balance * 50%
    because "New holders sell at most half their bag in their first hour"
`;


/** A script's plain description: the comment lines right under its `rule "…"` line, without a leading "$TICKER." tag. */
export function aboutOf(source) {
  const lines = String(source ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*rule\s+"/.test(l));
  const out = [];
  for (const l of lines.slice(at + 1)) { const m = l.match(/^\s*#\s?(.*)$/); if (!m) break; out.push(m[1].trim()); }
  return out.join(' ').replace(/^\$[A-Z0-9]+\.\s*/, '').trim();
}
/** The rule's title from its `rule "…"` line. */
export const titleOf = (source) => String(source ?? '').match(/^\s*rule\s+"([^"]*)"/m)?.[1] ?? '';

/**
 * A ready-made idea (hookscript/examples/<name>.hs, bundled into src/vendor/hookscript.js) as editor state: the exact
 * script, titled by its own rule line and described by its comments. Compile, fuzz and the honeypot check still run
 * (refresh) before it can launch. Resolves null for an unknown name.
 */
export async function ideaState(name) {
  const { load } = await import('../hookscript/hs.js');
  const src = (await load()).EXAMPLES?.[name];
  if (!src) return null;
  return { source: src, prompt: titleOf(src), about: aboutOf(src), idea: name, provider: null, template: null, draftWarnings: [], compile: null, check: null };
}

/** Editor state from a drafter result (client.js draftHookscript). */
export function stateFromDraft(d, prompt) {
  const compiled = !!d.bytecodeHex;
  return {
    source: d.script ?? '', prompt: prompt ?? d.prompt ?? '', provider: d.provider ?? null, model: d.model ?? null, template: d.template ?? null,
    draftWarnings: (d.warnings ?? []).filter((w) => !/ANTHROPIC_API_KEY/.test(w)),
    compile: compiled ? { ok: true, size: d.bytes, ops: d.ops, cu: d.cu, hex: d.bytecodeHex, abi: d.abi, warnings: [] } : (d.errors?.length ? { ok: false, errors: d.errors, warnings: [] } : null),
    check: d.fuzz && compiled ? { ...d.fuzz, honeypot: d.honeypot, source: d.script, ms: d.ms ?? null } : null,
  };
}
/** A state saved by an older version of the page (canned numbers): keep the script, re-check it. */
export function upgradeState(st) {
  if (!st) return null;
  if ('source' in st) return st;
  return { source: st.script ?? '', prompt: st.prompt ?? '', provider: null, template: null, draftWarnings: [], compile: null, check: null };
}
const fresh = (st) => !!st?.check && st.check.source === st.source;

/** Why this script can't launch yet (null = it can). */
export function launchProblem(st) {
  if (!st || !st.source?.trim()) return { level: 'error', text: 'Custom Block: draft or write its Hookscript before you launch.' };
  if (st.compile && !st.compile.ok) { const e = st.compile.errors[0]; return { level: 'error', text: `Custom Block: the Hookscript doesn't compile (line ${e.line}, col ${e.col}: ${e.message}).` }; }
  if (!st.compile || !fresh(st)) return { level: 'need', text: 'Custom Block: the Hookscript is being fuzzed and honeypot-checked.' };
  if (st.check.panics || st.check.errors) return { level: 'error', text: `Custom Block: the VM reported ${st.check.errors} errors in ${n(st.check.trades)} fuzzed trades.` };
  if (!st.check.honeypot?.ok) return { level: 'error', text: 'Custom Block: the honeypot check failed. Some holders could never sell. Add a time-based way out.' };
  return null;
}

// ───────── markup ─────────
export function editorHTML(st, key, { rows = 9, label = 'Hookscript' } = {}) {
  const lines = Math.max(rows, Math.min(22, (st.source.match(/\n/g)?.length ?? 0) + 2));
  return `<div class="hse" data-hse-box="${esc(key)}">
    <div class="hse-top"><span class="pixel">${esc(label)}</span>${st.provider ? `<span class="hse-by">${st.provider === 'anthropic' ? `drafted by Claude` : st.provider === 'local' ? `drafted by the hookrz model` : `drafted offline${st.template ? ` · ${esc(st.template)} template` : ''}`}</span>` : ''}<span class="chip warnc" title="No hookrz reviewer has signed off on this Hookscript yet">Unreviewed</span></div>
    <textarea class="hse-src" data-hse="${esc(key)}" rows="${lines}" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Hookscript source">${esc(st.source)}</textarea>
    <div class="hse-meta" data-hse-meta>${metaHTML(st)}</div>
    <div class="hse-diag" data-hse-diag aria-live="polite">${diagHTML(st)}</div>
    <div class="hse-check" data-hse-check aria-live="polite">${checkHTML(st)}</div>
  </div>`;
}

const meter = (v, max, label, fmt) => `<div class="hse-m"><div class="hse-mt"><span>${label}</span><b class="mono">${fmt(v)}<small> / ${fmt(max)}</small></b></div><div class="hse-bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div></div>`;
export function metaHTML(st) {
  const c = st.compile;
  if (!c) return `<span class="hse-wait"><span class="spin" aria-hidden="true"></span>Compiling…</span>`;
  if (!c.ok) return `<span class="hse-bad">Doesn't compile</span>`;
  return `${meter(c.size, LIM.bytes, 'Bytecode', (x) => `${n(x)} B`)}${meter(c.cu, LIM.cu, 'Worst case', (x) => `${n(x)} CU`)}<div class="hse-m small"><span>Ops</span><b class="mono">${n(c.ops)}</b></div>`;
}
export function diagHTML(st) {
  const c = st.compile;
  const warn = [...(c?.warnings ?? []).map((w) => w.message ?? w), ...(st.draftWarnings ?? [])];
  const errs = c && !c.ok ? c.errors : [];
  return `${errs.length ? `<ul class="hse-errs">${errs.map((e) => `<li><b class="mono">Line ${e.line}, col ${e.col}</b><span>${esc(e.message)}${e.hint ? ` <em>${esc(e.hint)}</em>` : ''}</span></li>`).join('')}</ul>` : ''}
    ${warn.length ? `<ul class="hse-warns">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
}
export function checkHTML(st) {
  const c = st.compile;
  if (!c || !c.ok) return '';
  if (!fresh(st)) return `<div class="hse-wait"><span class="spin" aria-hidden="true"></span>Fuzzing ${n(10000)} generated trades and checking that every holder can still sell…</div>`;
  const k = st.check, hp = k.honeypot ?? {};
  const reasons = Object.entries(k.byReason ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const exit = hp.maxExitHours > 0.01 ? `the longest wait was ${hp.maxExitHours < 1 ? `${Math.max(1, Math.round(hp.maxExitHours * 60))}m` : hp.maxExitHours < 48 ? `${+hp.maxExitHours.toFixed(1)}h` : `${+(hp.maxExitHours / 24).toFixed(1)}d`}` : 'nobody had to wait';
  return `<div class="hse-fuzz">
      <div><span>Fuzzed</span><b class="mono">${n(k.trades)}</b><small>trades${k.launches ? ` · ${n(k.launches)} launches` : ''}</small></div>
      <div><span>Blocked</span><b class="mono">${(+k.refusedPct).toFixed(1)}%</b></div>
      <div><span>Panics · errors</span><b class="mono ${k.panics || k.errors ? 'bad' : 'good'}">${n(k.panics)} · ${n(k.errors)}</b></div>
      <div><span>CU seen</span><b class="mono">${n(k.avgCu)}</b><small>avg · ${n(k.maxCu)} max</small></div>
    </div>
    ${reasons.length ? `<p class="hse-reasons"><span class="dim">Most refusals:</span> ${reasons.map(([r, x]) => `“${esc(r.replace(/\{\}/g, '…'))}” <span class="mono dim">${n(x)}×</span>`).join(' · ')}</p>` : ''}
    ${hp.ok ? `<div class="hse-hp ok"><b>Honeypot check passed</b><span>In every generated launch, each holder checked (${n(hp.checkedWallets)}) could sell down below 1% of their bag with nobody else trading; ${exit}. A bank run, everyone exiting in turn, got through too.</span></div>`
      : `<div class="hse-hp bad" role="alert"><b>Honeypot check failed: this script can't launch</b><span>Some holders could never sell. Add a time-based way out, so every holder can exit even when nobody else trades.</span>
        <ul>${[...(hp.notes ?? []), ...(hp.locked ?? []).slice(0, 2).map((l) => `Holder ${l.wallet} (${l.type}) still had ${n(l.leftTokens)} of ${n(l.startTokens)} tokens after ${n(l.tries)} sell attempts over 60 days: “${l.lastMessage}”`)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`}`;
}
/** Re-render the live regions of the editor for `key` (wherever it is on the page right now). */
export function patch(key, st) {
  const root = document.querySelector(`[data-hse-box="${CSS.escape(key)}"]`);
  if (!root) return;
  const set = (sel, html) => { const el = root.querySelector(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
  set('[data-hse-meta]', metaHTML(st));
  set('[data-hse-diag]', diagHTML(st));
  set('[data-hse-check]', checkHTML(st));
}

// ───────── behaviour ─────────
/**
 * Compile now, then (debounced) fuzz + honeypot in the worker. onChange(st, { checked }) runs after each compile and
 * after each finished check. Safe to call again: results for an older source are dropped.
 */
export function refresh(key, st, onChange = () => {}, { delay = 0 } = {}) {
  const src = st.source;
  return api.compileHookscript(src).then((c) => {
    if (st.source !== src) return;
    st.compile = c;
    patch(key, st);
    onChange(st, { checked: false });
    clearTimeout(st._t);
    if (!c.ok || fresh(st)) return;
    st._t = setTimeout(() => {
      if (st.source !== src) return;
      api.checkHookscript(src).then((r) => {
        if (st.source !== src) return;
        st.compile = r.compile;
        st.check = r.check ? { ...r.check, source: src } : null;
        patch(key, st);
        onChange(st, { checked: true });
      }).catch((e) => { const d = document.querySelector(`[data-hse-box="${CSS.escape(key)}"] [data-hse-check]`); if (d) d.innerHTML = `<p class="hse-bad hse-pad">${esc(e.message)}</p>`; });
    }, delay);
  });
}

/** One delegated listener for every editor under `root`: get(key) → state; onChange(key, st, info). */
export function wire(root, { get, onChange }) {
  root.addEventListener('input', (e) => {
    const ta = e.target.closest?.('textarea[data-hse]');
    if (!ta) return;
    const key = ta.dataset.hse, st = get(key);
    if (!st) return;
    st.source = ta.value;
    refresh(key, st, (s, info) => onChange(key, s, info), { delay: 650 });
  });
  root.addEventListener('keydown', (e) => {
    const ta = e.target.closest?.('textarea[data-hse]');
    if (!ta || e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault(); // two spaces, like the examples
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Whether this state still needs a compile or a check. */
export const needsCheck = (st) => !!st && (!st.compile || (st.compile.ok && !fresh(st)));

// ───────── tester: transfers through the reference interpreter, state kept between them ─────────
const NAMES = ['Creator', 'Wallet A', 'Wallet B', 'Wallet C'];
const STEPS = [[60, '+1m'], [600, '+10m'], [3600, '+1h'], [6 * 3600, '+6h'], [86400, '+1d']];
const dur = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : s < 86400 ? `${+(s / 3600).toFixed(1)}h` : `${+(s / 86400).toFixed(1)}d`);
const tok = (raw) => { const v = Number(raw) / 1e6; return v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${+v.toFixed(2)}`; };

export function testerHTML() {
  return `<div class="hst">
    <div class="hst-grid">
      <label class="hst-f"><span>Who</span><select data-t="who">${NAMES.map((x, i) => `<option value="${i}">${x}</option>`).join('')}</select></label>
      <div class="hst-f"><span>Transfer</span><div class="hst-seg" role="radiogroup" aria-label="Transfer kind">${['buy', 'sell', 'send'].map((k) => `<button type="button" role="radio" data-tk="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
      <label class="hst-f" data-show="buy"><span>Pay</span><select data-t="sol">${[0.05, 0.1, 0.25, 0.5, 1, 2, 5].map((v) => `<option value="${v}"${v === 0.5 ? ' selected' : ''}>${v} SOL</option>`).join('')}</select></label>
      <label class="hst-f" data-show="sell send"><span>Amount</span><select data-t="frac">${[[0.1, '10%'], [0.25, '25%'], [0.5, '50%'], [1, 'All']].map(([v, l]) => `<option value="${v}"${v === 0.5 ? ' selected' : ''}>${l} of the bag</option>`).join('')}</select></label>
      <label class="hst-f" data-show="send"><span>To</span><select data-t="to">${NAMES.map((x, i) => `<option value="${i}"${i === 2 ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <div class="hst-clock"><span class="dim">Since launch</span><b class="mono" data-o="t">0s</b>${STEPS.map(([s, l]) => `<button type="button" class="hs-chip" data-step="${s}">${l}</button>`).join('')}</div>
    <div class="hst-go"><button type="button" class="btn btn-chrome btn-sm" data-t="run">Run transfer</button><button type="button" class="btn btn-ghost btn-sm" data-t="reset">Reset</button></div>
    <div class="hst-verdict" data-o="v" aria-live="polite"><p class="dim">Buy, sell or send as any wallet. The script's state carries over from one transfer to the next.</p></div>
    <div class="hst-state" data-o="state"></div>
    <ol class="hst-log" data-o="log"></ol>
  </div>`;
}

/** getSource() → current script; it must compile for transfers to run. */
export async function mountTester(el, getSource) {
  const { load } = await import('../hookscript/hs.js');
  const hs = await load();
  const T0 = 1_791_216_000n; // a fixed launch time: Monday 2026-10-05, 16:00 UTC (noon in New York)
  let w, t, log, src = null, code = null, abi = null;
  const K = { kind: 'buy' };
  const reset = () => { w = new hs.World(T0); for (let i = 0; i < NAMES.length; i++) w.wallet(i, i ? 'holder' : 'creator'); t = 0; log = []; render(); };
  const sync = () => {
    const s = getSource();
    if (s === src) return !!code;
    src = s;
    const c = hs.compile(s);
    code = c.ok ? c.bytes : null; abi = c.ok ? c.abi : null;
    reset();
    return !!code;
  };
  const who = (key) => { const i = w.wallets.findIndex((x) => x.key.every((b, j) => b === key[j])); if (i >= 0) return NAMES[i]; if (key.every((b) => b === 0)) return 'none'; const b = hs.encodeBase58(key); return `${b.slice(0, 4)}…${b.slice(-4)}`; };
  const val = (bytes, f) => {
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (f.type === 'key') return who(bytes.subarray(f.offset, f.offset + 32));
    if (f.type === 'num') return (Number(d.getBigInt64(f.offset, true)) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (f.type === 'int') return `${d.getInt32(f.offset, true)}`;
    if (f.type === 'bool') return bytes[f.offset] ? 'true' : 'false';
    if (f.type === 'time') { const v = d.getUint32(f.offset, true); return v ? `launch +${dur(v - 1)}` : 'unset'; }
    return '';
  };
  function render() {
    el.querySelector('[data-o="t"]').textContent = dur(t);
    el.querySelectorAll('[data-tk]').forEach((b) => { b.classList.toggle('on', b.dataset.tk === K.kind); b.setAttribute('aria-checked', String(b.dataset.tk === K.kind)); });
    el.querySelectorAll('[data-show]').forEach((x) => { x.hidden = !x.dataset.show.split(' ').includes(K.kind); });
    const g = abi?.globals ?? [], wv = abi?.wallet ?? [];
    el.querySelector('[data-o="state"]').innerHTML = !w ? '' : `<div class="hst-wallets">${w.wallets.slice(0, NAMES.length).map((x, i) => `<div><span>${NAMES[i]}</span><b class="mono">${tok(x.balance)}</b>${wv.length ? `<small>${wv.map((f) => `${esc(f.name)} ${esc(val(x.vars, f))}`).join(' · ')}</small>` : ''}</div>`).join('')}</div>
      ${g.length ? `<p class="hst-globals"><span class="dim">Coin state</span> ${g.map((f) => `<span class="mono">${esc(f.name)}</span> = <b>${esc(val(w.globals, f))}</b>`).join(' · ')}</p>` : ''}`;
    el.querySelector('[data-o="log"]').innerHTML = log.slice(0, 6).map((x) => `<li class="${x.ok ? 'ok' : 'no'}"><span class="mono dim">+${dur(x.t)}</span><span>${esc(x.what)}</span><b>${x.ok ? 'Goes through' : 'Blocked'}</b>${x.ok ? '' : `<span class="mono dim" title="error code">${x.code}</span>`}</li>`).join('');
  }
  function run() {
    const v = el.querySelector('[data-o="v"]');
    if (!sync()) { v.className = 'hst-verdict no'; v.innerHTML = '<p>Fix the compile errors above to test transfers.</p>'; return; }
    const from = +el.querySelector('[data-t="who"]').value, to = +el.querySelector('[data-t="to"]').value;
    const me = w.wallet(from);
    const frac = +el.querySelector('[data-t="frac"]').value, sol = +el.querySelector('[data-t="sol"]').value;
    const tokens = BigInt(Math.floor(Number(me.balance) * frac));
    const now = T0 + BigInt(t);
    let what;
    let o = null;
    if (K.kind === 'buy') { what = `${NAMES[from]} buys for ${sol} SOL`; o = hs.attempt(w, code, { kind: 'buy', from, sol }, now); }
    else if (tokens <= 0n) { v.className = 'hst-verdict no'; v.innerHTML = `<p>${NAMES[from]} holds no tokens yet. Buy first.</p>`; return; }
    else if (K.kind === 'sell') { what = `${NAMES[from]} sells ${tok(tokens)}`; o = hs.attempt(w, code, { kind: 'sell', from, tokens }, now); }
    else { if (to === from) { v.className = 'hst-verdict no'; v.innerHTML = '<p>Pick a different receiver.</p>'; return; } what = `${NAMES[from]} sends ${tok(tokens)} to ${NAMES[to]}`; o = hs.attempt(w, code, { kind: 'send', from, to, tokens }, now); }
    if (!o) { v.className = 'hst-verdict no'; v.innerHTML = '<p>The curve has no more tokens to sell.</p>'; return; }
    const r = o.result;
    if (r.error) { v.className = 'hst-verdict no'; v.innerHTML = `<b class="hst-vt">Fault</b><p>The VM stopped with ${esc(r.error)}. The engine refuses the transfer (6128).</p>`; log.unshift({ t, what, ok: false, code: 6128 }); }
    else if (r.verdict.allow) { v.className = 'hst-verdict ok'; v.innerHTML = `<b class="hst-vt">Goes through</b><p>${esc(what)}${K.kind === 'buy' ? `: ${tok(o.ctx.amount)} tokens` : ''}. The script allowed it and kept its state changes. <span class="mono dim">${n(r.gas)} CU</span></p>`; log.unshift({ t, what, ok: true }); }
    else { const msg = hs.formatReason(code, r.verdict.reasonId, r.verdict.arg); v.className = 'hst-verdict no'; v.innerHTML = `<b class="hst-vt">Blocked <span class="mono dim" title="error code">6128</span></b><p class="msg">${esc(msg)}</p><p class="dim">${esc(what)}. Nothing changed. <span class="mono">${n(r.gas)} CU</span></p>`; log.unshift({ t, what, ok: false, code: 6128 }); }
    t += 1;
    render();
  }
  el.querySelectorAll('[data-tk]').forEach((b) => b.addEventListener('click', () => { K.kind = b.dataset.tk; render(); }));
  el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { t += +b.dataset.step; render(); }));
  el.querySelector('[data-t="run"]').addEventListener('click', run);
  el.querySelector('[data-t="reset"]').addEventListener('click', () => { src = null; sync(); el.querySelector('[data-o="v"]').innerHTML = '<p class="dim">Fresh launch: every wallet empty, the script\'s state cleared.</p>'; el.querySelector('[data-o="v"]').className = 'hst-verdict'; });
  sync();
  render();
  return { sourceChanged: () => { if (getSource() !== src) { sync(); } } };
}
