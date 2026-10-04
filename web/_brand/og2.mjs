// Social card v2: Codex-rendered scene (brand/gen/og-art-*.png) + real type set in HTML with the site's fonts.
// node _brand/og2.mjs a|b  -> public/img/og-<v>.png (1200x630)
import { chromium } from '/home/dzliu/pzliu/clips/web/node_modules/playwright/index.mjs';
import { voxelSVG } from '../src/ui/voxel.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const v = process.argv[2] || 'a';
const b64 = (p, t) => `data:image/${t};base64,` + readFileSync(resolve(here, p)).toString('base64');
const art = b64(`og-art-${v}.png`, 'png');
const mark = b64('../public/img/hook-mark-256.png', 'png');
const L = (t) => voxelSVG(t, { cell: 11.5, depth: 0.34 });
const word = voxelSVG('hookrz', { cell: 4.6, glow: false, depth: 0.34 });
const shift = v === 'a' ? 70 : 150;
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..900&family=Silkscreen&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#000;color:#eef2f9;font-family:Archivo,sans-serif;overflow:hidden;position:relative}
.art{position:absolute;top:0;right:-${shift}px;height:630px;width:auto}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#000 0%,#000 30%,rgba(0,0,0,.75) 45%,rgba(0,0,0,0) 62%),linear-gradient(0deg,rgba(0,0,0,.55),transparent 30%)}
.wrap{position:absolute;left:60px;top:54px;bottom:50px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:10px}.brand img{width:46px;height:46px;filter:drop-shadow(0 0 10px rgba(110,178,255,.45))}
.hl{margin-top:40px;display:flex;flex-direction:column;gap:14px}
p{margin-top:auto;font-size:25px;line-height:1.35;color:#b9c4d6;max-width:500px;font-variation-settings:'wdth' 104}p b{color:#fff;font-weight:700}
.eb{font-family:Silkscreen;font-size:13px;letter-spacing:.1em;color:#8fcaff;margin-top:14px;display:flex;gap:10px;align-items:center}.eb::before{content:'';width:9px;height:9px;background:#8fcaff;box-shadow:0 0 10px #6fb2ff}
.foot{margin-top:16px;display:flex;align-items:center;gap:16px}.u{font-family:'JetBrains Mono';font-size:21px;color:#fff;padding:5px 11px;border:1px solid rgba(143,202,255,.4);background:rgba(143,202,255,.08)}.foot .eb{margin-top:0}
</style></head><body><img class="art" src="${art}"><div class="fade"></div>
<div class="wrap"><div class="brand"><img src="${mark}">${word}</div>
<div class="hl">${L('BUILD.')}${L('REMIX.')}${L('OWN.')}</div>
<p>Build a Solana coin from rule blocks. <b>Every transfer runs the stack.</b></p>
<div class="foot"><span class="u">hookrz.fun</span><span class="eb">TRANSFER-HOOK LAUNCHPAD ON SOLANA</span></div></div>
</body></html>`;
const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1200, height: 630 } });
await pg.setContent(html, { waitUntil: 'networkidle' });
await pg.waitForTimeout(700);
await pg.screenshot({ path: resolve(here, `../public/img/og-${v}.png`) });
await br.close();
console.log('wrote public/img/og-' + v + '.png');
