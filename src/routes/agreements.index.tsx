import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { StatusBadge } from "@/components/StatusBadge";
import { AddressChip } from "@/components/AddressChip";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { listAgreements, type Agreement } from "@/lib/genlayer/agentcourt";
import { agreementTitle, gen, latestDecision, STATUS_COPY } from "@/lib/agreement-utils";
import { useWallet } from "@/hooks/useWallet";
import { sameAddress } from "@/lib/agreement-utils";

export const Route = createFileRoute("/agreements/")({
  head: () => ({
    meta: [
      { title: "Agreements, AgentCourt" },
      {
        name: "description",
        content:
          "Every agreement recorded in the AgentCourt Intelligent Contract, with live escrow, dispute and settlement state.",
      },
      { property: "og:title", content: "Agreements, AgentCourt" },
      {
        property: "og:description",
        content: "Live escrow, dispute and settlement state read straight from the contract.",
      },
    ],
  }),
  component: AgreementsPage,
});

function AgreementsPage() {
  const enabled = hasContract();
  const { data, isLoading, error } = useQuery({
    queryKey: ["agreements"],
    queryFn: listAgreements,
    enabled,
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <p className="text-eyebrow">Public docket</p>
      <h1 className="mt-3 text-4xl">Agreements</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Read directly from the deployed Intelligent Contract. Nothing on this page is cached
        business data, if the contract has no agreements, this docket is empty.
      </p>

      <div className="mt-8">
        <ContractNotice />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Could not read the contract: {(error as Error).message}
        </p>
      )}

      {enabled && isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="panel p-10 text-center">
          <p className="text-muted-foreground">No agreements exist in this contract yet.</p>
          <Link to="/create" className="mt-3 inline-block text-brass underline">
            Create the first one
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {data?.map((a) => (
          <AgreementRow key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

function AgreementRow({ a }: { a: Agreement }) {
  const { address } = useWallet();
  const decision = latestDecision(a);
  return (
    <Link
      to="/agreements/$id"
      params={{ id: String(a.id) }}
      className="panel block p-5 transition-colors hover:border-brass/40"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground">#{a.id}</span>
            <StatusBadge status={a.status} />
          </div>
          <h2 className="mt-2 truncate text-xl">{agreementTitle(a)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{STATUS_COPY[a.status]}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <AddressChip address={a.client} label="Client" you={sameAddress(address, a.client)} />
            <AddressChip address={a.provider} label="Provider" you={sameAddress(address, a.provider)} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-eyebrow">Escrow</p>
          <p className="font-mono text-xl">{gen(a.funded)} GEN</p>
          <p className="font-mono text-xs text-muted-foreground">of {gen(a.amount)} agreed</p>
          {decision && (
            <p className="mt-2 font-mono text-xs text-brass">
              Verdict: {decision.winner} · {decision.client_bps / 100}% client
            </p>
          )}
          {a.settled && (
            <p className="mt-1 font-mono text-xs text-verdict">Paid out {gen(a.paid_out)} GEN</p>
          )}
        </div>
      </div>
    </Link>
  );
}
