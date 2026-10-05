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
await app.listen({ port: env.port, host: env.host });
console.log(`hookrz server (${net}) on http://${env.host}:${env.port} · ${hookWhy}`);
