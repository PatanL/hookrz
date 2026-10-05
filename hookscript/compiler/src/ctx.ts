// The Ctx the VM reads (mirror of hookscript_vm::Ctx), with defaults and the 578-byte binary codec.

export interface Lot { t: number; amount: bigint }
export interface WalletView {
  key: Uint8Array; hasRecord: boolean; isPool: boolean; balance: bigint;
  firstReceiptTs: bigint; lastBuySlot: bigint; lastBuyTs: bigint; lastSellTs: bigint;
  bought: bigint; sold: bigint; buys: number; sells: number;
  lotsIn: Lot[]; lotsOut: Lot[]; // up to 5 each, oldest first
}
export interface Ctx {
  kind: number; amount: bigint; decimals: number; supply: bigint; slot: bigint; now: bigint;
  launchTs: bigint; launchSlot: bigint; priceE6: bigint; progressPpm: number; quoteReserve: bigint; feeBps: number;
  creator: Uint8Array; app: Uint8Array; sameWallet: boolean; sender: WalletView; receiver: WalletView;
}

export const zeroKey = () => new Uint8Array(32);

export function wallet(p: Partial<WalletView> = {}): WalletView {
  return {
    key: zeroKey(), hasRecord: false, isPool: false, balance: 0n, firstReceiptTs: 0n, lastBuySlot: 0n, lastBuyTs: 0n,
    lastSellTs: 0n, bought: 0n, sold: 0n, buys: 0, sells: 0, lotsIn: [], lotsOut: [], ...p,
  };
}

export function ctx(p: Partial<Ctx> = {}): Ctx {
  return {
    kind: 0, amount: 0n, decimals: 6, supply: 1_000_000_000_000_000n, slot: 0n, now: 0n, launchTs: 0n, launchSlot: 0n,
    priceE6: 0n, progressPpm: 0, quoteReserve: 0n, feeBps: 100, creator: zeroKey(), app: zeroKey(), sameWallet: false,
    sender: wallet(), receiver: wallet(), ...p,
  };
}

export const CTX_BYTES = 578;

class Wr {
  b = new Uint8Array(CTX_BYTES); dv = new DataView(this.b.buffer); p = 0;
  u8(v: number) { this.dv.setUint8(this.p, v & 0xff); this.p += 1; }
  u16(v: number) { this.dv.setUint16(this.p, v & 0xffff, true); this.p += 2; }
  u32(v: number) { this.dv.setUint32(this.p, v >>> 0, true); this.p += 4; }
  u64(v: bigint) { this.dv.setBigUint64(this.p, BigInt.asUintN(64, v), true); this.p += 8; }
  i64(v: bigint) { this.dv.setBigInt64(this.p, BigInt.asIntN(64, v), true); this.p += 8; }
  key(k: Uint8Array) { this.b.set(k.subarray(0, 32), this.p); this.p += 32; }
  lots(l: Lot[]) { for (let i = 0; i < 5; i++) { this.u32(l[i]?.t ?? 0); this.u64(l[i]?.amount ?? 0n); } }
  wallet(w: WalletView) {
    this.key(w.key); this.u8(w.hasRecord ? 1 : 0); this.u8(w.isPool ? 1 : 0); this.u8(Math.min(w.lotsIn.length, 255)); this.u8(Math.min(w.lotsOut.length, 255));
    this.u32(w.buys); this.u32(w.sells); this.u64(w.balance); this.i64(w.firstReceiptTs); this.u64(w.lastBuySlot);
    this.i64(w.lastBuyTs); this.i64(w.lastSellTs); this.u64(w.bought); this.u64(w.sold); this.lots(w.lotsIn); this.lots(w.lotsOut);
  }
}

/** Ctx -> the fixed 578-byte layout `Ctx::decode` reads (SPEC §8 "Binary Ctx"). */
export function encodeCtx(c: Ctx): Uint8Array {
  const w = new Wr();
  w.u8(c.kind); w.u8(c.decimals); w.u8(c.sameWallet ? 1 : 0); w.u8(0); w.u32(c.progressPpm);
  w.u64(c.amount); w.u64(c.supply); w.u64(c.slot); w.i64(c.now); w.i64(c.launchTs); w.u64(c.launchSlot);
  w.u64(c.priceE6); w.u64(c.quoteReserve); w.u16(c.feeBps); w.key(c.creator); w.key(c.app);
  w.wallet(c.sender); w.wallet(c.receiver);
  if (w.p !== CTX_BYTES) throw new Error(`ctx encode size ${w.p}`);
  return w.b;
}

/** Inverse of encodeCtx (n_in / n_out beyond 5 are kept as counts by truncating lots). */
export function decodeCtx(b: Uint8Array): Ctx {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 0;
  const u8 = () => dv.getUint8(p++);
  const u16 = () => { const v = dv.getUint16(p, true); p += 2; return v; };
  const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };
  const u64 = () => { const v = dv.getBigUint64(p, true); p += 8; return v; };
  const i64 = () => { const v = dv.getBigInt64(p, true); p += 8; return v; };
  const key = () => { const k = b.slice(p, p + 32); p += 32; return k; };
  const lots = (cnt: number) => { const l: Lot[] = []; for (let i = 0; i < 5; i++) { const t = u32(); const amount = u64(); if (i < cnt) l.push({ t, amount }); } return l; };
  const wal = (): WalletView => {
    const k = key(); const hasRecord = u8() !== 0; const isPool = u8() !== 0; const nIn = u8(); const nOut = u8();
    const buys = u32(); const sells = u32(); const balance = u64(); const firstReceiptTs = i64(); const lastBuySlot = u64();
    const lastBuyTs = i64(); const lastSellTs = i64(); const bought = u64(); const sold = u64();
    return { key: k, hasRecord, isPool, buys, sells, balance, firstReceiptTs, lastBuySlot, lastBuyTs, lastSellTs, bought, sold, lotsIn: lots(nIn), lotsOut: lots(nOut) };
  };
  const kind = u8(); const decimals = u8(); const sameWallet = u8() !== 0; u8(); const progressPpm = u32();
  const amount = u64(); const supply = u64(); const slot = u64(); const now = i64(); const launchTs = i64(); const launchSlot = u64();
  const priceE6 = u64(); const quoteReserve = u64(); const feeBps = u16(); const creator = key(); const app = key();
  return { kind, decimals, sameWallet, progressPpm, amount, supply, slot, now, launchTs, launchSlot, priceE6, quoteReserve, feeBps, creator, app, sender: wal(), receiver: wal() };
}
