import { createClient, createAccount } from "genlayer-js";
import type { GenLayerClient, Account } from "genlayer-js/types";
import { CHAIN } from "./config";

type AnyClient = GenLayerClient<typeof CHAIN>;

let readClient: AnyClient | null = null;
let writeClient: AnyClient | null = null;
let writeClientAddress: string | null = null;

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: never[]) => void) => void;
  removeListener?: (event: string, handler: (...args: never[]) => void) => void;
}

export function getInjectedProvider(): Eip1193Provider | null {
  const eth = (globalThis as { ethereum?: Eip1193Provider }).ethereum;
  return eth ?? null;
}

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
 * adjudication, appeals and settlement. The wallet — never a backend
 * session — is the sole source of authority.
 */
export async function getWalletClient(): Promise<AnyClient> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error("No wallet found. Install MetaMask to use AgentCourt.");
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account.");

  if (!writeClient || writeClientAddress !== address) {
    writeClient = createClient({ chain: CHAIN, account: address } as never) as AnyClient;
    writeClientAddress = address;
  }
  await writeClient.initializeConsensusSmartContract();
  return writeClient;
}

/** Ephemeral local account — handy for tests and scripts, never for user funds. */
export function createEphemeralAccount(): Account {
  return createAccount();
}

export async function connectWallet(): Promise<string> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found. Install MetaMask to use AgentCourt.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("Wallet returned no account.");
  return address;
}
