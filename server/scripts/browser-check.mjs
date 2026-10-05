// One real-visitor browser pass over the live flow: the site (VITE_API_BASE → this server) + a stub
// Wallet Standard wallet whose keys live in this Node process. Build a Fair Launch coin, sign and launch,
// open the coin, buy through the trade ticket, then try a sniper-sized buy.
//   SITE=http://127.0.0.1:4431 API=http://127.0.0.1:8830 OUT=dir node --import tsx scripts/browser-check.mjs
import { chromium } from "/home/dzliu/pzliu/clips/web/node_modules/playwright/index.mjs";
import { Keypair, Transaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { mkdirSync, writeFileSync } from "node:fs";

const SITE = process.env.SITE ?? "http://127.0.0.1:4431";
const API = process.env.API ?? "http://127.0.0.1:8830";
const OUT = process.env.OUT ?? ".runtime/browser-check";
const TICKER = process.env.TICKER ?? `HK${Date.now().toString(36).slice(-5).toUpperCase()}`;
mkdirSync(OUT, { recursive: true });
const kp = Keypair.generate();
const log = [];
const note = (...a) => { const s = a.join(" "); log.push(s); console.log(s); };

await fetch(`${API}/v1/fork/airdrop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58(), sol: 20 }) });
note("stub wallet", kp.publicKey.toBase58(), "funded with 20 fork SOL");

const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const sent = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  // Node side of the stub wallet: sign with the local keypair, relay through the server (the fork has no public RPC)
  await ctx.exposeFunction("__stubSignAndSend", async (b64) => {
    const tx = Transaction.from(Buffer.from(b64, "base64"));
    tx.partialSign(kp);
    const r = await (await fetch(`${API}/v1/tx/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: tx.serialize().toString("base64") }) })).json();
    sent.push(r);
    note("  wallet sent", r.signature?.slice(0, 16), r.ok ? "landed" : `refused ${r.code ?? r.error}`);
    return r.signature;
  });
  await ctx.exposeFunction("__stubSignMessage", async (b64) => Buffer.from(ed25519.sign(Buffer.from(b64, "base64"), kp.secretKey.slice(0, 32))).toString("base64"));
  await ctx.addInitScript(({ address, pub }) => {
    const b64 = (u8) => btoa(String.fromCharCode(...u8));
    const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const unb58 = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } for (const c of s) { if (c !== "1") break; out.unshift(0); } return Uint8Array.from(out); };
    const account = { address, publicKey: Uint8Array.from(pub), chains: ["solana:devnet", "solana:mainnet"], features: ["solana:signAndSendTransaction", "solana:signMessage"] };
    const wallet = {
      version: "1.0.0", name: "Stub Wallet", chains: account.chains, accounts: [account],
      icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#4d9bff"/></svg>'),
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
        "standard:events": { version: "1.0.0", on: () => () => {} },
        "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signAndSendTransaction: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signature: unb58(await window.__stubSignAndSend(b64(i.transaction))) }))) },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: unb64(await window.__stubSignMessage(b64(i.message))) }))) },
      },
    };
    const cb = ({ register }) => register(wallet);
    try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb })); } catch {}
    try { window.addEventListener("wallet-standard:app-ready", ({ detail }) => cb(detail)); } catch {}
  }, { address: kp.publicKey.toBase58(), pub: [...kp.publicKey.toBytes()] });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

  // ── 1. build: Fair Launch preset, details, review, connect, sign & launch
  await page.goto(`${SITE}/build.html?preset=fair-launch`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.querySelector("#launch")?.scrollIntoView());
  await page.fill("#lf-name", `Browser ${TICKER}`);
  await page.fill("#lf-ticker", TICKER);
  await page.fill("#lf-desc", "Launched through the live API on the local fork by the browser check.");
  await page.fill("#lf-buy", "0.01");
  await page.waitForTimeout(400);
  await shot("1-details");
  await page.click('[data-l="next"]');
  await page.waitForSelector('[data-l="next"]:not([disabled])', { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot("2-review");
  note("review step:", (await page.locator(".lp-grid, .review, #launchRoot").first().innerText()).replace(/\s+/g, " ").slice(0, 300));
  await page.click('[data-l="next"]');
  await page.waitForSelector('[data-l="connect"], [data-l="sign"]', { timeout: 15000 });
  if (await page.locator('[data-l="connect"]').count()) {
    await page.click('[data-l="connect"]');
    await page.click('.wl-row:has-text("Stub Wallet")');
  }
  await page.waitForTimeout(400);
  await shot("3-sign");
  await page.click('[data-l="sign"]');
  await page.waitForSelector(`.done-go a[href*="${TICKER}"]`, { timeout: 90000 });
  await shot("4-launched");
  const coin = await (await fetch(`${API}/v1/coins/${TICKER}`)).json();
  note("launched", TICKER, "mint", coin.mint, "stage", coin.stage, "launch sig", coin.launchSig);

  // ── 2. coin page: quote + buy through the ticket
  await page.goto(`${SITE}/coin.html?t=${TICKER}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot("5-coin");
  const amt = page.locator("#tkAmt");
  await amt.fill("0.002");
  await page.waitForTimeout(1500);
  await shot("6-quote");
  if ((await page.locator("#tkGo").innerText()).includes("Connect")) {
    await page.click("#tkGo");
    await page.click('.wl-row:has-text("Stub Wallet")');
    await page.waitForTimeout(800);
  }
  note("ticket before confirm:", (await page.locator("#tkCheck").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
  await page.click("#tkGo");
  await page.waitForSelector("#cfGo", { timeout: 15000 });
  await shot("7-confirm");
  await page.click("#cfGo");
  await page.waitForSelector(".cf-done", { timeout: 60000 });
  const doneText = (await page.locator(".cf-done").innerText()).replace(/\s+/g, " ");
  note("ticket result:", doneText.slice(0, 200));
  await shot("8-landed");
  await page.click("#cfDone").catch(() => {});

  // ── 3. a sniper-sized buy: the quote refuses it before signing (Snipe Shield, 6001)
  await amt.fill("1");
  await page.waitForTimeout(1800);
  const tkText = (await page.locator("#tkCheck").innerText().catch(() => "")).replace(/\s+/g, " ") + " | button: " + (await page.locator("#tkGo").innerText());
  note("big buy ticket:", tkText.slice(0, 300));
  await shot("9-refused-quote");
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector(".fd-list")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  await shot("10-feed");
  const trades = await (await fetch(`${API}/v1/coins/${TICKER}/trades`)).json();
  note("indexed trades:", trades.map((t) => `${t.kind}:${t.ok ? "ok" : t.code}:${t.sig.slice(0, 8)}`).join(" "));
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ ticker: TICKER, wallet: kp.publicKey.toBase58(), coin, sent, trades, doneText, errors, log }, null, 2));
  note("page errors:", errors.length ? errors.slice(0, 5).join(" | ") : "none");
} finally {
  await browser.close();
}
