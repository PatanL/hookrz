// Home: the remix tree from api.lineage(). Desktop lays generations out in columns with curved
// cables between parent and child; narrow screens get an indented list with elbow connectors.
import { cube } from './icons.js';
import { avatar } from './avatar.js';
import { byId } from '../data/blocks.js';
import { usd, esc } from '../core/format.js';

const name = (id) => byId[id]?.name ?? id;

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

function nodeHTML(me) {
  const { coin: c, diff } = me.n;
  const gen = me.depth === 0 ? 'Original' : `Gen ${me.depth + 1}`;
  let lines;
  if (me.depth === 0) lines = `<li class="orig">Original stack · ${c.stack.length} blocks</li>`;
  else if (!diff.added.length && !diff.removed.length && !diff.tuned.length) lines = `<li class="same">Remixed as is</li>`;
  else lines = [
    ...diff.added.map((id) => `<li class="add"><i>+</i>${esc(name(id))}</li>`),
    ...diff.removed.map((id) => `<li class="del"><i>−</i>${esc(name(id))}</li>`),
    diff.tuned.length ? `<li class="tune"><i>~</i>Tuned ${diff.tuned.map((id) => esc(name(id))).join(', ')}</li>` : '',
  ].join('');
  return `<a class="lnode nr${me.depth === 0 ? ' root' : ''}" href="coin.html?t=${esc(c.ticker)}" style="--col:${me.depth + 1};--row:${me.row + 1};--span:${me.span};--depth:${me.depth}">
    <div class="lnode-top">${avatar(c, 36)}<div class="lnode-id"><b>$${esc(c.ticker)}</b><small>by ${esc(c.creatorInfo?.handle ?? c.creator)}</small></div><span class="lnode-gen pixel">${gen}</span></div>
    <div class="lnode-stack">${c.stack.map((s) => cube(byId[s.id]?.family ?? 'custom', { size: 18 })).join('')}<span class="lnode-vol mono">${usd(c.vol24Usd)} <span class="dim">24h</span></span></div>
    <ul class="lnode-diff">${lines}</ul>
  </a>`;
}
