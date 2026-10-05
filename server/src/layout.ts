// hookrz_engine wire formats. Source of truth: programs/hookrz-engine/LAYOUT.md and ENGINE's own encoder
// (programs/hookrz-engine/js/layout.mjs), which this file wraps so the server and the program never drift.
import { PublicKey, type AccountMeta } from "@solana/web3.js";
import * as E from "../../programs/hookrz-engine/js/layout.mjs";
import { normalize } from "../../web/src/engine/engine.js";

export const IX = E.IX as { initStack: number; openWallet: number; closeWallet: number; closeStack: number; writeScript: number; setMark: number };
/** Mark flags (Blocklist / Allowlist Phase): one 65-byte PDA ["mark", mint, owner] per owner. */
export const MARK = E.MARK as { blocked: number; pass: number };
export const MARK_SIZE = E.MARK_SIZE as number;
export const ATA_PROGRAM = new PublicKey(E.ATA_PROGRAM_ID);
/** Token Gate tickers → mainnet mints (layout.mjs GATE_TOKENS). HOOKRZ_GATE_MINTS='{"$BONK":"<mint>"}' overrides per network. */
export const GATE_TOKENS = E.GATE_TOKENS as Record<string, { mint: string; decimals: number }>;
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
export const usesWalletRecords = (stack: any[]) => has(stack, ["sandwich-guard", "sell-cooldown", "hold-timer", "seasoned-sells", "custom"]);
/** Blocklist / Allowlist Phase read both owners' marks. */
export const usesMarks = (stack: any[]) => has(stack, ["blocklist", "allowlist-phase"]);

/** init_stack data; `staged` = the script was already written with write_script chunks (then script = null). */
export function encodeInitStack({ stack, script, parent, staged = false }: { stack: any[]; script: Uint8Array | null; parent: boolean; staged?: boolean }) {
  return Buffer.from(E.initStackData(hookSlots(stack), { script: (staged ? null : script) as any, parent, staged }));
}
/** write_script (0xA4) chunk data. */
export const encodeWriteScript = (script: Uint8Array, offset: number, length: number) => Buffer.from(E.writeScriptData(script, offset, length));

type K = PublicKey;
const m = (pubkey: K, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner });
/** init_stack accounts; a Token Gate stack passes the gate mint after the (optional) parent Stack. */
export function initStackAccounts(a: { creator: K; mint: K; pool: K; config: K; stack: K; metaList: K; script: K; parentStack: K | null; system: K; gateMint?: K | null }) {
  return [m(a.creator, true, true), m(a.mint), m(a.pool), m(a.config), m(a.stack, true), m(a.metaList, true), m(a.script, true), m(a.system), ...(a.parentStack ? [m(a.parentStack)] : []), ...(a.gateMint ? [m(a.gateMint)] : [])];
}
/** set_mark (0xA5): the creator sets one owner's mark (MARK.blocked | MARK.pass). */
export function setMarkAccounts(a: { creator: K; mint: K; stack: K; mark: K; system: K }) {
  return [m(a.creator, true, true), m(a.mint), m(a.stack), m(a.mark, true), m(a.system)];
}
export const encodeSetMark = (flags: number, owner: PublicKey) => Buffer.from(E.setMarkData(flags, owner.toBytes()));
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

/**
 * ExtraAccountMetaList entries, exactly as init_stack writes them (LAYOUT.md order and writability). Marks need the
 * source and destination owners' mark PDAs; a Token Gate needs its gate mint, the gate's token program and the
 * destination owner's ATA of the gate mint (the ATA program sits between them).
 */
export function metaListEntries(
  k: { stack: K; pool: K; walletSrc: K; walletDst: K; script: K; markSrc?: K; markDst?: K; gate?: { mint: K; tokenProgram: K; ata: K } | null },
  stack: any[], script?: Uint8Array | null,
): AccountMeta[] {
  const custom = has(stack, ["custom"]);
  const out = [m(k.stack, has(stack, ["anti-bundle", "circuit-breaker", "creator-vest", "outflow-cap"]))];
  if (custom || has(stack, ["circuit-breaker", "lock-in", "chapters"])) out.push(m(k.pool));
  if (usesWalletRecords(stack)) out.push(m(k.walletSrc, true), m(k.walletDst, true));
  if (custom) out.push(m(k.script, true));
  if (custom && scriptReadsApp(script)) out.push(m(INSTRUCTIONS_SYSVAR));
  if (usesMarks(stack)) {
    if (!k.markSrc || !k.markDst) throw new Error("metaListEntries: this stack needs the owners' mark PDAs");
    out.push(m(k.markSrc), m(k.markDst));
  }
  if (has(stack, ["token-gate"])) {
    if (!k.gate) throw new Error("metaListEntries: a Token Gate stack needs its gate accounts");
    out.push(m(k.gate.mint), m(k.gate.tokenProgram), m(ATA_PROGRAM), m(k.gate.ata));
  }
  return out;
}

export type StackAccount = {
  version: number; flags: number; slotCount: number; mint: string; creator: string; pool: string; baseVault: string;
  parentStack: string | null; parentAuthor: string | null; launchSlot: number; launchTs: number; script: string | null;
  lastSqrt: bigint; migrationQuoteThreshold: bigint; activationPoint: bigint;
  /** Token Gate: the gate mint and the minimum in its raw units (null without the block). */
  gate: { mint: string; minRaw: bigint } | null;
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
    gate: (() => { const g = E.gateOf(s); return g && g.mint ? { mint: b58(g.mint), minRaw: g.minRaw } : null; })(),
  };
}
/** Does the on-chain Stack enforce exactly the prepared hook blocks (ids and packed params, in slot order)? A reason, or null.
 *  init_stack is creator-signed, so a creator could prepare one rule set (shown on the site) and arm another. */
export function stackMismatch(prepared: any[], onchain: Pick<StackAccount, "slots">): string | null {
  const want = hookSlots(prepared).map((s) => ({ id: BLOCK_IDS[s.id], params: Buffer.from(E.packParams(s.id, s.params)).toString("hex") }));
  if (want.length !== onchain.slots.length) return `${onchain.slots.length} rules on chain, ${want.length} prepared`;
  for (let i = 0; i < want.length; i++) {
    if (want[i].id !== onchain.slots[i].blockId) return `rule ${i + 1} is ${blockName(onchain.slots[i].blockId)} on chain`;
    if (want[i].params !== onchain.slots[i].params) return `rule ${i + 1} (${blockName(want[i].id)}) has different settings on chain`;
  }
  return null;
}
/** A decoded mark: flags plus the owner it belongs to. */
export function decodeMark(d: Buffer) {
  const x = E.decodeMark(d);
  return { flags: x.flags, blocked: x.blocked, pass: x.pass, mint: b58(x.mint), owner: b58(x.owner) };
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
  if (block === "outflow-cap") return { hour: Number(d.readBigUInt64LE(0)), sold: d.readBigUInt64LE(8) };
  return null;
}
