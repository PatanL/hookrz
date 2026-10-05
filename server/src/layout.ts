// hookrz_engine wire formats. Source of truth: programs/hookrz-engine/LAYOUT.md and ENGINE's own encoder
// (programs/hookrz-engine/js/layout.mjs), which this file wraps so the server and the program never drift.
import { PublicKey, type AccountMeta } from "@solana/web3.js";
import * as E from "../../programs/hookrz-engine/js/layout.mjs";
import { normalize } from "../../web/src/engine/engine.js";

export const IX = E.IX as { initStack: number; openWallet: number; closeWallet: number; closeStack: number; writeScript: number };
export const INSTRUCTIONS_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");
/** Hookscript header byte 3, flag 0x08: the script reads `transfer.app` (needs the instructions sysvar). */
export const scriptReadsApp = (script: Uint8Array | null | undefined) => !!script && script.length > 3 && (script[3] & 0x08) !== 0;
export const BLOCK_IDS = E.BLOCK_IDS as Record<string, number>;
export const blockName = (id: number) => (E.BLOCK_NAMES as Record<number, string>)[id] ?? `block-${id}`;

/** Hook blocks of a stack the engine runs, in slot order (curve/crank/mint blocks are not in the engine). */
export function hookSlots(stack: any[]) {
  return normalize(stack).filter((s: any) => BLOCK_IDS[s.id] !== undefined) as { id: string; params: any }[];
}
const has = (stack: any[], ids: string[]) => hookSlots(stack).some((s) => ids.includes(s.id));
export const usesWalletRecords = (stack: any[]) => has(stack, ["sandwich-guard", "sell-cooldown", "hold-timer", "custom"]);

/** init_stack data; `staged` = the script was already written with write_script chunks (then script = null). */
export function encodeInitStack({ stack, script, parent, staged = false }: { stack: any[]; script: Uint8Array | null; parent: boolean; staged?: boolean }) {
  return Buffer.from(E.initStackData(hookSlots(stack), { script: (staged ? null : script) as any, parent, staged }));
}
/** write_script (0xA4) chunk data. */
export const encodeWriteScript = (script: Uint8Array, offset: number, length: number) => Buffer.from(E.writeScriptData(script, offset, length));

type K = PublicKey;
const m = (pubkey: K, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner });
export function initStackAccounts(a: { creator: K; mint: K; pool: K; config: K; stack: K; metaList: K; script: K; parentStack: K | null; system: K }) {
  return [m(a.creator, true, true), m(a.mint), m(a.pool), m(a.config), m(a.stack, true), m(a.metaList, true), m(a.script, true), m(a.system), ...(a.parentStack ? [m(a.parentStack)] : [])];
}
export function openWalletAccounts(a: { payer: K; mint: K; tokenAccount: K; wallet: K; system: K }) {
  return [m(a.payer, true, true), m(a.mint), m(a.tokenAccount), m(a.wallet, true), m(a.system)];
}
export function closeWalletAccounts(a: { wallet: K; mint: K; rentTo: K }) {
  return [m(a.wallet, true), m(a.mint), m(a.rentTo, true)];
}
export function writeScriptAccounts(a: { creator: K; mint: K; pool: K; stack: K; script: K; system: K }) {
  return [m(a.creator, true, true), m(a.mint), m(a.pool), m(a.stack), m(a.script, true), m(a.system)];
}
export function closeStackAccounts(a: { stack: K; metaList: K; script: K; mint: K; creator: K }) {
  return [m(a.stack, true), m(a.metaList, true), m(a.script, true), m(a.mint), m(a.creator, true)];
}

/** ExtraAccountMetaList entries, exactly as init_stack writes them (LAYOUT.md order and writability). */
export function metaListEntries(k: { stack: K; pool: K; walletSrc: K; walletDst: K; script: K }, stack: any[], script?: Uint8Array | null): AccountMeta[] {
  const custom = has(stack, ["custom"]);
  const out = [m(k.stack, has(stack, ["anti-bundle", "circuit-breaker", "creator-vest"]))];
  if (custom || has(stack, ["circuit-breaker", "lock-in"])) out.push(m(k.pool));
  if (usesWalletRecords(stack)) out.push(m(k.walletSrc, true), m(k.walletDst, true));
  if (custom) out.push(m(k.script, true));
  if (custom && scriptReadsApp(script)) out.push(m(INSTRUCTIONS_SYSVAR));
  return out;
}

export type StackAccount = {
  version: number; flags: number; slotCount: number; mint: string; creator: string; pool: string; baseVault: string;
  parentStack: string | null; parentAuthor: string | null; launchSlot: number; launchTs: number; script: string | null;
  lastSqrt: bigint; migrationQuoteThreshold: bigint; activationPoint: bigint;
  /** Creator Vesting: the creator's launch bag (raw), 0 until recorded. */
  creatorBase: bigint;
  slots: { blockId: number; block: string; params: string; state: string }[];
};
const b58 = (k: Uint8Array) => new PublicKey(k).toBase58();
const opt = (k: Uint8Array) => (k.every((x) => x === 0) ? null : b58(k));
export function decodeStack(d: Buffer): StackAccount {
  const s = E.decodeStack(d);
  return {
    version: s.version, flags: s.flags, slotCount: s.slots.length, mint: b58(s.mint), creator: b58(s.creator), pool: b58(s.pool), baseVault: b58(s.baseVault),
    parentStack: opt(s.parentStack), parentAuthor: opt(s.parentAuthor), launchSlot: Number(s.launchSlot), launchTs: Number(s.launchTs), script: opt(s.script),
    lastSqrt: s.lastSqrt, migrationQuoteThreshold: s.migrationQuoteThreshold, activationPoint: s.activationPoint ?? 0n, creatorBase: E.creatorBaseOf(s), slots: s.slots,
  };
}

export type WalletRecord = {
  version: number; flags: number; lots: { t: number; amount: bigint }[]; firstReceiptTs: number | null; lastBuySlot: number | null; lastSellTs: number | null;
  payer: string; tokenAccount: string; scriptVars: Buffer;
  lastBuyTs: number | null; bought: bigint; sold: bigint; buys: number; sells: number; lotsOut: { t: number; amount: bigint }[];
};
export function decodeWallet(d: Buffer): WalletRecord {
  const w = E.decodeWallet(d);
  return {
    version: w.version, flags: w.flags, lots: w.lots.filter((l: any) => l.amount > 0n),
    firstReceiptTs: w.hasReceived ? Number(w.firstReceiptTs) : null, lastBuySlot: w.hasBought ? Number(w.lastBuySlot) : null, lastSellTs: w.hasSold ? Number(w.lastSellTs) : null,
    payer: b58(w.payer), tokenAccount: b58(w.tokenAccount), scriptVars: Buffer.from(w.scriptVars),
    lastBuyTs: w.lastBuyTs ? Number(w.lastBuyTs) : null, bought: w.bought ?? 0n, sold: w.sold ?? 0n, buys: w.buys ?? 0, sells: w.sells ?? 0,
    lotsOut: (w.lotsOut ?? []).filter((l: any) => l.amount > 0n),
  };
}
/** Anti-Bundle slot state: { slot, buys }; Circuit Breaker: { window, openSqrt }. */
export function slotState(s: StackAccount, block: string) {
  const slot = s.slots.find((x) => x.block === block);
  if (!slot) return null;
  const d = Buffer.from(slot.state, "hex");
  if (block === "anti-bundle") return { slot: Number(d.readBigUInt64LE(0)), buys: Number(d.readBigUInt64LE(8)) };
  if (block === "circuit-breaker") return { window: Number(d.readBigInt64LE(0)), openSqrt: d.readBigUInt64LE(8) | (d.readBigUInt64LE(16) << 64n) };
  return null;
}
