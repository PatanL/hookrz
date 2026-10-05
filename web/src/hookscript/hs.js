// Hookscript in the browser: the real toolchain from ../hookscript (bundled into src/vendor/hookscript.js by
// `npm run hookscript`). Compiling is instant and runs on the page; drafting, the 10,000-trade fuzz and the honeypot
// check run in a worker so typing never stalls. The site reaches this only through src/api/client.js.

import { slimCompile, runJob } from './jobs.js';

let lib = null;
/** The toolchain module (loaded on first use, ~110 KB). */
export const load = () => (lib ??= import('../vendor/hookscript.js'));

export const LIMITS = { bytes: 1024, cu: 8000, globals: 256, walletVars: 32 };
export const FUZZ_TRADES = 10_000;

let worker = null, seq = 0;
const waiting = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./hs-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = waiting.get(e.data.id); if (!p) return; waiting.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result); };
    worker.onerror = () => { for (const p of waiting.values()) p.reject(new Error('The Hookscript checker stopped. Reload the page and try again.')); waiting.clear(); worker = false; };
  } catch { worker = false; }
  return worker;
}
/** Run a job in the worker, or on the page if workers aren't available. */
async function job(type, payload) {
  const w = getWorker();
  if (!w) return runJob(await load(), type, payload);
  return new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); w.postMessage({ id, type, payload }); });
}

/** English → Hookscript with the offline drafter (26 rule families), compiled, fuzzed and honeypot-checked. */
export const draftOffline = (prompt, trades = FUZZ_TRADES) => job('draft', { prompt, trades });
/** Compile + fuzz + honeypot check of a source (what launch requires). */
export const checkSource = (source, trades = FUZZ_TRADES) => job('check', { source, trades });

/** Compile now, on the page: errors with line and column, or size, ops and the static worst-case CU. */
export async function compileSource(source) {
  const hs = await load();
  return slimCompile(hs.compile(String(source ?? '')));
}
