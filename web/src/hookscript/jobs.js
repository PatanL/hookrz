// The heavy Hookscript jobs (draft, fuzz + honeypot), shared by the worker and the on-page fallback.
/** A compile result without its byte array (safe to keep in state and localStorage). */
export function slimCompile(c) {
  if (!c.ok) return { ok: false, errors: c.errors, warnings: c.warnings ?? [] };
  return { ok: true, name: c.name, size: c.size, ops: c.ops, cu: c.cu, hex: c.hex, abi: c.abi, warnings: c.warnings ?? [] };
}

/** The fuzz report and honeypot verdict, as plain data. */
function report(z, h, ms) {
  return {
    trades: z.trades, refusedPct: z.refusedPct, panics: z.panics, errors: z.errors, maxCu: z.maxCu, avgCu: z.avgCu, staticCu: z.staticCu,
    byKind: z.byKind, byReason: z.byReason, launches: z.launches, seed: z.seed, ms,
    honeypot: { ok: h.ok, checkedWallets: h.checkedWallets, maxExitHours: h.maxExitHours, allSellsRefused: h.allSellsRefused, notes: h.notes, locked: h.locked, bankRun: h.bankRun ?? null },
  };
}

export async function runJob(hs, type, p) {
  const t0 = performance.now();
  if (type === 'draft') {
    const d = await hs.draft(p.prompt, { provider: 'heuristic', trades: p.trades });
    return { ...d, ms: Math.round(performance.now() - t0) };
  }
  if (type === 'check') {
    const c = hs.compile(p.source);
    if (!c.ok) return { source: p.source, compile: slimCompile(c), check: null };
    const { fuzz: z, honeypot: h } = hs.fuzz(c.bytes, { trades: p.trades, seed: 1 });
    return { source: p.source, compile: slimCompile(c), check: report(z, h, Math.round(performance.now() - t0)) };
  }
  throw new Error(`unknown job ${type}`);
}
