// Home: how remixing works, drawn from real catalog data. A preset is the root; each child is the same
// stack with one change (a block added or a setting tuned), shown as a stack diff with its cube row.
// Desktop lays generations out in columns with curved cables between parent and child; narrow screens
// get an indented list with elbow connectors.
import { cube, ICON } from './icons.js';
import { byId, ENFORCERS } from '../data/blocks.js';
import { budget, normalize } from '../engine/engine.js';
import { diffStacks } from '../api/client.js';
import { esc } from '../core/format.js';

const name = (id) => byId[id]?.name ?? id;

/** A preset plus example remixes: [{ title, blurb, change: { add } | { tune: [id, params] }, href }]. */
export function remixTree(preset, remixes) {
  const base = normalize(preset.slots.map(([id, params]) => ({ id, params })));
  const root = { title: preset.name, kind: 'Preset', blurb: preset.blurb, stack: base, href: `build.html?preset=${preset.id}`, go: 'Start from it', children: [] };
  root.children = remixes.map((r) => {
    let stack = base.map((s) => ({ id: s.id, params: { ...s.params } }));
    if (r.change.add) stack.push({ id: r.change.add, params: {} });
    if (r.change.tune) { const [id, p] = r.change.tune; stack = stack.map((s) => (s.id === id ? { id, params: { ...s.params, ...p } } : s)); }
    stack = normalize(stack);
    const target = r.change.add ?? r.change.tune?.[0];
    return { title: r.title, kind: 'Remix', blurb: r.blurb, stack, parent: base, diff: diffStacks(base, stack), href: `build.html?preset=${preset.id}&add=${target}`, go: 'Remix this', children: [] };
  });
  return root;
}

export function mountLineage(el, root) {
  // flatten: rows by leaf order, columns by generation
  const nodes = [];
  let leaf = 0;
  const walk = (n, depth, parent) => {
    const me = { n, depth, parent, row: 0, span: 1 };
    nodes.push(me);
    if (!n.children.length) me.row = leaf++;
    else {
      const kids = n.children.map((c) => walk(c, depth + 1, me));
      me.row = kids[0].row;
      me.span = kids[kids.length - 1].row + kids[kids.length - 1].span - me.row;
    }
    return me;
  };
  walk(root, 0, null);
  const cols = Math.max(...nodes.map((x) => x.depth)) + 1;

  el.innerHTML = `<div class="lin-grid" style="--cols:${cols};--rows:${leaf}">
    <svg class="lin-wires" aria-hidden="true"></svg>
    ${nodes.map(nodeHTML).join('')}
  </div>`;

  const grid = el.querySelector('.lin-grid');
  const svg = el.querySelector('.lin-wires');
  const cards = [...el.querySelectorAll('.lnode')];
  const draw = () => {
    const g = grid.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);
    svg.setAttribute('width', g.width); svg.setAttribute('height', g.height);
    let paths = '';
    nodes.forEach((me, i) => {
      if (!me.parent) return;
      const p = cards[nodes.indexOf(me.parent)].getBoundingClientRect(), c = cards[i].getBoundingClientRect();
      let d;
      if (c.left > p.right - 4) { // columns: parent right-middle → child left-middle
        const x1 = p.right - g.left, y1 = p.top + p.height / 2 - g.top, x2 = c.left - g.left, y2 = c.top + c.height / 2 - g.top, dx = (x2 - x1) * 0.55;
        d = `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
      } else { // indented list: elbow down the parent's left edge
        const x1 = p.left - g.left + 18, y1 = p.bottom - g.top, x2 = c.left - g.left, y2 = c.top + 30 - g.top;
        d = `M${x1} ${y1}V${y2 - 8}Q${x1} ${y2} ${x1 + 8} ${y2}H${x2}`;
      }
      paths += `<path class="w-base" d="${d}"/><path class="w-flow" d="${d}"/>`;
    });
    svg.innerHTML = paths;
  };
  draw();
  new ResizeObserver(draw).observe(grid);
}

/** The one setting a tune changed, as "Snipe Shield tuned to 0.25%". */
function tuneLine(id, before, after) {
  const b = byId[id];
  const p = b?.params.find((x) => before[x.key] !== after[x.key]);
  if (!p) return `${esc(name(id))} tuned`;
  const v = (p.fmt ? p.fmt(after[p.key]) : String(after[p.key])).replace(/ of supply$/, '');
  return `${esc(name(id))} tuned to <span class="mono">${esc(v)}</span>`;
}

function nodeHTML(me) {
  const n = me.n;
  const root = me.depth === 0;
  const d = n.diff ?? { added: [], removed: [], tuned: [] };
  const before = Object.fromEntries((n.parent ?? []).map((s) => [s.id, s.params]));
  const lines = root
    ? n.stack.map((s) => { const b = byId[s.id]; return `<li class="orig"><span class="enf ${b.enforcedBy}" title="${esc(ENFORCERS[b.enforcedBy].long)}"><i></i></span>${esc(b.name)}<em class="mono">${esc(b.summary(s.params))}</em></li>`; }).join('')
    : [
      ...d.added.map((id) => `<li class="add"><i>+</i>${esc(name(id))}</li>`),
      ...d.removed.map((id) => `<li class="del"><i>−</i>${esc(name(id))}</li>`),
      ...d.tuned.map((id) => `<li class="tune"><i>~</i><span>${tuneLine(id, before[id], n.stack.find((s) => s.id === id).params)}</span></li>`),
    ].join('');
  const cubes = n.stack.map((s) => {
    const st = d.added.includes(s.id) ? ' add' : d.tuned.includes(s.id) ? ' tune' : '';
    return `<span class="lc${st}">${cube(byId[s.id]?.family ?? 'custom', { size: 20, title: name(s.id) })}</span>`;
  }).join('');
  const b = budget(n.stack);
  return `<a class="lnode nr${root ? ' root' : ''}" href="${esc(n.href)}" style="--col:${me.depth + 1};--row:${me.row + 1};--span:${me.span};--depth:${me.depth}">
    <div class="lnode-top"><span class="lnode-stack">${cubes}</span><span class="lnode-gen pixel">${n.kind}</span></div>
    <div class="lnode-id"><b>${esc(n.title)}</b><small>${esc(n.blurb)}</small></div>
    <ul class="lnode-diff">${lines}</ul>
    <div class="lnode-foot"><span class="mono dim">${n.stack.length} blocks · ${b.cu.toLocaleString('en-US')} CU</span><span class="lnode-go">${n.go} ${ICON.arrow}</span></div>
  </a>`;
}
