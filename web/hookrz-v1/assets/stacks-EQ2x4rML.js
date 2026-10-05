import{m as z,k as I,F as p,v as S,e as i,n as v,c as d,P as C,j as f,I as L,i as g,o as k,J as j,L as B,R as F,b as U,V as H}from"./format-CV8hyfGB.js";import{a as R}from"./avatar-20bCAp64.js";import{i as N,S as V,m as T,f as x,g as q,s as h,h as m,e as G,b as D}from"./coin-presets-CjG-I3Up.js";import{l as J}from"./coin-lineage-CPNwI99c.js";z("stacks");N();const $=document.getElementById("app"),W=Object.fromEntries(I.map(s=>[s.id,s])),u=p.split.find(s=>s.who==="Stack author").pct;$.innerHTML=`
<section class="sk-hero">
  <div class="wrap sk-hero-g">
    <div class="sk-copy">
      <span class="eyebrow">Stacks · remix lineage · royalties</span>
      <h1 class="sk-h1" aria-label="Remix. Own.">${S("REMIX. OWN.",{cell:9,gap:1,depth:.34})}</h1>
      <p class="lede">Any coin's stack can be remixed into a new launch in one click. The new coin keeps a link to its parent, and the parent stack's author earns ${u}% of the ${p.tradeFeePct}% trade fee on every coin that remixes it, one level up.</p>
      <div class="sk-split" aria-label="Trade fee split">
        <span class="sk-split-l"><b class="num">${p.tradeFeePct}%</b> trade fee</span>
        <span class="sk-split-bar">${p.split.map(s=>`<span class="sk-seg ${s.who==="Stack author"?"auth":s.who==="Creator"?"cr":"pl"}" style="flex:${s.pct}" data-tip="${i(s.note)}"><b class="num">${s.pct}%</b><i>${s.who==="Stack author"?"author":s.who}</i></span>`).join("")}</span>
      </div>
      <div class="sk-kpis" id="kpis"></div>
    </div>
    <div class="sk-art" aria-hidden="true"><img src="${v("img/brand/remix-tree-900.webp")}" srcset="${v("img/brand/remix-tree-900.webp")} 900w, ${v("img/brand/remix-tree.webp")} 1672w" sizes="(max-width: 900px) 100vw, 640px" alt="" width="900" height="506"></div>
  </div>
</section>

<section class="sk-main">
  <div class="wrap sk-grid">
    <div class="sk-col">
    <div class="panel sk-board" id="board" hidden>
      <div class="ph">
        <h3>Original stacks <span class="pk" id="boardCount"></span></h3>
        <div class="seg" id="sort"><button data-s="remixes" class="on">Most remixed</button><button data-s="royalties">Royalties</button><button data-s="new">Newest</button></div>
      </div>
      <div class="sk-thead"><span>#</span><span>Stack</span><span>Author</span><span class="r">Remixes</span><span class="r">Royalties 24h</span><span>Families</span><span></span></div>
      <ol class="sk-rows" id="rows"></ol>
    </div>
    <div class="panel sk-starters" id="starters">${E(!0)}</div>
    </div>
    <aside class="sk-side">
      <div class="panel sk-authors" id="authors" hidden></div>
      <div class="panel sk-how">
        <div class="ph"><h3>How remix royalties work</h3></div>
        <ol class="sk-steps">
          <li>${d("guard",{size:30})}<div><b>Pick a stack</b><span>“Remix this stack” opens Build with every block and param copied.</span></div></li>
          <li>${d("pace",{size:30})}<div><b>Change what you want</b><span>Tune params, add or drop blocks. The launch writes the parent stack into your coin's Stack account.</span></div></li>
          <li>${d("crown",{size:30})}<div><b>The author earns</b><span>${u}% of your coin's ${p.tradeFeePct}% trade fee goes to the parent stack's author, paid by the keeper. One level up only; originals keep it.</span></div></li>
        </ol>
      </div>
    </aside>
  </div>
</section>`;function E(s){return`<div class="ph">
      <h3>Starter stacks <span class="pk">${C.length} stacks · open in Build</span></h3>
    </div>
    ${s?`<p class="st-note">${d("crown",{size:24})}<span>Once coins launch, the most remixed stacks and the royalties their authors earn rank here. Until then, start from one of these.</span></p>`:""}
    <div class="st-thead"><span>Stack</span><span>Blocks</span><span class="r">Slots</span><span>Per transfer</span><span></span></div>
    <ol class="st-rows">${V.map(a=>`<li class="st-row">
      <span class="st-main"><b>${i(a.name)}</b><span class="st-blurb">${i(a.blurb)}</span></span>
      <span class="st-cubes">${T(a.stack,{size:20,gap:4})}</span>
      <span class="st-n r num"><b>${a.stack.length}</b><small>/${f.maxSlots}</small><i>slots</i></span>
      <span class="st-cu" data-tip="${i(x(a.budget))} of the engine's ${f.cuBudget.toLocaleString("en-US")} CU per transfer"><span class="num">${x(a.budget)}</span><span class="st-bar"><i style="width:${q(a.budget)}%"></i></span></span>
      <a class="btn btn-glass btn-sm st-go" href="${a.href}">${L.remix}Remix this stack</a>
    </li>`).join("")}</ol>`}const r=s=>$.querySelector(s);let b=[],o=null,M="remixes";const y=new Map;function X(s){return s<3?`<span class="sk-rank top" aria-label="Rank ${s+1}">${S(String(s+1),{cell:3.6,gap:.5,depth:.34,glow:!1})}</span>`:`<span class="sk-rank num">${s+1}</span>`}function _(s,a){const n=o===s.ticker;return`<li class="sk-row${n?" open":""}" data-t="${i(s.ticker)}">
    <button class="sk-r" aria-expanded="${n}" aria-controls="d-${i(s.ticker)}">
      ${X(a)}
      <span class="sk-stack">
        ${R(s,40)}
        <span class="sk-nm"><b>${i(s.name)}</b><span class="sk-sub"><span class="num">$${i(s.ticker)}</span>${D(s)}${T(s.stack,{size:16,gap:3})}</span></span>
      </span>
      <span class="sk-auth">${i(m(s))}</span>
      <span class="sk-rmx r num"><b>${s.remixCount}</b><i class="sk-l">remixes</i></span>
      <span class="sk-roy r num"><b>${h(s.royaltiesSol,!1)}</b> SOL<i class="sk-l">royalties 24h</i></span>
      <span class="sk-fams">${s.families.map(l=>{var e;return`<span class="sk-fam" data-tip="${i(((e=W[l])==null?void 0:e.name)??l)}">${H[l]??""}</span>`}).join("")}</span>
      <span class="sk-chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span>
    </button>
    <div class="sk-detail" id="d-${i(s.ticker)}" ${n?"":"hidden"}>${n?O(s):""}</div>
  </li>`}function O(s){const a=y.get(s.ticker),n=s.family??[s],l=n.slice(1).reduce((e,t)=>e+t.vol24Usd,0);return`<div class="sk-d">
    <div class="sk-d-l">
      <div class="sk-d-h"><span class="pk">Remix lineage</span><span class="dim">${n.length} coin${n.length>1?"s":""} on this family · remixes traded ${B(l)} in 24h</span></div>
      ${a?J(a,{current:s.ticker}):'<div class="sk-load">Loading lineage…</div>'}
      ${a&&!a.children.length?`<p class="sk-none">${d("x",{size:22,state:"empty"})}<span>No remixes yet. Launch on this stack and your coin branches off here; ${i(m(s))} earns ${u}% of its trade fee.</span></p>`:""}
    </div>
    <div class="sk-d-r">
      <div class="sk-d-h"><span class="pk">The stack</span><span class="dim">by ${i(m(s))} · ${F(s.minutesAgo)}</span></div>
      <ol class="sk-blocks">${s.stack.map(e=>{const t=U[e.id];return`<li>${d(t.family,{size:30})}<span class="sk-bn"><b>${i(t.name)}</b><span class="num">${i(t.summary(e.params))}</span></span><span class="sk-be">${G(t)}</span></li>`}).join("")}</ol>
      <div class="sk-d-cta">
        <a class="btn btn-chrome" href="build.html?remix=${encodeURIComponent(s.ticker)}">${L.remix}Remix this stack</a>
        <a class="btn btn-glass" href="coin.html?t=${encodeURIComponent(s.ticker)}">View $${i(s.ticker)}</a>
      </div>
      <p class="sk-d-note dim">Launch on this stack and ${i(m(s))} earns ${u}% of your coin's trade fee.</p>
    </div>
  </div>`}function P(){const s={remixes:(a,n)=>n.remixCount-a.remixCount||n.royaltiesSol-a.royaltiesSol,royalties:(a,n)=>n.royaltiesSol-a.royaltiesSol||n.remixCount-a.remixCount,new:(a,n)=>a.minutesAgo-n.minutesAgo}[M];return[...b].sort(s)}function w(){r("#rows").innerHTML=P().map(_).join("")}async function A(s){if(o=o===s?null:s,w(),o&&!y.has(o)){const a=await g.lineage(o);if(y.set(o,a),o===s){const n=$.querySelector(`.sk-row[data-t="${CSS.escape(s)}"] .sk-detail`);n&&(n.innerHTML=O(b.find(l=>l.ticker===s)))}}}r("#rows").addEventListener("click",s=>{const a=s.target.closest(".sk-r");a&&A(a.closest(".sk-row").dataset.t)});r("#sort").addEventListener("click",s=>{const a=s.target.closest("button");a&&(M=a.dataset.s,$.querySelectorAll("#sort button").forEach(n=>n.classList.toggle("on",n===a)),w())});function K(s){const a=new Map;for(const e of s){const t=e.creator;a.has(t)||a.set(t,{coin:e,handle:m(e),coins:0,stacks:0,remixes:0,royalties:0,fees:0});const c=a.get(t);c.coins++,c.fees+=e.vol24Usd*p.tradeFeePct/100*(p.split[0].pct/100)/j}for(const e of b){const t=a.get(e.creator);t&&(t.stacks++,t.remixes+=e.remixCount,t.royalties+=e.royaltiesSol)}const n=[...a.values()].sort((e,t)=>t.royalties-e.royalties||t.remixes-e.remixes||t.fees-e.fees).slice(0,6),l=Math.max(...n.map(e=>e.royalties+e.fees))||1;r("#authors").innerHTML=`
    <div class="ph"><h3>Top authors <span class="pk">last 24h</span></h3></div>
    <ol class="sk-alist">${n.map((e,t)=>`<li>
      <span class="sk-an num">${t+1}</span>
      <span class="sk-aa">${R(e.coin,30)}</span>
      <span class="sk-ab"><b>${i(e.handle)}</b><span class="dim">${e.stacks} stack${e.stacks===1?"":"s"} · ${e.coins} coin${e.coins===1?"":"s"} · ${e.remixes} remix${e.remixes===1?"":"es"}</span>
        <span class="sk-abar" data-tip="Royalties ${h(e.royalties)} · creator fees ${h(e.fees)}"><i class="roy" style="width:${e.royalties/l*100}%"></i><i class="fee" style="width:${e.fees/l*100}%"></i></span></span>
      <span class="sk-av num"><b>${h(e.royalties,!1)}</b><small>royalty SOL</small></span>
    </li>`).join("")}</ol>
    <div class="sk-alegend"><span><i class="roy"></i>Royalties</span><span><i class="fee"></i>Creator fees</span></div>`}(async()=>{const[s,a]=await Promise.all([g.stacks(),g.coins()]);b=s,o=null;const n=s.reduce((t,c)=>t+c.remixCount,0),l=s.reduce((t,c)=>t+c.royaltiesSol,0),e=new Set(a.map(t=>t.creator)).size;r("#kpis").innerHTML=(s.length?[["Original stacks",k(s.length)],["Remix launches",k(n)],["Royalties 24h",`${h(l,!1)} SOL`],["Authors",k(e)]]:[["Starter stacks",k(C.length)],["Author royalty",`${u}%`],["Levels paid","1"],["Slots per stack",k(f.maxSlots)]]).map(([t,c])=>`<div><span class="k">${t}</span><span class="v num">${c}</span></div>`).join(""),s.length&&(r("#board").hidden=!1,r("#boardCount").textContent=`${s.length} stack${s.length===1?"":"s"}`,r("#sort").hidden=s.length<2,r("#starters").innerHTML=E(!1),w(),a.length&&(r("#authors").hidden=!1,K(a)),A(P()[0].ticker))})();
