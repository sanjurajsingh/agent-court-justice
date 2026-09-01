import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { StatusBadge } from "@/components/StatusBadge";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { getAgreementsFor, type Agreement } from "@/lib/genlayer/agentcourt";
import { agreementTitle, gen, isContested, isOpen, latestDecision } from "@/lib/agreement-utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "My Cases, AgentCourt" },
      {
        name: "description",
        content:
          "Every AgentCourt agreement involving your connected wallet: escrow, disputes, verdicts and settlement.",
      },
      { property: "og:title", content: "My Cases, AgentCourt" },
      {
        property: "og:description",
        content: "Escrow, disputes, verdicts and settlement for your connected wallet.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { address, connect, hasProvider } = useWallet();
  const enabled = hasContract() && Boolean(address);

  const { data, isLoading, error } = useQuery({
    queryKey: ["agreements-for", address],
    queryFn: () => getAgreementsFor(address!),
    enabled,
  });

  const list = data ? [...data].reverse() : undefined;
  const active = list?.filter((a) => isOpen(a.status)) ?? [];
  const contested = list?.filter((a) => isContested(a.status)) ?? [];
  const resolved = list?.filter((a) => a.status === "SETTLED" || a.status === "CANCELLED") ?? [];
  const escrowed =
    list?.reduce((sum, a) => sum + BigInt(a.funded) + BigInt(a.bond_pool), 0n) ?? 0n;

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <p className="text-eyebrow">Wallet-scoped</p>
      <h1 className="mt-3 text-4xl">My cases</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Agreements where your connected wallet is the client or the provider, read from{" "}
        <code className="font-mono">get_agreements_for()</code> in the contract.
      </p>

      <div className="mt-8">
        <ContractNotice />
      </div>

      {!address && (
        <div className="panel p-10 text-center">
          <p className="text-muted-foreground">
            {hasProvider
              ? "Connect your wallet to see your cases. The wallet is the only source of identity here."
              : "No EVM wallet detected. Install MetaMask to view your cases."}
          </p>
          {hasProvider && (
            <Button className="mt-4" onClick={() => void connect()}>
              Connect wallet
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not read the contract: {(error as Error).message}
        </p>
      )}

      {address && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
          <Stat label="Total cases" value={list?.length} />
          <Stat label="Active" value={list ? active.length : undefined} />
          <Stat label="Disputed" value={list ? contested.length : undefined} />
          <Stat label="Your escrow" value={list ? `${gen(escrowed, 3)} GEN` : undefined} />
        </div>
      )}

      {enabled && isLoading && (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {list && list.length === 0 && (
        <div className="panel mt-8 p-10 text-center">
          <p className="text-muted-foreground">This wallet is not party to any agreement yet.</p>
          <Link to="/create" className="mt-3 inline-block text-brass underline">
            Create an agreement
          </Link>
        </div>
      )}

      {list && list.length > 0 && (
        <div className="mt-10 space-y-10">
          <Group title="Active" items={active} />
          <Group title="Disputed & adjudicated" items={contested} />
          <Group title="Resolved" items={resolved} />
        </div>
      )}
    </div>
  );
}

function Group({ title, items }: { title: string; items: Agreement[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="text-eyebrow">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.map((a) => {
          const d = latestDecision(a);
          return (
            <Link
              key={a.id}
              to="/agreements/$id"
              params={{ id: String(a.id) }}
              className="panel flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:border-brass/40"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">#{a.id}</span>
                  <StatusBadge status={a.status} />
                </div>
                <p className="mt-2 text-lg">{agreementTitle(a)}</p>
                {d && (
                  <p className="mt-1 font-mono text-xs text-brass">
                    {d.winner} · client {d.client_bps / 100}% / provider {d.provider_bps / 100}%
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="font-mono text-lg">{gen(a.funded)} GEN</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {a.settled ? `settled · ${gen(a.paid_out)} GEN paid` : "not settled"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="bg-card px-5 py-6">
      <p className="text-eyebrow">{label}</p>
      <p className="mt-2 font-mono text-xl">{value ?? "—"}</p>
    </div>
  );
}
