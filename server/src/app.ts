// HTTP API: every endpoint in web/src/api/contract.js, with the JSON shapes web/src/api/client.js
// returns in demo mode, plus the transaction relay, metadata and (fork only) dev helpers.
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { PublicKey } from "@solana/web3.js";
import { BLOCKS } from "../../web/src/data/blocks.js";
import { AppError } from "./market.js";
import type { Hookrz } from "./service.js";
import type { ForkChain } from "./fork.js";

const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : typeof v === "function" ? undefined : v)));

export function buildApp(svc: Hookrz, o: { info?: any } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  app.register(cors, { origin: true });

  app.setErrorHandler((e: any, _req, reply) => {
    if (e instanceof AppError) return reply.status(e.status).send({ error: e.code, message: e.message, details: json(e.details ?? null) });
    if (e.validation || e.statusCode === 400) return reply.status(400).send({ error: "BAD_REQUEST", message: e.message });
    console.error(e);
    return reply.status(500).send({ error: "INTERNAL", message: e.message });
  });

  // Behind the Cloudflare tunnel every request arrives from loopback: the visitor is in cf-connecting-ip.
  // Only trusted when the socket itself is loopback (cloudflared on this box), never from the open internet.
  const clientIp = (req: any) => {
    const ip = req.ip as string;
    const loop = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    const cf = req.headers["cf-connecting-ip"];
    return loop && typeof cf === "string" && cf ? cf : ip;
  };
  // naive per-IP limiters: writes (prepare / submit / relay) 120 a minute; English → Hookscript drafts 10 a minute
  const hits = new Map<string, { n: number; t: number }>();
  const limit = (key: string, max: number) => {
    const now = Date.now(), h = hits.get(key);
    if (!h || now - h.t > 60_000) { hits.set(key, { n: 1, t: now }); if (hits.size > 50_000) hits.clear(); return false; }
    return ++h.n > max;
  };
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "POST") return;
    const ip = clientIp(req);
    if (limit(ip, 120) || (req.url.startsWith("/v1/hookscript/draft") && limit(`draft:${ip}`, 10)))
      return reply.status(429).send({ error: "RATE_LIMITED", message: "Too many requests; slow down" });
  });

  app.get("/v1/health", async () => {
    const r = await svc.chain.read([]);
    return { ok: true, mode: svc.chain.mode, slot: r.slot, unix: Number(r.unix), hook: svc.hook ? { kind: svc.hook.kind, program: svc.hook.id.toBase58() } : null, platform: svc.platform.publicKey.toBase58(), coins: svc.store.coins().length, ...o.info };
  });
  app.get("/v1/blocks", async () => json(BLOCKS));
  app.get("/v1/coins", async (req: any) => json(svc.coins(req.query ?? {})));
  app.get("/v1/coins/:mint", async (req: any, reply) => {
    const c = svc.coin(req.params.mint);
    if (!c && req.query?.optional) return null; // "is this ticker taken?" without a 404 in the console
    return c ? json(c) : reply.status(404).send({ error: "NOT_FOUND", message: "No such coin" });
  });
  app.get("/v1/coins/:mint/trades", async (req: any) => json(svc.trades(req.params.mint, Math.min(500, Number(req.query?.limit ?? 40)))));
  app.get("/v1/coins/:mint/holders", async (req: any) => json(svc.holders(req.params.mint)));
  app.post("/v1/quote", async (req: any) => json(await svc.quote(req.body ?? {})));
  app.post("/v1/trade/prepare", async (req: any) => json(await svc.prepareTrade(req.body ?? {})));
  app.post("/v1/stacks/validate", async (req: any) => json(svc.validate(req.body?.stack ?? [])));
  app.post("/v1/stacks/simulate", async (req: any) => json(svc.simulate(req.body?.stack ?? [], Number(req.body?.seed ?? 7))));
  app.get("/v1/stacks", async () => json(svc.stacks()));
  app.get("/v1/stacks/:id/lineage", async (req: any) => json(svc.lineage(req.params.id)));
  app.post("/v1/hookscript/draft", async (req: any) => json(await svc.draft(String(req.body?.prompt ?? ""))));
  app.post("/v1/launch/prepare", async (req: any) => json(await svc.prepareLaunch(req.body ?? {})));
  app.post("/v1/launch/submit", async (req: any) => json(await svc.submitLaunch(req.body ?? {})));
  app.get("/v1/creators/:wallet", async (req: any) => json(svc.creator(req.params.wallet)));
  app.post("/v1/fees/claim/prepare", async (_req, reply) => reply.status(501).send({ error: "NOT_YET", message: "Fee claims arrive with the keeper (phase 2)" }));
  app.get("/v1/keeper", async () => json(svc.keeper.log.slice(0, 100)));

  // signed transaction relay: the fork has no public RPC, and on devnet this indexes refusals immediately
  app.post("/v1/tx/send", async (req: any) => {
    const b64 = String(req.body?.tx ?? req.body?.transaction ?? "");
    if (!b64) throw new AppError("BAD_REQUEST", "tx (base64) required");
    const r = await svc.sendTx(b64);
    return json({ signature: r.signature, ok: r.ok, code: r.code, error: r.error, logs: r.ok ? [] : r.logs.slice(-20), slot: r.slot, explain: r.ok ? null : await explainAny(svc, r) });
  });
  app.get("/v1/tx/:sig", async (req: any, reply) => {
    const r = await svc.chain.record(req.params.sig);
    return r ? json({ ...r, pre: undefined, post: undefined, explain: r.ok ? null : await explainAny(svc, r) }) : reply.status(404).send({ error: "NOT_FOUND", message: "Unknown signature" });
  });

  // token metadata the mint's URI names, and the coin image
  app.get("/v1/meta/:file", async (req: any, reply) => {
    const m = svc.meta(String(req.params.file).replace(/\.json$/, ""));
    return m ?? reply.status(404).send({ error: "NOT_FOUND" });
  });
  app.get("/v1/image/:mint", async (req: any, reply) => {
    const c = svc.store.getCoin(req.params.mint);
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(c?.image ?? "");
    if (!m) return reply.status(404).send({ error: "NOT_FOUND" });
    return reply.header("content-type", m[1]).header("cache-control", "public, max-age=86400").send(Buffer.from(m[2], "base64"));
  });

  // live stream (SSE): transfers with verdicts (landed and refused), launches, stage changes, keeper actions
  app.get("/v1/stream", (req: any, reply: FastifyReply) => {
    const mintKey = req.query?.mint ? String(req.query.mint) : null;
    const coin = mintKey ? svc.store.findCoin(mintKey) : null;
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": req.headers.origin ?? "*" });
    reply.raw.write(`: hookrz stream ${coin?.ticker ?? "all"}\n\n`);
    const f = (e: any) => {
      if (mintKey && e.mint !== coin?.mint && e.ticker !== mintKey) return;
      reply.raw.write(`data: ${JSON.stringify(json(e))}\n\n`);
    };
    svc.events.on("event", f);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 20_000);
    req.raw.on("close", () => {
      svc.events.off("event", f);
      clearInterval(ping);
    });
  });

  // fork-only helpers (valueless local SOL; clock warp for demos)
  if (svc.chain.mode === "fork") {
    const fork = svc.chain as ForkChain;
    app.post("/v1/fork/airdrop", async (req: any) => {
      const to = new PublicKey(String(req.body?.wallet));
      const sol = Math.min(1000, Math.max(0, Number(req.body?.sol ?? 10)));
      fork.fund(to, sol);
      return { ok: true, wallet: to.toBase58(), sol, notice: "Valueless local-fork SOL" };
    });
    app.post("/v1/fork/warp", async (req: any) => {
      fork.warp(Math.min(30 * 86400, Math.max(1, Number(req.body?.seconds ?? 60))));
      return { ok: true, ...fork.clock() };
    });
  }
  return app;
}

async function explainAny(svc: Hookrz, r: any) {
  const mints = new Set(r.accounts);
  const c = svc.store.coins().find((x) => mints.has(x.mint));
  if (!c) return null;
  return svc.explain(c, r, c.hook_program === svc.hook?.id.toBase58() && svc.hook?.kind === "hookrz");
}
