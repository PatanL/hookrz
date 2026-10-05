// SQLite (node:sqlite) store: coins, trades (landed and refused), holders, tx log. One file per network.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type CoinRow = {
  mint: string; ticker: string; name: string; desc: string; image: string | null; links: any; creator: string;
  pool: string; config: string; base_vault: string; hook_program: string | null; stack: any[]; script: any | null;
  parent: string | null; launch_sig: string | null; launch_slot: number; launch_ts: number; created_at: number;
  stage: string; amm_pool: string | null; price: number; progress: number; raised_sol: number; threshold_sol: number;
};
export type TradeRow = {
  sig: string; mint: string; wallet: string; kind: "buy" | "sell" | "send"; tokens: number; sol: number; ok: boolean;
  code: number | null; by: string | null; msg: string | null; verdicts: any[] | null; slot: number; ts: number; t: number;
  price_before: number | null; price_after: number | null; units: number | null; dest: string | null;
};

export class Store {
  db: DatabaseSync;
  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS coins (
        mint TEXT PRIMARY KEY, ticker TEXT UNIQUE NOT NULL, name TEXT NOT NULL, desc TEXT NOT NULL DEFAULT '', image TEXT, links TEXT,
        creator TEXT NOT NULL, pool TEXT NOT NULL, config TEXT NOT NULL, base_vault TEXT NOT NULL, hook_program TEXT, stack TEXT NOT NULL,
        script TEXT, parent TEXT, launch_sig TEXT, launch_slot INTEGER NOT NULL DEFAULT 0, launch_ts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, stage TEXT NOT NULL DEFAULT 'pending', amm_pool TEXT, price REAL NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0, raised_sol REAL NOT NULL DEFAULT 0, threshold_sol REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS trades (
        sig TEXT PRIMARY KEY, mint TEXT NOT NULL, wallet TEXT NOT NULL, kind TEXT NOT NULL, tokens REAL NOT NULL, sol REAL NOT NULL,
        ok INTEGER NOT NULL, code INTEGER, by TEXT, msg TEXT, verdicts TEXT, slot INTEGER NOT NULL, ts INTEGER NOT NULL, t REAL NOT NULL,
        price_before REAL, price_after REAL, units INTEGER, dest TEXT);
      CREATE INDEX IF NOT EXISTS trades_mint ON trades(mint, ts);
      CREATE TABLE IF NOT EXISTS holders (mint TEXT NOT NULL, owner TEXT NOT NULL, account TEXT NOT NULL, raw TEXT NOT NULL, PRIMARY KEY (mint, account));
      CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }
  private coin(r: any): CoinRow | null {
    if (!r) return null;
    return { ...r, links: r.links ? JSON.parse(r.links) : {}, stack: JSON.parse(r.stack), script: r.script ? JSON.parse(r.script) : null };
  }
  upsertCoin(c: Partial<CoinRow> & { mint: string }) {
    const cur = this.getCoin(c.mint);
    const row = { ...cur, ...c } as CoinRow;
    this.db.prepare(`INSERT INTO coins (mint,ticker,name,desc,image,links,creator,pool,config,base_vault,hook_program,stack,script,parent,launch_sig,launch_slot,launch_ts,created_at,stage,amm_pool,price,progress,raised_sol,threshold_sol)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mint) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,desc=excluded.desc,image=excluded.image,links=excluded.links,creator=excluded.creator,
        pool=excluded.pool,config=excluded.config,base_vault=excluded.base_vault,hook_program=excluded.hook_program,stack=excluded.stack,script=excluded.script,
        parent=excluded.parent,launch_sig=excluded.launch_sig,launch_slot=excluded.launch_slot,launch_ts=excluded.launch_ts,stage=excluded.stage,amm_pool=excluded.amm_pool,
        price=excluded.price,progress=excluded.progress,raised_sol=excluded.raised_sol,threshold_sol=excluded.threshold_sol`).run(
      row.mint, row.ticker, row.name, row.desc ?? "", row.image ?? null, JSON.stringify(row.links ?? {}), row.creator, row.pool, row.config, row.base_vault,
      row.hook_program ?? null, JSON.stringify(row.stack ?? []), row.script ? JSON.stringify(row.script) : null, row.parent ?? null, row.launch_sig ?? null,
      row.launch_slot ?? 0, row.launch_ts ?? 0, row.created_at ?? Date.now(), row.stage ?? "pending", row.amm_pool ?? null, row.price ?? 0, row.progress ?? 0,
      row.raised_sol ?? 0, row.threshold_sol ?? 0,
    );
    return this.getCoin(c.mint)!;
  }
  getCoin(mint: string) {
    return this.coin(this.db.prepare("SELECT * FROM coins WHERE mint = ?").get(mint));
  }
  /** By mint or ticker (the site keys pages by ticker). */
  findCoin(key: string) {
    return this.coin(this.db.prepare("SELECT * FROM coins WHERE mint = ? OR upper(ticker) = upper(?)").get(key, key));
  }
  coins(includePending = false) {
    return (this.db.prepare(`SELECT * FROM coins ${includePending ? "" : "WHERE stage != 'pending'"} ORDER BY created_at DESC`).all() as any[]).map((r) => this.coin(r)!);
  }
  deleteCoin(mint: string) {
    this.db.prepare("DELETE FROM coins WHERE mint = ? AND stage = 'pending'").run(mint);
  }
  addTrade(t: TradeRow) {
    this.db.prepare(`INSERT OR REPLACE INTO trades (sig,mint,wallet,kind,tokens,sol,ok,code,by,msg,verdicts,slot,ts,t,price_before,price_after,units,dest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      t.sig, t.mint, t.wallet, t.kind, t.tokens, t.sol, t.ok ? 1 : 0, t.code, t.by, t.msg, t.verdicts ? JSON.stringify(t.verdicts) : null, t.slot, t.ts, t.t, t.price_before, t.price_after, t.units, t.dest,
    );
  }
  private trade(r: any): TradeRow {
    return { ...r, ok: !!r.ok, verdicts: r.verdicts ? JSON.parse(r.verdicts) : null };
  }
  trades(mint: string, limit = 40) {
    return (this.db.prepare("SELECT * FROM trades WHERE mint = ? ORDER BY ts DESC, slot DESC, rowid DESC LIMIT ?").all(mint, limit) as any[]).map((r) => this.trade(r));
  }
  walletTrades(mint: string, wallet: string) {
    return (this.db.prepare("SELECT * FROM trades WHERE mint = ? AND (wallet = ? OR dest = ?) AND ok = 1 ORDER BY ts, rowid").all(mint, wallet, wallet) as any[]).map((r) => this.trade(r));
  }
  tradesSince(mint: string, ts: number) {
    return (this.db.prepare("SELECT * FROM trades WHERE mint = ? AND ts >= ? AND ok = 1 ORDER BY ts, rowid").all(mint, ts) as any[]).map((r) => this.trade(r));
  }
  stats(mint: string, since: number) {
    const all = this.db.prepare("SELECT count(*) n, sum(ok) landed, sum(CASE WHEN ok = 1 THEN sol ELSE 0 END) vol FROM trades WHERE mint = ?").get(mint) as any;
    const day = this.db.prepare("SELECT sum(CASE WHEN ok = 1 THEN sol ELSE 0 END) vol FROM trades WHERE mint = ? AND ts >= ?").get(mint, since) as any;
    const first = this.db.prepare("SELECT price_before p FROM trades WHERE mint = ? AND ok = 1 AND ts >= ? ORDER BY ts, rowid LIMIT 1").get(mint, since) as any;
    return { trades: Number(all.n ?? 0), landed: Number(all.landed ?? 0), refused: Number(all.n ?? 0) - Number(all.landed ?? 0), volSol: Number(all.vol ?? 0), vol24Sol: Number(day.vol ?? 0), price24: first?.p ?? null };
  }
  setHolder(mint: string, account: string, owner: string, raw: string) {
    if (raw === "0") this.db.prepare("DELETE FROM holders WHERE mint = ? AND account = ?").run(mint, account);
    else this.db.prepare("INSERT OR REPLACE INTO holders (mint, owner, account, raw) VALUES (?,?,?,?)").run(mint, owner, account, raw);
  }
  holders(mint: string) {
    return this.db.prepare("SELECT owner, account, raw FROM holders WHERE mint = ? ORDER BY CAST(raw AS REAL) DESC").all(mint) as { owner: string; account: string; raw: string }[];
  }
  kv(k: string, v?: string) {
    if (v === undefined) return (this.db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as any)?.v ?? null;
    this.db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)").run(k, v);
    return v;
  }
}
