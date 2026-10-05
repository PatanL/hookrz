// Devnet preflight: are the programs and configs hookrz needs present on devnet, and is the deployer funded?
// Prints public keys and balances only.
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID, DAMM_V2_MIGRATION_FEE_ADDRESS, MigrationFeeOption, deriveDbcPoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, engineSo } from "../src/env.js";

const c = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const check = async (label: string, k: PublicKey) => {
  const a = await c.getAccountInfo(k);
  console.log(`${a ? "ok     " : "MISSING"} ${label} ${k.toBase58()}${a ? ` owner ${a.owner.toBase58().slice(0, 8)}… ${a.executable ? "executable" : `${a.data.length} B`}` : ""}`);
  return !!a;
};
await check("Meteora DBC", DYNAMIC_BONDING_CURVE_PROGRAM_ID);
await check("Meteora DAMM v2", DAMM_V2_PROGRAM_ID);
await check("DAMM v2 migration config (FixedBps25)", DAMM_V2_MIGRATION_FEE_ADDRESS[MigrationFeeOption.FixedBps25]);
await check("Token-2022", new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"));
console.log("        DBC pool authority", deriveDbcPoolAuthority().toBase58());
const pub = (f: string) => existsSync(f) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, "utf8")))).publicKey : null;
const deployer = pub(resolve(ROOT, ".secrets/devnet-deployer.json"));
const program = pub(resolve(ROOT, ".secrets/hookrz-engine-devnet-program.json"));
const so = engineSo();
const size = so ? statSync(so).size : 0;
const rent = size ? await c.getMinimumBalanceForRentExemption(size + 45) : 0;
if (deployer) console.log(`        deployer ${deployer.toBase58()} balance ${(await c.getBalance(deployer)) / LAMPORTS_PER_SOL} SOL`);
if (program) await check("hookrz_engine (devnet program id)", program);
console.log(`        hookrz_engine.so ${size} B → program data rent ${(rent / LAMPORTS_PER_SOL).toFixed(3)} SOL; a deploy needs about ${((2 * rent) / LAMPORTS_PER_SOL + 0.02).toFixed(2)} SOL at peak (buffer + program data; the buffer is refunded)`);
