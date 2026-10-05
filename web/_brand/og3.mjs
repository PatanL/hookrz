// Social card v3 (pixel brand): the pixel hook big and crisp, voxel headline, real type. -> public/img/og-v3.png
import { chromium } from '/home/dzliu/pzliu/clips/web/node_modules/playwright/index.mjs';
import { voxelSVG } from '../src/ui/voxel.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(resolve(here, '../public/img/hook-pixel.svg'), 'utf8');
const hook = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const L = (t) => voxelSVG(t, { cell: 11.5, depth: 0.34 });
const word = voxelSVG('hookrz', { cell: 4.6, glow: false, depth: 0.34 });
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=Silkscreen&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#030409;color:#eef2f9;font-family:Archivo,sans-serif;overflow:hidden;position:relative}
body::before{content:'';position:absolute;inset:0;background:radial-gradient(520px 420px at 82% 50%,rgba(77,155,255,.20),transparent 70%),linear-gradient(rgba(186,206,255,.05) 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,rgba(186,206,255,.05) 1px,transparent 1px) 0 0/24px 24px}
.hook{position:absolute;right:120px;top:50%;height:540px;transform:translateY(-50%);image-rendering:pixelated;filter:drop-shadow(0 0 24px rgba(110,178,255,.45))}
.wrap{position:absolute;left:60px;top:54px;bottom:50px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:12px}.brand img{height:48px;image-rendering:pixelated}
.hl{margin-top:40px;display:flex;flex-direction:column;gap:14px}
p{margin-top:auto;font-size:25px;line-height:1.35;color:#b9c4d6;max-width:560px;font-variation-settings:'wdth' 104}p b{color:#fff;font-weight:700}
.foot{margin-top:16px;display:flex;align-items:center;gap:16px}.u{font-family:'JetBrains Mono';font-size:21px;color:#fff;padding:5px 11px;border:1px solid rgba(143,202,255,.4);background:rgba(143,202,255,.08)}
.eb{font-family:Silkscreen;font-size:13px;letter-spacing:.1em;color:#8fcaff;display:flex;gap:10px;align-items:center}.eb::before{content:'';width:9px;height:9px;background:#8fcaff;box-shadow:0 0 10px #6fb2ff}
</style></head><body><img class="hook" src="${hook}">
<div class="wrap"><div class="brand"><img src="${hook}">${word}</div>
<div class="hl">${L('BUILD.')}${L('REMIX.')}${L('OWN.')}</div>
<p>Build a Solana coin from rule blocks. <b>Every transfer runs the stack.</b></p>
<div class="foot"><span class="u">hookrz.fun</span><span class="eb">TRANSFER-HOOK LAUNCHPAD ON SOLANA</span></div></div>
</body></html>`;
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1200, height: 630 } });
await pg.setContent(html, { waitUntil: 'networkidle' });
await pg.waitForTimeout(700);
await pg.screenshot({ path: resolve(here, '../public/img/og-v3.png') });
await br.close();
console.log('wrote public/img/og-v3.png');
