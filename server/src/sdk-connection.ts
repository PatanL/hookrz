import { Connection, PublicKey } from "@solana/web3.js";
import type { Chain } from "./chain.js";
/** SDK instruction builders can read the same isolated accounts as the app.
 * Unimplemented local RPC calls THROW, never fall back to any public network. */
export function sdkConnection(chain: Chain): Connection {
  const existing = (chain as Chain & { connection?: Connection }).connection;
  if (existing) return existing;
  const connection = new Connection("http://127.0.0.1:1", "confirmed");
  const anyConnection = connection as any;
  anyConnection._rpcRequest = async (method: string) => {
    throw new Error(`Unsupported isolated RPC method: ${method}`);
  };
  anyConnection._rpcBatchRequest = async () => {
    throw new Error("Unsupported isolated RPC batch");
  };
  anyConnection.getAccountInfo = async (key: PublicKey) =>
    (await chain.read([key])).accounts[0];
  anyConnection.getAccountInfoAndContext = async (key: PublicKey) => {
    const r = await chain.read([key]);
    return { context: { slot: r.slot }, value: r.accounts[0] };
  };
  anyConnection.getMultipleAccountsInfo = async (keys: PublicKey[]) =>
    (await chain.read(keys)).accounts;
  anyConnection.getMultipleAccountsInfoAndContext = async (
    keys: PublicKey[],
  ) => {
    const r = await chain.read(keys);
    return { context: { slot: r.slot }, value: r.accounts };
  };
  anyConnection.getLatestBlockhash = () => chain.blockhash();
  anyConnection.getMinimumBalanceForRentExemption = (bytes: number) =>
    chain.rent(bytes);
  anyConnection.getSlot = async () => (await chain.read([])).slot;
  anyConnection.getBlockTime = async () => Number((await chain.read([])).unix);
  anyConnection.getBalance = async (key: PublicKey) =>
    (await chain.read([key])).accounts[0]?.lamports ?? 0;
  anyConnection.getEpochInfo = async () => {
    const r = await chain.read([]);
    return {
      epoch: Number((chain as any).svm?.getClock().epoch ?? 0),
      slotIndex: 0,
      slotsInEpoch: 432000,
      absoluteSlot: r.slot,
    };
  };
  return connection;
}
