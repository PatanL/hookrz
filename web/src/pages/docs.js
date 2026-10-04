import '../styles/base.css';
import '../styles/docs.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG, asset } from '../ui/voxel.js';
import { FAMILIES, ENFORCERS, ENGINE, BLOCKS, PRESETS, rentSol, hex } from '../data/blocks.js';
import { FEES, SERVICES } from '../api/contract.js';
import { api } from '../api/client.js';
import { esc } from '../core/format.js';
import { tintHookscript } from '../ui/docs-hookscript.js';
import { archDiagram, STACK_LAYOUT, SLOT_LAYOUT, WALLET_LAYOUT, byteMap, layoutTable, metaTable, budgetPanel, launchTimeline, txBar, solf } from '../ui/docs-engine.js';
import { apiReference, apiExamples, errorTable, feesVisual } from '../ui/docs-ref.js';

mountChrome('docs');
const app = document.getElementById('app');
const n = (x) => x.toLocaleString('en-US');
const c = (s) => `<code>${s}</code>`;
const count = (fn) => BLOCKS.filter(fn).length;
const recordBlocks = BLOCKS.filter((b) => b.state === 'wallet');
const metaBytes = (k) => 8 + 4 + k * 35;
const authorPct = FEES.split.find((s) => s.who === 'Stack author')?.pct ?? 10;
const creatorPct = FEES.split.find((s) => s.who === 'Creator')?.pct ?? 50;
const platformPct = FEES.split.find((s) => s.who === 'hookrz')?.pct ?? 40;

const SECTIONS = [
  ['overview', 'Overview'], ['blocks', 'Blocks & stacks'], ['engine', 'The engine'], ['launch', 'Launch'],
  ['graduation', 'Graduation'], ['routes', 'Routes & quotes'], ['remix', 'Remix & royalties'], ['fees', 'Fees'],
  ['trust', 'Trust model'], ['hookscript', 'Hookscript'], ['api', 'API'], ['errors', 'Error codes'], ['faq', 'FAQ'],
];
const head = (id, title, lede) => {
  const i = SECTIONS.findIndex((s) => s[0] === id) + 1;
  return `<header class="dc-shead"><div class="dc-num" aria-hidden="true">${voxelSVG(String(i), { cell: 7, gap: 1.2, glow: false })}</div>
    <div><span class="eyebrow">${esc(SECTIONS[i - 1][1])}</span><h2>${title}</h2>${lede ? `<p class="dc-lede">${lede}</p>` : ''}</div></header>`;
};
const callout = (title, body, cls = '') => `<aside class="dc-call ${cls}"><span class="pixel">${title}</span><div>${body}</div></aside>`;

const FAQ = [
  ['Can the rules change after launch?', `No. ${c('init_stack')} writes the Stack once, inside the launch, and the engine has no instruction that edits it. The one creator power is Blocklist markers, and those freeze on the schedule set at launch. The only change any coin goes through is graduation, when Hook blocks retire.`],
  ['What happens at graduation?', 'The DBC pool removes the hook in the swap that fills the curve, and the coin migrates to DAMM v2. Hook blocks stop, Crank blocks keep running on LP fees, Mint settings stay. Then anyone can close the Stack and the Wallet records to return their rent.'],
  ['Do aggregators work?', 'Yes. Aggregators read the hook\'s accounts from the mint like any Token-2022 hook. On stacks with wallet-record blocks, the receiving wallet needs its record first; one buy through hookrz opens it. After graduation there is no hook at all.'],
  ['Who pays the wallet-record rent?', `The wallet that gets the record, inside its first buy through hookrz: about ${rentSol(ENGINE.walletRecordBytes).toFixed(4)} SOL. After graduation anyone can close the record, and the rent goes back to that wallet.`],
  ['Can the creator rug with a rule?', 'A rule can only refuse a transfer; it can\'t move anyone\'s coins. Mint and freeze authority are none. The blocks that could trap holders are marked: Lock-in Phase shows in red on the coin page, Blocklist is labelled a creator power with its freeze date, and Custom blocks carry an unreviewed badge. Creator Vesting does the opposite: it locks the creator\'s own bag.'],
  ['How is this different from one-rule hook launchpads?', 'A mint can name only one hook program. Launchpads with a program per rule can give a coin one rule. hookrz gives every coin the same engine and a stack of up to six blocks that run together, plus remix lineage and a royalty for the stack\'s author.'],
  ['What does a refused transfer cost?', 'The network fee. The transaction fails before anything settles. Quotes run the stack before you sign, so most refusals are never sent.'],
  ['Can I run the keeper myself?', 'Yes. Every keeper instruction checks its own conditions on chain, so anyone can call them and the result is the same. hookrz runs one so nothing waits.'],
];

app.innerHTML = `
<section class="dc-hero">
  <div class="wrap">
    <div class="dc-hero-grid">
      <div class="dc-hero-copy">
        <span class="eyebrow">Docs</span>
        <h1 class="chrome-text">How hookrz works</h1>
        <p class="lede">One Token-2022 transfer-hook program runs every coin's stack of rule blocks on every transfer. This is how it's built, what it refuses, who gets paid and what you can call.</p>
      </div>
      <img class="dc-hero-img" src="${asset('img/brand/engine-rack-900.webp')}" alt="Six chrome blocks seated in the engine rack, a light cable running through them" width="900" height="506">
    </div>
    <dl class="dc-facts">
      <div><dt>Engine</dt><dd class="mono">${ENGINE.program}</dd></div>
      <div><dt>Slots per stack</dt><dd class="num">${ENGINE.maxSlots}</dd></div>
      <div><dt>CU per transfer</dt><dd class="num">${n(ENGINE.cuBudget)}</dd></div>
      <div><dt>Blocks</dt><dd class="num">${BLOCKS.length}</dd></div>
      <div><dt>Launch</dt><dd>1 transaction</dd></div>
      <div><dt>Admin keys</dt><dd class="num">0</dd></div>
    </dl>
  </div>
</section>

<div class="wrap dc-layout">
  <nav class="dc-nav" aria-label="On this page">
    <span class="pixel dc-nav-t">On this page</span>
    <ol>${SECTIONS.map(([id, t], i) => `<li><a href="#${id}" data-nav="${id}"><span class="mono">${String(i + 1).padStart(2, '0')}</span>${esc(t)}</a></li>`).join('')}</ol>
    <a class="dc-nav-cta" href="blocks.html">Block catalog <span aria-hidden="true">→</span></a>
  </nav>
  <div class="dc-mnav"><label class="sr" for="dcSel">Jump to section</label>
    <select class="input" id="dcSel">${SECTIONS.map(([id, t], i) => `<option value="${id}">${String(i + 1).padStart(2, '0')} · ${esc(t)}</option>`).join('')}</select></div>

  <article class="dc-body">

  <section class="dc-sec" id="overview">
    ${head('overview', 'Build. Remix. Own.', 'A coin on hookrz is a token, a bonding curve and a stack of rules that Solana enforces on every transfer.')}
    <div class="dc-three">
      <div><span class="pixel">Build</span><p>Snap up to ${ENGINE.maxSlots} blocks into a stack: Guard, Pace, Burn, Flow, Crown or a Custom rule. Tune each one, check what it costs, launch. The coin, its curve and its rules go on chain in one transaction, and from the first trade the engine runs the stack on every transfer.</p></div>
      <div><span class="pixel">Remix</span><p>Every stack is public. One click loads a coin's stack into the builder; change a setting, swap a block, launch your own. The new Stack records its parent, so lineage lives on chain and every coin page shows where its rules came from.</p></div>
      <div><span class="pixel">Own</span><p>A stack's author earns ${authorPct} of every 100 fee units on each coin that remixes it, one level up. Creators keep ${creatorPct} on their own coin. Good rules get copied; here, copying pays the author.</p></div>
    </div>
    ${callout('One hook per mint', `<p>A Token-2022 mint names exactly one transfer-hook program, fixed when the mint is created. A launchpad with a program per rule can give a coin one rule, and one that compiles a program per coin ships new code with every launch. hookrz points every mint at the same engine, ${c(ENGINE.program)}, and keeps the rules as data: a stack of up to ${ENGINE.maxSlots} blocks the engine runs in order. One program to audit, any combination of rules, and stacks that can be copied, credited and paid.</p>`, 'key')}
  </section>

  <section class="dc-sec" id="blocks">
    ${head('blocks', 'Blocks and stacks', `A block is one rule with a few settings. A stack is up to ${ENGINE.maxSlots} blocks in order. Every block has a family, which says what it is about, and an enforcer, which says what makes it true.`)}
    <h3>Families</h3>
    <div class="tscroll"><table class="table dc-ftable"><thead><tr><th>Family</th><th>Answers</th><th class="r">Blocks</th><th>What's in it</th></tr></thead><tbody>
      ${FAMILIES.map((f) => `<tr><td><a href="blocks.html#${f.id}" class="dc-fam"><img src="${asset(`img/brand/block-${f.id}-sm.webp`)}" alt="" width="240" height="240" loading="lazy">${f.name}</a></td><td>${esc(f.verb)}</td><td class="mono r">${count((b) => b.family === f.id)}</td><td class="note">${esc(f.blurb)}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>Enforcers</h3>
    <p>Not every rule belongs on the transfer path. A fee schedule is the curve's job; a buyback is a keeper's. Each block names who enforces it, and the badge shows on every card and coin page.</p>
    <div class="tscroll"><table class="table dc-xtable"><thead><tr><th>Enforcer</th><th>How</th><th class="r">Blocks</th><th>After graduation</th></tr></thead><tbody>
      ${[['hook', 'Retires: the pool removes the hook'], ['curve', 'Applied in the migration (LP lock, leftovers)'], ['crank', 'Keeps running on DAMM v2 LP fees'], ['ext', 'Permanent']].map(([e, after]) => `<tr><td><span class="enf ${e}"><i></i>${ENFORCERS[e].name}</span></td><td>${esc(ENFORCERS[e].long)}.</td><td class="mono r">${count((b) => b.enforcedBy === e)}</td><td class="note">${after}</td></tr>`).join('')}
    </tbody></table></div>
    <h3>What every block declares</h3>
    <dl class="dc-dl">
      <div><dt>Block id</dt><dd>A ${c('u16')} in the Stack. The id picks the code the engine runs for that slot.</dd></div>
      <div><dt>Params</dt><dd>Settings with bounds, packed into the slot's 24 bytes. The builder won't let a value outside the bounds through, and neither will ${c('init_stack')}.</dd></div>
      <div><dt>State</dt><dd><b>None</b> reads only the transfer. <b>Stack slot</b> keeps counters in the slot's 32 bytes. <b>Wallet record</b> keeps per-holder data in a PDA (${recordBlocks.length} blocks).</dd></div>
      <div><dt>Route</dt><dd><b>Any</b> works everywhere. <b>Wallet record</b> needs the receiver's record, which the hookrz router opens inside the buy.</dd></div>
      <div><dt>CU and accounts</dt><dd>What the block adds to every transfer: compute units, and entries in the mint's ExtraAccountMetaList.</dd></div>
      <div><dt>Error code</dt><dd>The custom error a refused transfer fails with. See <a href="#errors">Error codes</a>.</dd></div>
    </dl>
    <p class="dc-more"><a class="btn btn-glass btn-sm" href="blocks.html">Open the block catalog <span aria-hidden="true">→</span></a></p>
  </section>

  <section class="dc-sec" id="engine">
    ${head('engine', 'The engine', `${c(ENGINE.program)} is one Solana program. Every hookrz mint names it as its transfer hook. It holds no keys, makes no CPIs, and can do one thing to a transfer: refuse it.`)}
    <div class="dc-wide">${archDiagram()}</div>
    <div class="dc-svc">${SERVICES.map((s) => `<div><b>${esc(s.name)}</b><span class="pixel">${esc(s.kind)}</span><p>${esc(s.blurb)}</p></div>`).join('')}</div>

    <h3>One transfer, step by step</h3>
    <ol class="dc-steps">
      <li><b>A trade moves the coin.</b> The hookrz router, an aggregator or a wallet sends it; Meteora DBC moves it with Token-2022 ${c('transfer_checked')}.</li>
      <li><b>Token-2022 calls the hook.</b> It moves the balance, sets the ${c('transferring')} flag on both token accounts, and calls the engine's ${c('Execute')} with the accounts listed in the mint's ExtraAccountMetaList.</li>
      <li><b>The engine checks it's inside a real transfer of this mint.</b> Source and destination must be token accounts of this mint, and the source's ${c('TransferHookAccount.transferring')} flag must be set. The engine makes no CPIs, so that flag can only come from a genuine transfer of this coin. A direct call, or a call from another coin's hook, is refused (${c(hex(0x1770))}).</li>
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
      <div class="dc-acct-h"><h4>Stack</h4><code>["stack", mint]</code><span class="mono">${ENGINE.stackBytes} bytes · ${solf(rentSol(ENGINE.stackBytes))}</span></div>
      <p>The coin's rules and lineage. Written once by ${c('init_stack')}; writable on every transfer so blocks can keep counters.</p>
      ${byteMap(STACK_LAYOUT, ENGINE.stackBytes)}
      ${layoutTable(STACK_LAYOUT, { total: ENGINE.stackBytes })}
      <h5>Each slot</h5>
      ${layoutTable(SLOT_LAYOUT)}
    </div>
    <div class="dc-acct">
      <div class="dc-acct-h"><h4>ExtraAccountMetaList</h4><code>["extra-account-metas", mint]</code><span class="mono">${8 + 4} + 35 per entry</span></div>
      <p>The Token-2022 standard list of extra accounts the hook needs. Wallets, routers and aggregators read it to build any transfer of the coin. ${c('init_stack')} writes only the entries the stack's blocks need: Fair Launch needs one (${metaBytes(1)} bytes, ${solf(rentSol(metaBytes(1)))}); the limit is ${ENGINE.maxExtraAccounts} plus the Stack.</p>
      ${metaTable()}
    </div>
    <div class="dc-acct">
      <div class="dc-acct-h"><h4>Wallet record</h4><code>["w", mint, token account]</code><span class="mono">${ENGINE.walletRecordBytes} bytes · ${solf(rentSol(ENGINE.walletRecordBytes))}</span></div>
      <p>Per-holder memory for ${recordBlocks.map((b) => b.name).join(', ')}. Keyed by token account, so it follows the account, not the owner. Each receipt is its own lot, so a new buy never extends an old one; receipts are bucketed to a quarter of the hold, so five lots always cover the live window, and zero-amount transfers are ignored.</p>
      ${byteMap(WALLET_LAYOUT, ENGINE.walletRecordBytes)}
      ${layoutTable(WALLET_LAYOUT, { total: ENGINE.walletRecordBytes })}
    </div>

    <h3>Limits</h3>
    <div class="tscroll"><table class="table dc-limits"><tbody>
      <tr><td>Blocks per stack</td><td class="mono r">${ENGINE.maxSlots}</td><td class="note">One of each block at most.</td></tr>
      <tr><td>Compute per transfer</td><td class="mono r">${n(ENGINE.cuBudget)} CU</td><td class="note">The whole stack, on top of the swap. The engine's own dispatch, account checks and classification cost ${n(ENGINE.cuBase)}.</td></tr>
      <tr><td>Extra accounts</td><td class="mono r">${ENGINE.maxExtraAccounts} + Stack</td><td class="note">Keeps every hooked swap inside one transaction with room for the route.</td></tr>
      <tr><td>Custom block</td><td class="mono r">8,000 CU</td><td class="note">Worst case, measured by the compiler and the fuzzer.</td></tr>
      <tr><td>Launch transaction</td><td class="mono r">1,232 bytes</td><td class="note">The Solana packet limit. Every stack fits.</td></tr>
    </tbody></table></div>
    <p>${c('POST /v1/stacks/validate')} checks a stack against every limit before it can launch. Here is its output for the presets, computed live by the same code:</p>
    <div class="dc-wide" id="budgetPanel"></div>
  </section>

  <section class="dc-sec" id="launch">
    ${head('launch', 'One transaction, rules armed first', 'The coin, its curve and its rules go on chain together, in one transaction the creator signs. Nobody can trade the coin before its rules are armed.')}
    ${launchTimeline()}
    <div id="txBar" class="dc-txbar"></div>
    ${callout('Armed before the first trade', `<p>Only the pool creator can call ${c('init_stack')}, and only once (${c(hex(0x17ff))} otherwise). Until it runs, the mint's ExtraAccountMetaList doesn't exist, so Token-2022 can't resolve the hook's accounts and no transfer of the coin can succeed. The creator's first buy, if there is one, comes after ${c('init_stack')} in the same transaction.</p>`)}
    <p>A stack with no Hook blocks skips ${c('init_stack')}: the mint is created without a transfer hook and trades on every route with no extra accounts. Curve, Crank and Mint blocks still apply.</p>
  </section>

  <section class="dc-sec" id="graduation">
    ${head('graduation', 'Graduation', 'When the curve fills, Meteora migrates the coin to a DAMM v2 pool. DAMM v2 doesn\'t take transfer-hook mints, so Hook blocks are launch-phase rules by design.')}
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
      <tr><td class="mono">close_wallet_record</td><td>One Wallet record</td><td>The token account's owner (${solf(rentSol(ENGINE.walletRecordBytes))})</td><td>Anyone</td></tr>
      <tr><td class="mono">close_stack</td><td>Stack + ExtraAccountMetaList</td><td>The pool creator recorded on chain</td><td>Anyone</td></tr>
    </tbody></table></div>
    ${callout('Refused while the hook is live', `<p>Both instructions fail with ${c(hex(0x17fe))} until graduation; closing a record early would let a holder slip a Hold Timer or a Cooldown. Liveness is read from the mint itself: the hook counts as retired only when the TransferHook extension is present and names a program other than ${c(ENGINE.program)}. A closed Stack can never make a live coin look graduated, and the coin page keeps explaining the retired rules after the accounts close.</p>`, 'warn')}
  </section>

  <section class="dc-sec" id="routes">
    ${head('routes', 'Routes and quotes', 'A transfer hook travels with the coin: any program that moves it has to pass the hook\'s accounts, which it reads from the mint\'s ExtraAccountMetaList. Most of the time that just works.')}
    <div class="tscroll"><table class="table dc-rtable"><thead><tr><th>The stack has</th><th>hookrz router</th><th>Aggregators</th><th>Wallet to wallet</th></tr></thead><tbody>
      <tr><td>No Hook blocks</td><td class="y">Yes</td><td class="y">Yes, no hook at all</td><td class="y">Yes</td></tr>
      <tr><td>Hook blocks without records</td><td class="y">Yes</td><td class="y">Yes</td><td class="y">Yes, send rules apply</td></tr>
      <tr><td>Wallet-record blocks</td><td class="y">Yes, opens the record in the buy</td><td class="p">Once the receiver has a record</td><td class="p">Receiver needs a record</td></tr>
      <tr><td>After graduation</td><td class="y">Yes</td><td class="y">Yes</td><td class="y">Yes</td></tr>
    </tbody></table></div>
    <h3>Wallet records</h3>
    <p>${recordBlocks.length} blocks remember things per holder: ${recordBlocks.map((b) => `<a href="blocks.html?b=${b.id}">${esc(b.name)}</a>`).join(', ')}. A transfer to a token account without a record is refused (${c(hex(0x17fd))}), because the engine has nowhere to write the receipt. The router opens the record inside the buy, so buying on hookrz always works, and aggregator routes work from then on. Anyone can open a record for any token account with ${c('open_wallet_record')}.</p>
    <ul class="dc-list">
      <li>Only an account owned by the engine counts as a record. Sending lamports to a record's address can't block anyone's buy.</li>
      <li>The DBC SDK fills hook accounts with placeholder keys when it builds a swap. The API re-resolves them for the real transfer, so what it returns is ready to sign.</li>
    </ul>
    <h3>Rule-aware quotes</h3>
    <p>Before you sign, ${c('POST /v1/quote')} runs the stack against your trade with the engine's reference code. If a block would refuse, the quote names it, gives its error, and returns ${c('maxAllowed')}: the largest amount that passes right now, which the trade ticket offers in one tap. The reference code and the program share test vectors, so the quote and the chain agree. If the market moves between quote and landing, the chain refuses with the same code and the page shows the same sentence.</p>
    <div class="dc-wide dc-quote" id="quoteEx"><div class="skel" style="height:200px"></div></div>
  </section>

  <section class="dc-sec" id="remix">
    ${head('remix', 'Remix and royalties', 'Every stack is public, and every coin page has a Remix button. A remix loads the parent\'s blocks and settings into the builder; change anything, then launch.')}
    <p>Lineage is on chain. ${c('init_stack')} reads the parent's Stack account and copies its address and its creator into the new Stack (${c('parent_stack')}, ${c('parent_author')}). A link can't point at a stack that doesn't exist, and the author is whoever really launched the parent.</p>
    <div class="dc-wide">
      <div class="tree" role="img" aria-label="Royalties go one level up">
        <div class="tree-node"><span class="pixel">Original</span><b>Stack by Ada</b><small>Ada's own coin: she is creator and author. She keeps the ${authorPct}.</small></div>
        <div class="tree-edge"><span class="mono">${authorPct} of 100 → Ada</span></div>
        <div class="tree-node"><span class="pixel">Remix</span><b>Ben's coin</b><small>Pays Ada ${authorPct} of every 100 fee units.</small></div>
        <div class="tree-edge"><span class="mono">${authorPct} of 100 → Ben</span></div>
        <div class="tree-node"><span class="pixel">Remix of a remix</span><b>Cy's coin</b><small>Pays Ben, its direct parent. Ada gets nothing from Cy.</small></div>
      </div>
    </div>
    <ul class="dc-list">
      <li><b>${authorPct} of every 100 fee units</b> on the child coin go to the parent's author.</li>
      <li><b>One level only.</b> A remix pays its direct parent, never a grandparent, so royalties can't pile up into a pyramid and a remix never pays more than ${authorPct}.</li>
      <li><b>Paid by the keeper from the platform share.</b> The DBC pool splits the fee between creator and platform; the keeper moves the author's part to a royalty vault every hour. Claim it with ${c('POST /v1/fees/claim/prepare')}.</li>
      <li><b>Originals keep it.</b> On a coin with no parent, the author is the creator.</li>
      <li><b>It doesn't stop at graduation.</b> LP fees on DAMM v2 are split the same way.</li>
    </ul>
  </section>

  <section class="dc-sec" id="fees">
    ${head('fees', 'Fees', `Every trade on the curve pays a ${FEES.tradeFeePct}% fee, split the same way on every coin.`)}
    <div class="dc-wide">${feesVisual()}</div>
    ${callout('Crank blocks spend the creator\'s share', `<p>Buybacks, rewards, rebates and tithes come out of the creator's ${creatorPct}, never out of holders' trades or the platform's ${platformPct}. Sniper Fee → Burn is the one exception to the split: during its decay, everything above the 1% base buys the coin back and burns it.</p>`)}
  </section>

  <section class="dc-sec" id="trust">
    ${head('trust', 'Trust model', 'What you have to trust, and what you don\'t.')}
    <div class="trust">
      <div><b>hookrz holds no keys.</b><p>The API builds unsigned transactions and your wallet signs them. hookrz never holds a coin, a fee vault or a user's key.</p></div>
      <div><b>The engine can only refuse.</b><p>It returns Ok or a custom error. It never moves, mints, burns or freezes tokens, and it makes no CPIs.</p></div>
      <div><b>No admin instruction.</b><p>Nothing can edit a live coin's rules. ${c('init_stack')} runs once, signed by the pool creator, inside the launch.</p></div>
      <div><b>A stack is immutable.</b><p>Blocks, settings and order are fixed at init. The one creator power is Blocklist: markers can be added until the list freezes on its schedule, and the coin page shows it.</p></div>
      <div><b>No mint or freeze authority.</b><p>Both are none after the launch transaction. With Locked Metadata, the metadata update authority is none too.</p></div>
      <div><b>Only the pool removes the hook.</b><p>The DBC pool is the mint's transfer-hook authority and clears the hook only in the graduating swap.</p></div>
      <div class="wide"><b>Upgrade authority: multisig, then none.</b><p>The engine's upgrade authority is held by a multisig until the independent audit is complete. Then it is set to none and ${c(ENGINE.program)} can never change.</p></div>
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
      <li>A token account that isn't an associated token account, and lacks ImmutableOwner, can change owner with ${c('SetAuthority')}. Its Wallet record stays with the account.</li>
      <li>A trade on another venue counts as a send: send rules such as Max Wallet, Hold Timer and Blocklist apply, buy and sell rules don't.</li>
      <li>The pool collects fees in SOL, so fee claims never move the coin and never count as buys.</li>
    </ul>
  </section>

  <section class="dc-sec" id="hookscript">
    ${head('hookscript', 'Hookscript', 'The Custom block runs a rule you describe in English. The compiler drafts it in Hookscript, a small rule language the engine runs inside its own budget, and tests it before you can launch it.')}
    <div class="hs-grid">
      <div>
        <h3>What it can read</h3>
        <div class="tscroll"><table class="table dc-hstable"><tbody>
          ${[['transfer.kind', 'buy · sell · send'], ['transfer.amount', 'tokens in this transfer'], ['wallet.balance', 'sender\'s balance before the transfer'], ['wallet.received(window)', 'tokens received within the window'], ['wallet.first_receipt', 'when this account first got the coin'], ['clock.now', 'unix time'], ['clock.weekday', 'mon … sun, UTC'], ['clock.hour', '0 – 23, UTC'], ['curve.price', 'price after this trade'], ['curve.price_at(ago)', 'price a while ago, from the slot\'s samples'], ['curve.progress', 'share of the curve filled, 0 – 1']].map(([k, v]) => `<tr><td class="mono">${tintHookscript(k)}</td><td class="note">${esc(v)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div>
        <h3>What it can do</h3>
        <p>Refuse, with a message: ${c('refuse if &lt;condition&gt; because "…"')}. The trader sees the message with error ${c(hex(0x17f0))}. That's the whole surface.</p>
        <h3>Limits</h3>
        <ul class="dc-list">
          <li>No loops and no calls out. Comparisons, arithmetic and the reads on the left.</li>
          <li>At most 8,000 CU, worst case, or it doesn't compile.</li>
          <li>16 ops and three constants: it lives in the Stack's script area and its slot.</li>
          <li>Fuzzed against 10,000 generated trades before launch. Zero panics required; the refusal rate is shown.</li>
          <li>The coin page shows an <span class="chip warnchip">Unreviewed</span> badge until a reviewer signs off.</li>
        </ul>
      </div>
    </div>
    <div class="dc-wide hs-ex" id="hsEx"><div class="skel" style="height:240px"></div></div>
  </section>

  <section class="dc-sec" id="api">
    ${head('api', 'API', 'The site uses exactly these endpoints. The API builds unsigned transactions and never holds keys.')}
    <div class="dc-wide">${apiReference()}</div>
    <h3>Examples</h3>
    <div class="dc-wide" id="apiEx"><div class="skel" style="height:360px"></div></div>
  </section>

  <section class="dc-sec" id="errors">
    ${head('errors', 'Error codes', `A refused transfer fails with a custom program error from ${c(ENGINE.program)}. The transaction fails with ${c('InstructionError: Custom(6003)')} and the program log names it (${c('MaxWalletExceeded')}); hookrz shows the sentence.`)}
    <div class="dc-wide">${errorTable()}</div>
  </section>

  <section class="dc-sec" id="faq">
    ${head('faq', 'FAQ')}
    <div class="faq">${FAQ.map(([q, a]) => `<div><h4>${esc(q)}</h4><p>${a}</p></div>`).join('')}</div>
    <div class="dc-end panel"><div><h3>Ready to build?</h3><p class="muted">Start from a preset or a blank rack. The builder checks every limit on this page as you go.</p></div>
      <div class="row wrap-row" style="gap:10px"><a class="btn btn-chrome" href="build.html">Build a coin <svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 8h11M9 4l4 4-4 4"/></svg></a><a class="btn btn-glass" href="stacks.html">Browse stacks</a></div></div>
  </section>
  </article>
</div>`;

// ── live panels
budgetPanel(app.querySelector('#budgetPanel'));
const fillLater = [];
fillLater.push(apiExamples(app.querySelector('#apiEx')).then(({ quote, launch }) => {
  app.querySelector('#txBar').innerHTML = txBar(launch.txBytes, launch.txLimit);
  app.querySelector('#quoteEx').innerHTML = quotePanel(quote);
}));
fillLater.push(api.draftHookscript('Wallets can\'t sell more than they bought in the last hour').then((d) => {
  app.querySelector('#hsEx').innerHTML = `<div class="hs-card panel"><div class="hs-top"><span class="pixel">Draft</span><p>“${esc(d.prompt)}”</p><span class="chip warnchip">Unreviewed</span></div>
    <pre class="hs-code"><code>${tintHookscript(d.script)}</code></pre>
    <dl class="hs-stats"><div><dt>Ops</dt><dd class="num">${d.ops}</dd></div><div><dt>CU</dt><dd class="num">${n(d.cu)}<small> / 8,000</small></dd></div><div><dt>Fuzzed</dt><dd class="num">${n(d.fuzz.trades)}</dd></div><div><dt>Refused</dt><dd class="num">${d.fuzz.refusedPct}%</dd></div><div><dt>Panics</dt><dd class="num">${d.fuzz.panics}</dd></div><div><dt>Worst CU</dt><dd class="num">${n(d.fuzz.maxCu)}</dd></div></dl>
    <p class="dim hs-try">Draft your own in the <a href="blocks.html?b=custom">Custom block</a>.</p></div>`;
}));

const QUOTE = { side: 'sell', wallet: { balance: 20_000_000 }, stack: PRESETS.find((p) => p.id === 'slow-bleed').slots.map(([id]) => ({ id })), progress: 0.5, minutesAgo: 600 };
const tidy = (x) => (Math.abs(x - Math.round(x)) < 0.01 ? Math.round(x) : Math.floor(x));
function quotePanel(qr, amount = 15_000_000) {
  const max = tidy(qr.maxAllowed);
  return `<div class="qx panel">
    <div class="qx-req"><span class="pixel">POST /v1/quote</span><b>Sell <span class="mono">${n(amount)}</span> tokens of a Slow Bleed coin</b><span class="dim">Wallet holds 20,000,000. Stack: Sell Cap 1%, Sell Cooldown, Circuit Breaker, Hourly Outflow Cap.</span></div>
    <div class="qx-res ${qr.ok ? 'ok' : 'no'}"><span class="pixel">${qr.ok ? 'Lands' : `Refused · ${hex(qr.code)}`}</span><p>${esc(qr.message ?? `Passes every block. You'd get ${qr.out.toFixed(3)} SOL.`)}</p>
      <div class="qx-row"><span>refusedBy</span><code>${esc(qr.refusedBy ?? 'null')}</code><span>maxAllowed</span><code>${n(max)}</code></div>
      ${qr.ok ? (amount !== 15_000_000 ? '<button class="btn btn-ghost btn-sm" type="button" data-q="15000000">Back to 15,000,000</button>' : '') : `<button class="btn btn-glass btn-sm" type="button" data-q="${max}">Quote ${n(max)} instead</button>`}</div>
  </div>`;
}
app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-q]');
  if (!b) return;
  b.disabled = true;
  const amount = +b.dataset.q;
  const r = await api.quote({ ...QUOTE, amount });
  app.querySelector('#quoteEx').innerHTML = quotePanel(r, amount);
});

// ── nav: scrollspy, mobile select, deep links
const links = Object.fromEntries([...app.querySelectorAll('[data-nav]')].map((a) => [a.dataset.nav, a]));
const sel = app.querySelector('#dcSel');
const setOn = (id) => { Object.values(links).forEach((a) => a.classList.toggle('on', a.dataset.nav === id)); if (sel.value !== id) sel.value = id; };
const secs = [...app.querySelectorAll('.dc-sec')];
const spy = () => {
  const y = innerHeight * 0.28;
  let cur = secs[0].id;
  for (const s of secs) if (s.getBoundingClientRect().top <= y) cur = s.id;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = secs.at(-1).id;
  setOn(cur);
};
addEventListener('scroll', spy, { passive: true });
sel.addEventListener('change', () => { const t = document.getElementById(sel.value); history.replaceState(history.state, '', '#' + sel.value); t?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
for (const a of Object.values(links)) a.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(history.state, '', '#' + a.dataset.nav); document.getElementById(a.dataset.nav)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setOn(a.dataset.nav); });
spy();

const hash = location.hash.slice(1);
if (hash && document.getElementById(hash)) {
  let userScrolled = false;
  ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, () => { userScrolled = true; }, { once: true, passive: true }));
  const jump = () => { if (!userScrolled) { document.getElementById(hash).scrollIntoView({ block: 'start', behavior: 'instant' }); setOn(hash); } };
  requestAnimationFrame(jump);
  document.fonts?.ready.then(jump);
  addEventListener('load', jump, { once: true });
  Promise.all(fillLater).then(() => requestAnimationFrame(jump));
}
