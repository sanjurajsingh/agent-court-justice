import { localnet, studionet, testnetAsimov } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";

export type NetworkName = "localnet" | "studionet" | "testnetAsimov";

const CHAINS: Record<NetworkName, GenLayerChain> = {
  localnet,
  studionet,
  testnetAsimov,
};

/** Network the dApp talks to. Override with VITE_GENLAYER_NETWORK. */
export const NETWORK: NetworkName =
  (import.meta.env["VITE_GENLAYER_NETWORK"] as NetworkName | undefined) ?? "testnetAsimov";

export const CHAIN: GenLayerChain = CHAINS[NETWORK] ?? testnetAsimov;

/**
 * Deployed AgentCourt Intelligent Contract address.
 * Configured purely through env: VITE_AGENTCOURT_CONTRACT_ADDRESS (preferred)
 * or the legacy VITE_AGENTCOURT_ADDRESS. Never hardcoded into contract calls.
 */
export const AGENTCOURT_ADDRESS = ((import.meta.env["VITE_AGENTCOURT_CONTRACT_ADDRESS"] ??
  import.meta.env["VITE_AGENTCOURT_ADDRESS"] ??
  "") as string).trim();

/** 1 GEN = 10^18 wei. */
export const GEN_DECIMALS = 18n;

export function genToWei(gen: string | number): bigint {
  const [whole, frac = ""] = String(gen).split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * 10n ** GEN_DECIMALS + BigInt(padded || "0");
}

export function weiToGen(wei: bigint | string, precision = 4): string {
  const value = typeof wei === "string" ? BigInt(wei) : wei;
  const whole = value / 10n ** GEN_DECIMALS;
  const frac = (value % 10n ** GEN_DECIMALS).toString().padStart(18, "0").slice(0, precision);
  return `${whole}.${frac}`;
}
