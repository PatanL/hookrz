// The transfer-hook program a coin's mint names. Two implementations behind one interface:
//   HookrzEngine — the real `hookrz_engine` (programs/hookrz-engine, layout in its LAYOUT.md)
//   AwayRules    — the proven away-rules program, a stand-in used only until hookrz_engine is built,
//                  to exercise the DBC TransferHook launch → trade → graduate → close path end to end.
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createTransferCheckedWithTransferHookInstruction, getTransferHook, unpackMint } from "@solana/spl-token";
import { sdkConnection } from "./sdk-connection.js";
import type { Chain } from "./chain.js";
import * as L from "./layout.js";

export type InitArgs = {
  creator: PublicKey;
  mint: PublicKey;
  pool: PublicKey;
  config: PublicKey;
  baseVault: PublicKey;
  stack: { id: string; params?: any }[];
  parentStack?: PublicKey | null;
  parentAuthor?: PublicKey | null;
  script?: Uint8Array | null;
  /** The script was already written with write_script chunks. */
  staged?: boolean;
};
export type WalletView = L.WalletRecord & { address: string; lamports: number };
export type StackView = L.StackAccount & { address: string };

export interface HookProgram {
  readonly kind: "hookrz" | "away-rules";
  readonly id: PublicKey;
  metaList(mint: PublicKey): PublicKey;
  stackPda(mint: PublicKey): PublicKey;
  walletPda(mint: PublicKey, tokenAccount: PublicKey): PublicKey | null;
  initIxs(a: InitArgs): TransactionInstruction[];
  openWalletIx(payer: PublicKey, mint: PublicKey, tokenAccount: PublicKey): TransactionInstruction | null;
  closeWalletIx(mint: PublicKey, tokenAccount: PublicKey, rentTo: PublicKey): TransactionInstruction | null;
  closeStackIx(mint: PublicKey, creator: PublicKey): TransactionInstruction | null;
  /** The hook's extra accounts for a transfer, computed offline (used before the meta list exists:
   *  the creator's first buy in the launch transaction). Order: [extras…, program, meta list]. */
  expectedExtras(mint: PublicKey, pool: PublicKey, source: PublicKey, destination: PublicKey, stack: any[], script?: Uint8Array | null): AccountMeta[] | null;
  /** write_script chunks for a script too big for the launch transaction (null: not supported). */
  writeScriptIxs?(creator: PublicKey, mint: PublicKey, pool: PublicKey, script: Uint8Array, chunk: number): TransactionInstruction[];
  /** Whether buyers need a Wallet record before they can receive (any hook block with wallet state). */
  needsWalletRecord(stack: any[]): boolean;
  readStack(chain: Chain, mint: PublicKey): Promise<StackView | null>;
  readWallet(chain: Chain, mint: PublicKey, tokenAccount: PublicKey): Promise<WalletView | null>;
}

const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

export class HookrzEngine implements HookProgram {
  readonly kind = "hookrz" as const;
  constructor(readonly id: PublicKey) {}
  metaList = (mint: PublicKey) => pda([Buffer.from("extra-account-metas"), mint.toBuffer()], this.id);
  stackPda = (mint: PublicKey) => pda([Buffer.from("stack"), mint.toBuffer()], this.id);
  scriptPda = (mint: PublicKey) => pda([Buffer.from("script"), mint.toBuffer()], this.id);
  walletPda = (mint: PublicKey, ta: PublicKey) => pda([Buffer.from("w"), mint.toBuffer(), ta.toBuffer()], this.id);

  initIxs(a: InitArgs) {
    const data = L.encodeInitStack({ stack: a.stack, script: a.script ?? null, parent: !!a.parentStack, staged: !!a.staged });
    const keys: AccountMeta[] = L.initStackAccounts({
      creator: a.creator, mint: a.mint, pool: a.pool, config: a.config,
      stack: this.stackPda(a.mint), metaList: this.metaList(a.mint), script: this.scriptPda(a.mint),
      parentStack: a.parentStack ?? null, system: SystemProgram.programId,
    });
    return [new TransactionInstruction({ programId: this.id, keys, data })];
  }
  openWalletIx(payer: PublicKey, mint: PublicKey, ta: PublicKey) {
    return new TransactionInstruction({ programId: this.id, keys: L.openWalletAccounts({ payer, mint, tokenAccount: ta, wallet: this.walletPda(mint, ta), system: SystemProgram.programId }), data: Buffer.from([L.IX.openWallet]) });
  }
  closeWalletIx(mint: PublicKey, ta: PublicKey, rentTo: PublicKey) {
    return new TransactionInstruction({ programId: this.id, keys: L.closeWalletAccounts({ wallet: this.walletPda(mint, ta), mint, rentTo }), data: Buffer.from([L.IX.closeWallet]) });
  }
  closeStackIx(mint: PublicKey, creator: PublicKey) {
    return new TransactionInstruction({ programId: this.id, keys: L.closeStackAccounts({ stack: this.stackPda(mint), metaList: this.metaList(mint), script: this.scriptPda(mint), mint, creator }), data: Buffer.from([L.IX.closeStack]) });
  }
  writeScriptIxs(creator: PublicKey, mint: PublicKey, pool: PublicKey, script: Uint8Array, chunk: number) {
    const out: TransactionInstruction[] = [];
    const keys = L.writeScriptAccounts({ creator, mint, pool, stack: this.stackPda(mint), script: this.scriptPda(mint), system: SystemProgram.programId });
    for (let o = 0; o < script.length; o += chunk) out.push(new TransactionInstruction({ programId: this.id, keys, data: L.encodeWriteScript(script, o, Math.min(chunk, script.length - o)) }));
    return out;
  }
  expectedExtras(mint: PublicKey, pool: PublicKey, source: PublicKey, destination: PublicKey, stack: any[], script?: Uint8Array | null) {
    const keys = L.metaListEntries({ stack: this.stackPda(mint), pool, walletSrc: this.walletPda(mint, source), walletDst: this.walletPda(mint, destination), script: this.scriptPda(mint) }, stack, script);
    return [...keys, { pubkey: this.id, isSigner: false, isWritable: false }, { pubkey: this.metaList(mint), isSigner: false, isWritable: false }];
  }
  needsWalletRecord(stack: any[]) {
    return L.usesWalletRecords(stack);
  }
  async readStack(chain: Chain, mint: PublicKey) {
    const key = this.stackPda(mint);
    const { accounts: [a] } = await chain.read([key]);
    if (!a || !a.owner.equals(this.id)) return null;
    return { ...L.decodeStack(a.data), address: key.toBase58() };
  }
  async readWallet(chain: Chain, mint: PublicKey, ta: PublicKey) {
    const key = this.walletPda(mint, ta);
    const { accounts: [a] } = await chain.read([key]);
    if (!a || !a.owner.equals(this.id)) return null;
    return { ...L.decodeWallet(a.data), address: key.toBase58(), lamports: a.lamports };
  }
}

/** Stand-in: away-rules with a wide circuit breaker, so trades pass and the DBC hook path is exercised. */
export class AwayRules implements HookProgram {
  readonly kind = "away-rules" as const;
  constructor(readonly id: PublicKey) {}
  metaList = (mint: PublicKey) => pda([Buffer.from("extra-account-metas"), mint.toBuffer()], this.id);
  stackPda = (mint: PublicKey) => pda([Buffer.from("rules"), mint.toBuffer()], this.id);
  walletPda = () => null;
  initIxs(a: InitArgs) {
    const data = Buffer.alloc(12);
    data[0] = 0xa0;
    data[1] = 1; // circuit breaker only
    data.writeUInt16LE(5000, 2); // ±50%
    data.writeUInt32LE(60, 4); // per minute
    return [new TransactionInstruction({
      programId: this.id,
      keys: [
        { pubkey: a.creator, isSigner: true, isWritable: true },
        { pubkey: a.mint, isSigner: false, isWritable: false },
        { pubkey: a.pool, isSigner: false, isWritable: false },
        { pubkey: this.stackPda(a.mint), isSigner: false, isWritable: true },
        { pubkey: this.metaList(a.mint), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })];
  }
  expectedExtras(mint: PublicKey, pool: PublicKey) {
    return [
      { pubkey: this.stackPda(mint), isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: this.id, isSigner: false, isWritable: false },
      { pubkey: this.metaList(mint), isSigner: false, isWritable: false },
    ];
  }
  openWalletIx = () => null;
  closeWalletIx = () => null;
  closeStackIx(mint: PublicKey, creator: PublicKey) {
    return null as any as TransactionInstruction; // away-rules close needs the pool too; not used by the stand-in
  }
  needsWalletRecord = () => false;
  async readStack() {
    return null;
  }
  async readWallet() {
    return null;
  }
}

/** Hook accounts Token-2022 will pass for one real transfer (source, destination, authority). */
export async function resolveHookAccounts(chain: Chain, mint: PublicKey, source: PublicKey, destination: PublicKey, authority: PublicKey): Promise<AccountMeta[]> {
  const ix = await createTransferCheckedWithTransferHookInstruction(sdkConnection(chain), source, mint, destination, authority, 0n, 6, [], "confirmed", TOKEN_2022_PROGRAM_ID);
  return ix.keys.slice(4);
}

/** The program the mint's TransferHook names right now (null once DBC retired it at graduation). */
export async function liveHookProgram(chain: Chain, mint: PublicKey): Promise<PublicKey | null> {
  const { accounts: [m] } = await chain.read([mint]);
  if (!m) return null;
  const h = getTransferHook(unpackMint(mint, m as any, TOKEN_2022_PROGRAM_ID));
  if (!h || h.programId.equals(PublicKey.default)) return null;
  return h.programId;
}
