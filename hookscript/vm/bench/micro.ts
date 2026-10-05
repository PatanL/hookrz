// Micro-bench math routines on sBPF: node vm/bench/micro.ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(HERE, '..', '..', '..', 'programs', 'hookrz-engine', 'fork', 'package.json'));
const { LiteSVM, FailedTransactionMetadata, FeatureSet } = req('litesvm');
const { address, lamports, getTransactionDecoder } = req('@solana/kit');
const { Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, PublicKey } = req('@solana/web3.js');
const svm = new LiteSVM().withFeatureSet(FeatureSet.allEnabled()).withBuiltins().withSysvars();
const PID = Keypair.generate().publicKey;
svm.addProgram(address(PID.toBase58()), readFileSync(join(HERE, 'target', 'sbpf-solana-solana', 'release', 'hookscript_bench.so')));
const payer = Keypair.generate();
svm.airdrop(address(payer.publicKey.toBase58()), lamports(1_000_000_000_000n));
const CASE = Keypair.generate().publicKey;
let nonce = 0;
export function micro(f: number, a: bigint, b: bigint, c: bigint): number {
  const data = new Uint8Array(26); const dv = new DataView(data.buffer);
  data[0] = 2; data[1] = f; dv.setBigInt64(2, a, true); dv.setBigInt64(10, b, true); dv.setBigInt64(18, c, true);
  svm.setAccount({ address: address(CASE.toBase58()), lamports: lamports(1_000_000_000n), data, space: BigInt(data.length), programAddress: address('11111111111111111111111111111111'), executable: false });
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: svm.latestBlockhash() });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  tx.add(new TransactionInstruction({ programId: PID, keys: [{ pubkey: CASE, isSigner: false, isWritable: false }], data: Buffer.from(Uint32Array.of(nonce++).buffer) }));
  tx.sign(payer);
  const r = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
  if (r instanceof FailedTransactionMetadata) throw new Error(r.toString());
  const rd = r.returnData().data() as Uint8Array;
  return Number(new DataView(rd.buffer, rd.byteOffset).getBigInt64(0, true));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const T = 1_791_138_099n;
  const rows: [string, number, bigint, bigint, bigint][] = [
    ['muldiv small', 0, 1234567n, 7654321n, 1_000_000n], ['muldiv big (divlu)', 0, (1n << 62n) + 5n, -(1n << 61n), (1n << 62n) - 3n],
    ['muldiv fade', 0, 100_000_000_000_000n, 20_000_000_000n, 21_600_000_000n],
    ['tok dec6', 1, 123456789n, 6n, 0n], ['tok dec9', 1, 123456789123n, 9n, 0n],
    ['clock hour US', 2, T, 0n, -300n], ['clock weekday', 2, T, 3n, -300n], ['clock year', 2, T, 6n, -300n],
    ['daylight', 3, T, 3568n, 13969n], ['moon phase', 4, T, 0n, 0n], ['decay 2^31', 5, 1n << 50n, 10_000n, 0x7fff_ffffn],
    ['civil', 6, 20_000n, 0n, 0n], ['days_from_civil', 7, 2026n, 10n, 4n], ['dst_active US', 8, T, -18000n, 1n], ['sin_cd', 9, 12345n, 0n, 0n], ['moon_elongation', 10, T, 0n, 0n],
  ];
  for (const [name, f, a, b, c] of rows) console.log(`${name.padEnd(22)} ${micro(f, a, b, c)}`);
}
