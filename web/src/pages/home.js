import '../styles/base.css';
import '../styles/home.css';
import { mountChrome } from '../ui/chrome.js';
import { voxelSVG } from '../ui/voxel.js';
import { cube } from '../ui/icons.js';
import { FAMILIES } from '../data/blocks.js';

mountChrome('');
document.getElementById('app').innerHTML = `<section class="section"><div class="wrap stack" style="gap:28px">
<span class="eyebrow">Transfer-hook launchpad · Solana</span>
<div>${voxelSVG('BUILD. REMIX. OWN.', { cell: 13, gap: 2 })}</div>
<p class="lede">Foundation smoke test.</p>
<div class="row wrap-row">${FAMILIES.map((f) => cube(f.id, { size: 72 })).join('')}${cube('guard', { size: 72, state: 'lit' })}${cube('pace', { size: 72, state: 'refused' })}${cube('x', { size: 72, state: 'empty' })}</div>
<div class="row"><button class="btn btn-chrome btn-lg">Build a coin</button><button class="btn btn-glass btn-lg" data-wallet-btn>Connect wallet</button></div>
<div class="row wrap-row"><span class="chip ice">Hook</span><span class="chip refuse">Refused</span><span class="chip">Curve</span><span class="enf hook"><i></i>Hook</span><span class="enf crank"><i></i>Crank</span><span class="demo-tag">Demo</span></div>
</div></section>`;
