// Renders the social card (public/img/og.png, 1200x630) with the site's own fonts and voxel type.
// node _brand/og.mjs   (needs the dev server for fonts? no: loads Google Fonts directly)
import { chromium } from '/home/dzliu/pzliu/clips/web/node_modules/playwright/index.mjs';
import { voxelSVG } from '../src/ui/voxel.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const img = (p) => 'data:image/' + (p.endsWith('.png') ? 'png' : 'webp') + ';base64,' + readFileSync(resolve(here, '../public/img', p)).toString('base64');
const headline = voxelSVG('BUILD. REMIX. OWN.', { cell: 9.5, depth: 0.34 });
const blocks = ['guard', 'pace', 'burn', 'flow', 'crown', 'custom'].map((f) => `<img src="${img(`brand/block-${f}-sm.webp`)}">`).join('');
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=Silkscreen&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#030409;color:#eef2f9;font-family:Archivo,sans-serif;overflow:hidden;position:relative}
body::before{content:'';position:absolute;inset:0;background:radial-gradient(700px 380px at 78% 30%,rgba(77,155,255,.22),transparent 70%),linear-gradient(rgba(186,206,255,.05) 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,rgba(186,206,255,.05) 1px,transparent 1px) 0 0/24px 24px}
.hook{position:absolute;right:40px;top:30px;width:330px;mix-blend-mode:screen;transform:rotate(-4deg)}
.wrap{position:absolute;left:64px;top:62px;right:64px}
.eb{font-family:Silkscreen;font-size:15px;letter-spacing:.1em;color:#8fcaff;display:flex;gap:12px;align-items:center}.eb::before{content:'';width:11px;height:11px;background:#8fcaff;box-shadow:0 0 12px #6fb2ff}
.hl{margin-top:34px}.hl svg{width:760px;height:auto}
p{margin-top:30px;font-size:27px;line-height:1.35;color:#a9b4c8;max-width:640px;font-variation-settings:'wdth' 104}
p b{color:#eef2f9;font-weight:700}
.row{position:absolute;left:52px;bottom:34px;display:flex;gap:2px}.row img{width:112px;height:112px;mix-blend-mode:screen}
.url{position:absolute;right:64px;bottom:58px;font-family:'JetBrains Mono';font-size:24px;color:#eef2f9;letter-spacing:.02em}
</style></head><body>
<img class="hook" src="${img('hook-mark-512.png')}">
<div class="wrap"><div class="eb">TRANSFER-HOOK LAUNCHPAD ON SOLANA</div><div class="hl">${headline}</div>
<p>Build a coin from rule blocks. <b>Solana runs the stack on every transfer.</b> Remix any stack; earn when yours is remixed.</p></div>
<div class="row">${blocks}</div><div class="url">hookrz.fun</div></body></html>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
await pg.setContent(html, { waitUntil: 'networkidle' });
await pg.waitForTimeout(600);
await pg.screenshot({ path: resolve(here, '../public/img/og.png') });
await b.close();
console.log('wrote public/img/og.png');
