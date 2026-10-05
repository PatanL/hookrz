// Parity: the same scripts × contexts × states through the Rust VM (vm/examples/hsrun.rs) and the TS interpreter.
// Verdicts, errors, gas, new state bytes and formatted messages must be identical.
// Usage: node compiler/test/parity.ts [--cases N] [--extra cases.txt]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/compile.ts';
import { run, analyze, verify, formatReasonBytes } from '../src/interp.ts';
import { encodeCtx, decodeCtx, CTX_BYTES, type Ctx } from '../src/ctx.ts';
import { toHex, fromHex } from '../src/bytecode.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VM = join(ROOT, 'vm');
const CARGO = process.env.CARGO ?? join(process.env.HOME ?? '', '.cargo/bin/cargo');

export function buildRunner(): string {
  const r = spawnSync(CARGO, ['build', '--release', '--example', 'hsrun', '-q'], { cwd: VM, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cargo build failed:\n${r.stderr}`);
  return join(VM, 'target', 'release', 'examples', 'hsrun');
}

/** Run lines through the Rust runner. */
export function rustRun(bin: string, lines: string[]): string[] {
  const r = spawnSync(bin, [], { input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`hsrun crashed (status ${r.status}, signal ${r.signal}):\n${r.stderr.slice(0, 2000)}`);
  return r.stdout.trimEnd().split('\n');
}

const hx = (b: Uint8Array) => (b.length ? toHex(b) : '-');
const unhx = (s: string) => (s === '-' ? new Uint8Array(0) : fromHex(s));

/** What the TS interpreter says for one runner line (same output format as hsrun). */
export function tsLine(line: string): string {
  const f = line.split(' ');
  if (f[0] === 'verify') {
    try { const i = verify(unhx(f[1])); return `V ${i.gasMax} ${i.flags} ${i.maxStack} ${i.nLocals} ${i.globalsLen} ${i.wvarsLen} ${i.ops}`; } catch (e) { return `E ${(e as { code: string }).code} 0`; }
  }
  const code = unhx(f[1]);
  const cb = unhx(f[2]);
  if (cb.length !== CTX_BYTES) return 'E BadCtx 0';
  const c = decodeCtx(cb);
  const r = run(code, c, unhx(f[3]), unhx(f[4]), unhx(f[5]));
  if (r.error) return `E ${r.error} ${r.gas}`;
  if (r.verdict!.allow) return `A ${r.gas} ${hx(r.globals)} ${hx(r.walletSrc)} ${hx(r.walletDst)}`;
  const v = r.verdict as { reasonId: number; arg: bigint };
  return `R ${v.reasonId} ${v.arg} ${r.gas} ${hx(formatReasonBytes(code, v.reasonId, v.arg))}`;
}

export const runLine = (code: Uint8Array, c: Ctx, g: Uint8Array, s: Uint8Array, d: Uint8Array) => `run ${hx(code)} ${toHex(encodeCtx(c))} ${hx(g)} ${hx(s)} ${hx(d)}`;

// ───── random inputs ─────
export function rng(seed: number) {
  let s = BigInt(seed) | 1n;
  const next = () => { s ^= (s << 13n) & 0xffff_ffff_ffff_ffffn; s ^= s >> 7n; s ^= (s << 17n) & 0xffff_ffff_ffff_ffffn; return s; };
  const f = () => Number(next() & 0xff_ffff_ffffn) / 2 ** 40;
  return { f, int: (n: number) => Math.floor(f() * n), big: () => next(), pick: <T>(xs: T[]) => xs[Math.floor(f() * xs.length)] };
}

const KEYS = [1, 2, 3, 4, 9].map((x) => new Uint8Array(32).fill(x));
function randomCtx(r: ReturnType<typeof rng>, wild: boolean): Ctx {
  if (wild) { const b = new Uint8Array(CTX_BYTES); for (let i = 0; i < b.length; i++) b[i] = r.int(256); const c = decodeCtx(b); if (r.f() < 0.5) { c.kind %= 3; c.decimals %= 12; } return c; }
  const launch = 1_700_000_000n + BigInt(r.int(100_000_000));
  const now = launch + BigInt(r.pick([0, 1, 59, 600, 3_600, 7_199, 7_200, 86_400, r.int(30 * 86_400)]));
  const lot = () => ({ t: r.int(Number(now - launch) + 1), amount: BigInt(r.int(50_000_000)) * 1_000_000n });
  const w = (isPool: boolean) => ({
    key: r.pick(KEYS), hasRecord: !isPool && r.f() < 0.9, isPool, balance: BigInt(r.int(80_000_000)) * 1_000_000n,
    firstReceiptTs: r.f() < 0.2 ? 0n : launch + BigInt(r.int(Number(now - launch) + 1)), lastBuySlot: BigInt(r.int(1_000_000)),
    lastBuyTs: r.f() < 0.3 ? 0n : launch + BigInt(r.int(Number(now - launch) + 1)), lastSellTs: r.f() < 0.5 ? 0n : launch + BigInt(r.int(Number(now - launch) + 1)),
    bought: BigInt(r.int(1e9)) * 1000n, sold: BigInt(r.int(1e9)) * 1000n, buys: r.int(20), sells: r.int(20),
    lotsIn: Array.from({ length: r.int(6) }, lot), lotsOut: Array.from({ length: r.int(6) }, lot),
  });
  const kind = r.int(3);
  return {
    kind, amount: BigInt(r.int(60_000_000)) * 1_000_000n + BigInt(r.int(1_000_000)), decimals: r.pick([6, 6, 6, 9, 0, 2]), supply: 1_000_000_000_000_000n,
    slot: 300_000_000n + BigInt(r.int(1e6)), now, launchTs: launch, launchSlot: 300_000_000n, priceE6: BigInt(r.int(400_000_000)), progressPpm: r.int(1_000_001),
    quoteReserve: BigInt(r.int(90e9)), feeBps: r.pick([100, 125, 200, 5000]), creator: KEYS[4], app: r.pick([KEYS[0], new Uint8Array(32)]), sameWallet: r.f() < 0.05,
    sender: w(kind === 0), receiver: w(kind === 1),
  };
}
const randBytes = (r: ReturnType<typeof rng>, n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = r.int(256); return b; };

export function corpusFromScripts(scripts: Uint8Array[], n: number, seed = 7): string[] {
  const r = rng(seed);
  const lines: string[] = [];
  for (const code of scripts) {
    lines.push(`verify ${hx(code)}`);
    for (let i = 0; i < n; i++) {
      const c = randomCtx(r, i % 10 === 9);
      const g = r.f() < 0.5 ? new Uint8Array(256) : randBytes(r, 256);
      const s = r.f() < 0.15 ? new Uint8Array(0) : r.f() < 0.5 ? new Uint8Array(32) : randBytes(r, 32);
      const d = r.f() < 0.15 ? new Uint8Array(0) : r.f() < 0.5 ? new Uint8Array(32) : randBytes(r, 32);
      lines.push(runLine(code, c, g, s, d));
      // mutated script (one byte in the op stream)
      if (i % 4 === 0 && code.length > 17) {
        const m = code.slice(); m[16 + r.int(code.length - 16)] = r.int(256);
        lines.push(runLine(m, c, g, s, d));
        lines.push(`verify ${hx(m)}`);
      }
    }
  }
  // pure noise scripts
  for (let i = 0; i < n * 2; i++) {
    const len = 16 + r.int(200);
    const b = randBytes(r, len);
    b[0] = 0x48; b[1] = 0x53; b[2] = 1; b[4] = r.int(3); b[5] = r.int(3); b[15] = 0;
    const codeLen = Math.max(0, len - 16 - 32 * b[4] - 30);
    b[6] = codeLen & 0xff; b[7] = codeLen >> 8;
    lines.push(runLine(b, randomCtx(r, false), new Uint8Array(256), new Uint8Array(32), new Uint8Array(32)));
  }
  return lines;
}

export function compare(lines: string[], rust: string[]) {
  let same = 0;
  const diffs: string[] = [];
  const counts: Record<string, number> = { A: 0, R: 0, E: 0, V: 0 };
  for (let i = 0; i < lines.length; i++) {
    const t = tsLine(lines[i]);
    counts[t[0]] = (counts[t[0]] ?? 0) + 1;
    if (t === rust[i]) same++;
    else if (diffs.length < 10) diffs.push(`#${i}\n  case: ${lines[i].slice(0, 300)}\n  rust: ${rust[i]}\n  ts:   ${t}`);
  }
  return { total: lines.length, same, diffs, counts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const nArg = process.argv.indexOf('--cases');
  const n = nArg > 0 ? Number(process.argv[nArg + 1]) : 300;
  const exDir = join(ROOT, 'examples');
  const scripts: Uint8Array[] = [];
  for (const f of readdirSync(exDir).filter((x) => x.endsWith('.hs')).sort()) {
    const r = compile(readFileSync(join(exDir, f), 'utf8'));
    if (!r.ok) { console.error(`${f}: ${r.errors[0].message}`); process.exitCode = 1; continue; }
    scripts.push(r.bytes);
  }
  const lines = corpusFromScripts(scripts, n);
  const extra = process.argv.indexOf('--extra');
  if (extra > 0 && existsSync(process.argv[extra + 1])) lines.push(...readFileSync(process.argv[extra + 1], 'utf8').trim().split('\n'));
  const bin = buildRunner();
  const t0 = Date.now();
  const rust = rustRun(bin, lines);
  const res = compare(lines, rust);
  writeFileSync(join(ROOT, 'compiler', 'test', 'parity-last.txt'), `${new Date().toISOString()} ${res.same}/${res.total} identical (${JSON.stringify(res.counts)})\n`);
  console.log(`parity: ${res.same}/${res.total} identical across ${scripts.length} example scripts + noise (${JSON.stringify(res.counts)}) in ${Date.now() - t0} ms`);
  for (const d of res.diffs) console.log(d);
  if (res.same !== res.total) process.exitCode = 1;
  void analyze;
}
