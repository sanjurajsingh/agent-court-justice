import { CHAIN } from "./config";

/**
 * Native GEN balance read straight from the network RPC, never cached and
 * never derived from app state. Used for the authoritative before/after
 * balance evidence in the Steward verification report.
 */
export async function getNativeBalance(address: string): Promise<bigint> {
  const url = (CHAIN as unknown as { rpcUrls?: { default?: { http?: string[] } } }).rpcUrls?.default
    ?.http?.[0];
  if (!url) throw new Error("No RPC endpoint configured for this network.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return BigInt(json.result ?? "0x0");
}
