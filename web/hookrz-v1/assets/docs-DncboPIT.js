import{e as n,W as ce,r as k,X as me,P as T,j as c,B,G as le,b as U,E as M,c as Y,F as v,Y as K,Z as be,a as fe,d as ve,$ as ke,i as S,h as w,m as ge,n as G,k as ye,v as $e}from"./format-CV8hyfGB.js";const we=new Set(["rule","timezone","global","payout","on","when","let","set","refuse","allow","if","else","then","unless","because","and","or","not","in","is","to","as","where"]),xe=/^(transfer|wallet|clock|curve|coin|sender|receiver|buyer|seller|other|moon|from)\.[a-z_]+/;function de(e){const t=[];let s=0;const a=String(e);for(;s<a.length;){const r=a[s];if(r==='"'){let o=s+1;for(;o<a.length&&a[o]!=='"';)o++;t.push(`<span class="hs-str">${n(a.slice(s,o+1))}</span>`),s=o+1;continue}if(r==="#"||r==="/"&&a[s+1]==="/"){let o=a.indexOf(`
`,s);o<0&&(o=a.length),t.push(`<span class="hs-com">${n(a.slice(s,o))}</span>`),s=o;continue}if(/[0-9]/.test(r)){const o=a.slice(s).match(/^[0-9][0-9_.]*(ms|s|m|h|d)?/);t.push(`<span class="hs-num">${n(o[0])}</span>`),s+=o[0].length;continue}if(/[A-Za-z_]/.test(r)){const d=a.slice(s).match(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/)[0];if(we.has(d))t.push(`<span class="hs-kw">${d}</span>`);else if(xe.test(d)){const[u,...i]=d.split(".");t.push(`<span class="hs-ns">${u}</span><span class="hs-op">.</span><span class="hs-fn">${n(i.join("."))}</span>`)}else a[s+d.length]===":"?t.push(`<span class="hs-arg">${n(d)}</span>`):t.push(`<span class="hs-id">${n(d)}</span>`);s+=d.length;continue}if(/[=<>!+\-*/]/.test(r)){const o=a.slice(s).match(/^[=<>!+\-*/]+/);t.push(`<span class="hs-op">${n(o[0])}</span>`),s+=o[0].length;continue}t.push(n(r)),s++}return t.join("")}function I(e){const t=D(e,"");return n(t).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b(true|false|null)\b/g,(s,a,r,o,d)=>a?r?`<span class="js-key">${a}</span>${r}`:`<span class="js-str">${a}</span>`:o?`<span class="js-num">${o}</span>`:`<span class="js-lit">${d}</span>`)}function W(e){if(e===null||typeof e!="object")return JSON.stringify(e)??"null";if(Array.isArray(e))return`[${e.map(W).join(", ")}]`;const t=Object.entries(e).filter(([,s])=>s!==void 0);return t.length?`{ ${t.map(([s,a])=>`${JSON.stringify(s)}: ${W(a)}`).join(", ")} }`:"{}"}function D(e,t){const s=W(e);if(e===null||typeof e!="object"||s.length+t.length<=72)return s;const a=t+"  ";return Array.isArray(e)?`[
${e.map(r=>a+D(r,a)).join(`,
`)}
${t}]`:`{
${Object.entries(e).filter(([,r])=>r!==void 0).map(([r,o])=>`${a}${JSON.stringify(r)}: ${D(o,a)}`).join(`,
`)}
${t}}`}const C=Object.fromEntries(ce.map(e=>[e.id,e])),g=e=>e.toLocaleString("en-US"),x=(e,t=4)=>`${e.toFixed(t)} SOL`;function Se(){const e=(a,r,o,d)=>`<div class="arch-node ${a}"><span class="pixel">${r}</span><b>${o}</b><small>${d}</small></div>`,t=a=>`<div class="arch-arrow" aria-hidden="true"><span class="mono">${a}</span></div>`,s=(a,r,o,d)=>`<div class="arch-off ${a}"><span class="pixel">Off chain · ${n(r.kind)}</span><b>${n(r.name)}</b><small>${o}</small><em class="mono">${d}</em></div>`;return`<figure class="arch" aria-label="hookrz architecture">
    <div class="arch-band" aria-hidden="true"><span class="pixel">On chain · Solana</span></div>
    ${s("a-api",C.api,"Unsigned transactions, rule-aware quotes, stack validation","↓ tx for the wallet to sign")}
    ${s("a-hs",C.hookscript,"English to Hookscript, CU measured, fuzzed","↓ ops into the Stack at launch")}
    ${e("n-wallet","Signer","Wallet","Signs the swap or launch")}
    ${t("swap")}
    ${e("n-router","Program","hookrz router","Opens Wallet records, resolves hook accounts")}
    ${t("CPI")}
    ${e("n-dbc","Meteora","DBC pool","Bonding curve, fee vaults, hook authority")}
    ${t("transfer")}
    ${e("n-t22","Program","Token-2022","Moves the coin, calls the hook")}
    ${t("Execute")}
    ${e("n-engine","Program","hookrz_engine","Runs the stack. Can only refuse.")}
    ${s("a-keeper",C.keeper,"Claims fee vaults, buys back and burns, pays rewards and royalties","↑ public crank txs")}
    ${s("a-idx",C.indexer,"Coins, trades, verdicts and lineage into Postgres; the live stream","↑ follows engine, DBC, DAMM v2")}
  </figure>`}function H(e){let t=0;return e.map(([s,a,r,o,d])=>{const u={off:t,field:s,type:a,bytes:r,note:o,grp:d};return t+=r,u})}const V=H([["discriminator","[u8; 8]",8,"Account type tag","h"],["version","u8",1,"Layout version (1)","h"],["bump","u8",1,"PDA bump","h"],["flags","u16",2,"Armed · blocklist frozen · has wallet records · has script","h"],["slot_count","u8",1,"1 to 6","h"],["reserved","[u8; 3]",3,"","h"],["mint","Pubkey",32,"The coin","k"],["creator","Pubkey",32,"The pool creator: the only signer init_stack accepts, and who gets the rent back from close_stack","k"],["pool","Pubkey",32,"Meteora DBC virtual pool","k"],["base_vault","Pubkey",32,"DBC base vault. Out of it = buy, into it = sell","k"],["parent_stack","Pubkey",32,"The Stack this one remixed; zero for an original","k"],["parent_author","Pubkey",32,"Creator of the parent Stack, copied at init: the royalty receiver","k"],["launch_slot","u64",8,"Slot of init_stack: time zero for every block","t"],["launch_ts","i64",8,"Unix time of init_stack","t"],[`slots[${c.maxSlots}]`,"[Slot; 6]",c.maxSlots*58,`${c.maxSlots} × 58 bytes, run in order`,"s"],["script","Pubkey",32,"The Script account holding the Custom block's Hookscript; zero if the stack has none","x"],["last_sqrt","u128",16,"Curve sqrt price after the last trade (Circuit Breaker)","x"],["migration_quote_threshold","u64",8,"Copied from the DBC config at init (Lock-in, curve progress)","x"],["activation_point","u64",8,"The pool's activation point, for the fee a Hookscript reads","x"],["reserved","[u8; 4]",4,"","x"]]),Ae=H([["block_id","u16",2,"Catalog id; 0 = empty slot","s"],["params","[u8; 24]",24,"Packed settings. Snipe Shield: window u32 + max in bps u16","s"],["state","[u8; 32]",32,"Block counters. Anti-Bundle: current slot + buys in it. Circuit Breaker: window index + opening sqrt price","s"]]),J=H([["discriminator","[u8; 8]",8,"Account type tag","h"],["version","u8",1,"Layout version (1)","h"],["bump","u8",1,"PDA bump","h"],["flags","u8",1,"Has bought · has sold · has received","h"],["lot_count","u8",1,"Receipt lots in use, 0 to 5","h"],["first_receipt_ts","i64",8,"First time this account received the coin. Seasoned Sells, Diamond Tiers, wallet.first_receipt","t"],["last_buy_slot","u64",8,"Sandwich Guard; carried to the receiver of a send","t"],["last_sell_ts","i64",8,"Sell Cooldown","t"],["lots_in[5]","[Lot; 5]",60,"5 × { seconds since launch u32, amount u64 }. Hold Timer, wallet.received(window)","s"],["mint","Pubkey",32,"The coin","k"],["token_account","Pubkey",32,"The account this record belongs to","k"],["payer","Pubkey",32,"Gets the rent back after graduation","k"],["script_vars","[u8; 32]",32,"Hookscript per-wallet state (wallet.NAME)","x"],["last_buy_ts","i64",8,"wallet.last_buy","t"],["bought · sold","u64 · u64",16,"Cumulative tokens bought from and sold to the curve","t"],["buys · sells","u32 · u32",8,"Counts","t"],["n_out","u8",1,"Outflow lots in use","h"],["reserved","[u8; 7]",7,"","h"],["lots_out[5]","[Lot; 5]",60,"Sells and outgoing sends. wallet.sent(window)","s"],["reserved","[u8; 4]",4,"","h"]]),Q=H([["discriminator","[u8; 8]",8,"Account type tag","h"],["version","u8",1,"1 once init_stack seals the script","h"],["bump","u8",1,"PDA bump","h"],["code_len","u16",2,"Bytes of bytecode in use","h"],["reserved","[u8; 4]",4,"","h"],["globals","[u8; 256]",256,"The script's coin-wide state (global NAME), at a fixed offset so the keeper can read it","s"],["code","[u8; 1024]",1024,"The compiled Hookscript: header, constant keys, refusal messages, ops","x"]]),Z={h:"Header",k:"Keys",t:"Times",s:"Slots / lots / state",x:"Script"};function j(e,t){const s=[];for(const a of e){const r=s.at(-1);r&&r.grp===a.grp?r.bytes+=a.bytes:s.push({grp:a.grp,bytes:a.bytes})}return`<div class="bmap" role="img" aria-label="Byte map, ${t} bytes">${s.map(a=>`<span class="g-${a.grp}" style="flex:${a.bytes}" title="${Z[a.grp]}: ${a.bytes} bytes"><b>${Z[a.grp]}</b><i class="mono">${a.bytes}</i></span>`).join("")}</div>`}function L(e,{total:t}={}){const s=e.reduce((a,r)=>a+r.bytes,0);return`<div class="tscroll"><table class="table dc-ltable"><thead><tr><th>Offset</th><th>Field</th><th>Type</th><th class="r">Bytes</th><th>What</th></tr></thead><tbody>
    ${e.map(a=>`<tr><td class="mono dim">${a.off}</td><td class="mono"><span class="sw g-${a.grp}"></span>${n(a.field)}</td><td class="mono dim">${n(a.type)}</td><td class="mono r">${a.bytes}</td><td class="note">${n(a.note)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td></td><td colspan="2">Total</td><td class="mono r">${s}${t&&t!==s?` ≠ ${t}`:""}</td><td class="note">${t?`Rent-exempt: <span class="mono">${x(k(s),5)}</span>`:""}</td></tr></tfoot></table></div>`}function Te(){const e=new Map;for(const t of B.filter(s=>s.enforcedBy==="hook"))for(const s of le([{id:t.id}]).accounts)e.has(s.key)||e.set(s.key,{...s,by:[]}),e.get(s.key).by.push(t);return[...e.values()]}function Be(){return`<div class="tscroll"><table class="table dc-mtable"><thead><tr><th>Entry</th><th>Resolves to</th><th>Added by</th></tr></thead><tbody>
    ${Te().map(t=>`<tr><td class="mono">${n(t.key)}</td><td>${n(t.label)}</td><td class="by">${t.key==="stack"?'<span class="dim">every stack with a Hook block</span>':t.by.map(s=>`<a href="blocks.html?b=${s.id}">${n(s.name)}</a>`).join(", ")}</td></tr>`).join("")}
  </tbody></table></div>`}const X=["#8fcaff","#6fb4ff","#4d9bff","#3b84ea","#2f6fd0","#2a5fb5"];function Ee(e){let t=0;e.innerHTML=`<div class="bud panel">
    <div class="bud-tabs" role="tablist" aria-label="Preset stacks">${T.map((a,r)=>`<button role="tab" data-p="${r}">${n(a.name)}</button>`).join("")}</div>
    <div class="bud-body" data-o="body" aria-live="polite"></div>
  </div>`;const s=()=>{const a=T[t],r=a.slots.map(([i,p])=>({id:i,params:p})),o=le(r);e.querySelectorAll("[data-p]").forEach(i=>{i.classList.toggle("on",+i.dataset.p===t),i.setAttribute("aria-selected",String(+i.dataset.p===t))});const d=r.map(i=>U[i.id]).filter(i=>i.enforcedBy==="hook"),u=(i,p,h,y="")=>`<span class="${p}" style="width:${i/o.cuBudget*100}%;${y?`background:${y}`:""}" title="${n(h)}"></span>`;e.querySelector('[data-o="body"]').innerHTML=`
      <p class="bud-blurb"><b>${n(a.name)}.</b> ${n(a.blurb)} <span class="mono dim">budget(${n(a.id)})</span></p>
      <div class="bud-stack">${r.map((i,p)=>{const h=U[i.id];return`<a class="bud-slot" href="blocks.html?b=${h.id}"><span class="mono dim">${p+1}</span>${Y(h.family,{size:28})}<span>${n(h.name)}</span><span class="enf ${h.enforcedBy}"><i></i>${M[h.enforcedBy].name}</span></a>`}).join("")}
        ${Array.from({length:o.maxSlots-r.length},(i,p)=>`<span class="bud-slot empty"><span class="mono dim">${r.length+p+1}</span>${Y("x",{size:28,state:"empty"})}<span class="dim">empty</span></span>`).join("")}</div>
      <div class="bud-cu">
        <div class="row between"><span class="pixel">Compute per transfer</span><span class="mono"><b>${g(o.cu)}</b> <span class="dim">/ ${g(o.cuBudget)} CU</span></span></div>
        <div class="bud-bar">${o.hasHook?u(c.cuBase,"base",`Engine base ${g(c.cuBase)} CU`)+d.map((i,p)=>u(i.cu,"blk",`${i.name} ${g(i.cu)} CU`,X[p%6])).join(""):""}</div>
        <div class="bud-legend">${o.hasHook?`<span><i class="base"></i>Engine base <b class="mono">${g(c.cuBase)}</b></span>${d.map((i,p)=>`<span><i style="background:${X[p%6]}"></i>${n(i.name)} <b class="mono">${g(i.cu)}</b></span>`).join("")}`:'<span class="dim">No Hook blocks: the mint has no transfer hook and the engine never runs.</span>'}</div>
      </div>
      <dl class="bud-stats">
        <div><dt>Extra accounts</dt><dd class="num">${o.accounts.length}<span class="dim"> / ${o.maxAccounts}</span></dd></div>
        <div><dt>Stack + list rent</dt><dd class="num">${o.rentSol?x(o.rentSol):"0 SOL"}</dd></div>
        <div><dt>Route</dt><dd>${o.route==="record"?"Wallet record":"Any route"}</dd></div>
        <div><dt>Enforcers</dt><dd class="bud-enf">${o.enforcers.map(i=>`<span class="enf ${i}"><i></i>${M[i].name}</span>`).join("")}</dd></div>
      </dl>
      ${o.accounts.length?`<div class="bud-accts"><span class="pixel">ExtraAccountMetaList</span><ol>${o.accounts.map(i=>`<li><span class="mono">${n(i.key)}</span> ${n(i.label)}</li>`).join("")}</ol></div>`:""}
      ${o.warnings.length?`<ul class="bud-warn">${o.warnings.map(i=>`<li class="${i.level}"><span class="chip ${i.level==="risk"||i.level==="error"?"refuse":i.level==="warn"?"warnchip":"ice"}">${i.level==="info"?"Note":i.level}</span><span>${n(i.text)}</span></li>`).join("")}</ul>`:'<p class="bud-ok"><span class="dot ice"></span> Valid: within every engine limit, no warnings.</p>'}
      <details class="bud-raw"><summary>Raw <span class="mono">budget()</span> output</summary><pre class="json"><code>${I({...o,accounts:o.accounts.map(i=>i.key),rentSol:+o.rentSol.toFixed(6),walletRecordRentSol:+o.walletRecordRentSol.toFixed(6),warnings:o.warnings.map(i=>`${i.level}: ${i.text}`)})}</code></pre></details>`};e.querySelectorAll("[data-p]").forEach(a=>a.addEventListener("click",()=>{t=+a.dataset.p,s()})),s()}function Ce(){return`<ol class="ltl">${me.map((e,t)=>`<li>
    <span class="ltl-n mono">${t+1}</span>
    <div class="ltl-c"><div class="ltl-h"><span class="chip${e.program.includes("hookrz")?" ice":""}">${n(e.program)}</span><code>${n(e.ix)}</code></div><p>${n(e.note)}</p></div>
  </li>`).join("")}</ol>`}function Le(e,t){const s=Math.min(100,e/t*100);return`<div class="txbar"><div class="row between"><span class="pixel">Launch transaction, Fair Launch stack</span><span class="mono"><b>${g(e)}</b> <span class="dim">/ ${g(t)} bytes</span></span></div>
    <div class="txbar-track"><span style="width:${s}%"></span></div><p class="dim">${g(t-e)} bytes to spare. Every stack fits: ${c.maxSlots} slots add at most ${c.maxSlots*26} bytes of instruction data.</p></div>`}function Oe(){const e=[...new Set(K.map(t=>t.group))];return`<div class="api-base"><span class="pixel">Base URL</span><code>${n(be)}</code><span class="dim">JSON over HTTPS · one WebSocket for the stream</span></div>
  <div class="api-groups">${e.map(t=>`<section class="api-group"><h4>${n(t)}</h4><ul>${K.filter(s=>s.group===t).map(s=>`
    <li><span class="api-m m-${s.method.toLowerCase()}">${s.method}</span><div><code class="api-path">${n(s.path).replace(/(:[a-z]+)/g,"<em>$1</em>")}</code><p>${n(s.desc)}</p></div></li>`).join("")}</ul></section>`).join("")}</div>`}const q=e=>JSON.parse(JSON.stringify(e,(t,s)=>typeof s=="number"&&!Number.isInteger(s)?+s.toPrecision(6):s));async function Pe(e){const s=T.find(h=>h.id==="fair-launch").slots.map(([h])=>({id:h})),a={side:"sell",amount:15e6,wallet:{balance:2e7},stack:T.find(h=>h.id==="slow-bleed").slots.map(([h])=>({id:h})),progress:.5,minutesAgo:600},r={meta:{name:"Fair Weather",ticker:"FAIR"},stack:s,creator:ke(77)},[o,d,u]=await Promise.all([S.validate(s),S.quote(a),S.prepareLaunch(r)]),i=[{id:"validate",method:"POST",path:"/v1/stacks/validate",req:{stack:s},res:q({ok:o.ok,slots:o.slots,cu:o.cu,cuBudget:o.cuBudget,accounts:o.accounts.map(h=>h.key),maxAccounts:o.maxAccounts,rentSol:o.rentSol,route:o.route,enforcers:o.enforcers,warnings:o.warnings}),note:"Fair Launch: three Hook blocks and a Curve block. 9,900 CU of a 30,000 budget, one extra account, any route."},{id:"quote",method:"POST",path:"/v1/quote",req:{mint:"<mint>",side:"sell",amount:a.amount,wallet:a.wallet},res:q({ok:d.ok,refusedBy:d.refusedBy,code:d.code!=null?w(d.code):null,message:d.message,maxAllowed:Math.abs(d.maxAllowed-Math.round(d.maxAllowed))<.01?Math.round(d.maxAllowed):Math.floor(d.maxAllowed),out:d.out,price:d.price}),note:"A 1.5%-of-supply sell into a Sell Cap of 1%: the quote names the block, its error, and the largest sell that passes now."},{id:"launch",method:"POST",path:"/v1/launch/prepare",req:{meta:r.meta,stack:s,creator:r.creator},res:q({mint:u.mint,instructions:u.instructions.map(h=>`${h.program}: ${h.ix}`),txBytes:u.txBytes,txLimit:u.txLimit,rentSol:u.rentSol,launchCostSol:u.launchCostSol,signers:u.signers,transaction:"AQAAAAAAAAAAAAAAAAAAAAAAAAAA…(base64, unsigned)"}),note:"One unsigned transaction: mint, DBC config, pool, Stack, account list. The creator and the fresh mint keypair sign it."}];e.innerHTML=`<div class="apx panel">
    <div class="apx-tabs" role="tablist">${i.map((h,y)=>`<button role="tab" data-x="${y}"><span class="api-m m-${h.method.toLowerCase()}">${h.method}</span><code>${h.path}</code></button>`).join("")}</div>
    <div class="apx-body" data-o="x"></div></div>`;const p=h=>{const y=i[h];e.querySelectorAll("[data-x]").forEach(E=>{E.classList.toggle("on",+E.dataset.x===h),E.setAttribute("aria-selected",String(+E.dataset.x===h))}),e.querySelector('[data-o="x"]').innerHTML=`<p class="apx-note">${n(y.note)}</p>
      <div class="apx-cols"><div><span class="pixel">Request</span><pre class="json"><code>${I(y.req)}</code></pre></div>
      <div><span class="pixel">Response · 200</span><pre class="json"><code>${I(y.res)}</code></pre></div></div>`};return e.querySelectorAll("[data-x]").forEach(h=>h.addEventListener("click",()=>p(+h.dataset.x))),p(0),{val:o,quote:d,launch:u}}const _e=[{code:6e3,name:"NotInTransfer",msg:"Not inside a transfer of this mint. Direct calls and calls from another coin's hook are refused."},{code:6141,name:"MissingWalletRecord",msg:"The receiving token account has no Wallet record for this coin. Buy through hookrz once, or open the record first."},{code:6142,name:"HookLive",msg:"The hook is still live. Wallet records and the Stack close after graduation."},{code:6143,name:"StackLocked",msg:"Only the pool creator can initialize this coin's stack, and only once."}];function Me(){return`<div class="tscroll"><table class="table dc-etable"><thead><tr><th>Code</th><th>Block</th><th>Message, default settings</th></tr></thead><tbody>
    ${B.filter(t=>t.code!=null).sort((t,s)=>t.code-s.code).map(t=>`<tr><td class="mono code">${t.code}<small>${fe(t.code)}</small></td><td><a href="blocks.html?b=${t.id}">${n(t.name)}</a></td><td class="msg">${n(t.error(ve(t.id)))}${t.id==="custom"?`<span class="dim"> (or the rule's own <code>because</code> message)</span>`:""}</td></tr>`).join("")}
    <tr class="sep"><td colspan="3"><span class="pixel">Engine</span></td></tr>
    ${_e.map(t=>`<tr><td class="mono code">${t.code}<small>${t.name}</small></td><td class="mono">Engine</td><td class="msg">${n(t.msg)}</td></tr>`).join("")}
  </tbody></table></div>`}const ee={Creator:"c",hookrz:"p","Stack author":"a"};function ze(){const e=v.split.flatMap(s=>Array.from({length:s.pct},()=>ee[s.who]??"p")),t=1e3*v.tradeFeePct/100;return`<div class="fees">
    <div class="fees-grid" role="img" aria-label="${v.split.map(s=>`${s.who} ${s.pct}`).join(", ")} of every 100 fee units">${e.map((s,a)=>`<i class="t-${s}" style="--i:${a}"></i>`).join("")}</div>
    <div class="tscroll"><table class="table fees-table"><thead><tr><th>Who</th><th class="r">Of every 100</th><th class="r">Per 1,000 SOL traded</th><th>How it's paid</th></tr></thead><tbody>
      ${v.split.map(s=>`<tr><td><span class="fsw t-${ee[s.who]??"p"}"></span><b>${n(s.who)}</b></td><td class="mono r">${s.pct}</td><td class="mono r">${(t*s.pct/100).toFixed(2)} SOL</td><td class="note">${n(s.note)}</td></tr>`).join("")}
    </tbody><tfoot><tr><td><b>Trading fee</b></td><td class="mono r">100</td><td class="mono r">${t.toFixed(2)} SOL</td><td class="note">${v.tradeFeePct}% of every curve trade, buys and sells.</td></tr></tfoot></table></div>
  </div>
  <dl class="fees-facts">
    <div><dt>Launch</dt><dd><span class="mono">${v.launchCostSol} SOL</span> plus rent: <span class="mono">${k(c.stackBytes).toFixed(4)} SOL</span> for the Stack and about <span class="mono">${k(47).toFixed(4)} SOL</span> for a one-entry account list. The rent comes back after graduation.</dd></div>
    <div><dt>Wallet record</dt><dd><span class="mono">${k(c.walletRecordBytes).toFixed(4)} SOL</span> rent, only on stacks that keep per-holder records. Refunded to the holder after graduation.</dd></div>
    <div><dt>Refused transfer</dt><dd>The network fee only. Nothing settles, nothing else is charged.</dd></div>
  </dl>`}ge("docs");const f=document.getElementById("app"),m=e=>e.toLocaleString("en-US"),l=e=>`<code>${e}</code>`,te=e=>B.filter(e).length,O=B.filter(e=>e.state==="wallet"),se=e=>12+e*35;var oe;const $=((oe=v.split.find(e=>e.who==="Stack author"))==null?void 0:oe.pct)??10;var ne;const ae=((ne=v.split.find(e=>e.who==="Creator"))==null?void 0:ne.pct)??50;var re;const He=((re=v.split.find(e=>e.who==="hookrz"))==null?void 0:re.pct)??40,z=[["overview","Overview"],["blocks","Blocks & stacks"],["engine","The engine"],["launch","Launch"],["graduation","Graduation"],["routes","Routes & quotes"],["remix","Remix & royalties"],["fees","Fees"],["trust","Trust model"],["hookscript","Hookscript"],["api","API"],["errors","Error codes"],["faq","FAQ"]],b=(e,t,s)=>{const a=z.findIndex(r=>r[0]===e)+1;return`<header class="dc-shead"><div class="dc-num" aria-hidden="true">${$e(String(a),{cell:7,gap:1.2,glow:!1})}</div>
    <div><span class="eyebrow">${n(z[a-1][1])}</span><h2>${t}</h2>${s?`<p class="dc-lede">${s}</p>`:""}</div></header>`},P=(e,t,s="")=>`<aside class="dc-call ${s}"><span class="pixel">${e}</span><div>${t}</div></aside>`,je=[["Can the rules change after launch?",`No. ${l("init_stack")} writes the Stack once, inside the launch, and the engine has no instruction that edits it. The one creator power is Blocklist markers, and those freeze on the schedule set at launch. The only change any coin goes through is graduation, when Hook blocks retire.`],["What happens at graduation?","The DBC pool removes the hook in the swap that fills the curve, and the coin migrates to DAMM v2. Hook blocks stop, Crank blocks keep running on LP fees, Mint settings stay. Then anyone can close the Stack and the Wallet records to return their rent."],["Do aggregators work?","Yes. Aggregators read the hook's accounts from the mint like any Token-2022 hook. On stacks with wallet-record blocks, the receiving wallet needs its record first; one buy through hookrz opens it. After graduation there is no hook at all."],["Who pays the wallet-record rent?",`The wallet that gets the record, inside its first buy through hookrz: about ${k(c.walletRecordBytes).toFixed(4)} SOL. After graduation anyone can close the record, and the rent goes back to that wallet.`],["Can the creator rug with a rule?","A rule can only refuse a transfer; it can't move anyone's coins. Mint and freeze authority are none. The blocks that could trap holders are marked: Lock-in Phase shows in red on the coin page, Blocklist is labelled a creator power with its freeze date, and Custom blocks carry an unreviewed badge. Creator Vesting does the opposite: it locks the creator's own bag."],["How is this different from one-rule hook launchpads?","A mint can name only one hook program. Launchpads with a program per rule can give a coin one rule. hookrz gives every coin the same engine and a stack of up to six blocks that run together, plus remix lineage and a royalty for the stack's author."],["What does a refused transfer cost?","The network fee. The transaction fails before anything settles. Quotes run the stack before you sign, so most refusals are never sent."],["Can I run the keeper myself?","Yes. Every keeper instruction checks its own conditions on chain, so anyone can call them and the result is the same. hookrz runs one so nothing waits."]];f.innerHTML=`
<section class="dc-hero">
  <div class="wrap">
    <div class="dc-hero-grid">
      <div class="dc-hero-copy">
        <span class="eyebrow">Docs</span>
        <h1 class="chrome-text">How hookrz works</h1>
        <p class="lede">One Token-2022 transfer-hook program runs every coin's stack of rule blocks on every transfer. This is how it's built, what it refuses, who gets paid and what you can call.</p>
      </div>
      <img class="dc-hero-img" src="${G("img/brand/engine-rack-900.webp")}" alt="Six chrome blocks seated in the engine rack, a light cable running through them" width="900" height="506">
    </div>
    <dl class="dc-facts">
      <div><dt>Engine</dt><dd class="mono">${c.program}</dd></div>
      <div><dt>Slots per stack</dt><dd class="num">${c.maxSlots}</dd></div>
      <div><dt>CU per transfer</dt><dd class="num">${m(c.cuBudget)}</dd></div>
      <div><dt>Blocks</dt><dd class="num">${B.length}</dd></div>
      <div><dt>Launch</dt><dd>1 transaction</dd></div>
      <div><dt>Admin keys</dt><dd class="num">0</dd></div>
    </dl>
  </div>
</section>

<div class="wrap dc-layout">
  <nav class="dc-nav" aria-label="On this page">
    <span class="pixel dc-nav-t">On this page</span>
    <ol>${z.map(([e,t],s)=>`<li><a href="#${e}" data-nav="${e}"><span class="mono">${String(s+1).padStart(2,"0")}</span>${n(t)}</a></li>`).join("")}</ol>
    <a class="dc-nav-cta" href="blocks.html">Block catalog <span aria-hidden="true">→</span></a>
  </nav>
  <div class="dc-mnav"><label class="sr" for="dcSel">Jump to section</label>
    <select class="input" id="dcSel">${z.map(([e,t],s)=>`<option value="${e}">${String(s+1).padStart(2,"0")} · ${n(t)}</option>`).join("")}</select></div>

  <article class="dc-body">

  <section class="dc-sec" id="overview">
    ${b("overview","Build. Remix. Own.","A coin on hookrz is a token, a bonding curve and a stack of rules that Solana enforces on every transfer.")}
    <div class="dc-three">
      <div><span class="pixel">Build</span><p>Snap up to ${c.maxSlots} blocks into a stack: Guard, Pace, Burn, Flow, Crown or a Custom rule. Tune each one, check what it costs, launch. The coin, its curve and its rules go on chain in one transaction, and from the first trade the engine runs the stack on every transfer.</p></div>
      <div><span class="pixel">Remix</span><p>Every stack is public. One click loads a coin's stack into the builder; change a setting, swap a block, launch your own. The new Stack records its parent, so lineage lives on chain and every coin page shows where its rules came from.</p></div>
      <div><span class="pixel">Own</span><p>A stack's author earns ${$} of every 100 fee units on each coin that remixes it, one level up. Creators keep ${ae} on their own coin. Good rules get copied; here, copying pays the author.</p></div>
    </div>
    ${P("One hook per mint",`<p>A Token-2022 mint names exactly one transfer-hook program, fixed when the mint is created. A launchpad with a program per rule can give a coin one rule, and one that compiles a program per coin ships new code with every launch. hookrz points every mint at the same engine, ${l(c.program)}, and keeps the rules as data: a stack of up to ${c.maxSlots} blocks the engine runs in order. One program to audit, any combination of rules, and stacks that can be copied, credited and paid.</p>`,"key")}
  </section>

  <section class="dc-sec" id="blocks">
    ${b("blocks","Blocks and stacks",`A block is one rule with a few settings. A stack is up to ${c.maxSlots} blocks in order. Every block has a family, which says what it is about, and an enforcer, which says what makes it true.`)}
    <h3>Families</h3>
    <div class="tscroll"><table class="table dc-ftable"><thead><tr><th>Family</th><th>Answers</th><th class="r">Blocks</th><th>What's in it</th></tr></thead><tbody>
      ${ye.map(e=>`<tr><td><a href="blocks.html#${e.id}" class="dc-fam"><img src="${G(`img/brand/block-${e.id}-sm.webp`)}" alt="" width="240" height="240" loading="lazy">${e.name}</a></td><td>${n(e.verb)}</td><td class="mono r">${te(t=>t.family===e.id)}</td><td class="note">${n(e.blurb)}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>Enforcers</h3>
    <p>Not every rule belongs on the transfer path. A fee schedule is the curve's job; a buyback is a keeper's. Each block names who enforces it, and the badge shows on every card and coin page.</p>
    <div class="tscroll"><table class="table dc-xtable"><thead><tr><th>Enforcer</th><th>How</th><th class="r">Blocks</th><th>After graduation</th></tr></thead><tbody>
      ${[["hook","Retires: the pool removes the hook"],["curve","Applied in the migration (LP lock, leftovers)"],["crank","Keeps running on DAMM v2 LP fees"],["ext","Permanent"]].map(([e,t])=>`<tr><td><span class="enf ${e}"><i></i>${M[e].name}</span></td><td>${n(M[e].long)}.</td><td class="mono r">${te(s=>s.enforcedBy===e)}</td><td class="note">${t}</td></tr>`).join("")}
    </tbody></table></div>
    <h3>What every block declares</h3>
    <dl class="dc-dl">
      <div><dt>Block id</dt><dd>A ${l("u16")} in the Stack. The id picks the code the engine runs for that slot.</dd></div>
      <div><dt>Params</dt><dd>Settings with bounds, packed into the slot's 24 bytes. The builder won't let a value outside the bounds through, and neither will ${l("init_stack")}.</dd></div>
      <div><dt>State</dt><dd><b>None</b> reads only the transfer. <b>Stack slot</b> keeps counters in the slot's 32 bytes. <b>Wallet record</b> keeps per-holder data in a PDA (${O.length} blocks).</dd></div>
      <div><dt>Route</dt><dd><b>Any</b> works everywhere. <b>Wallet record</b> needs the receiver's record, which the hookrz router opens inside the buy.</dd></div>
      <div><dt>CU and accounts</dt><dd>What the block adds to every transfer: compute units, and entries in the mint's ExtraAccountMetaList.</dd></div>
      <div><dt>Error code</dt><dd>The custom error a refused transfer fails with. See <a href="#errors">Error codes</a>.</dd></div>
    </dl>
    <p class="dc-more"><a class="btn btn-glass btn-sm" href="blocks.html">Open the block catalog <span aria-hidden="true">→</span></a></p>
  </section>

  <section class="dc-sec" id="engine">
    ${b("engine","The engine",`${l(c.program)} is one Solana program. Every hookrz mint names it as its transfer hook. It holds no keys, makes no CPIs, and can do one thing to a transfer: refuse it.`)}
    <div class="dc-wide">${Se()}</div>
    <div class="dc-svc">${ce.map(e=>`<div><b>${n(e.name)}</b><span class="pixel">${n(e.kind)}</span><p>${n(e.blurb)}</p></div>`).join("")}</div>

    <h3>One transfer, step by step</h3>
    <ol class="dc-steps">
      <li><b>A trade moves the coin.</b> The hookrz router, an aggregator or a wallet sends it; Meteora DBC moves it with Token-2022 ${l("transfer_checked")}.</li>
      <li><b>Token-2022 calls the hook.</b> It moves the balance, sets the ${l("transferring")} flag on both token accounts, and calls the engine's ${l("Execute")} with the accounts listed in the mint's ExtraAccountMetaList.</li>
      <li><b>The engine checks it's inside a real transfer of this mint.</b> Source and destination must be token accounts of this mint, and the source's ${l("TransferHookAccount.transferring")} flag must be set. The engine makes no CPIs, so that flag can only come from a genuine transfer of this coin. A direct call, or a call from another coin's hook, is refused (${l(w(6e3))}).</li>
      <li><b>It classifies the transfer</b> against the DBC base vault stored in the Stack.</li>
      <li><b>It runs the Hook blocks in slot order.</b> Each reads the transfer, its slot state and, if it keeps one, the Wallet record.</li>
      <li><b>The first refusal ends it.</b> The engine returns that block's custom error and the whole transaction fails. If nothing refuses, it writes the updated counters and the transfer settles.</li>
    </ol>
    <div class="tscroll"><table class="table dc-ktable"><thead><tr><th>Kind</th><th>Source</th><th>Destination</th><th>Typical</th></tr></thead><tbody>
      <tr><td><b>Buy</b></td><td>DBC base vault</td><td>any token account</td><td class="note">A swap on the curve, through any route</td></tr>
      <tr><td><b>Sell</b></td><td>any token account</td><td>DBC base vault</td><td class="note">A swap back into the curve</td></tr>
      <tr><td><b>Send</b></td><td colspan="2">anything else</td><td class="note">Wallet to wallet, or a trade on another venue</td></tr>
    </tbody></table></div>

    <h3>Accounts</h3>
    <p>A coin with Hook blocks has two accounts of its own, plus one Wallet record per holder if a block keeps per-holder data. All three are PDAs of the engine.</p>
    <div class="dc-acct">
      <div class="dc-acct-h"><h4>Stack</h4><code>["stack", mint]</code><span class="mono">${c.stackBytes} bytes · ${x(k(c.stackBytes))}</span></div>
      <p>The coin's rules and lineage. Written once by ${l("init_stack")}; writable on every transfer so blocks can keep counters.</p>
      ${j(V,c.stackBytes)}
      ${L(V,{total:c.stackBytes})}
      <h5>Each slot</h5>
      ${L(Ae)}
    </div>
    <div class="dc-acct">
      <div class="dc-acct-h"><h4>ExtraAccountMetaList</h4><code>["extra-account-metas", mint]</code><span class="mono">12 + 35 per entry</span></div>
      <p>The Token-2022 standard list of extra accounts the hook needs. Wallets, routers and aggregators read it to build any transfer of the coin. ${l("init_stack")} writes only the entries the stack's blocks need: Fair Launch needs one (${se(1)} bytes, ${x(k(se(1)))}); the limit is ${c.maxExtraAccounts} plus the Stack.</p>
      ${Be()}
    </div>
    <div class="dc-acct">
      <div class="dc-acct-h"><h4>Wallet record</h4><code>["w", mint, token account]</code><span class="mono">${c.walletRecordBytes} bytes · ${x(k(c.walletRecordBytes))}</span></div>
      <p>Per-holder memory for ${O.map(e=>e.name).join(", ")}. Keyed by token account, so it follows the account, not the owner. Each receipt is its own lot, so a new buy never extends an old one; receipts are bucketed to a quarter of the hold, so five lots always cover the live window, and zero-amount transfers are ignored.</p>
      ${j(J,c.walletRecordBytes)}
      ${L(J,{total:c.walletRecordBytes})}
    </div>

    <h3>Limits</h3>
    <div class="tscroll"><table class="table dc-limits"><tbody>
      <tr><td>Blocks per stack</td><td class="mono r">${c.maxSlots}</td><td class="note">One of each block at most.</td></tr>
      <tr><td>Compute per transfer</td><td class="mono r">${m(c.cuBudget)} CU</td><td class="note">The whole stack, on top of the swap. The engine's own dispatch, account checks and classification cost ${m(c.cuBase)}.</td></tr>
      <tr><td>Extra accounts</td><td class="mono r">${c.maxExtraAccounts} + Stack</td><td class="note">Keeps every hooked swap inside one transaction with room for the route.</td></tr>
      <tr><td>Hookscript</td><td class="mono r">8,000 CU · 1,024 B</td><td class="note">Per script, worst case. The compiler computes it from op costs measured on Solana's VM; the fuzzer confirms it.</td></tr>
      <tr><td>Launch transaction</td><td class="mono r">1,232 bytes</td><td class="note">The Solana packet limit. Every stack fits.</td></tr>
    </tbody></table></div>
    <p>${l("POST /v1/stacks/validate")} checks a stack against every limit before it can launch. Here is its output for the presets, computed live by the same code:</p>
    <div class="dc-wide" id="budgetPanel"></div>
  </section>

  <section class="dc-sec" id="launch">
    ${b("launch","One transaction, rules armed first","The coin, its curve and its rules go on chain together, in one transaction the creator signs. Nobody can trade the coin before its rules are armed.")}
    ${Ce()}
    <div id="txBar" class="dc-txbar"></div>
    ${P("Armed before the first trade",`<p>Only the pool creator can call ${l("init_stack")}, and only once (${l(w(6143))} otherwise). Until it runs, the mint's ExtraAccountMetaList doesn't exist, so Token-2022 can't resolve the hook's accounts and no transfer of the coin can succeed. The creator's first buy, if there is one, comes after ${l("init_stack")} in the same transaction.</p>`)}
    <p>A stack with no Hook blocks skips ${l("init_stack")}: the mint is created without a transfer hook and trades on every route with no extra accounts. Curve, Crank and Mint blocks still apply.</p>
  </section>

  <section class="dc-sec" id="graduation">
    ${b("graduation","Graduation","When the curve fills, Meteora migrates the coin to a DAMM v2 pool. DAMM v2 doesn't take transfer-hook mints, so Hook blocks are launch-phase rules by design.")}
    <div class="grad">
      <div><span class="pixel">On the curve</span><b>Hook live</b><p>The stack runs on every transfer. Records fill up.</p></div>
      <div class="hi"><span class="pixel">Graduating swap</span><b>Hook removed</b><p>The DBC pool, the mint's transfer-hook authority, clears the hook in the swap that fills the curve.</p></div>
      <div><span class="pixel">DAMM v2</span><b>Plain Token-2022</b><p>No hook, every route. Crank blocks keep paying out from LP fees.</p></div>
    </div>
    <div class="tscroll"><table class="table"><thead><tr><th>Enforcer</th><th>On the curve</th><th>After graduation</th></tr></thead><tbody>
      <tr><td><span class="enf hook"><i></i>Hook</span></td><td>Runs on every transfer</td><td>Retired. The mint keeps its TransferHook extension, with an empty program id.</td></tr>
      <tr><td><span class="enf curve"><i></i>Curve</span></td><td>Fee scheduler, fee split</td><td>Migration settings apply once: LP Lock, Leftover Burn.</td></tr>
      <tr><td><span class="enf crank"><i></i>Crank</span></td><td>Keeper spends the creator's DBC fees</td><td>Keeper spends DAMM v2 LP fees. Royalties keep flowing.</td></tr>
      <tr><td><span class="enf ext"><i></i>Mint</span></td><td>Fixed at creation</td><td>Unchanged.</td></tr>
    </tbody></table></div>
    <h3>Getting the rent back</h3>
    <p>Once the hook is gone, the engine's accounts have no job left. Anyone can close them; the rent goes to whoever it belongs to, not to the caller.</p>
    <div class="tscroll"><table class="table"><thead><tr><th>Instruction</th><th>Closes</th><th>Rent goes to</th><th>Who can call</th></tr></thead><tbody>
      <tr><td class="mono">close_wallet_record</td><td>One Wallet record</td><td>The token account's owner (${x(k(c.walletRecordBytes))})</td><td>Anyone</td></tr>
      <tr><td class="mono">close_stack</td><td>Stack + ExtraAccountMetaList</td><td>The pool creator recorded on chain</td><td>Anyone</td></tr>
    </tbody></table></div>
    ${P("Refused while the hook is live",`<p>Both instructions fail with ${l(w(6142))} until graduation; closing a record early would let a holder slip a Hold Timer or a Cooldown. Liveness is read from the mint itself: the hook counts as retired only when the TransferHook extension is present and names a program other than ${l(c.program)}. A closed Stack can never make a live coin look graduated, and the coin page keeps explaining the retired rules after the accounts close.</p>`,"warn")}
  </section>

  <section class="dc-sec" id="routes">
    ${b("routes","Routes and quotes","A transfer hook travels with the coin: any program that moves it has to pass the hook's accounts, which it reads from the mint's ExtraAccountMetaList. Most of the time that just works.")}
    <div class="tscroll"><table class="table dc-rtable"><thead><tr><th>The stack has</th><th>hookrz router</th><th>Aggregators</th><th>Wallet to wallet</th></tr></thead><tbody>
      <tr><td>No Hook blocks</td><td class="y">Yes</td><td class="y">Yes, no hook at all</td><td class="y">Yes</td></tr>
      <tr><td>Hook blocks without records</td><td class="y">Yes</td><td class="y">Yes</td><td class="y">Yes, send rules apply</td></tr>
      <tr><td>Wallet-record blocks</td><td class="y">Yes, opens the record in the buy</td><td class="p">Once the receiver has a record</td><td class="p">Receiver needs a record</td></tr>
      <tr><td>After graduation</td><td class="y">Yes</td><td class="y">Yes</td><td class="y">Yes</td></tr>
    </tbody></table></div>
    <h3>Wallet records</h3>
    <p>${O.length} blocks remember things per holder: ${O.map(e=>`<a href="blocks.html?b=${e.id}">${n(e.name)}</a>`).join(", ")}. A transfer to a token account without a record is refused (${l(w(6141))}), because the engine has nowhere to write the receipt. The router opens the record inside the buy, so buying on hookrz always works, and aggregator routes work from then on. Anyone can open a record for any token account with ${l("open_wallet_record")}.</p>
    <ul class="dc-list">
      <li>Only an account owned by the engine counts as a record. Sending lamports to a record's address can't block anyone's buy.</li>
      <li>The DBC SDK fills hook accounts with placeholder keys when it builds a swap. The API re-resolves them for the real transfer, so what it returns is ready to sign.</li>
    </ul>
    <h3>Rule-aware quotes</h3>
    <p>Before you sign, ${l("POST /v1/quote")} runs the stack against your trade with the engine's reference code. If a block would refuse, the quote names it, gives its error, and returns ${l("maxAllowed")}: the largest amount that passes right now, which the trade ticket offers in one tap. The reference code and the program share test vectors, so the quote and the chain agree. If the market moves between quote and landing, the chain refuses with the same code and the page shows the same sentence.</p>
    <div class="dc-wide dc-quote" id="quoteEx"><div class="skel" style="height:200px"></div></div>
  </section>

  <section class="dc-sec" id="remix">
    ${b("remix","Remix and royalties","Every stack is public, and every coin page has a Remix button. A remix loads the parent's blocks and settings into the builder; change anything, then launch.")}
    <p>Lineage is on chain. ${l("init_stack")} reads the parent's Stack account and copies its address and its creator into the new Stack (${l("parent_stack")}, ${l("parent_author")}). A link can't point at a stack that doesn't exist, and the author is whoever really launched the parent.</p>
    <div class="dc-wide">
      <div class="tree" role="img" aria-label="Royalties go one level up">
        <div class="tree-node"><span class="pixel">Original</span><b>Stack by Ada</b><small>Ada's own coin: she is creator and author. She keeps the ${$}.</small></div>
        <div class="tree-edge"><span class="mono">${$} of 100 → Ada</span></div>
        <div class="tree-node"><span class="pixel">Remix</span><b>Ben's coin</b><small>Pays Ada ${$} of every 100 fee units.</small></div>
        <div class="tree-edge"><span class="mono">${$} of 100 → Ben</span></div>
        <div class="tree-node"><span class="pixel">Remix of a remix</span><b>Cy's coin</b><small>Pays Ben, its direct parent. Ada gets nothing from Cy.</small></div>
      </div>
    </div>
    <ul class="dc-list">
      <li><b>${$} of every 100 fee units</b> on the child coin go to the parent's author.</li>
      <li><b>One level only.</b> A remix pays its direct parent, never a grandparent, so royalties can't pile up into a pyramid and a remix never pays more than ${$}.</li>
      <li><b>Paid by the keeper from the platform share.</b> The DBC pool splits the fee between creator and platform; the keeper moves the author's part to a royalty vault every hour. Claim it with ${l("POST /v1/fees/claim/prepare")}.</li>
      <li><b>Originals keep it.</b> On a coin with no parent, the author is the creator.</li>
      <li><b>It doesn't stop at graduation.</b> LP fees on DAMM v2 are split the same way.</li>
    </ul>
  </section>

  <section class="dc-sec" id="fees">
    ${b("fees","Fees",`Every trade on the curve pays a ${v.tradeFeePct}% fee, split the same way on every coin.`)}
    <div class="dc-wide">${ze()}</div>
    ${P("Crank blocks spend the creator's share",`<p>Buybacks, rewards, rebates and tithes come out of the creator's ${ae}, never out of holders' trades or the platform's ${He}. Sniper Fee → Burn is the one exception to the split: during its decay, everything above the 1% base buys the coin back and burns it.</p>`)}
  </section>

  <section class="dc-sec" id="trust">
    ${b("trust","Trust model","What you have to trust, and what you don't.")}
    <div class="trust">
      <div><b>hookrz holds no keys.</b><p>The API builds unsigned transactions and your wallet signs them. hookrz never holds a coin, a fee vault or a user's key.</p></div>
      <div><b>The engine can only refuse.</b><p>It returns Ok or a custom error. It never moves, mints, burns or freezes tokens, and it makes no CPIs.</p></div>
      <div><b>No admin instruction.</b><p>Nothing can edit a live coin's rules. ${l("init_stack")} runs once, signed by the pool creator, inside the launch.</p></div>
      <div><b>A stack is immutable.</b><p>Blocks, settings and order are fixed at init. The one creator power is Blocklist: markers can be added until the list freezes on its schedule, and the coin page shows it.</p></div>
      <div><b>No mint or freeze authority.</b><p>Both are none after the launch transaction. With Locked Metadata, the metadata update authority is none too.</p></div>
      <div><b>Only the pool removes the hook.</b><p>The DBC pool is the mint's transfer-hook authority and clears the hook only in the graduating swap.</p></div>
      <div class="wide"><b>Upgrade authority: multisig, then none.</b><p>The engine's upgrade authority is held by a multisig until the independent audit is complete. Then it is set to none and ${l(c.program)} can never change.</p></div>
    </div>
    <h3>Hardening</h3>
    <ul class="dc-list">
      <li><b>No forged calls.</b> The engine acts only inside a real transfer of the coin it is called for, so another coin's hook can't call it mid-transfer to write a holder's record.</li>
      <li><b>Dust can't extend a lock.</b> Each receipt is its own lot with its own time. Sending someone a single raw unit just before their unlock locks only that unit.</li>
      <li><b>The pool layout is pinned.</b> Blocks that read the DBC pool (Circuit Breaker, Lock-in Phase, Chapters) check that it names this mint and base vault before reading price or progress, so a layout change refuses loudly instead of misreading. DBC writes the post-trade price first, so the breaker judges the price a sell actually lands at.</li>
      <li><b>Pre-funded addresses don't count.</b> Only an account owned by the engine is a Wallet record.</li>
      <li><b>Liveness comes from the mint.</b> Graduation is read from the mint's hook extension, never from hookrz's own accounts.</li>
    </ul>
    <h3>Known limits</h3>
    <ul class="dc-list dim-list">
      <li>Every transfer of a coin writes its Stack, so a coin's transfers run one after another, not in parallel. That's fine for a launch-phase coin, and spam pays its own fees.</li>
      <li>A token account that isn't an associated token account, and lacks ImmutableOwner, can change owner with ${l("SetAuthority")}. Its Wallet record stays with the account.</li>
      <li>A trade on another venue counts as a send: send rules such as Max Wallet, Hold Timer and Blocklist apply, buy and sell rules don't.</li>
      <li>The pool collects fees in SOL, so fee claims never move the coin and never count as buys.</li>
    </ul>
  </section>

  <section class="dc-sec" id="hookscript">
    ${b("hookscript","Hookscript","The Custom block runs a rule you describe in English. The drafter writes it in Hookscript, a small rule language; the compiler turns it into bytecode the engine runs inside its own budget; and it's fuzzed and checked for honeypots before you can launch it.")}
    <div class="hs-grid">
      <div>
        <h3>What it can read</h3>
        <div class="tscroll"><table class="table dc-hstable"><tbody>
          ${[["transfer.kind","buy · sell · send"],["transfer.amount","tokens in this transfer; also value (SOL), trader, from, to, app"],["wallet.balance","the trader's balance before the transfer; sender, receiver, buyer, seller work too"],["wallet.held","time since this account first got the coin"],["wallet.received(window: 1h)","tokens in within the window; sent(window) for tokens out"],["wallet.bought · wallet.sells","running totals and counts per wallet"],["curve.price · curve.progress","after this trade; also mcap, raised and the current fee"],["curve.price_at(ago: 10m)","the coin's own price a while back"],["coin.age · coin.creator","time since launch, the creator; and the script's own globals"],['clock.hour(tz: "Asia/Tokyo")',"any clock field in any zone, daylight saving included"],["daylight() · moon.phase","is the sun up somewhere; the moon tonight"]].map(([e,t])=>`<tr><td class="mono">${de(e)}</td><td class="note">${n(t)}</td></tr>`).join("")}
        </tbody></table></div>
      </div>
      <div>
        <h3>What it can do</h3>
        <p>Refuse, with a message: ${l('refuse if &lt;condition&gt; because "…"')}. The trader sees the message with error ${l(w(6128))}. It can also keep state between transfers: coin-wide ${l("global")} values and a few bytes per wallet, written only when the transfer is allowed. That is enough for games: a King of the Hill crown, every-100th-buy jackpots, invite chains. ${l("payout 50% to king")} tells the public keeper where to send creator fees; the engine itself never moves funds.</p>
        <h3>Limits</h3>
        <ul class="dc-list">
          <li>No loops and no calls out. Branches, comparisons, arithmetic, bounded built-ins and the reads on the left.</li>
          <li>At most ${m(1024)} bytes of bytecode, ${m(256)} bytes of coin state and 32 bytes per wallet.</li>
          <li>At most ${m(8e3)} CU, worst case, or it doesn't compile. The compiler computes the worst path from op costs measured on Solana's VM.</li>
          <li>Fuzzed against ${m(1e4)} generated trades before launch: zero panics required, and the refusal rate is shown.</li>
          <li>Honeypot check: in every generated launch each holder must be able to sell out with nobody else trading, and a bank run must get through. A script that can trap holders can't launch.</li>
          <li>The coin page shows an <span class="chip warnchip">Unreviewed</span> badge until a reviewer signs off.</li>
        </ul>
      </div>
    </div>
    <div class="dc-wide hs-ex" id="hsEx"><div class="skel" style="height:240px"></div></div>
    <div class="dc-acct dc-wide">
      <div class="dc-acct-h"><h4>Script</h4><code>["script", mint]</code><span class="mono">${m(c.scriptBytes)} bytes · ${x(k(c.scriptBytes))}</span></div>
      <p>Written by ${l("init_stack")} in the launch (long scripts are staged first with ${l("write_script")}). The bytecode is final; the globals change only when a transfer the script allowed lands. The compiler is deterministic, so anyone can recompile the source shown on the coin page and compare the bytes.</p>
      ${j(Q,c.scriptBytes)}
      ${L(Q,{total:c.scriptBytes})}
    </div>
  </section>

  <section class="dc-sec" id="api">
    ${b("api","API","The site uses exactly these endpoints. The API builds unsigned transactions and never holds keys.")}
    <div class="dc-wide">${Oe()}</div>
    <h3>Examples</h3>
    <div class="dc-wide" id="apiEx"><div class="skel" style="height:360px"></div></div>
  </section>

  <section class="dc-sec" id="errors">
    ${b("errors","Error codes",`A refused transfer fails with a custom program error from ${l(c.program)}. The transaction fails with ${l("InstructionError: Custom(6003)")} and the program log names it (${l("MaxWalletExceeded")}); hookrz shows the sentence.`)}
    <div class="dc-wide">${Me()}</div>
  </section>

  <section class="dc-sec" id="faq">
    ${b("faq","FAQ")}
    <div class="faq">${je.map(([e,t])=>`<div><h4>${n(e)}</h4><p>${t}</p></div>`).join("")}</div>
    <div class="dc-end panel"><div><h3>Ready to build?</h3><p class="muted">Start from a preset or a blank rack. The builder checks every limit on this page as you go.</p></div>
      <div class="row wrap-row" style="gap:10px"><a class="btn btn-chrome" href="build.html">Build a coin <svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8h11M9 4l4 4-4 4"/></svg></a><a class="btn btn-glass" href="stacks.html">Browse stacks</a></div></div>
  </section>
  </article>
</div>`;Ee(f.querySelector("#budgetPanel"));const F=[],qe="King of the Hill: the biggest buy takes the crown, and the king can't sell for 6h unless someone outbids them";F.push(Pe(f.querySelector("#apiEx")).then(({quote:e,launch:t})=>{f.querySelector("#txBar").innerHTML=Le(t.txBytes,t.txLimit),f.querySelector("#quoteEx").innerHTML=he(e)}));F.push(S.draftHookscript(qe).then(e=>{var s,a,r;const t=e.honeypot??{};f.querySelector("#hsEx").innerHTML=`<div class="hs-card panel"><div class="hs-top"><span class="pixel">Draft</span><p>“${n(e.prompt)}”</p><span class="chip warnchip">Unreviewed</span></div>
    <pre class="hs-code"><code>${de(e.script)}</code></pre>
    <dl class="hs-stats"><div><dt>Bytes</dt><dd class="num">${m(e.bytes)}<small> / 1,024</small></dd></div><div><dt>Worst CU</dt><dd class="num">${m(e.cu)}<small> / 8,000</small></dd></div><div><dt>Fuzzed</dt><dd class="num">${m(((s=e.fuzz)==null?void 0:s.trades)??0)}</dd></div><div><dt>Refused</dt><dd class="num">${((a=e.fuzz)==null?void 0:a.refusedPct)??0}%</dd></div><div><dt>Panics</dt><dd class="num">${((r=e.fuzz)==null?void 0:r.panics)??0}</dd></div><div><dt>Honeypot</dt><dd class="${t.ok?"hs-pass":"hs-fail"}">${t.ok?"Passed":"Failed"}</dd></div></dl>
    <p class="dim hs-try">Edit it, test transfers against it and draft your own in the <a href="blocks.html?b=custom">Custom block</a>.</p></div>`}).catch(()=>{f.querySelector("#hsEx").innerHTML=""}));const Re={side:"sell",wallet:{balance:2e7},stack:T.find(e=>e.id==="slow-bleed").slots.map(([e])=>({id:e})),progress:.5,minutesAgo:600},Ie=e=>Math.abs(e-Math.round(e))<.01?Math.round(e):Math.floor(e);function he(e,t=15e6){const s=Ie(e.maxAllowed);return`<div class="qx panel">
    <div class="qx-req"><span class="pixel">POST /v1/quote</span><b>Sell <span class="mono">${m(t)}</span> tokens of a Slow Bleed coin</b><span class="dim">Wallet holds 20,000,000. Stack: Sell Cap 1%, Sell Cooldown, Circuit Breaker, Hourly Outflow Cap.</span></div>
    <div class="qx-res ${e.ok?"ok":"no"}"><span class="pixel">${e.ok?"Lands":`Refused · ${w(e.code)}`}</span><p>${n(e.message??`Passes every block. You'd get ${e.out.toFixed(3)} SOL.`)}</p>
      <div class="qx-row"><span>refusedBy</span><code>${n(e.refusedBy??"null")}</code><span>maxAllowed</span><code>${m(s)}</code></div>
      ${e.ok?t!==15e6?'<button class="btn btn-ghost btn-sm" type="button" data-q="15000000">Back to 15,000,000</button>':"":`<button class="btn btn-glass btn-sm" type="button" data-q="${s}">Quote ${m(s)} instead</button>`}</div>
  </div>`}f.addEventListener("click",async e=>{const t=e.target.closest("[data-q]");if(!t)return;t.disabled=!0;const s=+t.dataset.q,a=await S.quote({...Re,amount:s});f.querySelector("#quoteEx").innerHTML=he(a,s)});const ue=Object.fromEntries([...f.querySelectorAll("[data-nav]")].map(e=>[e.dataset.nav,e])),A=f.querySelector("#dcSel"),N=e=>{Object.values(ue).forEach(t=>t.classList.toggle("on",t.dataset.nav===e)),A.value!==e&&(A.value=e)},R=[...f.querySelectorAll(".dc-sec")],pe=()=>{const e=innerHeight*.28;let t=R[0].id;for(const s of R)s.getBoundingClientRect().top<=e&&(t=s.id);innerHeight+scrollY>=document.documentElement.scrollHeight-4&&(t=R.at(-1).id),N(t)};addEventListener("scroll",pe,{passive:!0});A.addEventListener("change",()=>{const e=document.getElementById(A.value);history.replaceState(history.state,"","#"+A.value),e==null||e.scrollIntoView({behavior:"smooth",block:"start"})});for(const e of Object.values(ue))e.addEventListener("click",t=>{var s;t.preventDefault(),history.replaceState(history.state,"","#"+e.dataset.nav),(s=document.getElementById(e.dataset.nav))==null||s.scrollIntoView({behavior:"smooth",block:"start"}),N(e.dataset.nav)});pe();const _=location.hash.slice(1);var ie;if(_&&document.getElementById(_)){let e=!1;["wheel","touchmove","keydown","mousedown"].forEach(s=>addEventListener(s,()=>{e=!0},{once:!0,passive:!0}));const t=()=>{e||(document.getElementById(_).scrollIntoView({block:"start",behavior:"instant"}),N(_))};requestAnimationFrame(t),(ie=document.fonts)==null||ie.ready.then(t),addEventListener("load",t,{once:!0}),Promise.all(F).then(()=>requestAnimationFrame(t))}
