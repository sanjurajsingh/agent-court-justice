import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CHAIN, NETWORK } from "@/lib/genlayer/config";
import { getInjectedProvider } from "@/lib/genlayer/client";

interface WalletState {
  address: string | null;
  chainId: number | null;
  hasProvider: boolean;
  connecting: boolean;
  error: string | null;
  expectedChainId: number;
  networkName: string;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

const expectedChainId = Number((CHAIN as unknown as { id: number }).id);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;
    setHasProvider(true);

    let cancelled = false;
    void (async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const id = (await provider.request({ method: "eth_chainId" })) as string;
        if (cancelled) return;
        setAddress(accounts?.[0] ?? null);
        setChainId(id ? Number.parseInt(id, 16) : null);
      } catch {
        /* wallet locked or unavailable */
      }
    })();

    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[] | undefined;
      setAddress(accounts?.[0] ?? null);
    };
    const onChain = (...args: never[]) => {
      const id = args[0] as unknown as string | undefined;
      setChainId(id ? Number.parseInt(id, 16) : null);
    };
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setError("No EVM wallet detected. Install MetaMask to use AgentCourt.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setAddress(accounts?.[0] ?? null);
      setChainId(id ? Number.parseInt(id, 16) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection rejected.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) return;
    const hexId = `0x${expectedChainId.toString(16)}`;
    const chain = CHAIN as unknown as {
      name?: string;
      rpcUrls?: { default?: { http?: string[] } };
      nativeCurrency?: { name: string; symbol: string; decimals: number };
    };
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexId,
              chainName: chain.name ?? NETWORK,
              nativeCurrency: chain.nativeCurrency ?? {
                name: "GEN",
                symbol: "GEN",
                decimals: 18,
              },
              rpcUrls: chain.rpcUrls?.default?.http ?? [],
            },
          ],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not switch network.");
      }
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      hasProvider,
      connecting,
      error,
      expectedChainId,
      networkName: NETWORK,
      wrongNetwork: address !== null && chainId !== null && chainId !== expectedChainId,
      connect,
      disconnect,
      switchNetwork,
    }),
    [address, chainId, hasProvider, connecting, error, connect, disconnect, switchNetwork],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
