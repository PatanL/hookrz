// "Rule ideas": playful rules written in Hookscript (hookscript/examples/*.hs, bundled into src/vendor/hookscript.js).
// Each card launches with the idea (build.html?idea=<name>) or opens the details drawer: a short scene of the rule
// playing out against its real script (src/ui/rule-play.js), then the script and the tester.
// The list is shared with home and Launch (src/data/ideas.js); glyphs are in the shared pixel set (src/ui/pixel.js).
import { pixelIcon } from './pixel.js';
import { esc } from '../core/format.js';
import { IDEAS, ideaById } from '../data/ideas.js';
import { SCENES } from './rule-play-scenes.js';

export { IDEAS, ideaById };
export const glyph = (name, { size = 24, color = 'currentColor', accent = '#8fcaff' } = {}) => pixelIcon(name, { size, color, accent });
export const SHOWN = 8;
export const SHOWN_SM = 4; // on a phone

const go = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

const play = '<svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges" style="margin-right:6px;vertical-align:0"><path d="M2 1h2v1h2v1h2v1h2v4H8v1H6v1H4v1H2z" fill="currentColor"/></svg>';

export const ideaTile = (x, size = 44) => `<span class="idt" style="--it:${size}px">${glyph(x.icon, { size: size >= 44 ? 24 : 18 })}</span>`;

export function ideaCard(x, i) {
  return `<article class="id-card${i >= SHOWN ? ' more' : i >= SHOWN_SM ? ' more-sm' : ''}" data-idea="${x.id}">
    <div class="id-top">${ideaTile(x)}<h3 class="id-name">${esc(x.name)}</h3></div>
    <p class="id-line">${esc(x.line)}</p>
    <div class="id-actions">
      <a class="btn btn-glass btn-sm id-go" href="build.html?idea=${encodeURIComponent(x.id)}">Launch with this${go}</a>
      <button type="button" class="id-see" data-see="${x.id}">${SCENES[x.id] ? `${play}Watch it play` : 'See the rule'}</button>
    </div>
  </article>`;
}

/** The gallery section. */
export function ideasSection() {
  return `<section class="id-sec" id="ideas" aria-labelledby="ideas-h">
    <div class="id-head">
      <div>
        <span class="eyebrow">Rule ideas</span>
        <h2 id="ideas-h">Rules you can write in plain English</h2>
        <p class="id-sub">Here are some we love. Each one is a few lines of Hookscript, our rule language, and the chain checks it on every trade. Launch one as is, or describe your own.</p>
      </div>
    </div>
    <div class="id-grid" id="ideaGrid">${IDEAS.map(ideaCard).join('')}</div>
    <div class="id-foot">
      <button type="button" class="btn btn-ghost btn-sm" id="ideasMore" aria-expanded="false" aria-controls="ideaGrid">More ideas</button>
      <button type="button" class="btn btn-glass btn-sm" data-open="custom">Describe your own rule</button>
    </div>
  </section>`;
}
