import{j as E,b as S,E as et,I as H,e as f,v as Jt,f as Xt,k as Ct,B as Nt,c as O,n as vs,h as Lt,P as ft,F as lt,r as gs,A as Ht,o as Q,p as V,S as ct,s as tt,u as ks,w as Ot,x as yt,i as st,y as ys,C as ws,g as xs,l as Ss,z as zt,D as Ls,m as Ts,t as K,d as Qt,G as Ms,H as Bs,q as Pt}from"./format-CV8hyfGB.js";import{a as xt}from"./avatar-20bCAp64.js";import{E as Es,e as As,l as Cs,w as Ps,S as Rs,s as Os,n as js,r as Hs,u as Is}from"./hs-editor-B29iFqIk.js";const St=t=>String(t).padStart(2,"0"),Wt='<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>',ts='<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 2v10M2 7h10"/></svg>';function Et(t){return[t.enforcedBy,t.also].filter(Boolean).map(s=>`<span class="enf ${s}" title="${f(et[s].long)}"><i></i>${et[s].name}</span>`).join("")}const Fs={none:"Stateless",global:"Global, in the Stack slot",wallet:"Per wallet, in a Wallet record"},Us={any:"Every route",record:"hookrz router + aggregators once a wallet record exists"},ss=(t,s=!1)=>vs(`img/brand/block-${t}${s?"":"-sm"}.webp`),es=t=>{try{return S[t.id].summary(t.params)}catch{return""}};function Ds(t){var e;const s=t.stack.map(n=>n.id).join(","),a=(e=ft.find(n=>n.slots.map(d=>d[0]).join(",")===s))==null?void 0:e.id;return`
  <div class="b-title">
    <span class="eyebrow">Build a coin</span>
    <h1><span class="chrome-text">Snap the rules in.</span></h1>
    <p class="lede">Up to six blocks in one stack. A single audited program, <span class="mono">hookrz_engine</span>, runs the whole stack on every transfer and refuses what your rules refuse.</p>
  </div>
  <div class="presets" id="presets">
    <div class="presets-head"><span class="pixel">Presets</span><span class="dim">Start from a proven stack, then tune it.</span></div>
    <div class="presets-row" role="list">
      ${ft.map(n=>`<button class="preset${a===n.id?" on":""}" role="listitem" data-act="preset" data-id="${n.id}" data-fk="preset-${n.id}" aria-pressed="${a===n.id}">
        <span class="preset-cubes">${n.slots.map(([d])=>O(S[d].family,{size:18})).join("")}</span>
        <b>${n.name}</b><span class="preset-blurb">${n.blurb}</span>
        <span class="preset-n mono">${n.slots.length} blocks${a===n.id?" · loaded":""}</span>
      </button>`).join("")}
      <button class="preset empty" role="listitem" data-act="empty" data-fk="preset-empty"${!t.stack.length&&!t.parent?' aria-pressed="true"':""}>
        <span class="preset-cubes">${Array.from({length:3},()=>O("x",{size:18,state:"empty"})).join("")}</span>
        <b>Start empty</b><span class="preset-blurb">Six open slots. Pick every block yourself.</span>
        <span class="preset-n mono">0 blocks</span>
      </button>
    </div>
  </div>`}function qs(t,s){if(!t.parent)return"";const a=t.parent,e=s.diff,n=[...e.added.map($=>`<span class="dchip add">+ ${S[$].name}</span>`),...e.removed.map($=>`<span class="dchip rm">− ${S[$].name}</span>`),...e.tuned.map($=>`<span class="dchip tune">~ ${S[$].name}</span>`)],d=a.stack.map($=>$.id).join(","),p=t.stack.map($=>$.id).join(","),u=!n.length&&d!==p;return`<div class="remix-bar">
    <div class="rb-who">
      ${xt(a.coin??{ticker:a.ticker},42)}
      <div class="rb-txt">
        <div class="rb-line"><span class="rb-ico" aria-hidden="true">${H.remix}</span>Remixing <a href="coin.html?t=${f(a.ticker)}">$${f(a.ticker)}</a> by <b>@${f(a.handle)}</b> — they earn the 10% stack royalty</div>
        <div class="rb-sub dim">The royalty is 10% of the 1% trade fee on your coin, paid to the parent stack's author, one level up only. Your coin's lineage links back to $${f(a.ticker)}.</div>
      </div>
    </div>
    <div class="rb-diff" aria-live="polite">
      <span class="pixel dim">Changes vs $${f(a.ticker)}</span>
      <div class="rb-chips">${n.length?n.join(""):u?'<span class="dchip tune">Slot order changed</span>':'<span class="dim">Same stack so far. Add, remove or tune a block to make it yours.</span>'}${n.length&&d!==p&&!e.added.length&&!e.removed.length?'<span class="dchip tune">Slot order changed</span>':""}</div>
    </div>
    <button class="btn btn-ghost btn-sm rb-leave" data-act="leaveRemix">Start from scratch</button>
  </div>`}function It(t){const s=Xt(t.fam)??Ct[0],a=Nt.filter(e=>e.family===s.id);return`
  <div class="pal-head"><span class="eyebrow">Blocks</span><span class="mono dim">${Nt.length} blocks · ${Ct.length} families</span></div>
  <div class="pal-tabs" role="tablist" aria-label="Block families">
    ${Ct.map(e=>{const n=e.id===s.id,d=t.stack.filter(p=>S[p.id].family===e.id).length;return`<button role="tab" id="tab-${e.id}" aria-selected="${n}" aria-controls="pal-list" tabindex="${n?0:-1}" data-act="fam" data-fam="${e.id}" data-fk="tab-${e.id}">
        ${O(e.id,{size:22,state:n?"lit":""})}<span class="t-name">${e.name}</span>${d?`<span class="t-in mono" title="${d} in your stack">${d}</span>`:""}</button>`}).join("")}
  </div>
  <div class="pal-fam"><b>${s.verb}.</b> ${s.blurb}</div>
  <div class="pal-list" id="pal-list" role="tabpanel" aria-labelledby="tab-${s.id}">
    ${a.map(e=>{const n=t.stack.findIndex(p=>p.id===e.id),d=n<0&&t.stack.length>=E.maxSlots;return`<div class="pb${n>=0?" in":""}${d?" full":""}" draggable="${n<0}" data-drag-block="${e.id}">
        <button class="pb-main" data-act="${n>=0?"sel":"add"}" data-id="${e.id}" data-uid="${n>=0?t.stack[n].uid:""}" data-fk="pb-${e.id}"
          aria-label="${n>=0?`${e.name}: in slot ${n+1}. Select it.`:`Add ${e.name} to the stack.`} ${f(e.tagline)}">
          ${O(e.family,{size:40})}
          <span class="pb-txt">
            <span class="pb-name">${e.name}${e.unreviewed?' <span class="chip warnc">Unreviewed</span>':""}${e.risk?' <span class="chip refuse">Risk</span>':""}</span>
            <span class="pb-tag">${f(e.tagline)}</span>
            <span class="pb-meta">${Et(e)}${e.cu?`<span class="mono">${(e.cu/1e3).toFixed(1)}K CU</span>`:""}${e.route==="record"?'<span class="mono">record</span>':""}</span>
          </span>
          <span class="pb-add" aria-hidden="true">${n>=0?`<span class="pixel">Slot ${n+1}</span>`:ts}</span>
        </button>
      </div>`}).join("")}
  </div>
  <p class="pal-hint">Click a block or drag it onto a slot. Drag a slot back here to take it out.</p>`}function as(t,s){const a=t.stack.length,e=s.diff,n=Array.from({length:E.maxSlots},(d,p)=>{const u=t.stack[p];if(!u){const w=p===a;return`<li class="bay empty${w?" next":""}" data-bay="${p}">
        <span class="bay-num pixel">${St(p+1)}</span>
        ${w?`<button class="bay-main" data-act="toPal" data-fk="bay-next" aria-label="Slot ${p+1} is empty. Pick a block from the palette.">`:'<span class="bay-main">'}
          <span class="bay-cell"><span class="bay-plus">${ts}</span></span>
          <span class="bay-info"><span class="bay-name">Empty slot</span><span class="bay-sum mono">${w?a?"Drop a block here":"Add your first block":"Open"}</span></span>
        ${w?"</button>":"</span>"}
      </li>`}const $=S[u.id],x=u.uid===t.sel,i=es(u),b=e?e.added.includes(u.id)?'<span class="bay-tag add">New</span>':e.tuned.includes(u.id)?'<span class="bay-tag tune">Tuned</span>':"":"";return`<li class="bay filled f-${$.family}${x?" sel":""}" data-bay="${p}" data-drag-slot="${u.uid}" draggable="true">
      <span class="bay-num pixel">${St(p+1)}</span>
      <button class="bay-main" data-act="sel" data-uid="${u.uid}" data-fk="bay-${u.uid}" aria-pressed="${x}"
        aria-label="Slot ${p+1}: ${f($.name)}, ${f(i)}. Enforced by ${et[$.enforcedBy].name}.${x?" Selected.":" Select to tune."}">
        <span class="bay-cell"><img class="bay-cube" src="${ss($.family)}" alt="" draggable="false" width="240" height="240"></span>
        <span class="bay-info">
          <span class="bay-name">${$.name}</span>
          <span class="bay-sum mono">${f(i)}</span>
          <span class="bay-enf">${Et($)}</span>
        </span>
      </button>
      ${b}
      <span class="bay-ctl">
        <button class="bay-btn" data-act="mv" data-uid="${u.uid}" data-d="-1" data-fk="mvl-${u.uid}" ${p===0?"disabled":""} aria-label="Move ${f($.name)} to slot ${p}">${Wt}</button>
        <button class="bay-btn fwd" data-act="mv" data-uid="${u.uid}" data-d="1" data-fk="mvr-${u.uid}" ${p===a-1?"disabled":""} aria-label="Move ${f($.name)} to slot ${p+2}">${Wt}</button>
        <button class="bay-btn rm" data-act="rm" data-uid="${u.uid}" data-fk="rm-${u.uid}" aria-label="Remove ${f($.name)}">${H.stop}</button>
      </span>
    </li>`}).join("");return`
  <div class="rack-top">
    <div class="rack-label">${Jt("STACK",{cell:3,gap:.5,depth:.34,glow:!1})}<span class="rack-count mono"><b>${a}</b>/${E.maxSlots} slots</span></div>
    <div class="rack-tools">
      <button class="btn btn-ghost btn-sm" data-act="undo" data-fk="undo" ${t.hist.length?"":"disabled"} title="Undo (Ctrl+Z)">Undo</button>
      <button class="btn btn-ghost btn-sm" data-act="empty" data-fk="clear" ${a||t.parent?"":"disabled"}>Clear</button>
    </div>
  </div>
  <div class="rack${a?"":" is-empty"}">
    <span class="rack-plug in" aria-hidden="true"></span><span class="rack-plug out" aria-hidden="true"></span>
    <ol class="bays" aria-label="Stack slots, in the order the engine runs them">${n}</ol>
    <span class="cable" aria-hidden="true"><i></i></span>
  </div>
  <p class="rack-note"><b>Slot order is run order.</b> On every transfer the engine runs the blocks from slot 01 to ${St(E.maxSlots)} and stops at the first refusal; that block's error code is what the trader's wallet shows. Put the refusals that fire most often first.<span class="sr"> With a slot focused, arrow keys move between slots, Shift and an arrow key reorders, Delete removes.</span></p>`}function Ns(t,s){var i;const a=t.stack.findIndex(b=>b.uid===t.sel),e=t.stack[a];if(!e)return`<div class="ed-empty">
      <div class="ed-empty-cubes">${O("x",{size:34,state:"empty"})}${O("x",{size:34,state:"empty"})}${O("x",{size:34,state:"empty"})}</div>
      <div><h3>${t.stack.length?"Select a slot to tune it":"Your rack is empty"}</h3>
      <p class="muted">${t.stack.length?"Every block's parameters, error code, compute cost and enforcer show here.":"Load a preset above or add blocks from the palette. Each block you add opens here, ready to tune."}</p></div>
    </div>`;const n=S[e.id],d=Xt(n.family),p=(i=t.parent)==null?void 0:i.stack.find(b=>b.id===e.id),u=p&&JSON.stringify(p.params)!==JSON.stringify(e.params),$=n.id==="custom",x=n.params.filter(b=>!b.text).map(b=>zs(e,b,p)).join("");return`
  <div class="ed-head">
    <span class="ed-cube"><img src="${ss(n.family)}" alt="" width="240" height="240"></span>
    <div class="ed-title">
      <div class="ed-kicker pixel">${d.name} · Slot ${St(a+1)}${p?` · <span class="${u?"ice":""}">${u?`tuned vs $${f(t.parent.ticker)}`:`same as $${f(t.parent.ticker)}`}</span>`:t.parent?` · <span class="ice">new vs $${f(t.parent.ticker)}</span>`:""}</div>
      <h3>${n.name}</h3>
      <p class="muted">${f(n.tagline)}</p>
    </div>
    <div class="ed-tools">
      ${u?`<button class="btn btn-ghost btn-sm" data-act="parentParams" data-uid="${e.uid}" data-fk="ed-parent">Use $${f(t.parent.ticker)} values</button>`:""}
      ${n.params.some(b=>!b.text)?`<button class="btn btn-ghost btn-sm" data-act="reset" data-uid="${e.uid}" data-fk="ed-reset">Defaults</button>`:""}
      <button class="btn btn-glass btn-sm" data-act="rm" data-uid="${e.uid}" data-fk="ed-rm">Remove</button>
    </div>
  </div>
  <div class="ed-body${$?" custom":""}">
    <div class="ed-params">
      ${$?Ws(t,e):`<div class="ed-sub pixel">Parameters</div>${x||`<p class="muted ed-none">No settings. ${n.name} works as is.</p>`}`}
    </div>
    <div class="ed-spec">
      <div class="ed-sub pixel">What it refuses</div>
      <p class="ed-refuses">${f(n.refuses)}</p>
      ${n.error&&n.code!=null?`<div class="ed-err"><span class="ed-err-k pixel">The trader sees</span><span class="chip refuse mono">${Lt(n.code)}</span><span class="ed-err-msg" data-errmsg>${f(n.error(e.params,{}))}</span></div>`:""}
      <dl class="facts">
        <div><dt>Enforcer</dt><dd>${Et(n)}</dd></div>
        <div><dt>Error code</dt><dd class="mono">${Lt(n.code)}</dd></div>
        <div><dt>Compute</dt><dd class="mono">${n.cu?`${n.cu.toLocaleString("en-US")} CU`:"0 CU · off the transfer path"}</dd></div>
        <div><dt>Extra accounts</dt><dd class="mono">${n.accts}</dd></div>
        <div><dt>State</dt><dd>${Fs[n.state]}</dd></div>
        <div><dt>Route</dt><dd>${Us[n.route]}</dd></div>
      </dl>
      <p class="ed-enf"><span class="enf ${n.enforcedBy}"><i></i></span>${et[n.enforcedBy].long}.${n.also?` ${et[n.also].long}.`:""}${n.enforcedBy==="hook"?" Retires at graduation, when the pool removes the hook.":n.enforcedBy==="crank"||n.also==="crank"?" Keeps running after graduation.":""}</p>
    </div>
  </div>`}function zs(t,s,a){const e=t.params[s.key],n=`p-${t.uid}-${s.key}`,d=a==null?void 0:a.params[s.key],p=a?`<span class="prm-parent${d!==e?" diff":""}">parent ${s.fmt?f(s.fmt(d)):f(d)}</span>`:"";if(s.options)return`<div class="prm"><div class="prm-top"><label for="${n}">${s.label}</label>${p}</div>
      <select class="input" id="${n}" data-p="${s.key}" data-uid="${t.uid}" data-fk="${s.key}">${s.options.map($=>`<option${$===e?" selected":""}>${f($)}</option>`).join("")}</select></div>`;const u=(e-s.min)/(s.max-s.min)*100;return`<div class="prm">
    <div class="prm-top"><label for="${n}">${s.label}</label><output class="mono" for="${n}" data-pv="${s.key}">${f(s.fmt?s.fmt(e):e)}</output></div>
    <input type="range" class="rng" id="${n}" min="${s.min}" max="${s.max}" step="${s.step}" value="${e}" data-p="${s.key}" data-uid="${t.uid}" data-fk="${s.key}" aria-valuetext="${f(s.fmt?s.fmt(e):e)}" style="--fill:${u}%">
    <div class="prm-scale mono"><span>${f(s.fmt?s.fmt(s.min):s.min)}</span>${p}<span>${f(s.fmt?s.fmt(s.max):s.max)}</span></div>
  </div>`}function Ws(t,s){const a=t.drafting[s.uid],e=t.draftErr[s.uid],n=s.draft,d=n&&n.prompt&&n.prompt!==(s.params.prompt??"").trim();return`<div class="hs">
    <div class="ed-sub pixel">Your rule, in English</div>
    <textarea class="input hs-in" id="hs-${s.uid}" rows="3" maxlength="280" data-p="prompt" data-uid="${s.uid}" data-fk="hs-prompt" aria-label="Describe your rule in English">${f(s.params.prompt??"")}</textarea>
    <div class="hs-ex"><span class="dim">Try</span>${Es.map((p,u)=>`<button class="hs-chip" data-act="example" data-text="${f(p.text)}" data-fk="ex-${u}" title="${f(p.text)}">${f(p.label)}</button>`).join("")}</div>
    <div class="hs-go">
      <button class="btn btn-chrome btn-sm" data-act="draft" data-uid="${s.uid}" data-fk="hs-draft" ${a?"disabled":""}>${a?'<span class="spin" aria-hidden="true"></span>Drafting, fuzzing, checking…':n?"Draft again":"Draft Hookscript"}</button>
      ${n?"":`<button class="btn btn-ghost btn-sm" data-act="write" data-uid="${s.uid}" data-fk="hs-write">Write it myself</button>`}
      <span class="hs-stale chip warnc" ${d?"":"hidden"} title="The Hookscript below is what launches">Rule text changed since this draft</span>
    </div>
    ${e?typeof e=="string"?`<p class="hs-err" role="alert">${f(e)}</p>`:`<div class="hs-declined${e.honeypot?" hp":""}" role="alert"><p><b>${e.honeypot?"Not allowed: holders must always be able to sell eventually.":"Not drafted."}</b> ${f(e.text)}</p>
        ${e.options.length?`<div class="hs-ex"><span class="dim">${e.honeypot?"Safe version":"Closest rules"}</span>${e.options.map((p,u)=>`<button class="hs-chip" data-act="example" data-text="${f(p.text)}" data-fk="alt-${u}" title="${f(p.text)}">${f(p.label)}</button>`).join("")}</div>`:""}
        ${e.honeypot?'<p class="dim">Or write it in Hookscript yourself.</p>':""}</div>`:""}
    ${a&&!n?'<div class="hs-out hs-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>':""}
    ${n?`<div class="${a?"hs-busy":""}">${As(n,s.uid)}</div>
      <p class="hs-note-2">Edit the Hookscript directly: it compiles as you type, then it's fuzzed against generated trades and checked for honeypots. It launches only if every holder can always sell eventually. The coin page shows the Unreviewed badge until a hookrz reviewer signs off.</p>`:""}
  </div>`}function Ys(t){const s=[];t.stack.length||s.push({level:"need",text:"Add at least one block. hookrz coins launch with a stack."});for(const a of t.stack){if(a.id!=="custom")continue;const e=Cs(a.draft);e&&s.push({...e,id:a.id})}return s}const Gs={error:"Blocks launch",need:"Needed",risk:"Risk",warn:"Heads up",info:"Note"};function ns(t,s){const{b:a,warnings:e}=s,n=t.stack.map(v=>S[v.id]).filter(v=>v.enforcedBy==="hook"),d=e.filter(v=>v.level==="error"||v.level==="need"),p=t.stack.length?d.length?["bad",`${d.length} to fix`]:["ok","Ready to launch"]:["idle","Empty rack"],u=v=>v/E.cuBudget*100,$=a.cu>E.cuBudget,x=a.hasHook?[`<i class="seg base" style="width:${u(E.cuBase)}%" title="Dispatch and account checks: ${E.cuBase.toLocaleString("en-US")} CU"></i>`,...n.map(v=>`<i class="seg" style="width:${u(v.cu)}%" title="${f(v.name)}: ${v.cu.toLocaleString("en-US")} CU"></i>`)].join(""):"",i=Array.from({length:a.maxAccounts},(v,T)=>`<i class="${T<a.accounts.length?"on":""}${T===0&&a.accounts.length?" stack":""}"></i>`).join(""),b=gs(E.walletRecordBytes),w=t.parent,F=t.stack.map(v=>S[v.id]),M=F.filter(v=>v.enforcedBy==="hook"),R=F.filter(v=>v.enforcedBy==="crank"||v.also==="crank"),k=F.filter(v=>v.enforcedBy==="curve"||v.enforcedBy==="ext"),Y=v=>v.length?v.map(T=>O(T.family,{size:18,title:T.name})).join(""):'<span class="dim">none</span>',pt=w?`@${f(w.handle)}`:"You",G=w?`author of $${f(w.ticker)}'s stack`:"original stack: you keep it";return`<div class="bud-in">
  <div class="bud-head"><span class="eyebrow">Budget</span><span class="bud-status ${p[0]}" role="status">${p[0]==="ok"?'<i class="dot"></i>':p[0]==="bad"?'<i class="dot refuse"></i>':""}${p[1]}</span></div>

  <div class="mt">
    <div class="mt-top"><span>Compute per transfer</span><span class="mono"><b class="${$?"bad":""}">${a.cu.toLocaleString("en-US")}</b> / ${E.cuBudget.toLocaleString("en-US")} CU</span></div>
    <div class="mt-bar${$?" over":""}" role="meter" aria-label="Compute units per transfer" aria-valuemin="0" aria-valuemax="${E.cuBudget}" aria-valuenow="${a.cu}">${x}</div>
    <div class="mt-foot mono">${a.hasHook?`dispatch ${E.cuBase.toLocaleString("en-US")} + ${n.length} hook block${n.length===1?"":"s"} · on top of the swap`:"No hook blocks: no transfer hook, 0 CU"}</div>
  </div>

  <div class="mt">
    <div class="mt-top"><span>Extra accounts</span><span class="mono"><b>${a.accounts.length}</b> / ${a.maxAccounts}</span></div>
    <div class="pips" role="meter" aria-label="Extra accounts" aria-valuemin="0" aria-valuemax="${a.maxAccounts}" aria-valuenow="${a.accounts.length}">${i}</div>
    ${a.accounts.length?`<details class="mt-more"><summary>ExtraAccountMetaList</summary><ol>${a.accounts.map(v=>`<li>${f(v.label)}</li>`).join("")}</ol></details>`:'<div class="mt-foot">Nothing for wallets or aggregators to resolve.</div>'}
  </div>

  <dl class="kv">
    <div><dt>Rent at launch</dt><dd><b class="mono">${a.rentSol?`${a.rentSol.toFixed(4)} SOL`:"0 SOL"}</b><span>${a.hasHook?`Stack PDA (${E.stackBytes} B) + ExtraAccountMetaList`:"No Stack account needed"}</span></dd></div>
    <div><dt>Wallet records</dt><dd>${a.walletRecordRentSol?`<b class="mono">~${b.toFixed(4)} SOL</b><span>per new holder, refunded after graduation. The hookrz router opens it inside the buy.</span>`:"<b>Not needed</b><span>No block keeps per-wallet state.</span>"}</dd></div>
    <div><dt>Route</dt><dd>${a.route==="any"?"<b>Every route</b><span>Jupiter and other aggregators can trade it from the first block.</span>":"<b>hookrz router + aggregators once a wallet record exists</b><span>A new holder's first buy goes through the hookrz router.</span>"}</dd></div>
    <div><dt>Enforcers</dt><dd class="enfs">${a.enforcers.length?a.enforcers.map(v=>`<span class="enf ${v}" title="${f(et[v].long)}"><i></i>${et[v].name}</span>`).join(""):'<span class="dim">none yet</span>'}</dd></div>
  </dl>

  ${e.length?`<ul class="warns" aria-label="Warnings">${e.map(v=>`<li class="w ${v.level}">
    <span class="w-k pixel">${Gs[v.level]}</span><span class="w-t">${f(v.text)}</span>${v.id?`<button class="w-go" data-act="selWarn" data-id="${v.id}">Open</button>`:""}</li>`).join("")}</ul>`:""}

  <div class="life">
    <div class="sub pixel">Lifetime</div>
    <ol class="life-line">
      <li><span class="life-k">On the curve</span><span class="life-c">${Y(M)}</span><span class="life-t">Hook blocks refuse transfers from the first trade.</span></li>
      <li class="grad"><span class="life-k">Graduation</span><span class="life-t">The DBC pool removes the hook in the graduating swap and the coin migrates to DAMM v2. Hook blocks retire.</span></li>
      <li><span class="life-k">After</span><span class="life-c">${Y(R)}</span><span class="life-t">Crank blocks keep running on LP fees.</span></li>
    </ol>
    ${k.length?`<div class="life-fixed"><span class="life-c">${Y(k)}</span><span>Set at launch in the curve config or the mint. Nothing to run.</span></div>`:""}
  </div>

  <div class="fees">
    <div class="sub pixel">Fee split · ${lt.tradeFeePct}% of every trade</div>
    <div class="fee-bar" aria-hidden="true">${lt.split.map((v,T)=>`<i class="f${T}${T===2?" roy":""}" style="width:${v.pct}%"></i>`).join("")}</div>
    <ul class="fee-rows">
      ${lt.split.map((v,T)=>{const N=T===0?"You":T===1?"hookrz":pt,z=T===0?"Claimed from the DBC pool":T===1?"Engine audits, keeper gas, the API":G;return`<li class="${T===2?"roy":""}${T===0||T===2&&!w?" you":""}"><i class="sw f${T}"></i><span class="fr-who">${v.who}<span>${z}</span></span><span class="fr-to">${N}</span><span class="fr-pct mono">${v.pct}%<span>${(lt.tradeFeePct*v.pct/100).toFixed(2)}% of volume</span></span></li>`}).join("")}
    </ul>
  </div>

  <div class="bud-go">
    <button class="btn btn-glass btn-sm" data-act="toSim">Simulate launch</button>
    <button class="btn btn-chrome btn-sm" data-act="toLaunch" ${s.ok?"":"disabled"}>Launch <svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8h11M9 4l4 4-4 4"/></svg></button>
  </div></div>`}const At=Object.values(Ht).reduce((t,s)=>t+s.n,0),_s={sniper:"Buy 0.8–3 SOL in the first three seconds, dump within ten minutes.",bundler:"Seventeen wallets buy in one slot, consolidate, then sell from one.",sandwich:"Buy and sell around other trades, ten round trips each.",whale:"Buy 6–14 SOL twice, sell everything hours later.",flipper:"Buy, then sell within twenty minutes. Retry smaller if refused.",paper:"Buy small, sell within one to two hours.",believer:"Buy one to three times across six hours and mostly hold.",creator:"Buys 1 SOL at launch, tries to sell it all 45–75 minutes in."},is={sniper:"Sniper",bundler:"Bundle wallet",sandwich:"Sandwich bot",whale:"Whale",flipper:"Flipper",paper:"Paper hands",believer:"Believer",creator:"Creator"},os={refuse:"bot",warn:"fast",ice:"hold"},j=(t,s=1)=>`${(t*100).toFixed(s)}%`,Yt=t=>`${t>0?"+":""}${V(t)}`;function rs(t,s,a,e){return`<div class="sec-num" aria-hidden="true">${Jt(t,{cell:5,gap:.8,depth:.36,glow:!0})}</div>
    <div class="sec-txt"><span class="eyebrow">${s}</span><h2>${a}</h2><p class="lede">${e}</p></div>`}function Vs(t,s){const{res:a,busy:e,seed:n,err:d}=t.sim,p=a&&t.sim.sig!==s;return`
  <div class="sec-head">
    ${rs("02","Simulation","Simulate launch",`Run the stack against a seeded crowd of ${At} wallets for the first six hours. The same crowd trades the same curve with no rules, side by side. Every transfer goes through the engine's reference code.`)}
    ${a?`<div class="sim-ctl">
      <span class="crowd-id"><span class="pixel">Crowd</span><b class="mono">#${String(n).padStart(4,"0")}</b></span>
      <button class="btn btn-glass" data-act="crowd" data-fk="sim-crowd" ${e?"disabled":""} title="Same stack, a different seeded crowd">New crowd</button>
      <button class="btn btn-chrome" data-act="sim" data-fk="sim-run" ${e?"disabled":""}>${e?'<span class="spin" aria-hidden="true"></span>Running…':"Run again"}${e?"":H.arrow}</button>
    </div>`:""}
  </div>
  ${d?`<p class="sim-err" role="alert">${f(d)}</p>`:""}
  <div class="sim-body${e?" busy":""}" aria-busy="${!!e}">
    ${a?Zs(t,a,p):Ks(t,e)}
  </div>`}function Ks(t,s){return`<div class="sim-empty panel">
    <div class="se-top">
      <div><div class="sub pixel">The crowd · #${String(t.sim.seed).padStart(4,"0")}</div><p class="muted">${At} wallets, eight kinds of trader, six hours from the first block. Bots hit the first seconds; holders arrive all day.</p></div>
      <button class="btn btn-chrome btn-lg" data-act="sim" data-fk="sim-run2" ${s||!t.stack.length?"disabled":""}>${s?'<span class="spin" aria-hidden="true"></span>Running…':`Simulate launch ${H.arrow}`}</button>
    </div>
    ${t.stack.length?"":'<p class="se-need">Add blocks to the rack first; then see what they refuse.</p>'}
    <ul class="crowd">${Object.entries(Ht).map(([a,e])=>`<li class="cw ${os[e.color]}"><b class="mono">${e.n}</b><span class="cw-n">${e.name}</span><span class="cw-d">${_s[a]}</span></li>`).join("")}</ul>
  </div>`}function Zs(t,s,a){const e=s.withStack,n=s.noRules,d=e.landed+e.refused;return`
  <div class="sim-meta">
    <span>${At} wallets · ${e.hours}h · same crowd both runs</span>
    <span><b class="mono">${Q(d)}</b> transfers tried · <b class="mono">${Q(e.landed)}</b> landed · <b class="mono bad">${Q(e.refused)}</b> refused</span>
    <span class="stale" data-stale ${a?"":"hidden"}>Stack changed since this run. <button class="link" data-act="sim">Run again</button></span>
  </div>
  <div class="kpis">${Js(e,n)}</div>
  <div class="sim-grid">
    <div class="panel card chart-card">
      <div class="card-h"><span class="pixel">Market cap, SOL · first 6 hours</span>
        <span class="legend"><span class="lg you"><i></i>Your stack</span><span class="lg none"><i></i>No rules</span><span class="lg rf"><i></i>Refused transfer</span></span></div>
      <div class="chart" data-chart role="img" aria-label="Market cap in SOL over six hours. Your stack ends at ${V(e.endPrice*ct)}, no rules ends at ${V(n.endPrice*ct)}."></div>
    </div>
    <div class="panel card">
      <div class="card-h"><span class="pixel">Refusals by block</span><span class="mono dim">${Q(e.refused)} of ${Q(d)} · ${d?j(e.refused/d):"0%"}</span></div>
      ${Qs(t,e)}
    </div>
  </div>
  <div class="sim-grid two">
    <div class="panel card">
      <div class="card-h"><span class="pixel">The crowd, trader by trader</span><span class="mono dim">your stack · no rules</span></div>
      ${ee(e,n)}
    </div>
    <div class="panel card">
      <div class="card-h"><span class="pixel">Refused transfers · sample</span><span class="mono dim">what each wallet saw</span></div>
      ${ae(e)}
    </div>
  </div>`}function Js(t,s){return[{k:"Bot trades landed",you:`${t.botLanded}<small>/${t.botAttempts}</small>`,none:`${s.botLanded}/${s.botAttempts}`,va:t.botLanded,vz:s.botLanded,lower:!0,d:Xs(t.botLanded,s.botLanded)},{k:"Bot PnL",you:Yt(t.botPnl),none:Yt(s.botPnl),va:t.botPnl,vz:s.botPnl,lower:!0,signed:!0,d:t.botPnl<s.botPnl?`${V(s.botPnl-t.botPnl).replace(" SOL","")} SOL less`:t.botPnl>s.botPnl?`${V(t.botPnl-s.botPnl).replace(" SOL","")} SOL more`:"same"},{k:"Top-10 holder share",you:j(t.top10),none:j(s.top10),va:t.top10,vz:s.top10,lower:!0,d:Rt(t.top10,s.top10)},{k:"Max drawdown",you:j(t.maxDrawdown),none:j(s.maxDrawdown),va:t.maxDrawdown,vz:s.maxDrawdown,lower:!0,d:Rt(t.maxDrawdown,s.maxDrawdown)},{k:t.graduated?"Graduated at":"Curve progress",you:t.graduated?tt(t.gradT):j(t.progress),none:s.graduated?`grad. ${tt(s.gradT)}`:j(s.progress),va:t.graduated?1:t.progress,vz:s.graduated?1:s.progress,lower:!1,d:t.graduated&&!s.graduated?"graduated":Rt(t.progress,s.progress)},{k:"Fees burned",you:V(t.burnedSol),none:V(s.burnedSol),va:t.burnedSol,vz:s.burnedSol,lower:!1,d:t.burnedSol===s.burnedSol?"same":`${t.burnedSol>s.burnedSol?"+":"−"}${Math.abs(t.burnedSol-s.burnedSol).toFixed(2)} SOL`}].map(e=>{const n=Math.abs(e.va-e.vz)<1e-9,d=!n&&(e.lower?e.va<e.vz:e.va>e.vz),p=Math.max(Math.abs(e.va),Math.abs(e.vz))||1,u=$=>Math.max(1.5,Math.abs($)/p*100);return`<div class="kpi">
      <div class="kpi-k pixel">${e.k}</div>
      <div class="kpi-v mono">${e.you}</div>
      <div class="kpi-z"><span>No rules</span><b class="mono">${e.none}</b></div>
      <div class="kpi-bars" aria-hidden="true"><i class="you${e.signed&&e.va<0?" neg":""}" style="width:${u(e.va)}%"></i><i class="none${e.signed&&e.vz<0?" neg":""}" style="width:${u(e.vz)}%"></i></div>
      <div class="kpi-d ${n?"same":d?"better":"worse"}">${n?"No change":`${d?"▲":"▼"} ${e.d}`}</div>
    </div>`}).join("")}const Xs=(t,s)=>s?`${Math.round(Math.abs(1-t/s)*100)}% ${t<s?"fewer":"more"}`:t?`${t} more`:"same",Rt=(t,s)=>`${t<s?"−":"+"}${Math.abs((t-s)*100).toFixed(1)} pts`;function Qs(t,s){const a=Object.entries(s.byBlock).sort((d,p)=>p[1]-d[1]);if(!a.length)return'<p class="muted card-empty">Nothing was refused. With this crowd, every transfer passed the stack.</p>';const e=a[0][1],n=d=>t.stack.findIndex(p=>p.id===d);return`<ul class="rbars">${a.map(([d,p])=>{const u=S[d],$=n(d);return`<li><span class="rb-c">${O(u.family,{size:26,state:"refused"})}</span>
      <span class="rb-n"><b>${u.name}</b><span class="mono">${Lt(u.code)}${$>=0?` · slot ${String($+1).padStart(2,"0")}`:""}</span></span>
      <span class="rb-v mono">${Q(p)}<small>${(p/s.refused*100).toFixed(0)}%</small></span>
      <span class="rb-t"><i style="width:${p/e*100}%"></i></span></li>`}).join("")}</ul>
  ${te(s)}
  ${se(t,s)}`}function te(t){const s={buy:[0,0],sell:[0,0],send:[0,0]};for(const e of t.log){const n=s[e.kind];n&&(n[0]++,e.ok||n[1]++)}const a=t.log.find(e=>!e.ok);return`<div class="kinds">${Object.entries(s).map(([e,[n,d]])=>`<div><span class="kind ${e}">${e}s</span><b class="mono">${d}<small>/${n}</small></b><span class="lbar"><i style="width:${n?d/n*100:0}%"></i></span><span class="mono dim">${n?j(d/n,0):"—"} refused</span></div>`).join("")}</div>
  ${a?`<p class="rb-first">First refusal at <b class="mono">+${tt(a.t)}</b>: a ${is[a.type].toLowerCase()}'s ${a.kind}, by ${S[a.by].name}.</p>`:""}`}function se(t,s){const a=t.stack.map(e=>S[e.id]).filter(e=>e.check&&e.id!=="custom"&&!s.byBlock[e.id]);return a.length?`<p class="rb-idle">${a.map(e=>`<b>${e.name}</b>`).join(", ")} refused nothing with this crowd${a.length>1?"; they":"; it"} may still catch what this crowd didn't try, or an earlier slot refused first.</p>`:""}function ee(t,s){return`<div class="tscroll"><table class="table ctab">
    <thead><tr><th>Trader</th><th class="r">Wallets</th><th class="r tried">Tried</th><th class="r">Landed</th><th class="r">Refused</th><th class="bar-h">Landed share</th><th class="r">No rules</th></tr></thead>
    <tbody>${Object.entries(Ht).map(([a,e])=>{const n=t.byType[a],d=s.byType[a],p=n.attempts?n.landed/n.attempts:0;return`<tr class="${os[e.color]}"><td><span class="ct-dot"></span>${e.name}</td><td class="r mono dim">${e.n}</td><td class="r mono tried">${n.attempts}</td><td class="r mono">${n.landed}</td>
        <td class="r mono ${n.refused?"bad":"dim"}">${n.refused}</td>
        <td class="bar-c"><span class="lbar" title="${j(p,0)} landed"><i style="width:${p*100}%"></i></span><span class="mono lpct">${n.attempts?j(p,0):"—"}</span></td>
        <td class="r mono dim">${d.landed}/${d.attempts}</td></tr>`}).join("")}</tbody>
    <tfoot><tr><td>All traders</td><td class="r mono dim">${At}</td><td class="r mono tried">${t.landed+t.refused}</td><td class="r mono">${t.landed}</td><td class="r mono ${t.refused?"bad":"dim"}">${t.refused}</td>
      <td class="bar-c"><span class="lbar"><i style="width:${t.landed/Math.max(1,t.landed+t.refused)*100}%"></i></span><span class="mono lpct">${j(t.landed/Math.max(1,t.landed+t.refused),0)}</span></td><td class="r mono dim">${s.landed}/${s.landed+s.refused}</td></tr></tfoot></table></div>
  <p class="ct-note">Refused whales, flippers and paper hands come back five minutes later with half the size, up to four times, so the totals include retries. Bots don't adapt. A stack that refuses a lot can still let most holders through.</p>`}function ae(t){const s=t.log.filter(n=>!n.ok);if(!s.length)return'<p class="muted card-empty">No refused transfers to show.</p>';const a={},e=[];for(const n of s)if(a[n.by]=(a[n.by]??0)+1,a[n.by]<=2&&e.push(n),e.length>=8)break;for(const n of s){if(e.length>=8)break;e.includes(n)||e.push(n)}return e.sort((n,d)=>n.t-d.t),`<ul class="rlog">${e.map(n=>{const d=S[n.by];return`<li>
      <span class="rl-t mono">+${tt(n.t)}</span>
      <span class="rl-who"><span class="kind ${n.kind}">${n.kind}</span><span>${is[n.type]}</span></span>
      <span class="rl-by">${O(d.family,{size:18,state:"refused"})}<span>${d.name}</span><span class="mono rl-code">${Lt(d.code)}</span></span>
      <span class="rl-amt mono" title="${Q(n.amount)} tokens">${(n.amount/ct*100).toFixed(2)}%${n.kind==="buy"?`<small>${n.sol.toFixed(2)} SOL</small>`:"<small>of supply</small>"}</span>
      <span class="rl-msg">${f(n.msg)}</span>
    </li>`}).join("")}</ul>`}let rt=null;function ne(t,s){const a=t.querySelector("[data-chart]");if(rt==null||rt.disconnect(),rt=null,!a||!s.sim.res)return;const e=()=>oe(a,s.sim.res);e();let n=a.clientWidth;rt=new ResizeObserver(()=>{Math.abs(a.clientWidth-n)>2&&(n=a.clientWidth,e())}),rt.observe(a)}function ie(t,s,a=4){const e=s-t||1,n=e/a,d=10**Math.floor(Math.log10(n)),p=[1,2,2.5,5,10].map(i=>i*d).find(i=>i>=n),u=Math.floor(t/p)*p,$=Math.ceil(s/p)*p,x=[];for(let i=u;i<=$+p/2;i+=p)x.push(+i.toFixed(6));return{a:u,b:$,ticks:x}}function oe(t,s){const a=s.withStack,e=s.noRules,n=Math.max(280,t.clientWidth),d=n<560,p=d?230:290,u={l:46,r:d?12:92,t:16,b:50},$=a.hours*3600,x=o=>o*ct,i=[...a.series,...e.series].map(o=>x(o.p)),{a:b,b:w,ticks:F}=ie(Math.min(...i)*.96,Math.max(...i)*1.02),M=o=>u.l+o/$*(n-u.l-u.r),R=p-u.b,k=o=>u.t+(1-(o-b)/(w-b))*(R-u.t),Y=o=>o.map((m,g)=>`${g?"L":"M"}${M(m.t).toFixed(1)} ${k(x(m.p)).toFixed(1)}`).join(""),pt=`${Y(a.series)}L${M(a.series.at(-1).t).toFixed(1)} ${R}L${M(0)} ${R}Z`,G=R+10,v=a.log.filter(o=>!o.ok).map(o=>o.t),T=Array.from({length:a.hours+1},(o,m)=>m),N=a.series.at(-1),z=e.series.at(-1);let _=k(x(N.p)),Z=k(x(z.p));if(Math.abs(_-Z)<26){const o=(_+Z)/2;_<=Z?(_=o-13,Z=o+13):(_=o+13,Z=o-13)}const at=(o,m)=>{if(o.gradT==null)return"";const g=M(o.gradT),h=g>(u.l+n-u.r)/2,L=d?`Graduates · ${tt(o.gradT)}`:`${m==="you"?"Your stack":"No rules"} graduates · ${tt(o.gradT)}`;return`<g class="gmark ${m}"><line x1="${g}" x2="${g}" y1="${u.t}" y2="${R}"/><text x="${h?g-6:g+6}" y="${u.t+(m==="you"?10:24)}" text-anchor="${h?"end":"start"}">${L}</text></g>`},nt=o=>o>=1e3?`${+(o/1e3).toFixed(1)}K`:`${+o.toFixed(0)}`;t.innerHTML=`<svg width="${n}" height="${p}" viewBox="0 0 ${n} ${p}" class="csvg">
    <defs><linearGradient id="simArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d9bff" stop-opacity=".28"/><stop offset="1" stop-color="#4d9bff" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${F.filter(o=>o>=b&&o<=w).map(o=>`<line x1="${u.l}" x2="${n-u.r}" y1="${k(o)}" y2="${k(o)}"/><text x="${u.l-8}" y="${k(o)+3.5}" text-anchor="end">${nt(o)}</text>`).join("")}</g>
    <g class="xaxis">${T.map(o=>`<text x="${M(o*3600)}" y="${p-6}" text-anchor="${o===0?"start":o===a.hours?"end":"middle"}">${o}h</text>`).join("")}</g>
    ${at(e,"none")}${at(a,"you")}
    <path class="area" d="${pt}" fill="url(#simArea)"/>
    <path class="ln none" d="${Y(e.series)}"/>
    <path class="ln you" d="${Y(a.series)}"/>
    <g class="rug"><line class="rug-base" x1="${u.l}" x2="${n-u.r}" y1="${G+8}" y2="${G+8}"/>${v.map(o=>`<rect x="${(M(o)-.75).toFixed(1)}" y="${G}" width="1.5" height="8"/>`).join("")}</g>
    ${d?"":`<g class="endl"><circle class="you" cx="${M(N.t)}" cy="${k(x(N.p))}" r="3.5"/><circle class="none" cx="${M(z.t)}" cy="${k(x(z.p))}" r="3.5"/>
      <text class="you" x="${M(N.t)+9}" y="${_+4}">${nt(x(N.p))}<tspan x="${M(N.t)+9}" dy="12">Your stack</tspan></text>
      <text class="none" x="${M(z.t)+9}" y="${Z+4}">${nt(x(z.p))}<tspan x="${M(z.t)+9}" dy="12">No rules</tspan></text></g>`}
    <g class="hover" visibility="hidden"><line class="hx" y1="${u.t}" y2="${R}"/><circle class="you" r="4"/><circle class="none" r="4"/></g>
    <rect class="hit" x="${u.l}" y="${u.t}" width="${n-u.l-u.r}" height="${R-u.t+20}" fill="transparent"/>
  </svg><div class="tip" hidden></div>`;const it=t.querySelector("svg"),ot=it.querySelector(".hover"),W=t.querySelector(".tip"),[vt,gt]=ot.querySelectorAll("circle"),kt=ot.querySelector(".hx"),ut=(o,m)=>o.reduce((g,h)=>Math.abs(h.t-m)<Math.abs(g.t-m)?h:g,o[0]),mt=o=>{const m=it.getBoundingClientRect(),g=Math.max(0,Math.min($,(o-m.left-u.l)/(n-u.l-u.r)*$)),h=ut(a.series,g),L=ut(e.series,g),A=M(h.t);ot.setAttribute("visibility","visible"),kt.setAttribute("x1",A),kt.setAttribute("x2",A),vt.setAttribute("cx",A),vt.setAttribute("cy",k(x(h.p))),gt.setAttribute("cx",M(L.t)),gt.setAttribute("cy",k(x(L.p)));const B=v.filter(U=>Math.abs(U-h.t)<=60).length;W.hidden=!1,W.innerHTML=`<div class="tip-t mono">+${tt(h.t)}</div>
      <div class="tip-r"><i class="you"></i>Your stack<b class="mono">${V(x(h.p))}</b></div>
      <div class="tip-r"><i class="none"></i>No rules<b class="mono">${V(x(L.p))}</b></div>
      <div class="tip-r sm"><span>Curve</span><b class="mono">${j(h.prog,0)} · ${j(L.prog,0)}</b></div>
      ${B?`<div class="tip-r sm bad"><span>Refused ±1 min</span><b class="mono">${B}</b></div>`:""}`;const P=W.offsetWidth;W.style.left=`${Math.min(n-P-4,Math.max(4,A+12>n-P-10?A-P-12:A+12))}px`,W.style.top=`${u.t+6}px`},c=()=>{ot.setAttribute("visibility","hidden"),W.hidden=!0},l=it.querySelector(".hit");l.addEventListener("pointermove",o=>mt(o.clientX)),l.addEventListener("pointerdown",o=>mt(o.clientX)),l.addEventListener("pointerleave",c)}const re=["Details","Review","Sign"],le=1024*1024,Gt=1e-5,wt=t=>t?`${t.slice(0,4)}…${t.slice(-4)}`:"",ls=t=>/^https?:\/\//i.test(t)?t:`https://${t}`;function _t(t){const s={},a=t.name.trim();a?a.length>32&&(s.name="Keep the name to 32 characters."):s.name="Give your coin a name.",t.ticker?/^[A-Z0-9]{1,10}$/.test(t.ticker)||(s.ticker="Use A–Z and 0–9 only, up to 10 characters."):s.ticker="Pick a ticker.",t.desc.length>280&&(s.desc="Keep the description to 280 characters.");const e=t.x.trim(),n=t.tg.trim(),d=t.web.trim();if(e&&!/^(@?[A-Za-z0-9_]{1,15}|(https?:\/\/)?(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?)$/i.test(e)&&(s.x="Use @handle or an x.com link."),n&&!/^(@?[A-Za-z0-9_]{5,32}|(https?:\/\/)?(t|telegram)\.me\/\+?[A-Za-z0-9_-]{3,64}\/?)$/i.test(n)&&(s.tg="Use a t.me link or @group."),d)try{if(!new URL(ls(d)).hostname.includes("."))throw 0}catch{s.web="Use a full link, like https://yourcoin.xyz"}if(t.buy!==""&&t.buy!=null){const p=+t.buy;!Number.isFinite(p)||p<0?s.buy="Enter an amount in SOL.":p>50&&(s.buy="The creator buy is capped at 50 SOL.")}return s}function ce(t,s){const a=+s;if(!a)return null;const e=new ws,n=ys(t,0),d=x=>{const i=e.quoteBuy(x,n);return{kind:"buy",amount:i.out,supply:ct,t:0,slot:0,hour:new Date().getUTCHours(),progress:0,priceAfter:i.nv/i.nt,windowOpenPrice:e.price,srcBefore:0,dstAfter:i.out,isCreatorSrc:!1,isCreator:!0,w:{lots:[],lastBuySlot:null,lastSellT:null,firstT:null},slotBuys:0,hourSold:0,hasPass:!0,gateBal:1/0,blocked:!1}},p=e.quoteBuy(a,n),u=xs(t,d(a)),$={tokens:p.out,share:p.out/ct,fee:n,ok:u.ok};return u.ok||($.by=u.refusedBy,$.code=u.code,$.msg=u.message,$.max=Ss(t,d,a)),$}function de({S:t,root:s,paint:a,plain:e,sig:n,ctx:d,save:p,clearDraft:u,toast:$,onReset:x}){const i=t.launch;let b=yt,w=null,F=null,M=!1,R=!1;ks(c=>{b=c,c||(w=null),i.step===2&&!i.busy&&!i.done&&k()});function k(){a(s,Y())}function Y(){const c=d();return`<div class="sec-head">${rs("03","Launch","Launch it","One transaction creates the mint, the curve and your stack, and arms the rules before anyone else can trade. You sign; hookrz never holds a key.")}</div>
    ${i.done?Z():`
    <ol class="steps" aria-label="Launch steps">${re.map((l,o)=>`<li class="${o===i.step?"on":o<i.step?"done":""}">
      ${o<i.step?`<button class="st" data-l="go" data-to="${o}" data-fk="st-${o}">`:`<span class="st" ${o===i.step?'aria-current="step"':""}>`}<span class="st-n mono">${o<i.step?H.check:o+1}</span><span class="st-l">${l}</span>${o<i.step?"</button>":"</span>"}</li>`).join('<li class="st-sep" aria-hidden="true"></li>')}</ol>
    <div class="lp panel">${[pt,N,z][i.step](c)}</div>`}`}function pt(c){const l=i.meta,o=i.errs,m=(h,L,A,B="")=>`<div class="field${o[h]?" bad":""}"><label for="lf-${h}">${L}</label>${A}${o[h]?`<span class="ferr" id="le-${h}" role="alert">${f(o[h])}</span>`:B?`<span class="fhint">${B}</span>`:""}</div>`,g=(h,L,A="")=>`<input class="input" id="lf-${h}" data-f="${h}" data-fk="lf-${h}" value="${f(l[h])}" placeholder="${L}" ${o[h]?`aria-invalid="true" aria-describedby="le-${h}"`:""} ${A}>`;return`<div class="lp-grid">
      <div class="lp-form">
        <div class="frow">
          ${m("name","Name",g("name","Lure Two",'maxlength="32" autocomplete="off"'))}
          ${m("ticker","Ticker",`<div class="tick"><span class="mono">$</span>${g("ticker","LURE2",'maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false"')}</div>`,"A–Z and 0–9, up to 10.")}
        </div>
        ${m("desc",`Description <span class="cnt mono" data-cnt>${l.desc.length}/280</span>`,`<textarea class="input" id="lf-desc" data-f="desc" data-fk="lf-desc" rows="3" maxlength="280" placeholder="What the coin is, in a sentence or two.">${f(l.desc)}</textarea>`)}
        <div class="frow three">
          ${m("x","X",g("x","@yourcoin",'autocomplete="off" spellcheck="false"'))}
          ${m("tg","Telegram",g("tg","t.me/yourcoin",'autocomplete="off" spellcheck="false"'))}
          ${m("web","Website",g("web","https://yourcoin.xyz",'type="url" autocomplete="off" spellcheck="false"'))}
        </div>
        ${m("buy",'Creator first buy <span class="dim">(optional)</span>',`<div class="tick sol">${g("buy","0.5",'inputmode="decimal" autocomplete="off"')}<span class="mono">SOL</span></div>`)}
        <div class="buycheck" data-buycheck>${G()}</div>
      </div>
      <div class="lp-side">
        <div class="img-drop${l.image?" has":""}${o.image?" bad":""}" data-drop>
          <input type="file" id="lf-img" class="sr" accept="image/png,image/jpeg,image/gif,image/webp" data-fk="lf-img">
          ${l.image?`<img src="${f(l.image)}" alt="Your coin image">`:`<span class="img-ph">${O("custom",{size:40,state:"empty"})}<b>Coin image</b><span>PNG, JPG, GIF or WebP · up to 1 MB · shown square</span></span>`}
          <label for="lf-img" class="btn btn-glass btn-sm img-btn">${l.image?"Replace":"Upload image"}</label>
          ${l.image?'<button class="btn btn-ghost btn-sm img-x" data-l="noimg">Remove</button>':""}
        </div>
        ${o.image?`<span class="ferr" role="alert">${f(o.image)}</span>`:""}
        <div class="coin-pv" data-pv>${v(c)}</div>
      </div>
    </div>
    ${T(c)}
    <div class="lp-foot"><span class="dim">Saved on this device as you type.</span><button class="btn btn-chrome" data-l="next" data-fk="l-next" ${M?"disabled":""}>${M?'<span class="spin"></span>Checking…':`Review launch ${H.arrow}`}</button></div>`}function G(){const c=ce(e(),i.meta.buy);if(!c)return'<span class="dim">Bought in the launch transaction, after the rules are armed. Snipe Shield and Anti-Bundle exempt it; every other block checks it like any buy.</span>';const l=`${(c.tokens/1e6).toFixed(1)}M tokens · ${(c.share*100).toFixed(2)}% of supply${c.fee>1?` · ${c.fee.toFixed(0)}% launch fee`:""}`;if(c.ok)return`<span class="bc ok"><i class="dot"></i>Passes the stack · <span class="mono">${l}</span></span>`;const o=S[c.by];return`<span class="bc bad"><i class="dot refuse"></i><b>${f(o.name)}</b> would refuse this buy <span class="mono">${o.code!=null?`(error ${o.code})`:""}</span>: ${f(c.msg)}. ${c.max>.001?`Largest that passes now: <button class="link mono" data-l="maxbuy" data-v="${Math.floor(c.max*1e3)/1e3}">${(Math.floor(c.max*1e3)/1e3).toFixed(3)} SOL</button>`:"Lower it or skip the creator buy."}</span>`}function v(c){const l=i.meta,o=l.ticker||"TICKER",m=e();return`<div class="pv-top">${xt({ticker:o,image:l.image},52)}<div><b class="pv-name">${f(l.name||"Your coin")}</b><span class="mono pv-t">$${f(o)}</span></div><span class="chip ice">On the curve</span></div>
      <p class="pv-desc">${f(l.desc||"Your description shows here, on the coin page and in every list.")}</p>
      <div class="pv-stack">${m.length?m.map(g=>O(S[g.id].family,{size:22,title:S[g.id].name})).join(""):'<span class="dim">No blocks yet</span>'}<span class="mono dim">${m.length} block${m.length===1?"":"s"}${t.parent?` · remix of $${f(t.parent.ticker)}`:""}</span></div>
      ${c.ok?"":'<span class="pv-warn">Stack has issues to fix</span>'}`}function T(c){const l=c.warnings.filter(o=>o.level==="error"||o.level==="need");return l.length?`<div class="blockers" role="alert"><b>Fix the stack before you launch</b><ul>${l.map(o=>`<li>${f(o.text)}</li>`).join("")}</ul><button class="btn btn-glass btn-sm" data-act="toRack">Back to the rack</button></div>`:""}function N(c){const l=i.meta,o=Ot(e()),m=i.prep;(!m||i.prepSig!==at())&&!R&&nt();const g=+l.buy||0,h=(m==null?void 0:m.instructions)??[],L=[l.x&&["X",l.x],l.tg&&["Telegram",l.tg],l.web&&["Website",l.web]].filter(Boolean),A=m?m.rentSol+m.launchCostSol+g+Gt:0;return`<div class="lp-grid review">
      <div class="rv-main">
        <div class="rv-coin">${xt({ticker:l.ticker,image:l.image},56)}<div><b>${f(l.name)}</b> <span class="mono dim">$${f(l.ticker)}</span><p class="muted">${f(l.desc||"No description.")}</p>
          ${L.length?`<div class="rv-links">${L.map(([B,P])=>`<span><span class="dim">${B}</span> <span class="mono">${f(P)}</span></span>`).join("")}</div>`:""}</div>
          <button class="btn btn-ghost btn-sm" data-l="go" data-to="0">Edit</button></div>
        <div class="rv-sec"><div class="rv-h"><span class="pixel">Stack</span><span class="mono dim">${o.length}/${E.maxSlots} slots${t.parent?` · parent $${f(t.parent.ticker)} by @${f(t.parent.handle)}`:" · original"}</span><button class="link" data-act="toRack">Edit stack</button></div>
          <ol class="rv-stack">${o.map((B,P)=>{const U=S[B.id];return`<li><span class="mono dim">${String(P+1).padStart(2,"0")}</span>${O(U.family,{size:26})}<span class="rv-b"><b>${U.name}</b><span class="mono">${f(es(B))}</span></span><span class="rv-e">${Et(U)}</span></li>`}).join("")}</ol></div>
        <div class="rv-sec"><div class="rv-h"><span class="pixel">Launch transaction</span><span class="mono dim">${m?`${h.length} instructions · one transaction`:"Building…"}</span></div>
          ${m?`<ol class="ixs">${h.map((B,P)=>{const U=/optional/.test(B.ix)&&!g;return`<li class="${U?"skip":""}"><span class="ix-n mono">${P+1}</span><div><div class="ix-top"><span class="chip">${f(B.program)}</span><code class="mono">${f(B.ix.replace(" (optional)",""))}</code>${U?'<span class="dim ix-s">not included: no creator buy</span>':/optional/.test(B.ix)?`<span class="mono ix-s">${g} SOL</span>`:""}</div><p>${f(B.note)}</p></div></li>`}).join("")}</ol>`:'<div class="skel"><i></i><i></i><i></i><i></i></div>'}
        </div>
      </div>
      <div class="rv-side">
        ${m?`<div class="rv-card">
          <div class="mt-top"><span>Transaction size</span><span class="mono"><b>${m.txBytes.toLocaleString("en-US")}</b> / ${m.txLimit.toLocaleString("en-US")} bytes</span></div>
          <div class="mt-bar tx${m.txBytes>m.txLimit?" over":""}" role="meter" aria-label="Transaction size" aria-valuemin="0" aria-valuemax="${m.txLimit}" aria-valuenow="${m.txBytes}"><i class="seg" style="width:${Math.min(100,m.txBytes/m.txLimit*100)}%"></i></div>
          <div class="mt-foot mono">${m.txLimit-m.txBytes} bytes to spare · fits one transaction</div>
        </div>
        <div class="rv-card"><div class="sub pixel">Cost</div><dl class="cost">
          <div><dt>Stack rent</dt><dd class="mono">${m.rentSol.toFixed(4)} SOL</dd></div>
          <div><dt>Launch cost</dt><dd class="mono">${m.launchCostSol.toFixed(4)} SOL</dd></div>
          <div><dt>Creator buy</dt><dd class="mono">${g?`${g} SOL`:"—"}</dd></div>
          <div><dt>Network fee</dt><dd class="mono">~${Gt.toFixed(5)} SOL</dd></div>
          <div class="tot"><dt>Total</dt><dd class="mono">${A.toFixed(4)} SOL</dd></div></dl>
          <p class="fhint">Stack rent comes back if the Stack account is ever closed. Signers: ${m.signers.join(" + ")}.</p></div>
        <div class="rv-card"><div class="sub pixel">Fee split · ${lt.tradeFeePct}% of every trade</div>
          <ul class="mini-fees">${lt.split.map((B,P)=>`<li class="${P===2?"roy":""}"><span>${B.who}</span><span class="mono">${B.pct}%</span><span class="to">${P===0?"You":P===1?"hookrz":t.parent?`@${f(t.parent.handle)}`:"You"}</span></li>`).join("")}</ul></div>
        <div class="rv-card mint"><span class="dim">Mint address</span><span class="mono">${f(wt(m.mint))}</span></div>`:'<div class="skel tall"><i></i><i></i><i></i></div>'}
      </div>
    </div>
    ${T(c)}
    <div class="lp-foot"><button class="btn btn-ghost" data-l="go" data-to="0">Back</button><button class="btn btn-chrome" data-l="next" data-fk="l-next2" ${m&&c.ok?"":"disabled"}>Continue to sign ${H.arrow}</button></div>`}function z(c){const l=i.busy,o=i.err;return`<div class="lp-grid sign">
      <div class="sg-main">
        <div class="wbox${b?" on":""}">
          ${b?`<span class="dot"></span><div><span class="dim">Creator wallet${w?` · ${f(w.name)}`:""}</span><b class="mono">${f(b)}</b></div><button class="btn btn-ghost btn-sm" data-l="switch" data-fk="l-switch">Switch</button>`:`<span class="wb-ico">${H.lock}</span><div><b>Connect the creator wallet</b><span class="dim">Phantom, Solflare, Backpack or any Wallet Standard wallet.</span></div><button class="btn btn-chrome" data-l="connect" data-fk="l-connect">Connect wallet</button>`}
        </div>
        <div class="manifest"><div class="rv-h"><span class="pixel">Launch manifest</span><span class="mono dim">what your wallet signs</span></div>
          <pre class="mono">${f(_(b??"(connect a wallet)","(time of signing)"))}</pre></div>
      </div>
      <div class="sg-side">
        <ol class="flow">
          <li class="${l==="wallet"?"now":l==="submit"?"done":""}"><b>Sign the manifest</b><span>Your wallet signs the exact name, ticker, stack and parent above. It moves no SOL.</span></li>
          <li class="${l==="submit"?"now":""}"><b>Launch</b><span>hookrz relays the launch transaction: mint, curve, Stack and ExtraAccountMetaList${+i.meta.buy?", then your first buy":""}, in that order.</span></li>
          <li><b>Live</b><span>The coin page opens with the stack armed. Hook blocks refuse from the first trade.</span></li>
        </ol>
        ${o?`<div class="sg-err ${o.kind}" role="alert"><b>${f(o.title)}</b><span>${f(o.text)}</span>${o.kind==="nosign"?'<button class="btn btn-glass btn-sm" data-l="switch">Use another wallet</button>':""}</div>`:""}
      </div>
    </div>
    ${T(c)}
    <div class="lp-foot"><button class="btn btn-ghost" data-l="go" data-to="1" ${l?"disabled":""}>Back</button>
      <button class="btn btn-chrome btn-lg" data-l="sign" data-fk="l-sign" ${l||!c.ok?"disabled":""}>${l==="wallet"?'<span class="spin"></span>Approve in your wallet…':l==="submit"?'<span class="spin"></span>Launching…':(o==null?void 0:o.kind)==="rejected"?"Try again":b?"Sign &amp; launch":"Connect &amp; sign"}${l?"":H.arrow}</button></div>`}function _(c,l){var h;const o=i.meta,m=Ot(e());return["hookrz launch",`name: ${o.name.trim()}`,`ticker: $${o.ticker}`,`creator: ${c}`,...t.parent?[`parent: $${t.parent.ticker} (stack by @${t.parent.handle})`]:["parent: none (original stack)"],"stack:",...m.map((L,A)=>{var B,P,U;return`  ${A+1}. ${L.id} ${JSON.stringify(L.id==="custom"?{prompt:L.params.prompt,hookscript:(U=(P=(B=t.stack[A])==null?void 0:B.draft)==null?void 0:P.compile)!=null&&U.ok?`${t.stack[A].draft.compile.name??"rule"}: ${t.stack[A].draft.compile.size} bytes, ${t.stack[A].draft.compile.cu} CU worst case`:null}:L.params)}`}),...o.buy&&+o.buy?[`creator buy: ${+o.buy} SOL`]:[],...(h=i.prep)!=null&&h.mint?[`mint: ${i.prep.mint}`]:[],`issued: ${l}`].join(`
`)}function Z(){const c=i.done,l=new URL(`coin.html?t=${encodeURIComponent(c.ticker)}`,location.href).href,o=`$${c.ticker} is live on hookrz: ${c.stack.length} rule block${c.stack.length===1?"":"s"} the chain enforces on every transfer.`;return`<div class="launched panel">
      <div class="done-glow" aria-hidden="true"></div>
      <div class="done-av">${xt({ticker:c.ticker,image:c.image},96)}</div>
      <span class="eyebrow">Launched</span>
      <h2 class="chrome-text">Your coin is live</h2>
      <p class="lede"><b>${f(c.name)}</b> <span class="mono">$${f(c.ticker)}</span> is on the curve with ${c.stack.length} block${c.stack.length===1?"":"s"} armed${c.parent?`, remixed from $${f(c.parent)}`:""}.</p>
      <div class="done-stack">${c.stack.map(m=>O(S[m.id].family,{size:30,state:"lit",title:S[m.id].name})).join("")}</div>
      <dl class="done-kv"><div><dt>Mint</dt><dd class="mono">${f(wt(c.mint))}</dd></div><div><dt>Signature</dt><dd class="mono">${f(wt(c.signature))}</dd></div><div><dt>Creator</dt><dd class="mono">${f(wt(c.creator))}</dd></div></dl>
      <div class="done-go">
        <a class="btn btn-chrome btn-lg" href="coin.html?t=${encodeURIComponent(c.ticker)}">Open $${f(c.ticker)} ${H.arrow}</a>
        <button class="btn btn-glass btn-lg" data-l="copy" data-link="${f(l)}">${H.copy} Copy link</button>
        <a class="btn btn-glass btn-lg" target="_blank" rel="noopener" href="https://x.com/intent/tweet?text=${encodeURIComponent(o)}&via=hookrzfun&url=${encodeURIComponent(l)}">${H.x} Share on X</a>
      </div>
      <button class="link done-again" data-l="again">Build another coin</button>
    </div>`}const at=()=>`${n()}|${i.meta.buy}|${i.meta.ticker}`;function nt(){clearTimeout(F),F=setTimeout(async()=>{const c=at();try{const l=await st.prepareLaunch({meta:it(),stack:e(),creator:b??void 0});if(c!==at())return nt();i.prep=l,i.prepSig=c,R=!1}catch(l){R=!0,$(`Couldn't build the launch transaction: ${(l==null?void 0:l.message)||"try again"}`)}i.step>=1&&!i.done&&k()},250)}const it=()=>{const c=i.meta;return{name:c.name.trim(),ticker:c.ticker,desc:c.desc.trim(),image:c.image,links:{x:c.x.trim()||null,telegram:c.tg.trim()||null,website:c.web.trim()?ls(c.web.trim()):null},creatorBuySol:+c.buy||0}};async function ot(){var c,l;if(i.step===0){if(i.errs=_t(i.meta),!Object.keys(i.errs).length&&!d().ok){k(),(c=s.querySelector(".blockers"))==null||c.scrollIntoView({behavior:"smooth",block:"center"});return}if(!i.errs.ticker&&i.meta.ticker){M=!0,k();const o=await st.coin(i.meta.ticker).catch(()=>null);M=!1,o&&(i.errs.ticker=`$${i.meta.ticker} is taken. Pick another ticker.`)}if(Object.keys(i.errs).length){k(),(l=s.querySelector('[aria-invalid="true"]'))==null||l.focus();return}i.step=1,i.prep=null,R=!1,k(),W()}else if(i.step===1){if(!i.prep||!d().ok)return;i.step=2,i.err=null,k(),W()}}function W(){var c,l,o;(c=s.querySelector(".steps"))==null||c.scrollIntoView({behavior:"smooth",block:"start"}),(o=(l=s.querySelector(".steps .on .st"))==null?void 0:l.focus)==null||o.call(l,{preventScroll:!0})}async function vt(){try{w=await zt(),b=yt??b,i.err=null}catch{}k()}async function gt(){try{w=await Ls(),b=yt??b,i.err=null}catch{}k()}async function kt(){var o,m,g;if(i.busy)return;if(!d().ok){k();return}i.err=null;try{w=await zt(),b=yt??b}catch{i.err={kind:"nowallet",title:"No wallet connected",text:"Connect a wallet to sign the launch. If you don't have one, the picker links to Phantom, Solflare and Backpack."},k();return}if(typeof(w==null?void 0:w.signMessage)!="function"){i.err=ut(w),k();return}i.busy="wallet",k();const c=_(b,new Date().toISOString());let l;try{l=await w.signMessage(new TextEncoder().encode(c))}catch(h){const L=String((h==null?void 0:h.message)??h??"");i.busy=!1,/can't sign messages|not supported|signMessage is not|unsupported/i.test(L)?i.err=ut(w):(h==null?void 0:h.code)===4001||/reject|denied|declin|cancel|closed|abort|dismiss/i.test(L)?i.err={kind:"rejected",title:"Signature declined",text:"You declined the request in your wallet. Nothing was sent and nothing was charged. Sign again when you're ready."}:i.err={kind:"fail",title:"The wallet didn't sign",text:L||"Something went wrong in the wallet. Try again."},k();return}i.busy="submit",k();try{const h=await st.submitLaunch({meta:it(),stack:e(),parent:((o=t.parent)==null?void 0:o.ticker)??null,prepared:{...i.prep,manifest:c,manifestSignature:l?Array.from(l):null,creator:b}});i.done={ticker:h.ticker,signature:h.signature,name:i.meta.name.trim(),image:i.meta.image,mint:(m=i.prep)==null?void 0:m.mint,creator:b,stack:e(),parent:((g=t.parent)==null?void 0:g.ticker)??null},u()}catch(h){i.err={kind:"fail",title:"Launch not sent",text:`${(h==null?void 0:h.message)||"The launch did not go through."} Nothing was charged; try again.`}}i.busy=!1,k(),s.scrollIntoView({behavior:"smooth",block:"start"})}const ut=c=>({kind:"nosign",title:`${(c==null?void 0:c.name)??"This wallet"} can't sign messages`,text:"hookrz asks the creator to sign the launch manifest so the stack and metadata are provably yours. Phantom, Solflare and Backpack support it; switch to one of them to launch."});function mt(c){if(delete i.errs.image,!c)return;if(!/^image\/(png|jpe?g|gif|webp)$/.test(c.type)){i.errs.image="Use a PNG, JPG, GIF or WebP image.",k();return}if(c.size>le){i.errs.image=`That image is ${(c.size/1048576).toFixed(1)} MB. The limit is 1 MB.`,k();return}const l=new FileReader;l.onload=()=>{i.meta.image=l.result,p(),k()},l.onerror=()=>{i.errs.image="Couldn't read that file. Try another.",k()},l.readAsDataURL(c)}return s.addEventListener("click",c=>{var m,g;const l=c.target.closest("[data-l]");if(!l||l.disabled)return;const o=l.dataset.l;if(o==="next")ot();else if(o==="go"){const h=+l.dataset.to;h<i.step&&!i.busy&&(i.step=h,i.err=null,k(),W())}else if(o==="connect")vt();else if(o==="switch")gt();else if(o==="sign")kt();else if(o==="noimg")i.meta.image=null,p(),k();else if(o==="maxbuy")i.meta.buy=l.dataset.v,p(),k(),(m=s.querySelector("#lf-buy"))==null||m.focus();else if(o==="copy"){const h=l.dataset.link;(((g=navigator.clipboard)==null?void 0:g.writeText(h))??Promise.reject()).then(()=>$("Link copied."),()=>$(h))}else o==="again"&&(i.done=null,i.step=0,i.err=null,i.prep=null,i.errs={},i.meta={name:"",ticker:"",desc:"",image:null,x:"",tg:"",web:"",buy:""},x())}),s.addEventListener("input",c=>{var g;const l=c.target,o=l.dataset.f;if(!o)return;if(o==="ticker"){const h=l.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);if(h!==l.value){const L=l.selectionStart-(l.value.length-h.length);l.value=h,l.setSelectionRange(Math.max(0,L),Math.max(0,L))}}if(o==="buy"&&(l.value=l.value.replace(/[^0-9.]/g,"").replace(/(\..*)\./g,"$1")),i.meta[o]=l.value,i.errs[o]){delete i.errs[o];const h=l.closest(".field");h==null||h.classList.remove("bad"),(g=h==null?void 0:h.querySelector(".ferr"))==null||g.remove(),l.removeAttribute("aria-invalid")}if(o==="desc"){const h=s.querySelector("[data-cnt]");h&&(h.textContent=`${l.value.length}/280`)}if(o==="buy"){const h=s.querySelector("[data-buycheck]");h&&(h.innerHTML=G())}const m=s.querySelector("[data-pv]");m&&(m.innerHTML=v(d())),p()}),s.addEventListener("focusout",c=>{var m,g;const l=(m=c.target.dataset)==null?void 0:m.f;if(!l||i.step!==0||!i.meta[l])return;const o=_t(i.meta)[l];if(o&&!i.errs[l]){i.errs[l]=o;const h=c.target.closest(".field");h&&!h.querySelector(".ferr")&&(h.classList.add("bad"),(g=h.querySelector(".fhint"))==null||g.remove(),h.insertAdjacentHTML("beforeend",`<span class="ferr" id="le-${l}" role="alert">${f(o)}</span>`),c.target.setAttribute("aria-invalid","true"))}}),s.addEventListener("change",c=>{var l;c.target.id==="lf-img"&&(mt((l=c.target.files)==null?void 0:l[0]),c.target.value="")}),s.addEventListener("dragover",c=>{var o,m;const l=c.target.closest("[data-drop]");l&&((m=(o=c.dataTransfer)==null?void 0:o.types)!=null&&m.includes("Files"))&&(c.preventDefault(),l.classList.add("over"))}),s.addEventListener("dragleave",c=>{var l,o,m;(m=(o=(l=c.target).closest)==null?void 0:o.call(l,"[data-drop]"))==null||m.classList.remove("over")}),s.addEventListener("drop",c=>{var o,m;const l=c.target.closest("[data-drop]");l&&((m=(o=c.dataTransfer)==null?void 0:o.files)!=null&&m.length)&&(c.preventDefault(),l.classList.remove("over"),mt(c.dataTransfer.files[0]))}),{render:k,stackChanged(){if(!i.done)if(i.step===0){const c=s.querySelector("[data-pv]");c&&(c.innerHTML=v(d()));const l=s.querySelector("[data-buycheck]");l&&(l.innerHTML=G());const o=d(),m=s.querySelector(".blockers"),g=T(o);m&&!g?m.remove():m&&(m.outerHTML=g)}else i.prep=null,R=!1,i.step===2&&!i.busy&&(i.step=1,i.err=null),i.busy||k()}}}Ts("build");const Tt="hookrz:build-draft";let pe=0;const ue=()=>`s${Date.now().toString(36)}${(pe++).toString(36)}`,Mt=(t,s)=>({uid:ue(),id:t,params:{...Qt(t),...s??{}},draft:null}),r={stack:[],sel:null,fam:"guard",parent:null,hist:[],drafting:{},draftErr:{},sim:{seed:7,res:null,busy:!1,sig:null,err:null},launch:{step:0,meta:{name:"",ticker:"",desc:"",image:null,x:"",tg:"",web:"",buy:""},errs:{},prep:null,prepSig:null,busy:!1,err:null,done:null}},ht=()=>r.stack.map(t=>{var s,a;return{id:t.id,params:{...t.params,...t.id==="custom"&&((a=(s=t.draft)==null?void 0:s.compile)!=null&&a.ok)?{script:t.draft.source}:{}}}}),bt=()=>JSON.stringify(ht().map(t=>[t.id,t.params])),cs=()=>r.stack.find(t=>t.uid===r.sel)??null;let Vt;function X(){clearTimeout(Vt),Vt=setTimeout(()=>{var s;const t={v:1,fam:r.fam,sel:r.stack.findIndex(a=>a.uid===r.sel),parent:((s=r.parent)==null?void 0:s.ticker)??null,seed:r.sim.seed,stack:r.stack.map(a=>({id:a.id,params:a.params,draft:a.draft?{...a.draft,_t:void 0}:null})),meta:r.launch.meta};try{localStorage.setItem(Tt,JSON.stringify(t))}catch{try{localStorage.setItem(Tt,JSON.stringify({...t,meta:{...t.meta,image:null}}))}catch{}}},200)}function me(){try{return JSON.parse(localStorage.getItem(Tt)??"null")}catch{return null}}function ds(){try{localStorage.removeItem(Tt)}catch{}}const q=document.getElementById("app");q.innerHTML=`
<section class="b-top"><div class="wrap">
  <div class="b-head" id="bHead"></div>
  <div id="remixBar"></div>
</div></section>
<section class="b-bench" id="stack" aria-label="Stack configurator"><div class="wrap">
  <div class="bench">
    <aside class="pal panel" id="pal" aria-label="Block palette"></aside>
    <div class="rack-panel" id="rack"></div>
    <div class="editor panel" id="editor" aria-live="polite"></div>
    <aside class="bud panel" id="bud" aria-label="Stack budget"></aside>
  </div>
</div></section>
<section class="b-sim" id="simulate"><div class="wrap" id="sim"></div></section>
<section class="b-launch" id="launch"><div class="wrap" id="launchRoot"></div></section>`;const y=t=>document.getElementById(t);function I(t,s){var n;const a=document.activeElement,e=a&&t.contains(a)?a.dataset.fk:null;t.innerHTML=s,e&&((n=t.querySelector(`[data-fk="${CSS.escape(e)}"]`))==null||n.focus({preventScroll:!0}))}function dt(){const t=Ms(ht()),s=[...Ys(r),...t.warnings];return{S:r,b:t,warnings:s,ok:!s.some(a=>a.level==="error"||a.level==="need"),diff:r.parent?Bs(r.parent.stack,ht()):null}}function ps(){I(y("bHead"),Ds(r))}function us(t=dt()){I(y("remixBar"),qs(r,t)),I(y("pal"),It(r)),I(y("rack"),as(r,t)),I(y("bud"),ns(r,t))}function $t(t=dt()){I(y("editor"),Ns(r))}function Bt(){I(y("sim"),Vs(r,bt())),ne(y("sim"),r)}const Ft=de({S:r,root:y("launchRoot"),paint:I,plain:ht,sig:bt,ctx:dt,save:X,clearDraft:ds,toast:K,onReset:be});function ms(){const t=dt();ps(),us(t),$t(t),Bt(),Ft.render()}function C({editor:t=!0}={}){const s=dt();if(ps(),us(s),t&&$t(s),y("sim").classList.toggle("stale",!!r.sim.res&&r.sim.sig!==bt()),r.sim.res){const a=y("sim").querySelector("[data-stale]");a&&(a.hidden=r.sim.sig===bt())}else Bt();Ft.stackChanged(),X()}function J(){r.hist.push(r.stack.map(t=>({...t,params:{...t.params}}))),r.hist.length>30&&r.hist.shift()}function fs(t,s=r.stack.length){const a=S[t];if(!a)return;const e=r.stack.findIndex(d=>d.id===t);if(e>=0){r.sel=r.stack[e].uid,C(),K(`${a.name} is already in slot ${e+1}.`);return}if(r.stack.length>=E.maxSlots){K(`The rack holds ${E.maxSlots} blocks. Remove one first.`);return}J();const n=Mt(t);r.stack.splice(Math.max(0,Math.min(s,r.stack.length)),0,n),r.sel=n.uid,C()}function Ut(t){var e;const s=r.stack.findIndex(n=>n.uid===t);if(s<0)return;J();const[a]=r.stack.splice(s,1);r.sel===t&&(r.sel=((e=r.stack[Math.min(s,r.stack.length-1)])==null?void 0:e.uid)??null),C(),K(`Removed ${S[a.id].name} from slot ${s+1}.`)}function Dt(t,s){const a=r.stack.findIndex(n=>n.uid===t);if(s=Math.max(0,Math.min(s,r.stack.length-1)),a<0||a===s)return;J();const[e]=r.stack.splice(a,1);r.stack.splice(s,0,e),C()}function jt(t,{sel:s=0}={}){var a;J(),r.stack=t.slice(0,E.maxSlots).map(e=>{const{script:n,...d}=e.params??{},p=Mt(e.id,d);return e.id==="custom"&&n&&(p.draft={source:n,prompt:(d.prompt??"").trim(),compile:null,check:null}),p}),r.sel=((a=r.stack[s])==null?void 0:a.uid)??null,r.stack[0]&&(r.fam=S[r.stack[0].id].family)}function fe(t){const s=ft.find(a=>a.id===t);s&&(jt(s.slots.map(([a,e])=>({id:a,params:e}))),C(),K(`Loaded ${s.name}. Undo puts your last stack back.`))}function he(){!r.stack.length&&!r.parent||(J(),r.stack=[],r.sel=null,r.parent=null,C(),K("Empty rack. Pick blocks from the palette."))}function hs(){var s;const t=r.hist.pop();t&&(r.stack=t,r.stack.some(a=>a.uid===r.sel)||(r.sel=((s=r.stack[0])==null?void 0:s.uid)??null),C())}function be(){r.stack=[],r.sel=null,r.parent=null,r.hist=[],r.sim.res=null,r.sim.sig=null,ds(),history.replaceState(null,"",location.pathname),ms()}function $e(t){var e;const s=t.alternative?[t.alternative]:t.suggestions??[],a=((e=t.honeypot)==null?void 0:e.ok)===!1;return{text:a?t.message??"":"hookrz can't draft that rule yet. Pick a close one, or write the Hookscript yourself.",honeypot:a,options:s.map(n=>({label:n.title??n.prompt,text:n.prompt}))}}async function Kt(t){const s=r.stack.find(e=>e.uid===t);if(!s)return;const a=(s.params.prompt??"").trim();if(a.length<8){r.draftErr[t]="Describe the rule in a full sentence.",$t();return}r.drafting[t]=!0,delete r.draftErr[t],$t();try{const e=await st.draftHookscript(a);e.ok===!1&&!e.bytecodeHex?r.draftErr[t]=$e(e):s.draft=Os(e,a)}catch(e){r.draftErr[t]=(e==null?void 0:e.message)||"The Hookscript compiler did not answer. Try again."}delete r.drafting[t],C(),qt(s)}function qt(t){(t==null?void 0:t.id)==="custom"&&js(t.draft)&&Hs(t.uid,t.draft,(s,a)=>{a.checked?C({editor:!1}):X()})}async function Zt(t=!1){if(!r.sim.busy){t&&(r.sim.seed=1+Math.floor(Math.random()*9998)),r.sim.busy=!0,r.sim.err=null,Bt();try{const s=performance.now(),a=await st.simulate(ht(),{seed:r.sim.seed}),e=520-(performance.now()-s);e>0&&await new Promise(n=>setTimeout(n,e)),r.sim.res=a,r.sim.sig=bt()}catch(s){r.sim.err=(s==null?void 0:s.message)||"Simulation failed. Try again."}r.sim.busy=!1,y("sim").classList.remove("stale"),Bt(),X()}}const ve={fam:t=>{r.fam=t.dataset.fam,I(y("pal"),It(r)),X()},add:t=>fs(t.dataset.id),sel:t=>{var s,a;r.sel=t.dataset.uid,r.fam=((a=S[(s=r.stack.find(e=>e.uid===r.sel))==null?void 0:s.id])==null?void 0:a.family)??r.fam,C()},rm:t=>Ut(t.dataset.uid),mv:t=>{const s=r.stack.findIndex(a=>a.uid===t.dataset.uid);Dt(t.dataset.uid,s+ +t.dataset.d)},preset:t=>fe(t.dataset.id),empty:()=>he(),undo:()=>hs(),reset:t=>{const s=r.stack.find(a=>a.uid===t.dataset.uid);s&&(J(),s.params={...Qt(s.id),...s.id==="custom"?{prompt:s.params.prompt}:{}},C())},parentParams:t=>{var e;const s=r.stack.find(n=>n.uid===t.dataset.uid),a=(e=r.parent)==null?void 0:e.stack.find(n=>n.id===(s==null?void 0:s.id));!s||!a||(J(),s.params={...a.params},C())},draft:t=>Kt(t.dataset.uid),write:t=>{var a;const s=r.stack.find(e=>e.uid===t.dataset.uid);s&&(s.draft={source:Rs,prompt:(s.params.prompt??"").trim(),compile:null,check:null},C(),qt(s),(a=y("editor").querySelector("textarea[data-hse]"))==null||a.focus())},example:t=>{const s=cs();s&&(s.params.prompt=t.dataset.text,$t(),C({editor:!1}),Kt(s.uid))},leaveRemix:()=>{J(),r.parent=null,r.stack=[],r.sel=null,history.replaceState(null,"",location.pathname),C(),K("Starting from an empty rack.")},sim:()=>Zt(!1),crowd:()=>Zt(!0),toSim:()=>{y("simulate").scrollIntoView({behavior:"smooth"})},toLaunch:()=>{y("launch").scrollIntoView({behavior:"smooth"})},toPal:()=>{const t=y("pal").querySelector(".pb:not(.in) .pb-main");t==null||t.focus(),y("pal").scrollIntoView({behavior:"smooth",block:"nearest"}),y("pal").classList.add("flash"),setTimeout(()=>y("pal").classList.remove("flash"),900)},toRack:()=>{y("stack").scrollIntoView({behavior:"smooth"})},selWarn:t=>{const s=r.stack.find(a=>a.id===t.dataset.id);s&&(r.sel=s.uid,C(),y("editor").scrollIntoView({behavior:"smooth",block:"nearest"}))}};q.addEventListener("click",t=>{const s=t.target.closest("[data-act]");if(!s||!q.contains(s)||s.disabled)return;const a=ve[s.dataset.act];a&&(t.preventDefault(),a(s,t))});q.addEventListener("input",t=>{var u,$,x,i;const s=t.target;if(!s.matches("[data-p]"))return;const a=r.stack.find(b=>b.uid===s.dataset.uid);if(!a)return;const e=S[a.id],n=e.params.find(b=>b.key===s.dataset.p);let d=s.value;if(s.type==="range"){const b=(String(n.step).split(".")[1]??"").length;d=+(+d).toFixed(b);const w=y("editor").querySelector(`[data-pv="${n.key}"]`);w&&(w.textContent=n.fmt?n.fmt(d):d),s.setAttribute("aria-valuetext",n.fmt?n.fmt(d):String(d)),s.style.setProperty("--fill",`${(d-n.min)/(n.max-n.min)*100}%`);const F=(u=s.closest(".prm"))==null?void 0:u.querySelector(".prm-parent");F&&F.classList.toggle("diff",((x=($=r.parent)==null?void 0:$.stack.find(M=>M.id===a.id))==null?void 0:x.params[n.key])!==d)}if(n.text){const b=y("editor").querySelector(".hs-stale");b&&(b.hidden=!((i=a.draft)!=null&&i.prompt)||a.draft.prompt===d.trim())}a.params[n.key]=d;const p=y("editor").querySelector("[data-errmsg]");p&&e.error&&(p.textContent=e.error(a.params,{})),C({editor:!1})});Ps(q,{get:t=>{var s;return((s=r.stack.find(a=>a.uid===t))==null?void 0:s.draft)??null},onChange:(t,s,a)=>{if(a.checked)C({editor:!1});else{const e=dt();I(y("bud"),ns(r,e)),I(y("rack"),as(r,e)),Ft.stackChanged(),X()}}});q.addEventListener("keydown",t=>{var e,n,d,p;const s=t.target.closest('[role="tab"]');if(s&&(t.key==="ArrowRight"||t.key==="ArrowLeft"||t.key==="ArrowDown"||t.key==="ArrowUp")){const u=[...s.parentElement.querySelectorAll('[role="tab"]')],$=(u.indexOf(s)+(t.key==="ArrowRight"||t.key==="ArrowDown"?1:-1)+u.length)%u.length;r.fam=u[$].dataset.fam,I(y("pal"),It(r)),(e=y("pal").querySelector(`[data-fam="${r.fam}"]`))==null||e.focus(),X(),t.preventDefault();return}const a=t.target.closest(".bay-main");if(a){const u=a.dataset.uid,$=r.stack.findIndex(b=>b.uid===u),x=t.key==="ArrowLeft"||t.key==="ArrowUp",i=t.key==="ArrowRight"||t.key==="ArrowDown";if((x||i)&&t.shiftKey)Dt(u,$+(i?1:-1)),(n=y("rack").querySelector(`[data-fk="bay-${u}"]`))==null||n.focus(),t.preventDefault();else if(x||i){const b=r.stack[$+(i?1:-1)];b&&((d=y("rack").querySelector(`[data-fk="bay-${b.uid}"]`))==null||d.focus()),t.preventDefault()}else if(t.key==="Delete"||t.key==="Backspace"){Ut(u);const b=r.stack[Math.min($,r.stack.length-1)];b&&((p=y("rack").querySelector(`[data-fk="bay-${b.uid}"]`))==null||p.focus()),t.preventDefault()}}(t.metaKey||t.ctrlKey)&&t.key==="z"&&!t.target.closest("input, textarea, select")&&(hs(),t.preventDefault())});let D=null;q.addEventListener("dragstart",t=>{var e,n,d,p;const s=(n=(e=t.target).closest)==null?void 0:n.call(e,"[data-drag-block]"),a=(p=(d=t.target).closest)==null?void 0:p.call(d,"[data-drag-slot]");if(s)D={block:s.dataset.dragBlock},t.dataTransfer.effectAllowed="copy";else if(a)D={slot:a.dataset.dragSlot},t.dataTransfer.effectAllowed="move",a.classList.add("dragging");else return;t.dataTransfer.setData("text/plain",D.block??D.slot),y("rack").classList.add("dnd")});function bs(t){const s=t.target.closest(".bay");return s?+s.dataset.bay:t.target.closest(".rack")?r.stack.length:null}q.addEventListener("dragover",t=>{var e;if(!D)return;const s=bs(t),a=D.slot&&t.target.closest("#pal");s==null&&!a||(t.preventDefault(),t.dataTransfer.dropEffect=a?"move":D.block?"copy":"move",y("rack").querySelectorAll(".bay.over").forEach(n=>n.classList.remove("over")),y("pal").classList.toggle("drop-out",!!a),s!=null&&((e=y("rack").querySelector(`.bay[data-bay="${Math.min(s,D.block?r.stack.length:r.stack.length-1)}"]`))==null||e.classList.add("over")))});q.addEventListener("drop",t=>{if(!D)return;t.preventDefault();const s=D;if($s(),s.slot&&t.target.closest("#pal")){Ut(s.slot);return}const a=bs(t);a!=null&&(s.block?fs(s.block,a):Dt(s.slot,a))});function $s(){D=null,y("rack").classList.remove("dnd"),y("pal").classList.remove("drop-out"),q.querySelectorAll(".over, .dragging").forEach(t=>t.classList.remove("over","dragging"))}q.addEventListener("dragend",$s);async function ge(){var u,$,x;const t=me(),s=new URLSearchParams(location.search),a=(Pt("remix")??"").toUpperCase().replace(/[^A-Z0-9]/g,""),e=Pt("preset"),n=Pt("add");t!=null&&t.meta&&(r.launch.meta={...r.launch.meta,...t.meta}),t!=null&&t.fam&&(r.fam=t.fam),t!=null&&t.seed&&(r.sim.seed=t.seed);const d=()=>{var i,b;r.stack=((t==null?void 0:t.stack)??[]).filter(w=>S[w.id]).slice(0,E.maxSlots).map(w=>({...Mt(w.id,w.params),draft:Is(w.draft)})),r.sel=((i=r.stack[t==null?void 0:t.sel])==null?void 0:i.uid)??((b=r.stack[0])==null?void 0:b.uid)??null},p=i=>{var b;return{ticker:i.ticker,name:i.name,handle:((b=i.creatorInfo)==null?void 0:b.handle)??i.creator,stack:Ot(i.stack),image:i.image??null,coin:i}};if(a){const i=await st.coin(a).catch(()=>null);i?(r.parent=p(i),(t==null?void 0:t.parent)===i.ticker&&((u=t.stack)!=null&&u.length)?d():(jt(i.stack),r.hist=[])):(d(),K(`No coin with the ticker $${a}.`))}else if(e&&ft.some(i=>i.id===e)){const i=ft.find(b=>b.id===e);jt(i.slots.map(([b,w])=>({id:b,params:w}))),r.hist=[]}else if(d(),t!=null&&t.parent){const i=await st.coin(t.parent).catch(()=>null);i&&(r.parent=p(i))}if(n&&S[n]){const i=r.stack.find(b=>b.id===n);if(i)r.sel=i.uid;else if(r.stack.length<E.maxSlots){const b=Mt(n);r.stack.push(b),r.sel=b.uid}else K(`The rack is full, so ${S[n].name} was not added. Remove a block first.`);r.fam=S[n].family}r.sel&&(r.fam=((x=S[($=cs())==null?void 0:$.id])==null?void 0:x.family)??r.fam),(s.has("preset")||s.has("add"))&&(s.delete("preset"),s.delete("add"),history.replaceState(null,"",location.pathname+(s.toString()?`?${s}`:"")+location.hash)),ms();for(const i of r.stack)qt(i);if(X(),location.hash){const i=document.getElementById(location.hash.slice(1));i&&requestAnimationFrame(()=>i.scrollIntoView({block:"start"}))}}window.addEventListener("hashchange",()=>{var t;return(t=document.getElementById(location.hash.slice(1)))==null?void 0:t.scrollIntoView({behavior:"smooth"})});ge();
