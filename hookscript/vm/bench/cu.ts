// CU calibration: runs scripts inside the sBPF bench program on LiteSVM with a per-op tracer, and reports the real
// CU of every op (max over all runs) next to its gas weight, plus whole-run totals vs the static worst case.
// Build first:  (cd vm/bench && PATH=…platform-tools… cargo build --release --offline --target sbpf-solana-solana)
// Run:          node vm/bench/cu.ts [--json out.json]
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../compiler/src/compile.ts';
import { analyze } from '../../compiler/src/interp.ts';
import { OP, OP_NAME, gasOf, varint } from '../../compiler/src/bytecode.ts';
import { encodeCtx, ctx as mkCtx, wallet as mkWallet, type Ctx } from '../../compiler/src/ctx.ts';
import { World, attempt, intents, rng } from '../../fuzz/world.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const req = createRequire(process.env.LITESVM_FROM ?? join(ROOT, '..', 'programs', 'hookrz-engine', 'fork', 'package.json'));
const { LiteSVM, FailedTransactionMetadata, FeatureSet } = req('litesvm');
const { address, lamports, getTransactionDecoder } = req('@solana/kit');
const { Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, PublicKey } = req('@solana/web3.js');

// sol_remaining_compute_units needs its feature gate (active on mainnet); enable the full feature set
const svm = process.env.BENCH_DEFAULT_FEATURES ? new LiteSVM() : new LiteSVM().withFeatureSet(FeatureSet.allEnabled()).withBuiltins().withSysvars().withPrecompiles?.() ?? new LiteSVM();
const PID = Keypair.generate().publicKey;
svm.addProgram(address(PID.toBase58()), readFileSync(join(HERE, 'target', 'sbpf-solana-solana', 'release', 'hookscript_bench.so')));
const payer = Keypair.generate();
svm.airdrop(address(payer.publicKey.toBase58()), lamports(1_000_000_000_000n));
const CASE = Keypair.generate().publicKey;
const SYS = new PublicKey('11111111111111111111111111111111');
let nonce = 0;

interface Out { total: number; verdict: number; gas: number; ops: [number, number][] }
function bench(mode: 0 | 1, script: Uint8Array, c: Ctx, g: Uint8Array, s: Uint8Array, d: Uint8Array): Out {
  const pad = (b: Uint8Array, n: number) => { const o = new Uint8Array(n); o.set(b.subarray(0, n)); return o; };
  const data = new Uint8Array(3 + script.length + 578 + 256 + 64);
  data[0] = mode; data[1] = script.length & 0xff; data[2] = script.length >> 8;
  data.set(script, 3); data.set(encodeCtx(c), 3 + script.length);
  data.set(pad(g, 256), 3 + script.length + 578); data.set(pad(s, 32), 3 + script.length + 834); data.set(pad(d, 32), 3 + script.length + 866);
  svm.setAccount({ address: address(CASE.toBase58()), lamports: lamports(10_000_000_000n), data, space: BigInt(data.length), programAddress: address(SYS.toBase58()), executable: false });
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  tx.add(new TransactionInstruction({ programId: PID, keys: [{ pubkey: CASE, isSigner: false, isWritable: false }], data: Buffer.from(Uint32Array.of(nonce++).buffer) }));
  tx.sign(payer);
  const r = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
  if (r instanceof FailedTransactionMetadata) throw new Error(`bench failed: ${r.toString()}\n${r.meta().logs().join('\n')}`);
  const rd = r.returnData().data() as Uint8Array;
  const dv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
  const n = dv.getUint16(9, true);
  const ops: [number, number][] = [];
  for (let i = 0; i < n; i++) ops.push([rd[11 + 3 * i], dv.getUint16(12 + 3 * i, true)]);
  return { total: dv.getUint32(0, true), verdict: rd[4], gas: dv.getUint32(5, true), ops };
}

// ───── synthetic stress scripts (raw bytecode, header filled by analyze) ─────
function assemble(code: number[], reasons: [number, string][] = [[1, 'r {}']], keys: Uint8Array[] = []): Uint8Array {
  const rb: number[] = [];
  for (const [f, t] of reasons) { const b = new TextEncoder().encode(t); rb.push(f, b.length, ...b); }
  const s = new Uint8Array(16 + 32 * keys.length + rb.length + code.length);
  s.set([0x48, 0x53, 1, 0, keys.length, reasons.length, code.length & 0xff, code.length >> 8]);
  keys.forEach((k, i) => s.set(k, 16 + 32 * i));
  s.set(rb, 16 + 32 * keys.length); s.set(code, 16 + 32 * keys.length + rb.length);
  const i = analyze(s, { noLimit: true });
  s[3] = i.flags; s[8] = i.gasMax & 0xff; s[9] = i.gasMax >> 8; s[10] = i.globalsLen & 0xff; s[11] = i.globalsLen >> 8; s[12] = i.wvarsLen; s[13] = i.maxStack; s[14] = i.nLocals;
  return s;
}
const P = (v: bigint) => [OP.PUSHR, ...varint(v)];
const BIG = (1n << 62n) + 123456789n;
const rep = <T>(n: number, f: (i: number) => T[]) => Array.from({ length: n }, (_, i) => f(i)).flat();
const SYN: { name: string; code: number[]; keys?: Uint8Array[] }[] = [
  { name: 'push/pop', code: rep(20, () => [...P(-(1n << 63n)), OP.POP, OP.PUSHI, ...varint(-123456789012n), OP.POP]) },
  { name: 'arith big', code: rep(6, () => [...P(BIG), ...P(BIG - 7n), OP.MUL, ...P(-3n), OP.DIV, ...P(BIG), OP.MOD, ...P(BIG), ...P(-BIG), OP.MULDIV, ...P(5n), OP.ADD, ...P(9n), OP.SUB, OP.NEG, OP.ABS, ...P(1n), OP.MIN, ...P(2n), OP.MAX, OP.NOT, OP.POP]) },
  { name: 'cmp', code: rep(8, () => [...P(1n), ...P(2n), OP.EQ, ...P(1n), OP.NE, ...P(0n), OP.LT, ...P(0n), OP.LE, ...P(0n), OP.GT, ...P(0n), OP.GE, OP.DUP, OP.POP, OP.POP]) },
  { name: 'ctx', code: rep(2, () => rep(16, (f) => [OP.CTX, f, OP.POP])) },
  ...[0, 1, 2, 3].map((side) => ({ name: `wal side ${side}`, code: rep(14, (f) => [OP.WAL, side, f, OP.POP]) })),
  { name: 'win', code: rep(4, (s) => rep(2, (dir) => [...P(10n ** 15n), OP.WIN, s, dir, OP.POP])) },
  ...[0, 1, 2, 3].map((rule) => ({ name: `clock rule ${rule}`, code: rep(9, (f) => [OP.CLOCK, f, 0x10, 0xfe, rule, OP.POP]) })),
  { name: 'daylight/moon', code: [...rep(4, () => [OP.DAYLIGHT, 0xf0, 0x0d, 0x91, 0x36, OP.POP]), ...rep(3, (f) => [OP.MOON, f, OP.POP])] },
  { name: 'decay', code: rep(5, () => [...P(BIG), ...P(10_000n), ...P(BIG), ...P(1n), OP.DECAY, OP.POP]) },
  { name: 'ring', code: [OP.RINGTICK, 0, 7, 0, 0, 0, OP.RINGAT, 0, 7, 0, 0, 0, OP.POP, OP.RINGTICK, 48, 0xff, 0xff, 0, 0, OP.RINGAT, 48, 0xff, 0xff, 0, 0, OP.POP, OP.RINGTICK, 96, 1, 0, 0, 0, OP.RINGAT, 96, 3, 0, 0, 0, OP.POP] },
  { name: 'storage', code: [...rep(4, (t) => [...P(BIG), OP.STG, t, 100 + 8 * t, OP.LDG, t, 100 + 8 * t, OP.POP]), ...rep(4, (t) => [...P(BIG), OP.STW, t % 2, t, 8 * t, OP.LDW, (t + 1) % 4, t, 8 * t, OP.POP])] },
  { name: 'keys', keys: [new Uint8Array(32).fill(7)], code: [...rep(6, () => [OP.KEQ, 0, 1, 0, 2, OP.POP, OP.KEQ, 2, 0, 1, 0, OP.POP, OP.KEQ, 3, 2, 0, 3, OP.POP]), OP.KSTG, 0, 1, 0, OP.KSTG, 32, 0, 3, OP.KSTW, 0, 0, 0, 2, OP.KSTW, 1, 0, 1, 0] },
  { name: 'locals/jumps', code: rep(10, () => [...P(1n), OP.STL, 3, OP.LDL, 3, OP.JZ, 0, 0, OP.LDL, 3, OP.JNZ, 0, 0, OP.JMP, 0, 0]) },
  { name: 'refusev', code: [...P(BIG), OP.REFUSEV, 0] },
  { name: 'refuse', code: [OP.REFUSE, 0] },
  { name: 'end', code: [OP.END] },
];

function stressCtx(seed: number): Ctx {
  const r = rng(seed);
  const now = 1_790_000_000n + BigInt(r.int(40_000_000));
  const lots = Array.from({ length: 5 }, (_, i) => ({ t: 1_000_000 + i, amount: 123_456_789_012n }));
  const w = (k: number) => mkWallet({ key: new Uint8Array(32).fill(k), hasRecord: true, balance: 987_654_321_000_000n, firstReceiptTs: now - 5000n, lastBuySlot: 300_000_000n, lastBuyTs: now - 100n, lastSellTs: now - 50n, bought: 1n << 60n, sold: 1n << 59n, buys: 7, sells: 3, lotsIn: lots, lotsOut: lots });
  return mkCtx({ kind: r.int(3), amount: 555_555_555_555n, decimals: r.pick([6, 9, 2]), supply: 1_000_000_000_000_000n, slot: 300_100_000n, now, launchTs: now - 1_000_100n, launchSlot: 299_000_000n, priceE6: 28_123_456n, progressPpm: 456_789, quoteReserve: 45_000_000_000n, feeBps: 125, creator: new Uint8Array(32).fill(2), app: new Uint8Array(32).fill(5), sender: w(1), receiver: w(2) });
}

// ───── run ─────
const maxCu = new Map<number, number>();
const note = (op: number, cu: number) => maxCu.set(op, Math.max(maxCu.get(op) ?? 0, cu));
const totals: { name: string; total: number; gas: number; staticGas: number }[] = [];
const keyFill = new Uint8Array(32).fill(7);

for (const s of SYN) {
  const script = assemble(s.code, [[1, 'r {}']], s.keys ?? []);
  for (let i = 0; i < 6; i++) {
    const c = stressCtx(i + 1);
    const g = new Uint8Array(256); g.set(keyFill, 0); g.set(keyFill, 32);
    const sv = new Uint8Array(32).fill(i), dv = new Uint8Array(32).fill(i);
    const t = bench(1, script, c, g, sv, dv);
    for (const [op, cu] of t.ops) note(op, cu);
    const p = bench(0, script, c, g, sv, dv);
    totals.push({ name: `syn:${s.name}`, total: p.total, gas: p.gas, staticGas: analyze(script, { noLimit: true }).gasMax });
  }
}

const exDir = join(ROOT, 'examples');
for (const f of readdirSync(exDir).filter((x) => x.endsWith('.hs')).sort()) {
  const c = compile(readFileSync(join(exDir, f), 'utf8'));
  if (!c.ok) continue;
  const r = rng(f.length * 31);
  const w = new World(1_790_000_000n + BigInt(r.int(30_000_000)));
  const { plan, types } = intents(r, 24);
  types.forEach((t, i) => w.wallet(i, t));
  let n = 0;
  for (const ev of plan) {
    if (n >= 60) break;
    const me = w.wallet(ev.w);
    const o = ev.kind === 'buy' ? attempt(w, c.bytes, { kind: 'buy', from: ev.w, sol: ev.sol }, w.launchTs + BigInt(ev.t))
      : attempt(w, c.bytes, { kind: ev.kind, from: ev.w, to: ev.to, tokens: BigInt(Math.floor(Number(me.balance) * (ev.frac ?? 1))) }, w.launchTs + BigInt(ev.t));
    if (!o) continue;
    n++;
    const t = bench(1, c.bytes, o.ctx, o.globals, o.src, o.dst);
    for (const [op, cu] of t.ops) note(op, cu);
    const p = bench(0, c.bytes, o.ctx, o.globals, o.src, o.dst);
    if (p.gas !== o.result.gas) throw new Error(`gas mismatch on ${f}: sBPF ${p.gas} vs TS ${o.result.gas}`);
    totals.push({ name: f, total: p.total, gas: p.gas, staticGas: c.cu });
  }
}

const rows = [...maxCu.entries()].sort((a, b) => a[0] - b[0]).map(([op, cu]) => ({ op: op === 0xfe ? 'PARSE' : OP_NAME[op] ?? op, measured: cu, weight: op === 0xfe ? null : gasOf(op) ?? null }));
console.log('op           measured  weight');
for (const r of rows) console.log(`${String(r.op).padEnd(12)} ${String(r.measured).padStart(8)}  ${String(r.weight ?? '-').padStart(6)}${r.weight !== null && r.measured > r.weight ? '   <-- UNDER' : ''}`);
const worst = totals.map((t) => ({ ...t, over: t.total - t.gas })).sort((a, b) => b.over - a.over).slice(0, 8);
console.log('\nwhole runs (real CU vs gas charged; real includes the header parse):');
for (const t of worst) console.log(`  ${t.name.padEnd(28)} real ${t.total}  gas ${t.gas}  static ${t.staticGas}  real-gas ${t.over}`);
const ratio = Math.max(...totals.map((t) => t.total / Math.max(1, t.gas)));
console.log(`\nruns: ${totals.length}, max real/gas ratio ${ratio.toFixed(2)}`);
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ ops: rows, runs: totals }, null, 2));
void mkCtx;
