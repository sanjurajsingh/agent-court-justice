import { AlertTriangle, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { shortAddress } from "@/lib/agreement-utils";

export function WalletButton() {
  const { address, connect, connecting, hasProvider, wrongNetwork, switchNetwork, networkName } =
    useWallet();

  if (!hasProvider) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
      >
        <Wallet className="size-4" /> Install a wallet
      </a>
    );
  }

  if (wrongNetwork) {
    return (
      <Button variant="destructive" size="sm" onClick={() => void switchNetwork()}>
        <AlertTriangle className="size-4" /> Switch to {networkName}
      </Button>
    );
  }

  if (!address) {
    return (
      <Button size="sm" onClick={() => void connect()} disabled={connecting}>
        <Wallet className="size-4" />
        {connecting ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-md border border-brass/40 bg-brass/10 px-3 font-mono text-xs text-brass">
      <span className="size-1.5 rounded-full bg-verdict" />
      {shortAddress(address)}
    </span>
  );
}

/** Full-width banner used on action pages. */
export function NetworkNotice() {
  const { address, wrongNetwork, switchNetwork, networkName, expectedChainId, chainId, hasProvider } =
    useWallet();

  if (!hasProvider) {
    return (
      <Banner tone="warn">
        No EVM wallet detected. AgentCourt signs every action with your wallet, install MetaMask to
        continue.
      </Banner>
    );
  }
  if (!address) {
    return <Banner tone="info">Connect your wallet to sign transactions on {networkName}.</Banner>;
  }
  if (wrongNetwork) {
    return (
      <Banner tone="warn">
        Wrong network: your wallet is on chain {chainId}, AgentCourt is deployed on {networkName}{" "}
        (chain {expectedChainId}).{" "}
        <button className="underline" onClick={() => void switchNetwork()}>
          Switch network
        </button>
      </Banner>
    );
  }
  return null;
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <div
      className={`mb-6 rounded-md border px-4 py-3 text-sm ${
        tone === "warn"
          ? "border-dispute/40 bg-dispute/10 text-dispute"
          : "border-consensus/40 bg-consensus/10 text-consensus"
      }`}
    >
      {children}
    </div>
  );
}
