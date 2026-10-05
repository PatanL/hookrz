// Syntax tint for Hookscript and JSON, shared by the docs and the Custom block drawer.
import { esc } from '../core/format.js';

const KW = new Set(['rule', 'timezone', 'global', 'payout', 'on', 'when', 'let', 'set', 'refuse', 'allow', 'if', 'else', 'then', 'unless', 'because', 'and', 'or', 'not', 'in', 'is', 'to', 'as', 'where']);
const NS = /^(transfer|wallet|clock|curve|coin|sender|receiver|buyer|seller|other|moon|from)\.[a-z_]+/;

/** Hookscript source -> tinted HTML (one token pass, no regex soup over HTML). */
export function tintHookscript(src) {
  const out = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') { // string
      let j = i + 1; while (j < s.length && s[j] !== '"') j++;
      out.push(`<span class="hs-str">${esc(s.slice(i, j + 1))}</span>`); i = j + 1; continue;
    }
    if (ch === '#' || (ch === '/' && s[i + 1] === '/')) { // comment to end of line
      let j = s.indexOf('\n', i); if (j < 0) j = s.length;
      out.push(`<span class="hs-com">${esc(s.slice(i, j))}</span>`); i = j; continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = s.slice(i).match(/^[0-9][0-9_.]*(ms|s|m|h|d)?/);
      out.push(`<span class="hs-num">${esc(m[0])}</span>`); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/);
      const w = m[0];
      if (KW.has(w)) out.push(`<span class="hs-kw">${w}</span>`);
      else if (NS.test(w)) { const [ns, ...rest] = w.split('.'); out.push(`<span class="hs-ns">${ns}</span><span class="hs-op">.</span><span class="hs-fn">${esc(rest.join('.'))}</span>`); }
      else if (s[i + w.length] === ':') out.push(`<span class="hs-arg">${esc(w)}</span>`);
      else out.push(`<span class="hs-id">${esc(w)}</span>`);
      i += w.length; continue;
    }
    if (/[=<>!+\-*/]/.test(ch)) { const m = s.slice(i).match(/^[=<>!+\-*/]+/); out.push(`<span class="hs-op">${esc(m[0])}</span>`); i += m[0].length; continue; }
    out.push(esc(ch)); i++;
  }
  return out.join('');
}

/** Pretty JSON with tinted keys / strings / numbers. */
export function tintJSON(value) {
  const json = compact(value, '');
  return esc(json).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b(true|false|null)\b/g, (m, str, colon, numv, lit) => {
    if (str) return colon ? `<span class="js-key">${str}</span>${colon}` : `<span class="js-str">${str}</span>`;
    if (numv) return `<span class="js-num">${numv}</span>`;
    return `<span class="js-lit">${lit}</span>`;
  });
}

/** JSON.stringify(v, null, 2), but short arrays/objects stay on one line. */
function inline(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  const e = Object.entries(v).filter(([, x]) => x !== undefined);
  return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
}
function compact(v, ind) {
  const one = inline(v);
  if (v === null || typeof v !== 'object' || one.length + ind.length <= 72) return one;
  const next = ind + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => next + compact(x, next)).join(',\n')}\n${ind}]`;
  return `{\n${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${next}${JSON.stringify(k)}: ${compact(x, next)}`).join(',\n')}\n${ind}}`;
}
