import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Vault } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { NetworkNotice } from "@/components/WalletButton";
import { TxState } from "@/components/TxState";
import { useTx } from "@/hooks/useTx";
import { useWallet } from "@/hooks/useWallet";
import { createAgreement, fundEscrow, getNextId } from "@/lib/genlayer/agentcourt";
import { genToWei } from "@/lib/genlayer/config";
import { encodeTerms } from "@/lib/agreement-utils";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Agreement, AgentCourt" },
      {
        name: "description",
        content:
          "Record terms, acceptance criteria and a native GEN escrow in the AgentCourt Intelligent Contract.",
      },
      { property: "og:title", content: "Create Agreement, AgentCourt" },
      {
        property: "og:description",
        content: "Record terms, acceptance criteria and a native GEN escrow on GenLayer.",
      },
    ],
  }),
  component: CreatePage,
});

function CreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { address, wrongNetwork } = useWallet();
  const createTx = useTx();
  const fundTx = useTx();

  const [provider, setProvider] = useState("");
  const [title, setTitle] = useState("");
  const [terms, setTerms] = useState("");
  const [criteria, setCriteria] = useState("");
  const [amount, setAmount] = useState("");
  const [agreementId, setAgreementId] = useState<number | null>(null);

  const ready = hasContract() && Boolean(address) && !wrongNetwork;
  const amountWei = (() => {
    try {
      return amount.trim() ? genToWei(amount.trim()) : 0n;
    } catch {
      return 0n;
    }
  })();

  const canCreate =
    ready &&
    provider.trim().startsWith("0x") &&
    terms.trim().length > 0 &&
    criteria.trim().length > 0 &&
    amountWei > 0n;

  async function onCreate() {
    await createTx.run(
      "create_agreement",
      () =>
        createAgreement({
          provider: provider.trim(),
          terms: encodeTerms(title, terms),
          acceptanceCriteria: criteria.trim(),
          amountWei,
        }),
      async () => {
        const next = Number(await getNextId());
        setAgreementId(next - 1);
        await queryClient.invalidateQueries({ queryKey: ["agreements"] });
      },
    );
  }

  async function onFund() {
    if (agreementId === null) return;
    await fundTx.run(
      "fund_escrow",
      () => fundEscrow(agreementId, amountWei),
      async () => {
        await queryClient.invalidateQueries({ queryKey: ["agreements"] });
        await navigate({ to: "/agreements/$id", params: { id: String(agreementId) } });
      },
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <p className="text-eyebrow">Two-step onchain action</p>
      <h1 className="mt-3 text-4xl">Create an agreement</h1>
      <p className="mt-3 text-muted-foreground">
        Step 1 writes the agreement to the Intelligent Contract. Step 2 escrows native GEN. Both are
        signed by your wallet, AgentCourt holds no session and no custody.
      </p>

      <div className="mt-8">
        <ContractNotice />
        <NetworkNotice />
      </div>

      <div className="panel space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Party A, client (you)">
            <Input
              value={address ?? ""}
              readOnly
              placeholder="Connect your wallet"
              className="font-mono"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              The connected wallet is recorded as the paying party by the contract.
            </p>
          </Field>
          <Field label="Party B, provider wallet">
            <Input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="0x… human or agent wallet"
              className="font-mono"
            />
          </Field>
        </div>

        <Field label="Agreement title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="REST API delivery for Q3 integration"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Stored on-chain as the first line of the terms, validators read it too.
          </p>
        </Field>

        <Field label="Natural-language terms">
          <Textarea
            rows={6}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="Provider delivers a working REST API with 3 endpoints and an OpenAPI spec before the deadline…"
          />
        </Field>

        <Field label="Acceptance criteria">
          <Textarea
            rows={4}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="All 3 endpoints return HTTP 200 for the documented happy path and the OpenAPI spec validates."
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            This is the standard GenLayer validators judge the evidence against.
          </p>
        </Field>

        <Field label="Escrow amount (native GEN)">
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.1"
            className="font-mono"
          />
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">
            = {amountWei.toString()} wei · funding must match this amount exactly.
          </p>
        </Field>

        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
          <Button onClick={() => void onCreate()} disabled={!canCreate || createTx.busy || agreementId !== null}>
            1 · Create agreement
          </Button>
          <Button
            variant="outline"
            onClick={() => void onFund()}
            disabled={agreementId === null || fundTx.busy}
          >
            <Vault className="size-4" /> 2 · Fund escrow
          </Button>
        </div>

        <TxState phase={createTx.phase} hash={createTx.hash} error={createTx.error} label="create_agreement" />
        {agreementId !== null && (
          <p className="text-sm text-verdict">
            Agreement #{agreementId} written to the contract. Fund the escrow to activate it.
          </p>
        )}
        <TxState phase={fundTx.phase} hash={fundTx.hash} error={fundTx.error} label="fund_escrow" />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-eyebrow">{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
