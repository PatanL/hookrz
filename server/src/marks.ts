// The engine's creator-managed lists and the Token Gate, server side.
//   Marks (Blocklist 6006 / Allowlist Phase 6007): one PDA ["mark", mint, owner] per owner, flags 1 blocked · 2 pass,
//   written by the coin's creator with set_mark (0xA5). The blocked bit freezes per the Blocklist's lockAt (launch slot /
//   24 h / graduation); passes can be granted any time. Layout: programs/hookrz-engine/LAYOUT.md.
//   Token Gate (6017): the site's ticker names a mint (layout.mjs GATE_TOKENS, overridable per network with
//   HOOKRZ_GATE_MINTS='{"$BONK":"<mint>"}'); the engine reads the receiver owner's ATA of that mint.
import { PublicKey, Transaction, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { normalize } from "../../web/src/engine/engine.js";
import { GATE_TOKENS, MARK, MARK_SIZE, decodeMark } from "./layout.js";
import { AppError, ensure } from "./market.js";
import type { Chain } from "./chain.js";
import type { HookProgram, HookrzEngine } from "./hook.js";
import type { Store } from "./store.js";

export type Gate = { ticker: string; mint: PublicKey; tokenProgram: PublicKey; decimals: number; min: number; minRaw: bigint };

/** Gate ticker → mint address on this network. */
export function gateMints(): Record<string, string> {
  const base: Record<string, string> = Object.fromEntries(Object.entries(GATE_TOKENS).map(([k, v]) => [k, v.mint]));
  try {
    return { ...base, ...JSON.parse(process.env.HOOKRZ_GATE_MINTS ?? "{}") };
  } catch {
    return base;
  }
}

/** The stack's Token Gate on this network, or null. Refuses tickers without a mint ($HOOKRZ) and mints not on chain. */
export async function resolveGate(chain: Chain, stack: any[]): Promise<Gate | null> {
  const slot = normalize(stack).find((s: any) => s.id === "token-gate") as { params: any } | undefined;
  if (!slot) return null;
  const ticker = String(slot.params.ticker);
  const known = gateMints();
  const addr = known[ticker];
  ensure(addr, `Token Gate: ${ticker} has no mint yet, so it can't gate a coin. Pick ${Object.keys(known).join(", ")}.`, "GATE_NOT_LIVE");
  const mint = new PublicKey(addr);
  const { accounts: [acc] } = await chain.read([mint]);
  const isMint = !!acc && (acc.owner.equals(TOKEN_PROGRAM_ID) || acc.owner.equals(TOKEN_2022_PROGRAM_ID)) && acc.data.length >= 82 && acc.data[45] === 1;
  ensure(isMint, `Token Gate: the ${ticker} mint ${addr} isn't on this network`, "GATE_MINT_MISSING");
  const decimals = acc!.data[44];
  const min = Number(slot.params.min);
  ensure(Number.isFinite(min) && min >= 1, "Token Gate: the minimum must be at least 1 token", "STACK_INVALID");
  return { ticker, mint, tokenProgram: acc!.owner, decimals, min, minRaw: BigInt(Math.round(min)) * 10n ** BigInt(decimals) };
}

/** The stack with the Token Gate's minimum in the gate mint's raw units (what init_stack packs). */
export function withGateMin(stack: any[], gate: Gate | null) {
  if (!gate) return stack;
  return normalize(stack).map((s: any) => (s.id === "token-gate" ? { ...s, params: { ...s.params, minRaw: gate.minRaw.toString() } } : s));
}

/** The owner's gate balance (raw) in its associated token account of the gate mint; 0 without one. */
export async function gateBalanceRaw(chain: Chain, gate: { mint: PublicKey; tokenProgram: PublicKey }, owner: PublicKey): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(gate.mint, owner, true, gate.tokenProgram);
  const { accounts: [a] } = await chain.read([ata]);
  if (!a || a.data.length < 72 || !a.data.subarray(0, 32).equals(gate.mint.toBuffer()) || !a.data.subarray(32, 64).equals(owner.toBuffer())) return 0n;
  return a.data.readBigUInt64LE(64);
}

const engineOf = (hook: HookProgram | null) => {
  if (!hook || hook.kind !== "hookrz") throw new AppError("ENGINE_UNAVAILABLE", "The hook engine is not available on this network", 503);
  return hook as HookrzEngine;
};

/** Every mark of a coin (Blocklist and passes), straight from chain. */
export async function listMarks(chain: Chain, hook: HookProgram | null, mint: PublicKey) {
  const engine = engineOf(hook);
  const found = await chain.programAccounts(engine.id, [{ dataSize: MARK_SIZE }, { memcmp: { offset: 1, bytes: mint.toBytes() } }]);
  return found.map((x) => ({ address: x.pubkey.toBase58(), ...decodeMark(Buffer.from(x.account.data)) })).filter((m) => m.flags !== 0);
}

/** One owner's mark. */
export async function readMark(chain: Chain, hook: HookProgram | null, mint: PublicKey, owner: PublicKey) {
  const engine = engineOf(hook);
  const flags = await engine.readMark(chain, mint, owner);
  return { owner: owner.toBase58(), address: engine.markPda(mint, owner).toBase58(), flags, blocked: !!(flags & MARK.blocked), pass: !!(flags & MARK.pass) };
}

/** The Blocklist's lock (seconds after launch the blocked bit may change; 0xffffffff = until graduation), or null. */
export function blocklistLock(stack: { slots: { block: string; params: string }[] }) {
  const s = stack.slots.find((x) => x.block === "blocklist");
  return s ? Buffer.from(s.params, "hex").readUInt32LE(0) : null;
}

/**
 * Unsigned set_mark transactions for the coin's creator (POST /v1/coins/:mint/marks/prepare).
 * body: { creator, marks: [{ owner, blocked?, pass? }] }; an omitted field keeps the owner's current bit.
 */
export async function prepareMarks(chain: Chain, hook: HookProgram | null, store: Store, key: string, body: any) {
  const coin = store.findCoin(key);
  if (!coin) throw new AppError("NOT_FOUND", `No coin ${key}`, 404);
  const engine = engineOf(hook);
  ensure(typeof body.creator === "string", "creator (address) required");
  const creator = new PublicKey(body.creator);
  ensure(creator.toBase58() === coin.creator, "Only the coin's creator can edit its blocklist and passes", "NOT_CREATOR");
  const list: any[] = Array.isArray(body.marks) ? body.marks : [];
  ensure(list.length >= 1 && list.length <= 64, "marks: 1 to 64 entries of { owner, blocked?, pass? }");
  const mint = new PublicKey(coin.mint);
  const stack = await engine.readStack(chain, mint);
  ensure(stack, "The coin's Stack isn't on chain", "NOT_LAUNCHED");
  const lock = blocklistLock(stack!);
  const allowlist = stack!.slots.some((x) => x.block === "allowlist-phase");
  const { slot, unix } = await chain.read([]);
  const open = lock !== null && (Number(unix) - stack!.launchTs < lock || slot === stack!.launchSlot);
  const ixs: TransactionInstruction[] = [];
  const out: { owner: string; flags: number }[] = [];
  for (const m of list) {
    let owner: PublicKey;
    try { owner = new PublicKey(String(m.owner)); } catch { throw new AppError("BAD_REQUEST", `Not an address: ${m.owner}`); }
    if (m.blocked !== undefined) ensure(lock !== null, "This coin has no Blocklist", "NO_BLOCKLIST");
    if (m.pass !== undefined) ensure(allowlist, "This coin has no Allowlist Phase", "NO_ALLOWLIST");
    const cur = await engine.readMark(chain, mint, owner);
    let flags = cur;
    if (m.blocked !== undefined) flags = m.blocked ? flags | MARK.blocked : flags & ~MARK.blocked;
    if (m.pass !== undefined) flags = m.pass ? flags | MARK.pass : flags & ~MARK.pass;
    if (((flags ^ cur) & MARK.blocked) !== 0) ensure(open, "The blocklist is frozen: it can't change any more", "BLOCKLIST_FROZEN");
    if (flags === cur) continue;
    ixs.push(engine.setMarkIx(creator, mint, owner, flags));
    out.push({ owner: owner.toBase58(), flags });
  }
  const { blockhash } = await chain.blockhash();
  const txs: Transaction[] = [];
  for (const ix of ixs) {
    const cur = txs.at(-1);
    if (cur) {
      const trial = new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(...cur.instructions, ix);
      if (trial.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232) {
        txs[txs.length - 1] = trial;
        continue;
      }
    }
    txs.push(new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix));
  }
  return {
    mint: coin.mint, ticker: coin.ticker, marks: out, blocklistOpen: open,
    transactions: txs.map((tx, i) => {
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      return { label: `hookrz_engine set_mark × ${tx.instructions.length - 1}${txs.length > 1 ? ` (${i + 1}/${txs.length})` : ""}`, bytes: bytes.length, base64: bytes.toString("base64") };
    }),
  };
}

/**
 * What the reference engine's ctx needs about one trader for Blocklist, Allowlist Phase and Token Gate (quotes):
 * its mark flags and its gate balance in whole gate tokens, read from chain. Unknown trader → {} (optimistic).
 */
export async function traderLists(chain: Chain, hook: HookProgram | null, coin: { mint: string; stack: any[] }, owner: PublicKey | null): Promise<{ marks?: number; gateBal?: number }> {
  if (!owner || !hook || hook.kind !== "hookrz") return {};
  const engine = hook as HookrzEngine;
  const ids = normalize(coin.stack).map((x: any) => x.id);
  const mint = new PublicKey(coin.mint);
  const out: { marks?: number; gateBal?: number } = {};
  if (ids.includes("blocklist") || ids.includes("allowlist-phase")) out.marks = await engine.readMark(chain, mint, owner).catch(() => 0);
  if (ids.includes("token-gate")) {
    const gate = (await engine.readStack(chain, mint).catch(() => null))?.gate;
    if (gate) {
      const gm = new PublicKey(gate.mint);
      const { accounts: [acc] } = await chain.read([gm]);
      if (acc) out.gateBal = Number(await gateBalanceRaw(chain, { mint: gm, tokenProgram: acc.owner }, owner)) / 10 ** acc.data[44];
    }
  }
  return out;
}

// ───────── fork only: stand-in gate mints at the tickers' mainnet addresses ─────────
type ForkLike = { svm: any; faucet: { publicKey: PublicKey } };
const setRaw = (chain: ForkLike, key: PublicKey, owner: PublicKey, data: Buffer) =>
  chain.svm.setAccount({ address: key.toBase58(), lamports: chain.svm.minimumBalanceForRentExemption(BigInt(data.length)), data, space: BigInt(data.length), programAddress: owner.toBase58(), executable: false });
/** Fork only: SPL Token mints at every gate ticker's address (mint authority: the fork faucet), so Token Gate coins launch. */
export function forkGateMints(chain: ForkLike) {
  for (const [ticker, g] of Object.entries(GATE_TOKENS)) {
    const mint = new PublicKey(gateMints()[ticker] ?? g.mint);
    if (chain.svm.getAccount(mint.toBase58())?.exists) continue;
    const d = Buffer.alloc(82);
    d.writeUInt32LE(1, 0);
    chain.faucet.publicKey.toBuffer().copy(d, 4);
    d[44] = g.decimals;
    d[45] = 1;
    setRaw(chain, mint, TOKEN_PROGRAM_ID, d);
  }
}
/** Fork only: set `owner`'s associated token account of a (SPL Token) gate mint to `raw` tokens. */
export function forkFundGate(chain: ForkLike, mint: PublicKey, owner: PublicKey, raw: bigint) {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
  const d = Buffer.alloc(165);
  mint.toBuffer().copy(d, 0);
  owner.toBuffer().copy(d, 32);
  d.writeBigUInt64LE(raw, 64);
  d[108] = 1; // initialized
  setRaw(chain, ata, TOKEN_PROGRAM_ID, d);
  return ata;
}
