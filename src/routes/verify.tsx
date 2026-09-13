import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCopy, RefreshCw, Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { ContractNotice, hasContract } from "@/components/ContractNotice";
import { AGENTCOURT_ADDRESS, NETWORK } from "@/lib/genlayer/config";
import { getNativeBalance } from "@/lib/genlayer/balances";
import {
  getAgreement,
  getDecisions,
  getEscrowBalance,
  getEvidence,
} from "@/lib/genlayer/agentcourt";
import { listPending, listTxLog, clearTxLog, subscribe } from "@/lib/genlayer/tx-store";
import { gen, shortAddress } from "@/lib/agreement-utils";

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: "Steward Verification Console, AgentCourt" },
      {
        name: "description",
        content:
          "Record a real Studionet lifecycle: escrow funding, deliverable, dispute, grounded adjudication and settlement, with finalized transaction hashes and authoritative balance reads.",
      },
      { property: "og:title", content: "Steward Verification Console, AgentCourt" },
      {
        property: "og:description",
        content:
          "Authoritative on-chain reads and finalized transaction hashes for the AgentCourt lifecycle demonstration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VerifyPage,
});

type SnapshotKey = "beforeFunding" | "afterFunding" | "afterSettlement";

interface Snapshot {
  at: string;
  contractWei: string;
  clientWei: string;
  providerWei: string;
  escrowWei: string;
}

const SNAP_KEY = "agentcourt.verify.snapshots.v1";
const ID_KEY = "agentcourt.verify.agreement-id";

const SNAP_LABELS: Record<SnapshotKey, string> = {
  beforeFunding: "Before funding",
  afterFunding: "After funding",
  afterSettlement: "After settlement",
};

function loadSnapshots(): Partial<Record<SnapshotKey, Snapshot>> {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<SnapshotKey, Snapshot>>) : {};
  } catch {
    return {};
  }
}

function VerifyPage() {
  const [idInput, setIdInput] = useState("");
  const [snapshots, setSnapshots] = useState<Partial<Record<SnapshotKey, Snapshot>>>({});
  const [txTick, setTxTick] = useState(0);

  useEffect(() => {
    setIdInput(localStorage.getItem(ID_KEY) ?? "1");
    setSnapshots(loadSnapshots());
    return subscribe(() => setTxTick((t) => t + 1));
  }, []);

  const numericId = Number(idInput);
  const enabled = hasContract() && Number.isFinite(numericId) && numericId > 0;

  const agreement = useQuery({
    queryKey: ["verify-agreement", numericId],
    queryFn: () => getAgreement(numericId),
    enabled,
    refetchInterval: 15000,
  });
  const evidence = useQuery({
    queryKey: ["verify-evidence", numericId],
    queryFn: () => getEvidence(numericId),
    enabled,
    refetchInterval: 15000,
  });
  const decisions = useQuery({
    queryKey: ["verify-decisions", numericId],
    queryFn: () => getDecisions(numericId),
    enabled,
    refetchInterval: 15000,
  });
  const escrow = useQuery({
    queryKey: ["verify-escrow"],
    queryFn: () => getEscrowBalance(),
    enabled: hasContract(),
    refetchInterval: 15000,
  });
  const contractBalance = useQuery({
    queryKey: ["verify-contract-balance"],
    queryFn: () => getNativeBalance(AGENTCOURT_ADDRESS).then(String),
    enabled: hasContract(),
    refetchInterval: 15000,
  });

  const a = agreement.data;

  const takeSnapshot = useCallback(
    async (key: SnapshotKey) => {
      if (!a) {
        toast.error("Load an agreement first");
        return;
      }
      try {
        const [contractWei, clientWei, providerWei, escrowWei] = await Promise.all([
          getNativeBalance(AGENTCOURT_ADDRESS).then(String),
          getNativeBalance(a.client).then(String),
          getNativeBalance(a.provider).then(String),
          getEscrowBalance().then(String),
        ]);
        const next = {
          ...loadSnapshots(),
          [key]: {
            at: new Date().toISOString(),
            contractWei,
            clientWei,
            providerWei,
            escrowWei,
          } satisfies Snapshot,
        };
        localStorage.setItem(SNAP_KEY, JSON.stringify(next));
        setSnapshots(next);
        toast.success(`${SNAP_LABELS[key]} balances recorded`);
      } catch (e) {
        toast.error("Balance read failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [a],
  );

  const txLog = useMemo(() => listTxLog(), [txTick]);
  const pending = useMemo(() => listPending(), [txTick]);

  const report = useMemo(() => {
    const lines: string[] = [];
    lines.push("STEWARD VERIFICATION REPORT, AgentCourt");
    lines.push(`Network: ${NETWORK}`);
    lines.push(`Contract: ${AGENTCOURT_ADDRESS}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    if (a) {
      lines.push(`Agreement ID: ${a.id}`);
      lines.push(`Client: ${a.client}`);
      lines.push(`Provider: ${a.provider}`);
      lines.push(`Status: ${a.status}`);
      lines.push(`Escrow amount: ${gen(a.amount)} GEN (${a.amount} wei)`);
      lines.push(`Funded: ${gen(a.funded)} GEN`);
      lines.push(`Bond pool: ${gen(a.bond_pool)} GEN`);
      lines.push(`Paid out: ${gen(a.paid_out)} GEN, settled=${String(a.settled)}`);
      lines.push("");
      lines.push(`Evidence items (${evidence.data?.length ?? 0}):`);
      (evidence.data ?? []).forEach((e, i) => {
        const rec = e as unknown as Record<string, unknown>;
        lines.push(
          `  ${i + 1}. ${e.kind} by ${e.role} ${e.submitter}` +
            `\n     uri: ${e.uri || "(none)"}` +
            `\n     content_hash: ${String(rec["content_hash"] ?? "")}` +
            `\n     observed_hash: ${String(rec["observed_hash"] ?? "")}` +
            `\n     validation_status: ${String(rec["validation_status"] ?? "")}` +
            `\n     content_hash_verified: ${String(rec["content_hash_verified"] ?? false)}` +
            `\n     issuer_verified: ${String(rec["issuer_verified"] ?? false)}` +
            `\n     issuer_identity: ${String(rec["issuer_identity"] ?? "")}` +
            `\n     issuer_source: ${String(rec["issuer_source"] ?? "")}` +
            `\n     source: ${String(rec["source"] ?? "")}` +
            `\n     statement: ${e.statement.slice(0, 240)}`,
        );
      });
      lines.push("");
      lines.push(`Decisions (${decisions.data?.length ?? 0}):`);
      (decisions.data ?? []).forEach((d) => {
        const rec = d as unknown as Record<string, unknown>;
        lines.push(
          `  round ${d.round}: winner=${d.winner} client_bps=${d.client_bps} provider_bps=${d.provider_bps}` +
            `\n     client_award: ${gen(d.client_award)} GEN, provider_award: ${gen(d.provider_award)} GEN` +
            `\n     evidence_content_verified=${String(rec["evidence_content_verified"] ?? "")} evidence_issuer_verified=${String(rec["evidence_issuer_verified"] ?? "")} evidence_unavailable=${String(rec["evidence_unavailable"] ?? "")}` +
            `\n     reason: ${d.reason}`,
        );
      });
    } else {
      lines.push("Agreement: not loaded");
    }
    lines.push("");
    lines.push(`Contract escrow (view): ${escrow.data ? gen(escrow.data) : "?"} GEN`);
    lines.push(
      `Contract native balance: ${contractBalance.data ? gen(contractBalance.data) : "?"} GEN`,
    );
    lines.push("");
    lines.push("Balance snapshots:");
    (Object.keys(SNAP_LABELS) as SnapshotKey[]).forEach((k) => {
      const s = snapshots[k];
      lines.push(
        s
          ? `  ${SNAP_LABELS[k]} (${s.at}): contract=${gen(s.contractWei)} escrow=${gen(s.escrowWei)} client=${gen(s.clientWei)} provider=${gen(s.providerWei)} GEN`
          : `  ${SNAP_LABELS[k]}: NOT RECORDED`,
      );
    });
    lines.push("");
    lines.push(`Finalized transactions (${txLog.length}):`);
    txLog.forEach((t) => {
      lines.push(
        `  ${t.label} [${t.status}] ${t.ok ? "OK" : "FAILED"} by ${t.account}\n     hash: ${t.hash}`,
      );
    });
    lines.push("");
    lines.push(`Still pending (must be zero to pass): ${pending.length}`);
    pending.forEach((p) => lines.push(`  ${p.label} ${p.hash} status=${p.lastStatus}`));
    lines.push("");
    const allFinal = pending.length === 0 && txLog.length > 0 && txLog.every((t) => t.ok);
    const settled = Boolean(a?.settled);
    lines.push(
      `LIFECYCLE: ${allFinal && settled ? "PASS" : "FAIL"} (all writes finalized: ${String(allFinal)}, agreement settled: ${String(settled)})`,
    );
    return lines.join("\n");
  }, [a, evidence.data, decisions.data, escrow.data, contractBalance.data, snapshots, txLog, pending]);

  return (
    <div className="mx-auto max-w-4xl px-5 py-14">
      <h1 className="text-4xl">Steward verification console</h1>
      <p className="mt-2 text-muted-foreground">
        Every value below is read live from the contract at {shortAddress(AGENTCOURT_ADDRESS, 6)} on{" "}
        {NETWORK}. Nothing here is simulated: hashes appear only once the network reports a
        finalized status.
      </p>

      <div className="mt-8">
        <ContractNotice />
      </div>

      <div className="panel mt-6 space-y-4 p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label className="text-eyebrow">Agreement ID</Label>
            <Input
              className="mt-2 font-mono"
              value={idInput}
              onChange={(e) => {
                setIdInput(e.target.value);
                localStorage.setItem(ID_KEY, e.target.value);
              }}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              void agreement.refetch();
              void evidence.refetch();
              void decisions.refetch();
              void escrow.refetch();
              void contractBalance.refetch();
            }}
          >
            <RefreshCw className="size-4" /> Re-read chain
          </Button>
          {a && <StatusBadge status={a.status} />}
        </div>

        {a && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Client" value={a.client} mono />
            <Row label="Provider" value={a.provider} mono />
            <Row label="Escrow amount" value={`${gen(a.amount)} GEN`} />
            <Row label="Funded" value={`${gen(a.funded)} GEN`} />
            <Row label="Paid out" value={`${gen(a.paid_out)} GEN`} />
            <Row label="Settled" value={String(a.settled)} />
            <Row label="Evidence items" value={String(evidence.data?.length ?? 0)} />
            <Row label="Decisions" value={String(decisions.data?.length ?? 0)} />
            <Row
              label="Contract escrow (view)"
              value={escrow.data ? `${gen(escrow.data)} GEN` : "…"}
            />
            <Row
              label="Contract native balance"
              value={contractBalance.data ? `${gen(contractBalance.data)} GEN` : "…"}
            />
          </dl>
        )}
      </div>

      <div className="panel mt-6 space-y-4 p-6">
        <h2 className="text-2xl">Balance snapshots</h2>
        <p className="text-sm text-muted-foreground">
          Record the contract, client and provider balances at each stage. Reads come straight from
          the network RPC.
        </p>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(SNAP_LABELS) as SnapshotKey[]).map((k) => (
            <Button key={k} variant="outline" onClick={() => void takeSnapshot(k)}>
              <Camera className="size-4" /> {SNAP_LABELS[k]}
            </Button>
          ))}
        </div>
        <div className="space-y-2 text-sm">
          {(Object.keys(SNAP_LABELS) as SnapshotKey[]).map((k) => {
            const s = snapshots[k];
            return (
              <div key={k} className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-eyebrow">{SNAP_LABELS[k]}</p>
                {s ? (
                  <p className="mt-1 font-mono text-xs text-foreground/90">
                    contract {gen(s.contractWei)} · escrow {gen(s.escrowWei)} · client{" "}
                    {gen(s.clientWei)} · provider {gen(s.providerWei)} GEN
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">not recorded</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel mt-6 space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl">Finalized transactions</h2>
          <Button variant="ghost" size="sm" onClick={() => clearTxLog()}>
            <Trash2 className="size-4" /> Clear log
          </Button>
        </div>
        {txLog.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No finalized writes recorded in this browser yet.
          </p>
        )}
        {txLog.map((t) => (
          <div key={t.hash} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p>
              <span className="text-eyebrow">{t.label}</span>{" "}
              <span className={t.ok ? "text-verdict" : "text-destructive"}>{t.status}</span>
            </p>
            <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{t.hash}</p>
            <p className="font-mono text-xs break-all text-muted-foreground">by {t.account}</p>
          </div>
        ))}
        {pending.length > 0 && (
          <p className="text-sm text-dispute">
            {pending.length} write(s) still pending. The demonstration cannot pass until each one
            reaches a finalized status.
          </p>
        )}
      </div>

      <div className="panel mt-6 space-y-3 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl">Report</h2>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(report);
              toast.success("Report copied");
            }}
          >
            <ClipboardCopy className="size-4" /> Copy
          </Button>
        </div>
        <pre className="max-h-[28rem] overflow-auto rounded-md border border-border bg-muted/30 p-4 font-mono text-xs whitespace-pre-wrap">
          {report}
        </pre>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <dt className="text-eyebrow">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
