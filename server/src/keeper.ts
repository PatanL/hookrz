// The public keeper. Phase 1 does one real job: crank DBC → DAMM v2 migration once a curve completes
// (permissionless; the platform key pays the fee). The rest are typed interfaces with stub bodies so the
// API, indexer and UI can be wired against them now:
//   burns          — sniper-fee-burn excess + buyback-burn: claim creator fees, swap for the coin, burn
//   royalties      — the remix royalty: stack author's 10% of the fee split, one level up only
//   game payouts   — Hookscript games (King of the Hill …): read the coin's Script `globals`, pay from creator fees
import { PublicKey } from "@solana/web3.js";
import { snapshot, buildMigration } from "./market.js";
import type { Hookrz } from "./service.js";

export type KeeperAction = { kind: "migrate" | "burn" | "royalty" | "game-payout"; mint: string; signature: string | null; detail: any; at: number };

export interface BurnJob { mint: string; claimLamports: bigint; burnRaw: bigint }
export interface RoyaltyJob { mint: string; author: string; lamports: bigint }
export interface GamePayoutJob { mint: string; game: string; winner: string; lamports: bigint; globals: string /* base64 */ }

export class Keeper {
  readonly log: KeeperAction[] = [];
  private busy = new Set<string>();
  constructor(private svc: Hookrz) {}

  async migrate(mint: string) {
    if (this.busy.has(mint)) return null;
    this.busy.add(mint);
    try {
      const c = this.svc.store.getCoin(mint);
      if (!c) return null;
      const s = await snapshot(this.svc.chain, new PublicKey(c.pool));
      if (s.stage !== "graduating") return null;
      const { tx, ammPool } = await buildMigration(this.svc.chain, s, this.svc.platform.publicKey);
      tx.partialSign(this.svc.platform);
      const r = await this.svc.chain.send(tx.serialize());
      if (!r.ok) throw new Error(`migration failed: ${r.error}\n${r.logs.slice(-8).join("\n")}`);
      this.record({ kind: "migrate", mint, signature: r.signature, detail: { ammPool: ammPool.toBase58() }, at: Date.now() });
      return r.signature;
    } finally {
      this.busy.delete(mint);
    }
  }

  /** Phase 2: claim the creator fee share above 1% during the sniper-fee window and burn the coin bought with it. */
  async planBurns(): Promise<BurnJob[]> {
    return [];
  }
  /** Phase 2: pay each remixed stack's author their royalty from the platform share. */
  async planRoyalties(): Promise<RoyaltyJob[]> {
    return [];
  }
  /** Phase 2: decode a game's globals (e.g. KOTH king pubkey + crown time) and pay the winner from creator fees. */
  async planGamePayouts(): Promise<GamePayoutJob[]> {
    return [];
  }

  private record(a: KeeperAction) {
    this.log.unshift(a);
    this.log.length = Math.min(this.log.length, 500);
    (this.svc as any).events.emit("event", { type: "keeper", ...a });
  }
}
