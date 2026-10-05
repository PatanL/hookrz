// Deploy or upgrade hookrz_engine.so with the BPF Upgradeable Loader, no Solana CLI needed (this ARM box has none).
//   deploy:  node scripts/deploy-engine.cjs <rpc-url> <payer.json> <program-keypair.json> <program.so> [--max-len <bytes>]
//   upgrade: node scripts/deploy-engine.cjs <rpc-url> <payer.json> <program-id | program-keypair.json> <program.so> --upgrade
//            (payer is the upgrade authority; grows program-data first when the new .so is bigger)
//   buffer:  node scripts/deploy-engine.cjs <rpc-url> <payer.json> <program-id> <program.so> --buffer-only --buffer-authority <multisig>
//            (writes + verifies a buffer and hands it to the multisig, which proposes the Upgrade itself)
// Steps: create a buffer account → write the .so in ~1 KB chunks (parallel, retried) → verify → deploy / upgrade.
// Prints addresses and signatures only; never prints keys. Re-running after a failure creates a fresh buffer.
const fs = require('fs');
const w = require('@solana/web3.js');
const LOADER = new w.PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const [rpc, payerPath, programPath, soPath] = process.argv.slice(2);
const flag = (f) => process.argv.includes(f);
const opt = (f) => (process.argv.indexOf(f) > 0 ? process.argv[process.argv.indexOf(f) + 1] : null);
const maxLenArg = process.argv.indexOf('--max-len');
if (!rpc || !payerPath || !programPath || !soPath) { console.error('usage: deploy-engine.cjs <rpc> <payer.json> <program.json | program-id> <program.so> [--max-len N | --upgrade | --buffer-only --buffer-authority <pubkey>]'); process.exit(2); }
const kp = (p) => w.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
const payer = kp(payerPath);
const program = fs.existsSync(programPath) ? kp(programPath) : null;
const programId = program ? program.publicKey : new w.PublicKey(programPath);
const mode = flag('--buffer-only') ? 'buffer' : flag('--upgrade') ? 'upgrade' : 'deploy';
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

async function writeBuffer() {
  const bufLen = 37 + so.length;
  const rentBuf = await conn.getMinimumBalanceForRentExemption(bufLen);
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
  return buffer.publicKey;
}

(async () => {
  const [programData] = w.PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER);
  const existing = await conn.getAccountInfo(programId);
  const bal = await conn.getBalance(payer.publicKey);
  const rentBuf = await conn.getMinimumBalanceForRentExemption(37 + so.length);
  console.log(`payer ${payer.publicKey.toBase58()} balance ${(bal / 1e9).toFixed(3)} SOL · ${mode}`);
  console.log(`program ${programId.toBase58()}  .so ${so.length} B`);

  if (mode === 'deploy') {
    if (existing) { console.log('program account already exists:', programId.toBase58(), '— use --upgrade instead'); process.exit(1); }
    if (!program) { console.log('a fresh deploy needs the program keypair file'); process.exit(1); }
    const progDataLen = 45 + maxLen;
    const rentProg = await conn.getMinimumBalanceForRentExemption(36);
    const rentData = await conn.getMinimumBalanceForRentExemption(progDataLen);
    console.log(`max_len ${maxLen} B · rent: buffer ${(rentBuf / 1e9).toFixed(3)} (refunded at deploy), program ${(rentProg / 1e9).toFixed(4)}, program-data ${(rentData / 1e9).toFixed(3)} SOL`);
    if (bal < rentBuf + rentData + rentProg + 0.05e9) { console.log('not enough SOL'); process.exit(1); }
    const buffer = await writeBuffer();
    // 3) create program account + DeployWithMaxDataLen (ix 2 = u32 tag, u64 max_data_len)
    const sig = await send([
      w.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      w.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: programId, lamports: rentProg, space: 36, programId: LOADER }),
      new w.TransactionInstruction({ programId: LOADER, keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: programData, isSigner: false, isWritable: true },
        { pubkey: programId, isSigner: false, isWritable: true },
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: w.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: w.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ], data: Buffer.concat([u32(2), u64(maxLen)]) }),
    ], [payer, program], 'deploy');
    const pd = await conn.getAccountInfo(programData);
    console.log('deployed', programId.toBase58(), 'sig', sig);
    console.log(`program-data ${programData.toBase58()} ${pd.data.length} B, rent ${(pd.lamports / 1e9).toFixed(3)} SOL; upgrade authority = payer (move it to a multisig before anything real)`);
  } else {
    if (!existing) { console.log('no program at', programId.toBase58(), '— deploy it first'); process.exit(1); }
    const pd0 = await conn.getAccountInfo(programData);
    // ProgramData: u32 tag(3) · u64 slot · Option<Pubkey> authority · bytes
    const auth = pd0.data[12] === 1 ? new w.PublicKey(pd0.data.subarray(13, 45)).toBase58() : null;
    const room = pd0.data.length - 45;
    console.log(`program-data ${programData.toBase58()} room ${room} B · upgrade authority ${auth ?? 'none (immutable)'}`);
    if (!auth) { console.log('the program is immutable'); process.exit(1); }
    if (mode === 'upgrade' && auth !== payer.publicKey.toBase58()) { console.log('payer is not the upgrade authority: use --buffer-only --buffer-authority', auth); process.exit(1); }
    const grow = Math.max(0, so.length - room);
    const rentGrow = grow ? (await conn.getMinimumBalanceForRentExemption(pd0.data.length + grow)) - pd0.lamports : 0;
    console.log(`buffer rent ${(rentBuf / 1e9).toFixed(3)} SOL (refunded by the upgrade)${grow ? ` · program-data grows ${grow} B, +${(rentGrow / 1e9).toFixed(3)} SOL rent` : ''}`);
    if (bal < rentBuf + rentGrow + 0.05e9) { console.log('not enough SOL'); process.exit(1); }
    const buffer = await writeBuffer();
    if (mode === 'buffer') {
      const to = new w.PublicKey(opt('--buffer-authority') ?? auth);
      // SetAuthority (ix 4): the multisig now owns the buffer and can propose Upgrade(program, buffer)
      const sig = await send([new w.TransactionInstruction({ programId: LOADER, keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: to, isSigner: false, isWritable: false },
      ], data: u32(4) })], [payer], 'set-buffer-authority');
      console.log(`buffer ${buffer.toBase58()} handed to ${to.toBase58()} (sig ${sig}). Propose Upgrade(program ${programId.toBase58()}, buffer, spill = any wallet) from the multisig.`);
      return;
    }
    if (grow) {
      // ExtendProgramChecked (ix 9, authority signs); older clusters only know ExtendProgram (ix 6)
      const keys = (checked) => [
        { pubkey: programData, isSigner: false, isWritable: true },
        { pubkey: programId, isSigner: false, isWritable: true },
        ...(checked ? [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }] : []),
        { pubkey: w.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      ];
      try { await send([new w.TransactionInstruction({ programId: LOADER, keys: keys(true), data: Buffer.concat([u32(9), u32(grow)]) })], [payer], 'extend-checked', 2); }
      catch { await send([new w.TransactionInstruction({ programId: LOADER, keys: keys(false), data: Buffer.concat([u32(6), u32(grow)]) })], [payer], 'extend'); }
      console.log(`program-data extended by ${grow} B`);
    }
    // Upgrade (ix 3): the buffer's lamports go to the spill account (the payer)
    const sig = await send([
      w.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      new w.TransactionInstruction({ programId: LOADER, keys: [
        { pubkey: programData, isSigner: false, isWritable: true },
        { pubkey: programId, isSigner: false, isWritable: true },
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: false, isWritable: true },
        { pubkey: w.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: w.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ], data: u32(3) }),
    ], [payer], 'upgrade');
    const pd = await conn.getAccountInfo(programData);
    if (!Buffer.from(pd.data.subarray(45, 45 + so.length)).equals(so)) throw new Error('program-data does not match the .so after the upgrade');
    console.log('upgraded', programId.toBase58(), 'sig', sig, '· program-data verified');
  }
  console.log(`payer balance now ${((await conn.getBalance(payer.publicKey)) / 1e9).toFixed(3)} SOL`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
