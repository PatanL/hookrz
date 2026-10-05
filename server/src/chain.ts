// One interface over the local LiteSVM fork and a real RPC cluster (devnet). Everything above this
// file (launch and trade builders, indexer, API) talks to a Chain and never to LiteSVM or RPC directly.
import type { AccountInfo, PublicKey } from "@solana/web3.js";

export type Mode = "fork" | "devnet" | "mainnet";
export type ChainAccount = AccountInfo<Buffer>;
export type ChainRead = { slot: number; unix: bigint; accounts: (ChainAccount | null)[] };
export type Simulation = { error: string | null; logs: string[]; units: number | null };
export type TokenBalance = { account: string; mint: string; owner: string; raw: string };

/** One transaction as the indexer sees it, landed or refused. */
export type TxRecord = {
  signature: string;
  slot: number;
  unix: number;
  ok: boolean;
  /** Raw error string (e.g. `InstructionError(4, Custom(6001))`), null when it landed. */
  error: string | null;
  /** The custom error code inside the failing instruction, if any (6001 …). */
  code: number | null;
  logs: string[];
  accounts: string[];
  signers: string[];
  pre: TokenBalance[];
  post: TokenBalance[];
  units: number | null;
  /** Top-level instructions (static keys resolved). */
  ixs: { program: string; accounts: string[]; data: string }[];
};

export interface Chain {
  readonly mode: Mode;
  read(keys: PublicKey[]): Promise<ChainRead>;
  rent(bytes: number): Promise<number>;
  blockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  simulate(bytes: Uint8Array): Promise<Simulation>;
  /** Sends a signed transaction. Resolves with the record whether it landed or was refused. */
  send(bytes: Uint8Array): Promise<TxRecord>;
  /** Subscribe to every transaction this chain sees (fork: every send; devnet: indexer polling). */
  onTx(f: (r: TxRecord) => void): () => void;
  record(signature: string): Promise<TxRecord | null>;
}

/** `custom program error: 0x1771` or `Custom(6001)` → 6001. */
export function customCode(text: string | null | undefined): number | null {
  if (!text) return null;
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (hex) return parseInt(hex[1], 16);
  const dec = /Custom\((\d+)\)/.exec(text) ?? /"Custom":\s*(\d+)/.exec(text);
  return dec ? Number(dec[1]) : null;
}
