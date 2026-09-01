import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Landmark, ScrollText, ShieldAlert, Upload, Vault, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip } from "@/components/AddressChip";
import { StatusBadge } from "@/components/StatusBadge";
import { TxState } from "@/components/TxState";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { NetworkNotice } from "@/components/WalletButton";
import { useTx } from "@/hooks/useTx";
import { useWallet } from "@/hooks/useWallet";
import {
  acceptDeliverable,
  adjudicate,
  appeal,
  appealBondWei,
  cancelAgreement,
  fundEscrow,
  getAgreement,
  getEvidence,
  settle,
  type EvidenceItem,
} from "@/lib/genlayer/agentcourt";
import {
  agreementBody,
  agreementTitle,
  gen,
  latestDecision,
  sameAddress,
  STATUS_COPY,
} from "@/lib/agreement-utils";

export const Route = createFileRoute("/agreements/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Agreement #${params.id}, AgentCourt` },
      {
        name: "description",
        content: `Case file, evidence timeline, GenLayer verdict and settlement state for AgentCourt agreement #${params.id}.`,
      },
      { property: "og:title", content: `Agreement #${params.id}, AgentCourt` },
      {
        property: "og:description",
        content: "Case file, evidence timeline, GenLayer verdict and settlement state.",
      },
    ],
  }),
  component: AgreementDetail,
});

function AgreementDetail() {
  const { id } = Route.useParams();
  const numericId = Number(id);
  const enabled = hasContract() && Number.isFinite(numericId);
  const queryClient = useQueryClient();
  const { address, wrongNetwork } = useWallet();

  const agreementQuery = useQuery({
    queryKey: ["agreement", numericId],
    queryFn: () => getAgreement(numericId),
    enabled,
  });
  const evidenceQuery = useQuery({
    queryKey: ["evidence", numericId],
    queryFn: () => getEvidence(numericId),
    enabled,
  });

  const tx = useTx();
  const [grounds, setGrounds] = useState("");

  const a = agreementQuery.data;
  const isClient = sameAddress(address, a?.client);
  const isProvider = sameAddress(address, a?.provider);
  const canAct = Boolean(address) && !wrongNetwork && hasContract();
  const decision = a ? latestDecision(a) : null;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agreement", numericId] }),
      queryClient.invalidateQueries({ queryKey: ["evidence", numericId] }),
      queryClient.invalidateQueries({ queryKey: ["agreements"] }),
      queryClient.invalidateQueries({ queryKey: ["escrow-balance"] }),
    ]);
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-14">
        <ContractNotice />
      </div>
    );
  }

  if (agreementQuery.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-5 py-14">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (agreementQuery.error || !a) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-14">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Agreement #{id} could not be read from the contract:{" "}
          {(agreementQuery.error as Error | undefined)?.message ?? "not found"}
        </p>
        <Link to="/agreements" className="mt-4 inline-block text-brass underline">
          Back to docket
        </Link>
      </div>
    );
  }

  const bond = appealBondWei(BigInt(a.amount));

  return (
    <div className="mx-auto max-w-5xl px-5 py-14">
      <Link to="/agreements" className="text-eyebrow hover:text-foreground">
        ← Docket
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">#{a.id}</span>
            <StatusBadge status={a.status} />
          </div>
          <h1 className="mt-3 text-4xl">{agreementTitle(a)}</h1>
          <p className="mt-2 text-muted-foreground">{STATUS_COPY[a.status]}</p>
        </div>
        <div className="text-right">
          <p className="text-eyebrow">Escrow held</p>
          <p className="font-mono text-3xl">{gen(a.funded)} GEN</p>
          <p className="font-mono text-xs text-muted-foreground">agreed {gen(a.amount)} GEN</p>
          {BigInt(a.bond_pool) > 0n && (
            <p className="font-mono text-xs text-dispute">appeal bond {gen(a.bond_pool)} GEN</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <NetworkNotice />
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <AddressChip address={a.client} label="Client" you={isClient} />
        <AddressChip address={a.provider} label="Provider" you={isProvider} />
        <span className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
          created {a.created_at}
        </span>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Panel icon={ScrollText} title="Terms">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {agreementBody(a)}
            </p>
          </Panel>

          <Panel icon={Gavel} title="Acceptance criteria">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {a.acceptance_criteria}
            </p>
          </Panel>

          {a.dispute_reason && (
            <Panel icon={ShieldAlert} title="Dispute reason">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-dispute">
                {a.dispute_reason}
              </p>
            </Panel>
          )}

          <Panel icon={Upload} title="Evidence timeline">
            <p className="mb-4 text-xs text-muted-foreground">
              This exact record is the case file GenLayer validators reason over.
            </p>
            {evidenceQuery.isLoading && <Skeleton className="h-20 w-full" />}
            {evidenceQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No evidence submitted yet.</p>
            )}
            <ol className="space-y-4">
              {evidenceQuery.data?.map((e, i) => <EvidenceRow key={i} e={e} />)}
            </ol>
          </Panel>

          <Panel icon={Landmark} title="Adjudication">
            {a.decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No verdict recorded. A decision only exists once{" "}
                <code className="font-mono text-brass">adjudicate()</code> reaches consensus inside
                the Intelligent Contract.
              </p>
            ) : (
              <div className="space-y-4">
                {a.decisions.map((d) => (
                  <div key={d.round} className="rounded-md border border-brass/30 bg-brass/5 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-eyebrow">Round {d.round}</span>
                      <span className="font-mono text-xs text-muted-foreground">{d.decided_at}</span>
                    </div>
                    <p className="mt-2 font-display text-2xl text-brass">Winner: {d.winner}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-brass"
                        style={{ width: `${Math.min(100, d.client_bps / 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between font-mono text-xs text-muted-foreground">
                      <span>client {gen(d.client_award)} GEN ({d.client_bps / 100}%)</span>
                      <span>provider {gen(d.provider_award)} GEN ({d.provider_bps / 100}%)</span>
                    </div>
                    <p className="mt-3 text-sm text-foreground/90">{d.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel icon={Vault} title="Settlement">
            {a.settled ? (
              <p className="text-sm text-verdict">
                Settled on-chain. {gen(a.paid_out)} GEN transferred by the contract.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not settled. Funds remain locked in the contract until{" "}
                <code className="font-mono">settle()</code> executes the recorded decision.
              </p>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <div className="panel sticky top-24 p-5">
            <p className="text-eyebrow">Actions</p>
            {!canAct && (
              <p className="mt-3 text-xs text-muted-foreground">
                Connect your wallet on the right network to act on this case.
              </p>
            )}

            <div className="mt-4 space-y-2">
              {a.status === "CREATED" && isClient && (
                <>
                  <Button
                    className="w-full"
                    disabled={!canAct || tx.busy}
                    onClick={() =>
                      void tx.run("fund_escrow", () => fundEscrow(a.id, BigInt(a.amount)), refresh)
                    }
                  >
                    <Vault className="size-4" /> Fund escrow ({gen(a.amount)} GEN)
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!canAct || tx.busy}
                    onClick={() => void tx.run("cancel_agreement", () => cancelAgreement(a.id), refresh)}
                  >
                    <X className="size-4" /> Cancel agreement
                  </Button>
                </>
              )}

              {isProvider && (a.status === "FUNDED" || a.status === "DELIVERED") && (
                <Button asChild variant="outline" className="w-full">
                  <Link to="/deliver/$id" params={{ id: String(a.id) }}>
                    <Upload className="size-4" /> Submit deliverable
                  </Link>
                </Button>
              )}

              {isClient && a.status === "DELIVERED" && (
                <Button
                  className="w-full"
                  disabled={!canAct || tx.busy}
                  onClick={() => void tx.run("accept_deliverable", () => acceptDeliverable(a.id), refresh)}
                >
                  Accept &amp; release escrow
                </Button>
              )}

              {(isClient || isProvider) &&
                (a.status === "FUNDED" || a.status === "DELIVERED") && (
                  <Button asChild variant="destructive" className="w-full">
                    <Link to="/dispute/$id" params={{ id: String(a.id) }}>
                      <ShieldAlert className="size-4" /> Open dispute
                    </Link>
                  </Button>
                )}

              {(a.status === "DISPUTED" || a.status === "APPEALED") && (
                <>
                  <Button asChild variant="outline" className="w-full">
                    <Link to="/dispute/$id" params={{ id: String(a.id) }}>
                      Submit evidence
                    </Link>
                  </Button>
                  <Button
                    className="w-full"
                    disabled={!canAct || tx.busy}
                    onClick={() => void tx.run("adjudicate", () => adjudicate(a.id), refresh)}
                  >
                    <Gavel className="size-4" /> Request GenLayer adjudication
                  </Button>
                </>
              )}

              {a.status === "ADJUDICATED" && !a.settled && (
                <Button
                  className="w-full"
                  disabled={!canAct || tx.busy}
                  onClick={() => void tx.run("settle", () => settle(a.id), refresh)}
                >
                  <Landmark className="size-4" /> Settle &amp; pay out
                </Button>
              )}
            </div>

            {a.status === "ADJUDICATED" &&
              !a.settled &&
              a.appeal_round < 1 &&
              (isClient || isProvider) && (
                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-eyebrow">Appeal (one round)</p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    bond {gen(bond)} GEN, forfeited to the other side if the appeal fails.
                  </p>
                  <Textarea
                    rows={3}
                    className="mt-3"
                    value={grounds}
                    onChange={(e) => setGrounds(e.target.value)}
                    placeholder="Grounds for appeal, new evidence or misread criteria…"
                  />
                  <Button
                    variant="outline"
                    className="mt-2 w-full"
                    disabled={!canAct || tx.busy || grounds.trim().length === 0}
                    onClick={() =>
                      void tx.run("appeal", () => appeal(a.id, grounds.trim(), bond), async () => {
                        setGrounds("");
                        await refresh();
                      })
                    }
                  >
                    File appeal
                  </Button>
                </div>
              )}

            <TxState phase={tx.phase} hash={tx.hash} error={tx.error} />

            <div className="mt-5 space-y-1 border-t border-border pt-4 font-mono text-[11px] text-muted-foreground">
              <p>status · {a.status}</p>
              <p>settled · {String(a.settled)}</p>
              <p>paid_out · {a.paid_out} wei</p>
              <p>appeal_round · {a.appeal_round}</p>
              <p>evidence · {a.evidence_count} items</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function EvidenceRow({ e }: { e: EvidenceItem }) {
  return (
    <li className="relative border-l border-border pl-5">
      <span className="absolute top-1.5 -left-[5px] size-2.5 rounded-full border border-brass bg-background" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] tracking-widest text-brass uppercase">{e.kind}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{e.role}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{e.submitted_at}</span>
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap text-foreground/90">{e.statement}</p>
      {e.uri && (
        <a
          href={e.uri}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-xs break-all text-consensus underline"
        >
          {e.uri}
        </a>
      )}
    </li>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Gavel;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-6">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-4 text-brass" />
        <h2 className="text-lg">{title}</h2>
      </div>
      {children}
    </section>
  );
}
