// English -> Hookscript drafter. Every draft is compiled, fuzzed against 10,000 generated trades and
// honeypot-checked before it is returned; failures go back to the provider with the compiler / checker output.
//
// Providers:
//   anthropic  - Claude via the official SDK (optional dependency @anthropic-ai/sdk) when ANTHROPIC_API_KEY is set.
//                Model: HOOKSCRIPT_MODEL (default claude-opus-5-5; claude-sonnet-5-5 also fine). The system prompt is
//                SPEC.md + every example, prompt-cached.
//   heuristic  - offline templates covering the examples (drafter/heuristic.ts).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type Diag, type Abi } from '../compiler/src/compile.ts';
import { fuzz, type FuzzReport, type HoneypotReport } from '../fuzz/fuzz.ts';
import { heuristicDraft } from './heuristic.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface DraftOptions {
  provider?: 'auto' | 'anthropic' | 'heuristic';
  model?: string;
  maxAttempts?: number;
  trades?: number;
  seed?: number;
  /** test hook: replaces the Anthropic client */
  client?: unknown;
}

export interface DraftResult {
  ok: boolean;
  prompt: string;
  script: string;
  bytecodeHex: string | null;
  bytes: number;
  ops: number;
  /** worst-case CU (static bound; the limit is 8,000) */
  cu: number;
  fuzz: { trades: number; refusedPct: number; panics: number; maxCu: number; avgCu: number; errors: number; byKind: FuzzReport['byKind']; byReason: FuzzReport['byReason']; rust: FuzzReport['rust'] } | null;
  honeypot: HoneypotReport | null;
  warnings: string[];
  errors: Diag[];
  abi: Abi | null;
  reviewed: false;
  provider: 'anthropic' | 'heuristic';
  model: string | null;
  template: string | null;
  attempts: { n: number; ok: boolean; problem: string | null }[];
}

// ───── system prompt (stable -> cacheable) ─────
let SYSTEM: string | null = null;
export function systemPrompt(): string {
  if (SYSTEM) return SYSTEM;
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const exDir = join(ROOT, 'examples');
  const examples = readdirSync(exDir).filter((f) => f.endsWith('.hs')).sort().map((f) => `### examples/${f}\n${readFileSync(join(exDir, f), 'utf8').trim()}`).join('\n\n');
  SYSTEM = `You write Hookscript, the rule language of hookrz coins (Solana Token-2022 transfer hooks).
A coin creator describes a rule in English; you answer with one Hookscript program that implements it.

How to answer:
- Reply with the Hookscript source only: no prose, no markdown fences. The first line is rule "<short name>".
- Hookscript can only refuse transfers and remember state (coin globals, wallet vars). It cannot move funds. Rewards are
  paid by the keeper through payout declarations.
- Every holder must always be able to sell eventually with nobody else trading. Any rule that can block a sell needs a
  time-based escape (e.g. "and since(x) < 12h", "and wallet.held < 24h"). Rules that block sells forever, or depend on
  the price going up or on other people acting, fail the honeypot check and are rejected.
- Keep it small: the whole compiled script must fit in 1,024 bytes and 8,000 CU. Messages are short (under 96 bytes)
  and may show one {value}. Read expensive things (clock, moon, daylight, decay) once.
- Prefer the patterns in the examples. Write messages a trader would understand, saying what to do next.
- If part of the request is impossible (moving funds, reading off-chain data, randomness), implement the closest
  refuse-only version and put a # comment at the top saying what changed.

The full language specification and the example programs follow.

${spec}

## Example programs

${examples}
`;
  return SYSTEM;
}

function extractScript(text: string): string {
  let t = text.trim();
  const fence = t.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const i = t.search(/^rule\s+"/m);
  if (i > 0) t = t.slice(i);
  return t.trim() + '\n';
}

// ───── providers ─────
interface Provider { name: 'anthropic' | 'heuristic'; model: string | null; template: string | null; first(prompt: string): Promise<string>; retry(feedback: string): Promise<string> }

async function anthropicProvider(opts: DraftOptions): Promise<Provider | null> {
  let client = opts.client as { beta: { messages: { create: (p: unknown) => Promise<unknown> } } } | undefined;
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    try {
      const mod = await import('@anthropic-ai/sdk');
      const Anthropic = mod.default as unknown as new () => typeof client;
      client = new Anthropic();
    } catch { return null; }
  }
  const model = opts.model ?? process.env.HOOKSCRIPT_MODEL ?? 'claude-opus-5-5';
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [];
  const ask = async (): Promise<string> => {
    const res = await client!.beta.messages.create({
      model,
      max_tokens: 16000,
      // the spec + examples are identical on every call: cache them
      system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: { effort: (process.env.HOOKSCRIPT_EFFORT as 'low' | 'medium' | 'high') ?? 'medium' },
      // if a safety classifier declines, retry on the server's default fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }) as { content: { type: string; text?: string }[]; stop_reason: string };
    if (res.stop_reason === 'refusal') throw new Error('The model declined this request');
    messages.push({ role: 'assistant', content: res.content });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (!text.trim()) throw new Error(`Empty reply (stop_reason ${res.stop_reason})`);
    return extractScript(text);
  };
  return {
    name: 'anthropic', model, template: null,
    first: async (prompt) => { messages.push({ role: 'user', content: `Write the Hookscript for this rule:\n\n${prompt}` }); return ask(); },
    retry: async (feedback) => { messages.push({ role: 'user', content: `${feedback}\n\nFix it and reply with the whole corrected script only.` }); return ask(); },
  };
}

function heuristicProvider(): Provider {
  const p: Provider = {
    name: 'heuristic', model: null, template: null,
    first: async (prompt) => { const d = heuristicDraft(prompt); p.template = d.template; if (!d.matched) warnings.push("The offline drafter didn't recognize this rule and used its closest template. Set ANTHROPIC_API_KEY for free-form drafts."); return d.script; },
    retry: async () => { throw new Error('The offline drafter has no other version of this rule'); },
  };
  const warnings: string[] = [];
  (p as Provider & { warnings: string[] }).warnings = warnings;
  return p;
}

// ───── checks ─────
type Checked =
  | { ok: true; c: Extract<ReturnType<typeof compile>, { ok: true }>; z: FuzzReport; h: HoneypotReport }
  | { ok: false; stage: 'compile'; errors: Diag[]; warnings: Diag[] }
  | { ok: false; stage: 'fuzz' | 'honeypot'; c: Extract<ReturnType<typeof compile>, { ok: true }>; z: FuzzReport; h: HoneypotReport; problem: string };

function check(script: string, opts: DraftOptions): Checked {
  const c = compile(script);
  if (!c.ok) return { ok: false, stage: 'compile', errors: c.errors, warnings: c.warnings };
  const { fuzz: z, honeypot: h } = fuzz(c.bytes, { trades: opts.trades ?? 10_000, seed: opts.seed ?? 1 });
  if (z.errors || z.panics || (z.rust && z.rust.identical !== z.rust.checked)) return { ok: false, stage: 'fuzz', c, z, h, problem: `The VM reported ${z.errors} errors and ${z.panics} panics on ${z.trades} fuzzed trades.` };
  if (!h.ok) {
    const lines = [...h.notes];
    for (const l of h.locked.slice(0, 3)) lines.push(`Holder ${l.wallet} (${l.type}) still had ${l.leftTokens.toLocaleString('en-US')} of ${l.startTokens.toLocaleString('en-US')} tokens after ${l.tries} sell attempts over 60 days; last refusal: "${l.lastMessage}"`);
    if (h.bankRun) lines.push(`Bank run: holder number ${h.bankRun.failedAt} got stuck: "${h.bankRun.lastMessage}"`);
    return { ok: false, stage: 'honeypot', c, z, h, problem: `The honeypot check failed: holders can't always sell eventually.\n${lines.join('\n')}\nAdd a time-based escape so every holder can exit with nobody else trading.` };
  }
  return { ok: true, c, z, h };
}

function feedbackOf(k: Exclude<Checked, { ok: true }>, script: string): string {
  if (k.stage === 'compile') {
    const src = script.split('\n');
    return `The compiler rejected it:\n${k.errors.map((e) => `line ${e.line}, col ${e.col}: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ''}\n    ${src[e.line - 1] ?? ''}`).join('\n')}`;
  }
  return k.problem;
}

/** Draft Hookscript from English. Never throws for bad drafts: check `ok`. */
export async function draft(prompt: string, opts: DraftOptions = {}): Promise<DraftResult> {
  const want = opts.provider ?? 'auto';
  let provider: Provider | null = null;
  const warnings: string[] = [];
  if (want !== 'heuristic') {
    provider = await anthropicProvider(opts);
    if (!provider && want === 'anthropic') warnings.push('Anthropic provider unavailable (no ANTHROPIC_API_KEY or @anthropic-ai/sdk not installed); used the offline drafter.');
  }
  provider ??= heuristicProvider();
  const max = provider.name === 'heuristic' ? 1 : opts.maxAttempts ?? 3;
  const attempts: DraftResult['attempts'] = [];
  let script = '';
  let last: Checked | null = null;
  for (let n = 1; n <= max; n++) {
    try {
      script = n === 1 ? await provider.first(prompt) : await provider.retry(feedbackOf(last as Exclude<Checked, { ok: true }>, script));
    } catch (e) {
      attempts.push({ n, ok: false, problem: `provider: ${(e as Error).message}` });
      if (provider.name === 'anthropic' && n === 1) {
        // API down / declined: fall back to the offline drafter once
        warnings.push(`Claude was unavailable (${(e as Error).message}); used the offline drafter.`);
        provider = heuristicProvider();
        n = 0;
        continue;
      }
      break;
    }
    last = check(script, opts);
    attempts.push({ n, ok: last.ok, problem: last.ok ? null : last.stage === 'compile' ? `compile: ${last.errors[0].message}` : `${last.stage}: ${last.problem.split('\n')[0]}` });
    if (last.ok) break;
  }
  warnings.push(...((provider as Provider & { warnings?: string[] }).warnings ?? []));
  const base = { prompt, script, reviewed: false as const, provider: provider.name, model: provider.model, template: provider.template, attempts, warnings };
  if (!last) return { ...base, ok: false, bytecodeHex: null, bytes: 0, ops: 0, cu: 0, fuzz: null, honeypot: null, errors: [{ message: 'No draft was produced', line: 1, col: 1 }], abi: null };
  if (last.ok === false && last.stage === 'compile') return { ...base, ok: false, bytecodeHex: null, bytes: 0, ops: 0, cu: 0, fuzz: null, honeypot: null, errors: last.errors, abi: null, warnings: [...warnings, ...last.warnings.map((w) => w.message)] };
  const k = last as Extract<Checked, { c: unknown }>;
  const z = k.z;
  return {
    ...base,
    ok: last.ok,
    bytecodeHex: k.c.hex, bytes: k.c.size, ops: k.c.ops, cu: k.c.cu,
    fuzz: { trades: z.trades, refusedPct: z.refusedPct, panics: z.panics, maxCu: z.maxCu, avgCu: z.avgCu, errors: z.errors, byKind: z.byKind, byReason: z.byReason, rust: z.rust },
    honeypot: k.h,
    errors: last.ok ? [] : [{ message: (last as { problem: string }).problem, line: 1, col: 1 }],
    abi: k.c.abi,
    warnings: [...warnings, ...k.c.warnings.map((w) => w.message)],
  };
}
