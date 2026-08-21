import { createClient, createAccount } from "genlayer-js";
import type { GenLayerClient, Account } from "genlayer-js/types";
import { CHAIN } from "./config";

type AnyClient = GenLayerClient<typeof CHAIN>;

let readClient: AnyClient | null = null;
let writeClient: AnyClient | null = null;

/** Read-only client (view methods, tx queries). No wallet required. */
export function getReadClient(): AnyClient {
  if (!readClient) {
    readClient = createClient({ chain: CHAIN } as never) as AnyClient;
  }
  return readClient;
}

/**
 * Client bound to the browser wallet (MetaMask / any EIP-1193 provider).
 * Used for every state-changing call: funding escrow, evidence, disputes,
 * adjudication, appeals and settlement.
 */
export async function getWalletClient(): Promise<AnyClient> {
  const ethereum = (globalThis as { ethereum?: unknown }).ethereum;
  if (!ethereum) throw new Error("No wallet found. Install MetaMask to use AgentCourt.");
  if (!writeClient) {
    writeClient = createClient({ chain: CHAIN } as never) as AnyClient;
  }
  await writeClient.initializeConsensusSmartContract();
  return writeClient;
}

/** Ephemeral local account — handy for tests and scripts, never for user funds. */
export function createEphemeralAccount(): Account {
  return createAccount();
}

export async function connectWallet(): Promise<string> {
  const client = await getWalletClient();
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("Wallet returned no account.");
  return address;
}
