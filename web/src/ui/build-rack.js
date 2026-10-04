// Build page: header + presets, remix bar, block palette, the rack, and the selected block's editor.
// Pure render functions (state in → HTML out); build.js owns the state and the events.
import { FAMILIES, ENFORCERS, ENGINE, BLOCKS, PRESETS, byId, familyOf, hex } from '../data/blocks.js';
import { cube, ICON } from './icons.js';
import { voxelSVG, asset } from './voxel.js';
import { avatar } from './avatar.js';
import { esc } from '../core/format.js';

const pad2 = (i) => String(i).padStart(2, '0');
const CHEV = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>';
const PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>';

export const stepOf = (p) => (String(p.step).split('.')[1] ?? '').length;

export function enfBadges(b) {
  return [b.enforcedBy, b.also].filter(Boolean)
    .map((k) => `<span class="enf ${k}" title="${esc(ENFORCERS[k].long)}"><i></i>${ENFORCERS[k].name}</span>`).join('');
}
export const STATE_TEXT = { none: 'Stateless', global: 'Global, in the Stack slot', wallet: 'Per wallet, in a Wallet record' };
export const ROUTE_TEXT = { any: 'Every route', record: 'hookrz router + aggregators once a wallet record exists' };
export const blockImg = (family, big = false) => asset(`img/brand/block-${family}${big ? '' : '-sm'}.webp`);

/** Stack params → the one-line summary the rack shows. */
export const summaryOf = (s) => { try { return byId[s.id].summary(s.params); } catch { return ''; } };

// ───────────────────────── header + presets ─────────────────────────
export function headHTML(S) {
  const ids = S.stack.map((s) => s.id).join(',');
  const active = PRESETS.find((p) => p.slots.map((x) => x[0]).join(',') === ids)?.id;
  return `
  <div class="b-title">
    <span class="eyebrow">Build a coin</span>
    <h1><span class="chrome-text">Snap the rules in.</span></h1>
    <p class="lede">Up to six blocks in one stack. A single audited program, <span class="mono">hookrz_engine</span>, runs the whole stack on every transfer and refuses what your rules refuse.</p>
  </div>
  <div class="presets" id="presets">
    <div class="presets-head"><span class="pixel">Presets</span><span class="dim">Start from a proven stack, then tune it.</span></div>
    <div class="presets-row" role="list">
      ${PRESETS.map((p) => `<button class="preset${active === p.id ? ' on' : ''}" role="listitem" data-act="preset" data-id="${p.id}" data-fk="preset-${p.id}" aria-pressed="${active === p.id}">
        <span class="preset-cubes">${p.slots.map(([id]) => cube(byId[id].family, { size: 18 })).join('')}</span>
        <b>${p.name}</b><span class="preset-blurb">${p.blurb}</span>
        <span class="preset-n mono">${p.slots.length} blocks${active === p.id ? ' · loaded' : ''}</span>
      </button>`).join('')}
      <button class="preset empty" role="listitem" data-act="empty" data-fk="preset-empty"${!S.stack.length && !S.parent ? ' aria-pressed="true"' : ''}>
        <span class="preset-cubes">${Array.from({ length: 3 }, () => cube('x', { size: 18, state: 'empty' })).join('')}</span>
        <b>Start empty</b><span class="preset-blurb">Six open slots. Pick every block yourself.</span>
        <span class="preset-n mono">0 blocks</span>
      </button>
    </div>
  </div>`;
}

// ───────────────────────── remix bar ─────────────────────────
export function remixBarHTML(S, c) {
  if (!S.parent) return '';
  const P = S.parent, d = c.diff;
  const chips = [
    ...d.added.map((id) => `<span class="dchip add">+ ${byId[id].name}</span>`),
    ...d.removed.map((id) => `<span class="dchip rm">− ${byId[id].name}</span>`),
    ...d.tuned.map((id) => `<span class="dchip tune">~ ${byId[id].name}</span>`),
  ];
  const parentIds = P.stack.map((s) => s.id).join(','), mine = S.stack.map((s) => s.id).join(',');
  const reordered = !chips.length && parentIds !== mine;
  return `<div class="remix-bar">
    <div class="rb-who">
      ${avatar(P.coin ?? { ticker: P.ticker }, 42)}
      <div class="rb-txt">
        <div class="rb-line"><span class="rb-ico" aria-hidden="true">${ICON.remix}</span>Remixing <a href="coin.html?t=${esc(P.ticker)}">$${esc(P.ticker)}</a> by <b>@${esc(P.handle)}</b> — they earn the 10% stack royalty</div>
        <div class="rb-sub dim">The royalty is 10% of the 1% trade fee on your coin, paid to the parent stack's author, one level up only. Your coin's lineage links back to $${esc(P.ticker)}.</div>
      </div>
    </div>
    <div class="rb-diff" aria-live="polite">
      <span class="pixel dim">Changes vs $${esc(P.ticker)}</span>
      <div class="rb-chips">${chips.length ? chips.join('') : reordered ? '<span class="dchip tune">Slot order changed</span>' : '<span class="dim">Same stack so far. Add, remove or tune a block to make it yours.</span>'}${chips.length && parentIds !== mine && !d.added.length && !d.removed.length ? '<span class="dchip tune">Slot order changed</span>' : ''}</div>
    </div>
    <button class="btn btn-ghost btn-sm rb-leave" data-act="leaveRemix">Start from scratch</button>
  </div>`;
}

// ───────────────────────── palette ─────────────────────────
export function paletteHTML(S) {
  const fam = familyOf(S.fam) ?? FAMILIES[0];
  const blocks = BLOCKS.filter((b) => b.family === fam.id);
  return `
  <div class="pal-head"><span class="eyebrow">Blocks</span><span class="mono dim">${BLOCKS.length} blocks · ${FAMILIES.length} families</span></div>
  <div class="pal-tabs" role="tablist" aria-label="Block families">
    ${FAMILIES.map((f) => {
      const on = f.id === fam.id, inStack = S.stack.filter((s) => byId[s.id].family === f.id).length;
      return `<button role="tab" id="tab-${f.id}" aria-selected="${on}" aria-controls="pal-list" tabindex="${on ? 0 : -1}" data-act="fam" data-fam="${f.id}" data-fk="tab-${f.id}">
        ${cube(f.id, { size: 22, state: on ? 'lit' : '' })}<span class="t-name">${f.name}</span>${inStack ? `<span class="t-in mono" title="${inStack} in your stack">${inStack}</span>` : ''}</button>`;
    }).join('')}
  </div>
  <div class="pal-fam"><b>${fam.verb}.</b> ${fam.blurb}</div>
  <div class="pal-list" id="pal-list" role="tabpanel" aria-labelledby="tab-${fam.id}">
    ${blocks.map((b) => {
      const at = S.stack.findIndex((s) => s.id === b.id);
      const full = at < 0 && S.stack.length >= ENGINE.maxSlots;
      return `<div class="pb${at >= 0 ? ' in' : ''}${full ? ' full' : ''}" draggable="${at < 0}" data-drag-block="${b.id}">
        <button class="pb-main" data-act="${at >= 0 ? 'sel' : 'add'}" data-id="${b.id}" data-uid="${at >= 0 ? S.stack[at].uid : ''}" data-fk="pb-${b.id}"
          aria-label="${at >= 0 ? `${b.name}: in slot ${at + 1}. Select it.` : `Add ${b.name} to the stack.`} ${esc(b.tagline)}">
          ${cube(b.family, { size: 40 })}
          <span class="pb-txt">
            <span class="pb-name">${b.name}${b.unreviewed ? ' <span class="chip warnc">Unreviewed</span>' : ''}${b.risk ? ' <span class="chip refuse">Risk</span>' : ''}</span>
            <span class="pb-tag">${esc(b.tagline)}</span>
            <span class="pb-meta">${enfBadges(b)}${b.cu ? `<span class="mono">${(b.cu / 1000).toFixed(1)}K CU</span>` : ''}${b.route === 'record' ? '<span class="mono">record</span>' : ''}</span>
          </span>
          <span class="pb-add" aria-hidden="true">${at >= 0 ? `<span class="pixel">Slot ${at + 1}</span>` : PLUS}</span>
        </button>
      </div>`;
    }).join('')}
  </div>
  <p class="pal-hint">Click a block or drag it onto a slot. Drag a slot back here to take it out.</p>`;
}

// ───────────────────────── rack ─────────────────────────
export function rackHTML(S, c) {
  const n = S.stack.length;
  const diff = c.diff;
  const bays = Array.from({ length: ENGINE.maxSlots }, (_, i) => {
    const s = S.stack[i];
    if (!s) {
      const next = i === n;
      return `<li class="bay empty${next ? ' next' : ''}" data-bay="${i}">
        <span class="bay-num pixel">${pad2(i + 1)}</span>
        ${next ? `<button class="bay-main" data-act="toPal" data-fk="bay-next" aria-label="Slot ${i + 1} is empty. Pick a block from the palette.">` : '<span class="bay-main">'}
          <span class="bay-cell"><span class="bay-plus">${PLUS}</span></span>
          <span class="bay-info"><span class="bay-name">Empty slot</span><span class="bay-sum mono">${next ? (n ? 'Drop a block here' : 'Add your first block') : 'Open'}</span></span>
        ${next ? '</button>' : '</span>'}
      </li>`;
    }
    const b = byId[s.id], sel = s.uid === S.sel, sum = summaryOf(s);
    const tag = diff ? (diff.added.includes(s.id) ? '<span class="bay-tag add">New</span>' : diff.tuned.includes(s.id) ? '<span class="bay-tag tune">Tuned</span>' : '') : '';
    return `<li class="bay filled f-${b.family}${sel ? ' sel' : ''}" data-bay="${i}" data-drag-slot="${s.uid}" draggable="true">
      <span class="bay-num pixel">${pad2(i + 1)}</span>
      <button class="bay-main" data-act="sel" data-uid="${s.uid}" data-fk="bay-${s.uid}" aria-pressed="${sel}"
        aria-label="Slot ${i + 1}: ${esc(b.name)}, ${esc(sum)}. Enforced by ${ENFORCERS[b.enforcedBy].name}.${sel ? ' Selected.' : ' Select to tune.'}">
        <span class="bay-cell"><img class="bay-cube" src="${blockImg(b.family)}" alt="" draggable="false" width="240" height="240"></span>
        <span class="bay-info">
          <span class="bay-name">${b.name}</span>
          <span class="bay-sum mono">${esc(sum)}</span>
          <span class="bay-enf">${enfBadges(b)}</span>
        </span>
      </button>
      ${tag}
      <span class="bay-ctl">
        <button class="bay-btn" data-act="mv" data-uid="${s.uid}" data-d="-1" data-fk="mvl-${s.uid}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(b.name)} to slot ${i}">${CHEV}</button>
        <button class="bay-btn fwd" data-act="mv" data-uid="${s.uid}" data-d="1" data-fk="mvr-${s.uid}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${esc(b.name)} to slot ${i + 2}">${CHEV}</button>
        <button class="bay-btn rm" data-act="rm" data-uid="${s.uid}" data-fk="rm-${s.uid}" aria-label="Remove ${esc(b.name)}">${ICON.stop}</button>
      </span>
    </li>`;
  }).join('');
  return `
  <div class="rack-top">
    <div class="rack-label">${voxelSVG('STACK', { cell: 3, gap: 0.5, depth: 0.34, glow: false })}<span class="rack-count mono"><b>${n}</b>/${ENGINE.maxSlots} slots</span></div>
    <div class="rack-tools">
      <button class="btn btn-ghost btn-sm" data-act="undo" data-fk="undo" ${S.hist.length ? '' : 'disabled'} title="Undo (Ctrl+Z)">Undo</button>
      <button class="btn btn-ghost btn-sm" data-act="empty" data-fk="clear" ${n || S.parent ? '' : 'disabled'}>Clear</button>
    </div>
  </div>
  <div class="rack${n ? '' : ' is-empty'}">
    <span class="rack-plug in" aria-hidden="true"></span><span class="rack-plug out" aria-hidden="true"></span>
    <ol class="bays" aria-label="Stack slots, in the order the engine runs them">${bays}</ol>
    <span class="cable" aria-hidden="true"><i></i></span>
  </div>
  <p class="rack-note"><b>Slot order is run order.</b> On every transfer the engine runs the blocks from slot 01 to ${pad2(ENGINE.maxSlots)} and stops at the first refusal; that block's error code is what the trader's wallet shows. Put the refusals that fire most often first.<span class="sr"> With a slot focused, arrow keys move between slots, Shift and an arrow key reorders, Delete removes.</span></p>`;
}

// ───────────────────────── editor ─────────────────────────
const EXAMPLES = [
  'Wallets can\'t sell more than they bought in the last hour',
  'No buys after a 30% pump in 10 minutes',
  'The curve is closed on weekends',
];

export function editorHTML(S, c) {
  const i = S.stack.findIndex((s) => s.uid === S.sel);
  const s = S.stack[i];
  if (!s) {
    return `<div class="ed-empty">
      <div class="ed-empty-cubes">${cube('x', { size: 34, state: 'empty' })}${cube('x', { size: 34, state: 'empty' })}${cube('x', { size: 34, state: 'empty' })}</div>
      <div><h3>${S.stack.length ? 'Select a slot to tune it' : 'Your rack is empty'}</h3>
      <p class="muted">${S.stack.length ? 'Every block\'s parameters, error code, compute cost and enforcer show here.' : 'Load a preset above or add blocks from the palette. Each block you add opens here, ready to tune.'}</p></div>
    </div>`;
  }
  const b = byId[s.id], f = familyOf(b.family);
  const parent = S.parent?.stack.find((x) => x.id === s.id);
  const tunedVsParent = parent && JSON.stringify(parent.params) !== JSON.stringify(s.params);
  const isCustom = b.id === 'custom';
  const params = b.params.filter((p) => !p.text).map((p) => paramHTML(s, p, parent)).join('');
  return `
  <div class="ed-head">
    <span class="ed-cube"><img src="${blockImg(b.family)}" alt="" width="240" height="240"></span>
    <div class="ed-title">
      <div class="ed-kicker pixel">${f.name} · Slot ${pad2(i + 1)}${parent ? ` · <span class="${tunedVsParent ? 'ice' : ''}">${tunedVsParent ? `tuned vs $${esc(S.parent.ticker)}` : `same as $${esc(S.parent.ticker)}`}</span>` : S.parent ? ` · <span class="ice">new vs $${esc(S.parent.ticker)}</span>` : ''}</div>
      <h3>${b.name}</h3>
      <p class="muted">${esc(b.tagline)}</p>
    </div>
    <div class="ed-tools">
      ${tunedVsParent ? `<button class="btn btn-ghost btn-sm" data-act="parentParams" data-uid="${s.uid}" data-fk="ed-parent">Use $${esc(S.parent.ticker)} values</button>` : ''}
      ${b.params.some((p) => !p.text) ? `<button class="btn btn-ghost btn-sm" data-act="reset" data-uid="${s.uid}" data-fk="ed-reset">Defaults</button>` : ''}
      <button class="btn btn-glass btn-sm" data-act="rm" data-uid="${s.uid}" data-fk="ed-rm">Remove</button>
    </div>
  </div>
  <div class="ed-body${isCustom ? ' custom' : ''}">
    <div class="ed-params">
      ${isCustom ? customHTML(S, s) : `<div class="ed-sub pixel">Parameters</div>${params || `<p class="muted ed-none">No settings. ${b.name} works as is.</p>`}`}
    </div>
    <div class="ed-spec">
      <div class="ed-sub pixel">What it refuses</div>
      <p class="ed-refuses">${esc(b.refuses)}</p>
      ${b.error && b.code != null ? `<div class="ed-err"><span class="ed-err-k pixel">The trader sees</span><span class="chip refuse mono">${hex(b.code)}</span><span class="ed-err-msg" data-errmsg>${esc(b.error(s.params, {}))}</span></div>` : ''}
      <dl class="facts">
        <div><dt>Enforcer</dt><dd>${enfBadges(b)}</dd></div>
        <div><dt>Error code</dt><dd class="mono">${hex(b.code)}</dd></div>
        <div><dt>Compute</dt><dd class="mono">${b.cu ? `${b.cu.toLocaleString('en-US')} CU` : '0 CU · off the transfer path'}</dd></div>
        <div><dt>Extra accounts</dt><dd class="mono">${b.accts}</dd></div>
        <div><dt>State</dt><dd>${STATE_TEXT[b.state]}</dd></div>
        <div><dt>Route</dt><dd>${ROUTE_TEXT[b.route]}</dd></div>
      </dl>
      <p class="ed-enf"><span class="enf ${b.enforcedBy}"><i></i></span>${ENFORCERS[b.enforcedBy].long}.${b.also ? ` ${ENFORCERS[b.also].long}.` : ''}${b.enforcedBy === 'hook' ? ' Retires at graduation, when the pool removes the hook.' : b.enforcedBy === 'crank' || b.also === 'crank' ? ' Keeps running after graduation.' : ''}</p>
    </div>
  </div>`;
}

function paramHTML(s, p, parent) {
  const v = s.params[p.key], id = `p-${s.uid}-${p.key}`;
  const pv = parent?.params[p.key];
  const parentTxt = parent ? `<span class="prm-parent${pv !== v ? ' diff' : ''}">parent ${p.fmt ? esc(p.fmt(pv)) : esc(pv)}</span>` : '';
  if (p.options) {
    return `<div class="prm"><div class="prm-top"><label for="${id}">${p.label}</label>${parentTxt}</div>
      <select class="input" id="${id}" data-p="${p.key}" data-uid="${s.uid}" data-fk="${p.key}">${p.options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  }
  const fill = ((v - p.min) / (p.max - p.min)) * 100;
  return `<div class="prm">
    <div class="prm-top"><label for="${id}">${p.label}</label><output class="mono" for="${id}" data-pv="${p.key}">${esc(p.fmt ? p.fmt(v) : v)}</output></div>
    <input type="range" class="rng" id="${id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-p="${p.key}" data-uid="${s.uid}" data-fk="${p.key}" aria-valuetext="${esc(p.fmt ? p.fmt(v) : v)}" style="--fill:${fill}%">
    <div class="prm-scale mono"><span>${esc(p.fmt ? p.fmt(p.min) : p.min)}</span>${parentTxt}<span>${esc(p.fmt ? p.fmt(p.max) : p.max)}</span></div>
  </div>`;
}

// ───────────────────────── custom block: English → Hookscript ─────────────────────────
function customHTML(S, s) {
  const busy = S.drafting[s.uid], err = S.draftErr[s.uid], d = s.draft;
  const stale = d && d.prompt !== (s.params.prompt ?? '').trim();
  return `<div class="hs">
    <div class="ed-sub pixel">Your rule, in English</div>
    <textarea class="input hs-in" id="hs-${s.uid}" rows="3" maxlength="280" data-p="prompt" data-uid="${s.uid}" data-fk="hs-prompt" aria-label="Describe your rule in English">${esc(s.params.prompt ?? '')}</textarea>
    <div class="hs-ex"><span class="dim">Try</span>${EXAMPLES.map((t, k) => `<button class="hs-chip" data-act="example" data-text="${esc(t)}" data-fk="ex-${k}">${esc(t)}</button>`).join('')}</div>
    <div class="hs-go">
      <button class="btn btn-chrome btn-sm" data-act="draft" data-uid="${s.uid}" data-fk="hs-draft" ${busy ? 'disabled' : ''}>${busy ? '<span class="spin" aria-hidden="true"></span>Compiling and fuzzing…' : d ? 'Draft again' : 'Draft Hookscript'}</button>
      <span class="hs-stale chip warnc" ${stale ? '' : 'hidden'}>Rule changed since this draft</span>
    </div>
    ${err ? `<p class="hs-err" role="alert">${esc(err)}</p>` : ''}
    ${busy && !d ? `<div class="hs-out hs-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>` : ''}
    ${d ? `<div class="hs-out${busy ? ' busy' : ''}">
      <div class="hs-bar"><span class="pixel">Hookscript</span><span class="chip warnc" title="No reviewer has signed off on this Hookscript yet">Unreviewed</span><span class="hs-ops mono">${d.ops} ops · ${d.cu.toLocaleString('en-US')} CU</span></div>
      <pre class="hs-code"><code>${tint(d.script)}</code></pre>
      <div class="hs-fuzz">
        <div><span>Fuzzed</span><b class="mono">${d.fuzz.trades.toLocaleString('en-US')} trades</b></div>
        <div><span>Refused</span><b class="mono">${d.fuzz.refusedPct.toFixed(1)}%</b></div>
        <div><span>Panics</span><b class="mono ${d.fuzz.panics ? 'bad' : 'good'}">${d.fuzz.panics}</b></div>
        <div><span>Max CU</span><b class="mono">${d.fuzz.maxCu.toLocaleString('en-US')}</b></div>
      </div>
      <p class="hs-note">Compiled to engine ops inside the 5,000 CU custom-block budget. The coin page shows the Unreviewed badge until a hookrz reviewer signs off on this Hookscript.</p>
    </div>` : ''}
  </div>`;
}

/** Light syntax tint for Hookscript: keywords, strings, numbers, dotted fields, operators. */
export function tint(src) {
  const re = /("[^"\n]*")|\b(rule|when|let|refuse|if|because|and|or|not|in)\b|\b(\d+(?:\.\d+)?[hms%]?)\b|\b([a-z_]+(?:\.[a-z_]+)+)\b|(==|!=|>=|<=|>|<|\+|\*|\/|-)/g;
  let out = '', last = 0;
  for (const m of src.matchAll(re)) {
    out += esc(src.slice(last, m.index));
    const [t, str, kw, num, field, op] = m;
    out += str ? `<span class="t-s">${esc(t)}</span>` : kw ? `<span class="t-k">${t}</span>` : num ? `<span class="t-n">${t}</span>` : field ? `<span class="t-f">${t}</span>` : op ? `<span class="t-o">${esc(t)}</span>` : esc(t);
    last = m.index + t.length;
  }
  return out + esc(src.slice(last));
}
