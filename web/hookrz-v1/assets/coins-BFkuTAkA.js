import{m as I,v as N,k as g,V as R,e as c,i as S,o as i,L as y,B as j,P as A,j as U,c as v,n as H,R as O,M as P,b as F,h as L,a as G}from"./format-CV8hyfGB.js";import{a as D}from"./avatar-20bCAp64.js";import{i as V,p as C,d as _,b as K,h as W,m as X}from"./coin-presets-CjG-I3Up.js";import{r as J}from"./coin-feed-CKVx9lOy.js";I("coins");V();const p=document.getElementById("app"),m=new URLSearchParams(location.search),t={family:m.get("family")||"",phase:m.get("phase")||"",sort:m.get("sort")||"mcap",q:m.get("q")||""},Q=[["mcap","Market cap"],["volume","24h volume"],["new","Newest"],["remixes","Most remixed"],["change","24h change"]],Y=[["","All"],["curve","On curve"],["graduated","Graduated"]],k=85;p.innerHTML=`
<section class="cx-hero">
  <div class="wrap">
    <div class="cx-head">
      <div class="cx-title">
        <span class="eyebrow">Explorer · every transfer checked</span>
        <h1 class="cx-h1" aria-label="Coins">${N("COINS",{cell:11,gap:1.2,depth:.34})}</h1>
        <p class="lede">Every coin launched on hookrz and the stack of rules it runs. The engine checks each transfer against the stack and refuses what it forbids, on chain.</p>
      </div>
      <div class="cx-stats panel" id="stats">${E(null)}</div>
    </div>
    <div class="cx-live panel" id="live">
      <div class="cx-live-h">
        <span class="live-dot refuse"></span>
        <span class="pixel cx-live-t">Refused just now</span>
        <span class="cx-live-empty" id="liveEmpty">No refusals yet. When a coin's stack refuses a transfer, it shows up here.</span>
      </div>
      <div class="cx-live-list" id="liveList" hidden></div>
    </div>
  </div>
</section>

<section class="cx-main">
  <div class="wrap">
    <div class="cx-controls" id="controls" hidden>
      <div class="cx-fams" role="group" aria-label="Family">
        <button class="fchip" data-fam="">All</button>
        ${g.map(s=>`<button class="fchip" data-fam="${s.id}" data-tip="${c(s.verb)}: ${c(s.blurb)}"><span class="emb">${R[s.id]}</span>${s.name}</button>`).join("")}
      </div>
      <div class="cx-tools">
        <div class="seg" id="phase" role="group" aria-label="Phase">${Y.map(([s,a])=>`<button data-phase="${s}">${a}</button>`).join("")}</div>
        <label class="cx-sort"><span class="sr">Sort</span>
          <select class="input" id="sort">${Q.map(([s,a])=>`<option value="${s}">${a}</option>`).join("")}</select>
        </label>
        <label class="cx-search"><span class="sr">Search</span>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="4.8"/><path d="m10.6 10.6 3.6 3.6"/></svg>
          <input class="input" id="q" type="search" placeholder="Search coins" autocomplete="off" spellcheck="false">
        </label>
      </div>
    </div>
    <div class="cx-meta" id="meta" hidden><span id="count" class="dim"></span><span class="dim cx-hint">Hover a cube to see the rule. <span class="r-sq"></span>refused / checked transfers.</span></div>
    <div class="cx-grid" id="grid"></div>
    <div class="cx-more" id="more" hidden></div>
  </div>
</section>`;const n=s=>p.querySelector(s),Z=(s,a)=>`${i(s)} ${a}${s===1?"":"s"}`;function E(s){if(s&&!s.length)return ss();const a=l=>(s??[]).reduce(($,x)=>$+(x[l]??0),0),e=a("checked"),r=a("refused");return[["Coins",s?i(s.length):"—",s?`${s.filter(l=>l.phase==="graduated").length} graduated`:""],["24h volume",s?y(a("vol24Usd")):"—",s?`${Z(s.filter(l=>l.vol24Usd>0).length,"coin")} traded`:""],["Checked",s?i(e):"—","transfers, on chain"],["Refused",s?i(r):"—",s&&e?`${(r/e*100).toFixed(1)}% of transfers`:""]].map(([l,$,x],T)=>`<div class="cx-stat${T===3?" ref":""}"><span class="k">${l}</span><span class="v num">${$}</span><span class="s">${x}</span></div>`).join("")}function ss(){return[["Coins","0","none launched yet"],["Blocks",i(j.length),`in ${g.length} families`],["Starter stacks",i(A.length),"ready to remix"],["Engine budget",U.cuBudget.toLocaleString("en-US"),"CU per transfer"]].map(([a,e,r])=>`<div class="cx-stat"><span class="k">${a}</span><span class="v num">${e}</span><span class="s">${r}</span></div>`).join("")}function as(){return`<div class="cx-zero">
    <div class="cx-zero-hero panel">
      <div class="cx-zero-copy">
        <div class="cx-zero-cubes">${g.map(()=>v("x",{size:30,state:"empty"})).join("")}</div>
        <h2 class="cx-zero-h">No coins yet</h2>
        <p class="lede">Snap rule blocks into a stack and launch it; the first coin shows up here with every transfer the engine checks.</p>
        <div class="cx-zero-cta"><a class="btn btn-chrome btn-lg" href="build.html">Build the first coin</a><a class="btn btn-glass btn-lg" href="build.html#presets">Start from a preset</a></div>
      </div>
      <div class="cx-zero-art" aria-hidden="true"><img src="${H("img/brand/engine-rack-900.webp")}" alt="" width="900" height="506"></div>
    </div>
    <div class="cx-zero-h3"><h3>Starter stacks</h3><span class="dim">Open one in Build, tune it, launch.</span></div>
    ${C()}
  </div>`}function es(s){const a=encodeURIComponent(s.ticker),e=_(s.change24),r=s.minutesAgo<60,o=Math.min(k,s.progress*k),l=s.checked?s.refused/s.checked*100:0;return`<article class="ccard${s.phase==="graduated"?" grad":""}">
    <a class="cc-link" href="coin.html?t=${a}" aria-label="${c(s.name)} ($${c(s.ticker)})"></a>
    <div class="cc-top">
      ${D(s,52)}
      <div class="cc-id">
        <div class="cc-name">${c(s.name)}</div>
        <div class="cc-sub"><span class="cc-tk">$${c(s.ticker)}</span>${K(s)}<span class="cc-by">${c(W(s))}</span></div>
        <div class="cc-age">${r?'<span class="cc-new">New</span>':""}${O(s.minutesAgo)}</div>
      </div>
      <div class="cc-chg ${e>.05?"up":e<-.05?"down":""}"><span class="num">${P(e)}</span><span class="k">24h</span></div>
    </div>
    ${s.desc?`<p class="cc-desc">${c(s.desc)}</p>`:""}
    <div class="cc-nums">
      <div><span class="k">Market cap</span><span class="v num">${y(s.mcapUsd)}</span></div>
      <div><span class="k">Vol 24h</span><span class="v num">${y(s.vol24Usd)}</span></div>
      <div><span class="k">Holders</span><span class="v num">${i(s.holders)}</span></div>
    </div>
    ${s.phase==="graduated"?'<div class="cc-curve"><div class="cc-grad"><span class="chip solid">Graduated</span><span class="dim">Trading on Meteora DAMM v2</span></div></div>':`<div class="cc-curve"><div class="cc-cl"><span class="k">Curve</span><span class="num"><b>${(s.progress*100).toFixed(s.progress<.1?1:0)}%</b> · ${o.toFixed(1)} / ${k} SOL</span></div><div class="cbar ticks"><i style="width:${Math.max(1.5,s.progress*100)}%"></i></div></div>`}
    <div class="cc-stack">
      <div class="cc-blocks">${X(s.stack,{size:26,gap:5})}<span class="cc-slots num">${s.stack.length}/6</span></div>
      <div class="cc-checks num" data-tip="${i(s.refused)} of ${i(s.checked)} transfers refused (${l.toFixed(1)}%)"><span class="r">${i(s.refused)}</span><span class="dim">/ ${i(s.checked)}</span></div>
    </div>
    <div class="cc-foot">
      ${s.parent?`<a class="chip ice cc-parent" href="coin.html?t=${encodeURIComponent(s.parent)}"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 2v4a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v2"/></svg>Remix of $${c(s.parent)}</a>`:'<span class="chip">Original stack</span>'}
      <span class="cc-remixes${s.remixes?" has":""}" data-tip="${s.remixes?`${s.remixes} coin${s.remixes>1?"s":""} launched on this stack`:"Nobody has remixed this stack yet"}">${ts}<span class="num">${s.remixes}</span> remix${s.remixes===1?"":"es"}</span>
    </div>
  </article>`}const ts='<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 2v4a3 3 0 0 0 3 3h2a3 3 0 0 1 3 3v2M12 2v3M4 14v-2"/><rect x="2.5" y="1" width="3" height="3"/><rect x="10.5" y="1" width="3" height="3"/></svg>';function ns(){const s=g.find(a=>a.id===t.family);return`<div class="cx-empty panel">
    <div class="cx-empty-cubes">${v("x",{size:34,state:"empty"})}${v("x",{size:34,state:"empty"})}${v("x",{size:34,state:"empty"})}</div>
    <h3>No coins match</h3>
    <p class="muted">Nothing ${t.q?`matches “${c(t.q)}”`:"fits these filters"}${s?` with a ${s.name} block`:""}${t.phase?` ${t.phase==="curve"?"on the curve":"that has graduated"}`:""}.</p>
    <div class="row wrap-row" style="justify-content:center"><button class="btn btn-glass btn-sm" id="clear">Clear filters</button><a class="btn btn-chrome btn-sm" href="build.html">Build one</a></div>
  </div>`}let M=0,w=null,f={},z=0;async function u(){var e;const s=++M;if(w===0){n("#controls").hidden=!0,n("#meta").hidden=!0,n("#grid").className="cx-grid is-empty",n("#grid").innerHTML=as();return}n("#controls").hidden=!1,n("#meta").hidden=!1,w<6&&n("#more").hidden&&(n("#more").innerHTML=`<div class="cx-zero-h3"><h3>Launch the next one</h3><span class="dim">Start from a starter stack, tune it in Build, launch.</span><a class="btn btn-glass btn-sm" href="build.html">Build a coin</a></div>${C({compact:!0})}`,n("#more").hidden=!1),cs();const a=await S.coins({sort:t.sort,family:t.family||void 0,phase:t.phase||void 0,q:t.q.trim()||void 0});s===M&&(n("#grid").innerHTML=a.length?a.map(es).join(""):ns(),n("#grid").classList.toggle("is-empty",!a.length),n("#count").textContent=`${a.length} coin${a.length===1?"":"s"}${t.family||t.phase||t.q?" match":""}`,(e=n("#clear"))==null||e.addEventListener("click",()=>{Object.assign(t,{family:"",phase:"",q:""}),n("#q").value="",u()}))}function cs(){p.querySelectorAll(".fchip").forEach(a=>{const e=a.dataset.fam===t.family;a.classList.toggle("on",e),a.disabled=!!a.dataset.fam&&!f[a.dataset.fam]&&!e}),p.querySelectorAll("#phase button").forEach(a=>{const e=a.dataset.phase===t.phase;a.classList.toggle("on",e),a.disabled=a.dataset.phase==="graduated"&&!z&&!e}),n("#sort").value=t.sort;const s=new URLSearchParams;for(const a of["family","phase","q"])t[a]&&s.set(a,t[a]);t.sort!=="mcap"&&s.set("sort",t.sort),history.replaceState(null,"",location.pathname+(s.toString()?"?"+s:""))}p.querySelector(".cx-fams").addEventListener("click",s=>{const a=s.target.closest(".fchip");!a||a.disabled||(t.family=a.dataset.fam===t.family&&a.dataset.fam?"":a.dataset.fam,u())});n("#phase").addEventListener("click",s=>{const a=s.target.closest("button");!a||a.disabled||(t.phase=a.dataset.phase,u())});n("#sort").addEventListener("change",s=>{t.sort=s.target.value,u()});let q;n("#q").value=t.q;n("#q").addEventListener("input",s=>{clearTimeout(q),q=setTimeout(()=>{t.q=s.target.value,u()},160)});const b=6,d=[],h=[],B=s=>{const a=Math.max(0,Math.round((Date.now()-s)/1e3));return a<2?"now":a<60?a+"s":Math.floor(a/60)+"m"};function is(s){const a=F[s.by];return`<a class="lv${s.fresh?" fresh":""}" href="coin.html?t=${encodeURIComponent(s.ticker)}">
    ${v((a==null?void 0:a.family)??"custom",{size:30,state:"refused"})}
    <span class="lv-body">
      <span class="lv-top"><b>$${c(s.ticker)}</b><span class="lv-b">${c((a==null?void 0:a.name)??s.by)}</span><span class="lv-code" data-tip="${c(`${L(a==null?void 0:a.code)} ${G(a==null?void 0:a.code)}`)}">${L(a==null?void 0:a.code)}</span></span>
      <span class="lv-msg">${c(s.msg)}</span>
    </span>
    <span class="lv-age num" data-at="${s.at}">${B(s.at)}</span>
  </a>`}function ls(){n("#liveEmpty").hidden=d.length>0,n("#liveList").hidden=!d.length,n("#liveList").innerHTML=d.map(is).join(""),d.forEach(s=>{s.fresh=!1})}function rs(s){const a=s.filter(e=>!e.test&&e.phase==="curve"&&e.budget.hasHook).slice(0,6);for(const e of a)S.stream(e.ticker,r=>{const o=J(r,e);!o||o.ok||!o.by||(h.push({ticker:e.ticker,by:o.by,msg:o.msg}),h.length>b&&h.splice(0,h.length-b))});a.length&&setInterval(()=>{if(h.length){const e=h.shift();e.at=Date.now(),e.fresh=!0,d.unshift(e),d.length=Math.min(d.length,b),ls();return}p.querySelectorAll(".lv-age").forEach(e=>{e.textContent=B(+e.dataset.at)})},1400)}(async()=>{const s=await S.coins();w=s.length,f={};for(const a of s)for(const e of a.families)f[e]=(f[e]??0)+1;z=s.filter(a=>a.phase==="graduated").length,n("#stats").innerHTML=E(s),u(),rs(s)})();
