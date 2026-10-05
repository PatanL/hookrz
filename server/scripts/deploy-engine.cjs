// Deploy hookrz_engine.so with the BPF Upgradeable Loader, no Solana CLI needed (this ARM box has none).
//   node scripts/deploy-engine.cjs <rpc-url> <payer.json> <program-keypair.json> <program.so> [--max-len <bytes>]
// Steps: create a buffer account → write the .so in ~1 KB chunks (parallel, retried) → deploy with max_data_len.
// Prints addresses and signatures only; never prints keys. Re-running after a failure creates a fresh buffer.
const fs = require('fs');
const w = require('@solana/web3.js');
const LOADER = new w.PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const [rpc, payerPath, programPath, soPath] = process.argv.slice(2);
const maxLenArg = process.argv.indexOf('--max-len');
if (!rpc || !payerPath || !programPath || !soPath) { console.error('usage: deploy-engine.cjs <rpc> <payer.json> <program.json> <program.so> [--max-len N]'); process.exit(2); }
const kp = (p) => w.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
const payer = kp(payerPath), program = kp(programPath);
const so = fs.readFileSync(soPath);
const maxLen = maxLenArg > 0 ? Number(process.argv[maxLenArg + 1]) : so.length;
const conn = new w.Connection(rpc, 'confirmed');
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(ixs, signers, label, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const tx = new w.Transaction().add(w.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000 }), ...ixs);
      return await w.sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed', skipPreflight: false });
    } catch (e) {
      if (i === tries - 1) throw new Error(`${label}: ${e.message}`);
      await sleep(800 * (i + 1));
    }
  }
}

(async () => {
  const existing = await conn.getAccountInfo(program.publicKey);
  if (existing) { console.log('program account already exists:', program.publicKey.toBase58(), '— use an upgrade instead'); process.exit(1); }
  const bal = await conn.getBalance(payer.publicKey);
  const bufLen = 37 + so.length, progDataLen = 45 + maxLen;
  const rentBuf = await conn.getMinimumBalanceForRentExemption(bufLen);
  const rentProg = await conn.getMinimumBalanceForRentExemption(36);
  const rentData = await conn.getMinimumBalanceForRentExemption(progDataLen);
  console.log(`payer ${payer.publicKey.toBase58()} balance ${(bal / 1e9).toFixed(3)} SOL`);
  console.log(`program ${program.publicKey.toBase58()}  .so ${so.length} B  max_len ${maxLen} B`);
  console.log(`rent: buffer ${(rentBuf / 1e9).toFixed(3)} (refunded at deploy), program ${(rentProg / 1e9).toFixed(4)}, program-data ${(rentData / 1e9).toFixed(3)} SOL`);
  if (bal < rentBuf + rentData + rentProg + 0.05e9) { console.log('not enough SOL'); process.exit(1); }

  // 1) buffer: create + InitializeBuffer (authority = payer)
  const buffer = w.Keypair.generate();
  await send([
    w.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: buffer.publicKey, lamports: rentBuf, space: bufLen, programId: LOADER }),
    new w.TransactionInstruction({ programId: LOADER, keys: [{ pubkey: buffer.publicKey, isSigner: false, isWritable: true }, { pubkey: payer.publicKey, isSigner: false, isWritable: false }], data: u32(0) }),
  ], [payer, buffer], 'buffer');
  console.log('buffer', buffer.publicKey.toBase58());

  // 2) Write chunks: ix 1 = u32 tag, u32 offset, u64 len + bytes (bincode Vec<u8>)
  const CHUNK = 950, chunks = [];
  for (let off = 0; off < so.length; off += CHUNK) chunks.push(off);
  let done = 0; const PAR = 8;
  for (let i = 0; i < chunks.length; i += PAR) {
    await Promise.all(chunks.slice(i, i + PAR).map(async (off) => {
      const bytes = so.subarray(off, off + CHUNK);
      await send([new w.TransactionInstruction({ programId: LOADER,
        keys: [{ pubkey: buffer.publicKey, isSigner: false, isWritable: true }, { pubkey: payer.publicKey, isSigner: true, isWritable: false }],
        data: Buffer.concat([u32(1), u32(off), u64(bytes.length), bytes]) })], [payer], `write@${off}`);
      done++;
    }));
    process.stdout.write(`\rwrote ${done}/${chunks.length} chunks`);
  }
  console.log();
  // verify the buffer holds exactly the .so
  const bufInfo = await conn.getAccountInfo(buffer.publicKey);
  if (!bufInfo || !Buffer.from(bufInfo.data.subarray(37)).equals(so)) throw new Error('buffer content mismatch');
  console.log('buffer verified');

  // 3) create program account + DeployWithMaxDataLen (ix 2 = u32 tag, u64 max_data_len)
  const [programData] = w.PublicKey.findProgramAddressSync([program.publicKey.toBuffer()], LOADER);
  const sig = await send([
    w.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    w.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: program.publicKey, lamports: rentProg, space: 36, programId: LOADER }),
    new w.TransactionInstruction({ programId: LOADER, keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: programData, isSigner: false, isWritable: true },
      { pubkey: program.publicKey, isSigner: false, isWritable: true },
      { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: w.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: w.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ], data: Buffer.concat([u32(2), u64(maxLen)]) }),
  ], [payer, program], 'deploy');
  const pd = await conn.getAccountInfo(programData);
  console.log('deployed', program.publicKey.toBase58(), 'sig', sig);
  console.log(`program-data ${programData.toBase58()} ${pd.data.length} B, rent ${(pd.lamports / 1e9).toFixed(3)} SOL; upgrade authority = payer (move it to a multisig before anything real)`);
  console.log(`payer balance now ${((await conn.getBalance(payer.publicKey)) / 1e9).toFixed(3)} SOL`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
