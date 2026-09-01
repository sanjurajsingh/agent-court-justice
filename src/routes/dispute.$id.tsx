import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TxState } from "@/components/TxState";
import { StatusBadge } from "@/components/StatusBadge";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { NetworkNotice } from "@/components/WalletButton";
import { useTx } from "@/hooks/useTx";
import { useWallet } from "@/hooks/useWallet";
import {
  adjudicate,
  getAgreement,
  getEvidence,
  openDispute,
  submitEvidence,
} from "@/lib/genlayer/agentcourt";
import { agreementTitle, sameAddress } from "@/lib/agreement-utils";

export const Route = createFileRoute("/dispute/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Dispute, Agreement #${params.id}, AgentCourt` },
      {
        name: "description",
        content:
          "Open a dispute, file evidence and request GenLayer consensus adjudication for an AgentCourt agreement.",
      },
      { property: "og:title", content: `Dispute, Agreement #${params.id}` },
      {
        property: "og:description",
        content: "File evidence and request adjudication by GenLayer validator consensus.",
      },
    ],
  }),
  component: DisputePage,
});

function DisputePage() {
  const { id } = Route.useParams();
  const numericId = Number(id);
  const queryClient = useQueryClient();
  const { address, wrongNetwork } = useWallet();

  const openTx = useTx();
  const evidenceTx = useTx();
  const adjudicateTx = useTx();

  const [reason, setReason] = useState("");
  const [uri, setUri] = useState("");
  const [statement, setStatement] = useState("");

  const enabled = hasContract() && Number.isFinite(numericId);
  const { data: a } = useQuery({
    queryKey: ["agreement", numericId],
    queryFn: () => getAgreement(numericId),
    enabled,
  });
  const { data: evidence } = useQuery({
    queryKey: ["evidence", numericId],
    queryFn: () => getEvidence(numericId),
    enabled,
  });

  const isParty = sameAddress(address, a?.client) || sameAddress(address, a?.provider);
  const canAct = enabled && Boolean(address) && !wrongNetwork && isParty;
  const disputeOpen = a?.status === "DISPUTED" || a?.status === "APPEALED";

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agreement", numericId] }),
      queryClient.invalidateQueries({ queryKey: ["evidence", numericId] }),
      queryClient.invalidateQueries({ queryKey: ["agreements"] }),
    ]);
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <Link to="/agreements/$id" params={{ id }} className="text-eyebrow hover:text-foreground">
        ← Agreement #{id}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-4xl">Dispute</h1>
        {a && <StatusBadge status={a.status} />}
      </div>
      {a && <p className="mt-2 text-muted-foreground">{agreementTitle(a)}</p>}

      <div className="mt-8">
        <ContractNotice />
        <NetworkNotice />
        {address && a && !isParty && (
          <div className="mb-6 rounded-md border border-dispute/40 bg-dispute/10 px-4 py-3 text-sm text-dispute">
            Only the client or provider recorded in the contract can act on this dispute.
          </div>
        )}
      </div>

      <div className="space-y-6">
        {!disputeOpen && (
          <section className="panel p-6">
            <div className="mb-4 flex items-center gap-2">
              <ShieldAlert className="size-4 text-dispute" />
              <h2 className="text-lg">Open a dispute</h2>
            </div>
            <Label className="text-eyebrow">Reason</Label>
            <Textarea
              rows={5}
              className="mt-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Only 2 of 3 endpoints work and the OpenAPI spec does not validate."
            />
            <Button
              variant="destructive"
              className="mt-4"
              disabled={!canAct || openTx.busy || reason.trim().length === 0}
              onClick={() =>
                void openTx.run("open_dispute", () => openDispute(numericId, reason.trim()), refresh)
              }
            >
              Open dispute
            </Button>
            <TxState phase={openTx.phase} hash={openTx.hash} error={openTx.error} label="open_dispute" />
          </section>
        )}

        <section className="panel p-6">
          <h2 className="text-lg">File evidence</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Both parties may append evidence. Every item below is included verbatim in the case file
            sent to the validators.
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <Label className="text-eyebrow">Evidence URI (optional)</Label>
              <Input
                className="mt-2 font-mono"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder="https://ci.example.com/run/1234"
              />
            </div>
            <div>
              <Label className="text-eyebrow">Statement</Label>
              <Textarea
                rows={4}
                className="mt-2"
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="CI logs show all three endpoints returning HTTP 200 at 14:02 UTC."
              />
            </div>
            <Button
              disabled={!canAct || evidenceTx.busy || statement.trim().length === 0}
              onClick={() =>
                void evidenceTx.run(
                  "submit_evidence",
                  () => submitEvidence(numericId, uri.trim(), statement.trim()),
                  async () => {
                    setUri("");
                    setStatement("");
                    await refresh();
                  },
                )
              }
            >
              Submit evidence
            </Button>
            <TxState
              phase={evidenceTx.phase}
              hash={evidenceTx.hash}
              error={evidenceTx.error}
              label="submit_evidence"
            />
          </div>
        </section>

        <section className="panel p-6">
          <h2 className="text-lg">Case file sent to adjudication</h2>
          <ol className="mt-4 space-y-4">
            {evidence?.length === 0 && (
              <p className="text-sm text-muted-foreground">No evidence recorded yet.</p>
            )}
            {evidence?.map((e, i) => (
              <li key={i} className="border-l border-border pl-4">
                <p className="font-mono text-[11px] tracking-widest text-brass uppercase">
                  {e.kind} · {e.role} · {e.submitted_at}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-foreground/90">{e.statement}</p>
                {e.uri && (
                  <p className="mt-1 font-mono text-xs break-all text-consensus">{e.uri}</p>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="panel border-brass/30 p-6">
          <div className="mb-3 flex items-center gap-2">
            <Gavel className="size-4 text-brass" />
            <h2 className="text-lg">Request GenLayer adjudication</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Calling <code className="font-mono text-brass">adjudicate()</code> runs the judgment
            inside the Intelligent Contract: the leader reasons over the case file and every
            validator re-runs it. Under the Equivalence Principle the winner must match exactly and
            the award split must agree within 500 bps, otherwise no verdict is written and no funds
            move. This interface neither computes nor influences the outcome.
          </p>
          <Button
            className="mt-4"
            disabled={!canAct || !disputeOpen || adjudicateTx.busy}
            onClick={() => void adjudicateTx.run("adjudicate", () => adjudicate(numericId), refresh)}
          >
            <Gavel className="size-4" /> Request adjudication
          </Button>
          {adjudicateTx.phase === "pending" && (
            <p className="mt-3 text-sm text-consensus">
              Validators are reasoning over the case file, consensus pending.
            </p>
          )}
          <TxState
            phase={adjudicateTx.phase}
            hash={adjudicateTx.hash}
            error={adjudicateTx.error}
            label="adjudicate"
          />
          {a && a.decisions.length > 0 && (
            <p className="mt-4 text-sm text-brass">
              Latest verdict: {a.decisions[a.decisions.length - 1]!.winner}: {" "}
              <Link to="/agreements/$id" params={{ id }} className="underline">
                view full decision
              </Link>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
