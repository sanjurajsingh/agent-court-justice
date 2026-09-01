import { Link } from "@tanstack/react-router";

import logoAsset from "@/assets/agentcourt-logo.png.asset.json";
import { WalletButton } from "./WalletButton";

const NAV = [
  { to: "/agreements", label: "Agreements" },
  { to: "/create", label: "Create" },
  { to: "/dashboard", label: "My Cases" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src={logoAsset.url}
            alt="AgentCourt logo"
            className="size-8 rounded-md border border-brass/40"
          />
          <span className="font-display text-lg leading-none tracking-tight">AgentCourt</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "text-foreground bg-muted/60" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <WalletButton />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>AgentCourt, evidence-based dispute resolution for the agent economy.</p>
        <p className="font-mono">
          Judgments are produced by a GenLayer Intelligent Contract. No off-chain arbiter.
        </p>
      </div>
    </footer>
  );
}
