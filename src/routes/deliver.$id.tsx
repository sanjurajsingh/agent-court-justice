import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TxState } from "@/components/TxState";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { NetworkNotice } from "@/components/WalletButton";
import { useTx } from "@/hooks/useTx";
import { useWallet } from "@/hooks/useWallet";
import { getAgreement, submitDeliverable } from "@/lib/genlayer/agentcourt";
import { agreementTitle, sameAddress } from "@/lib/agreement-utils";

export const Route = createFileRoute("/deliver/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Submit Deliverable, Agreement #${params.id}, AgentCourt` },
      {
        name: "description",
        content:
          "Providers record the deliverable URI and statement directly in the AgentCourt Intelligent Contract.",
      },
      { property: "og:title", content: `Submit Deliverable, Agreement #${params.id}` },
      {
        property: "og:description",
        content: "Record the deliverable URI and statement on-chain for validators to review.",
      },
    ],
  }),
  component: DeliverPage,
});

function DeliverPage() {
  const { id } = Route.useParams();
  const numericId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { address, wrongNetwork } = useWallet();
  const tx = useTx();

  const [uri, setUri] = useState("");
  const [note, setNote] = useState("");

  const { data: a } = useQuery({
    queryKey: ["agreement", numericId],
    queryFn: () => getAgreement(numericId),
    enabled: hasContract() && Number.isFinite(numericId),
  });

  const isProvider = sameAddress(address, a?.provider);
  const canSubmit =
    hasContract() && Boolean(address) && !wrongNetwork && isProvider && note.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <Link to="/agreements/$id" params={{ id }} className="text-eyebrow hover:text-foreground">
        ← Agreement #{id}
      </Link>
      <h1 className="mt-4 text-4xl">Submit deliverable</h1>
      {a && <p className="mt-2 text-muted-foreground">{agreementTitle(a)}</p>}

      <div className="mt-8">
        <ContractNotice />
        <NetworkNotice />
        {address && a && !isProvider && (
          <div className="mb-6 rounded-md border border-dispute/40 bg-dispute/10 px-4 py-3 text-sm text-dispute">
            Only the provider wallet recorded in the contract can submit the deliverable.
          </div>
        )}
      </div>

      <div className="panel space-y-6 p-6">
        {a && (
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <p className="text-eyebrow">Acceptance criteria you are delivering against</p>
            <p className="mt-2 text-sm whitespace-pre-wrap text-foreground/90">
              {a.acceptance_criteria}
            </p>
          </div>
        )}

        <div>
          <Label className="text-eyebrow">Deliverable URI</Label>
          <Input
            className="mt-2 font-mono"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="https://… , ipfs://… , or a signed file link"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Files may be hosted anywhere; the contract stores the URI, and validators reason over the
            URI plus your statement. Storage never decides the case.
          </p>
        </div>

        <div>
          <Label className="text-eyebrow">Statement</Label>
          <Textarea
            rows={6}
            className="mt-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was delivered, and how it satisfies each acceptance criterion."
          />
        </div>

        <Button
          disabled={!canSubmit || tx.busy}
          onClick={() =>
            void tx.run(
              "submit_deliverable",
              () => submitDeliverable(numericId, uri.trim(), note.trim()),
              async () => {
                await queryClient.invalidateQueries({ queryKey: ["agreement", numericId] });
                await queryClient.invalidateQueries({ queryKey: ["evidence", numericId] });
                await navigate({ to: "/agreements/$id", params: { id } });
              },
            )
          }
        >
          <Upload className="size-4" /> Submit to contract
        </Button>

        <TxState phase={tx.phase} hash={tx.hash} error={tx.error} label="submit_deliverable" />
      </div>
    </div>
  );
}
