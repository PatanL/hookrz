import{a as f}from"./avatar-20bCAp64.js";import{e as t,L as u,b as k}from"./format-CV8hyfGB.js";import{h as g,m as v}from"./coin-presets-CjG-I3Up.js";const l=e=>{var c;return((c=k[e])==null?void 0:c.name)??e};function b(e,c){if(c)return'<span class="dchip root">Original stack</span>';const{added:m,removed:d,tuned:o}=e.diff,r=[...m.map(a=>`<span class="dchip add" data-tip="Added ${t(l(a))}">+${t(l(a))}</span>`),...d.map(a=>`<span class="dchip rem" data-tip="Removed ${t(l(a))}">−${t(l(a))}</span>`),...o.map(a=>`<span class="dchip tune" data-tip="Retuned ${t(l(a))}">~${t(l(a))}</span>`)];return r.length?r.join(""):'<span class="dchip same">Same stack, as is</span>'}function U(e,{current:c=null,stack:m=!0}={}){const d=new Set,o=(n,i)=>n.coin.ticker===c?([...i,n.coin.ticker].forEach(s=>d.add(s)),!0):n.children.some(s=>o(s,[...i,n.coin.ticker]));c&&o(e,[]);const r=n=>n.children.reduce((i,s)=>i+1+r(s),0),a=(n,i)=>{const s=n.coin,$=s.ticker===c,p=n.children.length;return`<li class="${d.has(s.ticker)?"on-path":""}">
      <a class="lnode${$?" cur":""}" href="coin.html?t=${encodeURIComponent(s.ticker)}">
        ${f(s,32)}
        <span class="ln-main">
          <span class="ln-top"><b class="ln-t">$${t(s.ticker)}</b><span class="ln-h">${t(g(s))}</span>${$?'<span class="ln-here">this coin</span>':""}</span>
          <span class="ln-diff">${b(n,i===0)}</span>
          <span class="ln-meta ln-meta-m num">${u(s.mcapUsd)}${p?` · ${p} remix${p>1?"es":""}`:""}</span>
        </span>
        <span class="ln-side">
          ${m?v(s.stack,{size:14,gap:3}):""}
          <span class="ln-meta num">${u(s.mcapUsd)}${p?` · ${p} remix${p>1?"es":""}`:""}</span>
        </span>
      </a>
      ${p?`<ul>${n.children.map(h=>a(h,i+1)).join("")}</ul>`:""}
    </li>`};return`<div class="ltree" data-size="${r(e)+1}"><ul>${a(e,0)}</ul></div>`}export{U as l};
