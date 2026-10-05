// hookrz API server. `npm start` = local fork (persistent under .runtime/), HOOKRZ_MODE=devnet for devnet.
import { resolve } from "node:path";
import { boot } from "./boot.js";
import { buildApp } from "./app.js";
import { env, RUNTIME } from "./env.js";

const net = env.mode;
const { svc, hookWhy } = await boot({
  db: process.env.DB ?? resolve(RUNTIME, `${net}.sqlite`),
  forkState: net === "fork" ? (process.env.FORK_STATE ?? resolve(RUNTIME, "fork-state.bin")) : null,
  publicBase: process.env.PUBLIC_BASE ?? `http://${env.host}:${env.port}`,
  wallClock: process.env.FORK_WALL_CLOCK !== "false", // the dev fork follows wall time; FORK_WALL_CLOCK=false to freeze it
});
const app = buildApp(svc, { info: { hookWhy } });
// STATIC_DIR: also serve a built site (web/dist-live) from the same origin, so one tunnel URL is the whole beta.
if (process.env.STATIC_DIR) {
  const { readFile } = await import("node:fs/promises");
  const { extname, join, normalize } = await import("node:path");
  const root = resolve(process.env.STATIC_DIR);
  const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain" };
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/v1")) return reply.code(404).send({ error: "not found" });
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const tries = extname(p) ? [p] : [p + ".html", p + "/index.html"];
    for (const t of tries) {
      const f = normalize(join(root, t));
      if (!f.startsWith(root)) break;
      try {
        const body = await readFile(f);
        return reply.header("content-type", TYPES[extname(f)] ?? "application/octet-stream").header("cache-control", f.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache").send(body);
      } catch { /* try next */ }
    }
    return reply.code(404).type("text/html").send("<h1>404</h1>");
  });
}
await app.listen({ port: env.port, host: env.host });
// The public keeper: one round every KEEPER_TICK_MS (default 60 s; 0 turns the loop off). Rounds are best effort and
// never block the API or the indexer.
svc.keeper.start();
console.log(`hookrz server (${net}) on http://${env.host}:${env.port} · ${hookWhy} · keeper ${svc.keeper.running ? `every ${svc.keeper.opts.tickMs / 1000}s` : "off"}`);
// The local drafter model reads the whole Hookscript spec on every call; warm its prefix cache now so the first
// visitor's draft doesn't hit the tunnel's 100 s limit.
if (process.env.HOOKSCRIPT_LLM_URL) {
  svc.draft("No single sell over a quarter of your bag in your first 2h")
    .then((d: any) => console.log(`drafter warm: ${d.provider}${d.model ? ` (${d.model})` : ""}`))
    .catch((e: Error) => console.log(`drafter warm-up failed: ${e.message}`));
}
