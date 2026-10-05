import{j as z,b as j,G as is,I,c as O,e as r,E as W,a as ds,h as G,i as bs,o as X,a0 as Ss,g as Ls,S as _,C as Ts,U as Ms,w as ps,H as Es,F as R,m as Bs,P as us,B as es,k as Q,v as As,M as zs,L as hs}from"./format-CV8hyfGB.js";import{a as Cs}from"./avatar-20bCAp64.js";const Rs=1500,Is=3,Os=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;function qs(s,{preset:a,onVerdict:t}){const l=a.slots.map(([e,o])=>({id:e,params:o})),c=Array.from({length:z.maxSlots},(e,o)=>l[o]?{...j[l[o].id],params:l[o].params}:null),m=c.filter(e=>(e==null?void 0:e.enforcedBy)==="hook").length,y=is(l).cu,w=`build.html?preset=${encodeURIComponent(a.id)}`;s.innerHTML=`
  <div class="rack-head">
    <a class="rack-coin" href="${w}"><span class="rack-mark">${O("guard",{size:40})}</span><span><b>${r(a.name)} stack</b><small>${r(a.name)} · every transfer through the engine</small></span></a>
    <span class="rack-live"><i></i>Running</span>
  </div>
  <p class="rack-sub"><span class="mono">${z.program}</span><span class="sep"></span><span class="num">${l.length}</span>/<span class="num">${z.maxSlots}</span> slots<span class="sep"></span><span class="num">${y.toLocaleString("en-US")}</span> CU<a class="rack-use" href="${w}">Launch with this stack ${I.arrow}</a></p>
  <div class="rack-chassis">
    <div class="rack-bays">
      ${c.map((e,o)=>`
      <div class="rack-slot${e?" has enf-"+e.enforcedBy:" empty"}" data-i="${o}">
        <div class="bay">${e?O(e.family,{size:60,title:e.name}):O("x",{size:60,state:"empty"})}<span class="bay-tag mono"></span></div>
      </div>`).join("")}
    </div>
    <div class="rack-rail" aria-hidden="true"><span class="cap in"></span><span class="cap out"></span><div class="rack-packets"></div></div>
    <div class="rack-labels">
      ${c.map((e,o)=>`
      <div class="rack-label${e?"":" empty"}">
        <span class="slot-n pixel">${String(o+1).padStart(2,"0")}</span>
        <span class="slot-name">${e?r(e.name):"Open slot"}</span>
        <span class="slot-code">${e?e.code!=null?`<span class="mono" title="${r(ds(e.code))}">${G(e.code)}</span>`:`<span class="enf ${e.enforcedBy}"><i></i>${W[e.enforcedBy].name}</span>`:'<span class="dim">—</span>'}</span>
      </div>`).join("")}
    </div>
    <div class="rack-ends pixel" aria-hidden="true"><span>Transfer in</span><span>Lands</span></div>
  </div>
  <ol class="rack-legend">${c.map((e,o)=>e?`<li><span class="pixel">${String(o+1).padStart(2,"0")}</span>${r(e.name)}<em>${e.code!=null?G(e.code):W[e.enforcedBy].name}</em></li>`:"").join("")}</ol>
  <div class="rack-verdict idle">
    <div class="rv-l1"><span class="rv-kind pixel">—</span><span class="rv-amt">Waiting for the next transfer</span><span class="rv-state pixel"></span></div>
    <div class="rv-l2">&nbsp;</div>
  </div>
  <div class="rack-counters">
    <div><span class="pixel">Transfers checked</span><b class="num" data-c="checked">0</b></div>
    <div><span class="pixel">Refused</span><b class="num refuse" data-c="refused">0</b></div>
    <div><span class="pixel">Refusal rate</span><b class="num" data-c="rate">0%</b></div>
  </div>`;const d=[...s.querySelectorAll(".rack-slot")],v=d.map(e=>e.querySelector(".cube")),u=d.map(e=>e.querySelector(".bay-tag")),g=s.querySelector(".rack-rail"),S=s.querySelector(".rack-packets"),n=s.querySelector(".cap.out"),i=s.querySelector(".rack-verdict"),f=Object.fromEntries([...s.querySelectorAll("[data-c]")].map(e=>[e.dataset.c,e]));let L=0,b=0,p=[];const x=()=>{const e=g.getBoundingClientRect();p=[0,...d.map(o=>{const h=o.querySelector(".bay").getBoundingClientRect();return h.left+h.width/2-e.left}),e.width]};x();const k=new ResizeObserver(x);k.observe(g);const A=new WeakMap,M=(e,o,h)=>{let B=A.get(e);B||A.set(e,B={}),clearTimeout(B[o]),e.classList.contains(o)&&(e.classList.remove(o),e.offsetWidth),e.classList.add(o),B[o]=setTimeout(()=>e.classList.remove(o),h)},U=(e,o)=>{c[e]&&(M(v[e],o?"lit":"touch",o?560:380),o&&M(d[e],"is-lit",560))},$=(e,o)=>{M(v[e],"refused",1700),M(d[e],"is-refused",1700),u[e].textContent=G(c[e].code)},E=e=>{var H;const o=e.by?j[e.by]:null,h=o?c.findIndex(F=>(F==null?void 0:F.id)===o.id):-1,B=e.kind==="buy"?`<span class="num">${(e.sol??0).toFixed(2)} SOL</span><span class="dim">→</span><span class="num">${X(e.amount)}</span> <span class="dim">tokens</span>`:`<span class="num">${X(e.amount)}</span> <span class="dim">tokens</span>`;i.className="rack-verdict "+(e.ok?"ok":"no"),i.innerHTML=`
      <div class="rv-l1"><span class="rv-kind pixel k-${e.kind}">${e.kind}</span><span class="rv-amt">${B}<span class="sep"></span><span class="mono dim">${r(Ss(e.wallet))}</span></span>
        <span class="rv-state pixel">${e.ok?`${I.check}Landed`:`${I.stop}Refused ${G(o==null?void 0:o.code)}`}</span></div>
      <div class="rv-l2">${e.ok?`Passed ${((H=e.verdicts)==null?void 0:H.length)??m} of ${m} hook checks in slot order`:`<b>${r((o==null?void 0:o.name)??"Block")}</b> <span class="dim">· slot ${String(h+1).padStart(2,"0")} · ${r(ds(o==null?void 0:o.code))} ·</span> ${r(e.msg??"")}`}</div>`,m&&L++,e.ok||b++,f.checked.textContent=L.toLocaleString("en-US"),f.refused.textContent=b.toLocaleString("en-US"),f.rate.textContent=js(b,L),M(f.checked,"bump",400),e.ok||M(f.refused,"bump",400),t==null||t(e)},C=new Set;let T=0,q=!0;const K=e=>{T=0;const o=p[p.length-1]-p[0];for(const h of C){if(h.done)continue;let B=p[0]+o*Math.min(1,(e-h.t0)/Rs);for(;h.next<p.length&&B>=p[h.next];){const H=h.next;if(H===p.length-1){os(h,!0);break}const F=c[H-1];if(F&&!h.ev.ok&&h.ev.by===F.id){B=p[H],os(h,!1,H-1);break}F&&U(H-1,F.enforcedBy==="hook"),h.next++}h.el.style.transform=`translate3d(${B.toFixed(1)}px,0,0)`}[...C].some(h=>!h.done)&&(T=requestAnimationFrame(K))},os=(e,o,h)=>{e.done=!0,o?(M(n,"hit",600),e.el.classList.add("gone"),setTimeout(()=>{e.el.remove(),C.delete(e)},260)):($(h,e.ev),e.el.classList.add("stop"),setTimeout(()=>{e.el.classList.add("gone")},1100),setTimeout(()=>{e.el.remove(),C.delete(e)},1400)),E(e.ev)},ys=e=>{if(!q||document.hidden||Os()||p.length<2)return ws(e);if([...C].filter(h=>!h.done).length>=Is)return;const o=document.createElement("i");o.className="pkt k-"+e.kind+(e.ok?"":" will-refuse"),S.append(o),C.add({el:o,ev:e,t0:performance.now(),next:1,done:!1}),T||(T=requestAnimationFrame(K))},ws=e=>{const o=e.ok?-1:c.findIndex(h=>(h==null?void 0:h.id)===e.by);c.forEach((h,B)=>{h&&(o<0||B<o)&&U(B,h.enforcedBy==="hook")}),o>=0?$(o):M(n,"hit",600),E(e)},cs=new IntersectionObserver(([e])=>{q=e.isIntersecting},{threshold:.05});cs.observe(s);const xs=bs.stream(null,ys,{stack:l}),rs=()=>{xs(),k.disconnect(),cs.disconnect(),cancelAnimationFrame(T)};return addEventListener("pagehide",rs,{once:!0}),rs}const js=(s,a)=>a?`${(s/a*100).toFixed(1)}%`:"0%",D=[{id:"snipe-shield",params:{window:60,max:.3}},{id:"circuit-breaker",params:{band:20,window:5}},{id:"max-wallet",params:{pct:3}},{id:"sell-cap",params:{pct:1}},{id:"hold-timer",params:{minutes:60}},{id:"buyback-burn",params:{pct:25}}],as={launch:{label:"Launch +30s",t:30,progress:.03,bal:.25,lots:[[8,1]],recv:.2},hour:{label:"Launch +2h",t:7200,progress:.38,bal:1.5,lots:[[300,.4],[5400,.6]],recv:2},day:{label:"Launch +1d",t:9e4,progress:.82,bal:1.5,lots:[[3e3,.6],[6e4,.4]],recv:2.5}},J={"snipe-shield":["buy"],"circuit-breaker":["buy","sell"],"max-wallet":["buy","send"],"sell-cap":["sell"],"hold-timer":["sell","send"]},Z=[.05,.1,.25,.5,1,2,5,10],ss=[10,25,50,75,100],Hs='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h15v12H3z"/><path d="M3 7l12-3v3"/><path d="M14 12h7v4h-7z"/></svg>',Fs='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M8.5 12h7M12 8.5v7" stroke-width="1.4" opacity=".7"/></svg>',Ps='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18v12H3z"/><path d="M7 9v6M11 9v6M15 9v6" stroke-width="2.4"/><path d="M19 9v6" opacity=".4" stroke-width="2.4"/></svg>';function Us(s){const a={kind:"buy",size:{buy:3,sell:1,send:1},when:"hour"},t=is(D),l=D.map(n=>j[n.id]),c={stack:"Stack PDA",walletSrc:"Wallet record · sender",walletDst:"Wallet record · receiver",pool:"DBC pool (price)"};s.innerHTML=`
  <div class="flow-controls">
    <div class="ctl"><span class="ctl-k pixel">Transfer</span>
      <div class="seg" role="group" aria-label="Transfer kind">${["buy","sell","send"].map(n=>`<button type="button" data-kind="${n}">${n[0].toUpperCase()+n.slice(1)}</button>`).join("")}</div></div>
    <div class="ctl ctl-size"><span class="ctl-k pixel">Size</span>
      <div class="size-row"><input type="range" min="0" step="1" aria-label="Size"><output class="num"></output></div></div>
    <div class="ctl"><span class="ctl-k pixel">When</span>
      <div class="seg" role="group" aria-label="Moment in the launch">${Object.entries(as).map(([n,i])=>`<button type="button" data-when="${n}">${i.label}</button>`).join("")}</div></div>
  </div>
  <p class="flow-wallet"></p>
  <div class="flow-diagram">
    <div class="fnode nr f-wallet"><span class="fstep pixel">01</span><span class="fico">${Hs}</span><b>Wallet</b><small class="fw-text"></small></div>
    <div class="farrow" aria-hidden="true"><i></i></div>
    <div class="fnode nr f-t22"><span class="fstep pixel">02</span><span class="fico">${Fs}</span><b>Token-2022</b><small><span class="mono">transfer_checked</span> sees the mint's TransferHook and calls the engine before anything moves.</small></div>
    <div class="farrow" aria-hidden="true"><i></i></div>
    <div class="fengine nr">
      <div class="fengine-head"><span class="fstep pixel">03</span><span class="fico">${Ps}</span><div><span class="fe-name"><b class="mono">hookrz_engine</b><span class="dim"> · Execute</span></span><small>Runs the stack in slot order. The first refusal wins.</small></div>
        <span class="fcu"><span class="num">${t.cu.toLocaleString("en-US")}</span><span class="dim"> / ${z.cuBudget.toLocaleString("en-US")} CU</span></span></div>
      <div class="faccts"><span class="pixel dim">Reads via ExtraAccountMetaList</span>${t.accounts.map(n=>`<span class="acct" title="${r(n.label)}">${c[n.key]??r(n.label)}</span>`).join("")}</div>
      <ol class="fslots">${l.map((n,i)=>`
        <li class="fslot nr" data-i="${i}"><span class="fslot-n pixel">${String(i+1).padStart(2,"0")}</span><span class="fcube">${O(n.family,{size:40})}</span>
          <b>${r(n.name)}</b><span class="fparam">${r(n.summary(D[i].params))}</span><span class="fhex mono">${n.code!=null?G(n.code):W[n.enforcedBy].name}</span><span class="fv pixel"></span></li>`).join("")}</ol>
    </div>
    <div class="farrow last" aria-hidden="true"><i></i></div>
    <div class="fnode nr fresult"><span class="fstep pixel">04</span><span class="fico fres-ico"></span><b class="fres-title"></b><small class="fres-code mono"></small><small class="fres-text"></small></div>
  </div>`;const m=n=>s.querySelector(n),y=m("input[type=range]"),w=m("output"),d=[...s.querySelectorAll(".fslot")];let v=[];const u=()=>{const n=as[a.when],i=new Ts,f=i.vTok-(i.vTok-Ms.gradTok)*Math.min(.999,n.progress);i.vSol=i.k/f,i.vTok=f;const L=_*n.bal/100,b=n.lots.map(([M,U])=>({t:M,amt:L*U})),p=a.kind;let x,k=0,A;return p==="buy"?(k=Z[a.size.buy],x=i.quoteBuy(k,1).out,A=i.priceAfterBuy(k,1)):(x=L*ss[a.size[p]]/100,A=p==="sell"?i.priceAfterSell(x,1):i.price),{kind:p,amount:x,sol:k,supply:_,t:n.t,slot:Math.floor(n.t/.4),hour:15,progress:n.progress,priceAfter:A,windowOpenPrice:i.price,srcBefore:p==="buy"?0:L,dstAfter:p==="buy"?L+x:p==="send"?_*n.recv/100+x:0,isCreatorSrc:!1,isCreator:!1,w:{lots:b,lastBuySlot:Math.floor(b[b.length-1].t/.4),lastSellT:null,firstT:b[0].t},slotBuys:0,hourSold:0,hasPass:!0,gateBal:0,blocked:!1}},g=n=>`${+(n/_*100).toFixed(2)}%`,S=(n=!0)=>{const{kind:i}=a,f=as[a.when];s.querySelectorAll("[data-kind]").forEach($=>$.setAttribute("aria-pressed",String($.dataset.kind===i))),s.querySelectorAll("[data-when]").forEach($=>$.setAttribute("aria-pressed",String($.dataset.when===a.when)));const L=i==="buy"?Z:ss;y.max=String(L.length-1),y.value=String(a.size[i]),y.style.setProperty("--fill",`${a.size[i]/(L.length-1)*100}%`);const b=u(),p=Ls(D,b),x=i==="buy"?`${Z[a.size.buy]} SOL`:`${ss[a.size[i]]}% of the bag`;w.textContent=i==="buy"?`${Z[a.size.buy]} SOL`:`${ss[a.size[i]]}%`,m(".flow-wallet").innerHTML=i==="buy"?`A wallet holding <b class="num">${g(_*f.bal/100)}</b> of supply buys <b class="num">${X(b.amount)}</b> tokens (<b class="num">${g(b.amount)}</b>) with <b class="num">${x}</b>, <span class="num">${f.label.replace("Launch ","")}</span> after launch, curve <b class="num">${Math.round(f.progress*100)}%</b> full.`:i==="sell"?`A wallet holding <b class="num">${g(_*f.bal/100)}</b> of supply sells <b class="num">${X(b.amount)}</b> tokens (<b class="num">${g(b.amount)}</b>), <span class="num">${f.label.replace("Launch ","")}</span> after launch. ${a.when==="hour"?"Part of its bag arrived 30 minutes ago.":a.when==="launch"?"Its whole bag arrived 22 seconds ago.":"Its coins arrived hours ago."}`:`A wallet sends <b class="num">${X(b.amount)}</b> tokens (<b class="num">${g(b.amount)}</b>) to a wallet that already holds <b class="num">${f.recv}%</b>, <span class="num">${f.label.replace("Launch ","")}</span> after launch.`,s.querySelector(".fw-text").innerHTML=`Signs a <b>${i}</b> of <span class="mono">${i==="buy"?x:X(b.amount)}</span>`;const k=p.ok?-1:D.findIndex($=>$.id===p.refusedBy),A=l.filter(($,E)=>$.check&&(!J[$.id]||J[$.id].includes(i))&&(k<0||E<k)).length;v.forEach(clearTimeout),v=[],d.forEach(($,E)=>{const C=l[E];let T,q;C.check?k>=0&&E>k?(T="skip",q="Not reached"):E===k?(T="refused",q="Refused"):J[C.id]&&!J[C.id].includes(i)?(T="na",q=`Skips ${i}s`):(T="pass",q="Pass"):(T="off",q="Off path");const K=()=>{$.className="fslot nr "+T,$.querySelector(".cube").className="cube"+(T==="pass"?" lit":T==="refused"?" refused":""),$.querySelector(".fv").innerHTML=(T==="pass"?I.check:T==="refused"?I.stop:"")+`<span>${q}</span>`};n&&!ms()?($.className="fslot nr pending",v.push(setTimeout(K,120+E*110))):K()});const M=s.querySelector(".fresult"),U=()=>{const $=p.ok?null:j[p.refusedBy];M.className="fnode nr fresult "+(p.ok?"ok":"no"),s.querySelector(".flow-diagram").classList.toggle("refused",!p.ok),s.querySelector(".fres-ico").innerHTML=p.ok?I.check:I.stop,s.querySelector(".fres-title").textContent=p.ok?"Lands":"Refused",s.querySelector(".fres-code").textContent=p.ok?`${A} ${A===1?"check":"checks"} passed`:`custom error ${G($.code)}`,s.querySelector(".fres-text").innerHTML=p.ok?`The tokens move. ${l.filter(E=>!E.check).map(E=>r(E.name)).join(", ")} runs later on the keeper, off the transfer path.`:`<b>${r($.name)}:</b> ${r(p.message)}. Token-2022 fails the whole transaction; nothing moves.`};n&&!ms()?(M.className="fnode nr fresult pending",v.push(setTimeout(U,120+(k>=0?k+1:D.length)*110+80))):U()};s.addEventListener("click",n=>{const i=n.target.closest("[data-kind]"),f=n.target.closest("[data-when]");i&&(a.kind=i.dataset.kind,S()),f&&(a.when=f.dataset.when,S())}),y.addEventListener("input",()=>{a.size[a.kind]=+y.value,S()}),S(!1)}const ms=()=>matchMedia("(prefers-reduced-motion: reduce)").matches,V=s=>{var a;return((a=j[s])==null?void 0:a.name)??s};function Ns(s,a){const t=ps(s.slots.map(([c,m])=>({id:c,params:m}))),l={title:s.name,kind:"Preset",blurb:s.blurb,stack:t,href:`build.html?preset=${s.id}`,go:"Start from it",children:[]};return l.children=a.map(c=>{var w;let m=t.map(d=>({id:d.id,params:{...d.params}}));if(c.change.add&&m.push({id:c.change.add,params:{}}),c.change.tune){const[d,v]=c.change.tune;m=m.map(u=>u.id===d?{id:d,params:{...u.params,...v}}:u)}m=ps(m);const y=c.change.add??((w=c.change.tune)==null?void 0:w[0]);return{title:c.title,kind:"Remix",blurb:c.blurb,stack:m,parent:t,diff:Es(t,m),href:`build.html?preset=${s.id}&add=${y}`,go:"Remix this",children:[]}}),l}function Ws(s,a){const t=[];let l=0;const c=(u,g,S)=>{const n={n:u,depth:g,parent:S,row:0,span:1};if(t.push(n),!u.children.length)n.row=l++;else{const i=u.children.map(f=>c(f,g+1,n));n.row=i[0].row,n.span=i[i.length-1].row+i[i.length-1].span-n.row}return n};c(a,0,null);const m=Math.max(...t.map(u=>u.depth))+1;s.innerHTML=`<div class="lin-grid" style="--cols:${m};--rows:${l}">
    <svg class="lin-wires" aria-hidden="true"></svg>
    ${t.map(Ds).join("")}
  </div>`;const y=s.querySelector(".lin-grid"),w=s.querySelector(".lin-wires"),d=[...s.querySelectorAll(".lnode")],v=()=>{const u=y.getBoundingClientRect();w.setAttribute("viewBox",`0 0 ${u.width} ${u.height}`),w.setAttribute("width",u.width),w.setAttribute("height",u.height);let g="";t.forEach((S,n)=>{if(!S.parent)return;const i=d[t.indexOf(S.parent)].getBoundingClientRect(),f=d[n].getBoundingClientRect();let L;if(f.left>i.right-4){const b=i.right-u.left,p=i.top+i.height/2-u.top,x=f.left-u.left,k=f.top+f.height/2-u.top,A=(x-b)*.55;L=`M${b} ${p}C${b+A} ${p} ${x-A} ${k} ${x} ${k}`}else{const b=i.left-u.left+18,p=i.bottom-u.top,x=f.left-u.left,k=f.top+30-u.top;L=`M${b} ${p}V${k-8}Q${b} ${k} ${b+8} ${k}H${x}`}g+=`<path class="w-base" d="${L}"/><path class="w-flow" d="${L}"/>`}),w.innerHTML=g};v(),new ResizeObserver(v).observe(y)}function _s(s,a,t){const l=j[s],c=l==null?void 0:l.params.find(y=>a[y.key]!==t[y.key]);if(!c)return`${r(V(s))} tuned`;const m=(c.fmt?c.fmt(t[c.key]):String(t[c.key])).replace(/ of supply$/,"");return`${r(V(s))} tuned to <span class="mono">${r(m)}</span>`}function Ds(s){const a=s.n,t=s.depth===0,l=a.diff??{added:[],removed:[],tuned:[]},c=Object.fromEntries((a.parent??[]).map(d=>[d.id,d.params])),m=t?a.stack.map(d=>{const v=j[d.id];return`<li class="orig"><span class="enf ${v.enforcedBy}" title="${r(W[v.enforcedBy].long)}"><i></i></span>${r(v.name)}<em class="mono">${r(v.summary(d.params))}</em></li>`}).join(""):[...l.added.map(d=>`<li class="add"><i>+</i>${r(V(d))}</li>`),...l.removed.map(d=>`<li class="del"><i>−</i>${r(V(d))}</li>`),...l.tuned.map(d=>`<li class="tune"><i>~</i><span>${_s(d,c[d],a.stack.find(v=>v.id===d).params)}</span></li>`)].join(""),y=a.stack.map(d=>{var u;return`<span class="lc${l.added.includes(d.id)?" add":l.tuned.includes(d.id)?" tune":""}">${O(((u=j[d.id])==null?void 0:u.family)??"custom",{size:20,title:V(d.id)})}</span>`}).join(""),w=is(a.stack);return`<a class="lnode nr${t?" root":""}" href="${r(a.href)}" style="--col:${s.depth+1};--row:${s.row+1};--span:${s.span};--depth:${s.depth}">
    <div class="lnode-top"><span class="lnode-stack">${y}</span><span class="lnode-gen pixel">${a.kind}</span></div>
    <div class="lnode-id"><b>${r(a.title)}</b><small>${r(a.blurb)}</small></div>
    <ul class="lnode-diff">${m}</ul>
    <div class="lnode-foot"><span class="mono dim">${a.stack.length} blocks · ${w.cu.toLocaleString("en-US")} CU</span><span class="lnode-go">${a.go} ${I.arrow}</span></div>
  </a>`}const ns=s=>{var a;return((a=R.split.find(t=>t.who===s))==null?void 0:a.pct)??0},vs=1,Gs=5,Xs=50;function Ks(s){const a=10**(vs+(Gs-vs)*s/100),t=10**Math.max(0,Math.floor(Math.log10(a))-1);return Math.round(a/t)*t}function P(s){return`${s>=100?Math.round(s).toLocaleString("en-US"):s>=10?s.toFixed(1):s>=1?s.toFixed(2):s.toFixed(3)} SOL`}function Vs(s,a){const t=R.tradeFeePct,l=ns("Stack author"),c=ns("Creator"),m=ns("hookrz"),y=t*l/100;s.innerHTML=`
    <div class="calc nr">
      <div class="calc-head"><span class="pixel">Royalty calculator</span><span class="pixel dim">${l}% of the ${t}% fee</span></div>
      <label class="calc-k" for="calcVol">Daily volume on remixes of your stack</label>
      <div class="calc-row"><input id="calcVol" type="range" min="0" max="100" step="1" value="${Xs}"><output class="num" for="calcVol" data-o="vol"></output></div>
      <div class="calc-scale mono dim" aria-hidden="true"><span>10</span><span>100</span><span>1K</span><span>10K</span><span>100K SOL</span></div>
      <div class="calc-out">
        <div><span class="pixel">Your royalty · per day</span><b class="num ice" data-o="day"></b></div>
        <div><span class="pixel">Per 30 days</span><b class="num" data-o="month"></b></div>
      </div>
      <p class="own-note">That is ${y}% of every trade on a remix of your stack. Royalties go one level up: a remix of a remix pays the stack it forked.</p>
    </div>`,a.innerHTML=`
    <span class="pixel fee-ex-k">Worked example · one day</span>
    <p>Remixes of your stack trade <b class="num" data-o="vol"></b>. The <b class="num" data-o="fee"></b> in trade fees splits three ways:</p>
    <ul>
      <li><span class="sw s0"></span><span>Creators of the remixes<small>${c}% of the fee</small></span><b class="num" data-o="creator"></b></li>
      <li><span class="sw s1"></span><span>hookrz<small>engine, keeper, API · ${m}%</small></span><b class="num" data-o="platform"></b></li>
      <li><span class="sw s2"></span><span>You<small>author of the stack they remixed · ${l}%</small></span><b class="num ice" data-o="author"></b></li>
    </ul>`;const w=s.querySelector("input"),d=g=>[...s.querySelectorAll(`[data-o="${g}"]`),...a.querySelectorAll(`[data-o="${g}"]`)],v=(g,S)=>d(g).forEach(n=>{n.textContent=S}),u=()=>{const g=+w.value,S=Ks(g),n=S*t/100;w.style.setProperty("--fill",`${g}%`),w.setAttribute("aria-valuetext",`${P(S)} a day`),v("vol",P(S)),v("fee",P(n)),v("day",P(n*l/100)),v("month",P(n*l*30/100)),v("creator",P(n*c/100)),v("platform",P(n*m/100)),v("author",P(n*l/100))};w.addEventListener("input",u),u()}let ts;Bs("");const N=I.arrow,Ys=s=>Math.round(s).toLocaleString("en-US"),gs=s=>{var a;return((a=R.split.find(t=>t.who===s))==null?void 0:a.pct)??0},Y=us.find(s=>s.id==="fair-launch")??us[0],Qs=[["Blocks",`${es.length}`,`in ${Q.length} families, each one rule`],["Slots per stack",`${z.maxSlots}`,"run in order on every transfer"],["To launch",`${R.launchCostSol}<small>SOL</small>`,"mint, curve and stack in one tx"],["Remix royalty",`${gs("Stack author")}<small>%</small>`,"of the fee on every remix of your stack"]],Js=["hook","curve","crank","ext"],ks=(s,a)=>`${s} ${a}${s===1?"":"s"}`,$s=document.getElementById("app");$s.classList.add("home");$s.innerHTML=`
<section class="hero">
  <div class="wrap">
    <span class="eyebrow rv">Transfer-hook launchpad on Solana</span>
    <h1 class="hero-title rv" style="--d:60ms"><span class="sr">Build. Remix. Own.</span>
      <span class="vx-one" aria-hidden="true">${fs("BUILD. REMIX. OWN.")}</span>
      <span class="vx-three" aria-hidden="true">${["BUILD.","REMIX.","OWN."].map(s=>`<span>${fs(s)}</span>`).join("")}</span>
    </h1>
    <div class="hero-grid">
      <div class="hero-copy">
        <div class="hero-lead">
        <p class="lede rv" style="--d:120ms">Build a coin from rule blocks. Solana runs your stack on every transfer, so a trade that breaks a rule never lands. Remix any coin's stack in one click, and earn every time someone remixes yours.</p>
        <div class="hero-ctas rv" style="--d:180ms">
          <a class="btn btn-chrome btn-lg" href="build.html">Build a coin ${N}</a>
          <a class="btn btn-glass btn-lg" href="stacks.html">Browse stacks</a>
        </div>
        </div>
        <ul class="hero-facts rv" style="--d:240ms">
          <li><i class="hf"></i><span><b>Refused on chain.</b> Hook blocks run inside Token-2022 on every transfer, on every route.</span></li>
          <li><i class="hf"></i><span><b>Armed before the first trade.</b> Mint, curve and stack launch in one transaction.</span></li>
          <li><i class="hf"></i><span><b>No keys.</b> The engine can only refuse a transfer. It never moves funds.</span></li>
        </ul>
      </div>
      <div class="hero-rack-wrap rv" style="--d:140ms">
        <div class="rack px" id="rack"><div class="rack-skel"></div></div>
        <div class="rack-floor" aria-hidden="true"></div>
      </div>
    </div>
    <div class="stats-strip px rv" id="stats" style="--d:200ms">
      ${Qs.map(([s,a,t])=>`
      <div class="stat"><span class="stat-k pixel">${s}</span><b class="num">${a}</b><span class="stat-sub">${t}</span></div>`).join("")}
    </div>
  </div>
</section>

<section class="section engine" id="engine">
  <div class="wrap engine-grid">
    <figure class="engine-art">
      <img class="rv" src="img/brand/engine-rack.webp" srcset="img/brand/engine-rack-900.webp 900w, img/brand/engine-rack.webp 1672w" sizes="(max-width: 1020px) 100vw, 760px" alt="The hookrz engine: six block slots on one cable" width="1672" height="941" decoding="async">
      <figcaption class="engine-vs rv">
        <div class="vs-row old">
          <span class="vs-k pixel">One program, one rule</span>
          <span class="vs-cubes">${O("guard",{size:24})}${O("x",{size:24,state:"empty"}).repeat(z.maxSlots-1)}</span>
          <span class="vs-t">A mint names one hook program, so a coin usually gets one rule.</span>
        </div>
        <div class="vs-row">
          <span class="vs-k pixel">hookrz_engine</span>
          <span class="vs-cubes">${Q.map(s=>O(s.id,{size:24,state:"lit"})).join("")}</span>
          <span class="vs-t">Every coin names the same engine. It runs a stack of up to ${z.maxSlots} blocks.</span>
        </div>
      </figcaption>
    </figure>
    <div class="engine-copy">
      <div class="section-head rv">
        <span class="eyebrow">The engine</span>
        <h2>One engine.<br><span class="chrome-text">A whole stack.</span></h2>
        <p class="lede">A Token-2022 mint can point at exactly one transfer-hook program. So a coin usually gets one rule, or a program written just for it. hookrz points every coin at one audited engine, <span class="mono">hookrz_engine</span>, that reads the coin's stack and runs up to ${z.maxSlots} blocks in slot order on every transfer.</p>
      </div>
      <div class="engine-stats rv">
        <div class="nr"><b class="num">${z.maxSlots}</b><span class="pixel">Slots per stack</span></div>
        <div class="nr"><b class="num">${z.cuBudget.toLocaleString("en-US")}</b><span class="pixel">CU per transfer</span></div>
        <div class="nr"><b class="num">0</b><span class="pixel">Keys held</span></div>
      </div>
      <ul class="enforcers rv">
        ${Js.map(s=>`<li><span class="enf ${s}"><i></i>${W[s].name}</span><span>${W[s].long}</span><span class="mono dim">${ks(es.filter(a=>a.enforcedBy===s).length,"block")}</span></li>`).join("")}
      </ul>
    </div>
  </div>
</section>

<section class="section families" id="families">
  <div class="wrap">
    <div class="section-head rv">
      <span class="eyebrow">The blocks</span>
      <h2>Six families. <span class="chrome-text">${es.length} blocks.</span></h2>
      <p class="lede">Each block is one rule with bounded settings you tune. Snap up to ${z.maxSlots} into a stack. The engine checks the blocks that refuse; the curve and the public keeper run the rest.</p>
    </div>
    <div class="fam-grid">${Q.map(ae).join("")}</div>
  </div>
</section>

<section class="section how" id="how">
  <div class="wrap">
    <div class="how-head">
      <div class="section-head rv">
        <span class="eyebrow">Under the hood</span>
        <h2>How a transfer <span class="chrome-text">gets hooked.</span></h2>
        <p class="lede">Every transfer of a hookrz coin goes through Token-2022, which calls the engine before a single token moves. Pick a trade and watch a six-block stack decide it.</p>
      </div>
      <img class="how-art rv" src="img/brand/hero-hook-stack.webp" srcset="img/brand/hero-hook-stack-900.webp 900w, img/brand/hero-hook-stack.webp 1672w" sizes="(max-width: 1020px) 100vw, 820px" alt="" width="1672" height="941" loading="lazy" decoding="async">
    </div>
    <div class="flow px rv" id="flow"></div>
  </div>
</section>

<section class="section remix" id="remix">
  <div class="wrap">
    <div class="remix-top">
      <div class="section-head rv">
        <span class="eyebrow">Remix</span>
        <h2>Fork any stack <span class="chrome-text">in one click.</span></h2>
        <p class="lede">Every stack is public. Open a coin or a preset, hit Remix, tune a block or add one, and launch. The new coin keeps a parent link, so its lineage is on chain and the royalty knows where to go.</p>
        <div class="remix-ctas"><a class="btn btn-chrome btn-lg" href="build.html?preset=${Y.id}">Remix ${r(Y.name)} ${N}</a><a class="btn btn-glass btn-lg" href="stacks.html">Browse stacks</a></div>
      </div>
      <img class="remix-art rv" src="img/brand/remix-tree.webp" srcset="img/brand/remix-tree-900.webp 900w, img/brand/remix-tree.webp 1672w" sizes="(max-width: 1020px) 100vw, 640px" alt="One stack of blocks branching into three remixes" width="1672" height="941" loading="lazy" decoding="async">
    </div>
    <div class="lineage px rv" id="lineage">
      <div class="lin-head"><span class="pixel">How a remix works</span><span class="lin-title"><b>${r(Y.name)}</b> <span class="dim">preset, remixed three ways. Each remix changes one thing.</span></span></div>
      <div class="lin-body"></div>
      <p class="lin-note"><span class="lin-key"><i class="k-add"></i>Block added</span><span class="lin-key"><i class="k-tune"></i>Setting tuned</span><span>A remix you launch keeps a parent link on chain. Remix a coin and ${gs("Stack author")}% of your coin's fee goes to the author of the stack you forked.</span></p>
    </div>
  </div>
</section>

<section class="section own" id="own">
  <div class="wrap">
    <div class="own-head">
      <div class="section-head rv">
        <span class="eyebrow">Own</span>
        <h2>Get paid when <span class="chrome-text">your stack travels.</span></h2>
        <p class="lede">Every trade on the curve pays a ${R.tradeFeePct}% fee. Half goes to the coin's creator. When someone remixes your stack, you earn a tenth of the fee on every trade of their coin.</p>
      </div>
      <div class="own-example rv" id="ownEx"></div>
    </div>
    <div class="fee px rv" id="fee">
      <div class="fee-main">
        <div class="fee-head"><span class="pixel">The ${R.tradeFeePct}% trade fee</span><span class="pixel dim">1 cube = 1% of the fee</span></div>
        <div class="fee-cells" role="img" aria-label="${R.split.map(s=>`${s.who} ${s.pct}%`).join(", ")}">${ne()}</div>
        <div class="fee-legend">${R.split.map((s,a)=>`
          <div class="fl fl-${a}"><span class="fl-sw"></span><b class="num">${s.pct}%</b><span class="fl-who">${s.who}</span><p>${r(s.note)}</p></div>`).join("")}
        </div>
      </div>
      <div class="fee-ex" id="feeEx"></div>
    </div>
  </div>
</section>

<section class="section trending" id="trending">
  <div class="wrap">
    <div id="trend"><div class="coin-grid">${'<div class="coin-card skel"></div>'.repeat(3)}</div></div>
  </div>
</section>

<section class="section cta-band">
  <div class="wrap">
    <div class="cta px rv">
      <img class="cta-art" src="img/banner-build-remix-own.webp" srcset="img/banner-build-remix-own-1000.webp 1000w, img/banner-build-remix-own.webp 2000w" sizes="(max-width: 1240px) 100vw, 1160px" alt="BUILD. REMIX. OWN.: chrome blocks in a rack, branching into remixes" width="2000" height="667" loading="lazy" decoding="async">
      <div class="cta-body">
        <div>
          <h2>Snap the blocks.<br><span class="chrome-text">Launch in one transaction.</span></h2>
          <p class="lede">Mint, curve, stack and your first buy land together, so nobody trades before the rules are armed. Launching costs <span class="mono">${R.launchCostSol} SOL</span>.</p>
        </div>
        <div class="cta-btns"><a class="btn btn-chrome btn-lg" href="build.html">Build a coin ${N}</a><a class="btn btn-glass btn-lg" href="build.html#presets">Start from a preset</a></div>
      </div>
    </div>
  </div>
</section>`;ls();qs(document.getElementById("rack"),{preset:Y});Us(document.getElementById("flow"));Ws(document.querySelector("#lineage .lin-body"),Ns(Y,[{title:"Pay the holders",blurb:"Same launch rules, and holders share the creator fees.",change:{add:"holder-rewards"}},{title:"Tighten the launch",blurb:"Smaller first buys while the launch window is open.",change:{tune:["snipe-shield",{max:.25}]}},{title:"Stop sandwiches",blurb:"Same launch rules, and same-block flips are refused.",change:{add:"sandwich-guard"}}]));Vs(document.getElementById("ownEx"),document.getElementById("feeEx"));Zs();async function Zs(){const s=document.getElementById("trend"),a=(await bs.coins({sort:"volume"}).catch(()=>[])).filter(l=>!l.test);if(!a.length){s.innerHTML=se(),ls(s);return}const t=a.slice(0,6);s.innerHTML=`
    <div class="trend-head rv">
      <div class="section-head"><span class="eyebrow">Trending</span><h2>Moving now.</h2></div>
      <a class="btn btn-glass" href="coins.html">All coins ${N}</a>
    </div>
    <div class="coin-grid">${t.map(te).join("")}${t.length<6&&t.length%3?ee(t.length):""}</div>`,ls(s)}function se(){return`
  <div class="board-empty px rv">
    <div class="be-copy">
      <span class="eyebrow">Trending</span>
      <h2>No coins yet.</h2>
      <p class="lede">The first coin launched on hookrz leads this board. Snap up to ${z.maxSlots} blocks into a stack, tune them and launch in one transaction.</p>
      <div class="be-ctas"><a class="btn btn-chrome btn-lg" href="build.html">Build the first coin ${N}</a><a class="btn btn-glass btn-lg" href="build.html#presets">Start from a preset</a></div>
    </div>
    <div class="be-shelf" aria-hidden="true">
      ${Q.map((s,a)=>`<a class="be-slot" href="blocks.html#${s.id}" tabindex="-1" style="--i:${a}"><img src="img/brand/block-${s.id}-sm.webp" alt="" width="240" height="240" loading="lazy" decoding="async"><span class="pixel">${r(s.name)}</span></a>`).join("")}
    </div>
  </div>`}function ee(s){return`<a class="coin coin-next nr rv" style="--d:${s%3*70}ms" href="build.html">
    <span class="coin-next-cubes">${Q.slice(0,3).map(a=>O(a.id,{size:26})).join("")}</span>
    <b>Launch the next one</b>
    <span class="dim">Start from a preset or a blank rack.</span>
    <span class="fam-go">Build a coin ${N}</span>
  </a>`}function fs(s){const a=As(s,{cell:12,gap:1.6,glow:!0,title:""}),t=/viewBox="([^"]+)"/.exec(a)[1],l=(a.match(/<rect [^>]*\/>/g)??[]).map(c=>c.replace(/fill="[^"]*"/,'fill="#fff"').replace(/ style="[^"]*"/,"")).join("");return`<span class="vx-g">${a}<span class="vx-glint"><svg viewBox="${t}" xmlns="http://www.w3.org/2000/svg"><g fill-opacity=".85">${l}</g></svg></span></span>`}function ae(s,a){const t=es.filter(l=>l.family===s.id);return`<a class="fam nr rv" style="--d:${a%3*70}ms" href="blocks.html#${s.id}">
    <div class="fam-top">
      <img src="img/brand/block-${s.id}-sm.webp" alt="" width="240" height="240" loading="lazy" decoding="async">
      <div class="fam-id"><span class="pixel">${r(s.verb)}</span><h3>${r(s.name)}</h3><span class="mono dim">${ks(t.length,"block")}</span></div>
    </div>
    <p>${r(s.blurb)}</p>
    <ul class="fam-list">${t.map(l=>`<li><span class="enf ${l.enforcedBy}" title="${r(W[l.enforcedBy].long)}"><i></i></span>${r(l.name)}</li>`).join("")}</ul>
    <span class="fam-go">Open ${r(s.name)} ${N}</span>
  </a>`}function ne(){const s=[];return R.split.forEach((a,t)=>{for(let l=0;l<a.pct/5;l++)s.push(t)}),s.map((a,t)=>`<span class="fc-col g${a}" style="--c:${t}">${"<i></i>".repeat(5)}</span>`).join("")}function te(s,a){const t=s.phase==="graduated",l=Math.max(-99.9,s.change24);return`<a class="coin nr rv" style="--d:${a%3*70}ms" href="coin.html?t=${r(s.ticker)}">
    <div class="coin-top">${Cs(s,48)}
      <div class="coin-id"><b>${r(s.name)}</b><span class="mono">$${r(s.ticker)}</span></div>
      <span class="coin-chg num ${l>=0?"up":"down"}">${zs(l)}</span></div>
    <div class="coin-nums">
      <div><span class="pixel">Market cap</span><b class="num">${hs(s.mcapUsd)}</b></div>
      <div><span class="pixel">Vol 24h</span><b class="num">${hs(s.vol24Usd)}</b></div>
      <div><span class="pixel">Holders</span><b class="num">${Ys(s.holders)}</b></div>
    </div>
    <div class="coin-curve${t?" grad":""}"><div class="bar"><i style="width:${Math.max(2,s.progress*100).toFixed(1)}%"></i></div>
      <span class="pixel">${t?"Graduated · DAMM v2":`Curve ${Math.round(s.progress*100)}%`}</span></div>
    <div class="coin-foot">
      <span class="coin-stack" title="${s.stack.length} blocks">${s.stack.map(c=>O(le(c.id),{size:22})).join("")}</span>
      ${s.parent?`<span class="chip ice">${I.remix}Remix of $${r(s.parent)}</span>`:'<span class="chip">Original</span>'}
    </div>
  </a>`}function le(s){var a;return((a=j[s])==null?void 0:a.family)??"custom"}function ls(s=document){var l;const a=[...s.querySelectorAll(".rv:not(.in)")];if(s!==document&&((l=s.classList)!=null&&l.contains("rv"))&&a.push(s),matchMedia("(prefers-reduced-motion: reduce)").matches||navigator.webdriver||!("IntersectionObserver"in window)){a.forEach(c=>c.classList.add("in")),navigator.webdriver&&document.querySelectorAll("img[loading=lazy]").forEach(c=>{c.loading="eager"});return}ts??(ts=new IntersectionObserver(c=>{for(const m of c)m.isIntersecting&&(m.target.classList.add("in"),ts.unobserve(m.target))},{rootMargin:"0px 0px -6% 0px",threshold:.06})),a.forEach(c=>ts.observe(c)),document.documentElement.classList.add("rv-on")}
